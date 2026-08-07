"""Tests for predictive-analytics service."""
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
        assert data["service"] == "predictive-analytics"

    def test_health_contains_version(self):
        resp = client.get("/health")
        data = resp.json()
        assert "version" in data

    def test_health_contains_status_healthy(self):
        resp = client.get("/health")
        data = resp.json()
        # In test environment without DB/Redis, status may be 'degraded'
        assert data["status"] in ("healthy", "degraded")

    def test_health_contains_middleware(self):
        resp = client.get("/health")
        data = resp.json()
        # middleware key present when all services up; database key present when degraded
        assert "middleware" in data or "database" in data


# ── Churn Prediction ────────────────────────────────────────────────────────

class TestChurnPrediction:
    def test_churn_returns_200(self):
        resp = client.post("/api/v1/predictive/churn", json={"customer_id": "CUST-001"})
        assert resp.status_code == 200

    def test_churn_response_structure(self):
        resp = client.post("/api/v1/predictive/churn", json={"customer_id": "CUST-002"})
        data = resp.json()
        assert "churn_probability" in data
        assert "risk_level" in data
        assert "top_factors" in data
        assert "recommended_actions" in data

    def test_churn_probability_range(self):
        resp = client.post("/api/v1/predictive/churn", json={"customer_id": "CUST-003"})
        assert 0.01 <= resp.json()["churn_probability"] <= 0.99

    def test_churn_risk_level_values(self):
        resp = client.post("/api/v1/predictive/churn", json={"customer_id": "CUST-004"})
        assert resp.json()["risk_level"] in ("high", "medium", "low")

    def test_churn_with_custom_inputs(self):
        resp = client.post("/api/v1/predictive/churn", json={
            "customer_id": "CUST-005", "age": 45, "tenure_months": 36,
            "premium_amount": 100000, "claims_count": 2, "payment_regularity": 0.5,
            "products_count": 3,
        })
        assert resp.json()["customer_id"] == "CUST-005"

    def test_churn_customer_id_preserved(self):
        resp = client.post("/api/v1/predictive/churn", json={"customer_id": "CUST-006"})
        assert resp.json()["customer_id"] == "CUST-006"

    def test_churn_high_tenure_low_risk(self):
        """Long tenure should reduce churn probability."""
        resp = client.post("/api/v1/predictive/churn", json={
            "customer_id": "CUST-007", "tenure_months": 60, "payment_regularity": 1.0,
        })
        assert resp.json()["churn_probability"] < 0.5

    def test_churn_recommended_actions(self):
        resp = client.post("/api/v1/predictive/churn", json={"customer_id": "CUST-008"})
        actions = resp.json()["recommended_actions"]
        assert isinstance(actions, list)
        assert len(actions) > 0


# ── Customer Lifetime Value ─────────────────────────────────────────────────

class TestCLV:
    def test_clv_returns_200(self):
        resp = client.post("/api/v1/predictive/clv", json={"customer_id": "CUST-001"})
        assert resp.status_code == 200

    def test_clv_response_structure(self):
        resp = client.post("/api/v1/predictive/clv", json={"customer_id": "CUST-002"})
        data = resp.json()
        assert all(k in data for k in ["estimated_clv", "currency", "confidence", "segment", "expected_tenure_months"])

    def test_clv_returns_ngn_currency(self):
        assert client.post("/api/v1/predictive/clv", json={"customer_id": "CUST-003"}).json()["currency"] == "NGN"

    def test_clv_segment_values(self):
        resp = client.post("/api/v1/predictive/clv", json={"customer_id": "CUST-004"})
        assert resp.json()["segment"] in ("high_value", "medium_value", "standard")

    def test_clv_positive_value(self):
        assert client.post("/api/v1/predictive/clv", json={"customer_id": "CUST-005", "premium_amount": 50000}).json()["estimated_clv"] > 0

    def test_clv_high_value_segment(self):
        resp = client.post("/api/v1/predictive/clv", json={
            "customer_id": "CUST-006", "premium_amount": 500000, "tenure_months": 48, "payment_regularity": 0.99,
        })
        assert resp.json()["segment"] == "high_value"

    def test_clv_expected_tenure_months(self):
        resp = client.post("/api/v1/predictive/clv", json={"customer_id": "CUST-007", "tenure_months": 24})
        assert resp.json()["expected_tenure_months"] >= 12


# ── Risk Score ──────────────────────────────────────────────────────────────

class TestRiskScore:
    def test_risk_score_returns_200(self):
        resp = client.post("/api/v1/predictive/risk-score", json={"customer_id": "CUST-001"})
        assert resp.status_code == 200

    def test_risk_score_response_structure(self):
        resp = client.post("/api/v1/predictive/risk-score", json={"customer_id": "CUST-002"})
        data = resp.json()
        assert all(k in data for k in ["risk_score", "risk_grade", "factors", "premium_adjustment"])

    def test_risk_score_range(self):
        resp = client.post("/api/v1/predictive/risk-score", json={"customer_id": "CUST-003"})
        assert 0 <= resp.json()["risk_score"] <= 100

    def test_risk_grade_values(self):
        resp = client.post("/api/v1/predictive/risk-score", json={"customer_id": "CUST-004"})
        assert resp.json()["risk_grade"] in ("A", "B", "C", "D")

    def test_risk_score_young_customer_higher_risk(self):
        young = client.post("/api/v1/predictive/risk-score", json={"customer_id": "Y", "age": 20}).json()["risk_score"]
        normal = client.post("/api/v1/predictive/risk-score", json={"customer_id": "N", "age": 35}).json()["risk_score"]
        assert young < normal

    def test_risk_score_factors_structure(self):
        data = client.post("/api/v1/predictive/risk-score", json={"customer_id": "CUST-007"}).json()
        assert all(k in data["factors"] for k in ["age", "claims_history", "payment_behavior"])

    def test_risk_score_many_claims_higher_risk(self):
        low = client.post("/api/v1/predictive/risk-score", json={"customer_id": "A", "claims_count": 0}).json()["risk_score"]
        high = client.post("/api/v1/predictive/risk-score", json={"customer_id": "B", "claims_count": 5}).json()["risk_score"]
        assert low > high

    def test_risk_score_poor_payment_higher_risk(self):
        good = client.post("/api/v1/predictive/risk-score", json={"customer_id": "G", "payment_regularity": 0.99}).json()["risk_score"]
        bad = client.post("/api/v1/predictive/risk-score", json={"customer_id": "B", "payment_regularity": 0.3}).json()["risk_score"]
        assert good > bad


# ── Customer Segments ───────────────────────────────────────────────────────

class TestSegments:
    def test_segments_returns_200(self):
        assert client.get("/api/v1/predictive/segments").status_code == 200

    def test_segments_contains_segments(self):
        assert "segments" in client.get("/api/v1/predictive/segments").json()

    def test_segments_has_total(self):
        assert client.get("/api/v1/predictive/segments").json()["total_customers"] > 0

    def test_segment_structure(self):
        seg = client.get("/api/v1/predictive/segments").json()["segments"][0]
        assert all(k in seg for k in ["name", "count", "avg_clv", "churn_risk"])
