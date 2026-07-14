"""
Master Training Script — Trains ALL Models End-to-End

1. Generates synthetic data for all domains
2. Builds Lakehouse feature store
3. Trains all PyTorch models with real training loops
4. Trains GNN on entity graph
5. Runs MCMC Bayesian risk analysis
6. Exports models to ONNX
7. Saves all weights, metadata, and results

Run: python -m ai-ml-platform.train_all
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch

# Add parent to path
ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT.parent))

from data_generation.synthetic_insurance_data import generate_all_datasets
from models.fraud_detection.model import FraudDetectionNet
from models.churn_prediction.model import ChurnPredictionNet
from models.claims_adjudication.model import ClaimsAdjudicationNet
from models.credit_scoring.model import CreditScoringNet
from models.anomaly_detection.model import TransactionAutoencoder
from models.gnn_fraud.model import FraudGNN
from training.trainer import (
    prepare_binary_classification_data,
    prepare_multitask_data,
    train_binary_classifier,
    train_multitask_model,
    train_vae,
)
from training.train_gnn import train_gnn
from lakehouse.delta_feature_store import build_feature_store


DATA_DIR = ROOT / "data"
WEIGHTS_DIR = ROOT / "weights"
LAKEHOUSE_DIR = ROOT / "lakehouse_store"
ONNX_DIR = ROOT / "onnx_models"
RESULTS_DIR = ROOT / "results"


def main() -> None:
    start_time = time.time()
    all_results: dict[str, dict] = {}

    print("=" * 70)
    print("  NGApp AI/ML Platform — Full Training Pipeline")
    print("=" * 70)
    print(f"  PyTorch version: {torch.__version__}")
    print(f"  Device: CPU (as required for inference)")
    print(f"  Data dir: {DATA_DIR}")
    print(f"  Weights dir: {WEIGHTS_DIR}")
    print()

    # ── Step 1: Generate Synthetic Data ───────────────────────────────────
    print("\n" + "=" * 70)
    print("  STEP 1: Generating Synthetic Data")
    print("=" * 70)
    paths = generate_all_datasets(DATA_DIR)

    # ── Step 2: Build Lakehouse Feature Store ─────────────────────────────
    print("\n" + "=" * 70)
    print("  STEP 2: Building Lakehouse Feature Store")
    print("=" * 70)
    feature_store = build_feature_store(DATA_DIR, LAKEHOUSE_DIR)

    # ── Step 3: Train Fraud Detection Model ───────────────────────────────
    print("\n" + "=" * 70)
    print("  STEP 3: Training Fraud Detection Model (PyTorch)")
    print("=" * 70)

    fraud_df = pd.read_parquet(DATA_DIR / "fraud_detection.parquet")

    # Feature engineering
    fraud_feature_cols = [
        "policy_age_days", "premium_ngn", "claim_amount_ngn", "claim_premium_ratio",
        "claims_last_30d", "claims_last_90d", "claims_last_365d",
        "doc_ocr_confidence", "face_match_score", "liveness_score",
        "unique_devices_30d", "unique_ips_30d", "hour_of_submission",
        "same_bank_claims_count", "agent_fraud_rate",
        "doc_verified", "ip_country_match", "is_weekend",
    ]
    # Encode categoricals as ordinal
    from sklearn.preprocessing import LabelEncoder
    for col in ["doc_type", "device_type", "claim_type", "policy_product"]:
        le = LabelEncoder()
        fraud_df[col + "_enc"] = le.fit_transform(fraud_df[col])
        fraud_feature_cols.append(col + "_enc")

    train_loader, val_loader, test_loader, fraud_scaler, _ = prepare_binary_classification_data(
        fraud_df, fraud_feature_cols, "is_fraud", batch_size=512,
    )

    fraud_model = FraudDetectionNet(
        n_numeric=15, n_binary=3, n_categorical_embed=4,
        hidden_dim=128, n_residual_blocks=3,
    )
    fraud_result = train_binary_classifier(
        fraud_model, train_loader, val_loader,
        n_epochs=40, lr=1e-3, patience=8,
        model_name="fraud_detection", save_dir=WEIGHTS_DIR,
        use_focal_loss=True, focal_alpha=0.25, focal_gamma=2.0,
    )
    fraud_result.feature_names = fraud_feature_cols
    fraud_result.scaler_means = fraud_scaler.mean_.tolist()
    fraud_result.scaler_stds = fraud_scaler.scale_.tolist()
    fraud_result.save_metadata(WEIGHTS_DIR / "fraud_detection_metadata.json")
    all_results["fraud_detection"] = {
        "best_auc": fraud_result.best_auc,
        "best_f1": fraud_result.best_f1,
        "best_epoch": fraud_result.best_epoch,
        "total_time_s": fraud_result.total_time_s,
    }

    # ── Step 4: Train Churn Prediction Model ──────────────────────────────
    print("\n" + "=" * 70)
    print("  STEP 4: Training Churn Prediction Model (PyTorch)")
    print("=" * 70)

    churn_df = pd.read_parquet(DATA_DIR / "churn_prediction.parquet")
    churn_feature_cols = ChurnPredictionNet.FEATURE_NAMES

    train_loader, val_loader, test_loader, churn_scaler, _ = prepare_binary_classification_data(
        churn_df, churn_feature_cols, "churned", batch_size=512,
    )

    churn_model = ChurnPredictionNet(n_features=20, hidden_dim=96)
    churn_result = train_binary_classifier(
        churn_model, train_loader, val_loader,
        n_epochs=40, lr=1e-3, patience=8,
        model_name="churn_prediction", save_dir=WEIGHTS_DIR,
        use_focal_loss=True, focal_alpha=0.3, focal_gamma=2.0,
    )
    churn_result.feature_names = churn_feature_cols
    churn_result.scaler_means = churn_scaler.mean_.tolist()
    churn_result.scaler_stds = churn_scaler.scale_.tolist()
    churn_result.save_metadata(WEIGHTS_DIR / "churn_prediction_metadata.json")
    all_results["churn_prediction"] = {
        "best_auc": churn_result.best_auc,
        "best_f1": churn_result.best_f1,
        "best_epoch": churn_result.best_epoch,
        "total_time_s": churn_result.total_time_s,
    }

    # ── Step 5: Train Claims Adjudication Model ──────────────────────────
    print("\n" + "=" * 70)
    print("  STEP 5: Training Claims Adjudication Model (PyTorch Multi-Task)")
    print("=" * 70)

    claims_df = pd.read_parquet(DATA_DIR / "claims_adjudication.parquet")
    claims_feature_cols = ClaimsAdjudicationNet.FEATURE_NAMES

    train_loader, val_loader, test_loader, claims_scaler, claims_le = prepare_multitask_data(
        claims_df, claims_feature_cols, "outcome", "payout_ratio", batch_size=512,
    )

    claims_model = ClaimsAdjudicationNet(n_features=17, hidden_dim=112, n_classes=3)
    claims_result = train_multitask_model(
        claims_model, train_loader, val_loader,
        n_epochs=40, lr=1e-3, patience=8,
        model_name="claims_adjudication", save_dir=WEIGHTS_DIR,
        cls_weight=1.0, reg_weight=0.5,
    )
    claims_result.feature_names = claims_feature_cols
    claims_result.scaler_means = claims_scaler.mean_.tolist()
    claims_result.scaler_stds = claims_scaler.scale_.tolist()
    claims_result.save_metadata(WEIGHTS_DIR / "claims_adjudication_metadata.json")
    all_results["claims_adjudication"] = {
        "best_f1": claims_result.best_f1,
        "best_epoch": claims_result.best_epoch,
        "total_time_s": claims_result.total_time_s,
    }

    # ── Step 6: Train Credit Scoring Model ────────────────────────────────
    print("\n" + "=" * 70)
    print("  STEP 6: Training Credit Scoring Model (Wide & Deep)")
    print("=" * 70)

    credit_df = pd.read_parquet(DATA_DIR / "credit_scoring.parquet")
    credit_feature_cols = CreditScoringNet.FEATURE_NAMES

    train_loader, val_loader, test_loader, credit_scaler, _ = prepare_binary_classification_data(
        credit_df, credit_feature_cols, "defaulted", batch_size=512,
    )

    credit_model = CreditScoringNet(n_features=21, wide_dim=64, deep_dims=(128, 96, 64))

    # Custom training for credit model (dual output)
    device = torch.device("cpu")
    credit_model = credit_model.to(device)
    optimizer = torch.optim.AdamW(credit_model.parameters(), lr=1e-3, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer, max_lr=3e-3, epochs=40, steps_per_epoch=len(train_loader), pct_start=0.2,
    )

    best_val_loss = float("inf")
    patience_counter = 0

    for epoch in range(1, 41):
        credit_model.train()
        train_losses = []
        for X_batch, y_batch in train_loader:
            optimizer.zero_grad()
            score, default_logit = credit_model(X_batch)
            # Combined loss: MSE on score proxy + BCE on default
            default_loss = torch.nn.functional.binary_cross_entropy_with_logits(default_logit, y_batch)
            loss = default_loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(credit_model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            train_losses.append(loss.item())

        credit_model.eval()
        val_losses = []
        all_probs = []
        all_targets = []
        with torch.no_grad():
            for X_batch, y_batch in val_loader:
                _, default_logit = credit_model(X_batch)
                loss = torch.nn.functional.binary_cross_entropy_with_logits(default_logit, y_batch)
                val_losses.append(loss.item())
                all_probs.append(torch.sigmoid(default_logit).numpy())
                all_targets.append(y_batch.numpy())

        preds = np.concatenate(all_probs)
        targets = np.concatenate(all_targets)
        from sklearn.metrics import roc_auc_score, f1_score
        auc = float(roc_auc_score(targets, preds)) if len(np.unique(targets)) > 1 else 0.0
        avg_val = float(np.mean(val_losses))

        if epoch % 5 == 0 or epoch == 1:
            print(f"  [credit_scoring] Epoch {epoch:3d}/40 | train_loss={np.mean(train_losses):.4f} val_loss={avg_val:.4f} | AUC={auc:.4f}")

        if avg_val < best_val_loss:
            best_val_loss = avg_val
            patience_counter = 0
            torch.save(credit_model.state_dict(), WEIGHTS_DIR / "credit_scoring.pt")
        else:
            patience_counter += 1
            if patience_counter >= 8:
                print(f"  [credit_scoring] Early stopping at epoch {epoch}")
                break

    credit_model.load_state_dict(torch.load(WEIGHTS_DIR / "credit_scoring.pt", weights_only=True))
    credit_meta = {
        "model_name": "credit_scoring",
        "best_auc": round(auc, 4),
        "feature_names": credit_feature_cols,
        "scaler_means": credit_scaler.mean_.tolist(),
        "scaler_stds": credit_scaler.scale_.tolist(),
    }
    with open(WEIGHTS_DIR / "credit_scoring_metadata.json", "w") as f:
        json.dump(credit_meta, f, indent=2)
    all_results["credit_scoring"] = {"best_auc": round(auc, 4)}

    # ── Step 7: Train Anomaly Detection VAE ───────────────────────────────
    print("\n" + "=" * 70)
    print("  STEP 7: Training Anomaly Detection VAE (PyTorch)")
    print("=" * 70)

    anomaly_df = pd.read_parquet(DATA_DIR / "anomaly_detection.parquet")
    anomaly_feature_cols = TransactionAutoencoder.FEATURE_NAMES

    # Train only on normal transactions
    normal_df = anomaly_df[anomaly_df["is_anomaly"] == 0].copy()
    from sklearn.preprocessing import StandardScaler
    anomaly_scaler = StandardScaler()
    X_normal = anomaly_scaler.fit_transform(
        normal_df[anomaly_feature_cols].values.astype(np.float32)
    )

    X_t = torch.from_numpy(X_normal.astype(np.float32))
    from torch.utils.data import TensorDataset, DataLoader, random_split
    ds = TensorDataset(X_t)
    n_val = int(len(ds) * 0.15)
    n_train = len(ds) - n_val
    train_ds, val_ds = random_split(ds, [n_train, n_val], generator=torch.Generator().manual_seed(42))
    train_loader = DataLoader(train_ds, batch_size=1024, shuffle=True, drop_last=True)
    val_loader = DataLoader(val_ds, batch_size=2048, shuffle=False)

    vae_model = TransactionAutoencoder(n_features=8, encoder_dims=(64, 32), latent_dim=12)
    vae_result = train_vae(
        vae_model, train_loader, val_loader,
        n_epochs=30, lr=1e-3, beta=0.5, patience=8,
        model_name="anomaly_detection", save_dir=WEIGHTS_DIR,
    )
    anomaly_meta = {
        "model_name": "anomaly_detection",
        "feature_names": anomaly_feature_cols,
        "scaler_means": anomaly_scaler.mean_.tolist(),
        "scaler_stds": anomaly_scaler.scale_.tolist(),
        "n_normal_samples": len(normal_df),
        "best_val_loss": vae_result.best_val_loss,
    }
    with open(WEIGHTS_DIR / "anomaly_detection_metadata.json", "w") as f:
        json.dump(anomaly_meta, f, indent=2)
    all_results["anomaly_detection"] = {
        "best_val_loss": vae_result.best_val_loss,
        "total_time_s": vae_result.total_time_s,
    }

    # ── Step 8: Train GNN Fraud Detection ─────────────────────────────────
    print("\n" + "=" * 70)
    print("  STEP 8: Training GNN Fraud Ring Detection (GraphSAGE)")
    print("=" * 70)

    nodes_df = pd.read_parquet(DATA_DIR / "graph_nodes.parquet")
    edges_df = pd.read_parquet(DATA_DIR / "graph_edges.parquet")

    gnn_result = train_gnn(
        nodes_df, edges_df,
        n_epochs=60, lr=5e-3, patience=12,
        save_dir=WEIGHTS_DIR, model_name="fraud_gnn",
        feature_dim=8, hidden_dim=64,
    )
    all_results["gnn_fraud"] = {
        "test_auc": gnn_result["test_auc"],
        "test_f1": gnn_result["test_f1"],
        "test_accuracy": gnn_result["test_accuracy"],
        "total_time_s": gnn_result["total_time_s"],
    }

    # ── Step 9: MCMC Bayesian Risk Analysis ───────────────────────────────
    print("\n" + "=" * 70)
    print("  STEP 9: Running MCMC Bayesian Risk Analysis (NumPyro/JAX)")
    print("=" * 70)

    risk_df = pd.read_parquet(DATA_DIR / "risk_actuarial.parquet")
    try:
        from mcmc.bayesian_risk import run_mcmc_risk_analysis
        mcmc_result = run_mcmc_risk_analysis(
            risk_df,
            n_warmup=300, n_samples=1000, n_chains=1,
            save_dir=WEIGHTS_DIR, model_name="mcmc_risk",
        )
        all_results["mcmc_risk"] = {
            "n_products": mcmc_result["n_products"],
            "portfolio_mean_loss_rate": mcmc_result["portfolio_mean_loss_rate"],
            "portfolio_var_99": mcmc_result["portfolio_var_99"],
            "total_time_s": mcmc_result["total_time_s"],
        }
    except Exception as e:
        print(f"  [MCMC] Failed: {e}")
        print("  [MCMC] Skipping — JAX/NumPyro may not be available")
        all_results["mcmc_risk"] = {"status": "skipped", "error": str(e)}

    # ── Step 10: Export to ONNX ───────────────────────────────────────────
    print("\n" + "=" * 70)
    print("  STEP 10: Exporting Models to ONNX")
    print("=" * 70)

    try:
        from serving.onnx_export import export_to_onnx
        ONNX_DIR.mkdir(parents=True, exist_ok=True)

        onnx_configs = [
            ("fraud_detection", FraudDetectionNet, {"n_numeric": 15, "n_binary": 3, "n_categorical_embed": 4}, 22),
            ("churn_prediction", ChurnPredictionNet, {"n_features": 20}, 20),
            ("credit_scoring", CreditScoringNet, {"n_features": 21}, 21),
            ("anomaly_detection", TransactionAutoencoder, {"n_features": 8}, 8),
        ]

        for name, cls, kwargs, input_dim in onnx_configs:
            weights_path = WEIGHTS_DIR / f"{name}.pt"
            if weights_path.exists():
                try:
                    model = cls(**kwargs)
                    model.load_state_dict(torch.load(weights_path, weights_only=True))
                    model.eval()
                    export_to_onnx(model, (input_dim,), ONNX_DIR / f"{name}.onnx", model_name=name)
                except Exception as e:
                    print(f"  [ONNX] Failed to export {name}: {e}")
    except ImportError:
        print("  [ONNX] onnx/onnxruntime not available — skipping export")

    # ── Final Summary ─────────────────────────────────────────────────────
    total_time = time.time() - start_time

    print("\n" + "=" * 70)
    print("  TRAINING COMPLETE — SUMMARY")
    print("=" * 70)

    # List weight files
    print("\n  Trained model weights:")
    for pt_file in sorted(WEIGHTS_DIR.glob("*.pt")):
        size_mb = pt_file.stat().st_size / (1024 * 1024)
        print(f"    {pt_file.name:40s} {size_mb:>6.2f} MB")

    print("\n  Model performance:")
    for name, metrics in all_results.items():
        metrics_str = " | ".join(f"{k}={v}" for k, v in metrics.items())
        print(f"    {name:30s} | {metrics_str}")

    print(f"\n  Total training time: {total_time:.1f}s ({total_time/60:.1f}m)")
    print(f"  Weights saved to: {WEIGHTS_DIR}")
    print(f"  Lakehouse at: {LAKEHOUSE_DIR}")

    # Save master results
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    master_results = {
        "total_time_s": round(total_time, 2),
        "pytorch_version": torch.__version__,
        "device": "cpu",
        "models": all_results,
        "weight_files": {
            f.name: round(f.stat().st_size / (1024 * 1024), 2)
            for f in sorted(WEIGHTS_DIR.glob("*.pt"))
        },
        "data_files": {
            f.name: round(f.stat().st_size / (1024 * 1024), 2)
            for f in sorted(DATA_DIR.glob("*.parquet"))
        },
    }
    with open(RESULTS_DIR / "training_results.json", "w") as f:
        json.dump(master_results, f, indent=2)

    print(f"\n  Results saved to: {RESULTS_DIR}/training_results.json")
    print("=" * 70)


if __name__ == "__main__":
    main()
