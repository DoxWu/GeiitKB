"""
创建超级管理员账号脚本

作用：
    在部署后创建系统超级管理员账号。
    支持两种使用方式：
    1. 命令行参数（适合 CI/CD 和 Railway 部署）
    2. 环境变量（适合 Railway 一次性初始化）
    3. 交互式输入（适合本地开发）

使用方式：

    方式 1：命令行参数
        python -m scripts.create_superuser --username admin --email admin@example.com --password "Secure123"

    方式 2：环境变量（Railway 部署推荐）
        SUPERUSER_USERNAME=admin
        SUPERUSER_EMAIL=admin@example.com
        SUPERUSER_PASSWORD=Secure123
        python -m scripts.create_superuser

    方式 3：交互式输入
        python -m scripts.create_superuser
        （脚本会提示输入用户名、邮箱、密码）

    方式 4：幂等模式（已存在则升级为管理员，不修改密码）
        python -m scripts.create_superuser --username admin --email admin@example.com --password "Secure123" --upgrade-only

注意：
    - 此脚本应在数据库迁移（alembic upgrade head）之后运行
    - Railway 部署时可通过 Settings → Command 手动执行一次
    - 密码需满足复杂度要求（≥8 字符，包含字母和数字）
"""

import argparse
import getpass
import os
import re
import sys
import logging

# 配置日志
logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

# 密码复杂度正则（与 schemas/user.py 保持一致）
_PASSWORD_LETTER = re.compile(r"[a-zA-Z]")
_PASSWORD_DIGIT = re.compile(r"[0-9]")
_USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$")


def validate_password(password: str) -> None:
    """
    校验密码复杂度

    作用：
        确保密码满足安全要求，与注册接口的校验规则一致。

    参数：
        password: str - 明文密码

    异常：
        ValueError - 密码不满足复杂度要求
    """
    if len(password) < 8:
        raise ValueError("密码长度必须 ≥8 字符")
    if len(password) > 100:
        raise ValueError("密码长度必须 ≤100 字符")
    if not _PASSWORD_LETTER.search(password):
        raise ValueError("密码必须包含至少一个字母")
    if not _PASSWORD_DIGIT.search(password):
        raise ValueError("密码必须包含至少一个数字")


def validate_username(username: str) -> None:
    """
    校验用户名格式

    作用：
        确保用户名只包含合法字符，与注册接口的校验规则一致。

    参数：
        username: str - 用户名

    异常：
        ValueError - 用户名不合法
    """
    if len(username) < 3 or len(username) > 50:
        raise ValueError("用户名长度必须 3-50 字符")
    if not _USERNAME_PATTERN.match(username):
        raise ValueError("用户名只能包含字母、数字、下划线、横线和中文")


def validate_email(email: str) -> None:
    """
    校验邮箱格式（基础校验）

    作用：
        确保邮箱格式基本正确。

    参数：
        email: str - 邮箱地址

    异常：
        ValueError - 邮箱格式不合法
    """
    if not email or "@" not in email or "." not in email.split("@")[-1]:
        raise ValueError("邮箱格式不合法")


def create_or_upgrade_superuser(
    username: str,
    email: str,
    password: str,
    upgrade_only: bool = False,
) -> None:
    """
    创建超级管理员或升级现有用户为超级管理员

    作用：
        - 如果用户名不存在：创建新用户并设为超级管理员
        - 如果用户名已存在且 upgrade_only=True：仅升级为超级管理员（不修改密码）
        - 如果用户名已存在且 upgrade_only=False：升级为超级管理员并更新密码

    参数：
        username: str - 管理员用户名
        email: str - 管理员邮箱
        password: str - 管理员密码（明文，会加密存储）
        upgrade_only: bool - 仅升级已有用户，不创建新用户

    异常：
        Exception - 数据库操作失败
    """
    # 延迟导入，确保脚本可以独立运行
    from app.core.database import SessionLocal
    from app.core.security import hash_password
    from app.models.user import User

    db = SessionLocal()
    try:
        # 查找是否已存在同名用户
        existing_user = db.query(User).filter(User.username == username).first()

        if existing_user:
            # 用户已存在 — 升级为超级管理员
            if not existing_user.is_superuser:
                existing_user.is_superuser = True
                db.commit()
                logger.info(f"✅ 用户 '{username}' 已升级为超级管理员")
            else:
                logger.info(f"ℹ️ 用户 '{username}' 已经是超级管理员，无需修改")

            # 非 upgrade_only 模式下，同步更新邮箱和密码
            if not upgrade_only:
                existing_user.email = email
                existing_user.hashed_password = hash_password(password)
                db.commit()
                logger.info(f"✅ 已更新用户 '{username}' 的邮箱和密码")
        else:
            # 用户不存在 — 检查邮箱是否被占用
            existing_email = db.query(User).filter(User.email == email).first()
            if existing_email:
                raise ValueError(
                    f"邮箱 '{email}' 已被其他用户占用，"
                    f"请使用该邮箱对应的用户名 '{existing_email.username}' 重新运行，"
                    f"或更换邮箱地址"
                )

            # 创建新用户
            new_user = User(
                username=username,
                email=email,
                hashed_password=hash_password(password),
                is_active=True,
                is_superuser=True,
            )
            db.add(new_user)
            db.commit()
            db.refresh(new_user)
            logger.info(f"✅ 超级管理员创建成功！")
            logger.info(f"   用户名: {new_user.username}")
            logger.info(f"   邮箱: {new_user.email}")
            logger.info(f"   ID: {new_user.id}")
            logger.info(f"   状态: {'活跃' if new_user.is_active else '禁用'}")
            logger.info(f"   角色: {'超级管理员' if new_user.is_superuser else '普通用户'}")

    except Exception as e:
        db.rollback()
        logger.error(f"❌ 操作失败: {e}")
        raise
    finally:
        db.close()


def main() -> None:
    """
    主函数：解析参数并创建超级管理员

    作用：
        按优先级获取管理员信息：命令行参数 > 环境变量 > 交互式输入
        然后调用 create_or_upgrade_superuser 执行创建/升级操作
    """
    parser = argparse.ArgumentParser(
        description="创建 GeiIt 企业知识库超级管理员账号",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
使用示例：
  # 命令行参数模式
  python -m scripts.create_superuser --username admin --email admin@example.com --password "Secure123"

  # 环境变量模式（Railway 部署推荐）
  SUPERUSER_USERNAME=admin SUPERUSER_EMAIL=admin@example.com SUPERUSER_PASSWORD=Secure123 python -m scripts.create_superuser

  # 交互式模式
  python -m scripts.create_superuser

  # 仅升级已有用户（不创建新用户，不修改密码）
  python -m scripts.create_superuser --username admin --email admin@example.com --password "Secure123" --upgrade-only
        """,
    )
    parser.add_argument("--username", help="管理员用户名（3-50字符）", default=None)
    parser.add_argument("--email", help="管理员邮箱", default=None)
    parser.add_argument("--password", help="管理员密码（≥8字符，含字母和数字）", default=None)
    parser.add_argument(
        "--upgrade-only",
        action="store_true",
        help="仅升级已有用户为管理员，不创建新用户，不修改密码",
    )

    args = parser.parse_args()

    # 获取管理员信息：命令行参数 > 环境变量 > 交互式输入
    username = args.username or os.environ.get("SUPERUSER_USERNAME")
    email = args.email or os.environ.get("SUPERUSER_EMAIL")
    password = args.password or os.environ.get("SUPERUSER_PASSWORD")

    # 交互式补充缺失的信息
    if not username:
        username = input("请输入管理员用户名（3-50字符）: ").strip()
    if not email:
        email = input("请输入管理员邮箱: ").strip()
    if not password:
        password = getpass.getpass("请输入管理员密码（≥8字符，含字母和数字）: ")
        confirm = getpass.getpass("请再次输入密码确认: ")
        if password != confirm:
            logger.error("❌ 两次输入的密码不一致")
            sys.exit(1)

    # 参数校验
    try:
        validate_username(username)
        validate_email(email)
        validate_password(password)
    except ValueError as e:
        logger.error(f"❌ 参数校验失败: {e}")
        sys.exit(1)

    # 执行创建/升级
    logger.info("=" * 50)
    logger.info("  GeiIt 企业知识库 — 超级管理员创建工具")
    logger.info("=" * 50)

    try:
        create_or_upgrade_superuser(
            username=username,
            email=email,
            password=password,
            upgrade_only=args.upgrade_only,
        )
        logger.info("=" * 50)
        logger.info("🎉 完成！请妥善保管管理员凭证。")
        logger.info("=" * 50)
    except Exception:
        logger.error("❌ 超级管理员创建失败，请检查错误信息后重试")
        sys.exit(1)


if __name__ == "__main__":
    main()
