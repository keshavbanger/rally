"""add session fields to group

Revision ID: 45d2685fb58f
Revises: 0008
Create Date: 2026-11-27 17:29:20.699332
"""

from typing import Sequence, Union
import enum

from alembic import op
import sqlalchemy as sa
from geoalchemy2 import Geography

# revision identifiers, used by Alembic.
revision: str = "45d2685fb58f"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# --- Enum definitions matching backend/app/models/enums.py ---
class JourneyMode(enum.Enum):
    MEETUP_FIRST = "MEETUP_FIRST"
    DIRECT_DESTINATION = "DIRECT_DESTINATION"

class SessionStatus(enum.Enum):
    CREATED = "CREATED"
    MEETUP = "MEETUP"
    READY = "READY"
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    ARCHIVED = "ARCHIVED"

class ArrivalStatus(enum.Enum):
    PENDING = "PENDING"
    ARRIVED = "ARRIVED"
    DEPARTED = "DEPARTED"


def upgrade() -> None:
    # Create enum types in PostgreSQL (if they don't exist)
    op.execute("CREATE TYPE journeymode AS ENUM ('MEETUP_FIRST','DIRECT_DESTINATION')")
    op.execute("CREATE TYPE sessionstatus AS ENUM ('CREATED','MEETUP','READY','ACTIVE','PAUSED','COMPLETED','ARCHIVED')")
    op.execute("CREATE TYPE arrivalstatus AS ENUM ('PENDING','ARRIVED','DEPARTED')")

    # Add columns to groups table with defaults where appropriate
    op.add_column(
        "groups",
        sa.Column(
            "journey_mode",
            sa.Enum(JourneyMode, name="journeymode"),
            nullable=False,
            server_default=sa.text("'DIRECT_DESTINATION'"),
        ),
    )
    # Backfill existing rows (in case the DB had no default applied retroactively)
    op.execute("UPDATE groups SET journey_mode='DIRECT_DESTINATION' WHERE journey_mode IS NULL")
    # Remove default expression from column definition to keep explicit defaults in model only
    op.alter_column("groups", "journey_mode", server_default=None)

    op.add_column(
        "groups",
        sa.Column(
            "meetup_location",
            Geography(geometry_type="POINT", srid=4326),
            nullable=True,
        ),
    )
    op.add_column(
        "groups",
        sa.Column(
            "session_status",
            sa.Enum(SessionStatus, name="sessionstatus"),
            nullable=True,
            server_default=sa.text("'CREATED'"),
        ),
    )
    # Backfill default for existing rows (null values are acceptable; default is set for future rows)
    op.alter_column("groups", "session_status", server_default=None)

    # Add columns to group_members table
    op.add_column(
        "group_members",
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "group_members",
        sa.Column(
            "arrival_status",
            sa.Enum(ArrivalStatus, name="arrivalstatus"),
            nullable=False,
            server_default=sa.text("'PENDING'"),
        ),
    )
    # Backfill any existing rows (should be none initially) and then drop default
    op.alter_column("group_members", "arrival_status", server_default=None)


def downgrade() -> None:
    # Drop columns (must drop enum columns before dropping types)
    op.drop_column("group_members", "arrival_status")
    op.drop_column("group_members", "last_seen_at")
    op.drop_column("groups", "session_status")
    op.drop_column("groups", "meetup_location")
    op.drop_column("groups", "journey_mode")

    # Drop enum types
    op.execute("DROP TYPE IF EXISTS arrivalstatus")
    op.execute("DROP TYPE IF EXISTS sessionstatus")
    op.execute("DROP TYPE IF EXISTS journeymode")
