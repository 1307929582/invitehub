"""expand ip_address length to 255

Revision ID: 021
Revises: 020
Create Date: 2025-12-21
"""
from alembic import op
import sqlalchemy as sa

revision = '021'
down_revision = '020'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        'operation_logs',
        'ip_address',
        existing_type=sa.String(50),
        type_=sa.String(255),
        existing_nullable=True
    )


def downgrade():
    op.alter_column(
        'operation_logs',
        'ip_address',
        existing_type=sa.String(255),
        type_=sa.String(50),
        existing_nullable=True
    )
