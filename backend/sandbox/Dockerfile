FROM python:3.12-slim

RUN pip install --no-cache-dir pytest==8.3.4
COPY runner.py /opt/sentinel/runner.py
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTEST_DISABLE_PLUGIN_AUTOLOAD=1
WORKDIR /workspace
USER 65534:65534
CMD ["python", "/opt/sentinel/runner.py", "/workspace"]
