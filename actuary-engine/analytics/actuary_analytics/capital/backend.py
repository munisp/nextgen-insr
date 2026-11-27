"""Capital backend selection: PyO3 kernel when importable, else the HTTP
batch client. Contains NO simulation math (design Appendix C: the Rust
kernel is the single numeric implementation across Go and Python)."""

from __future__ import annotations

import importlib
import os
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from .client import CapitalBackendUnavailableError, PricingServiceBatchClient

# dist codes mirror the frozen FFI contract (Appendix C)
FREQ_DIST_CODES = {"poisson": 0, "negbin": 1, "gamma": 2, "lognormal": 3, "tweedie": 4}


@dataclass(frozen=True)
class LineSimSpec:
    """One product line's frequency-severity simulation specification."""

    line: str
    freq_dist: str
    freq_params: dict[str, float]
    sev_dist: str
    sev_params: dict[str, float]

    def to_wire(self) -> dict[str, Any]:
        return {
            "line": self.line,
            "freqDist": FREQ_DIST_CODES[self.freq_dist],
            "freqParams": dict(self.freq_params),
            "sevDist": FREQ_DIST_CODES[self.sev_dist],
            "sevParams": dict(self.sev_params),
        }


@dataclass(frozen=True)
class CapitalResult:
    var_995: float
    tvar_99: float
    mean: float
    per_line_tvar: dict[str, float] | None
    backend: str


def _try_import_kernels():
    try:
        return importlib.import_module("actuary_kernels_py")
    except ImportError:
        return None


def get_backend(
    *,
    kernels_module: Any | None = None,
    pricing_service_url: str | None = None,
    http_transport: Any | None = None,
) -> Any:
    """Resolve the capital backend.

    Priority: (1) actuary_kernels_py (PyO3) if importable — or an explicitly
    supplied kernels module; (2) HTTP batch client to the pricing service
    (PRICING_SERVICE_URL env or explicit argument). Raises
    CapitalBackendUnavailableError when neither is available.
    """
    kernels = kernels_module if kernels_module is not None else _try_import_kernels()
    if kernels is not None:
        return kernels
    url = pricing_service_url or os.environ.get("PRICING_SERVICE_URL", "").strip()
    if url:
        return PricingServiceBatchClient(url, transport=http_transport)
    raise CapitalBackendUnavailableError(
        "no capital backend: actuary_kernels_py is not importable and no "
        "PRICING_SERVICE_URL is configured"
    )


def simulate_aggregate(
    lines: Sequence[LineSimSpec],
    corr: Sequence[Sequence[float]],
    n_paths: int,
    seed: int,
    *,
    backend: Any | None = None,
) -> CapitalResult:
    """Run the aggregate-loss simulation via the resolved backend and
    normalize the result. All computation happens in the backend (Rust
    kernel or pricing service) — this function only marshals data."""
    if backend is None:
        backend = get_backend()
    wire_lines = [spec.to_wire() for spec in lines]
    if hasattr(backend, "simulate"):
        # HTTP batch client path (documented boundary).
        body = backend.simulate(wire_lines, [list(map(float, r)) for r in corr], n_paths, seed)
        return CapitalResult(
            var_995=float(body["var_995"]),
            tvar_99=float(body["tvar_99"]),
            mean=float(body["mean"]),
            per_line_tvar=body.get("per_line_tvar"),
            backend="http_batch",
        )
    # PyO3 path: ak_montecarlo_aggregate-equivalent callable.
    result = backend.montecarlo_aggregate(
        wire_lines, [list(map(float, r)) for r in corr], n_paths, seed
    )
    var_995, tvar_99, mean = result[0], result[1], result[2]
    per_line = result[3] if len(result) > 3 else None
    if per_line is not None:
        per_line = {spec.line: float(v) for spec, v in zip(lines, per_line)}
    return CapitalResult(
        var_995=float(var_995),
        tvar_99=float(tvar_99),
        mean=float(mean),
        per_line_tvar=per_line,
        backend="pyo3",
    )
