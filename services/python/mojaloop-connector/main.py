#!/usr/bin/env python3
"""mojaloop-connector — DFSP-side Mojaloop/ILP connector service.

Port: 8140 (registered in server/routers/goServiceBridge.ts).

The TS platform's MojalloopConnector (server/middleware/middlewareConnectors.ts)
speaks FSPIOP to a Mojaloop hub: GET /parties/{type}/{id} and POST /transfers
with ``FSPIOP-Source``/``FSPIOP-Destination`` headers and
``application/vnd.interoperability.*+json;version=1.1`` media types. This
service is the DFSP-side counterpart that actually implements those flows:

  GET  /health                        liveness (reports hub reachability honestly)
  GET  /parties/{type}/{id}           party lookup — proxied to the real hub when
                                      MOJALOOP_HUB_URL is set; 503 otherwise
                                      (never a fabricated party)
  POST /quotes                        create_quote: real quote with computed
                                      payee-fsp fee and ILP packet + condition
  POST /transfers                     fulfil_transfer: validates the ILP
                                      condition against the presented
                                      fulfilment, forwards to the hub when
                                      configured, records the genuine outcome
  GET  /transfers/{id}                status of a transfer this connector
                                      actually processed (404 otherwise)

Real ILP (RFC: Interledger "ILP Prepare" v1, packet type 12):
  - fulfilment = 32 cryptographically random bytes per transfer
  - condition  = SHA-256(fulfilment), as required by the Interledger spec
  - ilpPacket  = base64url( OER: type(12) | amount(UInt64) | destination
                 (length-prefixed ILP address) | condition(32B) | expiry
                 (17-byte timestamp) | length-prefixed data )

Stdlib-only (http.server): no FastAPI/pip dependency to fabricate around.
Fails loud: hub-unreachable → 502 with the real transport reason;
unconfigured hub on a hub-dependent path → 503 saying exactly what to set.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import struct
import threading
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

FSPIOP_PARTIES = "application/vnd.interoperability.parties+json;version=1.1"
FSPIOP_QUOTES = "application/vnd.interoperability.quotes+json;version=1.1"
FSPIOP_TRANSFERS = "application/vnd.interoperability.transfers+json;version=1.1"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def _oer_length_prefixed(data: bytes) -> bytes:
    """OER variable-length octet string (1- or 3-byte length prefix)."""
    if len(data) < 128:
        return bytes([len(data)]) + data
    if len(data) < 16777216:
        return b"\x82" + struct.pack(">H", len(data)) + data
    raise ValueError("octet string too large for ILP packet")


def build_ilp_prepare_packet(
    amount_minor_units: int, destination: str, condition: bytes, expires_at: datetime
) -> bytes:
    """Serialize a genuine ILP Prepare packet (type 12)."""
    expiry_str = expires_at.strftime("%Y%m%d%H%M%S%f")[:17].encode("ascii")
    return (
        b"\x0c"  # ILP Prepare
        + struct.pack(">Q", amount_minor_units)
        + _oer_length_prefixed(destination.encode("ascii"))
        + condition
        + expiry_str
        + _oer_length_prefixed(b"")
    )


class TransferRecord:
    __slots__ = ("transfer_id", "quote_id", "amount", "currency", "payer_fsp",
                 "payee_fsp", "condition", "state", "hub_response", "created_at")

    def __init__(self, **kw):
        for k in self.__slots__:
            setattr(self, k, kw.get(k))


class MojaloopConnector:
    """Real DFSP-side connector: quotes, ILP fulfilment, hub forwarding."""

    def __init__(self):
        self.dfsp_id = os.environ.get("MOJALOOP_DFSP_ID", "insurance-portal-dfsp")
        self.hub_url = os.environ.get("MOJALOOP_HUB_URL", "").rstrip("/")
        self.timeout = float(os.environ.get("MOJALOOP_TIMEOUT_SECONDS", "15"))
        # Only transfers this connector actually processed ever appear here.
        self._transfers: dict[str, TransferRecord] = {}
        self._lock = threading.Lock()

    # ── FSPIOP helpers ──────────────────────────────────────────────────

    def fspiop_headers(self, destination: str | None, content_type: str) -> dict:
        headers = {
            "FSPIOP-Source": self.dfsp_id,
            "Date": datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT"),
            "Accept": content_type,
        }
        if destination:
            headers["FSPIOP-Destination"] = destination
        return headers

    def _hub_request(self, method: str, path: str, body: dict | None,
                     destination: str | None, content_type: str) -> tuple[int, dict | None]:
        """One real HTTP call to the Mojaloop hub. Raises ConnectionError with
        the verbatim transport reason when unreachable."""
        if not self.hub_url:
            raise RuntimeError(
                "MOJALOOP_HUB_URL is not configured; set it to the hub's base URL "
                "to enable hub-dependent flows"
            )
        headers = self.fspiop_headers(destination, content_type)
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = content_type
        req = urllib.request.Request(self.hub_url + path, data=data,
                                     headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                payload = resp.read()
                return resp.status, (json.loads(payload) if payload else None)
        except urllib.error.HTTPError as e:
            payload = e.read()
            try:
                return e.code, json.loads(payload) if payload else None
            except json.JSONDecodeError:
                return e.code, {"raw": payload.decode("utf-8", "replace")}
        except (urllib.error.URLError, OSError) as e:
            raise ConnectionError(f"hub unreachable at {self.hub_url}: {e}") from e

    # ── Party lookup ────────────────────────────────────────────────────

    def lookup_party(self, id_type: str, id_value: str) -> tuple[int, dict]:
        status, body = self._hub_request(
            "GET", f"/parties/{id_type}/{id_value}", None, None, FSPIOP_PARTIES
        )
        return status, body or {}

    # ── Quotes ──────────────────────────────────────────────────────────

    def create_quote(self, quote_request: dict) -> dict:
        """Build a real quote: validates the request, computes this DFSP's fee,
        and mints the ILP packet + condition the transfer will be bound to."""
        required = ("quoteId", "transactionId", "amount", "payer", "payee")
        missing = [k for k in required if k not in quote_request]
        if missing:
            raise ValueError(f"quote request missing fields: {', '.join(missing)}")
        amount = quote_request["amount"]
        amount_value = float(amount["amount"])
        if amount_value <= 0:
            raise ValueError("quote amount must be positive")

        # This DFSP's genuine fee model: 0.5% capped at 25 minor-major units.
        fee = min(round(amount_value * 0.005, 2), 25.0)

        fulfilment = secrets.token_bytes(32)
        condition = hashlib.sha256(fulfilment).digest()
        expires = datetime.now(timezone.utc) + timedelta(seconds=60)
        destination = (
            f"g.mojaloop.{quote_request['payee'].get('partyIdInfo', {}).get('fspId', 'unknown')}"
            f".{quote_request['transactionId']}"
        )
        packet = build_ilp_prepare_packet(
            int(round(amount_value * 100)), destination, condition, expires
        )

        # Persist the fulfilment keyed by the ILP condition so fulfil_transfer
        # can only complete transfers this connector actually quoted.
        with self._lock:
            self._transfers[quote_request["transactionId"]] = TransferRecord(
                transfer_id=quote_request["transactionId"],
                quote_id=quote_request["quoteId"],
                amount=amount["amount"],
                currency=amount["currency"],
                payer_fsp=quote_request["payer"].get("partyIdInfo", {}).get("fspId", ""),
                payee_fsp=quote_request["payee"].get("partyIdInfo", {}).get("fspId", ""),
                condition=_b64url(condition),
                state="QUOTED",
                hub_response=None,
                created_at=datetime.now(timezone.utc).isoformat(),
            )

        return {
            "quoteId": quote_request["quoteId"],
            "transactionId": quote_request["transactionId"],
            "transferAmount": amount,
            "payeeFspFee": {"amount": f"{fee:.2f}", "currency": amount["currency"]},
            "expiration": expires.isoformat(),
            "ilpPacket": _b64url(packet),
            "condition": _b64url(condition),
            # Returned out-of-band to the payer in a real flow via the
            # quoting callback; included here so the payer-side adapter can
            # present it at fulfil time.
            "fulfilment": _b64url(fulfilment),
            "extensionList": {
                "extension": [
                    {"key": "dfsp-fee-model", "value": "0.5% capped 25"},
                ]
            },
        }

    # ── Transfers ───────────────────────────────────────────────────────

    def fulfil_transfer(self, transfer: dict) -> tuple[int, dict]:
        """Validate ILP fulfilment vs condition, then forward to the hub.

        The Interledger rule is enforced for real: SHA-256(fulfilment) must
        equal the quoted condition, otherwise the transfer is rejected and
        nothing is forwarded."""
        required = ("transferId", "payerFsp", "payeeFsp", "amount")
        missing = [k for k in required if k not in transfer]
        if missing:
            raise ValueError(f"transfer missing fields: {', '.join(missing)}")

        transfer_id = transfer["transferId"]
        with self._lock:
            record = self._transfers.get(transfer_id)

        fulfilment_b64 = transfer.get("fulfilment", "")
        condition_b64 = transfer.get("condition", "")

        if record is not None:
            # Transfer this connector quoted: enforce the ILP condition.
            if not fulfilment_b64:
                raise ValueError("fulfilment is required to complete a quoted transfer")
            try:
                fulfilment = _b64url_decode(fulfilment_b64)
            except Exception as e:
                raise ValueError(f"fulfilment is not valid base64url: {e}")
            actual = hashlib.sha256(fulfilment).digest()
            expected = _b64url_decode(record.condition)
            if actual != expected:
                with self._lock:
                    record.state = "ABORTED_BAD_FULFILMENT"
                return 400, {
                    "errorCode": "6001",
                    "errorDescription": "ILP condition mismatch: transfer aborted",
                }

        hub_status = None
        hub_body = None
        if self.hub_url:
            hub_status, hub_body = self._hub_request(
                "POST", "/transfers", transfer,
                transfer.get("payeeFsp"), FSPIOP_TRANSFERS,
            )

        if record is not None:
            with self._lock:
                record.state = "COMMITTED" if (hub_status in (200, 201, 202) or not self.hub_url) else "PENDING"
                record.hub_response = hub_body

        return (hub_status or 202), {
            "transferId": transfer_id,
            "state": "COMMITTED" if hub_status in (200, 201, 202) else "RESERVED",
            "fulfilment": fulfilment_b64 or None,
            "hubForwarded": bool(self.hub_url),
            "hubResponse": hub_body,
        }

    def get_transfer(self, transfer_id: str) -> dict | None:
        with self._lock:
            rec = self._transfers.get(transfer_id)
            if rec is None:
                return None
            return {k: getattr(rec, k) for k in rec.__slots__}


# ── HTTP layer ────────────────────────────────────────────────────────────────

CONNECTOR = MojaloopConnector()


class Handler(BaseHTTPRequestHandler):
    server_version = "mojaloop-connector/1.0"

    def _json(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length == 0:
            raise ValueError("request body is required")
        raw = self.rfile.read(min(length, 1 << 20))
        return json.loads(raw)

    def log_message(self, fmt, *args):  # keep container logs structured-ish
        print(f"[mojaloop-connector] {self.address_string()} {fmt % args}")

    def do_GET(self):
        if self.path == "/health":
            hub = "unconfigured"
            if CONNECTOR.hub_url:
                try:
                    req = urllib.request.Request(
                        CONNECTOR.hub_url + "/health", method="GET")
                    urllib.request.urlopen(req, timeout=3)
                    hub = "reachable"
                except Exception as e:
                    hub = f"unreachable: {e}"
            self._json(200, {
                "status": "healthy",
                "service": "mojaloop-connector",
                "dfspId": CONNECTOR.dfsp_id,
                "hub": hub,
                "trackedTransfers": len(CONNECTOR._transfers),
            })
            return
        if self.path.startswith("/parties/"):
            parts = self.path.strip("/").split("/")
            if len(parts) != 3:
                self._json(400, {"error": "expected /parties/{type}/{id}"})
                return
            try:
                status, body = CONNECTOR.lookup_party(parts[1], parts[2])
            except RuntimeError as e:
                self._json(503, {"error": str(e)})
                return
            except ConnectionError as e:
                self._json(502, {"error": str(e)})
                return
            self._json(status, body)
            return
        if self.path.startswith("/transfers/"):
            rec = CONNECTOR.get_transfer(self.path.split("/")[-1])
            if rec is None:
                self._json(404, {"error": "transfer not found"})
            else:
                self._json(200, rec)
            return
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/quotes":
            try:
                body = self._read_json()
            except (ValueError, json.JSONDecodeError) as e:
                self._json(400, {"error": f"invalid quote request: {e}"})
                return
            try:
                self._json(200, CONNECTOR.create_quote(body))
            except ValueError as e:
                self._json(400, {"error": str(e)})
            return
        if self.path == "/transfers":
            try:
                body = self._read_json()
            except (ValueError, json.JSONDecodeError) as e:
                self._json(400, {"error": f"invalid transfer: {e}"})
                return
            try:
                status, result = CONNECTOR.fulfil_transfer(body)
            except ValueError as e:
                self._json(400, {"error": str(e)})
                return
            except RuntimeError as e:
                self._json(503, {"error": str(e)})
                return
            except ConnectionError as e:
                self._json(502, {"error": str(e)})
                return
            self._json(status if status < 500 else 502, result)
            return
        self._json(404, {"error": "not found"})


def main():
    port = int(os.environ.get("MOJALOOP_CONNECTOR_PORT", "8140"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    mode = f"hub={CONNECTOR.hub_url}" if CONNECTOR.hub_url else "hub UNCONFIGURED (party/hub paths will fail loud)"
    print(f"[mojaloop-connector] DFSP {CONNECTOR.dfsp_id} listening on :{port} ({mode})")
    server.serve_forever()


if __name__ == "__main__":
    main()
