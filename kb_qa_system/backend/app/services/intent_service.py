"""
意图切换检测服务

作用：
    检测用户在多轮对话中是否突然改变了话题（意图切换），并据此调整上下文使用策略。

    为何需要意图切换检测：
        1. 避免摘要污染检索：历史摘要涵盖的是旧话题，如果用户切换到新话题，
           旧摘要会让检索偏向无关内容，降低召回质量。
        2. 避免历史误导生成：如果用户问 "Python 怎么读取文件" 后突然问 "Java 怎么定义类"，
           历史中的 Python 上下文可能让 LLM 生成 "用 Python 的 open()..." 的错误回答。
        3. 提升检索精准度：意图切换时，应只用当前 query 检索，不混入旧话题的语义。

    检测策略（双重）：
        1. 语义相似度（主要）：用 Embedding 计算当前 query 与最近历史 query 的余弦相似度，
           低于阈值则判定为意图切换
        2. 关键词重叠度（兜底）：Embedding 不可用时，用 Jaccard 相似度（字符级关键词交集）
           作为简单近似，保证检测不中断

    切换时的处理策略：
        - 检索：不注入历史摘要（summary=None），避免旧话题污染检索结果
        - 生成：保留近期历史消息，让 LLM 理解对话连续性，但通过系统提示告知已切换话题
        - Query 改写：意图切换时不做指代消解（query 改写服务会因无相关历史而原样返回）

降级策略：
    - Embedding 服务不可用（熔断/超时）→ 降级为关键词重叠度检测
    - 关键词检测也失败 → 默认不切换（保守策略，避免误判影响正常多轮对话）
    - 无历史 → 直接返回未切换（首次提问无意图切换概念）

实现方式：
    IntentService.detect_intent_switch(current_query, conversation_history) 返回
    IntentResult 数据类，包含 switched/similarity/method/last_query 字段。

使用方式：
    from app.services.intent_service import intent_service

    result = intent_service.detect_intent_switch(query, history)
    if result.switched:
        # 意图切换，不使用历史摘要
        summary = None
        logger.info(f"检测到意图切换，相似度 {result.similarity:.2f}")
"""

import logging
import re
from dataclasses import dataclass
from typing import List, Dict, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


# ============================================
# 意图检测结果数据类
# ============================================

@dataclass
class IntentResult:
    """
    意图检测结果

    作用：
        封装意图切换检测的结果，供调用方据此调整上下文使用策略。

    字段：
        switched: bool - 是否检测到意图切换
            True: 当前 query 与历史 query 语义差异大，判定为切换
            False: 语义连续或无法判断（无历史/检测失败）
        similarity: float - 当前 query 与最近历史 query 的相似度（0-1）
            越接近 1 表示越相似（未切换），越接近 0 表示差异越大（已切换）
            无历史或检测失败时为 -1
        method: str - 检测方法
            "embedding": 用 Embedding 余弦相似度检测
            "keyword": 用关键词 Jaccard 相似度检测（Embedding 不可用时兜底）
            "none": 未执行检测（无历史或开关关闭）
        last_query: Optional[str] - 对比的历史 query（最近一条用户消息）
            无历史时为 None
    """
    switched: bool
    similarity: float
    method: str
    last_query: Optional[str]


# ============================================
# 意图切换检测服务
# ============================================

class IntentService:
    """
    意图切换检测服务

    作用：
        基于语义相似度检测用户是否切换了对话意图，辅助 RAG 调整上下文策略。

    设计原则：
        1. 双重检测——Embedding 为主，关键词为辅，保证可用性
        2. 保守降级——检测失败时默认不切换，避免误判影响正常多轮对话
        3. 只比最近一句——只与最近一条用户消息对比，避免过多历史干扰判断
        4. 无状态——服务无状态，可安全全局单例复用
    """

    # 中文停用词（检测时不参与关键词比较）
    # 作用：去除"的、了、是"等无意义高频词，提升关键词重叠度判断的准确性
    _STOP_WORDS = {
        "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都",
        "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你",
        "会", "着", "没有", "看", "好", "自己", "这", "那", "怎么",
        "什么", "为什么", "如何", "可以", "吗", "呢", "吧", "啊", "请",
        "the", "a", "an", "is", "are", "was", "were", "how", "what",
        "why", "can", "could", "please", "do", "does",
    }

    def detect_intent_switch(
        self,
        current_query: str,
        conversation_history: Optional[List[Dict[str, str]]] = None,
    ) -> IntentResult:
        """
        检测当前 query 是否相对于历史切换了意图

        作用：
            比较当前 query 与最近一条历史用户消息的语义相似度，
            低于阈值则判定为意图切换。

        实现方式：
            1. 检查 ENABLE_INTENT_DETECTION 开关
            2. 从历史中提取最近一条用户消息作为对比基准
            3. 优先用 Embedding 余弦相似度检测
            4. Embedding 不可用时降级为关键词 Jaccard 相似度
            5. 相似度 < INTENT_SWITCH_SIMILARITY_THRESHOLD 判定为切换

        参数：
            current_query: str - 用户当前问题
            conversation_history: Optional[List[Dict[str, str]]] - 对话历史
                格式：[{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]

        返回:
            IntentResult - 检测结果，包含 switched/similarity/method/last_query
        """
        # 1. 检查开关
        if not settings.ENABLE_INTENT_DETECTION:
            return IntentResult(
                switched=False, similarity=-1.0, method="none", last_query=None
            )

        # 2. 从历史中提取最近一条用户消息
        # 作用：意图切换是相对最近一次提问而言，只比最近一条最合理
        last_query = self._extract_last_user_query(conversation_history)
        if last_query is None:
            # 无历史，无法判断意图切换（首次提问）
            return IntentResult(
                switched=False, similarity=-1.0, method="none", last_query=None
            )

        # 3. 优先用 Embedding 语义相似度检测
        # 作用：Embedding 能捕捉深层语义，即使表述不同但意图相同时也能识别
        similarity, method = self._compute_semantic_similarity(current_query, last_query)

        # 4. Embedding 检测失败时降级为关键词重叠度
        # 作用：Embedding 服务不可用时（熔断/超时），用简单的关键词重叠度兜底
        if similarity is None:
            similarity = self._compute_keyword_similarity(current_query, last_query)
            method = "keyword"

        # 5. 相似度仍为 None（极端情况），保守判定为未切换
        # 作用：避免检测异常导致误判，影响正常多轮对话
        if similarity is None:
            logger.warning("意图检测全部失败，保守判定为未切换")
            return IntentResult(
                switched=False, similarity=-1.0, method="none", last_query=last_query
            )

        # 6. 根据阈值判定是否切换
        # 作用：相似度低于阈值意味着两个 query 语义差异大，判定为意图切换
        switched = similarity < settings.INTENT_SWITCH_SIMILARITY_THRESHOLD

        if switched:
            logger.info(
                f"检测到意图切换：'{current_query[:30]}' vs '{last_query[:30]}'，"
                f"相似度 {similarity:.3f} < 阈值 {settings.INTENT_SWITCH_SIMILARITY_THRESHOLD}"
            )

        return IntentResult(
            switched=switched,
            similarity=round(similarity, 4),
            method=method,
            last_query=last_query,
        )

    # ============================================
    # 辅助方法：提取历史 query
    # ============================================

    def _extract_last_user_query(
        self,
        conversation_history: Optional[List[Dict[str, str]]],
    ) -> Optional[str]:
        """
        从对话历史中提取最近一条用户消息

        作用：
            意图切换是相对于用户上一次提问而言，需要找到最近一条 user 消息。
            从后往前遍历，找到第一条 role=user 的消息。

        参数：
            conversation_history: Optional[List[Dict[str, str]]] - 对话历史

        返回:
            Optional[str] - 最近一条用户消息内容；无历史或无用户消息时返回 None
        """
        if not conversation_history:
            return None

        # 从后往前找最近一条 user 消息
        # 作用：历史列表末尾是最新消息，倒序遍历最快找到
        for msg in reversed(conversation_history):
            if msg.get("role") == "user" and msg.get("content"):
                content = msg["content"].strip()
                if content:
                    return content

        return None

    # ============================================
    # 辅助方法：语义相似度（Embedding）
    # ============================================

    def _compute_semantic_similarity(
        self,
        query1: str,
        query2: str,
    ) -> tuple[Optional[float], str]:
        """
        用 Embedding 计算两个 query 的余弦相似度

        作用：
            将两个 query 分别 Embedding 为向量，计算余弦相似度。
            Embedding 能捕捉深层语义，如 "Python 读文件" 和 "用 Python 打开文件"
            字面不同但语义相似，Embedding 能正确识别。

        实现方式：
            1. 复用 VectorStoreService.generate_embedding 获取向量
            2. 计算两个向量的余弦相似度
            3. Embedding 失败时返回 (None, "embedding_failed")

        参数：
            query1: str - 第一个 query（当前问题）
            query2: str - 第二个 query（历史最近问题）

        返回:
            tuple[Optional[float], str]
            - 第一个元素：相似度（0-1），失败时为 None
            - 第二个元素：方法名 "embedding" 或 "embedding_failed"
        """
        try:
            from app.services.vector_store import get_vector_store

            vector_store = get_vector_store()

            # 分别获取两个 query 的 Embedding
            # 作用：generate_embedding 内置熔断+本地兜底，失败时返回 (None, "")
            vec1, _ = vector_store.generate_embedding(query1)
            vec2, _ = vector_store.generate_embedding(query2)

            if vec1 is None or vec2 is None:
                # Embedding 服务不可用（熔断或本地模型也失败）
                # 作用：返回 None 触发降级到关键词检测
                logger.debug("Embedding 不可用，将降级为关键词相似度检测")
                return None, "embedding_failed"

            # 计算余弦相似度
            # 作用：余弦相似度衡量两个向量方向的一致性，范围 [-1, 1]
            #       值越接近 1 表示语义越相似
            similarity = self._cosine_similarity(vec1, vec2)

            return similarity, "embedding"

        except Exception as e:
            logger.warning(f"Embedding 语义相似度计算失败: {e}")
            return None, "embedding_failed"

    def _cosine_similarity(self, vec1: List[float], vec2: List[float]) -> float:
        """
        计算两个向量的余弦相似度

        作用：
            余弦相似度 = (vec1 · vec2) / (|vec1| × |vec2|)
            衡量两个向量方向的一致性，不受向量长度影响。
            范围 [-1, 1]，在 Embedding 场景中通常为 [0, 1]。

        参数：
            vec1: List[float] - 第一个向量
            vec2: List[float] - 第二个向量

        返回:
            float - 余弦相似度（[-1, 1]，通常 [0, 1]）
        """
        # 点积
        # 作用：两个向量对应位置相乘后求和
        dot_product = sum(a * b for a, b in zip(vec1, vec2))

        # 向量长度（L2 范数）
        # 作用：各分量平方和的平方根
        norm1 = sum(a * a for a in vec1) ** 0.5
        norm2 = sum(b * b for b in vec2) ** 0.5

        # 防除零保护
        # 作用：零向量没有方向，无法计算相似度，返回 0（不相似）
        if norm1 == 0 or norm2 == 0:
            return 0.0

        return dot_product / (norm1 * norm2)

    # ============================================
    # 辅助方法：关键词相似度（兜底）
    # ============================================

    def _compute_keyword_similarity(self, query1: str, query2: str) -> float:
        """
        用关键词重叠度（Jaccard 相似度）计算两个 query 的相似度

        作用：
            Embedding 不可用时的兜底方案。提取两个 query 的关键词集合，
            计算交集与并集的比值（Jaccard 相似度）。
            范围 [0, 1]，值越大表示关键词重叠越多。

            局限性：只能捕捉字面关键词重叠，无法识别语义相似但表述不同的情况。
            如 "Python 读文件" 和 "用 Python 打开文件" 关键词重叠度高，能识别；
            但 "如何做异步编程" 和 "asyncio 怎么用" 关键词无重叠，会误判为切换。

        实现方式：
            1. 分词：中文按字符切分 + 英文按单词切分（简单分词，无依赖）
            2. 过滤停用词和标点
            3. 计算 Jaccard 相似度 = |交集| / |并集|

        参数：
            query1: str - 第一个 query
            query2: str - 第二个 query

        返回:
            float - Jaccard 相似度（[0, 1]）
        """
        # 提取关键词集合
        # 作用：分词 + 去停用词 + 去标点
        keywords1 = self._extract_keywords(query1)
        keywords2 = self._extract_keywords(query2)

        # 两个 query 都无有效关键词，无法比较
        # 作用：返回 0.5（中等相似度），保守不判定切换
        if not keywords1 and not keywords2:
            return 0.5

        # Jaccard 相似度 = 交集大小 / 并集大小
        # 作用：衡量两个集合的重叠程度
        intersection = keywords1 & keywords2
        union = keywords1 | keywords2

        return len(intersection) / len(union) if union else 0.0

    def _extract_keywords(self, query: str) -> set:
        """
        从 query 中提取关键词集合

        作用：
            简单分词提取关键词，用于 Jaccard 相似度计算。
            无需 jieba 等分词库，用正则提取中文词组和英文单词。

        实现方式：
            1. 用正则提取英文单词（连续字母）
            2. 用正则提取中文词组（连续中文字符，按 2-4 字切分）
            3. 转小写统一
            4. 过滤停用词

        参数：
            query: str - 原始 query

        返回:
            set - 关键词集合（小写形式）
        """
        if not query:
            return set()

        keywords = set()

        # 提取英文单词（连续字母，长度 >= 2）
        # 作用：英文技术词如 "python"、"asyncio" 是重要关键词
        english_words = re.findall(r'[a-zA-Z]{2,}', query)
        for word in english_words:
            word_lower = word.lower()
            if word_lower not in self._STOP_WORDS:
                keywords.add(word_lower)

        # 提取中文词组
        # 作用：中文按 2-4 字滑窗切分，近似分词效果
        # 例如 "如何使用异步编程" → {"如何", "何使", "使用", "用异", "异步", "步编", "编程"}
        chinese_chars = re.findall(r'[\u4e00-\u9fa5]+', query)
        for segment in chinese_chars:
            # 单字直接加入（如果非停用词）
            if len(segment) == 1:
                if segment not in self._STOP_WORDS:
                    keywords.add(segment)
            else:
                # 2 字滑窗切分
                # 作用：中文最小语义单元通常是 2 字词，滑窗能覆盖大部分情况
                for i in range(len(segment) - 1):
                    bigram = segment[i:i + 2]
                    if bigram not in self._STOP_WORDS:
                        keywords.add(bigram)

        return keywords


# ============================================
# 全局实例
# ============================================

# 作用：全局单例，无状态可安全复用
intent_service = IntentService()
