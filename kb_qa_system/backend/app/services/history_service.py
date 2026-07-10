"""
对话历史摘要服务（记忆衰退机制）

作用：
    当对话历史过长时，用 LLM 把旧对话压缩为摘要，只保留近期对话的完整内容。
    这样既能保留长期上下文（通过摘要），又能控制 Token 消耗（避免历史无限增长）。

    记忆衰退策略：
        对话历史 = [历史摘要] + [最近 N 轮完整对话]
        - 历史摘要：每 SUMMARY_EVERY_N_TURNS 轮生成一次，涵盖之前的所有对话
        - 最近 N 轮：完整保留，确保近期上下文精确

    为何需要记忆衰退：
        1. LLM 上下文窗口有限（如 8K/32K Token），历史无限增长会超出窗口
        2. 旧对话的细节通常不重要，摘要保留关键信息即可
        3. 减少每次调用的 Token 消耗，降低成本

实现方式：
    1. maybe_generate_summary: 判断是否需要生成摘要，需要则调用 LLM
    2. get_effective_history: 返回摘要 + 近期消息，供 RAG 使用
    3. 摘要生成失败不阻塞问答（降级为仅截断）

使用方式：
    from app.services.history_service import history_service

    # 在问答前获取有效历史
    history, summary = history_service.get_effective_history(db, conversation)

    # 在问答后判断是否需要生成摘要
    history_service.maybe_generate_summary(db, conversation)
"""

import logging
from typing import List, Dict, Tuple, Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.conversation import Conversation, Message

logger = logging.getLogger(__name__)


class HistorySummaryService:
    """
    对话历史摘要服务

    作用：
        管理对话历史的记忆衰退：定期生成摘要，返回摘要+近期消息。

    设计原则：
        1. 摘要生成是"尽力而为"——失败不阻塞问答
        2. 摘要生成使用独立的 LLM 调用（不走 RAG，直接调用 LLM）
        3. 摘要只覆盖"已过期的"旧消息，近期消息保留完整
    """

    # 摘要生成的 Prompt
    # 作用：引导 LLM 生成结构化的对话摘要
    _SUMMARY_PROMPT = (
        "请将以下对话历史压缩为一段简洁的摘要，保留：\n"
        "1. 用户的核心需求和关注点\n"
        "2. 已讨论的关键结论和决定\n"
        "3. 重要的人名、地名、技术术语\n"
        "4. 未解决的问题或待办事项\n\n"
        "要求：\n"
        "- 用简洁的陈述句，不要用对话格式\n"
        "- 保留关键细节，省略寒暄和重复内容\n"
        "- 不超过 500 字\n\n"
        "对话历史：\n{conversation_text}"
    )

    def get_effective_history(
        self,
        db: Session,
        conversation: Conversation,
        exclude_message_id: Optional[int] = None,
    ) -> Tuple[List[Dict[str, str]], Optional[str]]:
        """
        获取有效对话历史（摘要 + 近期消息）

        作用：
            根据记忆衰退策略，返回适合传给 LLM 的历史：
            - 如果有摘要：摘要覆盖旧对话，再附加最近 N 轮完整消息
            - 如果无摘要：直接返回最近 N 轮消息
            - Token 超限时截断（兜底保护）

        实现方式：
            1. 查询对话的所有消息（排除当前消息）
            2. 取最近 CONVERSATION_HISTORY_LIMIT 条消息作为"近期历史"
            3. 返回 (近期历史, 摘要)

        参数：
            db: Session - 数据库会话
            conversation: Conversation - 对话对象（含 summary 字段）
            exclude_message_id: Optional[int] - 要排除的消息 ID（当前用户消息）

        返回:
            Tuple[List[Dict[str, str]], Optional[str]]
            - 第一个元素：近期历史消息列表 [{role, content}, ...]
            - 第二个元素：历史摘要（无摘要时为 None）
        """
        # 查询所有消息（按时间排序）
        query = db.query(Message).filter(
            Message.conversation_id == conversation.id
        )
        if exclude_message_id:
            query = query.filter(Message.id != exclude_message_id)
        messages = query.order_by(Message.created_at).all()

        if not messages:
            return [], conversation.summary

        # 取最近 N 条消息作为近期历史
        # 作用：CONVERSATION_HISTORY_LIMIT 控制保留多少条完整消息
        limit = settings.CONVERSATION_HISTORY_LIMIT * 2  # *2 因为每轮有 user+assistant
        recent_messages = messages[-limit:] if len(messages) > limit else messages

        # 转为字典格式
        history = [
            {"role": msg.role, "content": msg.content}
            for msg in recent_messages
        ]

        # Token 数截断（兜底保护）
        # 作用：即使有摘要，近期历史仍可能超长（如回答很长），需要截断
        history = self._truncate_by_tokens(history)

        return history, conversation.summary

    def _truncate_by_tokens(
        self,
        history: List[Dict[str, str]],
    ) -> List[Dict[str, str]]:
        """
        按 Token 数截断历史

        作用：
            确保历史消息总 Token 数不超过 CONVERSATION_HISTORY_MAX_TOKENS。
            从最旧的消息开始移除，保留最新的。

        实现方式：
            1. 估算每条消息的 Token 数（粗略：字符数 / 1.5）
            2. 从后往前累加，超过阈值时截断前面的消息

        参数：
            history: List[Dict[str, str]] - 历史消息列表

        返回:
            List[Dict[str, str]] - 截断后的历史消息列表
        """
        if not history:
            return history

        max_tokens = settings.CONVERSATION_HISTORY_MAX_TOKENS
        total_tokens = 0
        keep_from_index = 0

        # 从最新消息往前累加，找到截断点
        for i in range(len(history) - 1, -1, -1):
            msg_tokens = max(1, int(len(history[i]["content"]) / 1.5))
            if total_tokens + msg_tokens > max_tokens:
                keep_from_index = i + 1
                break
            total_tokens += msg_tokens

        if keep_from_index > 0:
            logger.info(
                f"历史 Token 数超限，截断前 {keep_from_index} 条消息"
                f"（保留 {len(history) - keep_from_index} 条）"
            )
            history = history[keep_from_index:]

        return history

    def maybe_generate_summary(
        self,
        db: Session,
        conversation: Conversation,
    ) -> None:
        """
        判断是否需要生成摘要，需要则生成

        作用：
            检查对话轮数是否达到摘要阈值，达到则用 LLM 生成历史摘要。
            摘要生成失败不抛异常（只记日志），不影响主流程。

        实现方式：
            1. 检查 ENABLE_HISTORY_SUMMARY 开关
            2. 检查 turn_count 是否达到摘要条件
            3. 获取需要摘要的旧消息（摘要未覆盖的部分）
            4. 调用 LLM 生成摘要
            5. 更新 conversation.summary 和 summary_turn_count

        参数：
            db: Session - 数据库会话
            conversation: Conversation - 对话对象
        """
        # 检查开关
        if not settings.ENABLE_HISTORY_SUMMARY:
            return

        # 检查是否到达摘要阈值
        # 作用：每 SUMMARY_EVERY_N_TURNS 轮生成一次摘要
        # 例如 SUMMARY_EVERY_N_TURNS=5，则第 5、10、15... 轮时生成
        if conversation.turn_count < settings.SUMMARY_EVERY_N_TURNS:
            return

        # 检查是否已经为当前轮数生成过摘要
        # 作用：避免重复生成（summary_turn_count 记录摘要已覆盖到第几轮）
        if conversation.summary_turn_count >= conversation.turn_count:
            return

        try:
            # 获取需要摘要的消息
            # 作用：取摘要未覆盖的旧消息（排除最近几轮，保留完整）
            messages_to_summarize = self._get_messages_to_summarize(db, conversation)

            if not messages_to_summarize:
                return

            # 构建对话文本
            conversation_text = self._format_messages_for_summary(messages_to_summarize)

            # 调用 LLM 生成摘要
            new_summary = self._call_llm_for_summary(conversation_text, conversation.summary)

            if new_summary:
                # 更新对话摘要
                # M-15 修复：commit 失败时重试一次，仍失败则记录 warning 并保留摘要到日志
                #   作用：原实现 commit 失败直接 rollback，LLM 耗时生成的摘要永久丢失
                #         修复后：1) 重试一次 commit（瞬时连接断开可恢复）
                #                 2) 仍失败则记录摘要内容到日志（下次触发时可参考）
                #                 3) rollback 释放事务，不阻塞主流程
                conversation.summary = new_summary
                conversation.summary_turn_count = conversation.turn_count
                try:
                    db.commit()
                    logger.info(
                        f"对话 {conversation.id} 摘要已更新，"
                        f"覆盖到第 {conversation.turn_count} 轮"
                    )
                except Exception as commit_err:
                    # 首次 commit 失败，rollback 后重试一次
                    logger.warning(
                        f"对话 {conversation.id} 摘要 commit 首次失败: {commit_err}，尝试重试"
                    )
                    db.rollback()
                    try:
                        # 重新设置属性（rollback 后对象属性可能被 expire）
                        conversation.summary = new_summary
                        conversation.summary_turn_count = conversation.turn_count
                        db.commit()
                        logger.info(
                            f"对话 {conversation.id} 摘要 commit 重试成功，"
                            f"覆盖到第 {conversation.turn_count} 轮"
                        )
                    except Exception as retry_err:
                        # 重试仍失败：记录摘要内容到日志，下次触发时重新生成
                        logger.error(
                            f"对话 {conversation.id} 摘要 commit 重试也失败: {retry_err}，"
                            f"摘要内容（前500字）: {new_summary[:500]}"
                        )
                        db.rollback()

        except Exception as e:
            # 摘要生成失败不阻塞主流程
            # 作用：记忆衰退是优化项，失败时降级为仅截断
            logger.error(f"生成对话摘要失败（不影响主流程）: {e}", exc_info=True)
            db.rollback()

    def _get_messages_to_summarize(
        self,
        db: Session,
        conversation: Conversation,
    ) -> List[Message]:
        """
        获取需要摘要的消息（旧消息，排除最近几轮）

        作用：
            确定哪些消息需要被压缩为摘要。
            规则：取所有消息，排除最近 CONVERSATION_HISTORY_LIMIT 轮（保留完整）。

        参数：
            db: Session - 数据库会话
            conversation: Conversation - 对话对象

        返回:
            List[Message] - 需要摘要的旧消息列表
        """
        query = db.query(Message).filter(
            Message.conversation_id == conversation.id
        ).order_by(Message.created_at)

        all_messages = query.all()

        # 保留最近 N 轮完整，其余的需摘要
        # 作用：CONVERSATION_HISTORY_LIMIT * 2 因为每轮有 user+assistant 两条
        keep_recent = settings.CONVERSATION_HISTORY_LIMIT * 2
        if len(all_messages) <= keep_recent:
            # 消息不够多，不需要摘要
            return []

        return all_messages[:-keep_recent]

    def _format_messages_for_summary(self, messages: List[Message]) -> str:
        """
        将消息列表格式化为摘要 Prompt 用的文本

        作用：
            把 Message 对象列表转为 "用户: xxx\n助手: xxx" 格式的纯文本。

        参数：
            messages: List[Message] - 消息列表

        返回:
            str - 格式化的对话文本
        """
        lines = []
        for msg in messages:
            role_label = "用户" if msg.role == "user" else "助手"
            # 截断过长的单条消息
            content = msg.content[:500] if len(msg.content) > 500 else msg.content
            lines.append(f"{role_label}: {content}")

        return "\n".join(lines)

    def _call_llm_for_summary(
        self,
        conversation_text: str,
        existing_summary: Optional[str],
    ) -> Optional[str]:
        """
        调用 LLM 生成对话摘要

        作用：
            使用 LLMResilienceService 生成摘要，复用容错机制。
            如果已有旧摘要，将旧摘要和新对话一起传入，生成更新后的摘要。

        实现方式：
            1. 构建 Prompt（含旧摘要 + 新对话）
            2. 调用 LLMResilienceService.invoke
            3. 返回摘要文本

        参数：
            conversation_text: str - 需要摘要的对话文本
            existing_summary: Optional[str] - 已有的旧摘要（增量更新）

        返回:
            Optional[str] - 生成的摘要（失败返回 None）
        """
        from langchain_core.messages import HumanMessage, SystemMessage
        from app.services.llm_resilience import get_llm_service, LLMServiceError
        from app.core.circuit_breaker import CircuitBreakerOpenError

        # 构建 Prompt
        prompt_text = self._SUMMARY_PROMPT.format(conversation_text=conversation_text)

        # 如果有旧摘要，追加到 Prompt 中（增量更新）
        # 作用：让新摘要包含旧摘要中的关键信息
        if existing_summary:
            prompt_text = (
                f"已有的历史摘要：\n{existing_summary}\n\n"
                f"请结合以上摘要和以下新对话，生成更新后的摘要：\n\n"
                f"新对话：\n{conversation_text}"
            )

        messages = [
            SystemMessage(content="你是一个对话摘要助手，擅长提取关键信息。"),
            HumanMessage(content=prompt_text),
        ]

        try:
            llm_service = get_llm_service()
            summary = llm_service.invoke(messages)
            return summary.strip() if summary else None
        except (LLMServiceError, CircuitBreakerOpenError) as e:
            logger.warning(f"LLM 不可用，摘要生成跳过: {e}")
            return None
        except Exception as e:
            logger.error(f"调用 LLM 生成摘要失败: {e}", exc_info=True)
            return None


# ============================================
# 全局实例
# ============================================

history_service = HistorySummaryService()
