"""
Live (Redis-backed) trip state: current location per user + the set of
users who have one. This is deliberately NOT the historical record —
that's location_history in Postgres (see app/services/location_service.py).
Nothing here is ever treated as durable; every write here has (or is
covered by) a TTL, and losing it entirely just means live tracking
resets, not data loss.
"""

import json
import logging
import uuid
from typing import Any, Dict, List, Optional

import redis.exceptions
from redis.asyncio import Redis
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.redis_keys import live_location_key, presence_key, trip_users_key

logger = logging.getLogger("rally.services.live_state")


def _fetch_locations_from_db(
    trip_id: uuid.UUID,
    user_ids: Optional[List[uuid.UUID]] = None,
    db: Optional[Session] = None,
) -> Dict[str, Dict[str, Any]]:
    """Fallback: query active member locations directly from Supabase PostgreSQL tables."""
    def _run_query(session: Session) -> Dict[str, Dict[str, Any]]:
        from app.models.location_history import LocationHistory

        stmt = (
            select(LocationHistory)
            .where(LocationHistory.trip_id == trip_id)
            .order_by(LocationHistory.user_id, desc(LocationHistory.recorded_at))
        )
        if user_ids:
            stmt = stmt.where(LocationHistory.user_id.in_(user_ids))

        rows = session.scalars(stmt).all()
        results: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            uid_str = str(row.user_id)
            if uid_str not in results:
                results[uid_str] = {
                    "user_id": uid_str,
                    "trip_id": str(row.trip_id),
                    "latitude": row.latitude,
                    "longitude": row.longitude,
                    "accuracy": row.accuracy,
                    "speed": row.speed,
                    "heading": row.heading,
                    "recorded_at": row.recorded_at.isoformat() if hasattr(row.recorded_at, "isoformat") else str(row.recorded_at),
                    "updated_at": row.created_at.isoformat() if hasattr(row.created_at, "isoformat") else str(row.created_at),
                }
        return results

    if db is not None:
        try:
            return _run_query(db)
        except Exception as exc:
            logger.warning("DB fallback failed to fetch locations for trip %s: %s", trip_id, exc)
            return {}

    try:
        from app.core.database import SessionLocal
        if SessionLocal is None:
            return {}
        with SessionLocal() as session:
            return _run_query(session)
    except Exception as exc:
        logger.warning("DB fallback session failed to fetch locations for trip %s: %s", trip_id, exc)
        return {}


def _fetch_active_user_ids_from_db(
    trip_id: uuid.UUID,
    db: Optional[Session] = None,
) -> set:
    """Fallback: active user IDs for a trip inferred from location_history."""
    def _run_query(session: Session) -> set:
        from app.models.location_history import LocationHistory

        stmt = select(LocationHistory.user_id).where(LocationHistory.trip_id == trip_id).distinct()
        rows = session.scalars(stmt).all()
        return {str(uid) for uid in rows}

    if db is not None:
        try:
            return _run_query(db)
        except Exception as exc:
            logger.warning("DB fallback failed to fetch active user IDs for trip %s: %s", trip_id, exc)
            return set()

    try:
        from app.core.database import SessionLocal
        if SessionLocal is None:
            return set()
        with SessionLocal() as session:
            return _run_query(session)
    except Exception as exc:
        logger.warning("DB fallback session failed to fetch active user IDs for trip %s: %s", trip_id, exc)
        return set()


def _serialize_location(
    user_id: uuid.UUID,
    trip_id: uuid.UUID,
    latitude: float,
    longitude: float,
    accuracy: Optional[float],
    speed: Optional[float],
    heading: Optional[float],
    recorded_at: str,
    updated_at: str,
) -> str:
    return json.dumps(
        {
            "user_id": str(user_id),
            "trip_id": str(trip_id),
            "latitude": latitude,
            "longitude": longitude,
            "accuracy": accuracy,
            "speed": speed,
            "heading": heading,
            "recorded_at": recorded_at,
            "updated_at": updated_at,
        }
    )


async def set_live_location(
    redis: Optional[Redis],
    trip_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    latitude: float,
    longitude: float,
    accuracy: Optional[float],
    speed: Optional[float],
    heading: Optional[float],
    recorded_at: str,
    updated_at: str,
    ttl_seconds: Optional[int] = None,
) -> None:
    """Overwrites the user's current location and (re)sets its TTL — every
    update refreshes the clock, so an actively-tracking user never goes
    stale mid-trip. Also adds the user to the trip's live-users set."""
    if redis is None:
        return
    ttl = ttl_seconds if ttl_seconds is not None else settings.LIVE_LOCATION_TTL_SECONDS
    payload = _serialize_location(
        user_id, trip_id, latitude, longitude, accuracy, speed, heading, recorded_at, updated_at
    )
    try:
        async with redis.pipeline(transaction=True) as pipe:
            pipe.set(live_location_key(trip_id, user_id), payload, ex=ttl)
            pipe.sadd(trip_users_key(trip_id), str(user_id))
            await pipe.execute()
    except (redis.exceptions.TimeoutError, redis.exceptions.ConnectionError, Exception) as exc:
        logger.warning("Redis set_live_location failed for trip %s, user %s: %s", trip_id, user_id, exc)


async def get_live_location(
    redis: Optional[Redis],
    trip_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Optional[Session] = None,
) -> Optional[Dict[str, Any]]:
    if redis is not None:
        try:
            raw = await redis.get(live_location_key(trip_id, user_id))
            if raw is not None:
                return json.loads(raw)
        except (redis.exceptions.TimeoutError, redis.exceptions.ConnectionError, Exception) as exc:
            logger.warning("Redis get_live_location failed for trip %s, user %s: %s", trip_id, user_id, exc)

    locations = _fetch_locations_from_db(trip_id, [user_id], db=db)
    return locations.get(str(user_id))


async def get_live_locations(
    redis: Optional[Redis],
    trip_id: uuid.UUID,
    user_ids: List[uuid.UUID],
    db: Optional[Session] = None,
) -> Dict[str, Dict[str, Any]]:
    """Bulk read for building a trip_state snapshot — one round trip
    (MGET) instead of one GET per member. Falls back to PostgreSQL
    location_history if Redis fails or is unavailable."""
    if not user_ids:
        return {}

    result: Dict[str, Dict[str, Any]] = {}
    redis_failed = False
    if redis is not None:
        try:
            keys = [live_location_key(trip_id, uid) for uid in user_ids]
            values = await redis.mget(keys)
            for user_id, raw in zip(user_ids, values):
                if raw is not None:
                    result[str(user_id)] = json.loads(raw)
        except (redis.exceptions.TimeoutError, redis.exceptions.ConnectionError, Exception) as exc:
            logger.warning("Redis get_live_locations (mget) failed for trip %s: %s", trip_id, exc)
            redis_failed = True
    else:
        redis_failed = True

    if redis_failed or len(result) < len(user_ids):
        missing_ids = [uid for uid in user_ids if str(uid) not in result] if not redis_failed else user_ids
        if missing_ids:
            db_locations = _fetch_locations_from_db(trip_id, missing_ids, db=db)
            for k, v in db_locations.items():
                if k not in result:
                    result[k] = v

    return result


async def get_active_user_ids(
    redis: Optional[Redis],
    trip_id: uuid.UUID,
    db: Optional[Session] = None,
) -> set:
    if redis is not None:
        try:
            return await redis.smembers(trip_users_key(trip_id))
        except (redis.exceptions.TimeoutError, redis.exceptions.ConnectionError, Exception) as exc:
            logger.warning("Redis get_active_user_ids (smembers) failed for trip %s: %s", trip_id, exc)

    return _fetch_active_user_ids_from_db(trip_id, db=db)


async def clear_trip_state(redis: Optional[Redis], trip_id: uuid.UUID, user_ids: List[uuid.UUID]) -> None:
    """Called when a trip ends (COMPLETED/CANCELLED). Removes every piece
    of live state for the trip — locations, presence, the active-users
    set."""
    if redis is None:
        return
    keys = [trip_users_key(trip_id)]
    for uid in user_ids:
        keys.append(live_location_key(trip_id, uid))
        keys.append(presence_key(trip_id, uid))
    if keys:
        try:
            await redis.delete(*keys)
        except (redis.exceptions.TimeoutError, redis.exceptions.ConnectionError, Exception) as exc:
            logger.warning("Redis clear_trip_state failed for trip %s: %s", trip_id, exc)
