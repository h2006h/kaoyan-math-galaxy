import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG } from './config.js';

// 像素密度：上限 1.5（高分屏不做 4 倍填充）；绘制面积超过约 380 万像素后
// 按面积收敛比例，避免 2K/4K 大屏被填充率拖垮
function pickPixelRatio(container) {
  const w = Math.max(container.clientWidth, 1);
  const h = Math.max(container.clientHeight, 1);
  const cap = Math.min(window.devicePixelRatio || 1, 1.5);
  const maxPixels = 3.8e6;
  const ratio = Math.min(cap, Math.sqrt(maxPixels / (w * h)));
  return Math.max(1, Math.round(ratio * 100) / 100);
}

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({
    // 后处理最终输出是一次全屏合成，MSAA 只作用于默认帧缓冲，几乎无收益
    antialias: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(pickPixelRatio(container));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  return renderer;
}

export function createCamera(container) {
  const { fov, near, far, position } = CONFIG.camera;
  const camera = new THREE.PerspectiveCamera(
    fov,
    container.clientWidth / container.clientHeight,
    near,
    far
  );
  camera.position.set(...position);
  return camera;
}

export function createControls(camera, domElement) {
  const c = CONFIG.controls;
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.dampingFactor = c.dampingFactor;
  controls.minDistance = c.minDistance;
  controls.maxDistance = c.maxDistance;
  controls.autoRotate = false; // 初始由 Engine 的空闲逻辑接管
  controls.autoRotateSpeed = c.autoRotateSpeed;
  controls.target.set(...CONFIG.camera.target);
  controls.update();
  return controls;
}

export function createLights(scene) {
  // 环境光兜底，保证背光面不纯黑
  scene.add(new THREE.AmbientLight(0x8899bb, 0.85));
  // 主平行光：打出球体明暗面，增强体积感
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(80, 120, 60);
  scene.add(key);
  // 紫罗兰轮廓光：从背侧低角度打，球体边缘泛出冷紫轮廓，深空戏剧感
  const rim = new THREE.DirectionalLight(0xb47aff, 0.9);
  rim.position.set(-90, -30, -80);
  scene.add(rim);
  // 星系中心的冷色点光：朝向中心的球面微微泛蓝，营造"星系核心"氛围
  const core = new THREE.PointLight(0x6688ff, 400, 600, 1.8);
  scene.add(core);
}
