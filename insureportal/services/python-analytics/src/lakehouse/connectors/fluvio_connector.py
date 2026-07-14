"""
Fluvio → Lakehouse Connector
Consumes all insurance domain topics from Fluvio and writes them as
Parquet files partitioned by date/hour into the S3 lakehouse.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import boto3
import pyarrow as pa
import pyarrow.parquet as pq
import httpx

log = logging.getLogger(__name__)

FLUVIO_HTTP_URL = os.getenv("FLUVIO_HTTP_URL", "http://fluvio-sc:9003")
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://minio:9000")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "minioadmin")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "minioadmin")
S3_BUCKET = os.getenv("S3_BUCKET", "insureportal-lakehouse")

# All Fluvio topics to consume
FLUVIO_TOPICS = [
    "policy-events",
    "claim-events",
    "premium-payments",
    "underwriting-decisions",
    "reinsurance-cessions",
    "compliance-alerts",
    "fraud-signals",
    "kyc-events",
    "agent-activity",
    "settlement-events",
    "tb-ledger-events",
    "temporal-workflow-events",
    "dapr-pubsub-events",
    "waf-security-events",
    "keycloak-auth-events",
    "actuarial-reserve-events",
    "ifrs17-events",
]

# Arrow schemas per topic for type-safe Parquet writes
TOPIC_SCHEMAS: Dict[str, pa.Schema] = {
    "policy-events": pa.schema([
        pa.field("event_id", pa.string()),
        pa.field("event_type", pa.string()),
        pa.field("policy_id", pa.string()),
        pa.field("tenant_id", pa.string()),
        pa.field("policyholder_id", pa.string()),
        pa.field("product_code", pa.string()),
        pa.field("premium_amount", pa.float64()),
        pa.field("currency", pa.string()),
        pa.field("status", pa.string()),
        pa.field("effective_date", pa.string()),
        pa.field("expiry_date", pa.string()),
        pa.field("ts", pa.timestamp("us", tz="UTC")),
    ]),
    "claim-events": pa.schema([
        pa.field("event_id", pa.string()),
        pa.field("event_type", pa.string()),
        pa.field("claim_id", pa.string()),
        pa.field("policy_id", pa.string()),
        pa.field("tenant_id", pa.string()),
        pa.field("claimant_id", pa.string()),
        pa.field("claimed_amount", pa.float64()),
        pa.field("approved_amount", pa.float64()),
        pa.field("currency", pa.string()),
        pa.field("status", pa.string()),
        pa.field("adjuster_id", pa.string()),
        pa.field("ts", pa.timestamp("us", tz="UTC")),
    ]),
    "premium-payments": pa.schema([
        pa.field("event_id", pa.string()),
        pa.field("payment_id", pa.string()),
        pa.field("policy_id", pa.string()),
        pa.field("tenant_id", pa.string()),
        pa.field("amount", pa.float64()),
        pa.field("currency", pa.string()),
        pa.field("payment_method", pa.string()),
        pa.field("status", pa.string()),
        pa.field("ts", pa.timestamp("us", tz="UTC")),
    ]),
    "underwriting-decisions": pa.schema([
        pa.field("event_id", pa.string()),
        pa.field("case_id", pa.string()),
        pa.field("tenant_id", pa.string()),
        pa.field("applicant_id", pa.string()),
        pa.field("decision", pa.string()),
        pa.field("risk_score", pa.float64()),
        pa.field("premium_rate", pa.float64()),
        pa.field("underwriter_id", pa.string()),
        pa.field("ts", pa.timestamp("us", tz="UTC")),
    ]),
    "fraud-signals": pa.schema([
        pa.field("event_id", pa.string()),
        pa.field("entity_type", pa.string()),
        pa.field("entity_id", pa.string()),
        pa.field("tenant_id", pa.string()),
        pa.field("signal_type", pa.string()),
        pa.field("fraud_score", pa.float64()),
        pa.field("model_version", pa.string()),
        pa.field("ts", pa.timestamp("us", tz="UTC")),
    ]),
    "waf-security-events": pa.schema([
        pa.field("event_id", pa.string()),
        pa.field("source_ip", pa.string()),
        pa.field("method", pa.string()),
        pa.field("path", pa.string()),
        pa.field("attack_type", pa.string()),
        pa.field("severity", pa.string()),
        pa.field("blocked", pa.bool_()),
        pa.field("tenant_id", pa.string()),
        pa.field("ts", pa.timestamp("us", tz="UTC")),
    ]),
    "keycloak-auth-events": pa.schema([
        pa.field("event_id", pa.string()),
        pa.field("event_type", pa.string()),
        pa.field("user_id", pa.string()),
        pa.field("tenant_id", pa.string()),
        pa.field("realm", pa.string()),
        pa.field("client_id", pa.string()),
        pa.field("ip_address", pa.string()),
        pa.field("success", pa.bool_()),
        pa.field("ts", pa.timestamp("us", tz="UTC")),
    ]),
    "tb-ledger-events": pa.schema([
        pa.field("event_id", pa.string()),
        pa.field("transfer_id", pa.string()),
        pa.field("debit_account_id", pa.string()),
        pa.field("credit_account_id", pa.string()),
        pa.field("amount", pa.int64()),
        pa.field("currency_code", pa.int32()),
        pa.field("ledger", pa.int32()),
        pa.field("code", pa.int32()),
        pa.field("tenant_id", pa.string()),
        pa.field("ts", pa.timestamp("us", tz="UTC")),
    ]),
}

# Default schema for topics not explicitly defined
DEFAULT_SCHEMA = pa.schema([
    pa.field("event_id", pa.string()),
    pa.field("event_type", pa.string()),
    pa.field("tenant_id", pa.string()),
    pa.field("payload", pa.string()),  # JSON string
    pa.field("ts", pa.timestamp("us", tz="UTC")),
])


def _get_s3():
    try:
        return boto3.client(
            "s3",
            endpoint_url=S3_ENDPOINT,
            aws_access_key_id=S3_ACCESS_KEY,
            aws_secret_access_key=S3_SECRET_KEY,
        )
    except Exception as e:
        log.warning(f"S3 client unavailable: {e}")
        return None


def _normalize_record(topic: str, raw: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a raw Fluvio message to match the topic schema."""
    schema = TOPIC_SCHEMAS.get(topic, DEFAULT_SCHEMA)
    record: Dict[str, Any] = {}
    for field in schema:
        val = raw.get(field.name)
        if val is None:
            if pa.types.is_string(field.type):
                val = ""
            elif pa.types.is_floating(field.type):
                val = 0.0
            elif pa.types.is_integer(field.type):
                val = 0
            elif pa.types.is_boolean(field.type):
                val = False
            elif pa.types.is_timestamp(field.type):
                val = datetime.now(timezone.utc)
        if field.name == "ts" and isinstance(val, str):
            try:
                val = datetime.fromisoformat(val.replace("Z", "+00:00"))
            except Exception:
                val = datetime.now(timezone.utc)
        record[field.name] = val
    return record


def _write_batch_to_s3(topic: str, records: List[Dict[str, Any]], partition_dt: datetime) -> Dict[str, Any]:
    """Write a batch of records as a Parquet file to S3."""
    if not records:
        return {"status": "skip", "rows": 0}
    s3 = _get_s3()
    if not s3:
        return {"status": "no_s3", "rows": 0}

    schema = TOPIC_SCHEMAS.get(topic, DEFAULT_SCHEMA)
    normalized = [_normalize_record(topic, r) for r in records]

    # Build columnar arrays
    arrays = []
    for field in schema:
        col_vals = [r[field.name] for r in normalized]
        arrays.append(pa.array(col_vals, type=field.type))

    table = pa.table(arrays, schema=schema)

    # Partition path: bronze/fluvio/<topic>/year=YYYY/month=MM/day=DD/hour=HH/
    key = (
        f"bronze/fluvio/{topic}/"
        f"year={partition_dt.year:04d}/"
        f"month={partition_dt.month:02d}/"
        f"day={partition_dt.day:02d}/"
        f"hour={partition_dt.hour:02d}/"
        f"batch_{partition_dt.strftime('%Y%m%d_%H%M%S')}.parquet"
    )

    import io
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="snappy")
    buf.seek(0)

    try:
        s3.put_object(Bucket=S3_BUCKET, Key=key, Body=buf.read())
        log.info(f"[Fluvio→Lakehouse] Wrote {len(records)} rows for topic={topic} to s3://{S3_BUCKET}/{key}")
        return {"status": "ok", "rows": len(records), "key": key}
    except Exception as e:
        log.error(f"[Fluvio→Lakehouse] S3 write failed for topic={topic}: {e}")
        return {"status": "error", "error": str(e), "rows": 0}


async def _consume_topic_batch(topic: str, max_records: int = 1000) -> List[Dict[str, Any]]:
    """Consume up to max_records from a Fluvio topic via the HTTP gateway."""
    records = []
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{FLUVIO_HTTP_URL}/topics/{topic}/consume",
                params={"max_records": max_records, "format": "json"},
            )
            if resp.status_code == 200:
                data = resp.json()
                records = data.get("records", [])
                if isinstance(records, list):
                    return [r.get("value", r) if isinstance(r, dict) else json.loads(r) for r in records]
    except Exception as e:
        log.warning(f"[Fluvio] Could not consume topic={topic}: {e}")
    return records


async def ingest_all_topics(batch_size: int = 1000) -> Dict[str, Any]:
    """Consume all Fluvio topics and write to the lakehouse. Called by the cron scheduler."""
    now = datetime.now(timezone.utc)
    results: Dict[str, Any] = {}
    total_rows = 0

    tasks = [_consume_topic_batch(topic, batch_size) for topic in FLUVIO_TOPICS]
    batches = await asyncio.gather(*tasks, return_exceptions=True)

    for topic, batch in zip(FLUVIO_TOPICS, batches):
        if isinstance(batch, Exception):
            results[topic] = {"status": "error", "error": str(batch), "rows": 0}
            continue
        result = _write_batch_to_s3(topic, batch, now)
        results[topic] = result
        total_rows += result.get("rows", 0)

    return {
        "status": "ok",
        "topics_processed": len(FLUVIO_TOPICS),
        "total_rows": total_rows,
        "results": results,
        "completed_at": now.isoformat(),
    }


async def ingest_topic(topic: str, batch_size: int = 1000) -> Dict[str, Any]:
    """Ingest a single Fluvio topic into the lakehouse."""
    now = datetime.now(timezone.utc)
    batch = await _consume_topic_batch(topic, batch_size)
    return _write_batch_to_s3(topic, batch, now)
