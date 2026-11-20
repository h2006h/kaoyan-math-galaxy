// 性能诊断工具（开发用）：node scripts/perf-bench.mjs
// 1) 输出当前像素密度 / 泛光分辨率 / 绘制缓冲尺寸
// 2) 逐层开关（穹顶、星云 sprite、泛光）测帧间隔中位数，定位填充率瓶颈
// 3) 可选：强制触发自适应降档，验证渲染目标同步（--adaptive）
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => window.__galaxy?.planetManager?.planets?.length === 66 && window.__galaxy.clock.elapsedTime > 1,
  { timeout: 40000 }
);
await page.evaluate(() => {
  window.__galaxy.setAutoRotate(false);
  setInterval(() => window.__galaxy._markActive(), 800); // 防深度空闲降帧干扰采样
  window.__medianFrame = (n = 15) => new Promise((resolve) => {
    const ts = [];
    const tick = (t) => {
      ts.push(t);
      if (ts.length <= n) requestAnimationFrame(tick);
      else {
        const d = [];
        for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
        d.sort((a, b) => a - b);
        resolve(d[Math.floor(d.length / 2)]);
      }
    };
    requestAnimationFrame(tick);
  });
});

const state = await page.evaluate(() => {
  const g = window.__galaxy;
  return {
    ratio: g.renderer.getPixelRatio(),
    baseRatio: g._baseRatio,
    adaptive: g._adaptive,
    bloomRes: g.postfx.bloomPass.resolution.x,
    drawing: [g.renderer.domElement.width, g.renderer.domElement.height],
  };
});
console.log('state:', JSON.stringify(state));

const sample = async (label) => {
  const median = await page.evaluate(() => window.__medianFrame(15));
  console.log(label.padEnd(18), 'median', median.toFixed(1), 'ms');
};
await sample('baseline');
await page.evaluate(() => { window.__galaxy.background.dome.visible = false; });
await sample('no dome');
await page.evaluate(() => {
  window.__galaxy.background.dome.visible = true;
  window.__galaxy.postfx.bloomPass.enabled = false;
});
await sample('no bloom');
await page.evaluate(() => { window.__galaxy.postfx.bloomPass.enabled = true; });

if (process.argv.includes('--adaptive')) {
  await page.evaluate(() => {
    const g = window.__galaxy;
    g._adaptive = true;
    g._frameEma = 40;
    g._lastAdapt = 0;
  });
  await page.mouse.move(500, 450);
  await new Promise((r) => setTimeout(r, 800));
  console.log('adaptive:', JSON.stringify(await page.evaluate(() => ({
    ratio: window.__galaxy.renderer.getPixelRatio(),
    scale: window.__galaxy._ratioScale,
    drawing: [window.__galaxy.renderer.domElement.width, window.__galaxy.renderer.domElement.height],
    rt: [window.__galaxy.postfx.composer.renderTarget1.width, window.__galaxy.postfx.composer.renderTarget1.height],
  }))));
}

await browser.close();
