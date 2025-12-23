"""add plan stock fields for LinuxDo

Revision ID: 022_add_plan_stock_fields
Revises: 021_expand_ip_address_length
Create Date: 2025-12-23

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '022_add_plan_stock_fields'
down_revision = '021_expand_ip_address_length'
branch_labels = None
depends_on = None


def upgrade():
    # Plans 表：增加库存相关字段
    op.add_column('plans', sa.Column('stock', sa.Integer(), nullable=True))
    op.add_column('plans', sa.Column('sold_count', sa.Integer(), nullable=True, server_default='0'))


def downgrade():
    op.drop_column('plans', 'sold_count')
    op.drop_column('plans', 'stock')
