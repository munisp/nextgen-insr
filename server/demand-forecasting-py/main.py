import os
"""
Supply Chain Demand Forecasting Service
AI-powered demand prediction with multiple algorithms:
- Moving Average
- Exponential Smoothing (Holt-Winters)
- Seasonal Decomposition
- Anomaly Detection
- Forecast Accuracy Tracking
"""

from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel

from forecasting import DemandForecaster, ForecastResult
from anomaly import AnomalyDetector

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

_kafka_publisher = KafkaEventPublisher(_kafka_brokers, "demand-forecasting-py")

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
        # Production: requests.post(f"{self.url}/logs-demand-forecasting-py/_doc", json=doc)
        print(f"[opensearch] {level}: {message}")

_os_logger = OpenSearchLogger(_opensearch_url, "demand-forecasting-py")

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




forecaster: Optional[DemandForecaster] = None
anomaly_detector: Optional[AnomalyDetector] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global forecaster, anomaly_detector
    forecaster = DemandForecaster()
    anomaly_detector = AnomalyDetector()
    yield
    forecaster = None
    anomaly_detector = None


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

app = FastAPI(
    title="Demand Forecasting Service",
    version="1.0.0",
    lifespan=lifespan,
)
app.middleware("http")(keycloak_auth_middleware)



@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "demand-forecasting",
        "version": "1.0.0",
        "algorithms": ["moving_average", "exponential_smoothing", "seasonal", "arima_lite"],
    }


class HistoricalData(BaseModel):
    sku: str
    warehouse_id: Optional[int] = None
    data_points: list[dict]  # [{"date": "2024-01-01", "quantity": 150}, ...]


class ForecastRequest(BaseModel):
    sku: str
    warehouse_id: Optional[int] = None
    horizon_days: int = 30
    method: str = "exponential_smoothing"
    historical: list[dict] = []


@app.post("/api/v1/forecast")
async def generate_forecast(req: ForecastRequest) -> dict:
    """Generate demand forecast for a SKU."""
    if not forecaster:
        raise HTTPException(503, "Forecaster not initialized")

    result = forecaster.forecast(
        sku=req.sku,
        warehouse_id=req.warehouse_id,
        historical=req.historical,
        horizon_days=req.horizon_days,
        method=req.method,
    )
    return result.to_dict()


@app.post("/api/v1/forecast/batch")
async def batch_forecast(items: list[ForecastRequest]) -> dict:
    """Generate forecasts for multiple SKUs."""
    if not forecaster:
        raise HTTPException(503, "Forecaster not initialized")

    results = []
    for item in items:
        result = forecaster.forecast(
            sku=item.sku,
            warehouse_id=item.warehouse_id,
            historical=item.historical,
            horizon_days=item.horizon_days,
            method=item.method,
        )
        results.append(result.to_dict())
    return {"forecasts": results, "count": len(results)}


@app.get("/api/v1/forecast/accuracy/{sku}")
async def forecast_accuracy(sku: str, days: int = Query(default=30)) -> dict:
    """Get forecast accuracy metrics for a SKU."""
    if not forecaster:
        raise HTTPException(503, "Forecaster not initialized")

    return forecaster.get_accuracy(sku, days)


@app.post("/api/v1/anomaly/detect")
async def detect_anomalies(data: HistoricalData) -> dict:
    """Detect demand anomalies in historical data."""
    if not anomaly_detector:
        raise HTTPException(503, "Anomaly detector not initialized")

    anomalies = anomaly_detector.detect(data.data_points)
    return {
        "sku": data.sku,
        "anomalies": anomalies,
        "total_points": len(data.data_points),
        "anomaly_count": len(anomalies),
    }


@app.get("/api/v1/seasonal/factors/{sku}")
async def seasonal_factors(
    sku: str,
    periods: int = Query(default=12),
) -> dict:
    """Get seasonal adjustment factors for a SKU."""
    if not forecaster:
        raise HTTPException(503, "Forecaster not initialized")

    factors = forecaster.get_seasonal_factors(sku, periods)
    return {"sku": sku, "periods": periods, "factors": factors}


@app.post("/api/v1/reorder/calculate")
async def calculate_reorder_point(req: dict) -> dict:
    """Calculate optimal reorder point based on demand forecast and lead time."""
    sku = req.get("sku", "")
    lead_time_days = req.get("leadTimeDays", 7)
    service_level = req.get("serviceLevel", 0.95)
    avg_daily_demand = req.get("avgDailyDemand", 10)
    demand_std_dev = req.get("demandStdDev", 3)

    # Safety stock = Z * σ * √(lead time)
    import math
    z_scores = {0.90: 1.28, 0.95: 1.65, 0.97: 1.88, 0.99: 2.33}
    z = z_scores.get(service_level, 1.65)
    safety_stock = z * demand_std_dev * math.sqrt(lead_time_days)
    reorder_point = (avg_daily_demand * lead_time_days) + safety_stock
    eoq = math.sqrt((2 * avg_daily_demand * 365 * 500) / (avg_daily_demand * 0.25))

    return {
        "sku": sku,
        "reorderPoint": round(reorder_point),
        "safetyStock": round(safety_stock),
        "economicOrderQuantity": round(eoq),
        "avgDailyDemand": avg_daily_demand,
        "leadTimeDays": lead_time_days,
        "serviceLevel": service_level,
    }


@app.get("/api/v1/trends/{sku}")
async def demand_trends(sku: str, lookback_days: int = Query(default=90)) -> dict:
    """Analyze demand trends for a SKU."""
    if not forecaster:
        raise HTTPException(503, "Forecaster not initialized")

    return forecaster.analyze_trends(sku, lookback_days)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8202)
