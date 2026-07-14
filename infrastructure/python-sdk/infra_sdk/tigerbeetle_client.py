"""TigerBeetle async client with KYC-level transfer limits and batch support."""

from __future__ import annotations

import logging
import time
from typing import Optional

import httpx

logger = logging.getLogger("ngapp.infra.tigerbeetle")

KYC_TRANSFER_LIMITS = {
    0: 500_000,       # Level 0: NGN 5,000 (in kobo)
    1: 5_000_000,     # Level 1: NGN 50,000
    2: 50_000_000,    # Level 2: NGN 500,000
    3: 1_000_000_000, # Level 3: NGN 10,000,000
}

LEDGER_PREMIUM = 1
LEDGER_CLAIMS = 2
LEDGER_COMMISSION = 3
LEDGER_PAYOUT = 4
LEDGER_RESERVE = 5
LEDGER_MOBILE_MONEY = 6


class TigerBeetleClient:
    def __init__(self, addr: str):
        self._base_url = f"http://{addr}"
        self._http = httpx.AsyncClient(timeout=5.0)

    async def ping(self):
        resp = await self._http.get(f"{self._base_url}/health")
        if resp.status_code != 200:
            raise ConnectionError(f"TigerBeetle unhealthy: {resp.status_code}")

    async def create_account(self, account_id: str, ledger: int = 1, code: int = 1) -> dict:
        resp = await self._http.post(f"{self._base_url}/accounts/create", json={
            "id": account_id, "ledger": ledger, "code": code, "flags": 0,
        })
        resp.raise_for_status()
        return resp.json()

    async def get_balance(self, account_id: str) -> dict:
        resp = await self._http.get(f"{self._base_url}/accounts/{account_id}")
        resp.raise_for_status()
        return resp.json()

    async def create_transfer(
        self, transfer_id: str, debit_account: str, credit_account: str,
        amount: int, ledger: int = 1, code: int = 1, user_data: str = "",
    ) -> dict:
        resp = await self._http.post(f"{self._base_url}/transfers/create", json={
            "id": transfer_id,
            "debit_account_id": debit_account,
            "credit_account_id": credit_account,
            "amount": amount,
            "ledger": ledger,
            "code": code,
            "user_data_128": user_data,
        })
        resp.raise_for_status()
        return resp.json()

    async def create_batch_transfers(self, transfers: list[dict]) -> dict:
        resp = await self._http.post(f"{self._base_url}/transfers/create_batch", json=transfers)
        resp.raise_for_status()
        return resp.json()

    def validate_kyc_limit(self, kyc_level: int, amount: int):
        limit = KYC_TRANSFER_LIMITS.get(kyc_level)
        if limit is None:
            raise ValueError(f"Unknown KYC level: {kyc_level}")
        if amount > limit:
            raise ValueError(f"Amount {amount} exceeds KYC level {kyc_level} limit of {limit}")

    async def create_premium_transfer(
        self, customer_acct: str, reserve_acct: str,
        amount: int, kyc_level: int, policy_id: str,
    ):
        self.validate_kyc_limit(kyc_level, amount)
        return await self.create_transfer(
            transfer_id=f"prem-{policy_id}-{time.time_ns()}",
            debit_account=customer_acct,
            credit_account=reserve_acct,
            amount=amount,
            ledger=LEDGER_PREMIUM,
            code=1,
            user_data=policy_id,
        )

    async def create_claim_payout(
        self, reserve_acct: str, customer_acct: str,
        amount: int, claim_id: str,
    ):
        return await self.create_transfer(
            transfer_id=f"claim-{claim_id}-{time.time_ns()}",
            debit_account=reserve_acct,
            credit_account=customer_acct,
            amount=amount,
            ledger=LEDGER_CLAIMS,
            code=2,
            user_data=claim_id,
        )

    async def create_commission_transfer(
        self, company_acct: str, agent_acct: str,
        amount: int, agent_id: str,
    ):
        return await self.create_transfer(
            transfer_id=f"comm-{agent_id}-{time.time_ns()}",
            debit_account=company_acct,
            credit_account=agent_acct,
            amount=amount,
            ledger=LEDGER_COMMISSION,
            code=3,
            user_data=agent_id,
        )
