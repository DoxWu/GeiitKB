"""
文档对话相关 Schema

作用：
    定义文档对话功能的请求和响应数据模型。
    用户上传文件后，系统解析文本放入 LLM 上下文，支持针对文档内容提问。
"""

from pydantic import BaseModel, Field
from typing import Optional


class DocumentChatUploadResponse(BaseModel):
    """文档上传响应"""
    session_id: str = Field(..., description="文档对话会话ID，用于后续提问")
    file_name: str = Field(..., description="文件名")
    file_type: str = Field(..., description="文件类型")
    file_size: int = Field(..., description="文件大小（字节）")
    char_count: int = Field(..., description="解析后的文本字符数")
    truncated: bool = Field(False, description="文档是否因过长被截断")


class DocumentChatRequest(BaseModel):
    """文档对话提问请求"""
    session_id: str = Field(..., description="文档对话会话ID")
    question: str = Field(..., min_length=1, max_length=2000, description="问题内容")
    conversation_id: Optional[int] = Field(None, description="对话ID（首次提问可不传，后端自动创建）")


class DocumentFromLibraryRequest(BaseModel):
    """
    从文档库选择文档进行对话的请求

    作用：
        用户选择个人文档库或公共文档库中已处理的文档，
        复用其已清洗的全文内容进行文档对话，无需重新上传和解析。

    字段说明：
        document_id: 文档ID（必须是 status=completed 且当前用户有权访问的文档）
    """
    document_id: int = Field(..., gt=0, description="文档库中的文档ID")
