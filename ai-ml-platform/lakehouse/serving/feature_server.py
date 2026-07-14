"""
Online Feature Serving Layer

Provides low-latency feature lookups for real-time inference:
- In-memory feature cache with TTL-based expiration
- Redis-compatible interface for distributed deployments
- Point-in-time feature retrieval (temporal joins)
- Feature materialization from offline Delta tables
- Batch feature retrieval for training data assembly
- Feature vector assembly from multiple tables
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pyarrow.parquet as pq


@dataclass
class FeatureVector:
    """A single feature vector with metadata."""
    entity_id: str
    features: dict[str, Any]
    timestamp: float
    source_table: str
    ttl_seconds: float = 3600.0

    @property
    def is_expired(self) -> bool:
        return (time.time() - self.timestamp) > self.ttl_seconds

    def to_dict(self) -> dict[str, Any]:
        return {
            "entity_id": self.entity_id,
            "features": self.features,
            "timestamp": self.timestamp,
            "source_table": self.source_table,
            "is_expired": self.is_expired,
        }

    def to_numpy(self, feature_names: list[str] | None = None) -> np.ndarray:
        """Convert to numpy array for model inference."""
        if feature_names:
            values = [float(self.features.get(f, 0.0)) for f in feature_names]
        else:
            values = [float(v) for v in self.features.values() if isinstance(v, (int, float))]
        return np.array(values, dtype=np.float32)


@dataclass
class ServingConfig:
    """Configuration for the feature serving layer."""
    # Cache
    max_cache_size: int = 100_000
    default_ttl_seconds: float = 3600.0
    cache_warmup_on_start: bool = True

    # Redis (for distributed)
    redis_url: str | None = None
    redis_prefix: str = "ngapp:features:"
    redis_ttl_seconds: int = 3600

    # Offline store
    lakehouse_path: str = "lakehouse_store"

    # Materialization
    materialize_interval_seconds: float = 300.0
    materialize_on_miss: bool = True

    # Performance
    batch_size: int = 1000
    max_latency_ms: float = 10.0


class LRUCache:
    """Thread-safe LRU cache with TTL support."""

    def __init__(self, max_size: int = 100_000, default_ttl: float = 3600.0) -> None:
        self._cache: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._max_size = max_size
        self._default_ttl = default_ttl
        self._lock = threading.Lock()
        self._hits = 0
        self._misses = 0

    def get(self, key: str) -> Any | None:
        with self._lock:
            if key in self._cache:
                value, expires_at = self._cache[key]
                if time.time() < expires_at:
                    self._cache.move_to_end(key)
                    self._hits += 1
                    return value
                else:
                    del self._cache[key]
            self._misses += 1
            return None

    def put(self, key: str, value: Any, ttl: float | None = None) -> None:
        with self._lock:
            if key in self._cache:
                del self._cache[key]
            elif len(self._cache) >= self._max_size:
                self._cache.popitem(last=False)

            expires_at = time.time() + (ttl or self._default_ttl)
            self._cache[key] = (value, expires_at)

    def delete(self, key: str) -> bool:
        with self._lock:
            if key in self._cache:
                del self._cache[key]
                return True
            return False

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()

    @property
    def size(self) -> int:
        return len(self._cache)

    @property
    def hit_rate(self) -> float:
        total = self._hits + self._misses
        return self._hits / total if total > 0 else 0.0

    @property
    def stats(self) -> dict[str, Any]:
        return {
            "size": self.size,
            "max_size": self._max_size,
            "hits": self._hits,
            "misses": self._misses,
            "hit_rate": round(self.hit_rate, 4),
        }


class RedisFeatureStore:
    """Redis-backed distributed feature store for production deployments."""

    def __init__(self, redis_url: str, prefix: str = "ngapp:features:", ttl: int = 3600) -> None:
        self._redis_url = redis_url
        self._prefix = prefix
        self._ttl = ttl
        self._client = None

    @property
    def client(self):
        if self._client is None:
            try:
                import redis
                self._client = redis.from_url(self._redis_url)
            except ImportError:
                raise RuntimeError("redis package required: pip install redis")
        return self._client

    def _key(self, table: str, entity_id: str) -> str:
        return f"{self._prefix}{table}:{entity_id}"

    def get(self, table: str, entity_id: str) -> dict[str, Any] | None:
        data = self.client.get(self._key(table, entity_id))
        if data:
            return json.loads(data)
        return None

    def put(self, table: str, entity_id: str, features: dict[str, Any]) -> None:
        key = self._key(table, entity_id)
        self.client.setex(key, self._ttl, json.dumps(features, default=str))

    def mget(self, table: str, entity_ids: list[str]) -> dict[str, dict[str, Any] | None]:
        keys = [self._key(table, eid) for eid in entity_ids]
        values = self.client.mget(keys)
        result = {}
        for eid, val in zip(entity_ids, values):
            result[eid] = json.loads(val) if val else None
        return result

    def delete(self, table: str, entity_id: str) -> None:
        self.client.delete(self._key(table, entity_id))


class OnlineFeatureServer:
    """Production-grade online feature serving with multi-level caching.

    Architecture:
    1. L1: In-memory LRU cache (microsecond latency)
    2. L2: Redis distributed cache (millisecond latency) [optional]
    3. L3: Delta Lake offline store (100ms+ latency) [fallback]
    """

    def __init__(self, config: ServingConfig | None = None) -> None:
        self.config = config or ServingConfig()
        self._l1_cache = LRUCache(
            max_size=self.config.max_cache_size,
            default_ttl=self.config.default_ttl_seconds,
        )
        self._l2_cache: RedisFeatureStore | None = None
        if self.config.redis_url:
            self._l2_cache = RedisFeatureStore(
                self.config.redis_url,
                self.config.redis_prefix,
                self.config.redis_ttl_seconds,
            )
        self._lakehouse_path = Path(self.config.lakehouse_path)
        self._table_indexes: dict[str, dict[str, int]] = {}
        self._table_data: dict[str, pd.DataFrame] = {}
        self._materialize_thread: threading.Thread | None = None
        self._running = False
        self._request_count = 0
        self._total_latency_ms = 0.0

    def start(self) -> None:
        """Start the feature server and warm up caches."""
        self._running = True
        if self.config.cache_warmup_on_start:
            self._warmup_cache()

        if self.config.materialize_interval_seconds > 0:
            self._materialize_thread = threading.Thread(
                target=self._materialize_loop,
                name="feature-materializer",
                daemon=True,
            )
            self._materialize_thread.start()

    def stop(self) -> None:
        """Stop the feature server."""
        self._running = False
        if self._materialize_thread:
            self._materialize_thread.join(timeout=5)

    def get_features(
        self,
        table_name: str,
        entity_id: str,
        feature_names: list[str] | None = None,
    ) -> FeatureVector | None:
        """Get features for a single entity from the serving layer.

        Checks L1 → L2 → L3 with read-through caching.
        """
        start_time = time.time()
        cache_key = f"{table_name}:{entity_id}"

        # L1: In-memory cache
        cached = self._l1_cache.get(cache_key)
        if cached is not None:
            self._record_latency(start_time)
            return self._filter_features(cached, feature_names)

        # L2: Redis cache
        if self._l2_cache:
            redis_data = self._l2_cache.get(table_name, entity_id)
            if redis_data:
                fv = FeatureVector(
                    entity_id=entity_id,
                    features=redis_data,
                    timestamp=time.time(),
                    source_table=table_name,
                )
                self._l1_cache.put(cache_key, fv)
                self._record_latency(start_time)
                return self._filter_features(fv, feature_names)

        # L3: Offline store (Delta Lake / Parquet)
        if self.config.materialize_on_miss:
            fv = self._read_from_offline(table_name, entity_id)
            if fv:
                self._l1_cache.put(cache_key, fv)
                if self._l2_cache:
                    self._l2_cache.put(table_name, entity_id, fv.features)
                self._record_latency(start_time)
                return self._filter_features(fv, feature_names)

        self._record_latency(start_time)
        return None

    def get_features_batch(
        self,
        table_name: str,
        entity_ids: list[str],
        feature_names: list[str] | None = None,
    ) -> dict[str, FeatureVector | None]:
        """Get features for multiple entities (batch lookup)."""
        results: dict[str, FeatureVector | None] = {}
        missing_ids = []

        # Check L1 cache first
        for eid in entity_ids:
            cache_key = f"{table_name}:{eid}"
            cached = self._l1_cache.get(cache_key)
            if cached is not None:
                results[eid] = self._filter_features(cached, feature_names)
            else:
                missing_ids.append(eid)

        # Check L2 for misses
        if missing_ids and self._l2_cache:
            redis_results = self._l2_cache.mget(table_name, missing_ids)
            still_missing = []
            for eid, data in redis_results.items():
                if data:
                    fv = FeatureVector(
                        entity_id=eid,
                        features=data,
                        timestamp=time.time(),
                        source_table=table_name,
                    )
                    self._l1_cache.put(f"{table_name}:{eid}", fv)
                    results[eid] = self._filter_features(fv, feature_names)
                else:
                    still_missing.append(eid)
            missing_ids = still_missing

        # L3 for remaining misses
        if missing_ids and self.config.materialize_on_miss:
            for eid in missing_ids:
                fv = self._read_from_offline(table_name, eid)
                if fv:
                    self._l1_cache.put(f"{table_name}:{eid}", fv)
                    results[eid] = self._filter_features(fv, feature_names)
                else:
                    results[eid] = None

        return results

    def get_training_dataset(
        self,
        table_name: str,
        feature_names: list[str],
        label_col: str,
        limit: int | None = None,
    ) -> tuple[np.ndarray, np.ndarray]:
        """Get a training dataset (X, y) from the offline store."""
        df = self._load_table(table_name)
        if df is None or df.empty:
            return np.array([]), np.array([])

        available_features = [f for f in feature_names if f in df.columns]
        if label_col not in df.columns:
            return np.array([]), np.array([])

        if limit:
            df = df.tail(limit)

        X = df[available_features].values.astype(np.float32)
        y = df[label_col].values.astype(np.float32)
        return X, y

    def point_in_time_lookup(
        self,
        table_name: str,
        entity_id: str,
        timestamp: float,
        feature_names: list[str] | None = None,
    ) -> FeatureVector | None:
        """Get features as they were at a specific point in time."""
        df = self._load_table(table_name)
        if df is None or df.empty:
            return None

        # Find the primary key column
        pk_candidates = ["claim_id", "customer_id", "txn_id", "policy_id", "id"]
        pk_col = None
        for pk in pk_candidates:
            if pk in df.columns:
                pk_col = pk
                break

        if pk_col is None:
            return None

        # Filter by entity
        entity_df = df[df[pk_col].astype(str) == str(entity_id)]
        if entity_df.empty:
            return None

        # Find timestamp column and filter
        ts_candidates = ["event_timestamp", "_ingested_at", "created_at", "submitted_at", "updated_at", "timestamp"]
        ts_col = None
        for tc in ts_candidates:
            if tc in entity_df.columns:
                ts_col = tc
                break

        if ts_col:
            entity_df = entity_df[entity_df[ts_col].astype(float) <= timestamp]
            if entity_df.empty:
                return None
            row = entity_df.iloc[-1]
        else:
            row = entity_df.iloc[-1]

        features = {col: row[col] for col in row.index if col != pk_col}
        if feature_names:
            features = {k: v for k, v in features.items() if k in feature_names}

        return FeatureVector(
            entity_id=entity_id,
            features=features,
            timestamp=timestamp,
            source_table=table_name,
        )

    def materialize(self, table_name: str) -> int:
        """Materialize features from offline store into the serving layer cache."""
        df = self._load_table(table_name)
        if df is None or df.empty:
            return 0

        pk_candidates = ["claim_id", "customer_id", "txn_id", "policy_id", "id"]
        pk_col = None
        for pk in pk_candidates:
            if pk in df.columns:
                pk_col = pk
                break

        if pk_col is None:
            return 0

        count = 0
        for _, row in df.iterrows():
            entity_id = str(row[pk_col])
            features = {col: row[col] for col in row.index if col != pk_col}
            fv = FeatureVector(
                entity_id=entity_id,
                features=features,
                timestamp=time.time(),
                source_table=table_name,
            )
            self._l1_cache.put(f"{table_name}:{entity_id}", fv)
            if self._l2_cache:
                self._l2_cache.put(table_name, entity_id, features)
            count += 1

        return count

    def _warmup_cache(self) -> None:
        """Warm up L1 cache from offline store on startup."""
        tables = ["fraud_features", "churn_features", "claims_features", "anomaly_features"]
        for table in tables:
            table_path = self._lakehouse_path / table
            if table_path.exists():
                count = self.materialize(table)
                if count > 0:
                    print(f"  [FeatureServer] Warmed cache for '{table}': {count} entities")

    def _materialize_loop(self) -> None:
        """Periodic materialization of features from offline to online store."""
        while self._running:
            time.sleep(self.config.materialize_interval_seconds)
            tables = ["fraud_features", "churn_features", "claims_features", "anomaly_features"]
            for table in tables:
                try:
                    self.materialize(table)
                except Exception:
                    pass

    def _load_table(self, table_name: str) -> pd.DataFrame | None:
        """Load a table from the offline store."""
        if table_name in self._table_data:
            return self._table_data[table_name]

        table_path = self._lakehouse_path / table_name
        if not table_path.exists():
            return None

        try:
            from deltalake import DeltaTable
            dt = DeltaTable(str(table_path))
            df = dt.to_pandas()
        except (ImportError, Exception):
            parquet_files = list(table_path.glob("*.parquet"))
            if parquet_files:
                dfs = [pd.read_parquet(f) for f in parquet_files]
                df = pd.concat(dfs, ignore_index=True) if dfs else pd.DataFrame()
            else:
                return None

        self._table_data[table_name] = df
        return df

    def _read_from_offline(self, table_name: str, entity_id: str) -> FeatureVector | None:
        """Read a single entity's features from the offline store."""
        df = self._load_table(table_name)
        if df is None or df.empty:
            return None

        pk_candidates = ["claim_id", "customer_id", "txn_id", "policy_id", "id"]
        pk_col = None
        for pk in pk_candidates:
            if pk in df.columns:
                pk_col = pk
                break

        if pk_col is None:
            return None

        match = df[df[pk_col].astype(str) == str(entity_id)]
        if match.empty:
            return None

        row = match.iloc[-1]
        features = {col: row[col] for col in row.index if col != pk_col}

        return FeatureVector(
            entity_id=entity_id,
            features=features,
            timestamp=time.time(),
            source_table=table_name,
        )

    def _filter_features(self, fv: FeatureVector, feature_names: list[str] | None) -> FeatureVector:
        """Filter a feature vector to only include requested features."""
        if feature_names is None:
            return fv
        filtered = {k: v for k, v in fv.features.items() if k in feature_names}
        return FeatureVector(
            entity_id=fv.entity_id,
            features=filtered,
            timestamp=fv.timestamp,
            source_table=fv.source_table,
        )

    def _record_latency(self, start_time: float) -> None:
        self._request_count += 1
        self._total_latency_ms += (time.time() - start_time) * 1000

    def get_status(self) -> dict[str, Any]:
        """Get serving layer status and metrics."""
        avg_latency = self._total_latency_ms / max(self._request_count, 1)
        return {
            "running": self._running,
            "cache_stats": self._l1_cache.stats,
            "redis_enabled": self._l2_cache is not None,
            "tables_loaded": list(self._table_data.keys()),
            "total_requests": self._request_count,
            "avg_latency_ms": round(avg_latency, 3),
            "config": {
                "max_cache_size": self.config.max_cache_size,
                "ttl_seconds": self.config.default_ttl_seconds,
                "materialize_interval": self.config.materialize_interval_seconds,
            },
        }
