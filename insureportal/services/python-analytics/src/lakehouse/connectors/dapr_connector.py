"""
Dapr → Lakehouse Connector
Captures Dapr pub/sub events and state store snapshots from the
Dapr sidecar HTTP API and writes them to the S3 lakehouse.

Two ingestion modes:
  1. Pull mode  – queries the Dapr state store for buffered events
  2. Push mode  – FastAPI endpoint that Dapr calls via pub/sub subscription
"""
from __future__ import annotations

import io
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import boto3
import httpx
import pyarrow as pa
import pyarrow.parquet as pq

log = logging.getLogger(__name__)

DAPR_HTTP_PORT = os.getenv("DAPR_HTTP_PORT", "3500")
DAPR_BASE_URL = f"http://localhost:{DAPR_HTTP_PORT}"
DAPR_PUBSUB_NAME = os.getenv("DAPR_PUBSUB_NAME", "pubsub")
DAPR_STATE_STORE = os.getenv("DAPR_STATE_STORE", "statestore")
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://minio:9000")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "minioadmin")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "minioadmin")
S3_BUCKET = os.getenv("S3_BUCKET", "insureportal-lakehouse")

# Insurance domain Dapr pub/sub topics
INSURANCE_TOPICS = [
    "policy.created",
    "policy.updated",
    "policy.cancelled",
    "policy.renewed",
    "claim.submitted",
    "claim.approved",
    "claim.rejected",
    "claim.paid",
    "premium.collected",
    "premium.overdue",
    "underwriting.decision",
    "fraud.alert",
    "fraud.cleared",
    "kyc.completed",
    "kyc.failed",
    "reinsurance.cession.created",
    "compliance.report.generated",
    "billing.invoice.created",
    "billing.payment.received",
    "actuarial.reserve.updated",
    "ifrs17.measurement.updated",
    "user.login",
    "user.logout",
    "user.role.changed",
    "workflow.started",
    "workflow.completed",
    "workflow.failed",
]

DAPR_EVENT_SCHEMA = pa.schema([
    pa.field("event_id", pa.string()),
    pa.field("topic", pa.string()),
    pa.field("pubsub_name", pa.string()),
    pa.field("source", pa.string()),
    pa.field("event_type", pa.string()),
    pa.field("tenant_id", pa.string()),
    pa.field("correlation_id", pa.string()),
    pa.field("data_json", pa.string()),
    pa.field("spec_version", pa.string()),
    pa.field("data_content_type", pa.string()),
    pa.field("event_time", pa.timestamp("us", tz="UTC")),
    pa.field("exported_at", pa.timestamp("us", tz="UTC")),
])

DAPR_STATE_SCHEMA = pa.schema([
    pa.field("key", pa.string()),
    pa.field("store_name", pa.string()),
    pa.field("tenant_id", pa.string()),
    pa.field("value_json", pa.string()),
    pa.field("etag", pa.string()),
    pa.field("snapshot_ts", pa.timestamp("us", tz="UTC")),
])

# In-memory buffer for push-mode events (populated by FastAPI endpoint)
_event_buffer: List[Dict] = []


def _get_s3():
    try:
        return boto3.client(
            "s3",
            endpoint_url=S3_ENDPOINT,
            aws_access_key_id=S3_ACCESS_KEY,
            aws_secret_access_key=S3_SECRET_KEY,
        )
    except Exception as e:
        log.warning(f"S3 unavailable: {e}")
        return None


def _write_parquet(records: List[Dict], schema: pa.Schema, s3_key: str) -> Dict[str, Any]:
    if not records:
        return {"status": "skip", "rows": 0}
    s3 = _get_s3()
    if not s3:
        return {"status": "no_s3", "rows": 0}

    arrays = []
    for field in schema:
        vals = []
        for r in records:
            v = r.get(field.name)
            if v is None:
                if pa.types.is_string(field.type):
                    v = ""
                elif pa.types.is_integer(field.type):
                    v = 0
                elif pa.types.is_timestamp(field.type):
                    v = datetime.now(timezone.utc)
            if pa.types.is_timestamp(field.type) and isinstance(v, str):
                try:
                    v = datetime.fromisoformat(v.replace("Z", "+00:00"))
                except Exception:
                    v = datetime.now(timezone.utc)
            if pa.types.is_timestamp(field.type) and hasattr(v, "tzinfo") and v.tzinfo is None:
                v = v.replace(tzinfo=timezone.utc)
            vals.append(v)
        arrays.append(pa.array(vals, type=field.type))

    table = pa.table(arrays, schema=schema)
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="snappy")
    buf.seek(0)

    try:
        s3.put_object(Bucket=S3_BUCKET, Key=s3_key, Body=buf.read())
        log.info(f"[Dapr→Lakehouse] Wrote {len(records)} rows → s3://{S3_BUCKET}/{s3_key}")
        return {"status": "ok", "rows": len(records), "key": s3_key}
    except Exception as e:
        log.error(f"[Dapr→Lakehouse] S3 write failed: {e}")
        return {"status": "error", "error": str(e)}


def buffer_event(cloud_event: Dict) -> None:
    """
    Buffer a CloudEvent received via Dapr pub/sub subscription.
    Called from the FastAPI /dapr/subscribe endpoint.
    """
    _event_buffer.append(cloud_event)
    if len(_event_buffer) >= 500:
        flush_event_buffer()


def flush_event_buffer() -> Dict[str, Any]:
    """Flush the in-memory event buffer to the lakehouse."""
    global _event_buffer
    if not _event_buffer:
        return {"status": "skip", "rows": 0}

    now = datetime.now(timezone.utc)
    events = list(_event_buffer)
    _event_buffer = []

    records = []
    for ev in events:
        data = ev.get("data", {})
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception:
                data = {"raw": data}
        records.append({
            "event_id": str(ev.get("id", "")),
            "topic": str(ev.get("topic", "")),
            "pubsub_name": str(ev.get("pubsubname", DAPR_PUBSUB_NAME)),
            "source": str(ev.get("source", "")),
            "event_type": str(ev.get("type", "")),
            "tenant_id": str(data.get("tenantId", data.get("tenant_id", ""))),
            "correlation_id": str(ev.get("traceid", ev.get("correlationid", ""))),
            "data_json": json.dumps(data, default=str),
            "spec_version": str(ev.get("specversion", "1.0")),
            "data_content_type": str(ev.get("datacontenttype", "application/json")),
            "event_time": ev.get("time", now.isoformat()),
            "exported_at": now,
        })

    key = (
        f"bronze/dapr/events/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"events_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(records, DAPR_EVENT_SCHEMA, key)


async def export_state_store_snapshot(
    key_prefixes: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Query the Dapr state store for insurance-domain keys and snapshot
    them to the lakehouse.
    """
    now = datetime.now(timezone.utc)
    if key_prefixes is None:
        key_prefixes = [
            "policy:",
            "claim:",
            "premium:",
            "underwriting:",
            "fraud:",
            "kyc:",
            "workflow:",
        ]

    records: List[Dict] = []
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            for prefix in key_prefixes:
                # Dapr state store bulk get (up to 100 keys per prefix)
                # We use a query API if available, otherwise enumerate known keys
                resp = await client.post(
                    f"{DAPR_BASE_URL}/v1.0-alpha1/state/{DAPR_STATE_STORE}/query",
                    json={
                        "filter": {"EQ": {"key": f"{prefix}*"}},
                        "page": {"limit": 1000},
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    for item in data.get("results", []):
                        key = item.get("key", "")
                        value = item.get("data", {})
                        if isinstance(value, str):
                            try:
                                value = json.loads(value)
                            except Exception:
                                value = {"raw": value}
                        records.append({
                            "key": key,
                            "store_name": DAPR_STATE_STORE,
                            "tenant_id": str(value.get("tenantId", value.get("tenant_id", ""))),
                            "value_json": json.dumps(value, default=str),
                            "etag": str(item.get("etag", "")),
                            "snapshot_ts": now,
                        })
    except Exception as e:
        log.warning(f"[Dapr] Could not query state store: {e}")

    key = (
        f"bronze/dapr/state_store/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"state_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(records, DAPR_STATE_SCHEMA, key)


async def export_pubsub_events_via_pull(
    topics: Optional[List[str]] = None,
    max_per_topic: int = 1000,
) -> Dict[str, Any]:
    """
    Pull pending events from Dapr pub/sub topics using the bulk subscribe
    API and write them to the lakehouse.
    """
    now = datetime.now(timezone.utc)
    if topics is None:
        topics = INSURANCE_TOPICS

    all_records: List[Dict] = []
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            for topic in topics:
                try:
                    resp = await client.post(
                        f"{DAPR_BASE_URL}/v1.0-alpha1/subscribe/bulk",
                        json={
                            "pubsubName": DAPR_PUBSUB_NAME,
                            "topic": topic,
                            "maxMessagesCount": max_per_topic,
                            "maxWaitDurationMs": 1000,
                        },
                    )
                    if resp.status_code != 200:
                        continue
                    data = resp.json()
                    for entry in data.get("entries", []):
                        cloud_event = entry.get("event", {})
                        ev_data = cloud_event.get("data", {})
                        if isinstance(ev_data, str):
                            try:
                                ev_data = json.loads(ev_data)
                            except Exception:
                                ev_data = {"raw": ev_data}
                        all_records.append({
                            "event_id": str(cloud_event.get("id", entry.get("entryId", ""))),
                            "topic": topic,
                            "pubsub_name": DAPR_PUBSUB_NAME,
                            "source": str(cloud_event.get("source", "")),
                            "event_type": str(cloud_event.get("type", "")),
                            "tenant_id": str(ev_data.get("tenantId", ev_data.get("tenant_id", ""))),
                            "correlation_id": str(cloud_event.get("traceid", "")),
                            "data_json": json.dumps(ev_data, default=str),
                            "spec_version": str(cloud_event.get("specversion", "1.0")),
                            "data_content_type": str(cloud_event.get("datacontenttype", "application/json")),
                            "event_time": cloud_event.get("time", now.isoformat()),
                            "exported_at": now,
                        })
                except Exception as e:
                    log.debug(f"[Dapr] Could not pull from topic {topic}: {e}")
    except Exception as e:
        log.warning(f"[Dapr] Pub/sub pull failed: {e}")

    key = (
        f"bronze/dapr/pubsub/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"events_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(all_records, DAPR_EVENT_SCHEMA, key)


async def run_full_export() -> Dict[str, Any]:
    """Run all Dapr exports in parallel."""
    import asyncio
    # Flush any buffered push-mode events first
    buffer_result = flush_event_buffer()
    state_r, pubsub_r = await asyncio.gather(
        export_state_store_snapshot(),
        export_pubsub_events_via_pull(),
    )
    total = (
        buffer_result.get("rows", 0)
        + state_r.get("rows", 0)
        + pubsub_r.get("rows", 0)
    )
    return {
        "status": "ok",
        "buffer_flush": buffer_result,
        "state_store": state_r,
        "pubsub_pull": pubsub_r,
        "total_rows": total,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
