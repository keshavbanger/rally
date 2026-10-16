import uuid
from unittest.mock import patch, MagicMock
import pytest
from fastapi import HTTPException

import app.models  # noqa: F401
from app.models.enums import GroupStatus, MemberRole, MemberStatus
from app.models.group import Group
from app.models.group_member import GroupMember
from app.schemas.group import GroupCreate
from app.services import group_service


class FakeScalarResult:
    def __init__(self, value):
        self._value = value

    def first(self):
        return self._value


class FakeSession:
    def __init__(self, scalar_return=None):
        self.added = []
        self.committed = False
        self.flushed = False
        self.deleted = []
        self._scalar_return = scalar_return

    def add(self, obj):
        self.added.append(obj)

    def flush(self):
        self.flushed = True
        # Assign an id to any added object without one
        for obj in self.added:
            if not getattr(obj, "id", None):
                obj.id = uuid.uuid4()

    def scalars(self, stmt):
        return FakeScalarResult(self._scalar_return)

    def commit(self):
        self.committed = True

    def refresh(self, obj):
        pass

    def delete(self, obj):
        self.deleted.append(obj)


def test_requirement_1_group_creation_adds_creator_as_leader():
    """Requirement 1: Every new group must automatically include its creator as a
    LEADER in group_members, consistent with groups.leader_id."""
    db = FakeSession(scalar_return=None)  # No duplicate join code
    user_id = uuid.uuid4()
    group_data = GroupCreate(name="Safety Convoy", destination_name="Base Camp", latitude=37.77, longitude=-122.41)

    with patch("app.services.group_service.get_or_create_profile"):
        created_group = group_service.create_group(db, user_id, group_data)

    assert created_group.leader_id == user_id
    assert created_group.name == "Safety Convoy"

    # Verify members created in session
    members = [obj for obj in db.added if isinstance(obj, GroupMember)]
    assert len(members) == 1

    leader_member = members[0]
    assert leader_member.user_id == user_id
    assert leader_member.group_id == created_group.id
    assert leader_member.role == MemberRole.LEADER
    assert leader_member.status == MemberStatus.ACTIVE
    assert db.committed is True


def test_requirement_4_leave_group_marks_inactive_left_without_deleting():
    """Requirement 4: When a user leaves a group, mark their membership
    inactive (LEFT) instead of deleting the record."""
    group_id = uuid.uuid4()
    user_id = uuid.uuid4()

    existing_member = GroupMember(
        id=uuid.uuid4(),
        group_id=group_id,
        user_id=user_id,
        role=MemberRole.MEMBER,
        status=MemberStatus.ACTIVE,
    )
    db = FakeSession(scalar_return=existing_member)

    with patch("app.services.group_service.notification_service.notify_group_safely"):
        group_service.leave_group(db, group_id, user_id)

    # Membership must be updated to LEFT (inactive history), never deleted
    assert existing_member.status == MemberStatus.LEFT
    assert len(db.deleted) == 0
    assert db.committed is True


def test_requirement_4_leader_cannot_leave_without_transferring():
    """A leader cannot leave without transferring leadership first."""
    group_id = uuid.uuid4()
    leader_id = uuid.uuid4()

    leader_member = GroupMember(
        id=uuid.uuid4(),
        group_id=group_id,
        user_id=leader_id,
        role=MemberRole.LEADER,
        status=MemberStatus.ACTIVE,
    )
    db = FakeSession(scalar_return=leader_member)

    with pytest.raises(HTTPException) as exc_info:
        group_service.leave_group(db, group_id, leader_id)

    assert exc_info.value.status_code == 400
    assert "Leader cannot leave" in exc_info.value.detail
