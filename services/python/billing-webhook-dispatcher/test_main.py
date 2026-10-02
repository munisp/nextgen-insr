import hashlib
import hmac
import json
import os
import unittest

import main
from store import PostgresStore, StoreUnavailable

# (2026-10-02, C2-a12) store tests run against a REAL PostgreSQL
# (DATABASE_URL); they skip honestly when none is reachable. No mocks.
TEST_DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/billing_webhooks_test")


def _pg_reachable() -> bool:
    try:
        PostgresStore(TEST_DATABASE_URL).init_schema()
        return True
    except StoreUnavailable:
        return False


PG_REACHABLE = _pg_reachable()


def _fresh_store() -> PostgresStore:
    s = PostgresStore(TEST_DATABASE_URL)
    s.init_schema()
    with s._connect() as conn:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE webhook_subscriptions, webhook_deliveries, webhook_dead_letters")
    return s


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


class TestMatching(unittest.TestCase):
    def test_event_pattern_matching(self):
        self.assertTrue(main._matches(["billing.*"], "billing.invoice.generated"))
        self.assertFalse(main._matches(["kyc.*"], "billing.invoice.generated"))


class TestFailClosed(unittest.TestCase):
    """(2026-10-02, C2-a12) registration and DLQ enqueue must error, never
    silently drop, when the store is down. Real unreachable store, no mocks."""

    def test_unreachable_store_raises(self):
        bad = PostgresStore("postgresql://127.0.0.1:1/none")
        with self.assertRaises(StoreUnavailable):
            bad.init_schema()
        with self.assertRaises(StoreUnavailable):
            bad.add_subscriber("s1", "http://x", ["billing.*"])
        with self.assertRaises(StoreUnavailable):
            bad.append_dead_letter({"event_type": "billing.x"}, 0.0, "test")
        with self.assertRaises(StoreUnavailable):
            bad.append_delivery({"subscriber_id": "s1", "event_type": "billing.x",
                                 "attempt": 1, "delivered": False})

    def test_boot_fails_closed(self):
        # lifespan startup must propagate store failure (app refuses to serve).
        from fastapi.testclient import TestClient
        original = main.store
        try:
            main.store = PostgresStore("postgresql://127.0.0.1:1/none")
            with self.assertRaises(StoreUnavailable):
                with TestClient(main.app):
                    pass
        finally:
            main.store = original


@unittest.skipUnless(PG_REACHABLE, "PostgreSQL not reachable at DATABASE_URL")
class TestPostgresStore(unittest.TestCase):
    def setUp(self):
        self.store = _fresh_store()

    def test_subscribers_survive_restart(self):
        # Restart simulation (2026-10-02, C2-a12): a brand-new store instance
        # (new process would behave identically) sees prior registrations.
        self.store.add_subscriber("s1", "http://receiver/hook", ["billing.*"])
        restarted = PostgresStore(TEST_DATABASE_URL)
        subs = restarted.list_subscribers()
        self.assertEqual(subs["s1"], {"url": "http://receiver/hook", "events": ["billing.*"]})

    def test_delivery_log_and_dead_letters_survive_restart(self):
        self.store.add_subscriber("s1", "http://127.0.0.1:9/unreachable", ["billing.*"])
        self.store.append_delivery({"subscriber_id": "s1", "event_type": "billing.x",
                                    "attempt": 1, "delivered": False,
                                    "error": "conn refused", "next_retry_at": 123.0,
                                    "max_attempts": 5})
        self.store.append_dead_letter({"subscriber_id": "s1", "event_type": "billing.x",
                                       "attempt": 5, "delivered": False},
                                      999.0, "max attempts exhausted")
        restarted = PostgresStore(TEST_DATABASE_URL)
        rec = restarted.get_delivery_by_index(0)
        self.assertEqual(rec["event_type"], "billing.x")
        self.assertFalse(rec["delivered"])
        dls = restarted.list_dead_letters()
        self.assertEqual(len(dls), 1)
        self.assertEqual(dls[0]["reason"], "max attempts exhausted")
        self.assertEqual(dls[0]["dead_lettered_at"], 999.0)

    def test_delivery_update_persists_retry_outcome(self):
        self.store.add_subscriber("s1", "http://127.0.0.1:9/unreachable", ["billing.*"])
        self.store.append_delivery({"subscriber_id": "s1", "event_type": "billing.x",
                                    "attempt": 1, "delivered": False})
        rec = PostgresStore(TEST_DATABASE_URL).get_delivery_by_index(0)
        rec["attempt"] = 2
        rec["delivered"] = True
        rec["status"] = 200
        self.store.update_delivery(rec)
        after = PostgresStore(TEST_DATABASE_URL).get_delivery_by_index(0)
        self.assertTrue(after["delivered"])
        self.assertEqual(after["attempt"], 2)

    def test_delivery_log_bounded_retention(self):
        small = PostgresStore(TEST_DATABASE_URL, delivery_log_max_rows=3)
        for i in range(6):
            small.append_delivery({"subscriber_id": "s1", "event_type": f"billing.{i}",
                                   "attempt": 1, "delivered": True, "status": 200})
        self.assertEqual(PostgresStore(TEST_DATABASE_URL).delivery_count(), 3)

    def test_endpoints_fail_closed_via_503(self):
        from fastapi.testclient import TestClient
        original = main.store
        try:
            main.store = PostgresStore("postgresql://127.0.0.1:1/none")
            client = TestClient(main.app)  # lifespan not entered without context mgr
            resp = client.post("/subscribers", json={"url": "http://x", "events": ["billing.*"]})
            self.assertEqual(resp.status_code, 503)
            resp = client.post("/retry/0")
            self.assertIn(resp.status_code, (404, 503))
            self.assertNotEqual(resp.status_code, 200)
        finally:
            main.store = original


@unittest.skipUnless(PG_REACHABLE, "PostgreSQL not reachable at DATABASE_URL")
class TestEndToEndDeliveryAndRetry(unittest.TestCase):
    """Real dispatch → failed delivery → retries → dead letter, all persisted."""

    def setUp(self):
        self.store = _fresh_store()
        self._orig_store, self._orig_secret = main.store, main.WEBHOOK_SECRET
        main.store = self.store
        main.WEBHOOK_SECRET = "sekret"

    def tearDown(self):
        main.store, main.WEBHOOK_SECRET = self._orig_store, self._orig_secret

    def test_full_cycle_persisted(self):
        from fastapi.testclient import TestClient
        client = TestClient(main.app)
        resp = client.post("/subscribers",
                           json={"url": "http://127.0.0.1:9/unreachable",
                                 "events": ["billing.*"]})
        self.assertEqual(resp.status_code, 200)
        sid = resp.json()["subscriber_id"]

        resp = client.post("/dispatch", json={"event_type": "billing.invoice.generated",
                                              "payload": {"invoice": 1}})
        self.assertEqual(resp.status_code, 200)
        result = resp.json()["results"][0]
        self.assertFalse(result["delivered"])

        # retry until dead-lettered; every attempt hits the real unreachable URL
        dead = None
        for _ in range(main.MAX_ATTEMPTS):
            resp = client.post("/retry/0")
            self.assertEqual(resp.status_code, 200)
            dead = resp.json()
            if dead.get("dead_lettered"):
                break
        self.assertTrue(dead["dead_lettered"])

        # restart simulation: new store instance still sees the dead letter
        restarted = PostgresStore(TEST_DATABASE_URL)
        dls = restarted.list_dead_letters()
        self.assertEqual(len(dls), 1)
        self.assertEqual(dls[0]["subscriber_id"], sid)
        resp = client.get("/dead-letter")
        self.assertEqual(resp.json()["count"], 1)


if __name__ == "__main__":
    unittest.main()
