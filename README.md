# Nekto Clone

Production-ready random video chat backend + custom React frontend.

## Stack

- Backend: FastAPI, SQLAlchemy (async), PostgreSQL, Redis
- Frontend: `frontend` (React + Vite, served by Nginx)
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
- `backend` (Gunicorn + Uvicorn, single worker by default for websocket consistency)
- `db` (PostgreSQL 16)
- `redis` (queue, rate limiting)

## Local Frontend Dev

```bash
cd frontend
npm install
npm run dev
```

Frontend dev URL: http://localhost:5173

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
- API endpoints are namespaced by domain: `/api/v1/auth/*`, `/api/v1/match/*`, `/api/v1/chat/*`, `/api/v1/reports/*`.
- Docker maps the backend safely to `localhost:8000` via container port `8077`, while frontend Nginx proxies `/api`, `/uploads`, and websocket traffic.
