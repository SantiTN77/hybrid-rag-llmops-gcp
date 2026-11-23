FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_SYSTEM_PYTHON=1 \
    PORT=8080

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY pyproject.toml ./
COPY src ./src

RUN uv pip install --no-cache .

EXPOSE 8080

CMD ["uvicorn", "rag_api.main:app", "--host", "0.0.0.0", "--port", "8080"]
