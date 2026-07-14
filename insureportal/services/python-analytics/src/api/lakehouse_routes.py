"""
Lakehouse ETL API Routes
========================
FastAPI endpoints for triggering lakehouse sync operations, querying
connector health, and browsing the data catalog.

Role-gating is enforced at the APISIX gateway level; these routes
assume the caller has already been authorised.

Endpoints:
  POST /lakehouse/sync/all           – Full pipeline (all 8 connectors)
  POST /lakehouse/sync/postgres      – PostgreSQL CDC
  POST /lakehouse/sync/fluvio        – Fluvio stream ingestion
  POST /lakehouse/sync/tigerbeetle   – TigerBeetle ledger export
  POST /lakehouse/sync/temporal      – Temporal workflow history
  POST /lakehouse/sync/redis         – Redis cache snapshot
  POST /lakehouse/sync/dapr          – Dapr pub/sub events
  POST /lakehouse/sync/keycloak      – Keycloak auth events
  POST /lakehouse/sync/openappsec    – OpenAppSec WAF events
  GET  /lakehouse/status             – Connector health check
  GET  /lakehouse/catalog            – Data catalog (all datasets)
  GET  /lakehouse/snapshots          – List Parquet files in a prefix
  POST /lakehouse/export/{table}     – Legacy: PostgreSQL full-table snapshot
  POST /lakehouse/export/full        – Legacy: all tables snapshot
  POST /lakehouse/dapr/event         – Dapr push-mode event receiver
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Body, Query, Request
from pydantic import BaseModel

from src.lakehouse.etl import LakehouseETL

log = logging.getLogger(__name__)
router = APIRouter()
etl = LakehouseETL()


# ── Request / Response models ──────────────────────────────────────────────────

class SyncRequest(BaseModel):
    tenant_id: Optional[str] = None
    since_hours: int = 24
    include_snapshot: bool = False


class SyncResponse(BaseModel):
    status: str
    total_rows: int
    duration_seconds: float
    completed_at: str
    details: Dict[str, Any] = {}


# ── Health ─────────────────────────────────────────────────────────────────────

@router.get("/health")
def health():
    return {"status": etl.health()}


@router.get("/status")
async def connector_status():
    """
    Return a health summary for all 8 connectors by attempting lightweight
    connectivity checks.
    """
    import os, httpx

    checks: Dict[str, str] = {}

    async def _check(name: str, url: str, path: str = "/"):
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                resp = await client.get(url + path)
                checks[name] = "ok" if resp.status_code < 500 else f"http_{resp.status_code}"
        except Exception as e:
            checks[name] = f"unreachable: {str(e)[:60]}"

    await asyncio.gather(
        _check("postgres", os.getenv("DATABASE_URL", ""), ""),
        _check("fluvio", os.getenv("FLUVIO_HTTP_URL", "http://fluvio-sc:9003"), "/topics"),
        _check("tigerbeetle", os.getenv("TB_SIDECAR_URL", "http://tb-sidecar:8080"), "/health"),
        _check("temporal", os.getenv("TEMPORAL_HTTP_URL", "http://temporal-ui:8080"), "/"),
        _check("redis", os.getenv("REDIS_URL", "http://redis:6379"), ""),
        _check("dapr", f"http://localhost:{os.getenv('DAPR_HTTP_PORT', '3500')}", "/v1.0/healthz"),
        _check("keycloak", os.getenv("KEYCLOAK_URL", "http://keycloak:8080"), "/health"),
        _check("openappsec", os.getenv("OPENAPPSEC_API_URL", "http://openappsec-agent:8090"), "/"),
        return_exceptions=True,
    )

    # Redis check via redis-py
    try:
        import redis as redis_lib
        r = redis_lib.from_url(os.getenv("REDIS_URL", "redis://redis:6379"), socket_timeout=2)
        r.ping()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"unreachable: {str(e)[:60]}"

    all_ok = all(v == "ok" for v in checks.values())
    return {
        "status": "ok" if all_ok else "degraded",
        "connectors": checks,
    }


# ── Full pipeline ──────────────────────────────────────────────────────────────

@router.post("/sync/all")
async def sync_all(req: SyncRequest = Body(default=SyncRequest())):
    """Trigger a full lakehouse sync across all 8 service connectors."""
    result = await etl.run_full_pipeline(
        include_postgres_snapshot=req.include_snapshot,
        tenant_id=req.tenant_id,
    )
    return result


# ── Per-connector sync endpoints ───────────────────────────────────────────────

@router.post("/sync/postgres")
async def sync_postgres(req: SyncRequest = Body(default=SyncRequest())):
    """Run PostgreSQL CDC (logical replication with polling fallback)."""
    return await etl.run_postgres_cdc()


@router.post("/sync/fluvio")
async def sync_fluvio(req: SyncRequest = Body(default=SyncRequest())):
    """Ingest all Fluvio insurance topics into the lakehouse."""
    return await etl.run_fluvio_ingestion()


@router.post("/sync/tigerbeetle")
async def sync_tigerbeetle(req: SyncRequest = Body(default=SyncRequest())):
    """Export TigerBeetle ledger accounts, transfers, and balance history."""
    return await etl.run_tigerbeetle_export()


@router.post("/sync/temporal")
async def sync_temporal(req: SyncRequest = Body(default=SyncRequest())):
    """Export Temporal workflow execution history and metrics."""
    return await etl.run_temporal_export()


@router.post("/sync/redis")
async def sync_redis(req: SyncRequest = Body(default=SyncRequest())):
    """Snapshot Redis sessions, rate limits, KPI cache, and fraud scores."""
    return await etl.run_redis_export()


@router.post("/sync/dapr")
async def sync_dapr(req: SyncRequest = Body(default=SyncRequest())):
    """Export Dapr pub/sub events and state store snapshots."""
    return await etl.run_dapr_export()


@router.post("/sync/keycloak")
async def sync_keycloak(req: SyncRequest = Body(default=SyncRequest())):
    """Export Keycloak auth events, admin events, users, and sessions."""
    return await etl.run_keycloak_export()


@router.post("/sync/openappsec")
async def sync_openappsec(req: SyncRequest = Body(default=SyncRequest())):
    """Export OpenAppSec WAF attack events and security metrics."""
    return await etl.run_openappsec_export()


# ── Data catalog & discovery ───────────────────────────────────────────────────

@router.get("/catalog")
def get_catalog():
    """Return the full data catalog of available datasets in the lakehouse."""
    return etl.get_data_catalog()


@router.get("/snapshots")
def list_snapshots(prefix: str = Query("bronze/")):
    """List Parquet files in the lakehouse under the given S3 prefix."""
    return {"snapshots": etl.list_snapshots(prefix)}


# ── Dapr push-mode event receiver ─────────────────────────────────────────────

@router.post("/dapr/event")
async def receive_dapr_event(
    request: Request,
    background_tasks: BackgroundTasks,
):
    """
    Dapr pub/sub subscription endpoint.
    Dapr calls this endpoint for each message on subscribed topics.
    The event is buffered in memory and flushed to S3 in the background.
    """
    try:
        from src.lakehouse.connectors.dapr_connector import buffer_event
        body = await request.json()
        buffer_event(body)
        # Return SUCCESS to Dapr so it does not redeliver
        return {"status": "SUCCESS"}
    except Exception as e:
        log.error(f"[Dapr push] Failed to buffer event: {e}")
        return {"status": "RETRY"}


@router.get("/dapr/subscribe")
def dapr_subscribe():
    """
    Dapr subscription manifest endpoint.
    Dapr calls GET /dapr/subscribe to discover which topics this app subscribes to.
    """
    import os
    pubsub_name = os.getenv("DAPR_PUBSUB_NAME", "pubsub")
    topics = [
        "policy.created", "policy.updated", "policy.cancelled",
        "claim.submitted", "claim.approved", "claim.rejected",
        "premium.collected", "fraud.alert", "kyc.completed",
        "workflow.completed", "workflow.failed",
    ]
    return [
        {
            "pubsubname": pubsub_name,
            "topic": topic,
            "route": "/lakehouse/dapr/event",
        }
        for topic in topics
    ]


# ── Legacy endpoints (backward compatibility) ──────────────────────────────────

@router.post("/export/{table_name}")
def export_table(table_name: str, tenant_id: Optional[str] = None):
    """Legacy: export a single PostgreSQL table as a full snapshot."""
    return etl.export_table(table_name, tenant_id=tenant_id)


@router.post("/export/full")
def full_export(tenant_id: Optional[str] = None):
    """Legacy: export all insurance tables as full snapshots."""
    return etl.run_postgres_snapshot(tenant_id=tenant_id)
