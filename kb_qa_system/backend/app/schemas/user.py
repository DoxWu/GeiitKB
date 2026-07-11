"""
用户相关 Schema（生产版）

作用：
    定义用户相关的请求和响应数据模型，用于 API 数据验证。
    与数据库模型不同，Schema 只用于数据传输，不涉及数据库操作。

实现方式：
    1. 使用 Pydantic BaseModel
    2. 通过 Field 添加验证规则
    3. 通过 ConfigDict 配置 ORM 模式（从 SQLAlchemy 对象读取数据）
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, EmailStr, ConfigDict, field_validator
import re


# ============================================
# 用户基础
# ============================================

# 用户名合法字符正则：字母、数字、下划线、横线、中文
# 作用：防止注入攻击和特殊字符导致的系统异常
_USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$")

# 密码复杂度正则：至少包含字母和数字
# 作用：防止弱密码（纯数字、纯字母），提升账号安全性
_PASSWORD_LETTER = re.compile(r"[a-zA-Z]")
_PASSWORD_DIGIT = re.compile(r"[0-9]")


class UserBase(BaseModel):
    """
    用户基础 Schema

    作用：
        定义用户共有的字段，被 Create 和 Response 继承。
    """
    username: str = Field(
        ...,
        min_length=3,
        max_length=50,
        description="用户名，3-50个字符，仅支持字母、数字、下划线、横线、中文"
    )
    email: EmailStr = Field(..., description="邮箱地址")

    @field_validator("username")
    @classmethod
    def validate_username_pattern(cls, v: str) -> str:
        """
        校验用户名字符模式

        作用：
            确保用户名只包含合法字符（字母、数字、下划线、横线、中文），
            防止特殊字符导致的注入攻击和系统异常。

        参数：
            v: str - 用户名

        返回:
            str - 校验通过的用户名

        异常:
            ValueError - 用户名包含非法字符
        """
        if not _USERNAME_PATTERN.match(v):
            raise ValueError(
                "用户名只能包含字母、数字、下划线、横线和中文"
            )
        return v


# ============================================
# 用户注册
# ============================================

class UserCreate(UserBase):
    """
    用户注册请求 Schema

    作用：
        定义注册接口的请求体格式。

    使用场景：
        POST /api/v1/auth/register

    示例请求体：
        {
            "username": "zhangsan",
            "email": "zhangsan@example.com",
            "password": "Secure123"
        }
    """
    password: str = Field(
        ...,
        min_length=8,
        max_length=100,
        description="密码，8-100个字符，必须包含字母和数字"
    )

    @field_validator("password")
    @classmethod
    def validate_password_complexity(cls, v: str) -> str:
        """
        校验密码复杂度

        作用：
            确保密码至少包含字母和数字，防止弱密码（纯数字、纯字母）。
            提升账号安全性，降低暴力破解成功率。

        实现方式：
            1. 检查是否包含至少一个字母
            2. 检查是否包含至少一个数字
            3. 不满足则抛出 ValueError

        参数：
            v: str - 密码明文

        返回:
            str - 校验通过的密码

        异常:
            ValueError - 密码不满足复杂度要求
        """
        if not _PASSWORD_LETTER.search(v):
            raise ValueError("密码必须包含至少一个字母")
        if not _PASSWORD_DIGIT.search(v):
            raise ValueError("密码必须包含至少一个数字")
        return v


# ============================================
# 用户登录
# ============================================

class UserLogin(BaseModel):
    """
    用户登录请求 Schema

    作用：
        定义登录接口的请求体格式。
        username 字段同时支持用户名和邮箱（前端 LoginForm 传入邮箱）。

    使用场景：
        POST /api/v1/auth/login

    示例请求体：
        {
            "username": "zhangsan",
            "password": "Secure123"
        }
        或使用邮箱登录：
        {
            "username": "zhangsan@example.com",
            "password": "Secure123"
        }
    """
    # 登录标识：用户名或邮箱
    # max_length=100 对齐 User.email 字段长度，支持邮箱登录
    # 作用：防止超长输入导致 bcrypt 计算 DoS（bcrypt 对超长输入有性能问题）
    username: str = Field(..., min_length=1, max_length=100, description="用户名或邮箱")
    password: str = Field(..., min_length=1, max_length=100, description="密码")


# ============================================
# 用户信息响应
# ============================================

class UserResponse(BaseModel):
    """
    用户信息响应 Schema

    作用：
        定义返回给前端的用户数据格式。
        注意：不包含密码字段！

    示例响应：
        {
            "id": 1,
            "username": "zhangsan",
            "email": "zhangsan@example.com",
            "is_active": true,
            "is_superuser": false,
            "created_at": "2026-07-05T10:00:00"
        }
    """
    id: int
    username: str
    email: str
    is_active: bool
    is_superuser: bool = False
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Token 响应（生产版）
# ============================================

class TokenResponse(BaseModel):
    """
    登录成功响应 Schema（生产版）

    作用：
        定义登录成功后返回的 Token 数据格式。
        包含 Access Token 和 Refresh Token。

    使用场景：
        POST /api/v1/auth/login 成功后返回

    示例响应：
        {
            "access_token": "eyJhbGci...",
            "refresh_token": "eyJhbGci...",
            "token_type": "bearer",
            "expires_in": 900,
            "user": { ... }
        }
    """
    access_token: str = Field(..., description="Access Token，用于 API 认证")
    refresh_token: str = Field(..., description="Refresh Token，用于刷新 Access Token")
    token_type: str = Field(default="bearer", description="Token 类型")
    expires_in: int = Field(..., description="Access Token 有效期（秒）")
    user: UserResponse = Field(..., description="用户信息")


# ============================================
# Refresh Token 请求
# ============================================

class RefreshTokenRequest(BaseModel):
    """
    刷新 Token 请求 Schema

    作用：
        定义 /auth/refresh 接口的请求体格式。
        前端在 Access Token 过期后，用 Refresh Token 换取新的 Access Token。

    使用场景：
        POST /api/v1/auth/refresh

    示例请求体：
        {
            "refresh_token": "eyJhbGci..."
        }
    """
    # L-6 修复：限制 token 长度，防止超长输入导致解码性能问题或注入攻击
    # JWT 格式为三段 base64 以 . 分隔，典型长度 200-2000 字符，设上限 5000 留余量
    refresh_token: str = Field(
        ...,
        min_length=10,
        max_length=5000,
        description="Refresh Token（JWT 格式，10-5000 字符）"
    )


# ============================================
# 刷新 Token 响应
# ============================================

class RefreshTokenResponse(BaseModel):
    """
    刷新 Token 响应 Schema（生产版：含 Refresh Token 轮换）

    作用：
        /auth/refresh 接口成功后返回新的 Access Token 和新的 Refresh Token。
        旧的 Refresh Token 会被加入黑名单，实现 Token 轮换（一次性使用）。

    示例响应：
        {
            "access_token": "eyJhbGci...",
            "refresh_token": "eyJhbGci...",
            "token_type": "bearer",
            "expires_in": 900
        }
    """
    access_token: str = Field(..., description="新的 Access Token")
    refresh_token: str = Field(..., description="新的 Refresh Token（轮换），旧的已失效")
    token_type: str = Field(default="bearer", description="Token 类型")
    expires_in: int = Field(..., description="Access Token 有效期（秒）")


# ============================================
# 账号删除请求
# ============================================

class AccountDeleteRequest(BaseModel):
    """
    账号删除请求 Schema

    作用：
        定义删除账号接口的请求体格式。
        要求用户输入密码确认，防止误操作和 CSRF 攻击。

    使用场景：
        DELETE /api/v1/auth/account

    示例请求体：
        {
            "password": "Secure123",
            "refresh_token": "eyJhbGci..."
        }

    安全说明：
        - password：必须验证通过才能执行删除，防止未授权删除
        - refresh_token：可选，提供后一并加入黑名单立即失效
    """
    password: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="当前账号密码，用于确认删除操作"
    )
    refresh_token: Optional[str] = Field(
        None,
        max_length=5000,
        description="Refresh Token（可选），提供后一并吊销"
    )


# ============================================
# Token 数据（内部使用）
# ============================================

class TokenData(BaseModel):
    """
    Token 数据 Schema

    作用：
        表示从 JWT Token 中解析出的数据。
        用于内部传递用户身份信息。

    示例：
        TokenData(user_id=1, username="zhangsan")
    """
    user_id: Optional[int] = None
    username: Optional[str] = None


# ============================================
# 登录失败响应
# ============================================

class LoginErrorResponse(BaseModel):
    """
    登录失败响应 Schema

    作用：
        登录失败时返回剩余尝试次数，提示用户。
    """
    error: dict = Field(..., description="错误信息")
    remaining_attempts: Optional[int] = Field(
        None,
        description="剩余尝试次数（锁定前）"
    )
