"""PostgreSQL persistence store for the Billing Webhook Dispatcher.

(2026-10-02, C2-a12) Replaces the former in-process dicts/lists, which lost
all subscriber registrations, dead letters, and delivery history on restart
(silent billing-event loss). Follows the psycopg2 pattern used by sibling
services (digital-twin, ai-advisor): `psycopg2.connect(DATABASE_URL)` +
RealDictCursor, tables created idempotently at boot.

Fail-closed contract: every method raises StoreUnavailable on connection/
query failure — a billing event is never silently dropped. Boot must call
init_schema() and abort on failure.

Delivery-log retention is bounded: webhook_deliveries is trimmed to the
newest DELIVERY_LOG_MAX_ROWS rows (default 10000, env
WEBHOOK_DELIVERY_LOG_MAX_ROWS) on every insert; dead letters and
subscriptions are retained indefinitely (they represent undelivered billing
events and live billing integrations respectively).
"""

import logging
import os
from typing import Any, Dict, List, Optional

import psycopg2
import psycopg2.extras

logger = logging.getLogger("billing-webhook-dispatcher.store")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/billing_webhooks")
DELIVERY_LOG_MAX_ROWS = int(os.getenv("WEBHOOK_DELIVERY_LOG_MAX_ROWS", "10000"))


class StoreUnavailable(Exception):
    """Raised when the persistence store cannot be reached or written."""


class PostgresStore:
    def __init__(self, database_url: str = DATABASE_URL,
                 delivery_log_max_rows: int = DELIVERY_LOG_MAX_ROWS):
        self.database_url = database_url
        self.delivery_log_max_rows = delivery_log_max_rows

    def _connect(self):
        try:
            return psycopg2.connect(self.database_url, connect_timeout=5)
        except Exception as exc:
            raise StoreUnavailable(f"cannot connect to webhook store: {exc}") from exc

    def _execute(self, sql: str, params: tuple = (), fetch: Optional[str] = None):
        try:
            with self._connect() as conn:
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute(sql, params)
                    if fetch == "one":
                        row = cur.fetchone()
                        return dict(row) if row is not None else None
                    if fetch == "all":
                        return [dict(r) for r in cur.fetchall()]
                    return None
        except StoreUnavailable:
            raise
        except Exception as exc:
            raise StoreUnavailable(f"webhook store operation failed: {exc}") from exc

    # (2026-10-02, C2-a12) boot-time schema; caller must abort startup on error.
    def init_schema(self) -> None:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS webhook_subscriptions (
                        subscriber_id TEXT PRIMARY KEY,
                        url TEXT NOT NULL,
                        events JSONB NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    CREATE TABLE IF NOT EXISTS webhook_deliveries (
                        id BIGSERIAL PRIMARY KEY,
                        subscriber_id TEXT NOT NULL,
                        event_type TEXT NOT NULL,
                        attempt INT NOT NULL,
                        delivered BOOLEAN NOT NULL,
                        status INT,
                        error TEXT,
                        next_retry_at DOUBLE PRECISION,
                        max_attempts INT,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    CREATE TABLE IF NOT EXISTS webhook_dead_letters (
                        id BIGSERIAL PRIMARY KEY,
                        record JSONB NOT NULL,
                        dead_lettered_at DOUBLE PRECISION NOT NULL,
                        reason TEXT NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                """)
        logger.info("webhook store schema ready (delivery log retention: %d rows)",
                    self.delivery_log_max_rows)

    # ── subscribers ──────────────────────────────────────────────────────
    def add_subscriber(self, subscriber_id: str, url: str, events: List[str]) -> None:
        self._execute(
            "INSERT INTO webhook_subscriptions (subscriber_id, url, events) VALUES (%s, %s, %s)",
            (subscriber_id, url, psycopg2.extras.Json(events)))

    def list_subscribers(self) -> Dict[str, Dict[str, Any]]:
        rows = self._execute(
            "SELECT subscriber_id, url, events FROM webhook_subscriptions ORDER BY created_at",
            fetch="all")
        return {r["subscriber_id"]: {"url": r["url"], "events": r["events"]} for r in rows}

    def get_subscriber(self, subscriber_id: str) -> Optional[Dict[str, Any]]:
        row = self._execute(
            "SELECT url, events FROM webhook_subscriptions WHERE subscriber_id = %s",
            (subscriber_id,), fetch="one")
        return {"url": row["url"], "events": row["events"]} if row else None

    # ── delivery log (bounded retention) ─────────────────────────────────
    def append_delivery(self, record: Dict[str, Any]) -> int:
        row = self._execute(
            """INSERT INTO webhook_deliveries
               (subscriber_id, event_type, attempt, delivered, status, error,
                next_retry_at, max_attempts)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
            (record["subscriber_id"], record["event_type"], record["attempt"],
             record["delivered"], record.get("status"), record.get("error"),
             record.get("next_retry_at"), record.get("max_attempts")),
            fetch="one")
        # (2026-10-02, C2-a12) bounded retention: keep newest N rows.
        self._execute(
            """DELETE FROM webhook_deliveries WHERE id NOT IN
               (SELECT id FROM webhook_deliveries ORDER BY id DESC LIMIT %s)""",
            (self.delivery_log_max_rows,))
        return row["id"]

    def get_delivery_by_index(self, log_index: int) -> Optional[Dict[str, Any]]:
        return self._execute(
            """SELECT id, subscriber_id, event_type, attempt, delivered, status,
                      error, next_retry_at, max_attempts
               FROM webhook_deliveries ORDER BY id LIMIT 1 OFFSET %s""",
            (log_index,), fetch="one")

    def update_delivery(self, record: Dict[str, Any]) -> None:
        self._execute(
            """UPDATE webhook_deliveries SET attempt = %s, delivered = %s,
                      status = %s, error = %s, next_retry_at = %s
               WHERE id = %s""",
            (record["attempt"], record["delivered"], record.get("status"),
             record.get("error"), record.get("next_retry_at"), record["id"]))

    def delivery_count(self) -> int:
        row = self._execute("SELECT COUNT(*) AS n FROM webhook_deliveries", fetch="one")
        return row["n"]

    # ── dead letters (never dropped; retained indefinitely) ──────────────
    def append_dead_letter(self, record: Dict[str, Any], dead_lettered_at: float,
                           reason: str) -> None:
        self._execute(
            "INSERT INTO webhook_dead_letters (record, dead_lettered_at, reason) VALUES (%s, %s, %s)",
            (psycopg2.extras.Json(record), dead_lettered_at, reason))

    def list_dead_letters(self) -> List[Dict[str, Any]]:
        rows = self._execute(
            "SELECT record, dead_lettered_at, reason FROM webhook_dead_letters ORDER BY id",
            fetch="all")
        return [{**r["record"], "dead_lettered_at": r["dead_lettered_at"],
                 "reason": r["reason"]} for r in rows]

    def dead_letter_count(self) -> int:
        row = self._execute("SELECT COUNT(*) AS n FROM webhook_dead_letters", fetch="one")
        return row["n"]
