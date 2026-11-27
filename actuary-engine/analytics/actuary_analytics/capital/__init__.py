"""Capital: thin adapter over the Rust MC kernel.

Backend selection (documented, honest):
  1. ``actuary_kernels_py`` (PyO3, built by W34-A) when importable — the
     real kernel, guaranteeing one numeric implementation across Go and
     Python batch.
  2. Otherwise a documented HTTP batch client boundary to the pricing
     service (POST /v1/capital/simulate). Wire doubles are permitted ONLY
     at this HTTP boundary in tests.

NO Monte-Carlo mathematics is implemented in Python — this package contains
no simulation code, by design (design §4.d, Appendix C).
"""

from .backend import (
    CapitalBackendUnavailableError,
    CapitalResult,
    LineSimSpec,
    get_backend,
    simulate_aggregate,
)
from .client import CAPITAL_BATCH_PATH, PricingServiceBatchClient

__all__ = [
    "CAPITAL_BATCH_PATH",
    "CapitalBackendUnavailableError",
    "CapitalResult",
    "LineSimSpec",
    "PricingServiceBatchClient",
    "get_backend",
    "simulate_aggregate",
]
