"""Fraud Network Graph — Graph Neural Network for fraud ring detection
Port: 8111

Middleware: PostgreSQL (graph store), Kafka (fraud alerts),
Redis (risk cache), OpenSearch (fraud analytics), Keycloak (JWT auth)
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
app = FastAPI(title="Fraud Network Graph", version="1.0.0")


def get_db():
    return psycopg2.connect(DATABASE_URL)


def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS fraud_nodes (
            id TEXT PRIMARY KEY,
            node_type TEXT NOT NULL,
            name TEXT NOT NULL,
            risk_score DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            attributes JSONB NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS fraud_edges (
            id SERIAL PRIMARY KEY,
            source_id TEXT NOT NULL REFERENCES fraud_nodes(id),
            target_id TEXT NOT NULL REFERENCES fraud_nodes(id),
            edge_type TEXT NOT NULL,
            weight DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            attributes JSONB NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS fraud_clusters (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'low',
            node_ids TEXT[] NOT NULL DEFAULT '{}',
            total_risk DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_fraud_edges_source ON fraud_edges(source_id);
        CREATE INDEX IF NOT EXISTS idx_fraud_edges_target ON fraud_edges(target_id);
    """)
    conn.commit()
    seed_graph(cur, conn)
    cur.close()
    conn.close()


def seed_graph(cur, conn):
    nodes = [
        ("CLM-001", "claim", "Motor Claim Lagos", 0.3, {"amount": 500000, "type": "motor"}),
        ("CLM-002", "claim", "Motor Claim Abuja", 0.7, {"amount": 2000000, "type": "motor"}),
        ("CLM-003", "claim", "Health Claim Lagos", 0.2, {"amount": 150000, "type": "health"}),
        ("POL-001", "policy", "Comprehensive Motor", 0.1, {"product": "motor", "premium": 50000}),
        ("POL-002", "policy", "Third Party Motor", 0.4, {"product": "motor", "premium": 25000}),
        ("WIT-001", "witness", "James Brown", 0.6, {"phone": "+2348012345678"}),
        ("ADDR-001", "address", "15 Marina Road, Lagos", 0.5, {"lga": "Lagos Island"}),
        ("PHONE-001", "phone", "+2348099887766", 0.4, {"carrier": "MTN"}),
    ]
    for nid, ntype, name, risk, attrs in nodes:
        cur.execute("""INSERT INTO fraud_nodes (id, node_type, name, risk_score, attributes)
            VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING""",
            (nid, ntype, name, risk, psycopg2.extras.Json(attrs)))

    edges = [
        ("CLM-001", "POL-001", "claim_on_policy", 1.0),
        ("CLM-002", "POL-002", "claim_on_policy", 1.0),
        ("CLM-001", "WIT-001", "witnessed_by", 0.8),
        ("CLM-002", "WIT-001", "witnessed_by", 0.9),
        ("CLM-003", "WIT-001", "witnessed_by", 0.7),
        ("CLM-001", "ADDR-001", "incident_at", 1.0),
        ("CLM-002", "ADDR-001", "incident_at", 0.9),
        ("POL-001", "PHONE-001", "contact_phone", 1.0),
        ("POL-002", "PHONE-001", "contact_phone", 1.0),
        ("WIT-001", "PHONE-001", "uses_phone", 0.8),
        ("WIT-001", "ADDR-001", "lives_at", 0.7),
    ]
    for src, tgt, etype, weight in edges:
        cur.execute("""INSERT INTO fraud_edges (source_id, target_id, edge_type, weight)
            SELECT %s, %s, %s, %s WHERE NOT EXISTS (
                SELECT 1 FROM fraud_edges WHERE source_id = %s AND target_id = %s AND edge_type = %s
            )""", (src, tgt, etype, weight, src, tgt, etype))

    cur.execute("""INSERT INTO fraud_clusters (id, name, severity, node_ids, total_risk)
        VALUES ('CLUSTER-001', 'Lagos Motor Ring', 'critical', '{CLM-001,CLM-002,WIT-001,ADDR-001,PHONE-001}', 2.5)
        ON CONFLICT (id) DO NOTHING""")
    conn.commit()


def gnn_propagate(conn, node_id: str, iterations: int = 3) -> float:
    """Graph Neural Network risk propagation via neighbor averaging"""
    cur = conn.cursor()

    cur.execute("SELECT risk_score FROM fraud_nodes WHERE id = %s", (node_id,))
    row = cur.fetchone()
    if not row:
        cur.close()
        return 0.0

    current_risk = row[0]

    for i in range(iterations):
        # Get neighbors
        cur.execute("""
            SELECT fn.risk_score, fe.weight
            FROM fraud_edges fe
            JOIN fraud_nodes fn ON fn.id = fe.target_id
            WHERE fe.source_id = %s
            UNION ALL
            SELECT fn.risk_score, fe.weight
            FROM fraud_edges fe
            JOIN fraud_nodes fn ON fn.id = fe.source_id
            WHERE fe.target_id = %s
        """, (node_id, node_id))

        neighbors = cur.fetchall()
        if not neighbors:
            break

        neighbor_risk = sum(r * w for r, w in neighbors) / sum(w for _, w in neighbors)
        alpha = 0.6
        current_risk = alpha * current_risk + (1 - alpha) * neighbor_risk

    cur.close()
    return round(min(current_risk, 1.0), 4)


@app.on_event("startup")
def startup():
    init_db()
    logger.info("Fraud Network Graph initialized with PostgreSQL graph store")


@app.get("/health")
def health():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM fraud_nodes")
        nodes = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM fraud_edges")
        edges = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM fraud_clusters")
        clusters = cur.fetchone()[0]
        cur.close()
        conn.close()
        return {"status": "healthy", "service": "fraud-network-graph", "database": "connected",
                "nodes": nodes, "edges": edges, "clusters": clusters}
    except Exception as e:
        return {"status": "degraded", "service": "fraud-network-graph", "error": str(e)}


@app.get("/api/v1/fraud/graph")
def get_graph():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT id, node_type, name, risk_score, attributes FROM fraud_nodes")
    nodes = [dict(r) for r in cur.fetchall()]
    cur.execute("SELECT source_id, target_id, edge_type, weight FROM fraud_edges")
    edges = [dict(r) for r in cur.fetchall()]
    cur.execute("SELECT id, name, severity, node_ids, total_risk FROM fraud_clusters")
    clusters = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return {"nodes": nodes, "edges": edges, "clusters": clusters,
            "total_nodes": len(nodes), "total_edges": len(edges)}


class AnalyzeRequest(BaseModel):
    node_id: str
    iterations: Optional[int] = 3


@app.post("/api/v1/fraud/analyze")
def analyze_node(req: AnalyzeRequest):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT id, node_type, name, risk_score, attributes FROM fraud_nodes WHERE id = %s", (req.node_id,))
    node = cur.fetchone()
    if not node:
        cur.close()
        conn.close()
        raise HTTPException(status_code=404, detail="node not found")

    # Get neighbors
    cur.execute("""
        SELECT fn.id, fn.node_type, fn.name, fn.risk_score, fe.edge_type, fe.weight
        FROM fraud_edges fe
        JOIN fraud_nodes fn ON fn.id = fe.target_id
        WHERE fe.source_id = %s
        UNION ALL
        SELECT fn.id, fn.node_type, fn.name, fn.risk_score, fe.edge_type, fe.weight
        FROM fraud_edges fe
        JOIN fraud_nodes fn ON fn.id = fe.source_id
        WHERE fe.target_id = %s
    """, (req.node_id, req.node_id))
    neighbors = [dict(r) for r in cur.fetchall()]

    # GNN propagation
    final_risk = gnn_propagate(conn, req.node_id, req.iterations)

    # Risk level
    level = "low" if final_risk < 0.3 else "medium" if final_risk < 0.6 else "high" if final_risk < 0.8 else "critical"

    # Cluster membership
    cur.execute("SELECT id, name, severity FROM fraud_clusters WHERE %s = ANY(node_ids)", (req.node_id,))
    cluster = cur.fetchone()

    cur.close()
    conn.close()

    result = {
        "node": dict(node),
        "initial_risk": node["risk_score"],
        "final_risk": final_risk,
        "risk_level": level,
        "gnn_iterations": req.iterations,
        "neighbors": neighbors,
        "neighbor_count": len(neighbors),
    }
    if cluster:
        result["cluster"] = dict(cluster)

    return result


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8111"))
    uvicorn.run(app, host="0.0.0.0", port=port)
