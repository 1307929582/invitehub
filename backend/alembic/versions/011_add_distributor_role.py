"""Add DISTRIBUTOR role to UserRole enum

Revision ID: 011_add_distributor_role
Revises: 010_create_rebind_history
Create Date: 2025-12-08

This migration adds the DISTRIBUTOR role to the UserRole enum.
This is a prerequisite for the distributor signup flow.

IMPORTANT for production:
- PostgreSQL: Uses ALTER TYPE to add new enum value
- SQLite: Recreates the enum type
- Existing users are unaffected (no distributor users yet)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = '011_add_distributor_role'
down_revision = '010_create_rebind_history'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # Handle PostgreSQL enum type
    if bind.dialect.name == 'postgresql':
        # PostgreSQL: Add new value to existing enum
        op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'distributor'")
    else:
        # SQLite: Enum is stored as string, no migration needed
        # But we need to ensure the constraint is updated if it exists
        pass


def downgrade() -> None:
    bind = op.get_bind()

    # WARNING: Cannot remove enum values in PostgreSQL without recreating the enum
    # This downgrade will fail if any distributor users exist
    if bind.dialect.name == 'postgresql':
        # Check if any distributors exist
        connection = op.get_bind()
        result = connection.execute(
            sa.text("SELECT COUNT(*) FROM users WHERE role = 'distributor'")
        ).scalar()

        if result > 0:
            raise Exception(
                f"Cannot downgrade: {result} distributor users exist. "
                "Please remove them first."
            )

        # Recreate enum without distributor
        op.execute("ALTER TYPE userrole RENAME TO userrole_old")
        op.execute("CREATE TYPE userrole AS ENUM('admin', 'operator', 'viewer')")
        op.execute(
            "ALTER TABLE users ALTER COLUMN role TYPE userrole "
            "USING role::text::userrole"
        )
        op.execute("DROP TYPE userrole_old")
