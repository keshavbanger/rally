import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.analytics.dashboard import _calculate_group_health
from app.core.config import settings
from app.core.database import get_db
from app.dependencies.auth import get_current_user_id
from app.dependencies.group import require_group_leader
from app.intelligence.thresholds import current_thresholds
from app.main import app
from app.models.enums import MemberRole, MemberStatus
from app.models.user_setting import UserSetting
from app.notifications import service as notification_service
from app.schemas.analytics import DashboardMember
from app.schemas.user_setting import UserSettingResponse
from tests.conftest import DEFAULT_TEST_USER_ID, make_token

client = TestClient(app)
SETTINGS_URL = f"{settings.API_V1_STR}/settings"


def test_get_settings_requires_auth():
    response = client.get(SETTINGS_URL)
    assert response.status_code == 401


@patch("app.api.settings.settings_service.get_or_create_user_settings")
def test_get_settings_authenticated(mock_get):
    token = make_token(sub=DEFAULT_TEST_USER_ID)
    uid = uuid.UUID(DEFAULT_TEST_USER_ID)
    now = datetime.now(timezone.utc)

    mock_setting = UserSetting(
        user_id=uid,
        alert_sensitivity="HIGH",
        separation_threshold_m=120.0,
        route_deviation_threshold_m=80.0,
        notifications_alerts=True,
        notifications_sos=True,
        notifications_connectivity=False,
        notifications_trip_summaries=True,
        sound_alerts_enabled=True,
        location_sharing=True,
        theme="dark",
        units="Metric",
        created_at=now,
        updated_at=now,
    )
    mock_get.return_value = mock_setting

    app.dependency_overrides[get_db] = lambda: MagicMock()
    try:
        response = client.get(SETTINGS_URL, headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        data = response.json()
        assert data["user_id"] == DEFAULT_TEST_USER_ID
        assert data["alert_sensitivity"] == "HIGH"
        assert data["separation_threshold_m"] == 120.0
        assert data["notifications_connectivity"] is False
    finally:
        app.dependency_overrides.pop(get_db, None)


@patch("app.api.settings.settings_service.update_user_settings")
def test_update_settings_validation_and_persistence(mock_update):
    token = make_token(sub=DEFAULT_TEST_USER_ID)
    uid = uuid.UUID(DEFAULT_TEST_USER_ID)
    now = datetime.now(timezone.utc)

    mock_setting = UserSetting(
        user_id=uid,
        alert_sensitivity="LOW",
        separation_threshold_m=200.0,
        route_deviation_threshold_m=150.0,
        notifications_alerts=True,
        notifications_sos=True,
        notifications_connectivity=True,
        notifications_trip_summaries=False,
        sound_alerts_enabled=True,
        location_sharing=True,
        theme="dark",
        units="Metric",
        created_at=now,
        updated_at=now,
    )
    mock_update.return_value = mock_setting

    app.dependency_overrides[get_db] = lambda: MagicMock()
    try:
        # 1. Valid patch
        patch_payload = {
            "alert_sensitivity": "LOW",
            "separation_threshold_m": 200.0,
        }
        res = client.patch(SETTINGS_URL, headers={"Authorization": f"Bearer {token}"}, json=patch_payload)
        assert res.status_code == 200

        # 2. Invalid threshold bounds (< 20m) should be rejected
        res_invalid = client.patch(
            SETTINGS_URL,
            headers={"Authorization": f"Bearer {token}"},
            json={"separation_threshold_m": 5.0},
        )
        assert res_invalid.status_code == 422
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_thresholds_adaptation_from_user_setting():
    uid = uuid.uuid4()
    now = datetime.now(timezone.utc)

    # High sensitivity setting: tighter factor (0.8), shorter stop duration
    setting_high = UserSetting(
        user_id=uid,
        alert_sensitivity="HIGH",
        separation_threshold_m=100.0,
        route_deviation_threshold_m=50.0,
        created_at=now,
        updated_at=now,
    )
    th_high = current_thresholds(setting_high)
    assert th_high.group_separation_distance_meters == 80.0  # 100 * 0.8
    assert th_high.off_route_threshold_meters == 40.0  # 50 * 0.8
    assert th_high.stop_duration_seconds < 60

    # Low sensitivity setting: wider factor (1.3), longer stop duration
    setting_low = UserSetting(
        user_id=uid,
        alert_sensitivity="LOW",
        separation_threshold_m=100.0,
        route_deviation_threshold_m=50.0,
        created_at=now,
        updated_at=now,
    )
    th_low = current_thresholds(setting_low)
    assert th_low.group_separation_distance_meters == 130.0  # 100 * 1.3
    assert th_low.off_route_threshold_meters == 65.0  # 50 * 1.3
    assert th_low.stop_duration_seconds > 60


def test_group_health_calculation_rules():
    # 1. Insufficient data: 0 members
    gh_empty = _calculate_group_health(
        member_count=0,
        members=[],
        online_count=None,
        active_alerts_count=0,
        critical_alerts_count=0,
        active_sos_count=0,
        risk_level="LOW",
        route_available=False,
    )
    assert gh_empty.status_label == "INSUFFICIENT_DATA"
    assert gh_empty.health_score is None

    # 2. Optimal group: all members together, online, on route, 0 alerts
    members = [
        DashboardMember(
            user_id=uuid.uuid4(),
            name="Alice",
            movement_state="MOVING",
            route_state="ON_ROUTE",
            progress_percent=50.0,
            distance_from_group_center_meters=20.0,
        ),
        DashboardMember(
            user_id=uuid.uuid4(),
            name="Bob",
            movement_state="MOVING",
            route_state="ON_ROUTE",
            progress_percent=50.0,
            distance_from_group_center_meters=35.0,
        ),
    ]
    gh_optimal = _calculate_group_health(
        member_count=2,
        members=members,
        online_count=2,
        active_alerts_count=0,
        critical_alerts_count=0,
        active_sos_count=0,
        risk_level="LOW",
        route_available=True,
    )
    assert gh_optimal.status_label == "OPTIMAL"
    assert gh_optimal.health_score >= 85
    assert gh_optimal.togetherness_percent == 100.0
    assert gh_optimal.on_route_percent == 100.0
    assert gh_optimal.connectivity_percent == 100.0

    # 3. Degraded with active SOS: must immediately drop to RISK status
    gh_risk = _calculate_group_health(
        member_count=2,
        members=members,
        online_count=2,
        active_alerts_count=1,
        critical_alerts_count=1,
        active_sos_count=1,
        risk_level="CRITICAL",
        route_available=True,
    )
    assert gh_risk.status_label == "RISK"
    assert gh_risk.stability_percent < 50.0


@patch("app.api.groups.group_service.transfer_leadership")
def test_transfer_leadership_endpoint(mock_transfer):
    token = make_token(sub=DEFAULT_TEST_USER_ID)
    group_id = uuid.uuid4()
    new_leader_id = uuid.uuid4()

    fake_leader = MagicMock()
    fake_leader.user_id = uuid.UUID(DEFAULT_TEST_USER_ID)
    fake_leader.role = MemberRole.LEADER

    app.dependency_overrides[require_group_leader] = lambda: fake_leader
    app.dependency_overrides[get_db] = lambda: MagicMock()

    try:
        res = client.post(
            f"{settings.API_V1_STR}/groups/{group_id}/transfer-leadership",
            headers={"Authorization": f"Bearer {token}"},
            json={"new_leader_id": str(new_leader_id)},
        )
        assert res.status_code == 204
        mock_transfer.assert_called_once()
    finally:
        app.dependency_overrides.pop(require_group_leader, None)
        app.dependency_overrides.pop(get_db, None)


def test_notification_preference_suppression():
    db = MagicMock()
    user_id = uuid.uuid4()

    # User has disabled connectivity notifications
    mock_setting = MagicMock()
    mock_setting.notifications_alerts = True
    mock_setting.notifications_sos = True
    mock_setting.notifications_connectivity = False
    mock_setting.notifications_trip_summaries = False
    db.scalar.return_value = mock_setting

    res = notification_service.notify(
        db,
        user_id=user_id,
        type="MEMBER_DISCONNECTED",
        title="Member Offline",
        message="Member disconnected.",
        severity="INFO",
    )
    # Must be suppressed (return None) because notifications_connectivity is False
    assert res is None
