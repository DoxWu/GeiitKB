"""
表格提取与跨页合并模块

作用：
    使用 pdfplumber 从 PDF 中提取表格，结构化为 Markdown 格式，
    并自动检测和合并跨页表格。

    核心能力：
        1. 表格检测与提取（pdfplumber.find_tables）
        2. 表格转 Markdown 格式
        3. 跨页表格检测（表头一致 + 顶部位置 + 列数一致）
        4. 跨页表格合并（拼接行数据）

    为何需要跨页表格合并：
        PDF 中的表格常跨页显示，pdfplumber 会把每页的表格片段
        当作独立表格提取，导致数据碎片化。需要检测并合并。

实现方式：
    TableExtractor.extract(ctx) 提取所有表格，写入 ctx.tables。
"""

import logging
from typing import List, Optional, Tuple

from app.services.document_pipeline.context import (
    PipelineContext,
    ExtractedTable,
)

logger = logging.getLogger(__name__)


class TableExtractor:
    """
    表格提取器

    作用：
        从 PDF 中提取表格，转为结构化格式，合并跨页表格。

    使用方式：
        extractor = TableExtractor()
        extractor.extract(ctx)
        # ctx.tables 已填充
    """

    # 跨页表格判定：表头相似度阈值
    # 作用：下一页表格若与上一页表格表头相似度 >= 0.8，视为跨页表格
    _HEADER_SIMILARITY_THRESHOLD = 0.8

    # 跨页表格判定：下一页表格顶部位置阈值
    # 作用：跨页表格的延续部分通常出现在下一页顶部（y0 < 页高 * 0.2）
    _TOP_POSITION_RATIO = 0.2

    # 表格最小行数（少于则忽略，避免误识别）
    _MIN_ROWS = 2

    # 表格最小列数
    _MIN_COLS = 2

    def extract(self, ctx: PipelineContext) -> None:
        """
        提取表格主入口

        作用：
            遍历 PDF 各页，提取表格并合并跨页表格，写入 ctx.tables。

        实现方式：
            1. 检查配置是否启用表格提取
            2. 用 pdfplumber 打开 PDF
            3. 遍历每页，调用 _extract_tables_from_page 提取表格
            4. 调用 _merge_cross_page_tables 合并跨页表格
            5. 写入 ctx.tables

        参数：
            ctx: PipelineContext - 流水线上下文
        """
        from app.core.config import settings

        # 配置开关
        if not settings.ENABLE_TABLE_EXTRACTION:
            logger.info("表格提取已禁用，跳过")
            return

        # 仅 PDF 文件支持表格提取
        if ctx.file_type.lower() != ".pdf":
            logger.info(f"非 PDF 文件（{ctx.file_type}），跳过表格提取")
            return

        ctx.start_step("table_extraction")

        try:
            import pdfplumber

            raw_tables: List[ExtractedTable] = []
            table_id_counter = 0
            # 记录每页高度，供跨页表格合并的位置判断使用
            # 作用：跨页表格检测需要知道页高，判断上表是否在页底、下表是否在页顶
            page_heights: List[float] = []

            with pdfplumber.open(ctx.file_path) as pdf:
                for page_num, page in enumerate(pdf.pages, start=1):
                    page_heights.append(page.height)
                    page_tables = self._extract_tables_from_page(
                        page, page_num, table_id_counter
                    )
                    raw_tables.extend(page_tables)
                    table_id_counter += len(page_tables)

            # 合并跨页表格
            # 作用：把跨页的表格片段合并为完整表格
            merged_tables = self._merge_cross_page_tables(raw_tables, page_heights)

            # 记录合并数量
            ctx.cross_page_tables_merged = len(raw_tables) - len(merged_tables)

            ctx.tables = merged_tables

            ctx.finish_step(
                "table_extraction",
                success=True,
                input_count=len(raw_tables),
                output_count=len(merged_tables),
            )
            ctx.set_progress(60)

            logger.info(
                f"表格提取完成：检测到 {len(raw_tables)} 个表格，"
                f"合并后 {len(merged_tables)} 个，跨页合并 {ctx.cross_page_tables_merged} 个"
            )

        except ImportError:
            logger.warning("pdfplumber 未安装，跳过表格提取")
            ctx.finish_step(
                "table_extraction",
                success=False,
                error="pdfplumber not installed",
            )
            ctx.add_issue("pdfplumber 未安装，表格提取被跳过")

        except Exception as e:
            logger.error(f"表格提取失败: {e}", exc_info=True)
            ctx.finish_step("table_extraction", success=False, error=str(e))
            ctx.add_issue(f"表格提取失败: {e}")

    # ============================================
    # 单页表格提取
    # ============================================

    def _extract_tables_from_page(
        self,
        page,
        page_number: int,
        start_id: int,
    ) -> List[ExtractedTable]:
        """
        从单页提取表格

        作用：
            使用 pdfplumber 的 find_tables 检测表格，
            提取单元格数据并转为 ExtractedTable。

        实现方式：
            1. page.find_tables() 检测表格
            2. table.extract() 提取单元格数据
            3. 转为 Markdown 格式
            4. 过滤过小表格（少于 2 行 2 列）

        参数：
            page: pdfplumber.page.Page - pdfplumber 页面对象
            page_number: int - 页码
            start_id: int - 起始表格 ID

        返回:
            List[ExtractedTable] - 该页的表格列表
        """
        tables = []
        try:
            found_tables = page.find_tables()
        except Exception as e:
            logger.warning(f"页面 {page_number} 表格检测失败: {e}")
            return []

        for idx, table in enumerate(found_tables):
            try:
                # 提取单元格数据
                # 作用：table.extract() 返回 List[List[str]]，每个内层列表是一行
                rows = table.extract()

                # 过滤 None 和空白
                rows = [
                    [str(cell).strip() if cell else "" for cell in row]
                    for row in rows
                    if row
                ]

                # 过滤全空行
                rows = [row for row in rows if any(cell for cell in row)]

                # 检查最小尺寸
                if len(rows) < self._MIN_ROWS:
                    continue
                if len(rows[0]) < self._MIN_COLS:
                    continue

                # 生成 Markdown
                markdown = self._rows_to_markdown(rows)

                # 表格标题（尝试从前一个文本块提取）
                caption = self._find_table_caption(page, table)

                table_obj = ExtractedTable(
                    table_id=start_id + idx,
                    page_number=page_number,
                    rows=rows,
                    markdown=markdown,
                    row_count=len(rows),
                    col_count=len(rows[0]) if rows else 0,
                    bbox=table.bbox,
                    caption=caption,
                )
                tables.append(table_obj)

            except Exception as e:
                logger.warning(f"页面 {page_number} 表格 {idx} 提取失败: {e}")
                continue

        return tables

    # ============================================
    # 跨页表格合并
    # ============================================

    def _merge_cross_page_tables(
        self,
        tables: List[ExtractedTable],
        page_heights: Optional[List[float]] = None,
    ) -> List[ExtractedTable]:
        """
        合并跨页表格

        作用：
            检测连续页面上的表格片段，若为同一表格的延续部分则合并。

        检测条件（同时满足）：
            1. 两表格在连续页（page_number 相差 1）
            2. 列数相同
            3. 表头相似度高（>= 0.8）或下一表格位于页顶部（y0 < 页高 * 0.2）
            4. 上一表格在页底部（y1 > 页高 * 0.8）

        实现方式：
            1. 按页码排序
            2. 遍历相邻表格对，检查是否需要合并
            3. 合并时拼接行数据，保留首表的表头
            4. 标记 is_cross_page=True，记录 merged_from

        参数：
            tables: List[ExtractedTable] - 原始表格列表
            page_heights: Optional[List[float]] - 每页高度列表，用于位置判断

        返回:
            List[ExtractedTable] - 合并后的表格列表
        """
        if len(tables) < 2:
            return tables

        # 按页码排序
        sorted_tables = sorted(tables, key=lambda t: (t.page_number, t.bbox[1] if t.bbox else 0))

        merged: List[ExtractedTable] = []
        current = sorted_tables[0]

        for i in range(1, len(sorted_tables)):
            next_table = sorted_tables[i]

            # 检查是否在连续页
            if next_table.page_number != current.page_number + 1:
                merged.append(current)
                current = next_table
                continue

            # 检查列数是否相同
            if next_table.col_count != current.col_count:
                merged.append(current)
                current = next_table
                continue

            # 检查表头相似度
            header_similar = self._header_similarity(
                current.rows[0] if current.rows else [],
                next_table.rows[0] if next_table.rows else [],
            )

            # 检查位置：上一表格在底部，下一表格在顶部
            position_match = self._check_cross_page_position(
                current, next_table, page_heights
            )

            if header_similar >= self._HEADER_SIMILARITY_THRESHOLD or position_match:
                # 合并
                # 作用：把下一表格的行（去掉重复表头）追加到当前表格
                current = self._merge_two_tables(current, next_table)
            else:
                merged.append(current)
                current = next_table

        merged.append(current)

        return merged

    def _merge_two_tables(
        self,
        first: ExtractedTable,
        second: ExtractedTable,
    ) -> ExtractedTable:
        """
        合并两个跨页表格

        作用：
            把第二个表格的行数据追加到第一个表格，更新统计信息。

        实现方式：
            1. 检查第二个表格的首行是否为表头（与第一个表头相同）
            2. 若是则跳过表头，否则保留
            3. 拼接行数据
            4. 重新生成 Markdown
            5. 标记 is_cross_page 和 merged_from

        参数：
            first: ExtractedTable - 第一个表格
            second: ExtractedTable - 第二个表格

        返回:
            ExtractedTable - 合并后的表格
        """
        # 判断第二表首行是否为重复表头
        second_rows = second.rows
        if first.rows and second_rows:
            if self._header_similarity(first.rows[0], second_rows[0]) >= 0.9:
                # 跳过重复表头
                second_rows = second_rows[1:]

        merged_rows = first.rows + second_rows
        merged_markdown = self._rows_to_markdown(merged_rows)

        return ExtractedTable(
            table_id=first.table_id,
            page_number=first.page_number,
            rows=merged_rows,
            markdown=merged_markdown,
            row_count=len(merged_rows),
            col_count=first.col_count,
            is_cross_page=True,
            merged_from=first.merged_from + [second.table_id],
            bbox=first.bbox,
            caption=first.caption,
        )

    # ============================================
    # 表头相似度计算
    # ============================================

    def _header_similarity(
        self,
        header1: List[str],
        header2: List[str],
    ) -> float:
        """
        计算两个表头的相似度

        作用：
            判断两个表头是否一致，用于跨页表格检测。

        实现方式：
            1. 长度不同返回 0
            2. 逐单元格比较，相同则 +1
            3. 返回相同单元格比例

        参数：
            header1: List[str] - 第一个表头
            header2: List[str] - 第二个表头

        返回:
            float - 相似度（0-1）
        """
        if not header1 or not header2:
            return 0.0
        if len(header1) != len(header2):
            return 0.0

        match_count = sum(
            1 for a, b in zip(header1, header2)
            if a.strip().lower() == b.strip().lower()
        )
        return match_count / len(header1)

    # ============================================
    # 跨页位置检查
    # ============================================

    def _check_cross_page_position(
        self,
        first: ExtractedTable,
        second: ExtractedTable,
        page_heights: Optional[List[float]] = None,
    ) -> bool:
        """
        检查跨页表格的位置条件

        作用：
            判断两个表格是否满足"上表在页底、下表在页顶"的跨页特征。

        实现方式：
            1. 获取两个表格所在页的高度
            2. 检查上表底部位置 > 页高 * 0.7
            3. 检查下表顶部位置 < 页高 * 0.3

        参数：
            first: ExtractedTable - 第一个表格
            second: ExtractedTable - 第二个表格
            page_heights: Optional[List[float]] - 每页高度列表

        返回:
            bool - 是否满足跨页位置条件
        """
        if not first.bbox or not second.bbox:
            return False

        if not page_heights:
            # 无页面高度信息时仅基于表头判断，此处返回 False
            return False

        try:
            # 获取页高（页码从 1 开始，索引从 0 开始）
            first_page_height = page_heights[first.page_number - 1]
            second_page_height = page_heights[second.page_number - 1]

            # 上表底部位置
            first_bottom = first.bbox[3]
            # 下表顶部位置
            second_top = second.bbox[1]

            # 上表在页底（y1 > 页高 * 0.7）
            first_at_bottom = first_bottom > first_page_height * 0.7
            # 下表在页顶（y0 < 页高 * 0.3）
            second_at_top = second_top < second_page_height * 0.3

            return first_at_bottom and second_at_top

        except (IndexError, TypeError):
            return False

    # ============================================
    # Markdown 转换
    # ============================================

    def _rows_to_markdown(self, rows: List[List[str]]) -> str:
        """
        表格行数据转 Markdown 格式

        作用：
            把 List[List[str]] 转为 Markdown 表格字符串。

        参数：
            rows: List[List[str]] - 行数据

        返回:
            str - Markdown 表格
        """
        if not rows:
            return ""

        lines = []
        col_count = max(len(row) for row in rows)

        for i, row in enumerate(rows):
            # 补齐列数
            padded = row + [""] * (col_count - len(row))
            cells = [str(cell).strip().replace("|", "\\|").replace("\n", " ") for cell in padded]
            lines.append("| " + " | ".join(cells) + " |")

            # 第一行后插入分隔行
            if i == 0:
                lines.append("| " + " | ".join(["---"] * col_count) + " |")

        return "\n".join(lines)

    # ============================================
    # 表格标题提取
    # ============================================

    def _find_table_caption(self, page, table) -> str:
        """
        查找表格标题

        作用：
            在表格上方或下方查找"表X：xxx"格式的标题文本。
            表格标题包含重要语义信息，加入块中有助检索。

        实现方式：
            1. 获取表格 bbox
            2. 在表格上方（y < bbox[1]）查找包含"表"字的短文本
            3. 在表格下方（y > bbox[3]）查找作为补充

        参数：
            page: pdfplumber.page.Page - 页面对象
            table: pdfplumber.table.Table - 表格对象

        返回:
            str - 表格标题（无则空字符串）
        """
        try:
            bbox = table.bbox
            if not bbox:
                return ""

            # 提取页面上方文本
            # 作用：表格标题通常在表格正上方
            top_crop = page.crop(
                (0, max(0, bbox[1] - 30), page.width, bbox[1])
            )
            words = top_crop.extract_words()

            # 拼接上方文本
            if words:
                caption_text = "".join(w["text"] for w in words)

                # 检查是否符合表格标题格式
                # 作用：常见格式"表1：销售数据"、"Table 1: Sales Data"
                import re
                if re.match(r"^(表|Table)\s*\d+", caption_text, re.IGNORECASE):
                    return caption_text[:200]  # 限制长度

        except Exception as e:
            logger.debug(f"查找表格标题失败: {e}")

        return ""
