import { useEffect, useRef, useState } from 'react';
import { buildSuggestedQuestions } from '../data/ragEngine.js';
import { askXiaoZhi } from '../data/xiaozhiService.js';
import MathText from './MathText.jsx';

const MODE_LABELS = { online: '在线 RAG', offline: '离线演示模式' };

// 回答体：含 $...$ 公式时按需加载 Markdown+KaTeX 渲染（主包不引入 KaTeX）；
// 纯文本回答（离线整理稿）保持 pre-wrap 原样显示
function AnswerBody({ text }) {
  const [html, setHtml] = useState(null);
  useEffect(() => {
    let alive = true;
    setHtml(null);
    if (!text || !text.includes('$')) return () => { alive = false; };
    import('../data/markdownWithStyles.js')
      .then(({ renderMarkdown }) => { if (alive) setHtml(renderMarkdown(text)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [text]);
  if (html) {
    return <div className="xz-bubble xz-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  // 纯文本回答（离线整理稿等）：公式同样走 Markdown 管线，避免 ^{...} 之类原样泄漏
  return <div className="xz-bubble"><MathText text={text} /></div>;
}

// 小智：常驻悬浮入口 + 对话抽屉。只读智能体——不写掌握度/记录/题库，
// 回答全部带可点击的考点引用，点击即跳转对应星系星球。
export default function XiaoZhiPanel({ store, subjectId, open, onOpen, onClose, onCite }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const suggestions = store ? buildSuggestedQuestions(store, subjectId) : [];

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  const send = async (text) => {
    const q = String(text ?? input).trim();
    if (!q || pending || !store) return;
    const history = messages.map((m) => ({ role: m.role, content: m.text }));
    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    setInput('');
    setPending(true);
    try {
      const res = await askXiaoZhi(store, q, { history, subjectId });
      setMode(res.mode);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: res.answer, citations: res.citations, mode: res.mode, note: res.note },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: '本地检索出了点问题，请稍后再试。', citations: [], mode: 'offline' },
      ]);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        className={`xz-orb ${open ? 'open' : ''}`}
        onClick={open ? onClose : onOpen}
        aria-label={open ? '收起小智' : '打开小智 AI 助教'}
        title="小智 · 考研数学智能助教"
      >
        <span className="xz-orb-core">智</span>
        <i className="xz-orb-dot" />
      </button>
      {open && (
        <aside className="xz-panel" role="dialog" aria-label="小智智能助教">
          <header className="xz-head">
            <span className="xz-avatar">智</span>
            <div className="xz-id">
              <div className="xz-name">
                小智
                <span className={`xz-mode ${mode ?? 'idle'}`}>{mode ? MODE_LABELS[mode] : 'RAG 就绪'}</span>
              </div>
              <div className="xz-sub">考研数学智能助教 · 知识库检索增强</div>
            </div>
            <button className="xz-close" onClick={onClose} aria-label="关闭小智">×</button>
          </header>

          <div className="xz-list" ref={listRef}>
            <div className="xz-msg assistant">
              <div className="xz-bubble">
                你好，我是小智。我基于知识库检索回答问题：考点含义、数一/二/三范围、前置关联，也可以推荐练习题。回答下方的「引用」可直接跳到对应星球；我只读知识库，不会修改你的掌握度与做题记录。
              </div>
            </div>
            {messages.map((m, i) => (
              <div key={i} className={`xz-msg ${m.role}`}>
                {m.role === 'assistant' ? <AnswerBody text={m.text} /> : <div className="xz-bubble">{m.text}</div>}
                {m.role === 'assistant' && m.citations?.length > 0 && (
                  <div className="xz-cites">
                    <span className="xz-cites-label">引用</span>
                    {m.citations.map((c) => (
                      <button key={c.id} className="xz-cite" onClick={() => onCite(c.id)} title={`跳到「${c.name}」星球`}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
                {m.role === 'assistant' && m.note && <div className="xz-note">{m.note}</div>}
              </div>
            ))}
            {pending && (
              <div className="xz-msg assistant">
                <div className="xz-bubble xz-typing" aria-label="小智正在检索与思考"><i /><i /><i /></div>
              </div>
            )}
          </div>

          {messages.length === 0 && suggestions.length > 0 && (
            <div className="xz-suggest">
              {suggestions.map((s) => (
                <button key={s} className="xz-chip" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          )}

          <form className="xz-input-row" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input
              ref={inputRef}
              className="xz-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="问考点、范围、关联，或让我推荐练习题…"
              aria-label="向小智提问"
              maxLength={200}
            />
            <button className="xz-send" type="submit" disabled={pending || !input.trim()}>发送</button>
          </form>
          <div className="xz-foot">基于本地知识库检索 · 仅供学习参考 · Enter 发送</div>
        </aside>
      )}
    </>
  );
}
