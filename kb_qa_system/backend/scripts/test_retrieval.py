"""检索质量测试脚本（临时）"""
import sys
sys.path.insert(0, "/app")

from app.services.vector_store import get_vector_store

vs = get_vector_store()
query = "辅助系统功能设计"

# 测试向量检索
vr = vs.vector_search(query, top_k=5, document_ids=[1, 2, 3, 4])
print("=== 向量检索结果 ===")
for r in vr:
    score = r["score"]
    title = r["metadata"]["document_title"]
    content = r["content"][:100].replace("\n", " ")
    print(f"  score={score:.4f} doc={title}")
    print(f"    content={content}...")
    print()

# 测试关键词检索
kr = vs.keyword_search(query, top_k=5, document_ids=[1, 2, 3, 4])
print("=== 关键词检索结果 ===")
print(f"  结果数: {len(kr)}")
for r in kr:
    score = r["score"]
    title = r["metadata"]["document_title"]
    content = r["content"][:100].replace("\n", " ")
    print(f"  score={score:.4f} doc={title}")
    print(f"    content={content}...")
    print()

# 测试混合检索
hr = vs.search(query, top_k=5, document_ids=[1, 2, 3, 4])
print("=== 混合检索结果 ===")
for r in hr:
    score = r.get("final_score", r.get("score", 0))
    title = r["metadata"]["document_title"]
    vs_score = r.get("vector_score", 0)
    ks_score = r.get("keyword_score", 0)
    content = r["content"][:100].replace("\n", " ")
    print(f"  final={score:.4f} vec={vs_score:.4f} kw={ks_score:.4f} doc={title}")
    print(f"    content={content}...")
    print()
