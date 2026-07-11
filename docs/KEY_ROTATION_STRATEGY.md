# 密钥轮换策略（E4-04）

> **文档日期**：2026-07-11
> **适用范围**：GeiIt企业知识库所有敏感凭据的轮换管理

---

## 1. 概述

### 1.1 目的

建立规范的密钥轮换流程，降低密钥泄露风险，确保在密钥泄露时能够快速、无中断地更换。

### 1.2 轮换原则

- **最小影响**：轮换过程不中断服务
- **新旧并行**：轮换期间新旧密钥同时有效，确保平滑过渡
- **定期轮换**：按固定周期轮换，不等泄露才换
- **可审计**：轮换操作有日志记录

---

## 2. 密钥清单与轮换周期

| 密钥 | 环境变量 | 轮换周期 | 轮换方式 | 影响范围 |
|------|----------|----------|----------|----------|
| JWT 签名密钥 | `SECRET_KEY` | 90 天 | 新旧并行（multi-secret） | 所有已登录用户需重新登录 |
| 数据库密码 | `DATABASE_URL` | 180 天 | Railway 变更 + 重启 | 短暂连接中断（<30s） |
| Redis 密码 | `REDIS_URL` | 180 天 | Railway 变更 + 重启 | 短暂连接中断（<30s） |
| SMTP 密码 | `SMTP_PASSWORD` | 180 天 | Resend API 重新生成 | 邮件发送中断 |
| LLM API Key | `LLM_API_KEY` | 90 天 | 提供商后台重新生成 | RAG 问答中断 |
| Celery Broker URL | `CELERY_BROKER_URL` | 180 天 | Railway 变更 + 重启 | 后台任务中断 |

---

## 3. JWT SECRET_KEY 轮换方案（重点）

### 3.1 当前架构

```
config.py:  SECRET_KEY = os.getenv("SECRET_KEY")
security.py: jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")
             jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
```

### 3.2 Multi-Secret 轮换实现

**目标**：轮换期间新旧密钥同时有效，用户无感知。

**步骤 1**：添加 `SECRET_KEY_PREVIOUS` 环境变量

```python
# config.py 新增
SECRET_KEY_PREVIOUS: Optional[str] = os.getenv("SECRET_KEY_PREVIOUS")
```

**步骤 2**：修改 Token 验证逻辑

```python
# security.py 修改 decode_access_token
def decode_access_token(token: str) -> Optional[dict]:
    """
    解码 Access Token

    作用：
        验证 JWT Token 并返回 payload。
        支持新旧密钥并行验证（轮换期）。

    实现方式：
        1. 先用新密钥验证
        2. 失败后用旧密钥验证（轮换期）
        3. 旧密钥验证成功后可选刷新 Token
    """
    # 尝试用当前密钥解码
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=["HS256"],
        )
        return payload
    except JWTError:
        pass

    # 尝试用旧密钥解码（轮换期）
    if settings.SECRET_KEY_PREVIOUS:
        try:
            payload = jwt.decode(
                token,
                settings.SECRET_KEY_PREVIOUS,
                algorithms=["HS256"],
            )
            # 旧密钥验证成功，Token 仍有效但建议刷新
            return payload
        except JWTError:
            pass

    return None
```

**步骤 3**：轮换操作流程

```
1. 生成新密钥：python -c "import secrets; print(secrets.token_urlsafe(32))"
2. 在 Railway 中设置：
   SECRET_KEY_PREVIOUS = <当前 SECRET_KEY 的值>
   SECRET_KEY = <新密钥>
3. 部署服务（自动重启）
4. 等待 7 天（超过 Access Token 最大有效期，所有旧 Token 自然过期）
5. 清除 SECRET_KEY_PREVIOUS 环境变量
6. 再次部署
```

### 3.3 轮换时间线

| 时间 | 操作 | 状态 |
|------|------|------|
| T+0 | 设置 `SECRET_KEY_PREVIOUS` = 旧密钥，`SECRET_KEY` = 新密钥 | 新旧并行期开始 |
| T+0 | 新 Token 用新密钥签发 | 用户正常使用 |
| T+0 ~ T+7天 | 旧 Token 用旧密钥验证（仍有效） | 旧用户无感知 |
| T+7天 | 清除 `SECRET_KEY_PREVIOUS` | 新旧并行期结束 |
| T+7天+ | 旧 Token 失效，用户需重新登录 | 轮换完成 |

---

## 4. 数据库/Redis 密码轮换

### 4.1 操作步骤

```
1. 在 PostgreSQL/Redis 管理后台创建新密码
2. 更新 Railway 环境变量：
   DATABASE_URL = postgresql+psycopg://user:新密码@host:port/db
   REDIS_URL = redis://:新密码@host:port
3. Railway 自动重新部署
4. 验证健康检查：GET /health
5. 在管理后台删除旧密码（或禁用旧用户）
```

### 4.2 注意事项

- PostgreSQL 修改密码：`ALTER USER kb_qa WITH PASSWORD '新密码';`
- Redis 修改密码：`CONFIG SET requirepass "新密码"`（并在 redis.conf 中同步）
- 轮换窗口约 30 秒（Railway 重启时间），建议在低峰期操作

---

## 5. LLM API Key 轮换

### 5.1 操作步骤

```
1. 在 LLM 提供商后台（如 OpenAI/Anthropic）创建新 API Key
2. 更新 Railway 环境变量：LLM_API_KEY = <新 Key>
3. Railway 自动重新部署
4. 验证 RAG 问答功能正常
5. 在提供商后台删除旧 API Key
```

---

## 6. 轮换操作日志模板

每次轮换操作需记录以下信息：

```markdown
## 密钥轮换记录

- **日期**：YYYY-MM-DD
- **操作人**：XXX
- **轮换密钥**：SECRET_KEY / DATABASE_URL / ...
- **旧密钥指纹**：SHA-256 前 8 位（用于追踪，不记录完整密钥）
- **新密钥指纹**：SHA-256 前 8 位
- **操作时间**：HH:MM:SS
- **验证结果**：✅ 通过 / ❌ 失败
- **备注**：如有异常说明
```

---

## 7. 应急轮换（泄露响应）

当发现密钥可能泄露时，按以下流程紧急轮换：

| 步骤 | 操作 | 时限 |
|------|------|------|
| 1 | 确认泄露范围（哪些密钥受影响） | 5 分钟 |
| 2 | 生成新密钥并更新 Railway 环境变量 | 10 分钟 |
| 3 | 部署服务 | 5 分钟 |
| 4 | 验证服务正常 | 5 分钟 |
| 5 | 吊销旧密钥（提供商后台删除/数据库修改） | 10 分钟 |
| 6 | 检查是否有异常访问记录 | 30 分钟 |
| 7 | 编写事故报告 | 24 小时 |

### JWT 密钥泄露应急

```
1. 生成新密钥
2. 设置 SECRET_KEY_PREVIOUS = 旧密钥（短暂并行）
3. 设置 SECRET_KEY = 新密钥
4. 部署
5. 等待 1 小时（确保大部分用户刷新 Token）
6. 清除 SECRET_KEY_PREVIOUS
7. 部署（旧 Token 全部失效，强制所有用户重新登录）
```

---

## 8. 自动化提醒

建议在运维日历中设置以下提醒：

| 提醒 | 时间 | 操作 |
|------|------|------|
| JWT 密钥轮换 | 每 85 天（90 天周期前 5 天） | 执行轮换流程 |
| 数据库密码轮换 | 每 175 天（180 天周期前 5 天） | 执行轮换流程 |
| Redis 密码轮换 | 每 175 天 | 执行轮换流程 |
| LLM API Key 轮换 | 每 85 天 | 执行轮换流程 |
| 密钥审计 | 每月 | 检查是否有未轮换的密钥 |

---

> 本文档应随密钥架构变化及时更新。轮换操作后需在运维日志中记录。
