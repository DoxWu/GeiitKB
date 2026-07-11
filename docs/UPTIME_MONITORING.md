# GeiIt企业知识库 — 外部 Uptime 监控配置指南

> **文档日期**：2026-07-11
> **适用范围**：GeiIt企业知识库生产环境
> **关联文档**：[事故响应手册](RUNBOOK.md)、[部署指南](RAILWAY_DEPLOYMENT_GUIDE.md)

---

## 一、为什么需要外部 Uptime 监控

项目已有内部健康检查（`/health`）和 Prometheus 监控，但这些都在 Railway 平台内部运行。如果 Railway 平台本身或网络出问题，内部监控无法告警。外部 Uptime 监控服务从独立网络探测服务可用性，是监控体系的最后一道防线。

---

## 二、UptimeRobot 配置步骤（E6-02）

### 2.1 注册账号

1. 访问 [UptimeRobot](https://uptimerobot.com/)
2. 注册免费账号（免费版支持 50 个监控器，5 分钟检查间隔）

### 2.2 配置监控器

#### 监控器 1：前端可用性

| 配置项 | 值 |
|--------|-----|
| Monitor Type | HTTP(s) |
| Friendly Name | GeiIt前端 |
| URL | `https://<frontend-domain>.up.railway.app/` |
| Monitoring Interval | 5 minutes |

#### 监控器 2：后端健康检查

| 配置项 | 值 |
|--------|-----|
| Monitor Type | HTTP(s) |
| Friendly Name | GeiIt后端API |
| URL | `https://<backend-domain>.up.railway.app/health` |
| Monitoring Interval | 5 minutes |
| Keyword (可选) | `healthy`（期望响应中包含此关键词） |

#### 监控器 3：后端 API 可用性（需认证端点）

| 配置项 | 值 |
|--------|-----|
| Monitor Type | HTTP(s) - Keyword |
| Friendly Name | GeiIt API Docs |
| URL | `https://<backend-domain>.up.railway.app/docs` |
| Monitoring Interval | 5 minutes |
| Keyword | `Swagger` 或 `OpenAPI` |

### 2.3 配置告警通知

#### 邮件通知

1. 在 UptimeRobot → My Settings → Alert Contacts 添加邮箱
2. 为每个监控器勾选该邮箱联系人

#### Telegram 通知（推荐，更及时）

1. 在 Telegram 中搜索 `@UptimeRobotBot`
2. 发送 `/start` 获取 API Key
3. 在 UptimeRobot → My Settings → Alert Contacts → Add Alert Contact → Telegram
4. 粘贴 API Key
5. 为每个监控器勾选 Telegram 联系人

#### Webhook 通知（可选）

如需将告警推送到企业微信群或飞书群，配置 Webhook：
1. UptimeRobot → My Settings → Alert Contacts → Add Alert Contact → Webhook
2. 填入企业微信/飞书机器人的 Webhook URL

### 2.4 配置告警规则

| 规则 | 配置 |
|------|------|
| 告警触发 | 连续 2 次检测失败（避免误报，约 10 分钟）|
| 恢复通知 | 检测成功后立即通知 |
| 维护窗口 | 部署期间可设置暂停监控（最多 60 分钟/天）|

### 2.5 配置状态页（可选）

UptimeRobot 提供公开状态页功能：
1. UptimeRobot → Status Pages → Create Status Page
2. 添加所有监控器
3. 自定义状态页 URL（如 `status.geiit.example.com`）
4. 可在项目帮助页面链接到状态页

---

## 三、监控覆盖建议

| 监控目标 | URL | 检查间隔 | 告警条件 |
|----------|-----|----------|----------|
| 前端首页 | `https://<frontend>/` | 5 min | HTTP 非 200 |
| 后端健康检查 | `https://<backend>/health` | 5 min | 非 200 或无 "healthy" |
| API 文档 | `https://<backend>/docs` | 5 min | 非 200 |
| 静态资源 CDN | `https://<frontend>/assets/` | 15 min | HTTP 非 200 |

---

## 四、与其他监控的协作

```
UptimeRobot（外部）     ←→    Alertmanager（内部）
     │                              │
     │  独立网络探测                  │  指标阈值告警
     │  覆盖平台级故障                │  覆盖应用级故障
     ↓                              ↓
     邮件/Telegram 告警         邮件告警
```

- **UptimeRobot**：探测服务是否可从外部访问，发现平台级故障
- **Prometheus + Alertmanager**：监控应用内部指标，发现性能和资源问题
- 两者互补，不重叠

---

## 五、维护建议

1. **每月检查**：确认所有监控器状态正常，无误报告警
2. **域名变更后**：及时更新 UptimeRobot 中的 URL
3. **告警联系人变更后**：及时更新 Alert Contacts
4. **季度演练**：手动停止服务，验证 UptimeRobot 是否在预期时间内告警

---

## 六、替代方案

如果 UptimeRobot 不满足需求，可考虑：

| 服务 | 免费额度 | 优势 |
|------|----------|------|
| UptimeRobot | 50 监控器 / 5 min | 简单易用，中文友好 |
| Pingdom | 1 监控器 | 企业级，报告详细 |
| BetterUptime | 10 监控器 | 含 on-call 排班 |
| 自建 Prometheus Blackbox Exporter | 无限 | 完全自控，需维护 |
