"""Tests for the AI Underwriting Engine FastAPI service."""

import pytest
from fastapi.testclient import TestClient

from app.main import (
    ErrorResponse,
    InvalidRequestError,
    ModelListResponse,
    ModelUnavailableError,
    UnderwritingDecision,
    UnderwritingModelInfo,
    UnderwritingRequest,
    app,
    _decision_from_score,
    _score_risk,
)

client = TestClient(app)


# ── Health Check ───────────────────────────────────────────────────────────────


class TestHealthCheck:
    def test_health_returns_200(self):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "ai-underwriting-engine"

    def test_health_has_timestamp(self):
        response = client.get("/health")
        data = response.json()
        assert "timestamp" in data


# ── Underwriting Request Validation ──────────────────────────────────────────


class TestUnderwritingRequestValidation:
    def test_valid_request_succeeds(self):
        response = client.post(
            "/api/v1/underwrite",
            json={
                "product_id": "motor_tp",
                "applicant_name": "John Doe",
                "phone": "08012345678",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["decision"] in ("accept", "accept_with_loading", "refer")
        assert "decision_id" in data
        assert 0.0 <= data["risk_score"] <= 1.0

    def test_missing_required_fields(self):
        response = client.post("/api/v1/underwrite", json={})
        assert response.status_code == 422

    def test_empty_product_id(self):
        response = client.post(
            "/api/v1/underwrite",
            json={
                "product_id": "",
                "applicant_name": "John Doe",
                "phone": "08012345678",
            },
        )
        assert response.status_code == 422

    def test_invalid_phone_number(self):
        response = client.post(
            "/api/v1/underwrite",
            json={
                "product_id": "motor_tp",
                "applicant_name": "John Doe",
                "phone": "123",
            },
        )
        assert response.status_code == 422

    def test_invalid_date_format(self):
        response = client.post(
            "/api/v1/underwrite",
            json={
                "product_id": "motor_tp",
                "applicant_name": "John Doe",
                "phone": "08012345678",
                "date_of_birth": "01-01-1990",
            },
        )
        assert response.status_code == 422

    def test_invalid_gender(self):
        response = client.post(
            "/api/v1/underwrite",
            json={
                "product_id": "motor_tp",
                "applicant_name": "John Doe",
                "phone": "08012345678",
                "gender": "X",
            },
        )
        assert response.status_code == 422

    def test_valid_gender_accepted(self):
        response = client.post(
            "/api/v1/underwrite",
            json={
                "product_id": "motor_tp",
                "applicant_name": "John Doe",
                "phone": "08012345678",
                "gender": "M",
            },
        )
        assert response.status_code == 200

    def test_negative_income_rejected(self):
        response = client.post(
            "/api/v1/underwrite",
            json={
                "product_id": "motor_tp",
                "applicant_name": "John Doe",
                "phone": "08012345678",
                "income_declared": -100,
            },
        )
        assert response.status_code == 422

    def test_valid_date_accepted(self):
        response = client.post(
            "/api/v1/underwrite",
            json={
                "product_id": "motor_tp",
                "applicant_name": "John Doe",
                "phone": "08012345678",
                "date_of_birth": "1990-01-15",
            },
        )
        assert response.status_code == 200

    def test_negative_claims_history_rejected(self):
        response = client.post(
            "/api/v1/underwrite",
            json={
                "product_id": "motor_tp",
                "applicant_name": "John Doe",
                "phone": "08012345678",
                "claims_history": -1,
            },
        )
        assert response.status_code == 422


# ── Underwriting Logic ────────────────────────────────────────────────────────


class TestScoring:
    def test_low_risk_accepts(self):
        req = UnderwritingRequest(
            product_id="motor",
            applicant_name="Low Risk",
            phone="08012345678",
            credit_score=750,
            mobile_money_active=True,
            airtime_spend_monthly=10000,
            smartphone_user=True,
            existing_policies=2,
            claims_history=0,
        )
        score, factors, _ = _score_risk(req)
        assert score <= 0.3
        decision, risk_class, loading = _decision_from_score(score)
        assert decision == "accept"
        assert risk_class == "preferred"

    def test_high_risk_refer(self):
        req = UnderwritingRequest(
            product_id="motor",
            applicant_name="High Risk",
            phone="08012345678",
            credit_score=400,
            mobile_money_active=False,
            claims_history=5,
            location_state="Borno",
            occupation="okada_rider",
        )
        score, factors, _ = _score_risk(req)
        assert score > 0.5
        decision, risk_class, _ = _decision_from_score(score)
        assert decision in ("refer", "accept_with_loading")

    def test_alternative_data_detected(self):
        req = UnderwritingRequest(
            product_id="motor",
            applicant_name="Alt Data User",
            phone="08012345678",
            mobile_money_active=True,
        )
        _, _, alt_used = _score_risk(req)
        assert alt_used is True

    def test_no_alt_data(self):
        req = UnderwritingRequest(
            product_id="motor",
            applicant_name="No Alt Data",
            phone="08012345678",
            credit_score=650,
        )
        _, _, alt_used = _score_risk(req)
        assert alt_used is False

    def test_claims_history_increases_risk(self):
        req_low = UnderwritingRequest(
            product_id="motor", applicant_name="Low", phone="08012345678",
        )
        req_high = UnderwritingRequest(
            product_id="motor", applicant_name="High", phone="08012345678",
            claims_history=5,
        )
        score_low, _, _ = _score_risk(req_low)
        score_high, _, _ = _score_risk(req_high)
        assert score_high > score_low

    def test_credit_score_positive_impact(self):
        req_good = UnderwritingRequest(
            product_id="motor", applicant_name="Good", phone="08012345678",
            credit_score=750,
        )
        req_bad = UnderwritingRequest(
            product_id="motor", applicant_name="Bad", phone="08012345678",
            credit_score=400,
        )
        score_good, _, _ = _score_risk(req_good)
        score_bad, _, _ = _score_risk(req_bad)
        assert score_good < score_bad

    def test_high_risk_state_increases_risk(self):
        req = UnderwritingRequest(
            product_id="motor", applicant_name="State", phone="08012345678",
            location_state="Zamfara",
        )
        score, factors, _ = _score_risk(req)
        factor_names = [f["factor"] for f in factors]
        assert "location_risk" in factor_names

    def test_score_clamped_to_0_1(self):
        req = UnderwritingRequest(
            product_id="motor", applicant_name="Clamp", phone="08012345678",
            credit_score=750, mobile_money_active=True,
            airtime_spend_monthly=10000, smartphone_user=True,
            existing_policies=100, claims_history=0,
        )
        score, _, _ = _score_risk(req)
        assert 0.0 <= score <= 1.0


class TestDecisionMapping:
    def test_preferred(self):
        decision, risk_class, loading = _decision_from_score(0.2)
        assert decision == "accept"
        assert risk_class == "preferred"
        assert loading == 0.0

    def test_standard(self):
        decision, risk_class, loading = _decision_from_score(0.4)
        assert decision == "accept"
        assert risk_class == "standard"
        assert loading == 0.0

    def test_accept_with_loading(self):
        decision, risk_class, loading = _decision_from_score(0.6)
        assert decision == "accept_with_loading"
        assert risk_class == "substandard"
        assert loading > 0

    def test_refer(self):
        decision, risk_class, loading = _decision_from_score(0.8)
        assert decision == "refer"
        assert risk_class == "substandard"

    def test_boundary_03(self):
        decision, _, _ = _decision_from_score(0.3)
        assert decision == "accept"

    def test_boundary_05(self):
        decision, _, _ = _decision_from_score(0.5)
        assert decision == "accept"

    def test_boundary_07(self):
        decision, _, _ = _decision_from_score(0.7)
        assert decision == "accept_with_loading"


# ── HTTP Endpoints ────────────────────────────────────────────────────────────


class TestUnderwriteEndpoint:
    def test_returns_underwriting_decision(self):
        response = client.post(
            "/api/v1/underwrite",
            json={
                "product_id": "motor_tp",
                "applicant_name": "Jane Doe",
                "phone": "08012345678",
            },
        )
        data = response.json()
        assert "decision_id" in data
        assert data["decision"] in ("accept", "accept_with_loading", "refer")
        assert "risk_score" in data
        assert "factors" in data
        assert "processing_time_ms" in data

    def test_has_decision_id_prefix(self):
        response = client.post(
            "/api/v1/underwrite",
            json={
                "product_id": "motor_tp",
                "applicant_name": "Jane Doe",
                "phone": "08012345678",
            },
        )
        data = response.json()
        assert data["decision_id"].startswith("UW-")

    def test_alternative_data_flag_in_response(self):
        response = client.post(
            "/api/v1/underwrite",
            json={
                "product_id": "motor_tp",
                "applicant_name": "Jane Doe",
                "phone": "08012345678",
                "mobile_money_active": True,
            },
        )
        data = response.json()
        assert data["alternative_data_used"] is True

    def test_coverage_limits(self):
        response = client.post(
            "/api/v1/underwrite",
            json={
                "product_id": "motor_tp",
                "applicant_name": "Jane Doe",
                "phone": "08012345678",
            },
        )
        data = response.json()
        assert data["recommended_coverage"] > 0
        assert data["max_coverage"] > data["recommended_coverage"]


class TestListModelsEndpoint:
    def test_returns_200(self):
        response = client.get("/api/v1/underwrite/models")
        assert response.status_code == 200

    def test_returns_three_models(self):
        response = client.get("/api/v1/underwrite/models")
        data = response.json()
        assert len(data["models"]) == 3

    def test_has_motor_model(self):
        response = client.get("/api/v1/underwrite/models")
        data = response.json()
        ids = [m["id"] for m in data["models"]]
        assert "uw-motor-v3" in ids

    def test_has_life_model(self):
        response = client.get("/api/v1/underwrite/models")
        data = response.json()
        ids = [m["id"] for m in data["models"]]
        assert "uw-life-v2" in ids

    def test_model_fields(self):
        response = client.get("/api/v1/underwrite/models")
        data = response.json()
        model = data["models"][0]
        assert "id" in model
        assert "algorithm" in model
        assert "accuracy" in model


# ── Pydantic Models ──────────────────────────────────────────────────────────


class TestPydanticModels:
    def test_underwriting_request_defaults(self):
        req = UnderwritingRequest(
            product_id="test",
            applicant_name="Test User",
            phone="08012345678",
        )
        assert req.existing_policies == 0
        assert req.claims_history == 0
        assert req.mobile_money_active is None

    def test_underwriting_decision(self):
        decision = UnderwritingDecision(
            decision_id="UW-TEST001",
            decision="accept",
            risk_score=0.4,
            risk_class="standard",
            premium_loading=0.0,
            confidence=0.92,
            factors=[],
            alternative_data_used=False,
            processing_time_ms=50,
            recommended_coverage=1000000,
            max_coverage=5000000,
        )
        assert decision.decision_id == "UW-TEST001"
        assert 0.0 <= decision.risk_score <= 1.0

    def test_error_response(self):
        error = ErrorResponse(error="test error", detail="details")
        assert error.error == "test error"
        assert error.detail == "details"

    def test_model_info(self):
        model = UnderwritingModelInfo(
            id="test-model",
            product_type="test",
            algorithm="XGBoost",
            accuracy=0.9,
            features=10,
            last_trained="2026-01-01",
            alternative_data_features=3,
        )
        assert model.accuracy == 0.9

    def test_model_list_response(self):
        response = ModelListResponse(models=[])
        assert len(response.models) == 0


# ── Error Handling ────────────────────────────────────────────────────────────


class TestErrorHandling:
    def test_invalid_request_error(self):
        error = InvalidRequestError("bad input")
        assert error.status_code == 422
        assert str(error) == "bad input"

    def test_model_unavailable_error(self):
        error = ModelUnavailableError("model-1")
        assert error.status_code == 503
        assert "model-1" in str(error)


# ── Content Type ──────────────────────────────────────────────────────────────


class TestContentTypes:
    def test_endpoints_return_json(self):
        endpoints = [
            "/health",
            "/api/v1/underwrite/models",
        ]
        for endpoint in endpoints:
            response = client.get(endpoint)
            assert "application/json" in response.headers.get("content-type", "")
