"""
文档库分支管理路由模块

作用：
    定义文档库分支（Folder）的 CRUD API 接口，包括：
    - 列出当前用户的分支（含文档数量）
    - 创建分支
    - 重命名分支
    - 删除分支（文档 folder_id 置 NULL，不删文档）
    - 列出分支内文档

实现方式：
    1. 每个 endpoint 通过 Depends 注入认证和数据库
    2. 安全校验：每个端点验证 folder.user_id == current_user.id（防越权）
    3. 删除分支时仅置空文档的 folder_id，不删除文档本身
    4. 分支名唯一约束（同一用户下）

对齐前端：kb_qa_system/frontend/src/api/document.ts（API_PATHS.FOLDERS）
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, status, Query, Path, Request
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func
from typing import Any

from app.core.database import get_db
from app.api.deps import get_current_active_user
from app.models.user import User
from app.models.document import Document
from app.models.document_folder import DocumentFolder
from app.schemas.document_folder import (
    CreateFolderRequest,
    UpdateFolderRequest,
    DocumentFolderResponse,
    FolderListResponse,
)
from app.schemas.document import DocumentListResponse
from app.services.audit_service import audit_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/documents/folders", tags=["文档库分支管理"])


# ============================================
# 列出当前用户的分支
# ============================================

@router.get(
    "",
    response_model=FolderListResponse,
    summary="获取文档库分支列表",
)
def list_folders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    获取当前用户的文档库分支列表

    作用：
        返回当前用户创建的所有分支，每个分支含文档数量（运行时聚合）。
        仅返回当前用户的分支，不返回他人分支（权限隔离）。

    响应（200）：
        {
            "items": [
                {
                    "id": 1,
                    "name": "技术文档",
                    "document_count": 5,
                    "created_at": "2026-07-11T10:00:00",
                    "updated_at": "2026-07-11T10:00:00"
                }
            ],
            "total": 1
        }
    """
    # 查询当前用户的分支
    folders = (
        db.query(DocumentFolder)
        .filter(DocumentFolder.user_id == current_user.id)
        .order_by(DocumentFolder.created_at.asc())
        .all()
    )

    # 聚合每个分支的文档数量
    items = []
    for folder in folders:
        doc_count = (
            db.query(func.count(Document.id))
            .filter(
                Document.folder_id == folder.id,
                Document.is_deleted == False,
            )
            .scalar()
            or 0
        )
        items.append(
            DocumentFolderResponse(
                id=folder.id,
                name=folder.name,
                document_count=doc_count,
                created_at=folder.created_at,
                updated_at=folder.updated_at,
            )
        )

    return {"items": items, "total": len(items)}


# ============================================
# 创建分支
# ============================================

@router.post(
    "",
    response_model=DocumentFolderResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建文档库分支",
)
def create_folder(
    body: CreateFolderRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    创建文档库分支

    作用：
        当前用户创建一个新分支，分支名在同一用户下唯一。

    请求体：
        {"name": "技术文档"}

    错误：
        409: 分支名已存在
    """
    folder = DocumentFolder(
        name=body.name.strip(),
        user_id=current_user.id,
    )

    try:
        db.add(folder)
        db.commit()
        db.refresh(folder)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": {
                    "code": "FOLDER_NAME_EXISTS",
                    "message": f"分支名 '{body.name}' 已存在",
                }
            },
        )

    # 记录审计日志
    audit_service.log(
        db=db,
        user_id=current_user.id,
        action="folder.create",
        resource_type="folder",
        resource_id=folder.id,
        detail={"name": folder.name},
        request=request,
    )

    logger.info(f"分支已创建: folder_id={folder.id}, user_id={current_user.id}")

    return DocumentFolderResponse(
        id=folder.id,
        name=folder.name,
        document_count=0,
        created_at=folder.created_at,
        updated_at=folder.updated_at,
    )


# ============================================
# 重命名分支
# ============================================

@router.patch(
    "/{folder_id}",
    response_model=DocumentFolderResponse,
    summary="重命名文档库分支",
)
def update_folder(
    folder_id: int = Path(..., ge=1, description="分支ID（正整数）"),
    body: UpdateFolderRequest = ...,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    重命名文档库分支

    作用：
        修改分支名称，新名称在同一用户下唯一。

    路径参数：
        - folder_id: 分支ID

    请求体：
        {"name": "技术文档v2"}

    错误：
        404: 分支不存在或无权操作
        409: 新分支名已存在
    """
    # 查询分支并验证所有权
    folder = db.query(DocumentFolder).filter(
        DocumentFolder.id == folder_id,
    ).first()

    if not folder or folder.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "FOLDER_NOT_FOUND", "message": "分支不存在或无权操作"}},
        )

    old_name = folder.name
    folder.name = body.name.strip()

    try:
        db.commit()
        db.refresh(folder)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": {
                    "code": "FOLDER_NAME_EXISTS",
                    "message": f"分支名 '{body.name}' 已存在",
                }
            },
        )

    # 记录审计日志
    audit_service.log(
        db=db,
        user_id=current_user.id,
        action="folder.rename",
        resource_type="folder",
        resource_id=folder.id,
        detail={"old_name": old_name, "new_name": folder.name},
        request=request,
    )

    logger.info(f"分支已重命名: folder_id={folder.id}, old='{old_name}', new='{folder.name}'")

    # 聚合文档数量
    doc_count = (
        db.query(func.count(Document.id))
        .filter(
            Document.folder_id == folder.id,
            Document.is_deleted == False,
        )
        .scalar()
        or 0
    )

    return DocumentFolderResponse(
        id=folder.id,
        name=folder.name,
        document_count=doc_count,
        created_at=folder.created_at,
        updated_at=folder.updated_at,
    )


# ============================================
# 删除分支
# ============================================

@router.delete(
    "/{folder_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除文档库分支",
)
def delete_folder(
    folder_id: int = Path(..., ge=1, description="分支ID（正整数）"),
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    """
    删除文档库分支

    作用：
        删除指定分支，分支内文档的 folder_id 置 NULL（不删除文档）。

    路径参数：
        - folder_id: 分支ID

    错误：
        404: 分支不存在或无权操作
    """
    # 查询分支并验证所有权
    folder = db.query(DocumentFolder).filter(
        DocumentFolder.id == folder_id,
    ).first()

    if not folder or folder.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "FOLDER_NOT_FOUND", "message": "分支不存在或无权操作"}},
        )

    folder_name = folder.name

    # 将分支内文档的 folder_id 置 NULL（不删除文档）
    db.query(Document).filter(
        Document.folder_id == folder_id,
    ).update({"folder_id": None})

    # 删除分支
    db.delete(folder)
    db.commit()

    # 记录审计日志
    audit_service.log(
        db=db,
        user_id=current_user.id,
        action="folder.delete",
        resource_type="folder",
        resource_id=folder_id,
        detail={"name": folder_name},
        request=request,
    )

    logger.info(f"分支已删除: folder_id={folder_id}, user_id={current_user.id}")


# ============================================
# 列出分支内文档
# ============================================

@router.get(
    "/{folder_id}/documents",
    response_model=DocumentListResponse,
    summary="获取分支内文档列表",
)
def list_folder_documents(
    folder_id: int = Path(..., ge=1, description="分支ID（正整数）"),
    page: int = Query(default=1, ge=1, description="页码，从 1 开始"),
    page_size: int = Query(default=10, ge=1, le=100, description="每页数量，1-100"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    获取分支内文档列表

    作用：
        返回指定分支内的文档列表（分页），自动过滤已软删除的文档。

    路径参数：
        - folder_id: 分支ID

    查询参数：
        - page: 页码，默认 1
        - page_size: 每页数量，默认 10

    错误：
        404: 分支不存在或无权操作
    """
    # 查询分支并验证所有权
    folder = db.query(DocumentFolder).filter(
        DocumentFolder.id == folder_id,
    ).first()

    if not folder or folder.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "FOLDER_NOT_FOUND", "message": "分支不存在或无权操作"}},
        )

    # 查询分支内文档（过滤软删除）
    query = db.query(Document).filter(
        Document.folder_id == folder_id,
        Document.is_deleted == False,
    )

    total = query.count()
    offset = (page - 1) * page_size
    documents = query.order_by(Document.created_at.desc()).offset(offset).limit(page_size).all()

    return {
        "items": documents,
        "total": total,
        "page": page,
        "page_size": page_size,
        "next_cursor": None,
    }
