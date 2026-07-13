"""
已有文档重处理脚本（一次性）

作用：
    调整 CHUNK_SIZE/CHUNK_OVERLAP 参数后，对已有文档执行重新分块+嵌入，
    使旧文档受益于新的分块策略。

    适用场景：
        1. 调整了 CHUNK_SIZE（500→800）或 CHUNK_OVERLAP（50→100）
        2. 调整了检索参数（SEARCH_TOP_K/SIMILARITY_THRESHOLD 等）
        3. 需要让已有文档的向量数据与新参数保持一致

使用方式：
    # 方式1：在 worker 容器内执行（推荐，确保 Celery 任务能正确派发）
    docker-compose exec worker python -m scripts.reprocess_all_documents

    # 方式2：直接执行（需在 backend 目录下，且环境变量已配置）
    cd backend
    python scripts/reprocess_all_documents.py

安全措施：
    1. 处理前自动备份 document_chunks 表（CREATE TABLE ... AS SELECT）
    2. 逐个触发，失败不中断（记录错误并继续下一个）
    3. 输出详细日志和处理摘要
    4. 备份表名含时间戳，可多次执行不会覆盖

回滚方案：
    若重处理后检索异常，可从备份表恢复：
    TRUNCATE document_chunks;
    INSERT INTO document_chunks SELECT * FROM document_chunks_backup_YYYYMMDD_HHMMSS;

注意：
    重处理为异步任务（通过 Celery 派发），脚本仅负责派发，不等待完成。
    请通过 Flower（http://localhost:5555）或文档状态轮询确认处理完成。
"""

import sys
import logging
from datetime import datetime

# 脚本独立运行时的路径修正
# 作用：确保能正确导入 app 模块（容器内工作目录为 /app，本地为 backend/）
sys.path.insert(0, "/app")

from sqlalchemy import text
from app.core.database import SessionLocal
from app.core.config import settings
from app.models.document import Document
from app.tasks.document_tasks import reprocess_document_task

logger = logging.getLogger(__name__)


def backup_chunks_table(db) -> str:
    """
    备份 document_chunks 表（安全措施）

    作用：
        在重处理前创建 document_chunks 表的完整备份，
        确保异常时可回滚到原始状态。

    实现方式：
        使用 CREATE TABLE ... AS SELECT 创建备份表，
        表名含时间戳避免多次执行时覆盖。

    参数：
        db: Session - 数据库会话

    返回:
        str - 备份表名（如 document_chunks_backup_20260713_120000）

    安全说明：
        backup_name 由脚本内部生成（时间戳格式），不含用户输入，无 SQL 注入风险
    """
    backup_name = f"document_chunks_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    # 安全说明：backup_name 为脚本生成的时间戳，无注入风险
    # SQLAlchemy 2.0+ 要求用 text() 包裹原始 SQL
    db.execute(text(f"CREATE TABLE {backup_name} AS SELECT * FROM document_chunks"))
    db.commit()
    logger.info(f"已备份 document_chunks → {backup_name}")
    return backup_name


def get_completed_documents(db):
    """
    获取所有已完成且未删除的文档

    作用：
        筛选需要重处理的文档列表。
        只处理 status='completed' 且 is_deleted=False 的文档，
        跳过正在处理、失败或已删除的文档。

    参数：
        db: Session - 数据库会话

    返回:
        List[Document] - 待重处理的文档列表
    """
    return db.query(Document).filter(
        Document.status == "completed",
        Document.is_deleted == False,  # noqa: E712（SQLAlchemy 需要 == False）
    ).all()


def main():
    """
    主入口：执行已有文档重处理

    流程：
        1. 配置日志
        2. 打印当前分块参数（确认配置已更新）
        3. 备份 document_chunks 表
        4. 获取待处理文档列表
        5. 逐个派发 reprocess_document_task Celery 任务
        6. 输出处理摘要
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    logger.info("=" * 60)
    logger.info("开始已有文档重处理")
    logger.info(
        f"当前参数：CHUNK_SIZE={settings.CHUNK_SIZE}, "
        f"CHUNK_OVERLAP={settings.CHUNK_OVERLAP}, "
        f"SEARCH_TOP_K={settings.SEARCH_TOP_K}"
    )
    logger.info("=" * 60)

    db = SessionLocal()
    try:
        # 1. 备份 document_chunks 表
        backup_name = backup_chunks_table(db)

        # 2. 获取待处理文档列表
        documents = get_completed_documents(db)
        total = len(documents)
        logger.info(f"待处理文档数：{total}")

        if total == 0:
            logger.info("无待处理文档，退出")
            return

        # 3. 逐个触发重处理（Celery 异步任务）
        # 作用：reprocess_document_task 内部会：
        #   a. 删除旧的分块数据（vector_store.delete_document_chunks）
        #   b. 重置文档状态为 pending
        #   c. 调用 process_document_task.delay() 重新执行完整处理流水线
        success, failed = 0, 0
        for idx, doc in enumerate(documents, 1):
            try:
                task = reprocess_document_task.delay(doc.id)
                logger.info(
                    f"[{idx}/{total}] 文档 {doc.id} ({doc.title}) "
                    f"已派发，task_id={task.id}"
                )
                success += 1
            except Exception as e:
                logger.error(f"[{idx}/{total}] 文档 {doc.id} 派发失败：{e}")
                failed += 1

        # 4. 输出处理摘要
        logger.info("=" * 60)
        logger.info(f"重处理派发完成：成功 {success}，失败 {failed}，总计 {total}")
        logger.info(f"备份表：{backup_name}")
        logger.info(
            "注意：重处理为异步任务，请通过 Flower 或文档状态轮询确认完成"
        )
        logger.info("=" * 60)

    finally:
        db.close()


if __name__ == "__main__":
    main()
