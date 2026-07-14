"""
Data Drift Detection Engine

Monitors feature distributions for drift using:
- Population Stability Index (PSI)
- Kolmogorov-Smirnov test
- Jensen-Shannon divergence
- Feature-level and dataset-level drift scores

Triggers retraining when drift exceeds configurable thresholds.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from scipy import stats


@dataclass
class DriftResult:
    """Result of a drift detection check."""
    feature_name: str
    psi: float
    ks_statistic: float
    ks_pvalue: float
    js_divergence: float
    mean_shift: float
    std_shift: float
    is_drifted: bool
    drift_severity: str  # "none", "minor", "moderate", "severe"

    def to_dict(self) -> dict[str, Any]:
        return {
            "feature_name": self.feature_name,
            "psi": round(self.psi, 6),
            "ks_statistic": round(self.ks_statistic, 6),
            "ks_pvalue": round(self.ks_pvalue, 6),
            "js_divergence": round(self.js_divergence, 6),
            "mean_shift": round(self.mean_shift, 6),
            "std_shift": round(self.std_shift, 6),
            "is_drifted": bool(self.is_drifted),
            "drift_severity": self.drift_severity,
        }


@dataclass
class DatasetDriftReport:
    """Aggregated drift report for a full dataset."""
    model_name: str
    timestamp: float
    n_features: int
    n_drifted: int
    overall_drift_score: float
    should_retrain: bool
    feature_reports: list[DriftResult] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "model_name": self.model_name,
            "timestamp": self.timestamp,
            "n_features": self.n_features,
            "n_drifted": self.n_drifted,
            "overall_drift_score": round(self.overall_drift_score, 6),
            "should_retrain": bool(self.should_retrain),
            "feature_reports": [r.to_dict() for r in self.feature_reports],
        }


@dataclass
class DriftConfig:
    """Configuration for drift detection thresholds."""
    psi_threshold: float = 0.2
    ks_pvalue_threshold: float = 0.01
    js_threshold: float = 0.1
    mean_shift_threshold: float = 0.5
    drift_feature_pct_threshold: float = 0.3
    n_bins: int = 20
    min_samples: int = 100


class DriftDetector:
    """Detects data drift between reference and production distributions."""

    def __init__(self, config: DriftConfig | None = None) -> None:
        self.config = config or DriftConfig()
        self._reference_stats: dict[str, dict[str, Any]] = {}

    def set_reference(self, X_ref: np.ndarray, feature_names: list[str]) -> None:
        """Store reference distribution statistics from training data."""
        if X_ref.shape[1] != len(feature_names):
            raise ValueError(
                f"Feature count mismatch: {X_ref.shape[1]} vs {len(feature_names)}"
            )

        self._reference_stats = {}
        for i, name in enumerate(feature_names):
            col = X_ref[:, i].astype(np.float64)
            col = col[~np.isnan(col)]
            if len(col) < self.config.min_samples:
                continue

            hist, bin_edges = np.histogram(col, bins=self.config.n_bins, density=True)
            hist = hist / (hist.sum() + 1e-10)

            self._reference_stats[name] = {
                "mean": float(np.mean(col)),
                "std": float(np.std(col)),
                "min": float(np.min(col)),
                "max": float(np.max(col)),
                "histogram": hist.tolist(),
                "bin_edges": bin_edges.tolist(),
                "n_samples": len(col),
                "percentiles": {
                    "p5": float(np.percentile(col, 5)),
                    "p25": float(np.percentile(col, 25)),
                    "p50": float(np.percentile(col, 50)),
                    "p75": float(np.percentile(col, 75)),
                    "p95": float(np.percentile(col, 95)),
                },
            }

    def save_reference(self, path: Path) -> None:
        """Save reference statistics to disk."""
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(self._reference_stats, f, indent=2)

    def load_reference(self, path: Path) -> None:
        """Load reference statistics from disk."""
        with open(path) as f:
            self._reference_stats = json.load(f)

    def check_drift(
        self,
        X_new: np.ndarray,
        feature_names: list[str],
        model_name: str = "model",
    ) -> DatasetDriftReport:
        """Check for drift between reference and new data."""
        if not self._reference_stats:
            raise RuntimeError("No reference distribution set. Call set_reference() first.")

        feature_reports: list[DriftResult] = []
        drift_scores: list[float] = []

        for i, name in enumerate(feature_names):
            if name not in self._reference_stats:
                continue

            ref = self._reference_stats[name]
            col = X_new[:, i].astype(np.float64)
            col = col[~np.isnan(col)]

            if len(col) < self.config.min_samples:
                continue

            result = self._check_feature_drift(col, ref, name)
            feature_reports.append(result)
            drift_scores.append(result.psi)

        n_drifted = sum(1 for r in feature_reports if r.is_drifted)
        overall_score = float(np.mean(drift_scores)) if drift_scores else 0.0

        drifted_pct = n_drifted / max(len(feature_reports), 1)
        should_retrain = (
            drifted_pct >= self.config.drift_feature_pct_threshold
            or overall_score >= self.config.psi_threshold
        )

        return DatasetDriftReport(
            model_name=model_name,
            timestamp=time.time(),
            n_features=len(feature_reports),
            n_drifted=n_drifted,
            overall_drift_score=overall_score,
            should_retrain=should_retrain,
            feature_reports=feature_reports,
        )

    def _check_feature_drift(
        self,
        new_data: np.ndarray,
        ref_stats: dict[str, Any],
        feature_name: str,
    ) -> DriftResult:
        """Check drift for a single feature."""
        ref_mean = ref_stats["mean"]
        ref_std = max(ref_stats["std"], 1e-8)

        new_mean = float(np.mean(new_data))
        new_std = float(np.std(new_data))

        mean_shift = abs(new_mean - ref_mean) / ref_std
        std_shift = abs(new_std - ref_std) / ref_std

        # PSI
        ref_hist = np.array(ref_stats["histogram"]) + 1e-10
        bin_edges = np.array(ref_stats["bin_edges"])
        new_hist, _ = np.histogram(new_data, bins=bin_edges, density=True)
        new_hist = new_hist / (new_hist.sum() + 1e-10) + 1e-10
        psi = float(np.sum((new_hist - ref_hist) * np.log(new_hist / ref_hist)))

        # KS test — generate reference samples from stored percentiles
        ref_samples = np.random.default_rng(42).normal(
            ref_mean, ref_std, size=min(len(new_data), 10000)
        )
        ks_stat, ks_pval = stats.ks_2samp(ref_samples, new_data)

        # Jensen-Shannon divergence
        ref_norm = ref_hist / ref_hist.sum()
        new_norm = new_hist / new_hist.sum()
        m = 0.5 * (ref_norm + new_norm)
        js_div = float(
            0.5 * np.sum(ref_norm * np.log(ref_norm / m + 1e-10))
            + 0.5 * np.sum(new_norm * np.log(new_norm / m + 1e-10))
        )

        is_drifted = (
            psi > self.config.psi_threshold
            or ks_pval < self.config.ks_pvalue_threshold
            or js_div > self.config.js_threshold
        )

        if psi > 0.5 or js_div > 0.3:
            severity = "severe"
        elif psi > 0.2 or js_div > 0.1:
            severity = "moderate"
        elif psi > 0.1 or js_div > 0.05:
            severity = "minor"
        else:
            severity = "none"

        return DriftResult(
            feature_name=feature_name,
            psi=psi,
            ks_statistic=float(ks_stat),
            ks_pvalue=float(ks_pval),
            js_divergence=js_div,
            mean_shift=mean_shift,
            std_shift=std_shift,
            is_drifted=is_drifted,
            drift_severity=severity,
        )


class PerformanceDriftDetector:
    """Monitors model performance degradation over time."""

    def __init__(
        self,
        auc_drop_threshold: float = 0.05,
        f1_drop_threshold: float = 0.10,
        window_size: int = 1000,
    ) -> None:
        self.auc_drop_threshold = auc_drop_threshold
        self.f1_drop_threshold = f1_drop_threshold
        self.window_size = window_size
        self._baseline_metrics: dict[str, float] = {}
        self._predictions: list[float] = []
        self._actuals: list[float] = []

    def set_baseline(self, metrics: dict[str, float]) -> None:
        """Set baseline performance metrics from training evaluation."""
        self._baseline_metrics = metrics.copy()

    def add_prediction(self, predicted: float, actual: float) -> None:
        """Add a prediction-actual pair for monitoring."""
        self._predictions.append(predicted)
        self._actuals.append(actual)

        if len(self._predictions) > self.window_size * 2:
            self._predictions = self._predictions[-self.window_size:]
            self._actuals = self._actuals[-self.window_size:]

    def check_performance(self) -> dict[str, Any]:
        """Check if model performance has degraded."""
        if len(self._predictions) < self.window_size:
            return {
                "status": "insufficient_data",
                "n_samples": len(self._predictions),
                "required": self.window_size,
            }

        preds = np.array(self._predictions[-self.window_size:])
        actuals = np.array(self._actuals[-self.window_size:])

        from sklearn.metrics import roc_auc_score, f1_score
        try:
            current_auc = float(roc_auc_score(actuals, preds))
        except ValueError:
            current_auc = 0.0

        binary_preds = (preds >= 0.5).astype(int)
        current_f1 = float(f1_score(actuals, binary_preds, zero_division=0))

        baseline_auc = self._baseline_metrics.get("auc", 1.0)
        baseline_f1 = self._baseline_metrics.get("f1", 1.0)

        auc_drop = baseline_auc - current_auc
        f1_drop = baseline_f1 - current_f1

        should_retrain = (
            auc_drop > self.auc_drop_threshold
            or f1_drop > self.f1_drop_threshold
        )

        return {
            "status": "degraded" if should_retrain else "healthy",
            "current_auc": round(current_auc, 4),
            "current_f1": round(current_f1, 4),
            "baseline_auc": round(baseline_auc, 4),
            "baseline_f1": round(baseline_f1, 4),
            "auc_drop": round(auc_drop, 4),
            "f1_drop": round(f1_drop, 4),
            "should_retrain": should_retrain,
            "n_samples": len(self._predictions),
        }
