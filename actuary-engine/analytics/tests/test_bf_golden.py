"""Bornhuetter-Ferguson golden: priced-loss-ratio a priori reproduces the
hand-computed blend exactly (design Appendix H, Leg C)."""

import numpy as np

from actuary_analytics.reserving.methods import (
    bornhuetter_ferguson,
    hand_bf_blend,
    triangle_dict_to_chainladder,
)

from .conftest import load_golden


def _golden():
    g = load_golden("bf_golden.json")
    tri = np.array(
        [[np.nan if v is None else v for v in row] for row in g["triangle"]],
        dtype=float,
    )
    return g, tri


def test_hand_blend_matches_golden():
    g, tri = _golden()
    hand = hand_bf_blend(tri, np.asarray(g["apriori_ultimates"]))
    np.testing.assert_allclose(hand["ldfs"], g["hand_ldf_volume"], rtol=1e-12)
    np.testing.assert_allclose(hand["cdfs"], g["hand_cdf"], rtol=1e-12)
    np.testing.assert_allclose(hand["latest"], g["hand_latest"], rtol=1e-12)
    np.testing.assert_allclose(hand["ultimate"], g["hand_bf_ultimates"], rtol=1e-12)
    np.testing.assert_allclose(hand["ibnr"], g["hand_bf_ibnr"], rtol=1e-12)


def test_chainladder_bf_reproduces_hand_blend():
    """The library BF (real chainladder call) must equal the textbook blend
    ultimate = latest + a_priori * (1 - 1/CDF) with priced-LR a priori."""
    g, _tri = _golden()
    tri_dict = {
        f"200{i + 1}": [v for v in row if v is not None]
        for i, row in enumerate(g["triangle"])
    }
    tri = triangle_dict_to_chainladder(tri_dict)
    result = bornhuetter_ferguson(tri, np.asarray(g["apriori_ultimates"]))
    origins = sorted(tri_dict)
    ult = [result["ultimate_by_origin"][o] for o in origins]
    np.testing.assert_allclose(ult, g["hand_bf_ultimates"], rtol=1e-9)
    ibnr = [result["ibnr_by_origin"][o] for o in origins]
    np.testing.assert_allclose(ibnr, g["hand_bf_ibnr"], rtol=1e-9)
    np.testing.assert_allclose(
        result["development_factors"], g["hand_ldf_volume"], rtol=1e-9
    )
    assert abs(result["total_ibnr"] - sum(g["hand_bf_ibnr"])) < 1e-2


def test_bf_apriori_length_validation():
    g, _ = _golden()
    tri_dict = {
        f"200{i + 1}": [v for v in row if v is not None]
        for i, row in enumerate(g["triangle"])
    }
    tri = triangle_dict_to_chainladder(tri_dict)
    try:
        bornhuetter_ferguson(tri, np.asarray([1.0, 2.0]))
        raised = False
    except ValueError:
        raised = True
    assert raised, "mismatched a priori vector must fail closed"
