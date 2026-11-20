// 数据校验：node scripts/validate-data.mjs
// 两层校验：
//   1. JSON Schema（ajv）——字段存在性、类型、枚举、取值范围
//   2. 跨文件语义规则——id 唯一性、引用完整性、章节一致性、孤立考点、
//      前置依赖环、重复关联、题目考点覆盖率
// 退出码：0 全部通过；1 存在 error（warning 不阻断）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import katex from 'katex';
import { splitMathSegments, toMarkdownMath } from '../src/data/mathParse.js';
import { renderInlineMarkdown } from '../src/data/markdown.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, 'public', 'data');
const SCHEMAS = path.join(ROOT, 'scripts', 'schemas');

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const knowledge = read(path.join(DATA, 'knowledge.json'));
const relations = read(path.join(DATA, 'relations.json'));
const bank = read(path.join(DATA, 'question_bank.json'));

const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

// ── 1. Schema 校验 ──────────────────────────────────────────
const ajv = new Ajv({ allErrors: true });
for (const [file, schemaFile, data] of [
  ['knowledge.json', 'knowledge.schema.json', knowledge],
  ['relations.json', 'relations.schema.json', relations],
  ['question_bank.json', 'question_bank.schema.json', bank],
]) {
  const validate = ajv.compile(read(path.join(SCHEMAS, schemaFile)));
  if (!validate(data)) {
    for (const e of validate.errors) {
      err(`[schema] ${file} ${e.instancePath || '/'} ${e.message}`);
    }
  }
}

// ── 2. 语义校验 ─────────────────────────────────────────────
const chapters = new Map(); // chapterId -> chapter
const points = new Map();   // pointId -> point
for (const subject of knowledge.subjects) {
  for (const ch of subject.chapters) {
    if (chapters.has(ch.id)) err(`[唯一性] 章节 id 重复: ${ch.id}`);
    chapters.set(ch.id, ch);
    for (const p of ch.points) {
      if (points.has(p.id)) err(`[唯一性] 考点 id 重复: ${p.id}`);
      points.set(p.id, p);
      if (p.chapterId !== ch.id) {
        err(`[章节一致性] 考点 ${p.id} 的 chapterId=${p.chapterId} 与父章节 ${ch.id} 不符`);
      }
    }
  }
}

// relations 引用完整性 + 自环 + 重复边
const seenEdge = new Set();
const linked = new Set();
const prereqEdges = [];
for (const r of relations.relations) {
  if (!points.has(r.sourceId)) err(`[引用] relations.sourceId 不存在: ${r.sourceId}`);
  if (!points.has(r.targetId)) err(`[引用] relations.targetId 不存在: ${r.targetId}`);
  if (r.sourceId === r.targetId) err(`[自环] ${r.sourceId} 关联自身`);
  const key = `${r.sourceId}->${r.targetId}`;
  if (seenEdge.has(key)) err(`[重复关联] ${key}`);
  seenEdge.add(key);
  linked.add(r.sourceId);
  linked.add(r.targetId);
  if (r.type === 'prerequisite') prereqEdges.push(r);
}

// 孤立考点：没有任何关联的星球在星系中是"死星"
for (const id of points.keys()) {
  if (!linked.has(id)) err(`[孤立考点] ${id}（${points.get(id).name}）无任何关联关系`);
}

// 前置依赖环检测（DFS 三色标记）：前置链有环会导致学习路径无法排序
{
  const adj = new Map();
  for (const e of prereqEdges) {
    if (!adj.has(e.sourceId)) adj.set(e.sourceId, []);
    adj.get(e.sourceId).push(e.targetId);
  }
  const state = new Map(); // 0 未访问 1 访问中 2 完成
  const stack = [];
  const dfs = (u) => {
    state.set(u, 1);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      if (state.get(v) === 1) {
        const cycle = stack.slice(stack.indexOf(v)).concat(v).join(' → ');
        err(`[前置环] ${cycle}`);
      } else if (!state.get(v)) {
        dfs(v);
      }
    }
    stack.pop();
    state.set(u, 2);
  };
  for (const id of points.keys()) if (!state.get(id)) dfs(id);
}

// 题库校验
const qids = new Set();
const coveredPoints = new Set();
for (const q of bank.questions) {
  if (qids.has(q.id)) err(`[唯一性] 题目 id 重复: ${q.id}`);
  qids.add(q.id);
  if (!chapters.has(q.chapterId)) err(`[章节标签] 题目 ${q.id} 的 chapterId 无效: ${q.chapterId}`);
  if (q.type === 'single') {
    if (q.answer < 0 || q.answer >= q.options.length) err(`[答案越界] ${q.id}`);
  } else if (q.type === 'fill') {
    if (!Array.isArray(q.accept) || q.accept.length === 0 || q.accept.some((a) => !String(a).trim())) {
      err(`[填空答案] ${q.id} 的 accept 为空或含空串`);
    }
  }
  for (const pid of q.pointIds) {
    if (!points.has(pid)) {
      err(`[引用] 题目 ${q.id} 关联了不存在的考点: ${pid}`);
    } else {
      coveredPoints.add(pid);
      if (points.get(pid).chapterId !== q.chapterId) {
        warn(`[跨章关联] 题目 ${q.id}（${q.chapterId}）关联了其他章节考点 ${pid}，组卷时注意`);
      }
    }
  }
}

// 覆盖率：每个考点至少 1 道题，否则星球面板「开始做题」无题可抽
for (const id of points.keys()) {
  if (!coveredPoints.has(id)) err(`[覆盖率] 考点 ${id}（${points.get(id).name}）没有任何题目`);
}

// 掌握度规则参数：范围与阈值自洽（可解释规则的底线校验）
try {
  const rules = read(path.join(DATA, 'mastery_rules.json'));
  if (!(rules.baseScore > 0)) err('[规则] baseScore 必须为正');
  if (!(rules.streakLength >= 2)) err('[规则] streakLength 至少为 2');
  if (!(rules.minScore === 0 && rules.maxScore === 100)) warn('[规则] 分数区间不是 0-100，确认阈值语义');
  if (!(rules.thresholds.mastered > rules.thresholds.weak)) err('[规则] mastered 阈值必须大于 weak 阈值');
  if (!(rules.initialScore > rules.thresholds.weak && rules.initialScore < rules.thresholds.mastered)) {
    err('[规则] initialScore 应落在「学习中」区间，否则首题即跳变状态');
  }
  for (const d of ['1', '2', '3']) {
    if (!(rules.difficultyCoeff[d] > 0)) err(`[规则] 难度系数缺失: ${d}`);
  }
} catch {
  err('[规则] mastery_rules.json 缺失或不可解析');
}

// ── 讲解稿件（point_notes.md）：覆盖率 + 公式 KaTeX 可解析性 ──
try {
  const notesText = fs.readFileSync(path.join(DATA, 'point_notes.md'), 'utf8');
  const sections = new Map();
  const re = /<!-- id: ([\w-]+) -->([\s\S]*?)<!-- end -->/g;
  let m;
  while ((m = re.exec(notesText))) {
    if (sections.has(m[1])) err(`[讲解] 重复的考点分节: ${m[1]}`);
    sections.set(m[1], m[2]);
  }
  for (const id of points.keys()) {
    if (!sections.has(id)) err(`[讲解] 缺少讲解: ${id}`);
  }
  for (const id of sections.keys()) {
    if (!points.has(id)) err(`[讲解] 讲解引用了不存在的考点: ${id}`);
  }
  let formulaCount = 0;
  for (const [id, body] of sections) {
    // 公式必须全部以 Markdown 数学语法书写：定界符成对、注释外无裸 LaTeX、不是空讲解
    if (((body.match(/\$/g) ?? []).length) % 2 !== 0) err(`[讲解] ${id} 公式定界符 $ 不成对`);
    const prose = body.replace(/\$\$[\s\S]+?\$\$/g, '').replace(/\$[^$\n]+?\$/g, '');
    const bareCmd = [...new Set(prose.match(/\\[a-zA-Z]{2,}/g) ?? [])];
    if (bareCmd.length) err(`[讲解] ${id} 正文存在未包裹的 LaTeX 命令: ${bareCmd.slice(0, 3).join(', ')}`);
    if (!/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/.test(body)) err(`[讲解] ${id} 未包含任何公式`);
    const mathRe = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
    let mm;
    while ((mm = mathRe.exec(body))) {
      formulaCount++;
      try {
        katex.renderToString((mm[1] ?? mm[2]).trim(), { throwOnError: true, displayMode: !!mm[1], strict: 'ignore' });
      } catch (e) {
        err(`[讲解] ${id} 公式无法解析: ${String(e.message).slice(0, 120)}`);
      }
    }
  }
  console.log(`讲解 ${sections.size} 篇 · 公式 ${formulaCount} 条`);
} catch {
  err('[讲解] point_notes.md 缺失或不可读');
}

// ── 相关题目 / 参考答案的公式（Unicode 数学 → Markdown $…$ → KaTeX）──
try {
  let texts = 0;
  let withMath = 0;
  let segments = 0;
  const bad = [];
  for (const q of bank.questions) {
    const targets = [
      ['stem', q.stem],
      ['analysis', q.analysis],
      ['answer', q.type === 'fill' ? (q.accept ?? [])[0] : (q.options ?? [])[q.answer]],
    ];
    for (const [field, text] of targets) {
      if (typeof text !== 'string' || !text) continue;
      texts++;
      const maths = splitMathSegments(text).filter((s) => s.type === 'math');
      segments += maths.length;
      if (maths.length) withMath++;
      // 走与界面完全相同的 Markdown 渲染路径：出现 katex-error 即视为不可解析
      const html = renderInlineMarkdown(toMarkdownMath(text));
      if (html.includes('katex-error')) bad.push(`${q.id}.${field}`);
    }
  }
  if (bad.length) err(`[参考答案] Markdown 公式解析失败 ${bad.length} 处：${bad.slice(0, 5).join(', ')}`);
  console.log(`相关题目/参考答案公式：${texts} 条文本 · ${withMath} 条含公式 · ${segments} 个片段`);
} catch (e) {
  err(`[参考答案] Markdown 公式解析管线不可用: ${e.message}`);
}

// ── UI 公式泄漏守卫：直接展示的字段不得含 $ 或 LaTeX 命令 ──
try {
  const leakRe = /\$|\\[a-zA-Z]{2,}/;
  const leaks = [];
  let fields = 0;
  const check = (label, s) => {
    if (typeof s !== 'string') return;
    fields++;
    if (leakRe.test(s)) leaks.push(label);
  };
  for (const s of knowledge.subjects) {
    check(`subject:${s.id}.name`, s.name);
    check(`subject:${s.id}.shortName`, s.shortName);
    for (const ch of s.chapters) {
      check(`chapter:${ch.id}.name`, ch.name);
      for (const p of ch.points) {
        check(`point:${p.id}.name`, p.name);
        check(`point:${p.id}.desc`, p.desc);
      }
    }
  }
  for (const q of bank.questions) {
    check(`q:${q.id}.stem`, q.stem);
    (q.options ?? []).forEach((o, i) => check(`q:${q.id}.opt${i}`, o));
    (q.accept ?? []).forEach((a, i) => check(`q:${q.id}.accept${i}`, a));
    check(`q:${q.id}.analysis`, q.analysis);
  }
  if (leaks.length) err(`[公式泄漏] UI 文本含 $ 或 LaTeX 命令：${leaks.slice(0, 5).join(', ')}`);
  console.log(`公式泄漏守卫：扫描 UI 字段 ${fields} 条，${leaks.length ? leaks.length + ' 条含 $ / LaTeX' : '无 $ 或 LaTeX 命令'}`);
} catch (e) {
  err(`[公式泄漏] 扫描失败: ${e.message}`);
}

// ── 报告 ────────────────────────────────────────────────────
const stateCount = { mastered: 0, learning: 0, weak: 0, unlearned: 0 };
try {
  const demo = read(path.join(DATA, 'demo_mastery.json'));
  for (const [pid, score] of Object.entries(demo.mastery)) {
    if (!points.has(pid)) err(`[引用] demo_mastery 包含不存在的考点: ${pid}`);
    const s = score == null ? 'unlearned' : score >= 80 ? 'mastered' : score <= 30 ? 'weak' : 'learning';
    stateCount[s]++;
  }
} catch {
  warn('demo_mastery.json 不存在，跳过状态分布统计');
}

console.log(`考点 ${points.size} · 章节 ${chapters.size} · 关联 ${relations.relations.length} · 题目 ${bank.questions.length}`);
console.log('演示账号状态分布:', JSON.stringify(stateCount));
for (const w of warnings) console.log('WARN  ' + w);
for (const e of errors) console.log('ERROR ' + e);
console.log(errors.length ? `\n✗ ${errors.length} 个错误` : '\n✓ 全部校验通过');
process.exit(errors.length ? 1 : 0);
