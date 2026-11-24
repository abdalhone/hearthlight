import { TILE } from '../core/constants.js';

// Path following shared by villagers and creatures: asks the pathfinder for a
// route (throttled by a small per-step budget so a crowd never stalls a frame),
// steers along the waypoints, opens closed doors on the way and closes the ones it
// opened once it is through, notices when it is stuck and re-plans.
//
//   const w = new Walker(game, actor, { doors: true });
//   w.goTo(x, y)        -> true when a route was planned (or the goal is close)
//   w.step(dt) -> 'moving' | 'arrived' | 'stuck' | 'idle'   (sets actor.moveIntent)
//   w.stop()

const PATH_BUDGET_PER_STEP = 3;
let budgetStamp = -1;
let budgetLeft = PATH_BUDGET_PER_STEP;

// A per-step allowance of pathfinder calls (shared by every walker).
export function takePathBudget(game) {
  const stamp = game?.time ?? 0;
  if (stamp !== budgetStamp) {
    budgetStamp = stamp;
    budgetLeft = PATH_BUDGET_PER_STEP;
  }
  if (budgetLeft <= 0) return false;
  budgetLeft--;
  return true;
}

export function resetPathBudget() {
  budgetStamp = -1;
  budgetLeft = PATH_BUDGET_PER_STEP;
}

export class Walker {
  constructor(game, actor, opts = {}) {
    this.game = game;
    this.actor = actor;
    this.doors = opts.doors ?? false; // may open doors (villagers do, beasts don't)
    this.arriveDist = opts.arriveDist ?? 3;
    this.path = null;
    this.i = 0;
    this.goal = null; // { x, y }
    this.pending = false; // waiting for path budget
    this.stuckT = 0;
    this.replans = 0;
    this.direct = false; // no route found: walk straight at the goal
    this.opened = []; // doors this walker opened and still has to close
    // Net progress, sampled every half second: in a crowd at a doorway each step forward
    // is pushed straight back by the others, so `actor.moved` alone never reads stuck.
    this._pt = 0;
    this._px = actor.x;
    this._py = actor.y;
    this._stalled = false;
  }

  get active() {
    return !!this.goal;
  }

  goTo(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (this.goal && Math.abs(this.goal.x - x) < 2 && Math.abs(this.goal.y - y) < 2 && (this.path || this.pending)) return true;
    this.goal = { x, y };
    this.replans = 0;
    this.stuckT = 0;
    this._pt = 0;
    this._px = this.actor.x;
    this._py = this.actor.y;
    this._stalled = false;
    this._plan();
    return true;
  }

  stop() {
    this.goal = null;
    this.path = null;
    this.pending = false;
    const mi = this.actor.moveIntent;
    mi.x = 0;
    mi.y = 0;
  }

  _plan() {
    const a = this.actor;
    const g = this.goal;
    if (!g) return;
    const d = Math.hypot(g.x - a.x, g.y - a.y);
    // Short hops in the open need no search.
    if (d < TILE * 2.5 && this._clearLine(a.x, a.y, g.x, g.y)) {
      this.path = [{ x: g.x, y: g.y }];
      this.i = 0;
      this.pending = false;
      this.direct = false;
      return;
    }
    const pf = this.game.pathfinder;
    if (!pf?.find) {
      this.path = [{ x: g.x, y: g.y }];
      this.i = 0;
      this.pending = false;
      this.direct = true;
      return;
    }
    if (!takePathBudget(this.game)) {
      this.pending = true;
      return;
    }
    let p = null;
    try {
      p = pf.find(a.x, a.y, g.x, g.y, { actor: a, allowDoors: this.doors, maxNodes: d > 600 ? 6000 : 3000 });
    } catch {
      p = null;
    }
    this.pending = false;
    if (Array.isArray(p) && p.length) {
      this.path = p;
      this.i = 0;
      this.direct = false;
      // Skip waypoints already behind us (the first one is often our own tile).
      while (this.i < this.path.length - 1 && Math.hypot(this.path[this.i].x - a.x, this.path[this.i].y - a.y) < 6) this.i++;
    } else {
      this.path = [{ x: g.x, y: g.y }];
      this.i = 0;
      this.direct = true;
    }
  }

  // Is the straight line walkable (tile samples every half tile)?
  _clearLine(x0, y0, x1, y1) {
    const g = this.game;
    if (!g.isBlockedTile) return true;
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(d / (TILE / 2)));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const tx = Math.floor((x0 + (x1 - x0) * t) / TILE);
      const ty = Math.floor((y0 + (y1 - y0) * t) / TILE);
      try {
        if (g.isBlockedTile(tx, ty, this.actor)) return false;
      } catch {
        return true;
      }
    }
    return true;
  }

  // Steer one step. Returns 'moving' | 'arrived' | 'stuck' | 'idle'.
  step(dt, speedMul = 1) {
    const a = this.actor;
    const mi = a.moveIntent;
    this._closeDoorsBehind();
    if (!this.goal) {
      mi.x = 0;
      mi.y = 0;
      return 'idle';
    }
    if (this.pending) {
      this._plan();
      if (this.pending) {
        mi.x = 0;
        mi.y = 0;
        return 'moving';
      }
    }
    const path = this.path;
    if (!path || !path.length) {
      mi.x = 0;
      mi.y = 0;
      return 'idle';
    }
    let wp = path[this.i];
    let dx = wp.x - a.x;
    let dy = wp.y - a.y;
    let d = Math.hypot(dx, dy);
    const last = this.i >= path.length - 1;
    while (!last && d < 4 && this.i < path.length - 1) {
      this.i++;
      wp = path[this.i];
      dx = wp.x - a.x;
      dy = wp.y - a.y;
      d = Math.hypot(dx, dy);
    }
    if (this.i >= path.length - 1 && d <= this.arriveDist) {
      mi.x = 0;
      mi.y = 0;
      this.goal = null;
      this.path = null;
      return 'arrived';
    }
    if (this.doors) this._openDoorAhead(dx, dy, d);
    // Ease in on the final approach so walkers do not overshoot and jitter.
    const ease = this.i >= path.length - 1 && d < 10 ? Math.max(0.35, d / 10) : 1;
    mi.x = (dx / d) * ease * speedMul;
    mi.y = (dy / d) * ease * speedMul;
    const l = Math.hypot(mi.x, mi.y);
    if (l > 1) {
      mi.x /= l;
      mi.y /= l;
    }
    // Stuck: trying to move but going nowhere, either pressed against something or held
    // in place by a crowd (moving each step, but no net progress).
    const trying = a.lockTime <= 0 && !(a.rootTime > 0);
    this._pt += dt;
    if (this._pt >= 0.5) {
      this._stalled = trying && Math.hypot(a.x - this._px, a.y - this._py) < 2.5;
      this._pt = 0;
      this._px = a.x;
      this._py = a.y;
    }
    if (trying && ((a.moved ?? 1) < 0.05 || this._stalled)) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 0.9) {
      this.stuckT = 0;
      this.replans++;
      // Jammed among other people (a doorway at the end of lunch): villagers slip past
      // each other for a moment instead of shoving forever.
      if (typeof a.slipThrough === 'function' && this._crowded()) a.slipThrough(1.6);
      if (this.replans > 3) {
        this.stop();
        return 'stuck';
      }
      this._plan();
    }
    return 'moving';
  }

  // Another person close enough to be what holds us up.
  _crowded() {
    const a = this.actor;
    const ents = this.game.entities;
    if (!ents?.query) return false;
    try {
      return ents.query(a.x, a.y, (a.radius || 5) * 3, (e) => e !== a && e.type === 'actor' && e.solid && !e.removed && !e.dead).length > 0;
    } catch {
      return false;
    }
  }

  // Open a closed door on the next tile we are walking into.
  _openDoorAhead(dx, dy, d) {
    const objs = this.game.objects;
    if (!objs?.doorAt || d < 0.01) return;
    const a = this.actor;
    const ax = a.x + (dx / d) * (TILE * 0.75);
    const ay = a.y + (dy / d) * (TILE * 0.75);
    const tx = Math.floor(ax / TILE);
    const ty = Math.floor(ay / TILE);
    let door = null;
    try {
      door = objs.doorAt(tx, ty);
    } catch {
      door = null;
    }
    if (!door || door.isOpen || door.state?.open) return;
    let ok = false;
    try {
      ok = door.open?.(a);
    } catch {
      ok = false;
    }
    if (ok && !this.opened.includes(door)) this.opened.push(door);
  }

  // Close doors we opened once we are two tiles past them and nobody stands in them.
  _closeDoorsBehind() {
    if (!this.opened.length) return;
    const a = this.actor;
    for (let k = this.opened.length - 1; k >= 0; k--) {
      const door = this.opened[k];
      const cx = door.tx * TILE + TILE / 2;
      const cy = door.ty * TILE + TILE / 2;
      if (Math.hypot(a.x - cx, a.y - cy) < TILE * 1.6) continue;
      if (!(door.isOpen ?? door.state?.open)) {
        this.opened.splice(k, 1);
        continue;
      }
      if (this._doorwayBusy(door)) continue;
      try {
        door.close?.(a);
      } catch {
        /* a door that refuses to close stays open */
      }
      this.opened.splice(k, 1);
    }
  }

  _doorwayBusy(door) {
    const ents = this.game.entities;
    if (!ents?.query) return false;
    const cx = door.tx * TILE + TILE / 2;
    const cy = door.ty * TILE + TILE / 2;
    const near = ents.query(cx, cy, TILE * 0.9, (e) => e.type === 'actor' && !e.removed && !e.dead);
    return near.length > 0;
  }
}
