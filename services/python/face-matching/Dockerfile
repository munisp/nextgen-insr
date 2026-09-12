FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY face_matching_service.py .
EXPOSE 8111
CMD ["python", "-m", "uvicorn", "face_matching_service:app", "--host", "0.0.0.0", "--port", "8111"]
