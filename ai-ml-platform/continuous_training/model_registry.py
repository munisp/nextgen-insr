"""
Model Registry & Versioning

Tracks model versions, metrics, lineage, and deployment status.
Supports champion-challenger comparison and automatic promotion.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class ModelVersion:
    """A single versioned model artifact."""
    model_name: str
    version: int
    created_at: float
    metrics: dict[str, float]
    training_config: dict[str, Any]
    data_hash: str
    weights_path: str
    status: str = "staging"  # staging | champion | challenger | archived
    promoted_at: float | None = None
    archived_at: float | None = None
    parent_version: int | None = None
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "model_name": self.model_name,
            "version": self.version,
            "created_at": self.created_at,
            "metrics": self.metrics,
            "training_config": self.training_config,
            "data_hash": self.data_hash,
            "weights_path": self.weights_path,
            "status": self.status,
            "promoted_at": self.promoted_at,
            "archived_at": self.archived_at,
            "parent_version": self.parent_version,
            "tags": self.tags,
        }


class ModelRegistry:
    """Versioned model registry with champion-challenger support."""

    def __init__(self, registry_dir: str | Path = "model_registry") -> None:
        self.registry_dir = Path(registry_dir)
        self.registry_dir.mkdir(parents=True, exist_ok=True)
        self._catalog_path = self.registry_dir / "_catalog.json"
        self._catalog: dict[str, list[dict[str, Any]]] = self._load_catalog()

    def _load_catalog(self) -> dict[str, list[dict[str, Any]]]:
        if self._catalog_path.exists():
            with open(self._catalog_path) as f:
                return json.load(f)
        return {}

    def _save_catalog(self) -> None:
        with open(self._catalog_path, "w") as f:
            json.dump(self._catalog, f, indent=2)

    def register_model(
        self,
        model_name: str,
        weights_path: Path,
        metrics: dict[str, float],
        training_config: dict[str, Any],
        data_hash: str = "",
        tags: list[str] | None = None,
    ) -> ModelVersion:
        """Register a new model version."""
        if model_name not in self._catalog:
            self._catalog[model_name] = []

        version = len(self._catalog[model_name]) + 1

        # Copy weights to versioned path
        version_dir = self.registry_dir / model_name / f"v{version}"
        version_dir.mkdir(parents=True, exist_ok=True)
        dest_weights = version_dir / weights_path.name
        shutil.copy2(weights_path, dest_weights)

        # Compute weights hash if data_hash not provided
        if not data_hash:
            data_hash = self._compute_file_hash(weights_path)

        parent = version - 1 if version > 1 else None

        mv = ModelVersion(
            model_name=model_name,
            version=version,
            created_at=time.time(),
            metrics=metrics,
            training_config=training_config,
            data_hash=data_hash,
            weights_path=str(dest_weights),
            status="staging",
            parent_version=parent,
            tags=tags or [],
        )

        self._catalog[model_name].append(mv.to_dict())
        self._save_catalog()

        # Save version metadata
        with open(version_dir / "metadata.json", "w") as f:
            json.dump(mv.to_dict(), f, indent=2)

        print(f"  [Registry] Registered {model_name} v{version} (status=staging)")
        return mv

    def promote_to_champion(self, model_name: str, version: int) -> bool:
        """Promote a model version to champion (production)."""
        if model_name not in self._catalog:
            return False

        versions = self._catalog[model_name]

        # Archive current champion
        for v in versions:
            if v["status"] == "champion":
                v["status"] = "archived"
                v["archived_at"] = time.time()

        # Promote new version
        for v in versions:
            if v["version"] == version:
                v["status"] = "champion"
                v["promoted_at"] = time.time()
                self._save_catalog()
                print(f"  [Registry] Promoted {model_name} v{version} to champion")
                return True

        return False

    def set_challenger(self, model_name: str, version: int) -> bool:
        """Set a model version as challenger for A/B testing."""
        if model_name not in self._catalog:
            return False

        for v in self._catalog[model_name]:
            if v["status"] == "challenger":
                v["status"] = "staging"

        for v in self._catalog[model_name]:
            if v["version"] == version:
                v["status"] = "challenger"
                self._save_catalog()
                print(f"  [Registry] Set {model_name} v{version} as challenger")
                return True

        return False

    def get_champion(self, model_name: str) -> dict[str, Any] | None:
        """Get the current champion version for a model."""
        if model_name not in self._catalog:
            return None
        for v in self._catalog[model_name]:
            if v["status"] == "champion":
                return v
        return None

    def get_challenger(self, model_name: str) -> dict[str, Any] | None:
        """Get the current challenger version for a model."""
        if model_name not in self._catalog:
            return None
        for v in self._catalog[model_name]:
            if v["status"] == "challenger":
                return v
        return None

    def get_version(self, model_name: str, version: int) -> dict[str, Any] | None:
        """Get a specific model version."""
        if model_name not in self._catalog:
            return None
        for v in self._catalog[model_name]:
            if v["version"] == version:
                return v
        return None

    def list_versions(self, model_name: str) -> list[dict[str, Any]]:
        """List all versions of a model."""
        return self._catalog.get(model_name, [])

    def list_models(self) -> list[str]:
        """List all registered model names."""
        return list(self._catalog.keys())

    def compare_versions(
        self,
        model_name: str,
        version_a: int,
        version_b: int,
        primary_metric: str = "auc",
    ) -> dict[str, Any]:
        """Compare two model versions."""
        va = self.get_version(model_name, version_a)
        vb = self.get_version(model_name, version_b)

        if va is None or vb is None:
            return {"error": "Version not found"}

        metric_a = va["metrics"].get(primary_metric, 0.0)
        metric_b = vb["metrics"].get(primary_metric, 0.0)

        return {
            "model_name": model_name,
            "version_a": version_a,
            "version_b": version_b,
            "primary_metric": primary_metric,
            f"v{version_a}_{primary_metric}": metric_a,
            f"v{version_b}_{primary_metric}": metric_b,
            "improvement": round(metric_b - metric_a, 6),
            "improvement_pct": round(
                (metric_b - metric_a) / max(abs(metric_a), 1e-8) * 100, 2
            ),
            "winner": f"v{version_b}" if metric_b > metric_a else f"v{version_a}",
        }

    def auto_promote(
        self,
        model_name: str,
        min_improvement: float = 0.01,
        primary_metric: str = "auc",
    ) -> dict[str, Any]:
        """Automatically promote challenger if it beats champion by min_improvement."""
        champion = self.get_champion(model_name)
        challenger = self.get_challenger(model_name)

        if champion is None and challenger is None:
            latest = self._catalog.get(model_name, [])
            if latest:
                self.promote_to_champion(model_name, latest[-1]["version"])
                return {
                    "action": "promoted_first",
                    "version": latest[-1]["version"],
                }
            return {"action": "no_models"}

        if champion is None and challenger is not None:
            self.promote_to_champion(model_name, challenger["version"])
            return {
                "action": "promoted_challenger_no_champion",
                "version": challenger["version"],
            }

        if challenger is None:
            return {"action": "no_challenger"}

        champ_metric = champion["metrics"].get(primary_metric, 0.0)
        chall_metric = challenger["metrics"].get(primary_metric, 0.0)
        improvement = chall_metric - champ_metric

        if improvement >= min_improvement:
            self.promote_to_champion(model_name, challenger["version"])
            return {
                "action": "promoted",
                "version": challenger["version"],
                "improvement": round(improvement, 6),
            }

        return {
            "action": "kept_champion",
            "champion_version": champion["version"],
            "challenger_version": challenger["version"],
            "improvement": round(improvement, 6),
            "required": min_improvement,
        }

    @staticmethod
    def _compute_file_hash(path: Path, chunk_size: int = 8192) -> str:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            while chunk := f.read(chunk_size):
                h.update(chunk)
        return h.hexdigest()[:16]
