"""
降级路由器

作用：
    根据各客户端的健康状态（熔断器状态），选择应使用的客户端。
    确保主模型健康时绝不使用降级模型。

核心设计——单一事实来源：
    路由决策 100% 基于 CircuitBreaker 状态。
    主动健康检查的结果不直接参与路由，而是通过 breaker.record_failure() 喂入熔断器。
    这样既能让主动探测提前发现故障，又保证路由只有一个判断源，
    杜绝"主动检查误报导致误切降级"。

路由算法：
    select_client(model_type) 遍历 [primary, fallback1, ...]：
      - breaker CLOSED/HALF_OPEN → 返回此客户端（主模型优先）
      - breaker OPEN → 跳过，继续下一个
      - 全部 OPEN → 返回 primary（让它抛 CircuitBreakerOpenError）

正确性保证：
    1. 主模型 breaker CLOSED → 永远返回主模型，不用降级
    2. 主模型恢复（breaker CLOSED）→ 下次调用自动切回
    3. 主动健康检查误报 → 只喂 breaker 累计，需达阈值（默认5次）才 OPEN
    4. HALF_OPEN 状态可被选中（放行探测请求，由 breaker 控制只放行一个）

使用方式：
    router = FailoverRouter(registry)
    client = router.select_client("llm")
    answer = client.invoke(messages)
"""

import logging
from typing import List, Tuple

from app.core.model_provider.base import BaseModelClient
from app.core.model_provider.exceptions import ModelClientUnavailableError
from app.core.model_provider.registry import ModelServiceRegistry

logger = logging.getLogger(__name__)


class FailoverRouter:
    """
    降级路由器

    作用：
        根据熔断器状态选择健康的客户端。
        无状态（路由逻辑不依赖任何实例变量），天然并发安全。

    使用方式：
        router = FailoverRouter(registry)
        client = router.select_client("llm")
    """

    def __init__(self, registry: ModelServiceRegistry):
        """
        初始化路由器

        参数：
            registry: ModelServiceRegistry - 客户端注册表
        """
        self._registry = registry

    def select_client(self, model_type: str) -> BaseModelClient:
        """
        选择一个健康的客户端

        作用：
            按优先级遍历客户端列表，返回第一个熔断器未打开的。
            确保主模型健康时永远返回主模型。

        路由逻辑：
            1. 获取该类型所有 enabled 客户端（按优先级）
            2. 遍历，返回第一个 breaker.is_open() == False 的
            3. 全部 OPEN → 返回第一个（primary），由调用方处理 CircuitBreakerOpenError

        参数：
            model_type: str - 模型类型（llm/embedding/vision）

        返回:
            BaseModelClient - 选中的客户端

        异常:
            ModelClientUnavailableError - 无可用客户端（列表为空）

        注意：
            HALF_OPEN 状态的客户端也会被选中。
            CircuitBreaker.is_open() 在 HALF_OPEN 时：
              - 对探测请求返回 False（放行）
              - 对后续请求返回 True（拒绝）
            这是 CircuitBreaker 的设计：HALF_OPEN 时只放行一个探测请求。
        """
        clients = self._registry.get_clients(model_type)
        if not clients:
            raise ModelClientUnavailableError(
                f"无 {model_type} 类型的可用客户端（未注册或全部 disabled）"
            )

        # 遍历，找第一个健康的（breaker 未 OPEN）
        for client in clients:
            if not client.breaker.is_open():
                return client

        # 全部熔断，返回 primary（让调用方收到 CircuitBreakerOpenError）
        # 作用：让上层走兜底回复，而不是在这里静默返回降级模型
        logger.warning(
            f"[{model_type}] 所有端点熔断器均打开，返回 primary 让上层走兜底"
        )
        return clients[0]

    def select_with_fallback(
        self, model_type: str
    ) -> Tuple[BaseModelClient, List[BaseModelClient]]:
        """
        选择主客户端 + 返回可用降级列表

        作用：
            返回 (选中客户端, 剩余可用客户端列表)。
            调用方在主客户端调用失败后，可从降级列表中选下一个尝试。

        路由逻辑：
            1. 找第一个 breaker 未 OPEN 的作为 primary
            2. primary 之后所有 breaker 未 OPEN 的作为 fallback 列表
            3. 全部 OPEN → primary 为第一个，fallback 为空

        参数：
            model_type: str - 模型类型

        返回:
            Tuple[BaseModelClient, List[BaseModelClient]]
            - (primary_client, fallback_clients)
            - fallback_clients 不含 primary，且都是健康的

        异常:
            ModelClientUnavailableError - 无可用客户端
        """
        clients = self._registry.get_clients(model_type)
        if not clients:
            raise ModelClientUnavailableError(
                f"无 {model_type} 类型的可用客户端"
            )

        # 找第一个健康的作为 primary
        primary_idx = 0
        primary_found = False
        for i, client in enumerate(clients):
            if not client.breaker.is_open():
                primary_idx = i
                primary_found = True
                break

        if not primary_found:
            # 全部 OPEN，primary 用第一个，fallback 为空
            return clients[0], []

        primary = clients[primary_idx]
        # fallback = primary 之后所有健康的
        fallbacks = [
            c
            for i, c in enumerate(clients)
            if i != primary_idx and not c.breaker.is_open()
        ]
        return primary, fallbacks

    def get_available_count(self, model_type: str) -> int:
        """
        获取某类型的可用端点数（breaker 未 OPEN 的）

        作用：
            用于监控和日志，了解当前有多少端点可用。

        参数：
            model_type: str - 模型类型

        返回:
            int - 可用端点数
        """
        clients = self._registry.get_clients(model_type)
        return sum(1 for c in clients if not c.breaker.is_open())
