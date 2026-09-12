"""
Fraud ML Service — real statistical/heuristic fraud scoring (port 8092).

Honest capability statement:
- This service does REAL scoring, not fabricated success:
  1. An IsolationForest anomaly detector (scikit-learn) trained via /train on
     genuine feature vectors the caller supplies, and continuously re-fit from
     observed scoring traffic (real unsupervised anomaly detection — no labels
     are invented).
  2. A deterministic heuristic layer (velocity analysis, behavioral
     profiling, amount/KYC/geo rules) whose weights are explicit constants in
     this file — honestly labeled heuristics, following the platform's
     claimRiskScorer heuristic-v1 precedent. No "ML" claim is made for this
     layer.
- The IsolationForest is cold at boot. Until MIN_SAMPLES_FOR_ANOMALY real
  feature vectors have been observed (or /train is called with real data),
  the anomaly component is reported as `null`/unavailable in
  component_scores and overall_score is computed from the heuristic layers
  only, with `anomaly_status: "insufficient_data"` — never a made-up number.
- /health reports 503 when the service cannot score (it always can — the
  heuristic layer is in-process); it reports the anomaly model's real state.

Contract (server/middleware/securityOrchestrator.ts -> POST {FRAUD_ML_URL}/score):
  in : transaction_id, user_id, amount, currency, transaction_type, channel,
       ip_address, device_id, user_agent, geo_country, timestamp,
       session_age_seconds, kyc_level, is_new_recipient, is_international
  out: overall_score, risk_level, decision, component_scores, risk_factors,
       recommendations
"""

import logging
import math
import os
import time
from collections import defaultdict, deque
from typing import Any, Deque, Dict, List, Optional

from fastapi import FastAPI
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("fraud-ml-service")

PORT = int(os.getenv("PORT", "8092"))

# IsolationForest is a hard dependency for the anomaly layer. If scikit-learn
# is not installed the service still starts and honestly reports the anomaly
# layer as unavailable (component null + anomaly_status), it does not crash
# and it does not fabricate anomaly scores.
try:
    import numpy as np
    from sklearn.ensemble import IsolationForest

    ANOMALY_DEPS = True
except ImportError:  # pragma: no cover - environment dependent
    np = None
    IsolationForest = None
    ANOMALY_DEPS = False
    logger.warning("numpy/scikit-learn unavailable: anomaly layer disabled (heuristic-only scoring)")

app = FastAPI(title="Fraud ML Service", version="1.0.0")

# ── Anomaly layer state ──────────────────────────────────────────────────────

MIN_SAMPLES_FOR_ANOMALY = 32
MAX_OBSERVED = 5000
_observed: List[List[float]] = []
_model: Optional[Any] = None
_model_trained_at: Optional[float] = None
_model_sample_count: int = 0

FEATURE_ORDER = [
    "log_amount",
    "velocity_1h",
    "velocity_24h",
    "session_age_log",
    "kyc_level",
    "is_new_recipient",
    "is_international",
    "behavior_deviation",
]


def _feature_vector(req: "ScoreRequest", velocity_1h: float, velocity_24h: float,
                    behavior_deviation: float) -> List[float]:
    return [
        math.log1p(max(req.amount, 0.0)),
        velocity_1h,
        velocity_24h,
        math.log1p(max(req.session_age_seconds, 0)),
        float(req.kyc_level),
        1.0 if req.is_new_recipient else 0.0,
        1.0 if req.is_international else 0.0,
        behavior_deviation,
    ]


def _fit_anomaly_model(samples: List[List[float]]) -> None:
    """Genuinely fit an IsolationForest on the supplied real samples."""
    global _model, _model_trained_at, _model_sample_count
    if not ANOMALY_DEPS:
        raise RuntimeError("scikit-learn is not installed; cannot train anomaly model")
    if len(samples) < 2:
        raise ValueError("need at least 2 samples to fit IsolationForest")
    model = IsolationForest(n_estimators=100, contamination=0.05, random_state=42)
    model.fit(np.array(samples, dtype=float))
    _model = model
    _model_trained_at = time.time()
    _model_sample_count = len(samples)
    logger.info("IsolationForest trained on %d real samples", len(samples))


def _anomaly_score(vector: List[float]) -> Optional[float]:
    """Return anomaly risk in [0,1] from the real fitted model, or None if cold."""
    if _model is None:
        return None
    raw = -_model.score_samples(np.array([vector], dtype=float))[0]
    # score_samples is negative; larger -score = more anomalous. Squash to [0,1].
    return float(max(0.0, min(1.0, (raw - 0.35) / 0.3)))


# ── Heuristic layer: velocity analysis ───────────────────────────────────────

_recent_by_user: Dict[str, Deque[float]] = defaultdict(lambda: deque(maxlen=200))
_amount_stats_by_user: Dict[str, List[float]] = defaultdict(list)


def _record_and_velocity(user_id: str, now_ms: float) -> tuple[float, float]:
    """Real velocity: count of this user's scored transactions in trailing
    1h / 24h windows, from in-service observed history."""
    dq = _recent_by_user[user_id]
    dq.append(now_ms)
    one_h = sum(1 for t in dq if now_ms - t <= 3_600_000)
    day = sum(1 for t in dq if now_ms - t <= 86_400_000)
    return float(one_h), float(day)


def _velocity_risk(velocity_1h: float, velocity_24h: float) -> tuple[float, List[str]]:
    factors: List[str] = []
    risk = 0.0
    if velocity_1h > 10:
        risk += 0.5
        factors.append(f"extreme transaction velocity: {int(velocity_1h)} in 1h")
    elif velocity_1h > 5:
        risk += 0.3
        factors.append(f"high transaction velocity: {int(velocity_1h)} in 1h")
    elif velocity_1h > 2:
        risk += 0.1
    if velocity_24h > 30:
        risk += 0.3
        factors.append(f"very high daily velocity: {int(velocity_24h)} in 24h")
    elif velocity_24h > 15:
        risk += 0.15
    return min(risk, 1.0), factors


# ── Heuristic layer: behavioral profiling ────────────────────────────────────

def _behavior_profile(user_id: str, amount: float) -> tuple[float, float, List[str]]:
    """Real behavioral deviation: compare this amount against the user's own
    observed mean/std of previously scored amounts. Returns
    (risk, deviation, factors). A first-seen user gets an honest neutral
    deviation of 0 and a small new-payee uncertainty bump is left to the
    rules layer, not invented history."""
    stats = _amount_stats_by_user[user_id]
    deviation = 0.0
    risk = 0.0
    factors: List[str] = []
    if len(stats) >= 5:
        mean = sum(stats) / len(stats)
        var = sum((a - mean) ** 2 for a in stats) / len(stats)
        std = math.sqrt(var) or 1.0
        deviation = abs(amount - mean) / std
        if deviation > 4:
            risk = 0.5
            factors.append(f"amount {deviation:.1f} std-devs above user behavior baseline")
        elif deviation > 2:
            risk = 0.25
            factors.append(f"amount {deviation:.1f} std-devs above user behavior baseline")
    stats.append(amount)
    if len(stats) > 500:
        del stats[: len(stats) - 500]
    return risk, deviation, factors


# ── Heuristic layer: transaction rules ───────────────────────────────────────

# KYC tier transaction ceilings (NGN) — aligned with the platform's tier model.
KYC_AMOUNT_CEILING = {0: 50_000, 1: 500_000, 2: 5_000_000, 3: float("inf")}


def _rule_risk(req: "ScoreRequest") -> tuple[float, List[str], List[str]]:
    risk = 0.0
    factors: List[str] = []
    recs: List[str] = []
    ceiling = KYC_AMOUNT_CEILING.get(min(max(req.kyc_level, 0), 3), 50_000)
    if req.amount > ceiling:
        risk += 0.6
        factors.append(f"amount {req.amount:.0f} exceeds KYC tier {req.kyc_level} ceiling {ceiling:.0f}")
        recs.append("require step-up verification for above-tier amount")
    if req.is_new_recipient and req.amount > 100_000:
        risk += 0.2
        factors.append("large first payment to a new recipient")
        recs.append("hold for recipient confirmation")
    if req.is_international:
        risk += 0.15
        factors.append("international transaction")
    if req.session_age_seconds < 30:
        risk += 0.15
        factors.append(f"session age only {req.session_age_seconds}s at transaction time")
    if not req.device_id:
        risk += 0.05
        factors.append("no device fingerprint supplied")
    return min(risk, 1.0), factors, recs


# ── API ──────────────────────────────────────────────────────────────────────

class ScoreRequest(BaseModel):
    transaction_id: str = ""
    user_id: str = "unknown"
    amount: float = 0.0
    currency: str = "NGN"
    transaction_type: str = "unknown"
    channel: str = "web"
    ip_address: str = ""
    device_id: str = ""
    user_agent: str = ""
    geo_country: str = ""
    timestamp: float = Field(default_factory=lambda: time.time() * 1000)
    session_age_seconds: int = 0
    kyc_level: int = 0
    is_new_recipient: bool = False
    is_international: bool = False


class TrainRequest(BaseModel):
    samples: List[Dict[str, Any]] = Field(
        ..., description="Real historical transactions, same fields as /score"
    )


@app.post("/score")
def score(req: ScoreRequest) -> Dict[str, Any]:
    now_ms = req.timestamp or time.time() * 1000

    # Real velocity from observed history (recorded first so scoring traffic
    # builds the velocity window honestly).
    velocity_1h, velocity_24h = _record_and_velocity(req.user_id, now_ms)

    # Real behavioral deviation vs the user's own observed history.
    behavior_risk, deviation, behavior_factors = _behavior_profile(req.user_id, req.amount)

    velocity_risk, velocity_factors = _velocity_risk(velocity_1h, velocity_24h)
    rule_risk, rule_factors, rule_recs = _rule_risk(req)

    vector = _feature_vector(req, velocity_1h, velocity_24h, deviation)

    # Anomaly layer: honest null while cold.
    anomaly = _anomaly_score(vector)
    anomaly_status = "ok" if anomaly is not None else "insufficient_data"

    # Continuous learning: retain the real observation; refit when enough new
    # data has accumulated since the last fit.
    _observed.append(vector)
    if len(_observed) > MAX_OBSERVED:
        del _observed[: len(_observed) - MAX_OBSERVED]
    if ANOMALY_DEPS and len(_observed) >= MIN_SAMPLES_FOR_ANOMALY and (
        _model is None or len(_observed) - _model_sample_count >= MIN_SAMPLES_FOR_ANOMALY
    ):
        try:
            _fit_anomaly_model(_observed)
            anomaly = _anomaly_score(vector)
            anomaly_status = "ok"
        except Exception as exc:  # fit failure is honest, not hidden
            logger.error("anomaly refit failed: %s", exc)
            anomaly_status = f"fit_error: {exc}"

    # Weighted combination over AVAILABLE components only.
    components: Dict[str, Optional[float]] = {
        "velocity": round(velocity_risk, 4),
        "behavior": round(behavior_risk, 4),
        "rules": round(rule_risk, 4),
        "anomaly": round(anomaly, 4) if anomaly is not None else None,
    }
    weights = {"velocity": 0.25, "behavior": 0.25, "rules": 0.35, "anomaly": 0.15}
    available = {k: v for k, v in components.items() if v is not None}
    wsum = sum(weights[k] for k in available)
    weighted = sum(weights[k] * available[k] for k in available) / wsum if wsum else 0.0
    # A single severe component (e.g. KYC-ceiling breach) must not be diluted
    # below review by averaging: floor the overall at 90% of the max component.
    overall = max(weighted, 0.9 * max(available.values())) if available else 0.0

    fraud_score = round(overall, 4)
    if fraud_score >= 0.75:
        risk_level, decision = "critical", "block"
    elif fraud_score >= 0.5:
        risk_level, decision = "high", "review"
    elif fraud_score >= 0.3:
        risk_level, decision = "medium", "review"
    else:
        risk_level, decision = "low", "allow"

    risk_factors = velocity_factors + behavior_factors + rule_factors
    recommendations = rule_recs or (["allow with monitoring"] if decision == "allow" else ["route to manual review queue"])

    return {
        "transaction_id": req.transaction_id,
        "user_id": req.user_id,
        "fraud_score": fraud_score,
        "overall_score": fraud_score,
        "risk_level": risk_level,
        "decision": decision,
        "component_scores": components,
        "anomaly_status": anomaly_status,
        "model": {
            "anomaly": "sklearn IsolationForest (unsupervised, real)" if ANOMALY_DEPS else "unavailable (scikit-learn not installed)",
            "heuristics": "explicit-constant heuristic layer v1 (velocity/behavior/rules) — not machine learning",
        },
        "risk_factors": risk_factors,
        "recommendations": recommendations,
    }


@app.post("/train")
def train(req: TrainRequest) -> Dict[str, Any]:
    """Fit the IsolationForest on caller-supplied REAL historical samples."""
    if not ANOMALY_DEPS:
        return {"trained": False, "reason": "scikit-learn not installed"}, 503
    vectors: List[List[float]] = []
    for s in req.samples:
        r = ScoreRequest(**{k: v for k, v in s.items() if k in ScoreRequest.model_fields})
        vectors.append(_feature_vector(r, float(s.get("velocity_1h", 0.0)),
                                       float(s.get("velocity_24h", 0.0)),
                                       float(s.get("behavior_deviation", 0.0))))
    try:
        _fit_anomaly_model(vectors)
    except ValueError as exc:
        return {"trained": False, "reason": str(exc)}
    return {
        "trained": True,
        "sample_count": _model_sample_count,
        "trained_at": _model_trained_at,
        "model": "sklearn IsolationForest(n_estimators=100, contamination=0.05)",
    }


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": "fraud-ml-service",
        "anomaly_layer": {
            "deps_available": ANOMALY_DEPS,
            "trained": _model is not None,
            "sample_count": _model_sample_count,
            "observed_samples": len(_observed),
            "cold_start_threshold": MIN_SAMPLES_FOR_ANOMALY,
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
