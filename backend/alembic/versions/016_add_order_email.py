"""Add email field to orders table

Revision ID: 016_add_order_email
Revises: 015_add_plans_and_orders
Create Date: 2025-12-14
"""
from alembic import op
import sqlalchemy as sa


revision = '016_add_order_email'
down_revision = '015_add_plans_and_orders'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 添加 email 字段（允许为空以兼容旧数据）
    op.add_column('orders', sa.Column('email', sa.String(100), nullable=True))

    # 为旧订单设置默认邮箱
    op.execute("UPDATE orders SET email = 'unknown@example.com' WHERE email IS NULL")

    # 修改为不允许为空
    op.alter_column('orders', 'email', nullable=False)

    # 创建索引
    op.create_index('ix_orders_email', 'orders', ['email'])


def downgrade() -> None:
    op.drop_index('ix_orders_email', table_name='orders')
    op.drop_column('orders', 'email')
