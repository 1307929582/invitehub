"""add distributor order fields

Revision ID: 019_add_distributor_order_fields
Revises: 018_add_removal_retry_count
Create Date: 2025-12-18

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '019_add_distributor_order_fields'
down_revision = '018_add_removal_retry_count'
branch_labels = None
depends_on = None


def upgrade():
    # Plans 表：增加分销商码包相关字段
    op.add_column('plans', sa.Column('plan_type', sa.String(length=30), nullable=False, server_default='public'))
    op.add_column('plans', sa.Column('code_count', sa.Integer(), nullable=True, server_default='1'))
    op.add_column('plans', sa.Column('code_max_uses', sa.Integer(), nullable=True, server_default='1'))
    op.create_index('ix_plans_plan_type', 'plans', ['plan_type'])

    # Orders 表：增加分销商订单相关字段
    op.add_column('orders', sa.Column('order_type', sa.String(length=30), nullable=False, server_default='public_plan'))
    op.add_column('orders', sa.Column('buyer_user_id', sa.Integer(), nullable=True))
    op.add_column('orders', sa.Column('quantity', sa.Integer(), nullable=True, server_default='1'))
    op.add_column('orders', sa.Column('delivered_count', sa.Integer(), nullable=True, server_default='0'))
    op.add_column('orders', sa.Column('delivered_at', sa.DateTime(), nullable=True))

    op.create_index('ix_orders_order_type', 'orders', ['order_type'])
    op.create_index('ix_orders_buyer_user_id', 'orders', ['buyer_user_id'])
    op.create_foreign_key('fk_orders_buyer_user_id', 'orders', 'users', ['buyer_user_id'], ['id'])


def downgrade():
    op.drop_constraint('fk_orders_buyer_user_id', 'orders', type_='foreignkey')
    op.drop_index('ix_orders_buyer_user_id', table_name='orders')
    op.drop_index('ix_orders_order_type', table_name='orders')
    op.drop_column('orders', 'delivered_at')
    op.drop_column('orders', 'delivered_count')
    op.drop_column('orders', 'quantity')
    op.drop_column('orders', 'buyer_user_id')
    op.drop_column('orders', 'order_type')

    op.drop_index('ix_plans_plan_type', table_name='plans')
    op.drop_column('plans', 'code_max_uses')
    op.drop_column('plans', 'code_count')
    op.drop_column('plans', 'plan_type')
