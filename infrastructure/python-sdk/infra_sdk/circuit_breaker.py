"""Circuit breaker and retry with exponential backoff for Python services."""

import asyncio
import enum
import logging
import random
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, TypeVar

import httpx

logger = logging.getLogger(__name__)

T = TypeVar("T")


class CircuitState(enum.Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half-open"


@dataclass
class CircuitBreakerConfig:
    name: str = "default"
    failure_threshold: int = 5
    success_threshold: int = 3
    timeout_seconds: float = 30.0
    half_open_max: int = 1


class CircuitBreaker:
    """Implements the circuit breaker pattern for inter-service calls."""

    def __init__(self, config: Optional[CircuitBreakerConfig] = None):
        self.config = config or CircuitBreakerConfig()
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._last_failure: float = 0
        self._half_open_current = 0
        self._lock = asyncio.Lock()

    @property
    def state(self) -> str:
        return self._state.value

    async def execute(self, fn: Callable, *args: Any, **kwargs: Any) -> Any:
        async with self._lock:
            if not self._can_execute():
                raise CircuitOpenError(f"Circuit breaker '{self.config.name}' is open")

        try:
            if asyncio.iscoroutinefunction(fn):
                result = await fn(*args, **kwargs)
            else:
                result = fn(*args, **kwargs)
            await self._record_success()
            return result
        except Exception as e:
            await self._record_failure()
            raise

    def _can_execute(self) -> bool:
        if self._state == CircuitState.CLOSED:
            return True

        if self._state == CircuitState.OPEN:
            if time.time() - self._last_failure > self.config.timeout_seconds:
                self._state = CircuitState.HALF_OPEN
                self._half_open_current = 0
                self._success_count = 0
                logger.info("Circuit breaker '%s' entering half-open state", self.config.name)
                return True
            return False

        if self._state == CircuitState.HALF_OPEN:
            if self._half_open_current >= self.config.half_open_max:
                return False
            self._half_open_current += 1
            return True

        return False

    async def _record_success(self) -> None:
        async with self._lock:
            if self._state == CircuitState.HALF_OPEN:
                self._success_count += 1
                if self._success_count >= self.config.success_threshold:
                    self._state = CircuitState.CLOSED
                    self._failure_count = 0
                    self._success_count = 0
                    logger.info("Circuit breaker '%s' closed", self.config.name)
            else:
                self._failure_count = 0

    async def _record_failure(self) -> None:
        async with self._lock:
            self._failure_count += 1
            self._last_failure = time.time()

            if self._state == CircuitState.HALF_OPEN:
                self._state = CircuitState.OPEN
                logger.warning("Circuit breaker '%s' reopened", self.config.name)
            elif self._failure_count >= self.config.failure_threshold:
                self._state = CircuitState.OPEN
                logger.warning(
                    "Circuit breaker '%s' opened (failures=%d)",
                    self.config.name,
                    self._failure_count,
                )


class CircuitOpenError(Exception):
    """Raised when a circuit breaker is open."""
    pass


@dataclass
class RetryConfig:
    max_retries: int = 3
    base_delay: float = 0.1
    max_delay: float = 5.0
    multiplier: float = 2.0
    jitter_ratio: float = 0.1


async def retry_with_backoff(
    fn: Callable,
    config: Optional[RetryConfig] = None,
    *args: Any,
    **kwargs: Any,
) -> Any:
    """Execute fn with exponential backoff and jitter."""
    cfg = config or RetryConfig()
    last_error: Optional[Exception] = None

    for attempt in range(cfg.max_retries + 1):
        try:
            if asyncio.iscoroutinefunction(fn):
                return await fn(*args, **kwargs)
            return fn(*args, **kwargs)
        except Exception as e:
            last_error = e
            if attempt == cfg.max_retries:
                break

            delay = min(cfg.base_delay * (cfg.multiplier ** attempt), cfg.max_delay)
            jitter = delay * cfg.jitter_ratio * (random.random() * 2 - 1)
            await asyncio.sleep(delay + jitter)

    raise last_error  # type: ignore[misc]


class ResilientHTTPClient:
    """HTTP client with circuit breaker and retry logic."""

    def __init__(
        self,
        service_name: str,
        base_url: str,
        timeout: float = 10.0,
        breaker_config: Optional[CircuitBreakerConfig] = None,
        retry_config: Optional[RetryConfig] = None,
    ):
        self.service_name = service_name
        self.base_url = base_url.rstrip("/")
        self.client = httpx.AsyncClient(timeout=timeout)
        self.breaker = CircuitBreaker(
            breaker_config or CircuitBreakerConfig(name=service_name)
        )
        self.retry_config = retry_config or RetryConfig()

    async def get(self, path: str, **kwargs: Any) -> httpx.Response:
        return await self._request("GET", path, **kwargs)

    async def post(self, path: str, **kwargs: Any) -> httpx.Response:
        return await self._request("POST", path, **kwargs)

    async def put(self, path: str, **kwargs: Any) -> httpx.Response:
        return await self._request("PUT", path, **kwargs)

    async def delete(self, path: str, **kwargs: Any) -> httpx.Response:
        return await self._request("DELETE", path, **kwargs)

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        url = f"{self.base_url}{path}"

        async def do_request() -> httpx.Response:
            resp = await self.client.request(method, url, **kwargs)
            if resp.status_code >= 500:
                raise httpx.HTTPStatusError(
                    f"Server error: {resp.status_code}",
                    request=resp.request,
                    response=resp,
                )
            return resp

        return await self.breaker.execute(
            retry_with_backoff, do_request, self.retry_config
        )

    @property
    def circuit_state(self) -> str:
        return self.breaker.state

    async def close(self) -> None:
        await self.client.aclose()
