"""Add RESERVED value to InviteStatus enum

Revision ID: 020
Revises: 019
Create Date: 2024-12-21

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = '020'
down_revision = '019'
branch_labels = None
depends_on = None


def upgrade():
    # Add 'reserved' value to invitestatus enum in PostgreSQL
    # This is needed for the seat pre-reservation feature (P0-1)
    op.execute("ALTER TYPE invitestatus ADD VALUE IF NOT EXISTS 'reserved'")


def downgrade():
    # PostgreSQL doesn't support removing enum values directly
    # This would require recreating the type and all dependent columns
    # For safety, we leave the enum value in place
    pass
