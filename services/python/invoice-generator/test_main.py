import unittest

import main


class TestInvoiceGenerator(unittest.TestCase):
    def test_revenue_share_math(self):
        inv = main.service.generate_revenue_share_invoice(main.RevenueShareRequest(
            tenant_id="t1", customer_id="c1", period="2026-07",
            gross_transaction_volume=1_000_000.0, transaction_count=250,
            platform_share_ratio=0.025))
        self.assertEqual(inv["subtotal"], 25_000.0)
        self.assertEqual(inv["metadata"]["partner_settlement_amount"], 975_000.0)
        self.assertEqual(inv["total"], round(25_000.0 * (1 + main.VAT_RATE), 2))

    def test_subscription_proration(self):
        inv = main.service.generate_subscription_invoice(main.SubscriptionRequest(
            tenant_id="t1", customer_id="c1", plan_name="Growth",
            plan_price=30_000.0, billing_days=30, active_days=15))
        self.assertEqual(inv["subtotal"], 15_000.0)

    def test_subscription_full_period(self):
        inv = main.service.generate_subscription_invoice(main.SubscriptionRequest(
            tenant_id="t1", customer_id="c1", plan_name="Growth", plan_price=30_000.0))
        self.assertEqual(inv["subtotal"], 30_000.0)

    def test_publish_event_fails_loud_without_broker(self):
        d = main._publish_event("billing.invoice.generated", {"invoice_id": "x"})
        self.assertFalse(d["published"])
        self.assertIn("error", d)

    def test_health(self):
        self.assertEqual(main.health()["status"], "ok")


if __name__ == "__main__":
    unittest.main()
