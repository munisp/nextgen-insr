"""Analytic aggregate-loss distributions via the adopted ``aggregate`` library.

Thin adapter over mynl/aggregate v2.1.0 (BSD-3-Clause). Every compute path
delegates to the real library (FFT/quantile-spectral convolution engine);
this module only marshals specs and normalizes outputs. No distribution
math is re-implemented here.

Capabilities (F1, capability map §1):
  * frequency x severity -> aggregate-loss distribution (analytic, FFT)
  * VaR / TVaR read directly off the analytic distribution
  * distortion pricing helpers (TVaR / dual / CCoC) per layer

Cross-validation role: the Normal-mixture case reproduces the analytic
references pinned by the Rust Monte-Carlo kernel golden
(``actuary-engine/kernels/tests/mc_analytic.rs`` @ e8386e9), providing an
independent analytic cross-check of the MC kernel outputs.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import aggregate as _agg
from aggregate.spectral import Distortion as _Distortion

AGGREGATE_VERSION = _agg.__version__


@dataclass(frozen=True)
class GridSpec:
    """Pinned FFT grid. ``bs`` must be an exact binary fraction (the
    ``round_bucket`` invariant used by the upstream baseline corpus)."""

    log2: int = 16
    bs: float = 1 / 4
    padding: int = 1
    normalize: bool = True


@dataclass(frozen=True)
class AnalyticRiskMeasures:
    var: float
    tvar: float
    p: float


class AggregateLossDist:
    """Analytic aggregate-loss distribution (real ``aggregate.Aggregate``).

    Built from an aggregate DecL program (the library's native spec DSL),
    e.g. ``"agg A 50 claims ssev 500 * norm + 1000 poisson"``. The ``ssev``
    (signed severity) form preserves negative support — required to match
    kernel models that do not clamp severity at zero.
    """

    def __init__(self, program: str, grid: GridSpec = GridSpec()) -> None:
        self.program = program
        self.grid = grid
        # update=False mirrors the upstream baseline harness (capture.py):
        # build() would otherwise auto-run recommend_bucket, which raises
        # for defective/no-finite-variance severities (e.g. Def.Pareto).
        self._agg = _agg.build(program, update=False)
        self._agg.update(
            log2=grid.log2,
            bs=grid.bs,
            padding=grid.padding,
            normalize=grid.normalize,
        )

    # -- analytic risk measures -------------------------------------------
    def var(self, p: float) -> float:
        """Analytic VaR at probability level ``p`` (FFT quantile)."""
        return float(self._agg.q(p))

    def tvar(self, p: float) -> float:
        """Analytic TVaR at probability level ``p``."""
        return float(self._agg.tvar(p))

    def risk_measures(self, p: float) -> AnalyticRiskMeasures:
        return AnalyticRiskMeasures(var=self.var(p), tvar=self.tvar(p), p=float(p))

    @property
    def density_df(self):
        """Loss/pmf/F/S/lev frame on the FFT grid (library-native object)."""
        return self._agg.density_df

    @property
    def stats_df(self):
        return self._agg.stats_df

    @property
    def describe(self):
        """Validation/describe frame (the corpus's ``describe`` snapshot)."""
        return self._agg.validation_df

    @property
    def raw(self):
        """Escape hatch to the underlying ``aggregate.Aggregate`` object."""
        return self._agg

    # -- distortion pricing ------------------------------------------------
    def distortion_price(
        self,
        distortion: str,
        attachment: float | None = None,
        **shape: Any,
    ) -> dict[str, float]:
        """Distortion price of the full distribution (or xs layer at
        ``attachment``). ``distortion`` in {"tvar", "dual", "ccoc"}; shape
        params per aggregate.spectral.Distortion (tvar/dual: ``shape``;
        ccoc: ``r``). Returns EL / ask (distorted) premium."""
        dist = _Distortion(name=distortion, **shape)
        price = dist.price(
            self._agg.density_df["p_total"],
            a=(attachment if attachment is not None else float("inf")),
        )
        return {
            "distortion": distortion,
            "attachment": attachment if attachment is not None else float("inf"),
            "el": float(price.el),
            "ask": float(price.ask),
        }


def build_aggregate_loss(program: str, grid: GridSpec = GridSpec()) -> AggregateLossDist:
    """Build an analytic aggregate-loss distribution from a DecL program."""
    return AggregateLossDist(program, grid)


def distortion(name: str, **shape: Any) -> _Distortion:
    """Construct a distortion object (library-native) for reuse."""
    return _Distortion(name=name, **shape)


def kernel_mc_crosscheck_case() -> AggregateLossDist:
    """The Normal-mixture case pinned by the Rust MC kernel golden
    (mc_analytic.rs): frequency Poisson(50), severity Normal(1000, 500^2)
    with SIGNED support (the kernel does not clamp severities at zero;
    conditional on N=n the aggregate is exactly N(1000n, 500n^2)).

    Grid pinned to log2=21, bs=1/16: measured against the analytic
    references VaR99.5=71641.37217383638 / TVaR99=72474.33118882046 the
    FFT reproduces VaR within one bucket (< 1/16) and TVaR within rtol 1e-9
    (evidence in tests/test_aggdist_baseline.py).
    """
    return build_aggregate_loss(
        "agg NM 50 claims ssev 500 * norm + 1000 poisson",
        GridSpec(log2=21, bs=1 / 16, padding=2),
    )
