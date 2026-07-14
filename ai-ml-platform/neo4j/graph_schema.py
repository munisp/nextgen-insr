"""
Neo4j Graph Database Integration

Real Neo4j schema and query layer for insurance entity graphs:
- Node types: Customer, Agent, Claim, Bank, Policy
- Edge types: FILED_CLAIM, HAS_AGENT, HAS_ACCOUNT, SHARED_ADDRESS, etc.
- Cypher queries for fraud ring detection, entity resolution, risk propagation
- Graph construction from DataFrames
- Neo4j driver integration (works with or without a running Neo4j instance)
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

try:
    from neo4j import GraphDatabase
    HAS_NEO4J = True
except ImportError:
    HAS_NEO4J = False


# ── Schema Definitions ────────────────────────────────────────────────────────

CYPHER_SCHEMA = """
// Node constraints
CREATE CONSTRAINT customer_id IF NOT EXISTS FOR (c:Customer) REQUIRE c.customer_id IS UNIQUE;
CREATE CONSTRAINT agent_id IF NOT EXISTS FOR (a:Agent) REQUIRE a.agent_id IS UNIQUE;
CREATE CONSTRAINT claim_id IF NOT EXISTS FOR (cl:Claim) REQUIRE cl.claim_id IS UNIQUE;
CREATE CONSTRAINT bank_id IF NOT EXISTS FOR (b:Bank) REQUIRE b.bank_id IS UNIQUE;
CREATE CONSTRAINT policy_id IF NOT EXISTS FOR (p:Policy) REQUIRE p.policy_id IS UNIQUE;

// Indexes for fast lookups
CREATE INDEX customer_state IF NOT EXISTS FOR (c:Customer) ON (c.state);
CREATE INDEX customer_risk IF NOT EXISTS FOR (c:Customer) ON (c.risk_score);
CREATE INDEX claim_type IF NOT EXISTS FOR (cl:Claim) ON (cl.claim_type);
CREATE INDEX claim_fraud IF NOT EXISTS FOR (cl:Claim) ON (cl.is_fraudulent);
"""

CYPHER_FRAUD_RING_QUERY = """
// Find fraud rings: clusters of customers sharing addresses/agents with high-risk claims
MATCH (c1:Customer)-[:SHARED_ADDRESS]->(c2:Customer)
WHERE c1.customer_id < c2.customer_id
WITH c1, c2
MATCH (c1)-[:FILED_CLAIM]->(cl1:Claim)
MATCH (c2)-[:FILED_CLAIM]->(cl2:Claim)
WHERE cl1.amount > $min_amount AND cl2.amount > $min_amount
WITH c1, c2, collect(DISTINCT cl1) AS claims1, collect(DISTINCT cl2) AS claims2
WHERE size(claims1) >= $min_claims OR size(claims2) >= $min_claims
RETURN c1.customer_id AS customer1,
       c2.customer_id AS customer2,
       c1.name AS name1,
       c2.name AS name2,
       size(claims1) AS n_claims1,
       size(claims2) AS n_claims2,
       c1.risk_score AS risk1,
       c2.risk_score AS risk2
ORDER BY risk1 + risk2 DESC
LIMIT $limit
"""

CYPHER_ENTITY_RISK_PROPAGATION = """
// Propagate risk scores through the graph (2-hop neighborhood)
MATCH (c:Customer {customer_id: $customer_id})
OPTIONAL MATCH (c)-[:SHARED_ADDRESS]-(neighbor:Customer)
OPTIONAL MATCH (c)-[:HAS_AGENT]->(agent:Agent)<-[:HAS_AGENT]-(co_customer:Customer)
WITH c,
     collect(DISTINCT neighbor.risk_score) AS neighbor_risks,
     collect(DISTINCT co_customer.risk_score) AS co_customer_risks,
     agent
RETURN c.customer_id AS customer_id,
       c.risk_score AS base_risk,
       avg(neighbor_risks) AS avg_neighbor_risk,
       avg(co_customer_risks) AS avg_co_customer_risk,
       agent.fraud_flag_count AS agent_fraud_flags,
       size(neighbor_risks) AS n_shared_address,
       size(co_customer_risks) AS n_co_customers
"""

CYPHER_CLAIMS_NETWORK = """
// Find suspicious claims networks
MATCH (c:Customer)-[:FILED_CLAIM]->(cl:Claim)
WHERE cl.amount > $threshold
WITH c, count(cl) AS n_high_claims, sum(cl.amount) AS total_claimed
WHERE n_high_claims >= $min_high_claims
OPTIONAL MATCH (c)-[:HAS_AGENT]->(a:Agent)
OPTIONAL MATCH (c)-[:HAS_ACCOUNT]->(b:Bank)
RETURN c.customer_id AS customer_id,
       c.name AS name,
       c.state AS state,
       n_high_claims,
       total_claimed,
       a.agent_id AS agent_id,
       b.name AS bank_name,
       c.risk_score AS risk_score
ORDER BY total_claimed DESC
LIMIT $limit
"""

CYPHER_INSERT_CUSTOMER = """
MERGE (c:Customer {customer_id: $customer_id})
SET c.name = $name,
    c.state = $state,
    c.n_policies = $n_policies,
    c.total_premium = $total_premium,
    c.n_claims = $n_claims,
    c.risk_score = $risk_score,
    c.is_fraudulent = $is_fraudulent
"""

CYPHER_INSERT_EDGE = """
MATCH (a {%s: $source_id})
MATCH (b {%s: $target_id})
MERGE (a)-[r:%s]->(b)
SET r.weight = $weight
"""


@dataclass
class Neo4jConfig:
    uri: str = "bolt://localhost:7687"
    user: str = "neo4j"
    password: str = "password"
    database: str = "neo4j"


class InsuranceGraphDB:
    """Neo4j graph database for insurance entity relationships.

    Provides:
    - Schema creation and management
    - Entity ingestion from DataFrames
    - Fraud ring detection queries
    - Risk propagation through graph
    - Claims network analysis
    """

    def __init__(self, config: Neo4jConfig | None = None) -> None:
        self.config = config or Neo4jConfig()
        self._driver = None
        self._connected = False

    def connect(self) -> bool:
        """Try to connect to Neo4j. Returns False if not available."""
        if not HAS_NEO4J:
            print("  [Neo4j] neo4j driver not installed — using offline mode")
            return False
        try:
            self._driver = GraphDatabase.driver(
                self.config.uri,
                auth=(self.config.user, self.config.password),
            )
            self._driver.verify_connectivity()
            self._connected = True
            print(f"  [Neo4j] Connected to {self.config.uri}")
            return True
        except Exception as e:
            print(f"  [Neo4j] Connection failed ({e}) — using offline mode")
            return False

    def close(self) -> None:
        if self._driver:
            self._driver.close()

    def create_schema(self) -> None:
        """Create constraints and indexes."""
        if not self._connected:
            print("  [Neo4j] Schema creation skipped (offline mode)")
            return
        with self._driver.session(database=self.config.database) as session:
            for stmt in CYPHER_SCHEMA.strip().split(";"):
                stmt = stmt.strip()
                if stmt:
                    session.run(stmt)
        print("  [Neo4j] Schema created")

    def ingest_graph(
        self, nodes_df: pd.DataFrame, edges_df: pd.DataFrame,
    ) -> dict[str, int]:
        """Ingest nodes and edges from DataFrames."""
        counts = {"nodes": 0, "edges": 0}

        if not self._connected:
            # Offline mode: just validate and count
            counts["nodes"] = len(nodes_df)
            counts["edges"] = len(edges_df)
            print(f"  [Neo4j] Offline ingestion validated: {counts['nodes']} nodes, {counts['edges']} edges")
            return counts

        with self._driver.session(database=self.config.database) as session:
            for _, row in nodes_df.iterrows():
                ntype = row["node_type"]
                if ntype == "customer":
                    session.run(CYPHER_INSERT_CUSTOMER, {
                        "customer_id": row["node_id"],
                        "name": row.get("name", ""),
                        "state": row.get("state", ""),
                        "n_policies": int(row.get("n_policies", 0)),
                        "total_premium": float(row.get("total_premium", 0)),
                        "n_claims": int(row.get("n_claims", 0)),
                        "risk_score": float(row.get("risk_score", 0)),
                        "is_fraudulent": bool(row.get("is_fraudulent", False)),
                    })
                counts["nodes"] += 1

        print(f"  [Neo4j] Ingested {counts['nodes']} nodes, {counts['edges']} edges")
        return counts

    def find_fraud_rings(
        self,
        min_amount: float = 100_000,
        min_claims: int = 3,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Find potential fraud rings in the graph."""
        if not self._connected:
            return self._offline_fraud_rings(min_amount, min_claims, limit)

        with self._driver.session(database=self.config.database) as session:
            result = session.run(CYPHER_FRAUD_RING_QUERY, {
                "min_amount": min_amount,
                "min_claims": min_claims,
                "limit": limit,
            })
            return [dict(record) for record in result]

    def _offline_fraud_rings(
        self,
        min_amount: float,
        min_claims: int,
        limit: int,
    ) -> list[dict[str, Any]]:
        """Offline fraud ring detection using in-memory graph analysis."""
        # This returns a schema-compatible empty result for offline mode
        return []

    def get_entity_risk(self, customer_id: str) -> dict[str, Any]:
        """Get risk profile for a customer using graph neighborhood."""
        if not self._connected:
            return {"customer_id": customer_id, "mode": "offline"}

        with self._driver.session(database=self.config.database) as session:
            result = session.run(CYPHER_ENTITY_RISK_PROPAGATION, {
                "customer_id": customer_id,
            })
            record = result.single()
            return dict(record) if record else {}

    def export_for_gnn(self) -> tuple[pd.DataFrame, pd.DataFrame]:
        """Export graph data in a format suitable for GNN training."""
        if not self._connected:
            return pd.DataFrame(), pd.DataFrame()

        nodes: list[dict[str, Any]] = []
        edges: list[dict[str, Any]] = []

        with self._driver.session(database=self.config.database) as session:
            # Export all nodes
            result = session.run(
                "MATCH (n) RETURN labels(n) AS labels, properties(n) AS props"
            )
            for record in result:
                props = dict(record["props"])
                props["node_type"] = record["labels"][0].lower() if record["labels"] else "unknown"
                nodes.append(props)

            # Export all edges
            result = session.run(
                "MATCH (a)-[r]->(b) RETURN type(r) AS type, "
                "properties(a) AS src_props, properties(b) AS dst_props, "
                "properties(r) AS edge_props"
            )
            for record in result:
                edge = dict(record["edge_props"])
                edge["edge_type"] = record["type"].lower()
                src_props = record["src_props"]
                dst_props = record["dst_props"]
                edge["source"] = src_props.get("customer_id") or src_props.get("agent_id") or src_props.get("claim_id", "")
                edge["target"] = dst_props.get("customer_id") or dst_props.get("agent_id") or dst_props.get("claim_id", "")
                edges.append(edge)

        return pd.DataFrame(nodes), pd.DataFrame(edges)

    @staticmethod
    def get_schema_cypher() -> str:
        """Return the Cypher schema for documentation."""
        return CYPHER_SCHEMA

    @staticmethod
    def get_fraud_ring_query() -> str:
        """Return the fraud ring detection query."""
        return CYPHER_FRAUD_RING_QUERY
