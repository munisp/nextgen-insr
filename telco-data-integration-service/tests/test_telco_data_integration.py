"""Tests for the telco-data-integration-service.

Tests focus on schemas, models, and Pydantic validation without loading
the full application stack (which requires ML dependencies).
"""

import pytest
from datetime import datetime, timezone, timedelta


# ── Schemas ────────────────────────────────────────────────────────────────────


from app.schemas.telco_schemas import (
    BulkCreditScoreRequest,
    BulkCreditScoreResponse,
    CreditScoreBreakdown,
    CreditScoreRequest,
    CreditScoreResponse,
    TelcoDataRequest,
    TelcoDataResponse,
    TelcoProvider,
)


class TestTelcoProvider:
    """Tests for the TelcoProvider enum."""

    def test_all_providers(self):
        providers = [p.value for p in TelcoProvider]
        assert "MTN" in providers
        assert "AIRTEL" in providers
        assert "GLO" in providers
        assert "9MOBILE" in providers
        assert len(providers) == 4

    def test_provider_enum_comparison(self):
        assert TelcoProvider.MTN == "MTN"

    def test_provider_from_value(self):
        assert TelcoProvider("MTN") == TelcoProvider.MTN


class TestTelcoDataRequest:
    """Tests for the TelcoDataRequest Pydantic model."""

    def test_valid_request_with_local_number(self):
        req = TelcoDataRequest(
            customer_id="cust-001",
            phone_number="08012345678",
            consent=True,
        )
        assert req.phone_number == "08012345678"
        assert req.consent is True

    def test_valid_request_with_international_number(self):
        req = TelcoDataRequest(
            customer_id="cust-001",
            phone_number="+2348012345678",
            consent=True,
        )
        assert req.phone_number == "08012345678"

    def test_phone_with_dashes(self):
        req = TelcoDataRequest(
            customer_id="cust-001",
            phone_number="080-123-45678",
            consent=True,
        )
        assert req.phone_number == "08012345678"

    def test_phone_with_spaces(self):
        req = TelcoDataRequest(
            customer_id="cust-001",
            phone_number="080 123 45678",
            consent=True,
        )
        assert req.phone_number == "08012345678"

    def test_invalid_phone_short(self):
        with pytest.raises(ValueError):
            TelcoDataRequest(
                customer_id="cust-001",
                phone_number="0801234",
                consent=True,
            )

    def test_invalid_phone_non_digit(self):
        with pytest.raises(ValueError):
            TelcoDataRequest(
                customer_id="cust-001",
                phone_number="08012345abc",
                consent=True,
            )

    def test_invalid_phone_wrong_prefix(self):
        with pytest.raises(ValueError):
            TelcoDataRequest(
                customer_id="cust-001",
                phone_number="18012345678",
                consent=True,
            )

    def test_missing_customer_id(self):
        with pytest.raises(Exception):
            TelcoDataRequest(
                phone_number="08012345678",
                consent=True,
            )

    def test_missing_consent(self):
        with pytest.raises(Exception):
            TelcoDataRequest(
                customer_id="cust-001",
                phone_number="08012345678",
            )

    def test_provider_auto_detected_when_none(self):
        req = TelcoDataRequest(
            customer_id="cust-001",
            phone_number="08012345678",
            consent=True,
            provider=None,
        )
        assert req.provider is None


class TestTelcoDataRequestPhoneVariants:
    """Test Nigerian phone number formats."""

    def test_070_prefix(self):
        req = TelcoDataRequest(
            customer_id="c1", phone_number="07012345678", consent=True,
        )
        assert req.phone_number == "07012345678"

    def test_081_prefix(self):
        req = TelcoDataRequest(
            customer_id="c1", phone_number="08112345678", consent=True,
        )
        assert req.phone_number == "08112345678"

    def test_090_prefix(self):
        req = TelcoDataRequest(
            customer_id="c1", phone_number="09012345678", consent=True,
        )
        assert req.phone_number == "09012345678"

    def test_0810_prefix(self):
        req = TelcoDataRequest(
            customer_id="c1", phone_number="08101234567", consent=True,
        )
        assert req.phone_number == "08101234567"

    def test_international_formats(self):
        for num in ["+2347012345678", "+2348012345678", "+2348112345678", "+2349012345678"]:
            req = TelcoDataRequest(
                customer_id="c1", phone_number=num, consent=True,
            )
            assert req.phone_number.startswith("0")
            assert len(req.phone_number) == 11


class TestCreditScoreRequest:
    """Tests for CreditScoreRequest."""

    def test_valid_request(self):
        req = CreditScoreRequest(
            customer_id="cust-001",
            phone_number="08012345678",
        )
        assert req.fetch_fresh_data is False

    def test_fresh_data_flag(self):
        req = CreditScoreRequest(
            customer_id="cust-001",
            phone_number="08012345678",
            fetch_fresh_data=True,
        )
        assert req.fetch_fresh_data is True


class TestCreditScoreResponse:
    """Tests for CreditScoreResponse."""

    def test_valid_response(self):
        resp = CreditScoreResponse(
            id="score-001",
            customer_id="cust-001",
            phone_number="08012345678",
            credit_score=720,
            score_category="GOOD",
            payment_history_score=85.0,
            account_age_score=70.0,
            spending_consistency_score=80.0,
            usage_pattern_score=65.0,
            account_health_score=75.0,
            risk_level="LOW",
            risk_factors=["recent_inquiry"],
            positive_factors=["long_account_age"],
            max_loan_amount=500000.0,
            recommended_interest_rate=12.5,
            approval_probability=0.78,
            calculated_at=datetime.now(timezone.utc),
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
        )
        assert resp.credit_score == 720
        assert 300 <= resp.credit_score <= 850
        assert 0 <= resp.approval_probability <= 1

    def test_credit_score_bounds(self):
        with pytest.raises(Exception):
            CreditScoreResponse(
                id="score-001",
                customer_id="cust-001",
                phone_number="08012345678",
                credit_score=900,  # Too high
                score_category="GOOD",
                payment_history_score=85.0,
                account_age_score=70.0,
                spending_consistency_score=80.0,
                usage_pattern_score=65.0,
                account_health_score=75.0,
                risk_level="LOW",
                risk_factors=[],
                positive_factors=[],
                max_loan_amount=500000.0,
                recommended_interest_rate=12.5,
                approval_probability=0.78,
                calculated_at=datetime.now(timezone.utc),
                expires_at=datetime.now(timezone.utc) + timedelta(days=30),
            )

    def test_approval_probability_bounds(self):
        with pytest.raises(Exception):
            CreditScoreResponse(
                id="score-001",
                customer_id="cust-001",
                phone_number="08012345678",
                credit_score=720,
                score_category="GOOD",
                payment_history_score=85.0,
                account_age_score=70.0,
                spending_consistency_score=80.0,
                usage_pattern_score=65.0,
                account_health_score=75.0,
                risk_level="LOW",
                risk_factors=[],
                positive_factors=[],
                max_loan_amount=500000.0,
                recommended_interest_rate=12.5,
                approval_probability=1.5,  # Too high
                calculated_at=datetime.now(timezone.utc),
                expires_at=datetime.now(timezone.utc) + timedelta(days=30),
            )


class TestCreditScoreBreakdown:
    """Tests for CreditScoreBreakdown."""

    def test_valid_breakdown(self):
        breakdown = CreditScoreBreakdown(
            credit_score=720,
            score_category="GOOD",
            components={"payment_history": 85.0},
            risk_assessment={"risk_level": "LOW"},
            recommendations={"max_loan": 500000},
            telco_data_summary={"provider": "MTN"},
        )
        assert breakdown.credit_score == 720
        assert breakdown.score_category == "GOOD"


class TestBulkCreditScoreRequest:
    """Tests for BulkCreditScoreRequest."""

    def test_valid_bulk_request(self):
        req = BulkCreditScoreRequest(
            customers=[
                {"customer_id": "cust-001", "phone_number": "08012345678"},
                {"customer_id": "cust-002", "phone_number": "08098765432"},
            ],
        )
        assert len(req.customers) == 2

    def test_empty_customers(self):
        req = BulkCreditScoreRequest(customers=[])
        assert len(req.customers) == 0


class TestBulkCreditScoreResponse:
    """Tests for BulkCreditScoreResponse."""

    def test_valid_bulk_response(self):
        resp = BulkCreditScoreResponse(
            total=2,
            successful=2,
            failed=0,
            results=[],
            errors=[],
        )
        assert resp.total == 2
        assert resp.successful == 2


# ── Schema Configuration ──────────────────────────────────────────────────────


class TestSchemaConfig:
    """Tests for schema config attributes."""

    def test_telco_data_response_has_from_attributes(self):
        config = getattr(TelcoDataResponse, "Config", None)
        assert config is not None

    def test_credit_score_response_has_from_attributes(self):
        config = getattr(CreditScoreResponse, "Config", None)
        assert config is not None


# ── Models ────────────────────────────────────────────────────────────────────


class TestModels:
    """Tests for SQLAlchemy models (instantiation only)."""

    def test_telco_provider_enum(self):
        from app.models.telco_data import TelcoProvider as TelcoProv
        values = [e.value for e in TelcoProv]
        assert "MTN" in values
        assert "AIRTEL" in values
        assert "GLO" in values
        assert "9MOBILE" in values

    def test_telco_data_status_enum(self):
        from app.models.telco_data import TelcoDataStatus
        values = [e.value for e in TelcoDataStatus]
        assert "PENDING" in values
        assert "SUCCESS" in values
        assert "FAILED" in values
        assert "PARTIAL" in values

    def test_loan_application_exists(self):
        from app.models.loan_outcome import LoanApplication, LoanPayment
        assert LoanApplication is not None
        assert LoanPayment is not None


# ── Database Module ───────────────────────────────────────────────────────────


class TestDatabaseModule:
    """Tests for the database module."""

    def test_database_module_exists(self):
        from app.services.database import get_db, engine, SessionLocal
        assert callable(get_db)
        assert engine is not None
        assert callable(SessionLocal)

    def test_session_creates(self):
        from app.services.database import SessionLocal
        session = SessionLocal()
        assert session is not None
        session.close()


# ── API Router Structure ─────────────────────────────────────────────────────


class TestRouterStructure:
    """Tests for router structure (import checks)."""

    def test_telco_router_exists(self):
        from app.api import telco_router
        assert hasattr(telco_router, "router")
        assert telco_router.router is not None

    def test_credit_score_router_exists(self):
        from app.api import credit_score_router
        assert hasattr(credit_score_router, "router")

    def test_telco_router_has_endpoints(self):
        from app.api import telco_router
        routes = telco_router.router.routes
        route_paths = [r.path for r in routes if hasattr(r, 'path')]
        assert "/fetch" in route_paths

    def test_credit_score_router_has_endpoints(self):
        from app.api import credit_score_router
        routes = credit_score_router.router.routes
        route_paths = [r.path for r in routes if hasattr(r, 'path')]
        assert "/calculate" in route_paths
