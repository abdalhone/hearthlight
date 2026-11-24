// The six attributes a level's points go into (DESIGN §26), and what a level itself
// gives. Plain data: the stat pipeline (src/core/stats.js) folds `per × points` and
// `LEVEL_GROWTH × (level − 1)` in as its 'points' and 'level' sources, the character
// sheet reads the words. Ids are a contract (saves keep points by id): never rename.

export const POINTS_PER_LEVEL = 3;

export const ATTRS = Object.freeze({
  vitality: {
    name: 'Vitality',
    short: 'VIT',
    color: '#ff6b6b',
    line: 'Health, and how fast wounds knit',
    per: { add: { maxHp: 6, hpRegen: 0.12 } },
  },
  might: {
    name: 'Might',
    short: 'MGT',
    color: '#ffb047',
    line: 'Sword and strike weaves',
    per: { add: { atk: 0.8 }, pct: { strike: 0.05 } },
  },
  weave: {
    name: 'Weave',
    short: 'WVE',
    color: '#b99cff',
    line: 'The power of every weave',
    per: { add: { spellPower: 0.05 } },
  },
  focus: {
    name: 'Focus',
    short: 'FOC',
    color: '#7fb6ff',
    line: 'Mana, mana coming back, shorter cooldowns',
    per: { add: { maxMana: 5 }, pct: { manaRegen: 0.06, cooldown: -0.02 } },
  },
  grace: {
    name: 'Grace',
    short: 'GRC',
    color: '#7fe0b0',
    line: 'Speed, dodging, critical hits',
    per: { pct: { speed: 0.015 }, add: { dodge: 0.012, crit: 0.01 } },
  },
  resolve: {
    name: 'Resolve',
    short: 'RES',
    color: '#ffe08a',
    line: 'Shrug off statuses, last longer when you fall, carry faster',
    per: { add: { resist: 0.03, bleedout: 4 }, pct: { carrySpeed: 0.04 } },
  },
});

export const ATTR_IDS = Object.freeze(Object.keys(ATTRS));

// Each level past the first, before any points (the player; Lyra has her own).
export const LEVEL_GROWTH = Object.freeze({
  player: { add: { maxHp: 5, atk: 0.6, maxMana: 3, spellPower: 0.035 } },
  lyra: { add: { maxHp: 8, atk: 1, def: 0.15 } },
});

// The chapel's respec (Sister Aveline): a price in coin that grows with the level.
export function respecCost(level) {
  const lv = Math.max(1, Math.floor(level || 1));
  return 20 + 12 * (lv - 1);
}

// A contribution scaled by n: { add, pct } × n.
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

// Experience for things done (DESIGN §26: fights, missions, bosses and good deeds).
export const XP_FOR = Object.freeze({
  mission: 15, // a finished mission that names no xp of its own
  boss: 60, // on top of the boss's own xp
  revive: 18, // helping a fallen person up
  carry: 28, // carrying someone to a sickbed in time
});
