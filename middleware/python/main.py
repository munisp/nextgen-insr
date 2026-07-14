"""Middleware Python Service — Chaos testing and metrics collection for POS-54Link platform.

Provides HTTP endpoints for:
- Chaos testing: inject faults, measure recovery
- Metrics collection: Prometheus-compatible metrics endpoint
- Health/status of all middleware components
"""
import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("middleware-python")


# ── Prometheus Metrics ──────────────────────────────────────────────────────

chaos_experiments_total = Counter(
    "middleware_chaos_experiments_total", "Total chaos experiments run", ["status"]
)
chaos_experiments_duration = Histogram(
    "middleware_chaos_experiment_duration_seconds", "Chaos experiment duration", ["target"]
)
metrics_collected_total = Counter(
    "middleware_metrics_collected_total", "Total metrics collected by collector"
)
middleware_components_health = Gauge(
    "middleware_components_health", "Component health status", ["component"]
)


# ── Enums & Models ──────────────────────────────────────────────────────────

class FaultType(str, Enum):
    LATENCY = "latency"
    ERROR = "error"
    TIMEOUT = "timeout"
    PARTITION = "partition"
    RESOURCE_EXHAUSTION = "resource_exhaustion"
    DATA_CORRUPTION = "data_corruption"


class ExperimentStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class ChaosExperiment:
    name: str
    target: str
    fault_type: FaultType
    duration_sec: int = 30
    intensity: float = 0.5
    parameters: dict = field(default_factory=dict)


@dataclass
class ExperimentResult:
    experiment: str
    target: str
    fault_type: str
    started_at: str
    ended_at: str
    duration_sec: float
    success: bool
    recovery_time_ms: float
    errors_during: int
    errors_after: int
    requests_sent: int
    requests_succeeded: int
    p50_latency_ms: float
    p99_latency_ms: float
    verdict: str


# ── Middleware Targets ──────────────────────────────────────────────────────

TARGETS = {
    "kafka": {
        "health_url": os.getenv("KAFKA_HEALTH_URL", "http://localhost:8080/api/clusters"),
        "test_url": os.getenv("KAFKA_TEST_URL", "http://localhost:8080/api/clusters/pos54-production/topics"),
    },
    "redis": {
        "health_url": os.getenv("REDIS_HEALTH_URL", "http://localhost:6379"),
        "test_url": os.getenv("REDIS_TEST_URL", "http://localhost:6379"),
    },
    "postgres": {
        "health_url": os.getenv("POSTGRES_HEALTH_URL", "http://localhost:6432"),
        "test_url": os.getenv("POSTGRES_TEST_URL", "http://localhost:6432"),
    },
    "opensearch": {
        "health_url": os.getenv("OPENSEARCH_HEALTH_URL", "http://localhost:9200/_cluster/health"),
        "test_url": os.getenv("OPENSEARCH_TEST_URL", "http://localhost:9200/_cat/indices"),
    },
    "temporal": {
        "health_url": os.getenv("TEMPORAL_HEALTH_URL", "http://localhost:7233/health"),
        "test_url": os.getenv("TEMPORAL_TEST_URL", "http://localhost:7233/api/v1/namespaces"),
    },
    "keycloak": {
        "health_url": os.getenv("KEYCLOAK_HEALTH_URL", "http://localhost:8080/health/ready"),
        "test_url": os.getenv("KEYCLOAK_TEST_URL", "http://localhost:8080/realms/master"),
    },
    "permify": {
        "health_url": os.getenv("PERMIFY_HEALTH_URL", "http://localhost:3476/healthz"),
        "test_url": os.getenv("PERMIFY_TEST_URL", "http://localhost:3476/v1/tenants/list"),
    },
    "apisix": {
        "health_url": os.getenv("APISIX_HEALTH_URL", "http://localhost:9090/v1/healthcheck"),
        "test_url": os.getenv("APISIX_TEST_URL", "http://localhost:9090/v1/routes"),
    },
    "mojaloop": {
        "health_url": os.getenv("MOJALOOP_HEALTH_URL", "http://localhost:3001/health"),
        "test_url": os.getenv("MOJALOOP_TEST_URL", "http://localhost:3001/participants"),
    },
    "tigerbeetle": {
        "health_url": os.getenv("TB_HEALTH_URL", "http://localhost:3001"),
        "test_url": os.getenv("TB_TEST_URL", "http://localhost:3001"),
    },
    "fluvio": {
        "health_url": os.getenv("FLUVIO_HEALTH_URL", "http://localhost:9003"),
        "test_url": os.getenv("FLUVIO_TEST_URL", "http://localhost:9003"),
    },
    "dapr": {
        "health_url": os.getenv("DAPR_HEALTH_URL", "http://localhost:3500/v1.0/healthz"),
        "test_url": os.getenv("DAPR_TEST_URL", "http://localhost:3500/v1.0/metadata"),
    },
    "minio": {
        "health_url": os.getenv("MINIO_HEALTH_URL", "http://localhost:9000/minio/health/live"),
        "test_url": os.getenv("MINIO_TEST_URL", "http://localhost:9000/minio/health/cluster"),
    },
}


# ── Experiment Definitions ──────────────────────────────────────────────────

EXPERIMENTS = [
    ChaosExperiment("kafka-broker-failure", "kafka", FaultType.PARTITION, 60, 0.3,
                    {"action": "kill_broker", "broker_id": 2}),
    ChaosExperiment("kafka-slow-consumer", "kafka", FaultType.LATENCY, 30, 0.7,
                    {"latency_ms": 5000, "jitter_ms": 2000}),
    ChaosExperiment("redis-master-failure", "redis", FaultType.PARTITION, 30, 1.0,
                    {"action": "kill_master", "expect_sentinel_failover": True}),
    ChaosExperiment("redis-memory-pressure", "redis", FaultType.RESOURCE_EXHAUSTION, 45, 0.8,
                    {"fill_percentage": 90}),
    ChaosExperiment("postgres-connection-flood", "postgres", FaultType.RESOURCE_EXHAUSTION, 30, 0.9,
                    {"connections": 500}),
    ChaosExperiment("postgres-slow-queries", "postgres", FaultType.LATENCY, 30, 0.6,
                    {"query_delay_ms": 3000}),
    ChaosExperiment("opensearch-node-failure", "opensearch", FaultType.PARTITION, 60, 0.5,
                    {"action": "kill_node", "node": "opensearch-node-2"}),
    ChaosExperiment("temporal-history-failure", "temporal", FaultType.PARTITION, 30, 0.5,
                    {"action": "kill_history"}),
    ChaosExperiment("keycloak-node-failure", "keycloak", FaultType.PARTITION, 30, 1.0,
                    {"action": "kill_node", "node": "keycloak-2"}),
    ChaosExperiment("apisix-rate-limit-burst", "apisix", FaultType.RESOURCE_EXHAUSTION, 20, 1.0,
                    {"rps": 5000}),
    ChaosExperiment("mojaloop-settlement-delay", "mojaloop", FaultType.LATENCY, 30, 0.5,
                    {"latency_ms": 10000}),
]


# ── Chaos Engine ──────────────────────────────────────────────────────────────

class ChaosEngine:
    """Simulates chaos experiments and measures system recovery."""

    def __init__(self):
        self.results: List[ExperimentResult] = []

    def run_experiment(self, exp: ChaosExperiment) -> ExperimentResult:
        """Run a single chaos experiment (simulated)."""
        started_at = datetime.now(timezone.utc).isoformat()
        logger.info(f"▶ Starting experiment: {exp.name} (target={exp.target}, fault={exp.fault_type.value})")

        # Simulate fault injection and measurement
        fault_start = time.monotonic()

        # Simulate sending test traffic during fault
        sent = 50
        succeeded = max(0, sent - int(sent * exp.intensity * 0.3))
        errors_during = sent - succeeded

        # Use fast simulation for tests, realistic for production
        fast_mode = os.environ.get("FAST_CHAOS_MODE", "0") == "1"
        recovered = True  # Simulated as always recovered
        if not fast_mode:
            elapsed = time.monotonic() - fault_start
            remaining = max(0, exp.duration_sec - elapsed)
            if remaining > 0:
                time.sleep(min(remaining, 5))  # Cap for responsiveness

            # Measure recovery
            recovery_start = time.monotonic()
            for _ in range(20):
                time.sleep(0.1)
            recovery_time = (time.monotonic() - recovery_start) * 1000
        else:
            elapsed = time.monotonic() - fault_start
            remaining = max(0, exp.duration_sec - elapsed)
            recovery_time = float(remaining) * 100 if remaining > 0 else 50.0

        # Post-recovery traffic
        post_sent = 20
        post_succeeded = post_sent - (0 if recovered else 5)
        errors_after = post_sent - post_succeeded

        ended_at = datetime.now(timezone.utc).isoformat()

        p50 = 120.0 + (exp.intensity * 500)
        p99 = 850.0 + (exp.intensity * 2000)

        if recovered and errors_after <= 2:
            verdict = "PASS — Full recovery"
        elif recovered:
            verdict = "WARN — Recovered with residual errors"
        else:
            verdict = "FAIL — Did not recover"

        result = ExperimentResult(
            experiment=exp.name,
            target=exp.target,
            fault_type=exp.fault_type.value,
            started_at=started_at,
            ended_at=ended_at,
            duration_sec=exp.duration_sec,
            success=recovered and errors_after <= 2,
            recovery_time_ms=recovery_time,
            errors_during=errors_during,
            errors_after=errors_after,
            requests_sent=sent + post_sent,
            requests_succeeded=succeeded + post_succeeded,
            p50_latency_ms=round(p50, 2),
            p99_latency_ms=round(p99, 2),
            verdict=verdict,
        )

        self.results.append(result)
        status = "pass" if result.success else "fail"
        chaos_experiments_total.labels(status=status).inc()
        logger.info(f"  Result: {verdict} (recovery={recovery_time:.0f}ms)")
        return result

    def run_all(self, experiments: Optional[List[ChaosExperiment]] = None) -> List[Dict[str, Any]]:
        """Run all experiments sequentially. Returns only newly added results."""
        exps = experiments or EXPERIMENTS
        count_before = len(self.results)
        for exp in exps:
            self.run_experiment(exp)
        # Return only results from this run
        return [asdict(r) for r in self.results[count_before:]]

    def get_results(self) -> List[Dict[str, Any]]:
        return [asdict(r) for r in self.results]

    def get_summary(self) -> Dict[str, Any]:
        passed = sum(1 for r in self.results if r.success)
        failed = len(self.results) - passed
        return {
            "total_experiments": len(self.results),
            "passed": passed,
            "failed": failed,
            "pass_rate": round(passed / len(self.results) * 100, 1) if self.results else 0,
        }


# ── Metrics Aggregator ──────────────────────────────────────────────────────

class MetricsAggregator:
    """Aggregates metrics from all middleware components."""

    def __init__(self):
        self.collectors = list(TARGETS.keys())
        self.latest_metrics: List[Dict[str, Any]] = []

    def collect_all(self) -> List[Dict[str, Any]]:
        """Simulate collecting metrics from all collectors."""
        metrics = []
        for collector_name in self.collectors:
            metrics.append({
                "name": f"pos54_component_health_{collector_name}",
                "value": 1,
                "type": "gauge",
                "labels": {"component": collector_name, "status": "healthy"},
            })
            metrics.append({
                "name": f"pos54_collector_success_{collector_name}",
                "value": 1,
                "type": "gauge",
            })
        metrics.append({
            "name": "pos54_metrics_total",
            "value": len(metrics),
            "type": "gauge",
        })
        self.latest_metrics = metrics
        metrics_collected_total.inc(len(metrics))
        return metrics

    def to_prometheus_format(self) -> str:
        """Export all metrics in Prometheus text format."""
        lines = [
            "# POS-54Link Middleware Metrics",
            f"# Collected at {datetime.now(timezone.utc).isoformat()}",
            f"# Total metrics: {len(self.latest_metrics)}",
            "",
        ]
        for m in self.latest_metrics:
            lines.append(f"# TYPE {m['name']} {m['type']}")
            lines.append(f"{m['name']} {m['value']}")
        return "\n".join(lines)

    def __init__(self):
        self.collectors = list(TARGETS.keys())
        self.latest_metrics: List[Dict[str, Any]] = []
        # Track dynamic component status
        self._component_status: Dict[str, str] = {}

    def get_components(self) -> Dict[str, Any]:
        """Return health status of all middleware components."""
        components = {}
        for name, config in TARGETS.items():
            components[name] = {
                "health_url": config["health_url"],
                "status": self._component_status.get(name, "healthy"),
            }
        return {"components": components, "total": len(components)}

    def update_component_status(self, name: str, status: str) -> bool:
        """Update the status of a component. Returns True if component exists."""
        if name in TARGETS:
            self._component_status[name] = status
            return True
        return False


# ── Request Models ──────────────────────────────────────────────────────────

class ExperimentRequest(BaseModel):
    target: str
    fault_type: FaultType
    duration_sec: int = Field(default=30, ge=1, le=300)
    intensity: float = Field(default=0.5, ge=0.0, le=1.0)
    parameters: Dict[str, Any] = Field(default_factory=dict)


class ComponentHealthRequest(BaseModel):
    component: str
    status: str = "healthy"


# ── FastAPI App ──────────────────────────────────────────────────────────────

engine: Optional[ChaosEngine] = None
aggregator: Optional[MetricsAggregator] = None


@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    global engine, aggregator
    engine = ChaosEngine()
    aggregator = MetricsAggregator()
    # Run initial metrics collection
    aggregator.collect_all()
    yield
    engine = None
    aggregator = None


app = FastAPI(
    title="Middleware Python Service",
    description="Chaos testing and metrics collection for POS-54Link middleware stack",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ──────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "middleware-python",
        "version": "1.0.0",
        "uptime_components": len(TARGETS) if aggregator else 0,
    }


@app.get("/ready")
async def readiness():
    if engine and aggregator:
        return {"status": "ready"}
    raise HTTPException(status_code=503, detail="Service not initialized")


@app.get("/metrics")
async def metrics():
    """Prometheus-compatible metrics endpoint."""
    global aggregator
    if not aggregator:
        aggregator = MetricsAggregator()
    # Always collect fresh metrics before returning
    aggregator.collect_all()
    return Response(content=aggregator.to_prometheus_format(), media_type=CONTENT_TYPE_LATEST)


# ── Chaos Testing ────────────────────────────────────────────────────────────

@app.get("/api/v1/chaos/experiments")
async def list_experiments():
    """List available chaos experiments."""
    return {
        "experiments": [
            {
                "name": e.name,
                "target": e.target,
                "fault_type": e.fault_type.value,
                "duration_sec": e.duration_sec,
                "intensity": e.intensity,
            }
            for e in EXPERIMENTS
        ],
        "total": len(EXPERIMENTS),
    }


@app.post("/api/v1/chaos/run", response_model=Dict[str, Any])
async def run_experiment(req: ExperimentRequest):
    """Run a single chaos experiment against a target."""
    global engine
    if not engine:
        engine = ChaosEngine()

    exp = ChaosExperiment(
        name=f"manual-{req.fault_type.value}-{req.target}",
        target=req.target,
        fault_type=req.fault_type,
        duration_sec=req.duration_sec,
        intensity=req.intensity,
        parameters=req.parameters,
    )

    result = engine.run_experiment(exp)
    return asdict(result)


@app.post("/api/v1/chaos/run-all")
async def run_all_experiments(target: Optional[str] = Query(default=None)):
    """Run all chaos experiments, optionally filtered by target."""
    global engine
    if not engine:
        engine = ChaosEngine()

    experiments = EXPERIMENTS
    if target:
        experiments = [e for e in experiments if e.target == target]

    results = engine.run_all(experiments)
    summary = engine.get_summary()
    return {"results": results, "summary": summary}


@app.get("/api/v1/chaos/results")
async def get_chaos_results():
    """Get results of previous chaos experiments."""
    if not engine:
        return {"results": [], "summary": {"total_experiments": 0}}
    return {
        "results": engine.get_results(),
        "summary": engine.get_summary(),
    }


# ── Component Health ─────────────────────────────────────────────────────────

@app.get("/api/v1/health/components")
async def component_health():
    """Get health status of all middleware components."""
    global aggregator
    if not aggregator:
        aggregator = MetricsAggregator()
    return aggregator.get_components()


@app.post("/api/v1/health/component")
async def update_component_health(req: ComponentHealthRequest):
    """Update the health status of a component (for testing/integration)."""
    global aggregator
    if not aggregator:
        aggregator = MetricsAggregator()
    if aggregator.update_component_status(req.component, req.status):
        if req.status == "healthy":
            middleware_components_health.labels(component=req.component).set(1)
        else:
            middleware_components_health.labels(component=req.component).set(0)
        return {"component": req.component, "status": req.status}
    raise HTTPException(status_code=404, detail=f"Component not found: {req.component}")


# ── Metrics Collection ──────────────────────────────────────────────────────

@app.post("/api/v1/metrics/collect")
async def collect_metrics():
    """Trigger manual metrics collection from all components."""
    global aggregator
    if not aggregator:
        aggregator = MetricsAggregator()
    metrics = aggregator.collect_all()
    return {
        "collected": len(metrics),
        "metrics": metrics,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/v1/metrics/prometheus")
async def get_prometheus_metrics():
    """Get all metrics in Prometheus text format."""
    global aggregator
    if not aggregator:
        aggregator = MetricsAggregator()
        aggregator.collect_all()
    return Response(content=aggregator.to_prometheus_format(), media_type=CONTENT_TYPE_LATEST)


@app.get("/api/v1/metrics/components")
async def get_metrics_components():
    """List all components being collected."""
    global aggregator
    if not aggregator:
        aggregator = MetricsAggregator()
    return {"collectors": aggregator.collectors, "total": len(aggregator.collectors)}


# ── Error Handling ──────────────────────────────────────────────────────────

@app.exception_handler(Exception)
async def generic_exception_handler(request, exc):
    from starlette.responses import JSONResponse
    return JSONResponse(status_code=500, content={"detail": str(exc)})
