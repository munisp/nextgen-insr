"""PostgreSQL async client with connection pooling, retry logic, and migrations."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Optional

import asyncpg

logger = logging.getLogger("ngapp.infra.postgres")

PLATFORM_MIGRATIONS = [
    """CREATE TABLE IF NOT EXISTS policies (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        product_type TEXT NOT NULL,
        status TEXT DEFAULT 'draft',
        premium_amount NUMERIC(15,2),
        sum_insured NUMERIC(15,2),
        currency TEXT DEFAULT 'NGN',
        start_date DATE,
        end_date DATE,
        kyc_level INTEGER DEFAULT 0,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )""",
    """CREATE TABLE IF NOT EXISTS claims (
        id TEXT PRIMARY KEY,
        policy_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        claim_type TEXT NOT NULL,
        status TEXT DEFAULT 'submitted',
        claimed_amount NUMERIC(15,2),
        approved_amount NUMERIC(15,2),
        fraud_score REAL DEFAULT 0,
        kyc_verified BOOLEAN DEFAULT FALSE,
        documents JSONB DEFAULT '[]',
        metadata JSONB DEFAULT '{}',
        filed_at TIMESTAMPTZ DEFAULT NOW(),
        settled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )""",
    """CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        kyc_level INTEGER DEFAULT 0,
        kyc_status TEXT DEFAULT 'pending',
        risk_score REAL DEFAULT 0,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )""",
    """CREATE TABLE IF NOT EXISTS audit_events (
        id SERIAL PRIMARY KEY,
        service_name TEXT NOT NULL,
        event_type TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        actor TEXT,
        ip_address TEXT,
        details JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_policies_customer ON policies(customer_id)",
    "CREATE INDEX IF NOT EXISTS idx_policies_status ON policies(status)",
    "CREATE INDEX IF NOT EXISTS idx_claims_policy ON claims(policy_id)",
    "CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)",
    "CREATE INDEX IF NOT EXISTS idx_audit_service ON audit_events(service_name)",
]


class PostgresClient:
    def __init__(self, dsn: str, min_pool: int = 5, max_pool: int = 20):
        self._dsn = dsn
        self._min_pool = min_pool
        self._max_pool = max_pool
        self._pool: Optional[asyncpg.Pool] = None

    async def connect(self):
        for attempt in range(3):
            try:
                self._pool = await asyncpg.create_pool(
                    self._dsn,
                    min_size=self._min_pool,
                    max_size=self._max_pool,
                    command_timeout=30,
                )
                logger.info("postgres_connected")
                return
            except Exception as e:
                logger.warning("postgres_connect_attempt_%d: %s", attempt + 1, e)
                await asyncio.sleep(1 * (attempt + 1))
        logger.error("postgres_connect_failed_after_retries")

    async def ping(self):
        if self._pool is None:
            await self.connect()
        if self._pool is None:
            raise ConnectionError("PostgreSQL pool not available")
        async with self._pool.acquire() as conn:
            await conn.fetchval("SELECT 1")

    async def migrate(self, statements: Optional[list[str]] = None):
        stmts = statements or PLATFORM_MIGRATIONS
        if self._pool is None:
            await self.connect()
        if self._pool is None:
            raise ConnectionError("Cannot run migrations without pool")
        async with self._pool.acquire() as conn:
            for stmt in stmts:
                await conn.execute(stmt)
        logger.info("migrations_complete: %d statements", len(stmts))

    async def execute(self, query: str, *args, timeout: float = 30) -> str:
        if self._pool is None:
            await self.connect()
        async with self._pool.acquire() as conn:
            return await conn.execute(query, *args, timeout=timeout)

    async def fetch(self, query: str, *args, timeout: float = 30) -> list[asyncpg.Record]:
        if self._pool is None:
            await self.connect()
        async with self._pool.acquire() as conn:
            return await conn.fetch(query, *args, timeout=timeout)

    async def fetchrow(self, query: str, *args, timeout: float = 30) -> Optional[asyncpg.Record]:
        if self._pool is None:
            await self.connect()
        async with self._pool.acquire() as conn:
            return await conn.fetchrow(query, *args, timeout=timeout)

    async def fetchval(self, query: str, *args, timeout: float = 30) -> Any:
        if self._pool is None:
            await self.connect()
        async with self._pool.acquire() as conn:
            return await conn.fetchval(query, *args, timeout=timeout)

    async def insert_audit_event(
        self, service: str, event_type: str, entity_type: str = "",
        entity_id: str = "", actor: str = "", ip_address: str = "",
        details: Optional[dict] = None,
    ):
        import json
        await self.execute(
            """INSERT INTO audit_events (service_name, event_type, entity_type, entity_id, actor, ip_address, details)
               VALUES ($1, $2, $3, $4, $5, $6, $7)""",
            service, event_type, entity_type, entity_id, actor, ip_address,
            json.dumps(details or {}),
        )

    def pool_stats(self) -> dict[str, int]:
        if self._pool is None:
            return {"size": 0, "free": 0, "used": 0}
        return {
            "size": self._pool.get_size(),
            "free": self._pool.get_idle_size(),
            "used": self._pool.get_size() - self._pool.get_idle_size(),
        }

    async def close(self):
        if self._pool:
            await self._pool.close()
