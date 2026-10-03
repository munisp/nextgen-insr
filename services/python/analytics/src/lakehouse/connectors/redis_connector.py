"""
Redis → Lakehouse Connector
Snapshots Redis cache keys (session data, rate-limit counters, KPI
cache, fraud scores) into the S3 lakehouse as Parquet files.
"""
from __future__ import annotations

import io
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import boto3
import pyarrow as pa
import pyarrow.parquet as pq

log = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://minio:9000")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "minioadmin")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "minioadmin")
S3_BUCKET = os.getenv("S3_BUCKET", "insureportal-lakehouse")

SESSION_SCHEMA = pa.schema([
    pa.field("session_key", pa.string()),
    pa.field("user_id", pa.string()),
    pa.field("tenant_id", pa.string()),
    pa.field("role", pa.string()),
    pa.field("ip_address", pa.string()),
    pa.field("created_at", pa.timestamp("us", tz="UTC")),
    pa.field("ttl_seconds", pa.int64()),
    pa.field("snapshot_ts", pa.timestamp("us", tz="UTC")),
])

RATE_LIMIT_SCHEMA = pa.schema([
    pa.field("key", pa.string()),
    pa.field("identifier", pa.string()),
    pa.field("endpoint", pa.string()),
    pa.field("count", pa.int64()),
    pa.field("window_seconds", pa.int64()),
    pa.field("ttl_seconds", pa.int64()),
    pa.field("snapshot_ts", pa.timestamp("us", tz="UTC")),
])

KPI_CACHE_SCHEMA = pa.schema([
    pa.field("cache_key", pa.string()),
    pa.field("tenant_id", pa.string()),
    pa.field("kpi_type", pa.string()),
    pa.field("role", pa.string()),
    pa.field("value_json", pa.string()),
    pa.field("ttl_seconds", pa.int64()),
    pa.field("snapshot_ts", pa.timestamp("us", tz="UTC")),
])

FRAUD_SCORE_SCHEMA = pa.schema([
    pa.field("entity_id", pa.string()),
    pa.field("entity_type", pa.string()),
    pa.field("tenant_id", pa.string()),
    pa.field("fraud_score", pa.float64()),
    pa.field("model_version", pa.string()),
    pa.field("ttl_seconds", pa.int64()),
    pa.field("snapshot_ts", pa.timestamp("us", tz="UTC")),
])

# Redis key patterns to scan
KEY_PATTERNS = {
    "sessions": "session:*",
    "rate_limits": "rl:*",
    "kpi_cache": "kpi:*",
    "fraud_scores": "fraud:score:*",
    "policy_cache": "policy:*",
    "claim_cache": "claim:*",
    "premium_cache": "premium:*",
    "tb_balance_cache": "tb:balance:*",
}


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


def _get_redis():
    try:
        import redis
        r = redis.from_url(REDIS_URL, decode_responses=True, socket_timeout=5)
        r.ping()
        return r
    except Exception as e:
        log.warning(f"Redis unavailable: {e}")
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
                elif pa.types.is_floating(field.type):
                    v = 0.0
                elif pa.types.is_timestamp(field.type):
                    v = datetime.now(timezone.utc)
            if pa.types.is_timestamp(field.type) and isinstance(v, str):
                try:
                    v = datetime.fromisoformat(v.replace("Z", "+00:00"))
                except Exception:
                    v = datetime.now(timezone.utc)
            vals.append(v)
        arrays.append(pa.array(vals, type=field.type))

    table = pa.table(arrays, schema=schema)
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="snappy")
    buf.seek(0)

    try:
        s3.put_object(Bucket=S3_BUCKET, Key=s3_key, Body=buf.read())
        log.info(f"[Redis→Lakehouse] Wrote {len(records)} rows → s3://{S3_BUCKET}/{s3_key}")
        return {"status": "ok", "rows": len(records), "key": s3_key}
    except Exception as e:
        log.error(f"[Redis→Lakehouse] S3 write failed: {e}")
        return {"status": "error", "error": str(e)}


def _scan_keys(r, pattern: str, count: int = 1000) -> List[str]:
    keys = []
    cursor = 0
    while True:
        cursor, batch = r.scan(cursor=cursor, match=pattern, count=count)
        keys.extend(batch)
        if cursor == 0:
            break
    return keys


def export_sessions() -> Dict[str, Any]:
    """Snapshot active session data to the lakehouse."""
    now = datetime.now(timezone.utc)
    r = _get_redis()
    if not r:
        return {"status": "no_redis", "rows": 0}

    keys = _scan_keys(r, KEY_PATTERNS["sessions"])
    records = []
    for key in keys:
        try:
            ttl = r.ttl(key)
            raw = r.get(key)
            if not raw:
                continue
            data = json.loads(raw) if raw.startswith("{") else {"raw": raw}
            records.append({
                "session_key": key,
                "user_id": str(data.get("userId", data.get("user_id", ""))),
                "tenant_id": str(data.get("tenantId", data.get("tenant_id", ""))),
                "role": str(data.get("role", "")),
                "ip_address": str(data.get("ipAddress", data.get("ip_address", ""))),
                "created_at": data.get("createdAt", now.isoformat()),
                "ttl_seconds": max(ttl, 0),
                "snapshot_ts": now,
            })
        except Exception:
            pass

    key = (
        f"bronze/redis/sessions/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"sessions_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(records, SESSION_SCHEMA, key)


def export_rate_limits() -> Dict[str, Any]:
    """Snapshot rate-limit counters to the lakehouse."""
    now = datetime.now(timezone.utc)
    r = _get_redis()
    if not r:
        return {"status": "no_redis", "rows": 0}

    keys = _scan_keys(r, KEY_PATTERNS["rate_limits"])
    records = []
    for key in keys:
        try:
            ttl = r.ttl(key)
            count_raw = r.get(key)
            count = int(count_raw) if count_raw and count_raw.isdigit() else 0
            # Key format: rl:<endpoint>:<identifier>
            parts = key.split(":")
            endpoint = parts[1] if len(parts) > 1 else ""
            identifier = parts[2] if len(parts) > 2 else ""
            records.append({
                "key": key,
                "identifier": identifier,
                "endpoint": endpoint,
                "count": count,
                "window_seconds": 60,
                "ttl_seconds": max(ttl, 0),
                "snapshot_ts": now,
            })
        except Exception:
            pass

    key = (
        f"bronze/redis/rate_limits/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"rate_limits_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(records, RATE_LIMIT_SCHEMA, key)


def export_kpi_cache() -> Dict[str, Any]:
    """Snapshot KPI cache entries to the lakehouse."""
    now = datetime.now(timezone.utc)
    r = _get_redis()
    if not r:
        return {"status": "no_redis", "rows": 0}

    keys = _scan_keys(r, KEY_PATTERNS["kpi_cache"])
    records = []
    for key in keys:
        try:
            ttl = r.ttl(key)
            raw = r.get(key)
            if not raw:
                continue
            # Key format: kpi:<tenant_id>:<role>:<kpi_type>
            parts = key.split(":")
            tenant_id = parts[1] if len(parts) > 1 else ""
            role = parts[2] if len(parts) > 2 else ""
            kpi_type = parts[3] if len(parts) > 3 else ""
            records.append({
                "cache_key": key,
                "tenant_id": tenant_id,
                "kpi_type": kpi_type,
                "role": role,
                "value_json": raw if len(raw) < 10000 else raw[:10000],
                "ttl_seconds": max(ttl, 0),
                "snapshot_ts": now,
            })
        except Exception:
            pass

    key = (
        f"silver/redis/kpi_cache/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"kpi_cache_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(records, KPI_CACHE_SCHEMA, key)


def export_fraud_scores() -> Dict[str, Any]:
    """Snapshot fraud score cache to the lakehouse."""
    now = datetime.now(timezone.utc)
    r = _get_redis()
    if not r:
        return {"status": "no_redis", "rows": 0}

    keys = _scan_keys(r, KEY_PATTERNS["fraud_scores"])
    records = []
    for key in keys:
        try:
            ttl = r.ttl(key)
            raw = r.get(key)
            if not raw:
                continue
            data = json.loads(raw) if raw.startswith("{") else {}
            # Key format: fraud:score:<entity_type>:<entity_id>
            parts = key.split(":")
            entity_type = parts[2] if len(parts) > 2 else ""
            entity_id = parts[3] if len(parts) > 3 else ""
            records.append({
                "entity_id": entity_id,
                "entity_type": entity_type,
                "tenant_id": str(data.get("tenant_id", "")),
                "fraud_score": float(data.get("score", data if isinstance(data, (int, float)) else 0.0)),
                "model_version": str(data.get("model_version", "v1")),
                "ttl_seconds": max(ttl, 0),
                "snapshot_ts": now,
            })
        except Exception:
            pass

    key = (
        f"silver/redis/fraud_scores/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"fraud_scores_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(records, FRAUD_SCORE_SCHEMA, key)


def run_full_export() -> Dict[str, Any]:
    """Run all Redis exports."""
    sessions_r = export_sessions()
    rl_r = export_rate_limits()
    kpi_r = export_kpi_cache()
    fraud_r = export_fraud_scores()
    total = (
        sessions_r.get("rows", 0)
        + rl_r.get("rows", 0)
        + kpi_r.get("rows", 0)
        + fraud_r.get("rows", 0)
    )
    return {
        "status": "ok",
        "sessions": sessions_r,
        "rate_limits": rl_r,
        "kpi_cache": kpi_r,
        "fraud_scores": fraud_r,
        "total_rows": total,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
