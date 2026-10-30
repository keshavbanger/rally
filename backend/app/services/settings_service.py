import uuid
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.user_setting import UserSetting
from app.schemas.user_setting import UserSettingUpdate


def get_or_create_user_settings(db: Session, user_id: uuid.UUID) -> UserSetting:
    setting = db.scalar(select(UserSetting).where(UserSetting.user_id == user_id))
    if not setting:
        setting = UserSetting(user_id=user_id)
        db.add(setting)
        db.commit()
        db.refresh(setting)
    return setting


def update_user_settings(db: Session, user_id: uuid.UUID, data: UserSettingUpdate) -> UserSetting:
    setting = get_or_create_user_settings(db, user_id)
    update_dict = data.model_dump(exclude_unset=True)
    for field_name, value in update_dict.items():
        setattr(setting, field_name, value)
    db.commit()
    db.refresh(setting)
    return setting
