import hashlib
import hmac
import json
import unittest

import main


class TestSigning(unittest.TestCase):
    def test_sign_payload_is_real_hmac(self):
        body = json.dumps({"a": 1}).encode()
        expected = hmac.new(b"sekret", body, hashlib.sha256).hexdigest()
        self.assertEqual(main._sign_payload(body, "sekret"), expected)

    def test_sign_payload_differs_per_secret(self):
        body = b"{}"
        self.assertNotEqual(main._sign_payload(body, "a"), main._sign_payload(body, "b"))


class TestRetryLogic(unittest.TestCase):
    def test_exponential_backoff_bounds(self):
        for attempt in range(5):
            nxt = main._calculate_next_retry(attempt)
            delay = nxt - __import__("time").time()
            self.assertGreaterEqual(delay, 0)
            self.assertLessEqual(delay, main.BASE_BACKOFF_SECONDS * (2 ** attempt) + 1)

    def test_dead_letter_after_max_attempts(self):
        main._subscribers.clear()
        main.dead_letter_queue.clear()
        main._delivery_log.clear()
        main._subscribers["s1"] = {"url": "http://127.0.0.1:9/unreachable", "events": ["billing.*"]}
        main._delivery_log.append({"subscriber_id": "s1", "event_type": "billing.x",
                                   "attempt": main.MAX_ATTEMPTS, "delivered": False})
        res = main.retry(0)
        self.assertTrue(res["dead_lettered"])
        self.assertEqual(len(main.dead_letter_queue), 1)


class TestMatching(unittest.TestCase):
    def test_event_pattern_matching(self):
        self.assertTrue(main._matches(["billing.*"], "billing.invoice.generated"))
        self.assertFalse(main._matches(["kyc.*"], "billing.invoice.generated"))


if __name__ == "__main__":
    unittest.main()
