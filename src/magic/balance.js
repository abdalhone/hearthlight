// The numbers that hold the Weave together: caps, mana, slots and the power budget.
// Every plan is scored by how much harm it can do per cast (its `value`) against what
// it costs; the budget keeps that ratio inside a band around its shape's own ratio, so
// stacking twists is never free and an odd mix is never useless.

export const STEP = 1 / 60; // fixed simulation step (seconds)
export const BODY_CAP = 220; // live bodies in the whole world
export const PER_CAST_CAP = 72; // live bodies descended from one cast (children, echoes, volleys)
export const MAX_GEN = 2; // twist children of children stop spawning children here
export const FAMILIARS_PER_CASTER = 3;
export const RUNES_PER_CASTER = 6;
export const WALLS_PER_CASTER = 4;
export const MAX_DECALS = 90;
export const MAX_LIGHTS = 40;

// Mana (DESIGN §22.1: a violet bar under health, start 40, regenerates, grows).
export const MANA_START = 40;
export const MANA_REGEN = 5; // per second, plus a share of the max
export const MANA_REGEN_SHARE = 0.025; // of max per second
export const MANA_REGEN_DELAY = 0.4; // seconds after spending before regen resumes
export const MANA_PER_LEVEL = 4;
// No wall a build meets (round 14b: Focus points keep growing the pool); the stat
// pipeline's maxMana clamp (src/core/stats.js) is the same number.
export const MANA_CAP = 9999;
// Weaves grow with the weaver: +7% damage a level (the sword grows by attack).
export const POWER_PER_LEVEL = 0.07;

// Slots.
export const SLOTS_START = 4;
export const SLOTS_MAX = 6;
export const ESSENCE_SLOTS_START = 2;
export const ESSENCE_SLOTS_MAX = 3;
export const TWIST_SLOTS_START = 2;
export const TWIST_SLOTS_MAX = 4;

// Blending essences: more essences hit a little harder (they cost more too), while
// every status they carry lands at reduced potency.
export const ESSENCE_COUNT_DMG = [1, 1, 1.12, 1.22, 1.3];
export const STATUS_POTENCY = [1, 1, 0.72, 0.58, 0.5];

// Clamps. (Round 15: the old 90 held every big weave at 90 mana, however much was stacked on
// it, "the strongest spell … like 80 something mana"; the ceiling is now one no weave meets.)
export const COST_MIN = 2;
export const COST_MAX = 600;

// What a weave asks of the hands (round 15; the author: "Do not decrease the mana. Increase the
// mana of modified spells and spells in general, because I can literally just do whatever I
// want, put whatever I want in spell"). On top of the budget (which already prices each twist's
// harm), every weave costs COST_BASE more; each essence past the first COST_PER_ESSENCE more;
// each twist COST_PER_TWIST more (four twists: +48%); a strong shape its SHAPE_COST. A
// surcharge on mana only, never on harm: the budget's damage stays as it was. Max mana and
// Focus are untouched (the stats pass numbers stand).
export const COST_BASE = 1.15;
export const COST_PER_ESSENCE = 0.25;
export const COST_PER_TWIST = 0.12;
export const SHAPE_COST = Object.freeze({
  nova: 1.25, // all around you
  rain: 1.25, // called down
  orb: 1.2,
  throw: 1.15,
  beam: 1.15, // its drain per second
  summon: 1.15,
  blast: 1.1,
  rune: 1.05,
  wall: 1.05,
});
// The surcharge for a weave of `shape` with `essences` essences (raw counts as one) and
// `twists` twists (prices are not twists: they carry their own cost).
export function costSurcharge(shape, essences = 1, twists = 0) {
  const e = Math.max(1, Number(essences) || 1);
  const t = Math.max(0, Number(twists) || 0);
  const sh = Number.isFinite(SHAPE_COST[shape]) ? SHAPE_COST[shape] : 1;
  return COST_BASE * (1 + COST_PER_ESSENCE * (e - 1)) * (1 + COST_PER_TWIST * t) * sh;
}
export const COOLDOWN_MIN = 0.16;
export const COOLDOWN_MAX = 12;
export const SIZE_MAX = 3;
export const SPEED_MIN = 20;
export const SPEED_MAX = 720;

// The budget band, relative to the shape's own value-per-mana.
export const BUDGET_LOW = 0.82;
export const BUDGET_HIGH = 1.22;

export const CHILD_SPEED = 220; // split / chain shards fly at this times the plan's speed multiplier

// Cooldowns you can feel (DESIGN §22.1, r12: "the skills doesn't have cooldown"). Every
// shape's own cooldown is stretched by its scale here, so a Spark waits a beat and a
// nova or a rain is something to time; what was already slow (a bind, a ward, a
// familiar) stays as it was. Each weave's timer follows the weave, not its slot.
export const COOLDOWN_SCALE = Object.freeze({
  bolt: 2.35, // 0.32 s -> 0.75 s (the starter Spark stays snappy)
  strike: 3, // 0.5 -> 1.5
  blast: 2.7, // 0.6 -> 1.6
  throw: 2.4, // 0.85 -> 2
  beam: 2, // 0.5 -> 1 (after it is let go)
  rune: 2.5, // 0.7 -> 1.75
  dash: 1.6, // 1.3 -> 2.1
  orb: 2.2, // 1.3 -> 2.9
  nova: 3.2, // 1.1 -> 3.5
  rain: 2.8, // 2.2 -> 6.2
  wall: 2.2, // 3 -> 6.6
});
// A longer wait buys a little damage (so a cooldown is never a pure nerf): +COOLDOWN_DMG
// per e-fold of the scale (a Spark's 2.35 buys +9%, a nova's 3.2 +12%).
export const COOLDOWN_DMG = 0.1;
export const cooldownScale = (shape) => (Number.isFinite(COOLDOWN_SCALE[shape]) ? COOLDOWN_SCALE[shape] : 1);
export const cooldownBuy = (scale) => 1 + COOLDOWN_DMG * Math.log(Math.max(1, Number(scale) || 1));

// Hold to charge (r12: "if I hold it it gets stronger"), every weave but a beam. A press
// shorter than CHARGE_DEAD is a tap (k = 0, cast on release); past it the weave grows to
// a full charge CHARGE_TIME seconds after the press (shortened by cast speed). At charge
// k (0..1) it hits x(1 + CHARGE_POWER k), is up to x(1 + CHARGE_SIZE k) bigger and costs
// x(1 + CHARGE_MANA k) mana, paid when it is let go. The charge twist charges in
// CHARGE_TWIST_TIME of that and reaches CHARGE_TWIST_POWER instead, for CHARGE_TWIST_MANA.
// Round 15: a charge costs as much more as it hits (x2.5 at full, the twist x3), never less: it
// buys the blow in one breath, not cheaper harm.
export const CHARGE_DEAD = 0.18;
export const CHARGE_TIME = 1.5;
export const CHARGE_POWER = 1.5; // x2.5 at a full charge
export const CHARGE_SIZE = 0.45; // x1.45
export const CHARGE_SPEED = 0.25; // x1.25 (bolts fly faster)
export const CHARGE_MANA = 1.5; // x2.5 (round 15; was x2)
export const CHARGE_TWIST_TIME = 0.5; // the twist: twice as fast
export const CHARGE_TWIST_POWER = 2; // x3 at a full charge
export const CHARGE_TWIST_MANA = 2; // x3 at a full charge (round 15)
// Casting stops you (round 14b follow-up, plan §14; the author: "I can move while I'm doing
// spells; it should stop me"). Whoever weaves through game.magic stands to do it:
//   - from the press, while a charge builds or a beam pours, the walk is CHARGE_MOVE = 0
//     (the move stick and WASD only turn you, and so the aim that follows your facing);
//   - when a weave leaves the hands, the caster is planted for the cast pose, PLANT_SHAPE
//     seconds by the shape's weight, plus PLANT_PER_PRICE for each price it carries and a
//     little more for a costly weave, held between PLANT_MIN and PLANT_MAX and shortened by
//     cast speed (never under PLANT_FLOOR);
//   - a roll breaks a charge or a channel (a charge costs nothing; a beam keeps its cooldown)
//     and the plant; a knock-down or a freeze breaks it as before.
// The rule is fixed; the numbers below are what play tunes (DESIGN §38.6).
export const CHARGE_MOVE = 0; // the walk while a charge builds or a beam pours: you stand
export const PLANT_MIN = 0.24;
export const PLANT_MAX = 0.4;
export const PLANT_FLOOR = 0.16; // the shortest plant, however fast the hands
export const PLANT_PER_PRICE = 0.03;
export const PLANT_COST_FROM = 12; // mana: a weave dearer than this plants a little longer
export const PLANT_COST_PER = 0.004; // s per mana past PLANT_COST_FROM
export const PLANT_SHAPE = Object.freeze({
  bolt: 0.24, // the Spark: a flick of the wrist
  strike: 0.26,
  blast: 0.3,
  throw: 0.3,
  bind: 0.32, // a ring thrown true
  ward: 0.28,
  orb: 0.3,
  rune: 0.32,
  summon: 0.36,
  nova: 0.36,
  wall: 0.36,
  rain: 0.4, // the heaviest: you call it down
  beam: 0.26, // after the pour: the hands come down
  dash: 0, // the dash moves you itself (its own lock)
});

// How long a cast plants its caster (s): the shape's weight, its prices and its cost, held
// in [PLANT_MIN, PLANT_MAX], then shortened by cast speed (to PLANT_FLOOR at most).
export function plantFor(plan, castSpeed = 1) {
  if (!plan) return PLANT_MIN;
  const shape = plan.shape || plan.weave?.shape;
  const own = PLANT_SHAPE[shape];
  if (own === 0) return 0;
  let t = Number.isFinite(own) ? own : PLANT_MIN + 0.04;
  const prices = Array.isArray(plan.prices) ? plan.prices.length : 0;
  t += prices * PLANT_PER_PRICE;
  const cost = Number(plan.cost) || 0;
  if (cost > PLANT_COST_FROM) t += (cost - PLANT_COST_FROM) * PLANT_COST_PER;
  t = Math.max(PLANT_MIN, Math.min(PLANT_MAX, t));
  const cs = Math.max(0.3, Number(castSpeed) || 1);
  return Math.max(PLANT_FLOOR, t / cs);
}

// The charge k a hold of `t` seconds has reached (before the mana cap).
export function chargeK(t, time = CHARGE_TIME, castSpeed = 1) {
  const live = (Number(t) || 0) - CHARGE_DEAD;
  if (!(live > 0)) return 0;
  const span = Math.max(0.1, (Number(time) || CHARGE_TIME) - CHARGE_DEAD);
  return Math.min(1, (live * Math.max(0.3, Number(castSpeed) || 1)) / span);
}

// The most charge `mana` can pay for, for a weave that costs `cost` uncharged (`per`: the
// plan's chargeMana, CHARGE_MANA unless the charge twist rides it).
export function affordableK(mana, cost, per = CHARGE_MANA) {
  if (!(cost > 0)) return 1;
  const m = Number.isFinite(per) && per > 0 ? per : CHARGE_MANA;
  return Math.max(0, Math.min(1, ((Number(mana) || 0) / cost - 1) / m));
}

// What a cast of a weave costing `cost` uncharged pays at charge k.
export function chargedCost(cost, k = 1, per = CHARGE_MANA) {
  const m = Number.isFinite(per) && per > 0 ? per : CHARGE_MANA;
  return (Number(cost) || 0) * (1 + m * Math.max(0, Math.min(1, Number(k) || 0)));
}

// Hold a plan inside the budget: too efficient -> it costs more; too weak -> it hits harder.
// `shapeValue` / `shapeCost` describe the bare shape, `value` the plan's expected harm per
// cast (damage x expected hits, x every twist's value), `cost` its raw mana cost.
// `buy` (>= 1): the damage a longer cooldown buys; the band moves up with it.
export function applyBudget(plan, shapeValue, shapeCost, buy = 1) {
  const b = Number.isFinite(buy) && buy > 0 ? buy : 1;
  plan.dmg *= b;
  plan.value *= b;
  const base = (shapeValue / Math.max(1, shapeCost)) * b;
  const ratio = plan.value / Math.max(1, plan.cost);
  const hi = base * BUDGET_HIGH;
  const lo = base * BUDGET_LOW;
  plan.budget = { base, ratio, lo, hi, buy: b, adjusted: 'none' };
  if (ratio > hi) {
    plan.cost = plan.value / hi;
    plan.budget.adjusted = 'cost';
  } else if (ratio < lo) {
    const k = (lo * plan.cost) / Math.max(0.001, plan.value);
    plan.dmg *= k;
    plan.value *= k;
    plan.budget.adjusted = 'damage';
  }
  plan.cost = Math.max(COST_MIN, Math.min(COST_MAX, plan.cost));
  return plan;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
