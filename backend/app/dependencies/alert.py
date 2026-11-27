"""
Authorization for the top-level /alerts/{alert_id} routes — mirrors
app/dependencies/trip.py exactly (alert_id -> get_alert_or_404() ->
get_alert_membership() -> require_alert_member()), same existence-hiding
rationale: an alert that doesn't exist and an alert belonging to a group
the caller isn't an active member of both return the same 404.
"""

import uuid
from typing import Tuple

from fastapi import Depends, Path, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppHTTPException
from app.dependencies.auth import get_current_user_id
from app.models.alert import Alert
from app.models.enums import MemberRole, MemberStatus
from app.models.group_member import GroupMember


def get_alert_or_404(alert_id: uuid.UUID = Path(...), db: Session = Depends(get_db)) -> Alert:
    alert = db.get(Alert, alert_id)
    if not alert:
        raise AppHTTPException(status_code=status.HTTP_404_NOT_FOUND, code="ALERT_NOT_FOUND", detail="Alert not found.")
    return alert


def get_alert_membership(
    user_id: str = Depends(get_current_user_id),
    alert: Alert = Depends(get_alert_or_404),
    db: Session = Depends(get_db),
) -> Tuple[Alert, GroupMember]:
    member = db.scalars(
        select(GroupMember).where(GroupMember.group_id == alert.group_id, GroupMember.user_id == user_id)
    ).first()
    if not member or member.status != MemberStatus.ACTIVE:
        raise AppHTTPException(status_code=status.HTTP_404_NOT_FOUND, code="ALERT_NOT_FOUND", detail="Alert not found.")
    return alert, member


def require_alert_member(pair: Tuple[Alert, GroupMember] = Depends(get_alert_membership)) -> Alert:
    alert, _member = pair
    return alert


def require_alert_owner_or_leader(
    pair: Tuple[Alert, GroupMember] = Depends(get_alert_membership),
    user_id: str = Depends(get_current_user_id),
) -> Alert:
    alert, member = pair
    is_subject = alert.user_id is not None and str(alert.user_id) == str(user_id)
    is_leader = member.role == MemberRole.LEADER
    if not (is_subject or is_leader):
        raise AppHTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="FORBIDDEN",
            detail="Only the affected member or the group leader can resolve this alert.",
        )
    return alert
