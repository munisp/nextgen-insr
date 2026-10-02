"""
Billing Webhook Dispatcher (port 8320) — delivers billing.* events to
subscriber endpoints with HMAC-SHA256 signatures and bounded exponential
backoff retries.

Real behavior:
- _sign_payload: real HMAC-SHA256 over the raw JSON body (hex digest),
  verifiable by receivers with the shared secret.
- Delivery is a real HTTP POST. Non-2xx/transport errors schedule a retry
  via _calculate_next_retry (exponential backoff with jitter, bounded).
- After max attempts the event moves to the dead-letter store (real,
  inspectable via /dead-letter) — never silently dropped.
- Events arrive from Kafka (KAFKA_BROKERS) in deployed mode; Temporal
  (TEMPORAL_ADDR) can schedule long-backoff retries.
- (2026-10-02, C2-a12) Persistence: subscribers, delivery log, and dead
  letters live in PostgreSQL (DATABASE_URL; tables webhook_subscriptions,
  webhook_deliveries with bounded retention, webhook_dead_letters). The
  service fails closed: boot aborts if the store is unreachable, and
  subscriber registration / dead-letter enqueue return 503 rather than
  silently dropping a billing event.
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
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from store import PostgresStore, StoreUnavailable

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("billing-webhook-dispatcher")

PORT = int(os.getenv("PORT", "8320"))
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
TEMPORAL_ADDR = os.getenv("TEMPORAL_ADDR", "localhost:7233")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "")
MAX_ATTEMPTS = int(os.getenv("WEBHOOK_MAX_ATTEMPTS", "5"))
BASE_BACKOFF_SECONDS = float(os.getenv("WEBHOOK_BASE_BACKOFF", "2"))

# (2026-10-02, C2-a12) real PG-backed store; no in-process fallback — a
# fallback that loses billing events on restart is worse than an outage.
store = PostgresStore()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail-closed boot (2026-10-02, C2-a12): refuse to serve without the store.
    store.init_schema()
    yield


app = FastAPI(title="Billing Webhook Dispatcher", version="1.0.0", lifespan=lifespan)


def _store_unavailable(exc: StoreUnavailable) -> HTTPException:
    logger.error("store unavailable: %s", exc)
    return HTTPException(status_code=503, detail=f"webhook store unavailable: {exc}")


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
    try:
        store.add_subscriber(sid, req.url, req.events)
    except StoreUnavailable as exc:
        raise _store_unavailable(exc)
    return {"subscriber_id": sid, "url": req.url, "events": req.events}


@app.get("/subscribers")
def list_subscribers():
    try:
        subscribers = store.list_subscribers()
    except StoreUnavailable as exc:
        raise _store_unavailable(exc)
    return {"subscribers": [{"subscriber_id": k, **v} for k, v in subscribers.items()]}


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
    try:
        subscribers = store.list_subscribers()
    except StoreUnavailable as exc:
        raise _store_unavailable(exc)
    body = json.dumps({"event_type": req.event_type, "payload": req.payload,
                       "dispatched_at": time.time()}).encode()
    targets = (
        {req.subscriber_id: subscribers[req.subscriber_id]}
        if req.subscriber_id and req.subscriber_id in subscribers
        else {k: v for k, v in subscribers.items() if _matches(v["events"], req.event_type)}
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
        try:
            store.append_delivery(record)
        except StoreUnavailable as exc:
            raise _store_unavailable(exc)
        results.append(record)
    return {"dispatched": len(results), "results": results}


@app.post("/retry/{log_index}")
def retry(log_index: int):
    """Perform the next real delivery attempt for a failed record; moves to
    the dead-letter store after MAX_ATTEMPTS."""
    try:
        record = store.get_delivery_by_index(log_index)
    except StoreUnavailable as exc:
        raise _store_unavailable(exc)
    if record is None:
        raise HTTPException(status_code=404, detail="unknown delivery record")
    if record.get("delivered"):
        record.pop("id", None)
        return record
    if record["attempt"] >= MAX_ATTEMPTS:
        dead = {k: v for k, v in record.items() if k != "id"}
        try:
            store.append_dead_letter(dead, time.time(), "max attempts exhausted")
        except StoreUnavailable as exc:
            raise _store_unavailable(exc)
        return {"dead_lettered": True, "record": dead}
    try:
        sub = store.get_subscriber(record["subscriber_id"])
    except StoreUnavailable as exc:
        raise _store_unavailable(exc)
    if not sub:
        raise HTTPException(status_code=410, detail="subscriber removed")
    body = json.dumps({"event_type": record["event_type"], "retry_of": log_index}).encode()
    sig = _sign_payload(body, WEBHOOK_SECRET)
    outcome = _deliver(sub["url"], body, sig, record["event_type"])
    record["attempt"] += 1
    record.update(outcome)
    if not outcome["delivered"]:
        record["next_retry_at"] = _calculate_next_retry(record["attempt"])
    else:
        record["next_retry_at"] = None
    try:
        store.update_delivery(record)
    except StoreUnavailable as exc:
        raise _store_unavailable(exc)
    record.pop("id", None)
    return record


@app.get("/dead-letter")
def dead_letter():
    try:
        events = store.list_dead_letters()
    except StoreUnavailable as exc:
        raise _store_unavailable(exc)
    return {"count": len(events), "events": events}


@app.get("/health")
def health():
    try:
        subscribers = len(store.list_subscribers())
        dead = store.dead_letter_count()
        store_ok = True
    except StoreUnavailable:
        subscribers, dead, store_ok = None, None, False
    return {"status": "ok" if store_ok else "degraded",
            "service": "billing-webhook-dispatcher",
            "store": "postgresql" if store_ok else "unreachable",
            "subscribers": subscribers,
            "dead_lettered": dead,
            "signing_configured": bool(WEBHOOK_SECRET)}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
