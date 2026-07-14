"""
Continuous Training API — FastAPI endpoints for managing the training pipeline.

Provides REST endpoints for:
- Triggering retraining (manual, drift-based)
- Checking drift status
- Viewing model registry (versions, champion/challenger)
- Managing schedules
- Viewing pipeline run history
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from continuous_training.drift_detector import DriftDetector, DriftConfig
from continuous_training.model_registry import ModelRegistry
from continuous_training.pipeline import (
    ContinuousTrainingPipeline,
    PipelineConfig,
    MODEL_CONFIGS,
)
from continuous_training.scheduler import TrainingScheduler


# ── Request/Response Models ──────────────────────────────────────────────────

class RetrainRequest(BaseModel):
    trigger: str = "manual"
    models: list[str] | None = None


class ScheduleConfigRequest(BaseModel):
    model_name: str
    interval_hours: float = 24.0
    enabled: bool = True
    min_new_samples: int = 1000
    drift_check_interval_hours: float = 6.0


class PromoteRequest(BaseModel):
    model_name: str
    version: int


class CompareRequest(BaseModel):
    model_name: str
    version_a: int
    version_b: int
    primary_metric: str = "auc"


# ── App Factory ──────────────────────────────────────────────────────────────

def create_continuous_training_app(
    pipeline_config: PipelineConfig | None = None,
) -> FastAPI:
    """Create the continuous training management API."""
    config = pipeline_config or PipelineConfig()
    app = FastAPI(
        title="NGApp Continuous Training API",
        description="Manage model retraining, drift detection, versioning, and scheduling",
        version="1.0.0",
    )

    registry = ModelRegistry(config.registry_dir)
    scheduler = TrainingScheduler(config)

    # ── Health ────────────────────────────────────────────────────────────

    @app.get("/ct/health")
    async def health() -> dict[str, Any]:
        return {
            "status": "healthy",
            "registered_models": registry.list_models(),
            "scheduler_running": scheduler._running,
        }

    # ── Retraining ────────────────────────────────────────────────────────

    @app.post("/ct/retrain")
    async def trigger_retrain(req: RetrainRequest) -> dict[str, Any]:
        """Trigger model retraining."""
        pipeline = ContinuousTrainingPipeline(config)
        run = pipeline.run(trigger=req.trigger)
        return run.to_dict()

    @app.post("/ct/retrain/{model_name}")
    async def retrain_model(model_name: str) -> dict[str, Any]:
        """Trigger retraining for a specific model."""
        if model_name not in MODEL_CONFIGS:
            raise HTTPException(404, f"Unknown model: {model_name}")
        result = scheduler.trigger_drift_retrain(model_name)
        return result

    # ── Drift Detection ───────────────────────────────────────────────────

    @app.get("/ct/drift/{model_name}")
    async def check_drift(model_name: str) -> dict[str, Any]:
        """Check drift status for a model."""
        import numpy as np
        import pandas as pd

        ref_path = config.drift_reference_dir / f"{model_name}_reference.json"
        data_path = config.data_dir / f"{model_name}.parquet"

        if not ref_path.exists():
            return {"status": "no_reference", "model_name": model_name}

        if not data_path.exists():
            return {"status": "no_data", "model_name": model_name}

        detector = DriftDetector(DriftConfig())
        detector.load_reference(ref_path)

        df = pd.read_parquet(data_path)
        model_config = MODEL_CONFIGS.get(model_name, {})
        feature_cols = model_config.get("feature_cols", [])

        # Engineer encoded categorical features if raw columns exist
        cat_encoding_map = {
            "doc_type_enc": "doc_type", "device_type_enc": "device_type",
            "claim_type_enc": "claim_type", "policy_product_enc": "policy_product",
            "occupation_enc": "occupation", "state_enc": "state", "gender_enc": "gender",
        }
        for enc_col, raw_col in cat_encoding_map.items():
            if enc_col in feature_cols and enc_col not in df.columns and raw_col in df.columns:
                df[enc_col] = df[raw_col].astype("category").cat.codes.astype(float)

        available = [c for c in feature_cols if c in df.columns]

        if not available:
            return {"status": "no_matching_features", "model_name": model_name}

        X = df[available].values.astype(np.float32)
        report = detector.check_drift(X, available, model_name)
        return report.to_dict()

    # ── Model Registry ────────────────────────────────────────────────────

    @app.get("/ct/models")
    async def list_models() -> dict[str, Any]:
        """List all registered models."""
        models = registry.list_models()
        result = {}
        for m in models:
            champion = registry.get_champion(m)
            challenger = registry.get_challenger(m)
            versions = registry.list_versions(m)
            result[m] = {
                "total_versions": len(versions),
                "champion": champion["version"] if champion else None,
                "challenger": challenger["version"] if challenger else None,
                "latest_version": versions[-1]["version"] if versions else None,
            }
        return result

    @app.get("/ct/models/{model_name}")
    async def get_model_versions(model_name: str) -> list[dict[str, Any]]:
        """Get all versions of a model."""
        versions = registry.list_versions(model_name)
        if not versions:
            raise HTTPException(404, f"No versions for model: {model_name}")
        return versions

    @app.get("/ct/models/{model_name}/champion")
    async def get_champion(model_name: str) -> dict[str, Any]:
        """Get the current champion version."""
        champion = registry.get_champion(model_name)
        if champion is None:
            raise HTTPException(404, f"No champion for model: {model_name}")
        return champion

    @app.post("/ct/models/promote")
    async def promote_model(req: PromoteRequest) -> dict[str, Any]:
        """Promote a model version to champion."""
        success = registry.promote_to_champion(req.model_name, req.version)
        if not success:
            raise HTTPException(400, "Promotion failed — version not found")
        return {
            "status": "promoted",
            "model_name": req.model_name,
            "version": req.version,
        }

    @app.post("/ct/models/compare")
    async def compare_models(req: CompareRequest) -> dict[str, Any]:
        """Compare two model versions."""
        return registry.compare_versions(
            req.model_name, req.version_a, req.version_b, req.primary_metric,
        )

    @app.post("/ct/models/auto-promote/{model_name}")
    async def auto_promote(model_name: str) -> dict[str, Any]:
        """Auto-promote challenger if it beats champion."""
        return registry.auto_promote(model_name)

    # ── Scheduler ─────────────────────────────────────────────────────────

    @app.get("/ct/scheduler/status")
    async def scheduler_status() -> dict[str, Any]:
        """Get scheduler status."""
        return scheduler.get_status()

    @app.post("/ct/scheduler/configure")
    async def configure_schedule(req: ScheduleConfigRequest) -> dict[str, Any]:
        """Configure a model's training schedule."""
        scheduler.configure_model(
            model_name=req.model_name,
            interval_hours=req.interval_hours,
            enabled=req.enabled,
            min_new_samples=req.min_new_samples,
            drift_check_interval_hours=req.drift_check_interval_hours,
        )
        return {"status": "configured", "config": req.model_dump()}

    @app.post("/ct/scheduler/configure-defaults")
    async def configure_defaults() -> dict[str, Any]:
        """Set up default schedules for all models."""
        scheduler.configure_defaults()
        return scheduler.get_status()

    @app.post("/ct/scheduler/start")
    async def start_scheduler() -> dict[str, Any]:
        """Start the background scheduler."""
        scheduler.start_background()
        return {"status": "started"}

    @app.post("/ct/scheduler/stop")
    async def stop_scheduler() -> dict[str, Any]:
        """Stop the background scheduler."""
        scheduler.stop_background()
        return {"status": "stopped"}

    # ── Pipeline History ──────────────────────────────────────────────────

    @app.get("/ct/history")
    async def pipeline_history(limit: int = 20) -> list[dict[str, Any]]:
        """Get recent pipeline run history."""
        return scheduler.get_run_history(limit)

    return app


ct_app = create_continuous_training_app()
