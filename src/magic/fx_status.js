import { animForState } from '../entities/entity.js';
import { statusLook } from './fx_styles.js';
import { styleId, rampFor } from './fx_particles.js';
import { TAU, flicker, hash, clamp01 } from './fx_util.js';
import { silhouetteOf, frameBounds, halo, ell, ring, zig, px, rect } from './fx_draw.js';

// Statuses on actors (DESIGN §22.1: "Statuses show on actors"): a tint over the sprite
// (frozen actors turn to blue ice and stop animating, soaked ones darken, the burning
// flicker orange), overlays at the head (stars, hearts, glare), at the feet (vines, mud,
// rime) or over the body (ice crust, cracks, crackle), and particles shed by the body
// (flames and embers, drips, bubbles, wisps, zaps). Everything is read from the status
// def's overlay name through STATUS_LOOKS; an unknown overlay gets a tinted pulse and a
// ring in the status color, so a new status shows without code here.

const DEFAULT_H = 20;

// Statuses pixelfx shows on the body (src/render/pixel_fx_play.js): their tint, overlay and
// particles step aside while it does; their light stays.
const pixelOwns = (fx, a, id) => !!fx.game?.pixelFx?.director?.owns?.(a, id);

// What an actor looks like this frame: its sprite frame image and where it is drawn.
const FRAME = { img: null, dx: 0, dy: 0, top: 0, left: 0, right: 0, feet: 0, cx: 0, h: DEFAULT_H };

function actorFrame(atlas, a, ox, oy) {
  FRAME.img = null;
  const z = Math.round(a.z || 0);
  FRAME.feet = Math.round(a.y - oy);
  FRAME.cx = Math.round(a.x - ox);
  FRAME.h = DEFAULT_H;
  FRAME.top = FRAME.feet - z - DEFAULT_H;
  FRAME.left = FRAME.cx - 5;
  FRAME.right = FRAME.cx + 5;
  if (!atlas || !a.spriteKey || typeof atlas.getMeta !== 'function') return FRAME;
  try {
    const meta = atlas.getMeta(`char:${a.spriteKey}`);
    if (!meta || !meta.anims) return FRAME;
    let anim = animForState(a.state);
    let time = a.animTime || 0;
    if (a.castPoseT > 0 && !a.rolling && !a.downed && (a.state === 'idle' || a.state === 'walk' || a.state === 'cast')) {
      anim = 'cast';
      time = a._castAnimT ?? time;
    } else if (a.rolling) time *= 2.2;
    const spec = meta.anims[anim] || meta.anims.idle;
    if (!spec) return FRAME;
    const name = spec.names?.[a.dir] || spec.names?.down;
    const s = name ? atlas.get(name) : null;
    if (!s || !s.frames?.length) return FRAME;
    let i = a.holdFrame != null ? a.holdFrame : Math.floor(time * (spec.fps || 8));
    if (!(i >= 0)) i = 0;
    i = spec.loop ? i % spec.frames : Math.min(i, spec.frames - 1);
    const n = s.frames.length;
    const img = s.frames[((i % n) + n) % n];
    const bnd = frameBounds(img);
    FRAME.img = img;
    FRAME.dx = FRAME.cx - s.ox;
    FRAME.dy = FRAME.feet - z - s.oy;
    FRAME.top = FRAME.dy + bnd.top;
    FRAME.left = FRAME.dx + bnd.left;
    FRAME.right = FRAME.dx + bnd.right;
    FRAME.h = Math.max(6, FRAME.feet - z - FRAME.top);
  } catch {
    FRAME.img = null;
  }
  return FRAME;
}

// Per-actor memory (emission timers, the frozen pose): a WeakMap, so nothing sticks.
const recs = new WeakMap();
function recOf(a) {
  let r = recs.get(a);
  if (!r) {
    r = { acc: Object.create(null), h: DEFAULT_H, w: 10, frozenAnim: null };
    recs.set(a, r);
  }
  return r;
}

const PAL_CACHE = new Map();
function statusPal(def) {
  let p = PAL_CACHE.get(def.id);
  if (p) return p;
  const c = def.color || '#ffffff';
  p = { core: '#ffffff', glow: c, spark: c, deep: c };
  // A few statuses read better with their essence's own ramp.
  const special = {
    burning: { core: '#fff4c0', spark: '#ffe08a', glow: '#ffa53a', deep: '#c2412d' },
    soaked: { core: '#e6f8ff', spark: '#a8e2ff', glow: '#4fb3e8', deep: '#235c9e' },
    chilled: { core: '#ffffff', spark: '#dff6ff', glow: '#9fe3ff', deep: '#4f86c6' },
    frozen: { core: '#ffffff', spark: '#dff6ff', glow: '#bfe9ff', deep: '#6fb6e6' },
    shocked: { core: '#ffffff', spark: '#fff7b0', glow: '#ffe45c', deep: '#6a5cff' },
    poisoned: { core: '#f2ffc4', spark: '#d4ff7a', glow: '#a6e22e', deep: '#5a2f7a' },
    drained: { core: '#e6d0ff', spark: '#c09cff', glow: '#8a4fd6', deep: '#2a1640' },
    charmed: { core: '#fff0fb', spark: '#ffd1ee', glow: '#ff9ad5', deep: '#8a3f9e' },
    rooted: { core: '#efffd0', spark: '#c6f59a', glow: '#7ed957', deep: '#2f7a3a' },
    dazzled: { core: '#ffffff', spark: '#fffbe6', glow: '#ffe9a8', deep: '#e0a83a' },
    sundered: { core: '#ffffff', spark: '#ffd9a0', glow: '#c9d3e0', deep: '#56627a' },
    knocked: { core: '#ffffff', spark: '#e6fff6', glow: '#bff5e0', deep: '#5fb3a0' },
  }[def.id];
  if (special) p = special;
  if (PAL_CACHE.size > 200) PAL_CACHE.clear();
  PAL_CACHE.set(def.id, p);
  return p;
}

export class StatusFx {
  constructor(fx) {
    this.fx = fx;
  }

  // Shed particles and hold frozen poses (called once per game update).
  update(dt, magic, parts) {
    const list = magic?.status?.afflicted;
    if (!list || !list.length) return;
    const cam = this.fx.game.camera;
    const vx0 = (cam?.x ?? -1e9) - 60;
    const vy0 = (cam?.y ?? -1e9) - 60;
    const vx1 = (cam?.x ?? 1e9) + (cam?.vw ?? 2e9) + 60;
    const vy1 = (cam?.y ?? 1e9) + (cam?.vh ?? 2e9) + 90;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const l = a.magicStatus;
      if (!l || !l.length || a.removed || a.dead) continue;
      const rec = recOf(a);
      let frozen = false;
      const onScreen = a.x > vx0 && a.x < vx1 && a.y > vy0 && a.y < vy1;
      for (let k = 0; k < l.length; k++) {
        const s = l[k];
        const look = statusLook(s.def);
        if (look.freeze) frozen = true;
        if (!onScreen || !look.parts || pixelOwns(this.fx, a, s.id)) continue;
        let accs = rec.acc[s.id];
        if (!accs) accs = rec.acc[s.id] = [0, 0, 0, 0];
        for (let j = 0; j < look.parts.length && j < 4; j++) {
          const p = look.parts[j];
          const acc = accs[j] + dt * p[1] * (s.stacks > 1 ? 1 + 0.3 * (s.stacks - 1) : 1);
          let n = Math.floor(acc);
          accs[j] = acc - n;
          if (!n) continue;
          n = parts.budget(n, true);
          const st = styleId(p[0]);
          const ramp = rampFor(st, statusPal(s.def));
          for (let q = 0; q < n; q++) this._emit(parts, st, ramp, p[2], a, rec, s);
        }
      }
      // A frozen actor stops animating: its animation clock is held where it froze.
      if (frozen) {
        if (rec.frozenAnim == null) rec.frozenAnim = a.animTime || 0;
        a.animTime = rec.frozenAnim;
      } else rec.frozenAnim = null;
    }
  }

  _emit(parts, st, ramp, where, a, rec, s) {
    const w = rec.w;
    const h = rec.h;
    const x = a.x + (Math.random() - 0.5) * w * 0.9;
    const y = a.y + 0.5;
    const z0 = a.z || 0;
    let z;
    if (where === 'head') z = z0 + h + 1 + Math.random() * 2;
    else if (where === 'feet') z = z0 + Math.random() * 2;
    else z = z0 + 2 + Math.random() * (h - 4);
    let vx = (Math.random() - 0.5) * 10;
    let vy = (Math.random() - 0.5) * 4;
    // Drained life drifts toward whoever drains it.
    if (s.id === 'drained' && s.src && !s.src.removed) {
      const dx = s.src.x - a.x;
      const dy = s.src.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      vx = (dx / l) * 40;
      vy = (dy / l) * 30;
    }
    parts.add(st, ramp, x, y, z, vx, vy, (Math.random() - 0.3) * 8);
  }

  // Tints and overlays (the layer's body pass, after every actor is drawn).
  draw(R, magic) {
    const list = magic?.status?.afflicted;
    if (!list || !list.length) return;
    const atlas = this.fx.game.atlas;
    const t = R.time;
    const c = R.ctx;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const l = a.magicStatus;
      if (!l || !l.length || a.removed || a.dead || a.hidden) continue;
      const sx = a.x - R.ox;
      const sy = a.y - R.oy;
      if (sx < -30 || sx > R.w + 30 || sy < -10 || sy > R.h + 50) continue;
      const F = actorFrame(atlas, a, R.ox, R.oy);
      const rec = recOf(a);
      rec.h = F.h;
      rec.w = Math.max(6, F.right - F.left + 1);
      // Tints, strongest last.
      let tints = 0;
      for (let k = 0; k < l.length && tints < 3; k++) {
        const s = l[k];
        const look = statusLook(s.def);
        const color = look.tint || s.def.color;
        if (!color || !F.img || pixelOwns(this.fx, a, s.id)) continue;
        const fade = clamp01(s.t / 0.25) * clamp01((s.dur - s.t) / 0.12 + 0.4);
        let k2 = (look.tintK ?? 0.2) * fade;
        switch (look.pulse) {
          case 'flicker':
            k2 *= 0.55 + 0.45 * flicker(t, a.x * 0.1);
            break;
          case 'strobe':
            k2 *= Math.floor(t * 14 + hash(a.x | 0)) & 1 ? 1 : 0.15;
            break;
          case 'blink':
            k2 *= Math.sin(t * 9) > 0 ? 1 : 0.35;
            break;
          case 'slow':
            k2 *= 0.7 + 0.3 * Math.sin(t * 3.2 + k);
            break;
          default:
            break;
        }
        if (k2 < 0.02) continue;
        const sil = silhouetteOf(F.img, color);
        if (!sil) continue;
        c.globalAlpha = Math.min(1, k2);
        c.drawImage(sil, F.dx, F.dy);
        tints++;
      }
      c.globalAlpha = 1;
      for (let k = 0; k < l.length; k++) if (!pixelOwns(this.fx, a, l[k].id)) this._overlay(R, a, l[k], F, t, k);
    }
    c.globalAlpha = 1;
    if (R.g) R.g.globalAlpha = 1;
  }

  _overlay(R, a, s, F, t, k) {
    const look = statusLook(s.def);
    const c = R.ctx;
    const g = R.g;
    const P = statusPal(s.def);
    const fade = clamp01(s.t / 0.25);
    const cx = F.cx;
    const feet = F.feet - Math.round(a.z || 0);
    const top = F.top;
    const w = Math.max(6, F.right - F.left + 1);
    c.globalAlpha = fade;
    if (look.crust) {
      // A crust of ice: a white shine on the frozen silhouette, crystals on top and at
      // the sides, a slab of ice at the feet.
      if (F.img) {
        const shine = silhouetteOf(F.img, '#ffffff');
        if (shine) {
          c.globalAlpha = 0.22 * fade;
          c.drawImage(shine, F.dx - 1, F.dy - 1);
        }
      }
      c.globalAlpha = 0.75 * fade;
      ell(c, cx, feet, w * 0.5 + 3, 2.5, P.glow);
      c.globalAlpha = 0.9 * fade;
      rect(c, cx - w * 0.5 - 1, feet - 1, w + 2, 1, '#ffffff');
      for (let q = 0; q < 4; q++) {
        const dir = q === 0 ? -1 : q === 1 ? 1 : 0;
        const x = q === 0 ? F.left - 1 : q === 1 ? F.right + 1 : q === 2 ? cx - 2 : cx + 2;
        const y = q === 0 ? feet - Math.round(F.h * 0.45) : q === 1 ? feet - Math.round(F.h * 0.6) : q === 2 ? top - 1 : top;
        c.fillStyle = q & 1 ? P.glow : P.spark;
        if (dir) c.fillRect(Math.round(x + (dir > 0 ? 0 : -2)), Math.round(y), 3, 1);
        else c.fillRect(Math.round(x), Math.round(y - 2), 1, 3);
        px(c, x, y - (dir ? 0 : 2), '#ffffff');
      }
      if (g) halo(g, cx, feet - F.h * 0.5, F.h * 0.8, P.glow, 0.18 * fade, R.bounds);
    }
    if (look.cracks) {
      c.globalAlpha = 0.85 * fade;
      for (let q = 0; q < 3; q++) {
        const x0 = F.left + 1 + hash(q, 3) * (w - 2);
        const y0 = top + 3 + hash(q, 5) * (F.h - 6);
        px(c, x0, y0, P.core);
        px(c, x0 + 1, y0 + 1, P.deep);
        px(c, x0 + 1, y0 + 2, P.core);
      }
    }
    if (s.def.overlay === 'sparks') {
      const seed = Math.floor(t * 20) + (a.x | 0);
      for (let q = 0; q < 2; q++) {
        const x0 = F.left + hash(seed, q) * w;
        const y0 = top + 2 + hash(seed, q, 2) * (F.h - 4);
        c.globalAlpha = fade;
        zig(c, x0, y0, x0 + (hash(seed, q, 3) - 0.5) * 10, y0 + (hash(seed, q, 4) - 0.5) * 8, 3, 1.5, seed + q, q ? P.spark : P.core, 1);
        if (g) zig(g, x0, y0, x0 + (hash(seed, q, 3) - 0.5) * 10, y0 + (hash(seed, q, 4) - 0.5) * 8, 3, 1.5, seed + q, P.spark, 1);
      }
      if (g) halo(g, cx, feet - F.h * 0.5, F.h * 0.7, P.glow, (Math.floor(t * 14) & 1 ? 0.35 : 0.12) * fade, R.bounds);
    }
    if (s.def.overlay === 'flame') {
      // Tongues of flame licking up the silhouette, re-rolled a dozen times a second.
      const n = w > 12 ? 4 : 3;
      const seed = Math.floor(t * 12) + (a.x | 0) * 7;
      const base = top + Math.round(F.h * 0.55);
      for (let q = 0; q < n; q++) {
        const x = Math.round(F.left + ((q + 0.5) / n) * w + (hash(seed, q, 1) - 0.5) * 2);
        const hgt = 3 + Math.round(hash(seed, q) * (q === 1 || q === 2 ? 6 : 4));
        const y0 = base - Math.round(hash(q, a.x | 0) * 3);
        c.globalAlpha = fade;
        c.fillStyle = P.deep;
        c.fillRect(x - 1, y0 - Math.round(hgt * 0.5), 3, Math.round(hgt * 0.5) + 1);
        c.fillStyle = P.glow;
        c.fillRect(x, y0 - hgt + 1, 1, hgt);
        if (hgt > 4) c.fillRect(x - 1, y0 - Math.round(hgt * 0.4), 1, 2);
        c.fillStyle = P.core;
        c.fillRect(x, y0 - Math.round(hgt * 0.35), 1, 2);
        px(c, x, y0 - hgt, P.spark);
        if (g) {
          g.globalAlpha = 0.8 * fade;
          g.fillStyle = P.spark;
          g.fillRect(x, y0 - hgt + 1, 1, Math.max(1, hgt - 2));
          g.globalAlpha = 1;
        }
      }
      if (g) halo(g, cx, feet - F.h * 0.45, F.h * 0.9, P.glow, 0.32 * fade * (0.6 + 0.4 * flicker(t, a.x)), R.bounds);
    }
    switch (look.head) {
      case 'stars': {
        for (let q = 0; q < 3; q++) {
          const an = t * 7 + (q / 3) * TAU;
          const x = cx + Math.cos(an) * 6;
          const y = top - 3 + Math.sin(an) * 2;
          c.globalAlpha = fade;
          const col = q ? '#fff07a' : '#ffffff';
          px(c, x, y, col);
          if (Math.sin(an) > -0.2) {
            px(c, x - 1, y, col);
            px(c, x + 1, y, col);
            px(c, x, y - 1, col);
            px(c, x, y + 1, col);
          }
          if (g) px(g, x, y, '#fff7b0');
        }
        break;
      }
      case 'swirl': {
        c.globalAlpha = 0.8 * fade;
        ring(c, cx, top - 2, 4 + ((t * 20) % 3), P.glow, 1, 0.45, t * 9, t * 9 + 3.5);
        break;
      }
      case 'glare': {
        const s2 = 2 + Math.round(1.5 * Math.abs(Math.sin(t * 8)));
        const x = cx + 4;
        const y = top + 2;
        c.globalAlpha = fade;
        rect(c, x - s2, y, s2 * 2 + 1, 1, '#ffffff');
        rect(c, x, y - s2, 1, s2 * 2 + 1, '#ffffff');
        if (g) halo(g, x, y, 8, '#fffbe6', 0.6 * fade, R.bounds);
        break;
      }
      case 'hearts': {
        const y = Math.round(top - 5 + Math.sin(t * 4) * 1.5);
        c.globalAlpha = fade;
        c.fillStyle = P.glow;
        c.fillRect(cx - 2, y, 2, 1);
        c.fillRect(cx + 1, y, 2, 1);
        c.fillRect(cx - 2, y + 1, 5, 1);
        c.fillRect(cx - 1, y + 2, 3, 1);
        c.fillRect(cx, y + 3, 1, 1);
        px(c, cx - 2, y, P.core);
        if (g) halo(g, cx, y + 1, 6, P.glow, 0.45 * fade, R.bounds);
        break;
      }
      case 'steam': {
        c.globalAlpha = 0.35 * fade;
        ell(c, cx + Math.sin(t * 3) * 2, top + 1, 6, 3, '#e8eef2');
        break;
      }
      default:
        break;
    }
    switch (look.feet) {
      case 'vines': {
        const grow = clamp01((s.dur - s.t) / 0.25);
        for (let q = 0; q < 3; q++) {
          const vx = cx - 4 + q * 4;
          const hh = Math.round((5 + q * 2 - (q === 2 ? 3 : 0)) * grow);
          for (let yy = 0; yy < hh; yy++) {
            const xx = vx + Math.round(Math.sin(yy * 0.9 + q * 2 + t * 2) * 1.2);
            c.globalAlpha = fade;
            px(c, xx, feet - yy, yy & 1 ? P.deep : P.glow);
          }
          if (hh > 2) px(c, vx + 1, feet - hh, P.spark);
        }
        c.globalAlpha = 0.8 * fade;
        ring(c, cx, feet, w * 0.5 + 2, P.deep, 1, 0.45);
        break;
      }
      case 'mud': {
        c.globalAlpha = 0.7 * fade;
        ell(c, cx, feet, w * 0.5 + 3, 2.5, '#5a3f22');
        c.globalAlpha = 0.6 * fade;
        rect(c, cx - 3, feet - 1, 2, 1, '#8a6a3e');
        if (Math.sin(t * 5 + cx) > 0.6) px(c, cx + 2, feet - 1, '#a88a5e');
        break;
      }
      case 'rime': {
        const n = 4 + s.stacks * 2;
        for (let q = 0; q < n; q++) {
          const an = (q / n) * TAU + 0.3;
          c.globalAlpha = fade;
          px(c, cx + Math.cos(an) * (w * 0.5 + 2), feet + Math.sin(an) * 2, q & 1 ? '#ffffff' : P.glow);
        }
        break;
      }
      default:
        break;
    }
    if (look.ring) {
      c.globalAlpha = (0.45 + 0.25 * Math.sin(t * 5 + k)) * fade;
      ring(c, cx, feet, w * 0.5 + 2, P.glow, 1, 0.45);
      if (g) {
        g.globalAlpha = 0.4 * fade;
        ring(g, cx, feet, w * 0.5 + 2, P.glow, 1, 0.45);
        g.globalAlpha = 1;
      }
    }
    c.globalAlpha = 1;
  }

  // Lights from statuses: the burning glow, a shock's flicker, the dazzle at the head.
  lights(push, magic) {
    const list = magic?.status?.afflicted;
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const l = a.magicStatus;
      if (!l || !l.length || a.removed || a.dead) continue;
      for (let k = 0; k < l.length; k++) {
        const s = l[k];
        const L = statusLook(s.def).light;
        if (!L) continue;
        const rec = recOf(a);
        push(a.x, a.y - rec.h * 0.5 - (a.z || 0), L.r, statusLook(s.def).tint || s.def.color, L.k * clamp01(s.t / 0.25), L.flicker);
      }
    }
  }
}

// An actor's current sprite frame and its anchor (afterimages of dashes and echoes).
const SPR = { img: null, ax: 0, ay: 0 };
export function spriteOf(atlas, a) {
  const F = actorFrame(atlas, a, 0, 0);
  SPR.img = F.img;
  SPR.ax = Math.round(a.x) - F.dx;
  SPR.ay = Math.round(a.y) - Math.round(a.z || 0) - F.dy;
  return SPR;
}

export { statusPal };
