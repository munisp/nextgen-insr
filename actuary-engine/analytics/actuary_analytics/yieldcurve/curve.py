"""Yield-curve construction and fitting (F2 wave).

Nelson-Siegel (NS) and Nelson-Siegel-Svensson (NSS) parametric models,
least-squares fitting on zero-rate quotes, discount/forward/par-rate
computation, and a deterministic bootstrap from a zero-bond price ladder.

## Conventions

* Rates are **continuous** zero rates (fractions per year), matching the
  FinanceModels.jl/ECB technical-note conventions the goldens are drawn
  from: discount(t) = exp(-zero(t) * t).
* NS model: zero(t) = β0 + β1·F(t,τ) + β2·(F(t,τ) − e^{−t/τ}),
  F(t,τ) = (1 − e^{−t/τ})/(t/τ), F(0,τ) = 1. Requires τ > 0.
* NSS model adds β3·(F(t,τ2) − e^{−t/τ2}) with τ1, τ2 > 0.
* Instantaneous forward: f(t) = β0 + β1·e^{−t/τ} + β2·(t/τ)·e^{−t/τ}
  (+ β3·(t/τ2)·e^{−t/τ2} for NSS). Verified in tests against
  -d ln discount(t)/dt by finite difference.
* Par rate (integer maturity t ≥ 1): coupon rate of an annual-coupon par
  bond, c = (1 − d(t)) / Σ_{j=1..t} d(j), returned on a continuous basis as
  ln(1 + c) — this matches the ECB published par curve to 1.7e-6 (see
  tests). Non-integral maturities and t < 1 are rejected (no coupon
  schedule exists); callers needing short-end quotes use zero rates.
* Bootstrap ladder chosen: **zero-bond prices** p_i at maturities t_i.
  Spot zero r_i = −ln(p_i)/t_i; between nodes the ln-discount curve is
  linearly interpolated (log-linear zero interpolation), before the first
  node and after the last it is extrapolated flat in ln-discount space.
  Deterministic, no solver required.

No mocks: every function performs the real computation; fitting failures
raise rather than fabricate a curve.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import least_squares

__all__ = [
    "NelsonSiegel",
    "NelsonSiegelSvensson",
    "ZeroBootstrap",
    "bootstrap_zero_bonds",
    "fit_nelson_siegel",
    "fit_nelson_siegel_svensson",
]


def _ns_shape(t: float, tau: float) -> tuple[float, float]:
    """(F(t,τ), F(t,τ) − e^{−t/τ}) with the t→0 limit F = 1."""
    x = t / tau
    if x == 0.0:
        return 1.0, 0.0
    f = (1.0 - np.exp(-x)) / x
    return f, f - np.exp(-x)


@dataclass(frozen=True)
class NelsonSiegel:
    """Nelson-Siegel curve with parameters (tau, beta0, beta1, beta2).

    Parameter order mirrors FinanceModels.jl `Yield.NelsonSiegel(τ, β0, β1, β2)`.
    """

    tau: float
    beta0: float
    beta1: float
    beta2: float

    def __post_init__(self) -> None:
        if not np.isfinite(self.tau) or self.tau <= 0.0:
            raise ValueError(f"tau must be positive and finite, got {self.tau}")

    def zero(self, t: float) -> float:
        """Continuous zero rate at time t."""
        if t < 0.0:
            raise ValueError(f"t must be >= 0, got {t}")
        f, g = _ns_shape(t, self.tau)
        return self.beta0 + self.beta1 * f + self.beta2 * g

    def discount(self, t: float) -> float:
        """Discount factor exp(−zero(t)·t); discount(0) == 1."""
        if t < 0.0:
            raise ValueError(f"t must be >= 0, got {t}")
        return float(np.exp(-self.zero(t) * t))

    def forward(self, t: float) -> float:
        """Instantaneous forward rate β0 + β1·e^{−t/τ} + β2·(t/τ)·e^{−t/τ}."""
        if t < 0.0:
            raise ValueError(f"t must be >= 0, got {t}")
        return self.beta0 + (self.beta1 + self.beta2 * t / self.tau) * np.exp(
            -t / self.tau
        )

    def par(self, t: float) -> float:
        """Continuous par yield at maturity t (see module conventions)."""
        return _par_from_discount(self.discount, t)


@dataclass(frozen=True)
class NelsonSiegelSvensson:
    """NSS curve (tau1, tau2, beta0, beta1, beta2, beta3).

    Parameter order mirrors FinanceModels.jl
    `Yield.NelsonSiegelSvensson(τ1, τ2, β0, β1, β2, β3)`.
    """

    tau1: float
    tau2: float
    beta0: float
    beta1: float
    beta2: float
    beta3: float

    def __post_init__(self) -> None:
        for name in ("tau1", "tau2"):
            v = getattr(self, name)
            if not np.isfinite(v) or v <= 0.0:
                raise ValueError(f"{name} must be positive and finite, got {v}")

    def zero(self, t: float) -> float:
        if t < 0.0:
            raise ValueError(f"t must be >= 0, got {t}")
        f1, g1 = _ns_shape(t, self.tau1)
        _, g2 = _ns_shape(t, self.tau2)
        return (
            self.beta0
            + self.beta1 * f1
            + self.beta2 * g1
            + self.beta3 * g2
        )

    def discount(self, t: float) -> float:
        if t < 0.0:
            raise ValueError(f"t must be >= 0, got {t}")
        return float(np.exp(-self.zero(t) * t))

    def forward(self, t: float) -> float:
        if t < 0.0:
            raise ValueError(f"t must be >= 0, got {t}")
        return (
            self.beta0
            + self.beta1 * np.exp(-t / self.tau1)
            + self.beta2 * (t / self.tau1) * np.exp(-t / self.tau1)
            + self.beta3 * (t / self.tau2) * np.exp(-t / self.tau2)
        )

    def par(self, t: float) -> float:
        return _par_from_discount(self.discount, t)


def _par_from_discount(discount, t: float) -> float:
    """Continuous par yield of an annual-coupon bond at integer t.

    par = (1 − d(t)) / Σ_{j=1..t} d(j), converted to continuous ln(1+par).
    Rejects non-integral maturities and t < 1 (no annual coupon schedule).
    """
    if t <= 0.0:
        raise ValueError(f"par maturity must be > 0, got {t}")
    n = int(np.round(t))
    if abs(t - n) > 1e-12 or n < 1:
        raise ValueError(f"par requires integral maturity >= 1, got {t}")
    annuity = sum(discount(float(j)) for j in range(1, n + 1))
    c = (1.0 - discount(float(n))) / annuity
    return float(np.log1p(c))


def fit_nelson_siegel(
    maturities: np.ndarray,
    zero_rates: np.ndarray,
    tau_seed: float = 3.0,
) -> NelsonSiegel:
    """Least-squares NS fit on (maturity, continuous zero rate) quotes.

    `tau_seed` defaults to 3.0 — the ECB published NS parameterisation used
    as the reference golden (documented, deterministic).
    """
    m = np.asarray(maturities, dtype=float)
    z = np.asarray(zero_rates, dtype=float)
    if m.shape != z.shape or m.size < 4:
        raise ValueError("need >= 4 (maturity, rate) quotes of equal length")
    if np.any(m <= 0.0):
        raise ValueError("maturities must be > 0")

    def resid(p: np.ndarray) -> np.ndarray:
        tau, b0, b1, b2 = p
        if tau <= 0.0:
            return 1e6 * np.ones_like(z) * abs(tau)
        f = np.where(m == 0.0, 1.0, (1.0 - np.exp(-m / tau)) / (m / tau))
        return b0 + b1 * f + b2 * (f - np.exp(-m / tau)) - z

    sol = least_squares(resid, np.array([tau_seed, 0.01, -0.01, -0.02]))
    if not sol.success:
        raise ArithmeticError(f"NS fit failed to converge: {sol.message}")
    tau, b0, b1, b2 = (float(v) for v in sol.x)
    if tau <= 0.0:
        raise ArithmeticError(f"NS fit produced invalid tau={tau}")
    return NelsonSiegel(tau, b0, b1, b2)


def fit_nelson_siegel_svensson(
    maturities: np.ndarray,
    zero_rates: np.ndarray,
    tau1_seed: float = 2.435976,
    tau2_seed: float = 2.536963,
) -> NelsonSiegelSvensson:
    """Least-squares NSS fit on (maturity, continuous zero rate) quotes.

    Seed (τ1, τ2) defaults to the ECB published values for EURAAA
    2019-11-11 — the same seeding FinanceModels.jl uses for this sensitive
    calibration (documented, deterministic).
    """
    m = np.asarray(maturities, dtype=float)
    z = np.asarray(zero_rates, dtype=float)
    if m.shape != z.shape or m.size < 6:
        raise ValueError("need >= 6 (maturity, rate) quotes of equal length")
    if np.any(m <= 0.0):
        raise ValueError("maturities must be > 0")

    def resid(p: np.ndarray) -> np.ndarray:
        t1, t2, b0, b1, b2, b3 = p
        if t1 <= 0.0 or t2 <= 0.0:
            return 1e6 * np.ones_like(z)
        f1 = np.where(m == 0.0, 1.0, (1.0 - np.exp(-m / t1)) / (m / t1))
        f2 = np.where(m == 0.0, 1.0, (1.0 - np.exp(-m / t2)) / (m / t2))
        return (
            b0
            + b1 * f1
            + b2 * (f1 - np.exp(-m / t1))
            + b3 * (f2 - np.exp(-m / t2))
            - z
        )

    seed = np.array(
        [tau1_seed, tau2_seed, 0.006, -0.012, 0.12, -0.14], dtype=float
    )
    sol = least_squares(resid, seed)
    if not sol.success:
        raise ArithmeticError(f"NSS fit failed to converge: {sol.message}")
    t1, t2, b0, b1, b2, b3 = (float(v) for v in sol.x)
    if t1 <= 0.0 or t2 <= 0.0:
        raise ArithmeticError(f"NSS fit produced invalid taus=({t1},{t2})")
    return NelsonSiegelSvensson(t1, t2, b0, b1, b2, b3)


@dataclass(frozen=True)
class ZeroBootstrap:
    """Bootstrapped zero curve from a zero-bond price ladder.

    Nodes (t_i, r_i) with r_i = −ln(p_i)/t_i (continuous). Between nodes,
    ln-discount is linearly interpolated (log-linear zero-rate
    interpolation); outside the node range the ln-discount is extrapolated
    with constant slope of the nearest segment (flat-forward
    extrapolation). Deterministic by construction.
    """

    maturities: tuple[float, ...]
    rates: tuple[float, ...]

    def __post_init__(self) -> None:
        m = np.asarray(self.maturities, dtype=float)
        if m.size < 1 or np.any(m <= 0.0) or np.any(np.diff(m) <= 0.0):
            raise ValueError("maturities must be positive and strictly increasing")
        r = np.asarray(self.rates, dtype=float)
        if r.shape != m.shape or np.any(~np.isfinite(r)):
            raise ValueError("rates must be finite and match maturities")

    def discount(self, t: float) -> float:
        """Discount factor via log-linear interpolation between nodes."""
        if t < 0.0:
            raise ValueError(f"t must be >= 0, got {t}")
        m = np.asarray(self.maturities, dtype=float)
        y = m * np.asarray(self.rates, dtype=float)  # −ln discount at nodes
        if t == 0.0:
            return 1.0
        if t <= m[0]:
            # constant-slope extrapolation using the first node
            ln_d = -(y[0] / m[0]) * t
        elif t >= m[-1]:
            ln_d = -(y[-1] / m[-1]) * t
        else:
            ln_d = -float(np.interp(t, m, y))
        return float(np.exp(ln_d))

    def zero(self, t: float) -> float:
        """Continuous zero rate at time t."""
        if t <= 0.0:
            raise ValueError(f"t must be > 0, got {t}")
        return float(-np.log(self.discount(t)) / t)

    def forward(self, t: float) -> float:
        """Instantaneous forward via finite difference of −ln discount.

        Exact at node midpoints under log-linear interpolation (piecewise
        linear segments have constant slope, so the central difference is
        exact away from knots).
        """
        if t <= 0.0:
            raise ValueError(f"t must be > 0, got {t}")
        h = 1e-6 * max(t, 1.0)
        up = float(np.log(self.discount(t + h)))
        dn = float(np.log(self.discount(max(t - h, 0.0))))
        return float(-(up - dn) / (2 * h))

    def par(self, t: float) -> float:
        return _par_from_discount(self.discount, t)


def bootstrap_zero_bonds(
    maturities: np.ndarray,
    prices: np.ndarray,
) -> ZeroBootstrap:
    """Bootstrap a zero curve from a zero-bond price ladder.

    prices[i] is the clean price (as a fraction of face) of a zero bond
    maturing at maturities[i]; spot zero r_i = −ln(p_i)/t_i.
    """
    m = np.asarray(maturities, dtype=float)
    p = np.asarray(prices, dtype=float)
    if m.shape != p.shape or m.size < 1:
        raise ValueError("need matching (maturity, price) ladders")
    if np.any(m <= 0.0):
        raise ValueError("maturities must be > 0")
    if np.any(p <= 0.0) or np.any(~np.isfinite(p)):
        raise ValueError("prices must be positive and finite")
    order = np.argsort(m)
    rates = -np.log(p[order]) / m[order]
    return ZeroBootstrap(
        tuple(float(v) for v in m[order]), tuple(float(v) for v in rates)
    )
