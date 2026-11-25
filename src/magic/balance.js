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
export const MANA_CAP = 400;
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

// Clamps.
export const COST_MIN = 2;
export const COST_MAX = 90;
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
  bolt: 2.8, // 0.32 s -> 0.9 s
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
// per e-fold of the scale (a Spark's 2.8 buys +10%, a nova's 3.2 +12%).
export const COOLDOWN_DMG = 0.1;
export const cooldownScale = (shape) => (Number.isFinite(COOLDOWN_SCALE[shape]) ? COOLDOWN_SCALE[shape] : 1);
export const cooldownBuy = (scale) => 1 + COOLDOWN_DMG * Math.log(Math.max(1, Number(scale) || 1));

// Hold to charge (r12: "if I hold it it gets stronger"), every weave but a beam. A press
// shorter than CHARGE_DEAD is a tap (k = 0, cast on release); past it the weave grows to
// a full charge CHARGE_TIME seconds after the press (shortened by cast speed). At charge
// k (0..1) it hits x(1 + CHARGE_POWER k), is up to x(1 + CHARGE_SIZE k) bigger and costs
// x(1 + CHARGE_MANA k) mana, paid when it is let go. The charge twist charges in
// CHARGE_TWIST_TIME of that and reaches CHARGE_TWIST_POWER instead.
export const CHARGE_DEAD = 0.18;
export const CHARGE_TIME = 1.5;
export const CHARGE_POWER = 1.5; // x2.5 at a full charge
export const CHARGE_SIZE = 0.45; // x1.45
export const CHARGE_SPEED = 0.25; // x1.25 (bolts fly faster)
export const CHARGE_MANA = 1; // x2
export const CHARGE_TWIST_TIME = 0.5; // the twist: twice as fast
export const CHARGE_TWIST_POWER = 2; // x3 at a full charge
export const CHARGE_MOVE = 0.62; // the walk while a charge builds or a beam pours

// The charge k a hold of `t` seconds has reached (before the mana cap).
export function chargeK(t, time = CHARGE_TIME, castSpeed = 1) {
  const live = (Number(t) || 0) - CHARGE_DEAD;
  if (!(live > 0)) return 0;
  const span = Math.max(0.1, (Number(time) || CHARGE_TIME) - CHARGE_DEAD);
  return Math.min(1, (live * Math.max(0.3, Number(castSpeed) || 1)) / span);
}

// The most charge `mana` can pay for, for a weave that costs `cost` uncharged.
export function affordableK(mana, cost) {
  if (!(cost > 0)) return 1;
  return Math.max(0, Math.min(1, ((Number(mana) || 0) / cost - 1) / CHARGE_MANA));
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
