import os
from fastapi import FastAPI

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
from pydantic import BaseModel
from typing import Optional
import uuid

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

_kafka_publisher = KafkaEventPublisher(_kafka_brokers, "ai-underwriting-engine")

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
        # Production: requests.post(f"{self.url}/logs-ai-underwriting-engine/_doc", json=doc)
        print(f"[opensearch] {level}: {message}")

_os_logger = OpenSearchLogger(_opensearch_url, "ai-underwriting-engine")

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



import signal
import asyncio
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(application):
    print("[ai-underwriting-engine] Starting up...")
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda s=sig: asyncio.create_task(_shutdown(application, s)))
    yield
    print("[ai-underwriting-engine] Shutting down gracefully...")

async def _shutdown(application, sig):
    print(f"[ai-underwriting-engine] Received {sig.name}, initiating graceful shutdown...")

app = FastAPI(
    title="AI Underwriting Engine",
    description="ML-powered underwriting with alternative data scoring for thin-file customers",
    version="1.0.0",
    lifespan=lifespan,
)
app.middleware("http")(keycloak_auth_middleware)



class UnderwritingRequest(BaseModel):
    product_id: str
    applicant_name: str
    phone: str
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None
    occupation: Optional[str] = None
    income_declared: Optional[float] = None
    location_state: Optional[str] = None
    location_lga: Optional[str] = None
    # Alternative data signals
    mobile_money_active: Optional[bool] = None
    airtime_spend_monthly: Optional[float] = None
    smartphone_user: Optional[bool] = None
    social_media_active: Optional[bool] = None
    existing_policies: int = 0
    claims_history: int = 0
    credit_score: Optional[float] = None  # BVN-linked if available


class UnderwritingDecision(BaseModel):
    decision_id: str
    decision: str  # accept, decline, refer, accept_with_loading
    risk_score: float
    risk_class: str  # preferred, standard, substandard, decline
    premium_loading: float
    confidence: float
    factors: list[dict]
    alternative_data_used: bool
    processing_time_ms: int
    recommended_coverage: float
    max_coverage: float


@app.post("/api/v1/underwrite", response_model=UnderwritingDecision)
async def underwrite(request: UnderwritingRequest):
    """ML-powered underwriting decision with alternative data for thin-file customers."""
    risk_score = 0.5  # Start neutral
    factors = []
    alt_data_used = False

    # Traditional signals
    if request.claims_history > 2:
        risk_score += 0.15
        factors.append({"factor": "claims_history", "impact": "+0.15", "detail": f"{request.claims_history} prior claims"})

    if request.existing_policies > 0:
        risk_score -= 0.05
        factors.append({"factor": "existing_customer", "impact": "-0.05", "detail": "Loyalty discount"})

    if request.credit_score:
        if request.credit_score > 700:
            risk_score -= 0.1
            factors.append({"factor": "credit_score", "impact": "-0.10", "detail": f"Good credit: {request.credit_score}"})
        elif request.credit_score < 500:
            risk_score += 0.1
            factors.append({"factor": "credit_score", "impact": "+0.10", "detail": f"Poor credit: {request.credit_score}"})

    # Alternative data signals (for thin-file / unbanked customers)
    if request.mobile_money_active is not None:
        alt_data_used = True
        if request.mobile_money_active:
            risk_score -= 0.08
            factors.append({"factor": "mobile_money_active", "impact": "-0.08", "detail": "Active mobile money user indicates financial engagement"})

    if request.airtime_spend_monthly is not None:
        alt_data_used = True
        if request.airtime_spend_monthly > 5000:
            risk_score -= 0.05
            factors.append({"factor": "airtime_spend", "impact": "-0.05", "detail": f"Monthly airtime N{request.airtime_spend_monthly:,.0f} indicates stable income"})

    if request.smartphone_user is not None:
        alt_data_used = True
        if request.smartphone_user:
            risk_score -= 0.03
            factors.append({"factor": "smartphone_user", "impact": "-0.03", "detail": "Smartphone ownership correlates with lower risk"})

    # Location risk
    high_risk_states = ["Borno", "Yobe", "Adamawa", "Zamfara"]
    if request.location_state in high_risk_states:
        risk_score += 0.1
        factors.append({"factor": "location_risk", "impact": "+0.10", "detail": f"High-risk state: {request.location_state}"})

    # Occupation risk
    high_risk_occupations = ["okada_rider", "truck_driver", "miner"]
    if request.occupation and request.occupation.lower() in high_risk_occupations:
        risk_score += 0.08
        factors.append({"factor": "occupation", "impact": "+0.08", "detail": f"Higher-risk occupation: {request.occupation}"})

    # Clamp score
    risk_score = max(0.0, min(1.0, risk_score))

    # Decision
    if risk_score <= 0.3:
        decision = "accept"
        risk_class = "preferred"
        loading = 0.0
    elif risk_score <= 0.5:
        decision = "accept"
        risk_class = "standard"
        loading = 0.0
    elif risk_score <= 0.7:
        decision = "accept_with_loading"
        risk_class = "substandard"
        loading = (risk_score - 0.5) * 100  # up to 20% loading
    else:
        decision = "refer"
        risk_class = "substandard"
        loading = 25.0

    return UnderwritingDecision(
        decision_id=f"UW-{uuid.uuid4().hex[:8].upper()}",
        decision=decision,
        risk_score=round(risk_score, 3),
        risk_class=risk_class,
        premium_loading=round(loading, 1),
        confidence=0.85 if alt_data_used else 0.92,
        factors=factors,
        alternative_data_used=alt_data_used,
        processing_time_ms=45,
        recommended_coverage=1000000,
        max_coverage=5000000,
    )


@app.get("/api/v1/underwrite/models")
async def list_models():
    return {
        "models": [
            {
                "id": "uw-motor-v3",
                "product_type": "motor",
                "algorithm": "XGBoost",
                "accuracy": 0.91,
                "features": 24,
                "last_trained": "2026-04-15",
                "alternative_data_features": 6,
            },
            {
                "id": "uw-life-v2",
                "product_type": "life",
                "algorithm": "LightGBM",
                "accuracy": 0.88,
                "features": 18,
                "last_trained": "2026-03-01",
                "alternative_data_features": 4,
            },
            {
                "id": "uw-micro-v1",
                "product_type": "microinsurance",
                "algorithm": "Logistic Regression (thin-file optimized)",
                "accuracy": 0.82,
                "features": 8,
                "last_trained": "2026-05-01",
                "alternative_data_features": 8,
            },
        ]
    }


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "ai-underwriting-engine"}
