"""
Training Scheduler

Supports:
- Cron-based scheduled retraining (daily, weekly, custom)
- Event-driven triggers (drift detected, performance degraded, new data threshold)
- Configurable per-model schedules
- Run history and next-run tracking

Uses APScheduler-compatible interface but runs standalone without external deps.
"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from continuous_training.pipeline import ContinuousTrainingPipeline, PipelineConfig


@dataclass
class ScheduleConfig:
    """Per-model schedule configuration."""
    model_name: str
    interval_hours: float = 24.0
    enabled: bool = True
    min_new_samples: int = 1000
    drift_check_interval_hours: float = 6.0
    last_run_at: float = 0.0
    next_run_at: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "model_name": self.model_name,
            "interval_hours": self.interval_hours,
            "enabled": self.enabled,
            "min_new_samples": self.min_new_samples,
            "drift_check_interval_hours": self.drift_check_interval_hours,
            "last_run_at": self.last_run_at,
            "next_run_at": self.next_run_at,
        }


@dataclass
class SchedulerState:
    """Persistent scheduler state."""
    schedules: dict[str, ScheduleConfig] = field(default_factory=dict)
    run_history: list[dict[str, Any]] = field(default_factory=list)
    total_runs: int = 0


class TrainingScheduler:
    """Manages scheduled and event-driven model retraining."""

    def __init__(
        self,
        pipeline_config: PipelineConfig | None = None,
        state_dir: str | Path = "continuous_training/scheduler",
    ) -> None:
        self.pipeline_config = pipeline_config or PipelineConfig()
        self.state_dir = Path(state_dir)
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self._state_path = self.state_dir / "scheduler_state.json"
        self.state = self._load_state()
        self._running = False
        self._thread: threading.Thread | None = None
        self._callbacks: list[Callable[[dict[str, Any]], None]] = []

    def _load_state(self) -> SchedulerState:
        if self._state_path.exists():
            with open(self._state_path) as f:
                data = json.load(f)
            state = SchedulerState()
            state.total_runs = data.get("total_runs", 0)
            state.run_history = data.get("run_history", [])
            for name, sched in data.get("schedules", {}).items():
                state.schedules[name] = ScheduleConfig(**sched)
            return state
        return SchedulerState()

    def _save_state(self) -> None:
        data = {
            "total_runs": self.state.total_runs,
            "run_history": self.state.run_history[-100:],
            "schedules": {k: v.to_dict() for k, v in self.state.schedules.items()},
        }
        with open(self._state_path, "w") as f:
            json.dump(data, f, indent=2)

    def configure_model(
        self,
        model_name: str,
        interval_hours: float = 24.0,
        enabled: bool = True,
        min_new_samples: int = 1000,
        drift_check_interval_hours: float = 6.0,
    ) -> None:
        """Configure or update a model's training schedule."""
        now = time.time()
        self.state.schedules[model_name] = ScheduleConfig(
            model_name=model_name,
            interval_hours=interval_hours,
            enabled=enabled,
            min_new_samples=min_new_samples,
            drift_check_interval_hours=drift_check_interval_hours,
            next_run_at=now + interval_hours * 3600,
        )
        self._save_state()
        print(f"  [Scheduler] Configured {model_name}: every {interval_hours}h")

    def configure_defaults(self) -> None:
        """Set up default schedules for all standard models."""
        defaults = {
            "fraud_detection": {"interval_hours": 24, "drift_check_interval_hours": 4},
            "churn_prediction": {"interval_hours": 168, "drift_check_interval_hours": 24},
            "claims_adjudication": {"interval_hours": 72, "drift_check_interval_hours": 12},
            "credit_scoring": {"interval_hours": 168, "drift_check_interval_hours": 24},
            "anomaly_detection": {"interval_hours": 24, "drift_check_interval_hours": 4},
        }
        for model_name, config in defaults.items():
            self.configure_model(model_name, **config)

    def add_callback(self, callback: Callable[[dict[str, Any]], None]) -> None:
        """Register a callback that fires after each training run."""
        self._callbacks.append(callback)

    def check_and_run(self) -> list[dict[str, Any]]:
        """Check all schedules and run retraining for models that are due."""
        now = time.time()
        results: list[dict[str, Any]] = []

        models_due: list[str] = []
        for name, sched in self.state.schedules.items():
            if not sched.enabled:
                continue
            if now >= sched.next_run_at:
                models_due.append(name)

        if not models_due:
            return results

        print(f"\n  [Scheduler] Models due for retraining: {', '.join(models_due)}")

        pipeline = ContinuousTrainingPipeline(self.pipeline_config)
        run = pipeline.run(trigger="scheduled")

        # Update schedules
        for name in models_due:
            sched = self.state.schedules[name]
            sched.last_run_at = now
            sched.next_run_at = now + sched.interval_hours * 3600

        # Record in history
        run_record = {
            "run_id": run.run_id,
            "timestamp": now,
            "trigger": "scheduled",
            "models_due": models_due,
            "models_retrained": run.models_retrained,
            "models_promoted": run.models_promoted,
            "status": run.status,
            "errors": run.errors,
        }
        self.state.run_history.append(run_record)
        self.state.total_runs += 1
        self._save_state()

        # Fire callbacks
        for cb in self._callbacks:
            try:
                cb(run_record)
            except Exception:
                pass

        results.append(run_record)
        return results

    def trigger_drift_retrain(self, model_name: str) -> dict[str, Any]:
        """Trigger immediate retraining due to drift detection."""
        print(f"\n  [Scheduler] Drift-triggered retraining for {model_name}")

        pipeline = ContinuousTrainingPipeline(self.pipeline_config)
        run = pipeline.run(trigger="drift")

        now = time.time()
        if model_name in self.state.schedules:
            self.state.schedules[model_name].last_run_at = now
            self.state.schedules[model_name].next_run_at = (
                now + self.state.schedules[model_name].interval_hours * 3600
            )

        run_record = {
            "run_id": run.run_id,
            "timestamp": now,
            "trigger": "drift",
            "model": model_name,
            "models_retrained": run.models_retrained,
            "models_promoted": run.models_promoted,
            "status": run.status,
            "errors": run.errors,
        }
        self.state.run_history.append(run_record)
        self.state.total_runs += 1
        self._save_state()

        return run_record

    def start_background(self, check_interval_seconds: float = 300) -> None:
        """Start the scheduler loop in a background thread."""
        if self._running:
            return

        self._running = True

        def _loop() -> None:
            print(f"  [Scheduler] Background loop started (interval={check_interval_seconds}s)")
            while self._running:
                try:
                    self.check_and_run()
                except Exception as e:
                    print(f"  [Scheduler] Error in check loop: {e}")
                time.sleep(check_interval_seconds)

        self._thread = threading.Thread(target=_loop, daemon=True, name="training-scheduler")
        self._thread.start()

    def stop_background(self) -> None:
        """Stop the background scheduler loop."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=10)
            self._thread = None
        print("  [Scheduler] Background loop stopped")

    def get_status(self) -> dict[str, Any]:
        """Get current scheduler status."""
        now = time.time()
        schedules_status = {}
        for name, sched in self.state.schedules.items():
            time_until = max(0, sched.next_run_at - now)
            schedules_status[name] = {
                "enabled": sched.enabled,
                "interval_hours": sched.interval_hours,
                "last_run": sched.last_run_at,
                "next_run": sched.next_run_at,
                "time_until_next_hours": round(time_until / 3600, 2),
                "drift_check_interval_hours": sched.drift_check_interval_hours,
            }

        return {
            "running": self._running,
            "total_runs": self.state.total_runs,
            "schedules": schedules_status,
            "recent_runs": self.state.run_history[-5:],
        }

    def get_run_history(self, limit: int = 20) -> list[dict[str, Any]]:
        """Get recent run history."""
        return self.state.run_history[-limit:]
