"""
文档处理流水线主编排器

作用：
    将文档处理的各步骤（解析、清洗、表格提取、图片处理、分块、质量评分）
    按固定顺序串联执行，统一管理状态机、进度、异常降级。

    流水线状态机：
        uploaded → parsing → layout_analysis → cleaning
        → table_extraction → ocr → chunking
        → quality_scoring → completed

    设计原则：
        1. 单步失败不中断流水线（除非解析失败）
        2. 每步更新 processing_step / processing_progress
        3. 异常记录到 quality_issues
        4. 支持 Celery 异步调用（同步方法，由 worker 异步执行）

实现方式：
    DocumentPipeline.process(ctx) 按 try-except 包裹各步骤，
    任何步骤失败都会被捕获并记录，流水线继续执行后续步骤。
"""

import os
import logging
import hashlib
from datetime import datetime
from typing import Callable, Optional

from app.services.document_pipeline.context import PipelineContext
from app.services.document_pipeline.cleaner import TextCleaner
from app.services.document_pipeline.chunker import TextChunker
from app.services.document_pipeline.quality_scorer import QualityScorer
from app.services.document_pipeline.pdf_parser import PdfParser
from app.services.document_pipeline.table_extractor import TableExtractor
from app.services.document_pipeline.image_processor import ImageProcessor
from app.services.document_pipeline.parsers import (
    MarkdownParser,
    TxtParser,
    DocxParser,
    UrlParser,
)

logger = logging.getLogger(__name__)


class DocumentPipeline:
    """
    文档处理流水线

    作用：
        编排文档处理的完整流程，从文件解析到产出可向量化的分块。
        所有步骤共享同一个 PipelineContext，逐步填充数据。

    使用方式：
        pipeline = DocumentPipeline()
        ctx = pipeline.process(
            file_path="/uploads/doc.pdf",
            file_type=".pdf",
            file_name="doc.pdf",
            document_id=1,
            document_title="示例文档",
        )
        # ctx.chunks 可直接传给 VectorStoreService.add_chunks
        chunk_dicts = ctx.to_chunk_dicts()
    """

    # 流水线步骤进度表
    # 作用：每个步骤完成后对应的进度百分比
    # 修复 Issue 5：调整进度分布，预留 embedding 阶段进度（95→90），
    #   向量化阶段（document_tasks.py 中）占 90→100，避免提前显示 100%
    _STEP_PROGRESS = {
        "parsing": 15,
        "layout_analysis": 25,
        "cleaning": 35,
        "table_extraction": 50,
        "ocr": 65,
        "chunking": 75,
        "quality_scoring": 85,
        "embedding": 95,  # 向量化阶段（在 document_tasks.py 中设置）
        "completed": 100,
    }

    def __init__(self):
        """
        初始化流水线

        作用：
            创建各步骤的处理器实例。
            所有处理器无状态，可在多线程中复用。
        """
        self.cleaner = TextCleaner()
        self.chunker = TextChunker()
        self.quality_scorer = QualityScorer()
        self.pdf_parser = PdfParser()
        self.table_extractor = TableExtractor()
        self.image_processor = ImageProcessor()

        # 非 PDF 格式解析器
        self.markdown_parser = MarkdownParser()
        self.txt_parser = TxtParser()
        self.docx_parser = DocxParser()
        self.url_parser = UrlParser()

    # ============================================
    # 主入口
    # ============================================

    def process(
        self,
        file_path: str,
        file_type: str,
        file_name: str,
        document_id: Optional[int] = None,
        document_title: str = "",
        progress_callback: Optional[Callable[[str, int], None]] = None,
    ) -> PipelineContext:
        """
        执行完整文档处理流水线

        作用：
            从文件解析到产出可向量化的分块，按状态机推进各步骤。
            单步失败不中断流水线（解析步骤除外）。

        实现方式：
            1. 创建 PipelineContext
            2. 计算文件哈希（用于去重）
            3. 按顺序执行各步骤
            4. 每步更新 processing_step / processing_progress
            5. 异常记录到 quality_issues
            6. 最终标记为 completed

        参数：
            file_path: str - 文件路径
            file_type: str - 文件类型（.pdf/.md/.txt/.docx/.url）
            file_name: str - 文件名
            document_id: Optional[int] - 文档ID
            document_title: str - 文档标题
            progress_callback: Optional[Callable[[str, int], None]] - 进度回调
                修复 Issue 5：每步开始/进度更新时调用，供调用方实时写入数据库

        返回:
            PipelineContext - 包含完整处理结果（chunks、quality_score 等）

        异常：
            文件不存在或解析完全失败会抛出异常
            其他步骤失败会被捕获，流水线继续
        """
        # 校验文件存在
        if not os.path.exists(file_path) and not file_path.startswith(("http://", "https://")):
            raise FileNotFoundError(f"文件不存在: {file_path}")

        # 创建上下文
        ctx = PipelineContext(
            file_path=file_path,
            file_type=file_type.lower(),
            file_name=file_name,
            document_id=document_id,
            document_title=document_title,
            progress_callback=progress_callback,
        )

        pipeline_start = datetime.now()
        logger.info(
            f"开始处理文档：{file_name}（type={file_type}, id={document_id}）"
        )

        try:
            # 1. 解析阶段（关键步骤，失败则终止）
            self._step_parse(ctx)

            # 2. 版面分析（仅 PDF，更新状态机）
            self._step_layout_analysis(ctx)

            # 3. 清洗阶段
            self._step_clean(ctx)

            # 4. 表格提取（仅 PDF）
            self._step_extract_tables(ctx)

            # 5. 图片处理 + OCR + 多模态（仅 PDF）
            self._step_process_images(ctx)

            # 6. 分块阶段
            self._step_chunk(ctx)

            # 7. 质量评分
            self._step_score_quality(ctx)

            # 8. 完成
            ctx.processing_step = "completed"
            ctx.set_progress(100)

        except Exception as e:
            logger.error(f"流水线执行失败: {e}", exc_info=True)
            ctx.processing_step = "failed"
            ctx.add_issue(f"流水线执行失败: {e}")
            # 不重新抛出，返回部分结果的 ctx
            # 作用：调用方可以根据 quality_score 和 quality_issues 决定后续处理

        finally:
            # 计算总耗时
            pipeline_end = datetime.now()
            ctx.total_duration_ms = int(
                (pipeline_end - pipeline_start).total_seconds() * 1000
            )

            logger.info(
                f"文档处理完成：{file_name}，"
                f"状态={ctx.processing_step}，"
                f"质量分={ctx.quality_score}，"
                f"块数={len(ctx.chunks)}，"
                f"耗时={ctx.total_duration_ms}ms"
            )

        return ctx

    # ============================================
    # 步骤1：解析
    # ============================================

    def _step_parse(self, ctx: PipelineContext) -> None:
        """
        解析步骤

        作用：
            根据文件类型选择解析器，提取原始文本和页面信息。
            这是关键步骤，失败会终止整个流水线。

        实现方式：
            1. 启动步骤计时
            2. 根据文件类型选择解析器
            3. 调用 parse_to_context 填充 ctx
            4. 结束步骤计时

        参数：
            ctx: PipelineContext - 流水线上下文
        """
        ctx.start_step("parsing")

        try:
            file_type = ctx.file_type.lower()

            if file_type == ".pdf":
                self.pdf_parser.parse_to_context(ctx)
            elif file_type in (".md", ".markdown"):
                self.markdown_parser.parse_to_context(ctx)
            elif file_type == ".txt":
                self.txt_parser.parse_to_context(ctx)
            elif file_type == ".docx":
                self.docx_parser.parse_to_context(ctx)
            elif file_type in (".url", ".html", ".htm"):
                self.url_parser.parse_to_context(ctx)
            else:
                raise ValueError(f"不支持的文件类型: {file_type}")

            ctx.finish_step(
                "parsing",
                success=True,
                input_count=1,
                output_count=len(ctx.pages),
            )
            ctx.set_progress(self._STEP_PROGRESS["parsing"])

            logger.info(
                f"解析完成：{len(ctx.pages)} 页，"
                f"原文 {len(ctx.raw_text)} 字符"
            )

        except Exception as e:
            logger.error(f"解析失败: {e}", exc_info=True)
            ctx.finish_step("parsing", success=False, error=str(e))
            # 解析失败是致命错误，重新抛出
            raise

    # ============================================
    # 步骤2：版面分析
    # ============================================

    def _step_layout_analysis(self, ctx: PipelineContext) -> None:
        """
        版面分析步骤

        作用：
            PDF 解析时已包含版面分析（多栏检测、阅读顺序重排），
            此步骤主要用于状态机标记和统计记录。

        实现方式：
            1. 启动步骤计时
            2. 统计多栏页数
            3. 更新 ctx.column_count
            4. 结束步骤计时

        参数：
            ctx: PipelineContext - 流水线上下文
        """
        ctx.start_step("layout_analysis")

        try:
            # 统计版面信息
            # 作用：多栏文档已由 PdfParser 重排，这里仅记录统计
            multi_column_pages = sum(1 for p in ctx.pages if p.column_count > 1)
            if multi_column_pages > 0:
                ctx.layout_detected = True
                ctx.column_count = 2  # 取最大栏数
                logger.info(f"检测到多栏布局，{multi_column_pages} 页")

            ctx.finish_step(
                "layout_analysis",
                success=True,
                input_count=len(ctx.pages),
                output_count=len(ctx.pages),
            )
            ctx.set_progress(self._STEP_PROGRESS["layout_analysis"])

        except Exception as e:
            logger.warning(f"版面分析失败（不影响后续）: {e}")
            ctx.finish_step("layout_analysis", success=False, error=str(e))

    # ============================================
    # 步骤3：清洗
    # ============================================

    def _step_clean(self, ctx: PipelineContext) -> None:
        """
        清洗步骤

        作用：
            清洗原始文本，去除脏数据。

        参数：
            ctx: PipelineContext - 流水线上下文
        """
        # TextCleaner 内部会调用 ctx.start_step / finish_step
        self.cleaner.clean(ctx)
        # 修复 Issue 5：步骤完成后更新进度，供前端进度条增量展示
        ctx.set_progress(self._STEP_PROGRESS["cleaning"])

    # ============================================
    # 步骤4：表格提取
    # ============================================

    def _step_extract_tables(self, ctx: PipelineContext) -> None:
        """
        表格提取步骤

        作用：
            从 PDF 提取表格，合并跨页表格。

        参数：
            ctx: PipelineContext - 流水线上下文
        """
        # TableExtractor 内部会调用 ctx.start_step / finish_step
        self.table_extractor.extract(ctx)
        # 修复 Issue 5：步骤完成后更新进度
        ctx.set_progress(self._STEP_PROGRESS["table_extraction"])

    # ============================================
    # 步骤5：图片处理
    # ============================================

    def _step_process_images(self, ctx: PipelineContext) -> None:
        """
        图片处理步骤

        作用：
            从 PDF 提取图片，OCR 识别文字，多模态生成描述。

        参数：
            ctx: PipelineContext - 流水线上下文
        """
        # ImageProcessor 内部会调用 ctx.start_step / finish_step
        self.image_processor.extract(ctx)
        # 修复 Issue 5：步骤完成后更新进度
        ctx.set_progress(self._STEP_PROGRESS["ocr"])

    # ============================================
    # 步骤6：分块
    # ============================================

    def _step_chunk(self, ctx: PipelineContext) -> None:
        """
        分块步骤

        作用：
            把清洗后的文本、表格、图片描述切分为 chunk。

        参数：
            ctx: PipelineContext - 流水线上下文
        """
        # TextChunker 内部会调用 ctx.start_step / finish_step
        self.chunker.chunk(ctx)

        # 填充表格和图片块的 document_id
        # 作用：表格和图片块在 chunker 中创建时不知道 document_id，需要在此补充
        for chunk in ctx.chunks:
            if chunk.metadata.get("document_id") is None:
                chunk.metadata["document_id"] = ctx.document_id
                chunk.metadata["document_title"] = ctx.document_title

        # 修复 Issue 5：步骤完成后更新进度
        ctx.set_progress(self._STEP_PROGRESS["chunking"])

    # ============================================
    # 步骤7：质量评分
    # ============================================

    def _step_score_quality(self, ctx: PipelineContext) -> None:
        """
        质量评分步骤

        作用：
            综合评估文档处理质量。

        参数：
            ctx: PipelineContext - 流水线上下文
        """
        # QualityScorer 内部会调用 ctx.start_step / finish_step
        self.quality_scorer.score(ctx)
        # 修复 Issue 5：步骤完成后更新进度
        ctx.set_progress(self._STEP_PROGRESS["quality_scoring"])

    # ============================================
    # 工具方法：文件哈希
    # ============================================

    @staticmethod
    def compute_file_hash(file_path: str) -> Optional[str]:
        """
        计算文件 SHA256 哈希

        作用：
            用于文件去重。相同哈希的文件不重复存储和向量化。

        实现方式：
            1. 分块读取文件（避免大文件占用内存）
            2. SHA256 哈希计算
            3. 返回十六进制字符串

        参数：
            file_path: str - 文件路径

        返回:
            Optional[str] - SHA256 哈希（失败返回 None）
        """
        if not os.path.exists(file_path):
            return None

        try:
            sha256 = hashlib.sha256()
            with open(file_path, "rb") as f:
                while True:
                    data = f.read(65536)  # 64KB 块
                    if not data:
                        break
                    sha256.update(data)
            return sha256.hexdigest()
        except Exception as e:
            logger.error(f"计算文件哈希失败: {e}")
            return None


# ============================================
# 创建全局实例
# ============================================

# 全局流水线实例
# 作用：避免每次处理都创建新实例（各步骤处理器无状态，可安全复用）
_document_pipeline: Optional[DocumentPipeline] = None


def get_document_pipeline() -> DocumentPipeline:
    """
    获取文档处理流水线实例（懒加载）

    作用：
        首次调用时创建实例，后续复用。
        懒加载避免应用启动时就初始化所有解析器。

    返回:
        DocumentPipeline - 流水线实例
    """
    global _document_pipeline
    if _document_pipeline is None:
        _document_pipeline = DocumentPipeline()
    return _document_pipeline
