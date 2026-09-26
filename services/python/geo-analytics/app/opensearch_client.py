"""opensearch_client.py — Q-wave Q5 (2026-09-25)

OpenSearch bulk indexing of computed zone features. Config-gated
(OPENSEARCH_ADDR) + fail-closed: unconfigured ⇒ disabled (reported honestly);
bulk errors raise OpenSearchError. Real HTTP via httpx, NDJSON bulk API —
same convention as infrastructure/opensearch templates.
"""

from __future__ import annotations

import json
from typing import Any

import httpx


class OpenSearchError(RuntimeError):
    """OpenSearch bulk operation failed (fail-closed)."""


class OpenSearchIndexer:
    def __init__(self, addr: str | None, index: str = "insureportal-zone-features") -> None:
        self.addr = addr.rstrip("/") if addr else None
        self.index = index
        self._client = httpx.Client(timeout=10.0)

    @property
    def enabled(self) -> bool:
        return self.addr is not None

    def bulk_index(self, docs: list[dict[str, Any]], id_field: str = "zone_id") -> int:
        """Bulk-index docs (idempotent: _id = doc[id_field]). Fail-closed on
        any HTTP or per-item error."""
        if not self.enabled:
            raise OpenSearchError(
                "OPENSEARCH_ADDR is not configured (fail-closed, disclosed 2026-09-25)"
            )
        if not docs:
            return 0
        lines: list[str] = []
        for doc in docs:
            if id_field not in doc:
                raise OpenSearchError(f"doc lacks {id_field!r} (fail-closed)")
            lines.append(json.dumps({"index": {"_index": self.index, "_id": str(doc[id_field])}}))
            lines.append(json.dumps(doc, default=str))
        body = "\n".join(lines) + "\n"
        try:
            resp = self._client.post(
                f"{self.addr}/_bulk",
                content=body.encode(),
                headers={"Content-Type": "application/x-ndjson"},
            )
        except httpx.HTTPError as exc:
            raise OpenSearchError(f"opensearch bulk unreachable: {exc}") from exc
        if resp.status_code >= 400:
            raise OpenSearchError(f"opensearch bulk HTTP {resp.status_code}: {resp.text[:500]}")
        result = resp.json()
        if result.get("errors"):
            first = next(
                (item for item in result.get("items", []) if item.get("index", {}).get("error")),
                {},
            )
            raise OpenSearchError(f"opensearch bulk item error: {json.dumps(first)[:500]}")
        return len(docs)

    def close(self) -> None:
        self._client.close()
