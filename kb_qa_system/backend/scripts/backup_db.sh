#!/bin/bash
# ============================================
# GeiIt企业知识库 - PostgreSQL 数据库备份脚本（D7-01）
# ============================================
# 作用：
#     使用 pg_dump 导出数据库，压缩存储到指定目录，
#     自动清理超过保留数量的旧备份。
#
# 使用方式：
#     ./backup_db.sh
#     建议通过 cron 定时调用（如每日凌晨 02:00）：
#     0 2 * * * /path/to/backup_db.sh >> /var/log/db_backup.log 2>&1
#
# 环境变量：
#     DATABASE_URL          - PostgreSQL 连接字符串（必填）
#                             格式：postgresql+psycopg://user:pass@host:port/dbname
#                             或标准格式：postgresql://user:pass@host:port/dbname
#     BACKUP_DIR            - 备份存储目录（可选，默认 ./backups）
#     BACKUP_RETENTION_COUNT - 保留的备份份数（可选，默认 7）
# ============================================

set -euo pipefail

# ============================================
# 配置项
# ============================================

# 备份目录（可通过环境变量覆盖）
BACKUP_DIR="${BACKUP_DIR:-./backups}"

# 保留份数（可通过环境变量覆盖）
BACKUP_RETENTION_COUNT="${BACKUP_RETENTION_COUNT:-7}"

# 检查 DATABASE_URL
if [ -z "${DATABASE_URL:-}" ]; then
    echo "❌ 错误：DATABASE_URL 环境变量未设置"
    echo "   请设置 DATABASE_URL=postgresql://user:pass@host:port/dbname"
    exit 1
fi

# ============================================
# 从 DATABASE_URL 解析连接参数
# ============================================
# 作用：将 postgresql+psycopg:// 或 postgresql:// 格式的 URL
#       解析为 pg_dump 可用的连接参数

# 移除 +psycopg 后缀（如有）
DB_URL="${DATABASE_URL/postgresql+psycopg/postgresql}"

# 解析 URL 各部分
DB_PROTO=$(echo "$DB_URL" | sed -n 's/^\(.*\)\/\/.*/\1/p')
DB_USERPASS=$(echo "$DB_URL" | sed -n 's#^.*//\([^@]*\)@.*#\1#p')
DB_HOSTPORT=$(echo "$DB_URL" | sed -n 's#^.*@\([^/]*\)/.*#\1#p')
DB_NAME=$(echo "$DB_URL" | sed -n 's#^.*/\([^?]*\).*$#\1#p')

# 分离用户和密码
DB_USER=$(echo "$DB_USERPASS" | cut -d: -f1)
DB_PASS=$(echo "$DB_USERPASS" | cut -d: -f2)

# 分离主机和端口
DB_HOST=$(echo "$DB_HOSTPORT" | cut -d: -f1)
DB_PORT=$(echo "$DB_HOSTPORT" | cut -d: -f2)
[ -z "$DB_PORT" ] && DB_PORT=5432

echo "📋 数据库备份配置："
echo "   主机: $DB_HOST:$DB_PORT"
echo "   数据库: $DB_NAME"
echo "   用户: $DB_USER"
echo "   备份目录: $BACKUP_DIR"
echo "   保留份数: $BACKUP_RETENTION_COUNT"
echo ""

# ============================================
# 创建备份目录
# ============================================
mkdir -p "$BACKUP_DIR"

# 生成备份文件名（含时间戳）
BACKUP_FILE="$BACKUP_DIR/kb_qa_backup_$(date +%Y%m%d_%H%M%S).dump"

echo "🔄 开始备份数据库..."

# ============================================
# 执行 pg_dump
# ============================================
# 使用自定义格式 -Fc（支持选择性恢复和压缩）
# PGPASSWORD 环境变量传递密码（避免命令行暴露）
export PGPASSWORD="$DB_PASS"

pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -Fc \
    --no-owner \
    --no-privileges \
    -f "$BACKUP_FILE"

unset PGPASSWORD

# 检查备份文件
if [ -f "$BACKUP_FILE" ]; then
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "✅ 备份成功: $BACKUP_FILE ($BACKUP_SIZE)"
else
    echo "❌ 备份失败：文件未生成"
    exit 1
fi

# ============================================
# 清理旧备份（D7-02 保留策略）
# ============================================
echo "🧹 清理旧备份（保留最近 $BACKUP_RETENTION_COUNT 份）..."

# 按修改时间倒序列出备份文件，跳过最新的 N 份，删除其余
ls -t "$BACKUP_DIR"/kb_qa_backup_*.dump 2>/dev/null | \
    tail -n +$((BACKUP_RETENTION_COUNT + 1)) | \
    while read -r old_file; do
        rm -f "$old_file"
        echo "   已删除: $(basename "$old_file")"
    done

# ============================================
# 可选：上传到外部存储（D7-03 灾备）
# ============================================
# 如需上传到 S3/对象存储，取消注释并配置以下脚本：
#
# if [ -n "${S3_BUCKET:-}" ]; then
#     echo "📤 上传到 S3..."
#     aws s3 cp "$BACKUP_FILE" "s3://$S3_BUCKET/db-backups/"
#     echo "✅ S3 上传完成"
# fi

echo ""
echo "🎉 数据库备份完成！"
echo "   当前备份数: $(ls -1 "$BACKUP_DIR"/kb_qa_backup_*.dump 2>/dev/null | wc -l)"
