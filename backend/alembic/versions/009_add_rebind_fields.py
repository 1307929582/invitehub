"""Add rebind tracking fields to redeem_codes

Revision ID: 009_add_rebind_fields
Revises: 008_add_composite_indexes
Create Date: 2025-12-07

This migration adds fields to support user rebind (team switching) functionality
with limits and status tracking for automatic expiry cleanup.

New fields added to redeem_codes table:
- rebind_count: Number of times user has switched teams (default: 0)
- rebind_limit: Maximum allowed team switches (default: 3)
- status: User status for lifecycle management (bound/removing/removed)
- removed_at: Timestamp when user was removed from team after expiry

All fields are nullable with safe defaults to ensure zero-risk production deployment.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '009_add_rebind_fields'
down_revision = '008_add_composite_indexes'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add rebind tracking fields to redeem_codes table
    # All fields nullable=True for backward compatibility

    # rebind_count: Track number of team switches (default: 0)
    op.add_column('redeem_codes',
        sa.Column('rebind_count', sa.Integer(), nullable=True, server_default='0')
    )

    # rebind_limit: Maximum allowed switches (default: 3)
    op.add_column('redeem_codes',
        sa.Column('rebind_limit', sa.Integer(), nullable=True, server_default='3')
    )

    # status: Lifecycle state for automatic cleanup
    # Values: 'bound' (active user), 'removing' (cleanup in progress), 'removed' (cleanup complete)
    op.add_column('redeem_codes',
        sa.Column('status', sa.String(length=20), nullable=True, server_default='bound')
    )

    # removed_at: Timestamp when user was removed after expiry
    op.add_column('redeem_codes',
        sa.Column('removed_at', sa.DateTime(), nullable=True)
    )

    # Create index on status for efficient cleanup queries
    op.create_index('ix_redeem_codes_status', 'redeem_codes', ['status'])


def downgrade() -> None:
    # Remove index first
    op.drop_index('ix_redeem_codes_status', 'redeem_codes')

    # Drop columns in reverse order
    op.drop_column('redeem_codes', 'removed_at')
    op.drop_column('redeem_codes', 'status')
    op.drop_column('redeem_codes', 'rebind_limit')
    op.drop_column('redeem_codes', 'rebind_count')
