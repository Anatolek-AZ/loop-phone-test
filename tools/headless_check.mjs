// Headless Chrome checks for test 6: (1) seam rendered through Web Audio is gapless, (2) ?fast=1 fade -> silence -> stop.
// usage: node tools/headless_check.mjs <base-url>   (needs puppeteer-core; CHROME env or /usr/bin/google-chrome)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_PATH || '/tmp/tmole/node_modules/puppeteer-core');
const base = process.argv[2];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const page = await browser.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base + '?fast=1', { waitUntil: 'networkidle2' });
await page.waitForFunction(() => /files/.test(document.getElementById('sessionInfo').textContent), { timeout: 30000 });
const out = { sessions: [], fade: [] };
const nSess = await page.$$eval('#session option', (o) => o.length);
for (let i = 0; i < nSess; i++) {
  await page.select('#session', String(i));
  await page.waitForFunction((i) => session && sessions[i] && session.id === sessions[i].id && session.loop, { timeout: 30000 }, i);
  out.sessions.push(await page.evaluate(async () => {
    const sr = 48000, f = session.loop, meta = session.manifest.files[f.file];
    const ab = await (await fetch(url(f))).arrayBuffer();
    const dctx = new OfflineAudioContext(2, 1, sr);
    const res = {};
    for (const heal of [false, true]) {
      const buf = await dctx.decodeAudioData(ab.slice(0));
      const s = Math.round(meta.loop_start_s * sr), L = Math.round(meta.loop_len_s * sr);
      if (heal) healSeam(buf, s, L, Math.round(0.25 * sr));
      const oc = new OfflineAudioContext(2, 4 * sr, sr);
      const src = oc.createBufferSource(); src.buffer = buf; src.loop = true; src.loopStart = s / sr; src.loopEnd = (s + L) / sr;
      src.connect(oc.destination); src.start(0, (s + L) / sr - 2);
      const r = await oc.startRendering();
      const A = r.getChannelData(0), B = r.getChannelData(1), n = A.length, seamI = 2 * sr;
      const steps = new Float64Array(n - 1);
      for (let k = 0; k < n - 1; k++) steps[k] = Math.max(Math.abs(A[k + 1] - A[k]), Math.abs(B[k + 1] - B[k]));
      const sorted = Array.from(steps).sort((a, b) => a - b), p99 = sorted[Math.floor(0.99 * sorted.length)], mx = sorted[sorted.length - 1];
      // which rendered index has the seam? find the jump point by matching against the source buffer around seamI
      const seam = Math.max(...[-2, -1, 0, 1].map((d) => steps[seamI + d]));
      // after the seam the render must equal the buffer from loopStart (contiguous decoded samples)
      const S0 = buf.getChannelData(0); let maxDiff = 0;
      for (let k = 2; k < 4800; k++) maxDiff = Math.max(maxDiff, Math.abs(A[seamI + k] - S0[s + k]));
      const rms = (a, b) => { let x = 0; for (let k = a; k < b; k++) x += A[k] * A[k] + B[k] * B[k]; return 10 * Math.log10(x / (2 * (b - a)) + 1e-20); };
      let zeros = 0; for (let k = seamI - 4800; k < seamI + 4800; k++) if (A[k] === 0 && B[k] === 0) zeros++;
      res[heal ? 'healed' : 'raw'] = { decodedLen: buf.length, seamStep: +seam.toFixed(6), p99Step: +p99.toFixed(6), maxStep: +mx.toFixed(6),
        seamPercentile: +(100 * sorted.findIndex((v) => v >= seam) / sorted.length).toFixed(1),
        rmsBeforeAfter50ms_dB: +(rms(seamI - 2400, seamI) - rms(seamI, seamI + 2400)).toFixed(2), zeroSamplesNearSeam: zeros,
        postSeamMatchesLoopStart_maxAbsDiff: +maxDiff.toExponential(2) };
    }
    return { id: session.id, file: f.file, ...res };
  }));
}
// fast fade: slider 10 -> 10 s, fade 3 s (7..10 s)
for (const mode of ['silent', 'none', 'stream']) {
  await page.select('#session', '0');
  await page.$eval('#durSlider', (e) => { e.value = '10'; e.dispatchEvent(new Event('input')); });
  await page.select('#keepMode', mode);
  await page.click('#btnAnyStart');
  await page.waitForFunction(() => window.__any().any && !window.__any().any.ended && window.__any().gainNode, { timeout: 30000 });
  const trace = await page.evaluate(async () => {
    const { ac, gainNode, any } = window.__any(); const an = ac.createAnalyser(); an.fftSize = 2048; gainNode.connect(an);
    const d = new Float32Array(an.fftSize), pts = []; const w0 = performance.now();
    while (performance.now() - w0 < 12500) {
      an.getFloatTimeDomainData(d); let x = 0; for (const v of d) x += v * v;
      pts.push({ t: +(ac.currentTime - any.t0).toFixed(2), gain: +window.__any().gain.toFixed(3), rms_dB: +(10 * Math.log10(x / d.length + 1e-20)).toFixed(1), ended: any.ended });
      await new Promise((r) => setTimeout(r, 250));
    }
    return { pts, result: document.getElementById('anyResult').textContent, plan: document.getElementById('anyPlan').textContent };
  });
  const at = (t) => trace.pts.reduce((b, p) => (Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b));
  const endPt = trace.pts.find((p) => p.ended);
  out.fade.push({ mode, plan: trace.plan, result: trace.result,
    t3: at(3), t6_5: at(6.5), t8_5: at(8.5), t10_5: at(10.5), t12: at(12), firstEndedAt: endPt ? endPt.t : null,
    PASS: at(6.5).gain > 0.99 && at(8.5).gain > 0.2 && at(8.5).gain < 0.8 && at(10.5).gain === 0 && at(12).rms_dB < -120 && at(6.5).rms_dB > -70 && !!endPt && endPt.t < 11.5 });
  await page.click('#btnAnyStop');
}
out.swState = await page.$eval('#swState', (e) => e.textContent);
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
await browser.close();
