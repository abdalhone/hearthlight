#!/usr/bin/env node
// Measures Lyra's live Kokoro voice in headless Chromium (DESIGN.md §21): cold and warm
// load, time to her first words and real-time factor for a 12-word line, through the real
// worker; then the same synthesis on the main thread with CPU throttling (x1, x4) to
// approximate a phone, since throttling reaches the page and not its workers. Also writes
// the synthesized samples so scripts/voice/kokoro_compare.py can check them against
// kokoro-onnx. Needs `npm run build -- --kokoro` first.
//
//   node scripts/voice/kokoro_bench.mjs [--isolated] [--out DIR]
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import http from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const isolated = args.includes('--isolated');
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(tmpdir(), 'hearthlight-kokoro-bench');
const LINE = "Wicks and ashes, you walked right past the lamp again, didn't you?"; // 12 words

await mkdir(outDir, { recursive: true });
await build({
  entryPoints: [path.join(ROOT, 'src/audio/kokoro_core.js')],
  outfile: path.join(outDir, 'core.js'),
  bundle: true,
  format: 'esm',
  minify: true,
  logLevel: 'warning',
  external: ['fs', 'path', 'url', 'worker_threads', 'module', 'crypto', 'os'],
});
await writeFile(path.join(outDir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>bench</title><body>bench</body>');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = http.createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = p.startsWith('/kokoro/') ? path.join(ROOT, 'dist', p) : path.join(outDir, p.replace(/^\/bench\//, '/'));
    const s = await stat(file);
    if (!s.isFile()) throw new Error('nf');
    const headers = { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' };
    if (isolated) Object.assign(headers, { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' });
    res.writeHead(200, headers);
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
const results = { line: LINE, words: LINE.split(/\s+/).length, isolated };

async function viaWorker(label) {
  await page.goto(`${base}/bench/index.html`);
  const r = await page.evaluate(
    async ({ base, line }) => {
      const t0 = performance.now();
      const { loadKokoro } = await import(`${base}/kokoro/engine.js`);
      const engine = await loadKokoro({ base: `${base}/kokoro/` });
      const loadMs = performance.now() - t0;
      const runs = [];
      let samples = null;
      for (let i = 0; i < 3; i++) {
        const s = performance.now();
        let first = null;
        let n = 0;
        const parts = [];
        for await (const chunk of engine.stream(line)) {
          if (first == null) first = performance.now() - s;
          n += chunk.length;
          parts.push(chunk);
        }
        const total = performance.now() - s;
        runs.push({ firstMs: Math.round(first), totalMs: Math.round(total), audioS: +(n / 24000).toFixed(2), rtf: +(total / 1000 / (n / 24000)).toFixed(3) });
        if (!samples) {
          samples = new Float32Array(n);
          let o = 0;
          for (const p of parts) samples.set(p, (o += p.length) - p.length);
        }
      }
      engine.dispose();
      return { loadMs: Math.round(loadMs), info: engine.info, runs, samples: Array.from(samples) };
    },
    { base, line: LINE },
  );
  await writeFile(path.join(outDir, `${label}.f32`), Buffer.from(new Float32Array(r.samples).buffer));
  delete r.samples;
  results[label] = r;
  console.log(label, JSON.stringify(r));
}

async function onMainThread(label, rate) {
  await page.goto(`${base}/bench/index.html`);
  const cdp = await context.newCDPSession(page);
  const r = await page.evaluate(
    async ({ base }) => {
      const core = await import(`${base}/bench/core.js`);
      const t0 = performance.now();
      await core.load(`${base}/kokoro/`);
      return { loadMs: Math.round(performance.now() - t0) };
    },
    { base },
  );
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const runs = await page.evaluate(
    async ({ base, line }) => {
      const core = await import(`${base}/bench/core.js`);
      const out = [];
      for (let i = 0; i < 2; i++) {
        const s = performance.now();
        let first = null;
        let n = 0;
        await core.synth(line, core.defaultSpeed(), (a) => {
          if (first == null) first = performance.now() - s;
          n += a.length;
        });
        const total = performance.now() - s;
        out.push({ firstMs: Math.round(first), totalMs: Math.round(total), audioS: +(n / 24000).toFixed(2), rtf: +(total / 1000 / (n / 24000)).toFixed(3) });
      }
      return out;
    },
    { base, line: LINE },
  );
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  results[label] = { warmLoadMs: r.loadMs, runs };
  console.log(label, JSON.stringify(results[label]));
}

await viaWorker('worker_cold');
await viaWorker('worker_warm'); // Cache Storage now holds the model
await onMainThread('main_x1', 1);
await onMainThread('main_x4', 4);
await browser.close();
server.close();
await writeFile(path.join(outDir, 'results.json'), JSON.stringify(results, null, 1));
console.log(`results and samples in ${outDir}`);
