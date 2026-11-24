// Lyra's live Kokoro voice: the synthesis core (DESIGN.md §21). Runs inside the worker
// (src/audio/kokoro_worker.js); kept separate so benchmarks can run it on a page's main
// thread, where CPU throttling applies. Built only with `npm run build -- --kokoro`.

import * as ort from 'onnxruntime-web/wasm';
import { phonemize as espeak } from 'phonemizer';
import { phonemize, tokenize, splitSentences, styleFor, MAX_TOKENS } from './kokoro_text.js';

const CACHE = 'hearthlight-kokoro-v1';
let session = null;
let styles = null;
let meta = null;

// One file, from Cache Storage when we have it, else the network (then cached).
async function cachedBytes(url, onBytes) {
  let cache = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) {
      const buf = await hit.arrayBuffer();
      onBytes(buf.byteLength);
      return buf;
    }
  } catch {
    cache = null; // Cache Storage blocked (private mode): download every visit
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url.split('/').pop()}`);
  const reader = res.body?.getReader?.();
  let buf;
  if (reader) {
    const parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      n += value.length;
      onBytes(value.length);
    }
    const all = new Uint8Array(n);
    let o = 0;
    for (const p of parts) {
      all.set(p, o);
      o += p.length;
    }
    buf = all.buffer;
  } else {
    buf = await res.arrayBuffer();
    onBytes(buf.byteLength);
  }
  try {
    await cache?.put(url, new Response(buf.slice(0)));
  } catch {
    /* quota: fine, it downloads again next time */
  }
  return buf;
}

export function defaultSpeed() {
  return meta?.speed || 1;
}

export async function load(base, onProgress = () => {}, { threads } = {}) {
  const t0 = performance.now();
  meta = await (await fetch(new URL('model.json', base))).json();
  const total = meta.size + meta.styleBytes + (meta.runtimeBytes || 0);
  let got = 0;
  const tick = (n) => {
    got += n;
    onProgress(Math.min(0.99, got / total), `${Math.round(got / 1e6)} of ${Math.round(total / 1e6)} MB`);
  };
  const model = new Uint8Array(meta.size);
  let off = 0;
  for (const part of meta.parts) {
    const b = new Uint8Array(await cachedBytes(new URL(part, base).href, tick));
    model.set(b, off);
    off += b.length;
  }
  if (off !== meta.size) throw new Error('model parts are incomplete');
  styles = new Float32Array(await cachedBytes(new URL(meta.style, base).href, tick));
  // The runtime too comes through Cache Storage, and as bytes: no streaming compile that
  // depends on the host's MIME type for .wasm.
  if (meta.runtime) ort.env.wasm.wasmBinary = await cachedBytes(new URL(meta.runtime, base).href, tick);
  const tFetch = performance.now();
  ort.env.wasm.wasmPaths = base;
  // Threads need SharedArrayBuffer, which only a cross-origin-isolated page has.
  ort.env.wasm.numThreads = threads || (self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1);
  ort.env.wasm.proxy = false;
  session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  // A first run warms the kernels so her first real line is not the slow one; the second
  // measures how fast this device is (seconds of work per second of speech).
  await synth('Hello.', meta.speed || 1, () => {});
  const tWarm = performance.now();
  let samples = 0;
  await synth('Mind the lamps on the way home tonight.', meta.speed || 1, (a) => (samples += a.length));
  const rtf = (performance.now() - tWarm) / 1000 / Math.max(0.1, samples / 24000);
  const info = {
    fetchMs: Math.round(tFetch - t0),
    initMs: Math.round(tWarm - tFetch),
    threads: ort.env.wasm.numThreads,
    isolated: !!self.crossOriginIsolated,
    rtf: Math.round(rtf * 1000) / 1000,
  };
  onProgress(1, 'ready');
  return info;
}

// Trim the silence Kokoro leaves at both ends (as kokoro-onnx does per batch).
function trimSilence(a, sr = 24000) {
  const frame = 240;
  let peak = 0;
  for (let i = 0; i < a.length; i++) peak = Math.max(peak, Math.abs(a[i]));
  const thr = peak * 0.02;
  let s = 0;
  let e = a.length;
  while (s < e - frame && maxAbs(a, s, s + frame) < thr) s += frame;
  while (e > s + frame && maxAbs(a, e - frame, e) < thr) e -= frame;
  s = Math.max(0, s - Math.round(0.02 * sr));
  e = Math.min(a.length, e + Math.round(0.08 * sr));
  return a.slice(s, e);
}

function maxAbs(a, s, e) {
  let m = 0;
  for (let i = s; i < e; i++) m = Math.max(m, Math.abs(a[i]));
  return m;
}

// Roughly her clips' loudness (-16 LUFS is about -19 dBFS RMS for speech), peaks kept down.
function level(a) {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * a[i];
    peak = Math.max(peak, Math.abs(a[i]));
  }
  const rms = Math.sqrt(sum / Math.max(1, a.length));
  if (!(rms > 1e-5)) return a;
  const g = Math.min(0.112 / rms, 0.89 / Math.max(peak, 1e-5));
  for (let i = 0; i < a.length; i++) a[i] *= g;
  return a;
}

async function runOnce(tokens, speed) {
  const ids = new BigInt64Array(tokens.length + 2);
  for (let i = 0; i < tokens.length; i++) ids[i + 1] = BigInt(tokens[i]);
  const feeds = {
    tokens: new ort.Tensor('int64', ids, [1, ids.length]),
    style: new ort.Tensor('float32', styleFor(styles, tokens.length).slice(), [1, 256]),
    speed: new ort.Tensor('float32', new Float32Array([speed]), [1]),
  };
  const out = await session.run(feeds);
  return out.audio.data;
}

export async function synth(text, speed, onChunk, isCancelled = () => false) {
  for (const sentence of splitSentences(text, { firstClause: true })) {
    if (isCancelled()) return;
    const t = performance.now();
    const ph = await phonemize(sentence, espeak, 'en-us');
    let tokens = tokenize(ph);
    if (!tokens.length) continue;
    if (tokens.length > MAX_TOKENS) tokens = tokens.slice(0, MAX_TOKENS);
    const audio = level(trimSilence(await runOnce(tokens, speed)));
    // a breath between sentences
    const gap = new Float32Array(Math.round(24000 * 0.22));
    const out = new Float32Array(audio.length + gap.length);
    out.set(audio, 0);
    onChunk(out, performance.now() - t);
  }
}
