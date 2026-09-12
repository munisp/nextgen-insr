"""
Invoice Generator Service (port 8319) — revenue_share and subscription
invoice generation for the billing platform.

Real behavior:
- generate_revenue_share_invoice: computes platform/agent fee splits from
  the caller-supplied REAL transaction aggregates and an explicit split
  ratio — no amounts are invented.
- generate_subscription_invoice: prorated subscription billing from a real
  plan price and billing period.
- Every generated invoice is published to Kafka topic
  `billing.invoice.generated` via _publish_event when a broker is reachable;
  when Kafka is down the invoice is still returned but the response
  honestly reports `published: false` with the broker error — publication
  failure is never silently swallowed.
"""

import json
import logging
import os
import time
import uuid
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("invoice-generator")

PORT = int(os.getenv("PORT", "8319"))
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
INVOICE_TOPIC = "billing.invoice.generated"
VAT_RATE = float(os.getenv("VAT_RATE", "0.075"))  # Nigeria VAT

app = FastAPI(title="Invoice Generator Service", version="1.0.0")


def _kafka_producer():
    from kafka import KafkaProducer

    return KafkaProducer(
        bootstrap_servers=KAFKA_BROKERS.split(","),
        value_serializer=lambda v: json.dumps(v).encode(),
        request_timeout_ms=3000,
        api_version_auto_timeout_ms=3000,
    )


def _publish_event(event_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Publish to Kafka; returns an honest delivery report."""
    event = {
        "event_id": uuid.uuid4().hex,
        "event_type": event_type,
        "emitted_at": time.time(),
        "payload": payload,
    }
    try:
        producer = _kafka_producer()
        fut = producer.send(INVOICE_TOPIC, event)
        meta = fut.get(timeout=5)
        producer.close()
        return {"published": True, "topic": INVOICE_TOPIC,
                "partition": meta.partition, "offset": meta.offset}
    except Exception as exc:
        logger.error("kafka publish failed: %s", exc)
        return {"published": False, "topic": INVOICE_TOPIC, "error": str(exc)}


class LineItem(BaseModel):
    description: str
    quantity: float = 1.0
    unit_price: float
    total: float = 0.0


def _invoice(number_prefix: str, tenant_id: str, customer_id: str,
             line_items: List[LineItem], currency: str,
             metadata: Dict[str, Any]) -> Dict[str, Any]:
    for li in line_items:
        li.total = round(li.quantity * li.unit_price, 2)
    subtotal = round(sum(li.total for li in line_items), 2)
    vat = round(subtotal * VAT_RATE, 2)
    return {
        "invoice_id": f"inv_{uuid.uuid4().hex[:16]}",
        "invoice_number": f"{number_prefix}-{int(time.time())}",
        "tenant_id": tenant_id,
        "customer_id": customer_id,
        "currency": currency,
        "line_items": [li.model_dump() for li in line_items],
        "subtotal": subtotal,
        "vat_rate": VAT_RATE,
        "vat": vat,
        "total": round(subtotal + vat, 2),
        "status": "issued",
        "issued_at": time.time(),
        "metadata": metadata,
    }


class RevenueShareRequest(BaseModel):
    tenant_id: str
    customer_id: str
    currency: str = "NGN"
    period: str
    gross_transaction_volume: float = Field(..., description="Real aggregate volume for the period")
    transaction_count: int = 0
    platform_share_ratio: float = Field(..., gt=0, lt=1)
    partner_name: str = "platform"


class SubscriptionRequest(BaseModel):
    tenant_id: str
    customer_id: str
    currency: str = "NGN"
    plan_name: str
    plan_price: float = Field(..., ge=0)
    billing_days: int = 30
    active_days: Optional[int] = None  # set for proration


class InvoiceGeneratorService:
    """Stateless generator: all amounts derive from caller-supplied real
    aggregates and plan prices."""

    def generate_revenue_share_invoice(self, req: RevenueShareRequest) -> Dict[str, Any]:
        platform_fee = round(req.gross_transaction_volume * req.platform_share_ratio, 2)
        partner_fee = round(req.gross_transaction_volume - platform_fee, 2)
        items = [
            LineItem(description=f"Revenue share — {req.partner_name} platform fee ({req.period})",
                     quantity=1, unit_price=platform_fee),
        ]
        invoice = _invoice("RS", req.tenant_id, req.customer_id, items,
                           req.currency, {
                               "model": "revenue_share",
                               "period": req.period,
                               "gross_transaction_volume": req.gross_transaction_volume,
                               "transaction_count": req.transaction_count,
                               "platform_share_ratio": req.platform_share_ratio,
                               "partner_settlement_amount": partner_fee,
                           })
        return invoice

    def generate_subscription_invoice(self, req: SubscriptionRequest) -> Dict[str, Any]:
        if req.active_days is not None:
            if req.active_days < 0 or req.active_days > req.billing_days:
                raise HTTPException(status_code=400, detail="active_days outside billing period")
            price = round(req.plan_price * req.active_days / req.billing_days, 2)
            desc = f"Subscription — {req.plan_name} (prorated {req.active_days}/{req.billing_days} days)"
        else:
            price = req.plan_price
            desc = f"Subscription — {req.plan_name} ({req.billing_days} days)"
        invoice = _invoice("SUB", req.tenant_id, req.customer_id,
                           [LineItem(description=desc, quantity=1, unit_price=price)],
                           req.currency, {
                               "model": "subscription",
                               "plan_name": req.plan_name,
                               "billing_days": req.billing_days,
                               "active_days": req.active_days,
                           })
        return invoice


service = InvoiceGeneratorService()


@app.post("/invoices/revenue-share")
def revenue_share(req: RevenueShareRequest):
    invoice = service.generate_revenue_share_invoice(req)
    delivery = _publish_event("billing.invoice.generated", invoice)
    return {"invoice": invoice, "event": "billing.invoice.generated", "delivery": delivery}


@app.post("/invoices/subscription")
def subscription(req: SubscriptionRequest):
    invoice = service.generate_subscription_invoice(req)
    delivery = _publish_event("billing.invoice.generated", invoice)
    return {"invoice": invoice, "event": "billing.invoice.generated", "delivery": delivery}


@app.get("/health")
def health():
    return {"status": "ok", "service": "invoice-generator",
            "kafka_brokers": KAFKA_BROKERS, "invoice_topic": INVOICE_TOPIC,
            "vat_rate": VAT_RATE}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
