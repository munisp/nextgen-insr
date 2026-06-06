"""KYC/KYB Verification System - Identity verification and business due diligence."""
import os
import json
import logging
import re
from dataclasses import dataclass, asdict
from enum import Enum
from http.server import HTTPServer, BaseHTTPRequestHandler


import os
import psycopg2
import psycopg2.extras
import logging

logger = logging.getLogger(__name__)

# ── Database Connection ──────────────────────────────────────────────────────
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://ngapp:ngapp@localhost:5432/ngapp")
_db_conn = None

def get_db():
    global _db_conn
    if _db_conn is None or _db_conn.closed:
        try:
            _db_conn = psycopg2.connect(DATABASE_URL)
            _db_conn.autocommit = True
            logger.info(f"Connected to PostgreSQL for {svc_name}")
        except Exception as e:
            logger.warning(f"Database connection failed: {e} (running in degraded mode)")
            return None
    return _db_conn

def init_db():
    conn = get_db()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute(f"""
                    CREATE TABLE IF NOT EXISTS {svc_name} (
                        id SERIAL PRIMARY KEY,
                        data JSONB NOT NULL DEFAULT '{{}}',
                        status VARCHAR(50) DEFAULT 'active',
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW(),
                        tenant_id INTEGER DEFAULT 1
                    )
                """)
            logger.info(f"Table {svc_name} initialized")
        except Exception as e:
            logger.warning(f"Table creation failed: {e}")


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("kyc-kyb-system")

PORT = int(os.getenv("PORT", "8092"))


class VerificationStatus(str, Enum):
    PENDING = "pending"
    VERIFIED = "verified"
    FAILED = "failed"
    REQUIRES_MANUAL = "requires_manual_review"


class KYCTier(str, Enum):
    TIER1 = "tier1"  # Basic: phone only
    TIER2 = "tier2"  # Standard: BVN + ID
    TIER3 = "tier3"  # Enhanced: Full docs


@dataclass
class VerificationResult:
    customer_id: str
    status: VerificationStatus
    tier: KYCTier
    checks_passed: list
    checks_failed: list
    risk_flags: list
    next_steps: list


def validate_bvn(bvn: str) -> bool:
    """Validate Nigerian Bank Verification Number format."""
    return bool(re.match(r"^\d{11}$", bvn))


def validate_nin(nin: str) -> bool:
    """Validate Nigerian National Identification Number."""
    return bool(re.match(r"^\d{11}$", nin))


def validate_phone(phone: str) -> bool:
    """Validate Nigerian phone number."""
    return bool(re.match(r"^\+234[0-9]{10}$", phone))


def verify_customer(data: dict) -> VerificationResult:
    """Perform KYC verification based on submitted documents."""
    customer_id = data.get("customer_id", "unknown")
    bvn = data.get("bvn", "")
    nin = data.get("nin", "")
    phone = data.get("phone", "")
    id_document = data.get("id_document_type", "")
    utility_bill = data.get("has_utility_bill", False)
    selfie_verified = data.get("selfie_match_score", 0) > 0.85

    checks_passed = []
    checks_failed = []
    risk_flags = []
    next_steps = []

    # Phone verification (Tier 1)
    if phone and validate_phone(phone):
        checks_passed.append("phone_format_valid")
    elif phone:
        checks_failed.append("invalid_phone_format")

    # BVN verification (Tier 2)
    if bvn:
        if validate_bvn(bvn):
            checks_passed.append("bvn_format_valid")
        else:
            checks_failed.append("invalid_bvn_format")
    else:
        next_steps.append("submit_bvn")

    # NIN verification (Tier 3)
    if nin:
        if validate_nin(nin):
            checks_passed.append("nin_format_valid")
        else:
            checks_failed.append("invalid_nin_format")

    # ID document
    valid_docs = ["national_id", "international_passport", "drivers_license", "voters_card"]
    if id_document in valid_docs:
        checks_passed.append(f"id_document:{id_document}")
    elif id_document:
        checks_failed.append(f"unsupported_document_type:{id_document}")
    else:
        next_steps.append("submit_id_document")

    # Utility bill (address verification)
    if utility_bill:
        checks_passed.append("utility_bill_provided")

    # Selfie/biometric
    if selfie_verified:
        checks_passed.append("biometric_selfie_match")
    else:
        risk_flags.append("selfie_verification_failed")

    # Determine tier
    if len(checks_passed) >= 5 and nin and utility_bill:
        tier = KYCTier.TIER3
    elif bvn and id_document:
        tier = KYCTier.TIER2
    else:
        tier = KYCTier.TIER1

    # Determine status
    if checks_failed:
        status = VerificationStatus.FAILED
    elif risk_flags:
        status = VerificationStatus.REQUIRES_MANUAL
    elif len(checks_passed) >= 3:
        status = VerificationStatus.VERIFIED
    else:
        status = VerificationStatus.PENDING

    return VerificationResult(
        customer_id=customer_id,
        status=status,
        tier=tier,
        checks_passed=checks_passed,
        checks_failed=checks_failed,
        risk_flags=risk_flags,
        next_steps=next_steps,
    )


class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "healthy", "service": "kyc-kyb-system"}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/api/v1/kyc/verify":
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length))
            result = verify_customer(body)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(asdict(result), default=str).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        logger.info(f"{self.client_address[0]} - {format % args}")


init_db()

if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), RequestHandler)
    logger.info(f"KYC/KYB System running on port {PORT}")
    server.serve_forever()
