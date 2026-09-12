FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ app/
# Listen port is PORT-aware: compose sets PORT=8101 to match the platform's
# source of truth (server/routers/innovationRouters.ts SVC default
# http://health-wearables:8101). Standalone default stays 8114.
EXPOSE 8114
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8114}"]
