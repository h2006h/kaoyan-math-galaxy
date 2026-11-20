import { useEffect, useRef } from 'react';
import MathText from './MathText.jsx';

const PANEL_W = 320;

// 信息面板：HTML overlay，每帧投影星球世界坐标跟随定位；
// 进场/出场动画放在内层元素上，避免与每帧更新的 left/top 冲突
export default function InfoPanel({ engine, planet, onClose, onFocusPlanet, onPractice, onExplain }) {
  const outerRef = useRef(null);

  useEffect(() => {
    if (!engine || !planet) return;
    // 移动端面板是固定底部抽屉，不需要跟随投影
    if (window.matchMedia('(max-width: 768px)').matches) return;
    let raf;
    const follow = () => {
      raf = requestAnimationFrame(follow);
      const pos = engine.getScreenPosition(planet.id);
      const el = outerRef.current;
      if (!el || !pos) return;
      const w = el.parentElement.clientWidth;
      const h = el.parentElement.clientHeight;
      const x = Math.max(PANEL_W / 2 + 8, Math.min(w - PANEL_W / 2 - 8, pos.x));
      // 优先放星球上方；上方不够放下方；都不够则钳制在视口内（去掉指向箭头）
      const panelH = el.firstElementChild?.offsetHeight ?? 300;
      const above = pos.y - pos.r - 26 - panelH > 8;
      const belowFits = pos.y + pos.r + 26 + panelH < h - 8;
      el.classList.toggle('below', !above && belowFits);
      el.classList.toggle('clamped', !above && !belowFits);
      const top = above
        ? pos.y - pos.r
        : belowFits
          ? pos.y + pos.r
          : Math.min(Math.max(pos.y - panelH / 2, 8), h - panelH - 8) + 26;
      el.style.left = `${x}px`;
      el.style.top = `${top}px`;
      el.style.visibility = pos.behind ? 'hidden' : 'visible';
    };
    raf = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(raf);
  }, [engine, planet]);

  if (!planet) return null;

  return (
    <div className="info-panel-anchor" ref={outerRef}>
      <div className="info-panel" key={planet.id}>
        <button className="info-close" onClick={onClose} aria-label="关闭">×</button>
        <div className="info-header">
          <span className={`state-badge state-${planet.stateKey}`}>{planet.stateLabel}</span>
          {planet.highFreq && <span className="hot-badge">高频考点</span>}
        </div>
        <h3 className="info-title">{planet.name}</h3>
        <div className="info-chapter">{planet.chapterName}</div>
        <div className="scope-row" title="依据考研数学大纲标注的适用科目">
          <span className="scope-label">大纲</span>
          {[1, 2, 3].map((n) => (
            <span
              key={n}
              className={`scope-chip ${planet.examScope?.includes(n) ? 'on' : 'off'}`}
            >
              {['数一', '数二', '数三'][n - 1]}
            </span>
          ))}
        </div>
        <p className="info-desc"><MathText text={planet.desc} /></p>
        <div className="mastery-row">
          <span>掌握度</span>
          <div className="mastery-bar">
            <div
              className="mastery-fill"
              style={{ width: `${planet.mastery ?? 0}%` }}
            />
          </div>
          <span className="mastery-num">
            {planet.mastery == null ? '未测' : planet.mastery}
          </span>
        </div>
        {planet.related.length > 0 && (
          <div className="related">
            <div className="related-title">关联考点</div>
            <div className="related-list">
              {planet.related.map((r) => (
                <button
                  key={r.id}
                  className="related-item"
                  onClick={() => onFocusPlanet(r.id)}
                >
                  <span>{r.name}</span>
                  <span className="related-state">{r.stateLabel}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <button className="notes-btn" onClick={() => onExplain(planet.id)}>
          知识讲解
        </button>
        <button className="practice-btn" onClick={() => onPractice(planet.id)}>
          开始做题
        </button>
      </div>
    </div>
  );
}
