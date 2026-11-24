import { FxParticles, styleId, rampFor } from './fx_particles.js';
import { Effects } from './fx_effects.js';
import { StatusFx, spriteOf, statusPal } from './fx_status.js';
import { MagicSfx } from './sfx.js';
import { drawBody, drawBodyGround, drawOrbitRing, drawLockOn, drawCharge, drawPatch } from './fx_bodies.js';
import { planLook } from './fx_styles.js';
import { Bounds, ell, halo, px } from './fx_draw.js';
import { makeCanvas, ctx2d, TAU, hash } from './fx_util.js';
import { handleEvent } from './fx_events.js';

// The look and sound of the Weave (DESIGN §22.2): game.magicFx. The runtime (magic.js)
// calls it through a small seam: onEvent(type, payload) for everything that happens,
// update(dt) once per game step, and the draw hooks of its render layer — drawGround
// (under every actor), drawLayer (every body, over the actors), drawStatuses (status
// marks on actors) and getLights (a light for every body and burning foe). The renderer
// also calls drawGlow(ctx, renderer) right after lighting: everything bright that the
// passes drew into the glow buffer is added there, pixel-sharp, with a soft bloom, so
// spells blaze at night and stay readable by day.
//
// Pieces: fx_particles (pooled particles in essence styles), fx_bodies (each body kind),
// fx_familiars (summoned creatures), fx_status (statuses on actors), fx_effects (short
// flourishes), fx_events (what each event does), fx_styles (how each essence looks),
// sfx.js (synthesized sound). Everything keys off registry data, so a new essence,
// shape, twist or status shows and sounds right without code here.

const MAX_FX_LIGHTS = 40;
const VIEW_MARGIN = 90;
// Past this many bodies in view each sheds proportionally less, so a screen full of
// weaves keeps about the particle count of a busy fight, not a multiple of it.
const CROWD = 14;
const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

const PATCH_PART = { embers: 'flame', puddle: 'drop', glaze: 'twinkle', crackle: 'zap', cracks: 'dust', gusts: 'gust', brambles: 'leaf', ooze: 'bubble', sigil: 'mote', shadow: 'wisp', filings: 'filing', chord: 'note', arcane: 'mote' };
const WALL_PART = { flame: 'flame', water: 'drop', ice: 'snow', arcane: 'mote', storm: 'zap', stone: 'dust', wind: 'gust', thorns: 'leaf', poison: 'bubble', light: 'mote', shadow: 'wisp', iron: 'filing', song: 'note' };
const DECAL_PATCH = { puddle: 'puddle', glaze: 'glaze', rime: 'glaze', ooze: 'ooze', crack: 'cracks', filings: 'filings' };

function newLight() {
  return { x: 0, y: 0, r: 0, color: '#ffffff', intensity: 0, flicker: 0, glow: 1 };
}

export class MagicFx {
  constructor(game, opts = {}) {
    this.game = game;
    this.sfx = true; // the Weave plays its own sounds (combat stays quiet on weave hits)
    this.sound = new MagicSfx(game);
    this.parts = new FxParticles(opts.particles ?? 720);
    this.effects = new Effects(opts.effects ?? 220);
    this.statusFx = new StatusFx(this);
    this.bounds = new Bounds();
    this.R = { ctx: null, g: null, ox: 0, oy: 0, w: 480, h: 270, time: 0, dark: 0, bounds: this.bounds, parts: this.parts };
    this.glow = null;
    this.gctx = null;
    this.b1 = null;
    this.b1ctx = null;
    this.b2 = null;
    this.b2ctx = null;
    this._frame = -2;
    this._drawnFrame = -3;
    this._lights = [];
    for (let i = 0; i < MAX_FX_LIGHTS; i++) this._lights.push(newLight());
    this._lightOut = [];
    this._owners = [];
    this._targets = [];
    this._lastDamage = null;
    this._hsAt = -1;
    this._pendingDash = null;
    this._warned = new Set();
    this.stats = { bodies: 0, drawn: 0 };
    // Quality 0.35..1: eased down when frames run long while many weaves are up (fewer
    // particles and lights), back up when there is time to spare.
    this.q = 1;
    this._ft = 16.7;
    this._frameAt = 0;
    this._viewN = 0;
    this._decalL = { halo: '#ffffff', accent: '#ffffff' };
    try {
      game.bus?.on?.('damage', (p) => {
        if (p && (p.magic || p.damageType)) this._lastDamage = p;
      });
    } catch {
      /* no bus in some tests */
    }
  }

  warn(what, err) {
    if (this._warned.has(what)) return;
    this._warned.add(what);
    console.warn(`[magic fx] ${what} failed`, err);
  }

  // ------------------------------------------------------------------ juice

  flash(x, y, r, color, intensity, duration) {
    try {
      this.game.lighting?.flash?.({ x, y, r, color, intensity, duration });
    } catch (err) {
      this.warn('flash', err);
    }
  }

  // Gentle camera shake; none at all when the player asked for reduced motion.
  shake(strength, seconds) {
    const g = this.game;
    if (g.settings?.reduceMotion) return;
    try {
      g.camera?.shake?.(strength, seconds);
    } catch (err) {
      this.warn('shake', err);
    }
  }

  // A tiny freeze of the world on heavy hits (never more often than every 0.12 s).
  hitStop(seconds) {
    const g = this.game;
    const now = g.time ?? 0;
    if (now - this._hsAt < 0.12 && now >= this._hsAt) return;
    this._hsAt = now;
    g.hitStop = Math.max(g.hitStop || 0, seconds);
  }

  frameOf(actor) {
    return spriteOf(this.game.atlas, actor);
  }

  statusPal(def) {
    return statusPal(def);
  }

  // ------------------------------------------------------------------ the seam

  onEvent(type, payload, magic) {
    try {
      handleEvent(this, type, payload, magic);
    } catch (err) {
      this.warn(`event ${type}`, err);
    }
  }

  update(dt, magic) {
    if (!(dt > 0) || !magic) return;
    const cam = this.game.camera;
    const x0 = (cam?.x ?? -1e9) - VIEW_MARGIN;
    const y0 = (cam?.y ?? -1e9) - VIEW_MARGIN;
    const x1 = (cam?.x ?? 1e9) + (cam?.vw ?? 2e9) + VIEW_MARGIN;
    const y1 = (cam?.y ?? 1e9) + (cam?.vh ?? 2e9) + VIEW_MARGIN;
    const list = magic.bodies;
    const crowd = this._viewN > CROWD ? CROWD / this._viewN : 1;
    this.parts.scale = this.q * crowd;
    this.parts.q = this.q;
    let seen = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b.active || b.delay > 0 || !b.plan) continue;
      const fs = b.fxState || (b.fxState = { acc: 0, acc2: 0, k: 0, sx: b.x, sy: b.y, lunge: 0 });
      if (fs.lunge > 0) fs.lunge = Math.max(0, fs.lunge - dt * 2);
      if (b.x < x0 || b.x > x1 || b.y < y0 || b.y > y1) continue;
      seen++;
      try {
        this._emitBody(b, fs, dt);
      } catch (err) {
        this.warn(`emit ${b.kind}`, err);
      }
    }
    this._viewN = seen;
    this.parts.update(dt);
    this.effects.update(dt);
    try {
      this.statusFx.update(dt, magic, this.parts);
    } catch (err) {
      this.warn('status update', err);
    }
  }

  _emit(style, pal, x, y, z, vx, vy, vz) {
    const st = styleId(style);
    this.parts.add(st, rampFor(st, pal), x, y, z, vx, vy, vz);
  }

  // How many particles a body sheds this step (fractional rates accumulate).
  _count(fs, rate, dt) {
    fs.acc = (fs.acc || 0) + rate * dt;
    const n = Math.floor(fs.acc);
    fs.acc -= n;
    return n ? this.parts.budget(n) : 0;
  }

  _emitBody(b, fs, dt) {
    const L = planLook(b.plan);
    const T = L.trail;
    switch (b.kind) {
      case 'projectile': {
        if (b.mode === 'fly' || b.mode === 'orb') {
          const n = this._count(fs, (b.mode === 'orb' ? 26 : 38) * Math.min(1.6, 0.55 + b.r * 0.12), dt);
          for (let i = 0; i < n; i++) {
            const it = T[(fs.k = (fs.k || 0) + 1) % T.length];
            const j = b.mode === 'orb' ? b.r * 0.8 : b.r * 0.5;
            this._emit(it.style, it.pal, b.x + (Math.random() - 0.5) * j * 2, b.y + (Math.random() - 0.5) * j, b.z + (Math.random() - 0.5) * j, -b.vx * 0.12 + (Math.random() - 0.5) * 14, -b.vy * 0.12 + (Math.random() - 0.5) * 10, (Math.random() - 0.3) * 10);
          }
        } else if (b.mode === 'lob') {
          const n = this._count(fs, 24, dt);
          for (let i = 0; i < n; i++) {
            const it = T[(fs.k = (fs.k || 0) + 1) % T.length];
            this._emit(it.style, it.pal, b.x, b.y, b.z, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8, 0);
          }
        } else if (b.mode === 'fall') {
          const n = this._count(fs, 14, dt);
          for (let i = 0; i < n; i++) {
            const it = T[(fs.k = (fs.k || 0) + 1) % T.length];
            this._emit(it.style, it.pal, b.x + (Math.random() - 0.5) * 2, b.y, b.z + 4, 0, 0, 0);
          }
        } else if (b.mode === 'arc') {
          const n = this._count(fs, 40, dt);
          for (let i = 0; i < n; i++) this._emit('zap', L.pal, b.x, b.y, b.z, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 20, 0);
        }
        break;
      }
      case 'area': {
        const k = Math.min(1, b.age / Math.max(0.01, b.life));
        if (b.mode === 'ring' || b.mode === 'cone') {
          const r = b.cur;
          const cone = b.mode === 'cone';
          const n = this._count(fs, (cone ? 70 : 90) * (1 - k) * Math.min(2, 0.5 + r / 60), dt);
          const D = L.debris;
          for (let i = 0; i < n; i++) {
            const it = D[(fs.k = (fs.k || 0) + 1) % D.length];
            const a = cone ? b.angle + (Math.random() * 2 - 1) * (b.arc || 0.6) : Math.random() * TAU;
            const sq = cone ? 0.75 : 0.62;
            const sp = 20 + Math.random() * 30;
            this._emit(it.style, it.pal, b.x + Math.cos(a) * r, b.y + Math.sin(a) * r * sq, cone ? 4 : 1, Math.cos(a) * sp, Math.sin(a) * sp * sq, 10 + Math.random() * 20);
          }
        } else if (b.mode === 'patch') {
          const style = PATCH_PART[L.look.patch] || 'mote';
          const n = this._count(fs, 4 + b.r1 * 0.12, dt);
          for (let i = 0; i < n; i++) {
            const a = Math.random() * TAU;
            const rr = Math.sqrt(Math.random()) * b.cur * 0.85;
            this._emit(style, L.pal, b.x + Math.cos(a) * rr, b.y + Math.sin(a) * rr * 0.6, 0, 0, 0, 2 + Math.random() * 6);
          }
        } else if (b.mode === 'rain') {
          const n = this._count(fs, 4, dt);
          for (let i = 0; i < n; i++) {
            const a = Math.random() * TAU;
            this._emit(T[0].style, T[0].pal, b.x + Math.cos(a) * b.r1, b.y + Math.sin(a) * b.r1 * 0.62, 0, 0, 0, 6);
          }
        }
        break;
      }
      case 'beam': {
        if (b.npts < 2) break;
        const n = this._count(fs, 46, dt);
        const m = b.npts - 1;
        for (let i = 0; i < n; i++) {
          const s = Math.min(m - 1, Math.floor(Math.random() * m));
          const q = Math.random();
          const x = b.pts[s * 2] + (b.pts[s * 2 + 2] - b.pts[s * 2]) * q;
          const y = b.pts[s * 2 + 1] + (b.pts[s * 2 + 3] - b.pts[s * 2 + 1]) * q;
          const it = T[(fs.k = (fs.k || 0) + 1) % T.length];
          this._emit(it.style, it.pal, x, y, 8, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 10, Math.random() * 10);
        }
        fs.acc2 = (fs.acc2 || 0) + dt * 24;
        const e = Math.floor(fs.acc2);
        fs.acc2 -= e;
        const D = L.debris;
        for (let i = 0; i < e; i++) {
          const it = D[(fs.k = (fs.k || 0) + 1) % D.length];
          this._emit(it.style, it.pal, b.pts[m * 2], b.pts[m * 2 + 1], 8, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 40, Math.random() * 30);
        }
        break;
      }
      case 'summon': {
        const n = this._count(fs, 7, dt);
        for (let i = 0; i < n; i++) {
          const it = T[(fs.k = (fs.k || 0) + 1) % T.length];
          this._emit(it.style, it.pal, b.x + (Math.random() - 0.5) * 6, b.y, (b.z || 4) + Math.random() * 6, (Math.random() - 0.5) * 8, 0, 2);
        }
        break;
      }
      case 'rune': {
        if (!b.armed) break;
        const n = this._count(fs, 3, dt);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU;
          const r = (b.trigR || 14) + 2;
          this._emit('mote', L.pal, b.x + Math.cos(a) * r, b.y + Math.sin(a) * r * 0.6, 0, 0, 0, 10);
        }
        break;
      }
      case 'wall': {
        const style = WALL_PART[L.look.wall] || 'mote';
        const n = this._count(fs, Math.max(4, (b.len || 40) * 0.25), dt);
        for (let i = 0; i < n; i++) {
          const q = Math.random();
          this._emit(style, L.pal, b.ox + (b.x2 - b.ox) * q, b.oy + (b.y2 - b.oy) * q, 4 + Math.random() * 8, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, 4);
        }
        break;
      }
      case 'trail': {
        const style = PATCH_PART[L.look.patch] || 'mote';
        const n = this._count(fs, 9 * (1 - Math.min(1, b.age / Math.max(0.01, b.life))), dt);
        for (let i = 0; i < n; i++) {
          const q = Math.random();
          this._emit(style, L.pal, b.x + (b.x2 - b.x) * q, b.y + (b.y2 - b.y) * q, 1, 0, 0, 4);
        }
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ drawing

  _ensureGlow(w, h) {
    if (!this.glow || this.glow.width !== w || this.glow.height !== h) {
      this.glow = makeCanvas(w, h);
      this.gctx = ctx2d(this.glow);
      this.b1 = makeCanvas(Math.ceil(w / 2), Math.ceil(h / 2));
      this.b1ctx = this.b1.getContext('2d');
      this.b2 = makeCanvas(Math.ceil(w / 4), Math.ceil(h / 4));
      this.b2ctx = this.b2.getContext('2d');
    }
  }

  // Start of a frame's drawing (the ground pass, or whichever pass comes first).
  _begin(ctx, ox, oy, time) {
    const R = this.R;
    const fr = this.game.renderer?.frame;
    const w = ctx.canvas?.width || 480;
    const h = ctx.canvas?.height || 270;
    R.ctx = ctx;
    R.ox = ox;
    R.oy = oy;
    R.w = w;
    R.h = h;
    R.time = time;
    if (Number.isFinite(fr) && fr === this._frame) return;
    this._frame = Number.isFinite(fr) ? fr : this._frame - 1;
    this._pace();
    this._ensureGlow(w, h);
    const g = this.gctx;
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    if (!this.bounds.empty) g.clearRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    this.bounds.reset();
    R.g = g;
    R.dark = this.game.lighting?.ambient?.darkness ?? 0;
  }

  // Once a frame: how long frames take, and the quality that follows from it.
  _pace() {
    const t = now();
    const d = t - this._frameAt;
    this._frameAt = t;
    if (!(d > 0 && d < 250)) return;
    this._ft += (d - this._ft) * 0.08;
    if (this._ft > 19.5 && this.stats.bodies > 24) this.q = Math.max(0.35, this.q - 0.015);
    else if (this._ft < 17.6 || this.stats.bodies < 12) this.q = Math.min(1, this.q + 0.005);
  }

  _inView(b, R) {
    if (b.kind === 'beam' || b.kind === 'wall' || b.kind === 'trail') return true;
    const x = b.x - R.ox;
    const y = b.y - R.oy;
    const m = b.kind === 'area' ? Math.max(40, b.r1 || 0) + 20 : 60;
    return x > -m && x < R.w + m && y > -m && y < R.h + m + 40;
  }

  drawGround(ctx, ox, oy, time, magic) {
    this._begin(ctx, ox, oy, time);
    const R = this.R;
    const decals = magic?.decals || [];
    for (let i = 0; i < decals.length; i++) {
      const d = decals[i];
      const x = d.x - ox;
      const y = d.y - oy;
      if (x < -40 || x > R.w + 40 || y < -40 || y > R.h + 40) continue;
      const a = Math.min(1, (d.life - d.t) / 2) * Math.min(1, d.t * 8);
      if (a <= 0.02) continue;
      try {
        this._drawDecal(d, x, y, a, time);
      } catch (err) {
        this.warn('decal', err);
      }
    }
    const list = magic?.bodies || [];
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b.active || b.delay > 0 || !b.plan || !this._inView(b, R)) continue;
      try {
        drawBodyGround(R, b);
      } catch (err) {
        this.warn(`ground ${b.kind}`, err);
      }
    }
    ctx.globalAlpha = 1;
    this.R.g.globalAlpha = 1;
  }

  _drawDecal(d, x, y, a, time) {
    const R = this.R;
    const c = R.ctx;
    const P = d.palette || { core: '#ffffff', glow: '#a995ff', spark: '#ddd2ff', deep: '#5a3fc0' };
    const style = DECAL_PATCH[d.mark];
    if (style) {
      this._decalL.halo = P.glow;
      this._decalL.accent = P.spark;
      drawPatch(R, style, P, this._decalL, x, y, d.r, a * 0.85, d.seed || 0, time);
      return;
    }
    switch (d.mark) {
      case 'scorch':
      case 'char':
      case 'blight': {
        c.globalAlpha = 0.42 * a;
        ell(c, x, y, d.r, d.r * 0.6, d.mark === 'blight' ? '#120a1e' : '#1c1418');
        c.globalAlpha = 0.22 * a;
        ell(c, x + 0.5, y, d.r * 0.55, d.r * 0.33, P.deep);
        if (d.t < 2.5 && d.mark === 'scorch' && hash(d.seed * 999, Math.floor(time * 6)) > 0.6) {
          c.globalAlpha = a;
          px(c, x + (d.seed - 0.5) * d.r, y, P.spark);
        }
        break;
      }
      case 'bloom':
      case 'sprout':
        for (let i = 0; i < 5; i++) {
          const an = (d.seed || 0) * 9 + i * 1.3;
          const fx = Math.round(x + Math.cos(an) * d.r * 0.7);
          const fy = Math.round(y + Math.sin(an) * d.r * 0.45);
          c.globalAlpha = a;
          c.fillStyle = P.deep;
          c.fillRect(fx, fy, 1, 2);
          c.fillStyle = i % 2 ? P.glow : d.mark === 'bloom' ? '#ffd1ee' : P.spark;
          c.fillRect(fx, fy - 1, 1, 1);
        }
        break;
      case 'glow':
        c.globalAlpha = 0.2 * a;
        ell(c, x, y, d.r, d.r * 0.6, P.glow);
        if (R.g) halo(R.g, x, y, d.r * 1.2, P.glow, 0.25 * a, R.bounds);
        break;
      case 'steam':
        c.globalAlpha = 0.18 * a;
        ell(c, x, y - 2, d.r * 0.7, d.r * 0.4, '#e8eef2');
        break;
      default:
        c.globalAlpha = 0.22 * a;
        ell(c, x, y, d.r, d.r * 0.6, P.deep);
    }
    c.globalAlpha = 1;
  }

  drawLayer(ctx, ox, oy, time, magic) {
    this._begin(ctx, ox, oy, time);
    const R = this.R;
    const list = magic?.bodies || [];
    const owners = this._owners;
    const targets = this._targets;
    owners.length = 0;
    targets.length = 0;
    let drawn = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b.active || b.delay > 0 || !b.plan) continue;
      // Twist cues that belong to the caster or the mark, once each.
      if (b.orbitT > 0 && b.owner && !owners.includes(b.owner)) {
        owners.push(b.owner);
        drawOrbitRing(R, b.owner, b.orbitR || 18, planLook(b.plan).pal);
      }
      if (b.homing > 0 && b.mode === 'fly' && b.target && !b.target.removed && !b.target.dead && !targets.includes(b.target) && b.owner === this.game.player) {
        targets.push(b.target);
        drawLockOn(R, b.target, planLook(b.plan).pal);
      }
      if (!this._inView(b, R)) continue;
      try {
        drawBody(R, b);
        drawn++;
      } catch (err) {
        this.warn(`draw ${b.kind}`, err);
      }
    }
    if (magic?.holds?.size) {
      for (const [caster, h] of magic.holds) {
        if (!caster || caster.removed || h.mode === 'tap' || !h.plan) continue;
        const L = planLook(h.plan);
        try {
          drawCharge(R, caster, h, L.pal, L.halo);
        } catch (err) {
          this.warn('charge', err);
        }
      }
    }
    this.effects.draw(R);
    this.parts.draw(ctx, ox, oy);
    this.parts.drawGlow(R.g, ox, oy, R.bounds);
    this.stats.bodies = list.length;
    this.stats.drawn = drawn;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    R.g.globalAlpha = 1;
    this._drawnFrame = this._frame;
  }

  drawStatuses(ctx, ox, oy, time, magic) {
    this._begin(ctx, ox, oy, time);
    try {
      this.statusFx.draw(this.R, magic);
    } catch (err) {
      this.warn('statuses', err);
    }
    ctx.globalAlpha = 1;
  }

  // Lights for every body (flickering by essence) and for burning or shocked actors.
  getLights(time, magic) {
    const out = this._lightOut;
    out.length = 0;
    const pool = this._lights;
    let n = 0;
    const cam = this.game.camera;
    const x0 = (cam?.x ?? -1e9) - 140;
    const y0 = (cam?.y ?? -1e9) - 140;
    const x1 = (cam?.x ?? 1e9) + (cam?.vw ?? 2e9) + 140;
    const y1 = (cam?.y ?? 1e9) + (cam?.vh ?? 2e9) + 140;
    const max = Math.round(MAX_FX_LIGHTS * (0.45 + 0.55 * this.q));
    const push = (x, y, r, color, intensity, flick = 0.15) => {
      if (n >= max || !(r > 1) || !(intensity > 0.02) || !(x > x0 && x < x1 && y > y0 && y < y1)) return;
      const l = pool[n++];
      l.x = x;
      l.y = y;
      l.r = r;
      l.color = color;
      l.intensity = intensity > 1 ? 1 : intensity;
      l.flicker = flick;
      l.glow = 0.85;
      out.push(l);
    };
    const list = magic?.bodies || [];
    for (let i = 0; i < list.length && n < max; i++) {
      const b = list[i];
      if (!b.active || b.delay > 0 || !b.plan) continue;
      const L = planLook(b.plan);
      const col = L.lightColor;
      const LR = (b.plan.light?.radius || 36) * L.lightK;
      const fl = L.flicker;
      // Storm light strobes; everything else breathes with its flicker amount.
      const strobe = L.leadId === 'storm' ? (hash(b.uid, Math.floor(time * 24)) > 0.35 ? 1 : 0.45) : 1;
      const k = Math.min(1, b.age / Math.max(0.01, b.life));
      switch (b.kind) {
        case 'projectile':
          if (b.mode === 'fall' && b.index % 3) break;
          push(b.x, b.y - b.z, Math.min(80, LR * (0.5 + b.r * 0.09)), col, (b.mode === 'orb' ? 0.85 : 0.72) * strobe, fl);
          break;
        case 'area':
          if (b.mode === 'patch') push(b.x, b.y - 2, b.r1 * 1.9, col, 0.34 * strobe, fl);
          else if (b.mode === 'rain') push(b.x, b.y, b.r1 * 1.4, col, 0.22, fl);
          else push(b.x, b.y - 4, Math.max(30, (b.cur || b.r1) * 1.6), col, 0.95 * (1 - k) * strobe, fl);
          break;
        case 'strike':
          push(b.x, b.y - 8, Math.max(28, b.cur * 1.5), col, 0.85 * (1 - k), fl);
          break;
        case 'beam': {
          const m = b.npts - 1;
          if (m < 1) break;
          for (let s = 0; s <= 2; s++) {
            const q = Math.min(m, Math.round((s / 2) * m));
            push(b.pts[q * 2], b.pts[q * 2 + 1] - 8, LR * (s === 2 ? 1.1 : 0.85), col, 0.75 * strobe, Math.max(0.25, fl));
          }
          break;
        }
        case 'summon':
          push(b.x, b.y - (b.z || 6) - 4, 34, col, 0.6, fl);
          break;
        case 'rune':
          push(b.x, b.y, 30, col, b.armed ? 0.32 + 0.12 * Math.sin(time * 5 + b.seed * 9) : 0.14, 0);
          break;
        case 'wall':
          push(b.ox, b.oy - 6, 32, col, 0.5 * strobe, fl);
          push(b.x2, b.y2 - 6, 32, col, 0.5 * strobe, fl);
          push(b.x, b.y - 6, 30, col, 0.4 * strobe, fl);
          break;
        case 'trail':
          push((b.x + b.x2) / 2, (b.y + b.y2) / 2 - 4, 36, col, 0.5 * (1 - k), fl);
          break;
        default:
          break;
      }
    }
    if (magic?.holds?.size) {
      for (const [c, h] of magic.holds) {
        if (!c || c.removed || h.mode === 'tap' || !h.plan) continue;
        const kk = h.mode === 'charge' ? Math.min(1, h.k) : 0.6;
        push(c.x, c.y - 10, 20 + 30 * kk, planLook(h.plan).lightColor, 0.3 + 0.5 * kk, 0.2);
      }
    }
    this.statusFx.lights(push, magic);
    return out;
  }

  // After the lighting (renderer hook): add the glow buffer, crisp, plus a soft bloom.
  drawGlow(ctx, r) {
    if (!this.glow || this.glow.stub || this._drawnFrame !== this._frame || this.bounds.empty) return;
    if (Number.isFinite(r?.frame) && r.frame !== this._frame) return;
    const W = this.glow.width;
    const H = this.glow.height;
    const x0 = Math.max(0, Math.floor(this.bounds.x0) - 8);
    const y0 = Math.max(0, Math.floor(this.bounds.y0) - 8);
    const x1 = Math.min(W, Math.ceil(this.bounds.x1) + 8);
    const y1 = Math.min(H, Math.ceil(this.bounds.y1) + 8);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    const s = r.scale || 1;
    const sx = r.subX || 0;
    const sy = r.subY || 0;
    const dark = this.game.lighting?.ambient?.darkness ?? 0;
    const prevOp = ctx.globalCompositeOperation;
    const crispA = Math.min(1, 0.4 + 0.42 * dark);
    // Bloom: the glow buffer halved twice with smoothing, then stretched back softly into
    // the glow buffer itself (all at world resolution, so it is cheap), and the sum is
    // added to the screen in one pass: crisp cores, soft halo, one full-size composite.
    const b1 = this.b1ctx;
    const b2 = this.b2ctx;
    let bx0 = x0;
    let by0 = y0;
    let bx1 = x1;
    let by1 = y1;
    if (b1 && b2) {
      const hx0 = Math.floor(x0 / 2);
      const hy0 = Math.floor(y0 / 2);
      const hw = Math.ceil(w / 2) + 1;
      const hh = Math.ceil(h / 2) + 1;
      b1.globalCompositeOperation = 'source-over';
      b1.globalAlpha = 1;
      b1.clearRect(hx0, hy0, hw, hh);
      b1.imageSmoothingEnabled = true;
      b1.drawImage(this.glow, hx0 * 2, hy0 * 2, hw * 2, hh * 2, hx0, hy0, hw, hh);
      const qx0 = Math.floor(hx0 / 2);
      const qy0 = Math.floor(hy0 / 2);
      const qw = Math.ceil(hw / 2) + 1;
      const qh = Math.ceil(hh / 2) + 1;
      b2.globalCompositeOperation = 'source-over';
      b2.globalAlpha = 1;
      b2.clearRect(qx0, qy0, qw, qh);
      b2.imageSmoothingEnabled = true;
      b2.drawImage(this.b1, qx0 * 2, qy0 * 2, qw * 2, qh * 2, qx0, qy0, qw, qh);
      const g = this.gctx;
      g.globalCompositeOperation = 'lighter';
      g.imageSmoothingEnabled = true;
      g.globalAlpha = Math.min(1, (0.28 + 0.42 * dark) / crispA);
      g.drawImage(this.b2, qx0, qy0, qw, qh, qx0 * 4 - 2, qy0 * 4 - 2, qw * 4 + 4, qh * 4 + 4);
      g.imageSmoothingEnabled = false;
      g.globalAlpha = 1;
      bx0 = Math.max(0, qx0 * 4 - 2);
      by0 = Math.max(0, qy0 * 4 - 2);
      bx1 = Math.min(W, qx0 * 4 + qw * 4 + 2);
      by1 = Math.min(H, qy0 * 4 + qh * 4 + 2);
      // (The next frame's _begin clears the whole glow buffer, bloom and all.)
    }
    const bw = bx1 - bx0;
    const bh = by1 - by0;
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = crispA;
    if (bw > 0 && bh > 0) ctx.drawImage(this.glow, bx0, by0, bw, bh, bx0 * s - sx, by0 * s - sy, bw * s, bh * s);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prevOp || 'source-over';
    ctx.imageSmoothingEnabled = false;
  }
}

// Make the game's Weave look and sound like itself (called once the game has a renderer).
export function installMagicFx(game, opts) {
  if (!game) return null;
  if (!game.magicFx) game.magicFx = new MagicFx(game, opts);
  return game.magicFx;
}
