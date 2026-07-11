#!/bin/bash
# ============================================
# GeiIt企业知识库 - PostgreSQL 数据库恢复脚本（D7-02）
# ============================================
# 作用：
#     从指定的 pg_dump 备份文件恢复数据库。
#     使用 pg_restore 恢复自定义格式（-Fc）的备份。
#
# 使用方式：
#     ./restore_db.sh <backup_file>
#     ./restore_db.sh ./backups/kb_qa_backup_20260711_020000.dump
#
# ⚠️ 警告：
#     恢复操作会覆盖目标数据库中的现有数据！
#     请在执行前确认：
#     1. 已停止应用服务（避免恢复期间有新写入）
#     2. 目标数据库已存在（如不存在需先 createdb）
#     3. 已备份当前数据（如需要）
#
# 环境变量：
#     DATABASE_URL - PostgreSQL 连接字符串（必填）
# ============================================

set -euo pipefail

# ============================================
# 参数检查
# ============================================

BACKUP_FILE="${1:-}"

if [ -z "$BACKUP_FILE" ]; then
    echo "❌ 错误：未指定备份文件"
    echo "   使用方式: ./restore_db.sh <backup_file>"
    echo "   示例:     ./restore_db.sh ./backups/kb_qa_backup_20260711_020000.dump"
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ 错误：备份文件不存在: $BACKUP_FILE"
    exit 1
fi

# 检查 DATABASE_URL
if [ -z "${DATABASE_URL:-}" ]; then
    echo "❌ 错误：DATABASE_URL 环境变量未设置"
    exit 1
fi

# ============================================
# 从 DATABASE_URL 解析连接参数
# ============================================
DB_URL="${DATABASE_URL/postgresql+psycopg/postgresql}"

DB_USERPASS=$(echo "$DB_URL" | sed -n 's#^.*//\([^@]*\)@.*#\1#p')
DB_HOSTPORT=$(echo "$DB_URL" | sed -n 's#^.*@\([^/]*\)/.*#\1#p')
DB_NAME=$(echo "$DB_URL" | sed -n 's#^.*/\([^?]*\).*$#\1#p')

DB_USER=$(echo "$DB_USERPASS" | cut -d: -f1)
DB_PASS=$(echo "$DB_USERPASS" | cut -d: -f2)
DB_HOST=$(echo "$DB_HOSTPORT" | cut -d: -f1)
DB_PORT=$(echo "$DB_HOSTPORT" | cut -d: -f2)
[ -z "$DB_PORT" ] && DB_PORT=5432

echo "⚠️  警告：即将从备份恢复数据库！"
echo "   备份文件: $BACKUP_FILE"
echo "   目标数据库: $DB_HOST:$DB_PORT/$DB_NAME"
echo ""
echo "   此操作将覆盖目标数据库中的现有数据！"
echo ""

# 确认提示
read -p "确认要继续恢复吗？(输入 yes 继续): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "已取消恢复操作。"
    exit 0
fi

echo ""
echo "🔄 开始恢复数据库..."

# ============================================
# 执行 pg_restore
# ============================================
export PGPASSWORD="$DB_PASS"

# --clean: 恢复前删除现有对象
# --if-exists: 避免 DROP 不存在的对象报错
# --no-owner: 不恢复对象所有权
# --no-privileges: 不恢复权限设置
pg_restore \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --verbose \
    "$BACKUP_FILE" 2>&1 | tail -20

RESTORE_EXIT=${PIPESTATUS[0]}
unset PGPASSWORD

if [ $RESTORE_EXIT -eq 0 ]; then
    echo ""
    echo "✅ 数据库恢复成功！"
    echo "   恢复来源: $BACKUP_FILE"
    echo "   目标数据库: $DB_HOST:$DB_PORT/$DB_NAME"
    echo ""
    echo "建议："
    echo "   1. 检查应用是否能正常访问数据"
    echo "   2. 如有 Alembic 迁移，执行 alembic current 确认迁移版本"
    echo "   3. 重新启动应用服务"
else
    echo ""
    echo "⚠️  恢复过程中有警告/错误（退出码 $RESTORE_EXIT）"
    echo "   pg_restore 在恢复时可能产生非致命警告（如对象已存在），"
    echo "   请检查输出日志确认数据完整性。"
fi
