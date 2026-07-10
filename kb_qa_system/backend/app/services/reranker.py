"""
重排序服务（Cross-Encoder Reranking）

作用：
    对向量检索的候选结果用 cross-encoder 模型进行二次打分和排序，
    提升 Top-K 的精确度。

    为何需要重排序：
        向量检索使用的是"双塔"模型（query 和 doc 独立编码为向量，再算余弦相似度），
        速度快但精度有限——query 和 doc 的交互只在最后的向量点积层面发生。

        cross-encoder 是"交互"模型（query 和 doc 拼接后一起送入 Transformer 编码），
        能捕捉更深层的语义关联，精度更高，但速度慢（每对 query-doc 都要一次前向传播）。

        两者结合的策略：
            1. 向量检索高召回：取 top_k × N 候选（保证不漏）
            2. cross-encoder 高精度重排：对候选重新打分，取 top_k（保证精准）

    降级策略：
        reranker 不可用时（模型加载失败、未安装依赖），跳过重排序，
        直接返回原检索结果的前 top_k 条，不影响主流程。

实现方式：
    RerankerService.rerank(query, documents, top_k) 用 CrossEncoder.predict
    对每对 (query, doc) 打分，按分数降序排列，取前 top_k 条。

使用方式：
    from app.services.reranker import reranker_service

    # 在检索后调用
    reranked = reranker_service.rerank(query, candidates, top_k=4)
"""

import logging
from typing import List, Dict, Any, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


class RerankerService:
    """
    重排序服务

    作用：
        用 cross-encoder 模型对检索结果重新打分排序，提升 Top-K 精确度。

    设计原则：
        1. 懒加载模型——首次调用时才加载，避免启动时阻塞
        2. 降级容错——模型不可用时跳过重排序，返回原结果
        3. 无状态——可安全复用全局实例

    使用方式：
        reranked = reranker_service.rerank(query, documents, top_k=4)
    """

    def __init__(self):
        """
        初始化重排序服务

        作用：
            初始化模型引用和可用性标志，不立即加载模型（懒加载）。

        实现方式：
            - _model: CrossEncoder 模型实例（懒加载）
            - _availability: 可用性状态（None=未检查，True/False=检查结果）
        """
        self._model = None
        self._availability: Optional[bool] = None

    def rerank(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        top_k: int,
    ) -> List[Dict[str, Any]]:
        """
        对检索结果重排序

        作用：
            用 cross-encoder 计算 query 与每条文档的相关度分数，
            按新分数降序排列，取前 top_k 条返回。

        实现方式：
            1. 检查 ENABLE_RERANKING 开关
            2. 检查 reranker 模型是否可用（懒加载）
            3. 不可用则降级：直接返回原结果前 top_k 条
            4. 可用则用 CrossEncoder.predict 打分
            5. 按 rerank_score 降序排序，取 top_k

        参数：
            query: str - 用户问题
            documents: List[Dict[str, Any]] - 检索结果列表
                每条需含 "content" 字段（用于与 query 配对打分）
            top_k: int - 最终返回的文档数量

        返回:
            List[Dict[str, Any]] - 重排序后的结果（前 top_k 条）
                每条结果会附加 "rerank_score" 字段（cross-encoder 分数）

        降级场景：
            - ENABLE_RERANKING=False：跳过重排序
            - 模型加载失败：跳过重排序
            - 打分过程异常：跳过重排序
            所有降级场景都返回原 documents 的前 top_k 条
        """
        # 1. 检查开关
        if not settings.ENABLE_RERANKING:
            return documents[:top_k]

        # 2. 文档为空或不足，无需重排序
        if not documents:
            return documents
        if len(documents) <= top_k:
            # 候选数不超过 top_k，重排序无意义但仍打分（便于一致性）
            pass

        # 3. 检查模型可用性
        if not self._is_available():
            logger.warning("Reranker 不可用，跳过重排序，返回原检索结果")
            return documents[:top_k]

        # 4. 用 cross-encoder 打分
        try:
            # 构建 query-doc 对
            # 作用：CrossEncoder.predict 接受 [(query, doc), ...] 列表
            pairs = [
                (query, doc.get("content", ""))
                for doc in documents
            ]

            # 批量打分
            # 作用：一次前向传播计算所有候选的相关度分数
            scores = self._model.predict(pairs)

            # 将 rerank_score 附加到每条文档
            # 作用：保留原始检索分数（score），新增 rerank_score 供分析
            for doc, score in zip(documents, scores):
                doc["rerank_score"] = float(score)

            # 按 rerank_score 降序排序
            # 作用：cross-encoder 分数越高，query-doc 越相关
            reranked = sorted(
                documents,
                key=lambda x: x.get("rerank_score", 0),
                reverse=True,
            )

            logger.info(
                f"重排序完成：{len(documents)} 条候选 → 取前 {top_k} 条"
            )

            return reranked[:top_k]

        except Exception as e:
            # 打分过程异常，降级为原排序
            # 作用：保证 reranker 异常不影响主检索流程
            logger.error(f"重排序打分失败，降级为原检索排序: {e}", exc_info=True)
            return documents[:top_k]

    def _is_available(self) -> bool:
        """
        检查 reranker 模型是否可用（懒加载）

        作用：
            首次调用时尝试加载 CrossEncoder 模型，记录可用性。
            后续调用直接返回缓存结果，避免重复加载。

        实现方式：
            1. 已检查过则返回缓存结果
            2. 未检查则尝试加载模型
            3. 加载成功标记为可用，失败标记为不可用

        返回:
            bool - True 表示模型可用，False 表示不可用（将跳过重排序）
        """
        if self._availability is not None:
            return self._availability

        try:
            from sentence_transformers import CrossEncoder

            # 加载 cross-encoder 模型
            # 作用：首次加载会从 HuggingFace 下载模型（~400MB），后续从缓存加载
            model_name = settings.RERANKER_MODEL_NAME
            logger.info(f"正在加载 Reranker 模型: {model_name}")

            self._model = CrossEncoder(model_name)
            self._availability = True
            logger.info(f"Reranker 模型加载成功: {model_name}")

        except ImportError:
            self._availability = False
            logger.warning(
                "sentence-transformers 未安装或版本不兼容，Reranker 将被跳过"
            )
        except Exception as e:
            self._availability = False
            logger.warning(
                f"Reranker 模型加载失败（重排序将被跳过）: {e}"
            )

        return self._availability


# ============================================
# 全局实例
# ============================================

# 作用：全局单例，避免重复加载模型（cross-encoder 模型占用较大内存）
reranker_service = RerankerService()
