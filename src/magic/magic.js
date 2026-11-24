import { Body, KIND_UPDATE, segDist } from './bodies.js';
import { compileWeave, validateWeave, normalizeWeave, weaveKey, planStats } from './compile.js';
import { Shapes } from './shapes.js';
import { Essences } from './essences.js';
import { Twists } from './twists.js';
import { StatusSystem, Statuses, REACTIONS } from './status.js';
import { MagicLayer, fallbackFx, collectLights, drawBodies, drawGround } from './draw.js';
import * as BAL from './balance.js';
import { RNG } from '../core/rng.js';
import { TILE } from '../core/constants.js';
import { factionRelation } from '../entities/entity.js';
import { T as TILE_IDS } from '../world/tiles.js';

// The Weave runtime: game.magic (DESIGN §22.2).
//
//   cast(caster, slotOrWeave, aim {x, y, target?}, opts?) -> { ok, reason?, message?, plan }
//       a full quick cast. aim may be omitted (auto-aims at the nearest foe, else ahead).
//       opts: { free (no mana / cooldown), chargeK (0..1) }
//   castStart(caster, slot, aim) -> { ok, reason?, plan, mode: 'tap'|'hold'|'charge' }
//   castHold(caster, aim) -> { mode, t, k (charge 0..1), plan } | null    (call while held)
//   castRelease(caster, aim?) -> { ok, reason?, plan }                   (casts / ends a beam)
//   castCancel(caster)                                                    (drag back to cancel)
//       Held flow for every shape: Start on press, Hold while dragging, Release to cast.
//       'tap' casts on release; 'charge' (charge twist) grows while held and casts on release;
//       'hold' (beam) pours from Start until Release, draining plan.drain mana per second.
//   canCast(slot, caster = player) -> { ok, reason, message, cooldown, cost, plan }
//       reasons: 'empty' 'locked_slot' 'invalid' 'cooldown' 'mana' 'down' 'disabled' 'busy'
//   slots[0..5] (weaves or null), slotCount, essenceSlots, twistSlots, setSlot(i, weave),
//   slotPlan(i), cooldownLeft(i), cooldownFraction(i)
//   mana { cur, max }, addMaxMana(n), restoreMana(n)
//   unlocked { shapes, essences, twists } (Sets), unlock(kind, id, source), isUnlocked(kind, id),
//   unlockSlot(), unlockEssenceSlot(), unlockTwistSlot(), unlockAll() (developer helper)
//   compile(weave) -> plan (validated against unlocks and slot limits), catalog()
//   bodies (live Body list, see bodies.js), status (StatusSystem), statusesOf(actor),
//   applyStatus(target, id, opts), holdOf(caster), serialize(), deserialize(d)
//
// Bus events: spell_cast {caster, weave, plan, slot}, spell_hit {body, target, amount,
// essences, caster, plan}, status_applied {target, status, source, potency, duration},
// reaction {id, name, x, y, target, source}, magic_unlocked {kind, id, source},
// mana_changed {cur, max}, weave_slots {slot, weave} (a slot was set or cleared).
//
// Visual/sound layer (r4/fx): game.magicFx, all optional:
//   onEvent(type, payload, magic)   types: cast spawn launch hit end explode bounce pulse
//       impact armed patch block status reaction familiar dash charge beam_start beam_end
//   update(dt, magic), drawGround(ctx, ox, oy, time, magic), drawBody(ctx, body, ox, oy, time),
//   drawLayer(ctx, ox, oy, time, magic) (replaces drawBody for every body),
//   drawStatuses(ctx, ox, oy, time, magic), getLights(time, magic) -> light[]
// Anything fx leaves out falls back to the plain look in draw.js.

export const STARTER_WEAVE = Object.freeze({ id: 'spark', name: 'Spark', shape: 'bolt', essences: Object.freeze(['raw']), twists: Object.freeze([]) });

const KIND_SETS = { shape: 'shapes', shapes: 'shapes', essence: 'essences', essences: 'essences', twist: 'twists', twists: 'twists' };
const KIND_ONE = { shapes: 'shape', essences: 'essence', twists: 'twist' };
const REGISTRY = { shapes: Shapes, essences: Essences, twists: Twists };
const GRASSY = new Set([TILE_IDS.GRASS, TILE_IDS.TALL_GRASS, TILE_IDS.FOREST, TILE_IDS.FLOWERBED, TILE_IDS.FARMLAND].filter((v) => v != null));
const DEFAULT_MODE = { projectile: 'fly', area: 'burst' };
const TAU = Math.PI * 2;
const ZERO = Object.freeze({ x: 0, y: 0 });
const NUMBER_FLUSH = 0.4;

const isAlive = (a) => !!a && !a.removed && !a.dead && (typeof a.isAlive === 'function' ? a.isAlive() : a.hp > 0);

function makeCtx(rt) {
  const ctx = {
    rt,
    caster: null,
    plan: null,
    cast: null,
    ox: 0,
    oy: 0,
    aimX: 0,
    aimY: 0,
    angle: 0,
    dist: 0,
    count: 1,
    target: null,
    held: false,
    chargeK: 0,
    mover: null,
    _i: 0,
    // Angle of the i-th of n bodies fanned around the aim.
    fan(i, n, spread = 0.3) {
      if (n <= 1) return ctx.angle;
      return ctx.angle + (i - (n - 1) / 2) * spread;
    },
    // Offset of the i-th of n spots: the first at the aim, the rest around it.
    ring(i, n, radius) {
      if (n <= 1 || i === 0) return ZERO;
      const a = ((i - 1) / (n - 1)) * TAU + ctx.angle + Math.PI / 2;
      return { x: Math.cos(a) * radius, y: Math.sin(a) * radius * 0.8 };
    },
    spawn(kind, init) {
      const b = rt.spawn(kind, init || {}, ctx.plan, ctx.cast, ctx._i++, true);
      if (b && kind === 'trail' && init?.follow && ctx.mover) {
        b.dashing = true;
        ctx.mover.trails.push(b);
      }
      return b;
    },
    dash(angle, dist, dur) {
      ctx.mover = rt.dash(ctx.caster, angle, dist, dur);
      return ctx.mover;
    },
  };
  return ctx;
}

export class Magic {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.rng = new RNG(7177);
    this.pool = [];
    this.bodies = [];
    this.cands = [];
    this.shots = [];
    this.status = new StatusSystem(game, this);
    this.unlocked = { shapes: new Set(['bolt']), essences: new Set(['raw']), twists: new Set() };
    this.sources = {};
    this.slotCount = BAL.SLOTS_START;
    this.essenceSlots = BAL.ESSENCE_SLOTS_START;
    this.twistSlots = BAL.TWIST_SLOTS_START;
    this.slots = new Array(BAL.SLOTS_MAX).fill(null);
    this.slots[0] = { ...STARTER_WEAVE, essences: ['raw'], twists: [] };
    this.cooldowns = new Array(BAL.SLOTS_MAX).fill(0);
    this.cooldownTotals = new Array(BAL.SLOTS_MAX).fill(0);
    this.weaveReady = new Map(); // weave key -> magic time it is ready again (casts not from a slot)
    this.manaBonus = 0;
    this.mana = { cur: BAL.MANA_START, max: BAL.MANA_START };
    this._manaShown = -1;
    this._regenWait = 0;
    this.holds = new Map();
    this.pending = [];
    this.movers = [];
    this.decals = [];
    this._decalT = 0;
    this._puddleT = 0;
    this._uid = 0;
    this._castSeq = 0;
    this._emitted = [];
    this._emitMul = 1;
    this._ctx = makeCtx(this);
    this._planCache = new Map();
    this._numbers = new Map(); // actor -> { dmg, heal, color, t } (pooled tick and leech numbers)
    this._numberT = 0;
    this._aim = { x: 0, y: 0 };
    this._hitInfo = { dealt: 0, x: 0, y: 0, target: null, tick: false };
    this._dmg = {};
    this._warned = new Set();
    this.capped = 0;
    this.layer = new MagicLayer(this);
    this.registry = { shapes: Shapes, essences: Essences, twists: Twists, statuses: Statuses, reactions: REACTIONS };
    try {
      game.bus?.on?.('level_up', (p) => {
        if (p?.entity && p.entity === game.player) this._recomputeMax();
      });
    } catch {
      /* the bus is optional in tests */
    }
  }

  // ================================================================ state helpers

  random() {
    return this.rng.next();
  }

  warn(what, err) {
    if (this._warned.has(what)) return;
    this._warned.add(what);
    console.warn(`[magic] ${what} failed`, err);
  }

  fx(type, payload) {
    // A reaction's name is gameplay feedback: it shows whatever the fx layer does.
    if (type === 'reaction') this._reactionText(payload);
    const fx = this.game.magicFx;
    if (fx && typeof fx.onEvent === 'function') {
      try {
        fx.onEvent(type, payload, this);
      } catch (err) {
        this.warn(`fx ${type}`, err);
      }
      return;
    }
    try {
      fallbackFx(this, type, payload);
    } catch (err) {
      this.warn(`fallback fx ${type}`, err);
    }
  }

  // "Freeze!" over the target: once per reaction per second, never two piled up.
  _reactionText(p) {
    const list = this._reactTexts || (this._reactTexts = []);
    const now = this.t;
    for (let i = list.length - 1; i >= 0; i--) if (now - list[i].t > 1) list.splice(i, 1);
    let near = 0;
    for (const r of list) {
      if (r.id === p.id) return;
      if (now - r.t < 0.6 && Math.abs(r.x - p.x) < 60 && Math.abs(r.y - p.y) < 40) near++;
    }
    if (near >= 2) return;
    list.push({ id: p.id, x: p.x, y: p.y, t: now });
    try {
      const r = p.reaction;
      this.game.bubbles?.number?.(p.x, p.y - 30 - near * 11, `${r?.name || p.id}!`, r?.color || '#ffffff', { kind: 'crit', crit: true });
    } catch {
      /* cosmetic */
    }
  }

  isPlayer(a) {
    return !!a && (a === this.game.player || a.id === 'player');
  }

  // Lyra, villagers, guards, pets and anyone on the player's side (or charmed to it).
  isFriendOfPlayer(a) {
    const g = this.game;
    if (!a) return false;
    if (a === g.companion || a.id === 'lyra' || this.isPlayer(a)) return true;
    const c = g.combat;
    try {
      if (c?.isLawful?.(a) || c?.isProtected?.(a)) return true;
    } catch {
      /* fall through */
    }
    if (a.statusFlags?.charmedBy && this.isPlayer(a.statusFlags.charmedBy)) return true;
    return factionRelation('player', a.faction) === 'ally';
  }

  // May this cast's bodies touch `a`? (DESIGN §22.1 rules of harm.) A player's weave
  // spares friends unless the player aimed it at a friend on purpose (cast.friendly);
  // anyone else follows combat.canHarm.
  canAffect(cast, a) {
    if (!a || a.type !== 'actor' || a.removed || a.dead) return false;
    const caster = cast?.caster || null;
    if (a === caster) return false;
    if (this.isPlayer(caster)) {
      if (this.isFriendOfPlayer(a)) return !!cast.friendly;
      return true;
    }
    const c = this.game.combat;
    if (c?.canHarm) {
      try {
        return !!c.canHarm(caster, a, a === cast?.target);
      } catch {
        return false;
      }
    }
    return !caster || factionRelation(caster.faction, a.faction) === 'hostile';
  }

  // A real foe (for homing, chains and familiars): something the cast may touch that is
  // hostile to the caster, provoked it, or was the aimed target.
  isFoe(cast, a) {
    if (!this.canAffect(cast, a)) return false;
    if (a === cast?.target) return true;
    const caster = cast?.caster;
    if (!caster) return true;
    if (a.provokedBy === caster) return true;
    try {
      if (this.game.combat?.isHostile) return !!this.game.combat.isHostile(caster, a);
    } catch {
      /* fall through */
    }
    return factionRelation(caster.faction, a.faction) === 'hostile';
  }

  // Someone `src` may hurt with a reaction or spread (never its friends, never on purpose).
  _harmableBy(src, a) {
    if (!a || a === src || a.type !== 'actor' || !isAlive(a)) return false;
    if (!src) return !this.isFriendOfPlayer(a);
    if (this.isPlayer(src) || src.faction === 'player') {
      if (this.isFriendOfPlayer(a)) return false;
      return true;
    }
    const c = this.game.combat;
    try {
      if (c?.canHarm) return !!c.canHarm(src, a, false);
    } catch {
      return false;
    }
    return factionRelation(src.faction, a.faction) === 'hostile';
  }

  nearestFoe(b, x, y, r, exclude, skipHitsOf) {
    const list = this._ensureCands();
    let best = null;
    let bd = r * r;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const dx = a.x - x;
      const dy = a.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > bd) continue;
      if (exclude && exclude.includes(a)) continue;
      if (skipHitsOf && skipHitsOf.hits.has(a)) continue;
      if (!isAlive(a) || !this.isFoe(b.cast, a)) continue;
      best = a;
      bd = d2;
    }
    return best;
  }

  wallAt(x, y) {
    const g = this.game;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    try {
      if (g.map?.blocksProjectile?.(tx, ty)) return true;
      const door = g.objects?.doorAt?.(tx, ty);
      if (door && !door.isOpen && !door.state?.open) return true;
    } catch {
      return false;
    }
    return false;
  }

  groundAt(x, y) {
    const m = this.game.map;
    if (!m) return 'any';
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    try {
      if (m.isWater?.(tx, ty)) return 'water';
      const id = m.tileAt?.(tx, ty);
      if (GRASSY.has(id)) return 'grass';
    } catch {
      return 'any';
    }
    return 'stone';
  }

  pushActor(a, dx, dy) {
    const e = this.game.entities;
    if (e?.moveActor) e.moveActor(a, dx, dy);
    else {
      a.x += dx;
      a.y += dy;
    }
  }

  aimOf(cast) {
    const out = this._aim;
    const t = cast?.target;
    if (t && isAlive(t) && cast.trackTarget) {
      out.x = t.x;
      out.y = t.y;
    } else {
      out.x = cast?.aimX ?? 0;
      out.y = cast?.aimY ?? 0;
    }
    return out;
  }

  // ================================================================ bodies

  spawn(kind, init, plan, cast, index = 0, emitting = false) {
    if (!plan || !plan.ok) return null;
    if (!KIND_UPDATE[kind]) kind = 'projectile';
    if (this.bodies.length >= BAL.BODY_CAP || (cast && cast.live >= BAL.PER_CAST_CAP)) {
      this.capped++;
      return null;
    }
    const b = this.pool.pop() || new Body();
    b.reset();
    b.active = true;
    b.uid = ++this._uid;
    b.kind = kind;
    b.mode = init.mode || DEFAULT_MODE[kind] || '';
    b.plan = plan;
    b.cast = cast;
    const o = cast?.caster || null;
    b.owner = o;
    b.gen = plan.gen;
    b.essences = plan.essences;
    b.palette = plan.palette;
    b.index = index;
    b.seed = this.rng.next();
    const k = emitting ? cast?.chargeK || 0 : 0;
    const sizeK = 1 + 0.45 * k;
    b.dmg = Number.isFinite(init.dmg) ? init.dmg : plan.dmg * (emitting ? this._emitMul : 1) * (1 + 1.6 * k);
    b.x = Number.isFinite(init.x) ? init.x : o ? o.x : 0;
    b.y = Number.isFinite(init.y) ? init.y : o ? o.y : 0;
    b.bx = b.x;
    b.by = b.y;
    b.ox = b.x;
    b.oy = b.y;
    b.angle = Number.isFinite(init.angle) ? init.angle : cast?.angle ?? 0;
    b.speed = (Number.isFinite(init.speed) ? init.speed : plan.speed) * (1 + 0.25 * k);
    b.vx = Math.cos(b.angle) * b.speed;
    b.vy = Math.sin(b.angle) * b.speed;
    b.r = (Number.isFinite(init.r) ? init.r : plan.radius) * sizeK;
    b.life = Number.isFinite(init.life) ? init.life : plan.life;
    b.range = Number.isFinite(init.range) ? init.range : 0;
    b.delay = Number.isFinite(init.delay) ? init.delay : 0;
    b.pierceLeft = Number.isFinite(init.pierce) ? init.pierce : plan.pierce;
    b.bounceLeft = Number.isFinite(init.bounce) ? init.bounce : plan.bounce;
    b.homing = Number.isFinite(init.homing) ? init.homing : plan.homing;
    if (init.target) b.target = init.target;
    else if (b.homing > 0 && cast?.target && this.isFoe(cast, cast.target)) b.target = cast.target;
    b.r0 = (init.r0 ?? 0) * sizeK;
    b.r1 = (init.r1 ?? 0) * sizeK;
    b.cur = b.r0;
    b.arc = init.arc ?? 0.6;
    b.follow = !!init.follow;
    b.held = !!init.held;
    b.aimOffset = init.aimOffset ?? 0;
    b.tick = init.tick ?? 0.5;
    b.z = init.z ?? 0;
    switch (kind) {
      case 'projectile':
        if (b.mode === 'lob') {
          b.tx = init.tx ?? b.x;
          b.ty = init.ty ?? b.y;
          const d = Math.hypot(b.tx - b.x, b.ty - b.y);
          b.flight = Math.max(0.28, Math.min(1.4, d / Math.max(40, b.speed)));
          b.peak = 14 + d * 0.22;
          b.burstR = (init.burstR ?? plan.radius) * sizeK;
          b.tickT = 0;
          b.z = 6;
          b.life = Math.max(b.life, b.flight + 0.5);
          b.angle = Math.atan2(b.ty - b.y, b.tx - b.x);
        } else if (b.mode === 'fall') {
          b.vz = init.vz ?? 300;
          b.r1 = init.r1 ?? 8;
        } else {
          b.z = init.z ?? (b.mode === 'arc' ? 6 : 8);
          if (b.range > 0 && b.speed > 0) b.life = Math.max(b.life, b.range / b.speed + 0.05);
          if (b.mode === 'orb') {
            b.pulseR = (init.pulseR ?? b.r * 2.6) * (emitting ? 1 : 1);
            b.tickT = 0.1;
          }
        }
        break;
      case 'area':
        if (b.mode === 'patch') {
          b.tickT = 0.05;
          b.tickMul = init.tickMul ?? 0.3;
        } else if (b.mode === 'rain') {
          b.drops = Math.max(1, Math.round(init.drops ?? 10));
          b.dropR = init.dropR ?? 8;
          b.tickT = 0;
        }
        break;
      case 'beam':
        b.tx = b.angle;
        b.tickT = 0;
        b.range = init.range ?? plan.range;
        b.pts[0] = b.x;
        b.pts[1] = b.y;
        b.pts[2] = b.x + Math.cos(b.angle) * 4;
        b.pts[3] = b.y + Math.sin(b.angle) * 4;
        b.npts = 2;
        break;
      case 'summon': {
        b.aggro = init.aggro ?? plan.range;
        b.atkCd = init.atkCd ?? 1;
        b.atkT = 0.45;
        b.slot = init.slot ?? index;
        const atk = plan.familiar?.attack;
        b.atkRange = atk === 'slam' ? 18 : atk === 'zap' ? 80 : 70;
        b.z = 8;
        this._limit(o, 'summon', BAL.FAMILIARS_PER_CASTER);
        break;
      }
      case 'rune':
        b.armT = init.arm ?? 0.6;
        b.trigR = init.triggerR ?? 14;
        b.burstR = (init.burstR ?? plan.radius) * sizeK;
        this._limit(o, 'rune', BAL.RUNES_PER_CASTER);
        break;
      case 'wall':
        b.len = (init.len ?? 50) * sizeK;
        this._limit(o, 'wall', BAL.WALLS_PER_CASTER);
        break;
      case 'trail':
        b.x2 = init.x2 ?? b.x;
        b.y2 = init.y2 ?? b.y;
        break;
      default:
        break;
    }
    this.bodies.push(b);
    if (cast) {
      cast.live++;
      cast.total++;
    }
    if (emitting) this._emitted.push(b);
    const hooks = plan.hooks.onSpawn;
    for (let i = 0; i < hooks.length; i++) {
      try {
        hooks[i](b, this);
      } catch (err) {
        this.warn('onSpawn', err);
      }
    }
    this.fx('spawn', { body: b });
    return b;
  }

  // Keep at most `max` live bodies of a kind per caster: the oldest is dismissed.
  _limit(owner, kind, max) {
    if (!owner) return;
    let n = 0;
    let oldest = null;
    for (const b of this.bodies) {
      if (!b.active || b.kind !== kind || b.owner !== owner || b.ending) continue;
      n++;
      if (!oldest || b.uid < oldest.uid) oldest = b;
    }
    if (n >= max && oldest) this.end(oldest, 'dismiss');
  }

  // A twist's child: the weave minus that twist, one generation on (twistId null: the
  // same weave one generation on, for continuations like a chain's next arc).
  spawnChild(parent, twistId, kind, init) {
    if (!parent?.plan || parent.plan.gen >= BAL.MAX_GEN) return null;
    const plan = parent.plan.child(twistId);
    if (!plan || !plan.ok) return null;
    if (!Number.isFinite(init.dmg)) init.dmg = parent.dmg;
    return this.spawn(kind, init, plan, parent.cast, parent.index);
  }

  // A body made by another body with a given plan (rain drops, familiar shots).
  spawnFrom(parent, plan, kind, init) {
    if (!Number.isFinite(init.dmg)) init.dmg = parent.dmg;
    return this.spawn(kind, init, plan || parent.plan, parent.cast, parent.index);
  }

  // An explosion. why 'burst' is the burst twist (its child plan); anything else is the
  // shape's own payload ('land', 'trigger', 'slam') and keeps the body's plan.
  explode(b, x, y, r, mul = 1, why = 'burst', heavy = false) {
    let plan = b.plan;
    if (why === 'burst') {
      if (b.plan.gen >= BAL.MAX_GEN) return null;
      plan = b.plan.child('burst');
    }
    const e = this.spawn('area', { mode: 'burst', x, y, r0: r * 0.35, r1: r, life: 0.32, dmg: b.dmg * mul }, plan, b.cast, b.index);
    if (!e) return null;
    e.r0 = r * 0.35;
    e.r1 = r;
    e.heavy = !!heavy;
    e.payload = why !== 'burst';
    this.fx('explode', { body: e, x, y, r, why, source: b });
    this.mark(b, x, y, r * 0.7, 1);
    return e;
  }

  // A lingering ground patch (the linger twist).
  patch(b, x, y, r, twistId = 'linger') {
    if (b.plan.gen >= BAL.MAX_GEN) return null;
    const plan = b.plan.child(twistId);
    const p = this.spawn('area', { mode: 'patch', x, y, r0: r * 0.4, r1: r, life: 3.2, tick: 0.5, tickMul: 0.32, dmg: b.dmg }, plan, b.cast, b.index);
    if (p) {
      p.r0 = r * 0.4;
      p.r1 = r;
      this.fx('patch', { body: p });
    }
    return p;
  }

  end(b, why = 'expire') {
    if (!b || !b.active || b.ending) return;
    b.ending = true;
    b.why = why;
    const hooks = b.plan.hooks.onEnd;
    for (let i = 0; i < hooks.length; i++) {
      try {
        hooks[i](b, this, why);
      } catch (err) {
        this.warn('onEnd', err);
      }
    }
    // Areas with bounce ripple back once more, smaller.
    if (b.kind === 'area' && b.bounceLeft > 0 && (b.mode === 'ring' || b.mode === 'cone' || b.mode === 'burst') && why === 'expire') {
      const r = this.spawn(
        'area',
        { mode: b.mode, x: b.x, y: b.y, angle: b.angle, r0: b.r0 * 0.6, r1: b.r1 * 0.72, arc: b.arc, life: Math.max(0.2, b.life * 0.85), delay: 0.08, dmg: b.dmg * 0.6, bounce: b.bounceLeft - 1, follow: b.follow },
        b.plan,
        b.cast,
        b.index,
      );
      if (r) {
        r.r0 = b.r0 * 0.6;
        r.r1 = b.r1 * 0.72;
        r.heavy = b.heavy;
      }
    }
    if (b.kind === 'projectile' && (b.mode === 'fly' || b.mode === 'arc') && (why === 'hit' || why === 'wall')) this.mark(b, b.x, b.y, 5, 0.35);
    if (b.kind === 'beam' && b.held) this.fx('beam_end', { body: b });
    this.fx('end', { body: b, why });
    b.active = false;
    if (b.cast) b.cast.live--;
  }

  // ================================================================ hits

  hit(b, target, mul = 1, flags = {}) {
    const g = this.game;
    const plan = b.plan;
    const cast = b.cast;
    const caster = b.owner;
    const amount = b.dmg * mul;
    if (!(amount > 0)) return 0;
    let dx;
    let dy;
    if (b.kind === 'projectile' && (b.mode === 'fly' || b.mode === 'orb' || b.mode === 'arc') && (b.vx || b.vy)) {
      const l = Math.hypot(b.vx, b.vy);
      dx = b.vx / l;
      dy = b.vy / l;
    } else if (b.kind === 'beam' || b.kind === 'strike') {
      dx = Math.cos(b.angle);
      dy = Math.sin(b.angle);
    } else {
      dx = target.x - b.x;
      dy = target.y - b.y;
      const l = Math.hypot(dx, dy);
      if (l > 0.01) {
        dx /= l;
        dy /= l;
      } else {
        dx = Math.cos(b.angle);
        dy = Math.sin(b.angle);
      }
    }
    const party = target === g.player || target === g.companion || target.id === 'player' || target.id === 'lyra';
    const tick = !!flags.tick;
    const pooled = tick || !!flags.pool; // many small hits: one summed number every so often
    const o = this._dmg;
    o.kind = 'magic';
    o.damageType = plan.damageType;
    o.damageTypes = plan.dmgTypes;
    o.knockback = tick ? 0 : (b.kind === 'beam' ? 0 : 70) * plan.knock * (flags.knock ?? 1);
    o.launch = tick || !plan.launch ? 0 : plan.launch;
    o.dirX = dx;
    o.dirY = dy;
    o.heavy = !!flags.heavy;
    o.noHitStop = !flags.heavy;
    o.noStagger = tick;
    o.quiet = pooled;
    o.silent = !!(g.magicFx?.sfx || g.magicSfx);
    o.crit = tick ? false : undefined;
    o.invuln = party ? undefined : 0;
    o.penetration = plan.penetration;
    o.deliberate = !!(cast && cast.friendly && cast.target === target);
    o.weave = plan;
    o.essences = plan.essences;
    o.magic = true;
    let dealt = 0;
    try {
      dealt = g.combat?.damage ? g.combat.damage(caster || null, target, amount, o) || 0 : this._rawDamage(target, amount);
    } catch (err) {
      this.warn('combat.damage', err);
    }
    if (!(dealt > 0)) return 0;
    if (pooled) this._number(target, dealt, plan.palette.glow);
    const info = this._hitInfo;
    info.dealt = dealt;
    info.x = target.x;
    info.y = target.y;
    info.target = target;
    info.tick = tick;
    if (!target.removed && !target.dead) {
      this.status.react(target, plan.tags, { src: caster, power: amount });
      const sts = plan.statuses;
      for (let i = 0; i < sts.length && !target.dead; i++) {
        const st = sts[i];
        this.status.apply(target, st.id, { src: caster, potency: st.potency * (tick ? 0.7 : 1), power: amount, chance: st.chance * (tick ? 0.45 : 1) });
      }
    }
    const hooks = plan.hooks.onHit;
    for (let i = 0; i < hooks.length && b.active; i++) {
      try {
        hooks[i](b, target, this, info);
      } catch (err) {
        this.warn('onHit', err);
      }
    }
    if (b.carry && b.active) {
      const t = Twists.get(b.carry);
      if (t?.onHit && !plan.twists.includes(b.carry)) {
        try {
          t.onHit(b, target, this, info);
        } catch (err) {
          this.warn('carry onHit', err);
        }
      }
    }
    g.bus?.emit('spell_hit', { body: b, target, amount: dealt, essences: plan.essences, caster, plan, tick });
    this.fx('hit', { body: b, target, x: target.x, y: target.y, amount: dealt, tick });
    return dealt;
  }

  // Without a combat module (tests of the runtime alone): plain hp loss.
  _rawDamage(target, amount) {
    const d = Math.max(1, Math.round(amount));
    target.hp = Math.max(0, (target.hp ?? 0) - d);
    if (target.hp <= 0) target.dead = true;
    return d;
  }

  // Status ticks (burning, poison…): through combat so kills and crimes are credited.
  statusDamage(src, target, amount, type, extra) {
    if (!(amount > 0) || !target || target.dead || target.removed) return 0;
    const g = this.game;
    const party = target === g.player || target === g.companion;
    const o = {
      kind: 'magic',
      damageType: type,
      dot: true,
      quiet: true,
      exact: true,
      crit: false,
      knockback: 0,
      noHitStop: true,
      noStagger: true,
      silent: true,
      invuln: party ? 0.05 : 0,
      status: extra?.status,
      magic: true,
    };
    let dealt = 0;
    try {
      dealt = g.combat?.damage ? g.combat.damage(src || null, target, amount, o) || 0 : this._rawDamage(target, amount);
    } catch (err) {
      this.warn('status damage', err);
    }
    if (dealt > 0) this._number(target, dealt, Statuses.get(extra?.status)?.color || '#f4ead7');
    return dealt;
  }

  // Reaction bursts and spreads: hurt (and mark) foes of `src` near a point.
  reactionArea(src, x, y, r, amount, opts = {}) {
    const g = this.game;
    const list = this._ensureCands();
    let n = 0;
    const max = opts.max ?? 99;
    for (let i = 0; i < list.length && n < max; i++) {
      const a = list[i];
      if (a === opts.exclude) continue;
      const rr = r + (a.radius ?? 5);
      const dx = a.x - x;
      const dy = a.y - y;
      if (dx * dx + dy * dy > rr * rr) continue;
      if (!this._harmableBy(src, a)) continue;
      n++;
      if (amount > 0) {
        const l = Math.hypot(dx, dy) || 1;
        try {
          g.combat?.damage
            ? g.combat.damage(src || null, a, amount, { kind: 'magic', damageType: opts.type, knockback: opts.knock ?? 40, dirX: dx / l, dirY: dy / l, noHitStop: true, invuln: a === g.player || a === g.companion ? undefined : 0, magic: true, reaction: true })
            : this._rawDamage(a, amount);
        } catch (err) {
          this.warn('reaction damage', err);
        }
      }
      if (opts.status && !a.dead) this.status.apply(a, opts.status, { src, potency: opts.potency ?? 0.8, power: amount });
      if (opts.link) this.fx('link', { from: opts.link, to: a, color: Statuses.get(opts.status)?.color });
    }
    return n;
  }

  healFriends(src, x, y, r, amount) {
    const list = this._ensureCands();
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (Math.hypot(a.x - x, a.y - y) > r + (a.radius ?? 5)) continue;
      const friend = src ? a === src || (this.isPlayer(src) ? this.isFriendOfPlayer(a) : factionRelation(src.faction, a.faction) === 'ally') : false;
      if (friend) this.heal(a, amount, null);
    }
  }

  // Leech and drain heals, pooled into one number every so often.
  heal(actor, amount, body) {
    if (!actor || !(amount > 0) || actor.dead || actor.removed || actor.downed) return 0;
    const max = actor.maxHp || 0;
    const want = Math.min(amount, Math.max(0, max - actor.hp));
    if (want <= 0) return 0;
    let rec = this._numbers.get(actor);
    if (!rec) this._numbers.set(actor, (rec = { dmg: 0, heal: 0, color: '#58cf8f', t: 0 }));
    rec.heal += want;
    return want;
  }

  _number(actor, amount, color) {
    let rec = this._numbers.get(actor);
    if (!rec) this._numbers.set(actor, (rec = { dmg: 0, heal: 0, color, t: 0 }));
    rec.dmg += amount;
    rec.color = color || rec.color;
  }

  _flushNumbers() {
    const g = this.game;
    for (const [a, rec] of this._numbers) {
      if (rec.dmg >= 1) {
        try {
          g.bubbles?.number?.(a.x, a.y - 20, String(Math.round(rec.dmg)), rec.color, { kind: 'dot' });
        } catch {
          /* cosmetic */
        }
      }
      if (rec.heal >= 0.5 && !a.dead && !a.removed) {
        try {
          if (g.combat?.heal) g.combat.heal(a, a, Math.max(1, Math.round(rec.heal)));
          else a.hp = Math.min(a.maxHp, a.hp + rec.heal);
        } catch (err) {
          this.warn('heal', err);
        }
      }
    }
    this._numbers.clear();
  }

  familiarAttack(b, t) {
    const plan = b.plan;
    const atk = plan.familiar?.attack || 'bolt';
    this.fx('familiar', { body: b, target: t, attack: atk });
    if (atk === 'slam') {
      this.explode(b, b.x, b.y, 22 * Math.min(1.8, plan.size), 1, 'slam', true);
      return;
    }
    const ap = plan.attackPlan();
    if (!ap?.ok) return;
    if (atk === 'zap') {
      this.spawnFrom(b, ap, 'projectile', { mode: 'arc', x: b.x, y: b.y, target: t, speed: 600, r: 2, dmg: b.dmg, life: 0.5, range: 220, homing: 60 });
      return;
    }
    const a = Math.atan2(t.y - b.y, t.x - b.x);
    this.spawnFrom(b, ap, 'projectile', { mode: 'fly', x: b.x, y: b.y, angle: a, speed: 210 * ap.speedMul, r: 2.5 * Math.min(1.6, plan.size), dmg: b.dmg, life: 0.9, range: 170, target: t, homing: Math.max(1.5, ap.homing) });
  }

  // Walls stop foes' arrows and bolts (entities) and their weaves (bodies).
  blockShots(w) {
    const shots = this.shots;
    const g = this.game;
    for (let i = 0; i < shots.length; i++) {
      const p = shots[i];
      if (p.removed || p.state !== 'fly') continue;
      if (segDist(p.x, p.y, w.ox, w.oy, w.x2, w.y2) > w.r + 3) continue;
      if (!p.owner || !this._harmableBy(w.owner, p.owner)) continue;
      p.state = 'spent';
      p.stateT = 0;
      g.entities?.remove?.(p);
      this.fx('block', { body: w, x: p.x, y: p.y });
    }
    const list = this.bodies;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o.active || o.ending || o.kind !== 'projectile' || o.owner === w.owner || o.mode === 'lob' || o.mode === 'fall') continue;
      if (!o.owner || !this._harmableBy(w.owner, o.owner)) continue;
      if (segDist(o.x, o.y, w.ox, w.oy, w.x2, w.y2) > w.r + o.r) continue;
      this.fx('block', { body: w, x: o.x, y: o.y });
      this.end(o, 'wall');
    }
  }

  // Dash: move the caster along `angle` (stopping at walls) with i-frames.
  dash(caster, angle, dist, dur) {
    if (!caster || caster.removed) return null;
    const e = this.game.entities;
    let d = 0;
    const step = 4;
    const cx = Math.cos(angle);
    const cy = Math.sin(angle);
    while (d + step <= dist) {
      const nx = caster.x + cx * (d + step);
      const ny = caster.y + cy * (d + step);
      if (e?.blockedAt && e.blockedAt(caster, nx, ny)) break;
      d += step;
    }
    const t = Math.max(0.06, dur * (d / Math.max(1, dist)));
    const m = { actor: caster, vx: (cx * d) / t, vy: (cy * d) / t, t, trails: [] };
    caster.invuln = Math.max(caster.invuln || 0, t + 0.18);
    caster.lockTime = Math.max(caster.lockTime || 0, t);
    if (caster.vel) {
      caster.vel.x = 0;
      caster.vel.y = 0;
    }
    caster.faceToward?.(caster.x + cx, caster.y + cy);
    this.movers.push(m);
    this.fx('dash', { caster, angle, dist: d, dur: t });
    return m;
  }

  // Terrain touches: scorch on grass, puddles, rime, blooms… (decals; puddles soak).
  mark(b, x, y, r, chance = 1) {
    const plan = b.plan;
    if (!plan.terrain.length || this.t - this._decalT < 0.04) return;
    if (chance < 1 && this.rng.next() > chance) return;
    const ground = this.groundAt(x, y);
    for (const t of plan.terrain) {
      if (t.on !== 'any' && t.on !== ground) continue;
      this._decalT = this.t;
      let d;
      if (this.decals.length >= BAL.MAX_DECALS) {
        d = this.decals.shift();
      } else d = {};
      const ess = Essences.get(t.essence);
      d.x = x;
      d.y = y;
      d.r = Math.max(4, r);
      d.mark = t.mark;
      d.status = t.status || null;
      d.palette = ess?.palette || plan.palette;
      d.t = 0;
      d.life = t.status ? 6 : 12;
      d.cast = b.cast;
      d.seed = this.rng.next();
      this.decals.push(d);
      return;
    }
  }

  // ================================================================ casting

  _resolve(caster, slotOrWeave) {
    if (Number.isInteger(slotOrWeave)) {
      const i = slotOrWeave;
      if (i < 0 || i >= BAL.SLOTS_MAX) return { ok: false, reason: 'empty', message: 'There is no such slot.' };
      if (this.isPlayer(caster) && i >= this.slotCount) return { ok: false, reason: 'locked_slot', message: 'This slot is still locked.' };
      if (!this.slots[i]) return { ok: false, reason: 'empty', message: 'Nothing is woven into this slot yet.' };
      const plan = this.slotPlan(i);
      if (!plan.ok) return { ok: false, reason: 'invalid', message: plan.reason, plan };
      return { ok: true, plan, slot: i, key: `slot:${i}` };
    }
    if (slotOrWeave && typeof slotOrWeave === 'object') {
      const plan = slotOrWeave.ok !== undefined && slotOrWeave.shapeDef ? slotOrWeave : this.isPlayer(caster) ? this.compile(slotOrWeave) : compileWeave(slotOrWeave, { trusted: true });
      if (!plan.ok) return { ok: false, reason: 'invalid', message: plan.reason, plan };
      return { ok: true, plan, slot: -1, key: plan.key };
    }
    return { ok: false, reason: 'empty', message: 'Nothing to weave.' };
  }

  _check(caster, r, opts = {}) {
    const g = this.game;
    if (!caster || caster.removed || caster.dead || caster.downed || !isAlive(caster)) return { ok: false, reason: 'down', message: "You can't weave right now." };
    if (caster.statusFlags?.disabled) return { ok: false, reason: 'disabled', message: "You can't move your hands!" };
    if (opts.free) return { ok: true };
    if (this.isPlayer(caster)) {
      if (g.state && g.state !== 'playing') return { ok: false, reason: 'busy', message: 'Not now.' };
      const left = r.slot >= 0 ? this.cooldowns[r.slot] : Math.max(0, (this.weaveReady.get(r.key) ?? 0) - this.t);
      if (left > 0.001) return { ok: false, reason: 'cooldown', message: 'Not ready yet.', cooldown: left };
      const need = r.plan.input === 'hold' ? Math.min(r.plan.cost, Math.max(2, r.plan.cost * 0.35)) : r.plan.cost;
      if (this.mana.cur + 1e-6 < need) return { ok: false, reason: 'mana', message: 'Not enough mana.', cost: need };
    }
    return { ok: true };
  }

  canCast(slot, caster = this.game.player) {
    const r = this._resolve(caster, slot);
    if (!r.ok) return { ok: false, reason: r.reason, message: r.message, plan: r.plan || null, cooldown: 0, cost: 0 };
    const c = this._check(caster, r);
    return { ok: c.ok, reason: c.reason || null, message: c.message || '', plan: r.plan, cooldown: r.slot >= 0 ? this.cooldowns[r.slot] : 0, cost: r.plan.cost };
  }

  _pay(caster, r, cost, opts) {
    if (opts.free || !this.isPlayer(caster)) return;
    this.spendMana(cost);
    const cd = r.plan.cooldown;
    if (r.slot >= 0) {
      this.cooldowns[r.slot] = cd;
      this.cooldownTotals[r.slot] = cd;
    } else this.weaveReady.set(r.key, this.t + cd);
  }

  // Who and where a cast is aimed at. A friend counts as aimed at only when the aim
  // names them (aim.target) or the aim point sits right on them: never by auto-aim.
  _newCast(caster, plan, aim, o = {}) {
    const g = this.game;
    let target = aim?.target && aim.target.type === 'actor' && isAlive(aim.target) && aim.target !== caster ? aim.target : null;
    let ax = Number.isFinite(aim?.x) ? aim.x : NaN;
    let ay = Number.isFinite(aim?.y) ? aim.y : NaN;
    const probe = { caster, friendly: true, target: null };
    if (!target && Number.isFinite(ax)) {
      let best = null;
      let bd = 14 * 14;
      let friend = null;
      let fd = 7 * 7;
      for (const a of this._actors()) {
        if (a === caster || !isAlive(a)) continue;
        const d2 = (a.x - ax) ** 2 + (a.y - 4 - ay) ** 2;
        const d2b = Math.min(d2, (a.x - ax) ** 2 + (a.y - ay) ** 2);
        if (this.isPlayer(caster) && this.isFriendOfPlayer(a)) {
          if (d2b < fd) {
            fd = d2b;
            friend = a;
          }
        } else if (d2b < bd && this.canAffect(probe, a)) {
          bd = d2b;
          best = a;
        }
      }
      target = best || friend;
    }
    const range = plan.aim?.range || plan.range || 120;
    if (!Number.isFinite(ax)) {
      // No aim: the nearest foe in reach, else straight ahead.
      const probe2 = { caster, friendly: false, target: null };
      let best = null;
      let bd = (range * 1.2 + 20) ** 2;
      for (const a of this._actors()) {
        if (a === caster || !isAlive(a)) continue;
        const d2 = (a.x - caster.x) ** 2 + (a.y - caster.y) ** 2;
        if (d2 < bd && this.isFoe(probe2, a)) {
          bd = d2;
          best = a;
        }
      }
      if (best) {
        target = best;
        ax = best.x;
        ay = best.y;
      } else {
        const f = caster.facing || { x: 0, y: 1 };
        ax = caster.x + f.x * Math.max(24, range);
        ay = caster.y + f.y * Math.max(24, range);
      }
    } else if (!target && plan.aimAssist) {
      const probe2 = { caster, friendly: false, target: null };
      let best = null;
      let bd = 52 * 52;
      for (const a of this._actors()) {
        if (a === caster || !isAlive(a)) continue;
        const d2 = (a.x - ax) ** 2 + (a.y - ay) ** 2;
        if (d2 < bd && this.isFoe(probe2, a)) {
          bd = d2;
          best = a;
        }
      }
      if (best) target = best;
    }
    if (target && !Number.isFinite(aim?.x)) {
      ax = target.x;
      ay = target.y;
    }
    const friendly = !!(target && this.isPlayer(caster) && this.isFriendOfPlayer(target));
    const cast = {
      id: ++this._castSeq,
      caster,
      plan,
      target,
      friendly,
      trackTarget: !!target && !Number.isFinite(aim?.x),
      aimX: ax,
      aimY: ay,
      angle: Math.atan2(ay - caster.y, ax - caster.x) || 0,
      chargeK: Math.max(0, Math.min(1, o.chargeK || 0)),
      held: !!o.held,
      slot: o.slot ?? -1,
      live: 0,
      total: 0,
      t0: this.t,
      curPlan: plan,
      curMul: 1,
    };
    if (friendly) cast.deliberate = true;
    return cast;
  }

  _emit(cast, plan, mul = 1) {
    const caster = cast.caster;
    if (!caster || caster.removed || !plan?.ok) return;
    const ctx = this._ctx;
    const aim = this.aimOf(cast);
    let ax = aim.x;
    let ay = aim.y;
    const ox = caster.x;
    const oy = caster.y;
    let dx = ax - ox;
    let dy = ay - oy;
    let dist = Math.hypot(dx, dy);
    let angle;
    if (dist < 0.5) {
      const f = caster.facing || { x: 0, y: 1 };
      angle = Math.atan2(f.y, f.x);
      dist = 0;
    } else angle = Math.atan2(dy, dx);
    // Spots out of reach are pulled in to the shape's range.
    const range = plan.aim?.range;
    if (range > 0 && dist > range) {
      ax = ox + Math.cos(angle) * range;
      ay = oy + Math.sin(angle) * range;
      dist = range;
    }
    ctx.caster = caster;
    ctx.plan = plan;
    ctx.cast = cast;
    ctx.ox = ox;
    ctx.oy = oy;
    ctx.aimX = ax;
    ctx.aimY = ay;
    ctx.angle = angle;
    ctx.dist = dist;
    ctx.count = plan.count;
    ctx.target = cast.target;
    ctx.held = cast.held;
    ctx.chargeK = cast.chargeK;
    ctx.mover = null;
    ctx._i = 0;
    cast.curPlan = plan;
    cast.curMul = mul;
    cast.angle = angle;
    this._emitMul = mul;
    this._emitted.length = 0;
    try {
      plan.shapeDef.emit(ctx);
    } catch (err) {
      this.warn(`emit ${plan.shape}`, err);
    }
    const emitted = this._emitted.slice();
    this._emitted.length = 0;
    const hooks = plan.hooks.onEmit;
    for (let i = 0; i < hooks.length; i++) {
      try {
        hooks[i](emitted, this, cast);
      } catch (err) {
        this.warn('onEmit', err);
      }
    }
    this._emitMul = 1;
    this._pose(caster, angle);
    this.fx('cast', { cast, plan, caster, x: ox, y: oy, angle, bodies: emitted });
  }

  // Echo, volley: the same cast again a moment later, as the emitting plan's child.
  recast(cast, twistId, delay, mul = 1) {
    const from = cast.curPlan || cast.plan;
    if (!from || from.gen >= BAL.MAX_GEN) return;
    const plan = from.child(twistId);
    if (!plan.ok) return;
    this.pending.push({ t: delay, cast, plan, mul: (cast.curMul || 1) * mul });
  }

  _pose(caster, angle) {
    try {
      if (typeof caster.castPose === 'function') caster.castPose(angle, 0.24);
      else {
        caster.faceToward?.(caster.x + Math.cos(angle), caster.y + Math.sin(angle));
        if (!this.isPlayer(caster) && caster.setState && caster.state !== 'downed') caster.setState('cast', 0.18);
      }
    } catch (err) {
      this.warn('cast pose', err);
    }
  }

  cast(caster, slotOrWeave, aim, opts = {}) {
    const r = this._resolve(caster, slotOrWeave);
    if (!r.ok) return { ok: false, reason: r.reason, message: r.message, plan: r.plan || null };
    const c = this._check(caster, r, opts);
    if (!c.ok) {
      this.fx('fizzle', { caster, reason: c.reason, plan: r.plan });
      return { ok: false, reason: c.reason, message: c.message, plan: r.plan };
    }
    this.castCancel(caster);
    return this._fire(caster, r, aim, opts);
  }

  _fire(caster, r, aim, opts = {}) {
    const plan = r.plan;
    this._pay(caster, r, plan.cost, opts);
    const cast = this._newCast(caster, plan, aim, { chargeK: opts.chargeK, slot: r.slot, held: false });
    this._emit(cast, plan, 1);
    this.game.bus?.emit('spell_cast', { caster, weave: plan.weave, plan, slot: r.slot, chargeK: cast.chargeK, target: cast.target });
    return { ok: true, plan, cast };
  }

  castStart(caster, slotOrWeave, aim, opts = {}) {
    const r = this._resolve(caster, slotOrWeave);
    if (!r.ok) return { ok: false, reason: r.reason, message: r.message, plan: r.plan || null };
    const c = this._check(caster, r, opts);
    if (!c.ok) {
      this.fx('fizzle', { caster, reason: c.reason, plan: r.plan });
      return { ok: false, reason: c.reason, message: c.message, plan: r.plan };
    }
    this.castCancel(caster);
    const plan = r.plan;
    const mode = plan.input;
    const hold = { caster, r, plan, mode, t: 0, aim: { x: aim?.x, y: aim?.y, target: aim?.target || null }, cast: null, opts, k: 0 };
    this.holds.set(caster, hold);
    if (mode === 'hold') {
      const first = Math.min(plan.cost, Math.max(2, plan.cost * 0.35));
      if (!opts.free && this.isPlayer(caster)) this.spendMana(first);
      hold.cast = this._newCast(caster, plan, aim, { slot: r.slot, held: true });
      this._emit(hold.cast, plan, 1);
      this.game.bus?.emit('spell_cast', { caster, weave: plan.weave, plan, slot: r.slot, held: true, target: hold.cast.target });
      this.fx('beam_start', { cast: hold.cast, caster });
    } else if (mode === 'charge') {
      this.fx('charge', { caster, plan, k: 0, start: true });
    }
    if (mode !== 'tap') caster.castMoveMul = 0.62;
    return { ok: true, plan, mode };
  }

  castHold(caster, aim) {
    const h = this.holds.get(caster);
    if (!h) return null;
    if (aim) {
      if (Number.isFinite(aim.x)) h.aim.x = aim.x;
      if (Number.isFinite(aim.y)) h.aim.y = aim.y;
      if (aim.target !== undefined) h.aim.target = aim.target;
      if (h.cast && Number.isFinite(aim.x) && Number.isFinite(aim.y)) {
        h.cast.aimX = aim.x;
        h.cast.aimY = aim.y;
        h.cast.trackTarget = false;
      }
    }
    return { mode: h.mode, t: h.t, k: h.k, plan: h.plan };
  }

  castRelease(caster, aim) {
    const h = this.holds.get(caster);
    if (!h) return { ok: false, reason: 'empty', message: 'Nothing is being woven.' };
    if (aim) this.castHold(caster, aim);
    this.holds.delete(caster);
    caster.castMoveMul = 1;
    if (h.mode === 'hold') {
      this._endHeld(h);
      if (!h.opts.free && this.isPlayer(caster)) {
        const cd = h.plan.cooldown;
        if (h.r.slot >= 0) {
          this.cooldowns[h.r.slot] = cd;
          this.cooldownTotals[h.r.slot] = cd;
        } else this.weaveReady.set(h.r.key, this.t + cd);
      }
      return { ok: true, plan: h.plan };
    }
    const c = this._check(caster, h.r, h.opts);
    if (!c.ok) {
      this.fx('fizzle', { caster, reason: c.reason, plan: h.plan });
      return { ok: false, reason: c.reason, message: c.message, plan: h.plan };
    }
    const a = h.aim;
    const res = this._fire(caster, h.r, { x: a.x, y: a.y, target: a.target }, { ...h.opts, chargeK: h.mode === 'charge' ? h.k : 0 });
    return res;
  }

  castCancel(caster) {
    const h = this.holds.get(caster);
    if (!h) return false;
    this.holds.delete(caster);
    if (caster) caster.castMoveMul = 1;
    if (h.mode === 'hold') {
      this._endHeld(h);
      if (!h.opts.free && this.isPlayer(caster) && h.r.slot >= 0) {
        this.cooldowns[h.r.slot] = h.plan.cooldown;
        this.cooldownTotals[h.r.slot] = h.plan.cooldown;
      }
    }
    this.fx('charge', { caster, plan: h.plan, k: 0, cancel: true });
    return true;
  }

  // A status froze or stunned the caster: whatever they were holding stops.
  interruptHold(a) {
    if (this.holds.has(a)) this.castCancel(a);
  }

  holdOf(caster) {
    const h = this.holds.get(caster);
    return h ? { mode: h.mode, t: h.t, k: h.k, plan: h.plan, aim: h.aim } : null;
  }

  _endHeld(h) {
    for (const b of this.bodies) {
      if (b.active && b.kind === 'beam' && b.cast === h.cast && b.held) {
        b.held = false;
        b.life = Math.min(b.life, b.age + 0.12);
      }
    }
  }

  _updateHolds(dt) {
    if (!this.holds.size) return;
    for (const [caster, h] of this.holds) {
      h.t += dt;
      if (!isAlive(caster)) {
        this.castCancel(caster);
        continue;
      }
      if (h.mode === 'charge') {
        const k = Math.min(1, h.t / Math.max(0.1, h.plan.charge || BAL.CHARGE_TIME));
        if (k >= 1 && h.k < 1) this.fx('charge', { caster, plan: h.plan, k: 1, full: true });
        h.k = k;
      } else if (h.mode === 'hold') {
        h.k = 1;
        if (!h.opts.free && this.isPlayer(caster)) {
          const need = (h.plan.drain || h.plan.cost) * dt;
          if (this.mana.cur < need) {
            this.castRelease(caster);
            continue;
          }
          this.spendMana(need, true);
        }
      }
    }
  }

  // ================================================================ mana, slots, unlocks

  spendMana(n, quiet = false) {
    if (!(n > 0)) return;
    this.mana.cur = Math.max(0, this.mana.cur - n);
    this._regenWait = BAL.MANA_REGEN_DELAY;
    if (!quiet) this._manaEvent(true);
  }

  restoreMana(n) {
    if (!(n > 0)) return;
    this.mana.cur = Math.min(this.mana.max, this.mana.cur + n);
    this._manaEvent(true);
  }

  addMaxMana(n) {
    const v = Number(n) || 0;
    if (!v) return this.mana.max;
    this.manaBonus = Math.max(-BAL.MANA_START + 5, this.manaBonus + v);
    this._recomputeMax(v > 0 ? v : 0);
    return this.mana.max;
  }

  _recomputeMax(fill = 0) {
    const lvl = Math.max(1, this.game.player?.level || 1);
    const max = Math.min(BAL.MANA_CAP, BAL.MANA_START + (lvl - 1) * BAL.MANA_PER_LEVEL + this.manaBonus);
    const grew = max - this.mana.max;
    this.mana.max = max;
    this.mana.cur = Math.min(max, this.mana.cur + Math.max(0, fill, grew > 0 ? grew : 0));
    this._manaEvent(true);
  }

  _manaEvent(force) {
    const shown = Math.floor(this.mana.cur);
    if (!force && shown === this._manaShown) return;
    this._manaShown = shown;
    this.game.bus?.emit('mana_changed', { cur: this.mana.cur, max: this.mana.max });
  }

  _regen(dt) {
    const m = this.mana;
    if (this._regenWait > 0) {
      this._regenWait -= dt;
      return;
    }
    if (m.cur >= m.max) return;
    m.cur = Math.min(m.max, m.cur + (BAL.MANA_REGEN + m.max * BAL.MANA_REGEN_SHARE) * dt);
    this._manaEvent(false);
  }

  compile(weave) {
    return compileWeave(weave, { unlocked: this.unlocked, maxEssences: this.essenceSlots, maxTwists: this.twistSlots });
  }

  validate(weave) {
    return validateWeave(weave, { unlocked: this.unlocked, maxEssences: this.essenceSlots, maxTwists: this.twistSlots });
  }

  slotPlan(i) {
    const w = this.slots[i];
    if (!w) return null;
    const key = `${i}|${weaveKey(w)}|${w.name || ''}|${this._unlockStamp || 0}`;
    let p = this._planCache.get(i);
    if (!p || p._cacheKey !== key) {
      p = this.compile(w);
      if (p.ok) {
        p = Object.assign({}, p, { weave: { ...p.weave, id: w.id || p.weave.id, name: w.name || null }, name: w.name || p.autoName, id: w.id || p.id });
      }
      p._cacheKey = key;
      this._planCache.set(i, p);
    }
    return p;
  }

  setSlot(i, weave) {
    if (!Number.isInteger(i) || i < 0 || i >= BAL.SLOTS_MAX) return { ok: false, reason: 'There is no such slot.' };
    if (i >= this.slotCount) return { ok: false, reason: 'This slot is still locked.' };
    if (weave == null) {
      this.slots[i] = null;
      this._planCache.delete(i);
      this.game.bus?.emit('weave_slots', { slot: i, weave: null });
      return { ok: true, plan: null };
    }
    const plan = this.compile(weave);
    if (!plan.ok) return { ok: false, reason: plan.reason, plan };
    const n = normalizeWeave(weave);
    this.slots[i] = { id: n.id || `weave${i}_${Date.now().toString(36)}`, name: n.name, shape: n.shape, essences: n.essences, twists: n.twists };
    this._planCache.delete(i);
    this.game.bus?.emit('weave_slots', { slot: i, weave: this.slots[i] });
    return { ok: true, plan: this.slotPlan(i) };
  }

  cooldownLeft(i) {
    return this.cooldowns[i] || 0;
  }

  cooldownFraction(i) {
    const t = this.cooldownTotals[i];
    return t > 0 ? Math.max(0, Math.min(1, (this.cooldowns[i] || 0) / t)) : 0;
  }

  isUnlocked(kind, id) {
    const set = this.unlocked[KIND_SETS[kind]];
    return !!set && set.has(id);
  }

  // Every component reaches the player through here (missions, bosses, the dev helper).
  unlock(kind, id, source = null) {
    const k = KIND_SETS[kind];
    if (!k || !REGISTRY[k].has(id)) return false;
    const set = this.unlocked[k];
    if (set.has(id)) return false;
    set.add(id);
    if (source != null) this.sources[`${KIND_ONE[k]}:${id}`] = source;
    this._unlockStamp = (this._unlockStamp || 0) + 1;
    this.game.bus?.emit('magic_unlocked', { kind: KIND_ONE[k], id, source });
    return true;
  }

  unlockSlot() {
    if (this.slotCount >= BAL.SLOTS_MAX) return false;
    this.slotCount++;
    this.game.bus?.emit('magic_unlocked', { kind: 'slot', id: String(this.slotCount), source: null });
    return true;
  }

  unlockEssenceSlot() {
    if (this.essenceSlots >= BAL.ESSENCE_SLOTS_MAX) return false;
    this.essenceSlots++;
    this._unlockStamp = (this._unlockStamp || 0) + 1;
    this.game.bus?.emit('magic_unlocked', { kind: 'essence_slot', id: String(this.essenceSlots), source: null });
    return true;
  }

  unlockTwistSlot() {
    if (this.twistSlots >= BAL.TWIST_SLOTS_MAX) return false;
    this.twistSlots++;
    this._unlockStamp = (this._unlockStamp || 0) + 1;
    this.game.bus?.emit('magic_unlocked', { kind: 'twist_slot', id: String(this.twistSlots), source: null });
    return true;
  }

  // Developer helper for testing (not shown in any UI): everything, every slot.
  unlockAll() {
    for (const k of ['shapes', 'essences', 'twists']) for (const id of REGISTRY[k].ids()) this.unlock(k, id, 'dev');
    while (this.unlockSlot());
    while (this.unlockEssenceSlot());
    while (this.unlockTwistSlot());
    this.mana.cur = this.mana.max;
    return true;
  }

  // What the Spellbook shows: every component with its words and whether it is known.
  catalog() {
    const pick = (k, R, f) =>
      R.ids().map((id) => {
        const d = R.get(id);
        return { id, name: d.name, unlocked: this.unlocked[k].has(id), source: this.sources[`${KIND_ONE[k]}:${id}`] ?? null, ...f(d) };
      });
    return {
      shapes: pick('shapes', Shapes, (d) => ({ noun: d.noun, kind: d.kind, input: d.input, base: { ...d.base } })),
      essences: pick('essences', Essences, (d) => ({ word: d.word, noun: d.noun, palette: { ...d.palette }, status: d.status?.id || null, tags: d.tags.slice(), hue: d.hue })),
      twists: pick('twists', Twists, (d) => ({ adj: d.adj, clause: d.clause?.[0] || d.sentence || '' })),
      limits: { slots: this.slotCount, essences: this.essenceSlots, twists: this.twistSlots },
    };
  }

  statusesOf(actor) {
    return this.status.list(actor);
  }

  applyStatus(target, id, opts = {}) {
    return this.status.apply(target, id, opts);
  }

  planStats(plan) {
    return planStats(plan);
  }

  // ================================================================ the step

  _actors() {
    const list = this.game.entities?.list || this.game.entities?.all?.() || [];
    return list.filter((e) => e && e.type === 'actor' && !e.removed);
  }

  // Outside a step (a boss or a test applying a status directly) the list is rebuilt.
  _ensureCands() {
    if (!this._inStep) this._buildCandidates();
    return this.cands;
  }

  _buildCandidates() {
    const out = this.cands;
    const shots = this.shots;
    out.length = 0;
    shots.length = 0;
    const list = this.game.entities?.list || this.game.entities?.all?.() || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || e.removed) continue;
      if (e.type === 'actor') {
        if (!e.dead && isAlive(e)) out.push(e);
      } else if (e.type === 'projectile') shots.push(e);
    }
  }

  update(dt) {
    if (!(dt > 0)) return;
    const n = Math.max(1, Math.min(4, Math.ceil(dt / BAL.STEP - 1e-6)));
    const h = dt / n;
    for (let i = 0; i < n; i++) this._step(h);
    try {
      this.game.magicFx?.update?.(dt, this);
    } catch (err) {
      this.warn('fx update', err);
    }
    this.layer.follow(this.game);
  }

  _step(dt) {
    this._inStep = true;
    try {
      this._stepInner(dt);
    } finally {
      this._inStep = false;
    }
  }

  _stepInner(dt) {
    this.t += dt;
    for (let i = 0; i < this.cooldowns.length; i++) if (this.cooldowns[i] > 0) this.cooldowns[i] = Math.max(0, this.cooldowns[i] - dt);
    this._regen(dt);
    this._buildCandidates();
    this._updateHolds(dt);
    this._updateMovers(dt);
    this._updatePending(dt);
    this.status.update(dt);
    const list = this.bodies;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b.active) continue;
      if (b.delay > 0) {
        b.delay -= dt;
        if (b.follow && b.owner && !b.owner.removed) {
          b.x = b.owner.x;
          b.y = b.owner.y;
        }
        continue;
      }
      b.age += dt;
      try {
        KIND_UPDATE[b.kind](this, b, dt);
      } catch (err) {
        this.warn(`update ${b.kind}`, err);
        this.end(b, 'error');
        continue;
      }
      if (!b.active) continue;
      const hooks = b.plan.hooks.onUpdate;
      for (let k = 0; k < hooks.length; k++) {
        try {
          hooks[k](b, dt, this);
        } catch (err) {
          this.warn('onUpdate', err);
        }
      }
      if (b.active && b.age >= b.life) this.end(b, 'expire');
    }
    // Drop finished bodies back into the pool.
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.active) list[w++] = b;
      else {
        b.owner = null;
        b.cast = null;
        b.target = null;
        b.plan = null;
        b.hits.clear();
        b.chainSeen.length = 0;
        b.fxState = null;
        if (this.pool.length < BAL.BODY_CAP + 40) this.pool.push(b);
      }
    }
    list.length = w;
    this._updateDecals(dt);
    this._numberT += dt;
    if (this._numberT >= NUMBER_FLUSH) {
      this._numberT = 0;
      if (this._numbers.size) this._flushNumbers();
    }
  }

  _updatePending(dt) {
    const p = this.pending;
    if (!p.length) return;
    for (let i = p.length - 1; i >= 0; i--) {
      const r = p[i];
      r.t -= dt;
      if (r.t > 0) continue;
      p.splice(i, 1);
      const c = r.cast.caster;
      if (!isAlive(c)) continue;
      this._emit(r.cast, r.plan, r.mul);
    }
  }

  _updateMovers(dt) {
    const ms = this.movers;
    for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i];
      const a = m.actor;
      const step = Math.min(dt, m.t);
      if (a && !a.removed && step > 0) this.pushActor(a, m.vx * step, m.vy * step);
      m.t -= dt;
      for (const b of m.trails) if (b.active && b.dashing) {
        b.x2 = a.x;
        b.y2 = a.y;
      }
      if (m.t <= 0 || !a || a.removed) {
        for (const b of m.trails) b.dashing = false;
        ms.splice(i, 1);
      }
    }
  }

  _updateDecals(dt) {
    const ds = this.decals;
    if (!ds.length) return;
    let w = 0;
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i];
      d.t += dt;
      if (d.t < d.life) ds[w++] = d;
    }
    ds.length = w;
    this._puddleT -= dt;
    if (this._puddleT > 0) return;
    this._puddleT = 0.5;
    for (const d of ds) {
      if (!d.status || !d.cast) continue;
      for (const a of this.cands) {
        if (Math.abs(a.x - d.x) > d.r || Math.abs(a.y - d.y) > d.r) continue;
        if (!this.canAffect(d.cast, a) || (d.cast.friendly && this.isFriendOfPlayer(a))) continue;
        this.status.apply(a, d.status, { src: d.cast.caster, potency: 0.6, power: 4 });
      }
    }
  }

  // ================================================================ drawing (through the layer)

  drawGround(ctx, ox, oy, time) {
    const fx = this.game.magicFx;
    if (fx?.drawGround) {
      try {
        fx.drawGround(ctx, ox, oy, time, this);
        return;
      } catch (err) {
        this.warn('fx drawGround', err);
      }
    }
    drawGround(this, ctx, ox, oy, time);
  }

  drawBodies(ctx, ox, oy, time) {
    drawBodies(this, ctx, ox, oy, time);
  }

  getLights(time) {
    const fx = this.game.magicFx;
    if (fx?.getLights) {
      try {
        return fx.getLights(time, this);
      } catch (err) {
        this.warn('fx getLights', err);
      }
    }
    return collectLights(this, time);
  }

  // ================================================================ saving

  serialize() {
    return {
      v: 1,
      unlocked: { shapes: [...this.unlocked.shapes], essences: [...this.unlocked.essences], twists: [...this.unlocked.twists] },
      sources: { ...this.sources },
      slots: this.slots.map((w) => (w ? { id: w.id || null, name: w.name || null, shape: w.shape, essences: [...w.essences], twists: [...w.twists] } : null)),
      slotCount: this.slotCount,
      essenceSlots: this.essenceSlots,
      twistSlots: this.twistSlots,
      mana: { cur: Math.round(this.mana.cur * 10) / 10, max: this.mana.max },
      manaBonus: this.manaBonus,
    };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    const u = d.unlocked || {};
    for (const k of ['shapes', 'essences', 'twists']) {
      const set = new Set(k === 'shapes' ? ['bolt'] : k === 'essences' ? ['raw'] : []);
      for (const id of Array.isArray(u[k]) ? u[k] : []) if (typeof id === 'string' && REGISTRY[k].has(id)) set.add(id);
      this.unlocked[k] = set;
    }
    this.sources = d.sources && typeof d.sources === 'object' ? { ...d.sources } : {};
    const clampInt = (v, lo, hi, dflt) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : dflt);
    this.slotCount = clampInt(d.slotCount, BAL.SLOTS_START, BAL.SLOTS_MAX, BAL.SLOTS_START);
    this.essenceSlots = clampInt(d.essenceSlots, BAL.ESSENCE_SLOTS_START, BAL.ESSENCE_SLOTS_MAX, BAL.ESSENCE_SLOTS_START);
    this.twistSlots = clampInt(d.twistSlots, BAL.TWIST_SLOTS_START, BAL.TWIST_SLOTS_MAX, BAL.TWIST_SLOTS_START);
    if (Array.isArray(d.slots)) {
      for (let i = 0; i < BAL.SLOTS_MAX; i++) {
        const w = d.slots[i];
        if (!w || typeof w !== 'object' || !Shapes.has(w.shape)) {
          this.slots[i] = null;
          continue;
        }
        const n = normalizeWeave(w);
        n.essences = n.essences.filter((e) => Essences.has(e));
        if (!n.essences.length) n.essences = ['raw'];
        n.twists = n.twists.filter((t) => Twists.has(t));
        this.slots[i] = { id: n.id, name: n.name, shape: n.shape, essences: n.essences, twists: n.twists };
      }
    }
    this.manaBonus = Number.isFinite(d.manaBonus) ? d.manaBonus : 0;
    this._planCache.clear();
    this._unlockStamp = (this._unlockStamp || 0) + 1;
    this._recomputeMax();
    if (Number.isFinite(d.mana?.cur)) this.mana.cur = Math.max(0, Math.min(this.mana.max, d.mana.cur));
    this.cooldowns.fill(0);
    this._manaEvent(true);
  }
}

export { BAL as BALANCE };
