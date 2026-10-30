# RALLY — System Architecture Specification

## 1. Executive Summary

RALLY is an AI-powered group mobility coordination, live tracking, route intelligence, and fleet safety platform designed for convoys, group road trips, and cycling pelotons. The platform pairs a Next.js 14 frontend with a FastAPI asynchronous backend, backed by PostgreSQL/PostGIS, Redis, and Supabase Authentication.

```
┌────────────────────────────────────────────────────────────────────────┐
│                           Next.js 14 Frontend                          │
│        (App Router, TypeScript, React Google Maps / Vector Replay)     │
└───────────────────▲────────────────────────────────┬───────────────────┘
                    │ WebSocket                      │ HTTPS (REST API)
                    │ (Bidirectional Telemetry)      │ (Auth, Trips, Groups)
┌───────────────────▼───────────────────┐ ┌──────────▼───────────────────┐
│               Redis Tier              │ │          FastAPI Backend      │
│  - Ephemeral Member State Cache       │ │  - Supabase JWT Verification  │
│  - Presence & Telemetry Heartbeats    │ │  - SQLAlchemy 2.0 Async/Sync  │
│  - WebSocket Pub/Sub Broadcast Bus    │ │  - Rule-Based Intelligence    │
│  - Distributed Locks & Rate Limits    │ │  - PostGIS Geospatial Queries │
└───────────────────────────────────────┘ └──────────┬───────────────────┘
                                                     │
                                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 PostgreSQL 15+ with PostGIS Extension                  │
│                                                                        │
│  - Profiles & Group Membership        - Immutable Location History     │
│  - Safety Alerts & SOS Incidents      - Persisted User Safety Settings │
│  - Planned Routes & Analytics         - Deduplicated Notifications     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Technology Stack & Responsibilities

| Tier | Technologies | Core Responsibilities |
|---|---|---|
| **Frontend** | Next.js 14 (App Router), TypeScript, Tailwind CSS, Lucide Icons, Web Audio API | Live map navigation, one-tap SOS triggers, route scrubbing & GPS replay, group health telemetry HUD, audio chime synthesis. |
| **Backend API** | Python 3.11+, FastAPI, Pydantic v2, Starlette | REST resource endpoints, dependency-based authentication and authorization, rate limiting, error standardization. |
| **Data & ORM** | PostgreSQL 15, PostGIS, SQLAlchemy 2.0, Alembic | Relational data persistence, spatial geometry calculations (`ST_DWithin`, `ST_Distance`), migrations. |
| **Real-time** | Redis 7 (asyncio), WebSockets | Sub-second telemetry broadcast, active presence heartbeats, state deduplication. |
| **Authentication** | Supabase Auth (JWT) | Asymmetric JWT validation (`sub` to `profiles.id`), row-level security alignment. |

---

## 3. Communication Pipeline: REST vs WebSocket

RALLY adheres strictly to an **HTTP for Initial State / Mutations, WebSocket for Live Updates** split:

1. **HTTP REST Pipeline (`/api/v1`)**:
   - Authenticated via `Authorization: Bearer <supabase_jwt>`.
   - Used for group creation/joining, trip lifecycle (`start`, `end`), user settings persistence, and heavy analytical history retrieval.
   - All mutations return confirmed backend state before the UI reflects success.

2. **WebSocket Pipeline (`/ws/trips/{trip_id}?token=<jwt>`)**:
   - Clients connect upon entering an active trip.
   - Incoming client messages: `location_update` (frequency capped at `MAX_LOCATION_UPDATES_PER_SECOND`), `presence_ping`.
   - Outgoing server broadcasts: `trip_state` (initial synchronization), `location_update`, `presence_update`, `alert`, `sos`, `route_deviation`.

---

## 4. Security & Authorization Architecture

- **Identity Verification**: Every protected route resolves `get_current_user_id` from the Supabase JWT.
- **Group Scoping (`require_group_member`)**: Ensures callers can only access groups they actively belong to. Unaffiliated callers receive standard 404 responses to prevent group existence scanning.
- **Role Enforcement (`require_group_leader`)**: Leader-only operations (route modification, member ejection, leadership transfer) verify `group_members.role == 'LEADER'`.
- **Settings Isolation**: User settings (`/api/v1/settings`) can only be queried or patched by the authenticated token owner.
- **Trip Privacy**: Location history and replay endpoints verify that the requesting user belongs to the trip's group.

---

## 5. Resilience & Graceful Degradation

- **Redis Offline Fallback**: If Redis becomes unavailable, `build_dashboard()` gracefully falls back to PostgreSQL historical mode without crashing.
- **Audio Autoplay Resilience**: The Web Audio engine catches browser interaction restrictions and resumes gracefully upon the user's first touch or click.
- **Map Fallback**: If a Google Maps API key is not configured in local development, `RouteReplayMap` seamlessly renders a vector canvas visualizer with scrubber controls.
