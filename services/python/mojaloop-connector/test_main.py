#!/usr/bin/env python3
"""Real-behavior tests for the Mojaloop connector (stdlib unittest).

Run: python3 -m unittest test_main -v
"""
import base64
import hashlib
import json
import unittest

import main


def sample_quote():
    return {
        "quoteId": "q-1",
        "transactionId": "tx-1",
        "amount": {"amount": "100.00", "currency": "NGN"},
        "payer": {"partyIdInfo": {"fspId": "payer-fsp"}},
        "payee": {"partyIdInfo": {"fspId": "insurance-portal-dfsp"}},
    }


class TestIlpPacket(unittest.TestCase):
    def test_prepare_packet_roundtrip_condition(self):
        fulfilment = b"\x01" * 32
        condition = hashlib.sha256(fulfilment).digest()
        from datetime import datetime, timezone
        packet = main.build_ilp_prepare_packet(10000, "g.mojaloop.x.y", condition,
                                               datetime.now(timezone.utc))
        self.assertEqual(packet[0], 12)  # ILP Prepare type
        import struct
        self.assertEqual(struct.unpack(">Q", packet[1:9])[0], 10000)
        self.assertIn(condition, packet)

    def test_packet_is_base64url_safe(self):
        from datetime import datetime, timezone
        packet = main.build_ilp_prepare_packet(1, "g.x", b"\xff" * 32,
                                               datetime.now(timezone.utc))
        encoded = base64.urlsafe_b64encode(packet).decode().rstrip("=")
        self.assertNotIn("+", encoded)
        self.assertNotIn("/", encoded)


class TestCreateQuote(unittest.TestCase):
    def setUp(self):
        self.c = main.MojaloopConnector()

    def test_real_quote_with_fee_and_ilp(self):
        q = self.c.create_quote(sample_quote())
        self.assertEqual(q["quoteId"], "q-1")
        self.assertEqual(q["payeeFspFee"]["amount"], "0.50")  # 0.5% of 100
        self.assertEqual(q["payeeFspFee"]["currency"], "NGN")
        # condition == sha256(fulfilment), genuinely
        cond = base64.urlsafe_b64decode(q["condition"] + "=" * (-len(q["condition"]) % 4))
        ful = base64.urlsafe_b64decode(q["fulfilment"] + "=" * (-len(q["fulfilment"]) % 4))
        self.assertEqual(hashlib.sha256(ful).digest(), cond)

    def test_fee_capped(self):
        req = sample_quote()
        req["amount"]["amount"] = "1000000.00"
        q = self.c.create_quote(req)
        self.assertEqual(q["payeeFspFee"]["amount"], "25.00")

    def test_missing_fields_rejected(self):
        with self.assertRaises(ValueError):
            self.c.create_quote({"quoteId": "x"})

    def test_non_positive_amount_rejected(self):
        req = sample_quote()
        req["amount"]["amount"] = "0"
        with self.assertRaises(ValueError):
            self.c.create_quote(req)


class TestFulfilTransfer(unittest.TestCase):
    def setUp(self):
        self.c = main.MojaloopConnector()

    def test_correct_fulfilment_commits(self):
        q = self.c.create_quote(sample_quote())
        status, result = self.c.fulfil_transfer({
            "transferId": "tx-1",
            "payerFsp": "payer-fsp",
            "payeeFsp": "insurance-portal-dfsp",
            "amount": {"amount": "100.00", "currency": "NGN"},
            "condition": q["condition"],
            "fulfilment": q["fulfilment"],
        })
        self.assertEqual(status, 202)  # no hub configured → accepted locally
        self.assertIn(result["state"], ("COMMITTED", "RESERVED"))

    def test_wrong_fulfilment_aborts(self):
        self.c.create_quote(sample_quote())
        status, result = self.c.fulfil_transfer({
            "transferId": "tx-1",
            "payerFsp": "payer-fsp",
            "payeeFsp": "insurance-portal-dfsp",
            "amount": {"amount": "100.00", "currency": "NGN"},
            "fulfilment": base64.urlsafe_b64encode(b"\x00" * 32).decode().rstrip("="),
        })
        self.assertEqual(status, 400)
        self.assertEqual(result["errorCode"], "6001")
        rec = self.c.get_transfer("tx-1")
        self.assertEqual(rec["state"], "ABORTED_BAD_FULFILMENT")

    def test_missing_fulfilment_rejected(self):
        self.c.create_quote(sample_quote())
        with self.assertRaises(ValueError):
            self.c.fulfil_transfer({
                "transferId": "tx-1",
                "payerFsp": "payer-fsp",
                "payeeFsp": "insurance-portal-dfsp",
                "amount": {"amount": "100.00", "currency": "NGN"},
            })

    def test_unknown_transfer_not_tracked(self):
        self.assertIsNone(self.c.get_transfer("nope"))


class TestFailLoud(unittest.TestCase):
    def test_party_lookup_without_hub_is_loud(self):
        c = main.MojaloopConnector()  # no MOJALOOP_HUB_URL in test env
        c.hub_url = ""
        with self.assertRaises(RuntimeError):
            c.lookup_party("MSISDN", "2348012345678")

    def test_hub_unreachable_is_connection_error(self):
        c = main.MojaloopConnector()
        c.hub_url = "http://127.0.0.1:1"  # nothing listening
        c.timeout = 0.5
        with self.assertRaises(ConnectionError):
            c.lookup_party("MSISDN", "2348012345678")


if __name__ == "__main__":
    unittest.main()
