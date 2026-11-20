import * as THREE from 'three';
import { CONFIG, isMobile } from './config.js';
import { createRenderer, createCamera, createControls, createLights } from './SceneSetup.js';
import { Background } from './Background.js';
import { PlanetManager } from './PlanetManager.js';
import { LinkManager } from './LinkManager.js';
import { CameraController } from './CameraController.js';
import { Interaction } from './Interaction.js';
import { PostFX } from './PostFX.js';
import { WarpTrail } from './WarpTrail.js';

export class GalaxyEngine {
  /**
   * @param {HTMLElement} container 挂载点
   * @param {object} callbacks
   * @param {(percent:number)=>void} callbacks.onProgress 加载进度 0-100
   * @param {()=>void} callbacks.onReady 场景就绪（可淡入）
   * @param {(planetViewModel|null)=>void} callbacks.onSelect 选中/取消选中星球
   */
  constructor(container, { onProgress, onReady, onSelect } = {}) {
    this.container = container;
    this.onProgress = onProgress ?? (() => {});
    this.onReady = onReady ?? (() => {});
    this.onSelect = onSelect ?? (() => {});
    this.selectedId = null;
    this._disposed = false;
    this._lastActive = performance.now();
    this._lastTick = performance.now();
    this._frame = 0;
    // 控制台可调设置（默认值）
    this.autoRotateEnabled = true;
    this.flightDuration = 1.0;
  }

  init(view) {
    const { container } = this;
    this.renderer = createRenderer(container);
    // 自适应画质状态：软件渲染（SwiftShader/llvmpipe）保持固定分辨率，
    // 保证无 GPU 环境下的截图与验收确定性；硬件 GPU 按帧时间自动升降档
    this._baseRatio = this.renderer.getPixelRatio();
    this._ratioScale = 1;
    this._frameEma = 16.7;
    this._lastAdapt = 0;
    this._adaptive = this.#detectHardwareGL();
    this.scene = new THREE.Scene();
    this.camera = createCamera(container);
    this.controls = createControls(this.camera, this.renderer.domElement);
    createLights(this.scene);
    this.data = view;
    this.onProgress(15);

    this.background = new Background(this.scene);
    this.background.setScaleFactor(container.clientHeight, CONFIG.camera.fov);
    this.onProgress(55);

    this.planetManager = new PlanetManager(this.scene);
    this.planetManager.build(this.data);
    this.planetManager.setGlowScaleFactor(container.clientHeight, CONFIG.camera.fov);
    this.onProgress(80);

    this.linkManager = new LinkManager(this.scene);
    this.linkManager.build(this.data.links, this.planetManager.byId);
    this.onProgress(92);

    this.cameraController = new CameraController(this.camera, this.controls);
    this.scene.add(this.camera); // 相机挂载穿越拖尾等子节点
    this.warp = new WarpTrail(this.camera);
    this.postfx = new PostFX(this.renderer, this.scene, this.camera);
    this.interaction = new Interaction(this.renderer.domElement, this.camera, {
      onPickPlanet: (id) => this.focusPlanet(id),
      onPickEmpty: () => this.closePanel(),
      onHoverPlanet: (id) => this.#hover(id),
    });
    this.interaction.pickTargets = [this.planetManager.mesh];
    this.interaction.instanceToPlanet = (i) => this.planetManager.planets[i]?.id;

    // 用户手动拖拽时取消进行中的飞行，并刷新活跃时间
    this.controls.addEventListener('start', () => {
      this.cameraController.cancel();
      this._markActive();
    });
    this._onUserInput = () => this._markActive();
    this.renderer.domElement.addEventListener('pointerdown', this._onUserInput);
    // 鼠标移动（悬停/视差）也是用户操作：不唤醒渲染循环的话，省电降帧会让视差迟滞
    this.renderer.domElement.addEventListener('pointermove', this._onUserInput, { passive: true });
    this.renderer.domElement.addEventListener('wheel', this._onUserInput, { passive: true });

    this._onResize = () => this.#resize();
    window.addEventListener('resize', this._onResize);

    // 所有视觉动画（闪烁/呼吸/流光/尘埃/穿越）统一由 clock.getElapsedTime() 驱动
    this.clock = new THREE.Clock();
    this._loop = (t) => {
      if (this._disposed) return;
      this._raf = requestAnimationFrame(this._loop);
      this.#tick(t);
    };
    this._raf = requestAnimationFrame(this._loop);

    this.onProgress(100);
    this.onReady();
  }

  #tick(now) {
    const rawDt = (now - this._lastTick) / 1000;
    const dt = Math.min(rawDt, 0.05);
    this._lastTick = now;
    const idleMs = now - this._lastActive;
    const flying = !!this.cameraController.active;

    // 自动旋转：仅在不空闲太久、未选中星球、非飞行中时开启
    this.controls.autoRotate =
      this.autoRotateEnabled &&
      !this.selectedId && !flying && idleMs > CONFIG.controls.idleAutoRotateDelay;

    // 按需渲染：深度空闲（无选中、无飞行）时降帧省电。
    // 自动旋转仍在进行时用 2 帧一跳（≈30fps，转动平滑），完全静止时 4 帧一跳
    const deepIdle = idleMs > CONFIG.loop.idleAfterMs && !this.selectedId && !flying;
    const idleSkip = this.controls.autoRotate ? 2 : CONFIG.loop.idleFrameSkip;
    if (deepIdle && this._frame++ % idleSkip !== 0) return;

    this.controls.update();
    this.cameraController.update(now);
    const elapsed = this.clock.getElapsedTime();
    // 指数趋近类动画（视差/颜色/缩放）用真实帧间隔：无稳定性问题，低帧率下也按墙钟时间收敛
    const smoothDt = Math.min(rawDt, 0.5);
    this.background.update(elapsed, smoothDt);
    this.planetManager.update(smoothDt, elapsed, this.camera);
    this.linkManager.update(elapsed);
    const flight = this.cameraController.active;
    this.warp.update(dt, !!flight, flight ? (now - flight.start) / flight.durationMs : 0);
    // 交互使用期持续掉帧 → 自动降低绘制分辨率；深度空闲降帧时的长间隔不参与采样
    if (idleMs < CONFIG.loop.idleAfterMs) this.#adaptPerformance(rawDt, now);
    this.renderer.info.reset(); // autoReset 已关闭：整帧（含 bloom 各 pass）统一统计
    this.postfx.render();
  }

  #detectHardwareGL() {
    try {
      const ctx = this.renderer.getContext();
      const ext = ctx.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      return !/swiftshader|llvmpipe|software/i.test(name);
    } catch {
      return false;
    }
  }

  /**
   * 自适应像素密度（仅硬件 GPU）：
   * 帧时间指数平均 >24ms（约低于 42fps）且 2.5s 内未调整 → 降 0.1 档（下限 0.8）；
   * 回落到 <18ms（≥55fps，60Hz 屏的 16.7ms 也能达标）→ 每次升 0.05 档回满。
   * 只缩放绘制分辨率，不动特效与场景元素，观感几乎无感。
   */
  #adaptPerformance(rawDt, now) {
    if (!this._adaptive) return;
    this._frameEma = this._frameEma * 0.92 + Math.min(rawDt * 1000, 120) * 0.08;
    if (now - this._lastAdapt < 2500) return;
    let next = this._ratioScale;
    if (this._frameEma > 24 && this._ratioScale > 0.8) next = Math.max(0.8, this._ratioScale - 0.1);
    else if (this._frameEma < 18 && this._ratioScale < 1) next = Math.min(1, this._ratioScale + 0.05);
    if (next === this._ratioScale) return;
    this._ratioScale = next;
    this._lastAdapt = now;
    this.#applyRatio();
  }

  #applyRatio() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    // 允许降到 1 以下（CSS 放大补偿）：DPR=1 的普通显示器也必须有降档空间
    const ratio = Math.max(0.7, Math.round(this._baseRatio * this._ratioScale * 100) / 100);
    this.renderer.setPixelRatio(ratio);
    this.postfx.setPixelRatio(ratio);
    this.postfx.setSize(w, h);
    this.planetManager.setGlowScaleFactor(h, CONFIG.camera.fov);
    this.background.setScaleFactor(h, CONFIG.camera.fov);
  }

  // ── 对外 API ──────────────────────────────────────────────

  /** 后端掌握度变化时调用。score: 0-100，null 表示未学 */
  updatePlanetMastery(planetId, score) {
    this.planetManager.setMastery(planetId, score);
    this._markActive(); // 状态变化需要即时渲染反馈，不能等省电降帧
    // 面板若正开着该星球，同步刷新面板数据
    if (this.selectedId === planetId) {
      this.onSelect(this.planetManager.getViewModel(planetId, this.data.links));
    }
  }

  /** 聚焦星球（点击拾取 / 关联跳转共用同一入口） */
  focusPlanet(planetId) {
    if (!planetId || planetId === this.selectedId) return;
    const p = this.planetManager.byId.get(planetId);
    if (!p) return;
    this.selectedId = planetId;
    this._markActive();

    this.planetManager.setSelected(planetId);
    this.linkManager.highlightFor(planetId, this.planetManager.byId);
    this.controls.minDistance = CONFIG.controls.focusMinDistance;

    // 相机落点：从星团中心向外的方向后退，再略抬高；
    // 距离与星球半径成正比，高频大星球自动拉远
    const dir = p.position.clone().sub(p.clusterCenter);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const focusDist = p.radius * CONFIG.camera.focusDistanceRatio;
    // 构图偏移：注视点上移（桌面）/下移（移动），让星球偏画面下方/上方，
    // 给信息面板留出另一侧空间。注意必须偏移 target 而非相机——lookAt 会把 target 钉在屏幕中心
    const shift = focusDist * 0.18 * (isMobile ? -1 : 1);
    const camPos = p.position
      .clone()
      .addScaledVector(dir, focusDist)
      .add(new THREE.Vector3(0, CONFIG.camera.focusHeight + shift, 0));
    const lookTarget = p.position.clone().add(new THREE.Vector3(0, shift, 0));

    this.cameraController.flyTo(camPos, lookTarget, this.flightDuration);
    this.onSelect(this.planetManager.getViewModel(planetId, this.data.links));
  }

  /** 收起面板并回到俯瞰视角 */
  closePanel() {
    if (!this.selectedId) return;
    this.selectedId = null;
    this._markActive();
    this.planetManager.setSelected(null);
    this.linkManager.reset();
    this.controls.minDistance = CONFIG.controls.minDistance;
    const [x, y, z] = CONFIG.camera.position;
    this.cameraController.flyTo(
      new THREE.Vector3(x, y, z),
      new THREE.Vector3(...CONFIG.camera.target),
      this.flightDuration
    );
    this.onSelect(null);
  }

  /** 全部星球 id，供演示/调试模拟数据用 */
  getPlanetIds() {
    return this.planetManager?.planets.map((p) => p.id) ?? [];
  }

  /** 星球世界坐标 → 屏幕像素坐标（含投影半径 r），供 HTML 面板跟随定位 */
  getScreenPosition(planetId) {
    const p = this.planetManager?.byId.get(planetId);
    if (!p) return null;
    const v = p.position.clone().project(this.camera);
    const dist = this.camera.position.distanceTo(p.position);
    const scaleFactor = this.planetManager.glowUniforms.uScaleFactor.value;
    return {
      x: ((v.x + 1) / 2) * this.container.clientWidth,
      y: ((-v.y + 1) / 2) * this.container.clientHeight,
      r: (p.radius * p.curScale * scaleFactor) / Math.max(dist, 0.001),
      behind: v.z > 1,
    };
  }

  /** 章节掌握度变化时刷新星团标签（由 App 在数据层聚合后调用） */
  updateChapterMastery(clusterId, percent) {
    this.planetManager.updateChapterLabel(clusterId, percent);
    this._markActive();
  }

  /** 账号切换/记录重置后整体同步：全部星球与章节标签平滑过渡到新状态 */
  syncMastery(view) {
    this.data = view;
    this.planetManager.thresholds = view.thresholds ?? this.planetManager.thresholds;
    for (const cluster of view.clusters) {
      for (const p of cluster.planets) this.planetManager.setMastery(p.id, p.mastery);
      this.planetManager.updateChapterLabel(cluster.id, cluster.masteryPercent);
    }
    if (this.selectedId) {
      this.onSelect(this.planetManager.getViewModel(this.selectedId, this.data.links));
    }
    this._markActive();
  }

  /**
   * 切换星系（科目）：热替换星球与连线，复位选中态与相机。
   * 控制台的连线/标签/光晕开关沿用当前状态。
   */
  setGalaxy(view) {
    if (this.selectedId) {
      this.selectedId = null;
      this.planetManager.setSelected(null);
      this.onSelect(null);
    }
    this.cameraController.cancel();
    this.planetManager.dispose();
    this.linkManager.dispose();

    this.data = view;
    this.planetManager = new PlanetManager(this.scene);
    this.planetManager.build(this.data);
    this.planetManager.setGlowScaleFactor(this.container.clientHeight, CONFIG.camera.fov);
    this.planetManager.glowIntensity = this._glowIntensity ?? 1;
    if (this._labelsVisible === false) this.planetManager.setLabelsVisible(false);

    this.linkManager = new LinkManager(this.scene);
    this.linkManager.build(this.data.links, this.planetManager.byId);
    if (this._linksVisible === false) this.linkManager.lines.visible = false;

    this.interaction.pickTargets = [this.planetManager.mesh];
    this.interaction.instanceToPlanet = (i) => this.planetManager.planets[i]?.id;

    this.controls.minDistance = CONFIG.controls.minDistance;
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(...CONFIG.camera.position);
    this.controls.update();
    this._markActive();
  }

  /** 星球悬停反馈：光标变手型 + 光晕微增 */
  #hover(id) {
    this.renderer.domElement.style.cursor = id ? 'pointer' : '';
    this.planetManager.setHovered(id);
  }

  // ── 控制台设置 API（供 UI 实时调用） ──────────────────────
  setAutoRotate(v) { this.autoRotateEnabled = v; this._markActive(); }
  setLinksVisible(v) { this._linksVisible = v; this.linkManager.lines.visible = v; this._markActive(); }
  setLabelsVisible(v) { this._labelsVisible = v; this.planetManager.setLabelsVisible(v); this._markActive(); }
  setGlowIntensity(m) {
    this._glowIntensity = m;
    this.planetManager.glowIntensity = m;
    this.postfx.setGlow(m); // 光晕尺寸与泛光强度同一个旋钮
    this._markActive();
  }
  setFlightDuration(s) { this.flightDuration = s; }

  _markActive() {
    this._lastActive = performance.now();
  }

  #resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.postfx.setSize(w, h);
    this.planetManager.setGlowScaleFactor(h, CONFIG.camera.fov);
    this.background.setScaleFactor(h, CONFIG.camera.fov);
  }

  dispose() {
    this._disposed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this.renderer?.domElement.removeEventListener('pointerdown', this._onUserInput);
    this.renderer?.domElement.removeEventListener('pointermove', this._onUserInput);
    this.renderer?.domElement.removeEventListener('wheel', this._onUserInput);
    this.interaction?.dispose();
    this.background?.dispose();
    this.planetManager?.dispose();
    this.linkManager?.dispose();
    this.warp?.dispose();
    this.postfx?.dispose();
    this.controls?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}
