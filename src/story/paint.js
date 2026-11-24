// A small raster painter for the story panels: an RGBA buffer with crisp, un-antialiased
// shapes, ordered-dither gradients and additive pixel glows. Panels are painted once into
// these buffers at low resolution (about 180 px on the short side) and upscaled crisply.
// Pure functions and plain arrays: nothing here touches the DOM, so the painters can be
// unit-tested and run under node.

export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

export function bayer(x, y) {
  return BAYER4[((y & 3) << 2) | (x & 3)];
}

// Seeded PRNG (mulberry32): the same panel always paints the same way.
export function rng(seed) {
  let a = seed >>> 0 || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + next() * (hi - lo);
  next.int = (lo, hi) => Math.floor(lo + next() * (hi - lo + 1));
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  return next;
}

function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);

// Smooth value noise in [0, 1].
export function noise(x, y, seed = 1) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = fade(x - xi);
  const yf = fade(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

export function fbm(x, y, seed = 1, oct = 4) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += noise(x * f, y * f, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

export function hex(c) {
  if (Array.isArray(c)) return c;
  const s = String(c).replace('#', '');
  const n = parseInt(s.length === 3 ? s.replace(/./g, '$&$&') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a, b, t) {
  a = hex(a);
  b = hex(b);
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function toCss(c, a = 1) {
  const [r, g, b] = hex(c);
  return a >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

// A colour along a ramp of hex stops (t in 0..1), dithered between neighbouring stops
// with the 4x4 Bayer matrix: smooth light in a few honest pixel-art bands.
export function rampAt(ramp, t, x, y) {
  const n = ramp.length - 1;
  const f = clamp(t) * n;
  let i = Math.floor(f);
  const frac = f - i;
  if (i >= n) return ramp[n];
  if (frac > bayer(x, y)) i++;
  return ramp[i];
}

// Continuous mix along a ramp, then a ±level ordered-dither nudge (a faint grain).
export function rampSmooth(ramp, t, x, y, grain = 6) {
  const n = ramp.length - 1;
  const f = clamp(t) * n;
  const i = Math.min(n - 1, Math.floor(f));
  const c = mix(ramp[i], ramp[i + 1], f - i);
  const d = (bayer(x, y) - 0.5) * grain;
  return [c[0] + d, c[1] + d, c[2] + d];
}

export class Buf {
  constructor(w, h) {
    this.w = Math.max(1, w | 0);
    this.h = Math.max(1, h | 0);
    this.data = new Uint8ClampedArray(this.w * this.h * 4);
  }

  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  // Set a pixel (colour as [r,g,b] or hex), with optional alpha blending over what is there.
  px(x, y, c, a = 1) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const col = typeof c === 'string' ? hex(c) : c;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    if (a >= 1) {
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
      d[i + 3] = 255;
      return;
    }
    const da = d[i + 3] / 255;
    const oa = a + da * (1 - a);
    if (oa <= 0) return;
    d[i] = (col[0] * a + d[i] * da * (1 - a)) / oa;
    d[i + 1] = (col[1] * a + d[i + 1] * da * (1 - a)) / oa;
    d[i + 2] = (col[2] * a + d[i + 2] * da * (1 - a)) / oa;
    d[i + 3] = oa * 255;
  }

  get(x, y) {
    x |= 0;
    y |= 0;
    if (!this.inside(x, y)) return null;
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  alphaAt(x, y) {
    x |= 0;
    y |= 0;
    if (!this.inside(x, y)) return 0;
    return this.data[(y * this.w + x) * 4 + 3];
  }

  // Add light to a pixel that is already painted (does not change alpha).
  add(x, y, c, k) {
    x |= 0;
    y |= 0;
    if (!this.inside(x, y) || k <= 0) return;
    const col = typeof c === 'string' ? hex(c) : c;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    d[i] += col[0] * k;
    d[i + 1] += col[1] * k;
    d[i + 2] += col[2] * k;
  }

  // Multiply a pixel's colour (shade it) without changing alpha.
  mul(x, y, k) {
    x |= 0;
    y |= 0;
    if (!this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    d[i] *= k;
    d[i + 1] *= k;
    d[i + 2] *= k;
  }

  rect(x, y, w, h, c, a = 1) {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w));
    const y1 = Math.min(this.h, Math.round(y + h));
    const col = typeof c === 'string' ? hex(c) : c;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.px(xx, yy, col, a);
  }

  // Fill every pixel with fn(x, y) -> [r,g,b] | [r,g,b,a] | null.
  fill(fn, x0 = 0, y0 = 0, x1 = this.w, y1 = this.h) {
    x0 = Math.max(0, x0 | 0);
    y0 = Math.max(0, y0 | 0);
    x1 = Math.min(this.w, Math.ceil(x1));
    y1 = Math.min(this.h, Math.ceil(y1));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const c = fn(x, y);
        if (c) this.px(x, y, c, c.length > 3 ? c[3] : 1);
      }
    }
  }

  // Filled ellipse (crisp edge).
  ellipse(cx, cy, rx, ry, c, a = 1) {
    const col = typeof c === 'string' ? hex(c) : c;
    const y0 = Math.floor(cy - ry);
    const y1 = Math.ceil(cy + ry);
    for (let y = y0; y <= y1; y++) {
      const dy = (y + 0.5 - cy) / ry;
      if (Math.abs(dy) > 1) continue;
      const half = rx * Math.sqrt(1 - dy * dy);
      for (let x = Math.round(cx - half); x < Math.round(cx + half); x++) this.px(x, y, col, a);
    }
  }

  // Filled polygon by scanline (crisp edge). pts = [[x,y], ...]
  poly(pts, c, a = 1) {
    const col = typeof c === 'string' ? hex(c) : c;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    const xs = [];
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const sy = y + 0.5;
      xs.length = 0;
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) this.px(x, y, col, a);
      }
    }
  }

  line(x0, y0, x1, y1, c, a = 1) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const col = typeof c === 'string' ? hex(c) : c;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, col, a);
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

  // A soft additive glow, quantized with the Bayer matrix so it reads as pixel light.
  glow(cx, cy, r, c, k = 1, falloff = 2) {
    const col = typeof c === 'string' ? hex(c) : c;
    const x0 = Math.floor(cx - r);
    const x1 = Math.ceil(cx + r);
    const y0 = Math.floor(cy - r);
    const y1 = Math.ceil(cy + r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
        if (d >= 1) continue;
        let f = Math.pow(1 - d, falloff) * k;
        // Step the light into sixteenths with a dither between steps.
        const q = f * 16;
        f = (Math.floor(q) + (q % 1 > bayer(x, y) ? 1 : 0)) / 16;
        if (f > 0) this.add(x, y, col, f);
      }
    }
  }

  // Darken toward the edges of a region by a radial falloff (used for local shadow).
  shade(cx, cy, r, k = 0.5) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d < 1) this.mul(x, y, 1 - k * (1 - d));
      }
    }
  }

  // A 1 px dark outline around every opaque pixel that borders a transparent one.
  outline(c = '#0b0915') {
    const col = hex(c);
    const w = this.w;
    const h = this.h;
    const d = this.data;
    const mark = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 0) continue;
        const n =
          (x > 0 && d[(y * w + x - 1) * 4 + 3] > 200) ||
          (x < w - 1 && d[(y * w + x + 1) * 4 + 3] > 200) ||
          (y > 0 && d[((y - 1) * w + x) * 4 + 3] > 200) ||
          (y < h - 1 && d[((y + 1) * w + x) * 4 + 3] > 200);
        if (n) mark.push(x, y);
      }
    }
    for (let i = 0; i < mark.length; i += 2) this.px(mark[i], mark[i + 1], col);
  }

  // Copy another buffer on top (alpha-blended), offset by (ox, oy).
  draw(src, ox = 0, oy = 0) {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const i = (y * src.w + x) * 4;
        const a = src.data[i + 3];
        if (a) this.px(x + ox, y + oy, [src.data[i], src.data[i + 1], src.data[i + 2]], a / 255);
      }
    }
  }
}
