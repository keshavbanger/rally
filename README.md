# RALLY

RALLY is a group mobility & safety platform: create a group, start a trip
together, and track everyone's location on a shared live map — with alerts
for falling behind, separation, route deviation, and a one-tap SOS.

This repo is a monorepo: a Next.js frontend (currently mock-data-driven)
and a FastAPI backend (real, backed by Supabase Postgres/PostGIS) that the
frontend will progressively be wired up to.

## Structure

```
frontend/          Next.js 14 (App Router) + TypeScript + Tailwind + Framer Motion
backend/           FastAPI + Supabase Postgres/PostGIS + SQLAlchemy + Alembic
packages/shared/   Design tokens, distance/speed formatting, Haversine helper
packages/types/    Shared TypeScript types (User, Group, Trip, Alert, SOS, ...)
docs/              Technical specifications and database documentation
```

`packages/types` currently models the platform's intended full shape
(risk scoring, recommendations, realtime events) — the backend implements
this incrementally phase by phase; see `backend/README.md` for what's
actually built versus still ahead.

## Documentation

- **[Schema Specification](SCHEMA.md)** — Comprehensive data dictionary, PostGIS spatial types, partial unique indexes, and Redis ephemeral schema (also mirrored at `docs/database.md`).
- **[Database ERD](docs/DATABASE_ERD.md)** — Entity-relationship diagram and constraint mapping.
- **[Backend Guide](backend/README.md)** — Authentication flow, REST API endpoints, and WebSocket protocol.

## Getting Started

### Prerequisites
- **Node.js**: v18+ and `npm`
- **Python**: 3.11+ (with `venv`)
- **Supabase**: A Supabase project with Postgres + PostGIS enabled
- **Redis**: Running locally or via Docker (`redis-server` on port 6379)

### 1. Environment Setup

Configure both backend and frontend environment files:

```bash
# Backend credentials
cp backend/.env.example backend/.env
# Fill in DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET

# Frontend credentials
cp frontend/.env.local.example frontend/.env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
```

---

### 2. Option A: Quickstart (From Monorepo Root)

You can launch both services directly from the repository root:

```bash
# Install root and workspace dependencies
npm install

# Terminal 1: Start FastAPI backend (port 8000)
npm run dev:backend

# Terminal 2: Start Next.js frontend (port 3000)
npm run dev:web
```

---

### 3. Option B: Manual Setup (Separate Terminals)

#### Backend (Terminal 1)

> **Important**: Always navigate into the `backend/` directory before running Alembic migrations or Uvicorn!

```bash
# 1. Navigate to backend directory
cd backend

# 2. Create and activate a Python virtual environment
python3 -m venv venv
source venv/bin/activate       # On Windows: venv\Scripts\activate

# 3. Install Python dependencies
pip install -r requirements.txt

# 4. Apply database migrations
alembic upgrade head

# 5. Start development API server
uvicorn app.main:app --reload --port 8000
```

- API Base: [http://localhost:8000](http://localhost:8000)
- Interactive API Docs: [http://localhost:8000/docs](http://localhost:8000/docs)
- Health Check: [http://localhost:8000/api/v1/health](http://localhost:8000/api/v1/health)

#### Frontend (Terminal 2)

```bash
# 1. Navigate to frontend directory
cd frontend

# 2. Install dependencies
npm install

# 3. Start Next.js dev server
npm run dev
```

- Web App: [http://localhost:3000](http://localhost:3000)

---

### 4. Running Migrations & Tests

- **Run Alembic Migrations**:
  - From `backend/`: `alembic upgrade head`
  - From repository root: `alembic -c backend/alembic.ini upgrade head`
- **Run Backend Tests**:
  - From repository root: `npm run test:api`
  - From `backend/`: `pytest tests/`

---

### 5. Troubleshooting & Common Gotchas

- **`FAILED: No 'script_location' key found in configuration.`**
  - This happens when running `alembic` from the repository root where no `alembic.ini` resides.
  - **Solution**: Either `cd backend` first, or specify the config path: `alembic -c backend/alembic.ini upgrade head`.

- **`ERROR: [Errno 48] Address already in use` (Port 8000 or 3000)**
  - Another process is already running on that port.
  - **Solution**: Find and stop the process:
    ```bash
    # Find process ID
    lsof -i :8000
    # Stop process
    kill -9 <PID>
    ```

- **`ModuleNotFoundError: No module named 'app'`**
  - Uvicorn was run outside the `backend/` folder without specifying the app directory.
  - **Solution**: Run `cd backend` before `uvicorn app.main:app --reload`, or use `uvicorn --app-dir backend app.main:app --reload --port 8000`.

## Security notes

- `SUPABASE_SERVICE_ROLE_KEY` exists only in backend environment variables —
  never in frontend code, never returned in an API response.
- The backend never trusts a user id from a request body/query string —
  every identity comes from a verified Supabase JWT.
- Never commit `.env`.
