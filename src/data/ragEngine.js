// ─────────────────────────────────────────────────────────────
// 小智 RAG 检索引擎：把知识库（考点 + 题库 + 关联）装配成内存索引，
// 用中文二元组词法做确定性检索，返回带引用 id 的上下文。
// 纯前端、可离线、零依赖——答辩演示不依赖任何外部服务。
// 后续接入自建知识库时，只需替换 buildRagIndex 的文档来源，
// 检索接口（retrieve / buildSuggestedQuestions）保持不变。
// ─────────────────────────────────────────────────────────────

const STOP_BIGRAMS = new Set([
  '的', '了', '是', '吗', '呢', '啊', '吧', '什么', '怎么', '怎样', '如何', '哪些', '哪几',
  '这个', '那个', '一下', '请问', '帮我', '我想', '可以', '是否', '以及', '或者', '还是',
  '关于', '有关', '告诉', '知道', '觉得', '应该',
]);

const CJK_RE = /[\u4e00-\u9fff]+/g;
const WORD_RE = /[a-z0-9]+|[\u4e00-\u9fff]+/g;

/** 归一化：全角转半角、标点转空格、小写 */
function normalize(text) {
  return String(text ?? '')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[，。？！、；：“”‘’（）【】《》…—～·]/g, ' ')
    .replace(/[,.?!;:'"()\[\]{}<>/\\|`~@#$%^&*_+=–-]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** 中文按二元组切分（「泰勒公式」→ 泰勒/勒公/公式），英文数字按整词 */
function tokenize(text) {
  const norm = normalize(text);
  const tokens = [];
  let m;
  WORD_RE.lastIndex = 0;
  while ((m = WORD_RE.exec(norm))) {
    const seg = m[0];
    if (/^[a-z0-9]+$/.test(seg)) {
      tokens.push(seg);
    } else if (seg.length === 1) {
      if (!STOP_BIGRAMS.has(seg)) tokens.push(seg);
    } else {
      for (let i = 0; i + 1 < seg.length; i++) {
        const bg = seg.slice(i, i + 2);
        if (!STOP_BIGRAMS.has(bg)) tokens.push(bg);
      }
    }
  }
  return tokens;
}

export function scopeLabels(examScope) {
  const map = { 1: '数一', 2: '数二', 3: '数三' };
  return (examScope ?? []).map((n) => map[n]).filter(Boolean);
}

function masteryLabel(store, pointId) {
  const score = store.mastery?.get(pointId);
  if (score == null) return null;
  const th = store.rules?.thresholds ?? { mastered: 80, weak: 30 };
  const state = score >= th.mastered ? '已掌握' : score <= th.weak ? '薄弱' : '学习中';
  return { score, state, label: `掌握度 ${Math.round(score)}（${state}）` };
}

/** 某考点的关联摘要：前置 / 后续 / 普通关联，名称直接取自 store */
function relationSummary(store, pointId) {
  const prereqs = [];
  const dependents = [];
  const related = [];
  for (const r of store.relations) {
    if (r.targetId === pointId) {
      const p = store.points.get(r.sourceId);
      if (p) (r.type === 'prerequisite' ? prereqs : related).push(p.name);
    } else if (r.sourceId === pointId) {
      const p = store.points.get(r.targetId);
      if (p) (r.type === 'prerequisite' ? dependents : related).push(p.name);
    }
  }
  return { prereqs, dependents, related: [...new Set(related)] };
}

/**
 * 组装索引：考点文档（主体）+ 题目文档（补充）。
 * store 变化（管理员入库新题）时由 getRagIndex 检测并重建。
 */
export function buildRagIndex(store) {
  const docs = [];
  const chapters = [];
  for (const subject of store.knowledge.subjects) {
    for (const ch of subject.chapters) {
      chapters.push({ id: ch.id, name: ch.name, subjectId: subject.id, subjectName: subject.name, points: ch.points });
      for (const p of ch.points) {
        docs.push({
          kind: 'point',
          id: p.id,
          title: p.name,
          chapterId: ch.id,
          chapterName: ch.name,
          subjectId: subject.id,
          subjectName: subject.name,
          point: p,
        });
      }
    }
  }
  for (const q of store.questions) {
    const ch = store.chapters.get(q.chapterId);
    docs.push({
      kind: 'question',
      id: q.id,
      title: q.stem,
      chapterId: q.chapterId,
      chapterName: ch?.name ?? '',
      subjectId: ch ? subjectOfChapter(store, q.chapterId) : null,
      question: q,
    });
  }

  // 预计算词项集合与倒排 df
  const df = new Map();
  for (const doc of docs) {
    const text = docText(store, doc);
    const toks = new Set(tokenize(text));
    doc.tokens = toks;
    doc.titleNorm = normalize(doc.title);
    for (const t of toks) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = docs.length;
  const idf = new Map([...df.entries()].map(([t, n]) => [t, Math.log(1 + N / (1 + n))]));

  return { docs, chapters, idf, N };
}

function subjectOfChapter(store, chapterId) {
  for (const s of store.knowledge.subjects) {
    if (s.chapters.some((c) => c.id === chapterId)) return s.id;
  }
  return null;
}

function docText(store, doc) {
  if (doc.kind === 'point') {
    const p = doc.point;
    return [p.name, p.desc ?? '', doc.chapterName, doc.subjectName, '考点', scopeLabels(p.examScope).join(' ')].join(' ');
  }
  const q = doc.question;
  return [q.stem, ...(q.options ?? []), q.analysis ?? '', doc.chapterName].join(' ');
}

const indexCache = new WeakMap();

export function getRagIndex(store) {
  const hit = indexCache.get(store);
  const sig = store.questions.length;
  if (hit && hit.sig === sig) return hit.index;
  const index = buildRagIndex(store);
  indexCache.set(store, { sig, index });
  return index;
}

/**
 * 检索入口。
 * @returns {{contexts: SearchHit[], pointHits: SearchHit[], chapter: object|null, maxScore: number}}
 * contexts：按相关度排序的文档（point/question），含引用所需元信息。
 */
export function retrieve(store, query, { topK = 6 } = {}) {
  const index = getRagIndex(store);
  const qNorm = normalize(query);
  const qTokens = [...new Set(tokenize(query))];
  const scored = [];
  if (qTokens.length) {
    for (const doc of index.docs) {
      let s = 0;
      for (const tok of qTokens) {
        if (!doc.tokens.has(tok)) continue;
        let w = index.idf.get(tok) ?? 1;
        if (doc.titleNorm.includes(tok)) w *= 2.4;
        s += w;
      }
      // 整句命中标题：强信号（如直接问「泰勒公式」）
      if (qNorm.length >= 2 && doc.titleNorm.includes(qNorm)) s += 6;
      if (doc.kind === 'question') s *= 0.55;
      if (s > 0) scored.push({ doc, score: s });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id));

  const contexts = scored.slice(0, topK).map(({ doc, score }) => hitOf(store, doc, score));
  const pointHits = [];
  const seen = new Set();
  for (const c of contexts) {
    if (c.kind !== 'point' || seen.has(c.id)) continue;
    seen.add(c.id);
    pointHits.push(c);
    if (pointHits.length >= 3) break;
  }
  return {
    contexts,
    pointHits,
    chapter: findChapter(store, query),
    maxScore: scored[0]?.score ?? 0,
  };
}

function hitOf(store, doc, score) {
  if (doc.kind === 'point') {
    const p = doc.point;
    return {
      kind: 'point',
      id: p.id,
      name: p.name,
      desc: p.desc,
      chapterId: doc.chapterId,
      chapterName: doc.chapterName,
      subjectId: doc.subjectId,
      subjectName: doc.subjectName,
      examScope: scopeLabels(p.examScope),
      highFreq: !!p.highFreq,
      difficulty: p.difficulty,
      relations: relationSummary(store, p.id),
      mastery: masteryLabel(store, p.id),
      score,
    };
  }
  const q = doc.question;
  return {
    kind: 'question',
    id: q.id,
    stem: q.stem,
    options: q.options ?? [],
    accept: q.accept ?? [],
    analysis: q.analysis ?? '',
    answer: q.answer,
    type: q.type,
    difficulty: q.difficulty,
    chapterId: doc.chapterId,
    chapterName: doc.chapterName,
    subjectId: doc.subjectId,
    score,
  };
}

/** 在查询里找章节名（整名包含匹配），供「这一章有哪些考点」这类问题 */
export function findChapter(store, query) {
  const q = normalize(query);
  let best = null;
  for (const subject of store.knowledge.subjects) {
    for (const ch of subject.chapters) {
      const name = normalize(ch.name);
      if (name && q.includes(name) && (!best || name.length > best.name.length)) {
        best = { chapter: ch, subject, name };
      }
    }
  }
  return best ? { chapterId: best.chapter.id, name: best.chapter.name, subjectId: best.subject.id, subjectName: best.subject.name, points: best.chapter.points } : null;
}

/** 建议问题：从当前星系的真实考点/章节生成，保证每条都能被检索引擎命中 */
export function buildSuggestedQuestions(store, subjectId) {
  const subject = store.knowledge.subjects.find((s) => s.id === subjectId);
  if (!subject) return [];
  const allPoints = subject.chapters.flatMap((ch) => ch.points);
  const hf = allPoints.filter((p) => p.highFreq);
  const pickHf = hf[0] ?? allPoints[0];
  const pickHf2 = hf[1] ?? allPoints[1] ?? allPoints[0];
  const ch = subject.chapters[0];
  const chLast = subject.chapters[subject.chapters.length - 1];
  if (!pickHf || !ch) return [];
  const qs = [
    `介绍一下「${pickHf.name}」`,
    `「${ch.name}」有哪些考点？`,
    `「${pickHf2.name}」和哪些考点有关？`,
    `推荐一道「${chLast?.name ?? ch.name}」的练习题`,
  ];
  return [...new Set(qs)].slice(0, 4);
}
