# Critical 问题修复计划

> **文档日期**: 2026-07-09
> **基于审查报告**: [COMPREHENSIVE_REVIEW_REPORT.md](./COMPREHENSIVE_REVIEW_REPORT.md)
> **范围**: 11 项 Critical 问题（部署前必须修复）
> **状态**: 待审阅（用户已选择"仅输出修复计划"，未授权改代码）

---

## 文档说明

本文档为每项 Critical 问题提供：
1. **问题描述** — 缺陷本质与攻击/失败场景
2. **当前代码位置** — 精确文件与行号，含现状代码片段
3. **影响评估** — 严重程度、触发条件、业务后果
4. **修复方案** — 具体代码 diff（含注释，符合项目规范）
5. **测试用例设计** — 验证修复有效的测试场景
6. **风险评估** — 修复可能引入的副作用与回滚策略
7. **验证步骤** — 上线前的确认清单

修复优先级与依赖关系见文末[第十节](#十修复优先级与依赖关系)。

---

## 一、C-1: SSRF 重定向绕过 ⚠️ 最高优先级

### 1.1 问题描述

`validate_url()` 对初始 URL 做了完善的 SSRF 防护（协议白名单 + IP 黑名单 + DNS 解析检查），但 `UrlParser.parse` 使用 `requests.get(url, ..., timeout=timeout)` **默认跟随重定向**（`allow_redirects=True`）。

攻击者部署公网域名返回 302 重定向到 `http://169.254.169.254/latest/meta-data/`（云元数据）或内网地址，绕过所有防护。

### 1.2 当前代码位置

**文件**: [parsers.py](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/app/services/document_pipeline/parsers.py#L317) 行 317

```python
response = requests.get(url, headers=self._HEADERS, timeout=timeout)
response.raise_for_status()
```

**矛盾点**: [url_validator.py](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/app/core/url_validator.py#L16) 行 16 注释明确写"限制重定向跟随（由调用方控制，此处仅校验初始 URL）"——但调用方 `parsers.py` 未履行该职责。

### 1.3 影响评估

| 维度 | 评估 |
|------|------|
| 严重级别 | Critical（3 个代理独立标记最高风险） |
| 触发条件 | `POST /documents/import-url` 传入返回 302 的公网域名 |
| 攻击成本 | 极低（仅需一个公网 HTTP 服务器） |
| 业务后果 | 云凭证泄露 → 账号被接管 → 数据全部失窃 |
| 利用难度 | 零日级（无需身份漏洞，纯逻辑绕过） |

### 1.4 修复方案

**策略**: 完全禁用自动重定向。业务上单页文档导入不需要跟随重定向（用户应直接提供最终 URL）。

```python
# parsers.py UrlParser.parse
# 修复前：
response = requests.get(url, headers=self._HEADERS, timeout=timeout)
response.raise_for_status()

# 修复后：
# C-1 修复：禁用自动重定向，防止 SSRF 重定向绕过
# 作用：validate_url 仅校验初始 URL，若允许重定向，攻击者可让公网域名
#       302 跳转到 169.254.169.254（云元数据）或内网地址，绕过所有 SSRF 防护
# 安全要求：allow_redirects=False，遇到 3xx 直接拒绝
response = requests.get(
    url,
    headers=self._HEADERS,
    timeout=timeout,
    allow_redirects=False,  # C-1: 禁用重定向
)
# 拒绝任何重定向响应（301/302/303/307/308）
if response.is_redirect or response.is_permanent_redirect:
    raise ValueError(f"安全策略禁止 URL 重定向（target={url}）")
response.raise_for_status()
```

### 1.5 测试用例设计

```python
# tests/test_ssrf_redirect_protection.py

class TestSSRFRedirectProtection:
    """C-1: SSRF 重定向绕过防护测试"""

    def test_redirect_to_internal_blocked(self, monkeypatch):
        """302 重定向到内网地址应被拒绝"""
        # 构造伪响应：302 跳转到 169.254.169.254
        mock_response = MagicMock()
        mock_response.is_redirect = True
        mock_response.is_permanent_redirect = False
        mock_response.status_code = 302
        mock_response.headers = {"Location": "http://169.254.169.254/latest/meta-data/"}
        monkeypatch.setattr("requests.get", lambda *a, **kw: mock_response)

        parser = UrlParser()
        with pytest.raises(ValueError, match="禁止 URL 重定向"):
            parser.parse("http://attacker.com/redir")

    def test_permanent_redirect_blocked(self, monkeypatch):
        """301 永久重定向应被拒绝"""
        mock_response = MagicMock()
        mock_response.is_redirect = False
        mock_response.is_permanent_redirect = True
        mock_response.status_code = 301
        monkeypatch.setattr("requests.get", lambda *a, **kw: mock_response)

        parser = UrlParser()
        with pytest.raises(ValueError, match="禁止 URL 重定向"):
            parser.parse("http://example.com/moved")

    def test_no_redirect_allowed(self, monkeypatch):
        """200 正常响应应通过"""
        mock_response = MagicMock()
        mock_response.is_redirect = False
        mock_response.is_permanent_redirect = False
        mock_response.status_code = 200
        mock_response.content = b"<html><body>正常内容</body></html>"
        mock_response.raise_for_status = MagicMock()
        monkeypatch.setattr("requests.get", lambda *a, **kw: mock_response)

        parser = UrlParser()
        text = parser.parse("http://example.com/article")
        assert "正常内容" in text

    def test_allow_redirects_false_in_request(self, monkeypatch):
        """验证 requests.get 调用时 allow_redirects=False"""
        captured_kwargs = {}
        def fake_get(*args, **kwargs):
            captured_kwargs.update(kwargs)
            mock_response = MagicMock()
            mock_response.is_redirect = False
            mock_response.is_permanent_redirect = False
            mock_response.status_code = 200
            mock_response.content = b"内容"
            mock_response.raise_for_status = MagicMock()
            return mock_response

        monkeypatch.setattr("requests.get", fake_get)
        parser = UrlParser()
        parser.parse("http://example.com/article")
        assert captured_kwargs.get("allow_redirects") is False
```

### 1.6 风险评估

| 风险点 | 评估 | 缓解措施 |
|--------|------|----------|
| 正常业务影响 | 极低：合法网站少用重定向，且用户可提供最终 URL | 在错误信息中提示"请提供最终 URL" |
| 已有 URL 导入任务 | 不受影响：已下载的文档不重新解析 | 无需迁移 |
| 回滚成本 | 极低：删除 `allow_redirects=False` 一行 | Git revert 即可 |

### 1.7 验证步骤

1. 单元测试：`pytest tests/test_ssrf_redirect_protection.py -v`
2. 集成测试：搭建返回 302→`http://127.0.0.1:8087/` 的 HTTP 服务，通过 `POST /documents/import-url` 提交，确认返回 400 且无内网请求发出
3. 回归测试：正常公网 URL 导入仍能成功（如 `https://example.com`）

---

## 二、C-2: 流式接口幂等性锁泄漏

### 2.1 问题描述

幂等锁在 endpoint 函数体获取（chat.py:331-339），释放在 `event_stream()` 生成器的 `finally` 块（chat.py:522-526）。若获取锁后、返回 `StreamingResponse` 前抛异常（如 `conversation_id` 404、DB commit 失败、`_get_or_create_conversation` 抛错），生成器不被迭代，`finally` 不执行，锁泄漏 300 秒。

### 2.2 当前代码位置

**文件**: [chat.py](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/app/api/routes/chat.py#L331) 行 331-339（获取锁）, 行 528-537（返回 StreamingResponse）

```python
# 行 331-339：获取锁
if idempotency_key:
    idempotency_lock_key = RedisKeys.idempotency_lock(current_user.id, idempotency_key)
    if not RedisManager.set(idempotency_lock_key, "1", ttl=300, nx=True):
        raise HTTPException(409, ...)

# 行 341-362：同步代码（可能抛异常）
conversation = _get_or_create_conversation(...)  # 可能 404
db.add(user_message)
db.commit()  # 可能 IntegrityError
db.refresh(user_message)
db.refresh(conversation)

# 行 384-526：定义 event_stream 生成器（含 finally 释放锁）
async def event_stream():
    ...
    finally:
        if idempotency_lock_key:
            RedisManager.delete(idempotency_lock_key)  # 仅生成器被迭代时执行

# 行 528-537：返回 StreamingResponse
return StreamingResponse(event_stream(), ...)
```

**问题**: 行 341-362 之间任意异常 → 锁泄漏 300 秒。

### 2.3 影响评估

| 维度 | 评估 |
|------|------|
| 严重级别 | Critical |
| 触发条件 | 提供无效 `conversation_id`（404）、DB commit 失败、`_get_or_create_conversation` 异常 |
| 攻击成本 | 低（恶意用户可故意传错误 conversation_id 触发） |
| 业务后果 | 锁泄漏 300 秒，期间该用户无法用相同 idempotency_key 提问；累积可导致幂等性机制失效 |
| 实际概率 | 中等：DB 异常不常见，但 conversation_id 404 易触发 |

### 2.4 修复方案

**策略**: 用 try/except 包裹获取锁后的所有同步代码，异常时释放锁后再抛出。

```python
# chat.py ask_question_stream
# 修复前（行 331-362 + 528-537）：
if idempotency_key:
    idempotency_lock_key = RedisKeys.idempotency_lock(current_user.id, idempotency_key)
    if not RedisManager.set(idempotency_lock_key, "1", ttl=300, nx=True):
        raise HTTPException(409, ...)

conversation = _get_or_create_conversation(...)
db.add(user_message)
db.commit()
db.refresh(user_message)
db.refresh(conversation)
# ... 其他同步代码 ...
return StreamingResponse(event_stream(), ...)

# 修复后：
# C-2 修复：同步代码异常时释放幂等锁，防止锁泄漏
# 作用：原实现锁释放在 event_stream() 的 finally，但生成器未被迭代时
#       （同步代码抛异常）finally 不执行，锁泄漏 300 秒
# 修复：用 try/except 包裹同步代码，异常时主动释放锁
if idempotency_key:
    idempotency_lock_key = RedisKeys.idempotency_lock(current_user.id, idempotency_key)
    if not RedisManager.set(idempotency_lock_key, "1", ttl=300, nx=True):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": {"code": "DUPLICATE_REQUEST", "message": "请求正在处理中，请勿重复提交"}},
        )

try:
    # ===== 以下同步代码任何异常都需释放锁 =====
    conversation = _get_or_create_conversation(
        db=db,
        user_id=current_user.id,
        conversation_id=question_data.conversation_id,
        title=question_data.question[:20]
    )

    user_message = Message(
        conversation_id=conversation.id,
        role="user",
        content=question_data.question,
    )
    db.add(user_message)
    db.commit()
    db.refresh(user_message)
    db.refresh(conversation)

    history, summary = history_service.get_effective_history(
        db, conversation, exclude_message_id=user_message.id
    )
    intent_result = intent_service.detect_intent_switch(
        question_data.question, history
    )
    effective_summary = None if intent_result.switched else summary

    # 定义生成器（finally 仍保留释放逻辑，作为正常路径的兜底）
    async def event_stream():
        ...
        finally:
            if idempotency_lock_key:
                RedisManager.delete(idempotency_lock_key)

    return StreamingResponse(event_stream(), ...)

except Exception:
    # C-2 修复：同步代码异常时释放锁，允许用户重试
    # 作用：避免锁泄漏 300 秒阻塞后续相同 idempotency_key 的请求
    if idempotency_lock_key:
        RedisManager.delete(idempotency_lock_key)
    raise
```

**注意**: `event_stream()` 的 `finally` 块保留不变，作为正常路径（生成器被迭代）的兜底。同步路径的异常由外层 try/except 处理。

### 2.5 测试用例设计

```python
# tests/test_idempotency_lock_release.py

class TestStreamIdempotencyLockRelease:
    """C-2: 流式接口幂等锁异常时释放测试"""

    def test_lock_released_on_conversation_not_found(self, monkeypatch):
        """conversation_id 不存在时锁应被释放"""
        # 模拟 _get_or_create_conversation 抛 404
        ...

    def test_lock_released_on_db_commit_failure(self, monkeypatch):
        """DB commit 失败时锁应被释放"""
        # 模拟 db.commit() 抛 IntegrityError
        ...

    def test_lock_retained_during_streaming(self, monkeypatch):
        """流式处理期间锁应保留"""
        # 验证生成器迭代期间锁存在
        ...

    def test_lock_released_after_stream_complete(self, monkeypatch):
        """流式正常完成后锁应释放"""
        ...

    def test_lock_released_on_stream_exception(self, monkeypatch):
        """流式处理异常时锁应释放（finally 块）"""
        ...
```

### 2.6 风险评估

| 风险点 | 评估 | 缓解措施 |
|--------|------|----------|
| 双重释放 | 低：`RedisManager.delete` 对不存在的 key 无副作用 | 无需特殊处理 |
| 异常吞掉 | 无：except 块仅释放锁后 `raise`，异常正常传播 | 代码审查确认 |
| 流式生成器内异常 | 不受影响：仍由生成器 finally 处理 | 保持原逻辑 |
| 回滚成本 | 低：移除外层 try/except 即可 | Git revert |

### 2.7 验证步骤

1. 单元测试：`pytest tests/test_idempotency_lock_release.py -v`
2. 手动测试：用无效 `conversation_id` + `idempotency_key` 提交流式请求，确认返回 404 后立即用相同 key 再次提交能成功（锁已释放）
3. Redis 监控：`redis-cli MONITOR` 观察锁 key 在异常后被 DEL

---

## 三、C-3: turn_count 递增非原子

### 3.1 问题描述

`conversation.turn_count += 1` 是 read-modify-write 操作。并发请求读取相同值，各自 +1 后写回，turn_count 只增加 1 而非 N。导致记忆衰退机制（摘要生成时机）失效。

### 3.2 当前代码位置

**3 处非原子更新**:
- [chat.py:206](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/app/api/routes/chat.py#L206) — 非流式正常路径
- [chat.py:457](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/app/api/routes/chat.py#L457) — 流式正常路径
- [chat.py:509](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/app/api/routes/chat.py#L509) — 流式异常保存部分回答路径

```python
# 行 206（非流式）
conversation.turn_count += 1  # 记忆衰退：递增对话轮数
db.commit()
```

### 3.3 影响评估

| 维度 | 评估 |
|------|------|
| 严重级别 | Critical |
| 触发条件 | 同一 conversation 并发提问（用户多标签页或前端重复提交） |
| 攻击成本 | 无（正常使用即可能触发） |
| 业务后果 | 摘要生成时机不准 → 上下文超长 → LLM 调用失败或质量下降 |
| 实际概率 | 中等：单用户多标签页场景常见 |

### 3.4 修复方案

**策略**: 使用 SQL 原子更新（`UPDATE ... SET turn_count = turn_count + 1`），避免 read-modify-write。

```python
# chat.py
# 修复前（3 处）：
conversation.turn_count += 1
db.commit()

# 修复后（封装为辅助函数）：
from sqlalchemy import update

def _increment_turn_count(db: Session, conversation_id: int) -> None:
    """
    原子递增对话轮数（C-3 修复）

    作用：
        使用 SQL UPDATE 原子递增 turn_count，避免 read-modify-write 竞态。
        原实现 conversation.turn_count += 1 在并发请求下会丢失更新。

    实现方式：
        UPDATE conversations SET turn_count = turn_count + 1 WHERE id = :id
        数据库行锁保证原子性，并发请求各自 +1 不会丢失。

    参数：
        db: Session - 数据库会话
        conversation_id: int - 对话ID
    """
    db.execute(
        update(Conversation)
        .where(Conversation.id == conversation_id)
        .values(turn_count=Conversation.turn_count + 1)
    )
    db.commit()


# 替换 3 处调用：
# 行 206（非流式）：
db.add(assistant_message)
# C-3 修复：原子递增 turn_count，避免并发丢失更新
_increment_turn_count(db, conversation.id)
db.refresh(assistant_message)
# 注意：不再 db.refresh(conversation)，turn_count 已由 SQL 更新
# 若后续需要最新 turn_count，重新查询或 db.refresh(conversation)

# 行 457（流式）：
db.add(assistant_message)
_increment_turn_count(db, conversation.id)
db.refresh(assistant_message)

# 行 509（流式异常保存部分回答）：
db.add(partial_message)
_increment_turn_count(db, conversation.id)
# 原 db.commit() 已在 _increment_turn_count 内
```

### 3.5 测试用例设计

```python
# tests/test_turn_count_atomic.py

class TestTurnCountAtomic:
    """C-3: turn_count 原子递增测试"""

    def test_concurrent_increment_no_loss(self, db_session, monkeypatch):
        """并发递增不丢失更新"""
        # 创建 conversation，turn_count=0
        # 启动 10 个线程并发调用 _increment_turn_count
        # 验证最终 turn_count=10
        ...

    def test_increment_is_atomic(self, db_session):
        """单次递增正确"""
        ...

    def test_stream_exception_path_increments(self, db_session):
        """流式异常保存部分回答路径也递增"""
        ...
```

### 3.6 风险评估

| 风险点 | 评估 | 缓解措施 |
|--------|------|----------|
| ORM 对象状态不一致 | 中：`conversation.turn_count` 内存值不更新 | 后续若需读取，调用 `db.refresh(conversation)` |
| 事务隔离级别 | 低：PostgreSQL 默认 Read Committed，行锁足够 | 无需调整 |
| 后续依赖 turn_count | 需排查 `maybe_generate_summary` 是否读取内存值 | 见验证步骤 |
| 回滚成本 | 低：恢复 `+= 1` 即可 | Git revert |

### 3.7 验证步骤

1. 单元测试：`pytest tests/test_turn_count_atomic.py -v`
2. 排查 `history_service.maybe_generate_summary` 是否依赖 `conversation.turn_count` 内存值——若是，需在调用前 `db.refresh(conversation)`
3. 并发测试：用 `asyncio.gather` 并发 10 个提问到同一 conversation，确认 turn_count 增加 10

---

## 四、C-4: 文档删除跨服务操作顺序错误

### 4.1 问题描述

[documents.py:468-483](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/app/api/routes/documents.py#L468) 先删向量数据（外部操作），再 `db.commit()`。若向量删除成功但 commit 失败，向量数据永久丢失但文档仍显示 active，导致数据不一致。

### 4.2 当前代码位置

```python
# documents.py 行 468-483
# 1. 软删除标记
document.is_deleted = True
document.deleted_at = datetime.now()
document.status = "deleted"

# 2. 删除向量数据库中的分块
try:
    vector_store = get_vector_store()
    vector_store.delete_document_chunks(document_id)
except Exception as e:
    logger.warning(f"删除向量分块失败（doc_id={document_id}）: {e}")

db.commit()  # 若此处失败，向量已删但文档未标记删除
```

### 4.3 影响评估

| 维度 | 评估 |
|------|------|
| 严重级别 | Critical |
| 触发条件 | DB commit 失败（连接断开、死锁、约束冲突） |
| 攻击成本 | 无（依赖 DB 异常） |
| 业务后果 | 文档显示 active 但向量已删 → 检索不到 → 用户困惑；不可恢复 |
| 实际概率 | 低：DB commit 失败不常见 |

### 4.4 修复方案

**策略**: 先 commit DB 标记软删除（确保一致性），再删向量（失败可重试，不影响一致性）。

```python
# documents.py delete_document
# 修复前（行 468-483）：
document.is_deleted = True
document.deleted_at = datetime.now()
document.status = "deleted"
try:
    vector_store.delete_document_chunks(document_id)
except Exception as e:
    logger.warning(...)
db.commit()

# 修复后：
# C-4 修复：调整操作顺序，先 commit DB 再删向量
# 作用：原实现先删向量再 commit，若 commit 失败则向量永久丢失但文档仍 active
#       修复后：先 commit 标记软删除（DB 一致性优先），再删向量（失败可重试）
# 数据一致性原则：DB 是 source of truth，向量可重建，不可逆向恢复
document.is_deleted = True
document.deleted_at = datetime.now()
document.status = "deleted"
db.commit()  # 先确保 DB 一致

# 删除向量（失败不影响主流程，可后续重试或由定时任务清理）
# 作用：向量删除是外部操作，失败时记录日志，文档已标记 deleted 不会被检索
try:
    from app.services.vector_store import get_vector_store
    vector_store = get_vector_store()
    vector_store.delete_document_chunks(document_id)
except Exception as e:
    # 警告但不回滚 DB：文档已软删除，向量残留不影响业务（检索时 is_deleted 过滤）
    # 可由定时任务 cleanup_orphan_vectors 清理
    logger.warning(
        f"删除向量分块失败（doc_id={document_id}），待定时任务清理: {e}"
    )

logger.info(f"文档已软删除: doc_id={document_id}")
```

### 4.5 测试用例设计

```python
# tests/test_document_delete_order.py

class TestDocumentDeleteOrder:
    """C-4: 文档删除操作顺序测试"""

    def test_db_commit_first(self, monkeypatch):
        """验证 DB commit 在向量删除之前调用"""
        call_order = []
        # 拦截 db.commit 和 vector_store.delete_document_chunks
        ...
        assert call_order == ["db.commit", "vector_delete"]

    def test_vector_delete_failure_does_not_rollback_db(self, monkeypatch):
        """向量删除失败时 DB 不回滚"""
        # 模拟 vector_store.delete_document_chunks 抛异常
        # 验证 document.is_deleted 仍为 True
        ...

    def test_db_commit_failure_no_vector_delete(self, monkeypatch):
        """DB commit 失败时不调用向量删除"""
        # 模拟 db.commit 抛异常
        # 验证 vector_store.delete_document_chunks 未被调用
        ...
```

### 4.6 风险评估

| 风险点 | 评估 | 缓解措施 |
|--------|------|----------|
| 向量残留 | 中：DB 已删但向量未删 | 检索时 `is_deleted=False` 过滤；定时任务清理 |
| 用户感知延迟 | 低：文档立即从列表消失 | 无影响 |
| 回滚成本 | 低：恢复原顺序即可 | Git revert |

### 4.7 验证步骤

1. 单元测试：`pytest tests/test_document_delete_order.py -v`
2. 手动测试：模拟 vector_store 故障，删除文档后确认 DB 中 `is_deleted=True`，文档从列表消失
3. 检索回归：删除文档后立即检索，确认无结果（`is_deleted=False` 过滤生效）

---

## 五、C-5: Celery 重试导致向量数据重复入库

### 5.1 问题描述

[document_tasks.py:148-152](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/app/tasks/document_tasks.py#L148) `vector_store.add_chunks`（独立 session）与文档状态 `db.commit()`（另一 session）不在同一事务。`add_chunks` 成功后崩溃，Celery 重试时重复插入向量，导致同一文档有重复分块。

### 5.2 当前代码位置

```python
# document_tasks.py 行 145-161
# 6. 向量化并存入 pgvector
chunk_count = 0
if ctx.chunks:
    from app.services.vector_store import get_vector_store
    vector_store = get_vector_store()
    chunk_dicts = ctx.to_chunk_dicts()
    chunk_count = vector_store.add_chunks(chunk_dicts, document_id=document.id)  # 无去重

# 7. 更新文档为完成状态
document.status = "completed"
document.chunk_count = chunk_count
...
db.commit()
```

**确认**: `vector_store.delete_document_chunks` 方法已存在（[vector_store.py:642](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/app/services/vector_store.py#L642)），可直接复用。

### 5.3 影响评估

| 维度 | 评估 |
|------|------|
| 严重级别 | Critical |
| 触发条件 | Celery 任务在 add_chunks 后、db.commit 前崩溃并重试 |
| 攻击成本 | 无（依赖系统故障） |
| 业务后果 | 向量重复 → 检索结果重复 → RAG 回答质量下降；存储浪费 |
| 实际概率 | 中：Celery 重试机制设计为会重试失败任务 |

### 5.4 修复方案

**策略**: 入库前先删除该文档的旧分块（幂等），保证 add_chunks 可重复执行。

```python
# document_tasks.py process_document_task
# 修复前（行 145-152）：
chunk_count = 0
if ctx.chunks:
    from app.services.vector_store import get_vector_store
    vector_store = get_vector_store()
    chunk_dicts = ctx.to_chunk_dicts()
    chunk_count = vector_store.add_chunks(chunk_dicts, document_id=document.id)

# 修复后：
# C-5 修复：入库前先删除旧分块，保证幂等
# 作用：Celery 重试时若不清理旧分块，add_chunks 会重复插入，导致向量重复
#       修复后：先 delete_document_chunks（幂等），再 add_chunks
#       即使重试 N 次，最终向量数据仍为单份
chunk_count = 0
if ctx.chunks:
    from app.services.vector_store import get_vector_store
    vector_store = get_vector_store()

    # C-5: 先清理旧分块（处理重试场景）
    # 作用：首次处理时无旧分块，delete 是 no-op；重试时清理上次的部分插入
    try:
        vector_store.delete_document_chunks(document.id)
    except Exception as e:
        logger.warning(
            f"清理旧分块失败（doc_id={document.id}），继续插入: {e}"
        )

    chunk_dicts = ctx.to_chunk_dicts()
    chunk_count = vector_store.add_chunks(chunk_dicts, document_id=document.id)
```

### 5.5 测试用例设计

```python
# tests/test_vector_ingest_idempotent.py

class TestVectorIngestIdempotent:
    """C-5: 向量入库幂等性测试"""

    def test_retry_does_not_duplicate_chunks(self, monkeypatch):
        """重试不产生重复分块"""
        # 模拟 add_chunks 成功后崩溃，再次执行 process_document_task
        # 验证最终 document_chunks 表中该文档的分块数 == 首次插入数
        ...

    def test_delete_before_add_called(self, monkeypatch):
        """验证 delete_document_chunks 在 add_chunks 之前调用"""
        call_order = []
        ...
        assert call_order == ["delete", "add"]

    def test_delete_failure_does_not_block_add(self, monkeypatch):
        """delete 失败时仍继续 add（降级策略）"""
        ...
```

### 5.6 风险评估

| 风险点 | 评估 | 缓解措施 |
|--------|------|----------|
| 首次处理性能 | 低：delete 空表是 no-op，开销可忽略 | 无需优化 |
| delete 失败 | 低：记录 warning 后继续 add，最坏情况是重复（与原状态一致） | 已有 try/except |
| 并发处理同一文档 | 低：reprocess 已有分布式锁（P1-14 修复） | 锁机制保证串行 |
| 回滚成本 | 低：删除 delete 调用即可 | Git revert |

### 5.7 验证步骤

1. 单元测试：`pytest tests/test_vector_ingest_idempotent.py -v`
2. 集成测试：手动触发 Celery 任务失败重试，查询 `document_chunks` 表确认无重复
3. 检索回归：对重试过的文档检索，确认结果无重复分块

---

## 六、C-6: Redis increment 异常返回 0 导致限流绕过

### 6.1 问题描述

[redis.py:319-321](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/app/core/redis.py#L319) `RedisManager.increment` 在 Redis 异常时 catch 并返回 0。`rate_limit` 判断 `count > per_minute`，count=0 时条件永远为 False，限流完全失效。`record_login_failure` 也不递增，锁定机制失效。

### 6.2 当前代码位置

```python
# redis.py 行 290-321
@staticmethod
def increment(key: str, amount: int = 1, ttl: Optional[int] = None) -> int:
    try:
        full_key = RedisManager.make_key(key)
        new_value = redis_client.incrby(full_key, amount)
        if new_value == amount and ttl:
            redis_client.expire(full_key, ttl)
        return new_value
    except Exception as e:
        logger.error(f"Redis increment 失败: {key}, 错误: {e}")
        return 0  # 问题：调用方判断 count > limit，0 永远不大于任何值
```

### 6.3 影响评估

| 维度 | 评估 |
|------|------|
| 严重级别 | Critical |
| 触发条件 | Redis 故障或网络异常 |
| 攻击成本 | 无（依赖 Redis 故障） |
| 业务后果 | 限流完全失效 → LLM 被刷调用 → 成本失控；登录暴力破解防护失效 |
| 实际概率 | 中：Redis 故障是常见运维事件 |

### 6.4 修复方案

**策略**: `increment` 增加 `strict` 参数，安全场景（限流、登录锁定）fail-closed。

```python
# redis.py RedisManager.increment
# 修复前（行 290-321）：
@staticmethod
def increment(key: str, amount: int = 1, ttl: Optional[int] = None) -> int:
    try:
        ...
    except Exception as e:
        logger.error(f"Redis increment 失败: {key}, 错误: {e}")
        return 0

# 修复后：
@staticmethod
def increment(
    key: str,
    amount: int = 1,
    ttl: Optional[int] = None,
    strict: bool = False,  # C-6 新增：安全场景 fail-closed
) -> int:
    """
    自增（同步）

    作用：
        常用于计数器（如登录失败次数、限流计数）。

    参数：
        key: str - 缓存 key
        amount: int - 自增量，默认 1
        ttl: Optional[int] - 首次设置时的过期时间（秒）
        strict: bool - 是否 fail-closed（默认 False）
            False：Redis 异常时返回 0（fail-open，兼容旧调用方）
            True：Redis 异常时抛出异常（fail-closed，用于安全场景）
            C-6 修复：限流和登录失败计数使用 strict=True，
                      防止 Redis 故障时限流绕过和暴力破解防护失效

    返回：
        int - 自增后的值

    异常:
        redis.RedisError - strict=True 且 Redis 异常时抛出
    """
    try:
        full_key = RedisManager.make_key(key)
        new_value = redis_client.incrby(full_key, amount)
        if new_value == amount and ttl:
            redis_client.expire(full_key, ttl)
        return new_value
    except Exception as e:
        logger.error(f"Redis increment 失败: {key}, 错误: {e}")
        if strict:
            # C-6: 安全场景 fail-closed，异常向上传播
            raise
        return 0
```

**调用方修改**:

```python
# rate_limit.py 行 82（每分钟限流）
count = RedisManager.increment(key, ttl=60, strict=True)  # C-6: fail-closed

# rate_limit.py 行 99（每小时限流）
count = RedisManager.increment(key, ttl=3600, strict=True)  # C-6: fail-closed

# rate_limit.py record_login_failure 行 246-249
count = RedisManager.increment(
    fail_key,
    ttl=settings.LOGIN_FAILURE_LOCK_MINUTES * 60,
    strict=True,  # C-6: fail-closed，防止暴力破解防护失效
)
```

**调用方异常处理**:

```python
# rate_limit.py _check_limit（行 70-113）
def _check_limit(request: Request) -> None:
    if not settings.ENABLE_RATE_LIMIT:
        return
    identifier = _get_identifier(request)
    try:
        if per_minute:
            key = RedisKeys.rate_limit(f"{action}:1min:{identifier}", "1min")
            count = RedisManager.increment(key, ttl=60, strict=True)
            if count > per_minute:
                raise HTTPException(429, ...)
        if per_hour:
            key = RedisKeys.rate_limit(f"{action}:1hour:{identifier}", "1hour")
            count = RedisManager.increment(key, ttl=3600, strict=True)
            if count > per_hour:
                raise HTTPException(429, ...)
    except HTTPException:
        raise
    except Exception:
        # C-6: Redis 故障，限流 fail-closed，拒绝请求
        logger.exception("限流 Redis 异常，fail-closed 拒绝请求")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": {"code": "RATE_LIMIT_UNAVAILABLE", "message": "服务暂不可用，请稍后重试"}},
        )

# rate_limit.py record_login_failure（行 223-264）
def record_login_failure(username: str) -> int:
    if not settings.ENABLE_RATE_LIMIT:
        return 0
    fail_key = RedisKeys.login_failure(username)
    try:
        count = RedisManager.increment(
            fail_key,
            ttl=settings.LOGIN_FAILURE_LOCK_MINUTES * 60,
            strict=True,
        )
    except Exception:
        # C-6: Redis 故障，登录失败计数 fail-closed
        # 作用：无法计数时拒绝登录，防止暴力破解
        logger.exception("登录失败计数 Redis 异常，fail-closed 拒绝登录")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": {"code": "AUTH_SERVICE_UNAVAILABLE", "message": "认证服务暂时不可用"}},
        )
    ...
```

### 6.5 测试用例设计

```python
# tests/test_redis_increment_strict.py

class TestRedisIncrementStrict:
    """C-6: Redis increment strict 模式测试"""

    def test_strict_raises_on_redis_failure(self, monkeypatch):
        """strict=True 时 Redis 故障抛异常"""
        monkeypatch.setattr("app.core.redis.redis_client.incrby",
                            MagicMock(side_effect=redis.ConnectionError()))
        with pytest.raises(redis.ConnectionError):
            RedisManager.increment("test:key", strict=True)

    def test_non_strict_returns_zero_on_failure(self, monkeypatch):
        """strict=False 时 Redis 故障返回 0（兼容旧调用）"""
        monkeypatch.setattr("app.core.redis.redis_client.incrby",
                            MagicMock(side_effect=redis.ConnectionError()))
        assert RedisManager.increment("test:key") == 0

    def test_rate_limit_returns_503_on_redis_failure(self, monkeypatch):
        """限流接口 Redis 故障时返回 503"""
        ...

    def test_record_login_failure_raises_on_redis_failure(self, monkeypatch):
        """登录失败计数 Redis 故障时抛 503"""
        ...
```

### 6.6 风险评估

| 风险点 | 评估 | 缓解措施 |
|--------|------|----------|
| Redis 故障时服务不可用 | 中：限流 fail-closed 会导致所有请求 503 | 业务可接受（安全优先）；Redis 高可用部署 |
| 旧调用方兼容 | 低：默认 `strict=False`，无破坏性变更 | 仅修改限流和登录失败计数 |
| 用户体验 | 中：Redis 故障期间无法使用 | 错误信息明确提示"稍后重试" |
| 回滚成本 | 低：移除 strict 参数和调用方 try/except | Git revert |

### 6.7 验证步骤

1. 单元测试：`pytest tests/test_redis_increment_strict.py -v`
2. 故障注入：停止 Redis，调用 `/ask` 接口，确认返回 503 而非 200
3. 登录测试：停止 Redis，尝试登录，确认返回 503 而非正常处理

---

## 七、C-7: check_login_lock fail-open

### 7.1 问题描述

[rate_limit.py:202](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/app/core/rate_limit.py#L202) 使用 `RedisManager.exists`（fail-open），Redis 故障时返回 False，已锁定账号可继续暴力破解。与 `is_token_blacklisted` 的 fail-closed 策略不一致。

### 7.2 当前代码位置

```python
# rate_limit.py 行 198-220
def check_login_lock(username: str) -> None:
    if not settings.ENABLE_RATE_LIMIT:
        return
    lock_key = RedisKeys.user_lock(username)
    if RedisManager.exists(lock_key):  # 问题：fail-open，Redis 故障返回 False
        ...
        raise HTTPException(423, ...)
```

### 7.3 影响评估

| 维度 | 评估 |
|------|------|
| 严重级别 | Critical |
| 触发条件 | Redis 故障期间攻击者暴力破解 |
| 攻击成本 | 低（依赖 Redis 故障窗口） |
| 业务后果 | 账号锁定机制失效，暴力破解可绕过 |
| 实际概率 | 低-中：需 Redis 故障期间发动攻击 |

### 7.4 修复方案

**策略**: 改用 `exists_strict`，捕获异常返回 503。

```python
# rate_limit.py check_login_lock
# 修复前（行 198-220）：
def check_login_lock(username: str) -> None:
    if not settings.ENABLE_RATE_LIMIT:
        return
    lock_key = RedisKeys.user_lock(username)
    if RedisManager.exists(lock_key):
        ...

# 修复后：
def check_login_lock(username: str) -> None:
    """
    检查用户是否被登录锁定（C-7: fail-closed）

    作用：
        登录前检查用户是否因连续失败被锁定。
        锁定则抛 423 Locked 异常。

    实现方式：
        查询 Redis 中是否存在用户锁定 key。
        C-7 修复：使用 exists_strict（fail-closed），Redis 故障时拒绝登录，
                  防止已锁定账号在 Redis 故障期间被暴力破解。

    参数：
        username: str - 用户名

    异常:
        HTTPException 423: 用户被锁定
        HTTPException 503: Redis 故障（C-7 fail-closed）
    """
    if not settings.ENABLE_RATE_LIMIT:
        return

    lock_key = RedisKeys.user_lock(username)
    try:
        # C-7: 改用 exists_strict，fail-closed
        is_locked = RedisManager.exists_strict(lock_key)
    except Exception:
        # Redis 故障，安全场景 fail-closed：拒绝登录
        logger.exception("登录锁定检查 Redis 异常，fail-closed 拒绝登录")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": {"code": "AUTH_SERVICE_UNAVAILABLE", "message": "认证服务暂时不可用，请稍后重试"}},
        )

    if is_locked:
        # 获取剩余锁定时间
        import redis as redis_lib
        from app.core.redis import redis_client
        full_key = RedisManager.make_key(lock_key)
        ttl = redis_client.ttl(full_key)
        remaining_minutes = max(1, ttl // 60) if ttl > 0 else settings.LOGIN_FAILURE_LOCK_MINUTES

        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail={
                "error": {
                    "code": "ACCOUNT_LOCKED",
                    "message": f"账号因多次登录失败被锁定，请 {remaining_minutes} 分钟后再试",
                    "retry_after": ttl if ttl > 0 else settings.LOGIN_FAILURE_LOCK_MINUTES * 60
                }
            },
            headers={"Retry-After": str(ttl if ttl > 0 else settings.LOGIN_FAILURE_LOCK_MINUTES * 60)},
        )
```

### 7.5 测试用例设计

```python
# tests/test_login_lock_fail_closed.py

class TestLoginLockFailClosed:
    """C-7: check_login_lock fail-closed 测试"""

    def test_redis_failure_returns_503(self, monkeypatch):
        """Redis 故障时返回 503"""
        monkeypatch.setattr("app.core.redis.RedisManager.exists_strict",
                            MagicMock(side_effect=redis.ConnectionError()))
        with pytest.raises(HTTPException) as exc:
            check_login_lock("testuser")
        assert exc.value.status_code == 503

    def test_locked_user_returns_423(self, monkeypatch):
        """已锁定用户返回 423"""
        monkeypatch.setattr("app.core.redis.RedisManager.exists_strict", lambda k: True)
        with pytest.raises(HTTPException) as exc:
            check_login_lock("locked_user")
        assert exc.value.status_code == 423

    def test_unlocked_user_passes(self, monkeypatch):
        """未锁定用户正常通过"""
        monkeypatch.setattr("app.core.redis.RedisManager.exists_strict", lambda k: False)
        check_login_lock("normal_user")  # 不抛异常
```

### 7.6 风险评估

| 风险点 | 评估 | 缓解措施 |
|--------|------|----------|
| Redis 故障时无法登录 | 中：所有用户登录被拒 | Redis 高可用部署；故障窗口通常短 |
| 与 C-6 一致性 | 正面：统一 fail-closed 策略 | 无需额外处理 |
| 回滚成本 | 低：恢复 `exists` 即可 | Git revert |

### 7.7 验证步骤

1. 单元测试：`pytest tests/test_login_lock_fail_closed.py -v`
2. 故障注入：停止 Redis，尝试登录，确认返回 503 而非正常处理
3. 锁定回归：正常锁定流程仍生效（连续失败 N 次后 423）

---

## 八、C-8: URL 导入下载无大小限制

### 8.1 问题描述

[parsers.py:317](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/app/services/document_pipeline/parsers.py#L317) 未使用流式下载（`stream=True`），整个响应体读入内存。无 Content-Length 检查、无下载大小限制。攻击者指向超大文件导致 OOM。

### 8.2 当前代码位置

```python
# parsers.py 行 317
response = requests.get(url, headers=self._HEADERS, timeout=timeout)
response.raise_for_status()
# 整个 response.content 读入内存，无大小限制
```

### 8.3 影响评估

| 维度 | 评估 |
|------|------|
| 严重级别 | Critical |
| 触发条件 | `POST /documents/import-url` 传入超大文件 URL |
| 攻击成本 | 低（托管一个大文件即可） |
| 业务后果 | 进程 OOM 被 kill，服务中断 |
| 实际概率 | 中：需攻击者主动利用 |

### 8.4 修复方案

**策略**: 流式下载 + 边写边检查大小，超限即中止。

**注意**: 此修复与 C-1 重定向修复在同一函数，建议合并实现。

```python
# parsers.py UrlParser.parse
# 修复前（行 317-333）：
response = requests.get(url, headers=self._HEADERS, timeout=timeout)
response.raise_for_status()
soup = BeautifulSoup(response.content, "html.parser")
...

# 修复后（含 C-1 重定向防护 + C-8 大小限制）：
# C-1 + C-8 修复：禁用重定向 + 流式下载 + 大小限制
# 作用：
#   C-1：allow_redirects=False 防止 SSRF 重定向绕过
#   C-8：stream=True 流式下载，边读边检查大小，超限中止，避免 OOM
MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024  # 50MB，可配置到 settings

response = requests.get(
    url,
    headers=self._HEADERS,
    timeout=timeout,
    allow_redirects=False,  # C-1: 禁用重定向
    stream=True,            # C-8: 流式下载
)

# C-1: 拒绝重定向
if response.is_redirect or response.is_permanent_redirect:
    response.close()
    raise ValueError(f"安全策略禁止 URL 重定向（target={url}）")

response.raise_for_status()

# C-8: 检查 Content-Length（若提供）
content_length = response.headers.get("Content-Length")
if content_length and int(content_length) > MAX_DOWNLOAD_SIZE:
    response.close()
    raise ValueError(
        f"下载内容过大（{int(content_length)} bytes），"
        f"最大允许 {MAX_DOWNLOAD_SIZE} bytes"
    )

# C-8: 流式读取 + 边写边检查
# 作用：即使无 Content-Length，也通过累计字节数限制
downloaded = 0
chunks = []
for chunk in response.iter_content(chunk_size=1024 * 1024):  # 1MB chunks
    if not chunk:
        continue
    downloaded += len(chunk)
    if downloaded > MAX_DOWNLOAD_SIZE:
        response.close()
        raise ValueError(
            f"下载内容超过大小限制（{MAX_DOWNLOAD_SIZE} bytes），已中止"
        )
    chunks.append(chunk)

response.close()
content = b"".join(chunks)

# BeautifulSoup 解析
soup = BeautifulSoup(content, "html.parser")
...
```

**配置项添加**（[config.py](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/app/core/config.py)）:

```python
# config.py Settings 类
# C-8: URL 导入下载大小限制
URL_IMPORT_MAX_SIZE: int = 50 * 1024 * 1024  # 50MB
```

### 8.5 测试用例设计

```python
# tests/test_url_download_size_limit.py

class TestUrlDownloadSizeLimit:
    """C-8: URL 导入下载大小限制测试"""

    def test_content_length_exceeds_rejected(self, monkeypatch):
        """Content-Length 超限被拒绝"""
        mock_response = MagicMock()
        mock_response.headers = {"Content-Length": str(100 * 1024 * 1024)}  # 100MB
        mock_response.is_redirect = False
        mock_response.is_permanent_redirect = False
        mock_response.raise_for_status = MagicMock()
        monkeypatch.setattr("requests.get", lambda *a, **kw: mock_response)

        parser = UrlParser()
        with pytest.raises(ValueError, match="下载内容过大"):
            parser.parse("http://example.com/bigfile")

    def test_streaming_aborts_on_size_exceed(self, monkeypatch):
        """流式下载超限时中止"""
        # 模拟 iter_content 返回超过限制的块
        ...

    def test_normal_size_allowed(self, monkeypatch):
        """正常大小文件可下载"""
        ...

    def test_no_content_length_still_limited(self, monkeypatch):
        """无 Content-Length 时通过流式累计限制"""
        ...
```

### 8.6 风险评估

| 风险点 | 评估 | 缓解措施 |
|--------|------|----------|
| 大文件正常导入 | 低：50MB 足够网页文档 | 可配置 `URL_IMPORT_MAX_SIZE` |
| 流式下载性能 | 低：1MB chunk 平衡内存与 IO | 无需优化 |
| 与 C-1 合并 | 正面：一次修改解决两个问题 | 同时实现 |
| 回滚成本 | 低：恢复非流式下载即可 | Git revert |

### 8.7 验证步骤

1. 单元测试：`pytest tests/test_url_download_size_limit.py -v`
2. 手动测试：用 `python -m http.server` 托管 100MB 文件，通过 import-url 提交，确认被拒绝
3. 正常回归：导入普通网页（如 `https://example.com`）仍成功

---

## 九、C-9: Token 刷新并发无互斥

### 9.1 问题描述

[auth.py:301-413](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/app/api/routes/auth.py#L301) 并发刷新同一 Refresh Token 时，两个请求都通过黑名单检查（都未拉黑），各自签发新 Token，形成两条并行 Token 链，破坏"一次性使用"语义。

### 9.2 当前代码位置

```python
# auth.py refresh_token 行 352-413
# 1. 检查黑名单（无锁）
try:
    if is_token_blacklisted(body.refresh_token):
        raise invalid_exception
except HTTPException:
    raise
except Exception:
    raise HTTPException(503, ...)

# 2. 解码 Token
payload = decode_refresh_token(body.refresh_token)
...

# 3. 签发新 Token + 拉黑旧 Token（无互斥）
new_access_token = create_access_token(...)
new_refresh_token = create_refresh_token(...)
blacklist_token(body.refresh_token, ttl=...)

return {...}
```

### 9.3 影响评估

| 维度 | 评估 |
|------|------|
| 严重级别 | Critical |
| 触发条件 | 客户端并发发起两个刷新请求（前端 bug 或重试逻辑） |
| 攻击成本 | 低（无需恶意意图，正常客户端可能触发） |
| 业务后果 | Token 链分裂 → 旧 Token 可继续使用 → 重放攻击窗口 |
| 实际概率 | 中：前端网络抖动重试常见 |

### 9.4 修复方案

**策略**: Redis SETNX 分布式锁，保证同一 Refresh Token 串行处理。

```python
# auth.py refresh_token
# 修复前（行 346-413）：
invalid_exception = HTTPException(401, ...)
try:
    if is_token_blacklisted(body.refresh_token):
        raise invalid_exception
except ...
payload = decode_refresh_token(body.refresh_token)
...
new_access_token = create_access_token(...)
new_refresh_token = create_refresh_token(...)
blacklist_token(body.refresh_token, ...)
return {...}

# 修复后：
import hashlib

invalid_exception = HTTPException(401, ...)

# C-9 修复：Redis SETNX 锁，防止并发刷新同一 Refresh Token
# 作用：原实现无互斥，两个并发请求都通过黑名单检查（都未拉黑），
#       各自签发新 Token，形成两条并行 Token 链，破坏"一次性使用"语义
# 修复：用 Redis SETNX 锁，保证同一 Refresh Token 串行处理
#       第二个请求发现锁存在，说明正在处理，拒绝（409）
#       锁 TTL 30 秒，覆盖正常处理时间（含 DB 查询 + Token 签发）
token_hash = hashlib.sha256(body.refresh_token.encode()).hexdigest()[:16]
refresh_lock_key = f"auth:refresh:lock:{token_hash}"
if not RedisManager.set(refresh_lock_key, "1", ttl=30, nx=True):
    # 已有刷新请求在处理中，拒绝并发刷新
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"error": {"code": "REFRESH_IN_PROGRESS", "message": "刷新请求正在处理中，请勿重复提交"}},
    )

try:
    # 1. 检查黑名单
    try:
        if is_token_blacklisted(body.refresh_token):
            raise invalid_exception
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, ...)

    # 2. 解码 Token
    payload = decode_refresh_token(body.refresh_token)
    if payload is None:
        raise invalid_exception

    user_id_str = payload.get("sub")
    if user_id_str is None:
        raise invalid_exception

    try:
        user_id = int(user_id_str)
    except (ValueError, TypeError):
        raise invalid_exception

    # 3. 检查用户
    user = db.query(User).filter(User.id == user_id).first()
    if user is None or not user.is_active:
        raise invalid_exception

    # 4. 签发新 Token + 拉黑旧 Token
    new_access_token = create_access_token(...)
    new_refresh_token = create_refresh_token(...)
    expires_in = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60

    blacklist_token(
        body.refresh_token,
        ttl=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
    )

    return {...}

finally:
    # C-9: 释放刷新锁（无论成功或失败）
    # 作用：异常时释放锁允许用户重试；成功时旧 Token 已拉黑，
    #       后续相同 Token 的请求会在黑名单检查阶段被拒
    RedisManager.delete(refresh_lock_key)
```

### 9.5 测试用例设计

```python
# tests/test_refresh_token_mutex.py

class TestRefreshTokenMutex:
    """C-9: Token 刷新并发互斥测试"""

    def test_concurrent_refresh_returns_409(self, monkeypatch):
        """并发刷新同一 Token 时第二个返回 409"""
        # 模拟 SETNX 第一次成功，第二次失败
        call_count = [0]
        def fake_set(key, value, ttl=None, nx=False):
            call_count[0] += 1
            return call_count[0] == 1
        monkeypatch.setattr("app.core.redis.RedisManager.set", fake_set)

        # 第一次调用成功
        # 第二次调用应返回 409
        ...

    def test_lock_released_on_success(self, monkeypatch):
        """成功后锁被释放"""
        ...

    def test_lock_released_on_exception(self, monkeypatch):
        """异常时锁被释放"""
        # 模拟 decode_refresh_token 返回 None
        # 验证 finally 中 RedisManager.delete 被调用
        ...

    def test_lock_released_on_redis_failure(self, monkeypatch):
        """Redis 故障时锁行为（SETNX 失败 → 409）"""
        ...
```

### 9.6 风险评估

| 风险点 | 评估 | 缓解措施 |
|--------|------|----------|
| 锁泄漏 | 低：finally 块保证释放；TTL 30 秒兜底 | 双重保障 |
| 正常重试受阻 | 低：锁释放后可立即重试；409 提示前端勿重复 | 前端配合退避 |
| Redis 故障 | 低：SETNX 失败返回 False → 409；可接受（安全优先） | 与 fail-closed 策略一致 |
| 回滚成本 | 低：移除锁逻辑即可 | Git revert |

### 9.7 验证步骤

1. 单元测试：`pytest tests/test_refresh_token_mutex.py -v`
2. 并发测试：用 `asyncio.gather` 并发 2 个相同 refresh_token 请求，确认一个 200 一个 409
3. 异常回归：用无效 refresh_token 请求，确认返回 401 且锁已释放（可立即重试）

---

## 十、C-10: lifespan 无资源清理

### 10.1 问题描述

[main.py:112-113](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/app/main.py#L112) 关闭部分仅打印日志，未关闭 Redis 连接池、DB 连接池、Celery 连接。滚动部署时连接泄漏。

### 10.2 当前代码位置

```python
# main.py 行 110-113
yield  # 应用运行期间

# ===== 关闭时执行 =====
logger.info("👋 应用关闭中...")
# 无任何资源清理
```

### 10.3 影响评估

| 维度 | 评估 |
|------|------|
| 严重级别 | Critical |
| 触发条件 | 应用关闭（滚动部署、重启） |
| 攻击成本 | 无 |
| 业务后果 | 连接泄漏 → 新实例无法获取连接 → 服务启动失败 |
| 实际概率 | 高：每次部署都触发 |

### 10.4 修复方案

**策略**: 在 lifespan 的 yield 后添加 Redis、DB、Celery 连接关闭。

**前置**: 需在 `RedisManager` 添加 `close()` 方法。

```python
# redis.py RedisManager 添加 close 方法
@staticmethod
def close() -> None:
    """
    关闭 Redis 连接池（C-10）

    作用：
        应用关闭时释放 Redis 连接，避免连接泄漏。
        滚动部署时若不关闭，旧实例的连接会残留，耗尽 Redis 最大连接数。
    """
    try:
        redis_pool.disconnect()
        async_redis_pool.disconnect()
        logger.info("Redis 连接池已关闭")
    except Exception as e:
        logger.error(f"关闭 Redis 连接池失败: {e}")
```

```python
# main.py lifespan
# 修复前（行 110-113）：
yield
logger.info("👋 应用关闭中...")

# 修复后：
yield  # 应用运行期间

# ===== 关闭时执行 =====
# C-10 修复：资源清理，避免连接泄漏
# 作用：原实现无清理，滚动部署时 Redis/DB/Celery 连接残留，
#       耗尽连接池导致新实例启动失败
logger.info("👋 应用关闭中...")

# 1. 关闭 Redis 连接池
try:
    from app.core.redis import RedisManager
    RedisManager.close()
except Exception as e:
    logger.error(f"关闭 Redis 失败: {e}")

# 2. 关闭数据库连接池
try:
    from app.core.database import engine
    engine.dispose()
    logger.info("数据库连接池已关闭")
except Exception as e:
    logger.error(f"关闭数据库连接池失败: {e}")

# 3. 关闭 Celery 连接
try:
    from app.tasks.celery_app import celery_app
    celery_app.close()
    logger.info("Celery 连接已关闭")
except Exception as e:
    logger.error(f"关闭 Celery 连接失败: {e}")
```

### 10.5 测试用例设计

```python
# tests/test_lifespan_cleanup.py

class TestLifespanCleanup:
    """C-10: lifespan 资源清理测试"""

    def test_redis_closed_on_shutdown(self, monkeypatch):
        """关闭时 Redis 连接池被关闭"""
        ...

    def test_db_engine_disposed_on_shutdown(self, monkeypatch):
        """关闭时 DB engine 被 dispose"""
        ...

    def test_celery_closed_on_shutdown(self, monkeypatch):
        """关闭时 Celery 连接被关闭"""
        ...

    def test_cleanup_failure_does_not_raise(self, monkeypatch):
        """清理失败不影响其他清理（容错）"""
        ...
```

### 10.6 风险评估

| 风险点 | 评估 | 缓解措施 |
|--------|------|----------|
| 清理失败阻塞关闭 | 低：每个清理独立 try/except | 已隔离 |
| Celery close 方法不存在 | 低：Celery 5.x 支持 `close()` | 验证版本 |
| 回滚成本 | 低：移除清理代码即可 | Git revert |

### 10.7 验证步骤

1. 单元测试：`pytest tests/test_lifespan_cleanup.py -v`
2. 集成测试：启动应用 → 发送 SIGTERM → 查看日志确认三个"已关闭"消息
3. Redis 监控：`redis-cli CLIENT LIST` 确认应用关闭后连接数减少

---

## 十一、C-11: create_all 与 Alembic 并存

### 11.1 问题描述

[main.py:88](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/app/main.py#L88) `Base.metadata.create_all` 可能创建缺少迁移索引（IVFFlat/GIN）的表，导致 schema 漂移。

### 11.2 当前代码位置

```python
# main.py 行 85-89
# 1. 创建数据库表
# 作用：如果表不存在则创建（开发环境用，生产环境用 Alembic 迁移）
# 注意：生产环境建议用 Alembic 管理 schema，此处仅作兜底
Base.metadata.create_all(bind=engine)
logger.info("✅ 数据库表已创建")
```

### 11.3 影响评估

| 维度 | 评估 |
|------|------|
| 严重级别 | Critical |
| 触发条件 | 首次启动（表不存在时） |
| 攻击成本 | 无 |
| 业务后果 | 表结构缺少 IVFFlat 索引 → 向量检索全表扫描 → 性能崩溃 |
| 实际概率 | 高：首次部署必触发 |

### 11.4 修复方案

**策略**: 完全移除 `create_all`，依赖 Alembic 迁移。

**前置**: 需确保部署流程包含 `alembic upgrade head`（Railway 的 release command）。

```python
# main.py lifespan
# 修复前（行 85-89）：
# 1. 创建数据库表
Base.metadata.create_all(bind=engine)
logger.info("✅ 数据库表已创建")

# 修复后：
# C-11 修复：移除 create_all，完全依赖 Alembic 迁移
# 作用：create_all 仅创建表结构，不应用 Alembic 迁移的索引（IVFFlat/GIN），
#       导致向量检索全表扫描；与 Alembic 并存还会造成 schema 漂移
# 修复：删除 create_all，部署流程必须执行 alembic upgrade head
# 配套：Railway release command 配置 "alembic upgrade head && gunicorn ..."
logger.info("ℹ️ 数据库 schema 由 Alembic 管理，请确保部署时执行 alembic upgrade head")

# 可选：开发环境保留 create_all 便于快速启动（生产环境必须移除）
# if settings.DEBUG:
#     Base.metadata.create_all(bind=engine)
#     logger.info("✅ 开发环境：数据库表已创建（生产环境用 Alembic）")
```

**Railway 配置**（[railway.toml](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/railway.toml) 或 Railway Dashboard）:

```toml
# railway.toml
[deploy]
# C-11: 部署前执行迁移
releaseCommand = "alembic upgrade head"
```

### 11.5 测试用例设计

```python
# tests/test_no_create_all.py

class TestNoCreateAll:
    """C-11: 移除 create_all 测试"""

    def test_create_all_not_called_on_startup(self, monkeypatch):
        """启动时不调用 create_all"""
        # 拦截 Base.metadata.create_all，验证未被调用
        ...

    def test_alembic_required_for_schema(self):
        """未执行 Alembic 迁移时表不存在"""
        # 在空数据库上启动应用，确认不自动建表
        ...
```

### 11.6 风险评估

| 风险点 | 评估 | 缓解措施 |
|--------|------|----------|
| 首次部署表不存在 | 高：未执行迁移则启动失败 | Railway release command 强制执行迁移 |
| 开发体验 | 中：每次需手动 alembic upgrade | 保留 DEBUG 模式下的 create_all（可选） |
| 文档需更新 | 低：README 说明部署流程 | 同步更新 H-6 README |
| 回滚成本 | 低：恢复 create_all 即可 | Git revert |

### 11.7 验证步骤

1. 单元测试：`pytest tests/test_no_create_all.py -v`
2. 空数据库测试：在全新 PostgreSQL 实例上启动应用（不执行迁移），确认表不存在且应用不自动建表
3. 迁移流程测试：执行 `alembic upgrade head` 后启动应用，确认正常
4. Railway 部署测试：确认 release command 执行迁移后再启动应用

---

## 十二、修复优先级与依赖关系

### 12.1 推荐修复批次

按"风险×成本"排序，分 4 个批次：

#### 批次 1：低风险高收益（立即修复，1-2 小时）

| 项 | 修复复杂度 | 风险 | 备注 |
|----|-----------|------|------|
| **C-11** | 极低（删一行） | 低 | 配合 Railway release command |
| **C-10** | 低（加清理代码） | 低 | 需新增 RedisManager.close |
| **C-1** | 低（加参数） | 低 | 与 C-8 合并实现 |
| **C-6** | 低（加 strict 参数） | 中 | 调用方需异常处理 |
| **C-7** | 低（改用 exists_strict） | 低 | 与 C-6 同类 |

#### 批次 2：中风险（上线前修复，2-4 小时）

| 项 | 修复复杂度 | 风险 | 备注 |
|----|-----------|------|------|
| **C-8** | 中（流式下载） | 中 | 与 C-1 合并 |
| **C-2** | 低（try/except） | 低 | 流式端点 |
| **C-3** | 低（SQL 原子更新） | 中 | 需排查 ORM 状态 |
| **C-4** | 低（调整顺序） | 低 | 文档删除 |
| **C-5** | 中（先删后插） | 低 | Celery 任务 |

#### 批次 3：复杂修复（上线前修复，4-6 小时）

| 项 | 修复复杂度 | 风险 | 备注 |
|----|-----------|------|------|
| **C-9** | 中（Redis SETNX 锁） | 中 | Token 刷新 |

### 12.2 依赖关系

```
C-1 ──┬──> C-8（同一函数，合并实现）
       │
C-6 ──┴──> C-7（同类 fail-closed 策略，统一测试）

C-10 ──> 需新增 RedisManager.close() 方法

C-11 ──> 需配置 Railway release command

C-2 ──> 无依赖（独立修复）

C-3 ──> 需排查 history_service 是否依赖 conversation.turn_count 内存值

C-4 ──> 无依赖

C-5 ──> 依赖 vector_store.delete_document_chunks（已存在）

C-9 ──> 无依赖
```

### 12.3 测试策略

每个批次完成后执行：
1. **单元测试**: `pytest tests/ -v`（含新增的修复验证测试）
2. **回归测试**: 确认 Phase C 的 45 个测试仍通过
3. **集成测试**: 启动应用，手动验证核心流程（登录、上传、提问、流式）
4. **故障注入**: 对 fail-closed 修复（C-6/C-7），停止 Redis 验证拒绝行为

---

## 十三、整体风险评估

### 13.1 修复后预期效果

| 维度 | 修复前 | 修复后 |
|------|--------|--------|
| 部署就绪度 | 72/100 | 预计 88/100 |
| 安全性 | 82 | 预计 95（SSRF、限流、登录锁定全部修复） |
| 数据一致性 | 70 | 预计 92（事务顺序、幂等性、原子更新全部修复） |
| 运维稳定性 | 65 | 预计 90（资源清理、schema 管理规范化） |

### 13.2 残留风险

修复 11 项 Critical 后，仍有 15 项 High 待处理（详见审查报告）。建议 Critical 修复完成并验证后，再处理 High 级别。

### 13.3 关键阻塞点

- **C-11 配合 Railway**: 必须配置 release command，否则首次部署失败
- **C-6/C-7 Redis 高可用**: fail-closed 策略要求 Redis 稳定，建议 Railway 启用 Redis 持久化
- **C-3 ORM 状态排查**: 需确认 `history_service.maybe_generate_summary` 依赖

---

## 十四、执行检查清单

修复实施时按此清单逐项确认：

- [ ] C-1: parsers.py 添加 `allow_redirects=False` + 重定向检查
- [ ] C-2: chat.py 流式端点 try/except 包裹同步代码
- [ ] C-3: chat.py 3 处 turn_count 改用 SQL 原子更新 + 排查 history_service
- [ ] C-4: documents.py 调整删除顺序（先 commit 再删向量）
- [ ] C-5: document_tasks.py 入库前先 delete_document_chunks
- [ ] C-6: redis.py increment 添加 strict 参数 + 调用方修改
- [ ] C-7: rate_limit.py check_login_lock 改用 exists_strict
- [ ] C-8: parsers.py 流式下载 + 大小限制（与 C-1 合并）
- [ ] C-9: auth.py refresh_token 添加 Redis SETNX 锁
- [ ] C-10: main.py lifespan 添加资源清理 + RedisManager.close 方法
- [ ] C-11: main.py 移除 create_all + Railway release command 配置
- [ ] 新增测试文件：test_ssrf_redirect_protection.py, test_idempotency_lock_release.py, test_turn_count_atomic.py, test_document_delete_order.py, test_vector_ingest_idempotent.py, test_redis_increment_strict.py, test_login_lock_fail_closed.py, test_url_download_size_limit.py, test_refresh_token_mutex.py, test_lifespan_cleanup.py, test_no_create_all.py
- [ ] 全量测试通过：`pytest tests/ -v`
- [ ] 故障注入测试：停止 Redis 验证 fail-closed 行为
- [ ] Railway 部署验证：release command 执行迁移 + 应用正常启动

---

*文档结束。本计划基于 2026-07-09 审查报告，所有代码位置已与当前代码核对。等待用户审阅并授权后开始实施。*
