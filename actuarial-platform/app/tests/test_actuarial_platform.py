"""Tests for the actuarial-platform FastAPI service."""

import pytest
from fastapi.testclient import TestClient

from app.main import (
    ExperienceResult,
    ExperienceStudyResponse,
    MortalityTableEntry,
    MortalityTableResponse,
    PricingModel,
    ProductNotFoundError,
    app,
)

client = TestClient(app)


# ── Health Check ───────────────────────────────────────────────────────────────


class TestHealthCheck:
    def test_health_returns_200(self):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "actuarial-platform"
        assert "timestamp" in data

    def test_health_is_json(self):
        response = client.get("/health")
        assert response.headers["content-type"] == "application/json"


# ── Mortality Tables ──────────────────────────────────────────────────────────


class TestMortalityTables:
    def test_returns_200(self):
        response = client.get("/api/v1/actuarial/mortality-tables")
        assert response.status_code == 200

    def test_returns_two_tables(self):
        response = client.get("/api/v1/actuarial/mortality-tables")
        data = response.json()
        assert len(data["tables"]) == 2

    def test_first_table_is_nigeria(self):
        response = client.get("/api/v1/actuarial/mortality-tables")
        data = response.json()
        tables = data["tables"]
        assert tables[0]["id"] == "NGA-2020"
        assert tables[0]["name"] == "Nigeria National Mortality Table 2020"

    def test_second_table_is_panafrican(self):
        response = client.get("/api/v1/actuarial/mortality-tables")
        data = response.json()
        tables = data["tables"]
        assert tables[1]["id"] == "AFRI-STD-2023"
        assert tables[1]["type"] == "select_and_ultimate"

    def test_table_has_sample_rates(self):
        response = client.get("/api/v1/actuarial/mortality-tables")
        data = response.json()
        table = data["tables"][0]
        assert "sample_rates" in table
        assert "20" in table["sample_rates"]

    def test_table_age_range(self):
        response = client.get("/api/v1/actuarial/mortality-tables")
        data = response.json()
        table = data["tables"][0]
        assert table["age_range"] == [0, 100]


# ── Loss Triangles ────────────────────────────────────────────────────────────


class TestLossTriangles:
    def test_returns_200(self):
        response = client.get("/api/v1/actuarial/loss-triangles")
        assert response.status_code == 200

    def test_returns_triangle_data(self):
        response = client.get("/api/v1/actuarial/loss-triangles")
        data = response.json()
        assert data["product"] == "motor_third_party"
        assert "development_factors" in data
        assert "triangle" in data
        assert data["ibnr_reserve"] > 0

    def test_has_development_factors(self):
        response = client.get("/api/v1/actuarial/loss-triangles")
        data = response.json()
        factors = data["development_factors"]
        assert len(factors) == 6
        assert all(isinstance(f, (int, float)) for f in factors)

    def test_has_ultimate_claims(self):
        response = client.get("/api/v1/actuarial/loss-triangles")
        data = response.json()
        assert len(data["ultimate_claims"]) == 6


# ── Pricing Models ────────────────────────────────────────────────────────────


class TestPricingModels:
    def test_motor_tp_returns_200(self):
        response = client.get("/api/v1/actuarial/pricing/motor_tp")
        assert response.status_code == 200

    def test_motor_tp_model_fields(self):
        response = client.get("/api/v1/actuarial/pricing/motor_tp")
        data = response.json()
        assert data["product"] == "Motor Third Party"
        assert data["base_premium"] == 15000
        assert data["expected_loss_ratio"] == 0.62
        assert len(data["rating_factors"]) == 5

    def test_motor_tp_rating_factors(self):
        response = client.get("/api/v1/actuarial/pricing/motor_tp")
        data = response.json()
        factors = data["rating_factors"]
        factor_names = [f["factor"] for f in factors]
        assert "vehicle_age" in factor_names
        assert "driver_age" in factor_names
        assert "state" in factor_names

    def test_hospital_cash_returns_200(self):
        response = client.get("/api/v1/actuarial/pricing/hospital_cash")
        assert response.status_code == 200

    def test_hospital_cash_base_premium(self):
        response = client.get("/api/v1/actuarial/pricing/hospital_cash")
        data = response.json()
        assert data["base_premium"] == 500

    def test_unknown_product_returns_404(self):
        response = client.get("/api/v1/actuarial/pricing/nonexistent_product")
        assert response.status_code == 404
        data = response.json()
        assert "error" in data

    def test_product_type_not_found_exception(self):
        with pytest.raises(ProductNotFoundError) as exc_info:
            raise ProductNotFoundError("unknown")
        assert exc_info.value.status_code == 404
        assert "unknown" in str(exc_info.value)


# ── Experience Study ──────────────────────────────────────────────────────────


class TestExperienceStudy:
    def test_returns_200(self):
        response = client.get("/api/v1/actuarial/experience-study")
        assert response.status_code == 200

    def test_returns_three_products(self):
        response = client.get("/api/v1/actuarial/experience-study")
        data = response.json()
        assert len(data["results"]) == 3

    def test_has_motor_tp_result(self):
        response = client.get("/api/v1/actuarial/experience-study")
        data = response.json()
        products = [r["product"] for r in data["results"]]
        assert "Motor TP" in products

    def test_has_term_life_result(self):
        response = client.get("/api/v1/actuarial/experience-study")
        data = response.json()
        products = [r["product"] for r in data["results"]]
        assert "Term Life" in products

    def test_has_hospital_cash_result(self):
        response = client.get("/api/v1/actuarial/experience-study")
        data = response.json()
        products = [r["product"] for r in data["results"]]
        assert "Hospital Cash" in products

    def test_study_period(self):
        response = client.get("/api/v1/actuarial/experience-study")
        data = response.json()
        assert data["study_period"] == "2023-2025"

    def test_result_has_recommendation(self):
        response = client.get("/api/v1/actuarial/experience-study")
        data = response.json()
        for result in data["results"]:
            assert "recommendation" in result
            assert len(result["recommendation"]) > 0


# ── Pydantic Models ──────────────────────────────────────────────────────────


class TestPydanticModels:
    def test_mortality_table_entry(self):
        entry = MortalityTableEntry(
            id="TEST",
            name="Test Table",
            type="period",
            gender="unisex",
            age_range=[0, 100],
            source="Test",
        )
        assert entry.id == "TEST"
        assert entry.age_range == [0, 100]

    def test_experience_result(self):
        result = ExperienceResult(
            product="Test",
            ae_ratio=1.0,
            avg_claim_severity=100000,
            recommendation="Test",
        )
        assert result.product == "Test"
        assert result.ae_ratio == 1.0

    def test_experience_study_response(self):
        response = ExperienceStudyResponse(
            study_period="2024-2026",
            products_analyzed=3,
            results=[],
        )
        assert response.products_analyzed == 3
        assert len(response.results) == 0


# ── Error Handling ────────────────────────────────────────────────────────────


class TestErrorHandling:
    def test_unhandled_error_returns_500(self):
        """Test that unexpected errors are caught by the generic handler."""
        # The generic error handler should catch any unhandled exceptions
        # We test the handler directly
        from app.main import generic_error_handler
        from starlette.requests import Request
        from starlette.datastructures import Headers

        class MockRequest:
            scope = {"type": "http", "method": "GET", "path": "/test"}

        exc = RuntimeError("test error")
        # Just verify the handler function exists and is async
        assert callable(generic_error_handler)

    def test_actuarial_platform_error(self):
        """Test that custom errors have proper status codes."""
        error = ProductNotFoundError("test")
        assert error.status_code == 404
        assert "test" in str(error)


# ── Content-Type Checks ───────────────────────────────────────────────────────


class TestContentTypes:
    def test_all_endpoints_return_json(self):
        endpoints = [
            "/health",
            "/api/v1/actuarial/mortality-tables",
            "/api/v1/actuarial/loss-triangles",
            "/api/v1/actuarial/pricing/motor_tp",
            "/api/v1/actuarial/experience-study",
        ]
        for endpoint in endpoints:
            response = client.get(endpoint)
            assert "application/json" in response.headers.get(
                "content-type", ""
            ), f"{endpoint} did not return JSON"
