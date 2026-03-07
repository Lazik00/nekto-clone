FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY api ./api
COPY migrations ./migrations
COPY .env.example ./.env.example

RUN mkdir -p /app/logs /app/uploads/avatars

RUN useradd --create-home appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8077

CMD ["gunicorn", "-k", "uvicorn.workers.UvicornWorker", "-w", "4", "-b", "0.0.0.0:8077", "app.main:app"]
