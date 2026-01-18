"""add bulk email jobs and logs

Revision ID: 026_add_bulk_email_jobs_logs
Revises: 025_add_invite_queue_waiting_enum
Create Date: 2026-01-18

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "026_add_bulk_email_jobs_logs"
down_revision = "025_add_invite_queue_waiting_enum"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "bulk_email_jobs",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("job_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("target", sa.String(length=20), nullable=False),
        sa.Column("days", sa.Integer(), nullable=True),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sent", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fail_rate_limit", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fail_reject", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fail_invalid", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fail_other", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_bulk_email_jobs_job_id", "bulk_email_jobs", ["job_id"], unique=True)
    op.create_index("ix_bulk_email_jobs_status", "bulk_email_jobs", ["status"])
    op.create_index("ix_bulk_email_jobs_user_id", "bulk_email_jobs", ["user_id"])

    op.create_table(
        "bulk_email_logs",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("job_id", sa.String(length=64), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("reason_type", sa.String(length=20), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_bulk_email_logs_job_id", "bulk_email_logs", ["job_id"])
    op.create_index("ix_bulk_email_logs_email", "bulk_email_logs", ["email"])


def downgrade():
    op.drop_index("ix_bulk_email_logs_email", table_name="bulk_email_logs")
    op.drop_index("ix_bulk_email_logs_job_id", table_name="bulk_email_logs")
    op.drop_table("bulk_email_logs")

    op.drop_index("ix_bulk_email_jobs_user_id", table_name="bulk_email_jobs")
    op.drop_index("ix_bulk_email_jobs_status", table_name="bulk_email_jobs")
    op.drop_index("ix_bulk_email_jobs_job_id", table_name="bulk_email_jobs")
    op.drop_table("bulk_email_jobs")
