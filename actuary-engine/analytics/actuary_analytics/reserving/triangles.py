"""Loss-triangle construction from claims rows.

Two input shapes are supported (see data_source docs):
  * Drizzle ``claims`` rows (camelCase, design §2.7) — origin = incidentDate
    accident year, development lag from settlementDate (paid amounts).
  * Legacy actuarial-platform cells — accident_year / development_period /
    amount (incremental) or cumulative rows.

Both produce a real chainladder Triangle; nothing is hand-computed here.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import date, datetime
from typing import Any

import chainladder as cl
import pandas as pd

from .data_source import DataSourceUnavailableError


def _coerce_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return pd.to_datetime(str(value)).date()
    except Exception:  # noqa: BLE001 - unparseable dates are skipped, never guessed
        return None


def claims_to_incremental_long(
    rows: Iterable[Mapping[str, Any]],
    *,
    amount_col: str = "paidAmount",
    origin_col: str = "incidentDate",
    dev_col: str = "settlementDate",
) -> pd.DataFrame:
    """Convert Drizzle-shaped claim rows to an incremental long dataframe
    with columns origin / dev / value, dated for annual development periods.

    Claims without a usable origin/dev date are skipped (e.g. open claims
    without settlementDate on the paid triangle) — never guessed.
    """
    out: list[dict[str, Any]] = []
    for row in rows:
        origin = _coerce_date(row.get(origin_col))
        dev = _coerce_date(row.get(dev_col))
        amount = row.get(amount_col)
        if origin is None or dev is None or amount is None:
            continue
        try:
            amount_f = float(amount)
        except (TypeError, ValueError):
            continue
        out.append(
            {
                "origin": pd.Timestamp(date(origin.year, 1, 1)),
                "dev": pd.Timestamp(date(dev.year, 12, 31)),
                "value": amount_f,
            }
        )
    if not out:
        return pd.DataFrame(columns=["origin", "dev", "value"])
    df = pd.DataFrame(out)
    return (
        df.groupby(["origin", "dev"], as_index=False)["value"].sum().sort_values(["origin", "dev"])
    )


def cumulative_triangle_from_claims(
    rows: Iterable[Mapping[str, Any]],
    *,
    amount_col: str = "paidAmount",
    origin_col: str = "incidentDate",
    dev_col: str = "settlementDate",
    what: str = "loss triangle",
) -> cl.Triangle:
    """Build a cumulative chainladder Triangle from Drizzle claim rows.

    Raises DataSourceUnavailableError (503 posture) when fewer than two
    origin periods have usable data — a one-year triangle cannot be
    developed.
    """
    long_df = claims_to_incremental_long(
        rows, amount_col=amount_col, origin_col=origin_col, dev_col=dev_col
    )
    if long_df.empty:
        raise DataSourceUnavailableError(what)
    incr = cl.Triangle(  # type: ignore[abstract]  # chainladder stubs mark Triangle abstract; runtime constructor is real
        long_df,
        origin="origin",
        development="dev",
        columns="value",
        cumulative=False,
    ).incr_to_cum()
    origins = incr.origin.unique()
    if len(origins) < 2:
        raise DataSourceUnavailableError(f"{what} (fewer than 2 accident years of claims data)")
    return incr


def legacy_cells_to_triangle_dict(rows: Iterable[Mapping[str, Any]]) -> dict[str, list[float]]:
    """Reproduce the absorbed actuarial-platform cumulative-triangle dict.

    Input rows: accident_year, development_period, amount (incremental) or
    cumulative. Output: {year_label: [cum_dev0, cum_dev1, ...]} with each
    row truncated at its last observed development period.
    """
    cells: dict[tuple, float] = {}
    cumulative_flags: dict[str, bool] = {}
    for r in rows:
        year = str(r.get("accident_year", r.get("year")))
        dev = int(r["development_period"])
        if "cumulative" in r:
            cells[(year, dev)] = float(r["cumulative"])
            cumulative_flags[year] = True
        else:
            key = (year, dev)
            cells[key] = cells.get(key, 0.0) + float(r.get("amount", r.get("paid_amount", 0.0)))
    if not cells:
        raise DataSourceUnavailableError("loss triangle")
    years = sorted({k[0] for k in cells})
    max_dev = max(k[1] for k in cells)
    triangle: dict[str, list[float]] = {}
    for year in years:
        running = 0.0
        cumulative: list[float] = []
        for dev in range(max_dev + 1):
            key = (year, dev)
            if key not in cells:
                break
            running = cells[key] if cumulative_flags.get(year, False) else running + cells[key]
            cumulative.append(round(running, 2))
        if cumulative:
            triangle[year] = cumulative
    if len(triangle) < 2:
        raise DataSourceUnavailableError(
            "loss triangle (fewer than 2 accident years of claims data)"
        )
    return triangle


def cumulative_triangle_dict(rows: Iterable[Mapping[str, Any]]) -> dict[str, list[float]]:
    """Cumulative triangle dict from whichever claim shape is present.

    Drizzle rows are routed through claims_to_incremental_long; legacy cells
    keep the absorbed platform semantics.
    """
    rows = list(rows)
    if rows and "incidentDate" in rows[0]:
        long_df = claims_to_incremental_long(rows)
        if long_df.empty:
            raise DataSourceUnavailableError("loss triangle")
        incr = cl.Triangle(  # type: ignore[abstract]  # chainladder stubs mark Triangle abstract; runtime constructor is real
            long_df, origin="origin", development="dev", columns="value", cumulative=False
        ).incr_to_cum()
        frame = incr.to_frame(origin_as_datetime=False)
        return {str(idx.year): [round(float(v), 2) for v in vals if not pd.isna(v)]
                for idx, vals in frame.iterrows()}
    return legacy_cells_to_triangle_dict(rows)
