"""Add critical performance indexes

Revision ID: 007_add_performance_indexes
Revises: 006_add_commercial_fields
Create Date: 2025-12-07

This migration adds single-column indexes to frequently queried fields
to dramatically improve query performance under high concurrency.

Critical indexes added:
- TeamMember.team_id: for SeatCalculator aggregations
- TeamMember.email: for member lookups and deduplication
- InviteRecord.team_id: for team-specific invite queries
- InviteRecord.email: for user status queries
- InviteRecord.status: for pending invite counts
- InviteRecord.created_at: for time-based filtering (24h window)
- InviteQueue.status: for worker task polling
- RedeemCode.bound_email: for user status lookups
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '007_add_performance_indexes'
down_revision = '006_add_commercial_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # TeamMember indexes
    op.create_index('ix_team_members_team_id', 'team_members', ['team_id'])
    op.create_index('ix_team_members_email', 'team_members', ['email'])

    # InviteRecord indexes
    op.create_index('ix_invite_records_team_id', 'invite_records', ['team_id'])
    op.create_index('ix_invite_records_email', 'invite_records', ['email'])
    op.create_index('ix_invite_records_status', 'invite_records', ['status'])
    op.create_index('ix_invite_records_created_at', 'invite_records', ['created_at'])

    # InviteQueue indexes
    op.create_index('ix_invite_queue_status', 'invite_queue', ['status'])

    # RedeemCode indexes
    op.create_index('ix_redeem_codes_bound_email', 'redeem_codes', ['bound_email'])


def downgrade() -> None:
    # Drop RedeemCode indexes
    op.drop_index('ix_redeem_codes_bound_email', 'redeem_codes')

    # Drop InviteQueue indexes
    op.drop_index('ix_invite_queue_status', 'invite_queue')

    # Drop InviteRecord indexes
    op.drop_index('ix_invite_records_created_at', 'invite_records')
    op.drop_index('ix_invite_records_status', 'invite_records')
    op.drop_index('ix_invite_records_email', 'invite_records')
    op.drop_index('ix_invite_records_team_id', 'invite_records')

    # Drop TeamMember indexes
    op.drop_index('ix_team_members_email', 'team_members')
    op.drop_index('ix_team_members_team_id', 'team_members')
