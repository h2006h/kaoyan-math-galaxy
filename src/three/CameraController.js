import * as THREE from 'three';

// easeInOutCubic：起步和到达都减速，飞行过程不眩晕
const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// 相机飞行：对 camera.position 与 controls.target 同步做插值，
// 飞行期间锁定 OrbitControls，避免阻尼更新和补间打架
export class CameraController {
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;
    this.active = null;
  }

  flyTo(position, target, duration = 1.0, onComplete = null) {
    this.active = {
      fromPos: this.camera.position.clone(),
      toPos: position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
      start: performance.now(),
      durationMs: duration * 1000,
      onComplete,
    };
    this.controls.enabled = false;
  }

  // 用户中途拖拽时取消飞行，把控制权还给用户
  cancel() {
    if (!this.active) return;
    this.active = null;
    this.controls.enabled = true;
  }

  update(now) {
    if (!this.active) return;
    const a = this.active;
    const t = Math.min(1, (now - a.start) / a.durationMs);
    const k = easeInOutCubic(t);
    this.camera.position.lerpVectors(a.fromPos, a.toPos, k);
    this.controls.target.lerpVectors(a.fromTarget, a.toTarget, k);
    this.camera.lookAt(this.controls.target);
    if (t >= 1) {
      this.active = null;
      this.controls.enabled = true;
      a.onComplete?.();
    }
  }
}
