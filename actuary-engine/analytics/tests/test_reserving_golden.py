"""Golden reproduction: chainladder CL on shipped datasets (genins-style)
plus the Mack triangle (design Appendix H, Leg C). Values verified against
the real chainladder library; all fits in these tests are real library
calls — no mocks."""

import chainladder as cl
import numpy as np

from actuary_analytics.reserving.methods import chain_ladder, mack

from .conftest import load_golden


class TestGenInsGolden:
    """Volume-weighted and simple-average factor paths on genins."""

    def test_volume_weighted_ldfs(self):
        golden = load_golden("genins_golden.json")
        result = chain_ladder(cl.load_sample("genins"), average="volume")
        np.testing.assert_allclose(
            result["development_factors"], golden["ldf_volume"], rtol=1e-9
        )
        np.testing.assert_allclose(result["cdfs"], golden["cdf_volume"], rtol=1e-9)

    def test_simple_average_ldfs(self):
        golden = load_golden("genins_golden.json")
        result = chain_ladder(cl.load_sample("genins"), average="simple")
        np.testing.assert_allclose(
            result["development_factors"], golden["ldf_simple"], rtol=1e-9
        )

    def test_ultimates_and_ibnr_reproduced(self):
        golden = load_golden("genins_golden.json")
        result = chain_ladder(cl.load_sample("genins"))
        ult = [result["ultimate_by_origin"][o] for o in golden["origins"]]
        np.testing.assert_allclose(ult, golden["ultimate_volume"], rtol=1e-9)
        ibnr = [result["ibnr_by_origin"][o] for o in golden["origins"]]
        np.testing.assert_allclose(ibnr, golden["ibnr_volume"], rtol=1e-9)
        assert abs(result["total_ibnr"] - golden["total_ibnr_volume"]) < 1e-2

    def test_latest_diagonal_matches_wrapper_output(self):
        golden = load_golden("genins_golden.json")
        tri = cl.load_sample("genins")
        result = chain_ladder(tri)
        # ultimates are floored at the latest observed diagonal
        for origin, latest in zip(golden["origins"], golden["latest_diagonal"]):
            assert result["ultimate_by_origin"][origin] >= latest


class TestMackTriangleGolden:
    """Mack (1991) published triangle via the shipped 'mack_1997' sample."""

    def test_ultimates_match_published(self):
        golden = load_golden("mack_golden.json")
        result = mack(cl.load_sample("mack_1997"))
        ult = [result["ultimate_by_origin"][o] for o in golden["origins"]]
        np.testing.assert_allclose(ult, golden["ultimate"], rtol=1e-6)

    def test_per_origin_mack_se(self):
        golden = load_golden("mack_golden.json")
        result = mack(cl.load_sample("mack_1997"))
        for origin, se in zip(golden["origins"], golden["mack_se"]):
            actual = result["mack_se_by_origin"][origin]
            if se is None:
                assert actual is None
            else:
                assert abs(actual - se) / se < 1e-9

    def test_total_reserve_and_se_published(self):
        golden = load_golden("mack_golden.json")
        result = mack(cl.load_sample("mack_1997"))
        assert abs(result["total_ibnr"] - golden["published_total_reserve"]) < 0.5
        # Published total Mack SE is 26,880.74 (Mack 1991); allow 0.5%.
        assert abs(result["total_mack_se"] - golden["total_mack_se"]) / golden[
            "total_mack_se"
        ] < 0.005

    def test_volume_factors_reproduced(self):
        golden = load_golden("mack_golden.json")
        result = mack(cl.load_sample("mack_1997"))
        np.testing.assert_allclose(
            result["development_factors"], golden["ldf_volume"], rtol=1e-9
        )
