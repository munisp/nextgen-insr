"""
Neo4j + GNN Integration for Insurance Fraud Detection

This module integrates Neo4j graph database with Graph Neural Networks (GNN)
for advanced fraud detection in the insurance platform.

FAIL-LOUD DESIGN: Neo4j driver failures and Cypher errors are propagated as
exceptions — simulated customers/policies/claims are never mixed into live
results. Empty query results produce honest empty responses, not fabricated
entities with random fraud scores.
"""

import os
import json
import asyncio
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import logging
import numpy as np

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Neo4j driver import
try:
    from neo4j import GraphDatabase, AsyncGraphDatabase
    NEO4J_AVAILABLE = True
except ImportError:
    NEO4J_AVAILABLE = False

# Import GNN service
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
try:
    from gnn.graph_neural_network_fraud import (
        GNNFraudDetectionService,
        GNNModelType,
        GNNConfig,
        FraudPrediction,
    )
    GNN_AVAILABLE = True
except ImportError:
    GNN_AVAILABLE = False

    # Stub enum so default arguments still evaluate when the GNN module is
    # missing; any actual use is blocked by _require_gnn().
    class GNNModelType(Enum):
        GCN = "graph_convolutional_network"
        GAT = "graph_attention_network"
        SAGE = "graphsage"

    GNNConfig = None
    GNNFraudDetectionService = None
    FraudPrediction = None


@dataclass
class Neo4jConfig:
    """Configuration for Neo4j connection"""
    uri: str = "bolt://localhost:7687"
    username: str = "neo4j"
    password: str = os.getenv("NEO4J_PASSWORD", "")
    database: str = "neo4j"
    max_connection_pool_size: int = 50
    connection_timeout: int = 30


@dataclass
class GNNPredictionResult:
    """Result from GNN prediction stored in Neo4j"""
    entity_id: str
    entity_type: str
    fraud_probability: float
    fraud_class: int
    confidence: float
    contributing_factors: List[str]
    connected_suspicious: List[str]
    prediction_timestamp: str
    model_version: str


@dataclass
class FraudRingResult:
    """Fraud ring detection result"""
    ring_id: str
    members: List[str]
    risk_score: float
    total_claims_amount: float
    shared_attributes: List[str]
    detection_method: str


class Neo4jGNNIntegration:
    """
    Integrates Neo4j graph database with GNN for fraud detection.

    This service:
    1. Extracts graph data from Neo4j
    2. Prepares data for GNN training/inference
    3. Runs GNN predictions
    4. Stores predictions back in Neo4j
    5. Enables real-time fraud detection queries

    Requires a reachable Neo4j instance (constructor raises RuntimeError
    otherwise) and the GNN service for training/prediction. No simulated
    graph data is ever returned.
    """

    def __init__(self, neo4j_config: Neo4jConfig = None, gnn_config: "GNNConfig" = None):
        self.neo4j_config = neo4j_config or Neo4jConfig()
        self.gnn_config = gnn_config or (GNNConfig() if GNN_AVAILABLE else None)

        self.driver = None
        self.gnn_service = None
        self.model_version = "v1.0.0"

        self._initialize_connections()

    def _initialize_connections(self):
        """Initialize Neo4j and GNN connections. Fails loudly when Neo4j
        is unavailable — simulated graph data is disabled."""
        # Initialize Neo4j driver
        if not NEO4J_AVAILABLE:
            raise RuntimeError(
                "neo4j driver is not installed; cannot extract graph data. "
                "Simulated Neo4j results are disabled. Install the neo4j package."
            )
        try:
            self.driver = GraphDatabase.driver(
                self.neo4j_config.uri,
                auth=(self.neo4j_config.username, self.neo4j_config.password),
                max_connection_pool_size=self.neo4j_config.max_connection_pool_size,
                connection_timeout=self.neo4j_config.connection_timeout,
            )
            self.driver.verify_connectivity()
            logger.info("Neo4j driver initialized successfully")
        except Exception as e:
            self.driver = None
            raise RuntimeError(
                f"Failed to connect to Neo4j at {self.neo4j_config.uri}: {e}. "
                "Simulated Neo4j results are disabled."
            ) from e

        # Initialize GNN service (optional — training/prediction require it)
        if GNN_AVAILABLE:
            self.gnn_service = GNNFraudDetectionService(config=self.gnn_config)
            logger.info("GNN service initialized successfully")
        else:
            logger.warning(
                "GNN service not available; train/predict operations will raise."
            )

    def _require_gnn(self) -> None:
        if self.gnn_service is None:
            raise RuntimeError(
                "GNN service is unavailable (graph_neural_network_fraud import "
                "failed); simulated GNN results are disabled."
            )

    def _execute_cypher(self, query: str, parameters: Dict[str, Any] = None) -> List[Dict[str, Any]]:
        """Execute a Cypher query against Neo4j.

        Raises RuntimeError on any failure — errors are never masked with
        simulated rows.
        """
        if not self.driver:
            raise RuntimeError(
                "Neo4j driver is not connected; cannot execute Cypher. "
                "Simulated query results are disabled."
            )

        try:
            with self.driver.session(database=self.neo4j_config.database) as session:
                result = session.run(query, parameters or {})
                return [record.data() for record in result]
        except Exception as e:
            logger.error(f"Cypher query failed: {e}")
            raise RuntimeError(f"Neo4j Cypher query failed: {e}") from e

    def extract_graph_for_gnn(
        self,
        customer_ids: List[str] = None,
        include_policies: bool = True,
        include_claims: bool = True,
        hop_distance: int = 2,
    ) -> Tuple[List[Dict[str, Any]], List[Tuple[str, str, str]]]:
        """
        Extract graph data from Neo4j for GNN processing.

        Returns:
            Tuple of (nodes, edges) where:
            - nodes: List of node dictionaries with id, type, and properties
            - edges: List of (source_id, target_id, edge_type) tuples

        Empty graph queries return honestly empty node/edge lists.
        """
        nodes = []
        edges = []

        # Query for customers
        if customer_ids:
            customer_query = """
            MATCH (c:Customer)
            WHERE c.id IN $customer_ids
            RETURN c.id as id, 'customer' as type, c as properties
            """
            params = {"customer_ids": customer_ids}
        else:
            customer_query = """
            MATCH (c:Customer)
            RETURN c.id as id, 'customer' as type, c as properties
            LIMIT 1000
            """
            params = {}

        customer_results = self._execute_cypher(customer_query, params)
        for record in customer_results:
            nodes.append({
                "id": record.get("id", f"cust_{len(nodes)}"),
                "type": "customer",
                "properties": record.get("properties", record),
            })

        # Query for policies
        if include_policies:
            policy_query = """
            MATCH (c:Customer)-[:HAS_POLICY]->(p:Policy)
            RETURN p.id as id, 'policy' as type, p as properties, c.id as customer_id
            LIMIT 2000
            """
            policy_results = self._execute_cypher(policy_query)
            for record in policy_results:
                policy_id = record.get("id", f"pol_{len(nodes)}")
                nodes.append({
                    "id": policy_id,
                    "type": "policy",
                    "properties": record.get("properties", record),
                })
                customer_id = record.get("customer_id")
                if customer_id:
                    edges.append((customer_id, policy_id, "HAS_POLICY"))

        # Query for claims
        if include_claims:
            claim_query = """
            MATCH (p:Policy)-[:HAS_CLAIM]->(cl:Claim)
            RETURN cl.id as id, 'claim' as type, cl as properties, p.id as policy_id
            LIMIT 2000
            """
            claim_results = self._execute_cypher(claim_query)
            for record in claim_results:
                claim_id = record.get("id", f"claim_{len(nodes)}")
                nodes.append({
                    "id": claim_id,
                    "type": "claim",
                    "properties": record.get("properties", record),
                })
                policy_id = record.get("policy_id")
                if policy_id:
                    edges.append((policy_id, claim_id, "HAS_CLAIM"))

        # Query for customer relationships (shared address, phone, agent)
        relationship_query = """
        MATCH (c1:Customer)-[r:RELATED_TO|SHARES_ADDRESS|SHARES_PHONE|SHARES_AGENT]-(c2:Customer)
        WHERE c1.id < c2.id
        RETURN c1.id as source, c2.id as target, type(r) as rel_type
        LIMIT 5000
        """
        rel_results = self._execute_cypher(relationship_query)
        for record in rel_results:
            source = record.get("source")
            target = record.get("target")
            rel_type = record.get("rel_type", "RELATED_TO")
            if source and target:
                edges.append((source, target, rel_type))

        logger.info(f"Extracted {len(nodes)} nodes and {len(edges)} edges from Neo4j")
        return nodes, edges

    def prepare_gnn_data(
        self,
        nodes: List[Dict[str, Any]],
        edges: List[Tuple[str, str, str]],
        labels: Dict[str, int] = None,
    ) -> Any:
        """Prepare extracted graph data for GNN processing"""
        self._require_gnn()
        return self.gnn_service.prepare_graph_data(nodes, edges, labels)

    def train_fraud_model(
        self,
        model_type: GNNModelType = GNNModelType.GAT,
        nodes: List[Dict[str, Any]] = None,
        edges: List[Tuple[str, str, str]] = None,
        labels: Dict[str, int] = None,
    ) -> Dict[str, Any]:
        """
        Train GNN fraud detection model on Neo4j graph data.

        Args:
            model_type: Type of GNN model (GCN, GAT, SAGE)
            nodes: Optional pre-extracted nodes
            edges: Optional pre-extracted edges
            labels: Known fraud labels {entity_id: label}

        Returns:
            Training result with real metrics. Raises RuntimeError when the
            GNN service is unavailable — no simulated metrics.
        """
        self._require_gnn()

        # Extract data if not provided
        if nodes is None or edges is None:
            nodes, edges = self.extract_graph_for_gnn()

        # Prepare data for GNN
        graph_data = self.prepare_gnn_data(nodes, edges, labels)

        # Train model (raises RuntimeError if torch_geometric missing)
        training_result = self.gnn_service.train_model(model_type, graph_data)
        return {
            "model_type": training_result.model_type,
            "accuracy": training_result.accuracy,
            "precision": training_result.precision,
            "recall": training_result.recall,
            "f1_score": training_result.f1_score,
            "auc_roc": training_result.auc_roc,
            "training_time_seconds": training_result.training_time_seconds,
            "best_epoch": training_result.best_epoch,
        }

    def predict_fraud(
        self,
        entity_ids: List[str] = None,
        model_type: GNNModelType = GNNModelType.GAT,
    ) -> List[GNNPredictionResult]:
        """
        Predict fraud probability for entities using GNN.

        Args:
            entity_ids: Specific entities to predict (None for all)
            model_type: GNN model type to use

        Returns:
            List of prediction results. Raises RuntimeError when the GNN
            service or a trained model is unavailable — no random
            probabilities are generated.
        """
        self._require_gnn()

        # Extract graph data
        nodes, edges = self.extract_graph_for_gnn(customer_ids=entity_ids)
        graph_data = self.prepare_gnn_data(nodes, edges)

        # Get predictions (raises if model untrained)
        predictions = self.gnn_service.predict_fraud(model_type, graph_data, entity_ids)

        # Convert to result objects
        results = []
        for pred in predictions:
            results.append(GNNPredictionResult(
                entity_id=pred.entity_id,
                entity_type=pred.entity_type,
                fraud_probability=pred.fraud_probability,
                fraud_class=pred.fraud_class,
                confidence=pred.confidence,
                contributing_factors=pred.contributing_factors,
                connected_suspicious=pred.connected_suspicious_entities,
                prediction_timestamp=datetime.utcnow().isoformat(),
                model_version=self.model_version,
            ))

        return results

    def store_predictions_in_neo4j(self, predictions: List[GNNPredictionResult]) -> int:
        """
        Store GNN predictions back in Neo4j for querying.

        Args:
            predictions: List of prediction results

        Returns:
            Number of predictions stored. Raises RuntimeError on connection
            or query failure — never pretends to store.
        """
        stored_count = 0
        for pred in predictions:
            query = """
            MATCH (n {id: $entity_id})
            SET n.gnn_fraud_probability = $fraud_probability,
                n.gnn_fraud_class = $fraud_class,
                n.gnn_confidence = $confidence,
                n.gnn_contributing_factors = $contributing_factors,
                n.gnn_prediction_timestamp = $timestamp,
                n.gnn_model_version = $model_version
            RETURN n.id
            """
            params = {
                "entity_id": pred.entity_id,
                "fraud_probability": pred.fraud_probability,
                "fraud_class": pred.fraud_class,
                "confidence": pred.confidence,
                "contributing_factors": pred.contributing_factors,
                "timestamp": pred.prediction_timestamp,
                "model_version": pred.model_version,
            }

            result = self._execute_cypher(query, params)
            if result:
                stored_count += 1
            else:
                logger.warning(
                    f"No Neo4j node matched id={pred.entity_id}; prediction not stored"
                )

        logger.info(f"Stored {stored_count} predictions in Neo4j")
        return stored_count

    def detect_fraud_rings(self, min_ring_size: int = 3) -> List[FraudRingResult]:
        """
        Detect fraud rings using GNN and Neo4j graph analysis.

        Combines:
        1. Neo4j graph algorithms for community detection
        2. GNN predictions for risk scoring
        3. Pattern matching for fraud indicators

        Empty results are returned as an empty list — simulated rings are
        never fabricated.
        """
        # Query for potential fraud rings from Neo4j
        ring_query = """
        MATCH (c1:Customer)-[:SHARES_ADDRESS|SHARES_PHONE|SHARES_AGENT]-(c2:Customer)
        WHERE c1.id < c2.id
        WITH c1, c2, count(*) as shared_count
        WHERE shared_count >= 2
        MATCH path = (c1)-[:SHARES_ADDRESS|SHARES_PHONE|SHARES_AGENT*1..3]-(c2)
        WITH c1, c2, nodes(path) as ring_members
        WHERE size(ring_members) >= $min_size
        RETURN DISTINCT ring_members
        LIMIT 50
        """

        ring_results = self._execute_cypher(ring_query, {"min_size": min_ring_size})

        # If no results from Neo4j, use GNN-based detection on the real graph
        if not ring_results:
            nodes, edges = self.extract_graph_for_gnn()
            if not nodes:
                logger.info("detect_fraud_rings: empty graph, no rings detected")
                return []
            self._require_gnn()
            graph_data = self.prepare_gnn_data(nodes, edges)
            ring_results = self.gnn_service.detect_fraud_rings(graph_data, min_ring_size)

        # Convert to FraudRingResult objects
        fraud_rings = []
        for i, ring in enumerate(ring_results):
            if isinstance(ring, dict):
                members = ring.get("members", ring.get("ring_members", []))
                risk_score = ring.get("risk_score")
            else:
                members = list(ring) if hasattr(ring, '__iter__') else []
                risk_score = None

            # Calculate total claims amount for ring members
            claims_query = """
            MATCH (c:Customer)-[:HAS_POLICY]->(:Policy)-[:HAS_CLAIM]->(cl:Claim)
            WHERE c.id IN $member_ids
            RETURN sum(cl.amount) as total_claims
            """
            claims_result = self._execute_cypher(claims_query, {"member_ids": members})
            total_claims = claims_result[0].get("total_claims") if claims_result else None

            fraud_rings.append(FraudRingResult(
                ring_id=f"ring_{i}",
                members=members,
                risk_score=float(risk_score) if risk_score is not None else 0.0,
                total_claims_amount=float(total_claims) if total_claims else 0.0,
                shared_attributes=["address", "phone", "agent"],
                detection_method="neo4j_graph_query" if not isinstance(ring, dict) else ring.get("detection_method", "gnn_cycle_detection"),
            ))

        logger.info(f"Detected {len(fraud_rings)} potential fraud rings")
        return fraud_rings

    def get_entity_fraud_context(self, entity_id: str) -> Dict[str, Any]:
        """
        Get comprehensive fraud context for an entity from Neo4j + GNN.

        Returns entity details, any GNN predictions previously stored on the
        node, connected entities, and risk factors. When the entity does not
        exist, an honest not-found response is returned — never a fabricated
        entity with a random fraud probability.
        """
        # Get entity details
        entity_query = """
        MATCH (n {id: $entity_id})
        OPTIONAL MATCH (n)-[r]-(connected)
        RETURN n as entity,
               collect(DISTINCT {
                   id: connected.id,
                   type: labels(connected)[0],
                   relationship: type(r),
                   fraud_probability: connected.gnn_fraud_probability
               }) as connections
        """

        result = self._execute_cypher(entity_query, {"entity_id": entity_id})

        if not result or result[0].get("entity") is None:
            logger.info(f"Entity {entity_id} not found in Neo4j")
            return {
                "entity_id": entity_id,
                "found": False,
                "entity_details": None,
                "gnn_prediction": None,
                "connections": [],
                "network_risk_score": None,
                "suspicious_connections_count": 0,
                "total_connections_count": 0,
                "risk_assessment": None,
                "detail": "entity not found in knowledge graph",
            }

        entity_data = result[0]
        entity = entity_data.get("entity", {})
        connections = [
            c for c in entity_data.get("connections", []) if c.get("id") is not None
        ]

        # Use GNN prediction values persisted on the node (written by
        # store_predictions_in_neo4j). If none were stored, report that
        # honestly instead of fabricating a probability.
        gnn_prediction = None
        if entity.get("gnn_fraud_probability") is not None:
            gnn_prediction = {
                "fraud_probability": entity.get("gnn_fraud_probability"),
                "fraud_class": entity.get("gnn_fraud_class"),
                "confidence": entity.get("gnn_confidence"),
                "contributing_factors": entity.get("gnn_contributing_factors", []),
                "model_version": entity.get("gnn_model_version"),
                "prediction_timestamp": entity.get("gnn_prediction_timestamp"),
                "source": "neo4j_persisted_prediction",
            }

        # Calculate network risk score from real connected-entity probabilities
        scored = [c for c in connections if c.get("fraud_probability") is not None]
        suspicious_connections = [c for c in scored if c["fraud_probability"] > 0.5]
        network_risk = (
            len(suspicious_connections) / len(scored) if scored else None
        )

        risk_assessment = None
        if network_risk is not None:
            risk_assessment = (
                "HIGH" if network_risk > 0.5
                else ("MEDIUM" if network_risk > 0.2 else "LOW")
            )

        return {
            "entity_id": entity_id,
            "found": True,
            "entity_details": entity,
            "gnn_prediction": gnn_prediction,
            "connections": connections,
            "network_risk_score": network_risk,
            "suspicious_connections_count": len(suspicious_connections),
            "total_connections_count": len(connections),
            "risk_assessment": risk_assessment,
        }

    def run_fraud_detection_pipeline(
        self,
        customer_ids: List[str] = None,
        train_model: bool = True,
        store_predictions: bool = True,
    ) -> Dict[str, Any]:
        """
        Run complete fraud detection pipeline.

        1. Extract graph from Neo4j
        2. Train GNN model (optional)
        3. Generate predictions
        4. Detect fraud rings
        5. Store results in Neo4j

        Returns:
            Pipeline execution results. Any dependency failure (Neo4j, GNN,
            untrained model) raises RuntimeError instead of being masked.
        """
        start_time = datetime.utcnow()
        results = {
            "pipeline_id": f"pipeline_{start_time.strftime('%Y%m%d_%H%M%S')}",
            "start_time": start_time.isoformat(),
            "steps": [],
        }

        # Step 1: Extract graph
        nodes, edges = self.extract_graph_for_gnn(customer_ids=customer_ids)
        results["steps"].append({
            "step": "extract_graph",
            "nodes_count": len(nodes),
            "edges_count": len(edges),
            "status": "completed",
        })

        # Step 2: Train model (optional)
        training_result = None
        if train_model:
            training_result = self.train_fraud_model(nodes=nodes, edges=edges)
            results["steps"].append({
                "step": "train_model",
                "metrics": training_result,
                "status": "completed",
            })

        # Step 3: Generate predictions
        predictions = self.predict_fraud(entity_ids=customer_ids)
        high_risk_count = len([p for p in predictions if p.fraud_probability > 0.5])
        results["steps"].append({
            "step": "predict_fraud",
            "predictions_count": len(predictions),
            "high_risk_count": high_risk_count,
            "status": "completed",
        })

        # Step 4: Detect fraud rings
        fraud_rings = self.detect_fraud_rings()
        results["steps"].append({
            "step": "detect_fraud_rings",
            "rings_detected": len(fraud_rings),
            "total_ring_members": sum(len(r.members) for r in fraud_rings),
            "status": "completed",
        })

        # Step 5: Store predictions
        if store_predictions:
            stored_count = self.store_predictions_in_neo4j(predictions)
            results["steps"].append({
                "step": "store_predictions",
                "stored_count": stored_count,
                "status": "completed",
            })

        end_time = datetime.utcnow()
        results["end_time"] = end_time.isoformat()
        results["duration_seconds"] = (end_time - start_time).total_seconds()
        results["summary"] = {
            "total_entities_analyzed": len(predictions),
            "high_risk_entities": high_risk_count,
            "fraud_rings_detected": len(fraud_rings),
            "model_accuracy": training_result["accuracy"] if training_result else None,
        }

        logger.info(f"Fraud detection pipeline completed in {results['duration_seconds']:.2f}s")
        return results

    def close(self):
        """Close Neo4j driver connection"""
        if self.driver:
            self.driver.close()
            logger.info("Neo4j driver closed")


# Temporal Activity for Neo4j-GNN fraud detection
async def neo4j_gnn_fraud_detection_activity(
    customer_ids: List[str] = None,
    train_model: bool = False,
) -> Dict[str, Any]:
    """Temporal activity for Neo4j-GNN fraud detection.

    Raises RuntimeError when Neo4j or the GNN service is unavailable —
    simulated results are disabled.
    """
    service = Neo4jGNNIntegration()
    try:
        result = service.run_fraud_detection_pipeline(
            customer_ids=customer_ids,
            train_model=train_model,
        )
        return result
    finally:
        service.close()


# Factory function
def create_neo4j_gnn_service(
    neo4j_uri: str = "bolt://localhost:7687",
    neo4j_username: str = "neo4j",
    neo4j_password: str = os.getenv("NEO4J_PASSWORD", ""),
) -> Neo4jGNNIntegration:
    """Create Neo4j-GNN integration service"""
    config = Neo4jConfig(
        uri=neo4j_uri,
        username=neo4j_username,
        password=neo4j_password,
    )
    return Neo4jGNNIntegration(neo4j_config=config)
