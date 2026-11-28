import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.dependencies.group import require_group_leader, require_group_member
from app.models.enums import SuggestionStatus
from app.models.group_member import GroupMember
from app.schemas.destination_suggestion import (
    DestinationSuggestionCreate,
    DestinationSuggestionResponse,
    DestinationSuggestionReview,
)
from app.services import destination_suggestion_service

router = APIRouter(tags=["Destination Suggestions"])


class RejectionPayload(BaseModel):
    reason: str = Field(..., min_length=1)


@router.post(
    "/{group_id}/suggestions",
    response_model=DestinationSuggestionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_suggestion_endpoint(
    group_id: uuid.UUID,
    data: DestinationSuggestionCreate,
    member: GroupMember = Depends(require_group_member),
    db: Session = Depends(get_db),
):
    """Propose an alternative destination for the group. Any active member can suggest."""
    return destination_suggestion_service.create_suggestion(
        db, group_id, member.user_id, data.name, data.latitude, data.longitude
    )


@router.get(
    "/{group_id}/suggestions",
    response_model=List[DestinationSuggestionResponse],
)
def list_suggestions_endpoint(
    group_id: uuid.UUID,
    member: GroupMember = Depends(require_group_member),
    db: Session = Depends(get_db),
):
    """List all destination suggestions for the group."""
    return destination_suggestion_service.list_suggestions(db, group_id, member.user_id)


@router.post(
    "/{group_id}/suggestions/{suggestion_id}/approve",
    response_model=DestinationSuggestionResponse,
)
def approve_suggestion_endpoint(
    group_id: uuid.UUID,
    suggestion_id: uuid.UUID,
    leader: GroupMember = Depends(require_group_leader),
    db: Session = Depends(get_db),
):
    """Leader approves a destination suggestion. Updates the official group destination."""
    return destination_suggestion_service.review_suggestion(
        db, group_id, suggestion_id, leader.user_id, SuggestionStatus.APPROVED
    )


@router.post(
    "/{group_id}/suggestions/{suggestion_id}/reject",
    response_model=DestinationSuggestionResponse,
)
def reject_suggestion_endpoint(
    group_id: uuid.UUID,
    suggestion_id: uuid.UUID,
    payload: RejectionPayload,
    leader: GroupMember = Depends(require_group_leader),
    db: Session = Depends(get_db),
):
    """Leader rejects a destination suggestion with an explicit reason."""
    return destination_suggestion_service.review_suggestion(
        db, group_id, suggestion_id, leader.user_id, SuggestionStatus.REJECTED, payload.reason
    )


@router.post(
    "/{group_id}/suggestions/{suggestion_id}/review",
    response_model=DestinationSuggestionResponse,
)
def review_suggestion_endpoint(
    group_id: uuid.UUID,
    suggestion_id: uuid.UUID,
    review: DestinationSuggestionReview,
    leader: GroupMember = Depends(require_group_leader),
    db: Session = Depends(get_db),
):
    """Generic review endpoint supporting either APPROVED or REJECTED."""
    return destination_suggestion_service.review_suggestion(
        db, group_id, suggestion_id, leader.user_id, review.status, review.rejection_reason
    )
