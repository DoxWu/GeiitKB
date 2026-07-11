# 变更日志 — GeiIt企业知识库

> 本文档记录 GeiIt企业知识库 项目的所有显著变更。
> 格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
> 版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

---

## [Unreleased]

### Added — P3 改进批次1（文档/配置类）

- **E2-01**：集成 `rollup-plugin-visualizer`，支持 `ANALYZE=true npm run build` 生成 bundle 体积分析报告
- **E3-05**：新增 `CONTRIBUTING.md` 贡献指南和 `CHANGELOG.md` 变更日志
- **E4-03**：后端新增 `/api/csp-report` 端点接收 CSP 违规报告；nginx CSP 添加 `report-uri` 指令

### Added — P3 改进批次2（前端用户体验类）

- **E5-01**：新增 `ChatMessageSkeleton` 和 `SettingsSkeleton` 骨架屏组件，覆盖聊天和设置页加载态
- **E5-02**：新增 `OfflineIndicator` 组件，监听 `navigator.onLine` 状态，离线时顶部提示、上线时 Toast 通知
- **E5-03**：新增 `useUnsavedChanges` hook，通过 `beforeunload` 事件防止表单未保存时意外离开
- **E5-04**：列表虚拟化评估完成（结论：暂不需要，单用户文档 < 100 条 + 分页 pageSize=20）

### Added — P3 改进批次3（后端监控/安全类）

- **E2-02**：Prometheus 新增 DB 连接池指标（`db_pool_size`、`db_pool_checked_out`、`db_pool_overflow`），中间件每请求采集
- **E2-03**：Prometheus 新增 Redis 缓存命中率指标（`redis_cache_hits_total`、`redis_cache_misses_total`），`RedisManager.get()` 自动记录
- **E1-03**：统一限流中间件 `RateLimitMiddleware`，对未配置路由级限流的端点应用默认限流（60次/分钟），fail-open 策略
- **E4-04**：密钥轮换策略文档 `KEY_ROTATION_STRATEGY.md`（JWT Multi-Secret 轮换方案、数据库/Redis/LLM 密钥轮换步骤、应急轮换流程）

### Added — P3 改进批次4（高难度项）

- **E1-04**：WebSocket 实时通知系统
  - 后端：`/ws/notifications?token=<JWT>` 端点，JWT 认证后订阅 Redis Pub/Sub 频道，`publish_notification()` 函数供其他服务调用
  - 前端：`useNotification` hook，自动连接 WebSocket、指数退避重连（1s→30s）、按通知类型映射 Toast
- **E6-01**：日志聚合方案（Loki + Promtail）
  - `loki-config.yml`：Loki 配置（文件系统存储、7天保留、高基数标签防护）
  - `promtail.yml`：Promtail 配置（Docker socket 自动发现 `kb_qa_*` 容器、JSON 日志解析、level 标签提取）
  - `docker-compose.monitoring.yml` 新增 Loki + Promtail 服务
  - Grafana 数据源自动配置新增 Loki（`datasource.yml`）
  - `monitoring/README.md` 新增日志聚合章节（架构图、LogQL 查询示例、验证步骤、FAQ）

### Changed — P3 改进批次1

- **E3-03**：为 6 处 `eslint-disable react-hooks/exhaustive-deps` 添加详细原因注释（ChatPage 2处、DocumentsPage 3处、SearchBar 1处），说明 mount-once / URL 参数同步模式无法移除抑制的原因

### Changed — P3 改进批次2

- `App.tsx` 集成 `OfflineIndicator` 和 `useNotification`，全局生效
- `RegisterApplyForm.tsx` 集成 `useUnsavedChanges`，表单未保存时提示

## [0.9.0] - 2026-07-11

### Added — P1/P2 改进

- **E1-01**：GitHub Actions CI/CD 流水线（backend-test + frontend-test + frontend-build 三个 job）
- **E1-02**：Railway `railway.json` 补全 `releaseCommand = "alembic upgrade head"`，entrypoint.sh 支持 `MIGRATE_ON_STARTUP` 环境变量
- **E3-01**：前端核心页面测试（LoginPage 7 tests、DocumentsPage 9 tests、SettingsPage 16 tests）
- **E3-02**：后端 `pyproject.toml` 配置 pytest-cov 覆盖率阈值 `fail_under = 60`；前端 vitest.config.ts 移除 pages 排除
- **E3-04**：根目录 `README.md` 项目入口文档（技术栈、项目结构、快速开始、文档索引）
- **E4-01**：Dependabot 依赖漏洞自动扫描（pip + npm + github-actions 三种生态）
- **E4-02**：修复 passlib 1.7.4 与 bcrypt 4.x 兼容性问题，固定 `bcrypt==4.0.1`
- **E4-05**：nginx 安全头补全（HSTS `Strict-Transport-Security` + `Permissions-Policy`）
- **E6-02**：UptimeRobot 外部监控配置指南（前端/后端健康检查/API 文档 3 个监控器）
- **E6-03**：自动化备份验证脚本 `verify_backup.sh`（临时数据库恢复 + 表行数校验 + pgvector 索引校验）
- **E6-04**：Runbook 事故响应手册（P0-P3 故障分级、6 种常见故障处理、应急操作手册、复盘模板）

### Added — 十维度审查改进（29 项）

- **D1-01**：文档分支管理（后端 CRUD 端点 + 前端 Sidebar 分支树）
- **D2-01**：后端全文检索（PostgreSQL tsvector + GIN 索引）
- **D2-02**：前端搜索高亮函数 `highlight.tsx`
- **D2-03**：搜索历史下拉 + 点击外部关闭
- **D3-01**：CSP 内容安全策略
- **D4-02**：游标分页（cursor-based pagination）
- **D5-01**：IME 中文输入法搜索误触发修复
- **D5-02**：文档处理状态轮询
- **D5-03**：上传取消功能
- **D5-04**：暗色模式切换
- **D6-01/D6-02**：Alertmanager 告警配置
- **D7-01/D7-02**：数据库备份/恢复脚本 + 保留策略
- **D8-01**：前端 Dockerfile + Railway 配置
- **D9-01**：Railway healthcheckPath 配置
- **D10-01**：审计日志模型
- **D10-02**：前端帮助页面
- **D10-03**：Celery 定时清理任务
- **D10-04**：统计仪表盘 + URL 导入 UI

### Added — 邮件系统

- Resend SMTP 邮件服务集成（SSL 加密 smtp.resend.com:465）
- 注册申请审批流程（6 个端点：apply/status/set-password + admin approve/reject/list）
- 四种邮件模板（注册通知、密码设置、审批通过、审批拒绝）
- 密码设置令牌安全（`secrets.token_urlsafe(32)` 256-bit 熵、SHA-256 哈希存储、一次性使用、24小时过期）

### Security — Critical/High/Medium 修复

- **C-1 ~ C-11**：11 项 Critical 级安全修复（SSRF 重定向防护、流式幂等锁释放、turn_count 原子更新、文档删除顺序、向量入库幂等、Redis increment strict 模式、登录锁 fail-closed、URL 下载大小限制、Token 刷新并发互斥、lifespan 资源清理、移除 create_all）
- **H-2 ~ H-15**：14 项 High 级修复（非流式幂等锁、分布式锁 UUID+Lua CAS、TOCTOU 修复、事务边界、错误信息脱敏、Celery 状态脱敏、限流标识符等）
- **M-1 ~ M-24 + L-1 ~ L-16**：40 项 Medium/Low 级修复

### Fixed

- 修复 API 路径不对齐问题（前端 DOCUMENT_URL vs 后端 /documents/import-url）
- 修复密码强度校验、分页参数校验、提问内容校验
- 修复 8 处前端 Mock API 切换为真实后端调用

---

## 版本号说明

| 版本类型 | 含义 | 示例 |
|----------|------|------|
| MAJOR | 不兼容的 API/架构变更 | 1.0.0（首个正式版） |
| MINOR | 向后兼容的新功能 | 0.9.0 |
| PATCH | 向后兼容的 bug 修复 | 0.9.1 |

---

## 变更类型说明

| 类型 | 含义 |
|------|------|
| Added | 新增功能 |
| Changed | 对现有功能的变更 |
| Deprecated | 即将移除的功能 |
| Removed | 已移除的功能 |
| Fixed | bug 修复 |
| Security | 安全修复 |
