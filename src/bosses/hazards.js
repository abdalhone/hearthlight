// What bosses leave in the world: burning ground, poison puddles, arcing globs, bubbles,
// rolling waves, shock rings and delayed eruptions. Each is a light entity (not an actor)
// that draws its own ground decal, glows, and hurts whoever is hostile to its owner.
// Every harmful thing announces itself first (`delay` draws its marker before it bites).

import { Entity } from '../entities/entity.js';
import { alive, hostileTo } from '../entities/creature_util.js';
import { drawMarker, strike, inShape, particles, sound, shake } from './kit.js';

const PAL = {
  fire: { core: '#ffe08a', mid: '#ff8a3d', deep: '#86301b', light: '#ff9a4a' },
  poison: { core: '#e8ff9a', mid: '#9ee05a', deep: '#4a2a5e', light: '#b6ff6a' },
  water: { core: '#e8faff', mid: '#6fc8ff', deep: '#1d3a63', light: '#7fd2ff' },
  grave: { core: '#e0f0ff', mid: '#7fb2ff', deep: '#1c2a5a', light: '#8ab8ff' },
  stone: { core: '#d6ad7c', mid: '#9a7049', deep: '#3b2a24', light: '#ffd9a0' },
};

let seq = 1;

export class Hazard extends Entity {
  // o: { kind, owner, x, y, r, life, delay, mul, tick, knockback, launch, palette,
  //      vx, vy, z, vz, target, len, w, angle, speed, push, onLand, r0, r1 }
  constructor(game, o = {}) {
    super(game, { id: `hz${seq++}`, x: o.x, y: o.y, solid: false, radius: o.r ?? 10 });
    this.type = 'hazard';
    this.kind = o.kind || 'patch';
    this.owner = o.owner || null;
    this.r = o.r ?? 12;
    this.life = o.life ?? 3;
    this.delay = o.delay ?? 0;
    this.mul = o.mul ?? 0.4;
    this.tick = o.tick ?? 0.6;
    this.knockback = o.knockback ?? 40;
    this.launch = o.launch ?? 0;
    this.pal = PAL[o.palette] || PAL[o.kind] || PAL.fire;
    this.palette = o.palette || 'fire';
    this.vx = o.vx ?? 0;
    this.vy = o.vy ?? 0;
    this.z = o.z ?? 0;
    this.vz = o.vz ?? 0;
    this.target = o.target || null;
    this.len = o.len ?? 80;
    this.w = o.w ?? 18;
    this.angle = o.angle ?? 0;
    this.speed = o.speed ?? 0;
    this.push = o.push ?? 0;
    this.onLand = o.onLand || null;
    this.r0 = o.r0 ?? 4;
    this.r1 = o.r1 ?? 80;
    this.hitAt = new Map(); // actor -> time of last hit
    this.hitOnce = new Set();
    this.t = 0;
    this.done = false;
    this.seed = (seq * 7919) % 1000;
    this.marker = this.delay > 0 ? { kind: o.markKind || 'circle', x: this.x, y: this.y, r: this.r, angle: this.angle, len: this.len, w: this.w, t: 0, dur: this.delay, color: o.markColor || '#ff6b5e', edge: '#ffd0a0' } : null;
  }

  get sortY() {
    return this.y + (this.kind === 'glob' || this.kind === 'bubble' ? 0 : -40);
  }

  isAlive() {
    return false;
  }

  canInteract() {
    return false;
  }

  end() {
    if (this.done) return;
    this.done = true;
    this.game.entities?.remove?.(this);
  }

  update(dt) {
    super.update(dt);
    this.t += dt;
    if (this.owner && (this.owner.removed || this.owner.mode === 'reset')) return this.end();
    if (this.delay > 0) {
      if (this.marker) this.marker.t = this.t;
      if (this.t < this.delay) return;
      this.t -= this.delay;
      this.delay = 0;
      this.marker = null;
      this.erupt();
      if (this.done) return;
    }
    switch (this.kind) {
      case 'glob':
        return this.updateGlob(dt);
      case 'bubble':
        return this.updateBubble(dt);
      case 'wave':
        return this.updateWave(dt);
      case 'ring':
        return this.updateRing(dt);
      default:
        return this.updatePatch(dt);
    }
  }

  // ------------------------------------------------------------ kinds

  // A one-off blow when the marker fills (eruptions, geysers, bones clawing up).
  erupt() {
    if (this.kind !== 'eruption') return;
    this.hitArea({ kind: 'circle', x: this.x, y: this.y, r: this.r }, true);
    const c = this.pal;
    particles(this, this.palette === 'water' ? 'splash' : this.palette === 'grave' ? 'magic' : 'spark', this.x, this.y - 4, { count: 14, color: c.mid, speed: 60, life: 0.5 });
    particles(this, 'dust', this.x, this.y, { count: 6, speed: 30, life: 0.5 });
    sound(this, this.palette === 'water' ? 'boss_splash' : this.palette === 'grave' ? 'boss_grave' : 'boss_burst', { volume: 0.7 });
    shake(this, 1.6, 0.15);
    this.life = Math.min(this.life, 0.35);
    this.kind = 'flash';
    try {
      this.onLand?.(this);
    } catch {
      /* what an eruption leaves is optional */
    }
  }

  updatePatch(dt) {
    if (this.t >= this.life) return this.end();
    if (this.kind === 'flash') return;
    // Patches bite on a tick while you stand in them.
    if (this.t > 0.25) this.hitArea({ kind: 'circle', x: this.x, y: this.y, r: this.r * this.grow() }, false);
    if (this.kind === 'fire' && Math.random() < dt * 6) particles(this, 'ember', this.x + (Math.random() - 0.5) * this.r * 1.4, this.y - 2, { count: 1 });
    if (this.kind === 'poison' && Math.random() < dt * 3) particles(this, 'smoke', this.x + (Math.random() - 0.5) * this.r, this.y - 2, { count: 1, color: '#9ee05a' });
  }

  grow() {
    return Math.min(1, 0.4 + this.t * 3) * (this.t > this.life - 0.4 ? Math.max(0.2, (this.life - this.t) / 0.4) : 1);
  }

  // Lobbed: flies in an arc to its landing point, then becomes what it carries.
  updateGlob(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vz -= 300 * dt;
    this.z += this.vz * dt;
    if (this.marker) this.marker.t = this.t;
    if (this.z <= 0 && this.t > 0.1) {
      this.z = 0;
      this.hitArea({ kind: 'circle', x: this.x, y: this.y, r: this.r }, true);
      particles(this, 'splash', this.x, this.y - 2, { count: 10, color: this.pal.mid, speed: 40, life: 0.45 });
      sound(this, 'boss_glob', { volume: 0.5 });
      try {
        this.onLand?.(this);
      } catch {
        /* a puddle that fails to form is not a crash */
      }
      this.end();
    }
  }

  // Drifts toward its target, wobbling; pops on contact or when its life runs out.
  updateBubble(dt) {
    if (this.t >= this.life) {
      particles(this, 'splash', this.x, this.y - this.z, { count: 6, color: this.pal.core, speed: 25, life: 0.35 });
      return this.end();
    }
    const t = this.target;
    if (t && alive(t)) {
      const dx = t.x - this.x;
      const dy = t.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      const turn = Math.min(1, dt * 1.4);
      this.vx += ((dx / d) * this.speed - this.vx) * turn;
      this.vy += ((dy / d) * this.speed - this.vy) * turn;
    }
    this.x += this.vx * dt + Math.sin(this.t * 6 + this.seed) * 10 * dt;
    this.y += this.vy * dt;
    this.z = 6 + Math.sin(this.t * 4 + this.seed) * 2;
    if (this.hitArea({ kind: 'circle', x: this.x, y: this.y, r: this.r }, true) > 0) {
      particles(this, 'splash', this.x, this.y - this.z, { count: 12, color: this.pal.mid, speed: 45, life: 0.4 });
      sound(this, 'boss_pop', { volume: 0.6 });
      this.end();
    }
  }

  // A band rolling across the ground; pushes and hurts once each.
  updateWave(dt) {
    if (this.t >= this.life) return this.end();
    const ux = Math.cos(this.angle);
    const uy = Math.sin(this.angle);
    this.x += ux * this.speed * dt;
    this.y += uy * this.speed * dt;
    // The band is a short wide line across the direction of travel.
    const shape = { kind: 'line', x: this.x - uy * (this.len / 2), y: this.y + ux * (this.len / 2), angle: this.angle - Math.PI / 2, len: this.len, w: this.w };
    this.hitArea(shape, true, { x: ux, y: uy });
    if (Math.random() < dt * 20) particles(this, 'splash', this.x + (Math.random() - 0.5) * this.len * -uy, this.y + (Math.random() - 0.5) * this.len * ux, { count: 2, color: this.pal.core, speed: 30, life: 0.4 });
  }

  // A shock ring growing from r0 to r1: it hits as its edge passes you.
  updateRing(dt) {
    const k = Math.min(1, this.t / this.life);
    const r = this.r0 + (this.r1 - this.r0) * k;
    this.r = r;
    const g = this.game;
    const list = g.entities?.all?.() || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.type !== 'actor' || e === this.owner || e.removed || !alive(e) || this.hitOnce.has(e)) continue;
      if (!this.owner || !hostileTo(g, this.owner, e)) continue;
      const d = Math.hypot(e.x - this.x, e.y - this.y);
      if (Math.abs(d - r) > 7 + (e.radius ?? 5) * 0.5) continue;
      this.hitOnce.add(e);
      strike(this.owner, e, { mul: this.mul, kind: 'magic', knockback: this.knockback, launch: this.launch }, { x: this.x, y: this.y });
    }
    if (k >= 1) this.end();
  }

  // Hit everyone hostile to the owner inside a shape: once (single) or every tick.
  hitArea(shape, single, push = null) {
    const g = this.game;
    const owner = this.owner;
    if (!owner) return 0;
    const now = this.t;
    let hits = 0;
    const list = g.entities?.all?.() || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.type !== 'actor' || e === owner || e.removed || !alive(e)) continue;
      if (!hostileTo(g, owner, e)) continue;
      if (single) {
        if (this.hitOnce.has(e)) continue;
      } else if (now - (this.hitAt.get(e) ?? -99) < this.tick) continue;
      if (!inShape(shape, e)) continue;
      if (single) this.hitOnce.add(e);
      else this.hitAt.set(e, now);
      const dealt = strike(owner, e, { mul: this.mul, kind: 'magic', knockback: this.knockback + this.push, launch: this.launch, push: push || undefined }, shape.kind === 'line' ? null : shape);
      if (dealt > 0) hits++;
      if (this.push && push && e.knock) {
        e.knock.x += push.x * this.push * 0.6;
        e.knock.y += push.y * this.push * 0.6;
      }
    }
    return hits;
  }

  // ------------------------------------------------------------ drawing

  drawShadow(ctx, ox, oy, time) {
    if (this.marker) drawMarker(ctx, this.marker, ox, oy, time);
    const c = this.pal;
    const x = Math.round(this.x - ox);
    const y = Math.round(this.y - oy);
    switch (this.kind) {
      case 'fire':
      case 'poison':
      case 'patch': {
        if (this.delay > 0) return;
        const r = this.r * this.grow();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = c.deep;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.55 + 0.15 * Math.sin(time * 9 + this.seed);
        ctx.fillStyle = c.mid;
        ctx.beginPath();
        ctx.ellipse(x, y, r * 0.75, r * 0.58, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = c.core;
        for (let k = 0; k < 4; k++) {
          const a = time * (this.kind === 'fire' ? 3 : 1.2) + k * 1.7 + this.seed;
          ctx.fillRect(Math.round(x + Math.cos(a) * r * 0.45), Math.round(y + Math.sin(a * 1.3) * r * 0.32), 1 + (k & 1), 1);
        }
        ctx.globalAlpha = 1;
        return;
      }
      case 'flash': {
        const k = Math.max(0, 1 - this.t / 0.35);
        ctx.globalAlpha = 0.5 * k;
        ctx.fillStyle = c.core;
        ctx.beginPath();
        ctx.arc(x, y, this.r * (1 + 0.3 * (1 - k)), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }
      case 'glob':
      case 'bubble': {
        const s = Math.max(2, this.r * 0.5 - this.z / 12);
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#100a1c';
        ctx.beginPath();
        ctx.ellipse(x, y, s, s * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }
      case 'wave': {
        const ux = Math.cos(this.angle);
        const uy = Math.sin(this.angle);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(this.angle);
        const fade = Math.min(1, (this.life - this.t) * 3);
        ctx.globalAlpha = 0.35 * fade;
        ctx.fillStyle = c.deep;
        ctx.fillRect(-this.w / 2 - 6, -this.len / 2, this.w + 6, this.len);
        ctx.globalAlpha = 0.6 * fade;
        ctx.fillStyle = c.mid;
        ctx.fillRect(-this.w / 2, -this.len / 2, this.w, this.len);
        ctx.globalAlpha = 0.85 * fade;
        ctx.fillStyle = c.core;
        for (let v = -this.len / 2; v < this.len / 2; v += 3) {
          const crest = Math.round(this.w / 2 - 2 + Math.sin(v * 0.4 + time * 10) * 1.5);
          ctx.fillRect(crest, Math.round(v), 2, 2);
        }
        ctx.restore();
        ctx.globalAlpha = 1;
        void ux;
        void uy;
        return;
      }
      case 'ring': {
        ctx.globalAlpha = 0.75 * (1 - Math.min(1, this.t / this.life) * 0.5);
        ctx.strokeStyle = c.core;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, this.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = c.mid;
        ctx.lineWidth = 3;
        ctx.globalAlpha *= 0.6;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, this.r - 3), 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.globalAlpha = 1;
        return;
      }
      default:
        return;
    }
  }

  draw(ctx, ox, oy, time) {
    if (this.kind !== 'glob' && this.kind !== 'bubble') return;
    const c = this.pal;
    const x = Math.round(this.x - ox);
    const y = Math.round(this.y - oy - this.z);
    const r = Math.max(2, Math.round(this.kind === 'glob' ? this.r * 0.32 : this.r * 0.55));
    ctx.fillStyle = '#1a1423';
    ctx.beginPath();
    ctx.arc(x, y, r + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = this.kind === 'bubble' ? 0.75 : 1;
    ctx.fillStyle = c.mid;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.core;
    ctx.fillRect(x - Math.ceil(r / 2), y - Math.ceil(r / 2), Math.max(1, r - 2), 1);
    ctx.fillRect(x - Math.ceil(r / 2), y - Math.ceil(r / 2), 1, Math.max(1, r - 2));
    ctx.globalAlpha = 1;
    void time;
  }

  getLight() {
    if (this.done) return null;
    const c = this.pal;
    if (this.delay > 0) return null;
    const r = this.kind === 'ring' ? this.r + 10 : this.kind === 'wave' ? this.len * 0.6 : this.r * 2.2 + 8;
    const intensity = this.kind === 'poison' ? 0.35 : this.kind === 'fire' ? 0.7 : 0.55;
    if (!this._light) this._light = { x: 0, y: 0, r, color: c.light, intensity, flicker: this.kind === 'fire' ? 0.25 : 0.08 };
    const L = this._light;
    L.x = this.x;
    L.y = this.y - 4 - this.z;
    L.r = r;
    return L;
  }
}

export function spawnHazard(game, o) {
  if (!game?.entities?.add) return null;
  return game.entities.add(new Hazard(game, o));
}

// Remove every hazard a boss left behind.
export function clearHazards(game, owner) {
  const list = game.entities?.all?.() || [];
  for (const e of list) if (e.type === 'hazard' && (!owner || e.owner === owner)) e.end?.();
}
