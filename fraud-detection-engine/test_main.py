"""Unit tests for Fraud Detection Engine."""
import unittest
import json
from unittest.mock import patch
from io import BytesIO
from http.server import HTTPServer
import threading
import urllib.request

# Import the module
import main as fraud_engine


class TestFraudScoring(unittest.TestCase):
    """Test fraud score calculation logic."""

    def test_low_risk_transaction(self):
        """Normal transaction should have low fraud score."""
        tx = {"id": "TX-001", "amount": 50000, "recent_transaction_count": 5}
        result = fraud_engine.calculate_fraud_score(tx)
        self.assertLess(result["fraud_score"], 0.3)
        self.assertEqual(result["decision"], "allow")
        self.assertEqual(result["transaction_id"], "TX-001")

    def test_high_amount_triggers_anomaly(self):
        """Amount > ₦500K should trigger amount_anomaly rule."""
        tx = {"id": "TX-002", "amount": 2000000}
        result = fraud_engine.calculate_fraud_score(tx)
        self.assertIn("amount_anomaly", result["triggered_rules"])
        self.assertGreater(result["fraud_score"], 0)

    def test_velocity_exceeded(self):
        """More than 20 recent transactions should trigger velocity check."""
        tx = {"id": "TX-003", "amount": 10000, "recent_transaction_count": 30}
        result = fraud_engine.calculate_fraud_score(tx)
        self.assertIn("velocity_exceeded", result["triggered_rules"])

    def test_new_device_flagged(self):
        """New device should add risk."""
        tx = {"id": "TX-004", "amount": 10000, "is_new_device": True}
        result = fraud_engine.calculate_fraud_score(tx)
        self.assertIn("new_device", result["triggered_rules"])

    def test_block_decision(self):
        """Very high risk transaction should be blocked or reviewed."""
        tx = {"id": "TX-005", "amount": 4500000, "recent_transaction_count": 45, "is_new_device": True}
        result = fraud_engine.calculate_fraud_score(tx)
        self.assertIn(result["decision"], ["block", "review"])
        self.assertGreater(result["fraud_score"], 0.5)

    def test_medium_amount_flags(self):
        """₦3M amount should trigger amount_anomaly and produce non-zero score."""
        tx = {"id": "TX-006", "amount": 3000000}
        result = fraud_engine.calculate_fraud_score(tx)
        self.assertIn("amount_anomaly", result["triggered_rules"])
        self.assertGreater(result["fraud_score"], 0)

    def test_score_capped_at_one(self):
        """Fraud score should never exceed 1.0."""
        tx = {"id": "TX-007", "amount": 10000000, "recent_transaction_count": 100, "is_new_device": True}
        result = fraud_engine.calculate_fraud_score(tx)
        self.assertLessEqual(result["fraud_score"], 1.0)

    def test_model_version_present(self):
        """Result should include model version."""
        tx = {"id": "TX-008", "amount": 1000}
        result = fraud_engine.calculate_fraud_score(tx)
        self.assertEqual(result["model_version"], "v2.3.1")

    def test_confidence_inversely_related(self):
        """Higher fraud score should have lower confidence."""
        low_risk = fraud_engine.calculate_fraud_score({"amount": 1000})
        high_risk = fraud_engine.calculate_fraud_score({"amount": 5000000, "recent_transaction_count": 50, "is_new_device": True})
        self.assertGreater(low_risk["confidence"], high_risk["confidence"])

    def test_empty_transaction(self):
        """Empty transaction should not crash."""
        result = fraud_engine.calculate_fraud_score({})
        self.assertEqual(result["decision"], "allow")
        self.assertEqual(result["fraud_score"], 0)


class TestFraudRules(unittest.TestCase):
    """Test rule configuration."""

    def test_rules_count(self):
        self.assertEqual(len(fraud_engine.RULES), 5)

    def test_weights_sum_to_one(self):
        total = sum(r.weight for r in fraud_engine.RULES)
        self.assertAlmostEqual(total, 1.0, places=2)

    def test_all_rules_have_thresholds(self):
        for rule in fraud_engine.RULES:
            self.assertGreater(rule.threshold, 0)
            self.assertGreater(rule.weight, 0)
            self.assertTrue(len(rule.name) > 0)


if __name__ == "__main__":
    unittest.main()
