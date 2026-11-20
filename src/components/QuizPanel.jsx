import { useMemo, useState } from 'react';
import { getQuestionsForPoint, getPoint } from '../data/dataService.js';
import MathText from './MathText.jsx';

const LETTERS = ['A', 'B', 'C', 'D'];
const fmt = (v) => (v == null ? '未学' : `${Math.round(v * 10) / 10}`);
const signed = (v) => (v > 0 ? `+${v}` : `${v}`);

// 考点练习：居中阅读型浮层（与知识讲解同一套布局语言）。
// 选型理由：浮层悬浮于 3D 场景之上而非独立页面——掌握度联动发生在
// 提交瞬间，用户能直接看到星球颜色过渡，空间上下文不中断；
// 居中卡片比侧边抽屉有更宽作答区（选项两列），移动端为近全屏卡片。
export default function QuizPanel({ store, pointId, onClose, onAnswer }) {
  const point = getPoint(store, pointId);
  const questions = useMemo(() => getQuestionsForPoint(store, pointId), [store, pointId]);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState(null);
  const [fillText, setFillText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState(null); // 本题结算明细（分数变化/连对奖励）
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);
  const [chapterStart] = useState(() =>
    point ? store.chapterScores.get(point.chapterId) ?? null : null
  );

  if (!point || questions.length === 0) return null;
  const q = questions[idx];
  const isLast = idx === questions.length - 1;
  const isFill = q.type === 'fill';
  const rules = store.rules;
  const chapterNow = store.chapterScores.get(point.chapterId) ?? null;

  const canSubmit = isFill ? fillText.trim().length > 0 : selected != null;

  const submit = () => {
    if (!canSubmit || submitted) return;
    const payload = isFill ? { text: fillText } : { optionIndex: selected };
    const res = onAnswer(q, payload); // 提交即结算：规则引擎 + 写记录 + 3D 联动
    setResult(res);
    setSubmitted(true);
    if (res.correct) setCorrectCount((c) => c + 1);
  };

  const next = () => {
    if (isLast) {
      setFinished(true);
    } else {
      setIdx((i) => i + 1);
      setSelected(null);
      setFillText('');
      setSubmitted(false);
      setResult(null);
    }
  };

  const optionClass = (i) => {
    if (!submitted) return i === selected ? 'selected' : '';
    if (i === q.answer) return 'correct';
    if (i === selected) return 'wrong';
    return 'dim';
  };

  return (
    <div className="quiz-overlay">
      <div className="quiz-drawer" key={pointId} role="dialog" aria-label={`${point.name} · 考点练习`}>
        <button className="info-close" onClick={onClose} aria-label="关闭">×</button>

        {!finished ? (
          <>
            <div className="quiz-header">
              <span className="quiz-tag">考点练习</span>
              <h3>{point.name}</h3>
              <div className="quiz-sub">{store.chapters.get(point.chapterId)?.name}</div>
              <div className="quiz-progress">
                <span>第 {idx + 1} / {questions.length} 题</span>
                <div className="quiz-bar">
                  <div className="quiz-bar-fill" style={{ width: `${((idx + (submitted ? 1 : 0)) / questions.length) * 100}%` }} />
                </div>
              </div>
              <div className="quiz-rules">
                答对 +{rules.baseScore}×难度系数 · 答错 −同值 · 连对 {rules.streakLength} 题 +{rules.streakBonus}
              </div>
            </div>

            <p className="quiz-stem" data-qid={q.id}><MathText text={q.stem} /></p>

            {isFill ? (
              <div className={`quiz-fill ${submitted ? (result.correct ? 'correct' : 'wrong') : ''}`}>
                <input
                  type="text"
                  value={fillText}
                  disabled={submitted}
                  placeholder="输入答案，回车提交"
                  onChange={(e) => setFillText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  aria-label="填空答案"
                />
                {submitted && <span className="quiz-fill-answer">答案：<MathText text={q.accept[0]} /></span>}
              </div>
            ) : (
              <div className="quiz-options">
                {q.options.map((opt, i) => (
                  <button
                    key={i}
                    className={`quiz-option ${optionClass(i)}`}
                    disabled={submitted}
                    onClick={() => setSelected(i)}
                  >
                    <span className="quiz-letter">{LETTERS[i]}</span>
                    <span><MathText text={opt} /></span>
                  </button>
                ))}
              </div>
            )}

            {submitted && result && (
              <div className={`quiz-analysis ${result.correct ? 'right' : 'wrong'}`}>
                <div className="quiz-verdict">
                  {result.correct ? '回答正确' : '回答错误'}
                </div>
                <div className="quiz-ref">
                  <span className="quiz-ref-label">参考答案</span>
                  <span className="quiz-ref-value">
                    {isFill ? (
                      <MathText text={q.accept[0]} />
                    ) : (
                      <>
                        <b>{LETTERS[q.answer]}.</b>{' '}
                        <MathText text={q.options[q.answer]} />
                      </>
                    )}
                  </span>
                </div>
                <div className="quiz-delta">
                  <div>
                    本题 {signed(result.chapter.delta)} 分（基础 {rules.baseScore} × 难度 {result.coef}）
                    {result.pointChanges.some((c) => c.bonus > 0) && (
                      <span className="quiz-bonus">连对 {rules.streakLength} 题 · 稳定掌握 +{rules.streakBonus}</span>
                    )}
                  </div>
                  {result.pointChanges.map((c) => (
                    <div key={c.pointId}>
                      考点「{getPoint(store, c.pointId)?.name}」 {fmt(c.before)} → {fmt(c.after)}
                    </div>
                  ))}
                  <div>
                    章节「{store.chapters.get(q.chapterId)?.name}」 {fmt(result.chapter.before)} → {fmt(result.chapter.after)}
                  </div>
                </div>
                <p className="quiz-explain"><MathText text={q.analysis} /></p>
              </div>
            )}

            <div className="quiz-footer">
              {!submitted ? (
                <button className="practice-btn" disabled={!canSubmit} onClick={submit}>
                  提交答案
                </button>
              ) : (
                <button className="practice-btn" onClick={next}>
                  {isLast ? '查看结果' : '下一题'}
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="quiz-result">
            <div className="quiz-score" style={{ color: correctCount === questions.length ? '#2ee6c8' : correctCount === 0 ? '#ff9440' : '#6aa5ff' }}>
              {correctCount}<span className="quiz-score-total">/{questions.length}</span>
            </div>
            <div className="quiz-score-label">本次答对题数</div>
            <div className="quiz-chapter-change">
              章节掌握度 {fmt(chapterStart)} → {fmt(chapterNow)}
              {chapterStart != null && chapterNow != null && (
                <span className={chapterNow >= chapterStart ? 'up' : 'down'}>
                  （{signed(Math.round((chapterNow - chapterStart) * 10) / 10)}）
                </span>
              )}
            </div>
            <p className="quiz-score-tip">
              分数已写入做题记录，星球与星团标签已同步更新。
              {correctCount < questions.length && '答错的考点已按规则扣分，建议回顾解析后再练一组。'}
            </p>
            <button className="practice-btn" onClick={onClose}>
              完成 · 返回星图
            </button>
          </div>
        )}
      </div>
    </div>
  );
}