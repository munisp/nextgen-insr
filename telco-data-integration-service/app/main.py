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

init_db()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8010)

# ML Enhancement Routers (Phase 1-4)
from app.api import data_collection_router, ml_model_router, hybrid_model_router, continuous_learning_router

app.include_router(data_collection_router.router, prefix="/api/v1/data-collection", tags=["data-collection"])
app.include_router(ml_model_router.router, prefix="/api/v1/ml-models", tags=["ml-models"])
app.include_router(hybrid_model_router.router, prefix="/api/v1/hybrid", tags=["hybrid-scoring"])
app.include_router(continuous_learning_router.router, prefix="/api/v1/continuous-learning", tags=["continuous-learning"])
