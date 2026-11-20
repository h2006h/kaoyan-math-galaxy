import { useEffect, useRef, useState } from 'react';
import { StarfieldMusic } from '../audio/StarfieldMusic.js';

function Toggle({ label, value, onChange }) {
  return (
    <label className="dock-toggle">
      <span>{label}</span>
      <button
        role="switch"
        aria-checked={value}
        className={`switch ${value ? 'on' : ''}`}
        onClick={() => onChange(!value)}
      >
        <i />
      </button>
    </label>
  );
}

function Slider({ label, min, max, step, value, onChange, format }) {
  return (
    <label className="dock-slider">
      <span className="dock-slider-head">
        <span>{label}</span>
        <span className="dock-slider-value">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

const BGM_KEY = 'kmu:bgm';
const BGM_PREF_VERSION = 2;
const DEFAULT_BGM_VOLUME = 0.65; // 整体响度较初版提高（0.45 → 0.65），仍留压缩器兜底

function readBgmPref() {
  try {
    const saved = JSON.parse(localStorage.getItem(BGM_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return null;
    if (saved.v !== BGM_PREF_VERSION) {
      // 老版本偏好迁移：整体音量上调 1.4×（封顶 0.9），开关状态保留
      const migrated = {
        v: BGM_PREF_VERSION,
        enabled: saved.enabled !== false,
        volume: Math.min(0.9, Math.round((saved.volume ?? 0.45) * 1.4 * 100) / 100),
      };
      saveBgmPref(migrated);
      return migrated;
    }
    return saved;
  } catch { /* 损坏数据按默认处理 */ }
  return null;
}

function saveBgmPref({ enabled, volume }) {
  try {
    localStorage.setItem(BGM_KEY, JSON.stringify({ v: BGM_PREF_VERSION, enabled, volume }));
  } catch { /* 存储不可用忽略 */ }
}

// 常驻控制台：所有参数即改即生效，便于答辩演示时现场调节。
// 「模拟做题结果」仅演示账号展示（canSimulate），注册用户看不到该入口。
export default function ControlDock({ engine, onSimulate, canSimulate = true }) {
  const [autoRotate, setAutoRotate] = useState(true);
  const [links, setLinks] = useState(true);
  const [labels, setLabels] = useState(true);
  const [glow, setGlow] = useState(1);
  const [duration, setDuration] = useState(1.0);
  // 背景音乐：默认开启，首次用户手势后启动（浏览器自动播放策略）
  const [musicOn, setMusicOn] = useState(() => readBgmPref()?.enabled ?? true);
  const [volume, setVolume] = useState(() => readBgmPref()?.volume ?? DEFAULT_BGM_VOLUME);
  const musicRef = useRef(null);
  const musicOnRef = useRef(musicOn);
  musicOnRef.current = musicOn;
  if (!musicRef.current) {
    musicRef.current = new StarfieldMusic({ volume: readBgmPref()?.volume ?? DEFAULT_BGM_VOLUME });
  }

  useEffect(() => {
    const music = musicRef.current;
    window.__music = music; // 验收/调试入口（与 __galaxy 同约定）
    const arm = () => {
      window.removeEventListener('pointerdown', arm);
      if (musicOnRef.current) music.enable().catch(() => {});
    };
    if (musicOnRef.current) window.addEventListener('pointerdown', arm);
    const onVisibility = () => {
      if (document.hidden) music.suspend();
      else if (musicOnRef.current) music.resume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pointerdown', arm);
      document.removeEventListener('visibilitychange', onVisibility);
      music.dispose();
      delete window.__music;
    };
  }, []);

  const toggleMusic = (v) => {
    setMusicOn(v);
    saveBgmPref({ enabled: v, volume });
    if (v) musicRef.current.enable().catch(() => {});
    else musicRef.current.disable();
  };

  const changeVolume = (v) => {
    setVolume(v);
    musicRef.current.setVolume(v);
    saveBgmPref({ enabled: musicOnRef.current, volume: v });
  };

  if (!engine) return null;

  return (
    <aside className="control-dock">
      <div className="dock-title">星系控制台</div>
      <Toggle label="自动旋转" value={autoRotate} onChange={(v) => { setAutoRotate(v); engine.setAutoRotate(v); }} />
      <Toggle label="关联连线" value={links} onChange={(v) => { setLinks(v); engine.setLinksVisible(v); }} />
      <Toggle label="章节标签" value={labels} onChange={(v) => { setLabels(v); engine.setLabelsVisible(v); }} />
      <Slider label="光晕强度" min={0.4} max={2} step={0.1} value={glow}
        format={(v) => `${v.toFixed(1)}×`}
        onChange={(v) => { setGlow(v); engine.setGlowIntensity(v); }} />
      <Slider label="飞行时长" min={0.8} max={1.2} step={0.05} value={duration}
        format={(v) => `${v.toFixed(2)}s`}
        onChange={(v) => { setDuration(v); engine.setFlightDuration(v); }} />
      <Toggle label="背景音乐" value={musicOn} onChange={toggleMusic} />
      {musicOn && (
        <div className="dock-volume">
          <Slider label="音乐音量" min={0} max={1} step={0.05} value={volume}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={changeVolume} />
        </div>
      )}
      <div className="dock-actions">
        {canSimulate && (
          <button className="dock-btn primary" onClick={onSimulate}>模拟做题结果</button>
        )}
        <button className={`dock-btn ${canSimulate ? '' : 'primary'}`} onClick={() => engine.closePanel()}>回到俯瞰</button>
      </div>
      <div className="dock-hint">拖拽旋转 · 滚轮缩放 · 点击星球</div>
    </aside>
  );
}
