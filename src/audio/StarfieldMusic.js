// ─────────────────────────────────────────────────────────────
// 星空氛围背景音乐：Web Audio 程序化合成，无外部音频文件
//（离线可播、无版权风险、确定性可复现）。
// 声景结构：D♭ 大调低频铺底和弦 + 缓慢换色的和声层 +
//          五声音阶钟琴点缀 + 空间风噪 → 卷积混响 → 主增益
// 自动播放策略：首次用户手势后才 enable；切到后台自动挂起。
// ─────────────────────────────────────────────────────────────

const BASE_NOTES = [69.3, 103.83, 138.59, 174.61, 207.65]; // D♭2 A♭2 D♭3 F3 A♭3（D♭ 大三和弦铺底）
const COLOR_CHORDS = [
  [174.61, 207.65, 261.63, 311.13], // F3 A♭3 C4 E♭4（Ⅵm7 色彩）
  [185.0, 233.08, 277.18, 349.23], // G♭3 B♭3 D♭4 F4（Ⅳmaj7 色彩）
];
// D♭ 大调五声音阶（两个八度），用于随机钟琴点缀，天然协和
const BELL_NOTES = [277.18, 311.13, 349.23, 415.3, 466.16, 554.37, 622.25, 698.46, 830.61, 932.33, 1108.73];

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class StarfieldMusic {
  constructor({ volume = 0.65 } = {}) {
    this.volume = volume;
    this.enabled = false;
    this.ctx = null;
    this._rand = mulberry32(20261120);
    this._bellTimer = null;
    this._colorTimer = null;
    this._colorIndex = 0;
    this._suspendTimer = null;
  }

  getDebug() {
    return {
      enabled: this.enabled,
      state: this.ctx?.state ?? 'none',
      volume: this.volume,
      master: this._master ? Math.round(this._master.gain.value * 1000) / 1000 : 0,
    };
  }

  async enable() {
    this.#build();
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { /* 自动播放策略拦截时等待下次手势 */ }
    }
    if (this.ctx.state !== 'running') return;
    clearTimeout(this._suspendTimer);
    this.enabled = true;
    this.#fadeMaster(this.volume);
    this.#scheduleBell(1200);
    this.#scheduleColor(3000);
  }

  disable() {
    this.enabled = false;
    if (!this.ctx) return;
    // 关闭用更快的淡出（τ=0.35s）：约 1.5s 内基本归零，2.6s 后挂起
    const t = this.ctx.currentTime;
    this._master.gain.cancelScheduledValues(t);
    this._master.gain.setTargetAtTime(0, t, 0.35);
    clearTimeout(this._bellTimer);
    clearTimeout(this._colorTimer);
    clearTimeout(this._suspendTimer);
    this._suspendTimer = setTimeout(() => {
      if (!this.enabled && this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
    }, 2600);
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.enabled) this.#fadeMaster(this.volume);
  }

  suspend() {
    if (this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
  }

  resume() {
    if (this.enabled && this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  dispose() {
    clearTimeout(this._bellTimer);
    clearTimeout(this._colorTimer);
    clearTimeout(this._suspendTimer);
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
    this._master = null;
  }

  // ── 声景搭建（只执行一次）──────────────────────────────────
  #build() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0;
    const soft = ctx.createDynamicsCompressor();
    soft.threshold.value = -18;
    soft.knee.value = 18;
    soft.ratio.value = 3;
    soft.attack.value = 0.02;
    soft.release.value = 0.4;
    master.connect(soft).connect(ctx.destination);
    this._master = master;

    // 混响总线：生成的脉冲响应（指数衰减噪声），营造深空长尾
    const convolver = ctx.createConvolver();
    convolver.buffer = this.#impulse(3.4, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    const bus = ctx.createGain();
    bus.gain.value = 0.9;
    bus.connect(dry).connect(master);
    bus.connect(convolver).connect(wet).connect(master);
    this._bus = bus;

    // 铺底：五个音各一对轻微失谐的三角/正弦振荡，经缓慢呼吸的低通
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 760;
    filter.Q.value = 0.4;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.85;
    filter.connect(padGain).connect(bus);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.025; // 40s 周期，缓慢开合
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 240;
    lfo.connect(lfoDepth).connect(filter.frequency);
    lfo.start();
    const breath = ctx.createOscillator(); // 轻微起伏，模拟"呼吸"
    breath.frequency.value = 0.05;
    const breathDepth = ctx.createGain();
    breathDepth.gain.value = 0.08;
    breath.connect(breathDepth).connect(padGain.gain);
    breath.start();
    for (const f of BASE_NOTES) {
      const tri = ctx.createOscillator();
      tri.type = 'triangle';
      tri.frequency.value = f;
      tri.detune.value = -4;
      const g1 = ctx.createGain();
      g1.gain.value = 0.06;
      tri.connect(g1).connect(filter);
      tri.start();
      const sine = ctx.createOscillator();
      sine.type = 'sine';
      sine.frequency.value = f;
      sine.detune.value = 6;
      const g2 = ctx.createGain();
      g2.gain.value = 0.048;
      sine.connect(g2).connect(filter);
      sine.start();
    }

    // 空间风噪：低频带通噪声，极低音量提供"星际尘埃"的底噪
    const noise = ctx.createBufferSource();
    noise.buffer = this.#noiseBuffer(2);
    noise.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 320;
    windFilter.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.023;
    noise.connect(windFilter).connect(windGain).connect(dry);
    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.07;
    const windDepth = ctx.createGain();
    windDepth.gain.value = 130;
    windLfo.connect(windDepth).connect(windFilter.frequency);
    windLfo.start();
    noise.start();
  }

  #fadeMaster(target) {
    if (!this._master) return;
    const t = this.ctx.currentTime;
    this._master.gain.cancelScheduledValues(t);
    this._master.gain.setTargetAtTime(target, t, 0.7);
  }

  #impulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(seconds * rate);
    const buf = this.ctx.createBuffer(2, len, rate);
    const rand = this._rand;
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (rand() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  #noiseBuffer(seconds) {
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(seconds * rate), rate);
    const data = buf.getChannelData(0);
    const rand = this._rand;
    for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
    return buf;
  }

  // ── 和声层：每 ~22s 在两个色彩和弦间缓慢交叉淡化 ──────────
  #scheduleColor(delayMs) {
    clearTimeout(this._colorTimer);
    if (!this.enabled) return;
    this._colorTimer = setTimeout(() => {
      if (!this.enabled) return;
      this.#colorChord(COLOR_CHORDS[this._colorIndex % COLOR_CHORDS.length]);
      this._colorIndex++;
      this.#scheduleColor(22000);
    }, delayMs);
  }

  #colorChord(freqs) {
    const ctx = this.ctx;
    if (ctx.state !== 'running') return;
    const t0 = ctx.currentTime;
    const attack = 5;
    const hold = 15;
    const release = 6;
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * 2; // 高八度，悬浮感
      osc.detune.value = (this._rand() - 0.5) * 8;
      const g = ctx.createGain();
      const peak = 0.028;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + attack);
      g.gain.setValueAtTime(peak, t0 + attack + hold);
      g.gain.linearRampToValueAtTime(0.0001, t0 + attack + hold + release);
      osc.connect(g).connect(this._bus);
      osc.start(t0);
      osc.stop(t0 + attack + hold + release + 0.1);
    }
  }

  // ── 钟琴点缀：随机间隔的五声音阶泛音，重混响、轻触键 ──────
  #scheduleBell(delayMs) {
    clearTimeout(this._bellTimer);
    if (!this.enabled) return;
    const wait = delayMs ?? 2400 + this._rand() * 4200;
    this._bellTimer = setTimeout(() => {
      if (!this.enabled) return;
      this.#bell();
      this.#scheduleBell();
    }, wait);
  }

  #bell() {
    const ctx = this.ctx;
    if (ctx.state !== 'running') return;
    const f = BELL_NOTES[Math.floor(this._rand() * BELL_NOTES.length)];
    const t0 = ctx.currentTime + 0.02;
    const pan = ctx.createStereoPanner();
    pan.pan.value = (this._rand() - 0.5) * 1.2;
    pan.connect(this._bus);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(0.075, t0 + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.8);
    env.connect(pan);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const partial = ctx.createOscillator(); // 二次泛音，铃感
    partial.type = 'sine';
    partial.frequency.value = f * 2.01;
    const pg = ctx.createGain();
    pg.gain.value = 0.3;
    partial.connect(pg).connect(env);
    osc.connect(env);
    osc.start(t0);
    partial.start(t0);
    osc.stop(t0 + 3);
    partial.stop(t0 + 3);
  }
}
