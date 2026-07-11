"""
模型提供者异常定义

作用：
    定义模型提供者模块的异常层级，用于区分不同类型的失败场景，
    便于上层业务代码做针对性处理（如走兜底回复、记录日志等）。

异常层级：
    ModelProviderError                    # 基础异常
    ├── ModelClientUnavailableError       # 客户端不可用（初始化失败/未配置）
    ├── ModelInvocationError              # 调用失败（包装底层异常）
    └── AllProvidersUnavailableError      # 所有 provider 均不可用
"""


class ModelProviderError(Exception):
    """
    模型提供者基础异常

    作用：
        所有模型提供者相关异常的基类。
        上层可捕获此异常统一处理模型服务问题。
    """


class ModelClientUnavailableError(ModelProviderError):
    """
    客户端不可用异常

    作用：
        当客户端初始化失败、配置缺失、或无可用 provider 时抛出。
        表示"无法获取可用的模型客户端"，属于配置/环境问题，非调用失败。
    """


class ModelInvocationError(ModelProviderError):
    """
    模型调用失败异常

    作用：
        包装底层 SDK 调用异常，保留原始异常链（__cause__）。
        上层可通过 original_exc 获取原始异常做进一步分析。

    参数：
        message: str - 错误描述
        provider_name: str - 失败的 provider 名称（如 "primary"）
        original_exc: Exception - 原始异常
    """

    def __init__(self, message: str, *, provider_name: str, original_exc: Exception):
        self.provider_name = provider_name
        self.original_exc = original_exc
        super().__init__(message)


class AllProvidersUnavailableError(ModelProviderError):
    """
    所有 provider 均不可用异常

    作用：
        当某 model_type 的所有 provider（主+全部降级）的熔断器均打开时抛出。
        表示该类型模型服务完全不可用，上层应走兜底逻辑。
    """
