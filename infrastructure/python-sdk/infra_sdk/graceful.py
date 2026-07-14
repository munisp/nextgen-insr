"""Graceful shutdown and health probe support for Python services."""

import asyncio
import logging
import os
import signal
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class ComponentHealth:
    name: str
    connected: bool
    latency_ms: float = 0.0
    error: str = ""


class HealthRegistry:
    """Tracks health of all registered components."""

    def __init__(self, service_name: str):
        self.service_name = service_name
        self.started = time.time()
        self._checks: Dict[str, Callable] = {}
        self._ready = True

    def register(self, name: str, check_fn: Callable) -> None:
        self._checks[name] = check_fn

    def set_ready(self, ready: bool) -> None:
        self._ready = ready

    @property
    def is_ready(self) -> bool:
        return self._ready

    async def check_all(self) -> Dict[str, Any]:
        results = {}
        all_healthy = True

        for name, check_fn in self._checks.items():
            start = time.time()
            try:
                if asyncio.iscoroutinefunction(check_fn):
                    await asyncio.wait_for(check_fn(), timeout=5.0)
                else:
                    check_fn()
                latency_ms = (time.time() - start) * 1000
                results[name] = ComponentHealth(
                    name=name, connected=True, latency_ms=latency_ms
                )
            except Exception as e:
                latency_ms = (time.time() - start) * 1000
                all_healthy = False
                results[name] = ComponentHealth(
                    name=name, connected=False, latency_ms=latency_ms, error=str(e)
                )

        return {
            "status": "healthy" if all_healthy else "degraded",
            "service": self.service_name,
            "uptime_seconds": time.time() - self.started,
            "components": {
                name: {
                    "connected": h.connected,
                    "latency_ms": round(h.latency_ms, 2),
                    "error": h.error,
                }
                for name, h in results.items()
            },
        }

    def health_response(self) -> Dict[str, Any]:
        """Synchronous health response for simple checks."""
        return {
            "status": "healthy" if self._ready else "degraded",
            "service": self.service_name,
            "uptime_seconds": round(time.time() - self.started, 2),
        }

    def liveness_response(self) -> Dict[str, Any]:
        return {"alive": True, "service": self.service_name}

    def readiness_response(self) -> Dict[str, Any]:
        return {"ready": self._ready, "service": self.service_name}


class GracefulShutdown:
    """Manages graceful shutdown with signal handling and cleanup hooks."""

    def __init__(self, service_name: str):
        self.service_name = service_name
        self._cleanup_hooks: List[Callable] = []
        self._shutdown_event = asyncio.Event()
        self._shutting_down = False

    def add_cleanup(self, fn: Callable) -> None:
        self._cleanup_hooks.append(fn)

    def setup_signals(self, loop: Optional[asyncio.AbstractEventLoop] = None) -> None:
        loop = loop or asyncio.get_event_loop()

        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, lambda s=sig: self._handle_signal(s))

        logger.info("Signal handlers registered for %s", self.service_name)

    def _handle_signal(self, sig: signal.Signals) -> None:
        if self._shutting_down:
            logger.warning("Force shutdown requested for %s", self.service_name)
            os._exit(1)

        self._shutting_down = True
        logger.info(
            "Shutdown signal %s received for %s", sig.name, self.service_name
        )
        self._shutdown_event.set()

    async def wait_for_shutdown(self) -> None:
        await self._shutdown_event.wait()

    async def cleanup(self) -> None:
        logger.info("Running cleanup hooks for %s", self.service_name)
        for hook in reversed(self._cleanup_hooks):
            try:
                if asyncio.iscoroutinefunction(hook):
                    await asyncio.wait_for(hook(), timeout=10.0)
                else:
                    hook()
            except Exception as e:
                logger.error("Cleanup hook failed: %s", e)
        logger.info("Graceful shutdown complete for %s", self.service_name)

    @property
    def is_shutting_down(self) -> bool:
        return self._shutting_down
