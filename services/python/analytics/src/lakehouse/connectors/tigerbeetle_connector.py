"""
TigerBeetle → Lakehouse Connector
Exports ledger accounts and transfer history from the TigerBeetle
sidecar HTTP API into the S3 lakehouse as Parquet files.
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

TB_SIDECAR_URL = os.getenv("TB_SIDECAR_URL", "http://tb-sidecar:8080")
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://minio:9000")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "minioadmin")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "minioadmin")
S3_BUCKET = os.getenv("S3_BUCKET", "insureportal-lakehouse")

# Arrow schemas for TigerBeetle entities
ACCOUNT_SCHEMA = pa.schema([
    pa.field("account_id", pa.string()),
    pa.field("tenant_id", pa.string()),
    pa.field("ledger", pa.int32()),
    pa.field("code", pa.int32()),
    pa.field("debits_pending", pa.int64()),
    pa.field("debits_posted", pa.int64()),
    pa.field("credits_pending", pa.int64()),
    pa.field("credits_posted", pa.int64()),
    pa.field("balance", pa.int64()),
    pa.field("flags", pa.int32()),
    pa.field("timestamp", pa.timestamp("us", tz="UTC")),
    pa.field("exported_at", pa.timestamp("us", tz="UTC")),
])

TRANSFER_SCHEMA = pa.schema([
    pa.field("transfer_id", pa.string()),
    pa.field("debit_account_id", pa.string()),
    pa.field("credit_account_id", pa.string()),
    pa.field("amount", pa.int64()),
    pa.field("currency_code", pa.int32()),
    pa.field("ledger", pa.int32()),
    pa.field("code", pa.int32()),
    pa.field("pending_id", pa.string()),
    pa.field("user_data_128", pa.string()),
    pa.field("user_data_64", pa.int64()),
    pa.field("user_data_32", pa.int32()),
    pa.field("flags", pa.int32()),
    pa.field("timestamp", pa.timestamp("us", tz="UTC")),
    pa.field("tenant_id", pa.string()),
    pa.field("exported_at", pa.timestamp("us", tz="UTC")),
])

BALANCE_HISTORY_SCHEMA = pa.schema([
    pa.field("account_id", pa.string()),
    pa.field("tenant_id", pa.string()),
    pa.field("ledger", pa.int32()),
    pa.field("debits_pending", pa.int64()),
    pa.field("debits_posted", pa.int64()),
    pa.field("credits_pending", pa.int64()),
    pa.field("credits_posted", pa.int64()),
    pa.field("balance", pa.int64()),
    pa.field("snapshot_ts", pa.timestamp("us", tz="UTC")),
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
        log.warning(f"S3 unavailable: {e}")
        return None


def _write_parquet(records: List[Dict], schema: pa.Schema, s3_key: str) -> Dict[str, Any]:
    """Write records to S3 as a Parquet file."""
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
            vals.append(v)
        arrays.append(pa.array(vals, type=field.type))

    table = pa.table(arrays, schema=schema)
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="snappy")
    buf.seek(0)

    try:
        s3.put_object(Bucket=S3_BUCKET, Key=s3_key, Body=buf.read())
        log.info(f"[TB→Lakehouse] Wrote {len(records)} rows → s3://{S3_BUCKET}/{s3_key}")
        return {"status": "ok", "rows": len(records), "key": s3_key}
    except Exception as e:
        log.error(f"[TB→Lakehouse] S3 write failed: {e}")
        return {"status": "error", "error": str(e)}


async def export_accounts(tenant_id: Optional[str] = None) -> Dict[str, Any]:
    """Export all TigerBeetle accounts to the lakehouse."""
    now = datetime.now(timezone.utc)
    params: Dict[str, Any] = {"limit": 10000}
    if tenant_id:
        params["tenant_id"] = tenant_id

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(f"{TB_SIDECAR_URL}/accounts", params=params)
            resp.raise_for_status()
            data = resp.json()
            accounts = data.get("accounts", data if isinstance(data, list) else [])
    except Exception as e:
        log.warning(f"[TB] Could not fetch accounts: {e}")
        accounts = []

    # Enrich with exported_at
    for a in accounts:
        a["exported_at"] = now.isoformat()

    key = (
        f"bronze/tigerbeetle/accounts/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"accounts_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(accounts, ACCOUNT_SCHEMA, key)


async def export_transfers(
    tenant_id: Optional[str] = None,
    since_timestamp: Optional[int] = None,
) -> Dict[str, Any]:
    """Export TigerBeetle transfer history to the lakehouse."""
    now = datetime.now(timezone.utc)
    params: Dict[str, Any] = {"limit": 50000}
    if tenant_id:
        params["tenant_id"] = tenant_id
    if since_timestamp:
        params["since_timestamp"] = since_timestamp

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.get(f"{TB_SIDECAR_URL}/transfers", params=params)
            resp.raise_for_status()
            data = resp.json()
            transfers = data.get("transfers", data if isinstance(data, list) else [])
    except Exception as e:
        log.warning(f"[TB] Could not fetch transfers: {e}")
        transfers = []

    for t in transfers:
        t["exported_at"] = now.isoformat()

    key = (
        f"bronze/tigerbeetle/transfers/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"transfers_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(transfers, TRANSFER_SCHEMA, key)


async def export_balance_history(tenant_id: Optional[str] = None) -> Dict[str, Any]:
    """Snapshot current account balances for time-series analysis."""
    now = datetime.now(timezone.utc)
    params: Dict[str, Any] = {"limit": 10000}
    if tenant_id:
        params["tenant_id"] = tenant_id

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(f"{TB_SIDECAR_URL}/accounts", params=params)
            resp.raise_for_status()
            data = resp.json()
            accounts = data.get("accounts", data if isinstance(data, list) else [])
    except Exception as e:
        log.warning(f"[TB] Could not fetch balance history: {e}")
        accounts = []

    snapshots = []
    for a in accounts:
        snapshots.append({
            "account_id": str(a.get("id", "")),
            "tenant_id": str(a.get("tenant_id", "")),
            "ledger": int(a.get("ledger", 0)),
            "debits_pending": int(a.get("debits_pending", 0)),
            "debits_posted": int(a.get("debits_posted", 0)),
            "credits_pending": int(a.get("credits_pending", 0)),
            "credits_posted": int(a.get("credits_posted", 0)),
            "balance": int(a.get("credits_posted", 0)) - int(a.get("debits_posted", 0)),
            "snapshot_ts": now.isoformat(),
        })

    key = (
        f"silver/tigerbeetle/balance_history/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"balances_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(snapshots, BALANCE_HISTORY_SCHEMA, key)


async def run_full_export(tenant_id: Optional[str] = None) -> Dict[str, Any]:
    """Run all TigerBeetle exports in parallel."""
    import asyncio
    accounts_r, transfers_r, balances_r = await asyncio.gather(
        export_accounts(tenant_id),
        export_transfers(tenant_id),
        export_balance_history(tenant_id),
    )
    total_rows = (
        accounts_r.get("rows", 0)
        + transfers_r.get("rows", 0)
        + balances_r.get("rows", 0)
    )
    return {
        "status": "ok",
        "accounts": accounts_r,
        "transfers": transfers_r,
        "balance_history": balances_r,
        "total_rows": total_rows,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
