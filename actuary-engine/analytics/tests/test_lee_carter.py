"""F3 Lee-Carter acceptance tests.

Golden provenance: tests/data/lee_carter_golden.json pins values
recomputed by an INDEPENDENT implementation — an eigendecomposition of
the Gram matrix AᵀA via np.linalg.eigh (top eigenvector as the first
right-singular vector, beta_raw = A @ v1) in the scratch script
documented in the golden file's `provenance` field. The production
module uses np.linalg.svd on the centred matrix directly, so the golden
is not self-referential. Tolerance justification: identical math on two
different decompositions agreed to ~1e-13 absolute on κ at generation
time; tests pin rtol=1e-9 to absorb BLAS/LAPACK vendor variation.

Fixture: deterministic closed-form central death rates (ages 60–65 ×
years 1990–1997) — no network dependency, no random draws.
"""

import numpy as np
import pytest

from actuary_analytics.life import lee_carter_fit, lee_carter_forecast

from .conftest import load_golden

TOL = 1e-9


@pytest.fixture(scope="module")
def golden():
    return load_golden("lee_carter_golden.json")


@pytest.fixture(scope="module")
def mx(golden):
    return np.asarray(golden["mx"], dtype=float)


class TestLeeCarterGolden:
    def test_parameters(self, mx, golden):
        fit = lee_carter_fit(mx)
        np.testing.assert_allclose(fit["alpha"], golden["alpha"], rtol=TOL)
        np.testing.assert_allclose(fit["beta"], golden["beta"], rtol=TOL)
        np.testing.assert_allclose(fit["kappa"], golden["kappa"], rtol=TOL)
        assert fit["drift"] == pytest.approx(golden["drift"], rel=TOL)
        assert fit["residual_rmse"] == pytest.approx(
            golden["residual_rmse"], rel=1e-6
        )

    def test_forecast(self, mx, golden):
        fit = lee_carter_fit(mx)
        fc = lee_carter_forecast(fit, golden["horizon"])
        np.testing.assert_allclose(
            fc["kappa_forecast"], golden["kappa_forecast"], rtol=TOL
        )
        np.testing.assert_allclose(
            np.asarray(fc["mx_forecast"]),
            np.asarray(golden["mx_forecast"]),
            rtol=TOL,
        )


class TestLeeCarterStructure:
    def test_normalization_and_sign_conventions(self, mx):
        fit = lee_carter_fit(mx)
        assert np.sum(fit["beta"]) == pytest.approx(1.0, rel=1e-12)
        # Sign convention: Σ_x β_x > 0 (documented in leecarter.py); for
        # this fixture all age sensitivities are positive.
        assert all(b > 0.0 for b in fit["beta"])

    def test_reconstruction_quality(self, mx, golden):
        """Rank-1 reconstruction reproduces log m within the pinned RMSE;
        forecast moves in the drift direction (mortality declining)."""
        fit = lee_carter_fit(mx)
        logm = np.log(mx)
        recon = np.asarray(fit["alpha"])[:, None] + np.outer(
            fit["beta"], fit["kappa"]
        )
        assert np.sqrt(np.mean((logm - recon) ** 2)) == pytest.approx(
            golden["residual_rmse"], rel=1e-6
        )
        fc = lee_carter_forecast(fit, 2)
        assert fc["kappa_forecast"][1] - fc["kappa_forecast"][0] == pytest.approx(
            fit["drift"], rel=1e-12
        )

    def test_determinism(self, mx):
        assert lee_carter_fit(mx) == lee_carter_fit(mx)


class TestLeeCarterFailClosed:
    def test_rank_deficient_rejected(self):
        """log m constant across years for every age → centred matrix is
        rank 0 → the decomposition is not identifiable; fail closed."""
        mx = np.exp(np.tile(np.linspace(-4.0, -3.0, 5)[:, None], (1, 6)))
        with pytest.raises(ValueError, match="rank-deficient"):
            lee_carter_fit(mx)

    def test_non_positive_rates_rejected(self, mx):
        bad = np.array(mx, copy=True)
        bad[0, 0] = 0.0
        with pytest.raises(ValueError, match="strictly positive"):
            lee_carter_fit(bad)
        bad2 = np.array(mx, copy=True)
        bad2[1, 1] = np.nan
        with pytest.raises(ValueError, match="strictly positive|finite"):
            lee_carter_fit(bad2)

    def test_too_small_rejected(self, mx):
        with pytest.raises(ValueError, match=">= 2 ages and >= 2 years"):
            lee_carter_fit(mx[:1])
        with pytest.raises(ValueError, match="2-D"):
            lee_carter_fit(mx.ravel())

    def test_horizon_rejected(self, mx):
        fit = lee_carter_fit(mx)
        with pytest.raises(ValueError, match="horizon"):
            lee_carter_forecast(fit, 0)
