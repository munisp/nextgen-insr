"""Pricing adequacy ETL (design §4.f).

Computes live loss ratio per product per period = (paid + case reserves +
IBNR share) / earned premium, compares it to the priced LR from the
assumption set, and emits actuary.adequacy.v1 events + persists alerts for
amber (±5 pts) / red (±10 pts) breaches. Credibility factors widen the
bands automatically for thin-data lines.

The event producer is a Kafka boundary — tests use a documented wire
double; production wires the platform's Kafka/Fluvio producer.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

logger = logging.getLogger(__name__)

AMBER_BAND = 0.05
RED_BAND = 0.10


class AdequacyEventProducer(Protocol):
    """Kafka boundary for actuary.adequacy.v1 events."""

    def send(self, topic: str, payload: dict[str, Any]) -> None: ...


@dataclass(frozen=True)
class AdequacyAlert:
    product_line: str
    period: str
    priced_loss_ratio: float
    actual_loss_ratio: float
    severity: str  # amber | red
    deviation: float


@dataclass(frozen=True)
class AdequacyResult:
    alerts: list[AdequacyAlert]
    priced_loss_ratio: float
    actual_loss_ratio: float
    credibility: float
    events_sent: int


def classify_deviation(deviation: float, credibility: float) -> str | None:
    """Amber/red classification; credibility < 1 widens the bands for
    thin-data lines (design §9 'thin data lines' mitigation)."""
    widen = 1.0 / max(credibility, 0.05)
    if abs(deviation) >= RED_BAND * widen:
        return "red"
    if abs(deviation) >= AMBER_BAND * widen:
        return "amber"
    return None


def run_adequacy_etl(
    product_line: str,
    period: str,
    paid_claims: float,
    case_reserves: float,
    ibnr_share: float,
    earned_premium: float,
    priced_loss_ratio: float,
    credibility: float,
    producer: AdequacyEventProducer,
    topic: str = "actuary.adequacy.v1",
    persist_alert: Callable[[AdequacyAlert], None] | None = None,
) -> AdequacyResult:
    """Compute the live loss ratio and emit an adequacy event; alerts persist."""
    if earned_premium <= 0:
        raise ValueError("earned_premium must be positive for a loss ratio")
    if not (0.0 < credibility <= 1.0):
        raise ValueError("credibility must be in (0, 1]")
    incurred = paid_claims + case_reserves + ibnr_share
    actual_lr = incurred / earned_premium
    deviation = actual_lr - priced_loss_ratio
    severity = classify_deviation(deviation, credibility)

    alerts: list[AdequacyAlert] = []
    events = 0
    event = {
        "eventType": "adequacy_observation",
        "productLine": product_line,
        "period": period,
        "pricedLossRatio": priced_loss_ratio,
        "actualLossRatio": round(actual_lr, 6),
        "deviation": round(deviation, 6),
        "credibility": credibility,
        "severity": severity,
    }
    producer.send(topic, event)
    events += 1

    if severity is not None:
        alert = AdequacyAlert(
            product_line=product_line,
            period=period,
            priced_loss_ratio=priced_loss_ratio,
            actual_loss_ratio=round(actual_lr, 6),
            severity=severity,
            deviation=round(deviation, 6),
        )
        alerts.append(alert)
        if persist_alert is not None:
            persist_alert(alert)
        producer.send(
            topic,
            {
                "eventType": "adequacy_alert",
                "productLine": product_line,
                "period": period,
                "severity": severity,
                "pricedLossRatio": priced_loss_ratio,
                "actualLossRatio": alert.actual_loss_ratio,
                "deviation": alert.deviation,
            },
        )
        events += 1

    return AdequacyResult(
        alerts=alerts,
        priced_loss_ratio=priced_loss_ratio,
        actual_loss_ratio=round(actual_lr, 6),
        credibility=credibility,
        events_sent=events,
    )
