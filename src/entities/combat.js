import { factionRelation } from './entity.js';
import { PLAYER_ID, COMPANION_ID, DAY_SECONDS } from '../core/constants.js';
import { itemDef, itemName } from './items.js';
import { Projectile } from './projectiles.js';
import { dropItem, updatePickupToasts } from './pickups.js';
import { playHit, playPoof, playHeal, playLevelUp } from '../render/pixel_fx_play.js';
import { canReach } from '../world/walls.js';
import { swingAtProps } from '../world/breakables.js';

// Combat rules for every actor: melee arcs, projectiles, damage, healing, death,
// knock-outs, crimes, items that heal, experience. Contract in DESIGN.md ("Combat", §16.7).
// Every visual/audio side effect goes through a guarded helper so a bug in another
// module can never break a fight.
//
// Who may hurt whom (§16.7): the player's sword hits everyone it touches (the player can
// do wrong); everyone else hits enemies, provokers and the target they chose, and spares
// their own side unless defending themselves from it.

export const CRIT_CHANCE = 0.1;
export const CRIT_MUL = 1.5;
export const HIT_STOP = 0.06;
export const DEATH_FADE = 0.8;
export const SELF_REVIVE_SECONDS = 60;
export const SELF_REVIVE_FRACTION = 0.15;
export const LEVEL_HP = 8;
export const LEVEL_ATK = 1;
// Crimes (§16.7). Times are game seconds on game.clock.t (one per real second).
export const ASSAULT_SECONDS = 90;
export const CRIME_EVENT_GAP = 10; // one 'crime' event per victim and kind in this window
export const SELF_DEFENSE_WINDOW = 60; // how long someone who hurt you stays a fair target
// The characters module gets knocked-out villagers up after 30 s; this is only a safety net.
export const NPC_REVIVE_FALLBACK = 40;
export const NPC_REVIVE_FRACTION = 0.5;
const SHARED_XP_RANGE = 260; // px: kills made this close count as a fight fought together
const PROVOKE_MEMORY = 45; // game seconds a creature stays angry at whoever hurt it
const DEFAULT_MELEE_CD = 0.4;
const MIN_SHOT_GAP = 0.15; // guards against accidental per-frame shooting

// Experience needed to go from `level` to the next one.
// The side an actor fights on: its faction, or its charmer's while a song holds it.
export function sideOf(a) {
  const by = a?.statusFlags?.charmedBy;
  return by && by !== a && !by.removed ? by.faction || 'player' : a?.faction;
}

export function xpToNext(level) {
  const l = Math.max(1, Math.floor(level || 1)) - 1;
  return 20 + l * 18 + l * l * 4;
}

// Factions Lyra (the player's side, but not the player) never hurts unprovoked.
const PLAYER_SIDE_SAFE = new Set(['player', 'villager', 'guard']);
const LAWFUL = new Set(['villager', 'guard']);
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
    this.aggressions = new WeakMap(); // victim -> Map(attacker -> clock time of the last hit)
    this.crimeLog = new Map(); // `${victimId}:${kind}` -> clock time of the last 'crime' event
    this._baseAtk = new WeakMap(); // actor -> attack at level 1 (to rebuild it after a load)
    this._warned = new Set();
    try {
      game.bus?.on?.('entity_added', (p) => {
        const e = p?.entity;
        if (e && (e.id === PLAYER_ID || e.id === COMPANION_ID) && Number.isFinite(e.atk)) {
          this._baseAtk.set(e, e.atk - (Math.max(1, e.level || 1) - 1) * LEVEL_ATK);
        }
      });
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
    this._updateCrime();
    try {
      updatePickupToasts(this.game, dt);
    } catch (err) {
      this._warn('pickup toasts', err);
    }
  }

  // Game time for crimes and grudges (the clock is saved; the combat clock is not).
  now() {
    return this.game.clock?.t ?? this.t;
  }

  // A crime runs out on its own; the guards calm down and the player hears about it.
  _updateCrime() {
    const p = this.game.player;
    const c = p?.crime;
    if (!c || c.until > this.now()) return;
    this.clearCrime(p, 'expired');
  }

  // Wipe the slate: the crime ran out ('expired') or was paid for ('arrested').
  // Emits crime_cleared {actor, reason} so guards and the HUD can stand down.
  clearCrime(actor = this.game.player, reason = 'expired') {
    if (!actor?.crime) return false;
    actor.crime = null;
    if (this.isPlayer(actor) && reason === 'expired' && actor.isAlive?.()) {
      this._toast('The guards have stopped looking for you. Hearthvale breathes out.', 'info', { key: 'crime' });
    }
    this.game.bus?.emit('crime_cleared', { actor, reason });
    return true;
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
      // The pixelfx poof (DESIGN §30) goes off as the fade starts and hides it.
      if (!d.poofed && d.t >= 0.2 && !e.removed && !e.boss && !e.isBoss) d.poofed = !!playPoof(this.game, e);
      if (d.t >= DEATH_FADE || e.removed) {
        list.splice(i, 1);
        if (!e.removed) {
          if (!d.poofed) this._particles('poof', e.x, e.y - 6, { count: 8, color: '#d6d0e0', speed: 22, life: 0.6 });
          this.game.entities?.remove?.(e);
        }
      }
    }
  }

  _updateDowned() {
    const g = this.game;
    // Adopt anyone knocked out outside combat.down (a loaded save, another module), once a second.
    if (this.t >= (this._downScanAt || 0)) {
      this._downScanAt = this.t + 1;
      const list = g.entities?.all?.() || [];
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.type === 'actor' && e.downed && !e.dead && !e.removed && !this.downedAt.has(e)) this.downedAt.set(e, this.t);
      }
    }
    for (const [a, t0] of this.downedAt) {
      if (!a.downed || a.removed || a.dead) {
        this.downedAt.delete(a);
        continue;
      }
      // The player wakes at home (player.js); Lyra gets up alone after a minute; villagers
      // are helped up by their own logic, and this only catches one that was forgotten.
      // Anyone game.survival holds lies with a bleed-out window of their own (§27).
      if (this.isPlayer(a) || g.survival?.owns?.(a)) continue;
      const down = this.t - t0;
      if (this.isCompanion(a) || a.downable === true) {
        if (down >= SELF_REVIVE_SECONDS) this.revive(a, a, SELF_REVIVE_FRACTION);
      } else if (down >= NPC_REVIVE_FALLBACK) {
        this.revive(a, a, NPC_REVIVE_FRACTION);
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

  isPlayer(a) {
    return !!a && (a === this.game.player || a.id === PLAYER_ID);
  }

  isCompanion(a) {
    return !!a && (a === this.game.companion || a.id === COMPANION_ID);
  }

  // A villager or guard: a person of Hearthvale (not an animal, not the player's party).
  isLawful(a) {
    if (!a || a.type !== 'actor' || a.species || this.isPlayer(a) || this.isCompanion(a)) return false;
    return LAWFUL.has(a.faction) || (!!a.profile && a.faction !== 'bandit');
  }

  // Knocked out at 0 HP instead of killed: the player, Lyra, villagers and guards (§16.7),
  // and anything flagged essential or downable.
  isDownable(a) {
    if (!a) return false;
    return this.isPlayer(a) || this.isCompanion(a) || a.downable === true || this.isEssential(a) || this.isLawful(a);
  }

  // Anything with an NPC profile, and actors flagged essential, never die.
  isEssential(a) {
    return !!a && (a.essential === true || !!a.profile);
  }

  // People and pets Lyra never hurts unless they hurt her first: villagers, Pip's cat.
  isProtected(a) {
    return !!a && (this.isEssential(a) || this.isLawful(a) || a.species === 'cat' || a.pet === true || !!a.tags?.has?.('pet'));
  }

  isHostile(a, b) {
    if (!a || !b || a === b) return false;
    // A charmed creature fights for its charmer's side and nobody holds a grudge meanwhile.
    if (a.statusFlags?.charmedBy || b.statusFlags?.charmedBy) return factionRelation(sideOf(a), sideOf(b)) === 'hostile';
    // While the player is wanted, the guard and the player are at war (§16.7).
    if ((a.faction === 'guard' && this.hasCrime(b)) || (b.faction === 'guard' && this.hasCrime(a))) return true;
    if (factionRelation(a.faction, b.faction) === 'hostile') return true;
    return this._provokedAgainst(b, a) || this._provokedAgainst(a, b);
  }

  // Is this actor wanted for a crime right now? (Defaults to the player.)
  hasCrime(actor = this.game.player) {
    const c = actor?.crime;
    return !!c && c.until > this.now();
  }

  // Is `creature` angry at `other` because `other` hurt it recently?
  _provokedAgainst(creature, other) {
    if (creature.provokedBy !== other || creature.provokedMode !== 'fight') return false;
    return this.now() - (creature.provokedAt ?? -Infinity) < PROVOKE_MEMORY;
  }

  // Did `aggressor` hurt `defender` recently enough that striking back is self-defense?
  isSelfDefense(defender, aggressor) {
    const t = this.aggressions.get(defender)?.get(aggressor);
    return t != null && this.now() - t < SELF_DEFENSE_WINDOW;
  }

  _noteAggression(victim, attacker) {
    let m = this.aggressions.get(victim);
    if (!m) this.aggressions.set(victim, (m = new Map()));
    const now = this.now();
    m.set(attacker, now);
    if (m.size > 8) for (const [k, t] of m) if (now - t >= SELF_DEFENSE_WINDOW) m.delete(k);
  }

  // May `attacker` hurt `target`? `explicit` = the attacker chose this target on purpose.
  // - The player hits every actor (friendly fire: Lyra, villagers and guards included).
  // - Anyone may hit those hostile to them (factions, provoked animals, guards vs a wanted player).
  // - Allies, and for Lyra the people of the village and pets, are spared unless they are
  //   the chosen target and hurt the attacker first (self-defense, §16.5).
  // - Neutral creatures are hit when chosen, or when they provoked or were provoked.
  canHarm(attacker, target, explicit = false) {
    if (!target || target === attacker || target.type !== 'actor' || target.removed || target.dead) return false;
    if (!attacker) return true;
    if (this.isPlayer(attacker)) return true;
    // Lyra fighting for her life (§16.6) fights whoever she is fighting, until they fall.
    if (this.isCompanion(attacker) && attacker.behavior?.fightingBack?.(target)) return true;
    if (this.isHostile(attacker, target)) return true;
    const sa = sideOf(attacker);
    const st = sideOf(target);
    const spared =
      factionRelation(sa, st) === 'ally' ||
      (sa === 'player' && (PLAYER_SIDE_SAFE.has(st) || this.isProtected(target)));
    if (spared) return explicit && this.isSelfDefense(attacker, target);
    if (explicit) return true;
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
    if (attacker.statusFlags?.disabled) return false; // frozen, stunned, staggered (magic statuses)
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
      // Walls and closed doors stop the blade (DESIGN §31.1): nobody is hit through a house.
      if (!canReach(g, attacker, e)) continue;
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
    // The player's blade also lands on what stands in the arc: the training dummy, a
    // barrel, a fence (DESIGN §31.3–31.4).
    if (this.isPlayer(attacker)) {
      try {
        this.lastPropHits = swingAtProps(g, attacker, { fx, fy, minCos, range, power, heavy: !!opts.heavy });
      } catch (err) {
        this._warn('props', err);
      }
    }
    return true;
  }

  // Fire a projectile at a point. kind 'bolt' (arcane, glowing, homes a little) or 'arrow'.
  // opts: { damageMul, target, speed, range, lock }
  shoot(attacker, tx, ty, kind = 'bolt', opts = {}) {
    const g = this.game;
    if (!attacker || !attacker.isAlive?.() || !g.entities) return null;
    if (attacker.statusFlags?.disabled) return null;
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
  // Weaves (src/magic) add: damageType / damageTypes [{type, share}] (target.resist or
  // its species' resist scales them), penetration (ignores that much defense), dot (a
  // status tick: lands through i-frames, no stagger, no knockback), quiet (no number or
  // particles; magic pools its own), silent (no sound), noHitStop, noStagger, deliberate,
  // accident (the player's weave caught a friend it was not aimed at: no crime, no claim
  // of self-defense, and the event says so for the mind to weigh).
  damage(source, target, amount, opts = {}) {
    const g = this.game;
    if (!target || target.type !== 'actor' || target.removed || !target.isAlive?.()) return 0;
    if (source && source.type === 'projectile') source = source.owner || null;
    if (source && source !== target && source.type === 'actor' && !this.canHarm(source, target, true)) return 0;
    if (target.invuln > 0 && !opts.dot) return 0;

    const kind = opts.kind || 'melee';
    // The stat pipeline (DESIGN §26, game.stats) when present: crit, dodge, damage dealt
    // and taken (statuses, prices, gear), and an armor floor. Without it, the old rules.
    const S = g.stats && typeof g.stats.get === 'function' ? g.stats : null;
    const st = (a, k, d) => {
      const v = S.get(a, k);
      return Number.isFinite(v) ? v : d;
    };
    const hitter = source && source.type === 'actor' ? source : null;
    if (S && hitter && !opts.dot && kind !== 'fall' && kind !== 'oath') {
      const dodge = st(target, 'dodge', 0);
      if (dodge > 0 && this.random() < dodge) {
        this._dodged(target, hitter);
        return 0;
      }
    }
    let crit = opts.crit;
    if (crit == null) crit = !!source && kind !== 'fall' && !opts.dot && this.random() < (S && hitter ? st(hitter, 'crit', CRIT_CHANCE) : CRIT_CHANCE);
    const critMul = S && hitter ? st(hitter, 'critMul', CRIT_MUL) : CRIT_MUL;
    const variance = opts.exact ? 1 : 0.9 + this.random() * 0.2;
    let mul = 1;
    if (opts.damageTypes || opts.damageType) mul *= this.resistMul(target, opts.damageTypes, opts.damageType);
    if (S) {
      mul *= st(target, 'dmgTaken', 1);
      if (hitter) mul *= st(hitter, 'dmgDealt', 1);
    } else {
      const tf = target.statusFlags;
      if (tf && tf.count) mul *= tf.dmgTaken;
      const sf = hitter ? hitter.statusFlags : null;
      if (sf && sf.count) mul *= sf.dmgDealt;
    }
    const raw = Math.max(0, Number(amount) || 0) * variance * (crit ? critMul : 1) * mul;
    const def = Math.max(0, (target.def || 0) - (opts.penetration || 0));
    const floor = S && Number.isFinite(S.armorFloor) ? raw * S.armorFloor : 0;
    let dealt = Math.max(1, Math.round(Math.max(raw - def, floor)));
    // A ward (a weave, DESIGN §22.5) takes what it can of the blow first.
    const warded = g.magic?.absorb ? Math.round(g.magic.absorb(target, dealt, source, opts) || 0) : 0;
    if (warded > 0) dealt = Math.max(0, dealt - warded);
    target.hp = Math.max(0, target.hp - dealt);

    const isPlayer = this.isPlayer(target);
    const isFriend = isPlayer || this.isCompanion(target);
    const attacker = source && source.type === 'actor' ? source : null;
    const accident = !!opts.accident;
    if (attacker && !accident) this._noteAggression(target, attacker);
    // Hurting a villager or guard is a crime; set it before anyone hears about the hit.
    // (A blow a ward caught was still a blow; an accident is not a crime.)
    let crime = attacker && !accident && this.isPlayer(attacker) && this.isLawful(target) ? (target.hp <= 0 ? 'knockout' : 'assault') : null;
    // Known only to those who could see it (DESIGN §29): a blow nobody saw stays the
    // victim's to tell (game.murder holds it until they do).
    if (crime && g.murder?.screenCrime && !g.murder.screenCrime(attacker, target, crime)) crime = null;
    if (crime) this._recordCrime(attacker, target, crime);
    if (dealt <= 0) return this._wardedBlow(source, attacker, target, kind, warded, opts, crime);
    target.flash = opts.dot ? Math.max(target.flash || 0, 0.55) : 1;
    if (!opts.dot) target.invuln = opts.invuln ?? (isPlayer ? 0.55 : isFriend ? 0.35 : 0.12);
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

    // Hits stun (status ticks never do; berserk's poise holds the player up).
    if (target.hp > 0 && !opts.dot && !(S && st(target, 'poise', 0) >= 1)) this._hitStun(target, source, opts, isPlayer);

    if (source && target.species) this._provoke(target, source);
    try {
      target.onHurt?.(source, dealt, kind);
    } catch (err) {
      this._warn('onHurt', err);
    }

    const heavy = !!(opts.heavy || crit || isPlayer || target.hp <= 0);
    if (heavy && !opts.noHitStop) g.hitStop = Math.max(g.hitStop || 0, HIT_STOP);
    // People (the party, villagers, guards) bleed coral numbers and cry out; creatures thud.
    if (!opts.quiet) this._hitFx(target, dealt, crit, kind, dx, dy, isFriend || this.isLawful(target), isPlayer, heavy && !opts.noHitStop, !!opts.silent, opts);

    const ev = { source: source || null, target, amount: dealt, kind, crit: !!crit };
    if (warded > 0) ev.absorbed = warded;
    if (opts.magic || opts.damageType) {
      ev.damageType = opts.damageType || null;
      ev.magic = true;
      ev.deliberate = !!opts.deliberate;
      if (opts.dot) ev.dot = true;
      if (opts.status) ev.status = opts.status;
    }
    if (accident) ev.accident = true;
    g.bus?.emit('damage', ev);

    if (target.hp <= 0) {
      if (this.isDownable(target)) this.down(target, source || null);
      else this.kill(target, source || null);
    }
    if (crime) this._reportCrime(attacker, target, crime);
    return dealt;
  }

  // Hits stun (DESIGN §31.2). Every blow makes its target flinch: a heartbeat with no step
  // and no swing. A heavy blow (the sword's finisher, a strike's fist, a bomb, a weave
  // charged past half) makes it reel for longer. A beam's ray pins whoever it touches,
  // slowing them to a crawl while it is on them. Bosses and super-armored foes shrug off
  // the flinch, are pinned less and reel for a third as long, and every stun leaves a
  // short immunity behind it, so nobody is held forever. The player keeps the short
  // flinch they always had. Without the Weave's status system: the old brief hurt pose.
  _hitStun(target, source, opts, isPlayer) {
    const status = this.game.magic?.status;
    const tough = !!(target.superArmor || target.boss || target.isBoss);
    const src = source && source.type === 'actor' ? source : null;
    if (opts.pin) {
      status?.apply?.(target, 'pinned', { src, potency: tough ? 0.5 : 1 });
      return;
    }
    if (opts.noStagger) return;
    if (isPlayer || !status?.apply) {
      if (tough) return;
      target.setState('hurt', isPlayer ? 0.16 : 0.22);
      target.stateTime = 0;
      target.animTime = 0;
      return;
    }
    const charge = Math.max(0, Math.min(1, Number(opts.charge) || 0));
    let held = null;
    if (opts.heavy || charge >= 0.5) held = status.apply(target, 'reeling', { src, potency: 1 + charge * 0.5 });
    if (!held && !tough) held = status.apply(target, 'flinch', { src });
    // The pose: held while the stun lasts; a blow inside the immunity only jolts the sprite.
    if (!tough) {
      target.setState('hurt', held ? 0.05 : 0);
      target.stateTime = 0;
      target.animTime = 0;
    }
  }

  // A blow a ward took whole: no wound, no stagger, no number; the shield's own look and
  // sound say it. Everyone still hears that it was struck (damage, amount 0).
  _wardedBlow(source, attacker, target, kind, warded, opts, crime) {
    const g = this.game;
    target.lastAttacker = source || null;
    target.lastAttackedAt = g.clock?.t ?? this.t;
    if (!opts.dot) target.invuln = opts.invuln ?? (this.isPlayer(target) ? 0.3 : 0.12);
    if (attacker && target.species) this._provoke(target, attacker);
    const ev = { source: source || null, target, amount: 0, kind, crit: false, absorbed: warded };
    if (opts.magic || opts.damageType) {
      ev.damageType = opts.damageType || null;
      ev.magic = true;
      ev.deliberate = !!opts.deliberate;
      if (opts.dot) ev.dot = true;
    }
    if (opts.accident) ev.accident = true;
    g.bus?.emit('damage', ev);
    if (crime) this._reportCrime(attacker, target, crime);
    return 0;
  }

  // ---------------------------------------------------------------- crimes (§16.7)

  // Assault: wanted for 90 s. Knocking someone out: wanted for the rest of the day.
  // Repeat offences only ever extend and escalate what is already on record.
  _recordCrime(actor, victim, kind) {
    const now = this.now();
    const level = kind === 'knockout' ? 2 : 1;
    const endOfDay = (Math.floor(now / DAY_SECONDS) + 1) * DAY_SECONDS;
    const until = kind === 'knockout' ? Math.max(endOfDay, now + ASSAULT_SECONDS) : now + ASSAULT_SECONDS;
    const prev = this.hasCrime(actor) ? actor.crime : null;
    const escalated = !prev || level > prev.level;
    if (prev) {
      if (level >= prev.level) {
        prev.level = level;
        prev.kind = kind;
      }
      prev.until = Math.max(prev.until, until);
      prev.victimId = victim.id ?? null;
      prev.t = now;
    } else {
      actor.crime = { level, kind, until, victimId: victim.id ?? null, since: now, t: now };
    }
    // The HUD also reports 'crime' events; the shared key keeps it to one notice.
    if (escalated && this.isPlayer(actor)) this._toast(crimeLine(victim, kind), 'warn', { key: 'crime', title: 'Crime' });
  }

  // Wanted for a crime someone else saw done and told (Lyra, calling the watch on the one
  // who came at her: DESIGN §16.6). Sets it on record; the watch is hostile meanwhile.
  markWanted(actor, victim, kind = 'assault') {
    if (!actor || !victim) return false;
    this._recordCrime(actor, victim, kind);
    return true;
  }

  // One 'crime' event per victim and kind in CRIME_EVENT_GAP seconds, not one per hit.
  _reportCrime(actor, victim, kind) {
    const now = this.now();
    const key = `${victim.id}:${kind}`;
    const last = this.crimeLog.get(key);
    if (last != null && now - last < CRIME_EVENT_GAP && now >= last) return;
    this.crimeLog.set(key, now);
    if (this.crimeLog.size > 64) for (const [k, t] of this.crimeLog) if (now - t >= CRIME_EVENT_GAP) this.crimeLog.delete(k);
    this.game.bus?.emit('crime', { actor, victim, kind });
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

  // Weaves split damage across types; a target resists each by target.resist[type]
  // (or its species' spec.resist), 1 = normal, 0.5 = half, 1.5 = weak to it.
  resistMul(target, types, type) {
    const res = target?.resist || target?.spec?.resist;
    if (!res) return 1;
    if (Array.isArray(types) && types.length) {
      let m = 0;
      for (const t of types) m += (t.share ?? 1 / types.length) * (Number.isFinite(res[t.type]) ? res[t.type] : 1);
      return m;
    }
    return Number.isFinite(res[type]) ? res[type] : 1;
  }

  _hitFx(target, dealt, crit, kind, dx, dy, isFriend, isPlayer, heavy, silent = false, o = null) {
    const x = target.x;
    const y = target.y - 10 - (target.z || 0);
    const color = HIT_COLORS[target.species] || '#ffffff';
    // The hit spark (pixelfx, DESIGN §30), in the weave's colors for a weave; the old
    // streaks only when it could not play. Status ticks keep the small streaks.
    // The Strike's fist is carried by its own punch (played on the weave's impact), so the
    // fist's blow draws no second spark; the wave rolling on after it does.
    const fist = !!(o?.magic && o.heavy && o.weave?.shape === 'strike');
    // A charged weave (hold to charge) lands bigger: its spark and its number grow with it.
    const ck = o?.magic && !o.dot ? Math.max(0, Math.min(1, Number(o.charge) || 0)) : 0;
    const played = fist || (!o?.dot && playHit(this.game, target, { dx, dy, crit, heavy, pal: o?.magic ? o.weave?.palette : null, scale: 1 + 0.6 * ck }));
    if (!played) {
      this._particles('hit', x, y, { count: crit ? 10 : 6, color, dir: { x: dx, y: dy }, spread: 1.1, speed: crit ? 90 : 65, life: 0.35 });
      if (crit) this._particles('spark', x, y, { count: 6, color: '#ffe27a', speed: 70, life: 0.3 });
    }
    const text = crit ? `${dealt}!` : String(dealt);
    this._number(target.x, target.y - 22 - (target.z || 0), text, isFriend ? COLORS.dmgFriend : crit ? COLORS.crit : COLORS.dmg, {
      crit: !!crit,
      kind: crit ? 'crit' : isFriend ? 'hurt' : 'damage',
      scale: ck > 0 ? 1 + 0.2 * ck + (ck >= 0.999 ? 0.3 : 0) : undefined,
    });
    const sound = isFriend ? 'hurt' : kind === 'bolt' || kind === 'magic' ? 'bolt_hit' : 'hit';
    if (!silent) this._sound(sound, target.x, target.y, { pitch: crit ? 1.2 : 0.9 + this.random() * 0.2 });
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
      if (lyra && lyra.isAlive?.() && lyra.distTo?.(target) < SHARED_XP_RANGE) this.giveXp(lyra, Math.max(1, Math.floor(xp / 2)));
    } else if (killer === lyra) {
      this.giveXp(lyra, xp);
      // You share in fights you stand in; not in what she hunts on her own across the map.
      if (player && !player.removed && !player.dead && Math.hypot(player.x - target.x, player.y - target.y) < SHARED_XP_RANGE) {
        this._xpPopup(target, xp);
        this.giveXp(player, xp);
      }
    }
  }

  // A clean miss: Grace, a light cloak, quick boots (DESIGN §26).
  _dodged(target, by) {
    this._number(target.x, target.y - 24, 'dodge', '#bfe6ff', { kind: 'dodge' });
    this._sound('dodge', target.x, target.y, { volume: 0.5, pitch: 1.3 });
    target.invuln = Math.max(target.invuln || 0, this.isPlayer(target) ? 0.25 : 0.1);
    this.game.bus?.emit('dodged', { target, source: by });
  }

  _xpPopup(target, xp) {
    this._number(target.x, target.y - 34, `+${xp} xp`, COLORS.xp, { kind: 'xp' });
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
    // Lastlight (DESIGN §25) holds the wound shut once, before the fall.
    if (this.isPlayer(target) && g.prices?.preventFall?.(target)) return false;
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
    if (by && by !== target) {
      // Helped up by someone: a warm glow worth noticing.
      this._sound('revive', target.x, target.y);
      // Life climbs back up the body in gold (pixelfx, DESIGN §30); the old shimmer only without it.
      if (!playHeal(g, target, 'gold')) {
        this._particles('heal', target.x, target.y - 8, { count: 14, color: '#9ff0b8', speed: 30, life: 0.8 });
        this._particles('sparkle', target.x, target.y - 14, { count: 6, color: '#ffe08a', speed: 20, life: 0.7 });
      }
      this._flash({ x: target.x, y: target.y - 10, r: 56, color: '#ffe08a', intensity: 0.7, duration: 0.5 });
    } else {
      // Getting up alone: dust off, no fanfare.
      this._sound('revive', target.x, target.y, { volume: 0.45, pitch: 0.85 });
      this._particles('dust', target.x, target.y, { count: 6, speed: 18, life: 0.5 });
    }
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
    this._number(target.x, target.y - 22, `+${got}`, COLORS.heal, { kind: 'heal' });
    this.game.bus?.emit('heal', { source: source || null, target, amount: got });
    return got;
  }

  // Lyra's healing spell. Returns the HP restored.
  castHeal(caster, target) {
    if (!caster || !target || !caster.isAlive?.() || target.dead || target.downed || target.removed) return 0;
    if (caster.statusFlags?.disabled) return 0;
    const power = Number.isFinite(caster.healPower) ? caster.healPower : Math.round(10 + (caster.atk || 0) * 1.5 + ((caster.level || 1) - 1) * 2);
    if (target !== caster) caster.faceToward?.(target.x, target.y);
    caster.setState('cast', 0.45);
    caster.stateTime = 0;
    caster.animTime = 0;
    this._particles('magic', caster.x, caster.y - 14, { count: 6, color: '#9ff0b8', speed: 24, life: 0.4 });
    if (!playHeal(this.game, target, 'spell')) this._particles('heal', target.x, target.y - 10, { count: 16, color: '#58cf8f', speed: 26, life: 0.9 });
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
    if (def.type === 'potion' && actor.hp >= actor.maxHp && !def.buff) {
      if (actor === g.player) this._toast("You're already in full health. Better save the potion.", 'info');
      return false;
    }
    actor.inventory.remove(itemId, 1);
    const amount = Number(def.heal) || 0;
    if (def.type === 'potion') {
      this._sound('heal', actor.x, actor.y);
      if (!playHeal(this.game, actor, 'potion')) {
        this._particles('heal', actor.x, actor.y - 10, { count: 14, color: '#ff8a8a', speed: 24, life: 0.8 });
        this._particles('sparkle', actor.x, actor.y - 14, { count: 5, color: '#ffffff', speed: 18, life: 0.6 });
      }
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
      // A managed actor's numbers come from the pipeline: let the level land, then heal.
      if (this.game.stats?.isManaged?.(actor)) {
        this.game.stats.refresh(actor);
        actor.hp = actor.maxHp;
      }
      this.game.bus?.emit('level_up', { entity: actor, level: actor.level });
    }
    return gained;
  }

  xpToNext(level) {
    return xpToNext(level);
  }

  // Experience needed to reach `level` from the one below it (HUD helpers ask this way).
  xpForLevel(level) {
    return xpToNext(Math.max(1, (Math.floor(level) || 2) - 1));
  }

  _levelUpFx(actor) {
    const g = this.game;
    this._sound('levelup', actor.x, actor.y);
    // The pixelfx burst (DESIGN §30) for the party; the old gold spray only when it could not play.
    if (!((actor === g.player || actor === g.companion) && playLevelUp(g, actor))) this._particles('levelup', actor.x, actor.y - 10, { count: 24, color: '#ffe27a', speed: 40, life: 1.1 });
    this._flash({ x: actor.x, y: actor.y - 10, r: 90, color: '#ffe08a', intensity: 0.9, duration: 0.8 });
    // The HUD announces level_up in words; here it is felt: light, sound, a rising banner.
    if (actor === g.player || actor === g.companion) this._number(actor.x, actor.y - 34, 'LEVEL UP!', COLORS.level, { crit: true });
  }

  // After loading a save, Actor.deserialize restores level but not attack; rebuild it
  // from the level-1 attack seen when the actor joined (idempotent if a module restored it).
  _restoreLevelStats(a) {
    if (!a || !Number.isFinite(a.atk)) return;
    const lv = Math.max(1, a.level || 1);
    const base = this._baseAtk.get(a) ?? a.atk;
    a.atk = base + (lv - 1) * LEVEL_ATK;
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

  _number(x, y, text, color, opts) {
    try {
      this.game.bubbles?.number?.(x, y, text, color, opts);
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

  _toast(text, kind, opts) {
    try {
      this.game.ui?.toast?.(text, kind, opts);
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

// What the player is told when they become wanted (or more wanted).
function crimeLine(victim, kind) {
  const who = shortName(victim?.name);
  // Someone saw it, or the hurt one told (combat records a crime only then), but the watch
  // knows only once the news reaches them (DESIGN §29.2, §29.4): the line says so, not that
  // they are already coming.
  if (victim?.faction === 'guard') return `You struck ${who}. Now the guard is after you.`;
  if (kind === 'knockout') return `You knocked ${who} out cold, and word of it is out. Once it reaches the watch, they will hunt you until the day is done.`;
  return `You struck ${who}, and word of it is out. Once it reaches the watch, they will be after you for a while.`;
}

// "Captain Rowan Vale" -> "Rowan", "Garrick "Gale" Hale" -> "Garrick", for short lines.
export function shortName(name) {
  const words = String(name || '')
    .replace(/["'][^"']*["']/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^(captain|sister|brother|old|young|master|mistress|sir|lady)$/i.test(w));
  return words[0] || 'them';
}

// A short label for UIs that offer to use an item ("Eat Bread (+8 HP)"); '' if it is not usable.
export function describeUse(itemId) {
  const def = itemDef(itemId);
  if (!def) return '';
  if (def.type === 'potion') return `Drink ${itemName(itemId)} (+${def.heal} HP)`;
  if (def.type === 'food' || def.heal > 0) return `Eat ${itemName(itemId)} (+${def.heal || 0} HP)`;
  return '';
}
