"""OpenSearch async client with bulk indexing, ILM, audit trail, and compliance reports."""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime
from typing import Optional

import httpx

logger = logging.getLogger("ngapp.infra.opensearch")

INDEX_AUDIT_TRAIL = "ngapp-audit-trail"
INDEX_KYC_EVENTS = "ngapp-kyc-events"
INDEX_COMPLIANCE = "ngapp-compliance"
INDEX_METRICS = "ngapp-metrics"
INDEX_POLICIES = "ngapp-policies"
INDEX_CLAIMS = "ngapp-claims"
INDEX_PAYMENTS = "ngapp-payments"
INDEX_FRAUD = "ngapp-fraud-alerts"
INDEX_SECURITY = "ngapp-security-events"

ALL_INDICES = [
    INDEX_AUDIT_TRAIL, INDEX_KYC_EVENTS, INDEX_COMPLIANCE, INDEX_METRICS,
    INDEX_POLICIES, INDEX_CLAIMS, INDEX_PAYMENTS, INDEX_FRAUD, INDEX_SECURITY,
]


class OpenSearchClient:
    def __init__(self, base_url: str):
        self._base_url = base_url
        self._http = httpx.AsyncClient(timeout=10.0)

    async def ping(self):
        resp = await self._http.get(f"{self._base_url}/_cluster/health")
        if resp.status_code != 200:
            raise ConnectionError(f"OpenSearch unhealthy: {resp.status_code}")

    async def setup_platform_indices(self):
        mapping = {
            "settings": {"number_of_shards": 1, "number_of_replicas": 1, "refresh_interval": "5s"},
            "mappings": {
                "properties": {
                    "timestamp": {"type": "date"},
                    "service": {"type": "keyword"},
                    "action": {"type": "keyword"},
                    "entity_type": {"type": "keyword"},
                    "entity_id": {"type": "keyword"},
                    "actor": {"type": "keyword"},
                    "ip_address": {"type": "ip"},
                    "status_code": {"type": "integer"},
                    "duration_ms": {"type": "integer"},
                    "kyc_level": {"type": "integer"},
                }
            },
        }
        for idx in ALL_INDICES:
            try:
                await self._http.put(f"{self._base_url}/{idx}", json=mapping)
            except Exception as e:
                logger.warning("index_creation_failed: %s: %s", idx, e)

        await self._setup_ilm_policy()

    async def _setup_ilm_policy(self):
        policy = {
            "policy": {
                "description": "NGApp platform index lifecycle",
                "default_state": "hot",
                "states": [
                    {"name": "hot", "actions": [{"rollover": {"min_size": "10gb", "min_index_age": "7d"}}],
                     "transitions": [{"state_name": "warm", "conditions": {"min_index_age": "30d"}}]},
                    {"name": "warm", "actions": [{"replica_count": {"number_of_replicas": 0}}],
                     "transitions": [{"state_name": "delete", "conditions": {"min_index_age": "365d"}}]},
                    {"name": "delete", "actions": [{"delete": {}}]},
                ],
            }
        }
        try:
            await self._http.put(f"{self._base_url}/_plugins/_ism/policies/ngapp-lifecycle", json=policy)
        except Exception as e:
            logger.warning("ilm_policy_failed: %s", e)

    async def index_document(self, index: str, doc_id: str, doc: dict):
        resp = await self._http.put(f"{self._base_url}/{index}/_doc/{doc_id}", json=doc)
        if resp.status_code >= 400:
            logger.warning("index_failed: %s/%s: %s", index, doc_id, resp.text)

    async def bulk_index(self, index: str, docs: dict[str, dict]):
        lines = []
        for doc_id, doc in docs.items():
            lines.append(json.dumps({"index": {"_index": index, "_id": doc_id}}))
            lines.append(json.dumps(doc))
        body = "\n".join(lines) + "\n"
        resp = await self._http.post(
            f"{self._base_url}/_bulk",
            content=body,
            headers={"Content-Type": "application/x-ndjson"},
        )
        if resp.status_code >= 400:
            logger.warning("bulk_index_failed: %s", resp.text)

    async def index_audit(self, service: str, action: str, entity_type: str = "",
                           entity_id: str = "", actor: str = "", ip_address: str = "",
                           kyc_level: int = 0, details: Optional[dict] = None):
        doc_id = f"audit-{time.time_ns()}"
        doc = {
            "service": service,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "actor": actor,
            "ip_address": ip_address,
            "kyc_level": kyc_level,
            "details": details or {},
            "timestamp": datetime.utcnow().isoformat(),
        }
        await self.index_document(INDEX_AUDIT_TRAIL, doc_id, doc)

    async def search(self, index: str, query: dict, from_: int = 0, size: int = 20) -> tuple[list[dict], int]:
        body = {
            "query": query,
            "from": from_,
            "size": size,
            "sort": [{"timestamp": {"order": "desc"}}],
        }
        resp = await self._http.post(f"{self._base_url}/{index}/_search", json=body)
        if resp.status_code != 200:
            return [], 0
        data = resp.json()
        hits = data.get("hits", {})
        total = hits.get("total", {}).get("value", 0) if isinstance(hits.get("total"), dict) else 0
        docs = [h["_source"] for h in hits.get("hits", []) if "_source" in h]
        return docs, total

    async def generate_compliance_report(self, start_date: str, end_date: str) -> dict:
        query = {"bool": {"filter": [{"range": {"timestamp": {"gte": start_date, "lte": end_date}}}]}}
        _, total = await self.search(INDEX_AUDIT_TRAIL, query, size=0)
        return {
            "period_start": start_date,
            "period_end": end_date,
            "total_events": total,
            "generated_at": datetime.utcnow().isoformat(),
        }

    async def close(self):
        await self._http.aclose()
