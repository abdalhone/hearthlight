import { Shapes } from './shapes.js';
import { Essences, blendPalettes } from './essences.js';
import { Twists, HOOKS } from './twists.js';
import { weaveName, describeWeave } from './naming.js';
import { mixColors } from './registry.js';
import {
  ESSENCE_COUNT_DMG,
  STATUS_POTENCY,
  ESSENCE_SLOTS_MAX,
  TWIST_SLOTS_MAX,
  MAX_GEN,
  COOLDOWN_MIN,
  COOLDOWN_MAX,
  SIZE_MAX,
  SPEED_MIN,
  SPEED_MAX,
  applyBudget,
  clamp,
} from './balance.js';

// compileWeave(weave, opts) -> plan. A weave is data: { id, name?, shape, essences, twists }.
// The plan is everything the runtime needs, computed once: validated ids, numbers from
// shape base x essences x twists inside the power budget, the blended palette, a name,
// a description, an aim preview and the twist hooks in call order.
//
// opts: { unlocked: { shapes, essences, twists } (Sets; validates locks),
//         maxEssences, maxTwists (slot limits), gen (twist generation), trusted }
//
// plan fields (beyond the weave's): ok, reason, key, name, autoName, description, shape,
// shapeDef, kind, essences, essenceDefs, twists, twistDefs, gen, input ('tap'|'hold'|
// 'charge'), dmg, cost, cooldown, speed, range, radius, count, life, size, speedMul,
// lifeMul, knock, launch, pierce, penetration, bounce, chain, homing, orbit, charge,
// aimAssist, dmgTypes [{type, share}], damageType, statuses [{id, potency, chance}], tags,
// palette, palettes, particles, sounds, light, familiar, terrain, value, budget, aim,
// hooks { onEmit: [fn…], onSpawn, onUpdate, onHit, onEnd } (each fn(this-free) gets
// (…args) as in twists.js), child(twistId) -> plan, attackPlan() -> plan (summons).

const cache = new Map();
const CACHE_MAX = 600;
const EMPTY = Object.freeze([]);

function uniqStrings(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const v of list) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export function normalizeWeave(w) {
  const src = w && typeof w === 'object' ? w : {};
  const essences = uniqStrings(src.essences);
  return {
    id: typeof src.id === 'string' && src.id ? src.id : null,
    name: typeof src.name === 'string' && src.name.trim() ? src.name.trim().slice(0, 32) : null,
    shape: typeof src.shape === 'string' ? src.shape.trim() : '',
    essences: essences.length ? essences : ['raw'],
    twists: uniqStrings(src.twists),
  };
}

export function weaveKey(w) {
  const n = normalizeWeave(w);
  return `${n.shape}|${n.essences.join(',')}|${n.twists.join(',')}`;
}

function invalid(weave, reason, code) {
  return { ok: false, reason, code, weave, name: weave.name || 'Unfinished weave', description: reason, cost: 0, cooldown: 0, aim: null };
}

const setHas = (s, id) => !s || (s instanceof Set ? s.has(id) : Array.isArray(s) ? s.includes(id) : !!s[id]);

// Check a weave against the registries, the unlocks and the slot limits.
export function validateWeave(weave, opts = {}) {
  const w = normalizeWeave(weave);
  if (!w.shape) return { ok: false, code: 'no_shape', reason: 'Pick a shape for this weave.', weave: w };
  if (!Shapes.has(w.shape)) return { ok: false, code: 'unknown', reason: `There is no shape called "${w.shape}".`, weave: w };
  for (const e of w.essences) if (!Essences.has(e)) return { ok: false, code: 'unknown', reason: `There is no essence called "${e}".`, weave: w };
  for (const t of w.twists) if (!Twists.has(t)) return { ok: false, code: 'unknown', reason: `There is no twist called "${t}".`, weave: w };
  const maxE = opts.maxEssences ?? ESSENCE_SLOTS_MAX;
  const maxT = opts.maxTwists ?? TWIST_SLOTS_MAX;
  if (w.essences.length > maxE) return { ok: false, code: 'too_many', reason: `A weave can hold ${maxE} essence${maxE === 1 ? '' : 's'} for now.`, weave: w };
  if (w.twists.length > maxT) return { ok: false, code: 'too_many', reason: `A weave can hold ${maxT} twist${maxT === 1 ? '' : 's'} for now.`, weave: w };
  const u = opts.unlocked;
  if (u) {
    if (!setHas(u.shapes, w.shape)) return { ok: false, code: 'locked', reason: `You can't weave a ${Shapes.get(w.shape).name.toLowerCase()} yet.`, weave: w };
    for (const e of w.essences) if (!setHas(u.essences, e)) return { ok: false, code: 'locked', reason: `You haven't learned to weave ${Essences.get(e).noun} yet.`, weave: w };
    for (const t of w.twists) if (!setHas(u.twists, t)) return { ok: false, code: 'locked', reason: `You haven't learned the ${Twists.get(t).name.toLowerCase()} twist yet.`, weave: w };
  }
  return { ok: true, weave: w };
}

export function compileWeave(weave, opts = {}) {
  const v = validateWeave(weave, opts);
  if (!v.ok) return invalid(v.weave, v.reason, v.code);
  const w = v.weave;
  const gen = Math.max(0, Math.floor(opts.gen || 0));
  // At the generation cap, twists that make children are dropped.
  let twists = w.twists;
  if (gen >= MAX_GEN) twists = twists.filter((t) => !Twists.get(t).spawns);
  const key = `${w.shape}|${w.essences.join(',')}|${twists.join(',')}|${gen}|${Shapes.version}.${Essences.version}.${Twists.version}`;
  let base = cache.get(key);
  if (!base) {
    base = build(w, twists, gen, key);
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, base);
  }
  if (!w.name && !w.id) return base;
  // The player's own name and id ride on a shallow copy; numbers and hooks stay shared.
  return Object.assign({}, base, { weave: { ...base.weave, id: w.id, name: w.name }, id: w.id || base.id, name: w.name || base.autoName });
}

export function clearCompileCache() {
  cache.clear();
}

function build(w, twists, gen, key) {
  const shapeDef = Shapes.get(w.shape);
  const essenceDefs = w.essences.map((id) => Essences.get(id));
  const twistDefs = twists.map((id) => Twists.get(id));
  const s = shapeDef.base;
  const n = essenceDefs.length;

  const avg = (k) => essenceDefs.reduce((a, e) => a + (e.mods[k] ?? 1), 0) / n;
  let dmgMul = avg('dmg') * (ESSENCE_COUNT_DMG[n] ?? 1.3);
  let costMul = 1;
  let cdMul = avg('cooldown') * (1 + 0.08 * (n - 1));
  let speedMul = avg('speed');
  let sizeMul = avg('size');
  let lifeMul = avg('life');
  const knock = avg('knock');
  let value = 1;
  for (const e of essenceDefs) value *= Number.isFinite(e.value) ? e.value : e.status ? 1.15 : 1.05;
  value = Math.pow(value, 1 / n);
  const costAdd = essenceDefs.reduce((a, e) => a + (e.mods.cost ?? 0), 0);
  for (const t of twistDefs) {
    dmgMul *= t.mods.dmg;
    costMul *= t.mods.cost;
    cdMul *= t.mods.cooldown;
    speedMul *= t.mods.speed;
    sizeMul *= t.mods.size;
    lifeMul *= t.mods.life;
    value *= t.value;
  }
  sizeMul = clamp(sizeMul, 0.4, SIZE_MAX);

  const plan = {
    ok: true,
    reason: null,
    key,
    weave: { id: w.id, name: w.name, shape: w.shape, essences: w.essences.slice(), twists: twists.slice() },
    id: null,
    name: '',
    autoName: '',
    description: '',
    shape: w.shape,
    shapeDef,
    kind: shapeDef.kind,
    essences: w.essences.slice(),
    essenceDefs,
    twists: twists.slice(),
    twistDefs,
    gen,
    input: shapeDef.input === 'hold' ? 'hold' : 'tap',
    held: shapeDef.input === 'hold',
    // numbers
    dmg: s.dmg * dmgMul,
    cost: (s.cost + costAdd) * costMul,
    cooldown: s.cooldown * cdMul,
    speed: s.speed > 0 ? clamp(s.speed * speedMul, SPEED_MIN, SPEED_MAX) : 0,
    range: s.range,
    radius: s.radius * sizeMul,
    count: s.count,
    life: s.life * lifeMul,
    size: sizeMul,
    speedMul,
    lifeMul,
    knock,
    launch: 0,
    pierce: 0,
    penetration: 0,
    bounce: 0,
    chain: 0,
    homing: 0,
    orbit: 0,
    charge: 0,
    aimAssist: false,
  };
  // Shape extras (arc, length, tick, drops, arm, atkCd…) ride along unscaled, except sizes.
  for (const k of Object.keys(s)) if (!(k in plan)) plan[k] = s[k];
  if (Number.isFinite(plan.length)) plan.length *= sizeMul;
  for (const e of essenceDefs) if (Number.isFinite(e.launch)) plan.launch = Math.max(plan.launch, e.launch);
  if (essenceDefs.some((e) => e.id === 'wind')) plan.launch = Math.max(plan.launch, 70);

  // Damage split across the essences' types; statuses at reduced potency.
  plan.dmgTypes = essenceDefs.map((e) => ({ type: e.damageType, share: 1 / n }));
  plan.damageType = essenceDefs[0].damageType;
  const pot = STATUS_POTENCY[n] ?? 0.5;
  plan.statuses = [];
  for (const e of essenceDefs) if (e.status && e.status.id) plan.statuses.push({ id: e.status.id, potency: pot * (e.status.potency ?? 1), chance: e.status.chance ?? 1 });
  const tags = [];
  for (const e of essenceDefs) for (const t of e.tags) if (!tags.includes(t)) tags.push(t);
  plan.tags = tags;
  plan.terrain = essenceDefs.flatMap((e) => e.terrain.map((t) => ({ ...t, essence: e.id })));

  // Looks: blended palette, each essence's particle style and sound kept.
  plan.palettes = essenceDefs.map((e) => e.palette);
  plan.palette = blendPalettes(plan.palettes);
  plan.particles = essenceDefs.map((e) => e.particle);
  plan.fallbackParticles = essenceDefs.map((e) => e.fallbackParticle);
  plan.sounds = essenceDefs.map((e) => e.sound);
  plan.light = {
    color: n === 1 ? essenceDefs[0].light.color : mixColors(essenceDefs.map((e) => e.light.color), essenceDefs.map((_, i) => (i ? 1 : 2))),
    radius: Math.max(...essenceDefs.map((e) => e.light.radius)),
  };
  const lead = essenceDefs.find((e) => e.id !== 'raw') || essenceDefs[0];
  plan.familiar = { ...lead.familiar };

  // Hooks: twists first (in the order the player set them), then any essence hooks.
  plan.hooks = {};
  for (const h of HOOKS) plan.hooks[h] = [];
  for (const d of [...twistDefs, ...essenceDefs]) for (const h of HOOKS) if (typeof d[h] === 'function') plan.hooks[h].push(d[h]);
  for (const h of HOOKS) if (!plan.hooks[h].length) plan.hooks[h] = EMPTY;

  for (const t of twistDefs) {
    if (t.input === 'charge') plan.input = 'charge';
    try {
      t.onPlan?.(plan);
    } catch (err) {
      console.warn(`[magic] twist ${t.id} onPlan failed`, err);
    }
  }
  for (const e of essenceDefs) {
    try {
      e.onPlan?.(plan);
    } catch (err) {
      console.warn(`[magic] essence ${e.id} onPlan failed`, err);
    }
  }
  plan.count = clamp(Math.round(plan.count) || 1, 1, 9);

  // Power budget: never free, never useless.
  plan.value = plan.dmg * shapeDef.hits * value;
  applyBudget(plan, s.dmg * shapeDef.hits * 1.1, s.cost);
  plan.cooldown = clamp(plan.cooldown, COOLDOWN_MIN, COOLDOWN_MAX);
  plan.cost = Math.round(plan.cost * 10) / 10;
  plan.dmg = Math.max(1, Math.round(plan.dmg * 10) / 10);
  if (plan.input === 'hold') plan.drain = plan.cost; // mana per second while a beam is held

  plan.autoName = weaveName(plan);
  plan.name = plan.autoName;
  plan.id = w.id || `w:${plan.weave.shape}:${plan.weave.essences.join('+')}:${plan.weave.twists.join('+')}`;
  plan.description = describeWeave(plan);
  try {
    plan.aim = { ...shapeDef.aim(plan) };
  } catch {
    plan.aim = { type: 'line', range: plan.range, width: plan.radius * 2 };
  }
  if (plan.aimAssist) plan.aim.assist = true;

  const children = new Map();
  plan.child = (twistId) => {
    const k = twistId || '';
    let c = children.get(k);
    if (c) return c;
    const tw = twistId ? plan.weave.twists.filter((t) => t !== twistId) : plan.weave.twists;
    c = compileWeave({ shape: plan.weave.shape, essences: plan.weave.essences, twists: tw }, { gen: gen + 1, trusted: true });
    children.set(k, c);
    return c;
  };
  let attack = null;
  plan.attackPlan = () => {
    if (attack) return attack;
    const drop = new Set(['orbit', 'charge', 'echo', 'volley', 'multishot']);
    attack = compileWeave({ shape: Shapes.has('bolt') ? 'bolt' : plan.weave.shape, essences: plan.weave.essences, twists: plan.weave.twists.filter((t) => !drop.has(t)) }, { gen: gen + 1, trusted: true });
    return attack;
  };
  return plan;
}

// The numbers a UI shows for a plan (rounded, human units).
export function planStats(plan) {
  if (!plan || !plan.ok) return null;
  return {
    damage: Math.round(plan.dmg),
    cost: Math.round(plan.cost),
    cooldown: Math.round(plan.cooldown * 100) / 100,
    count: plan.count,
    range: Math.round(plan.aim?.range ?? plan.range),
    input: plan.input,
    drain: plan.drain ? Math.round(plan.drain) : 0,
  };
}
