"""user_settings: User safety thresholds and preferences persistence

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-30

Adds the `user_settings` table linked one-to-one to profiles.id.
Persists safety alert sensitivity, separation and route deviation thresholds,
notification delivery preferences, audio preferences, and appearance units.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_settings",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("alert_sensitivity", sa.String(length=20), nullable=False, server_default="MEDIUM"),
        sa.Column("separation_threshold_m", sa.Float(), nullable=False, server_default="150.0"),
        sa.Column("route_deviation_threshold_m", sa.Float(), nullable=False, server_default="100.0"),
        sa.Column("notifications_alerts", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("notifications_sos", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("notifications_connectivity", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("notifications_trip_summaries", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("sound_alerts_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("location_sharing", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("theme", sa.String(length=20), nullable=False, server_default="dark"),
        sa.Column("units", sa.String(length=20), nullable=False, server_default="Metric"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["profiles.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_user_settings_user_id", "user_settings", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_user_settings_user_id", table_name="user_settings")
    op.drop_table("user_settings")
