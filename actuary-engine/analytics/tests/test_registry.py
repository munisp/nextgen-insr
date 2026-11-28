"""Model registry round-trip tests (Appendix H, Leg C).

Primary path: real MinIO testcontainer when docker is available. Fallback
when docker is absent: a documented wire double at the object-store
boundary (InMemoryObjectStore) — permitted because object stores are one
of the two allowed double boundaries (HTTP/object store). The registry API
and sha-verified round-trip are exercised identically in both paths.
"""

import shutil
import subprocess

import pytest

from actuary_analytics.registry import (
    ArtefactStoreError,
    InMemoryObjectStore,
    MinioObjectStore,
    ModelRegistry,
)

ARTEFACT = b'{"artefactType":"freq_sev_glm","version":"2026.09"}\n'


def _docker_available() -> bool:
    if shutil.which("docker") is None:
        return False
    try:
        subprocess.run(
            ["docker", "info"], capture_output=True, timeout=10, check=True
        )
        return True
    except Exception:  # noqa: BLE001 - fail-closed at external boundary (never guess data)
        return False


DOCKER = _docker_available()


def _exercise_registry(store):
    registry = ModelRegistry(store, prefix="actuary-models-test")
    model = registry.register_model(
        model_type="freq_sev_glm",
        version="2026.09",
        artefact=ARTEFACT,
        metrics={"devianceFreq": 0.98, "giniSev": 0.41},
        trained_at="2026-09-01T00:00:00Z",
    )
    assert model.id == 1
    assert model.stage == "candidate"
    assert model.artefact_uri.startswith("minio://")

    # round-trip: bytes come back unchanged and sha-verified
    payload = registry.download_artefact(model.id)
    assert payload == ARTEFACT

    # stage transition (candidate → approved)
    approved = registry.transition_stage(model.id, "approved", approved_by="actuary@nextgen-insr")
    assert approved.stage == "approved"
    assert approved.approved_by == "actuary@nextgen-insr"

    listing = registry.list_models(model_type="freq_sev_glm", stage="approved")
    assert [m.id for m in listing] == [model.id]

    # corruption detection on the round trip
    key = model.artefact_uri.replace("minio://", "")
    store.put(key, b'{"tampered":true}')
    with pytest.raises(ArtefactStoreError):
        registry.download_artefact(model.id)


class TestRegistryRoundTrip:
    def test_inmemory_boundary_round_trip(self):
        """Wire double at the object-store boundary (docker unavailable)."""
        _exercise_registry(InMemoryObjectStore())

    @pytest.mark.skipif(not DOCKER, reason="docker unavailable — MinIO testcontainer cannot start")
    def test_minio_testcontainer_round_trip(self):
        """Real MinIO round-trip via testcontainer (runs when docker exists).

        2026-11-28 (W34-E fix cycle 3, PR #358 run 46088768862): the library
        default image `minio/minio:RELEASE.2022-12-02T19-19-22Z` no longer
        pulls — MinIO removed the whole `minio/minio` repo from Docker Hub on
        2026-09-11 (runner 404 "pull access denied ... does not exist") and
        gated anonymous pulls on quay.io on ~2026-09-24, so NO official
        community-edition image is anonymously pullable anywhere. Pinned
        replacement: `pgsty/silo` (Pigsty's MinIO-CE fork on Docker Hub,
        per-version immutable tags). Tag verified anonymously via the Hub
        registry API (manifest HTTP 200, digest sha256:7bb2aff6…) and
        independently documented as runnable with `server /data` +
        /minio/health/live semantics. Silo follows modern MinIO env vars, so
        MINIO_ROOT_USER/PASSWORD are set explicitly alongside the legacy
        MINIO_ACCESS_KEY/SECRET_KEY the MinioContainer constructor emits —
        credentials stay `minioadmin`/`minioadmin` either way and get_config()
        plumbing is unchanged.
        """
        from testcontainers.minio import MinioContainer

        container = MinioContainer(image="docker.io/pgsty/silo:RELEASE.2026-10-26T00-00-00Z")
        # Env must be set BEFORE start() (the container boots on __enter__).
        container.with_env("MINIO_ROOT_USER", "minioadmin")
        container.with_env("MINIO_ROOT_PASSWORD", "minioadmin")
        with container as minio:
            cfg = minio.get_config()
            store = MinioObjectStore(
                endpoint=cfg["endpoint"].replace("http://", "").replace("https://", ""),
                access_key=cfg["access_key"],
                secret_key=cfg["secret_key"],
                bucket="actuary-registry-test",
                secure=cfg["endpoint"].startswith("https"),
            )
            _exercise_registry(store)

    def test_invalid_model_type_rejected(self):
        registry = ModelRegistry(InMemoryObjectStore())
        with pytest.raises(ValueError):
            registry.register_model("not_a_type", "1.0", ARTEFACT, {}, "2026-01-01T00:00:00Z")

    def test_missing_model_fails_closed(self):
        registry = ModelRegistry(InMemoryObjectStore())
        with pytest.raises(KeyError):
            registry.get_model(999)
