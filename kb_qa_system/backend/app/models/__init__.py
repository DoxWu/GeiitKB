"""
数据模型包

作用：
    统一导出所有数据模型，方便其他模块导入。
"""
from app.models.user import User
from app.models.document import Document
from app.models.document_chunk import DocumentChunk
from app.models.conversation import Conversation, Message
from app.models.qa_event import QAEvent
from app.models.registration import RegistrationApplication
from app.models.email_log import EmailLog

__all__ = [
    "User",
    "Document",
    "DocumentChunk",
    "Conversation",
    "Message",
    "QAEvent",
    "RegistrationApplication",
    "EmailLog",
]
