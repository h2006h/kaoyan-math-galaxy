import { useEffect, useMemo, useRef, useState } from 'react';
import {
  downloadTemplate, parseImportFile, formToItem, completeness, itemToQuestion,
} from '../data/questionImport.js';
import { checkItems } from '../data/aiCheckService.js';
import { addImportedQuestions } from '../data/dataService.js';
import MathText from './MathText.jsx';

const DIFF_LABELS = { 1: '基础', 2: '中等', 3: '强化' };
const LETTERS = ['A', 'B', 'C', 'D'];

const emptyForm = () => ({
  type: 'single', stem: '', options: ['', '', '', ''], answer: -1, accept: '',
  analysis: '', chapterId: '', difficulty: 1, pointIds: [],
});

/** 题目字段编辑器：逐题录入表单与待确认项的「修改」共用同一组件 */
function ItemEditor({ value, store, onChange }) {
  const points = value.chapterId
    ? [...store.points.values()].filter((p) => p.chapterId === value.chapterId)
    : [];
  const set = (patch) => onChange({ ...value, ...patch });

  const togglePoint = (pid) => set({
    pointIds: value.pointIds.includes(pid)
      ? value.pointIds.filter((x) => x !== pid)
      : [...value.pointIds, pid],
  });

  return (
    <div className="admin-editor">
      <div className="admin-field-row">
        <label className="admin-field">
          <span>题型</span>
          <select
            value={value.type}
            onChange={(e) => set(e.target.value === 'fill'
              ? { type: 'fill', options: [], answer: -1, accept: Array.isArray(value.accept) ? value.accept.join('；') : value.accept }
              : { type: 'single', options: ['', '', '', ''], answer: -1, accept: [] })}
          >
            <option value="single">单选题</option>
            <option value="fill">填空题</option>
          </select>
        </label>
        <label className="admin-field">
          <span>章节</span>
          <select value={value.chapterId} onChange={(e) => set({ chapterId: e.target.value, pointIds: [] })}>
            <option value="">请选择章节</option>
            {store.knowledge.subjects.map((s) => (
              <optgroup key={s.id} label={s.name}>
                {s.chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>难度</span>
          <select value={value.difficulty} onChange={(e) => set({ difficulty: Number(e.target.value) })}>
            {[1, 2, 3].map((d) => <option key={d} value={d}>{d} · {DIFF_LABELS[d]}</option>)}
          </select>
        </label>
      </div>

      <label className="admin-field">
        <span>题干</span>
        <textarea rows={2} value={value.stem} placeholder="支持 Unicode 数学符号，如 lim(x→0) (1−cosx)/x²"
          onChange={(e) => set({ stem: e.target.value })} />
      </label>

      {value.type === 'single' ? (
        <>
          <div className="admin-options">
            {LETTERS.map((L, i) => (
              <label className="admin-field" key={L}>
                <span>选项 {L}</span>
                <input value={value.options[i] ?? ''}
                  onChange={(e) => set({ options: value.options.map((o, j) => (j === i ? e.target.value : o)) })} />
              </label>
            ))}
          </div>
          <label className="admin-field">
            <span>正确答案</span>
            <select value={value.answer} onChange={(e) => set({ answer: Number(e.target.value) })}>
              <option value={-1}>请选择</option>
              {LETTERS.map((L, i) => <option key={L} value={i}>{L}</option>)}
            </select>
          </label>
        </>
      ) : (
        <label className="admin-field">
          <span>可接受答案（多个用 ; 分隔，判题时忽略大小写/空格/上标写法）</span>
          <input
            value={Array.isArray(value.accept) ? value.accept.join('；') : value.accept}
            placeholder="如：x^2+C；x²+C"
            onChange={(e) => set({ accept: e.target.value })}
          />
        </label>
      )}

      <label className="admin-field">
        <span>解析</span>
        <textarea rows={2} value={value.analysis} onChange={(e) => set({ analysis: e.target.value })} />
      </label>

      <div className="admin-field">
        <span>关联考点{value.chapterId ? '' : '（先选章节）'}</span>
        <div className="admin-chips">
          {points.map((p) => (
            <button type="button" key={p.id}
              className={`admin-chip ${value.pointIds.includes(p.id) ? 'on' : ''}`}
              onClick={() => togglePoint(p.id)}>
              {p.name}{p.hot ? ' ★' : ''}
            </button>
          ))}
          {!points.length && <em>{value.chapterId ? '该章节下暂无考点' : '请先选择章节，再勾选关联考点'}</em>}
        </div>
      </div>
    </div>
  );
}

/** 待确认项卡片：完整性标记 + AI 建议（可采纳/可无视）+ 编辑 + 确认入库 */
function PendingCard({ item, suggestion, store, onChange, onConfirm, onDelete }) {
  const [editing, setEditing] = useState(false);
  const missing = completeness(item);
  const complete = missing.length === 0;
  const chapterName = store.chapters.get(item.chapterId)?.name;
  const suggested = suggestion?.suggestedChapterId;
  const canAdopt = suggested && suggested !== item.chapterId;

  // 编辑草稿：保存时才写回，取消不污染原项
  const [draft, setDraft] = useState(item);
  const startEdit = () => { setDraft({ ...item, accept: item.accept.join('；') }); setEditing(true); };
  const saveEdit = () => {
    onChange({
      ...draft,
      accept: draft.type === 'fill'
        ? String(draft.accept).split(/[;|；]/).map((s) => s.trim()).filter(Boolean)
        : [],
    });
    setEditing(false);
  };

  return (
    <article className={`admin-card ${complete ? 'complete' : 'incomplete'}`} data-key={item.key}>
      <header className="admin-card-head">
        <span className={`admin-type ${item.type}`}>{item.type === 'fill' ? '填空' : '单选'}</span>
        <span className="admin-source">{item.source}{item.line ? ` · 第 ${item.line} 行` : ''}</span>
        {complete
          ? <span className="admin-ok">字段完整</span>
          : <span className="admin-missing">待补充：{missing.join('、')}</span>}
      </header>

      {editing ? (
        <>
          <ItemEditor value={draft} store={store} onChange={setDraft} />
          <div className="admin-card-actions">
            <button className="admin-btn primary" onClick={saveEdit}>保存修改</button>
            <button className="admin-btn" onClick={() => setEditing(false)}>取消</button>
          </div>
        </>
      ) : (
        <>
          <p className="admin-stem">{item.stem ? <MathText text={item.stem} /> : <em>（题干缺失）</em>}</p>
          {item.type === 'single' ? (
            <ul className="admin-opts">
              {item.options.map((o, i) => (
                <li key={i} className={i === item.answer ? 'answer' : ''}>
                  <b>{LETTERS[i]}</b><MathText text={o || '—'} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-accept">可接受答案：<MathText text={item.accept.join(' / ') || '—'} /></p>
          )}
          <p className="admin-meta">
            {chapterName ?? '未分类'} · 难度 {item.difficulty || '—'} ·
            考点 {item.pointIds.map((pid) => store.points.get(pid)?.name ?? pid).join('、') || '未关联'}
          </p>
          {item.analysis && <p className="admin-analysis">解析：<MathText text={item.analysis} /></p>}

          {suggestion && (
            <div className="admin-ai">
              <div className="admin-ai-title">
                AI 建议<em>仅供参考，管理员可修改或忽略</em>
              </div>
              {suggested ? (
                <div className="admin-ai-row">
                  <span>
                    归类建议：<b>{store.chapters.get(suggested)?.name ?? suggested}</b>
                    <small>{suggestion.reason}</small>
                  </span>
                  <button className="admin-btn adopt" disabled={!canAdopt}
                    onClick={() => onChange({ ...item, chapterId: suggested, pointIds: [] })}>
                    {canAdopt ? '采纳' : '已一致'}
                  </button>
                </div>
              ) : (
                <div className="admin-ai-row"><span>归类建议：无<small>{suggestion.reason}</small></span></div>
              )}
              {!!suggestion.formatIssues?.length && (
                <ul className="admin-ai-issues">
                  {suggestion.formatIssues.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              )}
            </div>
          )}

          <div className="admin-card-actions">
            <button className="admin-btn primary" disabled={!complete}
              title={complete ? '写入题库并持久化' : '补全缺失字段后才能入库'}
              onClick={onConfirm}>
              确认入库
            </button>
            <button className="admin-btn" onClick={startEdit}>修改</button>
            <button className="admin-btn danger" onClick={onDelete}>删除</button>
          </div>
        </>
      )}
    </article>
  );
}

export default function AdminWorkspace({ store, onClose, onImported }) {
  const [items, setItems] = useState([]);
  const [aiResults, setAiResults] = useState({});
  const [mode, setMode] = useState(null); // null 未检查 | 'online' | 'offline'
  const [aiError, setAiError] = useState(null);
  const [checking, setChecking] = useState(false);
  const [forceOffline, setForceOffline] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [filter, setFilter] = useState('all');
  const [notices, setNotices] = useState([]);
  const fileRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pending = items.filter((i) => i.status === 'pending');
  const confirmedCount = items.length - pending.length;
  const readyCount = pending.filter((i) => completeness(i).length === 0).length;

  const visible = useMemo(() => items.filter((i) => {
    if (filter === 'confirmed') return i.status === 'confirmed';
    if (filter === 'incomplete') return i.status === 'pending' && completeness(i).length > 0;
    if (filter === 'ready') return i.status === 'pending' && completeness(i).length === 0;
    if (filter === 'pending') return i.status === 'pending';
    return true;
  }), [items, filter]);

  const patchItem = (key, next) => setItems((list) => list.map((i) => (i.key === key ? { ...next, key } : i)));

  const confirmItems = (targets) => {
    const questions = targets.map((i) => itemToQuestion(i));
    addImportedQuestions(store, questions); // 唯一写入入口：题库 + 抽题索引 + 持久化
    const keys = new Set(targets.map((i) => i.key));
    setItems((list) => list.map((i) => (keys.has(i.key) ? { ...i, status: 'confirmed' } : i)));
    onImported?.(questions.length);
  };

  const runAiCheck = async () => {
    if (!pending.length || checking) return;
    setChecking(true);
    setAiError(null);
    const { mode: m, results, error } = await checkItems(pending, store, { forceOffline });
    setAiResults((prev) => ({ ...prev, ...results }));
    setMode(m);
    setAiError(error ?? null);
    setChecking(false);
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { items: parsed, errors } = await parseImportFile(file, store);
      setItems((list) => [...list, ...parsed]);
      setNotices(errors);
      if (!parsed.length && !errors.length) setNotices(['未解析到数据行']);
    } catch (err) {
      setNotices([`文件解析失败：${err.message}（请使用模板格式）`]);
    }
  };

  const submitForm = () => {
    const item = formToItem(form);
    setItems((list) => [...list, item]);
    setForm(emptyForm());
    setFilter('all');
  };

  return (
    <div className="admin-overlay" role="dialog" aria-label="题库管理工作台">
      <div className="admin-panel">
        <header className="admin-head">
          <div>
            <h2>题库管理工作台</h2>
            <p className="admin-sub">
              题库 {store.questions.length} 题 · 待确认 {pending.length} · 可入库 {readyCount} · 本次已入库 {confirmedCount}
            </p>
          </div>
          <div className="admin-head-right">
            {mode === 'offline' && (
              <span className="admin-mode offline" title={aiError ?? '使用本地预置规则给出建议'}>
                离线演示模式{aiError ? `（${aiError}）` : ''}
              </span>
            )}
            {mode === 'online' && <span className="admin-mode online">DeepSeek 在线</span>}
            <button className="admin-close" onClick={onClose} aria-label="关闭工作台">✕</button>
          </div>
        </header>

        <div className="admin-toolbar">
          <button className="admin-btn" onClick={downloadTemplate}>下载模板</button>
          <button className="admin-btn" onClick={() => fileRef.current?.click()}>批量上传 CSV / Excel</button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={onFile} />
          <button className={`admin-btn ${showForm ? 'active' : ''}`} onClick={() => setShowForm((v) => !v)}>
            逐题录入
          </button>
          <span className="admin-sep" />
          <button className="admin-btn ai" disabled={!pending.length || checking} onClick={runAiCheck}>
            {checking ? 'AI 检查中…' : 'AI 辅助检查'}
          </button>
          <label className="admin-offline-toggle" title="答辩演示可强制离线，保证建议结果确定可复现">
            <input type="checkbox" checked={forceOffline} onChange={(e) => setForceOffline(e.target.checked)} />
            强制离线演示
          </label>
          <span className="admin-sep" />
          <button className="admin-btn primary" disabled={!readyCount}
            onClick={() => confirmItems(pending.filter((i) => completeness(i).length === 0))}>
            全部确认入库（{readyCount}）
          </button>
          <select className="admin-filter" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="筛选待确认项">
            <option value="all">全部</option>
            <option value="pending">待确认</option>
            <option value="incomplete">待补充</option>
            <option value="ready">可入库</option>
            <option value="confirmed">已入库</option>
          </select>
        </div>

        {!!notices.length && (
          <div className="admin-notices">
            {notices.map((n, i) => <p key={i}>{n}</p>)}
            <button className="admin-btn" onClick={() => setNotices([])}>知道了</button>
          </div>
        )}

        <div className={`admin-body ${showForm ? 'with-form' : ''}`}>
          <div className="admin-list">
            {!visible.length && (
              <div className="admin-empty">
                <p>暂无待确认题目</p>
                <p>上传 CSV / Excel 批量导入，或点击「逐题录入」手工添加。导入后先入待确认列表，确认后才写入题库。</p>
              </div>
            )}
            {visible.map((item) => item.status === 'confirmed' ? (
              <article className="admin-card confirmed" key={item.key} data-key={item.key}>
                <header className="admin-card-head">
                  <span className={`admin-type ${item.type}`}>{item.type === 'fill' ? '填空' : '单选'}</span>
                  <span className="admin-source">{item.source}{item.line ? ` · 第 ${item.line} 行` : ''}</span>
                  <span className="admin-done">已入库</span>
                </header>
                <p className="admin-stem"><MathText text={item.stem} /></p>
              </article>
            ) : (
              <PendingCard
                key={item.key}
                item={item}
                suggestion={aiResults[item.key]}
                store={store}
                onChange={(next) => patchItem(item.key, next)}
                onConfirm={() => confirmItems([item])}
                onDelete={() => setItems((list) => list.filter((i) => i.key !== item.key))}
              />
            ))}
          </div>

          {showForm && (
            <aside className="admin-form">
              <h3>逐题录入</h3>
              <ItemEditor value={form} store={store} onChange={setForm} />
              <button className="admin-btn primary block" onClick={submitForm}>加入待确认列表</button>
              <p className="admin-form-hint">录入后进入待确认列表，与批量导入走同一套检查与确认流程。</p>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}