"""drop unique constraint on documents.file_hash (文档重名/重传修复)

Revision ID: 20260715_0006
Revises: 20260712_0005
Create Date: 2026-07-15

作用：
    将 documents.file_hash 的唯一索引降级为普通索引。

背景：
    原实现 file_hash 设为 unique=True（DB 层全局唯一约束），导致两个问题：
    1. 用户上传与现有文档内容相同的文件时被 409 拒绝，无冲突处理选项；
    2. 文档软删除后（is_deleted=True），其 file_hash 仍占用唯一索引，
       用户无法再次上传相同内容的文件，必须手动改名。

    修复方案：
    - 移除 DB 层唯一约束，改为普通索引（保留查询性能）。
    - 文档去重改为应用层校验（仅检查 is_deleted=False 的活跃文档），
      并提供冲突处理机制（自动重命名 / 覆盖 / 保留两者）。
    - 这样软删除的文档不再阻塞重新上传，同时保留对活跃文档的去重能力。

    并发安全：
      原唯一约束作为竞态兜底，移除后由 Redis 分布式锁
      （upload:hash:{file_hash}）保证 check-then-insert 的原子性，
      Redis 失败时 fail-closed（拒绝上传），不存在竞态窗口。
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = "20260715_0006"
down_revision = "20260712_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. 删除原唯一索引
    op.drop_index("ix_documents_file_hash", table_name="documents")
    # 2. 重建为普通索引（保留按 file_hash 查询的性能）
    op.create_index("ix_documents_file_hash", "documents", ["file_hash"], unique=False)


def downgrade() -> None:
    # 回滚：恢复唯一索引（注意：若已存在重复 file_hash 的活跃记录会失败）
    op.drop_index("ix_documents_file_hash", table_name="documents")
    op.create_index("ix_documents_file_hash", "documents", ["file_hash"], unique=True)
