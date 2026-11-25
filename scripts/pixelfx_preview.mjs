// Contact sheets of the game's pixelfx effects as Hearthlight sees them: from above, at
// the game's scale (16 px grass tiles, a 12x20 stand-in for our characters), aimed in
// several directions. The pixelfx method (render, look, fix) for the top-down variants.
//
//   node scripts/pixelfx_preview.mjs hit                       a catalog id (src/render/pixel_fx_catalog.js)
//   node scripts/pixelfx_preview.mjs --fx impacts/hit-spark    a vendored effect file
//   --opts '{"palette":[...]}'  --dirs 8  --frames 10  --zoom 3  --night  --out <dir>
//
// Rows are aim directions (right, down-right, down, ... for effects that take an angle),
// columns are moments; writes <out>/<id>.png (default screenshots/pixelfx-preview).
import { writeFile, mkdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createFrame, clearFrame, createFx } from '../src/vendor/pixelfx/core/fx.js';
import { effectBox } from '../src/render/pixel_fx.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};
const flag = (f) => argv.includes(f);
const out = opt('--out', path.join(root, 'screenshots/pixelfx-preview'));
const DIRS = Number(opt('--dirs', '4'));
const NF = Number(opt('--frames', '10'));
const ZOOM = Number(opt('--zoom', '3'));
const night = flag('--night');
const extra = JSON.parse(opt('--opts', '{}'));
const fxPath = opt('--fx', null);
const VALUED = new Set(['--opts', '--dirs', '--frames', '--zoom', '--out', '--fx', '--box', '--layer']);
const ids = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.has(argv[i - 1])));

// ------------------------------------------------------------------ the stand-in
// A 12x20 villager seen in 3/4 from above (head, shoulders, tunic, legs), feet at its bottom centre.
const BODY = [
  '....kkkk....',
  '...khhhhk...',
  '..khhhhhhk..',
  '..khssssk...',
  '..kseesek...',
  '..ksssssk...',
  '...kSSSk....',
  '..kttttttk..',
  '.kttTttTttk.',
  '.ksttTTttsk.',
  '.kstttttttsk',
  '..kttttttk..',
  '..kbbbbbbk..',
  '..kttttttk..',
  '..kppkkppk..',
  '..kppk.kppk.',
  '..kppk.kppk.',
  '..kppk.kppk.',
  '..koook.kook',
  '..kkkkk.kkkk',
];
const PAL = { k: 0x17121f, h: 0x7a4128, s: 0xf3c49d, S: 0xc98b6c, e: 0x17121f, t: 0x5f6f94, T: 0x46536f, b: 0x8a5a32, p: 0x38334a, o: 0x6a4030 };
const rgbOf = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
function standInActor() {
  const h = BODY.length;
  const w = BODY[0].length;
  const data = new Uint8Array(w * h);
  const pixels = new Uint32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ch = BODY[y][x];
      if (ch === '.') continue;
      data[y * w + x] = 1;
      const [r, g, b] = rgbOf(PAL[ch]);
      pixels[y * w + x] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
  const x = -Math.floor(w / 2);
  const y = -h;
  return { mask: { w, h, data }, pixels, x, y, w, h, k: 1, head: [0, y], chest: [0, y + 9] };
}
const ACTOR = standInActor();

// ------------------------------------------------------------------ png
function crc32(buf) {
  let c;
  const t = crc32.t || (crc32.t = Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function png(w, h, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy ? rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4) : raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ------------------------------------------------------------------ the ground
function ground(w, h, ox, oy) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const wx = x + ox;
      const wy = y + oy;
      const tile = ((Math.floor(wx / 16) + Math.floor(wy / 16)) & 1) === 0;
      const n = ((wx * 73856093) ^ (wy * 19349663)) >>> 0;
      let r = tile ? 74 : 68;
      let g = tile ? 120 : 112;
      let b = tile ? 66 : 60;
      if (n % 17 === 0) (r += 14), (g += 18), (b += 8);
      else if (n % 23 === 0) (r -= 10), (g -= 12), (b -= 8);
      if (night) (r *= 0.32), (g *= 0.34), (b *= 0.5);
      const i = (y * w + x) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  return out;
}

function drawActor(rgba, w, h, ax, ay, dark) {
  const m = ACTOR.mask;
  // a soft shadow under the feet
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -6; dx <= 6; dx++) {
      if ((dx * dx) / 36 + (dy * dy) / 4 > 1) continue;
      const x = ax + dx;
      const y = ay + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = (y * w + x) * 4;
      rgba[i] *= 0.6;
      rgba[i + 1] *= 0.6;
      rgba[i + 2] *= 0.6;
    }
  for (let my = 0; my < m.h; my++)
    for (let mx = 0; mx < m.w; mx++) {
      if (!m.data[my * m.w + mx]) continue;
      const x = ax + ACTOR.x + mx;
      const y = ay + ACTOR.y + my;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const c = ACTOR.pixels[my * m.w + mx];
      const i = (y * w + x) * 4;
      rgba[i] = (c & 255) * dark;
      rgba[i + 1] = ((c >>> 8) & 255) * dark;
      rgba[i + 2] = ((c >>> 16) & 255) * dark;
    }
}

// color over what is there, then light added
function over(rgba, fr, lightK) {
  const n = fr.w * fr.h;
  for (let i = 0; i < n; i++) {
    const c = fr.color[i];
    const j = i * 4;
    if (c) {
      const a = (c >>> 24) / 255;
      rgba[j] = (c & 255) * a + rgba[j] * (1 - a);
      rgba[j + 1] = ((c >>> 8) & 255) * a + rgba[j + 1] * (1 - a);
      rgba[j + 2] = ((c >>> 16) & 255) * a + rgba[j + 2] * (1 - a);
    }
    const l = fr.light[i];
    if (l) {
      rgba[j] += (l & 255) * lightK;
      rgba[j + 1] += ((l >>> 8) & 255) * lightK;
      rgba[j + 2] += ((l >>> 16) & 255) * lightK;
    }
  }
}

// ------------------------------------------------------------------ one effect
async function load() {
  if (fxPath) {
    const mod = await import(pathToFileURL(path.join(root, 'src/vendor/pixelfx/fx', `${fxPath}.js`)).href);
    const box = opt('--box', null);
    return [{ id: fxPath.replace('/', '-'), spec: { mod, layer: opt('--layer', 'top'), opts: {}, bounds: box ? box.split(',').map(Number) : undefined, rotates: false } }];
  }
  const { PIXEL_FX } = await import(pathToFileURL(path.join(root, 'src/render/pixel_fx_catalog.js')).href);
  const list = ids.length ? ids : Object.keys(PIXEL_FX);
  return list.filter((id) => PIXEL_FX[id]).map((id) => ({ id, spec: PIXEL_FX[id] }));
}

function sheet({ id, spec }) {
  const meta = spec.mod.meta || {};
  const D = meta.loop ? meta.duration : meta.duration;
  const dirs = spec.aims === false ? [0] : Array.from({ length: DIRS }, (_, i) => (i / DIRS) * Math.PI * 2);
  const box = effectBox(spec, dirs.length > 1 ? 1 : 0, spec.scale ?? 1);
  const pad = 6;
  const W = box[2] - box[0] + pad * 2;
  const H = box[3] - box[1] + pad * 2;
  const AX = -box[0] + pad;
  const AY = -box[1] + pad;
  const times = Array.from({ length: NF }, (_, i) => (i / (NF - 1 || 1)) * D * (meta.loop ? 0.999 : 0.98));
  const cols = times.length;
  const SW = cols * (W * ZOOM + 4);
  const SH = dirs.length * (H * ZOOM + 4);
  const sheetPx = new Uint8ClampedArray(SW * SH * 4);
  const dark = night ? 0.45 : 1;
  for (let r = 0; r < dirs.length; r++) {
    const aim = dirs[r];
    const opts = { ...(spec.opts || {}), ...extra, seed: (spec.opts?.seed ?? 1) + r };
    if (spec.aims !== false) {
      if (spec.rotates) opts.angle = aim;
      else (opts.aim = aim), (opts.heading = aim);
    }
    if (spec.mod.meta?.actor) opts.actor = ACTOR;
    if (typeof spec.prepare === 'function') spec.prepare(opts, { ...opts, x: AX, y: AY }, null);
    const fx = createFx(spec.mod, { ...opts, x: AX, y: AY });
    const fr = createFrame(W, H, 0, 0);
    let t = 0;
    for (let c = 0; c < cols; c++) {
      while (t < times[c] - 1e-6) {
        const dt = Math.min(1 / 60, times[c] - t);
        fx.update(dt);
        t += dt;
      }
      const img = ground(W, H, 0, 0);
      clearFrame(fr);
      const L = spec.layer;
      if (L === 'body') {
        fx.draw(fr, 'back');
        over(img, fr, night ? 1 : 0.8);
        clearFrame(fr);
        drawActor(img, W, H, AX, AY, dark);
        fx.draw(fr, 'front');
        over(img, fr, night ? 1 : 0.8);
      } else {
        if (L !== 'ground') drawActor(img, W, H, AX, AY, dark);
        fx.draw(fr);
        over(img, fr, night ? 1 : 0.8);
        if (L === 'ground') {
          drawActor(img, W, H, AX, AY, dark);
        }
      }
      // paste, zoomed
      const x0 = c * (W * ZOOM + 4);
      const y0 = r * (H * ZOOM + 4);
      for (let y = 0; y < H * ZOOM; y++)
        for (let x = 0; x < W * ZOOM; x++) {
          const si = (Math.floor(y / ZOOM) * W + Math.floor(x / ZOOM)) * 4;
          const di = ((y0 + y) * SW + x0 + x) * 4;
          sheetPx[di] = img[si];
          sheetPx[di + 1] = img[si + 1];
          sheetPx[di + 2] = img[si + 2];
          sheetPx[di + 3] = 255;
        }
    }
  }
  return png(SW, SH, Buffer.from(sheetPx.buffer));
}

await mkdir(out, { recursive: true });
for (const e of await load()) {
  const file = path.join(out, `${e.id}${night ? '-night' : ''}.png`);
  await writeFile(file, sheet(e));
  console.log(`${e.id} -> ${file}`);
}
