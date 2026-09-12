FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY fraud_detection_service.py .
EXPOSE 8112
CMD ["python", "-m", "uvicorn", "fraud_detection_service:app", "--host", "0.0.0.0", "--port", "8112"]
