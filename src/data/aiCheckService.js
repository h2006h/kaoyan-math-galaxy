// ─────────────────────────────────────────────────────────────
// 大模型辅助检查客户端：只做"建议"，永不直接写题库。
// 在线：POST /api/ai/check（后端代理持有 Key，前端不接触）；
// 降级：超时/失败/无后端 → 本地预置规则给出同构建议，
//       标记 mode='offline'，UI 显示"离线演示模式"，流程不中断。
// ─────────────────────────────────────────────────────────────

import { completeness } from './questionImport.js';
import { IS_STATIC_HOST } from './deployEnv.js';

const AI_ENDPOINT = '/api/ai/check';
const CLIENT_TIMEOUT_MS = 12000; // 略大于代理的 10s 超时，让代理先返回明确错误

// 章节关键词表：离线归类建议的依据，可解释（命中哪个词就建议哪章）
const CHAPTER_KEYWORDS = {
  limit: ['极限', '无穷小', '无穷大', '连续', '间断', '渐近线', 'lim'],
  derivative: ['导数', '微分', '可导', '单调', '极值', '最值', '凹凸', '拐点', '中值定理', '洛必达', '泰勒', '麦克劳林', '曲率'],
  integral: ['积分', '原函数', '不定积分', '定积分', '反常积分', '变限', '牛顿', '莱布尼茨', '面积', '旋转体'],
  series: ['级数', '收敛', '发散', '幂级数', '展开', '傅里叶', '交错', '比值判别', '根值判别', '收敛域', '收敛半径'],
  ode: ['微分方程', '通解', '特解', '特征方程', '分离变量', '常数变易', '降阶', '齐次', '非齐次', '初值问题'],
};

/** 数学公式可解析性的确定性启发检查（括号配平 / 占位符 / 常见残缺 LaTeX） */
function formulaIssues(text) {
  const issues = [];
  if (!text) return issues;
  const pairs = [['(', ')'], ['[', ']'], ['{', '}'], ['（', '）']];
  for (const [open, close] of pairs) {
    const n1 = text.split(open).length - 1;
    const n2 = text.split(close).length - 1;
    if (n1 !== n2) issues.push(`括号不配平：${open}${close}（${n1}/${n2}）`);
  }
  const dollars = text.split('$').length - 1;
  if (dollars % 2 !== 0) issues.push('公式定界符 $ 不成对');
  if (/\?\?\?|TODO|待补充|xxx/i.test(text)) issues.push('存在占位符文本');
  if (/\\frac\s*[^{]/.test(text)) issues.push('\\frac 后缺少花括号');
  return issues;
}

/** 离线预置建议：与在线返回同构，管理员看到的操作完全一致 */
export function offlineSuggest(item, store) {
  const text = [item.stem, item.analysis, ...(item.options ?? []), ...(item.accept ?? [])].join(' ');
  let best = null;
  for (const [chId, words] of Object.entries(CHAPTER_KEYWORDS)) {
    const hits = words.filter((w) => text.includes(w));
    if (hits.length && (!best || hits.length > best.hits.length)) best = { chId, hits };
  }
  const formatIssues = [];
  if (item.type === 'single') {
    if (item.options.length !== 4) formatIssues.push(`选项数量为 ${item.options.length}，应为 4`);
    const filled = item.options.filter(Boolean);
    if (new Set(filled).size !== filled.length) formatIssues.push('存在重复选项');
    if (item.answer < 0 || item.answer > 3) formatIssues.push('答案不在 A-D 范围');
  } else if (!item.accept.length) {
    formatIssues.push('填空题缺少可接受答案');
  }
  formatIssues.push(...formulaIssues(item.stem), ...formulaIssues(item.analysis));

  return {
    key: item.key,
    missing: completeness(item),
    suggestedChapterId: best?.chId ?? null,
    reason: best
      ? `命中关键词：${best.hits.slice(0, 4).join('、')}${item.chapterId === best.chId ? '（与当前标签一致）' : ''}`
      : '未命中章节关键词，请人工选择',
    formatIssues: [...new Set(formatIssues)],
  };
}

/**
 * 批量检查入口。
 * @param items 待确认项
 * @param store 数据store（提供章节/考点上下文）
 * @param opts.forceOffline 答辩演示可强制离线，保证确定性
 * @returns {mode: 'online'|'offline', results: {key: suggestion}, error?}
 */
export async function checkItems(items, store, { forceOffline = false } = {}) {
  if (!forceOffline && !IS_STATIC_HOST) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
      const res = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          items: items.map(({ key, type, stem, options, answer, accept, analysis, chapterId, difficulty, pointIds }) =>
            ({ key, type, stem, options, answer, accept, analysis, chapterId, difficulty, pointIds })),
          chapters: [...store.chapters.values()].map((c) => ({ id: c.id, name: c.name })),
          points: [...store.points.values()].map((p) => ({ id: p.id, name: p.name, chapterId: p.chapterId })),
        }),
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`代理 HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.results)) throw new Error('代理返回结构异常');
      const results = {};
      for (const r of data.results) {
        if (r && r.key) results[r.key] = { missing: [], formatIssues: [], ...r };
      }
      return { mode: 'online', results };
    } catch (e) {
      // 降级：不抛出、不阻塞，回落到预置规则
      const results = {};
      for (const item of items) results[item.key] = offlineSuggest(item, store);
      return { mode: 'offline', results, error: e.name === 'AbortError' ? '请求超时' : e.message };
    }
  }
  const results = {};
  for (const item of items) results[item.key] = offlineSuggest(item, store);
  return { mode: 'offline', results };
}