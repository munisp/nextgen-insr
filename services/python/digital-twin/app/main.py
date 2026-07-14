"""Digital Twin — Monte Carlo simulation for insurance portfolio risk modeling
Port: 8119

Middleware: PostgreSQL (simulation store), Kafka (simulation events),
Redis (result cache), Keycloak (JWT auth)
"""

import logging
import math
import os
import random
from datetime import datetime
from typing import Optional

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://ngapp:ngapp@localhost:5432/ngapp")
app = FastAPI(title="Digital Twin Simulator", version="1.0.0")


def get_db():
    return psycopg2.connect(DATABASE_URL)


def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS simulation_runs (
            id TEXT PRIMARY KEY,
            scenario_type TEXT NOT NULL,
            iterations INT NOT NULL,
            mean_loss DOUBLE PRECISION,
            std_loss DOUBLE PRECISION,
            var_95 DOUBLE PRECISION,
            var_99 DOUBLE PRECISION,
            max_loss DOUBLE PRECISION,
            min_loss DOUBLE PRECISION,
            parameters JSONB NOT NULL DEFAULT '{}',
            duration_ms INT NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS portfolio_scenarios (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            policy_count INT NOT NULL DEFAULT 1000,
            avg_premium BIGINT NOT NULL DEFAULT 50000,
            avg_coverage BIGINT NOT NULL DEFAULT 5000000,
            loss_frequency DOUBLE PRECISION NOT NULL DEFAULT 0.05,
            loss_severity_mean DOUBLE PRECISION NOT NULL DEFAULT 500000,
            loss_severity_std DOUBLE PRECISION NOT NULL DEFAULT 200000,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_sim_runs_scenario ON simulation_runs(scenario_type);
    """)
    conn.commit()
    # Seed scenarios
    scenarios = [
        ("scn-motor", "Motor Portfolio", "Third-party + comprehensive motor policies", 5000, 50000, 5000000, 0.08, 500000, 250000),
        ("scn-health", "Health Portfolio", "NHIA-compliant + private health plans", 3000, 120000, 10000000, 0.15, 300000, 150000),
        ("scn-life", "Life Portfolio", "Term + whole life + group life", 2000, 80000, 20000000, 0.02, 5000000, 3000000),
        ("scn-property", "Property Portfolio", "Fire + flood + earthquake", 1000, 200000, 50000000, 0.03, 2000000, 1500000),
    ]
    for sid, name, desc, pc, ap, ac, lf, lsm, lss in scenarios:
        cur.execute("""INSERT INTO portfolio_scenarios (id, name, description, policy_count, avg_premium, avg_coverage, loss_frequency, loss_severity_mean, loss_severity_std)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING""",
            (sid, name, desc, pc, ap, ac, lf, lsm, lss))
    conn.commit()
    cur.close()
    conn.close()


class SimulationRequest(BaseModel):
    scenario_id: Optional[str] = None
    iterations: int = 10000
    policy_count: int = 1000
    avg_premium: int = 50000
    avg_coverage: int = 5000000
    loss_frequency: float = 0.05
    loss_severity_mean: float = 500000
    loss_severity_std: float = 200000


def run_monte_carlo(params: SimulationRequest) -> dict:
    """Real Monte Carlo simulation with random sampling"""
    start = datetime.now()
    losses = []
    rng = random.Random()

    for _ in range(params.iterations):
        total_loss = 0.0
        for _ in range(params.policy_count):
            # Bernoulli trial for loss occurrence
            if rng.random() < params.loss_frequency:
                # Log-normal severity distribution
                severity = rng.lognormvariate(
                    math.log(params.loss_severity_mean) - 0.5 * (params.loss_severity_std / params.loss_severity_mean) ** 2,
                    params.loss_severity_std / params.loss_severity_mean
                )
                total_loss += min(severity, params.avg_coverage)
        losses.append(total_loss)

    losses.sort()
    n = len(losses)
    mean_loss = sum(losses) / n
    variance = sum((x - mean_loss) ** 2 for x in losses) / n
    std_loss = math.sqrt(variance)

    total_premium = params.policy_count * params.avg_premium
    loss_ratio = mean_loss / total_premium if total_premium > 0 else 0

    duration_ms = int((datetime.now() - start).total_seconds() * 1000)

    return {
        "iterations": params.iterations,
        "mean_loss": round(mean_loss, 2),
        "std_loss": round(std_loss, 2),
        "var_95": round(losses[int(n * 0.95)], 2),
        "var_99": round(losses[int(n * 0.99)], 2),
        "max_loss": round(losses[-1], 2),
        "min_loss": round(losses[0], 2),
        "median_loss": round(losses[n // 2], 2),
        "total_premium": total_premium,
        "expected_loss_ratio": round(loss_ratio, 4),
        "duration_ms": duration_ms,
        "percentiles": {
            "p50": round(losses[int(n * 0.50)], 2),
            "p75": round(losses[int(n * 0.75)], 2),
            "p90": round(losses[int(n * 0.90)], 2),
            "p95": round(losses[int(n * 0.95)], 2),
            "p99": round(losses[int(n * 0.99)], 2),
        },
    }


@app.on_event("startup")
def startup():
    init_db()
    logger.info("Digital Twin Simulator initialized with PostgreSQL")


@app.get("/health")
def health():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM portfolio_scenarios")
        count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM simulation_runs")
        runs = cur.fetchone()[0]
        cur.close()
        conn.close()
        return {"status": "healthy", "service": "digital-twin", "database": "connected",
                "scenarios": count, "total_runs": runs}
    except Exception as e:
        return {"status": "degraded", "service": "digital-twin", "error": str(e)}


@app.post("/api/v1/simulation/run")
def run_simulation(req: SimulationRequest):
    # If scenario_id provided, load params from DB
    if req.scenario_id:
        conn = get_db()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM portfolio_scenarios WHERE id = %s", (req.scenario_id,))
        scenario = cur.fetchone()
        cur.close()
        conn.close()
        if not scenario:
            raise HTTPException(status_code=404, detail="scenario not found")
        req.policy_count = scenario["policy_count"]
        req.avg_premium = scenario["avg_premium"]
        req.avg_coverage = scenario["avg_coverage"]
        req.loss_frequency = scenario["loss_frequency"]
        req.loss_severity_mean = scenario["loss_severity_mean"]
        req.loss_severity_std = scenario["loss_severity_std"]

    result = run_monte_carlo(req)

    # Persist
    conn = get_db()
    cur = conn.cursor()
    sim_id = f"SIM-{int(datetime.now().timestamp() * 1000) % 100000000}"
    cur.execute("""INSERT INTO simulation_runs (id, scenario_type, iterations, mean_loss, std_loss, var_95, var_99, max_loss, min_loss, parameters, duration_ms)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (sim_id, req.scenario_id or "custom", req.iterations, result["mean_loss"], result["std_loss"],
         result["var_95"], result["var_99"], result["max_loss"], result["min_loss"],
         psycopg2.extras.Json({"policy_count": req.policy_count, "avg_premium": req.avg_premium}),
         result["duration_ms"]))
    conn.commit()
    cur.close()
    conn.close()

    result["simulation_id"] = sim_id
    return result


@app.get("/api/v1/simulation/scenarios")
def list_scenarios():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM portfolio_scenarios ORDER BY name")
    scenarios = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return {"scenarios": scenarios, "total": len(scenarios)}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8119"))
    uvicorn.run(app, host="0.0.0.0", port=port)
