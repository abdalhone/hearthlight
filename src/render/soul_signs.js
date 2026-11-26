// The signs of the taken flame, on you and in the world (round 14b §13b, S20-8; workstream
// soul; DESIGN §37.10). `game.unkindle.signs`.
//
// The author: "it shows some weird things about me." What shows follows coldfire's tier
// (src/magic/coldfire.js: the settled mark, so the signs come on over days and leave over
// weeks once you stop):
//   1 faint   your breath fogs at night, even a warm one (puffs at your mouth); your hands are
//             ice-cold (felt only by touch: src/society/dark_suspicion.js);
//   2 clear   household flames and lamps lean away from you and gutter as you pass (this
//             frame's light only, nudged away from you and sputtering; never a light itself);
//             hens, the cat and the wild things shy from you (creature.scare); frost forms in
//             your footprints at night (pale prints that melt away);
//   3 strong  a pale cold glint in your eyes at night; your shadow is slow to follow you (a
//             second, faint shadow that lags); the wildflowers by your bed wilt.
// The world part (scaring, the prints, which flames lean) runs anywhere, tests included; the
// drawing installs only on a browser game: a `drawShadow` of its own on the player (the
// renderer's ground pass: prints, the slow shadow, the flowers), a wrapper on the player's
// `draw` (breath and eyes) and one on `lighting.composite` (the leaning flames), all on
// instances, no file edited. Reduce motion: the still version (no puffing, no sputter, no
// lag: the shadow sits a fixed step behind, the prints do not twinkle). Cost: a few rects a
// frame, one pass over the frame's lights.

import { TILE } from '../core/constants.js';

export const LEAN_R = 60; // px: flames this near you lean away
const SHY_R = 46; // px: the hens and the cat run from you
const SHY_SPECIES = new Set(['chicken', 'cat', 'rabbit', 'deer', 'dog', 'horse']);
const PRINTS = 36;
const PRINT_LIFE = 26; // s
const SCAN = 0.5; // s between looks round you
const FROST = ['#eef6ff', '#cfe4ff', '#a9c8f0'];
const GLINT = '#f0faff';
const SHADOW = 'rgba(11,10,20,0.32)';
const FLOWERS = { x: 93 * TILE + 13, y: 77 * TILE + 3 }; // beside your bed in the Wayhouse

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[soul signs]', err);
    return fallback;
  }
}

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

export class SoulSigns {
  constructor(game, unk) {
    this.game = game;
    this.unk = unk;
    this.prints = []; // { x, y, t, side }
    this.shyAt = -Infinity;
    this.frostAt = -Infinity;
    this.leaning = false;
    this.scanT = 0;
    this.lastStep = null;
    this.lag = { x: 0, y: 0, ok: false }; // the slow shadow
    this.breathT = 0;
    this.puffs = []; // { x, y, t }
    this.riteFlash = 0;
    this.drawn = false;
    this.player = null;
    this.stats = { prints: 0, leaned: 0 };
  }

  get reduce() {
    return !!this.game?.settings?.reduceMotion;
  }

  tier() {
    return this.unk?.coldfire?.tier?.() ?? 0;
  }

  now() {
    const t = this.game?.clock?.t;
    return Number.isFinite(t) ? t : Number(this.game?.time) || 0;
  }

  isNight() {
    const c = this.game?.clock;
    if (typeof c?.isNight === 'boolean') return c.isNight;
    const h = c?.hour ?? 12;
    return h >= 20 || h < 6;
  }

  // ------------------------------------------------------------------ the world

  update(dt) {
    const g = this.game;
    const P = g?.player;
    if (!P || !(dt > 0)) return;
    if (this.drawn && P !== this.player) this.wrapPlayer(P);
    const tier = this.tier();
    // Frost in your footprints at night (a print each step the body takes).
    const si = P.stepIndex;
    if (Number.isFinite(si) && si !== this.lastStep) {
      if (this.lastStep != null && tier >= 2 && this.isNight() && !P.rolling) this.print(P, si);
      this.lastStep = si;
    }
    const t = this.now();
    while (this.prints.length && t - this.prints[0].t > PRINT_LIFE) this.prints.shift();
    // The slow shadow follows at its own pace.
    const k = Math.min(1, dt * 3.2);
    if (!this.lag.ok) {
      this.lag.x = P.x;
      this.lag.y = P.y;
      this.lag.ok = true;
    }
    this.lag.x += (P.x - this.lag.x) * k;
    this.lag.y += (P.y - this.lag.y) * k;
    if (Math.hypot(P.x - this.lag.x, P.y - this.lag.y) > 60) {
      this.lag.x = P.x;
      this.lag.y = P.y;
    }
    if (this.riteFlash > 0) this.riteFlash = Math.max(0, this.riteFlash - dt);
    this.scanT -= dt;
    if (this.scanT > 0) return;
    this.scanT = SCAN;
    this.leaning = tier >= 2 && this.flamesNear(P);
    if (tier >= 2) this.shy(P);
  }

  print(P, si) {
    const side = si % 2 ? 1 : -1;
    const fx = P.facing?.x ?? 0;
    const fy = P.facing?.y ?? 1;
    // a step to the side of the way you walk
    this.prints.push({ x: P.x - fy * side * 2, y: P.y + fx * side * 2 + 1, t: this.now(), side });
    if (this.prints.length > PRINTS) this.prints.shift();
    this.frostAt = this.now();
    this.stats.prints++;
  }

  // Is a kept flame (a lamp, a candle, a hearth, a campfire) burning within LEAN_R of you?
  flamesNear(P) {
    const g = this.game;
    const list = safe(() => g.objects?.inRadius?.(P.x, P.y, LEAN_R, (o) => !o.removed && typeof o.getLight === 'function' && (o.lit || o.objType === 'hearth' || o.objType === 'campfire' || o.alwaysLit)), []) || [];
    return list.length > 0;
  }

  // The hens, the cat and the wild things shy from you.
  shy(P) {
    const g = this.game;
    const list = safe(() => g.entities?.query?.(P.x, P.y, SHY_R), []) || [];
    for (const c of list) {
      if (!c || c === P || c.removed || c.dead || !SHY_SPECIES.has(c.species)) continue;
      if (Math.hypot(c.x - P.x, c.y - P.y) > SHY_R) continue;
      if (typeof c.scare === 'function') {
        safe(() => c.scare(P, 2.5));
        this.shyAt = this.now();
      }
    }
  }

  leaningNear() {
    return this.leaning;
  }

  onRite() {
    this.riteFlash = 1.2;
    this.prints.length = 0;
  }

  // ------------------------------------------------------------------ drawing (a browser)

  install() {
    const g = this.game;
    if (this.drawn || !g?.renderer) return;
    const L = g.lighting;
    if (L && typeof L.composite === 'function' && !L._signsWrapped) {
      const orig = L.composite.bind(L);
      const self = this;
      L.composite = function soulSignsLights(ctx, r, time, vig) {
        const moved = safe(() => self.leanLights(L, time), null);
        let out;
        try {
          out = orig(ctx, r, time, vig);
        } finally {
          if (moved) for (const m of moved) {
            m.l.x = m.x;
            m.l.y = m.y;
          }
        }
        // Over the night's light (so they read in the dark): the flames leaning from you, your
        // breath, the cold in your eyes.
        safe(() => self.drawLit(ctx, r, time, moved));
        return out;
      };
      L._signsWrapped = true;
    }
    this.drawn = true;
    if (g.player) this.wrapPlayer(g.player);
  }

  // The player's own ground pass (drawShadow, which the renderer calls under everything).
  wrapPlayer(P) {
    if (!P || P._soulSigns) {
      this.player = P;
      return;
    }
    const self = this;
    P._soulSigns = { hadShadow: Object.prototype.hasOwnProperty.call(P, 'drawShadow'), shadow: P.drawShadow };
    const prevShadow = P.drawShadow;
    P.drawShadow = function soulSignsGround(ctx, ox, oy, time) {
      if (typeof prevShadow === 'function') prevShadow.call(this, ctx, ox, oy, time);
      safe(() => self.drawGround(ctx, ox, oy, time));
    };
    this.player = P;
  }

  // Under everything: the frost in your steps, the shadow slow to follow, the flowers by your bed.
  drawGround(ctx, ox, oy, time) {
    const tier = this.tier();
    const P = this.game?.player;
    const rm = this.reduce;
    const t = this.now();
    if (this.prints.length) {
      for (let i = 0; i < this.prints.length; i++) {
        const p = this.prints[i];
        const age = t - p.t;
        const a = clamp(1 - age / PRINT_LIFE) * 0.85;
        if (a <= 0.02) continue;
        const x = Math.round(p.x - ox);
        const y = Math.round(p.y - oy);
        ctx.globalAlpha = a;
        ctx.fillStyle = FROST[1];
        ctx.fillRect(x - 1, y - 1, 3, 2);
        ctx.fillStyle = FROST[0];
        ctx.fillRect(x - 1 + (p.side > 0 ? 2 : 0), y - 2, 1, 1);
        if (!rm && ((time * 3 + i) | 0) % 5 === 0) ctx.fillRect(x + (p.side > 0 ? -1 : 1), y, 1, 1);
        ctx.fillStyle = FROST[2];
        ctx.fillRect(x - 2, y, 1, 1);
        ctx.fillRect(x + 2, y - 1, 1, 1);
      }
      ctx.globalAlpha = 1;
    }
    if (tier >= 3 && P && !P.dead && !P.carriedBy) {
      // A second shadow, a beat behind you (still: a fixed step behind the way you face).
      let lx = this.lag.x;
      let ly = this.lag.y;
      if (rm) {
        lx = P.x - (P.facing?.x ?? 0) * 3;
        ly = P.y - (P.facing?.y ?? 1) * 2;
      }
      if (Math.hypot(lx - P.x, ly - P.y) > 0.8 || rm) {
        ctx.fillStyle = SHADOW;
        ctx.beginPath();
        ctx.ellipse(Math.round(lx - ox), Math.round(ly - oy) + 1, Math.max(3, (P.radius || 4) + 1), 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    this.drawFlowers(ctx, ox, oy, tier);
  }

  // A cup of wildflowers by your bed: fresh, drooping as the mark grows, dead at its strongest.
  drawFlowers(ctx, ox, oy, tier) {
    const g = this.game;
    const bed = safe(() => g.objects?.get?.('home_bed'), null);
    if (!bed || bed.removed) return;
    const x = Math.round(FLOWERS.x - ox);
    const y = Math.round(FLOWERS.y - oy);
    const r = g.renderer;
    if (r && (x < -8 || y < -12 || x > (r.buffer?.width ?? 9999) + 8 || y > (r.buffer?.height ?? 9999) + 8)) return;
    const wilt = tier >= 3 ? 2 : tier >= 2 ? 1 : 0;
    // the cup
    ctx.fillStyle = '#6b5440';
    ctx.fillRect(x - 2, y - 3, 4, 4);
    ctx.fillStyle = '#8a6f55';
    ctx.fillRect(x - 2, y - 3, 4, 1);
    const stem = wilt === 2 ? '#6d6a4c' : wilt === 1 ? '#5f8a4a' : '#4f9a48';
    const heads = wilt === 2 ? ['#7a6a5a', '#6f625a', '#857565'] : wilt === 1 ? ['#c98aa6', '#d2c06e', '#9fa8d8'] : ['#f2a2c4', '#ffe27a', '#b9c4ff'];
    ctx.fillStyle = stem;
    if (wilt === 2) {
      // fallen over the rim
      ctx.fillRect(x - 3, y - 4, 2, 1);
      ctx.fillRect(x + 1, y - 4, 3, 1);
      ctx.fillRect(x - 1, y - 5, 1, 2);
      ctx.fillStyle = heads[0];
      ctx.fillRect(x - 4, y - 3, 1, 1);
      ctx.fillStyle = heads[1];
      ctx.fillRect(x + 4, y - 3, 1, 1);
      ctx.fillStyle = heads[2];
      ctx.fillRect(x - 1, y - 6, 1, 1);
      // dropped petals
      ctx.fillStyle = '#6f625a';
      ctx.fillRect(x + 3, y + 1, 1, 1);
      ctx.fillRect(x - 4, y + 2, 1, 1);
      return;
    }
    const droop = wilt === 1 ? 1 : 0;
    ctx.fillRect(x - 1, y - 7 + droop, 1, 4 - droop);
    ctx.fillRect(x + 1, y - 6 + droop, 1, 3 - droop);
    ctx.fillRect(x, y - 8 + droop, 1, 5 - droop);
    ctx.fillStyle = heads[0];
    ctx.fillRect(x - 2 + (droop ? -1 : 0), y - 8 + droop * 2, 2, 1);
    ctx.fillStyle = heads[1];
    ctx.fillRect(x + 1 + droop, y - 7 + droop * 2, 2, 1);
    ctx.fillStyle = heads[2];
    ctx.fillRect(x, y - 9 + droop * 2, 1, 1);
  }

  // After the night's light, in device pixels (one world pixel = renderer.scale): the flames
  // near you leaning away (a tongue of flame bent from you, sputtering), your breath that fogs
  // at night, the pale cold glint in your eyes. Still under reduce motion: no puffing, no
  // sputter, a steady lean.
  drawLit(ctx, r, time, moved) {
    const tier = this.tier();
    const P = this.game?.player;
    if (tier < 1 || !P || P.dead || !r?.worldToDevice) return;
    const sc = r.scale || 3;
    const rm = this.reduce;
    const px = (wx, wy, w, h, color, a) => {
      const d = r.worldToDevice(wx, wy);
      ctx.globalAlpha = a;
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(d.x), Math.round(d.y), Math.ceil(w * sc), Math.ceil(h * sc));
    };
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    // The flames, leaning away.
    if (tier >= 2 && moved?.length) {
      for (let i = 0; i < moved.length; i++) {
        const m = moved[i];
        const dx = m.x - P.x;
        const dy = m.y - (P.y - 8);
        const d = Math.hypot(dx, dy) || 1;
        const ux = dx / d;
        const near = clamp(1 - d / LEAN_R);
        const sp = rm ? 0.6 : 0.5 + 0.5 * Math.sin(time * 17 + i * 1.9);
        const lean = (1.5 + 2.5 * near) * (rm ? 1 : 0.7 + 0.3 * sp);
        const fx = Math.round(m.x);
        const fy = Math.round(m.y);
        // the tongue: three steps bent from you, thinning, a cold blue root where it gutters
        px(fx - 0.5, fy, 1, 1, '#9fd4ff', 0.55 * near);
        px(fx + ux * lean * 0.35, fy - 1, 1, 1, '#ffd27a', 0.9);
        px(fx + ux * lean * 0.7, fy - 2, 1, 1, '#ffe9a8', 0.85);
        px(fx + ux * lean, fy - 3, 1, 1, '#fff6d8', 0.55 + 0.35 * sp);
        if (!rm && sp > 0.75) px(fx + ux * (lean + 1), fy - 4.5, 1, 1, '#8a8aa0', 0.4);
      }
    }
    const night = this.isNight();
    if (night && !P.downed && !P.carriedBy) {
      const dir = P.dir || 'down';
      const fx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
      const fy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
      const z = P.z || 0;
      // Breath: a small cold puff before the face every couple of seconds (still: a faint haze).
      const cyc = rm ? 0.3 : (time * 0.45) % 1;
      if (rm || cyc < 0.6) {
        const k = rm ? 0.55 : Math.sin((cyc / 0.6) * Math.PI);
        const drift = rm ? 1 : cyc * 6;
        const bx = P.x + fx * (4 + drift) - (fx ? 0 : 1);
        const by = P.y - 13 - z + fy * 2 - drift * 0.7;
        px(bx - 1, by, 3, 1, '#e4eefa', 0.16 + 0.3 * k);
        px(bx, by - 1, 2, 1, '#e4eefa', 0.12 + 0.26 * k);
        if (k > 0.45) px(bx + (fx || 1) * 2, by - 2, 2, 1, '#e4eefa', 0.1 + 0.22 * k);
      }
      // Eyes: two cold pixels facing you, one in profile, none from behind.
      if (tier >= 3 && dir !== 'up') {
        const a = rm ? 0.95 : 0.82 + 0.18 * Math.sin(time * 2.1);
        // (on the sprite's own eyes: measured from the drawn frames, 19 px above the feet)
        const ey = P.y - 19 - z;
        if (dir === 'down') {
          px(P.x - 3, ey, 1, 2, GLINT, a);
          px(P.x + 2, ey, 1, 2, GLINT, a);
        } else px(P.x + (fx > 0 ? 1 : -2), ey, 1, 2, GLINT, a);
        // and a faint cold halo round them
        px(P.x - 4, ey, 8, 1, '#9fd4ff', 0.12 * a);
      }
    }
    ctx.restore();
  }

  // Flames near you lean away and gutter: this frame's light only (restored after composite).
  leanLights(L, time) {
    const P = this.game?.player;
    if (!P || this.tier() < 2 || !L?.lights) return null;
    const rm = this.reduce;
    const seen = L._seen;
    const moved = [];
    for (let i = 0; i < L.count; i++) {
      const l = L.lights[i];
      if (!l) continue;
      const dx = l.x - P.x;
      const dy = l.y - (P.y - 8);
      const d = Math.hypot(dx, dy);
      if (d > LEAN_R || d < 12) continue; // the moonlight round you is your own
      const warm = typeof l.color === 'string' && /^#(f|e|d)/i.test(l.color);
      if (!warm) continue;
      const near = 1 - d / LEAN_R;
      const push = 2 + 4 * near;
      moved.push({ l, x: l.x, y: l.y });
      l.x += (dx / (d || 1)) * push;
      l.y += (dy / (d || 1)) * push * 0.5 - near;
      if (seen) {
        const sp = rm ? 0.5 : 0.5 + 0.5 * Math.sin(time * 19 + i * 2.3) * Math.sin(time * 6.7 + i);
        seen[i] *= Math.max(0.2, 1 - near * (0.25 + 0.35 * sp));
      }
    }
    this.stats.leaned = moved.length;
    return moved;
  }
}
