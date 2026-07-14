"""Tests for liveness-detection-python-sdk service."""
import pytest
from fastapi.testclient import TestClient
from src.main import app

client = TestClient(app)


# ── Health ──────────────────────────────────────────────────────────────────

class TestHealth:
    def test_health_returns_200(self):
        resp = client.get("/health")
        assert resp.status_code == 200

    def test_health_contains_service_name(self):
        data = client.get("/health").json()
        assert data["service"] == "liveness-detection-python-sdk"

    def test_health_status_healthy(self):
        assert client.get("/health").json()["status"] == "healthy"


# ── Liveness Detection ─────────────────────────────────────────────────────

class TestLivenessDetection:
    def test_detect_liveness_returns_200(self):
        resp = client.post("/api/v1/detect", json={"session_id": "LIV-001"})
        assert resp.status_code == 200

    def test_detect_liveness_response_structure(self):
        data = client.post("/api/v1/detect", json={"session_id": "LIV-001"}).json()
        for field in ["session_id", "is_live", "confidence", "challenge_passed", "anti_spoof_score", "decision", "attempts_remaining"]:
            assert field in data, f"Missing field: {field}"

    def test_detect_liveness_confidence_range(self):
        data = client.post("/api/v1/detect", json={"session_id": "LIV-002"}).json()
        assert 0.7 <= data["confidence"] <= 0.99

    def test_detect_liveness_anti_spoof_range(self):
        data = client.post("/api/v1/detect", json={"session_id": "LIV-003"}).json()
        assert 0.8 <= data["anti_spoof_score"] <= 0.99

    def test_detect_liveness_decision_values(self):
        data = client.post("/api/v1/detect", json={"session_id": "LIV-004"}).json()
        assert data["decision"] in ("pass", "retry", "fail")

    def test_detect_liveness_session_id_preserved(self):
        resp = client.post("/api/v1/detect", json={"session_id": "MY-SESSION-123"})
        assert resp.json()["session_id"] == "MY-SESSION-123"

    def test_detect_liveness_attemps_remaining_decreases(self):
        r1 = client.post("/api/v1/detect", json={"session_id": "LIV-005", "attempt": 1}).json()
        r2 = client.post("/api/v1/detect", json={"session_id": "LIV-005", "attempt": 3}).json()
        assert r1["attempts_remaining"] > r2["attempts_remaining"]

    def test_detect_liveness_is_live_boolean(self):
        data = client.post("/api/v1/detect", json={"session_id": "LIV-006"}).json()
        assert isinstance(data["is_live"], bool)

    def test_detect_liveness_different_session_ids(self):
        r1 = client.post("/api/v1/detect", json={"session_id": "LIV-007a"}).json()
        r2 = client.post("/api/v1/detect", json={"session_id": "LIV-007b"}).json()
        assert r1["session_id"] == "LIV-007a"
        assert r2["session_id"] == "LIV-007b"

    def test_detect_liveness_challenge_type_default(self):
        resp = client.post("/api/v1/detect", json={"session_id": "LIV-008"})
        assert resp.status_code == 200


# ── Session Management ─────────────────────────────────────────────────────

class TestSession:
    def test_create_session_returns_200(self):
        resp = client.post("/api/v1/session/create")
        assert resp.status_code == 200

    def test_create_session_has_session_id(self):
        data = client.post("/api/v1/session/create").json()
        assert "session_id" in data
        assert data["session_id"].startswith("LIV-")

    def test_create_session_has_challenges(self):
        data = client.post("/api/v1/session/create").json()
        assert "challenges" in data
        assert len(data["challenges"]) > 0

    def test_create_session_has_timeout(self):
        data = client.post("/api/v1/session/create").json()
        assert data["timeout_seconds"] == 120

    def test_create_session_has_max_attempts(self):
        data = client.post("/api/v1/session/create").json()
        assert data["max_attempts"] == 3

    def test_create_session_challenges_include_blink(self):
        data = client.post("/api/v1/session/create").json()
        assert "blink" in data["challenges"]


# ── Statistics ──────────────────────────────────────────────────────────────

class TestStats:
    def test_stats_returns_200(self):
        assert client.get("/api/v1/stats").status_code == 200

    def test_stats_has_total_sessions(self):
        data = client.get("/api/v1/stats").json()
        assert "total_sessions_24h" in data
        assert data["total_sessions_24h"] > 0

    def test_stats_has_pass_rate(self):
        data = client.get("/api/v1/stats").json()
        assert "pass_rate" in data

    def test_stats_pass_rate_range(self):
        data = client.get("/api/v1/stats").json()
        assert 0 <= data["pass_rate"] <= 1

    def test_stats_has_avg_confidence(self):
        data = client.get("/api/v1/stats").json()
        assert "avg_confidence" in data

    def test_stats_has_spoof_blocked(self):
        data = client.get("/api/v1/stats").json()
        assert "spoof_attempts_blocked" in data


# ── Error Handling ──────────────────────────────────────────────────────────

class TestErrorHandling:
    def test_404_unknown_route(self):
        assert client.get("/api/v1/nonexistent").status_code == 404

    def test_detect_requires_session_id(self):
        resp = client.post("/api/v1/detect", json={})
        assert resp.status_code == 422
