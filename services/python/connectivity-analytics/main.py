"""
Connectivity Analytics — aggregates REAL terminal connectivity telemetry
into history, trends and threshold alerts.

Every metric is computed from ingested samples (POST /ingest). With no data
the analytics endpoints return honest empty series — never fabricated
baseline numbers. Alerts fire when measured latency / packet_loss /
bandwidth cross configured thresholds; each alert carries the real sample
that triggered it.
"""

import logging
import os
import statistics
import threading
import time
from collections import defaultdict, deque

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("connectivity-analytics")

MAX_SAMPLES_PER_REGION = int(os.getenv("MAX_SAMPLES_PER_REGION", "5000"))
ALERT_LATENCY_MS = float(os.getenv("ALERT_LATENCY_MS", "1500"))
ALERT_PACKET_LOSS_PCT = float(os.getenv("ALERT_PACKET_LOSS_PCT", "10"))
ALERT_MIN_BANDWIDTH_KBPS = float(os.getenv("ALERT_MIN_BANDWIDTH_KBPS", "100"))

_lock = threading.Lock()
# region -> deque of samples
_history: dict[str, deque] = defaultdict(lambda: deque(maxlen=MAX_SAMPLES_PER_REGION))
_alerts: deque = deque(maxlen=1000)


class Sample(BaseModel):
    region: str
    terminal_id: str
    latency_ms: float = Field(ge=0)
    bandwidth_kbps: float = Field(ge=0)
    packet_loss_pct: float = Field(ge=0, le=100)
    timestamp: float | None = None


def _check_thresholds(s: Sample) -> list[dict]:
    """Generate alerts for a measured sample crossing a threshold."""
    out = []
    ts = s.timestamp or time.time()
    if s.latency_ms > ALERT_LATENCY_MS:
        out.append({"type": "high_latency", "region": s.region,
                    "terminal_id": s.terminal_id, "value": s.latency_ms,
                    "threshold": ALERT_LATENCY_MS, "at": ts})
    if s.packet_loss_pct > ALERT_PACKET_LOSS_PCT:
        out.append({"type": "high_packet_loss", "region": s.region,
                    "terminal_id": s.terminal_id, "value": s.packet_loss_pct,
                    "threshold": ALERT_PACKET_LOSS_PCT, "at": ts})
    if 0 < s.bandwidth_kbps < ALERT_MIN_BANDWIDTH_KBPS:
        out.append({"type": "low_bandwidth", "region": s.region,
                    "terminal_id": s.terminal_id, "value": s.bandwidth_kbps,
                    "threshold": ALERT_MIN_BANDWIDTH_KBPS, "at": ts})
    return out


def _trend(points: list[tuple[float, float]]) -> dict:
    """Least-squares slope over real (ts, value) points."""
    if len(points) < 2:
        return {"slope_per_hour": 0.0, "direction": "insufficient_data", "points": len(points)}
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    x0 = xs[0]
    xs = [(x - x0) / 3600.0 for x in xs]  # hours
    n = len(xs)
    sx, sy = sum(xs), sum(ys)
    sxx = sum(x * x for x in xs)
    sxy = sum(x * y for x, y in zip(xs, ys))
    denom = n * sxx - sx * sx
    if denom == 0:
        return {"slope_per_hour": 0.0, "direction": "flat", "points": n}
    slope = (n * sxy - sx * sy) / denom
    direction = "improving" if slope < -1 else "degrading" if slope > 1 else "flat"
    return {"slope_per_hour": slope, "direction": direction, "points": n}


app = FastAPI(title="Connectivity Analytics", version="1.0.0")


@app.get("/health")
async def health():
    with _lock:
        regions = len(_history)
        samples = sum(len(v) for v in _history.values())
    return {"status": "ok", "service": "connectivity-analytics",
            "regions": regions, "samples": samples}


@app.post("/ingest")
async def ingest(samples: list[Sample]):
    if not samples:
        raise HTTPException(status_code=400, detail="samples[] required")
    new_alerts = []
    with _lock:
        for s in samples:
            ts = s.timestamp or time.time()
            _history[s.region].append({
                "ts": ts, "terminal_id": s.terminal_id,
                "latency_ms": s.latency_ms, "bandwidth_kbps": s.bandwidth_kbps,
                "packet_loss_pct": s.packet_loss_pct,
            })
            for a in _check_thresholds(s):
                _alerts.append(a)
                new_alerts.append(a)
    return {"ingested": len(samples), "alerts_triggered": len(new_alerts)}


@app.get("/analytics/{region}")
async def analytics(region: str):
    """Aggregate metrics for a region from its real sample history."""
    with _lock:
        hist = list(_history.get(region, []))
    if not hist:
        return {"region": region, "samples": 0, "metrics": None,
                "note": "no telemetry ingested for this region yet"}
    lat = [h["latency_ms"] for h in hist]
    bw = [h["bandwidth_kbps"] for h in hist]
    pl = [h["packet_loss_pct"] for h in hist]
    return {
        "region": region,
        "samples": len(hist),
        "metrics": {
            "latency_ms": {"avg": statistics.fmean(lat),
                           "p50": statistics.median(lat), "max": max(lat)},
            "bandwidth_kbps": {"avg": statistics.fmean(bw), "min": min(bw)},
            "packet_loss_pct": {"avg": statistics.fmean(pl), "max": max(pl)},
        },
    }


@app.get("/analytics/{region}/trend")
async def trend(region: str):
    """Latency and bandwidth trend over the region's real history."""
    with _lock:
        hist = list(_history.get(region, []))
    lat_points = [(h["ts"], h["latency_ms"]) for h in hist]
    bw_points = [(h["ts"], h["bandwidth_kbps"]) for h in hist]
    return {
        "region": region,
        "latency_trend": _trend(lat_points),
        "bandwidth_trend": _trend(bw_points),
    }


@app.get("/analytics/{region}/history")
async def history(region: str, limit: int = 200):
    with _lock:
        hist = list(_history.get(region, []))
    return {"region": region, "samples": hist[-limit:]}


@app.get("/alerts")
async def alerts(region: str | None = None, limit: int = 100):
    with _lock:
        items = list(_alerts)
    if region:
        items = [a for a in items if a["region"] == region]
    return {"alerts": items[-limit:], "thresholds": {
        "latency_ms": ALERT_LATENCY_MS,
        "packet_loss_pct": ALERT_PACKET_LOSS_PCT,
        "min_bandwidth_kbps": ALERT_MIN_BANDWIDTH_KBPS,
    }}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8116")))
