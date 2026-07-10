"""
用户意图识别服务

作用：
    识别用户输入的意图类型，决定是否需要检索知识库文档。

    为何需要意图识别：
        并非所有用户输入都是"知识库提问"。如果不区分意图，会出现以下问题：
        1. 闲聊被误拦："谢谢你" → 检索不到文档 → 预生成校验返回"未找到相关文档"
        2. 追问被误拦："再详细说说" → 检索不到新文档 → 被拦截
        3. 元问题被误拦："你能做什么" → 检索不到 → 被拦截
        4. 浪费资源：对闲聊也执行检索+预生成校验，浪费 LLM 和向量检索资源

    四种意图类型：
        1. kb_query（知识库提问）：需要检索文档，走完整 RAG 流程
           示例："Python 怎么读取文件？"、"asyncio 的用法"
        2. chitchat（闲聊/社交）：不需要检索，直接用 LLM 回复
           示例："谢谢"、"你好"、"明白了"、"辛苦了"
        3. followup（追问/继续）：不需要新检索，基于上下文继续
           示例："继续"、"再详细说说"、"第2点展开一下"
        4. meta（元问题）：关于系统本身，不需要检索
           示例："你是谁"、"能做什么"、"怎么使用"

    分类策略（双重）：
        1. 规则预判（快速）：用关键词集合匹配常见闲聊/追问/元问题模式
           优势：无 LLM 调用，延迟极低
           局限：只能识别固定模式，无法理解语义
        2. LLM 分类（精确）：规则无法判断时用 LLM 分类
           优势：理解语义，覆盖所有情况
           局限：需要 LLM 调用，有延迟

    降级策略：
        - LLM 不可用 → 默认 kb_query（保持原有 RAG 行为，不会误拦提问）
        - 无历史 + 追问关键词 → 降级为 chitchat（无上下文无法追问）

使用方式：
    from app.services.intent_classifier import intent_classifier

    result = intent_classifier.classify(query, history)
    if result.needs_retrieval:
        # 走完整 RAG 流程（检索+预生成校验+生成）
    else:
        # 走无检索路径（直接用 LLM 回复）
"""

import json
import logging
import re
from dataclasses import dataclass
from enum import Enum
from typing import List, Dict, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


# ============================================
# 意图类型枚举
# ============================================

class IntentType(str, Enum):
    """
    用户意图类型

    作用：
        枚举所有可能的用户意图，用于决定 RAG 处理路径。

    值：
        KB_QUERY: 知识库提问，需要检索文档
        CHITCHAT: 闲聊/社交，不需要检索
        FOLLOWUP: 追问/继续，基于上下文，不需要新检索
        META: 元问题（关于系统本身），不需要检索
    """
    KB_QUERY = "kb_query"
    CHITCHAT = "chitchat"
    FOLLOWUP = "followup"
    META = "meta"


# ============================================
# 意图分类结果数据类
# ============================================

@dataclass
class IntentClassification:
    """
    意图分类结果

    作用：
        封装意图识别结果，供 rag_chain 决定处理路径。

    字段：
        intent: IntentType - 意图类型
        confidence: float - 置信度（0-1）
            规则匹配：1.0（精确匹配）
            LLM 分类：0.0-1.0（LLM 返回）
            降级：0.5（不确定）
        needs_retrieval: bool - 是否需要检索知识库文档
            True: 走完整 RAG 流程（检索+预生成校验+生成）
            False: 走无检索路径（直接用 LLM 回复）
        reason: str - 分类原因（用于日志和埋点）
            "rule_chitchat": 规则匹配闲聊
            "rule_followup": 规则匹配追问
            "rule_meta": 规则匹配元问题
            "llm_classified": LLM 分类
            "fallback": 降级为 kb_query
    """
    intent: IntentType
    confidence: float
    needs_retrieval: bool
    reason: str


# ============================================
# 意图识别服务
# ============================================

class IntentClassifier:
    """
    用户意图识别服务

    作用：
        识别用户输入的意图类型，决定是否需要检索知识库文档。

    设计原则：
        1. 规则优先——常见模式用关键词匹配，零延迟，不消耗 LLM
        2. LLM 兜底——规则无法判断时用 LLM 语义分类
        3. 宁可检索——无法确定时默认 kb_query，避免漏答知识库提问
        4. 上下文感知——追问意图需要结合对话历史判断
    """

    # ============================================
    # 规则关键词集合
    # ============================================

    # 闲聊关键词（纯社交用语，不需要检索）
    # 作用：匹配感谢、问候、肯定、否定等社交表达
    _CHITCHAT_KEYWORDS = {
        # 感谢
        "谢谢", "感谢", "多谢", "谢了", "辛苦了", "麻烦你了", "太感谢了",
        "thanks", "thank you", "thx", "appreciate",
        # 问候
        "你好", "您好", "嗨", "哈喽", "早上好", "下午好", "晚上好",
        "早安", "晚安", "hi", "hello", "hey", "yo",
        # 肯定/理解
        "好的", "明白", "了解", "清楚了", "懂了", "知道了", "收到",
        "ok", "okay", "got it", "i see", "understood",
        # 否定/结束
        "不用了", "算了", "没关系", "没事", "再见", "拜拜", "bye",
        # 情感
        "哈哈", "呵呵", "嘿嘿", "嗯", "哦", "啊", "哇",
        "haha", "lol", "wow",
    }

    # 追问关键词（需要结合上下文继续，不需要新检索）
    # 作用：匹配延续性指令、追问细节、展开补充等
    _FOLLOWUP_KEYWORDS = {
        # 延续
        "继续", "接着说", "然后呢", "还有呢", "接下来", "往下说",
        # 详细化
        "详细", "展开", "深入", "进一步", "具体", "举个例子", "举例",
        "说清楚", "再解释", "详细说说", "详细讲讲",
        # 指代上文
        "刚才", "上面", "前面", "你说的", "你提到的", "那个",
        "第1点", "第2点", "第3点", "第一点", "第二点", "第三点",
        "这个", "另一个",
        # 追问原因
        "为什么", "怎么会", "凭什么", "原因是什么",
    }

    # 元问题关键词（关于系统本身，不需要检索）
    # 作用：匹配系统功能、身份、使用方法等元问题
    _META_KEYWORDS = {
        "你是谁", "你是什么", "你是ai", "你是机器人", "你是人",
        "你能做什么", "你会什么", "你的功能", "你能帮我",
        "怎么使用", "怎么用", "使用方法", "帮助", "help",
        "有什么功能", "能做什么", "capabilities",
    }

    # 闲聊关键词正则（更灵活的匹配）
    # 作用：匹配"太感谢了"、"非常谢谢"等变体
    _CHITCHAT_PATTERNS = [
        re.compile(r'^(谢谢|感谢|多谢|辛苦)', re.IGNORECASE),
        re.compile(r'^(你好|您好|嗨|哈喽|hi|hello|hey)', re.IGNORECASE),
        re.compile(r'^(好的|明白|了解|懂了|知道|收到|ok|okay)', re.IGNORECASE),
        re.compile(r'^(不用|算了|没事|再见|拜拜|bye)', re.IGNORECASE),
        re.compile(r'^(哈哈|呵呵|嘿嘿|嗯|哦|haha|lol)', re.IGNORECASE),
    ]

    # 追问关键词正则
    _FOLLOWUP_PATTERNS = [
        re.compile(r'(继续|接着|然后呢|还有呢|接下来|往下)'),
        re.compile(r'(详细|展开|深入|进一步|具体|举例)'),
        re.compile(r'(刚才|上面|前面|你说的|你提到的|那个|这个)'),
        re.compile(r'第[一二三四五六七八九十\d]+点'),
    ]

    # 元问题正则
    _META_PATTERNS = [
        re.compile(r'你是(谁|什么|ai|机器人|人)', re.IGNORECASE),
        re.compile(r'你(能|会)(做什么|什么)', re.IGNORECASE),
        re.compile(r'(怎么|如何)(使用|用)', re.IGNORECASE),
        re.compile(r'(有什么|你的)(功能|能力)', re.IGNORECASE),
    ]

    # LLM 分类 Prompt
    # 作用：规则无法判断时用 LLM 语义分类
    _LLM_CLASSIFY_PROMPT = (
        "请判断用户输入的意图类型，返回 JSON 格式结果。\n\n"
        "意图类型：\n"
        "1. kb_query: 基于知识库的提问（需要检索文档才能回答的事实/技术问题）\n"
        "2. chitchat: 闲聊/社交（问候、感谢、肯定、情感表达等）\n"
        "3. followup: 追问/继续（基于上文继续讨论，如'继续'、'详细说说'）\n"
        "4. meta: 元问题（关于系统本身，如'你是谁'、'能做什么'）\n\n"
        "用户输入：{query}\n\n"
        "最近对话（如有）：{history}\n\n"
        "请返回 JSON（只返回JSON，不要其他文字）：\n"
        '{{"intent": "kb_query", "confidence": 0.9}}'
    )

    def classify(
        self,
        query: str,
        conversation_history: Optional[List[Dict[str, str]]] = None,
    ) -> IntentClassification:
        """
        识别用户意图

        作用：
            判断用户输入是知识库提问、闲聊、追问还是元问题，
            决定是否需要检索知识库文档。

        实现方式：
            1. 规则预判：用关键词集合和正则匹配常见模式
            2. LLM 分类：规则无法判断时用 LLM 语义分类
            3. 降级：LLM 不可用时默认 kb_query

        参数：
            query: str - 用户输入
            conversation_history: Optional[List[Dict[str, str]]] - 对话历史
                用于判断追问意图（无历史的"继续"无法追问）

        返回:
            IntentClassification - 分类结果
        """
        # 0. 检查开关
        if not settings.ENABLE_INTENT_DETECTION:
            # 意图检测关闭，所有输入都走 RAG 流程
            return IntentClassification(
                intent=IntentType.KB_QUERY,
                confidence=0.5,
                needs_retrieval=True,
                reason="disabled",
            )

        # 1. 规则预判（快速，零 LLM 调用）
        rule_result = self._classify_by_rules(query, conversation_history)
        if rule_result is not None:
            logger.debug(
                f"意图识别（规则）：{rule_result.intent.value}，"
                f"原因：{rule_result.reason}"
            )
            return rule_result

        # 2. LLM 分类（规则无法判断时）
        llm_result = self._classify_by_llm(query, conversation_history)
        if llm_result is not None:
            logger.debug(
                f"意图识别（LLM）：{llm_result.intent.value}，"
                f"置信度：{llm_result.confidence}"
            )
            return llm_result

        # 3. 降级：默认 kb_query
        # 作用：无法分类时走完整 RAG 流程，避免漏答知识库提问
        logger.debug("意图识别降级：默认 kb_query")
        return IntentClassification(
            intent=IntentType.KB_QUERY,
            confidence=0.5,
            needs_retrieval=True,
            reason="fallback",
        )

    # ============================================
    # 规则预判
    # ============================================

    def _classify_by_rules(
        self,
        query: str,
        conversation_history: Optional[List[Dict[str, str]]],
    ) -> Optional[IntentClassification]:
        """
        规则预判意图（关键词+正则匹配）

        作用：
            用预定义的关键词集合和正则模式快速匹配常见意图。
            匹配成功返回分类结果，匹配失败返回 None（交给 LLM）。

        实现方式：
            1. 标准化 query（去空格、转小写）
            2. 检查元问题（优先级最高，避免"你是谁"被误判为闲聊）
            3. 检查闲聊
            4. 检查追问（需有历史，否则降级为闲聊）
            5. 都不匹配返回 None

        参数：
            query: str - 用户输入
            conversation_history: Optional[List[Dict[str, str]]] - 对话历史

        返回:
            Optional[IntentClassification] - 分类结果（None 表示规则无法判断）
        """
        if not query:
            return None

        # 标准化：去首尾空格 + 转小写（用于英文关键词匹配）
        normalized = query.strip().lower()

        # 短 query 专门处理（<=4 字符的纯社交用语）
        # 作用："嗯"、"哦"、"ok"、"hi" 等极短输入直接判定闲聊
        if len(normalized) <= 4 and normalized in self._CHITCHAT_KEYWORDS:
            return IntentClassification(
                intent=IntentType.CHITCHAT,
                confidence=1.0,
                needs_retrieval=False,
                reason="rule_chitchat_short",
            )

        # 1. 检查元问题（优先级最高）
        # 作用："你是谁"不应被误判为闲聊，应走元问题回复
        for pattern in self._META_PATTERNS:
            if pattern.search(query):
                return IntentClassification(
                    intent=IntentType.META,
                    confidence=1.0,
                    needs_retrieval=False,
                    reason="rule_meta",
                )
        if normalized in self._META_KEYWORDS:
            return IntentClassification(
                intent=IntentType.META,
                confidence=1.0,
                needs_retrieval=False,
                reason="rule_meta",
            )

        # 2. 检查闲聊
        # 作用：感谢、问候、肯定等社交表达不需要检索
        for pattern in self._CHITCHAT_PATTERNS:
            if pattern.search(query):
                return IntentClassification(
                    intent=IntentType.CHITCHAT,
                    confidence=1.0,
                    needs_retrieval=False,
                    reason="rule_chitchat",
                )
        if normalized in self._CHITCHAT_KEYWORDS:
            return IntentClassification(
                intent=IntentType.CHITCHAT,
                confidence=1.0,
                needs_retrieval=False,
                reason="rule_chitchat",
            )

        # 3. 检查追问（需要结合历史）
        # 作用：追问词 + 有历史 → followup；追问词 + 无历史 → chitchat
        has_history = bool(conversation_history and len(conversation_history) > 0)

        for pattern in self._FOLLOWUP_PATTERNS:
            if pattern.search(query):
                if has_history:
                    return IntentClassification(
                        intent=IntentType.FOLLOWUP,
                        confidence=0.9,
                        needs_retrieval=False,
                        reason="rule_followup",
                    )
                else:
                    # 无历史的追问词 → 降级为闲聊
                    # 作用："继续"但没有上文，无法追问，当作闲聊处理
                    return IntentClassification(
                        intent=IntentType.CHITCHAT,
                        confidence=0.8,
                        needs_retrieval=False,
                        reason="rule_followup_no_history",
                    )

        if normalized in self._FOLLOWUP_KEYWORDS:
            if has_history:
                return IntentClassification(
                    intent=IntentType.FOLLOWUP,
                    confidence=0.9,
                    needs_retrieval=False,
                    reason="rule_followup",
                )
            else:
                return IntentClassification(
                    intent=IntentType.CHITCHAT,
                    confidence=0.8,
                    needs_retrieval=False,
                    reason="rule_followup_no_history",
                )

        # 4. 规则无法判断
        return None

    # ============================================
    # LLM 分类
    # ============================================

    def _classify_by_llm(
        self,
        query: str,
        conversation_history: Optional[List[Dict[str, str]]],
    ) -> Optional[IntentClassification]:
        """
        用 LLM 进行语义意图分类

        作用：
            规则无法判断时用 LLM 理解语义进行分类。
            LLM 能理解规则的盲区，如"这个方案有什么缺点"是 kb_query 而非 followup。

        实现方式：
            1. 构建 Prompt（含 query 和最近 2 轮历史）
            2. 调用 LLMResilienceService
            3. 解析 JSON 返回
            4. LLM 不可用或解析失败返回 None

        参数：
            query: str - 用户输入
            conversation_history: Optional[List[Dict[str, str]]] - 对话历史

        返回:
            Optional[IntentClassification] - 分类结果（None 表示 LLM 不可用或失败）
        """
        # 格式化历史（只用最近 2 轮，避免 Prompt 膨胀）
        history_text = self._format_history_for_classify(conversation_history)

        prompt = self._LLM_CLASSIFY_PROMPT.format(
            query=query[:200],
            history=history_text,
        )

        try:
            from langchain_core.messages import HumanMessage, SystemMessage
            from app.services.llm_resilience import get_llm_service, LLMServiceError
            from app.core.circuit_breaker import CircuitBreakerOpenError

            messages = [
                SystemMessage(content="你是一个意图分类助手，只返回JSON格式结果。"),
                HumanMessage(content=prompt),
            ]

            llm_service = get_llm_service()
            response = llm_service.invoke(messages)

            if not response:
                return None

            # 解析 JSON
            parsed = self._parse_classify_response(response)
            if parsed is None:
                logger.warning(f"LLM 意图分类返回格式异常: {response[:100]}")
                return None

            intent_str = parsed.get("intent", "kb_query")
            confidence = float(parsed.get("confidence", 0.5))

            # 映射到 IntentType
            intent_map = {
                "kb_query": IntentType.KB_QUERY,
                "chitchat": IntentType.CHITCHAT,
                "followup": IntentType.FOLLOWUP,
                "meta": IntentType.META,
            }
            intent = intent_map.get(intent_str, IntentType.KB_QUERY)

            # 根据意图决定是否需要检索
            needs_retrieval = (intent == IntentType.KB_QUERY)

            return IntentClassification(
                intent=intent,
                confidence=confidence,
                needs_retrieval=needs_retrieval,
                reason="llm_classified",
            )

        except (LLMServiceError, CircuitBreakerOpenError) as e:
            logger.debug(f"LLM 不可用，意图分类降级: {e}")
            return None
        except Exception as e:
            logger.warning(f"LLM 意图分类异常: {e}")
            return None

    def _format_history_for_classify(
        self,
        conversation_history: Optional[List[Dict[str, str]]],
    ) -> str:
        """
        格式化对话历史用于 LLM 分类

        作用：
            只取最近 2 轮对话，格式化为简洁文本，供 LLM 判断追问意图。

        参数：
            conversation_history: Optional[List[Dict[str, str]]] - 对话历史

        返回:
            str - 格式化的历史文本（无历史时返回"无"）
        """
        if not conversation_history:
            return "无"

        # 只取最近 2 轮（4 条消息：user+assistant × 2）
        recent = conversation_history[-4:]
        lines = []
        for msg in recent:
            role = "用户" if msg.get("role") == "user" else "助手"
            content = msg.get("content", "")[:100]  # 截断避免 Prompt 膨胀
            lines.append(f"{role}: {content}")

        return "\n".join(lines) if lines else "无"

    def _parse_classify_response(self, response: str) -> Optional[Dict]:
        """
        解析 LLM 返回的意图分类 JSON

        作用：
            LLM 可能返回带 Markdown 代码块或多余文字的 JSON，
            本方法提取并解析，容错处理常见格式问题。

        参数：
            response: str - LLM 返回的原始文本

        返回:
            Optional[Dict] - 解析后的字典（失败返回 None）
        """
        if not response:
            return None

        response = response.strip()

        # 1. 直接解析
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            pass

        # 2. 提取代码块中的 JSON
        code_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', response, re.DOTALL)
        if code_match:
            try:
                return json.loads(code_match.group(1))
            except json.JSONDecodeError:
                pass

        # 3. 提取第一个 { ... } 块
        json_match = re.search(r'\{[^{}]*\}', response, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(0))
            except json.JSONDecodeError:
                pass

        return None


# ============================================
# 全局实例
# ============================================

# 作用：全局单例，无状态可安全复用
intent_classifier = IntentClassifier()
