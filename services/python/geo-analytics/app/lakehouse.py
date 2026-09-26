"""lakehouse.py — Q-wave Q5 (2026-09-25)

Lakehouse writer for zone_risk_features, following the repo's existing
lakehouse convention (ai-ml-platform/lakehouse/delta_feature_store.py):
partitioned Parquet under <base>/<table>/data.parquet plus a _catalog.json
entry. Uses pyarrow (same library as the existing feature store).

Fail-closed: LAKEHOUSE_PATH unset ⇒ writer disabled and the API reports the
feature-store sink as unavailable; a failed write raises (never fabricates a
partial catalogue).
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

try:
    import pyarrow as pa
    import pyarrow.parquet as pq

    _PYARROW_AVAILABLE = True
except ImportError:  # pragma: no cover - environment without pyarrow
    _PYARROW_AVAILABLE = False

ZONE_FEATURES_TABLE = "zone_risk_features"


class LakehouseUnavailableError(RuntimeError):
    """Lakehouse sink is not configured/available (fail-closed)."""


class LakehouseWriter:
    def __init__(self, base_path: str | None) -> None:
        if not base_path:
            raise LakehouseUnavailableError(
                "LAKEHOUSE_PATH is not configured (fail-closed, disclosed 2026-09-25)"
            )
        if not _PYARROW_AVAILABLE:
            raise LakehouseUnavailableError(
                "pyarrow is not installed in this runtime (fail-closed, disclosed 2026-09-25)"
            )
        self.base = Path(base_path)
        self.base.mkdir(parents=True, exist_ok=True)

    def write_zone_features(self, rows: list[dict[str, Any]]) -> Path:
        """Write zone feature rows as partitioned parquet + catalog entry
        (same layout as delta_feature_store's parquet fallback)."""
        if not rows:
            raise LakehouseUnavailableError(
                "refusing to write an empty zone_risk_features table (fail-closed)"
            )
        table_dir = self.base / ZONE_FEATURES_TABLE
        table_dir.mkdir(parents=True, exist_ok=True)
        table = pa.Table.from_pylist(rows)
        out = table_dir / "data.parquet"
        pq.write_table(table, str(out))
        self._update_catalog(rows)
        return out

    def _update_catalog(self, rows: list[dict[str, Any]]) -> None:
        catalog_path = self.base / "_catalog.json"
        catalog: dict[str, Any] = {}
        if catalog_path.exists():
            try:
                catalog = json.loads(catalog_path.read_text())
            except json.JSONDecodeError:
                catalog = {}
        catalog[ZONE_FEATURES_TABLE] = {
            "path": str(self.base / ZONE_FEATURES_TABLE),
            "format": "parquet",
            "row_count": len(rows),
            "columns": sorted(rows[0].keys()),
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "producer": "geo-analytics (q5-2026-09-25)",
        }
        catalog_path.write_text(json.dumps(catalog, indent=2))
