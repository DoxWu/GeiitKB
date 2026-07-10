"""
质量看板统计路由模块

作用：
    提供 QA 质量看板相关的 API 接口，基于 qa_events 表聚合统计：
    - 总体概览（成功率、降级率、平均耗时、Token 消耗、用户反馈）
    - 时间趋势（按天分组的问答量和质量指标）
    - 模型使用分布（各模型的使用次数、耗时、Token）
    - 降级分析（各降级原因的次数和占比）

    所有接口仅限超级管理员访问，防止普通用户查看系统级质量数据。

实现方式：
    1. 使用 QAEventService 的聚合查询方法
    2. 支持时间范围过滤（start_time / end_time 查询参数）
    3. 时间趋势支持自定义天数（days 参数）
"""

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_superuser
from app.services.qa_event_service import qa_event_service

# 创建路由器
# 作用：所有统计接口都以 /stats 为前缀，需超级管理员权限
router = APIRouter(
    prefix="/stats",
    tags=["质量看板"],
    dependencies=[Depends(get_current_superuser)],  # 整个路由器都需管理员权限
)


def _parse_time(
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
) -> tuple[Optional[datetime], Optional[datetime]]:
    """
    解析时间范围查询参数

    作用：
        将 ISO 格式的时间字符串转为 datetime 对象。
        用于 overview/models/degradation 接口的时间范围过滤。

    实现方式：
        - M-9 修复：解析失败时抛出 ValueError（由调用方捕获返回 400），
          而非静默忽略。原实现静默返回 None 导致无效时间参数被当作"不过滤"，
          用户传入拼写错误的时间却得到全量数据，不符合预期。

    参数：
        start_time: Optional[str] - 开始时间（ISO 格式，如 "2026-07-01T00:00:00"）
        end_time: Optional[str] - 结束时间（ISO 格式）

    返回:
        tuple[Optional[datetime], Optional[datetime]] - (开始时间, 结束时间)

    异常:
        ValueError - 时间字符串格式无法解析时抛出
    """
    parsed_start = None
    parsed_end = None

    if start_time:
        # M-9 修复：解析失败抛异常，调用方应捕获并返回 400
        parsed_start = datetime.fromisoformat(start_time)

    if end_time:
        parsed_end = datetime.fromisoformat(end_time)

    return parsed_start, parsed_end


# ============================================
# 总体概览
# ============================================

@router.get(
    "/overview",
    summary="质量总体概览",
)
def get_overview(
    start_time: Optional[str] = Query(None, description="开始时间（ISO 格式）"),
    end_time: Optional[str] = Query(None, description="结束时间（ISO 格式）"),
    db: Session = Depends(get_db),
) -> Any:
    """
    获取质量总体概览

    作用：
        返回指定时间范围内的问答质量总览数据，用于看板首屏展示。
        包含成功率、降级率、失败率、平均耗时、Token 消耗、用户反馈等核心指标。

    实现方式：
        1. 解析时间范围参数
        2. 调用 qa_event_service.get_overview 聚合查询
        3. 返回概览数据

    查询参数：
        - start_time: 开始时间（ISO 格式，可选）
        - end_time: 结束时间（ISO 格式，可选）

    响应（200）：
        {
            "total": 1000,
            "success_count": 900,
            "degraded_count": 80,
            "failed_count": 20,
            "success_rate": 0.9,
            "degraded_rate": 0.08,
            "failed_rate": 0.02,
            "avg_total_time_ms": 2500,
            "avg_retrieval_time_ms": 150,
            "avg_llm_time_ms": 2000,
            "avg_retry_count": 0.2,
            "total_token_input": 1500000,
            "total_token_output": 300000,
            "positive_count": 200,
            "negative_count": 50,
            "feedback_rate": 0.25,
            "accuracy_rate": 0.8
        }
    """
    # M-9 修复：时间参数解析失败返回 400，而非静默忽略
    try:
        parsed_start, parsed_end = _parse_time(start_time, end_time)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": {"code": "INVALID_TIME_FORMAT", "message": "时间参数格式无效，请使用 ISO 格式（如 2026-07-01T00:00:00）"}},
        )
    return qa_event_service.get_overview(db, start_time=parsed_start, end_time=parsed_end)


# ============================================
# 时间趋势
# ============================================

@router.get(
    "/timeline",
    summary="质量时间趋势（按天）",
)
def get_timeline(
    days: int = Query(7, ge=1, le=90, description="统计天数（1-90，默认 7）"),
    db: Session = Depends(get_db),
) -> Any:
    """
    获取质量时间趋势（按天分组）

    作用：
        返回最近 N 天每天的问答量、成功/降级/失败数、平均耗时，
        用于看板的时间趋势图。无数据的日期补零，保证趋势图连续。

    实现方式：
        1. 校验天数范围（1-90）
        2. 调用 qa_event_service.get_timeline 按天聚合
        3. 返回按日期升序排列的趋势数据

    查询参数：
        - days: 统计天数（1-90，默认 7）

    响应（200）：
        [
            {
                "date": "2026-07-01",
                "total": 100,
                "success": 90,
                "degraded": 8,
                "failed": 2,
                "avg_total_time_ms": 2500,
                "avg_retrieval_time_ms": 150,
                "avg_llm_time_ms": 2000
            },
            ...
        ]
    """
    return qa_event_service.get_timeline(db, days=days)


# ============================================
# 模型使用分布
# ============================================

@router.get(
    "/models",
    summary="模型使用分布",
)
def get_model_stats(
    start_time: Optional[str] = Query(None, description="开始时间（ISO 格式）"),
    end_time: Optional[str] = Query(None, description="结束时间（ISO 格式）"),
    db: Session = Depends(get_db),
) -> Any:
    """
    获取模型使用分布统计

    作用：
        按 model_used 分组统计各模型的使用次数、平均耗时、Token 消耗，
        用于分析各模型的性能和成本，辅助模型选型决策。

    实现方式：
        1. 解析时间范围参数
        2. 调用 qa_event_service.get_model_stats 分组聚合
        3. 返回按使用次数降序排列的模型统计

    查询参数：
        - start_time: 开始时间（ISO 格式，可选）
        - end_time: 结束时间（ISO 格式，可选）

    响应（200）：
        [
            {
                "model": "qwen-plus",
                "count": 800,
                "avg_llm_time_ms": 2000,
                "avg_retry_count": 0.1,
                "total_token_input": 1200000,
                "total_token_output": 240000
            },
            ...
        ]
    """
    # M-9 修复：时间参数解析失败返回 400，而非静默忽略
    try:
        parsed_start, parsed_end = _parse_time(start_time, end_time)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": {"code": "INVALID_TIME_FORMAT", "message": "时间参数格式无效，请使用 ISO 格式（如 2026-07-01T00:00:00）"}},
        )
    return qa_event_service.get_model_stats(db, start_time=parsed_start, end_time=parsed_end)


# ============================================
# 降级分析
# ============================================

@router.get(
    "/degradation",
    summary="降级原因分布",
)
def get_degradation_stats(
    start_time: Optional[str] = Query(None, description="开始时间（ISO 格式）"),
    end_time: Optional[str] = Query(None, description="结束时间（ISO 格式）"),
    db: Session = Depends(get_db),
) -> Any:
    """
    获取降级原因分布统计

    作用：
        按 degrade_reason 分组统计各降级原因的次数和占比，
        用于定位系统瓶颈（如 LLM 超时 vs 熔断 vs Embedding 失败），
        指导容错策略优化。

    实现方式：
        1. 解析时间范围参数
        2. 调用 qa_event_service.get_degradation_stats 分组聚合
        3. 返回按次数降序排列的降级原因统计

    查询参数：
        - start_time: 开始时间（ISO 格式，可选）
        - end_time: 结束时间（ISO 格式，可选）

    响应（200）：
        [
            {
                "reason": "circuit_open",
                "count": 50,
                "percentage": 0.625
            },
            {
                "reason": "llm_unavailable",
                "count": 30,
                "percentage": 0.375
            }
        ]
    """
    # M-9 修复：时间参数解析失败返回 400，而非静默忽略
    try:
        parsed_start, parsed_end = _parse_time(start_time, end_time)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": {"code": "INVALID_TIME_FORMAT", "message": "时间参数格式无效，请使用 ISO 格式（如 2026-07-01T00:00:00）"}},
        )
    return qa_event_service.get_degradation_stats(db, start_time=parsed_start, end_time=parsed_end)
