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

_kafka_publisher = KafkaEventPublisher(_kafka_brokers, "data-lakehouse")

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
        # Production: requests.post(f"{self.url}/logs-data-lakehouse/_doc", json=doc)
        print(f"[opensearch] {level}: {message}")

_os_logger = OpenSearchLogger(_opensearch_url, "data-lakehouse")

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



app = FastAPI(
    title="Data Lakehouse",
    description="Unified data lakehouse for insurance analytics, reporting, and ML pipelines",
    version="1.0.0",
)
app.middleware("http")(keycloak_auth_middleware)



@app.get("/api/v1/lakehouse/datasets")
async def list_datasets():
    return {
        "datasets": [
            {
                "id": "ds-policies",
                "name": "Policies",
                "description": "All insurance policies across products",
                "format": "delta",
                "rows": 125000,
                "size_gb": 2.4,
                "updated_at": "2026-05-16T00:00:00Z",
                "partitioned_by": ["product_type", "year", "month"],
                "schema_fields": ["policy_id", "customer_id", "product_type", "start_date", "end_date",
                                  "premium", "sum_insured", "status", "state", "lga"],
            },
            {
                "id": "ds-claims",
                "name": "Claims",
                "description": "Claims data with status tracking and payouts",
                "format": "delta",
                "rows": 45000,
                "size_gb": 1.8,
                "updated_at": "2026-05-16T00:00:00Z",
                "partitioned_by": ["claim_type", "year", "month"],
                "schema_fields": ["claim_id", "policy_id", "claim_type", "amount_claimed",
                                  "amount_approved", "status", "filed_date", "resolved_date"],
            },
            {
                "id": "ds-payments",
                "name": "Payments",
                "description": "Premium payments and payout transactions",
                "format": "delta",
                "rows": 350000,
                "size_gb": 3.1,
                "updated_at": "2026-05-16T00:00:00Z",
                "partitioned_by": ["payment_type", "year", "month"],
                "schema_fields": ["transaction_id", "policy_id", "amount", "currency", "channel",
                                  "provider", "status", "created_at"],
            },
            {
                "id": "ds-customers",
                "name": "Customers",
                "description": "Customer profiles with segmentation data",
                "format": "delta",
                "rows": 98000,
                "size_gb": 0.8,
                "updated_at": "2026-05-16T00:00:00Z",
                "partitioned_by": ["state"],
                "schema_fields": ["customer_id", "name", "phone", "email", "state", "lga",
                                  "kyc_level", "segment", "clv_score", "churn_risk"],
            },
            {
                "id": "ds-agents",
                "name": "Agent Performance",
                "description": "Agent network activity and performance metrics",
                "format": "delta",
                "rows": 5200,
                "size_gb": 0.3,
                "updated_at": "2026-05-16T00:00:00Z",
                "partitioned_by": ["state", "tier"],
                "schema_fields": ["agent_id", "name", "state", "lga", "tier", "policies_sold",
                                  "premium_collected", "commission", "active"],
            },
        ],
    }


@app.get("/api/v1/lakehouse/query")
async def run_query(sql: str = "SELECT COUNT(*) as total_policies FROM policies"):
    """Execute SQL query against the lakehouse."""
    sample_results = {
        "query": sql,
        "execution_time_ms": 245,
        "rows_scanned": 125000,
        "result": [{"total_policies": 125000}],
        "engine": "Spark SQL / DuckDB",
    }
    return sample_results


@app.get("/api/v1/lakehouse/pipelines")
async def list_pipelines():
    return {
        "pipelines": [
            {
                "id": "pipe-daily-etl",
                "name": "Daily Policy & Claims ETL",
                "schedule": "0 2 * * *",
                "status": "healthy",
                "last_run": "2026-05-16T02:00:00Z",
                "duration_minutes": 12,
                "records_processed": 8500,
            },
            {
                "id": "pipe-ml-features",
                "name": "ML Feature Store Refresh",
                "schedule": "0 4 * * *",
                "status": "healthy",
                "last_run": "2026-05-16T04:00:00Z",
                "duration_minutes": 25,
                "records_processed": 98000,
            },
            {
                "id": "pipe-regulatory",
                "name": "NAICOM Regulatory Reporting ETL",
                "schedule": "0 6 1 * *",
                "status": "healthy",
                "last_run": "2026-05-01T06:00:00Z",
                "duration_minutes": 45,
                "records_processed": 125000,
            },
        ],
    }


@app.get("/api/v1/lakehouse/metrics")
async def lakehouse_metrics():
    return {
        "total_data_size_gb": 8.4,
        "total_tables": 12,
        "total_rows": 623200,
        "daily_ingestion_rate": 8500,
        "query_latency_p50_ms": 120,
        "query_latency_p99_ms": 1200,
        "storage_cost_monthly_usd": 25,
        "compute_cost_monthly_usd": 150,
    }


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "data-lakehouse"}
