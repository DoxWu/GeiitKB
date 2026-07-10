"""
检索结果矛盾检测服务

作用：
    检测 RAG 检索到的多个文档片段之间是否存在内容矛盾，避免 LLM 基于冲突信息
    生成不可靠的回答。

    为何需要矛盾检测：
        1. 知识库可能包含过时文档与新版文档，两者对同一问题给出不同结论
        2. 不同来源的文档可能存在数据冲突（如一个说"支持100并发"，另一个说"最大50"）
        3. LLM 面对矛盾信息时可能随机选择一方，导致回答不稳定
        4. 检测到矛盾后，应告知 LLM 谨慎处理（指出差异或说明来源），而非随意选择

    检测策略：
        用 LLM 判断检索结果之间是否存在内容矛盾。LLM 返回结构化 JSON，
        包含是否矛盾、冲突片段对、矛盾描述。

    处理策略（检测到矛盾时）：
        1. 在 _build_context 中标记冲突片段（[⚠️与其他片段存在矛盾]）
        2. 在 Prompt 中注入矛盾提示，让 LLM 指出差异而非随意选择
        3. 在返回结果中携带冲突信息，供前端展示警告

降级策略：
    - 检索结果少于 2 条 → 跳过检测（无矛盾可能）
    - LLM 不可用（熔断/超时）→ 跳过检测，正常生成
    - LLM 返回格式异常 → 跳过检测，记录警告

实现方式：
    ConflictDetector.detect_conflicts(query, search_results) 返回 ConflictResult，
    包含 has_conflict/conflicting_pairs/description/skipped 字段。

使用方式：
    from app.services.conflict_detector import conflict_detector

    result = conflict_detector.detect_conflicts(query, search_results)
    if result.has_conflict:
        logger.warning(f"检测到矛盾: {result.description}")
"""

import json
import logging
import re
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Tuple

from app.core.config import settings

logger = logging.getLogger(__name__)


# ============================================
# 矛盾检测结果数据类
# ============================================

@dataclass
class ConflictResult:
    """
    矛盾检测结果

    作用：
        封装矛盾检测的结果，供 rag_chain 据此调整上下文构建和 Prompt。

    字段：
        has_conflict: bool - 是否检测到内容矛盾
            True: 存在矛盾片段，需在 Prompt 中注入冲突提示
            False: 无矛盾或检测被跳过
        conflicting_pairs: List[Tuple[int, int]] - 冲突片段的索引对（0-based）
            如 [(0, 2), (1, 3)] 表示片段0与片段2矛盾、片段1与片段3矛盾
            无矛盾时为空列表
        description: str - 矛盾描述（LLM 生成）
            无矛盾或检测被跳过时为空字符串
        skipped: bool - 是否跳过检测
            True: 因结果太少或 LLM 不可用而跳过
            False: 已执行检测
    """
    has_conflict: bool
    conflicting_pairs: List[Tuple[int, int]] = field(default_factory=list)
    description: str = ""
    skipped: bool = False


# ============================================
# 矛盾检测服务
# ============================================

class ConflictDetector:
    """
    检索结果矛盾检测服务

    作用：
        用 LLM 判断多个检索片段之间是否存在内容矛盾。

    设计原则：
        1. 谨慎判定——只在明确矛盾时标记，避免误判互补信息为矛盾
        2. 结构化输出——LLM 返回 JSON，包含冲突对和描述
        3. 降级容错——LLM 不可用或格式异常时跳过，不阻塞主流程
        4. 控制成本——片段过多时截断，避免 Prompt 膨胀
    """

    # 矛盾检测的 Prompt
    # 作用：引导 LLM 判断片段间是否存在内容矛盾，返回结构化 JSON
    _CONFLICT_PROMPT = (
        "你是一个内容矛盾检测助手。请判断以下检索到的文档片段之间是否存在内容矛盾。\n\n"
        "判断标准（构成矛盾）：\n"
        "1. 两个片段对同一事实给出不同结论（如一个说A，另一个说非A）\n"
        "2. 两个片段的数字/数据明显冲突（如一个说100，另一个说200）\n"
        "3. 两个片段的建议相互矛盾（如一个推荐方案X，另一个说方案X不可行）\n\n"
        "不构成矛盾的情况：\n"
        "1. 片段讨论不同主题（只是不相关，不矛盾）\n"
        "2. 片段是同一主题的不同方面（互补，不矛盾）\n"
        "3. 片段是同一信息的不同表述（语义相同，不矛盾）\n\n"
        "用户问题：{query}\n\n"
        "文档片段：\n{fragments}\n\n"
        "请返回 JSON 格式（只返回JSON，不要其他文字）：\n"
        '{{\n'
        '    "has_conflict": true/false,\n'
        '    "conflicting_pairs": [[1, 2]],\n'
        '    "description": "矛盾描述（如有）"\n'
        '}}\n'
        "注意：conflicting_pairs 中的编号从1开始，对应上面的片段编号。"
    )

    # 单个片段的最大字符数（控制 Prompt 长度）
    # 作用：避免片段过长导致 Prompt 膨胀，截断保留前部分内容
    _MAX_FRAGMENT_LENGTH = 500

    # 参与检测的最大片段数
    # 作用：片段过多时 LLM 判断质量下降，且 Token 消耗大，限制为前 N 条
    _MAX_FRAGMENTS_TO_CHECK = 5

    def detect_conflicts(
        self,
        query: str,
        search_results: List[Dict[str, Any]],
    ) -> ConflictResult:
        """
        检测检索结果之间的内容矛盾

        作用：
            用 LLM 判断多个文档片段是否存在矛盾，返回结构化检测结果。

        实现方式：
            1. 快速预判：结果少于 2 条跳过
            2. 构建 Prompt（含用户问题和片段内容）
            3. 调用 LLM 检测（带降级容错）
            4. 解析 LLM 返回的 JSON
            5. 构造 ConflictResult

        参数：
            query: str - 用户问题（用于判断矛盾的上下文）
            search_results: List[Dict[str, Any]] - 检索结果
                格式：[{"content": "...", "metadata": {...}, "score": 0.95}, ...]

        返回:
            ConflictResult - 检测结果
        """
        # 0. 检查开关
        # 作用：允许通过配置关闭矛盾检测（如 LLM 成本敏感场景）
        if not settings.ENABLE_CONFLICT_DETECTION:
            return ConflictResult(
                has_conflict=False, skipped=True, description=""
            )

        # 1. 快速预判：结果少于 2 条无需检测
        # 作用：单个片段不存在"矛盾"概念
        if not search_results or len(search_results) < 2:
            return ConflictResult(
                has_conflict=False, skipped=True, description=""
            )

        # 2. 构建 Prompt
        fragments_text = self._format_fragments_for_detection(search_results)
        prompt = self._CONFLICT_PROMPT.format(
            query=query[:200],  # 截断 query 避免过长
            fragments=fragments_text,
        )

        # 3. 调用 LLM 检测
        try:
            llm_response = self._call_llm_for_detection(prompt)
            if llm_response is None:
                # LLM 不可用，跳过检测
                return ConflictResult(
                    has_conflict=False, skipped=True, description=""
                )

            # 4. 解析 LLM 返回的 JSON
            parsed = self._parse_conflict_response(llm_response)
            if parsed is None:
                # JSON 解析失败，跳过检测
                logger.warning("矛盾检测 LLM 返回格式异常，跳过检测")
                return ConflictResult(
                    has_conflict=False, skipped=True, description=""
                )

            has_conflict = parsed.get("has_conflict", False)
            conflicting_pairs = parsed.get("conflicting_pairs", [])
            description = parsed.get("description", "")

            # 转换冲突对索引：LLM 返回 1-based，转为 0-based
            # 作用：内部统一用 0-based 索引访问 search_results
            normalized_pairs = self._normalize_pairs(conflicting_pairs, len(search_results))

            if has_conflict and normalized_pairs:
                logger.info(
                    f"检测到内容矛盾：{len(normalized_pairs)} 对冲突，"
                    f"描述：{description[:100]}"
                )

            return ConflictResult(
                has_conflict=has_conflict,
                conflicting_pairs=normalized_pairs,
                description=description,
                skipped=False,
            )

        except Exception as e:
            logger.warning(f"矛盾检测异常，跳过检测: {e}")
            return ConflictResult(
                has_conflict=False, skipped=True, description=""
            )

    # ============================================
    # 辅助方法：格式化片段
    # ============================================

    def _format_fragments_for_detection(
        self,
        search_results: List[Dict[str, Any]],
    ) -> str:
        """
        格式化检索片段用于矛盾检测 Prompt

        作用：
            将检索结果转为带编号的文本片段，供 LLM 判断矛盾。
            限制参与检测的片段数和单片段长度，控制 Token 消耗。

        参数：
            search_results: List[Dict[str, Any]] - 检索结果

        返回:
            str - 格式化的片段文本，如：
                [片段1] Python支持异步编程...
                [片段2] Java的并发机制...
        """
        # 限制参与检测的片段数
        # 作用：片段过多时 LLM 判断质量下降，且 Token 消耗大
        fragments_to_check = search_results[:self._MAX_FRAGMENTS_TO_CHECK]

        lines = []
        for index, result in enumerate(fragments_to_check, 1):
            content = result.get("content", "")
            # 截断过长的片段
            # 作用：控制单片段长度，避免 Prompt 膨胀
            if len(content) > self._MAX_FRAGMENT_LENGTH:
                content = content[:self._MAX_FRAGMENT_LENGTH] + "..."
            lines.append(f"[片段{index}] {content}")

        return "\n\n".join(lines)

    # ============================================
    # 辅助方法：调用 LLM
    # ============================================

    def _call_llm_for_detection(self, prompt: str) -> Optional[str]:
        """
        调用 LLM 进行矛盾检测

        作用：
            使用 LLMResilienceService 调用 LLM，复用容错机制。
            LLM 不可用或熔断时返回 None，触发降级。

        参数：
            prompt: str - 矛盾检测 Prompt

        返回:
            Optional[str] - LLM 返回的 JSON 字符串（失败返回 None）
        """
        from langchain_core.messages import HumanMessage, SystemMessage
        from app.services.llm_resilience import get_llm_service, LLMServiceError
        from app.core.circuit_breaker import CircuitBreakerOpenError

        messages = [
            SystemMessage(content="你是一个内容矛盾检测助手，只返回JSON格式结果。"),
            HumanMessage(content=prompt),
        ]

        try:
            llm_service = get_llm_service()
            result = llm_service.invoke(messages)
            return result if result else None
        except (LLMServiceError, CircuitBreakerOpenError) as e:
            # LLM 不可用或熔断，降级跳过检测
            logger.debug(f"LLM 不可用，矛盾检测跳过: {e}")
            return None
        except Exception as e:
            logger.error(f"矛盾检测 LLM 调用失败: {e}", exc_info=True)
            return None

    # ============================================
    # 辅助方法：解析 LLM 返回
    # ============================================

    def _parse_conflict_response(self, response: str) -> Optional[Dict[str, Any]]:
        """
        解析 LLM 返回的矛盾检测 JSON

        作用：
            LLM 可能返回带 Markdown 代码块包裹的 JSON，或包含多余文字。
            本方法提取并解析 JSON，容错处理常见格式问题。

        实现方式：
            1. 尝试直接 json.loads
            2. 失败则用正则提取 ```json ... ``` 代码块
            3. 再失败则用正则提取第一个 { ... } 块
            4. 都失败返回 None

        参数：
            response: str - LLM 返回的原始文本

        返回:
            Optional[Dict[str, Any]] - 解析后的字典（失败返回 None）
        """
        if not response:
            return None

        response = response.strip()

        # 1. 尝试直接解析
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            pass

        # 2. 提取 ```json ... ``` 代码块
        # 作用：LLM 常用 Markdown 代码块包裹 JSON
        code_block_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', response, re.DOTALL)
        if code_block_match:
            try:
                return json.loads(code_block_match.group(1))
            except json.JSONDecodeError:
                pass

        # 3. 提取第一个 { ... } 块
        # 作用：LLM 可能在 JSON 前后加了说明文字
        json_match = re.search(r'\{[^{}]*\}', response, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(0))
            except json.JSONDecodeError:
                pass

        return None

    # ============================================
    # 辅助方法：规范化冲突对索引
    # ============================================

    def _normalize_pairs(
        self,
        pairs: List[Any],
        max_index: int,
    ) -> List[Tuple[int, int]]:
        """
        规范化冲突对索引

        作用：
            LLM 返回的冲突对是 1-based 索引，需转为 0-based。
            同时校验索引合法性，过滤越界值。

        参数：
            pairs: List[Any] - LLM 返回的冲突对列表，如 [[1, 2], [2, 3]]
            max_index: int - 最大合法索引（片段数量）

        返回:
            List[Tuple[int, int]] - 规范化后的 0-based 冲突对列表
        """
        normalized = []
        for pair in pairs:
            try:
                if isinstance(pair, list) and len(pair) == 2:
                    # 转为 0-based 索引
                    idx1 = int(pair[0]) - 1
                    idx2 = int(pair[1]) - 1
                    # 校验索引合法性
                    if 0 <= idx1 < max_index and 0 <= idx2 < max_index and idx1 != idx2:
                        normalized.append((idx1, idx2))
            except (ValueError, TypeError):
                # 索引不是数字，跳过
                continue

        return normalized


# ============================================
# 全局实例
# ============================================

# 作用：全局单例，无状态可安全复用
conflict_detector = ConflictDetector()
