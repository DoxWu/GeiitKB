"""
数据库连接模块（生产版 - PostgreSQL）

作用：
    管理 SQLAlchemy 数据库连接，提供会话（Session）工厂和基类。
    所有数据模型都继承自这里的 Base 类。

实现方式：
    1. 使用 SQLAlchemy 2.0 的声明式风格
    2. 通过 create_engine 创建 PostgreSQL 连接池
    3. 通过 sessionmaker 创建会话工厂
    4. 通过依赖注入为每个请求提供独立的数据库会话
    5. 配置连接池参数，优化数据库连接管理
"""

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base
from typing import Generator

from app.core.config import settings


# ============================================
# 创建数据库引擎
# ============================================

"""
作用：
    创建全局数据库引擎，负责管理 PostgreSQL 连接池。

参数说明（从配置读取）：
    - DATABASE_URL: PostgreSQL 连接字符串
    - pool_size: 连接池大小（默认 10）
    - max_overflow: 最大溢出连接数（默认 20）
    - pool_recycle: 连接回收时间（秒），避免长连接被数据库断开
    - pool_pre_ping: 连接前检查是否有效，避免使用失效连接
    - pool_timeout: 获取连接超时时间（秒）
    - echo: 是否打印 SQL 语句（仅开发环境）

实现方式：
    - PostgreSQL 使用连接池
    - 配置连接健康检查
"""

# SQLAlchemy 兼容性：psycopg3 需要 postgresql+psycopg:// 协议
# Railway 自动注入的 DATABASE_URL 是 postgresql:// 前缀，需自动修正
database_url = settings.DATABASE_URL
if database_url.startswith("postgresql://") and "+psycopg" not in database_url:
    # 自动将 postgresql:// 转换为 postgresql+psycopg://（psycopg3 驱动）
    database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)

engine = create_engine(
    database_url,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_recycle=settings.DB_POOL_RECYCLE,
    pool_pre_ping=True,  # 连接前检查，避免使用失效连接
    pool_timeout=settings.DB_POOL_TIMEOUT,
    echo=settings.DEBUG,  # 开发环境打印 SQL 语句
)


# ============================================
# 连接池事件监听（优化）
# ============================================

@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    """
    数据库连接初始化

    作用：
        每个新连接建立时设置数据库参数。
        PostgreSQL 下设置超时参数，避免长查询拖垮连接池。

    实现方式：
        - 通过 connection 事件监听
        - 执行 SET 语句配置参数
    """
    try:
        # 设置语句超时（毫秒），避免慢查询拖垮连接池
        # statement_timeout: 单条语句最大执行时间
        # idle_in_transaction_session_timeout: 事务空闲超时
        with dbapi_connection.cursor() as cursor:
            cursor.execute("SET statement_timeout = '30000';")  # 30秒
            cursor.execute("SET idle_in_transaction_session_timeout = '60000';")  # 60秒
    except Exception:
        # 忽略设置失败（某些环境可能不支持）
        pass


# ============================================
# 创建会话工厂
# ============================================

"""
作用：
    创建 SessionLocal 会话工厂，用于生成数据库会话实例。
    每个请求需要独立的会话，请求结束后关闭。

实现方式：
    - autocommit=False: 不自动提交，需手动调用 db.commit()
    - autoflush=False: 不自动刷新，避免不必要的数据库查询
    - expire_on_commit=False: 提交后不过期，避免访问属性时再次查询
"""
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    expire_on_commit=False,  # 提交后对象仍可用，避免 lazy loading 问题
)


# ============================================
# 创建声明式基类
# ============================================

"""
作用：
    所有 ORM 模型都继承 Base 类，SQLAlchemy 通过它管理模型映射关系。
"""
Base = declarative_base()


# ============================================
# 数据库会话依赖
# ============================================

def get_db() -> Generator:
    """
    获取数据库会话（依赖注入）

    作用：
        为每个 HTTP 请求提供独立的数据库会话，请求结束后自动关闭。
        避免数据库连接泄漏。

    实现方式：
        - 使用 Python 生成器 yield
        - FastAPI 的 Depends 会自动调用此函数
        - finally 块确保会话被关闭

    使用方式：
        @app.get("/items")
        def get_items(db: Session = Depends(get_db)):
            return db.query(Item).all()

    返回：
        Generator[Session, None, None]: 数据库会话生成器
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
