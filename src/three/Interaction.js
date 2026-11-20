import * as THREE from 'three';

// Raycaster 拾取：区分"点击"与"拖拽"——按下/抬起位移小于阈值才算点击，
// 否则用户旋转视角时会误触星球
export class Interaction {
  constructor(domElement, camera, { onPickPlanet, onPickEmpty, onHoverPlanet }) {
    this.dom = domElement;
    this.camera = camera;
    this.onPickPlanet = onPickPlanet;
    this.onPickEmpty = onPickEmpty;
    this.onHoverPlanet = onHoverPlanet;
    this.raycaster = new THREE.Raycaster();
    this.pickTargets = [];
    this.instanceToPlanet = null; // (instanceId) => planetId
    this._downPos = null;
    this._lastHoverCheck = 0;
    this._hoveredId = undefined;

    this._onDown = (e) => {
      this._downPos = { x: e.clientX, y: e.clientY };
    };
    this._onUp = (e) => {
      if (!this._downPos) return;
      const dx = e.clientX - this._downPos.x;
      const dy = e.clientY - this._downPos.y;
      this._downPos = null;
      if (dx * dx + dy * dy > 36) return; // 位移超过 6px 视为拖拽
      const id = this.#pickAt(e);
      if (id) this.onPickPlanet?.(id);
      else this.onPickEmpty?.();
    };
    // 悬停检测节流到 12fps：拾取是射线求交，没必要每帧做
    this._onMove = (e) => {
      if (this._downPos) return; // 拖拽中不做悬停
      const now = performance.now();
      if (now - this._lastHoverCheck < 80) return;
      this._lastHoverCheck = now;
      const id = this.#pickAt(e) ?? null;
      if (id !== this._hoveredId) {
        this._hoveredId = id;
        this.onHoverPlanet?.(id);
      }
    };
    domElement.addEventListener('pointerdown', this._onDown);
    domElement.addEventListener('pointerup', this._onUp);
    domElement.addEventListener('pointermove', this._onMove);
  }

  // 命中返回 planetId，未命中星球返回 null（交由调用方区分"空白"）
  #pickAt(e) {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickTargets, false);
    if (hits.length > 0 && hits[0].instanceId != null) {
      return this.instanceToPlanet(hits[0].instanceId);
    }
    return null;
  }

  dispose() {
    this.dom.removeEventListener('pointerdown', this._onDown);
    this.dom.removeEventListener('pointerup', this._onUp);
    this.dom.removeEventListener('pointermove', this._onMove);
  }
}
