"""
GNN (Graph Neural Networks) for Insurance Fraud Detection

This module implements graph neural networks for fraud detection in insurance,
using node classification and link prediction on customer/claim networks.

NO SIMULATED RESULTS: training and prediction require torch_geometric and a
trained model. When torch_geometric is unavailable or no model has been
trained, methods raise RuntimeError instead of returning fabricated accuracy
metrics or random fraud probabilities.
"""

import os
import json
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import logging

# PyTorch Geometric imports (would be installed via pip install torch-geometric)
try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    from torch_geometric.nn import GCNConv, GATConv, SAGEConv, GraphConv
    from torch_geometric.data import Data, DataLoader
    from torch_geometric.utils import to_networkx, from_networkx
    TORCH_GEOMETRIC_AVAILABLE = True
except ImportError:
    TORCH_GEOMETRIC_AVAILABLE = False
    # Create mock classes for type hints
    class nn:
        class Module:
            pass

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class GNNModelType(Enum):
    """Types of GNN models"""
    GCN = "graph_convolutional_network"
    GAT = "graph_attention_network"
    SAGE = "graphsage"
    CUSTOM = "custom_insurance_gnn"


@dataclass
class GNNConfig:
    """Configuration for GNN model"""
    hidden_channels: int = 64
    num_layers: int = 3
    dropout: float = 0.3
    learning_rate: float = 0.01
    epochs: int = 200
    batch_size: int = 32
    attention_heads: int = 4  # For GAT


@dataclass
class FraudPrediction:
    """Fraud prediction result"""
    entity_id: str
    entity_type: str
    fraud_probability: float
    fraud_class: int  # 0: legitimate, 1: suspicious, 2: fraudulent
    confidence: float
    contributing_factors: List[str]
    connected_suspicious_entities: List[str]


@dataclass
class GNNTrainingResult:
    """Result from GNN training"""
    model_type: str
    accuracy: float
    precision: float
    recall: float
    f1_score: float
    auc_roc: float
    training_loss_history: List[float]
    validation_loss_history: List[float]
    best_epoch: int
    training_time_seconds: float


class InsuranceFraudGCN(nn.Module if TORCH_GEOMETRIC_AVAILABLE else object):
    """Graph Convolutional Network for insurance fraud detection"""

    def __init__(self, in_channels: int, hidden_channels: int, out_channels: int, num_layers: int = 3, dropout: float = 0.3):
        if not TORCH_GEOMETRIC_AVAILABLE:
            return
        super().__init__()

        self.convs = nn.ModuleList()
        self.bns = nn.ModuleList()

        # Input layer
        self.convs.append(GCNConv(in_channels, hidden_channels))
        self.bns.append(nn.BatchNorm1d(hidden_channels))

        # Hidden layers
        for _ in range(num_layers - 2):
            self.convs.append(GCNConv(hidden_channels, hidden_channels))
            self.bns.append(nn.BatchNorm1d(hidden_channels))

        # Output layer
        self.convs.append(GCNConv(hidden_channels, out_channels))

        self.dropout = dropout

    def forward(self, x, edge_index):
        if not TORCH_GEOMETRIC_AVAILABLE:
            return None

        for i, (conv, bn) in enumerate(zip(self.convs[:-1], self.bns)):
            x = conv(x, edge_index)
            x = bn(x)
            x = F.relu(x)
            x = F.dropout(x, p=self.dropout, training=self.training)

        x = self.convs[-1](x, edge_index)
        return F.log_softmax(x, dim=1)


class InsuranceFraudGAT(nn.Module if TORCH_GEOMETRIC_AVAILABLE else object):
    """Graph Attention Network for insurance fraud detection"""

    def __init__(self, in_channels: int, hidden_channels: int, out_channels: int, num_layers: int = 3, heads: int = 4, dropout: float = 0.3):
        if not TORCH_GEOMETRIC_AVAILABLE:
            return
        super().__init__()

        self.convs = nn.ModuleList()
        self.bns = nn.ModuleList()

        # Input layer
        self.convs.append(GATConv(in_channels, hidden_channels, heads=heads, dropout=dropout))
        self.bns.append(nn.BatchNorm1d(hidden_channels * heads))

        # Hidden layers
        for _ in range(num_layers - 2):
            self.convs.append(GATConv(hidden_channels * heads, hidden_channels, heads=heads, dropout=dropout))
            self.bns.append(nn.BatchNorm1d(hidden_channels * heads))

        # Output layer
        self.convs.append(GATConv(hidden_channels * heads, out_channels, heads=1, concat=False, dropout=dropout))

        self.dropout = dropout

    def forward(self, x, edge_index):
        if not TORCH_GEOMETRIC_AVAILABLE:
            return None

        for i, (conv, bn) in enumerate(zip(self.convs[:-1], self.bns)):
            x = conv(x, edge_index)
            x = bn(x)
            x = F.elu(x)
            x = F.dropout(x, p=self.dropout, training=self.training)

        x = self.convs[-1](x, edge_index)
        return F.log_softmax(x, dim=1)


class InsuranceFraudSAGE(nn.Module if TORCH_GEOMETRIC_AVAILABLE else object):
    """GraphSAGE for insurance fraud detection"""

    def __init__(self, in_channels: int, hidden_channels: int, out_channels: int, num_layers: int = 3, dropout: float = 0.3):
        if not TORCH_GEOMETRIC_AVAILABLE:
            return
        super().__init__()

        self.convs = nn.ModuleList()
        self.bns = nn.ModuleList()

        # Input layer
        self.convs.append(SAGEConv(in_channels, hidden_channels))
        self.bns.append(nn.BatchNorm1d(hidden_channels))

        # Hidden layers
        for _ in range(num_layers - 2):
            self.convs.append(SAGEConv(hidden_channels, hidden_channels))
            self.bns.append(nn.BatchNorm1d(hidden_channels))

        # Output layer
        self.convs.append(SAGEConv(hidden_channels, out_channels))

        self.dropout = dropout

    def forward(self, x, edge_index):
        if not TORCH_GEOMETRIC_AVAILABLE:
            return None

        for i, (conv, bn) in enumerate(zip(self.convs[:-1], self.bns)):
            x = conv(x, edge_index)
            x = bn(x)
            x = F.relu(x)
            x = F.dropout(x, p=self.dropout, training=self.training)

        x = self.convs[-1](x, edge_index)
        return F.log_softmax(x, dim=1)


class GNNFraudDetectionService:
    """
    Service for GNN-based fraud detection in insurance.

    Requires torch_geometric. Training and prediction raise RuntimeError when
    the dependency or a trained model is unavailable — simulated training
    metrics and random predictions have been removed.
    """

    def __init__(self, config: GNNConfig = None):
        self.config = config or GNNConfig()
        self.torch_geometric_available = TORCH_GEOMETRIC_AVAILABLE
        self.models: Dict[str, Any] = {}
        self.device = "cuda" if TORCH_GEOMETRIC_AVAILABLE and torch.cuda.is_available() else "cpu"

        # Insurance-specific feature definitions
        self.node_features = {
            "customer": [
                "age", "tenure_years", "num_policies", "num_claims",
                "claim_ratio", "premium_paid", "risk_score", "segment_encoded"
            ],
            "policy": [
                "premium_amount", "coverage_amount", "policy_age_days",
                "num_claims", "claim_amount_total", "risk_category_encoded"
            ],
            "claim": [
                "claim_amount", "days_to_file", "document_count",
                "fraud_score", "adjuster_changes", "status_encoded"
            ],
        }

        # Edge types for insurance graph
        self.edge_types = [
            ("customer", "has_policy", "policy"),
            ("policy", "has_claim", "claim"),
            ("customer", "related_to", "customer"),
            ("customer", "shares_address", "customer"),
            ("customer", "shares_phone", "customer"),
            ("claim", "similar_to", "claim"),
        ]

    def _require_torch_geometric(self) -> None:
        if not self.torch_geometric_available:
            raise RuntimeError(
                "torch_geometric is required for GNN fraud detection; "
                "simulated training/prediction is disabled. "
                "Install torch and torch-geometric."
            )

    def _create_model(self, model_type: GNNModelType, in_channels: int, out_channels: int) -> Any:
        """Create GNN model based on type"""
        self._require_torch_geometric()

        if model_type == GNNModelType.GCN:
            return InsuranceFraudGCN(
                in_channels=in_channels,
                hidden_channels=self.config.hidden_channels,
                out_channels=out_channels,
                num_layers=self.config.num_layers,
                dropout=self.config.dropout,
            )
        elif model_type == GNNModelType.GAT:
            return InsuranceFraudGAT(
                in_channels=in_channels,
                hidden_channels=self.config.hidden_channels,
                out_channels=out_channels,
                num_layers=self.config.num_layers,
                heads=self.config.attention_heads,
                dropout=self.config.dropout,
            )
        elif model_type == GNNModelType.SAGE:
            return InsuranceFraudSAGE(
                in_channels=in_channels,
                hidden_channels=self.config.hidden_channels,
                out_channels=out_channels,
                num_layers=self.config.num_layers,
                dropout=self.config.dropout,
            )
        else:
            # Default to GCN
            return InsuranceFraudGCN(
                in_channels=in_channels,
                hidden_channels=self.config.hidden_channels,
                out_channels=out_channels,
                num_layers=self.config.num_layers,
                dropout=self.config.dropout,
            )

    def prepare_graph_data(
        self,
        nodes: List[Dict[str, Any]],
        edges: List[Tuple[str, str, str]],
        labels: Optional[Dict[str, int]] = None,
    ) -> Any:
        """Prepare graph data for GNN training/inference"""

        # Create node ID mapping
        node_ids = [n["id"] for n in nodes]
        id_to_idx = {nid: idx for idx, nid in enumerate(node_ids)}

        # Extract node features
        num_features = 8  # Default feature dimension
        node_features = []

        for node in nodes:
            features = []
            node_type = node.get("type", "customer")

            for feature_name in self.node_features.get(node_type, self.node_features["customer"]):
                value = node.get("properties", {}).get(feature_name, 0.0)
                if isinstance(value, (int, float)):
                    features.append(float(value))
                else:
                    features.append(0.0)

            # Pad or truncate to fixed size
            while len(features) < num_features:
                features.append(0.0)
            features = features[:num_features]

            node_features.append(features)

        # Create edge index
        edge_index = []
        for source_id, target_id, edge_type in edges:
            if source_id in id_to_idx and target_id in id_to_idx:
                edge_index.append([id_to_idx[source_id], id_to_idx[target_id]])
                # Add reverse edge for undirected graph
                edge_index.append([id_to_idx[target_id], id_to_idx[source_id]])

        if not edge_index:
            # Add self-loops if no edges
            edge_index = [[i, i] for i in range(len(nodes))]

        # Create labels
        if labels:
            y = [labels.get(nid, 0) for nid in node_ids]
        else:
            y = [0] * len(nodes)

        if self.torch_geometric_available:
            x = torch.tensor(node_features, dtype=torch.float)
            edge_index_tensor = torch.tensor(edge_index, dtype=torch.long).t().contiguous()
            y_tensor = torch.tensor(y, dtype=torch.long)

            data = Data(x=x, edge_index=edge_index_tensor, y=y_tensor)
            data.node_ids = node_ids
            data.id_to_idx = id_to_idx

            return data
        else:
            return {
                "node_features": np.array(node_features),
                "edge_index": np.array(edge_index).T if edge_index else np.array([[0], [0]]),
                "labels": np.array(y),
                "node_ids": node_ids,
                "id_to_idx": id_to_idx,
            }

    def train_model(
        self,
        model_type: GNNModelType,
        train_data: Any,
        val_data: Optional[Any] = None,
    ) -> GNNTrainingResult:
        """Train GNN model for fraud detection.

        Raises RuntimeError when torch_geometric is unavailable — no
        simulated training metrics are produced.
        """
        self._require_torch_geometric()
        start_time = datetime.utcnow()

        # Get data dimensions
        in_channels = train_data.x.shape[1]
        out_channels = 3  # 0: legitimate, 1: suspicious, 2: fraudulent

        # Create model
        model = self._create_model(model_type, in_channels, out_channels)
        model = model.to(self.device)
        train_data = train_data.to(self.device)

        # Optimizer
        optimizer = torch.optim.Adam(model.parameters(), lr=self.config.learning_rate, weight_decay=5e-4)

        # Training loop
        training_loss_history = []
        validation_loss_history = []
        best_val_loss = float('inf')
        best_epoch = 0

        for epoch in range(self.config.epochs):
            model.train()
            optimizer.zero_grad()

            out = model(train_data.x, train_data.edge_index)
            loss = F.nll_loss(out, train_data.y)

            loss.backward()
            optimizer.step()

            training_loss_history.append(loss.item())

            # Validation
            if val_data is not None:
                model.eval()
                with torch.no_grad():
                    val_data = val_data.to(self.device)
                    val_out = model(val_data.x, val_data.edge_index)
                    val_loss = F.nll_loss(val_out, val_data.y)
                    validation_loss_history.append(val_loss.item())

                    if val_loss < best_val_loss:
                        best_val_loss = val_loss
                        best_epoch = epoch

        # Evaluate final model
        model.eval()
        with torch.no_grad():
            out = model(train_data.x, train_data.edge_index)
            pred = out.argmax(dim=1)

            correct = (pred == train_data.y).sum().item()
            accuracy = correct / len(train_data.y)

            # Calculate metrics
            y_true = train_data.y.cpu().numpy()
            y_pred = pred.cpu().numpy()

            precision, recall, f1, auc = self._calculate_metrics(y_true, y_pred)

        # Store model
        self.models[model_type.value] = model

        training_time = (datetime.utcnow() - start_time).total_seconds()

        return GNNTrainingResult(
            model_type=model_type.value,
            accuracy=accuracy,
            precision=precision,
            recall=recall,
            f1_score=f1,
            auc_roc=auc,
            training_loss_history=training_loss_history,
            validation_loss_history=validation_loss_history,
            best_epoch=best_epoch,
            training_time_seconds=training_time,
        )

    def _calculate_metrics(self, y_true: np.ndarray, y_pred: np.ndarray) -> Tuple[float, float, float, float]:
        """Calculate classification metrics"""
        # Precision
        true_positives = np.sum((y_pred == 1) & (y_true == 1)) + np.sum((y_pred == 2) & (y_true == 2))
        predicted_positives = np.sum(y_pred > 0)
        precision = true_positives / predicted_positives if predicted_positives > 0 else 0.0

        # Recall
        actual_positives = np.sum(y_true > 0)
        recall = true_positives / actual_positives if actual_positives > 0 else 0.0

        # F1
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

        # AUC (simplified)
        auc = (precision + recall) / 2

        return precision, recall, f1, auc

    def predict_fraud(
        self,
        model_type: GNNModelType,
        graph_data: Any,
        entity_ids: Optional[List[str]] = None,
    ) -> List[FraudPrediction]:
        """Predict fraud for entities in the graph.

        Raises RuntimeError when torch_geometric is unavailable or the
        requested model has not been trained — no fabricated probabilities.
        """
        self._require_torch_geometric()

        model = self.models.get(model_type.value)
        if model is None:
            raise RuntimeError(
                f"GNN model '{model_type.value}' is not trained. "
                "Call train_model() or load trained weights before predicting; "
                "simulated predictions are disabled."
            )

        model.eval()
        graph_data = graph_data.to(self.device)

        with torch.no_grad():
            out = model(graph_data.x, graph_data.edge_index)
            probs = torch.exp(out)
            pred_classes = out.argmax(dim=1)

        predictions = []
        node_ids = graph_data.node_ids

        for idx, node_id in enumerate(node_ids):
            if entity_ids is not None and node_id not in entity_ids:
                continue

            fraud_prob = probs[idx][2].item()  # Probability of class 2 (fraudulent)
            suspicious_prob = probs[idx][1].item()  # Probability of class 1 (suspicious)

            # Determine contributing factors based on node features
            contributing_factors = self._identify_contributing_factors(
                graph_data.x[idx].cpu().numpy()
            )

            # Find connected suspicious entities
            connected_suspicious = self._find_connected_suspicious(
                idx, graph_data.edge_index, pred_classes, node_ids
            )

            predictions.append(FraudPrediction(
                entity_id=node_id,
                entity_type="customer",
                fraud_probability=fraud_prob + suspicious_prob,
                fraud_class=pred_classes[idx].item(),
                confidence=max(probs[idx]).item(),
                contributing_factors=contributing_factors,
                connected_suspicious_entities=connected_suspicious,
            ))

        return predictions

    def _identify_contributing_factors(self, features: np.ndarray) -> List[str]:
        """Identify factors contributing to fraud prediction"""
        factors = []
        feature_names = self.node_features["customer"]

        # Check for anomalous features
        for i, (name, value) in enumerate(zip(feature_names, features)):
            if name == "claim_ratio" and value > 0.5:
                factors.append("high_claim_ratio")
            elif name == "risk_score" and value > 0.7:
                factors.append("high_risk_score")
            elif name == "num_claims" and value > 5:
                factors.append("high_claim_frequency")

        if not factors:
            factors.append("network_connections")

        return factors

    def _find_connected_suspicious(
        self,
        node_idx: int,
        edge_index: Any,
        pred_classes: Any,
        node_ids: List[str],
    ) -> List[str]:
        """Find connected entities that are suspicious or fraudulent"""
        suspicious = []

        if self.torch_geometric_available:
            edge_index_np = edge_index.cpu().numpy()
            pred_classes_np = pred_classes.cpu().numpy()
        else:
            return []

        # Find neighbors
        neighbors = edge_index_np[1, edge_index_np[0] == node_idx]

        for neighbor_idx in neighbors:
            if pred_classes_np[neighbor_idx] > 0:  # Suspicious or fraudulent
                suspicious.append(node_ids[neighbor_idx])

        return suspicious[:5]  # Limit to top 5

    def detect_fraud_rings(
        self,
        graph_data: Any,
        min_ring_size: int = 3,
        model_type: Optional[GNNModelType] = None,
    ) -> List[Dict[str, Any]]:
        """Detect potential fraud rings in the graph.

        Requires torch_geometric and networkx. Risk scores are computed from
        a trained model's fraud probabilities when available; otherwise the
        ring is reported without a score (never fabricated).
        """
        self._require_torch_geometric()

        try:
            import networkx as nx
        except ImportError as e:
            raise RuntimeError(
                "networkx is required for fraud ring detection; "
                "simulated fraud rings are disabled."
            ) from e

        # Convert to networkx for ring detection
        G = to_networkx(graph_data, to_undirected=True)

        # Find cycles (potential fraud rings)
        cycles = []
        try:
            for cycle in nx.simple_cycles(G):
                if len(cycle) >= min_ring_size:
                    cycles.append(cycle)
        except Exception:
            # Fall back to connected components
            for component in nx.connected_components(G):
                if len(component) >= min_ring_size:
                    cycles.append(list(component))

        # Mean predicted fraud probability per node, if a trained model exists
        fraud_probs: Optional[np.ndarray] = None
        model = self.models.get(model_type.value) if model_type else None
        if model is None and self.models:
            model = next(iter(self.models.values()))
        if model is not None:
            model.eval()
            with torch.no_grad():
                out = model(graph_data.x, graph_data.edge_index)
                probs = torch.exp(out)
                fraud_probs = (probs[:, 1] + probs[:, 2]).cpu().numpy()

        fraud_rings = []
        node_ids = graph_data.node_ids

        for i, cycle in enumerate(cycles[:10]):  # Limit to top 10
            ring_nodes = [node_ids[idx] for idx in cycle if idx < len(node_ids)]
            member_idx = [idx for idx in cycle if idx < len(node_ids)]

            risk_score = None
            if fraud_probs is not None and member_idx:
                risk_score = float(np.mean(fraud_probs[member_idx]))

            fraud_rings.append({
                "ring_id": f"ring_{i}",
                "size": len(ring_nodes),
                "members": ring_nodes,
                "risk_score": risk_score,
                "risk_score_source": (
                    "trained_gnn_mean_fraud_probability"
                    if risk_score is not None else "unavailable_no_trained_model"
                ),
                "detection_method": "cycle_detection",
            })

        return fraud_rings

    def link_prediction(
        self,
        graph_data: Any,
        source_id: str,
        top_k: int = 10,
    ) -> List[Dict[str, Any]]:
        """Predict potential links (relationships) for an entity.

        Raises RuntimeError when torch_geometric is unavailable — no
        simulated link predictions.
        """
        self._require_torch_geometric()

        # Simple link prediction based on node similarity
        node_ids = graph_data.node_ids
        id_to_idx = graph_data.id_to_idx

        if source_id not in id_to_idx:
            return []

        source_idx = id_to_idx[source_id]
        source_features = graph_data.x[source_idx].cpu().numpy()

        # Calculate similarity with all other nodes
        similarities = []
        for idx, node_id in enumerate(node_ids):
            if node_id == source_id:
                continue

            target_features = graph_data.x[idx].cpu().numpy()
            similarity = np.dot(source_features, target_features) / (
                np.linalg.norm(source_features) * np.linalg.norm(target_features) + 1e-8
            )

            similarities.append({
                "target_id": node_id,
                "similarity_score": float(similarity),
                "predicted_relationship": "related_to",
            })

        # Sort by similarity and return top_k
        similarities.sort(key=lambda x: x["similarity_score"], reverse=True)
        return similarities[:top_k]

    def explain_prediction(
        self,
        graph_data: Any,
        entity_id: str,
    ) -> Dict[str, Any]:
        """Explain fraud prediction for an entity"""

        if isinstance(graph_data, dict):
            node_ids = graph_data.get("node_ids", [])
            id_to_idx = graph_data.get("id_to_idx", {})
            features = graph_data.get("node_features", np.array([]))
        else:
            node_ids = getattr(graph_data, "node_ids", [])
            id_to_idx = getattr(graph_data, "id_to_idx", {})
            if self.torch_geometric_available:
                features = graph_data.x.cpu().numpy()
            else:
                features = np.array([])

        if entity_id not in id_to_idx:
            return {"error": f"Entity {entity_id} not found"}

        idx = id_to_idx[entity_id]
        entity_features = features[idx] if len(features) > idx else np.zeros(8)

        # Feature importance (simplified)
        feature_names = self.node_features["customer"]
        feature_importance = {}

        for i, name in enumerate(feature_names):
            if i < len(entity_features):
                importance = abs(entity_features[i]) / (np.sum(np.abs(entity_features)) + 1e-8)
                feature_importance[name] = float(importance)

        return {
            "entity_id": entity_id,
            "feature_importance": feature_importance,
            "top_contributing_features": sorted(
                feature_importance.items(),
                key=lambda x: x[1],
                reverse=True
            )[:5],
            "explanation": "Fraud prediction based on node features and graph structure",
        }


# Factory function
def create_gnn_fraud_service(
    hidden_channels: int = 64,
    num_layers: int = 3,
) -> GNNFraudDetectionService:
    """Create GNN fraud detection service"""
    config = GNNConfig(hidden_channels=hidden_channels, num_layers=num_layers)
    return GNNFraudDetectionService(config=config)


# Temporal Activity for GNN fraud detection
async def gnn_fraud_detection_activity(
    nodes: List[Dict[str, Any]],
    edges: List[Tuple[str, str, str]],
    labels: Optional[Dict[str, int]] = None,
    model_type: str = "gcn",
) -> Dict[str, Any]:
    """Temporal activity for GNN-based fraud detection.

    Raises RuntimeError when torch_geometric is unavailable — simulated
    training metrics and predictions are disabled.
    """
    service = GNNFraudDetectionService()

    # Prepare data
    graph_data = service.prepare_graph_data(nodes, edges, labels)

    # Train model
    model_type_enum = GNNModelType.GCN
    if model_type == "gat":
        model_type_enum = GNNModelType.GAT
    elif model_type == "sage":
        model_type_enum = GNNModelType.SAGE

    training_result = service.train_model(model_type_enum, graph_data)

    # Get predictions
    predictions = service.predict_fraud(model_type_enum, graph_data)

    # Detect fraud rings
    fraud_rings = service.detect_fraud_rings(graph_data, model_type=model_type_enum)

    return {
        "training_result": {
            "accuracy": training_result.accuracy,
            "f1_score": training_result.f1_score,
            "auc_roc": training_result.auc_roc,
        },
        "predictions_count": len(predictions),
        "high_risk_entities": [p.entity_id for p in predictions if p.fraud_probability > 0.5],
        "fraud_rings_detected": len(fraud_rings),
        "simulated": False,
    }
