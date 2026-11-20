import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
// 全局可调参数。所有"魔法数字"集中在这里，便于联调。
// 每个参数都标注了取值依据。
// ─────────────────────────────────────────────────────────────

export const CONFIG = {
  camera: {
    fov: 55,                 // 55° 视角接近人眼自然视野，比广角的畸变小，空间感够且不眩晕
    near: 0.1,
    far: 3000,               // 背景星壳半径 1200，far 需留 2 倍以上余量
    position: [0, 80, 125],  // 俯瞰初始位：俯角约 33°，既能看清环状布局又有纵深
    target: [0, 0, 0],
    focusDistanceRatio: 10.5, // 聚焦距离 = 星球半径 × 10.5：星球约占屏高 1/4，上方刚好放得下信息面板
    focusHeight: 3,          // 聚焦时略抬高，俯视星球避免正平视时背景连线穿过星球
  },
  controls: {
    dampingFactor: 0.06,     // 阻尼系数：0.06 阻尼感明显但不"肉"
    minDistance: 22,         // 俯瞰时最小距离：防止镜头钻进星团内部穿模
    focusMinDistance: 3,     // 聚焦星球后放宽，允许凑近观察
    maxDistance: 420,        // 最大距离：拉太远星系缩成点，且会逼近背景星壳
    autoRotateSpeed: 0.4,    // 2.0 = 30s/圈，0.4 约 2.5 分钟/圈，只做轻微"活着"的氛围
    idleAutoRotateDelay: 4000, // 用户停止操作 4s 后恢复自动旋转
  },
  galaxy: {
    ringRadius: 68,          // 星团环半径：9 个星团（半径 17）按弦长 2R·sin(π/9)≈46.5 间隔，大于星团直径 34
    clusterYOffsets: [10, -8, 4], // 各星团固定高度错层，避免全在一个平面显得呆板（按索引取，确定性布局）
  },
  cluster: {
    radius: 17,              // 星团半径：8 个星球 + 光晕在其中分布，17 保证最近间距 > 星球直径 3 倍
    innerRadiusRatio: 0.3,   // 布局时最内层星球距星团中心比例，避免中心堆叠
  },
  planet: {
    baseRadius: 1.45,        // 星球基础半径：相对星团半径 17 约 1/12，俯瞰时清晰可辨
    highFreqScale: 1.6,      // 高频考点放大 1.6 倍，一眼可辨又不至于遮挡邻居
    selectedScale: 1.22,     // 选中时再放大 1.22 倍作为反馈
    glowSizeRatio: 4.5,      // 光晕世界尺寸 = 半径 × 4.5：再大聚焦时会糊成光斑（点精灵有像素上限）
    segments: [20, 16],      // 球体几何分段 [宽, 高]，所有星球共享一份单位球几何体
    lerpSpeed: 4.0,          // 状态过渡速率：指数趋近 k=1-exp(-4dt)，约 0.6s 完成 95% 过渡
  },
  link: {
    baseOpacity: 0.3,        // 连线基础亮度：加色混合下既能看清又不喧宾夺主
    dimFactor: 0.12,         // 选中星球后，无关连线调暗到 12%
  },
  background: {
    starCount: 6000,         // 桌面端星点数量（5000+ 才有"星野"密度）；移动端降级
    mobileStarCount: 3000,
    starShell: [500, 1200],  // 星点分布在 500~1200 的球壳内，近处留空避免"星星贴脸"
    nebulaCount: 6,          // 远景星云团数（Background.NEBULA_LAYOUT 手工构图，移动端取前 3 团）
    mobileNebulaCount: 3,
    dustCount: 520,          // 近景尘埃：比星点小一个数量级，旋转时提供近景速度感
    mobileDustCount: 220,
    dustSpin: 0.008,         // 尘埃层角速度 rad/s：约 13 分钟一圈，"缓慢"到几乎察觉不到转动本身
    twinkleSpeed: [0.4, 1.6], // 星星闪烁角速度范围：正弦周期 4~16s，错频后整片星野"活着"但不刺眼
    // ── 真实星野天穹（用户提供的深空摄影图）─────────────────
    skyTexture: '/textures/starfield.png',
    skyRadius: 1500,         // 天穹半径：在星壳(1200)之外、far(3000)之内
    skyDim: 0x777777,        // 材质颜色过滤：纯白星点 HDR ≈0.18，远低于 bloom 阈值 0.8，天然隔离泛光
    skySpin: 0.002,          // 天穹极慢自转 rad/s（约 52 分钟一圈）
    starSpin: 0.0032,        // 星野层自转略快于天穹 → 两层相对位移产生纵深
    parallaxSky: 0.015,      // 鼠标视差幅度（rad）：天穹远，偏移小
    parallaxStars: 0.032,    // 星野近，偏移大——分层差动才是"环顾宇宙"而非贴图
    parallaxDamp: 2.5,       // 视差阻尼速率：指数趋近，手感柔和不晃
    flareCount: 26,          // 十字星芒数量（20-30 区间）
    mobileFlareCount: 14,
    flareShell: [1250, 1420], // 星芒球壳：星野之外、天穹之内，永远垫在最远层
    flareMaxBrightness: 0.72, // 星芒亮度封顶：低于 bloom 阈值，泛光只留给星球与连线
  },
  // ── 视觉升级参数（泛光 / 星云 / 流光 / 穿越）─────────────────
  visual: {
    bloomStrength: 0.55,     // 泛光强度：0.55 发光感克制；>0.9 亮星会拖出大光斑、画面发雾
    bloomRadius: 0.4,        // 泛光扩散半径：0.4 光晕贴源；接近 1 会像镜头起雾
    bloomThreshold: 0.8,     // 亮度阈值（线性 HDR）：只有亮星/光晕/流光越过它才发光，星球本体保持清晰
    mobileBloomStrength: 0.45,
    exposure: 1.0,           // ACES 曝光：1.0 保持深空黑位，再高暗部发灰
    nebulaIntensity: 0.16,   // 天穹 fbm 星云强度：若隐若现的上限，再高会抢星球的对比度
    emissiveBoost: { mastered: 0.5, learning: 0.38, weak: 0.62, unlearned: 0.08 }, // 实例自发光倍率：已掌握最亮但不饱和，聚焦时仍是可读的星球而非白球
    pulsePeriod: 2.0,        // 薄弱态呼吸周期（秒）：shader 内 sin(uTime * 2π/period)
    linkFlowSpeed: 0.22,     // 连线流光速度（周期/秒）：能量带约 4.5s 走一条连线，克制不闪眼
    ringFlowSpeed: 0.5,      // 星轨流光角速度 rad/s
    orbitParticlesPerCluster: 26, // 每星团沿轨粒子数
    warpStreaks: 130,        // 星际穿越拖尾段数：仅飞行期间可见，1 次 draw call
  },
  loop: {
    idleAfterMs: 8000,       // 无交互 8s 且无动画时进入省电模式
    idleFrameSkip: 4,        // 完全静止时每 4 帧渲染 1 帧；自动旋转仍在跑时引擎改用 2 帧一跳（约 30fps，转动平滑）
  },
};

// ── 星球四种掌握度状态 ────────────────────────────────────────
// 颜色即星球本体色（instanceColor）与光晕色；
// glow 为光晕强度系数（乘在 glowSizeRatio 上）；
// pulse 为 true 时光晕在 shader 内按 sin 时间脉动（薄弱态的警示效果）。
export const PLANET_STATES = {
  mastered:  { color: new THREE.Color(0x2ee6c8), glow: 1.0,  pulse: false, label: '已掌握' },
  learning:  { color: new THREE.Color(0x3f8cff), glow: 0.55, pulse: false, label: '学习中' },
  weak:      { color: new THREE.Color(0xff7a18), glow: 0.85, pulse: true,  label: '薄弱'   },
  unlearned: { color: new THREE.Color(0x5b6b82), glow: 0.15, pulse: false, label: '未学'   },
};

// 分数 → 状态。score 为 null/undefined 表示从未做题。
// 阈值默认 80/30，可被 mastery_rules.json 中的 thresholds 覆盖（单一数据源）。
export function masteryToState(score, thresholds = { mastered: 80, weak: 30 }) {
  if (score == null) return 'unlearned';
  if (score >= thresholds.mastered) return 'mastered';
  if (score <= thresholds.weak) return 'weak';
  return 'learning';
}

// 移动判定只看窄屏或"窄屏+触屏"：headless/触屏笔记本会误报 pointer:coarse，
// 单凭它会把宽屏桌面降级成移动画质
export const isMobile =
  window.innerWidth < 768 ||
  (window.matchMedia?.('(pointer: coarse)').matches && window.innerWidth < 1024);
