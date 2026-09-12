import unittest

import main


class TestSLARules(unittest.TestCase):
    def setUp(self):
        main._violations.clear()
        main._alert_log.clear()

    def test_critical_error_rate_violation(self):
        res = main.check_all_rules({"billing_error_rate": 0.10})
        sev = {v["severity"] for v in res["violations"]}
        self.assertIn("critical", sev)
        self.assertIn("warning", sev)

    def test_healthy_metrics_no_violations(self):
        res = main.check_all_rules({
            "billing_error_rate": 0.001,
            "payout_latency_hours": 2.0,
            "reconciliation_lag_hours": 1.0,
            "billing_uptime_ratio": 0.999,
        })
        self.assertEqual(res["violations"], [])
        self.assertEqual(res["unmeasured_metrics"], [])

    def test_unmeasured_metrics_reported(self):
        res = main.check_all_rules({"billing_error_rate": 0.001})
        self.assertIn("payout_latency_hours", res["unmeasured_metrics"])

    def test_trigger_alert_reports_unconfigured_channels(self):
        v = main.SLAViolation(rule="r", metric="m", measured=1.0,
                              threshold=0.5, severity="critical")
        outcomes = main._trigger_alert(v, ["pagerduty", "slack", "email"])
        self.assertEqual(len(outcomes), 3)
        self.assertTrue(all(not o["sent"] for o in outcomes))
        self.assertTrue(all("no endpoint" in o["reason"] for o in outcomes))

    def test_rule_breach_operators(self):
        gt = main.SLARule("a", "m", "gt", 5.0, "warning")
        lt = main.SLARule("b", "m", "lt", 5.0, "warning")
        self.assertTrue(gt.breached(6.0))
        self.assertFalse(gt.breached(5.0))
        self.assertTrue(lt.breached(4.0))


if __name__ == "__main__":
    unittest.main()
