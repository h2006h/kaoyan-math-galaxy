// ─────────────────────────────────────────────────────────────
// 掌握度规则引擎：纯函数，不读写任何存储，可单测、可答辩逐行讲。
// 全部参数来自 public/data/mastery_rules.json（答辩前调参只改 JSON）。
//
// 规则（章节级与考点级共用同一套加减分）：
//   做对  +基础分 × 难度系数；做错  −基础分 × 难度系数
//   同一考点连续做对 streakLength 题，额外 +streakBonus（稳定掌握）
//   首次作答从 initialScore(50) 起算；无记录保持 null（未学）
//   分数截断到 [minScore, maxScore]
// ─────────────────────────────────────────────────────────────

/** 填空题答案归一化：去空白、统一小写、上标转 ^、全角括号转半角 */
export function normalizeFillText(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/（/g, '(')
    .replace(/）/g, ')');
}

/** 判题：single 传 {optionIndex}，fill 传 {text} */
export function judgeAnswer(question, payload) {
  if (question.type === 'fill') {
    const input = normalizeFillText(payload?.text);
    return input.length > 0 && question.accept.some((a) => normalizeFillText(a) === input);
  }
  return payload?.optionIndex === question.answer;
}

const clampScore = (v, rules) =>
  Math.round(Math.min(rules.maxScore, Math.max(rules.minScore, v)) * 10) / 10;

/**
 * 单题结算（纯函数）。
 * @param ctx.question   题目对象
 * @param ctx.correct    判题结果
 * @param ctx.pointScores  {pointId: score|null} 各关联考点当前分
 * @param ctx.chapterScore 章节当前分（null = 本章尚无记录）
 * @param ctx.streaks      {pointId: 当前连对数}
 * @returns 分数变化明细：考点逐项 before/after/delta/bonus/streak + 章节 before/after/delta
 *
 * 说明：一题关联多个考点时，各考点同加同减（口径：这道题会了，
 * 它覆盖的每个考点都受益）；章节分只按对错加减基础分，连对奖励
 * 只加给考点——章节反映整体对错，考点奖励稳定掌握。
 */
export function settleAnswer({ question, correct, pointScores, chapterScore, streaks }, rules) {
  const coef = rules.difficultyCoeff[String(question.difficulty)] ?? 1;
  const base = rules.baseScore * coef;
  const sign = correct ? 1 : -1;

  const pointChanges = question.pointIds.map((pid) => {
    const streak = correct ? (streaks[pid] ?? 0) + 1 : 0;
    const bonus = correct && streak > 0 && streak % rules.streakLength === 0 ? rules.streakBonus : 0;
    const delta = sign * base + bonus;
    const before = pointScores[pid] ?? null;
    const after = clampScore((before ?? rules.initialScore) + delta, rules);
    return { pointId: pid, before, after, delta, bonus, streak };
  });

  const chapterDelta = sign * base;
  const chapter = {
    before: chapterScore ?? null,
    after: clampScore((chapterScore ?? rules.initialScore) + chapterDelta, rules),
    delta: chapterDelta,
  };

  return { correct, base, coef, pointChanges, chapter };
}

/**
 * 账号状态重放：种子分 + 持久化做题记录 → 当前各考点/章节分数与连对数。
 * 跨会话处理的关键：连对数不存内存，而是从按时间排序的记录流里
 * 重新推导（对→+1，错→清零），刷新、换设备登录都能得到一致结果。
 * @param seedPointScores 演示账号种子分（注册用户传 {}）
 * @param chapterOf       {pointId: chapterId}
 * @param records         按时间升序的做题记录（含 correct / pointDeltas / chapterDelta）
 */
export function replayAccount({ seedPointScores, chapterOf, records }, rules) {
  const pointScores = { ...seedPointScores };
  const chapterScores = {};
  const streaks = {};

  // 章节种子分 = 章内已测考点均分（与演示快照的视觉初始态一致）
  const chapterSeeds = {};
  for (const [pid, score] of Object.entries(seedPointScores)) {
    const ch = chapterOf[pid];
    if (!ch || score == null) continue;
    (chapterSeeds[ch] ??= []).push(score);
  }
  for (const [ch, scores] of Object.entries(chapterSeeds)) {
    chapterScores[ch] = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  for (const rec of records) {
    for (const pid of rec.pointIds) {
      const delta = rec.pointDeltas[pid] ?? 0;
      pointScores[pid] = clampScore((pointScores[pid] ?? rules.initialScore) + delta, rules);
      streaks[pid] = rec.correct ? (streaks[pid] ?? 0) + 1 : 0;
    }
    chapterScores[rec.chapterId] = clampScore(
      (chapterScores[rec.chapterId] ?? rules.initialScore) + rec.chapterDelta,
      rules
    );
  }

  return { pointScores, chapterScores, streaks };
}