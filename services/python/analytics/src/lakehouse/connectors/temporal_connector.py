"""
Temporal → Lakehouse Connector
Exports workflow execution history, activity results, and workflow
metrics from the Temporal HTTP API into the S3 lakehouse.
"""
from __future__ import annotations

import io
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import boto3
import httpx
import pyarrow as pa
import pyarrow.parquet as pq

log = logging.getLogger(__name__)

TEMPORAL_HOST = os.getenv("TEMPORAL_HOST", "temporal:7233")
TEMPORAL_HTTP_URL = os.getenv("TEMPORAL_HTTP_URL", "http://temporal-ui:8080")
TEMPORAL_NAMESPACE = os.getenv("TEMPORAL_NAMESPACE", "insureportal")
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://minio:9000")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "minioadmin")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "minioadmin")
S3_BUCKET = os.getenv("S3_BUCKET", "insureportal-lakehouse")

WORKFLOW_EXECUTION_SCHEMA = pa.schema([
    pa.field("workflow_id", pa.string()),
    pa.field("run_id", pa.string()),
    pa.field("workflow_type", pa.string()),
    pa.field("namespace", pa.string()),
    pa.field("tenant_id", pa.string()),
    pa.field("status", pa.string()),
    pa.field("start_time", pa.timestamp("us", tz="UTC")),
    pa.field("close_time", pa.timestamp("us", tz="UTC")),
    pa.field("execution_time_ms", pa.int64()),
    pa.field("task_queue", pa.string()),
    pa.field("history_length", pa.int64()),
    pa.field("exported_at", pa.timestamp("us", tz="UTC")),
])

WORKFLOW_METRICS_SCHEMA = pa.schema([
    pa.field("workflow_type", pa.string()),
    pa.field("namespace", pa.string()),
    pa.field("tenant_id", pa.string()),
    pa.field("total_executions", pa.int64()),
    pa.field("completed", pa.int64()),
    pa.field("failed", pa.int64()),
    pa.field("timed_out", pa.int64()),
    pa.field("cancelled", pa.int64()),
    pa.field("running", pa.int64()),
    pa.field("avg_execution_time_ms", pa.float64()),
    pa.field("p95_execution_time_ms", pa.float64()),
    pa.field("p99_execution_time_ms", pa.float64()),
    pa.field("snapshot_date", pa.string()),
    pa.field("exported_at", pa.timestamp("us", tz="UTC")),
])

# Insurance-specific Temporal workflow types
INSURANCE_WORKFLOW_TYPES = [
    "PolicyIssuanceWorkflow",
    "ClaimsAdjudicationWorkflow",
    "PremiumCollectionWorkflow",
    "UnderwritingWorkflow",
    "ReinsuranceCessionWorkflow",
    "PolicyRenewalWorkflow",
    "KycVerificationWorkflow",
    "FraudInvestigationWorkflow",
    "SettlementWorkflow",
    "ComplianceReportingWorkflow",
    "ActuarialReserveWorkflow",
    "Ifrs17CalculationWorkflow",
]


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
        log.info(f"[Temporal→Lakehouse] Wrote {len(records)} rows → s3://{S3_BUCKET}/{s3_key}")
        return {"status": "ok", "rows": len(records), "key": s3_key}
    except Exception as e:
        log.error(f"[Temporal→Lakehouse] S3 write failed: {e}")
        return {"status": "error", "error": str(e)}


async def export_workflow_executions(
    workflow_type: Optional[str] = None,
    since_hours: int = 24,
    max_executions: int = 10000,
) -> Dict[str, Any]:
    """Export workflow execution history from Temporal to the lakehouse."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=since_hours)
    executions: List[Dict] = []

    query = f"StartTime >= '{since.isoformat()}'"
    if workflow_type:
        query += f" AND WorkflowType = '{workflow_type}'"

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            next_page_token = None
            while len(executions) < max_executions:
                params: Dict[str, Any] = {
                    "query": query,
                    "pageSize": min(1000, max_executions - len(executions)),
                }
                if next_page_token:
                    params["nextPageToken"] = next_page_token

                resp = await client.get(
                    f"{TEMPORAL_HTTP_URL}/api/v1/namespaces/{TEMPORAL_NAMESPACE}/workflows",
                    params=params,
                )
                if resp.status_code != 200:
                    break

                data = resp.json()
                batch = data.get("executions", [])
                for wf in batch:
                    exec_info = wf.get("execution", {})
                    start_time_str = wf.get("startTime", "")
                    close_time_str = wf.get("closeTime", "")
                    start_dt = None
                    close_dt = None
                    exec_ms = 0
                    try:
                        start_dt = datetime.fromisoformat(start_time_str.replace("Z", "+00:00"))
                    except Exception:
                        start_dt = now
                    try:
                        close_dt = datetime.fromisoformat(close_time_str.replace("Z", "+00:00"))
                        exec_ms = int((close_dt - start_dt).total_seconds() * 1000)
                    except Exception:
                        close_dt = now

                    # Extract tenant_id from workflow memo or search attributes
                    memo = wf.get("memo", {}).get("fields", {})
                    search_attrs = wf.get("searchAttributes", {}).get("indexedFields", {})
                    tenant_id = (
                        memo.get("tenant_id", {}).get("data", "")
                        or search_attrs.get("TenantId", {}).get("data", "")
                        or ""
                    )

                    executions.append({
                        "workflow_id": exec_info.get("workflowId", ""),
                        "run_id": exec_info.get("runId", ""),
                        "workflow_type": wf.get("type", {}).get("name", ""),
                        "namespace": TEMPORAL_NAMESPACE,
                        "tenant_id": tenant_id,
                        "status": str(wf.get("status", "")),
                        "start_time": start_dt,
                        "close_time": close_dt,
                        "execution_time_ms": exec_ms,
                        "task_queue": wf.get("taskQueue", ""),
                        "history_length": int(wf.get("historyLength", 0)),
                        "exported_at": now,
                    })

                next_page_token = data.get("nextPageToken")
                if not next_page_token or not batch:
                    break
    except Exception as e:
        log.warning(f"[Temporal] Could not fetch executions: {e}")

    label = workflow_type or "all"
    key = (
        f"bronze/temporal/executions/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"executions_{label}_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(executions, WORKFLOW_EXECUTION_SCHEMA, key)


async def export_workflow_metrics() -> Dict[str, Any]:
    """Aggregate per-workflow-type metrics and write to the silver layer."""
    now = datetime.now(timezone.utc)
    metrics: List[Dict] = []

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            for wf_type in INSURANCE_WORKFLOW_TYPES:
                resp = await client.get(
                    f"{TEMPORAL_HTTP_URL}/api/v1/namespaces/{TEMPORAL_NAMESPACE}/workflows",
                    params={"query": f"WorkflowType = '{wf_type}'", "pageSize": 1000},
                )
                if resp.status_code != 200:
                    continue
                data = resp.json()
                execs = data.get("executions", [])

                total = len(execs)
                completed = sum(1 for e in execs if "COMPLETED" in str(e.get("status", "")))
                failed = sum(1 for e in execs if "FAILED" in str(e.get("status", "")))
                timed_out = sum(1 for e in execs if "TIMED_OUT" in str(e.get("status", "")))
                cancelled = sum(1 for e in execs if "CANCELED" in str(e.get("status", "")))
                running = sum(1 for e in execs if "RUNNING" in str(e.get("status", "")))

                exec_times = []
                for e in execs:
                    try:
                        start = datetime.fromisoformat(e.get("startTime", "").replace("Z", "+00:00"))
                        close = datetime.fromisoformat(e.get("closeTime", "").replace("Z", "+00:00"))
                        exec_times.append((close - start).total_seconds() * 1000)
                    except Exception:
                        pass

                exec_times.sort()
                n = len(exec_times)
                avg_ms = sum(exec_times) / n if n > 0 else 0.0
                p95_ms = exec_times[int(n * 0.95)] if n > 0 else 0.0
                p99_ms = exec_times[int(n * 0.99)] if n > 0 else 0.0

                metrics.append({
                    "workflow_type": wf_type,
                    "namespace": TEMPORAL_NAMESPACE,
                    "tenant_id": "",
                    "total_executions": total,
                    "completed": completed,
                    "failed": failed,
                    "timed_out": timed_out,
                    "cancelled": cancelled,
                    "running": running,
                    "avg_execution_time_ms": avg_ms,
                    "p95_execution_time_ms": p95_ms,
                    "p99_execution_time_ms": p99_ms,
                    "snapshot_date": now.strftime("%Y-%m-%d"),
                    "exported_at": now,
                })
    except Exception as e:
        log.warning(f"[Temporal] Could not compute metrics: {e}")

    key = (
        f"silver/temporal/workflow_metrics/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"metrics_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(metrics, WORKFLOW_METRICS_SCHEMA, key)


async def run_full_export(since_hours: int = 24) -> Dict[str, Any]:
    """Run all Temporal exports in parallel."""
    import asyncio
    tasks = [export_workflow_executions(since_hours=since_hours), export_workflow_metrics()]
    executions_r, metrics_r = await asyncio.gather(*tasks)
    return {
        "status": "ok",
        "executions": executions_r,
        "metrics": metrics_r,
        "total_rows": executions_r.get("rows", 0) + metrics_r.get("rows", 0),
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
