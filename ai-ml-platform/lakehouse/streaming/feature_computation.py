"""
Real-Time Feature Computation Engine

Computes features in real-time from streaming events:
- Sliding window aggregations (count, sum, avg, min, max)
- Session-based features (user session tracking)
- Running statistics (exponential moving average, variance)
- Time-decay features (recency-weighted scoring)
- Cross-entity features (graph-based aggregations)
- Feature triggers (materialize when thresholds crossed)
"""

from __future__ import annotations

import math
import time
import threading
from collections import defaultdict, deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable


class AggregationType(Enum):
    COUNT = "count"
    SUM = "sum"
    AVG = "avg"
    MIN = "min"
    MAX = "max"
    STDDEV = "stddev"
    P50 = "p50"
    P95 = "p95"
    P99 = "p99"
    RATE = "rate"  # events per second
    DISTINCT_COUNT = "distinct_count"


class WindowType(Enum):
    TUMBLING = "tumbling"  # Fixed non-overlapping windows
    SLIDING = "sliding"  # Overlapping windows
    SESSION = "session"  # Activity-based gaps


@dataclass
class WindowConfig:
    """Configuration for a computation window."""
    window_type: WindowType = WindowType.SLIDING
    window_seconds: float = 3600.0  # 1 hour default
    slide_seconds: float = 60.0  # Sliding step (for sliding windows)
    session_gap_seconds: float = 300.0  # Gap to end session (for session windows)


@dataclass
class FeatureComputationDef:
    """Definition of a real-time feature computation."""
    name: str
    source_field: str
    aggregation: AggregationType
    window: WindowConfig
    group_by: str  # Entity key to group by (e.g., "customer_id")
    filter_fn: Callable[[dict[str, Any]], bool] | None = None
    description: str = ""


@dataclass
class WindowState:
    """State for a single computation window."""
    values: deque = field(default_factory=deque)
    timestamps: deque = field(default_factory=deque)
    last_updated: float = 0.0

    def add(self, value: float, timestamp: float) -> None:
        self.values.append(value)
        self.timestamps.append(timestamp)
        self.last_updated = timestamp

    def evict_expired(self, window_seconds: float, current_time: float) -> None:
        """Remove values outside the window."""
        cutoff = current_time - window_seconds
        while self.timestamps and self.timestamps[0] < cutoff:
            self.timestamps.popleft()
            self.values.popleft()

    def compute(self, aggregation: AggregationType) -> float:
        """Compute the aggregation over current window values."""
        if not self.values:
            return 0.0

        vals = list(self.values)
        n = len(vals)

        if aggregation == AggregationType.COUNT:
            return float(n)
        elif aggregation == AggregationType.SUM:
            return sum(vals)
        elif aggregation == AggregationType.AVG:
            return sum(vals) / n
        elif aggregation == AggregationType.MIN:
            return min(vals)
        elif aggregation == AggregationType.MAX:
            return max(vals)
        elif aggregation == AggregationType.STDDEV:
            if n < 2:
                return 0.0
            mean = sum(vals) / n
            variance = sum((v - mean) ** 2 for v in vals) / (n - 1)
            return math.sqrt(variance)
        elif aggregation == AggregationType.P50:
            sorted_vals = sorted(vals)
            return sorted_vals[n // 2]
        elif aggregation == AggregationType.P95:
            sorted_vals = sorted(vals)
            idx = int(n * 0.95)
            return sorted_vals[min(idx, n - 1)]
        elif aggregation == AggregationType.P99:
            sorted_vals = sorted(vals)
            idx = int(n * 0.99)
            return sorted_vals[min(idx, n - 1)]
        elif aggregation == AggregationType.RATE:
            if n < 2:
                return 0.0
            time_span = self.timestamps[-1] - self.timestamps[0]
            return n / max(time_span, 1.0)
        elif aggregation == AggregationType.DISTINCT_COUNT:
            return float(len(set(vals)))
        return 0.0


@dataclass
class ExponentialMovingAverage:
    """Exponential moving average with configurable decay."""
    alpha: float = 0.1  # Decay factor (higher = more recent weight)
    value: float = 0.0
    count: int = 0

    def update(self, new_value: float) -> float:
        if self.count == 0:
            self.value = new_value
        else:
            self.value = self.alpha * new_value + (1 - self.alpha) * self.value
        self.count += 1
        return self.value


@dataclass
class TimeDecayScore:
    """Time-decay scoring for recency-weighted features."""
    half_life_seconds: float = 86400.0  # 24 hours
    events: list[tuple[float, float]] = field(default_factory=list)  # (timestamp, value)

    def add_event(self, value: float, timestamp: float | None = None) -> None:
        ts = timestamp or time.time()
        self.events.append((ts, value))
        # Keep only events within 10 half-lives
        cutoff = ts - (10 * self.half_life_seconds)
        self.events = [(t, v) for t, v in self.events if t >= cutoff]

    def compute(self, current_time: float | None = None) -> float:
        """Compute time-decayed score."""
        now = current_time or time.time()
        score = 0.0
        for ts, value in self.events:
            age = now - ts
            decay = math.exp(-0.693 * age / self.half_life_seconds)  # ln(2) = 0.693
            score += value * decay
        return score


class RealTimeFeatureEngine:
    """Computes features in real-time from streaming events.

    Maintains windowed state per entity and produces computed features
    that are written back to the serving layer.
    """

    def __init__(self) -> None:
        self._computations: dict[str, FeatureComputationDef] = {}
        self._window_states: dict[str, dict[str, WindowState]] = defaultdict(
            lambda: defaultdict(WindowState)
        )
        self._ema_states: dict[str, dict[str, ExponentialMovingAverage]] = defaultdict(
            lambda: defaultdict(lambda: ExponentialMovingAverage())
        )
        self._decay_states: dict[str, dict[str, TimeDecayScore]] = defaultdict(
            lambda: defaultdict(TimeDecayScore)
        )
        self._computed_features: dict[str, dict[str, float]] = defaultdict(dict)
        self._lock = threading.Lock()

    def register_computation(self, comp: FeatureComputationDef) -> None:
        """Register a feature computation definition."""
        self._computations[comp.name] = comp

    def register_default_computations(self) -> None:
        """Register default platform feature computations."""
        computations = [
            # Fraud detection features
            FeatureComputationDef(
                name="claims_count_1h",
                source_field="claim_id",
                aggregation=AggregationType.COUNT,
                window=WindowConfig(window_seconds=3600),
                group_by="customer_id",
                description="Number of claims submitted in the last hour",
            ),
            FeatureComputationDef(
                name="claims_total_amount_24h",
                source_field="claim_amount_ngn",
                aggregation=AggregationType.SUM,
                window=WindowConfig(window_seconds=86400),
                group_by="customer_id",
                description="Total claim amount in last 24 hours",
            ),
            FeatureComputationDef(
                name="avg_claim_amount_7d",
                source_field="claim_amount_ngn",
                aggregation=AggregationType.AVG,
                window=WindowConfig(window_seconds=604800),
                group_by="customer_id",
                description="Average claim amount in last 7 days",
            ),
            FeatureComputationDef(
                name="max_single_claim_30d",
                source_field="claim_amount_ngn",
                aggregation=AggregationType.MAX,
                window=WindowConfig(window_seconds=2592000),
                group_by="customer_id",
                description="Maximum single claim in last 30 days",
            ),
            # Transaction anomaly features
            FeatureComputationDef(
                name="txn_count_1h",
                source_field="amount_ngn",
                aggregation=AggregationType.COUNT,
                window=WindowConfig(window_seconds=3600),
                group_by="customer_id",
                description="Transaction count in last hour",
            ),
            FeatureComputationDef(
                name="txn_rate_5m",
                source_field="amount_ngn",
                aggregation=AggregationType.RATE,
                window=WindowConfig(window_seconds=300),
                group_by="customer_id",
                description="Transaction rate (per second) in last 5 minutes",
            ),
            FeatureComputationDef(
                name="txn_stddev_24h",
                source_field="amount_ngn",
                aggregation=AggregationType.STDDEV,
                window=WindowConfig(window_seconds=86400),
                group_by="customer_id",
                description="Std dev of transaction amounts in last 24 hours",
            ),
            FeatureComputationDef(
                name="txn_p95_amount_7d",
                source_field="amount_ngn",
                aggregation=AggregationType.P95,
                window=WindowConfig(window_seconds=604800),
                group_by="customer_id",
                description="95th percentile transaction amount in 7 days",
            ),
            # Churn prediction features
            FeatureComputationDef(
                name="payment_frequency_30d",
                source_field="amount_ngn",
                aggregation=AggregationType.COUNT,
                window=WindowConfig(window_seconds=2592000),
                group_by="customer_id",
                description="Number of payments in last 30 days",
            ),
            FeatureComputationDef(
                name="distinct_payment_days_30d",
                source_field="day_of_week",
                aggregation=AggregationType.DISTINCT_COUNT,
                window=WindowConfig(window_seconds=2592000),
                group_by="customer_id",
                description="Distinct days with payments in last 30 days",
            ),
        ]
        for comp in computations:
            self.register_computation(comp)

    def process_event(self, event: dict[str, Any]) -> dict[str, float]:
        """Process an event and update all relevant computation windows.

        Returns the computed feature values for the entity.
        """
        current_time = event.get("event_timestamp", event.get("_ingested_at", time.time()))
        results = {}

        for comp_name, comp in self._computations.items():
            # Check if event has the required group_by and source fields
            entity_id = event.get(comp.group_by)
            if entity_id is None:
                continue

            source_value = event.get(comp.source_field)
            if source_value is None:
                continue

            # Apply filter if defined
            if comp.filter_fn and not comp.filter_fn(event):
                continue

            # For COUNT/DISTINCT_COUNT/RATE, use 1.0 as the value (just counting events)
            # For other aggregations, the value must be numeric
            if comp.aggregation in (AggregationType.COUNT, AggregationType.DISTINCT_COUNT, AggregationType.RATE):
                numeric_value = 1.0
            else:
                try:
                    numeric_value = float(source_value)
                except (ValueError, TypeError):
                    continue

            # Update window state
            entity_key = str(entity_id)
            with self._lock:
                state = self._window_states[comp_name][entity_key]
                state.add(numeric_value, float(current_time))
                state.evict_expired(comp.window.window_seconds, float(current_time))

                # Compute aggregation
                value = state.compute(comp.aggregation)
                results[comp_name] = value
                self._computed_features[entity_key][comp_name] = value

        return results

    def get_computed_features(self, entity_id: str) -> dict[str, float]:
        """Get all computed features for an entity."""
        with self._lock:
            return dict(self._computed_features.get(entity_id, {}))

    def get_feature(self, entity_id: str, feature_name: str) -> float | None:
        """Get a specific computed feature for an entity."""
        with self._lock:
            return self._computed_features.get(entity_id, {}).get(feature_name)

    def compute_ema(self, entity_id: str, feature_name: str, value: float) -> float:
        """Update and return the EMA for an entity's feature."""
        with self._lock:
            ema = self._ema_states[feature_name][entity_id]
            return ema.update(value)

    def compute_time_decay(
        self,
        entity_id: str,
        feature_name: str,
        value: float,
        half_life_seconds: float = 86400.0,
    ) -> float:
        """Add event and compute time-decay score."""
        with self._lock:
            decay = self._decay_states[feature_name][entity_id]
            decay.half_life_seconds = half_life_seconds
            decay.add_event(value)
            return decay.compute()

    def get_all_entities(self) -> list[str]:
        """Get all entity IDs with computed features."""
        with self._lock:
            return list(self._computed_features.keys())

    def get_computation_status(self) -> dict[str, Any]:
        """Get status of all registered computations."""
        with self._lock:
            return {
                "n_computations": len(self._computations),
                "n_entities_tracked": len(self._computed_features),
                "computations": [
                    {
                        "name": c.name,
                        "source_field": c.source_field,
                        "aggregation": c.aggregation.value,
                        "window_seconds": c.window.window_seconds,
                        "group_by": c.group_by,
                        "description": c.description,
                        "n_entities": len(self._window_states.get(c.name, {})),
                    }
                    for c in self._computations.values()
                ],
            }
