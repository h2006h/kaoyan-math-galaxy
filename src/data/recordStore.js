// ─────────────────────────────────────────────────────────────
// 做题记录持久化：演示账号与注册用户共用同一套读写逻辑，按 user_id 隔离。
// 当前落地为 localStorage（键 kmu:records:{userId}），接口形状与后端
// REST 一致——接后端时只需把三个函数换成 fetch，调用方零改动。
//
// 对应后端表结构（DDL 见 docs/mastery-and-records.md）：
//   quiz_record(id, user_id, question_id, chapter_id, point_ids,
//               correct, difficulty, chapter_delta, point_deltas, created_at)
// ─────────────────────────────────────────────────────────────

const KEY = (userId) => `kmu:records:${userId}`;

/** 读取某账号全部记录（按时间升序）。损坏数据降级为空数组，不阻塞场景。 */
export function loadRecords(userId) {
  try {
    const raw = localStorage.getItem(KEY(userId));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.sort((a, b) => a.timestamp - b.timestamp) : [];
  } catch {
    return [];
  }
}

/** 追加一条记录（写入逻辑唯一入口）。返回写入后的完整记录。 */
export function appendRecord(userId, record) {
  const rec = {
    id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    userId,
    questionId: record.questionId,
    chapterId: record.chapterId,
    pointIds: record.pointIds,
    correct: record.correct,
    difficulty: record.difficulty,
    chapterDelta: record.chapterDelta,   // 本次分数变化：章节
    pointDeltas: record.pointDeltas,     // 本次分数变化：各关联考点（含连对奖励）
    timestamp: Date.now(),
  };
  const list = loadRecords(userId);
  list.push(rec);
  localStorage.setItem(KEY(userId), JSON.stringify(list));
  return rec;
}

/** 清空某账号记录（演示重置用），不影响其他账号。 */
export function clearRecords(userId) {
  localStorage.removeItem(KEY(userId));
}