"""Tests for mlops-governance service."""
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


# ── Health ──────────────────────────────────────────────────────────────────

class TestHealth:
    def test_health_returns_200(self):
        resp = client.get("/health")
        assert resp.status_code == 200

    def test_health_contains_service_name(self):
        resp = client.get("/health")
        data = resp.json()
        assert data["service"] == "mlops-governance"

    def test_health_status_healthy(self):
        resp = client.get("/health")
        assert resp.json()["status"] == "healthy"


# ── Model Registry ──────────────────────────────────────────────────────────

class TestModelRegistry:
    def test_list_models_returns_200(self):
        resp = client.get("/api/v1/models")
        assert resp.status_code == 200

    def test_list_models_has_models(self):
        resp = client.get("/api/v1/models")
        data = resp.json()
        assert "models" in data
        assert "total" in data

    def test_list_models_has_models_list(self):
        resp = client.get("/api/v1/models")
        data = resp.json()
        assert len(data["models"]) > 0

    def test_models_have_required_fields(self):
        resp = client.get("/api/v1/models")
        model = resp.json()["models"][0]
        for field in ["id", "name", "type", "accuracy", "status", "deployed"]:
            assert field in model, f"Missing field: {field}"

    def test_model_count_matches_total(self):
        resp = client.get("/api/v1/models")
        data = resp.json()
        assert data["total"] == len(data["models"])

    def test_has_production_models(self):
        resp = client.get("/api/v1/models")
        models = resp.json()["models"]
        production = [m for m in models if m["status"] == "production"]
        assert len(production) > 0


# ── Drift Detection ─────────────────────────────────────────────────────────

class TestDriftDetection:
    def test_drift_returns_200(self):
        resp = client.get("/api/v1/drift")
        assert resp.status_code == 200

    def test_drift_has_models(self):
        resp = client.get("/api/v1/drift")
        data = resp.json()
        assert "models" in data

    def test_drift_has_threshold(self):
        resp = client.get("/api/v1/drift")
        assert "threshold" in resp.json()

    def test_drift_psi_values(self):
        resp = client.get("/api/v1/drift")
        for model in resp.json()["models"]:
            assert "psi" in model
            assert "status" in model
            assert model["status"] in ("stable", "warning", "critical")

    def test_drift_action_values(self):
        resp = client.get("/api/v1/drift")
        for model in resp.json()["models"]:
            assert "action" in model
            assert model["action"] in ("none", "monitor", "retrain")


# ── Explainability ──────────────────────────────────────────────────────────

class TestExplainability:
    def test_explainability_returns_200(self):
        resp = client.get("/api/v1/explainability/MDL-001")
        assert resp.status_code == 200

    def test_explainability_has_method(self):
        resp = client.get("/api/v1/explainability/MDL-001")
        assert resp.json()["method"] == "SHAP"

    def test_explainability_has_top_features(self):
        resp = client.get("/api/v1/explainability/MDL-001")
        assert len(resp.json()["top_features"]) > 0

    def test_explainability_features_have_importance(self):
        resp = client.get("/api/v1/explainability/MDL-001")
        for feat in resp.json()["top_features"]:
            assert "feature" in feat
            assert "importance" in feat
            assert 0 <= feat["importance"] <= 1

    def test_explainability_model_id_in_response(self):
        resp = client.get("/api/v1/explainability/MDL-002")
        assert resp.json()["model_id"] == "MDL-002"


# ── Error Handling ──────────────────────────────────────────────────────────

class TestErrorHandling:
    def test_unknown_model_id(self):
        resp = client.get("/api/v1/explainability/UNKNOWN-MODEL")
        assert resp.status_code == 200  # Returns empty result for unknown

    def test_nonexistent_route(self):
        resp = client.get("/api/v1/nonexistent")
        assert resp.status_code == 404

    def test_post_to_get_endpoint(self):
        resp = client.post("/health")
        assert resp.status_code in (200, 405)
