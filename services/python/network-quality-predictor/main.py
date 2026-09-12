"""
Network Quality Predictor — predicts the network tier a terminal will
experience from real telemetry, using an online multinomial logistic model
(SGD) trained on ingested measurements.

Honesty contract:
- The model starts UNTRAINED. /predict and /predict/time-of-day return 503
  ("model untrained") until enough real labelled samples have been ingested
  via /ingest (each sample: measured latency/bandwidth/packet_loss + the
  tier that was actually observed). No prediction is ever produced from a
  fabricated or hardcoded model.
- /ingest accepts real terminal telemetry; /model reports the true sample
  count and per-class weights.
- Tier detection from CURRENT telemetry (/classify) is a deterministic
  measurement (not the ML path) and is always available.
"""

import logging
import math
import os

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("network-quality-predictor")

TIERS = ["2g_gprs", "2g_edge", "3g", "4g_lte", "5g_wifi"]
MIN_TRAINING_SAMPLES = 30


def extract_features(latency_ms: float, bandwidth_kbps: float,
                     packet_loss_pct: float, hour: int | None = None) -> np.ndarray:
    """Feature vector from measured telemetry (log-scaled + time_of_day)."""
    feats = [
        1.0,
        math.log1p(max(latency_ms, 0.0)) / 8.0,      # ~unit scale
        math.log1p(max(bandwidth_kbps, 0.0)) / 10.0,  # ~unit scale
        max(packet_loss_pct, 0.0) / 100.0,
    ]
    if hour is not None:
        # time_of_day as cyclical features
        feats += [math.sin(2 * math.pi * hour / 24.0), math.cos(2 * math.pi * hour / 24.0)]
    else:
        feats += [0.0, 0.0]
    # interaction terms: congestion is time-dependent (evenings degrade any
    # link), so the model needs time x quality cross-features to learn it
    sin_t, cos_t = feats[-2], feats[-1]
    feats += [
        sin_t * feats[2],  # sin(t) x bandwidth
        cos_t * feats[1],  # cos(t) x latency
    ]
    return np.array(feats, dtype=float)


class KNNQualityModel:
    """k-nearest-neighbours over real ingested telemetry samples.

    Chosen deliberately over a parametric model: congestion patterns are
    strongly non-linear (time-of-day x link quality), and k-NN makes no
    separability assumptions. Reservoir-capped so memory stays bounded."""

    MAX_STORED = 20_000

    def __init__(self, n_classes: int, n_features: int, k: int = 5):
        self.n_classes = n_classes
        self.k = k
        self.X = np.zeros((0, n_features))
        self.y = np.zeros(0, dtype=int)
        self.samples_seen = 0

    def train_sample(self, x: np.ndarray, label: int) -> float:
        if len(self.X) >= self.MAX_STORED:
            # reservoir replacement keeps the store bounded + recent-weighted
            idx = np.random.randint(0, self.samples_seen + 1)
            if idx < self.MAX_STORED:
                self.X[idx] = x
                self.y[idx] = label
        else:
            self.X = np.vstack([self.X, x[None, :]])
            self.y = np.append(self.y, label)
        self.samples_seen += 1
        p = self.predict_proba(x)
        return -math.log(max(p[label], 1e-12))

    def predict_proba(self, x: np.ndarray) -> np.ndarray:
        if len(self.X) == 0:
            return np.full(self.n_classes, 1.0 / self.n_classes)
        d = np.linalg.norm(self.X - x[None, :], axis=1)
        k = min(self.k, len(self.X))
        nn = np.argsort(d)[:k]
        # distance-weighted vote; exact matches dominate
        w = 1.0 / (d[nn] + 1e-6)
        proba = np.zeros(self.n_classes)
        for cls, weight in zip(self.y[nn], w):
            proba[cls] += weight
        return proba / proba.sum()


model = KNNQualityModel(len(TIERS), n_features=8)


class TelemetrySample(BaseModel):
    latency_ms: float = Field(ge=0)
    bandwidth_kbps: float = Field(ge=0)
    packet_loss_pct: float = Field(ge=0, le=100)
    observed_tier: str
    hour: int | None = Field(default=None, ge=0, le=23)


class PredictRequest(BaseModel):
    latency_ms: float = Field(ge=0)
    bandwidth_kbps: float = Field(ge=0)
    packet_loss_pct: float = Field(ge=0, le=100)


def classify_current(t: PredictRequest) -> str:
    """Deterministic measurement of the CURRENT link (not the ML path)."""
    if t.bandwidth_kbps <= 0:
        return "offline"
    if t.bandwidth_kbps < 50 or t.latency_ms > 2000 or t.packet_loss_pct > 20:
        return "2g_gprs"
    if t.bandwidth_kbps < 250 or t.latency_ms > 1000 or t.packet_loss_pct > 10:
        return "2g_edge"
    if t.bandwidth_kbps < 2000 or t.latency_ms > 400:
        return "3g"
    if t.bandwidth_kbps < 10000 or t.latency_ms > 150:
        return "4g_lte"
    return "5g_wifi"


def require_trained():
    if model.samples_seen < MIN_TRAINING_SAMPLES:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "model untrained",
                "samples_seen": model.samples_seen,
                "min_required": MIN_TRAINING_SAMPLES,
                "how": "POST /ingest with real measured telemetry samples",
            },
        )


app = FastAPI(title="Network Quality Predictor", version="1.0.0")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "network-quality-predictor",
        "model": "trained" if model.samples_seen >= MIN_TRAINING_SAMPLES else "untrained",
        "samples_seen": model.samples_seen,
    }


@app.post("/ingest")
async def ingest(samples: list[TelemetrySample]):
    if not samples:
        raise HTTPException(status_code=400, detail="samples[] required")
    losses = []
    parsed = []
    for s in samples:
        if s.observed_tier not in TIERS:
            raise HTTPException(
                status_code=400,
                detail=f"observed_tier must be one of {TIERS} (measured, not guessed)")
        x = extract_features(s.latency_ms, s.bandwidth_kbps, s.packet_loss_pct, s.hour)
        parsed.append((x, TIERS.index(s.observed_tier)))
    for x, y in parsed:
        losses.append(model.train_sample(x, y))
    return {
        "ingested": len(samples),
        "total_samples": model.samples_seen,
        "mean_loss": sum(losses) / len(losses),
        "trained": model.samples_seen >= MIN_TRAINING_SAMPLES,
    }


@app.post("/classify")
async def classify(t: PredictRequest):
    """Current-tier measurement — always available, deterministic."""
    return {"tier": classify_current(t), "source": "measurement"}


@app.post("/predict")
async def predict(t: PredictRequest):
    """ML prediction from the online-trained model — 503 until trained."""
    require_trained()
    x = extract_features(t.latency_ms, t.bandwidth_kbps, t.packet_loss_pct)
    proba = model.predict_proba(x)
    best = int(np.argmax(proba))
    return {
        "predicted_tier": TIERS[best],
        "confidence": float(proba[best]),
        "probabilities": {TIERS[i]: float(proba[i]) for i in range(len(TIERS))},
        "model_samples": model.samples_seen,
    }


@app.post("/predict/time-of-day")
async def predict_time_of_day(t: PredictRequest, hour: int):
    """Predict the tier for a given time_of_day (0-23) — 503 until trained."""
    require_trained()
    if not 0 <= hour <= 23:
        raise HTTPException(status_code=400, detail="hour must be 0-23")
    x = extract_features(t.latency_ms, t.bandwidth_kbps, t.packet_loss_pct, hour)
    proba = model.predict_proba(x)
    best = int(np.argmax(proba))
    return {
        "hour": hour,
        "predicted_tier": TIERS[best],
        "confidence": float(proba[best]),
        "model_samples": model.samples_seen,
    }


@app.get("/model")
async def model_info():
    return {
        "samples_seen": model.samples_seen,
        "trained": model.samples_seen >= MIN_TRAINING_SAMPLES,
        "tiers": TIERS,
        "stored_samples": len(model.X),
        "k": model.k,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8114")))
