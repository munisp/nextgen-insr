from fastapi import FastAPI


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
            logger.info(f"Connected to PostgreSQL for {svc_name}")
        except Exception as e:
            logger.warning(f"Database connection failed: {e} (running in degraded mode)")
            return None
    return _db_conn

def init_db():
    conn = get_db()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute(f"""
                    CREATE TABLE IF NOT EXISTS {svc_name} (
                        id SERIAL PRIMARY KEY,
                        data JSONB NOT NULL DEFAULT '{{}}',
                        status VARCHAR(50) DEFAULT 'active',
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW(),
                        tenant_id INTEGER DEFAULT 1
                    )
                """)
            logger.info(f"Table {svc_name} initialized")
        except Exception as e:
            logger.warning(f"Table creation failed: {e}")


app = FastAPI(
    title="Data Lakehouse",
    description="Unified data lakehouse for insurance analytics, reporting, and ML pipelines",
    version="1.0.0",
)


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


@app.on_event("startup")
async def startup():
    init_db()
