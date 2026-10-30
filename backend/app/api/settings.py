import uuid
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.dependencies.auth import get_current_user_id
from app.schemas.user_setting import UserSettingResponse, UserSettingUpdate
from app.services import settings_service

router = APIRouter(prefix="/settings", tags=["Settings"])


@router.get("", response_model=UserSettingResponse, status_code=status.HTTP_200_OK)
def get_settings_endpoint(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Retrieve the authenticated user's persisted safety thresholds and preferences."""
    return settings_service.get_or_create_user_settings(db, uuid.UUID(user_id))


@router.patch("", response_model=UserSettingResponse, status_code=status.HTTP_200_OK)
def update_settings_endpoint(
    data: UserSettingUpdate,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Update safety thresholds, notification preferences, or UI preferences."""
    return settings_service.update_user_settings(db, uuid.UUID(user_id), data)
