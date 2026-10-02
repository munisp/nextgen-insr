"""Tests for the Redis-backed challenge store (2026-10-02, C2-b10 / audit B10).

Uses a REAL Redis (REDIS_URL env, default redis://localhost:6379/0) and skips
when it is unreachable — the store under test is never mocked. Includes a
restart simulation: a challenge created by one ChallengeStore instance must be
loadable and evaluable by a brand-new instance sharing the same Redis.

Run: python -m pytest test_challenge_store.py -v
"""

import json
import os
from dataclasses import asdict

import pytest

redis = pytest.importorskip("redis")

import liveness_service as svc

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
TEST_PREFIX = f"{svc._REDIS_PREFIX}test-"


@pytest.fixture()
def store():
    try:
        client = redis.Redis.from_url(REDIS_URL, decode_responses=True,
                                      socket_timeout=2)
        client.ping()
    except Exception:
        pytest.skip(f"real Redis unreachable at {REDIS_URL} — skipping B10 store tests")
    s = svc.ChallengeStore(client)
    yield s
    for key in client.scan_iter(f"{TEST_PREFIX}*"):
        client.delete(key)


def _create_test_challenge(store, challenge="blink"):
    state = store.create(challenge)
    # Rewrite under a test-namespaced key so cleanup never touches real data.
    client = store._redis
    client.delete(f"{svc._REDIS_PREFIX}{state.session_id}")
    state.session_id = f"test-{state.session_id}"
    client.setex(f"{svc._REDIS_PREFIX}{state.session_id}", svc._SESSION_TTL,
                 json.dumps(asdict(state)))
    return state


def _passing_blink_frames(state):
    # Genuine dip-and-recover EAR pattern (matches test_noisy_cameras usage).
    state.ear_history = [0.30, 0.30, 0.29, 0.10, 0.08, 0.12, 0.30, 0.31]


class TestChallengeStore:
    def test_create_persists_with_ttl(self, store):
        state = _create_test_challenge(store)
        key = f"{svc._REDIS_PREFIX}{state.session_id}"
        assert store._redis.get(key) is not None
        ttl = store._redis.ttl(key)
        assert 0 < ttl <= svc._SESSION_TTL

    def test_get_roundtrip(self, store):
        state = _create_test_challenge(store, challenge="nod")
        loaded = store.get(state.session_id)
        assert loaded is not None
        assert loaded.challenge == "nod"
        assert loaded.session_id == state.session_id

    def test_unknown_session_fails_closed(self, store):
        assert store.get("test-does-not-exist") is None

    def test_restart_simulation(self, store):
        """Create with one store instance; evaluate with a NEW engine instance
        backed by a NEW Redis connection (i.e. a post-restart process)."""
        state = _create_test_challenge(store)
        _passing_blink_frames(state)
        store.save(state)

        # Simulated restart: fresh connection, fresh store, no shared memory.
        fresh_client = redis.Redis.from_url(REDIS_URL, decode_responses=True,
                                            socket_timeout=2)
        restarted_store = svc.ChallengeStore(fresh_client)
        loaded = restarted_store.get(state.session_id)
        assert loaded is not None, "challenge must survive a restart via Redis"
        assert loaded.ear_history == state.ear_history
        assert svc._check_challenge(loaded) is True

    def test_save_preserves_ttl(self, store):
        state = _create_test_challenge(store)
        key = f"{svc._REDIS_PREFIX}{state.session_id}"
        state.ear_history = [0.3, 0.3, 0.3]
        store.save(state)
        ttl = store._redis.ttl(key)
        assert 0 < ttl <= svc._SESSION_TTL


class TestFailLoudCreation:
    def test_create_raises_when_redis_down(self):
        # A store whose connection target does not exist must raise on
        # connect/create — never fall back to process memory.
        with pytest.raises(Exception):
            svc.ChallengeStore.connect("redis://localhost:6399/9")

    def test_endpoint_creation_fails_loud(self, monkeypatch):
        if svc.FastAPI is None:
            pytest.skip("fastapi not installed")
        from fastapi.testclient import TestClient

        def _boom():
            raise RuntimeError("redis: connection refused")
        monkeypatch.setattr(svc, "_get_store", _boom)
        client = TestClient(svc.app)
        resp = client.post("/challenge/start", json={"challenge": "blink"})
        assert resp.status_code == 503
