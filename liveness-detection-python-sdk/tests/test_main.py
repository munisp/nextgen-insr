"""Tests for liveness-detection-python-sdk service (AB-16 rewrite).

The previous suite asserted the vulnerable random-pass/fail behavior; these
tests pin the new contract: real biometric input required, decisions delegated
to the liveness-detection service, CSPRNG session ids, retry cap + lockout.
"""
import os
import re

import pytest

os.environ["DEV_AUTH_BYPASS"] = "true"  # test env: skip bearer auth

from fastapi.testclient import TestClient
from src import main
from src.main import app

client = TestClient(app)

# 2026-10-02 (C2-b10): session state now lives in Redis (audit B10). Tests
# use a REAL Redis and skip when it is unreachable — the store under test is
# never mocked.
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")


def _redis_or_skip():
    r = main._get_redis()
    if r is None:
        pytest.skip(f"real Redis unreachable at {REDIS_URL} — skipping B10 session-store test")
    return r


@pytest.fixture(autouse=True)
def reset_sessions():
    r = main._get_redis()
    if r is not None:
        for key in r.scan_iter(f"{main._SDK_REDIS_PREFIX}*"):
            r.delete(key)
    yield


def fake_downstream_completed(payload):
    return {"session_id": payload["session_id"], "face_detected": True,
            "challenge": "blink", "completed": True, "frames": 5}


def fake_downstream_incomplete(payload):
    return {"session_id": payload["session_id"], "face_detected": True,
            "challenge": "blink", "completed": False, "frames": 2}


def make_session(monkeypatch, downstream):
    _redis_or_skip()

    def _post(path, payload):
        if path == "/challenge/start":
            return {"session_id": "ds-abc", "challenge": payload["challenge"]}
        return downstream(payload)
    monkeypatch.setattr(main, "_downstream_post", _post)
    resp = client.post("/api/v1/session/create")
    assert resp.status_code == 200
    return resp.json()["session_id"]


# ── Health ──────────────────────────────────────────────────────────────────

class TestHealth:
    def test_health_returns_200(self):
        assert client.get("/health").status_code == 200

    def test_health_contains_service_name(self):
        assert client.get("/health").json()["service"] == "liveness-detection-python-sdk"


# ── Session Management ──────────────────────────────────────────────────────

class TestSession:
    def test_create_session_csprng_ids(self, monkeypatch):
        s1 = make_session(monkeypatch, fake_downstream_incomplete)
        s2 = make_session(monkeypatch, fake_downstream_incomplete)
        assert re.fullmatch(r"LIV-[0-9a-f]{32}", s1), s1
        assert s1 != s2

    def test_create_session_shape(self, monkeypatch):
        sid = make_session(monkeypatch, fake_downstream_incomplete)
        data = client.post("/api/v1/session/create").json()
        assert data["max_attempts"] == 3
        assert data["timeout_seconds"] == 120
        assert sid.startswith("LIV-")


# ── Liveness Detection ─────────────────────────────────────────────────────

class TestLivenessDetection:
    def test_biometric_input_required(self, monkeypatch):
        sid = make_session(monkeypatch, fake_downstream_incomplete)
        resp = client.post("/api/v1/detect", json={"session_id": sid})
        assert resp.status_code == 400

    def test_unknown_session_rejected(self):
        _redis_or_skip()
        resp = client.post("/api/v1/detect",
                           json={"session_id": "LIV-nonexistent", "frame_base64": "AAAA"})
        assert resp.status_code == 404

    def test_pass_only_when_challenge_completes(self, monkeypatch):
        sid = make_session(monkeypatch, fake_downstream_completed)
        data = client.post("/api/v1/detect",
                           json={"session_id": sid, "frame_base64": "AAAA"}).json()
        assert data["decision"] == "pass"
        assert data["is_live"] is True

    def test_retry_until_cap_then_lockout(self, monkeypatch):
        sid = make_session(monkeypatch, fake_downstream_incomplete)
        last = None
        for _ in range(3):
            last = client.post("/api/v1/detect",
                               json={"session_id": sid, "frame_base64": "AAAA"}).json()
        assert last["decision"] == "fail"
        assert last["attempts_remaining"] == 0
        # 4th attempt: session is locked
        resp = client.post("/api/v1/detect",
                           json={"session_id": sid, "frame_base64": "AAAA"})
        assert resp.status_code == 423

    def test_passed_session_cannot_be_replayed(self, monkeypatch):
        sid = make_session(monkeypatch, fake_downstream_completed)
        client.post("/api/v1/detect", json={"session_id": sid, "frame_base64": "AAAA"})
        resp = client.post("/api/v1/detect", json={"session_id": sid, "frame_base64": "AAAA"})
        assert resp.status_code == 423

    def test_downstream_outage_fails_closed(self, monkeypatch):
        _redis_or_skip()

        def boom(path, payload):
            if path == "/challenge/start":
                return {"session_id": "ds-x", "challenge": "blink"}
            from fastapi import HTTPException
            raise HTTPException(status_code=503, detail="liveness detection service unavailable")
        monkeypatch.setattr(main, "_downstream_post", boom)
        sid = client.post("/api/v1/session/create").json()["session_id"]
        resp = client.post("/api/v1/detect", json={"session_id": sid, "frame_base64": "AAAA"})
        assert resp.status_code == 503


# ── Statistics (honest counters) ─────────────────────────────────────────────

class TestStats:
    def test_stats_returns_real_counters(self, monkeypatch):
        make_session(monkeypatch, fake_downstream_incomplete)
        data = client.get("/api/v1/stats").json()
        assert data["active_sessions"] >= 1
        assert "pass_rate" not in data  # no fabricated metrics


# ── Redis session persistence (2026-10-02, C2-b10) ───────────────────────────

class TestRedisSessionPersistence:
    def test_session_persisted_with_ttl(self, monkeypatch):
        r = _redis_or_skip()
        sid = make_session(monkeypatch, fake_downstream_incomplete)
        key = f"{main._SDK_REDIS_PREFIX}{sid}"
        raw = r.get(key)
        assert raw is not None, "session must be persisted to Redis"
        import json as jsonlib
        sess = jsonlib.loads(raw)
        assert sess["downstream_id"] == "ds-abc"
        assert sess["attempts"] == 0 and sess["locked"] is False
        ttl = r.ttl(key)
        assert 0 < ttl <= main._SDK_SESSION_TTL

    def test_restart_simulation(self, monkeypatch):
        """Create a session, simulate a process restart with a brand-new
        Redis client (no in-process state), then evaluate successfully."""
        r = _redis_or_skip()
        sid = make_session(monkeypatch, fake_downstream_completed)

        # "Restart": drop the module's cached client and session knowledge;
        # a fresh engine instance shares only Redis.
        main._redis_client = None
        import redis as redis_lib
        fresh = redis_lib.from_url(REDIS_URL, decode_responses=True, socket_timeout=5)
        main._redis_client = fresh

        sess = main._load_session(sid)
        assert sess is not None, "session must survive a restart via Redis"
        assert sess["downstream_id"] == "ds-abc"

        resp = client.post("/api/v1/detect",
                           json={"session_id": sid, "frame_base64": "AAAA"})
        assert resp.status_code == 200
        assert resp.json()["decision"] == "pass"

        # Attempt counters / lockout also persist across the "restart".
        assert main._load_session(sid)["locked"] is True
        r.delete(f"{main._SDK_REDIS_PREFIX}{sid}")

    def test_creation_fails_loud_when_redis_down(self, monkeypatch):
        _redis_or_skip()
        monkeypatch.setattr(main, "_get_redis", lambda: None)

        def _post(path, payload):
            return {"session_id": "ds-x", "challenge": "blink"}
        monkeypatch.setattr(main, "_downstream_post", _post)
        resp = client.post("/api/v1/session/create")
        assert resp.status_code == 503

    def test_unknown_session_fails_closed(self):
        _redis_or_skip()
        resp = client.post("/api/v1/detect",
                           json={"session_id": "LIV-" + "0" * 32, "frame_base64": "AAAA"})
        assert resp.status_code == 404
        assert not resp.json().get("is_live", False)


# ── Error Handling ──────────────────────────────────────────────────────────

class TestErrorHandling:
    def test_404_unknown_route(self):
        assert client.get("/api/v1/nonexistent").status_code == 404

    def test_detect_requires_session_id(self):
        assert client.post("/api/v1/detect", json={}).status_code == 422
