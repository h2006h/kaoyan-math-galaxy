// ─────────────────────────────────────────────────────────────
// 大模型后端代理（骨架即实现，可直接运行）：
//   DEEPSEEK_API_KEY=sk-xxx node server/ai-proxy.mjs
// 路由：
//   POST /api/ai/check  题库质检建议（管理员工作台，只建议不写库）
//   POST /api/ai/chat   小智智能助教（RAG：前端本地检索 → 本代理注入上下文 → 大模型作答）
// 前端只调 /api/*，Key 仅存在于本进程环境变量。
// 选型：DeepSeek deepseek-chat —— 国产、数学推理见长、OpenAI 兼容
// 协议便于代理、成本低。
// 启动后 Vite dev proxy 会把 /api 转发到本服务（vite.config.js）。
// ─────────────────────────────────────────────────────────────
import http from 'node:http';

const PORT = process.env.PORT || 8787;
const API_KEY = process.env.DEEPSEEK_API_KEY;
const UPSTREAM = 'https://api.deepseek.com/chat/completions';
const TIMEOUT_MS = 10_000; // 质检任务 10s：超时立即返回 504，前端走离线降级
const CHAT_TIMEOUT_MS = 12_000; // 对话任务节奏不同，给 12s
const MAX_BODY = 1024 * 1024; // 1MB 请求体上限

const SYSTEM_PROMPT = `你是考研数学题库的质检助手，只做建议，不做裁决。对每道题输出：
1. missing：缺失字段列表（题干/选项/答案/解析/章节/难度/关联考点）
2. suggestedChapterId：建议章节 id（只能从给定 chapters 中选；不确定给 null）
3. reason：一句话归类依据（命中了哪些关键词）
4. formatIssues：格式问题（选项数量、答案范围、数学公式括号/定界符是否可解析）
只输出 JSON：{"results":[{"key","missing","suggestedChapterId","reason","formatIssues"}]}，不要输出其他内容。`;

const CHAT_SYSTEM_PROMPT = `你是「小智」，考研数学学习助教，服务一个 3D 知识星系应用，不能修改任何学习数据。
回答规则：
1. 只能依据用户消息中 contexts 提供的资料作答；资料不足时明确说「知识库中未收录」，绝不编造考点、大纲范围、题目答案或数据。
2. 简体中文，教学口吻，回答控制在 300 字以内。公式一律用 Markdown 数学语法：行内 $...$，独立公式 $$...$$（前端用 KaTeX 渲染）；可用少量 Markdown（加粗、列表）。
3. contexts 中 kind=point 是考点（含所属章节、数一/二/三范围、前置/后续关联），kind=question 是练习题（含解析）。学生在练习时先给思路再给答案。
4. 只输出 JSON：{"answer":"...","citations":["考点 id", ...]}；citations 只能取 kind=point 的 id，最多 3 个，没有就用空数组。`;

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('请求体过大')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ── 质检（管理员导入工作台）──────────────────────────────────
async function handleCheck(payload, res) {
  if (!Array.isArray(payload.items) || !Array.isArray(payload.chapters)) return send(res, 400, { error: '请求体非法' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0, // 质检任务要确定性，不要创造性
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify({ items: payload.items, chapters: payload.chapters, points: payload.points }) },
        ],
      }),
    });
    if (!upstream.ok) return send(res, 502, { error: `上游 HTTP ${upstream.status}` });
    const data = await upstream.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? 'null');
    if (!Array.isArray(parsed?.results)) return send(res, 502, { error: '上游输出结构异常' });
    return send(res, 200, parsed);
  } catch (e) {
    // 超时/网络/解析失败统一 5xx：前端据此降级到离线预置建议
    return send(res, e.name === 'AbortError' ? 504 : 502, { error: e.name === 'AbortError' ? '上游超时（10s）' : e.message });
  } finally {
    clearTimeout(timer);
  }
}

// ── 小智 RAG 对话 ────────────────────────────────────────────
// 检索在浏览器本地完成（可离线、可答辩复现），本接口只做"注入上下文 + 生成"。
// 后续接入自建知识库时：把 contexts 换成你们检索服务的输出即可，
// 前端与代理的契约不变（answer + citations）。
async function handleChat(payload, res) {
  const { question, contexts, history } = payload;
  if (typeof question !== 'string' || !question.trim()) return send(res, 400, { error: 'question 不能为空' });
  if (!Array.isArray(contexts) || !contexts.length) return send(res, 400, { error: 'contexts 不能为空' });
  const packed = contexts.slice(0, 8);
  const pointIds = new Set(packed.filter((c) => c?.kind === 'point').map((c) => c.id));
  const turns = (Array.isArray(history) ? history : [])
    .slice(-6)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1200) }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0.3,
        max_tokens: 900,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: CHAT_SYSTEM_PROMPT },
          ...turns,
          { role: 'user', content: JSON.stringify({ question, contexts: packed }) },
        ],
      }),
    });
    if (!upstream.ok) return send(res, 502, { error: `上游 HTTP ${upstream.status}` });
    const data = await upstream.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? 'null');
    if (typeof parsed?.answer !== 'string' || !parsed.answer.trim()) return send(res, 502, { error: '上游输出结构异常' });
    const citations = (Array.isArray(parsed.citations) ? parsed.citations : []).filter((id) => pointIds.has(id)).slice(0, 3);
    return send(res, 200, { answer: parsed.answer.trim(), citations });
  } catch (e) {
    return send(res, e.name === 'AbortError' ? 504 : 502, { error: e.name === 'AbortError' ? '上游超时（12s）' : e.message });
  } finally {
    clearTimeout(timer);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, keyConfigured: !!API_KEY, routes: ['/api/ai/check', '/api/ai/chat'] });
  }
  if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
  if (!API_KEY) return send(res, 503, { error: 'DEEPSEEK_API_KEY 未配置' });

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: '请求体非法' });
  }

  if (req.url === '/api/ai/check') return handleCheck(payload, res);
  if (req.url === '/api/ai/chat') return handleChat(payload, res);
  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`[ai-proxy] listening on :${PORT}, key ${API_KEY ? '已配置' : '未配置（将返回 503）'}`));