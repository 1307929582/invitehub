"""add invite queue waiting enum value

Revision ID: 025_add_invite_queue_waiting_enum
Revises: 024_add_invite_consumed_and_queue_rebind
Create Date: 2026-01-16

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = "025_add_invite_queue_waiting_enum"
down_revision = "024_add_invite_consumed_and_queue_rebind"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        op.execute(
            "DO $$ BEGIN "
            "IF NOT EXISTS ("
            "SELECT 1 FROM pg_type t "
            "JOIN pg_enum e ON t.oid = e.enumtypid "
            "WHERE t.typname = 'invitequeuestatus' AND e.enumlabel = 'waiting'"
            ") THEN "
            "ALTER TYPE invitequeuestatus ADD VALUE 'waiting'; "
            "END IF; "
            "END $$;"
        )


def downgrade():
    # Postgres does not support removing enum values easily.
    pass
