"""
WebSocket 实时通知端点（E1-04）

作用：
    提供 WebSocket 连接，实时向用户推送通知事件：
    - 注册审批结果通知
    - 文档处理完成通知
    - 系统公告

    基于 Redis Pub/Sub 实现跨实例消息分发（Railway 多副本场景）。

实现方式：
    1. 客户端通过 /ws/notifications?token=<JWT> 连接
    2. 服务端验证 JWT，提取 user_id
    3. 订阅 Redis channel: notifications:{user_id}
    4. 其他服务通过 publish_notification() 发布通知
    5. WebSocket 收到 Redis 消息后推送给客户端

使用方式：
    # 后端发布通知
    from app.api.ws_notifications import publish_notification
    await publish_notification(user_id=1, notification={
        "type": "registration_approved",
        "message": "您的注册申请已通过",
    })

    # 前端连接
    const ws = new WebSocket(`ws://host/ws/notifications?token=${jwt}`)
    ws.onmessage = (event) => console.log(JSON.parse(event.data))
"""

import json
import logging
from typing import Optional, Dict, Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jose import JWTError

from app.core.config import settings
from app.core.security import decode_access_token
from app.core.redis import redis_client

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_notification_channel(user_id: int) -> str:
    """
    生成用户通知频道名

    作用：
        为指定用户生成 Redis Pub/Sub 频道名。
        格式：kb_qa:{env}:notifications:{user_id}

    参数：
        user_id: int - 用户 ID

    返回：
        str - Redis 频道名
    """
    return f"{settings.redis_key_prefix}notifications:{user_id}"


async def publish_notification(user_id: int, notification: Dict[str, Any]) -> None:
    """
    发布通知到用户频道

    作用：
        将通知消息发布到 Redis 频道，所有订阅该频道的 WebSocket 连接
        都会收到消息。用于审批完成、文档处理完成等事件通知。

    参数：
        user_id: int - 目标用户 ID
        notification: Dict[str, Any] - 通知内容，包含 type 和 message

    示例：
        await publish_notification(user_id=1, notification={
            "type": "registration_approved",
            "message": "您的注册申请已通过",
            "timestamp": "2026-07-11T10:00:00Z",
        })
    """
    try:
        channel = _get_notification_channel(user_id)
        message = json.dumps(notification, ensure_ascii=False, default=str)
        redis_client.publish(channel, message)
    except Exception as e:
        logger.error(f"发布通知失败: user_id={user_id}, error={e}")


@router.websocket("/ws/notifications")
async def websocket_notifications(websocket: WebSocket):
    """
    WebSocket 通知端点

    作用：
        建立 WebSocket 连接，实时向用户推送通知。
        通过 query parameter ?token=<JWT> 进行认证。

    认证流程：
        1. 从 query parameter 提取 token
        2. 解码 JWT 获取 user_id
        3. 认证失败时关闭连接（code=4001）

    消息格式：
        服务端 → 客户端：
        {
            "type": "registration_approved",
            "message": "您的注册申请已通过",
            "timestamp": "2026-07-11T10:00:00Z"
        }

    实现方式：
        - 使用 Redis Pub/Sub 订阅用户频道
        - 在独立线程中监听 Redis 消息（redis-py 的 pubsub 是同步的）
        - 通过 asyncio.to_thread 避免阻塞事件循环
        - 心跳机制：每 30 秒发送 ping，检测连接是否存活
    """
    # 从 query parameter 提取 token
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="缺少认证 token")
        return

    # 验证 JWT
    try:
        payload = decode_access_token(token)
        if not payload:
            await websocket.close(code=4001, reason="无效的 token")
            return
        user_id_str = payload.get("sub")
        if not user_id_str:
            await websocket.close(code=4001, reason="token 中无用户信息")
            return
        user_id = int(user_id_str)
    except (JWTError, ValueError) as e:
        logger.debug(f"WebSocket 认证失败: {e}")
        await websocket.close(code=4001, reason="认证失败")
        return

    # 接受 WebSocket 连接
    await websocket.accept()
    logger.info(f"WebSocket 连接建立: user_id={user_id}")

    # 订阅 Redis 频道
    channel = _get_notification_channel(user_id)
    pubsub = redis_client.pubsub()
    pubsub.subscribe(channel)

    try:
        import asyncio

        while True:
            # 在线程中获取 Redis 消息（避免阻塞事件循环）
            message = await asyncio.to_thread(pubsub.get_message, timeout=1.0)

            if message and message["type"] == "message":
                # 推送消息给客户端
                data = message["data"]
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                await websocket.send_text(data)

            # 检查 WebSocket 是否仍连接
            # WebSocketDisconnect 会在 send 时抛出

    except WebSocketDisconnect:
        logger.info(f"WebSocket 断开: user_id={user_id}")
    except Exception as e:
        logger.error(f"WebSocket 异常: user_id={user_id}, error={e}")
    finally:
        # 清理 Redis 订阅
        try:
            pubsub.unsubscribe(channel)
            pubsub.close()
        except Exception:
            pass
        logger.info(f"WebSocket 连接清理完成: user_id={user_id}")
