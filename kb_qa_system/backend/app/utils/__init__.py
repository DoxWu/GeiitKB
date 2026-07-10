"""
工具函数包

作用：
    存放跨模块复用的通用工具函数。
    每个子模块负责一类工具（如 response 负责响应格式化）。

可用工具：
    - response.error_response: 构造标准化错误响应体
    - response.success_response: 构造标准化成功响应体
"""

from app.utils.response import error_response, success_response

__all__ = ["error_response", "success_response"]
