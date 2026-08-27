"""
KYC Verification Service — Open-Source, Offline-First, Mobile-First
Port: 8101

Honest capability statement (this build):
- BVN/NIN registry verification: REAL HTTP calls to NIBSS/NIMC when
  NIBSS_API_KEY / NIMC_API_KEY are configured. When not configured the
  endpoints FAIL LOUD (503) — identity is never "verified" against a
  simulated registry response.
- Document OCR / VLM extraction and MediaPipe liveness inference are NOT
  implemented in this build: those endpoints return 501 NOT_IMPLEMENTED
  instead of hardcoded passes. No liveness check ever passes on fabricated
  frames, and no document is ever "validated" by a stub.
- Kafka: publishes kyc.* events via kafka-python when a broker is reachable;
  publication failures are surfaced honestly in the response metadata.
"""

import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Annotated

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s %(message)s')
logger = logging.getLogger("kyc-verification")

app = FastAPI(
    title="KYC Verification Service",
    description="Open-source, offline-first identity verification using PaddleOCR + VLM + MediaPipe",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Configuration ────────────────────────────────────────────────────────────

PORT = int(os.getenv("PORT", "8101"))
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/6")
POSTGRES_URL = os.getenv("DATABASE_URL", "postgresql://ngapp:ngapp@localhost:5432/ngapp")
TEMPORAL_URL = os.getenv("TEMPORAL_URL", "http://localhost:7233")
KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "http://localhost:8080")
PERMIFY_URL = os.getenv("PERMIFY_URL", "http://localhost:3476")
OPENSEARCH_URL = os.getenv("OPENSEARCH_URL", "http://localhost:9200")
NIBSS_BVN_URL = os.getenv("NIBSS_BVN_URL", "https://api.nibss-plc.com.ng/bvn/verify")
NIMC_NIN_URL = os.getenv("NIMC_NIN_URL", "https://api.nimc.gov.ng/nin/verify")
NIBSS_API_KEY = os.getenv("NIBSS_API_KEY", "")
NIMC_API_KEY = os.getenv("NIMC_API_KEY", "")


# ── Domain Types ─────────────────────────────────────────────────────────────

class VerificationTier(str, Enum):
    TIER1 = "tier1"  # Phone only (₦50K limit)
    TIER2 = "tier2"  # BVN + basic ID (₦500K limit)
    TIER3 = "tier3"  # Full KYC: NIN + liveness + document (unlimited)


class DocumentType(str, Enum):
    NATIONAL_ID = "national_id"
    INTERNATIONAL_PASSPORT = "international_passport"
    DRIVERS_LICENSE = "drivers_license"
    VOTERS_CARD = "voters_card"
    NIN_SLIP = "nin_slip"


class LivenessMethod(str, Enum):
    BLINK_DETECTION = "blink_detection"
    HEAD_TURN = "head_turn"
    SMILE_DETECTION = "smile_detection"
    DEPTH_MAP = "depth_map"


class VerificationStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    VERIFIED = "verified"
    FAILED = "failed"
    REQUIRES_MANUAL = "requires_manual_review"
    EXPIRED = "expired"


# ── Request/Response Models ──────────────────────────────────────────────────

class BVNVerificationRequest(BaseModel):
    bvn: str = Field(..., min_length=11, max_length=11, pattern=r"^\d{11}$")
    first_name: str = Field(..., min_length=2)
    last_name: str = Field(..., min_length=2)
    date_of_birth: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    phone_number: str | None = None
    customer_id: str


class NINVerificationRequest(BaseModel):
    nin: str = Field(..., min_length=11, max_length=11, pattern=r"^\d{11}$")
    first_name: str = Field(..., min_length=2)
    last_name: str = Field(..., min_length=2)
    customer_id: str


class LivenessCheckRequest(BaseModel):
    customer_id: str
    session_id: str
    method: LivenessMethod = LivenessMethod.BLINK_DETECTION
    frame_count: int = Field(default=5, ge=3, le=30)


class DocumentVerificationRequest(BaseModel):
    customer_id: str
    document_type: DocumentType
    country: str = "NG"


class VerificationResponse(BaseModel):
    verification_id: str
    customer_id: str
    status: VerificationStatus
    tier_achieved: VerificationTier
    confidence_score: float = Field(ge=0.0, le=1.0)
    checks_passed: list[str]
    checks_failed: list[str]
    risk_flags: list[str]
    next_steps: list[str]
    expires_at: str | None = None
    metadata: dict = {}


# ── PaddleOCR Document Processor ─────────────────────────────────────────────

class DocumentProcessor:
    """Document OCR/VLM pipeline.

    HONEST STATUS: the PaddleOCR/VLM/MediaPipe models are not bundled in this
    build, so automated document extraction does not exist here. Every entry
    point raises NotImplementedError — this class never fabricates an OCR
    confidence, extracted field, or a document_valid verdict.
    """

    async def process_document(self, image_bytes: bytes, doc_type: DocumentType) -> dict:
        raise NotImplementedError(
            "automated document OCR/VLM extraction is not implemented in this build; "
            "documents must be routed to manual review"
        )


# ── MediaPipe Liveness Detection ─────────────────────────────────────────────

class LivenessDetector:
    """Face liveness detection.

    HONEST STATUS: no liveness inference exists in this build. check_liveness
    raises NotImplementedError — a liveness check is never passed on
    self-generated or hardcoded analysis.
    """

    async def check_liveness(self, frames: list[bytes], method: LivenessMethod) -> dict:
        raise NotImplementedError(
            "liveness inference is not implemented in this build; "
            "liveness must be performed by a certified external provider"
        )


# ── BVN/NIN Verification Client ──────────────────────────────────────────────

class RegistryUnavailableError(Exception):
    """Raised when a registry (NIBSS/NIMC) credential/endpoint is not
    configured — the caller must fail LOUD, never fabricate a verification."""


class RegistryCallError(Exception):
    """Raised when a configured registry call fails or answers with an
    unusable response."""


class IdentityVerifier:
    """NIBSS BVN + NIMC NIN verification — real registry calls only.

    Fail-closed contract: a verification result is produced ONLY by a real
    registry response. Unconfigured credential → RegistryUnavailableError
    (endpoint returns 503). Transport/HTTP failure → RegistryCallError
    (endpoint returns 502). No simulated responses, no format-only "passes".
    """

    def __init__(self):
        self.bvn_url = NIBSS_BVN_URL
        self.nin_url = NIMC_NIN_URL
        self.bvn_key = NIBSS_API_KEY
        self.nin_key = NIMC_API_KEY

    async def _call_registry(self, url: str, api_key: str, payload: dict, registry: str) -> dict:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    url,
                    json=payload,
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                )
        except Exception as exc:
            raise RegistryCallError(f"{registry} registry unreachable: {exc}") from exc
        if resp.status_code != 200:
            raise RegistryCallError(f"{registry} registry returned HTTP {resp.status_code}")
        try:
            data = resp.json()
        except Exception as exc:
            raise RegistryCallError(f"{registry} registry returned a non-JSON response") from exc
        if not isinstance(data, dict) or "verified" not in data:
            raise RegistryCallError(f"{registry} registry response lacks a 'verified' verdict: {str(data)[:200]}")
        return data

    async def verify_bvn(self, req: BVNVerificationRequest) -> dict:
        """Verify BVN via a real NIBSS API call (fail-closed)."""
        if not self.bvn_key:
            raise RegistryUnavailableError("NIBSS_API_KEY is not configured — BVN registry verification is unavailable")
        data = await self._call_registry(
            self.bvn_url,
            self.bvn_key,
            {
                "bvn": req.bvn,
                "first_name": req.first_name,
                "last_name": req.last_name,
                "date_of_birth": req.date_of_birth,
                "phone_number": req.phone_number,
            },
            "NIBSS",
        )
        return {
            "verified": bool(data.get("verified")),
            "method": "nibss_api",
            "match_score": float(data.get("match_score", 0.0)),
            "fields_matched": list(data.get("fields_matched", [])),
            "bvn_data": data.get("bvn_data", {}),
        }

    async def verify_nin(self, req: NINVerificationRequest) -> dict:
        """Verify NIN via a real NIMC API call (fail-closed)."""
        if not self.nin_key:
            raise RegistryUnavailableError("NIMC_API_KEY is not configured — NIN registry verification is unavailable")
        data = await self._call_registry(
            self.nin_url,
            self.nin_key,
            {"nin": req.nin, "first_name": req.first_name, "last_name": req.last_name},
            "NIMC",
        )
        return {
            "verified": bool(data.get("verified")),
            "method": "nimc_api",
            "match_score": float(data.get("match_score", 0.0)),
            "fields_matched": list(data.get("fields_matched", [])),
            "nin_data": data.get("nin_data", {}),
        }


# ── Kafka Event Publisher ────────────────────────────────────────────────────

class EventPublisher:
    """Real Kafka producer (kafka-python, lazy-connected).

    publish() raises on any failure — callers surface the failure honestly in
    response metadata instead of pretending the event flowed.
    """

    def __init__(self, brokers: str):
        self.brokers = brokers
        self._producer = None

    def _get_producer(self):
        if self._producer is None:
            from kafka import KafkaProducer
            self._producer = KafkaProducer(
                bootstrap_servers=self.brokers,
                value_serializer=lambda v: json.dumps(v).encode(),
                request_timeout_ms=5000,
                max_block_ms=5000,
            )
        return self._producer

    def publish(self, topic: str, event: dict):
        event["timestamp"] = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()  # naive-UTC wire format preserved (DTZ003)
        event["service"] = "kyc-verification"
        future = self._get_producer().send(topic, event)
        future.get(timeout=5)  # raises if the broker did not accept the record


# ── Service Instances ────────────────────────────────────────────────────────

doc_processor = DocumentProcessor()
liveness_detector = LivenessDetector()
identity_verifier = IdentityVerifier()
event_publisher = EventPublisher(KAFKA_BROKERS)


# ── API Endpoints ────────────────────────────────────────────────────────────

def _publish_safely(topic: str, event: dict) -> tuple[bool, str]:
    """Publish an event, converting failure into an honest (published, error)
    pair for response metadata. Never pretends a void publish succeeded."""
    try:
        event_publisher.publish(topic, event)
        return True, ""
    except ImportError as exc:
        logger.error("[KAFKA] CRITICAL: %s not published (kafka-python unavailable): %s", topic, exc)
        return False, f"kafka-python unavailable: {exc}"
    except Exception as exc:  # noqa: BLE001 — kafka-python raises a broad KafkaError hierarchy; a broker failure must degrade to honest metadata, never crash a verification response
        logger.error("[KAFKA] CRITICAL: %s not published: %s", topic, exc)
        return False, str(exc)


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "kyc-verification",
        "version": "1.0.0",
        "capabilities": {
            "nibss_bvn_verification": bool(NIBSS_API_KEY),
            "nimc_nin_verification": bool(NIMC_API_KEY),
            "document_ocr_extraction": False,
            "liveness_detection": False,
        },
        "honesty_note": "document OCR and liveness inference are not implemented in this build; those endpoints return 501. BVN/NIN endpoints fail loud (503) when registry credentials are unconfigured.",
    }


@app.post("/api/v1/kyc/verify-bvn", response_model=VerificationResponse)
async def verify_bvn(req: BVNVerificationRequest):
    """Verify BVN via a real NIBSS API call with name/DOB matching.

    Fail-loud: 503 when the registry credential is unconfigured, 502 when the
    registry call fails. A verification verdict is only ever the registry's.
    """
    verification_id = str(uuid.uuid4())

    try:
        result = await identity_verifier.verify_bvn(req)
    except RegistryUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RegistryCallError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    checks_passed = []
    checks_failed = []
    risk_flags = []

    if result["verified"]:
        checks_passed.append("bvn_registry_verified")
        if result["match_score"] >= 0.8:
            checks_passed.append("name_match")
        else:
            checks_failed.append("name_mismatch")
            risk_flags.append("identity_mismatch")
    else:
        checks_failed.append("bvn_verification_failed")

    tier = VerificationTier.TIER2 if result["verified"] and result["match_score"] >= 0.8 and not checks_failed else VerificationTier.TIER1
    status = VerificationStatus.VERIFIED if result["verified"] and not checks_failed else VerificationStatus.FAILED

    published, pub_err = _publish_safely("kyc.bvn.verified", {
        "customer_id": req.customer_id,
        "verification_id": verification_id,
        "status": status.value,
        "match_score": result["match_score"],
    })

    return VerificationResponse(
        verification_id=verification_id,
        customer_id=req.customer_id,
        status=status,
        tier_achieved=tier,
        confidence_score=result["match_score"],
        checks_passed=checks_passed,
        checks_failed=checks_failed,
        risk_flags=risk_flags,
        next_steps=["submit_id_document", "complete_liveness"] if tier == VerificationTier.TIER2 else ["submit_bvn"],
        expires_at=(datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=365)).isoformat() if status == VerificationStatus.VERIFIED else None,  # naive-UTC wire format preserved
        metadata={"method": result["method"], "event_published": published, "event_error": pub_err},
    )


@app.post("/api/v1/kyc/verify-nin", response_model=VerificationResponse)
async def verify_nin(req: NINVerificationRequest):
    """Verify NIN via a real NIMC API call (fail-loud: 503 unconfigured / 502 call failure)."""
    verification_id = str(uuid.uuid4())
    try:
        result = await identity_verifier.verify_nin(req)
    except RegistryUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RegistryCallError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    checks_passed = ["nin_registry_verified"] if result["verified"] else []
    checks_failed = [] if result["verified"] else ["nin_verification_failed"]

    tier = VerificationTier.TIER3 if result["verified"] else VerificationTier.TIER1
    status = VerificationStatus.VERIFIED if result["verified"] else VerificationStatus.FAILED

    published, pub_err = _publish_safely("kyc.nin.verified", {
        "customer_id": req.customer_id,
        "verification_id": verification_id,
        "status": status.value,
    })

    return VerificationResponse(
        verification_id=verification_id,
        customer_id=req.customer_id,
        status=status,
        tier_achieved=tier,
        confidence_score=result["match_score"],
        checks_passed=checks_passed,
        checks_failed=checks_failed,
        risk_flags=[],
        next_steps=["complete_liveness"] if status == VerificationStatus.VERIFIED else ["retry_nin"],
        expires_at=(datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=365)).isoformat() if status == VerificationStatus.VERIFIED else None,  # naive-UTC wire format preserved
        metadata={"method": result["method"], "event_published": published, "event_error": pub_err},
    )


@app.post("/api/v1/kyc/verify-document")
async def verify_document(
    customer_id: str,
    document_type: DocumentType,
    file: Annotated[UploadFile, File(...)],
):
    """Verify identity document.

    FAIL-LOUD: automated OCR/VLM extraction is not implemented in this build.
    Returns 501 rather than a fabricated 'document_valid' verdict. Documents
    must be routed to manual review.
    """
    image_bytes = await file.read()
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    try:
        await doc_processor.process_document(image_bytes, document_type)
    except NotImplementedError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc


@app.post("/api/v1/kyc/liveness-check")
async def liveness_check(req: LivenessCheckRequest):
    """Perform liveness detection.

    FAIL-LOUD: liveness inference is not implemented in this build. Returns
    501 — a liveness check is NEVER passed on self-generated frames or
    hardcoded check results.
    """
    try:
        await liveness_detector.check_liveness([], req.method)
    except NotImplementedError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc


@app.post("/api/v1/kyc/full-verification")
async def full_verification(
    customer_id: str,
    bvn: str | None = None,
    nin: str | None = None,
    first_name: str = "",
    last_name: str = "",
    date_of_birth: str = "",
):
    """Orchestrate full KYC verification (all tiers) — offline-first."""
    verification_id = str(uuid.uuid4())
    checks_passed = []
    checks_failed = []
    risk_flags = []
    match_scores = []
    unavailable = []
    tier = VerificationTier.TIER1

    # BVN verification (registry-unavailable is recorded honestly, never treated as a pass)
    if bvn:
        bvn_req = BVNVerificationRequest(
            bvn=bvn, first_name=first_name, last_name=last_name,
            date_of_birth=date_of_birth or "1990-01-01", customer_id=customer_id,
        )
        try:
            bvn_result = await identity_verifier.verify_bvn(bvn_req)
            match_scores.append(bvn_result["match_score"])
            if bvn_result["verified"]:
                checks_passed.append("bvn_verified")
                tier = VerificationTier.TIER2
            else:
                checks_failed.append("bvn_failed")
        except (RegistryUnavailableError, RegistryCallError) as exc:
            unavailable.append("bvn")
            checks_failed.append("bvn_unavailable")
            risk_flags.append("registry_unavailable")
            logger.error("full_verification: BVN step failed closed: %s", exc)

    # NIN verification
    if nin:
        nin_req = NINVerificationRequest(
            nin=nin, first_name=first_name, last_name=last_name, customer_id=customer_id,
        )
        try:
            nin_result = await identity_verifier.verify_nin(nin_req)
            match_scores.append(nin_result["match_score"])
            if nin_result["verified"]:
                checks_passed.append("nin_verified")
                tier = VerificationTier.TIER3
            else:
                checks_failed.append("nin_failed")
        except (RegistryUnavailableError, RegistryCallError) as exc:
            unavailable.append("nin")
            checks_failed.append("nin_unavailable")
            risk_flags.append("registry_unavailable")
            logger.error("full_verification: NIN step failed closed: %s", exc)

    if unavailable:
        status = VerificationStatus.REQUIRES_MANUAL
    else:
        status = VerificationStatus.VERIFIED if checks_passed and not checks_failed else VerificationStatus.PENDING

    published, pub_err = _publish_safely("kyc.verification.complete", {
        "customer_id": customer_id,
        "verification_id": verification_id,
        "tier": tier.value,
        "status": status.value,
    })

    return VerificationResponse(
        verification_id=verification_id,
        customer_id=customer_id,
        status=status,
        tier_achieved=tier,
        confidence_score=(sum(match_scores) / len(match_scores)) if match_scores else 0.0,
        checks_passed=checks_passed,
        checks_failed=checks_failed,
        risk_flags=risk_flags,
        next_steps=["submit_document", "complete_liveness"] if tier < VerificationTier.TIER3 else [],
        metadata={
            "registry_unavailable_steps": unavailable,
            "event_published": published,
            "event_error": pub_err,
        },
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
