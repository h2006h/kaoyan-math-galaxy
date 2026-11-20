import { useEffect, useState } from 'react';
import { splitMathSegments, toMarkdownMath } from '../data/mathParse.js';

// 公式文本渲染组件：把题库解析/参考答案/题目里的公式转成 Markdown 数学（$…$），
// 交给与知识讲解相同的 Markdown + KaTeX 管线解析；首次出现公式时按需加载，主包零增重。
let rendererPromise = null;
function loadRenderer() {
  if (!rendererPromise) {
    rendererPromise = import('../data/markdownWithStyles.js')
      .then((mod) => mod.renderInlineMarkdown)
      .catch(() => null);
  }
  return rendererPromise;
}

export default function MathText({ text }) {
  const value = text == null ? '' : String(text);
  const hasMath = splitMathSegments(value).some((s) => s.type === 'math');
  const [html, setHtml] = useState(null);

  useEffect(() => {
    let alive = true;
    setHtml(null);
    if (hasMath) {
      loadRenderer().then((fn) => {
        if (alive && fn) setHtml(fn(toMarkdownMath(value)));
      });
    }
    return () => { alive = false; };
  }, [value, hasMath]);

  if (!hasMath || html == null) return <>{value}</>;
  return <span className="math-text" dangerouslySetInnerHTML={{ __html: html }} />;
}
