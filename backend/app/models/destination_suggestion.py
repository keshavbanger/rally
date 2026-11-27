
from sqlalchemy import Column, Float, String, Enum, ForeignKey, DateTime, Text
from sqlalchemy.orm import relationship

from .mixins import UUIDPrimaryKeyMixin, TimestampMixin
from .enums import SuggestionStatus

from app.core.database import Base

class DestinationSuggestion(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "destination_suggestions"

    group_id = Column(ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    suggested_by = Column(ForeignKey("profiles.id", ondelete="RESTRICT"), nullable=False)
    name = Column(String(255), nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    status = Column(
        Enum(SuggestionStatus, name="suggestionstatus"),
        nullable=False,
        default=SuggestionStatus.PENDING,
        server_default=SuggestionStatus.PENDING.value,
    )
    reviewed_by = Column(ForeignKey("profiles.id", ondelete="SET NULL"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    rejection_reason = Column(Text, nullable=True)


    # Relationships
    group = relationship("Group", back_populates="suggestions")
    suggester = relationship("Profile", foreign_keys=[suggested_by])
    reviewer = relationship("Profile", foreign_keys=[reviewed_by])
