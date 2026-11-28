"""F3 Bühlmann-Straub credibility acceptance tests.

Golden provenance (two independent receipts):

1. PUBLISHED REFERENCE — Loss Data Analytics (open text, listed in
   genedan/actuarial-foss), Chapter 9, Example 9.6.3: two-policyholder
   Bühlmann-Straub dataset with the published worked solution
   (EPV=0.3667, VHM=0.1757, K=2.0871, Z_A=0.7703, Z_B=0.8118,
   mu_A=0.9139, mu_B=0.3882) and Example 9.6.6 balanced complement
   (M_hat=0.6579, 0.9214, 0.3944). The textbook rounds intermediate
   values (it derives K from the rounded EPV/VHM), so the tests assert
   agreement within 5e-4 absolute, documented in the golden file.
   Citation URL: https://openacttexts.github.io/Loss-Data-Analytics/
   ChapCredibility.html

2. FULL-PRECISION GOLDEN — recomputed independently with exact rational
   arithmetic (fractions.Fraction) in the scratch script documented in
   the golden file's `independent_receipt` field: EPV=11/30, VHM=166/945,
   K=693/332, Z_A=332/431, Z_B=332/409, mu_A=3151/3448, mu_B=3811/9816,
   M_hat=829/1260. The production float loops reproduce these within
   rtol=1e-14 (tests pin 1e-12).
"""

import numpy as np
import pytest

from actuary_analytics.credibility import RiskExperience, buhlmann_straub

from .conftest import load_golden

TOL = 1e-12
PUBLISHED_TOL = 5e-4  # textbook prints 4 decimals and rounds intermediates


@pytest.fixture(scope="module")
def golden():
    return load_golden("buhlmann_straub_golden.json")


@pytest.fixture(scope="module")
def risks(golden):
    ds = golden["dataset"]
    return [
        RiskExperience(
            "A",
            [c / v for c, v in zip(ds["A"]["claims"], ds["A"]["vehicles"])],
            [float(v) for v in ds["A"]["vehicles"]],
        ),
        RiskExperience(
            "B",
            [c / v if v > 0 else 0.0
             for c, v in zip(ds["B"]["claims"], ds["B"]["vehicles"])],
            [float(v) for v in ds["B"]["vehicles"]],
        ),
    ]


class TestGoldenFullPrecision:
    def test_parameters(self, risks, golden):
        out = buhlmann_straub(risks)
        assert out["epv"] == pytest.approx(golden["epv"], rel=TOL)
        assert out["vhm"] == pytest.approx(golden["vhm"], rel=TOL)
        assert out["k"] == pytest.approx(golden["k"], rel=TOL)
        assert out["collective_mean"] == pytest.approx(
            golden["collective_mean"], rel=TOL
        )

    def test_per_risk(self, risks, golden):
        out = buhlmann_straub(risks, balance=True)
        a, b = out["risks"]
        assert a["exposure_total"] == pytest.approx(golden["exposure_A"], rel=TOL)
        assert b["exposure_total"] == pytest.approx(golden["exposure_B"], rel=TOL)
        assert a["mean_per_exposure"] == pytest.approx(golden["x_bar_A"], rel=TOL)
        assert b["mean_per_exposure"] == pytest.approx(golden["x_bar_B"], rel=TOL)
        assert a["credibility_z"] == pytest.approx(golden["z_A"], rel=TOL)
        assert b["credibility_z"] == pytest.approx(golden["z_B"], rel=TOL)
        assert a["credibility_estimate"] == pytest.approx(
            golden["estimate_A"], rel=TOL
        )
        assert b["credibility_estimate"] == pytest.approx(
            golden["estimate_B"], rel=TOL
        )

    def test_balancing(self, risks, golden):
        out = buhlmann_straub(risks, balance=True)
        assert out["balanced_complement"] == pytest.approx(
            golden["balanced_complement"], rel=TOL
        )
        assert out["risks"][0]["balanced_estimate"] == pytest.approx(
            golden["balanced_A"], rel=TOL
        )
        assert out["risks"][1]["balanced_estimate"] == pytest.approx(
            golden["balanced_B"], rel=TOL
        )


class TestPublishedReference:
    """The module output agrees with the values printed in Loss Data
    Analytics Examples 9.6.3/9.6.6 within the textbook's 4-decimal
    rounding (5e-4 absolute tolerance, documented in the golden file)."""

    def test_against_published_values(self, risks, golden):
        out = buhlmann_straub(risks, balance=True)
        pub = golden["published_rounded"]
        assert out["epv"] == pytest.approx(pub["epv"], abs=PUBLISHED_TOL)
        assert out["vhm"] == pytest.approx(pub["vhm"], abs=PUBLISHED_TOL)
        assert out["k"] == pytest.approx(pub["k"], abs=PUBLISHED_TOL)
        assert out["risks"][0]["credibility_z"] == pytest.approx(
            pub["z_A"], abs=PUBLISHED_TOL
        )
        assert out["risks"][1]["credibility_z"] == pytest.approx(
            pub["z_B"], abs=PUBLISHED_TOL
        )
        assert out["risks"][0]["credibility_estimate"] == pytest.approx(
            pub["estimate_A"], abs=PUBLISHED_TOL
        )
        assert out["risks"][1]["credibility_estimate"] == pytest.approx(
            pub["estimate_B"], abs=PUBLISHED_TOL
        )
        assert out["balanced_complement"] == pytest.approx(
            pub["balanced_complement"], abs=PUBLISHED_TOL
        )
        assert out["risks"][0]["balanced_estimate"] == pytest.approx(
            pub["balanced_A"], abs=PUBLISHED_TOL
        )
        assert out["risks"][1]["balanced_estimate"] == pytest.approx(
            pub["balanced_B"], abs=PUBLISHED_TOL
        )


class TestStructure:
    def test_credibilities_in_unit_interval(self, risks):
        out = buhlmann_straub(risks)
        for entry in out["risks"]:
            assert 0.0 < entry["credibility_z"] < 1.0

    def test_balanced_estimates_reproduce_collective_mean(self, risks, golden):
        """Balancing identity: exposure-weighted balanced estimates equal
        the collective mean (LDA Example 9.6.6 check: 0.6250)."""
        out = buhlmann_straub(risks, balance=True)
        est = np.array([r["balanced_estimate"] for r in out["risks"]])
        exp = np.array([r["exposure_total"] for r in out["risks"]])
        assert float(exp @ est / exp.sum()) == pytest.approx(
            out["collective_mean"], rel=1e-12
        )

    def test_more_exposure_more_credibility(self, risks):
        out = buhlmann_straub(risks)
        z = [r["credibility_z"] for r in out["risks"]]
        m = [r["exposure_total"] for r in out["risks"]]
        assert (m[1] > m[0]) == (z[1] > z[0])


class TestFailClosed:
    def test_single_risk_rejected(self):
        with pytest.raises(ValueError, match=">= 2 risks"):
            buhlmann_straub([RiskExperience("A", [1.0, 1.2], [3.0, 4.0])])

    def test_degenerate_vhm_rejected(self):
        """Both risks share the same mean per exposure and their individual
        means equal the collective mean → VHM <= 0: the LDA §9.6 degenerate
        case, honest error instead of a silent clamp."""
        risks = [
            RiskExperience("A", [1.0, 1.0, 1.0], [5.0, 5.0, 5.0]),
            RiskExperience("B", [1.0, 1.0], [5.0, 5.0]),
        ]
        # identical within-risk values → EPV = 0 → EPV check fires first
        with pytest.raises(ValueError, match="EPV"):
            buhlmann_straub(risks)
        # differing within-risk values but identical risk means → VHM <= 0
        risks2 = [
            RiskExperience("A", [0.5, 1.5, 1.0], [5.0, 5.0, 5.0]),
            RiskExperience("B", [0.5, 1.5], [5.0, 5.0]),
        ]
        with pytest.raises(ValueError, match="VHM"):
            buhlmann_straub(risks2)

    def test_zero_dof_epv_rejected(self):
        """Every risk has a single observed period → EPV degrees of
        freedom are zero."""
        risks = [
            RiskExperience("A", [1.0], [5.0]),
            RiskExperience("B", [1.0], [5.0]),
        ]
        with pytest.raises(ValueError, match="degrees of freedom"):
            buhlmann_straub(risks)

    def test_zero_exposure_period_dropped(self):
        """Zero-exposure periods are dropped (LDA Example 9.6.3
        convention); a non-zero loss rate against zero exposure is
        inconsistent and must fail closed."""
        ok = [
            RiskExperience("A", [0.0, 1.0, 1.5], [0.0, 2.0, 3.0]),
            RiskExperience("B", [2.0, 2.5, 3.0], [1.0, 2.0, 3.0]),
        ]
        out = buhlmann_straub(ok)
        assert out["risks"][0]["n_periods"] == 2
        bad = [
            RiskExperience("A", [0.5, 1.0, 1.5], [0.0, 2.0, 3.0]),
            RiskExperience("B", [2.0, 2.5, 3.0], [1.0, 2.0, 3.0]),
        ]
        with pytest.raises(ValueError, match="inconsistent"):
            buhlmann_straub(bad)

    def test_negative_and_nonfinite_exposure_rejected(self):
        risks = [
            RiskExperience("A", [1.0, 1.0], [-1.0, 2.0]),
            RiskExperience("B", [1.0, 1.0], [2.0, 2.0]),
        ]
        with pytest.raises(ValueError, match="negative exposure"):
            buhlmann_straub(risks)
        risks2 = [
            RiskExperience("A", [1.0, 1.0], [float("nan"), 2.0]),
            RiskExperience("B", [1.0, 1.0], [2.0, 2.0]),
        ]
        with pytest.raises(ValueError, match="non-finite"):
            buhlmann_straub(risks2)

    def test_length_mismatch_rejected(self):
        risks = [
            RiskExperience("A", [1.0, 1.0], [2.0]),
            RiskExperience("B", [1.0, 1.0], [2.0, 2.0]),
        ]
        with pytest.raises(ValueError, match="length"):
            buhlmann_straub(risks)
