import * as THREE from 'three';
import { CONFIG, isMobile } from './config.js';
import { assetUrl } from '../data/assetPath.js';

// 程序化生成柔和圆点贴图：全场景唯一一张通用圆形贴图，
// 星野 / 尘埃 / 星云 / 核心共用，避免加载任何外部图片
function makeSoftDotTexture(size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 星云贴图：单个完美圆形渐变会读成"灰斑"，这里用六个错位瓣体 + 丝状纤维
// + 亮核叠出不规则轮廓；色相在基准附近摆动，远看是一团有层次的发光云气
function makeNebulaTexture(hue, seed = 0, size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(seed * 7919 + 101);
  const c = size / 2;

  // 大范围柔晕：给云体一层很淡的底，多瓣之间不会出现硬边
  let g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, `hsla(${hue}, 78%, 56%, 0.16)`);
  g.addColorStop(0.6, `hsla(${hue}, 72%, 46%, 0.06)`);
  g.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // 六瓣不规则云体：亮部内缩、暗部外扩，色相在基准附近摆动
  for (let i = 0; i < 6; i++) {
    const a = rand() * Math.PI * 2;
    const d = size * (0.05 + rand() * 0.18);
    const x = c + Math.cos(a) * d;
    const y = c + Math.sin(a) * d;
    const r = size * (0.15 + rand() * 0.17);
    const h = hue + (rand() - 0.5) * 44;
    const l = 50 + rand() * 16;
    g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${h}, 82%, ${l.toFixed(0)}%, 0.26)`);
    g.addColorStop(0.55, `hsla(${h}, 76%, ${(l - 12).toFixed(0)}%, 0.10)`);
    g.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  // 丝状纤维：压扁并旋转的长条渐变，做出云气的细流走向
  for (let i = 0; i < 4; i++) {
    const h = hue + (rand() - 0.5) * 28;
    const len = size * (0.3 + rand() * 0.22);
    ctx.save();
    ctx.translate(c + (rand() - 0.5) * size * 0.26, c + (rand() - 0.5) * size * 0.26);
    ctx.rotate(rand() * Math.PI * 2);
    ctx.scale(1, 0.12 + rand() * 0.14);
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, len);
    g.addColorStop(0, `hsla(${h}, 86%, 64%, 0.18)`);
    g.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(-len, -len, len * 2, len * 2);
    ctx.restore();
  }

  // 亮核：小高光让云团有发光中心，作为构图的视觉落点
  const hx = c + (rand() - 0.5) * size * 0.12;
  const hy = c + (rand() - 0.5) * size * 0.12;
  g = ctx.createRadialGradient(hx, hy, 0, hx, hy, size * 0.1);
  g.addColorStop(0, `hsla(${(hue + 18) % 360}, 90%, 80%, 0.42)`);
  g.addColorStop(0.45, `hsla(${hue}, 85%, 65%, 0.14)`);
  g.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 十字星芒贴图：柔光底 + 横竖主芒 + 对角弱芒 + 亮核，全部 Canvas 渐变绘制
function makeFlareTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  let g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(210,225,255,0.20)');
  g.addColorStop(1, 'rgba(210,225,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // 星芒：压扁的径向渐变拉出长条光刺
  const spike = (rot, sx, sy, len, alpha) => {
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(rot);
    ctx.scale(sx, sy);
    const gg = ctx.createRadialGradient(0, 0, 0, 0, 0, len);
    gg.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gg;
    ctx.fillRect(-len, -len, len * 2, len * 2);
    ctx.restore();
  };
  spike(0, 1, 0.045, c, 0.95);
  spike(Math.PI / 2, 1, 0.045, c, 0.95);
  spike(Math.PI / 4, 0.6, 0.03, c, 0.35);
  spike(-Math.PI / 4, 0.6, 0.03, c, 0.35);
  g = ctx.createRadialGradient(c, c, 0, c, c, size * 0.1);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 星野照片预处理：原图 564px 铺满整个天穹球，低亮度 JPEG 色噪与大尺度晕影
// 会被放大约 8 倍，糊成一片片灰紫色斑。做法：先缩到 1/10 再放大得到低频
// 背景，按比例扣除（平场扣除）——大团晕影被抹掉，星点因局部反差大而保留；
// 残余底噪压黑点、暗部去色，最终只剩干净的星点。
function processStarfield(img) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const src = ctx.getImageData(0, 0, w, h);

  const low = document.createElement('canvas');
  low.width = Math.max(2, Math.round(w / 10));
  low.height = Math.max(2, Math.round(h / 10));
  low.getContext('2d').drawImage(img, 0, 0, low.width, low.height);
  const up = document.createElement('canvas');
  up.width = w;
  up.height = h;
  const uctx = up.getContext('2d', { willReadFrequently: true });
  uctx.imageSmoothingEnabled = true;
  uctx.imageSmoothingQuality = 'high';
  uctx.drawImage(low, 0, 0, w, h);
  const lowData = uctx.getImageData(0, 0, w, h).data;

  const SUB = 0.9; // 低频扣除比例：晕影抹除与星点保留的平衡点
  const FLOOR = 14; // 残余底噪归零
  const GAMMA = 1.22;
  const px = src.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = Math.max(0, px[i] - lowData[i] * SUB);
    const g = Math.max(0, px[i + 1] - lowData[i + 1] * SUB);
    const b = Math.max(0, px[i + 2] - lowData[i + 2] * SUB);
    const l = r * 0.299 + g * 0.587 + b * 0.114;
    if (l <= FLOOR) {
      px[i] = px[i + 1] = px[i + 2] = 0;
      continue;
    }
    const t = Math.pow((l - FLOOR) / (255 - FLOOR), GAMMA);
    const k = (t * 255) / l;
    px[i] = Math.min(255, r * k);
    px[i + 1] = Math.min(255, g * k);
    px[i + 2] = Math.min(255, b * k);
  }
  ctx.putImageData(src, 0, 0);
  return canvas;
}

// 伪随机数（固定种子）：背景星点位置可复现，不依赖 Math.random 的调用顺序
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 星云叠加层：fbm 云气，透明加色叠在真实星野天穹之上 ──────────
// 反向球体，fragment 里做 3 octave 值噪声，只输出星云（底色由天穹照片提供）。
// 星云集中在"银道面"附近（|y| 小的区域），并随时间极缓慢漂移。
const DOME_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const DOME_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  varying vec3 vDir;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.55;
    for (int i = 0; i < 3; i++) {
      v += a * noise(p);
      p = p * 2.15 + vec3(7.3);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    vec3 p = dir * 3.2 + vec3(uTime * 0.004, 0.0, uTime * 0.003);
    float n = fbm(p);
    float n2 = fbm(p * 1.7 + vec3(4.7));

    // 银道面：沿 x 方向微倾，中脊 exp 辉光让带状云有一条发光主脉
    float tilt = abs(dir.y + 0.12 + 0.10 * dir.x);
    float band = 1.0 - smoothstep(0.0, 0.52, tilt);
    float ridge = exp(-tilt * 7.0);
    float cloud = smoothstep(0.40, 0.82, n) * band;

    // 分区配色：方位角上循环 青 → 靛紫 → 品红 三段（首尾相接无接缝），
    // 段界被低频噪声扭动；相机转到任何方向，银道面都是一段主色接一段过渡色
    float t = fract(atan(dir.z, dir.x) / 6.2831853 + 0.5 + (n2 - 0.5) * 0.18);
    float seg = t * 3.0;
    float k = floor(seg);
    float f = smoothstep(0.15, 0.85, fract(seg));
    vec3 teal = vec3(0.055, 0.245, 0.30);
    vec3 violet = vec3(0.19, 0.095, 0.40);
    vec3 magenta = vec3(0.31, 0.085, 0.27);
    vec3 a = k < 0.5 ? teal : (k < 1.5 ? violet : magenta);
    vec3 b = k < 0.5 ? violet : (k < 1.5 ? magenta : teal);
    vec3 nebula = mix(a, b, f);
    nebula = mix(nebula, magenta, smoothstep(0.66, 0.92, n) * 0.35);
    nebula = mix(nebula, teal, smoothstep(0.68, 0.94, n2) * 0.25);

    // 高纬卷云：单次噪声即可（第三组 fbm 是穹顶最大的片元开销，卷云又极淡，
    // 降低细节不可见）；给上下两片天空补层次
    float cirrus = smoothstep(0.52, 0.8, noise(p * 4.6 + vec3(11.3)))
                 * smoothstep(0.15, 0.6, abs(dir.y)) * 0.32;
    vec3 cirrusCol = vec3(0.10, 0.12, 0.30);

    vec3 col = nebula * cloud + cirrusCol * cirrus + vec3(0.10, 0.16, 0.28) * ridge * 0.5;
    gl_FragColor = vec4(col * uIntensity, clamp(cloud + cirrus + ridge * 0.3, 0.0, 0.6));
  }
`;

// ── 星野：单 Points + ShaderMaterial，闪烁在 GPU 按时间正弦完成 ──
const STAR_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute float aSpeed;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uScaleFactor;
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    float tw = 0.62 + 0.38 * sin(uTime * aSpeed + aPhase);
    vTwinkle = tw;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (0.8 + 0.2 * tw) * (uScaleFactor / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const STAR_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a;
    gl_FragColor = vec4(vColor * (0.5 + 0.5 * vTwinkle), a);
  }
`;

// ── 十字星芒：单 Points + ShaderMaterial，明暗呼吸在 GPU 正弦完成 ──
const FLARE_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute float aSpeed;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uScaleFactor;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    float tw = 0.55 + 0.45 * sin(uTime * aSpeed + aPhase); // 微弱明暗呼吸
    vTw = tw;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (0.85 + 0.3 * tw) * (uScaleFactor / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const FLARE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a;
    gl_FragColor = vec4(vColor * vTw, a);
  }
`;

// 远景星云的构图表（方位角 az 从 +z 起算、y 为世界高度、dist 为到原点距离）。
// 相机俯视时屏幕"上方"对应世界 y 偏低，坐标按投影公式反解：
// 默认视角下紫/青两团落在画面左右上角、品红/蓝两团落在左右下角，
// 正好把知识星系框在中央；琥珀与极光绿收在背面，转动视角才出现
const NEBULA_LAYOUT = [
  { az: 149, y: -311, dist: 1124, scale: 700, hue: 264, op: 0.28 }, // 紫 · 右上角
  { az: 211, y: -302, dist: 1066, scale: 640, hue: 187, op: 0.24 }, // 青 · 左上角
  { az: 220, y: -715, dist: 1134, scale: 680, hue: 312, op: 0.22 }, // 品红 · 左下角
  { az: 139, y: -693, dist: 1080, scale: 660, hue: 222, op: 0.24 }, // 蓝 · 右下角
  { az: 26, y: -314, dist: 1132, scale: 500, hue: 32, op: 0.16 },   // 琥珀 · 背面右上小面积点缀
  { az: 260, y: -634, dist: 1010, scale: 560, hue: 168, op: 0.15 }, // 极光绿 · 背面右下小面积点缀
];

export class Background {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    // 分层视差：天穹远（偏移小）、星野近（偏移大），差动才是"环顾宇宙"而非贴图
    this.skyGroup = new THREE.Group();
    this.starGroup = new THREE.Group();
    this.group.add(this.skyGroup, this.starGroup);
    this.dotTexture = makeSoftDotTexture();
    this.flareTexture = makeFlareTexture();
    this.timeUniform = { value: 0 };
    this.scaleUniform = { value: 800 };
    this._parallax = { x: 0, y: 0 };
    this._parallaxTarget = { x: 0, y: 0 };
    this._onPointerMove = (e) => {
      this._parallaxTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
      this._parallaxTarget.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    this._onPointerLeave = () => {
      this._parallaxTarget.x = 0;
      this._parallaxTarget.y = 0;
    };
    window.addEventListener('pointermove', this._onPointerMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', this._onPointerLeave);
    this.#buildSky();
    this.#buildDome();
    this.#buildStars();
    this.#buildFlares();
    this.#buildNebulas();
    this.#buildCore();
    this.#buildDust();
  }

  // 真实星野天穹：深空摄影图贴在内表面球上，随鼠标轻微视差 + 极慢自转。
  // 材质 color 调暗（0x777777）：纯白星点 HDR ≈0.18，远低于 bloom 阈值 0.8，
  // 用亮度预算实现泛光隔离，无需 selective-bloom 的额外 render pass。
  // 贴图加载失败时退化为深邃纯色底 + 星云/星野层，场景依然完整可用。
  #buildSky() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x060a18, // 加载完成前先以深邃蓝黑垫底，避免灰球闪帧
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(CONFIG.background.skyRadius, 48, 32),
      mat
    );
    this.sky.renderOrder = -11; // 比星云层(-10)更先画，永远垫底
    this.sky.frustumCulled = false;
    this.skyGroup.add(this.sky);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const tex = new THREE.CanvasTexture(processStarfield(img));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      mat.map = tex;
      mat.color.set(CONFIG.background.skyDim);
      mat.needsUpdate = true;
    };
    img.onerror = () => {}; // 加载失败：保留深邃纯色底，不报错不白屏
    img.src = assetUrl(CONFIG.background.skyTexture);
  }

  #buildDome() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.timeUniform,
        uIntensity: { value: CONFIG.visual.nebulaIntensity },
      },
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1400, 40, 28), mat);
    this.dome.renderOrder = -10; // 紧跟天穹之后，作为星云的透明叠加层
    this.dome.frustumCulled = false;
    this.skyGroup.add(this.dome);
  }

  #buildStars() {
    const count = isMobile ? CONFIG.background.mobileStarCount : CONFIG.background.starCount;
    this.starCount = count;
    const [rMin, rMax] = CONFIG.background.starShell;
    const [sMin, sMax] = CONFIG.background.twinkleSpeed;
    const rand = mulberry32(42);

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    const palette = [
      new THREE.Color(0xffffff),
      new THREE.Color(0xcfe4ff), // 冷蓝
      new THREE.Color(0xffe8c9), // 暖黄
      new THREE.Color(0xd8c9ff), // 微紫
    ];

    for (let i = 0; i < count; i++) {
      const r = rMin + (rMax - rMin) * Math.cbrt(rand());
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      const c = palette[Math.floor(rand() * palette.length)];
      // 少数亮星亮度 >1（HDR），越过 bloom 阈值后带辉光
      const brightness = rand() < 0.06 ? 1.6 + rand() * 1.2 : 0.5 + rand() * 0.75;
      colors[i * 3] = c.r * brightness;
      colors[i * 3 + 1] = c.g * brightness;
      colors[i * 3 + 2] = c.b * brightness;
      sizes[i] = 1.2 + rand() * 2.6;
      phases[i] = rand() * Math.PI * 2;
      speeds[i] = sMin + rand() * (sMax - sMin);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.timeUniform,
        uMap: { value: this.dotTexture },
        uScaleFactor: this.scaleUniform,
      },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.stars = new THREE.Points(geo, mat);
    this.stars.frustumCulled = false;
    this.starGroup.add(this.stars);
  }

  // 十字星芒层：26 颗（移动 14）放在最远球壳，|y|≥0.45 远离银道面——
  // 只出现在画面上下边缘，不与知识连线区域重叠；深度测试保证星球遮挡星芒。
  // 亮度封顶 0.72：加色混合峰值也低于 bloom 阈值，泛光只留给星球与连线。
  #buildFlares() {
    const B = CONFIG.background;
    const count = isMobile ? B.mobileFlareCount : B.flareCount;
    const [rMin, rMax] = B.flareShell;
    const rand = mulberry32(2026);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    const tint = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const y = (rand() < 0.5 ? -1 : 1) * (0.45 + rand() * 0.5);
      const theta = rand() * Math.PI * 2;
      const rh = Math.sqrt(1 - y * y);
      const r = rMin + rand() * (rMax - rMin);
      positions[i * 3] = r * rh * Math.cos(theta);
      positions[i * 3 + 1] = r * y;
      positions[i * 3 + 2] = r * rh * Math.sin(theta);
      const b = 0.45 + rand() * (B.flareMaxBrightness - 0.45);
      tint.setHSL(0.58 + rand() * 0.08, 0.35, 0.75 + rand() * 0.2); // 冷白微蓝
      colors[i * 3] = tint.r * b;
      colors[i * 3 + 1] = tint.g * b;
      colors[i * 3 + 2] = tint.b * b;
      sizes[i] = 14 + rand() * 16;
      phases[i] = rand() * Math.PI * 2;
      speeds[i] = 0.3 + rand() * 0.6; // 呼吸周期 7~21s，微弱不刺眼
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

    this.flares = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.timeUniform,
          uMap: { value: this.flareTexture },
          uScaleFactor: this.scaleUniform,
        },
        vertexShader: FLARE_VERT,
        fragmentShader: FLARE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.flares.frustumCulled = false;
    this.starGroup.add(this.flares);
  }

  // 远景星云：手工构图而非随机撒点——六团云沿一圈倾斜远环（半径 1100+）分布，
  // 高低错落：默认视角下正好落在画面左上/右上/左下/右下，把知识星系"框"在中央；
  // 色相两两对望（紫↔青、品红↔蓝），琥珀与极光绿两团小面积点缀放在背面，
  // 转动视角时才徐徐出现，制造"环顾宇宙"的探索感。
  #buildNebulas() {
    const B = CONFIG.background;
    const count = isMobile ? B.mobileNebulaCount : B.nebulaCount;
    const scaleMul = isMobile ? 0.72 : 1;
    for (let i = 0; i < count && i < NEBULA_LAYOUT.length; i++) {
      const item = NEBULA_LAYOUT[i];
      const mat = new THREE.SpriteMaterial({
        map: makeNebulaTexture(item.hue, i + 1),
        transparent: true,
        opacity: item.op,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      const s = item.scale * scaleMul;
      sprite.scale.set(s, s, 1);
      const az = THREE.MathUtils.degToRad(item.az);
      sprite.position.set(Math.sin(az) * item.dist, item.y, Math.cos(az) * item.dist);
      this.group.add(sprite);
    }
  }

  // 星系核心：原点一团克制的冷蓝引力辉光（点贴图着色，不用整圆星云贴图，
  // 避免在中央标题后面糊出一块灰斑），亮度远低于泛光阈值
  #buildCore() {
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.dotTexture,
        color: 0x3d5bff,
        transparent: true,
        opacity: 0.15,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    halo.scale.set(46, 46, 1);
    this.group.add(halo);

    const heart = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.dotTexture,
        color: 0xd6e4ff,
        transparent: true,
        opacity: 0.26,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    heart.scale.set(9, 9, 1);
    this.group.add(heart);
  }

  // 近景尘埃：贴着星系平面分布的细小微粒，整层绕 Y 轴极缓慢旋转，
  // 拖拽视角时提供近大远小的速度感与纵深感
  #buildDust() {
    const count = isMobile ? CONFIG.background.mobileDustCount : CONFIG.background.dustCount;
    const rand = mulberry32(99);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const r = 24 + rand() * 110;
      positions[i * 3] = Math.cos(angle) * r;
      positions[i * 3 + 1] = (rand() - 0.5) * 30;
      positions[i * 3 + 2] = Math.sin(angle) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.dust = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.9,
        color: 0x88aaff,
        map: this.dotTexture,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.group.add(this.dust);
  }

  setScaleFactor(viewportHeight, fovDeg) {
    this.scaleUniform.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  update(time, dt) {
    this.timeUniform.value = time;
    this.dust.rotation.y = time * CONFIG.background.dustSpin;
    // 鼠标视差：阻尼趋近目标偏移；天穹/星野两层幅度不同 → 相对位移的纵深感
    const B = CONFIG.background;
    const k = 1 - Math.exp(-B.parallaxDamp * dt);
    this._parallax.x += (this._parallaxTarget.x - this._parallax.x) * k;
    this._parallax.y += (this._parallaxTarget.y - this._parallax.y) * k;
    this.skyGroup.rotation.y = time * B.skySpin + this._parallax.x * B.parallaxSky;
    this.skyGroup.rotation.x = this._parallax.y * B.parallaxSky * 0.55;
    this.starGroup.rotation.y = time * B.starSpin + this._parallax.x * B.parallaxStars;
    this.starGroup.rotation.x = this._parallax.y * B.parallaxStars * 0.55;
  }

  dispose() {
    window.removeEventListener('pointermove', this._onPointerMove);
    document.documentElement.removeEventListener('pointerleave', this._onPointerLeave);
    this.group.traverse((obj) => {
      obj.geometry?.dispose();
      if (obj.material) {
        if (obj.material.map && obj.material.map !== this.dotTexture) obj.material.map.dispose();
        obj.material.dispose();
      }
    });
    this.dotTexture.dispose();
    this.flareTexture.dispose();
  }
}