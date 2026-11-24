import { TILE } from '../../core/constants.js';
import {
  clamp,
  dist,
  tileOf,
  tileCenter,
  walkable,
  walkLineClear,
  doorIsOpen,
  doorIsLocked,
  onScreen,
  nearestWalkable,
  safe,
  warnOnce,
} from './util.js';

// How Lyra's feet get places: path following with the pathfinder, re-pathing when
// the goal drifts or she gets stuck, local avoidance of other actors, opening doors
// on the way and closing building doors behind her, and the follow slot logic
// (beside you when you stand still, a little behind and to the side when you walk).

export const FOLLOW_DIST = { close: 18, normal: 28, far: 56 };
export const TELEPORT_DIST = 30 * TILE;

const REPATH_COOLDOWN = 0.3;
const STUCK_TIME = 0.6;
const FAIL_RETRY = 1.2;
const DIRECT_RANGE = 56;

export class Steering {
  constructor(game, actor) {
    this.game = game;
    this.actor = actor;
    this.path = null;
    this.idx = 0;
    this.goalX = NaN;
    this.goalY = NaN;
    this.repathCd = 0;
    this.failCd = 0;
    this.failure = null; // { reason: 'locked'|'unreachable'|'stuck', door?, message? }
    this.stuckT = 0;
    this.stuckCount = 0;
    this.stuckGoalX = NaN; // where she was going when she got stuck
    this.stuckGoalY = NaN;
    this.sidestepT = 0;
    this.sideX = 0;
    this.sideY = 0;
    this.wanted = 0; // intent magnitude asked for last step (for stuck detection)
    this.doors = []; // building doors she walked through: [{ door, age, passed }]
    this.direct = [{ x: 0, y: 0 }]; // reused one-waypoint path
    this.forceRepath = false;
    this.avX = 0; // local avoidance push, recomputed each moving step
    this.avY = 0;
    // Follow state.
    this.side = 1;
    this.followMoving = false;
    this.slot = { x: 0, y: 0 };
  }

  reset() {
    this.path = null;
    this.idx = 0;
    this.goalX = NaN;
    this.goalY = NaN;
    this.failure = null;
    this.failCd = 0;
    this.stuckT = 0;
    this.stuckCount = 0;
    this.stuckGoalX = NaN;
    this.sidestepT = 0;
    this.followMoving = false;
  }

  stop() {
    const a = this.actor;
    if (!a.moveIntent) a.moveIntent = { x: 0, y: 0 };
    a.moveIntent.x = 0;
    a.moveIntent.y = 0;
    a.speedMul = 1;
    this.wanted = 0;
  }

  setIntent(x, y, mag = 1, run = 1) {
    const a = this.actor;
    if (!a.moveIntent) a.moveIntent = { x: 0, y: 0 };
    const l = Math.hypot(x, y);
    if (l < 1e-6 || mag <= 0) {
      this.stop();
      return;
    }
    const m = Math.min(1, mag);
    a.moveIntent.x = (x / l) * m;
    a.moveIntent.y = (y / l) * m;
    a.speedMul = run;
    this.wanted = m;
  }

  // Use a path someone already computed (jobs test reachability with a real find).
  adoptPath(path, gx, gy) {
    if (!path || !path.length) return;
    this.path = path;
    this.idx = 0;
    this.goalX = gx;
    this.goalY = gy;
    this.failure = null;
    this.failCd = 0;
    // A new destination is a fresh attempt.
    this.stuckCount = 0;
    this.stuckT = 0;
    this.stuckGoalX = NaN;
    this.skipReached();
  }

  // Plan a route; returns true when a path exists. Sets `failure` otherwise.
  plan(gx, gy, opts = {}) {
    const a = this.actor;
    const g = this.game;
    this.goalX = gx;
    this.goalY = gy;
    this.idx = 0;
    this.forceRepath = false;
    const d = dist(a.x, a.y, gx, gy);
    if (d < DIRECT_RANGE && walkLineClear(g, a.x, a.y, gx, gy, a, Math.max(2, (a.radius || 5) - 1))) {
      this.direct[0].x = gx;
      this.direct[0].y = gy;
      this.path = this.direct;
      this.failure = null;
      return true;
    }
    const pf = g.pathfinder;
    if (!pf || typeof pf.find !== 'function') {
      this.direct[0].x = gx;
      this.direct[0].y = gy;
      this.path = this.direct;
      return true;
    }
    let p = null;
    // Long walks across the map need a wider search than the default budget.
    const maxNodes = opts.maxNodes ?? (d > 30 * TILE ? 16000 : undefined);
    try {
      p = pf.find(a.x, a.y, gx, gy, { actor: a, allowDoors: true, maxNodes });
    } catch (err) {
      warnOnce('pathfinder.find failed', err);
      p = null;
    }
    if (!p || !p.length) {
      this.path = null;
      this.failure = this.explainFailure(gx, gy);
      this.failCd = FAIL_RETRY;
      return false;
    }
    this.path = p;
    this.failure = null;
    this.skipReached();
    return true;
  }

  skipReached() {
    const a = this.actor;
    const p = this.path;
    while (p && this.idx < p.length - 1 && dist(a.x, a.y, p[this.idx].x, p[this.idx].y) < 7) this.idx++;
  }

  // Why a goal cannot be reached: a locked door near it, or simply no way.
  explainFailure(gx, gy) {
    const a = this.actor;
    const g = this.game;
    const door = safe('objects.nearest', () =>
      g.objects?.nearest?.((o) => o.objType === 'door' && doorIsLocked(o) && !a.inventory?.has?.(o.state?.keyId), gx, gy, 20 * TILE),
    );
    if (door) return { reason: 'locked', door };
    return { reason: 'unreachable' };
  }

  // Walk toward (gx, gy). Returns 'arrived' | 'moving' | 'blocked' | 'locked' | 'stuck'.
  // opts: { arrive = 6, speed = 1 (intent), run = 1 (speedMul), slow = true, maxNodes }
  moveTo(gx, gy, dt, opts = {}) {
    const a = this.actor;
    const arrive = opts.arrive ?? 6;
    const d = dist(a.x, a.y, gx, gy);
    if (d <= arrive) {
      this.stop();
      this.stuckCount = 0;
      this.stuckT = 0;
      this.stuckGoalX = NaN;
      this.path = null;
      return 'arrived';
    }
    this.trackStuck(dt);
    if (this.repathCd > 0) this.repathCd -= dt;
    if (this.failCd > 0) {
      this.failCd -= dt;
      // While a goal is unreachable, still drift toward it if nothing is in the way.
      if (!this.path) {
        if (d < DIRECT_RANGE && walkLineClear(this.game, a.x, a.y, gx, gy, a)) this.setIntent(gx - a.x, gy - a.y, opts.speed ?? 1, opts.run ?? 1);
        else this.stop();
        return this.failure?.reason === 'locked' ? 'locked' : 'blocked';
      }
    }
    const drift = Number.isNaN(this.goalX) ? Infinity : dist(gx, gy, this.goalX, this.goalY);
    const need = !this.path || this.idx >= this.path.length || drift > TILE || this.forceRepath;
    if (need && (this.repathCd <= 0 || !this.path || this.forceRepath)) {
      this.repathCd = REPATH_COOLDOWN;
      if (!this.plan(gx, gy, opts)) {
        this.stop();
        return this.failure?.reason === 'locked' ? 'locked' : 'blocked';
      }
    }
    if (!this.path) {
      this.stop();
      return 'blocked';
    }
    if (this.stuckCount >= 6) {
      // Stuck stays stuck for this goal (callers give up on it); a goal somewhere else
      // is a fresh attempt.
      if (Number.isNaN(this.stuckGoalX)) {
        this.stuckGoalX = gx;
        this.stuckGoalY = gy;
      }
      if (dist(gx, gy, this.stuckGoalX, this.stuckGoalY) <= 3 * TILE) {
        this.stop();
        this.failure = { reason: 'stuck' };
        return 'stuck';
      }
      this.stuckCount = 0;
      this.stuckGoalX = NaN;
      this.forceRepath = true;
    }

    // Advance along the path. A waypoint someone is standing on counts as reached.
    const p = this.path;
    while (this.idx < p.length - 1) {
      const w = p[this.idx];
      const dw = dist(a.x, a.y, w.x, w.y);
      if (dw < 6 || (dw < 20 && this.occupied(w.x, w.y, opts.ignore))) this.idx++;
      else break;
    }
    const last = this.idx >= p.length - 1;
    const wp = p[Math.min(this.idx, p.length - 1)];
    // The final waypoint is the tile center of the goal; aim at the true goal instead.
    const tx = last ? gx : wp.x;
    const ty = last ? gy : wp.y;
    let dx = tx - a.x;
    let dy = ty - a.y;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;

    const door = this.handleDoors(dx, dy, wp);
    if (door === 'locked') {
      this.stop();
      this.path = null;
      this.failCd = FAIL_RETRY;
      return 'locked';
    }

    // Sidestep briefly after being stuck twice in a row.
    if (this.sidestepT > 0) {
      this.sidestepT -= dt;
      dx = dx * 0.4 + this.sideX;
      dy = dy * 0.4 + this.sideY;
    }
    this.avoid(opts.ignore, dx, dy);
    dx += this.avX * 0.7;
    dy += this.avY * 0.7;

    let mag = opts.speed ?? 1;
    if (last && opts.slow !== false) mag *= clamp(dl / 18, 0.35, 1);
    this.setIntent(dx, dy, mag, opts.run ?? 1);
    return 'moving';
  }

  // Stuck detection: wanting to move but barely moving for a while means a re-path,
  // and a sideways nudge when it keeps happening.
  trackStuck(dt) {
    const a = this.actor;
    if (a.lockTime > 0 || this.wanted < 0.3) {
      this.stuckT = Math.max(0, this.stuckT - dt);
      return;
    }
    const expected = (a.speed || 60) * (a.speedMul || 1) * this.wanted * dt;
    if ((a.moved ?? expected) < expected * 0.25) this.stuckT += dt;
    else {
      this.stuckT = Math.max(0, this.stuckT - dt * 2);
      if ((a.moved ?? 0) > expected * 0.7) this.stuckCount = Math.max(0, this.stuckCount - dt * 0.5);
    }
    if (this.stuckT > STUCK_TIME) {
      this.stuckT = 0;
      // Standing inside something solid (set down there by a teleport, a knockback, the
      // game moving her): step out onto open ground first.
      if (!walkable(this.game, tileOf(a.x), tileOf(a.y), a)) {
        const spot = nearestWalkable(this.game, a.x, a.y, 3, a);
        if (spot) {
          a.x = spot.x;
          a.y = spot.y;
          this.forceRepath = true;
          return;
        }
      }
      this.stuckCount++;
      this.forceRepath = true;
      if (this.stuckCount >= 2) {
        const mi = a.moveIntent || { x: 0, y: 1 };
        const s = Math.random() < 0.5 ? 1 : -1;
        this.sideX = -mi.y * s;
        this.sideY = mi.x * s;
        this.sidestepT = 0.35;
      }
    }
  }

  // Repulsion from nearby solid actors, plus a sideways step around anyone standing
  // right in her way (ux, uy: where she wants to go). No allocation: writes avX/avY.
  avoid(ignore = null, ux = 0, uy = 0) {
    const a = this.actor;
    this.avX = 0;
    this.avY = 0;
    const list = this.game.entities?.list || this.game.entities?.all?.() || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === a || e === ignore || e.type !== 'actor' || !e.solid || e.dead || e.removed) continue;
      const dx = a.x - e.x;
      const dy = a.y - e.y;
      if (dx > 20 || dx < -20 || dy > 20 || dy < -20) continue;
      const d = Math.hypot(dx, dy);
      if (d < 0.01 || d >= 20) continue;
      if (d < 14) {
        const w = (14 - d) / 14;
        this.avX += (dx / d) * w;
        this.avY += (dy / d) * w;
      }
      const ahead = -(dx * ux + dy * uy) / d;
      if (ahead > 0.35) {
        // Pass on the side she is already on (or her usual side when dead ahead).
        const s = dx * -uy + dy * ux;
        const side = s > 1 ? 1 : s < -1 ? -1 : this.side;
        const w = ((20 - d) / 20) * ahead * 1.6;
        this.avX += -uy * side * w;
        this.avY += ux * side * w;
      }
    }
  }

  // Open closed doors right ahead; remember building doors she walks through.
  handleDoors(ux, uy, wp) {
    const g = this.game;
    if (!g.objects?.doorAt) return null;
    const a = this.actor;
    const here = this.doorAtTile(tileOf(a.x), tileOf(a.y - 2));
    if (here) this.notePassed(here, true);
    let r = this.tryDoor(tileOf(a.x + ux * 10), tileOf(a.y - 2 + uy * 10));
    if (r) return r;
    if (wp && dist(a.x, a.y, wp.x, wp.y) < 24) r = this.tryDoor(tileOf(wp.x), tileOf(wp.y));
    return r;
  }

  doorAtTile(tx, ty) {
    return safe('objects.doorAt', () => this.game.objects.doorAt(tx, ty));
  }

  tryDoor(tx, ty) {
    const door = this.doorAtTile(tx, ty);
    if (!door || doorIsOpen(door)) return null;
    const a = this.actor;
    const ok = safe('door.open', () => door.open(a), false);
    if (!ok) {
      this.failure = { reason: 'locked', door };
      return 'locked';
    }
    this.notePassed(door, false);
    return 'opened';
  }

  notePassed(door, onTile) {
    for (const rec of this.doors) {
      if (rec.door === door) {
        rec.age = 0;
        if (onTile) rec.passed = true;
        return;
      }
    }
    if (!this.isBuildingDoor(door)) return;
    if (this.doors.length >= 4) this.doors.shift();
    this.doors.push({ door, age: 0, passed: onTile });
  }

  isBuildingDoor(door) {
    const map = this.game.map;
    if (!map?.buildingAt) return false;
    return !!safe('map.buildingAt', () => map.buildingAt(door.tx, door.ty) || map.buildingAt(door.tx, door.ty - 1));
  }

  // Close building doors she has walked through, once she is clear of them and the
  // player is not in (or heading through) the doorway.
  updateDoors(dt) {
    const doors = this.doors;
    if (!doors.length) return;
    const a = this.actor;
    const p = this.game.player;
    for (let i = doors.length - 1; i >= 0; i--) {
      const rec = doors[i];
      rec.age += dt;
      const door = rec.door;
      if (!doorIsOpen(door) || rec.age > 12) {
        doors.splice(i, 1);
        continue;
      }
      if (!rec.passed) continue;
      const cx = tileCenter(door.tx);
      const cy = tileCenter(door.ty);
      if (dist(a.x, a.y, cx, cy) < 22) continue;
      if (p && dist(p.x, p.y, cx, cy) < 40) continue;
      if (this.someoneNear(cx, cy, 13)) continue;
      safe('door.close', () => door.close(a));
      doors.splice(i, 1);
    }
  }

  // Is a solid actor (other than her and `ignore`) standing on (x, y)?
  occupied(x, y, ignore = null) {
    const a = this.actor;
    const list = this.game.entities?.list || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === a || e === ignore || e.type !== 'actor' || !e.solid || e.removed || e.dead) continue;
      if (Math.abs(e.x - x) < 9 && Math.abs(e.y - y) < 9) return true;
    }
    return false;
  }

  someoneNear(x, y, r) {
    const list = this.game.entities?.list || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.type !== 'actor' || e.removed || e.dead) continue;
      if (Math.abs(e.x - x) < r && Math.abs(e.y - y) < r) return true;
    }
    return false;
  }

  // --- following ---

  // Compute the follow slot for `target` into this.slot. Beside when the target is
  // idle, behind and a little to the side when it walks.
  computeSlot(target, D, targetIdle, fx, fy) {
    const a = this.actor;
    const g = this.game;
    const px = -fy;
    const py = fx;
    // Stick to the side she is already on unless it is blocked.
    const dot = (a.x - target.x) * px + (a.y - target.y) * py;
    if (Math.abs(dot) > 6) this.side = dot >= 0 ? 1 : -1;
    for (let attempt = 0; attempt < 3; attempt++) {
      const side = attempt === 1 ? -this.side : this.side;
      let sx;
      let sy;
      if (attempt === 2) {
        sx = target.x - fx * D;
        sy = target.y - fy * D;
      } else if (targetIdle) {
        sx = target.x + px * D * side - fx * 4;
        sy = target.y + py * D * side - fy * 4;
      } else {
        sx = target.x - fx * D + px * D * 0.4 * side;
        sy = target.y - fy * D + py * D * 0.4 * side;
      }
      if (walkable(g, tileOf(sx), tileOf(sy), a)) {
        if (attempt === 1) this.side = side;
        this.slot.x = sx;
        this.slot.y = sy;
        return true;
      }
    }
    this.slot.x = target.x;
    this.slot.y = target.y;
    return false;
  }

  // One step of following. Returns 'moving' | 'idle' | 'teleported'.
  // info: { idle (target standing still), speed (target's measured px/s), fx, fy (its heading) }
  follow(target, distance, dt, info) {
    const a = this.actor;
    const D = FOLLOW_DIST[distance] ?? FOLLOW_DIST.normal;
    const pd = dist(a.x, a.y, target.x, target.y);
    if (target === this.game.player && pd > TELEPORT_DIST && !onScreen(this.game, a.x, a.y, 24)) {
      if (this.teleportNear(target)) return 'teleported';
    }
    const exact = this.computeSlot(target, D, info.idle, info.fx, info.fy);
    const sx = this.slot.x;
    const sy = this.slot.y;
    const ds = dist(a.x, a.y, sx, sy);
    if (!this.followMoving) {
      if (ds > (info.idle ? 14 : 10) || pd > D + 18) this.followMoving = true;
    } else if (ds < 4 || (info.idle && ds < 6) || (!exact && pd < D)) {
      this.followMoving = false;
    }
    if (!this.followMoving) {
      this.stop();
      return 'idle';
    }
    // Match the walker's pace near the slot; run to catch up when far behind.
    let run = 1;
    if (!info.idle) run = clamp(info.speed / (a.speed || 80), 0.55, 1.05) + clamp((ds - 6) / 50, 0, 0.55);
    if (pd > 6 * TILE) run = Math.max(run, 1.35);
    if (pd > 12 * TILE) run = 1.6;
    const res = this.moveTo(sx, sy, dt, { arrive: exact ? 3 : D, run, slow: info.idle, ignore: null, maxNodes: pd > 40 * TILE ? 12000 : undefined });
    if (res === 'blocked' || res === 'stuck') {
      // The slot itself may be unreachable (e.g. inside a wall corner): go to the target.
      const r2 = this.moveTo(target.x, target.y, dt, { arrive: D, run });
      return r2 === 'arrived' ? 'idle' : 'moving';
    }
    if (res === 'arrived') {
      this.followMoving = false;
      return 'idle';
    }
    return 'moving';
  }

  // Blink to a walkable spot near the target, out of view when possible, so she
  // "arrives" from the direction she was in instead of popping in on screen.
  teleportNear(target) {
    const a = this.actor;
    const g = this.game;
    const base = Math.atan2(a.y - target.y, a.x - target.x);
    const offsets = [0, 0.5, -0.5, 1, -1, 1.6, -1.6, Math.PI];
    for (const r of [11, 9, 7]) {
      for (const o of offsets) {
        const x = target.x + Math.cos(base + o) * r * TILE;
        const y = target.y + Math.sin(base + o) * r * TILE;
        const tx = tileOf(x);
        const ty = tileOf(y);
        if (!walkable(g, tx, ty, a)) continue;
        const cx = tileCenter(tx);
        const cy = tileCenter(ty);
        if (onScreen(g, cx, cy, 8)) continue;
        if (!this.reachable(cx, cy, target.x, target.y)) continue;
        return this.placeAt(cx, cy, false);
      }
    }
    const spot = nearestWalkable(g, target.x - (target.facing?.x ?? 0) * 24, target.y - (target.facing?.y ?? 1) * 24, 3, a);
    if (!spot) return false;
    return this.placeAt(spot.x, spot.y, true);
  }

  reachable(x0, y0, x1, y1) {
    const pf = this.game.pathfinder;
    if (!pf?.find) return true;
    return !!safe('pathfinder.find', () => pf.find(x0, y0, x1, y1, { actor: this.actor, allowDoors: true, maxNodes: 3000 }));
  }

  placeAt(x, y, visible) {
    const a = this.actor;
    const g = this.game;
    a.x = x;
    a.y = y;
    this.reset();
    this.stop();
    if (visible) {
      safe('particles.emit', () => g.particles?.emit?.('magic', x, y - 8, { count: 14 }));
      safe('lighting.flash', () => g.lighting?.flash?.({ x, y: y - 8, r: 40, color: '#a995ff', intensity: 0.8, duration: 0.4 }));
    }
    return true;
  }
}
