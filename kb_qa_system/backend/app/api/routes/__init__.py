"""
路由包

作用：
    统一导出所有路由器，供主应用注册。
"""
from app.api.routes.auth import router as auth_router
from app.api.routes.documents import router as documents_router
from app.api.routes.chat import router as chat_router
from app.api.routes.stats import router as stats_router

__all__ = ["auth_router", "documents_router", "chat_router", "stats_router"]
