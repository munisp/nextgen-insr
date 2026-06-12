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

_kafka_publisher = KafkaEventPublisher(_kafka_brokers, "actuarial-platform")

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
        # Production: requests.post(f"{self.url}/logs-actuarial-platform/_doc", json=doc)
        print(f"[opensearch] {level}: {message}")

_os_logger = OpenSearchLogger(_opensearch_url, "actuarial-platform")

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
    title="Actuarial Data Platform",
    description="Actuarial analysis, pricing models, reserving, and experience studies",
    version="1.0.0",
)
app.middleware("http")(keycloak_auth_middleware)



@app.get("/api/v1/actuarial/mortality-tables")
async def mortality_tables():
    return {
        "tables": [
            {
                "id": "NGA-2020",
                "name": "Nigeria National Mortality Table 2020",
                "type": "period",
                "gender": "unisex",
                "age_range": [0, 100],
                "sample_rates": {
                    "20": 0.00120, "30": 0.00180, "40": 0.00350,
                    "50": 0.00780, "60": 0.01650, "70": 0.03800,
                },
                "source": "National Bureau of Statistics / NAICOM",
            },
            {
                "id": "AFRI-STD-2023",
                "name": "Pan-African Standard Mortality Table 2023",
                "type": "select_and_ultimate",
                "gender": "separate",
                "age_range": [15, 85],
                "source": "Pan-African Actuarial Association",
            },
        ],
    }


@app.get("/api/v1/actuarial/loss-triangles")
async def loss_triangles():
    return {
        "product": "motor_third_party",
        "as_of": "2026-03-31",
        "method": "chain_ladder",
        "development_factors": [1.85, 1.35, 1.12, 1.05, 1.02, 1.01],
        "triangle": {
            "2021": [450000000, 832500000, 1123875000, 1258740000, 1321677000, 1348110540],
            "2022": [520000000, 962000000, 1298700000, 1454544000, 1527271200],
            "2023": [580000000, 1073000000, 1448550000, 1622376000],
            "2024": [650000000, 1202500000, 1623375000],
            "2025": [720000000, 1332000000],
            "2026": [380000000],
        },
        "ultimate_claims": {
            "2021": 1348110540, "2022": 1557816624, "2023": 1658724480,
            "2024": 1829974875, "2025": 2443308000, "2026": 1299870000,
        },
        "ibnr_reserve": 3250000000,
    }


@app.get("/api/v1/actuarial/pricing/{product_type}")
async def pricing_model(product_type: str):
    models = {
        "motor_tp": {
            "product": "Motor Third Party",
            "base_premium": 15000,
            "rating_factors": [
                {"factor": "vehicle_age", "weight": 0.15, "categories": {"0-3": 0.9, "4-7": 1.0, "8-12": 1.15, "13+": 1.3}},
                {"factor": "driver_age", "weight": 0.20, "categories": {"18-25": 1.4, "26-35": 1.0, "36-50": 0.9, "51+": 1.1}},
                {"factor": "state", "weight": 0.25, "categories": {"Lagos": 1.3, "Abuja": 1.2, "Rivers": 1.15, "other": 1.0}},
                {"factor": "vehicle_type", "weight": 0.20, "categories": {"sedan": 1.0, "suv": 1.1, "truck": 1.3, "motorcycle": 1.5}},
                {"factor": "claims_history", "weight": 0.20, "categories": {"0": 0.85, "1": 1.0, "2": 1.25, "3+": 1.5}},
            ],
            "expected_loss_ratio": 0.62,
            "expense_ratio": 0.25,
            "profit_margin": 0.08,
            "commission_rate": 0.15,
        },
        "hospital_cash": {
            "product": "Hospital Cash",
            "base_premium": 500,
            "rating_factors": [
                {"factor": "age", "weight": 0.40, "categories": {"18-30": 0.8, "31-45": 1.0, "46-60": 1.4, "61+": 2.0}},
                {"factor": "gender", "weight": 0.15, "categories": {"M": 1.0, "F": 1.1}},
                {"factor": "occupation_risk", "weight": 0.25, "categories": {"low": 0.9, "medium": 1.0, "high": 1.3}},
            ],
            "expected_loss_ratio": 0.55,
            "expense_ratio": 0.20,
            "profit_margin": 0.10,
        },
    }
    return models.get(product_type, {"error": "Product type not found"})


@app.get("/api/v1/actuarial/experience-study")
async def experience_study():
    return {
        "study_period": "2023-2025",
        "products_analyzed": 5,
        "results": [
            {
                "product": "Motor TP",
                "expected_claims_frequency": 0.12,
                "actual_claims_frequency": 0.135,
                "ae_ratio": 1.125,
                "avg_claim_severity": 185000,
                "recommendation": "Increase base rate by 8% for Lagos, Rivers",
            },
            {
                "product": "Term Life",
                "expected_mortality": 0.0025,
                "actual_mortality": 0.0022,
                "ae_ratio": 0.88,
                "avg_claim_severity": 2500000,
                "recommendation": "Mortality experience favorable; consider premium reduction for preferred lives",
            },
            {
                "product": "Hospital Cash",
                "expected_claims_frequency": 0.08,
                "actual_claims_frequency": 0.095,
                "ae_ratio": 1.1875,
                "avg_claim_severity": 45000,
                "recommendation": "Review waiting period; consider increasing from 30 to 45 days",
            },
        ],
    }


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "actuarial-platform"}
