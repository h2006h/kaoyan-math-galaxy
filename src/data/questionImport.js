// ─────────────────────────────────────────────────────────────
// 题库批量导入解析：CSV / Excel → 待确认项（不直接入库）。
// 模板列：题干、选项A、选项B、选项C、选项D、答案、解析、章节、难度、关联考点
// 兼容合并列「选项」（A.xx|B.xx|C.xx|D.xx）；填空题答案写入「答案」列、
// 选项留空、难度旁无需额外标记——解析器按选项是否为空自动识别 fill。
// ─────────────────────────────────────────────────────────────

export const TEMPLATE_HEADERS = ['题干', '选项A', '选项B', '选项C', '选项D', '答案', '解析', '章节', '难度', '关联考点'];

const TEMPLATE_ROWS = [
  ['求极限 lim(x→0) (1−cosx)/x² =', '0', '1/2', '1', '2', 'B', '等价无穷小：1−cosx ~ x²/2，故极限为 1/2。', '函数、极限与连续', '1', 'limit-calc'],
  ['设 y = ln(1+x²)，求 y′', '2x/(1+x²)', '1/(1+x²)', '2x', 'ln(1+x²)/2x', 'A', '复合函数求导：y′ = 2x/(1+x²)。', '一元函数微分学', '1', 'der-calc'],
  ['填空：∫₀¹ 2x dx = ____（直接填数值）', '', '', '', '', '1', '∫₀¹ 2x dx = [x²]₀¹ = 1。', '一元函数积分学', '1', 'int-def'],
];

/** 生成带 BOM 的 CSV 模板（Excel 打开中文不乱码） */
export function downloadTemplate() {
  const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = '\uFEFF' + [TEMPLATE_HEADERS, ...TEMPLATE_ROWS].map((r) => r.map(escape).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = '题库导入模板.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/** 标准 CSV 解析：支持引号包裹、双引号转义、字段内换行、\r\n */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((v) => v.trim() !== '')) rows.push(row); }
  return rows;
}

/** Excel → 行数组（动态加载 xlsx，不进主 bundle） */
async function parseExcel(file) {
  const { read, utils } = await import('xlsx');
  const wb = read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return utils.sheet_to_json(sheet, { header: 1, defval: '' }).filter((r) => r.some((v) => String(v).trim() !== ''));
}

const letterToIndex = (s) => {
  const m = String(s).trim().toUpperCase().match(/^([A-D])$/);
  return m ? m[0].charCodeAt(0) - 65 : -1;
};

/**
 * 文件 → 待确认项列表。章节列接受章节名或 id；关联考点用 ; 或 | 分隔。
 * 返回 {items, errors}：errors 为无法解析的行（行号+原因），不阻塞其他行。
 */
export async function parseImportFile(file, store) {
  const isExcel = /\.(xlsx|xls)$/i.test(file.name);
  const rows = isExcel ? await parseExcel(file) : parseCSV(await file.text());
  if (rows.length < 2) return { items: [], errors: ['文件为空或缺少数据行'] };

  const header = rows[0].map((h) => String(h).trim());
  const col = (name) => header.indexOf(name);
  const iStem = col('题干'), iAns = col('答案'), iAna = col('解析'), iCh = col('章节'), iDiff = col('难度'), iPts = col('关联考点');
  const optCols = ['选项A', '选项B', '选项C', '选项D'].map(col);
  const iOpts = col('选项'); // 兼容合并列
  if (iStem < 0 || iAns < 0) return { items: [], errors: ['缺少必需列：题干 / 答案（请使用模板）'] };

  const chapterByName = new Map();
  for (const [id, ch] of store.chapters) { chapterByName.set(ch.name, id); chapterByName.set(id, id); }

  const items = [], errors = [];
  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const get = (i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
    let options = optCols.every((i) => i >= 0) ? optCols.map(get) : [];
    if (iOpts >= 0 && get(iOpts)) {
      options = get(iOpts).split('|').map((s) => s.trim().replace(/^[A-D][.、．]\s*/i, ''));
    }
    const isFill = options.every((o) => !o);
    const answerRaw = get(iAns);
    const chapterRaw = get(iCh);
    const chapterId = chapterByName.get(chapterRaw) ?? '';
    if (chapterRaw && !chapterId) errors.push(`第 ${line} 行：章节「${chapterRaw}」不存在，已置空待人工选择`);
    const pointIds = get(iPts).split(/[;|；]/).map((s) => s.trim()).filter(Boolean);
    const difficulty = Number(get(iDiff)) || 0;

    items.push({
      key: `imp-${Date.now().toString(36)}-${idx}`,
      source: file.name,
      line,
      type: isFill ? 'fill' : 'single',
      stem: get(iStem),
      options: isFill ? [] : options,
      answer: isFill ? -1 : letterToIndex(answerRaw),
      accept: isFill && answerRaw ? [answerRaw] : [],
      analysis: get(iAna),
      chapterId,
      difficulty,
      pointIds,
      status: 'pending', // pending → confirmed
    });
  });
  return { items, errors };
}

/** 逐题录入表单 → 待确认项（与批量导入同一形状） */
export function formToItem(form) {
  return {
    key: `form-${Date.now().toString(36)}`,
    source: '逐题录入',
    line: null,
    type: form.type,
    stem: form.stem.trim(),
    options: form.type === 'single' ? form.options.map((o) => o.trim()) : [],
    answer: form.type === 'single' ? Number(form.answer) : -1,
    accept: form.type === 'fill' ? form.accept.split(/[;|；]/).map((s) => s.trim()).filter(Boolean) : [],
    analysis: form.analysis.trim(),
    chapterId: form.chapterId,
    difficulty: Number(form.difficulty),
    pointIds: form.pointIds,
    status: 'pending',
  };
}

/** 完整性检查（确定性规则，导入即执行，演示首选）：返回缺失字段列表 */
export function completeness(item) {
  const missing = [];
  if (!item.stem) missing.push('题干');
  if (item.type === 'single') {
    if (item.options.length !== 4 || item.options.some((o) => !o)) missing.push('选项（需 4 个非空）');
    if (item.answer < 0 || item.answer > 3) missing.push('答案（A-D）');
  } else if (!item.accept.length) missing.push('填空答案');
  if (!item.analysis) missing.push('解析');
  if (!item.chapterId) missing.push('章节');
  if (![1, 2, 3].includes(item.difficulty)) missing.push('难度（1-3）');
  if (!item.pointIds.length) missing.push('关联考点');
  return missing;
}

/** 待确认项 → 题库题目对象（确认入库时调用，补全 id；批量同毫秒确认也不撞 id） */
export function itemToQuestion(item) {
  return {
    id: `q-imp-${item.key}-${Math.random().toString(36).slice(2, 6)}`,
    type: item.type,
    stem: item.stem,
    ...(item.type === 'single' ? { options: item.options, answer: item.answer } : { accept: item.accept }),
    analysis: item.analysis,
    chapterId: item.chapterId,
    difficulty: item.difficulty,
    pointIds: item.pointIds,
  };
}