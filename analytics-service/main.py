"""
analytics-service — 54Link Nigeria Transaction Success-Rate Analytics
======================================================================
A FastAPI service that queries PostgreSQL directly and computes rolling
statistics used by the POS Admin Panel and home-screen success badge.

Endpoints (port 8033):
  GET /stats/success-rate          — 7-day rolling success rate (%)
  GET /stats/by-type               — success/failure breakdown by tx type
  GET /stats/hourly-volume         — hourly volume for the last 24 h
  GET /stats/agent/{agent_code}    — per-agent 7-day stats
  GET /stats/all-agents            — bulk per-agent rolling statistics
  GET /health                      — liveness check

Design choices:
- Pure SQL aggregations — no ORM, no caching layer needed at this scale.
- All timestamps stored as UTC; returned as ISO-8601 strings.
- Graceful degradation: returns zeroed stats when DB is unreachable.
"""

import os
import logging
import re
import signal
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from typing import Optional

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

logging.basicConfig(
    level=logging.INFO,
    format="[analytics] %(asctime)s %(levelname)s %(name)s - %(message)s",
)
log = logging.getLogger(__name__)


# ── Custom Exceptions ─────────────────────────────────────────────────────────


class AnalyticsError(Exception):
    """Base exception for analytics service errors."""

    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


class DatabaseConnectionError(AnalyticsError):
    """Raised when the database is unreachable."""

    def __init__(self):
        super().__init__(
            "Database connection failed",
            status_code=503,
        )


class AgentNotFoundError(AnalyticsError):
    """Raised when a requested agent is not found."""

    def __init__(self, agent_code: str):
        super().__init__(
            f"Agent {agent_code} not found",
            status_code=404,
        )


class InvalidParameterError(AnalyticsError):
    """Raised when a request parameter is invalid."""

    def __init__(self, field: str, message: str):
        super().__init__(f"Invalid parameter '{field}': {message}", status_code=422)


# ── Pydantic Response Models ─────────────────────────────────────────────────


class DailyStatEntry:
    """A single daily stat row (avoid circular imports with pydantic)."""

    __slots__ = ("day", "success_count", "total_count", "rate")

    def __init__(self, day, success_count, total_count, rate):
        self.day = day
        self.success_count = success_count
        self.total_count = total_count
        self.rate = rate

    def to_dict(self):
        return {
            "day": self.day,
            "success_count": self.success_count,
            "total_count": self.total_count,
            "rate": self.rate,
        }


class AgentStatEntry:
    """A single agent stat row."""

    __slots__ = (
        "agent_code", "agent_name", "agent_status", "success_rate_pct",
        "tier", "total_transactions", "success_count", "failed_count",
        "volume_ngn", "total_commission_ngn",
    )

    def __init__(
        self,
        agent_code,
        agent_name,
        agent_status,
        success_rate_pct,
        tier,
        total_transactions,
        success_count,
        failed_count,
        volume_ngn,
        total_commission_ngn,
    ):
        self.agent_code = agent_code
        self.agent_name = agent_name
        self.agent_status = agent_status
        self.success_rate_pct = success_rate_pct
        self.tier = tier
        self.total_transactions = total_transactions
        self.success_count = success_count
        self.failed_count = failed_count
        self.volume_ngn = volume_ngn
        self.total_commission_ngn = total_commission_ngn

    def to_dict(self):
        return {
            "agent_code": self.agent_code,
            "agent_name": self.agent_name,
            "agent_status": self.agent_status,
            "success_rate_pct": self.success_rate_pct,
            "tier": self.tier,
            "total_transactions": self.total_transactions,
            "success_count": self.success_count,
            "failed_count": self.failed_count,
            "volume_ngn": self.volume_ngn,
            "total_commission_ngn": self.total_commission_ngn,
        }


class TypeBreakdownEntry:
    """A single type breakdown row."""

    __slots__ = (
        "type", "success_count", "failed_count", "total_count",
        "total_volume_ngn", "success_rate_pct",
    )

    def __init__(
        self,
        type_name,
        success_count,
        failed_count,
        total_count,
        total_volume_ngn,
        success_rate_pct,
    ):
        self.type = type_name
        self.success_count = success_count
        self.failed_count = failed_count
        self.total_count = total_count
        self.total_volume_ngn = total_volume_ngn
        self.success_rate_pct = success_rate_pct

    def to_dict(self):
        return {
            "type": self.type,
            "success_count": self.success_count,
            "failed_count": self.failed_count,
            "total_count": self.total_count,
            "total_volume_ngn": self.total_volume_ngn,
            "success_rate_pct": self.success_rate_pct,
        }


# ── Database helpers ──────────────────────────────────────────────────────────

_db_ready = True


def get_conn():
    """Open a fresh psycopg2 connection."""
    url = os.environ.get("POSTGRES_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise DatabaseConnectionError()
    try:
        return psycopg2.connect(url, cursor_factory=psycopg2.extras.RealDictCursor)
    except psycopg2.Error as exc:
        log.error("Failed to connect to database: %s", exc)
        raise DatabaseConnectionError() from exc


def query(sql: str, params=None) -> list[dict]:
    """Execute a SQL query with graceful degradation."""
    global _db_ready
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            rows = cur.fetchall()
        conn.close()
        _db_ready = True
        return [dict(r) for r in rows]
    except DatabaseConnectionError:
        _db_ready = False
        log.warning("Database unreachable; returning zeroed result set")
        return []
    except psycopg2.Error as exc:
        _db_ready = False
        log.error("DB query failed: %s", exc)
        return []
    except Exception as exc:
        _db_ready = False
        log.error("Unexpected error during query: %s", exc)
        return []


# ── Helpers ───────────────────────────────────────────────────────────────────


def utc_days_ago(n: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=n)


def _compute_tier(rate: Optional[float]) -> Optional[str]:
    if rate is None:
        return None
    if rate >= 98:
        return "Excellent"
    if rate >= 95:
        return "Good"
    if rate >= 90:
        return "Fair"
    return "Poor"


# ── Lifespan (graceful shutdown) ──────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Graceful startup and shutdown."""
    log.info("Analytics service starting up")
    yield
    log.info("Analytics service shutting down")


# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="54Link Analytics Service",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.exception_handler(AnalyticsError)
async def analytics_error_handler(request: Request, exc: AnalyticsError):
    log.warning("Analytics error on %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.args[0]},
    )


@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception):
    log.exception("Unhandled exception: %s", exc)
    return JSONResponse(
        status_code=500,
        content={"error": "internal server error", "detail": "An unexpected error occurred"},
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

VALID_AGENT_CODE_RE = re.compile(r"^[A-Za-z0-9_-]+$")


@app.get("/health")
async def health():
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
        "db_ready": _db_ready,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get(
    "/stats/success-rate",
    description="Rolling N-day transaction success rate with daily breakdown.",
)
async def success_rate(days: int = Query(default=7, ge=1, le=365)):
    """Rolling N-day transaction success rate.

    Args:
        days: Number of rolling days (1-365). Defaults to 7.
    """
    try:
        since = utc_days_ago(days)

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

        daily_rows = query(
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

        daily_series = []
        for r in daily_rows:
            sc = int(r.get("success_count") or 0)
            tc = int(r.get("total_count") or 0)
            daily_series.append({
                "day": str(r["day"]),
                "success_count": sc,
                "total_count": tc,
                "rate": round(sc / tc * 100, 2) if tc > 0 else 0.0,
            })

        return {
            "period_days": days,
            "success_rate_pct": rate,
            "tier": _compute_tier(rate),
            "total_transactions": total,
            "success_count": success,
            "failed_count": int(overall.get("failed_count") or 0),
            "reversed_count": int(overall.get("reversed_count") or 0),
            "daily_series": daily_series,
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        log.exception("Error computing success rate")
        return {
            "period_days": days,
            "success_rate_pct": 0.0,
            "tier": "Poor",
            "total_transactions": 0,
            "success_count": 0,
            "failed_count": 0,
            "reversed_count": 0,
            "daily_series": [],
            "computed_at": datetime.now(timezone.utc).isoformat(),
            "error": str(exc),
        }


@app.get("/stats/by-type")
async def by_type(days: int = Query(default=7, ge=1, le=365)):
    """Success/failure breakdown by transaction type."""
    try:
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
        breakdown = []
        for r in rows:
            sc = int(r.get("success_count") or 0)
            tc = int(r.get("total_count") or 0)
            breakdown.append({
                "type": r.get("type"),
                "success_count": sc,
                "failed_count": int(r.get("failed_count") or 0),
                "total_count": tc,
                "total_volume_ngn": float(r.get("total_volume") or 0),
                "success_rate_pct": round(sc / tc * 100, 2) if tc > 0 else 0.0,
            })

        return {
            "period_days": days,
            "breakdown": breakdown,
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        log.exception("Error computing by-type stats")
        return {
            "period_days": days,
            "breakdown": [],
            "computed_at": datetime.now(timezone.utc).isoformat(),
            "error": str(exc),
        }


@app.get("/stats/hourly-volume")
async def hourly_volume():
    """Hourly transaction volume for the last 24 hours (Lagos time)."""
    try:
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
        series = []
        for r in rows:
            hour_val = r.get("hour")
            series.append({
                "hour": hour_val.isoformat() if hasattr(hour_val, "isoformat") else str(hour_val),
                "tx_count": int(r.get("tx_count") or 0),
                "volume_ngn": float(r.get("volume_ngn") or 0),
            })

        return {
            "series": series,
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        log.exception("Error computing hourly volume")
        return {
            "series": [],
            "computed_at": datetime.now(timezone.utc).isoformat(),
            "error": str(exc),
        }


@app.get("/stats/agent/{agent_code}")
async def agent_stats(agent_code: str, days: int = Query(default=7, ge=1, le=365)):
    """Per-agent rolling statistics."""
    if not agent_code or not VALID_AGENT_CODE_RE.match(agent_code):
        raise InvalidParameterError("agent_code", "Invalid format")

    try:
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
            raise AgentNotFoundError(agent_code)

        r = rows[0]
        total = int(r.get("total_count") or 0)
        success = int(r.get("success_count") or 0)
        rate = round(success / total * 100, 2) if total > 0 else 0.0

        return {
            "agent_code": r.get("agentCode"),
            "agent_name": r.get("name"),
            "period_days": days,
            "success_rate_pct": rate,
            "total_transactions": total,
            "success_count": success,
            "failed_count": int(r.get("failed_count") or 0),
            "volume_ngn": float(r.get("volume_ngn") or 0),
            "total_commission_ngn": float(r.get("total_commission") or 0),
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }
    except AgentNotFoundError:
        raise
    except Exception as exc:
        log.exception("Error computing agent stats for %s", agent_code)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to compute agent stats: {exc}",
        )


@app.get("/stats/all-agents")
async def all_agents_stats(days: int = Query(default=7, ge=1, le=365)):
    """Bulk per-agent rolling statistics for all active agents."""
    try:
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

        result = []
        for r in rows:
            total = int(r.get("total_count") or 0)
            success = int(r.get("success_count") or 0)
            rate = round(success / total * 100, 2) if total > 0 else None
            result.append({
                "agent_code": r.get("agentCode"),
                "agent_name": r.get("name"),
                "agent_status": r.get("status"),
                "success_rate_pct": rate,
                "tier": _compute_tier(rate),
                "total_transactions": total,
                "success_count": success,
                "failed_count": int(r.get("failed_count") or 0),
                "volume_ngn": float(r.get("volume_ngn") or 0),
                "total_commission_ngn": float(r.get("total_commission") or 0),
            })
        return {
            "agents": result,
            "period_days": days,
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        log.exception("Error computing all-agents stats")
        return {
            "agents": [],
            "period_days": days,
            "computed_at": datetime.now(timezone.utc).isoformat(),
            "error": str(exc),
        }


# ── Entry point ─────────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("ANALYTICS_PORT", "8033"))
    log.info("Starting analytics-service on :%d", port)

    def handle_shutdown(signum, frame):
        log.info("Shutdown signal received (signal %s)", signum)
        sys.exit(0)

    signal.signal(signal.SIGTERM, handle_shutdown)
    signal.signal(signal.SIGINT, handle_shutdown)

    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)