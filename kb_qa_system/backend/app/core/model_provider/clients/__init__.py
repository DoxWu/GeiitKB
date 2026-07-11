"""
模型客户端具体实现包

作用：
    汇总导出所有具体客户端实现类，供工厂和外部使用。

可用客户端：
    - OpenAITextClient: OpenAI 兼容文本客户端
    - OpenAIEmbeddingClient: OpenAI 兼容 Embedding 客户端
    - OpenAIVisionClient: OpenAI 兼容 Vision 客户端
    - LocalHuggingFaceEmbeddingClient: 本地 HuggingFace Embedding 客户端
    - OllamaTextClient: Ollama 本地 LLM 客户端
"""

from app.core.model_provider.clients.local_embedding import (
    LocalHuggingFaceEmbeddingClient,
)
from app.core.model_provider.clients.local_llm import OllamaTextClient
from app.core.model_provider.clients.openai_embedding import OpenAIEmbeddingClient
from app.core.model_provider.clients.openai_text import OpenAITextClient
from app.core.model_provider.clients.openai_vision import OpenAIVisionClient

__all__ = [
    "OpenAITextClient",
    "OpenAIEmbeddingClient",
    "OpenAIVisionClient",
    "LocalHuggingFaceEmbeddingClient",
    "OllamaTextClient",
]
