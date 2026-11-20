// 运行时验证脚本：headless Chrome 驱动真实交互并截图
// 用法: node scripts/verify.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = new URL('../.verify/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900'],
});

const page = await browser.newPage();
// 主流程以「音乐关闭」偏好启动：音频上下文只在文末独立短会话中创建，
// 避免无头软渲染环境下音频线程偶发长帧干扰 300+ 交互检查
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('kmu:bgm', JSON.stringify({ v: 2, enabled: false, volume: 0.65 })); } catch { /* ignore */ }
});
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // AI 代理不在线时的 502 资源报错是降级路径的预期行为，不计入运行时错误
  if (m.text().includes('Failed to load resource') && m.location()?.url?.includes('/api/ai/')) return;
  errors.push('[console] ' + m.text());
});
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

const results = [];
const check = (name, ok, extra = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const bootWait = async () => {
  await page.waitForFunction(() => window.__galaxy?.planetManager?.mesh && document.querySelector('.scene-layer.visible'), { timeout: 15000 });
  await sleep(1000);
};

// 作答当前题（按题干 data-qid 定位题目，自动识别单选/填空），correct=false 时故意答错
const answerCurrent = async (correct = true) => {
  const q = await page.evaluate(() => {
    const qid = document.querySelector('.quiz-drawer .quiz-stem')?.dataset.qid;
    const q = window.__data.questions.find(x => x.id === qid);
    return { type: q.type, answer: q.answer, accept: q.accept };
  });
  if (q.type === 'fill') {
    await page.evaluate((t) => {
      const input = document.querySelector('.quiz-fill input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, t);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, correct ? q.accept[0] : '___wrong___');
  } else {
    const idx = correct ? q.answer : (q.answer + 1) % 4;
    await page.evaluate((i) => document.querySelectorAll('.quiz-option')[i].click(), idx);
  }
  await page.evaluate(() => [...document.querySelectorAll('.quiz-drawer .practice-btn')].find(b => b.textContent.includes('提交'))?.click());
  await sleep(250);
};
const nextQuestion = async () => {
  await page.evaluate(() => [...document.querySelectorAll('.quiz-drawer .practice-btn')].find(b => /下一题|查看结果/.test(b.textContent))?.click());
  await sleep(250);
};
const openQuiz = async (pid) => {
  // 先回俯瞰，避免目标星球在聚焦视角下超出屏幕；等飞行结束再取屏幕坐标（慢帧下位置只在渲染帧推进）
  await page.evaluate(() => [...document.querySelectorAll('.dock-btn')].find(b => b.textContent.includes('俯瞰'))?.click());
  await page.waitForFunction(() => !window.__galaxy.cameraController.active, { timeout: 8000 });
  const pos = await page.evaluate((id) => window.__galaxy.getScreenPosition(id), pid);
  await page.mouse.click(pos.x, pos.y);
  await sleep(1400);
  await page.evaluate(() => document.querySelector('.info-panel .practice-btn')?.click());
  // 等滑入动画真正结束（scale/translate 过渡）再量几何
  await page.waitForFunction(() => {
    const d = document.querySelector('.quiz-drawer');
    return d && d.getBoundingClientRect().right <= window.innerWidth + 1
      && d.getAnimations().every((a) => a.playState === 'finished');
  }, { timeout: 8000 });
  await sleep(150);
};
const resetRecords = async () => {
  await page.evaluate(() => document.querySelector('.account-reset')?.click());
  await sleep(400);
};

// ── 登录 / 注册辅助（进入网站即登录界面）──
const setInput = async (selector, value) => {
  await page.evaluate(({ sel, v }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { sel: selector, v: value });
};
const enterDemo = async () => {
  await page.waitForFunction(() => {
    const b = document.querySelector('.login-demo');
    return b && !b.disabled;
  }, { timeout: 12000 });
  await page.evaluate(() => document.querySelector('.login-demo').click());
  await page.waitForFunction(() => !document.querySelector('.login-overlay'), { timeout: 12000 });
};
const logoutUi = async () => {
  await page.evaluate(() => document.querySelector('.account-logout')?.click());
  await page.waitForFunction(() => !!document.querySelector('.login-overlay'), { timeout: 8000 });
};
const loginWith = async (username, password) => {
  await page.waitForFunction(() => !!document.querySelector('.login-form input[name=username]'), { timeout: 8000 });
  await setInput('.login-form input[name=username]', username);
  await setInput('.login-form input[name=password]', password);
  await page.evaluate(() => document.querySelector('.login-submit').click());
};

// ── 桌面端 ──
await page.setViewport({ width: 1440, height: 900 });
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
await bootWait();

const boot = await page.evaluate(() => {
  const g = window.__galaxy;
  return {
    planets: g.planetManager.planets.length,
    links: g.linkManager.links.length,
    drawCalls: g.renderer.info.render.calls,
    canvas: [g.renderer.domElement.width, g.renderer.domElement.height],
    loadingGone: document.querySelector('.loading-overlay').classList.contains('fade-out'),
    dock: !!document.querySelector('.control-dock'),
    login: !!document.querySelector('.login-overlay'),
  };
});
check('首屏加载完成并淡入', boot.loadingGone);
check('66 星球 / 98 连线', boot.planets === 66 && boot.links === 98, JSON.stringify(boot));
check('canvas 尺寸正常', boot.canvas[0] > 1000 && boot.canvas[1] > 700, boot.canvas.join('x'));
check('draw call 合并优化', boot.drawCalls < 50, `${boot.drawCalls} calls`);
check('控制台常驻', boot.dock);
check('进入网站即登录界面', boot.login);

// ── 背景音乐控件常驻（音频行为在文末独立短会话验证，避免音频线程干扰软渲染主流程）──
const bgmDock = await page.evaluate(() => {
  const t = [...document.querySelectorAll('.dock-toggle')].find((el) => el.textContent.includes('背景音乐'));
  return { toggle: !!t, off: t?.querySelector('.switch')?.getAttribute('aria-checked') === 'false' };
});
check('控制台含背景音乐开关（主流程预置关闭偏好）', bgmDock.toggle && bgmDock.off, JSON.stringify(bgmDock));

// ── 用户表 + 登录 / 注册（进入网站的第一屏）──
const loginUi = await page.evaluate(() => ({
  overlay: !!document.querySelector('.login-overlay'),
  demo: !!document.querySelector('.login-demo'),
  username: !!document.querySelector('.login-form input[name=username]'),
  password: !!document.querySelector('.login-form input[name=password]'),
  registerSwitch: !!document.querySelector('.login-switch'),
}));
check('登录界面：演示入口 + 账号表单 + 注册入口', Object.values(loginUi).every(Boolean), JSON.stringify(loginUi));
await page.screenshot({ path: OUT + '00-login.png' });

// 注册校验：短密码 → 提示；两次不一致 → 提示
await page.evaluate(() => document.querySelector('.login-switch').click());
await page.waitForFunction(() => !!document.querySelector('.login-form input[name=confirm]'));
const uname = `verify_${Date.now().toString(36)}`;
const nick = '验收用户';
await setInput('.login-form input[name=display]', nick);
await setInput('.login-form input[name=username]', uname);
await setInput('.login-form input[name=password]', '123');
await setInput('.login-form input[name=confirm]', '123');
await page.evaluate(() => document.querySelector('.login-submit').click());
await page.waitForFunction(() => document.querySelector('.login-error')?.classList.contains('show'));
const shortErr = await page.evaluate(() => document.querySelector('.login-error').textContent);
await setInput('.login-form input[name=password]', 'pass1234');
await setInput('.login-form input[name=confirm]', 'pass9999');
await page.evaluate(() => document.querySelector('.login-submit').click());
await page.waitForFunction(() => document.querySelector('.login-error')?.textContent.includes('不一致'));
const mismatchErr = await page.evaluate(() => document.querySelector('.login-error').textContent);
check('注册校验：短密码 / 两次不一致提示', shortErr.includes('至少 6 位') && mismatchErr.includes('不一致'), JSON.stringify({ shortErr, mismatchErr }));

// 注册成功 → 进入星系（全新未学星图）
await setInput('.login-form input[name=confirm]', 'pass1234');
await page.evaluate(() => document.querySelector('.login-submit').click());
await page.waitForFunction(() => !document.querySelector('.login-overlay'), { timeout: 20000 });
const registered = await page.evaluate(() => ({
  userId: window.__data.userId,
  chip: document.querySelector('.account-name')?.textContent ?? '',
  allUnlearned: window.__galaxy.planetManager.planets.every((p) => p.stateKey === 'unlearned'),
  labelsNull: window.__galaxy.planetManager._labels.every((l) => l.percent == null),
  records: window.__data.records.length,
}));
check('注册新账号 → 进入星系（昵称 + 全新星图）', registered.chip === nick && registered.userId !== 'demo-001' && registered.allUnlearned && registered.labelsNull && registered.records === 0, JSON.stringify(registered));
const regUserId = registered.userId;

// 用户表结构：唯一用户名 + PBKDF2 哈希 + 盐（无明文）
const userTable = await page.evaluate((u) => {
  const db = JSON.parse(localStorage.getItem('kmu:users:v1'));
  const row = db.users.find((x) => x.username === u);
  return {
    total: db.users.length,
    hasDemo: db.users.some((x) => x.role === 'demo'),
    unique: new Set(db.users.map((x) => x.usernameLower)).size === db.users.length,
    row: row && {
      role: row.role,
      status: row.status,
      hashOk: typeof row.passwordHash === 'string' && row.passwordHash.length > 20 && !row.passwordHash.includes('pass1234'),
      saltOk: typeof row.salt === 'string' && row.salt.length >= 16,
      iters: row.iterations,
      createdAt: !!row.createdAt,
      lastLogin: !!row.lastLoginAt,
      lower: row.usernameLower === u.toLowerCase(),
    },
  };
}, uname);
check('用户表结构：唯一用户名 + PBKDF2 哈希 + 盐（无明文）',
  userTable.total >= 2 && userTable.hasDemo && userTable.unique && userTable.row?.role === 'user' && userTable.row?.status === 'active'
  && userTable.row.hashOk && userTable.row.saltOk && userTable.row.iters >= 100000 && userTable.row.createdAt && userTable.row.lastLogin && userTable.row.lower,
  JSON.stringify(userTable));

// 重复用户名注册被拒绝
await logoutUi();
await page.evaluate(() => document.querySelector('.login-switch').click());
await page.waitForFunction(() => !!document.querySelector('.login-form input[name=confirm]'));
await setInput('.login-form input[name=username]', uname);
await setInput('.login-form input[name=password]', 'pass1234');
await setInput('.login-form input[name=confirm]', 'pass1234');
await page.evaluate(() => document.querySelector('.login-submit').click());
await page.waitForFunction(() => document.querySelector('.login-error')?.textContent.includes('已存在'), { timeout: 8000 });
check('重复用户名 → 拒绝并提示', true);
await page.evaluate(() => document.querySelector('.login-switch').click());
await page.waitForFunction(() => !document.querySelector('.login-form input[name=confirm]'));

// 错误密码 → 统一提示；正确密码 → 登录
await loginWith(uname, 'wrongpass');
await page.waitForFunction(() => document.querySelector('.login-error')?.textContent.includes('账号或密码不正确'), { timeout: 8000 });
check('错误密码 → 提示且停留登录界面', await page.evaluate(() => !!document.querySelector('.login-overlay')));
await loginWith(uname, 'pass1234');
await page.waitForFunction(() => !document.querySelector('.login-overlay'), { timeout: 15000 });
check('已注册账号登录成功（按 user_id 载入）', await page.evaluate((id) => window.__data.userId === id, regUserId));

// 退出 → 一键进入演示账号（种子态）
await logoutUi();
await enterDemo();
const demoRestored = await page.evaluate(() => ({
  id: window.__data.userId,
  chip: document.querySelector('.account-name')?.textContent ?? '',
  records: window.__data.records.length,
}));
check('演示账号一键进入 → 种子状态', demoRestored.id === 'demo-001' && demoRestored.chip === '演示账号' && demoRestored.records === 0, JSON.stringify(demoRestored));
await page.screenshot({ path: OUT + '01-overview.png' });

// ── 视觉升级：后处理管线 / 深空背景 / 星球材质 / 流光 / 悬停反馈 ──
const vis = await page.evaluate(() => {
  const g = window.__galaxy;
  const pm = g.planetManager;
  const mastered = pm.planets.find(p => p.stateKey === 'mastered');
  const unlearned = pm.planets.find(p => p.stateKey === 'unlearned');
  const weak = pm.planets.find(p => p.stateKey === 'weak');
  const em = pm.mesh.geometry.attributes.aEmissive.array;
  return {
    passes: g.postfx.composer.passes.length,
    bloom: [g.postfx.bloomPass.strength, g.postfx.bloomPass.radius, g.postfx.bloomPass.threshold],
    toneMapping: g.renderer.toneMapping, // ACESFilmic = 4
    stars: g.background.starCount,
    starGeo: g.background.stars.geometry.isBufferGeometry && !!g.background.stars.geometry.attributes.aPhase,
    sharedDot: g.background.stars.material.uniforms.uMap.value === g.background.dotTexture,
    hdrStar: Math.max(...g.background.stars.geometry.attributes.aColor.array) > 1.5,
    dome: g.background.dome.geometry.parameters.radius === 1400 && g.background.dome.material.uniforms.uIntensity.value > 0,
    dust: g.background.dust.geometry.attributes.position.count,
    noiseMap: pm.mesh.material.map?.isCanvasTexture && pm.mesh.material.map.image.width === 256 && pm.mesh.material.bumpMap === pm.mesh.material.map,
    emissiveOrder: em[mastered.index] > em[unlearned.index],
    pulseOmega: pm.glowUniforms.uPulseOmega.value,
    weakPulse: pm.mesh.geometry.attributes.aPulse.array[weak.index] === 1 && pm.glow.geometry.attributes.aPulse.array[weak.index] === 1,
    rings: pm._rings.length,
    ringFlow: pm._rings[0].material.uniforms.uFlowSpeed.value,
    orbits: pm.orbits.geometry.attributes.aCenter.count,
    linkAttrs: !!g.linkManager.lines.geometry.attributes.aT && !!g.linkManager.lines.geometry.attributes.aSeed,
    clock: typeof g.clock.getElapsedTime === 'function' && g.clock.elapsedTime > 0,
  };
});
check('EffectComposer 三段管线 + UnrealBloomPass', vis.passes === 3 && Math.abs(vis.bloom[0] - 0.55) < 0.01 && vis.bloom[2] === 0.8, JSON.stringify(vis.bloom));
check('ACES 色调映射', vis.toneMapping === 4);
check('背景星野 5000+（BufferGeometry）', vis.stars >= 5000 && vis.starGeo, `${vis.stars} 颗`);
check('通用圆形贴图共享 + HDR 亮星', vis.sharedDot && vis.hdrStar);
check('星云天穹 + 旋转尘埃层', vis.dome && vis.dust === 520, `dust=${vis.dust}`);
check('星球噪声贴图（map+bump 同源）', vis.noiseMap);
check('实例自发光：已掌握 > 未学', vis.emissiveOrder);
check('薄弱呼吸周期 2s（ω=π）', Math.abs(vis.pulseOmega - Math.PI) < 0.001 && vis.weakPulse, `ω=${vis.pulseOmega.toFixed(3)}`);
check('星轨流光环 + 沿轨粒子', vis.rings === 9 && vis.ringFlow === 0.5 && vis.orbits === 234, `rings=${vis.rings} orbits=${vis.orbits}`);
check('连线流光属性 + clock 驱动', vis.linkAttrs && vis.clock);

// 真实星野天穹 + 分层视差 + 十字星芒
await page.waitForFunction(() => window.__galaxy.background.sky.material.map?.image?.width > 0, { timeout: 10000 });
const sky = await page.evaluate(() => {
  const b = window.__galaxy.background;
  const c = b.sky.material.color;
  const pos = b.flares.geometry.attributes.position.array;
  const n = b.flares.geometry.attributes.position.count;
  let minR = Infinity, minAbsY = Infinity;
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    minR = Math.min(minR, r);
    minAbsY = Math.min(minAbsY, Math.abs(pos[i * 3 + 1]) / r);
  }
  return {
    radius: b.sky.geometry.parameters.radius,
    backSide: b.sky.material.side === 1, // BackSide
    dim: Math.max(c.r, c.g, c.b), // 线性空间亮度
    mapW: b.sky.material.map.image.width,
    flares: n,
    flareMinR: minR,
    flareMinAbsY: minAbsY,
    flareMaxBright: Math.max(...b.flares.geometry.attributes.aColor.array),
    flareBreath: !!b.flares.geometry.attributes.aSpeed && b.flares.material.uniforms.uTime.value > 0,
  };
});
check('真实星野天穹（内表面球 + 贴图加载）', sky.radius === 1500 && sky.backSide && sky.mapW === 564, `r=${sky.radius} tex=${sky.mapW}px`);
check('背景调暗 → 泛光隔离（HDR 远低于阈值 0.8）', sky.dim < 0.3 && sky.flareMaxBright <= 0.72, `dim=${sky.dim.toFixed(3)} flareMax=${sky.flareMaxBright.toFixed(2)}`);
check('星芒 26 颗在最远层且避开连线区', sky.flares === 26 && sky.flareMinR >= 1250 && sky.flareMinAbsY >= 0.44 && sky.flareBreath, `minR=${Math.round(sky.flareMinR)} min|y|=${sky.flareMinAbsY.toFixed(2)}`);

// 无鼠标时天穹仍极慢自转；鼠标移动 → 天穹/星野分层差动偏移
const rotSample = () => page.evaluate(() => ({
  skyY: window.__galaxy.background.skyGroup.rotation.y,
  skyX: window.__galaxy.background.skyGroup.rotation.x,
  starY: window.__galaxy.background.starGroup.rotation.y,
}));
const spin1 = await rotSample();
// 条件等待自转推进（保持"无鼠标"语义；深度空闲降帧下固定 sleep 可能落在跳帧间隙）
await page.waitForFunction((y0) => window.__galaxy.background.skyGroup.rotation.y > y0, { timeout: 10000 }, spin1.skyY);
const spin2 = await rotSample();
check('天穹极慢自转', spin2.skyY > spin1.skyY, `Δ=${(spin2.skyY - spin1.skyY).toFixed(4)}rad`);
await page.mouse.move(80, 80);
// 视差按帧阻尼趋近：等偏移收敛到目标附近再采样（软件渲染帧间隔可达数百 ms）
await page.waitForFunction(() => window.__galaxy.background.skyGroup.rotation.x < -0.004, { timeout: 6000 });
const par1 = await rotSample();
await page.mouse.move(1360, 820);
await page.waitForFunction(() => window.__galaxy.background.skyGroup.rotation.x > 0.004, { timeout: 6000 });
const par2 = await rotSample();
const dSky = Math.abs(par2.skyY - par1.skyY);
const dStar = Math.abs(par2.starY - par1.starY);
check('鼠标视差 → 天穹/星野分层差动', dSky > 0.01 && dStar > dSky * 1.5 && par1.skyX !== par2.skyX, `skyΔ=${dSky.toFixed(3)} starΔ=${dStar.toFixed(3)}`);

const timeSample = () => page.evaluate(() => ({
  bg: window.__galaxy.background.timeUniform.value,
  link: window.__galaxy.linkManager.timeUniform.value,
  dust: window.__galaxy.background.dust.rotation.y,
}));
const t1 = await timeSample();
// 保持交互活跃 + 条件等待：深度空闲降帧（每 4 帧渲染 1 帧）下固定 sleep 可能落在跳帧间隙
await page.mouse.move(700, 450);
await page.waitForFunction((bg0) => window.__galaxy.background.timeUniform.value > bg0, { timeout: 10000 }, t1.bg);
const t2 = await timeSample();
check('闪烁/流光/尘埃随时间推进', t2.bg > t1.bg && t2.link > t1.link && t2.dust > t1.dust, `Δt=${(t2.bg - t1.bg).toFixed(2)}s`);

// 悬停星球 → Reticle 光环 + 手型；移开 → 淡出还原
// 先固定相机到默认俯瞰：自动旋转在长流程中可能把目标星球转到控制台下方，导致悬停落空
await page.evaluate(() => {
  const g = window.__galaxy;
  g.setAutoRotate(false);
  g.controls.target.set(0, 0, 0);
  g.camera.position.set(0, 80, 125);
  g.controls.update();
});
await sleep(400);
const hpos = await page.evaluate(() => window.__galaxy.getScreenPosition('limit-calc'));
await page.mouse.move(hpos.x, hpos.y);
await page.waitForFunction(() => window.__galaxy.planetManager.reticle.visible, { timeout: 5000 });
const hover = await page.evaluate(() => ({
  reticle: window.__galaxy.planetManager.reticle.visible,
  cursor: window.__galaxy.renderer.domElement.style.cursor,
  hovered: window.__galaxy.planetManager.hoveredId,
}));
check('悬停 → Reticle 光环 + 鼠标手型', hover.reticle && hover.cursor === 'pointer' && hover.hovered === 'limit-calc', JSON.stringify(hover));
await page.mouse.move(200, 780);
await page.waitForFunction(() => !window.__galaxy.planetManager.reticle.visible, { timeout: 6000 });
const hoverOff = await page.evaluate(() => ({
  reticle: window.__galaxy.planetManager.reticle.visible,
  cursor: window.__galaxy.renderer.domElement.style.cursor,
}));
check('移开 → Reticle 淡出 + 光标还原', !hoverOff.reticle && hoverOff.cursor === '', JSON.stringify(hoverOff));
await page.evaluate(() => window.__galaxy.setAutoRotate(true));

// 点击薄弱星球「微分中值定理」（飞行途中验证穿越拖尾）
// 软件渲染帧间隔可达秒级：拉长飞行时长，保证 sin 包络窗口内必有帧落点
await page.evaluate(() => window.__galaxy.setFlightDuration(6));
const pos = await page.evaluate(() => window.__galaxy.getScreenPosition('der-mvt'));
await page.mouse.click(pos.x, pos.y);
// 轮询捕捉飞行中段：opacity 按 sin(π·progress) 包络，>0.1 的窗口约覆盖飞行全程 87%
await page.waitForFunction(() => {
  const w = window.__galaxy.warp.lines;
  return w.visible && w.material.opacity > 0.1;
}, { timeout: 6000, polling: 60 });
const warpMid = await page.evaluate(() => ({
  visible: window.__galaxy.warp.lines.visible,
  opacity: window.__galaxy.warp.lines.material.opacity,
  onCamera: window.__galaxy.warp.lines.parent === window.__galaxy.camera,
}));
check('飞行中 → 星际穿越拖尾可见', warpMid.visible && warpMid.opacity > 0.1 && warpMid.onCamera, JSON.stringify(warpMid));
await page.waitForFunction(() => !window.__galaxy.cameraController.active, { timeout: 9000 });
await page.evaluate(() => window.__galaxy.setFlightDuration(1));
await sleep(200);
const focused = await page.evaluate(() => {
  const g = window.__galaxy;
  const panel = document.querySelector('.info-panel');
  return {
    selected: g.selectedId,
    panelTitle: panel?.querySelector('.info-title')?.textContent,
    relatedCount: panel?.querySelectorAll('.related-item').length,
    camDist: g.camera.position.distanceTo(g.controls.target).toFixed(1),
    flyingDone: !g.cameraController.active,
  };
});
check('点击星球 → 选中 der-mvt', focused.selected === 'der-mvt', JSON.stringify(focused));
check('相机飞到星球附近', Number(focused.camDist) < 30 && focused.flyingDone, `dist=${focused.camDist}`);
const warpAfter = await page.evaluate(() => window.__galaxy.warp.lines.visible);
check('飞行结束 → 拖尾隐藏零开销', !warpAfter);
check('面板标题正确', focused.panelTitle === '微分中值定理');
check('关联考点列表非空', focused.relatedCount > 0, `${focused.relatedCount} 个`);
const panelBounds = await page.evaluate(() => {
  const r = document.querySelector('.info-panel').getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight };
});
check('面板完整在视口内', panelBounds.top >= 0 && panelBounds.bottom <= panelBounds.vh, JSON.stringify(panelBounds));
const noCover = await page.evaluate(() => {
  const g = window.__galaxy;
  const pos = g.getScreenPosition(g.selectedId);
  const r = document.querySelector('.info-panel').getBoundingClientRect();
  const covers = pos.x > r.left && pos.x < r.right && pos.y > r.top && pos.y < r.bottom;
  return { covers, planetY: Math.round(pos.y), panelBottom: Math.round(r.bottom) };
});
check('面板不遮挡选中星球', !noCover.covers, JSON.stringify(noCover));
await page.screenshot({ path: OUT + '02-focused.png' });

// 关联跳转
await page.evaluate(() => document.querySelector('.related-item').click());
await sleep(1400);
const jumped = await page.evaluate(() => ({
  selected: window.__galaxy.selectedId,
  title: document.querySelector('.info-panel .info-title')?.textContent,
}));
check('关联跳转 → 目标星球选中', jumped.selected && jumped.selected !== 'der-mvt', JSON.stringify(jumped));
await page.screenshot({ path: OUT + '03-jumped.png' });

// 点击空白 → 收起面板回俯瞰（等飞行真正结束再采样：慢帧下相机位置只在渲染帧推进）
await page.mouse.click(200, 780);
await page.waitForFunction(() => !window.__galaxy.selectedId && !window.__galaxy.cameraController.active, { timeout: 8000 });
const closed = await page.evaluate(() => ({
  selected: window.__galaxy.selectedId,
  panel: !!document.querySelector('.info-panel'),
  camY: Math.round(window.__galaxy.camera.position.y),
}));
check('点击空白收起面板', !closed.selected && !closed.panel, JSON.stringify(closed));
check('相机回到俯瞰', closed.camY === 80, `camY=${closed.camY}`);

// 掌握度 API：颜色平滑过渡（等真实过渡帧出现再采样，而非定长 sleep）
const masteryBefore = await page.evaluate(() => {
  const g = window.__galaxy;
  const before = g.planetManager.byId.get('int-app').curColor.getHex();
  g.updatePlanetMastery('int-app', 95);
  return before;
});
await page.waitForFunction(
  (b) => window.__galaxy.planetManager.byId.get('int-app').curColor.getHex() !== b,
  { timeout: 5000 }, masteryBefore
);
const masteryMid = await page.evaluate(() => window.__galaxy.planetManager.byId.get('int-app').curColor.getHex());
await page.waitForFunction(() => {
  const p = window.__galaxy.planetManager.byId.get('int-app');
  return p.curColor.getHex() === p.tgtColor.getHex();
}, { timeout: 8000 });
const masteryTest = await page.evaluate(() => {
  const p = window.__galaxy.planetManager.byId.get('int-app');
  return { state: p.stateKey, after: p.curColor.getHex() };
});
const masteryHex = { before: masteryBefore.toString(16), mid: masteryMid.toString(16), after: masteryTest.after.toString(16), state: masteryTest.state };
check('掌握度 API → 状态切换', masteryTest.state === 'mastered', JSON.stringify(masteryHex));
check('颜色平滑过渡（中间值 ≠ 起止值）', masteryMid !== masteryBefore && masteryMid !== masteryTest.after, JSON.stringify(masteryHex));

// 控制台：模拟做题（真实提交链路）+ 开关 + 滑杆
const toast = await page.evaluate(() => {
  [...document.querySelectorAll('.dock-btn')].find(b => b.textContent.includes('模拟'))?.click();
  return document.querySelector('.toast')?.classList.contains('show');
});
check('模拟做题按钮生效', toast);
await sleep(1600); // 等模拟作答的 3 次提交写完
const simRecords = await page.evaluate(() => window.__data.records.length);
check('模拟作答写入做题记录', simRecords > 0, `${simRecords} 条`);
await page.evaluate(() => document.querySelectorAll('.control-dock .switch')[1].click());
const linksOff = await page.evaluate(() => !window.__galaxy.linkManager.lines.visible);
check('连线开关生效', linksOff);
await page.evaluate(() => document.querySelectorAll('.control-dock .switch')[1].click());
await page.evaluate(() => {
  const slider = document.querySelector('.control-dock input[type=range]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(slider, '1.8');
  slider.dispatchEvent(new Event('input', { bubbles: true }));
});
const glowSet = await page.evaluate(() => ({
  glow: window.__galaxy.planetManager.glowIntensity,
  bloom: window.__galaxy.postfx.bloomPass.strength,
}));
check('光晕滑杆生效（同步驱动泛光强度）', Math.abs(glowSet.glow - 1.8) < 0.01 && Math.abs(glowSet.bloom - 0.99) < 0.01, JSON.stringify(glowSet));
// 还原默认倍率，避免后续截图过曝
await page.evaluate(() => {
  const slider = document.querySelector('.control-dock input[type=range]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(slider, '1');
  slider.dispatchEvent(new Event('input', { bubbles: true }));
});

// 拖拽旋转
const camBefore = await page.evaluate(() => window.__galaxy.camera.position.toArray());
await page.mouse.move(720, 450);
await page.mouse.down();
await page.mouse.move(950, 400, { steps: 12 });
await page.mouse.up();
await sleep(500);
const camAfter = await page.evaluate(() => window.__galaxy.camera.position.toArray());
check('拖拽旋转相机', Math.hypot(camAfter[0] - camBefore[0], camAfter[2] - camBefore[2]) > 5, `Δx=${(camAfter[0] - camBefore[0]).toFixed(1)}`);
await page.screenshot({ path: OUT + '04-dragged.png' });

// ── 重置记录（同时验证重置功能）──
await page.evaluate(() => [...document.querySelectorAll('.dock-btn')].find(b => b.textContent.includes('俯瞰'))?.click());
await sleep(1500);
await resetRecords();
const afterReset = await page.evaluate(() => ({
  records: window.__data.records.length,
  ls: localStorage.getItem('kmu:records:demo-001'),
  intApp: window.__data.mastery.get('int-app'),
  seed: window.__data.demoSeeds['int-app'],
}));
check('重置记录 → 清空并回到种子态', afterReset.records === 0 && afterReset.ls === null && afterReset.intApp === afterReset.seed, JSON.stringify(afterReset));

// ── 做题即时结算：ode-basic（含填空题），提交瞬间写记录 + 3D 联动 ──
await openQuiz('ode-basic');
const quizOpen = await page.evaluate(() => {
  const d = document.querySelector('.quiz-drawer');
  if (!d) return { open: false };
  const r = d.getBoundingClientRect();
  return {
    open: true,
    left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
    centered: Math.abs(r.left - (window.innerWidth - r.right)) <= 2,
    vw: window.innerWidth,
    rules: !!d.querySelector('.quiz-rules'),
    sub: d.querySelector('.quiz-sub')?.textContent ?? '',
  };
});
check('开始做题 → 居中练习浮层打开 + 规则提示', quizOpen.open && quizOpen.rules && quizOpen.centered && quizOpen.width === 880 && !!quizOpen.sub, JSON.stringify(quizOpen));
check('练习浮层在视口内', quizOpen.left >= 0 && quizOpen.right <= quizOpen.vw, `left=${quizOpen.left} right=${quizOpen.right}`);

const q1Type = await page.evaluate(() => {
  const qid = document.querySelector('.quiz-drawer .quiz-stem')?.dataset.qid;
  return window.__data.questions.find(x => x.id === qid).type;
});
await answerCurrent(true);
// 参考答案与题干公式：等待按需加载的 Markdown/KaTeX 渲染完成
await page.waitForFunction(() => document.querySelectorAll('.quiz-analysis .math-text .katex').length > 0 && document.querySelectorAll('.quiz-stem .math-text .katex').length > 0, { timeout: 15000 });
const instant = await page.evaluate(() => {
  const g = window.__galaxy;
  const store = window.__data;
  const rec = store.records[store.records.length - 1];
  const label = g.planetManager._labels.find(l => l.clusterId === 'ode');
  const pid = rec.pointIds[0];
  const rawOf = (sel) => {
    const n = document.querySelector(sel)?.cloneNode(true);
    if (!n) return '';
    n.querySelectorAll('.katex').forEach((k) => k.remove());
    return n.textContent;
  };
  return {
    analysis: !!document.querySelector('.quiz-analysis'),
    deltaShown: !!document.querySelector('.quiz-delta'),
    quizRef: !!document.querySelector('.quiz-ref'),
    quizMath: document.querySelectorAll('.quiz-analysis .katex').length,
    stemMath: document.querySelectorAll('.quiz-stem .math-text .katex').length,
    mathErrors: document.querySelectorAll('.quiz-analysis .katex-error, .quiz-stem .katex-error').length,
    rawLeak: /(\$)|(\\[a-zA-Z]{2,})|(\^\{)|(_\{)/.test(rawOf('.quiz-analysis') + rawOf('.quiz-stem')),
    records: store.records.length,
    recFields: rec && rec.userId === 'demo-001' && !!rec.questionId && rec.chapterId === 'ode' && rec.correct === true && typeof rec.chapterDelta === 'number' && !!rec.timestamp,
    engineSync: g.planetManager.byId.get(pid).mastery === store.mastery.get(pid),
    labelSync: label?.percent === store.chapterScores.get('ode'),
    lsCount: JSON.parse(localStorage.getItem('kmu:records:demo-001') || '[]').length,
  };
});
check('提交即判分 + 分数变化明细展示', instant.analysis && instant.deltaShown, JSON.stringify(instant));
check('参考答案公式渲染（Markdown 解析 + 无错误）', instant.quizRef && instant.quizMath > 0 && instant.mathErrors === 0 && !instant.rawLeak, JSON.stringify({ ref: instant.quizRef, math: instant.quizMath, errors: instant.mathErrors, rawLeak: instant.rawLeak }));
check('练习题干公式渲染（Markdown 解析 + 无泄漏）', instant.stemMath > 0 && !instant.rawLeak, JSON.stringify({ stemMath: instant.stemMath, rawLeak: instant.rawLeak }));
check('提交即写记录（字段完整）', instant.records === 1 && instant.recFields && instant.lsCount === 1, `records=${instant.records}`);
check('提交即联动星球与章节标签', instant.engineSync && instant.labelSync, JSON.stringify(instant));
await page.screenshot({ path: OUT + '05-quiz.png' });
await nextQuestion();
if (q1Type === 'single') {
  // 第二题应为填空（ode-basic 含 q-ode-f1）：验证填空输入与归一化判分
  const fillUi = await page.evaluate(() => !!document.querySelector('.quiz-fill input'));
  check('填空题输入框渲染', fillUi);
  await page.evaluate(() => {
    const input = document.querySelector('.quiz-fill input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ' x² + c '); // 故意带空格/上标/小写，验证归一化
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => [...document.querySelectorAll('.quiz-drawer .practice-btn')].find(b => b.textContent.includes('提交'))?.click());
  await sleep(250);
  const fillJudged = await page.evaluate(() => document.querySelector('.quiz-analysis.right') != null);
  check('填空答案归一化判分正确', fillJudged);
} else {
  await answerCurrent(true);
}
await nextQuestion(); // 查看结果
const quizResult = await page.evaluate(() => ({
  score: document.querySelector('.quiz-score')?.textContent,
  chapterChange: document.querySelector('.quiz-chapter-change')?.textContent,
  finishBtn: [...document.querySelectorAll('.quiz-drawer .practice-btn')].some(b => b.textContent.includes('完成')),
}));
check('结算页展示答对数与章节变化', quizResult.score === '2/2' && quizResult.finishBtn && /→/.test(quizResult.chapterChange || ''), JSON.stringify(quizResult));
await page.screenshot({ path: OUT + '06-quiz-result.png' });
await page.evaluate(() => [...document.querySelectorAll('.quiz-drawer .practice-btn')].find(b => b.textContent.includes('完成'))?.click());
await sleep(400);
const quizDone = await page.evaluate(() => ({
  quizClosed: !document.querySelector('.quiz-drawer'),
  panelBack: !!document.querySelector('.info-panel'),
}));
check('完成 → 关闭抽屉回到星图面板', quizDone.quizClosed && quizDone.panelBack, JSON.stringify(quizDone));

// ── 连对奖励：limit-inf 连对 3 题 → 第 3 题 +5 稳定掌握奖励 ──
await resetRecords();
await openQuiz('limit-inf');
for (let i = 0; i < 3; i++) {
  await answerCurrent(true);
  if (i === 1) await page.screenshot({ path: OUT + '07-quiz-streak.png' });
  await nextQuestion();
}
const streak = await page.evaluate(() => {
  const store = window.__data;
  const recs = store.records.filter(r => r.pointIds.includes('limit-inf'));
  const last = recs[recs.length - 1];
  const coef = store.rules.difficultyCoeff[String(last.difficulty)];
  return {
    streak: store.streaks['limit-inf'],
    lastDelta: last.pointDeltas['limit-inf'],
    expect: store.rules.baseScore * coef + store.rules.streakBonus,
    bonusShown: true,
  };
});
check('连对 3 题 → 稳定掌握奖励 +5', streak.streak === 3 && streak.lastDelta === streak.expect, JSON.stringify(streak));
await page.evaluate(() => [...document.querySelectorAll('.quiz-drawer .practice-btn')].find(b => b.textContent.includes('完成'))?.click());
await sleep(400);

// ── 跨会话：刷新后记录/分数/连对数完全一致 ──
const beforeReload = await page.evaluate(() => ({
  mastery: window.__data.mastery.get('limit-inf'),
  streak: window.__data.streaks['limit-inf'],
  records: window.__data.records.length,
  chapter: window.__data.chapterScores.get('limit'),
}));
await page.reload({ waitUntil: 'networkidle0' });
await bootWait();
await enterDemo(); // 刷新回到登录界面 → 重新进入演示账号继续验证
const afterReload = await page.evaluate(() => ({
  mastery: window.__data.mastery.get('limit-inf'),
  streak: window.__data.streaks['limit-inf'],
  records: window.__data.records.length,
  chapter: window.__data.chapterScores.get('limit'),
}));
check('跨会话持久化（刷新后分数/连对/记录一致）', JSON.stringify(beforeReload) === JSON.stringify(afterReload), JSON.stringify({ beforeReload, afterReload }));

// ── 账号隔离：登录已注册的验收账号（新用户星图全空白，记录独立）──
await logoutUi();
await loginWith(uname, 'pass1234');
await page.waitForFunction(() => !document.querySelector('.login-overlay'), { timeout: 15000 });
const guest = await page.evaluate((id) => ({
  userId: window.__data.userId,
  allUnlearned: window.__galaxy.planetManager.planets.every(p => p.stateKey === 'unlearned'),
  labelsNull: window.__galaxy.planetManager._labels.every(l => l.percent == null),
  records: window.__data.records.length,
  ls: localStorage.getItem('kmu:records:' + id),
}), regUserId);
check('新用户 → 全星系未学 + 章节未开始', guest.userId === regUserId && guest.allUnlearned && guest.labelsNull && guest.records === 0 && guest.ls === null, JSON.stringify(guest));
await page.screenshot({ path: OUT + '08-guest.png' });
await openQuiz('limit-calc');
await answerCurrent(true);
const guestRec = await page.evaluate((id) => {
  const list = JSON.parse(localStorage.getItem('kmu:records:' + id) || '[]');
  return { count: list.length, userId: list[0]?.userId, demoUntouched: JSON.parse(localStorage.getItem('kmu:records:demo-001') || '[]').length };
}, regUserId);
check('新用户做题 → 记录按 user_id 隔离', guestRec.count === 1 && guestRec.userId === regUserId && guestRec.demoUntouched === beforeReload.records, JSON.stringify(guestRec));
await page.evaluate(() => document.querySelector('.quiz-drawer .info-close')?.click());
await sleep(300);
await logoutUi();
await enterDemo();
const backDemo = await page.evaluate(() => ({
  mastery: window.__data.mastery.get('limit-inf'),
  streak: window.__data.streaks['limit-inf'],
  records: window.__data.records.length,
}));
check('切回演示账号 → 状态完整恢复', backDemo.mastery === beforeReload.mastery && backDemo.streak === beforeReload.streak && backDemo.records === beforeReload.records, JSON.stringify(backDemo));

// ── 多星系切换：高数（9 星团）↔ 线代 / 概率（6 星团） ──
const switcherInfo = await page.evaluate(() => ({
  count: document.querySelectorAll('.galaxy-switcher .gs-btn').length,
  active: document.querySelector('.galaxy-switcher .gs-btn.active')?.dataset.galaxy,
}));
check('星系切换器常驻（3 星系可选）', switcherInfo.count === 3 && switcherInfo.active === 'advanced-math', JSON.stringify(switcherInfo));

await page.evaluate(() => document.querySelector('.galaxy-switcher [data-galaxy="linear-algebra"]').click());
await page.waitForFunction(() => window.__galaxy.planetManager.planets.length === 24, { timeout: 8000 });
const laGalaxy = await page.evaluate(() => ({
  planets: window.__galaxy.planetManager.planets.length,
  links: window.__galaxy.linkManager.links.length,
  rings: window.__galaxy.planetManager._rings.length,
  subtitle: document.querySelector('.app-header .subtitle').textContent,
  activeBtn: document.querySelector('.galaxy-switcher .gs-btn.active')?.dataset.galaxy,
  mastered: window.__galaxy.planetManager.planets.find(p => p.id === 'la-mat-ops')?.stateKey,
  weak: window.__galaxy.planetManager.planets.find(p => p.id === 'la-eig-similar')?.stateKey,
  selected: window.__galaxy.selectedId,
}));
check('切换到线性代数星系 — 6 星团 24 星球 + 种子状态', laGalaxy.planets === 24 && laGalaxy.rings === 6 && laGalaxy.links === 28 && laGalaxy.subtitle.includes('线性代数') && laGalaxy.activeBtn === 'linear-algebra' && laGalaxy.mastered === 'mastered' && laGalaxy.weak === 'weak' && !laGalaxy.selected, JSON.stringify(laGalaxy));
await sleep(1000); // 等切换闪光淡出再截图
await page.screenshot({ path: OUT + '14-galaxy-la.png' });

await page.evaluate(() => document.querySelector('.galaxy-switcher [data-galaxy="probability"]').click());
await page.waitForFunction(() => window.__galaxy.planetManager.planets.length === 28, { timeout: 8000 });
const probGalaxy = await page.evaluate(() => ({
  planets: window.__galaxy.planetManager.planets.length,
  links: window.__galaxy.linkManager.links.length,
  rings: window.__galaxy.planetManager._rings.length,
  subtitle: document.querySelector('.app-header .subtitle').textContent,
  startedChapters: ['prob-event', 'prob-rv', 'prob-multi'].every(id => window.__data.chapterScores.get(id) != null),
  unstartedChapters: ['prob-num', 'prob-limit', 'prob-stat'].filter(id => window.__data.chapterScores.get(id) == null).length,
}));
check('切换到概率论星系 — 6 星团 28 星球 + 后段未开始', probGalaxy.planets === 28 && probGalaxy.rings === 6 && probGalaxy.links === 37 && probGalaxy.subtitle.includes('概率论') && probGalaxy.startedChapters && probGalaxy.unstartedChapters === 3, JSON.stringify(probGalaxy));
await sleep(1000);
await page.screenshot({ path: OUT + '15-galaxy-prob.png' });

// 概率星系内做题闭环：点星球 → 面板 → 做题 → 掌握度/记录同步
const probPos = await page.evaluate(() => window.__galaxy.getScreenPosition('prob-evt-cond'));
await page.mouse.click(probPos.x, probPos.y);
await sleep(1200);
const probSelect = await page.evaluate(() => ({
  selected: window.__galaxy.selectedId,
  title: document.querySelector('.info-panel .info-title')?.textContent,
}));
check('概率星系点击星球 → 面板打开', probSelect.selected === 'prob-evt-cond', JSON.stringify(probSelect));
await page.evaluate(() => document.querySelector('.info-panel .practice-btn')?.click());
await page.waitForFunction(() => {
  const d = document.querySelector('.quiz-drawer');
  return d && d.getBoundingClientRect().right <= window.innerWidth + 1
    && d.getAnimations().every((a) => a.playState === 'finished');
}, { timeout: 8000 });
await sleep(150);
await answerCurrent(true);
await nextQuestion(); // 1 题时提交后按钮为「查看结果」
await page.evaluate(() => [...document.querySelectorAll('.quiz-drawer .practice-btn')].find(b => b.textContent.includes('完成'))?.click());
await page.waitForFunction(() => !document.querySelector('.quiz-drawer'), { timeout: 5000 });
const probQuiz = await page.evaluate(() => ({
  mastery: window.__data.mastery.get('prob-evt-cond'),
  records: window.__data.records.length,
}));
check('概率星系做题 → 掌握度与记录同步', probQuiz.mastery != null && probQuiz.records === beforeReload.records + 1, JSON.stringify(probQuiz));

// 切回高等数学 → 完整恢复 9 星团
await page.evaluate(() => document.querySelector('.galaxy-switcher [data-galaxy="advanced-math"]').click());
await page.waitForFunction(() => window.__galaxy.planetManager.planets.length === 66, { timeout: 8000 });
const backGalaxy = await page.evaluate(() => ({
  planets: window.__galaxy.planetManager.planets.length,
  links: window.__galaxy.linkManager.links.length,
  rings: window.__galaxy.planetManager._rings.length,
  subtitle: document.querySelector('.app-header .subtitle').textContent,
}));
check('切回高等数学星系 — 9 星团 66 星球恢复', backGalaxy.planets === 66 && backGalaxy.rings === 9 && backGalaxy.links === 98 && backGalaxy.subtitle.includes('高等数学'), JSON.stringify(backGalaxy));

// ── 小智 AI 助教：RAG 检索 → 离线降级答案 → 引用跳转（含跨星系）──
const xzEntry = await page.evaluate(() => {
  const orb = document.querySelector('.xz-orb');
  if (!orb) return { orb: false };
  const r = orb.getBoundingClientRect();
  return { orb: true, inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
});
check('小智悬浮入口常驻（右下角）', xzEntry.orb && xzEntry.inView, JSON.stringify(xzEntry));
await page.evaluate(() => document.querySelector('.xz-orb').click());
await page.waitForSelector('.xz-panel', { timeout: 12000 });
// 等滑入动画结束再量几何（无头软渲染帧慢，动画中途 rect 会偏出视口）
await page.waitForFunction(() => {
  const p = document.querySelector('.xz-panel');
  return !!p && p.getAnimations().every((a) => a.playState === 'finished');
}, { timeout: 15000 });
const xzOpen = await page.evaluate(() => {
  const p = document.querySelector('.xz-panel').getBoundingClientRect();
  return {
    chips: document.querySelectorAll('.xz-chip').length,
    mode: document.querySelector('.xz-mode')?.textContent ?? '',
    inView: p.left >= 0 && p.right <= innerWidth && p.top >= 0 && p.bottom <= innerHeight,
  };
});
check('小智对话抽屉打开（建议问题 + RAG 就绪）', xzOpen.chips === 4 && xzOpen.mode.includes('RAG') && xzOpen.inView, JSON.stringify(xzOpen));

// 提问：走本地检索 → /api/ai/chat（代理未启动 → 502）→ 离线整理答案
await page.type('.xz-input', '泰勒公式属于数几范围？');
await page.keyboard.press('Enter');
await page.waitForFunction(() => {
  const msgs = document.querySelectorAll('.xz-msg.assistant .xz-bubble');
  return msgs.length >= 2 && !document.querySelector('.xz-typing');
}, { timeout: 20000 });
const xzAnswer = await page.evaluate(() => {
  const msgs = [...document.querySelectorAll('.xz-msg.assistant .xz-bubble')];
  return {
    text: msgs[msgs.length - 1].textContent,
    cites: [...document.querySelectorAll('.xz-cite')].map((c) => c.textContent),
    mode: document.querySelector('.xz-mode')?.textContent ?? '',
    note: document.querySelector('.xz-note')?.textContent ?? '',
  };
});
check('小智 RAG 问答 → 可溯源离线答案（考点/范围/引用）',
  xzAnswer.text.includes('泰勒公式') && xzAnswer.text.includes('数一') && xzAnswer.mode.includes('离线') && xzAnswer.cites.includes('泰勒公式') && xzAnswer.note.includes('离线演示'),
  JSON.stringify({ mode: xzAnswer.mode, cites: xzAnswer.cites, note: xzAnswer.note }));
await page.screenshot({ path: OUT + '16-xiaozhi-desktop.png' });

// 引用点击：关闭抽屉并聚焦对应星球
await page.evaluate(() => [...document.querySelectorAll('.xz-cite')].find((c) => c.textContent.includes('泰勒公式')).click());
await sleep(250);
const xzCite = await page.evaluate(() => ({
  selected: window.__galaxy.selectedId,
  panelClosed: !document.querySelector('.xz-panel'),
  title: document.querySelector('.info-panel .info-title')?.textContent ?? '',
}));
check('小智引用 → 关闭抽屉并聚焦对应星球', xzCite.selected === 'der-taylor' && xzCite.panelClosed && xzCite.title.includes('泰勒'), JSON.stringify(xzCite));

// 跨星系引用：高数星系里问线代考点，点击引用应自动切入线代星系
await page.evaluate(() => document.querySelector('.xz-orb').click());
await page.waitForSelector('.xz-panel', { timeout: 12000 });
await page.type('.xz-input', '逆矩阵怎么求？');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelectorAll('.xz-msg.assistant .xz-bubble').length >= 3 && !document.querySelector('.xz-typing'), { timeout: 20000 });
await page.evaluate(() => {
  const cs = [...document.querySelectorAll('.xz-cite')].filter((c) => c.textContent.includes('逆矩阵'));
  cs[cs.length - 1]?.click();
});
await page.waitForFunction(() => window.__galaxy.planetManager.planets.length === 24, { timeout: 8000 });
const xzCross = await page.evaluate(() => ({
  selected: window.__galaxy.selectedId,
  subtitle: document.querySelector('.app-header .subtitle').textContent,
  panelClosed: !document.querySelector('.xz-panel'),
}));
check('小智跨星系引用 → 自动切星系并聚焦', xzCross.selected === 'la-mat-inverse' && xzCross.subtitle.includes('线性代数') && xzCross.panelClosed, JSON.stringify(xzCross));

// ── 知识讲解页：Markdown + KaTeX 渲染、导航、关联跳转、关闭恢复 ──
// 信息面板简介公式（逆矩阵简介含 |A|≠0）：Markdown 解析、无泄漏
await page.waitForFunction(() => document.querySelectorAll('.info-desc .math-text .katex').length > 0, { timeout: 15000 });
const infoMath = await page.evaluate(() => {
  const n = document.querySelector('.info-desc')?.cloneNode(true);
  if (!n) return { missing: true };
  n.querySelectorAll('.katex').forEach((k) => k.remove());
  const t = n.textContent;
  return {
    katex: document.querySelectorAll('.info-desc .katex').length,
    errors: document.querySelectorAll('.info-desc .katex-error').length,
    leak: /\$|\\[a-zA-Z]{2,}|\^\{|_\{/.test(t),
  };
});
check('信息面板简介公式渲染（无 $ / LaTeX 泄漏）', !infoMath.missing && infoMath.katex > 0 && infoMath.errors === 0 && !infoMath.leak, JSON.stringify(infoMath));

// ── 知识讲解页：Markdown + KaTeX 渲染、导航、关联跳转、关闭恢复 ──
await page.evaluate(() => document.querySelector('.info-panel .notes-btn').click());
await page.waitForFunction(() => {
  const md = document.querySelector('.note-md');
  return md && md.querySelectorAll('h2').length >= 2 && md.querySelectorAll('.katex').length > 0;
}, { timeout: 30000 });
// 等页面入场动画结束再量几何（避免 translateY 过渡帧越出视口）
await page.waitForFunction(() => {
  const p = document.querySelector('.notes-page');
  return !!p && p.getAnimations().every((a) => a.playState === 'finished');
}, { timeout: 15000 });
const notesInfo = await page.evaluate(() => {
  const md = document.querySelector('.note-md');
  const p = document.querySelector('.notes-page').getBoundingClientRect();
  const clone = md.cloneNode(true);
  clone.querySelectorAll('.katex').forEach((n) => n.remove());
  const plain = clone.textContent;
  return {
    title: document.querySelector('.notes-title')?.textContent ?? '',
    crumb: document.querySelector('.notes-crumb')?.textContent ?? '',
    h2: md.querySelectorAll('h2').length,
    katex: md.querySelectorAll('.katex').length,
    katexError: md.querySelectorAll('.katex-error').length,
    display: md.querySelectorAll('.katex-display').length,
    rawLeak: plain.includes('$') || /\\[a-zA-Z]{2,}/.test(plain),
    inView: p.left >= 0 && p.top >= 0 && p.right <= innerWidth && p.bottom <= innerHeight,
  };
});
check('知识讲解页打开（Markdown 标题 + KaTeX 公式）',
  notesInfo.title.includes('逆矩阵') && notesInfo.crumb.includes('线性代数') && notesInfo.h2 >= 2 && notesInfo.katex >= 3 && notesInfo.katexError === 0 && notesInfo.display >= 1 && !notesInfo.rawLeak && notesInfo.inView,
  JSON.stringify(notesInfo));
await page.screenshot({ path: OUT + '17-notes-desktop.png' });

// 章节连续阅读：下一个考点
await page.evaluate(() => document.querySelector('.notes-nav[data-dir=next]').click());
await page.waitForFunction(() => {
  const t = document.querySelector('.notes-title')?.textContent;
  return t === '伴随矩阵' && document.querySelectorAll('.note-md .katex').length > 0;
}, { timeout: 8000 });
const notesNav = await page.evaluate(() => ({
  title: document.querySelector('.notes-title')?.textContent,
  katex: document.querySelectorAll('.note-md .katex').length,
  pos: document.querySelector('.notes-pos')?.textContent ?? '',
}));
check('知识讲解导航 → 下一个考点', notesNav.title === '伴随矩阵' && notesNav.katex > 0 && notesNav.pos === '7 / 24', JSON.stringify(notesNav));

// 关联考点跳转（伴随矩阵 → 前置「逆矩阵」）
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.notes-rel')].find((b) => b.textContent.includes('逆矩阵')) ?? document.querySelector('.notes-rel');
  btn?.click();
});
await page.waitForFunction(() => document.querySelector('.notes-title')?.textContent === '逆矩阵', { timeout: 8000 });
const notesRel = await page.evaluate(() => ({
  title: document.querySelector('.notes-title')?.textContent,
  h2: document.querySelectorAll('.note-md h2').length,
  katexError: document.querySelectorAll('.note-md .katex-error').length,
}));
check('知识讲解关联考点跳转', notesRel.h2 >= 1 && notesRel.katexError === 0, JSON.stringify(notesRel));

// 讲解页「相关题目」题干与参考答案的公式渲染（Markdown $…$ → KaTeX 同一管线）
await page.evaluate(() => document.querySelector('.notes-q-toggle')?.click());
await page.waitForFunction(() => document.querySelectorAll('.notes-q-analysis .katex').length > 0 && document.querySelectorAll('.notes-q-stem .katex').length > 0, { timeout: 15000 });
const notesMath = await page.evaluate(() => {
  const errors = document.querySelectorAll('.notes-q-analysis .katex-error, .notes-q-stem .katex-error').length;
  const plainText = (sel) => {
    const n = document.querySelector(sel)?.cloneNode(true);
    if (!n) return '';
    n.querySelectorAll('.katex').forEach((k) => k.remove());
    return n.textContent;
  };
  const plain = plainText('.notes-q-stem') + plainText('.notes-q-analysis');
  return {
    stem: document.querySelectorAll('.notes-q-stem .katex').length,
    math: document.querySelectorAll('.notes-q-analysis .katex').length,
    errors,
    rawLeak: plain.includes('$') || /\\[a-zA-Z]{2,}/.test(plain),
  };
});
check('讲解页相关题目公式渲染（题干 + 参考答案 · Markdown 解析）', notesMath.stem > 0 && notesMath.math > 0 && notesMath.errors === 0 && !notesMath.rawLeak, JSON.stringify(notesMath));

// 关闭 → 回到星图信息面板
await page.evaluate(() => document.querySelector('.notes-close').click());
await sleep(300);
const notesClosed = await page.evaluate(() => ({
  closed: !document.querySelector('.notes-overlay'),
  panel: !!document.querySelector('.info-panel'),
}));
check('知识讲解关闭 → 返回星图信息面板', notesClosed.closed && notesClosed.panel, JSON.stringify(notesClosed));

// ── 题库管理工作台：导入 → 待确认 → AI 建议（离线降级）→ 人工确认入库 ──
await page.evaluate(() => localStorage.removeItem('kmu:question_bank_imported'));
await page.reload({ waitUntil: 'networkidle0' });
await bootWait();
await enterDemo(); // 刷新回到登录界面 → 重新进入演示账号继续验证

// 测试用 CSV：1 完整单选 + 1 缺解析/章节错误/括号不配平 + 1 完整填空
const csvPath = OUT + 'import-test.csv';
const BOM = String.fromCharCode(0xFEFF);
const csvRows = [
  ['题干', '选项A', '选项B', '选项C', '选项D', '答案', '解析', '章节', '难度', '关联考点'],
  ['求极限 lim(x→0) sinx/x =', '0', '1', '2', '不存在', 'B', '第一个重要极限：lim(x→0) sinx/x = 1。', '函数、极限与连续', '1', 'limit-calc'],
  ['设 f(x)=x²·e^x，求导数 f′(x（', 'x²·e^x', '(2x+x²)e^x', '2x·e^x', '(x+x²)e^x', 'B', '', '错误的章节', '2', 'der-calc'],
  ['填空：∫₀¹ 3x² dx = ____（直接填数值）', '', '', '', '', '1', '∫₀¹ 3x² dx = [x³]₀¹ = 1。', '一元函数积分学', '1', 'int-def'],
];
fs.writeFileSync(csvPath, BOM + csvRows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\r\n'));

const setField = async (handle, value) => {
  await handle.evaluate((el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
};

await page.evaluate(() => document.querySelector('.account-admin').click());
await sleep(500);
const adminOpen = await page.evaluate(() => {
  const p = document.querySelector('.admin-panel');
  if (!p) return { open: false };
  const r = p.getBoundingClientRect();
  return { open: true, left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), vw: innerWidth, vh: innerHeight, empty: !!p.querySelector('.admin-empty') };
});
check('题库管理入口 → 工作台打开且在视口内', adminOpen.open && adminOpen.left >= 0 && adminOpen.right <= adminOpen.vw && adminOpen.top >= 0 && adminOpen.bottom <= adminOpen.vh, JSON.stringify(adminOpen));

// 批量上传 CSV（含错误行 → 提示不阻塞）
const fileInput = await page.$('.admin-toolbar input[type=file]');
await fileInput.uploadFile(csvPath);
await sleep(600);
const parsed = await page.evaluate(() => ({
  cards: document.querySelectorAll('.admin-card').length,
  notice: document.querySelector('.admin-notices')?.textContent ?? '',
  incomplete: document.querySelectorAll('.admin-card.incomplete').length,
  fillCard: [...document.querySelectorAll('.admin-type.fill')].length,
}));
check('CSV 解析 → 3 条待确认（含填空自动识别）', parsed.cards === 3 && parsed.fillCard === 1, JSON.stringify(parsed));
check('错误章节行 → 提示 + 标记待补充，不阻塞', parsed.notice.includes('错误的章节') && parsed.incomplete === 1, JSON.stringify(parsed));

// 逐题录入表单 → 完整单选项
await page.evaluate(() => [...document.querySelectorAll('.admin-toolbar .admin-btn')].find(b => b.textContent.includes('逐题录入')).click());
await sleep(300);
const formHandles = await page.$$('.admin-form select');
await setField(formHandles[1], 'ode'); // 章节
await sleep(200);
const stemTa = await page.$('.admin-form textarea');
await setField(stemTa, '微分方程 y′=2x 的通解为（C 为任意常数）');
const optInputs = await page.$$('.admin-options input');
for (const [i, v] of ['x²+C', '2x+C', 'x²', '2x'].entries()) await setField(optInputs[i], v);
const formSelects = await page.$$('.admin-form select');
await setField(formSelects[3], '0'); // 答案 A
const tas = await page.$$('.admin-form textarea');
await setField(tas[1], '分离变量并积分：y = x²+C。');
await page.evaluate(() => {
  const name = window.__data.points.get('ode-basic').name;
  [...document.querySelectorAll('.admin-form .admin-chip')].find(c => c.textContent.includes(name))?.click();
});
await page.evaluate(() => [...document.querySelectorAll('.admin-form .admin-btn')].find(b => b.textContent.includes('加入待确认')).click());
await sleep(300);
const formAdded = await page.evaluate(() => ({
  cards: document.querySelectorAll('.admin-card').length,
  complete: document.querySelectorAll('.admin-card.complete').length,
}));
check('逐题录入 → 加入待确认列表', formAdded.cards === 4 && formAdded.complete === 3, JSON.stringify(formAdded));
await page.screenshot({ path: OUT + '11-admin-workspace.png' });

// AI 辅助检查（代理未启动 → 应降级为离线演示模式，不报错不阻塞）
await page.evaluate(() => [...document.querySelectorAll('.admin-toolbar .admin-btn')].find(b => b.textContent.includes('AI 辅助检查')).click());
await page.waitForFunction(() => document.querySelector('.admin-mode'), { timeout: 20000 });
const aiState = await page.evaluate(() => ({
  offline: document.querySelector('.admin-mode.offline')?.textContent ?? '',
  aiCards: document.querySelectorAll('.admin-ai').length,
  adoptBtns: [...document.querySelectorAll('.admin-btn.adopt')].filter(b => !b.disabled).length,
}));
check('AI 检查降级 → 离线演示模式徽标 + 建议卡片', aiState.offline.includes('离线演示模式') && aiState.aiCards === 4, JSON.stringify(aiState));

// 采纳归类建议：错误章节行 → 建议「一元函数微分学」
const adopt = await page.evaluate(() => {
  const card = [...document.querySelectorAll('.admin-card')].find(c => c.querySelector('.admin-stem')?.textContent.includes('求导数'));
  const suggestion = card.querySelector('.admin-ai-row b')?.textContent;
  card.querySelector('.admin-btn.adopt').click();
  return suggestion;
});
await sleep(300);
const adopted = await page.evaluate(() => {
  const card = [...document.querySelectorAll('.admin-card')].find(c => c.querySelector('.admin-stem')?.textContent.includes('求导数'));
  return { meta: card.querySelector('.admin-meta')?.textContent, adoptDisabled: card.querySelector('.admin-btn.adopt')?.disabled };
});
check('采纳 AI 归类建议 → 章节人工可控地改写', adopt === '一元函数微分学' && adopted.meta.includes('一元函数微分学') && adopted.adoptDisabled, JSON.stringify({ adopt, ...adopted }));
await page.screenshot({ path: OUT + '12-admin-ai.png' });

// 修改补全：该卡仍缺解析与关联考点 → 确认按钮禁用；编辑补全后可入库
const beforeFix = await page.evaluate(() => {
  const card = [...document.querySelectorAll('.admin-card')].find(c => c.querySelector('.admin-stem')?.textContent.includes('求导数'));
  return { disabled: card.querySelector('.admin-btn.primary').disabled, missing: card.querySelector('.admin-missing')?.textContent };
});
check('字段不完整 → 确认入库禁用（待补充标记）', beforeFix.disabled && beforeFix.missing.includes('解析'), JSON.stringify(beforeFix));
await page.evaluate(() => {
  const card = [...document.querySelectorAll('.admin-card')].find(c => c.querySelector('.admin-stem')?.textContent.includes('求导数'));
  [...card.querySelectorAll('.admin-btn')].find(b => b.textContent === '修改').click();
});
await sleep(200);
const editTas = await page.$$('.admin-card.incomplete textarea');
await setField(editTas[1], '乘积法则：f′(x) = (2x+x²)e^x。');
await page.evaluate(() => {
  const card = document.querySelector('.admin-card.incomplete'); // 编辑态下唯一含编辑器的卡片
  const name = window.__data.points.get('der-calc').name;
  [...card.querySelectorAll('.admin-chip')].find(c => c.textContent.includes(name))?.click();
});
await page.evaluate(() => {
  const card = document.querySelector('.admin-card.incomplete');
  [...card.querySelectorAll('.admin-btn')].find(b => b.textContent === '保存修改').click();
});
await sleep(300);
const bankBefore = await page.evaluate(() => window.__data.questions.length);
await page.evaluate(() => {
  const card = [...document.querySelectorAll('.admin-card')].find(c => c.querySelector('.admin-stem')?.textContent.includes('求导数'));
  [...card.querySelectorAll('.admin-btn')].find(b => b.textContent === '确认入库').click();
});
await sleep(300);
const confirmed = await page.evaluate(() => {
  const store = window.__data;
  const imp = JSON.parse(localStorage.getItem('kmu:question_bank_imported') || '[]');
  const q = imp[imp.length - 1];
  return {
    total: store.questions.length,
    persisted: imp.length,
    indexed: q && store.questionsByPoint.get('der-calc').some(x => x.id === q.id),
    doneBadge: !!document.querySelector('.admin-card.confirmed .admin-done'),
    fields: q && q.chapterId === 'derivative' && q.pointIds.includes('der-calc') && q.answer === 1 && !!q.analysis,
  };
});
check('人工确认 → 唯一入口入库 + 抽题索引 + 持久化', confirmed.total === bankBefore + 1 && confirmed.persisted === 1 && confirmed.indexed && confirmed.doneBadge && confirmed.fields, JSON.stringify(confirmed));

// 全部确认入库（剩余 3 条完整项）
await page.evaluate(() => [...document.querySelectorAll('.admin-toolbar .admin-btn')].find(b => b.textContent.includes('全部确认入库')).click());
await sleep(300);
const allConfirmed = await page.evaluate(() => ({
  total: window.__data.questions.length,
  persisted: JSON.parse(localStorage.getItem('kmu:question_bank_imported') || '[]').length,
  pendingLeft: document.querySelectorAll('.admin-card:not(.confirmed)').length,
}));
check('全部确认入库 → 4 题入题库，待确认清空', allConfirmed.total === bankBefore + 4 && allConfirmed.persisted === 4 && allConfirmed.pendingLeft === 0, JSON.stringify(allConfirmed));

// 关闭工作台 → 刷新后导入题目仍在（跨会话持久化）
await page.evaluate(() => document.querySelector('.admin-close').click());
await sleep(300);
await page.reload({ waitUntil: 'networkidle0' });
await bootWait();
await enterDemo(); // 刷新回到登录界面 → 重新进入演示账号继续验证
const persistedAfterReload = await page.evaluate(() => {
  const store = window.__data;
  const imp = JSON.parse(localStorage.getItem('kmu:question_bank_imported') || '[]');
  return {
    total: store.questions.length,
    allIndexed: imp.every(q => q.pointIds.every(pid => store.questionsByPoint.get(pid)?.some(x => x.id === q.id))),
  };
});
check('刷新后导入题目仍在题库与抽题索引中', persistedAfterReload.total === bankBefore + 4 && persistedAfterReload.allIndexed, JSON.stringify(persistedAfterReload));
// 还原题库，保证后续测试与重复运行稳定
await page.evaluate(() => localStorage.removeItem('kmu:question_bank_imported'));
await page.reload({ waitUntil: 'networkidle0' });
await bootWait();
await enterDemo(); // 刷新回到登录界面 → 重新进入演示账号继续验证

// Excel(.xlsx) 上传路径：与 CSV 同一解析管线
const XLSX = (await import('xlsx')).default;
const xlsxPath = OUT + 'import-test.xlsx';
const ws = XLSX.utils.aoa_to_sheet([csvRows[0], csvRows[1]]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '题库');
fs.writeFileSync(xlsxPath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
await page.evaluate(() => document.querySelector('.account-admin').click());
await sleep(400);
const xlsxInput = await page.$('.admin-toolbar input[type=file]');
await xlsxInput.uploadFile(xlsxPath);
// 动态加载 xlsx 解析，等卡片或错误提示出现
await page.waitForFunction(() => document.querySelector('.admin-card') || document.querySelector('.admin-notices'), { timeout: 15000 });
const xlsxParsed = await page.evaluate(() => ({
  cards: document.querySelectorAll('.admin-card').length,
  stem: document.querySelector('.admin-card .admin-stem')?.textContent ?? '',
  complete: document.querySelectorAll('.admin-card.complete').length,
}));
check('Excel 上传 → 解析为待确认项', xlsxParsed.cards === 1 && xlsxParsed.stem.includes('sinx/x') && xlsxParsed.complete === 1, JSON.stringify(xlsxParsed));
await page.evaluate(() => document.querySelector('.admin-close').click());
await sleep(300);

// ── 视口缩放 → composer 渲染目标同步 ──
await page.setViewport({ width: 1200, height: 800 });
await sleep(400);
const resized = await page.evaluate(() => ({
  rt: [window.__galaxy.postfx.composer.renderTarget1.width, window.__galaxy.postfx.composer.renderTarget1.height],
  canvas: [window.__galaxy.renderer.domElement.width, window.__galaxy.renderer.domElement.height],
}));
check('resize → composer 渲染目标同步', resized.rt[0] === resized.canvas[0] && resized.rt[1] === resized.canvas[1], JSON.stringify(resized));

// ── 移动端 ──
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.reload({ waitUntil: 'networkidle0' });
await bootWait();
await enterDemo(); // 刷新回到登录界面 → 重新进入演示账号继续验证
const mobile = await page.evaluate(() => {
  const g = window.__galaxy;
  return { canvas: [g.renderer.domElement.width, g.renderer.domElement.height], dpr: g.renderer.getPixelRatio() };
});
check('移动端 canvas 正常', mobile.canvas[0] > 300 && mobile.canvas[1] > 700, JSON.stringify(mobile));
const mvis = await page.evaluate(() => ({
  stars: window.__galaxy.background.starCount,
  dust: window.__galaxy.background.dust.geometry.attributes.position.count,
  flares: window.__galaxy.background.flares.geometry.attributes.position.count,
  bloom: window.__galaxy.postfx.bloomPass.strength,
  bloomRes: window.__galaxy.postfx.bloomPass.resolution.x,
}));
check('移动端降级：3000 星 + 14 星芒 + 半分辨率泛光', mvis.stars === 3000 && mvis.dust === 220 && mvis.flares === 14 && Math.abs(mvis.bloom - 0.45) < 0.01 && mvis.bloomRes === 195, JSON.stringify(mvis));
// 窄屏顶栏：标题 / 账号行 / 控制台三者不得互相重叠
const mheader = await page.evaluate(() => {
  const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
  const overlap = (a, c) => a.l < c.r && c.l < a.r && a.t < c.b && c.t < a.b;
  const h = r('.app-header'), a = r('.account-box'), d = r('.control-dock'), g = r('.galaxy-switcher');
  return {
    ha: overlap(h, a), hd: overlap(h, d), ad: overlap(a, d),
    gsH: overlap(g, h), gsA: overlap(g, a), gsD: overlap(g, d),
    gsIn: g.l >= 0 && g.r <= window.innerWidth && g.t >= 0 && g.b <= window.innerHeight,
    dockBottom: Math.round(d.b),
  };
});
check('移动端标题/账号/控制台/星系切换器无重叠', !mheader.ha && !mheader.hd && !mheader.ad && !mheader.gsH && !mheader.gsA && !mheader.gsD && mheader.gsIn, JSON.stringify(mheader));

// 移动端背景音乐：开关可见（主流程预置关闭偏好，音频行为在文末独立会话验证）
const mbgm = await page.evaluate(() => {
  const t = [...document.querySelectorAll('.dock-toggle')].find((el) => el.textContent.includes('背景音乐'));
  const r = t?.getBoundingClientRect();
  return { visible: !!r && r.width > 0 && r.bottom <= innerHeight };
});
check('移动端背景音乐开关可见', mbgm.visible, JSON.stringify(mbgm));

// 移动端小智：入口在视口内 → 抽屉打开后完整可见、可关闭
const morb = await page.evaluate(() => {
  const r = document.querySelector('.xz-orb')?.getBoundingClientRect();
  return r && { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), vw: innerWidth, vh: innerHeight };
});
check('移动端小智入口在视口内', !!morb && morb.left >= 0 && morb.right <= morb.vw && morb.bottom <= morb.vh, JSON.stringify(morb));
await page.evaluate(() => document.querySelector('.xz-orb').click());
await page.waitForFunction(() => {
  const p = document.querySelector('.xz-panel');
  return !!p && p.getAnimations().every((a) => a.playState === 'finished');
}, { timeout: 15000 });
const mpanel = await page.evaluate(() => {
  const p = document.querySelector('.xz-panel').getBoundingClientRect();
  return { left: Math.round(p.left), right: Math.round(p.right), top: Math.round(p.top), bottom: Math.round(p.bottom), vw: innerWidth, vh: innerHeight };
});
check('移动端小智抽屉完整在视口内', mpanel.left >= 0 && mpanel.right <= mpanel.vw && mpanel.top >= 0 && mpanel.bottom <= mpanel.vh, JSON.stringify(mpanel));
await page.evaluate(() => document.querySelector('.xz-close').click());
await sleep(250);
check('移动端小智抽屉可关闭', await page.evaluate(() => !document.querySelector('.xz-panel')));
const mpos = await page.evaluate(() => window.__galaxy.getScreenPosition('limit-calc'));
await page.mouse.click(mpos.x, mpos.y);
await sleep(1400);
const mfocus = await page.evaluate(() => ({
  selected: window.__galaxy.selectedId,
  panel: !!document.querySelector('.info-panel'),
}));
check('移动端点击星球可用', mfocus.selected === 'limit-calc' && mfocus.panel, JSON.stringify(mfocus));
// 等抽屉入场动画结束再量静止布局（无头软渲染帧慢，动画中途 rect 带 translateY 偏移）
await page.waitForFunction(() => {
  const el = document.querySelector('.info-panel');
  return el && el.getAnimations().every((a) => a.playState === 'finished');
}, { timeout: 15000 });
const sheet = await page.evaluate(() => {
  const r = document.querySelector('.info-panel').getBoundingClientRect();
  const d = document.querySelector('.control-dock').getBoundingClientRect();
  return { left: Math.round(r.left), right: Math.round(r.right), vw: window.innerWidth, bottom: Math.round(r.bottom), vh: window.innerHeight, dockCovers: d.bottom > r.top && d.right > r.left && d.left < r.right };
});
check('移动端抽屉完整在视口内', sheet.left >= 0 && sheet.right <= sheet.vw && sheet.bottom <= sheet.vh, JSON.stringify(sheet));
check('移动端控制台不遮挡信息抽屉', !sheet.dockCovers, `dockBottom=${sheet.dockCovers}`);
await page.screenshot({ path: OUT + '09-mobile.png' });

// 移动端知识讲解页：公式渲染 + 视口内 + 可关闭
await page.evaluate(() => document.querySelector('.info-panel .notes-btn').click());
await page.waitForFunction(() => {
  const md = document.querySelector('.note-md');
  const p = document.querySelector('.notes-page');
  return md && md.querySelectorAll('.katex').length > 0 && p && p.getAnimations().every((a) => a.playState === 'finished');
}, { timeout: 30000 });
const mnotes = await page.evaluate(() => {
  const p = document.querySelector('.notes-page').getBoundingClientRect();
  const md = document.querySelector('.note-md').getBoundingClientRect();
  return {
    left: Math.round(p.left), top: Math.round(p.top), right: Math.round(p.right), bottom: Math.round(p.bottom),
    mdW: Math.round(md.width), vw: innerWidth, vh: innerHeight,
    katex: document.querySelectorAll('.note-md .katex').length,
  };
});
check('移动端知识讲解页在视口内（公式渲染）',
  mnotes.left >= 0 && mnotes.top >= 0 && mnotes.right <= mnotes.vw && mnotes.bottom <= mnotes.vh && mnotes.mdW <= mnotes.vw && mnotes.katex > 0,
  JSON.stringify(mnotes));
await page.screenshot({ path: OUT + '18-notes-mobile.png' });
await page.evaluate(() => document.querySelector('.notes-close').click());
await sleep(300);
check('移动端知识讲解可关闭', await page.evaluate(() => !document.querySelector('.notes-overlay')));

// 移动端做题抽屉
await page.evaluate(() => document.querySelector('.info-panel .practice-btn')?.click());
await page.waitForFunction(() => {
  const d = document.querySelector('.quiz-drawer');
  if (!d) return false;
  const r = d.getBoundingClientRect();
  // 等入场动画真正结束再量，避免在 translateY 过渡帧采到越界值
  return r.left >= -1 && r.right <= window.innerWidth + 1 && r.top >= -1 && r.bottom <= window.innerHeight + 1
    && d.getAnimations().every((a) => a.playState === 'finished');
}, { timeout: 8000 });
await sleep(150);
const mquiz = await page.evaluate(() => {
  const d = document.querySelector('.quiz-drawer');
  if (!d) return { open: false };
  const r = d.getBoundingClientRect();
  return { open: true, left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), vw: window.innerWidth, vh: window.innerHeight };
});
check('移动端做题浮层完整在视口内', mquiz.open && mquiz.left >= 0 && mquiz.right <= mquiz.vw && mquiz.top >= 0 && mquiz.bottom <= mquiz.vh, JSON.stringify(mquiz));
await answerCurrent(true);
const mjudge = await page.evaluate(() => !!document.querySelector('.quiz-analysis'));
check('移动端提交判分正常', mjudge);
await page.screenshot({ path: OUT + '10-mobile-quiz.png' });
await page.evaluate(() => document.querySelector('.quiz-drawer .info-close')?.click());
await sleep(400);

// 移动端题库工作台
await page.evaluate(() => document.querySelector('.account-admin').click());
// 等入场动画真正结束（低帧率下合成动画可能延迟起步）再量几何
await page.waitForFunction(() => {
  const p = document.querySelector('.admin-panel');
  if (!p) return false;
  const r = p.getBoundingClientRect();
  return r.top <= 1 && r.bottom <= window.innerHeight + 1
    && p.getAnimations().every((a) => a.playState === 'finished');
}, { timeout: 12000 });
await sleep(150);
const madmin = await page.evaluate(() => {
  const p = document.querySelector('.admin-panel');
  if (!p) return { open: false };
  const r = p.getBoundingClientRect();
  return { open: true, left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), vw: innerWidth, vh: innerHeight };
});
check('移动端工作台全屏且在视口内', madmin.open && madmin.left >= 0 && madmin.right <= madmin.vw && madmin.top >= 0 && madmin.bottom <= madmin.vh, JSON.stringify(madmin));
await page.evaluate(() => [...document.querySelectorAll('.admin-toolbar .admin-btn')].find(b => b.textContent.includes('逐题录入')).click());
await sleep(300);
const mform = await page.evaluate(() => {
  const f = document.querySelector('.admin-form');
  const list = document.querySelector('.admin-list');
  if (!f || !list) return { ok: false };
  const fr = f.getBoundingClientRect();
  const lr = list.getBoundingClientRect();
  return { ok: true, formBottom: Math.round(fr.bottom), listTop: Math.round(lr.top), vh: innerHeight, formScrollable: f.scrollHeight >= f.clientHeight };
});
check('移动端录入表单与列表均可达', mform.ok && mform.formBottom <= mform.vh && mform.listTop >= mform.formBottom - 1, JSON.stringify(mform));
await page.screenshot({ path: OUT + '13-admin-mobile.png' });
await page.evaluate(() => document.querySelector('.admin-close').click());

// ── 模拟做题结果：仅演示账号可用；写入记录并联动 3D/exhibit ──
const simUi = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.dock-btn')].map((b) => b.textContent.trim());
  return { hasSim: btns.some((t) => t.includes('模拟做题结果')), btns };
});
check('演示账号 → 展示「模拟做题结果」入口', simUi.hasSim, JSON.stringify(simUi));
const simBefore = await page.evaluate(() => ({ records: window.__data.records.length }));
await page.evaluate(() => [...document.querySelectorAll('.dock-btn')].find((b) => b.textContent.includes('模拟做题结果')).click());
await page.waitForFunction((n) => window.__data.records.length > n, { timeout: 12000 }, simBefore.records);
await sleep(1800); // 等 450ms 串行模拟队列跑完
const simAfter = await page.evaluate(() => {
  const store = window.__data;
  const rec = store.records[store.records.length - 1];
  return {
    records: store.records.length,
    questionOk: typeof rec?.questionId === 'string' && rec.questionId.startsWith('q-'),
    userId: rec?.userId,
    engineSynced: rec ? rec.pointIds.every((pid) => window.__galaxy.planetManager.byId.get(pid)?.mastery === store.mastery.get(pid)) : false,
    toast: document.querySelector('.toast')?.textContent ?? '',
  };
});
check('演示账号模拟做题 → 记录写入 + 星球联动', simAfter.records > simBefore.records && simAfter.questionOk && simAfter.userId === 'demo-001' && simAfter.engineSynced, JSON.stringify(simAfter));

// 注册账号 → 无「模拟做题结果」入口（主按钮退化为回到俯瞰）
await logoutUi();
await loginWith(uname, 'pass1234');
await page.waitForFunction(() => !document.querySelector('.login-overlay'), { timeout: 15000 });
const simUser = await page.evaluate(() => ({
  hasSim: [...document.querySelectorAll('.dock-btn')].some((b) => b.textContent.includes('模拟做题结果')),
  btns: [...document.querySelectorAll('.dock-btn')].map((b) => b.textContent.trim()),
  primary: document.querySelector('.dock-btn.primary')?.textContent.trim() ?? '',
}));
check('注册账号 → 无「模拟做题结果」入口', !simUser.hasSim && simUser.primary.includes('回到俯瞰'), JSON.stringify(simUser));
// 回演示账号，结束主流程（随后是独立的音频短会话）
await logoutUi();
await enterDemo();

// ── 背景音乐（独立短会话）：验证程序化 BGM 的默认开启、手势启动与关闭 ──
const audioPage = await browser.newPage();
await audioPage.setViewport({ width: 1200, height: 800 });
audioPage.on('pageerror', (e) => errors.push('[audio pageerror] ' + e.message));
await audioPage.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
// 主流程注入的「关闭偏好」与音频页同源共享，清掉后重载得到全新默认值
await audioPage.evaluate(() => localStorage.removeItem('kmu:bgm'));
await audioPage.reload({ waitUntil: 'networkidle0' });
await audioPage.waitForFunction(() => window.__galaxy?.planetManager?.planets?.length === 66 && !!window.__music, { timeout: 30000 });
await sleep(500);
const bgmUi = await audioPage.evaluate(() => {
  const toggle = [...document.querySelectorAll('.dock-toggle')].find((el) => el.textContent.includes('背景音乐'));
  return {
    toggle: !!toggle,
    on: toggle?.querySelector('.switch')?.getAttribute('aria-checked') === 'true',
    volume: !!document.querySelector('.dock-volume input[type=range]'),
    vol: window.__music?.getDebug?.().volume ?? 0,
  };
});
check('背景音乐开关 + 音量控件常驻（默认开 · 65% 响度）', bgmUi.toggle && bgmUi.on && bgmUi.volume && bgmUi.vol >= 0.6, JSON.stringify(bgmUi));
await audioPage.mouse.click(600, 700); // 首次用户手势（空白处）→ 启动音频
await audioPage.waitForFunction(() => window.__music?.enabled && window.__music.ctx?.state === 'running' && window.__music.getDebug().master > 0.15, { timeout: 12000 });
const bgmOn = await audioPage.evaluate(() => window.__music.getDebug());
check('首次手势后 BGM 启动（AudioContext 运行 + 主增益淡入）', bgmOn.enabled && bgmOn.state === 'running' && bgmOn.master > 0.15, JSON.stringify(bgmOn));
await audioPage.evaluate(() => [...document.querySelectorAll('.dock-toggle')].find((el) => el.textContent.includes('背景音乐')).querySelector('.switch').click());
await audioPage.waitForFunction(() => window.__music.enabled === false && window.__music.getDebug().master < 0.03, { timeout: 8000 });
const bgmOff = await audioPage.evaluate(() => window.__music.getDebug());
check('背景音乐可关闭（主增益归零）', bgmOff.enabled === false && bgmOff.master < 0.03, JSON.stringify(bgmOff));
await audioPage.evaluate(() => [...document.querySelectorAll('.dock-toggle')].find((el) => el.textContent.includes('背景音乐')).querySelector('.switch').click());
await audioPage.waitForFunction(() => window.__music.enabled && window.__music.ctx.state === 'running', { timeout: 8000 });
check('背景音乐可重新开启', await audioPage.evaluate(() => window.__music.enabled));
await audioPage.close();

console.log(results.join('\n'));
console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\n无运行时错误');
await browser.close();
process.exit(results.some(r => r.startsWith('FAIL')) || errors.length ? 1 : 0);