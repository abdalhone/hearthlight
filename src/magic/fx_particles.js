import { TAU, makeCanvas, ctx2d, mix } from './fx_util.js';

// The Weave's own particles: a fixed pool in typed arrays (no allocation per particle
// once warm), styles named by essence look (flame tongues, drops, shards, zigzag sparks,
// pebbles, gusts, leaves, bubbles, motes, wisps, filings, notes…). Colors come from a
// palette as a short ramp, interned once per (style, palette). Particles live on the
// ground plane (x, y) with a height z, are drawn into the low-res world buffer, and the
// glowing ones are drawn again into the glow buffer (fx.js adds it after the lighting).

export const SHAPE = { PX: 0, TONGUE: 1, DROP: 2, RING: 3, SHARD: 4, ZIG: 5, CROSS: 6, LEAF: 7, NOTE: 8, ARC: 9, PUFF: 10, CHIP: 11, HEART: 12 };

const NOTE_PX = [1, 0, 2, 0, 1, 1, 1, 2, 0, 3, 1, 3, 0, 4, 1, 4];
const HEART_PX = [0, 0, 2, 0, 0, 1, 1, 1, 2, 1, 1, 2];

// Style table. speed/vz/life/size are [min, max]; gravity pulls z down (px/s²), rise
// lifts it at a constant rate, drag is exponential (1/s), sway wobbles x, bounce keeps a
// share of the fall speed on landing, settle rests on the ground, glow = also in the
// glow buffer, alpha scales it, ramp(p) picks colors from a palette (brightest first).
const GREYS = ['#8e8a95', '#6a6a7c', '#4d4a5a'];
const STYLE_DEFS = {
  mote: { shape: SHAPE.CROSS, speed: [6, 26], vz: [4, 16], life: [0.4, 0.8], drag: 2.5, glow: true, ramp: (p) => [p.core, p.spark, p.glow] },
  twinkle: { shape: SHAPE.CROSS, speed: [2, 12], vz: [2, 8], life: [0.4, 0.9], drag: 2, glow: true, ramp: (p) => [p.core, p.core, p.spark] },
  spark: { shape: SHAPE.PX, speed: [40, 110], vz: [10, 50], life: [0.2, 0.45], gravity: 200, drag: 1.5, bounce: 0.4, glow: true, ramp: (p) => [p.core, p.spark, p.glow] },
  ember: { shape: SHAPE.PX, speed: [4, 14], vz: [0, 6], rise: 22, life: [0.6, 1.3], drag: 1, sway: 2.5, glow: true, flick: true, ramp: (p) => [p.spark, p.glow, p.deep] },
  flame: { shape: SHAPE.TONGUE, speed: [4, 16], vz: [0, 4], rise: 34, life: [0.22, 0.48], size: [2, 4], drag: 3, sway: 1.2, glow: true, ramp: (p) => [p.core, p.spark, p.glow, p.deep] },
  drop: { shape: SHAPE.DROP, speed: [16, 50], vz: [30, 80], life: [0.35, 0.7], gravity: 300, glow: false, ramp: (p) => [p.core, p.glow, p.glow] },
  drip: { shape: SHAPE.DROP, speed: [0, 4], vz: [-10, 0], life: [0.35, 0.6], gravity: 220, ramp: (p) => [p.glow, p.glow, p.deep] },
  foam: { shape: SHAPE.PX, speed: [10, 40], vz: [20, 60], life: [0.25, 0.5], gravity: 260, ramp: (p) => [p.core, p.spark] },
  bubble: { shape: SHAPE.RING, speed: [2, 10], vz: [0, 4], rise: 14, life: [0.5, 1.1], size: [1, 2], drag: 2, sway: 1.5, glow: true, alpha: 0.9, ramp: (p) => [p.spark, p.glow, p.glow] },
  shard: { shape: SHAPE.SHARD, speed: [30, 90], vz: [20, 60], life: [0.3, 0.6], gravity: 240, drag: 1, bounce: 0.25, glow: true, ramp: (p) => [p.core, p.glow, p.deep] },
  snow: { shape: SHAPE.PX, speed: [2, 10], vz: [-4, 4], life: [0.6, 1.2], gravity: 14, drag: 1.5, sway: 2, glow: true, ramp: (p) => [p.core, p.spark] },
  zap: { shape: SHAPE.ZIG, speed: [10, 50], vz: [0, 20], life: [0.07, 0.18], drag: 4, glow: true, ramp: (p) => [p.core, p.spark, p.glow] },
  dust: { shape: SHAPE.PUFF, speed: [6, 22], vz: [2, 8], life: [0.4, 0.8], size: [1, 3], drag: 4, alpha: 0.5, ramp: (p) => [mix(p.spark, GREYS[0], 0.4), mix(p.glow, GREYS[1], 0.5)] },
  pebble: { shape: SHAPE.CHIP, speed: [20, 60], vz: [40, 90], life: [0.6, 1.1], gravity: 300, drag: 1, bounce: 0.3, settle: true, ramp: (p) => [p.glow, p.deep, p.deep] },
  gust: { shape: SHAPE.ARC, speed: [30, 70], vz: [0, 6], life: [0.25, 0.5], drag: 2, alpha: 0.75, ramp: (p) => [p.core, p.spark, p.glow] },
  leaf: { shape: SHAPE.LEAF, speed: [10, 34], vz: [10, 30], life: [0.7, 1.4], gravity: 60, drag: 2, sway: 3, settle: true, ramp: (p) => [p.glow, p.deep] },
  petal: { shape: SHAPE.LEAF, speed: [8, 26], vz: [10, 26], life: [0.6, 1.2], gravity: 50, drag: 2, sway: 3, glow: true, ramp: (p) => [p.spark, p.core] },
  wisp: { shape: SHAPE.PUFF, speed: [4, 14], vz: [0, 4], rise: 12, life: [0.5, 1.1], size: [1, 3], drag: 2, sway: 2, alpha: 0.6, dark: true, ramp: (p) => [p.deep, p.deep, mix(p.deep, p.glow, 0.4)] },
  filing: { shape: SHAPE.PX, speed: [20, 60], vz: [20, 60], life: [0.5, 0.9], gravity: 260, drag: 1, bounce: 0.2, settle: true, glow: true, flick: true, ramp: (p) => [p.core, p.glow, p.deep] },
  note: { shape: SHAPE.NOTE, speed: [4, 12], vz: [4, 10], rise: 14, life: [0.8, 1.3], drag: 1.5, sway: 3, glow: true, ramp: (p) => [p.core, p.spark, p.glow] },
  heart: { shape: SHAPE.HEART, speed: [0, 6], vz: [6, 12], rise: 10, life: [0.9, 1.3], drag: 1, sway: 2.5, glow: true, ramp: (p) => [p.spark, p.glow] },
  mud: { shape: SHAPE.CHIP, speed: [14, 40], vz: [30, 70], life: [0.5, 0.9], gravity: 300, settle: true, ramp: () => ['#7a5a32', '#5a3f22'] },
  steam: { shape: SHAPE.PUFF, speed: [4, 16], vz: [4, 10], rise: 16, life: [0.6, 1.2], size: [2, 5], drag: 2.5, sway: 2, alpha: 0.42, ramp: () => ['#f4f8fb', '#d9e2ea', '#b8c4cf'] },
  smoke: { shape: SHAPE.PUFF, speed: [4, 14], vz: [4, 10], rise: 12, life: [0.8, 1.6], size: [2, 5], drag: 1.5, sway: 2, alpha: 0.38, ramp: () => GREYS },
  ring: { shape: SHAPE.RING, speed: [0, 4], vz: [0, 0], life: [0.3, 0.5], size: [1, 3], glow: true, ramp: (p) => [p.core, p.glow] },
};

const STYLE_NAMES = Object.keys(STYLE_DEFS);
const STYLES = STYLE_NAMES.map((name, id) => {
  const d = STYLE_DEFS[name];
  return {
    id,
    name,
    shape: d.shape,
    speed: d.speed || [0, 0],
    vz: d.vz || [0, 0],
    life: d.life || [0.4, 0.8],
    size: d.size || [1, 1],
    gravity: d.gravity || 0,
    rise: d.rise || 0,
    drag: d.drag || 0,
    sway: d.sway || 0,
    bounce: d.bounce || 0,
    settle: !!d.settle,
    glow: !!d.glow,
    dark: !!d.dark,
    flick: !!d.flick,
    alpha: d.alpha ?? 1,
    ramp: d.ramp,
  };
});
const STYLE_ID = new Map(STYLES.map((s) => [s.name, s.id]));
export const PARTICLE_STYLES = STYLE_NAMES;

export function styleId(name) {
  const id = STYLE_ID.get(name);
  return id === undefined ? STYLE_ID.get('mote') : id;
}

// Interned colors and ramps (a ramp is up to five color ids).
const COLORS = [];
const COLOR_ID = new Map();
function colorId(c) {
  let id = COLOR_ID.get(c);
  if (id === undefined) {
    if (COLORS.length >= 4000) return 0;
    id = COLORS.length;
    COLORS.push(c);
    COLOR_ID.set(c, id);
  }
  return id;
}
const RAMPS = [];
const RAMP_LEN = [];
const rampCache = new WeakMap(); // palette -> Int32Array (ramp id per style, -1 = not built)

export function rampFor(style, pal) {
  let per = rampCache.get(pal);
  if (!per) {
    per = new Int32Array(STYLES.length).fill(-1);
    rampCache.set(pal, per);
  }
  let r = per[style];
  if (r >= 0) return r;
  if (RAMPS.length >= 8000) return 0;
  const cols = STYLES[style].ramp(pal).slice(0, 5).map(colorId);
  r = RAMPS.length;
  RAMPS.push(Uint16Array.from(cols));
  RAMP_LEN.push(cols.length);
  per[style] = r;
  return r;
}

const rand = (a, b) => a + (b - a) * Math.random();

export class FxParticles {
  constructor(capacity = 1100) {
    this.cap = capacity;
    this.n = 0;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.seed = new Float32Array(capacity);
    this.style = new Uint8Array(capacity);
    this.ramp = new Uint16Array(capacity);
    this.rest = new Uint8Array(capacity);
    this._drag = new Float32Array(STYLES.length);
    this._puffs = new Map();
    this.glowN = 0;
  }

  get count() {
    return this.n;
  }

  get load() {
    return this.n / this.cap;
  }

  clear() {
    this.n = 0;
  }

  // How many of `n` wanted particles to actually make, given how full the pool is
  // (stochastic rounding, so small emitters still emit on average).
  budget(n) {
    const l = this.n / this.cap;
    let k = n;
    if (l > 0.55) k = n * Math.max(0, 1 - (l - 0.55) / 0.4);
    const f = Math.floor(k);
    return f + (Math.random() < k - f ? 1 : 0);
  }

  // One particle with an exact velocity. Returns its index or -1.
  add(style, ramp, x, y, z, vx, vy, vz, life = 0, size = 0) {
    if (this.n >= this.cap || !Number.isFinite(x) || !Number.isFinite(y)) return -1;
    const S = STYLES[style];
    if (!S) return -1;
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z > 0 ? z : 0;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = life > 0 ? life : rand(S.life[0], S.life[1]);
    this.size[i] = size > 0 ? size : rand(S.size[0], S.size[1]);
    this.seed[i] = Math.random();
    this.style[i] = style;
    this.ramp[i] = ramp;
    this.rest[i] = 0;
    return i;
  }

  // A spray of `n` particles of a style in a palette from (x, y, z): radial when `ang`
  // is NaN, else around `ang` by `spread` radians. speedMul scales the style's speed.
  burst(styleName, pal, x, y, z, n, speedMul = 1, ang = NaN, spread = TAU) {
    const st = styleId(styleName);
    const S = STYLES[st];
    const ramp = rampFor(st, pal);
    const k = this.budget(n);
    for (let j = 0; j < k; j++) {
      const a = Number.isNaN(ang) ? Math.random() * TAU : ang + (Math.random() - 0.5) * spread;
      const sp = rand(S.speed[0], S.speed[1]) * speedMul;
      if (this.add(st, ramp, x, y, z, Math.cos(a) * sp, Math.sin(a) * sp * 0.75, rand(S.vz[0], S.vz[1]) * (0.6 + 0.4 * speedMul)) < 0) break;
    }
  }

  update(dt) {
    if (!this.n || !(dt > 0)) return;
    for (let s = 0; s < STYLES.length; s++) this._drag[s] = STYLES[s].drag > 0 ? Math.exp(-STYLES[s].drag * dt) : 1;
    let i = 0;
    while (i < this.n) {
      const age = this.age[i] + dt;
      if (age >= this.life[i]) {
        this._kill(i);
        continue;
      }
      this.age[i] = age;
      if (this.rest[i]) {
        i++;
        continue;
      }
      const S = STYLES[this.style[i]];
      const d = this._drag[S.id];
      this.vx[i] *= d;
      this.vy[i] *= d;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      if (S.gravity) this.vz[i] -= S.gravity * dt;
      else this.vz[i] *= d;
      let z = this.z[i] + (this.vz[i] + S.rise) * dt;
      if (z < 0) {
        if (S.gravity) {
          if (S.bounce > 0 && this.vz[i] < -30) {
            z = 0;
            this.vz[i] = -this.vz[i] * S.bounce;
            this.vx[i] *= 0.6;
            this.vy[i] *= 0.6;
          } else if (S.settle) {
            z = 0;
            this.rest[i] = 1;
            this.vx[i] = this.vy[i] = this.vz[i] = 0;
            // Resting bits fade sooner.
            this.life[i] = Math.min(this.life[i], age + 0.5);
          } else {
            this._kill(i);
            continue;
          }
        } else z = 0;
      }
      this.z[i] = z;
      i++;
    }
  }

  _kill(i) {
    const j = --this.n;
    if (i === j) return;
    this.x[i] = this.x[j];
    this.y[i] = this.y[j];
    this.z[i] = this.z[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.vz[i] = this.vz[j];
    this.age[i] = this.age[j];
    this.life[i] = this.life[j];
    this.size[i] = this.size[j];
    this.seed[i] = this.seed[j];
    this.style[i] = this.style[j];
    this.ramp[i] = this.ramp[j];
    this.rest[i] = this.rest[j];
  }

  _alpha(i, S) {
    const t = this.age[i] / this.life[i];
    let a = S.alpha * (t < 0.08 ? 0.4 + t * 7.5 : 1) * (t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1);
    if (S.flick) a *= 0.55 + 0.45 * Math.sin(this.age[i] * 40 + this.seed[i] * 30);
    return a;
  }

  // Buffer pass: every particle (dark wisps and smoke included), world px into the buffer.
  draw(ctx, ox, oy) {
    if (!this.n) return;
    const w = ctx.canvas?.width ?? 4096;
    const h = ctx.canvas?.height ?? 4096;
    let glowN = 0;
    for (let i = 0; i < this.n; i++) {
      const S = STYLES[this.style[i]];
      if (S.glow) glowN++;
      const sx = Math.round(this.x[i] - ox + (S.sway ? Math.sin(this.age[i] * 5 + this.seed[i] * 20) * S.sway : 0));
      const sy = Math.round(this.y[i] - oy - this.z[i]);
      if (sx < -8 || sy < -8 || sx > w + 8 || sy > h + 8) continue;
      const a = this._alpha(i, S);
      if (a <= 0.03) continue;
      ctx.globalAlpha = a > 1 ? 1 : a;
      this._shape(ctx, i, S, sx, sy, false);
    }
    this.glowN = glowN;
    ctx.globalAlpha = 1;
  }

  // Glow pass: the glowing ones again, brighter, into the glow buffer (additive there).
  drawGlow(g, ox, oy, bounds) {
    if (!this.n || !this.glowN) return;
    const w = g.canvas?.width ?? 4096;
    const h = g.canvas?.height ?? 4096;
    for (let i = 0; i < this.n; i++) {
      const S = STYLES[this.style[i]];
      if (!S.glow) continue;
      const sx = Math.round(this.x[i] - ox + (S.sway ? Math.sin(this.age[i] * 5 + this.seed[i] * 20) * S.sway : 0));
      const sy = Math.round(this.y[i] - oy - this.z[i]);
      if (sx < -8 || sy < -8 || sx > w + 8 || sy > h + 8) continue;
      const a = this._alpha(i, S);
      if (a <= 0.05) continue;
      g.globalAlpha = a > 1 ? 1 : a;
      this._shape(g, i, S, sx, sy, true);
      if (bounds) bounds.add(sx, sy, 4);
    }
    g.globalAlpha = 1;
  }

  _color(i, t) {
    const r = this.ramp[i];
    const n = RAMP_LEN[r] || 1;
    const k = Math.min(n - 1, Math.floor(t * n));
    return COLORS[RAMPS[r][k]];
  }

  _shape(ctx, i, S, x, y, glow) {
    const t = this.age[i] / this.life[i];
    ctx.fillStyle = this._color(i, glow ? t * 0.6 : t);
    const s = this.size[i];
    switch (S.shape) {
      case SHAPE.PX: {
        const k = s >= 1.5 ? 2 : 1;
        ctx.fillRect(x, y, k, k);
        break;
      }
      case SHAPE.TONGUE: {
        // A flame tongue: tall when young, a single ember at the end.
        const hgt = Math.max(1, Math.round(s * (1 - t) + 0.5));
        ctx.fillRect(x, y - hgt + 1, 1, hgt);
        if (s > 2.5 && t < 0.5) ctx.fillRect(x + 1, y - 1, 1, 2);
        break;
      }
      case SHAPE.DROP:
        ctx.fillRect(x, y - 1, 1, 2);
        break;
      case SHAPE.RING: {
        const r = s >= 1.5 ? 2 : 1;
        ctx.fillRect(x - r, y, 1, 1);
        ctx.fillRect(x + r, y, 1, 1);
        ctx.fillRect(x, y - r, 1, 1);
        ctx.fillRect(x, y + r, 1, 1);
        if (r > 1) {
          ctx.fillRect(x - 1, y - 1, 1, 1);
          ctx.fillRect(x + 1, y - 1, 1, 1);
          ctx.fillRect(x - 1, y + 1, 1, 1);
          ctx.fillRect(x + 1, y + 1, 1, 1);
        }
        break;
      }
      case SHAPE.SHARD: {
        const vx = this.vx[i];
        const vy = this.vy[i] - this.vz[i] * 0.5;
        const l = Math.hypot(vx, vy) || 1;
        const ux = vx / l;
        const uy = vy / l;
        for (let k = 0; k < 3; k++) ctx.fillRect(Math.round(x - ux * k), Math.round(y - uy * k), 1, 1);
        break;
      }
      case SHAPE.ZIG: {
        // Three short jagged steps, re-rolled as it lives.
        const ph = Math.floor(this.age[i] * 40 + this.seed[i] * 7);
        let px = x;
        let py = y;
        for (let k = 0; k < 3; k++) {
          const dx = ((ph + k) & 1 ? 1 : -1) * (1 + (k & 1));
          const dy = -1 - ((ph >> k) & 1);
          ctx.fillRect(px, py, 1, 1);
          px += dx;
          py += dy;
          ctx.fillRect(Math.round((px + x) / 2), Math.round(py + 1), 1, 1);
        }
        ctx.fillRect(px, py, 1, 1);
        break;
      }
      case SHAPE.CROSS: {
        ctx.fillRect(x, y, 1, 1);
        if (Math.sin(t * Math.PI) > 0.5) {
          ctx.fillRect(x - 1, y, 1, 1);
          ctx.fillRect(x + 1, y, 1, 1);
          ctx.fillRect(x, y - 1, 1, 1);
          ctx.fillRect(x, y + 1, 1, 1);
        }
        break;
      }
      case SHAPE.LEAF: {
        const ph = ((this.age[i] * 7 + this.seed[i] * 6) | 0) & 3;
        if (this.rest[i] || ph === 0) ctx.fillRect(x, y, 2, 1);
        else if (ph === 1) {
          ctx.fillRect(x, y, 1, 1);
          ctx.fillRect(x + 1, y + 1, 1, 1);
        } else if (ph === 2) ctx.fillRect(x, y, 1, 2);
        else {
          ctx.fillRect(x + 1, y, 1, 1);
          ctx.fillRect(x, y + 1, 1, 1);
        }
        break;
      }
      case SHAPE.NOTE:
        for (let k = 0; k < NOTE_PX.length; k += 2) ctx.fillRect(x + NOTE_PX[k] - 1, y + NOTE_PX[k + 1] - 4, 1, 1);
        break;
      case SHAPE.HEART:
        for (let k = 0; k < HEART_PX.length; k += 2) ctx.fillRect(x + HEART_PX[k] - 1, y + HEART_PX[k + 1] - 1, 1, 1);
        break;
      case SHAPE.ARC: {
        // A curl of wind: a short bent streak along its motion.
        const vx = this.vx[i];
        const vy = this.vy[i];
        const l = Math.hypot(vx, vy) || 1;
        const ux = vx / l;
        const uy = vy / l;
        const bend = this.seed[i] > 0.5 ? 1 : -1;
        const len = t < 0.5 ? 5 : 3;
        for (let k = 0; k < len; k++) {
          const c = Math.sin((k / len) * Math.PI) * 1.4 * bend;
          ctx.fillRect(Math.round(x - ux * k * 1.3 - uy * c), Math.round(y - uy * k * 1.3 + ux * c), 1, 1);
        }
        break;
      }
      case SHAPE.PUFF: {
        const rad = Math.max(1, Math.round(s * (0.6 + t * 0.7)));
        ctx.drawImage(this._puff(ctx.fillStyle, rad), x - rad, y - rad);
        break;
      }
      case SHAPE.CHIP: {
        const spin = ((this.age[i] * 14 + this.seed[i] * 4) | 0) & 1;
        if (this.rest[i] || spin) ctx.fillRect(x, y, 2, 1);
        else ctx.fillRect(x, y, 1, 2);
        break;
      }
      default:
        ctx.fillRect(x, y, 1, 1);
    }
  }

  // Pixel discs for puffs, cached per color and radius.
  _puff(color, rad) {
    const r = Math.min(8, rad);
    const key = `${color}|${r}`;
    let c = this._puffs.get(key);
    if (c) return c;
    if (this._puffs.size > 400) this._puffs.clear();
    c = makeCanvas(r * 2 + 1, r * 2 + 1);
    const g = ctx2d(c);
    g.fillStyle = color;
    const r2 = (r + 0.35) * (r + 0.35);
    for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r2) g.fillRect(xx + r, yy + r, 1, 1);
    this._puffs.set(key, c);
    return c;
  }
}
