// P4 会话自动标题（2026-10-07 裁定）：轻量 LLM 能力——BFF 直连 DeepSeek 单轮 chat，
// 无工具/无 agent/8s 超时/单次不重试。**标题是 presentation metadata only**：
// 只写 ui_sessions 行，与 /api/ask 的 gwBody（question/client_submission_id/session_id 三字段
// 白名单）无任何数据流交集——绝不进入 system prompt / user message / 六步法 / SQL 生成。
// 失败/超时/模糊拒绝 → null（保持"新会话"，title_source 停留 default，下个有效问题再试——宁缺毋滥）。

/** 标题生成规则（固化用户裁定，模型侧单一事实源；模糊判定也交给模型，前端/BFF 不做关键词预判）。 */
const SYSTEM_PROMPT = [
  "你是会话标题生成器。根据用户的经营数据问题，生成一个简洁的中文会话标题。",
  "规则：",
  "- 8~18 个汉字左右，直接描述问题主题（如：9月集团业绩达成分析）",
  "- 不要复述完整问题；不要句号、引号或任何结尾标点",
  "- 不要以「关于」「请问」「帮我」「我想知道」等开头",
  "- 不要输出「新会话」；只输出标题本身，不要任何解释",
  "- 如果问题过于模糊、无法独立表达主题（如：帮我看看、分析一下、继续、这个呢），只输出 SKIP",
].join("\n");

/** 确定性 sanitizer（边界 1）：trim → 只取第一行 → 去标题前缀/Markdown/首尾引号括号/尾部标点 →
 *  限长。清洗后为空/SKIP/「新会话」/过短 → null。 */
export function sanitizeTitle(raw: string): string | null {
  let t = raw.trim();
  t = t.split("\n")[0]!.trim(); // 只取第一行（模型偶尔带解释行）
  t = t.replace(/^(#{1,6}\s*)+/, ""); // Markdown 标题前缀
  t = t.replace(/^(标题|会话标题|主题)[:：]\s*/, ""); // 中文标签前缀
  t = t.replace(/[*_`~]+/g, ""); // Markdown 强调符
  t = t.replace(/^[“”"'「『《〈（(\[【]+/, ""); // 首部引号/括号/书名号
  t = t.replace(/[”"'」』》〉）)\]】。．.!！?？…；;，,、~\s]+$/, ""); // 尾部引号/括号/标点（一类合并，避免《…》。内层残留）
  t = t.trim();
  if (!t || t === "新会话" || /^skip$/i.test(t)) return null;
  const chars = Array.from(t);
  if (chars.length > 24) t = chars.slice(0, 24).join(""); // 硬上限（建议 8~18，容忍略长）
  if (Array.from(t).length < 2) return null;
  return t;
}

/** 生成标题：成功返回清洗后的标题；模糊拒绝/任何失败/未配置 key → null。
 *  纯出站调用（Bearer 只进请求头），异常全吞——标题不是关键链路。 */
export async function generateTitle(question: string): Promise<string | null> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || !question.trim()) return null; // 未配置 key = 功能静默关闭
  try {
    const r = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: question.slice(0, 200) },
        ],
        max_tokens: 48,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = data.choices?.[0]?.message?.content;
    return typeof content === "string" ? sanitizeTitle(content) : null;
  } catch {
    return null; // 超时/网络/解析失败——宁缺毋滥
  }
}
