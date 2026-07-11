"""
模型提供者包 - 对外公开 API

作用：
    整合所有模型服务组件，提供统一的模型调用入口。
    实现文本/向量/多模态模型的模块化配置、动态注册、健康检查、降级路由。

核心组件：
    - get_model_manager(): 获取管理器单例（统一入口）
    - ModelProviderManager: 门面管理器（整合 registry/router/health_checker）
    - BaseModelClient: 客户端抽象基类
    - TextModelClient / EmbeddingModelClient / VisionModelClient: 三类模型基类
    - ModelProviderConfig: 配置数据模型

导入示例：
    from app.core.model_provider import get_model_manager

    manager = get_model_manager()
    manager.initialize()

    # 文本模型
    text_client = manager.get_text_client()
    answer = text_client.invoke(messages)

    # Embedding
    emb_client = manager.get_embedding_client()
    vec = emb_client.embed_query("文本")

    # Vision
    vision_client = manager.get_vision_client()
    desc = vision_client.describe_image("/path/to/image.png")
"""

from app.core.model_provider.base import (
    BaseModelClient,
    EmbeddingModelClient,
    TextModelClient,
    VisionModelClient,
)
from app.core.model_provider.exceptions import (
    AllProvidersUnavailableError,
    ModelClientUnavailableError,
    ModelInvocationError,
    ModelProviderError,
)
from app.core.model_provider.manager import ModelProviderManager, get_model_manager
from app.core.model_provider.schemas import (
    HealthCheckConfig,
    ModelProviderConfig,
    ProviderEndpointConfig,
)

__all__ = [
    # 管理器
    "get_model_manager",
    "ModelProviderManager",
    # 抽象基类
    "BaseModelClient",
    "TextModelClient",
    "EmbeddingModelClient",
    "VisionModelClient",
    # 配置
    "ModelProviderConfig",
    "ProviderEndpointConfig",
    "HealthCheckConfig",
    # 异常
    "ModelProviderError",
    "ModelClientUnavailableError",
    "ModelInvocationError",
    "AllProvidersUnavailableError",
]
