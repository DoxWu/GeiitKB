"""
Prometheus HTTP 中间件

作用：
    自动采集所有 HTTP 请求的指标，包括：
    1. 请求总数（按 method/endpoint/status 维度）
    2. 请求延迟分布（Histogram）
    3. 在途请求数（Gauge）

    无需在各路由中手动埋点，中间件统一拦截采集。

实现方式：
    基于 Starlette 的 BaseHTTPMiddleware，在请求进入和离开时记录指标。
    路径模板化：将 /api/v1/chat/conversations/123 转换为 /api/v1/chat/conversations/{id}，
    避免高基数 label 导致 Prometheus 内存爆炸。

使用方式：
    在 main.py 中注册：
    from app.middleware.prometheus_middleware import PrometheusMiddleware
    app.add_middleware(PrometheusMiddleware)
"""

import time
import logging
from typing import Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import settings
from app.core.prometheus_metrics import (
    is_prometheus_enabled,
    http_requests_total,
    http_request_duration_seconds,
    http_requests_in_progress,
    record_db_pool_metrics,
)

logger = logging.getLogger(__name__)


class PrometheusMiddleware(BaseHTTPMiddleware):
    """
    Prometheus HTTP 指标采集中间件

    作用：
        拦截所有 HTTP 请求，自动采集请求量、延迟、在途数指标。
        Prometheus 关闭时直接放行，零开销。

    实现方式：
        - 继承 Starlette 的 BaseHTTPMiddleware
        - dispatch 方法在请求前后记录指标
        - 路径模板化避免高基数 label
    """

    async def dispatch(self, request: Request, call_next):
        """
        请求拦截处理

        作用：
            在请求处理前后记录 HTTP 指标。
            Prometheus 关闭时直接放行，不采集任何指标。

        实现方式：
            1. 检查 Prometheus 开关，关闭时直接调用下一层
            2. 跳过 /metrics 端点自身（避免抓取时产生指标干扰）
            3. 记录在途请求数 +1
            4. 记录请求开始时间
            5. 调用下一层处理请求
            6. 记录请求延迟、总数、状态码
            7. 在途请求数 -1

        参数：
            request: Request - Starlette 请求对象
            call_next: callable - 下一层处理函数

        返回:
            Response - 响应对象
        """
        # Prometheus 关闭时直接放行
        if not is_prometheus_enabled():
            return await call_next(request)

        # 跳过 /metrics 端点自身
        # 作用：避免 Prometheus 抓取指标时产生额外的请求指标，干扰监控数据
        if request.url.path == settings.PROMETHEUS_METRICS_PATH:
            return await call_next(request)

        # 提取请求方法和路径
        method = request.method
        # 路径模板化：将 /conversations/123 → /conversations/{id}
        # 作用：避免数字 ID 成为独立 label 值，控制 label 基数
        endpoint = self._get_template_path(request)

        # 记录在途请求数 +1
        http_requests_in_progress.inc()

        # E2-02: 采集数据库连接池指标（每个请求采样一次）
        record_db_pool_metrics()

        # 记录请求开始时间
        start_time = time.time()

        try:
            # 调用下一层处理请求
            response = await call_next(request)

            # 计算请求耗时
            duration = time.time() - start_time

            # 记录请求总数和延迟
            status = str(response.status_code)
            http_requests_total.labels(
                method=method,
                endpoint=endpoint,
                status=status,
            ).inc()
            http_request_duration_seconds.labels(
                method=method,
                endpoint=endpoint,
            ).observe(duration)

            return response

        except Exception as e:
            # 请求处理异常，记录 500 状态码
            # 作用：异常请求也纳入监控，便于发现错误率上升
            duration = time.time() - start_time
            http_requests_total.labels(
                method=method,
                endpoint=endpoint,
                status="500",
            ).inc()
            http_request_duration_seconds.labels(
                method=method,
                endpoint=endpoint,
            ).observe(duration)
            raise

        finally:
            # 无论成功失败，在途请求数 -1
            http_requests_in_progress.dec()

    def _get_template_path(self, request: Request) -> str:
        """
        获取模板化的请求路径

        作用：
            将带路径参数的 URL 转换为模板路径，避免高基数 label。
            例如：/api/v1/chat/conversations/123 → /api/v1/chat/conversations/{id}
                  /api/v1/documents/456/chunks → /api/v1/documents/{id}/chunks

        实现方式：
            1. 优先使用 Starlette 的 route.path（模板路径，已自动参数化）
            2. route 不可用时回退到原始 path
            3. 配置 PROMETHEUS_INCLUDE_PATH_LABEL=False 时返回 "unlabeled"

        参数：
            request: Request - Starlette 请求对象

        返回:
            str - 模板化路径或 "unlabeled"
        """
        # 配置关闭路径 label 时返回统一值
        # 作用：彻底避免基数问题，但失去端点维度区分能力
        if not settings.PROMETHEUS_INCLUDE_PATH_LABEL:
            return "unlabeled"

        # 优先使用 Starlette 路由匹配后的模板路径
        # 作用：route.path 是注册时的模板（如 /conversations/{conversation_id}），
        #       不含实际参数值，天然避免高基数
        route = request.scope.get("route")
        if route and hasattr(route, "path"):
            return route.path

        # 回退：使用原始路径（未匹配到路由时）
        return request.url.path
