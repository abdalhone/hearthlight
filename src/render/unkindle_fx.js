// How the Unkindling looks (round 14b, workstream soul; DESIGN §37.6; the author: "a cool
// scary animation where the soul's literally ripped out of his body and it tries to resist
// but it can't, and I pull it outside of his body").
//
// On the pixelfx host (src/render/pixel_fx.js), in the world buffer at 1 px = 1 world px:
//   - the soul: a pale, cold-blue, dithered translucent copy of the target's OWN sprite frame
//     (the pose they stand in: pixel_fx_bodies.js actorOf), drawn out of the chest toward the
//     player's raised hand, stretched toward it, smeared behind it, shivering;
//   - the resistance: it strains back toward the body in jerks (the channel's `jerk`), the
//     thin wisps between body and soul going taut and bright as it pulls back;
//   - the body it leaves greys and darkens as the light goes out of it, trembles, rises on its
//     toes; at the tear the wisps snap, the soul flares, then gutters like a snuffed candle
//     (shrinking, flickering, leaning, shedding smoke) and is drawn into the hand, which flares
//     cold and goes out; the body sags (squashed at the knees) and lies with no wound, no blood;
//   - a stronger soul snaps back into its body with a cold ring, and the body staggers;
//   - nearby: the colours drain (a 'saturation' wash round the target, a cold cast over it) and
//     the lamps gutter and sputter (their share of the night's light, this frame only); the
//     household flame on the chapel altar gutters at the moment of death.
// Reduce motion: a still version: no shiver, jerk or flicker; the soul eases out and back in,
// the wisps lie still, the drain holds steady and gentler, no ring burst; the host draws it
// smaller, with half the glow and no white pixels.
// Cost: one effect of 128x128 painted at 30 fps under the host's paint budget, one gradient
// wash and a pass over the frame's lights; nothing allocated per frame but the gradient.

import { bodyOf } from '../vendor/pixelfx/fx/spawn/_lib.js';
import { hex, luma, fit, clamp, ease, rand, Rng } from '../vendor/pixelfx/core/index.js';
import { actorOf } from './pixel_fx_bodies.js';
import { TEAR, SAG, DRAWN, SNAP, SLIP } from '../magic/unkindle.js';

export const RAMP = ['#060a16', '#121f3a', '#1f3a66', '#3a6a9c', '#6ea2cf', '#b2dbf2', '#eafaff'];
const HOLLOW = hex('#0a0e1c');
const SMOKE = hex('#2a3550');
const ALTAR = { x: 88.5 * 16, y: 42 * 16 + 4 }; // the chapel altar's flames (worldgen: tiles 87..89, row 42)
const LAMP_REACH = 170; // world px round the target in which lamps gutter
const DRAIN_R = 60; // world px of the colour drain at its least
const TAIL = 1.4; // s the drain and the lamps take to come back
const HOLE = 0.3; // share of the wash's radius left in colour round the two of them

const s01 = (t, d) => clamp(t / d);

// ------------------------------------------------------------------ the soul (a pixelfx effect)

export const meta = {
  name: 'Unkindling',
  desc: "A pale cold copy of the body drawn out toward a raised hand, straining back in jerks on thin wisps, torn free, guttering like a snuffed candle and drawn into the hand.",
  tags: ['soul', 'dark', 'death', 'ghost', 'drain'],
  size: [128, 128],
  origin: [64, 92],
  duration: 1,
  loop: true,
  fps: 30,
  options: { palette: RAMP, seed: 13 },
};

// The nearest body pixel to a local point.
function nearestPixel(list, x, y) {
  let best = list[0];
  let bd = Infinity;
  for (const b of list) {
    const d = (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

export function create(o) {
  const C = fit(o.palette, 7).map(hex);
  const st = o.state || {};
  const body = bodyOf(o.actor, C);
  const list = body.list;
  const W = body.w;
  const H = body.h;
  const R = new Rng(o.seed || 13);
  // Each pixel's step of the cold ramp: its own brightness (a step paler than the body), the
  // rim the palest; and how far down the body it sits (0 the crown, 1 the feet).
  const tone = list.map((b) => (b.edge ? 6 : 3 + Math.min(2, Math.floor(luma(b.c) * 3.4))));
  const row = list.map((b) => b.my / Math.max(1, H - 1));
  const cx0 = body.x + W / 2;
  const cy0 = body.y + H * 0.42; // the chest
  // Where the wisps hold on: crown, chest, both sides, the waist.
  const holdIdx = list.length
    ? [
        [cx0, body.y + 1],
        [cx0, cy0],
        [body.x, body.y + H * 0.48],
        [body.x + W - 1, body.y + H * 0.48],
        [cx0 + 1, body.y + H * 0.72],
      ].map(([x, y]) => list.indexOf(nearestPixel(list, x, y)))
    : [];
  const rim = list.map((b, i) => (b.edge ? i : -1)).filter((i) => i >= 0);
  const motes = []; // { x, y, vx, vy, life, max, smoke }
  let t = 0;
  let snapFrom = 0;
  let lastPhase = '';

  const reduce = () => !!st.reduce;
  const ch = () => st.ch || null;

  // The hand, in local space (the effect is anchored at the target's feet).
  const hand = () => {
    const c = ch();
    const f = c?.fx;
    if (!f) return { x: cx0 + 20, y: cy0 - 6 };
    return { x: f.hx - o.x, y: f.hy - o.y };
  };

  // How far out the soul is (`out`: 0 in the body, 1 risen and leaning toward the hand, held by
  // its tail) and how far, torn free, it has gone on to the hand (`free`: 0..1).
  const phaseOf = () => {
    const c = ch();
    if (!c) return { out: 0, free: 0 };
    const k = clamp(reduce() ? c.k : c.shown);
    const s = (d) => s01(c.phaseT, d);
    switch (c.phase) {
      case 'pull':
        return { out: ease.outCubic(k), free: 0 };
      case 'tear':
        return { out: 1 + 0.14 * ease.outBack(s(TEAR)), free: 0 };
      case 'sag':
        return { out: 1.14, free: 0.45 * ease.inOutSine(s(SAG)) };
      case 'drawn':
        return { out: 1.14, free: 0.45 + 0.55 * ease.inQuad(s(DRAWN)) };
      case 'snap':
        return { out: snapFrom * (reduce() ? 1 - ease.inOutSine(s(SNAP)) : Math.max(-0.12, 1 - ease.outElastic(Math.min(1, s(SNAP) * 0.9 + 0.1)))), free: 0 };
      case 'slip':
        return { out: snapFrom * (1 - ease.inOutSine(s(SLIP))), free: 0 };
      default:
        return { out: 0, free: 0 };
    }
  };

  // The pose of the whole soul this frame: the head's displacement (Dh), the extra move once it
  // is free (Df), its stretch, how far the legs have melted into the tail, and its middle.
  const P0 = { Dh: { x: 0, y: 0 }, Df: { x: 0, y: 0 }, stretch: 1, melt: 0, gx: 0, gy: 0, free: 0, out: 0 };
  const poseNow = () => {
    const { out, free } = phaseOf();
    const hd = hand();
    const o1 = Math.max(-0.2, out);
    // rising up out of the body and leaning toward the raised hand
    const Dh = { x: (hd.x - cx0) * 0.9 * o1, y: (hd.y - cy0) * 0.4 * o1 - 12 * o1 };
    const lead = 1 - 0.72 * Math.pow(0.42, 1.4);
    const c1 = { x: cx0 + Dh.x * lead, y: cy0 * (1 + 0.22 * Math.min(1, Math.max(0, o1))) + Dh.y * lead };
    const Df = { x: (hd.x - c1.x) * free, y: (hd.y - c1.y) * free };
    P0.Dh = Dh;
    P0.Df = Df;
    P0.stretch = 1 + 0.22 * clamp(o1);
    P0.melt = clamp(o1);
    P0.gx = c1.x + Df.x;
    P0.gy = c1.y + Df.y;
    P0.free = free;
    P0.out = out;
    return P0;
  };

  // Where one body pixel of the soul is drawn: the crown leads, the feet stay in the body and
  // thin to a tail; it shivers; free, it goes whole; guttering, it shrinks like a flame.
  const soulAt = (i, p, shrink, sway, back = 1) => {
    const b = list[i];
    const r = row[i];
    const tail = 1 - 0.72 * Math.pow(r, 1.4) * (1 - p.free);
    const dx = p.Dh.x * back;
    const dy = p.Dh.y * back;
    const st2 = 1 + (p.stretch - 1) * back;
    const lineX = cx0 + dx * tail + p.Df.x;
    // it swells a little as it comes out
    let x = cx0 + (b.x - cx0) * (1 + 0.12 * p.melt * (1 - r)) + dx * tail + p.Df.x;
    let y = b.y * st2 + dy * tail + p.Df.y;
    if (r > 0.52 && p.melt > 0) {
      const q = (r - 0.52) / 0.48;
      const narrow = 1 - q * 0.85 * p.melt * (1 - p.free * 0.5);
      x = lineX + (x - lineX) * narrow;
    }
    if (sway) x += Math.sin(t * 9 + b.my * 0.55) * sway * (0.3 + r);
    if (shrink < 1) {
      x = p.gx + (x - p.gx) * shrink;
      y = p.gy + (y - p.gy) * shrink;
      // its top leans and licks like a candle's flame
      if (!reduce()) x += Math.sin(t * 21 + y * 0.6) * (1 - shrink) * 1.5 * clamp((p.gy - y) / 5 + 0.5);
    }
    return [x, y];
  };

  const spawn = (x, y, vx, vy, life, smoke = false) => {
    if (motes.length > 60) return;
    motes.push({ x, y, vx, vy, life, max: life, smoke });
  };

  return {
    update(dt) {
      t += dt;
      const c = ch();
      if (c && c.phase !== lastPhase) {
        if (c.phase === 'snap' || c.phase === 'slip') snapFrom = ease.outCubic(clamp(reduce() ? c.k : Math.max(c.k, 0.05)));
        lastPhase = c.phase;
      }
      // motes: shed from the soul's rim toward the hand while it is pulled, smoke as it gutters
      if (c && rim.length) {
        const p = poseNow();
        const hd = hand();
        const rate = reduce() ? 0.25 : 1;
        if (c.phase === 'pull' && R.chance(dt * (6 + 24 * c.shown) * rate)) {
          const [x, y] = soulAt(R.pick(rim), p, 1, 0);
          const dx = hd.x - x;
          const dy = hd.y - y;
          const l = Math.hypot(dx, dy) || 1;
          spawn(x, y, (dx / l) * R.range(12, 26), (dy / l) * R.range(12, 26) - 6, R.range(0.4, 0.8));
        }
        if ((c.phase === 'sag' || c.phase === 'drawn') && R.chance(dt * 30 * rate)) spawn(p.gx + R.range(-2, 2), p.gy - 3, R.range(-4, 4), -R.range(10, 22), R.range(0.5, 1.1), true);
      }
      let w = 0;
      for (let i = 0; i < motes.length; i++) {
        const q = motes[i];
        q.life -= dt;
        if (q.life <= 0) continue;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        if (q.smoke) q.vx += Math.sin(t * 3 + i) * 6 * dt;
        motes[w++] = q;
      }
      motes.length = w;
    },

    draw(p) {
      const c = ch();
      if (!c || !list.length) return;
      const ph = c.phase;
      if (ph === 'done') return;
      const rm = reduce();
      const k = clamp(rm ? c.k : c.shown);
      const jerk = rm ? 0 : clamp(c.jerk || 0);
      const hd = hand();
      const P = poseNow();
      const s = ph === 'tear' ? s01(c.phaseT, TEAR) : ph === 'sag' ? s01(c.phaseT, SAG) : ph === 'drawn' ? s01(c.phaseT, DRAWN) : ph === 'snap' ? s01(c.phaseT, SNAP) : ph === 'slip' ? s01(c.phaseT, SLIP) : 0;
      const frame = Math.floor(t * 30);

      // 1. The body it leaves: the light goes out of it (pulled, torn); a stronger one's rim
      //    flares as it slams back.
      if (ph === 'pull' || ph === 'tear') {
        const dim = ph === 'tear' ? 0.65 : 0.6 * k;
        if (dim > 0.02) for (const b of list) p.blend(b.x, b.y, HOLLOW, dim);
        if (jerk > 0.35) for (const i of rim) if (rand(list[i].mx, list[i].my, frame) < jerk * 0.7) p.dot(list[i].x, list[i].y, C[5], jerk * 0.8);
      } else if (ph === 'snap') {
        const f = 1 - s;
        for (const i of rim) if (rm || rand(list[i].mx, list[i].my, frame) < 0.35 + 0.6 * f) p.dot(list[i].x, list[i].y, f > 0.55 && !rm ? C[6] : C[5], f);
        if (!rm) p.ring(cx0, cy0, 4 + 18 * ease.outCubic(s), 1.2, C[5], 0.9 * f);
        p.glow(cx0, cy0, 22, C[4], 0.5 * f);
      }

      // 2. The wisps between body and soul: slack and wavering as it is drawn, taut and bright
      //    when it pulls back; at the tear they snap and recoil.
      if ((ph === 'pull' || ph === 'tear' || ph === 'snap' || ph === 'slip') && P.out > 0.05) {
        const taut = ph === 'snap' ? 1 - s : jerk;
        const fade = ph === 'tear' || ph === 'slip' ? 1 - s : 1;
        holdIdx.forEach((hi, j) => {
          if (hi < 0) return;
          const h0 = list[hi];
          const [ex, ey] = soulAt(hi, P, 1, 0);
          const len = Math.hypot(ex - h0.x, ey - h0.y);
          if (len < 1.5) return;
          const n = Math.max(3, Math.ceil(len / 1.1));
          const px0 = -(ey - h0.y) / len;
          const py0 = (ex - h0.x) / len;
          const amp = rm ? 0.8 : (2 - 1.6 * taut) * (ph === 'tear' ? 1 + 2 * s : 1);
          const col = taut > 0.5 ? C[6] : C[5];
          const a = (0.5 + 0.4 * taut) * fade;
          for (let i = 1; i < n; i++) {
            const u = i / n;
            // torn: only the ends remain, curling back toward where they came from
            if (ph === 'tear' && u > 0.35 * (1 - s) && u < 1 - 0.3 * (1 - s)) continue;
            const wob = rm ? Math.sin(u * Math.PI) * amp : Math.sin(u * Math.PI) * amp * Math.sin(t * 14 + j * 1.7 + u * 7);
            p.dot(h0.x + (ex - h0.x) * u + px0 * wob, h0.y + (ey - h0.y) * u + py0 * wob, col, a);
          }
        });
      }

      // 3. The soul: the body's own shape in cold light, see-through, smeared back toward the
      //    body it leaves; free, it gutters, shrinking and flickering like a snuffed candle.
      let alpha;
      let shrink = 1;
      if (ph === 'pull') alpha = 0.5 + 0.45 * k;
      else if (ph === 'tear') alpha = 0.97;
      else if (ph === 'sag') {
        shrink = 1 - 0.7 * ease.inQuad(s);
        alpha = (rm ? 0.85 : 0.5 + 0.5 * rand(frame, 7)) * (1 - 0.3 * s);
      } else if (ph === 'drawn') {
        shrink = 0.3 * (1 - ease.inQuad(s));
        alpha = rm ? 0.85 * (1 - s) : (0.6 + 0.4 * rand(frame, 9)) * (1 - 0.5 * s);
      } else if (ph === 'snap') alpha = 0.9 * (1 - s);
      else if (ph === 'slip') alpha = 0.7 * (1 - s);
      else alpha = 0;
      const sway = rm || ph !== 'pull' ? 0 : 0.5 + 1.1 * k;
      if (alpha > 0.02 && shrink > 0.04) {
        // the smear: fainter copies trailing back toward the body (while it is held)
        if ((ph === 'pull' || ph === 'snap') && P.out > 0.08) {
          for (let e = 2; e >= 1; e--) {
            const a2 = alpha * (0.3 / e);
            for (let i = e - 1; i < list.length; i += 2) {
              const [x, y] = soulAt(i, P, 1, sway * 0.6, 1 - 0.22 * e);
              p.dot(x, y, C[3], a2);
            }
          }
        }
        for (let i = 0; i < list.length; i++) {
          const [x, y] = soulAt(i, P, shrink, sway);
          const ti = tone[i];
          // the moment it tears loose it burns paler; the rim always palest
          const col = ph === 'tear' && s < 0.5 ? C[Math.min(6, ti + 1)] : C[ti];
          p.dot(x, y, col, ti >= 6 ? Math.min(1, alpha * 1.3) : alpha);
        }
        // the last of the flame at its heart, guttering
        if (ph === 'sag' || ph === 'drawn') {
          const fl = rm ? 1 : 0.55 + 0.45 * rand(frame, 3);
          p.dot(P.gx, P.gy - 1, C[6], fl * (1 - s * 0.5));
          p.dot(P.gx, P.gy - 2, C[5], fl * (1 - s));
          p.dot(P.gx, P.gy, C[4], fl);
        }
        const lit = ph === 'pull' ? k : 0.85;
        p.glow(P.gx, P.gy, 12 + 10 * lit * shrink, C[4], (0.25 + 0.45 * lit) * Math.min(1, alpha + 0.2));
      }

      // 4. The hand that draws it: cold light gathering, flaring as the flame goes into it.
      let hk = 0;
      if (ph === 'pull') hk = 0.2 + 0.5 * k;
      else if (ph === 'tear' || ph === 'sag') hk = 0.75;
      else if (ph === 'drawn') hk = s < 0.55 ? 0.75 + 0.55 * (s / 0.55) : 1.3 * (1 - (s - 0.55) / 0.45);
      else if (ph === 'snap' || ph === 'slip') hk = 0.3 * (1 - s);
      if (hk > 0.02) {
        p.glow(hd.x, hd.y, 6 + 9 * Math.min(1, hk), C[5], 0.4 * hk);
        p.dot(hd.x, hd.y, C[5], Math.min(1, hk));
        if (hk > 0.6) {
          p.dot(hd.x - 1, hd.y, C[4], hk - 0.4);
          p.dot(hd.x + 1, hd.y, C[4], hk - 0.4);
          p.dot(hd.x, hd.y - 1, C[6], hk - 0.5);
        }
      }

      // 5. Motes going to the hand, and the smoke of a snuffed flame.
      for (const q of motes) {
        const a = clamp(q.life / q.max);
        if (q.smoke) p.blend(q.x, q.y, SMOKE, 0.55 * a);
        else p.dot(q.x, q.y, a > 0.5 ? C[5] : C[4], a);
      }
    },
  };
}

export const UNKINDLE_MOD = { meta, create };

// ------------------------------------------------------------------ a body for straw

// A training dummy is an object, not a character: its picture, read like a sprite frame
// (feet at its anchor), so the straw too has a shape to pull.
const OBJ_CACHE = new Map();
export function bodyOfObject(game, o) {
  if (!o || typeof document === 'undefined') return null;
  const key = `${o.objType}|${o.variant || ''}`;
  if (OBJ_CACHE.has(key)) return OBJ_CACHE.get(key);
  let a = null;
  try {
    const W = 48;
    const Hh = 64;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = Hh;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    o.draw?.(ctx, o.x - 24, o.y - 56, 0);
    const data = ctx.getImageData(0, 0, W, Hh).data;
    let top = Hh;
    let bottom = -1;
    let left = W;
    let right = -1;
    for (let y = 0; y < Hh; y++)
      for (let x = 0; x < W; x++) {
        if (data[(y * W + x) * 4 + 3] < 60) continue;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    if (bottom >= top) {
      const mw = right - left + 1;
      const mh = bottom - top + 1;
      const mask = new Uint8Array(mw * mh);
      const pixels = new Uint32Array(mw * mh);
      for (let y = 0; y < mh; y++)
        for (let x = 0; x < mw; x++) {
          const i = ((top + y) * W + left + x) * 4;
          if (data[i + 3] < 60) continue;
          mask[y * mw + x] = 1;
          pixels[y * mw + x] = (255 << 24) | (data[i + 2] << 16) | (data[i + 1] << 8) | data[i];
        }
      a = { mask: { w: mw, h: mh, data: mask }, pixels, x: left - 24, y: top - 56, w: mw, h: mh, k: 1 };
    }
  } catch {
    a = null;
  }
  OBJ_CACHE.set(key, a);
  return a;
}

// ------------------------------------------------------------------ the scene round it

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[unkindle fx]', err);
    return fallback;
  }
}

export class UnkindleFx {
  constructor(game) {
    this.game = game;
    this.ch = null;
    this.handle = null;
    this.state = { ch: null, reduce: false };
    this.level = 0; // the drain and the guttering, eased (0..1)
    this.tear = 0; // a dip of every lamp near at the tear (0..1)
    this.altar = 0; // s left of the altar flame's gutter
    this.at = { x: 0, y: 0 };
    this.mid = { x: 0, y: 0 };
    this.clear = 24; // world px round the two of them the wash leaves in colour
    this.installed = false;
    this.canColor = null;
    this.stats = { frames: 0, lights: 0 };
  }

  get reduce() {
    return !!this.game?.settings?.reduceMotion;
  }

  // On the pixelfx host and round the renderer's last pass and the night's lights.
  install() {
    if (this.installed) return;
    const g = this.game;
    const host = g?.pixelFx;
    if (host?.define && !host.has?.('unkindle')) host.define('unkindle', { mod: UNKINDLE_MOD, layer: 'top', actor: true, priority: 9, bounds: [-44, -68, 44, 16], lightK: 1.15 });
    const dfx = g?.renderer?.deathFx;
    if (dfx && typeof dfx.draw === 'function' && !dfx._unkWrapped) {
      const orig = dfx.draw.bind(dfx);
      const self = this;
      dfx.draw = function unkindleScreen(ctx, renderer, dt) {
        orig(ctx, renderer, dt);
        safe(() => self.drawScreen(ctx, renderer, dt));
      };
      dfx._unkWrapped = true;
    }
    const L = g?.lighting;
    if (L && typeof L.composite === 'function' && !L._unkWrapped) {
      const orig = L.composite.bind(L);
      const self = this;
      L.composite = function unkindleLights(ctx, r, time, vig) {
        safe(() => self.dimLights(L, time));
        return orig(ctx, r, time, vig);
      };
      L._unkWrapped = true;
    }
    this.installed = true;
  }

  // ---------------------------------------------------------------- one hold

  start(ch) {
    const g = this.game;
    this.ch = ch;
    this.state.ch = ch;
    this.state.reduce = this.reduce;
    const e = ch.target;
    this.at.x = e.x;
    this.at.y = e.y;
    const host = g?.pixelFx;
    if (host?.play) {
      const actor = ch.kind === 'dummy' ? bodyOfObject(g, e) : safe(() => actorOf(g, e), null);
      if (actor) this.handle = host.play('unkindle', { x: e.x, y: e.y, actor, state: this.state, seed: (e.id ? e.id.length * 7 : 3) + 11 });
    }
    if (ch.kind !== 'dummy') this.wrapBody(e);
  }

  end(ch) {
    const g = this.game;
    if (this.handle) safe(() => g.pixelFx?.stop?.(this.handle));
    this.handle = null;
    this.unwrapBody(ch?.target);
    if (this.ch === ch) this.ch = null;
    // the state object stays readable by the fading effect: freeze it at 'done'
    this.state.ch = null;
  }

  // The household flame on the chapel altar gutters at the moment of a death (LORE §9.12).
  gutterAltar() {
    this.altar = 2.6;
  }

  // How strong the drain and the guttering are now, from the hold's phase (0..1).
  want() {
    const ch = this.ch;
    if (!ch) return 0;
    const rm = this.reduce;
    const s = (d) => clamp(ch.phaseT / d);
    switch (ch.phase) {
      case 'pull':
        return (rm ? 0.5 : 0.78) * clamp(rm ? ch.k : ch.shown) + 0.08;
      case 'tear':
        return rm ? 0.55 : 0.95;
      case 'sag':
        return rm ? 0.55 : 0.9;
      case 'drawn':
        return (rm ? 0.55 : 0.9) * (1 - 0.3 * s(DRAWN));
      case 'snap':
        return 0.5 * (1 - s(SNAP));
      case 'slip':
        return 0.4 * (1 - s(SLIP));
      default:
        return 0;
    }
  }

  // The colour goes out of everything round them; a cold cast over what is left.
  drawScreen(ctx, renderer, dt) {
    const d = Math.max(0, Math.min(0.1, Number(dt) || 1 / 60));
    const want = this.want();
    const up = want > this.level;
    this.level += (want - this.level) * Math.min(1, d * (up ? 6 : 1 / (TAIL * 0.5)));
    if (this.level < 0.004) this.level = 0;
    const ch = this.ch;
    if (ch?.phase === 'tear' && ch.phaseT < 0.05 && !this.reduce) this.tear = 1;
    this.tear = Math.max(0, this.tear - d * 2.5);
    if (this.altar > 0) this.altar = Math.max(0, this.altar - d);
    if (ch) {
      this.at.x = ch.fx.x;
      this.at.y = ch.fx.y;
    }
    if (ch && !Number.isFinite(ch.fx?.px)) {
      this.mid.x = this.at.x;
      this.mid.y = this.at.y;
    }
    const k = this.level;
    if (k <= 0.01) return;
    this.stats.frames++;
    // The wash is centred between the two of them and leaves them in their own colours: the
    // world round them greys and goes cold, the cold soul between them stands out.
    if (ch?.fx && Number.isFinite(ch.fx.px)) {
      this.mid.x = (ch.fx.x + ch.fx.px) / 2;
      this.mid.y = (ch.fx.y + ch.fx.py) / 2;
      this.clear = Math.hypot(ch.fx.x - ch.fx.px, ch.fx.y - ch.fx.py) / 2 + 16;
    }
    const sc = renderer.scale || 3;
    const c = renderer.worldToDevice(this.mid.x, this.mid.y - 10);
    // big enough that its clear middle holds the two of them
    const R = Math.max((DRAIN_R + 48 * k) * sc, ((this.clear + 4) * sc) / HOLE);
    const pulse = this.reduce ? 0 : 0.05 * Math.sin((this.game?.time || 0) * 5.3);
    const W = renderer.canvas.width;
    const H = renderer.canvas.height;
    const x0 = Math.max(0, Math.floor(c.x - R));
    const y0 = Math.max(0, Math.floor(c.y - R));
    const x1 = Math.min(W, Math.ceil(c.x + R));
    const y1 = Math.min(H, Math.ceil(c.y + R));
    if (x1 <= x0 || y1 <= y0) return;
    if (this.canColor == null) {
      try {
        const prev = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = 'color';
        this.canColor = ctx.globalCompositeOperation === 'color';
        ctx.globalCompositeOperation = prev;
      } catch {
        this.canColor = false;
      }
    }
    // One pass: the 'color' blend keeps each pixel's lightness and gives it a pale cold hue, so
    // the colour drains and goes cold at once (no blend mode: a cold multiply, the least of it).
    // The ring is painted once, small, and stretched each frame: a gradient evaluated per pixel
    // every frame costs a slow phone its frames (as death_fx.js found).
    const tex = this.washTexture(this.canColor);
    if (!tex) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = this.canColor ? 'color' : 'multiply';
    ctx.globalAlpha = clamp((this.canColor ? 0.95 : 0.45) * (k + pulse + this.tear * 0.08));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tex, c.x - R, c.y - R, 2 * R, 2 * R);
    ctx.restore();
  }

  // The wash, once: a ring of pale cold colour, clear in the middle (where the two of them
  // stand, HOLE of its radius), strongest just outside it, fading to nothing at the rim.
  washTexture(color) {
    const key = color ? 'color' : 'multiply';
    if (this._tex?.key === key) return this._tex.canvas;
    if (typeof document === 'undefined') return null;
    const N = 96;
    const c = document.createElement('canvas');
    c.width = N;
    c.height = N;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    const col = color ? '112,128,170' : '120,135,185';
    gr.addColorStop(0, `rgba(${col},0)`);
    gr.addColorStop(HOLE * 0.7, `rgba(${col},0)`);
    gr.addColorStop(HOLE + 0.12, `rgba(${col},1)`);
    gr.addColorStop(0.62, `rgba(${col},0.76)`);
    gr.addColorStop(1, `rgba(${col},0)`);
    x.fillStyle = gr;
    x.fillRect(0, 0, N, N);
    this._tex = { key, canvas: c };
    return c;
  }

  // Every lamp, window and hearth near them gutters and sputters (and dips at the tear); the
  // household's flame on the altar gutters when it goes. Only this frame's share of the light
  // is touched (lighting._seen), never the lights themselves.
  dimLights(L, time) {
    const k = this.level;
    const altar = this.altar;
    if (k <= 0.01 && altar <= 0) return;
    const seen = L._seen;
    if (!seen) return;
    const rm = this.reduce;
    let n = 0;
    for (let i = 0; i < L.count; i++) {
      const l = L.lights[i];
      if (!l) continue;
      let mul = 1;
      if (k > 0.01) {
        const d = Math.hypot(l.x - this.at.x, l.y - this.at.y);
        if (d < LAMP_REACH) {
          const near = 1 - d / LAMP_REACH;
          const sp = rm ? 0.5 : 0.5 + 0.5 * Math.sin(time * 23 + i * 2.7) * Math.sin(time * 7.1 + i);
          mul *= 1 - near * k * (0.3 + 0.45 * sp) - near * this.tear * 0.6;
          n++;
        }
      }
      if (altar > 0) {
        const d = Math.hypot(l.x - ALTAR.x, l.y - ALTAR.y);
        if (d < 40) {
          const a = Math.min(1, altar / 1.2);
          const sp = rm ? 0.5 : 0.5 + 0.5 * Math.sin(time * 31 + i * 3.3);
          mul *= 1 - a * (0.45 + 0.5 * sp);
        }
      }
      if (mul < 1) seen[i] *= Math.max(0.03, mul);
    }
    this.stats.lights = n;
  }

  // ---------------------------------------------------------------- the body

  // The held body trembles and rises onto its toes; at the tear it jolts; then it sags at the
  // knees (no wound, no blood) until the death lays it down (murder.layBody draws it lying).
  wrapBody(e) {
    if (!e || e._unkDraw || typeof e.draw !== 'function') return;
    const had = Object.prototype.hasOwnProperty.call(e, 'draw');
    const orig = e.draw;
    const fx = this;
    e._unkDraw = { had, orig };
    e.draw = function unkindleHeld(ctx, ox, oy, time) {
      const ch = fx.ch;
      if (!ch || ch.target !== this) return orig.call(this, ctx, ox, oy, time);
      const rm = fx.reduce;
      let dx = 0;
      let dy = 0;
      let sx = 1;
      let sy = 1;
      const s = (d) => clamp(ch.phaseT / d);
      if (ch.phase === 'pull') {
        const k = clamp(rm ? ch.k : ch.shown);
        if (!rm) dx = Math.round(Math.sin(time * 57) * k * 1.2 + (ch.jerk > 0.5 ? Math.sin(time * 91) * 1.4 : 0));
        dy = -Math.round(k * 1.4);
      } else if (ch.phase === 'tear') {
        dx = rm ? 0 : Math.sin(time * 120) > 0 ? 1 : -1;
        dy = -2;
      } else if (ch.phase === 'sag') {
        const e2 = ease.inQuad(s(SAG));
        sy = 1 - 0.45 * e2;
        sx = 1 + 0.14 * e2;
        dx = Math.round((this.x > (fx.game?.player?.x ?? this.x) ? 1 : -1) * 2 * e2);
      } else if (ch.phase === 'snap') {
        const f = 1 - s(SNAP);
        dx = rm ? 0 : Math.round((this.x > (fx.game?.player?.x ?? this.x) ? 1 : -1) * 2 * f);
      }
      if (sx === 1 && sy === 1) {
        if (!dx && !dy) return orig.call(this, ctx, ox, oy, time);
        return orig.call(this, ctx, ox - dx, oy - dy, time);
      }
      const px = Math.round(this.x - ox);
      const py = Math.round(this.y - oy);
      ctx.save();
      ctx.translate(px + dx, py + dy);
      ctx.scale(sx, sy);
      ctx.translate(-px, -py);
      const r = orig.call(this, ctx, ox, oy, time);
      ctx.restore();
      return r;
    };
  }

  unwrapBody(e) {
    if (!e?._unkDraw) return;
    const { had, orig } = e._unkDraw;
    if (e.draw?.name === 'unkindleHeld') {
      if (had) e.draw = orig;
      else delete e.draw;
    }
    delete e._unkDraw;
  }
}
