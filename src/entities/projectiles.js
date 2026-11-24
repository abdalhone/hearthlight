import { Entity, factionRelation } from './entity.js';
import { TILE } from '../core/constants.js';

// Arrows and arcane bolts. Added to game.entities by Combat.shoot(); they fly at chest
// height (z) above a ground track (x, y) so depth sorting and shadows stay correct.
// They stop at walls (map.blocksProjectile and closed doors) and hit the first actor the
// owner may harm (combat.canHarm): never the owner, never the owner's allies unless the
// owner is the player.

const BOLT_COLOR = '#a995ff';
const BOLT_TRAIL = ['#ddd2ff', '#a995ff', '#7a64e0'];

// Sprite caches (built lazily in the browser; draw code never runs under node tests).
let boltFrames = null; // [canvas, canvas]
let boltGlow = null; // soft additive halo
const arrowCache = new Map(); // angle bucket -> canvas
const ARROW_BUCKETS = 32;

export class Projectile extends Entity {
  constructor(game, o = {}) {
    super(game, { ...o, solid: false, radius: 3 });
    this.type = 'projectile';
    this.kind = o.kind === 'arrow' ? 'arrow' : 'bolt';
    this.owner = o.owner || null;
    this.target = o.target || null;
    this.vx = o.vx ?? 0;
    this.vy = o.vy ?? 0;
    this.speed = Math.hypot(this.vx, this.vy) || 1;
    this.damage = o.damage ?? 4;
    this.z = o.z ?? 9;
    this.range = o.range ?? (this.kind === 'arrow' ? 300 : 260);
    this.traveled = 0;
    this.homing = this.kind === 'bolt' ? 2.6 : 0; // radians per second of steering
    this.state = 'fly'; // fly | stuck | spent
    this.stateT = 0;
    this.trailT = 0;
    this.angle = Math.atan2(this.vy, this.vx);
    this._tileX = -1;
    this._tileY = -1;
    this._light = { x: 0, y: 0, r: 40, color: BOLT_COLOR, intensity: 0.85, flicker: 0.25 };
    this._trailOpts = { count: 1, color: BOLT_TRAIL[0], speed: 8, life: 0.35 };
    this._wobble = 0;
  }

  get sortY() {
    return this.y;
  }

  // Not a creature: scans for targets or people (`e.isAlive() && ...`) skip it safely.
  isAlive() {
    return false;
  }

  update(dt) {
    super.update(dt);
    this.stateT += dt;
    if (this.state === 'fly') this._fly(dt);
    else if (this.state === 'stuck') {
      this._wobble = Math.max(0, this._wobble - dt);
      if (this.stateT > 1.6) this.game.entities.remove(this);
    } else if (this.stateT > 0.25) {
      this.game.entities.remove(this);
    }
  }

  _fly(dt) {
    this._steer(dt);
    const sx = this.vx * dt;
    const sy = this.vy * dt;
    // Sub-steps keep fast arrows from skipping past thin targets or wall corners.
    const steps = Math.max(1, Math.ceil(Math.hypot(sx, sy) / 4));
    for (let i = 0; i < steps; i++) {
      this.x += sx / steps;
      this.y += sy / steps;
      if (this._hitsWall()) {
        this._onWall();
        return;
      }
      const victim = this._findVictim();
      if (victim) {
        this._onHit(victim);
        return;
      }
    }
    this.traveled += Math.hypot(sx, sy);
    this.angle = Math.atan2(this.vy, this.vx);
    if (this.kind === 'bolt') {
      this.trailT -= dt;
      if (this.trailT <= 0) {
        this.trailT = 0.03;
        const o = this._trailOpts;
        o.color = BOLT_TRAIL[(Math.random() * BOLT_TRAIL.length) | 0];
        try {
          this.game.particles?.emit?.('sparkle', this.x, this.y - this.z, o);
        } catch {
          /* a broken particle system must not stop the bolt */
        }
      }
    }
    if (this.traveled >= this.range) this._fizzle();
  }

  // Bolts curve gently toward their chosen target.
  _steer(dt) {
    const t = this.target;
    if (!this.homing || !t || t.removed || t.dead || t.downed) return;
    const want = Math.atan2(t.y - this.y, t.x - this.x);
    const cur = Math.atan2(this.vy, this.vx);
    let d = want - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    // Never turn around: a bolt that overshoots keeps flying.
    if (Math.abs(d) > 1.6) return;
    const step = Math.max(-this.homing * dt, Math.min(this.homing * dt, d));
    const a = cur + step;
    this.vx = Math.cos(a) * this.speed;
    this.vy = Math.sin(a) * this.speed;
  }

  _hitsWall() {
    const tx = Math.floor(this.x / TILE);
    const ty = Math.floor(this.y / TILE);
    if (tx === this._tileX && ty === this._tileY) return false;
    this._tileX = tx;
    this._tileY = ty;
    const g = this.game;
    try {
      if (g.map?.blocksProjectile?.(tx, ty)) return true;
      const door = g.objects?.doorAt?.(tx, ty);
      if (door && !door.isOpen && !door.state?.open) return true;
    } catch {
      return false;
    }
    return false;
  }

  _findVictim() {
    const g = this.game;
    const list = g.entities?.all?.() || [];
    const owner = this.owner;
    const combat = g.combat;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === owner || e === this || e.type !== 'actor' || e.removed || !e.isAlive()) continue;
      const r = (e.radius ?? 5) + (this.kind === 'bolt' ? 4 : 3);
      const dx = e.x - this.x;
      const dy = e.y - this.y;
      if (dx > r || dx < -r || dy > r || dy < -r || dx * dx + dy * dy > r * r) continue;
      // Only the chosen target counts as chosen: a bolt meant for a wolf flies past
      // friends in the way (the player's own shots spare no one, like the sword).
      if (owner) {
        if (combat?.canHarm) {
          if (!combat.canHarm(owner, e, e === this.target)) continue;
        } else if (factionRelation(owner.faction, e.faction) === 'ally') continue;
      }
      return e;
    }
    return null;
  }

  _onHit(victim) {
    const g = this.game;
    const l = this.speed || 1;
    let dealt = 0;
    try {
      dealt =
        g.combat?.damage?.(this.owner, victim, this.damage, {
          kind: this.kind,
          knockback: this.kind === 'bolt' ? 80 : 60,
          dirX: this.vx / l,
          dirY: this.vy / l,
        }) || 0;
    } catch (err) {
      console.warn('[projectile] damage failed', err);
    }
    if (this.kind === 'bolt') this._burst(dealt > 0 ? 1 : 0.6);
    this.state = 'spent';
    this.stateT = 0;
    g.entities.remove(this);
  }

  _onWall() {
    const g = this.game;
    // Back out of the wall so the arrow sticks in its face, not inside it.
    const l = this.speed || 1;
    const bx = this.vx / l;
    const by = this.vy / l;
    const wx = Math.floor(this.x / TILE);
    const wy = Math.floor(this.y / TILE);
    for (let i = 0; i < 8 && Math.floor(this.x / TILE) === wx && Math.floor(this.y / TILE) === wy; i++) {
      this.x -= bx;
      this.y -= by;
    }
    this.x -= bx * 0.5;
    this.y -= by * 0.5;
    if (this.kind === 'arrow') {
      this.state = 'stuck';
      this.stateT = 0;
      this._wobble = 0.25;
      try {
        g.audio?.play?.('hit', { x: this.x, y: this.y, volume: 0.35, pitch: 1.5 });
        g.particles?.emit?.('dust', this.x, this.y - this.z, { count: 3, speed: 14, life: 0.3 });
      } catch {
        /* effects are optional */
      }
    } else {
      this._burst(0.7);
      g.entities.remove(this);
    }
  }

  _fizzle() {
    if (this.kind === 'bolt') {
      this._burst(0.4);
      this.game.entities.remove(this);
    } else {
      // Spent arrows drop to the ground and fade.
      this.state = 'stuck';
      this.stateT = 0.8;
      this.z = 1;
    }
  }

  _burst(strength) {
    const g = this.game;
    const x = this.x;
    const y = this.y - this.z;
    try {
      g.particles?.emit?.('spark', x, y, { count: Math.round(10 * strength), color: BOLT_COLOR, speed: 70 * strength, life: 0.4 });
      g.particles?.emit?.('magic', x, y, { count: Math.round(4 * strength), color: '#ddd2ff', speed: 30, life: 0.5 });
      g.lighting?.flash?.({ x, y, r: 26 + 30 * strength, color: BOLT_COLOR, intensity: 0.9, duration: 0.25 });
      if (strength < 1) g.audio?.play?.('bolt_hit', { x, y, volume: 0.5 * strength + 0.2 });
    } catch {
      /* effects are optional */
    }
  }

  getLight() {
    if (this.kind !== 'bolt' || this.state !== 'fly') return null;
    const L = this._light;
    L.x = this.x;
    L.y = this.y - this.z;
    return L;
  }

  draw(ctx, ox, oy, time) {
    const sx = Math.round(this.x - ox);
    const sy = Math.round(this.y - oy);
    const hz = Math.round(this.z);
    if (this.kind === 'bolt') this._drawBolt(ctx, sx, sy, hz, time);
    else this._drawArrow(ctx, sx, sy, hz);
  }

  _drawBolt(ctx, sx, sy, hz, time) {
    ctx.fillStyle = 'rgba(60, 40, 120, 0.28)';
    ctx.fillRect(sx - 2, sy - 1, 5, 2);
    const atlas = this.game.atlas;
    if (atlas?.has?.('fx:bolt')) {
      atlas.drawAnim(ctx, 'fx:bolt', time, sx, sy - hz);
      return;
    }
    ensureBoltSprites();
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(boltGlow, sx - 11, sy - hz - 11);
    ctx.globalCompositeOperation = prevOp;
    // A short comet tail behind the orb.
    if (this.state === 'fly') {
      const l = this.speed || 1;
      const tx = -this.vx / l;
      const ty = -this.vy / l;
      ctx.fillStyle = '#7a64e0';
      ctx.fillRect(Math.round(sx + tx * 4) - 1, Math.round(sy - hz + ty * 4) - 1, 2, 2);
      ctx.fillStyle = '#4f3db3';
      ctx.fillRect(Math.round(sx + tx * 7), Math.round(sy - hz + ty * 7), 1, 1);
    }
    const f = boltFrames[Math.floor(time * 12) & 1];
    ctx.drawImage(f, sx - 3, sy - hz - 3);
  }

  _drawArrow(ctx, sx, sy, hz) {
    if (this.state === 'stuck' && this.stateT > 1.1) {
      if (Math.floor(this.stateT * 16) % 2) return; // blink out
    }
    const bucket = (((Math.round((this.angle / (Math.PI * 2)) * ARROW_BUCKETS) % ARROW_BUCKETS) + ARROW_BUCKETS) % ARROW_BUCKETS);
    const img = arrowSprite(bucket);
    // A short wobble when it thunks into a wall.
    const wob = this._wobble > 0 ? Math.round(Math.sin(this._wobble * 80) * this._wobble * 4) : 0;
    if (this.state === 'fly') {
      ctx.fillStyle = 'rgba(16, 10, 28, 0.3)';
      ctx.fillRect(sx - 3, sy, 6, 1);
    }
    ctx.drawImage(img, sx - 7, sy - hz - 7 + wob);
  }
}

function ensureBoltSprites() {
  if (boltFrames) return;
  boltFrames = [];
  for (let f = 0; f < 2; f++) {
    const c = document.createElement('canvas');
    c.width = 7;
    c.height = 7;
    const x = c.getContext('2d');
    const r = f === 0 ? 3 : 2.6;
    for (let py = 0; py < 7; py++) {
      for (let px = 0; px < 7; px++) {
        const d = Math.hypot(px - 3, py - 3);
        if (d > r) continue;
        x.fillStyle = d < 1 ? '#ffffff' : d < 1.9 ? '#ddd2ff' : d < 2.6 ? '#a995ff' : '#7a64e0';
        x.fillRect(px, py, 1, 1);
      }
    }
    boltFrames.push(c);
  }
  boltGlow = document.createElement('canvas');
  boltGlow.width = 23;
  boltGlow.height = 23;
  const gx = boltGlow.getContext('2d');
  const grad = gx.createRadialGradient(11.5, 11.5, 0, 11.5, 11.5, 11.5);
  grad.addColorStop(0, 'rgba(169, 149, 255, 0.55)');
  grad.addColorStop(0.5, 'rgba(122, 100, 224, 0.22)');
  grad.addColorStop(1, 'rgba(79, 61, 179, 0)');
  gx.fillStyle = grad;
  gx.fillRect(0, 0, 23, 23);
}

// A crisp 15x15 arrow pointing along bucket's angle: iron head, wooden shaft, red fletching.
function arrowSprite(bucket) {
  let c = arrowCache.get(bucket);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = 15;
  c.height = 15;
  const x = c.getContext('2d');
  const a = (bucket / ARROW_BUCKETS) * Math.PI * 2;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const put = (t, off, color) => {
    const px = Math.round(7 + dx * t - dy * off);
    const py = Math.round(7 + dy * t + dx * off);
    x.fillStyle = color;
    x.fillRect(px, py, 1, 1);
  };
  for (let t = -5; t <= 3; t += 0.5) put(t, 0, t < -3 ? '#cfc3a8' : '#8c5a35');
  put(-5, 1, '#ab3a45');
  put(-5, -1, '#ab3a45');
  put(-4, 1, '#cc3a45');
  put(-4, -1, '#cc3a45');
  put(4, 0, '#cfd4dc');
  put(5, 0, '#f0eef5');
  put(3.5, 0.9, '#6b707e');
  put(3.5, -0.9, '#6b707e');
  arrowCache.set(bucket, c);
  return c;
}
