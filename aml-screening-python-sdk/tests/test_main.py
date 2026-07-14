"""Tests for aml-screening-python-sdk service."""
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
        assert data["service"] == "aml-screening-python-sdk"

    def test_health_status_healthy(self):
        assert client.get("/health").json()["status"] == "healthy"


# ── Screening ──────────────────────────────────────────────────────────────

class TestScreening:
    def test_screen_returns_200(self):
        resp = client.post("/api/v1/screen", json={"name": "John Doe"})
        assert resp.status_code == 200

    def test_screen_response_structure(self):
        data = client.post("/api/v1/screen", json={"name": "John Doe"}).json()
        for field in ["screening_id", "name_searched", "match_score", "decision", "matches", "timestamp"]:
            assert field in data, f"Missing field: {field}"

    def test_screen_clears_unmatched_name(self):
        data = client.post("/api/v1/screen", json={"name": "randomperson123xyz"}).json()
        assert data["decision"] == "clear"

    def test_screen_decision_values(self):
        data = client.post("/api/v1/screen", json={"name": "John Doe"}).json()
        assert data["decision"] in ("clear", "edd_required", "blocked")

    def test_screen_match_score_non_negative(self):
        data = client.post("/api/v1/screen", json={"name": "John Doe"}).json()
        assert data["match_score"] >= 0

    def test_screen_has_matches_list(self):
        data = client.post("/api/v1/screen", json={"name": "John Doe"}).json()
        assert isinstance(data["matches"], list)

    def test_screen_has_timestamp(self):
        data = client.post("/api/v1/screen", json={"name": "John Doe"}).json()
        assert "timestamp" in data

    def test_screen_known_sanctioned_name(self):
        data = client.post("/api/v1/screen", json={"name": "ABUBAKAR SHEKAU"}).json()
        assert data["match_score"] > 0

    def test_screen_bvn_optional(self):
        data = client.post("/api/v1/screen", json={"name": "John Doe", "bvn": "12345678901"}).json()
        assert data["name_searched"] == "John Doe"

    def test_screen_nationality_default(self):
        data = client.post("/api/v1/screen", json={"name": "John Doe"}).json()
        assert "nationality" not in data  # default not returned in response

    def test_screening_id_format(self):
        data = client.post("/api/v1/screen", json={"name": "John Doe"}).json()
        assert data["screening_id"].startswith("SCR-")


# ── Lists ──────────────────────────────────────────────────────────────────

class TestLists:
    def test_lists_returns_200(self):
        assert client.get("/api/v1/lists").status_code == 200

    def test_lists_has_lists(self):
        data = client.get("/api/v1/lists").json()
        assert "lists" in data

    def test_lists_contains_ofac(self):
        data = client.get("/api/v1/lists").json()
        assert "OFAC_SDN" in data["lists"]

    def test_lists_contains_un_sanctions(self):
        data = client.get("/api/v1/lists").json()
        assert "UN_SANCTIONS" in data["lists"]

    def test_lists_contains_efcc(self):
        data = client.get("/api/v1/lists").json()
        assert "EFCC" in data["lists"]

    def test_lists_contains_cbn(self):
        data = client.get("/api/v1/lists").json()
        assert "CBN_BLACKLIST" in data["lists"]

    def test_lists_has_total_entries(self):
        data = client.get("/api/v1/lists").json()
        assert data["total_entries"] == 4

    def test_lists_has_last_updated(self):
        data = client.get("/api/v1/lists").json()
        assert "last_updated" in data


# ── Batch Screening ────────────────────────────────────────────────────────

class TestBatchScreening:
    def test_batch_screen_returns_200(self):
        resp = client.post("/api/v1/batch-screen", json=["Alice", "Bob", "Charlie"])
        assert resp.status_code == 200

    def test_batch_screen_returns_results(self):
        data = client.post("/api/v1/batch-screen", json=["Alice", "Bob"]).json()
        assert "results" in data

    def test_batch_screen_count_matches_results(self):
        data = client.post("/api/v1/batch-screen", json=["Alice", "Bob", "Charlie"]).json()
        assert data["total"] == 3
        assert len(data["results"]) == 3

    def test_batch_screen_limits_to_100(self):
        names = [f"Person{i}" for i in range(150)]
        data = client.post("/api/v1/batch-screen", json=names).json()
        assert data["total"] <= 100

    def test_batch_screen_each_result_has_decision(self):
        data = client.post("/api/v1/batch-screen", json=["Alice", "Bob"]).json()
        for r in data["results"]:
            assert "decision" in r
            assert "name" in r


# ── Error Handling ──────────────────────────────────────────────────────────

class TestErrorHandling:
    def test_404_unknown_route(self):
        assert client.get("/api/v1/nonexistent").status_code == 404

    def test_screen_requires_name(self):
        resp = client.post("/api/v1/screen", json={})
        assert resp.status_code == 422

    def test_batch_requires_list(self):
        resp = client.post("/api/v1/batch-screen", json="not_a_list")
        assert resp.status_code == 422
