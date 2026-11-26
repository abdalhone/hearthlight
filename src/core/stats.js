// The one stat pipeline (DESIGN §26). Every actor's derived numbers are
//
//     value = clamp( (base + Σ add) × (1 + Σ pct) × Π mul )
//
// A percentage is a share of the base and the flat adds: "+40% speed" is 40% of your
// normal pace, whatever else runs, and percentages simply add up (round 14b: "40% should
// always give 40%, no matter what"). The clamps are safety limits no real build reaches,
// except the chances (dodge, crit, resistance), which cannot pass what they say.
//
// summed over the sources in a fixed order: base → level → points → gear → modifiers
// (timed: prices, potions, food, surges; live: survival's weaknesses, magic statuses).
// Sums and products are taken in that order every time, so the same inputs always give
// the same number. Combat, magic, movement, survival and the HUD read derived stats only:
//
//   game.stats.get(actor, 'atk' | 'def' | 'maxHp' | ...) -> number
//   game.stats.all(actor) -> { stat: value }          game.stats.breakdown(actor, stat)
//   game.stats.addModifier(actor, mod) -> mod          removeModifier(actor, idOrSource)
//   game.stats.modifiers(actor) -> [mod]               (own timed ones + providers')
//   game.stats.manage(actor)   the actor's maxHp/atk/def/speed fields follow the pipeline
//   game.stats.refresh(actor)  recompute now (after a level, an equip, a respec)
//
// A modifier: { id, source, label, kind: 'gain'|'cost'|'buff'|'weak'|'toggle',
//   add: { stat: n }, pct: { stat: n }, mul: { stat: n }, t (seconds left; null = until
//   removed), total, icon, color, price (id), note }.
// Sources register with addSource(id, label, fn(actor) -> { add, pct, mul } | null, order).
// Providers (live modifier lists from other systems) register with addProvider(fn(actor)).

export const STATS = Object.freeze({
  maxHp: { label: 'Health', short: 'HP', fmt: 'int', min: 1, max: 9999 },
  hpRegen: { label: 'Health regen', short: 'Regen', fmt: 'rate', min: 0, max: 40 },
  // Mana and weave power have no wall a build meets (round 14b: points in Focus and Weave
  // keep growing); the clamps only keep the numbers sane.
  maxMana: { label: 'Mana', short: 'MP', fmt: 'int', min: 5, max: 9999 },
  manaRegen: { label: 'Mana regen', fmt: 'mul', min: 0, max: 5 },
  atk: { label: 'Sword', short: 'ATK', fmt: 'int', min: 1, max: 999 },
  spellPower: { label: 'Weave power', fmt: 'mul', min: 0.1, max: 50 },
  def: { label: 'Armor', short: 'DEF', fmt: 'int', min: 0, max: 99 },
  // Speed (round 14b): 999 Grace points walk at ~129 px/s (the points' own curve,
  // progression/attributes.js); every haste adds its full share on top. 260 is a safety
  // clamp only: everything stacked at once (999 Grace, the fastest boots and cloak, a
  // Swiftfoot Draught, a wind surge, Berserk, the Last Stand and Oath) is ~227 px/s, and
  // movement is split into 4 px steps, so nothing walks through a wall at any pace.
  speed: { label: 'Speed', fmt: 'int', min: 10, max: 260 },
  crit: { label: 'Critical chance', fmt: 'pct', min: 0, max: 0.6 },
  critMul: { label: 'Critical damage', fmt: 'mul', min: 1, max: 4 },
  dodge: { label: 'Dodge chance', fmt: 'pct', min: 0, max: 0.4 },
  resist: { label: 'Status resistance', fmt: 'pct', min: 0, max: 0.75 },
  castSpeed: { label: 'Cast speed', fmt: 'mul', min: 0.3, max: 3 },
  cooldown: { label: 'Cooldowns', fmt: 'mul', min: 0.4, max: 3, lowerIsBetter: true },
  swing: { label: 'Swing speed', fmt: 'mul', min: 0.4, max: 2.5 },
  dmgDealt: { label: 'Damage dealt', fmt: 'mul', min: 0, max: 10 },
  dmgTaken: { label: 'Damage taken', fmt: 'mul', min: 0.1, max: 10, lowerIsBetter: true },
  manaCost: { label: 'Mana cost', fmt: 'mul', min: 0, max: 5, lowerIsBetter: true },
  bleedout: { label: 'Bleed-out window', fmt: 'sec', min: 10, max: 300 },
  carrySpeed: { label: 'Carrying pace', fmt: 'mul', min: 0.3, max: 3 },
  poise: { label: 'Unshakable', fmt: 'flag', min: 0, max: 1 },
  strike: { label: 'Strike weaves', fmt: 'mul', min: 0.1, max: 50 },
});

export const STAT_IDS = Object.freeze(Object.keys(STATS));

// Defaults for anyone (the player's own numbers come from their fields when managed).
export const DEFAULTS = Object.freeze({
  hpRegen: 0,
  maxMana: 0,
  manaRegen: 1,
  spellPower: 1,
  crit: 0.1,
  critMul: 1.5,
  dodge: 0,
  resist: 0,
  castSpeed: 1,
  cooldown: 1,
  swing: 1,
  dmgDealt: 1,
  dmgTaken: 1,
  manaCost: 1,
  bleedout: 75,
  carrySpeed: 1,
  poise: 0,
  strike: 1,
});

// Fields an actor carries that the pipeline owns once it manages the actor.
export const SYNCED = Object.freeze(['maxHp', 'atk', 'def', 'speed']);

const REGEN_AFTER_HIT = 4; // seconds after a hit before health starts to knit
// Armor (def) takes a flat bite out of every hit, but never more than this share of it:
// good armor matters, and nothing makes the stranger safe (the author wants death to be
// dangerous). combat.damage reads it from game.stats.armorFloor.
export const ARMOR_FLOOR = 0.35;
const own = Object.prototype.hasOwnProperty;

let modSeq = 0;

function num(v, d = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

function clampStat(id, v) {
  const s = STATS[id];
  if (!s) return v;
  return v < s.min ? s.min : v > s.max ? s.max : v;
}

// Fold one contribution { add, pct, mul } into the running sums.
function fold(acc, c) {
  if (!c) return;
  if (c.add) for (const k in c.add) if (own.call(acc.add, k)) acc.add[k] += num(c.add[k]);
  if (c.pct) for (const k in c.pct) if (own.call(acc.pct, k)) acc.pct[k] += num(c.pct[k]);
  if (c.mul) for (const k in c.mul) if (own.call(acc.mul, k)) acc.mul[k] *= num(c.mul[k], 1);
}

function freshAcc() {
  const add = {};
  const pct = {};
  const mul = {};
  for (const id of STAT_IDS) {
    add[id] = 0;
    pct[id] = 0;
    mul[id] = 1;
  }
  return { add, pct, mul };
}

// Normalize a modifier handed in by any system.
export function makeModifier(m = {}) {
  const t = Number.isFinite(m.t) ? m.t : Number.isFinite(m.seconds) ? m.seconds : null;
  return {
    id: String(m.id || `${m.source || 'mod'}#${++modSeq}`),
    source: String(m.source || m.id || 'mod'),
    label: String(m.label || ''),
    kind: m.kind || 'buff',
    add: m.add ? { ...m.add } : null,
    pct: m.pct ? { ...m.pct } : null,
    mul: m.mul ? { ...m.mul } : null,
    t,
    total: Number.isFinite(m.total) ? m.total : t,
    icon: m.icon || null,
    color: m.color || null,
    price: m.price || null,
    note: m.note || '',
    tap: m.tap || null, // what tapping its HUD icon does ('douse')
    save: m.save !== false,
  };
}

export class Stats {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.stamp = 1;
    this.sources = []; // { id, label, order, fn }
    this.providers = []; // fn(actor) -> [modifier-like]
    this.mods = new Map(); // actor -> [modifier]
    this.managed = new Set();
    this.bases = new WeakMap(); // actor -> { maxHp, atk, def, speed } at level 1
    this.cache = new WeakMap(); // actor -> { stamp, v }
    this.foldsSurvival = false;
    this.armorFloor = ARMOR_FLOOR;
    this._regen = new WeakMap(); // actor -> fractional hp
    this._lastMax = new WeakMap(); // actor -> last synced maxHp
    this.addSource('base', 'Base', (a) => this.baseOf(a), 0);
  }

  // ---------------------------------------------------------------- wiring

  addSource(id, label, fn, order = 50) {
    this.sources = this.sources.filter((s) => s.id !== id);
    this.sources.push({ id, label, order, fn });
    this.sources.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
    this.touch();
  }

  addProvider(id, fn) {
    this.providers = this.providers.filter((p) => p.id !== id);
    this.providers.push({ id, fn });
    this.touch();
  }

  touch() {
    this.stamp++;
  }

  // The pipeline writes this actor's maxHp/atk/def/speed. Its level-1 numbers are read
  // now (the fields as built; any level growth already in them is taken back out).
  manage(actor, base = null) {
    if (!actor) return;
    const lv = Math.max(1, actor.level || 1);
    const b = base || {
      maxHp: num(actor.maxHp, 30) - (lv - 1) * num(this.levelRule?.hp, 0),
      atk: num(actor.baseAtk ?? actor.atk, 4) - (actor.baseAtk != null ? 0 : (lv - 1) * num(this.levelRule?.atk, 0)),
      def: num(actor.def, 0),
      speed: num(actor.speed, 60),
    };
    this.bases.set(actor, { ...b });
    this.managed.add(actor);
    this._lastMax.set(actor, actor.maxHp);
    this.touch();
  }

  isManaged(actor) {
    return this.managed.has(actor);
  }

  baseOf(a) {
    const b = this.bases.get(a);
    const add = {};
    if (b) {
      add.maxHp = b.maxHp;
      add.atk = b.atk;
      add.def = b.def;
      add.speed = b.speed;
    } else {
      add.maxHp = num(a.maxHp, 1);
      add.atk = num(a.atk, 1);
      add.def = num(a.def, 0);
      add.speed = num(a.speed, 60);
    }
    for (const k in DEFAULTS) add[k] = DEFAULTS[k];
    if (Number.isFinite(a.magicPower)) add.spellPower = a.magicPower;
    if (Number.isFinite(a.statusResist)) add.resist = a.statusResist;
    if (a.superArmor) add.poise = 1;
    if (this.isPlayer(a)) {
      const m = this.game.magic;
      add.maxMana = 40 + num(m?.manaBonus, 0);
    }
    return { add };
  }

  isPlayer(a) {
    return !!a && (a === this.game.player || a.id === 'player');
  }

  // ---------------------------------------------------------------- modifiers

  list(actor) {
    let l = this.mods.get(actor);
    if (!l) {
      l = [];
      this.mods.set(actor, l);
    }
    return l;
  }

  addModifier(actor, m) {
    if (!actor) return null;
    const mod = makeModifier(m);
    const l = this.list(actor);
    const i = l.findIndex((x) => x.id === mod.id);
    if (i >= 0) l[i] = mod;
    else l.push(mod);
    this.touch();
    this.game.bus?.emit?.('stat_modifier', { actor, mod, added: true });
    if (this.managed.has(actor)) this.sync(actor);
    return mod;
  }

  getModifier(actor, id) {
    return (this.mods.get(actor) || []).find((m) => m.id === id) || null;
  }

  removeModifier(actor, idOrSource) {
    const l = this.mods.get(actor);
    if (!l || !l.length) return 0;
    const keep = l.filter((m) => m.id !== idOrSource && m.source !== idOrSource);
    const n = l.length - keep.length;
    if (!n) return 0;
    const gone = l.filter((m) => !keep.includes(m));
    this.mods.set(actor, keep);
    this.touch();
    for (const mod of gone) this.game.bus?.emit?.('stat_modifier', { actor, mod, removed: true });
    if (this.managed.has(actor)) this.sync(actor);
    return n;
  }

  // Own timed modifiers plus every provider's live ones.
  modifiers(actor) {
    const out = [...(this.mods.get(actor) || [])];
    for (const p of this.providers) {
      let got = null;
      try {
        got = p.fn(actor);
      } catch (err) {
        if (!this._warned) console.warn(`[stats] provider ${p.id} failed`, err);
        this._warned = true;
      }
      if (Array.isArray(got)) for (const m of got) if (m) out.push(m);
    }
    return out;
  }

  // ---------------------------------------------------------------- reading

  compute(actor) {
    const acc = freshAcc();
    for (const s of this.sources) {
      let c = null;
      try {
        c = s.fn(actor);
      } catch (err) {
        if (!this._warnedSrc) console.warn(`[stats] source ${s.id} failed`, err);
        this._warnedSrc = true;
      }
      fold(acc, c);
    }
    for (const m of this.modifiers(actor)) fold(acc, m);
    const v = {};
    for (const id of STAT_IDS) v[id] = clampStat(id, acc.add[id] * Math.max(0, 1 + acc.pct[id]) * acc.mul[id]);
    v.maxHp = Math.max(1, Math.round(v.maxHp));
    v.maxMana = Math.round(v.maxMana);
    v.atk = Math.round(v.atk * 10) / 10;
    v.def = Math.round(v.def * 10) / 10;
    return v;
  }

  values(actor) {
    if (!actor) return null;
    let c = this.cache.get(actor);
    if (!c || c.stamp !== this.stamp) {
      c = { stamp: this.stamp, v: this.compute(actor) };
      this.cache.set(actor, c);
    }
    return c.v;
  }

  get(actor, stat) {
    if (!actor) return DEFAULTS[stat] ?? 0;
    const v = this.values(actor);
    let x = v[stat];
    if (x === undefined) return 0;
    // Magic statuses change within a frame; their multipliers are read live.
    const f = actor.statusFlags;
    if (f && f.count) {
      if (stat === 'dmgTaken' && f.dmgTaken !== 1) x = clampStat(stat, x * f.dmgTaken);
      else if (stat === 'dmgDealt' && f.dmgDealt !== 1) x = clampStat(stat, x * f.dmgDealt);
    }
    return x;
  }

  all(actor) {
    return { ...this.values(actor) };
  }

  // Where a number comes from: [{ source, label, add, pct, mul }] (non-zero only).
  breakdown(actor, stat) {
    const out = [];
    const push = (source, label, c) => {
      if (!c) return;
      const add = num(c.add?.[stat], 0);
      const pct = num(c.pct?.[stat], 0);
      const mul = num(c.mul?.[stat], 1);
      if (add || pct || mul !== 1) out.push({ source, label, add, pct, mul });
    };
    for (const s of this.sources) {
      let c = null;
      try {
        c = s.fn(actor);
      } catch {
        c = null;
      }
      push(s.id, s.label, c);
    }
    for (const m of this.modifiers(actor)) push(m.source, m.label || m.source, m);
    return out;
  }

  // ---------------------------------------------------------------- step

  refresh(actor) {
    this.touch();
    if (actor && this.managed.has(actor)) this.sync(actor);
  }

  // Write the managed actor's fields. Health never refills on its own: a bigger maximum
  // leaves the wound as it is, a smaller one clamps it.
  sync(actor) {
    const v = this.values(actor);
    const before = actor.maxHp;
    actor.maxHp = v.maxHp;
    actor.atk = v.atk;
    actor.def = v.def;
    actor.speed = v.speed;
    if (Number.isFinite(actor.hp) && actor.hp > actor.maxHp) actor.hp = actor.maxHp;
    if (before !== actor.maxHp) this._lastMax.set(actor, actor.maxHp);
    if (this.isPlayer(actor)) {
      const m = this.game.magic;
      if (m && m.mana && m.mana.max !== Math.round(Math.min(STATS.maxMana.max, Math.max(5, v.maxMana))) && typeof m._recomputeMax === 'function') m._recomputeMax(0, false);
    }
  }

  update(dt) {
    if (!(dt > 0)) return;
    this.t += dt;
    let changed = false;
    for (const [actor, l] of this.mods) {
      if (actor.removed && !this.managed.has(actor)) {
        this.mods.delete(actor);
        continue;
      }
      for (let i = l.length - 1; i >= 0; i--) {
        const m = l[i];
        if (m.t == null) continue;
        m.t -= dt;
        if (m.t <= 0) {
          l.splice(i, 1);
          changed = true;
          this.game.bus?.emit?.('stat_modifier', { actor, mod: m, removed: true, expired: true });
          try {
            m.onEnd?.(actor);
          } catch (err) {
            console.warn('[stats] modifier end failed', err);
          }
        }
      }
    }
    this.touch(); // providers (survival, oath's distance) are live
    for (const a of this.managed) {
      if (a.removed) continue;
      this.sync(a);
      this.regen(a, dt);
    }
    if (changed) this.touch();
  }

  // Health knits slowly when nothing has hit for a few seconds.
  regen(a, dt) {
    if (!a.isAlive?.() || a.downed || a.dead) return;
    const r = this.get(a, 'hpRegen');
    if (!(r > 0) || a.hp >= a.maxHp) {
      this._regen.set(a, 0);
      return;
    }
    const now = this.game.clock?.t ?? this.t;
    if (now - num(a.lastAttackedAt, -Infinity) < REGEN_AFTER_HIT) return;
    const acc = (this._regen.get(a) || 0) + r * dt;
    const whole = Math.floor(acc);
    this._regen.set(a, acc - whole);
    if (whole > 0) a.hp = Math.min(a.maxHp, a.hp + whole);
  }

  // ---------------------------------------------------------------- saving

  serializeMods(actor) {
    return (this.mods.get(actor) || [])
      .filter((m) => m.save)
      .map((m) => ({ id: m.id, source: m.source, label: m.label, kind: m.kind, add: m.add, pct: m.pct, mul: m.mul, t: m.t == null ? null : Math.round(m.t * 10) / 10, total: m.total, icon: m.icon, color: m.color, price: m.price, note: m.note, tap: m.tap }));
  }

  deserializeMods(actor, list) {
    if (!actor) return;
    const l = [];
    for (const m of Array.isArray(list) ? list : []) if (m && typeof m === 'object') l.push(makeModifier(m));
    this.mods.set(actor, l);
    this.refresh(actor);
  }
}

// Number formatting for sheets and tooltips.
export function formatStat(id, v) {
  const s = STATS[id];
  if (!s) return String(v);
  switch (s.fmt) {
    case 'pct':
      return `${Math.round(v * 100)}%`;
    case 'mul':
      return `${Math.round(v * 100)}%`;
    case 'rate':
      return `${Math.round(v * 10) / 10}/s`;
    case 'sec':
      return `${Math.round(v)} s`;
    case 'flag':
      return v >= 1 ? 'Yes' : 'No';
    default:
      return String(Math.round(v * 10) / 10);
  }
}

// A contribution in words: "+3 Armor", "+12% Weave power", "×0.6 Health".
export function describeContribution(c) {
  const out = [];
  if (!c) return out;
  const word = (id) => STATS[id]?.label || id;
  for (const [k, v] of Object.entries(c.add || {})) {
    if (!v) continue;
    const s = STATS[k];
    if (s && (s.fmt === 'pct')) out.push(`${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 1000) / 10}% ${word(k)}`);
    else if (s && s.fmt === 'rate') out.push(`${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 10) / 10}/s ${word(k)}`);
    else if (s && s.fmt === 'sec') out.push(`${v > 0 ? '+' : '−'}${Math.round(Math.abs(v))} s ${word(k)}`);
    else if (s && s.fmt === 'flag') out.push(word(k));
    else out.push(`${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 10) / 10} ${word(k)}`);
  }
  for (const [k, v] of Object.entries(c.pct || {})) {
    if (!v) continue;
    if (k === 'cooldown' || k === 'dmgTaken' || k === 'manaCost') out.push(`${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}% ${word(k).toLowerCase()}`);
    else out.push(`${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}% ${word(k)}`);
  }
  for (const [k, v] of Object.entries(c.mul || {})) {
    if (v === 1 || !Number.isFinite(v)) continue;
    if (v === 0) out.push(`no ${word(k).toLowerCase()}`);
    else if (v > 1) out.push(`${word(k)} ×${Math.round(v * 100) / 100}`);
    else out.push(`${word(k)} −${Math.round((1 - v) * 100)}%`);
  }
  return out;
}
