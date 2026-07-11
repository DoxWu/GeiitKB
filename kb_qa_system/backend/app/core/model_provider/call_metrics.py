"""
调用指标追踪（ContextVar，并发安全）

作用：
    替代 llm_resilience.py 中的 _metrics_ctx，提取为通用模块。
    支持追踪：retry_count, time_ms, model_used, provider_used,
              token_input, token_output, failover_count

原理：
    - LLMResilienceService 是单例，被所有并发请求共享
    - 用实例属性存储指标会导致并发竞态（多请求互相覆盖）
    - ContextVar 为每个并发请求（线程/asyncio Task）提供独立副本
    - 同步场景：每个线程有独立 context
    - 异步场景：每个 asyncio Task 复制父 context，修改不影响其他 Task
    - 异步生成器：与调用方共享同一 context，写入对调用方可见
"""

import contextvars
from typing import Dict


# ContextVar 存储当前请求的指标字典
# 作用：并发隔离，每个请求获得独立的指标副本
_metrics_ctx: contextvars.ContextVar = contextvars.ContextVar("model_call_metrics")


def _default_metrics() -> dict:
    """
    创建默认的指标字典

    作用：
        提供指标字典的初始模板，包含所有字段及默认值。

    返回:
        dict - 包含所有指标字段的字典
            - retry_count: 重试次数
            - time_ms: 调用耗时（毫秒）
            - model_used: 实际使用的模型名称
            - provider_used: 实际使用的端点名称
            - token_input: 输入 Token 数
            - token_output: 输出 Token 数
            - failover_count: 降级切换次数
    """
    return {
        "retry_count": 0,
        "llm_time_ms": 0,
        "model_used": "",
        "provider_used": "",
        "token_input": 0,
        "token_output": 0,
        "failover_count": 0,
    }


class CallMetrics:
    """
    调用指标追踪（ContextVar 实现，并发安全）

    作用：
        为模型调用提供并发安全的指标追踪。
        替代 llm_resilience.py 中的 _metrics_ctx。

    使用方式：
        CallMetrics.reset()              # 调用开始前重置
        CallMetrics.update(model_used="gpt-3.5-turbo")
        metrics = CallMetrics.get()      # 读取指标
    """

    @staticmethod
    def reset() -> None:
        """
        重置当前上下文的指标

        作用：
            每次调用开始前重置指标，确保 get() 返回的是最近一次调用的数据。
            通过 ContextVar.set() 在当前上下文中设置新字典，不影响其他并发请求。
        """
        _metrics_ctx.set(_default_metrics())

    @staticmethod
    def get() -> dict:
        """
        获取当前上下文的调用指标

        作用：
            从 ContextVar 读取当前上下文的指标字典。
            如果当前上下文未设置过（首次访问），创建默认值并设置。

        返回:
            dict - 当前调用的指标字典（可变，直接修改即可）

        注意：
            此方法是并发安全的——不同请求/线程/asyncio Task
            会各自获得独立的字典，互不干扰。
        """
        try:
            return _metrics_ctx.get()
        except LookupError:
            # 当前上下文未设置过，创建默认值
            metrics = _default_metrics()
            _metrics_ctx.set(metrics)
            return metrics

    @staticmethod
    def update(**kwargs) -> None:
        """
        更新当前上下文的指标字段

        作用：
            修改当前上下文的指标字典中的指定字段。
            仅影响当前请求，不影响其他并发请求。

        参数：
            **kwargs: 要更新的字段，如 model_used="gpt-3.5-turbo", retry_count=2
        """
        metrics = CallMetrics.get()
        metrics.update(kwargs)
