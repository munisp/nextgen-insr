"""F1 acceptance: model-validation charts (double-lift, lift, Gini).

All expected values are hand-computed analytically from the constructed
datasets below (derivations inline, per the F1 discipline — no eyeballed
numbers). Method reference for the double-lift: casact/double_lift
(MPL-2.0) — ratio ordering pred_a/pred_b, equal-weight buckets, per-bucket
comparison of actual vs both predictions. Our implementation uses weighted
means per bucket; with equal weights this reduces to plain means.
"""

from __future__ import annotations

import numpy as np
import pytest

from actuary_analytics.model_validation import (
    concentration_curve,
    double_lift,
    gini,
    gini_normalized,
    lift_chart,
)

# Hand-constructed 8-policy dataset.
#
# ratio = pred_a / pred_b = [1/8, 2/7, 1/2, 4/5, 5/4, 2, 7/2, 8] — already
# ascending, so the ratio ordering is the identity ordering. With equal
# weights and 4 groups, each bucket is a consecutive pair:
#   g1 = rows 0-1, g2 = rows 2-3, g3 = rows 4-5, g4 = rows 6-7.
ACTUAL = np.array([1.0, 2, 3, 4, 5, 6, 7, 8])
PRED_A = np.array([2.0, 4, 6, 8, 10, 12, 14, 16])
PRED_B = np.array([16.0, 14, 12, 10, 8, 6, 4, 2])


class TestDoubleLift:
    def test_group_means_hand_computed(self):
        df = double_lift(ACTUAL, PRED_A, PRED_B, n_groups=4)
        # Bucket means (consecutive pairs):
        #   actual: (1+2)/2=1.5, (3+4)/2=3.5, (5+6)/2=5.5, (7+8)/2=7.5
        #   pred_a: (2+4)/2=3,   (6+8)/2=7,   (10+12)/2=11, (14+16)/2=15
        #   pred_b: (16+14)/2=15,(12+10)/2=11,(8+6)/2=7,    (4+2)/2=3
        np.testing.assert_allclose(df["group"], [1, 2, 3, 4])
        np.testing.assert_allclose(df["weight"], [2, 2, 2, 2])
        np.testing.assert_allclose(df["actual"], [1.5, 3.5, 5.5, 7.5])
        np.testing.assert_allclose(df["pred_a"], [3.0, 7.0, 11.0, 15.0])
        np.testing.assert_allclose(df["pred_b"], [15.0, 11.0, 7.0, 3.0])

    def test_rescaled_form_hand_computed(self):
        df = double_lift(ACTUAL, PRED_A, PRED_B, n_groups=4, rescale=True)
        # pred_a/actual = 2 in every bucket (a is exactly 2x actual);
        # pred_b/actual = 15/1.5=10, 11/3.5=22/7, 7/5.5=14/11, 3/7.5=0.4.
        np.testing.assert_allclose(df["actual"], [1, 1, 1, 1])
        np.testing.assert_allclose(df["pred_a"], [2, 2, 2, 2])
        np.testing.assert_allclose(df["pred_b"], [10.0, 22 / 7, 14 / 11, 0.4])

    def test_ordering_is_ratio_based(self):
        # Swap the models: ratio pred_b/pred_a = [8, 7/2, 2, 5/4, 4/5, 1/2,
        # 2/7, 1/8] — descending, so the sorted ratio ordering reverses the
        # rows: buckets are {7,6}, {5,4}, {3,2}, {1,0}.
        df = double_lift(ACTUAL, PRED_B, PRED_A, n_groups=4)
        # pred_a column here holds PRED_B values: (2+4)/2=3, (6+8)/2=7,
        # (10+12)/2=11, (14+16)/2=15 — the mirror image of the original run.
        np.testing.assert_allclose(df["pred_a"], [3.0, 7.0, 11.0, 15.0])
        np.testing.assert_allclose(df["pred_b"], [15.0, 11.0, 7.0, 3.0])
        np.testing.assert_allclose(df["actual"], [7.5, 5.5, 3.5, 1.5])

    def test_weight_mismatch_raises(self):
        with pytest.raises(ValueError):
            double_lift(ACTUAL, PRED_A, PRED_B, weight=[1.0, 2.0])

    def test_renders_without_error(self):
        fig = __import__("actuary_analytics.model_validation", fromlist=["render_double_lift"]).render_double_lift(
            double_lift(ACTUAL, PRED_A, PRED_B, n_groups=4))
        assert fig is not None


class TestLiftChart:
    def test_lift_hand_computed(self):
        df = lift_chart(ACTUAL, PRED_A, n_groups=4)
        # Buckets are the same consecutive pairs (pred_a ascending = identity
        # ordering). lift = actual_mean / pred_mean = 0.5 in every bucket;
        # cumulative lift stays 0.5 throughout.
        np.testing.assert_allclose(df["actual"], [1.5, 3.5, 5.5, 7.5])
        np.testing.assert_allclose(df["predicted"], [3.0, 7.0, 11.0, 15.0])
        np.testing.assert_allclose(df["lift"], [0.5, 0.5, 0.5, 0.5])
        np.testing.assert_allclose(df["cumulative_lift"], [0.5, 0.5, 0.5, 0.5])

    def test_lift_monotone_for_discriminating_model(self):
        # pred proportional to actual scaled up: lift is flat (calibrated);
        # swap to a shuffled prediction and lift must become non-constant.
        df_flat = lift_chart(ACTUAL, ACTUAL * 2, n_groups=4)
        np.testing.assert_allclose(df_flat["lift"], [0.5, 0.5, 0.5, 0.5])
        rng = np.random.default_rng(7)
        shuffled = lift_chart(ACTUAL, rng.permutation(ACTUAL), n_groups=4)
        assert np.ptp(shuffled["lift"].to_numpy()) > 0


class TestGini:
    def test_gini_hand_computed_equal_weights(self):
        # actual = [1,2,3,4], perfect ascending ordering. Standard formula
        # Gini = (2 * sum_i i*a_i - (n+1) * sum a) / (n * sum a)
        #      = (2*30 - 5*10) / (4*10) = 10/40 = 0.25.
        assert np.isclose(gini([1, 2, 3, 4], [1, 2, 3, 4]), 0.25)

    def test_gini_anti_perfect_ordering(self):
        # Reverse ordering negates the coefficient: -0.25 (symmetric).
        assert np.isclose(gini([1, 2, 3, 4], [4, 3, 2, 1]), -0.25)

    def test_gini_weighted_hand_computed(self):
        # weights [2,1,1,1] on actual [1,2,3,4], perfect ordering:
        # F = [.4,.6,.8,1], L = [2,4,7,11]/11,
        # A = .4*(2/11)/2 + .2*(6/11)/2 + .2*(11/11)/2 + .2*(18/11)/2 = 3.9/11
        # Gini = 1 - 2*3.9/11 = 3.2/11.
        assert np.isclose(gini([1, 2, 3, 4], [1, 2, 3, 4], weight=[2, 1, 1, 1]),
                          3.2 / 11)

    def test_gini_zero_actuals_returns_zero(self):
        # Package convention (freqsev/artefact.py._gini): zero total actual.
        assert gini([0, 0, 0], [1, 2, 3]) == 0.0

    def test_normalized_perfect_is_one_random_about_zero(self):
        rng = np.random.default_rng(42)
        n = 20000
        actual = rng.gamma(2.0, 1.0, n)
        # Perfect model: ordering by actual => normalized Gini == 1 exactly.
        assert np.isclose(gini_normalized(actual, actual), 1.0)
        # Random model: prediction independent of actual => Gini ~ 0.
        random_pred = rng.gamma(2.0, 1.0, n)
        g_rand = gini(actual, random_pred)
        assert abs(g_rand) < 0.02, f"random-model Gini {g_rand} not ~0"
        assert abs(gini_normalized(actual, random_pred)) < 0.05


class TestConcentrationCurve:
    def test_endpoints_and_diagonal(self):
        df = concentration_curve(ACTUAL, PRED_A)
        assert df["exposure_share"].iloc[0] == 0.0
        assert df["exposure_share"].iloc[-1] == 1.0
        assert df["actual_share"].iloc[0] == 0.0
        assert np.isclose(df["actual_share"].iloc[-1], 1.0)
        np.testing.assert_allclose(df["diagonal"], df["exposure_share"])

    def test_perfect_ordering_concentration_hand_computed(self):
        # actual [1,2,3,4] ordered by itself ascending, equal weights:
        # exposure [0,.25,.5,.75,1], actual share [0,1/10,3/10,6/10,1].
        df = concentration_curve([1, 2, 3, 4], [1, 2, 3, 4])
        np.testing.assert_allclose(df["exposure_share"], [0, 0.25, 0.5, 0.75, 1])
        np.testing.assert_allclose(df["actual_share"], [0, 0.1, 0.3, 0.6, 1])

    def test_zero_actual_raises(self):
        with pytest.raises(ValueError):
            concentration_curve([0, 0, 0], [1, 2, 3])

    def test_renders_without_error(self):
        from actuary_analytics.model_validation import render_concentration, render_lift

        assert render_concentration(concentration_curve(ACTUAL, PRED_A)) is not None
        assert render_lift(lift_chart(ACTUAL, PRED_A, n_groups=4)) is not None
