"""Analytic aggregate-loss distributions (adopted ``aggregate`` v2.1.0, BSD-3)."""

from .adapter import (
    AGGREGATE_VERSION,
    AggregateLossDist,
    AnalyticRiskMeasures,
    GridSpec,
    build_aggregate_loss,
    distortion,
    kernel_mc_crosscheck_case,
)

__all__ = [
    "AGGREGATE_VERSION",
    "AggregateLossDist",
    "AnalyticRiskMeasures",
    "GridSpec",
    "build_aggregate_loss",
    "distortion",
    "kernel_mc_crosscheck_case",
]
