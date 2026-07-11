/**
 * 隐私政策页面
 *
 * 作用：
 *   展示 GeiIt企业知识库 的隐私政策，说明数据收集、使用、存储、保护
 *   及用户权利等内容，满足 GDPR/PIPL 合规要求。
 *
 * 使用方式：
 *   通过路由 /privacy 访问，公开页面（无需登录）。
 */

import { useNavigate } from "react-router-dom";
import { ArrowLeft, BookOpen, Shield } from "lucide-react";

/** 隐私政策章节 */
interface PrivacySection {
  /** 章节标题 */
  title: string;
  /** 章节内容（段落列表） */
  paragraphs: string[];
}

/** 隐私政策章节内容 */
const SECTIONS: PrivacySection[] = [
  {
    title: "一、数据收集范围",
    paragraphs: [
      "GeiIt企业知识库（以下简称「本系统」）在您使用过程中会收集以下个人数据：",
      "1. 账号信息：用户名、邮箱地址（用于注册、登录和账户管理）。",
      "2. 文档数据：您上传的文档文件及其解析后的文本内容、向量化表示。",
      "3. 对话记录：您在问答对话中提出的问题及系统生成的回答。",
      "4. 使用日志：访问时间、操作行为、设备信息（用于安全审计和故障排查）。",
      "5. 质量埋点：问答检索耗时、Token 消耗等系统性能指标（不含个人敏感信息）。",
    ],
  },
  {
    title: "二、数据使用目的",
    paragraphs: [
      "本系统收集的个人数据仅用于以下目的：",
      "1. 提供知识库问答服务：基于您上传的文档进行检索增强生成（RAG）。",
      "2. 账户管理：身份验证、会话维持、权限控制。",
      "3. 质量优化：通过问答埋点分析系统效果，持续改进检索和生成质量。",
      "4. 安全防护：异常行为检测、审计追溯、防止滥用。",
      "我们不会将您的数据出售给第三方，也不会用于定向广告推送。",
    ],
  },
  {
    title: "三、数据存储与保护",
    paragraphs: [
      "本系统采取多重措施保护您的数据安全：",
      "1. 密码加密：用户密码使用 bcrypt 算法哈希存储，不保存明文。",
      "2. Token 认证：采用 Access Token + Refresh Token 双令牌机制，Access Token 短时效。",
      "3. 访问隔离：用户只能访问自己上传的文档和公共文档库，模型检索严格限定在授权范围。",
      "4. 传输加密：生产环境强制 HTTPS 加密传输。",
      "5. 数据库安全：PostgreSQL 数据库启用 pgvector 扩展存储向量，数据库访问需认证。",
      "6. 缓存安全：Redis 缓存启用持久化，关键安全策略（如登录锁定）采用 fail-closed 模式。",
    ],
  },
  {
    title: "四、数据保留期限",
    paragraphs: [
      "1. 账号存续期间：您的文档、对话记录和质量埋点数据将持续保留，直至您删除账号。",
      "2. 账号删除后：当您主动删除账号时，系统将永久删除您的所有个人数据，包括：",
      "   - 账号信息（用户名、邮箱、密码哈希）",
      "   - 上传的文档文件及数据库记录",
      "   - 文档分块和向量数据",
      "   - 对话历史和消息记录",
      "   - 服务器上存储的物理文件",
      "3. 定期清理策略：系统每日凌晨自动清理超过保留期的数据，各类型数据保留期如下：",
      "   - 已软删除的对话记录：保留 90 天后永久删除",
      "   - 问答质量埋点（QAEvent）：保留 90 天后永久删除",
      "   - 邮件发送日志：保留 30 天后永久删除",
      "   - 审计日志：保留 365 天后永久删除（满足安全合规要求）",
      "4. 例外保留：问答质量埋点（QAEvent）中的用户 ID 在账号删除时会被置空（SET NULL），匿名化的统计数据可能保留用于系统分析，但这些数据无法关联到您个人。",
      "5. Token 黑名单：登出或删除账号后，Token 会被加入黑名单，最长保留 7 天后自动清理。",
    ],
  },
  {
    title: "五、用户权利",
    paragraphs: [
      "根据 GDPR（通用数据保护条例）和 PIPL（个人信息保护法），您享有以下权利：",
      "1. 访问权：您可随时通过系统查看自己的账号信息、文档和对话记录。",
      "2. 更正权：如需更正账号信息，请联系管理员。",
      "3. 删除权（被遗忘权）：您可通过「设置 → 删除账号」功能永久删除账号及所有数据。删除操作不可恢复，请谨慎操作。",
      "4. 数据可携权：如需导出您的数据，请联系管理员协助处理。",
      "5. 撤回同意权：您可随时停止使用本系统并删除账号以撤回数据处理同意。",
      "行使上述权利时，系统会要求您验证身份（如输入密码）以防止未授权操作。",
    ],
  },
  {
    title: "六、Cookie 与 Token 说明",
    paragraphs: [
      "1. 本系统不使用追踪类 Cookie 进行用户行为分析。",
      "2. 身份认证采用 JWT（JSON Web Token）机制，Token 存储在浏览器 localStorage 中。",
      "3. Access Token 有效期 15 分钟，Refresh Token 有效期 7 天，过期后需重新登录或刷新。",
      "4. 登出时 Token 会立即加入黑名单失效，确保账号安全。",
      "5. 请勿在公共设备上保持登录状态，使用完毕请及时登出。",
    ],
  },
  {
    title: "七、第三方服务说明",
    paragraphs: [
      "1. 大语言模型（LLM）服务：本系统的问答生成依赖第三方 LLM 服务。您提问的内容和检索到的文档片段会发送给 LLM 服务以生成回答。LLM 服务提供商有自己的隐私政策，请知悉。",
      "2. 向量嵌入服务：文档向量化使用嵌入模型，可能由第三方服务提供。",
      "3. 云服务基础设施：生产部署依赖云服务商（如 Railway、Redis、PostgreSQL 托管服务），这些服务商符合行业安全标准。",
      "我们仅向第三方服务传输必要的数据，并选择符合隐私保护标准的服务商。",
    ],
  },
  {
    title: "八、联系方式",
    paragraphs: [
      "如对本隐私政策有任何疑问、建议或需要行使数据权利，请通过以下方式联系我们：",
      "1. 系统内置反馈：登录后通过「设置」页面提交反馈。",
      "2. 管理员邮箱：请联系系统管理员获取支持。",
      "我们将在收到您的请求后 15 个工作日内予以回复。",
    ],
  },
];

/** 最后更新日期 */
const LAST_UPDATED = "2026年7月11日";

/** PrivacyPage 组件 */
export default function PrivacyPage() {
  const navigate = useNavigate();

  /** 返回上一页 */
  const handleBack = () => {
    // 优先返回上一页，无历史记录时回到首页
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  return (
    <div className="min-h-screen bg-canvas">
      {/* 顶部导航栏 */}
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <button
            onClick={handleBack}
            className="rounded-md p-1.5 text-ink-secondary transition-colors hover:bg-muted hover:text-ink"
            aria-label="返回"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded bg-brand text-white">
              <BookOpen className="h-4 w-4" />
            </div>
            <span className="font-semibold text-ink">GeiIt企业知识库</span>
          </div>
        </div>
      </header>

      {/* 内容区 */}
      <main className="mx-auto max-w-3xl px-4 py-8">
        {/* 标题区 */}
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-light text-brand">
            <Shield className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold text-ink">隐私政策</h1>
          <p className="mt-2 text-sm text-ink-secondary">
            最后更新：{LAST_UPDATED}
          </p>
        </div>

        {/* 引言 */}
        <div className="mb-8 rounded-lg border border-line bg-surface p-5">
          <p className="text-sm leading-relaxed text-ink-secondary">
            本隐私政策旨在说明 GeiIt企业知识库（以下简称"本系统"）如何收集、使用、存储和保护您的个人数据，以及您享有的数据权利。使用本系统即表示您同意本政策所述的数据处理方式。我们承诺以合法、公正、透明的方式处理您的个人数据。
          </p>
        </div>

        {/* 各章节 */}
        <div className="space-y-8">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="mb-3 text-lg font-semibold text-ink">
                {section.title}
              </h2>
              <div className="space-y-2">
                {section.paragraphs.map((para, idx) => (
                  <p
                    key={idx}
                    className="text-sm leading-relaxed text-ink-secondary"
                  >
                    {para}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* 底部声明 */}
        <div className="mt-12 rounded-lg border border-line bg-muted/30 p-5">
          <p className="text-xs leading-relaxed text-ink-tertiary">
            本隐私政策可能不时更新，更新后将在本页面公布并修改"最后更新"日期。重大变更时我们会通过系统通知提醒您。继续使用本系统即表示您同意更新后的隐私政策。
          </p>
        </div>

        {/* 返回按钮 */}
        <div className="mt-8 text-center">
          <button
            onClick={handleBack}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-muted hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            返回
          </button>
        </div>
      </main>
    </div>
  );
}
