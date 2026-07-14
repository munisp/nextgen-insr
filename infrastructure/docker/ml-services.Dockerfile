# ML Services — DeepFace Liveness, Document OCR, Liveness Detection
# Consolidated into a single Python FastAPI app

FROM python:3.11-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl libgl1-mesa-glx libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY kyc-kyb-system/deepface-liveness-service/requirements.txt ./requirements-liveness.txt
RUN pip install --no-cache-dir -r requirements-liveness.txt 2>/dev/null || true
RUN pip install --no-cache-dir fastapi uvicorn httpx

COPY kyc-kyb-system/deepface-liveness-service/ ./liveness/
COPY kyc-kyb-system/document-ocr-service/ ./ocr/
COPY infrastructure/python-sdk/ ./infra_sdk_pkg/

COPY infrastructure/docker/cmd/ml-services/main.py ./main.py

EXPOSE 8110
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD curl -f http://localhost:8110/health || exit 1
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8110"]
