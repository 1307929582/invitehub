"""add removal_retry_count field

Revision ID: 011
Revises: 010
Create Date: 2025-12-15

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '011'
down_revision = '010'
branch_labels = None
depends_on = None


def upgrade():
    # 添加 removal_retry_count 字段
    op.add_column('redeem_codes', sa.Column('removal_retry_count', sa.Integer(), nullable=True, server_default='0'))


def downgrade():
    # 删除 removal_retry_count 字段
    op.drop_column('redeem_codes', 'removal_retry_count')
