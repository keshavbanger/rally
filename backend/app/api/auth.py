from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import rate_limit_by_user
from app.dependencies.auth import get_current_profile, get_current_user
from app.models.profile import Profile
from app.schemas.auth import AuthenticatedUser, MeResponse, ProfileOut, ProfileUpdate

router = APIRouter(tags=["auth"])


@router.get(
    "/auth/me",
    response_model=MeResponse,
    dependencies=[Depends(rate_limit_by_user("auth", lambda: settings.AUTH_RATE_LIMIT_PER_MINUTE))],
)
def read_current_user(
    user: AuthenticatedUser = Depends(get_current_user),
    profile: Profile = Depends(get_current_profile),
) -> MeResponse:
    return MeResponse(
        id=user.id,
        email=user.email,
        profile=ProfileOut.model_validate(profile),
    )


@router.patch(
    "/auth/me",
    response_model=MeResponse,
    dependencies=[Depends(rate_limit_by_user("auth", lambda: settings.AUTH_RATE_LIMIT_PER_MINUTE))],
)
def update_current_user(
    data: ProfileUpdate,
    user: AuthenticatedUser = Depends(get_current_user),
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> MeResponse:
    if data.full_name is not None:
        profile.full_name = data.full_name
    if data.avatar_url is not None:
        profile.avatar_url = data.avatar_url
    db.commit()
    db.refresh(profile)
    return MeResponse(
        id=user.id,
        email=user.email,
        profile=ProfileOut.model_validate(profile),
    )
