"""Claims data source for reserving.

Preserves the actuarial-platform contract:
  1. PostgreSQL claims table via DATABASE_URL (table name from
     ACTUARIAL_CLAIMS_TABLE, default "claims"), or
  2. a JSON data file at ACTUARIAL_CLAIMS_FILE.

Two claims-row shapes are accepted:

* The insureportal Drizzle ``claims`` table (design §2.7): camelCase columns
  claimNumber, policyId, incidentDate, reportedDate, claimedAmount,
  approvedAmount, paidAmount, settlementDate, status, tenantId. Origin
  period = incidentDate (accident-year convention); development lag is
  measured to settlementDate (paid) or reportedDate (incurred proxy).
* The legacy actuarial-platform JSON/DB shape: accident_year,
  development_period, paid_amount (or amount). Kept verbatim so the
  absorbed service's file contract keeps working.

When no source yields rows, DataSourceUnavailableError is raised — the
app boundary maps this to HTTP 503 (fail-closed, no canned numbers).
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


class DataSourceUnavailableError(Exception):
    """No claims/experience data source configured or reachable (HTTP 503)."""

    status_code = 503

    def __init__(self, what: str):
        super().__init__(
            f"{what} unavailable: no data source configured. Set "
            f"ACTUARIAL_CLAIMS_FILE/ACTUARIAL_EXPERIENCE_FILE or provide a "
            f"reachable PostgreSQL claims table via DATABASE_URL."
        )


@dataclass
class ClaimsSourceConfig:
    """Resolved claims-source configuration (env-driven, like the platform)."""

    database_url: str | None = None
    claims_table: str = "claims"
    claims_file: str = ""
    experience_file: str = ""
    product: str = "all_products"
    tenant_id: int | None = None

    @classmethod
    def from_env(cls, environ: dict[str, str] | None = None) -> ClaimsSourceConfig:
        env = environ if environ is not None else os.environ
        return cls(
            database_url=env.get("DATABASE_URL") or None,
            claims_table=(env.get("ACTUARIAL_CLAIMS_TABLE", "claims") or "claims").strip(),
            claims_file=(env.get("ACTUARIAL_CLAIMS_FILE", "") or "").strip(),
            experience_file=(env.get("ACTUARIAL_EXPERIENCE_FILE", "") or "").strip(),
            product=env.get("ACTUARIAL_PRODUCT", "all_products"),
        )


def _rows_from_db(cfg: ClaimsSourceConfig) -> tuple[list[dict[str, Any]], str]:
    """Read raw claim rows from PostgreSQL.

    Fail-closed: any connection/query problem yields no rows (and the
    caller then raises DataSourceUnavailableError rather than guessing).
    """
    if not cfg.database_url:
        return [], ""
    try:
        import psycopg2  # real PG driver, no fakes on the data path
        import psycopg2.extras
    except ImportError:  # pragma: no cover - dependency guaranteed in prod
        logger.warning("psycopg2 not installed; PG claims source unavailable")
        return [], ""
    try:
        conn = psycopg2.connect(cfg.database_url)
        conn.autocommit = True
    except Exception as exc:  # noqa: BLE001 - fail-closed at external boundary (never guess data)
        logger.warning("claims database connection failed: %s", exc)
        return [], ""
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Drizzle claims schema (design §2.7) — camelCase, quoted.
            cur.execute(
                f'SELECT "claimNumber", "policyId", "incidentDate", "reportedDate",'
                f' "claimedAmount", "approvedAmount", "paidAmount",'
                f' "settlementDate", "status", "tenantId"'
                f" FROM {cfg.claims_table}"
            )
            rows = [dict(r) for r in cur.fetchall()]
        return rows, f"postgres:{cfg.claims_table}"
    except Exception as exc:  # noqa: BLE001 - fail-closed at external boundary (never guess data)
        logger.info("claims table %r not usable: %s", cfg.claims_table, exc)
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001 - best-effort rollback at failed boundary
            logger.debug("rollback after failed claims query also failed")
        return [], ""
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001 - best-effort close at failed boundary
            logger.debug("claims connection close failed")


def _rows_from_file(path: str) -> tuple[list[dict[str, Any]], str]:
    """Read claim rows from a JSON file.

    Accepted shapes (preserved from actuarial-platform):
      {"claims": [{"accident_year": 2023, "development_period": 0, "amount": 123.0}, ...]}
      {"claims": [{drizzle-claims-shape}, ...]}       (camelCase columns)
      {"triangle": {"2021": [c0, c1, ...], ...}}       (cumulative rows)
      [{"accident_year": ..., "development_period": ..., ...}, ...]  (bare list)
    """
    if not path or not os.path.exists(path):
        return [], ""
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    if isinstance(data, dict) and "triangle" in data:
        rows: list[dict[str, Any]] = []
        for year, values in data["triangle"].items():
            prev = 0.0
            for dev, cum in enumerate(values):
                rows.append(
                    {
                        "accident_year": str(year),
                        "development_period": dev,
                        "amount": float(cum) - prev,
                        "cumulative": float(cum),
                    }
                )
                prev = float(cum)
        return rows, f"file:{path}"
    claims = data.get("claims", data) if isinstance(data, dict) else data
    if not isinstance(claims, list):
        return [], ""
    rows = [dict(c) for c in claims if isinstance(c, dict)]
    return rows, f"file:{path}"


def load_claims(
    cfg: ClaimsSourceConfig | None = None,
    *,
    what: str = "loss triangle",
) -> tuple[list[dict[str, Any]], str]:
    """Load claim rows from file first, then database (platform precedence).

    Returns (rows, source_label). Raises DataSourceUnavailableError (503)
    when neither source yields any rows.
    """
    cfg = cfg or ClaimsSourceConfig.from_env()
    rows, source = _rows_from_file(cfg.claims_file)
    if not rows:
        rows, source = _rows_from_db(cfg)
    if not rows:
        raise DataSourceUnavailableError(what)
    return rows, source
