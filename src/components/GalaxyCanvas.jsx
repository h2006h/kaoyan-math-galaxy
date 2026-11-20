import { useEffect, useRef } from 'react';
import { GalaxyEngine } from '../three/GalaxyEngine.js';
import { loadData, buildGalaxyView } from '../data/dataService.js';

export default function GalaxyCanvas({ onEngine, onProgress, onReady, onSelect }) {
  const containerRef = useRef(null);
  // 回调存 ref，避免父组件重渲染导致引擎被销毁重建
  const cbRef = useRef({ onEngine, onProgress, onReady, onSelect });
  cbRef.current = { onEngine, onProgress, onReady, onSelect };

  useEffect(() => {
    let cancelled = false;
    let engine = null;

    (async () => {
      // 数据加载占进度条 0-40%，场景构建占 40-100%
      const store = await loadData({
        onProgress: (p) => !cancelled && cbRef.current.onProgress(p * 0.4),
      });
      if (cancelled) return;
      const view = buildGalaxyView(store);
      engine = new GalaxyEngine(containerRef.current, {
        onProgress: (p) => cbRef.current.onProgress(40 + p * 0.6),
        onReady: () => cbRef.current.onReady(),
        onSelect: (planet) => cbRef.current.onSelect(planet),
      });
      engine.init(view);
      window.__galaxy = engine; // 调试/答辩演示入口
      window.__data = store;
      cbRef.current.onEngine(engine);
    })();

    return () => {
      cancelled = true;
      delete window.__galaxy;
      delete window.__data;
      cbRef.current.onEngine(null);
      engine?.dispose();
    };
  }, []);

  return <div className="galaxy-canvas" ref={containerRef} />;
}
