FROM python:3.11-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir -r requirements.txt 2>/dev/null || true
COPY --from=builder /app .
EXPOSE 8033
CMD ["python", "main.py"]
