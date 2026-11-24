import { OUTLINE } from './palette.js';
import { PixelBuf, rgb, mixc, shade, bayer, ih } from './world_pixbuf.js';
import { lut } from './world_textures.js';

// A small toolkit for painting props into PixelBufs: lit volumes (boxes, cylinders,
// balls), wood and stone surfaces, outlines and soft shadows. Light comes from the
// upper left; tones are picked from smooth ramps with a touch of ordered dither.

export const OUT = rgb(OUTLINE);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const tone = (L, t) => L[Math.round(clamp01(t) * (L.length - 1))];
export const dtone = (L, t, x, y, d = 0.05) => tone(L, t + (bayer(x, y) - 0.5) * d);

export const PAL = {
  wood: lut(['#22130d', '#3a2216', '#55331f', '#714629', '#8c5a35', '#a87444', '#c48f5c', '#dcae7c']),
  woodDark: lut(['#1a0f0b', '#2a1911', '#3d251a', '#523323', '#68432e', '#7f553a']),
  woodLight: lut(['#4a3020', '#6b4a2e', '#8c6740', '#ad8553', '#c9a26a', '#e0c08a']),
  iron: lut(['#1c1d24', '#2b2e37', '#40444f', '#5a5f6c', '#787e8c', '#9aa0ad', '#c3c8d0', '#e6e9ee']),
  stone: lut(['#201e29', '#2f2d3a', '#43404f', '#5a5767', '#737083', '#8e8b9d', '#aba9b8', '#c9c8d4']),
  stoneWarm: lut(['#2a2224', '#3e3335', '#574846', '#715f5a', '#8b7870', '#a69387', '#c0aea0']),
  leaf: lut(['#10261b', '#173326', '#1f4430', '#2a5a36', '#3b743d', '#558f45', '#74ab52', '#9cc463', '#c2dc86']),
  pine: lut(['#0d1d1c', '#132826', '#1a3730', '#24493c', '#2f5c46', '#3f7351', '#558a5f']),
  bark: lut(['#1d120d', '#2e1d14', '#432b1d', '#5a3b27', '#704b32', '#87603f', '#9c7550']),
  cloth: (hexes) => lut(hexes),
  gold: lut(['#4d3412', '#7d5a1c', '#b58726', '#e4b83d', '#ffe27a', '#fff3c2']),
  ember: lut(['#4a1a12', '#86301b', '#c4501f', '#ee7f2d', '#ffb047', '#ffe08a', '#fff6d6']),
  straw: lut(['#4a3518', '#6e5124', '#94702f', '#b8913f', '#d9b45a', '#f0d68a']),
  plaster: lut(['#6e5a55', '#9a8378', '#c2ab98', '#dfcbb4', '#f1e4cf']),
  paper: lut(['#8a7a62', '#b5a385', '#d8c9a8', '#efe3c6', '#fbf4e0']),
  bone: lut(['#5b5246', '#8a7f6c', '#b8ad95', '#ded5bd', '#f6f0de']),
  glass: lut(['#1c3a4a', '#2c5a6e', '#4b86a0', '#7fb6cc', '#c4e6f2']),
  glow: lut(['#7a3a12', '#c46a1f', '#ee9a3a', '#ffc46b', '#ffe3a3', '#fff6dc']),
};

export function buf(w, h) {
  return new PixelBuf(w, h);
}

// Outline every opaque shape, then return the buffer.
export function finish(b, { diagonal = false } = {}) {
  return b.outline(OUT, { diagonal });
}

// A soft translucent ground shadow (drawn after the outline so it stays soft).
export function groundShadow(b, cx, cy, rx, ry, alpha = 90) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      const i = y * b.w + x;
      if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
      if (b.data[i] >>> 24 >= 200) continue;
      const a = Math.round(alpha * (1 - d * d));
      b.data[i] = (rgb('#100a1c') & 0x00ffffff) | (Math.max(a, b.data[i] >>> 24) << 24);
    }
  }
}

// Fill a rect with a per-pixel tone function f(x, y) -> 0..1 on ramp L.
export function fillT(b, x0, y0, w, h, L, f) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) b.set(x, y, tone(L, f(x - x0, y - y0, x, y)));
}

// A box in 3/4 view: a lit top face `top` px tall above a front face.
export function box(b, x, y, w, h, top, L, { topL = L, grain = false, seed = 0, lit = 0 } = {}) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const isTop = j < top;
      let t;
      if (isTop) {
        t = 0.72 + lit - (j / Math.max(1, top)) * 0.08;
        if (j === 0) t += 0.08;
        if (i === 0) t += 0.04;
      } else {
        const fj = j - top;
        t = 0.5 + lit - fj * (0.18 / Math.max(1, h - top));
        if (fj === 0) t -= 0.14; // the edge under the top
        if (i === 0) t += 0.06;
        if (i === w - 1) t -= 0.14;
        if (j === h - 1) t -= 0.1;
      }
      if (grain) t += (ih(x + i, (y + j) >> 1, seed) - 0.5) * 0.08;
      b.set(x + i, y + j, dtone(isTop ? topL : L, t, x + i, y + j, 0.04));
    }
  }
}

// A vertical cylinder (barrels, posts, pillars) shaded across its width.
export function cylinder(b, cx, y0, y1, r, L, { bulge = 0, bands = [], bandL = null, lit = 0 } = {}) {
  for (let y = y0; y <= y1; y++) {
    const v = (y - y0) / Math.max(1, y1 - y0);
    const rr = r + bulge * Math.sin(v * Math.PI);
    for (let x = Math.floor(cx - rr); x <= Math.ceil(cx + rr); x++) {
      const u = (x + 0.5 - cx) / rr;
      if (u < -1 || u > 1) continue;
      let t = 0.56 + lit - u * 0.32 - Math.abs(u) ** 3 * 0.18;
      const band = bands.includes(y - y0);
      const L2 = band && bandL ? bandL : L;
      if (band) t += 0.06;
      b.set(x, y, dtone(L2, t, x, y, 0.04));
    }
  }
}

// An ellipse lid / top (barrel tops, stumps, wells).
export function disc(b, cx, cy, rx, ry, L, f = null) {
  b.ellipse(cx, cy, rx, ry, (x, y, nx, ny, d) => tone(L, f ? f(nx, ny, d) : 0.66 - nx * 0.1 - ny * 0.14 - (d > 0.7 ? 0.12 : 0)));
}

// A leafy blob made of small shaded clusters (canopies, bushes).
export function foliage(b, cx, cy, rx, ry, L, rng, { clusters = 18, clusterR = [3, 5], lo = 0.15, hi = 0.95, holes = 0 } = {}) {
  const H = new Float32Array(b.w * b.h);
  const M = new Uint8Array(b.w * b.h);
  for (let k = 0; k < clusters; k++) {
    const a = rng.next() * Math.PI * 2;
    const rr = Math.sqrt(rng.next());
    const px = cx + Math.cos(a) * rx * rr * 0.82;
    const py = cy + Math.sin(a) * ry * rr * 0.82;
    const r = clusterR[0] + rng.next() * (clusterR[1] - clusterR[0]);
    for (let y = Math.floor(py - r); y <= Math.ceil(py + r); y++) {
      for (let x = Math.floor(px - r); x <= Math.ceil(px + r); x++) {
        if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
        const nx = (x + 0.5 - px) / r;
        const ny = (y + 0.5 - py) / r;
        const d = nx * nx + ny * ny;
        if (d > 1) continue;
        const i = y * b.w + x;
        // Each cluster is a lit dome; the higher dome wins the pixel.
        const h = (1 - d) * 0.6 + (cy - py) / ry * 0.15 + 1;
        const lit = 0.5 - nx * 0.28 - ny * 0.4 + (1 - d) * 0.15;
        if (!M[i] || h > H[i]) {
          H[i] = h;
          M[i] = 1;
          // Global light: the whole crown is lit from the upper left too.
          const gx = (x + 0.5 - cx) / rx;
          const gy = (y + 0.5 - cy) / ry;
          const t = lo + (hi - lo) * clamp01(lit * 0.55 + (0.5 - gx * 0.25 - gy * 0.35) * 0.6);
          b.data[i] = dtone(L, t, x, y, 0.08);
        }
      }
    }
  }
  // Inner dapples: darker gaps between clusters give depth.
  for (let y = 1; y < b.h - 1; y++) {
    for (let x = 1; x < b.w - 1; x++) {
      const i = y * b.w + x;
      if (!M[i]) continue;
      if (H[i - b.w] > H[i] + 0.25 && M[i - b.w]) b.data[i] = shade(b.data[i], 0.78);
      if (holes && ih(x, y, 77) < holes) b.data[i] = shade(b.data[i], 0.7);
    }
  }
  return M;
}

// Horizontal wood planks across a rect (crates, tables, doors). dir 'h' or 'v'.
export function planks(b, x0, y0, w, h, L, { size = 3, dir = 'v', seed = 0, lit = 0 } = {}) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const along = dir === 'v' ? x - x0 : y - y0;
      const k = Math.floor(along / size);
      const r = along % size;
      let t = 0.52 + lit + (ih(k, seed, 61) - 0.5) * 0.14;
      if (r === size - 1) t -= 0.22;
      else if (r === 0) t += 0.08;
      t += (ih(dir === 'v' ? x : x >> 2, dir === 'v' ? y >> 2 : y, seed + 62) - 0.5) * 0.08;
      b.set(x, y, dtone(L, t, x, y, 0.03));
    }
  }
}

export function line(b, x0, y0, x1, y1, c) {
  b.line(x0, y0, x1, y1, c);
}

export { rgb, mixc, shade, ih, bayer, lut };
