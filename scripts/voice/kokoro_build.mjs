// Builds Lyra's live Kokoro voice into dist/kokoro/ (DESIGN.md §21), for
// `npm run build -- --kokoro`. Never part of dist/artifact.html; the lead publishes these
// files next to the page (kokoro/<name>) when the live voice should be offered.
//   engine.js          page side (src/audio/kokoro_engine.js)
//   worker.js          onnxruntime-web + phonemizer + text pipeline (src/audio/kokoro_worker.js)
//   ort-wasm-simd-threaded.wasm   the onnxruntime WebAssembly runtime
//   model.partN        kokoro-v1.0.int8.onnx in parts of at most 14 MB
//   lyra.bin           Lyra's style vectors only (her blend from cast.json)
//   model.json         parts, sizes, her speed
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const PART_BYTES = 14 * 1000 * 1000;

function cacheDir() {
  if (process.env.HEARTHLIGHT_VOICE_CACHE) return process.env.HEARTHLIGHT_VOICE_CACHE;
  for (const c of [path.join(homedir(), '.cache/hearthlight-voice'), '/home/user/.cache/hearthlight-voice']) {
    if (existsSync(path.join(c, 'voices-v1.0.bin'))) return c;
  }
  return path.join(homedir(), '.cache/hearthlight-voice');
}

export async function buildKokoro({ root, out, speaker = 'lyra', log = console.log } = {}) {
  const cache = cacheDir();
  const model = process.env.HEARTHLIGHT_KOKORO_LIVE_MODEL || path.join(cache, 'kokoro-v1.0.int8.onnx');
  if (!existsSync(model)) throw new Error(`--kokoro needs ${model} (see scripts/voice/README.md)`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  for (const [entry, name] of [
    ['src/audio/kokoro_engine.js', 'engine.js'],
    ['src/audio/kokoro_worker.js', 'worker.js'],
  ]) {
    await build({
      entryPoints: [path.join(root, entry)],
      outfile: path.join(out, name),
      bundle: true,
      format: 'esm',
      target: ['es2020'],
      minify: true,
      legalComments: 'none',
      logLevel: 'warning',
      // onnxruntime-web's node-only branches
      external: ['fs', 'path', 'url', 'worker_threads', 'module', 'crypto', 'os'],
      define: { 'process.env.NODE_ENV': '"production"' },
    });
  }
  copyFileSync(path.join(root, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'), path.join(out, 'ort-wasm-simd-threaded.wasm'));
  // The bundled runtime may still ask for its loader module next to the wasm.
  const loader = path.join(root, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs');
  if (existsSync(loader)) copyFileSync(loader, path.join(out, 'ort-wasm-simd-threaded.mjs'));

  const bytes = readFileSync(model);
  const parts = [];
  for (let off = 0, i = 0; off < bytes.length; off += PART_BYTES, i++) {
    const name = `model.part${i}`;
    writeFileSync(path.join(out, name), bytes.subarray(off, Math.min(bytes.length, off + PART_BYTES)));
    parts.push(name);
  }
  const py = process.env.HEARTHLIGHT_VOICE_PY || path.join(cache, 'venv/bin/python');
  const styleFile = `${speaker}.bin`;
  const meta = JSON.parse(execFileSync(py, [path.join(root, 'scripts/voice/export_style.py'), speaker, path.join(out, styleFile)], { encoding: 'utf8' }).trim().split('\n').pop());
  const doc = {
    model: path.basename(model),
    size: bytes.length,
    parts,
    style: styleFile,
    styleBytes: statSync(path.join(out, styleFile)).size,
    speed: meta.speed,
    lang: meta.lang,
  };
  writeFileSync(path.join(out, 'model.json'), JSON.stringify(doc, null, 1));
  const total = [...parts, styleFile, 'engine.js', 'worker.js', 'ort-wasm-simd-threaded.wasm'].reduce((n, f) => n + statSync(path.join(out, f)).size, 0);
  log?.(`kokoro: ${parts.length} model parts + runtime -> ${out} (${(total / 1e6).toFixed(1)} MB, ${parts.length + 6} files)`);
  return doc;
}
