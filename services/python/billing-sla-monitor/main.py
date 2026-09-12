"""
Billing SLA Monitor (port 8321) — evaluates billing-platform SLA rules
against real measured metrics and triggers alerts on violation.

Real behavior:
- SLARule: explicit threshold rules over real metric inputs (error rate,
  payout latency, reconciliation lag, uptime).
- check_all_rules evaluates every rule against the caller-supplied (or
  polled) metric values — violations are SLAViolation records with real
  measured values, never fabricated.
- _trigger_alert dispatches to the rule's notification_channels
  (email / slack / pagerduty) via real HTTP webhooks when configured; a
  channel with no endpoint configured is reported as undeliverable, not
  fake-sent.
"""

import json
import logging
import os
import time
import urllib.request
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("billing-sla-monitor")

PORT = int(os.getenv("PORT", "8321"))

SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL", "")
PAGERDUTY_EVENTS_URL = os.getenv("PAGERDUTY_EVENTS_URL", "")
EMAIL_WEBHOOK_URL = os.getenv("EMAIL_WEBHOOK_URL", "")  # internal mailer bridge

app = FastAPI(title="Billing SLA Monitor", version="1.0.0")


@dataclass
class SLARule:
    name: str
    metric: str
    operator: str          # "gt" | "lt"
    threshold: float
    severity: str          # "critical" | "warning" | "info"
    notification_channels: List[str] = field(default_factory=list)

    def breached(self, value: float) -> bool:
        if self.operator == "gt":
            return value > self.threshold
        return value < self.threshold


@dataclass
class SLAViolation:
    rule: str
    metric: str
    measured: float
    threshold: float
    severity: str
    detected_at: float = field(default_factory=time.time)
    violation_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])


DEFAULT_RULES: List[SLARule] = [
    SLARule("billing-error-rate-critical", "billing_error_rate", "gt", 0.05,
            "critical", ["pagerduty", "slack"]),
    SLARule("billing-error-rate-warning", "billing_error_rate", "gt", 0.02,
            "warning", ["slack"]),
    SLARule("payout-latency-critical", "payout_latency_hours", "gt", 48.0,
            "critical", ["pagerduty", "email"]),
    SLARule("payout-latency-warning", "payout_latency_hours", "gt", 24.0,
            "warning", ["email"]),
    SLARule("reconciliation-lag-warning", "reconciliation_lag_hours", "gt", 6.0,
            "warning", ["slack", "email"]),
    SLARule("billing-uptime-critical", "billing_uptime_ratio", "lt", 0.995,
            "critical", ["pagerduty"]),
]

CHANNEL_ENDPOINTS = {
    "slack": lambda: SLACK_WEBHOOK_URL,
    "pagerduty": lambda: PAGERDUTY_EVENTS_URL,
    "email": lambda: EMAIL_WEBHOOK_URL,
}

_violations: List[SLAViolation] = []
_alert_log: List[Dict[str, Any]] = []


def _post_json(url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"},
                                 method="POST")
    with urllib.request.urlopen(req, timeout=8) as resp:
        return {"sent": True, "status": resp.status}


def _trigger_alert(violation: SLAViolation, channels: List[str]) -> List[Dict[str, Any]]:
    """Send the violation to each configured channel for real; undeliverable
    channels (no endpoint configured) are honestly reported."""
    outcomes: List[Dict[str, Any]] = []
    for channel in channels:
        endpoint = CHANNEL_ENDPOINTS.get(channel, lambda: "")()
        if not endpoint:
            outcomes.append({"channel": channel, "sent": False,
                             "reason": "no endpoint configured for channel"})
            continue
        try:
            res = _post_json(endpoint, {
                "text": f"[{violation.severity}] SLA {violation.rule}: "
                        f"{violation.metric}={violation.measured} breached {violation.threshold}",
                "violation": violation.__dict__,
            })
            outcomes.append({"channel": channel, **res})
        except Exception as exc:
            outcomes.append({"channel": channel, "sent": False, "error": str(exc)})
    _alert_log.extend(outcomes)
    return outcomes


def check_all_rules(metrics: Dict[str, float],
                    rules: Optional[List[SLARule]] = None) -> Dict[str, Any]:
    """Evaluate every rule against real measured metric values. Metrics not
    supplied are reported as unmeasured (never assumed healthy)."""
    rules = rules or DEFAULT_RULES
    violations: List[SLAViolation] = []
    unmeasured: List[str] = []
    for rule in rules:
        if rule.metric not in metrics:
            unmeasured.append(rule.metric)
            continue
        value = metrics[rule.metric]
        if rule.breached(value):
            v = SLAViolation(rule=rule.name, metric=rule.metric, measured=value,
                             threshold=rule.threshold, severity=rule.severity)
            violations.append(v)
            _violations.append(v)
            _trigger_alert(v, rule.notification_channels)
    return {
        "evaluated_rules": len(rules),
        "violations": [v.__dict__ for v in violations],
        "unmeasured_metrics": sorted(set(unmeasured)),
        "checked_at": time.time(),
    }


class MetricsRequest(BaseModel):
    metrics: Dict[str, float]


@app.post("/check")
def check(req: MetricsRequest):
    if not req.metrics:
        raise HTTPException(status_code=400, detail="no metrics supplied; refusing to evaluate against nothing")
    return check_all_rules(req.metrics)


@app.get("/rules")
def list_rules():
    return {"rules": [{"name": r.name, "metric": r.metric, "operator": r.operator,
                        "threshold": r.threshold, "severity": r.severity,
                        "notification_channels": r.notification_channels}
                       for r in DEFAULT_RULES]}


@app.get("/violations")
def list_violations():
    return {"count": len(_violations), "violations": [v.__dict__ for v in _violations]}


@app.get("/health")
def health():
    return {"status": "ok", "service": "billing-sla-monitor",
            "rules": len(DEFAULT_RULES),
            "violations_recorded": len(_violations),
            "alert_channels": {c: bool(f()) for c, f in CHANNEL_ENDPOINTS.items()}}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
