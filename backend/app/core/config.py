"""
Application configuration, loaded from environment variables (.env in local
dev, real environment variables in production). Never hardcode secrets here --
every sensitive value is Optional/required-with-no-default so a missing .env
fails loudly instead of silently falling back to a bogus value.
"""

from functools import lru_cache
from pathlib import Path
from typing import List, Optional

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve .env path relative to the backend directory so loading is independent
# of the current working directory (e.g. starting from repo root vs backend/).
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
ENV_FILE = BACKEND_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(ENV_FILE), ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Application metadata ---
    PROJECT_NAME: str = "RALLY API"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"

    # --- Supabase ---
    SUPABASE_URL: Optional[str] = None
    SUPABASE_ANON_KEY: Optional[str] = None
    # Server-only. Never send this to the frontend or return it in a response.
    SUPABASE_SERVICE_ROLE_KEY: Optional[str] = None

    # --- Database (Supabase Postgres) ---
    DATABASE_URL: Optional[str] = None

    # Direct (session-mode) Postgres URL for Alembic migrations -- avoids
    # pgBouncer transaction-pooler prepared-statement limitations.
    DIRECT_DATABASE_URL: Optional[str] = None

    # --- Redis (wired later -- read now so config is ready ahead of time) ---
    REDIS_URL: Optional[str] = None

    # --- Auth ---
    # Supabase Auth's JWT signing secret. FastAPI only ever *verifies* tokens
    # issued by Supabase Auth -- it never mints its own.
    JWT_SECRET: Optional[str] = None
    JWT_ALGORITHM: str = "HS256"

    # --- Routing engine (wired later) ---
    OSRM_URL: Optional[str] = None

    # --- CORS ---
    # Comma-separated list of allowed origins, e.g.
    # "http://localhost:3000,https://rally.app"
    FRONTEND_URL: str = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001"
    CORS_ALLOWED_ORIGINS: Optional[str] = None

    @property
    def cors_origins(self) -> List[str]:
        raw = self.CORS_ALLOWED_ORIGINS or self.FRONTEND_URL
        return [origin.strip() for origin in raw.split(",") if origin.strip()]

    @model_validator(mode="after")
    def validate_production_secrets(self) -> "Settings":
        if self.ENVIRONMENT == "production":
            required = [
                ("DATABASE_URL", self.DATABASE_URL),
                ("REDIS_URL", self.REDIS_URL),
                ("SUPABASE_URL", self.SUPABASE_URL),
                ("SUPABASE_ANON_KEY", self.SUPABASE_ANON_KEY),
                ("SUPABASE_SERVICE_ROLE_KEY", self.SUPABASE_SERVICE_ROLE_KEY),
                ("JWT_SECRET", self.JWT_SECRET),
            ]
            missing = [name for name, val in required if not val]
            if missing:
                raise ValueError(f"Missing required production secrets: {', '.join(missing)}")
            if self.DEMO_MODE:
                raise ValueError("DEMO_MODE must not be enabled in the production environment.")
        return self

    # -------------------------------------------------------------------------
    # Database connection pool (app/core/database.py)
    # -------------------------------------------------------------------------
    DATABASE_POOL_SIZE: int = 5
    DATABASE_MAX_OVERFLOW: int = 10
    DATABASE_POOL_TIMEOUT_SECONDS: int = 30
    # Proactively retire connections older than this to avoid surprises from
    # Supabase's server-side idle-connection timeouts (~600 s by default).
    DATABASE_POOL_RECYCLE_SECONDS: int = 300

    # -------------------------------------------------------------------------
    # Redis timeouts (app/core/redis.py)
    # A missing/slow Redis host should degrade gracefully, not block forever.
    # -------------------------------------------------------------------------
    REDIS_CONNECT_TIMEOUT_SECONDS: float = 5.0
    REDIS_SOCKET_TIMEOUT_SECONDS: float = 5.0

    # -------------------------------------------------------------------------
    # Rate limiting (app/core/rate_limit.py, app/api/*.py)
    # -------------------------------------------------------------------------
    RATE_LIMIT_ENABLED: bool = True
    # Catch-all limit applied to every authenticated/unauthenticated request
    # by GeneralRateLimitMiddleware; tighter endpoint-specific limits below
    # are applied on top and can reject a request before this one would.
    GENERAL_API_RATE_LIMIT_PER_MINUTE: int = 300
    # Endpoint-specific limits -- all in requests/minute, per user.
    AUTH_RATE_LIMIT_PER_MINUTE: int = 20
    JOIN_GROUP_RATE_LIMIT_PER_MINUTE: int = 10
    SOS_RATE_LIMIT_PER_MINUTE: int = 5
    # GPS is high-frequency, so this is expressed per-second; the REST
    # endpoint converts it to per-minute with math.ceil (see locations.py).
    MAX_LOCATION_UPDATES_PER_SECOND: float = 1.0

    # Disconnect per-user connection limit for the trip WebSocket (app/api/websocket.py)
    MAX_WS_CONNECTIONS_PER_USER: int = 3

    # -------------------------------------------------------------------------
    # WebSocket limits (app/websocket/handlers.py, app/api/websocket.py)
    # -------------------------------------------------------------------------
    # Reject any single message larger than this before parsing JSON.
    WS_MAX_MESSAGE_BYTES: int = 4096
    # General per-connection messages/second cap (all message types combined).
    WEBSOCKET_MESSAGES_PER_SECOND: int = 10
    # Disconnect a connection after this many consecutive rate-limited messages.
    WEBSOCKET_FLOOD_DISCONNECT_THRESHOLD: int = 10

    # -------------------------------------------------------------------------
    # Redis live-state TTLs (app/services/live_state_service.py,
    #                         app/services/presence_service.py)
    # Both values are "how long until Redis auto-expires the key when no new
    # update has arrived" -- not how often updates are expected.
    # -------------------------------------------------------------------------
    LIVE_LOCATION_TTL_SECONDS: int = 300   # 5 min -- location goes stale fast
    PRESENCE_TTL_SECONDS: int = 60         # 1 min -- heartbeat keeps this fresh

    # -------------------------------------------------------------------------
    # Request body size cap (app/core/middleware.py MaxBodySizeMiddleware)
    # -------------------------------------------------------------------------
    MAX_REQUEST_BODY_BYTES: int = 65_536   # 64 KiB

    # -------------------------------------------------------------------------
    # Risk scoring (app/risk/service.py)
    # -------------------------------------------------------------------------
    # Score thresholds -- a score <= LOW_MAX is "LOW", <= MEDIUM_MAX is "MEDIUM", etc.
    RISK_LOW_MAX: int = 30
    RISK_MEDIUM_MAX: int = 60
    RISK_HIGH_MAX: int = 80
    # Factor weights (additive; score is capped at 100)
    RISK_WEIGHT_ACTIVE_SOS: int = 50
    RISK_WEIGHT_CRITICAL_ALERT: int = 30
    RISK_WEIGHT_GROUP_SEPARATION: int = 17
    RISK_WEIGHT_ISOLATED_MEMBER: int = 12
    RISK_WEIGHT_FALLING_BEHIND: int = 10
    RISK_WEIGHT_ROUTE_DEVIATION: int = 8
    RISK_WEIGHT_UNEXPECTED_STOP: int = 8
    RISK_WEIGHT_SPEED_ANOMALY: int = 8
    RISK_WEIGHT_LOW_ACTIVE_RATIO: int = 10
    # Fraction of members that must be online before LOW_ACTIVE_RATIO fires.
    RISK_LOW_ACTIVE_RATIO_THRESHOLD: float = 0.5

    # -------------------------------------------------------------------------
    # Intelligence detection thresholds (app/intelligence/thresholds.py)
    # -------------------------------------------------------------------------
    INTELLIGENCE_EVALUATION_INTERVAL_SECONDS: float = 10.0

    # Movement / stop detection
    STOP_SPEED_MPS: float = 0.5            # below this -> considered stopped
    STOP_DURATION_SECONDS: int = 60        # must be stopped this long to fire

    # Location freshness
    STALE_LOCATION_SECONDS: int = 30       # location older than this -> stale

    # Falling-behind detection
    FALLING_BEHIND_DISTANCE_METERS: float = 200.0
    FALLING_BEHIND_DURATION_SECONDS: int = 30

    # Group-separation detection
    GROUP_SEPARATION_DISTANCE_METERS: float = 500.0
    GROUP_SEPARATION_DURATION_SECONDS: int = 30

    # Isolated-member detection
    ISOLATED_MEMBER_DISTANCE_METERS: float = 300.0
    ISOLATED_MEMBER_DURATION_SECONDS: int = 30

    # Speed anomaly detection
    MAX_REASONABLE_SPEED_MPS: float = 55.6  # ~200 km/h
    SPEED_ANOMALY_DURATION_SECONDS: int = 10

    # Group-cohesion radius used by several detectors
    GROUP_COHESION_DISTANCE_METERS: float = 100.0

    # Minimum GPS accuracy accepted for detections
    MIN_USABLE_ACCURACY_METERS: float = 50.0

    # -------------------------------------------------------------------------
    # Route intelligence thresholds (app/intelligence/thresholds.py, Phase 9)
    # -------------------------------------------------------------------------
    ROUTE_ENDPOINT_TOLERANCE_METERS: float = 50.0
    OFF_ROUTE_THRESHOLD_METERS: float = 100.0
    ROUTE_DEVIATION_DURATION_SECONDS: int = 30
    ARRIVAL_THRESHOLD_METERS: float = 50.0
    ARRIVAL_DURATION_SECONDS: int = 10
    ROUTE_PROGRESS_STALE_SECONDS: int = 60
    BASELINE_ROUTE_SPEED_MPS: float = 8.33  # ~30 km/h

    # -------------------------------------------------------------------------
    # Weather service (app/weather/service.py)
    # -------------------------------------------------------------------------
    WEATHER_PROVIDER: str = "open-meteo"   # "openweathermap" | "open-meteo"
    WEATHER_API_KEY: Optional[str] = None  # Required only for openweathermap
    WEATHER_REQUEST_TIMEOUT_SECONDS: float = 10.0
    WEATHER_CACHE_TTL_SECONDS: int = 600   # 10 min

    # -------------------------------------------------------------------------
    # Demo simulator (app/demo/simulator.py)
    # -------------------------------------------------------------------------
    # When True, the demo router is mounted even in production — should only
    # ever be enabled in a dedicated demo environment, never in real prod.
    DEMO_MODE: bool = False
    DEMO_TICK_INTERVAL_SECONDS: float = 2.0



    # -------------------------------------------------------------------------
    # Logging (app/core/logging.py)
    # -------------------------------------------------------------------------
    LOG_LEVEL: str = "INFO"   # DEBUG | INFO | WARNING | ERROR | CRITICAL

    # -------------------------------------------------------------------------
    # Analytics / replay (app/api/analytics.py)
    # -------------------------------------------------------------------------
    MAX_ANALYTICS_SPEED_MPS: float = 55.6      # ~200 km/h; above this is filtered as noise
    REPLAY_DEFAULT_INTERVAL_SECONDS: int = 10
    REPLAY_MIN_INTERVAL_SECONDS: int = 2
    REPLAY_MAX_INTERVAL_SECONDS: int = 300
    REPLAY_MAX_FRAMES: int = 2000
@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()