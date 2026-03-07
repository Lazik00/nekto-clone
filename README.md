# Nekto Clone

Production-ready random video chat backend + design frontend.

## Stack

- Backend: FastAPI, SQLAlchemy (async), PostgreSQL, Redis
- Frontend: `Design Matchmaking App` (React + Vite, served by Nginx)
- Infra: Docker Compose

## Quick Start (Docker)

1. Copy env:

```bash
cp .env.example .env
```

2. Start all services:

```bash
docker compose up --build
```

3. Open:

- Frontend: http://localhost:8080
- Backend docs: http://localhost:8080/api/docs
- Direct backend: http://localhost:8000

## Services

- `frontend` (Nginx): serves SPA and proxies `/api` + `/uploads` + websocket
- `backend` (Gunicorn + Uvicorn workers)
- `db` (PostgreSQL 16)
- `redis` (queue, rate limiting)

## Local Frontend Dev

```bash
cd "Design Matchmaking App"
npm install
npm run dev
```

Frontend dev URL: http://localhost:5174

## Local Backend Dev

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Notes

- Password hashing now uses PBKDF2-HMAC-SHA256 with backward compatibility for legacy hashes.
- Matchmaking queue operations are optimized for Redis (`zrank`, `zscore`, `zrem`) with in-memory fallback.
