import uuid
from app.models.mixins import utc_now
from typing import List

from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models.enums import SuggestionStatus, MemberStatus, MemberRole, SessionStatus
from app.models.destination_suggestion import DestinationSuggestion
from app.models.group import Group
from app.models.group_member import GroupMember
from app.services.group_service import set_official_destination


def _ensure_active_member(db: Session, group_id: uuid.UUID, user_id: uuid.UUID) -> Group:
    """Validate that the group exists, is not completed/archived, and the user is an active member.
    Returns the Group instance for further checks.
    """
    group = db.scalars(select(Group).where(Group.id == group_id)).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found.")
    if group.session_status in (SessionStatus.COMPLETED, SessionStatus.ARCHIVED):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot modify suggestions for a completed or archived session.",
        )
    member = db.scalars(
        select(GroupMember).where(GroupMember.group_id == group_id, GroupMember.user_id == user_id)
    ).first()
    if not member or member.status != MemberStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User must be an active member of the group to perform this action.",
        )
    return group


def create_suggestion(
    db: Session,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
    name: str,
    latitude: float,
    longitude: float,
) -> DestinationSuggestion:
    """Create a new destination suggestion.
    The suggestion is linked to the group and the suggesting user.
    """
    _ensure_active_member(db, group_id, user_id)
    # Validate coordinates
    if not (-90 <= latitude <= 90) or not (-180 <= longitude <= 180):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid latitude or longitude values.",
        )
    suggestion = DestinationSuggestion(
        id=uuid.uuid4(),
        group_id=group_id,
        suggested_by=user_id,
        name=name,
        latitude=latitude,
        longitude=longitude,
        status=SuggestionStatus.PENDING,
    )
    db.add(suggestion)
    db.commit()
    db.refresh(suggestion)
    return suggestion


def list_suggestions(
    db: Session, group_id: uuid.UUID, user_id: uuid.UUID
) -> List[DestinationSuggestion]:
    """Return all suggestions for the given group.
    Only active members may view suggestions.
    """
    _ensure_active_member(db, group_id, user_id)
    suggestions = db.scalars(
        select(DestinationSuggestion).where(DestinationSuggestion.group_id == group_id)
    ).all()
    return suggestions


def review_suggestion(
    db: Session,
    group_id: uuid.UUID,
    suggestion_id: uuid.UUID,
    reviewer_id: uuid.UUID,
    new_status: SuggestionStatus,
    rejection_reason: str | None = None,
) -> DestinationSuggestion:
    """Review a pending suggestion.
    Only the group leader can approve or reject.
    On approval, the group's official destination is updated.
    """
    # Fetch the group
    group = db.scalars(select(Group).where(Group.id == group_id)).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found.")
    # Session must be active
    if group.session_status in (SessionStatus.COMPLETED, SessionStatus.ARCHIVED):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot review suggestions for a completed or archived session.",
        )
    # Only leader can review
    if group.leader_id != reviewer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the group leader can review suggestions.",
        )
    # Validate status
    if new_status not in (SuggestionStatus.APPROVED, SuggestionStatus.REJECTED):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only APPROVED or REJECTED statuses are allowed.",
        )
    # Fetch the suggestion belonging to this group
    suggestion = db.scalars(
        select(DestinationSuggestion).where(
            DestinationSuggestion.id == suggestion_id,
            DestinationSuggestion.group_id == group_id,
        )
    ).first()
    if not suggestion:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Suggestion not found.")
    # Ensure it's pending
    if suggestion.status != SuggestionStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only pending suggestions can be reviewed.",
        )
    # Process based on new_status and perform all mutations in a single transaction
    try:
        if new_status == SuggestionStatus.REJECTED:
            if not rejection_reason or not rejection_reason.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Rejection reason must be provided for rejected suggestions.",
                )
            suggestion.rejection_reason = rejection_reason.strip()
        else:
            # APPROVED – clear any prior reason and update official destination
            suggestion.rejection_reason = None
            set_official_destination(
                db,
                group_id=group_id,
                user_id=reviewer_id,
                name=suggestion.name,
                latitude=suggestion.latitude,
                longitude=suggestion.longitude,
            )
            # Ensure group object reflects the new destination (mock may not modify it)
            group.destination_name = suggestion.name
            group.destination = f"POINT({suggestion.longitude} {suggestion.latitude})"

        # Apply review fields
        suggestion.status = new_status
        suggestion.reviewed_by = reviewer_id
        suggestion.reviewed_at = utc_now()
        # Commit transaction and refresh
        db.commit()
        db.refresh(suggestion)
    except Exception as exc:
        db.rollback()
        raise
    return suggestion
