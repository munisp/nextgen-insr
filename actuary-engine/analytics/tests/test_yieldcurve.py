"""F2 yieldcurve acceptance tests.

Golden sources:
* FinanceModels.jl (MIT) test/NelsonSiegelSvensson.jl @ master commit
  1cd909069d8b9a56ddf9252e5e92d35a78e8b4bd — ECB EURAAA 2019-11-11 curve
  quotes, published NS and NSS parameter sets, and the upstream test
  tolerances (zero atol 0.005, discount rtol 0.0025, par atol 0.005,
  zero(30) rtol 5e-4).
* Hand-computed bootstrap ladders (derivations in test comments).
"""

import numpy as np
import pytest

from actuary_analytics.yieldcurve import (
    NelsonSiegel,
    NelsonSiegelSvensson,
    bootstrap_zero_bonds,
    fit_nelson_siegel,
    fit_nelson_siegel_svensson,
)

from .conftest import load_golden


def _ecb():
    g = load_golden("yieldcurve_ecb_golden.json")
    mats = np.asarray(g["maturities"], dtype=float)
    zeros = np.asarray(g["zeros_continuous"], dtype=float) / 100.0
    pars = np.asarray(g["pars_continuous"], dtype=float) / 100.0
    return g, mats, zeros, pars


def _ns_given(g):
    p = g["ns_params_given"]
    return NelsonSiegel(
        tau=p["tau"], beta0=p["beta0"] / 100, beta1=p["beta1"] / 100, beta2=p["beta2"] / 100
    )


def _nss_given(g):
    p = g["nss_params_given"]
    return NelsonSiegelSvensson(
        tau1=p["tau1"],
        tau2=p["tau2"],
        beta0=p["beta0"] / 100,
        beta1=p["beta1"] / 100,
        beta2=p["beta2"] / 100,
        beta3=p["beta3"] / 100,
    )


# ---------------------------------------------------------------------------
# FinanceModels.jl goldens: published parameter sets vs ECB quotes
# ---------------------------------------------------------------------------

class TestFinanceModelsGolden:
    def test_ns_given_params_zero_rates(self):
        """FinanceModels.jl "EURAAA_20191111 / NelsonSiegel" testset: NS with
        the ECB published params reproduces every zero quote to atol 0.005
        (our implementation max err is 3.1e-4 — asserted tighter at 5e-4)."""
        g, mats, zeros, _ = _ecb()
        c = _ns_given(g)
        fitted = np.array([c.zero(float(t)) for t in mats])
        np.testing.assert_allclose(fitted, zeros, atol=5e-4)

    def test_nss_given_params_zero_rates(self):
        """FinanceModels.jl "EURAAA_20191111 w parms given" testset: NSS with
        published params reproduces zero quotes; max err in our
        implementation is 7.6e-9 — asserted at 1e-7."""
        g, mats, zeros, _ = _ecb()
        c = _nss_given(g)
        fitted = np.array([c.zero(float(t)) for t in mats])
        np.testing.assert_allclose(fitted, zeros, atol=1e-7)
        # Upstream additionally pins zero(30) ≈ last(zeros) rtol 5e-4.
        assert np.isclose(c.zero(30.0), zeros[-1], rtol=5e-4)

    def test_discount_identity_and_discount_zero(self):
        """Upstream pins discount(c, 0) == 1.0 and discount(10) ==
        1/accumulation(10) — discount(t)·accumulation(t) = 1 identity."""
        g, mats, zeros, _ = _ecb()
        for c in (_ns_given(g), _nss_given(g)):
            assert c.discount(0.0) == 1.0
            acc = np.exp(c.zero(10.0) * 10.0)
            assert np.isclose(c.discount(10.0), 1.0 / acc, rtol=1e-14)

    def test_nss_par_rates(self):
        """Upstream pins par(c, t) ≈ ECB par quotes atol 0.005. Our
        continuous-converted par matches to 1.7e-6 — asserted at 5e-5 for
        integer maturities."""
        g, mats, zeros, pars = _ecb()
        c = _nss_given(g)
        int_mats = mats[mats >= 1.0]
        int_pars = pars[mats >= 1.0]
        fitted = np.array([c.par(float(t)) for t in int_mats])
        np.testing.assert_allclose(fitted, int_pars, atol=5e-5)

    def test_forward_matches_finite_difference(self):
        """Analytic instantaneous forward vs -d ln discount(t)/dt by
        central finite difference (exactness check, 1e-8)."""
        g, mats, zeros, _ = _ecb()
        for c in (_ns_given(g), _nss_given(g)):
            for t in (1.0, 5.0, 10.0, 30.0):
                h = 1e-6
                lnd_up = np.log(c.discount(t + h))
                lnd_dn = np.log(c.discount(t - h))
                numeric = -(lnd_up - lnd_dn) / (2 * h)
                assert abs(c.forward(t) - numeric) < 1e-8

    def test_ns_fit_reproduces_zeros(self):
        """Least-squares NS fit on the ECB zero quotes reproduces them to
        the upstream 0.005 tolerance (deterministic: fixed τ seed 3.0)."""
        _, mats, zeros, _ = _ecb()
        c = fit_nelson_siegel(mats, zeros)
        fitted = np.array([c.zero(float(t)) for t in mats])
        np.testing.assert_allclose(fitted, zeros, atol=5e-3)

    def test_nss_fit_reproduces_zeros(self):
        """Seeded NSS fit reproduces the ECB zeros to the upstream 0.005
        tolerance (seeds = ECB published τs, as FinanceModels.jl does)."""
        _, mats, zeros, _ = _ecb()
        c = fit_nelson_siegel_svensson(mats, zeros)
        fitted = np.array([c.zero(float(t)) for t in mats])
        np.testing.assert_allclose(fitted, zeros, atol=5e-3)


# ---------------------------------------------------------------------------
# Hand-computed bootstrap goldens
# ---------------------------------------------------------------------------

class TestBootstrapHandComputed:
    def test_flat_ladder_spots(self):
        """Hand derivation: zero-bond prices p = exp(-0.05·t) at
        t = 1,2,3,5,10 → flat continuous spot 5% at every node."""
        mats = np.array([1.0, 2.0, 3.0, 5.0, 10.0])
        prices = np.exp(-0.05 * mats)
        curve = bootstrap_zero_bonds(mats, prices)
        for t in mats:
            assert abs(curve.zero(float(t)) - 0.05) < 1e-14
            assert abs(curve.discount(float(t)) - np.exp(-0.05 * t)) < 1e-14

    def test_rising_ladder_spots_and_interpolation(self):
        """Hand derivation: prices [0.96, 0.9050, 0.8398] at [1,2,3].
        r1 = -ln(0.96)/1 = 0.04082199…; r2 = -ln(0.9050)/2 = 0.0499…;
        r3 = -ln(0.8398)/3 = 0.0582….
        At t=1.5, log-linear interpolation averages the ln-discount
        accumulations y(1)=r1 and y(2)=2·r2: zero(1.5) = 0.5·(r1 + 2·r2)/1.5.
        Forward over (1,2) is the constant slope r1→2·r2 per year:
        (2·r2 − r1)/(2−1) — asserted against the finite-difference forward.
        """
        mats = np.array([1.0, 2.0, 3.0])
        prices = np.array([0.96, 0.9050, 0.8398])
        curve = bootstrap_zero_bonds(mats, prices)
        r1 = -np.log(0.96) / 1.0
        r2 = -np.log(0.9050) / 2.0
        r3 = -np.log(0.8398) / 3.0
        assert abs(curve.zero(1.0) - r1) < 1e-14
        assert abs(curve.zero(2.0) - r2) < 1e-14
        assert abs(curve.zero(3.0) - r3) < 1e-14
        # Midpoint interpolation in ln-discount space.
        expected_z15 = 0.5 * (r1 * 1.0 + r2 * 2.0) / 1.5
        assert abs(curve.zero(1.5) - expected_z15) < 1e-14
        # Forward on the (1,2) segment: slope of ln-discount accumulation.
        fwd_expected = (2.0 * r2 - 1.0 * r1) / (2.0 - 1.0)
        assert abs(curve.forward(1.5) - fwd_expected) < 1e-6
        # Discount outside the range: flat-forward extrapolation at the
        # last node's continuous rate.
        assert abs(curve.discount(4.0) - np.exp(-r3 * 4.0)) < 1e-12

    def test_par_from_bootstrapped_curve(self):
        """Hand derivation on a flat 5% curve: par(5) = ln(1 + c) with
        c = (1 − e^{−0.25}) / Σ_{j=1..5} e^{−0.05j}."""
        mats = np.array([1.0, 2.0, 3.0, 5.0, 10.0])
        prices = np.exp(-0.05 * mats)
        curve = bootstrap_zero_bonds(mats, prices)
        d5 = np.exp(-0.05 * 5)
        annuity = sum(np.exp(-0.05 * j) for j in range(1, 6))
        expected = np.log1p((1.0 - d5) / annuity)
        assert abs(curve.par(5.0) - expected) < 1e-12
        # Non-integral maturity is rejected (no coupon schedule).
        with pytest.raises(ValueError):
            curve.par(2.5)
        with pytest.raises(ValueError):
            curve.par(0.5)

    def test_bootstrap_validation(self):
        with pytest.raises(ValueError):
            bootstrap_zero_bonds(np.array([1.0]), np.array([-0.9]))
        with pytest.raises(ValueError):
            bootstrap_zero_bonds(np.array([0.0, 1.0]), np.array([1.0, 0.95]))


class TestValidation:
    def test_domain_errors(self):
        with pytest.raises(ValueError):
            NelsonSiegel(tau=0.0, beta0=0.04, beta1=-0.02, beta2=0.01)
        with pytest.raises(ValueError):
            NelsonSiegelSvensson(
                tau1=2.5, tau2=-3.0, beta0=0.04, beta1=-0.02, beta2=0.01, beta3=-0.005
            )
        c = _ns_given(_ecb()[0])
        with pytest.raises(ValueError):
            c.zero(-1.0)
        with pytest.raises(ValueError):
            fit_nelson_siegel(np.array([1.0, 2.0]), np.array([0.01, 0.02]))
