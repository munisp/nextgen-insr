"""
Continuous Training Pipeline Orchestrator

End-to-end pipeline that:
1. Ingests new data from the platform
2. Checks for data drift against reference distributions
3. Retrains models when drift is detected or on schedule
4. Validates new models against champion
5. Promotes or rejects based on performance comparison
6. Exports to ONNX and updates serving infrastructure

Supports both scheduled (cron) and event-driven (drift) triggers.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.preprocessing import StandardScaler

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models.fraud_detection.model import FraudDetectionNet
from models.churn_prediction.model import ChurnPredictionNet
from models.claims_adjudication.model import ClaimsAdjudicationNet
from models.credit_scoring.model import CreditScoringNet
from models.anomaly_detection.model import TransactionAutoencoder
from training.trainer import (
    prepare_binary_classification_data,
    prepare_multitask_data,
    train_binary_classifier,
    train_multitask_model,
    train_vae,
)
from continuous_training.drift_detector import DriftDetector, DriftConfig
from continuous_training.model_registry import ModelRegistry
from continuous_training.data_ingestion import PlatformDataIngester, IngestionConfig


@dataclass
class PipelineConfig:
    """Configuration for the continuous training pipeline."""
    # Directories
    data_dir: Path = Path("data")
    weights_dir: Path = Path("weights")
    registry_dir: Path = Path("model_registry")
    lakehouse_dir: Path = Path("lakehouse_store")
    onnx_dir: Path = Path("onnx_models")
    ingestion_dir: Path = Path("continuous_training/ingested_data")
    drift_reference_dir: Path = Path("continuous_training/drift_references")
    pipeline_log_dir: Path = Path("continuous_training/logs")

    # Training
    n_epochs: int = 30
    batch_size: int = 512
    learning_rate: float = 1e-3
    patience: int = 8

    # Drift thresholds
    psi_threshold: float = 0.2
    ks_pvalue_threshold: float = 0.01
    drift_feature_pct: float = 0.3

    # Promotion
    min_improvement_auc: float = 0.01
    min_improvement_f1: float = 0.02

    # Schedule
    retrain_interval_hours: float = 24.0
    min_new_samples: int = 1000


@dataclass
class PipelineRun:
    """Record of a single pipeline execution."""
    run_id: str
    started_at: float
    completed_at: float = 0.0
    trigger: str = "manual"  # manual | scheduled | drift | performance
    models_retrained: list[str] = field(default_factory=list)
    models_promoted: list[str] = field(default_factory=list)
    drift_reports: dict[str, Any] = field(default_factory=dict)
    ingestion_results: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    status: str = "running"  # running | completed | failed

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "trigger": self.trigger,
            "models_retrained": self.models_retrained,
            "models_promoted": self.models_promoted,
            "drift_reports": self.drift_reports,
            "ingestion_results": self.ingestion_results,
            "errors": self.errors,
            "status": self.status,
            "duration_s": round(self.completed_at - self.started_at, 2)
            if self.completed_at
            else 0,
        }


# ── Model Training Configs ───────────────────────────────────────────────────

MODEL_CONFIGS: dict[str, dict[str, Any]] = {
    "fraud_detection": {
        "model_class": FraudDetectionNet,
        "model_kwargs": {"n_numeric": 15, "n_binary": 3, "n_categorical_embed": 4},
        "feature_cols": [
            "policy_age_days", "premium_ngn", "claim_amount_ngn", "claim_premium_ratio",
            "claims_last_30d", "claims_last_90d", "claims_last_365d",
            "doc_ocr_confidence", "face_match_score", "liveness_score",
            "unique_devices_30d", "unique_ips_30d", "hour_of_submission",
            "same_bank_claims_count", "agent_fraud_rate",
            "doc_verified", "ip_country_match", "is_weekend",
            "doc_type_enc", "device_type_enc", "claim_type_enc", "policy_product_enc",
        ],
        "target_col": "is_fraud",
        "task": "binary",
        "use_focal_loss": True,
        "primary_metric": "auc",
    },
    "churn_prediction": {
        "model_class": ChurnPredictionNet,
        "model_kwargs": {"n_features": 20, "hidden_dim": 96},
        "feature_cols": ChurnPredictionNet.FEATURE_NAMES,
        "target_col": "churned",
        "task": "binary",
        "use_focal_loss": True,
        "primary_metric": "auc",
    },
    "claims_adjudication": {
        "model_class": ClaimsAdjudicationNet,
        "model_kwargs": {"n_features": 17, "hidden_dim": 112, "n_classes": 3},
        "feature_cols": ClaimsAdjudicationNet.FEATURE_NAMES,
        "cls_target_col": "outcome",
        "reg_target_col": "payout_ratio",
        "task": "multitask",
        "primary_metric": "f1",
    },
    "anomaly_detection": {
        "model_class": TransactionAutoencoder,
        "model_kwargs": {"n_features": 8, "encoder_dims": (64, 32), "latent_dim": 12},
        "feature_cols": TransactionAutoencoder.FEATURE_NAMES,
        "task": "vae",
        "primary_metric": "val_loss",
    },
}


class ContinuousTrainingPipeline:
    """Orchestrates the full continuous training workflow."""

    def __init__(self, config: PipelineConfig | None = None) -> None:
        self.config = config or PipelineConfig()
        self.registry = ModelRegistry(self.config.registry_dir)
        self.drift_detector = DriftDetector(DriftConfig(
            psi_threshold=self.config.psi_threshold,
            ks_pvalue_threshold=self.config.ks_pvalue_threshold,
            drift_feature_pct_threshold=self.config.drift_feature_pct,
        ))
        self.ingester = PlatformDataIngester(IngestionConfig(
            lakehouse_dir=str(self.config.lakehouse_dir),
        ))

        # Ensure directories exist
        for d in [
            self.config.ingestion_dir,
            self.config.drift_reference_dir,
            self.config.pipeline_log_dir,
        ]:
            d.mkdir(parents=True, exist_ok=True)

    def run(self, trigger: str = "manual") -> PipelineRun:
        """Execute the full continuous training pipeline."""
        run_id = f"run_{int(time.time())}"
        run = PipelineRun(run_id=run_id, started_at=time.time(), trigger=trigger)

        print("\n" + "=" * 70)
        print(f"  Continuous Training Pipeline — Run {run_id}")
        print(f"  Trigger: {trigger}")
        print("=" * 70)

        try:
            # Step 1: Ingest new data
            print("\n  STEP 1: Ingesting platform data...")
            ingestion_results = self.ingester.ingest_all(self.config.ingestion_dir)
            run.ingestion_results = [r.to_dict() for r in ingestion_results]

            # Step 2: Check drift for each model
            print("\n  STEP 2: Checking data drift...")
            models_needing_retrain = self._check_all_drift(run)

            # Step 3: Retrain models that need it
            if trigger == "scheduled":
                models_needing_retrain = list(MODEL_CONFIGS.keys())
                print("  [Scheduled] Retraining all models")

            if not models_needing_retrain and trigger != "manual":
                print("  No drift detected — skipping retraining")
            else:
                if trigger == "manual":
                    models_needing_retrain = list(MODEL_CONFIGS.keys())

                print(f"\n  STEP 3: Retraining {len(models_needing_retrain)} models...")
                for model_name in models_needing_retrain:
                    try:
                        self._retrain_model(model_name, run)
                    except Exception as e:
                        error_msg = f"Failed to retrain {model_name}: {e}"
                        print(f"  [ERROR] {error_msg}")
                        run.errors.append(error_msg)

            # Step 4: Auto-promote if improved
            print("\n  STEP 4: Evaluating promotions...")
            for model_name in run.models_retrained:
                try:
                    result = self.registry.auto_promote(
                        model_name,
                        min_improvement=self.config.min_improvement_auc,
                    )
                    if result.get("action") in ("promoted", "promoted_first", "promoted_challenger_no_champion"):
                        run.models_promoted.append(model_name)
                        print(f"  [Promoted] {model_name} v{result.get('version')}")
                    else:
                        print(f"  [Kept] {model_name} — {result.get('action')}")
                except Exception as e:
                    run.errors.append(f"Promotion check failed for {model_name}: {e}")

            # Step 5: Export promoted models to ONNX
            print("\n  STEP 5: Exporting promoted models to ONNX...")
            self._export_promoted_models(run)

            run.status = "completed"

        except Exception as e:
            run.status = "failed"
            run.errors.append(str(e))
            print(f"\n  [PIPELINE FAILED] {e}")

        run.completed_at = time.time()

        # Save run log
        log_path = self.config.pipeline_log_dir / f"{run_id}.json"
        with open(log_path, "w") as f:
            json.dump(run.to_dict(), f, indent=2)

        self._print_summary(run)
        return run

    def _check_all_drift(self, run: PipelineRun) -> list[str]:
        """Check drift for all models, return list needing retraining."""
        models_needing_retrain: list[str] = []

        for model_name, config in MODEL_CONFIGS.items():
            ref_path = self.config.drift_reference_dir / f"{model_name}_reference.json"
            data_path = self.config.data_dir / f"{model_name.replace('_detection', '_detection').replace('_prediction', '_prediction')}.parquet"

            # Try loading from standard data paths
            if not data_path.exists():
                for suffix in ["", "_detection", "_prediction", "_adjudication", "_scoring"]:
                    candidate = self.config.data_dir / f"{model_name}{suffix}.parquet"
                    if candidate.exists():
                        data_path = candidate
                        break

            if not data_path.exists():
                print(f"  [{model_name}] No data file found — skipping drift check")
                continue

            df = pd.read_parquet(data_path)
            feature_cols = config["feature_cols"]

            # Engineer encoded categorical features if raw columns exist
            cat_encoding_map = {
                "doc_type_enc": "doc_type",
                "device_type_enc": "device_type",
                "claim_type_enc": "claim_type",
                "policy_product_enc": "policy_product",
                "occupation_enc": "occupation",
                "state_enc": "state",
                "gender_enc": "gender",
            }
            for enc_col, raw_col in cat_encoding_map.items():
                if enc_col in feature_cols and enc_col not in df.columns and raw_col in df.columns:
                    df[enc_col] = df[raw_col].astype("category").cat.codes.astype(float)

            # Filter to available columns
            available = [c for c in feature_cols if c in df.columns]
            if not available:
                print(f"  [{model_name}] No matching feature columns — skipping")
                continue

            X = df[available].values.astype(np.float32)

            if ref_path.exists():
                self.drift_detector.load_reference(ref_path)
                report = self.drift_detector.check_drift(X, available, model_name)
                run.drift_reports[model_name] = report.to_dict()

                if report.should_retrain:
                    models_needing_retrain.append(model_name)
                    print(
                        f"  [{model_name}] DRIFT DETECTED — "
                        f"{report.n_drifted}/{report.n_features} features drifted "
                        f"(score={report.overall_drift_score:.4f})"
                    )
                else:
                    print(
                        f"  [{model_name}] No drift — "
                        f"score={report.overall_drift_score:.4f}"
                    )
            else:
                # First run — set reference and save
                self.drift_detector.set_reference(X, available)
                self.drift_detector.save_reference(ref_path)
                print(f"  [{model_name}] Reference distribution saved (first run)")

        return models_needing_retrain

    def _retrain_model(self, model_name: str, run: PipelineRun) -> None:
        """Retrain a single model with the latest data."""
        if model_name not in MODEL_CONFIGS:
            return

        config = MODEL_CONFIGS[model_name]
        task = config["task"]

        print(f"\n  Retraining: {model_name} (task={task})")

        # Load data — prefer ingested data, fallback to original
        data_path = self._find_data_path(model_name)
        if data_path is None:
            run.errors.append(f"No data found for {model_name}")
            return

        df = pd.read_parquet(data_path)
        feature_cols = config["feature_cols"]

        # Engineer encoded categorical features if raw columns exist
        cat_encoding_map = {
            "doc_type_enc": "doc_type",
            "device_type_enc": "device_type",
            "claim_type_enc": "claim_type",
            "policy_product_enc": "policy_product",
            "occupation_enc": "occupation",
            "state_enc": "state",
            "gender_enc": "gender",
        }
        for enc_col, raw_col in cat_encoding_map.items():
            if enc_col in feature_cols and enc_col not in df.columns and raw_col in df.columns:
                df[enc_col] = df[raw_col].astype("category").cat.codes.astype(float)

        available = [c for c in feature_cols if c in df.columns]

        if len(available) < len(feature_cols) * 0.5:
            run.errors.append(
                f"{model_name}: too few features ({len(available)}/{len(feature_cols)})"
            )
            return

        if task == "binary":
            target_col = config["target_col"]
            if target_col not in df.columns:
                run.errors.append(f"{model_name}: target column '{target_col}' missing")
                return

            train_loader, val_loader, _, scaler, _ = prepare_binary_classification_data(
                df, available, target_col, batch_size=self.config.batch_size,
            )

            model_kwargs = config["model_kwargs"].copy()
            if model_name == "churn_prediction":
                model_kwargs["n_features"] = len(available)
            model = config["model_class"](**model_kwargs)

            result = train_binary_classifier(
                model, train_loader, val_loader,
                n_epochs=self.config.n_epochs,
                lr=self.config.learning_rate,
                patience=self.config.patience,
                model_name=model_name,
                save_dir=self.config.weights_dir,
                use_focal_loss=config.get("use_focal_loss", False),
            )

            metrics = {
                "auc": result.best_auc,
                "f1": result.best_f1,
                "val_loss": result.best_val_loss,
            }

        elif task == "multitask":
            cls_col = config["cls_target_col"]
            reg_col = config["reg_target_col"]

            if cls_col not in df.columns or reg_col not in df.columns:
                run.errors.append(f"{model_name}: target columns missing")
                return

            train_loader, val_loader, _, scaler, _ = prepare_multitask_data(
                df, available, cls_col, reg_col, batch_size=self.config.batch_size,
            )

            model = config["model_class"](**config["model_kwargs"])
            result = train_multitask_model(
                model, train_loader, val_loader,
                n_epochs=self.config.n_epochs,
                lr=self.config.learning_rate,
                patience=self.config.patience,
                model_name=model_name,
                save_dir=self.config.weights_dir,
            )

            metrics = {"f1": result.best_f1, "val_loss": result.best_val_loss}

        elif task == "vae":
            X = df[available].values.astype(np.float32)
            # Filter to non-anomaly for VAE training
            if "is_anomaly" in df.columns:
                mask = df["is_anomaly"] == 0
                X = X[mask.values]

            scaler = StandardScaler()
            X = scaler.fit_transform(X).astype(np.float32)

            X_t = torch.from_numpy(X)
            from torch.utils.data import TensorDataset, DataLoader, random_split

            ds = TensorDataset(X_t)
            n_val = int(len(ds) * 0.15)
            n_train = len(ds) - n_val
            train_ds, val_ds = random_split(
                ds, [n_train, n_val],
                generator=torch.Generator().manual_seed(42),
            )
            train_loader = DataLoader(train_ds, batch_size=1024, shuffle=True, drop_last=True)
            val_loader = DataLoader(val_ds, batch_size=2048, shuffle=False)

            model = config["model_class"](**config["model_kwargs"])
            result = train_vae(
                model, train_loader, val_loader,
                n_epochs=self.config.n_epochs,
                lr=self.config.learning_rate,
                patience=self.config.patience,
                model_name=model_name,
                save_dir=self.config.weights_dir,
            )

            metrics = {"val_loss": result.best_val_loss}

        else:
            run.errors.append(f"Unknown task type: {task}")
            return

        # Register the new version
        weights_path = self.config.weights_dir / f"{model_name}.pt"
        training_config = {
            "n_epochs": self.config.n_epochs,
            "batch_size": self.config.batch_size,
            "lr": self.config.learning_rate,
            "patience": self.config.patience,
            "n_features": len(available),
            "n_samples": len(df),
            "data_path": str(data_path),
        }

        self.registry.register_model(
            model_name=model_name,
            weights_path=weights_path,
            metrics=metrics,
            training_config=training_config,
            tags=["continuous_training", run.run_id],
        )

        # Set as challenger
        versions = self.registry.list_versions(model_name)
        if versions:
            self.registry.set_challenger(model_name, versions[-1]["version"])

        run.models_retrained.append(model_name)
        primary = config.get("primary_metric", "auc")
        print(
            f"  [{model_name}] Retrained — "
            f"{primary}={metrics.get(primary, 'N/A')}"
        )

    def _find_data_path(self, model_name: str) -> Path | None:
        """Find the best data file for a model."""
        # Check ingested data first
        ingested = list(self.config.ingestion_dir.glob(f"{model_name}*.parquet"))
        if ingested:
            return sorted(ingested, key=lambda p: p.stat().st_mtime)[-1]

        # Fallback to original training data
        candidates = [
            self.config.data_dir / f"{model_name}.parquet",
            self.config.data_dir / "fraud_detection.parquet",
            self.config.data_dir / "churn_prediction.parquet",
            self.config.data_dir / "claims_adjudication.parquet",
            self.config.data_dir / "anomaly_detection.parquet",
        ]

        for c in candidates:
            if c.exists() and model_name in c.name:
                return c

        # Try matching by prefix
        for f in self.config.data_dir.glob("*.parquet"):
            if model_name.split("_")[0] in f.name:
                return f

        return None

    def _export_promoted_models(self, run: PipelineRun) -> None:
        """Export newly promoted models to ONNX."""
        try:
            from serving.onnx_export import export_to_onnx
        except ImportError:
            print("  [ONNX] onnx/onnxruntime not available — skipping export")
            return

        self.config.onnx_dir.mkdir(parents=True, exist_ok=True)

        onnx_configs = {
            "fraud_detection": (FraudDetectionNet, {"n_numeric": 15, "n_binary": 3, "n_categorical_embed": 4}, 22),
            "churn_prediction": (ChurnPredictionNet, {"n_features": 20}, 20),
            "credit_scoring": (CreditScoringNet, {"n_features": 21}, 21),
            "anomaly_detection": (TransactionAutoencoder, {"n_features": 8}, 8),
        }

        for model_name in run.models_promoted:
            if model_name not in onnx_configs:
                continue

            cls, kwargs, input_dim = onnx_configs[model_name]
            weights_path = self.config.weights_dir / f"{model_name}.pt"

            if not weights_path.exists():
                continue

            try:
                model = cls(**kwargs)
                model.load_state_dict(torch.load(weights_path, weights_only=True))
                model.eval()
                export_to_onnx(
                    model,
                    (input_dim,),
                    self.config.onnx_dir / f"{model_name}.onnx",
                    model_name=model_name,
                )
                print(f"  [ONNX] Exported {model_name}")
            except Exception as e:
                run.errors.append(f"ONNX export failed for {model_name}: {e}")

    def _print_summary(self, run: PipelineRun) -> None:
        """Print pipeline run summary."""
        duration = run.completed_at - run.started_at

        print("\n" + "=" * 70)
        print(f"  Pipeline Run Summary — {run.run_id}")
        print("=" * 70)
        print(f"  Status: {run.status}")
        print(f"  Trigger: {run.trigger}")
        print(f"  Duration: {duration:.1f}s")
        print(f"  Models retrained: {', '.join(run.models_retrained) or 'none'}")
        print(f"  Models promoted: {', '.join(run.models_promoted) or 'none'}")

        if run.drift_reports:
            print(f"  Drift reports:")
            for name, report in run.drift_reports.items():
                print(
                    f"    {name}: score={report['overall_drift_score']:.4f} "
                    f"drifted={report['n_drifted']}/{report['n_features']} "
                    f"retrain={'YES' if report['should_retrain'] else 'no'}"
                )

        if run.errors:
            print(f"  Errors ({len(run.errors)}):")
            for e in run.errors:
                print(f"    - {e}")

        print("=" * 70)


def run_continuous_training(
    trigger: str = "manual",
    config: PipelineConfig | None = None,
) -> PipelineRun:
    """Entry point for running the continuous training pipeline."""
    pipeline = ContinuousTrainingPipeline(config)
    return pipeline.run(trigger=trigger)
