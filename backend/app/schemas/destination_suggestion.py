import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, validator

from app.models.enums import SuggestionStatus


class DestinationSuggestionCreate(BaseModel):
    """Payload for creating a new destination suggestion."""
    name: str = Field(..., min_length=1, max_length=255)

    @validator("name")
    def name_not_blank(cls, v):
        if not v.strip():
            raise ValueError("name cannot be empty or whitespace")
        return v
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)

    model_config = ConfigDict(from_attributes=True)


class DestinationSuggestionResponse(BaseModel):
    """Response model for a destination suggestion, mirroring ORM fields."""
    id: uuid.UUID
    group_id: uuid.UUID
    suggested_by: uuid.UUID
    name: str
    latitude: float
    longitude: float
    status: SuggestionStatus
    reviewed_by: Optional[uuid.UUID] = None
    reviewed_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DestinationSuggestionReview(BaseModel):
    """Payload for approving or rejecting a suggestion."""
    status: SuggestionStatus = Field(...)
    rejection_reason: Optional[str] = None

    @validator("status")
    def check_status_allowed(cls, v):
        if v not in (SuggestionStatus.APPROVED, SuggestionStatus.REJECTED):
            raise ValueError("status must be APPROVED or REJECTED")
        return v

    @validator("rejection_reason", always=True)
    def require_reason_if_rejected(cls, v, values):
        status = values.get("status")
        if status == SuggestionStatus.REJECTED:
            if not v or not v.strip():
                raise ValueError("rejection_reason required when status is REJECTED")
        return v

    model_config = ConfigDict(from_attributes=True)
