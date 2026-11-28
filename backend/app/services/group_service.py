import secrets
import uuid
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models.enums import GroupStatus, MemberRole, MemberStatus, JourneyMode, SessionStatus, ArrivalStatus
from app.models.group import Group
from app.models.group_member import GroupMember
from app.models.profile import Profile
from app.notifications import service as notification_service
from app.schemas.group import GroupCreate, GroupMemberResponse
from app.services.profile_service import get_or_create_profile


def generate_join_code() -> str:
    """Generate a unique, human-readable join code."""
    # Format: RALLY-XXXXX (alphanumeric uppercase, excluding confusing chars)
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    suffix = "".join(secrets.choice(alphabet) for _ in range(5))
    return f"RALLY-{suffix}"


def create_group(db: Session, user_id: uuid.UUID, group_data: GroupCreate) -> Group:
    """Create a new group and make the creator the leader.

    Handles journey mode and initializes session status.
    """
    get_or_create_profile(db, str(user_id))

    # 1. Generate unique join code
    join_code = generate_join_code()
    while db.scalars(select(Group).where(Group.join_code == join_code)).first():
        join_code = generate_join_code()

    # 2. Build destination point if lat/lng provided (initial destination optional)
    destination = None
    if group_data.latitude is not None and group_data.longitude is not None:
        destination = f"POINT({group_data.longitude} {group_data.latitude})"

    meetup_name = getattr(group_data, "meetup_name", None)
    meetup_location = None
    meetup_lat = getattr(group_data, "meetup_latitude", None)
    meetup_lng = getattr(group_data, "meetup_longitude", None)
    if meetup_lat is not None and meetup_lng is not None:
        meetup_location = f"POINT({meetup_lng} {meetup_lat})"

    # 3. Create the Group with journey mode and session status defaults
    initial_session_status = SessionStatus.CREATED
    if group_data.journey_mode == JourneyMode.MEETUP_FIRST and (meetup_name or meetup_location):
        initial_session_status = SessionStatus.MEETUP

    group = Group(
        name=group_data.name,
        join_code=join_code,
        leader_id=user_id,
        destination_name=group_data.destination_name,
        destination=destination,
        meetup_name=meetup_name,
        meetup_location=meetup_location,
        status=GroupStatus.ACTIVE,
        journey_mode=group_data.journey_mode,
        session_status=initial_session_status,
    )
    db.add(group)
    db.flush()  # To obtain group.id

    # 4. Create Leader Membership
    member = GroupMember(
        group_id=group.id,
        user_id=user_id,
        role=MemberRole.LEADER,
        status=MemberStatus.ACTIVE,
    )
    db.add(member)
    db.commit()
    db.refresh(group)
    return group


def join_group(db: Session, user_id: uuid.UUID, join_code: str) -> Group:
    """Join an active group using its join code.

    Reject joins to groups whose session is COMPLETED or ARCHIVED.
    """
    get_or_create_profile(db, str(user_id))
    join_code = join_code.strip().upper()

    group = db.scalars(select(Group).where(Group.join_code == join_code)).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found or invalid join code.")

    # Reject non‑active groups or completed/archived sessions
    if group.status != GroupStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot join a non‑active group.")
    if group.session_status in (SessionStatus.COMPLETED, SessionStatus.ARCHIVED):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot join a completed or archived session.")

    # Check existing membership
    existing_member = db.scalars(
        select(GroupMember).where(GroupMember.group_id == group.id, GroupMember.user_id == user_id)
    ).first()

    if existing_member:
        if existing_member.status == MemberStatus.ACTIVE:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already an active member of this group.")
        elif existing_member.status == MemberStatus.REMOVED:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot join this group.")
        elif existing_member.status == MemberStatus.LEFT:
            # Rejoin logic – demote to member just in case they were a leader previously
            existing_member.status = MemberStatus.ACTIVE
            existing_member.role = MemberRole.MEMBER
            db.commit()
            db.refresh(group)
            _notify_member_joined(db, group, user_id)
            return group

    # Create new membership
    new_member = GroupMember(
        group_id=group.id,
        user_id=user_id,
        role=MemberRole.MEMBER,
        status=MemberStatus.ACTIVE,
    )
    db.add(new_member)
    db.commit()
    db.refresh(group)
    _notify_member_joined(db, group, user_id)
    return group


def _notify_member_joined(db: Session, group: Group, new_member_id: uuid.UUID) -> None:
    """Notify all other active members that a new member has joined the group."""
    notification_service.notify_group_safely(
        db,
        group_id=group.id,
        type="MEMBER_JOINED",
        title="Member joined",
        message="A new member has joined the group.",
        severity="INFO",
        exclude_user_id=new_member_id,
    )


def get_group(db: Session, group_id: uuid.UUID) -> Optional[Group]:
    return db.scalars(select(Group).where(Group.id == group_id)).first()


def get_group_members_with_profiles(db: Session, group_id: uuid.UUID):
    """Retrieve all active members with their profiles, including arrival status."""
    stmt = (
        select(GroupMember, Profile)
        .outerjoin(Profile, GroupMember.user_id == Profile.id)
        .where(GroupMember.group_id == group_id, GroupMember.status == MemberStatus.ACTIVE)
    )
    results = db.execute(stmt).all()

    members_data = []
    for member, profile in results:
        members_data.append({
            "user_id": member.user_id,
            "name": (profile.full_name if profile and profile.full_name else None) or "Member",
            "avatar_url": profile.avatar_url if profile else None,
            "role": member.role,
            "status": member.status,
            "joined_at": member.joined_at,
            "arrival_status": member.arrival_status,
        })
    return [GroupMemberResponse(**m) for m in members_data]


def list_user_groups(db: Session, user_id: uuid.UUID):
    """List all groups where the user is an active member."""
    stmt = (
        select(Group, GroupMember)
        .join(GroupMember, Group.id == GroupMember.group_id)
        .where(GroupMember.user_id == user_id, GroupMember.status == MemberStatus.ACTIVE)
        .order_by(Group.created_at.desc())
    )
    results = db.execute(stmt).all()

    groups_data = []
    for group, member in results:
        groups_data.append({
            "id": group.id,
            "name": group.name,
            "role": member.role,
            "status": group.status,
        })
    return groups_data


def leave_group(db: Session, group_id: uuid.UUID, user_id: uuid.UUID):
    """Allow a user to leave a group.

    Leaders cannot leave without transferring leadership first.
    """
    member = db.scalars(
        select(GroupMember).where(GroupMember.group_id == group_id, GroupMember.user_id == user_id)
    ).first()

    if not member or member.status != MemberStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active membership not found.")

    if member.role == MemberRole.LEADER:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Leader cannot leave without transferring leadership first.")

    member.status = MemberStatus.LEFT
    db.commit()
    notification_service.notify_group_safely(
        db,
        group_id=group_id,
        type="MEMBER_LEFT",
        title="Member left",
        message="A member has left the group.",
        severity="INFO",
        exclude_user_id=user_id,
    )


def remove_member(db: Session, group_id: uuid.UUID, target_user_id: uuid.UUID, leader_id: uuid.UUID):
    """Remove a member from a group. Only the leader may invoke this."""
    if target_user_id == leader_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Leader cannot remove themselves.")

    target_member = db.scalars(
        select(GroupMember).where(GroupMember.group_id == group_id, GroupMember.user_id == target_user_id)
    ).first()

    if not target_member or target_member.status != MemberStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target active membership not found.")

    target_member.status = MemberStatus.REMOVED
    db.commit()


def transfer_leadership(db: Session, group_id: uuid.UUID, current_leader_id: uuid.UUID, new_leader_id: uuid.UUID):
    """Transfer group leadership to another active member."""
    if current_leader_id == new_leader_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already the leader.")

    group = get_group(db, group_id)
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found.")

    current_leader_membership = db.scalars(
        select(GroupMember).where(GroupMember.group_id == group_id, GroupMember.user_id == current_leader_id)
    ).first()

    new_leader_membership = db.scalars(
        select(GroupMember).where(GroupMember.group_id == group_id, GroupMember.user_id == new_leader_id)
    ).first()

    if not new_leader_membership or new_leader_membership.status != MemberStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New leader must be an active member of the group.")

    # Perform transfer in one transaction
    current_leader_membership.role = MemberRole.MEMBER
    new_leader_membership.role = MemberRole.LEADER
    group.leader_id = new_leader_id
    db.commit()

# ----------------------------------------------------------------------
# New session‑lifecycle helper functions
# ----------------------------------------------------------------------

def set_official_destination(db: Session, group_id: uuid.UUID, user_id: uuid.UUID, name: str, latitude: float, longitude: float) -> Group:
    """Leader updates the official destination (for both journey modes).

    Validates that the group is not completed/archived and that the caller is the leader.
    NOTE: This function no longer commits; the caller must commit the transaction.
    """
    group = db.scalars(select(Group).where(Group.id == group_id)).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found.")
    if group.session_status in (SessionStatus.COMPLETED, SessionStatus.ARCHIVED):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot modify a completed or archived session.")
    if group.leader_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the group leader can set the destination.")

    # Validate coordinates
    if not (-90 <= latitude <= 90) or not (-180 <= longitude <= 180):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid latitude or longitude values.")

    group.destination_name = name
    group.destination = f"POINT({longitude} {latitude})"
    db.commit()
    db.refresh(group)
    return group


def set_meetup_location(
    db: Session,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
    *args,
    **kwargs,
) -> Group:
    """Leader sets the meetup location (MEETUP_FIRST mode only).
    Supports signatures:
      (db, group_id, user_id, latitude, longitude)
      (db, group_id, user_id, meetup_name, latitude, longitude)
    """
    group = db.scalars(select(Group).where(Group.id == group_id)).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found.")
    if group.session_status in (SessionStatus.COMPLETED, SessionStatus.ARCHIVED):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot modify a completed or archived session.")
    if group.leader_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the group leader can set the meetup location.")
    group.journey_mode = JourneyMode.MEETUP_FIRST

    meetup_name = kwargs.get("meetup_name")
    latitude = kwargs.get("latitude")
    longitude = kwargs.get("longitude")

    if len(args) == 2:
        latitude, longitude = args[0], args[1]
    elif len(args) >= 3:
        if isinstance(args[0], str):
            meetup_name, latitude, longitude = args[0], args[1], args[2]
        else:
            latitude, longitude, meetup_name = args[0], args[1], args[2]

    if latitude is None or longitude is None or not (-90 <= latitude <= 90) or not (-180 <= longitude <= 180):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid latitude or longitude values.")

    if meetup_name is not None:
        group.meetup_name = meetup_name
    group.meetup_location = f"POINT({longitude} {latitude})"
    if group.session_status == SessionStatus.CREATED:
        group.session_status = SessionStatus.MEETUP

    db.commit()
    db.refresh(group)
    return group


def update_arrival_status(db: Session, group_id: uuid.UUID, user_id: uuid.UUID, status: ArrivalStatus) -> GroupMember:
    """Member updates their own arrival status (MEETUP_FIRST mode only)."""
    group = db.scalars(select(Group).where(Group.id == group_id)).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found.")
    if group.session_status in (SessionStatus.COMPLETED, SessionStatus.ARCHIVED):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot update arrival status for a completed or archived session.")
    if group.journey_mode != JourneyMode.MEETUP_FIRST:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Arrival status is only relevant for MEETUP_FIRST journeys.")

    member = db.scalars(
        select(GroupMember).where(GroupMember.group_id == group_id, GroupMember.user_id == user_id)
    ).first()
    if not member or member.status != MemberStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active membership not found.")

    member.arrival_status = status
    db.commit()
    db.refresh(member)
    return member


def update_member_readiness(
    db: Session,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
    arrival_status: ArrivalStatus,
) -> GroupMember:
    """Member updates their own arrival and readiness status for the meetup phase."""
    member = db.scalars(
        select(GroupMember).where(GroupMember.group_id == group_id, GroupMember.user_id == user_id)
    ).first()
    if not member or member.status != MemberStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active membership not found.")

    member.arrival_status = arrival_status

    group = db.scalars(select(Group).where(Group.id == group_id)).first()
    if group and getattr(group, "journey_mode", None) == JourneyMode.MEETUP_FIRST and getattr(group, "session_status", None) == SessionStatus.MEETUP:
        members = db.scalars(
            select(GroupMember).where(
                GroupMember.group_id == group_id,
                GroupMember.status == MemberStatus.ACTIVE,
            )
        ).all()
        if members and all(m.arrival_status in (ArrivalStatus.ARRIVED, ArrivalStatus.READY) for m in members):
            group.session_status = SessionStatus.READY

    db.commit()
    db.refresh(member)
    return member


def get_group_readiness(db: Session, group_id: uuid.UUID) -> dict:
    """Get group meetup readiness statistics."""
    group = db.scalars(select(Group).where(Group.id == group_id)).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found.")
    members = db.scalars(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.status == MemberStatus.ACTIVE,
        )
    ).all()
    total = len(members)
    ready = sum(1 for m in members if m.arrival_status in (ArrivalStatus.ARRIVED, ArrivalStatus.READY))
    return {
        "group_id": group_id,
        "journey_mode": group.journey_mode,
        "session_status": group.session_status,
        "total_members": total,
        "ready_members": ready,
        "is_ready_to_start": ready > 0 and (group.journey_mode == JourneyMode.DIRECT_DESTINATION or ready == total),
    }


def validate_rally_start_readiness(db: Session, group: Group) -> None:
    """Validate that the group is eligible to transition from meetup to active rally."""
    if group.journey_mode == JourneyMode.MEETUP_FIRST:
        if not group.meetup_location and not getattr(group, "meetup_name", None):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot start rally in MEETUP_FIRST mode without a configured meetup point.",
            )
        members = db.scalars(
            select(GroupMember).where(
                GroupMember.group_id == group.id,
                GroupMember.status == MemberStatus.ACTIVE,
            )
        ).all()
        if not members or not any(m.arrival_status in (ArrivalStatus.ARRIVED, ArrivalStatus.READY) for m in members):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot start rally in MEETUP_FIRST mode: no group members have marked themselves ready.",
            )


def transition_session_status(db: Session, group_id: uuid.UUID, user_id: uuid.UUID, new_status: SessionStatus) -> Group:
    """Leader drives the session lifecycle.

    Enforces the allowed transitions defined in the specification.
    """
    group = db.scalars(select(Group).where(Group.id == group_id)).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found.")
    if group.leader_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the group leader can change session status.")
    if group.session_status in (SessionStatus.COMPLETED, SessionStatus.ARCHIVED):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session is already completed or archived.")

    current = group.session_status
    # Define allowed transitions
    allowed = {
        SessionStatus.CREATED: {SessionStatus.MEETUP, SessionStatus.READY},
        SessionStatus.MEETUP: {SessionStatus.READY},
        SessionStatus.READY: {SessionStatus.ACTIVE},
        SessionStatus.ACTIVE: {SessionStatus.PAUSED, SessionStatus.COMPLETED},
        SessionStatus.PAUSED: {SessionStatus.ACTIVE, SessionStatus.COMPLETED},
    }
    # Verify transition is permitted
    if new_status not in allowed.get(current, set()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid transition from {current.value} to {new_status.value}.",
        )

    # Additional validation per transition
    if current == SessionStatus.CREATED:
        if new_status == SessionStatus.MEETUP:
            if group.journey_mode != JourneyMode.MEETUP_FIRST:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="MEETUP transition only valid for MEETUP_FIRST journeys.")
        elif new_status == SessionStatus.READY:
            if group.journey_mode != JourneyMode.DIRECT_DESTINATION:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="READY transition from CREATED is only allowed for DIRECT_DESTINATION journeys.")
            if not group.destination:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Destination must be set before moving to READY.")
    if current == SessionStatus.MEETUP and new_status == SessionStatus.READY:
        # Leader explicitly confirms readiness; optionally ensure at least one arrival
        any_arrived = db.scalars(
            select(GroupMember)
            .where(
                GroupMember.group_id == group_id,
                GroupMember.arrival_status == ArrivalStatus.ARRIVED,
                GroupMember.status == MemberStatus.ACTIVE,
            )
        ).first()
        if not any_arrived:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one member must have ARRIVED before moving to READY.")
    # No extra checks for other transitions

    group.session_status = new_status
    db.commit()
    db.refresh(group)
    return group
