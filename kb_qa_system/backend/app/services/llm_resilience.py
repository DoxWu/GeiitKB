"""
LLM 容错服务模块

作用：
    为 LLM 调用提供生产级容错能力，集成四种机制：
    1. 重试（tenacity 指数退避）：仅对瞬时错误（超时/网络/429/5xx）重试，
       不重试熔断打开错误和 4xx 客户端错误
    2. 熔断器（Redis）：服务级保护，连续失败达阈值后快速失败，
       避免故障级联和资源耗尽
    3. 超时控制：非流式调用总超时 + 流式首字超时（首字迟迟不来则降级）
    4. 模型降级：主模型重试耗尽后，自动切换到备用模型尝试一次

设计原则：
    - 熔断器打开时不重试、不降级（直接快速失败，让上层走兜底）
    - 4xx 错误不重试（输入有问题，重试无意义）
    - 流式调用只对"建立连接+首字"阶段重试，开始流式后不再重试

使用方式：
    from app.services.llm_resilience import get_llm_service

    # 非流式
    answer = llm_service.invoke(messages)

    # 流式
    async for chunk in llm_service.astream(messages):
        print(chunk, end="")
"""

import asyncio
import logging
import contextvars
import threading
from typing import Any, AsyncGenerator, List, Optional

from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage
from tenacity import (
    Retrying,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception,
)

from app.core.config import settings
from app.core.circuit_breaker import (
    CircuitBreaker,
    CircuitBreakerOpenError,
    get_circuit_breaker,
)

logger = logging.getLogger(__name__)


# ============================================
# 上下文本地指标（ContextVar，解决并发竞态）
# ============================================

# 作用：
#     LLMResilienceService 是单例，被所有并发请求共享。
#     原实现用 self.last_metrics 实例属性存储调用指标，
#     多个并发请求同时写入会导致数据错乱（竞态条件）。
#
#     使用 contextvars.ContextVar 后，每个并发请求（无论是同步线程还是
#     asyncio Task）都会获得独立的 metrics 副本，互不干扰。
#
# 原理：
#     - 同步场景：每个线程有独立的 context
#     - 异步场景：每个 asyncio Task 复制父 context，修改不影响其他 Task
#     - 异步生成器：与调用方共享同一 context，写入对调用方可见
_metrics_ctx: contextvars.ContextVar = contextvars.ContextVar("llm_metrics")


# ============================================
# 异常定义
# ============================================

class LLMServiceError(Exception):
    """
    LLM 服务不可用异常

    作用：
        当主模型重试耗尽、备用模型也失败、且熔断器未打开时抛出。
        上层应捕获此异常走兜底回复（如"抱歉，服务暂时不可用"）。
    """


class LLMStreamTimeoutError(Exception):
    """
    流式首字超时异常

    作用：
        流式调用在 LLM_STREAM_FIRST_TOKEN_TIMEOUT 内未收到任何 chunk 时抛出。
        可重试，重试耗尽后降级为非流式。
    """


# ============================================
# 可重试异常判定
# ============================================

def _is_retryable(exc: BaseException) -> bool:
    """
    判断异常是否值得重试（瞬时错误）

    作用：
        tenacity 重试判定谓词。只有瞬时错误（网络抖动、超时、限流、服务端临时故障）
        才值得重试；客户端错误（4xx，如参数错误、鉴权失败）和熔断打开错误不重试。

    判定规则：
        - CircuitBreakerOpenError：不重试（主动熔断信号）
        - openai.APITimeoutError / APIConnectionError / RateLimitError / InternalServerError：重试
        - openai.APIStatusError 且 status_code >= 500：重试
        - 通用 TimeoutError / ConnectionError / OSError：重试
        - httpx.TimeoutException：重试
        - 其他：不重试

    参数：
        exc: BaseException - 捕获到的异常

    返回:
        bool - True 表示可重试，False 表示不可重试
    """
    # 熔断器打开：不重试（这是主动快速失败信号）
    if isinstance(exc, CircuitBreakerOpenError):
        return False

    # openai SDK 异常
    try:
        import openai
        if isinstance(exc, (
            openai.APITimeoutError,
            openai.APIConnectionError,
            openai.RateLimitError,
            openai.InternalServerError,
        )):
            return True
        # 5xx 服务端错误：可重试
        if isinstance(exc, openai.APIStatusError) and getattr(exc, "status_code", 0) >= 500:
            return True
    except ImportError:
        pass

    # 通用网络/超时异常
    if isinstance(exc, (TimeoutError, ConnectionError, OSError)):
        return True

    # httpx 超时
    try:
        import httpx
        if isinstance(exc, httpx.TimeoutException):
            return True
    except ImportError:
        pass

    # 流式首字超时：可重试
    if isinstance(exc, LLMStreamTimeoutError):
        return True

    return False


# ============================================
# LLM 容错服务
# ============================================

class LLMResilienceService:
    """
    LLM 容错服务

    作用：
        封装 ChatOpenAI，对外提供带容错的 invoke/astream 接口。
        调用方无需关心重试、熔断、超时、降级细节。

    容错链路（非流式）：
        1. 检查熔断器 → 打开则快速失败
        2. 主模型重试（指数退避，最多 LLM_MAX_RETRIES 次）
        3. 主模型重试耗尽 → 降级到备用模型（单次尝试）
        4. 备用模型也失败 → 抛 LLMServiceError

    容错链路（流式）：
        1. 检查熔断器
        2. 带重试地建立流并获取首字（首字超时 LLM_STREAM_FIRST_TOKEN_TIMEOUT）
        3. 首字成功后不再重试，直接消费剩余流
        4. 主模型流式失败 → 降级到备用模型流式
    """

    def __init__(self):
        """
        初始化 LLM 容错服务

        作用：
            创建主模型、备用模型实例（分流式/非流式），以及熔断器。

        实现方式：
            - 主模型用 LLM_MODEL_NAME，备用模型用 LLM_FALLBACK_MODEL_NAME
            - 流式/非流式用独立实例（LangChain 通过 streaming 参数控制）
            - 非流式 request_timeout=LLM_TIMEOUT，流式不设总超时（用首字超时控制）
            - 共用一个 "llm" 服务的熔断器
            - last_metrics 通过 ContextVar 实现并发隔离（不再用实例属性）
        """
        common_kwargs = dict(
            openai_api_key=settings.OPENAI_API_KEY,
            openai_api_base=settings.OPENAI_API_BASE,
            temperature=0.1,  # 低温度，回答更确定
        )

        # 主模型（非流式）
        self.primary_llm = ChatOpenAI(
            model=settings.LLM_MODEL_NAME,
            streaming=False,
            request_timeout=settings.LLM_TIMEOUT,
            **common_kwargs,
        )
        # 主模型（流式）
        self.primary_stream_llm = ChatOpenAI(
            model=settings.LLM_MODEL_NAME,
            streaming=True,
            **common_kwargs,
        )
        # 备用模型（非流式）
        self.fallback_llm = ChatOpenAI(
            model=settings.LLM_FALLBACK_MODEL_NAME,
            streaming=False,
            request_timeout=settings.LLM_TIMEOUT,
            **common_kwargs,
        )
        # 备用模型（流式）
        self.fallback_stream_llm = ChatOpenAI(
            model=settings.LLM_FALLBACK_MODEL_NAME,
            streaming=True,
            **common_kwargs,
        )

        # 共用 "llm" 服务的熔断器
        self.breaker: CircuitBreaker = get_circuit_breaker("llm")

    # ============================================
    # 指标管理（ContextVar 实现，并发安全）
    # ============================================

    @staticmethod
    def _default_metrics() -> dict:
        """
        创建默认的指标字典

        作用：
            提供指标字典的初始模板，包含所有字段及默认值。
            每次调用 invoke/astream 时通过 _reset_metrics() 创建新副本。

        返回:
            dict - 包含所有指标字段的字典
                - retry_count: 重试次数
                - llm_time_ms: LLM 调用耗时（毫秒）
                - model_used: 实际使用的模型名称
                - token_input: 输入 Token 数
                - token_output: 输出 Token 数
        """
        return {
            "retry_count": 0,
            "llm_time_ms": 0,
            "model_used": "",
            "token_input": 0,
            "token_output": 0,
        }

    @property
    def last_metrics(self) -> dict:
        """
        获取当前上下文的调用指标（并发安全）

        作用：
            替代原来的 self.last_metrics 实例属性。
            通过 ContextVar 实现每个并发请求获得独立的指标副本。

        实现方式：
            - 从 _metrics_ctx ContextVar 读取当前上下文的指标字典
            - 如果当前上下文未设置过（首次访问），创建默认值并设置

        返回:
            dict - 当前调用的指标字典（可变，直接修改即可）

        注意：
            此属性是并发安全的——不同请求/线程/asyncio Task
            会各自获得独立的字典，互不干扰。
        """
        try:
            return _metrics_ctx.get()
        except LookupError:
            # 当前上下文未设置过，创建默认值
            metrics = self._default_metrics()
            _metrics_ctx.set(metrics)
            return metrics

    @last_metrics.setter
    def last_metrics(self, value: dict) -> None:
        """
        设置当前上下文的调用指标

        作用：
            供 _reset_metrics() 调用，在每次 invoke/astream 开始时
            设置一个全新的指标字典到当前上下文。
        """
        _metrics_ctx.set(value)

    # ============================================
    # 非流式调用
    # ============================================

    def _reset_metrics(self) -> None:
        """
        重置指标计数器

        作用：
            每次调用开始前重置指标，确保 last_metrics 反映的是最近一次调用的数据。
            通过 ContextVar.set() 在当前上下文中设置新字典，不影响其他并发请求。
        """
        self.last_metrics = self._default_metrics()

    def _extract_token_usage(self, result: Any) -> tuple:
        """
        从 LLM 响应中提取 Token 用量

        作用：
            解析 LangChain AIMessage 中的 usage_metadata / response_metadata，
            提取输入/输出 Token 数，用于成本统计。

        实现方式：
            1. 优先读 usage_metadata（LangChain 0.3+ 标准）
            2. 回退到 response_metadata.token_usage（OpenAI 原始格式）
            3. 都没有则返回 (0, 0)

        参数：
            result: Any - LLM 返回的 AIMessage 对象

        返回:
            tuple - (input_tokens, output_tokens)
        """
        try:
            # LangChain 0.3+ 标准 usage_metadata
            usage = getattr(result, "usage_metadata", None)
            if usage:
                return (
                    int(usage.get("input_tokens", 0)),
                    int(usage.get("output_tokens", 0)),
                )
            # OpenAI 原始格式 response_metadata.token_usage
            resp_meta = getattr(result, "response_metadata", None)
            if resp_meta:
                token_usage = resp_meta.get("token_usage", {})
                return (
                    int(token_usage.get("prompt_tokens", 0)),
                    int(token_usage.get("completion_tokens", 0)),
                )
        except Exception:
            pass
        return 0, 0

    def invoke(self, messages: List[BaseMessage]) -> str:
        """
        非流式调用 LLM（带重试+熔断+降级）

        作用：
            同步调用 LLM 生成完整回答，内置容错链路。

        容错流程：
            1. 熔断器打开 → 直接抛 CircuitBreakerOpenError
            2. 主模型重试（指数退避，最多 LLM_MAX_RETRIES 次）
            3. 重试耗尽或不可重试错误 → 降级到备用模型（单次）
            4. 备用模型也失败 → 抛 LLMServiceError

        参数：
            messages: List[BaseMessage] - LangChain 消息列表（system/history/human）

        返回:
            str - LLM 生成的完整文本

        异常:
            CircuitBreakerOpenError - 熔断器打开（应走兜底回复）
            LLMServiceError - 主备模型均失败（应走兜底回复）
        """
        # 重置本次调用的指标
        self._reset_metrics()
        import time as _time
        llm_start = _time.time()

        # 1. 熔断器检查（打开则快速失败，不尝试任何调用）
        if self.breaker.is_open():
            # M-14 修复：熔断打开也记录耗时（近 0ms），model_used 留空表示未实际调用
            self.last_metrics["llm_time_ms"] = int((_time.time() - llm_start) * 1000)
            self.last_metrics["model_used"] = "(circuit_open)"
            raise CircuitBreakerOpenError(self.breaker.service, self.breaker.get_retry_after())

        # 2. 主模型：带重试地调用
        try:
            result = self._invoke_with_retry(self.primary_llm, messages)
            self.last_metrics["llm_time_ms"] = int((_time.time() - llm_start) * 1000)
            self.last_metrics["model_used"] = settings.LLM_MODEL_NAME
            return result
        except CircuitBreakerOpenError:
            # 重试过程中熔断器打开了，快速失败
            # M-14 修复：异常路径也记录耗时和模型，便于监控分析
            self.last_metrics["llm_time_ms"] = int((_time.time() - llm_start) * 1000)
            self.last_metrics["model_used"] = settings.LLM_MODEL_NAME
            raise
        except Exception as primary_err:
            # 主模型彻底失败（重试耗尽或不可重试错误）
            # M-14 修复：异常路径记录耗时和模型，便于排查降级原因
            self.last_metrics["llm_time_ms"] = int((_time.time() - llm_start) * 1000)
            self.last_metrics["model_used"] = settings.LLM_MODEL_NAME
            logger.warning(
                f"主模型({settings.LLM_MODEL_NAME})调用失败: {type(primary_err).__name__}: {primary_err}，"
                f"降级到备用模型({settings.LLM_FALLBACK_MODEL_NAME})"
            )

        # 3. 降级：备用模型单次尝试（不重试，避免雪崩）
        try:
            result = self._invoke_once(self.fallback_llm, messages)
            self.last_metrics["llm_time_ms"] = int((_time.time() - llm_start) * 1000)
            self.last_metrics["model_used"] = settings.LLM_FALLBACK_MODEL_NAME
            return result
        except CircuitBreakerOpenError:
            # M-14 修复：异常路径记录耗时和模型
            self.last_metrics["llm_time_ms"] = int((_time.time() - llm_start) * 1000)
            self.last_metrics["model_used"] = settings.LLM_FALLBACK_MODEL_NAME
            raise
        except Exception as fallback_err:
            # M-14 修复：异常路径记录耗时和模型，便于排查双模型均失败的原因
            self.last_metrics["llm_time_ms"] = int((_time.time() - llm_start) * 1000)
            self.last_metrics["model_used"] = settings.LLM_FALLBACK_MODEL_NAME
            logger.error(
                f"备用模型也失败: {type(fallback_err).__name__}: {fallback_err}"
            )
            raise LLMServiceError(
                f"LLM 服务不可用：主模型({settings.LLM_MODEL_NAME})和备用模型"
                f"({settings.LLM_FALLBACK_MODEL_NAME})均调用失败"
            ) from fallback_err

    def _invoke_with_retry(self, llm: ChatOpenAI, messages: List[BaseMessage]) -> str:
        """
        带重试的单模型调用

        作用：
            用 tenacity 包裹单次调用，对瞬时错误指数退避重试。
            同时追踪重试次数到 last_metrics。

        实现方式：
            - Retrying 程序化构建重试器（不用装饰器，便于参数动态注入）
            - stop_after_attempt(LLM_MAX_RETRIES + 1)：最多尝试 N+1 次（1次+ N次重试）
            - wait_exponential：指数退避 base * 2^attempt，上限 60s
            - retry_if_exception(_is_retryable)：仅瞬时错误重试
            - reraise=True：重试耗尽后抛出最后一次的原始异常（非 RetryError）
            - before_sleep 回调累加 retry_count（仅真正发生重试时才计数）

        参数：
            llm: ChatOpenAI - LLM 实例
            messages: List[BaseMessage] - 消息列表

        返回:
            str - LLM 生成的文本

        异常:
            重试耗尽时抛出最后一次的异常
        """
        # 重试计数器
        # 作用：通过 before_sleep 回调累加，统计实际重试次数（不含首次尝试）
        retry_counter = {"count": 0}

        def _count_retry(retry_state):
            """before_sleep 回调：每次进入睡眠（即将重试）时计数+1"""
            retry_counter["count"] += 1

        retryer = Retrying(
            stop=stop_after_attempt(settings.LLM_MAX_RETRIES + 1),
            wait=wait_exponential(
                multiplier=settings.LLM_RETRY_BASE_DELAY,
                min=settings.LLM_RETRY_BASE_DELAY,
                max=60,
            ),
            retry=retry_if_exception(_is_retryable),
            before_sleep=_count_retry,
            reraise=True,
        )
        try:
            result = retryer(self._invoke_once, llm, messages)
            return result
        finally:
            # 无论成功失败，都记录本次重试次数到 metrics
            self.last_metrics["retry_count"] = retry_counter["count"]

    def _invoke_once(self, llm: ChatOpenAI, messages: List[BaseMessage]) -> str:
        """
        单次 LLM 调用（带熔断器集成+Token 提取）

        作用：
            执行一次 LLM 调用，前后更新熔断器状态，成功时提取 Token 用量。

        实现方式：
            1. 调用前再次检查熔断器（重试期间可能被其他请求打开）
            2. 执行 llm.invoke
            3. 成功 → breaker.record_success + 提取 Token 用量到 last_metrics
            4. 失败 → 仅对可重试错误 record_failure（4xx 不影响熔断器）

        参数：
            llm: ChatOpenAI - LLM 实例
            messages: List[BaseMessage] - 消息列表

        返回:
            str - LLM 生成的文本
        """
        # 重试期间熔断器可能被其他请求打开，再次检查
        if self.breaker.is_open():
            raise CircuitBreakerOpenError(self.breaker.service, self.breaker.get_retry_after())

        try:
            result = llm.invoke(messages)
            self.breaker.record_success()
            # 提取 Token 用量到 metrics（累加，因流式可能多段）
            in_tok, out_tok = self._extract_token_usage(result)
            self.last_metrics["token_input"] += in_tok
            self.last_metrics["token_output"] += out_tok
            return result.content if hasattr(result, "content") else str(result)
        except Exception as e:
            # 仅瞬时错误计入熔断器（4xx 客户端错误不代表服务不可用）
            if _is_retryable(e):
                self.breaker.record_failure()
            raise

    # ============================================
    # 流式调用
    # ============================================

    async def astream(self, messages: List[BaseMessage]) -> AsyncGenerator[str, None]:
        """
        流式调用 LLM（带重试+熔断+首字超时+降级）

        作用：
            异步流式生成回答，逐块 yield 文本。
            同时追踪 llm_time_ms / model_used / retry_count 到 last_metrics。

        容错流程：
            1. 熔断器打开 → 直接抛 CircuitBreakerOpenError
            2. 主模型：带重试地"建立流+获取首字"
               - 首字超时 LLM_STREAM_FIRST_TOKEN_TIMEOUT 秒 → 重试
               - 成功获取首字后不再重试，直接消费剩余流
            3. 主模型失败 → 降级到备用模型流式（在 _astream_first_with_retry 内部处理）
            4. 备用模型也失败 → 抛 LLMServiceError

        参数：
            messages: List[BaseMessage] - 消息列表

        返回:
            AsyncGenerator[str, None] - 文本块生成器

        异常:
            CircuitBreakerOpenError - 熔断器打开
            LLMServiceError - 主备模型均失败

        说明：
            本方法是异步生成器，调用方需用 async for 消费。
            重试只发生在"建立连接+首字"阶段；一旦开始流式输出，
            即使中途出错也不重试（避免重复输出）。
            流式模式下 Token 用量通常无法精确获取（需 stream_options），
            token_input/token_output 保持为 0，仅追踪耗时和重试次数。
        """
        # 重置本次调用的指标
        self._reset_metrics()
        import time as _time
        llm_start = _time.time()

        # 1. 熔断器检查
        if self.breaker.is_open():
            self.last_metrics["llm_time_ms"] = int((_time.time() - llm_start) * 1000)
            raise CircuitBreakerOpenError(self.breaker.service, self.breaker.get_retry_after())

        # 2. 主模型：带重试地获取首字 + 流
        # 注意：_astream_first_with_retry 内部会在主模型重试耗尽时自动降级到备用模型，
        #       并设置 last_metrics["model_used"] 和 retry_count
        first_chunk, stream_agen = await self._astream_first_with_retry(
            self.primary_stream_llm, messages
        )

        # 首字成功，消费剩余流
        # 注意：首字已是字符串（在 _astream_first_with_retry 中转换过），
        # 但后续 chunk 仍是 BaseMessageChunk 对象，需转为字符串
        try:
            if first_chunk is not None:
                yield first_chunk
            async for chunk in stream_agen:
                yield chunk.content if hasattr(chunk, "content") else str(chunk)
        finally:
            # 记录 LLM 总耗时（含建立连接+流式传输）
            self.last_metrics["llm_time_ms"] = int((_time.time() - llm_start) * 1000)
        return

    async def _astream_first_with_retry(
        self,
        llm: ChatOpenAI,
        messages: List[BaseMessage],
    ) -> tuple:
        """
        带重试地建立流并获取首字

        作用：
            流式调用的核心容错环节：重试只覆盖"建立连接+首字"阶段。
            成功后返回 (首字, 流生成器)，由调用方继续消费。
            同时追踪 retry_count 和 model_used 到 last_metrics。

        实现方式：
            1. 循环最多 LLM_MAX_RETRIES + 1 次
            2. 每次尝试：熔断检查 → 建立流 → asyncio.wait_for 取首字
            3. 首字超时 → 抛 LLMStreamTimeoutError（可重试）
            4. 成功 → record_success + 设置 model_used，返回
            5. 失败 → record_failure，指数退避后重试（retry_count+1）
            6. 重试耗尽 → 降级到备用模型（设置 model_used=fallback）

        参数：
            llm: ChatOpenAI - 流式 LLM 实例
            messages: List[BaseMessage] - 消息列表

        返回:
            tuple - (first_chunk: Optional[str], stream_agen: AsyncGenerator)
            first_chunk 为 None 表示流为空（LLM 返回空内容）

        异常:
            重试耗尽且备用模型也失败时抛出 LLMServiceError / CircuitBreakerOpenError
        """
        last_exc: Optional[Exception] = None
        max_attempts = settings.LLM_MAX_RETRIES + 1
        retry_count = 0  # 实际重试次数（不含首次尝试）

        for attempt in range(1, max_attempts + 1):
            stream_agen = None
            try:
                # 熔断检查（重试期间可能被打开）
                if self.breaker.is_open():
                    raise CircuitBreakerOpenError(
                        self.breaker.service, self.breaker.get_retry_after()
                    )

                # 建立流
                stream_agen = llm.astream(messages).__aiter__()

                # 等待首字（带超时）
                # 作用：首字迟迟不来说明 LLM 响应慢或卡住，应重试/降级
                try:
                    first_chunk = await asyncio.wait_for(
                        stream_agen.__anext__(),
                        timeout=settings.LLM_STREAM_FIRST_TOKEN_TIMEOUT,
                    )
                except asyncio.TimeoutError:
                    raise LLMStreamTimeoutError(
                        f"流式首字超时（{settings.LLM_STREAM_FIRST_TOKEN_TIMEOUT}s 未收到响应）"
                    )
                except StopAsyncIteration:
                    # 空流：LLM 返回空内容，视为成功（无内容可输出）
                    self.breaker.record_success()
                    self.last_metrics["retry_count"] = retry_count
                    self.last_metrics["model_used"] = settings.LLM_MODEL_NAME
                    return (None, _empty_async_gen())

                # 首字获取成功
                self.breaker.record_success()
                self.last_metrics["retry_count"] = retry_count
                self.last_metrics["model_used"] = settings.LLM_MODEL_NAME
                first_text = first_chunk.content if hasattr(first_chunk, "content") else str(first_chunk)
                return (first_text, stream_agen)

            except CircuitBreakerOpenError:
                # 熔断打开：不重试，直接抛出
                if stream_agen is not None:
                    await stream_agen.aclose()
                self.last_metrics["retry_count"] = retry_count
                raise
            except Exception as e:
                last_exc = e
                # 清理未完成的流
                if stream_agen is not None:
                    try:
                        await stream_agen.aclose()
                    except Exception:
                        pass
                # 仅可重试错误计入熔断器
                if _is_retryable(e):
                    self.breaker.record_failure()

                # 不可重试或已耗尽：跳出降级
                if not _is_retryable(e) or attempt >= max_attempts:
                    break

                # 即将重试，计数+1
                retry_count += 1
                # 指数退避
                delay = min(settings.LLM_RETRY_BASE_DELAY * (2 ** (attempt - 1)), 60)
                logger.warning(
                    f"流式调用第{attempt}/{max_attempts}次失败: "
                    f"{type(e).__name__}: {e}，{delay:.1f}s 后重试"
                )
                await asyncio.sleep(delay)

        # 主模型重试耗尽，降级到备用模型流式
        logger.warning(
            f"主模型流式调用失败({type(last_exc).__name__})，降级到备用模型"
        )
        self.last_metrics["retry_count"] = retry_count
        self.last_metrics["model_used"] = settings.LLM_FALLBACK_MODEL_NAME
        return await self._fallback_astream(messages)

    async def _fallback_astream(self, messages: List[BaseMessage]) -> tuple:
        """
        备用模型流式调用（单次，不重试）

        作用：
            主模型流式失败后的降级路径。单次尝试，失败则抛 LLMServiceError。

        参数：
            messages: List[BaseMessage] - 消息列表

        返回:
            tuple - (first_chunk, stream_agen)

        异常:
            CircuitBreakerOpenError - 熔断器打开
            LLMServiceError - 备用模型也失败
        """
        if self.breaker.is_open():
            raise CircuitBreakerOpenError(self.breaker.service, self.breaker.get_retry_after())

        stream_agen = None
        try:
            stream_agen = self.fallback_stream_llm.astream(messages).__aiter__()
            first_chunk = await asyncio.wait_for(
                stream_agen.__anext__(),
                timeout=settings.LLM_STREAM_FIRST_TOKEN_TIMEOUT,
            )
            self.breaker.record_success()
            first_text = first_chunk.content if hasattr(first_chunk, "content") else str(first_chunk)
            return (first_text, stream_agen)
        except StopAsyncIteration:
            self.breaker.record_success()
            return (None, _empty_async_gen())
        except CircuitBreakerOpenError:
            raise
        except Exception as e:
            if _is_retryable(e):
                self.breaker.record_failure()
            if stream_agen is not None:
                try:
                    await stream_agen.aclose()
                except Exception:
                    pass
            raise LLMServiceError(
                f"LLM 流式服务不可用：主模型和备用模型均失败 ({type(e).__name__})"
            ) from e


async def _empty_async_gen() -> AsyncGenerator[str, None]:
    """
    空异步生成器

    作用：
        当 LLM 返回空流时，返回一个空的异步生成器保持接口一致。
    """
    return
    yield  # 使其成为 async generator（不会被实际执行到）


# ============================================
# 全局实例（懒加载）
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
