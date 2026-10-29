def test_all_models_import_cleanly():
    from app.models import (  # noqa: F401
        Alert,
        Group,
        GroupMember,
        LocationHistory,
        Profile,
        SOSEvent,
        Trip,
    )


def test_expected_tables_are_registered_on_metadata():
    from app.models import Base

    expected = {
        "profiles",
        "groups",
        "group_members",
        "trips",
        "location_history",
        "alerts",
        "sos_events",
    }
    assert expected.issubset(set(Base.metadata.tables.keys()))


def test_group_members_has_unique_group_user_constraint():
    from app.models import Base

    table = Base.metadata.tables["group_members"]
    unique_constraints = [c for c in table.constraints if c.__class__.__name__ == "UniqueConstraint"]
    assert any(
        {col.name for col in uc.columns} == {"group_id", "user_id"} for uc in unique_constraints
    )


def test_join_code_is_unique():
    from app.models import Base

    table = Base.metadata.tables["groups"]
    assert table.columns["join_code"].unique or any(
        {col.name for col in uc.columns} == {"join_code"}
        for uc in table.constraints
        if uc.__class__.__name__ == "UniqueConstraint"
    )


def test_all_eleven_tables_registered_on_metadata():
    from app.models import Base

    expected = {
        "profiles",
        "groups",
        "group_members",
        "trips",
        "location_history",
        "alerts",
        "sos_events",
        "intelligence_events",
        "routes",
        "trip_analytics_snapshots",
        "notifications",
    }
    assert expected.issubset(set(Base.metadata.tables.keys()))


def test_alerts_has_unresolved_partial_unique_index():
    from app.models import Base

    table = Base.metadata.tables["alerts"]
    index_names = {idx.name for idx in table.indexes}
    assert "uq_alerts_one_unresolved_per_event" in index_names

    uq_idx = next(idx for idx in table.indexes if idx.name == "uq_alerts_one_unresolved_per_event")
    assert uq_idx.unique is True
    assert [c.name for c in uq_idx.columns] == ["event_id"]
    assert "resolved_at IS NULL" in str(uq_idx.dialect_options.get("postgresql", {}).get("where", ""))


def test_trips_has_one_active_per_group_partial_unique_index():
    from app.models import Base

    table = Base.metadata.tables["trips"]
    index_names = {idx.name for idx in table.indexes}
    assert "uq_trips_one_active_per_group" in index_names

    uq_idx = next(idx for idx in table.indexes if idx.name == "uq_trips_one_active_per_group")
    assert uq_idx.unique is True
    assert [c.name for c in uq_idx.columns] == ["group_id"]


def test_member_status_enum_values():
    from app.models.enums import MemberStatus

    assert set(MemberStatus.__members__.keys()) == {"ACTIVE", "LEFT", "REMOVED"}


def test_foreign_keys_to_groups():
    from app.models import Base

    for table_name in ("location_history", "intelligence_events", "alerts", "sos_events"):
        table = Base.metadata.tables[table_name]
        fk_targets = {fk.target_fullname for fk in table.foreign_keys}
        assert "groups.id" in fk_targets, f"{table_name} missing foreign key to groups.id"


def test_routes_trip_id_is_unique_and_trips_does_not_require_route():
    from app.models import Base

    routes_table = Base.metadata.tables["routes"]
    trips_table = Base.metadata.tables["trips"]

    # routes.trip_id is unique
    assert routes_table.columns["trip_id"].unique is True

    # trips table has no foreign key to routes (trips can exist without route)
    trip_fk_targets = {fk.target_fullname for fk in trips_table.foreign_keys}
    assert "routes.id" not in trip_fk_targets
