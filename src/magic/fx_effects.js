import { TAU, hash } from './fx_util.js';
import { disc, ring, line, halo, zig, poly, px, rect, glyphSprite } from './fx_draw.js';

// Short-lived flourishes that are not bodies: shock rings, flashes, crit stars, cast
// sigils, lightning between targets, bolts from the sky, leech threads, afterimages,
// pillars of light, eclipse rings, prisms, ice shards and vines bursting from the
// ground. A fixed pool of records (no allocation once warm), world coordinates.

export const FX = { RING: 0, FLASH: 1, STAR: 2, SIGIL: 3, ZAP: 4, SKYBOLT: 5, THREAD: 6, GHOST: 7, PILLAR: 8, ECLIPSE: 9, PRISM: 10, FAN: 11, SHARDS: 12, VINES: 13, RAYS: 14 };

const DARK_CORE = '#120a1e';
const SPECTRUM = ['#ff6a6a', '#ffb347', '#fff07a', '#7ed957', '#5fbdf0', '#a995ff'];
const PTS = new Float32Array(16);

function blank() {
  return { active: false, type: 0, x: 0, y: 0, x2: 0, y2: 0, z: 0, r0: 0, r1: 0, t: 0, life: 0.3, delay: 0, color: '#ffffff', color2: '#ffffff', pal: null, a: null, b: null, img: null, n: 0, seed: 0, ang: 0, w: 1, sq: 0.6, glyph: null };
}

export class Effects {
  constructor(cap = 220) {
    this.list = [];
    for (let i = 0; i < cap; i++) this.list.push(blank());
    this.live = 0;
    // How many slots new effects may take (the fx layer lowers it in a crowd of weaves
    // or on slow frames; the oldest effect is then reused sooner).
    this.limit = cap;
  }

  // A new effect of `type` at (x, y) living `life` seconds (the oldest is reused when full).
  spawn(type, x, y, life = 0.3) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    let slot = null;
    let oldest = null;
    const n = Math.max(1, Math.min(this.list.length, this.limit | 0));
    for (let i = 0; i < n; i++) {
      const e = this.list[i];
      if (!e.active) {
        slot = e;
        break;
      }
      if (!oldest || e.t / e.life > oldest.t / oldest.life) oldest = e;
    }
    slot = slot || oldest;
    slot.active = true;
    slot.type = type;
    slot.x = x;
    slot.y = y;
    slot.x2 = x;
    slot.y2 = y;
    slot.z = 0;
    slot.r0 = 0;
    slot.r1 = 10;
    slot.t = 0;
    slot.life = Math.max(0.02, life);
    slot.delay = 0;
    slot.color = '#ffffff';
    slot.color2 = '#ffffff';
    slot.pal = null;
    slot.a = null;
    slot.b = null;
    slot.img = null;
    slot.n = 0;
    slot.seed = Math.random();
    slot.ang = 0;
    slot.w = 1;
    slot.sq = 0.6;
    slot.glyph = null;
    return slot;
  }

  clear() {
    for (const e of this.list) {
      e.active = false;
      e.a = e.b = e.img = e.pal = null;
    }
  }

  update(dt) {
    let live = 0;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (!e.active) continue;
      if (e.delay > 0) {
        e.delay -= dt;
        live++;
        continue;
      }
      e.t += dt;
      if (e.t >= e.life) {
        e.active = false;
        e.a = e.b = e.img = e.pal = null;
        continue;
      }
      live++;
    }
    this.live = live;
  }

  draw(R) {
    if (!this.live) return;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (!e.active || e.delay > 0) continue;
      const x = e.x - R.ox;
      const y = e.y - R.oy;
      if (e.type !== FX.ZAP && e.type !== FX.THREAD && (x < -120 || y < -160 || x > R.w + 120 || y > R.h + 120)) continue;
      try {
        DRAW[e.type]?.(R, e, x, y, e.t / e.life);
      } catch {
        e.active = false;
      }
    }
    R.ctx.globalAlpha = 1;
    if (R.g) R.g.globalAlpha = 1;
  }
}

function actorPoint(a, R, out, dy) {
  out.x = a.x - R.ox;
  out.y = a.y - R.oy - (a.z || 0) - dy;
  return out;
}
const P1 = { x: 0, y: 0 };
const P2 = { x: 0, y: 0 };

const DRAW = {
  [FX.RING](R, e, x, y, k) {
    const r = e.r0 + (e.r1 - e.r0) * (1 - (1 - k) * (1 - k));
    const a = 1 - k;
    R.ctx.globalAlpha = a;
    ring(R.ctx, x, y - e.z, r, e.color, e.w, e.sq);
    if (R.g) {
      R.g.globalAlpha = a * 0.8;
      ring(R.g, x, y - e.z, r, e.color2, 1, e.sq);
      R.bounds.add(x, y, r + 2);
    }
  },

  [FX.FLASH](R, e, x, y, k) {
    const a = 1 - k;
    if (k < 0.4) {
      R.ctx.globalAlpha = (1 - k / 0.4) * 0.9;
      disc(R.ctx, x, y - e.z, Math.max(1, e.r1 * 0.22 * (1 - k)), e.color2);
    }
    if (R.g) halo(R.g, x, y - e.z, e.r1 * (0.8 + 0.4 * k), e.color, a * a, R.bounds);
  },

  [FX.STAR](R, e, x, y, k) {
    const a = 1 - k;
    const l = e.r1 * (1 - k * 0.6);
    const l2 = l * 0.5;
    const yy = y - e.z;
    for (const c of R.g ? [R.ctx, R.g] : [R.ctx]) {
      c.globalAlpha = a;
      line(c, x - l, yy, x + l, yy, e.color, 1);
      line(c, x, yy - l, x, yy + l, e.color, 1);
      c.globalAlpha = a * 0.7;
      line(c, x - l2, yy - l2, x + l2, yy + l2, e.color2, 1);
      line(c, x - l2, yy + l2, x + l2, yy - l2, e.color2, 1);
    }
    if (R.g) halo(R.g, x, yy, e.r1 * 1.4, e.color2, 0.7 * a, R.bounds);
  },

  [FX.SIGIL](R, e, x, y, k) {
    // A glyph circle at the hands: drawn in fast, turns, fades.
    const a = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
    const r = e.r1 * (0.7 + 0.3 * Math.min(1, k * 4));
    const P = e.pal;
    const yy = y - e.z;
    const spin = e.ang + k * 3;
    R.ctx.globalAlpha = a * 0.9;
    ring(R.ctx, x, yy, r, P.glow, 1, 0.55);
    for (let i = 0; i < 6; i++) {
      const an = spin + (i / 6) * TAU;
      px(R.ctx, x + Math.cos(an) * (r + 1.5), yy + Math.sin(an) * (r + 1.5) * 0.55, i & 1 ? P.core : P.spark);
    }
    if (e.glyph) {
      R.ctx.globalAlpha = a * 0.8;
      R.ctx.drawImage(glyphSprite(e.glyph, P.core), Math.round(x) - 3, Math.round(yy) - 4);
    }
    if (R.g) {
      R.g.globalAlpha = a * 0.7;
      ring(R.g, x, yy, r, P.spark, 1, 0.55);
      halo(R.g, x, yy, r * 1.8, P.glow, 0.45 * a, R.bounds);
    }
  },

  [FX.ZAP](R, e, x, y, k) {
    let x1 = x;
    let y1 = y - e.z;
    let x2 = e.x2 - R.ox;
    let y2 = e.y2 - R.oy - e.z;
    if (e.a && !e.a.removed) {
      actorPoint(e.a, R, P1, 8);
      x1 = P1.x;
      y1 = P1.y;
    }
    if (e.b && !e.b.removed) {
      actorPoint(e.b, R, P2, 8);
      x2 = P2.x;
      y2 = P2.y;
    }
    const a = 1 - k;
    const seed = Math.floor(R.time * 30) + e.seed * 1000;
    const segs = Math.max(3, Math.round(Math.hypot(x2 - x1, y2 - y1) / 7));
    R.ctx.globalAlpha = a * 0.7;
    zig(R.ctx, x1, y1, x2, y2, segs, 3.5, seed + 3, e.color2, 2);
    R.ctx.globalAlpha = a;
    zig(R.ctx, x1, y1, x2, y2, segs, 3.5, seed, e.color, 1);
    if (R.g) {
      R.g.globalAlpha = a;
      zig(R.g, x1, y1, x2, y2, segs, 3.5, seed, e.color, 1);
      halo(R.g, x2, y2, 9, e.color2, 0.6 * a, R.bounds);
      R.bounds.add(x1, y1, 6);
    }
  },

  [FX.SKYBOLT](R, e, x, y, k) {
    const a = (1 - k) * (Math.floor(R.time * 40) & 1 ? 1 : 0.55);
    const top = y - 120;
    const sx = x + (e.seed - 0.5) * 30;
    const seed = Math.floor(e.seed * 9999) + Math.floor(k * 4);
    R.ctx.globalAlpha = a * 0.75;
    zig(R.ctx, sx, top, x, y - 2, 10, 6, seed + 1, e.color2, 3);
    R.ctx.globalAlpha = a;
    zig(R.ctx, sx, top, x, y - 2, 10, 6, seed, e.color, 1);
    // A branch off the main bolt.
    zig(R.ctx, sx + (x - sx) * 0.4, top + (y - top) * 0.4, x + 14 * (e.seed > 0.5 ? 1 : -1), y - 30, 4, 3, seed + 7, e.color2, 1);
    if (R.g) {
      R.g.globalAlpha = a;
      zig(R.g, sx, top, x, y - 2, 10, 6, seed, e.color, 2);
      halo(R.g, x, y - 4, 26, e.color2, 0.9 * a, R.bounds);
      R.bounds.add(sx, top, 10);
    }
  },

  [FX.THREAD](R, e, x, y, k) {
    if (!e.a || !e.b || e.a.removed || e.b.removed) return;
    actorPoint(e.a, R, P1, 9);
    actorPoint(e.b, R, P2, 9);
    const mx = (P1.x + P2.x) / 2;
    const my = Math.min(P1.y, P2.y) - 12 - Math.hypot(P2.x - P1.x, P2.y - P1.y) * 0.15;
    const a = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
    const c = R.ctx;
    c.globalAlpha = a * 0.7;
    c.strokeStyle = e.color2;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(P1.x, P1.y);
    c.quadraticCurveTo(mx, my, P2.x, P2.y);
    c.stroke();
    // Motes of life running home along the thread.
    for (let i = 0; i < 3; i++) {
      const q = (k * 1.6 + i / 3) % 1;
      const qx = (1 - q) * (1 - q) * P1.x + 2 * (1 - q) * q * mx + q * q * P2.x;
      const qy = (1 - q) * (1 - q) * P1.y + 2 * (1 - q) * q * my + q * q * P2.y;
      c.globalAlpha = a;
      disc(c, qx, qy, 1.2, e.color);
      if (R.g) {
        R.g.globalAlpha = a;
        px(R.g, qx, qy, e.color);
        R.bounds.add(qx, qy, 3);
      }
    }
  },

  [FX.GHOST](R, e, x, y, k) {
    if (!e.img) return;
    R.ctx.globalAlpha = (1 - k) * e.w;
    R.ctx.drawImage(e.img, Math.round(x), Math.round(y));
    if (R.g) {
      R.g.globalAlpha = (1 - k) * e.w * 0.5;
      R.g.drawImage(e.img, Math.round(x), Math.round(y));
      R.bounds.add(x + 16, y + 16, 18);
    }
  },

  [FX.PILLAR](R, e, x, y, k) {
    const a = 1 - k;
    const w = Math.max(2, e.r1 * (1 - k * 0.5));
    const h = 60 + e.r0;
    R.ctx.globalAlpha = a * 0.55;
    rect(R.ctx, x - w / 2, y - h, w, h, e.color2);
    R.ctx.globalAlpha = a;
    rect(R.ctx, x - 0.5, y - h, 1, h, e.color);
    ring(R.ctx, x, y, w * 1.6 + k * 8, e.color, 1, 0.55);
    if (R.g) {
      R.g.globalAlpha = a * 0.8;
      rect(R.g, x - w / 2, y - h, w, h, e.color2);
      halo(R.g, x, y - 6, w * 4, e.color2, 0.7 * a, R.bounds);
      R.bounds.add(x, y - h, w + 4);
    }
  },

  [FX.ECLIPSE](R, e, x, y, k) {
    const grow = k < 0.35 ? k / 0.35 : 1;
    const a = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    const r = e.r1 * (0.4 + 0.6 * grow);
    const yy = y - 10;
    R.ctx.globalAlpha = a;
    disc(R.ctx, x, yy, r * 0.62, DARK_CORE);
    ring(R.ctx, x, yy, r * 0.66, e.color, 2, 1);
    R.ctx.globalAlpha = a * 0.6;
    ring(R.ctx, x, yy, r * 0.85 + k * 6, e.color2, 1, 1);
    if (R.g) {
      R.g.globalAlpha = a;
      ring(R.g, x, yy, r * 0.66, e.color, 2, 1);
      halo(R.g, x, yy, r * 1.4, e.color2, 0.7 * a, R.bounds);
    }
  },

  [FX.PRISM](R, e, x, y, k) {
    const a = 1 - k;
    const r = e.r0 + (e.r1 - e.r0) * k;
    for (let i = 0; i < SPECTRUM.length; i++) {
      const a0 = (i / SPECTRUM.length) * TAU + k * 2;
      R.ctx.globalAlpha = a;
      ring(R.ctx, x, y - 6, r, SPECTRUM[i], 2, 0.62, a0, a0 + TAU / SPECTRUM.length);
      if (R.g) {
        R.g.globalAlpha = a * 0.8;
        ring(R.g, x, y - 6, r, SPECTRUM[i], 1, 0.62, a0, a0 + TAU / SPECTRUM.length);
      }
    }
    if (R.g) R.bounds.add(x, y, r + 2);
  },

  [FX.FAN](R, e, x, y, k) {
    const a = 1 - k;
    const yy = y - e.z;
    for (let i = 0; i < e.n; i++) {
      const an = e.ang + (i - (e.n - 1) / 2) * e.w;
      const l0 = 4 + k * 8;
      const l1 = 10 + k * 14;
      R.ctx.globalAlpha = a;
      line(R.ctx, x + Math.cos(an) * l0, yy + Math.sin(an) * l0, x + Math.cos(an) * l1, yy + Math.sin(an) * l1, e.color, 1);
      if (R.g) {
        R.g.globalAlpha = a;
        line(R.g, x + Math.cos(an) * l0, yy + Math.sin(an) * l0, x + Math.cos(an) * l1, yy + Math.sin(an) * l1, e.color2, 1);
      }
    }
    if (R.g) R.bounds.add(x, yy, 26);
  },

  [FX.SHARDS](R, e, x, y, k) {
    const grow = Math.min(1, k / 0.18);
    const a = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    const P = e.pal;
    for (let i = 0; i < e.n; i++) {
      const an = (i / e.n) * TAU + e.seed * 6;
      const rr = e.r1 * (0.4 + 0.6 * hash(i, e.seed * 99));
      const sx = x + Math.cos(an) * rr;
      const sy = y + Math.sin(an) * rr * 0.6;
      const h = (5 + hash(i, 7, e.seed * 99) * 7) * grow;
      PTS[0] = sx - 2;
      PTS[1] = sy;
      PTS[2] = sx + 2;
      PTS[3] = sy;
      PTS[4] = sx + Math.cos(an) * 2;
      PTS[5] = sy - h;
      R.ctx.globalAlpha = a;
      poly(R.ctx, PTS, 3, P.glow);
      line(R.ctx, sx - 1, sy - 1, sx + Math.cos(an) * 1.5, sy - h + 1, P.core, 1);
      if (R.g) {
        R.g.globalAlpha = a * 0.6;
        px(R.g, sx + Math.cos(an) * 2, sy - h, '#ffffff');
      }
    }
    if (R.g) R.bounds.add(x, y - 6, e.r1 + 6);
  },

  [FX.VINES](R, e, x, y, k) {
    const grow = Math.min(1, k / 0.3);
    const a = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
    const P = e.pal;
    for (let i = 0; i < e.n; i++) {
      const an = (i / e.n) * TAU + e.seed * 6;
      const sx = x + Math.cos(an) * e.r1;
      const sy = y + Math.sin(an) * e.r1 * 0.6;
      const h = Math.round((6 + hash(i, e.seed * 77) * 6) * grow);
      R.ctx.globalAlpha = a;
      for (let yy = 0; yy < h; yy++) px(R.ctx, sx + Math.round(Math.sin(yy * 0.8 + i) * 1.5), sy - yy, yy & 1 ? P.deep : P.glow);
      if (h > 3) {
        px(R.ctx, sx + 1, sy - h, P.spark);
        px(R.ctx, sx - 1, sy - h + 2, P.glow);
      }
    }
  },

  [FX.RAYS](R, e, x, y, k) {
    const a = 1 - k;
    const yy = y - e.z;
    for (let i = 0; i < e.n; i++) {
      const an = (i / e.n) * TAU + e.ang;
      const l0 = e.r0 + e.r1 * k * 0.5;
      const l1 = e.r0 + e.r1 * (0.4 + k);
      R.ctx.globalAlpha = a;
      line(R.ctx, x + Math.cos(an) * l0, yy + Math.sin(an) * l0 * 0.7, x + Math.cos(an) * l1, yy + Math.sin(an) * l1 * 0.7, e.color, 1);
      if (R.g) {
        R.g.globalAlpha = a;
        line(R.g, x + Math.cos(an) * l0, yy + Math.sin(an) * l0 * 0.7, x + Math.cos(an) * l1, yy + Math.sin(an) * l1 * 0.7, e.color2, 1);
      }
    }
    if (R.g) R.bounds.add(x, yy, e.r0 + e.r1 * 1.4);
  },
};
