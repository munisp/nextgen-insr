"""Monthly reserve run batch job.

Reads claims from the configured source (PG Drizzle claims table or JSON
file — the absorbed actuarial-platform contract), builds paid triangles,
runs chainladder CL/BF/Mack, and persists a reserve_run + triangle
snapshot (act_reserve_runs / act_triangles shape, design §5).

Fail-closed: DataSourceUnavailableError (→ HTTP 503 at the app boundary)
when no claims source yields rows. No canned numbers, ever.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Protocol

import numpy as np
import pandas as pd

from ..reserving.data_source import (
    ClaimsSourceConfig,
    load_claims,
)
from ..reserving.methods import (
    bornhuetter_ferguson,
    bootstrap_odp,
    cape_cod,
    chain_ladder,
    clark,
    mack,
)
from ..reserving.triangles import (
    cumulative_triangle_from_claims,
    legacy_cells_to_triangle_dict,
)

logger = logging.getLogger(__name__)

RUN_STATUSES = ("computed", "approved", "retired")


@dataclass(frozen=True)
class ReserveRunResult:
    run_id: int
    product_line: str
    as_of: str
    method: str
    ultimate_by_origin: dict[str, float]
    ibnr: float
    mack_sd: dict[str, float | None] | None
    assumption_set_id: int | None
    status: str
    data_source: str
    triangle: dict[str, list[float]]


class ReserveRunStore(Protocol):
    """Persistence boundary for reserve runs and triangle snapshots."""

    def insert_run(self, record: dict[str, Any]) -> int: ...
    def insert_triangle(self, run_id: int, record: dict[str, Any]) -> None: ...
    def approve_run(self, run_id: int, approved_by: str) -> None: ...
    def get_run(self, run_id: int) -> dict[str, Any]: ...


class PgReserveRunStore:
    """PostgreSQL persistence (real psycopg2) — act_reserve_runs and
    act_triangles tables owned by the Drizzle migration (Leg D). DDL is NOT
    created here; the job fails closed if tables are missing."""

    def __init__(self, database_url: str, tenant_id: int = 1) -> None:
        import psycopg2
        import psycopg2.extras

        self._conn = psycopg2.connect(database_url)
        self._conn.autocommit = True
        self._extras = psycopg2.extras
        self._tenant_id = tenant_id

    def insert_run(self, record: dict[str, Any]) -> int:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO act_reserve_runs
                    ("productLineId", "asOf", method, "ultimateByOrigin", ibnr,
                     "mackSd", "assumptionSetId", status, "tenantId")
                VALUES (%s, %s, %s, %s::jsonb, %s, %s::jsonb, %s, %s, %s)
                RETURNING id
                """,
                (
                    record["product_line"],
                    record["as_of"],
                    record["method"],
                    json.dumps(record["ultimate_by_origin"]),
                    record["ibnr"],
                    json.dumps(record.get("mack_sd") or {}),
                    record.get("assumption_set_id"),
                    record["status"],
                    self._tenant_id,
                ),
            )
            return int(cur.fetchone()[0])

    def insert_triangle(self, run_id: int, record: dict[str, Any]) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO act_triangles
                    ("productLineId", "asOf", "triangleType", "originPeriods",
                     "devPeriods", cells, "sourceRunId", "tenantId")
                VALUES (%s, %s, %s, %s::jsonb, %s, %s::jsonb, %s, %s)
                """,
                (
                    record["product_line"],
                    record["as_of"],
                    record["triangle_type"],
                    json.dumps(record["origin_periods"]),
                    record["dev_periods"],
                    json.dumps(record["cells"]),
                    run_id,
                    self._tenant_id,
                ),
            )

    def approve_run(self, run_id: int, approved_by: str) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                "UPDATE act_reserve_runs SET status = 'approved' WHERE id = %s",
                (run_id,),
            )
            if cur.rowcount == 0:
                raise KeyError(f"reserve run {run_id} not found")

    def get_run(self, run_id: int) -> dict[str, Any]:
        with self._conn.cursor(cursor_factory=self._extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM act_reserve_runs WHERE id = %s", (run_id,))
            row = cur.fetchone()
            if row is None:
                raise KeyError(f"reserve run {run_id} not found")
            return dict(row)


class InMemoryReserveRunStore:
    """Documented persistence boundary double for tests/local dry-runs where
    no Postgres container is available. NOT used on compute paths; it only
    stores/retrieves results already computed by real library calls."""

    def __init__(self) -> None:
        self._runs: dict[int, dict[str, Any]] = {}
        self._triangles: list[dict[str, Any]] = []
        self._next_id = 1

    def insert_run(self, record: dict[str, Any]) -> int:
        run_id = self._next_id
        self._next_id += 1
        self._runs[run_id] = dict(record, id=run_id)
        return run_id

    def insert_triangle(self, run_id: int, record: dict[str, Any]) -> None:
        self._triangles.append(dict(record, source_run_id=run_id))

    def approve_run(self, run_id: int, approved_by: str) -> None:
        if run_id not in self._runs:
            raise KeyError(f"reserve run {run_id} not found")
        self._runs[run_id]["status"] = "approved"
        self._runs[run_id]["approved_by"] = approved_by

    def get_run(self, run_id: int) -> dict[str, Any]:
        if run_id not in self._runs:
            raise KeyError(f"reserve run {run_id} not found")
        return dict(self._runs[run_id])


def run_monthly_reserve(
    product_line: str,
    as_of: str,
    method: str,
    store: ReserveRunStore,
    *,
    config: ClaimsSourceConfig | None = None,
    apriori_ultimates: np.ndarray | None = None,
    earned_premium: np.ndarray | None = None,
    n_sims: int = 1000,
    assumption_set_id: int | None = None,
) -> ReserveRunResult:
    """Run the monthly reserve job end to end and persist results.

    method: 'chainladder' | 'bf' | 'mack' | 'bootstrap_odp' | 'cape_cod' |
    'clark'. BF requires apriori_ultimates (priced LR × earned premium per
    origin — closes the price↔reserve loop). Cape Cod requires
    earned_premium (per-origin exposure). Bootstrap ODP reports the
    bootstrap mean IBNR and standard error; Clark uses the loglogistic
    growth-curve LDFs. Raises DataSourceUnavailableError when the claims
    source is absent.
    """
    methods = ("chainladder", "bf", "mack", "bootstrap_odp", "cape_cod", "clark")
    if method not in methods:
        raise ValueError(f"method must be {'|'.join(methods)}, got {method!r}")
    cfg = config or ClaimsSourceConfig.from_env()
    rows, source = load_claims(cfg, what="monthly reserve run")

    tri, triangle_dict = _build_triangle(rows)
    if method == "chainladder":
        result = chain_ladder(tri)
        mack_sd = None
    elif method == "mack":
        mk = mack(tri)
        result = mk
        mack_sd = mk["mack_se_by_origin"]
    elif method == "bootstrap_odp":
        bo = bootstrap_odp(tri, n_sims=n_sims, random_state=42)
        result = {
            "ultimate_by_origin": bo["ultimate_mean_by_origin"],
            "total_ibnr": bo["total_ibnr_mean"],
            "bootstrap_odp": bo,
        }
        mack_sd = None
    elif method == "cape_cod":
        if earned_premium is None:
            raise ValueError("cape_cod requires earned_premium (per-origin exposure)")
        result = cape_cod(tri, np.asarray(earned_premium, dtype=float))
        mack_sd = None
    elif method == "clark":
        result = clark(tri)
        mack_sd = None
    else:
        if apriori_ultimates is None:
            raise ValueError("bf requires apriori_ultimates (priced LR × earned premium)")
        result = bornhuetter_ferguson(tri, np.asarray(apriori_ultimates, dtype=float))
        mack_sd = None

    record = {
        "product_line": product_line,
        "as_of": as_of,
        "method": method,
        "ultimate_by_origin": result["ultimate_by_origin"],
        "ibnr": result["total_ibnr"],
        "mack_sd": mack_sd,
        "assumption_set_id": assumption_set_id,
        "status": "computed",
        "data_source": source,
    }
    run_id = store.insert_run(record)
    store.insert_triangle(
        run_id,
        {
            "product_line": product_line,
            "as_of": as_of,
            "triangle_type": "paid",
            "origin_periods": sorted(triangle_dict.keys()),
            "dev_periods": max(len(v) for v in triangle_dict.values()),
            "cells": triangle_dict,
        },
    )
    return ReserveRunResult(
        run_id=run_id,
        product_line=product_line,
        as_of=as_of,
        method=method,
        ultimate_by_origin=result["ultimate_by_origin"],
        ibnr=result["total_ibnr"],
        mack_sd=mack_sd,
        assumption_set_id=assumption_set_id,
        status="computed",
        data_source=source,
        triangle=triangle_dict,
    )


def _build_triangle(rows: list[dict[str, Any]]):
    """Route Drizzle rows through claims_to_incremental_long; legacy cells
    through the platform's dict construction. Returns (cl.Triangle, dict)."""
    if rows and "incidentDate" in rows[0]:
        tri = cumulative_triangle_from_claims(rows)
        frame = tri.to_frame(origin_as_datetime=False)
        triangle_dict = {
            str(idx.year): [round(float(v), 2) for v in vals if not pd.isna(v)]
            for idx, vals in frame.iterrows()
        }
        return tri, triangle_dict
    triangle_dict = legacy_cells_to_triangle_dict(rows)
    from ..reserving.methods import triangle_dict_to_chainladder

    return triangle_dict_to_chainladder(triangle_dict), triangle_dict
