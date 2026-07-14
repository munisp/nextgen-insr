"""Permify async client with fine-grained RBAC, default-deny, and relationship management."""

from __future__ import annotations

import logging

import httpx

logger = logging.getLogger("ngapp.infra.permify")

PLATFORM_SCHEMA = """entity user {}

entity organization {
    relation admin @user
    relation member @user
    permission manage = admin
    permission view = admin or member
}

entity customer {
    relation owner @user
    relation agent @user
    relation organization @organization
    permission view = owner or agent or organization.admin
    permission edit = owner or organization.admin
    permission delete = organization.admin
}

entity policy {
    relation owner @user
    relation customer @customer
    relation underwriter @user
    relation organization @organization
    permission view = owner or customer.owner or underwriter or organization.member
    permission edit = underwriter or organization.admin
    permission approve = underwriter or organization.admin
    permission cancel = owner or organization.admin
}

entity claim {
    relation claimant @user
    relation policy @policy
    relation adjudicator @user
    relation organization @organization
    permission view = claimant or policy.owner or adjudicator or organization.member
    permission edit = adjudicator or organization.admin
    permission approve = adjudicator or organization.admin
    permission settle = organization.admin
}

entity payment {
    relation payer @user
    relation payee @user
    relation organization @organization
    permission view = payer or payee or organization.member
    permission process = organization.admin
    permission refund = organization.admin
}

entity kyc_verification {
    relation subject @user
    relation reviewer @user
    relation organization @organization
    permission view = subject or reviewer or organization.admin
    permission review = reviewer or organization.admin
    permission approve = reviewer or organization.admin
}

entity document {
    relation owner @user
    relation organization @organization
    permission view = owner or organization.member
    permission edit = owner or organization.admin
    permission delete = organization.admin
}
"""


class PermifyClient:
    def __init__(self, base_url: str, tenant_id: str = "ngapp"):
        self._base_url = base_url
        self._tenant_id = tenant_id
        self._http = httpx.AsyncClient(timeout=5.0)

    async def ping(self):
        resp = await self._http.get(f"{self._base_url}/healthz")
        if resp.status_code >= 500:
            raise ConnectionError(f"Permify unhealthy: {resp.status_code}")

    async def write_schema(self):
        resp = await self._http.post(
            f"{self._base_url}/v1/tenants/{self._tenant_id}/schemas/write",
            json={"schema": PLATFORM_SCHEMA},
        )
        if resp.status_code >= 400:
            logger.warning("schema_write_failed: %s", resp.text)

    async def write_relationship(self, entity_type: str, entity_id: str,
                                  relation: str, subject_type: str, subject_id: str):
        resp = await self._http.post(
            f"{self._base_url}/v1/tenants/{self._tenant_id}/relationships/write",
            json={
                "metadata": {"schema_version": ""},
                "tuples": [{
                    "entity": {"type": entity_type, "id": entity_id},
                    "relation": relation,
                    "subject": {"type": subject_type, "id": subject_id},
                }],
            },
        )
        if resp.status_code >= 400:
            logger.warning("relationship_write_failed: %s", resp.text)

    async def check_permission(self, entity_type: str, entity_id: str,
                                permission: str, subject_type: str, subject_id: str) -> bool:
        try:
            resp = await self._http.post(
                f"{self._base_url}/v1/tenants/{self._tenant_id}/permissions/check",
                json={
                    "metadata": {"schema_version": "", "depth": 5},
                    "entity": {"type": entity_type, "id": entity_id},
                    "permission": permission,
                    "subject": {"type": subject_type, "id": subject_id},
                },
            )
            data = resp.json()
            return data.get("can") == "CHECK_RESULT_ALLOWED"
        except Exception as e:
            logger.warning("permify_unavailable_denying: %s.%s: %s", entity_type, permission, e)
            return False
