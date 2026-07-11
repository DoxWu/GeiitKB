"""
OpenAI 兼容 Embedding 客户端

作用：
    封装 LangChain OpenAIEmbeddings，提供带熔断保护的向量化调用。
    兼容 OpenAI / 智谱 / Ollama(OpenAI模式) 等。

容错机制：
    1. 熔断器（Redis）：在线 API 持续失败时快速失败
    2. 超时控制：request_timeout 限制单次调用

使用方式：
    client = OpenAIEmbeddingClient(config)
    vector = client.embed_query("文本内容")
"""

import logging
from typing import List

from app.core.circuit_breaker import CircuitBreakerOpenError
from app.core.model_provider.base import EmbeddingModelClient
from app.core.model_provider.clients._retry_utils import is_retryable
from app.core.model_provider.exceptions import ModelInvocationError
from app.core.model_provider.schemas import ProviderEndpointConfig

logger = logging.getLogger(__name__)


class OpenAIEmbeddingClient(EmbeddingModelClient):
    """
    OpenAI 兼容 Embedding 客户端

    作用：
        封装 OpenAIEmbeddings，提供 embed_query 接口。
        内置熔断器保护，失败时由路由器切换到降级端点。

    容错流程：
        1. 熔断器检查 → 打开则快速失败
        2. 调用 OpenAIEmbeddings.embed_query
        3. 成功 → record_success
        4. 可重试错误 → record_failure + 抛异常（由路由器选下一个端点）
    """

    def __init__(self, config: ProviderEndpointConfig):
        """
        初始化 OpenAI Embedding 客户端

        参数：
            config: ProviderEndpointConfig - 端点配置
        """
        super().__init__(config)
        self._embeddings = None  # 懒加载

    @property
    def embeddings(self):
        """
        获取 OpenAIEmbeddings 实例（懒加载）

        作用：
            首次访问时创建 OpenAIEmbeddings 实例。
            懒加载避免应用启动时就创建连接（需要 API Key）。
        """
        if self._embeddings is None:
            from langchain_openai import OpenAIEmbeddings
            self._embeddings = OpenAIEmbeddings(
                model=self.config.model,
                openai_api_key=self.config.api_key,
                openai_api_base=self.config.api_base,
                request_timeout=self.config.timeout,
            )
        return self._embeddings

    @property
    def dimension(self) -> int:
        """
        向量维度

        返回：
            int - 配置的向量维度，默认 1536（text-embedding-ada-002）
        """
        return self.config.dimension or 1536

    def embed_query(self, text: str) -> List[float]:
        """
        生成文本的向量表示（带熔断保护）

        作用：
            将文本转换为向量，用于向量化存储和相似度检索。

        容错流程：
            1. 熔断器检查 → 打开则快速失败（路由器会选降级端点）
            2. 调用 OpenAIEmbeddings.embed_query
            3. 成功 → record_success + 返回向量
            4. 失败 → record_failure（仅可重试错误）+ 抛异常

        参数：
            text: str - 待向量化的文本

        返回:
            List[float] - 向量

        异常:
            CircuitBreakerOpenError - 熔断器打开
            ModelInvocationError - 调用失败
        """
        if self.breaker.is_open():
            raise CircuitBreakerOpenError(
                self.breaker.service, self.breaker.get_retry_after()
            )

        try:
            vector = self.embeddings.embed_query(text)
            self.breaker.record_success()
            return vector
        except Exception as e:
            if is_retryable(e):
                self.breaker.record_failure()
            logger.warning(
                f"[{self.model_type}:{self.name}] Embedding 调用失败: "
                f"{type(e).__name__}: {e}"
            )
            raise ModelInvocationError(
                f"[{self.name}] Embedding 调用失败: {type(e).__name__}: {e}",
                provider_name=self.name,
                original_exc=e,
            ) from e

    def close(self):
        """
        释放资源

        作用：
            OpenAIEmbeddings 无显式资源需释放。
        """
        self._embeddings = None
