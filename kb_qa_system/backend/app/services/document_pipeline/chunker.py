"""
智能分块模块

作用：
    将清洗后的文本切分为合适大小的块（chunk），用于后续向量化。
    分块质量直接影响 RAG 检索精度。

    分块策略：
        1. 基础：RecursiveCharacterTextSplitter（按段落→句子→字符递归）
        2. 表格保持完整：表格作为独立块，不切分
        3. 图片描述独立成块：OCR 文本和图片描述作为独立块
        4. 元数据保留：每块携带页码、字符位置、块类型
        5. 标题层级感知：尽量在标题处切分，避免跨章节

实现方式：
    TextChunker.chunk(ctx) 读取 ctx.cleaned_text、ctx.tables、ctx.images，
    写入 ctx.chunks（ProcessedChunk 列表）。
"""

import logging
from typing import List, Optional

from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.core.config import settings
from app.services.document_pipeline.context import (
    PipelineContext,
    ProcessedChunk,
    ExtractedTable,
    ExtractedImage,
)

logger = logging.getLogger(__name__)


class TextChunker:
    """
    文本分块器

    作用：
        把清洗后的文本、表格、图片描述切分为 ProcessedChunk 列表。

    使用方式：
        chunker = TextChunker()
        chunker.chunk(ctx)
        # ctx.chunks 已填充
    """

    def __init__(self):
        """
        初始化分块器

        作用：
            创建 RecursiveCharacterTextSplitter 实例。
            参数从配置读取，可在运行时调整。

        实现方式：
            - chunk_size: 每块最大字符数
            - chunk_overlap: 相邻块重叠字符数（避免切断语义）
            - separators: 分块优先级，先段落，再句子，再字符
        """
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=settings.CHUNK_SIZE,
            chunk_overlap=settings.CHUNK_OVERLAP,
            separators=["\n\n", "\n", "。", ".", "！", "？", "；", ";", " ", ""],
            length_function=len,
        )

    # ============================================
    # 主入口
    # ============================================

    def chunk(self, ctx: PipelineContext) -> None:
        """
        分块主入口

        作用：
            把 ctx.cleaned_text 切分为文本块，
            把 ctx.tables 转为表格块，
            把 ctx.images 转为图片描述块。
            统一写入 ctx.chunks。

        实现方式：
            1. 切分纯文本
            2. 添加表格块（Markdown 格式）
            3. 添加图片描述块（OCR + 多模态描述）
            4. 重新编号 chunk_index
            5. 计算 token_count（粗略估算：字符数 / 1.5）

        参数：
            ctx: PipelineContext - 流水线上下文
        """
        ctx.start_step("chunking")
        input_count = len(ctx.cleaned_text) + len(ctx.tables) + len(ctx.images)

        try:
            all_chunks: List[ProcessedChunk] = []

            # 1. 文本分块
            text_chunks = self._chunk_text(ctx)
            all_chunks.extend(text_chunks)

            # 2. 表格分块（每个表格独立成块）
            for table in ctx.tables:
                table_chunk = self._make_table_chunk(table)
                if table_chunk:
                    all_chunks.append(table_chunk)

            # 3. 图片描述分块
            for image in ctx.images:
                image_chunk = self._make_image_chunk(image)
                if image_chunk:
                    all_chunks.append(image_chunk)

            # 4. 重新编号 chunk_index
            for idx, chunk in enumerate(all_chunks):
                chunk.chunk_index = idx

            ctx.chunks = all_chunks

            ctx.finish_step(
                "chunking",
                success=True,
                input_count=input_count,
                output_count=len(all_chunks),
            )
            ctx.set_progress(85)

            logger.info(
                f"分块完成：文本 {len(text_chunks)} 块，"
                f"表格 {len(ctx.tables)} 块，图片 {len(ctx.images)} 块，"
                f"共 {len(all_chunks)} 块"
            )

        except Exception as e:
            logger.error(f"分块失败: {e}", exc_info=True)
            ctx.finish_step("chunking", success=False, error=str(e))
            ctx.add_issue(f"分块失败: {e}")

    # ============================================
    # 文本分块
    # ============================================

    def _chunk_text(self, ctx: PipelineContext) -> List[ProcessedChunk]:
        """
        纯文本分块

        作用：
            使用 RecursiveCharacterTextSplitter 切分清洗后的文本。
            分块前保护 LaTeX 公式（替换为占位符），分块后恢复（占位符替换回公式）。

        实现方式：
            1. 用 LatexProtector 保护公式（避免分块器在公式中间切分）
            2. 调用 splitter.split_text 切分保护后的文本
            3. 恢复每个块中的占位符为原始公式
            4. 计算每块在原文中的字符位置（char_start/char_end）
            5. 推断所属页码（基于位置或单页文档）

        参数：
            ctx: PipelineContext - 流水线上下文

        返回:
            List[ProcessedChunk] - 文本块列表
        """
        if not ctx.cleaned_text or not ctx.cleaned_text.strip():
            return []

        # 1. 保护 LaTeX 公式（占位符替换）
        # 作用：RecursiveCharacterTextSplitter 可能在 $$...$$ 或 $...$ 中间切分，
        #       保护后公式作为整体不被截断，分块后再恢复
        # 开关检查：可通过 ENABLE_LATEX_PROTECTION 配置关闭（如纯非技术文档场景）
        latex_placeholders = {}
        if settings.ENABLE_LATEX_PROTECTION:
            from app.services.document_pipeline.latex_protector import LatexProtector
            protector = LatexProtector()
            protected_text, latex_placeholders = protector.protect(ctx.cleaned_text)
        else:
            protected_text = ctx.cleaned_text

        # 2. 调用 LangChain 分块器（对保护后的文本切分）
        text_pieces = self.text_splitter.split_text(protected_text)

        # 3. 恢复每个块中的 LaTeX 公式（占位符 → 原始公式）
        # 作用：让每个块包含完整的 LaTeX 公式，检索和生成时能正确渲染
        if latex_placeholders:
            from app.services.document_pipeline.latex_protector import LatexProtector
            protector = LatexProtector()
            text_pieces = protector.restore_chunks(text_pieces, latex_placeholders)

        chunks: List[ProcessedChunk] = []
        search_start = 0  # 在原文中搜索的起始位置

        for piece in text_pieces:
            # 在原文中查找该块的位置（用于 char_start/char_end）
            # 作用：定位块在原文的位置，前端可高亮显示
            # 注意：恢复后的 piece 包含原始公式，在原文中能精确匹配
            pos = ctx.cleaned_text.find(piece, search_start)
            if pos == -1:
                # 找不到则从头找（重叠块可能找不到精确位置）
                pos = ctx.cleaned_text.find(piece)
            if pos == -1:
                pos = search_start

            char_start = pos
            char_end = pos + len(piece)
            search_start = char_end - settings.CHUNK_OVERLAP  # 允许重叠区

            # 推断页码
            # 作用：单页文档（MD/TXT/DOCX）页码为 1
            #       多页文档（PDF）通过位置估算（简化处理）
            page_number = self._estimate_page_number(ctx, char_start)

            chunk = ProcessedChunk(
                text=piece,
                chunk_index=0,  # 后续统一编号
                chunk_type="text",
                page_number=page_number,
                char_start=char_start,
                char_end=char_end,
                token_count=self._estimate_tokens(piece),
                metadata={
                    "document_id": ctx.document_id,
                    "document_title": ctx.document_title,
                },
            )
            chunks.append(chunk)

        return chunks

    def _estimate_page_number(
        self,
        ctx: PipelineContext,
        char_pos: int,
    ) -> Optional[int]:
        """
        估算字符位置对应的页码

        作用：
            根据字符位置推断所属页码，便于检索结果展示来源页。
            PDF 多页文档通过页间分隔近似估算。

        实现方式：
            1. 单页文档直接返回 1
            2. 多页文档累加每页字符长度，找到包含该位置的页

        参数：
            ctx: PipelineContext - 流水线上下文
            char_pos: int - 字符位置（相对于 cleaned_text）

        返回:
            Optional[int] - 页码（无法判断时返回 None）
        """
        if not ctx.pages:
            return None

        if len(ctx.pages) == 1:
            return 1

        # 累加每页长度，找到包含 char_pos 的页
        # 注意：cleaned_text 是把各页拼接的结果，此为估算
        cumulative = 0
        for page in ctx.pages:
            page_len = len(page.text) + 2  # 加上页间分隔 "\n\n"
            if cumulative + page_len > char_pos:
                return page.page_number
            cumulative += page_len

        # 找不到则返回最后一页
        return ctx.pages[-1].page_number

    # ============================================
    # 表格分块
    # ============================================

    def _make_table_chunk(self, table: ExtractedTable) -> Optional[ProcessedChunk]:
        """
        创建表格分块

        作用：
            把 ExtractedTable 转为 ProcessedChunk。
            表格作为独立块参与检索，保持结构完整不被切分。

        参数：
            table: ExtractedTable - 提取的表格

        返回:
            Optional[ProcessedChunk] - 表格块（无内容则返回 None）
        """
        # 优先用 Markdown 表示
        content = table.markdown
        if not content and table.rows:
            content = self._rows_to_markdown(table.rows)

        if not content or not content.strip():
            return None

        # 拼接表格标题（如果有）
        # 作用：表格标题包含重要语义信息（如"表1：2024年销售数据"），加入块中有助检索
        text = content
        if table.caption:
            text = f"{table.caption}\n\n{content}"

        return ProcessedChunk(
            text=text,
            chunk_index=0,  # 后续统一编号
            chunk_type="table",
            page_number=table.page_number,
            char_start=None,
            char_end=None,
            token_count=self._estimate_tokens(text),
            metadata={
                "document_id": None,  # 由调用方填充
                "table_id": table.table_id,
                "is_cross_page": table.is_cross_page,
                "row_count": table.row_count,
                "col_count": table.col_count,
                "merged_from": table.merged_from,
            },
        )

    def _rows_to_markdown(self, rows: List[List[str]]) -> str:
        """
        把表格行数据转为 Markdown 格式

        作用：
            当 ExtractedTable.markdown 为空时，从 rows 重新生成 Markdown。

        参数：
            rows: List[List[str]] - 行数据

        返回:
            str - Markdown 表格
        """
        if not rows:
            return ""

        lines = []
        for i, row in enumerate(rows):
            cells = [str(cell).strip() for cell in row]
            lines.append("| " + " | ".join(cells) + " |")
            # 第一行后插入分隔行
            if i == 0:
                lines.append("| " + " | ".join(["---"] * len(row)) + " |")

        return "\n".join(lines)

    # ============================================
    # 图片描述分块
    # ============================================

    def _make_image_chunk(self, image: ExtractedImage) -> Optional[ProcessedChunk]:
        """
        创建图片描述分块

        作用：
            把 ExtractedImage 中的 OCR 文本和多模态描述合并为一个块。
            让纯文本无法表达的图表信息也能被检索到。

        实现方式：
            1. 优先使用多模态描述（语义更丰富）
            2. 拼接 OCR 文本（精确关键词）
            3. 标注来源页码

        参数：
            image: ExtractedImage - 提取的图片

        返回:
            Optional[ProcessedChunk] - 图片描述块（无内容则返回 None）
        """
        parts = []

        if image.description:
            parts.append(f"[图片描述] {image.description}")

        if image.ocr_text:
            parts.append(f"[图片中的文字] {image.ocr_text}")

        if not parts:
            return None

        text = "\n".join(parts)

        return ProcessedChunk(
            text=text,
            chunk_index=0,  # 后续统一编号
            chunk_type="image_description",
            page_number=image.page_number,
            char_start=None,
            char_end=None,
            token_count=self._estimate_tokens(text),
            metadata={
                "document_id": None,  # 由调用方填充
                "image_id": image.image_id,
                "image_path": image.image_path,
                "source": image.source,
            },
        )

    # ============================================
    # Token 估算
    # ============================================

    def _estimate_tokens(self, text: str) -> int:
        """
        粗略估算 Token 数量

        作用：
            在不调用 Tokenizer 的情况下快速估算 Token 数。
            用于成本估算和上下文长度控制。

        实现方式：
            中文约 1 字符 = 1.5 Token
            英文约 4 字符 = 1 Token
            这里取折中：字符数 / 1.5

        参数：
            text: str - 文本

        返回:
            int - 估算的 Token 数
        """
        if not text:
            return 0
        return max(1, int(len(text) / 1.5))
