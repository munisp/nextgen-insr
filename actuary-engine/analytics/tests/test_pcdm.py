"""F3 PCDM acceptance tests (Paid Chain-ladder Development Method).

Golden provenance: tests/data/pcdm_golden.json pins values recomputed by
an INDEPENDENT implementation — a direct textbook numpy loop
(volume-weighted LDFs, CDF cumproducts, ultimate = latest × CDF, reserve
= ultimate − paid-to-date) in the scratch script documented in the golden
file's `provenance` field. No chainladder and no production-module import
in that recomputation, so the golden is not self-referential: the
production estimator here is built from real chainladder calls and
reproduces the independent values within rtol=1e-12 (tests pin 1e-9).
"""

import numpy as np
import pytest

from actuary_analytics import reserving
from actuary_analytics.reserving import pcdm
from actuary_analytics.reserving.methods import triangle_dict_to_chainladder

from .conftest import load_golden

TOL = 1e-9


@pytest.fixture(scope="module")
def golden():
    return load_golden("pcdm_golden.json")


@pytest.fixture(scope="module")
def paid_tri(golden):
    return triangle_dict_to_chainladder(golden["fixture_triangle"])


class TestPCDMGolden:
    def test_factors_and_cdfs(self, paid_tri, golden):
        out = pcdm(paid_tri)
        np.testing.assert_allclose(
            out["development_factors"], golden["development_factors"], rtol=TOL
        )
        # chainladder cdf_ drops the trailing 1.0 (documented in golden).
        np.testing.assert_allclose(out["cdfs"], golden["cdfs"][:-1], rtol=TOL)

    def test_ultimate_and_reserve(self, paid_tri, golden):
        out = pcdm(paid_tri)
        np.testing.assert_allclose(
            list(out["ultimate_by_origin"].values()), golden["ultimate"], rtol=TOL
        )
        np.testing.assert_allclose(
            list(out["reserve_by_origin"].values()), golden["reserve"], rtol=TOL
        )
        np.testing.assert_allclose(
            list(out["paid_to_date_by_origin"].values()),
            golden["paid_to_date"],
            rtol=TOL,
        )
        assert out["total_reserve"] == pytest.approx(
            golden["total_reserve"], rel=TOL
        )


class TestPCDMStructure:
    def test_reserve_identity(self, paid_tri):
        """reserve = ultimate − paid-to-date per origin; totals add up."""
        out = pcdm(paid_tri)
        for lab in out["reserve_by_origin"]:
            assert out["reserve_by_origin"][lab] == pytest.approx(
                out["ultimate_by_origin"][lab] - out["paid_to_date_by_origin"][lab],
                rel=1e-12,
            )
        assert out["total_reserve"] == pytest.approx(
            float(np.sum(list(out["reserve_by_origin"].values()))), rel=1e-12
        )
        # Fully developed origin carries zero remaining payments.
        assert out["reserve_by_origin"][golden_labels()[0]] == pytest.approx(0.0)

    def test_ldfs_above_one(self, paid_tri):
        out = pcdm(paid_tri)
        assert all(f >= 1.0 for f in out["development_factors"])

    def test_determinism(self, paid_tri):
        assert pcdm(paid_tri) == pcdm(paid_tri)


class TestPCDMFailClosed:
    def test_negative_paid_rejected(self):
        bad = {"2020": [100.0, -50.0], "2021": [90.0]}
        with pytest.raises(ValueError, match="negative paid amounts"):
            pcdm(triangle_dict_to_chainladder(bad))

    def test_decreasing_cumulative_rejected(self):
        """A cumulative row that decreases implies a negative incremental
        payment (salvage/recovery triangle) — out of scope, fail closed."""
        bad = {"2020": [100.0, 80.0], "2021": [90.0]}
        with pytest.raises(ValueError, match="decreases"):
            pcdm(triangle_dict_to_chainladder(bad))

    def test_too_small_rejected(self):
        tiny = {"2020": [100.0], "2021": [90.0]}
        with pytest.raises(ValueError, match="age-to-age factor"):
            pcdm(triangle_dict_to_chainladder(tiny))


def golden_labels():
    g = load_golden("pcdm_golden.json")
    return g["labels"]


# ---------------------------------------------------------------------------
# reserve_run dispatch
# ---------------------------------------------------------------------------

class TestDispatch:
    def test_methods_exported(self):
        from actuary_analytics import reserving as pkg

        assert hasattr(pkg, "pcdm")

    def test_reserve_run_dispatch(self, golden, monkeypatch):
        """run_monthly_reserve dispatches PCDM through the real claims-source
        job path; the store is a test boundary, not a compute path."""
        from actuary_analytics.jobs import reserve_run as rr

        rows = []
        for origin, vals in golden["fixture_triangle"].items():
            for j, v in enumerate(vals):
                rows.append(
                    {
                        "accident_year": origin,
                        "development_period": j,
                        "cumulative": float(v),
                    }
                )
        monkeypatch.setattr(rr, "load_claims", lambda cfg, what: (rows, "test"))
        store_records = []

        class Store:
            def insert_run(self, record):
                store_records.append(record)
                return len(store_records)

            def insert_triangle(self, run_id, record):
                pass

            def approve_run(self, run_id, approved_by):
                pass

            def get_run(self, run_id):
                return store_records[run_id - 1]

        res = rr.run_monthly_reserve("wc", "2024-12", "pcdm", Store(), config=None)
        assert res.method == "pcdm"
        assert res.ibnr == pytest.approx(golden["total_reserve"], rel=1e-6)
        assert all(
            v >= 0.0 for v in res.ultimate_by_origin.values()
        )
