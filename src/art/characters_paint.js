// A tiny software painter for character sprites. Parts are painted as flat
// silhouettes tagged with a part id (draw order = depth); render() then shades
// every pixel from its neighbours (light from the upper left, 3 tones per ramp),
// lets parts in front cast a 1 px shadow down/right onto parts behind, and wraps
// the whole figure in a selectively tinted outline. It works on plain arrays so
// sprites can be generated (and unit tested) without a DOM.

import { OUTLINE } from './palette.js';

const RGB = new Map();
export function rgbOf(hex) {
  let c = RGB.get(hex);
  if (!c) {
    const h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    const full = h.length === 3 ? h.replace(/(.)/g, '$1$1') : h;
    const n = parseInt(full, 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    RGB.set(hex, c);
  }
  return c;
}

function hex2(v) {
  const n = Math.max(0, Math.min(255, Math.round(v)));
  return (n < 16 ? '0' : '') + n.toString(16);
}

export function mixHex(a, b, t) {
  const A = rgbOf(a);
  const B = rgbOf(b);
  return '#' + hex2(A[0] + (B[0] - A[0]) * t) + hex2(A[1] + (B[1] - A[1]) * t) + hex2(A[2] + (B[2] - A[2]) * t);
}

export const lighten = (hex, t) => mixHex(hex, '#fff6e8', t);
export const darken = (hex, t) => mixHex(hex, OUTLINE, t);

// Build a 3-tone ramp [dark, mid, light] from one base color.
export function rampFrom(base, spread = 0.32) {
  return [darken(base, spread + 0.12), base, lighten(base, spread)];
}

// Ensure a ramp has exactly three tones (palette ramps vary in length).
export function tri(ramp, offset = 0) {
  if (!ramp) return ['#555', '#777', '#999'];
  if (ramp.length === 3 && !offset) return ramp;
  const n = ramp.length;
  const mid = Math.max(1, Math.min(n - 2, Math.floor((n - 1) / 2) + offset));
  return [ramp[mid - 1], ramp[mid], ramp[mid + 1]];
}

// A cool back light for hair and cloaks (night-blue, so warm lamps still read warm).
const RIM_COLOR = '#b8c8ff';

// Seven shading levels per 3-tone ramp, as RGB triples (cached per ramp array).
const LEVELS = new WeakMap();
export function levelsOf(ramp) {
  let l = LEVELS.get(ramp);
  if (l) return l;
  const a = rgbOf(ramp[0]);
  const b = rgbOf(ramp[Math.min(1, ramp.length - 1)]);
  const c = rgbOf(ramp[Math.min(2, ramp.length - 1)]);
  const o = rgbOf(OUTLINE);
  const hi = rgbOf('#fff6e8');
  const mix = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  l = [mix(a, o, 0.32), a, mix(a, b, 0.5), b, mix(b, c, 0.5), c, mix(c, hi, 0.22)];
  LEVELS.set(ramp, l);
  return l;
}

export class Sprite {
  constructor(w = 32, h = 32) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.part = new Int16Array(n).fill(-1);
    this.ramp = new Array(n).fill(null);
    this.tone = new Int8Array(n).fill(-1);
    this.color = new Array(n).fill(null);
    this.alpha = new Float32Array(n);
    this.parts = [];
    this.cur = -1;
    this.curAlpha = 1;
  }

  // Start a new part drawn in front of everything painted so far.
  //   flat: no automatic shading      band: extra dark columns on the right edge
  //   noLight / noShadow              shadow: 'all' | 'top' | 'none' (what it casts on parts behind)
  //   noOutline: excluded from the silhouette outline (glows, smears)
  //   alpha: opacity of its pixels    rimLight: light tone also on bottom-left exposed edges
  begin(opts = {}) {
    this.cur = this.parts.length;
    this.parts.push(opts);
    this.curAlpha = opts.alpha ?? 1;
    return this.cur;
  }

  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  partAt(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return this.part[y * this.w + x];
  }

  isSet(x, y) {
    return this.partAt(x, y) >= 0;
  }

  set(x, y, ramp, tone = -1) {
    x |= 0;
    y |= 0;
    if (!this.inside(x, y)) return;
    if (this.cur < 0) this.begin();
    const i = y * this.w + x;
    this.part[i] = this.cur;
    this.ramp[i] = ramp;
    this.tone[i] = tone;
    this.color[i] = null;
    this.alpha[i] = this.curAlpha;
  }

  // A flat color pixel that belongs to the current part (eyes, buckles, gems).
  dot(x, y, color, alpha = this.curAlpha) {
    x |= 0;
    y |= 0;
    if (!this.inside(x, y)) return;
    if (this.cur < 0) this.begin();
    const i = y * this.w + x;
    this.part[i] = this.cur;
    this.ramp[i] = null;
    this.tone[i] = -1;
    this.color[i] = color;
    this.alpha[i] = alpha;
  }

  // Recolor an existing pixel without changing which part it belongs to.
  detail(x, y, color) {
    x |= 0;
    y |= 0;
    if (!this.inside(x, y)) return;
    const i = y * this.w + x;
    if (this.part[i] < 0) {
      this.dot(x, y, color);
      return;
    }
    this.color[i] = color;
  }

  // Force a tone on an existing pixel (keeps its ramp and part).
  shadeAt(x, y, tone) {
    x |= 0;
    y |= 0;
    if (!this.inside(x, y)) return;
    const i = y * this.w + x;
    if (this.part[i] >= 0 && !this.color[i]) this.tone[i] = tone;
  }

  erase(x, y) {
    x |= 0;
    y |= 0;
    if (!this.inside(x, y)) return;
    this.part[y * this.w + x] = -1;
  }

  rect(x, y, w, h, ramp, tone = -1) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, ramp, tone);
  }

  // Inclusive horizontal span.
  span(x0, x1, y, ramp, tone = -1) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    for (let x = x0; x <= x1; x++) this.set(x, y, ramp, tone);
  }

  ellipse(cx, cy, rx, ry, ramp, tone = -1) {
    const x0 = Math.floor(cx - rx - 1);
    const x1 = Math.ceil(cx + rx + 1);
    const y0 = Math.floor(cy - ry - 1);
    const y1 = Math.ceil(cy + ry + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) / (rx || 0.5);
        const dy = (y + 0.5 - cy) / (ry || 0.5);
        if (dx * dx + dy * dy <= 1) this.set(x, y, ramp, tone);
      }
    }
  }

  line(x0, y0, x1, y1, ramp, tone = -1) {
    this._bresenham(x0, y0, x1, y1, (x, y) => this.set(x, y, ramp, tone));
  }

  dotLine(x0, y0, x1, y1, color) {
    this._bresenham(x0, y0, x1, y1, (x, y) => this.dot(x, y, color));
  }

  // A thick limb: stamps a run of `w` pixels across the main axis at each step.
  limb(x0, y0, x1, y1, w, ramp, tone = -1) {
    const vertical = Math.abs(y1 - y0) >= Math.abs(x1 - x0);
    this._bresenham(x0, y0, x1, y1, (x, y) => {
      for (let k = 0; k < w; k++) {
        if (vertical) this.set(x + k, y, ramp, tone);
        else this.set(x, y + k, ramp, tone);
      }
    });
  }

  _bresenham(x0, y0, x1, y1, plot) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 256; guard++) {
      plot(x0, y0);
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

  // Shade, outline and flatten to RGBA bytes.
  //
  // Shading has two layers. The edge tone (_autoTone) keeps the crisp pixel-art
  // read: lit top/left edges, dark bottom/right edges, cast shadows from parts in
  // front. On top of it, every part is shaded as a soft volume: its position inside
  // its own horizontal and vertical run gives a normal, lit from the upper left, and
  // the result is quantized over a 7-level ramp (the 3 authored tones, the blends
  // between them, a deep shadow and a highlight) with a 1-pixel ordered dither where
  // two levels meet. Ramps listed in `rimRamps` (hair, cloaks) also catch a cool
  // rim light along their shadow-side silhouette, as if lit from behind.
  render({ outline = OUTLINE, tintOutline = true, volume = this.volume !== false, dither = this.dither !== false } = {}) {
    const { w, h, part, parts } = this;
    const out = new Uint8ClampedArray(w * h * 4);
    const ext = volume ? this._runs() : null;
    const rim = this.rimRamps || null;
    const rimRgb = rgbOf(this.rimColor || RIM_COLOR);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const p = part[i];
        if (p < 0) continue;
        let rgb;
        const c = this.color[i];
        if (c) rgb = rgbOf(c);
        else {
          const ramp = this.ramp[i];
          const forced = this.tone[i];
          const opts = parts[p];
          if (forced >= 0 || !ext || opts.flat || opts.noVolume) {
            const t = forced >= 0 ? forced : this._autoTone(x, y, p, opts);
            rgb = rgbOf(ramp[Math.max(0, Math.min(ramp.length - 1, t))]);
          } else {
            const edge = this._autoTone(x, y, p, opts);
            const sx = ext.x1[i] - ext.x0[i];
            const sy = ext.y1[i] - ext.y0[i];
            const nx = sx >= 2 ? ((x - ext.x0[i]) / sx) * 2 - 1 : 0;
            const ny = sy >= 2 ? ((y - ext.y0[i]) / sy) * 2 - 1 : 0;
            // 3 = the mid tone; light from the upper left; the edge tone sharpens rims.
            let v = 3 - 1.25 * nx - 0.95 * ny + (edge - 1) * 1.05;
            if (edge === 0 && opts.noShadow !== true) v -= 0.25;
            let lv = Math.floor(v);
            const f = v - lv;
            if (f > 0.57 || (f > 0.43 && dither && ((x + y) & 1) === 0)) lv++;
            if (lv < 0) lv = 0;
            else if (lv > 6) lv = 6;
            rgb = levelsOf(ramp)[lv];
            if (rim && rim.has(ramp) && nx > 0.15 && this._backEdge(x, y)) {
              rgb = [rgb[0] + (rimRgb[0] - rgb[0]) * 0.5, rgb[1] + (rimRgb[1] - rgb[1]) * 0.5, rgb[2] + (rimRgb[2] - rgb[2]) * 0.5];
            }
          }
        }
        const o = i * 4;
        out[o] = rgb[0];
        out[o + 1] = rgb[1];
        out[o + 2] = rgb[2];
        out[o + 3] = Math.round(255 * this.alpha[i]);
      }
    }
    if (outline) this._outline(out, outline, tintOutline);
    return out;
  }

  // Horizontal and vertical extents of each pixel's run within its own part.
  _runs() {
    const { w, h, part } = this;
    const n = w * h;
    const x0 = new Int16Array(n);
    const x1 = new Int16Array(n);
    const y0 = new Int16Array(n);
    const y1 = new Int16Array(n);
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        const p = part[y * w + x];
        if (p < 0) {
          x++;
          continue;
        }
        let e = x;
        while (e + 1 < w && part[y * w + e + 1] === p) e++;
        for (let k = x; k <= e; k++) {
          x0[y * w + k] = x;
          x1[y * w + k] = e;
        }
        x = e + 1;
      }
    }
    for (let x = 0; x < w; x++) {
      let y = 0;
      while (y < h) {
        const p = part[y * w + x];
        if (p < 0) {
          y++;
          continue;
        }
        let e = y;
        while (e + 1 < h && part[(e + 1) * w + x] === p) e++;
        for (let k = y; k <= e; k++) {
          y0[k * w + x] = y;
          y1[k * w + x] = e;
        }
        y = e + 1;
      }
    }
    return { x0, x1, y0, y1 };
  }

  // On the silhouette's far side (right or lower right): where a back light would catch.
  _backEdge(x, y) {
    return this.partAt(x + 1, y) < 0 || (this.partAt(x + 1, y + 1) < 0 && this.partAt(x, y + 1) < 0);
  }

  _autoTone(x, y, p, opts) {
    if (opts.flat) return 1;
    const qL = this.partAt(x - 1, y);
    const qT = this.partAt(x, y - 1);
    const qR = this.partAt(x + 1, y);
    const qB = this.partAt(x, y + 1);
    const casts = (q) => {
      if (q <= p) return false;
      const s = this.parts[q].shadow ?? 'all';
      return s !== 'none';
    };
    const castsTop = (q) => {
      if (q <= p) return false;
      const s = this.parts[q].shadow ?? 'all';
      return s === 'all' || s === 'top';
    };
    // Something in front of this pixel, above or to its left, shades it.
    if (castsTop(qT) || (casts(qL) && (this.parts[qL].shadow ?? 'all') === 'all')) return opts.noShadow ? 1 : 0;
    const exL = qL !== p && qL < p;
    const exT = qT !== p && qT < p;
    const exR = qR !== p && qR < p;
    const exB = qB !== p && qB < p;
    let dark = !opts.noShadow && (exR || (exB && !opts.noBottom));
    if (!dark && opts.band && !opts.noShadow) {
      for (let k = 2; k <= opts.band; k++) {
        const q = this.partAt(x + k, y);
        if (q !== p && q < p) {
          // only when the run to that edge is all this part
          let solid = true;
          for (let j = 1; j < k; j++) if (this.partAt(x + j, y) !== p) solid = false;
          if (solid) dark = true;
          break;
        }
      }
    }
    const lit = !opts.noLight && (exL || exT);
    if (dark && lit) return opts.thinLight ? 2 : 1;
    if (dark) return 0;
    if (lit) return 2;
    return 1;
  }

  _outline(out, color, tint) {
    const { w, h, part, parts } = this;
    const base = rgbOf(color);
    const solid = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      const i = y * w + x;
      const p = part[i];
      return p >= 0 && !parts[p].noOutline && this.alpha[i] >= 0.5;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (solid(x, y)) continue;
        // Translucent or glow pixels may sit here; the outline goes under nothing opaque.
        if (part[i] >= 0 && this.alpha[i] >= 0.5) continue;
        const r = solid(x + 1, y);
        const b = solid(x, y + 1);
        const l = solid(x - 1, y);
        const t = solid(x, y - 1);
        if (!(r || b || l || t)) continue;
        let rgb = base;
        if (tint && (r || b) && !(l || t)) {
          // Lit side of the shape: a slightly colored outline reads softer.
          const ni = r ? i + 1 : i + w;
          const nc = this._pixelRgb(out, ni);
          rgb = [base[0] + (nc[0] - base[0]) * 0.28, base[1] + (nc[1] - base[1]) * 0.28, base[2] + (nc[2] - base[2]) * 0.28];
        }
        const o = i * 4;
        // A glow pixel under the outline is replaced: outlines stay crisp.
        out[o] = rgb[0];
        out[o + 1] = rgb[1];
        out[o + 2] = rgb[2];
        out[o + 3] = 255;
      }
    }
  }

  _pixelRgb(out, i) {
    const o = i * 4;
    return [out[o], out[o + 1], out[o + 2]];
  }
}

// Glow halo pixels: soft, unoutlined light around a point (cast effects, crystals).
export function glow(s, cx, cy, r, color, strength = 0.6) {
  s.begin({ flat: true, noOutline: true, shadow: 'none' });
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d > 1) continue;
      if (s.isSet(x, y) && s.alpha[y * s.w + x] >= 0.5) continue;
      s.dot(x, y, color, Math.max(0.12, strength * (1 - d) * (1 - d) + 0.1));
    }
  }
}
