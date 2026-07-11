"""
模型服务注册表

作用：
    管理所有已注册的模型客户端，支持动态添加/移除/切换端点。
    按 model_type 分组，每组维护有序客户端列表（primary 在前）。

线程安全：
    所有写操作加 threading.RLock，防止多线程并发修改导致数据不一致。

使用方式：
    registry = get_registry()
    clients = registry.get_clients("llm")  # 获取 LLM 客户端列表（按优先级）
    registry.register("llm", config)        # 动态注册新端点
    registry.swap_priority("llm", "primary", "fallback")  # 主备切换
"""

import logging
import threading
from typing import Dict, List, Optional

from app.core.model_provider.base import BaseModelClient
from app.core.model_provider.exceptions import ModelClientUnavailableError
from app.core.model_provider.factory import ModelClientFactory
from app.core.model_provider.schemas import ProviderEndpointConfig

logger = logging.getLogger(__name__)


class ModelServiceRegistry:
    """
    模型服务注册表

    作用：
        管理所有模型客户端实例，按 model_type 分组。
        每组内的客户端按优先级排序（index 0 = primary）。

    核心方法：
        - register(): 注册新端点（创建客户端并加入列表）
        - unregister(): 移除端点
        - get_clients(): 获取某类型的所有 enabled 客户端（按优先级）
        - get_client(): 按名称获取单个客户端
        - swap_priority(): 交换两个端点的优先级
        - list_all(): 列出所有端点状态

    线程安全：
        使用 threading.RLock 保护所有写操作。
        RLock 允许同一线程多次获取锁（避免递归死锁）。
    """

    def __init__(self):
        """
        初始化注册表

        作用：
            创建空的客户端字典和线程锁。
        """
        # 按 model_type 分组的客户端列表
        # 结构：{"llm": [client1, client2, ...], "embedding": [...], "vision": [...]}
        self._clients: Dict[str, List[BaseModelClient]] = {
            "llm": [],
            "embedding": [],
            "vision": [],
        }
        self._lock = threading.RLock()

    def register(
        self,
        model_type: str,
        config: ProviderEndpointConfig,
    ) -> BaseModelClient:
        """
        注册（添加）一个端点

        作用：
            根据配置创建客户端实例，并添加到对应 model_type 的列表末尾。
            如果同名端点已存在，先移除旧的再添加新的（热更新）。

        参数：
            model_type: str - 模型类型（llm/embedding/vision）
            config: ProviderEndpointConfig - 端点配置

        返回:
            BaseModelClient - 创建的客户端实例

        异常:
            ModelClientUnavailableError - 创建失败
        """
        if model_type not in self._clients:
            self._clients[model_type] = []

        with self._lock:
            # 同名端点已存在则先移除（热更新场景）
            self._clients[model_type] = [
                c for c in self._clients[model_type] if c.name != config.name
            ]

            # 创建新客户端
            client = ModelClientFactory.create_client(config, model_type)
            self._clients[model_type].append(client)

            logger.info(
                f"已注册模型端点: [{model_type}:{config.name}] "
                f"type={config.type}, model={config.model}, enabled={config.enabled}"
            )
            return client

    def unregister(self, model_type: str, name: str) -> bool:
        """
        移除一个端点

        作用：
            按名称移除指定端点，释放其资源。

        参数：
            model_type: str - 模型类型
            name: str - 端点名称

        返回:
            bool - 是否成功移除（False 表示不存在）
        """
        with self._lock:
            clients = self._clients.get(model_type, [])
            for i, client in enumerate(clients):
                if client.name == name:
                    client.close()
                    clients.pop(i)
                    logger.info(f"已移除模型端点: [{model_type}:{name}]")
                    return True
            return False

    def get_clients(self, model_type: str) -> List[BaseModelClient]:
        """
        获取某类型的所有 enabled 客户端（按优先级排序）

        作用：
            返回按注册顺序排列的客户端列表，仅包含 enabled=true 的。
            列表 index 0 为最高优先级（primary）。

        参数：
            model_type: str - 模型类型

        返回:
            List[BaseModelClient] - enabled 客户端列表（按优先级）
        """
        with self._lock:
            clients = self._clients.get(model_type, [])
            return [c for c in clients if c.is_enabled]

    def get_client(
        self, model_type: str, name: str
    ) -> Optional[BaseModelClient]:
        """
        按名称获取单个客户端

        作用：
            精确查找指定名称的客户端（不关心 enabled 状态）。

        参数：
            model_type: str - 模型类型
            name: str - 端点名称

        返回:
            Optional[BaseModelClient] - 客户端实例，不存在返回 None
        """
        with self._lock:
            for client in self._clients.get(model_type, []):
                if client.name == name:
                    return client
            return None

    def swap_priority(
        self, model_type: str, name_a: str, name_b: str
    ) -> None:
        """
        交换两个端点的优先级（主备切换）

        作用：
            交换列表中两个端点的位置，实现主备切换。
            切换后路由器会按新的优先级选择客户端。

        参数：
            model_type: str - 模型类型
            name_a: str - 端点 A 名称
            name_b: str - 端点 B 名称

        异常:
            ValueError - 端点不存在
        """
        with self._lock:
            clients = self._clients.get(model_type, [])
            idx_a = None
            idx_b = None
            for i, c in enumerate(clients):
                if c.name == name_a:
                    idx_a = i
                elif c.name == name_b:
                    idx_b = i

            if idx_a is None:
                raise ValueError(f"端点不存在: [{model_type}:{name_a}]")
            if idx_b is None:
                raise ValueError(f"端点不存在: [{model_type}:{name_b}]")

            clients[idx_a], clients[idx_b] = clients[idx_b], clients[idx_a]
            logger.info(
                f"已交换端点优先级: [{model_type}] {name_a} <-> {name_b}"
            )

    def list_all(self) -> Dict[str, List[dict]]:
        """
        列出所有端点状态

        作用：
            返回所有端点的状态信息，用于管理 API / 调试 / 监控。

        返回:
            Dict[str, List[dict]] - 按 model_type 分组的状态列表
            每个状态包含：name, type, model, enabled, healthy, breaker_state
        """
        with self._lock:
            result = {}
            for model_type, clients in self._clients.items():
                result[model_type] = [
                    {
                        "name": c.name,
                        "type": c.config.type,
                        "model": c.config.model,
                        "enabled": c.is_enabled,
                        "healthy": c.is_healthy,
                        "breaker_state": c.breaker.get_state(),
                        "tags": c.config.tags,
                    }
                    for c in clients
                ]
            return result

    def clear(self) -> None:
        """
        清空所有注册的客户端

        作用：
            释放所有客户端资源并清空列表。
            用于 manager 重新加载配置前的清理。
        """
        with self._lock:
            for model_type, clients in self._clients.items():
                for c in clients:
                    try:
                        c.close()
                    except Exception as e:
                        logger.error(f"关闭客户端 [{model_type}:{c.name}] 失败: {e}")
                clients.clear()
            logger.info("已清空所有模型端点")
