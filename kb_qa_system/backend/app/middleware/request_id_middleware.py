"""
请求 ID 中间件（D8-02）

作用：
    为每个 HTTP 请求生成或传递 X-Request-ID，并注入 structlog contextvars，
    使所有日志都携带 request_id，便于全链路追踪和问题定位。

实现方式：
    1. 从请求头读取 X-Request-ID（支持上游传递，如 Nginx/API Gateway）
    2. 没有则用 uuid4 生成
    3. 写入响应头 X-Request-ID（客户端可关联请求）
    4. 注入 structlog contextvars（日志自动携带 request_id）
    5. 请求结束后清除 contextvars（避免上下文泄漏）

使用方式：
    from app.middleware.request_id_middleware import RequestIDMiddleware
    app.add_middleware(RequestIDMiddleware)
"""

import uuid
import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response as StarletteResponse


class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    请求 ID 中间件

    作用：
        为每个请求生成/传递 X-Request-ID，注入日志上下文，
        实现全链路请求追踪。

    实现方式：
        - 继承 BaseHTTPMiddleware，通过 dispatch 方法拦截请求/响应
        - 使用 structlog.contextvars 绑定/清除 request_id
    """

    async def dispatch(
        self,
        request: StarletteRequest,
        call_next,
    ) -> StarletteResponse:
        """
        拦截请求，注入 request_id

        参数：
            request: StarletteRequest - HTTP 请求对象
            call_next: 下一个中间件/路由处理函数

        返回：
            StarletteResponse - HTTP 响应（含 X-Request-ID 头）
        """
        # 1. 从请求头读取或生成 request_id
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex

        # 2. 注入 structlog contextvars（日志自动携带 request_id）
        structlog.contextvars.bind_contextvars(request_id=request_id)

        try:
            # 3. 处理请求
            response = await call_next(request)

            # 4. 写入响应头（客户端可关联请求）
            response.headers["X-Request-ID"] = request_id

            return response
        finally:
            # 5. 清除 contextvars（避免上下文泄漏到下一个请求）
            structlog.contextvars.clear_contextvars()
