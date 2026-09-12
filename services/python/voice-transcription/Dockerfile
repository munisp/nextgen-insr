FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir "fastapi>=0.110.0" "uvicorn>=0.27.0" "pydantic>=2.6.0"
COPY app/ app/
EXPOSE 8105
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8105"]
