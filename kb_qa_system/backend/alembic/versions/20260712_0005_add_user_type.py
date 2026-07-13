"""add user_type column to users table (任务5: 临时登录)

Revision ID: 20260712_0005
Revises: 20260711_0004
Create Date: 2026-07-12

作用：
    为 users 表新增 user_type 列，区分正式用户（regular）与临时用户（guest）。
    存量用户全部为正式用户（server_default='regular'），不影响现有数据。
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260712_0005"
down_revision = "20260711_0004"
branch_labels = None
depends_on = None


def upgrade():
    # 新增 user_type 列，默认 'regular'（存量用户全部为正式用户）
    # 作用：guest 用户通过 /auth/guest-login 创建，user_type='guest'
    op.add_column(
        "users",
        sa.Column(
            "user_type",
            sa.String(20),
            nullable=False,
            server_default="regular",
        ),
    )
    op.create_index("ix_users_user_type", "users", ["user_type"])


def downgrade():
    op.drop_index("ix_users_user_type", table_name="users")
    op.drop_column("users", "user_type")
