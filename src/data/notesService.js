// 知识点讲解内容加载：单独一个 Markdown 数据文件，按 <!-- id --> 分节，
// 首次打开讲解页时拉取并缓存；后续接入后台 CMS 时仅替换本模块的取数逻辑。
let cache = null;
let inflight = null;

export function parseNotes(md) {
  const notes = {};
  const re = /<!-- id: ([\w-]+) -->([\s\S]*?)<!-- end -->/g;
  let m;
  while ((m = re.exec(md))) notes[m[1]] = m[2].trim();
  return notes;
}

export function loadNotes() {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch('/data/point_notes.md')
    .then((res) => {
      if (!res.ok) throw new Error(`讲解内容加载失败：HTTP ${res.status}`);
      return res.text();
    })
    .then((text) => {
      cache = parseNotes(text);
      return cache;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
