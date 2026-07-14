"""Document OCR Engine — FastAPI application entry point."""

import time

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.models.schemas import HealthResponse
from app.routers.documents import router as documents_router

logger = structlog.get_logger(__name__)

app = FastAPI(
    title="Document OCR Engine",
    description="Document text extraction (PaddleOCR), classification (VLM), validation, and parsing (Docling)",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents_router)

_start_time = time.monotonic()


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        ocr_engine="paddleocr",
        uptime_seconds=round(time.monotonic() - _start_time, 2),
    )


@app.get("/ready")
async def readiness() -> dict:
    return {"ready": True, "engine": "paddleocr+vlm+docling"}
