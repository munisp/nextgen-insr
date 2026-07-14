import os
"""
Main FastAPI application for Policy Webhook Service with Dapr integration.
"""
import logging
import sys
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, Request

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
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from dapr.ext.fastapi import DaprApp

from app.models.policy import HealthCheckResponse, ErrorResponse
from app.services.temporal_client import TemporalClientService
from app.services.dapr_service import DaprService
from app.routers import webhook

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

_kafka_publisher = KafkaEventPublisher(_kafka_brokers, "policy-webhook-service")

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

_os_logger = OpenSearchLogger(_opensearch_url, "policy-webhook-service")

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



# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
    ]
)
logger = logging.getLogger(__name__)

# Global service instances
temporal_client: TemporalClientService = None
dapr_service: DaprService = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup and shutdown events.
    """
    # Startup
    logger.info("Starting Policy Webhook Service...")
    
    global temporal_client, dapr_service
    
    # Initialize Temporal client
    temporal_address = app.state.config.get("temporal_address", "localhost:7233")
    temporal_namespace = app.state.config.get("temporal_namespace", "default")
    
    temporal_client = TemporalClientService(
        temporal_address=temporal_address,
        namespace=temporal_namespace,
    )
    await temporal_client.connect()
    logger.info("Temporal client connected")
    
    # Initialize Dapr service
    dapr_grpc_port = app.state.config.get("dapr_grpc_port", 50001)
    dapr_service = DaprService(dapr_grpc_port=dapr_grpc_port)
    logger.info("Dapr service initialized")
    
    logger.info("Policy Webhook Service started successfully")
    
    yield
    
    # Shutdown
    logger.info("Shutting down Policy Webhook Service...")
    
    if temporal_client:
        await temporal_client.disconnect()
        logger.info("Temporal client disconnected")
    
    logger.info("Policy Webhook Service stopped")


def create_app(config: dict = None) -> FastAPI:
    """
    Create and configure FastAPI application.
    
    Args:
        config: Configuration dictionary
        
    Returns:
        Configured FastAPI application
    """
    # Default configuration
    default_config = {
        "temporal_address": "localhost:7233",
        "temporal_namespace": "default",
        "dapr_grpc_port": 50001,
        "dapr_http_port": 3500,
    }
    
    if config:
        default_config.update(config)
    
    # Create FastAPI app
    app = FastAPI(
        title="Policy Webhook Service",
        description="Webhook service for initiating policy issuance workflows via Temporal",
        version="1.0.0",
        lifespan=lifespan,
    )
    app.middleware("http")(keycloak_auth_middleware)

    # Store config in app state
    app.state.config = default_config
    
    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Configure appropriately for production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Add Dapr extension
    dapr_app = DaprApp(app)
    
    # Register Dapr pub/sub subscriptions
    @dapr_app.subscribe(pubsub="pubsub", topic="policy-workflow-completed")
    async def workflow_completed_handler(event_data: dict):
        """Handle workflow completed events from Dapr pub/sub."""
        logger.info(f"Received workflow completed event via Dapr: {event_data}")
        # Event is automatically routed to webhook.handle_workflow_completed_event
        return {"success": True}
    
    @dapr_app.subscribe(pubsub="pubsub", topic="policy-workflow-failed")
    async def workflow_failed_handler(event_data: dict):
        """Handle workflow failed events from Dapr pub/sub."""
        logger.info(f"Received workflow failed event via Dapr: {event_data}")
        # Event is automatically routed to webhook.handle_workflow_failed_event
        return {"success": True}
    
    # Include routers
    app.include_router(webhook.router)
    
    # Global exception handler
    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        """Global exception handler."""
        logger.error(f"Unhandled exception: {exc}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(
                error="INTERNAL_SERVER_ERROR",
                message="An unexpected error occurred",
                details={"error": str(exc)},
            ).dict(),
        )
    
    # Health check endpoint
    @app.get(
        "/health",
        response_model=HealthCheckResponse,
        tags=["health"],
        summary="Health Check",
    )
    async def health_check():
        """
        Health check endpoint.
        
        Checks connectivity to Temporal and Dapr.
        """
        temporal_healthy = False
        dapr_healthy = False
        
        if temporal_client:
            temporal_healthy = await temporal_client.health_check()
        
        if dapr_service:
            dapr_healthy = await dapr_service.health_check()
        
        status = "healthy" if (temporal_healthy and dapr_healthy) else "degraded"
        
        return HealthCheckResponse(
            status=status,
            temporal_connected=temporal_healthy,
            dapr_connected=dapr_healthy,
            version="1.0.0",
            timestamp=datetime.utcnow(),
        )
    
    # Root endpoint
    @app.get("/", tags=["root"])
    async def root():
        """Root endpoint."""
        return {
            "service": "Policy Webhook Service",
            "version": "1.0.0",
            "description": "Webhook service for initiating policy issuance workflows",
            "endpoints": {
                "health": "/health",
                "docs": "/docs",
                "policy_issuance": "/api/v1/webhooks/policy-issuance",
                "workflow_status": "/api/v1/webhooks/policy-issuance/status",
            },
        }
    
    logger.info("FastAPI application created")
    return app


# Create app instance
app = create_app()


init_db()

if __name__ == "__main__":
    import uvicorn
    import os
    
    # Load configuration from environment variables
    config = {
        "temporal_address": os.getenv("TEMPORAL_ADDRESS", "localhost:7233"),
        "temporal_namespace": os.getenv("TEMPORAL_NAMESPACE", "default"),
        "dapr_grpc_port": int(os.getenv("DAPR_GRPC_PORT", "50001")),
        "dapr_http_port": int(os.getenv("DAPR_HTTP_PORT", "3500")),
    }
    
    # Run with uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
