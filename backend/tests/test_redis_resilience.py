"""
Regression tests for Redis resilience: all four failure modes that caused
HTTP 500s and WebSocket crashes when local Redis (localhost:6379) is unreachable.

These tests use a fake Redis object that raises redis.exceptions.TimeoutError
on every command -- the same exception class redis-py raises when a connection
attempt to an unreachable server exceeds socket_connect_timeout.

Four failure modes covered:
  1. core/redis.py -- health_check_interval background PING crashes event loop
     (fixed: removed health_check_interval from client init).
  2. websocket/handlers.py build_trip_state_snapshot() -- bare Redis calls
     crashed WS connect with 4500 when Redis times out.
  3. intelligence/engine.py _classify_all_members() -- per-member Redis
     get/set threw TimeoutError -> HTTP 500 on GET /trips/{id}/intelligence.
  4. api/websocket.py finally block -- bare clear_presence() call crashed
     the disconnect handler, masking the original disconnect reason.
"""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from redis.exceptions import TimeoutError as RedisTimeoutError

from app.core import redis as redis_core
from app.websocket.auth import TripConnectionContext
from app.websocket.handlers import build_trip_state_snapshot
from app.models.enums import MemberRole

TRIP_ID = uuid.uuid4()
GROUP_ID = uuid.uuid4()
USER_ID = uuid.uuid4()
NOW_ISO = datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _TimeoutRedis:
    """Fake Redis that raises RedisTimeoutError on every command."""

    async def get(self, *a, **kw): raise RedisTimeoutError("Timeout connecting to server")
    async def set(self, *a, **kw): raise RedisTimeoutError("Timeout connecting to server")
    async def mget(self, *a, **kw): raise RedisTimeoutError("Timeout connecting to server")
    async def exists(self, *a, **kw): raise RedisTimeoutError("Timeout connecting to server")
    async def delete(self, *a, **kw): raise RedisTimeoutError("Timeout connecting to server")
    async def smembers(self, *a, **kw): raise RedisTimeoutError("Timeout connecting to server")
    async def sadd(self, *a, **kw): raise RedisTimeoutError("Timeout connecting to server")
    async def ping(self, *a, **kw): raise RedisTimeoutError("Timeout connecting to server")

    def pipeline(self, *a, **kw):
        return _TimeoutPipeline()


class _TimeoutPipeline:
    """Async context-manager pipeline that raises on execute()."""
    def set(self, *a, **kw): return self
    def sadd(self, *a, **kw): return self
    def exists(self, *a, **kw): return self
    async def execute(self, *a, **kw): raise RedisTimeoutError("Timeout connecting to server")
    async def __aenter__(self): return self
    async def __aexit__(self, *a): pass


def _make_ctx():
    return TripConnectionContext(
        user_id=USER_ID, trip_id=TRIP_ID, group_id=GROUP_ID, role=MemberRole.MEMBER
    )


# ---------------------------------------------------------------------------
# Fix 1: health_check_interval is NOT set in the Redis client
# ---------------------------------------------------------------------------

def test_init_redis_does_not_use_health_check_interval(monkeypatch):
    """health_check_interval spawns a background PING coroutine that throws
    TimeoutError into the event loop when Redis is unreachable."""
    import redis.asyncio as aioredis
    captured_kwargs = {}
    def fake_from_url(url, **kwargs):
        captured_kwargs.update(kwargs)
        return MagicMock()
    monkeypatch.setattr(aioredis, "from_url", fake_from_url)
    monkeypatch.setattr(redis_core.settings, "REDIS_URL", "redis://localhost:6379/0")
    redis_core.init_redis()
    redis_core._client = None
    assert "health_check_interval" not in captured_kwargs, (
        "health_check_interval must be removed from init_redis()"
    )


# ---------------------------------------------------------------------------
# Fix 2: build_trip_state_snapshot falls back gracefully on Redis timeout
# ---------------------------------------------------------------------------

async def test_build_trip_state_snapshot_returns_empty_live_state_on_redis_timeout():
    """Dashboard still loads with Postgres member data when Redis times out."""
    ctx = _make_ctx()
    member_row = {"user_id": USER_ID, "name": "Alice", "role": "MEMBER"}
    with patch("app.websocket.handlers.run_in_threadpool", new=AsyncMock(return_value=[member_row])):
        result = await build_trip_state_snapshot(object(), _TimeoutRedis(), ctx)
    assert result["type"] == "trip_state"
    members = result["data"]["members"]
    assert len(members) == 1
    assert members[0]["latitude"] is None
    assert members[0]["status"] == "OFFLINE"


async def test_build_trip_state_snapshot_all_members_offline_on_redis_timeout():
    """All members must be OFFLINE when the presence pipeline times out."""
    ctx = _make_ctx()
    other_user = uuid.uuid4()
    members_data = [
        {"user_id": USER_ID, "name": "Alice", "role": "LEADER"},
        {"user_id": other_user, "name": "Bob", "role": "MEMBER"},
    ]
    with patch("app.websocket.handlers.run_in_threadpool", new=AsyncMock(return_value=members_data)):
        result = await build_trip_state_snapshot(object(), _TimeoutRedis(), ctx)
    statuses = {m["user_id"]: m["status"] for m in result["data"]["members"]}
    assert all(s == "OFFLINE" for s in statuses.values())


# ---------------------------------------------------------------------------
# Fix 3: _classify_all_members in engine.py tolerates Redis timeout per-member
# ---------------------------------------------------------------------------

async def test_classify_all_members_tolerates_redis_timeout():
    """Movement classification must complete even when Redis is unreachable."""
    from app.intelligence.engine import _classify_all_members
    from app.intelligence.thresholds import current_thresholds
    members = [{"user_id": USER_ID, "name": "Alice", "role": "MEMBER"}]
    live_locations = {
        str(USER_ID): {
            "latitude": 22.7196,
            "longitude": 75.8577,
            "speed": 15.0,
            "recorded_at": NOW_ISO,
        }
    }
    thresholds = current_thresholds()
    now = datetime.now(timezone.utc)
    results = await _classify_all_members(
        _TimeoutRedis(), TRIP_ID, members, live_locations, {str(USER_ID): True}, thresholds, now
    )
    assert str(USER_ID) in results
    movement_result, previous_state = results[str(USER_ID)]
    assert previous_state is None  # Redis read failed, treated as unknown
    assert movement_result.state in ("MOVING", "STOPPED", "UNKNOWN", "STALE")


async def test_classify_all_members_tolerates_redis_timeout_no_location():
    """Same resilience with a member who has no live location (UNKNOWN/STALE path)."""
    from app.intelligence.engine import _classify_all_members
    from app.intelligence.thresholds import current_thresholds
    members = [{"user_id": USER_ID, "name": "Alice", "role": "MEMBER"}]
    thresholds = current_thresholds()
    now = datetime.now(timezone.utc)
    results = await _classify_all_members(
        _TimeoutRedis(), TRIP_ID, members, {}, {}, thresholds, now
    )
    assert str(USER_ID) in results


# ---------------------------------------------------------------------------
# Fix 4: WebSocket finally block catches clear_presence timeout
# ---------------------------------------------------------------------------

async def test_clear_presence_on_timeout_redis_does_not_raise():
    """clear_presence() itself propagates the timeout -- protection is in the
    websocket.py caller which must wrap it in try/except."""
    from app.services import presence_service
    # clear_presence is a thin redis.delete() wrapper -- it will raise.
    # The contract is that websocket.py catches it. We verify the caller's
    # structure in the next test.
    with pytest.raises(RedisTimeoutError):
        await presence_service.clear_presence(_TimeoutRedis(), TRIP_ID, USER_ID)


def test_websocket_finally_block_wraps_clear_presence_in_try_except():
    """Structural assertion: clear_presence() call must be inside a try block
    in the WebSocket finally handler -- a bare await lets RedisTimeoutError
    escape and crash the entire disconnect path."""
    import inspect
    import app.api.websocket as ws_module

    src = inspect.getsource(ws_module.trip_websocket)
    assert "clear_presence" in src, "clear_presence must still be called in the disconnect path"

    # Find the index of the clear_presence call
    clear_idx = src.find("clear_presence")
    assert clear_idx != -1

    # There must be a "try:" somewhere before the clear_presence call in the source
    try_idx = src[:clear_idx].rfind("try:")
    assert try_idx != -1, (
        "clear_presence() must be inside a try block in the websocket finally handler"
        " -- a bare await lets RedisTimeoutError escape and crash the disconnect path"
    )

