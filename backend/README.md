# RALLY Backend

FastAPI backend for RALLY. Supabase Postgres + PostGIS is the primary database;
Supabase Auth is the identity provider. FastAPI never stores passwords
and never issues its own tokens — it cryptographically verifies tokens issued by Supabase Auth.

---

## Authentication

```
Next.js  --(email/password or OAuth)-->  Supabase Auth
Next.js  <--(access token)--  Supabase Auth
Next.js  --(Authorization: Bearer <token>)-->  FastAPI
FastAPI  --(verify signature, expiry, audience, issuer)-->  Authenticated user
```

1. The frontend authenticates via `supabase-js` (`signInWithPassword`, OAuth, etc.).
2. Supabase returns a JWT access token to the frontend.
3. The frontend attaches the token on every request:
   ```
   Authorization: Bearer <SUPABASE_ACCESS_TOKEN>
   ```
4. FastAPI validates the token in `app/core/security.py` checking signature, expiration, audience (`authenticated`), and issuer.
5. `get_current_user()` returns `{id, email}`. `get_current_profile()` resolves the matching row in `profiles`.

---

## REST API Overview

### 1. Settings & Preferences (`/api/v1/settings`)
Authenticated user settings persisted in PostgreSQL (`user_settings` table, migration `0008`):
* `GET /api/v1/settings`: Fetch current user's preferences and threshold configuration.
* `PATCH /api/v1/settings`: Update alert sensitivity (`LOW`, `MEDIUM`, `HIGH`), separation distance threshold, route deviation threshold, notification category toggles, and audio alerts.

### 2. Emergency SOS (`/api/v1/trips/{trip_id}/sos` & `/api/v1/sos`)
* `POST /api/v1/trips/{trip_id}/sos`: Trigger emergency SOS with device GPS coordinates and note.
* `GET /api/v1/trips/{trip_id}/sos/history`: List emergency incident history for a trip.
* `GET /api/v1/groups/{group_id}/sos/active`: Query active unresolved SOS events for the group.
* `POST /api/v1/sos/{sos_id}/acknowledge`: Group member acknowledges seeing the emergency.
* `POST /api/v1/sos/{sos_id}/resolve`: Resolves the emergency incident.
* `POST /api/v1/sos/{sos_id}/cancel`: Only the creator of the SOS can cancel their active request.

### 3. Groups & Leadership Transfer (`/api/v1/groups`)
* `POST /api/v1/groups`: Create a new group (creator becomes `LEADER`).
* `GET /api/v1/groups/{group_id}`: Fetch group details and active members.
* `POST /api/v1/groups/{group_id}/transfer-leadership`: Leader transfers authority to another active member.
* `POST /api/v1/groups/{group_id}/leave`: Member leaves group (requires leadership transfer if leader).

### 4. Trips & History (`/api/v1/trips`)
* `POST /api/v1/groups/{group_id}/trips`: Create a trip (`CREATED`).
* `POST /api/v1/trips/{trip_id}/start`: Start a trip (`CREATED -> ACTIVE`).
* `POST /api/v1/trips/{trip_id}/end`: Conclude a trip (`ACTIVE -> COMPLETED`).
* `POST /api/v1/trips/{trip_id}/cancel`: Cancel a pending trip (`CREATED -> CANCELLED`).
* `GET /api/v1/trips/history`: List completed trips strictly scoped to the authenticated user.

### 5. GPS Locations (`/api/v1/trips/{trip_id}/locations`)
* `POST /api/v1/trips/{trip_id}/locations`: Record breadcrumb point while trip is `ACTIVE`. Coordinates stored as latitude/longitude floats and PostGIS `GEOGRAPHY(POINT, 4326)`.
* `GET /api/v1/trips/{trip_id}/locations`: Chronological GPS history supporting pagination via `cursor` and `limit`.

### 6. Analytics & Group Health Telemetry
* `GET /api/v1/trips/{trip_id}/analytics/dashboard`: Returns real-time metrics:
  * Overall group health score (0–100)
  * Togetherness percentage
  * On-route compliance percentage
  * Member connectivity percentage
  * Movement stability percentage
  * Active alert counts & composite risk tier (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`)

---

## WebSockets

Real-time bi-directional streaming for live tracking and alerts:
* **Endpoint**: `/ws/groups/{group_id}?token=<SUPABASE_JWT>`
* **Authentication**: Token validated on handshake connection.
* **Message Types**:
  * Client -> Server: `location_update` (latitude, longitude, speed, heading), `ping`
  * Server -> Client: `location_update`, `alert`, `sos`, `connection_status`, `pong`

---

## Intelligence Engine

The backend runs an asynchronous background worker (`app/intelligence/worker.py`) that monitors active trips:
* **Separation Detector**: Detects when a member exceeds the leader's configured separation threshold.
* **Route Deviation Detector**: Calculates cross-track distance using Haversine formulas against route polylines.
* **Stop Detection**: Flags unexpected stationary intervals along the route.
* **Dynamic Sensitivity**: Leader's `alert_sensitivity` adjusts distance thresholds and time-to-alert intervals dynamically.

---

## Local Development & Testing

```bash
# 1. Activate virtual environment
python -m venv venv
venv\Scripts\activate            # macOS/Linux: source venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run database migrations
alembic upgrade head

# 4. Start API server
uvicorn app.main:app --reload --port 8000

# 5. Execute test suite
pytest -v
```
