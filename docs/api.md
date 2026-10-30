# RALLY — REST & WebSocket API Specification

All REST endpoints are prefixed with `/api/v1` and require `Authorization: Bearer <token>` unless explicitly marked public.

---

## 1. Authentication & User Profile

### `GET /api/v1/auth/me`
Retrieve profile of currently authenticated user.
- **Response**: `200 OK`
  ```json
  {
    "id": "uuid",
    "email": "user@example.com",
    "full_name": "Alex Hunter",
    "avatar_url": null,
    "created_at": "2026-10-30T00:00:00Z"
  }
  ```

### `PATCH /api/v1/auth/me`
Update profile metadata (e.g. `full_name`).

---

## 2. Groups & Membership

### `GET /api/v1/groups`
List groups the authenticated user actively belongs to.

### `POST /api/v1/groups`
Create a new RALLY group. The creator automatically receives `LEADER` role.
- **Payload**:
  ```json
  {
    "name": "Weekend Expedition",
    "destination_name": "Manali Peak",
    "latitude": 32.2396,
    "longitude": 77.1887
  }
  ```

### `POST /api/v1/groups/join`
Join an existing group using a 6-character alphanumeric `join_code`.

### `GET /api/v1/groups/{group_id}/members`
List all active members in the group with roles (`LEADER`, `MEMBER`).

### `POST /api/v1/groups/{group_id}/transfer-leadership`
Transfer group leadership to another active member. Requires caller to be current leader.
- **Payload**:
  ```json
  { "new_leader_id": "uuid" }
  ```
- **Response**: `204 No Content`

### `POST /api/v1/groups/{group_id}/leave`
Leave a group. Leaders must transfer leadership before leaving or receive `400 Bad Request`.

### `DELETE /api/v1/groups/{group_id}/members/{user_id}`
Remove a member from the group. Leader-only.

---

## 3. Trips & Telemetry Ingestion

### `POST /api/v1/trips`
Create or schedule a trip for a group.

### `POST /api/v1/trips/{trip_id}/start`
Transition trip status to `ACTIVE`.

### `POST /api/v1/trips/{trip_id}/end`
End an active trip, compute final analytics snapshot, and mark status `COMPLETED`.

### `POST /api/v1/trips/{trip_id}/locations`
Ingest a GPS breadcrumb via REST (alternative to WebSocket).
- **Payload**:
  ```json
  {
    "latitude": 32.2412,
    "longitude": 77.1895,
    "accuracy": 4.5,
    "speed": 14.2,
    "heading": 185.0,
    "recorded_at": "2026-10-30T10:14:00Z"
  }
  ```

### `GET /api/v1/trips/{trip_id}/locations`
Retrieve chronological GPS breadcrumbs for trip replay (`limit` up to 1000).

### `GET /api/v1/trips/history`
Retrieve completed trips belonging to the authenticated user's groups.

---

## 4. Emergency SOS & Safety Alerts

### `POST /api/v1/trips/{trip_id}/sos`
Activate One-Tap Emergency SOS. Broadcasts immediately over WebSocket.
- **Payload**:
  ```json
  {
    "latitude": 32.2412,
    "longitude": 77.1895,
    "message": "Flat tire on steep incline."
  }
  ```

### `GET /api/v1/trips/{trip_id}/sos/active`
List all currently unresolved SOS events for the trip.

### `POST /api/v1/sos/{sos_id}/acknowledge`
Acknowledge an emergency.

### `POST /api/v1/sos/{sos_id}/resolve`
Resolve an emergency once safety is restored.

### `POST /api/v1/sos/{sos_id}/cancel`
Cancel an SOS (initiator only).

### `GET /api/v1/trips/{trip_id}/alerts/active`
List active safety alerts (route deviations, falling behind, sudden stops).

### `POST /api/v1/alerts/{alert_id}/acknowledge`
Mark alert as acknowledged.

### `POST /api/v1/alerts/{alert_id}/resolve`
Mark alert as resolved.

---

## 5. User Settings & Safety Thresholds

### `GET /api/v1/settings`
Retrieve authenticated user's persisted safety thresholds, preferences, and notification toggles.
- **Response**: `200 OK`
  ```json
  {
    "user_id": "uuid",
    "alert_sensitivity": "MEDIUM",
    "separation_threshold_m": 150.0,
    "route_deviation_threshold_m": 100.0,
    "notifications_alerts": true,
    "notifications_sos": true,
    "notifications_connectivity": true,
    "notifications_trip_summaries": false,
    "sound_alerts_enabled": true,
    "location_sharing": true,
    "theme": "dark",
    "units": "Metric"
  }
  ```

### `PATCH /api/v1/settings`
Update user safety thresholds or notification delivery options. Validates ranges on backend.

---

## 6. Dashboard & Analytics

### `GET /api/v1/trips/{trip_id}/dashboard`
The primary composite telemetry endpoint. Combines:
- `trip`: Status and metadata.
- `route`: Planned distance, progress %, remaining meters, ETA.
- `group`: Member counts, live movement states.
- `safety`: Active alerts count, critical alerts, active SOS.
- `group_health`: Composite 0–100 health score, togetherness %, on-route %, connectivity %, stability %.
- `risk`: Deterministic risk score and label.

---

## 7. WebSocket Protocol (`/ws/trips/{trip_id}?token=<jwt>`)

Clients connect with their Supabase access token.

### Client Messages:
- `location_update`: `{ "latitude": float, "longitude": float, "speed": float, "heading": float, "accuracy": float }`
- `presence_ping`: `{ "timestamp": string }`

### Server Messages:
- `trip_state`: Snapshot of all live members upon connection.
- `location_update`: Member position update.
- `presence_update`: Online / Offline status change.
- `alert`: New real-time alert event.
- `sos`: New emergency SOS event.
- `route_deviation`: Route corridor departure detection.
