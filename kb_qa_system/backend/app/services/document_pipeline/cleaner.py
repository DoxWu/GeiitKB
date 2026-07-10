"""
脏数据清洗模块

作用：
    在文档解析后、分块前清洗文本，去除影响检索和 LLM 理解的脏数据。

    清洗维度：
        1. 不可见控制字符（NULL/BEL/BS/FF 等）
        2. Unicode 替换字符（U+FFFD，编码错误标志）
        3. 重复空白（多个空格/换行/制表符）
        4. 页眉页脚（多页重复出现的顶/底端文本）
        5. 水印文字（旋转文本、半透明文字暂不处理，留待 PDF 版面阶段）
        6. 过短无意义行（单个字符、纯标点）
        7. 二进制/乱码片段（连续非可打印字符占比高的段）
        8. 编码规范化（全角→半角、Unicode NFC 规范化）

实现方式：
    1. TextCleaner 类提供 clean(text, pages) 方法
    2. 每个清洗规则独立成方法，便于单测
    3. 统计 removed_chars_count 用于质量评分
    4. 清洗失败不抛异常，返回原文（避免阻断流水线）
"""

import re
import unicodedata
import logging
from typing import List, Tuple

from app.services.document_pipeline.context import PipelineContext, ParsedPage

logger = logging.getLogger(__name__)


class TextCleaner:
    """
    文本清洗器

    作用：
        对解析后的文本执行一系列清洗规则，产出干净的文本供分块使用。

    使用方式：
        cleaner = TextCleaner()
        cleaner.clean(ctx)  # 直接修改 ctx.cleaned_text
    """

    # 不可见控制字符正则
    # 作用：匹配 NULL/BEL/BS/FF/VT 等不可见字符，但保留 \n \r \t
    # \x00-\x08: NULL-BACKSPACE（不含 \t=\x09）
    # \x0b-\x0c: VT/FF（不含 \n=\x0a, \r=\x0d）
    # \x0e-\x1f: SO-US
    # \x7f: DEL
    _INVISIBLE_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

    # Unicode 替换字符（编码错误标志）
    _REPLACEMENT_CHAR = "\ufffd"

    # 多个空白字符合并为一个
    _MULTI_SPACE_RE = re.compile(r"[ \t]+")
    _MULTI_NEWLINE_RE = re.compile(r"\n{3,}")

    # 过短无意义行（仅标点/单个字符）
    _MEANINGLESS_LINE_RE = re.compile(r"^[\s\W_]{0,3}$", re.UNICODE)

    # 连续非可打印/乱码片段（连续 8 个以上非常用字符）
    # 作用：检测二进制污染片段
    _GARBAGE_RUN_RE = re.compile(
        r"[\ufffd\u0000-\u001f\s]{8,}"
    )

    # 全角字符范围（用于全角→半角转换）
    # 全角空格 U+3000，全角字符 U+FF01-FF5E
    _FULLWIDTH_SPACE = "\u3000"

    def __init__(self):
        """
        初始化清洗器

        作用：
            预编译正则，记录清洗统计。
        """
        self.removed_chars_count = 0

    # ============================================
    # 主入口
    # ============================================

    def clean(self, ctx: PipelineContext) -> None:
        """
        清洗文本主入口

        作用：
            对 ctx.raw_text 执行完整清洗流程，结果写入 ctx.cleaned_text。
            同时对 ctx.pages 中每页的文本做同步清洗。

        实现方式：
            1. 检测页眉页脚（基于 pages）
            2. 依次应用清洗规则
            3. 统计移除字符数
            4. 清洗失败不抛异常，记录 issue

        参数：
            ctx: PipelineContext - 流水线上下文
        """
        ctx.start_step("cleaning")
        original_len = len(ctx.raw_text)

        try:
            # 1. 检测页眉页脚（仅 PDF 有 pages 信息）
            header, footer = self._detect_header_footer(ctx.pages)

            # 2. 清洗全文
            cleaned = ctx.raw_text

            # 去除页眉页脚
            if header or footer:
                cleaned = self._remove_header_footer(cleaned, header, footer)

            # 不可见字符
            cleaned = self._remove_invisible_chars(cleaned)

            # Unicode 规范化（NFC，组合字符分解后再组合）
            cleaned = unicodedata.normalize("NFC", cleaned)

            # 全角→半角
            cleaned = self._normalize_fullwidth(cleaned)

            # 替换字符处理（编码错误标志）
            cleaned = self._handle_replacement_char(cleaned, ctx)

            # 重复空白
            cleaned = self._collapse_whitespace(cleaned)

            # 过短无意义行
            cleaned = self._remove_meaningless_lines(cleaned)

            # 二进制污染片段
            cleaned = self._remove_garbage_runs(cleaned, ctx)

            # 去除首尾空白
            cleaned = cleaned.strip()

            ctx.cleaned_text = cleaned
            ctx.removed_chars_count = original_len - len(cleaned)

            # 同步清洗各页文本
            for page in ctx.pages:
                if page.text:
                    page.text = self._quick_clean(page.text)

            ctx.finish_step(
                "cleaning",
                success=True,
                input_count=original_len,
                output_count=len(cleaned),
            )
            ctx.set_progress(40)

            logger.info(
                f"清洗完成：原 {original_len} 字符 → 清洗后 {len(cleaned)} 字符，"
                f"移除 {ctx.removed_chars_count} 字符"
            )

        except Exception as e:
            logger.error(f"文本清洗失败: {e}", exc_info=True)
            # 失败兜底：使用原始文本
            ctx.cleaned_text = ctx.raw_text
            ctx.finish_step("cleaning", success=False, error=str(e))
            ctx.add_issue(f"文本清洗失败: {e}")

    # ============================================
    # 页眉页脚检测
    # ============================================

    def _detect_header_footer(
        self,
        pages: List[ParsedPage],
        min_repeat_count: int = 3,
    ) -> Tuple[str, str]:
        """
        检测页眉页脚

        作用：
            多页 PDF 中，页眉/页脚通常在每页重复出现（页码、文档标题、章节名等）。
            检测出后从正文中去除，避免污染检索。

        实现方式：
            1. 取每页首行和末行
            2. 统计每行在多少页出现
            3. 出现次数 >= min_repeat_count 视为页眉/页脚

        参数：
            pages: List[ParsedPage] - 解析后的页面列表
            min_repeat_count: int - 最小重复次数阈值

        返回：
            Tuple[str, str] - (页眉文本, 页脚文本)
        """
        if len(pages) < min_repeat_count:
            return "", ""

        from collections import Counter

        first_lines: List[str] = []
        last_lines: List[str] = []

        for page in pages:
            lines = [line.strip() for line in page.text.splitlines() if line.strip()]
            if not lines:
                continue
            # 取首行（页眉候选）
            first_lines.append(lines[0][:100])  # 截断避免过长
            # 取末行（页脚候选）
            last_lines.append(lines[-1][:100])

        first_counter = Counter(first_lines)
        last_counter = Counter(last_lines)

        # 找出出现次数 >= 阈值 的行
        header = ""
        footer = ""
        for line, count in first_counter.most_common(1):
            if count >= min_repeat_count and len(line) > 1:
                header = line
                break
        for line, count in last_counter.most_common(1):
            if count >= min_repeat_count and len(line) > 1:
                footer = line
                break

        return header, footer

    def _remove_header_footer(
        self,
        text: str,
        header: str,
        footer: str,
    ) -> str:
        """
        移除页眉页脚

        作用：
            从全文中删除检测到的页眉页脚文本。

        参数：
            text: str - 原文
            header: str - 页眉文本
            footer: str - 页脚文本

        返回：
            str - 移除后的文本
        """
        if header:
            text = text.replace(header, "")
        if footer:
            text = text.replace(footer, "")
        return text

    # ============================================
    # 不可见字符清洗
    # ============================================

    def _remove_invisible_chars(self, text: str) -> str:
        """
        移除不可见控制字符

        作用：
            去除 NULL/BEL/BS/FF 等不可见字符，但保留 \n \r \t。
            这些字符会影响文本匹配和 LLM 理解。

        参数：
            text: str - 原文

        返回：
            str - 清洗后文本
        """
        return self._INVISIBLE_CHARS_RE.sub("", text)

    # ============================================
    # 替换字符处理
    # ============================================

    def _handle_replacement_char(
        self,
        text: str,
        ctx: PipelineContext,
    ) -> str:
        """
        处理 Unicode 替换字符（U+FFFD）

        作用：
            U+FFFD 表示编码错误，大量出现说明文档存在编码问题。
            策略：连续 3 个以上替换字符替换为空，并记录质量问题。

        参数：
            text: str - 原文
            ctx: PipelineContext - 用于记录质量问题

        返回：
            str - 处理后文本
        """
        if self._REPLACEMENT_CHAR not in text:
            return text

        # 统计替换字符数量
        count = text.count(self._REPLACEMENT_CHAR)
        # 占比超过 5% 标记为质量问题
        if count > len(text) * 0.05:
            ctx.add_issue(f"文档存在编码错误（{count} 个替换字符），可能影响检索质量")

        # 连续 3 个以上替换字符替换为空
        return re.sub(r"\ufffd{3,}", "", text)

    # ============================================
    # 全角→半角
    # ============================================

    def _normalize_fullwidth(self, text: str) -> str:
        """
        全角字符转半角

        作用：
            中文文档常见全角字符（如 ， ： ！ ？），
            统一转为半角以便与用户输入匹配（用户多用半角输入）。
            保留中文标点不动，仅转换 ASCII 范围的全角字符。

        实现方式：
            1. 全角空格 U+3000 → 普通空格
            2. 全角 ASCII U+FF01-FF5E → 减去 0xFEE0 转半角

        参数：
            text: str - 原文

        返回：
            str - 半角化后文本
        """
        result = []
        for ch in text:
            if ch == self._FULLWIDTH_SPACE:
                result.append(" ")
            elif "\uff01" <= ch <= "\uff5e":
                result.append(chr(ord(ch) - 0xFEE0))
            else:
                result.append(ch)
        return "".join(result)

    # ============================================
    # 空白规范化
    # ============================================

    def _collapse_whitespace(self, text: str) -> str:
        """
        折叠重复空白

        作用：
            多个连续空格/制表符合并为一个，多个连续空行合并为两个。
            避免分块时产生大量空白块。

        参数：
            text: str - 原文

        返回：
            str - 折叠后文本
        """
        # 多个空格/制表符合并为一个
        text = self._MULTI_SPACE_RE.sub(" ", text)
        # 三个以上换行合并为两个（保留段落分隔）
        text = self._MULTI_NEWLINE_RE.sub("\n\n", text)
        return text

    # ============================================
    # 过短无意义行
    # ============================================

    def _remove_meaningless_lines(self, text: str) -> str:
        """
        移除过短无意义行

        作用：
            删除仅含空白或标点的行（如孤立的 "." "—" "·"），
            这些行通常是分页符、装饰线，对检索无价值。

        参数：
            text: str - 原文

        返回:
            str - 清洗后文本
        """
        lines = text.splitlines()
        kept = []
        for line in lines:
            stripped = line.strip()
            # 保留有意义的行（至少 2 个非空白字符）
            if len(stripped) >= 2 or stripped == "":
                kept.append(line)
        return "\n".join(kept)

    # ============================================
    # 二进制污染片段
    # ============================================

    def _remove_garbage_runs(
        self,
        text: str,
        ctx: PipelineContext,
    ) -> str:
        """
        移除二进制污染片段

        作用：
            PDF 解析偶发把二进制流误识别为文本，产生连续乱码片段。
            检测连续 8 个以上替换字符/控制字符的片段并删除。

        参数：
            text: str - 原文
            ctx: PipelineContext - 用于记录质量问题

        返回：
            str - 清洗后文本
        """
        original_len = len(text)
        cleaned = self._GARBAGE_RUN_RE.sub(" ", text)
        removed = original_len - len(cleaned)
        if removed > 100:
            ctx.add_issue(f"检测到二进制污染片段（约 {removed} 字符）")
        return cleaned

    # ============================================
    # 快速清洗（用于单页文本）
    # ============================================

    def _quick_clean(self, text: str) -> str:
        """
        快速清洗（用于单页文本）

        作用：
            对单页文本执行轻量清洗，不做页眉页脚检测。
            在 clean() 内部对 ctx.pages 同步清洗时调用。

        参数：
            text: str - 单页文本

        返回:
            str - 清洗后文本
        """
        text = self._remove_invisible_chars(text)
        text = unicodedata.normalize("NFC", text)
        text = self._normalize_fullwidth(text)
        text = self._collapse_whitespace(text)
        return text.strip()
