"""Add plans and orders tables for commercial features

Revision ID: 015_add_plans_and_orders
Revises: 014_add_team_status
Create Date: 2025-12-14

This migration adds:
- plans table for storing subscription plans
- orders table for tracking purchases
- OrderStatus enum (pending, paid, expired, refunded)
"""
from alembic import op
import sqlalchemy as sa
from datetime import datetime


revision = '015_add_plans_and_orders'
down_revision = '014_add_team_status'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    # 创建 OrderStatus 枚举类型（PostgreSQL，仅当不存在时）
    if dialect == 'postgresql':
        op.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'orderstatus') THEN
                    CREATE TYPE orderstatus AS ENUM ('pending', 'paid', 'expired', 'refunded');
                END IF;
            END$$;
        """)

    # 创建 plans 表
    op.create_table(
        'plans',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('price', sa.Integer(), nullable=False),  # 价格（分）
        sa.Column('original_price', sa.Integer(), nullable=True),  # 原价（分）
        sa.Column('validity_days', sa.Integer(), nullable=False),
        sa.Column('description', sa.String(255), nullable=True),
        sa.Column('features', sa.Text(), nullable=True),  # JSON 格式
        sa.Column('is_active', sa.Boolean(), default=True, nullable=False),
        sa.Column('is_recommended', sa.Boolean(), default=False, nullable=False),
        sa.Column('sort_order', sa.Integer(), default=0, nullable=False),
        sa.Column('created_at', sa.DateTime(), default=datetime.utcnow, nullable=False),
        sa.Column('updated_at', sa.DateTime(), default=datetime.utcnow, nullable=False),
    )
    op.create_index('ix_plans_id', 'plans', ['id'])
    op.create_index('ix_plans_is_active', 'plans', ['is_active'])

    # 创建 orders 表
    if dialect == 'postgresql':
        status_type = sa.Enum('pending', 'paid', 'expired', 'refunded', name='orderstatus', create_type=False)
    else:
        status_type = sa.String(20)

    op.create_table(
        'orders',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('order_no', sa.String(32), unique=True, nullable=False),
        sa.Column('plan_id', sa.Integer(), sa.ForeignKey('plans.id'), nullable=False),
        sa.Column('amount', sa.Integer(), nullable=False),  # 金额（分）
        sa.Column('status', status_type, default='pending', nullable=False),
        sa.Column('redeem_code', sa.String(50), nullable=True),
        sa.Column('trade_no', sa.String(64), nullable=True),
        sa.Column('pay_type', sa.String(20), nullable=True),
        sa.Column('paid_at', sa.DateTime(), nullable=True),
        sa.Column('expire_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), default=datetime.utcnow, nullable=False),
    )
    op.create_index('ix_orders_id', 'orders', ['id'])
    op.create_index('ix_orders_order_no', 'orders', ['order_no'], unique=True)
    op.create_index('ix_orders_status', 'orders', ['status'])
    op.create_index('ix_orders_redeem_code', 'orders', ['redeem_code'])
    op.create_index('ix_orders_created_at', 'orders', ['created_at'])


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    # 删除 orders 表
    op.drop_index('ix_orders_created_at', table_name='orders')
    op.drop_index('ix_orders_redeem_code', table_name='orders')
    op.drop_index('ix_orders_status', table_name='orders')
    op.drop_index('ix_orders_order_no', table_name='orders')
    op.drop_index('ix_orders_id', table_name='orders')
    op.drop_table('orders')

    # 删除 plans 表
    op.drop_index('ix_plans_is_active', table_name='plans')
    op.drop_index('ix_plans_id', table_name='plans')
    op.drop_table('plans')

    # 删除枚举类型
    if dialect == 'postgresql':
        op.execute("DROP TYPE IF EXISTS orderstatus")
