#!/bin/bash
# ============================================
# GeiIt企业知识库 - 容器入口脚本
# ============================================
# 作用：
#     根据 ROLE 环境变量启动不同的服务角色：
#     - ROLE=api:    运行数据库迁移，启动 FastAPI（uvicorn）
#     - ROLE=worker: 启动 Celery Worker（处理异步文档处理任务）
#     - ROLE=flower: 启动 Flower（Celery 任务监控面板）
#
# 使用方式：
#     docker run -e ROLE=api kb-qa-backend
#     docker run -e ROLE=worker kb-qa-backend
#     docker run -e ROLE=flower -p 5555:5555 kb-qa-backend
# ============================================

set -e  # 任何命令失败立即退出

# 默认角色
ROLE="${ROLE:-api}"

echo "=========================================="
echo "  GeiIt企业知识库 - 启动中"
echo "  角色: ${ROLE}"
echo "  环境: ${ENVIRONMENT:-development}"
echo "=========================================="

# --------------------------------------------
# 数据库迁移函数
# 作用：在启动 API 前应用最新的 Alembic 迁移，保证表结构一致
# --------------------------------------------
run_migrations() {
    echo "📦 正在执行数据库迁移..."
    # 只在 api 角色执行迁移，避免多副本重复迁移
    # 作用：worker/flower 不需要执行迁移
    alembic upgrade head
    echo "✅ 数据库迁移完成"
}

# --------------------------------------------
# 启动 FastAPI API 服务
# --------------------------------------------
start_api() {
    run_migrations

    # worker 数量：生产环境根据 CPU 核心数，开发环境 1 个
    WORKERS="${UVICORN_WORKERS:-1}"

    echo "🚀 启动 FastAPI 服务（${WORKERS} workers）..."
    exec uvicorn app.main:app \
        --host 0.0.0.0 \
        --port "${PORT:-8000}" \
        --workers "${WORKERS}" \
        --proxy-headers \
        --forwarded-allow-ips='*'
}

# --------------------------------------------
# 启动 Celery Worker
# --------------------------------------------
start_worker() {
    echo "🔧 启动 Celery Worker..."
    # 注意：使用显式 :celery_app 语法指定应用对象，避免 Celery 自动查找歧义
    exec celery -A app.core.celery_app:celery_app worker \
        --loglevel=info \
        --concurrency="${CELERY_WORKER_CONCURRENCY:-2}" \
        --max-tasks-per-child="${CELERY_MAX_TASKS_PER_CHILD:-100}"
}

# --------------------------------------------
# 启动 Flower 监控
# --------------------------------------------
start_flower() {
    echo "🌸 启动 Flower 监控面板..."
    exec celery -A app.core.celery_app:celery_app flower \
        --port="${FLOWER_PORT:-5555}" \
        --host=0.0.0.0
}

# 根据角色分发
case "${ROLE}" in
    api)
        start_api
        ;;
    worker)
        start_worker
        ;;
    flower)
        start_flower
        ;;
    *)
        echo "❌ 未知角色: ${ROLE}，可选值: api / worker / flower"
        exit 1
        ;;
esac
