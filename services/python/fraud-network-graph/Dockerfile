FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ app/
# Listen port is PORT-aware: compose sets PORT=8100 to match the platform's
# source of truth (server/routers/innovationRouters.ts SVC default
# http://fraud-network-graph:8100). Standalone default stays 8111.
EXPOSE 8111
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8111}"]
