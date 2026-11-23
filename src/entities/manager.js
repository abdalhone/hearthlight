import { TILE } from '../core/constants.js';

// Owns every live entity: update order, spatial queries, movement with collision.
export class EntityManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.byId = new Map();
  }

  add(e) {
    if (this.byId.has(e.id)) return this.byId.get(e.id);
    this.list.push(e);
    this.byId.set(e.id, e);
    this.game.bus?.emit('entity_added', { entity: e });
    return e;
  }

  remove(e) {
    e.removed = true;
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  all() {
    return this.list;
  }

  actors() {
    return this.list.filter((e) => e.type === 'actor');
  }

  clear() {
    this.list.length = 0;
    this.byId.clear();
  }

  // Entities within radius r of (x, y), nearest first. filter(e) optional.
  query(x, y, r, filter) {
    const out = [];
    const r2 = r * r;
    for (const e of this.list) {
      if (e.removed) continue;
      const d2 = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d2 <= r2 && (!filter || filter(e))) out.push([d2, e]);
    }
    out.sort((a, b) => a[0] - b[0]);
    return out.map((p) => p[1]);
  }

  nearest(x, y, r, filter) {
    let best = null;
    let bd = r * r;
    for (const e of this.list) {
      if (e.removed) continue;
      const d2 = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d2 <= bd && (!filter || filter(e))) {
        bd = d2;
        best = e;
      }
    }
    return best;
  }

  find(pred) {
    return this.list.find((e) => !e.removed && pred(e)) || null;
  }

  // Case-insensitive lookup by id, full name, or first name.
  byName(name) {
    if (!name) return null;
    const n = String(name).toLowerCase().trim();
    const direct = this.byId.get(n) || this.byId.get(name);
    if (direct && !direct.removed) return direct;
    let partial = null;
    for (const e of this.list) {
      if (e.removed || !e.name) continue;
      const en = e.name.toLowerCase();
      if (en === n) return e;
      if (!partial && (en.split(/\s+/)[0] === n || en.includes(n))) partial = e;
    }
    return partial;
  }

  update(dt) {
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.removed) continue;
      try {
        e.update(dt);
      } catch (err) {
        console.error('[entities] update failed for', e.id, err);
        e._errors = (e._errors || 0) + 1;
        if (e._errors > 30) e.removed = true;
      }
    }
    this.separate();
    if (list.some((e) => e.removed)) {
      for (const e of list) if (e.removed) {
        this.byId.delete(e.id);
        this.game.bus?.emit('entity_removed', { entity: e });
      }
      this.list = list.filter((e) => !e.removed);
    }
  }

  // Gently push overlapping solid actors apart so they never stack.
  separate() {
    const actors = this.list;
    const n = actors.length;
    for (let i = 0; i < n; i++) {
      const a = actors[i];
      if (a.type !== 'actor' || !a.solid || a.removed || a.dead) continue;
      for (let j = i + 1; j < n; j++) {
        const b = actors[j];
        if (b.type !== 'actor' || !b.solid || b.removed || b.dead) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.radius + b.radius - 1;
        if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d >= min) continue;
        const push = (min - d) * 0.5;
        const ux = dx / d;
        const uy = dy / d;
        const aFixed = a.lockTime > 0 && a.state === 'sleep';
        const bFixed = b.lockTime > 0 && b.state === 'sleep';
        if (!aFixed) this.moveActor(a, -ux * push * (bFixed ? 2 : 1), -uy * push * (bFixed ? 2 : 1));
        if (!bFixed) this.moveActor(b, ux * push * (aFixed ? 2 : 1), uy * push * (aFixed ? 2 : 1));
      }
    }
  }

  // Is the actor's feet box blocked at (x, y)? Uses map tiles and blocking objects.
  blockedAt(a, x, y) {
    const r = a.radius;
    const x0 = Math.floor((x - r) / TILE);
    const x1 = Math.floor((x + r - 0.01) / TILE);
    const y0 = Math.floor((y - r * 0.6) / TILE);
    const y1 = Math.floor((y + r * 0.4 - 0.01) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (this.game.isBlockedTile(tx, ty, a)) return true;
      }
    }
    return false;
  }

  // Move with axis-separated collision and a little corner sliding.
  moveActor(a, dx, dy) {
    if (!dx && !dy) return;
    // Large moves are split so fast knockback cannot tunnel through walls.
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 4));
    const sx = dx / steps;
    const sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      if (sx) {
        const nx = a.x + sx;
        if (!this.blockedAt(a, nx, a.y)) a.x = nx;
        else if (!sy) {
          // Slide around corners when walking straight into one.
          if (!this.blockedAt(a, nx, a.y - 3)) a.y -= Math.abs(sx) * 0.7;
          else if (!this.blockedAt(a, nx, a.y + 3)) a.y += Math.abs(sx) * 0.7;
        }
      }
      if (sy) {
        const ny = a.y + sy;
        if (!this.blockedAt(a, a.x, ny)) a.y = ny;
        else if (!sx) {
          if (!this.blockedAt(a, a.x - 3, ny)) a.x -= Math.abs(sy) * 0.7;
          else if (!this.blockedAt(a, a.x + 3, ny)) a.x += Math.abs(sy) * 0.7;
        }
      }
    }
  }

  // Entities whose bounds touch the view rectangle (world px), for rendering.
  inView(x, y, w, h, margin = 48) {
    return this.list.filter((e) => !e.removed && e.x > x - margin && e.x < x + w + margin && e.y > y - margin && e.y < y + h + margin * 2);
  }
}
