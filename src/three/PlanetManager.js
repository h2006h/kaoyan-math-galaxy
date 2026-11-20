import * as THREE from 'three';
import { CONFIG, PLANET_STATES, masteryToState, isMobile } from './config.js';

// 固定种子伪随机：布局可复现，刷新页面星图不变
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 星球光晕用"甜甜圈"贴图：中心透明、峰值在球体边缘之外，
// 加色混合下光晕环绕球体而不是盖在球体上，聚焦时星球本体依然清晰
function makeGlowTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.26, 'rgba(255,255,255,0.04)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.58, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 柔和小圆点：轨道粒子等小尺寸点精灵用
function makeDotTexture(size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 星球表面噪声贴图：Canvas 程序化生成，近白底 + 低透明度明暗斑块，
// 作 map 轻微调制颜色、作 bumpMap 提供表面起伏，避免加载外部纹理
function makeNoiseTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f2f4f8';
  ctx.fillRect(0, 0, size, size);
  const rand = mulberry32(2024);
  for (let i = 0; i < 130; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 6 + rand() * 30;
    const dark = rand() < 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, dark ? `rgba(96,110,140,${0.05 + rand() * 0.1})` : `rgba(255,255,255,${0.05 + rand() * 0.08})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// 章节标签：名称 + 掌握度一行。掌握度变化时只重绘 canvas，不重建 sprite
function makeChapterLabel(name, percent) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })
  );
  sprite.scale.set(26, 8.1, 1);

  const redraw = (pct) => {
    ctx.clearRect(0, 0, 512, 160);
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(80,140,255,0.9)';
    ctx.shadowBlur = 16;
    ctx.font = '600 52px "PingFang SC", "Microsoft YaHei", sans-serif';
    // 长章节名（如「向量代数与空间解析几何」11 字）按实测宽度缩字号，防止超出 512 画布被裁切
    const nameW = ctx.measureText(name).width;
    if (nameW > 470) ctx.font = `600 ${Math.floor(52 * 470 / nameW)}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = 'rgba(230,240,255,0.95)';
    ctx.fillText(name, 256, 62);
    ctx.shadowBlur = 8;
    ctx.font = '400 30px "PingFang SC", "Microsoft YaHei", sans-serif';
    if (pct == null) {
      ctx.fillStyle = 'rgba(143,162,200,0.75)';
      ctx.fillText('未开始', 256, 122);
    } else {
      ctx.fillStyle = pct >= 80 ? '#2ee6c8' : pct <= 30 ? '#ff9440' : '#6aa5ff';
      ctx.fillText(`掌握度 ${pct}%`, 256, 122);
    }
    tex.needsUpdate = true;
  };
  redraw(percent);
  return { sprite, redraw };
}

// 光晕用单个 Points + ShaderMaterial：一次 draw call，
// 薄弱态呼吸在 GPU 上按 sin(uTime * 2π/period) 完成，周期 2s
const GLOW_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aPulse;
  uniform float uTime;
  uniform float uScaleFactor;
  uniform float uPulseOmega;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    float pulse = aPulse > 0.5 ? (0.68 + 0.32 * sin(uTime * uPulseOmega)) : 1.0;
    vAlpha = pulse;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * pulse * (uScaleFactor / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const GLOW_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a;
    gl_FragColor = vec4(vColor, a * vAlpha);
  }
`;

// ── 星轨：环体 shader 流光（两道亮弧沿环缓慢运行）─────────────
const RING_VERT = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const RING_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uFlowSpeed;
  uniform float uOuter;
  varying vec2 vPos;
  void main() {
    float angle = atan(vPos.y, vPos.x);
    float r = length(vPos);
    float flow = pow(0.5 + 0.5 * sin(angle * 2.0 - uTime * uFlowSpeed), 4.0);
    float edge = smoothstep(uOuter * 0.955, uOuter * 0.975, r) * (1.0 - smoothstep(uOuter * 0.995, uOuter * 1.015, r));
    float alpha = (0.10 + 0.38 * flow) * edge;
    gl_FragColor = vec4(uColor * (0.7 + 0.9 * flow), alpha);
  }
`;

// ── 轨道粒子：全部星团合并为一个 Points，顶点 shader 内沿轨道运行 ──
const ORBIT_VERT = /* glsl */ `
  attribute vec3 aCenter;
  attribute float aAngle;
  attribute float aSpeed;
  attribute float aRadius;
  attribute float aY;
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uScaleFactor;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    float ang = aAngle + uTime * aSpeed;
    vec3 pos = aCenter + vec3(cos(ang) * aRadius, aY, sin(ang) * aRadius);
    vTw = 0.7 + 0.3 * sin(uTime * 1.7 + aAngle * 7.0);
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * vTw * (uScaleFactor / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const ORBIT_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a;
    gl_FragColor = vec4(vColor * vTw, a * 0.85);
  }
`;

// ── 悬停 Reticle：旋转虚线高亮光环，始终面向相机 ──────────────
const RETICLE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vPos;
  void main() {
    float angle = atan(vPos.y, vPos.x);
    float r = length(vPos);
    float dashes = smoothstep(0.3, 0.42, fract(angle / 6.28318 * 14.0 - uTime * 0.3));
    float edge = smoothstep(1.16, 1.19, r) * (1.0 - smoothstep(1.27, 1.30, r));
    gl_FragColor = vec4(uColor, dashes * edge * 0.95);
  }
`;

const CLUSTER_COLORS = [0x3f8cff, 0xc792ff, 0x2ee6c8, 0xffd166, 0x6aa5ff, 0xff6ad5, 0x8fe36b, 0xff9a5c, 0x5cd6d6];

export class PlanetManager {
  constructor(scene) {
    this.scene = scene;
    this.planets = [];
    this.byId = new Map();
    this.selectedId = null;
    this.hoveredId = null;
    this.glowIntensity = 1; // 控制台实时调节的全局光晕倍率
    this.clusterCenters = new Map(); // clusterId -> Vector3
    this.timeUniform = { value: 0 };
    this._matrix = new THREE.Matrix4();
    this._labels = [];
    this._rings = [];
    this._reticleOpacity = 0;
  }

  build(data) {
    const { ringRadius, clusterYOffsets } = CONFIG.galaxy;
    this.thresholds = data.thresholds ?? { mastered: 80, weak: 30 };
    this.glowTexture = makeGlowTexture();
    this.dotTexture = makeDotTexture();

    // 1. 星团中心：均匀分布在水平环上，Y 按索引取固定错层
    data.clusters.forEach((cluster, ci) => {
      const angle = (ci / data.clusters.length) * Math.PI * 2 + Math.PI / 2;
      const center = new THREE.Vector3(
        Math.cos(angle) * ringRadius,
        clusterYOffsets[ci % clusterYOffsets.length],
        Math.sin(angle) * ringRadius
      );
      this.clusterCenters.set(cluster.id, center);

      const label = makeChapterLabel(cluster.name, cluster.masteryPercent ?? null);
      label.sprite.position.copy(center).add(new THREE.Vector3(0, CONFIG.cluster.radius + 6, 0));
      label.clusterId = cluster.id;
      label.percent = cluster.masteryPercent ?? null;
      this.scene.add(label.sprite);
      this._labels.push(label);

      // 星轨环：shader 流光，两道亮弧沿环缓慢运行，暗示星团的引力范围
      const outer = CONFIG.cluster.radius * 1.02;
      const ringColor = new THREE.Color(CLUSTER_COLORS[ci % CLUSTER_COLORS.length]);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(CONFIG.cluster.radius * 0.955, outer, 96),
        new THREE.ShaderMaterial({
          uniforms: {
            uTime: this.timeUniform,
            uColor: { value: ringColor },
            uFlowSpeed: { value: CONFIG.visual.ringFlowSpeed },
            uOuter: { value: outer },
          },
          vertexShader: RING_VERT,
          fragmentShader: RING_FRAG,
          transparent: true,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(center);
      this.scene.add(ring);
      this._rings.push(ring);

      this.#buildClusterPlanets(cluster, center);
    });

    this.#buildInstancedMesh();
    this.#buildGlowPoints();
    this.#buildOrbitParticles(data.clusters.length);
    this.#buildReticle();
    this.#buildSelectedHalo();
  }

  // 星团内布局：斐波那契球面方向 + 半径分层 + 固定种子抖动，
  // 保证任意数量星球都近似均匀且不重叠
  #buildClusterPlanets(cluster, center) {
    const n = cluster.planets.length;
    const rand = mulberry32(cluster.id.length * 7919 + n);
    const golden = Math.PI * (3 - Math.sqrt(5));

    cluster.planets.forEach((p, i) => {
      const y = 1 - ((i + 0.5) / n) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = golden * i;
      const dir = new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r);

      const layer =
        CONFIG.cluster.innerRadiusRatio +
        (1 - CONFIG.cluster.innerRadiusRatio) * Math.cbrt((i + 1) / n);
      const jitter = 0.85 + rand() * 0.3;
      const position = center
        .clone()
        .addScaledVector(dir, CONFIG.cluster.radius * layer * jitter);

      const stateKey = masteryToState(p.mastery, this.thresholds);
      const state = PLANET_STATES[stateKey];
      const radius =
        CONFIG.planet.baseRadius * (p.highFreq ? CONFIG.planet.highFreqScale : 1);
      const emissive = CONFIG.visual.emissiveBoost[stateKey] * (p.highFreq ? 1.25 : 1);

      const planet = {
        id: p.id,
        name: p.name,
        desc: p.desc,
        highFreq: !!p.highFreq,
        examScope: p.examScope ?? [1, 2, 3],
        mastery: p.mastery,
        chapterId: cluster.id,
        chapterName: cluster.name,
        clusterCenter: center,
        position,
        radius,
        stateKey,
        curColor: state.color.clone(),
        tgtColor: state.color.clone(),
        curGlow: state.glow * (p.highFreq ? 1.35 : 1),
        tgtGlow: state.glow * (p.highFreq ? 1.35 : 1),
        baseGlow: state.glow * (p.highFreq ? 1.35 : 1),
        curEmissive: emissive,
        tgtEmissive: emissive,
        baseEmissive: emissive,
        curScale: 1,
        tgtScale: 1,
        index: this.planets.length,
      };
      this.planets.push(planet);
      this.byId.set(planet.id, planet);
    });
  }

  // 所有星球共用一个 InstancedMesh：上百个星球也只有 1 次 draw call。
  // 颜色走 instanceColor，尺寸走 instanceMatrix，自发光强度走 aEmissive 实例属性，
  // 薄弱态呼吸由 aPulse + uTime 在 shader 内完成（周期 2s）
  #buildInstancedMesh() {
    const [ws, hs] = isMobile ? [12, 10] : CONFIG.planet.segments;
    const geo = new THREE.SphereGeometry(1, ws, hs);
    const noise = makeNoiseTexture();
    this.noiseTexture = noise;
    const mat = new THREE.MeshStandardMaterial({
      map: noise,
      bumpMap: noise,
      bumpScale: 0.025,
      roughness: 0.5,
      metalness: 0.15,
      emissive: 0xffffff,
      emissiveIntensity: 1.0, // 强度由 aEmissive 实例属性按状态携带
    });
    const pulseOmega = (Math.PI * 2) / CONFIG.visual.pulsePeriod;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.timeUniform;
      shader.uniforms.uPulseOmega = { value: pulseOmega };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           attribute float aEmissive;
           attribute float aPulse;
           uniform float uTime;
           uniform float uPulseOmega;
           varying float vEmissive;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float epulse = aPulse > 0.5 ? (0.72 + 0.28 * sin(uTime * uPulseOmega)) : 1.0;
           vEmissive = aEmissive * epulse;`
        );
      // instanceColor 默认只染 diffuse；把 emissive 也乘上实例色与实例强度，
      // 四种状态的颜色才会在球体亮面/暗面都成立。
      // 再乘噪声贴图的明暗斑块：自发光随之起伏，聚焦时球面有纹理而不是均匀白盘
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying float vEmissive;'
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
	float surf = clamp((texture2D(map, vMapUv).g - 0.72) / 0.28, 0.0, 1.0);
	totalEmissiveRadiance *= vColor.rgb * vEmissive * (0.6 + 0.55 * surf);`
        );
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, this.planets.length);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const emissives = new Float32Array(this.planets.length);
    const pulses = new Float32Array(this.planets.length);
    for (const p of this.planets) {
      this._matrix.makeScale(p.radius, p.radius, p.radius);
      this._matrix.setPosition(p.position);
      this.mesh.setMatrixAt(p.index, this._matrix);
      this.mesh.setColorAt(p.index, p.curColor);
      emissives[p.index] = p.curEmissive;
      pulses[p.index] = PLANET_STATES[p.stateKey].pulse ? 1 : 0;
    }
    geo.setAttribute('aEmissive', new THREE.InstancedBufferAttribute(emissives, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aPulse', new THREE.InstancedBufferAttribute(pulses, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.mesh);
  }

  #buildGlowPoints() {
    const n = this.planets.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const pulses = new Float32Array(n);

    for (const p of this.planets) {
      positions.set([p.position.x, p.position.y, p.position.z], p.index * 3);
      colors.set([p.curColor.r, p.curColor.g, p.curColor.b], p.index * 3);
      sizes[p.index] = this.#glowSize(p);
      pulses[p.index] = PLANET_STATES[p.stateKey].pulse ? 1 : 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aPulse', new THREE.BufferAttribute(pulses, 1));

    this.glowUniforms = {
      uTime: this.timeUniform,
      uMap: { value: this.glowTexture },
      uScaleFactor: { value: 800 },
      uPulseOmega: { value: (Math.PI * 2) / CONFIG.visual.pulsePeriod },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.glowUniforms,
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.glow = new THREE.Points(geo, mat);
    this.glow.frustumCulled = false; // 点云整体不做剔除，避免边缘光晕闪没
    this.scene.add(this.glow);
  }

  // 沿星轨运行的粒子：所有星团合并为一个 Points（1 次 draw call），
  // 位置完全在顶点 shader 内由 uTime 推导，CPU 零开销
  #buildOrbitParticles(clusterCount) {
    const per = CONFIG.visual.orbitParticlesPerCluster;
    const n = clusterCount * per;
    const centers = new Float32Array(n * 3);
    const angles = new Float32Array(n);
    const speeds = new Float32Array(n);
    const radii = new Float32Array(n);
    const ys = new Float32Array(n);
    const sizes = new Float32Array(n);
    const colors = new Float32Array(n * 3);
    const rand = mulberry32(555);
    const centerList = [...this.clusterCenters.values()];

    for (let i = 0; i < n; i++) {
      const ci = Math.floor(i / per);
      const c = centerList[ci];
      centers.set([c.x, c.y, c.z], i * 3);
      angles[i] = rand() * Math.PI * 2;
      speeds[i] = (0.04 + rand() * 0.05) * (rand() < 0.5 ? 1 : -1); // 双向运行，更像真实轨道
      radii[i] = CONFIG.cluster.radius * (0.96 + rand() * 0.08);
      ys[i] = (rand() - 0.5) * 1.6;
      sizes[i] = 0.5 + rand() * 0.7;
      const col = new THREE.Color(CLUSTER_COLORS[ci % CLUSTER_COLORS.length]);
      const b = 0.7 + rand() * 0.8;
      colors.set([col.r * b, col.g * b, col.b * b], i * 3);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(centers.slice(), 3)); // 占位，真实位置在 shader
    geo.setAttribute('aCenter', new THREE.BufferAttribute(centers, 3));
    geo.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geo.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
    geo.setAttribute('aY', new THREE.BufferAttribute(ys, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

    this.orbits = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.timeUniform,
          uMap: { value: this.dotTexture },
          uScaleFactor: this.glowUniforms.uScaleFactor,
        },
        vertexShader: ORBIT_VERT,
        fragmentShader: ORBIT_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.orbits.frustumCulled = false;
    this.scene.add(this.orbits);
  }

  #buildReticle() {
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(1.16, 1.3, 64),
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.timeUniform,
          uColor: { value: new THREE.Color(0x9fe8ff) },
        },
        vertexShader: RING_VERT,
        fragmentShader: RETICLE_FRAG,
        transparent: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.reticle.visible = false;
    this.reticle.renderOrder = 5;
    this.scene.add(this.reticle);
  }

  // 选中星球的专属光晕：呼吸缩放的叠加 Sprite，颜色跟随状态色
  #buildSelectedHalo() {
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.halo.visible = false;
    this.scene.add(this.halo);
  }

  #glowSize(p) {
    return p.radius * CONFIG.planet.glowSizeRatio * p.curGlow * p.curScale * this.glowIntensity;
  }

  // 选中/悬停的反馈目标值统一在这里计算，避免多处各写一份
  #applyFeedbackTargets(p) {
    const selected = this.selectedId === p.id;
    const hovered = this.hoveredId === p.id;
    p.tgtScale = selected ? CONFIG.planet.selectedScale : hovered ? 1.08 : 1;
    p.tgtGlow = p.baseGlow * (selected ? 1.15 : hovered ? 1.2 : 1);
    p.tgtEmissive = p.baseEmissive * (selected ? 1.1 : hovered ? 1.15 : 1);
  }

  // 对外：掌握度更新入口。只改目标值，具体过渡在 update() 里逐帧 lerp
  setMastery(id, score) {
    const p = this.byId.get(id);
    if (!p) return;
    p.mastery = score;
    p.stateKey = masteryToState(score, this.thresholds);
    const s = PLANET_STATES[p.stateKey];
    p.tgtColor.copy(s.color);
    p.baseGlow = s.glow * (p.highFreq ? 1.35 : 1);
    p.baseEmissive = CONFIG.visual.emissiveBoost[p.stateKey] * (p.highFreq ? 1.25 : 1);
    this.#applyFeedbackTargets(p);
    const pulse = s.pulse ? 1 : 0;
    this.glow.geometry.attributes.aPulse.array[p.index] = pulse;
    this.glow.geometry.attributes.aPulse.needsUpdate = true;
    this.mesh.geometry.attributes.aPulse.array[p.index] = pulse;
    this.mesh.geometry.attributes.aPulse.needsUpdate = true;
  }

  setSelected(id) {
    const prev = this.selectedId && this.byId.get(this.selectedId);
    this.selectedId = id;
    if (prev) this.#applyFeedbackTargets(prev);
    const cur = id && this.byId.get(id);
    if (cur) this.#applyFeedbackTargets(cur);
  }

  setHovered(id) {
    if (id === this.hoveredId) return;
    const prev = this.hoveredId && this.byId.get(this.hoveredId);
    this.hoveredId = id;
    if (prev) this.#applyFeedbackTargets(prev);
    const cur = id && this.byId.get(id);
    if (cur) this.#applyFeedbackTargets(cur);
  }

  updateChapterLabel(clusterId, percent) {
    const label = this._labels.find((l) => l.clusterId === clusterId);
    if (label) {
      label.percent = percent;
      label.redraw(percent);
    }
  }

  setLabelsVisible(v) {
    for (const label of this._labels) label.sprite.visible = v;
    for (const ring of this._rings) ring.visible = v;
    if (this.orbits) this.orbits.visible = v;
  }

  update(dt, time, camera) {
    if (!this.mesh) return;
    const k = 1 - Math.exp(-CONFIG.planet.lerpSpeed * dt);
    this.timeUniform.value = time;

    const glowColor = this.glow.geometry.attributes.aColor;
    const glowSize = this.glow.geometry.attributes.aSize;
    const emissive = this.mesh.geometry.attributes.aEmissive;

    for (const p of this.planets) {
      p.curColor.lerp(p.tgtColor, k);
      p.curGlow += (p.tgtGlow - p.curGlow) * k;
      p.curScale += (p.tgtScale - p.curScale) * k;
      p.curEmissive += (p.tgtEmissive - p.curEmissive) * k;

      this._matrix.makeScale(p.radius * p.curScale, p.radius * p.curScale, p.radius * p.curScale);
      this._matrix.setPosition(p.position);
      this.mesh.setMatrixAt(p.index, this._matrix);
      this.mesh.setColorAt(p.index, p.curColor);
      emissive.array[p.index] = p.curEmissive;

      glowColor.array[p.index * 3] = p.curColor.r;
      glowColor.array[p.index * 3 + 1] = p.curColor.g;
      glowColor.array[p.index * 3 + 2] = p.curColor.b;
      glowSize.array[p.index] = this.#glowSize(p);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    emissive.needsUpdate = true;
    glowColor.needsUpdate = true;
    glowSize.needsUpdate = true;

    // 悬停 Reticle：面向相机的高亮虚线环，淡入淡出
    const hovered = this.hoveredId && this.byId.get(this.hoveredId);
    this._reticleOpacity += ((hovered ? 1 : 0) - this._reticleOpacity) * k;
    if (this._reticleOpacity > 0.02 && (hovered || this._lastHovered)) {
      const target = hovered ?? this._lastHovered;
      this.reticle.visible = true;
      this.reticle.position.copy(target.position);
      const s = target.radius * target.curScale;
      this.reticle.scale.set(s, s, s);
      if (camera) this.reticle.quaternion.copy(camera.quaternion);
      this.reticle.material.uniforms.uColor.value
        .copy(target.curColor)
        .lerp(new THREE.Color(0xffffff), 0.35)
        .multiplyScalar(0.9 * this._reticleOpacity);
    } else {
      this.reticle.visible = false;
    }
    this._lastHovered = hovered;

    // 选中光环：跟随状态色，轻微呼吸
    const selected = this.selectedId && this.byId.get(this.selectedId);
    this.halo.visible = !!selected;
    if (selected) {
      this.halo.position.copy(selected.position);
      const hs = selected.radius * selected.curScale * 4.6 * (1 + 0.045 * Math.sin(time * 1.3));
      this.halo.scale.set(hs, hs, 1);
      this.halo.material.color.copy(selected.curColor);
      this.halo.material.opacity = 0.3 * this.glowIntensity;
    }
  }

  setGlowScaleFactor(viewportHeight, fovDeg) {
    // gl_PointSize 的世界尺寸→像素换算系数：height / (2 * tan(fov/2))
    this.glowUniforms.uScaleFactor.value =
      viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  getViewModel(id, links) {
    const p = this.byId.get(id);
    if (!p) return null;
    const related = links
      .filter((l) => l.from === id || l.to === id)
      .map((l) => {
        const otherId = l.from === id ? l.to : l.from;
        const other = this.byId.get(otherId);
        return {
          id: otherId,
          name: other.name,
          stateLabel: PLANET_STATES[other.stateKey].label,
          strength: l.strength,
        };
      })
      .sort((a, b) => b.strength - a.strength);
    return {
      id: p.id,
      name: p.name,
      desc: p.desc,
      chapterName: p.chapterName,
      mastery: p.mastery,
      highFreq: p.highFreq,
      examScope: p.examScope,
      stateLabel: PLANET_STATES[p.stateKey].label,
      stateKey: p.stateKey,
      related,
    };
  }

  dispose() {
    this.mesh?.geometry.dispose();
    this.mesh?.material.dispose();
    if (this.mesh) this.scene.remove(this.mesh);
    this.noiseTexture?.dispose();
    this.glow?.geometry.dispose();
    this.glow?.material.dispose();
    if (this.glow) this.scene.remove(this.glow);
    this.glowTexture?.dispose();
    this.dotTexture?.dispose();
    this.orbits?.geometry.dispose();
    this.orbits?.material.dispose();
    if (this.orbits) this.scene.remove(this.orbits);
    this.reticle?.geometry.dispose();
    this.reticle?.material.dispose();
    if (this.reticle) this.scene.remove(this.reticle);
    this.halo?.material.dispose();
    if (this.halo) this.scene.remove(this.halo);
    for (const label of this._labels) {
      label.sprite.material.map.dispose();
      label.sprite.material.dispose();
      this.scene.remove(label.sprite);
    }
    for (const ring of this._rings) {
      ring.geometry.dispose();
      ring.material.dispose();
      this.scene.remove(ring);
    }
  }
}