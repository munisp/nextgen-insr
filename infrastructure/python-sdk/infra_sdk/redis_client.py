"""Redis async client with connection pooling, atomic rate limiting, safe distributed locks,
cache invalidation with pub/sub notification, circuit breaker, and cache warming."""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

import redis.asyncio as aioredis

logger = logging.getLogger("ngapp.infra.redis")

# Lua script for atomic rate limiting (no INCR/EXPIRE race condition)
RATE_LIMIT_LUA = """
local key = KEYS[1]
local max = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local current = redis.call('INCR', key)
if current == 1 then
    redis.call('EXPIRE', key, window)
end
if current > max then
    return 0
end
return 1
"""

# Lua script for safe lock release (only owner can release)
RELEASE_LOCK_LUA = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
else
    return 0
end
"""

# Lua script for pattern-based invalidation with pub/sub notification
INVALIDATE_LUA = """
local deleted = 0
local cursor = "0"
repeat
    local result = redis.call('SCAN', cursor, 'MATCH', KEYS[1], 'COUNT', 100)
    cursor = result[1]
    local keys = result[2]
    for _, key in ipairs(keys) do
        redis.call('DEL', key)
        deleted = deleted + 1
    end
until cursor == "0"
if deleted > 0 then
    redis.call('PUBLISH', '__cache_invalidation__', KEYS[1])
end
return deleted
"""


class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half-open"


@dataclass
class LockGuard:
    key: str
    owner_id: str


class RedisClient:
    def __init__(self, addr: str, db: int = 0, pool_size: int = 20):
        host, _, port_str = addr.partition(":")
        port = int(port_str) if port_str else 6379
        self._client = aioredis.Redis(
            host=host, port=port, db=db,
            max_connections=pool_size,
            decode_responses=True,
            socket_timeout=2.0,
            socket_connect_timeout=3.0,
            retry_on_timeout=True,
        )
        # Circuit breaker state
        self._circuit_state = CircuitState.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._last_failure = 0.0
        self._circuit_timeout = 30.0  # seconds before half-open
        self._failure_threshold = 5
        self._success_threshold = 3
        # Register Lua scripts
        self._rate_limit_script: Optional[Any] = None
        self._release_lock_script: Optional[Any] = None
        self._invalidate_script: Optional[Any] = None

    async def _ensure_scripts(self):
        if self._rate_limit_script is None:
            self._rate_limit_script = self._client.register_script(RATE_LIMIT_LUA)
            self._release_lock_script = self._client.register_script(RELEASE_LOCK_LUA)
            self._invalidate_script = self._client.register_script(INVALIDATE_LUA)

    def _check_circuit(self) -> bool:
        if self._circuit_state == CircuitState.CLOSED:
            return True
        if self._circuit_state == CircuitState.OPEN:
            if time.time() - self._last_failure >= self._circuit_timeout:
                self._circuit_state = CircuitState.HALF_OPEN
                return True
            return False
        return True  # half-open allows one attempt

    def _record_success(self):
        self._failure_count = 0
        self._success_count += 1
        if self._circuit_state == CircuitState.HALF_OPEN and self._success_count >= self._success_threshold:
            self._circuit_state = CircuitState.CLOSED
            logger.info("redis_circuit_breaker: closed")

    def _record_failure(self):
        self._failure_count += 1
        self._success_count = 0
        self._last_failure = time.time()
        if self._failure_count >= self._failure_threshold:
            self._circuit_state = CircuitState.OPEN
            logger.warning(f"redis_circuit_breaker: opened after {self._failure_count} failures")

    @property
    def circuit_state(self) -> str:
        return self._circuit_state.value

    async def ping(self):
        if not self._check_circuit():
            raise ConnectionError("Redis circuit breaker is open")
        try:
            await self._client.ping()
            self._record_success()
        except Exception as e:
            self._record_failure()
            raise

    async def cache_json(self, key: str, value: Any, ttl_seconds: int = 300):
        if not self._check_circuit():
            return
        try:
            await self._client.set(key, json.dumps(value), ex=ttl_seconds)
            self._record_success()
        except Exception:
            self._record_failure()

    async def get_cached_json(self, key: str) -> Optional[Any]:
        if not self._check_circuit():
            return None
        try:
            data = await self._client.get(key)
            self._record_success()
            if data is None:
                return None
            return json.loads(data)
        except Exception:
            self._record_failure()
            return None

    async def rate_limit(self, key: str, max_requests: int, window_seconds: int) -> bool:
        """Atomic rate limiting using Lua script (no INCR/EXPIRE race condition)."""
        if not self._check_circuit():
            return True  # fail open
        try:
            await self._ensure_scripts()
            result = await self._rate_limit_script(keys=[key], args=[max_requests, window_seconds])
            self._record_success()
            return result == 1
        except Exception:
            self._record_failure()
            return True  # fail open

    async def acquire_lock(self, key: str, ttl_seconds: int = 30) -> Optional[LockGuard]:
        """Acquire a distributed lock with unique owner ID (safe release)."""
        if not self._check_circuit():
            return None
        owner_id = str(uuid.uuid4())
        lock_key = f"lock:{key}"
        try:
            result = await self._client.set(lock_key, owner_id, nx=True, ex=ttl_seconds)
            self._record_success()
            if result:
                return LockGuard(key=lock_key, owner_id=owner_id)
            return None
        except Exception:
            self._record_failure()
            return None

    async def release_lock(self, guard: LockGuard) -> bool:
        """Release a lock safely — only the owner can release it."""
        if not self._check_circuit():
            return False
        try:
            await self._ensure_scripts()
            result = await self._release_lock_script(keys=[guard.key], args=[guard.owner_id])
            self._record_success()
            return result == 1
        except Exception:
            self._record_failure()
            return False

    async def publish(self, channel: str, message: Any):
        if not self._check_circuit():
            return
        try:
            await self._client.publish(channel, json.dumps(message))
            self._record_success()
        except Exception:
            self._record_failure()

    async def invalidate_pattern(self, pattern: str) -> int:
        """Invalidate all keys matching pattern and notify via pub/sub."""
        if not self._check_circuit():
            return 0
        try:
            await self._ensure_scripts()
            result = await self._invalidate_script(keys=[pattern])
            self._record_success()
            return int(result)
        except Exception:
            self._record_failure()
            return 0

    async def publish_invalidation(self, entity_type: str, entity_id: str):
        """Publish cache invalidation event for cross-service coherence."""
        await self.publish("__cache_invalidation__", {
            "type": "cache_invalidation",
            "entity_type": entity_type,
            "entity_id": entity_id,
            "timestamp": int(time.time()),
        })

    async def set_kyc_gate(self, user_id: str, allowed: bool, level: int, ttl: int = 600):
        await self.cache_json(f"kyc:gate:{user_id}", {"allowed": allowed, "level": level, "ts": int(time.time())}, ttl)

    async def get_kyc_gate(self, user_id: str) -> Optional[dict]:
        return await self.get_cached_json(f"kyc:gate:{user_id}")

    async def cache_policy(self, policy_id: str, data: dict, ttl: int = 3600):
        await self.cache_json(f"policy:{policy_id}", data, ttl)

    async def get_cached_policy(self, policy_id: str) -> Optional[dict]:
        return await self.get_cached_json(f"policy:{policy_id}")

    async def cache_session(self, session_id: str, data: dict, ttl: int = 1800):
        await self.cache_json(f"session:{session_id}", data, ttl)

    async def get_session(self, session_id: str) -> Optional[dict]:
        return await self.get_cached_json(f"session:{session_id}")

    async def warm_cache(self, entries: list[tuple[str, Any, int]]) -> int:
        """Warm cache with commonly-accessed entries on startup."""
        loaded = 0
        for key, value, ttl in entries:
            try:
                await self.cache_json(key, value, ttl)
                loaded += 1
            except Exception:
                pass
        logger.info(f"cache_warmup_complete: loaded={loaded}")
        return loaded

    def pool_stats(self) -> dict:
        pool = self._client.connection_pool
        return {"created_connections": pool._created_connections, "available_connections": len(pool._available_connections)}

    async def close(self):
        await self._client.aclose()
