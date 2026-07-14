"""Tests for data-lakehouse service."""
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


# ── Health ──────────────────────────────────────────────────────────────────

class TestHealth:
    def test_health_returns_200(self):
        assert client.get("/health").status_code == 200

    def test_health_contains_service_name(self):
        assert client.get("/health").json()["service"] == "data-lakehouse"

    def test_health_status_healthy(self):
        assert client.get("/health").json()["status"] == "healthy"


# ── Datasets ────────────────────────────────────────────────────────────────

class TestDatasets:
    def test_list_datasets_returns_200(self):
        assert client.get("/api/v1/lakehouse/datasets").status_code == 200

    def test_has_datasets_list(self):
        data = client.get("/api/v1/lakehouse/datasets").json()
        assert "datasets" in data
        assert len(data["datasets"]) > 0

    def test_dataset_structure(self):
        ds = client.get("/api/v1/lakehouse/datasets").json()["datasets"][0]
        for field in ["id", "name", "description", "format", "rows", "size_gb"]:
            assert field in ds

    def test_has_policies_dataset(self):
        data = client.get("/api/v1/lakehouse/datasets").json()
        ids = [d["id"] for d in data["datasets"]]
        assert "ds-policies" in ids

    def test_has_claims_dataset(self):
        data = client.get("/api/v1/lakehouse/datasets").json()
        ids = [d["id"] for d in data["datasets"]]
        assert "ds-claims" in ids

    def test_has_payments_dataset(self):
        data = client.get("/api/v1/lakehouse/datasets").json()
        ids = [d["id"] for d in data["datasets"]]
        assert "ds-payments" in ids

    def test_dataset_format_is_delta(self):
        data = client.get("/api/v1/lakehouse/datasets").json()
        for ds in data["datasets"]:
            assert ds["format"] == "delta"

    def test_dataset_has_partitioned_by(self):
        data = client.get("/api/v1/lakehouse/datasets").json()
        for ds in data["datasets"]:
            assert "partitioned_by" in ds
            assert len(ds["partitioned_by"]) > 0

    def test_dataset_has_schema_fields(self):
        data = client.get("/api/v1/lakehouse/datasets").json()
        for ds in data["datasets"]:
            assert "schema_fields" in ds
            assert len(ds["schema_fields"]) > 0

    def test_policies_dataset_positive_rows(self):
        data = client.get("/api/v1/lakehouse/datasets").json()
        policies = [d for d in data["datasets"] if d["id"] == "ds-policies"][0]
        assert policies["rows"] > 0

    def test_payments_has_most_rows(self):
        data = client.get("/api/v1/lakehouse/datasets").json()
        datasets = {d["id"]: d["rows"] for d in data["datasets"]}
        assert datasets["ds-payments"] > datasets["ds-policies"]

    def test_dataset_has_updated_at(self):
        data = client.get("/api/v1/lakehouse/datasets").json()
        for ds in data["datasets"]:
            assert "updated_at" in ds


# ── Query ───────────────────────────────────────────────────────────────────

class TestQuery:
    def test_query_returns_200(self):
        assert client.get("/api/v1/lakehouse/query").status_code == 200

    def test_query_with_custom_sql(self):
        resp = client.get("/api/v1/lakehouse/query?sql=SELECT%20COUNT(*)%20FROM%20claims")
        assert resp.status_code == 200

    def test_query_has_execution_time(self):
        data = client.get("/api/v1/lakehouse/query").json()
        assert "execution_time_ms" in data
        assert data["execution_time_ms"] > 0

    def test_query_has_engine(self):
        data = client.get("/api/v1/lakehouse/query").json()
        assert "engine" in data

    def test_query_has_result(self):
        data = client.get("/api/v1/lakehouse/query").json()
        assert "result" in data


# ── Pipelines ───────────────────────────────────────────────────────────────

class TestPipelines:
    def test_list_pipelines_returns_200(self):
        assert client.get("/api/v1/lakehouse/pipelines").status_code == 200

    def test_has_pipelines_list(self):
        data = client.get("/api/v1/lakehouse/pipelines").json()
        assert "pipelines" in data
        assert len(data["pipelines"]) > 0

    def test_pipeline_structure(self):
        pipe = client.get("/api/v1/lakehouse/pipelines").json()["pipelines"][0]
        for field in ["id", "name", "schedule", "status", "last_run"]:
            assert field in pipe

    def test_has_daily_etl_pipeline(self):
        data = client.get("/api/v1/lakehouse/pipelines").json()
        ids = [p["id"] for p in data["pipelines"]]
        assert "pipe-daily-etl" in ids

    def test_all_pipelines_healthy(self):
        data = client.get("/api/v1/lakehouse/pipelines").json()
        for pipe in data["pipelines"]:
            assert pipe["status"] == "healthy"

    def test_pipeline_has_records_processed(self):
        data = client.get("/api/v1/lakehouse/pipelines").json()
        for pipe in data["pipelines"]:
            assert "records_processed" in pipe


# ── Metrics ─────────────────────────────────────────────────────────────────

class TestMetrics:
    def test_metrics_returns_200(self):
        assert client.get("/api/v1/lakehouse/metrics").status_code == 200

    def test_metrics_has_total_data_size(self):
        data = client.get("/api/v1/lakehouse/metrics").json()
        assert "total_data_size_gb" in data
        assert data["total_data_size_gb"] > 0

    def test_metrics_has_total_tables(self):
        data = client.get("/api/v1/lakehouse/metrics").json()
        assert "total_tables" in data

    def test_metrics_has_daily_ingestion_rate(self):
        data = client.get("/api/v1/lakehouse/metrics").json()
        assert "daily_ingestion_rate" in data

    def test_metrics_has_query_latency(self):
        data = client.get("/api/v1/lakehouse/metrics").json()
        assert "query_latency_p50_ms" in data
        assert "query_latency_p99_ms" in data

    def test_metrics_has_costs(self):
        data = client.get("/api/v1/lakehouse/metrics").json()
        assert "storage_cost_monthly_usd" in data
        assert "compute_cost_monthly_usd" in data

    def test_query_latency_p99_gt_p50(self):
        data = client.get("/api/v1/lakehouse/metrics").json()
        assert data["query_latency_p99_ms"] >= data["query_latency_p50_ms"]


# ── Error Handling ──────────────────────────────────────────────────────────

class TestErrorHandling:
    def test_404_unknown_route(self):
        assert client.get("/api/v1/nonexistent").status_code == 404
