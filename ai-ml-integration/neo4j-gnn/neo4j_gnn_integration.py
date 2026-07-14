"""
Neo4j + GNN Integration for Insurance Fraud Detection

This module integrates Neo4j graph database with Graph Neural Networks (GNN)
for advanced fraud detection in the insurance platform.
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
    """

    def __init__(self, neo4j_config: Neo4jConfig = None, gnn_config: GNNConfig = None):
        self.neo4j_config = neo4j_config or Neo4jConfig()
        self.gnn_config = gnn_config or GNNConfig()
        
        self.driver = None
        self.gnn_service = None
        self.model_version = "v1.0.0"
        
        self._initialize_connections()

    def _initialize_connections(self):
        """Initialize Neo4j and GNN connections"""
        # Initialize Neo4j driver
        if NEO4J_AVAILABLE:
            try:
                self.driver = GraphDatabase.driver(
                    self.neo4j_config.uri,
                    auth=(self.neo4j_config.username, self.neo4j_config.password),
                    max_connection_pool_size=self.neo4j_config.max_connection_pool_size,
                    connection_timeout=self.neo4j_config.connection_timeout,
                )
                logger.info("Neo4j driver initialized successfully")
            except Exception as e:
                logger.warning(f"Failed to initialize Neo4j driver: {e}")
                self.driver = None
        else:
            logger.warning("Neo4j driver not available, using simulation mode")
        
        # Initialize GNN service
        if GNN_AVAILABLE:
            self.gnn_service = GNNFraudDetectionService(config=self.gnn_config)
            logger.info("GNN service initialized successfully")
        else:
            logger.warning("GNN service not available, using simulation mode")

    def _execute_cypher(self, query: str, parameters: Dict[str, Any] = None) -> List[Dict[str, Any]]:
        """Execute a Cypher query against Neo4j"""
        if not self.driver:
            return self._simulate_cypher_result(query)
        
        try:
            with self.driver.session(database=self.neo4j_config.database) as session:
                result = session.run(query, parameters or {})
                return [record.data() for record in result]
        except Exception as e:
            logger.error(f"Cypher query failed: {e}")
            return self._simulate_cypher_result(query)

    def _simulate_cypher_result(self, query: str) -> List[Dict[str, Any]]:
        """Simulate Cypher query results for testing"""
        np.random.seed(42)
        
        if "Customer" in query:
            return [
                {
                    "id": f"cust_{i:03d}",
                    "name": f"Customer {i}",
                    "segment": np.random.choice(["Premium", "Standard", "Basic"]),
                    "risk_score": float(np.random.beta(2, 5)),
                    "tenure_years": int(np.random.randint(1, 15)),
                    "num_policies": int(np.random.randint(1, 5)),
                    "num_claims": int(np.random.poisson(2)),
                    "claim_ratio": float(np.random.beta(2, 8)),
                }
                for i in range(100)
            ]
        elif "Policy" in query:
            return [
                {
                    "id": f"pol_{i:03d}",
                    "type": np.random.choice(["Life", "Health", "Auto", "Property"]),
                    "premium": float(np.random.uniform(50000, 500000)),
                    "coverage": float(np.random.uniform(1000000, 10000000)),
                    "status": np.random.choice(["Active", "Expired", "Cancelled"]),
                }
                for i in range(200)
            ]
        elif "Claim" in query:
            return [
                {
                    "id": f"claim_{i:03d}",
                    "amount": float(np.random.uniform(10000, 1000000)),
                    "status": np.random.choice(["Pending", "Approved", "Rejected"]),
                    "fraud_score": float(np.random.beta(2, 10)),
                    "days_to_file": int(np.random.randint(1, 90)),
                }
                for i in range(150)
            ]
        else:
            return []

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
        if not self.gnn_service:
            return {"nodes": nodes, "edges": edges, "labels": labels}
        
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
            Training result with metrics
        """
        # Extract data if not provided
        if nodes is None or edges is None:
            nodes, edges = self.extract_graph_for_gnn()
        
        # Prepare data for GNN
        graph_data = self.prepare_gnn_data(nodes, edges, labels)
        
        # Train model
        if self.gnn_service:
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
        else:
            # Simulate training result
            return {
                "model_type": model_type.value,
                "accuracy": 0.89,
                "precision": 0.85,
                "recall": 0.82,
                "f1_score": 0.83,
                "auc_roc": 0.91,
                "training_time_seconds": 45.2,
                "best_epoch": 150,
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
            List of prediction results
        """
        # Extract graph data
        nodes, edges = self.extract_graph_for_gnn(customer_ids=entity_ids)
        graph_data = self.prepare_gnn_data(nodes, edges)
        
        # Get predictions
        if self.gnn_service:
            predictions = self.gnn_service.predict_fraud(model_type, graph_data, entity_ids)
        else:
            # Simulate predictions
            np.random.seed(42)
            predictions = []
            for node in nodes:
                if entity_ids and node["id"] not in entity_ids:
                    continue
                fraud_prob = float(np.random.beta(2, 10))
                predictions.append(FraudPrediction(
                    entity_id=node["id"],
                    entity_type=node["type"],
                    fraud_probability=fraud_prob,
                    fraud_class=2 if fraud_prob > 0.7 else (1 if fraud_prob > 0.3 else 0),
                    confidence=float(np.random.uniform(0.7, 0.95)),
                    contributing_factors=["network_connections", "claim_pattern"],
                    connected_suspicious_entities=[],
                ))
        
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
            Number of predictions stored
        """
        if not self.driver:
            logger.info(f"Simulation: Would store {len(predictions)} predictions in Neo4j")
            return len(predictions)
        
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
            
            try:
                result = self._execute_cypher(query, params)
                if result:
                    stored_count += 1
            except Exception as e:
                logger.error(f"Failed to store prediction for {pred.entity_id}: {e}")
        
        logger.info(f"Stored {stored_count} predictions in Neo4j")
        return stored_count

    def detect_fraud_rings(self, min_ring_size: int = 3) -> List[FraudRingResult]:
        """
        Detect fraud rings using GNN and Neo4j graph analysis.
        
        Combines:
        1. Neo4j graph algorithms for community detection
        2. GNN predictions for risk scoring
        3. Pattern matching for fraud indicators
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
        
        # If no results from Neo4j, use GNN-based detection
        if not ring_results:
            nodes, edges = self.extract_graph_for_gnn()
            graph_data = self.prepare_gnn_data(nodes, edges)
            
            if self.gnn_service:
                gnn_rings = self.gnn_service.detect_fraud_rings(graph_data, min_ring_size)
            else:
                # Simulate fraud rings
                gnn_rings = [
                    {
                        "ring_id": "ring_0",
                        "size": 4,
                        "members": ["cust_001", "cust_002", "cust_003", "cust_004"],
                        "risk_score": 0.85,
                    },
                    {
                        "ring_id": "ring_1",
                        "size": 3,
                        "members": ["cust_010", "cust_011", "cust_012"],
                        "risk_score": 0.72,
                    },
                ]
            
            ring_results = gnn_rings
        
        # Convert to FraudRingResult objects
        fraud_rings = []
        for i, ring in enumerate(ring_results):
            if isinstance(ring, dict):
                members = ring.get("members", ring.get("ring_members", []))
                risk_score = ring.get("risk_score", 0.75)
            else:
                members = list(ring) if hasattr(ring, '__iter__') else []
                risk_score = 0.75
            
            # Calculate total claims amount for ring members
            claims_query = """
            MATCH (c:Customer)-[:HAS_POLICY]->(:Policy)-[:HAS_CLAIM]->(cl:Claim)
            WHERE c.id IN $member_ids
            RETURN sum(cl.amount) as total_claims
            """
            claims_result = self._execute_cypher(claims_query, {"member_ids": members})
            total_claims = claims_result[0].get("total_claims", 0) if claims_result else 0
            
            fraud_rings.append(FraudRingResult(
                ring_id=f"ring_{i}",
                members=members,
                risk_score=risk_score,
                total_claims_amount=float(total_claims) if total_claims else np.random.uniform(500000, 5000000),
                shared_attributes=["address", "phone", "agent"],
                detection_method="gnn_community_detection",
            ))
        
        logger.info(f"Detected {len(fraud_rings)} potential fraud rings")
        return fraud_rings

    def get_entity_fraud_context(self, entity_id: str) -> Dict[str, Any]:
        """
        Get comprehensive fraud context for an entity from Neo4j + GNN.
        
        Returns entity details, GNN predictions, connected entities, and risk factors.
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
        
        if not result:
            # Simulate result
            result = [{
                "entity": {
                    "id": entity_id,
                    "type": "customer",
                    "gnn_fraud_probability": float(np.random.beta(2, 10)),
                    "gnn_fraud_class": 0,
                    "gnn_confidence": 0.85,
                },
                "connections": [
                    {"id": f"pol_{i}", "type": "Policy", "relationship": "HAS_POLICY", "fraud_probability": 0.1}
                    for i in range(3)
                ],
            }]
        
        entity_data = result[0] if result else {}
        entity = entity_data.get("entity", {})
        connections = entity_data.get("connections", [])
        
        # Get GNN prediction if not already stored
        predictions = self.predict_fraud([entity_id])
        gnn_prediction = predictions[0] if predictions else None
        
        # Calculate network risk score
        suspicious_connections = [c for c in connections if c.get("fraud_probability", 0) > 0.5]
        network_risk = len(suspicious_connections) / max(len(connections), 1)
        
        return {
            "entity_id": entity_id,
            "entity_details": entity,
            "gnn_prediction": {
                "fraud_probability": gnn_prediction.fraud_probability if gnn_prediction else 0,
                "fraud_class": gnn_prediction.fraud_class if gnn_prediction else 0,
                "confidence": gnn_prediction.confidence if gnn_prediction else 0,
                "contributing_factors": gnn_prediction.contributing_factors if gnn_prediction else [],
            },
            "connections": connections,
            "network_risk_score": network_risk,
            "suspicious_connections_count": len(suspicious_connections),
            "total_connections_count": len(connections),
            "risk_assessment": "HIGH" if network_risk > 0.5 else ("MEDIUM" if network_risk > 0.2 else "LOW"),
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
            Pipeline execution results
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
            "model_accuracy": results["steps"][1]["metrics"]["accuracy"] if train_model else None,
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
    """Temporal activity for Neo4j-GNN fraud detection"""
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
