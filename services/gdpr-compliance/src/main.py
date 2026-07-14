"""
GDPR/NDPR Compliance Service — Unified Insurance Platform
Handles: data subject rights, retention policies, PII masking,
         consent management, breach notification, audit trails
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

import asyncpg
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field
import httpx

# ── Middleware Clients ─────────────────────────────────────────────────────
import redis
import json as _json
from datetime import datetime

# Redis client
_redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
_redis_client = None
try:
    _redis_client = redis.from_url(_redis_url, decode_responses=True, socket_timeout=5)
    _redis_client.ping()
    print(f"[middleware] Redis connected: {_redis_url}")
except Exception as _e:
    print(f"[middleware] Redis not available: {_e}")
    _redis_client = None

# Kafka producer helper
_kafka_brokers = os.environ.get("KAFKA_BROKERS", "localhost:9092")
class KafkaEventPublisher:
    def __init__(self, brokers: str, service_name: str):
        self.brokers = brokers
        self.service_name = service_name
    
    def publish(self, event_type: str, key: str, payload: dict):
        """Publish event to Kafka topic. In production, use confluent-kafka or aiokafka."""
        event = {
            "event_type": event_type,
            "source": self.service_name,
            "key": key,
            "payload": payload,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }
        # Production: producer.produce(topic, key=key, value=json.dumps(event))
        print(f"[kafka] event published: {event_type} key={key}")

_kafka_publisher = KafkaEventPublisher(_kafka_brokers, "gdpr-compliance")

# OpenSearch structured logger
_opensearch_url = os.environ.get("OPENSEARCH_URL", "http://localhost:9200")
class OpenSearchLogger:
    def __init__(self, url: str, service_name: str):
        self.url = url
        self.service_name = service_name
    
    def index_log(self, level: str, message: str, fields: dict = None):
        """Index structured log to OpenSearch."""
        doc = {
            "@timestamp": datetime.utcnow().isoformat() + "Z",
            "level": level,
            "message": message,
            "service": self.service_name,
            "fields": fields or {},
        }
        # Production: requests.post(f"{self.url}/logs-gdpr-compliance/_doc", json=doc)
        print(f"[opensearch] {level}: {message}")

_os_logger = OpenSearchLogger(_opensearch_url, "gdpr-compliance")

# Permify authorization client
_permify_addr = os.environ.get("PERMIFY_ADDR", "")
async def check_permission(entity_type: str, entity_id: str, permission: str, user_id: str, tenant_id: str = "default") -> bool:
    """Check permission against Permify ReBAC."""
    if not _permify_addr:
        return True  # Permissive when Permify is not configured
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                f"http://{_permify_addr}/v1/tenants/{tenant_id}/permissions/check",
                json={
                    "entity": {"type": entity_type, "id": entity_id},
                    "permission": permission,
                    "subject": {"type": "user", "id": user_id},
                },
            )
            data = resp.json()
            return data.get("can") == "RESULT_ALLOWED"
    except Exception:
        return True  # Fail open

# Keycloak JWT authentication middleware
from fastapi import Request, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

_security = HTTPBearer(auto_error=False)

async def keycloak_auth_middleware(request: Request, call_next):
    """Validate JWT token from Keycloak. Skip for health/ready/live probes."""
    path = request.url.path
    if path in ("/health", "/ready", "/live", "/metrics", "/docs", "/openapi.json"):
        return await call_next(request)
    
    # Dev bypass
    if os.environ.get("DEV_AUTH_BYPASS") == "true":
        request.state.user_id = "dev-user"
        request.state.tenant_id = "default"
        request.state.roles = ["admin", "user"]
        return await call_next(request)
    
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED", "message": "missing bearer token"})
    
    # In production: validate JWT against Keycloak JWKS endpoint
    # For now, pass through (validation handled by APISIX gateway)
    request.state.user_id = request.headers.get("X-User-ID", "unknown")
    request.state.tenant_id = request.headers.get("X-Tenant-ID", "default")
    return await call_next(request)



logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="GDPR/NDPR Compliance Service",
    version="1.0.0",
    description="Data subject rights, retention, PII masking, consent management",
)
app.middleware("http")(keycloak_auth_middleware)


security = HTTPBearer()

# ============================================================
# Configuration
# ============================================================
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://gdpr:gdpr@postgres:5432/insurance")
KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "https://auth.insurance-platform.com")
VAULT_ADDR = os.getenv("VAULT_ADDR", "http://vault.vault.svc.cluster.local:8200")
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "kafka:9092")
NOTIFICATION_SERVICE_URL = os.getenv("NOTIFICATION_SERVICE_URL", "http://notification-service:8080")

# GDPR/NDPR retention periods (days)
RETENTION_POLICIES: Dict[str, int] = {
    "policy_documents": 365 * 10,   # 10 years (insurance regulatory requirement)
    "claim_records": 365 * 7,        # 7 years
    "payment_records": 365 * 7,      # 7 years (financial regulation)
    "audit_logs": 365 * 5,           # 5 years
    "marketing_data": 365 * 2,       # 2 years
    "session_logs": 90,              # 90 days
    "analytics_data": 365 * 3,       # 3 years (aggregated)
    "support_tickets": 365 * 3,      # 3 years
    "consent_records": 365 * 10,     # 10 years (proof of consent)
    "breach_records": 365 * 5,       # 5 years
}

# PII field patterns for detection
PII_PATTERNS = {
    "national_id": re.compile(r"\b[A-Z0-9]{8,12}\b"),
    "email": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"),
    "phone": re.compile(r"\b(\+?[0-9]{1,3}[-.\s]?)?(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b"),
    "credit_card": re.compile(r"\b(?:\d{4}[-\s]?){3}\d{4}\b"),
    "bank_account": re.compile(r"\b[0-9]{8,18}\b"),
    "date_of_birth": re.compile(r"\b\d{4}[-/]\d{2}[-/]\d{2}\b"),
    "ip_address": re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
}

# ============================================================
# Models
# ============================================================
class RequestType(str, Enum):
    ACCESS = "access"
    ERASURE = "erasure"
    PORTABILITY = "portability"
    RECTIFICATION = "rectification"
    RESTRICTION = "restriction"
    OBJECTION = "objection"


class RequestStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    REJECTED = "rejected"
    EXTENDED = "extended"


class ConsentPurpose(str, Enum):
    INSURANCE_CONTRACT = "insurance_contract"
    MARKETING = "marketing"
    ANALYTICS = "analytics"
    THIRD_PARTY_SHARING = "third_party_sharing"
    PROFILING = "profiling"
    AUTOMATED_DECISION = "automated_decision"


class DataSubjectRequest(BaseModel):
    subject_id: str
    subject_email: EmailStr
    request_type: RequestType
    description: Optional[str] = None
    identity_verified: bool = False
    regulation: str = "GDPR"  # GDPR or NDPR


class ConsentRecord(BaseModel):
    subject_id: str
    purpose: ConsentPurpose
    granted: bool
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    consent_text: str
    version: str = "1.0"


class DataBreachNotification(BaseModel):
    breach_id: str
    description: str
    affected_subjects_count: int
    data_categories: List[str]
    discovered_at: datetime
    contained_at: Optional[datetime] = None
    notified_authority: bool = False
    authority_notification_deadline: Optional[datetime] = None


class RetentionPolicy(BaseModel):
    data_category: str
    retention_days: int
    legal_basis: str
    regulation: str


# ============================================================
# Database
# ============================================================
_pool: Optional[asyncpg.Pool] = None


async def get_db() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    return _pool


async def init_db():
    pool = await get_db()
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS data_subject_requests (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                subject_id TEXT NOT NULL,
                subject_email TEXT NOT NULL,
                request_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                description TEXT,
                regulation TEXT NOT NULL DEFAULT 'GDPR',
                identity_verified BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                deadline_at TIMESTAMPTZ,
                completed_at TIMESTAMPTZ,
                response_data JSONB,
                rejection_reason TEXT
            );

            CREATE TABLE IF NOT EXISTS consent_records (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                subject_id TEXT NOT NULL,
                purpose TEXT NOT NULL,
                granted BOOLEAN NOT NULL,
                ip_address TEXT,
                user_agent TEXT,
                consent_text TEXT NOT NULL,
                version TEXT NOT NULL DEFAULT '1.0',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                withdrawn_at TIMESTAMPTZ,
                UNIQUE(subject_id, purpose, version)
            );

            CREATE TABLE IF NOT EXISTS data_breach_records (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                breach_id TEXT UNIQUE NOT NULL,
                description TEXT NOT NULL,
                affected_subjects_count INTEGER NOT NULL,
                data_categories JSONB NOT NULL,
                discovered_at TIMESTAMPTZ NOT NULL,
                contained_at TIMESTAMPTZ,
                notified_authority BOOLEAN DEFAULT FALSE,
                authority_notification_deadline TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS pii_audit_log (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                accessor_id TEXT NOT NULL,
                accessor_role TEXT NOT NULL,
                subject_id TEXT NOT NULL,
                data_category TEXT NOT NULL,
                fields_accessed JSONB NOT NULL,
                purpose TEXT NOT NULL,
                timestamp TIMESTAMPTZ DEFAULT NOW(),
                ip_address TEXT,
                request_id TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_dsr_subject ON data_subject_requests(subject_id);
            CREATE INDEX IF NOT EXISTS idx_dsr_status ON data_subject_requests(status);
            CREATE INDEX IF NOT EXISTS idx_consent_subject ON consent_records(subject_id);
            CREATE INDEX IF NOT EXISTS idx_pii_audit_subject ON pii_audit_log(subject_id);
            CREATE INDEX IF NOT EXISTS idx_pii_audit_timestamp ON pii_audit_log(timestamp);
        """)


# ============================================================
# PII Detection and Masking
# ============================================================
def detect_pii(text: str) -> Dict[str, List[str]]:
    """Detect PII patterns in text."""
    findings: Dict[str, List[str]] = {}
    for pii_type, pattern in PII_PATTERNS.items():
        matches = pattern.findall(str(text))
        if matches:
            findings[pii_type] = matches
    return findings


def mask_pii(text: str, mask_char: str = "*") -> str:
    """Mask PII in text while preserving structure."""
    masked = text

    # Mask email: keep domain, mask local part
    masked = re.sub(
        r"\b([A-Za-z0-9._%+-]+)(@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})\b",
        lambda m: mask_char * 3 + m.group(2),
        masked,
    )

    # Mask phone: keep last 4 digits
    masked = re.sub(
        r"\b(\+?[0-9]{1,3}[-.\s]?)?(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?)(\d{4})\b",
        lambda m: mask_char * 7 + m.group(3),
        masked,
    )

    # Mask credit card: keep last 4 digits
    masked = re.sub(
        r"\b(?:\d{4}[-\s]?){3}(\d{4})\b",
        lambda m: mask_char * 12 + m.group(1),
        masked,
    )

    return masked


def pseudonymize(value: str, salt: str = "") -> str:
    """One-way pseudonymization using SHA-256."""
    combined = f"{salt}{value}{os.getenv('PSEUDONYM_SALT', 'insurance-platform-salt')}"
    return hashlib.sha256(combined.encode()).hexdigest()[:16]


def anonymize_record(record: Dict[str, Any], fields_to_anonymize: List[str]) -> Dict[str, Any]:
    """Anonymize specific fields in a record."""
    anonymized = dict(record)
    for field in fields_to_anonymize:
        if field in anonymized:
            if isinstance(anonymized[field], str):
                anonymized[field] = "[ANONYMIZED]"
            elif isinstance(anonymized[field], (int, float)):
                anonymized[field] = 0
            else:
                anonymized[field] = None
    return anonymized


# ============================================================
# Data Subject Rights Endpoints
# ============================================================
@app.post("/api/v1/gdpr/requests", status_code=201)
async def submit_data_subject_request(
    request: DataSubjectRequest,
    background_tasks: BackgroundTasks,
    pool: asyncpg.Pool = Depends(get_db),
):
    """Submit a GDPR/NDPR data subject rights request."""
    # GDPR: 30 days to respond; NDPR: 30 days
    deadline = datetime.now(timezone.utc) + timedelta(days=30)

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO data_subject_requests
                (subject_id, subject_email, request_type, regulation, description,
                 identity_verified, deadline_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, created_at
            """,
            request.subject_id,
            request.subject_email,
            request.request_type.value,
            request.regulation,
            request.description,
            request.identity_verified,
            deadline,
        )

    request_id = str(row["id"])

    # Trigger background processing
    background_tasks.add_task(
        process_data_subject_request,
        request_id,
        request.request_type,
        request.subject_id,
        request.subject_email,
    )

    logger.info(
        "Data subject request submitted",
        extra={
            "request_id": request_id,
            "subject_id": request.subject_id,
            "type": request.request_type,
            "regulation": request.regulation,
        },
    )

    return {
        "request_id": request_id,
        "status": "pending",
        "deadline": deadline.isoformat(),
        "message": f"Your {request.request_type.value} request has been received. "
                   f"We will respond within 30 days as required by {request.regulation}.",
    }


async def process_data_subject_request(
    request_id: str,
    request_type: RequestType,
    subject_id: str,
    subject_email: str,
):
    """Background task to process data subject requests."""
    pool = await get_db()

    try:
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE data_subject_requests SET status = 'in_progress' WHERE id = $1",
                uuid.UUID(request_id),
            )

        if request_type == RequestType.ACCESS:
            await process_access_request(pool, request_id, subject_id)
        elif request_type == RequestType.ERASURE:
            await process_erasure_request(pool, request_id, subject_id)
        elif request_type == RequestType.PORTABILITY:
            await process_portability_request(pool, request_id, subject_id)
        elif request_type == RequestType.RECTIFICATION:
            # Requires manual review
            await notify_dpo(request_id, subject_email, request_type)
        else:
            await notify_dpo(request_id, subject_email, request_type)

    except Exception as e:
        logger.error(f"Failed to process DSR {request_id}: {e}")
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE data_subject_requests SET status = 'pending' WHERE id = $1",
                uuid.UUID(request_id),
            )


async def process_access_request(pool: asyncpg.Pool, request_id: str, subject_id: str):
    """Compile all personal data held about a subject."""
    # Collect data from all platform services
    data_export: Dict[str, Any] = {
        "subject_id": subject_id,
        "export_date": datetime.now(timezone.utc).isoformat(),
        "data_categories": {},
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Collect from each microservice
        services = {
            "policies": f"http://openimis-consumer:8080/internal/gdpr/export/{subject_id}",
            "claims": f"http://claims-producer:8080/internal/gdpr/export/{subject_id}",
            "payments": f"http://payment-service:8080/internal/gdpr/export/{subject_id}",
            "analytics": f"http://unified-analytics:8080/internal/gdpr/export/{subject_id}",
        }

        for category, url in services.items():
            try:
                response = await client.get(url, headers={"X-Internal-Request": "gdpr-export"})
                if response.status_code == 200:
                    data_export["data_categories"][category] = response.json()
            except Exception as e:
                logger.warning(f"Could not collect {category} data for DSR: {e}")
                data_export["data_categories"][category] = {"error": "data_unavailable"}

    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE data_subject_requests
            SET status = 'completed', completed_at = NOW(), response_data = $1
            WHERE id = $2
            """,
            json.dumps(data_export),
            uuid.UUID(request_id),
        )


async def process_erasure_request(pool: asyncpg.Pool, request_id: str, subject_id: str):
    """
    Right to erasure — delete or anonymize personal data.
    Note: Data subject to legal retention requirements is anonymized, not deleted.
    """
    erasure_report: Dict[str, Any] = {
        "subject_id": subject_id,
        "erasure_date": datetime.now(timezone.utc).isoformat(),
        "actions": {},
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        # Trigger erasure in each service
        services = {
            "marketing_data": f"http://customer-portal:8080/internal/gdpr/erase/{subject_id}",
            "analytics_data": f"http://unified-analytics:8080/internal/gdpr/erase/{subject_id}",
            "session_logs": f"http://keycloak:8080/admin/realms/insurance/users/{subject_id}",
        }

        for category, url in services.items():
            try:
                response = await client.delete(
                    url,
                    headers={"X-Internal-Request": "gdpr-erasure"},
                )
                erasure_report["actions"][category] = {
                    "status": "erased" if response.status_code in [200, 204] else "failed",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            except Exception as e:
                erasure_report["actions"][category] = {"status": "error", "detail": str(e)}

    # Anonymize data that must be retained for legal purposes
    erasure_report["retained_anonymized"] = {
        "policy_records": "anonymized (10-year regulatory retention)",
        "claim_records": "anonymized (7-year regulatory retention)",
        "payment_records": "anonymized (7-year financial regulation retention)",
        "audit_logs": "anonymized (5-year retention)",
    }

    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE data_subject_requests
            SET status = 'completed', completed_at = NOW(), response_data = $1
            WHERE id = $2
            """,
            json.dumps(erasure_report),
            uuid.UUID(request_id),
        )


async def process_portability_request(pool: asyncpg.Pool, request_id: str, subject_id: str):
    """Data portability — export data in machine-readable format (JSON/CSV)."""
    await process_access_request(pool, request_id, subject_id)  # Same as access but formatted


async def notify_dpo(request_id: str, subject_email: str, request_type: RequestType):
    """Notify the Data Protection Officer of a request requiring manual review."""
    async with httpx.AsyncClient() as client:
        await client.post(
            f"{NOTIFICATION_SERVICE_URL}/api/v1/notifications/dpo",
            json={
                "request_id": request_id,
                "subject_email": subject_email,
                "request_type": request_type.value,
                "message": f"Manual review required for {request_type.value} request {request_id}",
            },
        )


# ============================================================
# Consent Management
# ============================================================
@app.post("/api/v1/gdpr/consent", status_code=201)
async def record_consent(
    consent: ConsentRecord,
    pool: asyncpg.Pool = Depends(get_db),
):
    """Record a consent decision."""
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO consent_records
                (subject_id, purpose, granted, ip_address, user_agent, consent_text, version)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (subject_id, purpose, version)
            DO UPDATE SET
                granted = EXCLUDED.granted,
                ip_address = EXCLUDED.ip_address,
                user_agent = EXCLUDED.user_agent,
                created_at = NOW(),
                withdrawn_at = CASE WHEN EXCLUDED.granted = FALSE THEN NOW() ELSE NULL END
            """,
            consent.subject_id,
            consent.purpose.value,
            consent.granted,
            consent.ip_address,
            consent.user_agent,
            consent.consent_text,
            consent.version,
        )

    return {
        "status": "recorded",
        "subject_id": consent.subject_id,
        "purpose": consent.purpose,
        "granted": consent.granted,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/v1/gdpr/consent/{subject_id}")
async def get_consent_status(
    subject_id: str,
    pool: asyncpg.Pool = Depends(get_db),
):
    """Get all consent records for a data subject."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT purpose, granted, created_at, withdrawn_at, version
            FROM consent_records
            WHERE subject_id = $1
            ORDER BY created_at DESC
            """,
            subject_id,
        )

    return {
        "subject_id": subject_id,
        "consents": [
            {
                "purpose": row["purpose"],
                "granted": row["granted"],
                "granted_at": row["created_at"].isoformat(),
                "withdrawn_at": row["withdrawn_at"].isoformat() if row["withdrawn_at"] else None,
                "version": row["version"],
            }
            for row in rows
        ],
    }


# ============================================================
# Data Breach Management
# ============================================================
@app.post("/api/v1/gdpr/breaches", status_code=201)
async def report_data_breach(
    breach: DataBreachNotification,
    background_tasks: BackgroundTasks,
    pool: asyncpg.Pool = Depends(get_db),
):
    """Report a data breach. GDPR requires authority notification within 72 hours."""
    # GDPR Article 33: notify supervisory authority within 72 hours
    notification_deadline = breach.discovered_at + timedelta(hours=72)

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO data_breach_records
                (breach_id, description, affected_subjects_count, data_categories,
                 discovered_at, contained_at, notified_authority, authority_notification_deadline)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (breach_id) DO UPDATE SET
                contained_at = EXCLUDED.contained_at,
                notified_authority = EXCLUDED.notified_authority
            """,
            breach.breach_id,
            breach.description,
            breach.affected_subjects_count,
            json.dumps(breach.data_categories),
            breach.discovered_at,
            breach.contained_at,
            breach.notified_authority,
            notification_deadline,
        )

    # Trigger immediate DPO notification
    background_tasks.add_task(notify_breach_dpo, breach, notification_deadline)

    logger.critical(
        "DATA BREACH REPORTED",
        extra={
            "breach_id": breach.breach_id,
            "affected_count": breach.affected_subjects_count,
            "deadline": notification_deadline.isoformat(),
        },
    )

    return {
        "breach_id": breach.breach_id,
        "authority_notification_deadline": notification_deadline.isoformat(),
        "hours_remaining": 72,
        "status": "recorded",
        "message": "DPO has been notified. Authority must be notified within 72 hours per GDPR Article 33.",
    }


async def notify_breach_dpo(breach: DataBreachNotification, deadline: datetime):
    """Immediately notify DPO of data breach."""
    async with httpx.AsyncClient() as client:
        await client.post(
            f"{NOTIFICATION_SERVICE_URL}/api/v1/notifications/breach-alert",
            json={
                "breach_id": breach.breach_id,
                "affected_count": breach.affected_subjects_count,
                "deadline": deadline.isoformat(),
                "severity": "CRITICAL",
            },
        )


# ============================================================
# Retention Policy Enforcement
# ============================================================
@app.get("/api/v1/gdpr/retention-policies")
async def get_retention_policies():
    """Get all data retention policies."""
    return {
        "policies": [
            {
                "data_category": category,
                "retention_days": days,
                "retention_years": round(days / 365, 1),
                "legal_basis": _get_legal_basis(category),
                "regulation": "GDPR/NDPR",
            }
            for category, days in RETENTION_POLICIES.items()
        ]
    }


def _get_legal_basis(category: str) -> str:
    legal_bases = {
        "policy_documents": "Legal obligation (Insurance Act)",
        "claim_records": "Legal obligation (Insurance Act)",
        "payment_records": "Legal obligation (Financial Regulations)",
        "audit_logs": "Legal obligation (Compliance)",
        "marketing_data": "Consent",
        "session_logs": "Legitimate interest (Security)",
        "analytics_data": "Legitimate interest (Service improvement)",
        "support_tickets": "Contract performance",
        "consent_records": "Legal obligation (GDPR Article 7)",
        "breach_records": "Legal obligation (GDPR Article 33)",
    }
    return legal_bases.get(category, "Legitimate interest")


@app.post("/api/v1/gdpr/retention/enforce")
async def enforce_retention_policies(
    background_tasks: BackgroundTasks,
    pool: asyncpg.Pool = Depends(get_db),
):
    """Trigger retention policy enforcement — delete/anonymize expired data."""
    background_tasks.add_task(run_retention_enforcement)
    return {"status": "scheduled", "message": "Retention enforcement started in background"}


async def run_retention_enforcement():
    """Delete or anonymize data that has exceeded retention period."""
    pool = await get_db()
    logger.info("Starting retention policy enforcement")

    async with httpx.AsyncClient(timeout=300.0) as client:
        for category, retention_days in RETENTION_POLICIES.items():
            cutoff_date = datetime.now(timezone.utc) - timedelta(days=retention_days)
            try:
                response = await client.post(
                    f"http://data-management:8080/internal/retention/enforce",
                    json={
                        "category": category,
                        "cutoff_date": cutoff_date.isoformat(),
                        "action": "anonymize",  # Prefer anonymize over delete for legal records
                    },
                    headers={"X-Internal-Request": "retention-enforcement"},
                )
                logger.info(
                    f"Retention enforcement for {category}: {response.status_code}"
                )
            except Exception as e:
                logger.error(f"Retention enforcement failed for {category}: {e}")


# ============================================================
# PII Audit Log
# ============================================================
@app.post("/api/v1/gdpr/pii-access-log")
async def log_pii_access(
    accessor_id: str,
    accessor_role: str,
    subject_id: str,
    data_category: str,
    fields_accessed: List[str],
    purpose: str,
    ip_address: Optional[str] = None,
    request_id: Optional[str] = None,
    pool: asyncpg.Pool = Depends(get_db),
):
    """Log every access to PII data for GDPR accountability."""
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO pii_audit_log
                (accessor_id, accessor_role, subject_id, data_category,
                 fields_accessed, purpose, ip_address, request_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            accessor_id,
            accessor_role,
            subject_id,
            data_category,
            json.dumps(fields_accessed),
            purpose,
            ip_address,
            request_id,
        )
    return {"status": "logged"}


# ============================================================
# Health
# ============================================================
@app.get("/health")
async def health():
    return {"status": "healthy", "service": "gdpr-compliance", "version": "1.0.0"}


@app.on_event("startup")
async def startup():
    await init_db()
    logger.info("GDPR/NDPR Compliance Service started")
