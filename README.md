# RALLY — Group Mobility Intelligence & Safety Platform

RALLY is an AI-powered real-time group mobility coordination, live tracking, route intelligence, and safety platform. Create a group, embark on trips together, track everyone's live location on a shared tactical map, and receive proactive safety alerts for group separation, route deviation, stop detection, and one-tap emergency SOS.

The project is built as a high-performance monorepo: a **Next.js 14** (App Router) frontend, a **FastAPI** backend backed by **PostgreSQL/PostGIS** and **Supabase Auth**, real-time **WebSockets**, and background intelligence detection.

---

## Architecture & Tech Stack

```
frontend/          Next.js 14 (App Router) + TypeScript + Tailwind CSS + Web Audio API
backend/           FastAPI + PostgreSQL / PostGIS + SQLAlchemy + Alembic + WebSockets
packages/shared/   Design tokens, distance/speed formatters, Haversine spatial math
packages/types/    Shared TypeScript contracts (User, Group, Trip, Alert, SOS, Telemetry)
docs/              Comprehensive architectural and API technical specifications
```

* **Frontend**: Next.js 14, React 18, Leaflet / OpenStreetMap (Esri World Dark Canvas) + Google Maps JavaScript/Places/Routes API, Lucide icons, Tailwind CSS.
* **Backend**: FastAPI, Pydantic v2, SQLAlchemy 2.0 (async), PostGIS spatial queries, JWT verification via Supabase JWKS.
* **Real-Time Communication**: Native WebSocket protocol with live heartbeat ping/pong, location broadcasting, and emergency event dispatch.
* **Safety & Intelligence**: Deterministic rule-based detection engine for member separation, route deviation, and composite group health metrics.

---

## Core Capabilities & Features

### 1. One-Tap Emergency SOS
* **Instant Broadcast**: Emergency button on active trip dashboard captures device GPS coordinates and notes.
* **Backend Persistence**: Stored via `POST /api/v1/trips/{trip_id}/sos` with active trip and membership validation.
* **Real-Time Banner**: Displays active emergencies across all group members via WebSockets.
* **Lifecycle Management**: Initiator-only cancellation (`POST /api/v1/sos/{id}/cancel`), with member acknowledgment and resolution endpoints.

### 2. Genuine Trip History
* **Zero Mock Leakage**: Authenticated users only see genuine trips they participated in (`GET /api/v1/trips/history`).
* **Complete Metadata**: Real departure and arrival times, origins, destinations, distances, durations, and safety scores.
* **Resilient UI**: Skeleton loading states, informative empty states, and explicit error retry handling.

### 3. GPS Breadcrumb Route Replay
* **Chronological Playback**: Replays recorded GPS traces (`GET /api/v1/trips/{id}/locations`) with an animated marker.
* **Interactive Scrubber**: Timeline slider with Play, Pause, Resume, Reset, and speed modifiers (1x, 2x, 5x).
* **Planned vs. Actual Paths**: Clear visual distinction between planned route lines (cyan) and actual GPS tracks (emerald).
* **Live HUD**: Displays vehicle speed in km/h and exact sample timestamps throughout playback.

### 4. Persistent User Settings & Safety Thresholds
* **Database Backed**: Saved in `user_settings` table via authenticated `GET /api/v1/settings` and `PATCH /api/v1/settings`.
* **Intelligence Integration**: Configured alert sensitivity (`LOW`, `MEDIUM`, `HIGH`), separation distance, and route deviation thresholds dynamically adjust the backend detection algorithms.
* **Notification Preferences**: Category toggles (Alerts, SOS, Connectivity, Summaries) filter server-side dispatch.

### 5. Group Health & Risk Telemetry
* **Deterministic Composite Scoring**: Real-time group health index (0–100) combining togetherness, on-route compliance, connectivity, and movement stability.
* **Data Sufficiency Handling**: Explicitly reports `INSUFFICIENT_DATA` when location updates are sparse rather than fabricating a healthy score.
* **Live Telemetry Card**: Visual progress bars and status indicators (`OPTIMAL`, `STABLE`, `ATTENTION`, `RISK`).

### 6. Group Leadership Transfer
* **Eligible Delegation**: Group leaders can transfer leadership to any active group member before leaving.
* **Transactional Integrity**: Atomic database updates ensure consistency between `groups.leader_id` and `group_members.role`.
* **Guardrails**: Prevents leaders from abandoning groups without designating a successor.

### 7. Synthesized Web Audio Alerts
* **Browser-Native Audio**: Zero external audio asset dependencies using Web Audio API synthesis.
* **Dual Tone Alerting**: Subtle harmonic chime for warnings; high-urgency alternating tone for SOS emergencies.
* **Deduplication**: Suppresses repeated sounds from duplicate WebSocket frames or React re-renders.

### 8. Hybrid Resilient Mapping System
* **Primary Google Maps**: Dynamic satellite, street, and vector tiles when `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is configured.
* **Zero-Config Tactical Fallback**: Automatically activates a dark-mode tactical map (Esri Dark Canvas & OpenStreetMap) when no API key is present or if `ApiNotActivatedMapError` occurs, eliminating setup blockers.

---

## Technical Documentation

* **[System Architecture (docs/architecture.md)](docs/architecture.md)** — Architectural layers, WebSocket life-cycle, spatial indexing, and security boundaries.
* **[API Reference (docs/api.md)](docs/api.md)** — Full REST and WebSocket API specification including payload schemas, error codes, and RBAC rules.
* **[Intelligence & Safety Engine (docs/intelligence.md)](docs/intelligence.md)** — Detector formulas, mathematical threshold scaling, and group health calculation.
* **[Database ERD (docs/DATABASE_ERD.md)](docs/DATABASE_ERD.md)** — Entity relationships, foreign keys, and cascade deletion rules.

---

## Getting Started

### Prerequisites
* **Node.js**: v18+ and `npm`
* **Python**: 3.11+ (with `venv`)
* **Supabase**: Postgres with PostGIS enabled (`CREATE EXTENSION IF NOT EXISTS postgis;`)
* **Redis** *(Optional)*: Port 6379 for live tracking cache (system degrades gracefully to database polling if omitted)

---

### 1. Environment Setup

Configure environment files for backend and frontend:

```bash
# Backend credentials
cp backend/.env.example backend/.env

# Frontend credentials
cp frontend/.env.local.example frontend/.env.local
```

#### Required Variables
* **`backend/.env`**:
  * `DATABASE_URL`: Supabase Postgres connection string (`postgresql+psycopg://...`)
  * `SUPABASE_URL`: Project URL (`https://<project-ref>.supabase.co`)
  * `SUPABASE_ANON_KEY`: Public client key
  * `SUPABASE_SERVICE_ROLE_KEY`: Server-only service role key
  * `JWT_SECRET`: Supabase JWT secret for token verification
* **`frontend/.env.local`**:
  * `NEXT_PUBLIC_API_URL`: Backend URL (`http://localhost:8000`)
  * `NEXT_PUBLIC_WS_URL`: WebSocket URL (`ws://localhost:8000`)
  * `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
  * `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon key
  * `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`: *(Optional)* Google Maps API key (automatic OpenStreetMap fallback activates if omitted)

---

### 2. Running Locally

#### Option A: Quickstart from Root
```bash
# Install all dependencies
npm install

# Start FastAPI backend (port 8000)
npm run dev:backend

# Start Next.js frontend (port 3000)
npm run dev:web
```

#### Option B: Manual Setup

**Terminal 1 — Backend**:
```bash
cd backend
python -m venv venv
venv\Scripts\activate            # macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head             # Run database migrations
uvicorn app.main:app --reload --port 8000
```
* API Base: [http://localhost:8000](http://localhost:8000)
* Interactive Swagger Docs: [http://localhost:8000/docs](http://localhost:8000/docs)
* Health Endpoint: [http://localhost:8000/api/v1/health](http://localhost:8000/api/v1/health)

**Terminal 2 — Frontend**:
```bash
cd frontend
npm install
npm run dev
```
* Web Dashboard: [http://localhost:3000](http://localhost:3000)

---

### 3. Running Automated Tests

#### Backend Test Suite (Pytest)
```bash
cd backend
pytest -v
```
Includes comprehensive test coverage for:
* One-Tap SOS creation, acknowledgement, resolution, and authorization (`test_sos_api.py`)
* Trips lifecycle, route activation, and genuine user history (`test_trips_api.py`)
* GPS breadcrumb replay and movement state (`test_replay.py`)
* Settings persistence, validation, dynamic thresholds, and telemetry (`test_settings_and_telemetry.py`)

#### Frontend Validation
```bash
cd frontend
npx tsc --noEmit                 # TypeScript static verification
npm run build                    # Production bundle verification
```

---

## Security Guarantees

* **Zero Identity Spoofing**: User identity is derived strictly from verified Supabase JWT signatures on every request. Client-supplied `user_id` values in request bodies or query strings are ignored.
* **Secret Protection**: `SUPABASE_SERVICE_ROLE_KEY` and database credentials are strictly isolated to backend environment variables.
* **Group Scoping & Authorization**: Access to trips, active alerts, locations, and member telemetry strictly verifies active group membership in PostgreSQL.
* **Defensive Schema**: Sensitive history records (`sos_events`, `trip_analytics_snapshots`, `location_history`) are protected from unintended cascading deletes.
