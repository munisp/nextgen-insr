"""F1 acceptance: aggregate-derived VaR/TVaR cross-validates the Rust MC
kernel golden (Normal-mixture case).

Model: frequency Poisson(50), severity Normal(1000, 500^2) with signed
support — identical to the kernel spec in
actuary-engine/kernels/tests/mc_analytic.rs @ e8386e9
(Tweedie p=0, phi=250000; conditional on N=n the aggregate is exactly
N(1000n, 500n^2)). Analytic references pinned there:
  VaR_99.5 = 71641.37217383638
  TVaR_99  = 72474.33118882046
Independently re-verified 2026-11 (F1) by scipy mixture quadrature
(Poisson weights over normal CDFs, bisection root-find): reproduces both
references to < 1e-10.

Documented tolerance: the FFT grid quantizes VaR to bucket boundaries
(bs = 1/16 here), so VaR asserts within one bucket; TVaR is an integral
and reproduces to rtol 1e-8 (measured delta 7.4e-5, rel ~1e-9).
"""

from __future__ import annotations

import numpy as np

from actuary_analytics.aggdist import (
    GridSpec,
    build_aggregate_loss,
    kernel_mc_crosscheck_case,
)

# Pinned in actuary-engine/kernels/tests/mc_analytic.rs @ e8386e9
ANALYTIC_VAR_995 = 71641.37217383638
ANALYTIC_TVAR_99 = 72474.33118882046
BUCKET = 1 / 16  # FFT bucket size of the crosscheck grid


class TestKernelMCCrosscheck:
    def test_var_995_matches_kernel_analytic_reference(self):
        case = kernel_mc_crosscheck_case()
        var = case.var(0.995)
        assert abs(var - ANALYTIC_VAR_995) <= BUCKET, (
            f"aggregate FFT VaR99.5 {var} vs kernel analytic "
            f"{ANALYTIC_VAR_995}: |d|={abs(var - ANALYTIC_VAR_995)} > bs={BUCKET}"
        )

    def test_tvar_99_matches_kernel_analytic_reference(self):
        case = kernel_mc_crosscheck_case()
        tvar = case.tvar(0.99)
        assert abs(tvar - ANALYTIC_TVAR_99) <= 1e-8 * ANALYTIC_TVAR_99, (
            f"aggregate FFT TVaR99 {tvar} vs kernel analytic "
            f"{ANALYTIC_TVAR_99}: rel {abs(tvar - ANALYTIC_TVAR_99) / ANALYTIC_TVAR_99:.2e}"
        )

    def test_mean_matches_analytic(self):
        # Analytic mean lambda * mu = 50 * 1000 = 50000 exactly.
        case = kernel_mc_crosscheck_case()
        dd = case.density_df
        loss = dd.index.to_numpy(dtype=float)
        mean = float((loss * dd["p_total"].to_numpy()).sum())
        assert abs(mean - 50_000.0) < 1e-6, f"FFT mean {mean} vs analytic 50000"

    def test_grid_pins_hold(self):
        case = kernel_mc_crosscheck_case()
        assert case.grid == GridSpec(log2=21, bs=1 / 16, padding=2)


class TestAdapterAPI:
    def test_analytic_distribution_build_and_risk_measures(self):
        # Same program shape as corpus case Tail.LN (lognorm severity).
        dist = build_aggregate_loss(
            "agg Tail 5 claims sev lognorm 100 cv 3 poisson",
            GridSpec(log2=16, bs=5, padding=2),
        )
        rm = dist.risk_measures(0.99)
        assert rm.p == 0.99
        assert rm.var > 0
        assert rm.tvar >= rm.var  # TVaR dominates VaR at the same level
        assert dist.density_df["p_total"].sum() > 0.99

    def test_distortion_pricing_helpers(self):
        dist = build_aggregate_loss(
            "agg Tail 5 claims sev lognorm 100 cv 3 poisson",
            GridSpec(log2=16, bs=5, padding=2),
        )
        for name, shape in (("tvar", {"shape": 0.65}),
                            ("dual", {"shape": 1.85}),
                            ("ccoc", {"r": 0.10})):
            price = dist.distortion_price(name, **shape)
            assert price["el"] > 0
            assert price["ask"] > 0
            assert price["distortion"] == name

    def test_signed_vs_clamped_severity_is_explicit(self):
        # Signed support (kernel-style, no clamp) must match the analytic
        # mean 50000; unsigned `sev` clamps at 0 (atom at 0 carries the
        # negative tail, mean shifts up to 50*E[max(0,X)]) — the adapter
        # makes the kernel model explicit via `ssev`.
        signed = kernel_mc_crosscheck_case()
        rm = signed.risk_measures(0.995)
        assert abs(rm.var - ANALYTIC_VAR_995) <= BUCKET
