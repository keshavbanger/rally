import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.health import router as health_router
from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging

configure_logging(settings.ENVIRONMENT)
logger = logging.getLogger("rally.startup")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("%s starting up (environment=%s)", settings.PROJECT_NAME, settings.ENVIRONMENT)
    if not settings.DATABASE_URL:
        logger.warning("DATABASE_URL is not set - /health will report the database as not_configured.")
    # Single Redis client: app/core/redis.py owns the lifecycle.
    from app.core.redis import init_redis, close_redis
    if settings.REDIS_URL:
        init_redis()
    yield
    await close_redis()


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security / observability middleware (order matters — added last runs first
# for ASGI middleware, which is the opposite of what you'd expect from a stack).
# Desired execution order (outer → inner): Security → RequestID → MaxBody → Route
from app.core.middleware import MaxBodySizeMiddleware, RequestIDMiddleware, SecurityHeadersMiddleware
from app.core.rate_limit import GeneralRateLimitMiddleware

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(GeneralRateLimitMiddleware)
app.add_middleware(RequestIDMiddleware)
app.add_middleware(MaxBodySizeMiddleware)

register_exception_handlers(app)

# ---- Core routes (always mounted) ----
app.include_router(health_router, prefix=settings.API_V1_STR)
app.include_router(auth_router, prefix=settings.API_V1_STR)

from app.api.groups import router as groups_router
app.include_router(groups_router, prefix=f"{settings.API_V1_STR}/groups")

from app.api.trips import router as trips_router
app.include_router(trips_router, prefix=settings.API_V1_STR)

from app.api.locations import router as locations_router
app.include_router(locations_router, prefix=settings.API_V1_STR)

# ---- Extended feature routes ----
from app.api.alerts import router as alerts_router
app.include_router(alerts_router, prefix=settings.API_V1_STR)

from app.api.analytics import router as analytics_router
app.include_router(analytics_router, prefix=settings.API_V1_STR)

from app.api.intelligence import router as intelligence_router
app.include_router(intelligence_router, prefix=settings.API_V1_STR)

from app.api.notifications import router as notifications_router
app.include_router(notifications_router, prefix=settings.API_V1_STR)

from app.api.route import router as route_router
app.include_router(route_router, prefix=settings.API_V1_STR)

from app.api.sos import router as sos_router
app.include_router(sos_router, prefix=settings.API_V1_STR)

from app.api.metrics import router as metrics_router
# The Prometheus /metrics endpoint lives at root (no /api/v1 prefix) to match
# the standard scrape-endpoint convention and existing test expectations.
app.include_router(metrics_router)

# ---- WebSocket routes ----
# app/api/websocket.py: the production Phase-6 WS handler (trip-scoped)
from app.api.websocket import router as ws_api_router
app.include_router(ws_api_router, prefix=settings.API_V1_STR)

# app/websocket/router.py: the legacy group-scoped WS handler (kept for
# backward compatibility with the frontend until fully migrated)
from app.websocket.router import router as legacy_ws_router
app.include_router(legacy_ws_router)

# ---- Demo routes (only when explicitly enabled via DEMO_MODE) ----
if settings.DEMO_MODE:
    from app.api.demo import router as demo_router
    app.include_router(demo_router, prefix=settings.API_V1_STR)


@app.get("/")
def root() -> dict:
    return {
        "message": "RALLY API",
        "docs": "/docs",
        "health": f"{settings.API_V1_STR}/health",
    }