"""
WebSocket message schemas and builder helpers.

Two layers coexist in this file:
  1. Legacy Pydantic model classes (used by websocket/router.py and its
     tests) — kept intact so the legacy group-scoped WS handler still works.
  2. Builder functions and plain-dict helpers (used by api/websocket.py,
     handlers.py, and every service that publishes real-time frames) —
     return plain dicts because the new WS handler sends JSON directly
     via websocket.send_json(), not via Pydantic serialisation.
"""

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# INCOMING MESSAGES (legacy Pydantic models — websocket/router.py)
# ---------------------------------------------------------------------------

class BaseIncomingMessage(BaseModel):
    type: str


class LocationUpdateData(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    accuracy: Optional[float] = Field(None, ge=0)
    speed: Optional[float] = Field(None, ge=0)
    heading: Optional[float] = Field(None, ge=0, lt=360)
    recorded_at: Optional[datetime] = None


class LocationUpdateMessage(BaseIncomingMessage):
    type: Literal["location_update"]
    data: LocationUpdateData


class PingMessage(BaseIncomingMessage):
    type: Literal["ping"]


class SubscribeMessage(BaseIncomingMessage):
    type: Literal["subscribe"]


IncomingMessage = Union[LocationUpdateMessage, PingMessage, SubscribeMessage]


# ---------------------------------------------------------------------------
# OUTGOING MESSAGES (legacy Pydantic models — websocket/router.py)
# ---------------------------------------------------------------------------

class BaseOutgoingMessage(BaseModel):
    type: str


class OutgoingLocationUpdateData(LocationUpdateData):
    user_id: uuid.UUID
    last_seen: datetime


class OutgoingLocationUpdateMessage(BaseOutgoingMessage):
    type: Literal["location_update"] = "location_update"
    data: OutgoingLocationUpdateData


class MemberStatusData(BaseModel):
    user_id: uuid.UUID
    status: Literal["ONLINE", "OFFLINE"]


class MemberStatusMessage(BaseOutgoingMessage):
    type: Literal["member_status"] = "member_status"
    data: MemberStatusData


class GroupStateData(BaseModel):
    group_id: uuid.UUID
    trip_id: uuid.UUID
    members: List[Dict[str, Any]]


class GroupStateMessage(BaseOutgoingMessage):
    type: Literal["group_state"] = "group_state"
    data: GroupStateData


class PongMessage(BaseOutgoingMessage):
    type: Literal["pong"] = "pong"
    data: Dict[str, str]


class ErrorMessageData(BaseModel):
    code: str
    message: str


class ErrorMessage(BaseOutgoingMessage):
    type: Literal["error"] = "error"
    data: ErrorMessageData


# ---------------------------------------------------------------------------
# NEW-STYLE SCHEMAS (dict-based, used by api/websocket.py and handlers.py)
# ---------------------------------------------------------------------------

class ErrorCode(str, Enum):
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    NOT_A_MEMBER = "NOT_A_MEMBER"
    TRIP_NOT_FOUND = "TRIP_NOT_FOUND"
    TRIP_NOT_ACTIVE = "TRIP_NOT_ACTIVE"
    INVALID_MESSAGE = "INVALID_MESSAGE"
    INVALID_LOCATION = "INVALID_LOCATION"
    RATE_LIMITED = "RATE_LIMITED"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    NO_ACTIVE_TRIP = "NO_ACTIVE_TRIP"


class PresenceStatus(str, Enum):
    ONLINE = "ONLINE"
    OFFLINE = "OFFLINE"


class ClientEnvelope(BaseModel):
    """Top-level wrapper for every message sent by the client (new handler)."""
    type: str
    data: Optional[Dict[str, Any]] = None


class LocationCreate(BaseModel):
    """Inbound GPS payload inside a location_update envelope (new handler).
    No user_id / trip_id / group_id — those always come from the verified JWT
    and the URL, never from the message body."""
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    accuracy: Optional[float] = Field(None, ge=0)
    speed: Optional[float] = Field(None, ge=0)
    heading: Optional[float] = Field(None, ge=0, lt=360)
    recorded_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Builder helpers — return plain dicts for websocket.send_json()
# ---------------------------------------------------------------------------

def build_error(code: Union[str, ErrorCode], message: str) -> Dict[str, Any]:
    # Always emit the string value, not the repr (e.g. "INVALID_LOCATION" not "ErrorCode.INVALID_LOCATION").
    code_str = code.value if isinstance(code, ErrorCode) else str(code)
    return {"type": "error", "data": {"code": code_str, "message": message}}


def build_heartbeat_ack() -> Dict[str, Any]:
    return {"type": "heartbeat_ack", "data": {"server_time": datetime.now(timezone.utc).isoformat()}}


def build_location_ack(*, recorded_at: str, accepted: bool) -> Dict[str, Any]:
    return {"type": "location_ack", "data": {"recorded_at": recorded_at, "accepted": accepted}}


def build_location_update_event(
    *,
    user_id: Any,
    latitude: float,
    longitude: float,
    accuracy: Optional[float],
    speed: Optional[float],
    heading: Optional[float],
    recorded_at: str,
    updated_at: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "type": "location_update",
        "data": {
            "user_id": str(user_id),
            "latitude": latitude,
            "longitude": longitude,
            "accuracy": accuracy,
            "speed": speed,
            "heading": heading,
            "recorded_at": recorded_at,
            "updated_at": updated_at if updated_at is not None else recorded_at,
        },
    }


def build_trip_state(trip_id: Any, members: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {"type": "trip_state", "data": {"trip_id": str(trip_id), "members": members}}


def build_presence_update(user_id: Any, status: Union[PresenceStatus, str]) -> Dict[str, Any]:
    # Unwrap enum value so we always emit "ONLINE"/"OFFLINE", not "PresenceStatus.ONLINE".
    status_str = status.value if isinstance(status, PresenceStatus) else str(status)
    return {"type": "presence_update", "data": {"user_id": str(user_id), "status": status_str}}


def build_trip_ended(trip_id: Any, status: str) -> Dict[str, Any]:
    return {"type": "trip_ended", "data": {"trip_id": str(trip_id), "status": status}}


def build_alert(
    alert_id: Any,
    alert_type: str,
    severity: str,
    title: str,
    message: str,
    *,
    user_id: Optional[Any] = None,
    related_user_id: Optional[Any] = None,
    created_at: Optional[str] = None,
) -> Dict[str, Any]:
    data: Dict[str, Any] = {
        "alert_id": str(alert_id),
        "alert_type": alert_type,
        "severity": severity,
        "title": title,
        "message": message,
        "user_id": str(user_id) if user_id is not None else None,
        "related_user_id": str(related_user_id) if related_user_id is not None else None,
    }
    if created_at is not None:
        data["created_at"] = created_at
    return {"type": "alert", "data": data}


def build_alert_updated(alert_id: Any, status: str) -> Dict[str, Any]:
    return {"type": "alert_updated", "data": {"alert_id": str(alert_id), "status": status}}


def build_sos(
    sos_id: Any,
    trip_id: Any,
    user_id: Any,
    latitude: float,
    longitude: float,
    message: Optional[str] = None,
    *,
    accuracy: Optional[float] = None,
    status: Optional[str] = None,
    triggered_at: Optional[str] = None,
) -> Dict[str, Any]:
    data: Dict[str, Any] = {
        "sos_id": str(sos_id),
        "trip_id": str(trip_id),
        "user_id": str(user_id),
        "latitude": latitude,
        "longitude": longitude,
        "message": message,
    }
    if accuracy is not None:
        data["accuracy"] = accuracy
    if status is not None:
        data["status"] = status
    if triggered_at is not None:
        data["triggered_at"] = triggered_at
    return {"type": "sos", "data": data}


def build_sos_updated(sos_id: Any, status: str) -> Dict[str, Any]:
    return {"type": "sos_updated", "data": {"sos_id": str(sos_id), "status": status}}


def build_intelligence_event(
    event_type: str,
    severity: Optional[str] = None,
    user_id: Optional[Any] = None,
    related_user_id: Optional[Any] = None,
    detected_at: Optional[str] = None,
    resolved_at: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    trip_id: Optional[Any] = None,
    payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    data: Dict[str, Any] = {
        "event_type": event_type,
        "severity": severity,
        "user_id": str(user_id) if user_id is not None else None,
        "related_user_id": str(related_user_id) if related_user_id is not None else None,
        "detected_at": detected_at,
        "resolved_at": resolved_at,
        "metadata": metadata if metadata is not None else {},
    }
    if trip_id is not None:
        data["trip_id"] = str(trip_id)
    if payload:
        data.update(payload)
    return {"type": "intelligence_event", "data": data}


def build_route_deviation(
    user_id: Any,
    distance_from_route_meters: float,
    status: str,
    detected_at: str,
) -> Dict[str, Any]:
    """Route deviation event. `status` is 'DEVIATED' or 'BACK_ON_ROUTE'."""
    return {
        "type": "route_deviation",
        "data": {
            "user_id": str(user_id),
            "distance_from_route_meters": distance_from_route_meters,
            "status": status,
            "detected_at": detected_at,
        },
    }


def build_route_progress(
    trip_id: Any,
    route_id: Any,
    group_route_fraction: Optional[float],
    trip_arrived: bool,
    members: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Aggregate route-progress snapshot for all members of a trip."""
    return {
        "type": "route_progress",
        "data": {
            "trip_id": str(trip_id),
            "route_id": str(route_id),
            "group_route_fraction": group_route_fraction,
            "trip_arrived": trip_arrived,
            "members": members,
            "server_time": datetime.now(timezone.utc).isoformat(),
        },
    }