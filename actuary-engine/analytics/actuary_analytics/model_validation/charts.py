"""Model-validation charts for pricing models (F1 gap 3, capability map §5).

Double-lift chart (method reference: casact/double_lift, MPL-2.0 — single
function; equivalent implemented here, no code vendored): order policies by
the ratio of two models' predictions, bucket into equal-exposure groups,
and compare actual vs both predictions per group. Lift chart: per-group
actual/predicted ratio ordered by prediction. Gini/concentration curve:
Lorenz curve of actuals ordered by prediction, with the standard Gini
coefficient and a perfect-model-normalized variant.

Pure dataframe API plus optional matplotlib rendering (matplotlib is
imported lazily so headless batch runs pay no plotting cost).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


def _as_weight(weight, n: int) -> np.ndarray:
    if weight is None:
        return np.ones(n, dtype=float)
    w = np.asarray(weight, dtype=float)
    if w.shape != (n,):
        raise ValueError(f"weight must have length {n}, got {w.shape}")
    if np.any(w < 0):
        raise ValueError("weights must be non-negative")
    return w


def _weighted_groups(sort_key: np.ndarray, weight: np.ndarray, n_groups: int) -> np.ndarray:
    """Sort ascending by ``sort_key`` (stable) and bucket the cumulative
    weight into ``n_groups`` equal-total-weight groups. Returns the integer
    group label (0..n_groups-1) per row in ORIGINAL order."""
    n = len(sort_key)
    order = np.argsort(sort_key, kind="mergesort")
    cumw = np.cumsum(weight[order])
    total = cumw[-1] if len(cumw) else 0.0
    if total <= 0:
        raise ValueError("total weight must be positive")
    # group g owns cumulative weights in (g/n, (g+1)/n] * total; ties at
    # exact boundaries resolve deterministically to the lower group.
    edges = np.arange(1, n_groups) * (total / n_groups)
    labels_sorted = np.minimum(np.searchsorted(edges, cumw, side="left"), n_groups - 1)
    labels = np.empty(n, dtype=int)
    labels[order] = labels_sorted
    return labels


def double_lift(
    actual,
    pred_a,
    pred_b,
    weight=None,
    n_groups: int = 10,
    rescale: bool = False,
) -> pd.DataFrame:
    """Double-lift chart data (dataframe-first; render via render_double_lift).

    Ordering key: pred_a / pred_b ascending (the ratio ordering). Buckets are
    equal-total-weight groups; per bucket the WEIGHTED means of actual,
    pred_a and pred_b. With ``rescale=True`` the model columns are divided
    by the actual column (actual becomes 1) — the "ratio" display form of
    the reference method.
    """
    a = np.asarray(actual, dtype=float)
    pa = np.asarray(pred_a, dtype=float)
    pb = np.asarray(pred_b, dtype=float)
    if not (len(a) == len(pa) == len(pb)):
        raise ValueError("actual, pred_a, pred_b must have equal length")
    w = _as_weight(weight, len(a))
    with np.errstate(divide="ignore", invalid="ignore"):
        ratio = np.where(pb != 0, pa / np.where(pb != 0, pb, 1.0), np.inf)
    labels = _weighted_groups(ratio, w, n_groups)

    rows = []
    for g in range(n_groups):
        mask = labels == g
        wg = w[mask]
        wsum = wg.sum()
        row = {
            "group": g + 1,
            "weight": float(wsum),
            "actual": float((wg * a[mask]).sum() / wsum),
            "pred_a": float((wg * pa[mask]).sum() / wsum),
            "pred_b": float((wg * pb[mask]).sum() / wsum),
        }
        rows.append(row)
    df = pd.DataFrame(rows)
    if rescale:
        df["pred_a"] = df["pred_a"] / df["actual"]
        df["pred_b"] = df["pred_b"] / df["actual"]
        df["actual"] = 1.0
    return df


def lift_chart(
    actual,
    pred,
    weight=None,
    n_groups: int = 10,
) -> pd.DataFrame:
    """Lift chart data: equal-weight buckets ordered by prediction ascending;
    per bucket weighted mean actual, weighted mean predicted, and
    lift = actual / predicted. Cumulative lift carries the running ratio."""
    a = np.asarray(actual, dtype=float)
    p = np.asarray(pred, dtype=float)
    if len(a) != len(p):
        raise ValueError("actual and pred must have equal length")
    w = _as_weight(weight, len(a))
    labels = _weighted_groups(p, w, n_groups)

    rows = []
    cum_a = 0.0
    cum_p = 0.0
    for g in range(n_groups):
        mask = labels == g
        wg = w[mask]
        wsum = wg.sum()
        mean_a = float((wg * a[mask]).sum() / wsum)
        mean_p = float((wg * p[mask]).sum() / wsum)
        cum_a += mean_a * wsum
        cum_p += mean_p * wsum
        rows.append({
            "group": g + 1,
            "weight": float(wsum),
            "actual": mean_a,
            "predicted": mean_p,
            "lift": float(mean_a / mean_p) if mean_p != 0 else float("nan"),
            "cumulative_lift": float(cum_a / cum_p) if cum_p != 0 else float("nan"),
        })
    return pd.DataFrame(rows)


def concentration_curve(actual, pred, weight=None) -> pd.DataFrame:
    """Lorenz/concentration curve ordered by ``pred`` ascending.

    Columns: exposure_share (cumulative weight share), actual_share
    (cumulative actual share), predicted_share (cumulative predicted
    share), diagonal (the no-discrimination reference = exposure_share).
    """
    a = np.asarray(actual, dtype=float)
    p = np.asarray(pred, dtype=float)
    if len(a) != len(p):
        raise ValueError("actual and pred must have equal length")
    w = _as_weight(weight, len(a))
    order = np.argsort(p, kind="mergesort")
    w_o = w[order]
    cumw = np.cumsum(w_o)
    total_w = cumw[-1] if len(cumw) else 0.0
    if total_w <= 0:
        raise ValueError("total weight must be positive")
    total_a = float((w * a).sum())
    total_p = float((w * p).sum())
    if total_a == 0:
        raise ValueError("total actual must be non-zero")
    x = cumw / total_w
    y_a = np.cumsum(w_o * a[order]) / total_a
    y_p = np.cumsum(w_o * p[order]) / total_p if total_p != 0 else np.full_like(x, np.nan)
    return pd.DataFrame({
        "exposure_share": np.concatenate(([0.0], x)),
        "actual_share": np.concatenate(([0.0], y_a)),
        "predicted_share": np.concatenate(([0.0], y_p)),
        "diagonal": np.concatenate(([0.0], x)),
    })


def gini(actual, pred, weight=None) -> float:
    """Gini coefficient of the concentration curve (1 - 2 * Lorenz area).

    Ordering by ``pred`` ascending. Exact formula on the weighted grid:
    A = Σ ΔF · (L_i + L_{i-1}) / 2. A zero-actual dataset returns 0.0
    (package convention, matching freqsev/artefact.py._gini).
    """
    a = np.asarray(actual, dtype=float)
    p = np.asarray(pred, dtype=float)
    if len(a) != len(p):
        raise ValueError("actual and pred must have equal length")
    w = _as_weight(weight, len(a))
    total_a = float((w * a).sum())
    if total_a == 0:
        return 0.0
    order = np.argsort(p, kind="mergesort")
    w_o = w[order]
    total_w = w_o.sum()
    if total_w <= 0:
        return 0.0
    cumw = np.concatenate(([0.0], np.cumsum(w_o))) / total_w
    lorenz = np.concatenate(([0.0], np.cumsum(w_o * a[order]))) / total_a
    df = np.diff(cumw)
    area = float(np.sum(df * (lorenz[1:] + lorenz[:-1]) / 2.0))
    return 1.0 - 2.0 * area


def gini_normalized(actual, pred, weight=None) -> float:
    """Gini normalized against the perfect model (order by actual).

    Perfect model → 1.0; no-discrimination (constant/random order) → ~0.0.
    Defined as gini(actual, pred) / gini(actual, actual); returns 0.0 when
    the perfect-model Gini is 0 (all actuals equal — no discrimination
    achievable).
    """
    perfect = gini(actual, actual, weight)
    if perfect == 0.0:
        return 0.0
    return gini(actual, pred, weight) / perfect


# ---------------------------------------------------------------------------
# Optional matplotlib rendering (lazy import; headless-safe).
# ---------------------------------------------------------------------------


def _mpl():
    try:
        import matplotlib

        matplotlib.use("Agg", force=False)  # headless-safe default
        import matplotlib.pyplot as plt
    except ImportError as exc:  # pragma: no cover - matplotlib pinned in env
        raise ImportError(
            "matplotlib is required for chart rendering (installed via the "
            "aggregate dependency); compute-only paths do not need it"
        ) from exc
    return plt


def render_double_lift(df: pd.DataFrame, title: str = "Double Lift Chart"):
    """Point chart of actual vs both model predictions per group."""
    plt = _mpl()
    fig, ax = plt.subplots(figsize=(6, 4))
    for col, marker in (("actual", "o"), ("pred_a", "s"), ("pred_b", "^")):
        ax.plot(df["group"], df[col], marker=marker, label=col)
    ax.set_xlabel("group (ratio ordering)")
    ax.set_title(title)
    ax.legend()
    return fig


def render_lift(df: pd.DataFrame, title: str = "Lift Chart"):
    plt = _mpl()
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.plot(df["group"], df["lift"], marker="o", label="lift")
    ax.axhline(1.0, color="gray", linestyle="--")
    ax.set_xlabel("group (prediction ordering)")
    ax.set_title(title)
    ax.legend()
    return fig


def render_concentration(df: pd.DataFrame, title: str = "Concentration Curve"):
    plt = _mpl()
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.plot(df["exposure_share"], df["actual_share"], label="actual")
    ax.plot(df["exposure_share"], df["diagonal"], linestyle="--", color="gray",
            label="diagonal")
    ax.set_title(title)
    ax.legend()
    return fig
