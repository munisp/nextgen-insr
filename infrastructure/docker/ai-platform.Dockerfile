# AI Platform — Inference, Training, Continuous Training, Lakehouse
# Consolidated into a single Python FastAPI app

FROM python:3.11-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl build-essential && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip install --no-cache-dir \
    fastapi uvicorn httpx numpy pandas scikit-learn torch --extra-index-url https://download.pytorch.org/whl/cpu

COPY ai-ml-platform/ ./ai_ml/
COPY infrastructure/python-sdk/ ./infra_sdk_pkg/

COPY infrastructure/docker/cmd/ai-platform/main.py ./main.py

RUN mkdir -p /data/lakehouse /data/models

EXPOSE 8200
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s \
  CMD curl -f http://localhost:8200/health || exit 1
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8200"]
