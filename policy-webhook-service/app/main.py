"""
Main FastAPI application for Policy Webhook Service with Dapr integration.
"""
import logging
import sys
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from dapr.ext.fastapi import DaprApp

from app.models.policy import HealthCheckResponse, ErrorResponse
from app.services.temporal_client import TemporalClientService
from app.services.dapr_service import DaprService
from app.routers import webhook


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
            logger.info(f"Connected to PostgreSQL for policy_webhook_service")
        except Exception as e:
            logger.warning(f"Database connection failed: {e} (running in degraded mode)")
            return None
    return _db_conn

def init_db():
    conn = get_db()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS policy_webhook_service (
                        id SERIAL PRIMARY KEY,
                        data JSONB NOT NULL DEFAULT '{}',
                        status VARCHAR(50) DEFAULT 'active',
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW(),
                        tenant_id INTEGER DEFAULT 1
                    )
                """)
            logger.info(f"Table policy_webhook_service initialized")
        except Exception as e:
            logger.warning(f"Table creation failed: {e}")


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
