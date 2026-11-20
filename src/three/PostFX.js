import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CONFIG, isMobile } from './config.js';

// 后处理管线：RenderPass → UnrealBloomPass → OutputPass。
// EffectComposer 默认 HalfFloat 渲染目标，>1 的 HDR 亮度（亮星/自发光星球/流光）
// 才能越过 bloom 阈值发光；OutputPass 统一做 ACES 色调映射 + sRGB 输出。
export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.baseStrength = isMobile ? CONFIG.visual.mobileBloomStrength : CONFIG.visual.bloomStrength;

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = CONFIG.visual.exposure;
    // composer 一帧有多次内部 render：关掉自动重置，由主循环手动 reset，
    // 这样 renderer.info.render.calls 统计的是整帧（含 bloom 各 mip）的真实 draw call
    renderer.info.autoReset = false;

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    const size = renderer.getSize(new THREE.Vector2());
    // 泛光半分辨率：bloom 的 5 级 mip 链是填充率大户，半分辨率肉眼几乎无差
    this.bloomPass = new UnrealBloomPass(
      size.clone().multiplyScalar(0.5),
      this.baseStrength,
      CONFIG.visual.bloomRadius,
      CONFIG.visual.bloomThreshold
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
  }

  /** 光晕滑杆：星球光晕尺寸与泛光强度同一个旋钮，手感一致 */
  setGlow(m) {
    this.bloomPass.strength = this.baseStrength * m;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    // composer.setSize 会按绘制缓冲重设 pass 尺寸，这里统一收回到半分辨率
    this.bloomPass.resolution.set(Math.round(w * 0.5), Math.round(h * 0.5));
  }

  /** 自适应画质：随像素密度一起缩放 composer，保证渲染目标与画布同步 */
  setPixelRatio(pr) {
    this.composer.setPixelRatio(pr);
  }

  render() {
    this.composer.render();
  }

  dispose() {
    this.bloomPass.dispose();
    this.composer.dispose();
  }
}