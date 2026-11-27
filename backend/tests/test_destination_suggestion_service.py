import pytest
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi import HTTPException, status

from app.models.enums import SuggestionStatus, MemberStatus, SessionStatus
from app.models.group import Group
from app.models.group_member import GroupMember
from app.models.destination_suggestion import DestinationSuggestion
from app.services.destination_suggestion_service import (
    create_suggestion,
    list_suggestions,
    review_suggestion,
)

# Helper mock that mimics the return value of db.scalars()
class DummyScalars:
    def __init__(self, first=None, all=None):
        self._first = first
        self._all = all

    def first(self):
        return self._first

    def all(self):
        return self._all if self._all is not None else []

# Utility to build a minimal group with a leader member attached
def build_group(session_status=SessionStatus.CREATED):
    leader_id = uuid4()
    group = Group(
        id=uuid4(),
        name="Test Group",
        join_code="RALLY-TEST",
        leader_id=leader_id,
        destination_name=None,
        destination=None,
        status="ACTIVE",
        journey_mode="DIRECT_DESTINATION",
        session_status=session_status,
    )
    # leader membership (not stored in DB – just for permission checks)
    GroupMember(
        id=uuid4(),
        group_id=group.id,
        user_id=leader_id,
        role="LEADER",
        status=MemberStatus.ACTIVE,
    )
    return group, leader_id

# ---------------------------------------------------------------------------
# Creation / listing tests
# ---------------------------------------------------------------------------

def test_create_suggestion_active_member():
    db = MagicMock()
    group, leader = build_group()
    member_id = uuid4()
    # mock _ensure_active_member checks
    db.scalars.side_effect = [DummyScalars(first=group), DummyScalars(first=GroupMember(status=MemberStatus.ACTIVE, user_id=member_id, group_id=group.id))]
    suggestion = create_suggestion(db, group.id, member_id, "Park", 40.0, -73.0)
    assert suggestion.name == "Park"
    assert suggestion.status == SuggestionStatus.PENDING

def test_create_suggestion_non_member():
    db = MagicMock()
    group, _ = build_group()
    # group exists but member lookup returns None
    db.scalars.side_effect = [DummyScalars(first=group), DummyScalars(first=None)]
    with pytest.raises(HTTPException) as exc:
        create_suggestion(db, group.id, uuid4(), "Park", 40.0, -73.0)
    assert exc.value.status_code == status.HTTP_403_FORBIDDEN

def test_create_suggestion_inactive_member():
    db = MagicMock()
    group, _ = build_group()
    inactive_member = GroupMember(status=MemberStatus.LEFT, user_id=uuid4(), group_id=group.id)
    db.scalars.side_effect = [DummyScalars(first=group), DummyScalars(first=inactive_member)]
    with pytest.raises(HTTPException) as exc:
        create_suggestion(db, group.id, inactive_member.user_id, "Park", 40.0, -73.0)
    assert exc.value.status_code == status.HTTP_403_FORBIDDEN

def test_list_suggestions_leader():
    db = MagicMock()
    group, leader = build_group()
    # owner check and list query
    suggestion = DestinationSuggestion(id=uuid4(), group_id=group.id, suggested_by=leader, name="Beach", latitude=10.0, longitude=20.0, status=SuggestionStatus.PENDING)
    db.scalars.side_effect = [
        DummyScalars(first=group),
        DummyScalars(first=GroupMember(status=MemberStatus.ACTIVE, user_id=leader, group_id=group.id)),
        DummyScalars(first=None, all=[suggestion]),
    ]
    results = list_suggestions(db, group.id, leader)
    assert isinstance(results, list)
    assert results[0].name == "Beach"

    db = MagicMock()
    group, leader = build_group()
    # owner check
    db.scalars.side_effect = [
        DummyScalars(first=group),
        DummyScalars(first=GroupMember(status=MemberStatus.ACTIVE, user_id=leader, group_id=group.id)),
        DummyScalars(first=None, all=[DestinationSuggestion(id=uuid4(), group_id=group.id, suggested_by=leader, name="Beach", latitude=10.0, longitude=20.0, status=SuggestionStatus.PENDING)])
    ]
    results = list_suggestions(db, group.id, leader)
    assert isinstance(results, list)
    assert results[0].name == "Beach"

def test_list_suggestions_non_member():
    db = MagicMock()
    group, _ = build_group()
    db.scalars.side_effect = [DummyScalars(first=group), DummyScalars(first=None)]
    with pytest.raises(HTTPException) as exc:
        list_suggestions(db, group.id, uuid4())
    assert exc.value.status_code == status.HTTP_403_FORBIDDEN

# ---------------------------------------------------------------------------
# Review tests – focus on permission, status, session lifecycle
# ---------------------------------------------------------------------------

def _setup_review_mocks(db, group, suggestion, member):
    """Configure db.scalars side effects for a review call.
    Order expected by review_suggestion:
    1. group lookup
    2. suggestion lookup
    """
    db.scalars.side_effect = [DummyScalars(first=group), DummyScalars(first=suggestion)]
    # member check is performed in _ensure_active_member but review_suggestion only checks leader_id, so we don't need extra mock here.

def test_review_approval_by_leader():
    db = MagicMock()
    group, leader = build_group()
    suggestion = DestinationSuggestion(
        id=uuid4(),
        group_id=group.id,
        suggested_by=leader,
        name="Lake",
        latitude=5.0,
        longitude=5.0,
        status=SuggestionStatus.PENDING,
    )
    _setup_review_mocks(db, group, suggestion, None)
    with patch('app.services.destination_suggestion_service.set_official_destination') as mock_set:
        mock_set.return_value = group
        reviewed = review_suggestion(
            db,
            group.id,
            suggestion.id,
            reviewer_id=leader,
            new_status=SuggestionStatus.APPROVED,
        )
    assert reviewed.status == SuggestionStatus.APPROVED
    assert reviewed.reviewed_by == leader
    mock_set.assert_called_once()

def test_approval_updates_destination_fields():
    db = MagicMock()
    group, leader = build_group()
    suggestion = DestinationSuggestion(
        id=uuid4(),
        group_id=group.id,
        suggested_by=leader,
        name="Mountain",
        latitude=45.0,
        longitude=9.0,
        status=SuggestionStatus.PENDING,
    )
    _setup_review_mocks(db, group, suggestion, None)
    def mock_set_official_destination(db_arg, group_id, user_id, name, latitude, longitude):
        # Simulate the real behavior: set destination fields on the group object
        group.destination_name = name
        group.destination = f"POINT({longitude} {latitude})"
        return group
    with patch('app.services.destination_suggestion_service.set_official_destination', side_effect=mock_set_official_destination) as mock_set:
        reviewed = review_suggestion(
            db,
            group.id,
            suggestion.id,
            reviewer_id=leader,
            new_status=SuggestionStatus.APPROVED,
        )
        # After approval the group object should have its destination fields set
        assert group.destination_name == "Mountain"
        assert "POINT(9.0 45.0)" in group.destination
    assert reviewed.status == SuggestionStatus.APPROVED

def test_review_rejection_by_leader_with_reason():
    db = MagicMock()
    group, leader = build_group()
    suggestion = DestinationSuggestion(
        id=uuid4(),
        group_id=group.id,
        suggested_by=leader,
        name="Desert",
        latitude=30.0,
        longitude=30.0,
        status=SuggestionStatus.PENDING,
    )
    _setup_review_mocks(db, group, suggestion, None)
    reviewed = review_suggestion(
        db,
        group.id,
        suggestion.id,
        reviewer_id=leader,
        new_status=SuggestionStatus.REJECTED,
        rejection_reason="Too hot",
    )
    assert reviewed.status == SuggestionStatus.REJECTED
    assert reviewed.rejection_reason == "Too hot"

def test_rejection_missing_reason():
    db = MagicMock()
    group, leader = build_group()
    suggestion = DestinationSuggestion(
        id=uuid4(),
        group_id=group.id,
        suggested_by=leader,
        name="Island",
        latitude=0.0,
        longitude=0.0,
        status=SuggestionStatus.PENDING,
    )
    _setup_review_mocks(db, group, suggestion, None)
    with pytest.raises(HTTPException) as exc:
        review_suggestion(
            db,
            group.id,
            suggestion.id,
            reviewer_id=leader,
            new_status=SuggestionStatus.REJECTED,
            rejection_reason="   ",
        )
    assert exc.value.status_code == status.HTTP_400_BAD_REQUEST

def test_review_non_pending_forbidden():
    db = MagicMock()
    group, leader = build_group()
    suggestion = DestinationSuggestion(
        id=uuid4(),
        group_id=group.id,
        suggested_by=leader,
        name="Hill",
        latitude=1.0,
        longitude=1.0,
        status=SuggestionStatus.APPROVED,
    )
    _setup_review_mocks(db, group, suggestion, None)
    with pytest.raises(HTTPException) as exc:
        review_suggestion(
            db,
            group.id,
            suggestion.id,
            reviewer_id=leader,
            new_status=SuggestionStatus.REJECTED,
            rejection_reason="changed mind",
        )
    assert exc.value.status_code == status.HTTP_400_BAD_REQUEST

def test_invalid_review_status():
    db = MagicMock()
    group, leader = build_group()
    suggestion = DestinationSuggestion(
        id=uuid4(),
        group_id=group.id,
        suggested_by=leader,
        name="Valley",
        latitude=2.0,
        longitude=2.0,
        status=SuggestionStatus.PENDING,
    )
    _setup_review_mocks(db, group, suggestion, None)
    with pytest.raises(HTTPException) as exc:
        review_suggestion(
            db,
            group.id,
            suggestion.id,
            reviewer_id=leader,
            new_status=SuggestionStatus.PENDING,
        )
    assert exc.value.status_code == status.HTTP_400_BAD_REQUEST

def test_review_on_completed_session():
    db = MagicMock()
    group, leader = build_group(session_status=SessionStatus.COMPLETED)
    suggestion = DestinationSuggestion(
        id=uuid4(),
        group_id=group.id,
        suggested_by=leader,
        name="Canyon",
        latitude=3.0,
        longitude=3.0,
        status=SuggestionStatus.PENDING,
    )
    _setup_review_mocks(db, group, suggestion, None)
    with pytest.raises(HTTPException) as exc:
        review_suggestion(
            db,
            group.id,
            suggestion.id,
            reviewer_id=leader,
            new_status=SuggestionStatus.APPROVED,
        )
    assert exc.value.status_code == status.HTTP_400_BAD_REQUEST

def test_review_on_archived_session():
    db = MagicMock()
    group, leader = build_group(session_status=SessionStatus.ARCHIVED)
    suggestion = DestinationSuggestion(
        id=uuid4(),
        group_id=group.id,
        suggested_by=leader,
        name="ArchiveTest",
        latitude=4.0,
        longitude=4.0,
        status=SuggestionStatus.PENDING,
    )
    _setup_review_mocks(db, group, suggestion, None)
    with pytest.raises(HTTPException) as exc:
        review_suggestion(
            db,
            group.id,
            suggestion.id,
            reviewer_id=leader,
            new_status=SuggestionStatus.APPROVED,
        )
    assert exc.value.status_code == status.HTTP_400_BAD_REQUEST

def test_non_leader_cannot_review():
    db = MagicMock()
    group, leader = build_group()
    other_user = uuid4()
    suggestion = DestinationSuggestion(
        id=uuid4(),
        group_id=group.id,
        suggested_by=leader,
        name="Secret",
        latitude=0.0,
        longitude=0.0,
        status=SuggestionStatus.PENDING,
    )
    _setup_review_mocks(db, group, suggestion, None)
    with pytest.raises(HTTPException) as exc:
        review_suggestion(
            db,
            group.id,
            suggestion.id,
            reviewer_id=other_user,
            new_status=SuggestionStatus.APPROVED,
        )
    assert exc.value.status_code == status.HTTP_403_FORBIDDEN

def test_invalid_longitude_rejected_at_creation():
    db = MagicMock()
    group, leader = build_group()
    db.scalars.side_effect = [DummyScalars(first=group), DummyScalars(first=GroupMember(status=MemberStatus.ACTIVE, user_id=leader, group_id=group.id))]
    with pytest.raises(HTTPException) as exc:
        create_suggestion(db, group.id, leader, "BadLon", 10.0, 200.0)
    assert exc.value.status_code == status.HTTP_400_BAD_REQUEST

def test_missing_group_raises_404():
    db = MagicMock()
    db.scalars.return_value = DummyScalars(first=None)
    with pytest.raises(HTTPException) as exc:
        review_suggestion(db, uuid4(), uuid4(), uuid4(), SuggestionStatus.APPROVED)
    assert exc.value.status_code == status.HTTP_404_NOT_FOUND

def test_missing_suggestion_raises_404():
    db = MagicMock()
    group, leader = build_group()
    db.scalars.side_effect = [DummyScalars(first=group), DummyScalars(first=None)]
    with pytest.raises(HTTPException) as exc:
        review_suggestion(db, group.id, uuid4(), leader, SuggestionStatus.APPROVED)
    assert exc.value.status_code == status.HTTP_404_NOT_FOUND

# ---------------------------------------------------------------------------
# Transaction failure handling – check that rollback is performed on failure
# ---------------------------------------------------------------------------

def test_commit_failure_rollback_on_error():
    db = MagicMock()
    group, leader = build_group()
    suggestion = DestinationSuggestion(
        id=uuid4(),
        group_id=group.id,
        suggested_by=leader,
        name="Fail",
        latitude=1.0,
        longitude=1.0,
        status=SuggestionStatus.PENDING,
    )
    _setup_review_mocks(db, group, suggestion, None)
    # Force the final commit to raise
    db.commit.side_effect = RuntimeError("commit failed")
    with patch('app.services.destination_suggestion_service.set_official_destination') as mock_set:
        mock_set.return_value = group
        with pytest.raises(RuntimeError):
            review_suggestion(
                db,
                group.id,
                suggestion.id,
                reviewer_id=leader,
                new_status=SuggestionStatus.APPROVED,
            )
    # The service should call db.rollback() on failure
    assert db.rollback.called, "Service should roll back on commit failure"

class DummyScalars:
    def __init__(self, first=None, all=None):
        self._first = first
        self._all = all

    def first(self):
        return self._first

    def all(self):
        return self._all if self._all is not None else []

# Utility to build a minimal group with a leader member attached
def build_group(session_status=SessionStatus.CREATED):
    leader_id = uuid4()
    group = Group(
        id=uuid4(),
        name="Test Group",
        join_code="RALLY-TEST",
        leader_id=leader_id,
        destination_name=None,
        destination=None,
        status="ACTIVE",
        journey_mode="DIRECT_DESTINATION",
        session_status=session_status,
    )
    # leader membership (not stored in DB – just for permission checks)
    GroupMember(
        id=uuid4(),
        group_id=group.id,
        user_id=leader_id,
        role="LEADER",
        status=MemberStatus.ACTIVE,
    )
    return group, leader_id

# ---------------------------------------------------------------------------
# Creation / listing tests
# ---------------------------------------------------------------------------

def test_create_suggestion_active_member():
    db = MagicMock()
    group, leader = build_group()
    member_id = uuid4()
    # mock _ensure_active_member checks
    db.scalars.return_value = DummyScalars(first=group)  # group lookup
    # member lookup – return an active member
    db.scalars.side_effect = [DummyScalars(first=group), DummyScalars(first=GroupMember(status=MemberStatus.ACTIVE, user_id=member_id, group_id=group.id))]
    suggestion = create_suggestion(db, group.id, member_id, "Park", 40.0, -73.0)
    assert suggestion.name == "Park"
    assert suggestion.status == SuggestionStatus.PENDING

def test_create_suggestion_non_member():
    db = MagicMock()
    group, _ = build_group()
    # group exists but member lookup returns None
    db.scalars.side_effect = [DummyScalars(first=group), DummyScalars(first=None)]
    with pytest.raises(HTTPException) as exc:
        create_suggestion(db, group.id, uuid4(), "Park", 40.0, -73.0)
    assert exc.value.status_code == status.HTTP_403_FORBIDDEN

def test_create_suggestion_inactive_member():
    db = MagicMock()
    group, _ = build_group()
    inactive_member = GroupMember(status=MemberStatus.LEFT, user_id=uuid4(), group_id=group.id)
    db.scalars.side_effect = [DummyScalars(first=group), DummyScalars(first=inactive_member)]
    with pytest.raises(HTTPException) as exc:
        create_suggestion(db, group.id, inactive_member.user_id, "Park", 40.0, -73.0)
    assert exc.value.status_code == status.HTTP_403_FORBIDDEN

def test_list_suggestions_leader():
    db = MagicMock()
    group, leader = build_group()
    # owner check and list query
    suggestion = DestinationSuggestion(id=uuid4(), group_id=group.id, suggested_by=leader, name="Beach", latitude=10.0, longitude=20.0, status=SuggestionStatus.PENDING)
    db.scalars.side_effect = [
        DummyScalars(first=group),
        DummyScalars(first=GroupMember(status=MemberStatus.ACTIVE, user_id=leader, group_id=group.id)),
        DummyScalars(first=None, all=[suggestion]),
    ]
    results = list_suggestions(db, group.id, leader)
    assert isinstance(results, list)
    assert results[0].name == "Beach"



def test_list_suggestions_non_member():
    db = MagicMock()
    group, _ = build_group()
    db.scalars.side_effect = [DummyScalars(first=group), DummyScalars(first=None)]
    with pytest.raises(HTTPException) as exc:
        list_suggestions(db, group.id, uuid4())
    assert exc.value.status_code == status.HTTP_403_FORBIDDEN

# ---------------------------------------------------------------------------
# Review tests – focus on permission, status, session lifecycle
# ---------------------------------------------------------------------------

def _setup_review_mocks(db, group, suggestion, member):
    """Configure db.scalars side effects for a review call.
    Order expected by review_suggestion:
    1. group lookup
    2. suggestion lookup
    """
    db.scalars.side_effect = [DummyScalars(first=group), DummyScalars(first=suggestion)]
    # member check is performed in _ensure_active_member but review_suggestion only checks leader_id, so we don't need extra mock here.

def test_review_approval_by_leader():
    db = MagicMock()
    group, leader = build_group()
    suggestion = DestinationSuggestion(
        id=uuid4(),
        group_id=group.id,
        suggested_by=leader,
        name="Lake",
        latitude=5.0,
        longitude=5.0,
        status=SuggestionStatus.PENDING,
    )
    _setup_review_mocks(db, group, suggestion, None)
    with patch('app.services.destination_suggestion_service.set_official_destination') as mock_set:
        mock_set.return_value = group
        reviewed = review_suggestion(
            db,
            group.id,
            suggestion.id,
            reviewer_id=leader,
            new_status=SuggestionStatus.APPROVED,
        )
    assert reviewed.status == SuggestionStatus.APPROVED
    assert reviewed.reviewed_by == leader
    mock_set.assert_called_once()

def test_approval_updates_destination_fields():
    db = MagicMock()
    group, leader = build_group()
    suggestion = DestinationSuggestion(
        id=uuid4(),
        group_id=group.id,
        suggested_by=leader,
        name="Mountain",
        latitude=45.0,
        longitude=9.0,
        status=SuggestionStatus.PENDING,
    )
    _setup_review_mocks(db, group, suggestion, None)
    with patch('app.services.destination_suggestion_service.set_official_destination') as mock_set:
        mock_set.side_effect = lambda *args, **kwargs: group  # returns the modified group
        reviewed = review_suggestion(
            db,
            group.id,
            suggestion.id,
            reviewer_id=leader,
            new_status=SuggestionStatus.APPROVED,
        )
        # After approval the group object should have its destination fields set
        assert group.destination_name == "Mountain"
        assert "POINT(9.0 45.0)" in group.destination
    assert reviewed.status == SuggestionStatus.APPROVED

def test_review_rejection_by_leader_with_reason():
    db = MagicMock()
    group, leader = build_group()
    suggestion = DestinationSuggestion(
        id=uuid4(),
        group_id=group.id,
        suggested_by=leader,
        name="Desert",
        latitude=30.0,
        longitude=30.0,
        status=SuggestionStatus.PENDING,
    )
    _setup_review_mocks(db, group, suggestion, None)
    reviewed = review_suggestion(
        db,
        group.id,
        suggestion.id,
        reviewer_id=leader,
        new_status=SuggestionStatus.REJECTED,
        rejection_reason="Too hot",
    )
    assert reviewed.status == SuggestionStatus.REJECTED
    assert reviewed.rejection_reason == "Too hot"

def test_rejection_missing_reason():
    db = MagicMock()
    group, leader = build_group()
    suggestion = DestinationSuggestion(
        id=uuid4(),
        group_id=group.id,
        suggested_by=leader,
        name="Island",
        latitude=0.0,
        longitude=0.0,
        status=SuggestionStatus.PENDING,
    )
    _setup_review_mocks(db, group, suggestion, None)
    with pytest.raises(HTTPException) as exc:
        review_suggestion(
            db,
            group.id,
            suggestion.id,
            reviewer_id=leader,
            new_status=SuggestionStatus.REJECTED,
            rejection_reason="   ",
        )
    assert exc.value.status_code == status.HTTP_400_BAD_REQUEST

def test_review_non_pending_forbidden():
    db = MagicMock()
    group, leader = build_group()
    suggestion = DestinationSuggestion(
        id=uuid4(),
        group_id=group.id,
        suggested_by=leader,
        name="Hill",
        latitude=1.0,
        longitude=1.0,
        status=SuggestionStatus.APPROVED,
    )
    _setup_review_mocks(db, group, suggestion, None)
    with pytest.raises(HTTPException) as exc:
        review_suggestion(
            db,
            group.id,
            suggestion.id,
            reviewer_id=leader,
            new_status=SuggestionStatus.REJECTED,
            rejection_reason="changed mind",
        )
    assert exc.value.status_code == status.HTTP_400_BAD_REQUEST

def test_invalid_review_status():
    db = MagicMock()
    group, leader = build_group()
    suggestion = DestinationSuggestion(
        id=uuid4(),
        group_id=group.id,
        suggested_by=leader,
        name="Valley",
        latitude=2.0,
        longitude=2.0,
        status=SuggestionStatus.PENDING,
    )
    _setup_review_mocks(db, group, suggestion, None)
    with pytest.raises(HTTPException) as exc:
        review_suggestion(
            db,
            group.id,
            suggestion.id,
            reviewer_id=leader,
            new_status=SuggestionStatus.PENDING,
        )
    assert exc.value.status_code == status.HTTP_400_BAD_REQUEST

def test_review_on_completed_session():
    db = MagicMock()
    group, leader = build_group(session_status=SessionStatus.COMPLETED)
    suggestion = DestinationSuggestion(
        id=uuid4(),
        group_id=group.id,
        suggested_by=leader,
        name="Canyon",
        latitude=3.0,
        longitude=3.0,
        status=SuggestionStatus.PENDING,
    )
    _setup_review_mocks(db, group, suggestion, None)
    with pytest.raises(HTTPException) as exc:
        review_suggestion(
            db,
            group.id,
            suggestion.id,
            reviewer_id=leader,
            new_status=SuggestionStatus.APPROVED,
        )
    assert exc.value.status_code == status.HTTP_400_BAD_REQUEST

def test_review_on_archived_session():
    db = MagicMock()
    group, leader = build_group(session_status=SessionStatus.ARCHIVED)
    suggestion = DestinationSuggestion(
        id=uuid4(),
        group_id=group.id,
        suggested_by=leader,
        name="ArchiveTest",
        latitude=4.0,
        longitude=4.0,
        status=SuggestionStatus.PENDING,
    )
    _setup_review_mocks(db, group, suggestion, None)
    with pytest.raises(HTTPException) as exc:
        review_suggestion(
            db,
            group.id,
            suggestion.id,
            reviewer_id=leader,
            new_status=SuggestionStatus.APPROVED,
        )
    assert exc.value.status_code == status.HTTP_400_BAD_REQUEST

def test_non_leader_cannot_review():
    db = MagicMock()
    group, leader = build_group()
    other_user = uuid4()
    suggestion = DestinationSuggestion(
        id=uuid4(),
        group_id=group.id,
        suggested_by=leader,
        name="Secret",
        latitude=0.0,
        longitude=0.0,
        status=SuggestionStatus.PENDING,
    )
    _setup_review_mocks(db, group, suggestion, None)
    with pytest.raises(HTTPException) as exc:
        review_suggestion(
            db,
            group.id,
            suggestion.id,
            reviewer_id=other_user,
            new_status=SuggestionStatus.APPROVED,
        )
    assert exc.value.status_code == status.HTTP_403_FORBIDDEN

def test_invalid_longitude_rejected_at_creation():
    db = MagicMock()
    group, leader = build_group()
    db.scalars.side_effect = [DummyScalars(first=group), DummyScalars(first=GroupMember(status=MemberStatus.ACTIVE, user_id=leader, group_id=group.id))]
    with pytest.raises(HTTPException) as exc:
        create_suggestion(db, group.id, leader, "BadLon", 10.0, 200.0)
    assert exc.value.status_code == status.HTTP_400_BAD_REQUEST

def test_missing_group_raises_404():
    db = MagicMock()
    db.scalars.return_value = DummyScalars(first=None)
    with pytest.raises(HTTPException) as exc:
        review_suggestion(db, uuid4(), uuid4(), uuid4(), SuggestionStatus.APPROVED)
    assert exc.value.status_code == status.HTTP_404_NOT_FOUND

def test_missing_suggestion_raises_404():
    db = MagicMock()
    group, leader = build_group()
    db.scalars.side_effect = [DummyScalars(first=group), DummyScalars(first=None)]
    with pytest.raises(HTTPException) as exc:
        review_suggestion(db, group.id, uuid4(), leader, SuggestionStatus.APPROVED)
    assert exc.value.status_code == status.HTTP_404_NOT_FOUND

# ---------------------------------------------------------------------------
# Transaction failure handling – check that rollback is *not* performed
# ---------------------------------------------------------------------------

def test_commit_failure_no_automatic_rollback():
    db = MagicMock()
    group, leader = build_group()
    suggestion = DestinationSuggestion(
        id=uuid4(),
        group_id=group.id,
        suggested_by=leader,
        name="Fail",
        latitude=1.0,
        longitude=1.0,
        status=SuggestionStatus.PENDING,
    )
    _setup_review_mocks(db, group, suggestion, None)
    # Force the final commit to raise
    db.commit.side_effect = RuntimeError("commit failed")
    with patch('app.services.destination_suggestion_service.set_official_destination') as mock_set:
        mock_set.return_value = group
        with pytest.raises(RuntimeError):
            review_suggestion(
                db,
                group.id,
                suggestion.id,
                reviewer_id=leader,
                new_status=SuggestionStatus.APPROVED,
            )
    # The service does not call db.rollback(), so this is a production issue.
    assert db.rollback.called, "Service should roll back on commit failure"
