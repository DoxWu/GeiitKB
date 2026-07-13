"""
流水线上下文模块

作用：
    定义贯穿整个文档处理流水线的上下文对象 PipelineContext，
    在各处理步骤间传递数据、统计指标、质量问题。

    流水线状态机：
        uploaded → parsing → cleaning → layout_analysis
        → table_extraction → ocr → chunking → completed

实现方式：
    1. 使用 dataclass 定义数据结构，字段类型完整
    2. 提供便捷方法添加质量问题和步骤统计
    3. 每个步骤执行后更新 processing_step / processing_progress
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional


# ============================================
# 数据结构定义
# ============================================

@dataclass
class TextBlock:
    """
    文本块（PDF 版面分析的最小单元）

    作用：
        表示 PDF 中一个连续的文本区域，带坐标信息，
        用于版面分析时按阅读顺序重排。

    字段说明：
        text: 文本内容
        page_number: 页码（从 1 开始）
        x0, y0, x1, y1: 文本块的边界框坐标（PDF 坐标系，左上为原点）
        block_type: 块类型（text/header/footer/table_caption/footnote）
        font_size: 字号（用于识别标题）
        is_bold: 是否加粗
    """
    text: str
    page_number: int
    x0: float = 0.0
    y0: float = 0.0
    x1: float = 0.0
    y1: float = 0.0
    block_type: str = "text"
    font_size: float = 0.0
    is_bold: bool = False


@dataclass
class ParsedPage:
    """
    解析后的页面

    作用：
        表示一个完整页面，包含按阅读顺序排列的文本块、
        检测到的表格、图片位置等信息。

    字段说明：
        page_number: 页码
        text: 该页的纯文本（已按阅读顺序重排）
        blocks: 文本块列表
        is_blank: 是否为空白页
        column_count: 栏数（1=单栏，2=双栏）
        tables: 该页检测到的表格索引列表
        images: 该页的图片索引列表
    """
    page_number: int
    text: str = ""
    blocks: List[TextBlock] = field(default_factory=list)
    is_blank: bool = False
    column_count: int = 1
    tables: List[int] = field(default_factory=list)
    images: List[int] = field(default_factory=list)


@dataclass
class ExtractedTable:
    """
    提取的表格

    作用：
        结构化表示一个表格，支持跨页合并。
        转为 Markdown 字符串后作为独立 chunk 参与检索。

    字段说明：
        table_id: 表格唯一标识
        page_number: 所在页码
        rows: 行数据（每行为单元格列表）
        markdown: 表格的 Markdown 表示
        row_count: 行数
        col_count: 列数
        is_cross_page: 是否为跨页表格的一部分
        merged_from: 合并来源（被合并的表格 ID 列表）
        bbox: 表格边界框（x0, y0, x1, y1）
        caption: 表格标题（如"表1：销售数据"）
    """
    table_id: int
    page_number: int
    rows: List[List[str]] = field(default_factory=list)
    markdown: str = ""
    row_count: int = 0
    col_count: int = 0
    is_cross_page: bool = False
    merged_from: List[int] = field(default_factory=list)
    bbox: Optional[tuple] = None
    caption: str = ""


@dataclass
class ExtractedImage:
    """
    提取的图片

    作用：
        表示 PDF/DOCX 中的图片，包含 OCR 文本和多模态描述，
        用于辅助理解纯文本无法表达的内容（如流程图、图表）。

    字段说明：
        image_id: 图片唯一标识
        page_number: 所在页码
        image_path: 图片保存路径
        ocr_text: OCR 识别的文本（无则空）
        description: 多模态模型生成的图片描述
        source: 来源（pdf/docx）
    """
    image_id: int
    page_number: int
    image_path: str = ""
    ocr_text: str = ""
    description: str = ""
    source: str = "pdf"


@dataclass
class ProcessedChunk:
    """
    处理后的分块

    作用：
        表示一个最终的分块单元，包含文本、元数据、块类型。
        直接传给 VectorStoreService.add_chunks 进行向量化。

    字段说明：
        text: 块文本内容
        chunk_index: 块在文档中的索引
        chunk_type: 块类型（text/table/image_description）
        page_number: 来源页码
        char_start: 在原文中的起始字符位置（仅文本块）
        char_end: 在原文中的结束字符位置（仅文本块）
        token_count: Token 数量
        metadata: 额外元数据（标题层级、表格 ID 等）
    """
    text: str
    chunk_index: int
    chunk_type: str = "text"
    page_number: Optional[int] = None
    char_start: Optional[int] = None
    char_end: Optional[int] = None
    token_count: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """
        转为字典格式（适配 VectorStoreService.add_chunks 的入参）

        作用：
            将 ProcessedChunk 转为 {"text": ..., "metadata": ...} 格式，
            便于直接调用向量存储服务。

        返回：
            Dict[str, Any] - 包含 text 和 metadata 的字典
        """
        return {
            "text": self.text,
            "metadata": {
                "chunk_index": self.chunk_index,
                "chunk_type": self.chunk_type,
                "page_number": self.page_number,
                "char_start": self.char_start,
                "char_end": self.char_end,
                "token_count": self.token_count,
                **self.metadata,
            }
        }


@dataclass
class StepStats:
    """
    单个步骤的统计信息

    作用：
        记录流水线每个步骤的耗时、成功/失败状态、产出数量。
        用于质量分析和性能优化。

    字段说明：
        step_name: 步骤名称
        started_at: 开始时间
        finished_at: 结束时间
        duration_ms: 耗时（毫秒）
        success: 是否成功
        error: 错误信息（失败时）
        input_count: 输入数量
        output_count: 输出数量
    """
    step_name: str
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    duration_ms: int = 0
    success: bool = True
    error: Optional[str] = None
    input_count: int = 0
    output_count: int = 0


# ============================================
# 流水线上下文
# ============================================

@dataclass
class PipelineContext:
    """
    流水线上下文

    作用：
        贯穿整个文档处理流水线，在各步骤间传递数据。
        所有步骤共享同一个 context 实例，逐步填充数据。

    使用方式：
        ctx = PipelineContext(
            file_path="/uploads/doc.pdf",
            file_type=".pdf",
            file_name="doc.pdf",
            document_id=1,
        )
        # 各步骤读取/写入 ctx 的字段
        cleaner.clean(ctx)
        chunker.chunk(ctx)

    字段说明：
        - 输入字段（创建时填充）
            file_path: 文件路径
            file_type: 文件类型（.pdf/.md/.txt/.docx）
            file_name: 文件名
            document_id: 文档ID（数据库主键）
            document_title: 文档标题

        - 解析阶段填充
            raw_text: 原始解析文本（未清洗）
            pages: 分页解析结果（PDF 才有）

        - 清洗阶段填充
            cleaned_text: 清洗后文本
            removed_chars_count: 清洗掉的字符数

        - 版面分析阶段填充（PDF）
            layout_detected: 是否检测到版面信息
            column_count: 栏数

        - 表格阶段填充
            tables: 提取的表格列表
            cross_page_tables_merged: 合并的跨页表格数

        - 图片阶段填充
            images: 提取的图片列表

        - 分块阶段填充
            chunks: 最终分块列表

        - 质量评估阶段填充
            quality_score: 质量分（0-100）
            quality_issues: 质量问题列表

        - 状态机字段
            processing_step: 当前步骤
            processing_progress: 进度（0-100）

        - 统计字段
            step_stats: 各步骤统计
            total_duration_ms: 总耗时
    """
    # 输入字段
    file_path: str
    file_type: str
    file_name: str
    document_id: Optional[int] = None
    document_title: str = ""

    # 解析阶段
    raw_text: str = ""
    pages: List[ParsedPage] = field(default_factory=list)

    # 清洗阶段
    cleaned_text: str = ""
    removed_chars_count: int = 0

    # 版面分析阶段
    layout_detected: bool = False
    column_count: int = 1

    # 表格阶段
    tables: List[ExtractedTable] = field(default_factory=list)
    cross_page_tables_merged: int = 0

    # 图片阶段
    images: List[ExtractedImage] = field(default_factory=list)

    # 分块阶段
    chunks: List[ProcessedChunk] = field(default_factory=list)

    # 质量评估
    quality_score: float = 0.0
    quality_issues: List[str] = field(default_factory=list)

    # 状态机
    processing_step: str = "uploaded"
    processing_progress: int = 0

    # 统计
    step_stats: Dict[str, StepStats] = field(default_factory=dict)
    total_duration_ms: int = 0

    # 修复 Issue 5：进度回调
    # 作用：流水线在每个步骤开始/进度更新时调用此回调，供调用方（document_tasks.py）
    #       实时更新数据库，前端轮询即可看到增量进度，避免一直显示 0% 或 100%。
    #       回调签名：(step: str, progress: int) -> None
    progress_callback: Optional[Callable[[str, int], None]] = None

    # ============================================
    # 便捷方法
    # ============================================

    def add_issue(self, issue: str) -> None:
        """
        添加质量问题

        作用：
            在任意步骤中发现质量问题时记录，便于最终评分和用户排查。

        参数：
            issue: str - 问题描述
        """
        if issue and issue not in self.quality_issues:
            self.quality_issues.append(issue)

    def start_step(self, step_name: str) -> StepStats:
        """
        开始一个步骤

        作用：
            记录步骤开始时间，更新当前 processing_step。
            步骤结束时调用 finish_step。

        参数：
            step_name: str - 步骤名称（与 Document.processing_step 对应）

        返回：
            StepStats - 步骤统计对象
        """
        stats = StepStats(
            step_name=step_name,
            started_at=datetime.now(),
        )
        self.step_stats[step_name] = stats
        self.processing_step = step_name
        # 修复 Issue 5：通知调用方当前步骤已变更，便于实时更新数据库进度
        if self.progress_callback:
            try:
                self.progress_callback(step_name, self.processing_progress)
            except Exception:
                pass  # 回调失败不影响流水线
        return stats

    def finish_step(
        self,
        step_name: str,
        success: bool = True,
        error: Optional[str] = None,
        input_count: int = 0,
        output_count: int = 0,
    ) -> None:
        """
        结束一个步骤

        作用：
            记录步骤结束时间、耗时、产出数量。
            失败时把错误信息加入质量问题。

        参数：
            step_name: str - 步骤名称
            success: bool - 是否成功
            error: Optional[str] - 错误信息
            input_count: int - 输入数量
            output_count: int - 输出数量
        """
        stats = self.step_stats.get(step_name)
        if stats is None:
            return

        stats.finished_at = datetime.now()
        if stats.started_at:
            stats.duration_ms = int(
                (stats.finished_at - stats.started_at).total_seconds() * 1000
            )
        stats.success = success
        stats.error = error
        stats.input_count = input_count
        stats.output_count = output_count

        if not success and error:
            self.add_issue(f"步骤 {step_name} 失败: {error}")

    def set_progress(self, progress: int) -> None:
        """
        更新处理进度

        作用：
            更新 processing_progress，供前端进度条展示。

        参数：
            progress: int - 进度（0-100）
        """
        self.processing_progress = max(0, min(100, progress))
        # 修复 Issue 5：通知调用方进度已更新，便于实时写入数据库
        if self.progress_callback:
            try:
                self.progress_callback(self.processing_step, self.processing_progress)
            except Exception:
                pass  # 回调失败不影响流水线

    def to_chunk_dicts(self) -> List[Dict[str, Any]]:
        """
        将所有 chunk 转为字典列表

        作用：
            适配 VectorStoreService.add_chunks 的入参格式。
            流水线结束后调用此方法，把分块交给向量化服务。

        返回：
            List[Dict[str, Any]] - 字典列表，每个字典含 text 和 metadata
        """
        return [chunk.to_dict() for chunk in self.chunks]

    def to_summary(self) -> Dict[str, Any]:
        """
        生成处理摘要

        作用：
            流水线结束后生成摘要，便于日志记录、数据库持久化、前端展示。

        返回：
            Dict[str, Any] - 包含质量分、问题、统计的摘要字典
        """
        return {
            "document_id": self.document_id,
            "file_name": self.file_name,
            "file_type": self.file_type,
            "processing_step": self.processing_step,
            "processing_progress": self.processing_progress,
            "quality_score": self.quality_score,
            "quality_issues": self.quality_issues,
            "page_count": len(self.pages),
            "table_count": len(self.tables),
            "image_count": len(self.images),
            "chunk_count": len(self.chunks),
            "removed_chars_count": self.removed_chars_count,
            "cross_page_tables_merged": self.cross_page_tables_merged,
            "total_duration_ms": self.total_duration_ms,
            "step_stats": {
                name: {
                    "duration_ms": s.duration_ms,
                    "success": s.success,
                    "error": s.error,
                    "input_count": s.input_count,
                    "output_count": s.output_count,
                }
                for name, s in self.step_stats.items()
            },
        }
