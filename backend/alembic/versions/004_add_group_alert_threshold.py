"""add group alert threshold

Revision ID: 004_add_group_alert
Revises: 003_remove_gemini_tables
Create Date: 2025-11-29

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '004_add_group_alert'
down_revision = '003_remove_gemini_tables'
branch_labels = None
depends_on = None


def upgrade():
    # 添加 alert_threshold 字段到 team_groups 表
    op.add_column('team_groups', sa.Column('alert_threshold', sa.Integer(), nullable=True, server_default='5'))


def downgrade():
    op.drop_column('team_groups', 'alert_threshold')
