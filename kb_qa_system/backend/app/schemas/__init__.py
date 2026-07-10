"""
数据验证 Schema 包

作用：
    统一导出所有 Pydantic 数据模型，用于 API 请求/响应的数据验证。
"""
from app.schemas.user import (
    UserCreate, UserLogin, UserResponse, TokenResponse, TokenData
)
from app.schemas.document import (
    DocumentUpload, DocumentResponse, DocumentListResponse
)
from app.schemas.chat import (
    QuestionRequest, AnswerResponse, ConversationResponse,
    ConversationListResponse, MessageResponse
)
from app.schemas.registration import (
    RegisterApplyRequest, RegisterApplyResponse, ApplicationStatusResponse,
    ApplicationListItem, ApplicationListResponse, ApproveRequest, RejectRequest,
    SetPasswordRequest, SetPasswordResponse,
)

__all__ = [
    "UserCreate", "UserLogin", "UserResponse", "TokenResponse", "TokenData",
    "DocumentUpload", "DocumentResponse", "DocumentListResponse",
    "QuestionRequest", "AnswerResponse", "ConversationResponse",
    "ConversationListResponse", "MessageResponse",
    "RegisterApplyRequest", "RegisterApplyResponse", "ApplicationStatusResponse",
    "ApplicationListItem", "ApplicationListResponse", "ApproveRequest", "RejectRequest",
    "SetPasswordRequest", "SetPasswordResponse",
]
