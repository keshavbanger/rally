import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.dependencies.group import require_group_leader, require_group_member
from app.main import app
from app.models.enums import ArrivalStatus, GroupStatus, JourneyMode, MemberRole, MemberStatus, SessionStatus, TripStatus
from app.models.group import Group
from app.models.group_member import GroupMember
from app.models.trip import Trip
from app.schemas.group import GroupCreate, SetMeetupRequest, UpdateReadinessRequest
from app.services import group_service, trip_service


def test_create_group_meetup_first():
    """Group creation in MEETUP_FIRST mode initializes correctly."""
    db = MagicMock()
    user_id = uuid.uuid4()
    data = GroupCreate(
        name="Mountain Tour",
        journey_mode=JourneyMode.MEETUP_FIRST,
        meetup_name="Central Fuel Station",
        meetup_latitude=19.100,
        meetup_longitude=72.900,
        destination_name="Summit Point",
    )

    db.scalars().first.return_value = None  # join code collision check

    group = group_service.create_group(db, user_id, data)
    assert group.journey_mode == JourneyMode.MEETUP_FIRST
    assert group.meetup_name == "Central Fuel Station"
    assert group.meetup_location == "POINT(72.9 19.1)"
    assert group.session_status == SessionStatus.MEETUP


def test_leader_sets_meetup_location():
    """Leader sets meetup location, moving session to MEETUP."""
    db = MagicMock()
    group_id = uuid.uuid4()
    leader_id = uuid.uuid4()
    group = Group(
        id=group_id,
        status=GroupStatus.ACTIVE,
        leader_id=leader_id,
        session_status=SessionStatus.CREATED,
    )
    db.scalars().first.return_value = group

    updated = group_service.set_meetup_location(
        db, group_id, leader_id, "South Gate", 19.05, 72.85
    )
    assert updated.meetup_name == "South Gate"
    assert updated.meetup_location == "POINT(72.85 19.05)"
    assert updated.journey_mode == JourneyMode.MEETUP_FIRST
    assert updated.session_status == SessionStatus.MEETUP
    assert db.commit.called


def test_member_updates_readiness_and_triggers_ready_state():
    """Members marking READY transitions group to READY when all active members are ready."""
    db = MagicMock()
    group_id = uuid.uuid4()
    user_id = uuid.uuid4()

    group = Group(
        id=group_id,
        status=GroupStatus.ACTIVE,
        journey_mode=JourneyMode.MEETUP_FIRST,
        session_status=SessionStatus.MEETUP,
    )
    member = GroupMember(
        group_id=group_id,
        user_id=user_id,
        status=MemberStatus.ACTIVE,
        arrival_status=ArrivalStatus.NOT_ARRIVED,
    )

    # First scalars call gets member, second in get_group gets group, all() gets all members
    db.scalars().first.side_effect = [member, group]
    db.scalars().all.return_value = [member]

    updated_member = group_service.update_member_readiness(
        db, group_id, user_id, ArrivalStatus.READY
    )

    assert updated_member.arrival_status == ArrivalStatus.READY
    assert group.session_status == SessionStatus.READY


def test_rally_start_readiness_validation():
    """Rally cannot start in MEETUP_FIRST mode if requirements are not met."""
    db = MagicMock()
    group_id = uuid.uuid4()

    # Case 1: Meetup not set
    group_no_meetup = Group(
        id=group_id,
        journey_mode=JourneyMode.MEETUP_FIRST,
        meetup_name=None,
        meetup_location=None,
    )
    with pytest.raises(HTTPException) as exc:
        group_service.validate_rally_start_readiness(db, group_no_meetup)
    assert exc.value.status_code == 409
    assert "without a configured meetup point" in exc.value.detail

    # Case 2: Multi-member group where nobody is ready
    group_with_meetup = Group(
        id=group_id,
        journey_mode=JourneyMode.MEETUP_FIRST,
        meetup_name="North Hub",
        meetup_location="POINT(72 19)",
    )
    m1 = GroupMember(arrival_status=ArrivalStatus.NOT_ARRIVED, status=MemberStatus.ACTIVE)
    m2 = GroupMember(arrival_status=ArrivalStatus.NOT_ARRIVED, status=MemberStatus.ACTIVE)
    db.scalars().all.return_value = [m1, m2]

    with pytest.raises(HTTPException) as exc2:
        group_service.validate_rally_start_readiness(db, group_with_meetup)
    assert exc2.value.status_code == 409
    assert "no group members have marked themselves ready" in exc2.value.detail

    # Case 3: Ready member present -> validation passes cleanly
    m1.arrival_status = ArrivalStatus.READY
    group_service.validate_rally_start_readiness(db, group_with_meetup)  # No exception raised


def test_meetup_and_readiness_api_endpoints():
    """Verify HTTP API contracts for meetup configuration and readiness status."""
    client = TestClient(app)
    group_id = uuid.uuid4()
    user_id = uuid.uuid4()

    mock_db = MagicMock()
    mock_member = GroupMember(
        group_id=group_id,
        user_id=user_id,
        role=MemberRole.MEMBER,
        status=MemberStatus.ACTIVE,
        arrival_status=ArrivalStatus.READY,
        joined_at=datetime.now(timezone.utc),
    )
    mock_leader = GroupMember(
        group_id=group_id,
        user_id=user_id,
        role=MemberRole.LEADER,
        status=MemberStatus.ACTIVE,
        arrival_status=ArrivalStatus.READY,
        joined_at=datetime.now(timezone.utc),
    )

    sample_group = Group(
        id=group_id,
        name="Expedition",
        join_code="RALLY-EXP",
        leader_id=user_id,
        status=GroupStatus.ACTIVE,
        journey_mode=JourneyMode.MEETUP_FIRST,
        session_status=SessionStatus.MEETUP,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )

    app.dependency_overrides[get_db] = lambda: mock_db
    app.dependency_overrides[require_group_member] = lambda: mock_member
    app.dependency_overrides[require_group_leader] = lambda: mock_leader

    try:
        with patch.object(group_service, "set_meetup_location", return_value=sample_group) as mock_set_meetup, \
             patch.object(group_service, "update_member_readiness", return_value=mock_member) as mock_update_readiness, \
             patch.object(group_service, "get_group_readiness", return_value={"total_members": 2, "ready_members": 2, "all_ready": True}) as mock_get_readiness:

            # 1. Set meetup point (leader)
            meetup_resp = client.post(
                f"/api/v1/groups/{group_id}/meetup",
                json={"meetup_name": "Gate 1", "latitude": 19.2, "longitude": 72.8},
            )
            assert meetup_resp.status_code == 200
            mock_set_meetup.assert_called_once()

            # 2. Update readiness (member)
            readiness_resp = client.post(
                f"/api/v1/groups/{group_id}/readiness",
                json={"arrival_status": "READY"},
            )
            assert readiness_resp.status_code == 200
            mock_update_readiness.assert_called_once()

            # 3. Get readiness summary
            summary_resp = client.get(f"/api/v1/groups/{group_id}/readiness")
            assert summary_resp.status_code == 200
            assert summary_resp.json()["all_ready"] is True
            mock_get_readiness.assert_called_once()
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(require_group_member, None)
        app.dependency_overrides.pop(require_group_leader, None)
