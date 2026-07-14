FROM python:3.11-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir -r requirements.txt 2>/dev/null || true
COPY --from=builder /app .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
