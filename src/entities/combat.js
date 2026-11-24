import { factionRelation } from './entity.js';
import { PLAYER_ID, COMPANION_ID } from '../core/constants.js';
import { itemDef, itemName } from './items.js';
import { Projectile } from './projectiles.js';
import { dropItem, updatePickupToasts } from './pickups.js';

// Combat rules for every actor: melee arcs, projectiles, damage, healing, death,
// knock-outs, items that heal, experience. Contract in DESIGN.md ("Combat").
// Every visual/audio side effect goes through a guarded helper so a bug in another
// module can never break a fight.

export const CRIT_CHANCE = 0.1;
export const CRIT_MUL = 1.5;
export const HIT_STOP = 0.06;
export const DEATH_FADE = 0.8;
export const SELF_REVIVE_SECONDS = 60;
export const SELF_REVIVE_FRACTION = 0.15;
export const LEVEL_HP = 8;
export const LEVEL_ATK = 1;
const PROVOKE_MEMORY = 45; // game seconds a creature stays angry at whoever hurt it
const DEFAULT_MELEE_CD = 0.4;
const MIN_SHOT_GAP = 0.15; // guards against accidental per-frame shooting

// Experience needed to go from `level` to the next one.
export function xpToNext(level) {
  const l = Math.max(1, Math.floor(level || 1)) - 1;
  return 20 + l * 18 + l * l * 4;
}

// Factions the player's side (the player and Lyra) can never hurt.
const PLAYER_SIDE_SAFE = new Set(['player', 'villager', 'guard']);
// Wildlife that fights back when hurt; every other animal runs.
const FIGHTS_BACK = new Set(['boar', 'wolf']);

const HIT_COLORS = {
  slime: '#9ce68a',
  skeleton: '#f6f0de',
  bat: '#a995ff',
};

const COLORS = {
  dmg: '#f4ead7',
  dmgFriend: '#ff6b5e',
  crit: '#ffb047',
  heal: '#58cf8f',
  xp: '#e4b83d',
  level: '#ffe27a',
};

export class Combat {
  constructor(game) {
    this.game = game;
    this.t = 0; // combat clock: only advances while the world runs
    this.random = Math.random; // swapped in tests for deterministic rolls
    this.dying = []; // { e, t } fading corpses
    this.downedAt = new Map(); // actor -> this.t when knocked out
    this.airborne = new Set(); // actors launched by heavy hits (z arc)
    this.lastMeleeHits = 0;
    this._warned = new Set();
    try {
      game.bus?.on?.('game_start', (p) => {
        if (p?.loaded) this._restoreLevelStats(game.companion);
      });
    } catch {
      /* a bus is optional in tests */
    }
  }

  // ---------------------------------------------------------------- update

  update(dt) {
    this.t += dt;
    this._updateDying(dt);
    this._updateDowned();
    this._updateAirborne(dt);
    try {
      updatePickupToasts(this.game, dt);
    } catch (err) {
      this._warn('pickup toasts', err);
    }
  }

  _updateDying(dt) {
    const list = this.dying;
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      d.t += dt;
      const e = d.e;
      // Hold a beat at full opacity so the kill reads, then fade out.
      const k = (d.t - 0.2) / (DEATH_FADE - 0.2);
      e.deathAlpha = k <= 0 ? 1 : Math.max(0, 1 - k);
      if (d.t >= DEATH_FADE || e.removed) {
        list.splice(i, 1);
        if (!e.removed) {
          this._particles('poof', e.x, e.y - 6, { count: 8, color: '#d6d0e0', speed: 22, life: 0.6 });
          this.game.entities?.remove?.(e);
        }
      }
    }
  }

  _updateDowned() {
    const g = this.game;
    const lyra = g.companion;
    if (lyra && lyra.downed && !lyra.dead && !this.downedAt.has(lyra)) this.downedAt.set(lyra, this.t);
    for (const [a, t0] of this.downedAt) {
      if (!a.downed || a.removed || a.dead) {
        this.downedAt.delete(a);
        continue;
      }
      // The player wakes at home (player.js); everyone else gets up on their own.
      if (a !== g.player && a.id !== PLAYER_ID && this.t - t0 >= SELF_REVIVE_SECONDS) {
        this.revive(a, a, SELF_REVIVE_FRACTION);
      }
    }
  }

  _updateAirborne(dt) {
    if (!this.airborne.size) return;
    for (const e of this.airborne) {
      if (e.removed) {
        this.airborne.delete(e);
        continue;
      }
      e._vz -= 560 * dt;
      e.z += e._vz * dt;
      if (e.z <= 0) {
        e.z = 0;
        e._vz = 0;
        this.airborne.delete(e);
        this._particles('dust', e.x, e.y, { count: 4, speed: 18, life: 0.4 });
      }
    }
  }

  // ---------------------------------------------------------------- rules

  isDownable(a) {
    const g = this.game;
    return !!a && (a === g.player || a === g.companion || a.id === PLAYER_ID || a.id === COMPANION_ID || a.downable === true);
  }

  // Villagers (anything with an NPC profile) and actors flagged essential never die.
  isEssential(a) {
    return !!a && (a.essential === true || !!a.profile);
  }

  // Creatures the player's side never hurts: villagers, pets, Pip's cat.
  isProtected(a) {
    return !!a && (this.isEssential(a) || a.species === 'cat' || a.pet === true || !!a.tags?.has?.('pet'));
  }

  isHostile(a, b) {
    if (!a || !b || a === b) return false;
    if (factionRelation(a.faction, b.faction) === 'hostile') return true;
    return this._provokedAgainst(b, a) || this._provokedAgainst(a, b);
  }

  // Is `creature` angry at `other` because `other` hurt it recently?
  _provokedAgainst(creature, other) {
    if (creature.provokedBy !== other || creature.provokedMode !== 'fight') return false;
    const now = this.game.clock?.t ?? this.t;
    return now - (creature.provokedAt ?? -Infinity) < PROVOKE_MEMORY;
  }

  // May `attacker` hurt `target`? `explicit` = the attacker chose this target on purpose.
  // The player's area swings hit hostile and neutral creatures; anyone else's area
  // swings hit only enemies. Allies and the player's own people are always spared.
  canHarm(attacker, target, explicit = false) {
    if (!target || target === attacker || target.type !== 'actor' || target.removed || target.dead) return false;
    if (!attacker) return true;
    const af = attacker.faction;
    const tf = target.faction;
    if (af === 'player' && (PLAYER_SIDE_SAFE.has(tf) || this.isProtected(target))) return false;
    const rel = factionRelation(af, tf);
    if (rel === 'ally') return false;
    if (explicit) return true;
    if (attacker === this.game.player || attacker.id === PLAYER_ID) return true;
    if (rel === 'hostile') return true;
    return target.provokedBy === attacker || attacker.provokedBy === target;
  }

  // ---------------------------------------------------------------- attacks

  // Swing in the attacker's facing direction (toward opts.target when given).
  // opts: { target, arc (radians), range (px), damageMul, knockback, launch, heavy,
  //         cooldown, lock, kind ('melee'|'bite'), silent, noAnim }
  // Returns true when the swing happened; this.lastMeleeHits = targets damaged.
  melee(attacker, opts = {}) {
    this.lastMeleeHits = 0;
    if (!attacker || attacker.type !== 'actor' || !attacker.isAlive?.()) return false;
    if (this.t < (attacker._meleeReadyAt ?? -Infinity)) return false;
    const g = this.game;
    const target = opts.target && opts.target.type === 'actor' ? opts.target : null;
    if (target) attacker.faceToward?.(target.x, target.y);
    const arc = opts.arc ?? 1.75;
    const range = opts.range ?? 20;
    const kind = opts.kind || 'melee';
    const cd = opts.cooldown ?? DEFAULT_MELEE_CD;
    attacker._meleeReadyAt = this.t + cd;
    attacker.attackCd = Math.max(attacker.attackCd || 0, cd);
    if (!opts.noAnim) {
      attacker.setState('attack', opts.lock ?? 0.22);
      attacker.stateTime = 0;
      attacker.animTime = 0;
    }
    g.bus?.emit('attack', { attacker, kind, target });
    if (!opts.silent && kind === 'melee') this._sound('swing', attacker.x, attacker.y, { volume: 0.7 });

    const fx = attacker.facing?.x ?? 0;
    const fy = attacker.facing?.y ?? 1;
    const minCos = Math.cos(arc / 2);
    const power = this.attackPower(attacker) * (opts.damageMul ?? 1);
    const list = g.entities?.all?.() || [];
    let hits = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === attacker || e.type !== 'actor' || e.removed || !e.isAlive()) continue;
      const dx = e.x - attacker.x;
      const dy = e.y - attacker.y;
      const d = Math.hypot(dx, dy);
      if (d > range + (e.radius ?? 5)) continue;
      if (d > 6 && (dx * fx + dy * fy) / d < minCos) continue;
      if (!this.canHarm(attacker, e, e === target)) continue;
      const inv = d > 0.001 ? 1 / d : 0;
      const dealt = this.damage(attacker, e, power, {
        kind,
        knockback: opts.knockback ?? 90,
        launch: opts.launch || 0,
        heavy: !!opts.heavy,
        dirX: d > 0.001 ? dx * inv : fx,
        dirY: d > 0.001 ? dy * inv : fy,
      });
      if (dealt > 0) hits++;
    }
    this.lastMeleeHits = hits;
    return true;
  }

  // Fire a projectile at a point. kind 'bolt' (arcane, glowing, homes a little) or 'arrow'.
  // opts: { damageMul, target, speed, range, lock }
  shoot(attacker, tx, ty, kind = 'bolt', opts = {}) {
    const g = this.game;
    if (!attacker || !attacker.isAlive?.() || !g.entities) return null;
    const target = opts.target && opts.target.type === 'actor' ? opts.target : null;
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) {
      if (!target) return null;
      tx = target.x;
      ty = target.y;
    }
    if (this.t < (attacker._shotReadyAt ?? -Infinity)) return null;
    attacker._shotReadyAt = this.t + MIN_SHOT_GAP;
    const k = kind === 'arrow' ? 'arrow' : 'bolt';
    attacker.faceToward?.(tx, ty);
    let ux = tx - attacker.x;
    let uy = ty - attacker.y;
    const d = Math.hypot(ux, uy);
    if (d < 0.001) {
      ux = attacker.facing?.x ?? 0;
      uy = attacker.facing?.y ?? 1;
    } else {
      ux /= d;
      uy /= d;
    }
    const speed = opts.speed ?? (k === 'arrow' ? 230 : 175);
    const p = new Projectile(g, {
      kind: k,
      owner: attacker,
      target,
      x: attacker.x + ux * 7,
      y: attacker.y + uy * 7,
      vx: ux * speed,
      vy: uy * speed,
      damage: this.attackPower(attacker) * (opts.damageMul ?? 1),
      range: opts.range,
    });
    g.entities.add(p);
    const lock = opts.lock ?? 0.25;
    if (lock > 0) {
      attacker.setState(k === 'bolt' ? 'cast' : 'attack', lock);
      attacker.stateTime = 0;
      attacker.animTime = 0;
    }
    if (k === 'bolt') {
      this._sound('bolt', attacker.x, attacker.y);
      this._particles('magic', attacker.x + ux * 8, attacker.y - 12 + uy * 4, { count: 5, color: '#a995ff', speed: 26, life: 0.35 });
      this._flash({ x: attacker.x + ux * 8, y: attacker.y - 12, r: 36, color: '#a995ff', intensity: 0.6, duration: 0.18 });
    } else {
      this._sound('bow', attacker.x, attacker.y);
    }
    g.bus?.emit('attack', { attacker, kind: k, target });
    return p;
  }

  // The damage an attacker deals before modifiers (the player adds their weapon).
  attackPower(a) {
    const p = a?.attackPower;
    return typeof p === 'number' && Number.isFinite(p) ? p : a?.atk ?? 1;
  }

  // ---------------------------------------------------------------- damage

  // opts: { kind, knockback (px/s), crit (bool to force), launch (px/s up), heavy,
  //         dirX, dirY (knockback direction), invuln (seconds), exact (no variance) }
  damage(source, target, amount, opts = {}) {
    const g = this.game;
    if (!target || target.type !== 'actor' || target.removed || !target.isAlive?.()) return 0;
    if (source && source.type === 'projectile') source = source.owner || null;
    if (source && source !== target && source.type === 'actor' && !this.canHarm(source, target, true)) return 0;
    if (target.invuln > 0) return 0;

    const kind = opts.kind || 'melee';
    let crit = opts.crit;
    if (crit == null) crit = !!source && kind !== 'fall' && this.random() < CRIT_CHANCE;
    const variance = opts.exact ? 1 : 0.9 + this.random() * 0.2;
    const raw = Math.max(0, Number(amount) || 0) * variance * (crit ? CRIT_MUL : 1);
    let dealt = Math.max(1, Math.round(raw - (target.def || 0)));
    // Villagers stagger instead of dying; a dead innkeeper would break the village.
    if (dealt >= target.hp && this.isEssential(target) && !this.isDownable(target)) dealt = Math.max(0, target.hp - 1);
    target.hp -= dealt;

    const isPlayer = target === g.player || target.id === PLAYER_ID;
    const isFriend = isPlayer || target === g.companion || target.id === COMPANION_ID;
    target.flash = 1;
    target.invuln = opts.invuln ?? (isPlayer ? 0.55 : isFriend ? 0.35 : 0.12);
    target.lastAttacker = source || null;
    target.lastAttackedAt = g.clock?.t ?? this.t;

    // Knockback away from the source (or along the projectile's path).
    let dx = opts.dirX;
    let dy = opts.dirY;
    if (dx == null || dy == null) {
      dx = source ? target.x - source.x : 0;
      dy = source ? target.y - source.y : 0;
      const l = Math.hypot(dx, dy);
      if (l > 0.001) {
        dx /= l;
        dy /= l;
      } else {
        dx = 0;
        dy = 0;
      }
    }
    const mass = Math.max(0.3, target.mass || 1);
    const kb = opts.knockback || 0;
    if (kb > 0 && target.knock) {
      target.knock.x += (dx * kb) / mass;
      target.knock.y += (dy * kb) / mass;
    }
    if (opts.launch > 0 && !target.flying) this._launch(target, opts.launch / mass);

    // Brief hit-stun (bosses with superArmor shrug it off).
    if (!target.superArmor && target.hp > 0) {
      target.setState('hurt', isPlayer ? 0.16 : 0.22);
      target.stateTime = 0;
      target.animTime = 0;
    }

    if (source && target.species) this._provoke(target, source);
    try {
      target.onHurt?.(source, dealt, kind);
    } catch (err) {
      this._warn('onHurt', err);
    }

    const heavy = !!(opts.heavy || crit || isPlayer || target.hp <= 0);
    if (heavy) g.hitStop = Math.max(g.hitStop || 0, HIT_STOP);
    this._hitFx(target, dealt, crit, kind, dx, dy, isFriend, isPlayer, heavy);

    g.bus?.emit('damage', { source: source || null, target, amount: dealt, kind, crit: !!crit });

    if (target.hp <= 0) {
      if (this.isDownable(target)) this.down(target, source || null);
      else this.kill(target, source || null);
    }
    return dealt;
  }

  _provoke(creature, source) {
    creature.provokedBy = source;
    creature.provokedAt = this.game.clock?.t ?? this.t;
    const fights = FIGHTS_BACK.has(creature.species) || factionRelation(creature.faction, source.faction) === 'hostile';
    creature.provokedMode = fights ? 'fight' : 'flee';
  }

  _launch(e, vz) {
    e.z = Math.max(0, e.z || 0);
    e._vz = Math.max(e._vz || 0, vz);
    this.airborne.add(e);
  }

  _hitFx(target, dealt, crit, kind, dx, dy, isFriend, isPlayer, heavy) {
    const x = target.x;
    const y = target.y - 10 - (target.z || 0);
    const color = HIT_COLORS[target.species] || '#ffffff';
    this._particles('hit', x, y, { count: crit ? 10 : 6, color, dir: { x: dx, y: dy }, spread: 1.1, speed: crit ? 90 : 65, life: 0.35 });
    if (crit) this._particles('spark', x, y, { count: 6, color: '#ffe27a', speed: 70, life: 0.3 });
    const text = crit ? `${dealt}!` : String(dealt);
    this._number(target.x, target.y - 22 - (target.z || 0), text, isFriend ? COLORS.dmgFriend : crit ? COLORS.crit : COLORS.dmg);
    const sound = isFriend ? 'hurt' : kind === 'bolt' ? 'bolt_hit' : 'hit';
    this._sound(sound, target.x, target.y, { pitch: crit ? 1.2 : 0.9 + this.random() * 0.2 });
    if (isPlayer) this._shake(3, 0.22);
    else if (heavy) this._shake(1.5, 0.12);
    if (crit) this._flash({ x, y, r: 30, color: '#ffe27a', intensity: 0.5, duration: 0.12 });
  }

  // ---------------------------------------------------------------- death, knock-outs

  kill(target, killer = null) {
    const g = this.game;
    if (!target || target.dead || target.removed) return false;
    if (killer && killer.type === 'projectile') killer = killer.owner || null;
    if (this.isDownable(target)) {
      this.down(target, killer);
      return false;
    }
    target.hp = 0;
    target.dead = true;
    target.downed = false;
    target.solid = false;
    target.setState?.('dead');
    target.lockTime = 0;
    if (target.moveIntent) {
      target.moveIntent.x = 0;
      target.moveIntent.y = 0;
    }
    target.flash = 1;
    this._beginFade(target);
    this.dying.push({ e: target, t: 0 });
    this._sound('death', target.x, target.y);
    this._particles('hit', target.x, target.y - 8, { count: 10, color: HIT_COLORS[target.species] || '#ffffff', speed: 60, life: 0.45 });
    g.hitStop = Math.max(g.hitStop || 0, HIT_STOP);

    g.bus?.emit('death', { entity: target, killer });
    this._dropLoot(target);
    this._rewardKill(target, killer);
    return true;
  }

  _dropLoot(target) {
    const drops = Array.isArray(target.drops) ? target.drops : [];
    for (const entry of drops) {
      let id;
      let chance;
      let qty;
      if (Array.isArray(entry)) [id, chance, qty] = entry;
      else if (entry && typeof entry === 'object') ({ id, chance, qty } = entry);
      if (!id) continue;
      if (this.random() >= (chance ?? 1)) continue;
      let n = 1;
      if (Array.isArray(qty)) n = Math.round(qty[0] + this.random() * ((qty[1] ?? qty[0]) - qty[0]));
      else if (Number.isFinite(qty)) n = qty;
      if (n <= 0) continue;
      try {
        dropItem(this.game, id, n, target.x, target.y - 2);
      } catch (err) {
        this._warn('dropItem', err);
      }
    }
  }

  _rewardKill(target, killer) {
    const g = this.game;
    const xp = Math.floor(Number(target.xpValue) || 0);
    if (!killer || xp <= 0) return;
    const player = g.player;
    const lyra = g.companion;
    if (killer === player) {
      this._xpPopup(target, xp);
      this.giveXp(player, xp);
      // Lyra learns from fights she stands in, at half the rate.
      if (lyra && lyra.isAlive?.() && lyra.distTo?.(target) < 220) this.giveXp(lyra, Math.max(1, Math.floor(xp / 2)));
    } else if (killer === lyra) {
      this.giveXp(lyra, xp);
      if (player && !player.removed) {
        this._xpPopup(target, xp);
        this.giveXp(player, xp);
      }
    }
  }

  _xpPopup(target, xp) {
    this._number(target.x, target.y - 34, `+${xp} xp`, COLORS.xp);
  }

  // Death fade without touching other modules' draw code: wrap this instance's draw
  // in a global alpha driven by deathAlpha.
  _beginFade(e) {
    e.deathAlpha = 1;
    if (e._fadeWrapped || typeof e.draw !== 'function') return;
    const orig = e.draw;
    e._fadeWrapped = true;
    e.draw = function drawFading(ctx, ox, oy, time) {
      const a = ctx.globalAlpha;
      ctx.globalAlpha = a * Math.max(0, Math.min(1, this.deathAlpha ?? 1));
      try {
        orig.call(this, ctx, ox, oy, time);
      } finally {
        ctx.globalAlpha = a;
      }
    };
  }

  down(target, by = null) {
    const g = this.game;
    if (!target || target.dead || target.downed || target.removed) return false;
    if (by && by.type === 'projectile') by = by.owner || null;
    target.hp = 0;
    target.downed = true;
    target.setState?.('downed');
    target.lockTime = 0;
    if (target.moveIntent) {
      target.moveIntent.x = 0;
      target.moveIntent.y = 0;
    }
    this.downedAt.set(target, this.t);
    this._sound('downed', target.x, target.y);
    this._particles('dust', target.x, target.y, { count: 8, speed: 30, life: 0.5 });
    if (target === g.player) this._shake(4, 0.3);
    g.bus?.emit('downed', { entity: target, by });
    try {
      target.onDowned?.(by);
    } catch (err) {
      this._warn('onDowned', err);
    }
    return true;
  }

  revive(target, by = null, hpFraction = 0.35) {
    const g = this.game;
    if (!target || target.dead || !target.downed || target.removed) return false;
    const f = Math.max(0.01, Math.min(1, Number(hpFraction) || 0.35));
    target.downed = false;
    target.hp = Math.max(1, Math.round(target.maxHp * f));
    target.setState?.('idle');
    target.lockTime = 0;
    target.invuln = Math.max(target.invuln || 0, 1.2);
    this.downedAt.delete(target);
    this._sound('revive', target.x, target.y);
    this._particles('heal', target.x, target.y - 8, { count: 14, color: '#9ff0b8', speed: 30, life: 0.8 });
    this._particles('sparkle', target.x, target.y - 14, { count: 6, color: '#ffe08a', speed: 20, life: 0.7 });
    this._flash({ x: target.x, y: target.y - 10, r: 56, color: '#ffe08a', intensity: 0.7, duration: 0.5 });
    g.bus?.emit('revived', { entity: target, by });
    try {
      target.onRevived?.(by);
    } catch (err) {
      this._warn('onRevived', err);
    }
    return true;
  }

  // ---------------------------------------------------------------- healing, items, xp

  heal(source, target, amount) {
    if (!target || target.dead || target.removed || target.downed) return 0;
    const want = Math.max(0, Math.round(Number(amount) || 0));
    const got = Math.min(want, Math.max(0, target.maxHp - target.hp));
    if (got <= 0) return 0;
    target.hp += got;
    this._number(target.x, target.y - 22, `+${got}`, COLORS.heal);
    this.game.bus?.emit('heal', { source: source || null, target, amount: got });
    return got;
  }

  // Lyra's healing spell. Returns the HP restored.
  castHeal(caster, target) {
    if (!caster || !target || !caster.isAlive?.() || target.dead || target.downed || target.removed) return 0;
    const power = Number.isFinite(caster.healPower) ? caster.healPower : Math.round(10 + (caster.atk || 0) * 1.5 + ((caster.level || 1) - 1) * 2);
    if (target !== caster) caster.faceToward?.(target.x, target.y);
    caster.setState('cast', 0.45);
    caster.stateTime = 0;
    caster.animTime = 0;
    this._particles('magic', caster.x, caster.y - 14, { count: 6, color: '#9ff0b8', speed: 24, life: 0.4 });
    this._particles('heal', target.x, target.y - 10, { count: 16, color: '#58cf8f', speed: 26, life: 0.9 });
    this._flash({ x: target.x, y: target.y - 10, r: 60, color: '#58cf8f', intensity: 0.85, duration: 0.55 });
    this._sound('heal', target.x, target.y);
    return this.heal(caster, target, power);
  }

  // Eat or drink one item from the actor's inventory. Returns true when consumed.
  useItem(actor, itemId) {
    const g = this.game;
    if (!actor || !actor.inventory || actor.dead || actor.downed) return false;
    const def = itemDef(itemId);
    if (!def || !actor.inventory.has(itemId)) return false;
    const consumable = def.type === 'food' || def.type === 'potion' || Number(def.heal) > 0;
    if (!consumable) return false;
    if (def.type === 'potion' && actor.hp >= actor.maxHp) {
      if (actor === g.player) this._toast("You're already in full health. Better save the potion.", 'info');
      return false;
    }
    actor.inventory.remove(itemId, 1);
    const amount = Number(def.heal) || 0;
    if (def.type === 'potion') {
      this._sound('heal', actor.x, actor.y);
      this._particles('heal', actor.x, actor.y - 10, { count: 14, color: '#ff8a8a', speed: 24, life: 0.8 });
      this._particles('sparkle', actor.x, actor.y - 14, { count: 5, color: '#ffffff', speed: 18, life: 0.6 });
      this._flash({ x: actor.x, y: actor.y - 10, r: 44, color: '#ff8a8a', intensity: 0.6, duration: 0.4 });
    } else {
      this._sound('eat', actor.x, actor.y);
      this._particles('heal', actor.x, actor.y - 10, { count: 6, color: '#9ff0b8', speed: 16, life: 0.6 });
    }
    if (amount > 0) this.heal(actor, actor, amount);
    g.bus?.emit('item_used', { actor, itemId });
    return true;
  }

  // Returns how many levels were gained.
  giveXp(actor, amount) {
    const n = Math.floor(Number(amount) || 0);
    if (!actor || n <= 0) return 0;
    actor.xp = (actor.xp || 0) + n;
    actor.level = actor.level || 1;
    let gained = 0;
    while (actor.xp >= xpToNext(actor.level) && gained < 50) {
      actor.xp -= xpToNext(actor.level);
      actor.level += 1;
      actor.maxHp = (actor.maxHp || 1) + LEVEL_HP;
      actor.atk = (actor.atk || 0) + LEVEL_ATK;
      actor.hp = actor.maxHp;
      gained++;
      this._levelUpFx(actor);
      this.game.bus?.emit('level_up', { entity: actor, level: actor.level });
    }
    return gained;
  }

  xpToNext(level) {
    return xpToNext(level);
  }

  _levelUpFx(actor) {
    const g = this.game;
    this._sound('levelup', actor.x, actor.y);
    this._particles('levelup', actor.x, actor.y - 10, { count: 24, color: '#ffe27a', speed: 40, life: 1.1 });
    this._flash({ x: actor.x, y: actor.y - 10, r: 90, color: '#ffe08a', intensity: 0.9, duration: 0.8 });
    this._number(actor.x, actor.y - 34, 'LEVEL UP!', COLORS.level);
    if (actor === g.player) {
      this._toast(`Level ${actor.level}! You feel steadier on your feet. (+${LEVEL_HP} max HP, +${LEVEL_ATK} attack)`, 'good');
    } else if (actor === g.companion) {
      this._toast(`${actor.name || 'Lyra'} reached level ${actor.level}. Her spells burn a little brighter.`, 'lyra');
    }
  }

  // After loading a save, Actor.deserialize restores level but not attack; rebuild it.
  _restoreLevelStats(a) {
    if (!a || a._levelStatsRestored) return;
    a._levelStatsRestored = true;
    const lv = Math.max(1, a.level || 1);
    if (lv > 1 && Number.isFinite(a.atk)) a.atk += (lv - 1) * LEVEL_ATK;
  }

  // ---------------------------------------------------------------- guarded side effects

  _sound(name, x, y, extra) {
    try {
      const opts = { x, y };
      if (extra) Object.assign(opts, extra);
      this.game.audio?.play?.(name, opts);
    } catch (err) {
      this._warn('audio', err);
    }
  }

  _particles(type, x, y, opts) {
    try {
      this.game.particles?.emit?.(type, x, y, opts);
    } catch (err) {
      this._warn('particles', err);
    }
  }

  _number(x, y, text, color) {
    try {
      this.game.bubbles?.number?.(x, y, text, color);
    } catch (err) {
      this._warn('bubbles', err);
    }
  }

  _flash(light) {
    try {
      this.game.lighting?.flash?.(light);
    } catch (err) {
      this._warn('lighting', err);
    }
  }

  _shake(strength, seconds) {
    try {
      this.game.camera?.shake?.(strength, seconds);
    } catch (err) {
      this._warn('camera', err);
    }
  }

  _toast(text, kind) {
    try {
      this.game.ui?.toast?.(text, kind);
    } catch (err) {
      this._warn('toast', err);
    }
  }

  // Warn once per system so a broken effect does not flood the console.
  _warn(what, err) {
    if (this._warned.has(what)) return;
    this._warned.add(what);
    console.warn(`[combat] ${what} failed`, err);
  }
}

// A short label for UIs that offer to use an item ("Eat Bread (+8 HP)"); '' if it is not usable.
export function describeUse(itemId) {
  const def = itemDef(itemId);
  if (!def) return '';
  if (def.type === 'potion') return `Drink ${itemName(itemId)} (+${def.heal} HP)`;
  if (def.type === 'food' || def.heal > 0) return `Eat ${itemName(itemId)} (+${def.heal || 0} HP)`;
  return '';
}
