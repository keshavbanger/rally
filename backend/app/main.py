import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.health import router as health_router
from app.core.config import settings
from app.core.database import close_database
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import MaxBodySizeMiddleware, RequestIDMiddleware, SecurityHeadersMiddleware
from app.core.rate_limit import GeneralRateLimitMiddleware
from app.core.redis import close_redis, init_redis, ping_redis
from app.intelligence.worker import run_intelligence_worker
from app.websocket.manager import manager

configure_logging(settings.ENVIRONMENT, settings.LOG_LEVEL)
logger = logging.getLogger("rally.startup")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("%s starting up (environment=%s)", settings.PROJECT_NAME, settings.ENVIRONMENT)
    if not settings.DATABASE_URL:
        logger.warning("DATABASE_URL is not set - /health will report the database as not_configured.")

    init_redis()
    if settings.REDIS_URL and not await ping_redis():
        logger.warning("Redis is configured but unreachable - live tracking (WebSockets) will be unavailable.")

    worker_task = asyncio.create_task(run_intelligence_worker())

    yield

    # Graceful shutdown (Part 12), in order: stop background work first
    # (so nothing is still trying to use Redis/the database once they're
    # closed below), then close live WebSocket connections so clients get
    # a clean disconnect instead of the process just vanishing, then
    # release Redis and the database connection pool last.
    logger.info("%s shutting down", settings.PROJECT_NAME)
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass

    await manager.close_all()
    await close_redis()
    close_database()
    logger.info("%s shutdown complete", settings.PROJECT_NAME)


app = FastAPI(
    title=settings.PROJECT_NAME,
    # Part 14 — API documentation: ENABLE_DOCS=false removes Swagger/
    # ReDoc/the raw OpenAPI schema entirely (None disables each in
    # FastAPI, rather than merely hiding a link to them).
    openapi_url=f"{settings.API_V1_STR}/openapi.json" if settings.ENABLE_DOCS else None,
    docs_url="/docs" if settings.ENABLE_DOCS else None,
    redoc_url="/redoc" if settings.ENABLE_DOCS else None,
    lifespan=lifespan,
)

# Middleware executes outermost-to-innermost in REVERSE of the order added
# below (Starlette: the last one added wraps everything else). So,
# outermost -> innermost: RequestID -> CORS -> SecurityHeaders ->
# GeneralRateLimit -> MaxBodySize -> routes.
app.add_middleware(MaxBodySizeMiddleware)
app.add_middleware(GeneralRateLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestIDMiddleware)

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
        "docs": "/docs" if settings.ENABLE_DOCS else None,
        "health": f"{settings.API_V1_STR}/health",
    }