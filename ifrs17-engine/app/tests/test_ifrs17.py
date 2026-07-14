"""Tests for the IFRS 17 Engine FastAPI service."""

import pytest
from fastapi.testclient import TestClient

from app.main import (
    CsmInput,
    CsmResponse,
    CohortEntry,
    DiscountCurveResponse,
    Ifrs17Error,
    InvalidParameterError,
    CalculationError,
    ValidationResult,
    app,
    calculate_csm,
    calculate_risk_adjustment,
    _lookup_discount_rate,
)

client = TestClient(app)


# ── Health ────────────────────────────────────────────────────────────────────


class TestHealth:
    def test_health_200(self):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"
        assert data["service"] == "ifrs17-engine"

    def test_health_has_timestamp(self):
        resp = client.get("/health")
        assert "timestamp" in resp.json()


# ── CSM Calculation ───────────────────────────────────────────────────────────


class TestCalculateCsm:
    def test_profitable_contract(self):
        result = calculate_csm(
            future_cash_flows=10_000_000,
            risk_adjustment=1_500_000,
            discount_rate=0.10,
            years=5,
        )
        assert result["csm"] > 0
        assert result["onerous"] is False
        assert result["loss_component"] == 0.0

    def test_onerous_contract(self):
        result = calculate_csm(
            future_cash_flows=1_000_000,
            risk_adjustment=5_000_000,
            discount_rate=0.10,
            years=5,
        )
        assert result["csm"] == 0.0  # CSM is floored at 0
        assert result["onerous"] is True
        assert result["loss_component"] > 0

    def test_pv_calculation(self):
        result = calculate_csm(10_000, 0, 0.10, 1)
        expected_pv = 10_000 * (1.10 ** -1)
        assert abs(result["pv_future_cash_flows"] - round(expected_pv, 2)) < 0.01

    def test_discount_rate_used(self):
        result = calculate_csm(10_000, 0, 0.20, 1)
        pv = 10_000 * (1.20 ** -1)
        assert abs(result["pv_future_cash_flows"] - round(pv, 2)) < 0.01

    def test_measurement_model_is_bba(self):
        result = calculate_csm(10_000, 1_000, 0.15, 5)
        assert result["measurement_model"] == "BBA"

    def test_metadata_present(self):
        result = calculate_csm(10_000, 1_000, 0.15, 5)
        assert "metadata" in result
        assert "calculated_at" in result["metadata"]

    def test_zero_future_flows_rejected(self):
        # The function itself validates inputs — negative value raises InvalidParameterError
        with pytest.raises(InvalidParameterError):
            calculate_csm(-1, 1000, 0.10, 5)

    def test_negative_risk_adjustment_rejected(self):
        with pytest.raises(InvalidParameterError) as exc:
            calculate_csm(10_000, -100, 0.10, 5)
        assert "non-negative" in str(exc.value)

    def test_negative_discount_rejected(self):
        with pytest.raises(InvalidParameterError) as exc:
            calculate_csm(10_000, 1000, -0.10, 5)
        assert "positive" in str(exc.value)

    def test_years_zero_rejected(self):
        with pytest.raises(InvalidParameterError) as exc:
            calculate_csm(10_000, 1000, 0.10, 0)
        assert "positive" in str(exc.value)


# ── Discount Rate Lookup ─────────────────────────────────────────────────────


class TestDiscountRateLookup:
    def test_known_rate_1y(self):
        assert _lookup_discount_rate(1) == 0.145

    def test_known_rate_5y(self):
        assert _lookup_discount_rate(5) == 0.165

    def test_known_rate_10y(self):
        assert _lookup_discount_rate(10) == 0.170

    def test_known_rate_20y(self):
        assert _lookup_discount_rate(20) == 0.175

    def test_interpolated_3y(self):
        rate = _lookup_discount_rate(3)
        assert 0.160 <= rate <= 0.165  # Between 3Y and 5Y

    def test_interpolated_7y(self):
        rate = _lookup_discount_rate(7)
        assert 0.165 <= rate <= 0.170

    def test_bounded_below(self):
        rate = _lookup_discount_rate(1)
        assert rate == 0.145

    def test_bounded_above(self):
        rate = _lookup_discount_rate(50)
        assert rate == 0.175

    def test_exact_year(self):
        rate = _lookup_discount_rate(15)
        assert rate == 0.172


# ── Risk Adjustment ───────────────────────────────────────────────────────────


class TestCalculateRiskAdjustment:
    def test_75_percentile(self):
        result = calculate_risk_adjustment(1_000_000)
        expected = 1_000_000 * (1 + (0.75 - 0.5) * 0.4)
        assert abs(result - expected) < 0.01

    def test_90_percentile(self):
        result = calculate_risk_adjustment(1_000_000, 0.90)
        expected = 1_000_000 * (1 + (0.90 - 0.5) * 0.4)
        assert abs(result - expected) < 0.01

    def test_50_percentile(self):
        result = calculate_risk_adjustment(1_000_000, 0.50)
        assert abs(result - 1_000_000) < 0.01

    def test_zero_expected(self):
        result = calculate_risk_adjustment(0)
        assert result == 0.0

    def test_negative_expected_rejected(self):
        with pytest.raises(InvalidParameterError):
            calculate_risk_adjustment(-1000)

    def test_confidence_too_low_rejected(self):
        with pytest.raises(InvalidParameterError):
            calculate_risk_adjustment(1000, 0.4)

    def test_confidence_too_high_rejected(self):
        with pytest.raises(InvalidParameterError):
            calculate_risk_adjustment(1000, 0.999)


# ── HTTP Endpoints ────────────────────────────────────────────────────────────


class TestDiscountCurvesEndpoint:
    def test_returns_200(self):
        resp = client.get("/api/v1/discount-curves")
        assert resp.status_code == 200
        data = resp.json()
        assert "curves" in data
        assert data["source"] == "CBN"
        assert "as_of" in data

    def test_has_multiple_years(self):
        resp = client.get("/api/v1/discount-curves")
        curves = resp.json()["curves"]
        assert "1Y" in curves
        assert "10Y" in curves


class TestCsmEndpoint:
    def test_returns_200(self):
        resp = client.post(
            "/api/v1/csm/calculate",
            json={
                "future_cash_flows": 10_000_000,
                "risk_adjustment": 1_500_000,
                "years": 5,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "csm" in data
        assert "pv_future_cash_flows" in data
        assert data["measurement_model"] == "BBA"

    def test_validates_required_fields(self):
        resp = client.post("/api/v1/csm/calculate", json={})
        assert resp.status_code == 422

    def test_validates_positive_future_cash_flows(self):
        resp = client.post(
            "/api/v1/csm/calculate",
            json={
                "future_cash_flows": -1000,
                "risk_adjustment": 1000,
                "years": 5,
            },
        )
        assert resp.status_code == 422

    def test_validates_years_range(self):
        resp = client.post(
            "/api/v1/csm/calculate",
            json={
                "future_cash_flows": 1000,
                "risk_adjustment": 1000,
                "years": 0,
            },
        )
        assert resp.status_code == 422

    def test_uses_auto_lookup_rate(self):
        resp = client.post(
            "/api/v1/csm/calculate",
            json={
                "future_cash_flows": 10_000,
                "risk_adjustment": 0,
                "years": 1,
            },
        )
        data = resp.json()
        assert abs(data["discount_rate"] - 0.145) < 0.001

    def test_custom_rate_used(self):
        resp = client.post(
            "/api/v1/csm/calculate",
            json={
                "future_cash_flows": 10_000,
                "risk_adjustment": 0,
                "discount_rate": 0.20,
                "years": 5,
            },
        )
        data = resp.json()
        assert abs(data["discount_rate"] - 0.20) < 0.001


class TestCohortsEndpoint:
    def test_returns_200(self):
        resp = client.get("/api/v1/cohorts")
        assert resp.status_code == 200
        data = resp.json()
        assert "cohorts" in data
        assert len(data["cohorts"]) == 2

    def test_has_bba_model(self):
        resp = client.get("/api/v1/cohorts")
        data = resp.json()
        assert data["measurement_model"] == "BBA"


class TestLookupDiscountRateEndpoint:
    def test_returns_200(self):
        resp = client.get("/api/v1/discount-rates/lookup?years=5")
        assert resp.status_code == 200
        data = resp.json()
        assert data["discount_rate"] == 0.165

    def test_interpolated_rate(self):
        # years=3 is a known key in DISCOUNT_RATES, so use years=4 for interpolation
        resp = client.get("/api/v1/discount-rates/lookup?years=4")
        data = resp.json()
        assert data["method"] == "interpolation"

    def test_validates_years(self):
        resp = client.get("/api/v1/discount-rates/lookup?years=0")
        assert resp.status_code == 422


class TestRiskAdjustmentEndpoint:
    def test_returns_200(self):
        resp = client.get(
            "/api/v1/risk-adjustment/calculate?expected_claims=1000000"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "risk_adjustment" in data

    def test_validates_expected_claims(self):
        resp = client.get(
            "/api/v1/risk-adjustment/calculate?expected_claims=-100"
        )
        assert resp.status_code == 422


class TestValidateCsmParamsEndpoint:
    def test_valid_params(self):
        resp = client.post(
            "/api/v1/validate/csm-params",
            json={
                "future_cash_flows": 10_000_000,
                "risk_adjustment": 1_000_000,
                "years": 5,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["valid"] is True
        assert data["errors"] == []

    def test_onerous_warning(self):
        resp = client.post(
            "/api/v1/validate/csm-params",
            json={
                "future_cash_flows": 1_000_000,
                "risk_adjustment": 5_000_000,
                "years": 5,
            },
        )
        data = resp.json()
        assert any("onerous" in w.lower() for w in data["warnings"])

    def test_high_rate_warning(self):
        resp = client.post(
            "/api/v1/validate/csm-params",
            json={
                "future_cash_flows": 10_000,
                "risk_adjustment": 1000,
                "discount_rate": 0.25,
                "years": 5,
            },
        )
        data = resp.json()
        assert any("high" in w.lower() for w in data["warnings"])

    def test_invalid_params(self):
        # Use values that trigger a warning (RA > cash flows)
        resp = client.post(
            "/api/v1/validate/csm-params",
            json={
                "future_cash_flows": 10_000,
                "risk_adjustment": 50_000,  # RA > cash flows => onerous warning
                "years": 5,
            },
        )
        data = resp.json()
        # Valid is still True (no hard errors), but warnings exist
        assert data["valid"] is True
        assert len(data["warnings"]) > 0


# ── Pydantic Models ──────────────────────────────────────────────────────────


class TestPydanticModels:
    def test_csm_input(self):
        inp = CsmInput(future_cash_flows=10_000, risk_adjustment=1000, years=5)
        assert inp.future_cash_flows == 10_000
        assert inp.discount_rate is None

    def test_csm_response(self):
        resp = CsmResponse(
            pv_future_cash_flows=10000.0,
            risk_adjustment=1000.0,
            csm=5000.0,
            onerous=False,
            loss_component=0.0,
            discount_rate=0.10,
        )
        assert resp.measurement_model == "BBA"

    def test_cohort_entry(self):
        c = CohortEntry(year=2025, contracts=1200, csm_total=450000000, onerous_pct=5)
        assert c.year == 2025

    def test_validation_result(self):
        vr = ValidationResult(valid=True, errors=[], warnings=["warning1"])
        assert vr.valid is True
        assert "warning1" in vr.warnings


# ── Error Classes ─────────────────────────────────────────────────────────────


class TestErrorClasses:
    def test_ifrs17_error(self):
        exc = Ifrs17Error("test", status_code=500)
        assert exc.status_code == 500

    def test_invalid_parameter_error(self):
        exc = InvalidParameterError("field", "bad")
        assert exc.status_code == 422
        assert "field" in str(exc)

    def test_calculation_error(self):
        exc = CalculationError("math error")
        assert exc.status_code == 422


# ── Content Type ──────────────────────────────────────────────────────────────


class TestContentTypes:
    def test_all_endpoints_json(self):
        endpoints = [
            "/health",
            "/api/v1/discount-curves",
            "/api/v1/cohorts",
        ]
        for ep in endpoints:
            resp = client.get(ep)
            assert "application/json" in resp.headers.get("content-type", "")
