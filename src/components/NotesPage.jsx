import { useEffect, useMemo, useRef, useState } from 'react';
import 'katex/dist/katex.min.css';
import { loadNotes } from '../data/notesService.js';
import { renderMarkdown } from '../data/markdown.js';
import MathText from './MathText.jsx';

const SCOPES = ['数一', '数二', '数三'];
const DIFF = ['', '★', '★★', '★★★'];

// 知识点讲解页：Markdown 正文 + KaTeX 公式，右侧关联考点与相关题目。
// 全屏阅读页（区别于做题抽屉），章节内可上一个/下一个连续阅读。
export default function NotesPage({ store, pointId, onClose, onChangePoint, onPractice }) {
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState(null);
  const [opened, setOpened] = useState(() => new Set());
  const scrollRef = useRef(null);

  useEffect(() => {
    let alive = true;
    loadNotes()
      .then((n) => alive && setNotes(n))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    setOpened(new Set());
    scrollRef.current?.scrollTo(0, 0);
  }, [pointId]);

  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  const info = useMemo(() => {
    if (!store || !pointId) return null;
    const point = store.points.get(pointId);
    if (!point) return null;
    const chapter = store.chapters.get(point.chapterId);
    const subject = store.knowledge.subjects.find((s) => s.chapters.some((ch) => ch.id === chapter.id));
    const all = subject.chapters.flatMap((ch) => ch.points);
    const idx = all.findIndex((p) => p.id === pointId);
    const relations = [];
    for (const r of store.relations) {
      if (r.sourceId === pointId) {
        const p = store.points.get(r.targetId);
        if (p) relations.push({ id: p.id, name: p.name, kind: r.type === 'prerequisite' ? '后续' : '关联' });
      } else if (r.targetId === pointId) {
        const p = store.points.get(r.sourceId);
        if (p) relations.push({ id: p.id, name: p.name, kind: '前置' });
      }
    }
    const questions = (store.questionsByPoint.get(pointId) ?? []).slice(0, 3);
    return { point, chapter, subject, all, idx, relations, questions };
  }, [store, pointId]);

  if (!info) return null;
  const { point, chapter, subject, all, idx, relations, questions } = info;
  const html = notes?.[pointId] ? renderMarkdown(notes[pointId]) : null;
  const prev = idx > 0 ? all[idx - 1] : null;
  const next = idx >= 0 && idx < all.length - 1 ? all[idx + 1] : null;

  return (
    <div className="notes-overlay" role="dialog" aria-label={`${point.name} · 知识讲解`}>
      <div className="notes-page">
        <header className="notes-head">
          <button className="notes-back" onClick={onClose} aria-label="返回星图">← 返回星图</button>
          <div className="notes-pager">
            <button
              className="notes-nav"
              data-dir="prev"
              disabled={!prev}
              onClick={() => prev && onChangePoint(prev.id)}
              title={prev ? prev.name : '已是第一个考点'}
            >
              ← 上一个
            </button>
            <span className="notes-pos">{idx + 1} / {all.length}</span>
            <button
              className="notes-nav"
              data-dir="next"
              disabled={!next}
              onClick={() => next && onChangePoint(next.id)}
              title={next ? next.name : '已是最后一个考点'}
            >
              下一个 →
            </button>
          </div>
          <button className="notes-close" onClick={onClose} aria-label="关闭讲解">×</button>
        </header>

        <div className="notes-scroll" ref={scrollRef}>
          <div className="notes-crumb">{subject.name} · {chapter.name}</div>
          <div className="notes-title-row">
            <h1 className="notes-title">{point.name}</h1>
            <div className="notes-badges">
              {point.highFreq && <span className="hot-badge">高频考点</span>}
              {[1, 2, 3].map((n) => (
                <span key={n} className={`scope-chip ${point.examScope?.includes(n) ? 'on' : 'off'}`}>
                  {SCOPES[n - 1]}
                </span>
              ))}
            </div>
            <button className="notes-practice" onClick={() => onPractice(point.id)}>开始做题</button>
          </div>

          {!notes && !error && <div className="notes-state">正在加载讲解内容…</div>}
          {error && <div className="notes-state error">{error}</div>}

          {html && (
            <div className="notes-grid">
              <article className="note-md" dangerouslySetInnerHTML={{ __html: html }} />
              <aside className="notes-side">
                {relations.length > 0 && (
                  <section className="notes-card">
                    <h4>关联考点</h4>
                    <div className="notes-rel-list">
                      {relations.map((r) => (
                        <button key={`${r.id}-${r.kind}`} className="notes-rel" onClick={() => onChangePoint(r.id)}>
                          <span className="notes-rel-kind">{r.kind}</span>
                          <span>{r.name}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {questions.length > 0 && (
                  <section className="notes-card">
                    <h4>相关题目</h4>
                    {questions.map((q) => {
                      const open = opened.has(q.id);
                      const answerText = q.type === 'single'
                        ? q.options?.[q.answer] ?? ''
                        : q.accept?.[0] ?? '';
                      return (
                        <div key={q.id} className="notes-q">
                          <div className="notes-q-stem"><MathText text={q.stem} /></div>
                          <div className="notes-q-meta">
                            <span>{q.type === 'fill' ? '填空题' : '单选题'} · 难度 {DIFF[q.difficulty] ?? q.difficulty}</span>
                            <button
                              className="notes-q-toggle"
                              onClick={() => setOpened((prevSet) => {
                                const s = new Set(prevSet);
                                if (s.has(q.id)) s.delete(q.id); else s.add(q.id);
                                return s;
                              })}
                            >
                              {open ? '收起解析' : '查看解析'}
                            </button>
                          </div>
                          {open && (
                            <div className="notes-q-analysis">
                              <div>
                                参考答案：
                                {q.type === 'single' && `${'ABCD'[q.answer]}. `}
                                <MathText text={answerText} />
                              </div>
                              {q.analysis && <div>解析：<MathText text={q.analysis} /></div>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </section>
                )}
                <div className="notes-tip">讲解内容按教材通用口径编写；数一/二/三范围以大纲标注为准。</div>
              </aside>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
