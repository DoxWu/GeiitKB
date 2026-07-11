"""
LLM 容错服务模块（适配层）

作用：
    作为 LLM 调用的统一入口，委托给 model_provider 统一抽象层。
    保留原有的公共接口（get_llm_service / invoke / astream / last_metrics /
    LLMServiceError / LLMStreamTimeoutError），确保 rag_chain、conflict_detector、
    history_service、intent_classifier、query_rewrite 等上层服务无需修改。

架构变更：
    原实现直接创建 ChatOpenAI 实例，内置重试/熔断/超时/降级逻辑（794行）。
    现改为薄适配层，委托给 ModelProviderManager 管理的 TextModelClient：
    - 重试/熔断/超时：由 OpenAITextClient 内部处理
    - 降级路由：由 FailoverRouter 基于 CircuitBreaker 状态决策
    - 健康检查：由 HealthChecker 后台探测，结果喂入熔断器
    - 指标追踪：由 CallMetrics（ContextVar）实现并发安全

使用方式（不变）：
    from app.services.llm_resilience import get_llm_service

    # 非流式
    answer = llm_service.invoke(messages)

    # 流式
    async for chunk in llm_service.astream(messages):
        print(chunk, end="")
"""

import logging
import threading
import time as _time
from typing import AsyncGenerator, List, Optional

from langchain_core.messages import BaseMessage

from app.core.circuit_breaker import CircuitBreakerOpenError
from app.core.model_provider import get_model_manager
from app.core.model_provider.call_metrics import CallMetrics
from app.core.model_provider.exceptions import ModelInvocationError

logger = logging.getLogger(__name__)


# ============================================
# 异常定义（向后兼容，签名不变）
# ============================================

class LLMServiceError(Exception):
    """
    LLM 服务不可用异常

    作用：
        当所有端点（主模型 + 全部降级模型）均调用失败时抛出。
        上层应捕获此异常走兜底回复（如"抱歉，服务暂时不可用"）。
    """


class LLMStreamTimeoutError(Exception):
    """
    流式首字超时异常（向后兼容保留）

    作用：
        原实现在流式首字超时时抛出。新架构中，流式超时由 OpenAITextClient
        内部处理（转为 StreamTimeoutError 并重试），不再向上抛出此异常。
        保留类定义避免外部导入错误。
    """


# ============================================
# LLM 容错服务（适配层）
# ============================================

class LLMResilienceService:
    """
    LLM 容错服务（适配层）

    作用：
        作为 LLM 调用的统一入口，委托给 ModelProviderManager 管理的 TextModelClient。
        调用方无需关心重试、熔断、超时、降级细节——这些都由底层客户端和路由器处理。

    容错链路（非流式）：
        1. 从 manager 获取 (primary, fallbacks) 客户端列表
        2. 遍历列表，依次尝试每个客户端的 invoke()
        3. 某个客户端成功 → 更新指标 → 返回结果
        4. 某个客户端失败（ModelInvocationError / CircuitBreakerOpenError）→ 尝试下一个
        5. 全部失败 → 抛 LLMServiceError

    容错链路（流式）：
        1. 从 manager 获取 (primary, fallbacks) 客户端列表
        2. 遍历列表，依次尝试获取首字
        3. 首字成功 → yield 首字 + 消费剩余流（不再重试）
        4. 首字失败 → 尝试下一个降级客户端
        5. 全部失败 → 抛 LLMServiceError
    """

    def __init__(self):
        """
        初始化 LLM 容错服务（适配层）

        作用：
            获取 ModelProviderManager 引用，不再直接创建 ChatOpenAI 实例。
            熔断器、重试、超时等由底层 TextModelClient 管理。

        实现方式：
            - 通过 get_model_manager() 获取全局管理器（懒加载单例）
            - manager 内部会在首次使用时自动 initialize()
            - last_metrics 通过 CallMetrics（ContextVar）实现并发隔离
        """
        self._manager = get_model_manager()

    # ============================================
    # 指标管理（委托给 CallMetrics，并发安全）
    # ============================================

    @staticmethod
    def _default_metrics() -> dict:
        """
        创建默认的指标字典

        作用：
            提供指标字典的初始模板，包含所有字段及默认值。
            委托给 CallMetrics 的默认值生成器。

        返回:
            dict - 包含所有指标字段的字典
                - retry_count: 重试次数
                - llm_time_ms: LLM 调用耗时（毫秒）
                - model_used: 实际使用的模型名称
                - provider_used: 实际使用的端点名称
                - token_input: 输入 Token 数
                - token_output: 输出 Token 数
                - failover_count: 降级切换次数
        """
        return CallMetrics.get()

    @property
    def last_metrics(self) -> dict:
        """
        获取当前上下文的调用指标（并发安全）

        作用：
            委托给 CallMetrics.get()，通过 ContextVar 实现每个并发请求
            获得独立的指标副本。

        返回:
            dict - 当前调用的指标字典（可变，直接修改即可）

        注意：
            此属性是并发安全的——不同请求/线程/asyncio Task
            会各自获得独立的字典，互不干扰。
        """
        return CallMetrics.get()

    @last_metrics.setter
    def last_metrics(self, value: dict) -> None:
        """
        设置当前上下文的调用指标（向后兼容）

        作用：
            原实现通过此 setter 重置指标。新实现委托给 CallMetrics.update()，
            将传入的字段合并到当前上下文的指标字典中。
        """
        CallMetrics.update(**value)

    def _reset_metrics(self) -> None:
        """
        重置指标计数器

        作用：
            每次调用开始前重置指标，确保 last_metrics 反映的是最近一次调用的数据。
            委托给 CallMetrics.reset()，通过 ContextVar.set() 在当前上下文中
            设置新字典，不影响其他并发请求。
        """
        CallMetrics.reset()

    # ============================================
    # 非流式调用
    # ============================================

    def invoke(self, messages: List[BaseMessage]) -> str:
        """
        非流式调用 LLM（带降级路由）

        作用：
            同步调用 LLM 生成完整回答。
            遍历主模型和降级模型列表，依次尝试直到成功。

        容错流程：
            1. 从 manager 获取 (primary, fallbacks) 客户端列表
            2. 遍历列表，依次尝试每个客户端的 invoke()
               - 客户端内部已处理重试+熔断+超时
            3. 成功 → 更新指标 → 返回结果
            4. 失败 → 尝试下一个降级客户端
            5. 全部失败 → 抛 LLMServiceError

        参数：
            messages: List[BaseMessage] - LangChain 消息列表（system/history/human）

        返回:
            str - LLM 生成的完整文本

        异常:
            LLMServiceError - 所有端点均调用失败（应走兜底回复）
        """
        # 重置本次调用的指标
        self._reset_metrics()
        llm_start = _time.time()

        # 获取主客户端 + 降级客户端列表
        primary, fallbacks = self._manager.get_text_client_with_fallback()
        all_clients = [primary] + list(fallbacks)

        failover_count = 0
        last_exc: Optional[Exception] = None

        for i, client in enumerate(all_clients):
            try:
                result = client.invoke(messages)

                # 成功 — 更新指标并返回
                CallMetrics.update(
                    llm_time_ms=int((_time.time() - llm_start) * 1000),
                    model_used=client.config.model,
                    provider_used=client.name,
                    retry_count=client.last_retry_count,
                    token_input=client.last_token_input,
                    token_output=client.last_token_output,
                    failover_count=failover_count,
                )
                return result

            except CircuitBreakerOpenError as e:
                # M-14: 异常路径指标填充——熔断器打开时也记录 model_used/provider_used
                # circuit_open 场景：监控能追踪到"尝试了哪个模型但被熔断"
                CallMetrics.update(
                    model_used=client.config.model,
                    provider_used=client.name,
                )
                last_exc = e
                failover_count += 1
                logger.warning(
                    f"客户端({client.name})熔断器打开，尝试下一个降级端点"
                )
                continue

            except ModelInvocationError as e:
                # M-14: 异常路径指标填充——调用失败时也记录 model_used/provider_used
                CallMetrics.update(
                    model_used=client.config.model,
                    provider_used=client.name,
                )
                last_exc = e
                failover_count += 1
                logger.warning(
                    f"客户端({client.name})调用失败: {type(e).__name__}: {e}，"
                    f"尝试下一个降级端点"
                )
                continue

        # 所有端点均失败
        # M-14: 异常路径指标填充——全部失败时记录耗时和降级次数
        CallMetrics.update(
            llm_time_ms=int((_time.time() - llm_start) * 1000),
            failover_count=failover_count,
        )
        raise LLMServiceError(
            f"LLM 服务不可用：所有端点（{[c.name for c in all_clients]}）均调用失败 "
            f"({type(last_exc).__name__}: {last_exc})"
        ) from last_exc

    # ============================================
    # 流式调用
    # ============================================

    async def astream(self, messages: List[BaseMessage]) -> AsyncGenerator[str, None]:
        """
        流式调用 LLM（带降级路由）

        作用：
            异步流式生成回答，逐块 yield 文本。
            遍历主模型和降级模型列表，依次尝试获取首字。

        容错流程：
            1. 从 manager 获取 (primary, fallbacks) 客户端列表
            2. 遍历列表，依次尝试获取首字
               - 客户端内部已处理重试+熔断+首字超时
            3. 首字成功 → yield 首字 + 消费剩余流（不再重试）
            4. 首字失败 → 尝试下一个降级客户端
            5. 全部失败 → 抛 LLMServiceError

        参数：
            messages: List[BaseMessage] - 消息列表

        返回:
            AsyncGenerator[str, None] - 文本块生成器

        异常:
            LLMServiceError - 所有端点均调用失败

        说明：
            一旦开始 yield（首字成功后），即使中途出错也不再重试/降级，
            避免重复输出。这与原实现行为一致。
        """
        # 重置本次调用的指标
        self._reset_metrics()
        llm_start = _time.time()

        # 获取主客户端 + 降级客户端列表
        primary, fallbacks = self._manager.get_text_client_with_fallback()
        all_clients = [primary] + list(fallbacks)

        failover_count = 0
        last_exc: Optional[Exception] = None

        for i, client in enumerate(all_clients):
            gen = client.astream(messages)
            try:
                # 尝试获取首字——这是错误可能发生的地方
                # OpenAITextClient.astream() 内部处理了重试+熔断+首字超时
                first_chunk = await gen.__anext__()

            except StopAsyncIteration:
                # 空流：LLM 返回空内容，视为成功
                CallMetrics.update(
                    llm_time_ms=int((_time.time() - llm_start) * 1000),
                    model_used=client.config.model,
                    provider_used=client.name,
                    retry_count=client.last_retry_count,
                    failover_count=failover_count,
                )
                return  # 空响应，结束生成器

            except CircuitBreakerOpenError as e:
                # M-14: 异常路径指标填充——circuit_open 时记录 model_used/provider_used
                CallMetrics.update(
                    model_used=client.config.model,
                    provider_used=client.name,
                )
                last_exc = e
                failover_count += 1
                logger.warning(
                    f"客户端({client.name})熔断器打开，尝试下一个降级端点"
                )
                continue

            except Exception as e:
                # ModelInvocationError 或其他错误，尝试下一个降级客户端
                # M-14: 异常路径指标填充
                CallMetrics.update(
                    model_used=client.config.model,
                    provider_used=client.name,
                )
                last_exc = e
                failover_count += 1
                logger.warning(
                    f"客户端({client.name})流式调用失败: {type(e).__name__}: {e}，"
                    f"尝试下一个降级端点"
                )
                continue

            # 首字获取成功——更新指标，然后 yield 首字 + 消费剩余流
            # 注意：一旦开始 yield，不再重试/降级（避免重复输出）
            CallMetrics.update(
                model_used=client.config.model,
                provider_used=client.name,
                retry_count=client.last_retry_count,
                failover_count=failover_count,
            )
            try:
                yield first_chunk
                async for chunk in gen:
                    yield chunk
            finally:
                # 记录 LLM 总耗时（含建立连接+流式传输）
                CallMetrics.update(
                    llm_time_ms=int((_time.time() - llm_start) * 1000)
                )
            return  # 成功完成，结束生成器

        # 所有端点均失败
        CallMetrics.update(
            llm_time_ms=int((_time.time() - llm_start) * 1000),
            failover_count=failover_count,
        )
        raise LLMServiceError(
            f"LLM 流式服务不可用：所有端点（{[c.name for c in all_clients]}）均调用失败 "
            f"({type(last_exc).__name__}: {last_exc})"
        ) from last_exc


# ============================================
# 全局实例（懒加载，线程安全）
# ============================================

# M-13 修复：加线程锁防止多线程并发创建重复实例
_llm_service_instance: Optional[LLMResilienceService] = None
_llm_service_lock = threading.Lock()


def get_llm_service() -> LLMResilienceService:
    """
    获取 LLM 容错服务实例（懒加载单例，线程安全）

    作用：
        避免应用启动时就创建 LLM 实例（需要 API Key）。
        首次调用时创建，后续复用。
        M-13 修复：使用 threading.Lock 保护单例创建，防止多线程并发
        时创建多个实例（原实现 check-then-create 存在竞态）。

    返回:
        LLMResilienceService - LLM 容错服务实例
    """
    global _llm_service_instance
    if _llm_service_instance is None:
        with _llm_service_lock:
            if _llm_service_instance is None:
                _llm_service_instance = LLMResilienceService()
    return _llm_service_instance
