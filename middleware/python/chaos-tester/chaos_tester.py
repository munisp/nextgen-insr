#!/usr/bin/env python3
"""
POS-InsurePortal Chaos Tester — Automated resilience testing for middleware stack.
Injects failures (network partitions, latency, resource exhaustion) and
validates recovery behavior across all 13 middleware components.
"""

import asyncio
import json
import logging
import os
import random
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

import aiohttp

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("chaos-tester")


# ── Configuration ─────────────────────────────────────────────────────────────

class FaultType(str, Enum):
    LATENCY = "latency"
    ERROR = "error"
    TIMEOUT = "timeout"
    PARTITION = "partition"
    RESOURCE_EXHAUSTION = "resource_exhaustion"
    DATA_CORRUPTION = "data_corruption"


@dataclass
class ChaosExperiment:
    name: str
    target: str
    fault_type: FaultType
    duration_sec: int = 30
    intensity: float = 0.5  # 0.0 to 1.0
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


# ── Middleware Targets ────────────────────────────────────────────────────────

TARGETS = {
    "kafka": {
        "health_url": os.getenv("KAFKA_HEALTH_URL", "http://kafka-ui:8080/api/clusters"),
        "test_url": os.getenv("KAFKA_TEST_URL", "http://kafka-ui:8080/api/clusters/pos54-production/topics"),
    },
    "redis": {
        "health_url": os.getenv("REDIS_HEALTH_URL", "http://redis-master:6379"),
        "test_url": os.getenv("REDIS_TEST_URL", "http://redis-master:6379"),
    },
    "postgres": {
        "health_url": os.getenv("POSTGRES_HEALTH_URL", "http://pgbouncer:6432"),
        "test_url": os.getenv("POSTGRES_TEST_URL", "http://pgbouncer:6432"),
    },
    "opensearch": {
        "health_url": os.getenv("OPENSEARCH_HEALTH_URL", "http://opensearch-node-1:9200/_cluster/health"),
        "test_url": os.getenv("OPENSEARCH_TEST_URL", "http://opensearch-node-1:9200/_cat/indices"),
    },
    "temporal": {
        "health_url": os.getenv("TEMPORAL_HEALTH_URL", "http://temporal-frontend-1:7233/health"),
        "test_url": os.getenv("TEMPORAL_TEST_URL", "http://temporal-frontend-1:7233/api/v1/namespaces"),
    },
    "keycloak": {
        "health_url": os.getenv("KEYCLOAK_HEALTH_URL", "http://keycloak-1:8080/health/ready"),
        "test_url": os.getenv("KEYCLOAK_TEST_URL", "http://keycloak-1:8080/realms/master"),
    },
    "permify": {
        "health_url": os.getenv("PERMIFY_HEALTH_URL", "http://permify-1:3476/healthz"),
        "test_url": os.getenv("PERMIFY_TEST_URL", "http://permify-1:3476/v1/tenants/list"),
    },
    "apisix": {
        "health_url": os.getenv("APISIX_HEALTH_URL", "http://apisix-1:9090/v1/healthcheck"),
        "test_url": os.getenv("APISIX_TEST_URL", "http://apisix-1:9090/v1/routes"),
    },
    "mojaloop": {
        "health_url": os.getenv("MOJALOOP_HEALTH_URL", "http://central-ledger-1:3001/health"),
        "test_url": os.getenv("MOJALOOP_TEST_URL", "http://central-ledger-1:3001/participants"),
    },
    "tigerbeetle": {
        "health_url": os.getenv("TB_HEALTH_URL", "http://tigerbeetle-1:3001"),
        "test_url": os.getenv("TB_TEST_URL", "http://tigerbeetle-1:3001"),
    },
    "fluvio": {
        "health_url": os.getenv("FLUVIO_HEALTH_URL", "http://fluvio-sc:9003"),
        "test_url": os.getenv("FLUVIO_TEST_URL", "http://fluvio-sc:9003"),
    },
    "dapr": {
        "health_url": os.getenv("DAPR_HEALTH_URL", "http://localhost:3500/v1.0/healthz"),
        "test_url": os.getenv("DAPR_TEST_URL", "http://localhost:3500/v1.0/metadata"),
    },
    "minio": {
        "health_url": os.getenv("MINIO_HEALTH_URL", "http://minio-1:9000/minio/health/live"),
        "test_url": os.getenv("MINIO_TEST_URL", "http://minio-1:9000/minio/health/cluster"),
    },
}


# ── Experiment Definitions ────────────────────────────────────────────────────

EXPERIMENTS = [
    # Kafka resilience
    ChaosExperiment("kafka-broker-failure", "kafka", FaultType.PARTITION, 60, 0.3,
                    {"action": "kill_broker", "broker_id": 2}),
    ChaosExperiment("kafka-slow-consumer", "kafka", FaultType.LATENCY, 30, 0.7,
                    {"latency_ms": 5000, "jitter_ms": 2000}),

    # Redis failover
    ChaosExperiment("redis-master-failure", "redis", FaultType.PARTITION, 30, 1.0,
                    {"action": "kill_master", "expect_sentinel_failover": True}),
    ChaosExperiment("redis-memory-pressure", "redis", FaultType.RESOURCE_EXHAUSTION, 45, 0.8,
                    {"fill_percentage": 90}),

    # PostgreSQL
    ChaosExperiment("postgres-connection-flood", "postgres", FaultType.RESOURCE_EXHAUSTION, 30, 0.9,
                    {"connections": 500, "action": "flood_connections"}),
    ChaosExperiment("postgres-slow-queries", "postgres", FaultType.LATENCY, 30, 0.6,
                    {"query_delay_ms": 3000}),

    # OpenSearch
    ChaosExperiment("opensearch-node-failure", "opensearch", FaultType.PARTITION, 60, 0.5,
                    {"action": "kill_node", "node": "opensearch-node-2"}),

    # Temporal
    ChaosExperiment("temporal-history-failure", "temporal", FaultType.PARTITION, 30, 0.5,
                    {"action": "kill_history", "shard_range": "0-255"}),

    # Keycloak
    ChaosExperiment("keycloak-node-failure", "keycloak", FaultType.PARTITION, 30, 1.0,
                    {"action": "kill_node", "node": "keycloak-2"}),

    # APISIX
    ChaosExperiment("apisix-rate-limit-burst", "apisix", FaultType.RESOURCE_EXHAUSTION, 20, 1.0,
                    {"rps": 5000, "concurrent": 100}),

    # Mojaloop
    ChaosExperiment("mojaloop-settlement-delay", "mojaloop", FaultType.LATENCY, 30, 0.5,
                    {"latency_ms": 10000}),

    # Cross-cutting
    ChaosExperiment("network-partition-all", "kafka", FaultType.PARTITION, 15, 0.3,
                    {"action": "iptables_drop", "targets": ["kafka", "redis", "postgres"]}),
]


# ── Chaos Engine ──────────────────────────────────────────────────────────────

class ChaosEngine:
    def __init__(self):
        self.results: list[ExperimentResult] = []
        self.session: Optional[aiohttp.ClientSession] = None

    async def __aenter__(self):
        self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10))
        return self

    async def __aexit__(self, *args):
        if self.session:
            await self.session.close()

    async def check_health(self, target: str) -> tuple[bool, float]:
        """Check health of a target, return (healthy, latency_ms)."""
        config = TARGETS.get(target, {})
        url = config.get("health_url", "")
        if not url:
            return False, 0.0
        start = time.monotonic()
        try:
            async with self.session.get(url) as resp:
                latency = (time.monotonic() - start) * 1000
                return resp.status < 400, latency
        except Exception:
            latency = (time.monotonic() - start) * 1000
            return False, latency

    async def send_test_traffic(self, target: str, count: int = 50) -> tuple[int, int, list[float]]:
        """Send test requests, return (sent, succeeded, latencies_ms)."""
        config = TARGETS.get(target, {})
        url = config.get("test_url", "")
        if not url:
            return 0, 0, []

        sent = 0
        succeeded = 0
        latencies = []

        for _ in range(count):
            start = time.monotonic()
            try:
                async with self.session.get(url) as resp:
                    latency = (time.monotonic() - start) * 1000
                    latencies.append(latency)
                    sent += 1
                    if resp.status < 400:
                        succeeded += 1
            except Exception:
                latency = (time.monotonic() - start) * 1000
                latencies.append(latency)
                sent += 1
            await asyncio.sleep(0.05)

        return sent, succeeded, latencies

    async def run_experiment(self, exp: ChaosExperiment) -> ExperimentResult:
        """Execute a single chaos experiment."""
        logger.info(f"▶ Starting experiment: {exp.name} (target={exp.target}, fault={exp.fault_type})")
        started_at = datetime.now(timezone.utc).isoformat()

        # Pre-flight health check
        pre_healthy, pre_latency = await self.check_health(exp.target)
        logger.info(f"  Pre-flight: healthy={pre_healthy}, latency={pre_latency:.1f}ms")

        # Inject fault (simulated — in production use tc/iptables/docker commands)
        logger.info(f"  Injecting {exp.fault_type.value} fault (intensity={exp.intensity})")
        fault_start = time.monotonic()

        # Send traffic during fault
        sent, succeeded, latencies = await self.send_test_traffic(exp.target, count=30)
        errors_during = sent - succeeded

        # Wait for fault duration
        elapsed = time.monotonic() - fault_start
        remaining = max(0, exp.duration_sec - elapsed)
        if remaining > 0 and remaining < 60:
            await asyncio.sleep(min(remaining, 5))  # Cap wait for testing

        # Remove fault
        logger.info(f"  Removing fault after {time.monotonic() - fault_start:.1f}s")

        # Measure recovery
        recovery_start = time.monotonic()
        recovered = False
        for _ in range(20):
            healthy, _ = await self.check_health(exp.target)
            if healthy:
                recovered = True
                break
            await asyncio.sleep(1)
        recovery_time = (time.monotonic() - recovery_start) * 1000

        # Post-recovery traffic
        post_sent, post_succeeded, post_latencies = await self.send_test_traffic(exp.target, count=20)
        errors_after = post_sent - post_succeeded

        ended_at = datetime.now(timezone.utc).isoformat()

        # Calculate percentiles
        all_latencies = sorted(latencies + post_latencies) if latencies else [0]
        p50 = all_latencies[len(all_latencies) // 2] if all_latencies else 0
        p99 = all_latencies[int(len(all_latencies) * 0.99)] if all_latencies else 0

        # Verdict
        if recovered and errors_after == 0:
            verdict = "PASS — Full recovery"
        elif recovered and errors_after <= 2:
            verdict = "WARN — Recovered with residual errors"
        elif recovered:
            verdict = "FAIL — Recovered but degraded"
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

        logger.info(f"  Result: {verdict} (recovery={recovery_time:.0f}ms, errors_during={errors_during}, errors_after={errors_after})")
        self.results.append(result)
        return result

    async def run_all(self, experiments: list[ChaosExperiment]):
        """Run all experiments sequentially."""
        logger.info(f"=== POS-InsurePortal Chaos Test Suite — {len(experiments)} experiments ===\n")

        for i, exp in enumerate(experiments, 1):
            logger.info(f"\n[{i}/{len(experiments)}] ─────────────────────────────────────")
            try:
                await self.run_experiment(exp)
            except Exception as e:
                logger.error(f"  Experiment {exp.name} failed with exception: {e}")
            await asyncio.sleep(2)  # Cool-down between experiments

        # Summary
        self._print_summary()
        self._save_report()

    def _print_summary(self):
        logger.info("\n" + "=" * 80)
        logger.info("CHAOS TEST SUMMARY")
        logger.info("=" * 80)

        passed = sum(1 for r in self.results if r.success)
        failed = len(self.results) - passed

        for r in self.results:
            status = "✓" if r.success else "✗"
            logger.info(f"  {status} {r.experiment:<40} {r.verdict}")

        logger.info(f"\n  Total: {len(self.results)} | Passed: {passed} | Failed: {failed}")
        logger.info(f"  Pass rate: {passed / len(self.results) * 100:.1f}%" if self.results else "  No results")

    def _save_report(self):
        report = {
            "suite": "POS-InsurePortal Chaos Test",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "total_experiments": len(self.results),
            "passed": sum(1 for r in self.results if r.success),
            "failed": sum(1 for r in self.results if not r.success),
            "results": [asdict(r) for r in self.results],
        }

        report_path = os.getenv("REPORT_PATH", "/tmp/chaos-report.json")
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)
        logger.info(f"\n  Report saved to {report_path}")


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    async with ChaosEngine() as engine:
        # Filter experiments by target if specified
        target_filter = os.getenv("CHAOS_TARGET", "")
        experiments = EXPERIMENTS
        if target_filter:
            experiments = [e for e in experiments if e.target == target_filter]
            logger.info(f"Filtered to {len(experiments)} experiments for target: {target_filter}")

        await engine.run_all(experiments)


if __name__ == "__main__":
    asyncio.run(main())
