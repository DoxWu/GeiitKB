"""
文档对话路由模块

作用：
    定义文档对话功能的 API 接口，包括：
    - 文件上传（解析文本并存入 Redis 供后续提问）
    - 流式提问（基于上传文档内容进行 SSE 流式回答）

实现方式：
    1. 上传：接收文件 → 保存临时文件 → 解析提取文本 → 清洗 → 截断 → 存入 Redis
    2. 提问：从 Redis 读取文档 → 构造系统提示词 → 调用 LLM 流式接口 → SSE 返回
    3. 对话历史存储在 Redis 中，支持多轮追问
"""

import json
import os
import uuid
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import StreamingResponse

from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

from app.core.config import settings
from app.core.rate_limit import rate_limit
from app.core.redis import RedisManager
from app.api.deps import get_current_regular_user
from app.models.user import User
from app.schemas.document_chat import (
    DocumentChatUploadResponse,
    DocumentChatRequest,
)
from app.services.document_pipeline.parsers import (
    MarkdownParser,
    TxtParser,
    DocxParser,
)
from app.services.document_pipeline.pdf_parser import PdfParser
from app.services.document_pipeline.cleaner import TextCleaner
from app.services.document_pipeline.context import PipelineContext
from app.services.llm_resilience import get_llm_service, LLMServiceError


# 模块日志器
# 作用：记录文档解析失败、Redis 操作异常等关键事件，便于排查问题
logger = logging.getLogger(__name__)

# 创建路由器
router = APIRouter(prefix="/document-chat", tags=["文档对话"])


# ============================================
# 常量定义
# ============================================

# 文档对话文件大小上限：10MB
# 作用：文档对话只解析文本放入 LLM 上下文，无需持久化存储，限制 10MB 避免内存压力
MAX_DOC_CHAT_FILE_SIZE = 10 * 1024 * 1024

# 解析后文本最大字符数：约 12000 token，留出问答空间
# 作用：LLM 上下文窗口有限，截断过长文档确保有空间容纳问题和回答
MAX_DOC_CHAT_TEXT_LENGTH = 50000

# Redis 会话 TTL：1 小时
# 作用：文档对话是临时会话，1 小时后自动清理，避免 Redis 内存膨胀
DOC_CHAT_SESSION_TTL = 3600

# 对话历史最大轮数
# 作用：限制历史消息数量，避免上下文过长超出 token 限制
MAX_HISTORY_TURNS = 20

# 支持的文件类型白名单
SUPPORTED_FILE_TYPES = {".pdf", ".docx", ".md", ".txt"}

# 分块读取大小（1MB），用于分块写入临时文件
_CHUNK_SIZE = 1024 * 1024


# ============================================
# 文档上传
# ============================================

@router.post(
    "/upload",
    response_model=DocumentChatUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="上传文档（文档对话）",
    # 限流：每分钟最多 RATE_LIMIT_ASK_PER_MINUTE 次，复用问答限流配额
    dependencies=[Depends(rate_limit("ask", per_minute=settings.RATE_LIMIT_ASK_PER_MINUTE))],
)
async def upload_document_for_chat(
    file: UploadFile = File(..., description="要上传的文档（支持 .pdf/.docx/.md/.txt，最大 10MB）"),
    current_user: User = Depends(get_current_regular_user),
) -> Any:
    """
    上传文档接口（文档对话）

    作用：
        接收用户上传的文件，解析提取纯文本，清洗后存入 Redis。
        返回 session_id 供后续流式提问使用。

    实现方式：
        1. 校验文件类型（白名单）和大小（10MB）
        2. 保存到临时文件（settings.UPLOAD_DIR）
        3. 根据文件类型选择解析器提取文本
        4. 用 TextCleaner 清洗文本
        5. 截断到最大 50000 字符
        6. 生成 session_id，存入 Redis（TTL 1 小时）
        7. 删除临时文件
        8. 返回上传响应

    请求：
        - multipart/form-data 格式
        - file: 文件

    响应（201）：
        {
            "session_id": "uuid-xxx",
            "file_name": "paper.pdf",
            "file_type": ".pdf",
            "file_size": 102400,
            "char_count": 35000,
            "truncated": false
        }

    错误：
        400: 文件类型不支持 / 文件过大 / 解析失败
    """
    # 1. 校验文件名和类型（白名单）
    # 作用：防止上传危险文件类型，仅允许文本类文档
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": {"code": "INVALID_FILE", "message": "文件名不能为空"}},
        )

    file_ext = os.path.splitext(file.filename)[1].lower()
    if file_ext not in SUPPORTED_FILE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": {
                    "code": "INVALID_FILE_TYPE",
                    "message": f"不支持的文件类型: {file_ext}，支持: {', '.join(sorted(SUPPORTED_FILE_TYPES))}",
                }
            },
        )

    # 2. 确保上传目录存在
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

    # 3. 分块写入临时文件 + 边写边检查大小（防内存 DoS）
    # 作用：避免一次性读取大文件导致 OOM，分块写入并检查累计大小
    safe_filename = os.path.basename(file.filename)
    unique_filename = f"{uuid.uuid4().hex}_{safe_filename}"
    tmp_path = os.path.join(settings.UPLOAD_DIR, unique_filename)

    file_size = 0
    try:
        with open(tmp_path, "wb") as f:
            while True:
                chunk = await file.read(_CHUNK_SIZE)
                if not chunk:
                    break
                file_size += len(chunk)
                # 超过大小限制，立即中止并清理
                if file_size > MAX_DOC_CHAT_FILE_SIZE:
                    f.close()
                    _safe_remove(tmp_path)
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail={
                            "error": {
                                "code": "FILE_TOO_LARGE",
                                "message": f"文件过大，最大支持 {MAX_DOC_CHAT_FILE_SIZE // (1024 * 1024)}MB",
                            }
                        },
                    )
                f.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        _safe_remove(tmp_path)
        logger.error(f"文档对话文件保存失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": {"code": "FILE_WRITE_ERROR", "message": "文件保存失败"}},
        )

    # 4. 解析文档提取文本
    # 作用：根据文件类型选择解析器，提取纯文本放入流水线上下文
    try:
        document_text = _parse_document(tmp_path, file_ext)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"文档解析失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": {
                    "code": "PARSE_ERROR",
                    "message": f"文档解析失败: {type(e).__name__}",
                }
            },
        )
    finally:
        # 无论解析成功与否，都删除临时文件
        _safe_remove(tmp_path)

    # 5. 清洗文本
    # 作用：去除不可见字符、重复空白、乱码片段等，提升 LLM 理解质量
    try:
        document_text = _clean_text(document_text)
    except Exception as e:
        # 清洗失败不阻断流程，使用原始文本
        logger.warning(f"文本清洗失败，使用原始文本: {e}")

    # 6. 截断过长文档
    # 作用：LLM 上下文窗口有限，截断确保有空间容纳问答
    truncated = False
    if len(document_text) > MAX_DOC_CHAT_TEXT_LENGTH:
        document_text = document_text[:MAX_DOC_CHAT_TEXT_LENGTH]
        truncated = True

    # 7. 生成 session_id 并存入 Redis
    session_id = uuid.uuid4().hex
    redis_key = f"doc_chat:{session_id}"
    session_data = {
        "file_name": safe_filename,
        "file_type": file_ext,
        "file_size": file_size,
        "text": document_text,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "user_id": current_user.id,
    }

    if not RedisManager.set(redis_key, session_data, ttl=DOC_CHAT_SESSION_TTL):
        logger.error(f"文档对话会话存入 Redis 失败: session_id={session_id}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": {"code": "REDIS_ERROR", "message": "会话存储失败，请稍后重试"}},
        )

    logger.info(
        f"文档对话上传成功: user_id={current_user.id}, session_id={session_id}, "
        f"file={safe_filename}, chars={len(document_text)}, truncated={truncated}"
    )

    # 8. 返回响应
    return DocumentChatUploadResponse(
        session_id=session_id,
        file_name=safe_filename,
        file_type=file_ext,
        file_size=file_size,
        char_count=len(document_text),
        truncated=truncated,
    )


# ============================================
# 流式提问（SSE）
# ============================================

@router.post(
    "/ask/stream",
    summary="文档对话提问（流式输出）",
    # 限流：每分钟最多 RATE_LIMIT_ASK_PER_MINUTE 次
    dependencies=[Depends(rate_limit("ask", per_minute=settings.RATE_LIMIT_ASK_PER_MINUTE))],
)
async def ask_document_stream(
    request_data: DocumentChatRequest,
    current_user: User = Depends(get_current_regular_user),
) -> StreamingResponse:
    """
    文档对话提问接口（流式输出）

    作用：
        基于上传的文档内容，流式返回 AI 的回答。
        使用 SSE（Server-Sent Events）协议，实现打字机效果。
        支持多轮对话，历史记录存储在 Redis 中。

    实现方式：
        1. 从 Redis 获取文档内容（不存在返回 404）
        2. 构造系统提示词（包含文档全文）
        3. 获取对话历史（从 Redis）
        4. 构造 LangChain 消息列表
        5. 调用 LLM 流式接口
        6. 通过 SSE 返回数据块
        7. 流结束后保存对话历史

    请求体：
        {
            "session_id": "uuid-xxx",
            "question": "请总结这篇文档"
        }

    响应：
        SSE 格式，每行一个事件：
        data: {"type": "chunk", "content": "这是"}

        data: {"type": "chunk", "content": "总结"}
        ...
        data: {"type": "done", "content": "完整回答..."}

    错误：
        404: 会话不存在或已过期
        503: LLM 服务不可用
    """
    # 1. 从 Redis 获取文档内容
    session_key = f"doc_chat:{request_data.session_id}"
    session_data = RedisManager.get(session_key)

    if not session_data or not isinstance(session_data, dict):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "error": {
                    "code": "SESSION_NOT_FOUND",
                    "message": "文档会话不存在或已过期，请重新上传文档",
                }
            },
        )

    document_text = session_data.get("text", "")
    if not document_text:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "error": {
                    "code": "SESSION_NOT_FOUND",
                    "message": "文档内容为空，请重新上传文档",
                }
            },
        )

    # 2. 构造系统提示词
    # 作用：将文档全文注入系统提示词，作为 LLM 的上下文
    system_prompt = (
        "你是一个文档分析助手。用户上传了以下文档，请根据文档内容回答问题。\n"
        "如果问题超出文档范围，请说明并尝试提供有用的信息。\n"
        "支持的任务包括但不限于：阅读理解、翻译、总结、解释等。\n\n"
        f"===文档内容===\n{document_text}\n===文档内容结束==="
    )

    # 3. 获取对话历史
    # 作用：从 Redis 读取历史问答，支持多轮追问
    history_key = f"doc_chat:{request_data.session_id}:history"
    history_raw = RedisManager.get(history_key)
    history = history_raw if isinstance(history_raw, list) else []

    # 4. 构造 LangChain 消息列表
    # 结构：[SystemMessage, ...history, HumanMessage(question)]
    messages: list = [SystemMessage(content=system_prompt)]

    # 将历史记录转为 LangChain 消息
    # 作用：历史中偶数位为 user，奇数位为 assistant，保持顺序
    for msg in history[-MAX_HISTORY_TURNS * 2:]:
        role = msg.get("role")
        content = msg.get("content", "")
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))

    # 当前问题
    messages.append(HumanMessage(content=request_data.question))

    # 5. 流式调用 LLM 并通过 SSE 返回
    # 捕获纯值，避免在生成器中依赖请求作用域对象
    question_text = request_data.question
    session_id_val = request_data.session_id

    async def event_stream():
        """
        SSE 事件生成器

        作用：
            调用 LLM 流式接口，将文本块转为 SSE 格式发送给前端。
            流结束后将本轮问答保存到 Redis 历史记录中。

        实现方式：
            - 调用 llm_service.astream(messages) 获取流式响应
            - 每个 chunk 包装为 SSE 事件
            - 累积完整回答
            - 流结束后保存历史记录
            - 异常时发送脱敏错误事件
        """
        full_answer = ""

        try:
            llm_service = get_llm_service()

            # 流式调用 LLM
            async for chunk in llm_service.astream(messages):
                if not chunk:
                    continue
                full_answer += chunk
                # 转为 SSE 格式
                sse_data = {
                    "type": "chunk",
                    "content": chunk,
                }
                yield f"data: {json.dumps(sse_data, ensure_ascii=False)}\n\n"

            # 发送完成事件
            done_data = {
                "type": "done",
                "content": full_answer,
            }
            yield f"data: {json.dumps(done_data, ensure_ascii=False)}\n\n"

            # 保存对话历史到 Redis
            # 作用：追加本轮问答，支持多轮追问
            _save_history(
                history_key,
                history,
                question_text,
                full_answer,
            )

        except LLMServiceError:
            # LLM 服务不可用，发送脱敏错误事件
            logger.error(
                f"文档对话 LLM 调用失败: session_id={session_id_val}",
                exc_info=True,
            )
            error_data = {
                "type": "error",
                "content": "抱歉，AI 服务暂时不可用，请稍后重试",
            }
            yield f"data: {json.dumps(error_data, ensure_ascii=False)}\n\n"

        except Exception:
            # 其他异常，发送脱敏错误事件
            logger.exception(
                f"文档对话流式处理异常: session_id={session_id_val}"
            )
            error_data = {
                "type": "error",
                "content": "抱歉，回答生成过程中出现错误，请稍后重试",
            }
            yield f"data: {json.dumps(error_data, ensure_ascii=False)}\n\n"

    # 6. 返回流式响应
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",  # 禁用缓存
            "Connection": "keep-alive",   # 保持连接
            "X-Accel-Buffering": "no",    # Nginx 禁用缓冲
        },
    )


# ============================================
# 辅助函数
# ============================================

def _parse_document(file_path: str, file_type: str) -> str:
    """
    解析文档提取纯文本

    作用：
        根据文件类型选择对应的解析器，提取文档纯文本。
        各解析器统一返回文本，由调用方后续清洗。

    实现方式：
        - .pdf → PdfParser（通过 parse_to_context 填充上下文）
        - .docx → DocxParser
        - .md → MarkdownParser
        - .txt → TxtParser

    参数：
        file_path: str - 文件路径
        file_type: str - 文件扩展名（如 .pdf）

    返回：
        str - 提取的纯文本

    异常：
        文件解析失败时抛出异常，由调用方捕获处理
    """
    # 创建流水线上下文，复用现有解析器
    # 作用：PdfParser 只提供 parse_to_context 接口，需通过上下文调用
    ctx = PipelineContext(
        file_path=file_path,
        file_type=file_type,
        file_name=os.path.basename(file_path),
    )

    if file_type == ".pdf":
        PdfParser().parse_to_context(ctx)
    elif file_type == ".docx":
        ctx.raw_text = DocxParser().parse(file_path)
    elif file_type == ".md":
        ctx.raw_text = MarkdownParser().parse(file_path)
    elif file_type == ".txt":
        ctx.raw_text = TxtParser().parse(file_path)
    else:
        raise ValueError(f"不支持的文件类型: {file_type}")

    return ctx.raw_text


def _clean_text(text: str) -> str:
    """
    清洗文本

    作用：
        使用 TextCleaner 对解析后的文本执行清洗，
        去除不可见字符、重复空白、乱码片段等。

    实现方式：
        1. 创建 PipelineContext 并设置 raw_text
        2. 调用 TextCleaner.clean(ctx)
        3. 返回 ctx.cleaned_text（清洗失败时返回原文）

    参数：
        text: str - 原始文本

    返回：
        str - 清洗后的文本
    """
    ctx = PipelineContext(
        file_path="",
        file_type="",
        file_name="",
    )
    ctx.raw_text = text

    cleaner = TextCleaner()
    cleaner.clean(ctx)

    # 清洗失败时 cleaned_text 会回退为 raw_text
    return ctx.cleaned_text or ctx.raw_text


def _save_history(
    history_key: str,
    history: list,
    question: str,
    answer: str,
) -> None:
    """
    保存对话历史到 Redis

    作用：
        将本轮问答追加到历史记录，支持多轮追问。
        历史记录与文档会话共享 TTL。

    实现方式：
        1. 将问题和回答追加到历史列表
        2. 限制最大轮数，超出时截断旧消息
        3. 写入 Redis（TTL 与文档会话一致）

    参数：
        history_key: str - Redis key
        history: list - 已有的历史记录
        question: str - 本轮问题
        answer: str - 本轮回答
    """
    try:
        updated_history = list(history)
        updated_history.append({"role": "user", "content": question})
        updated_history.append({"role": "assistant", "content": answer})

        # 限制历史长度，超出时丢弃最早的对话
        # 作用：避免历史过长导致 token 超限
        max_messages = MAX_HISTORY_TURNS * 2
        if len(updated_history) > max_messages:
            updated_history = updated_history[-max_messages:]

        RedisManager.set(history_key, updated_history, ttl=DOC_CHAT_SESSION_TTL)
    except Exception as e:
        # 历史保存失败不影响主流程（本轮回答已返回给用户）
        logger.warning(f"对话历史保存失败: {e}")


def _safe_remove(file_path: str) -> None:
    """
    安全删除文件

    作用：
        删除临时文件，文件不存在或删除失败时静默处理。
        避免清理异常影响主流程。

    参数：
        file_path: str - 文件路径
    """
    try:
        if file_path and os.path.exists(file_path):
            os.remove(file_path)
    except Exception as e:
        logger.warning(f"删除临时文件失败: {file_path}, {e}")
