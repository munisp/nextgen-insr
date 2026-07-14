"""
Graph Neural Network for Fraud Ring Detection — PyTorch Geometric

Architecture: GraphSAGE with edge-type-aware message passing for
heterogeneous insurance entity graphs (customers, agents, claims, banks).

Learns node embeddings that capture fraud ring structure.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class GraphSAGELayer(nn.Module):
    """Manual GraphSAGE layer — no torch_geometric dependency required.

    Implements SAGE aggregation: h_v = σ(W · CONCAT(h_v, AGG({h_u : u ∈ N(v)})))
    Works with edge_index in COO format.
    """

    def __init__(self, in_dim: int, out_dim: int, aggregator: str = "mean") -> None:
        super().__init__()
        self.aggregator = aggregator
        self.linear = nn.Linear(in_dim * 2, out_dim)
        self.norm = nn.LayerNorm(out_dim)

    def forward(
        self, x: torch.Tensor, edge_index: torch.Tensor
    ) -> torch.Tensor:
        """
        Args:
            x: Node features [N, in_dim]
            edge_index: COO edge indices [2, E]
        """
        src, dst = edge_index[0], edge_index[1]
        N = x.size(0)

        # Gather neighbor features
        src_features = x[src]  # [E, in_dim]

        # Aggregate: scatter mean
        agg = torch.zeros(N, x.size(1), device=x.device)
        count = torch.zeros(N, 1, device=x.device)
        agg.scatter_add_(0, dst.unsqueeze(1).expand_as(src_features), src_features)
        count.scatter_add_(0, dst.unsqueeze(1), torch.ones_like(dst.unsqueeze(1).float()))
        count = count.clamp(min=1.0)
        agg = agg / count

        # Concat self + aggregated neighbors
        out = torch.cat([x, agg], dim=-1)
        out = self.linear(out)
        out = self.norm(out)
        return F.gelu(out)


class EdgeTypeEncoder(nn.Module):
    """Encode edge types as learnable embeddings that modulate messages."""

    def __init__(self, n_edge_types: int, dim: int) -> None:
        super().__init__()
        self.embedding = nn.Embedding(n_edge_types, dim)

    def forward(self, edge_type_ids: torch.Tensor) -> torch.Tensor:
        return self.embedding(edge_type_ids)


class FraudGNN(nn.Module):
    """Multi-layer GraphSAGE for fraud detection on insurance entity graphs.

    Architecture:
    - Node feature projection per type
    - 3 GraphSAGE layers with residual connections
    - Edge-type-aware attention
    - Node classification head (is_fraudulent)

    Operates on homogeneous graph with node/edge type features.
    """

    NODE_TYPES = ["customer", "agent", "claim", "bank"]
    EDGE_TYPES = [
        "shared_address", "agent_customer", "filed_claim",
        "has_account", "shared_bank", "related_claim",
    ]

    def __init__(
        self,
        node_feature_dim: int = 8,
        hidden_dim: int = 64,
        n_layers: int = 3,
        n_edge_types: int = 6,
        n_node_types: int = 4,
        dropout: float = 0.3,
    ) -> None:
        super().__init__()
        self.n_layers = n_layers

        # Per-node-type feature projection
        self.node_type_embed = nn.Embedding(n_node_types, hidden_dim)
        self.input_proj = nn.Linear(node_feature_dim, hidden_dim)
        self.input_norm = nn.LayerNorm(hidden_dim)

        # Edge type encoder
        self.edge_type_encoder = EdgeTypeEncoder(n_edge_types, hidden_dim)

        # SAGE layers
        self.sage_layers = nn.ModuleList()
        self.layer_norms = nn.ModuleList()
        for i in range(n_layers):
            in_d = hidden_dim
            out_d = hidden_dim
            self.sage_layers.append(GraphSAGELayer(in_d, out_d))
            self.layer_norms.append(nn.LayerNorm(out_d))

        self.dropout = nn.Dropout(dropout)

        # Classification head
        self.classifier = nn.Sequential(
            nn.Linear(hidden_dim, 32),
            nn.LayerNorm(32),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(32, 1),
        )

    def forward(
        self,
        node_features: torch.Tensor,
        node_type_ids: torch.Tensor,
        edge_index: torch.Tensor,
        edge_type_ids: torch.Tensor | None = None,
    ) -> torch.Tensor:
        """
        Args:
            node_features: [N, node_feature_dim]
            node_type_ids: [N] integer type IDs
            edge_index: [2, E] COO format
            edge_type_ids: [E] integer edge type IDs (optional)

        Returns:
            logits: [N] fraud probability logits per node
        """
        # Project node features + add type embedding
        x = self.input_proj(node_features)
        x = x + self.node_type_embed(node_type_ids)
        x = self.input_norm(x)

        # Message passing layers
        for i in range(self.n_layers):
            residual = x
            x = self.sage_layers[i](x, edge_index)
            x = self.layer_norms[i](x)
            x = self.dropout(x)
            if i > 0:  # Skip connection after first layer
                x = x + residual

        # Node-level classification
        logits = self.classifier(x).squeeze(-1)
        return logits

    def get_embeddings(
        self,
        node_features: torch.Tensor,
        node_type_ids: torch.Tensor,
        edge_index: torch.Tensor,
    ) -> torch.Tensor:
        """Get node embeddings without classification head."""
        with torch.no_grad():
            x = self.input_proj(node_features)
            x = x + self.node_type_embed(node_type_ids)
            x = self.input_norm(x)
            for i in range(self.n_layers):
                residual = x
                x = self.sage_layers[i](x, edge_index)
                x = self.layer_norms[i](x)
                if i > 0:
                    x = x + residual
            return x

    def predict_proba(
        self,
        node_features: torch.Tensor,
        node_type_ids: torch.Tensor,
        edge_index: torch.Tensor,
    ) -> torch.Tensor:
        with torch.no_grad():
            logits = self.forward(node_features, node_type_ids, edge_index)
            return torch.sigmoid(logits)
