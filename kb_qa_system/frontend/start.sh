#!/bin/sh
# ============================================
# GeiIt企业知识库 - 前端启动脚本
# ============================================
# 作用：
#   1. 动态设置 nginx 监听端口（兼容 Railway 的 $PORT）
#   2. 用 envsubst 将 BACKEND_URL 替换到 nginx 配置模板中
#
# Railway 会注入 $PORT 环境变量（动态分配），nginx 需要
# 监听该端口才能正确响应健康检查和用户请求。
#
# BACKEND_URL 环境变量：
#   反向代理模式必需，格式：https://your-backend.up.railway.app
#   必须包含协议前缀（http:// 或 https://），不带尾部斜杠
#   未设置时使用默认值（仅用于本地调试，生产环境必须配置）
# ============================================

# 如果 $PORT 未设置，默认使用 80
PORT=${PORT:-80}

# 后端服务地址（反代模式必需）
# 格式：https://your-backend.up.railway.app
BACKEND_URL=${BACKEND_URL:-https://localhost:8000}

# 1. 用 envsubst 替换 nginx 模板中的 ${BACKEND_URL} 变量
# 作用：将 nginx.conf.template 中的 ${BACKEND_URL} 替换为实际后端地址
# 注意：envsubst 的变量白名单参数避免误替换 nginx 内置变量（如 $host, $remote_addr）
envsubst '${BACKEND_URL}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

# 2. 替换 nginx 配置中的监听端口
# 作用：Railway 动态分配端口，nginx 必须监听该端口
sed -i "s/listen 80;/listen $PORT;/" /etc/nginx/conf.d/default.conf

echo "nginx listening on port $PORT, backend proxy: $BACKEND_URL"

# 3. 启动 nginx（前台运行）
exec nginx -g 'daemon off;'
