// A relative survey of what each world asks of a headset's GPU (docs/VR_PERFORMANCE.md): headless Chrome with a software
// renderer draws each world at three points of its flight. pixel = draw time at 960x540 minus at 48x27 (per-pixel work, which
// the headset's resolution governor can cut to about a fifth); vertex = draw time at 48x27 (which it cannot). Also draws,
// triangles and transparent / alpha-tested / additive materials. One JSON line per world; a re-run resumes.
// Needs playwright-core (npm i --no-save playwright-core) and Chrome, with "npm start" running on port 8010 or URL set:
//   [URL=http://localhost:8010/] [OUT=vr-survey.jsonl] [ONLY=id,id] node tools/vr-survey.mjs [workers=4]
// then rank:  node tools/vr-survey.mjs rank   (score = vertex + pixel / 4: the work the governor cannot remove counts in full)
// Times from parallel workers run 1.5 to 2 times those of a single one; the order is what counts.
import { chromium } from 'playwright-core';
import fs from 'fs';
const OUT = process.env.OUT || 'vr-survey.jsonl', URL = process.env.URL || 'http://localhost:8010/', N = +(process.argv[2] || 4);
const src = fs.readFileSync(new globalThis.URL('../src/worlds/index.js', import.meta.url), 'utf8');
const ids = [...src.matchAll(/\{ id: "([^"]+)"/g)].map((m) => m[1]).filter((id) => !id.startsWith('_'));
if (process.argv[2] === 'rank') {
  const names = Object.fromEntries([...src.matchAll(/\{ id: "([^"]+)", name: "([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const rows = fs.readFileSync(OUT, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.samples).map((r) => {
    const mx = (k) => Math.max(...r.samples.map((s) => s[k])), pixel = mx('frag'), vertex = mx('vert');
    return { id: r.id, name: names[r.id], score: Math.round(vertex + pixel / 4), pixel, vertex, draws: mx('calls'), tris: mx('tris'), transparent: mx('transp'), discard: mx('discard') };
  }).sort((a, b) => b.score - a.score);
  console.table(rows); process.exit(0);
}
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);
const only = process.env.ONLY ? process.env.ONLY.split(',') : null; const queue = (only || ids).filter((id) => !done.has(id));
console.log('worlds', ids.length, 'to do', queue.length);
const measure = async (u) => {
  const e = window.__engine, A = e.cur; A.dist = u * A.path.length; e.settings.paused = false;
  await new Promise((r) => setTimeout(r, 1200)); e.settings.paused = true; await new Promise((r) => setTimeout(r, 200));
  const r = e.renderer, px = new Float32Array(4), was = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false;
  const L = window.__L || (window.__L = new e.xr.rt.constructor(960, 540, { type: 1015 })), S = window.__S || (window.__S = new e.xr.rt.constructor(48, 27, { type: 1015 }));
  const t1 = (rt) => { let best = 1e9; for (let k = 0; k < 2; k++) { const t = performance.now(); r.setRenderTarget(rt); r.render(A.scene, e.camera); r.readRenderTargetPixels(rt, 0, 0, 1, 1, px); best = Math.min(best, performance.now() - t); } return best; };
  const s = t1(S); r.info.reset(); const l = t1(L); const calls = r.info.render.calls / 2, tris = r.info.render.triangles / 2;
  r.setRenderTarget(null); r.shadowMap.autoUpdate = was;
  let transp = 0, discard = 0, add = 0, objs = 0, shadowCasters = 0; const mats = new Set();
  A.scene.traverseVisible((o) => { if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return; objs++; const ms = Array.isArray(o.material) ? o.material : [o.material];
    if (o.castShadow) shadowCasters++;
    for (const m of ms) { if (!m) continue; mats.add(m); if (m.transparent) transp++; if (m.blending === 2) add++; if (m.alphaTest > 0 || /discard/.test(m.fragmentShader || '')) discard++; } });
  const lights = []; A.scene.traverse((o) => { if (o.isLight && o.castShadow) lights.push(o.type); });
  return { u, frag: +(l - s).toFixed(1), vert: +s.toFixed(1), calls, tris, objs, mats: mats.size, transp, discard, add, shadowCasters, shadowLights: lights.length };
};
async function worker(w) {
  let browser = null, n = 0;
  while (queue.length) {
    const id = queue.shift();
    if (!browser || n++ % 15 === 0) { if (browser) await browser.close().catch(() => {}); browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] }); }
    const page = await browser.newPage({ viewport: { width: 480, height: 270 } }); const errs = [];
    page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
    const t0 = Date.now(); let rec = { id };
    try {
      await page.goto(`${URL}?world=${id}&ante=0&quality=medium&hud=0`);
      await page.waitForFunction((id) => window.__engine?.cur?.world && window.__engine.cur.def.id === id, id, { timeout: 150000, polling: 500 });
      rec.build = +((Date.now() - t0) / 1000).toFixed(1);
      rec.samples = [];
      for (const u of [0.15, 0.5, 0.85]) rec.samples.push(await page.evaluate(measure, u));
      const st = await page.evaluate(() => ({ gpu: window.__engine.renderer.info.programs?.length, mem: window.__engine.renderer.info.memory }));
      rec.programs = st.gpu; rec.geoms = st.mem.geometries; rec.textures = st.mem.textures;
    } catch (e) { rec.error = e.message.slice(0, 200); }
    rec.errs = [...new Set(errs)].slice(0, 3);
    fs.appendFileSync(OUT, JSON.stringify(rec) + '\n');
    console.log(w, id, rec.error ? 'ERR ' + rec.error.slice(0, 60) : rec.samples.map((s) => s.frag).join('/'), queue.length, 'left');
    await page.close().catch(() => {});
  }
  if (browser) await browser.close().catch(() => {});
}
await Promise.all(Array.from({ length: N }, (_, i) => worker(i)));
console.log('done');
