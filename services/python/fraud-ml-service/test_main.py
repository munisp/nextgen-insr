"""Unit tests for fraud-ml-service: real heuristic + real IsolationForest paths.

Runs without fastapi installed (imports main directly; fastapi/pydantic are
required — install requirements.txt first). Anomaly tests are skipped when
scikit-learn is unavailable.
"""

import unittest

import main


def _req(**kw):
    base = dict(transaction_id="t1", user_id="u1", amount=1000.0,
                session_age_seconds=3600, kyc_level=2)
    base.update(kw)
    return main.ScoreRequest(**base)


class TestHeuristicScoring(unittest.TestCase):
    def setUp(self):
        main._model = None
        main._observed.clear()
        main._recent_by_user.clear()
        main._amount_stats_by_user.clear()

    def test_low_risk_transaction_allows(self):
        r = main.score(_req())
        self.assertEqual(r["decision"], "allow")
        self.assertLess(r["fraud_score"], 0.3)
        self.assertEqual(r["component_scores"]["anomaly"], None)
        self.assertEqual(r["anomaly_status"], "insufficient_data")

    def test_above_kyc_ceiling_flagged(self):
        r = main.score(_req(amount=10_000_000, kyc_level=1))
        self.assertIn(r["risk_level"], ("high", "critical"))
        self.assertTrue(any("ceiling" in f for f in r["risk_factors"]))

    def test_velocity_builds_from_real_history(self):
        for i in range(6):
            r = main.score(_req(user_id="vel-user", timestamp=1_000_000 + i * 1000))
        self.assertGreater(r["component_scores"]["velocity"], 0.0)
        self.assertTrue(any("velocity" in f for f in r["risk_factors"]))

    def test_behavioral_deviation_flagged(self):
        for i in range(6):
            main.score(_req(user_id="beh-user", amount=100.0, timestamp=2_000_000 + i))
        r = main.score(_req(user_id="beh-user", amount=50_000.0, timestamp=2_000_100))
        self.assertGreater(r["component_scores"]["behavior"], 0.0)

    def test_new_session_and_new_recipient_raise_score(self):
        r = main.score(_req(user_id="fresh", session_age_seconds=5,
                            is_new_recipient=True, amount=200_000, kyc_level=3))
        self.assertGreaterEqual(r["fraud_score"], 0.3)


@unittest.skipUnless(main.ANOMALY_DEPS, "scikit-learn not installed")
class TestAnomalyLayer(unittest.TestCase):
    def test_train_then_anomaly_available(self):
        samples = [dict(amount=1000.0 + i * 10, kyc_level=2,
                        session_age_seconds=3600, velocity_1h=1.0)
                   for i in range(40)]
        res = main.train(main.TrainRequest(samples=samples))
        self.assertTrue(res["trained"])
        r = main.score(_req(user_id="anom-user"))
        self.assertIsNotNone(r["component_scores"]["anomaly"])
        self.assertEqual(r["anomaly_status"], "ok")

    def test_train_too_few_samples_fails_loud(self):
        res = main.train(main.TrainRequest(samples=[dict(amount=1.0)]))
        self.assertFalse(res["trained"])

    def test_health_reports_real_model_state(self):
        h = main.health()
        self.assertEqual(h["status"], "ok")
        self.assertIn("trained", h["anomaly_layer"])


if __name__ == "__main__":
    unittest.main()
