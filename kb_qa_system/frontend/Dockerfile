# ============================================
# GeiIt企业知识库 - 前端 Dockerfile（生产版）
# ============================================
# 作用：
#     构建前端静态资源镜像，通过 nginx 提供服务。
#     支持 SPA 路由回退、静态资源缓存和安全头。
#
# 构建方法：
#     docker build -t kb-qa-frontend ./frontend
#     带自定义 API 地址：docker build --build-arg VITE_API_BASE_URL=https://api.example.com/api/v1 -t kb-qa-frontend ./frontend
#
# 运行方法：
#     docker run -p 80:80 kb-qa-frontend
#
# 设计要点：
#     1. 多阶段构建：node 编译 → nginx 运行，最终镜像仅含静态文件
#     2. 前端通过 VITE_API_BASE_URL 访问后端（跨域，依赖后端 CORS）
#     3. nginx 配置 SPA 回退（所有路由指向 index.html）
#
# v2: 清除 Railway 构建缓存，确保最新构建生效
# ============================================

# --------------------------------------------
# 阶段 1：构建阶段（编译前端静态资源）
# --------------------------------------------
FROM node:20-slim AS builder

ENV NPM_CONFIG_LOGLEVEL=warn

WORKDIR /app

# 先复制依赖文件，利用 Docker 层缓存
COPY package.json package-lock.json* ./

# 安装依赖（--legacy-peer-deps 兼容 vite 6 的 peer dep 变更）
# v4: 添加 --no-cache 强制重新下载，解决 Railway 缓存问题
RUN npm ci --legacy-peer-deps --no-cache || npm install --legacy-peer-deps --no-cache

# 复制源码
COPY . .

# 构建时注入 API 基础地址
# 默认同源 /api/v1（配合 nginx 反代使用）
# Railway 部署：设为后端服务的公网 URL，如 https://your-backend.up.railway.app/api/v1
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ARG VITE_APP_TITLE=GeiIt企业知识库
ENV VITE_APP_TITLE=${VITE_APP_TITLE}

# 构建生产版本
RUN npm run build

# --------------------------------------------
# 阶段 2：运行阶段（nginx 提供静态服务）
# --------------------------------------------
FROM nginx:1.25-alpine AS runtime

LABEL maintainer="kb-qa-system"
LABEL description="GeiIt企业知识库前端（React + nginx）"

# 安装 curl 用于健康检查
RUN apk add --no-cache curl

# 复制自定义 nginx 配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 限制 nginx worker 数量为 1（Railway 容器资源有限）
# 默认 auto 模式会根据宿主机 CPU 核心数启动 worker，可能导致内存耗尽
RUN sed -i 's/worker_processes.*;/worker_processes 1;/' /etc/nginx/nginx.conf

# 从构建阶段复制静态资源到 nginx 服务目录
COPY --from=builder /app/dist /usr/share/nginx/html

# 暴露端口
EXPOSE 80

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost/ || exit 1

# nginx 启动（使用官方镜像入口点）
CMD ["nginx", "-g", "daemon off;"]
