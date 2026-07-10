-- ============================================
-- GeiIt企业知识库 - PostgreSQL 初始化脚本
-- ============================================
-- 作用：
--     在 PostgreSQL 容器首次启动时自动执行，创建 pgvector 扩展
--     和全文检索相关配置。
--     Docker 会自动执行 /docker-entrypoint-initdb.d/ 下的 .sql 文件。
-- ============================================

-- 创建 pgvector 扩展
-- 作用：支持 vector 类型存储和向量相似度检索
CREATE EXTENSION IF NOT EXISTS vector;

-- 创建 pg_trgm 扩展
-- 作用：支持模糊检索和相似度计算（关键词检索的备选方案）
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 验证扩展创建成功
DO $$
BEGIN
    RAISE NOTICE '✅ pgvector 和 pg_trgm 扩展已创建';
END $$;
