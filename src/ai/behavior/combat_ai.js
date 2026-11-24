import { factionRelation } from '../../entities/entity.js';
import { clamp, dist, tileOf, walkable, lineOfSight, clearShot, isActorAlive, warnOnce, safe } from './util.js';

// Lyra in a fight: who counts as a friend, who she should fight under each stance,
// and how she fights (range first, kite melee foes, dagger when cornered, never
// shoot through walls or past the player).

export const STANCES = ['attack', 'defend', 'passive', 'self_defense'];
export const ATTACK_RADIUS = 150; // attack mode scan radius around her (or the guard point)
export const DEFEND_RADIUS = 90; // defend mode: hostiles this close to the player or her
export const BOLT_COOLDOWN = 1.1;
export const DAGGER_COOLDOWN = 0.55;
const BOLT_SPEED = 220; // px/s, for leading moving targets
const MEMORY_SECONDS = 9; // how long "it attacked you" stays relevant
export const SELF_DEFENSE_SECONDS = 10; // how long someone who hit her stays a fair target
const PRESSED_SECONDS = 3; // passive: only a foe hitting her right now, right here
const PRESSED_RANGE = 40;

// The one friend test (DESIGN §10): her mind's relationships decide. Without a
// mind, the player, villagers and guards are friends.
export function isFriend(game, self, e) {
  if (!e) return false;
  if (e === self) return true;
  const rels = self?.mind?.relationships;
  if (rels && typeof rels.isFriend === 'function') {
    try {
      return !!rels.isFriend(e);
    } catch (err) {
      warnOnce('relationships.isFriend failed', err);
    }
  }
  return e === game.player || e.id === 'player' || e.faction === 'player' || e.faction === 'villager' || e.faction === 'guard';
}

// People and animals she never fights on her own initiative, whatever the stance
// (DESIGN §16.4 values): villagers, guards, the cat, the chickens, anyone's pet.
// Only someone actually attacking her in self_defense gets past this.
export function isInnocent(game, self, e) {
  if (!e || e === game.player || e.id === 'player') return false;
  if (e.faction === 'villager' || e.faction === 'guard' || e.profile) return true;
  if (e.species === 'cat' || e.species === 'chicken' || e.pet === true) return true;
  if (e.tags && typeof e.tags.has === 'function' && e.tags.has('pet')) return true;
  return false;
}

export function isHostile(game, self, e) {
  const c = game.combat;
  if (c && typeof c.isHostile === 'function') {
    try {
      return !!(c.isHostile(self, e) || c.isHostile(e, self));
    } catch (err) {
      warnOnce('combat.isHostile failed', err);
    }
  }
  return factionRelation(self.faction, e.faction) === 'hostile' || factionRelation(e.faction, self.faction) === 'hostile';
}

// Hostile by faction, or someone she personally counts as an enemy.
export function isThreat(game, self, e) {
  if (isHostile(game, self, e)) return true;
  const rels = self?.mind?.relationships;
  if (rels && typeof rels.isEnemy === 'function') {
    try {
      return !!rels.isEnemy(e);
    } catch (err) {
      warnOnce('relationships.isEnemy failed', err);
    }
  }
  return false;
}

// Would her bolts and dagger actually land on `e` if she chose it? The combat
// rules decide (they spare villagers and pets unless they hurt her first); without
// them, anything she would pick is fair.
export function canHarm(game, self, e) {
  const c = game.combat;
  if (!c || typeof c.canHarm !== 'function') return true;
  try {
    return !!c.canHarm(self, e, true);
  } catch (err) {
    warnOnce('combat.canHarm failed', err);
    return true;
  }
}

export function threatOf(game, self, e) {
  if (Number.isFinite(e.threat)) return e.threat;
  return isHostile(game, self, e) ? 2 : 0.5;
}

export function isRangedFoe(e) {
  return !!(e.ranged || e.weapon === 'bow' || /archer|caster|mage/.test(String(e.species || e.spriteKey || '')));
}

// Is anything with a body worth considering at all?
function isFightable(e, self) {
  return e && e !== self && e.type === 'actor' && isActorAlive(e);
}

// Choose who to fight right now, or null. ctx:
// { game, self, stance, player, now, memory (Map entity -> {vsPlayer, vsSelf, byPlayer}),
//   center {x,y} (guard point or her position), radius (attack scan), guardRadius?, current, focus }
// Stances: attack (every non-friend nearby), defend (threats to the player or her),
// passive (only a foe hitting her right now), self_defense (only whoever attacked
// her, the player included: the one case that bypasses isFriend).
export function selectTarget(ctx) {
  const { game, self, stance, player, now, memory, current, focus } = ctx;
  if (focus && isFightable(focus, self) && !isFriend(game, self, focus) && canHarm(game, self, focus)) return focus;
  const list = game.entities?.list || game.entities?.all?.() || [];
  const cx = ctx.center?.x ?? self.x;
  const cy = ctx.center?.y ?? self.y;
  const scan = ctx.radius ?? ATTACK_RADIUS;
  const guardR = ctx.guardRadius ?? 0;
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!isFightable(e, self)) continue;
    const ds = dist(self.x, self.y, e.x, e.y);
    if (ds > 280) continue;
    const rec = memory?.get(e);
    const hitHerAgo = rec ? now - rec.vsSelf : Infinity;
    const attackedHer = hitHerAgo < SELF_DEFENSE_SECONDS;
    const selfDefense = stance === 'self_defense' && attackedHer;
    if (!selfDefense && (isFriend(game, self, e) || isInnocent(game, self, e))) continue;
    if (!canHarm(game, self, e)) continue;
    const vsPlayer = (rec && now - rec.vsPlayer < MEMORY_SECONDS) || (player && (e.target === player || e.ai?.target === player));
    const vsSelf = (rec && now - rec.vsSelf < MEMORY_SECONDS) || e.target === self || e.ai?.target === self;
    const byPlayer = rec && now - rec.byPlayer < MEMORY_SECONDS;
    let eligible = false;
    if (stance === 'attack') {
      eligible = dist(cx, cy, e.x, e.y) <= scan || ((vsPlayer || vsSelf) && ds <= 220);
    } else if (stance === 'self_defense') {
      eligible = attackedHer && ds <= 240;
    } else if (stance === 'passive') {
      // Self-preservation outranks the order: a foe biting her now gets the dagger.
      eligible = hitHerAgo < PRESSED_SECONDS && ds <= PRESSED_RANGE;
    } else {
      // defend: threats that attack or approach the player or her, plus the player's fights
      if (vsPlayer || vsSelf || byPlayer) eligible = ds <= 240;
      else if (isThreat(game, self, e)) {
        eligible =
          ds <= DEFEND_RADIUS ||
          (player && dist(player.x, player.y, e.x, e.y) <= DEFEND_RADIUS) ||
          (guardR > 0 && dist(cx, cy, e.x, e.y) <= guardR);
      }
    }
    if (!eligible) continue;
    let score = 0;
    if (vsPlayer) score += 300;
    if (vsSelf) score += 200;
    if (byPlayer) score += 120;
    score += threatOf(game, self, e) * 25;
    score -= ds * 0.6;
    if (e === current) score += 40;
    if (e.maxHp > 0) score += (1 - clamp(e.hp / e.maxHp, 0, 1)) * 20;
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

// Per-companion fighting state and tactics.
export class CombatAI {
  constructor(behavior) {
    this.b = behavior;
    this.boltCd = 0;
    this.daggerCd = 0;
    this.strafeT = 0;
    this.strafeDir = 1;
    this.cornered = 0;
    this.friendBlockT = 0;
    this.track = null;
    this.lastX = 0;
    this.lastY = 0;
    this.vx = 0;
    this.vy = 0;
  }

  tick(dt) {
    if (this.boltCd > 0) this.boltCd -= dt;
    if (this.daggerCd > 0) this.daggerCd -= dt;
    if (this.friendBlockT > 0) this.friendBlockT -= dt;
  }

  // Smoothed target velocity, for leading bolts.
  trackTarget(t, dt) {
    if (this.track !== t) {
      this.track = t;
      this.lastX = t.x;
      this.lastY = t.y;
      this.vx = 0;
      this.vy = 0;
      return;
    }
    if (dt > 0) {
      const k = Math.min(1, dt * 6);
      this.vx += ((t.x - this.lastX) / dt - this.vx) * k;
      this.vy += ((t.y - this.lastY) / dt - this.vy) * k;
    }
    this.lastX = t.x;
    this.lastY = t.y;
  }

  // One step of fighting `target`.
  fight(target, dt, opts = {}) {
    const b = this.b;
    const g = b.game;
    const a = b.actor;
    const st = b.steering;
    this.trackTarget(target, dt);
    const d = dist(a.x, a.y, target.x, target.y);
    const los = clearShot(g, a, target);
    const ranged = isRangedFoe(target);
    let moved = false;

    if (!moved && d < 40 && !ranged) {
      if (this.kite(target)) {
        moved = true;
        this.cornered = Math.max(0, this.cornered - dt);
      } else this.cornered += dt;
    } else if (d >= 40) this.cornered = Math.max(0, this.cornered - dt);

    if (!moved) {
      if (opts.stayOut && (d > 100 || !los)) {
        // The target is somewhere she will not follow it: hold at the edge.
        st.stop();
        a.faceToward(target.x, target.y);
        moved = true;
      } else if (d > 100 || !los) {
        st.moveTo(target.x, target.y, dt, { arrive: los ? 85 : 26, run: d > 160 ? 1.3 : 1, ignore: target });
        moved = true;
      } else if (this.friendBlockT > 0) {
        this.strafe(target, 0.9);
        moved = true;
      } else if (d >= 40) {
        this.strafeT -= dt;
        if (this.strafeT <= 0) {
          this.strafeT = 1 + Math.random() * 1.2;
          this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        }
        this.strafe(target, 0.3);
        moved = true;
      } else st.stop();
    }

    // Attacks: dagger up close when cornered (or the foe is a shooter), else a bolt.
    if (d < 22 && (this.cornered > 0.2 || ranged || d < 13)) {
      st.stop();
      if (this.daggerCd <= 0) {
        a.faceToward(target.x, target.y);
        const ok = safe('combat.melee', () => g.combat?.melee?.(a, { target }), false);
        this.daggerCd = ok ? DAGGER_COOLDOWN : 0.25;
        if (ok) b.noteAttack(target);
      }
      return;
    }
    if (this.boltCd <= 0 && los && d <= 170) this.shoot(target, d);
  }

  shoot(target, d) {
    const b = this.b;
    const g = b.game;
    const a = b.actor;
    const lead = clamp(d / BOLT_SPEED, 0, 0.6);
    let ax = target.x + clamp(this.vx * lead, -24, 24);
    let ay = target.y - 3 + clamp(this.vy * lead, -24, 24);
    if (!lineOfSight(g, a.x, a.y - 3, ax, ay)) {
      ax = target.x;
      ay = target.y - 3;
    }
    if (this.friendInLine(a.x, a.y - 3, ax, ay, target)) {
      this.friendBlockT = 0.5;
      this.boltCd = 0.15;
      return false;
    }
    a.faceToward(target.x, target.y);
    const pr = safe('combat.shoot', () => g.combat?.shoot?.(a, ax, ay, 'bolt', { target }), null);
    this.boltCd = pr ? BOLT_COOLDOWN : 0.35;
    if (pr) b.noteAttack(target);
    return !!pr;
  }

  // Anyone she must not hit near the line of fire (the player first of all).
  friendInLine(x0, y0, x1, y1, target) {
    const b = this.b;
    const g = b.game;
    const a = b.actor;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l2 = dx * dx + dy * dy || 1;
    const minX = Math.min(x0, x1) - 12;
    const maxX = Math.max(x0, x1) + 12;
    const minY = Math.min(y0, y1) - 16;
    const maxY = Math.max(y0, y1) + 16;
    const list = g.entities?.list || g.entities?.all?.() || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === a || e === target || e.type !== 'actor' || e.removed || e.dead) continue;
      if (e.x < minX || e.x > maxX || e.y - 3 < minY || e.y - 3 > maxY) continue;
      const ex = e.x - x0;
      const ey = e.y - 3 - y0;
      const t = (ex * dx + ey * dy) / l2;
      if (t < 0.02 || t > 1.1) continue;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      if (Math.hypot(e.x - px, e.y - 3 - py) > 10) continue;
      if (e === g.player || isFriend(g, a, e) || isInnocent(g, a, e)) return e;
    }
    return null;
  }

  // Step away from a melee foe, preferring directions toward the player. False when cornered.
  kite(target) {
    const b = this.b;
    const g = b.game;
    const a = b.actor;
    let ux = a.x - target.x;
    let uy = a.y - target.y;
    const ul = Math.hypot(ux, uy) || 1;
    ux /= ul;
    uy /= ul;
    const p = g.player;
    let tpx = 0;
    let tpy = 0;
    if (p && p !== target) {
      const pl = Math.hypot(p.x - a.x, p.y - a.y) || 1;
      tpx = (p.x - a.x) / pl;
      tpy = (p.y - a.y) / pl;
    }
    let bestX = 0;
    let bestY = 0;
    let bestS = -Infinity;
    for (let k = 0; k < 7; k++) {
      const ang = (k === 0 ? 0 : Math.ceil(k / 2) * 0.6 * (k % 2 ? 1 : -1));
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const dx = ux * c - uy * s;
      const dy = ux * s + uy * c;
      if (!walkable(g, tileOf(a.x + dx * 14), tileOf(a.y + dy * 14), a)) continue;
      if (!walkable(g, tileOf(a.x + dx * 26), tileOf(a.y + dy * 26), a)) continue;
      const score = c + 0.35 * (dx * tpx + dy * tpy);
      if (score > bestS) {
        bestS = score;
        bestX = dx;
        bestY = dy;
      }
    }
    if (bestS === -Infinity) return false;
    b.steering.setIntent(bestX, bestY, 1, 1.15);
    return true;
  }

  // Circle the target slowly (keeps her lively and clears lines of fire).
  strafe(target, mag) {
    const b = this.b;
    const g = b.game;
    const a = b.actor;
    const ux = target.x - a.x;
    const uy = target.y - a.y;
    const ul = Math.hypot(ux, uy) || 1;
    let px = (-uy / ul) * this.strafeDir;
    let py = (ux / ul) * this.strafeDir;
    if (!walkable(g, tileOf(a.x + px * 12), tileOf(a.y + py * 12), a)) {
      this.strafeDir = -this.strafeDir;
      px = -px;
      py = -py;
      if (!walkable(g, tileOf(a.x + px * 12), tileOf(a.y + py * 12), a)) {
        b.steering.stop();
        return;
      }
    }
    b.steering.setIntent(px, py, mag, 1);
    a.faceToward(target.x, target.y);
  }

  // Passive stance: keep clear of threats, drifting toward the player. True if moving.
  keepAway(dt) {
    const b = this.b;
    const g = b.game;
    const a = b.actor;
    const list = g.entities?.list || [];
    let nx = 0;
    let ny = 0;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!isFightable(e, a)) continue;
      const d = dist(a.x, a.y, e.x, e.y);
      if (d > 64) continue;
      if (isFriend(g, a, e) || !isThreat(g, a, e)) continue;
      nx += (a.x - e.x) / (d || 1);
      ny += (a.y - e.y) / (d || 1);
      n++;
    }
    if (!n) return false;
    const p = g.player;
    if (p && p !== a) {
      const pl = Math.hypot(p.x - a.x, p.y - a.y) || 1;
      nx += ((p.x - a.x) / pl) * 0.6;
      ny += ((p.y - a.y) / pl) * 0.6;
    }
    const l = Math.hypot(nx, ny) || 1;
    if (!walkable(g, tileOf(a.x + (nx / l) * 12), tileOf(a.y + (ny / l) * 12), a)) return false;
    b.steering.setIntent(nx, ny, 1, 1.15);
    return true;
  }
}
