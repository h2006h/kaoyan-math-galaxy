// 首屏加载遮罩：真实反映引擎初始化各阶段进度，完成后整体淡出
export default function LoadingOverlay({ progress, done }) {
  return (
    <div className={`loading-overlay ${done ? 'fade-out' : ''}`}>
      <div className="loading-title">考研数学知识宇宙</div>
      <div className="loading-bar">
        <div className="loading-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="loading-percent">{Math.round(progress)}%</div>
    </div>
  );
}
