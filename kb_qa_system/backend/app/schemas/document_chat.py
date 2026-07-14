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
