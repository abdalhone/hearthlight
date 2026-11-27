// Lock-on (round 14b, item 14; DESIGN §35.5; the author: "I want the button in the middle of
// my mouse to be able to lock to enemies or people"). `game.lock`.
//
//   target                  the locked actor, or null
//   set(e) / clear()        lock / unlock (set refuses anything not valid)
//   cycle(dir)              to the next valid one round the player (+1 clockwise, -1 back)
//   valid(e)                alive (or downed: for the finishing blow), not hidden, within
//                           RANGE of the player, reachable (no wall: walls.canReach), never
//                           the player, never whoever walks with you (unless asked)
//   pickAt(x, y)            the actor under a world point (a pad of PICK px), or null
//   nearestInFront()        the nearest valid one in front of the player
//   press({ x, y })         the lock control: a middle click on someone locks them; on an
//                           empty spot while locked clears; G / R3 toggles the nearest
//   aimTarget(range)        the lock, if valid and within `range` of the player (weaves and
//                           the sword aim at it, for every source)
//   update(dt)              re-targets when the lock dies or breaks (walls, distance)
//
// Phone: a long press on the sword button locks the nearest in front, a swipe on it cycles
// (touch.js). Never a tap on the world.
//
// Round 15 (item 11; the author: "I cannot focus on a training dummy"): what can be locked is
// whatever a player fights: every actor (people, creatures, bandits, bosses, the tempter, the
// downed for the finishing blow) and the training dummy, the one thing made to be struck that
// is no one (`isTargetProp`). Props that merely break in passing (trees, barrels, rocks) are
// not targets: G in a wood would lock a tree instead of the wolf behind it.

import { canReach } from '../world/walls.js';

export const RANGE = 240; // px from the player
export const PICK = 12; // px of slack around an actor under the cursor

// A world object that is a target to lock and aim at (round 15): the training dummy.
export function isTargetProp(o) {
  return !!o && o.type !== 'actor' && o.objType === 'dummy' && !o.removed && !o.hidden;
}

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

export class LockOn {
  constructor(game) {
    this.game = game;
    this.target = null;
    this.lockedAt = -Infinity;
    this.allowCompanion = false;
  }

  get player() {
    return this.game?.player || null;
  }

  isCompanion(e) {
    const g = this.game;
    return !!e && (safe(() => g.party?.isCompanion?.(e), false) || (!g.party && e === g.companion));
  }

  // Can this be locked (or stay locked)?
  valid(e, { range = RANGE } = {}) {
    const P = this.player;
    if (!e || !P || e === P || e.removed || e.hidden || e.absent || e.carriedBy) return false;
    // The training dummy (round 15): in range and in reach, like anyone.
    if (e.type !== 'actor') return isTargetProp(e) && Math.hypot(e.x - P.x, e.y - P.y) <= range && !!safe(() => canReach(this.game, P, e), true);
    if (e.dead && !e.downed) return false;
    const alive = typeof e.isAlive === 'function' ? e.isAlive() : !e.dead;
    if (!alive && !e.downed) return false;
    if (!this.allowCompanion && this.isCompanion(e)) return false;
    if (Math.hypot(e.x - P.x, e.y - P.y) > range) return false;
    if (!safe(() => canReach(this.game, P, e), true)) return false;
    return true;
  }

  set(e) {
    if (!this.valid(e)) return false;
    const prev = this.target;
    this.target = e;
    this.lockedAt = this.game?.time ?? 0;
    if (prev !== e) safe(() => this.game.bus?.emit?.('lock_changed', { target: e, from: prev }));
    return true;
  }

  clear() {
    if (!this.target) return false;
    const prev = this.target;
    this.target = null;
    safe(() => this.game.bus?.emit?.('lock_changed', { target: null, from: prev }));
    return true;
  }

  candidates() {
    const P = this.player;
    if (!P) return [];
    const list = safe(() => this.game.entities.query(P.x, P.y, RANGE + 8), null) || safe(() => this.game.entities.all(), []) || [];
    const props = safe(() => this.game.objects?.inRadius?.(P.x, P.y, RANGE + 8, isTargetProp), null) || [];
    return [...list, ...props].filter((e) => this.valid(e));
  }

  // The nearest valid actor in front of the player (foes first: what is fighting you).
  nearestInFront() {
    const P = this.player;
    if (!P) return null;
    const fx = P.facing?.x ?? 0;
    const fy = P.facing?.y ?? 1;
    const c = this.game?.combat;
    let best = null;
    let bs = Infinity;
    for (const e of this.candidates()) {
      const dx = e.x - P.x;
      const dy = e.y - P.y;
      const d = Math.hypot(dx, dy) || 1;
      const front = (dx * fx + dy * fy) / d;
      const foe = safe(() => !!c?.isHostile?.(P, e) || e.provokedBy === P, false);
      const score = d - front * 60 - (foe ? 80 : 0);
      if (score < bs) {
        bs = score;
        best = e;
      }
    }
    return best;
  }

  pickAt(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    let best = null;
    let bd = Infinity;
    for (const e of this.candidates()) {
      // The body stands above its feet: test against the middle of the sprite too (a dummy
      // on its post is taller than a person: its straw chest too).
      let d = Math.min(Math.hypot(e.x - x, e.y - y), Math.hypot(e.x - x, e.y - 8 - y));
      if (e.type !== 'actor') d = Math.min(d, Math.hypot(e.x - x, e.y - 16 - y));
      if (d <= (e.radius ?? 5) + PICK && d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  // Round the player by angle: the next one clockwise (dir +1) or back (-1).
  cycle(dir = 1) {
    const P = this.player;
    const list = this.candidates();
    if (!P || !list.length) return this.clear() && null;
    const ang = (e) => Math.atan2(e.y - P.y, e.x - P.x);
    list.sort((a, b) => ang(a) - ang(b));
    let i = this.target ? list.indexOf(this.target) : -1;
    i = i < 0 ? 0 : (i + (dir >= 0 ? 1 : -1) + list.length) % list.length;
    this.set(list[i]);
    return this.target;
  }

  // The lock control. `at`: the world point of a middle click (else the keyboard or pad).
  press(at = null) {
    if (at && Number.isFinite(at.x)) {
      const hit = this.pickAt(at.x, at.y);
      if (hit) return this.set(hit) ? hit : null;
      if (this.target) {
        this.clear();
        return null;
      }
      const n = this.nearestInFront();
      return n && this.set(n) ? n : null;
    }
    if (this.target) {
      this.clear();
      return null;
    }
    const n = this.nearestInFront();
    return n && this.set(n) ? n : null;
  }

  aimTarget(range = RANGE) {
    const t = this.target;
    const P = this.player;
    if (!t || !P || !this.valid(t)) return null;
    if (Math.hypot(t.x - P.x, t.y - P.y) > range) return null;
    return t;
  }

  // Each frame: read the lock controls; keep the lock honest.
  update() {
    const g = this.game;
    const input = g?.input;
    if (input && g.state === 'playing') {
      if (safe(() => input.pressed?.('lock'), false)) {
        const at = safe(() => input.takeLockClick?.(), null);
        this.press(at);
      }
      const steps = safe(() => input.takeLockWheel?.(), 0) || 0;
      if (steps) this.cycle(steps > 0 ? 1 : -1);
      if (safe(() => input.pressed?.('lock_next'), false)) this.cycle(1);
      if (safe(() => input.pressed?.('lock_prev'), false)) this.cycle(-1);
    }
    const t = this.target;
    if (!t) return;
    if (this.valid(t)) return;
    // Dead (and gone from the fight), out of reach or behind a wall: on to the next foe in
    // front, if there is one; else nothing.
    this.target = null;
    const next = t.dead || t.removed ? this.nearestInFront() : null;
    if (next && safe(() => g.combat?.isHostile?.(this.player, next), false)) this.set(next);
    else safe(() => g.bus?.emit?.('lock_changed', { target: null, from: t }));
  }
}

export function installLock(game) {
  if (!game || game.lock) return game?.lock || null;
  game.lock = new LockOn(game);
  return game.lock;
}
