"""Assumption-set versioning and NAICOM filing export tests."""

import json

import pytest

from actuary_analytics.assumptions import (
    AssumptionSet,
    AssumptionValidationError,
    export_naicom_filing,
    filing_to_bytes,
)


class TestValidation:
    def test_illustrative_set_cannot_be_filing_ready(self):
        aset = AssumptionSet(
            name="motor-pricing", scope="pricing", version="2026.09",
            payload={"factors": {"base": 0.05}},
            naicom_filing_ready=True,
            labels={"official": False, "status": "illustrative_reference"},
        )
        with pytest.raises(AssumptionValidationError) as excinfo:
            aset.validate()
        assert "official=True" in str(excinfo.value)

    def test_filing_ready_requires_approval(self):
        aset = AssumptionSet(
            name="motor-pricing", scope="pricing", version="2026.09",
            payload={}, naicom_filing_ready=True,
            labels={"official": True, "status": "approved"},
        )
        with pytest.raises(AssumptionValidationError):
            aset.validate()

    def test_bad_scope_rejected(self):
        aset = AssumptionSet(name="x", scope="nonsense", version="1", payload={})
        with pytest.raises(AssumptionValidationError):
            aset.validate()


class TestFilingExport:
    def test_export_deterministic_and_self_describing(self):
        aset = AssumptionSet(
            name="capital-rbc-approx", scope="capital", version="2026.09",
            payload={"factors": {"motor": {"net_premium_factor": 0.15}}},
            approved_by="actuary@nextgen-insr", approved_at="2026-09-01T00:00:00Z",
            naicom_filing_ready=True,
            labels={"official": True, "status": "approved"},
        )
        filing1 = export_naicom_filing(aset)
        filing2 = export_naicom_filing(aset)
        assert filing_to_bytes(filing1) == filing_to_bytes(filing2)
        assert filing1["artefactType"] == "naicom_assumption_filing"
        assert filing1["payloadHash"].startswith("sha256:")
        assert filing1["labels"]["official"] is True
        # payload hash matches canonical payload bytes
        import hashlib

        canonical = json.dumps(aset.payload, sort_keys=True, separators=(",", ":")).encode()
        assert filing1["payloadHash"] == "sha256:" + hashlib.sha256(canonical).hexdigest()

    def test_export_fails_closed_on_illustrative(self):
        aset = AssumptionSet(
            name="life-mortality", scope="life", version="2026.09",
            payload={"basis": "ILLUSTRATIVE-NGA-2020"},
            naicom_filing_ready=True,
            labels={"official": False, "status": "illustrative_reference"},
        )
        with pytest.raises(AssumptionValidationError):
            export_naicom_filing(aset)
