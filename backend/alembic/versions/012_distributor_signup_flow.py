"""Add distributor signup flow with approval and email verification

Revision ID: 012_distributor_signup_flow
Revises: 011_add_distributor_role
Create Date: 2025-12-08

This migration adds:
1. User approval status (pending/approved/rejected) with rejection_reason
2. VerificationCode table for email verification
3. Default distributor group "分销商默认组"
4. System config for distributor_default_group_id

IMPORTANT for production:
- All existing users will have approval_status='approved' (backward compatible)
- New distributors will start with 'pending' status
- Verification codes are hashed (SHA-256) for security
- Default group is created if not exists (idempotent)
"""
from alembic import op
import sqlalchemy as sa
from datetime import datetime


# revision identifiers, used by Alembic.
revision = '012_distributor_signup_flow'
down_revision = '011_add_distributor_role'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # Step 1: Create UserApprovalStatus enum (use raw SQL for IF NOT EXISTS)
    if bind.dialect.name == 'postgresql':
        bind.execute(sa.text(
            "DO $$ BEGIN "
            "CREATE TYPE userapprovalstatus AS ENUM ('pending', 'approved', 'rejected'); "
            "EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
        ))

    # Step 2: Add approval columns to users table
    # Check if column already exists (for partial migration recovery)
    result = bind.execute(sa.text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = 'users' AND column_name = 'approval_status'"
    )).fetchone()

    if not result:
        bind.execute(sa.text(
            "ALTER TABLE users ADD COLUMN approval_status userapprovalstatus NOT NULL DEFAULT 'approved'"
        ))
        bind.execute(sa.text(
            "ALTER TABLE users ALTER COLUMN approval_status DROP DEFAULT"
        ))

    # Check if rejection_reason column exists
    result = bind.execute(sa.text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = 'users' AND column_name = 'rejection_reason'"
    )).fetchone()

    if not result:
        bind.execute(sa.text(
            "ALTER TABLE users ADD COLUMN rejection_reason VARCHAR(255)"
        ))

    # Step 3: Create VerificationPurpose enum (use raw SQL for IF NOT EXISTS)
    if bind.dialect.name == 'postgresql':
        bind.execute(sa.text(
            "DO $$ BEGIN "
            "CREATE TYPE verificationpurpose AS ENUM ('distributor_signup'); "
            "EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
        ))

    # Step 4: Create verification_codes table using raw SQL
    table_exists = bind.execute(sa.text(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_name = 'verification_codes'"
    )).fetchone()

    if not table_exists:
        bind.execute(sa.text("""
            CREATE TABLE verification_codes (
                id SERIAL PRIMARY KEY,
                email VARCHAR(100) NOT NULL,
                code_hash VARCHAR(128) NOT NULL,
                purpose verificationpurpose NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                verified BOOLEAN NOT NULL DEFAULT FALSE,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # Create indexes for efficient queries
        bind.execute(sa.text("CREATE INDEX ix_verification_codes_email ON verification_codes (email)"))
        bind.execute(sa.text("CREATE INDEX ix_verification_codes_purpose ON verification_codes (purpose)"))
        bind.execute(sa.text("CREATE INDEX ix_verification_codes_expires_at ON verification_codes (expires_at)"))

    # Step 5: Create default distributor group (idempotent)
    conn = op.get_bind()

    # Check if group already exists
    result = conn.execute(
        sa.text("SELECT id FROM team_groups WHERE name = :name"),
        {"name": "分销商默认组"}
    ).fetchone()

    if result:
        group_id = result[0]
    else:
        # Create the group
        result = conn.execute(
            sa.text(
                "INSERT INTO team_groups (name, description, color, created_at) "
                "VALUES (:name, :desc, :color, :created_at) RETURNING id"
            ),
            {
                "name": "分销商默认组",
                "desc": "分销商自动创建兑换码的默认分组",
                "color": "#722ed1",  # Purple color
                "created_at": datetime.utcnow(),
            },
        )
        group_id = result.scalar()

    # Step 6: Store group ID in system_configs
    # Check if config already exists
    config_exists = conn.execute(
        sa.text("SELECT id FROM system_configs WHERE key = :key"),
        {"key": "distributor_default_group_id"}
    ).fetchone()

    if config_exists:
        # Update existing config
        conn.execute(
            sa.text("UPDATE system_configs SET value = :value, updated_at = :updated_at WHERE key = :key"),
            {"value": str(group_id), "key": "distributor_default_group_id", "updated_at": datetime.utcnow()}
        )
    else:
        # Create new config
        conn.execute(
            sa.text(
                "INSERT INTO system_configs (key, value, description, updated_at) "
                "VALUES (:key, :value, :description, :updated_at)"
            ),
            {
                "key": "distributor_default_group_id",
                "value": str(group_id),
                "description": "分销商默认分组 ID",
                "updated_at": datetime.utcnow(),
            },
        )


def downgrade() -> None:
    bind = op.get_bind()

    # Drop verification_codes table and indexes
    op.drop_index('ix_verification_codes_expires_at', table_name='verification_codes')
    op.drop_index('ix_verification_codes_purpose', table_name='verification_codes')
    op.drop_index('ix_verification_codes_email', table_name='verification_codes')
    op.drop_table('verification_codes')

    # Drop enum types
    if bind.dialect.name == 'postgresql':
        sa.Enum(name='verificationpurpose').drop(bind, checkfirst=False)

    # Drop user approval columns
    op.drop_column('users', 'rejection_reason')
    op.drop_column('users', 'approval_status')

    if bind.dialect.name == 'postgresql':
        sa.Enum(name='userapprovalstatus').drop(bind, checkfirst=False)

    # Note: We don't delete the distributor group or system_configs
    # to preserve data integrity. Admins can manually delete if needed.
