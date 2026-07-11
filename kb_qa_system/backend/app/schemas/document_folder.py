"""
文档库分支相关 Schema

作用：
    定义文档库分支的请求和响应数据模型，用于分支 CRUD 接口的数据校验和序列化。

对齐路由：kb_qa_system/backend/app/api/routes/documents.py（/documents/folders 端点）
"""

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict


# ============================================
# 分支创建请求
# ============================================

class CreateFolderRequest(BaseModel):
    """
    创建分支请求 Schema

    作用：
        校验创建分支的请求数据，分支名不能为空且长度 ≤100 字符。

    示例：
        {"name": "技术文档"}
    """
    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="分支名称（1-100 字符）",
    )


# ============================================
# 分支更新请求
# ============================================

class UpdateFolderRequest(BaseModel):
    """
    更新分支请求 Schema（重命名）

    作用：
        校验更新分支的请求数据，仅支持重命名。

    示例：
        {"name": "技术文档v2"}
    """
    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="新分支名称（1-100 字符）",
    )


# ============================================
# 分支信息响应
# ============================================

class DocumentFolderResponse(BaseModel):
    """
    分支信息响应 Schema

    作用：
        定义返回给前端的分支数据格式，包含文档数量（运行时聚合）。

    示例响应：
        {
            "id": 1,
            "name": "技术文档",
            "document_count": 5,
            "created_at": "2026-07-11T10:00:00",
            "updated_at": "2026-07-11T10:00:00"
        }
    """
    id: int
    name: str
    document_count: int = Field(0, description="分支内文档数量（运行时聚合）")
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================
# 分支列表响应
# ============================================

class FolderListResponse(BaseModel):
    """
    分支列表响应 Schema

    作用：
        定义分支列表接口的响应格式。

    示例响应：
        {
            "items": [...],
            "total": 3
        }
    """
    items: List[DocumentFolderResponse]
    total: int
