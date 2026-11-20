import * as THREE from 'three';
import { CONFIG, PLANET_STATES } from './config.js';

const DIM = new THREE.Color(0x2a3a5c);   // 弱关联基色
const BRIGHT = new THREE.Color(0x7fd4ff); // 强关联基色

// 所有连线合并为一个 LineSegments：无论多少条边都只有 1 次 draw call。
// 关联强度用颜色亮度表达；能量流光在 fragment 内沿 aT（0=起点 1=终点）
// 以 fract 周期亮带推进，看起来像知识之间的能量传输。
const LINK_VERT = /* glsl */ `
  attribute float aT;
  attribute float aSeed;
  attribute vec3 color;
  varying vec3 vColor;
  varying float vT;
  varying float vSeed;
  void main() {
    vColor = color;
    vT = aT;
    vSeed = aSeed;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const LINK_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uFlowSpeed;
  uniform float uBase;
  varying vec3 vColor;
  varying float vT;
  varying float vSeed;
  void main() {
    // 每条线 1.5 个流动周期，相位错开；亮带前后沿平滑，像一段能量脉冲
    float f = fract(vT * 1.5 - uTime * uFlowSpeed + vSeed);
    float band = smoothstep(0.0, 0.10, f) * (1.0 - smoothstep(0.16, 0.42, f));
    vec3 col = vColor * (uBase + band * 1.15);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class LinkManager {
  constructor(scene) {
    this.scene = scene;
    this.links = [];
    this.timeUniform = { value: 0 };
  }

  build(links, planetById) {
    const n = links.length;
    const positions = new Float32Array(n * 6);
    const colors = new Float32Array(n * 6);
    const ts = new Float32Array(n * 2);
    const seeds = new Float32Array(n * 2);
    this.baseColors = new Float32Array(n * 6);
    this.links = links;

    const c = new THREE.Color();
    links.forEach((link, i) => {
      const a = planetById.get(link.from);
      const b = planetById.get(link.to);
      if (!a || !b) return;
      positions.set([a.position.x, a.position.y, a.position.z], i * 6);
      positions.set([b.position.x, b.position.y, b.position.z], i * 6 + 3);
      ts[i * 2] = 0;
      ts[i * 2 + 1] = 1;
      const seed = (i * 0.6180339887) % 1; // 黄金比例错相，确定性且均匀
      seeds[i * 2] = seeds[i * 2 + 1] = seed;

      c.lerpColors(DIM, BRIGHT, link.strength);
      colors.set([c.r, c.g, c.b], i * 6);
      colors.set([c.r, c.g, c.b], i * 6 + 3);
      this.baseColors.set([c.r, c.g, c.b], i * 6);
      this.baseColors.set([c.r, c.g, c.b], i * 6 + 3);
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aT', new THREE.BufferAttribute(ts, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    this.lines = new THREE.LineSegments(
      geo,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.timeUniform,
          uFlowSpeed: { value: CONFIG.visual.linkFlowSpeed },
          uBase: { value: CONFIG.link.baseOpacity },
        },
        vertexShader: LINK_VERT,
        fragmentShader: LINK_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.scene.add(this.lines);
  }

  // 选中星球时：相关连线提亮为星球状态色，无关连线调暗
  highlightFor(planetId, planetById) {
    if (!this.lines) return;
    const colors = this.lines.geometry.attributes.color;
    this.links.forEach((link, i) => {
      const related = link.from === planetId || link.to === planetId;
      let r, g, b;
      if (related) {
        const other = planetById.get(link.from === planetId ? link.to : link.from);
        const sc = PLANET_STATES[other.stateKey].color;
        r = sc.r * 1.4; g = sc.g * 1.4; b = sc.b * 1.4;
      } else {
        r = this.baseColors[i * 6] * CONFIG.link.dimFactor;
        g = this.baseColors[i * 6 + 1] * CONFIG.link.dimFactor;
        b = this.baseColors[i * 6 + 2] * CONFIG.link.dimFactor;
      }
      colors.array.set([r, g, b, r, g, b], i * 6);
    });
    colors.needsUpdate = true;
  }

  reset() {
    if (!this.lines) return;
    this.lines.geometry.attributes.color.array.set(this.baseColors);
    this.lines.geometry.attributes.color.needsUpdate = true;
  }

  update(time) {
    this.timeUniform.value = time;
  }

  dispose() {
    this.lines?.geometry.dispose();
    this.lines?.material.dispose();
    if (this.lines) this.scene.remove(this.lines);
  }
}