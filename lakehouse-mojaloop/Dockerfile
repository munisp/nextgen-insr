FROM python:3.12-slim
WORKDIR /app
COPY main.py .
EXPOSE 8090
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8090/healthz', timeout=4).status==200 else 1)"
CMD ["python", "main.py"]
