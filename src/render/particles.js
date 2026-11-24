// Particles: a fixed pool in typed arrays (no allocation per particle once warm).
// Contract: emit(type, x, y, opts) ; update(dt) ; draw(ctx, ox, oy) into the low-res buffer.
// Types: dust, hit, spark, leaf, wood_chip, stone_chip, magic, heal, smoke, splash, ember,
//        firefly, heart, levelup, poof, rain_splash, blood, note, sparkle.
// opts: { count, color, dir: {x,y}, spread, speed, life, z, size }
//
// (x, y) is a ground position in world px; particles also have a height z, so chips
// arc up and land, embers rise, leaves drift down. Glowing types (sparks, magic,
// heals, embers, fireflies) are drawn after the lighting pass with additive blending
// (drawGlow) so they shine at night; fireflies also emit tiny lights.

const CAPACITY = 1800;
const TAU = Math.PI * 2;

// Shapes, drawn on the world-pixel grid.
const PX = 0;
const PUFF = 1;
const STREAK = 2;
const CHIP = 3;
const LEAF = 4;
const PLUS = 5;
const TWINKLE = 6;
const HEART = 7;
const NOTE = 8;

const HEART_PIXELS = [1, 0, 3, 0, 0, 1, 1, 1, 2, 1, 3, 1, 4, 1, 1, 2, 2, 2, 3, 2, 2, 3];
const NOTE_PIXELS = [1, 0, 2, 0, 1, 1, 1, 2, 0, 3, 1, 3, 0, 4, 1, 4];

// Per-type defaults. Ranges are [min, max]. gravity pulls z down (px/s²); rise is a
// constant upward z speed; drag is exponential (1/s); bounce < 1 keeps a fraction of
// the fall speed on landing; settle = rest on the ground and fade when landing.
const TYPE_DEFS = {
  dust: { count: 5, colors: ['#d6ad7c', '#b98d5e', '#9a7049'], speed: [6, 20], vz: [3, 9], life: [0.35, 0.65], size: [1, 2.6], drag: 5, shape: PUFF, alpha: 0.55 },
  hit: { count: 7, colors: ['#ffffff', '#fff4c0', '#ffe08a'], speed: [60, 130], life: [0.1, 0.22], drag: 10, shape: STREAK, glow: true, z: [4, 10] },
  spark: { count: 8, colors: ['#fff4c0', '#ffe08a', '#ffb047', '#ee7f2d'], speed: [40, 110], vz: [10, 60], life: [0.25, 0.55], gravity: 200, drag: 1.5, bounce: 0.4, shape: PX, glow: true, z: [2, 7] },
  leaf: { count: 1, colors: ['#6fa34c', '#9cc463', '#4a8240', '#e4b83d', '#cf6a48', '#ad7a48'], speed: [3, 10], vz: [-9, -5], life: [4, 7], sway: 5, swayFreq: [1.1, 2.1], shape: LEAF, settle: true, z: [18, 44], fadeIn: 0.5 },
  wood_chip: { count: 6, colors: ['#cf9f66', '#ad7a48', '#8c5a35', '#6b412a'], speed: [20, 55], vz: [40, 90], life: [0.7, 1.2], gravity: 260, drag: 1, bounce: 0.3, shape: CHIP, settle: true, z: [4, 10] },
  stone_chip: { count: 6, colors: ['#bdbccb', '#9593a6', '#727085', '#545266'], speed: [20, 55], vz: [40, 90], life: [0.7, 1.2], gravity: 280, drag: 1, bounce: 0.25, shape: CHIP, settle: true, z: [3, 8] },
  magic: { count: 7, colors: ['#ddd2ff', '#a995ff', '#7a64e0', '#ffffff'], speed: [6, 26], vz: [4, 16], life: [0.4, 0.9], drag: 2.5, shape: TWINKLE, glow: true, halo: 4, z: [4, 12] },
  heal: { count: 9, colors: ['#9ff0b8', '#58cf8f', '#e8fff0'], speed: [4, 14], vz: [14, 28], life: [0.6, 1.1], drag: 1.5, shape: PLUS, glow: true, halo: 3, z: [0, 10] },
  smoke: { count: 3, colors: ['#5f5a69', '#6a6a7c', '#7d7787'], speed: [2, 8], vz: [10, 18], life: [1.3, 2.4], size: [1.2, 4.5], drag: 0.6, sway: 2, shape: PUFF, alpha: 0.36, z: [4, 8], fadeIn: 0.3 },
  splash: { count: 9, colors: ['#8ccbe6', '#cfeeff', '#4b9ac9'], speed: [14, 42], vz: [40, 95], life: [0.3, 0.6], gravity: 280, shape: PX, vanish: true },
  ember: { count: 2, colors: ['#ffe08a', '#ffb047', '#ee7f2d'], speed: [2, 8], vz: [16, 34], life: [0.8, 1.7], drag: 0.8, sway: 3, swayFreq: [2, 4], shape: PX, glow: true, flicker: true, z: [4, 8] },
  firefly: { count: 1, colors: ['#e8ff8a', '#d4f56a'], life: [7, 12], shape: PX, glow: true, halo: 5, wander: true, light: true, z: [4, 14], fadeIn: 1.2 },
  heart: { count: 1, colors: ['#ff7aa2', '#e0577a'], speed: [0, 4], vz: [12, 18], life: [1, 1.4], sway: 2.5, swayFreq: [2, 3], shape: HEART, z: [18, 22], fadeIn: 0.12 },
  levelup: { count: 26, colors: ['#ffe27a', '#fff4c0', '#e4b83d', '#ffffff'], speed: [30, 52], vz: [18, 42], life: [0.8, 1.5], drag: 3.5, shape: TWINKLE, glow: true, halo: 3, z: [2, 14] },
  poof: { count: 10, colors: ['#f0eef5', '#c9c6cf', '#8e8a95'], speed: [18, 42], vz: [4, 10], life: [0.35, 0.6], size: [1.5, 3.5], drag: 6, shape: PUFF, alpha: 0.8, z: [2, 8] },
  rain_splash: { count: 3, colors: ['#cfe3f7', '#9cc3e6'], speed: [8, 22], vz: [18, 36], life: [0.12, 0.26], gravity: 320, shape: PX, alpha: 0.75, vanish: true },
  blood: { count: 5, colors: ['#9e2133', '#6b1424', '#cc3a45'], speed: [15, 45], vz: [20, 55], life: [0.5, 0.9], gravity: 260, shape: PX, settle: true, z: [6, 10] },
  note: { count: 1, colors: ['#ddd2ff', '#ffe27a', '#9ff0b8'], speed: [0, 4], vz: [14, 20], life: [1.2, 1.7], sway: 3, swayFreq: [2, 3], shape: NOTE, z: [18, 22], fadeIn: 0.15 },
  sparkle: { count: 3, colors: ['#ffffff', '#fff4c0', '#ddd2ff'], speed: [0, 10], vz: [0, 6], life: [0.5, 1], drag: 2, shape: TWINKLE, glow: true, halo: 2, z: [0, 10] },
};

export const PARTICLE_TYPES = Object.keys(TYPE_DEFS);

// Resolve defaults once into flat arrays indexed by type id.
const TYPES = PARTICLE_TYPES.map((name, id) => {
  const d = TYPE_DEFS[name];
  return {
    id,
    name,
    count: d.count ?? 4,
    colors: d.colors,
    speed: d.speed ?? [0, 0],
    vz: d.vz ?? [0, 0],
    life: d.life ?? [0.5, 1],
    size: d.size ?? [1, 1],
    gravity: d.gravity ?? 0,
    drag: d.drag ?? 0,
    bounce: d.bounce ?? 0,
    settle: !!d.settle,
    vanish: !!d.vanish,
    sway: d.sway ?? 0,
    swayFreq: d.swayFreq ?? [1.5, 2.5],
    shape: d.shape ?? PX,
    glow: !!d.glow,
    halo: d.halo ?? 0,
    alpha: d.alpha ?? 1,
    wander: !!d.wander,
    light: !!d.light,
    flicker: !!d.flicker,
    z: d.z ?? [0, 0],
    fadeIn: d.fadeIn ?? 0.06,
  };
});
const TYPE_ID = new Map(TYPES.map((t) => [t.name, t.id]));

// Color strings are interned so particles store a small index, not a string.
const COLORS = [];
const COLOR_ID = new Map();
function colorId(c) {
  let id = COLOR_ID.get(c);
  if (id === undefined) {
    if (COLORS.length >= 1024) return 0;
    id = COLORS.length;
    COLORS.push(c);
    COLOR_ID.set(c, id);
  }
  return id;
}
const TYPE_COLOR_IDS = TYPES.map((t) => t.colors.map(colorId));

const rand = (a, b) => a + (b - a) * Math.random();

export class Particles {
  constructor(game, capacity = CAPACITY) {
    this.game = game;
    this.capacity = capacity;
    this.n = 0;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.s0 = new Float32Array(capacity);
    this.s1 = new Float32Array(capacity);
    this.seed = new Float32Array(capacity);
    this.freq = new Float32Array(capacity);
    this.type = new Uint8Array(capacity);
    this.color = new Uint16Array(capacity);
    this.rest = new Uint8Array(capacity); // 1 = landed and resting
    this._drag = new Float32Array(TYPES.length);
    this._puffCache = new Map();
    this.glowCount = 0;
  }

  get count() {
    return this.n;
  }

  clear() {
    this.n = 0;
  }

  // Spawn `count` particles of `type` at a world position. Returns how many spawned.
  emit(type, x, y, opts = {}) {
    const id = TYPE_ID.get(type);
    if (id === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return 0;
    const T = TYPES[id];
    const o = opts || {};
    let count = Number.isFinite(o.count) ? Math.max(0, Math.min(200, Math.round(o.count))) : T.count;
    if (this.game?.settings?.reduceMotion && count > 4) count = Math.ceil(count * 0.6);
    const colorIds = Array.isArray(o.color) ? o.color.map(colorId) : typeof o.color === 'string' ? null : TYPE_COLOR_IDS[id];
    const single = typeof o.color === 'string' ? colorId(o.color) : -1;
    const speedR = rangeOf(o.speed, T.speed);
    const lifeR = rangeOf(o.life, T.life);
    const zR = Number.isFinite(o.z) ? [o.z, o.z] : rangeOf(o.z, T.z);
    const sizeR = o.size != null ? rangeOf(o.size, T.size) : T.size;
    const dir = o.dir;
    const hasDir = dir && (dir.x || dir.y);
    const baseAng = hasDir ? Math.atan2(dir.y, dir.x) : 0;
    const spread = Number.isFinite(o.spread) ? o.spread : hasDir ? 0.9 : TAU;
    const gravity = Number.isFinite(o.gravity) ? o.gravity : null;
    let made = 0;
    for (let k = 0; k < count; k++) {
      if (this.n >= this.capacity) break;
      const i = this.n++;
      const ang = hasDir ? baseAng + (Math.random() - 0.5) * spread : Math.random() * spread;
      const sp = rand(speedR[0], speedR[1]);
      this.x[i] = x;
      this.y[i] = y;
      this.z[i] = rand(zR[0], zR[1]);
      this.vx[i] = Math.cos(ang) * sp;
      this.vy[i] = Math.sin(ang) * sp * 0.75; // the ground plane is seen at an angle
      this.vz[i] = rand(T.vz[0], T.vz[1]);
      if (gravity != null && gravity < 0) this.vz[i] += -gravity * 0.2;
      this.age[i] = 0;
      this.life[i] = Math.max(0.05, rand(lifeR[0], lifeR[1]));
      this.s0[i] = sizeR[0];
      this.s1[i] = sizeR[1];
      this.seed[i] = Math.random();
      this.freq[i] = rand(T.swayFreq[0], T.swayFreq[1]);
      this.type[i] = id;
      this.color[i] = single >= 0 ? single : colorIds[(Math.random() * colorIds.length) | 0];
      this.rest[i] = 0;
      made++;
    }
    return made;
  }

  update(dt) {
    if (!(dt > 0)) return;
    for (let t = 0; t < TYPES.length; t++) this._drag[t] = Math.exp(-TYPES[t].drag * dt);
    let glow = 0;
    for (let i = 0; i < this.n; i++) {
      const age = (this.age[i] += dt);
      if (age >= this.life[i]) {
        this._kill(i);
        i--;
        continue;
      }
      const T = TYPES[this.type[i]];
      if (T.glow) glow++;
      if (this.rest[i]) continue;
      if (T.wander) {
        // Fireflies drift on smooth, looping paths instead of ballistic arcs.
        const s = this.seed[i] * 50;
        this.vx[i] = Math.cos(s + age * 0.7) * 8 + Math.cos(s * 1.7 + age * 1.9) * 3;
        this.vy[i] = Math.sin(s * 1.3 + age * 0.55) * 6 + Math.sin(s * 0.7 + age * 1.6) * 2;
        this.x[i] += this.vx[i] * dt;
        this.y[i] += this.vy[i] * dt;
        continue;
      }
      const k = this._drag[T.id];
      this.vx[i] *= k;
      this.vy[i] *= k;
      if (T.gravity) this.vz[i] -= T.gravity * dt;
      else this.vz[i] *= k;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;
      if (this.z[i] < 0) {
        if (T.vanish) {
          this._kill(i);
          i--;
          continue;
        }
        if (T.bounce > 0 && this.vz[i] < -30) {
          this.z[i] = 0;
          this.vz[i] = -this.vz[i] * T.bounce;
          this.vx[i] *= 0.55;
          this.vy[i] *= 0.55;
        } else if (T.settle || T.gravity) {
          this.z[i] = 0;
          this.vz[i] = 0;
          this.vx[i] = 0;
          this.vy[i] = 0;
          this.rest[i] = 1;
          // A landed chip or leaf lingers briefly, then fades.
          const remain = this.life[i] - age;
          if (remain > 0.9) this.life[i] = age + 0.9;
        } else {
          this.z[i] = 0;
          this.vz[i] = 0;
        }
      }
    }
    this.glowCount = glow;
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
    this.s0[i] = this.s0[j];
    this.s1[i] = this.s1[j];
    this.seed[i] = this.seed[j];
    this.freq[i] = this.freq[j];
    this.type[i] = this.type[j];
    this.color[i] = this.color[j];
    this.rest[i] = this.rest[j];
  }

  _alpha(i, T) {
    const age = this.age[i];
    const life = this.life[i];
    const fin = T.fadeIn > 0 ? Math.min(1, age / T.fadeIn) : 1;
    const u = age / life;
    const fout = u < 0.65 ? 1 : 1 - (u - 0.65) / 0.35;
    let a = T.alpha * fin * fout;
    if (T.flicker) a *= 0.7 + 0.3 * Math.sin(age * 31 + this.seed[i] * 40);
    if (T.wander) {
      const p = 0.5 + 0.5 * Math.sin(age * 2.6 + this.seed[i] * 40);
      a *= 0.25 + 0.75 * p * p;
    }
    return a;
  }

  _swayX(i, T) {
    if (!T.sway || this.rest[i]) return 0;
    return Math.sin(this.age[i] * this.freq[i] + this.seed[i] * 20) * T.sway;
  }

  _height(i, T) {
    if (T.wander) return this.z[i] + Math.sin(this.age[i] * 1.3 + this.seed[i] * 30) * 3;
    return this.z[i];
  }

  // Low-res buffer pass: everything that does not glow. Called with no `layer`
  // (by anything else) it also draws the glowing types, additively, in the buffer.
  draw(ctx, ox, oy, layer) {
    if (!this.n) return;
    const w = ctx.canvas?.width ?? 4096;
    const h = ctx.canvas?.height ?? 4096;
    const all = layer !== 'base';
    for (let pass = 0; pass < (all ? 2 : 1); pass++) {
      const glowPass = pass === 1;
      if (glowPass) ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < this.n; i++) {
        const T = TYPES[this.type[i]];
        if (T.glow !== glowPass) continue;
        const sx = Math.round(this.x[i] - ox + this._swayX(i, T));
        const sy = Math.round(this.y[i] - oy - this._height(i, T));
        if (sx < -8 || sy < -8 || sx > w + 8 || sy > h + 8) continue;
        const a = this._alpha(i, T);
        if (a <= 0.02) continue;
        ctx.globalAlpha = a > 1 ? 1 : a;
        this._shape(ctx, i, T, sx, sy, 1, COLORS[this.color[i]]);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // Full-resolution additive pass for glowing particles, aligned to the world-pixel
  // grid of the upscaled buffer. `r` is the renderer (scale, ox, oy, subX, subY).
  drawGlow(ctx, r) {
    if (!this.n || !this.glowCount) return;
    const scale = r.scale;
    const ox = r.ox;
    const oy = r.oy;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const lighting = this.game?.lighting;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.n; i++) {
      const T = TYPES[this.type[i]];
      if (!T.glow) continue;
      const bx = Math.round(this.x[i] - ox + this._swayX(i, T));
      const by = Math.round(this.y[i] - oy - this._height(i, T));
      const dx = bx * scale - r.subX;
      const dy = by * scale - r.subY;
      if (dx < -40 || dy < -40 || dx > W + 40 || dy > H + 40) continue;
      const a = this._alpha(i, T);
      if (a <= 0.02) continue;
      const color = COLORS[this.color[i]];
      if (T.halo && lighting) {
        const R = T.halo * scale;
        ctx.globalAlpha = Math.min(1, a * 0.45);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(lighting.sprite(color), dx + scale / 2 - R, dy + scale / 2 - R, R * 2, R * 2);
        ctx.imageSmoothingEnabled = false;
      }
      ctx.globalAlpha = a > 1 ? 1 : a;
      this._shape(ctx, i, T, dx, dy, scale, color);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // Draw one particle with its top-left world pixel at (x, y); u = device px per world px.
  _shape(ctx, i, T, x, y, u, color) {
    ctx.fillStyle = color;
    const life = this.life[i];
    const t = this.age[i] / life;
    switch (T.shape) {
      case PX: {
        const s = Math.max(1, Math.round(this.s0[i] + (this.s1[i] - this.s0[i]) * t));
        ctx.fillRect(x, y, s * u, s * u);
        break;
      }
      case STREAK: {
        // A short line along the direction of travel.
        const vx = this.vx[i];
        const vy = this.vy[i];
        const sp = Math.hypot(vx, vy) || 1;
        const ux = vx / sp;
        const uy = vy / sp;
        const len = sp > 40 ? 3 : 2;
        for (let k = 0; k < len; k++) ctx.fillRect(x - Math.round(ux * k) * u, y - Math.round(uy * k) * u, u, u);
        break;
      }
      case CHIP: {
        const spin = ((this.age[i] * 14 + this.seed[i] * 4) | 0) & 1;
        if (this.rest[i] || spin) ctx.fillRect(x, y, 2 * u, u);
        else ctx.fillRect(x, y, u, 2 * u);
        break;
      }
      case LEAF: {
        const ph = ((this.age[i] * this.freq[i] * 1.6 + this.seed[i] * 6) | 0) % 4;
        if (this.rest[i] || ph === 0) ctx.fillRect(x, y, 2 * u, u);
        else if (ph === 1) {
          ctx.fillRect(x, y, u, u);
          ctx.fillRect(x + u, y + u, u, u);
        } else if (ph === 2) ctx.fillRect(x, y, u, 2 * u);
        else {
          ctx.fillRect(x + u, y, u, u);
          ctx.fillRect(x, y + u, u, u);
        }
        break;
      }
      case PLUS: {
        const big = t < 0.7;
        ctx.fillRect(x, y, u, u);
        if (big) {
          ctx.fillRect(x - u, y, u, u);
          ctx.fillRect(x + u, y, u, u);
          ctx.fillRect(x, y - u, u, u);
          ctx.fillRect(x, y + u, u, u);
        }
        break;
      }
      case TWINKLE: {
        // A pixel that blooms into a little cross and back.
        const p = Math.sin(t * Math.PI);
        ctx.fillRect(x, y, u, u);
        if (p > 0.55) {
          ctx.fillRect(x - u, y, u, u);
          ctx.fillRect(x + u, y, u, u);
          ctx.fillRect(x, y - u, u, u);
          ctx.fillRect(x, y + u, u, u);
        }
        break;
      }
      case HEART:
        for (let k = 0; k < HEART_PIXELS.length; k += 2) ctx.fillRect(x + (HEART_PIXELS[k] - 2) * u, y + (HEART_PIXELS[k + 1] - 2) * u, u, u);
        break;
      case NOTE:
        for (let k = 0; k < NOTE_PIXELS.length; k += 2) ctx.fillRect(x + (NOTE_PIXELS[k] - 1) * u, y + (NOTE_PIXELS[k + 1] - 4) * u, u, u);
        break;
      case PUFF: {
        const rad = Math.max(1, Math.round(this.s0[i] + (this.s1[i] - this.s0[i]) * t));
        if (u === 1) ctx.drawImage(this._puff(this.color[i], rad), x - rad, y - rad);
        else ctx.fillRect(x - rad * u, y - rad * u, rad * 2 * u, rad * 2 * u);
        break;
      }
      default:
        ctx.fillRect(x, y, u, u);
    }
  }

  // Pixel discs for smoke and dust, cached per color and radius.
  _puff(cid, rad) {
    const key = cid * 16 + Math.min(15, rad);
    let c = this._puffCache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = rad * 2 + 1;
    const g = c.getContext('2d');
    g.fillStyle = COLORS[cid];
    const r2 = (rad + 0.35) * (rad + 0.35);
    for (let y = -rad; y <= rad; y++) {
      for (let x = -rad; x <= rad; x++) if (x * x + y * y <= r2) g.fillRect(x + rad, y + rad, 1, 1);
    }
    this._puffCache.set(key, c);
    return c;
  }

  // Fireflies light up their surroundings a little.
  collectLights(lighting) {
    if (!lighting) return;
    for (let i = 0; i < this.n; i++) {
      const T = TYPES[this.type[i]];
      if (!T.light) continue;
      const a = this._alpha(i, T);
      if (a < 0.08) continue;
      lighting.addLight(this.x[i] + this._swayX(i, T), this.y[i] - this._height(i, T), 18, '#d8ff7a', a * 0.5, 0, 0.6);
    }
  }

  // How many live particles of a type (used to cap ambient spawners like fireflies).
  countOf(type) {
    const id = TYPE_ID.get(type);
    if (id === undefined) return 0;
    let c = 0;
    for (let i = 0; i < this.n; i++) if (this.type[i] === id) c++;
    return c;
  }
}

function rangeOf(v, fallback) {
  if (Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1])) return v;
  if (Number.isFinite(v)) return [v * 0.6, v];
  return fallback;
}
