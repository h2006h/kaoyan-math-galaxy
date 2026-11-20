// ─────────────────────────────────────────────────────────────
// 统一数据加载模块：场景层与 UI 层唯一的数据入口。
// 开发阶段读本地 JSON；接后端时只需把 DATA_BASE 换成 API 地址
// （或给 fetchJson 加鉴权头），其余代码零改动。
// ─────────────────────────────────────────────────────────────

import { judgeAnswer, settleAnswer, replayAccount } from './masteryEngine.js';
import { loadRecords, appendRecord, clearRecords } from './recordStore.js';

const DATA_BASE = '/data'; // 后期: import.meta.env.VITE_API_BASE ?? '/data'
const IMPORT_KEY = 'kmu:question_bank_imported'; // 管理员确认入库的题（演示环境持久化；接后端后换成 POST /api/questions）

// 账号体系见 userStore.js（用户表 + 登录/注册）；数据层默认以演示账号的种子状态启动，
// 登录成功后由 App 调用 loadAccount(store, user.id) 切换到真实用户。
const DEFAULT_ACCOUNT_ID = 'demo-001';

let cache = null;
let inflight = null;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`数据加载失败 ${url}: HTTP ${res.status}`);
  return res.json();
}

/**
 * 加载全部数据文件（带缓存与并发去重）。
 * @param {(percent:number)=>void} onProgress 0-100，按文件粒度推进
 * @returns {Promise<DataStore>}
 */
export async function loadData({ onProgress } = {}) {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const files = ['knowledge.json', 'relations.json', 'question_bank.json', 'demo_mastery.json', 'mastery_rules.json'];
    const loaded = [];
    for (let i = 0; i < files.length; i++) {
      loaded.push(await fetchJson(`${DATA_BASE}/${files[i]}`));
      onProgress?.(((i + 1) / files.length) * 100);
    }
    const [k, r, b, d, rules] = loaded;

    const store = {
      knowledge: k,
      relations: r.relations,
      questions: b.questions,
      rules,                                   // 掌握度规则参数（答辩调参只改 JSON）
      demoSeeds: d.mastery,                    // 演示账号种子分
      points: new Map(),
      chapters: new Map(),
      questionsByPoint: new Map(),
      chapterOf: {},                           // pointId -> chapterId
      userId: null,
      mastery: new Map(),                      // 当前账号：pointId -> score|null
      chapterScores: new Map(),                // 当前账号：chapterId -> score|null
      streaks: {},                             // 当前账号：pointId -> 连对数（由记录重放推导）
      records: [],                             // 当前账号：持久化做题记录
    };

    for (const subject of k.subjects) {
      for (const ch of subject.chapters) {
        store.chapters.set(ch.id, ch);
        for (const p of ch.points) {
          store.points.set(p.id, p);
          store.chapterOf[p.id] = ch.id;
        }
      }
    }
    for (const q of b.questions) {
      for (const pid of q.pointIds) {
        if (!store.questionsByPoint.has(pid)) store.questionsByPoint.set(pid, []);
        store.questionsByPoint.get(pid).push(q);
      }
    }

    // 合并管理员已确认入库的题（localStorage 持久化，刷新不丢）
    store.imported = [];
    try {
      const saved = JSON.parse(localStorage.getItem(IMPORT_KEY) || '[]');
      for (const q of saved) {
        if (!q?.id || store.questions.some((x) => x.id === q.id)) continue;
        if (!store.chapters.has(q.chapterId) || !q.pointIds?.every((pid) => store.points.has(pid))) continue;
        store.imported.push(q);
        store.questions.push(q);
        for (const pid of q.pointIds) {
          if (!store.questionsByPoint.has(pid)) store.questionsByPoint.set(pid, []);
          store.questionsByPoint.get(pid).push(q);
        }
      }
    } catch { /* 损坏数据降级为忽略，不阻塞场景 */ }

    // 开发期轻量自检（完整校验走 scripts/validate-data.mjs，不进浏览器包）
    if (import.meta.env.DEV) {
      for (const rel of store.relations) {
        if (!store.points.has(rel.sourceId) || !store.points.has(rel.targetId)) {
          console.warn('[dataService] 关联引用了不存在的考点:', rel);
        }
      }
    }

    loadAccount(store, DEFAULT_ACCOUNT_ID);
    cache = store;
    return store;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/**
 * 切换/加载账号：种子分（仅演示账号）+ 该账号持久化记录 → 重放出当前状态。
 * 连对数同样由记录流推导，因此跨会话、跨刷新结果一致。
 */
export function loadAccount(store, userId) {
  store.userId = userId;
  store.records = loadRecords(userId);
  const seeds = userId === 'demo-001' ? store.demoSeeds : {};
  const { pointScores, chapterScores, streaks } = replayAccount(
    { seedPointScores: seeds, chapterOf: store.chapterOf, records: store.records },
    store.rules
  );
  store.mastery = new Map([...store.points.keys()].map((id) => [id, pointScores[id] ?? null]));
  store.chapterScores = new Map([...store.chapters.keys()].map((id) => [id, chapterScores[id] ?? null]));
  store.streaks = streaks;
  return store;
}

/** 重置当前账号做题记录并重放（演示可重复进行） */
export function resetAccount(store) {
  clearRecords(store.userId);
  return loadAccount(store, store.userId);
}

const STRENGTH_MAP = [0, 0.35, 0.65, 1.0]; // 数据强度 1-3 → 渲染亮度

/** 默认星系：高等数学 */
export const DEFAULT_SUBJECT_ID = 'advanced-math';

/** 星系（科目）清单：供切换器渲染，shortName 用于窄屏 */
export function getSubjects(store) {
  return store.knowledge.subjects.map(({ id, name, shortName }) => ({ id, name, shortName: shortName ?? name }));
}

/**
 * 把规范化的数据装配成 3D 场景消费的视图模型（含当前账号掌握度）。
 * 章节掌握度由规则引擎维护（replayAccount / submitAnswer）。
 */
export function buildGalaxyView(store, subjectId = DEFAULT_SUBJECT_ID) {
  const subject = store.knowledge.subjects.find((s) => s.id === subjectId);
  if (!subject) throw new Error(`未知科目: ${subjectId}`);

  const clusters = subject.chapters.map((ch) => ({
    id: ch.id,
    name: ch.name,
    masteryPercent: chapterMastery(store, ch.id),
    planets: ch.points.map((p) => ({
      id: p.id,
      name: p.name,
      desc: p.desc,
      highFreq: p.highFreq,
      difficulty: p.difficulty,
      examScope: p.examScope,
      mastery: store.mastery.get(p.id) ?? null,
    })),
  }));

  // 只保留当前星系内部的关联：跨科目连线在场景中找不到两端星球
  const pointIds = new Set(subject.chapters.flatMap((ch) => ch.points.map((p) => p.id)));
  const links = store.relations
    .filter((r) => pointIds.has(r.sourceId) && pointIds.has(r.targetId))
    .map((r) => ({
      from: r.sourceId,
      to: r.targetId,
      type: r.type,
      strength: STRENGTH_MAP[r.strength] ?? 0.5,
    }));

  return { subject: subject.name, subjectId: subject.id, clusters, links, thresholds: store.rules.thresholds };
}

/** 章节级掌握度：规则引擎维护的章节分；无记录返回 null（未学，不显示 50） */
export function chapterMastery(store, chapterId) {
  return store.chapterScores.get(chapterId) ?? null;
}

/**
 * 做题提交唯一入口：判题 → 规则结算 → 写记录 → 更新账号状态。
 * 返回完整分数变化明细，供 UI 展示与 3D 联动。
 */
export function submitAnswer(store, question, payload) {
  const correct = judgeAnswer(question, payload);
  const pointScores = {};
  for (const pid of question.pointIds) pointScores[pid] = store.mastery.get(pid) ?? null;

  const result = settleAnswer(
    {
      question,
      correct,
      pointScores,
      chapterScore: store.chapterScores.get(question.chapterId) ?? null,
      streaks: store.streaks,
    },
    store.rules
  );

  const pointDeltas = {};
  for (const c of result.pointChanges) {
    store.mastery.set(c.pointId, c.after);
    store.streaks[c.pointId] = c.streak;
    pointDeltas[c.pointId] = c.delta;
  }
  store.chapterScores.set(question.chapterId, result.chapter.after);

  const rec = appendRecord(store.userId, {
    questionId: question.id,
    chapterId: question.chapterId,
    pointIds: question.pointIds,
    correct,
    difficulty: question.difficulty,
    chapterDelta: result.chapter.delta,
    pointDeltas,
  });
  store.records.push(rec);

  return { ...result, record: rec };
}

/** 星球面板「开始做题」：按关联考点抽题，难度升序，最多 questionsPerRound 道 */
export function getQuestionsForPoint(store, pointId, limit = store.rules.questionsPerRound) {
  const list = store.questionsByPoint.get(pointId) ?? [];
  return [...list].sort((a, b) => a.difficulty - b.difficulty).slice(0, limit);
}

export function getPoint(store, pointId) {
  return store.points.get(pointId) ?? null;
}

/** 管理员确认入库的唯一写入入口：追加题目、更新抽题索引、持久化（接后端后此处换成 POST /api/questions） */
export function addImportedQuestions(store, questions) {
  for (const q of questions) {
    if (!q?.id || store.questions.some((x) => x.id === q.id)) continue;
    store.questions.push(q);
    store.imported.push(q);
    for (const pid of q.pointIds) {
      if (!store.questionsByPoint.has(pid)) store.questionsByPoint.set(pid, []);
      store.questionsByPoint.get(pid).push(q);
    }
  }
  localStorage.setItem(IMPORT_KEY, JSON.stringify(store.imported));
}
