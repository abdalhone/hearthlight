import { Body, KIND_UPDATE, segDist, HIT, HIT_TICK } from './bodies.js';
import { compileWeave, validateWeave, normalizeWeave, weaveKey, planStats } from './compile.js';
import { Shapes, bindFlavor, wardFlavor } from './shapes.js';
import { Essences } from './essences.js';
import { Twists } from './twists.js';
import { Prices, PRICE_SLOTS } from './prices.js';
import { StatusSystem, Statuses, REACTIONS } from './status.js';
import { MagicLayer, fallbackFx, collectLights, drawBodies, drawGround } from './draw.js';
import { installMagicFx } from './fx.js';
import * as BAL from './balance.js';
import { RNG } from '../core/rng.js';
import { TILE } from '../core/constants.js';
import { factionRelation } from '../entities/entity.js';
import { T as TILE_IDS } from '../world/tiles.js';
import { wallAt as wallAtPoint, wallBetween } from '../world/walls.js';
import { propAt as propAtPoint, propsInCircle, strikeProp } from '../world/breakables.js';

// The Weave runtime: game.magic (DESIGN §22.2).
//
//   cast(caster, slotOrWeave, aim {x, y, target?}, opts?) -> { ok, reason?, message?, plan }
//       a full quick cast. aim may be omitted (auto-aims at the nearest foe, else ahead).
//       opts: { free (no mana / cooldown), chargeK (0..1: pays x(1 + k) mana) }
//   castStart(caster, slot, aim, opts?) -> { ok, reason?, plan, mode: 'tap'|'hold'|'charge' }
//       opts.charge: a tap weave charges while held (the controls ask this for every press)
//   castHold(caster, aim) -> { mode, t, k (charge 0..1), live, capped, plan } | null
//   castRelease(caster, aim?) -> { ok, reason?, plan }                   (casts / ends a beam)
//   castCancel(caster)                                                    (drag back to cancel)
//       Held flow for every shape: Start on press, Hold while dragging, Release to cast.
//       'tap' casts on release; 'charge' grows while held (past a CHARGE_DEAD tap, see
//       balance.js) and casts on release at charge k, paying x(1 + k) mana then, never more
//       than the mana there is; 'hold' (beam) pours from Start until Release, draining
//       plan.drain mana per second. One hold per caster: a second Start lets the first go.
//   canCast(slot, caster = player) -> { ok, reason, message, cooldown, cost, plan }
//       reasons: 'empty' 'locked_slot' 'invalid' 'cooldown' 'mana' 'down' 'disabled' 'busy'
//   slots[0..5] (weaves or null), slotCount, essenceSlots, twistSlots, setSlot(i, weave),
//   slotPlan(i), cooldownLeft(i), cooldownFraction(i), cooldownTotal(i), resetCooldowns()
//       a weave's cooldown follows the weave (its plan.key), not the slot it sits in
//   startTrial() / endTrial() / trial: "Try all magic" (Settings): every part open until it
//       ends; the real unlocks, slots and weaves come back, rewards earned meanwhile kept
//   mana { cur, max }, addMaxMana(n), restoreMana(n)
//   unlocked { shapes, essences, twists } (Sets), unlock(kind, id, source), isUnlocked(kind, id),
//   unlockSlot(), unlockEssenceSlot(), unlockTwistSlot(), unlockAll() (developer helper)
//   compile(weave) -> plan (validated against unlocks and slot limits), catalog()
//   bodies (live Body list, see bodies.js), status (StatusSystem), statusesOf(actor),
//   applyStatus(target, id, opts), holdOf(caster), serialize(), deserialize(d)
//   holdTarget(body, target, info) (a bind's hold, DESIGN §22.5), absorb(target, amount,
//   source, opts) -> the part of a blow a ward takes (combat.damage asks), wardOn(actor)
//
// Bus events: spell_cast {caster, weave, plan, slot}, spell_hit {body, target, amount,
// essences, caster, plan}, status_applied {target, status, source, potency, duration},
// reaction {id, name, x, y, target, source}, magic_unlocked {kind, id, source},
// mana_changed {cur, max}, weave_slots {slot, weave} (a slot was set or cleared),
// weave_ready {key, plan} (a weave's cooldown ran out), magic_trial {on},
// bind {source, target, seconds, plan, resisted} (a bind closed on someone),
// ward {caster, bearer, shield, plan} (a ward rose) and ward_broken {bearer, caster, plan}.
//
// Other casters (bosses, a foe that weaves): cast(boss, weave, aim) needs no unlocks, mana
// or slot cooldowns (pace it yourself); its harm follows combat.canHarm; caster.magicPower
// scales its damage (the player's grows 7% a level). Targets resist by actor.resist or
// spec.resist { fire: 0.5 }; superArmor / boss / ccResist shorten hard control.
//
// Visual/sound layer (r4/fx): set game.magicFx = { ... } (any time; read on every use), all
// optional:
//   onEvent(type, payload, magic)   types: cast spawn launch hit end explode bounce pulse
//       impact armed patch block status reaction familiar dash charge beam_start beam_end
//       link (a reaction arcing from one target to another) fizzle (a refused cast:
//       reason 'mana' | 'cooldown' | …) ready (a weave's cooldown ran out {caster, plan, total})
//       bind (a hold closed) unbind (it let go) bind_resist (a boss shrugged it off)
//       ward_hit (a ward took a blow) ward_block (it stopped a missile: how 'block' |
//       'reflect' | 'deflect') ward_thicken ward_break
//   update(dt, magic), drawGround(ctx, ox, oy, time, magic), drawBody(ctx, body, ox, oy, time),
//   drawLayer(ctx, ox, oy, time, magic) (replaces drawBody for every body),
//   drawStatuses(ctx, ox, oy, time, magic), getLights(time, magic) -> light[],
//   sfx: true (combat then stays silent on weave hits; play your own sounds from onEvent)
// Useful for looks: body.plan.palette / palettes / particles / sounds / light / familiar
// ({ name, form, attack }), body.plan.shape / essences / twists, body.seed, body.fxState
// (free per-body slot), magic.holdOf(caster) (charge rings), magic.decals (terrain marks),
// actor.magicStatus (statuses: s.def.overlay, s.def.color, s.t, s.stacks).
// Anything fx leaves out falls back to the plain look in draw.js. The layer the renderer
// draws is magic.layer (an entity added by game.js: drawShadow = ground, draw = bodies).

export const STARTER_WEAVE = Object.freeze({ id: 'spark', name: 'Spark', shape: 'bolt', essences: Object.freeze(['raw']), twists: Object.freeze([]) });

const KIND_SETS = { shape: 'shapes', shapes: 'shapes', essence: 'essences', essences: 'essences', twist: 'twists', twists: 'twists', price: 'prices', prices: 'prices' };
const KIND_ONE = { shapes: 'shape', essences: 'essence', twists: 'twist', prices: 'price' };
const REGISTRY = { shapes: Shapes, essences: Essences, twists: Twists, prices: Prices };
const GRASSY = new Set([TILE_IDS.GRASS, TILE_IDS.TALL_GRASS, TILE_IDS.FOREST, TILE_IDS.FLOWERBED, TILE_IDS.FARMLAND].filter((v) => v != null));
const DEFAULT_MODE = { projectile: 'fly', area: 'burst' };
const TAU = Math.PI * 2;
const ZERO = Object.freeze({ x: 0, y: 0 });
// Weaves and friends (the author: "the spells do not do any damage" when aimed at Lyra).
// A player's weave physically hits whoever it touches but the caster. A friend it hits
// was aimed at (a deliberate blow) when the aim named them, the aim point sat within
// FRIEND_AIM_R of them with nobody nearer it, or a straight weave's aim line passed within
// FRIEND_LINE_R of them before anyone else; otherwise it is an accident: ACCIDENT_MUL of
// the damage, no status, and the mind and the crime rules weigh it as an accident.
export const FRIEND_AIM_R = 20;
export const FRIEND_LINE_R = 12;
export const ACCIDENT_MUL = 0.5;
// A weave let go after a hold (a charge): a friend counts as aimed at only if the aim had
// named her for FRIEND_STEADY seconds before the release, or since the press. While a
// charge gathers she may walk into its line or under the cursor; that is not aiming at her.
export const FRIEND_STEADY = 0.3;
// Bodies that touch whoever stands in them: the strike itself (bolts, beams, blasts,
// cones, novas). What lingers on the ground or hovers (patches, rains, runes, walls,
// trails, familiars) spares friends unless the weave was aimed at one.
const STRIKES_FRIENDS = { projectile: true, beam: true, strike: true };
const AREA_LINGERS = { patch: true, rain: true };
const LINE_AIMS = { line: true, cone: true, arc: true };
const NUMBER_FLUSH = 0.4;
// Binds on bosses (DESIGN §22.5): a boss is held this share of the time, half that again
// for each bind in a row (BIND_DR_MAX in a row and it shrugs the next one off), and the
// row is forgotten after BIND_DR_RESET seconds without one.
const BOSS_HOLD = 0.45;
const BIND_DR_MAX = 3;
const BIND_DR_RESET = 14;
const WARD_CAP = 1.6; // a ward thickened by echoes and recasts holds at most this times its raising

const isAlive = (a) => !!a && !a.removed && !a.dead && (typeof a.isAlive === 'function' ? a.isAlive() : a.hp > 0);

// A weave as saved data, and back (unknown parts dropped; no shape, no weave).
function plainWeave(w) {
  return w ? { id: w.id || null, name: w.name || null, shape: w.shape, essences: [...(w.essences || [])], twists: [...(w.twists || [])], prices: [...(w.prices || [])] } : null;
}

function readWeave(w) {
  if (!w || typeof w !== 'object' || !Shapes.has(w.shape)) return null;
  const n = normalizeWeave(w);
  n.essences = n.essences.filter((e) => Essences.has(e));
  if (!n.essences.length) n.essences = ['raw'];
  n.twists = n.twists.filter((t) => Twists.has(t));
  n.prices = n.prices.filter((t) => Prices.has(t));
  return { id: n.id, name: n.name, shape: n.shape, essences: n.essences, twists: n.twists, prices: n.prices };
}

const cloneWeave = (w) => ({ ...w, essences: [...(w.essences || [])], twists: [...(w.twists || [])], prices: [...(w.prices || [])] });
const sameParts = (a, b) => !!a && !!b && weaveKey(a) === weaveKey(b);

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
    this._body = null; // the body being updated (canAffect asks what kind of touch it is)
    this.game = game;
    this.t = 0;
    this.rng = new RNG(7177);
    this.pool = [];
    this.bodies = [];
    this.cands = [];
    this.shots = [];
    this.hazards = []; // bosses' globs and bubbles (wards stop them)
    this._wards = []; // live wards, for combat.damage's question
    this._retaliate = []; // [ward, attacker, …]: wards answering blows (next step)
    this.status = new StatusSystem(game, this);
    this.unlocked = { shapes: new Set(['bolt']), essences: new Set(['raw']), twists: new Set(), prices: new Set() };
    this.priceSlots = PRICE_SLOTS; // prices a weave may carry (DESIGN §25)
    this.sources = {};
    this.slotCount = BAL.SLOTS_START;
    this.essenceSlots = BAL.ESSENCE_SLOTS_START;
    this.twistSlots = BAL.TWIST_SLOTS_START;
    this.slots = new Array(BAL.SLOTS_MAX).fill(null);
    this.slots[0] = { ...STARTER_WEAVE, essences: ['raw'], twists: [] };
    // Cooldowns follow the weave: plan.key -> { until (magic time), total (seconds), plan }.
    this.weaveReady = new Map();
    this.trial = null; // "Try all magic" (Settings): the real state, kept while it runs
    this.trialDrafts = []; // weaves made in a trial that left their slot when it ended
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
    // The Weave's look and sound (fx.js, sfx.js) once the game has a renderer; bare
    // runtime tests keep the plain fallback look in draw.js.
    if (game?.renderer && game.magicFx === undefined) installMagicFx(game);
    this.registry = { shapes: Shapes, essences: Essences, twists: Twists, prices: Prices, statuses: Statuses, reactions: REACTIONS };
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
  // touches friends too: always when aimed at one (cast.friendly), and otherwise when the
  // body is the strike itself (see STRIKES_FRIENDS; that hit is an accident). A weave
  // that shields (benign) never harms a friend. Anyone else follows combat.canHarm.
  canAffect(cast, a) {
    if (!a || a.type !== 'actor' || a.removed || a.dead) return false;
    const caster = cast?.caster || null;
    if (a === caster) return false;
    if (this.isPlayer(caster)) {
      if (this.isFriendOfPlayer(a)) {
        if (cast.friendly) return true;
        // A shield never harms a friend; a hold (a bind's ring) closes only on its mark.
        if (cast.plan?.shapeDef?.benign || cast.plan?.hold > 0 || cast.sparesFriends) return false;
        return this.strikesFriends(this._body);
      }
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

  // Is this body the strike itself (it hits a friend in its way), or something that
  // lingers (it spares them)? Outside a body's own update (a hook, a test) a cast's
  // touch is the strike.
  strikesFriends(b) {
    if (!b) return true;
    if (STRIKES_FRIENDS[b.kind]) return true;
    if (b.kind === 'area') return !AREA_LINGERS[b.mode] && !(b.life > 2.5);
    return false;
  }

  // The friend a player's aim names, or null (see FRIEND_AIM_R). Auto-aim (a quick tap, a
  // key with no mouse over the game) only ever picks foes, so it never names a friend.
  // The UI may ask this while the player drags, to show the aim is on a friend.
  aimedFriend(caster, aim, plan = null) {
    if (!aim || !this.isPlayer(caster) || aim.auto) return null;
    const t = aim.target;
    if (t && t.type === 'actor' && t !== caster && isAlive(t)) return this.isFriendOfPlayer(t) ? t : null;
    const ax = aim.x;
    const ay = aim.y;
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) return null;
    const actors = this._actors();
    // Whoever stands nearest the aim point (body or feet), when near enough.
    let near = null;
    let nd = FRIEND_AIM_R * FRIEND_AIM_R;
    for (const a of actors) {
      if (a === caster || !isAlive(a)) continue;
      const d2 = Math.min((a.x - ax) ** 2 + (a.y - 6 - ay) ** 2, (a.x - ax) ** 2 + (a.y - ay) ** 2);
      if (d2 < nd) {
        nd = d2;
        near = a;
      }
    }
    if (near) return this.isFriendOfPlayer(near) ? near : null;
    // A straight weave's line: the first person it passes close to.
    const type = plan?.aim?.type || 'line';
    if (!LINE_AIMS[type]) return null;
    const ox = caster.x;
    const oy = caster.y - 7;
    const dx = ax - ox;
    const dy = ay - oy;
    const len = Math.hypot(dx, dy);
    if (len < 6) return null;
    const ux = dx / len;
    const uy = dy / len;
    const reach = Math.max(len, plan?.aim?.range || plan?.range || 0) + 6;
    let first = null;
    let fa = Infinity;
    for (const a of actors) {
      if (a === caster || !isAlive(a)) continue;
      const rx = a.x - ox;
      const ry = a.y - 6 - oy;
      const along = rx * ux + ry * uy;
      if (along < 2 || along > reach) continue;
      const perp = Math.abs(rx * uy - ry * ux);
      if (perp > FRIEND_LINE_R + Math.min(4, (a.radius ?? 5) * 0.5)) continue;
      if (along < fa) {
        fa = along;
        first = a;
      }
    }
    return first && this.isFriendOfPlayer(first) ? first : null;
  }

  // A player's weave hitting a friend: was this one aimed at them? (Otherwise an accident.)
  _aimedAtFriend(cast, target) {
    if (!cast?.friendly) return false;
    if (cast.target === target) return true;
    // A blast aimed at one friend also means whoever stands with them.
    return Number.isFinite(cast.aimX) && Math.hypot(target.x - cast.aimX, target.y - 6 - cast.aimY) <= FRIEND_AIM_R * 1.6;
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
      // Never seek, chain to or ricochet toward someone behind a wall (DESIGN §31.1).
      if (this.blocked(x, y - 3, a.x, a.y - 3)) continue;
      best = a;
      bd = d2;
    }
    return best;
  }

  // Walls (DESIGN §31.1): the tiles projectiles stop at, and closed doors.
  wallAt(x, y) {
    return wallAtPoint(this.game, x, y);
  }

  // ================================================================ props (DESIGN §31.3)
  // The player's weaves land on the world's props as well as its people: missiles and rays
  // stop at the first prop they meet; bursts, rings, cones, the fist and the wave reach
  // every prop in them (never through a wall). Damage builds up: small blows chip, a strike
  // or a heavy blow breaks. Everyone else's weaves pass over props as they always did.
  _breaks(b) {
    const o = b?.owner;
    return !!o && (o === this.game.player || o.id === 'player') && !!this.game.objects;
  }

  propAt(b, x, y) {
    return this._breaks(b) ? propAtPoint(this.game, x, y) : null;
  }

  hitProp(b, o, mul = 1, flags = HIT) {
    let dx;
    let dy;
    if (b.kind === 'projectile' && (b.vx || b.vy)) {
      const l = Math.hypot(b.vx, b.vy);
      dx = b.vx / l;
      dy = b.vy / l;
    } else if (b.kind === 'beam' || b.kind === 'strike') {
      dx = Math.cos(b.angle);
      dy = Math.sin(b.angle);
    } else {
      dx = o.x - b.x;
      dy = o.y - 8 - b.y;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
    }
    let ok = false;
    try {
      ok = strikeProp(this.game, o, {
        source: b.owner,
        amount: b.dmg * mul,
        heavy: !!flags.heavy,
        punch: (flags.knock || 0) >= 2,
        charge: flags.tick ? 0 : b.charge || 0,
        tick: !!flags.tick || !!flags.pool,
        dirX: dx,
        dirY: dy,
        pal: b.plan?.palette || null,
        pooled: this,
      });
    } catch (err) {
      this.warn('props', err);
    }
    if (ok) {
      // The weave's own flourish and sound where it struck (a stand-in for a body).
      const t = this._propProxy || (this._propProxy = { type: 'prop', x: 0, y: 0, z: 0, hp: 1, maxHp: 1, dead: false, removed: false, radius: 6, prop: null });
      t.x = o.x;
      t.y = o.y - 6;
      t.prop = o;
      this.fx('hit', { body: b, target: t, x: t.x, y: t.y, amount: 0, tick: !!flags.tick, prop: o });
    }
    return ok;
  }

  hitProps(b, x, y, r, mul = 1, flags = HIT, again = 0, cone = null) {
    if (!this._breaks(b)) return 0;
    // A locked chest in the blow (round 14b): a Strike or a heavy weave forces its hasp;
    // a lighter one gets a word (world/containers.js, through game.chestBlow); fire on a
    // store sets it alight (world/occupation.js).
    if (!b._chestBlow) {
      b._chestBlow = true;
      try {
        this.game.chestBlow?.(x, y, r, { source: b.owner, heavy: !!flags.heavy || b.kind === 'strike', punch: (flags.knock || 0) >= 2, fire: (b.plan?.essences || []).includes('fire') });
      } catch (err) {
        this.warn('chests', err);
      }
    }
    const list = propsInCircle(this.game, x, y, r, cone).slice();
    let n = 0;
    for (let i = 0; i < list.length && b.active; i++) {
      const o = list[i];
      const last = b.hits.get(o);
      if (last !== undefined && (again <= 0 || b.age - last < again)) continue;
      b.hits.set(o, b.age);
      if (this.hitProp(b, o, mul, flags)) n++;
    }
    return n;
  }

  // Is a wall between two points? Every body's blow asks this before it lands, so a
  // nova, a strike's wave or a blast never reaches through a wall or a closed door.
  blocked(x0, y0, x1, y1) {
    return wallBetween(this.game, x0, y0, x1, y1);
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
    // One ward to a bearer: another (an echo, a volley, a second cast) thickens it.
    if (kind === 'ward') {
      const bearer = init.target || cast?.caster || null;
      const w = bearer ? this.wardOn(bearer) : null;
      if (w && this._thicken(w, init, plan)) return w;
    }
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
    // A charged cast (balance.js: hold to charge) hits harder, grows and flies faster.
    const k = emitting ? cast?.chargeK || 0 : 0;
    const sizeK = 1 + BAL.CHARGE_SIZE * k;
    const power = Number.isFinite(cast?.chargePower) ? cast.chargePower : BAL.CHARGE_POWER;
    b.charge = k;
    b.dmg = Number.isFinite(init.dmg) ? init.dmg : plan.dmg * (emitting ? this._emitMul : 1) * (1 + power * k);
    b.x = Number.isFinite(init.x) ? init.x : o ? o.x : 0;
    b.y = Number.isFinite(init.y) ? init.y : o ? o.y : 0;
    b.bx = b.x;
    b.by = b.y;
    b.ox = b.x;
    b.oy = b.y;
    b.angle = Number.isFinite(init.angle) ? init.angle : cast?.angle ?? 0;
    b.speed = (Number.isFinite(init.speed) ? init.speed : plan.speed) * (1 + BAL.CHARGE_SPEED * k);
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
      case 'bind':
        b.target = init.target || null;
        b.tickMul = init.tickMul ?? 0.15;
        b.tickT = b.tick;
        b.cur = b.r * 2.2;
        break;
      case 'ward':
        b.target = init.target || o;
        b.shield = Math.max(1, Number.isFinite(init.shield) ? init.shield : plan.shield || 20);
        b.shieldMax = b.shield;
        b.cur = b.r * 0.35;
        b.plateA = b.seed * TAU;
        b.braceT = 0;
        this._wards.push(b);
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
    if (b.kind === 'bind') this._releaseHold(b, why);
    else if (b.kind === 'ward') this._wardEnd(b, why);
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
    // A friend the player's weave touched: aimed at them (deliberate), caught in a weave
    // aimed at another friend (no accident either: the player chose to loose it on
    // friends), or caught in a weave aimed elsewhere (an accident).
    const friendHit = !!cast && this.isPlayer(caster) && !this.isPlayer(target) && this.isFriendOfPlayer(target);
    const deliberate = friendHit && this._aimedAtFriend(cast, target);
    const accident = friendHit && !cast.friendly;
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
    o.pin = tick && b.kind === 'beam'; // a beam's ray pins whoever it touches (DESIGN §31.2)
    o.dot = !!flags.dot; // a bite like a status tick: soft flash, through i-frames
    o.quiet = pooled;
    o.silent = !!(g.magicFx?.sfx || g.magicSfx);
    o.crit = tick ? false : undefined;
    o.invuln = party ? undefined : 0;
    o.penetration = plan.penetration;
    o.deliberate = deliberate;
    o.accident = accident;
    o.weave = plan;
    o.essences = plan.essences;
    o.magic = true;
    o.charge = tick ? 0 : b.charge || 0; // a charged blow lands bigger (spark, number)
    const amt = accident ? amount * ACCIDENT_MUL : amount;
    let dealt = 0;
    try {
      dealt = g.combat?.damage ? g.combat.damage(caster || null, target, amt, o) || 0 : this._rawDamage(target, amt);
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
    info.accident = accident;
    if (!target.removed && !target.dead && !accident) {
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
    g.bus?.emit('spell_hit', { body: b, target, amount: dealt, essences: plan.essences, caster, plan, tick, deliberate, accident });
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
      if (a !== opts.link && this.blocked(x, y - 3, a.x, a.y - 3)) continue; // walls stop a reaction's spread too
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
    this._numbersLive = true;
    return want;
  }

  _number(actor, amount, color) {
    let rec = this._numbers.get(actor);
    if (!rec) this._numbers.set(actor, (rec = { dmg: 0, heal: 0, color, t: 0 }));
    rec.dmg += amount;
    rec.color = color || rec.color;
    this._numbersLive = true;
  }

  // One summed number per actor; records are kept and zeroed (no garbage per flush).
  _flushNumbers() {
    const g = this.game;
    this._numbersLive = false;
    for (const [a, rec] of this._numbers) {
      if (a.removed || a.dead) {
        this._numbers.delete(a);
        if (!(rec.dmg >= 1)) continue;
      }
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
      rec.dmg = 0;
      rec.heal = 0;
    }
    if (this._numbers.size > 64) this._numbers.clear();
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

  // ================================================================ bind (DESIGN §22.5)

  // Hold `a` still — rooted, no blows, no weaves — for the bind weave body `b` that
  // touched it (shape bind's onHit). A lingering patch's bite only catches the feet.
  // Bosses resist: BOSS_HOLD of the hold, halved for each bind in a row, then shrugged off.
  // Returns the seconds held (0: not held).
  holdTarget(b, a, info = {}) {
    if (!b?.plan || !a || a.type !== 'actor' || a.removed || a.dead || !isAlive(a)) return 0;
    const plan = b.plan;
    const src = b.cast?.caster || b.owner || null;
    if (info.tick || (b.kind === 'area' && b.mode === 'patch')) {
      this.status.apply(a, 'rooted', { src, potency: 0.55, power: b.dmg, duration: 0.8 });
      return 0;
    }
    const f = bindFlavor(plan);
    let secs = (plan.hold || 2.6) * f.hold * (plan.gen > 0 ? 0.55 : 1) * (1 + 0.5 * (b.cast?.chargeK || 0));
    let dr = null;
    if (a.boss || a.superArmor || Number.isFinite(a.ccResist)) {
      dr = a._bindDR || (a._bindDR = { n: 0, t: -1e9 });
      if (this.t - dr.t > BIND_DR_RESET) dr.n = 0;
      if (dr.n >= BIND_DR_MAX) {
        dr.t = this.t;
        this.fx('bind_resist', { target: a, plan, body: b });
        this._floatText(a, 'Resisted', plan.palette?.spark || '#e6dcff');
        return 0;
      }
      secs *= (Number.isFinite(a.ccResist) ? a.ccResist : BOSS_HOLD) * Math.pow(0.5, dr.n);
    }
    const inst = this.status.apply(a, 'bound', { src, potency: 1, duration: secs, power: b.dmg });
    if (!inst) return 0;
    const resisted = !!dr;
    if (dr) {
      dr.n++;
      dr.t = this.t;
    }
    let hold = null;
    for (let i = 0; i < this.bodies.length; i++) {
      const o = this.bodies[i];
      if (o.active && !o.ending && o.kind === 'bind' && o.target === a) {
        hold = o;
        break;
      }
    }
    if (hold) hold.life = Math.max(hold.life, hold.age + inst.t + 0.5);
    else {
      const bare = typeof plan.bare === 'function' ? plan.bare() : plan;
      const r = (6 + Math.min(14, a.radius ?? 5)) * Math.min(1.5, Math.max(0.8, plan.size || 1));
      hold = this.spawn('bind', { x: a.x, y: a.y, target: a, r, life: inst.t + 0.5, tick: plan.tick || 0.7, tickMul: f.tick * 0.35, dmg: b.dmg }, bare, b.cast, b.index);
    }
    this.game.bus?.emit('bind', { source: src, target: a, seconds: inst.t, plan, weave: plan.weave, resisted });
    this.fx('bind', { body: hold, target: a, seconds: inst.t, plan, source: b, resisted });
    return inst.t;
  }

  _releaseHold(b, why) {
    const t = b.target;
    if (!t || t.removed || t.dead || why === 'dismiss') return;
    const f = bindFlavor(b.plan);
    // What the ring leaves when it lets go (vines on the feet, a song's lull).
    if (why === 'free' && isAlive(t)) for (const id of f.after) this.status.apply(t, id, { src: b.cast?.caster || null, potency: 0.9, power: b.dmg, ignoreImmunity: true });
    this.fx('unbind', { body: b, target: t });
  }

  // A word floating over someone ("Resisted"), never piled on itself.
  _floatText(a, text, color) {
    const k = `${a.uid ?? a.id}:${text}`;
    const m = this._floatAt || (this._floatAt = new Map());
    if (this.t - (m.get(k) ?? -9) < 1) return;
    m.set(k, this.t);
    if (m.size > 64) m.clear();
    try {
      this.game.bubbles?.number?.(a.x, a.y - 30, text, color, { kind: 'dot' });
    } catch {
      /* cosmetic */
    }
  }

  // ================================================================ ward (DESIGN §22.5)

  wardOn(a) {
    const l = this._wards;
    for (let i = 0; i < l.length; i++) {
      const w = l[i];
      if (w.active && !w.ending && w.target === a) return w;
    }
    return null;
  }

  // Is `a` someone the caster would shield (themself, a friend)?
  _wardable(caster, a) {
    if (!a || a.type !== 'actor' || a.removed || a.dead || !isAlive(a)) return false;
    if (a === caster) return true;
    if (this.isPlayer(caster)) return this.isFriendOfPlayer(a);
    return !!caster && factionRelation(caster.faction, a.faction) === 'ally';
  }

  // Who a ward cast shields: the friend it was aimed at (or standing on the aim point),
  // else — homing — whoever near is hurt worst, else the caster; then, for more wards,
  // the friends nearest the first.
  wardBearers(cast, plan, n = 1) {
    const caster = cast?.caster;
    if (!caster) return [];
    const cands = this._ensureCands();
    const reach = (plan?.aim?.range || plan?.range || 110) + 24;
    const near = (a, x, y, r) => (a.x - x) ** 2 + (a.y - y) ** 2 <= r * r;
    let first = null;
    const t = cast.target;
    if (t && t !== caster && this._wardable(caster, t) && near(t, caster.x, caster.y, reach)) first = t;
    if (!first) {
      const aim = this.aimOf(cast);
      if ((aim.x - caster.x) ** 2 + (aim.y - caster.y) ** 2 > 16 * 16) {
        let bd = 22 * 22;
        for (let i = 0; i < cands.length; i++) {
          const a = cands[i];
          if (a === caster || !this._wardable(caster, a)) continue;
          const d2 = (a.x - aim.x) ** 2 + (a.y - 6 - aim.y) ** 2;
          if (d2 < bd) {
            bd = d2;
            first = a;
          }
        }
      }
    }
    if (!first && plan?.seekHurt) {
      const frac = (a) => (a.maxHp > 0 ? a.hp / a.maxHp : 1);
      let best = caster;
      let bf = frac(caster);
      for (let i = 0; i < cands.length; i++) {
        const a = cands[i];
        if (a === caster || !this._wardable(caster, a) || !near(a, caster.x, caster.y, reach)) continue;
        if (frac(a) < bf - 0.05) {
          bf = frac(a);
          best = a;
        }
      }
      first = best;
    }
    const out = [first || caster];
    while (out.length < n) {
      let best = null;
      let bd = 90 * 90;
      const o = out[0];
      for (let i = 0; i < cands.length; i++) {
        const a = cands[i];
        if (out.includes(a) || !this._wardable(caster, a)) continue;
        const d2 = (a.x - o.x) ** 2 + (a.y - o.y) ** 2;
        if (d2 < bd) {
          bd = d2;
          best = a;
        }
      }
      if (!best) break;
      out.push(best);
    }
    return out;
  }

  // A second ward on a bearer: the same weave thickens the first (up to WARD_CAP of its
  // raising, and lasts longer); another weave takes its place, carrying half of what the
  // old one had left. Returns true when it was absorbed into the old one.
  _thicken(w, init, plan) {
    const same = w.plan && plan && String(w.plan.essences) === String(plan.essences) && w.plan.shape === plan.shape;
    const add = Math.max(0, Number(init.shield) || 0);
    if (!same) {
      init.shield = add + Math.max(0, w.shield) * 0.5;
      this.end(w, 'replace');
      return false;
    }
    w.shield = Math.min(Math.max(w.shieldMax, add) * WARD_CAP, w.shield + add);
    w.shieldMax = Math.max(w.shieldMax, w.shield);
    if (Number.isFinite(init.life)) w.life = Math.max(w.life, w.age + init.life);
    this.fx('ward_thicken', { body: w });
    return true;
  }

  // Each step a ward stands: its gifts (a water ward heals, earth and iron weigh on the
  // bearer), its ring of small shields (orbit), and the missiles it stops.
  wardStep(w, dt) {
    if (w.shield <= 0) {
      this.end(w, 'break');
      return;
    }
    const plan = w.plan;
    const f = plan.ward || wardFlavor(plan);
    const t = w.target;
    if (w.age < dt * 1.5) this.game.bus?.emit('ward', { caster: w.cast?.caster || null, bearer: t, shield: w.shield, plan });
    if (f.heal > 0 && t.hp < t.maxHp) this.heal(t, (t.maxHp || 0) * f.heal * dt, w);
    if (f.slow < 1) {
      w.braceT -= dt;
      if (w.braceT <= 0) {
        w.braceT = 0.5;
        this.status.apply(t, 'braced', { src: t, potency: 1, duration: 1.2 });
      }
    }
    if (plan.wardOrbit) {
      w.plateA += dt * 4;
      this._wardPlates(w);
      if (!w.active || w.ending) return;
    }
    this._wardShots(w, f);
  }

  // Where the orbit twist's three small shields are (written into out[0..5]).
  wardPlates(w, out) {
    const r = (w.cur || w.r) * 1.35;
    for (let i = 0; i < 3; i++) {
      const a = w.plateA + (i / 3) * TAU;
      out[i * 2] = w.x + Math.cos(a) * r;
      out[i * 2 + 1] = w.y + Math.sin(a) * r * 0.8;
    }
    return out;
  }

  _wardPlates(w) {
    const P = this._plates || (this._plates = new Float32Array(6));
    this.wardPlates(w, P);
    const list = this.cands;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a === w.target || !this.isFoe(w.cast, a)) continue;
      for (let k = 0; k < 3; k++) {
        const rr = 7 + (a.radius ?? 5);
        if ((a.x - P[k * 2]) ** 2 + (a.y - P[k * 2 + 1]) ** 2 > rr * rr) continue;
        const last = w.hits.get(a);
        if (last !== undefined && w.age - last < 0.5) break;
        w.hits.set(a, w.age);
        this.hit(w, a, 0.5, HIT_TICK);
        break;
      }
      if (!w.active || w.ending) return;
    }
  }

  // Is (x, y) inside the ward (or, for a ring of small shields, on one of them)?
  _inWard(w, x, y, R) {
    if (w.plan.wardOrbit) {
      const P = this._plates || (this._plates = new Float32Array(6));
      this.wardPlates(w, P);
      for (let k = 0; k < 3; k++) if ((x - P[k * 2]) ** 2 + (y - P[k * 2 + 1]) ** 2 <= (R * 0.45 + 4) ** 2) return true;
      return false;
    }
    return (x - w.x) ** 2 + (y - w.y) ** 2 <= R * R;
  }

  // Foes' arrows and bolts, foes' weaves and bosses' globs and bubbles: a ward stops
  // them (light and the bounce twist turn them back on whoever loosed them; wind and the
  // spiral twist turn them aside), paying for each out of its strength.
  _wardShots(w, f) {
    const bearer = w.target;
    const R = (w.cur || w.r) * (f.reach || 1) + 4;
    const reflect = !!(w.plan.reflect || f.reflect);
    const deflect = !reflect && !!(w.plan.deflect || f.deflect);
    const how = reflect ? 'reflect' : deflect ? 'deflect' : 'block';
    const pay = reflect ? 0.5 : deflect ? 0.35 : 1;
    const shots = this.shots;
    for (let i = 0; i < shots.length; i++) {
      const p = shots[i];
      if (p.removed || p.state !== 'fly' || p._wardSeen === w.uid) continue;
      if (!p.owner || p.owner === bearer || !this._harmableBy(bearer, p.owner)) continue;
      if (!this._inWard(w, p.x, p.y, R)) continue;
      p._wardSeen = w.uid;
      const cost = Number(p.damage) > 0 ? p.damage : 4;
      if (reflect) this._turnShot(w, p, true);
      else if (deflect) this._turnShot(w, p, false);
      else {
        p.state = 'spent';
        p.stateT = 0;
        this.game.entities?.remove?.(p);
      }
      this._wardTake(w, cost * pay, p.x, p.y - (p.z || 8), how);
      if (!w.active || w.ending) return;
    }
    const list = this.bodies;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o.active || o.ending || o.kind !== 'projectile' || o.mode === 'lob' || o.mode === 'fall' || o.wardSeen === w.uid) continue;
      const by = o.cast?.caster || o.owner;
      if (!by || by === bearer || by === w.cast?.caster || !this._harmableBy(bearer, by)) continue;
      if (!this._inWard(w, o.x, o.y, R + o.r)) continue;
      o.wardSeen = w.uid;
      const cost = o.dmg > 0 ? o.dmg : 4;
      if (reflect) {
        const ang = Math.atan2(by.y - o.y, by.x - o.x);
        const back = this.spawn('projectile', { mode: 'fly', x: o.x, y: o.y, angle: ang, speed: Math.max(160, o.speed), r: o.r, life: 1.4, range: 220, dmg: o.dmg, target: by, homing: 4 }, o.plan, w.cast, w.index);
        if (back) back.wardSeen = w.uid;
        this.end(o, 'wall');
      } else if (deflect) {
        const nx = o.x - w.x;
        const ny = o.y - w.y;
        const nl = Math.hypot(nx, ny) || 1;
        const side = o.vx * -ny + o.vy * nx >= 0 ? 1 : -1;
        const sp = Math.hypot(o.vx, o.vy) || o.speed;
        o.vx = ((-ny / nl) * side * 0.85 + (nx / nl) * 0.5) * sp;
        o.vy = ((nx / nl) * side * 0.85 + (ny / nl) * 0.5) * sp;
        o.target = null;
        o.homing = 0;
      } else this.end(o, 'wall');
      this._wardTake(w, cost * pay, o.x, o.y - (o.z || 8), how);
      if (!w.active || w.ending) return;
    }
    const hz = this.hazards;
    for (let i = 0; i < hz.length; i++) {
      const h = hz[i];
      if (h.done || h.removed || (h.kind !== 'glob' && h.kind !== 'bubble') || h.delay > 0 || (h.z || 0) > 26) continue;
      if (!h.owner || !this._harmableBy(bearer, h.owner)) continue;
      if (!this._inWard(w, h.x, h.y, R + (h.r || 8) * 0.4)) continue;
      const cost = (Number(h.owner.atk) || 8) * (Number(h.mul) || 0.4);
      try {
        h.end?.();
      } catch (err) {
        this.warn('ward hazard', err);
      }
      this._wardTake(w, cost * (how === 'block' ? 1 : 0.6), h.x, h.y - (h.z || 4), 'block', h.pal?.mid);
      if (!w.active || w.ending) return;
    }
  }

  // An arrow or bolt turned back at its archer (reflect) or sent skimming past (deflect).
  _turnShot(w, p, back) {
    const src = p.owner;
    const sp = (p.speed || Math.hypot(p.vx, p.vy) || 200) * (back ? 1.1 : 0.95);
    let ang;
    if (back) ang = src && !src.removed ? Math.atan2(src.y - p.y, src.x - p.x) : Math.atan2(-p.vy, -p.vx);
    else {
      const nx = p.x - w.x;
      const ny = p.y - w.y;
      const nl = Math.hypot(nx, ny) || 1;
      const side = p.vx * -ny + p.vy * nx >= 0 ? 1 : -1;
      ang = Math.atan2((nx / nl) * side * 0.85 + (ny / nl) * 0.5, (-ny / nl) * side * 0.85 + (nx / nl) * 0.5);
    }
    p.vx = Math.cos(ang) * sp;
    p.vy = Math.sin(ang) * sp;
    p.speed = sp;
    p.angle = ang;
    p.traveled = 0;
    p._tileX = -1;
    p._tileY = -1;
    if (back) {
      p.owner = w.target;
      p.target = src || null;
      p.homing = 3;
    } else {
      p.target = null;
      p.homing = 0;
    }
  }

  _wardTake(w, amount, x, y, how, color) {
    if (amount > 0) w.shield -= amount;
    w.hitT = this.t;
    this.fx('ward_block', { body: w, x, y, how, amount, color });
    if (w.shield <= 0.01) this.end(w, 'break');
  }

  // combat.damage asks before a blow lands: the part a ward takes (0: no ward). A song
  // ward also covers friends standing near its bearer. Blows from close by are answered
  // (next step) with the ward's essences: fire burns, frost chills, thorns scratch…
  absorb(target, amount, source, opts = {}) {
    if (!(amount > 0) || !target || !this._wards.length) return 0;
    if (opts.kind === 'oath' || opts.kind === 'fall') return 0;
    const w = this._wardFor(target);
    if (!w) return 0;
    const took = Math.min(w.shield, amount);
    if (!(took > 0)) return 0;
    w.shield -= took;
    w.hitT = this.t;
    const f = w.plan.ward || wardFlavor(w.plan);
    if (f.drink > 0) this.heal(target, took * f.drink, w);
    const src = source && source.type === 'projectile' ? source.owner || null : source;
    if (src && src.type === 'actor' && src !== target && src !== w.cast?.caster && !opts.dot && !opts.reaction && f.thorns > 0) {
      const reach = (w.cur || w.r) + (src.radius ?? 5) + 30;
      if ((src.x - w.x) ** 2 + (src.y - w.y) ** 2 <= reach * reach) this._retaliate.push(w, src);
    }
    this.fx('ward_hit', { body: w, target, x: target.x, y: target.y, amount: took, source: src, shared: target !== w.target });
    if (w.shield <= 0.01) this.end(w, 'break');
    return took;
  }

  _wardFor(target) {
    const l = this._wards;
    for (let i = 0; i < l.length; i++) {
      const w = l[i];
      if (w.active && !w.ending && w.target === target && w.shield > 0) return w;
    }
    for (let i = 0; i < l.length; i++) {
      const w = l[i];
      const share = w.plan?.ward?.share;
      if (!share || !w.active || w.ending || !(w.shield > 0)) continue;
      const r = share + (target.radius ?? 5);
      if ((target.x - w.x) ** 2 + (target.y - w.y) ** 2 > r * r) continue;
      if (this._wardable(w.cast?.caster || w.target, target)) return w;
    }
    return null;
  }

  // Blows the wards took last step, answered now (never inside combat.damage).
  _answerBlows() {
    const q = this._retaliate;
    for (let i = 0; i + 1 < q.length; i += 2) {
      const w = q[i];
      const a = q[i + 1];
      if (!w.active || w.ending || !isAlive(a) || !this.canAffect(w.cast, a)) continue;
      const last = w.hits.get(a);
      if (last !== undefined && w.age - last < 0.35) continue;
      w.hits.set(a, w.age);
      const f = w.plan.ward || wardFlavor(w.plan);
      this.hit(w, a, f.thorns, HIT);
    }
    q.length = 0;
  }

  _wardEnd(w, why) {
    const i = this._wards.indexOf(w);
    if (i >= 0) this._wards.splice(i, 1);
    const t = w.target;
    const f = w.plan.ward || wardFlavor(w.plan);
    if (t && f.slow < 1) this.status.remove(t, 'braced', true);
    if (w.plan.wardBurst && why !== 'dismiss' && why !== 'replace') {
      const broke = why === 'break';
      this.explode(w, w.x, w.y, 30 * Math.min(2, w.plan.size || 1) * (broke ? 1.2 : 1), broke ? 1.4 : 0.9, 'burst', true);
    }
    if (why === 'break') {
      this.fx('ward_break', { body: w });
      this.game.bus?.emit('ward_broken', { bearer: t, caster: w.cast?.caster || null, plan: w.plan });
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
      if ((g.state && g.state !== 'playing') || g.paused) return { ok: false, reason: 'busy', message: 'Not now.' };
      const left = this.cooldownOfPlan(r.plan);
      if (left > 0.001) return { ok: false, reason: 'cooldown', message: 'Not ready yet.', cooldown: left };
      const cost = this.costOf(caster, r.plan);
      const need = r.plan.input === 'hold' ? Math.min(cost, Math.max(2, cost * 0.35)) : cost;
      if (need > 0 && this.mana.cur + 1e-6 < need) return { ok: false, reason: 'mana', message: 'Not enough mana.', cost: need };
    }
    return { ok: true };
  }

  canCast(slot, caster = this.game.player) {
    const r = this._resolve(caster, slot);
    if (!r.ok) return { ok: false, reason: r.reason, message: r.message, plan: r.plan || null, cooldown: 0, cost: 0 };
    const c = this._check(caster, r);
    return { ok: c.ok, reason: c.reason || null, message: c.message || '', plan: r.plan, cooldown: this.isPlayer(caster) ? this.cooldownOfPlan(r.plan) : 0, cost: this.costOf(caster, r.plan) };
  }

  // The stat pipeline (DESIGN §26, game.stats) shapes what a weave asks of its weaver:
  // mana cost (overdraw makes it free), cooldown (Focus, charms) and cast speed (berserk,
  // emberblood). Without a pipeline the plan's own numbers stand.
  _stat(caster, id, dflt = 1) {
    const S = this.game.stats;
    if (!S || !caster || typeof S.get !== 'function') return dflt;
    const v = S.get(caster, id);
    return Number.isFinite(v) ? v : dflt;
  }

  costOf(caster, plan) {
    const base = plan?.cost || 0;
    if (!this.isPlayer(caster)) return base;
    return Math.round(base * this._stat(caster, 'manaCost', 1) * 10) / 10;
  }

  cooldownOf(caster, plan) {
    const base = plan?.cooldown || 0;
    if (!this.isPlayer(caster)) return base;
    const k = this._stat(caster, 'cooldown', 1) / Math.max(0.3, this._stat(caster, 'castSpeed', 1));
    return Math.max(BAL.COOLDOWN_MIN * 0.75, base * k);
  }

  // A cast pays when it leaves the hands: its mana, x(1 + k) for a charge of k, and its
  // cooldown starts.
  _pay(caster, r, cost, opts) {
    if (opts.free || !this.isPlayer(caster)) return;
    const k = Math.max(0, Math.min(1, Number(opts.chargeK) || 0));
    this.spendMana(this.costOf(caster, r.plan) * (1 + BAL.CHARGE_MANA * k));
    this._startCooldown(caster, r.plan);
  }

  // ---------------------------------------------------------------- cooldowns
  // A weave's cooldown follows the weave (plan.key: its parts), never its slot: moving
  // it to another slot or setting it again neither dodges nor hands on a timer.

  _startCooldown(caster, plan) {
    if (!plan?.key || !this.isPlayer(caster)) return;
    const cd = this.cooldownOf(caster, plan);
    if (cd > 0) this.weaveReady.set(plan.key, { until: this.t + cd, total: cd, plan });
  }

  // Seconds before a plan (a slot's or any weave's) can be cast again.
  cooldownOfPlan(plan) {
    const e = plan?.key ? this.weaveReady.get(plan.key) : null;
    return e ? Math.max(0, e.until - this.t) : 0;
  }

  cooldownLeft(i) {
    const plan = Number.isInteger(i) && this.slots[i] ? this.slotPlan(i) : null;
    return plan?.ok ? this.cooldownOfPlan(plan) : 0;
  }

  cooldownTotal(i) {
    const plan = Number.isInteger(i) && this.slots[i] ? this.slotPlan(i) : null;
    const e = plan?.ok && plan.key ? this.weaveReady.get(plan.key) : null;
    return e && e.until > this.t ? e.total : 0;
  }

  // 1 = just cast, 0 = ready.
  cooldownFraction(i) {
    const total = this.cooldownTotal(i);
    return total > 0 ? Math.max(0, Math.min(1, this.cooldownLeft(i) / total)) : 0;
  }

  resetCooldowns() {
    this.weaveReady.clear();
  }

  // Timers that ran out leave the map; a long one says so (the button's "ready" tick).
  _tickCooldowns() {
    if (!this.weaveReady.size) return;
    for (const [key, e] of this.weaveReady) {
      if (e.until > this.t) continue;
      this.weaveReady.delete(key);
      const P = this.game.player;
      if (P && e.plan) {
        this.fx('ready', { caster: P, plan: e.plan, total: e.total });
        this.game.bus?.emit('weave_ready', { key, plan: e.plan, total: e.total });
      }
    }
  }

  // Who and where a cast is aimed at. A friend counts as aimed at when the aim names
  // them (see aimedFriend: the aim on them, near them, or a straight weave's line through
  // them): never by auto-aim.
  _newCast(caster, plan, aim, o = {}) {
    const g = this.game;
    let target = aim?.target && aim.target.type === 'actor' && isAlive(aim.target) && aim.target !== caster ? aim.target : null;
    let assisted = false;
    let ax = Number.isFinite(aim?.x) ? aim.x : NaN;
    let ay = Number.isFinite(aim?.y) ? aim.y : NaN;
    const probe = { caster, friendly: true, target: null };
    if (!target && this.isPlayer(caster)) target = this.aimedFriend(caster, aim, plan);
    // Let go after a hold: a friend the aim named only at the last moment (she stepped into
    // the line, under the cursor) was not aimed at (FRIEND_STEADY).
    const s = o.steady;
    if (target && s && this.isPlayer(caster) && this.isFriendOfPlayer(target) && (s.friend !== target || s.t < Math.min(FRIEND_STEADY, s.held) - 1e-6)) target = null;
    if (!target && Number.isFinite(ax)) {
      let best = null;
      let bd = 14 * 14;
      for (const a of this._actors()) {
        if (a === caster || !isAlive(a)) continue;
        if (this.isPlayer(caster) && this.isFriendOfPlayer(a)) continue;
        const d2 = (a.x - ax) ** 2 + (a.y - 4 - ay) ** 2;
        const d2b = Math.min(d2, (a.x - ax) ** 2 + (a.y - ay) ** 2);
        if (d2b < bd && this.canAffect(probe, a)) {
          bd = d2b;
          best = a;
        }
      }
      target = best;
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
      // Homing weaves forgive a loose aim: the foe nearest the aim point becomes the mark.
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
      if (best) {
        target = best;
        assisted = true;
      }
    }
    if (target && !Number.isFinite(aim?.x)) {
      ax = target.x;
      ay = target.y;
    }
    // A shape that shields (benign: a ward) aimed at a friend is care, not harm: its
    // bursts and answers spare friends like any weave aimed at a foe.
    const friendly = !!(target && this.isPlayer(caster) && this.isFriendOfPlayer(target)) && !plan.shapeDef?.benign;
    const cast = {
      id: ++this._castSeq,
      caster,
      plan,
      target,
      friendly,
      trackTarget: !!target && (!Number.isFinite(aim?.x) || assisted),
      aimX: ax,
      aimY: ay,
      angle: Math.atan2(ay - caster.y, ax - caster.x) || 0,
      chargeK: Math.max(0, Math.min(1, o.chargeK || 0)),
      chargePower: Number.isFinite(plan.chargePower) ? plan.chargePower : BAL.CHARGE_POWER,
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
    // An echo or volley of a beam that was already let go comes out as a quick beam.
    ctx.held = cast.held && cast.holding !== false;
    ctx.chargeK = cast.chargeK;
    ctx.mover = null;
    ctx._i = 0;
    cast.curPlan = plan;
    cast.curMul = mul;
    cast.angle = angle;
    this._emitMul = mul * this.powerOf(caster) * (plan.shape === 'strike' && this.isPlayer(caster) ? this._stat(caster, 'strike', 1) : 1);
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

  // How hard a caster's weaves hit: the player grows with levels; anyone else may set
  // caster.magicPower (bosses).
  powerOf(caster) {
    if (Number.isFinite(caster?.magicPower)) return caster.magicPower;
    // The pipeline's weave power holds level, the Weave attribute, gear and prices.
    if (this.isPlayer(caster) && this.game.stats?.get) return this._stat(caster, 'spellPower', 1);
    if (this.isPlayer(caster)) return 1 + BAL.POWER_PER_LEVEL * (Math.max(1, caster.level || 1) - 1);
    return 1;
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
    let k = Math.max(0, Math.min(1, Number(opts.chargeK) || 0));
    if (k > 0 && !opts.free && this.isPlayer(caster)) k = Math.min(k, BAL.affordableK(this.mana.cur, this.costOf(caster, r.plan)));
    return this._fire(caster, r, aim, { ...opts, chargeK: k });
  }

  _fire(caster, r, aim, opts = {}) {
    const plan = r.plan;
    this._pay(caster, r, plan.cost, opts);
    const cast = this._newCast(caster, plan, aim, { chargeK: opts.chargeK, slot: r.slot, held: false, steady: opts.steady || null });
    this._emit(cast, plan, 1);
    this.game.bus?.emit('spell_cast', { caster, weave: plan.weave, plan, slot: r.slot, chargeK: cast.chargeK, target: cast.target });
    return { ok: true, plan, cast };
  }

  // Press: a beam starts pouring; anything else waits for the release, charging while it
  // is held (a charge-twist weave always, a tap weave when opts.charge asks: the controls
  // ask it for every press). Whatever this caster was already holding is let go first
  // (it fires), so one charge builds at a time.
  castStart(caster, slotOrWeave, aim, opts = {}) {
    const r = this._resolve(caster, slotOrWeave);
    if (!r.ok) return { ok: false, reason: r.reason, message: r.message, plan: r.plan || null };
    if (this.holds.has(caster)) this.castRelease(caster);
    const c = this._check(caster, r, opts);
    if (!c.ok) {
      this.fx('fizzle', { caster, reason: c.reason, plan: r.plan });
      return { ok: false, reason: c.reason, message: c.message, plan: r.plan, cooldown: c.cooldown || 0 };
    }
    const plan = r.plan;
    let mode = plan.input;
    if (mode === 'tap' && opts.charge) mode = 'charge';
    // (The aim keeps `auto`: an auto-aimed tap never names a friend, see aimedFriend.)
    const hold = { caster, r, plan, mode, t: 0, aim: { x: aim?.x, y: aim?.y, target: aim?.target || null, auto: !!aim?.auto }, cast: null, opts, k: 0, live: false, capped: false };
    // Who the aim names among friends, and for how long (FRIEND_STEADY).
    hold.friend = this.isPlayer(caster) ? this.aimedFriend(caster, hold.aim, plan) : null;
    hold.friendT = 0;
    this.holds.set(caster, hold);
    if (mode === 'hold') {
      hold.live = true;
      const full = this.costOf(caster, plan);
      const first = Math.min(full, Math.max(2, full * 0.35));
      if (!opts.free && this.isPlayer(caster) && first > 0) this.spendMana(first);
      hold.cast = this._newCast(caster, plan, aim, { slot: r.slot, held: true });
      hold.cast.holding = true;
      this._emit(hold.cast, plan, 1);
      this.game.bus?.emit('spell_cast', { caster, weave: plan.weave, plan, slot: r.slot, held: true, target: hold.cast.target });
      this.fx('beam_start', { cast: hold.cast, caster });
      caster.castMoveMul = BAL.CHARGE_MOVE;
    }
    return { ok: true, plan, mode };
  }

  castHold(caster, aim) {
    const h = this.holds.get(caster);
    if (!h) return null;
    if (aim) {
      if (Number.isFinite(aim.x)) h.aim.x = aim.x;
      if (Number.isFinite(aim.y)) h.aim.y = aim.y;
      if (aim.target !== undefined) h.aim.target = aim.target;
      if (aim.auto !== undefined) h.aim.auto = !!aim.auto;
      if (h.cast && Number.isFinite(aim.x) && Number.isFinite(aim.y)) {
        h.cast.aimX = aim.x;
        h.cast.aimY = aim.y;
        h.cast.trackTarget = false;
      }
    }
    return { mode: h.mode, t: h.t, k: h.k, live: h.live, capped: h.capped, plan: h.plan };
  }

  castRelease(caster, aim) {
    const h = this.holds.get(caster);
    if (!h) return { ok: false, reason: 'empty', message: 'Nothing is being woven.' };
    if (aim) this.castHold(caster, aim);
    this.holds.delete(caster);
    caster.castMoveMul = 1;
    if (h.mode === 'hold') {
      this._endHeld(h);
      if (!h.opts.free) this._startCooldown(caster, h.plan);
      return { ok: true, plan: h.plan };
    }
    const c = this._check(caster, h.r, h.opts);
    if (!c.ok) {
      this.fx('fizzle', { caster, reason: c.reason, plan: h.plan });
      // The charge's swell stops with it.
      this.fx('charge', { caster, plan: h.plan, k: 0, cancel: true });
      return { ok: false, reason: c.reason, message: c.message, plan: h.plan };
    }
    let k = h.mode === 'charge' ? h.k : 0;
    if (k > 0 && !h.opts.free && this.isPlayer(caster)) k = Math.min(k, BAL.affordableK(this.mana.cur, this.costOf(caster, h.plan)));
    const a = h.aim;
    return this._fire(caster, h.r, { x: a.x, y: a.y, target: a.target, auto: a.auto }, { ...h.opts, chargeK: k, steady: { friend: h.friend || null, t: h.friendT || 0, held: h.t } });
  }

  // Let go without casting: a charge costs nothing; a beam already poured keeps its
  // cooldown (as long as letting it go would).
  castCancel(caster) {
    const h = this.holds.get(caster);
    if (!h) return false;
    this.holds.delete(caster);
    if (caster) caster.castMoveMul = 1;
    if (h.mode === 'hold') {
      this._endHeld(h);
      if (!h.opts.free) this._startCooldown(caster, h.plan);
    }
    this.fx('charge', { caster, plan: h.plan, k: 0, cancel: true, quiet: !h.live });
    return true;
  }

  // A status froze or stunned the caster: whatever they were holding stops.
  interruptHold(a) {
    if (this.holds.has(a)) this.castCancel(a);
  }

  holdOf(caster) {
    const h = this.holds.get(caster);
    return h ? { mode: h.mode, t: h.t, k: h.k, live: h.live, capped: h.capped, plan: h.plan, aim: h.aim } : null;
  }

  _endHeld(h) {
    if (h.cast) h.cast.holding = false;
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
      // Whom the aim names among friends, and since when (FRIEND_STEADY).
      if (h.mode !== 'hold' && this.isPlayer(caster)) {
        const f = this.aimedFriend(caster, h.aim, h.plan);
        if (f !== h.friend) {
          h.friend = f;
          h.friendT = 0;
        } else h.friendT = (h.friendT || 0) + dt;
      }
      if (h.mode === 'charge') {
        // A tap until CHARGE_DEAD; then it gathers (the walk slows, the swell starts) to a
        // full charge, never past what the mana in hand can pay for when it is let go.
        const player = this.isPlayer(caster);
        const cs = player ? this._stat(caster, 'castSpeed', 1) : 1;
        const time = h.plan.charge || BAL.CHARGE_TIME;
        let k = BAL.chargeK(h.t, time, cs);
        if (!h.live && h.t >= BAL.CHARGE_DEAD) {
          h.live = true;
          caster.castMoveMul = BAL.CHARGE_MOVE;
          this.fx('charge', { caster, plan: h.plan, k: 0, start: true, rise: Math.max(0.1, (time - BAL.CHARGE_DEAD) / Math.max(0.3, cs)) });
        }
        h.capped = false;
        if (player && !h.opts.free) {
          const most = BAL.affordableK(this.mana.cur, this.costOf(caster, h.plan));
          if (k > most + 1e-4) {
            k = most;
            h.capped = true;
          }
        }
        if (k >= 1 && h.k < 1) this.fx('charge', { caster, plan: h.plan, k: 1, full: true });
        h.k = k;
      } else if (h.mode === 'hold') {
        h.k = 1;
        if (!h.opts.free && this.isPlayer(caster)) {
          const need = (h.plan.drain || h.plan.cost) * this._stat(caster, 'manaCost', 1) * dt;
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

  // growFills: a level or a mission's gift fills the new room; gear and buffs (the stat
  // pipeline syncing) only move the ceiling.
  _recomputeMax(fill = 0, growFills = true) {
    const P = this.game.player;
    const S = this.game.stats;
    let max;
    if (P && S?.get && S.isManaged?.(P)) max = Math.round(Math.min(BAL.MANA_CAP, Math.max(5, S.get(P, 'maxMana'))));
    else {
      const lvl = Math.max(1, P?.level || 1);
      max = Math.min(BAL.MANA_CAP, BAL.MANA_START + (lvl - 1) * BAL.MANA_PER_LEVEL + this.manaBonus);
    }
    const grew = max - this.mana.max;
    this.mana.max = max;
    this.mana.cur = Math.min(max, this.mana.cur + Math.max(0, fill, growFills && grew > 0 ? grew : 0));
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
    const k = this._stat(this.game.player, 'manaRegen', 1);
    if (!(k > 0)) return;
    m.cur = Math.min(m.max, m.cur + (BAL.MANA_REGEN + m.max * BAL.MANA_REGEN_SHARE) * k * dt);
    this._manaEvent(false);
  }

  compile(weave) {
    return compileWeave(weave, { unlocked: this.unlocked, maxEssences: this.essenceSlots, maxTwists: this.twistSlots, maxPrices: this.priceSlots });
  }

  validate(weave) {
    return validateWeave(weave, { unlocked: this.unlocked, maxEssences: this.essenceSlots, maxTwists: this.twistSlots, maxPrices: this.priceSlots });
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
    this.slots[i] = { id: n.id || `weave${i}_${Date.now().toString(36)}`, name: n.name, shape: n.shape, essences: n.essences, twists: n.twists, prices: n.prices };
    this._planCache.delete(i);
    this.game.bus?.emit('weave_slots', { slot: i, weave: this.slots[i] });
    return { ok: true, plan: this.slotPlan(i) };
  }

  isUnlocked(kind, id) {
    const set = this.unlocked[KIND_SETS[kind]];
    return !!set && set.has(id);
  }

  // What the player has really earned: the same as `unlocked`, except while "Try all
  // magic" runs (then `unlocked` holds everything and this the real sets). Rewards,
  // mission offers and boss drops ask this, so a trial never hides a real reward.
  get realUnlocked() {
    return this.trial ? this.trial.unlocked : this.unlocked;
  }

  isEarned(kind, id) {
    const set = this.realUnlocked[KIND_SETS[kind]];
    return !!set && set.has(id);
  }

  // Every component reaches the player through here (missions, bosses, the dev helper).
  // While a trial runs, a real reward goes into the real sets too (and is announced as
  // new), so it is still there when the trial ends.
  unlock(kind, id, source = null) {
    const k = KIND_SETS[kind];
    if (!k || !REGISTRY[k].has(id)) return false;
    const set = this.unlocked[k];
    const real = this.trial ? this.trial.unlocked[k] : set;
    if (real.has(id)) return false;
    real.add(id);
    set.add(id);
    if (source != null) {
      this.sources[`${KIND_ONE[k]}:${id}`] = source;
      if (this.trial) this.trial.sources[`${KIND_ONE[k]}:${id}`] = source;
    }
    this._unlockStamp = (this._unlockStamp || 0) + 1;
    this.game.bus?.emit('magic_unlocked', { kind: KIND_ONE[k], id, source });
    return true;
  }

  // Slot counts: a trial shows the most; what is earned meanwhile counts for real.
  _grow(field, max, kind) {
    const T = this.trial;
    const cur = T ? T[field] : this[field];
    if (cur >= max) return false;
    if (T) T[field] = cur + 1;
    else this[field] = cur + 1;
    if (kind !== 'slot') this._unlockStamp = (this._unlockStamp || 0) + 1;
    this.game.bus?.emit('magic_unlocked', { kind, id: String(cur + 1), source: null });
    return true;
  }

  unlockSlot() {
    return this._grow('slotCount', BAL.SLOTS_MAX, 'slot');
  }

  unlockEssenceSlot() {
    return this._grow('essenceSlots', BAL.ESSENCE_SLOTS_MAX, 'essence_slot');
  }

  unlockTwistSlot() {
    return this._grow('twistSlots', BAL.TWIST_SLOTS_MAX, 'twist_slot');
  }

  // ---------------------------------------------------------------- "Try all magic"
  // (Settings → Game → Practice; the author: "a thing that gives me all the magic stuff
  // to try it"). On: every shape, essence, twist and price, six weave slots, three
  // essences and four twists to a weave (source 'trial'); the mana stays as it is. The
  // real state is kept aside. Off: the real unlocks, slot counts and weaves come back; a
  // weave made meanwhile that the real unlocks can weave stays in its slot, any other
  // goes to the Spellbook's drafts; prices still running that were not really earned end.
  // Rewards earned during the trial are real (unlock above). Saved with the game.

  startTrial() {
    if (this.trial) return false;
    const copy = (u) => ({ shapes: new Set(u.shapes), essences: new Set(u.essences), twists: new Set(u.twists), prices: new Set(u.prices) });
    this.trial = {
      unlocked: copy(this.unlocked),
      sources: { ...this.sources },
      slotCount: this.slotCount,
      essenceSlots: this.essenceSlots,
      twistSlots: this.twistSlots,
      slots: this.slots.map((w) => (w ? cloneWeave(w) : null)),
    };
    const all = copy(this.unlocked);
    for (const k of ['shapes', 'essences', 'twists', 'prices']) {
      for (const id of REGISTRY[k].ids()) {
        if (all[k].has(id)) continue;
        all[k].add(id);
        this.sources[`${KIND_ONE[k]}:${id}`] = 'trial';
      }
    }
    this.unlocked = all;
    this.slotCount = BAL.SLOTS_MAX;
    this.essenceSlots = BAL.ESSENCE_SLOTS_MAX;
    this.twistSlots = BAL.TWIST_SLOTS_MAX;
    this._trialChanged(true);
    return true;
  }

  endTrial() {
    const T = this.trial;
    if (!T) return false;
    const made = this.slots.map((w) => (w ? cloneWeave(w) : null));
    this.trial = null;
    this.unlocked = T.unlocked;
    this.sources = T.sources;
    this.slotCount = T.slotCount;
    this.essenceSlots = T.essenceSlots;
    this.twistSlots = T.twistSlots;
    this._planCache.clear();
    for (let i = 0; i < BAL.SLOTS_MAX; i++) {
      const now = made[i];
      const before = T.slots[i] || null;
      if (now && i < this.slotCount && this.validate(now).ok) {
        this.slots[i] = now;
        continue;
      }
      if (now && !sameParts(now, before)) this._keepDraft(now);
      this.slots[i] = i < this.slotCount ? before : null;
    }
    // Prices still running that were only borrowed end now (their modifiers go too).
    try {
      this.game.prices?.endRunning?.(this.unlocked.prices, 'trial');
    } catch (err) {
      this.warn('end trial prices', err);
    }
    // A hold on a weave that is no longer there lets go.
    for (const caster of [...this.holds.keys()]) this.castCancel(caster);
    this._trialChanged(false);
    return true;
  }

  _trialChanged(on) {
    this._unlockStamp = (this._unlockStamp || 0) + 1;
    this._planCache.clear();
    const bus = this.game.bus;
    bus?.emit('magic_trial', { on });
    for (let i = 0; i < BAL.SLOTS_MAX; i++) bus?.emit('weave_slots', { slot: i, weave: this.slots[i] });
    bus?.emit('magic_loaded', { trial: on });
  }

  // A weave from a trial, kept for the Spellbook (newest first, no two alike, a few).
  _keepDraft(w) {
    const list = this.trialDrafts.filter((d) => !sameParts(d, w));
    list.unshift(cloneWeave(w));
    this.trialDrafts = list.slice(0, BAL.SLOTS_MAX);
  }

  // The Spellbook took a draft back (it was woven into a slot, or thrown away).
  dropDraft(i) {
    if (!Number.isInteger(i) || i < 0 || i >= this.trialDrafts.length) return false;
    this.trialDrafts.splice(i, 1);
    this.game.bus?.emit('weave_slots', { slot: -1, weave: null });
    return true;
  }

  // Developer helper for testing (not shown in any UI): everything, every slot, for good.
  // (Players use "Try all magic", which can be turned off again.)
  unlockAll() {
    for (const k of ['shapes', 'essences', 'twists', 'prices']) for (const id of REGISTRY[k].ids()) this.unlock(k, id, 'dev');
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
      prices: pick('prices', Prices, (d) => ({ adj: d.adj, gain: d.gainText, cost: d.costText, color: d.color })),
      limits: { slots: this.slotCount, essences: this.essenceSlots, twists: this.twistSlots, prices: this.priceSlots },
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
    const hz = this.hazards;
    out.length = 0;
    shots.length = 0;
    hz.length = 0;
    const list = this.game.entities?.list || this.game.entities?.all?.() || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || e.removed) continue;
      if (e.type === 'actor') {
        if (!e.dead && isAlive(e)) out.push(e);
      } else if (e.type === 'projectile') shots.push(e);
      else if (e.type === 'hazard') hz.push(e);
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
    this._tickCooldowns();
    this._regen(dt);
    this._buildCandidates();
    if (this._retaliate.length) this._answerBlows();
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
      this._body = b;
      try {
        KIND_UPDATE[b.kind](this, b, dt);
      } catch (err) {
        this.warn(`update ${b.kind}`, err);
        this._body = null;
        this.end(b, 'error');
        continue;
      }
      this._body = null;
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
      if (this._numbersLive) this._flushNumbers();
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
        // What lies on the ground spares friends, aimed at one or not.
        if (!this.canAffect(d.cast, a) || (this.isPlayer(d.cast.caster) && this.isFriendOfPlayer(a))) continue;
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
    const R = this.trial || this; // the real state, also while a trial runs
    const u = R.unlocked;
    return {
      v: 1,
      unlocked: { shapes: [...u.shapes], essences: [...u.essences], twists: [...u.twists], prices: [...u.prices] },
      sources: { ...R.sources },
      slots: R.slots.map(plainWeave),
      slotCount: R.slotCount,
      essenceSlots: R.essenceSlots,
      twistSlots: R.twistSlots,
      mana: { cur: Math.round(this.mana.cur * 10) / 10, max: this.mana.max },
      manaBonus: this.manaBonus,
      // "Try all magic": the save keeps the real state above (never the borrowed parts)
      // and the trial's own slots, so loading it with the trial on keeps it on.
      trial: this.trial ? { slots: this.slots.map(plainWeave) } : null,
      drafts: this.trialDrafts.map(plainWeave),
    };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    this.trial = null;
    const u = d.unlocked || {};
    for (const k of ['shapes', 'essences', 'twists', 'prices']) {
      const set = new Set(k === 'shapes' ? ['bolt'] : k === 'essences' ? ['raw'] : []);
      for (const id of Array.isArray(u[k]) ? u[k] : []) if (typeof id === 'string' && REGISTRY[k].has(id)) set.add(id);
      this.unlocked[k] = set;
    }
    this.sources = d.sources && typeof d.sources === 'object' ? { ...d.sources } : {};
    const clampInt = (v, lo, hi, dflt) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : dflt);
    this.slotCount = clampInt(d.slotCount, BAL.SLOTS_START, BAL.SLOTS_MAX, BAL.SLOTS_START);
    this.essenceSlots = clampInt(d.essenceSlots, BAL.ESSENCE_SLOTS_START, BAL.ESSENCE_SLOTS_MAX, BAL.ESSENCE_SLOTS_START);
    this.twistSlots = clampInt(d.twistSlots, BAL.TWIST_SLOTS_START, BAL.TWIST_SLOTS_MAX, BAL.TWIST_SLOTS_START);
    if (Array.isArray(d.slots)) for (let i = 0; i < BAL.SLOTS_MAX; i++) this.slots[i] = readWeave(d.slots[i]);
    this.manaBonus = Number.isFinite(d.manaBonus) ? d.manaBonus : 0;
    this.trialDrafts = (Array.isArray(d.drafts) ? d.drafts : []).map(readWeave).filter(Boolean).slice(0, BAL.SLOTS_MAX);
    this._planCache.clear();
    // Saved with the trial on: it starts again over the real state, with its own slots.
    if (d.trial && typeof d.trial === 'object') {
      this.startTrial();
      const ts = Array.isArray(d.trial.slots) ? d.trial.slots : [];
      for (let i = 0; i < BAL.SLOTS_MAX; i++) this.slots[i] = readWeave(ts[i]);
      this._planCache.clear();
    }
    this._unlockStamp = (this._unlockStamp || 0) + 1;
    this._recomputeMax();
    if (Number.isFinite(d.mana?.cur)) this.mana.cur = Math.max(0, Math.min(this.mana.max, d.mana.cur));
    this.weaveReady.clear();
    this._manaEvent(true);
  }
}

export { BAL as BALANCE };
