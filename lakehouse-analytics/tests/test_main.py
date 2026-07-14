"""Tests for lakehouse-analytics service."""
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
        assert client.get("/health").json()["service"] == "lakehouse-analytics"

    def test_health_contains_version(self):
        assert "version" in client.get("/health").json()

    def test_health_contains_middleware(self):
        assert "middleware" in client.get("/health").json()


# ── Dashboards ──────────────────────────────────────────────────────────────

class TestDashboards:
    def test_list_dashboards_returns_200(self):
        assert client.get("/api/v1/lakehouse/dashboards").status_code == 200

    def test_dashboards_has_dashboards_list(self):
        data = client.get("/api/v1/lakehouse/dashboards").json()
        assert "dashboards" in data
        assert len(data["dashboards"]) > 0

    def test_dashboard_structure(self):
        dash = client.get("/api/v1/lakehouse/dashboards").json()["dashboards"][0]
        for field in ["id", "name", "category", "widgets"]:
            assert field in dash

    def test_has_exec_dashboard(self):
        data = client.get("/api/v1/lakehouse/dashboards").json()
        ids = [d["id"] for d in data["dashboards"]]
        assert "exec-overview" in ids

    def test_has_claims_dashboard(self):
        data = client.get("/api/v1/lakehouse/dashboards").json()
        ids = [d["id"] for d in data["dashboards"]]
        assert "claims-analytics" in ids


# ── Metrics ─────────────────────────────────────────────────────────────────

class TestMetrics:
    def test_metrics_exec_dashboard(self):
        resp = client.get("/api/v1/lakehouse/metrics?dashboard=exec-overview&period=30d")
        assert resp.status_code == 200

    def test_metrics_has_period(self):
        data = client.get("/api/v1/lakehouse/metrics?dashboard=exec-overview&period=30d").json()
        assert data["period"] == "30d"

    def test_metrics_has_metrics_dict(self):
        data = client.get("/api/v1/lakehouse/metrics?dashboard=exec-overview&period=30d").json()
        assert "metrics" in data

    def test_exec_metrics_has_gwp(self):
        data = client.get("/api/v1/lakehouse/metrics?dashboard=exec-overview&period=30d").json()
        assert "gross_written_premium" in data["metrics"]

    def test_exec_metrics_has_loss_ratio(self):
        data = client.get("/api/v1/lakehouse/metrics?dashboard=exec-overview&period=30d").json()
        assert "loss_ratio" in data["metrics"]

    def test_gwp_has_value_and_currency(self):
        data = client.get("/api/v1/lakehouse/metrics?dashboard=exec-overview&period=30d").json()
        gwp = data["metrics"]["gross_written_premium"]
        assert "value" in gwp
        assert gwp["currency"] == "NGN"

    def test_metrics_unknown_dashboard(self):
        resp = client.get("/api/v1/lakehouse/metrics?dashboard=unknown&period=30d")
        assert resp.status_code == 200

    def test_loss_ratio_has_target(self):
        data = client.get("/api/v1/lakehouse/metrics?dashboard=exec-overview&period=30d").json()
        assert "target" in data["metrics"]["loss_ratio"]


# ── Reports ─────────────────────────────────────────────────────────────────

class TestReports:
    def test_list_reports_returns_200(self):
        assert client.get("/api/v1/lakehouse/reports").status_code == 200

    def test_reports_has_reports_list(self):
        data = client.get("/api/v1/lakehouse/reports").json()
        assert "reports" in data
        assert len(data["reports"]) > 0

    def test_report_structure(self):
        report = client.get("/api/v1/lakehouse/reports").json()["reports"][0]
        for field in ["id", "name", "format", "schedule"]:
            assert field in report

    def test_has_financial_report(self):
        data = client.get("/api/v1/lakehouse/reports").json()
        ids = [r["id"] for r in data["reports"]]
        assert "monthly-financials" in ids

    def test_has_regulatory_report(self):
        data = client.get("/api/v1/lakehouse/reports").json()
        ids = [r["id"] for r in data["reports"]]
        assert "regulatory-returns" in ids


# ── Query ───────────────────────────────────────────────────────────────────

class TestQuery:
    def test_query_returns_200(self):
        resp = client.post("/api/v1/lakehouse/query", json={"metric": "premium", "group_by": "month"})
        assert resp.status_code == 200

    def test_query_has_result(self):
        data = client.post("/api/v1/lakehouse/query", json={"metric": "premium"}).json()
        assert "result" in data

    def test_query_result_has_data(self):
        data = client.post("/api/v1/lakehouse/query", json={"metric": "premium"}).json()
        assert "data" in data["result"]

    def test_query_result_has_total(self):
        data = client.post("/api/v1/lakehouse/query", json={"metric": "premium"}).json()
        assert "total" in data["result"]

    def test_query_result_has_trend(self):
        data = client.post("/api/v1/lakehouse/query", json={"metric": "premium"}).json()
        assert data["result"]["trend"] in ("increasing", "decreasing", "stable")

    def test_query_has_execution_time(self):
        data = client.post("/api/v1/lakehouse/query", json={"metric": "premium"}).json()
        assert "execution_time_ms" in data


# ── Data Catalog ────────────────────────────────────────────────────────────

class TestDataCatalog:
    def test_data_catalog_returns_200(self):
        assert client.get("/api/v1/lakehouse/data-catalog").status_code == 200

    def test_data_catalog_has_datasets(self):
        data = client.get("/api/v1/lakehouse/data-catalog").json()
        assert "datasets" in data
        assert len(data["datasets"]) > 0

    def test_dataset_structure(self):
        ds = client.get("/api/v1/lakehouse/data-catalog").json()["datasets"][0]
        for field in ["name", "rows", "columns", "freshness", "source"]:
            assert field in ds

    def test_has_policies_dataset(self):
        data = client.get("/api/v1/lakehouse/data-catalog").json()
        names = [d["name"] for d in data["datasets"]]
        assert "policies" in names

    def test_has_claims_dataset(self):
        data = client.get("/api/v1/lakehouse/data-catalog").json()
        names = [d["name"] for d in data["datasets"]]
        assert "claims" in names


# ── Ingest ──────────────────────────────────────────────────────────────────

class TestIngest:
    def test_ingest_returns_200(self):
        resp = client.post("/api/v1/lakehouse/ingest", json={
            "source": "test", "events": [{"id": 1}, {"id": 2}],
        })
        assert resp.status_code == 200

    def test_ingest_returns_ingested_count(self):
        data = client.post("/api/v1/lakehouse/ingest", json={
            "source": "test", "events": [{"id": 1}, {"id": 2}, {"id": 3}],
        }).json()
        assert data["ingested"] == 3

    def test_ingest_echoes_source(self):
        data = client.post("/api/v1/lakehouse/ingest", json={
            "source": "my-source", "events": [],
        }).json()
        assert data["source"] == "my-source"

    def test_ingest_has_status(self):
        data = client.post("/api/v1/lakehouse/ingest", json={
            "source": "test", "events": [],
        }).json()
        assert data["status"] == "accepted"


# ── Error Handling ──────────────────────────────────────────────────────────

class TestErrorHandling:
    def test_404_unknown_route(self):
        assert client.get("/api/v1/nonexistent").status_code == 404
