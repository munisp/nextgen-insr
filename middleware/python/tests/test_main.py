"""Tests for middleware-python service."""
import os
os.environ["FAST_CHAOS_MODE"] = "1"

import pytest
from fastapi.testclient import TestClient
from main import (
    app, engine, aggregator, ChaosEngine, MetricsAggregator,
    EXPERIMENTS, TARGETS, ChaosExperiment, FaultType, ExperimentRequest,
    ExperimentResult,
    asdict,
)

client = TestClient(app)


# ── Health / Readiness ──────────────────────────────────────────────────────

class TestHealth:
    def test_health_returns_200(self):
        resp = client.get("/health")
        assert resp.status_code == 200

    def test_health_contains_service_name(self):
        data = client.get("/health").json()
        assert data["service"] == "middleware-python"

    def test_health_contains_version(self):
        data = client.get("/health").json()
        assert data["version"] == "1.0.0"

    def test_health_status_healthy(self):
        assert client.get("/health").json()["status"] == "healthy"

    def test_health_has_uptime_components(self):
        data = client.get("/health").json()
        assert "uptime_components" in data


# ── Chaos Experiments ────────────────────────────────────────────────────────

class TestChaosExperiments:
    def test_list_experiments_returns_200(self):
        resp = client.get("/api/v1/chaos/experiments")
        assert resp.status_code == 200

    def test_list_experiments_has_experiments(self):
        data = client.get("/api/v1/chaos/experiments").json()
        assert "experiments" in data
        assert len(data["experiments"]) > 0

    def test_list_experiments_has_total(self):
        data = client.get("/api/v1/chaos/experiments").json()
        assert "total" in data
        assert data["total"] == len(data["experiments"])

    def test_experiment_structure(self):
        data = client.get("/api/v1/chaos/experiments").json()
        exp = data["experiments"][0]
        for field in ["name", "target", "fault_type", "duration_sec", "intensity"]:
            assert field in exp

    def test_list_experiments_has_kafka(self):
        data = client.get("/api/v1/chaos/experiments").json()
        names = [e["name"] for e in data["experiments"]]
        assert any("kafka" in n for n in names)

    def test_list_experiments_has_redis(self):
        data = client.get("/api/v1/chaos/experiments").json()
        names = [e["name"] for e in data["experiments"]]
        assert any("redis" in n for n in names)


class TestRunChaos:
    def test_run_experiment_returns_200(self):
        resp = client.post("/api/v1/chaos/run", json={
            "target": "kafka", "fault_type": "latency", "duration_sec": 10,
        })
        assert resp.status_code == 200

    def test_run_experiment_response_structure(self):
        resp = client.post("/api/v1/chaos/run", json={
            "target": "kafka", "fault_type": "error", "duration_sec": 5,
        })
        data = resp.json()
        for field in ["experiment", "target", "fault_type", "success", "verdict",
                       "recovery_time_ms", "errors_during", "errors_after"]:
            assert field in data

    def test_run_experiment_verdict_values(self):
        data = client.post("/api/v1/chaos/run", json={
            "target": "redis", "fault_type": "latency", "duration_sec": 5,
        }).json()
        assert data["verdict"] in (
            "PASS — Full recovery", "WARN — Recovered with residual errors",
            "FAIL — Recovered but degraded", "FAIL — Did not recover",
        )

    def test_run_experiment_intensity_effect(self):
        r1 = client.post("/api/v1/chaos/run", json={
            "target": "kafka", "fault_type": "error", "duration_sec": 5, "intensity": 0.2,
        }).json()
        r2 = client.post("/api/v1/chaos/run", json={
            "target": "kafka", "fault_type": "error", "duration_sec": 5, "intensity": 1.0,
        }).json()
        assert r2["errors_during"] >= r1["errors_during"]

    def test_run_all_experiments(self):
        resp = client.post("/api/v1/chaos/run-all")
        assert resp.status_code == 200

    def test_run_all_has_results(self):
        data = client.post("/api/v1/chaos/run-all").json()
        assert "results" in data
        assert len(data["results"]) > 0

    def test_run_all_has_summary(self):
        data = client.post("/api/v1/chaos/run-all").json()
        assert "summary" in data
        assert "total_experiments" in data["summary"]
        assert "passed" in data["summary"]
        assert "failed" in data["summary"]

    def test_run_all_filtered_by_target(self):
        resp = client.post("/api/v1/chaos/run-all", params={"target": "kafka"})
        data = resp.json()
        # The endpoint returns results filtered to the specified target
        filtered_results = data["results"]
        assert len(filtered_results) > 0
        # All returned results should match the target filter
        for r in filtered_results:
            assert r["target"] == "kafka", f"Expected kafka but got {r['target']}"


class TestChaosResults:
    def test_get_results_returns_200(self):
        resp = client.get("/api/v1/chaos/results")
        assert resp.status_code == 200

    def test_get_results_has_results(self):
        data = client.get("/api/v1/chaos/results").json()
        assert "results" in data

    def test_get_results_has_summary(self):
        data = client.get("/api/v1/chaos/results").json()
        assert "summary" in data


# ── Component Health ─────────────────────────────────────────────────────────

class TestComponentHealth:
    def test_component_health_returns_200(self):
        resp = client.get("/api/v1/health/components")
        assert resp.status_code == 200

    def test_component_health_has_components(self):
        data = client.get("/api/v1/health/components").json()
        assert "components" in data
        assert "total" in data

    def test_has_kafka_component(self):
        data = client.get("/api/v1/health/components").json()["components"]
        assert "kafka" in data

    def test_has_redis_component(self):
        data = client.get("/api/v1/health/components").json()["components"]
        assert "redis" in data

    def test_has_postgres_component(self):
        data = client.get("/api/v1/health/components").json()["components"]
        assert "postgres" in data

    def test_component_count_13(self):
        data = client.get("/api/v1/health/components").json()
        assert data["total"] == len(data["components"])

    def test_update_component_health(self):
        resp = client.post("/api/v1/health/component", json={
            "component": "kafka", "status": "degraded",
        })
        assert resp.status_code == 200

    def test_update_unknown_component(self):
        resp = client.post("/api/v1/health/component", json={
            "component": "nonexistent", "status": "healthy",
        })
        assert resp.status_code == 404

    def test_update_component_status(self):
        client.post("/api/v1/health/component", json={
            "component": "redis", "status": "down",
        })
        data = client.get("/api/v1/health/components").json()["components"]["redis"]
        assert data["status"] == "down"


# ── Metrics ──────────────────────────────────────────────────────────────────

class TestMetrics:
    def test_metrics_returns_200(self):
        resp = client.get("/metrics")
        assert resp.status_code == 200

    def test_metrics_prometheus_format(self):
        resp = client.get("/metrics")
        assert "# POS-54Link Middleware Metrics" in resp.text

    def test_metrics_has_type_lines(self):
        resp = client.get("/metrics")
        assert "# TYPE" in resp.text

    def test_metrics_collected_returns_200(self):
        resp = client.post("/api/v1/metrics/collect")
        assert resp.status_code == 200

    def test_metrics_collected_has_count(self):
        data = client.post("/api/v1/metrics/collect").json()
        assert "collected" in data
        assert data["collected"] > 0

    def test_metrics_collected_has_timestamp(self):
        data = client.post("/api/v1/metrics/collect").json()
        assert "timestamp" in data

    def test_get_prometheus_metrics(self):
        resp = client.get("/api/v1/metrics/prometheus")
        assert resp.status_code == 200
        assert "# TYPE" in resp.text

    def test_get_metrics_components(self):
        resp = client.get("/api/v1/metrics/components")
        assert resp.status_code == 200
        data = resp.json()
        assert "collectors" in data
        assert data["total"] > 0

    def test_metrics_kafka_collector(self):
        data = client.get("/api/v1/metrics/components").json()
        assert "kafka" in data["collectors"]

    def test_metrics_redis_collector(self):
        data = client.get("/api/v1/metrics/components").json()
        assert "redis" in data["collectors"]

    def test_metrics_postgres_collector(self):
        data = client.get("/api/v1/metrics/components").json()
        assert "postgres" in data["collectors"]


# ── ExperimentRequest Validation ─────────────────────────────────────────────

class TestValidation:
    def test_experiment_requires_target(self):
        resp = client.post("/api/v1/chaos/run", json={
            "fault_type": "latency", "duration_sec": 5,
        })
        assert resp.status_code == 422

    def test_experiment_requires_fault_type(self):
        resp = client.post("/api/v1/chaos/run", json={
            "target": "kafka", "duration_sec": 5,
        })
        assert resp.status_code == 422

    def test_experiment_duration_min(self):
        resp = client.post("/api/v1/chaos/run", json={
            "target": "kafka", "fault_type": "latency", "duration_sec": 0,
        })
        assert resp.status_code == 422

    def test_experiment_duration_max(self):
        resp = client.post("/api/v1/chaos/run", json={
            "target": "kafka", "fault_type": "latency", "duration_sec": 500,
        })
        assert resp.status_code == 422

    def test_experiment_intensity_range(self):
        resp = client.post("/api/v1/chaos/run", json={
            "target": "kafka", "fault_type": "latency", "duration_sec": 5, "intensity": 2.0,
        })
        assert resp.status_code == 422

    def test_experiment_invalid_fault_type(self):
        resp = client.post("/api/v1/chaos/run", json={
            "target": "kafka", "fault_type": "unknown", "duration_sec": 5,
        })
        assert resp.status_code == 422

    def test_all_fault_types_valid(self):
        for ft in FaultType:
            resp = client.post("/api/v1/chaos/run", json={
                "target": "kafka", "fault_type": ft.value, "duration_sec": 5,
            })
            assert resp.status_code == 200, f"Failed for fault_type={ft.value}"


# ── ChaosEngine Unit Tests ──────────────────────────────────────────────────

class TestChaosEngine:
    def test_engine_init(self):
        eng = ChaosEngine()
        assert eng.results == []

    def test_engine_run_experiment(self):
        eng = ChaosEngine()
        exp = ChaosExperiment("test", "kafka", FaultType.LATENCY, 5)
        result = eng.run_experiment(exp)
        assert isinstance(result, ExperimentResult)
        assert result.success is True

    def test_engine_run_all(self):
        eng = ChaosEngine()
        exps = [
            ChaosExperiment("e1", "kafka", FaultType.LATENCY, 1),
            ChaosExperiment("e2", "redis", FaultType.ERROR, 1),
        ]
        results = eng.run_all(exps)
        assert len(results) == 2

    def test_engine_get_results(self):
        eng = ChaosEngine()
        eng.run_experiment(ChaosExperiment("test", "kafka", FaultType.LATENCY, 1))
        results = eng.get_results()
        assert len(results) == 1
        assert results[0]["experiment"] == "test"

    def test_engine_get_summary(self):
        eng = ChaosEngine()
        eng.run_experiment(ChaosExperiment("test", "kafka", FaultType.LATENCY, 1))
        summary = eng.get_summary()
        assert summary["total_experiments"] == 1
        assert summary["passed"] == 1

    def test_experiment_result_asdict(self):
        eng = ChaosEngine()
        result = eng.run_experiment(ChaosExperiment("test", "kafka", FaultType.LATENCY, 1))
        d = asdict(result)
        assert isinstance(d, dict)
        assert "experiment" in d
        assert "verdict" in d


# ── MetricsAggregator Unit Tests ─────────────────────────────────────────────

class TestMetricsAggregator:
    def test_aggregator_init(self):
        agg = MetricsAggregator()
        assert len(agg.collectors) > 0

    def test_collect_all(self):
        agg = MetricsAggregator()
        metrics = agg.collect_all()
        assert len(metrics) > 0

    def test_collect_all_has_metrics_total(self):
        agg = MetricsAggregator()
        metrics = agg.collect_all()
        names = [m["name"] for m in metrics]
        assert "pos54_metrics_total" in names

    def test_to_prometheus_format(self):
        agg = MetricsAggregator()
        agg.collect_all()
        fmt = agg.to_prometheus_format()
        assert "# POS-54Link Middleware Metrics" in fmt
        assert "# TYPE" in fmt

    def test_get_components(self):
        agg = MetricsAggregator()
        comps = agg.get_components()
        assert "components" in comps
        assert "total" in comps
        assert comps["total"] > 0


# ── Error Handling ──────────────────────────────────────────────────────────

class TestErrorHandling:
    def test_404_unknown_route(self):
        assert client.get("/api/v1/nonexistent").status_code == 404

    def test_post_to_get_endpoint(self):
        resp = client.post("/health")
        assert resp.status_code in (200, 405)
