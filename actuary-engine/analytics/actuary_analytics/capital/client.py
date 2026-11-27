"""Documented HTTP batch client boundary to the pricing service.

Used when actuary_kernels_py is not importable in this environment (e.g.
the analytics container is built before the PyO3 wheel ships). The client
delegates ALL Monte-Carlo computation to the pricing service's cgo-bound
Rust kernel (ak_montecarlo_aggregate) — this module performs no numeric
simulation itself.

Retry/timeout posture follows the platform's service-call precedent
(goServiceBridge): bounded retries with backoff, short timeout, failures
propagate — never silently fabricated numbers.
"""

from __future__ import annotations

import time
from typing import Any

import httpx

CAPITAL_BATCH_PATH = "/v1/capital/simulate"


class CapitalBackendUnavailableError(Exception):
    """No capital compute backend is reachable (PyO3 import failed AND the
    HTTP batch boundary is unconfigured/unreachable)."""


class PricingServiceBatchClient:
    """Batch client to the pricing service's capital simulation endpoint."""

    def __init__(
        self,
        base_url: str,
        *,
        timeout_seconds: float = 30.0,
        max_retries: int = 2,
        backoff_seconds: float = 0.5,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if not base_url:
            raise CapitalBackendUnavailableError(
                "capital backend unavailable: actuary_kernels_py not importable "
                "and no PRICING_SERVICE_URL configured for the HTTP batch client"
            )
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_seconds
        self._max_retries = max_retries
        self._backoff = backoff_seconds
        self._transport = transport

    def simulate(
        self,
        lines: list[dict[str, Any]],
        corr: list[list[float]],
        n_paths: int,
        seed: int,
    ) -> dict[str, Any]:
        """POST the aggregate-loss simulation batch. Returns the service's
        result dict (var_995, tvar_99, mean, per_line_tvar)."""
        payload = {
            "lines": lines,
            "corr": corr,
            "nPaths": n_paths,
            "seed": seed,
        }
        last_exc: Exception | None = None
        for attempt in range(self._max_retries + 1):
            try:
                with httpx.Client(
                    transport=self._transport, timeout=self._timeout
                ) as client:
                    response = client.post(
                        self._base_url + CAPITAL_BATCH_PATH, json=payload
                    )
                response.raise_for_status()
                body = response.json()
                # Contract validation — fail closed on a malformed boundary.
                required = {"var_995", "tvar_99", "mean"}
                missing = required - set(body)
                if missing:
                    raise CapitalBackendUnavailableError(
                        f"capital batch response missing fields: {sorted(missing)}"
                    )
                return body
            except (httpx.HTTPError, ValueError) as exc:
                last_exc = exc
                if attempt < self._max_retries:
                    time.sleep(self._backoff * (2**attempt))
        raise CapitalBackendUnavailableError(
            f"capital batch endpoint {self._base_url + CAPITAL_BATCH_PATH} failed "
            f"after {self._max_retries + 1} attempts: {last_exc}"
        )
