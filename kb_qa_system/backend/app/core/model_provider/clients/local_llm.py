"""
本地 Ollama LLM 客户端

作用：
    Ollama 暴露 OpenAI 兼容 API，直接继承 OpenAITextClient。
    仅覆盖默认配置（api_key="ollama"、api_base 指向 localhost:11434）。

使用方式：
    client = OllamaTextClient(config)
    answer = client.invoke(messages)
"""

import logging

from app.core.model_provider.clients.openai_text import OpenAITextClient
from app.core.model_provider.schemas import ProviderEndpointConfig

logger = logging.getLogger(__name__)


class OllamaTextClient(OpenAITextClient):
    """
    Ollama 本地 LLM 客户端

    作用：
        Ollama 暴露 OpenAI 兼容 API（/v1/chat/completions），
        直接复用 OpenAITextClient 的全部容错逻辑。

    特点：
        - 继承 OpenAITextClient 的重试+熔断+流式支持
        - 超时通常更长（本地推理可能较慢）
        - 健康检查默认关闭（本地模型按需启动）
    """

    def __init__(self, config: ProviderEndpointConfig):
        """
        初始化 Ollama 客户端

        作用：
            调用父类初始化，Ollama 的 API 兼容 OpenAI 格式。

        参数：
            config: ProviderEndpointConfig - 端点配置
                    （api_base 应指向 http://localhost:11434/v1）
        """
        super().__init__(config)
        logger.info(
            f"[{self.model_type}:{self.name}] Ollama 本地 LLM 客户端已初始化: "
            f"model={config.model}, base={config.api_base}"
        )
