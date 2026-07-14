"""DeepFace Liveness Engine — FastAPI application entry point."""

import time

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.models.schemas import HealthResponse
from app.routers.liveness import router as liveness_router
from app.services.deepface_service import MODELS_CACHE, preload_models

logger = structlog.get_logger(__name__)

app = FastAPI(
    title="DeepFace Liveness Engine",
    description="World-class liveness detection and face verification using DeepFace, with multi-signal anti-spoofing",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(liveness_router)

_start_time = time.monotonic()
_loaded_models: list[str] = []


@app.on_event("startup")
async def startup_event() -> None:
    global _loaded_models
    logger.info("starting_deepface_liveness_engine")
    _loaded_models = preload_models()
    logger.info("deepface_models_loaded", models=_loaded_models)


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        models_loaded=list(MODELS_CACHE.keys()),
        uptime_seconds=round(time.monotonic() - _start_time, 2),
    )


@app.get("/ready")
async def readiness() -> dict:
    return {"ready": len(MODELS_CACHE) > 0, "models": list(MODELS_CACHE.keys())}
