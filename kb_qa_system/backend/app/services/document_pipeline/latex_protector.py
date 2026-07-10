"""
LaTeX 公式保护器

作用：
    在文档分块前保护 LaTeX 公式不被截断，分块后恢复原始公式。

    为何需要公式保护：
        RecursiveCharacterTextSplitter 按段落→句子→字符递归切分，
        可能在 LaTeX 公式中间切断（如 $$\int_0^1 被切为两个块），
        导致检索时公式不完整，LLM 无法正确理解和渲染。

    保护策略（占位符替换）：
        1. 分块前：将所有 LaTeX 公式替换为唯一占位符
           - 块级公式 $$...$$ → @@LATEX_BLOCK_{n}@@
           - 行内公式 $...$   → @@LATEX_INLINE_{n}@@
        2. 分块后：将占位符恢复为原始公式
        3. 占位符不含特殊字符，不会被分块器切分

    匹配规则（顺序敏感）：
        1. 先匹配块级公式 $$...$$（贪婪到下一个 $$）
        2. 再匹配行内公式 $...$（非贪婪到下一个 $）
        3. 忽略转义的 \$（美元符号，非公式）

降级策略：
    - 正则匹配失败 → 原样返回文本（不影响分块）
    - 恢复时占位符不存在 → 原样返回

使用方式：
    protector = LatexProtector()
    protected, placeholders = protector.protect(text)
    chunks = splitter.split_text(protected)
    restored_chunks = [protector.restore(c, placeholders) for c in chunks]
"""

import logging
import re
from typing import Dict, Tuple, List

logger = logging.getLogger(__name__)


class LatexProtector:
    """
    LaTeX 公式保护器

    作用：
        在文档分块前用占位符替换 LaTeX 公式，分块后恢复。

    设计原则：
        1. 先块级后行内——$$...$$ 比 $...$ 更长，先匹配避免误切
        2. 占位符唯一——用序号确保多个公式不会混淆
        3. 占位符安全——只含字母、数字、下划线、@，不会被分块器切分
        4. 可逆恢复——保护时记录原始公式，恢复时精确还原
    """

    # 块级公式正则：$$...$$（跨行匹配）
    # 作用：匹配 $$ 包裹的独立公式块，如 $$\int_0^1 f(x) dx$$
    _BLOCK_PATTERN = re.compile(r'\$\$(.+?)\$\$', re.DOTALL)

    # 行内公式正则：$...$（不跨行，非贪婪）
    # 作用：匹配 $ 包裹的行内公式，如 $E=mc^2$
    # 注意：不匹配 \$（转义的美元符号）和 $$（块级公式已先被替换）
    _INLINE_PATTERN = re.compile(r'(?<!\\)\$([^\$\n]+?)\$')

    # 占位符前缀
    # 作用：唯一标识被保护的公式，分块器不会在占位符中间切分
    _BLOCK_PREFIX = "@@LATEX_BLOCK_"
    _INLINE_PREFIX = "@@LATEX_INLINE_"
    _SUFFIX = "@@"

    def protect(self, text: str) -> Tuple[str, Dict[str, str]]:
        """
        保护文本中的 LaTeX 公式（替换为占位符）

        作用：
            将所有 LaTeX 公式替换为唯一占位符，使分块器不会在公式中间切分。
            返回保护后的文本和占位符→原始公式的映射表。

        实现方式：
            1. 先替换块级公式 $$...$$（避免被行内正则误匹配）
            2. 再替换行内公式 $...$
            3. 每个公式分配唯一序号，记录到 placeholders 字典

        参数：
            text: str - 原始文本（可能含 LaTeX 公式）

        返回:
            Tuple[str, Dict[str, str]]
            - str: 保护后的文本（公式已替换为占位符）
            - Dict[str, str]: 占位符 → 原始公式的映射（恢复时使用）
        """
        if not text:
            return text, {}

        placeholders: Dict[str, str] = {}
        block_counter = 0
        inline_counter = 0

        # 1. 替换块级公式 $$...$$
        # 作用：先处理块级公式，避免行内正则把 $$...$$ 中的内容误匹配
        def _replace_block(match: re.Match) -> str:
            nonlocal block_counter
            original = match.group(0)  # 完整的 $$...$$
            placeholder = f"{self._BLOCK_PREFIX}{block_counter}{self._SUFFIX}"
            placeholders[placeholder] = original
            block_counter += 1
            return placeholder

        protected = self._BLOCK_PATTERN.sub(_replace_block, text)

        # 2. 替换行内公式 $...$
        # 作用：处理剩余的行内公式，不匹配已替换的块级占位符
        def _replace_inline(match: re.Match) -> str:
            nonlocal inline_counter
            original = match.group(0)  # 完整的 $...$
            placeholder = f"{self._INLINE_PREFIX}{inline_counter}{self._SUFFIX}"
            placeholders[placeholder] = original
            inline_counter += 1
            return placeholder

        protected = self._INLINE_PATTERN.sub(_replace_inline, protected)

        if placeholders:
            logger.debug(
                f"LaTeX 公式保护：{block_counter} 个块级，"
                f"{inline_counter} 个行内"
            )

        return protected, placeholders

    def restore(self, text: str, placeholders: Dict[str, str]) -> str:
        """
        恢复文本中的 LaTeX 公式（占位符替换回原始公式）

        作用：
            将占位符替换回原始的 LaTeX 公式，恢复公式的完整格式。

        实现方式：
            遍历 placeholders 字典，将每个占位符替换为原始公式。
            如果文本中不包含某占位符（分块后该块无公式），跳过。

        参数：
            text: str - 含占位符的文本（分块后的某个块）
            placeholders: Dict[str, str] - protect() 返回的占位符映射

        返回:
            str - 恢复后的文本（占位符已替换为原始公式）
        """
        if not text or not placeholders:
            return text

        restored = text
        for placeholder, original in placeholders.items():
            if placeholder in restored:
                restored = restored.replace(placeholder, original)

        return restored

    def restore_chunks(
        self,
        chunks: List[str],
        placeholders: Dict[str, str],
    ) -> List[str]:
        """
        批量恢复多个分块中的 LaTeX 公式

        作用：
            对分块后的多个文本块批量执行恢复操作。
            每个块独立恢复，占位符不在某块中则跳过。

        参数：
            chunks: List[str] - 分块后的文本列表
            placeholders: Dict[str, str] - protect() 返回的占位符映射

        返回:
            List[str] - 恢复后的文本列表（与输入顺序一致）
        """
        if not chunks or not placeholders:
            return chunks

        return [self.restore(chunk, placeholders) for chunk in chunks]
