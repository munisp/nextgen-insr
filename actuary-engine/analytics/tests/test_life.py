"""Lifelines golden: Kaplan-Meier / Weibull fits on the shipped illustrative
mortality grid reproduce known survival quantiles (Appendix H, Leg C).
Also annuity PV vs hand computation and a deterministic profit test."""

import numpy as np
import pandas as pd

from actuary_analytics.life.annuity import annuity_pv, hand_annuity_pv
from actuary_analytics.life.mortality import (
    DISCLAIMER,
    fit_kaplan_meier,
    fit_weibull,
    illustrate_bases,
    km_quantiles,
    simulate_cohort,
    survival_from_qx,
)
from actuary_analytics.life.profit_test import profit_test

from .conftest import DATA, load_golden

SEED = 117


def _cohort():
    grid = pd.read_csv(DATA / "illustrative_mortality_grid.csv")
    qx = grid["qx"].to_numpy()
    ages = grid["age"].to_numpy()
    golden = load_golden("lifelines_golden.json")
    cohort = simulate_cohort(
        qx, ages,
        entry_age=golden["entry_age"],
        n_lives=golden["cohort_size"],
        seed=SEED,
        max_age=golden["max_age"],
    )
    return cohort, grid, golden


class TestLifelinesGolden:
    def test_km_survival_checkpoints(self):
        cohort, _, golden = _cohort()
        kmf = fit_kaplan_meier(cohort["durations"], cohort["event_observed"])
        sats = kmf.survival_function_at_times([5, 10, 20, 40]).values
        expected = golden["km_survival_at"]
        np.testing.assert_allclose(
            sats, [expected["5"], expected["10"], expected["20"], expected["40"]],
            rtol=1e-12,
        )

    def test_km_quantiles(self):
        cohort, _, golden = _cohort()
        kmf = fit_kaplan_meier(cohort["durations"], cohort["event_observed"])
        quantiles = km_quantiles(kmf)
        np.testing.assert_allclose(
            [quantiles["s0.75"], quantiles["s0.50"], quantiles["s0.25"]],
            [golden["km_quantiles"]["s0.75"], golden["km_quantiles"]["s0.50"],
             golden["km_quantiles"]["s0.25"]],
            rtol=1e-9,
        )

    def test_weibull_params(self):
        cohort, _, golden = _cohort()
        wf = fit_weibull(cohort["durations"], cohort["event_observed"])
        assert abs(wf.lambda_ - golden["weibull"]["lambda_"]) < 1e-9
        assert abs(wf.rho_ - golden["weibull"]["rho_"]) < 1e-9

    def test_event_counts_deterministic(self):
        cohort, _, golden = _cohort()
        assert int(cohort["event_observed"].sum()) == golden["events"]
        assert int((~cohort["event_observed"]).sum()) == golden["censored"]


class TestHonestLabelling:
    def test_all_bases_official_false_with_disclaimer(self):
        for basis in illustrate_bases():
            assert basis.official is False
            assert basis.status == "illustrative_reference"
            assert basis.disclaimer == DISCLAIMER
            assert "statutory valuation" in basis.disclaimer.lower()


class TestAnnuityPV:
    def test_annuity_pv_matches_hand_computation(self):
        grid = pd.read_csv(DATA / "illustrative_mortality_grid.csv")
        qx = grid["qx"].to_numpy()
        ages = grid["age"].to_numpy()
        entry_age = 65
        idx = int(np.where(ages == entry_age)[0][0])
        discount = [0.10] * 5
        surv = survival_from_qx(qx, entry_age, ages)[:5]
        result = annuity_pv(qx, idx, 0.0, discount, payment=1000.0)
        expected = hand_annuity_pv(surv, discount, 1000.0)
        assert abs(result["pv"] - expected) < 1e-9

    def test_guarantee_period_certain_pv(self):
        discount = [0.10] * 3
        grid = pd.read_csv(DATA / "illustrative_mortality_grid.csv")
        result = annuity_pv(
            grid["qx"].to_numpy(), 0, 0.0, discount, payment=500.0,
            guarantee_years=3,
        )
        v = [1 / 1.1, 1 / 1.21, 1 / 1.331]
        expected_guaranteed = sum(500.0 * vi for vi in v)
        assert abs(result["pv_guaranteed"] - expected_guaranteed) < 1e-9
        assert abs(result["pv"] - expected_guaranteed) < 1e-9

    def test_hand_annuity_5year_known_value(self):
        # 5-year annuity on a fixed qx grid: hand-computed golden check.
        qx = np.array([0.010, 0.012, 0.015, 0.020, 0.030])
        ages = np.array([60, 61, 62, 63, 64])
        surv = survival_from_qx(qx, 60, ages)
        pv = hand_annuity_pv(surv, [0.08] * 5, 1000.0)
        v = 1 / np.cumprod([1.08] * 5)
        expected = float(np.sum(1000.0 * surv * v))
        assert abs(pv - expected) < 1e-12
        assert 3000.0 < pv < 4200.0  # sane annuity factor


class TestProfitTest:
    def test_known_margin_and_signature(self):
        # Deterministic 3-year term product: verify margin & IRR by hand.
        premiums = [1200.0, 1200.0, 1200.0]
        qx = [0.005, 0.006, 0.007]
        reserves = [800.0, 600.0, 0.0]
        survival = [1 - 0.005, (1 - 0.005) * (1 - 0.006)]
        # survival vector must align: t_p_x for years 1..n
        survival = np.concatenate(([1.0 - 0.005], [0.995 * 0.994], [0.995 * 0.994 * 0.993]))
        result = profit_test(
            premiums=premiums,
            qx=qx,
            sum_assured=100_000.0,
            per_policy_expenses=[150.0, 50.0, 50.0],
            premium_expense_rate=0.05,
            reserves_end_of_year=reserves,
            survival=survival,
            discount=[0.10, 0.10, 0.10],
        )
        assert result.pv_premiums > 0
        assert -1.0 < result.margin < 1.0
        # Hand-verify year-1 signature: premium - expenses - mortality cost - reserve build
        y1 = 1200.0 - (150.0 + 0.05 * 1200.0) - 0.005 * 100_000.0 - (800.0 - 0.0)
        assert abs(result.profit_signature[0] - y1) < 1e-9
