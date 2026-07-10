"""
文档质量评分模块

作用：
    对文档解析结果进行多维质量评估，产出 0-100 的质量分，
    并列出质量问题清单。

    评分维度：
        1. 文本提取率（提取的字符数 / 文件大小）
        2. 乱码比例（清洗移除字符 / 原始字符）
        3. 空白页比例（空白页数 / 总页数）
        4. 表格识别成功率（提取表格数 / 检测表格数）
        5. OCR 覆盖率（OCR 文本 / 图片数）
        6. 分块质量（块数 / 平均块长）

    低于阈值的文档标记为 low_quality，需人工排查。

实现方式：
    QualityScorer.score(ctx) 计算各维度得分加权平均，
    写入 ctx.quality_score 和 ctx.quality_issues。
"""

import logging
from typing import Dict

from app.services.document_pipeline.context import PipelineContext

logger = logging.getLogger(__name__)


class QualityScorer:
    """
    质量评分器

    作用：
        综合评估文档处理质量，给出 0-100 分和问题清单。

    使用方式：
        scorer = QualityScorer()
        scorer.score(ctx)
        # ctx.quality_score, ctx.quality_issues 已填充
    """

    # 各维度权重（总和 1.0）
    # 作用：文本提取率最关键，乱码和空白页次之，表格/OCR 视文档类型可选
    _WEIGHTS = {
        "text_extraction": 0.30,
        "garbage_ratio": 0.20,
        "blank_page_ratio": 0.15,
        "table_extraction": 0.15,
        "ocr_coverage": 0.10,
        "chunk_quality": 0.10,
    }

    # 文本提取率参考阈值（字符/字节）
    # 作用：纯文本每字节约 1 字符，PDF 每 10 字节约 1 字符
    # 这里用保守阈值 1 字符 / 50 字节
    _TEXT_EXTRACTION_FACTOR = 50

    def score(self, ctx: PipelineContext) -> None:
        """
        计算质量分

        作用：
            综合各维度得分计算最终质量分，写入 ctx.quality_score。
            发现的问题加入 ctx.quality_issues。

        参数：
            ctx: PipelineContext - 流水线上下文
        """
        ctx.start_step("quality_scoring")

        try:
            scores: Dict[str, float] = {}

            # 1. 文本提取率
            scores["text_extraction"] = self._score_text_extraction(ctx)

            # 2. 乱码比例
            scores["garbage_ratio"] = self._score_garbage_ratio(ctx)

            # 3. 空白页比例
            scores["blank_page_ratio"] = self._score_blank_page(ctx)

            # 4. 表格识别成功率
            scores["table_extraction"] = self._score_table_extraction(ctx)

            # 5. OCR 覆盖率
            scores["ocr_coverage"] = self._score_ocr_coverage(ctx)

            # 6. 分块质量
            scores["chunk_quality"] = self._score_chunk_quality(ctx)

            # 加权平均
            total_score = 0.0
            for dim, weight in self._WEIGHTS.items():
                total_score += scores.get(dim, 0) * weight

            ctx.quality_score = round(total_score, 2)

            # 标记低质量文档
            if ctx.quality_score < 60:
                ctx.add_issue(f"文档质量分偏低（{ctx.quality_score}/100）")

            ctx.finish_step(
                "quality_scoring",
                success=True,
                output_count=1,
            )

            logger.info(
                f"质量评分完成：{ctx.quality_score}/100，"
                f"各维度：{scores}，问题数：{len(ctx.quality_issues)}"
            )

        except Exception as e:
            logger.error(f"质量评分失败: {e}", exc_info=True)
            ctx.quality_score = 50.0  # 失败时给中等分，不阻断流程
            ctx.finish_step("quality_scoring", success=False, error=str(e))

    # ============================================
    # 维度1：文本提取率
    # ============================================

    def _score_text_extraction(self, ctx: PipelineContext) -> float:
        """
        评分：文本提取率

        作用：
            评估从文档中提取的文本量是否充足。
            提取量过低说明可能是扫描件或解析失败。

        实现方式：
            比较提取的字符数与文件大小（字节）的比例。
            比例越高得分越高。

        参数：
            ctx: PipelineContext - 流水线上下文

        返回:
            float - 0-100 分
        """
        import os
        if not os.path.exists(ctx.file_path):
            return 50.0

        file_size = os.path.getsize(ctx.file_path)
        if file_size == 0:
            return 50.0

        text_len = len(ctx.cleaned_text)
        # 期望比例：每 50 字节至少 1 字符
        expected_chars = file_size / self._TEXT_EXTRACTION_FACTOR
        ratio = text_len / expected_chars if expected_chars > 0 else 0

        if ratio >= 1.0:
            return 100.0
        elif ratio >= 0.5:
            return 80.0
        elif ratio >= 0.2:
            return 60.0
        elif ratio >= 0.05:
            ctx.add_issue("文本提取率偏低，可能是扫描件或图片型 PDF")
            return 40.0
        else:
            ctx.add_issue("文本提取量极少，建议启用 OCR 或检查文件")
            return 20.0

    # ============================================
    # 维度2：乱码比例
    # ============================================

    def _score_garbage_ratio(self, ctx: PipelineContext) -> float:
        """
        评分：乱码比例

        作用：
            评估清洗阶段移除的脏数据占比。
            占比过高说明原文存在严重编码问题。

        参数：
            ctx: PipelineContext - 流水线上下文

        返回:
            float - 0-100 分
        """
        original_len = len(ctx.raw_text)
        if original_len == 0:
            return 80.0

        ratio = ctx.removed_chars_count / original_len

        if ratio <= 0.05:
            return 100.0
        elif ratio <= 0.15:
            return 80.0
        elif ratio <= 0.30:
            ctx.add_issue(f"脏数据比例较高（{ratio*100:.1f}%）")
            return 60.0
        else:
            ctx.add_issue(f"脏数据比例过高（{ratio*100:.1f}%），原文质量差")
            return 30.0

    # ============================================
    # 维度3：空白页比例
    # ============================================

    def _score_blank_page(self, ctx: PipelineContext) -> float:
        """
        评分：空白页比例

        作用：
            评估空白页占比。过多空白页通常意味着分页符异常或扫描失败。

        参数：
            ctx: PipelineContext - 流水线上下文

        返回:
            float - 0-100 分
        """
        if not ctx.pages:
            return 80.0

        blank_count = sum(1 for p in ctx.pages if p.is_blank)
        ratio = blank_count / len(ctx.pages)

        if ratio <= 0.05:
            return 100.0
        elif ratio <= 0.20:
            return 80.0
        elif ratio <= 0.40:
            ctx.add_issue(f"空白页比例较高（{ratio*100:.1f}%）")
            return 60.0
        else:
            ctx.add_issue(f"空白页比例过高（{ratio*100:.1f}%）")
            return 30.0

    # ============================================
    # 维度4：表格识别成功率
    # ============================================

    def _score_table_extraction(self, ctx: PipelineContext) -> float:
        """
        评分：表格识别成功率

        作用：
            评估表格提取的效果。如果没有检测到表格候选，给满分（不适用）。

        参数：
            ctx: PipelineContext - 流水线上下文

        返回:
            float - 0-100 分
        """
        # 表格相关统计在 step_stats.table_extraction 中
        stats = ctx.step_stats.get("table_extraction")
        if stats is None or stats.input_count == 0:
            # 没有检测到表格候选，本维度不适用，给满分
            return 100.0

        success_rate = stats.output_count / stats.input_count if stats.input_count > 0 else 0

        if success_rate >= 0.9:
            return 100.0
        elif success_rate >= 0.7:
            return 80.0
        elif success_rate >= 0.5:
            ctx.add_issue(f"表格识别成功率偏低（{success_rate*100:.1f}%）")
            return 60.0
        else:
            ctx.add_issue(f"表格识别失败较多（{success_rate*100:.1f}%）")
            return 30.0

    # ============================================
    # 维度5：OCR 覆盖率
    # ============================================

    def _score_ocr_coverage(self, ctx: PipelineContext) -> float:
        """
        评分：OCR 覆盖率

        作用：
            评估图片 OCR 的覆盖率。没有图片则本维度不适用。

        参数：
            ctx: PipelineContext - 流水线上下文

        返回:
            float - 0-100 分
        """
        if not ctx.images:
            # 没有图片，本维度不适用，给满分
            return 100.0

        ocr_count = sum(1 for img in ctx.images if img.ocr_text)
        coverage = ocr_count / len(ctx.images)

        if coverage >= 0.9:
            return 100.0
        elif coverage >= 0.7:
            return 80.0
        elif coverage >= 0.5:
            return 60.0
        else:
            ctx.add_issue(f"OCR 覆盖率偏低（{coverage*100:.1f}%）")
            return 40.0

    # ============================================
    # 维度6：分块质量
    # ============================================

    def _score_chunk_quality(self, ctx: PipelineContext) -> float:
        """
        评分：分块质量

        作用：
            评估分块结果的合理性。块数过少或过多、平均块长异常都扣分。

        参数：
            ctx: PipelineContext - 流水线上下文

        返回:
            float - 0-100 分
        """
        chunk_count = len(ctx.chunks)
        if chunk_count == 0:
            ctx.add_issue("未生成任何分块")
            return 0.0

        # 平均块长
        avg_chunk_len = sum(len(c.text) for c in ctx.chunks) / chunk_count

        # 块数过少
        if chunk_count < 3:
            ctx.add_issue(f"分块数过少（{chunk_count} 块），检索精度可能不足")
            return 60.0

        # 块数过多
        if chunk_count > 5000:
            ctx.add_issue(f"分块数过多（{chunk_count} 块），可能影响性能")
            return 70.0

        # 平均块长异常
        if avg_chunk_len < 50:
            ctx.add_issue(f"平均块长过短（{avg_chunk_len:.0f} 字符）")
            return 60.0
        elif avg_chunk_len > 2000:
            ctx.add_issue(f"平均块长过长（{avg_chunk_len:.0f} 字符）")
            return 70.0

        return 100.0
