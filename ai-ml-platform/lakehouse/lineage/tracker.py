"""
Data Lineage & Observability Engine

Tracks the full provenance of feature data:
- Source-to-table lineage (which services produce which features)
- Table-to-model lineage (which models consume which features)
- Transform lineage (what transformations were applied)
- Feature freshness monitoring
- Data quality metrics (completeness, uniqueness, distribution drift)
- Anomaly detection on feature pipelines
- Audit trail for all mutations
"""

from __future__ import annotations

import json
import time
from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any


class LineageNodeType(Enum):
    """Types of nodes in the lineage graph."""
    SOURCE = "source"  # External data source (PostgreSQL, Kafka, API)
    TRANSFORM = "transform"  # Feature transformation/computation
    TABLE = "table"  # Feature table in the lakehouse
    MODEL = "model"  # ML model consuming features
    SERVICE = "service"  # Microservice producing events


class DataQualityLevel(Enum):
    """Data quality assessment levels."""
    EXCELLENT = "excellent"  # >99% quality
    GOOD = "good"  # 95-99%
    FAIR = "fair"  # 90-95%
    POOR = "poor"  # 80-90%
    CRITICAL = "critical"  # <80%


@dataclass
class LineageNode:
    """A node in the lineage graph."""
    id: str
    name: str
    node_type: LineageNodeType
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "type": self.node_type.value,
            "metadata": self.metadata,
            "created_at": self.created_at,
        }


@dataclass
class LineageEdge:
    """An edge connecting two lineage nodes."""
    source_id: str
    target_id: str
    relation: str  # "produces", "consumes", "transforms"
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "target_id": self.target_id,
            "relation": self.relation,
            "metadata": self.metadata,
            "created_at": self.created_at,
        }


@dataclass
class DataQualityMetrics:
    """Quality metrics for a feature table."""
    table_name: str
    timestamp: float = field(default_factory=time.time)
    n_rows: int = 0
    n_columns: int = 0
    completeness: float = 1.0  # % of non-null values
    uniqueness: float = 1.0  # % of unique values in PK
    freshness_seconds: float = 0.0  # Time since last update
    schema_violations: int = 0
    outlier_count: int = 0
    duplicate_count: int = 0

    @property
    def quality_level(self) -> DataQualityLevel:
        score = self.completeness * 0.4 + self.uniqueness * 0.3 + (1.0 - min(self.freshness_seconds / 86400, 1.0)) * 0.3
        if score >= 0.99:
            return DataQualityLevel.EXCELLENT
        elif score >= 0.95:
            return DataQualityLevel.GOOD
        elif score >= 0.90:
            return DataQualityLevel.FAIR
        elif score >= 0.80:
            return DataQualityLevel.POOR
        return DataQualityLevel.CRITICAL

    def to_dict(self) -> dict[str, Any]:
        return {
            "table_name": self.table_name,
            "timestamp": self.timestamp,
            "n_rows": self.n_rows,
            "n_columns": self.n_columns,
            "completeness": round(self.completeness, 4),
            "uniqueness": round(self.uniqueness, 4),
            "freshness_seconds": round(self.freshness_seconds, 1),
            "schema_violations": self.schema_violations,
            "outlier_count": self.outlier_count,
            "duplicate_count": self.duplicate_count,
            "quality_level": self.quality_level.value,
        }


@dataclass
class MutationEvent:
    """Audit trail entry for a data mutation."""
    table_name: str
    operation: str  # "insert", "update", "delete", "schema_change"
    n_rows_affected: int
    actor: str  # service or user that made the change
    timestamp: float = field(default_factory=time.time)
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "table_name": self.table_name,
            "operation": self.operation,
            "n_rows_affected": self.n_rows_affected,
            "actor": self.actor,
            "timestamp": self.timestamp,
            "details": self.details,
        }


class LineageGraph:
    """Directed acyclic graph tracking data lineage relationships."""

    def __init__(self) -> None:
        self._nodes: dict[str, LineageNode] = {}
        self._edges: list[LineageEdge] = []
        self._adjacency: dict[str, list[str]] = defaultdict(list)  # source -> targets
        self._reverse_adj: dict[str, list[str]] = defaultdict(list)  # target -> sources

    def add_node(self, node: LineageNode) -> None:
        self._nodes[node.id] = node

    def add_edge(self, edge: LineageEdge) -> None:
        self._edges.append(edge)
        self._adjacency[edge.source_id].append(edge.target_id)
        self._reverse_adj[edge.target_id].append(edge.source_id)

    def get_node(self, node_id: str) -> LineageNode | None:
        return self._nodes.get(node_id)

    def get_upstream(self, node_id: str, depth: int = 10) -> list[LineageNode]:
        """Get all upstream (producer) nodes."""
        visited = set()
        result = []
        self._traverse_upstream(node_id, visited, result, depth)
        return result

    def _traverse_upstream(self, node_id: str, visited: set, result: list, depth: int) -> None:
        if depth <= 0 or node_id in visited:
            return
        visited.add(node_id)
        for source_id in self._reverse_adj.get(node_id, []):
            node = self._nodes.get(source_id)
            if node:
                result.append(node)
                self._traverse_upstream(source_id, visited, result, depth - 1)

    def get_downstream(self, node_id: str, depth: int = 10) -> list[LineageNode]:
        """Get all downstream (consumer) nodes."""
        visited = set()
        result = []
        self._traverse_downstream(node_id, visited, result, depth)
        return result

    def _traverse_downstream(self, node_id: str, visited: set, result: list, depth: int) -> None:
        if depth <= 0 or node_id in visited:
            return
        visited.add(node_id)
        for target_id in self._adjacency.get(node_id, []):
            node = self._nodes.get(target_id)
            if node:
                result.append(node)
                self._traverse_downstream(target_id, visited, result, depth - 1)

    def get_impact_analysis(self, node_id: str) -> dict[str, Any]:
        """Analyze the impact of changes to a node on downstream consumers."""
        downstream = self.get_downstream(node_id)
        impacted_tables = [n for n in downstream if n.node_type == LineageNodeType.TABLE]
        impacted_models = [n for n in downstream if n.node_type == LineageNodeType.MODEL]
        return {
            "node_id": node_id,
            "total_downstream": len(downstream),
            "impacted_tables": [t.to_dict() for t in impacted_tables],
            "impacted_models": [m.to_dict() for m in impacted_models],
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "nodes": [n.to_dict() for n in self._nodes.values()],
            "edges": [e.to_dict() for e in self._edges],
        }


class DataLineageTracker:
    """Full data lineage and observability system.

    Tracks:
    - Source → Table → Model lineage
    - Data quality metrics per table
    - Feature freshness and staleness
    - Mutation audit trail
    - Pipeline health monitoring
    """

    def __init__(self, storage_path: str | Path = "lakehouse_store/_lineage") -> None:
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)
        self.graph = LineageGraph()
        self._quality_history: dict[str, list[DataQualityMetrics]] = defaultdict(list)
        self._mutations: list[MutationEvent] = []
        self._alerts: list[dict[str, Any]] = []
        self._load_state()

    def _load_state(self) -> None:
        state_file = self.storage_path / "lineage_state.json"
        if state_file.exists():
            data = json.loads(state_file.read_text())
            for node_data in data.get("nodes", []):
                self.graph.add_node(LineageNode(
                    id=node_data["id"],
                    name=node_data["name"],
                    node_type=LineageNodeType(node_data["type"]),
                    metadata=node_data.get("metadata", {}),
                    created_at=node_data.get("created_at", time.time()),
                ))
            for edge_data in data.get("edges", []):
                self.graph.add_edge(LineageEdge(
                    source_id=edge_data["source_id"],
                    target_id=edge_data["target_id"],
                    relation=edge_data["relation"],
                    metadata=edge_data.get("metadata", {}),
                ))

    def _save_state(self) -> None:
        state_file = self.storage_path / "lineage_state.json"
        state_file.write_text(json.dumps(self.graph.to_dict(), indent=2, default=str))

    def register_platform_lineage(self) -> None:
        """Register the default NGApp platform lineage graph."""
        # Sources
        sources = [
            ("src:postgresql", "PostgreSQL", {"host": "localhost", "database": "ngapp"}),
            ("src:kafka", "Kafka Event Bus", {"brokers": "localhost:9092"}),
            ("src:kyc_service", "KYC/KYB Service", {"port": 8130}),
            ("src:fraud_service", "Fraud Detection Service", {"port": 8100}),
            ("src:claims_service", "Claims Engine", {"port": 8101}),
            ("src:payments_service", "Payments Service", {"port": 8102}),
            ("src:policy_service", "Policy Management", {"port": 8103}),
        ]
        for sid, name, meta in sources:
            self.graph.add_node(LineageNode(id=sid, name=name, node_type=LineageNodeType.SOURCE, metadata=meta))

        # Tables
        tables = [
            ("tbl:fraud_features", "Fraud Features", {"n_features": 22, "primary_key": "claim_id"}),
            ("tbl:churn_features", "Churn Features", {"n_features": 20, "primary_key": "customer_id"}),
            ("tbl:claims_features", "Claims Features", {"n_features": 17, "primary_key": "claim_id"}),
            ("tbl:credit_features", "Credit Features", {"n_features": 22, "primary_key": "customer_id"}),
            ("tbl:anomaly_features", "Anomaly Features", {"n_features": 8, "primary_key": "txn_id"}),
            ("tbl:risk_features", "Risk/Actuarial Features", {"n_features": 15, "primary_key": "policy_id"}),
        ]
        for tid, name, meta in tables:
            self.graph.add_node(LineageNode(id=tid, name=name, node_type=LineageNodeType.TABLE, metadata=meta))

        # Models
        models = [
            ("mdl:fraud_detection", "Fraud Detection Net", {"architecture": "ResidualAttention"}),
            ("mdl:churn_prediction", "Churn Prediction Net", {"architecture": "GLU+Attention"}),
            ("mdl:claims_adjudication", "Claims Adjudication Net", {"architecture": "MultiTask"}),
            ("mdl:credit_scoring", "Credit Scoring Net", {"architecture": "WideDeep"}),
            ("mdl:anomaly_detection", "Transaction Autoencoder", {"architecture": "VAE"}),
            ("mdl:gnn_fraud", "GNN Fraud Rings", {"architecture": "GraphSAGE"}),
        ]
        for mid, name, meta in models:
            self.graph.add_node(LineageNode(id=mid, name=name, node_type=LineageNodeType.MODEL, metadata=meta))

        # Transforms
        transforms = [
            ("xfm:categorical_encoding", "Categorical Encoding", {"method": "category_codes"}),
            ("xfm:feature_scaling", "Feature Scaling", {"method": "standard_scaler"}),
            ("xfm:graph_construction", "Graph Construction", {"method": "entity_resolution"}),
        ]
        for xid, name, meta in transforms:
            self.graph.add_node(LineageNode(id=xid, name=name, node_type=LineageNodeType.TRANSFORM, metadata=meta))

        # Edges: Source → Table
        source_table_edges = [
            ("src:postgresql", "tbl:fraud_features", "produces"),
            ("src:postgresql", "tbl:churn_features", "produces"),
            ("src:postgresql", "tbl:claims_features", "produces"),
            ("src:postgresql", "tbl:credit_features", "produces"),
            ("src:kafka", "tbl:anomaly_features", "produces"),
            ("src:kafka", "tbl:fraud_features", "produces"),
            ("src:kyc_service", "tbl:fraud_features", "contributes"),
            ("src:fraud_service", "tbl:fraud_features", "contributes"),
            ("src:claims_service", "tbl:claims_features", "contributes"),
            ("src:payments_service", "tbl:anomaly_features", "contributes"),
            ("src:policy_service", "tbl:churn_features", "contributes"),
        ]
        for src, tgt, rel in source_table_edges:
            self.graph.add_edge(LineageEdge(source_id=src, target_id=tgt, relation=rel))

        # Edges: Table → Transform → Model
        table_model_edges = [
            ("tbl:fraud_features", "xfm:categorical_encoding", "feeds"),
            ("xfm:categorical_encoding", "mdl:fraud_detection", "feeds"),
            ("tbl:churn_features", "mdl:churn_prediction", "feeds"),
            ("tbl:claims_features", "mdl:claims_adjudication", "feeds"),
            ("tbl:credit_features", "mdl:credit_scoring", "feeds"),
            ("tbl:anomaly_features", "xfm:feature_scaling", "feeds"),
            ("xfm:feature_scaling", "mdl:anomaly_detection", "feeds"),
            ("tbl:fraud_features", "xfm:graph_construction", "feeds"),
            ("xfm:graph_construction", "mdl:gnn_fraud", "feeds"),
        ]
        for src, tgt, rel in table_model_edges:
            self.graph.add_edge(LineageEdge(source_id=src, target_id=tgt, relation=rel))

        self._save_state()

    def record_mutation(self, event: MutationEvent) -> None:
        """Record a data mutation event in the audit trail."""
        self._mutations.append(event)
        # Persist latest mutations
        mutations_file = self.storage_path / "mutations.jsonl"
        with open(mutations_file, "a") as f:
            f.write(json.dumps(event.to_dict(), default=str) + "\n")

    def compute_quality_metrics(self, table_name: str, df: "pd.DataFrame") -> DataQualityMetrics:
        """Compute data quality metrics for a table."""
        import pandas as pd

        n_rows = len(df)
        n_cols = len(df.columns)

        # Completeness: % of non-null cells
        total_cells = n_rows * n_cols
        null_cells = int(df.isnull().sum().sum())
        completeness = 1.0 - (null_cells / max(total_cells, 1))

        # Uniqueness: check primary key candidates
        pk_candidates = ["claim_id", "customer_id", "txn_id", "policy_id", "id"]
        uniqueness = 1.0
        for pk in pk_candidates:
            if pk in df.columns:
                uniqueness = df[pk].nunique() / max(n_rows, 1)
                break

        # Freshness: check timestamp columns
        freshness = 0.0
        ts_candidates = ["event_timestamp", "_ingested_at", "created_at", "submitted_at", "updated_at"]
        for tc in ts_candidates:
            if tc in df.columns:
                try:
                    latest = pd.to_numeric(df[tc], errors="coerce").max()
                    if latest and latest > 0:
                        freshness = time.time() - float(latest)
                        break
                except (TypeError, ValueError):
                    pass

        # Duplicates
        duplicate_count = int(n_rows - df.drop_duplicates().shape[0])

        # Outliers (simple IQR method on numeric columns)
        outlier_count = 0
        numeric_cols = df.select_dtypes(include=["number"]).columns
        for col in numeric_cols[:10]:  # Check up to 10 columns
            q1 = df[col].quantile(0.25)
            q3 = df[col].quantile(0.75)
            iqr = q3 - q1
            outliers = ((df[col] < q1 - 3 * iqr) | (df[col] > q3 + 3 * iqr)).sum()
            outlier_count += int(outliers)

        metrics = DataQualityMetrics(
            table_name=table_name,
            n_rows=n_rows,
            n_columns=n_cols,
            completeness=completeness,
            uniqueness=uniqueness,
            freshness_seconds=freshness,
            duplicate_count=duplicate_count,
            outlier_count=outlier_count,
        )

        self._quality_history[table_name].append(metrics)
        # Keep last 100 measurements
        if len(self._quality_history[table_name]) > 100:
            self._quality_history[table_name] = self._quality_history[table_name][-100:]

        # Check for quality degradation alerts
        self._check_quality_alerts(metrics)

        return metrics

    def _check_quality_alerts(self, metrics: DataQualityMetrics) -> None:
        """Generate alerts when quality degrades."""
        if metrics.quality_level in (DataQualityLevel.POOR, DataQualityLevel.CRITICAL):
            alert = {
                "type": "quality_degradation",
                "table": metrics.table_name,
                "level": metrics.quality_level.value,
                "completeness": metrics.completeness,
                "freshness_seconds": metrics.freshness_seconds,
                "timestamp": time.time(),
            }
            self._alerts.append(alert)

        if metrics.freshness_seconds > 86400:  # >24 hours stale
            alert = {
                "type": "stale_data",
                "table": metrics.table_name,
                "freshness_hours": round(metrics.freshness_seconds / 3600, 1),
                "timestamp": time.time(),
            }
            self._alerts.append(alert)

    def get_lineage(self, table_name: str) -> dict[str, Any]:
        """Get full lineage for a table (upstream + downstream)."""
        node_id = f"tbl:{table_name}"
        node = self.graph.get_node(node_id)
        if not node:
            return {"error": f"Table '{table_name}' not found in lineage graph"}

        upstream = self.graph.get_upstream(node_id)
        downstream = self.graph.get_downstream(node_id)

        return {
            "table": node.to_dict(),
            "upstream": [n.to_dict() for n in upstream],
            "downstream": [n.to_dict() for n in downstream],
            "impact_analysis": self.graph.get_impact_analysis(node_id),
        }

    def get_quality_history(self, table_name: str, limit: int = 20) -> list[dict[str, Any]]:
        """Get quality metrics history for a table."""
        history = self._quality_history.get(table_name, [])
        return [m.to_dict() for m in history[-limit:]]

    def get_recent_mutations(self, table_name: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        """Get recent mutations, optionally filtered by table."""
        mutations = self._mutations
        if table_name:
            mutations = [m for m in mutations if m.table_name == table_name]
        return [m.to_dict() for m in mutations[-limit:]]

    def get_alerts(self, limit: int = 20) -> list[dict[str, Any]]:
        """Get recent quality/freshness alerts."""
        return self._alerts[-limit:]

    def get_full_graph(self) -> dict[str, Any]:
        """Get the complete lineage graph."""
        return self.graph.to_dict()

    def get_status(self) -> dict[str, Any]:
        """Get lineage system status."""
        return {
            "n_nodes": len(self.graph._nodes),
            "n_edges": len(self.graph._edges),
            "n_mutations": len(self._mutations),
            "n_alerts": len(self._alerts),
            "tables_tracked": list(self._quality_history.keys()),
            "quality_summary": {
                name: metrics[-1].to_dict() if metrics else None
                for name, metrics in self._quality_history.items()
            },
        }
