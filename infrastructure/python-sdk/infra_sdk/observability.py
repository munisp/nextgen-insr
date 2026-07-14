"""Observability: metrics collection and Prometheus-compatible export for Python services."""

import logging
import threading
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Dict

logger = logging.getLogger(__name__)


class Metrics:
    """Prometheus-compatible metrics collector."""

    def __init__(self, service_name: str):
        self.service_name = service_name
        self._lock = threading.Lock()
        self._counters: Dict[str, int] = defaultdict(int)
        self._gauges: Dict[str, float] = {}
        self._histograms: Dict[str, "_HistogramData"] = {}

    def incr_counter(self, name: str, value: int = 1) -> None:
        with self._lock:
            self._counters[name] += value

    def set_gauge(self, name: str, value: float) -> None:
        with self._lock:
            self._gauges[name] = value

    def observe_latency(self, name: str, duration_ms: float) -> None:
        with self._lock:
            if name not in self._histograms:
                self._histograms[name] = _HistogramData()
            h = self._histograms[name]
            h.count += 1
            h.total += duration_ms
            h.min_val = min(h.min_val, duration_ms) if h.count > 1 else duration_ms
            h.max_val = max(h.max_val, duration_ms)

    def prometheus_text(self) -> str:
        lines = []
        with self._lock:
            for name, value in sorted(self._counters.items()):
                lines.append(f"# TYPE {self.service_name}_{name} counter")
                lines.append(f"{self.service_name}_{name} {value}")

            for name, value in sorted(self._gauges.items()):
                lines.append(f"# TYPE {self.service_name}_{name} gauge")
                lines.append(f"{self.service_name}_{name} {value}")

            for name, h in sorted(self._histograms.items()):
                lines.append(f"# TYPE {self.service_name}_{name} summary")
                lines.append(f"{self.service_name}_{name}_count {h.count}")
                lines.append(f"{self.service_name}_{name}_sum {h.total:.2f}")
                if h.count > 0:
                    lines.append(f"{self.service_name}_{name}_min {h.min_val:.2f}")
                    lines.append(f"{self.service_name}_{name}_max {h.max_val:.2f}")
                    lines.append(
                        f"{self.service_name}_{name}_avg {h.total / h.count:.2f}"
                    )

        return "\n".join(lines) + "\n"

    def json_snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "service": self.service_name,
                "timestamp": time.time(),
                "counters": dict(self._counters),
                "gauges": dict(self._gauges),
                "latencies": {
                    name: {
                        "count": h.count,
                        "sum": h.total,
                        "min": h.min_val if h.count > 0 else 0,
                        "max": h.max_val if h.count > 0 else 0,
                        "avg": h.total / h.count if h.count > 0 else 0,
                    }
                    for name, h in self._histograms.items()
                },
            }


@dataclass
class _HistogramData:
    count: int = 0
    total: float = 0.0
    min_val: float = 0.0
    max_val: float = 0.0


class RequestMetricsMiddleware:
    """ASGI middleware that collects HTTP request metrics."""

    def __init__(self, app: Any, metrics: Metrics):
        self.app = app
        self.metrics = metrics

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        start = time.time()
        status_code = 200

        async def send_wrapper(message: Any) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message.get("status", 200)
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            duration_ms = (time.time() - start) * 1000
            self.metrics.incr_counter("http_requests_total")
            self.metrics.observe_latency("http_request_duration_ms", duration_ms)
            if 400 <= status_code < 500:
                self.metrics.incr_counter("http_client_errors_total")
            elif status_code >= 500:
                self.metrics.incr_counter("http_server_errors_total")
