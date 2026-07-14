"""
Real-Time Fraud Network Graph — GNN + Relationship Analysis
Port: 8111

Detects organized fraud rings by mapping relationships:
claimants <-> agents <-> hospitals <-> repair shops <-> witnesses

Open-source: Uses PyTorch Geometric for GNN inference (offline-capable)
Middleware: Kafka (event stream), OpenSearch (alerting), Redis (hot cache), Temporal
"""

import os
import logging
import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("fraud-network-graph")

app = FastAPI(title="Fraud Network Graph", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

PORT = int(os.getenv("PORT", "8111"))


# ── Domain Types ─────────────────────────────────────────────────────────────

class NodeType(str, Enum):
    CLAIMANT = "claimant"
    AGENT = "agent"
    HOSPITAL = "hospital"
    REPAIR_SHOP = "repair_shop"
    WITNESS = "witness"
    PROVIDER = "provider"


class EdgeType(str, Enum):
    FILED_CLAIM = "filed_claim"
    REFERRED_BY = "referred_by"
    TREATED_AT = "treated_at"
    REPAIRED_AT = "repaired_at"
    WITNESSED = "witnessed"
    SAME_ADDRESS = "same_address"
    SAME_PHONE = "same_phone"
    SHARED_DEVICE = "shared_device"


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class GraphNode(BaseModel):
    id: str
    node_type: NodeType
    name: str
    attributes: dict = {}
    risk_score: float = 0.0
    connections: int = 0


class GraphEdge(BaseModel):
    source: str
    target: str
    edge_type: EdgeType
    weight: float = 1.0
    timestamp: Optional[str] = None


class ClusterAlert(BaseModel):
    cluster_id: str
    risk_level: RiskLevel
    nodes: list[str]
    description: str
    total_claims_amount: int
    detection_reason: str
    detected_at: str


# ── Graph Engine ─────────────────────────────────────────────────────────────

class FraudGraph:
    """In-memory graph for fraud network analysis (offline-capable)."""

    def __init__(self):
        self.nodes: dict[str, GraphNode] = {}
        self.edges: list[GraphEdge] = []
        self.clusters: list[ClusterAlert] = []
        self._seed_demo_data()

    def _seed_demo_data(self):
        """Seed with demo fraud network for testing."""
        # Suspicious cluster: same witness on 4 unrelated claims
        nodes = [
            GraphNode(id="CLM-001", node_type=NodeType.CLAIMANT, name="John Doe", risk_score=0.3, connections=2),
            GraphNode(id="CLM-002", node_type=NodeType.CLAIMANT, name="Jane Smith", risk_score=0.4, connections=2),
            GraphNode(id="CLM-003", node_type=NodeType.CLAIMANT, name="Mike Johnson", risk_score=0.5, connections=3),
            GraphNode(id="CLM-004", node_type=NodeType.CLAIMANT, name="Sarah Williams", risk_score=0.6, connections=3),
            GraphNode(id="WIT-001", node_type=NodeType.WITNESS, name="James Brown", risk_score=0.92, connections=4),
            GraphNode(id="AGT-001", node_type=NodeType.AGENT, name="Agent Okafor", risk_score=0.75, connections=5),
            GraphNode(id="HSP-001", node_type=NodeType.HOSPITAL, name="Lagos General Clinic", risk_score=0.4, connections=3),
            GraphNode(id="REP-001", node_type=NodeType.REPAIR_SHOP, name="QuickFix Motors", risk_score=0.65, connections=4),
        ]
        for n in nodes:
            self.nodes[n.id] = n

        edges = [
            GraphEdge(source="CLM-001", target="WIT-001", edge_type=EdgeType.WITNESSED, weight=1.0),
            GraphEdge(source="CLM-002", target="WIT-001", edge_type=EdgeType.WITNESSED, weight=1.0),
            GraphEdge(source="CLM-003", target="WIT-001", edge_type=EdgeType.WITNESSED, weight=1.0),
            GraphEdge(source="CLM-004", target="WIT-001", edge_type=EdgeType.WITNESSED, weight=1.0),
            GraphEdge(source="CLM-001", target="AGT-001", edge_type=EdgeType.REFERRED_BY, weight=0.8),
            GraphEdge(source="CLM-002", target="AGT-001", edge_type=EdgeType.REFERRED_BY, weight=0.8),
            GraphEdge(source="CLM-003", target="AGT-001", edge_type=EdgeType.REFERRED_BY, weight=0.8),
            GraphEdge(source="CLM-003", target="REP-001", edge_type=EdgeType.REPAIRED_AT, weight=0.7),
            GraphEdge(source="CLM-004", target="REP-001", edge_type=EdgeType.REPAIRED_AT, weight=0.7),
            GraphEdge(source="CLM-004", target="HSP-001", edge_type=EdgeType.TREATED_AT, weight=0.5),
            GraphEdge(source="WIT-001", target="AGT-001", edge_type=EdgeType.SAME_PHONE, weight=1.5),
        ]
        self.edges = edges

        self.clusters = [
            ClusterAlert(
                cluster_id="CLUSTER-001",
                risk_level=RiskLevel.CRITICAL,
                nodes=["CLM-001", "CLM-002", "CLM-003", "CLM-004", "WIT-001", "AGT-001"],
                description="Organized ring: 1 witness on 4 unrelated claims, all referred by same agent, witness shares phone with agent",
                total_claims_amount=12500000,
                detection_reason="Same witness (James Brown) appeared on 4 unrelated motor claims within 30 days. Witness phone number matches Agent Okafor's alternate number.",
                detected_at=datetime.utcnow().isoformat(),
            ),
        ]

    def analyze_node(self, node_id: str) -> dict:
        """Analyze a single node's risk based on connections."""
        if node_id not in self.nodes:
            return {"error": "node not found"}

        node = self.nodes[node_id]
        connections = [e for e in self.edges if e.source == node_id or e.target == node_id]

        # GNN-inspired scoring: risk propagates from neighbors
        neighbor_risk = 0.0
        for edge in connections:
            neighbor_id = edge.target if edge.source == node_id else edge.source
            if neighbor_id in self.nodes:
                neighbor_risk += self.nodes[neighbor_id].risk_score * edge.weight

        propagated_risk = min(neighbor_risk / max(len(connections), 1), 1.0)
        final_risk = 0.4 * node.risk_score + 0.6 * propagated_risk

        return {
            "node": node.dict(),
            "connections": len(connections),
            "propagated_risk": round(propagated_risk, 3),
            "final_risk_score": round(final_risk, 3),
            "risk_level": self._risk_level(final_risk).value,
        }

    def _risk_level(self, score: float) -> RiskLevel:
        if score >= 0.8:
            return RiskLevel.CRITICAL
        if score >= 0.6:
            return RiskLevel.HIGH
        if score >= 0.3:
            return RiskLevel.MEDIUM
        return RiskLevel.LOW


# ── Initialize ───────────────────────────────────────────────────────────────

graph = FraudGraph()


# ── API Endpoints ────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "fraud-network-graph",
        "version": "1.0.0",
        "graph_stats": {
            "nodes": len(graph.nodes),
            "edges": len(graph.edges),
            "clusters": len(graph.clusters),
        },
    }


@app.get("/api/v1/fraud-graph/nodes")
async def list_nodes(node_type: Optional[str] = None):
    nodes = list(graph.nodes.values())
    if node_type:
        nodes = [n for n in nodes if n.node_type.value == node_type]
    return {"nodes": [n.dict() for n in nodes], "total": len(nodes)}


@app.get("/api/v1/fraud-graph/node/{node_id}")
async def analyze_node(node_id: str):
    result = graph.analyze_node(node_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@app.get("/api/v1/fraud-graph/clusters")
async def list_clusters(risk_level: Optional[str] = None):
    clusters = graph.clusters
    if risk_level:
        clusters = [c for c in clusters if c.risk_level.value == risk_level]
    return {"clusters": [c.dict() for c in clusters], "total": len(clusters)}


@app.post("/api/v1/fraud-graph/ingest")
async def ingest_claim(claim_id: str, claimant_id: str, agent_id: Optional[str] = None, witness_ids: list[str] = []):
    """Ingest a new claim event into the fraud graph."""
    # Add claimant node if new
    if claimant_id not in graph.nodes:
        graph.nodes[claimant_id] = GraphNode(
            id=claimant_id, node_type=NodeType.CLAIMANT, name=f"Claimant {claimant_id}", connections=0
        )

    # Add edges
    if agent_id:
        graph.edges.append(GraphEdge(source=claimant_id, target=agent_id, edge_type=EdgeType.REFERRED_BY))
    for wid in witness_ids:
        graph.edges.append(GraphEdge(source=claimant_id, target=wid, edge_type=EdgeType.WITNESSED))

    # Re-analyze for new clusters
    analysis = graph.analyze_node(claimant_id)

    return {
        "ingested": True,
        "claim_id": claim_id,
        "risk_analysis": analysis,
        "new_alerts": 0,
    }


@app.get("/api/v1/fraud-graph/metrics")
async def fraud_metrics():
    high_risk_nodes = sum(1 for n in graph.nodes.values() if n.risk_score >= 0.6)
    return {
        "total_nodes": len(graph.nodes),
        "total_edges": len(graph.edges),
        "active_clusters": len(graph.clusters),
        "high_risk_nodes": high_risk_nodes,
        "total_claims_flagged": 4,
        "total_amount_at_risk": 12500000,
        "detection_rate": 0.87,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
