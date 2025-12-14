"""Add coupons table and order coupon fields

Revision ID: 017_add_coupons
Revises: 016_add_order_email
Create Date: 2025-12-14
"""
from alembic import op
import sqlalchemy as sa


revision = '017_add_coupons'
down_revision = '016_add_order_email'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 创建优惠码表
    op.create_table(
        'coupons',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('code', sa.String(30), nullable=False),
        sa.Column('discount_type', sa.String(20), nullable=False),  # fixed / percentage
        sa.Column('discount_value', sa.Integer(), nullable=False),
        sa.Column('min_amount', sa.Integer(), server_default='0'),
        sa.Column('max_discount', sa.Integer(), nullable=True),
        sa.Column('max_uses', sa.Integer(), server_default='0'),
        sa.Column('used_count', sa.Integer(), server_default='0'),
        sa.Column('valid_from', sa.DateTime(), nullable=True),
        sa.Column('valid_until', sa.DateTime(), nullable=True),
        sa.Column('applicable_plan_ids', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true'),
        sa.Column('note', sa.String(255), nullable=True),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_coupons_id', 'coupons', ['id'])
    op.create_index('ix_coupons_code', 'coupons', ['code'], unique=True)
    op.create_index('ix_coupons_is_active', 'coupons', ['is_active'])

    # Order 表添加优惠码相关字段
    op.add_column('orders', sa.Column('coupon_code', sa.String(30), nullable=True))
    op.add_column('orders', sa.Column('discount_amount', sa.Integer(), server_default='0'))
    op.add_column('orders', sa.Column('final_amount', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('orders', 'final_amount')
    op.drop_column('orders', 'discount_amount')
    op.drop_column('orders', 'coupon_code')

    op.drop_index('ix_coupons_is_active', table_name='coupons')
    op.drop_index('ix_coupons_code', table_name='coupons')
    op.drop_index('ix_coupons_id', table_name='coupons')
    op.drop_table('coupons')
