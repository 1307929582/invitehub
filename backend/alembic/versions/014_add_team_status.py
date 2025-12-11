"""Add team status field for ban detection and migration

Revision ID: 014_add_team_status
Revises: 013_normalize_enum_casing
Create Date: 2025-12-11

This migration adds:
- TeamStatus enum (active, banned, token_invalid, paused)
- status column to teams table
- status_message column for storing status change reason
- status_changed_at column for tracking when status changed

The is_active field is preserved for backwards compatibility.
Teams with is_active=False will be migrated to status='paused'.
"""
from alembic import op
import sqlalchemy as sa
from datetime import datetime


revision = '014_add_team_status'
down_revision = '013_normalize_enum_casing'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == 'postgresql':
        # PostgreSQL: Create enum type first
        op.execute("CREATE TYPE teamstatus AS ENUM('active', 'banned', 'token_invalid', 'paused')")

        # Add columns
        op.add_column('teams', sa.Column('status', sa.Enum('active', 'banned', 'token_invalid', 'paused', name='teamstatus'),
                                          nullable=True, server_default='active'))
        op.add_column('teams', sa.Column('status_message', sa.String(255), nullable=True))
        op.add_column('teams', sa.Column('status_changed_at', sa.DateTime, nullable=True))

        # Migrate existing data: is_active=False -> status='paused'
        op.execute("UPDATE teams SET status = 'paused' WHERE is_active = false")
        op.execute("UPDATE teams SET status = 'active' WHERE is_active = true OR is_active IS NULL")

        # Make status NOT NULL after migration
        op.alter_column('teams', 'status', nullable=False)

        # Create index
        op.create_index('ix_teams_status', 'teams', ['status'])

    else:
        # SQLite: Use VARCHAR for enum
        op.add_column('teams', sa.Column('status', sa.String(20), nullable=True, server_default='active'))
        op.add_column('teams', sa.Column('status_message', sa.String(255), nullable=True))
        op.add_column('teams', sa.Column('status_changed_at', sa.DateTime, nullable=True))

        # Migrate existing data
        op.execute("UPDATE teams SET status = 'paused' WHERE is_active = 0")
        op.execute("UPDATE teams SET status = 'active' WHERE is_active = 1 OR is_active IS NULL")

        # SQLite doesn't support ALTER COLUMN, so we leave it nullable
        # The application layer will handle the default

        # Create index
        op.create_index('ix_teams_status', 'teams', ['status'])


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    # Drop index
    op.drop_index('ix_teams_status', table_name='teams')

    # Drop columns
    op.drop_column('teams', 'status_changed_at')
    op.drop_column('teams', 'status_message')
    op.drop_column('teams', 'status')

    if dialect == 'postgresql':
        # Drop enum type
        op.execute("DROP TYPE IF EXISTS teamstatus")
