"""PAY-9: Mojaloop idempotency keys must bind entity + amount + currency."""
import unittest

from infra_sdk.mojaloop_client import payment_scoped_key


class TestPaymentScopedKey(unittest.TestCase):
    def test_same_payment_same_key(self):
        k1 = payment_scoped_key("prem", "POL-1", "5000.00", "NGN")
        k2 = payment_scoped_key("prem", "POL-1", "5000.00", "NGN")
        self.assertEqual(k1, k2)
        self.assertTrue(k1.startswith("prem-POL-1-"))

    def test_different_amount_different_key(self):
        # The audit finding: prem-{policyId} was reused across amounts.
        k1 = payment_scoped_key("prem", "POL-1", "5000.00", "NGN")
        k2 = payment_scoped_key("prem", "POL-1", "7500.00", "NGN")
        self.assertNotEqual(k1, k2)

    def test_different_currency_different_key(self):
        k1 = payment_scoped_key("prem", "POL-1", "5000.00", "NGN")
        k2 = payment_scoped_key("prem", "POL-1", "5000.00", "USD")
        self.assertNotEqual(k1, k2)

    def test_attempt_nonce_allows_legitimate_second_payment(self):
        k1 = payment_scoped_key("payout", "CLM-9", "10000.00", "NGN")
        k2 = payment_scoped_key("payout", "CLM-9", "10000.00", "NGN", attempt_nonce="installment-2")
        self.assertNotEqual(k1, k2)

    def test_no_longer_bare_entity_key(self):
        # Regression: keys must never collapse to the old bare form.
        k = payment_scoped_key("prem", "POL-1", "5000.00", "NGN")
        self.assertNotEqual(k, "prem-POL-1")


if __name__ == "__main__":
    unittest.main()
