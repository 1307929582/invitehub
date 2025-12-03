"""Add commercial fields to redeem_codes and invite_records

Revision ID: 006_add_commercial_fields
Revises: 005_add_is_unauthorized_to_team_members
Create Date: 2025-12-03

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '006_add_commercial_fields'
down_revision = '005_add_is_unauthorized_to_team_members'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new fields to redeem_codes table
    op.add_column('redeem_codes', sa.Column('validity_days', sa.Integer(), nullable=True, server_default='30'))
    op.add_column('redeem_codes', sa.Column('activated_at', sa.DateTime(), nullable=True))
    op.add_column('redeem_codes', sa.Column('bound_email', sa.String(100), nullable=True))
    
    # Add is_rebind field to invite_records table
    op.add_column('invite_records', sa.Column('is_rebind', sa.Boolean(), nullable=True, server_default='false'))
    
    # Remove foreign key constraint from linuxdo_user_id in invite_records
    # Note: The column is kept but the FK constraint is removed
    try:
        op.drop_constraint('invite_records_linuxdo_user_id_fkey', 'invite_records', type_='foreignkey')
    except Exception:
        # Constraint may not exist in some databases
        pass


def downgrade() -> None:
    # Re-add foreign key constraint
    op.create_foreign_key(
        'invite_records_linuxdo_user_id_fkey',
        'invite_records',
        'linuxdo_users',
        ['linuxdo_user_id'],
        ['id']
    )
    
    # Remove is_rebind from invite_records
    op.drop_column('invite_records', 'is_rebind')
    
    # Remove new fields from redeem_codes
    op.drop_column('redeem_codes', 'bound_email')
    op.drop_column('redeem_codes', 'activated_at')
    op.drop_column('redeem_codes', 'validity_days')
