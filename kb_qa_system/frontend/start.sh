#!/bin/sh
# ============================================
# GeiIt企业知识库 - 前端启动脚本
# ============================================
# 作用：
#   动态设置 nginx 监听端口，兼容 Railway 的 $PORT 环境变量
#
# Railway 会注入 $PORT 环境变量（动态分配），nginx 需要
# 监听该端口才能正确响应健康检查和用户请求。
# ============================================

# 如果 $PORT 未设置，默认使用 80
PORT=${PORT:-80}

# 替换 nginx 配置中的监听端口
sed -i "s/listen 80;/listen $PORT;/" /etc/nginx/conf.d/default.conf

echo "nginx listening on port $PORT"

# 启动 nginx（前台运行）
exec nginx -g 'daemon off;'