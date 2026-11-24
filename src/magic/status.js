import { defineRegistry } from './registry.js';

// Statuses and reactions (DESIGN §22.1). Any actor can carry statuses: the player, Lyra,
// villagers, creatures, bosses. A status is data plus optional hooks; a reaction fires
// when a target already carrying one tag is touched by another (wet + shock, fire + wind…).
// Neither list knows about shapes, essences or twists, so new entries work with all of them.
//
// STATUS entry format (get() fills the rest):
// {
//   id: 'burning', name: 'Burning', tags: ['fire', 'hot'],
//   color: '#ff9a3c', overlay: 'flame',   how fx / the fallback show it on the actor
//   duration: 3,          seconds at potency 1 (potency scales it 0.6..1)
//   stack: 'refresh' | 'add' | 'extend',   refresh = longest wins; add = +1 stack (to
//   maxStacks: 1,                          maxStacks) and refresh; extend = add time
//   tick: 0.5, dot: 0.3,  damage per second = dot x the hit's damage x potency x stacks
//   move: 1,              walk speed multiplier at full potency (0.6 = 40% slower)
//   disable: false,       cannot move or act (stun, freeze, stagger)
//   root: false,          cannot move, can act (Actor.rootTime)
//   charm: false,         fights for the caster's side
//   dmgTaken: 1, dmgDealt: 1,   multipliers while it lasts
//   cc: false,            hard control: shortened on bosses (superArmor / ccResist)
//   immunity: 0,          seconds after it ends before it can land again
//   chance: 1,            chance to land per hit
//   cleanses: ['burning'],      statuses it washes off when it lands
//   becomes: { at: 3, id: 'frozen' },   at N stacks it turns into another status
//   onApply(sys, actor, inst), onTick(sys, actor, inst, dt), onExpire(sys, actor, inst)
// }
// An instance on an actor: { id, def, t, dur, stacks, potency, src, power, tickT, aux }.
// actor.magicStatus = [instances]; actor.statusFlags = { disabled, moveMul, rooted,
// dmgTaken, dmgDealt, charmedBy, count } (AI, combat and fx read these).

export const STATUSES = {
  burning: {
    name: 'Burning',
    tags: ['fire', 'hot'],
    color: '#ff9a3c',
    overlay: 'flame',
    duration: 3,
    tick: 0.5,
    dot: 0.32,
    cleanses: ['chilled'],
  },
  soaked: {
    name: 'Soaked',
    tags: ['wet'],
    color: '#5fbdf0',
    overlay: 'drip',
    duration: 5,
    move: 0.88,
    cleanses: ['burning'],
  },
  chilled: {
    name: 'Chilled',
    tags: ['cold'],
    color: '#9fe3ff',
    overlay: 'rime',
    duration: 3,
    stack: 'add',
    maxStacks: 3,
    move: 0.62,
    becomes: { at: 3, id: 'frozen' },
  },
  frozen: {
    name: 'Frozen',
    tags: ['cold', 'frozen', 'ice'],
    color: '#dff6ff',
    overlay: 'ice',
    duration: 1.6,
    disable: true,
    cc: true,
    immunity: 3,
    dmgTaken: 1.15,
    cleanses: ['chilled'],
  },
  shocked: {
    name: 'Shocked',
    tags: ['shock'],
    color: '#ffe45c',
    overlay: 'sparks',
    duration: 2.5,
    tick: 0.5,
    dot: 0.14,
    // Every so often the shock seizes the body for a heartbeat.
    onTick(sys, a, inst, dt) {
      inst.aux -= dt;
      if (inst.aux <= 0) {
        inst.aux = 1.1;
        sys.jolt(a, 0.18 * (0.6 + 0.4 * inst.potency));
      }
    },
  },
  staggered: {
    name: 'Staggered',
    tags: ['earth', 'heavy'],
    color: '#e8c48a',
    overlay: 'stars',
    duration: 0.5,
    disable: true,
    cc: true,
    immunity: 1.6,
  },
  knocked: {
    name: 'Knocked',
    tags: ['air'],
    color: '#c8fff0',
    overlay: 'gust',
    duration: 0.35,
    disable: true,
    cc: true,
    immunity: 1,
  },
  rooted: {
    name: 'Rooted',
    tags: ['plant', 'nature'],
    color: '#7ed957',
    overlay: 'vines',
    duration: 1.8,
    root: true,
    cc: true,
    immunity: 2.5,
  },
  poisoned: {
    name: 'Poisoned',
    tags: ['poison', 'toxic'],
    color: '#a6e22e',
    overlay: 'bubbles',
    duration: 5,
    stack: 'add',
    maxStacks: 5,
    tick: 0.5,
    dot: 0.13,
  },
  dazzled: {
    name: 'Dazzled',
    tags: ['light'],
    color: '#fff2c0',
    overlay: 'glare',
    duration: 2.5,
    move: 0.85,
    dmgDealt: 0.65,
  },
  drained: {
    name: 'Drained',
    tags: ['dark'],
    color: '#9a5cff',
    overlay: 'wisps',
    duration: 3,
    tick: 0.5,
    dot: 0.1,
    dmgDealt: 0.75,
    onDot(sys, a, inst, dealt) {
      if (dealt > 0) sys.healSource(inst, dealt * 0.5);
    },
  },
  sundered: {
    name: 'Sundered',
    tags: ['metal'],
    color: '#c9d3e0',
    overlay: 'cracks',
    duration: 4,
    dmgTaken: 1.3,
  },
  charmed: {
    name: 'Charmed',
    tags: ['song', 'charm'],
    color: '#ff9ad5',
    overlay: 'hearts',
    duration: 4,
    chance: 0.35,
    charm: true,
    cc: true,
    immunity: 8,
  },
  stunned: {
    name: 'Stunned',
    tags: ['stun'],
    color: '#fff07a',
    overlay: 'stars',
    duration: 1,
    disable: true,
    cc: true,
    immunity: 2,
  },
  slowed: {
    name: 'Mired',
    tags: ['mud', 'slow'],
    color: '#8a6a3e',
    overlay: 'mud',
    duration: 3,
    move: 0.5,
  },
  blinded: {
    name: 'Blinded',
    tags: ['steam', 'blind'],
    color: '#e8eef2',
    overlay: 'steam',
    duration: 2.2,
    move: 0.72,
    dmgDealt: 0.45,
  },
};

function fillStatus(raw, id) {
  const name = raw.name || id.charAt(0).toUpperCase() + id.slice(1);
  return {
    ...raw,
    name,
    tags: Array.isArray(raw.tags) && raw.tags.length ? raw.tags : [id],
    color: raw.color || '#ffffff',
    overlay: raw.overlay || 'tint',
    duration: Number.isFinite(raw.duration) ? raw.duration : 2,
    stack: raw.stack === 'add' || raw.stack === 'extend' ? raw.stack : 'refresh',
    maxStacks: Math.max(1, raw.maxStacks || 1),
    tick: Number.isFinite(raw.tick) ? raw.tick : 0.5,
    dot: Number.isFinite(raw.dot) ? raw.dot : 0,
    move: Number.isFinite(raw.move) ? raw.move : 1,
    disable: !!raw.disable,
    root: !!raw.root,
    charm: !!raw.charm,
    dmgTaken: Number.isFinite(raw.dmgTaken) ? raw.dmgTaken : 1,
    dmgDealt: Number.isFinite(raw.dmgDealt) ? raw.dmgDealt : 1,
    cc: !!raw.cc,
    immunity: Number.isFinite(raw.immunity) ? raw.immunity : 0,
    chance: Number.isFinite(raw.chance) ? raw.chance : 1,
    cleanses: Array.isArray(raw.cleanses) ? raw.cleanses : [],
    becomes: raw.becomes && raw.becomes.id ? raw.becomes : null,
  };
}

export const Statuses = defineRegistry('status', STATUSES, fillStatus);
export const getStatus = (id) => Statuses.get(id);

// REACTIONS: one entry per tag pair. `tags: [a, b]` fires when a target carrying a status
// tagged `a` is touched by something tagged `b` (or the other way round). `consume`
// removes statuses (by id) as the reaction spends them. effect(sys, target, info) with
// info = { src, x, y, power, tags } — power is the damage of the touch that caused it.
// sys helpers: apply, remove, has, areaDamage, spread, damage, healArea, fx.
export const REACTIONS = [
  {
    id: 'arc_shock',
    name: 'Arc Shock',
    tags: ['wet', 'shock'],
    color: '#fff07a',
    cooldown: 1.6,
    consume: ['soaked'],
    effect(sys, t, info) {
      sys.apply(t, 'stunned', { src: info.src, potency: 1, power: info.power });
      sys.areaDamage(info.src, t.x, t.y, 60, info.power * 0.6, { type: 'storm', exclude: t, status: 'shocked', max: 3, link: t });
    },
  },
  {
    id: 'freeze',
    name: 'Freeze',
    tags: ['wet', 'cold'],
    color: '#dff6ff',
    cooldown: 3,
    consume: ['soaked', 'chilled'],
    effect(sys, t, info) {
      sys.apply(t, 'frozen', { src: info.src, potency: 1.25, power: info.power });
    },
  },
  {
    id: 'firestorm',
    name: 'Firestorm',
    tags: ['fire', 'air'],
    color: '#ff7a2a',
    cooldown: 2,
    effect(sys, t, info) {
      sys.areaDamage(info.src, t.x, t.y, 46, info.power * 0.5, { type: 'fire', status: 'burning' });
    },
  },
  {
    id: 'wildfire',
    name: 'Wildfire',
    tags: ['fire', 'plant'],
    color: '#ff6a1a',
    cooldown: 2.2,
    consume: ['rooted'],
    effect(sys, t, info) {
      sys.areaDamage(info.src, t.x, t.y, 42, info.power * 0.9, { type: 'fire', status: 'burning' });
    },
  },
  {
    id: 'scalding_steam',
    name: 'Scalding Steam',
    tags: ['fire', 'wet'],
    color: '#e8eef2',
    cooldown: 2,
    consume: ['soaked', 'burning'],
    effect(sys, t, info) {
      sys.areaDamage(info.src, t.x, t.y, 38, info.power * 0.55, { type: 'water', status: 'blinded' });
    },
  },
  {
    id: 'mud',
    name: 'Mud',
    tags: ['earth', 'wet'],
    color: '#8a6a3e',
    cooldown: 2.5,
    consume: ['soaked'],
    effect(sys, t, info) {
      sys.areaDamage(info.src, t.x, t.y, 34, info.power * 0.2, { type: 'earth', status: 'slowed' });
    },
  },
  {
    id: 'eclipse',
    name: 'Eclipse',
    tags: ['light', 'dark'],
    color: '#c9a6ff',
    cooldown: 3,
    consume: ['dazzled', 'drained'],
    effect(sys, t, info) {
      sys.areaDamage(info.src, t.x, t.y, 48, info.power * 1.4, { type: 'dark', status: 'stunned' });
    },
  },
  {
    id: 'toxic_flare',
    name: 'Toxic Flare',
    tags: ['poison', 'fire'],
    color: '#c6ff3a',
    cooldown: 2,
    consume: ['poisoned'],
    effect(sys, t, info) {
      const stacks = info.consumed?.poisoned?.stacks || 1;
      sys.areaDamage(info.src, t.x, t.y, 40, info.power * (0.5 + 0.3 * stacks), { type: 'poison', status: 'burning' });
    },
  },
  {
    id: 'conducted_bolt',
    name: 'Conducted Bolt',
    tags: ['metal', 'shock'],
    color: '#ffffff',
    cooldown: 1.8,
    effect(sys, t, info) {
      sys.damage(info.src, t, info.power * 1.2, 'storm');
      sys.apply(t, 'stunned', { src: info.src, potency: 0.7, power: info.power });
    },
  },
  {
    id: 'shatter',
    name: 'Shatter',
    tags: ['frozen', 'heavy'],
    color: '#ffffff',
    cooldown: 2,
    consume: ['frozen'],
    effect(sys, t, info) {
      sys.damage(info.src, t, info.power * 1.6, 'frost');
      sys.areaDamage(info.src, t.x, t.y, 30, info.power * 0.4, { type: 'frost', exclude: t, status: 'chilled' });
    },
  },
  {
    id: 'shatter_iron',
    name: 'Shatter',
    tags: ['frozen', 'metal'],
    color: '#ffffff',
    cooldown: 2,
    consume: ['frozen'],
    effect(sys, t, info) {
      sys.damage(info.src, t, info.power * 1.5, 'iron');
    },
  },
  {
    id: 'thaw',
    name: 'Thaw',
    tags: ['frozen', 'fire'],
    color: '#bfe6ff',
    cooldown: 2,
    consume: ['frozen'],
    effect(sys, t, info) {
      sys.damage(info.src, t, info.power * 0.9, 'fire');
      sys.apply(t, 'soaked', { src: info.src, potency: 1, power: info.power });
    },
  },
  {
    id: 'miasma',
    name: 'Miasma',
    tags: ['poison', 'air'],
    color: '#a6e22e',
    cooldown: 2.2,
    effect(sys, t, info) {
      sys.areaDamage(info.src, t.x, t.y, 52, info.power * 0.25, { type: 'poison', status: 'poisoned', exclude: t });
    },
  },
  {
    id: 'overgrowth',
    name: 'Overgrowth',
    tags: ['plant', 'wet'],
    color: '#5fd36a',
    cooldown: 3,
    effect(sys, t, info) {
      sys.remove(t, 'rooted');
      sys.apply(t, 'rooted', { src: info.src, potency: 1.6, power: info.power, ignoreImmunity: true });
    },
  },
  {
    id: 'tempest',
    name: 'Tempest',
    tags: ['shock', 'air'],
    color: '#e6fbff',
    cooldown: 2,
    effect(sys, t, info) {
      sys.areaDamage(info.src, t.x, t.y, 50, info.power * 0.5, { type: 'storm', status: 'shocked', knock: 140 });
    },
  },
  {
    id: 'bloom',
    name: 'Bloom',
    tags: ['light', 'plant'],
    color: '#c6f59a',
    cooldown: 4,
    effect(sys, t, info) {
      sys.healArea(info.src, t.x, t.y, 64, info.power * 0.5);
    },
  },
  {
    id: 'dirge',
    name: 'Dirge',
    tags: ['song', 'dark'],
    color: '#8a3f9e',
    cooldown: 3,
    effect(sys, t, info) {
      sys.apply(t, 'stunned', { src: info.src, potency: 1.2, power: info.power });
    },
  },
  {
    id: 'prism',
    name: 'Prism',
    tags: ['light', 'wet'],
    color: '#ffffff',
    cooldown: 2.5,
    effect(sys, t, info) {
      sys.areaDamage(info.src, t.x, t.y, 50, info.power * 0.3, { type: 'light', status: 'dazzled' });
    },
  },
];

// Tag -> reactions that involve it (rebuilt when REACTIONS changes length).
let reactionIndex = null;
let reactionIndexLen = -1;
export function reactionsFor(tag) {
  if (!reactionIndex || reactionIndexLen !== REACTIONS.length) {
    reactionIndex = new Map();
    reactionIndexLen = REACTIONS.length;
    for (const r of REACTIONS) {
      if (!r || !Array.isArray(r.tags) || r.tags.length < 2) continue;
      for (const t of r.tags) {
        if (!reactionIndex.has(t)) reactionIndex.set(t, []);
        reactionIndex.get(t).push(r);
      }
    }
  }
  return reactionIndex.get(tag) || EMPTY;
}

const EMPTY = [];
const REACTION_WINDOW = 0.25; // at most REACTION_BURST reactions world-wide per window
const REACTION_BURST = 10;
const CC_BOSS = 0.35; // hard control lasts this share on bosses and super-armored foes

function newFlags() {
  return { disabled: false, moveMul: 1, rooted: false, dmgTaken: 1, dmgDealt: 1, charmedBy: null, count: 0 };
}

// Hook an actor's walk speed so every controller (creature AI, villagers, Lyra, the
// player) slows down without knowing about statuses: reads give base x moveMul.
function hookSpeed(a) {
  if (a._magicSpeedHooked) return;
  const d = Object.getOwnPropertyDescriptor(a, 'speed');
  a._magicSpeedHooked = true;
  if (!d || !('value' in d) || !d.configurable) return;
  a._magicBaseSpeed = d.value;
  Object.defineProperty(a, 'speed', {
    configurable: true,
    enumerable: true,
    get() {
      const f = this.statusFlags;
      return f && f.count ? this._magicBaseSpeed * f.moveMul : this._magicBaseSpeed;
    },
    set(v) {
      this._magicBaseSpeed = v;
    },
  });
}

// ---------------------------------------------------------------- the system

export class StatusSystem {
  // host: the magic runtime (for harm rules, effects, its clock).
  constructor(game, host) {
    this.game = game;
    this.host = host;
    this.afflicted = [];
    this._reactT = 0;
    this._reactN = 0;
  }

  get now() {
    return this.host?.t ?? 0;
  }

  list(a) {
    return a?.magicStatus || EMPTY;
  }

  has(a, id) {
    const l = a?.magicStatus;
    if (!l) return false;
    for (let i = 0; i < l.length; i++) if (l[i].id === id) return true;
    return false;
  }

  get(a, id) {
    const l = a?.magicStatus;
    if (!l) return null;
    for (let i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }

  hasTag(a, tag) {
    const l = a?.magicStatus;
    if (!l) return false;
    for (let i = 0; i < l.length; i++) if (l[i].def.tags.includes(tag)) return true;
    return false;
  }

  // opts: { src, potency (0..2), power (the hit's damage), duration?, ignoreImmunity, chance }
  apply(a, id, opts = {}) {
    const def = Statuses.get(id);
    if (!def || !a || a.type !== 'actor' || a.removed || a.dead || !(a.isAlive?.() ?? a.hp > 0)) return null;
    if (def.charm && !this._charmable(a, opts.src)) return null;
    const now = this.now;
    const immune = a.statusImmune;
    if (!opts.ignoreImmunity && immune && immune[id] > now) return null;
    const chance = (opts.chance ?? 1) * def.chance;
    if (chance < 1 && this.host.random() >= chance) return null;
    const potency = Math.max(0.1, Math.min(2, Number.isFinite(opts.potency) ? opts.potency : 1));
    let dur = (Number.isFinite(opts.duration) ? opts.duration : def.duration) * (0.6 + 0.4 * Math.min(1.5, potency));
    if (def.cc && (a.superArmor || a.boss || Number.isFinite(a.ccResist))) dur *= Number.isFinite(a.ccResist) ? a.ccResist : CC_BOSS;
    // Status resistance from the stat pipeline (Resolve, charms; DESIGN §26).
    const res = opts.src !== a && this.game?.stats?.get ? this.game.stats.get(a, 'resist') : 0;
    if (res > 0) dur *= 1 - Math.min(0.75, res);
    if (!(dur > 0.02)) return null;

    if (!a.magicStatus) a.magicStatus = [];
    if (!a.statusFlags) a.statusFlags = newFlags();
    hookSpeed(a);
    let inst = this.get(a, id);
    const isNew = !inst;
    if (inst) {
      if (def.stack === 'add') {
        inst.stacks = Math.min(def.maxStacks, inst.stacks + 1);
        inst.t = Math.max(inst.t, dur);
        inst.dur = Math.max(inst.dur, inst.t);
      } else if (def.stack === 'extend') {
        inst.t = Math.min(def.duration * 3, inst.t + dur);
        inst.dur = Math.max(inst.dur, inst.t);
      } else if (dur > inst.t) {
        inst.t = dur;
        inst.dur = dur;
      }
      inst.potency = Math.max(inst.potency, potency);
      if (opts.src) inst.src = opts.src;
      if (Number.isFinite(opts.power)) inst.power = Math.max(inst.power * 0.5, opts.power);
    } else {
      inst = { id, def, t: dur, dur, stacks: 1, potency, src: opts.src || null, power: Number.isFinite(opts.power) ? opts.power : 8, tickT: def.tick, aux: 0.5 };
      a.magicStatus.push(inst);
      if (!this.afflicted.includes(a)) this.afflicted.push(a);
    }
    // Reactions between what it already carries and what just landed.
    this.react(a, def.tags, { src: inst.src, power: inst.power, x: a.x, y: a.y, skip: id });
    // The reaction may have consumed the status itself.
    if (!this.has(a, id)) return null;
    // Washing off what it cancels comes after reactions, so water on a burning foe
    // still makes steam (and only puts the fire out when no reaction could fire).
    for (const c of def.cleanses) if (c !== id) this.remove(a, c);
    if (def.becomes && inst.stacks >= def.becomes.at) {
      this.remove(a, id, true);
      return this.apply(a, def.becomes.id, { src: inst.src, potency: inst.potency, power: inst.power });
    }
    if (isNew) {
      try {
        def.onApply?.(this, a, inst);
      } catch (err) {
        this.host.warn?.('status onApply', err);
      }
      this._refreshFlags(a);
      this.game.bus?.emit('status_applied', { target: a, status: id, source: inst.src, potency: inst.potency, duration: inst.t });
      this.host.fx?.('status', { target: a, status: id, def });
    } else this._refreshFlags(a);
    return inst;
  }

  // Charm turns a foe for a while; never the party, villagers, bosses or the player.
  _charmable(a, src) {
    if (!src || a === src) return false;
    const g = this.game;
    if (a === g.player || a.id === 'player' || a.boss || a.superArmor || a.profile || a.essential) return false;
    if (a === g.companion || a.id === 'lyra') return false;
    try {
      if (g.combat?.isLawful?.(a)) return false;
    } catch {
      /* fall through */
    }
    return true;
  }

  // Remove by status id (or by tag when no status has that id).
  remove(a, idOrTag, silent = false) {
    const l = a?.magicStatus;
    if (!l || !l.length) return null;
    let removed = null;
    for (let i = l.length - 1; i >= 0; i--) {
      const s = l[i];
      if (s.id === idOrTag || (!Statuses.has(idOrTag) && s.def.tags.includes(idOrTag))) {
        l.splice(i, 1);
        removed = s;
        this._expire(a, s, silent);
      }
    }
    if (removed) this._refreshFlags(a);
    return removed;
  }

  clear(a) {
    const l = a?.magicStatus;
    if (!l) return;
    while (l.length) this._expire(a, l.pop(), true);
    this._refreshFlags(a);
  }

  _expire(a, s, silent) {
    if (s.def.immunity > 0) {
      if (!a.statusImmune) a.statusImmune = {};
      a.statusImmune[s.id] = this.now + s.def.immunity;
    }
    if (!silent) {
      try {
        s.def.onExpire?.(this, a, s);
      } catch (err) {
        this.host.warn?.('status onExpire', err);
      }
    }
  }

  // A touch tagged `tags` (a hit's essences, a status landing) on an actor: fire any
  // reaction between those tags and the statuses it already carries.
  react(a, tags, info) {
    const l = a?.magicStatus;
    if (!l || !l.length || !tags || !tags.length) return 0;
    const now = this.now;
    let fired = 0;
    for (let ti = 0; ti < tags.length; ti++) {
      const rs = reactionsFor(tags[ti]);
      for (let ri = 0; ri < rs.length; ri++) {
        const r = rs[ri];
        const other = r.tags[0] === tags[ti] ? r.tags[1] : r.tags[0];
        if (!this._carriesTag(a, other, info?.skip)) continue;
        if (!a.reactAt) a.reactAt = {};
        if ((a.reactAt[r.id] ?? -1e9) + (r.cooldown ?? 1.5) > now) continue;
        if (now - this._reactT > REACTION_WINDOW) {
          this._reactT = now;
          this._reactN = 0;
        }
        if (this._reactN >= REACTION_BURST) return fired;
        this._reactN++;
        a.reactAt[r.id] = now;
        const consumed = {};
        for (const c of r.consume || EMPTY) {
          const s = this.remove(a, c, true);
          if (s) consumed[c] = s;
        }
        const ri2 = { src: info?.src || null, x: a.x, y: a.y, power: Math.max(4, info?.power || 8), tags, consumed };
        try {
          r.effect?.(this, a, ri2);
        } catch (err) {
          this.host.warn?.(`reaction ${r.id}`, err);
        }
        fired++;
        this.game.bus?.emit('reaction', { id: r.id, x: a.x, y: a.y, target: a, source: ri2.src, name: r.name || r.id });
        this.host.fx?.('reaction', { id: r.id, x: a.x, y: a.y, target: a, reaction: r });
        if (a.dead || a.removed || !a.magicStatus) return fired;
      }
    }
    return fired;
  }

  _carriesTag(a, tag, skipId) {
    const l = a.magicStatus;
    for (let i = 0; i < l.length; i++) if (l[i].id !== skipId && l[i].def.tags.includes(tag)) return true;
    return false;
  }

  // ------------------------------------------------------------- helpers for entries

  jolt(a, seconds) {
    if (!a || a.superArmor) return;
    a.lockTime = Math.max(a.lockTime || 0, seconds);
    if (a.moveIntent) {
      a.moveIntent.x = 0;
      a.moveIntent.y = 0;
    }
  }

  damage(src, target, amount, type, extra) {
    return this.host.statusDamage(src, target, amount, type, extra);
  }

  // Damage (and optionally a status) on everyone `src` may harm near (x, y).
  // opts: { type, exclude, status, potency, max, knock, link }
  areaDamage(src, x, y, r, amount, opts = {}) {
    return this.host.reactionArea(src, x, y, r, amount, opts);
  }

  healArea(src, x, y, r, amount) {
    return this.host.healFriends(src, x, y, r, amount);
  }

  healSource(inst, amount) {
    if (inst.src) this.host.heal(inst.src, amount, null);
  }

  fx(type, payload) {
    this.host.fx?.(type, payload);
  }

  // ------------------------------------------------------------- the step

  update(dt) {
    const list = this.afflicted;
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      const l = a.magicStatus;
      if (!l || !l.length || a.removed || a.dead || !(a.isAlive?.() ?? a.hp > 0)) {
        if (l && l.length) this.clear(a);
        if (a.statusFlags) this._resetFlags(a.statusFlags);
        list[i] = list[list.length - 1];
        list.pop();
        continue;
      }
      for (let k = l.length - 1; k >= 0; k--) {
        const s = l[k];
        s.t -= dt;
        const def = s.def;
        if (def.dot > 0) {
          s.tickT -= dt;
          if (s.tickT <= 0) {
            s.tickT += def.tick;
            const amount = def.dot * s.power * s.potency * s.stacks * def.tick;
            const dealt = this.host.statusDamage(s.src, a, amount, def.tags[0], { status: s.id });
            if (def.onDot) {
              try {
                def.onDot(this, a, s, dealt);
              } catch (err) {
                this.host.warn?.('status onDot', err);
              }
            }
            if (a.dead || a.removed || !a.magicStatus) break;
          }
        }
        if (def.onTick) {
          try {
            def.onTick(this, a, s, dt);
          } catch (err) {
            this.host.warn?.('status onTick', err);
          }
        }
        if (s.t <= 0 && a.magicStatus === l && l[k] === s) {
          l.splice(k, 1);
          this._expire(a, s, false);
        }
      }
      if (!a.magicStatus) continue;
      this._refreshFlags(a);
      this._enforce(a, dt);
    }
  }

  _resetFlags(f) {
    f.disabled = false;
    f.moveMul = 1;
    f.rooted = false;
    f.dmgTaken = 1;
    f.dmgDealt = 1;
    f.charmedBy = null;
    f.count = 0;
  }

  _refreshFlags(a) {
    const f = a.statusFlags || (a.statusFlags = newFlags());
    this._resetFlags(f);
    const l = a.magicStatus;
    if (!l) return f;
    for (let i = 0; i < l.length; i++) {
      const s = l[i];
      const d = s.def;
      const k = Math.min(1, s.potency);
      if (d.disable) f.disabled = true;
      if (d.root) f.rooted = true;
      if (d.move !== 1) f.moveMul *= 1 - (1 - d.move) * k;
      if (d.dmgTaken !== 1) f.dmgTaken *= 1 + (d.dmgTaken - 1) * k;
      if (d.dmgDealt !== 1) f.dmgDealt *= 1 + (d.dmgDealt - 1) * k;
      if (d.charm && s.src && !s.src.removed) f.charmedBy = s.src;
    }
    f.count = l.length;
    if (f.moveMul < 0.15) f.moveMul = 0.15;
    return f;
  }

  // What the flags mean for the body, for every actor alike (no AI needs to know).
  _enforce(a, dt) {
    const f = a.statusFlags;
    if (!f || !f.count) return;
    if (f.disabled) {
      a.lockTime = Math.max(a.lockTime || 0, dt * 2 + 0.01);
      if (a.moveIntent) {
        a.moveIntent.x = 0;
        a.moveIntent.y = 0;
      }
      if (a.vel) {
        a.vel.x = 0;
        a.vel.y = 0;
      }
      this.host.interruptHold?.(a);
    }
    if (f.rooted) {
      let t = 0;
      for (const s of a.magicStatus) if (s.def.root && s.t > t) t = s.t;
      a.rootTime = Math.max(a.rootTime || 0, t);
    }
    if (f.charmedBy && a.target && a.target !== f.charmedBy) {
      try {
        if (!this.game.combat?.isHostile?.(a, a.target)) a.target = null;
      } catch {
        /* AI picks again */
      }
    } else if (f.charmedBy && a.target === f.charmedBy) a.target = null;
  }
}
