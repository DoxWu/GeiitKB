"""
流式预生成校验服务

作用：
    在 LLM 生成回答之前，校验检索结果的质量。如果检索结果质量不足
    （为空/内容过短/相关度过低），直接返回兜底回答，跳过 LLM 调用。

    为何需要预生成校验：
        1. 避免幻觉：检索结果为空时，LLM 可能基于"未找到相关文档"的字面
           生成看似合理但无依据的回答，造成幻觉。
        2. 节省成本：检索结果明显不相关时，跳过 LLM 调用节省 Token 和延迟。
        3. 提升体验：结果质量不足时直接告知用户，而非生成模糊回答让用户困惑。
        4. 流式优化：流式场景下，提前校验可以避免"开始流式→发现无用→中止"
           的尴尬体验，直接返回兜底消息。

    校验策略（多重检查）：
        1. 结果为空：检索结果列表为空 → 不生成，返回"未找到相关文档"
        2. 内容过短：所有片段内容总长度 < 阈值 → 不生成，返回"信息不足"
        3. 低置信度：最高分接近阈值（勉强过关）→ 生成但标记低置信度
        4. 正常：质量足够 → 正常生成

    置信度标记处理：
        - high：正常生成，无需额外提示
        - low：在回答前加入"以下回答基于相关性较低的检索结果，仅供参考"
        - none：不生成，返回兜底回答

降级策略：
    - 校验服务本身异常 → 默认允许生成（不阻塞主流程）
    - 阈值配置异常 → 使用默认值

实现方式：
    PreGenerationValidator.validate(query, search_results) 返回 ValidationResult，
    包含 should_generate/reason/confidence/fallback_answer 字段。

使用方式：
    from app.services.pre_generation_validator import pre_generation_validator

    result = pre_generation_validator.validate(query, search_results)
    if not result.should_generate:
        return {"answer": result.fallback_answer, ...}
"""

import logging
from dataclasses import dataclass
from typing import List, Dict, Any, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


# ============================================
# 校验结果数据类
# ============================================

@dataclass
class ValidationResult:
    """
    预生成校验结果

    作用：
        封装检索质量校验结果，供 rag_chain 决定是否生成回答。

    字段：
        should_generate: bool - 是否应该调用 LLM 生成回答
            True: 检索结果质量足够，正常生成
            False: 质量不足，跳过生成，使用 fallback_answer
        reason: str - 校验原因（用于日志和埋点）
            "passed": 校验通过，正常生成
            "no_results": 检索结果为空
            "insufficient_content": 内容总长度不足
            "all_low_score": 所有结果分数过低
            "validation_error": 校验本身异常，默认允许生成
        confidence: str - 置信度级别
            "high": 检索质量高，正常生成
            "low": 检索质量勉强过关，回答需附加低置信度提示
            "none": 未生成，无置信度
        fallback_answer: str - 兜底回答（should_generate=False 时使用）
            当检索质量不足时返回给用户的友好提示
    """
    should_generate: bool
    reason: str
    confidence: str
    fallback_answer: str = ""


# ============================================
# 预生成校验服务
# ============================================

class PreGenerationValidator:
    """
    流式预生成校验服务

    作用：
        在 LLM 生成前校验检索结果质量，避免基于低质量结果生成幻觉回答。

    设计原则：
        1. 宁可放过——校验不确定时默认允许生成，避免误拦正常回答
        2. 多重检查——空结果、内容过短、低分数分别检查，任一不通过即拦截
        3. 友好兜底——拦截时返回友好的中文提示，而非冷冰冰的错误码
        4. 置信度分级——勉强过关的结果允许生成但标记低置信度
    """

    # 内容最小总长度（字符数）
    # 作用：所有片段内容拼接过短时，信息量不足以支撑有意义的回答
    _MIN_TOTAL_CONTENT_LENGTH = 50

    # 低置信度分数阈值（相对 SIMILARITY_THRESHOLD 的倍数）
    # 作用：最高分在 [SIMILARITY_THRESHOLD, SIMILARITY_THRESHOLD × 1.5] 区间时
    #       标记为低置信度，允许生成但附加提示
    _LOW_CONFIDENCE_MULTIPLIER = 1.5

    def validate(
        self,
        query: str,
        search_results: List[Dict[str, Any]],
    ) -> ValidationResult:
        """
        校验检索结果质量，决定是否生成回答

        作用：
            多重检查检索结果，返回是否应生成回答及置信度。

        实现方式：
            1. 检查结果是否为空
            2. 检查内容总长度是否足够
            3. 检查最高分数是否达标
            4. 根据最高分判定置信度级别

        参数：
            query: str - 用户问题（用于生成兜底回答）
            search_results: List[Dict[str, Any]] - 检索结果
                格式：[{"content": "...", "score": 0.95, ...}, ...]

        返回:
            ValidationResult - 校验结果
        """
        try:
            # 1. 检查结果是否为空
            # 作用：无检索结果时直接返回兜底，避免 LLM 幻觉
            if not search_results or len(search_results) == 0:
                logger.info("预生成校验：检索结果为空，跳过生成")
                return ValidationResult(
                    should_generate=False,
                    reason="no_results",
                    confidence="none",
                    fallback_answer=self._no_results_answer(query),
                )

            # 2. 检查内容总长度
            # 作用：内容过短意味着信息量不足，无法支撑有意义的回答
            total_content_length = sum(
                len(r.get("content", "")) for r in search_results
            )
            if total_content_length < self._MIN_TOTAL_CONTENT_LENGTH:
                logger.info(
                    f"预生成校验：内容总长度 {total_content_length} 不足，跳过生成"
                )
                return ValidationResult(
                    should_generate=False,
                    reason="insufficient_content",
                    confidence="none",
                    fallback_answer=self._insufficient_content_answer(query),
                )

            # 3. 检查最高分数
            # 作用：最高分过低意味着检索结果与问题相关性差
            max_score = max(r.get("score", 0) for r in search_results)
            threshold = settings.SIMILARITY_THRESHOLD

            # 最高分低于阈值 → 不生成
            # 作用：虽然 vector_store 已过滤低分，但混合检索的融合分数可能偏低
            if max_score < threshold:
                logger.info(
                    f"预生成校验：最高分 {max_score:.3f} < 阈值 {threshold}，跳过生成"
                )
                return ValidationResult(
                    should_generate=False,
                    reason="all_low_score",
                    confidence="none",
                    fallback_answer=self._low_score_answer(query),
                )

            # 4. 判定置信度级别
            # 作用：最高分在阈值附近时标记低置信度，生成但附加提示
            low_confidence_threshold = threshold * self._LOW_CONFIDENCE_MULTIPLIER
            if max_score < low_confidence_threshold:
                logger.info(
                    f"预生成校验：最高分 {max_score:.3f} 接近阈值，标记低置信度"
                )
                return ValidationResult(
                    should_generate=True,
                    reason="passed",
                    confidence="low",
                )

            # 5. 正常情况
            return ValidationResult(
                should_generate=True,
                reason="passed",
                confidence="high",
            )

        except Exception as e:
            # 校验本身异常，默认允许生成
            # 作用：校验是辅助功能，不能阻塞主流程
            logger.warning(f"预生成校验异常，默认允许生成: {e}")
            return ValidationResult(
                should_generate=True,
                reason="validation_error",
                confidence="high",
            )

    # ============================================
    # 辅助方法：生成兜底回答
    # ============================================

    def _no_results_answer(self, query: str) -> str:
        """
        生成"无检索结果"的兜底回答

        作用：
            检索结果为空时返回给用户的友好提示。
            告知用户知识库中没有相关内容，并建议换一种问法。

        参数：
            query: str - 用户原始问题（用于个性化提示）

        返回:
            str - 友好的兜底回答
        """
        return (
            f"抱歉，我在知识库中没有找到与「{query[:50]}」相关的内容。\n\n"
            "建议您：\n"
            "1. 尝试换一种表述方式提问\n"
            "2. 检查是否有相关文档已上传到知识库\n"
            "3. 联系管理员确认文档库权限"
        )

    def _insufficient_content_answer(self, query: str) -> str:
        """
        生成"内容不足"的兜底回答

        作用：
            检索结果内容过短时返回给用户的提示。
            告知用户找到的文档片段信息量不足。

        参数：
            query: str - 用户原始问题

        返回:
            str - 友好的兜底回答
        """
        return (
            f"抱歉，虽然找到了一些与「{query[:50]}」相关的文档，"
            "但内容信息量不足，无法给出完整回答。\n\n"
            "建议您尝试更具体的关键词，或联系管理员补充相关文档。"
        )

    def _low_score_answer(self, query: str) -> str:
        """
        生成"分数过低"的兜底回答

        作用：
            检索结果相关度过低时返回给用户的提示。
            告知用户找到的文档与问题相关性较弱。

        参数：
            query: str - 用户原始问题

        返回:
            str - 友好的兜底回答
        """
        return (
            f"抱歉，知识库中似乎没有与「{query[:50]}」高度相关的内容。\n"
            "检索到的文档相关性较低，可能无法准确回答您的问题。\n\n"
            "建议您尝试调整问题的表述或关键词。"
        )


# ============================================
# 全局实例
# ============================================

# 作用：全局单例，无状态可安全复用
pre_generation_validator = PreGenerationValidator()
