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
const DRAIN_R = 72; // world px of the colour drain at its least
const TAIL = 1.4; // s the drain and the lamps take to come back

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
  // Each pixel's step of the cold ramp: its own brightness, its rim the palest.
  const tone = list.map((b) => (b.edge ? 6 : 2 + Math.min(3, Math.floor(luma(b.c) * 4.2))));
  const cx0 = body.x + W / 2;
  const cy0 = body.y + H * 0.42; // the chest
  // Where the wisps hold on: crown, chest, both sides, the waist.
  const holds = list.length
    ? [
        nearestPixel(list, cx0, body.y + 1),
        nearestPixel(list, cx0, cy0),
        nearestPixel(list, body.x, body.y + H * 0.48),
        nearestPixel(list, body.x + W - 1, body.y + H * 0.48),
        nearestPixel(list, cx0 + 1, body.y + H * 0.72),
      ]
    : [];
  const rim = list.filter((b) => b.edge);
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
    if (!f) return { x: cx0 + 20, y: cy0 };
    return { x: f.hx - o.x, y: f.hy - o.y };
  };

  // How far along the way to the hand the soul's chest has come (0 in the body, 1 the hand).
  const reach = () => {
    const c = ch();
    if (!c) return 0;
    const k = reduce() ? c.k : c.shown;
    const p = c.phase;
    const s = (d) => s01(c.phaseT, d);
    if (p === 'pull') return 0.6 * ease.outCubic(clamp(k));
    if (p === 'tear') return 0.6 + 0.13 * ease.outBack(s(TEAR));
    if (p === 'sag') return 0.73 + 0.2 * ease.inOutSine(s(SAG));
    if (p === 'drawn') return 0.93 + 0.07 * ease.inQuad(s(DRAWN));
    if (p === 'snap') return snapFrom * (reduce() ? 1 - ease.inOutSine(s(SNAP)) : Math.max(-0.08, 1 - ease.outElastic(s(SNAP) * 0.9 + 0.1)));
    if (p === 'slip') return snapFrom * (1 - ease.inOutSine(s(SLIP)));
    return 0;
  };

  // Where one body pixel of the soul is drawn: moved along the pull, the side nearer the hand
  // leading (stretched toward it), shivering; shrunk toward its middle as it gutters.
  const soulAt = (b, D, nx, ny, shrink, gx, gy, sway) => {
    const u = clamp((((b.x - cx0) * nx + (b.y - cy0) * ny) / Math.max(4, H * 0.5)) * 0.5 + 0.5);
    const lead = 0.55 + 0.45 * u;
    let x = b.x + D.x * lead;
    let y = b.y + D.y * lead;
    if (sway) x += Math.sin(t * 9 + b.my * 0.55) * sway;
    if (shrink < 1) {
      x = gx + (x - gx) * shrink;
      y = gy + (y - gy) * shrink;
      // its top leans like a candle's flame
      if (!reduce()) x += Math.sin(t * 21 + y * 0.6) * (1 - shrink) * 1.4 * clamp((gy - y) / 6 + 0.5);
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
        if (c.phase === 'snap' || c.phase === 'slip') snapFrom = 0.6 * ease.outCubic(clamp(reduce() ? c.k : Math.max(c.k, 0.05)));
        lastPhase = c.phase;
      }
      // motes: shed from the soul's rim toward the hand while it is pulled, smoke as it gutters
      if (c && rim.length) {
        const m = reach();
        const hd = hand();
        const D = { x: (hd.x - cx0) * m, y: (hd.y - cy0) * m };
        const rate = reduce() ? 0.25 : 1;
        if (c.phase === 'pull' && R.chance(dt * (6 + 22 * c.shown) * rate)) {
          const b = R.pick(rim);
          const x = b.x + D.x * 0.8;
          const y = b.y + D.y * 0.8;
          const dx = hd.x - x;
          const dy = hd.y - y;
          const l = Math.hypot(dx, dy) || 1;
          spawn(x, y, (dx / l) * R.range(14, 30), (dy / l) * R.range(14, 30) - 4, R.range(0.4, 0.8));
        }
        if ((c.phase === 'sag' || c.phase === 'drawn') && R.chance(dt * 30 * rate)) {
          const gx = cx0 + D.x;
          const gy = cy0 + D.y - 4;
          spawn(gx + R.range(-2, 2), gy, R.range(-4, 4), -R.range(10, 22), R.range(0.5, 1.1), true);
        }
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
      const m = reach();
      const vx = hd.x - cx0;
      const vy = hd.y - cy0;
      const vl = Math.hypot(vx, vy) || 1;
      const nx = vx / vl;
      const ny = vy / vl;
      const D = { x: vx * m, y: vy * m };
      const s = ph === 'tear' ? s01(c.phaseT, TEAR) : ph === 'sag' ? s01(c.phaseT, SAG) : ph === 'drawn' ? s01(c.phaseT, DRAWN) : ph === 'snap' ? s01(c.phaseT, SNAP) : ph === 'slip' ? s01(c.phaseT, SLIP) : 0;
      const frame = Math.floor(t * 30);

      // 1. The body it leaves: its light goes out of it (pulled, torn); a stronger one's rim
      //    flares as it slams back.
      if (ph === 'pull' || ph === 'tear') {
        const dim = ph === 'tear' ? 0.55 : 0.42 * k;
        if (dim > 0.02) for (const b of list) p.blend(b.x, b.y, HOLLOW, dim);
        if (jerk > 0.35) for (const b of rim) if (rand(b.mx, b.my, frame) < jerk * 0.7) p.dot(b.x, b.y, C[5], jerk * 0.8);
      } else if (ph === 'snap') {
        const f = 1 - s;
        for (const b of rim) if (rm || rand(b.mx, b.my, frame) < 0.35 + 0.6 * f) p.dot(b.x, b.y, f > 0.55 && !rm ? C[6] : C[5], f);
        if (!rm) p.ring(cx0, cy0, 4 + 18 * ease.outCubic(s), 1.2, C[5], 0.9 * f);
        p.glow(cx0, cy0, 22, C[4], 0.5 * f);
      }

      // 2. The wisps between body and soul: slack and wavering as it is drawn, taut and bright
      //    when it pulls back; at the tear they snap and recoil.
      if ((ph === 'pull' || ph === 'tear' || ph === 'snap' || ph === 'slip') && m > 0.02) {
        const taut = ph === 'snap' ? 1 - s : jerk;
        const fade = ph === 'tear' ? 1 - s : ph === 'slip' ? 1 - s : 1;
        holds.forEach((h0, j) => {
          const [ex, ey] = soulAt(h0, D, nx, ny, 1, 0, 0, 0);
          const len = Math.hypot(ex - h0.x, ey - h0.y);
          if (len < 1.5) return;
          const n = Math.max(3, Math.ceil(len / 1.2));
          const px0 = -(ey - h0.y) / len;
          const py0 = (ex - h0.x) / len;
          const amp = rm ? 0.6 : (1.8 - 1.4 * taut) * (ph === 'tear' ? 1 + 2 * s : 1);
          const col = taut > 0.5 ? C[6] : C[5];
          const a = (0.45 + 0.4 * taut) * fade;
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
      //    body it is leaving; guttering, it shrinks and flickers like a snuffed candle.
      let alpha;
      let shrink = 1;
      if (ph === 'pull') alpha = 0.3 + 0.55 * k;
      else if (ph === 'tear') alpha = 0.95;
      else if (ph === 'sag') {
        shrink = 1 - 0.72 * ease.inQuad(s);
        alpha = (rm ? 0.8 : 0.45 + 0.55 * rand(frame, 7)) * (1 - 0.35 * s);
      } else if (ph === 'drawn') {
        shrink = 0.28 * (1 - ease.inQuad(s));
        alpha = rm ? 0.8 * (1 - s) : (0.55 + 0.45 * rand(frame, 9)) * (1 - 0.5 * s);
      } else if (ph === 'snap') alpha = 0.85 * (1 - s);
      else if (ph === 'slip') alpha = 0.6 * (1 - s);
      else alpha = 0;
      const gx = cx0 + D.x;
      const gy = cy0 + D.y;
      const sway = rm || ph !== 'pull' ? 0 : 0.5 + 0.9 * k;
      if (alpha > 0.02 && shrink > 0.04) {
        // the smear: fainter copies trailing back toward the body (not once it is free)
        if (ph === 'pull' || ph === 'snap') {
          for (let e = 2; e >= 1; e--) {
            const back = { x: D.x * (1 - 0.2 * e), y: D.y * (1 - 0.2 * e) };
            const a2 = alpha * (0.28 / e);
            for (let i = 0; i < list.length; i += 2) {
              const [x, y] = soulAt(list[i], back, nx, ny, 1, 0, 0, sway * 0.6);
              p.dot(x, y, C[3], a2);
            }
          }
        }
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          const [x, y] = soulAt(b, D, nx, ny, shrink, gx, gy, sway);
          const ti = tone[i];
          // the first frames it tears loose it burns pale; the rim always palest
          const col = ph === 'tear' && s < 0.45 ? C[Math.min(6, ti + 1)] : C[ti];
          p.dot(x, y, col, ti >= 6 ? Math.min(1, alpha * 1.25) : alpha);
        }
        // a dark core where its heart is: the last of the flame, guttering
        if (ph === 'sag' || ph === 'drawn') {
          const fl = rm ? 1 : 0.6 + 0.4 * rand(frame, 3);
          p.dot(gx, gy - 1, C[6], fl * (1 - s));
          p.dot(gx, gy - 2, C[5], fl * (1 - s));
          p.dot(gx, gy, C[4], fl);
        }
        p.glow(gx, gy, 12 + 10 * (ph === 'pull' ? k : 1) * shrink, C[4], (0.22 + 0.4 * (ph === 'pull' ? k : 0.8)) * Math.min(1, alpha + 0.2));
      }

      // 4. The hand that draws it: cold light gathering, flaring as the flame goes into it.
      let hk = 0;
      if (ph === 'pull') hk = 0.15 + 0.45 * k;
      else if (ph === 'tear' || ph === 'sag') hk = 0.7;
      else if (ph === 'drawn') hk = s < 0.55 ? 0.7 + 0.5 * (s / 0.55) : 1.2 * (1 - (s - 0.55) / 0.45);
      else if (ph === 'snap' || ph === 'slip') hk = 0.3 * (1 - s);
      if (hk > 0.02) {
        p.glow(hd.x, hd.y, 6 + 8 * Math.min(1, hk), C[5], 0.35 * hk);
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
        if (q.smoke) p.blend(q.x, q.y, SMOKE, 0.5 * a);
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
    this.installed = false;
    this.canSat = null;
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
    if (host?.define && !host.has?.('unkindle')) host.define('unkindle', { mod: UNKINDLE_MOD, layer: 'top', actor: true, priority: 9, bounds: [-64, -92, 64, 36], lightK: 1.15 });
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
    const k = this.level;
    if (k <= 0.01) return;
    this.stats.frames++;
    const sc = renderer.scale || 3;
    const c = renderer.worldToDevice(this.at.x, this.at.y - 10);
    const R = (DRAIN_R + 70 * k) * sc;
    const W = renderer.canvas.width;
    const H = renderer.canvas.height;
    const x0 = Math.max(0, Math.floor(c.x - R));
    const y0 = Math.max(0, Math.floor(c.y - R));
    const x1 = Math.min(W, Math.ceil(c.x + R));
    const y1 = Math.min(H, Math.ceil(c.y + R));
    if (x1 <= x0 || y1 <= y0) return;
    if (this.canSat == null) {
      try {
        const prev = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = 'saturation';
        this.canSat = ctx.globalCompositeOperation === 'saturation';
        ctx.globalCompositeOperation = prev;
      } catch {
        this.canSat = false;
      }
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const pulse = this.reduce ? 0 : 0.06 * Math.sin((this.game?.time || 0) * 5.3);
    if (this.canSat) {
      const gr = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, R);
      gr.addColorStop(0, `rgba(128,128,128,${clamp(0.92 * k + pulse)})`);
      gr.addColorStop(0.55, `rgba(128,128,128,${clamp(0.7 * k + pulse)})`);
      gr.addColorStop(1, 'rgba(128,128,128,0)');
      ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = gr;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    const cold = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, R);
    cold.addColorStop(0, `rgba(120,140,190,${clamp(0.42 * k + this.tear * 0.25)})`);
    cold.addColorStop(0.6, `rgba(120,140,190,${clamp(0.26 * k)})`);
    cold.addColorStop(1, 'rgba(120,140,190,0)');
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = cold;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
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
