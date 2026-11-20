// ─────────────────────────────────────────────────────────────
// 题库公式文本解析（纯函数，无依赖）：
// 题目解析/参考答案是手写的 Unicode 数学（如 lim(x→0) sinx/x = 1、∫₀¹ x²dx、f′(x)）。
// 这里把文本切成「普通文本 / 数学片段」，数学片段再转换为 KaTeX 可渲染的 LaTeX。
// 只做排版增强，不改变任何题面/答案语义；转换失败时调方回退原始文本。
// ─────────────────────────────────────────────────────────────

const SUP = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')', 'ⁿ': 'n', 'ˣ': 'x', 'ᵗ': 't', 'ᵀ': 'T', 'ʸ': 'y',
};
const SUB = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '₊': '+', '₋': '-', '₌': '=', 'ₙ': 'n',
};
const SYMBOLS = {
  'π': '\\pi', 'θ': '\\theta', 'λ': '\\lambda', 'μ': '\\mu', 'σ': '\\sigma', 'φ': '\\varphi',
  'ξ': '\\xi', 'ρ': '\\rho', 'α': '\\alpha', 'β': '\\beta', 'ε': '\\varepsilon', 'χ': '\\chi',
  'Λ': '\\Lambda', 'Φ': '\\Phi', 'Ω': '\\Omega', 'Σ': '\\sum', '∏': '\\prod',
  '∫': '\\int', '∮': '\\oint', '∯': '\\oiint', '√': '\\surd', '∞': '\\infty',
  '→': '\\to', '⇒': '\\Rightarrow', '⇔': '\\Leftrightarrow',
  '·': '\\cdot', '×': '\\times', '÷': '\\div', '±': '\\pm', '−': '-',
  '~': '\\sim', '≈': '\\approx', '≠': '\\ne', '≤': '\\le', '≥': '\\ge', '≡': '\\equiv',
  '∈': '\\in', '∉': '\\notin', '∪': '\\cup', '∩': '\\cap', '⊂': '\\subset', '⊆': '\\subseteq',
  '∀': '\\forall', '∃': '\\exists', '∂': '\\partial', '°': '^{\\circ}',
  '′': "'", '″': "''", '…': '\\dots', '%': '\\%', 'Ā': '\\bar{A}',
};

const FUNCS = ['arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'ln', 'log', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'arg'];
const FUNC_RE = new RegExp(`(?<![A-Za-z])(${FUNCS.join('|')})(?=[A-Za-z0-9(\\\\]|$)`, 'g');

// 可进入数学片段的字符（中文与全角标点会自然切断片段）
const MATH_CHAR_RE = /[A-Za-z0-9\s+\-*/=<>^_.,;:()\[\]{}|~′″°%\\πθλμσφξρβαεχΛΦΩΣ∏∫∮∯√∞→⇒⇔·×÷±−≈≠≤≥≡∈∉∪∩⊂⊆∀∃∂…Ā\u0300-\u036f⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿˣᵗᵀʸ₀₁₂₃₄₅₆₇₈₉₊₋₌ₙ]/;

const STRONG_SIGNAL_RE = /[0-9=+\-*/<>^_|≤≥≠≈≡·×÷±−√∫∮∯∑Σ∏∞πθλμσφξρβαεχΛΦΩ∂∀∃∈∉∪∩⊂⊆′″°%⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿˣᵗᵀ₀₁₂₃₄₅₆₇₈₉₊₋ₙĀ]/;

/** 判断一个候选片段是否值得按数学排版（避免把英文缩写/纯数字/普通词当公式） */
export function isMathCandidate(core) {
  if (!core || core.length > 90) return false;
  if (!/[A-Za-z0-9\u0370-\u03ff]/.test(core)) return false;
  if (/^[A-Za-z]{2,}$/.test(core)) return false; // 纯英文单词 / 缩写
  if (/^\d{1,4}$/.test(core)) return false; // 年份、题号之类的纯数字
  if (STRONG_SIGNAL_RE.test(core)) return true;
  if (/^[A-Za-z]$/.test(core)) return true; // 单个变量
  if (/^[\u0370-\u03ff]$/.test(core)) return true; // 单个希腊字母
  if (/^[\[(].*[\])]$/.test(core) && /[A-Za-z]/.test(core)) return true; // P(A)、[a,b]
  if (/\([A-Za-z]/.test(core)) return true; // f(x) 形式
  if (new RegExp(`(?<![A-Za-z])(${FUNCS.join('|')})`).test(core)) return true; // sin x、lim
  return false;
}

/** Unicode 数学片段 → LaTeX（供 KaTeX 渲染） */
export function unicodeToLatex(input) {
  let s = String(input);
  // 组合变音符：x̄ → \bar{x}、x̂ → \hat{x}
  s = s.replace(/([A-Za-z\u0370-\u03ff])([\u0300-\u036f])/g, (m, ch, mk) => {
    if (mk === '\u0304') return `\\bar{${ch}}`;
    if (mk === '\u0302') return `\\hat{${ch}}`;
    if (mk === '\u0307') return `\\dot{${ch}}`;
    return ch;
  });
  // 连续上下标成组转换：x² → x^{2}，eˣ → e^{x}，Aᵀ → A^{T}
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿˣᵗᵀʸ]+/g, (run) => `^{${[...run].map((c) => SUP[c] ?? '').join('')}}`);
  s = s.replace(/[₀₁₂₃₄₅₆₇₈₉₊₋₌ₙ]+/g, (run) => `_{${[...run].map((c) => SUB[c] ?? '').join('')}}`);
  // 函数名：sinx → \sin x、lim(x→0) → \lim (x\to0)；tr 用 \operatorname
  s = s.replace(FUNC_RE, '\\$1 ');
  s = s.replace(/(?<![A-Za-z])tr(?![A-Za-z])/g, '\\operatorname{tr} ');
  s = s.replace(/(?<![A-Za-z])d\s*\/\s*dx(?![A-Za-z])/g, '\\frac{d}{dx} ');
  // 字符映射（映射产物均为 ASCII，不会再次命中）；命令词后补空格，避免 \cdotx 这类粘连
  let out = '';
  for (const ch of s) {
    const mapped = SYMBOLS[ch];
    if (mapped === undefined) {
      out += ch;
    } else {
      out += /[A-Za-z]$/.test(mapped) ? `${mapped} ` : mapped;
    }
  }
  // 下标/上标直接跟命令词时补花括号：_Σ → _{\sum}
  out = out.replace(/([_^])\s*\\([A-Za-z]+)\s*/g, '$1{\\$2} ');
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * 把一段纯文本转成「Markdown + 数学」源串：
 * 数学片段包成 $...$（交给 Markdown 渲染管线里的 KaTeX 解析），
 * 普通文本里的 Markdown 控制符做最小转义，避免 A*、x_1 之类被误当强调/斜体。
 */
export function toMarkdownMath(text) {
  return splitMathSegments(text)
    .map((seg) => (seg.type === 'math' ? `$${seg.latex}$` : seg.value.replace(/([\\*_`#>])/g, '\\$1')))
    .join('');
}

/**
 * 把一段文本切成 [{type:'text'|'math', value|latex}]。
 * 中文、全角标点会切断数学片段；失败片段保持原文。
 */
export function splitMathSegments(text) {
  // 连续下划线（填空题空位 ____）不是数学：以占位符隔离，最终回填为普通文本
  const BLANK = '\uE200';
  const src = String(text ?? '').replace(/_{2,}/g, (m) => BLANK.repeat(m.length));
  const segs = [];
  let buf = '';
  let math = '';

  const flushText = () => {
    if (buf) {
      segs.push({ type: 'text', value: buf });
      buf = '';
    }
  };
  const flushMath = () => {
    const raw = math;
    math = '';
    if (!raw) return;
    const lead = raw.match(/^\s*/)[0];
    const tail = raw.match(/\s*$/)[0];
    const core = raw.slice(lead.length, raw.length - tail.length).replace(/^[.,;:]+|[.,;:]+$/g, '');
    if (!core || !isMathCandidate(core)) {
      buf += raw;
      return;
    }
    flushText();
    buf += lead;
    segs.push({ type: 'math', latex: unicodeToLatex(core), source: core });
    buf += tail;
  };

  for (const ch of src) {
    if (MATH_CHAR_RE.test(ch)) {
      flushText();
      math += ch;
    } else {
      flushMath();
      buf += ch;
    }
  }
  flushMath();
  flushText();
  return segs.map((s) => (s.type === 'text' ? { ...s, value: s.value.split(BLANK).join('_') } : s));
}
