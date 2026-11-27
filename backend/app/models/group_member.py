import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Enum as SQLEnum, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import MemberRole, MemberStatus, ArrivalStatus
from app.models.mixins import UUIDPrimaryKeyMixin, utc_now



class GroupMember(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "group_members"
    __table_args__ = (
        UniqueConstraint("group_id", "user_id", name="uq_group_members_group_user"),
    )

    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[MemberRole] = mapped_column(
        SQLEnum(MemberRole, name="member_role"), default=MemberRole.MEMBER, nullable=False
    )
    status: Mapped[MemberStatus] = mapped_column(
        SQLEnum(MemberStatus, name="member_status"), default=MemberStatus.ACTIVE, nullable=False
    )
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    arrival_status: Mapped[ArrivalStatus] = mapped_column(
        SQLEnum(ArrivalStatus, name="arrivalstatus"), nullable=False, default=ArrivalStatus.PENDING
    )

    group: Mapped["Group"] = relationship(back_populates="members")  # noqa: F821
    user: Mapped["Profile"] = relationship(back_populates="memberships")  # noqa: F821
