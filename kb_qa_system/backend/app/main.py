"""
GeiIt企业知识库 - 主应用入口

作用：
    创建 FastAPI 应用实例，注册所有路由，配置中间件和异常处理。
    这是整个后端应用的入口点。

启动方式：
    开发环境：uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
    生产环境：uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4

访问文档：
    Swagger UI: http://localhost:8000/docs
    ReDoc: http://localhost:8000/redoc
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import SQLAlchemyError
import os
import logging

from app.core.config import settings
from app.core.database import Base, engine
from app.api.routes.auth import router as auth_router
from app.api.routes.registration import router as registration_router
from app.api.routes.documents import router as documents_router
from app.api.routes.chat import router as chat_router
from app.api.routes.stats import router as stats_router
from app.api.routes.metrics import router as metrics_router
from app.api.routes.folders import router as folders_router
from app.api.ws_notifications import router as ws_notifications_router


# ============================================
# 日志配置
# ============================================

"""
作用：
    配置日志格式和级别，便于调试和监控。
    - 开发环境（DEBUG=True）：人类可读的文本格式
    - 生产环境（DEBUG=False）：结构化 JSON 格式，便于日志聚合系统（ELK/Loki）解析和检索

    P1 #12 修复：原实现生产环境使用文本格式，日志聚合系统难以解析字段，
    排查问题时需写正则匹配。改为 JSON 格式后，每个字段（时间、级别、模块、消息）
    都可独立检索，大幅提升运维效率。

实现方式：
    - 使用 structlog（已在 requirements.txt 中）的 JSONRenderer 输出结构化日志
    - 同时配置标准 logging，使第三方库（uvicorn/sqlalchemy）的日志也走同一处理器
    - 开发环境保留文本格式，便于终端阅读
"""
import sys


def _configure_logging() -> None:
    """配置日志系统（开发环境文本格式 / 生产环境 JSON 格式）"""
    log_level = logging.DEBUG if settings.DEBUG else logging.INFO

    if settings.DEBUG:
        # 开发环境：人类可读的文本格式
        logging.basicConfig(
            level=log_level,
            format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
            stream=sys.stdout,
        )
    else:
        # 生产环境：结构化 JSON 格式
        # 作用：便于 ELK/Loki/Datadog 等日志聚合系统解析和检索
        import structlog

        # 配置 structlog 使用 JSON 渲染器
        structlog.configure(
            processors=[
                structlog.contextvars.merge_contextvars,
                structlog.processors.add_log_level,
                structlog.processors.TimeStamper(fmt="iso"),
                structlog.processors.StackInfoRenderer(),
                structlog.processors.format_exc_info,
                structlog.processors.JSONRenderer(),
            ],
            wrapper_class=structlog.make_filtering_bound_logger(log_level),
            logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
            cache_logger_on_first_use=True,
        )

        # 配置标准 logging 桥接到 structlog
        # 作用：让 uvicorn/sqlalchemy/celery 等第三方库的日志也输出为 JSON
        formatter = structlog.stdlib.ProcessorFormatter(
            processor=structlog.processors.JSONRenderer(),
            foreign_pre_chain=[
                structlog.processors.TimeStamper(fmt="iso"),
                structlog.processors.add_log_level,
            ],
        )
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(formatter)
        logging.basicConfig(level=log_level, handlers=[handler], force=True)


_configure_logging()
logger = logging.getLogger(__name__)


# ============================================
# 应用生命周期管理
# ============================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    应用生命周期管理

    作用：
        在应用启动和关闭时执行初始化和清理操作。

    实现方式：
        - 使用 FastAPI 的 lifespan 上下文管理器
        - 启动时：生产环境配置校验、创建数据库表、创建必要目录
        - 关闭时：清理资源

    参数：
        app: FastAPI - FastAPI 应用实例
    """
    # ===== 启动时执行 =====
    logger.info("🚀 启动GeiIt企业知识库...")

    # 0. 生产环境配置校验（启动前 fail-fast）
    # 作用：在应用启动前检查关键配置，配置缺失则拒绝启动，避免运行时才发现问题
    config_errors = settings.validate_required_for_production()
    if config_errors:
        for err in config_errors:
            logger.error(f"❌ 配置校验失败: {err}")
        raise RuntimeError(
            f"生产环境配置校验失败（{len(config_errors)} 项），应用拒绝启动。"
            f"请修复以上配置问题后重试。"
        )
    logger.info("✅ 配置校验通过")

    # 0.5. Sentry SDK 初始化（D6-01）
    # 作用：生产环境错误监控，自动捕获未处理异常和 Celery 任务失败
    # PII 过滤：before_send 回调移除 Authorization/Cookie 等敏感头
    if settings.ENABLE_SENTRY and settings.SENTRY_DSN:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.celery import CeleryIntegration
        from sentry_sdk.integrations.redis import RedisIntegration

        def _filter_pii(event, hint):
            """过滤 PII（个人身份信息），移除敏感请求头"""
            if "request" in event and "headers" in event["request"]:
                event["request"]["headers"] = {
                    k: v for k, v in event["request"]["headers"].items()
                    if k.lower() not in ("authorization", "cookie")
                }
            return event

        sentry_sdk.init(
            dsn=settings.SENTRY_DSN,
            environment=settings.ENVIRONMENT,
            traces_sample_rate=0.1,
            send_default_pii=False,
            integrations=[
                FastApiIntegration(),
                CeleryIntegration(),
                RedisIntegration(),
            ],
            before_send=_filter_pii,
        )
        logger.info("✅ Sentry 错误监控已启用")
    else:
        logger.info("ℹ️ Sentry 未配置（ENABLE_SENTRY=False 或 SENTRY_DSN 为空）")

    # 1. 数据库 schema 管理
    # C-11 修复：移除 Base.metadata.create_all，完全依赖 Alembic 迁移
    # 作用：create_all 仅创建表结构，不应用 Alembic 迁移的索引（IVFFlat/GIN），
    #       导致向量检索全表扫描；与 Alembic 并存还会造成 schema 漂移
    # 部署要求：必须执行 `alembic upgrade head`（Railway 配置 releaseCommand）
    # 开发环境：首次启动前手动执行 `alembic upgrade head`
    if settings.DEBUG:
        # 开发环境保留 create_all 便于快速启动（仅创建缺失的表，不覆盖已有 schema）
        # 注意：生产环境必须依赖 Alembic，不走此分支
        Base.metadata.create_all(bind=engine)
        logger.info("✅ 开发环境：数据库表已创建（生产环境由 Alembic 管理）")
    else:
        logger.info("ℹ️ 生产环境：数据库 schema 由 Alembic 管理，请确保已执行 alembic upgrade head")

    # 2. 创建必要目录
    # 作用：上传目录和数据目录在启动时确保存在
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    os.makedirs("./data", exist_ok=True)
    logger.info("✅ 目录已创建")

    # 3. 初始化 Prometheus 应用信息指标
    # 作用：在启动时设置 app_info（版本、环境等），供 Prometheus 抓取
    if settings.ENABLE_PROMETHEUS:
        from app.core.prometheus_metrics import init_app_info
        init_app_info()
        logger.info("✅ Prometheus 指标已启用（/metrics）")

    logger.info(f"🎉 应用启动成功！环境: {settings.ENVIRONMENT}")
    if settings.DEBUG:
        logger.info(f"📚 API 文档: http://localhost:8000/docs")
    else:
        logger.info("🔒 API 文档已在生产模式关闭")

    yield  # 应用运行期间

    # ===== 关闭时执行 =====
    # C-10 修复：资源清理，避免连接泄漏
    # 作用：原实现仅打印日志，未关闭 Redis/DB/Celery 连接，
    #       滚动部署时旧实例连接残留，耗尽连接池导致新实例启动失败
    # 实现：每个清理独立 try/except，单个失败不影响其他清理
    logger.info("👋 应用关闭中...")

    # 1. 关闭 Redis 连接池
    try:
        from app.core.redis import RedisManager
        RedisManager.close()
    except Exception as e:
        logger.error(f"关闭 Redis 失败: {e}")

    # 2. 关闭数据库连接池
    try:
        engine.dispose()
        logger.info("数据库连接池已关闭")
    except Exception as e:
        logger.error(f"关闭数据库连接池失败: {e}")

    # 3. 关闭 Celery 连接
    try:
        from app.tasks.celery_app import celery_app
        celery_app.close()
        logger.info("Celery 连接已关闭")
    except Exception as e:
        logger.error(f"关闭 Celery 连接失败: {e}")


# ============================================
# 创建 FastAPI 应用
# ============================================

app = FastAPI(
    title=settings.APP_NAME,
    description="""
    ## GeiIt企业知识库 API

    ### 功能特性
    - 📄 文档上传与解析（PDF/Markdown/Word/TXT/网页）
    - 🔍 向量检索（基于 pgvector 向量数据库）
    - 🤖 RAG 问答（基于知识库的智能问答）
    - 💬 流式输出（SSE 实时返回）
    - 📝 多轮对话（支持上下文追问）
    - 📚 引用来源（答案附带原文出处）

    ### 使用流程
    1. 注册账号并登录
    2. 上传文档（系统自动解析和向量化）
    3. 提问，系统基于知识库回答
    """,
    version="1.0.0",
    # 生产环境关闭 API 文档，避免暴露接口结构
    # 作用：DEBUG=False 或生产环境时不暴露 /docs、/redoc、/openapi.json
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
    openapi_url="/openapi.json" if settings.DEBUG else None,
    lifespan=lifespan,      # 生命周期管理
)


# ============================================
# CORS 跨域配置
# ============================================

"""
作用：
    允许前端跨域访问后端 API。
    浏览器安全策略会阻止不同源的请求，需要后端明确允许。

实现方式：
    - allow_origins: 允许的前端域名
    - allow_credentials: 允许携带 Cookie
    - allow_methods: 允许的 HTTP 方法
    - allow_headers: 允许的请求头

CSRF 风险评估（L-8）：
    本系统采用 Bearer Token 认证（Authorization 头），不依赖 Cookie 进行身份验证。
    CSRF 攻击利用浏览器自动发送 Cookie 的行为，对 Bearer Token 认证无效
    （攻击者无法读取或设置受害者的 Authorization 头）。
    因此当前 CSRF 风险为低，无需额外的 CSRF Token 防护。

    注意：allow_credentials=True 保留是为兼容未来可能的 Cookie 用途
    （如 refresh_token Cookie）。若后续引入 Cookie 认证，必须：
    1) 收紧 allow_origins 为具体域名（禁止通配符 *）
    2) 实现 CSRF Token 双重提交校验或 SameSite=Strict Cookie
"""
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    # 收紧允许的 HTTP 方法和请求头，避免通配符带来的安全风险
    # 作用：只开放实际需要的方法和头部，遵循最小权限原则
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Accept",
        "X-Request-ID",
        # M-22 修复：移除未使用的 X-Idempotency-Key 头
        # 原设计计划通过 Header 传递幂等键，实际实现在请求体 QuestionRequest.idempotency_key 中
        # 保留未使用的头会增加 CORS 预检开销且暴露 API 设计意图
    ],
    expose_headers=["X-Total-Count", "X-Request-ID"],
)

# ============================================
# 请求 ID 中间件（D8-02）
# ============================================

# 作用：为每个请求生成/传递 X-Request-ID，注入 structlog contextvars，
#       实现全链路请求追踪。CORS 已 expose X-Request-ID，客户端可读取。
from app.middleware.request_id_middleware import RequestIDMiddleware
app.add_middleware(RequestIDMiddleware)

# ============================================
# Prometheus 监控中间件
# ============================================

# 作用：自动采集所有 HTTP 请求的指标（请求数、延迟、在途数）
# Prometheus 关闭时中间件内部直接放行，零开销
from app.middleware.prometheus_middleware import PrometheusMiddleware
app.add_middleware(PrometheusMiddleware)

# E1-03: 统一限流中间件
# 作用：对未配置路由级限流的 API 端点应用默认限流（60次/分钟/用户或IP）
# 已配置路由级限流的端点通过 exclude_paths 自动跳过，避免重复限流
from app.middleware.rate_limit_middleware import RateLimitMiddleware
app.add_middleware(RateLimitMiddleware)


# ============================================
# 注册路由
# ============================================

"""
作用：
    将各个模块的路由器注册到主应用。
    所有路由都会加上 API_V1_PREFIX 前缀（/api/v1）。
"""
app.include_router(auth_router, prefix=settings.API_V1_PREFIX)
app.include_router(registration_router, prefix=settings.API_V1_PREFIX)
app.include_router(documents_router, prefix=settings.API_V1_PREFIX)
app.include_router(folders_router, prefix=settings.API_V1_PREFIX)
app.include_router(chat_router, prefix=settings.API_V1_PREFIX)
app.include_router(stats_router, prefix=settings.API_V1_PREFIX)
# metrics 路由不加 API_V1_PREFIX，放在根路径（/metrics）
app.include_router(metrics_router)
# E1-04: WebSocket 通知端点，不加 API_V1_PREFIX，放在根路径（/ws/notifications）
# 作用：实时推送审批结果、文档处理完成等通知，基于 Redis Pub/Sub 跨实例分发
app.include_router(ws_notifications_router)


# ============================================
# 健康检查接口
# ============================================

@app.get("/health", tags=["系统"])
async def health_check():
    """
    健康检查接口（L-13 修复：增强为深度健康检查）

    作用：
        检查服务及核心依赖（DB、Redis）是否正常运行。
        用于：
        - 负载均衡器健康检查（建议只看 status 字段）
        - 监控系统探活
        - 部署后验证
        - 依赖故障快速定位

    响应（200）：
        {
            "status": "healthy",  # overall: healthy / degraded / unhealthy
            "service": "GeiIt企业知识库",
            "version": "1.0.0",
            "environment": "development",
            "checks": {
                "database": {"status": "healthy", "latency_ms": 2},
                "redis": {"status": "healthy", "latency_ms": 1}
            }
        }
    """
    checks = {}
    overall_healthy = True

    # 1. 检查数据库连通性
    # 作用：DB 不可用时文档/对话/用户等核心功能全部失效
    try:
        from app.core.database import SessionLocal
        from sqlalchemy import text
        import time as _time
        db_start = _time.time()
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
            db_latency = int((_time.time() - db_start) * 1000)
            checks["database"] = {"status": "healthy", "latency_ms": db_latency}
        finally:
            db.close()
    except Exception as e:
        overall_healthy = False
        checks["database"] = {"status": "unhealthy", "error": type(e).__name__}

    # 2. 检查 Redis 连通性
    # 作用：Redis 不可用时限流/幂等/Token黑名单等功能受影响（fail-closed 策略下会拒绝请求）
    try:
        from app.core.redis import RedisManager
        import time as _time
        redis_start = _time.time()
        redis_ok = RedisManager.ping()
        redis_latency = int((_time.time() - redis_start) * 1000)
        if redis_ok:
            checks["redis"] = {"status": "healthy", "latency_ms": redis_latency}
        else:
            overall_healthy = False
            checks["redis"] = {"status": "unhealthy", "error": "ping returned False"}
    except Exception as e:
        overall_healthy = False
        checks["redis"] = {"status": "unhealthy", "error": type(e).__name__}

    return {
        "status": "healthy" if overall_healthy else "degraded",
        "service": settings.APP_NAME,
        "version": "1.0.0",
        "environment": settings.ENVIRONMENT,
        "checks": checks,
    }


@app.get("/", tags=["系统"])
async def root():
    """
    根路径

    作用：
        访问根路径时返回欢迎信息。
        生产环境不暴露 docs 链接，避免接口结构泄露。
    """
    response = {
        "message": "欢迎使用GeiIt企业知识库 API",
        "health": "/health",
    }
    # 仅在 DEBUG 模式下暴露文档地址
    if settings.DEBUG:
        response["docs"] = "/docs"
        response["redoc"] = "/redoc"
    return response


# ============================================
# CSP 违规报告端点（E4-03）
# ============================================

@app.post("/api/csp-report", tags=["系统"])
async def csp_report(request: Request):
    """
    CSP 违规报告接收端点

    作用：
        接收浏览器发送的 Content-Security-Policy 违规报告。
        nginx 配置 report-uri /api/csp-report，浏览器在检测到 CSP
        违规时会自动 POST 报告到此端点。

    实现方式：
        - 解析 report-only 或 enforce 模式的 CSP 报告
        - 记录到结构化日志（structlog），便于后续分析
        - 返回 204 No Content（浏览器期望的响应）

    安全考虑：
        - 此端点无需认证（浏览器自动发送）
        - 不存储报告到数据库（避免注入和存储膨胀）
        - 限制请求体大小（nginx 层面已限制）
    """
    try:
        body = await request.body()
        # 解析 CSP 报告 JSON
        import json
        report_data = json.loads(body) if body else {}
        csp_report = report_data.get("csp-report", report_data)

        # 记录到结构化日志，便于后续聚合分析
        logger.warning(
            "CSP 违规报告",
            document_uri=csp_report.get("document-uri", ""),
            violated_directive=csp_report.get("violated-directive", ""),
            blocked_uri=csp_report.get("blocked-uri", ""),
            source_file=csp_report.get("source-file", ""),
            line_number=csp_report.get("line-number", 0),
            referrer=csp_report.get("referrer", ""),
        )
    except Exception as e:
        # 解析失败不阻塞响应，仅记录警告
        logger.debug(f"CSP 报告解析失败: {type(e).__name__}")

    return JSONResponse(status_code=204, content=None)


# ============================================
# 全局异常处理
# ============================================

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """
    请求参数验证异常处理

    作用：
        当请求参数不符合要求时，返回友好的错误信息。
        默认的 422 错误格式对前端不友好，这里统一格式。

    实现方式：
        - 捕获 RequestValidationError
        - 提取错误详情
        - 返回统一格式的错误响应
    """
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "请求参数验证失败",
                "details": exc.errors(),
            }
        },
    )


@app.exception_handler(SQLAlchemyError)
async def database_exception_handler(request: Request, exc: SQLAlchemyError):
    """
    数据库异常处理

    作用：
        当数据库操作出错时，返回友好的错误信息。
        不暴露具体的 SQL 错误（安全考虑）。

    实现方式：
        - 捕获 SQLAlchemyError
        - 记录详细错误到日志
        - 返回通用的数据库错误信息
    """
    logger.error(f"数据库错误: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "DATABASE_ERROR",
                "message": "数据库操作失败",
            }
        },
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """
    全局异常处理

    作用：
        捕获所有未处理的异常，防止服务崩溃。
        返回 500 错误和友好提示。

    实现方式：
        - 捕获所有 Exception
        - 记录详细错误到日志
        - 开发环境返回错误详情，生产环境只返回通用信息
    """
    # H-13 修复：即使 DEBUG 模式也不向客户端返回 str(exc)，避免泄露内部细节
    # 作用：原实现 DEBUG 时返回 str(exc)，可能暴露 SQL 错误、文件路径、堆栈等敏感信息
    #       修复后：详细异常仅记日志（exc_info=True 已记录完整堆栈），客户端只返回通用提示
    #       DEBUG 调试请通过服务端日志查看，不以客户端响应为调试通道
    logger.error(f"未处理的异常: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "服务器内部错误",
            }
        },
    )


# ============================================
# 启动服务
# ============================================

if __name__ == "__main__":
    import uvicorn

    """
    直接运行此文件启动服务：
    python -m app.main

    推荐使用 uvicorn 命令启动：
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

    参数说明：
    - --reload: 代码修改后自动重启（仅开发环境）
    - --host: 监听地址（0.0.0.0 表示所有网卡）
    - --port: 监听端口
    - --workers: 工作进程数（生产环境推荐 4）
    """
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG,
        log_level="debug" if settings.DEBUG else "info",
    )
