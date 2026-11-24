import { Entity } from './entity.js';
import { itemDef } from './items.js';

// Items lying on the ground: loot, harvest, things dropped from the inventory.
// They pop out with a little bounce, glint now and then, drift to the player when
// close (magnet) and are collected on touch. Lyra collects them with pickup.collect(lyra).

export const MAGNET_RADIUS = 24;
const COLLECT_RADIUS = 7;
const LIFETIME = 300; // 5 minutes
const GRAVITY = 420;
const GLOWING = { crystal: '#a995ff', moonpetal: '#ddd2ff', lantern: '#ffb047' };

export class Pickup extends Entity {
  constructor(game, o = {}) {
    super(game, { ...o, solid: false, radius: 4 });
    this.type = 'pickup';
    this.itemId = o.itemId;
    this.qty = Math.max(1, Math.floor(o.qty ?? 1));
    const pop = o.pop !== false;
    const ang = Math.random() * Math.PI * 2;
    const spd = pop ? 10 + Math.random() * 14 : 0; // gentle: loot stays within reach
    this.vx = Math.cos(ang) * spd;
    this.vy = Math.sin(ang) * spd * 0.6;
    this.z = o.z ?? (pop ? 4 : 0);
    this.vz = pop ? 70 + Math.random() * 30 : 0;
    this.collectDelay = o.collectDelay ?? (pop ? 0.4 : 0.15);
    this.lifetime = o.lifetime ?? LIFETIME;
    this.collected = false;
    this.magnet = false;
    this.glintOffset = (hashString(String(this.id)) % 100) / 40;
    const glow = GLOWING[this.itemId];
    this._light = glow ? { x: 0, y: 0, r: 22, color: glow, intensity: 0.55, flicker: 0.1 } : null;
  }

  get sortY() {
    return this.y;
  }

  // Display name ("2 × Wood"). Deliberately not `name`, so chat lookups by name
  // ("Bram", "the wolf") never resolve to a log lying on the ground.
  get label() {
    const n = itemDef(this.itemId)?.name || String(this.itemId);
    return this.qty > 1 ? `${this.qty} × ${n}` : n;
  }

  canInteract() {
    return false;
  }

  // Not a creature: scans for targets or people (`e.isAlive() && ...`) skip it safely.
  isAlive() {
    return false;
  }

  update(dt) {
    super.update(dt);
    if (this.collected) return;
    if (this.age >= this.lifetime) {
      this.game.entities.remove(this);
      return;
    }
    if (!this._pullTowardPlayer(dt)) this._bounce(dt);
  }

  _bounce(dt) {
    if (this.vz !== 0 || this.z > 0) {
      this.vz -= GRAVITY * dt;
      this.z += this.vz * dt;
      if (this.z <= 0) {
        this.z = 0;
        // Each bounce keeps less height; tiny hops stop.
        this.vz = this.vz < -40 ? -this.vz * 0.42 : 0;
        this.vx *= 0.6;
        this.vy *= 0.6;
      }
    }
    if (this.vx || this.vy) {
      const nx = this.x + this.vx * dt;
      const ny = this.y + this.vy * dt;
      if (this._blocked(nx, ny)) {
        this.vx = 0;
        this.vy = 0;
      } else {
        this.x = nx;
        this.y = ny;
      }
      if (this.z === 0) {
        const f = Math.pow(0.02, dt);
        this.vx *= f;
        this.vy *= f;
      }
      if (Math.abs(this.vx) < 0.5 && Math.abs(this.vy) < 0.5) this.vx = this.vy = 0;
    }
  }

  _blocked(x, y) {
    try {
      return !!this.game.isBlockedTile?.(Math.floor(x / 16), Math.floor(y / 16), null);
    } catch {
      return false;
    }
  }

  // Returns true while being pulled in by the player.
  _pullTowardPlayer(dt) {
    const p = this.game.player;
    if (!p || p.removed || !p.isAlive?.() || this.age < this.collectDelay) return false;
    const dx = p.x - this.x;
    const dy = p.y - 3 - this.y;
    const d = Math.hypot(dx, dy);
    if (d > MAGNET_RADIUS && !this.magnet) return false;
    if (d > MAGNET_RADIUS * 2) {
      this.magnet = false;
      return false;
    }
    this.magnet = true;
    if (d <= COLLECT_RADIUS) {
      this.collect(p);
      return true;
    }
    const speed = 70 + (MAGNET_RADIUS - Math.min(d, MAGNET_RADIUS)) * 9;
    const step = Math.min(d, speed * dt);
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
    this.z = Math.max(0, this.z - 30 * dt);
    return true;
  }

  // Put the item into actor's inventory. Returns true when collected.
  collect(actor) {
    const g = this.game;
    if (this.collected || this.removed || !actor?.inventory || !this.itemId) return false;
    this.collected = true;
    actor.inventory.add(this.itemId, this.qty);
    g.entities?.remove?.(this);
    g.bus?.emit('item_gained', { actor, itemId: this.itemId, qty: this.qty, from: 'pickup' });
    try {
      g.audio?.play?.(this.itemId === 'coin' ? 'coin' : 'pickup', { x: this.x, y: this.y, volume: 0.8 });
      g.particles?.emit?.('sparkle', this.x, this.y - 6, { count: 4, color: '#ffe27a', speed: 18, life: 0.4 });
    } catch {
      /* effects are optional */
    }
    if (actor === g.player) notePickupToast(g, this.itemId, this.qty);
    return true;
  }

  getLight() {
    const L = this._light;
    if (!L || this.collected) return null;
    L.x = this.x;
    L.y = this.y - 6 - this.z;
    return L;
  }

  draw(ctx, ox, oy, time) {
    if (this.collected) return;
    // Blink during the last ten seconds before it disappears.
    const left = this.lifetime - this.age;
    if (left < 10 && Math.floor(left * 6) % 2 === 0) return;
    const sx = Math.round(this.x - ox);
    const sy = Math.round(this.y - oy);
    const resting = this.z <= 0 && this.vz === 0 && !this.magnet;
    const bob = resting ? Math.round(Math.sin(time * 3 + this.glintOffset * 2) + 1) * 0.5 : 0;
    const hz = Math.round(this.z + bob);
    const w = Math.max(2, 5 - Math.round(this.z / 6));
    ctx.fillStyle = 'rgba(16, 10, 28, 0.32)';
    ctx.fillRect(sx - w, sy - 1, w * 2, 2);
    ctx.fillRect(sx - w + 1, sy - 2, w * 2 - 2, 1);

    const atlas = this.game.atlas;
    const name = atlas?.has?.(`icon:${this.itemId}`) ? `icon:${this.itemId}` : 'icon:unknown';
    let drawn = false;
    if (atlas?.has?.(name)) {
      if (this.itemId === 'coin' && this.qty >= 3) atlas.draw(ctx, name, 0, sx + 3, sy - hz - 2);
      drawn = atlas.draw(ctx, name, 0, sx, sy - hz);
    }
    if (!drawn) {
      ctx.fillStyle = '#e4b83d';
      ctx.fillRect(sx - 3, sy - hz - 7, 6, 6);
    }
    this._drawGlint(ctx, sx, sy - hz, time);
  }

  // A small four-point sparkle every couple of seconds so loot catches the eye.
  _drawGlint(ctx, x, y, time) {
    const period = 2.4;
    const t = (time + this.glintOffset) % period;
    if (t > 0.32) return;
    const f = Math.floor(t / 0.08);
    const gx = x + 4;
    const gy = y - 12;
    ctx.fillStyle = '#ffffff';
    if (f === 0 || f === 3) {
      ctx.fillRect(gx, gy, 1, 1);
      return;
    }
    const arm = f === 1 ? 1 : 2;
    ctx.fillRect(gx - arm, gy, arm * 2 + 1, 1);
    ctx.fillRect(gx, gy - arm, 1, arm * 2 + 1);
    if (f === 2) {
      ctx.fillStyle = '#ffe27a';
      ctx.fillRect(gx - 1, gy - 1, 1, 1);
      ctx.fillRect(gx + 1, gy + 1, 1, 1);
      ctx.fillRect(gx + 1, gy - 1, 1, 1);
      ctx.fillRect(gx - 1, gy + 1, 1, 1);
    }
  }

  serialize() {
    return { ...super.serialize(), itemId: this.itemId, qty: this.qty };
  }
}

// Drop items on the ground at (x, y). opts: { pop (default true), lifetime, collectDelay }
export function dropItem(game, itemId, qty = 1, x = 0, y = 0, opts = {}) {
  if (!itemId || !(qty > 0) || !game?.entities) return null;
  return game.entities.add(new Pickup(game, { itemId, qty, x, y, ...opts }));
}

// "+2 Wood" toasts, merged when several of the same item arrive together (three logs
// from one tree read as one line, not three).
const toastState = new WeakMap(); // game -> { pending: Map<itemId, qty>, t }

export function notePickupToast(game, itemId, qty) {
  let st = toastState.get(game);
  if (!st) toastState.set(game, (st = { pending: new Map(), t: 0 }));
  st.pending.set(itemId, (st.pending.get(itemId) || 0) + qty);
  st.t = 0.35;
}

export function updatePickupToasts(game, dt) {
  const st = toastState.get(game);
  if (!st || !st.pending.size) return;
  st.t -= dt;
  if (st.t > 0) return;
  for (const [id, n] of st.pending) game.ui?.toast?.(pickupToastText(id, n), 'good');
  st.pending.clear();
}

export function pickupToastText(itemId, qty) {
  if (itemId === 'coin') return `+${qty} ${qty === 1 ? 'coin' : 'coins'}`;
  const name = itemDef(itemId)?.name || String(itemId);
  return `+${qty} ${name}`;
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
