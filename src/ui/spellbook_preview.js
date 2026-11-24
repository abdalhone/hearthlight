// The Spellbook's live preview (DESIGN.md §22.4): the stranger casts the weave being
// made at a straw training dummy, over and over, so a change reads at once — fire turns
// the bolt orange, multishot fans it, split bursts it into three, chain arcs to a second
// dummy. A small faithful sim of the plan's numbers (shape, count, speed, size, twists,
// palette), not the game's runtime: it runs while the world is paused and never touches
// the real world. Drawn crisp: the scene at an integer pixel scale, numbers at full res.

import { drawCharacter } from '../art/characters_art.js';

const W = 200; // scene width in world px
const H = 84;
const GROUND = 64; // feet line
const CASTER_X = 30;
const CYCLE = 2.4; // seconds between casts
const MAX_BODIES = 60;
const MAX_FX = 90;

function rgba(hex, a) {
  const s = String(hex || '#ffffff').replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s.slice(0, 6);
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return `rgba(255,255,255,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// How the first essence's particles move (falls back to sparks).
const MOTION = { fire: 'rise', water: 'fall', frost: 'still', storm: 'jitter', earth: 'fall', wind: 'drift', nature: 'drift', poison: 'rise', light: 'twinkle', dark: 'shrink', iron: 'jitter', song: 'drift', raw: 'twinkle' };

export class WeavePreview {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.game = game;
    this.ctx = canvas.getContext('2d');
    this.plan = null;
    this.weave = null;
    this.palette = null;
    this.bodies = [];
    this.fx = [];
    this.nums = [];
    this.t = 0;
    this.castT = 0;
    this.queue = []; // { at, ghost } scheduled casts (volley, echo)
    this.dummies = [
      { x: 150, y: GROUND, hit: 0, wob: 0 },
      { x: 178, y: GROUND - 14, hit: 0, wob: 0, back: true },
    ];
    this.casterX = CASTER_X;
    this.dash = 0;
    this.charge = 0;
    this.running = false;
    this.raf = 0;
    this.last = 0;
  }

  set(weave, plan, palette) {
    this.weave = weave;
    this.plan = plan;
    this.palette = palette;
    this.bodies.length = 0;
    this.fx.length = 0;
    this.nums.length = 0;
    this.queue.length = 0;
    this.castT = CYCLE - 0.35; // cast again almost at once
    this.casterX = CASTER_X;
    this.dash = 0;
    this.layoutDummies();
  }

  has(t) {
    return !!this.weave?.twists?.includes(t);
  }

  // Short weaves get the dummy close; long ones far.
  layoutDummies() {
    const pv = this.plan?.aim || this.plan?.preview || {};
    const shape = this.weave?.shape;
    let reach = Number(pv.range) || Number(this.plan?.range) || 110;
    if (shape === 'nova') reach = (Number(pv.radius) || 40) * 0.9;
    if (shape === 'summon') reach = 90;
    if (shape === 'strike') reach = Math.max(26, reach);
    const x = clamp(CASTER_X + reach * 0.9, CASTER_X + 26, 156);
    this.dummies[0].x = x;
    this.dummies[1].x = Math.min(W - 12, x + 28);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = 0;
    const step = (ts) => {
      if (!this.running) return;
      const dt = this.last ? Math.min(0.05, (ts - this.last) / 1000) : 1 / 60;
      this.last = ts;
      try {
        this.update(dt);
        this.draw();
      } catch (err) {
        if (!this.warned) {
          this.warned = true;
          console.warn('[spellbook] preview failed', err);
        }
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // ---------- simulation ----------

  update(dt) {
    this.t += dt;
    for (const d of this.dummies) {
      d.hit = Math.max(0, d.hit - dt * 4);
      d.wob *= Math.pow(0.02, dt);
    }
    if (this.dash > 0) {
      this.dash -= dt;
      if (this.dash <= 0) this.casterX = CASTER_X;
    }
    if (!this.weave?.shape) return;
    this.castT += dt;
    if (this.castT >= CYCLE) {
      this.castT = 0;
      const charged = this.has('charge');
      const delay = charged ? 0.55 : 0;
      this.charge = charged ? 0.0001 : 0;
      this.queue.push({ at: this.t + delay, ghost: false });
      if (this.has('volley')) this.queue.push({ at: this.t + delay + 0.14, ghost: false }, { at: this.t + delay + 0.28, ghost: false });
      if (this.has('echo')) this.queue.push({ at: this.t + delay + 0.55, ghost: true });
    }
    if (this.charge > 0) this.charge = Math.min(1, this.charge + dt / 0.55);
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.t >= this.queue[i].at) {
        const q = this.queue[i];
        this.queue.splice(i, 1);
        this.cast(q.ghost);
        this.charge = 0;
      }
    }
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      b.age += dt;
      this.step(b, dt);
      if (b.dead || b.age > b.life) {
        if (!b.dead) this.end(b);
        this.bodies.splice(i, 1);
      }
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.age += dt;
      f.x += (f.vx || 0) * dt;
      f.y += (f.vy || 0) * dt;
      if (f.age > f.life) this.fx.splice(i, 1);
    }
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i];
      n.age += dt;
      n.y -= dt * 16;
      if (n.age > 0.9) this.nums.splice(i, 1);
    }
  }

  num(name, def) {
    const v = Number(this.plan?.[name]);
    return Number.isFinite(v) && v > 0 ? v : def;
  }

  body(o) {
    if (this.bodies.length >= MAX_BODIES) return null;
    const b = { kind: 'proj', x: 0, y: 0, vx: 0, vy: 0, r: 3, life: 2, age: 0, gen: 0, hits: 0, pierce: 0, bounce: 0, ghost: false, trail: 0, ...o };
    this.bodies.push(b);
    return b;
  }

  effect(o) {
    if (this.fx.length >= MAX_FX) this.fx.shift();
    this.fx.push({ age: 0, life: 0.4, ...o });
  }

  cast(ghost) {
    const shape = this.weave.shape;
    const d = this.dummies[0];
    const ox = this.casterX + 8;
    const oy = GROUND - 9;
    const tx = d.x;
    const ty = d.y - 10;
    const big = this.has('big') ? 1.6 : 1;
    const charged = this.has('charge') ? 1.35 : 1;
    const r = clamp((Number(this.plan?.radius) || 3) * 0.6, 2, 6) * big * charged;
    const swift = this.has('swift') ? 1.6 : 1;
    const speed = clamp(this.num('speed', 160), 70, 260) * swift;
    const count = Math.max(1, Math.min(7, Math.round(this.num('count', 1))));
    const ang = Math.atan2(ty - oy, tx - ox);
    const spread = 0.22;
    const base = { ghost, gen: 0, pierce: this.has('pierce') ? 3 : 0, bounce: this.has('bounce') ? 2 : 0 };
    this.casterPose = this.t;
    if (shape === 'bolt' || shape === 'orb' || shape === 'dash' || shape === 'beam' || !['blast', 'strike', 'throw', 'nova', 'summon', 'rune', 'rain', 'wall'].includes(shape)) {
      if (shape === 'beam') {
        this.body({ ...base, kind: 'beam', x: ox, y: oy, tx, ty, life: 1.1, r: r + 1, tick: 0 });
        return;
      }
      if (shape === 'dash') {
        const to = clamp(this.casterX + 46, CASTER_X, d.x - 16);
        this.body({ ...base, kind: 'trail', x: this.casterX + 4, y: GROUND - 6, x2: to + 4, life: 0.9, r: 3 * big });
        this.casterX = to;
        this.dash = 0.9;
        this.effect({ kind: 'ring', x: to + 4, y: GROUND - 8, r0: 2, r1: 12, life: 0.3 });
        return;
      }
      const orb = shape === 'orb';
      for (let i = 0; i < count; i++) {
        const a = ang + (i - (count - 1) / 2) * spread;
        const sp = orb ? speed * 0.45 : speed;
        const b = this.body({ ...base, kind: orb ? 'orb' : 'proj', x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: orb ? r * 2 : r, life: orb ? 2.2 : 1.5, pierce: orb ? 9 : base.pierce, sp });
        if (!b) continue;
        if (this.has('orbit')) b.orbit = 0.5;
        if (this.has('homing')) {
          b.vx = Math.cos(a - 0.9) * sp;
          b.vy = Math.sin(a - 0.9) * sp;
          b.homing = true;
        }
        if (this.has('spiral')) b.spiral = 1;
      }
      return;
    }
    if (shape === 'blast') {
      this.effect({ kind: 'cone', x: ox, y: oy, a: ang, r0: 4, r1: clamp(d.x - ox + 10, 30, 70) * big, arc: 0.6, life: 0.32 });
      this.later(0.12, () => this.hitDummy(0));
      return;
    }
    if (shape === 'strike') {
      this.effect({ kind: 'fist', x: ox + 6, y: oy, a: ang, life: 0.22 });
      this.later(0.08, () => {
        this.effect({ kind: 'ring', x: d.x, y: d.y - 10, r0: 3, r1: 16 * big, life: 0.3 });
        this.hitDummy(0);
      });
      return;
    }
    if (shape === 'throw') {
      for (let i = 0; i < count; i++) {
        const off = (i - (count - 1) / 2) * 10;
        this.body({ ...base, kind: 'lob', x: ox, y: oy, sx: ox, sy: oy, tx: tx + off, ty: d.y - 2, life: 0.75 / swift, r: r + 1 });
      }
      return;
    }
    if (shape === 'nova') {
      this.effect({ kind: 'ring', x: ox - 2, y: oy + 2, r0: 4, r1: clamp((d.x - ox) * 1.25, 24, 64) * big, life: 0.45, thick: 3 });
      this.later(0.2, () => this.hitDummy(0));
      return;
    }
    if (shape === 'summon') {
      this.body({ ...base, kind: 'pet', x: ox + 6, y: GROUND - 2, life: 2.1, r: 4 * big, bites: 0, next: 0.5 });
      this.effect({ kind: 'ring', x: ox + 6, y: GROUND - 4, r0: 2, r1: 12, life: 0.35 });
      return;
    }
    if (shape === 'rune') {
      this.body({ ...base, kind: 'rune', x: d.x, y: d.y - 1, life: 1.2, r: 7 * big });
      return;
    }
    if (shape === 'rain') {
      this.body({ ...base, kind: 'rain', x: d.x, y: d.y - 4, life: 1.1, r: 14 * big, next: 0 });
      return;
    }
    if (shape === 'wall') {
      this.body({ ...base, kind: 'wall', x: (ox + d.x) / 2 + 8, y: GROUND, life: 1.6, r: 18 * big });
    }
  }

  later(s, fn) {
    this.body({ kind: 'timer', life: s, fn, x: -99, y: -99 });
  }

  step(b, dt) {
    const d0 = this.dummies[0];
    if (b.kind === 'timer') return;
    if (b.kind === 'proj' || b.kind === 'orb' || b.kind === 'child') {
      if (b.orbit > 0) {
        b.orbit -= dt;
        const a = this.t * 12;
        b.x = this.casterX + 8 + Math.cos(a) * 12;
        b.y = GROUND - 12 + Math.sin(a) * 6;
        return;
      }
      if (b.homing) {
        const tx = (b.target || d0).x - b.x;
        const ty = (b.target || d0).y - 10 - b.y;
        const l = Math.hypot(tx, ty) || 1;
        const sp = b.sp || 150;
        b.vx += ((tx / l) * sp - b.vx) * Math.min(1, dt * 5);
        b.vy += ((ty / l) * sp - b.vy) * Math.min(1, dt * 5);
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.spiral) {
        const l = Math.hypot(b.vx, b.vy) || 1;
        const w = Math.sin(b.age * 18) * 1.2;
        b.x += (-b.vy / l) * w;
        b.y += (b.vx / l) * w;
      }
      b.trail += dt;
      if (b.trail > 0.03) {
        b.trail = 0;
        this.particle(b.x, b.y, b.ghost);
      }
      if (b.kind === 'orb' && Math.floor(b.age * 5) !== Math.floor((b.age - dt) * 5)) this.effect({ kind: 'ring', x: b.x, y: b.y, r0: b.r, r1: b.r + 8, life: 0.25 });
      for (let i = 0; i < this.dummies.length; i++) {
        const d = this.dummies[i];
        if (b.lastHit === d && b.age - (b.hitAt || 0) < 0.25) continue;
        if (Math.abs(b.x - d.x) < 5 + b.r && Math.abs(b.y - (d.y - 10)) < 10 + b.r) {
          b.lastHit = d;
          b.hitAt = b.age;
          this.hitDummy(i, b);
          this.onHit(b, d);
          if (b.dead) return;
        }
      }
      if (b.x > W + 10 || b.x < -10 || b.y < -10 || b.y > H + 10) b.dead = true;
      return;
    }
    if (b.kind === 'lob') {
      const f = Math.min(1, b.age / b.life);
      b.x = b.sx + (b.tx - b.sx) * f;
      b.y = b.sy + (b.ty - b.sy) * f - Math.sin(f * Math.PI) * 22;
      b.gx = b.x;
      b.gy = b.sy + (b.ty - b.sy) * f + 9;
      b.trail += dt;
      if (b.trail > 0.04) {
        b.trail = 0;
        this.particle(b.x, b.y, b.ghost);
      }
      return;
    }
    if (b.kind === 'beam') {
      b.tick += dt;
      if (b.tick > 0.22) {
        b.tick = 0;
        this.hitDummy(0, b, 0.35);
        if (this.has('chain')) this.chainTo(1, b.tx, b.ty);
      }
      return;
    }
    if (b.kind === 'pet') {
      const d = d0;
      const goal = d.x - 10;
      if (b.x < goal) b.x += dt * 60;
      b.hop = Math.abs(Math.sin(b.age * 12)) * 3;
      b.next -= dt;
      if (b.x >= goal && b.next <= 0 && b.bites < 3) {
        b.next = 0.45;
        b.bites++;
        this.effect({ kind: 'spark', x: d.x - 4, y: d.y - 8, life: 0.25 });
        this.hitDummy(0, b, 0.5);
      }
      return;
    }
    if (b.kind === 'rune') {
      if (!b.fired && b.age > 0.6) {
        b.fired = true;
        this.effect({ kind: 'ring', x: b.x, y: b.y - 4, r0: 4, r1: 20 * (this.has('big') ? 1.5 : 1), life: 0.4, thick: 3 });
        this.hitDummy(0, b);
        this.burstAt(b);
      }
      return;
    }
    if (b.kind === 'rain') {
      b.next -= dt;
      if (b.next <= 0 && b.age < b.life - 0.15) {
        b.next = 0.08;
        const x = b.x + (Math.random() - 0.5) * b.r * 2;
        this.effect({ kind: 'drop', x, y: 4, ty: b.y - Math.random() * 6, life: 0.22 });
        if (Math.random() < 0.35) this.hitDummy(0, b, 0.3);
      }
      return;
    }
    if (b.kind === 'wall' || b.kind === 'trail') {
      if (b.kind === 'trail' && Math.random() < 0.5) this.particle(b.x + Math.random() * (b.x2 - b.x), GROUND - 4 - Math.random() * 8, b.ghost);
    }
  }

  onHit(b, d) {
    if (this.has('leech') && !b.ghost) {
      this.effect({ kind: 'thread', x: d.x, y: d.y - 10, x2: this.casterX + 8, y2: GROUND - 10, life: 0.45 });
      this.nums.push({ x: this.casterX + 8, y: GROUND - 26, text: '+', heal: true, age: 0 });
    }
    if (this.has('chain') && b.gen < 1 && d === this.dummies[0]) this.chainTo(1, d.x, d.y - 10);
    if (this.has('split') && b.gen < 1) {
      for (let k = -1; k <= 1; k++) {
        const a = Math.atan2(b.vy, b.vx) + k * 0.7;
        this.body({ kind: 'child', x: b.x + 4, y: b.y, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120 - 20, r: Math.max(1.5, b.r * 0.6), life: 0.35, gen: b.gen + 1, ghost: b.ghost });
      }
      this.effect({ kind: 'ring', x: b.x, y: b.y, r0: 1, r1: 7, life: 0.2 });
    }
    if (this.has('burst')) this.burstAt(b);
    if (this.has('linger')) this.effect({ kind: 'patch', x: d.x, y: d.y + 1, life: 1.3, r: 12 });
    if (b.bounce > 0) {
      b.bounce--;
      b.vx = -Math.abs(b.vx) * 0.8;
      b.vy = -Math.abs(b.vy || 40) - 40;
      b.lastHit = d;
      return;
    }
    if (b.pierce > 0) {
      b.pierce--;
      return;
    }
    b.dead = true;
    this.effect({ kind: 'ring', x: b.x, y: b.y, r0: 1, r1: 6 + b.r, life: 0.22 });
    for (let i = 0; i < 4; i++) this.particle(b.x, b.y, b.ghost, true);
  }

  end(b) {
    if (b.kind === 'timer') {
      b.fn?.();
      return;
    }
    if (b.kind === 'lob') {
      const big = this.has('big') ? 1.5 : 1;
      this.effect({ kind: 'ring', x: b.tx, y: b.ty - 2, r0: 3, r1: 18 * big, life: 0.35, thick: 3 });
      if (Math.abs(b.tx - this.dummies[0].x) < 14) this.hitDummy(0, b);
      for (let i = 0; i < 6; i++) this.particle(b.tx, b.ty - 3, b.ghost, true);
      if (this.has('linger')) this.effect({ kind: 'patch', x: b.tx, y: b.ty, life: 1.3, r: 14 });
      if (this.has('split')) for (let k = -1; k <= 1; k++) this.effect({ kind: 'ring', x: b.tx + k * 12, y: b.ty - 2, r0: 1, r1: 7, life: 0.3 });
      return;
    }
    if ((b.kind === 'proj' || b.kind === 'orb') && this.has('burst')) this.burstAt(b);
  }

  burstAt(b) {
    this.effect({ kind: 'ring', x: b.x, y: b.y, r0: 2, r1: 15, life: 0.3, thick: 3 });
    for (let i = 0; i < 6; i++) this.particle(b.x, b.y, b.ghost, true);
  }

  chainTo(i, x, y) {
    const d = this.dummies[i];
    if (!d) return;
    this.effect({ kind: 'bolt', x, y, x2: d.x, y2: d.y - 10, life: 0.2 });
    this.hitDummy(i, null, 0.6);
  }

  hitDummy(i, b = null, share = 1) {
    const d = this.dummies[i];
    if (!d) return;
    d.hit = 1;
    d.wob = (d.wob || 0) + 1;
    const dmg = Math.max(1, Math.round((Number(this.plan?.dmg) || 6) * share * (b?.ghost ? 0.6 : 1)));
    this.nums.push({ x: d.x + (Math.random() - 0.5) * 8, y: d.y - 24, text: String(dmg), age: 0 });
  }

  particle(x, y, ghost, burst = false) {
    const pals = this.plan?.palettes?.length ? this.plan.palettes : null;
    const pal = pals ? pals[(Math.random() * pals.length) | 0] : this.palette;
    const ess = this.weave?.essences?.[0] || 'raw';
    const motion = MOTION[ess] || 'twinkle';
    const sp = burst ? 40 : 8;
    const a = Math.random() * Math.PI * 2;
    let vx = Math.cos(a) * sp * Math.random();
    let vy = Math.sin(a) * sp * Math.random();
    if (motion === 'rise') vy -= 18;
    else if (motion === 'fall') vy += 22;
    else if (motion === 'drift') vx -= 14;
    this.effect({ kind: 'dot', x, y, vx, vy, life: burst ? 0.4 : 0.32, color: pal?.core || this.palette?.core, glow: pal?.glow || this.palette?.glow, ghost, motion });
  }

  // ---------- drawing ----------

  draw() {
    const c = this.canvas;
    const ctx = this.ctx;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const cw = Math.max(1, Math.round((c.clientWidth || W * 2) * dpr));
    const ch = Math.max(1, Math.round((c.clientHeight || H * 2) * dpr));
    if (c.width !== cw) c.width = cw;
    if (c.height !== ch) c.height = ch;
    // Whole pixels when there is room; half steps on a small canvas so it still fills.
    const fit = Math.min(cw / W, ch / H);
    const s = fit >= 2 ? Math.floor(fit) : Math.max(1, Math.floor(fit * 2) / 2);
    const ox = Math.round((cw - W * s) / 2);
    const oy = Math.round((ch - H * s) / 2);
    this.span = Math.ceil(ox / s) + 2; // scene px beyond each side edge
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0e0d26';
    ctx.fillRect(0, 0, cw, ch);
    ctx.setTransform(s, 0, 0, s, ox, oy);
    this.drawGround(ctx);
    const pal = this.palette || { core: '#cdbcff', glow: '#8a6cff', spark: '#fff', deep: '#3d2a8a' };
    // Patches and runes lie on the ground, under everyone.
    for (const f of this.fx) if (f.kind === 'patch') this.drawFx(ctx, f, pal);
    for (const b of this.bodies) if (b.kind === 'rune' || b.kind === 'wall' || b.kind === 'trail') this.drawBody(ctx, b, pal);
    for (let i = this.dummies.length - 1; i >= 0; i--) this.drawDummy(ctx, this.dummies[i]);
    this.drawCaster(ctx, pal);
    for (const b of this.bodies) if (b.kind !== 'rune' && b.kind !== 'wall' && b.kind !== 'trail') this.drawBody(ctx, b, pal);
    for (const f of this.fx) if (f.kind !== 'patch') this.drawFx(ctx, f, pal);
    // Numbers at full resolution, so they stay sharp.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const fs = Math.max(10, Math.round(s * 4.2));
    ctx.font = `600 ${fs}px "Pixelify Sans", ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const n of this.nums) {
      const a = 1 - Math.max(0, (n.age - 0.55) / 0.35);
      const x = ox + n.x * s;
      const y = oy + n.y * s;
      ctx.globalAlpha = a;
      ctx.lineWidth = Math.max(2, s);
      ctx.strokeStyle = '#0b0915';
      ctx.strokeText(n.text, x, y);
      ctx.fillStyle = n.heal ? '#7dffb0' : pal.spark === '#ffffff' ? pal.core : pal.spark;
      ctx.fillText(n.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  drawGround(ctx) {
    const g = ctx.createLinearGradient(0, GROUND - 22, 0, H);
    g.addColorStop(0, '#1b2a3c');
    g.addColorStop(0.35, '#243f33');
    g.addColorStop(1, '#16281f');
    const e = this.span || 0;
    ctx.fillStyle = '#121433';
    ctx.fillRect(-e, -H, W + e * 2, GROUND - 14 + H);
    ctx.fillStyle = g;
    ctx.fillRect(-e, GROUND - 14, W + e * 2, H - GROUND + 14 + H);
    // Tufts and pebbles, fixed so the scene never flickers.
    ctx.fillStyle = '#2f5a41';
    for (let x = 6; x < W; x += 17) ctx.fillRect(x, GROUND + 4 + ((x * 7) % 9), 2, 1);
    ctx.fillStyle = '#3a6b4c';
    for (let x = 11; x < W; x += 23) ctx.fillRect(x, GROUND - 6 + ((x * 5) % 11), 1, 2);
    // A faint far treeline.
    ctx.fillStyle = '#18213d';
    for (let x = -e - (e % 9); x < W + e; x += 9) {
      const k = (((x * 13) % 7) + 7) % 7;
      ctx.fillRect(x, GROUND - 18 - k, 9, 6 + k);
    }
  }

  drawCaster(ctx, pal) {
    const atlas = this.game?.atlas;
    const x = Math.round(this.casterX + 4);
    const y = GROUND;
    // Soft shadow
    ctx.fillStyle = 'rgba(5,5,15,0.45)';
    ctx.fillRect(x - 6, y - 1, 12, 2);
    const casting = this.t - (this.casterPose || -9) < 0.35 || this.charge > 0;
    let ok = false;
    if (atlas) ok = drawCharacter(ctx, atlas, 'player', casting ? 'cast' : 'idle', 'right', this.t, x, y);
    if (!ok) {
      ctx.fillStyle = '#3b3f6e';
      ctx.fillRect(x - 4, y - 16, 8, 16);
      ctx.fillStyle = '#e8c6a0';
      ctx.fillRect(x - 3, y - 21, 6, 5);
    }
    if (this.charge > 0) {
      const r = 3 + this.charge * 7;
      ctx.fillStyle = rgba(pal.glow, 0.25 + this.charge * 0.3);
      ctx.beginPath();
      ctx.arc(x + 6, y - 10, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(pal.spark, 0.9);
      ctx.fillRect(x + 5, y - 11, 2, 2);
    }
  }

  drawDummy(ctx, d) {
    const x = Math.round(d.x);
    const y = d.y;
    const wob = Math.sin(this.t * 30) * Math.min(1.5, d.wob);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(5,5,15,0.45)';
    ctx.fillRect(-6, -1, 12, 2);
    ctx.rotate(wob * 0.06);
    const sc = d.back ? 0.8 : 1;
    ctx.scale(sc, sc);
    // Post
    ctx.fillStyle = '#4a2f1d';
    ctx.fillRect(-1, -14, 3, 14);
    // Arms
    ctx.fillStyle = '#6b4428';
    ctx.fillRect(-9, -18, 18, 2);
    ctx.fillStyle = '#d8b76a';
    ctx.fillRect(-11, -19, 3, 4);
    ctx.fillRect(8, -19, 3, 4);
    // Body: a sack with stitches
    ctx.fillStyle = '#1a1423';
    ctx.fillRect(-6, -23, 12, 13);
    ctx.fillStyle = '#c99d58';
    ctx.fillRect(-5, -22, 10, 11);
    ctx.fillStyle = '#e2c07a';
    ctx.fillRect(-5, -22, 4, 11);
    ctx.fillStyle = '#9a7238';
    ctx.fillRect(-1, -20, 1, 7);
    ctx.fillRect(-3, -16, 5, 1);
    // Head
    ctx.fillStyle = '#1a1423';
    ctx.fillRect(-4, -30, 8, 8);
    ctx.fillStyle = '#d9b36d';
    ctx.fillRect(-3, -29, 6, 6);
    ctx.fillStyle = '#5a3c1e';
    ctx.fillRect(-2, -27, 1, 1);
    ctx.fillRect(1, -27, 1, 1);
    if (d.hit > 0) {
      ctx.fillStyle = `rgba(255,255,255,${(d.hit * 0.7).toFixed(2)})`;
      ctx.fillRect(-6, -30, 12, 20);
    }
    ctx.restore();
  }

  drawBody(ctx, b, pal) {
    if (b.kind === 'timer') return;
    const ga = b.ghost ? 0.5 : 1;
    if (b.kind === 'proj' || b.kind === 'child' || b.kind === 'orb' || b.kind === 'lob') {
      if (b.kind === 'lob' && b.gx !== undefined) {
        ctx.fillStyle = 'rgba(5,5,15,0.35)';
        ctx.fillRect(Math.round(b.gx - 3), Math.round(b.gy), 6, 2);
      }
      const r = b.r;
      ctx.fillStyle = rgba(pal.glow, 0.35 * ga);
      ctx.beginPath();
      ctx.arc(b.x, b.y, r + 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(pal.core, ga);
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(pal.spark, ga);
      ctx.fillRect(Math.round(b.x - 1), Math.round(b.y - 1), 2, 2);
      if (this.has('swift') && b.kind !== 'lob') {
        ctx.strokeStyle = rgba(pal.glow, 0.5 * ga);
        ctx.lineWidth = Math.max(1, r);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - b.vx * 0.05, b.y - b.vy * 0.05);
        ctx.stroke();
      }
      return;
    }
    if (b.kind === 'beam') {
      const j = Math.sin(this.t * 60) * 0.6;
      const fade = Math.min(1, (b.life - b.age) / 0.15);
      ctx.strokeStyle = rgba(pal.glow, 0.45 * ga * fade);
      ctx.lineWidth = b.r * 2 + 3;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.tx, b.ty + j);
      ctx.stroke();
      ctx.strokeStyle = rgba(pal.core, ga * fade);
      ctx.lineWidth = Math.max(1.5, b.r);
      ctx.stroke();
      ctx.fillStyle = rgba(pal.spark, ga * fade);
      ctx.beginPath();
      ctx.arc(b.tx, b.ty + j, b.r + 1, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (b.kind === 'pet') {
      const y = b.y - (b.hop || 0);
      ctx.fillStyle = 'rgba(5,5,15,0.35)';
      ctx.fillRect(Math.round(b.x - 4), b.y, 8, 2);
      ctx.fillStyle = '#1a1423';
      ctx.fillRect(Math.round(b.x - 5), Math.round(y - 9), 10, 9);
      ctx.fillStyle = rgba(pal.core, 1);
      ctx.fillRect(Math.round(b.x - 4), Math.round(y - 8), 8, 7);
      ctx.fillStyle = rgba(pal.glow, 1);
      ctx.fillRect(Math.round(b.x - 4), Math.round(y - 3), 8, 2);
      ctx.fillStyle = '#1a1423';
      ctx.fillRect(Math.round(b.x + 1), Math.round(y - 6), 1, 2);
      ctx.fillRect(Math.round(b.x + 3), Math.round(y - 6), 1, 2);
      ctx.fillStyle = rgba(pal.spark, 1);
      ctx.fillRect(Math.round(b.x - 3), Math.round(y - 10), 2, 2);
      return;
    }
    if (b.kind === 'rune') {
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 10);
      const a = b.fired ? Math.max(0, 1 - (b.age - 0.6) / 0.5) : 0.6 + pulse * 0.4;
      ctx.strokeStyle = rgba(pal.core, a);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, b.r, b.r * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = rgba(pal.glow, a * 0.35);
      ctx.fill();
      ctx.fillStyle = rgba(pal.spark, a);
      ctx.fillRect(Math.round(b.x - 1), Math.round(b.y - 2), 2, 4);
      ctx.fillRect(Math.round(b.x - 3), Math.round(b.y - 1), 6, 2);
      return;
    }
    if (b.kind === 'rain') {
      ctx.fillStyle = rgba(pal.glow, 0.18);
      ctx.beginPath();
      ctx.ellipse(b.x, b.y + 2, b.r, b.r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (b.kind === 'wall') {
      const rise = Math.min(1, b.age / 0.2);
      const fade = Math.min(1, (b.life - b.age) / 0.3);
      const hgt = Math.round(14 * rise);
      for (let i = -2; i <= 2; i++) {
        const y = b.y - 3 + i * 4;
        ctx.fillStyle = rgba('#1a1423', fade);
        ctx.fillRect(Math.round(b.x - 3), y - hgt, 6, hgt);
        ctx.fillStyle = rgba(pal.core, fade);
        ctx.fillRect(Math.round(b.x - 2), y - hgt + 1, 4, hgt - 1);
        ctx.fillStyle = rgba(pal.spark, fade);
        ctx.fillRect(Math.round(b.x - 2), y - hgt + 1, 1, hgt - 1);
      }
      return;
    }
    if (b.kind === 'trail') {
      const fade = Math.max(0, 1 - b.age / b.life);
      ctx.strokeStyle = rgba(pal.glow, 0.5 * fade);
      ctx.lineWidth = b.r * 2;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x2, b.y);
      ctx.stroke();
      ctx.strokeStyle = rgba(pal.core, fade);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  drawFx(ctx, f, pal) {
    const k = 1 - f.age / f.life;
    if (k <= 0) return;
    if (f.kind === 'dot') {
      const a = f.ghost ? 0.5 * k : k;
      const sz = f.motion === 'shrink' ? Math.max(1, Math.round(2 * k)) : 2;
      ctx.fillStyle = rgba(f.color || pal.core, a);
      ctx.fillRect(Math.round(f.x), Math.round(f.y), sz, sz);
      if (f.motion === 'twinkle' && k > 0.5) {
        ctx.fillStyle = rgba(pal.spark, a * 0.7);
        ctx.fillRect(Math.round(f.x) - 1, Math.round(f.y), 1, 1);
      }
      return;
    }
    if (f.kind === 'ring') {
      const r = f.r0 + (f.r1 - f.r0) * (1 - k * k);
      ctx.strokeStyle = rgba(pal.core, k);
      ctx.lineWidth = f.thick || 2;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = rgba(pal.glow, k * 0.5);
      ctx.lineWidth = (f.thick || 2) + 2;
      ctx.stroke();
      return;
    }
    if (f.kind === 'cone') {
      const r = f.r0 + (f.r1 - f.r0) * (1 - k);
      ctx.fillStyle = rgba(pal.glow, 0.45 * k);
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      ctx.arc(f.x, f.y, r, f.a - f.arc, f.a + f.arc);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgba(pal.core, k);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, f.a - f.arc, f.a + f.arc);
      ctx.stroke();
      return;
    }
    if (f.kind === 'fist') {
      const x = f.x + (1 - k) * 10;
      ctx.fillStyle = '#1a1423';
      ctx.fillRect(Math.round(x - 4), Math.round(f.y - 4), 9, 8);
      ctx.fillStyle = rgba(pal.core, 1);
      ctx.fillRect(Math.round(x - 3), Math.round(f.y - 3), 7, 6);
      ctx.fillStyle = rgba(pal.spark, 1);
      ctx.fillRect(Math.round(x + 2), Math.round(f.y - 3), 2, 6);
      return;
    }
    if (f.kind === 'drop') {
      const y = f.y + (f.ty - f.y) * (1 - k);
      ctx.fillStyle = rgba(pal.core, 0.9);
      ctx.fillRect(Math.round(f.x), Math.round(y - 5), 1, 5);
      ctx.fillStyle = rgba(pal.spark, 0.9);
      ctx.fillRect(Math.round(f.x), Math.round(y), 1, 1);
      if (k < 0.25) {
        ctx.strokeStyle = rgba(pal.glow, 0.8);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(f.x, f.ty, 3, 1.2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      return;
    }
    if (f.kind === 'bolt' || f.kind === 'thread') {
      ctx.strokeStyle = f.kind === 'thread' ? `rgba(125,255,176,${k})` : rgba(pal.spark, k);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      const n = 5;
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const j = f.kind === 'bolt' ? (Math.random() - 0.5) * 6 : Math.sin(t * Math.PI) * -6;
        ctx.lineTo(f.x + (f.x2 - f.x) * t, f.y + (f.y2 - f.y) * t + j);
      }
      ctx.lineTo(f.x2, f.y2);
      ctx.stroke();
      return;
    }
    if (f.kind === 'patch') {
      ctx.fillStyle = rgba(pal.glow, 0.32 * Math.min(1, k * 2));
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, f.r, f.r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(pal.core, 0.5 * Math.min(1, k * 2));
      ctx.fillRect(Math.round(f.x - f.r * 0.4), Math.round(f.y - 1), 2, 1);
      ctx.fillRect(Math.round(f.x + f.r * 0.3), Math.round(f.y), 2, 1);
      return;
    }
    if (f.kind === 'spark') {
      ctx.fillStyle = rgba(pal.spark, k);
      ctx.fillRect(Math.round(f.x - 3), Math.round(f.y), 7, 1);
      ctx.fillRect(Math.round(f.x), Math.round(f.y - 3), 1, 7);
    }
  }
}
