"""
The primary frontend dashboard endpoint — GET /trips/{trip_id}/dashboard.
Composes existing services (never re-implements their logic):

    TripService (via the `trip` argument already resolved by the router)
    RouteService     (app/route/service.py)
    LiveStateService / IntelligenceService (app/intelligence/engine.py)
    AlertService / SOSService (app/alerts/, app/sos/)
    AnalyticsService (app/analytics/route_analytics.py, queries.py)
    RiskService      (app/risk/service.py)
    EtaService       (app/route/eta.py — group ETA)
    WeatherService   (app/weather/service.py)
    NotificationService (app/notifications/service.py)

ACTIVE trips ("live" mode) combine Redis live state with route progress
computed against that live state, plus DB-backed alert/SOS counts.
Any other trip status ("historical" mode) uses PostgreSQL exclusively —
no Redis call is ever made for a non-ACTIVE trip, so historical dashboards
keep working even with Redis completely down. Risk and notifications are
DB-only either way; weather and group ETA are live-only (both need a
current location/speed a finished trip no longer has).
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Tuple

import redis.exceptions
from redis.asyncio import Redis
from sqlalchemy.orm import Session

from app.alerts import service as alerts_service
from app.analytics import queries, route_analytics
from app.intelligence import engine as intelligence_engine
from app.intelligence.thresholds import current_thresholds
from app.models.enums import RouteStatus, TripStatus
from app.models.trip import Trip
from app.notifications import service as notification_service
from app.risk.service import calculate_trip_risk
from app.route import progress as route_progress
from app.route import service as route_service
from app.route.eta import EtaService
from app.route.service import MemberRouteProgress
from app.schemas.analytics import (
    DashboardEta,
    DashboardGroup,
    DashboardGroupHealth,
    DashboardMember,
    DashboardNotifications,
    DashboardResponse,
    DashboardRisk,
    DashboardRoute,
    DashboardSafety,
    DashboardTrip,
    DashboardWeather,
    DashboardWeatherWarning,
)
from app.schemas.risk import RiskScore
from app.sos import service as sos_service
from app.weather.service import WeatherInfo, WeatherService

logger = logging.getLogger("rally.analytics.dashboard")


def _pick_representative_progress(
    members: List[MemberRouteProgress], leader_id: Optional[uuid.UUID]
) -> Optional[MemberRouteProgress]:
    """Same "leader, else median" representative rule as
    queries.pick_representative_value(), applied to a whole
    MemberRouteProgress object at once so progress_percent/
    distance_remaining_meters/eta_seconds on the dashboard's `route`
    section always come from one consistent member, never mixed."""
    leader_key = str(leader_id) if leader_id is not None else None
    if leader_key is not None:
        for member in members:
            if member.user_id == leader_key and member.match is not None:
                return member

    candidates = [m for m in members if m.match is not None]
    if not candidates:
        return None
    candidates.sort(key=lambda m: m.match.route_fraction)
    return candidates[len(candidates) // 2]


def _weather_to_dashboard(weather: WeatherInfo) -> DashboardWeather:
    return DashboardWeather(
        weather_available=weather.weather_available,
        temperature_celsius=weather.temperature_celsius,
        condition=weather.condition,
        wind_speed_mps=weather.wind_speed_mps,
        precipitation_probability_percent=weather.precipitation_probability_percent,
        visibility_meters=weather.visibility_meters,
        warnings=[DashboardWeatherWarning(type=w.type, severity=w.severity, reason=w.reason) for w in weather.warnings],
    )


def _risk_to_dashboard(risk: RiskScore) -> DashboardRisk:
    return DashboardRisk(score=risk.score, level=risk.level)


def _calculate_group_health(
    member_count: int,
    members: List[DashboardMember],
    online_count: Optional[int],
    active_alerts_count: int,
    critical_alerts_count: int,
    active_sos_count: int,
    risk_level: str,
    route_available: bool,
) -> DashboardGroupHealth:
    now = datetime.now(timezone.utc)
    if member_count == 0:
        return DashboardGroupHealth(
            health_score=None,
            togetherness_percent=None,
            on_route_percent=None,
            connectivity_percent=None,
            stability_percent=None,
            active_alerts_count=active_alerts_count,
            risk_level=risk_level,
            status_label="INSUFFICIENT_DATA",
            updated_at=now,
        )

    # 1. Connectivity percentage (0-100)
    if online_count is not None:
        connectivity_percent = max(0.0, min(100.0, round((online_count / max(1, member_count)) * 100, 1)))
    else:
        active_cnt = sum(1 for m in members if m.movement_state or m.route_state)
        connectivity_percent = max(0.0, min(100.0, round((active_cnt / max(1, member_count)) * 100, 1)))

    # 2. Togetherness percentage (0-100)
    located_members = [m for m in members if m.distance_from_group_center_meters is not None]
    if located_members:
        together_count = sum(1 for m in located_members if m.distance_from_group_center_meters <= 150.0)
        togetherness_percent = max(0.0, min(100.0, round((together_count / len(located_members)) * 100, 1)))
    else:
        togetherness_percent = None

    # 3. On-route percentage (0-100)
    if route_available:
        route_members = [m for m in members if m.route_state is not None]
        if route_members:
            on_route_count = sum(1 for m in route_members if m.route_state in ("ON_ROUTE", "ARRIVED", "NEAR_ROUTE"))
            on_route_percent = max(0.0, min(100.0, round((on_route_count / len(route_members)) * 100, 1)))
        else:
            on_route_percent = None
    else:
        on_route_percent = None

    # 4. Stability percentage (0-100)
    warning_alerts = max(0, active_alerts_count - critical_alerts_count)
    penalty = (warning_alerts * 10.0) + (critical_alerts_count * 25.0) + (active_sos_count * 40.0)
    stability_percent = max(0.0, min(100.0, round(100.0 - penalty, 1)))

    # 5. Composite Health Score (0-100)
    if togetherness_percent is None and on_route_percent is None:
        score = int(round(connectivity_percent * 0.5 + stability_percent * 0.5))
        label = "ATTENTION" if score < 70 else "STABLE"
        return DashboardGroupHealth(
            health_score=score,
            togetherness_percent=None,
            on_route_percent=None,
            connectivity_percent=connectivity_percent,
            stability_percent=stability_percent,
            active_alerts_count=active_alerts_count,
            risk_level=risk_level,
            status_label=label,
            updated_at=now,
        )

    weights = []
    values = []
    if togetherness_percent is not None:
        weights.append(0.3)
        values.append(togetherness_percent)
    if on_route_percent is not None:
        weights.append(0.3)
        values.append(on_route_percent)
    weights.append(0.2)
    values.append(connectivity_percent)
    weights.append(0.2)
    values.append(stability_percent)

    total_weight = sum(weights)
    composite = sum(v * w for v, w in zip(values, weights)) / total_weight
    health_score = int(max(0, min(100, round(composite))))

    if active_sos_count > 0 or health_score < 50:
        status_label = "RISK"
    elif critical_alerts_count > 0 or health_score < 70:
        status_label = "ATTENTION"
    elif health_score >= 85:
        status_label = "OPTIMAL"
    else:
        status_label = "STABLE"

    return DashboardGroupHealth(
        health_score=health_score,
        togetherness_percent=togetherness_percent,
        on_route_percent=on_route_percent,
        connectivity_percent=connectivity_percent,
        stability_percent=stability_percent,
        active_alerts_count=active_alerts_count,
        risk_level=risk_level,
        status_label=status_label,
        updated_at=now,
    )


async def build_dashboard(db: Session, redis: Optional[Redis], trip: Trip, viewer_user_id: uuid.UUID) -> DashboardResponse:
    try:
        if trip.status == TripStatus.ACTIVE:
            return await _build_live_dashboard(db, redis, trip, viewer_user_id)
        return _build_historical_dashboard(db, trip, viewer_user_id)
    except (redis.exceptions.TimeoutError, redis.exceptions.ConnectionError) as exc:
        logger.warning("Redis connection failure in build_dashboard for trip %s, falling back to PostgreSQL mode: %s", trip.id, exc)
        return _build_historical_dashboard(db, trip, viewer_user_id)


async def _build_live_dashboard(db: Session, redis: Optional[Redis], trip: Trip, viewer_user_id: uuid.UUID) -> DashboardResponse:
    route = route_service.get_route_by_trip(db, trip.id)
    leader_id = queries.get_group_leader_id(db, trip.group_id)

    # Redis being unreachable degrades this to whatever PostgreSQL alone
    # can answer, rather than failing the whole dashboard — every
    # Redis-only field below safely falls back.
    computed = None
    if redis is not None:
        try:
            computed = await intelligence_engine.compute_current_state(db, redis, trip.id, trip.group_id)
        except Exception as exc:
            logger.warning("Redis failure computing current state for dashboard (trip %s): %s", trip.id, exc)
            computed = None

    route_progress_members: List[MemberRouteProgress] = []
    if redis is not None and route is not None and route.status == RouteStatus.ACTIVE:
        try:
            route_progress_members, _group_fraction, _trip_arrived = await route_service.get_live_route_progress(
                db, redis, trip, route
            )
        except Exception as exc:
            logger.warning("Redis failure computing route progress for dashboard (trip %s): %s", trip.id, exc)
            route_progress_members = []
    route_state_by_user = {m.user_id: m.route_state for m in route_progress_members}
    fraction_by_user = {m.user_id: m.match.route_fraction for m in route_progress_members if m.match}

    representative = _pick_representative_progress(route_progress_members, leader_id)
    dashboard_route = DashboardRoute(
        route_available=route is not None,
        distance_meters=round(route.distance_meters) if route is not None else None,
        progress_percent=(
            round(representative.match.route_fraction * 100, 1) if representative and representative.match else None
        ),
        distance_remaining_meters=(
            round(representative.match.distance_remaining_meters) if representative and representative.match else None
        ),
        eta_seconds=representative.eta.eta_seconds if representative and representative.eta else None,
    )

    active_alerts = alerts_service.list_active_alerts(db, trip.id)
    active_sos = sos_service.list_active_sos(db, trip.id)
    critical_alerts = sum(1 for a in active_alerts if a.severity.value == "CRITICAL")

    members: List[DashboardMember] = []
    speed_by_user = {}
    if computed is not None:
        for cm in computed.members:
            speed_by_user[cm.user_id] = cm.speed
            fraction = fraction_by_user.get(cm.user_id)
            members.append(
                DashboardMember(
                    user_id=uuid.UUID(cm.user_id),
                    name=cm.name,
                    movement_state=cm.movement_state,
                    route_state=route_state_by_user.get(cm.user_id),
                    progress_percent=round(fraction * 100, 1) if fraction is not None else None,
                    distance_from_group_center_meters=cm.distance_from_group_center_meters,
                )
            )
        member_count = len(computed.members)
        online_count = sum(1 for m in computed.members if m.presence == "ONLINE")
        moving_count = sum(1 for m in computed.members if m.movement_state == "MOVING")
        stopped_count = sum(1 for m in computed.members if m.movement_state == "STOPPED")
    else:
        # Fallback to Supabase PostgreSQL when Redis is unreachable or computed is None
        group_members = queries.list_active_group_members(db, trip.group_id)
        latest_points_by_user = {}
        if db is not None:
            try:
                latest_points_by_user = queries.fetch_location_points(db, trip.id)
            except Exception as exc:
                logger.warning("DB fallback fetch_location_points failed: %s", exc)

        members = []
        for m in group_members:
            uid_str = str(m["user_id"])
            user_points = latest_points_by_user.get(uid_str, [])
            route_state = None
            progress_percent = None
            if route is not None and user_points:
                try:
                    match = route_analytics.match_last_point(route, user_points)
                    if match is not None:
                        thresholds = current_thresholds()
                        confirmed_arrived = match.distance_remaining_meters <= thresholds.arrival_threshold_meters
                        route_state = route_progress.classify_route_state(
                            distance_from_route_meters=match.distance_from_route_meters,
                            distance_remaining_meters=match.distance_remaining_meters,
                            confirmed_arrived=confirmed_arrived,
                            thresholds=thresholds,
                        )
                        progress_percent = round(match.route_fraction * 100, 1)
                except Exception:
                    pass

            members.append(
                DashboardMember(
                    user_id=m["user_id"],
                    name=m["name"],
                    route_state=route_state,
                    progress_percent=progress_percent,
                )
            )
        member_count = len(group_members)
        online_count = moving_count = stopped_count = None

        # Fallback route progress from PostgreSQL points if route progress was not computed from Redis
        if dashboard_route.progress_percent is None and route is not None and latest_points_by_user:
            try:
                completion_percent, distance_remaining, _arrived = route_analytics.compute_route_completion(
                    route, latest_points_by_user, leader_id
                )
                dashboard_route = DashboardRoute(
                    route_available=True,
                    distance_meters=round(route.distance_meters),
                    progress_percent=completion_percent,
                    distance_remaining_meters=round(distance_remaining) if distance_remaining is not None else None,
                    eta_seconds=None,
                )
            except Exception as exc:
                logger.warning("DB fallback compute_route_completion failed: %s", exc)

    # --- Risk (Phase 12) — DB-only, plus the live online/member ratio
    # when we actually have it (never fabricated otherwise). ---
    risk = calculate_trip_risk(db, trip, online_count=online_count, member_count=member_count)

    # --- Group ETA (Phase 12) — median remaining distance / median
    # moving-member speed, from the same route_progress_members this
    # function already computed; never re-queries anything. ---
    dashboard_eta = _build_dashboard_eta(representative, route_progress_members, speed_by_user, route)

    # --- Weather (Phase 12) — optional, never blocks the dashboard. ---
    dashboard_weather = DashboardWeather(weather_available=False)
    if redis is not None:
        try:
            dashboard_weather = await _build_dashboard_weather(redis, computed, leader_id)
        except (redis.exceptions.TimeoutError, redis.exceptions.ConnectionError, Exception) as exc:
            logger.warning("Redis weather fetch failed for dashboard: %s", exc)
            dashboard_weather = DashboardWeather(weather_available=False)

    unread_count = notification_service.get_unread_count(db, viewer_user_id)

    group_health = _calculate_group_health(
        member_count=member_count,
        members=members,
        online_count=online_count,
        active_alerts_count=len(active_alerts),
        critical_alerts_count=critical_alerts,
        active_sos_count=len(active_sos),
        risk_level=risk.level,
        route_available=route is not None,
    )

    return DashboardResponse(
        mode="live",
        trip=DashboardTrip(id=trip.id, name=trip.destination_name, status=trip.status.value, started_at=trip.started_at),
        route=dashboard_route,
        group=DashboardGroup(
            member_count=member_count, online_count=online_count, moving_count=moving_count, stopped_count=stopped_count
        ),
        safety=DashboardSafety(
            active_alerts=len(active_alerts), critical_alerts=critical_alerts, active_sos=len(active_sos)
        ),
        members=members,
        risk=_risk_to_dashboard(risk),
        eta=dashboard_eta,
        weather=dashboard_weather,
        notifications=DashboardNotifications(unread_count=unread_count),
        group_health=group_health,
    )


def _build_dashboard_eta(
    representative: Optional[MemberRouteProgress],
    route_progress_members: List[MemberRouteProgress],
    speed_by_user: dict,
    route,
) -> DashboardEta:
    individual_eta = representative.eta if representative else None
    thresholds = current_thresholds()

    group_inputs: List[Tuple[float, Optional[float]]] = [
        (m.match.distance_remaining_meters, speed_by_user.get(m.user_id))
        for m in route_progress_members
        if m.match is not None
    ]
    group_result = None
    if route is not None and group_inputs:
        group_result = EtaService.calculate_group_eta(
            members=group_inputs,
            route_distance_meters=route.distance_meters,
            route_estimated_duration_seconds=route.estimated_duration_seconds,
            thresholds=thresholds,
        )

    return DashboardEta(
        eta_available=bool(individual_eta and individual_eta.eta_available),
        eta_seconds=individual_eta.eta_seconds if individual_eta else None,
        group_eta_available=bool(group_result and group_result.eta_available),
        group_eta_seconds=group_result.eta_seconds if group_result else None,
        source=individual_eta.source if individual_eta else None,
    )


async def _build_dashboard_weather(redis: Optional[Redis], computed, leader_id: Optional[uuid.UUID]) -> DashboardWeather:
    if redis is None or computed is None:
        return DashboardWeather(weather_available=False)

    location = None
    leader_key = str(leader_id) if leader_id is not None else None
    for cm in computed.members:
        if leader_key is not None and cm.user_id == leader_key and cm.latitude is not None:
            location = (cm.latitude, cm.longitude)
            break
    if location is None:
        for cm in computed.members:
            if cm.latitude is not None and cm.longitude is not None:
                location = (cm.latitude, cm.longitude)
                break

    if location is None:
        return DashboardWeather(weather_available=False)

    try:
        weather = await WeatherService.get_weather(redis, location[0], location[1])
        return _weather_to_dashboard(weather)
    except (redis.exceptions.TimeoutError, redis.exceptions.ConnectionError, Exception) as exc:
        logger.warning("WeatherService.get_weather failed: %s", exc)
        return DashboardWeather(weather_available=False)


def _build_historical_dashboard(db: Session, trip: Trip, viewer_user_id: uuid.UUID) -> DashboardResponse:
    group_members = queries.list_active_group_members(db, trip.group_id)
    points_by_user = queries.fetch_location_points(db, trip.id)
    movement_by_user = queries.fetch_movement_intervals_by_user(db, trip.id)
    leader_id = queries.get_group_leader_id(db, trip.group_id)
    route = route_service.get_route_by_trip(db, trip.id)

    completion_percent = distance_remaining = None
    if route is not None:
        completion_percent, distance_remaining, _arrived = route_analytics.compute_route_completion(
            route, points_by_user, leader_id
        )

    dashboard_route = DashboardRoute(
        route_available=route is not None,
        distance_meters=round(route.distance_meters) if route is not None else None,
        progress_percent=completion_percent,
        distance_remaining_meters=round(distance_remaining) if distance_remaining is not None else None,
        # A finished trip has no ETA left to reach — always None here,
        # never a stale leftover number.
        eta_seconds=None,
    )

    active_alerts = alerts_service.list_active_alerts(db, trip.id)
    active_sos = sos_service.list_active_sos(db, trip.id)
    critical_alerts = sum(1 for a in active_alerts if a.severity.value == "CRITICAL")

    thresholds = current_thresholds()
    members: List[DashboardMember] = []
    for member in group_members:
        uid_str = str(member["user_id"])
        points = points_by_user.get(uid_str, [])
        intervals = movement_by_user.get(uid_str, [])
        last_movement_state = intervals[-1][0] if intervals else None

        route_state = None
        progress_percent = None
        if route is not None:
            match = route_analytics.match_last_point(route, points)
            if match is not None:
                confirmed_arrived = match.distance_remaining_meters <= thresholds.arrival_threshold_meters
                route_state = route_progress.classify_route_state(
                    distance_from_route_meters=match.distance_from_route_meters,
                    distance_remaining_meters=match.distance_remaining_meters,
                    confirmed_arrived=confirmed_arrived,
                    thresholds=thresholds,
                )
                progress_percent = round(match.route_fraction * 100, 1)

        members.append(
            DashboardMember(
                user_id=member["user_id"],
                name=member["name"],
                movement_state=last_movement_state,
                route_state=route_state,
                progress_percent=progress_percent,
                # Group-center distance is a live-only Phase 7 computation
                # (never persisted) — unavailable once a trip is over.
                distance_from_group_center_meters=None,
            )
        )

    risk = calculate_trip_risk(db, trip)
    unread_count = notification_service.get_unread_count(db, viewer_user_id)

    group_health = _calculate_group_health(
        member_count=len(group_members),
        members=members,
        online_count=None,
        active_alerts_count=len(active_alerts),
        critical_alerts_count=critical_alerts,
        active_sos_count=len(active_sos),
        risk_level=risk.level,
        route_available=route is not None,
    )

    return DashboardResponse(
        mode="historical",
        trip=DashboardTrip(id=trip.id, name=trip.destination_name, status=trip.status.value, started_at=trip.started_at),
        route=dashboard_route,
        group=DashboardGroup(
            member_count=len(group_members), online_count=None, moving_count=None, stopped_count=None
        ),
        safety=DashboardSafety(
            active_alerts=len(active_alerts), critical_alerts=critical_alerts, active_sos=len(active_sos)
        ),
        members=members,
        risk=_risk_to_dashboard(risk),
        # A finished trip has no ETA, and no current location to fetch
        # weather for — both are live-only concepts.
        eta=DashboardEta(eta_available=False, eta_seconds=None, group_eta_available=False, group_eta_seconds=None, source=None),
        weather=DashboardWeather(weather_available=False),
        notifications=DashboardNotifications(unread_count=unread_count),
        group_health=group_health,
    )
