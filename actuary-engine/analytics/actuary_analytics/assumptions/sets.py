"""Versioned assumption sets → NAICOM filing artefact export (design §4,
§9.2). Every set is versioned and labelled; sets referencing illustrative
mortality bases or unconfirmed NAICOM factors cannot be marked
naicomFilingReady — the honest-labelling posture is enforced in code."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any


class AssumptionValidationError(Exception):
    """Assumption set fails the filing-readiness or consistency rules."""


SCOPES = ("pricing", "reserving", "capital", "life")


@dataclass
class AssumptionSet:
    name: str
    scope: str
    version: str
    payload: dict[str, Any]
    approved_by: str | None = None
    approved_at: str | None = None
    naicom_filing_ready: bool = False
    # Labels preserved verbatim from actuarial-platform's honest posture.
    labels: dict[str, Any] = field(default_factory=lambda: {
        "official": False,
        "status": "illustrative_reference",
    })

    def validate(self) -> None:
        if self.scope not in SCOPES:
            raise AssumptionValidationError(
                f"scope must be one of {SCOPES}, got {self.scope!r}"
            )
        if not self.name or not self.version:
            raise AssumptionValidationError("name and version are required")
        if self.naicom_filing_ready:
            # Filing readiness is gated on approved bases — never invented.
            if self.labels.get("official") is not True:
                raise AssumptionValidationError(
                    "naicom_filing_ready requires official=True (approved bases "
                    "loaded by compliance); illustrative sets cannot be filed"
                )
            if not self.approved_by or not self.approved_at:
                raise AssumptionValidationError(
                    "naicom_filing_ready requires approved_by and approved_at"
                )


def export_naicom_filing(assumption_set: AssumptionSet) -> dict[str, Any]:
    """Export a NAICOM filing artefact from an approved assumption set.

    Deterministic, self-describing export for the compliance return
    generator (design §7.2). Fails closed on unapproved/illustrative sets.
    """
    assumption_set.validate()
    payload_bytes = json.dumps(
        assumption_set.payload, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return {
        "artefactType": "naicom_assumption_filing",
        "name": assumption_set.name,
        "scope": assumption_set.scope,
        "version": assumption_set.version,
        "payload": assumption_set.payload,
        "payloadHash": "sha256:" + hashlib.sha256(payload_bytes).hexdigest(),
        "labels": dict(assumption_set.labels),
        "approval": {
            "approvedBy": assumption_set.approved_by,
            "approvedAt": assumption_set.approved_at,
        },
        "disclaimer": (
            "Assumption sets ship flagged INTERNAL_EXPERIENCE / illustrative "
            "until NAICOM-approved bases are loaded; official=False sets are "
            "not eligible for statutory filings."
        ),
    }


def filing_to_bytes(filing: dict[str, Any]) -> bytes:
    return (json.dumps(filing, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
