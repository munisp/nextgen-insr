FROM python:3.11-slim
WORKDIR /app
# Runtime deps actually imported by app/main.py (fastapi/uvicorn/pydantic/multipart).
RUN pip install --no-cache-dir "fastapi>=0.110.0" "uvicorn>=0.27.0" "pydantic>=2.6.0" "python-multipart>=0.0.9"
COPY app/ app/
EXPOSE 8099
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8099"]
