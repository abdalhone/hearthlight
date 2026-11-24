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
export const MANA_REGEN = 3.2; // per second, plus a share of the max
export const MANA_REGEN_SHARE = 0.025; // of max per second
export const MANA_REGEN_DELAY = 0.6; // seconds after spending before regen resumes
export const MANA_PER_LEVEL = 4;
export const MANA_CAP = 400;

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
export const COOLDOWN_MAX = 9;
export const SIZE_MAX = 3;
export const SPEED_MIN = 20;
export const SPEED_MAX = 720;

// The budget band, relative to the shape's own value-per-mana.
export const BUDGET_LOW = 0.82;
export const BUDGET_HIGH = 1.22;

export const CHILD_SPEED = 220; // split / chain shards fly at this times the plan's speed multiplier
export const CHARGE_TIME = 1.1; // seconds to a full charge

// Hold a plan inside the budget: too efficient -> it costs more; too weak -> it hits harder.
// `shapeValue` / `shapeCost` describe the bare shape, `value` the plan's expected harm per
// cast (damage x expected hits, x every twist's value), `cost` its raw mana cost.
export function applyBudget(plan, shapeValue, shapeCost) {
  const base = shapeValue / Math.max(1, shapeCost);
  const ratio = plan.value / Math.max(1, plan.cost);
  const hi = base * BUDGET_HIGH;
  const lo = base * BUDGET_LOW;
  plan.budget = { base, ratio, lo, hi, adjusted: 'none' };
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
