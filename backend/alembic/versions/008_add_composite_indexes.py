"""Add composite indexes for complex queries

Revision ID: 008_add_composite_indexes
Revises: 007_add_performance_indexes
Create Date: 2025-12-07

This migration adds composite (multi-column) indexes to optimize
the most frequently executed complex queries in high-concurrency scenarios.

Composite indexes added:
1. invite_records(team_id, status, created_at):
   - Optimizes SeatCalculator's pending invite count query
   - Used in get_team_available_seats() for 24h window filtering

2. team_members(team_id, email):
   - Optimizes member email deduplication in SeatCalculator
   - Covers both team filtering and email lookups

3. invite_queue(status, group_id, created_at):
   - Optimizes worker task polling with group filtering
   - Enables efficient FIFO processing with group awareness
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '008_add_composite_indexes'
down_revision = '007_add_performance_indexes'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Composite index for SeatCalculator pending invite queries
    # Covers: WHERE team_id = ? AND status = ? AND created_at >= ?
    op.create_index(
        'ix_invite_records_team_status_created',
        'invite_records',
        ['team_id', 'status', 'created_at']
    )

    # Composite index for SeatCalculator member email queries
    # Covers: WHERE team_id = ? AND email IN (...)
    op.create_index(
        'ix_team_members_team_email',
        'team_members',
        ['team_id', 'email']
    )

    # Composite index for worker queue polling
    # Covers: WHERE status = 'pending' AND (group_id = ? OR group_id IS NULL)
    op.create_index(
        'ix_invite_queue_status_group_created',
        'invite_queue',
        ['status', 'group_id', 'created_at']
    )


def downgrade() -> None:
    op.drop_index('ix_invite_queue_status_group_created', 'invite_queue')
    op.drop_index('ix_team_members_team_email', 'team_members')
    op.drop_index('ix_invite_records_team_status_created', 'invite_records')
