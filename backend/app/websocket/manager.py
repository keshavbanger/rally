"""
Local (per-process) WebSocket connection registry, plus the Redis Pub/Sub
fan-in that makes broadcasts work across multiple FastAPI
instances/workers. A single process can hold many connections for the
same trip (multiple members, multiple tabs/devices per member) — this
class is the one place that state lives, instead of a loose global dict
scattered through the app.

Cross-instance broadcast: event *producers* (the location_update handler,
trip-end triggers) never call broadcast_to_trip() directly — they call
publish_event(), which PUBLISHes to Redis. Every instance with at least
one local connection for a trip runs one background subscriber task for
that trip's channel (started on the first local connection, stopped on
the last) and forwards whatever it receives to its own local connections.
That's "one Redis connection per trip channel," not one per message and
not one per WebSocket.
"""

import asyncio
import json
import logging
from typing import Any, Dict, Optional, Set, Union

from fastapi import WebSocket
from pydantic import BaseModel
from redis.asyncio import Redis

from app.core.redis_keys import trip_channel

logger = logging.getLogger("rally.websocket")


class ConnectionManager:
    def __init__(self) -> None:
        # trip_id -> user_id -> set of live WebSocket connections
        self._connections: Dict[str, Dict[str, Set[WebSocket]]] = {}
        # trip_id -> background task subscribing to that trip's Redis channel
        self._subscriber_tasks: Dict[str, asyncio.Task] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def _s(v: Any) -> str:
        return str(v)

    async def connect(
        self,
        redis_or_scope: Any,
        scope_or_user: Any,
        user_or_ws: Any,
        ws: Optional[WebSocket] = None,
    ) -> bool:
        """Registers the connection.
        Supports both new 4-arg signature:
            connect(redis, trip_id, user_id, websocket)
        and legacy 3-arg signature:
            connect(group_id, user_id, websocket)
        """
        if ws is not None:
            redis = redis_or_scope
            trip_id = self._s(scope_or_user)
            user_id = self._s(user_or_ws)
            websocket = ws
        else:
            redis = None
            trip_id = self._s(redis_or_scope)
            user_id = self._s(scope_or_user)
            websocket = user_or_ws
            await websocket.accept()

        async with self._lock:
            trip_conns = self._connections.setdefault(trip_id, {})
            user_conns = trip_conns.setdefault(user_id, set())
            is_first_for_user = len(user_conns) == 0
            user_conns.add(websocket)

            if redis is not None and hasattr(redis, "pubsub") and trip_id not in self._subscriber_tasks:
                self._subscriber_tasks[trip_id] = asyncio.create_task(self._subscribe_loop(redis, trip_id))

        return is_first_for_user

    async def disconnect(
        self,
        trip_id: Any,
        user_id: Any,
        websocket: WebSocket,
    ) -> bool:
        """Unregisters the connection. Returns True if the user has no
        other live connections left for this trip (i.e. they should now
        be announced OFFLINE)."""
        trip_id_str = self._s(trip_id)
        user_id_str = self._s(user_id)
        is_last_for_user = True
        stop_subscriber = False
        async with self._lock:
            trip_conns = self._connections.get(trip_id_str)
            if trip_conns is None:
                return True
            user_conns = trip_conns.get(user_id_str)
            if user_conns is not None:
                user_conns.discard(websocket)
                if user_conns:
                    is_last_for_user = False
                else:
                    trip_conns.pop(user_id_str, None)

            if not trip_conns:
                self._connections.pop(trip_id_str, None)
                stop_subscriber = True

        if stop_subscriber:
            task = self._subscriber_tasks.pop(trip_id_str, None)
            if task is not None:
                task.cancel()

        return is_last_for_user

    async def send_to_user(self, trip_id: Any, user_id: Any, message: Any) -> None:
        connections = self._connections.get(self._s(trip_id), {}).get(self._s(user_id), set())
        await self._send_to_many(connections, message)

    async def broadcast_to_trip(
        self,
        trip_id: Any,
        message: Any,
        exclude_user_id: Optional[Any] = None,
    ) -> None:
        """Local-only send to every connection this process holds for the
        trip. Called by the subscriber loop for every event published on
        the trip's channel, from any instance (including this one)."""
        trip_id_str = self._s(trip_id)
        exclude_str = self._s(exclude_user_id) if exclude_user_id is not None else None
        trip_conns = self._connections.get(trip_id_str, {})
        targets: Set[WebSocket] = set()
        for uid, conns in trip_conns.items():
            if exclude_str and uid == exclude_str:
                continue
            targets |= conns
        await self._send_to_many(targets, message)

    async def broadcast_to_group(
        self,
        group_id: Any,
        message: Any,
        exclude_user_id: Optional[Any] = None,
    ) -> None:
        await self.broadcast_to_trip(group_id, message, exclude_user_id=exclude_user_id)

    async def close_trip_connections(self, trip_id: Any, code: int = 1000) -> None:
        """Used on trip end — closes every local connection for the trip.
        Callers publish the trip_ended frame first so clients see why."""
        trip_id_str = self._s(trip_id)
        async with self._lock:
            trip_conns = self._connections.pop(trip_id_str, {})
            all_conns = {ws for conns in trip_conns.values() for ws in conns}
            for ws in all_conns:
                try:
                    await ws.close(code=code)
                except Exception:
                    pass

            task = self._subscriber_tasks.pop(trip_id_str, None)
            if task is not None:
                task.cancel()

    def connection_count(self, trip_id: Any, user_id: Any) -> int:
        return len(self._connections.get(self._s(trip_id), {}).get(self._s(user_id), set()))

    def total_connection_count(self) -> int:
        """Every live connection across every trip — the gauge behind
        GET /metrics' `websocket_active_connections` (see app/api/metrics.py)."""
        return sum(len(conns) for trip_conns in self._connections.values() for conns in trip_conns.values())

    async def close_all(self, code: int = 1001) -> None:
        """Graceful shutdown: close every live connection across every trip
        and stop every subscriber task."""
        trip_ids = list(self._connections.keys())
        for trip_id in trip_ids:
            await self.close_trip_connections(trip_id, code=code)

    @property
    def active_connections(self) -> Dict[str, Dict[str, Set[WebSocket]]]:
        return self._connections

    async def _send_to_many(self, connections: Set[WebSocket], message: Any) -> None:
        if not connections:
            return
        if isinstance(message, BaseModel):
            payload = message.model_dump_json()
        elif isinstance(message, dict):
            payload = json.dumps(message)
        else:
            payload = str(message)

        for ws in list(connections):
            try:
                await ws.send_text(payload)
            except Exception:
                logger.debug("Failed to send to a WebSocket; its own handler loop will clean it up.")

    async def _subscribe_loop(self, redis: Redis, trip_id: str) -> None:
        from app.core import metrics as _metrics
        from app.core.config import settings as _settings

        attempt = 0
        while True:
            if trip_id not in self._connections:
                return

            pubsub = redis.pubsub()
            try:
                await pubsub.subscribe(trip_channel(trip_id))
                attempt = 0
                async for raw in pubsub.listen():
                    if raw["type"] != "message":
                        continue
                    try:
                        envelope = json.loads(raw["data"])
                        message = envelope["message"]
                    except (TypeError, ValueError, KeyError):
                        continue

                    await self.broadcast_to_trip(trip_id, message, exclude_user_id=envelope.get("exclude_user_id"))

                    if isinstance(message, dict) and message.get("type") == "trip_ended":
                        await self.close_trip_connections(trip_id)
                        return
                return
            except asyncio.CancelledError:
                return
            except Exception:
                attempt += 1
                _metrics.increment("redis_reconnects_total", {"component": "pubsub"})
                if attempt > _settings.REDIS_RETRY_LIMIT:
                    logger.error(
                        "Live-trip subscriber loop for trip %s giving up after %d failed reconnect attempts",
                        trip_id, attempt - 1,
                    )
                    return
                delay = min(2 ** attempt, _settings.REDIS_RETRY_MAX_BACKOFF_SECONDS)
                logger.warning(
                    "Live-trip subscriber loop for trip %s lost its Redis connection (attempt %d/%d) — "
                    "retrying in %.1fs", trip_id, attempt, _settings.REDIS_RETRY_LIMIT, delay,
                )
                try:
                    await asyncio.sleep(delay)
                except asyncio.CancelledError:
                    return
            finally:
                try:
                    await pubsub.unsubscribe(trip_channel(trip_id))
                    await pubsub.aclose()
                except Exception:
                    pass


manager = ConnectionManager()


async def publish_event(
    redis: Optional[Redis],
    trip_id: str,
    message: Any,
    exclude_user_id: Optional[str] = None,
) -> None:
    """The one place event producers call to fan a message out to every
    instance (including this one, via its own subscriber loop) with a
    live connection for the trip. `exclude_user_id` is transport metadata
    only — it never reaches the client inside `message` itself."""
    if isinstance(message, BaseModel):
        msg_dict = message.model_dump()
    elif isinstance(message, dict):
        msg_dict = message
    else:
        try:
            msg_dict = json.loads(str(message))
        except Exception:
            msg_dict = message

    envelope = {"message": msg_dict, "exclude_user_id": exclude_user_id}
    if redis is not None and hasattr(redis, "publish"):
        await redis.publish(trip_channel(str(trip_id)), json.dumps(envelope))
    else:
        await manager.broadcast_to_trip(str(trip_id), msg_dict, exclude_user_id=exclude_user_id)