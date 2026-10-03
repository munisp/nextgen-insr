"""
InsurePortal Python Analytics Service
======================================
High-performance analytics microservice providing:
- Lakehouse ETL: Extract/transform/load from PostgreSQL → Parquet/Delta Lake (S3/MinIO)
- Actuarial Engine: Mortality tables, loss ratios, reserve calculations, pricing models
- IFRS 17 Reserve Engine: BBA/PAA/VFA measurement models, CSM amortisation, RA calculation
- Fraud ML Scoring: Real-time fraud detection using scikit-learn ensemble models
- Risk Analytics: Portfolio risk metrics, VaR, stress testing

Exposes a FastAPI REST API consumed by the insureportal tRPC layer.
"""
import os
import logging
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST

from src.api.lakehouse_routes import router as lakehouse_router
from src.api.actuarial_routes import router as actuarial_router
from src.api.fraud_routes import router as fraud_router
from src.api.ifrs17_routes import router as ifrs17_router

# ── Structured logging ────────────────────────────────────────────────────────
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        structlog.processors.JSONRenderer(),
    ]
)
log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup / shutdown lifecycle."""
    log.info("InsurePortal Python Analytics starting", version="1.0.0")
    yield
    log.info("InsurePortal Python Analytics stopped")


# ── Application ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="InsurePortal Analytics Service",
    description="Actuarial, IFRS17, Fraud ML, and Lakehouse ETL for InsurePortal",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(lakehouse_router, prefix="/lakehouse", tags=["Lakehouse ETL"])
app.include_router(actuarial_router, prefix="/actuarial", tags=["Actuarial Engine"])
app.include_router(fraud_router, prefix="/fraud", tags=["Fraud ML"])
app.include_router(ifrs17_router, prefix="/ifrs17", tags=["IFRS 17"])


# ── Core endpoints ────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "insureportal-python-analytics",
        "version": "1.0.0",
        "components": {
            "lakehouse": "ok",
            "actuarial": "ok",
            "fraud_ml": "ok",
            "ifrs17": "ok",
        }
    }


@app.get("/metrics", response_class=PlainTextResponse)
async def metrics():
    """Expose Prometheus metrics."""
    return PlainTextResponse(
        generate_latest().decode("utf-8"),
        media_type=CONTENT_TYPE_LATEST,
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log.error("Unhandled exception", path=str(request.url), error=str(exc))
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "detail": str(exc)},
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PYTHON_ANALYTICS_PORT", "8092"))
    uvicorn.run("src.main:app", host="0.0.0.0", port=port, reload=False, workers=2)
