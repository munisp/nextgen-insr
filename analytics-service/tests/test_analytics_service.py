"""Tests for the analytics-service FastAPI service."""

import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone, timedelta

from main import (
    AgentNotFoundError,
    AnalyticsError,
    DatabaseConnectionError,
    DailyStatEntry,
    AgentStatEntry,
    InvalidParameterError,
    _compute_tier,
    utc_days_ago,
    app,
)
from fastapi.testclient import TestClient

client = TestClient(app)


# ── Helpers ───────────────────────────────────────────────────────────────────


_call_count = 0
def mock_query_factory(rows=None):
    """Return a function that returns given rows when called as query()."""
    if rows is None:
        rows = []

    def query_side_effect(*args, **kwargs):
        global _call_count
        _call_count += 1
        return rows

    return query_side_effect


# ── Health Check ───────────────────────────────────────────────────────────────


class TestHealth:
    def test_health_returns_ok(self):
        with patch("main.get_conn") as mock:
            mock.return_value.close = MagicMock()
            resp = client.get("/health")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "ok"
            assert data["service"] == "analytics-service"
            assert isinstance(data["db_connected"], bool)
            assert isinstance(data["db_ready"], bool)
            assert "timestamp" in data

    def test_health_db_disconnected(self):
        with patch("main.get_conn") as mock:
            mock.side_effect = DatabaseConnectionError()
            resp = client.get("/health")
            assert resp.status_code == 200
            assert resp.json()["db_connected"] is False

    def test_health_has_db_ready_field(self):
        with patch("main.get_conn") as mock:
            mock.return_value.close = MagicMock()
            resp = client.get("/health")
            data = resp.json()
            assert "db_ready" in data


# ── Tier Computation ──────────────────────────────────────────────────────────


class TestTierComputation:
    def test_excellent(self):
        assert _compute_tier(98.5) == "Excellent"
        assert _compute_tier(100.0) == "Excellent"

    def test_good(self):
        assert _compute_tier(96.0) == "Good"
        assert _compute_tier(95.0) == "Good"

    def test_fair(self):
        assert _compute_tier(92.0) == "Fair"
        assert _compute_tier(90.0) == "Fair"

    def test_poor(self):
        assert _compute_tier(85.0) == "Poor"
        assert _compute_tier(0.0) == "Poor"

    def test_none(self):
        assert _compute_tier(None) is None

    def test_boundary_98(self):
        assert _compute_tier(98.0) == "Excellent"

    def test_boundary_95(self):
        assert _compute_tier(95.0) == "Good"

    def test_boundary_90(self):
        assert _compute_tier(90.0) == "Fair"


# ── Success Rate Endpoint ─────────────────────────────────────────────────────


class TestSuccessRate:
    def test_returns_200(self):
        mock_data = [{
            "success_count": 950,
            "failed_count": 40,
            "reversed_count": 10,
            "total_count": 1000,
        }]
        mock_daily = []  # No daily rows — avoid KeyError
        with patch("main.query") as mock_query:
            def side_effect(sql, params=None):
                if "GROUP BY" in sql:
                    return mock_daily
                return mock_data
            mock_query.side_effect = side_effect
            resp = client.get("/stats/success-rate?days=7")
            assert resp.status_code == 200
            data = resp.json()
            assert data["period_days"] == 7
            assert data["success_rate_pct"] == 95.0
            assert data["tier"] == "Good"
            assert data["total_transactions"] == 1000
            assert data["success_count"] == 950
            assert "daily_series" in data

    def test_no_data_returns_zeros(self):
        with patch("main.query", side_effect=mock_query_factory([])):
            resp = client.get("/stats/success-rate?days=7")
            assert resp.status_code == 200
            data = resp.json()
            assert data["success_rate_pct"] == 0.0
            assert data["tier"] == "Poor"
            assert data["total_transactions"] == 0

    def test_daily_series_computed(self):
        mock_overall = [{
            "success_count": 950,
            "failed_count": 40,
            "reversed_count": 10,
            "total_count": 1000,
        }]
        mock_daily = [{
            "day": "2026-07-01",
            "success_count": 50,
            "total_count": 100,
        }]
        with patch("main.query") as mock:
            # query is called twice: overall stats, then daily breakdown
            mock.side_effect = [mock_overall, mock_daily]
            resp = client.get("/stats/success-rate?days=7")
            data = resp.json()
            assert len(data["daily_series"]) == 1
            assert data["daily_series"][0]["rate"] == 50.0

    def test_custom_days(self):
        with patch("main.query", side_effect=mock_query_factory([])):
            resp = client.get("/stats/success-rate?days=30")
            assert resp.status_code == 200
            assert resp.json()["period_days"] == 30

    def test_invalid_days_too_low(self):
        resp = client.get("/stats/success-rate?days=0")
        assert resp.status_code == 422

    def test_invalid_days_too_high(self):
        resp = client.get("/stats/success-rate?days=400")
        assert resp.status_code == 422

    def test_computed_at_present(self):
        with patch("main.query", side_effect=mock_query_factory([])):
            resp = client.get("/stats/success-rate?days=7")
            assert "computed_at" in resp.json()

    def test_high_rate_is_excellent(self):
        mock_overall = [{
            "success_count": 995,
            "failed_count": 3,
            "reversed_count": 2,
            "total_count": 1000,
        }]
        mock_daily = []
        with patch("main.query") as mock:
            mock.side_effect = [mock_overall, mock_daily]
            resp = client.get("/stats/success-rate?days=7")
            assert resp.json()["tier"] == "Excellent"


# ── By-Type Endpoint ──────────────────────────────────────────────────────────


class TestByType:
    def test_returns_200(self):
        mock_data = [{
            "type": "transfer",
            "success_count": 800,
            "failed_count": 20,
            "total_count": 820,
            "total_volume": 15000000,
        }]
        with patch("main.query", side_effect=mock_query_factory(mock_data)):
            resp = client.get("/stats/by-type?days=7")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data["breakdown"]) == 1
            assert data["breakdown"][0]["type"] == "transfer"
            assert data["breakdown"][0]["success_rate_pct"] == pytest.approx(97.56)

    def test_empty_breakdown(self):
        with patch("main.query", side_effect=mock_query_factory([])):
            resp = client.get("/stats/by-type?days=7")
            data = resp.json()
            assert data["breakdown"] == []
            assert data["period_days"] == 7

    def test_multiple_types(self):
        mock_data = [
            {"type": "transfer", "success_count": 800, "failed_count": 20, "total_count": 820, "total_volume": 10000000},
            {"type": "bill_payment", "success_count": 190, "failed_count": 5, "total_count": 195, "total_volume": 2000000},
        ]
        with patch("main.query", side_effect=mock_query_factory(mock_data)):
            resp = client.get("/stats/by-type?days=7")
            assert len(resp.json()["breakdown"]) == 2


# ── Hourly Volume Endpoint ────────────────────────────────────────────────────


class TestHourlyVolume:
    def test_returns_200(self):
        mock_data = [{
            "hour": datetime(2026, 7, 7, 10, 0, tzinfo=timezone.utc),
            "tx_count": 150,
            "volume_ngn": 2500000,
        }]
        with patch("main.query", side_effect=mock_query_factory(mock_data)):
            resp = client.get("/stats/hourly-volume")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data["series"]) == 1
            assert data["series"][0]["tx_count"] == 150

    def test_empty_series(self):
        with patch("main.query", side_effect=mock_query_factory([])):
            resp = client.get("/stats/hourly-volume")
            assert resp.json()["series"] == []

    def test_computed_at_present(self):
        with patch("main.query", side_effect=mock_query_factory([])):
            resp = client.get("/stats/hourly-volume")
            assert "computed_at" in resp.json()


# ── Agent Stats Endpoint ─────────────────────────────────────────────────────


class TestAgentStats:
    def test_returns_200(self):
        mock_data = [{
            "agentCode": "AGT-001",
            "name": "John Agent",
            "success_count": 95,
            "failed_count": 5,
            "total_count": 100,
            "volume_ngn": 1500000,
            "total_commission": 45000,
        }]
        with patch("main.query", side_effect=mock_query_factory(mock_data)):
            resp = client.get("/stats/agent/AGT-001?days=7")
            assert resp.status_code == 200
            data = resp.json()
            assert data["agent_code"] == "AGT-001"
            assert data["success_rate_pct"] == 95.0
            assert data["total_transactions"] == 100

    def test_agent_not_found(self):
        with patch("main.query", side_effect=mock_query_factory([])):
            resp = client.get("/stats/agent/NONEXIST")
            assert resp.status_code == 404
            assert "not found" in resp.json()["error"]

    def test_invalid_agent_code(self):
        resp = client.get("/stats/agent/; DROP TABLE agents;--")
        assert resp.status_code == 422

    def test_empty_agent_code(self):
        # Empty agent_code doesn't match the path parameter, returns 404 from FastAPI routing
        resp = client.get("/stats/agent/;invalid")
        assert resp.status_code == 422

    def test_case_insensitive(self):
        mock_data = [{"agentCode": "agt-001", "name": "Test", "success_count": 10, "failed_count": 0, "total_count": 10, "volume_ngn": 0, "total_commission": 0}]
        with patch("main.query", side_effect=mock_query_factory(mock_data)):
            resp = client.get("/stats/agent/agt-001")
            assert resp.status_code == 200


# ── All Agents Endpoint ───────────────────────────────────────────────────────


class TestAllAgents:
    def test_returns_200(self):
        mock_data = [
            {"agentCode": "AGT-001", "name": "Alice", "status": "active", "success_count": 90, "failed_count": 10, "total_count": 100, "volume_ngn": 1000000, "total_commission": 30000},
            {"agentCode": "AGT-002", "name": "Bob", "status": "active", "success_count": 190, "failed_count": 10, "total_count": 200, "volume_ngn": 2000000, "total_commission": 60000},
        ]
        with patch("main.query", side_effect=mock_query_factory(mock_data)):
            resp = client.get("/stats/all-agents?days=7")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data["agents"]) == 2
            assert data["period_days"] == 7

    def test_empty_agents(self):
        with patch("main.query", side_effect=mock_query_factory([])):
            resp = client.get("/stats/all-agents?days=7")
            data = resp.json()
            assert data["agents"] == []

    def test_tier_computed_for_each_agent(self):
        mock_data = [{"agentCode": "AGT-001", "name": "Alice", "status": "active", "success_count": 99, "failed_count": 1, "total_count": 100, "volume_ngn": 0, "total_commission": 0}]
        with patch("main.query", side_effect=mock_query_factory(mock_data)):
            resp = client.get("/stats/all-agents")
            agent = resp.json()["agents"][0]
            assert agent["tier"] == "Excellent"


# ── Custom Exceptions ─────────────────────────────────────────────────────────


class TestExceptions:
    def test_analytics_error(self):
        exc = AnalyticsError("test error", status_code=500)
        assert exc.status_code == 500
        assert str(exc) == "test error"

    def test_database_error(self):
        exc = DatabaseConnectionError()
        assert exc.status_code == 503

    def test_agent_not_found(self):
        exc = AgentNotFoundError("AGT-999")
        assert exc.status_code == 404
        assert "AGT-999" in str(exc)

    def test_invalid_parameter(self):
        exc = InvalidParameterError("field", "bad value")
        assert exc.status_code == 422
        assert "field" in str(exc)


# ── DailyStatEntry ───────────────────────────────────────────────────────────


class TestDailyStatEntry:
    def test_to_dict(self):
        entry = DailyStatEntry("2026-07-07", 100, 200, 50.0)
        d = entry.to_dict()
        assert d["day"] == "2026-07-07"
        assert d["success_count"] == 100
        assert d["total_count"] == 200
        assert d["rate"] == 50.0


# ── AgentStatEntry ───────────────────────────────────────────────────────────


class TestAgentStatEntry:
    def test_to_dict(self):
        entry = AgentStatEntry(
            "AGT-001", "Alice", "active", 95.0, "Good",
            100, 95, 5, 1000000, 30000,
        )
        d = entry.to_dict()
        assert d["agent_code"] == "AGT-001"
        assert d["success_rate_pct"] == 95.0
        assert d["tier"] == "Good"


# ── utc_days_ago ─────────────────────────────────────────────────────────────


class TestUtcDaysAgo:
    def test_returns_datetime(self):
        result = utc_days_ago(7)
        assert isinstance(result, datetime)
        assert result.tzinfo is not None

    def test_7_days_ago(self):
        now = datetime.now(timezone.utc)
        result = utc_days_ago(7)
        expected = now - timedelta(days=7)
        assert abs((result - expected).total_seconds()) < 1


# ── Content Type Checks ───────────────────────────────────────────────────────


class TestContentTypes:
    def test_all_endpoints_return_json(self):
        endpoints = [
            "/health",
            "/stats/success-rate",
            "/stats/by-type",
            "/stats/hourly-volume",
            "/stats/all-agents",
        ]
        with patch("main.query", side_effect=mock_query_factory([])):
            for ep in endpoints:
                resp = client.get(ep)
                assert "application/json" in resp.headers.get("content-type", "")
