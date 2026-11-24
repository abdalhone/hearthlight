// Packs the rendered clips for publishing (DESIGN.md §21). A claude.ai Artifact holds at
// most a few hundred files, and thousands of lines would not fit as one file each, so
// clips are concatenated into packs of about 256 KB (each clip stays a complete MP3 that
// decodes on its own; the game slices it out by byte range). Clips of one speaker that
// come from the same kind of line share packs, so a pack fetched for one greeting brings
// that villager's other greetings with it.
//
//   import { packVoices } from './voice/pack.mjs'
//   await packVoices({ src: 'assets/voice', out: 'dist/voice', lines: 'scripts/voice/lines.json' })
//
// dist/voice/manifest.json: { format, packs: [file], clips: { key: [pack, offset, length, seconds, speaker] } }

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const PACK_FORMAT = 'hearthlight-voice/1';

export function planPacks(entries, target = 256 * 1024) {
  // entries: [{ key, speaker, size, group }] in the order they should sit
  const packs = [];
  let cur = null;
  for (const e of entries) {
    if (!cur || cur.speaker !== e.speaker || (cur.size + e.size > target && cur.keys.length)) {
      cur = { speaker: e.speaker, size: 0, keys: [], n: packs.filter((p) => p.speaker === e.speaker).length };
      packs.push(cur);
    }
    cur.keys.push(e.key);
    cur.size += e.size;
  }
  return packs;
}

export async function packVoices({ src, out, lines = null, target = 256 * 1024, loose = false, log = console.log } = {}) {
  const manifestPath = path.join(src, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const order = new Map(); // key -> sort group (source of the line)
  if (lines && existsSync(lines)) {
    for (const l of JSON.parse(readFileSync(lines, 'utf8')).lines || []) order.set(l.key, String(l.src || ''));
  }
  const entries = [];
  for (const [key, m] of Object.entries(manifest)) {
    const file = path.join(src, `${key}.mp3`);
    if (!existsSync(file)) continue;
    entries.push({ key, speaker: m.speaker, dur: m.dur, file, size: readFileSync(file).length, group: order.get(key) || '~' });
  }
  entries.sort((a, b) => (a.speaker < b.speaker ? -1 : a.speaker > b.speaker ? 1 : a.group < b.group ? -1 : a.group > b.group ? 1 : a.key < b.key ? -1 : 1));

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  let bytes = 0;
  if (loose) {
    const clean = {};
    for (const e of entries) {
      const buf = readFileSync(e.file);
      writeFileSync(path.join(out, `${e.key}.mp3`), buf);
      clean[e.key] = { speaker: e.speaker, dur: e.dur };
      bytes += buf.length;
    }
    writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(clean));
    log?.(`voices: ${entries.length} clips copied to ${out} (${(bytes / 1e6).toFixed(1)} MB)`);
    return { clips: entries.length, files: entries.length + 1, bytes };
  }
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const plan = planPacks(entries, target);
  const doc = { format: PACK_FORMAT, packs: [], clips: {} };
  plan.forEach((p, i) => {
    const name = `${p.speaker}-${p.n}.mp3`;
    const parts = [];
    let off = 0;
    for (const key of p.keys) {
      const e = byKey.get(key);
      const buf = readFileSync(e.file);
      doc.clips[key] = [i, off, buf.length, e.dur, e.speaker];
      parts.push(buf);
      off += buf.length;
    }
    writeFileSync(path.join(out, name), Buffer.concat(parts));
    doc.packs.push(name);
    bytes += off;
  });
  writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(doc));
  log?.(`voices: ${entries.length} clips in ${plan.length} packs -> ${out} (${(bytes / 1e6).toFixed(1)} MB, ${plan.length + 1} files)`);
  return { clips: entries.length, files: plan.length + 1, bytes };
}

export function listFiles(dir) {
  return existsSync(dir) ? readdirSync(dir) : [];
}
