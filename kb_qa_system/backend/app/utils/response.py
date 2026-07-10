"""
统一响应工具模块（M-19 修复：充实 app/utils 包）

作用：
    提供标准化的 API 响应构造工具，确保全项目错误响应格式一致。
    所有错误响应遵循统一结构：
        {
            "error": {
                "code": "ERROR_CODE",
                "message": "用户可读的错误描述",
                ...可选额外字段
            }
        }

使用示例：
    from app.utils.response import error_response

    raise HTTPException(
        status_code=400,
        detail=error_response("INVALID_INPUT", "参数不合法", field="username")
    )
"""

from typing import Optional, Any, Dict


def error_response(
    code: str,
    message: str,
    **extra: Any,
) -> Dict[str, Any]:
    """
    构造标准化错误响应体

    作用：
        统一错误响应格式，确保前端可以靠 error.code 做精确错误处理，
        error.message 做用户友好提示。

    参数：
        code: str - 错误码（大写蛇形，如 INVALID_INPUT、DOCUMENT_NOT_FOUND）
        message: str - 用户可读的错误描述（中文，不暴露内部实现细节）
        **extra: Any - 额外字段（如 document_id、task_id 等上下文信息）

    返回:
        Dict[str, Any] - 标准错误响应体，可直接作为 HTTPException 的 detail

    使用示例：
        error_response("FILE_TOO_LARGE", "文件过大", max_size_mb=50)
        # 返回: {"error": {"code": "FILE_TOO_LARGE", "message": "文件过大", "max_size_mb": 50}}
    """
    error_data: Dict[str, Any] = {"code": code, "message": message}
    error_data.update(extra)
    return {"error": error_data}


def success_response(
    data: Any = None,
    message: Optional[str] = None,
    **extra: Any,
) -> Dict[str, Any]:
    """
    构造标准化成功响应体

    作用：
        统一成功响应格式（可选，部分接口直接返回数据对象）。
        适用于需要携带额外元信息（如分页、提示）的场景。

    参数：
        data: Any - 业务数据
        message: Optional[str] - 可选的成功提示
        **extra: Any - 额外字段（如 pagination 信息）

    返回:
        Dict[str, Any] - 标准成功响应体

    使用示例：
        success_response(items, "查询成功", total=100, page=1)
    """
    result: Dict[str, Any] = {"data": data}
    if message:
        result["message"] = message
    result.update(extra)
    return result
