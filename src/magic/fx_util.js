// Small shared helpers for the Weave's look (fx_*.js): colors, canvases, cheap noise.
// Nothing here touches the DOM at import time; canvases are made on first use, and in
// node (tests) a stub canvas is returned when there is no document.

export const TAU = Math.PI * 2;

// ------------------------------------------------------------------ colors

const rgbCache = new Map();

export function rgbOf(hex) {
  let c = rgbCache.get(hex);
  if (c) return c;
  let s = String(hex || '#ffffff').trim();
  if (s[0] === '#') s = s.slice(1);
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s.slice(0, 6), 16);
  c = Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255];
  if (rgbCache.size > 2048) rgbCache.clear();
  rgbCache.set(hex, c);
  return c;
}

const hex2 = (v) => {
  const n = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  return (n < 16 ? '0' : '') + n.toString(16);
};

export function toHex(r, g, b) {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

const mixCache = new Map();
// a -> b by t (0..1), cached by the three inputs (t quantized to 1/32).
export function mix(a, b, t) {
  const q = Math.round(Math.max(0, Math.min(1, t)) * 32);
  const key = `${a}${b}${q}`;
  let out = mixCache.get(key);
  if (out) return out;
  const A = rgbOf(a);
  const B = rgbOf(b);
  const k = q / 32;
  out = toHex(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k);
  if (mixCache.size > 4096) mixCache.clear();
  mixCache.set(key, out);
  return out;
}

export const lighten = (c, t) => mix(c, '#ffffff', t);
export const darken = (c, t) => mix(c, '#0b0716', t);

// Perceived brightness 0..1.
export function luma(c) {
  const [r, g, b] = rgbOf(c);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// A readable version of a color for text on the dark outline: never too dark.
export function readable(c) {
  const l = luma(c);
  return l < 0.62 ? lighten(c, Math.min(0.7, 0.62 - l + 0.25)) : c;
}

// ------------------------------------------------------------------ canvases

// A stub canvas for environments with no DOM (unit tests): every draw is a no-op.
const STUB_CTX = new Proxy(
  {},
  {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => STUB_CTX;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  },
);

export function makeCanvas(w, h) {
  const W = Math.max(1, Math.ceil(w));
  const H = Math.max(1, Math.ceil(h));
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    return c;
  }
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(W, H);
  return { width: W, height: H, stub: true, getContext: () => STUB_CTX };
}

export function ctx2d(canvas) {
  const c = canvas.getContext('2d');
  if (c && 'imageSmoothingEnabled' in c) c.imageSmoothingEnabled = false;
  return c || STUB_CTX;
}

// ------------------------------------------------------------------ noise

// A cheap deterministic hash in 0..1 from a few numbers (stable flicker, jitter).
export function hash(a, b = 0, c = 0) {
  let h = Math.imul((a * 73856093) | 0, 0x27d4eb2d) ^ Math.imul((b * 19349663) | 0, 0x165667b1) ^ Math.imul((c * 83492791) | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Smooth-ish flicker 0..1 for a light or a flame (two incommensurate sines).
export function flicker(t, seed = 0) {
  return 0.5 + 0.3 * Math.sin(t * 13.7 + seed * 17) + 0.2 * Math.sin(t * 29.3 + seed * 5.1);
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);
