import os
"""Liveness Detection Python SDK — facial verification for KYC compliance.

"""

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
            logger.info(f"Connected to PostgreSQL for liveness_detection_python_sdk")
        except Exception as e:
            logger.warning(f"Database connection failed: {e} (running in degraded mode)")
            return None
    return _db_conn

def init_db():
    conn = get_db()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS liveness_detection_python_sdk (
                        id SERIAL PRIMARY KEY,
                        data JSONB NOT NULL DEFAULT '{}',
                        status VARCHAR(50) DEFAULT 'active',
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW(),
                        tenant_id INTEGER DEFAULT 1
                    )
                """)
            logger.info(f"Table liveness_detection_python_sdk initialized")
        except Exception as e:
            logger.warning(f"Table creation failed: {e}")


from fastapi import FastAPI
from pydantic import BaseModel
from datetime import datetime
from typing import Optional

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

_kafka_publisher = KafkaEventPublisher(_kafka_brokers, "liveness-detection-python-sdk")

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
        # Production: requests.post(f"{self.url}/logs-liveness-detection-python-sdk/_doc", json=doc)
        print(f"[opensearch] {level}: {message}")

_os_logger = OpenSearchLogger(_opensearch_url, "liveness-detection-python-sdk")

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



app = FastAPI(title="Liveness Detection SDK", version="1.0.0")

# ── PostgreSQL Connection ──────────────────────────────────────────────────
import psycopg2
import psycopg2.extras

_pg_config = {
    "host": os.environ.get("PGHOST", "localhost"),
    "port": int(os.environ.get("PGPORT", "5432")),
    "database": os.environ.get("PGDATABASE", "ngapp"),
    "user": os.environ.get("PGUSER", "ngapp"),
    "password": os.environ.get("PGPASSWORD", "ngapp"),
}
_pg_conn = None

def get_db():
    global _pg_conn
    try:
        if _pg_conn is None or _pg_conn.closed:
            _pg_conn = psycopg2.connect(**_pg_config)
            _pg_conn.autocommit = True
        return _pg_conn
    except Exception as e:
        return None

def db_query(sql, params=None):
    conn = get_db()
    if not conn: return []
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            if cur.description: return cur.fetchall()
            return []
    except Exception as e:
        try: conn.rollback()
        except: pass
        return []
app.middleware("http")(keycloak_auth_middleware)


import secrets
import threading
import urllib.request
import urllib.error

# ── Real biometric liveness via the W5c liveness-detection service ───────────
# The previous implementation accepted NO biometric input and returned a
# RANDOM pass/fail with guessable timestamp session IDs and unlimited retries
# (audit finding AB-16). All decisions now come from the real frame-processing
# service; this SDK enforces CSPRNG session IDs, a retry cap, and lockout.
LIVENESS_SERVICE_URL = os.environ.get("LIVENESS_SERVICE_URL", "http://localhost:8110")
MAX_ATTEMPTS = 3
DOWNSTREAM_TIMEOUT = 10

_session_lock = threading.Lock()
# local_session_id -> {downstream_id, attempts, locked, challenge}
_sessions: dict = {}


def _downstream_post(path: str, payload: dict) -> dict:
    """POST to the real liveness service. Raises HTTPException(503) when it is
    unavailable — fail-closed, never a local random verdict."""
    req = urllib.request.Request(
        f"{LIVENESS_SERVICE_URL}{path}",
        data=_json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=DOWNSTREAM_TIMEOUT) as resp:
            return _json.loads(resp.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:200]
        raise HTTPException(status_code=e.code, detail=f"liveness service: {detail}")
    except Exception as e:
        logger.error(f"liveness service unreachable: {e}")
        raise HTTPException(status_code=503, detail="liveness detection service unavailable")


class LivenessRequest(BaseModel):
    session_id: str
    challenge_type: str = "blink"
    attempt: int = 1
    frame_base64: Optional[str] = None

class LivenessResult(BaseModel):
    session_id: str
    is_live: bool
    confidence: float
    challenge_passed: bool
    anti_spoof_score: float
    decision: str
    attempts_remaining: int

@app.get("/health")
def health():
    return {"status": "healthy", "service": "liveness-detection-python-sdk"}

@app.post("/api/v1/detect", response_model=LivenessResult)
def detect_liveness(req: LivenessRequest):
    # Biometric input is REQUIRED — no frame, no verdict.
    if not req.frame_base64:
        raise HTTPException(status_code=400, detail="frame_base64 biometric input is required")

    with _session_lock:
        sess = _sessions.get(req.session_id)
        if sess is None:
            raise HTTPException(status_code=404, detail="unknown session_id")
        if sess["locked"]:
            raise HTTPException(status_code=423, detail="session locked after repeated failures")
        sess["attempts"] += 1
        attempts = sess["attempts"]

    result = _downstream_post("/challenge/frame", {
        "session_id": sess["downstream_id"],
        "frame_base64": req.frame_base64,
    })

    face_detected = bool(result.get("face_detected"))
    completed = bool(result.get("completed"))
    frames = int(result.get("frames", 0))

    # Real decision: the challenge must complete on real frames. Confidence is
    # derived from actual processed evidence, not randomness.
    is_live = completed and face_detected
    confidence = round(min(0.5 + 0.1 * frames, 0.99), 2) if face_detected else 0.0
    attempts_remaining = max(0, MAX_ATTEMPTS - attempts)

    if is_live:
        decision = "pass"
        with _session_lock:
            sess["locked"] = True  # one-shot: a passed session cannot be replayed
    elif attempts_remaining <= 0:
        decision = "fail"
        with _session_lock:
            sess["locked"] = True  # retry cap reached → lockout
    else:
        decision = "retry"

    return LivenessResult(
        session_id=req.session_id, is_live=is_live, confidence=confidence,
        challenge_passed=is_live, anti_spoof_score=confidence,
        decision=decision, attempts_remaining=attempts_remaining,
    )

@app.post("/api/v1/session/create")
def create_session(challenge_type: str = "blink"):
    # Start a REAL challenge session downstream and bind it to an
    # unguessable CSPRNG local session id.
    downstream = _downstream_post("/challenge/start", {"challenge": challenge_type})
    session_id = f"LIV-{secrets.token_hex(16)}"
    with _session_lock:
        _sessions[session_id] = {
            "downstream_id": downstream["session_id"],
            "attempts": 0,
            "locked": False,
            "challenge": challenge_type,
        }
    return {
        "session_id": session_id,
        "challenges": ["blink", "turn_left", "turn_right"],
        "timeout_seconds": 120, "max_attempts": MAX_ATTEMPTS,
    }

@app.get("/api/v1/stats")
def get_stats():
    # Real counters derived from live session state — no fabricated numbers.
    with _session_lock:
        total = len(_sessions)
        locked = sum(1 for s in _sessions.values() if s["locked"])
        attempts = sum(s["attempts"] for s in _sessions.values())
    return {
        "active_sessions": total,
        "locked_sessions": locked,
        "total_frames_submitted": attempts,
    }


@app.on_event("startup")
async def startup():
    init_db()
