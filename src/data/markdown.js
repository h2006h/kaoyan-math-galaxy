// ─────────────────────────────────────────────────────────────
// 轻量 Markdown 渲染：标题 / 段落 / 列表 / 引用 / 代码 / 粗斜体
// + LaTeX 公式（$…$ 行内、$$…$$ 独立成行）经 KaTeX 本地渲染。
// 内容全部来自第一方静态稿件（public/data/point_notes.md），不接外部 CDN。
// ─────────────────────────────────────────────────────────────

import katex from 'katex';

const TOKEN_OPEN = '\uE000';
const TOKEN_CLOSE = '\uE001';
const tokenOf = (i) => `${TOKEN_OPEN}${i}${TOKEN_CLOSE}`;
const MATH_LINE_RE = /^\uE000\d+\uE001$/;

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMath(tex, displayMode) {
  // throwOnError=false：坏公式降级为红色提示而不是崩溃；校验脚本会保证数据里没有坏公式
  return katex.renderToString(tex.trim(), {
    displayMode,
    throwOnError: false,
    strict: 'ignore',
    trust: false,
  });
}

function extractMath(md) {
  const store = [];
  let text = md.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    store.push(renderMath(tex, true));
    return `\n\n${tokenOf(store.length - 1)}\n\n`;
  });
  text = text.replace(/\$([^$\n]+?)\$/g, (_, tex) => {
    store.push(renderMath(tex, false));
    return tokenOf(store.length - 1);
  });
  return { text, store };
}

function inline(s, store) {
  let out = escapeHtml(s);
  // 受控反斜杠转义（toMarkdownMath 生成）：先占位，避免 * _ ` 等被强调/代码规则误吃
  const escapes = [];
  out = out.replace(/\\([\\*_`#>])/g, (_, ch) => {
    escapes.push(ch);
    return `\uE100${escapes.length - 1}\uE101`;
  });
  return out
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\uE000(\d+)\uE001/g, (_, i) => store[Number(i)])
    .replace(/\uE100(\d+)\uE101/g, (_, i) => escapes[Number(i)]);
}

/**
 * 行内 Markdown 渲染（供题目/参考答案使用）：
 * 与 renderMarkdown 共用同一套数学与强调解析，但不生成段落/列表等块级结构。
 */
export function renderInlineMarkdown(md) {
  const { text, store } = extractMath(String(md ?? ''));
  return inline(text, store).replace(/\n/g, '<br />');
}

const isSpecial = (t) => /^(#{1,4}\s|>|[-*]\s+|\d+\.\s+|-{3,}$)/.test(t) || MATH_LINE_RE.test(t);

/** Markdown 文本 → 受控 HTML（仅支持讲解稿件用到的语法子集） */
export function renderMarkdown(md) {
  const { text, store } = extractMath(md);
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) {
      i++;
      continue;
    }
    if (MATH_LINE_RE.test(t)) {
      out.push(store[Number(t.slice(1, -1))]);
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(t);
    if (h) {
      const n = h[1].length;
      out.push(`<h${n}>${inline(h[2], store)}</h${n}>`);
      i++;
      continue;
    }
    if (/^-{3,}$/.test(t)) {
      out.push('<hr />');
      i++;
      continue;
    }
    if (/^>/.test(t)) {
      const buf = [];
      while (i < lines.length && /^>/.test(lines[i].trim())) {
        buf.push(lines[i++].trim().replace(/^>\s?/, ''));
      }
      out.push(`<blockquote>${buf.map((b) => inline(b, store)).join('<br />')}</blockquote>`);
      continue;
    }
    if (/^[-*]\s+/.test(t)) {
      const buf = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        buf.push(lines[i++].trim().replace(/^[-*]\s+/, ''));
      }
      out.push(`<ul>${buf.map((b) => `<li>${inline(b, store)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(t)) {
      const buf = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        buf.push(lines[i++].trim().replace(/^\d+\.\s+/, ''));
      }
      out.push(`<ol>${buf.map((b) => `<li>${inline(b, store)}</li>`).join('')}</ol>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !isSpecial(lines[i].trim())) {
      buf.push(lines[i++].trim());
    }
    out.push(`<p>${buf.map((b) => inline(b, store)).join('<br />')}</p>`);
  }
  return out.join('\n');
}
