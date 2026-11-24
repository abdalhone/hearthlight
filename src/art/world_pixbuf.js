import { makeCanvas, hexToRgb } from './pixel.js';

// A tiny software canvas: 32-bit RGBA pixels in a typed array. World art is painted
// here (fast, no per-pixel canvas calls) and converted to a canvas once at the end.
// Pixels are packed little-endian (0xAABBGGRR), the layout of ImageData on every
// platform browsers run on.

export function pack(r, g, b, a = 255) {
  return ((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
}

const HEX_CACHE = new Map();
export function rgb(hex, a = 255) {
  const k = a === 255 ? hex : `${hex}/${a}`;
  let v = HEX_CACHE.get(k);
  if (v === undefined) {
    const c = hexToRgb(hex);
    v = pack(c.r, c.g, c.b, a) >>> 0;
    HEX_CACHE.set(k, v);
  }
  return v;
}

export const ramp32 = (hexes) => Uint32Array.from(hexes.map((h) => rgb(h)));

export const R = (c) => c & 255;
export const G = (c) => (c >>> 8) & 255;
export const B = (c) => (c >>> 16) & 255;
export const A = (c) => c >>> 24;

// Multiply a color's brightness (alpha kept).
export function shade(c, f) {
  const r = Math.min(255, R(c) * f);
  const g = Math.min(255, G(c) * f);
  const b = Math.min(255, B(c) * f);
  return (pack(r, g, b, A(c)) >>> 0);
}

export function mixc(a, b, t) {
  return (pack(R(a) + (R(b) - R(a)) * t, G(a) + (G(b) - G(a)) * t, B(a) + (B(b) - B(a)) * t, A(a) + (A(b) - A(a)) * t) >>> 0);
}

// Alpha-composite c (with its alpha scaled by k) over the destination color d.
export function over(d, c, k = 1) {
  const a = (A(c) / 255) * k;
  if (a <= 0) return d;
  const da = A(d) / 255;
  const oa = a + da * (1 - a);
  if (oa <= 0) return 0;
  const f = (x, y) => (x * a + y * da * (1 - a)) / oa;
  return (pack(f(R(c), R(d)), f(G(c), G(d)), f(B(c), B(d)), oa * 255) >>> 0);
}

export const BAYER4 = Float32Array.from([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16));
export const bayer = (x, y) => BAYER4[((y & 3) << 2) | (x & 3)];

// Fast integer hash -> [0, 1).
export function ih(x, y, s = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class PixelBuf {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint32Array(w * h);
  }

  in(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x, y) {
    x |= 0;
    y |= 0;
    return this.in(x, y) ? this.data[y * this.w + x] : 0;
  }

  set(x, y, c) {
    x |= 0;
    y |= 0;
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = c;
  }

  // Composite a translucent color.
  blend(x, y, c, k = 1) {
    x |= 0;
    y |= 0;
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) {
      const i = y * this.w + x;
      this.data[i] = over(this.data[i], c, k);
    }
  }

  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  hline(x, y, w, c) {
    this.rect(x, y, w, 1, c);
  }

  vline(x, y, h, c) {
    this.rect(x, y, 1, h, c);
  }

  line(x0, y0, x1, y1, c) {
    x0 |= 0;
    y0 |= 0;
    x1 |= 0;
    y1 |= 0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  // Filled ellipse; fn(x, y, nx, ny, d) may return a color per pixel (for shading).
  ellipse(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        const d = nx * nx + ny * ny;
        if (d > 1) continue;
        const col = typeof c === 'function' ? c(x, y, nx, ny, d) : c;
        if (col) this.set(x, y, col);
      }
    }
  }

  // A ball lit from the upper left, shaded through a ramp (dark -> light).
  ball(cx, cy, rx, ry, ramp, { lo = 0, hi = ramp.length - 1, dither = true } = {}) {
    this.ellipse(cx, cy, rx, ry, (x, y, nx, ny) => {
      const l = 0.55 - nx * 0.45 - ny * 0.6 + (1 - nx * nx - ny * ny) * 0.25;
      let t = Math.max(0, Math.min(1, l));
      if (dither) t += (bayer(x, y) - 0.5) * 0.18;
      const k = Math.max(lo, Math.min(hi, Math.round(lo + t * (hi - lo))));
      return ramp[k];
    });
  }

  // Outline every transparent pixel touching an opaque one.
  outline(c, { diagonal = false, alphaMin = 40 } = {}) {
    const { w, h, data } = this;
    const src = data.slice();
    const op = (x, y) => x >= 0 && y >= 0 && x < w && y < h && src[y * w + x] >>> 24 >= alphaMin;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (op(x, y)) continue;
        let n = op(x - 1, y) || op(x + 1, y) || op(x, y - 1) || op(x, y + 1);
        if (!n && diagonal) n = op(x - 1, y - 1) || op(x + 1, y - 1) || op(x - 1, y + 1) || op(x + 1, y + 1);
        if (n) data[y * w + x] = c;
      }
    }
    return this;
  }

  // Copy another buffer onto this one (opaque pixels only, or alpha-composited).
  blit(src, dx, dy, { composite = false } = {}) {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const c = src.data[y * src.w + x];
        if (!(c >>> 24)) continue;
        if (composite && c >>> 24 < 255) this.blend(dx + x, dy + y, c);
        else this.set(dx + x, dy + y, c);
      }
    }
    return this;
  }

  clone() {
    const b = new PixelBuf(this.w, this.h);
    b.data.set(this.data);
    return b;
  }

  flipX() {
    const b = new PixelBuf(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) b.data[y * this.w + (this.w - 1 - x)] = this.data[y * this.w + x];
    return b;
  }

  toCanvas() {
    const { canvas, ctx } = makeCanvas(this.w, this.h);
    const img = ctx.createImageData(this.w, this.h);
    new Uint32Array(img.data.buffer).set(this.data);
    ctx.putImageData(img, 0, 0);
    return canvas;
  }
}

// Tileable smooth value noise (period `size`), returned as a Float32Array in [0, 1).
export function tileNoise(size, cells, rng, octaves = 3) {
  const out = new Float32Array(size * size);
  let amp = 1;
  let norm = 0;
  let c = cells;
  for (let o = 0; o < octaves; o++) {
    const lat = new Float32Array(c * c);
    for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * c;
        const fy = (y / size) * c;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const a = lat[(y0 % c) * c + (x0 % c)];
        const b = lat[(y0 % c) * c + ((x0 + 1) % c)];
        const d = lat[((y0 + 1) % c) * c + (x0 % c)];
        const e = lat[((y0 + 1) % c) * c + ((x0 + 1) % c)];
        out[y * size + x] += amp * (a + (b - a) * sx + (d - a) * sy + (a - b - d + e) * sx * sy);
      }
    }
    norm += amp;
    amp *= 0.5;
    c *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  // Stretch contrast so the full 0..1 range is used.
  let lo = 1;
  let hi = 0;
  for (const v of out) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo || 1);
  return out;
}

// Tileable Voronoi cells: for each pixel, its cell id and distance to the cell border.
export function tileCells(size, spacing, rng) {
  const n = Math.max(2, Math.round(size / spacing));
  const step = size / n;
  const pts = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pts.push([(i + 0.15 + rng.next() * 0.7) * step, (j + 0.15 + rng.next() * 0.7) * step]);
  const id = new Uint16Array(size * size);
  const edge = new Float32Array(size * size);
  const dx = new Float32Array(size * size); // offset from the cell's seed (for shading)
  const dy = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let d1 = Infinity;
      let d2 = Infinity;
      let best = 0;
      let bx = 0;
      let by = 0;
      const ci = Math.floor(x / step);
      const cj = Math.floor(y / step);
      for (let oj = -1; oj <= 1; oj++) {
        for (let oi = -1; oi <= 1; oi++) {
          const ii = (ci + oi + n) % n;
          const jj = (cj + oj + n) % n;
          const [px, py] = pts[jj * n + ii];
          const wx = px + (ci + oi - ii) * step;
          const wy = py + (cj + oj - jj) * step;
          const d = Math.hypot(x + 0.5 - wx, y + 0.5 - wy);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            best = jj * n + ii;
            bx = x + 0.5 - wx;
            by = y + 0.5 - wy;
          } else if (d < d2) d2 = d;
        }
      }
      id[y * size + x] = best;
      edge[y * size + x] = (d2 - d1) / 2;
      dx[y * size + x] = bx;
      dy[y * size + x] = by;
    }
  }
  return { size, id, edge, dx, dy, count: n * n };
}
