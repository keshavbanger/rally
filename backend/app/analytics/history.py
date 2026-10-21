"""Trip history — GET /users/me/trips, GET /groups/{group_id}/trips.

"Participated"/"belongs to this group" is scoped the same way every other
trip-scoped endpoint in this API scopes membership: the authenticated
user (or, for group history, anyone asking) must be a currently ACTIVE
member of the trip's group — see require_trip_member /
require_group_member elsewhere in this codebase. A user who has since
left a group stops seeing that group's trip history, consistent with
every other endpoint's authorization model; this is a documented scope
choice, not an oversight (see the backend README).
"""

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import String, func, or_, select
from sqlalchemy.orm import Session

from app.analytics import queries
from app.analytics.snapshot import get_snapshot
from app.core.config import settings
from app.models.enums import MemberStatus, TripStatus
from app.models.group_member import GroupMember
from app.models.trip import Trip
from app.route.service import get_route_by_trip
from app.schemas.analytics import TripHistoryItem, TripHistoryResponse


def _apply_filters(
    stmt,
    *,
    status: Optional[Any],
    from_time: Optional[datetime],
    to_time: Optional[datetime],
    completed_or_ended_default: bool = False,
):
    status_expr = func.upper(func.cast(Trip.status, String))
    if status is not None:
        status_str = status.value if hasattr(status, "value") else str(status)
        status_clean = status_str.strip().upper()
        if status_clean == "ALL":
            pass
        elif status_clean in ("COMPLETED", "ENDED"):
            stmt = stmt.where(
                or_(
                    Trip.status == TripStatus.COMPLETED,
                    status_expr.in_(["COMPLETED", "ENDED"]),
                    Trip.ended_at.isnot(None),
                )
            )
        elif status_clean in TripStatus.__members__:
            stmt = stmt.where(Trip.status == TripStatus[status_clean])
        else:
            stmt = stmt.where(status_expr == status_clean)
    elif completed_or_ended_default:
        stmt = stmt.where(
            or_(
                Trip.status == TripStatus.COMPLETED,
                status_expr.in_(["COMPLETED", "ENDED"]),
                Trip.ended_at.isnot(None),
            )
        )

    if from_time is not None:
        stmt = stmt.where(Trip.created_at >= from_time)
    if to_time is not None:
        stmt = stmt.where(Trip.created_at <= to_time)
    return stmt


def _distance_for_history_item(db: Session, trip: Trip) -> Optional[float]:
    """Prefers the immutable snapshot for a COMPLETED trip (an O(1) read
    instead of re-scanning that trip's location_history on every page of
    every history request) and only recomputes live when there isn't one
    (a non-COMPLETED trip, or a COMPLETED trip that predates snapshot
    generation)."""
    if trip.status == TripStatus.COMPLETED:
        snapshot = get_snapshot(db, trip.id)
        if snapshot is not None:
            return snapshot.distance_traveled_meters

    points_by_user = queries.fetch_location_points(db, trip.id)
    if not points_by_user:
        return None
    distances = queries.compute_distances_by_user(
        points_by_user, max_speed_mps=settings.MAX_ANALYTICS_SPEED_MPS, max_accuracy_meters=settings.MIN_USABLE_ACCURACY_METERS
    )
    leader_id = queries.get_group_leader_id(db, trip.group_id)
    return queries.pick_representative_value(distances, leader_id)


def _serialize(db: Session, trip: Trip) -> TripHistoryItem:
    member_count = len(queries.list_active_group_members(db, trip.group_id))
    distance = _distance_for_history_item(db, trip)

    # Coerce distance_meters to int safely (guards against float/Decimal/None)
    dist_m: Optional[float] = None
    if distance is not None:
        try:
            dist_m = round(float(distance))
        except (TypeError, ValueError):
            dist_m = None
    elif trip.distance is not None:
        try:
            dist_m = round(float(trip.distance) * 1000)
        except (TypeError, ValueError):
            dist_m = None

    # Coerce duration to int minutes safely
    duration_min: Optional[int] = None
    raw_duration = getattr(trip, "duration", None)
    if raw_duration is not None:
        try:
            duration_min = int(raw_duration)
        except (TypeError, ValueError):
            duration_min = None
    if duration_min is None and trip.started_at and trip.ended_at:
        try:
            duration_min = max(0, int((trip.ended_at - trip.started_at).total_seconds() // 60))
        except (TypeError, ValueError, AttributeError):
            duration_min = None

    route_details = None
    try:
        route = get_route_by_trip(db, trip.id)
        if route:
            # Safely extract route geometry/coordinates — handles PostGIS
            # geometry objects, lists, iterables, or None; never raises.
            raw_coords = getattr(route, "coordinates", None)
            if raw_coords is None:
                raw_coords = []
            elif isinstance(raw_coords, list):
                pass  # already fine
            elif hasattr(raw_coords, "__geo_interface__"):
                # GeoAlchemy2 / Shapely geometry with __geo_interface__
                try:
                    raw_coords = raw_coords.__geo_interface__.get("coordinates", [])
                except Exception:
                    raw_coords = []
            elif hasattr(raw_coords, "__iter__"):
                try:
                    raw_coords = list(raw_coords)
                except Exception:
                    raw_coords = []
            else:
                raw_coords = []

            # Ensure every element is serializable (no PostGIS sub-objects)
            try:
                raw_coords = [list(c) if hasattr(c, "__iter__") and not isinstance(c, (str, bytes)) else c for c in raw_coords]
            except Exception:
                raw_coords = []

            status_val = "PLANNED"
            if hasattr(route, "status"):
                sv = route.status
                status_val = sv.value if hasattr(sv, "value") else str(sv)

            dist_meters_val = getattr(route, "distance_meters", None)
            if dist_meters_val is None:
                dist_meters_val = 0.0
            try:
                dist_meters_val = float(dist_meters_val)
            except (TypeError, ValueError):
                dist_meters_val = 0.0

            route_details = {
                "id": str(route.id) if getattr(route, "id", None) is not None else None,
                "name": getattr(route, "name", None) or trip.destination_name,
                "origin_latitude": getattr(route, "origin_latitude", None),
                "origin_longitude": getattr(route, "origin_longitude", None),
                "destination_latitude": getattr(route, "destination_latitude", None),
                "destination_longitude": getattr(route, "destination_longitude", None),
                "distance_meters": dist_meters_val,
                "estimated_duration_seconds": getattr(route, "estimated_duration_seconds", None),
                "status": status_val,
                "coordinates": raw_coords,
            }
    except Exception:
        route_details = None

    # Coerce status to string safely (handles TripStatus enum or raw string)
    status_str = "COMPLETED"
    if trip.status is not None:
        sv = trip.status
        status_str = sv.value if hasattr(sv, "value") else str(sv)

    # Coerce distance_km (trip.distance) and duration safely
    trip_distance_km: Optional[float] = None
    if trip.distance is not None:
        try:
            trip_distance_km = float(trip.distance)
        except (TypeError, ValueError):
            trip_distance_km = None

    distance_km_final = trip_distance_km if trip_distance_km is not None else (
        round(dist_m / 1000, 2) if dist_m is not None else None
    )

    # Coerce safety_score to int
    safety_score_val: Optional[int] = None
    raw_ss = getattr(trip, "safety_score", None)
    if raw_ss is not None:
        try:
            safety_score_val = int(raw_ss)
        except (TypeError, ValueError):
            safety_score_val = None

    return TripHistoryItem(
        trip_id=trip.id,
        name=trip.destination_name,
        destination_name=trip.destination_name,
        status=status_str,
        started_at=trip.started_at,
        ended_at=trip.ended_at,
        member_count=member_count or 0,
        distance_meters=dist_m,
        distance=distance_km_final,
        duration=duration_min,
        duration_seconds=int(duration_min * 60) if duration_min is not None else None,
        safety_score=safety_score_val,
        route=route_details,
    )



def _paginate(
    db: Session,
    base_stmt,
    *,
    status: Optional[Any],
    from_time: Optional[datetime],
    to_time: Optional[datetime],
    limit: int,
    offset: int,
    completed_or_ended_default: bool = False,
) -> TripHistoryResponse:
    filtered = _apply_filters(
        base_stmt,
        status=status,
        from_time=from_time,
        to_time=to_time,
        completed_or_ended_default=completed_or_ended_default,
    )

    total = db.scalar(select(func.count()).select_from(filtered.subquery())) or 0
    rows = db.scalars(filtered.order_by(Trip.created_at.desc()).limit(limit).offset(offset)).all()
    items = [_serialize(db, trip) for trip in rows]
    return TripHistoryResponse(items=items, total=total, limit=limit, offset=offset)


def list_user_trip_history(
    db: Session,
    user_id: uuid.UUID,
    *,
    status: Optional[Any] = None,
    from_time: Optional[datetime] = None,
    to_time: Optional[datetime] = None,
    limit: int,
    offset: int,
    completed_or_ended_default: bool = True,
) -> TripHistoryResponse:
    member_group_ids = select(GroupMember.group_id).where(
        GroupMember.user_id == user_id
    )
    base_stmt = select(Trip).where(
        or_(
            Trip.group_id.in_(member_group_ids),
            Trip.started_by == user_id,
        )
    )
    return _paginate(
        db,
        base_stmt,
        status=status,
        from_time=from_time,
        to_time=to_time,
        limit=limit,
        offset=offset,
        completed_or_ended_default=completed_or_ended_default,
    )


def list_group_trip_history(
    db: Session,
    group_id: uuid.UUID,
    *,
    status: Optional[Any] = None,
    from_time: Optional[datetime] = None,
    to_time: Optional[datetime] = None,
    limit: int,
    offset: int,
) -> TripHistoryResponse:
    base_stmt = select(Trip).where(Trip.group_id == group_id)
    return _paginate(db, base_stmt, status=status, from_time=from_time, to_time=to_time, limit=limit, offset=offset)
