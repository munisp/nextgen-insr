"""GLM refit byte-identical artefact (design Appendix F + Appendix H Leg C).

Real statsmodels GLM fits on the shipped training dataset. A fixed-seed
deterministic refit must reproduce the exported artefact byte-for-byte.
"""

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


def _train():
    df = pd.read_csv(DATA / "motor_policy_glm.csv")
    return train_freq_sev(df), df


class TestArtefactByteIdentity:
    def test_refit_reproduces_golden_bytes(self):
        golden_bytes = (DATA / "glm_artefact_golden.json").read_bytes()
        fitted, df = _train()
        artefact = build_artefact(fitted, df, trained_at=TRAINED_AT, provenance=PROVENANCE)
        assert artefact_to_bytes(artefact) == golden_bytes

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
