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

    # Step 1: Create UserApprovalStatus enum
    if bind.dialect.name == 'postgresql':
        user_status_enum = sa.Enum('pending', 'approved', 'rejected', name='userapprovalstatus')
        user_status_enum.create(bind, checkfirst=True)

    # Step 2: Add approval columns to users table
    # Use server_default to set existing users to 'approved'
    op.add_column(
        'users',
        sa.Column(
            'approval_status',
            sa.Enum('pending', 'approved', 'rejected', name='userapprovalstatus')
                if bind.dialect.name == 'postgresql' else sa.String(20),
            nullable=False,
            server_default='approved',  # All existing users are auto-approved
        ),
    )
    op.add_column('users', sa.Column('rejection_reason', sa.String(length=255), nullable=True))

    # Remove server_default after applying to existing rows
    # New users will use application-level default
    op.alter_column('users', 'approval_status', server_default=None)

    # Step 3: Create VerificationPurpose enum
    if bind.dialect.name == 'postgresql':
        verification_purpose_enum = sa.Enum('distributor_signup', name='verificationpurpose')
        verification_purpose_enum.create(bind, checkfirst=True)

    # Step 4: Create verification_codes table
    op.create_table(
        'verification_codes',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('email', sa.String(length=100), nullable=False),
        sa.Column('code_hash', sa.String(length=128), nullable=False),
        sa.Column('purpose',
                  sa.Enum('distributor_signup', name='verificationpurpose')
                      if bind.dialect.name == 'postgresql' else sa.String(20),
                  nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('verified', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('attempt_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), nullable=False,
                  server_default=sa.text('CURRENT_TIMESTAMP')),
    )

    # Create indexes for efficient queries
    op.create_index('ix_verification_codes_email', 'verification_codes', ['email'])
    op.create_index('ix_verification_codes_purpose', 'verification_codes', ['purpose'])
    op.create_index('ix_verification_codes_expires_at', 'verification_codes', ['expires_at'])

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
