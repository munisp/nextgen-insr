"""
GNN Training Loop for Fraud Ring Detection

Trains the GraphSAGE model on the insurance entity graph.
Handles graph construction from node/edge DataFrames,
feature encoding, and node-level classification.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from sklearn.metrics import roc_auc_score, f1_score, accuracy_score
from sklearn.preprocessing import StandardScaler

import sys
from pathlib import Path as _Path
sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
from models.gnn_fraud.model import FraudGNN


NODE_TYPE_MAP = {"customer": 0, "agent": 1, "claim": 2, "bank": 3}
EDGE_TYPE_MAP = {
    "shared_address": 0, "agent_customer": 1, "filed_claim": 2,
    "has_account": 3, "shared_bank": 4, "related_claim": 5,
}

NODE_NUMERIC_FEATURES = {
    "customer": ["n_policies", "total_premium", "n_claims", "risk_score"],
    "agent": ["n_customers", "total_premium_sold", "fraud_flag_count"],
    "claim": ["amount"],
    "bank": ["n_accounts"],
}


def build_graph_tensors(
    nodes_df: pd.DataFrame,
    edges_df: pd.DataFrame,
    feature_dim: int = 8,
) -> dict[str, torch.Tensor]:
    """Convert node/edge DataFrames to PyTorch tensors for GNN."""
    # Build node ID to index mapping
    node_ids = nodes_df["node_id"].tolist()
    id_to_idx = {nid: i for i, nid in enumerate(node_ids)}
    N = len(node_ids)

    # Node type IDs
    node_type_ids = torch.zeros(N, dtype=torch.long)
    for i, row in nodes_df.iterrows():
        ntype = row["node_type"]
        node_type_ids[i] = NODE_TYPE_MAP.get(ntype, 0)

    # Node features — pad to feature_dim
    node_features = torch.zeros(N, feature_dim)
    for i, row in nodes_df.iterrows():
        ntype = row["node_type"]
        feat_names = NODE_NUMERIC_FEATURES.get(ntype, [])
        for j, fn in enumerate(feat_names):
            if fn in row and j < feature_dim:
                val = row[fn]
                if isinstance(val, (int, float)) and not np.isnan(val):
                    node_features[i, j] = float(val)

    # Normalize features
    means = node_features.mean(dim=0, keepdim=True)
    stds = node_features.std(dim=0, keepdim=True).clamp(min=1e-6)
    node_features = (node_features - means) / stds

    # Labels (is_fraudulent)
    labels = torch.zeros(N, dtype=torch.float32)
    for i, row in nodes_df.iterrows():
        if "is_fraudulent" in row:
            labels[i] = float(row.get("is_fraudulent", 0))

    # Edge index — filter valid edges only
    src_list: list[int] = []
    dst_list: list[int] = []
    edge_types: list[int] = []

    for _, row in edges_df.iterrows():
        s = id_to_idx.get(row["source"])
        d = id_to_idx.get(row["target"])
        if s is not None and d is not None:
            src_list.append(s)
            dst_list.append(d)
            # Also add reverse edge for undirected message passing
            src_list.append(d)
            dst_list.append(s)
            etype = EDGE_TYPE_MAP.get(row["edge_type"], 0)
            edge_types.append(etype)
            edge_types.append(etype)

    edge_index = torch.tensor([src_list, dst_list], dtype=torch.long)
    edge_type_ids = torch.tensor(edge_types, dtype=torch.long)

    return {
        "node_features": node_features,
        "node_type_ids": node_type_ids,
        "edge_index": edge_index,
        "edge_type_ids": edge_type_ids,
        "labels": labels,
        "id_to_idx": id_to_idx,
        "node_ids": node_ids,
        "feature_means": means.squeeze(0).tolist(),
        "feature_stds": stds.squeeze(0).tolist(),
    }


def train_gnn(
    nodes_df: pd.DataFrame,
    edges_df: pd.DataFrame,
    n_epochs: int = 80,
    lr: float = 5e-3,
    weight_decay: float = 1e-4,
    patience: int = 15,
    save_dir: Path = Path("weights"),
    model_name: str = "fraud_gnn",
    feature_dim: int = 8,
    hidden_dim: int = 64,
) -> dict[str, Any]:
    """Train GNN on insurance entity graph."""
    save_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"Training GNN: {model_name}")
    print(f"{'='*60}")

    # Build graph
    print("Building graph tensors...")
    graph = build_graph_tensors(nodes_df, edges_df, feature_dim)
    N = graph["node_features"].size(0)
    E = graph["edge_index"].size(1)
    n_pos = int(graph["labels"].sum().item())
    print(f"  Nodes: {N}, Edges: {E}, Fraudulent: {n_pos} ({n_pos/N:.2%})")

    # Train/val/test split by node
    rng = np.random.default_rng(42)
    perm = rng.permutation(N)
    n_train = int(N * 0.7)
    n_val = int(N * 0.15)
    train_mask = torch.zeros(N, dtype=torch.bool)
    val_mask = torch.zeros(N, dtype=torch.bool)
    test_mask = torch.zeros(N, dtype=torch.bool)
    train_mask[perm[:n_train]] = True
    val_mask[perm[n_train:n_train + n_val]] = True
    test_mask[perm[n_train + n_val:]] = True

    # Model
    model = FraudGNN(
        node_feature_dim=feature_dim,
        hidden_dim=hidden_dim,
        n_layers=3,
        n_edge_types=len(EDGE_TYPE_MAP),
        n_node_types=len(NODE_TYPE_MAP),
    )

    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=weight_decay)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode="min", factor=0.5, patience=5,
    )

    # Class weight for imbalance
    pos_weight = torch.tensor([(N - n_pos) / max(n_pos, 1)])
    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)

    best_val_loss = float("inf")
    patience_counter = 0
    history: list[dict[str, Any]] = []
    start_time = time.time()

    node_features = graph["node_features"]
    node_type_ids = graph["node_type_ids"]
    edge_index = graph["edge_index"]
    labels = graph["labels"]

    for epoch in range(1, n_epochs + 1):
        # Train
        model.train()
        optimizer.zero_grad()
        logits = model(node_features, node_type_ids, edge_index)
        train_loss = criterion(logits[train_mask], labels[train_mask])
        train_loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()

        # Validate
        model.eval()
        with torch.no_grad():
            logits = model(node_features, node_type_ids, edge_index)
            val_loss = criterion(logits[val_mask], labels[val_mask])
            val_probs = torch.sigmoid(logits[val_mask]).numpy()
            val_labels = labels[val_mask].numpy()

        scheduler.step(val_loss.item())

        val_preds = (val_probs >= 0.5).astype(int)
        auc = float(roc_auc_score(val_labels, val_probs)) if len(np.unique(val_labels)) > 1 else 0.0
        f1 = float(f1_score(val_labels, val_preds, zero_division=0))

        metrics = {
            "epoch": epoch,
            "train_loss": round(train_loss.item(), 4),
            "val_loss": round(val_loss.item(), 4),
            "auc": round(auc, 4),
            "f1": round(f1, 4),
        }
        history.append(metrics)

        if epoch % 5 == 0 or epoch == 1:
            print(
                f"  [GNN] Epoch {epoch:3d}/{n_epochs} | "
                f"train_loss={metrics['train_loss']:.4f} val_loss={metrics['val_loss']:.4f} | "
                f"AUC={auc:.4f} F1={f1:.4f}"
            )

        if val_loss.item() < best_val_loss:
            best_val_loss = val_loss.item()
            patience_counter = 0
            torch.save(model.state_dict(), save_dir / f"{model_name}.pt")
        else:
            patience_counter += 1
            if patience_counter >= patience:
                print(f"  [GNN] Early stopping at epoch {epoch}")
                break

    total_time = time.time() - start_time
    model.load_state_dict(torch.load(save_dir / f"{model_name}.pt", weights_only=True))

    # Test evaluation
    model.eval()
    with torch.no_grad():
        logits = model(node_features, node_type_ids, edge_index)
        test_probs = torch.sigmoid(logits[test_mask]).numpy()
        test_labels = labels[test_mask].numpy()

    test_preds = (test_probs >= 0.5).astype(int)
    test_auc = float(roc_auc_score(test_labels, test_probs)) if len(np.unique(test_labels)) > 1 else 0.0
    test_f1 = float(f1_score(test_labels, test_preds, zero_division=0))
    test_acc = float(accuracy_score(test_labels, test_preds))

    result = {
        "model_name": model_name,
        "test_auc": round(test_auc, 4),
        "test_f1": round(test_f1, 4),
        "test_accuracy": round(test_acc, 4),
        "n_nodes": N,
        "n_edges": E,
        "n_fraudulent": n_pos,
        "total_epochs": epoch,
        "total_time_s": round(total_time, 2),
        "feature_means": graph["feature_means"],
        "feature_stds": graph["feature_stds"],
        "history": history,
    }

    with open(save_dir / f"{model_name}_metadata.json", "w") as f:
        json.dump(result, f, indent=2)

    print(
        f"\n  [GNN] Final test: AUC={test_auc:.4f} F1={test_f1:.4f} "
        f"Accuracy={test_acc:.4f} time={total_time:.1f}s"
    )

    return result
