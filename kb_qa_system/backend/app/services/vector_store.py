"""
向量存储模块（生产版 - pgvector）

作用：
    使用 PostgreSQL + pgvector 存储文档的向量表示（Embedding），
    并提供向量检索、关键词检索、混合检索功能。

    替代之前的 Chroma 方案，统一技术栈，减少组件依赖。

    这是 RAG（检索增强生成）流程的核心：
    文档分块 → 向量化（Embedding）→ 存入 pgvector → 相似度检索

实现方式：
    1. 使用 OpenAI Embedding 模型将文本转为向量
    2. 使用 pgvector 的 Vector 类型存储向量
    3. 使用 PostgreSQL tsvector 支持全文检索
    4. 支持混合检索（向量 + 关键词）
    5. 使用 Redis 缓存 Embedding 结果，避免重复计算
    6. 支持本地兜底 Embedding 模型（在线不可用时）
"""

import time
import hashlib
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime

from sqlalchemy import text, func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.redis import RedisManager, RedisKeys
from app.core.circuit_breaker import CircuitBreaker, CircuitBreakerOpenError, get_circuit_breaker
from app.models.document import Document
from app.models.document_chunk import DocumentChunk

logger = logging.getLogger(__name__)


class VectorStoreService:
    """
    向量存储服务（pgvector）

    作用：
        管理文档的向量化和检索。
        包括：添加文档块、向量检索、关键词检索、混合检索、删除文档块。

    使用方式：
        store = VectorStoreService()
        store.add_chunks(chunks, document_id=1)
        results = store.search("如何使用异步编程？", top_k=4)
    """

    def __init__(self):
        """
        初始化向量存储服务

        作用：
            创建 Embedding 模型实例和熔断器。

        实现方式：
            1. 创建在线 Embedding 模型（OpenAI）
            2. 懒加载本地兜底模型（避免启动时加载大模型）
            3. 创建 Embedding 服务的熔断器（在线 API 持续失败时快速降级到本地）
        """
        # 在线 Embedding 模型
        # 作用：将文本转换为向量
        self._online_embeddings = None

        # 本地兜底 Embedding 模型
        # 作用：在线 Embedding 不可用时使用
        self._local_embeddings = None

        # Embedding 服务熔断器
        # 作用：在线 Embedding API 持续失败时，快速降级到本地模型，避免反复超时
        self.embedding_breaker: CircuitBreaker = get_circuit_breaker("embedding")

    # ============================================
    # Embedding 模型管理
    # ============================================

    @property
    def online_embeddings(self):
        """
        获取在线 Embedding 模型（懒加载）

        作用：
            首次访问时创建 OpenAI Embedding 模型实例。
        """
        if self._online_embeddings is None:
            from langchain_openai import OpenAIEmbeddings
            self._online_embeddings = OpenAIEmbeddings(
                model=settings.EMBEDDING_MODEL_NAME,
                openai_api_key=settings.OPENAI_API_KEY,
                openai_api_base=settings.OPENAI_API_BASE,
                request_timeout=settings.EMBEDDING_TIMEOUT,
            )
        return self._online_embeddings

    @property
    def local_embeddings(self):
        """
        获取本地兜底 Embedding 模型（懒加载）

        作用：
            在线 Embedding 不可用时，使用本地模型兜底。
            避免服务完全瘫痪。
        """
        if self._local_embeddings is None:
            try:
                from langchain_community.embeddings import HuggingFaceEmbeddings
                self._local_embeddings = HuggingFaceEmbeddings(
                    model_name=settings.LOCAL_EMBEDDING_MODEL,
                )
                logger.info(f"本地 Embedding 模型已加载: {settings.LOCAL_EMBEDDING_MODEL}")
            except Exception as e:
                logger.error(f"加载本地 Embedding 模型失败: {e}")
                self._local_embeddings = None
        return self._local_embeddings

    def generate_embedding(self, text: str) -> tuple[Optional[List[float]], str]:
        """
        生成文本的向量表示

        作用：
            将文本转换为向量（Embedding），用于向量化存储和相似度检索。
            支持在线模型和本地兜底模型。

        实现方式：
            1. 先查 Redis 缓存，命中则直接返回
            2. 调用在线 Embedding 模型
            3. 在线失败则降级到本地模型
            4. 缓存结果到 Redis

        参数：
            text: str - 要向量化的文本

        返回：
            tuple[Optional[List[float]], str] - (向量, 使用的模型)
            向量为 None 表示向量化失败

        示例：
            vector, model = store.generate_embedding("异步编程")
        """
        # 1. 查缓存
        # 作用：相同文本不重复计算向量，节省 API 调用
        cache_key = RedisKeys.llm_cache(
            hashlib.sha256(text.encode()).hexdigest()[:32]
        )
        cached = RedisManager.get(cache_key)
        if cached and isinstance(cached, dict):
            return cached.get("vector"), cached.get("model", "cached")

        # 2. 调用在线 Embedding（带熔断器保护）
        # 作用：熔断器打开时跳过在线 API，直接用本地模型，避免反复超时
        if not self.embedding_breaker.is_open():
            try:
                vector = self.online_embeddings.embed_query(text)
                model_used = settings.EMBEDDING_MODEL_NAME
                self.embedding_breaker.record_success()

                # 缓存结果（7天过期）
                RedisManager.set(
                    cache_key,
                    {"vector": vector, "model": model_used},
                    ttl=7 * 24 * 3600
                )

                return vector, model_used

            except Exception as e:
                logger.warning(f"在线 Embedding 失败，降级到本地模型: {e}")
                self.embedding_breaker.record_failure()
        else:
            logger.info("Embedding 熔断器打开，直接使用本地模型")

        # 3. 降级到本地模型
        # 作用：在线 API 不可用或熔断时，用本地模型兜底
        if self.local_embeddings:
            try:
                vector = self.local_embeddings.embed_query(text)
                model_used = settings.LOCAL_EMBEDDING_MODEL

                # 缓存结果
                RedisManager.set(
                    cache_key,
                    {"vector": vector, "model": model_used},
                    ttl=7 * 24 * 3600
                )

                return vector, model_used
            except Exception as e2:
                logger.error(f"本地 Embedding 也失败: {e2}")

        # 在线和本地都失败，返回 None
        return None, "none"

    # ============================================
    # 添加文档块
    # ============================================

    def add_chunks(
        self,
        chunks: List[Dict[str, Any]],
        document_id: int
    ) -> int:
        """
        将文档分块向量化并存入 pgvector

        作用：
            将分块后的文本向量化并存入 document_chunks 表。

        实现方式：
            1. 遍历所有块
            2. 为每个块生成向量
            3. 创建 DocumentChunk 记录
            4. 批量保存到数据库
            5. 更新全文检索列

        参数：
            chunks: List[Dict[str, Any]] - 分块数据
                格式：[{"text": "...", "metadata": {...}}, ...]
            document_id: int - 文档ID

        返回：
            int - 成功添加的块数量
        """
        if not chunks:
            return 0

        db: Session = SessionLocal()
        success_count = 0

        try:
            for chunk_data in chunks:
                text = chunk_data["text"]
                metadata = chunk_data.get("metadata", {})

                # 生成向量
                vector, model_used = self.generate_embedding(text)

                # 创建块记录
                db_chunk = DocumentChunk(
                    document_id=document_id,
                    chunk_index=metadata.get("chunk_index", success_count),
                    content=text,
                    content_vector=vector,
                    token_count=metadata.get("token_count", 0),
                    page_number=metadata.get("page_number"),
                    char_start=metadata.get("char_start"),
                    char_end=metadata.get("char_end"),
                    metadata_=metadata,
                )

                db.add(db_chunk)
                db.flush()  # 获取 ID

                # 更新全文检索列
                # 作用：使用 to_tsvector 生成全文检索向量
                if db_chunk.id:
                    db.execute(
                        text(
                            "UPDATE document_chunks SET content_tsv = "
                            "to_tsvector('simple', :content) WHERE id = :id"
                        ),
                        {"content": text, "id": db_chunk.id}
                    )

                success_count += 1

            db.commit()
            logger.info(f"文档 {document_id} 添加了 {success_count} 个块")

        except Exception as e:
            db.rollback()
            logger.error(f"添加文档块失败: {e}")
            raise
        finally:
            db.close()

        return success_count

    # ============================================
    # 向量检索
    # ============================================

    def vector_search(
        self,
        query: str,
        top_k: Optional[int] = None,
        document_ids: Optional[List[int]] = None
    ) -> List[Dict[str, Any]]:
        """
        向量相似度检索

        作用：
            将用户问题向量化，与 pgvector 中的文档向量做余弦相似度匹配，
            返回最相关的文档片段。

        实现方式：
            1. 将查询文本向量化
            2. 使用 pgvector 的 <=> 操作符计算余弦距离
            3. 按 distance 升序排序（越小越相似）
            4. 返回 Top-K 结果

        参数：
            query: str - 用户问题
            top_k: Optional[int] - 返回数量
            document_ids: Optional[List[int]] - 限定检索的文档ID列表

        返回：
            List[Dict[str, Any]] - 检索结果
        """
        if top_k is None:
            top_k = settings.SEARCH_TOP_K

        # 1. 生成查询向量
        query_vector, model_used = self.generate_embedding(query)
        if query_vector is None:
            logger.error("生成查询向量失败，无法进行向量检索")
            return []

        # 2. 构建SQL查询
        db: Session = SessionLocal()
        try:
            # 使用 pgvector 的 <=> 操作符（余弦距离）
            # distance 范围 [0, 2]，0 表示完全相同
            # similarity = 1 - distance
            sql = """
                SELECT
                    dc.id,
                    dc.document_id,
                    dc.chunk_index,
                    dc.content,
                    dc.page_number,
                    dc.metadata_,
                    d.title as document_title,
                    1 - (dc.content_vector <=> :query_vector) as similarity
                FROM document_chunks dc
                JOIN documents d ON dc.document_id = d.id
                WHERE dc.content_vector IS NOT NULL
                  AND d.is_deleted = false
            """

            params: Dict[str, Any] = {"query_vector": str(query_vector)}

            # 文档ID过滤（权限隔离关键）
            # 语义：
            #   - document_ids is None：不过滤（仅管理员/内部场景）
            #   - document_ids == []：空集，返回空结果（防止越权：空列表不能被当作"不过滤"）
            #   - document_ids 非空：限定到指定文档
            if document_ids is not None:
                if len(document_ids) == 0:
                    # 空列表明确表示"无可访问文档"，直接返回空，避免越权检索全部
                    return []
                sql += " AND dc.document_id = ANY(:doc_ids)"
                params["doc_ids"] = document_ids

            # 相似度阈值过滤
            sql += " AND 1 - (dc.content_vector <=> :query_vector) >= :threshold"

            # 排序和限制
            sql += " ORDER BY dc.content_vector <=> :query_vector LIMIT :limit"
            params["limit"] = top_k

            # 执行查询
            result = db.execute(text(sql), params)

            # 整理结果
            search_results = []
            for row in result:
                similarity = float(row.similarity)
                search_results.append({
                    "chunk_id": row.id,
                    "content": row.content,
                    "metadata": {
                        "document_id": row.document_id,
                        "document_title": row.document_title,
                        "chunk_index": row.chunk_index,
                        "page_number": row.page_number,
                        **(row.metadata_ or {}),
                    },
                    "score": similarity,
                })

            return search_results

        except Exception as e:
            logger.error(f"向量检索失败: {e}")
            return []
        finally:
            db.close()

    # ============================================
    # 关键词检索
    # ============================================

    def keyword_search(
        self,
        query: str,
        top_k: Optional[int] = None,
        document_ids: Optional[List[int]] = None
    ) -> List[Dict[str, Any]]:
        """
        关键词检索（全文检索）

        作用：
            使用 PostgreSQL 的全文检索功能，按关键词匹配文档。
            作为向量检索的补充和兜底。

        实现方式：
            1. 使用 to_tsquery 构建查询
            2. 使用 ts_rank 计算相关度
            3. 使用 @@ 操作符匹配

        参数：
            query: str - 用户问题
            top_k: Optional[int] - 返回数量
            document_ids: Optional[List[int]] - 限定检索的文档ID列表

        返回：
            List[Dict[str, Any]] - 检索结果
        """
        if top_k is None:
            top_k = settings.SEARCH_TOP_K

        db: Session = SessionLocal()
        try:
            # 构建全文检索查询
            # 作用：将用户输入转为 tsquery 格式
            # 简单分词：按空格分割，用 & 连接（AND 关系）
            query_terms = query.strip().split()
            tsquery = " & ".join(query_terms)

            if not tsquery:
                return []

            sql = """
                SELECT
                    dc.id,
                    dc.document_id,
                    dc.chunk_index,
                    dc.content,
                    dc.page_number,
                    dc.metadata_,
                    d.title as document_title,
                    ts_rank(dc.content_tsv, to_tsquery('simple', :tsquery)) as rank
                FROM document_chunks dc
                JOIN documents d ON dc.document_id = d.id
                WHERE dc.content_tsv @@ to_tsquery('simple', :tsquery)
                  AND d.is_deleted = false
            """

            params = {"tsquery": tsquery}

            # 文档ID过滤（同 vector_search 的权限隔离语义）
            if document_ids is not None:
                if len(document_ids) == 0:
                    # 空列表：无可访问文档，返回空（防止越权）
                    return []
                sql += " AND dc.document_id = ANY(:doc_ids)"
                params["doc_ids"] = document_ids

            sql += " ORDER BY rank DESC LIMIT :limit"
            params["limit"] = top_k

            result = db.execute(text(sql), params)

            search_results = []
            for row in result:
                # 归一化 rank 到 0-1
                score = min(float(row.rank) / 0.1, 1.0)
                search_results.append({
                    "chunk_id": row.id,
                    "content": row.content,
                    "metadata": {
                        "document_id": row.document_id,
                        "document_title": row.document_title,
                        "chunk_index": row.chunk_index,
                        "page_number": row.page_number,
                        **(row.metadata_ or {}),
                    },
                    "score": score,
                })

            return search_results

        except Exception as e:
            logger.error(f"关键词检索失败: {e}")
            return []
        finally:
            db.close()

    # ============================================
    # 混合检索
    # ============================================

    def search(
        self,
        query: str,
        top_k: Optional[int] = None,
        document_ids: Optional[List[int]] = None,
        enable_hybrid: Optional[bool] = None
    ) -> List[Dict[str, Any]]:
        """
        混合检索（向量 + 关键词）

        作用：
            结合向量检索和关键词检索的优势：
            - 向量检索：理解语义，"如何异步" 能匹配 "async 方法"
            - 关键词检索：精确匹配，"asyncio.gather" 能精确命中

            通过加权融合两路结果，提升检索质量。

        实现方式：
            1. 并行执行向量检索和关键词检索
            2. 按 chunk_id 合并结果
            3. 加权计算最终分数
            4. 排序并返回 Top-K

        参数：
            query: str - 用户问题
            top_k: Optional[int] - 返回数量
            document_ids: Optional[List[int]] - 限定检索的文档ID列表
            enable_hybrid: Optional[bool] - 是否启用混合检索

        返回：
            List[Dict[str, Any]] - 检索结果
        """
        if top_k is None:
            top_k = settings.SEARCH_TOP_K

        if enable_hybrid is None:
            enable_hybrid = settings.ENABLE_HYBRID_SEARCH

        start_time = time.time()

        # 不启用混合检索，直接用向量检索
        if not enable_hybrid:
            results = self.vector_search(query, top_k, document_ids)

            # 向量检索降级：结果为空时回退到关键词检索
            # 作用：当 Embedding 服务不可用（熔断/超时）导致向量检索无结果时，
            #       用关键词检索兜底，保证至少能返回一些相关文档
            if not results:
                logger.info("向量检索无结果，降级到关键词检索")
                results = self.keyword_search(query, top_k, document_ids)

            return self._filter_by_threshold(results)

        # 混合检索
        # 获取更多候选，然后融合
        candidate_k = top_k * 3

        # 向量检索（权重 1 - KEYWORD_SEARCH_WEIGHT）
        # 作用：语义匹配，理解问题意图
        vector_results = self.vector_search(query, candidate_k, document_ids)

        # 关键词检索（权重 KEYWORD_SEARCH_WEIGHT）
        # 作用：精确匹配，作为向量检索的补充和兜底
        keyword_results = self.keyword_search(query, candidate_k, document_ids)

        # 降级场景：向量检索完全失败（Embedding 不可用），仅用关键词结果
        # 作用：保证 Embedding 服务挂掉时仍能返回检索结果
        if not vector_results and keyword_results:
            logger.info("向量检索无结果，混合检索降级为仅关键词检索")
            results = keyword_results[:top_k]
            for r in results:
                r["score"] = r.get("keyword_score", r.get("score", 0))
            return self._filter_by_threshold(results)

        # 融合结果
        # 作用：按 chunk_id 合并，加权计算分数
        merged: Dict[int, Dict[str, Any]] = {}
        vector_weight = 1 - settings.KEYWORD_SEARCH_WEIGHT
        keyword_weight = settings.KEYWORD_SEARCH_WEIGHT

        for result in vector_results:
            chunk_id = result["chunk_id"]
            result["vector_score"] = result["score"]
            result["keyword_score"] = 0.0
            result["final_score"] = result["score"] * vector_weight
            merged[chunk_id] = result

        for result in keyword_results:
            chunk_id = result["chunk_id"]
            if chunk_id in merged:
                # 合并
                merged[chunk_id]["keyword_score"] = result["score"]
                merged[chunk_id]["final_score"] += result["score"] * keyword_weight
            else:
                result["vector_score"] = 0.0
                result["keyword_score"] = result["score"]
                result["final_score"] = result["score"] * keyword_weight
                merged[chunk_id] = result

        # 按最终分数排序
        results = sorted(
            merged.values(),
            key=lambda x: x["final_score"],
            reverse=True
        )

        # 取 Top-K
        results = results[:top_k]

        # 统一 score 字段为 final_score
        for result in results:
            result["score"] = result["final_score"]

        elapsed_ms = int((time.time() - start_time) * 1000)
        logger.info(f"混合检索完成，耗时 {elapsed_ms}ms，返回 {len(results)} 条结果")

        return self._filter_by_threshold(results)

    def _filter_by_threshold(
        self,
        results: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        按相似度阈值过滤结果

        作用：
            过滤掉相似度太低的结果，避免不相关内容干扰 LLM。

        参数：
            results: List[Dict[str, Any]] - 检索结果

        返回：
            List[Dict[str, Any]] - 过滤后的结果
        """
        return [
            r for r in results
            if r.get("score", 0) >= settings.SIMILARITY_THRESHOLD
        ]

    # ============================================
    # 删除文档块
    # ============================================

    def delete_document_chunks(self, document_id: int) -> bool:
        """
        删除指定文档的所有块

        作用：
            当用户删除文档时，同时从 pgvector 中删除对应的向量。

        参数：
            document_id: int - 文档ID

        返回：
            bool - 是否删除成功
        """
        db: Session = SessionLocal()
        try:
            db.query(DocumentChunk).filter(
                DocumentChunk.document_id == document_id
            ).delete(synchronize_session=False)
            db.commit()
            logger.info(f"已删除文档 {document_id} 的所有块")
            return True
        except Exception as e:
            db.rollback()
            logger.error(f"删除文档块失败: {e}")
            return False
        finally:
            db.close()

    # ============================================
    # 获取统计信息
    # ============================================

    def get_stats(self) -> Dict[str, Any]:
        """
        获取向量存储统计信息

        作用：
            返回向量数据库的状态，用于监控和统计。

        返回：
            Dict[str, Any] - 统计信息
        """
        db: Session = SessionLocal()
        try:
            # 总块数
            total_chunks = db.query(DocumentChunk).count()

            # 已向量化的块数
            vectorized_chunks = db.query(DocumentChunk).filter(
                DocumentChunk.content_vector.isnot(None)
            ).count()

            # 文档数
            total_documents = db.query(Document).filter(
                Document.is_deleted == False
            ).count()

            return {
                "total_chunks": total_chunks,
                "vectorized_chunks": vectorized_chunks,
                "total_documents": total_documents,
                "vectorization_rate": (
                    vectorized_chunks / total_chunks if total_chunks > 0 else 0
                ),
            }
        except Exception as e:
            logger.error(f"获取统计信息失败: {e}")
            return {}
        finally:
            db.close()


# ============================================
# 创建全局实例（懒加载）
# ============================================

_vector_store_instance: Optional[VectorStoreService] = None


def get_vector_store() -> VectorStoreService:
    """
    获取向量存储服务实例（懒加载）

    作用：
        避免在应用启动时就创建向量服务（需要 API Key）。
        在实际需要时才创建。

    返回：
        VectorStoreService - 向量存储服务实例
    """
    global _vector_store_instance
    if _vector_store_instance is None:
        _vector_store_instance = VectorStoreService()
    return _vector_store_instance
