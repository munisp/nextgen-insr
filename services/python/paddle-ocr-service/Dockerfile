FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY paddle_ocr_service.py .
EXPOSE 8113
CMD ["python", "-m", "uvicorn", "paddle_ocr_service:app", "--host", "0.0.0.0", "--port", "8113"]
