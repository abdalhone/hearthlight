import { TILE } from '../core/constants.js';
import { T, DECO } from '../world/tiles.js';
import { PixelBuf, rgb, mixc, shade, tileNoise, bayer, ih, R, G, B, pack } from './world_pixbuf.js';
import { buildTextures, lut } from './world_textures.js';
import { buildDecos } from './world_decos.js';
import { paintFacadeTile, paintBuildingWallTile } from './world_buildings.js';

// The ground of Hearthvale, painted per 16×16-tile chunk into cached canvases.
//
// How a chunk is painted (all in typed arrays, no canvas calls until the end):
//  1. Material field: soft terrains (grass, dirt, sand, water...) are domain-warped
//     by a smooth noise field, so their borders curve organically instead of
//     following the tile grid. Built surfaces (walls, floors, bridges) stay crisp.
//  2. Shading: each soft pixel samples its tileable texture, is lit by a cheap
//     emboss on the material heights (grass banks over paths, cobbles under grass,
//     contact shadows under walls), and tinted by low-frequency noise.
//  3. Water is left translucent: the animated water pattern is drawn underneath each
//     frame, and the chunk adds depth (light shallows, dark deeps), sky glints and
//     the dark mirror of the banks. Shore foam lives in two small layers the map
//     pulses in counter-phase.
//  4. Built tiles, ground decorations, then soft object shadows.
// A second, wet version of a chunk (rain) is painted on demand and crossfaded in.

export const CHUNK = 16;
const CPX = CHUNK * TILE; // 256
const MG = 8; // margin around the chunk for neighbour lookups
const SW = CPX + MG * 2;

const SOFT = new Uint8Array(64);
const HEIGHT = new Float32Array(64);
const AMP = new Float32Array(64);
const TALLM = new Uint8Array(64);
const TEXKEY = [];
const isWater = (m) => m === T.WATER || m === T.DEEP_WATER;
(() => {
  const soft = {
    [T.GRASS]: ['grass', 4, 1],
    [T.TALL_GRASS]: ['tallgrass', 5, 1],
    [T.FOREST]: ['forest', 4.2, 1],
    [T.DIRT]: ['dirt', 2, 0.8],
    [T.SAND]: ['sand', 2, 1],
    [T.GRAVEL]: ['gravel', 2, 0.8],
    [T.COBBLE]: ['cobble', 3, 0.3],
    [T.FARMLAND]: ['farmland', 2.5, 0.25],
    [T.RUIN_FLOOR]: ['ruinfloor', 3, 0.5],
    [T.WATER]: [null, 0, 1],
    [T.DEEP_WATER]: [null, 0, 1],
  };
  for (const [id, [key, h, amp]] of Object.entries(soft)) {
    SOFT[id] = 1;
    HEIGHT[id] = h;
    AMP[id] = amp;
    TEXKEY[id] = key;
  }
  for (const id of [T.WALL, T.RUIN_WALL, T.ROCK, T.PALISADE]) {
    HEIGHT[id] = 9;
    TALLM[id] = 1;
  }
  HEIGHT[T.RUBBLE] = 6;
  HEIGHT[T.BRIDGE] = 3;
  HEIGHT[T.DOCK] = 3;
  HEIGHT[T.FLOWERBED] = 4;
  HEIGHT[T.FLOOR] = 3;
  HEIGHT[T.STONE_FLOOR] = 3;
  HEIGHT[T.RUG] = 3;
})();

// ---------------------------------------------------------------------------
// Water

const WATER_FRAMES = 12;
const WATER_LUT = lut(['#173257', '#1f4675', '#285d93', '#3274ab', '#4a8fc2', '#73b2da', '#b5ddf2', '#eef9ff']);

// Seamless 64×64 animated water: gentle interfering swells plus twinkling ripple glints.
function buildWaterFrames(rng) {
  const S = 64;
  const n = tileNoise(S, 4, rng, 3);
  const ripples = Array.from({ length: 30 }, () => ({
    x: Math.floor(rng.next() * S),
    y: Math.floor(rng.next() * S),
    len: 2 + Math.floor(rng.next() * 5),
    p: rng.next() * Math.PI * 2,
    k: rng.next() < 0.5 ? 1 : 2,
  }));
  const glints = Array.from({ length: 9 }, () => ({ x: Math.floor(rng.next() * S), y: Math.floor(rng.next() * S), f: Math.floor(rng.next() * WATER_FRAMES) }));
  const frames = [];
  for (let f = 0; f < WATER_FRAMES; f++) {
    const ph = (f / WATER_FRAMES) * Math.PI * 2;
    const buf = new PixelBuf(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const w1 = Math.sin(((3 * x + 2 * y) / S) * Math.PI * 2 + ph);
        const w2 = Math.sin(((-2 * x + 5 * y) / S) * Math.PI * 2 + ph * 2);
        const w3 = Math.sin(((x - 3 * y) / S) * Math.PI * 4 - ph);
        let t = 0.42 + (n[y * S + x] - 0.5) * 0.16 + w1 * 0.045 + w2 * 0.03 + w3 * 0.02;
        // Crest lines where the swells meet catch the sky.
        if (w1 + w2 > 1.55) t += 0.1;
        t += (bayer(x, y) - 0.5) * 0.04;
        buf.data[y * S + x] = WATER_LUT[Math.max(0, Math.min(63, Math.round(t * 63)))];
      }
    }
    for (const r of ripples) {
      const b = Math.max(0, Math.sin(ph * r.k + r.p));
      if (b < 0.15) continue;
      const dx = Math.round(Math.sin(ph + r.p) * 1.5);
      for (let i = 0; i < r.len; i++) {
        const x = (r.x + dx + i + S) % S;
        const edge = i === 0 || i === r.len - 1 ? 0.45 : 1;
        const t = 0.62 + b * 0.36 * edge;
        buf.data[r.y * S + x] = WATER_LUT[Math.round(Math.min(1, t) * 63)];
        // A darker trough under each crest gives the ripple a little depth.
        buf.data[((r.y + 1) % S) * S + x] = WATER_LUT[Math.round(0.3 * 63)];
      }
    }
    for (const g of glints) {
      const age = (f - g.f + WATER_FRAMES) % WATER_FRAMES;
      if (age > 1) continue;
      const c = WATER_LUT[age === 0 ? 63 : 52];
      buf.data[g.y * S + g.x] = c;
      if (age === 0) {
        buf.data[g.y * S + ((g.x + 1) % S)] = WATER_LUT[50];
        buf.data[g.y * S + ((g.x + S - 1) % S)] = WATER_LUT[50];
      }
    }
    frames.push(buf);
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Registration

// Builds everything the chunk painter needs. Pure data except the water canvases,
// which are made only when `withCanvas` (the browser).
export function buildTileArt(rng, { withCanvas = true } = {}) {
  const N = 256;
  const wx = tileNoise(N, 8, rng.fork(1), 3);
  const wy = tileNoise(N, 8, rng.fork(2), 3);
  const warpX = new Int8Array(N * N);
  const warpY = new Int8Array(N * N);
  for (let i = 0; i < N * N; i++) {
    warpX[i] = Math.round((wx[i] - 0.5) * 15);
    warpY[i] = Math.round((wy[i] - 0.5) * 13);
  }
  const lf = tileNoise(128, 4, rng.fork(3), 3); // tint and variant fields, sampled at 1/4 px
  const lf2 = tileNoise(128, 8, rng.fork(4), 2);
  const sky = tileNoise(64, 4, rng.fork(5), 2); // cloud reflections on water, 1/8 px
  const streak = tileNoise(64, 8, rng.fork(6), 2); // wet gloss, stretched along x
  const puddle = tileNoise(64, 4, rng.fork(7), 3);
  const waterBufs = buildWaterFrames(rng.fork(8));
  return {
    tex: buildTextures(rng.fork(9)),
    decos: buildDecos(rng.fork(10)),
    warpX,
    warpY,
    lf,
    lf2,
    sky,
    streak,
    puddle,
    waterBufs,
    water: withCanvas ? waterBufs.map((b) => b.toCanvas()) : null,
    waterFrames: WATER_FRAMES,
    patterns: null,
  };
}

export function registerTileArt(atlas, rng) {
  atlas.setMeta('tileart', buildTileArt(rng));
}

// ---------------------------------------------------------------------------
// Colors

const C = {
  void: rgb('#141332'),
  shallow: rgb('#6fc6c4'),
  deep: rgb('#0e2547'),
  shore: rgb('#a8dccf'),
  refl: rgb('#123222'),
  sky: rgb('#c4e4f6'),
  foam: rgb('#eef8ff'),
  wetSky: rgb('#b7c9df'),
  puddle: rgb('#4f6684'),
  puddleRim: rgb('#2c2430'),
};

const RUG = {
  red: { base: lut(['#4a1520', '#6e2030', '#8e2c3a', '#ab3f45']), accent: rgb('#e4b83d'), edge: rgb('#2c0f18') },
  blue: { base: lut(['#162244', '#22346a', '#2e4686', '#3f5ba0']), accent: rgb('#d6d2ff'), edge: rgb('#10162c') },
  green: { base: lut(['#1c3524', '#28492f', '#335c3a', '#43744a']), accent: rgb('#e2d2b0'), edge: rgb('#132418') },
};

const FLOWER_SCHEMES = [
  ['#ff7a8a', '#ffd75e'],
  ['#f4f0e6', '#ff9fc2'],
  ['#8fb6ff', '#c79bff'],
  ['#ffb047', '#ff6b5e'],
  ['#fff3a8', '#f4f0e6'],
].map((s) => s.map((h) => rgb(h)));

// ---------------------------------------------------------------------------
// The chunk painter

function underMaterial(map, tx, ty, fallback) {
  for (const [dx, dy] of [
    [0, 1],
    [0, -1],
    [-1, 0],
    [1, 0],
  ]) {
    const id = map.tileAt(tx + dx, ty + dy);
    if (SOFT[id] && !isWater(id)) return id;
  }
  return fallback;
}

// Paint chunk (cx, cy). Returns { buf, foamA, foamB, foamX, foamY, hasWater } with PixelBufs.
export function paintChunkBuf(art, map, cx, cy, shadows = [], wet = false) {
  const x0 = cx * CPX;
  const y0 = cy * CPX;
  const out = new PixelBuf(CPX, CPX);
  const od = out.data;
  const mat = new Uint8Array(SW * SW);
  const W = map.w;
  const H = map.h;
  const ground = map.ground;
  const warpX = art.warpX;
  const warpY = art.warpY;
  let anyWater = false;

  // 1. Materials (domain-warped soft terrain).
  for (let j = 0; j < SW; j++) {
    const wy = y0 - MG + j;
    const ty = wy >> 4;
    for (let i = 0; i < SW; i++) {
      const wx = x0 - MG + i;
      const tx = wx >> 4;
      const g = tx < 0 || ty < 0 || tx >= W || ty >= H ? T.VOID : ground[ty * W + tx];
      let m = g;
      if (SOFT[g]) {
        const wi = ((wy & 255) << 8) | (wx & 255);
        const a = AMP[g];
        const sx = (wx + Math.round(warpX[wi] * a)) >> 4;
        const sy = (wy + Math.round(warpY[wi] * a)) >> 4;
        if (sx >= 0 && sy >= 0 && sx < W && sy < H) {
          const s = ground[sy * W + sx];
          if (SOFT[s]) m = s;
        }
      }
      mat[j * SW + i] = m;
      if (isWater(m)) anyWater = true;
    }
  }

  // Water distance to land (chamfer 2/3) and the run of water below a bank (mirror).
  let wd = null;
  let run = null;
  if (anyWater) {
    wd = new Uint8Array(SW * SW);
    for (let i = 0; i < SW * SW; i++) wd[i] = isWater(mat[i]) ? 60 : 0;
    for (let j = 1; j < SW; j++) {
      for (let i = 1; i < SW - 1; i++) {
        const k = j * SW + i;
        if (!wd[k]) continue;
        let v = wd[k];
        v = Math.min(v, wd[k - 1] + 2, wd[k - SW] + 2, wd[k - SW - 1] + 3, wd[k - SW + 1] + 3);
        wd[k] = v;
      }
    }
    for (let j = SW - 2; j >= 0; j--) {
      for (let i = SW - 2; i >= 1; i--) {
        const k = j * SW + i;
        if (!wd[k]) continue;
        wd[k] = Math.min(wd[k], wd[k + 1] + 2, wd[k + SW] + 2, wd[k + SW + 1] + 3, wd[k + SW - 1] + 3);
      }
    }
    run = new Uint8Array(SW * SW);
    for (let i = 0; i < SW; i++) {
      let r = 30;
      for (let j = 0; j < SW; j++) {
        const k = j * SW + i;
        if (!isWater(mat[k])) r = 0;
        else if (r < 30) r++;
        run[k] = r;
      }
    }
  }
  const depth = anyWater ? map.waterDepth() : null;

  // 2. Soft pixels.
  const tex = art.tex;
  const lf = art.lf;
  const lf2 = art.lf2;
  for (let ly = 0; ly < CPX; ly++) {
    const wy = y0 + ly;
    const j = ly + MG;
    for (let lx = 0; lx < CPX; lx++) {
      const wx = x0 + lx;
      const i = lx + MG;
      const k = j * SW + i;
      const m = mat[k];
      if (!SOFT[m]) continue;
      if (isWater(m)) {
        od[ly * CPX + lx] = waterTint(art, depth, W, H, wx, wy, wd[k], run[k]);
        continue;
      }
      const L = (((wy >> 2) & 127) << 7) | ((wx >> 2) & 127);
      const variants = tex[TEXKEY[m]];
      let v = 0;
      if (variants.length > 1) v = Math.max(0, Math.min(variants.length - 1, Math.floor((lf2[L] + (bayer(wx, wy) - 0.5) * 0.18) * variants.length)));
      let c = variants[v].data[((wy & 63) << 6) | (wx & 63)];
      let f = 0.93 + lf[L] * 0.14;
      // Emboss by material height: lit rims, shadowed lips, contact shadows.
      const h = HEIGHT[m];
      const hN = HEIGHT[mat[k - SW]];
      const hW = HEIGHT[mat[k - 1]];
      if (hN > h + 0.5 || hW > h + 0.5) f *= 0.8;
      else if (HEIGHT[mat[k - SW * 2]] > h + 0.5) f *= 0.9;
      else if (h > HEIGHT[mat[k + SW]] + 0.5) f *= 0.84;
      else if (h > hN + 0.5 || h > hW + 0.5) f *= 1.1;
      // Soft shadow under tall things (walls, cliffs, palisades) to the north and west.
      for (let s = 1; s <= 6; s++) {
        if (TALLM[mat[k - s * SW]]) {
          f *= 0.6 + s * 0.065;
          break;
        }
      }
      if (TALLM[mat[k - 1]] || TALLM[mat[k - 2]]) f *= 0.86;
      c = shade(c, f);
      if (wet) c = wetten(art, c, m, wx, wy);
      od[ly * CPX + lx] = c;
    }
  }

  // 3. Built tiles.
  const tx0 = cx * CHUNK;
  const ty0 = cy * CHUNK;
  for (let ty = ty0; ty < ty0 + CHUNK; ty++) {
    for (let tx = tx0; tx < tx0 + CHUNK; tx++) {
      const g = map.tileAt(tx, ty);
      const lx = (tx - tx0) * TILE;
      const ly = (ty - ty0) * TILE;
      if (tx >= W || ty >= H) {
        fillTile(out, lx, ly, 0);
        continue;
      }
      if (SOFT[g]) continue;
      paintBuiltTile(art, out, lx, ly, map, tx, ty, g, wet);
    }
  }

  // 4. Ground decorations.
  const decos = art.decos;
  for (let ty = ty0; ty < ty0 + CHUNK && ty < H; ty++) {
    for (let tx = tx0; tx < tx0 + CHUNK && tx < W; tx++) {
      const d = map.deco[ty * W + tx];
      if (!d || !decos[d]) continue;
      const list = decos[d];
      const spr = list[Math.floor(ih(tx, ty, 301) * list.length)];
      const ox = (tx - tx0) * TILE + Math.round((ih(tx, ty, 302) - 0.5) * 6);
      const oy = (ty - ty0) * TILE + Math.round((ih(tx, ty, 303) - 0.5) * 4);
      blitDeco(out, spr, ox, oy, mat, d === DECO.LILY || d === DECO.REEDS);
    }
  }

  // 5. Soft shadows of trees, bushes and furniture.
  for (const s of shadows) shadowEllipse(out, s.x - x0, s.y - y0, s.rx, s.ry);

  // Shore foam layers (only their bounding box is kept).
  let foamA = null;
  let foamB = null;
  let foamX = 0;
  let foamY = 0;
  if (anyWater) {
    let bx0 = CPX;
    let by0 = CPX;
    let bx1 = -1;
    let by1 = -1;
    for (let ly = 0; ly < CPX; ly++) {
      for (let lx = 0; lx < CPX; lx++) {
        const k = (ly + MG) * SW + lx + MG;
        const w = wd[k];
        if (w > 0 && w <= 9) {
          if (lx < bx0) bx0 = lx;
          if (lx > bx1) bx1 = lx;
          if (ly < by0) by0 = ly;
          if (ly > by1) by1 = ly;
        }
      }
    }
    if (bx1 >= 0) {
      const fw = bx1 - bx0 + 1;
      const fh = by1 - by0 + 1;
      foamA = new PixelBuf(fw, fh);
      foamB = new PixelBuf(fw, fh);
      foamX = bx0;
      foamY = by0;
      for (let ly = by0; ly <= by1; ly++) {
        for (let lx = bx0; lx <= bx1; lx++) {
          const k = (ly + MG) * SW + lx + MG;
          const w = wd[k];
          if (!w) continue;
          const wx = x0 + lx;
          const wy = y0 + ly;
          const o = (ly - by0) * fw + (lx - bx0);
          // Inner ring hugs the shore; the outer ring is broken into curls.
          if (w <= 3 && ih(wx >> 1, wy >> 1, 311) > 0.2) foamA.data[o] = (C.foam & 0x00ffffff) | ((w <= 2 ? 210 : 140) << 24);
          if (w >= 5 && w <= 8 && ih(wx >> 2, wy >> 1, 312) > 0.45) foamB.data[o] = (C.foam & 0x00ffffff) | ((w === 6 || w === 7 ? 150 : 80) << 24);
        }
      }
    }
  }
  return { buf: out, foamA, foamB, foamX, foamY, hasWater: anyWater };
}

// Translucent water color over the animated pattern: depth, sky, the dark mirror of the bank.
function waterTint(art, depth, W, H, wx, wy, wdist, run) {
  // Bilinear tile depth (0 = land) for smooth shallows.
  const fx = (wx - 8) / 16;
  const fy = (wy - 8) / 16;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const ax = fx - ix;
  const ay = fy - iy;
  const dAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 4 : depth[y * W + x]);
  const d = dAt(ix, iy) * (1 - ax) * (1 - ay) + dAt(ix + 1, iy) * ax * (1 - ay) + dAt(ix, iy + 1) * (1 - ax) * ay + dAt(ix + 1, iy + 1) * ax * ay;
  const deep = Math.max(0, Math.min(1, (d - 0.7) / 3.2));
  let c = mixc(C.shallow, C.deep, deep);
  let a = 0.2 + deep * 0.4;
  // Sandy, see-through shallows right at the shore.
  const near = Math.max(0, 1 - wdist / 14);
  if (near > 0) {
    c = mixc(c, C.shore, near * near * 0.8);
    a += near * near * 0.25;
  }
  // The bank mirrored in the still water just below it.
  if (run < 12) {
    const r = 1 - run / 12;
    c = mixc(c, C.refl, r * 0.85);
    a = a + (0.72 - a) * r * r;
  }
  // Clouds reflected in open water.
  const s = art.sky[(((wy >> 3) & 63) << 6) | ((wx >> 3) & 63)];
  if (s > 0.58 && run >= 12) {
    const k = Math.min(1, (s - 0.58) * 2.2);
    c = mixc(c, C.sky, k * 0.5);
    a = a + (0.5 - a) * k * 0.5;
  }
  a += (bayer(wx, wy) - 0.5) * 0.04;
  a = Math.max(0.08, Math.min(0.85, a));
  return ((c & 0x00ffffff) | (Math.round(a * 255) << 24)) >>> 0;
}

// Rain: darker, richer ground with glossy streaks and puddles on paths and stone.
function wetten(art, c, m, wx, wy) {
  const lum = (R(c) * 0.3 + G(c) * 0.55 + B(c) * 0.15) / 255;
  let o = shade(c, 0.7);
  const st = art.streak[((wy & 63) << 6) | ((wx >> 2) & 63)];
  if (m === T.COBBLE || m === T.RUIN_FLOOR || m === T.GRAVEL) {
    // Wet stone tops shine; the mortar stays dark.
    if (lum > 0.36) o = mixc(o, C.wetSky, Math.min(0.5, (lum - 0.36) * 1.6 + (st > 0.7 ? 0.18 : 0)));
    return o;
  }
  if (m === T.DIRT || m === T.SAND || m === T.FARMLAND) {
    const p = art.puddle[(((wy >> 2) & 63) << 6) | ((wx >> 2) & 63)];
    if (p > 0.66) {
      if (p < 0.69) return mixc(o, C.puddleRim, 0.5);
      return mixc(C.puddle, C.wetSky, st > 0.6 ? 0.55 : 0.15);
    }
    if (st > 0.78) o = mixc(o, C.wetSky, 0.3);
    return o;
  }
  // Grass and forest: darker and a little more saturated, the odd glint on a blade.
  o = shade(c, 0.86);
  const g = G(o);
  o = pack(R(o) * 0.9, Math.min(255, g * 1.04), B(o) * 0.95) >>> 0;
  if (st > 0.88 && lum > 0.4) o = mixc(o, C.wetSky, 0.3);
  return o;
}

function fillTile(out, lx, ly, c) {
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) out.data[(ly + y) * CPX + lx + x] = c;
}

function blitDeco(out, spr, ox, oy, mat, onWater) {
  for (let y = 0; y < spr.h; y++) {
    const ly = oy + y;
    if (ly < 0 || ly >= CPX) continue;
    for (let x = 0; x < spr.w; x++) {
      const lx = ox + x;
      if (lx < 0 || lx >= CPX) continue;
      const c = spr.data[y * spr.w + x];
      const a = c >>> 24;
      if (!a) continue;
      const m = mat[(ly + MG) * SW + lx + MG];
      if (!SOFT[m] && m !== T.FLOWERBED) continue;
      if (!onWater && isWater(m)) continue;
      const i = ly * CPX + lx;
      if (a === 255) out.data[i] = c;
      else out.blend(lx, ly, c);
    }
  }
}

function shadowEllipse(out, cx, cy, rx, ry) {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(CPX - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(CPX - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d >= 1) continue;
      const i = y * CPX + x;
      const c = out.data[i];
      const k = 1 - (1 - d) * 0.42 * (d > 0.75 ? (1 - d) * 4 : 1);
      out.data[i] = ((shade(c, k) & 0x00ffffff) | (c & 0xff000000)) >>> 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Built tiles

const pickL = (L, t) => L[Math.max(0, Math.min(L.length - 1, Math.round(t * (L.length - 1))))];
const ROCK_LUT = lut(['#201e29', '#2f2d3a', '#43404f', '#5a5767', '#737083', '#8e8b9d', '#aba9b8', '#c9c8d4']);
const RUIN_LUT = lut(['#1d1c25', '#2b2935', '#3c3a48', '#504d5d', '#666373', '#7f7c8c', '#9b98a6']);
const STAKE_LUT = lut(['#20130d', '#33201a', '#4a2f20', '#62402a', '#7a5233', '#93683f', '#a97c4f']);
const SOIL_LUT = lut(['#1d120c', '#2c1c13', '#3d281b', '#4f3524', '#63442e']);
const BRIDGE_RAIL = lut(['#24160f', '#3a2418', '#553722', '#704a2c', '#8c5f38', '#a97a4c']);

function paintBuiltTile(art, out, lx, ly, map, tx, ty, g, wet) {
  const b = map.buildingAt(tx, ty);
  if (b && ty >= b.y + b.h - 2 && (g === T.WALL || g === T.FLOOR || g === T.STONE_FLOOR)) {
    paintFacadeTile(out, lx, ly, b, tx, ty);
    return;
  }
  switch (g) {
    case T.WALL:
      if (b) paintBuildingWallTile(out, lx, ly, map, b, tx, ty);
      else paintRuinWall(art, out, lx, ly, map, tx, ty, T.WALL, wet);
      return;
    case T.FLOOR:
    case T.STONE_FLOOR:
      paintFloor(art, out, lx, ly, map, tx, ty, g, b);
      return;
    case T.RUG:
      paintFloor(art, out, lx, ly, map, tx, ty, b?.material === 'stone' ? T.STONE_FLOOR : T.FLOOR, b);
      paintRug(out, lx, ly, map, tx, ty, b);
      return;
    case T.RUIN_WALL:
      paintRuinWall(art, out, lx, ly, map, tx, ty, T.RUIN_WALL, wet);
      return;
    case T.ROCK:
      paintRock(art, out, lx, ly, map, tx, ty, wet);
      return;
    case T.PALISADE:
      paintPalisade(art, out, lx, ly, map, tx, ty, wet);
      return;
    case T.RUBBLE:
      paintRubble(art, out, lx, ly, map, tx, ty, wet);
      return;
    case T.BRIDGE:
    case T.DOCK:
      paintPlanks(art, out, lx, ly, map, tx, ty, g, wet);
      return;
    case T.FLOWERBED:
      paintFlowerbed(art, out, lx, ly, map, tx, ty, wet);
      return;
    default:
      fillTile(out, lx, ly, C.void);
  }
}

// Fill a tile with a soft material's texture (used under rounded rocks, rubble...).
function baseTexture(art, out, lx, ly, tx, ty, m, wet, dim = 1) {
  const variants = art.tex[TEXKEY[m] || 'grass'];
  const tex = variants[0].data;
  for (let y = 0; y < TILE; y++) {
    const wy = ty * TILE + y;
    for (let x = 0; x < TILE; x++) {
      const wx = tx * TILE + x;
      let c = tex[((wy & 63) << 6) | (wx & 63)];
      c = shade(c, (0.93 + art.lf[(((wy >> 2) & 127) << 7) | ((wx >> 2) & 127)] * 0.14) * dim);
      if (wet) c = wetten(art, c, m, wx, wy);
      out.data[(ly + y) * CPX + lx + x] = c;
    }
  }
}

function paintFloor(art, out, lx, ly, map, tx, ty, g, b) {
  const stone = g === T.STONE_FLOOR;
  const tex = (stone ? (b?.material === 'stone' ? art.tex.flag : art.tex.flagWarm) : b?.material === 'log' ? art.tex.plankDark : art.tex.plank)[0].data;
  const wallN = map.tileAt(tx, ty - 1) === T.WALL;
  const wallW = map.tileAt(tx - 1, ty) === T.WALL;
  const wallE = map.tileAt(tx + 1, ty) === T.WALL;
  const wallS = map.tileAt(tx, ty + 1) === T.WALL;
  for (let y = 0; y < TILE; y++) {
    const wy = ty * TILE + y;
    for (let x = 0; x < TILE; x++) {
      const wx = tx * TILE + x;
      let c = tex[((wy & 63) << 6) | (wx & 63)];
      // Ambient occlusion along the walls; the back wall casts the deepest shadow.
      let f = 1;
      if (wallN && y < 6) f *= 0.56 + y * 0.075;
      if (wallW && x < 3) f *= 0.78 + x * 0.07;
      if (wallE && x > 12) f *= 0.84 + (15 - x) * 0.05;
      if (wallS && y > 13) f *= 0.9;
      out.data[(ly + y) * CPX + lx + x] = f === 1 ? c : shade(c, f);
    }
  }
}

function paintRug(out, lx, ly, map, tx, ty, b) {
  const R0 = RUG[b?.rug] || RUG.red;
  const n = map.tileAt(tx, ty - 1) === T.RUG;
  const s = map.tileAt(tx, ty + 1) === T.RUG;
  const w = map.tileAt(tx - 1, ty) === T.RUG;
  const e = map.tileAt(tx + 1, ty) === T.RUG;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      // Inset one pixel from the outer edge so a sliver of floor frames the rug.
      if ((!n && y < 1) || (!s && y > 14) || (!w && x < 1) || (!e && x > 14)) continue;
      const wx = tx * TILE + x;
      const wy = ty * TILE + y;
      const dEdge = Math.min(n ? 9 : y - 1, s ? 9 : 14 - y, w ? 9 : x - 1, e ? 9 : 14 - x);
      let c;
      if (dEdge === 0) c = R0.edge;
      else if (dEdge === 2) c = R0.accent;
      else if (dEdge < 4) c = pickL(R0.base, 0.25);
      else {
        const diamond = (wx + wy) % 8 === 0 || (wx - wy + 64) % 8 === 0;
        c = diamond ? mixc(pickL(R0.base, 0.7), R0.accent, 0.4) : pickL(R0.base, 0.55 + (ih(wx >> 1, wy >> 1, 401) - 0.5) * 0.1);
      }
      // Fringe on the short ends.
      if (!w && x === 1 && y % 2 === 0) c = R0.accent;
      if (!e && x === 14 && y % 2 === 0) c = R0.accent;
      out.data[(ly + y) * CPX + lx + x] = c;
    }
  }
}

function paintRuinWall(art, out, lx, ly, map, tx, ty, id, wet) {
  const same = (x, y) => {
    const t = map.tileAt(x, y);
    return t === T.RUIN_WALL || t === T.WALL || t === T.RUBBLE;
  };
  const faceBelow = !same(tx, ty + 1);
  const openN = !same(tx, ty - 1);
  const openW = !same(tx - 1, ty);
  const openE = !same(tx + 1, ty);
  const capH = faceBelow ? 5 : 16;
  for (let y = 0; y < TILE; y++) {
    const wy = ty * TILE + y;
    for (let x = 0; x < TILE; x++) {
      const wx = tx * TILE + x;
      let c;
      if (y < capH) {
        // Wall top: rough stone with moss, lit rim toward the open north.
        const tex = art.tex.ruinfloor[0].data[((wy * 2) & 63) * 64 + ((wx * 2) & 63)];
        let f = 0.72;
        if (openN && y === 0) f = 1.15;
        else if (openN && y === 1) f = 0.95;
        if (openW && x === 0) f *= 1.15;
        if (openE && x === 15) f *= 0.65;
        if (faceBelow && y === capH - 1) f *= 1.2;
        c = shade(tex, f);
      } else {
        // Face: big weathered blocks, moss creeping down from the top.
        const fy = y - capH;
        const course = Math.floor(fy / 5);
        const off = course % 2 ? 6 : 0;
        const bx = Math.floor((wx + off) / 11);
        const ex = (wx + off) % 11;
        let t = 0.46 + (ih(bx, course + ty * 3, 411) - 0.5) * 0.22;
        if (fy % 5 === 4 || ex === 10) t = 0.12;
        else if (fy % 5 === 0) t += 0.14;
        else if (ex === 0) t += 0.06;
        t -= fy * 0.012;
        c = pickL(RUIN_LUT, t + (bayer(wx, wy) - 0.5) * 0.04);
        const drip = Math.floor(ih(wx, ty, 412) * 9);
        if (fy < drip && ih(wx >> 1, ty, 413) > 0.45) c = mixc(c, rgb(fy < drip - 2 ? '#4f7a3a' : '#3a5c30'), 0.7);
        if (y === 15) c = shade(c, 0.6);
      }
      if (wet) c = mixc(shade(c, 0.78), C.wetSky, y < capH && y < 2 ? 0.2 : 0.05);
      out.data[(ly + y) * CPX + lx + x] = c;
    }
  }
}

function paintRock(art, out, lx, ly, map, tx, ty, wet) {
  const under = underMaterial(map, tx, ty, T.GRAVEL);
  baseTexture(art, out, lx, ly, tx, ty, under, wet);
  const rock = (x, y) => map.tileAt(x, y) === T.ROCK;
  const n = rock(tx, ty - 1);
  const s = rock(tx, ty + 1);
  const w = rock(tx - 1, ty);
  const e = rock(tx + 1, ty);
  const r = 6;
  const tex = art.tex.cobble[0].data;
  for (let y = 0; y < TILE; y++) {
    const wy = ty * TILE + y;
    for (let x = 0; x < TILE; x++) {
      const wx = tx * TILE + x;
      // Round the corners where the outcrop ends; nibble the open edges.
      const jag = Math.floor(ih(wx, wy >> 2, 421) * 2.2);
      if (!n && y < jag) continue;
      if (!w && x < jag - 1) continue;
      if (!e && x > 15 - jag) continue;
      let cornerOut = false;
      if (!n && !w && x < r && y < r && Math.hypot(r - x - 0.5, r - y - 0.5) > r) cornerOut = true;
      if (!n && !e && x > 15 - r && y < r && Math.hypot(x + 0.5 - (16 - r), r - y - 0.5) > r) cornerOut = true;
      if (!s && !w && x < r && y > 15 - r && Math.hypot(r - x - 0.5, y + 0.5 - (16 - r)) > r) cornerOut = true;
      if (!s && !e && x > 15 - r && y > 15 - r && Math.hypot(x + 0.5 - (16 - r), y + 0.5 - (16 - r)) > r) cornerOut = true;
      if (cornerOut) continue;
      let c;
      const faceH = 7;
      if (!s && y >= 16 - faceH) {
        // Cliff face: vertical strata, darker toward the ground.
        const fy = y - (16 - faceH);
        const strata = ih(wx >> 1, ty, 422);
        let t = 0.36 - fy * 0.03 + (strata - 0.5) * 0.18;
        if ((wx + Math.floor(strata * 3)) % 5 === 0) t -= 0.12;
        if (fy === 0) t += 0.2;
        c = pickL(ROCK_LUT, t);
      } else {
        const base = tex[(((wy * 1) & 63) << 6) | ((wx * 1) & 63)];
        let f = 1.0;
        if (!n && y < 3) f = 1.22 - y * 0.06;
        if (!w && x < 3) f *= 1.1;
        if (!e && x > 12) f *= 0.72;
        c = shade(mixc(base, ROCK_LUT[40], 0.35), f);
      }
      if (wet) c = mixc(shade(c, 0.75), C.wetSky, !s && y >= 9 ? 0.04 : 0.16);
      out.data[(ly + y) * CPX + lx + x] = c;
    }
  }
}

function paintPalisade(art, out, lx, ly, map, tx, ty, wet) {
  const under = underMaterial(map, tx, ty, T.DIRT);
  baseTexture(art, out, lx, ly, tx, ty, under, wet);
  const pal = (x, y) => map.tileAt(x, y) === T.PALISADE;
  const faceBelow = !pal(tx, ty + 1);
  for (let y = 0; y < TILE; y++) {
    const wy = ty * TILE + y;
    for (let x = 0; x < TILE; x++) {
      const wx = tx * TILE + x;
      let c = 0;
      if (faceBelow) {
        const k = x >> 2;
        const sx = x & 3;
        const tipH = 3 + Math.floor(ih(wx >> 2, ty, 431) * 2);
        if (y < tipH && Math.abs(sx - 1.5) > (y + 0.5) * (2 / tipH)) continue;
        let t = [0.66, 0.52, 0.4, 0.22][sx] + (ih(wx >> 2, ty, 432) - 0.5) * 0.12;
        if (y === 8 || y === 9) t = y === 8 ? 0.62 : 0.2; // rope lashing
        if (y === 15) t -= 0.2;
        t += (ih(wx, wy >> 1, 433) - 0.5) * 0.06;
        c = pickL(STAKE_LUT, t);
        void k;
      } else {
        // Seen from above: a double row of stake ends.
        const cx = x < 8 ? 3.5 : 11.5;
        const cy = (y & 7) + 0.5;
        const d = Math.hypot(x + 0.5 - cx - 0.5, cy - 4);
        if (d > 3.6) {
          c = pickL(STAKE_LUT, 0.1);
        } else {
          const ring = Math.floor(d * 1.3) % 2;
          c = pickL(STAKE_LUT, 0.72 - d * 0.08 - ring * 0.08 - (x + 0.5 - cx > 1 ? 0.12 : 0));
        }
      }
      if (wet) c = shade(c, 0.78);
      out.data[(ly + y) * CPX + lx + x] = c;
    }
  }
}

function paintRubble(art, out, lx, ly, map, tx, ty, wet) {
  const under = underMaterial(map, tx, ty, T.RUIN_FLOOR);
  baseTexture(art, out, lx, ly, tx, ty, under, wet, 0.9);
  // A heap of shaded stones, biggest at the back.
  for (let k = 0; k < 9; k++) {
    const cx = 2 + ih(tx, ty, 441 + k) * 12;
    const cy = 3 + ih(tx, ty, 451 + k) * 10 + (k > 5 ? 2 : 0);
    const rr = 1.8 + ih(tx, ty, 461 + k) * 2.4 - (k > 5 ? 0.6 : 0);
    const tone = 0.42 + ih(tx, ty, 471 + k) * 0.25;
    for (let y = Math.floor(cy - rr - 1); y <= Math.ceil(cy + rr + 1); y++) {
      for (let x = Math.floor(cx - rr - 1); x <= Math.ceil(cx + rr + 1); x++) {
        if (x < 0 || y < 0 || x > 15 || y > 15) continue;
        const nx = (x + 0.5 - cx) / rr;
        const ny = (y + 0.5 - cy) / (rr * 0.85);
        const d = nx * nx + ny * ny;
        const i = (ly + y) * CPX + lx + x;
        if (d <= 1) {
          let c = pickL(RUIN_LUT, tone - (nx + ny) * 0.18 + (d > 0.7 ? -0.08 : 0));
          if (wet) c = mixc(shade(c, 0.78), C.wetSky, nx + ny < -0.6 ? 0.3 : 0.05);
          out.data[i] = c;
        } else if (d < 1.8 && nx + ny > 0.5) out.data[i] = shade(out.data[i], 0.7);
      }
    }
  }
}

function paintPlanks(art, out, lx, ly, map, tx, ty, g, wet) {
  const tex = art.tex.bridge[0].data;
  const water = (x, y) => map.isWater(x, y);
  const wN = water(tx, ty - 1);
  const wS = water(tx, ty + 1);
  const wW = water(tx - 1, ty);
  const wE = water(tx + 1, ty);
  const bridge = g === T.BRIDGE;
  for (let y = 0; y < TILE; y++) {
    const wy = ty * TILE + y;
    for (let x = 0; x < TILE; x++) {
      const wx = tx * TILE + x;
      // Planks run across the direction of travel: sample the texture transposed.
      let c = tex[((wx & 63) << 6) | (wy & 63)];
      let f = 1;
      if (wN && y < 2) f = y === 0 ? 1.18 : 1.05;
      if (wS && y > 13) f = y === 15 ? 0.45 : 0.75;
      if (!bridge && wE && x > 13) f *= x === 15 ? 0.55 : 0.8;
      c = shade(c, f);
      if (bridge) {
        // Rails along the water sides, with posts every tile.
        const rail = (wN && y >= 1 && y <= 3) || (wS && y >= 11 && y <= 13);
        const post = (wN && y <= 4) || (wS && y >= 10 && y <= 14);
        if (post && (x === 0 || x === 1)) c = pickL(BRIDGE_RAIL, x === 0 ? 0.62 : 0.3);
        else if (rail) c = pickL(BRIDGE_RAIL, y === 1 || y === 11 ? 0.82 : y === 3 || y === 13 ? 0.3 : 0.58);
      } else {
        // Mooring posts at the outer corners of the dock.
        const corner = (wN && y < 3) || (wS && y > 12);
        if (corner && ((wW && x < 3) || (wE && x > 12) || (x >= 6 && x <= 8 && ty % 2 === 0))) {
          c = pickL(BRIDGE_RAIL, x % 3 === 0 ? 0.6 : 0.32);
        }
      }
      if (wet) c = mixc(shade(c, 0.74), C.wetSky, (wx >> 2) % 3 === 0 && y % 4 === 0 ? 0.25 : 0.04);
      out.data[(ly + y) * CPX + lx + x] = c;
    }
  }
}

function paintFlowerbed(art, out, lx, ly, map, tx, ty, wet) {
  const bed = (x, y) => map.tileAt(x, y) === T.FLOWERBED;
  const n = bed(tx, ty - 1);
  const s = bed(tx, ty + 1);
  const w = bed(tx - 1, ty);
  const e = bed(tx + 1, ty);
  const scheme = FLOWER_SCHEMES[Math.floor(ih(tx >> 2, ty >> 2, 481) * FLOWER_SCHEMES.length)];
  for (let y = 0; y < TILE; y++) {
    const wy = ty * TILE + y;
    for (let x = 0; x < TILE; x++) {
      const wx = tx * TILE + x;
      let c = pickL(SOIL_LUT, 0.5 + (ih(wx, wy, 482) - 0.5) * 0.3 - (y % 5 === 4 ? 0.15 : 0));
      // Low stone edging where the bed ends.
      const edge = (!n && y < 2) || (!s && y > 13) || (!w && x < 2) || (!e && x > 13);
      if (edge) {
        const st = ih((wx >> 1) + (wy >> 1) * 7, 0, 483);
        c = pickL(ROCK_LUT, 0.55 + (st - 0.5) * 0.25 + ((!n && y === 0) || (!w && x === 0) ? 0.12 : 0) - ((!s && y === 15) || (!e && x === 15) ? 0.2 : 0));
      }
      if (wet) c = shade(c, 0.78);
      out.data[(ly + y) * CPX + lx + x] = c;
    }
  }
  // Flowers in two staggered rows: leaves, stem, bloom lit from the upper left.
  for (let k = 0; k < 6; k++) {
    const row = k < 3 ? 0 : 1;
    const fx = 3 + (k % 3) * 5 + (row ? 2 : 0) + Math.round((ih(tx, ty, 490 + k) - 0.5) * 2);
    const fy = 5 + row * 6;
    if (fx > 13) continue;
    const col = scheme[(k + ty) % 2];
    const leaf = rgb('#3f7a3a');
    const set = (x, y, c) => {
      if (x >= 0 && y >= 0 && x < 16 && y < 16) out.data[(ly + y) * CPX + lx + x] = c;
    };
    set(fx - 1, fy + 2, leaf);
    set(fx + 1, fy + 2, rgb('#2c5a34'));
    set(fx, fy + 1, rgb('#2c5a34'));
    set(fx, fy + 2, leaf);
    set(fx, fy - 1, mixc(col, rgb('#ffffff'), 0.35));
    set(fx - 1, fy, mixc(col, rgb('#ffffff'), 0.2));
    set(fx, fy, rgb('#ffd75e'));
    set(fx + 1, fy, shade(col, 0.75));
    set(fx, fy + 1 - 0, shade(col, 0.6));
    set(fx + 1, fy + 3, rgb('#1d120c'));
  }
}

// ---------------------------------------------------------------------------
// Browser wrapper used by the map's chunk cache.

export function paintChunk(art, map, cx, cy, shadows, wet = false) {
  const r = paintChunkBuf(art, map, cx, cy, shadows, wet);
  return {
    canvas: r.buf.toCanvas(),
    foamA: r.foamA ? r.foamA.toCanvas() : null,
    foamB: r.foamB ? r.foamB.toCanvas() : null,
    foamX: r.foamX,
    foamY: r.foamY,
    hasWater: r.hasWater,
    wet,
    used: 0,
  };
}
