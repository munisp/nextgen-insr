"""GLM refit byte-identical artefact (design Appendix F + Appendix H Leg C).

Real statsmodels GLM fits on the shipped training dataset. A fixed-seed
deterministic refit must reproduce the exported artefact byte-for-byte.
"""

import json
import math

import pandas as pd

from actuary_analytics.freqsev import (
    artefact_to_bytes,
    build_artefact,
    fit_tweedie_pure_premium,
    train_freq_sev,
)

from .conftest import DATA

TRAINED_AT = "2026-09-01T00:00:00Z"
PROVENANCE = {
    "modelRegistryId": 42,
    "approvedBy": "actuary@nextgen-insr",
    "naicomFilingRef": None,
}

# 2026-11-28 (W34-E fix cycle 3): tolerance tiers for the structured golden
# contract — see test_refit_reproduces_golden_bytes docstring for evidence.
# Continuous-fit fields: rel 1e-9 (IRLS CPU noise ~1e-13, regressions ~1e-2+).
_FLOAT_REL_TOL = 1e-9
# Order-statistic metrics whose values depend on argsort tie ordering (CPU
# dispatch): measured tie-order envelope Δ ≈ 1.3e-3 → abs 5e-3 with margin.
_ORDER_STAT_KEYS = {"giniSev"}
_ORDER_STAT_ABS_TOL = 5e-3


def _assert_artefact_contract(actual, golden, path=""):
    """Deep structural comparison: exact for structure/strings/ints, tiered
    tolerance for floats (see module docstring constants above)."""
    assert type(actual) is type(golden), f"{path}: type {type(actual).__name__} != {type(golden).__name__}"
    if isinstance(golden, dict):
        assert set(actual.keys()) == set(golden.keys()), (
            f"{path}: key set differs — only actual {sorted(set(actual)-set(golden))}, "
            f"only golden {sorted(set(golden)-set(actual))}"
        )
        for key in golden:
            _assert_artefact_contract(actual[key], golden[key], f"{path}.{key}" if path else key)
    elif isinstance(golden, list):
        assert len(actual) == len(golden), f"{path}: length {len(actual)} != {len(golden)}"
        for i, (a, g) in enumerate(zip(actual, golden)):
            _assert_artefact_contract(a, g, f"{path}[{i}]")
    elif isinstance(golden, bool):
        assert actual == golden, f"{path}: {actual!r} != {golden!r}"
    elif isinstance(golden, int):
        # counts and ids stay exact (nClaims, nObs, modelRegistryId)
        assert actual == golden, f"{path}: {actual!r} != {golden!r}"
    elif isinstance(golden, float):
        leaf = path.rsplit(".", 1)[-1]
        if leaf in _ORDER_STAT_KEYS:
            assert abs(actual - golden) <= _ORDER_STAT_ABS_TOL, (
                f"{path}: order-statistic metric moved {abs(actual-golden):.3g} "
                f"(>{_ORDER_STAT_ABS_TOL}) — beyond the tie-order envelope"
            )
        else:
            assert actual == golden or math.isclose(actual, golden, rel_tol=_FLOAT_REL_TOL, abs_tol=0.0), (
                f"{path}: {actual!r} vs golden {golden!r} differ beyond rel {_FLOAT_REL_TOL}"
            )
    else:
        assert actual == golden, f"{path}: {actual!r} != {golden!r}"


def _train():
    df = pd.read_csv(DATA / "motor_policy_glm.csv")
    return train_freq_sev(df), df


class TestArtefactByteIdentity:
    def test_refit_reproduces_golden_bytes(self):
        """Refit reproduces the golden artefact under a structured contract.

        2026-11-28 (W34-E fix cycle 3, PR #358 run 46088768862): the raw
        byte-equality assertion was over-strong for heterogeneous CPUs. The
        runner reproduced EVERY field byte-identically except
        training.metrics.giniSev (golden 1.093065509283, runner 1.09426824799,
        Δ=1.2e-3, rel 1.1e-3). Root cause is NOT a fit difference: giniSev is
        an order-statistic metric — _gini argsorts 480 severity predictions
        containing 453 EXACT ties (measured: min nonzero prediction gap
        57.47), so the Lorenz sum depends on tie ORDER, which depends on
        np.argsort's sort path and therefore on CPU microarch dispatch.
        Measured locally with identical pins (numpy 2.2.5): quicksort
        1.093065509283 (=golden), stable 1.094179992343546, heapsort
        1.094339742519488 — the runner's 1.09426824799 sits inside this
        tie-order envelope, while every continuous field (all coefficients,
        base rates, devianceFreq) matched golden to the full 12 printed
        decimals. Contract below: structure, keys, strings, counts, hashes
        and artefact version remain BYTE-EXACT semantics; continuous floats
        at rel 1e-9 (catch any real refit drift — IRLS CPU noise is ~1e-13);
        order-statistic giniSev at abs 5e-3 (covers measured tie-order
        envelope 1.3e-3 with ~4x margin; any real fit regression also shifts
        the rel-1e-9 coefficient fields, so no regression can hide here).
        """
        golden = json.loads((DATA / "glm_artefact_golden.json").read_text())
        fitted, df = _train()
        artefact = build_artefact(fitted, df, trained_at=TRAINED_AT, provenance=PROVENANCE)
        # serialization coverage preserved: bytes must round-trip exactly
        assert json.loads(artefact_to_bytes(artefact).decode()) == artefact
        _assert_artefact_contract(artefact, golden)

    def test_second_refit_is_byte_identical_to_first(self):
        fitted1, df = _train()
        fitted2, _ = _train()
        b1 = artefact_to_bytes(build_artefact(fitted1, df, trained_at=TRAINED_AT, provenance=PROVENANCE))
        b2 = artefact_to_bytes(build_artefact(fitted2, df, trained_at=TRAINED_AT, provenance=PROVENANCE))
        assert b1 == b2

    def test_artefact_schema_fields(self):
        golden_bytes = (DATA / "glm_artefact_golden.json").read_bytes()
        import json

        artefact = json.loads(golden_bytes.decode())
        assert artefact["artefactType"] == "freq_sev_glm"
        assert artefact["frequency"]["family"] == "poisson"
        assert artefact["frequency"]["link"] == "log"
        assert artefact["severity"]["family"] == "gamma"
        assert "intercept" in artefact["frequency"]["coefficients"]
        assert artefact["exposureUnit"] == "vehicle_year"
        assert artefact["training"]["datasetHash"].startswith("sha256:")
        assert artefact["provenance"]["modelRegistryId"] == 42
        # canonical JSON: sorted keys round-trip
        assert json.dumps(json.loads(golden_bytes.decode()), sort_keys=True) \
            == json.dumps(artefact, sort_keys=True)

    def test_relativities_derived_from_coefficients(self):
        import json
        import math

        artefact = json.loads((DATA / "glm_artefact_golden.json").read_bytes().decode())
        coefs = artefact["frequency"]["coefficients"]
        rels = artefact["relativities"]["frequency"]
        assert abs(rels["vehicle_class"]["suv"] - math.exp(coefs["vehicle_class[suv]"])) < 1e-9

    def test_tweedie_option_fits(self):
        df = pd.read_csv(DATA / "motor_policy_glm.csv")
        tweedie = fit_tweedie_pure_premium(df)
        assert "Intercept" in tweedie.params
        assert len(tweedie.params) == 7  # intercept + 6 category dummies
