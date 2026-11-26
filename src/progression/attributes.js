import { STATS, DEFAULTS } from '../core/stats.js';

// The six attributes a level's points go into (DESIGN §26), and what a level itself
// gives. Plain data: the stat pipeline (src/core/stats.js) folds `pointsEffect(id, n)`
// (the curves below) and `LEVEL_GROWTH × (level − 1)` in as its 'points' and 'level'
// sources, the character sheet reads the words. Ids are a contract (saves keep points by
// id, and only what they add is worked out again): never rename.
//
// How points add up (round 14b, second pass). The author, first: "when I put a lot of
// points of speed, I can like literally be so fast that it's unplayable … the difference
// between 180 and 200 is not as big of a difference as 50 and 70"; then, of a first pass
// that bent everything toward a ceiling: "you are really destroying the stats … if I put 5
// points into something, it's a little benefit, but if I put 10, it's really a benefit …
// keep it only for the speed. And also like for the speeds of attacks. But for damage and
// like mana and health … They should have a curve, but not as harsh as this."
//
// So every effect is one of three kinds (EFFECT_KIND):
//
//   speed   how fast you move or act: walking pace (Grace), cooldowns (Focus), carrying
//           pace (Resolve). A strong bend toward a soft ceiling:
//               effect(n) = x / √(1 + (x / cap)²),   x = per × n
//           the first points whole, the far ones small (999 Grace walks at ~129 px/s).
//   gentle  health, regen, the sword, strike weaves, weave power, mana, mana regen,
//           bleed-out: no ceiling, a slow bend:
//               effect(n) = per × K/a × ((1 + n/K)^a − 1),   a = 0.65, K = 50
//           a point at n is worth per × (1 + n/K)^(a − 1) of the first: 40 points give
//           ~90% of forty first points, 50→70 is only ~1.3 times 180→200, and a point at
//           999 still adds ~34% of the first. Strength, magic and health keep growing.
//   chance  dodge, crit, status resistance: they cannot pass 100%, so they bend like a
//           speed, but toward the pipeline's own clamp (cap = clamp − everyone's base),
//           never a ceiling well under it.
//
// `per` is what the first point gives; the second pass raised it where five or ten points
// did not show in a fight (scripts/stats_sim.mjs measures hits to kill, hits that drop
// you, casts in a pool and seconds to beat each boss).
export const POINTS_PER_LEVEL = 3;

export const ATTRS = Object.freeze({
  vitality: {
    name: 'Vitality',
    short: 'VIT',
    color: '#ff6b6b',
    line: 'Health, and how fast wounds knit',
    per: { add: { maxHp: 10, hpRegen: 0.2 } },
    main: 'maxHp',
  },
  might: {
    name: 'Might',
    short: 'MGT',
    color: '#ffb047',
    line: 'Sword and strike weaves',
    per: { add: { atk: 1.2 }, pct: { strike: 0.07 } },
    main: 'atk',
  },
  weave: {
    name: 'Weave',
    short: 'WVE',
    color: '#b99cff',
    line: 'The power of every weave',
    per: { add: { spellPower: 0.08 } },
    main: 'spellPower',
  },
  focus: {
    name: 'Focus',
    short: 'FOC',
    color: '#7fb6ff',
    line: 'Mana, mana coming back, shorter cooldowns',
    per: { add: { maxMana: 8 }, pct: { manaRegen: 0.08, cooldown: -0.02 } },
    cap: { pct: { cooldown: -0.5 } },
    main: 'maxMana',
  },
  grace: {
    name: 'Grace',
    short: 'GRC',
    color: '#7fe0b0',
    line: 'Speed, dodging, critical hits',
    per: { pct: { speed: 0.015 }, add: { dodge: 0.015, crit: 0.015 } },
    cap: { pct: { speed: 0.7 } },
    main: 'speed',
  },
  resolve: {
    name: 'Resolve',
    short: 'RES',
    color: '#ffe08a',
    line: 'Shrug off statuses, last longer when you fall, carry faster',
    per: { add: { resist: 0.05, bleedout: 5 }, pct: { carrySpeed: 0.04 } },
    cap: { pct: { carrySpeed: 0.6 } },
    main: 'resist',
  },
});

export const ATTR_IDS = Object.freeze(Object.keys(ATTRS));

// Each level past the first, before any points (the player; Lyra has her own).
export const LEVEL_GROWTH = Object.freeze({
  player: { add: { maxHp: 5, atk: 0.6, maxMana: 3, spellPower: 0.035 } },
  lyra: { add: { maxHp: 8, atk: 1, def: 0.15 } },
});

// Foes grow bolder as the stranger grows (damage dealt, per player level past the first).
export const THREAT = Object.freeze({ factions: ['monster', 'bandit', 'undead'], perLevel: 0.05, cap: 0.5 });

// The chapel's respec (Sister Aveline): a price in coin that grows with the level.
export function respecCost(level) {
  const lv = Math.max(1, Math.floor(level || 1));
  return 20 + 12 * (lv - 1);
}

// A contribution scaled by n: { add, pct } × n (levels grow in a straight line; points
// follow the curves below).
export function scaled(per, n) {
  if (!per || !(n > 0)) return null;
  const out = {};
  for (const part of ['add', 'pct']) {
    if (!per[part]) continue;
    out[part] = {};
    for (const [k, v] of Object.entries(per[part])) out[part][k] = Math.round(v * n * 10000) / 10000;
  }
  return out;
}

// ---------------------------------------------------------------- the curves (round 14b)
//
// Which kind each effect is (anything not named here is gentle).
export const EFFECT_KIND = Object.freeze({
  speed: 'speed',
  cooldown: 'speed',
  carrySpeed: 'speed',
  dodge: 'chance',
  crit: 'chance',
  resist: 'chance',
});
export const kindOf = (stat) => EFFECT_KIND[stat] || 'gentle';

// The speeds' soft ceilings (ATTRS[id].cap; 999 points come within a hair, never past):
//   speed +70%     76 px/s walks at most ~129 on points alone: Lyra's own top run (80 ×
//                  1.6 = 128), so a companion keeps up, and well under the roll's 190.
//                  Hastes (gear, a draught, a surge, Berserk, the Last Stand, Oath) add
//                  their full share on top (the pipeline sums them; STATS.speed.max is
//                  only a safety clamp no real stack reaches).
//   cooldowns −50% ×0.5 at best on points, so the ×0.4 clamp is never what stops them.
//   carrying +60%  carrying is ×0.6 of your walk and is multiplied after every haste;
//                  ×1.6 on that keeps it a little slower than walking unladen.
// A chance's ceiling is its clamp less everyone's base (dodge 40%, crit 60% − 10%,
// resistance 75%): points alone creep up on the clamp and never reach it.
export const CURVE_POWER = 2;
export const GENTLE = Object.freeze({ a: 0.65, k: 50 });

// One bent effect of n points: x = per × n toward cap (same sign as per; 0 for n ≤ 0).
export function curve(per, cap, n) {
  if (!(n > 0) || !per) return 0;
  const x = per * n;
  const c = Math.abs(cap);
  if (!(c > 0)) return x; // no cap given: a straight line (never in ATTRS: the test holds that)
  return x / Math.pow(1 + Math.pow(Math.abs(x) / c, CURVE_POWER), 1 / CURVE_POWER);
}

// One gentle effect of n points: per × K/a × ((1 + n/K)^a − 1). No ceiling; the slope at
// n is per × (1 + n/K)^(a − 1), so the first point gives per to a hair.
export function gentle(per, n) {
  if (!(n > 0) || !per) return 0;
  const { a, k } = GENTLE;
  return ((per * k) / a) * (Math.pow(1 + n / k, a) - 1);
}

// The ceiling a bent effect heads for: a speed's own cap, a chance's clamp less its base.
export function capOf(id, part, stat) {
  const kind = kindOf(stat);
  if (kind === 'gentle') return null;
  const own = ATTRS[id]?.cap?.[part]?.[stat];
  if (own != null) return own;
  if (kind === 'chance' && STATS[stat]) return STATS[stat].max - (DEFAULTS[stat] || 0);
  return null;
}

// One effect of n points in attribute `id`, on its own kind of curve.
export function effectOf(id, part, stat, n) {
  const per = ATTRS[id]?.per?.[part]?.[stat];
  if (!per) return 0;
  return kindOf(stat) === 'gentle' ? gentle(per, n) : curve(per, capOf(id, part, stat), n);
}

// What n points in one attribute add: { add, pct }, each effect on its curve (null for none).
export function pointsEffect(id, n) {
  const a = Object.prototype.hasOwnProperty.call(ATTRS, id) ? ATTRS[id] : null;
  if (!a || !(n > 0)) return null;
  const out = {};
  for (const part of ['add', 'pct']) {
    if (!a.per[part]) continue;
    out[part] = {};
    for (const k of Object.keys(a.per[part])) out[part][k] = effectOf(id, part, k, n);
  }
  return out;
}

// What the next point would add on top of n: [{ stat, part, d }] in the order the
// attribute lists them, its main effect first.
export function nextPoint(id, n = 0) {
  const a = Object.prototype.hasOwnProperty.call(ATTRS, id) ? ATTRS[id] : null;
  if (!a) return [];
  const k = Math.max(0, Math.floor(n || 0));
  const now = pointsEffect(id, k);
  const then = pointsEffect(id, k + 1);
  const out = [];
  for (const part of ['add', 'pct']) for (const stat of Object.keys(a.per[part] || {})) out.push({ stat, part, d: (then?.[part]?.[stat] || 0) - (now?.[part]?.[stat] || 0), first: a.per[part][stat] });
  out.sort((x, y) => (y.stat === a.main) - (x.stat === a.main));
  return out;
}

// Experience for things done (DESIGN §26: fights, missions, bosses and good deeds).
export const XP_FOR = Object.freeze({
  mission: 15, // a finished mission that names no xp of its own
  boss: 60, // on top of the boss's own xp
  revive: 18, // helping a fallen person up
  carry: 28, // carrying someone to a sickbed in time
});
