"""
其他格式解析器（Markdown / TXT / Word / 网页）

作用：
    提供除 PDF 外的其他文档格式解析能力。
    PDF 解析逻辑复杂，单独放在 pdf_parser.py 中。

    各解析器统一返回 raw_text，由后续步骤（清洗、分块）统一处理。

实现方式：
    1. MarkdownParser - 直接读取（Markdown 本质是纯文本）
    2. TxtParser - 多编码尝试（UTF-8 → GBK → Latin-1）
    3. DocxParser - python-docx 提取段落和表格
    4. UrlParser - requests + BeautifulSoup 提取正文
"""

import os
import logging
from typing import List, Optional

import requests
from bs4 import BeautifulSoup
from docx import Document as DocxDocument

from app.services.document_pipeline.context import (
    PipelineContext,
    ParsedPage,
    TextBlock,
)

logger = logging.getLogger(__name__)


# ============================================
# Markdown 解析器
# ============================================

class MarkdownParser:
    """
    Markdown 解析器

    作用：
        读取 Markdown 文件的原始内容。
        Markdown 本质是纯文本，无需特殊解析，直接读取即可。

    使用方式：
        parser = MarkdownParser()
        text = parser.parse("/path/to/doc.md")
    """

    def parse(self, file_path: str) -> str:
        """
        解析 Markdown 文件

        作用：
            以 UTF-8 编码读取 Markdown 文件。

        参数：
            file_path: str - 文件路径

        返回：
            str - 文件内容
        """
        with open(file_path, "r", encoding="utf-8") as f:
            return f.read()

    def parse_to_context(self, ctx: PipelineContext) -> None:
        """
        解析并填充上下文

        作用：
            读取文件内容写入 ctx.raw_text，并把整篇文档作为单页放入 ctx.pages。
            Markdown 没有分页概念，作为单页处理。

        参数：
            ctx: PipelineContext - 流水线上下文
        """
        text = self.parse(ctx.file_path)
        ctx.raw_text = text
        ctx.pages = [
            ParsedPage(
                page_number=1,
                text=text,
                blocks=[TextBlock(text=text, page_number=1)],
                is_blank=not text.strip(),
            )
        ]


# ============================================
# TXT 解析器
# ============================================

class TxtParser:
    """
    纯文本解析器

    作用：
        读取 TXT 文件，自动检测编码。
        Windows 中文环境常见 GBK 编码，需多编码尝试。

    使用方式：
        parser = TxtParser()
        text = parser.parse("/path/to/doc.txt")
    """

    # 尝试的编码列表（按优先级）
    # 作用：UTF-8 是首选，失败则尝试 GBK（Windows 中文），最后用 Latin-1 兜底
    _ENCODINGS = ["utf-8", "utf-8-sig", "gbk", "gb2312", "big5", "latin-1"]

    def parse(self, file_path: str) -> str:
        """
        解析 TXT 文件

        作用：
            按优先级尝试多种编码，找到第一个能正确解码的编码。

        实现方式：
            1. 依次尝试 _ENCODINGS 中的编码
            2. 第一个不抛 UnicodeDecodeError 的编码即为正确编码
            3. 全部失败则用 Latin-1 强制解码（不抛异常但可能有乱码）

        参数：
            file_path: str - 文件路径

        返回：
            str - 文件内容
        """
        with open(file_path, "rb") as f:
            raw_bytes = f.read()

        for encoding in self._ENCODINGS:
            try:
                return raw_bytes.decode(encoding)
            except UnicodeDecodeError:
                continue

        # 全部失败，用 Latin-1 强制解码（不会抛异常）
        logger.warning(f"文件 {file_path} 编码检测失败，使用 latin-1 兜底")
        return raw_bytes.decode("latin-1", errors="replace")

    def parse_to_context(self, ctx: PipelineContext) -> None:
        """
        解析并填充上下文

        作用：
            读取文件内容写入 ctx.raw_text 和 ctx.pages。

        参数：
            ctx: PipelineContext - 流水线上下文
        """
        text = self.parse(ctx.file_path)
        ctx.raw_text = text
        ctx.pages = [
            ParsedPage(
                page_number=1,
                text=text,
                blocks=[TextBlock(text=text, page_number=1)],
                is_blank=not text.strip(),
            )
        ]


# ============================================
# Word（DOCX）解析器
# ============================================

class DocxParser:
    """
    Word 文档解析器

    作用：
        使用 python-docx 提取 Word 文档的段落和表格。
        DOCX 是 OOXML 格式，python-docx 能稳定解析。

    使用方式：
        parser = DocxParser()
        text = parser.parse("/path/to/doc.docx")
    """

    def parse(self, file_path: str) -> str:
        """
        解析 Word 文档

        作用：
            提取文档中所有段落和表格文本，按顺序拼接。

        实现方式：
            1. DocxDocument 打开文档
            2. 遍历 document.element.body 按原顺序处理段落和表格
            3. 表格转为 Markdown 格式插入文本流

        参数：
            file_path: str - 文件路径

        返回：
            str - 提取的文本
        """
        doc = DocxDocument(file_path)
        parts: List[str] = []

        # 按文档原始顺序遍历段落和表格
        # 作用：python-docx 的 doc.paragraphs 和 doc.tables 是分开的列表，
        # 需要通过底层元素遍历才能保持原顺序
        from docx.oxml.ns import qn
        body = doc.element.body
        for child in body.iterchildren():
            if child.tag == qn("w:p"):
                # 段落
                from docx.text.paragraph import Paragraph
                para = Paragraph(child, doc)
                if para.text.strip():
                    parts.append(para.text)
            elif child.tag == qn("w:tbl"):
                # 表格
                from docx.table import Table
                table = Table(child, doc)
                parts.append(self._table_to_markdown(table))

        return "\n\n".join(parts)

    def _table_to_markdown(self, table) -> str:
        """
        将 Word 表格转为 Markdown 格式

        作用：
            把 docx 表格转为 Markdown 表格字符串，便于后续统一处理。

        参数：
            table: docx.table.Table - docx 表格对象

        返回：
            str - Markdown 表格字符串
        """
        rows = []
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            rows.append("| " + " | ".join(cells) + " |")

        if len(rows) >= 1:
            # 在第一行后插入分隔行
            separator = "| " + " | ".join(["---"] * len(table.rows[0].cells)) + " |"
            rows.insert(1, separator)

        return "\n".join(rows)

    def parse_to_context(self, ctx: PipelineContext) -> None:
        """
        解析并填充上下文

        作用：
            提取文本写入 ctx.raw_text，作为单页处理。

        参数：
            ctx: PipelineContext - 流水线上下文
        """
        text = self.parse(ctx.file_path)
        ctx.raw_text = text
        ctx.pages = [
            ParsedPage(
                page_number=1,
                text=text,
                blocks=[TextBlock(text=text, page_number=1)],
                is_blank=not text.strip(),
            )
        ]


# ============================================
# 网页解析器
# ============================================

class UrlParser:
    """
    网页解析器

    作用：
        下载网页并提取正文内容，去除导航、广告等噪声。

    使用方式：
        parser = UrlParser()
        text = parser.parse("https://example.com/article")
    """

    # 请求头，模拟浏览器访问
    _HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )
    }

    def parse(self, url: str, timeout: int = 30) -> str:
        """
        下载并解析网页

        作用：
            下载网页 HTML，提取正文文本。

        实现方式：
            1. requests 下载页面
            2. BeautifulSoup 解析 HTML
            3. 移除 script/style/nav 等非正文标签
            4. 提取纯文本，去除多余空白

        参数：
            url: str - 网页 URL
            timeout: int - 超时时间（秒）

        返回：
            str - 提取的正文文本

        异常：
            requests.RequestException - 下载失败
        """
        # C-1 + C-8 修复：禁用重定向 + 流式下载 + 大小限制
        # C-1 作用：validate_url 仅校验初始 URL，若允许重定向，攻击者可让公网域名
        #           302 跳转到 169.254.169.254（云元数据）或内网地址，绕过所有 SSRF 防护
        #           修复：allow_redirects=False，遇到 3xx 直接拒绝
        # C-8 作用：原实现整个 response.content 读入内存，无大小限制，攻击者指向超大文件导致 OOM
        #           修复：stream=True 流式下载，边读边检查累计字节数，超限立即中止
        response = requests.get(
            url,
            headers=self._HEADERS,
            timeout=timeout,
            allow_redirects=False,  # C-1: 禁用重定向，防止 SSRF 绕过
            stream=True,            # C-8: 流式下载，便于边读边检查大小
        )

        # C-1: 拒绝任何重定向响应（301/302/303/307/308）
        # 作用：业务上单页文档导入不需要跟随重定向，用户应直接提供最终 URL
        if response.is_redirect or response.is_permanent_redirect:
            response.close()
            raise ValueError(f"安全策略禁止 URL 重定向，请提供最终 URL（target={url}）")

        response.raise_for_status()

        # C-8: 检查 Content-Length（若服务端提供）
        # 作用：在下载前即可拒绝超大文件，避免无谓的网络传输
        from app.core.config import settings
        max_size = settings.URL_IMPORT_MAX_SIZE
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > max_size:
            response.close()
            raise ValueError(
                f"下载内容过大（{int(content_length)} bytes），最大允许 {max_size} bytes"
            )

        # C-8: 流式读取 + 边写边检查累计大小
        # 作用：即使无 Content-Length（如 chunked transfer），也通过累计字节数限制
        #       超过 max_size 立即中止下载，防止 OOM
        downloaded = 0
        chunks = []
        for chunk in response.iter_content(chunk_size=1024 * 1024):  # 1MB chunks
            if not chunk:
                continue
            downloaded += len(chunk)
            if downloaded > max_size:
                response.close()
                raise ValueError(
                    f"下载内容超过大小限制（{max_size} bytes），已中止下载"
                )
            chunks.append(chunk)

        response.close()
        content = b"".join(chunks)

        # BeautifulSoup 解析
        soup = BeautifulSoup(content, "html.parser")

        # 移除非正文标签
        # 作用：导航栏、页脚、脚本、样式等不含正文内容
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()

        # 提取文本
        text = soup.get_text(separator="\n", strip=True)

        # 去除多余空行
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        return "\n".join(lines)

    def parse_to_context(
        self,
        ctx: PipelineContext,
        url: Optional[str] = None,
    ) -> None:
        """
        解析并填充上下文

        作用：
            下载并提取正文，写入 ctx.raw_text 和 ctx.pages。

        参数：
            ctx: PipelineContext - 流水线上下文
            url: Optional[str] - URL（为空则用 ctx.file_path）
        """
        target_url = url or ctx.file_path
        text = self.parse(target_url)
        ctx.raw_text = text
        ctx.pages = [
            ParsedPage(
                page_number=1,
                text=text,
                blocks=[TextBlock(text=text, page_number=1)],
                is_blank=not text.strip(),
            )
        ]


# ============================================
# 解析器工厂
# ============================================

# 全局解析器实例（无状态，可复用）
# 作用：避免每次解析都创建新实例
_markdown_parser = MarkdownParser()
_txt_parser = TxtParser()
_docx_parser = DocxParser()
_url_parser = UrlParser()


def get_parser(file_type: str):
    """
    根据文件类型获取解析器

    作用：
        工厂方法，根据扩展名返回对应的解析器实例。

    参数：
        file_type: str - 文件类型（.md/.txt/.docx/.url）

    返回:
        对应的解析器实例，无匹配则返回 None
    """
    file_type = file_type.lower()
    if file_type in (".md", ".markdown"):
        return _markdown_parser
    elif file_type == ".txt":
        return _txt_parser
    elif file_type == ".docx":
        return _docx_parser
    elif file_type in (".url", ".html", ".htm"):
        return _url_parser
    return None
