"""新增 documents.visibility 字段（文档权限隔离）

Revision ID: 20260708_0002
Revises: 20260705_0001
Create Date: 2026-07-08

作用：
    为 documents 表新增 visibility 字段，支持文档权限隔离。
    - private: 个人文档库，仅上传者和超级管理员可见/可检索（默认）
    - public:  公共文档库，所有登录用户可见/可检索

    既有文档默认为 private，保持原有"仅上传者可见"的行为，不改变权限语义。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260708_0002"
down_revision: Union[str, None] = "20260705_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    升级：新增 visibility 列并建立索引

    作用：
        1. 新增 documents.visibility 字段，默认 'private'
        2. 为 visibility 建立索引，加速按可见性过滤的检索
        3. 回填既有数据为 private（保证不改变原有权限语义）
    """
    # 新增 visibility 列（默认 private）
    op.add_column(
        "documents",
        sa.Column(
            "visibility",
            sa.String(length=20),
            nullable=False,
            server_default="private",
        ),
    )

    # 建立索引（按可见性过滤是高频查询，如检索时只查 public + 某用户的 private）
    op.create_index(
        "ix_documents_visibility",
        "documents",
        ["visibility"],
    )

    # 复合索引：visibility + is_deleted（公共库检索常用）
    op.create_index(
        "ix_documents_visibility_deleted",
        "documents",
        ["visibility", "is_deleted"],
    )


def downgrade() -> None:
    """
    回滚：移除 visibility 列和索引
    """
    op.drop_index("ix_documents_visibility_deleted", table_name="documents")
    op.drop_index("ix_documents_visibility", table_name="documents")
    op.drop_column("documents", "visibility")
