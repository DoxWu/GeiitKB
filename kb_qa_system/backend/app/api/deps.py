"""
API 依赖模块

作用：
    定义可复用的依赖项，用于 API 路由的认证和数据获取。
    FastAPI 通过 Depends() 注入这些依赖。

实现方式：
    1. get_current_user: 从 Token 中获取当前用户
    2. get_current_active_user: 确保用户是活跃的
    3. 组合使用：路由中通过 Depends(get_current_user) 保护接口
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from typing import Optional

from app.core.database import get_db
from app.core.security import decode_access_token, is_token_blacklisted
from app.core.config import settings
from app.models.user import User
from app.schemas.user import TokenData


# ============================================
# OAuth2 Token Bearer
# ============================================

"""
作用：
    定义 Token 获取方式。
    - tokenUrl: 获取 Token 的 URL（用于 Swagger UI 的认证按钮）
    - 自动从 Authorization: Bearer <token> 头中提取 Token
"""
oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_PREFIX}/auth/login",
    auto_error=False  # 不自动报错，让我们自定义错误处理
)


# ============================================
# 获取当前用户
# ============================================

def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> User:
    """
    获取当前登录用户（依赖注入）

    作用：
        从请求的 Authorization Header 中提取 Token，
        验证 Token 并返回对应的用户对象。

    实现方式：
        1. 从 Header 中获取 Token
        2. 解码 Token 获取用户ID
        3. 从数据库查询用户
        4. 返回用户对象

    使用方式：
        @app.get("/users/me")
        def get_me(current_user: User = Depends(get_current_user)):
            return current_user

    参数：
        token: str - 从 Header 自动提取的 Token
        db: Session - 数据库会话

    返回：
        User - 当前用户对象

    异常：
        401: Token 无效或过期
        404: 用户不存在
    """
    # 定义认证异常
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"error": {"code": "UNAUTHORIZED", "message": "无效的认证凭证"}},
        headers={"WWW-Authenticate": "Bearer"},
    )

    # 检查 Token 是否存在
    if token is None:
        raise credentials_exception

    # 解码 Token
    payload = decode_access_token(token)
    if payload is None:
        raise credentials_exception

    # 检查 Token 是否在黑名单中（已登出的 Token 主动失效，fail-closed）
    # 作用：用户登出后即使 Token 未过期也不能再使用
    # 安全要求：is_token_blacklisted 使用 exists_strict（fail-closed），
    #           Redis 故障时抛出异常，此处捕获并返回 503，拒绝请求而非放行
    # 原实现直接调用 is_token_blacklisted，Redis 宕机时存在（fail-open）返回 False，
    # 导致已登出 Token 重新生效。修复：捕获异常返回 503。
    try:
        if is_token_blacklisted(token):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"error": {"code": "TOKEN_REVOKED", "message": "Token 已失效，请重新登录"}},
                headers={"WWW-Authenticate": "Bearer"},
            )
    except HTTPException:
        # 黑名单命中，正常抛出 401
        raise
    except Exception:
        # Redis 故障，安全场景 fail-closed：拒绝请求
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": {"code": "AUTH_SERVICE_UNAVAILABLE", "message": "认证服务暂时不可用，请稍后重试"}},
        )

    # 从 payload 中获取用户ID
    user_id_str: Optional[str] = payload.get("sub")
    if user_id_str is None:
        raise credentials_exception

    try:
        user_id = int(user_id_str)
    except ValueError:
        raise credentials_exception

    # 从数据库查询用户
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception

    return user


# ============================================
# 获取当前活跃用户
# ============================================

def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """
    获取当前活跃用户（依赖注入）

    作用：
        在 get_current_user 基础上，额外检查用户是否活跃。
        被禁用的用户无法访问。

    实现方式：
        依赖 get_current_user 获取用户，然后检查 is_active 字段。

    使用方式：
        @app.get("/documents")
        def list_documents(
            current_user: User = Depends(get_current_active_user)
        ):
            return ...

    参数：
        current_user: User - 当前用户（由 get_current_user 提供）

    返回：
        User - 当前活跃用户

    异常：
        400: 用户已被禁用
    """
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": {"code": "USER_INACTIVE", "message": "用户已被禁用"}}
        )
    return current_user


# ============================================
# 获取当前超级管理员
# ============================================

def get_current_superuser(
    current_user: User = Depends(get_current_active_user)
) -> User:
    """
    获取当前超级管理员（依赖注入）

    作用：
        检查当前用户是否是超级管理员。
        用于保护管理员接口。

    使用方式：
        @app.delete("/admin/users/{user_id}")
        def delete_user(
            user_id: int,
            admin: User = Depends(get_current_superuser)
        ):
            ...

    异常：
        403: 权限不足
    """
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": {"code": "PERMISSION_DENIED", "message": "权限不足"}}
        )
    return current_user
