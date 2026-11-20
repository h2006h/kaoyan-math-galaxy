import * as THREE from 'three';
import { CONFIG } from './config.js';

// 星际穿越拖尾：挂在相机上的短线条云，仅镜头飞行期间可见。
// 线段沿视轴向后流动并循环，透明度按飞行进度 sin 包络淡入淡出，
// 130 段合并为 1 次 draw call，非飞行期间零开销。
export class WarpTrail {
  constructor(camera) {
    const n = CONFIG.visual.warpStreaks;
    this.count = n;
    const positions = new Float32Array(n * 6);
    this.meta = [];
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 5 + Math.random() * 16; // 避开画面中心，不遮挡目标星球
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      const z = -8 - Math.random() * 60;
      const len = 2 + Math.random() * 4;
      positions.set([x, y, z, x, y, z - len], i * 6);
      this.meta.push({ x, y, z, len, speed: 40 + Math.random() * 40 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({
        color: 0x9fc8ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.lines.visible = false;
    this.lines.frustumCulled = false;
    camera.add(this.lines);
  }

  /** flying: 是否飞行中；progress: 飞行进度 0-1 */
  update(dt, flying, progress) {
    this.lines.visible = flying;
    if (!flying) return;
    this.lines.material.opacity = Math.sin(Math.PI * Math.min(progress, 1)) * 0.5;
    const arr = this.lines.geometry.attributes.position.array;
    for (let i = 0; i < this.count; i++) {
      const m = this.meta[i];
      m.z += m.speed * dt;
      if (m.z > -4) m.z = -68; // 流过相机后回卷到远处
      arr[i * 6 + 2] = m.z;
      arr[i * 6 + 5] = m.z - m.len;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.lines.geometry.dispose();
    this.lines.material.dispose();
    this.lines.parent?.remove(this.lines);
  }
}