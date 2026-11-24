// Packs the rendered cutscene clips for publishing (DESIGN.md §21). Clips sit in story
// order, a scene's clips together, concatenated into packs of about 200 KB (each clip stays
// a complete MP3 that decodes on its own; the game slices it out by byte range), so the
// pack fetched for a scene's first line brings the next lines with it.
//
//   import { packVoices } from './voice/pack.mjs'
//   await packVoices({ src: 'assets/voice', out: 'dist/voice' })
//
// dist/voice/manifest.json:
//   { format, packs: [file], clips: { key: [pack, offset, length, seconds, words] } }
//   words: [[word, start, end], …] (seconds into the clip) — the captions follow them.

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

export const PACK_FORMAT = 'hearthlight-cutscene-voice/1';

// entries: [{ key, script, size }] in story order -> [{ script, n, keys, size }]
export function planPacks(entries, target = 200 * 1024) {
  const packs = [];
  let cur = null;
  for (const e of entries) {
    if (!cur || cur.script !== e.script || (cur.size + e.size > target && cur.keys.length)) {
      cur = { script: e.script, size: 0, keys: [], n: packs.filter((p) => p.script === e.script).length };
      packs.push(cur);
    }
    cur.keys.push(e.key);
    cur.size += e.size;
  }
  return packs;
}

export async function packVoices({ src, out, target = 200 * 1024, loose = false, log = console.log } = {}) {
  const manifestPath = path.join(src, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  const doc = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const clips = doc && typeof doc.clips === 'object' ? doc.clips : {};
  const entries = [];
  for (const [key, m] of Object.entries(clips)) {
    const file = path.join(src, m.file || `${key}.mp3`);
    if (!existsSync(file)) continue;
    entries.push({ key, script: String(m.script || 'scene').replace(/[^a-z0-9_]+/gi, '_'), order: Number(m.order) || 0, dur: Number(m.dur) || 0, words: m.words || [], file, size: readFileSync(file).length });
  }
  entries.sort((a, b) => a.order - b.order || (a.key < b.key ? -1 : 1));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  let bytes = 0;
  if (loose) {
    const clean = { format: PACK_FORMAT, clips: {} };
    for (const e of entries) {
      const buf = readFileSync(e.file);
      writeFileSync(path.join(out, `${e.key}.mp3`), buf);
      clean.clips[e.key] = { file: `${e.key}.mp3`, dur: e.dur, words: e.words };
      bytes += buf.length;
    }
    writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(clean));
    log?.(`voices: ${entries.length} cutscene clips copied to ${out} (${(bytes / 1e6).toFixed(1)} MB)`);
    return { clips: entries.length, files: entries.length + 1, bytes };
  }
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const plan = planPacks(entries, target);
  const res = { format: PACK_FORMAT, packs: [], clips: {} };
  plan.forEach((p, i) => {
    const name = `${p.script}-${p.n}.mp3`;
    const parts = [];
    let off = 0;
    for (const key of p.keys) {
      const e = byKey.get(key);
      const buf = readFileSync(e.file);
      res.clips[key] = [i, off, buf.length, e.dur, e.words];
      parts.push(buf);
      off += buf.length;
    }
    writeFileSync(path.join(out, name), Buffer.concat(parts));
    res.packs.push(name);
    bytes += off;
  });
  writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(res));
  log?.(`voices: ${entries.length} cutscene clips in ${plan.length} packs -> ${out} (${(bytes / 1e6).toFixed(1)} MB, ${plan.length + 1} files)`);
  return { clips: entries.length, files: plan.length + 1, bytes };
}
