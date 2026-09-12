FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY liveness_service.py .
EXPOSE 8110
CMD ["python", "-m", "uvicorn", "liveness_service:app", "--host", "0.0.0.0", "--port", "8110"]
