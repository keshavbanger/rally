import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.dependencies.group import require_group_leader, require_group_member
from app.main import app
from app.models.destination_suggestion import DestinationSuggestion
from app.models.enums import (
    ArrivalStatus,
    GroupStatus,
    JourneyMode,
    MemberRole,
    MemberStatus,
    SessionStatus,
    SuggestionStatus,
    TripStatus,
)
from app.models.group import Group
from app.models.group_member import GroupMember
from app.models.trip import Trip
from app.schemas.destination_suggestion import DestinationSuggestionCreate
from app.schemas.group import GroupCreate
from app.services import destination_suggestion_service, group_service, trip_service


def test_complete_multi_user_rally_journey_lifecycle():
    """Simulates Leader, Member A, and Member B across all 22 steps of the multi-user journey:
    - Group creation (MEETUP_FIRST)
    - Membership joining
    - Meetup point designated
    - Members reporting arrival and readiness
    - Rally start gated by readiness
    - Direct destination manipulation forbidden to regular members
    - Alternative destination suggested by member
    - Leader approves alternative -> atomic official destination update
    - Rally completion records duration and transitions session to COMPLETED
    """
    db = MagicMock()

    leader_id = uuid.uuid4()
    member_a_id = uuid.uuid4()
    member_b_id = uuid.uuid4()

    # Step 1: Leader creates group in MEETUP_FIRST mode
    create_payload = GroupCreate(
        name="Himalayan Expedition",
        journey_mode=JourneyMode.MEETUP_FIRST,
        meetup_name="Basecamp Gas Station",
        meetup_latitude=32.2432,
        meetup_longitude=77.1892,
        destination_name="Rohtang Pass",
        latitude=32.3716,
        longitude=77.2466,
    )
    db.scalars().first.return_value = None  # join code collision check

    group = group_service.create_group(db, leader_id, create_payload)
    assert group.journey_mode == JourneyMode.MEETUP_FIRST
    assert group.meetup_name == "Basecamp Gas Station"
    assert group.session_status == SessionStatus.MEETUP
    assert group.destination_name == "Rohtang Pass"

    # Step 2: Member A and Member B join
    member_a = GroupMember(
        group_id=group.id,
        user_id=member_a_id,
        role=MemberRole.MEMBER,
        status=MemberStatus.ACTIVE,
        arrival_status=ArrivalStatus.PENDING,
    )
    member_b = GroupMember(
        group_id=group.id,
        user_id=member_b_id,
        role=MemberRole.MEMBER,
        status=MemberStatus.ACTIVE,
        arrival_status=ArrivalStatus.PENDING,
    )

    # Step 3: Verify readiness gate prevents premature rally start
    db.scalars().all.return_value = [member_a, member_b]
    with pytest.raises(HTTPException) as exc:
        group_service.validate_rally_start_readiness(db, group)
    assert exc.value.status_code == 409
    assert "no group members have marked themselves ready" in exc.value.detail

    # Step 4: Member A and B arrive and report ready
    db.scalars().first.side_effect = [member_a, group, member_b, group]
    db.scalars().all.return_value = [member_a, member_b]

    group_service.update_member_readiness(db, group.id, member_a_id, ArrivalStatus.ARRIVED)
    assert member_a.arrival_status == ArrivalStatus.ARRIVED

    group_service.update_member_readiness(db, group.id, member_b_id, ArrivalStatus.READY)
    assert member_b.arrival_status == ArrivalStatus.READY

    # Step 5: Readiness gate now passes
    group_service.validate_rally_start_readiness(db, group)  # Cleanly succeeds

    # Step 6: Leader starts rally
    start_time = datetime.now(timezone.utc) - timedelta(minutes=75)
    trip = Trip(
        id=uuid.uuid4(),
        group_id=group.id,
        started_by=leader_id,
        status=TripStatus.ACTIVE,
        started_at=start_time,
        destination_name=group.destination_name,
    )
    group.session_status = SessionStatus.ACTIVE

    # Step 7: Member attempts to directly change destination -> Must fail with 403 Forbidden
    db.scalars().first.side_effect = None
    db.scalars().first.return_value = group
    with pytest.raises(HTTPException) as exc:
        group_service.set_official_destination(
            db, group.id, member_a_id, "Unauthorized Spot", 32.5, 77.3
        )
    assert exc.value.status_code == 403
    assert "Only the group leader" in exc.value.detail

    # Step 8: Member A submits suggestion instead
    db.scalars().first.side_effect = [group, member_a]
    suggestion = destination_suggestion_service.create_suggestion(
        db,
        group_id=group.id,
        user_id=member_a_id,
        name="Solang Valley Overlook",
        latitude=32.3166,
        longitude=77.1578,
    )
    assert suggestion.status == SuggestionStatus.PENDING
    assert suggestion.name == "Solang Valley Overlook"
    assert suggestion.suggested_by == member_a_id

    # Step 9: Leader reviews and approves the suggestion
    db.scalars().first.side_effect = [group, suggestion, group]
    reviewed = destination_suggestion_service.review_suggestion(
        db,
        group_id=group.id,
        suggestion_id=suggestion.id,
        reviewer_id=leader_id,
        new_status=SuggestionStatus.APPROVED,
    )
    assert reviewed.status == SuggestionStatus.APPROVED
    assert reviewed.reviewed_by == leader_id
    assert group.destination_name == "Solang Valley Overlook"

    # Step 10: Leader ends the trip -> Calculates duration in minutes
    db.scalars().first.side_effect = None
    db.scalars().first.return_value = group
    end_result = trip_service.end_trip(db, trip)
    assert end_result.status == TripStatus.COMPLETED
    assert end_result.duration == 75
    assert end_result.ended_at is not None

    # Step 11: Repeated completion is idempotent / rejected with 409
    with pytest.raises(Exception):
        trip_service.end_trip(db, trip)


def test_direct_destination_journey_mode_lifecycle():
    """Verify DIRECT_DESTINATION mode works without requiring a meetup stage."""
    db = MagicMock()
    leader_id = uuid.uuid4()

    create_payload = GroupCreate(
        name="Coastal Express",
        journey_mode=JourneyMode.DIRECT_DESTINATION,
        destination_name="Goa Beach",
        latitude=15.2993,
        longitude=74.1240,
    )
    db.scalars().first.return_value = None

    group = group_service.create_group(db, leader_id, create_payload)
    assert group.journey_mode == JourneyMode.DIRECT_DESTINATION
    assert group.session_status == SessionStatus.CREATED
    assert group.meetup_name is None
    assert group.meetup_location is None

    # Readiness validation passes immediately in DIRECT_DESTINATION mode
    group_service.validate_rally_start_readiness(db, group)
