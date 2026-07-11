"""
对话路由模块

作用：
    定义知识库问答相关的 API 接口，包括：
    - 提问（非流式）
    - 提问（流式 SSE）
    - 获取对话列表
    - 获取对话详情
    - 删除对话

实现方式：
    1. 使用 RAG 服务进行检索增强生成
    2. 流式接口使用 StreamingResponse + SSE
    3. 对话历史持久化到数据库
"""

import json
import logging
from fastapi import APIRouter, Depends, HTTPException, status, Query, Path
from fastapi.responses import StreamingResponse
from sqlalchemy import update
from sqlalchemy.orm import Session
from typing import Any, List, Dict, Optional
from datetime import datetime

from app.core.database import get_db
from app.core.config import settings
from app.core.rate_limit import rate_limit
from app.core.redis import RedisManager, RedisKeys
from app.api.deps import get_current_active_user
from app.models.user import User
from app.models.conversation import Conversation, Message
from app.schemas.chat import (
    QuestionRequest, AnswerResponse, ConversationResponse,
    ConversationListResponse, MessageResponse, SourceItem
)

# 模块日志器
# 作用：记录流式处理异常等关键事件，便于排查问题
logger = logging.getLogger(__name__)

# 创建路由器
router = APIRouter(prefix="/chat", tags=["对话问答"])


# ============================================
# 提问（非流式）
# ============================================

@router.post(
    "/ask",
    response_model=AnswerResponse,
    summary="提问（非流式）",
    # 限流：每分钟最多 RATE_LIMIT_ASK_PER_MINUTE 次提问
    # 作用：防止单用户高频调用 LLM，控制成本和资源消耗
    dependencies=[Depends(rate_limit("ask", per_minute=settings.RATE_LIMIT_ASK_PER_MINUTE))],
)
def ask_question(
    question_data: QuestionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    提问接口（非流式）

    作用：
        接收用户问题，基于知识库检索并生成回答。
        一次性返回完整答案，同时记录全链路质量埋点。

    实现方式：
        1. 幂等性检查（可选，防止重复提交）
        2. 创建或获取对话
        3. 保存用户问题并提交事务（释放 DB 连接供 LLM 调用期间使用）
        4. 获取有效历史（含历史摘要，记忆衰退机制）
        5. 调用 RAG 服务检索+生成（含权限隔离）
        6. 保存 AI 回答到数据库 + 更新对话轮数
        7. 记录 QAEvent 质量埋点
        8. 尝试生成历史摘要（达到阈值时触发）
        9. 返回答案和引用来源（缓存幂等性结果）

    请求体：
        {
            "question": "如何使用异步编程？",
            "conversation_id": null,
            "idempotency_key": "req-abc-123"
        }

    响应（200）：
        {
            "answer": "异步编程是一种...",
            "sources": [...],
            "conversation_id": 1,
            "message_id": 2,
            "degraded": false,
            "degrade_reason": null
        }
    """
    import time as _time
    from app.services.qa_event_service import qa_event_service
    from app.services.history_service import history_service
    from app.services.intent_service import intent_service

    # 总耗时计时起点
    total_start = _time.time()

    # 0. 幂等性检查（P0-7：防止重复提交导致重复 LLM 调用）
    # 作用：前端因网络抖动/用户连点重复提交时，返回首次结果而非重复调用 LLM
    # 实现：Redis 锁 + 结果缓存，key 按 user_id 隔离
    idempotency_key = question_data.idempotency_key
    idempotency_lock_key = None
    idempotency_lock_token = None  # H-2: 锁唯一标识，释放时比对防误删
    idempotency_result_key = None
    if idempotency_key:
        idempotency_result_key = RedisKeys.idempotency_result(
            current_user.id, idempotency_key
        )
        # 0.1 检查是否有已完成的缓存结果
        cached = RedisManager.get(idempotency_result_key)
        if cached and isinstance(cached, dict):
            return cached
        # 0.2 抢占处理锁，防止并发重复处理
        # H-2 修复：使用 acquire_lock 获取唯一 token，release_lock 比对释放，防误删
        idempotency_lock_key = RedisKeys.idempotency_lock(
            current_user.id, idempotency_key
        )
        # L-1 修复：TTL 使用配置项 IDEMPOTENCY_LOCK_TTL，必须 > LLM_TIMEOUT
        idempotency_lock_token = RedisManager.acquire_lock(idempotency_lock_key, ttl=settings.IDEMPOTENCY_LOCK_TTL)
        if idempotency_lock_token is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": {"code": "DUPLICATE_REQUEST", "message": "请求正在处理中，请勿重复提交"}},
            )

    try:
        # 1. 创建或获取对话
        conversation = _get_or_create_conversation(
            db=db,
            user_id=current_user.id,
            conversation_id=question_data.conversation_id,
            title=question_data.question[:20]  # 用问题前20字作为标题
        )

        # 2. 保存用户问题
        user_message = Message(
            conversation_id=conversation.id,
            role="user",
            content=question_data.question,
        )
        db.add(user_message)
        # P0-4 修复：在调用 LLM 前提交用户消息，释放 DB 事务
        # 作用：原实现 db.flush() 仅发送 SQL 不提交事务，LLM 调用（数秒~数十秒）
        #       期间事务持续打开，导致：
        #       1. 连接池连接被占用，高并发时池耗尽
        #       2. PostgreSQL idle_in_transaction_session_timeout 超时被强制断开
        #       修复：改为 db.commit() 提交事务释放连接，LLM 调用期间 DB 空闲
        db.commit()
        db.refresh(user_message)  # 刷新获取自增 ID（commit 后对象 expire）
        db.refresh(conversation)  # 刷新 conversation（后续需要读取 turn_count 等）

        # 3. 获取有效对话历史（记忆衰退机制）
        # 作用：history_service 返回 (近期历史, 历史摘要)
        #   - 近期历史：最近 N 轮完整对话
        #   - 历史摘要：旧对话压缩后的摘要（可能为 None）
        # summary 会注入到 LLM 消息中作为长期上下文，避免旧对话信息丢失
        history, summary = history_service.get_effective_history(
            db, conversation, exclude_message_id=user_message.id
        )

        # 3.5 意图切换检测
        # 作用：检测用户是否相对于最近一次提问切换了话题
        #   - 切换时：summary 置 None（不注入旧摘要污染检索），intent_switched=True 传给 RAG
        #   - 未切换：正常使用 summary，intent_switched=False
        # 检测策略：Embedding 余弦相似度为主，关键词 Jaccard 为辅，失败保守不切换
        # 日志：意图切换的详细信息在 intent_service.detect_intent_switch 内部已记录
        intent_result = intent_service.detect_intent_switch(
            question_data.question, history
        )
        effective_summary = None if intent_result.switched else summary

        # 4. 调用 RAG 服务
        # 懒加载 RAG 服务
        from app.services.rag_chain import get_rag_chain
        rag_chain = get_rag_chain()

        # 执行问答（传入 user_id 限定检索范围，防止越权访问他人文档）
        # 作用：RAG 内部根据 user_id 计算可访问文档（自己的 + 公共库），只在这些文档中检索
        # 传入 effective_summary 让 LLM 获取历史摘要，实现记忆衰退
        # 传入 intent_switched 让 RAG 调整 query 改写和 LLM 提示
        # P0-4：此时 DB 事务已关闭，LLM 调用期间不会占用 DB 连接
        result = rag_chain.ask(
            question=question_data.question,
            conversation_history=history,
            user_id=current_user.id,
            summary=effective_summary,
            intent_switched=intent_result.switched,
        )

        # 5. 保存 AI 回答（含降级标记，便于后续质量分析）+ 更新对话轮数
        # 作用：is_degraded/degrade_reason 记录本次回答是否走了兜底路径
        # turn_count +1 用于记忆衰退判断（达到阈值时触发摘要生成）
        assistant_message = Message(
            conversation_id=conversation.id,
            role="assistant",
            content=result["answer"],
            sources=result["sources"],
            is_degraded=result.get("degraded", False),
            degrade_reason=result.get("degrade_reason"),
        )
        db.add(assistant_message)
        # C-3 修复：原子递增 turn_count，避免并发丢失更新
        # 作用：原实现 conversation.turn_count += 1 是 read-modify-write，并发丢失更新
        #       修复后用 SQL UPDATE 原子递增，行锁保证一致性
        _increment_turn_count(db, conversation.id)
        db.commit()
        db.refresh(assistant_message)
        db.refresh(conversation)  # 同步 turn_count 内存值，供 maybe_generate_summary 使用

        # 6. 记录 QA 事件质量埋点
        # 作用：将全链路指标持久化到 qa_events 表，供质量分析使用
        # 埋点失败不影响主流程（qa_event_service 内部已 catch all）
        total_time_ms = int((_time.time() - total_start) * 1000)
        qa_event_service.record_event(
            db=db,
            message_id=assistant_message.id,
            conversation_id=conversation.id,
            user_id=current_user.id,
            question=question_data.question,
            answer=result["answer"],
            metrics=result.get("metrics", {}),
            degraded=result.get("degraded", False),
            degrade_reason=result.get("degrade_reason"),
            total_time_ms=total_time_ms,
        )

        # 6.5 Prometheus 指标：记录总处理耗时（含 DB 操作）
        # 作用：监控从用户提问到返回答案的端到端耗时，供 Grafana 展示
        # intent_type 从结果中提取（无检索路径携带 intent 字段，检索路径默认 kb_query）
        from app.core.prometheus_metrics import record_total_duration
        intent_type = result.get("intent", {}).get("type", "kb_query")
        record_total_duration(intent_type, total_time_ms / 1000.0)

        # 7. 尝试生成历史摘要（记忆衰退机制）
        # 作用：当 turn_count 达到 SUMMARY_EVERY_N_TURNS 阈值时，用 LLM 压缩旧对话为摘要
        # 摘要生成失败不阻塞主流程（maybe_generate_summary 内部已 catch all）
        history_service.maybe_generate_summary(db, conversation)

        # 8. 返回结果
        response = {
            "answer": result["answer"],
            "sources": result["sources"],
            "conversation_id": conversation.id,
            "message_id": assistant_message.id,
            "degraded": result.get("degraded", False),
            "degrade_reason": result.get("degrade_reason"),
        }

        # 幂等性结果缓存（P0-7）
        # 作用：将首次处理结果缓存 10 分钟，后续相同 idempotency_key 的请求直接返回缓存
        # M-12 修复：缓存写入失败时记 warning 而非静默忽略，便于运维排查
        # 缓存失败不会影响本次响应，但后续相同 key 的请求会重复处理（降级为无缓存模式）
        if idempotency_result_key:
            cached = RedisManager.set(idempotency_result_key, response, ttl=600)
            if not cached:
                logger.warning(
                    f"幂等性结果缓存写入失败（user_id={current_user.id}, "
                    f"key={idempotency_result_key}），后续相同请求可能重复处理"
                )

        # L-14 修复：非流式成功后主动释放幂等锁（结果已缓存，锁无需保留到 TTL）
        # 作用：原实现锁依赖 TTL 过期释放（300s），成功后仍占用锁导致后续相同 key
        #       的请求在 300s 内被拒绝（返回 409）。成功路径应释放锁，由结果缓存
        #       承担幂等职责（后续相同 key 的请求会命中缓存直接返回）。
        if idempotency_lock_key and idempotency_lock_token:
            RedisManager.release_lock(idempotency_lock_key, idempotency_lock_token)

        return response

    except HTTPException:
        # FastAPI 异常正常传播
        raise
    except Exception:
        # 处理失败：释放幂等性锁，允许用户重试
        # 作用：异常时不缓存结果，释放锁让用户可以立即重试
        # H-2: 使用 release_lock 比对 token，防止误删他人锁
        if idempotency_lock_key and idempotency_lock_token:
            RedisManager.release_lock(idempotency_lock_key, idempotency_lock_token)
        raise


# ============================================
# 提问（流式 SSE）
# ============================================

@router.post(
    "/ask/stream",
    summary="提问（流式输出）",
    # 限流：每分钟最多 RATE_LIMIT_ASK_PER_MINUTE 次提问
    # 作用：与非流式接口共享限流配额，防止单用户高频调用 LLM
    dependencies=[Depends(rate_limit("ask", per_minute=settings.RATE_LIMIT_ASK_PER_MINUTE))],
)
async def ask_question_stream(
    question_data: QuestionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> StreamingResponse:
    """
    提问接口（流式输出）

    作用：
        流式返回 AI 的回答，实现打字机效果。
        使用 SSE（Server-Sent Events）协议。
        完成后记录全链路质量埋点。

    实现方式：
        1. 幂等性检查（可选，防止重复提交）
        2. 创建或获取对话
        3. 保存用户问题并提交事务（释放 DB 连接供 LLM 调用期间使用）
        4. 获取有效历史（含历史摘要，记忆衰退机制）
        5. 通过 StreamingResponse 发送数据块
        6. 流结束后保存 AI 回答 + 更新对话轮数 + 记录 QAEvent 埋点
        7. 尝试生成历史摘要（达到阈值时触发）

    请求体：
        {
            "question": "如何使用异步编程？",
            "conversation_id": null,
            "stream": true,
            "idempotency_key": "req-abc-123"
        }

    响应：
        SSE 格式，每行一个事件：
        data: {"type": "sources", "content": [...]}

        data: {"type": "chunk", "content": "异步"}

        data: {"type": "chunk", "content": "编程"}

        data: {"type": "done", "content": "完整回答...", "metrics": {...}}
    """
    import time as _time
    from app.services.qa_event_service import qa_event_service
    from app.services.history_service import history_service
    from app.services.intent_service import intent_service

    # 总耗时计时起点
    total_start = _time.time()

    # 0. 幂等性检查（P0-7：流式接口仅防止并发重复，不支持返回缓存）
    # 作用：防止前端重复提交导致并发的流式 LLM 调用
    idempotency_key = question_data.idempotency_key
    idempotency_lock_key = None
    idempotency_lock_token = None  # H-2: 锁唯一标识
    if idempotency_key:
        idempotency_lock_key = RedisKeys.idempotency_lock(
            current_user.id, idempotency_key
        )
        # H-2 修复：使用 acquire_lock 获取唯一 token
        # L-1 修复：TTL 使用配置项 IDEMPOTENCY_LOCK_TTL，必须 > LLM_TIMEOUT
        idempotency_lock_token = RedisManager.acquire_lock(idempotency_lock_key, ttl=settings.IDEMPOTENCY_LOCK_TTL)
        if idempotency_lock_token is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": {"code": "DUPLICATE_REQUEST", "message": "请求正在处理中，请勿重复提交"}},
            )

    # C-2 修复：同步代码异常时释放幂等锁，防止锁泄漏
    # 作用：原实现锁释放在 event_stream() 的 finally，但生成器未被迭代时
    #       （同步代码抛异常）finally 不执行，锁泄漏 300 秒
    # 修复：用 try/except 包裹同步代码，异常时主动释放锁后再 raise
    try:
        # 1. 创建或获取对话
        conversation = _get_or_create_conversation(
            db=db,
            user_id=current_user.id,
            conversation_id=question_data.conversation_id,
            title=question_data.question[:20]
        )

        # 2. 保存用户问题
        user_message = Message(
            conversation_id=conversation.id,
            role="user",
            content=question_data.question,
        )
        db.add(user_message)
        # P0-4 修复：在调用 LLM 前提交用户消息，释放 DB 事务
        # 作用：原实现 db.flush() 仅发送 SQL 不提交事务，LLM 流式调用（数秒~数十秒）
        #       期间事务持续打开，导致连接池耗尽和 idle_in_transaction_session_timeout 超时
        # 修复：改为 db.commit() 提交事务释放连接，LLM 流式调用期间 DB 空闲
        db.commit()
        db.refresh(user_message)  # 刷新获取自增 ID
        db.refresh(conversation)  # 刷新 conversation

        # 3. 获取有效对话历史（记忆衰退机制）
        # 作用：history_service 返回 (近期历史, 历史摘要)
        #   - 近期历史：最近 N 轮完整对话
        #   - 历史摘要：旧对话压缩后的摘要（可能为 None）
        # summary 会注入到 LLM 消息中作为长期上下文，避免旧对话信息丢失
        history, summary = history_service.get_effective_history(
            db, conversation, exclude_message_id=user_message.id
        )

        # 3.5 意图切换检测
        # 作用：检测用户是否相对于最近一次提问切换了话题
        #   - 切换时：summary 置 None（不注入旧摘要污染检索），intent_switched=True 传给 RAG
        #   - 未切换：正常使用 summary，intent_switched=False
        # 检测策略：Embedding 余弦相似度为主，关键词 Jaccard 为辅，失败保守不切换
        # 日志：意图切换的详细信息在 intent_service.detect_intent_switch 内部已记录
        intent_result = intent_service.detect_intent_switch(
            question_data.question, history
        )
        effective_summary = None if intent_result.switched else summary
    except Exception:
        # C-2: 同步代码异常时释放幂等锁，允许用户立即重试
        # 作用：避免锁泄漏 300 秒阻塞后续相同 idempotency_key 的请求
        # H-2: 使用 release_lock 比对 token
        if idempotency_lock_key and idempotency_lock_token:
            RedisManager.release_lock(idempotency_lock_key, idempotency_lock_token)
        raise

    # 4. 定义流式生成器
    async def event_stream():
        """
        SSE 事件生成器

        作用：
            生成 SSE 格式的事件流，发送给前端。
            流结束后保存 AI 回答、更新对话轮数、记录 QAEvent 埋点，
            并尝试生成历史摘要。

        实现方式：
            - 调用 RAG 服务的 ask_stream 方法（传入 summary 实现记忆衰退）
            - 将每个数据块转为 SSE 格式
            - done 事件携带 metrics
            - 最后保存完整的 AI 回答到数据库 + 更新 turn_count + 记录质量埋点
            - 调用 maybe_generate_summary 触发摘要生成（达到阈值时）
            - 异常时保存已累积的部分回答（P1-10），并释放幂等性锁
        """
        full_answer = ""
        sources = []
        degraded = False
        degrade_reason = None
        metrics = {}
        # 意图类型（默认 kb_query，无检索路径会从 sources 事件中更新）
        intent_type = "kb_query"

        try:
            # 懒加载 RAG 服务
            from app.services.rag_chain import get_rag_chain
            rag_chain = get_rag_chain()

            # 流式调用 RAG（传入 user_id 限定检索范围，防止越权）
            # 传入 effective_summary 让 LLM 获取历史摘要，实现记忆衰退
            # 传入 intent_switched 让 RAG 调整 query 改写和 LLM 提示
            # P0-4：此时 DB 事务已关闭，LLM 流式调用期间不会占用 DB 连接
            async for chunk in rag_chain.ask_stream(
                question=question_data.question,
                conversation_history=history,
                user_id=current_user.id,
                summary=effective_summary,
                intent_switched=intent_result.switched,
            ):
                # 转为 SSE 格式
                # 格式：data: {json}\n\n
                sse_data = f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
                yield sse_data

                # 累积完整回答和降级标记
                if chunk["type"] == "chunk":
                    full_answer += chunk["content"]
                elif chunk["type"] == "sources":
                    sources = chunk["content"]
                    # 提取意图类型（无检索路径在 sources 事件中携带 intent 信息）
                    if "intent" in chunk:
                        intent_type = chunk["intent"].get("type", "kb_query")
                elif chunk["type"] == "done":
                    # done 事件携带权威的完整回答（含兜底文本）
                    full_answer = chunk["content"]
                    degraded = chunk.get("degraded", False)
                    degrade_reason = chunk.get("degrade_reason")
                    metrics = chunk.get("metrics", {})

            # 5. 保存完整的 AI 回答到数据库（含降级标记）+ 更新对话轮数
            # 作用：turn_count +1 用于记忆衰退判断（达到阈值时触发摘要生成）
            assistant_message = Message(
                conversation_id=conversation.id,
                role="assistant",
                content=full_answer,
                sources=sources,
                is_degraded=degraded,
                degrade_reason=degrade_reason,
            )
            db.add(assistant_message)
            # C-3 修复：原子递增 turn_count，避免并发丢失更新
            _increment_turn_count(db, conversation.id)
            db.commit()
            db.refresh(assistant_message)
            db.refresh(conversation)  # 同步 turn_count 内存值，供 maybe_generate_summary 使用

            # 6. 记录 QA 事件质量埋点
            # 作用：将全链路指标持久化到 qa_events 表
            # 埋点失败不影响主流程（qa_event_service 内部已 catch all）
            total_time_ms = int((_time.time() - total_start) * 1000)
            qa_event_service.record_event(
                db=db,
                message_id=assistant_message.id,
                conversation_id=conversation.id,
                user_id=current_user.id,
                question=question_data.question,
                answer=full_answer,
                metrics=metrics,
                degraded=degraded,
                degrade_reason=degrade_reason,
                total_time_ms=total_time_ms,
            )

            # 6.5 Prometheus 指标：记录总处理耗时（含 DB 操作）
            # 作用：监控流式问答的端到端耗时
            from app.core.prometheus_metrics import record_total_duration
            record_total_duration(intent_type, total_time_ms / 1000.0)

            # 7. 尝试生成历史摘要（记忆衰退机制）
            # 作用：当 turn_count 达到 SUMMARY_EVERY_N_TURNS 阈值时，用 LLM 压缩旧对话为摘要
            # 摘要生成失败不阻塞主流程（maybe_generate_summary 内部已 catch all）
            history_service.maybe_generate_summary(db, conversation)

        except Exception:
            # P1-10 修复：保存已累积的部分回答，避免用户重试时上下文丢失
            # 作用：流式输出中途异常时，已生成的部分回答仍有参考价值，持久化到数据库
            #       标记为降级回复（degrade_reason=stream_error），便于后续质量分析
            # P1-15 修复：异常信息脱敏，不向客户端暴露内部错误详情（如 DB 连接串、堆栈等）
            # 原实现 "content": str(e) 会泄露内部异常信息，存在信息泄露风险
            logger.exception("流式问答处理异常，保存部分回答")

            # 保存部分回答（仅当有实际内容时）
            if full_answer.strip():
                try:
                    partial_message = Message(
                        conversation_id=conversation.id,
                        role="assistant",
                        content=full_answer,
                        sources=sources,
                        is_degraded=True,
                        degrade_reason="stream_error",
                    )
                    db.add(partial_message)
                    # C-3 修复：原子递增 turn_count（异常保存路径）
                    _increment_turn_count(db, conversation.id)
                    db.commit()
                except Exception:
                    # 保存部分回答失败也不影响错误事件发送
                    db.rollback()

            # 发送脱敏的错误事件（不暴露内部异常详情）
            error_data = {
                "type": "error",
                "content": "抱歉，回答生成过程中出现错误，请稍后重试",
            }
            yield f"data: {json.dumps(error_data, ensure_ascii=False)}\n\n"

        finally:
            # M-10 修复：客户端断开连接时确保 db session 清理
            # 作用：流式响应中客户端断开会触发 GeneratorExit，此时可能存在未提交的事务
            #       若不 rollback，dirty session 被 get_db 依赖 close 时可能残留事务，
            #       导致连接池连接泄漏或 PostgreSQL idle_in_transaction 超时
            # 实现：rollback 安全（无活动事务时是 no-op），不影响已 commit 的数据
            try:
                db.rollback()
            except Exception:
                pass  # session 已关闭或无效，忽略

            # 释放幂等性锁（P0-7）
            # 作用：流式处理完成（无论成功或失败）后释放锁，允许后续请求
            # H-2: 使用 release_lock 比对 token，防止误删他人锁
            if idempotency_lock_key and idempotency_lock_token:
                RedisManager.release_lock(idempotency_lock_key, idempotency_lock_token)

    # 8. 返回流式响应
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",  # SSE 的 MIME 类型
        headers={
            "Cache-Control": "no-cache",  # 禁用缓存
            "Connection": "keep-alive",   # 保持连接
            "X-Accel-Buffering": "no",    # Nginx 禁用缓冲
        }
    )


# ============================================
# 辅助函数
# ============================================

def _increment_turn_count(db: Session, conversation_id: int) -> None:
    """
    原子递增对话轮数（C-3 修复）

    作用：
        使用 SQL UPDATE 原子递增 turn_count，避免 read-modify-write 竞态。
        原实现 `conversation.turn_count += 1` 在并发请求下会丢失更新
        （两个请求读到相同值，各自 +1 后写回，只增加 1 而非 2），
        导致记忆衰退机制（摘要生成时机）失效。

    实现方式：
        UPDATE conversations SET turn_count = turn_count + 1 WHERE id = :id
        数据库行锁保证原子性，并发请求各自 +1 不会丢失。

    注意：
        此方法不内部 commit，由调用方在适当时机 commit，
        以保证 turn_count 递增与消息保存的事务原子性。

    参数：
        db: Session - 数据库会话
        conversation_id: int - 对话ID

    使用示例：
        db.add(assistant_message)
        _increment_turn_count(db, conversation.id)
        db.commit()  # 一起提交消息和 turn_count
        db.refresh(conversation)  # 同步内存值供 maybe_generate_summary 使用
    """
    db.execute(
        update(Conversation)
        .where(Conversation.id == conversation_id)
        .values(turn_count=Conversation.turn_count + 1)
    )


def _get_or_create_conversation(
    db: Session,
    user_id: int,
    conversation_id: Optional[int],
    title: str
) -> Conversation:
    """
    获取或创建对话

    作用：
        如果提供了 conversation_id，则获取已有对话；
        否则创建新对话。

    参数：
        db: Session - 数据库会话
        user_id: int - 用户ID
        conversation_id: Optional[int] - 对话ID
        title: str - 新对话的标题

    返回：
        Conversation - 对话对象
    """
    if conversation_id:
        # 获取已有对话
        conversation = db.query(Conversation).filter(
            Conversation.id == conversation_id,
            Conversation.user_id == user_id,
            Conversation.is_active == True
        ).first()

        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"error": {"code": "CONVERSATION_NOT_FOUND", "message": "对话不存在"}}
            )
        return conversation
    else:
        # 创建新对话
        conversation = Conversation(
            user_id=user_id,
            title=title,
        )
        db.add(conversation)
        db.commit()
        db.refresh(conversation)
        return conversation


# ============================================
# 获取对话列表
# ============================================

@router.get(
    "/conversations",
    response_model=ConversationListResponse,
    summary="获取对话列表"
)
def list_conversations(
    # M-7 修复：新增分页参数，防止用户对话过多时全量返回导致性能问题
    # 作用：原实现 .all() 全量返回，对话数多时消耗内存和带宽
    page: int = Query(default=1, ge=1, description="页码，从 1 开始"),
    page_size: int = Query(default=20, ge=1, le=100, description="每页数量，1-100"),
    # D4-02 游标分页：可选 cursor 参数，传入时使用游标分页（向后兼容 offset/limit）
    # 作用：大数据量时避免 offset 深翻页性能退化
    cursor: Optional[int] = Query(
        None, ge=1, description="游标（上一页最后一条对话ID，传入时使用游标分页）"
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    获取用户的对话列表（分页 + 游标分页）

    作用：
        返回当前用户的对话列表，按最后更新时间倒序，支持分页。
        传入 cursor 参数时使用游标分页（向后兼容 offset/limit）。

    查询参数：
        - page: 页码，默认 1（cursor 模式下忽略）
        - page_size: 每页数量，默认 20，最大 100
        - cursor: 游标（可选，传入时使用游标分页）

    响应（200）：
        {
            "items": [...],
            "total": 100,
            "page": 1,
            "page_size": 20,
            "next_cursor": null
        }
    """
    query = db.query(Conversation).filter(
        Conversation.user_id == current_user.id,
        Conversation.is_active == True
    )

    total = query.count()

    # D4-02 游标分页：传入 cursor 时使用游标分页，否则保持 offset/limit（向后兼容）
    next_cursor = None
    if cursor:
        # 游标分页：WHERE id < cursor ORDER BY id DESC LIMIT page_size
        query = query.filter(Conversation.id < cursor)
        conversations = (
            query.order_by(Conversation.id.desc())
            .limit(page_size)
            .all()
        )
        if len(conversations) == page_size:
            next_cursor = conversations[-1].id
    else:
        # M-7 修复：分页查询，避免全量加载
        offset = (page - 1) * page_size
        conversations = (
            query.order_by(Conversation.updated_at.desc())
            .offset(offset)
            .limit(page_size)
            .all()
        )

    return {
        "items": conversations,
        "total": total,
        "page": page,
        "page_size": page_size,
        "next_cursor": next_cursor,
    }


# ============================================
# 获取对话详情
# ============================================

@router.get(
    "/conversations/{conversation_id}",
    response_model=ConversationResponse,
    summary="获取对话详情"
)
def get_conversation(
    # L-4 修复：路径参数正整数校验，防止 conversation_id=0 或负数导致异常查询
    conversation_id: int = Path(..., ge=1, description="对话ID（正整数）"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    获取对话详情（包含所有消息）

    作用：
        返回指定对话的详细信息，包括所有历史消息。
        用于前端回溯对话历史。

    路径参数：
        - conversation_id: 对话ID

    错误：
        404: 对话不存在
    """
    conversation = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id,
        Conversation.is_active == True
    ).first()

    if not conversation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "CONVERSATION_NOT_FOUND", "message": "对话不存在"}}
        )

    return conversation


# ============================================
# 删除对话
# ============================================

@router.delete(
    "/conversations/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除对话"
)
def delete_conversation(
    # L-4 修复：路径参数正整数校验，防止 conversation_id=0 或负数导致异常查询
    conversation_id: int = Path(..., ge=1, description="对话ID（正整数）"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    """
    删除对话（软删除）

    作用：
        将对话标记为非活跃（is_active=False），不真正删除数据。
        这样可以保留数据用于审计。

    路径参数：
        - conversation_id: 对话ID
    """
    conversation = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id
    ).first()

    if not conversation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "CONVERSATION_NOT_FOUND", "message": "对话不存在"}}
        )

    # 软删除
    conversation.is_active = False
    db.commit()
