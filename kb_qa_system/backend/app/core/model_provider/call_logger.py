"""
模型调用结构化日志记录器

作用：
    记录每次模型调用的详细信息，包括：
    - 调用时间、model_type、provider_name、model_name
    - 耗时、重试次数、token 用量
    - 成功/失败、失败原因
    - 熔断器状态变化
    - 降级切换事件
    - 健康探测事件

日志级别：
    - INFO: 成功调用
    - WARNING: 重试/降级切换
    - ERROR: 调用失败

实现方式：
    使用标准 logging + 结构化字段（structlog 已安装但为减少依赖，
    此处用标准 logging 的 extra 参数传递结构化字段）。
    生产环境可通过 structlog 或 json formatter 将 extra 字段转为 JSON。
"""

import logging
import time
from typing import Optional

logger = logging.getLogger("model_provider.call")


class ModelCallLogger:
    """
    模型调用日志记录器

    作用：
        为所有模型调用提供统一的结构化日志记录。
        记录的信息可用于：调用追踪、性能分析、成本统计、故障排查。

    使用方式：
        call_logger = get_call_logger()
        call_logger.log_call(
            model_type="llm", provider_name="primary",
            model_name="gpt-3.5-turbo",
            duration_ms=2300, success=True,
            token_input=100, token_output=200,
        )
    """

    def log_call(
        self,
        *,
        model_type: str,
        provider_name: str,
        model_name: str,
        duration_ms: int,
        success: bool,
        retry_count: int = 0,
        token_input: int = 0,
        token_output: int = 0,
        error: Optional[str] = None,
        breaker_state_before: str = "closed",
        breaker_state_after: str = "closed",
        **extra,
    ):
        """
        记录一次模型调用

        作用：
            在模型调用完成后记录详细信息。
            日志级别根据 success 和 retry_count 自动决定。

        参数：
            model_type: str - 模型类型（llm/embedding/vision）
            provider_name: str - 端点名称（primary/fallback）
            model_name: str - 模型名称
            duration_ms: int - 调用耗时（毫秒）
            success: bool - 是否成功
            retry_count: int - 重试次数（默认0）
            token_input: int - 输入 Token 数（默认0）
            token_output: int - 输出 Token 数（默认0）
            error: Optional[str] - 错误信息（失败时）
            breaker_state_before: str - 调用前熔断器状态
            breaker_state_after: str - 调用后熔断器状态
            **extra: 额外字段
        """
        # 构建结构化日志字段
        fields = {
            "model_type": model_type,
            "provider": provider_name,
            "model": model_name,
            "duration_ms": duration_ms,
            "success": success,
            "retry_count": retry_count,
            "token_input": token_input,
            "token_output": token_output,
            "breaker_before": breaker_state_before,
            "breaker_after": breaker_state_after,
        }
        fields.update(extra)

        if error:
            fields["error"] = error

        # 日志级别决策
        if not success:
            msg = (
                f"[{model_type}:{provider_name}] 调用失败 "
                f"({duration_ms}ms, retry={retry_count}): {error}"
            )
            logger.error(msg, extra=fields)
        elif retry_count > 0:
            msg = (
                f"[{model_type}:{provider_name}] 调用成功（含重试） "
                f"({duration_ms}ms, retry={retry_count}, "
                f"tokens={token_input}+{token_output})"
            )
            logger.warning(msg, extra=fields)
        else:
            msg = (
                f"[{model_type}:{provider_name}] 调用成功 "
                f"({duration_ms}ms, tokens={token_input}+{token_output})"
            )
            logger.info(msg, extra=fields)

    def log_failover(
        self,
        model_type: str,
        from_provider: str,
        to_provider: str,
        reason: str,
    ):
        """
        记录降级切换事件

        作用：
            当主模型不可用切换到降级模型时记录。
            用于追踪降级频率和原因。

        参数：
            model_type: str - 模型类型
            from_provider: str - 原端点名称
            to_provider: str - 切换到的端点名称
            reason: str - 切换原因
        """
        msg = (
            f"[{model_type}] 降级切换: {from_provider} → {to_provider}, "
            f"原因: {reason}"
        )
        logger.warning(msg, extra={
            "event": "failover",
            "model_type": model_type,
            "from_provider": from_provider,
            "to_provider": to_provider,
            "reason": reason,
        })

    def log_health_probe(
        self,
        model_type: str,
        provider_name: str,
        success: bool,
        duration_ms: int,
    ):
        """
        记录健康探测事件

        作用：
            主动健康检查探测结果记录。
            用于追踪服务可用性趋势。

        参数：
            model_type: str - 模型类型
            provider_name: str - 端点名称
            success: bool - 探测是否成功
            duration_ms: int - 探测耗时（毫秒）
        """
        msg = (
            f"[{model_type}:{provider_name}] 健康探测 "
            f"{'成功' if success else '失败'} ({duration_ms}ms)"
        )
        if success:
            logger.debug(msg, extra={
                "event": "health_probe",
                "model_type": model_type,
                "provider": provider_name,
                "success": success,
                "duration_ms": duration_ms,
            })
        else:
            logger.warning(msg, extra={
                "event": "health_probe",
                "model_type": model_type,
                "provider": provider_name,
                "success": success,
                "duration_ms": duration_ms,
            })


# 全局单例
_call_logger_instance: Optional[ModelCallLogger] = None


def get_call_logger() -> ModelCallLogger:
    """
    获取调用日志记录器单例

    返回：
        ModelCallLogger - 日志记录器实例
    """
    global _call_logger_instance
    if _call_logger_instance is None:
        _call_logger_instance = ModelCallLogger()
    return _call_logger_instance
