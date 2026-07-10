# GeiIt企业知识库 - 监控系统

> 基于 Prometheus + Grafana 的全链路监控方案，覆盖 HTTP 服务、RAG 链路、LLM 性能、服务质量、文档处理五大维度。

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                      FastAPI 应用                            │
│  ┌──────────────────┐  ┌──────────────────────────────┐    │
│  │ PrometheusMiddleware│ │ rag_chain.py 6处埋点 + chat.py 2处│    │
│  │ (HTTP层自动采集)  │  │ (RAG链路主动埋点)             │    │
│  └────────┬─────────┘  └────────────┬─────────────────┘    │
│           │                          │                       │
│           └──────────┬───────────────┘                       │
│                      ▼                                       │
│              /metrics 端点 (PlainText)                       │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP GET (15s 间隔)
                       ▼
              ┌─────────────────┐
              │   Prometheus    │  指标采集 + 告警评估
              │   (port 9090)   │
              └────────┬────────┘
                       │ PromQL 查询
                       ▼
              ┌─────────────────┐
              │     Grafana     │  可视化面板
              │  (port 3001)    │
              └─────────────────┘
```

## 快速启动

### 1. 启用 Prometheus 指标采集

在 `backend/.env` 中设置：

```bash
ENABLE_PROMETHEUS=true
```

### 2. 启动监控栈

监控栈需与主服务一起启动（共享 Docker 网络）：

```bash
# 在 kb_qa_system 目录下执行
docker-compose -f docker-compose.yml -f monitoring/docker-compose.monitoring.yml up -d
```

### 3. 访问监控面板

| 服务         | 地址                      | 账号         |
| ------------ | ------------------------- | ------------ |
| Prometheus   | http://localhost:9090     | 无需认证     |
| Grafana      | http://localhost:3001     | admin/admin  |

Grafana 启动后会自动加载 "RAG 监控" 文件夹下的仪表盘。

### 4. 验证指标采集

```bash
# 直接访问应用 /metrics 端点
curl http://localhost:8000/metrics

# 在 Prometheus 中检查 target 状态
# 访问 http://localhost:9090/targets，kb_qa_api 应显示 UP
```

## 监控指标清单

### HTTP 层指标（中间件自动采集）

| 指标名                              | 类型      | 说明                     |
| ----------------------------------- | --------- | ------------------------ |
| `http_requests_total`               | Counter   | 请求总数（method/endpoint/status）|
| `http_request_duration_seconds`     | Histogram | 请求延迟分布             |
| `http_requests_in_progress`         | Gauge     | 当前在途请求数           |

### RAG 链路指标（rag_chain.py 主动埋点）

| 指标名                              | 类型      | 说明                     |
| ----------------------------------- | --------- | ------------------------ |
| `rag_questions_total`               | Counter   | 问答总数（intent_type/stream）|
| `rag_total_duration_seconds`        | Histogram | 端到端耗时（按意图类型） |
| `rag_retrieval_duration_seconds`    | Histogram | 检索耗时                 |
| `rag_retrieval_results_count`       | Histogram | 检索结果数分布           |
| `rag_retrieval_top_score`           | Histogram | 检索最高分分布           |
| `rag_llm_duration_seconds`          | Histogram | LLM 生成耗时             |
| `rag_llm_tokens_total`              | Counter   | Token 消耗（input/output）|
| `rag_llm_retries_total`             | Counter   | LLM 重试次数             |
| `rag_degradation_total`             | Counter   | 降级响应（按原因）       |
| `rag_validation_skipped_total`      | Counter   | 预生成校验拦截次数       |
| `rag_conflict_detected_total`       | Counter   | 矛盾检测命中次数         |

### 文档处理指标

| 指标名                              | 类型      | 说明                     |
| ----------------------------------- | --------- | ------------------------ |
| `document_uploads_total`            | Counter   | 文档上传总数（按类型）   |
| `document_processing_duration_seconds` | Histogram | 文档处理耗时          |
| `document_chunks_created_total`     | Counter   | 文档分块创建总数         |

### 系统信息指标

| 指标名              | 类型 | 说明                   |
| ------------------- | ---- | ---------------------- |
| `kb_qa_system_info` | Info | 应用版本/环境/名称信息 |

## 仪表盘面板说明

Grafana 仪表盘 `rag_dashboard.json` 包含 6 大区块、30+ 面板：

### 📡 HTTP 服务概览
- 请求总速率、在途请求数、5xx 错误率、平均响应时间
- 请求速率趋势（按端点）
- 响应时间 P95/P50（按端点）

### 🤖 RAG 问答概览
- 问答总速率、累计总数
- 问答速率趋势（按意图类型，堆叠图）
- 流式/非流式占比、意图类型占比（环形图）
- 端到端耗时 P95/P50（按意图类型）

### 🔍 检索性能
- 检索耗时 P95/P50
- 检索结果数分布
- 检索 Top Score 分布
- 检索平均最高分（质量指标，条形仪表盘）

### ⚡ LLM 生成性能
- LLM 生成耗时 P95/P50
- Token 消耗速率（tokens/min，输入/输出堆叠）
- LLM 重试速率
- Token 累计消耗

### 🛡️ 服务质量与降级
- 服务降级率（仪表盘）
- 降级原因分布（环形图）
- 预生成校验拦截总数/率
- 矛盾检测命中总数/趋势
- 降级趋势（按原因，堆叠图）

### 📄 文档处理
- 文档上传累计、分块累计
- 文档上传速率（按类型）
- 文档处理耗时 P95/P50

## 告警规则

告警规则定义在 `alerts.yml`，共 4 组 8 条告警：

| 告警组           | 告警名                   | 触发条件                          | 级别     |
| ---------------- | ------------------------ | --------------------------------- | -------- |
| http_health      | HighErrorRate            | 5xx 错误率 > 10%（持续 2m）       | critical |
| http_health      | ServiceDown              | 服务不可用（持续 1m）             | critical |
| rag_performance  | HighRAGLatency           | RAG P99 > 30s（持续 5m）          | warning  |
| rag_performance  | HighRetrievalLatency     | 检索 P95 > 5s（持续 5m）          | warning  |
| rag_performance  | HighLLMLatency           | LLM P95 > 20s（持续 5m）          | warning  |
| rag_quality      | HighDegradationRate      | 降级率 > 30%（持续 5m）           | critical |
| rag_quality      | CircuitBreakerTripping   | 熔断触发频率 > 0.1/s（持续 2m）   | critical |
| rag_quality      | HighValidationSkipRate   | 校验拦截率 > 50%（持续 10m）      | warning  |
| rag_quality      | LowRetrievalQuality      | 平均 Top Score < 0.5（持续 10m）  | warning  |
| resource_usage   | HighTokenUsage           | Token 消耗 > 100K/h（持续 10m）   | warning  |
| resource_usage   | HighConcurrentRequests   | 在途请求 > 100（持续 2m）         | warning  |

### 配置告警通知（Alertmanager）

告警当前仅在 Prometheus UI 显示。如需邮件/钉钉/Slack 通知，需部署 Alertmanager：

```bash
# 1. 在 docker-compose.monitoring.yml 中添加 alertmanager 服务
# 2. 在 prometheus.yml 中配置 alerting.alertmanagers
# 3. 创建 alertmanager.yml 配置通知渠道
```

## 安全配置

### 生产环境安全加固

```bash
# 1. 启用 /metrics 端点 Basic Auth
PROMETHEUS_AUTH_ENABLED=true
PROMETHEUS_AUTH_USER=prometheus
PROMETHEUS_AUTH_PASSWORD=<强密码>

# 2. 修改 Grafana 管理员密码
GF_SECURITY_ADMIN_PASSWORD=<强密码>

# 3. 关闭 Grafana 匿名访问
GF_AUTH_ANONYMOUS_ENABLED=false

# 4. 关闭路径标签（降低 label 基数，防内存爆炸）
PROMETHEUS_INCLUDE_PATH_LABEL=false
```

## 文件结构

```
monitoring/
├── README.md                              # 本说明文档
├── prometheus.yml                         # Prometheus server 配置
├── alerts.yml                             # 告警规则
├── docker-compose.monitoring.yml          # 监控栈容器编排
└── grafana/
    ├── provisioning/
    │   ├── datasources/
    │   │   └── datasource.yml             # Prometheus 数据源自动配置
    │   └── dashboards/
    │       └── dashboard.yml              # 仪表盘 provider 配置
    └── dashboards/
        └── rag_dashboard.json             # RAG 监控仪表盘 JSON
```

## 常见问题

### Q: Prometheus target 显示 DOWN？

- 检查 api 服务是否正常运行：`docker-compose ps`
- 检查 api 容器是否在同一个 Docker 网络：`docker network inspect kb_qa_system_default`
- 检查 `ENABLE_PROMETHEUS` 是否设为 `true`
- 在 api 容器内测试：`curl http://api:8000/metrics`

### Q: Grafana 没有显示仪表盘？

- 检查 `grafana/dashboards/` 目录是否正确挂载
- 查看 Grafana 日志：`docker-compose logs grafana`
- 手动刷新 provisioning：`curl -X POST http://admin:admin@localhost:3001/api/admin/provisioning/dashboards/reload`

### Q: 指标 label 基数过高导致内存增长？

- 关闭路径标签：`PROMETHEUS_INCLUDE_PATH_LABEL=false`
- 中间件已自动将 `/conversations/123` 模板化为 `/conversations/{id}`，避免高基数

### Q: 如何在生产环境只监控关键指标？

- 在 Railway 上设置 `ENABLE_PROMETHEUS=true` 即可启用
- Prometheus 通过公网抓取需配置 `PROMETHEUS_AUTH_ENABLED=true` 保护端点
- 可在 `prometheus.yml` 中调整 `scrape_interval` 降低采集频率
