"""
PostgreSQL CDC → Lakehouse Connector
Implements Change Data Capture for all insurance-domain tables using
two strategies:
  1. Logical replication via pgoutput (preferred, requires REPLICATION role)
  2. Incremental timestamp-based polling (fallback for tables with updated_at)

All changed rows are written to the bronze/postgres/cdc/ S3 path as
date-partitioned Parquet files.
"""
from __future__ import annotations

import io
import json
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

import boto3
import pyarrow as pa
import pyarrow.parquet as pq

log = logging.getLogger(__name__)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@postgres:5432/insureportal",
)
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://minio:9000")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "minioadmin")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "minioadmin")
S3_BUCKET = os.getenv("S3_BUCKET", "insureportal-lakehouse")

# Replication slot name for logical CDC
REPLICATION_SLOT = "insureportal_lakehouse"
PUBLICATION_NAME = "insureportal_pub"

# Insurance-domain tables with their primary key and timestamp columns
# Format: (table_name, pk_column, updated_at_column)
INSURANCE_TABLES: List[Tuple[str, str, Optional[str]]] = [
    ("policies", "id", "updated_at"),
    ("claims", "id", "updated_at"),
    ("premiums", "id", "updated_at"),
    ("policyholders", "id", "updated_at"),
    ("underwriting_decisions", "id", "updated_at"),
    ("reinsurance_treaties", "id", "updated_at"),
    ("reinsurance_cessions", "id", "updated_at"),
    ("actuarial_reserves", "id", "updated_at"),
    ("ifrs17_measurements", "id", "updated_at"),
    ("fraud_investigations", "id", "updated_at"),
    ("compliance_reports", "id", "updated_at"),
    ("audit_logs", "id", "created_at"),
    ("billing_invoices", "id", "updated_at"),
    ("billing_payments", "id", "updated_at"),
    ("endorsements", "id", "updated_at"),
    ("beneficiaries", "id", "updated_at"),
    ("agents", "id", "updated_at"),
    ("brokers", "id", "updated_at"),
    ("products", "id", "updated_at"),
    ("coverage_items", "id", "updated_at"),
    ("claim_payments", "id", "updated_at"),
    ("policy_documents", "id", "created_at"),
    ("kyc_verifications", "id", "updated_at"),
    ("risk_assessments", "id", "updated_at"),
    ("tenants", "id", "updated_at"),
]

CDC_CHANGE_SCHEMA = pa.schema([
    pa.field("table_name", pa.string()),
    pa.field("operation", pa.string()),   # INSERT / UPDATE / DELETE
    pa.field("pk_value", pa.string()),
    pa.field("tenant_id", pa.string()),
    pa.field("row_data", pa.string()),    # JSON-serialised row
    pa.field("changed_at", pa.timestamp("us", tz="UTC")),
    pa.field("lsn", pa.string()),         # Log Sequence Number (empty for polling)
    pa.field("exported_at", pa.timestamp("us", tz="UTC")),
])

SNAPSHOT_SCHEMA = pa.schema([
    pa.field("table_name", pa.string()),
    pa.field("pk_value", pa.string()),
    pa.field("tenant_id", pa.string()),
    pa.field("row_data", pa.string()),
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


def _get_conn():
    """Return a psycopg2 connection or None."""
    try:
        import psycopg2
        import psycopg2.extras
        conn = psycopg2.connect(DATABASE_URL, connect_timeout=10)
        conn.autocommit = True
        return conn
    except Exception as e:
        log.warning(f"PostgreSQL unavailable: {e}")
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
            if pa.types.is_timestamp(field.type) and isinstance(v, (str,)):
                try:
                    v = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
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
        log.info(f"[PG-CDC→Lakehouse] Wrote {len(records)} rows → s3://{S3_BUCKET}/{s3_key}")
        return {"status": "ok", "rows": len(records), "key": s3_key}
    except Exception as e:
        log.error(f"[PG-CDC→Lakehouse] S3 write failed: {e}")
        return {"status": "error", "error": str(e)}


# ---------------------------------------------------------------------------
# Strategy 1: Logical replication via pgoutput
# ---------------------------------------------------------------------------

def _ensure_publication(conn) -> bool:
    """Create the publication if it does not exist."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM pg_publication WHERE pubname = %s",
                (PUBLICATION_NAME,),
            )
            if not cur.fetchone():
                table_list = ", ".join(t[0] for t in INSURANCE_TABLES)
                cur.execute(
                    f"CREATE PUBLICATION {PUBLICATION_NAME} FOR TABLE {table_list}"
                )
                log.info(f"[PG-CDC] Created publication {PUBLICATION_NAME}")
        return True
    except Exception as e:
        log.warning(f"[PG-CDC] Could not create publication: {e}")
        return False


def _ensure_replication_slot(conn) -> bool:
    """Create the logical replication slot if it does not exist."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM pg_replication_slots WHERE slot_name = %s",
                (REPLICATION_SLOT,),
            )
            if not cur.fetchone():
                cur.execute(
                    "SELECT pg_create_logical_replication_slot(%s, 'pgoutput')",
                    (REPLICATION_SLOT,),
                )
                log.info(f"[PG-CDC] Created replication slot {REPLICATION_SLOT}")
        return True
    except Exception as e:
        log.warning(f"[PG-CDC] Could not create replication slot: {e}")
        return False


def export_via_logical_replication(max_changes: int = 50000) -> Dict[str, Any]:
    """
    Consume pending WAL changes from the logical replication slot and
    write them to the lakehouse.
    """
    now = datetime.now(timezone.utc)
    conn = _get_conn()
    if not conn:
        return {"status": "no_db", "rows": 0}

    try:
        if not _ensure_publication(conn) or not _ensure_replication_slot(conn):
            return export_via_incremental_polling()

        changes: List[Dict] = []
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT lsn, xid, data
                FROM pg_logical_slot_get_changes(
                    %s, NULL, %s,
                    'proto_version', '1',
                    'publication_names', %s
                )
                """,
                (REPLICATION_SLOT, max_changes, PUBLICATION_NAME),
            )
            rows = cur.fetchall()

        for lsn, xid, data_str in rows:
            try:
                data = json.loads(data_str) if data_str else {}
                action = data.get("action", "")
                if action not in ("I", "U", "D"):
                    continue
                op_map = {"I": "INSERT", "U": "UPDATE", "D": "DELETE"}
                table_name = data.get("table", "")
                columns = data.get("columns", [])
                row_dict = {c["name"]: c.get("value") for c in columns}
                pk_val = str(row_dict.get("id", ""))
                tenant_id = str(row_dict.get("tenant_id", ""))
                changed_at = row_dict.get("updated_at") or row_dict.get("created_at") or now
                changes.append({
                    "table_name": table_name,
                    "operation": op_map.get(action, action),
                    "pk_value": pk_val,
                    "tenant_id": tenant_id,
                    "row_data": json.dumps(row_dict, default=str),
                    "changed_at": changed_at,
                    "lsn": str(lsn),
                    "exported_at": now,
                })
            except Exception:
                pass

        key = (
            f"bronze/postgres/cdc/logical/"
            f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
            f"changes_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
        )
        return _write_parquet(changes, CDC_CHANGE_SCHEMA, key)
    except Exception as e:
        log.warning(f"[PG-CDC] Logical replication failed, falling back: {e}")
        return export_via_incremental_polling()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Strategy 2: Incremental timestamp-based polling (fallback)
# ---------------------------------------------------------------------------

def _get_last_watermark(table_name: str) -> datetime:
    """
    Retrieve the last exported watermark for a table.
    In production this would be stored in a metadata table; here we use
    a 24-hour lookback as a safe default.
    """
    return datetime.now(timezone.utc) - timedelta(hours=24)


def export_via_incremental_polling(
    since_hours: int = 24,
    batch_size: int = 5000,
) -> Dict[str, Any]:
    """
    Poll each insurance table for rows modified since the last watermark
    and write them to the lakehouse.
    """
    now = datetime.now(timezone.utc)
    conn = _get_conn()
    if not conn:
        return {"status": "no_db", "rows": 0}

    all_changes: List[Dict] = []
    try:
        import psycopg2.extras
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            for table_name, pk_col, ts_col in INSURANCE_TABLES:
                if not ts_col:
                    continue
                since = now - timedelta(hours=since_hours)
                try:
                    cur.execute(
                        f"""
                        SELECT *
                        FROM {table_name}
                        WHERE {ts_col} >= %s
                        ORDER BY {ts_col} ASC
                        LIMIT %s
                        """,
                        (since, batch_size),
                    )
                    rows = cur.fetchall()
                    for row in rows:
                        row_dict = dict(row)
                        pk_val = str(row_dict.get(pk_col, ""))
                        tenant_id = str(row_dict.get("tenant_id", ""))
                        changed_at = row_dict.get(ts_col) or now
                        all_changes.append({
                            "table_name": table_name,
                            "operation": "UPSERT",
                            "pk_value": pk_val,
                            "tenant_id": tenant_id,
                            "row_data": json.dumps(row_dict, default=str),
                            "changed_at": changed_at,
                            "lsn": "",
                            "exported_at": now,
                        })
                except Exception as e:
                    log.warning(f"[PG-CDC] Could not poll {table_name}: {e}")
    except Exception as e:
        log.error(f"[PG-CDC] Polling failed: {e}")
    finally:
        conn.close()

    key = (
        f"bronze/postgres/cdc/polling/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"changes_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(all_changes, CDC_CHANGE_SCHEMA, key)


def export_full_snapshot(table_name: str) -> Dict[str, Any]:
    """
    Export a full snapshot of a single table to the silver layer.
    Used for initial backfill or reconciliation.
    """
    now = datetime.now(timezone.utc)
    conn = _get_conn()
    if not conn:
        return {"status": "no_db", "rows": 0}

    records: List[Dict] = []
    try:
        import psycopg2.extras
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(f"SELECT * FROM {table_name} LIMIT 100000")
            rows = cur.fetchall()
            for row in rows:
                row_dict = dict(row)
                records.append({
                    "table_name": table_name,
                    "pk_value": str(row_dict.get("id", "")),
                    "tenant_id": str(row_dict.get("tenant_id", "")),
                    "row_data": json.dumps(row_dict, default=str),
                    "snapshot_ts": now,
                })
    except Exception as e:
        log.error(f"[PG-CDC] Full snapshot of {table_name} failed: {e}")
    finally:
        conn.close()

    key = (
        f"silver/postgres/snapshots/{table_name}/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"snapshot_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(records, SNAPSHOT_SCHEMA, key)


def run_full_export(use_logical_replication: bool = True) -> Dict[str, Any]:
    """
    Run the full PostgreSQL CDC export.
    Tries logical replication first; falls back to incremental polling.
    """
    if use_logical_replication:
        result = export_via_logical_replication()
    else:
        result = export_via_incremental_polling()

    return {
        "status": result.get("status", "ok"),
        "cdc": result,
        "total_rows": result.get("rows", 0),
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
