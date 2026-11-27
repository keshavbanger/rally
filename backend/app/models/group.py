import uuid
from typing import Optional

from geoalchemy2 import Geography
import sqlalchemy as sa
from sqlalchemy import ForeignKey, String, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import GroupStatus, JourneyMode, SessionStatus
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Group(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "groups"

    # Core fields
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    join_code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    # SET NULL rather than CASCADE: losing the leader's profile shouldn't destroy the group and its trip history.
    leader_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="SET NULL"), nullable=True
    )
    destination_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    destination = mapped_column(Geography(geometry_type="POINT", srid=4326), nullable=True)
    status: Mapped[GroupStatus] = mapped_column(
        SQLEnum(GroupStatus, name="group_status"), default=GroupStatus.ACTIVE, nullable=False
    )

    # ---- Phase 1 new fields ----
    journey_mode: Mapped[JourneyMode] = mapped_column(
        SQLEnum(JourneyMode, name="journeymode"), nullable=False, default=JourneyMode.DIRECT_DESTINATION
    )
    meetup_location = mapped_column(Geography(geometry_type="POINT", srid=4326), nullable=True)
    session_status: Mapped[Optional[SessionStatus]] = mapped_column(
        SQLEnum(SessionStatus, name="sessionstatus"), nullable=True, server_default=sa.text("'CREATED'")
    )

    # Relationships
    leader: Mapped[Optional["Profile"]] = relationship(back_populates="led_groups")  # noqa: F821
    members: Mapped[list["GroupMember"]] = relationship(
        back_populates="group", cascade="all, delete-orphan"
    )
    # Deliberately NOT cascade="delete" — see Trip.group_id for why a group must not silently destroy trip history.
    trips: Mapped[list["Trip"]] = relationship(back_populates="group")  # noqa: F821
