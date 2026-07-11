"""
Prometheus 指标暴露路由

作用：
    提供 /metrics HTTP 端点，供 Prometheus server 抓取指标数据。
    返回 Prometheus 文本格式的指标数据。

    支持可选的 Basic Auth 保护，防止生产环境指标数据泄露。

实现方式：
    - 使用 prometheus_client.generate_latest() 生成指标数据
    - 通过 Response 返回，Content-Type 为 text/plain; version=0.0.4
    - Basic Auth 通过 FastAPI 的 HTTPBasic 依赖实现

使用方式：
    # 启用 Prometheus（在 .env 中设置）
    ENABLE_PROMETHEUS=true

    # 访问指标（无认证）
    curl http://localhost:8000/metrics

    # 访问指标（有认证）
    curl -u prometheus:password http://localhost:8000/metrics
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import PlainTextResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
import secrets

from app.core.config import settings
from app.core.prometheus_metrics import is_prometheus_enabled, get_metrics_data

logger = logging.getLogger(__name__)

# 创建路由器（不加 API_V1_PREFIX，metrics 端点放在根路径）
router = APIRouter(tags=["监控"])

# Basic Auth 安全依赖
_security = HTTPBasic()


def _verify_auth(credentials: HTTPBasicCredentials) -> None:
    """
    验证 Basic Auth 凭据

    作用：
        校验请求提供的用户名和密码是否匹配配置值。
        使用 secrets.compare_digest 避免 timing attack（时序攻击）。

    实现方式：
        - 检查配置的密码是否为空（空密码时拒绝所有请求，防止未配置即暴露）
        - 比较用户名和密码是否与配置一致
        - 不匹配时返回 401 Unauthorized

    参数：
        credentials: HTTPBasicCredentials - 请求中的 Basic Auth 凭据

    异常：
        HTTPException - 401 认证失败
        HTTPException - 503 服务未正确配置（密码为空时）
    """
    # 安全检查：配置密码为空时拒绝所有请求
    # 作用：防止 PROMETHEUS_AUTH_PASSWORD 未设置时，空字符串 compare_digest 空字符串返回 True 的绕过
    if not settings.PROMETHEUS_AUTH_PASSWORD:
        logger.error("PROMETHEUS_AUTH_PASSWORD 未配置，/metrics 端点拒绝所有请求")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Metrics endpoint not properly configured",
        )

    # 比较用户名（使用恒定时间比较防时序攻击）
    is_user_correct = secrets.compare_digest(
        credentials.username.encode("utf-8"),
        settings.PROMETHEUS_AUTH_USER.encode("utf-8"),
    )
    # 比较密码
    is_password_correct = secrets.compare_digest(
        credentials.password.encode("utf-8"),
        settings.PROMETHEUS_AUTH_PASSWORD.encode("utf-8"),
    )

    if not (is_user_correct and is_password_correct):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials for metrics endpoint",
            headers={"WWW-Authenticate": "Basic"},
        )


@router.get(
    settings.PROMETHEUS_METRICS_PATH,
    summary="Prometheus 指标端点",
    include_in_schema=False,  # 不在 Swagger 文档中显示（避免暴露给普通用户）
)
async def metrics(
    # 始终使用 HTTPBasic 依赖解析 Authorization 头（缺失时 credentials 为 None）
    # 修复 P-02：此前使用 Depends(None) 导致 FastAPI 误将 args/kwargs 作为查询参数
    #            从而返回 422 VALIDATION_ERROR。改为始终注入依赖，函数内部按开关判断。
    credentials: Optional[HTTPBasicCredentials] = Depends(_security),
):
    """
    Prometheus 指标暴露端点

    作用：
        返回 Prometheus 文本格式的指标数据，供 Prometheus server 抓取。
        Prometheus server 定期（默认 15s）GET 此端点采集指标。

    实现方式：
        1. 检查 Prometheus 是否启用（未启用返回 404）
        2. 检查 Basic Auth（如启用且提供了凭据）
        3. 调用 get_metrics_data() 生成指标数据
        4. 返回 PlainTextResponse

    响应（200）：
        Content-Type: text/plain; version=0.0.4; charset=utf-8
        Body: Prometheus 文本格式指标数据

    响应（404）：
        Prometheus 未启用时返回 404

    响应（401）：
        Basic Auth 认证失败（仅在 PROMETHEUS_AUTH_ENABLED=true 时）
    """
    # Prometheus 未启用时返回 404
    # 作用：避免暴露空指标端点
    if not is_prometheus_enabled():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Prometheus metrics not enabled",
        )

    # Basic Auth 验证（仅在启用认证时）
    # 作用：PROMETHEUS_AUTH_ENABLED=False 时跳过验证，直接返回指标
    if settings.PROMETHEUS_AUTH_ENABLED:
        # 启用了认证但未提供凭据 → 返回 401 触发浏览器 Basic Auth 弹窗
        if credentials is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated",
                headers={"WWW-Authenticate": "Basic"},
            )
        _verify_auth(credentials)

    # 生成指标数据
    data, content_type = get_metrics_data()

    return PlainTextResponse(
        content=data,
        media_type=content_type,
    )
