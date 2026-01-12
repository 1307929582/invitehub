"""add team mailbox fields

Revision ID: 023_add_team_mailbox_fields
Revises: 022_add_plan_stock_fields
Create Date: 2026-01-12

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '023_add_team_mailbox_fields'
down_revision = '022_add_plan_stock_fields'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('teams', sa.Column('mailbox_id', sa.String(length=128), nullable=True))
    op.add_column('teams', sa.Column('mailbox_email', sa.String(length=255), nullable=True))
    op.add_column('teams', sa.Column('mailbox_synced_at', sa.DateTime(), nullable=True))
    op.create_index('ix_teams_mailbox_id', 'teams', ['mailbox_id'])
    op.create_index('ix_teams_mailbox_email', 'teams', ['mailbox_email'])


def downgrade():
    op.drop_index('ix_teams_mailbox_email', table_name='teams')
    op.drop_index('ix_teams_mailbox_id', table_name='teams')
    op.drop_column('teams', 'mailbox_synced_at')
    op.drop_column('teams', 'mailbox_email')
    op.drop_column('teams', 'mailbox_id')
