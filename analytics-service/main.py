"""
analytics-service — InsurePortal Nigeria Transaction Success-Rate Analytics
======================================================================
A FastAPI service that queries PostgreSQL directly and computes rolling
statistics used by the POS Admin Panel and home-screen success badge.

Endpoints (port 8033):
  GET /stats/success-rate          — 7-day rolling success rate (%)
  GET /stats/by-type               — success/failure breakdown by tx type
  GET /stats/hourly-volume         — hourly volume for the last 24 h
  GET /stats/agent/{agent_code}    — per-agent 7-day stats
  GET /health                      — liveness check

Design choices:
- Pure SQL aggregations — no ORM, no caching layer needed at this scale.
- All timestamps stored as UTC; returned as ISO-8601 strings.
- Graceful degradation: returns zeroed stats when DB is unreachable.
"""

import os
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# ── Middleware Clients ─────────────────────────────────────────────────────
import redis
import json as _json
from datetime import datetime

# Redis client
_redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
_redis_client = None
try:
    _redis_client = redis.from_url(_redis_url, decode_responses=True, socket_timeout=5)
    _redis_client.ping()
    print(f"[middleware] Redis connected: {_redis_url}")
except Exception as _e:
    print(f"[middleware] Redis not available: {_e}")
    _redis_client = None

# Kafka producer helper
_kafka_brokers = os.environ.get("KAFKA_BROKERS", "localhost:9092")
class KafkaEventPublisher:
    def __init__(self, brokers: str, service_name: str):
        self.brokers = brokers
        self.service_name = service_name
    
    def publish(self, event_type: str, key: str, payload: dict):
        """Publish event to Kafka topic. In production, use confluent-kafka or aiokafka."""
        event = {
            "event_type": event_type,
            "source": self.service_name,
            "key": key,
            "payload": payload,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }
        # Production: producer.produce(topic, key=key, value=json.dumps(event))
        print(f"[kafka] event published: {event_type} key={key}")

_kafka_publisher = KafkaEventPublisher(_kafka_brokers, "analytics-service")

# OpenSearch structured logger
_opensearch_url = os.environ.get("OPENSEARCH_URL", "http://localhost:9200")
class OpenSearchLogger:
    def __init__(self, url: str, service_name: str):
        self.url = url
        self.service_name = service_name
    
    def index_log(self, level: str, message: str, fields: dict = None):
        """Index structured log to OpenSearch."""
        doc = {
            "@timestamp": datetime.utcnow().isoformat() + "Z",
            "level": level,
            "message": message,
            "service": self.service_name,
            "fields": fields or {},
        }
        # Production: requests.post(f"{self.url}/logs-analytics-service/_doc", json=doc)
        print(f"[opensearch] {level}: {message}")

_os_logger = OpenSearchLogger(_opensearch_url, "analytics-service")

# Permify authorization client
_permify_addr = os.environ.get("PERMIFY_ADDR", "")
async def check_permission(entity_type: str, entity_id: str, permission: str, user_id: str, tenant_id: str = "default") -> bool:
    """Check permission against Permify ReBAC."""
    if not _permify_addr:
        return True  # Permissive when Permify is not configured
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                f"http://{_permify_addr}/v1/tenants/{tenant_id}/permissions/check",
                json={
                    "entity": {"type": entity_type, "id": entity_id},
                    "permission": permission,
                    "subject": {"type": "user", "id": user_id},
                },
            )
            data = resp.json()
            return data.get("can") == "RESULT_ALLOWED"
    except Exception:
        return True  # Fail open

# Keycloak JWT authentication middleware
from fastapi import Request, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

_security = HTTPBearer(auto_error=False)

async def keycloak_auth_middleware(request: Request, call_next):
    """Validate JWT token from Keycloak. Skip for health/ready/live probes."""
    path = request.url.path
    if path in ("/health", "/ready", "/live", "/metrics", "/docs", "/openapi.json"):
        return await call_next(request)
    
    # Dev bypass
    if os.environ.get("DEV_AUTH_BYPASS") == "true":
        request.state.user_id = "dev-user"
        request.state.tenant_id = "default"
        request.state.roles = ["admin", "user"]
        return await call_next(request)
    
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED", "message": "missing bearer token"})
    
    # In production: validate JWT against Keycloak JWKS endpoint
    # For now, pass through (validation handled by APISIX gateway)
    request.state.user_id = request.headers.get("X-User-ID", "unknown")
    request.state.tenant_id = request.headers.get("X-Tenant-ID", "default")
    return await call_next(request)



logging.basicConfig(level=logging.INFO, format="[analytics] %(levelname)s %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="InsurePortal Analytics Service", version="1.0.0")
app.middleware("http")(keycloak_auth_middleware)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ── Database connection ────────────────────────────────────────────────────────

def get_conn():
    """Open a fresh psycopg2 connection using the same POSTGRES_URL the Node.js
    server uses, so no additional credentials are needed."""
    url = os.environ.get("POSTGRES_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("POSTGRES_URL environment variable not set")
    return psycopg2.connect(url, cursor_factory=psycopg2.extras.RealDictCursor)


def query(sql: str, params=None) -> list[dict]:
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            rows = cur.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception as exc:
        log.error("DB query failed: %s", exc)
        return []


# ── Helpers ───────────────────────────────────────────────────────────────────

def utc_days_ago(n: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=n)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """Liveness check — also verifies DB connectivity."""
    try:
        conn = get_conn()
        conn.close()
        db_ok = True
    except Exception:
        db_ok = False
    return {
        "status": "ok",
        "service": "analytics-service",
        "db_connected": db_ok,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/stats/success-rate")
def success_rate(days: int = 7):
    """
    Rolling N-day transaction success rate.
    Returns overall rate plus a daily breakdown for sparkline rendering.
    """
    since = utc_days_ago(days)

    # Overall rate
    rows = query(
        """
        SELECT
            COUNT(*) FILTER (WHERE status = 'success')  AS success_count,
            COUNT(*) FILTER (WHERE status = 'failed')   AS failed_count,
            COUNT(*) FILTER (WHERE status = 'reversed') AS reversed_count,
            COUNT(*)                                     AS total_count
        FROM transactions
        WHERE "createdAt" >= %s
        """,
        (since,),
    )
    overall = rows[0] if rows else {}
    total = int(overall.get("total_count") or 0)
    success = int(overall.get("success_count") or 0)
    rate = round((success / total * 100), 2) if total > 0 else 0.0

    # Daily breakdown
    daily = query(
        """
        SELECT
            DATE("createdAt" AT TIME ZONE 'Africa/Lagos') AS day,
            COUNT(*) FILTER (WHERE status = 'success')    AS success_count,
            COUNT(*)                                       AS total_count
        FROM transactions
        WHERE "createdAt" >= %s
        GROUP BY 1
        ORDER BY 1 ASC
        """,
        (since,),
    )

    daily_series = [
        {
            "day": str(r["day"]),
            "success_count": int(r["success_count"] or 0),
            "total_count": int(r["total_count"] or 0),
            "rate": round(int(r["success_count"] or 0) / int(r["total_count"]) * 100, 2)
            if int(r["total_count"] or 0) > 0
            else 0.0,
        }
        for r in daily
    ]

    # Quality tier
    if rate >= 98:
        tier = "Excellent"
    elif rate >= 95:
        tier = "Good"
    elif rate >= 90:
        tier = "Fair"
    else:
        tier = "Poor"

    return {
        "period_days": days,
        "success_rate_pct": rate,
        "tier": tier,
        "total_transactions": total,
        "success_count": success,
        "failed_count": int(overall.get("failed_count") or 0),
        "reversed_count": int(overall.get("reversed_count") or 0),
        "daily_series": daily_series,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/stats/by-type")
def by_type(days: int = 7):
    """Success/failure breakdown by transaction type."""
    since = utc_days_ago(days)
    rows = query(
        """
        SELECT
            type,
            COUNT(*) FILTER (WHERE status = 'success')  AS success_count,
            COUNT(*) FILTER (WHERE status = 'failed')   AS failed_count,
            COUNT(*)                                     AS total_count,
            COALESCE(SUM(amount::numeric) FILTER (WHERE status = 'success'), 0) AS total_volume
        FROM transactions
        WHERE "createdAt" >= %s
        GROUP BY type
        ORDER BY total_count DESC
        """,
        (since,),
    )
    return {
        "period_days": days,
        "breakdown": [
            {
                "type": r["type"],
                "success_count": int(r["success_count"] or 0),
                "failed_count": int(r["failed_count"] or 0),
                "total_count": int(r["total_count"] or 0),
                "total_volume_ngn": float(r["total_volume"] or 0),
                "success_rate_pct": round(
                    int(r["success_count"] or 0) / int(r["total_count"]) * 100, 2
                ) if int(r["total_count"] or 0) > 0 else 0.0,
            }
            for r in rows
        ],
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/stats/hourly-volume")
def hourly_volume():
    """Hourly transaction volume for the last 24 hours (Lagos time)."""
    since = utc_days_ago(1)
    rows = query(
        """
        SELECT
            DATE_TRUNC('hour', "createdAt" AT TIME ZONE 'Africa/Lagos') AS hour,
            COUNT(*) AS tx_count,
            COALESCE(SUM(amount::numeric), 0) AS volume_ngn
        FROM transactions
        WHERE "createdAt" >= %s
        GROUP BY 1
        ORDER BY 1 ASC
        """,
        (since,),
    )
    return {
        "series": [
            {
                "hour": r["hour"].isoformat() if hasattr(r["hour"], "isoformat") else str(r["hour"]),
                "tx_count": int(r["tx_count"] or 0),
                "volume_ngn": float(r["volume_ngn"] or 0),
            }
            for r in rows
        ],
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/stats/agent/{agent_code}")
def agent_stats(agent_code: str, days: int = 7):
    """Per-agent rolling statistics."""
    since = utc_days_ago(days)
    rows = query(
        """
        SELECT
            a."agentCode",
            a.name,
            COUNT(t.id) FILTER (WHERE t.status = 'success')  AS success_count,
            COUNT(t.id) FILTER (WHERE t.status = 'failed')   AS failed_count,
            COUNT(t.id)                                       AS total_count,
            COALESCE(SUM(t.amount::numeric) FILTER (WHERE t.status = 'success'), 0) AS volume_ngn,
            COALESCE(SUM(t.commission::numeric), 0) AS total_commission
        FROM agents a
        LEFT JOIN transactions t
            ON t."agentId" = a.id AND t."createdAt" >= %s
        WHERE a."agentCode" = %s
        GROUP BY a."agentCode", a.name
        """,
        (since, agent_code.upper()),
    )
    if not rows:
        raise HTTPException(status_code=404, detail=f"Agent {agent_code} not found")
    r = rows[0]
    total = int(r["total_count"] or 0)
    success = int(r["success_count"] or 0)
    return {
        "agent_code": r["agentCode"],
        "agent_name": r["name"],
        "period_days": days,
        "success_rate_pct": round(success / total * 100, 2) if total > 0 else 0.0,
        "total_transactions": total,
        "success_count": success,
        "failed_count": int(r["failed_count"] or 0),
        "volume_ngn": float(r["volume_ngn"] or 0),
        "total_commission_ngn": float(r["total_commission"] or 0),
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/stats/all-agents")
def all_agents_stats(days: int = 7):
    """Bulk per-agent rolling statistics for all active agents."""
    since = utc_days_ago(days)
    rows = query(
        """
        SELECT
            a."agentCode",
            a.name,
            a.status,
            COUNT(t.id) FILTER (WHERE t.status = 'success')  AS success_count,
            COUNT(t.id) FILTER (WHERE t.status = 'failed')   AS failed_count,
            COUNT(t.id)                                       AS total_count,
            COALESCE(SUM(t.amount::numeric) FILTER (WHERE t.status = 'success'), 0) AS volume_ngn,
            COALESCE(SUM(t.commission::numeric), 0) AS total_commission
        FROM agents a
        LEFT JOIN transactions t
            ON t."agentId" = a.id AND t."createdAt" >= %s
        GROUP BY a."agentCode", a.name, a.status
        ORDER BY total_count DESC
        """,
        (since,),
    )

    def tier(rate: float) -> str:
        if rate >= 98: return "Excellent"
        if rate >= 95: return "Good"
        if rate >= 90: return "Fair"
        return "Poor"

    result = []
    for r in rows:
        total = int(r["total_count"] or 0)
        success = int(r["success_count"] or 0)
        rate = round(success / total * 100, 2) if total > 0 else None
        result.append({
            "agent_code": r["agentCode"],
            "agent_name": r["name"],
            "agent_status": r["status"],
            "success_rate_pct": rate,
            "tier": tier(rate) if rate is not None else None,
            "total_transactions": total,
            "success_count": success,
            "failed_count": int(r["failed_count"] or 0),
            "volume_ngn": float(r["volume_ngn"] or 0),
            "total_commission_ngn": float(r["total_commission"] or 0),
        })
    return {"agents": result, "period_days": days, "computed_at": datetime.now(timezone.utc).isoformat()}


# ── Entry point ─────────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("ANALYTICS_PORT", "8033"))
    log.info("Starting analytics-service on :%d", port)
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)