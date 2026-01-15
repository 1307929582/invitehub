"""add invite consumed_at and queue is_rebind

Revision ID: 024_add_invite_consumed_and_queue_rebind
Revises: 023_add_team_mailbox_fields
Create Date: 2026-01-15

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '024_add_invite_consumed_and_queue_rebind'
down_revision = '023_add_team_mailbox_fields'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('invite_records', sa.Column('consumed_at', sa.DateTime(), nullable=True))
    op.add_column('invite_queue', sa.Column('is_rebind', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('invite_queue', sa.Column('old_team_id', sa.Integer(), nullable=True))
    op.add_column('invite_queue', sa.Column('old_team_chatgpt_user_id', sa.String(length=100), nullable=True))
    op.add_column('invite_queue', sa.Column('consume_immediately', sa.Boolean(), nullable=False, server_default=sa.text('true')))
    op.alter_column('invite_queue', 'is_rebind', server_default=None)
    op.alter_column('invite_queue', 'consume_immediately', server_default=None)


def downgrade():
    op.drop_column('invite_queue', 'old_team_chatgpt_user_id')
    op.drop_column('invite_queue', 'old_team_id')
    op.drop_column('invite_queue', 'is_rebind')
    op.drop_column('invite_queue', 'consume_immediately')
    op.drop_column('invite_records', 'consumed_at')
