// Markdown + KaTeX 渲染入口（含样式）：供按需加载场景使用，
// 首次动态 import 时才把 KaTeX 与其字体样式拉进页面。
import 'katex/dist/katex.min.css';

export { renderMarkdown, renderInlineMarkdown } from './markdown.js';
