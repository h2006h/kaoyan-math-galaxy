// ─────────────────────────────────────────────────────────────
// 小智问答服务（RAG）：
//   1. 本地检索：ragEngine.retrieve → 命中考点/题目（带引用 id）
//   2. 在线生成：POST /api/ai/chat，把检索上下文交给后端代理的大模型，
//      前端永不接触 API Key；只依据给定资料作答
//   3. 离线降级：代理不可用/超时 → 用检索结果拼装可溯源的整理答案，
//      流程不中断，UI 标记「离线演示模式」
// 小智是只读智能体：不写掌握度、不写记录、不改题库，回答仅供学习参考。
// ─────────────────────────────────────────────────────────────

import { retrieve } from './ragEngine.js';
import { IS_STATIC_HOST } from './deployEnv.js';

const AI_ENDPOINT = '/api/ai/chat';
const CLIENT_TIMEOUT_MS = 15000; // 略大于代理的 12s 超时，让代理先返回明确错误
const HISTORY_TURNS = 6;

/** 检索上下文 → 后端可见的紧凑文档（不含账号掌握度等个人数据） */
function packContexts(contexts) {
  return contexts.map((c) =>
    c.kind === 'point'
      ? {
          kind: 'point',
          id: c.id,
          name: c.name,
          chapter: `${c.subjectName} · ${c.chapterName}`,
          scope: c.examScope,
          highFreq: c.highFreq,
          desc: c.desc,
          relations: c.relations,
        }
      : {
          kind: 'question',
          id: c.id,
          chapter: c.chapterName,
          type: c.type,
          stem: c.stem,
          options: c.options,
          analysis: c.analysis,
        }
  );
}

const citesOf = (pointHits) =>
  pointHits.map((p) => ({ id: p.id, name: p.name, chapterName: p.chapterName, subjectId: p.subjectId }));

/**
 * 提问唯一入口。
 * @param store 数据 store
 * @param question 用户问题
 * @param opts.history 最近对话 [{role:'user'|'assistant', content}]
 * @param opts.forceOffline 答辩演示可强制离线，保证确定性
 * @param opts.subjectId 当前星系（个性化进度问题用）
 * @returns {{mode:'online'|'offline', answer:string, citations:{id,name,chapterName,subjectId}[], note?:string}}
 */
export async function askXiaoZhi(store, question, { history = [], forceOffline = false, subjectId = null } = {}) {
  const rag = retrieve(store, question);
  const citations = citesOf(rag.pointHits);

  if (!forceOffline && !IS_STATIC_HOST) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
      const res = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          question,
          contexts: packContexts(rag.contexts),
          history: history.slice(-HISTORY_TURNS).map((m) => ({ role: m.role, content: String(m.content ?? '').slice(0, 1200) })),
        }),
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`代理 HTTP ${res.status}`);
      const data = await res.json();
      if (typeof data.answer !== 'string' || !data.answer.trim()) throw new Error('代理返回结构异常');
      // 引用只能落在检索命中的考点内——模型不得凭空造引用
      const valid = new Set(citations.map((c) => c.id));
      const citeIds = Array.isArray(data.citations) ? data.citations.filter((id) => valid.has(id)) : [];
      const finalCites = citeIds.length
        ? citations.filter((c) => citeIds.includes(c.id))
        : citations;
      return { mode: 'online', answer: data.answer.trim(), citations: finalCites };
    } catch {
      // 降级：不抛出、不阻塞，回落本地检索整理
    }
  }
  return { mode: 'offline', ...composeOfflineAnswer(store, question, rag, subjectId) };
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'];

function scopeLine(p) {
  const scope = p.examScope?.length ? p.examScope.join(' / ') : '范围未标注';
  const hf = p.highFreq ? ' · 高频考点' : '';
  const stars = p.difficulty ? ` · 难度 ${'★'.repeat(p.difficulty)}` : '';
  return `考查范围：${scope}${hf}${stars}`;
}

function relationsBlock(p) {
  const lines = [];
  if (p.relations?.prereqs?.length) lines.push(`前置考点：${p.relations.prereqs.slice(0, 4).join('、')}`);
  if (p.relations?.dependents?.length) lines.push(`后续考点：${p.relations.dependents.slice(0, 4).join('、')}`);
  if (p.relations?.related?.length) lines.push(`关联考点：${p.relations.related.slice(0, 4).join('、')}`);
  return lines.length ? lines.join('\n') : null;
}

function questionBlock(q, { withSolution }) {
  const head = q.type === 'fill' ? `填空题：${q.stem}` : q.stem;
  const lines = [head];
  if (q.type === 'single' && q.options.length) {
    lines.push(q.options.map((o, i) => `${OPTION_LETTERS[i]}. ${o}`).join('  '));
  }
  if (withSolution) {
    if (q.type === 'single' && q.answer != null) lines.push(`参考答案：${OPTION_LETTERS[q.answer]}`);
    if (q.type === 'fill' && q.accept?.length) lines.push(`参考答案：${q.accept[0]}`);
    if (q.analysis) lines.push(`解析：${q.analysis}`);
  } else {
    lines.push('（需要解题过程可以说「给出解析」）');
  }
  return lines.join('\n');
}

/**
 * 离线答案：严格引用知识库字段拼装，不生成任何库外事实。
 * 按意图分派：章节考点清单 / 练习题推荐 / 考点讲解 / 进度查询。
 */
export function composeOfflineAnswer(store, question, rag, subjectId = null) {
  const wantsSolution = /(答案|解析|怎么做|怎么解|解题|过程|步骤)/.test(question);
  const wantsQuestion = /(推荐|练习|刷题|做一?道|来一?道|例题|题目|做题)/.test(question);
  const wantsProgress = /(掌握度|进度|薄弱|学得怎么样|我的情况)/.test(question);
  const wantsList = /(哪些|哪几|有什么|包含|包括|内容|考点|知识点)/.test(question);
  const chapter = rag.chapter;
  const cites = citesOf(rag.pointHits);
  const sections = [];

  // 1) 章节练习题推荐
  if (chapter && wantsQuestion) {
    const list = store.questions
      .filter((q) => q.chapterId === chapter.chapterId)
      .sort((a, b) => a.difficulty - b.difficulty);
    const picked = list.slice(0, 2);
    sections.push(`「${chapter.name}」（${chapter.subjectName}）题库共 ${list.length} 道题，给你抽 2 道由浅入深的：`);
    for (const q of picked) sections.push(questionBlock(q, { withSolution: wantsSolution }));
    if (!list.length) sections.push('该章节暂时没有题目，可以在「题库管理」中导入。');
    return {
      answer: sections.join('\n\n'),
      citations: cites.length ? cites : pointCitesOfQuestion(store, picked[0]),
      note: '离线演示模式：基于本地题库检索整理',
    };
  }

  // 2) 章节考点清单
  if (chapter && wantsList) {
    const pts = chapter.points
      .map((p) => `· ${p.name}${p.highFreq ? '（高频）' : ''}${p.desc ? ` — ${p.desc}` : ''}`)
      .join('\n');
    sections.push(
      `「${chapter.subjectName} · ${chapter.name}」共 ${chapter.points.length} 个考点：\n${pts}`
    );
    const chapterCites = chapter.points.slice(0, 3).map((p) => ({
      id: p.id,
      name: p.name,
      chapterName: chapter.name,
      subjectId: chapter.subjectId,
    }));
    return {
      answer: sections.join('\n\n'),
      citations: cites.length ? cites : chapterCites,
      note: '离线演示模式：基于本地知识库检索整理',
    };
  }

  // 3) 进度查询：按当前星系列薄弱考点（只读账号数据）
  if (wantsProgress && !rag.pointHits.length && subjectId) {
    const subject = store.knowledge.subjects.find((s) => s.id === subjectId);
    if (subject) {
      const pts = subject.chapters.flatMap((ch) => ch.points);
      const scored = pts
        .map((p) => ({ p, score: store.mastery.get(p.id) }))
        .filter((x) => x.score != null)
        .sort((a, b) => a.score - b.score);
      const weak = scored.slice(0, 4).map((x) => `· ${x.p.name} — 掌握度 ${Math.round(x.score)}`);
      sections.push(
        `「${subject.name}」当前已学 ${scored.length}/${pts.length} 个考点。${
          weak.length ? `掌握度最低的考点：\n${weak.join('\n')}` : '还没有做题记录，点击星球开始练习吧。'
        }`
      );
      return {
        answer: sections.join('\n\n'),
        citations: scored.slice(0, 3).map((x) => ({ id: x.p.id, name: x.p.name, chapterName: store.chapters.get(x.p.chapterId)?.name ?? '', subjectId })),
        note: '离线演示模式：基于本地知识库检索整理',
      };
    }
  }

  // 4) 考点讲解（主路径）：取检索得分最高的考点
  const p = rag.pointHits[0];
  if (p) {
    sections.push(`「${p.name}」属于「${p.subjectName} · ${p.chapterName}」。\n${scopeLine(p)}`);
    if (p.desc) sections.push(`要点：${p.desc}`);
    const rel = relationsBlock(p);
    if (rel) sections.push(rel);
    if (p.mastery) sections.push(`当前账号掌握度：${p.mastery.score}（${p.mastery.state}）。`);
    if (rag.pointHits.length > 1) {
      sections.push(`同一问题还检索到相关考点：${rag.pointHits.slice(1).map((x) => `「${x.name}」`).join('、')}，可点击下方引用查看。`);
    }
    if (wantsQuestion || wantsSolution) {
      const q = rag.contexts.find((c) => c.kind === 'question');
      if (q) sections.push(`相关练习：\n${questionBlock(q, { withSolution: wantsSolution })}`);
    }
    return {
      answer: sections.join('\n\n'),
      citations: cites,
      note: '离线演示模式：基于本地知识库检索整理',
    };
  }

  // 5) 无命中：如实说明，并给出可用的入口
  const q0 = rag.contexts.find((c) => c.kind === 'question');
  if (q0) {
    sections.push(`没有直接匹配的考点，但题库里有一道相关题：\n\n${questionBlock(q0, { withSolution: wantsSolution })}`);
  } else {
    sections.push(
      '我没有在当前知识库中检索到与该问题直接相关的内容。\n你可以：\n· 换一个更具体的考点名（如「泰勒公式」「特征值」）\n· 问某章「有哪些考点」\n· 让我「推荐一道×章的练习题」'
    );
  }
  return {
    answer: sections.join('\n\n'),
    citations: [],
    note: '离线演示模式：本地知识库未命中',
  };
}

function pointCitesOfQuestion(store, q) {
  if (!q?.pointIds?.length) return [];
  return q.pointIds.slice(0, 2).map((pid) => {
    const p = store.points.get(pid);
    const ch = p ? store.chapters.get(p.chapterId) : null;
    return p ? { id: p.id, name: p.name, chapterName: ch?.name ?? '', subjectId: null } : null;
  }).filter(Boolean);
}
