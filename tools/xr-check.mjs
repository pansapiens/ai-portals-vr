// A check of the headset drawing (src/core/xr.js) without a headset: headless Chrome with a fake WebXR device that draws
// both eyes side by side on the page. It enters VR, flies up to the first portal and through it, and saves screenshots.
// Needs playwright-core (npm i --no-save playwright-core) and Chrome. Usage, with "npm start" running:
//   node tools/xr-check.mjs [url] [chrome path]      -> xr-check-*.png in the current folder; exits 1 on a page error
import { chromium } from 'playwright-core';
const url = process.argv[2] || 'http://localhost:8000/', exe = process.argv[3] || '/usr/bin/google-chrome';
const mock = () => {
  WebGL2RenderingContext.prototype.makeXRCompatible = async () => {};
  const t = Math.tan(50 * Math.PI / 180), n = 0.1, f = 1000;
  const proj = new Float32Array([1 / t, 0, 0, 0, 0, 1 / t, 0, 0, 0, 0, -(f + n) / (f - n), -1, 0, 0, -2 * f * n / (f - n), 0]);
  const view = (dx) => ({ eye: dx < 0 ? 'left' : 'right', projectionMatrix: proj, transform: { matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, dx, 0, 0, 1]) } });
  class Session extends EventTarget {
    constructor() { super(); this.renderState = { baseLayer: null }; this.inputSources = []; }
    updateRenderState(s) { Object.assign(this.renderState, s); }
    async requestReferenceSpace() { return { getOffsetReferenceSpace() { return this; } }; }
    requestAnimationFrame(cb) { return requestAnimationFrame((ts) => cb(ts, { session: this, getViewerPose: () => ({ views: [view(-0.032), view(0.032)] }), getPose: () => null })); }
    cancelAnimationFrame(id) { cancelAnimationFrame(id); }
    async end() { this.dispatchEvent(new Event('end')); }
  }
  window.XRWebGLLayer = class { constructor(s, gl) { this.framebuffer = null; this.framebufferWidth = gl.drawingBufferWidth; this.framebufferHeight = gl.drawingBufferHeight; }
    getViewport(v) { const w = this.framebufferWidth / 2; return { x: v.eye === 'left' ? 0 : w, y: 0, width: w, height: this.framebufferHeight }; } };
  Object.defineProperty(navigator, 'xr', { value: { isSessionSupported: async () => true, requestSession: async () => new Session(), addEventListener() {} } });
};
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 600 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(mock);
await page.goto(url);
await page.waitForFunction(() => window.__engine?.cur && !window.__engine.cur.def.antechamber, null, { timeout: 120000 });
await page.evaluate(() => window.__engine.xr.toggle());
await page.waitForFunction(() => window.__engine.xr.on && window.__engine.next?.ready, null, { timeout: 200000, polling: 500 });
const count = await page.evaluate(() => window.__engine.count);
for (const [i, rem] of [[0, 60], [1, 6]]) {
  await page.evaluate((rem) => { const e = window.__engine; e.cur.dist = e.cur.path.length - rem; e.reveal = 1; }, rem);
  await page.waitForTimeout(2500); await page.screenshot({ path: `xr-check-${i}.png` });
}
const crossed = await page.waitForFunction((c) => window.__engine.count > c, count, { timeout: 60000 }).then(() => true, () => false);
await page.waitForTimeout(1500); await page.screenshot({ path: 'xr-check-2.png' });
await page.evaluate(() => window.__engine.xr.toggle()); await page.waitForTimeout(1500);
const flat = await page.evaluate(() => !window.__engine.xr.on && !window.__engine.renderer.xr.isPresenting);
await browser.close();
console.log({ crossed, flatAgain: flat, errors });
process.exit(crossed && flat && !errors.length ? 0 : 1);
