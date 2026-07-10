"""新增注册申请表和邮件日志表

Revision ID: 20260710_0003
Revises: 20260708_0002
Create Date: 2026-07-10

作用：
    1. 创建 registration_applications 表（注册申请记录）
    2. 创建 email_logs 表（邮件发送日志）
    3. 创建必要索引（邮箱/状态/复合索引）
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260710_0003"
down_revision: Union[str, None] = "20260708_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    升级：创建 registration_applications 和 email_logs 表
    """

    # ============================================
    # 1. 创建 registration_applications 表
    # ============================================
    op.create_table(
        "registration_applications",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("email", sa.String(100), nullable=False),
        sa.Column("username", sa.String(50), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("password_token_hash", sa.String(64), nullable=True),
        sa.Column("password_token_expires_at", sa.DateTime(), nullable=True),
        sa.Column("password_token_used_at", sa.DateTime(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("reviewed_by", sa.Integer(), nullable=True),
        sa.Column("reject_reason", sa.String(500), nullable=True),
        sa.Column("created_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_user_id"], ["users.id"], ondelete="SET NULL"),
    )

    # 单列索引
    op.create_index("ix_registration_applications_id", "registration_applications", ["id"])
    op.create_index("ix_registration_applications_email", "registration_applications", ["email"])
    op.create_index("ix_registration_applications_status", "registration_applications", ["status"])
    op.create_index("ix_registration_applications_password_token_hash", "registration_applications", ["password_token_hash"], unique=True)

    # 复合索引
    op.create_index("ix_registration_applications_email_submitted", "registration_applications", ["email", "submitted_at"])
    op.create_index("ix_registration_applications_status_submitted", "registration_applications", ["status", "submitted_at"])

    # ============================================
    # 2. 创建 email_logs 表
    # ============================================
    op.create_table(
        "email_logs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("recipient", sa.String(100), nullable=False),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column("email_type", sa.String(50), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("html_body", sa.Text(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("application_id", sa.Integer(), nullable=True),
        sa.Column("celery_task_id", sa.String(255), nullable=True),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["application_id"], ["registration_applications.id"], ondelete="SET NULL"),
    )

    # 单列索引
    op.create_index("ix_email_logs_id", "email_logs", ["id"])
    op.create_index("ix_email_logs_email_type", "email_logs", ["email_type"])
    op.create_index("ix_email_logs_status", "email_logs", ["status"])
    op.create_index("ix_email_logs_application_id", "email_logs", ["application_id"])

    # 复合索引
    op.create_index("ix_email_logs_status_created", "email_logs", ["status", "created_at"])


def downgrade() -> None:
    """
    降级：删除 email_logs 和 registration_applications 表
    """
    op.drop_table("email_logs")
    op.drop_table("registration_applications")
