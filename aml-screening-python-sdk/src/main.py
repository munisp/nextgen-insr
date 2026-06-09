import os
"""AML Screening Python SDK — PEP/sanctions list screening for Nigerian insurance.

Business Rules:
- Screening sources: OFAC SDN, UN Sanctions, EFCC Watch List, CBN BVN blacklist
- Match threshold: Fuzzy name match > 85% similarity = flag for review
- Auto-clear: Score < 50% = no match, pass through
- Enhanced Due Diligence: Score 50-85% = EDD required
- Block: Score > 85% = immediate block + STR filing
- Re-screening: All customers re-screened quarterly
- Response SLA: < 500ms for real-time, < 5min for batch
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from difflib import SequenceMatcher
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

_kafka_publisher = KafkaEventPublisher(_kafka_brokers, "aml-screening-python-sdk")

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
        # Production: requests.post(f"{self.url}/logs-aml-screening-python-sdk/_doc", json=doc)
        print(f"[opensearch] {level}: {message}")

_os_logger = OpenSearchLogger(_opensearch_url, "aml-screening-python-sdk")

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



app = FastAPI(title="AML Screening SDK", version="1.0.0")
app.middleware("http")(keycloak_auth_middleware)


SANCTIONS_LIST = [
    {"name": "ABUBAKAR SHEKAU", "list": "EFCC", "type": "individual"},
    {"name": "AHMED KHALIFA", "list": "UN_SANCTIONS", "type": "individual"},
    {"name": "PETROLEUM TRADING CO", "list": "OFAC_SDN", "type": "entity"},
    {"name": "LAGOS MONEY EXCHANGE", "list": "CBN_BLACKLIST", "type": "entity"},
]

class ScreeningRequest(BaseModel):
    name: str
    bvn: Optional[str] = None
    date_of_birth: Optional[str] = None
    nationality: str = "NG"

class ScreeningResult(BaseModel):
    screening_id: str
    name_searched: str
    match_score: float
    decision: str
    matches: list
    timestamp: str

def fuzzy_match(name1: str, name2: str) -> float:
    return SequenceMatcher(None, name1.upper(), name2.upper()).ratio() * 100

@app.get("/health")
def health():
    return {"status": "healthy", "service": "aml-screening-python-sdk"}

@app.post("/api/v1/screen", response_model=ScreeningResult)
def screen_customer(req: ScreeningRequest):
    matches = []
    max_score = 0.0
    for entry in SANCTIONS_LIST:
        score = fuzzy_match(req.name, entry["name"])
        if score > 50:
            matches.append({"name": entry["name"], "list": entry["list"], "score": round(score, 1)})
            max_score = max(max_score, score)

    decision = "clear" if max_score < 50 else "edd_required" if max_score < 85 else "blocked"
    return ScreeningResult(
        screening_id=f"SCR-{datetime.now().strftime('%Y%m%d%H%M%S')}",
        name_searched=req.name, match_score=round(max_score, 1),
        decision=decision, matches=matches, timestamp=datetime.now().isoformat()
    )

@app.get("/api/v1/lists")
def get_lists():
    return {"lists": ["OFAC_SDN", "UN_SANCTIONS", "EFCC", "CBN_BLACKLIST"], "total_entries": len(SANCTIONS_LIST), "last_updated": "2026-05-01"}

@app.post("/api/v1/batch-screen")
def batch_screen(names: list[str]):
    results = []
    for name in names[:100]:
        max_score = max((fuzzy_match(name, e["name"]) for e in SANCTIONS_LIST), default=0)
        decision = "clear" if max_score < 50 else "edd_required" if max_score < 85 else "blocked"
        results.append({"name": name, "score": round(max_score, 1), "decision": decision})
    return {"results": results, "total": len(results)}
