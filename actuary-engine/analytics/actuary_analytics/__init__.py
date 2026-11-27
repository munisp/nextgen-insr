"""actuary_analytics — offline actuarial analytics package (Leg C of the actuary engine).

Real library calls on every compute path:
  * reserving : chainladder (CL / Bornhuetter-Ferguson / Mack)
  * life      : lifelines (Kaplan-Meier / Weibull) + deterministic PV math
  * freqsev   : statsmodels GLM (Poisson / Gamma / Tweedie)
  * capital   : actuary_kernels_py (PyO3) when importable, else a documented
                HTTP batch client to the pricing service. No MC math is
                duplicated in Python.

Wire doubles are permitted ONLY at HTTP / object-store boundaries.
Fail-closed posture preserved from actuarial-platform: when no claims data
source is configured, reserve computations raise DataSourceUnavailableError
(HTTP 503 at the app boundary) instead of serving canned numbers.
"""

__version__ = "0.1.0"
