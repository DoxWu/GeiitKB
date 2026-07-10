"""
文档相关 Schema（生产版）

作用：
    定义文档相关的请求和响应数据模型，包括：
    - 文档上传请求
    - 文档信息响应（含处理进度、质量分等）
    - 文档列表响应（分页）
    - 任务状态响应
    - 文档处理结果摘要
"""

from datetime import datetime
from typing import Optional, List, Any, Dict
from pydantic import BaseModel, Field, ConfigDict


# ============================================
# 文档上传请求
# ============================================

class DocumentUpload(BaseModel):
    """
    文档上传请求 Schema（M-8：已废弃，上传接口使用 Form 参数直接校验）

    作用：
        历史遗留 Schema，当前上传接口（upload_document）直接使用 Form 参数，
        不再使用此 Schema。保留用于内部类型提示和未来可能的 JSON 上传接口。

    废弃原因：
        multipart/form-data 上传无法直接绑定 BaseModel，FastAPI 要求文件字段
        使用 UploadFile=File(...)，元数据字段使用 Form(...)。
        此 Schema 的 tags: List[str] 与 Form 的逗号分隔字符串不兼容。

    使用场景：
        POST /api/v1/documents/upload（实际使用 Form 参数，非此 Schema）

    示例：
        {
            "title": "Python异步编程指南",
            "category": "technical",
            "tags": ["Python", "asyncio"]
        }
    """
    # M-5 修复：title 长度校验，防止超过 DB String(200) 导致 500 错误
    title: Optional[str] = Field(None, max_length=200, description="文档标题（不填则用文件名，最多 200 字符）")
    category: str = Field(default="other", max_length=50, description="文档分类")
    tags: List[str] = Field(default=[], description="标签列表")


# ============================================
# 文档信息响应
# ============================================

class DocumentResponse(BaseModel):
    """
    文档信息响应 Schema（生产版）

    作用：
        定义返回给前端的文档数据格式。
        包含处理状态、进度、质量分等生产级字段。

    示例响应：
        {
            "id": 1,
            "title": "Python异步编程指南",
            "file_name": "async.pdf",
            "file_type": ".pdf",
            "file_size": 2621440,
            "status": "completed",
            "processing_step": "completed",
            "processing_progress": 100,
            "quality_score": 85.5,
            "quality_issues": [],
            "chunk_count": 50,
            "total_tokens": 12000,
            "task_id": "abc-123",
            "created_at": "2026-07-05T10:00:00",
            "updated_at": "2026-07-05T10:02:00"
        }
    """
    id: int
    title: str
    file_name: str
    file_type: str
    file_size: int
    status: str = Field(description="处理状态：pending/processing/completed/failed/low_quality")
    visibility: str = Field(
        "private",
        description="可见性：private 个人文档库 / public 公共文档库"
    )
    processing_step: Optional[str] = Field(None, description="当前处理步骤")
    processing_progress: int = Field(0, description="处理进度（0-100）")
    quality_score: Optional[float] = Field(None, description="质量分（0-100）")
    quality_issues: Optional[List[str]] = Field(None, description="质量问题列表")
    chunk_count: int = 0
    total_tokens: int = 0
    task_id: Optional[str] = Field(None, description="Celery 任务ID")
    error_message: Optional[str] = None
    metadata_: Optional[dict] = None
    file_hash: Optional[str] = Field(None, description="文件哈希（去重用）")
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================
# 文档列表响应
# ============================================

class DocumentListResponse(BaseModel):
    """
    文档列表响应 Schema（分页）

    作用：
        定义文档列表接口的响应格式，包含分页信息。

    示例响应：
        {
            "items": [...],
            "total": 100,
            "page": 1,
            "page_size": 10
        }
    """
    items: List[DocumentResponse]
    total: int
    page: int
    page_size: int


# ============================================
# 任务状态响应
# ============================================

class TaskStatusResponse(BaseModel):
    """
    任务状态响应 Schema

    作用：
        返回 Celery 任务的状态信息，供前端轮询文档处理进度。

    示例响应：
        {
            "task_id": "abc-123",
            "status": "SUCCESS",
            "progress": 100,
            "result": {
                "document_id": 1,
                "status": "completed",
                "chunk_count": 50
            },
            "error": null
        }

    状态说明：
        - PENDING: 任务排队中
        - STARTED: 任务已开始
        - SUCCESS: 任务成功
        - FAILURE: 任务失败
        - RETRY: 任务重试中
    """
    task_id: str
    status: str = Field(description="任务状态：PENDING/STARTED/SUCCESS/FAILURE/RETRY")
    progress: int = Field(0, description="进度百分比（0-100）")
    result: Optional[Any] = Field(None, description="任务结果（成功时）")
    error: Optional[str] = Field(None, description="错误信息（失败时）")


# ============================================
# 文档处理结果摘要
# ============================================

class DocumentProcessSummary(BaseModel):
    """
    文档处理结果摘要 Schema

    作用：
        文档处理完成后的结果摘要，由 Celery 任务返回。
        也可作为重新处理接口的响应。
    """
    document_id: int
    status: str
    chunk_count: int = 0
    quality_score: float = 0.0
    quality_issues: List[str] = []
    duration_ms: int = 0
    page_count: int = 0
    table_count: int = 0
    image_count: int = 0
