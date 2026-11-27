"""F1 registry exposure: the new capabilities register through the same
ModelRegistry flow as the existing modules (reserving/life/freqsev), so
Go/TS layers can discover them via the registry surface.

New model types (registry/registry.py MODEL_TYPES):
  * ``agg_dist``    — aggregate-loss distribution / distortion-pricing
                      artefacts (actuary_analytics.aggdist, adopted
                      ``aggregate`` v2.1.0).
  * ``tweedie_dist``— standalone Tweedie density model artefacts
                      (actuary_analytics.freqsev.tweedie_tools, adopted
                      ``tweedie`` 0.0.9).
Both follow the identical register/stage/round-trip contract as
``freq_sev_glm`` — no new paths, just extended discovery.
"""

from __future__ import annotations

import pytest

from actuary_analytics.registry import InMemoryObjectStore, ModelRegistry
from actuary_analytics.registry.registry import MODEL_TYPES


def test_new_model_types_are_registered():
    assert "agg_dist" in MODEL_TYPES
    assert "tweedie_dist" in MODEL_TYPES
    # Existing types preserved (backwards compatibility of the registry).
    for existing in ("freq_glm", "sev_glm", "freq_sev_glm", "mortality",
                     "capital", "fraud_link"):
        assert existing in MODEL_TYPES


def test_new_types_follow_the_same_register_stage_roundtrip():
    registry = ModelRegistry(InMemoryObjectStore(), prefix="actuary-models-f1")
    for model_type, artefact in (
        ("agg_dist", b'{"artefactType":"agg_dist","spec":"agg Tail 5 claims sev lognorm 100 cv 3 poisson"}\n'),
        ("tweedie_dist", b'{"artefactType":"tweedie_dist","power":1.6,"phi":0.75}\n'),
    ):
        model = registry.register_model(
            model_type=model_type,
            version="2026.11",
            artefact=artefact,
            metrics={"golden": "pinned"},
            trained_at="2026-11-01T00:00:00Z",
        )
        approved = registry.transition_stage(model.id, "approved",
                                             approved_by="actuary@nextgen-insr")
        assert approved.stage == "approved"
        assert registry.download_artefact(model.id) == artefact
        listing = registry.list_models(model_type=model_type, stage="approved")
        assert [m.id for m in listing] == [model.id]


def test_unknown_type_still_fails_closed():
    registry = ModelRegistry(InMemoryObjectStore(), prefix="actuary-models-f1-x")
    with pytest.raises(ValueError):
        registry.register_model(
            model_type="not_a_capability",
            version="2026.11",
            artefact=b"{}",
            metrics={},
            trained_at="2026-11-01T00:00:00Z",
        )
