"""Mojaloop async client with KYC-gated transfers, idempotency, and mobile money."""

from __future__ import annotations

import hashlib
import logging
import time
from typing import Optional

import httpx

logger = logging.getLogger("ngapp.infra.mojaloop")

KYC_TRANSFER_LIMITS = {0: 5000, 1: 50000, 2: 500000, 3: 10000000}


def payment_scoped_key(prefix: str, entity_id: str, amount: str, currency: str,
                       attempt_nonce: Optional[str] = None) -> str:
    """PAY-9: idempotency keys bind the FULL payment intent (entity + amount +
    currency + optional attempt nonce). Previously `prem-{policy_id}` /
    `payout-{claim_id}` were reused across different amounts — a legitimate
    second payment was either rejected by the switch (lost funds) or had no
    replay protection at all."""
    h = hashlib.sha256(
        f"{entity_id}|{amount}|{currency}|{attempt_nonce or ''}".encode()
    ).hexdigest()[:16]
    return f"{prefix}-{entity_id}-{h}"


class MojaloopClient:
    def __init__(self, base_url: str, fsp_id: str = "ngapp-insurance"):
        self._base_url = base_url
        self._fsp_id = fsp_id
        self._http = httpx.AsyncClient(timeout=15.0)

    def _fspiop_headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/vnd.interoperability.transfers+json;version=1.1",
            "Accept": "application/vnd.interoperability.transfers+json;version=1.1",
            "FSPIOP-Source": self._fsp_id,
        }

    async def ping(self):
        resp = await self._http.get(f"{self._base_url}/health")
        if resp.status_code >= 500:
            raise ConnectionError(f"Mojaloop unhealthy: {resp.status_code}")

    async def lookup_participant(self, id_type: str, id_value: str) -> str:
        resp = await self._http.get(
            f"{self._base_url}/participants/{id_type}/{id_value}",
            headers=self._fspiop_headers(),
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("fspId", "")

    async def request_quote(self, transfer_id: str, payer_fsp: str, payee_fsp: str,
                            payer_id: str, payee_id: str, amount: str, currency: str) -> dict:
        resp = await self._http.post(f"{self._base_url}/quotes", headers=self._fspiop_headers(), json={
            "quoteId": f"q-{time.time_ns()}",
            "transactionId": transfer_id,
            "payee": {"fspId": payee_fsp, "partyIdType": "MSISDN", "partyIdentifier": payee_id},
            "payer": {"fspId": payer_fsp, "partyIdType": "MSISDN", "partyIdentifier": payer_id},
            "amountType": "SEND",
            "amount": {"amount": amount, "currency": currency},
            "transactionType": {"scenario": "TRANSFER", "initiator": "PAYER", "initiatorType": "CONSUMER"},
        })
        return resp.json()

    async def execute_transfer(self, transfer_id: str, payer_fsp: str, payee_fsp: str,
                               amount: str, currency: str, kyc_level: int,
                               idempotency_key: Optional[str] = None) -> dict:
        limit = KYC_TRANSFER_LIMITS.get(kyc_level)
        if limit is None:
            raise ValueError(f"Invalid KYC level: {kyc_level}")
        if float(amount) > limit:
            raise ValueError(f"Amount {amount} exceeds KYC level {kyc_level} limit of {limit}")

        headers = self._fspiop_headers()
        if idempotency_key:
            headers["X-Idempotency-Key"] = idempotency_key

        resp = await self._http.post(f"{self._base_url}/transfers", headers=headers, json={
            "transferId": transfer_id,
            "payerFsp": payer_fsp,
            "payeeFsp": payee_fsp,
            "amount": {"amount": amount, "currency": currency},
            "ilpPacket": "",
            "condition": "",
            "expiration": "",
        })
        if resp.status_code >= 400:
            raise RuntimeError(f"Transfer failed ({resp.status_code}): {resp.text}")
        return resp.json()

    async def collect_premium_via_mobile_money(
        self, customer_phone: str, amount: str, currency: str,
        kyc_level: int, policy_id: str, attempt_nonce: Optional[str] = None,
    ) -> dict:
        key = payment_scoped_key("prem", policy_id, amount, currency, attempt_nonce)
        return await self.execute_transfer(
            transfer_id=f"{key}-{time.time_ns()}",
            payer_fsp="mobile-money-provider",
            payee_fsp=self._fsp_id,
            amount=amount,
            currency=currency,
            kyc_level=kyc_level,
            idempotency_key=key,
        )

    async def payout_claim(self, customer_phone: str, amount: str, currency: str,
                           claim_id: str, attempt_nonce: Optional[str] = None) -> dict:
        # Amount-bound key: a legitimate partial/second payout for the same
        # claim with a different amount gets a different key; an exact retry
        # of the same payout replays safely.
        key = payment_scoped_key("payout", claim_id, amount, currency, attempt_nonce)
        return await self.execute_transfer(
            transfer_id=f"{key}-{time.time_ns()}",
            payer_fsp="mobile-money-provider",
            payee_fsp="mobile-money-provider",
            amount=amount,
            currency=currency,
            kyc_level=3,
            idempotency_key=key,
        )
