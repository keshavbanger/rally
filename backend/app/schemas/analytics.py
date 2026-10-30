"""
Explicit response contracts for every Phase 10 endpoint — see the backend
README's Analytics section for the full zero-vs-null contract these
schemas exist to enforce: a field is `0`/`0.0` only when the underlying
count/measurement is genuinely zero, and `None` whenever it could not be
calculated (no GPS data, no route, no data yet) so the frontend never
mistakes "unknown" for "nothing happened."
"""

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, ConfigDict

DEFAULT_HISTORY_LIMIT = 20
MAX_HISTORY_LIMIT = 100


# ---- Trip analytics ---------------------------------------------------


class TripAnalytics(BaseModel):
    trip_id: uuid.UUID
    status: str
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    # None only for a trip that has never started (CREATED, or CANCELLED
    # before ever starting) — never negative, never fabricated.
    duration_seconds: Optional[int] = None

    member_count: int

    # None when there is no usable GPS history at all for the trip.
    distance_traveled_meters: Optional[float] = None

    # Whether this trip has a planned route at all — every route_* field
    # below is None (not 0) when this is False.
    route_available: bool
    planned_distance_meters: Optional[float] = None
    route_completion_percent: Optional[float] = None

    alerts_count: int
    critical_alerts_count: int
    sos_count: int
    route_deviations: int

    # "live" = computed fresh from the source tables this request;
    # "snapshot" = served from trip_analytics_snapshots (COMPLETED trips
    # only). Purely informational — the values mean the same thing either
    # way; see app/analytics/snapshot.py.
    source: str

    model_config = ConfigDict(from_attributes=True)


# ---- Member analytics ---------------------------------------------------


class MemberAnalyticsItem(BaseModel):
    user_id: uuid.UUID
    name: Optional[str] = None
    role: str
    joined_at: Optional[datetime] = None

    # None when the member has no GPS history at all on this trip.
    distance_traveled_meters: Optional[float] = None
    # Time between this member's first and last recorded GPS point on the
    # trip. None when they have fewer than 2 points (nothing to span).
    active_duration_seconds: Optional[float] = None

    # Derived from the member's own MOVING/STOPPED intelligence_events
    # transition history (Phase 7 persists these as real rows — see
    # app/analytics/queries.py). `movement_duration_available` is False
    # (and both durations are None) only when no such transition was ever
    # recorded for this member on this trip — never a fabricated 0.
    movement_duration_available: bool
    moving_duration_seconds: Optional[float] = None
    stopped_duration_seconds: Optional[float] = None

    # None when the trip has no route at all.
    route_completion_percent: Optional[float] = None
    route_deviations: int
    alerts_received: int
    sos_triggered: int

    model_config = ConfigDict(from_attributes=True)


class MemberAnalyticsResponse(BaseModel):
    trip_id: uuid.UUID
    members: List[MemberAnalyticsItem]

    model_config = ConfigDict(from_attributes=True)


# ---- Route analytics ---------------------------------------------------


class RouteAnalytics(BaseModel):
    route_available: bool
    planned_distance_meters: Optional[float] = None
    traveled_distance_meters: Optional[float] = None
    completion_percent: Optional[float] = None

    route_deviations: int
    resolved_deviations: int
    active_deviations: int
    # None when no ROUTE_DEVIATION event has ever recorded a distance
    # value in its metadata (e.g. no deviation ever happened) — see
    # app/analytics/route_analytics.py.
    average_distance_from_route_meters: Optional[float] = None
    maximum_distance_from_route_meters: Optional[float] = None

    # None when there's no route, or no member has a usable final GPS
    # point to evaluate arrival from.
    arrived: Optional[bool] = None

    model_config = ConfigDict(from_attributes=True)


# ---- Safety analytics ---------------------------------------------------


class AlertCounts(BaseModel):
    total: int
    info: int
    warning: int
    critical: int

    model_config = ConfigDict(from_attributes=True)


class SosCounts(BaseModel):
    total: int
    resolved: int
    cancelled: int

    model_config = ConfigDict(from_attributes=True)


class IntelligenceEventCounts(BaseModel):
    total: int
    resolved: int
    active: int

    model_config = ConfigDict(from_attributes=True)


class SafetyAnalytics(BaseModel):
    alerts: AlertCounts
    by_type: Dict[str, int]
    sos: SosCounts
    intelligence_events: IntelligenceEventCounts

    model_config = ConfigDict(from_attributes=True)


# ---- Timeline -----------------------------------------------------------


class TimelineEvent(BaseModel):
    type: str
    timestamp: datetime
    data: Dict[str, Any] = {}

    model_config = ConfigDict(from_attributes=True)


class TripTimeline(BaseModel):
    trip_id: uuid.UUID
    events: List[TimelineEvent]

    model_config = ConfigDict(from_attributes=True)


# ---- Trip history ---------------------------------------------------


class TripHistoryRoute(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    origin_latitude: Optional[float] = None
    origin_longitude: Optional[float] = None
    destination_latitude: Optional[float] = None
    destination_longitude: Optional[float] = None
    distance_meters: Optional[float] = None
    estimated_duration_seconds: Optional[int] = None
    status: Optional[str] = None
    coordinates: List[Any] = []

    model_config = ConfigDict(from_attributes=True)


class TripHistoryItem(BaseModel):
    trip_id: uuid.UUID
    name: Optional[str] = None
    destination_name: Optional[str] = None
    status: str = "COMPLETED"
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    member_count: int = 0
    # None when the trip has no GPS history at all (e.g. never started).
    distance_meters: Optional[float] = None
    distance: Optional[float] = None
    duration: Optional[int] = None
    duration_seconds: Optional[int] = None
    safety_score: Optional[int] = None
    route: Optional[Union[TripHistoryRoute, Dict[str, Any]]] = None

    model_config = ConfigDict(from_attributes=True)


class TripHistoryResponse(BaseModel):
    items: List[TripHistoryItem] = []
    total: int = 0
    limit: int = DEFAULT_HISTORY_LIMIT
    offset: int = 0

    model_config = ConfigDict(from_attributes=True)


AnalyticsHistoryResponse = TripHistoryResponse


# ---- Trip replay (Phase 12) ---------------------------------------------


class ReplayMemberState(BaseModel):
    user_id: uuid.UUID
    latitude: float
    longitude: float
    # None when Phase 7 never recorded a MOVING/STOPPED transition
    # covering this exact moment for this member (e.g. the intelligence
    # worker wasn't evaluating yet) — never guessed from raw speed.
    movement_state: Optional[str] = None
    # 0.0-1.0 fraction of the route completed as of this frame. None when
    # the trip has no route, or this point didn't match one.
    route_progress: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)


class ReplayFrame(BaseModel):
    timestamp: datetime
    members: List[ReplayMemberState]

    model_config = ConfigDict(from_attributes=True)


class TripReplay(BaseModel):
    trip_id: uuid.UUID
    duration_seconds: Optional[int] = None
    # None only when the trip has no GPS history at all.
    total_distance_meters: Optional[float] = None
    # The actual interval used to build this response — may be coarser
    # than what was requested if REPLAY_MAX_FRAMES required it (see
    # app/analytics/replay.py).
    interval_seconds: int
    timeline: List[ReplayFrame]
    events: List[TimelineEvent]

    model_config = ConfigDict(from_attributes=True)


# ---- Trip insights (Phase 12) --------------------------------------------


class TripInsightsStatistics(BaseModel):
    distance_meters: Optional[float] = None
    duration_seconds: Optional[int] = None
    route_completion_percent: Optional[float] = None
    alerts: int
    sos: int
    route_deviations: int
    member_count: int
    active_member_count: int

    model_config = ConfigDict(from_attributes=True)


class TripInsights(BaseModel):
    trip_id: uuid.UUID
    # Plain, deterministic sentences generated only from data that
    # actually exists — see app/analytics/insights.py. Never fabricated;
    # an insight with no supporting data simply isn't included.
    highlights: List[str]
    statistics: TripInsightsStatistics

    model_config = ConfigDict(from_attributes=True)


# ---- Dashboard ---------------------------------------------------------


class DashboardTrip(BaseModel):
    id: uuid.UUID
    name: Optional[str] = None
    status: str
    started_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class DashboardRoute(BaseModel):
    route_available: bool
    distance_meters: Optional[float] = None
    progress_percent: Optional[float] = None
    distance_remaining_meters: Optional[float] = None
    # None for a COMPLETED trip (ETA is meaningless once a trip is over)
    # or whenever it can't be computed (no route, no usable location).
    eta_seconds: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)


class DashboardGroup(BaseModel):
    member_count: int
    # None for a COMPLETED trip — presence/movement-state *counts* are a
    # live-only concept (Redis), never reconstructed after the fact.
    online_count: Optional[int] = None
    moving_count: Optional[int] = None
    stopped_count: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


class DashboardSafety(BaseModel):
    active_alerts: int
    critical_alerts: int
    active_sos: int

    model_config = ConfigDict(from_attributes=True)


class DashboardMember(BaseModel):
    user_id: uuid.UUID
    name: Optional[str] = None
    # For an ACTIVE trip: the member's live state (Redis). For a
    # COMPLETED trip: their last known state before the trip ended, or
    # None if it was never recorded.
    movement_state: Optional[str] = None
    route_state: Optional[str] = None
    progress_percent: Optional[float] = None
    # Live-only (Phase 7 group-center distance is never persisted) — None
    # for a COMPLETED trip.
    distance_from_group_center_meters: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)


class DashboardRisk(BaseModel):
    """Mirrors RiskScore (app/schemas/risk.py) — duplicated here rather
    than reused directly so the dashboard's contract doesn't silently
    change shape if the standalone GET /trips/{trip_id}/risk response
    ever needs a dashboard-irrelevant field added to it."""

    score: int
    level: str

    model_config = ConfigDict(from_attributes=True)


class DashboardEta(BaseModel):
    # False whenever an ETA genuinely cannot be computed (no route, no
    # usable GPS, trip already arrived/completed) — eta_seconds is then
    # always None, never 0. See app/route/eta.py.
    eta_available: bool
    eta_seconds: Optional[float] = None
    # The group's own ETA — "when is the group likely to finish
    # together," from a representative (median-speed) member, NOT the
    # fastest — see EtaService.calculate_group_eta().
    group_eta_available: bool = False
    group_eta_seconds: Optional[float] = None
    source: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class DashboardWeatherWarning(BaseModel):
    type: str
    severity: str
    reason: str

    model_config = ConfigDict(from_attributes=True)


class DashboardWeather(BaseModel):
    weather_available: bool
    temperature_celsius: Optional[float] = None
    condition: Optional[str] = None
    wind_speed_mps: Optional[float] = None
    precipitation_probability_percent: Optional[float] = None
    visibility_meters: Optional[float] = None
    warnings: List[DashboardWeatherWarning] = []

    model_config = ConfigDict(from_attributes=True)


class DashboardNotifications(BaseModel):
    unread_count: int

    model_config = ConfigDict(from_attributes=True)


class DashboardGroupHealth(BaseModel):
    health_score: Optional[int] = None
    togetherness_percent: Optional[float] = None
    on_route_percent: Optional[float] = None
    connectivity_percent: Optional[float] = None
    stability_percent: Optional[float] = None
    active_alerts_count: int = 0
    risk_level: str = "LOW"
    status_label: str = "INSUFFICIENT_DATA"
    scoring_method: str = "Deterministic rule-based composite"
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DashboardResponse(BaseModel):
    # "live" = an ACTIVE trip, combining Redis + route progress + active
    # alerts/SOS; "historical" = a COMPLETED/CANCELLED trip, entirely from
    # PostgreSQL — no Redis required to view it.
    mode: str
    trip: DashboardTrip
    route: DashboardRoute
    group: DashboardGroup
    safety: DashboardSafety
    members: List[DashboardMember]
    risk: DashboardRisk
    eta: DashboardEta
    weather: DashboardWeather
    notifications: DashboardNotifications
    group_health: Optional[DashboardGroupHealth] = None

    model_config = ConfigDict(from_attributes=True)
