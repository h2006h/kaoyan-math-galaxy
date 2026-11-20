// 星系切换器：高等数学 / 线性代数 / 概率论与数理统计
// 窄屏用 shortName（高数/线代/概率），桌面显示全名
export default function GalaxySwitcher({ subjects, current, onSwitch }) {
  return (
    <nav className="galaxy-switcher" aria-label="切换星系">
      <span className="gs-title">星系</span>
      {subjects.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`gs-btn ${s.id === current ? 'active' : ''}`}
          data-galaxy={s.id}
          onClick={() => onSwitch(s.id)}
          title={`进入「${s.name}」星系`}
        >
          <i className="gs-dot" aria-hidden="true" />
          <span className="gs-name gs-full">{s.name}</span>
          <span className="gs-name gs-short">{s.shortName}</span>
        </button>
      ))}
    </nav>
  );
}
