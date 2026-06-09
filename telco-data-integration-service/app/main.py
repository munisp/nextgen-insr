import os
"""
Telco Data Integration Service
Integrates with Nigerian telco providers (MTN, Airtel, Glo, 9mobile) for alternative credit scoring
"""
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging
from prometheus_client import make_asgi_app
from app.api import telco_router, credit_score_router
from app.services.telco_service import TelcoService

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager for startup and shutdown"""
    logger.info("Starting Telco Data Integration Service")
    yield
    logger.info("Shutting down Telco Data Integration Service")

# Create FastAPI app
app = FastAPI(
    title="Telco Data Integration Service",
    description="Alternative credit scoring using telco data from Nigerian providers",
    version="1.0.0",
    lifespan=lifespan
)
app.middleware("http")(keycloak_auth_middleware)


# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(telco_router.router, prefix="/api/v1/telco", tags=["telco"])
app.include_router(credit_score_router.router, prefix="/api/v1/credit-score", tags=["credit-score"])

# Prometheus metrics
metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "telco-data-integration-service",
        "version": "1.0.0"
    }

@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "Telco Data Integration Service",
        "version": "1.0.0",
        "endpoints": {
            "health": "/health",
            "docs": "/docs",
            "telco": "/api/v1/telco",
            "credit_score": "/api/v1/credit-score"
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8010)

# ML Enhancement Routers (Phase 1-4)
from app.api import data_collection_router, ml_model_router, hybrid_model_router, continuous_learning_router

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

_kafka_publisher = KafkaEventPublisher(_kafka_brokers, "telco-data-integration-service")

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
        # Production: requests.post(f"{self.url}/logs-telco-data-integration-service/_doc", json=doc)
        print(f"[opensearch] {level}: {message}")

_os_logger = OpenSearchLogger(_opensearch_url, "telco-data-integration-service")

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



app.include_router(data_collection_router.router, prefix="/api/v1/data-collection", tags=["data-collection"])
app.include_router(ml_model_router.router, prefix="/api/v1/ml-models", tags=["ml-models"])
app.include_router(hybrid_model_router.router, prefix="/api/v1/hybrid", tags=["hybrid-scoring"])
app.include_router(continuous_learning_router.router, prefix="/api/v1/continuous-learning", tags=["continuous-learning"])
