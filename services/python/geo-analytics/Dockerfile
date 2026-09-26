# Q-wave Q5 (2026-09-25) — geo-analytics (repo python-service convention).
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
# 2026-09-26 fix (Semgrep): run as non-root
RUN useradd -r -u 10001 appuser
USER appuser
EXPOSE 8096
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8096"]
