"""
Redis Cache Layer — two-tier cache (local LRU + shared Redis) with tag-based
invalidation and stampede protection.

Honesty contract:
- With REDIS_URL configured, L2 is a REAL Redis (redis-py asyncio); every
  Redis error surfaces in /health (degraded) and in request errors — a miss
  is never reported as a hit.
- Without REDIS_URL the service runs LRU-only and says so explicitly in
  /health and /stats ("backend": "lru-only"). It never claims shared state
  it does not have.
- Stampede protection: per-key asyncio locks ensure a single recomputation
  (or upstream fetch via the `loader` callback) per key; concurrent waiters
  share the real result.
"""

import asyncio
import logging
import os
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("redis-cache-layer")

REDIS_URL = os.getenv("REDIS_URL", "")
LRU_CAPACITY = int(os.getenv("LRU_CAPACITY", "10000"))
DEFAULT_TTL = int(os.getenv("DEFAULT_TTL_SECONDS", "300"))


class LRUCache:
    """Bounded in-process LRU with per-entry TTL."""

    def __init__(self, capacity: int = 10_000):
        self.capacity = capacity
        self._data: OrderedDict[str, tuple[Any, float]] = OrderedDict()

    def get(self, key: str) -> Any | None:
        entry = self._data.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if expires_at and expires_at < time.time():
            self._data.pop(key, None)
            return None
        self._data.move_to_end(key)
        return value

    def set(self, key: str, value: Any, ttl: int = DEFAULT_TTL) -> None:
        expires_at = time.time() + ttl if ttl > 0 else 0.0
        self._data[key] = (value, expires_at)
        self._data.move_to_end(key)
        while len(self._data) > self.capacity:
            self._data.popitem(last=False)

    def delete(self, key: str) -> bool:
        return self._data.pop(key, None) is not None

    def clear_prefix(self, prefix: str) -> int:
        keys = [k for k in self._data if k.startswith(prefix)]
        for k in keys:
            self._data.pop(k, None)
        return len(keys)

    def __len__(self) -> int:
        return len(self._data)


class RedisCacheLayer:
    """L1 LRU + L2 Redis with tags and stampede-protected load."""

    def __init__(self, redis_url: str, lru_capacity: int = LRU_CAPACITY):
        self.l1 = LRUCache(lru_capacity)
        self._redis_url = redis_url
        self._redis = None  # lazy
        self._locks: dict[str, asyncio.Lock] = {}
        self.hits_l1 = 0
        self.hits_l2 = 0
        self.misses = 0
        self.stampede_waits = 0

    @property
    def backend(self) -> str:
        return "redis+lru" if self._redis_url else "lru-only"

    async def redis(self):
        """Connect lazily; raises (fails loud) when Redis is unreachable."""
        if not self._redis_url:
            return None
        if self._redis is None:
            import redis.asyncio as aioredis

            self._redis = aioredis.from_url(
                self._redis_url, socket_timeout=3, socket_connect_timeout=3
            )
        return self._redis

    async def ping_redis(self) -> str | None:
        """None when LRU-only, 'ok' when Redis answers, else the real error."""
        if not self._redis_url:
            return None
        try:
            r = await self.redis()
            await r.ping()
            return "ok"
        except Exception as e:  # noqa: BLE001 — redis-py raises a broad error hierarchy; surfaced verbatim in /health
            return f"{type(e).__name__}: {e}"

    async def get(self, key: str) -> Any | None:
        v = self.l1.get(key)
        if v is not None:
            self.hits_l1 += 1
            return v
        if self._redis_url:
            r = await self.redis()
            raw = await r.get(key)
            if raw is not None:
                import json

                value = json.loads(raw)
                self.l1.set(key, value)
                self.hits_l2 += 1
                return value
        self.misses += 1
        return None

    async def set(self, key: str, value: Any, ttl: int = DEFAULT_TTL,
                  tags: list[str] | None = None) -> None:
        self.l1.set(key, value, ttl)
        if self._redis_url:
            import json

            r = await self.redis()
            await r.set(key, json.dumps(value), ex=ttl if ttl > 0 else None)
            for tag in tags or []:
                await r.sadd(f"tag:{tag}", key)

    async def get_or_load(self, key: str,
                          loader: Callable[[], Awaitable[Any]],
                          ttl: int = DEFAULT_TTL,
                          tags: list[str] | None = None) -> Any:
        """Stampede-protected load: one caller computes, waiters share it."""
        v = await self.get(key)
        if v is not None:
            return v
        lock = self._locks.setdefault(key, asyncio.Lock())
        if lock.locked():
            self.stampede_waits += 1
        async with lock:
            try:
                v = await self.get(key)  # re-check after acquiring
                if v is not None:
                    return v
                value = await loader()
                await self.set(key, value, ttl, tags)
                return value
            finally:
                if not lock.locked():
                    self._locks.pop(key, None)

    async def invalidate_by_tag(self, tag: str) -> int:
        """Delete every key carrying `tag`. Returns the real delete count."""
        count = 0
        if self._redis_url:
            r = await self.redis()
            members = await r.smembers(f"tag:{tag}")
            for m in members or []:
                key = m.decode() if isinstance(m, bytes) else m
                await r.delete(key)
                self.l1.delete(key)
                count += 1
            await r.delete(f"tag:{tag}")
        else:
            # LRU-only mode: tags are not indexed, so we can only honestly
            # report that shared invalidation is unavailable
            raise RuntimeError(
                "invalidate_by_tag requires REDIS_URL — LRU-only mode has no tag index"
            )
        return count

    async def stats(self) -> dict:
        return {
            "backend": self.backend,
            "l1_entries": len(self.l1),
            "hits_l1": self.hits_l1,
            "hits_l2": self.hits_l2,
            "misses": self.misses,
            "stampede_waits": self.stampede_waits,
        }


layer = RedisCacheLayer(REDIS_URL)
app = FastAPI(title="Redis Cache Layer", version="1.0.0")


class SetRequest(BaseModel):
    key: str
    value: Any
    ttl: int = DEFAULT_TTL
    tags: list[str] = []


@app.get("/health")
async def health():
    redis_status = await layer.ping_redis()
    if redis_status not in (None, "ok"):
        raise HTTPException(
            status_code=503,
            detail={"status": "degraded", "redis": redis_status},
        )
    return {"status": "ok", "service": "redis-cache-layer", "backend": layer.backend}


@app.get("/cache/{key:path}")
async def cache_get(key: str):
    try:
        v = await layer.get(key)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"cache backend error: {e}") from e
    if v is None:
        raise HTTPException(status_code=404, detail="cache miss")
    return {"key": key, "value": v}


@app.put("/cache/{key:path}")
async def cache_set(key: str, body: SetRequest):
    try:
        await layer.set(key, body.value, body.ttl, body.tags)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"cache backend error: {e}") from e
    return {"stored": True, "key": key}


@app.delete("/cache/{key:path}")
async def cache_delete(key: str):
    removed = layer.l1.delete(key)
    if layer._redis_url:
        r = await layer.redis()
        removed = bool(await r.delete(key)) or removed
    return {"removed": removed}


@app.post("/cache/invalidate-tag/{tag}")
async def cache_invalidate_tag(tag: str):
    try:
        count = await layer.invalidate_by_tag(tag)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"cache backend error: {e}") from e
    return {"tag": tag, "invalidated": count}


@app.get("/stats")
async def stats():
    s = await layer.stats()
    s["redis"] = await layer.ping_redis()
    return s


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8112")))
