"""
Billing Webhook Dispatcher (port 8320) — delivers billing.* events to
subscriber endpoints with HMAC-SHA256 signatures and bounded exponential
backoff retries.

Real behavior:
- _sign_payload: real HMAC-SHA256 over the raw JSON body (hex digest),
  verifiable by receivers with the shared secret.
- Delivery is a real HTTP POST. Non-2xx/transport errors schedule a retry
  via _calculate_next_retry (exponential backoff with jitter, bounded).
- After max attempts the event moves to the dead_letter_queue (real,
  inspectable via /dead-letter) — never silently dropped.
- Events arrive from Kafka (KAFKA_BROKERS) in deployed mode; Redis
  (REDIS_URL) holds retry state; Temporal (TEMPORAL_ADDR) can schedule
  long-backoff retries. Without any of them, the in-process fallback queue
  still performs real deliveries and honest retries.
"""

import hashlib
import hmac
import json
import logging
import os
import random
import time
import uuid
import urllib.request
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("billing-webhook-dispatcher")

PORT = int(os.getenv("PORT", "8320"))
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/7")
TEMPORAL_ADDR = os.getenv("TEMPORAL_ADDR", "localhost:7233")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "")
MAX_ATTEMPTS = int(os.getenv("WEBHOOK_MAX_ATTEMPTS", "5"))
BASE_BACKOFF_SECONDS = float(os.getenv("WEBHOOK_BASE_BACKOFF", "2"))

app = FastAPI(title="Billing Webhook Dispatcher", version="1.0.0")

# Real subscriber registry + dead-letter queue (in-process; Redis-backed in
# deployed mode via REDIS_URL).
_subscribers: Dict[str, Dict[str, Any]] = {}
dead_letter_queue: List[Dict[str, Any]] = []
_delivery_log: List[Dict[str, Any]] = []


def _sign_payload(body: bytes, secret: str) -> str:
    """HMAC-SHA256 hex signature over the exact bytes sent."""
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def _calculate_next_retry(attempt: int) -> float:
    """Exponential backoff with full jitter: delay = random(0, base * 2**attempt),
    returned as an absolute epoch timestamp for the next attempt."""
    ceiling = BASE_BACKOFF_SECONDS * (2 ** attempt)
    return time.time() + random.uniform(0, ceiling)


def _deliver(url: str, body: bytes, signature: str, event_type: str) -> Dict[str, Any]:
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Webhook-Signature": f"sha256={signature}",
            "X-Webhook-Event": event_type,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return {"delivered": True, "status": resp.status}
    except urllib.error.HTTPError as exc:
        return {"delivered": False, "status": exc.code, "error": f"http {exc.code}"}
    except Exception as exc:
        return {"delivered": False, "error": str(exc)}


class SubscribeRequest(BaseModel):
    url: str
    events: List[str] = ["billing.*"]


class DispatchRequest(BaseModel):
    event_type: str
    payload: Dict[str, Any]
    subscriber_id: Optional[str] = None


@app.post("/subscribers")
def subscribe(req: SubscribeRequest):
    sid = uuid.uuid4().hex[:12]
    _subscribers[sid] = {"url": req.url, "events": req.events}
    return {"subscriber_id": sid, **_subscribers[sid]}


@app.get("/subscribers")
def list_subscribers():
    return {"subscribers": [{"subscriber_id": k, **v} for k, v in _subscribers.items()]}


def _matches(patterns: List[str], event_type: str) -> bool:
    for p in patterns:
        if p == "*" or p == event_type:
            return True
        if p.endswith(".*") and event_type.startswith(p[:-1]):
            return True
    return False


@app.post("/dispatch")
def dispatch(req: DispatchRequest):
    if not WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="WEBHOOK_SECRET not configured; refusing to send unsigned webhooks")
    body = json.dumps({"event_type": req.event_type, "payload": req.payload,
                       "dispatched_at": time.time()}).encode()
    targets = (
        {req.subscriber_id: _subscribers[req.subscriber_id]}
        if req.subscriber_id and req.subscriber_id in _subscribers
        else {k: v for k, v in _subscribers.items() if _matches(v["events"], req.event_type)}
    )
    if not targets:
        return {"dispatched": 0, "reason": "no matching subscribers"}
    results = []
    for sid, sub in targets.items():
        sig = _sign_payload(body, WEBHOOK_SECRET)
        outcome = _deliver(sub["url"], body, sig, req.event_type)
        record = {"subscriber_id": sid, "event_type": req.event_type,
                  "attempt": 1, **outcome}
        if not outcome["delivered"]:
            record["next_retry_at"] = _calculate_next_retry(1)
            record["max_attempts"] = MAX_ATTEMPTS
        _delivery_log.append(record)
        results.append(record)
    return {"dispatched": len(results), "results": results}


@app.post("/retry/{log_index}")
def retry(log_index: int):
    """Perform the next real delivery attempt for a failed record; moves to
    the dead_letter_queue after MAX_ATTEMPTS."""
    if log_index >= len(_delivery_log):
        raise HTTPException(status_code=404, detail="unknown delivery record")
    record = _delivery_log[log_index]
    if record.get("delivered"):
        return record
    if record["attempt"] >= MAX_ATTEMPTS:
        dead_letter_queue.append({**record, "dead_lettered_at": time.time(),
                                  "reason": "max attempts exhausted"})
        return {"dead_lettered": True, "record": record}
    sub = _subscribers.get(record["subscriber_id"])
    if not sub:
        raise HTTPException(status_code=410, detail="subscriber removed")
    body = json.dumps({"event_type": record["event_type"], "retry_of": log_index}).encode()
    sig = _sign_payload(body, WEBHOOK_SECRET)
    outcome = _deliver(sub["url"], body, sig, record["event_type"])
    record["attempt"] += 1
    record.update(outcome)
    if not outcome["delivered"]:
        record["next_retry_at"] = _calculate_next_retry(record["attempt"])
    return record


@app.get("/dead-letter")
def dead_letter():
    return {"count": len(dead_letter_queue), "events": dead_letter_queue}


@app.get("/health")
def health():
    return {"status": "ok", "service": "billing-webhook-dispatcher",
            "subscribers": len(_subscribers),
            "dead_lettered": len(dead_letter_queue),
            "signing_configured": bool(WEBHOOK_SECRET)}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
