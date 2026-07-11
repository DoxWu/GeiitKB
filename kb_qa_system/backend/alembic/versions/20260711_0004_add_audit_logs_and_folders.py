"""新增审计日志表、文档库分支表，并为文档表添加 folder_id 列

Revision ID: 20260711_0004
Revises: 20260710_0003
Create Date: 2026-07-11

作用：
    1. 创建 audit_logs 表（操作审计日志，D10-01）
    2. 创建 document_folders 表（文档库分支，D1-01）
    3. 为 documents 表添加 folder_id 列（文档与分支的关联）
    4. 创建必要索引和约束
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260711_0004"
down_revision: Union[str, None] = "20260710_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    升级：创建 audit_logs、document_folders 表，为 documents 添加 folder_id
    """

    # ============================================
    # 1. 创建 audit_logs 表（D10-01 审计日志）
    # ============================================
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column("resource_type", sa.String(50), nullable=False),
        sa.Column("resource_id", sa.Integer(), nullable=True),
        sa.Column("detail", sa.JSON(), nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
    )

    # 单列索引
    op.create_index("ix_audit_logs_id", "audit_logs", ["id"])
    op.create_index("ix_audit_logs_user_id", "audit_logs", ["user_id"])
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"])
    op.create_index("ix_audit_logs_resource_type", "audit_logs", ["resource_type"])
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])

    # 复合索引
    op.create_index("ix_audit_logs_user_created", "audit_logs", ["user_id", "created_at"])
    op.create_index("ix_audit_logs_resource_created", "audit_logs", ["resource_type", "resource_id", "created_at"])

    # ============================================
    # 2. 创建 document_folders 表（D1-01 文档库分支）
    # ============================================
    op.create_table(
        "document_folders",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "name", name="uq_document_folders_user_name"),
    )

    # 单列索引
    op.create_index("ix_document_folders_id", "document_folders", ["id"])
    op.create_index("ix_document_folders_user_id", "document_folders", ["user_id"])

    # ============================================
    # 3. 为 documents 表添加 folder_id 列（D1-01 文档与分支关联）
    # ============================================
    op.add_column(
        "documents",
        sa.Column("folder_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_documents_folder_id",
        "documents",
        "document_folders",
        ["folder_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_documents_folder_id", "documents", ["folder_id"])


def downgrade() -> None:
    """
    降级：移除 documents.folder_id 列，删除 document_folders 和 audit_logs 表
    """
    # 3. 移除 documents 表的 folder_id 列
    op.drop_index("ix_documents_folder_id", table_name="documents")
    op.drop_constraint("fk_documents_folder_id", "documents", type_="foreignkey")
    op.drop_column("documents", "folder_id")

    # 2. 删除 document_folders 表
    op.drop_index("ix_document_folders_user_id", table_name="document_folders")
    op.drop_index("ix_document_folders_id", table_name="document_folders")
    op.drop_table("document_folders")

    # 1. 删除 audit_logs 表
    op.drop_index("ix_audit_logs_resource_created", table_name="audit_logs")
    op.drop_index("ix_audit_logs_user_created", table_name="audit_logs")
    op.drop_index("ix_audit_logs_created_at", table_name="audit_logs")
    op.drop_index("ix_audit_logs_resource_type", table_name="audit_logs")
    op.drop_index("ix_audit_logs_action", table_name="audit_logs")
    op.drop_index("ix_audit_logs_user_id", table_name="audit_logs")
    op.drop_index("ix_audit_logs_id", table_name="audit_logs")
    op.drop_table("audit_logs")
