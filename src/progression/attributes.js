// The six attributes a level's points go into (DESIGN §26), and what a level itself
// gives. Plain data: the stat pipeline (src/core/stats.js) folds `pointsEffect(id, n)`
// (the curve below) and `LEVEL_GROWTH × (level − 1)` in as its 'points' and 'level'
// sources, the character sheet reads the words. Ids are a contract (saves keep points by
// id, and only what they add is worked out again): never rename.
//
// Diminishing returns (round 14b; the author: "the least points are in a skill, like the
// more effect it has, but with time it lowers and lowers. So the difference between 180
// and 200 is not as big of a difference as 50 and 70"). Every effect of every attribute
// follows one curve:
//
//     effect(n) = x / √(1 + (x / cap)²),     x = per × n
//
// `per` is what one point gave before (the first point still gives it, to a hair), `cap`
// the effect's soft ceiling: the total creeps up on it and never reaches it, and each
// point gives a little less than the one before, never nothing. The bend sits near
// n = cap / per points (the effect's "knee", 15 to 60 points): below it a point counts
// nearly in full, so ordinary play (30 to 45 points by level 10 to 15) moves little; past
// it the points add less and less. Chosen over cap·x/(x+cap) (which takes a third off
// the tenth point already) because it keeps the early points whole; it still gives
// gain(50→70) more than three times gain(180→200) for every effect while the knee is
// under ~160 points (tests/stat_curve.test.mjs holds that).

export const POINTS_PER_LEVEL = 3;

export const ATTRS = Object.freeze({
  vitality: {
    name: 'Vitality',
    short: 'VIT',
    color: '#ff6b6b',
    line: 'Health, and how fast wounds knit',
    per: { add: { maxHp: 6, hpRegen: 0.12 } },
    cap: { add: { maxHp: 360, hpRegen: 7.2 } },
    main: 'maxHp',
  },
  might: {
    name: 'Might',
    short: 'MGT',
    color: '#ffb047',
    line: 'Sword and strike weaves',
    per: { add: { atk: 0.8 }, pct: { strike: 0.05 } },
    cap: { add: { atk: 48 }, pct: { strike: 3 } },
    main: 'atk',
  },
  weave: {
    name: 'Weave',
    short: 'WVE',
    color: '#b99cff',
    line: 'The power of every weave',
    per: { add: { spellPower: 0.05 } },
    cap: { add: { spellPower: 3 } },
    main: 'spellPower',
  },
  focus: {
    name: 'Focus',
    short: 'FOC',
    color: '#7fb6ff',
    line: 'Mana, mana coming back, shorter cooldowns',
    per: { add: { maxMana: 5 }, pct: { manaRegen: 0.06, cooldown: -0.02 } },
    cap: { add: { maxMana: 250 }, pct: { manaRegen: 3, cooldown: -0.5 } },
    main: 'maxMana',
  },
  grace: {
    name: 'Grace',
    short: 'GRC',
    color: '#7fe0b0',
    line: 'Speed, dodging, critical hits',
    per: { pct: { speed: 0.015 }, add: { dodge: 0.012, crit: 0.01 } },
    cap: { pct: { speed: 0.7 }, add: { dodge: 0.3, crit: 0.3 } },
    main: 'speed',
  },
  resolve: {
    name: 'Resolve',
    short: 'RES',
    color: '#ffe08a',
    line: 'Shrug off statuses, last longer when you fall, carry faster',
    per: { add: { resist: 0.03, bleedout: 4 }, pct: { carrySpeed: 0.04 } },
    cap: { add: { resist: 0.5, bleedout: 120 }, pct: { carrySpeed: 0.6 } },
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
// follow the curve below).
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

// ---------------------------------------------------------------- the curve (round 14b)
//
// Why each cap (soft ceilings: 999 points come within a hair of them, never past):
//   speed +70%     76 px/s walks at most ~129 on points alone: Lyra's own top run (80 ×
//                  1.6 = 128), so a companion keeps up, and well under the roll's 190
//                  burst. Everything else that hastes you stacks on top and meets the
//                  pipeline's speed ceiling (STATS.speed in src/core/stats.js).
//   dodge 30%, crit 30%, resist 50%, cooldown −50%: under their hard clamps (40%, 60%,
//                  75%, ×0.4) with room for gear, potions and surges, so the clamp is
//                  never what stops the points.
//   carrying +60%  carrying is ×0.6 of your walk; ×1.6 on that is still a little slower
//                  than walking unladen, as it should be.
//   bleed-out +120 s  75 s becomes at most 195 s: longer to be found, never safe (§27).
//   health +360, regen +7.2/s, sword +48, strike +300%, weave power +300%: about sixty
//                  points' worth at the old rate; with mana +250 and mana regen +300%
//                  about fifty (the mana pool stays under its 400 clamp until late
//                  levels). Death stays dangerous: foes grow bolder with your level (THREAT)
//                  and the points no longer run away from them.
export const CURVE_POWER = 2;

// One effect of n points: x = per × n bent toward cap (same sign as per; 0 for n ≤ 0).
export function curve(per, cap, n) {
  if (!(n > 0) || !per) return 0;
  const x = per * n;
  const c = Math.abs(cap);
  if (!(c > 0)) return x; // no cap given: as it was (never in ATTRS: the test holds every effect has one)
  return x / Math.pow(1 + Math.pow(Math.abs(x) / c, CURVE_POWER), 1 / CURVE_POWER);
}

// What n points in one attribute add: { add, pct } on the curve (null for none).
export function pointsEffect(id, n) {
  const a = Object.prototype.hasOwnProperty.call(ATTRS, id) ? ATTRS[id] : null;
  if (!a || !(n > 0)) return null;
  const out = {};
  for (const part of ['add', 'pct']) {
    if (!a.per[part]) continue;
    out[part] = {};
    for (const [k, v] of Object.entries(a.per[part])) out[part][k] = curve(v, a.cap?.[part]?.[k], n);
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
