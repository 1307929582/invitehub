"""Create rebind_history table

Revision ID: 010_create_rebind_history
Revises: 009_add_rebind_fields
Create Date: 2025-12-07

This migration creates the rebind_history table to track all team switching
operations for audit and troubleshooting purposes.

The table records:
- Which user (email + redeem code)
- What happened (from_team -> to_team)
- When it happened (created_at)
- Why it happened (reason: user_requested, expired_cleanup, admin_action)
- Additional context (notes)
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '010_create_rebind_history'
down_revision = '009_add_rebind_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create rebind_history table
    op.create_table(
        'rebind_history',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('redeem_code', sa.String(length=50), nullable=False),
        sa.Column('email', sa.String(length=100), nullable=False),
        sa.Column('from_team_id', sa.Integer(), nullable=True),
        sa.Column('to_team_id', sa.Integer(), nullable=True),
        sa.Column('reason', sa.String(length=50), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['from_team_id'], ['teams.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['to_team_id'], ['teams.id'], ondelete='SET NULL'),
    )

    # Create indexes for efficient queries
    op.create_index('ix_rebind_history_redeem_code', 'rebind_history', ['redeem_code'])
    op.create_index('ix_rebind_history_email', 'rebind_history', ['email'])
    op.create_index('ix_rebind_history_created_at', 'rebind_history', ['created_at'])


def downgrade() -> None:
    # Drop indexes first
    op.drop_index('ix_rebind_history_created_at', 'rebind_history')
    op.drop_index('ix_rebind_history_email', 'rebind_history')
    op.drop_index('ix_rebind_history_redeem_code', 'rebind_history')

    # Drop table
    op.drop_table('rebind_history')
