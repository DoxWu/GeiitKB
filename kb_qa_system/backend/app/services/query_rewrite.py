"""
Query 改写服务（指代消解 + 语义扩展）

作用：
    用 LLM 对用户问题进行改写，提升检索质量。解决多轮对话中的三类问题：

    1. 指代消解：
       用户问 "那个怎么样" → 结合历史改写为 "asyncio.gather 怎么样"
       原因：代词（那个/它/这个）在向量检索中无意义，需消解为具体内容

    2. 短query语义扩展：
       用户问 "asyncio" → 扩展为 "Python asyncio 异步编程 使用方法"
       原因：过短的query语义稀疏，向量检索召回质量差

    3. 延续性指令处理：
       用户问 "继续" → 从历史提取正在讨论的主题，补全为完整问题
       原因：延续性词汇本身无检索价值，需结合上下文重建检索意图

    改写后的 query 仅用于检索，原始 query 仍用于 LLM 生成（保持用户原意）。

降级策略：
    LLM 不可用、超时或改写失败时，返回原始 query，不影响主流程。

实现方式：
    QueryRewriteService.rewrite_query(query, history) 调用 LLMResilienceService
    对 query 进行改写，内部判断是否需要改写（无历史或已清晰则原样返回）。

使用方式：
    from app.services.query_rewrite import query_rewrite_service

    rewritten = query_rewrite_service.rewrite_query(query, conversation_history)
    # rewritten 用于检索，query 用于 LLM 生成
"""

import logging
from typing import List, Dict, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


class QueryRewriteService:
    """
    Query 改写服务

    作用：
        用 LLM 对用户问题进行指代消解和语义扩展，提升检索质量。

    设计原则：
        1. 只在需要时改写——无历史或 query 已清晰则原样返回，避免无谓延迟
        2. 改写仅用于检索——原始 query 仍用于 LLM 生成，保持用户原意
        3. 降级容错——LLM 不可用或超时返回原始 query，不阻塞主流程
        4. 快速预判——用规则快速判断是否需要改写，减少 LLM 调用

    使用方式：
        rewritten = query_rewrite_service.rewrite_query(query, history)
    """

    # Query 改写的 Prompt
    # 作用：引导 LLM 进行指代消解、语义扩展和延续性指令处理
    _REWRITE_PROMPT = (
        "你是一个查询改写助手。请根据对话历史，判断用户当前问题是否需要改写以提升检索效果。\n\n"
        "改写规则：\n"
        "1. 指代消解：如果问题包含'那个'、'它'、'这个'、'上面提到的'等代词，"
        "结合历史替换为具体内容\n"
        "2. 语义扩展：如果问题过短或语义稀疏，补充关键检索词（如技术名、领域名）\n"
        "3. 延续性指令：如果是'继续'、'然后呢'、'接着说'等，从历史提取正在讨论的主题，补全为完整问题\n"
        "4. 如果问题已经清晰完整，不需要改写，原样返回\n\n"
        "要求：\n"
        "- 只返回改写后的查询文本，不要解释，不要加引号\n"
        "- 改写后的查询应是完整的、可独立理解的问题\n"
        "- 保持用户的核心意图，不要引入历史中未提及的新话题\n\n"
        "对话历史：\n{history}\n\n"
        "用户当前问题：{query}"
    )

    # 延续性指令关键词
    # 作用：快速判断是否为延续性指令，这类指令必须结合历史才能检索
    _CONTINUATION_KEYWORDS = {
        "继续", "然后呢", "接着", "接着说", "还有呢", "继续说",
        "后来呢", "接下来", "go on", "continue", "然后", "之后呢",
    }

    # 代词关键词（用于快速判断是否需要指代消解）
    # 作用：包含这些词的 query 很可能需要结合历史消解指代
    _PRONOUN_KEYWORDS = {
        "那个", "这个", "它", "它们", "他", "她",
        "上面", "前面", "刚才", "之前", "那个东西", "这件事",
        "上述", "该", "此",
    }

    def rewrite_query(
        self,
        query: str,
        conversation_history: Optional[List[Dict[str, str]]] = None,
    ) -> str:
        """
        改写用户 query（指代消解 + 语义扩展）

        作用：
            根据对话历史判断是否需要改写，需要则用 LLM 改写。
            改写后的 query 用于检索，原始 query 仍用于 LLM 生成。

        实现方式：
            1. 检查 ENABLE_QUERY_REWRITE 开关
            2. 快速预判是否需要改写（无历史则跳过）
            3. 构建 Prompt（含历史和原始 query）
            4. 调用 LLM 改写（带超时降级）
            5. 校验改写结果，异常则返回原始 query

        参数：
            query: str - 用户原始问题
            conversation_history: Optional[List[Dict[str, str]]] - 对话历史
                格式：[{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]

        返回:
            str - 改写后的 query（用于检索）；无需改写或失败时返回原始 query
        """
        # 1. 检查开关
        if not settings.ENABLE_QUERY_REWRITE:
            return query

        # 2. 无历史则不需要改写（新对话没有指代问题）
        # 作用：首次提问无需改写，避免无谓的 LLM 调用
        if not conversation_history:
            return query

        # 3. 快速预判是否需要改写
        # 作用：避免对已清晰的 query 调用 LLM，减少延迟
        if not self._needs_rewrite(query):
            return query

        # 4. 构建 Prompt
        history_text = self._format_history_for_rewrite(conversation_history)
        prompt = self._REWRITE_PROMPT.format(
            history=history_text,
            query=query,
        )

        # 5. 调用 LLM 改写
        try:
            rewritten = self._call_llm_for_rewrite(prompt)
            if rewritten and rewritten.strip():
                rewritten = rewritten.strip().strip('"').strip("'")
                # 校验改写结果非空且与原始不同
                if rewritten and rewritten != query:
                    logger.info(
                        f"Query 改写：'{query[:50]}' → '{rewritten[:50]}'"
                    )
                    return rewritten
            # 改写结果为空或与原始相同，返回原始
            return query
        except Exception as e:
            logger.warning(f"Query 改写失败，使用原始 query: {e}")
            return query

    def _needs_rewrite(self, query: str) -> bool:
        """
        快速预判 query 是否需要改写

        作用：
            用规则快速判断，避免对已清晰的 query 调用 LLM。

        判断规则（满足任一即需要改写）：
            1. query 过短（< QUERY_REWRITE_MIN_LENGTH 字符）
            2. 包含延续性指令关键词（"继续"、"然后呢"等）
            3. 包含代词关键词（"那个"、"它"等）

        参数：
            query: str - 用户原始问题

        返回:
            bool - True 表示需要改写
        """
        # 过短 query 需要语义扩展
        if len(query) < settings.QUERY_REWRITE_MIN_LENGTH:
            return True

        query_lower = query.lower()

        # 延续性指令需要结合历史补全
        if any(kw in query_lower for kw in self._CONTINUATION_KEYWORDS):
            return True

        # 包含代词需要指代消解
        if any(kw in query for kw in self._PRONOUN_KEYWORDS):
            return True

        return False

    def _format_history_for_rewrite(
        self,
        conversation_history: List[Dict[str, str]],
    ) -> str:
        """
        格式化历史用于改写 Prompt

        作用：
            取最近 N 轮对话，格式化为 "用户: xxx\n助手: xxx" 文本。
            只取最近几轮，避免过多历史干扰改写判断。

        参数：
            conversation_history: List[Dict[str, str]] - 完整对话历史

        返回:
            str - 格式化的历史文本
        """
        # 只取最近 N 轮（每轮 = user + assistant，所以 *2）
        turns = settings.QUERY_REWRITE_HISTORY_TURNS
        recent = conversation_history[-(turns * 2):] if len(conversation_history) > turns * 2 else conversation_history

        lines = []
        for msg in recent:
            role_label = "用户" if msg["role"] == "user" else "助手"
            # 截断过长的单条消息，避免 Prompt 膨胀
            content = msg["content"][:300] if len(msg["content"]) > 300 else msg["content"]
            lines.append(f"{role_label}: {content}")

        return "\n".join(lines) if lines else "（无历史）"

    def _call_llm_for_rewrite(self, prompt: str) -> Optional[str]:
        """
        调用 LLM 进行 query 改写

        作用：
            使用 LLMResilienceService 调用 LLM，复用容错机制。
            设置较短超时，避免改写拖慢检索响应。

        实现方式：
            1. 构建 LangChain 消息
            2. 调用 llm_service.invoke
            3. 返回改写结果

        参数：
            prompt: str - 改写 Prompt

        返回:
            Optional[str] - 改写后的 query（失败返回 None）
        """
        from langchain_core.messages import HumanMessage, SystemMessage
        from app.services.llm_resilience import get_llm_service, LLMServiceError
        from app.core.circuit_breaker import CircuitBreakerOpenError

        messages = [
            SystemMessage(content="你是一个查询改写助手，只返回改写后的查询，不要解释。"),
            HumanMessage(content=prompt),
        ]

        try:
            llm_service = get_llm_service()
            result = llm_service.invoke(messages)
            return result if result else None
        except (LLMServiceError, CircuitBreakerOpenError) as e:
            # LLM 不可用或熔断，降级为原始 query
            logger.warning(f"LLM 不可用，Query 改写跳过: {e}")
            return None
        except Exception as e:
            logger.error(f"Query 改写 LLM 调用失败: {e}", exc_info=True)
            return None


# ============================================
# 全局实例
# ============================================

# 作用：全局单例，无状态可安全复用
query_rewrite_service = QueryRewriteService()
