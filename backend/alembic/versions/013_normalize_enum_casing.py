"""Normalize enum casing to lowercase

Revision ID: 013_normalize_enum_casing
Revises: 012_distributor_signup_flow
Create Date: 2025-12-08

This migration normalizes all PostgreSQL enum values to lowercase
to match SQLAlchemy's values_callable behavior.

Affected enums:
- userrole: ADMIN -> admin, OPERATOR -> operator, VIEWER -> viewer
  (distributor already lowercase from migration 011)
- invitestatus: PENDING -> pending, SUCCESS -> success, FAILED -> failed
- redeemcodetype: LINUXDO -> linuxdo, DIRECT -> direct
- invitequeuestatus: PENDING -> pending, PROCESSING -> processing,
                     SUCCESS -> success, FAILED -> failed

IMPORTANT: This migration converts existing data in-place.
"""
from alembic import op
import sqlalchemy as sa


revision = '013_normalize_enum_casing'
down_revision = '012_distributor_signup_flow'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != 'postgresql':
        return

    # 1. Normalize userrole enum
    # Note: 'distributor' is already lowercase from migration 011
    op.execute("ALTER TYPE userrole RENAME TO userrole_old")
    op.execute("CREATE TYPE userrole AS ENUM('admin', 'operator', 'viewer', 'distributor')")
    op.execute(
        "ALTER TABLE users ALTER COLUMN role TYPE userrole "
        "USING lower(role::text)::userrole"
    )
    op.execute("DROP TYPE userrole_old")

    # 2. Normalize invitestatus enum
    op.execute("ALTER TYPE invitestatus RENAME TO invitestatus_old")
    op.execute("CREATE TYPE invitestatus AS ENUM('pending', 'success', 'failed')")
    op.execute(
        "ALTER TABLE invite_records ALTER COLUMN status TYPE invitestatus "
        "USING lower(status::text)::invitestatus"
    )
    op.execute("DROP TYPE invitestatus_old")

    # 3. Normalize redeemcodetype enum
    op.execute("ALTER TYPE redeemcodetype RENAME TO redeemcodetype_old")
    op.execute("CREATE TYPE redeemcodetype AS ENUM('linuxdo', 'direct')")
    op.execute(
        "ALTER TABLE redeem_codes ALTER COLUMN code_type TYPE redeemcodetype "
        "USING lower(code_type::text)::redeemcodetype"
    )
    op.execute("DROP TYPE redeemcodetype_old")

    # 4. Normalize invitequeuestatus enum (if table exists)
    inspector = sa.inspect(bind)
    if inspector.has_table('invite_queue'):
        op.execute("ALTER TYPE invitequeuestatus RENAME TO invitequeuestatus_old")
        op.execute("CREATE TYPE invitequeuestatus AS ENUM('pending', 'processing', 'success', 'failed')")
        op.execute(
            "ALTER TABLE invite_queue ALTER COLUMN status TYPE invitequeuestatus "
            "USING lower(status::text)::invitequeuestatus"
        )
        op.execute("DROP TYPE invitequeuestatus_old")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != 'postgresql':
        return

    # Reverse: convert back to uppercase (except distributor which stays lowercase)

    # 1. userrole
    op.execute("ALTER TYPE userrole RENAME TO userrole_lower")
    op.execute("CREATE TYPE userrole AS ENUM('ADMIN', 'OPERATOR', 'VIEWER', 'distributor')")
    op.execute(
        "ALTER TABLE users ALTER COLUMN role TYPE userrole "
        "USING CASE "
        "    WHEN role::text = 'distributor' THEN 'distributor'::userrole "
        "    ELSE upper(role::text)::userrole "
        "END"
    )
    op.execute("DROP TYPE userrole_lower")

    # 2. invitestatus
    op.execute("ALTER TYPE invitestatus RENAME TO invitestatus_lower")
    op.execute("CREATE TYPE invitestatus AS ENUM('PENDING', 'SUCCESS', 'FAILED')")
    op.execute(
        "ALTER TABLE invite_records ALTER COLUMN status TYPE invitestatus "
        "USING upper(status::text)::invitestatus"
    )
    op.execute("DROP TYPE invitestatus_lower")

    # 3. redeemcodetype
    op.execute("ALTER TYPE redeemcodetype RENAME TO redeemcodetype_lower")
    op.execute("CREATE TYPE redeemcodetype AS ENUM('LINUXDO', 'DIRECT')")
    op.execute(
        "ALTER TABLE redeem_codes ALTER COLUMN code_type TYPE redeemcodetype "
        "USING upper(code_type::text)::redeemcodetype"
    )
    op.execute("DROP TYPE redeemcodetype_lower")

    # 4. invitequeuestatus
    inspector = sa.inspect(bind)
    if inspector.has_table('invite_queue'):
        op.execute("ALTER TYPE invitequeuestatus RENAME TO invitequeuestatus_lower")
        op.execute("CREATE TYPE invitequeuestatus AS ENUM('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED')")
        op.execute(
            "ALTER TABLE invite_queue ALTER COLUMN status TYPE invitequeuestatus "
            "USING upper(status::text)::invitequeuestatus"
        )
        op.execute("DROP TYPE invitequeuestatus_lower")
