import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import utc_now


class UserSetting(Base):
    """User-level safety thresholds and notification preferences.
    One-to-one with Profile.id.
    """

    __tablename__ = "user_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    alert_sensitivity: Mapped[str] = mapped_column(String(20), default="MEDIUM", nullable=False)
    separation_threshold_m: Mapped[float] = mapped_column(Float, default=150.0, nullable=False)
    route_deviation_threshold_m: Mapped[float] = mapped_column(Float, default=100.0, nullable=False)
    notifications_alerts: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notifications_sos: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notifications_connectivity: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notifications_trip_summaries: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sound_alerts_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    location_sharing: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    theme: Mapped[str] = mapped_column(String(20), default="dark", nullable=False)
    units: Mapped[str] = mapped_column(String(20), default="Metric", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    profile: Mapped[Optional["Profile"]] = relationship(back_populates="settings")  # noqa: F821
