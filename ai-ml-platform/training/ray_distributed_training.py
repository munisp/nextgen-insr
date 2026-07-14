import os
import psycopg2
import psycopg2.extras
import logging

logger = logging.getLogger(__name__)

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://ngapp:ngapp@localhost:5432/ngapp")
_db_conn = None

def get_db():
    global _db_conn
    if _db_conn is None or _db_conn.closed:
        try:
            _db_conn = psycopg2.connect(DATABASE_URL)
            _db_conn.autocommit = True
        except Exception as e:
            logger.warning(f"Database connection failed: {e}")
            return None
    return _db_conn

"""
Ray Distributed Training for InsurePortal AI/ML Models

Uses Ray for distributed hyperparameter tuning and model training.
Designed to scale across multiple nodes in production.

Usage:
    # Local (single node):
    python ray_distributed_training.py

    # Cluster:
    ray start --head
    python ray_distributed_training.py --address=auto
"""

import os
import json
import time
import argparse
import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import f1_score

try:
    import ray
    from ray import tune
    from ray.tune.schedulers import ASHAScheduler
    RAY_AVAILABLE = True
except ImportError:
    RAY_AVAILABLE = False
    print("Ray not installed. Install with: pip install 'ray[tune]'")

# Import model architectures from train_models
from train_models import (
    FraudDetectionNet, ClaimsAdjudicationNet, ChurnPredictionNet,
    AnomalyDetectionAutoencoder, load_and_prepare_data, MODEL_REGISTRY
)


def train_with_config(config: Dict, model_class, dataset_name: str, target_col: str):
    """Training function for Ray Tune hyperparameter search."""
    train_loader, test_loader, scaler, input_dim = load_and_prepare_data(dataset_name, target_col)

    if model_class == FraudDetectionNet:
        model = model_class(input_dim=input_dim, hidden_dims=config.get("hidden_dims", [128, 64, 32]))
    elif model_class == ClaimsAdjudicationNet:
        model = model_class(input_dim=input_dim, hidden_dims=config.get("hidden_dims", [128, 96, 64, 32]))
    elif model_class == ChurnPredictionNet:
        model = model_class(input_dim=input_dim, hidden_dims=config.get("hidden_dims", [128, 64, 32]))
    else:
        model = model_class(input_dim=input_dim)

    optimizer = optim.Adam(model.parameters(), lr=config["lr"], weight_decay=config.get("weight_decay", 1e-4))
    criterion = nn.CrossEntropyLoss()

    for epoch in range(config.get("epochs", 30)):
        model.train()
        for X_batch, y_batch in train_loader:
            optimizer.zero_grad()
            logits = model(X_batch)
            loss = criterion(logits, y_batch)
            loss.backward()
            optimizer.step()

        model.eval()
        all_preds, all_labels = [], []
        with torch.no_grad():
            for X_batch, y_batch in test_loader:
                logits = model(X_batch)
                all_preds.extend(logits.argmax(dim=1).numpy())
                all_labels.extend(y_batch.numpy())

        val_f1 = f1_score(all_labels, all_preds, average="weighted", zero_division=0)

        if RAY_AVAILABLE:
            tune.report({"f1_score": val_f1, "epoch": epoch})


def run_distributed_tuning():
    """Run Ray-based hyperparameter tuning for all models."""
    if not RAY_AVAILABLE:
        print("Ray not available. Running single-node training instead.")
        from train_models import run_full_training_pipeline
        return run_full_training_pipeline()

    ray.init(ignore_reinit_error=True)

    models_config = [
        {
            "name": "fraud_detection",
            "class": FraudDetectionNet,
            "dataset": "fraud_detection",
            "target": "is_fraud",
            "search_space": {
                "lr": tune.loguniform(1e-4, 1e-2),
                "hidden_dims": tune.choice([[128, 64, 32], [256, 128, 64], [64, 32, 16]]),
                "weight_decay": tune.loguniform(1e-6, 1e-3),
                "epochs": 30,
            },
        },
        {
            "name": "claims_adjudication",
            "class": ClaimsAdjudicationNet,
            "dataset": "claims_adjudication",
            "target": "decision",
            "search_space": {
                "lr": tune.loguniform(1e-4, 1e-2),
                "hidden_dims": tune.choice([[128, 96, 64, 32], [256, 128, 64, 32], [64, 48, 32, 16]]),
                "weight_decay": tune.loguniform(1e-6, 1e-3),
                "epochs": 30,
            },
        },
        {
            "name": "churn_prediction",
            "class": ChurnPredictionNet,
            "dataset": "churn_prediction",
            "target": "churned",
            "search_space": {
                "lr": tune.loguniform(1e-4, 1e-2),
                "hidden_dims": tune.choice([[128, 64, 32], [256, 128, 64], [64, 32, 16]]),
                "weight_decay": tune.loguniform(1e-6, 1e-3),
                "epochs": 30,
            },
        },
    ]

    results = {}
    scheduler = ASHAScheduler(metric="f1_score", mode="max", max_t=30, grace_period=5, reduction_factor=2)

    for model_config in models_config:
        print(f"\n{'='*50}")
        print(f"Tuning: {model_config['name']}")
        print(f"{'='*50}")

        analysis = tune.run(
            lambda config: train_with_config(config, model_config["class"], model_config["dataset"], model_config["target"]),
            config=model_config["search_space"],
            num_samples=8,
            scheduler=scheduler,
            resources_per_trial={"cpu": 2},
            verbose=1,
        )

        best_config = analysis.best_config
        best_f1 = analysis.best_result["f1_score"]
        results[model_config["name"]] = {"best_config": best_config, "best_f1": best_f1}
        print(f"  Best config: {best_config}")
        print(f"  Best F1: {best_f1:.4f}")

    ray.shutdown()

    with open(os.path.join(MODEL_REGISTRY, "ray_tuning_results.json"), "w") as f:
        json.dump({"tuned_at": datetime.now().isoformat(), "results": results}, f, indent=2, default=str)

    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--address", default=None, help="Ray cluster address")
    args = parser.parse_args()

    if args.address and RAY_AVAILABLE:
        ray.init(address=args.address)

    run_distributed_tuning()
