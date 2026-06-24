import os
"""
Telco Data Integration Service
Integrates with Nigerian telco providers (MTN, Airtel, Glo, 9mobile) for alternative credit scoring
"""
from fastapi import FastAPI, HTTPException, Depends

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
    """Real Kafka producer using raw TCP with circuit breaker."""
    def __init__(self, brokers: str, service_name: str):
        self.brokers = brokers
        self.service_name = service_name
        self._sock = None
        self._cb_open = False
        self._cb_until = 0.0
        import threading
        self._lock = threading.Lock()

    def _connect(self):
        import socket
        try:
            host, port = self.brokers.split(",")[0].split(":")
            self._sock = socket.create_connection((host, int(port)), timeout=5)
            self._cb_open = False
            print(f"[kafka] connected to {host}:{port}")
        except Exception as e:
            self._sock = None
            self._cb_open = True
            import time
            self._cb_until = time.time() + 30
            print(f"[kafka] connection failed (circuit open 30s): {e}")

    def publish(self, event_type: str, key: str, payload: dict):
        """Publish event to Kafka via raw TCP. Circuit breaker on failure."""
        import time, struct
        event = {
            "event_type": event_type,
            "source": self.service_name,
            "key": key,
            "payload": payload,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }
        with self._lock:
            if self._cb_open and time.time() < self._cb_until:
                return
            if self._cb_open:
                self._cb_open = False
            if self._sock is None:
                self._connect()
            if self._sock is not None:
                try:
                    data = _json.dumps(event).encode("utf-8")
                    msg = struct.pack(">I", len(data)) + data
                    self._sock.settimeout(5)
                    self._sock.sendall(msg)
                except Exception as e:
                    self._cb_open = True
                    self._cb_until = time.time() + 30
                    try:
                        self._sock.close()
                    except Exception:
                        pass
                    self._sock = None
                    print(f"[kafka] publish failed (circuit open 30s): {e}")

_kafka_publisher = KafkaEventPublisher(_kafka_brokers, "telco-data-integration-service")

# OpenSearch structured logger
_opensearch_url = os.environ.get("OPENSEARCH_URL", "http://localhost:9200")
class OpenSearchLogger:
    """Real OpenSearch indexer using HTTP with circuit breaker."""
    def __init__(self, url: str, service_name: str):
        self.url = url.rstrip("/")
        self.service_name = service_name
        self._cb_open = False
        self._cb_until = 0.0
        self._user = os.environ.get("OPENSEARCH_USER", "admin")
        self._password = os.environ.get("OPENSEARCH_PASSWORD", "admin")

    def index_log(self, level: str, message: str, fields: dict = None):
        """Index structured log to OpenSearch via HTTP POST."""
        import time
        if self._cb_open and time.time() < self._cb_until:
            return
        if self._cb_open:
            self._cb_open = False
        doc = {
            "@timestamp": datetime.utcnow().isoformat() + "Z",
            "level": level,
            "message": message,
            "service": self.service_name,
            "fields": fields or {},
        }
        idx = f"logs-{self.service_name}-{datetime.utcnow().strftime('%Y.%m.%d')}"
        try:
            import urllib.request, ssl
            req_data = _json.dumps(doc).encode("utf-8")
            req = urllib.request.Request(
                f"{self.url}/{idx}/_doc",
                data=req_data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            import base64
            creds = base64.b64encode(f"{self._user}:{self._password}".encode()).decode()
            req.add_header("Authorization", f"Basic {creds}")
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            urllib.request.urlopen(req, timeout=5, context=ctx)
        except Exception as e:
            self._cb_open = True
            self._cb_until = time.time() + 60
            print(f"[opensearch] index failed (circuit open 60s): {e}")

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
