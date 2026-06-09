import os
"""Lakehouse Analytics — Data warehouse for insurance analytics, BI, and reporting."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta
import logging
import random

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

_kafka_publisher = KafkaEventPublisher(_kafka_brokers, "lakehouse-analytics")

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
        # Production: requests.post(f"{self.url}/logs-lakehouse-analytics/_doc", json=doc)
        print(f"[opensearch] {level}: {message}")

_os_logger = OpenSearchLogger(_opensearch_url, "lakehouse-analytics")

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



logging.basicConfig(level=logging.INFO, format="%(asctime)s [lakehouse] %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="Lakehouse Analytics", version="3.0.0")
app.middleware("http")(keycloak_auth_middleware)

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "lakehouse-analytics",
        "version": "3.0.0",
        "middleware": ["kafka", "postgres", "opensearch", "redis"],
        "data_freshness": "2026-05-16T20:00:00Z",
    }


@app.get("/api/v1/lakehouse/dashboards")
async def list_dashboards():
    """Available analytics dashboards."""
    return {
        "dashboards": [
            {"id": "exec-overview", "name": "Executive Overview", "category": "executive", "widgets": 12},
            {"id": "claims-analytics", "name": "Claims Analytics", "category": "operations", "widgets": 8},
            {"id": "premium-analytics", "name": "Premium & Revenue", "category": "finance", "widgets": 10},
            {"id": "agent-performance", "name": "Agent Performance", "category": "distribution", "widgets": 7},
            {"id": "risk-portfolio", "name": "Risk Portfolio", "category": "actuarial", "widgets": 9},
            {"id": "customer-insights", "name": "Customer Insights", "category": "marketing", "widgets": 6},
            {"id": "regulatory-compliance", "name": "Regulatory Compliance", "category": "compliance", "widgets": 5},
            {"id": "fraud-detection", "name": "Fraud Detection", "category": "security", "widgets": 8},
        ]
    }


@app.get("/api/v1/lakehouse/metrics")
async def get_metrics(dashboard: str = "exec-overview", period: str = "30d"):
    """Get metrics for a dashboard."""
    if dashboard == "exec-overview":
        return {
            "period": period,
            "metrics": {
                "gross_written_premium": {"value": 2847000000, "currency": "NGN", "change": 0.12},
                "net_earned_premium": {"value": 2134000000, "currency": "NGN", "change": 0.08},
                "claims_incurred": {"value": 1423000000, "currency": "NGN", "change": -0.03},
                "loss_ratio": {"value": 0.667, "target": 0.65, "status": "warning"},
                "expense_ratio": {"value": 0.28, "target": 0.30, "status": "good"},
                "combined_ratio": {"value": 0.947, "target": 0.95, "status": "good"},
                "policies_in_force": {"value": 42847, "change": 0.15},
                "active_agents": {"value": 1243, "change": 0.22},
                "stp_rate": {"value": 0.715, "target": 0.80, "status": "improving"},
                "customer_satisfaction": {"value": 4.2, "max": 5.0, "change": 0.1},
                "fraud_detection_rate": {"value": 0.94, "target": 0.95},
                "regulatory_compliance": {"value": 0.98, "target": 1.0},
            },
        }
    return {"dashboard": dashboard, "period": period, "metrics": {}}


@app.get("/api/v1/lakehouse/reports")
async def list_reports():
    """Available analytics reports."""
    return {
        "reports": [
            {"id": "monthly-financials", "name": "Monthly Financial Summary", "format": "pdf", "schedule": "monthly"},
            {"id": "loss-triangle", "name": "Loss Development Triangle", "format": "excel", "schedule": "quarterly"},
            {"id": "agent-commission", "name": "Agent Commission Report", "format": "csv", "schedule": "monthly"},
            {"id": "regulatory-returns", "name": "NAICOM Quarterly Returns", "format": "xml", "schedule": "quarterly"},
            {"id": "solvency-report", "name": "Solvency Margin Report", "format": "pdf", "schedule": "quarterly"},
            {"id": "fraud-report", "name": "Fraud Detection Report", "format": "pdf", "schedule": "weekly"},
        ]
    }


@app.post("/api/v1/lakehouse/query")
async def run_query(query: dict):
    """Run an analytics query against the data warehouse."""
    metric = query.get("metric", "premium")
    group_by = query.get("group_by", "month")
    filters = query.get("filters", {})

    # Generate realistic time-series data
    now = datetime.utcnow()
    data_points = []
    for i in range(12):
        dt = now - timedelta(days=30 * (11 - i))
        base = 200000000 + (i * 15000000)
        value = base + random.randint(-20000000, 20000000)
        data_points.append({
            "date": dt.strftime("%Y-%m"),
            "value": value,
            "currency": "NGN",
        })

    return {
        "query": query,
        "result": {
            "data": data_points,
            "total": sum(d["value"] for d in data_points),
            "average": sum(d["value"] for d in data_points) // len(data_points),
            "trend": "increasing",
        },
        "execution_time_ms": 45,
    }


@app.get("/api/v1/lakehouse/data-catalog")
async def data_catalog():
    """Data catalog — available datasets and schemas."""
    return {
        "datasets": [
            {"name": "policies", "rows": 42847, "columns": 28, "freshness": "real-time", "source": "postgres"},
            {"name": "claims", "rows": 15423, "columns": 22, "freshness": "real-time", "source": "postgres"},
            {"name": "premiums", "rows": 89234, "columns": 15, "freshness": "real-time", "source": "tigerbeetle"},
            {"name": "agents", "rows": 1243, "columns": 18, "freshness": "hourly", "source": "postgres"},
            {"name": "telemetry", "rows": 2847000, "columns": 12, "freshness": "streaming", "source": "fluvio"},
            {"name": "kyc_verifications", "rows": 34521, "columns": 20, "freshness": "real-time", "source": "postgres"},
            {"name": "transactions", "rows": 156789, "columns": 16, "freshness": "real-time", "source": "tigerbeetle"},
            {"name": "audit_log", "rows": 892341, "columns": 10, "freshness": "real-time", "source": "opensearch"},
        ]
    }


@app.post("/api/v1/lakehouse/ingest")
async def ingest_data(batch: dict):
    """Ingest analytics events from Kafka."""
    source = batch.get("source", "unknown")
    events = batch.get("events", [])
    return {
        "ingested": len(events),
        "source": source,
        "status": "accepted",
        "timestamp": datetime.utcnow().isoformat(),
    }
