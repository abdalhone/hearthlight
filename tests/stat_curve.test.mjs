import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Stats, STATS, DEFAULTS } from '../src/core/stats.js';
import { ATTRS, ATTR_IDS, CURVE_POWER, GENTLE, EFFECT_KIND, kindOf, capOf, curve, gentle, effectOf, pointsEffect, nextPoint, scaled } from '../src/progression/attributes.js';
import { installProgression, saveProgression, loadProgression } from '../src/progression/index.js';
import { FREE_MAX } from '../src/progression/progression.js';
import { GEAR, BUFF_ITEMS } from '../src/gear/gear_data.js';
import { PRICES, LAST_STAND_GAIN, SURGE_BUFFS, surgeModifier } from '../src/magic/prices.js';
import { MANA_CAP } from '../src/magic/balance.js';
import { ROLL, PLAYER_BASE, COMBO } from '../src/entities/player.js';
import { SPECIES } from '../src/entities/monsters.js';
import { Actor } from '../src/entities/entity.js';
import { BOSSES } from '../src/bosses/defs.js';
import { makeGame } from './magic_helpers.mjs';
import { fights } from '../scripts/stats_sim.mjs';

// Round 14b, DESIGN §26. The author, first: "when I put a lot of points of speed, I can
// like literally be so fast that it's unplayable"; then, of a first pass that bent every
// stat toward a ceiling: "40% should always give 40%, no matter what … if I put 5 points
// into something, it's a little benefit, but if I put 10, it's really a benefit … keep it
// only for the speed. And also like for the speeds of attacks. But for damage and like
// mana and health … not as harsh as this." So: speeds bend hard, chances bend toward their
// own clamps, everything else grows gently without end, and a percentage is its full share.

// Every effect of every attribute: [attr, part, stat, per].
function effects() {
  const out = [];
  for (const id of ATTR_IDS) {
    const a = ATTRS[id];
    for (const part of ['add', 'pct']) for (const [stat, per] of Object.entries(a.per[part] || {})) out.push([id, part, stat, per]);
  }
  return out;
}

const at = (id, part, stat, n) => pointsEffect(id, n)?.[part]?.[stat] ?? 0;
const gain = (id, part, stat, a, b) => Math.abs(at(id, part, stat, b) - at(id, part, stat, a));

// The first pass's numbers (7e92815), for "not the losers any more".
const FIRST = {
  dodge: { per: 0.012, cap: 0.3 },
  crit: { per: 0.01, cap: 0.3 },
  resist: { per: 0.03, cap: 0.5 },
};
// The straight line of 07b2e76.
const OLD = { maxHp: 6, hpRegen: 0.12, atk: 0.8, strike: 0.05, spellPower: 0.05, maxMana: 5, manaRegen: 0.06, bleedout: 4, dodge: 0.012, crit: 0.01, resist: 0.03 };

// ---------------------------------------------------------------- the three kinds

test('every effect is a speed, a chance or gentle: speeds are how fast you move or act; chances cannot pass 100%', () => {
  assert.equal(CURVE_POWER, 2);
  assert.deepEqual({ ...GENTLE }, { a: 0.65, k: 50 });
  assert.deepEqual(Object.keys(EFFECT_KIND).sort(), ['carrySpeed', 'cooldown', 'crit', 'dodge', 'resist', 'speed']);
  const kinds = {};
  for (const [id, part, stat, per] of effects()) {
    const kind = kindOf(stat);
    kinds[stat] = kind;
    const cap = capOf(id, part, stat);
    if (kind === 'gentle') assert.equal(cap, null, `${id}.${stat} has no ceiling`);
    else {
      assert.ok(Number.isFinite(cap) && cap !== 0, `${id}.${stat} bends toward a ceiling`);
      assert.equal(Math.sign(cap), Math.sign(per), `${id}.${stat}: the ceiling points the same way as the point`);
    }
    if (kind === 'chance') assert.ok(Math.abs(cap - (STATS[stat].max - (DEFAULTS[stat] || 0))) < 1e-12, `${stat}: its ceiling is its own clamp, less everyone's base`);
  }
  // No attack or cast speed comes from a point except Focus's cooldowns (swing and cast speed
  // are gear and prices): the speeds are walking, cooldowns and carrying.
  assert.deepEqual(Object.keys(kinds).filter((k) => kinds[k] === 'speed').sort(), ['carrySpeed', 'cooldown', 'speed']);
  assert.ok(!effects().some(([, , stat]) => stat === 'swing' || stat === 'castSpeed'));
  for (const id of ATTR_IDS) {
    const a = ATTRS[id];
    assert.ok(a.per.add?.[a.main] != null || a.per.pct?.[a.main] != null, `${id}: main effect ${a.main} is one of its own`);
    for (const part of ['add', 'pct']) for (const k of Object.keys(a.cap?.[part] || {})) assert.equal(kindOf(k), 'speed', `${id}: only speeds carry a cap of their own (${k})`);
  }
});

test('every effect: monotone, each point no more than the last, the first point whole', () => {
  for (const [id, part, stat, per] of effects()) {
    const name = `${id}.${stat}`;
    let prev = 0;
    let prevGain = Infinity;
    for (let n = 1; n <= FREE_MAX; n++) {
      const v = at(id, part, stat, n);
      const g = Math.abs(v - prev);
      assert.ok(g > 0, `${name}: point ${n} still adds something`);
      assert.ok(Math.sign(v) === Math.sign(per), `${name}: never turns round`);
      assert.ok(g <= prevGain + 1e-12, `${name}: point ${n} adds no more than point ${n - 1}`);
      prev = v;
      prevGain = g;
    }
    const first = at(id, part, stat, 1);
    assert.ok(Math.abs(first - per) <= 0.05 * Math.abs(per), `${name}: the first point (${first}) is within 5% of ${per}`);
    assert.equal(effectOf(id, part, stat, 37), at(id, part, stat, 37));
  }
  assert.equal(pointsEffect('grace', 0), null);
  assert.equal(pointsEffect('nope', 5), null);
  assert.equal(curve(0.5, 1, -3), 0);
  assert.equal(gentle(0.5, 0), 0);
});

test('speeds bend hard: 50→70 adds more than three times 180→200, and they stay under their ceilings', () => {
  for (const [id, part, stat] of effects()) {
    if (kindOf(stat) !== 'speed') continue;
    const g1 = gain(id, part, stat, 50, 70);
    const g2 = gain(id, part, stat, 180, 200);
    assert.ok(g1 > 3 * g2 && g2 > 0, `${id}.${stat}: 50→70 adds ${g1.toFixed(4)}, 180→200 adds ${g2.toFixed(5)}`);
    const cap = Math.abs(capOf(id, part, stat));
    const top = Math.abs(at(id, part, stat, FREE_MAX));
    assert.ok(top < cap && top > 0.95 * cap, `${id}.${stat}: ${top} at ${FREE_MAX} under its ceiling ${cap}`);
  }
});

test('everything else grows gently and without end: 50→70 only 1.2–2.5 times 180→200; a point at 999 still adds 30% of the first', () => {
  for (const [id, part, stat, per] of effects()) {
    if (kindOf(stat) !== 'gentle') continue;
    const name = `${id}.${stat}`;
    const ratio = gain(id, part, stat, 50, 70) / gain(id, part, stat, 180, 200);
    assert.ok(ratio >= 1.2 && ratio <= 2.5, `${name}: 50→70 is ${ratio.toFixed(2)} times 180→200`);
    const late = gain(id, part, stat, FREE_MAX - 1, FREE_MAX);
    assert.ok(late >= 0.3 * Math.abs(per), `${name}: the 999th point adds ${late.toFixed(4)} (${((late / per) * 100).toFixed(0)}% of the first)`);
    // The first forty points come nearly whole.
    assert.ok(at(id, part, stat, 40) >= 0.88 * 40 * per, `${name}: forty points give ${(at(id, part, stat, 40) / (40 * per) * 100).toFixed(0)}% of forty first points`);
    // Up to 60 points (a whole level-21 life in one attribute) it gives at least the old straight line.
    for (const n of [5, 10, 20, 30, 45, 60]) assert.ok(at(id, part, stat, n) >= OLD[stat] * n - 1e-9, `${name}: ${n} points give ${at(id, part, stat, n).toFixed(2)}, the old line ${(OLD[stat] * n).toFixed(2)}`);
  }
});

test('chances bend toward their own clamps: never past them, and never less than the first pass gave (Grace and Resolve are not the losers)', () => {
  const g = arena();
  const P = g.player;
  g.progression.startFree();
  for (const id of ATTR_IDS) g.progression.spend(id, FREE_MAX);
  const v = g.stats.all(P);
  for (const stat of ['dodge', 'crit', 'resist']) {
    assert.ok(v[stat] < STATS[stat].max, `${stat} ${v[stat]} under its clamp ${STATS[stat].max}`);
    assert.ok(v[stat] > STATS[stat].max - 0.01, `${stat} creeps up on the clamp itself (${v[stat]})`);
    const id = stat === 'resist' ? 'resolve' : 'grace';
    const per = ATTRS[id].per.add[stat];
    for (const n of [1, 5, 10, 20, 50, 200, FREE_MAX]) {
      const first = curve(FIRST[stat].per, FIRST[stat].cap, n);
      assert.ok(at(id, 'add', stat, n) > first, `${stat} at ${n}: ${at(id, 'add', stat, n).toFixed(3)} beats the first pass's ${first.toFixed(3)}`);
    }
    for (const n of [1, 5, 10]) assert.ok(at(id, 'add', stat, n) >= OLD[stat] * n, `${stat}: ${n} points give at least the old line`);
    assert.ok(per >= OLD[stat]);
  }
  assert.ok(v.cooldown > STATS.cooldown.min, `cooldown ${v.cooldown}: the ×0.4 clamp is never what stops the points`);
  assert.ok(v.carrySpeed * 0.6 < 1, 'carrying stays slower than walking unladen');
});

// ---------------------------------------------------------------- percentages are whole

function arena() {
  const g = makeGame({ foes: 0 });
  // The stranger's own level-1 numbers (player.js), so the speeds read as in the game.
  Object.assign(g.player, { maxHp: PLAYER_BASE.maxHp, hp: PLAYER_BASE.maxHp, atk: PLAYER_BASE.atk, def: PLAYER_BASE.def, speed: PLAYER_BASE.speed });
  installProgression(g);
  g.bus.emit('game_start', { loaded: false });
  return g;
}

// The fastest piece for each slot (two charm slots), by its speed share.
function fastestGear() {
  const best = {};
  for (const [id, d] of Object.entries(GEAR)) {
    const p = d.stats?.pct?.speed || 0;
    if (!(p > 0)) continue;
    if (!best[d.slot] || p > best[d.slot].p) best[d.slot] = { id, p };
  }
  return best;
}

// The fastest a surge can make you (one surge at a time; blends share it out).
function fastestSurge() {
  let best = null;
  const ids = Object.keys(SURGE_BUFFS);
  const combos = [...ids.map((e) => [e]), ...ids.flatMap((a, i) => ids.slice(i + 1).map((b) => [a, b])), ...ids.flatMap((a, i) => ids.slice(i + 1).flatMap((b, j) => ids.slice(i + j + 2).map((c) => [a, b, c])))];
  for (const essences of combos) {
    const m = surgeModifier({ essences });
    if (!best || (m.pct.speed || 0) > (best.pct.speed || 0)) best = m;
  }
  return best;
}

const BERSERK = { id: 'price:berserk:gain', source: 'price:berserk', ...PRICES.berserk.gain, t: 120 };

// Everything else that hastes the stranger: gear, Swiftfoot, the best surge, the Last Stand
// and Oath with the companion beside you.
function stackTheRest(g) {
  const P = g.player;
  const S = g.stats;
  const gear = fastestGear();
  for (const [slot, { id }] of Object.entries(gear)) {
    P.inventory.add(id, 2);
    assert.ok(g.gear.equip(id).ok, `wear ${id}`);
    if (slot === 'charm') g.gear.equip(id, 'charm2');
  }
  S.addModifier(P, { id: 'swiftfoot', ...BUFF_ITEMS.swiftfoot_draught.buff, t: 120 });
  S.addModifier(P, fastestSurge());
  S.addModifier(P, { id: 'price:laststand:gain', source: 'price:laststand', ...LAST_STAND_GAIN, t: 60 });
  g.prices.state.oath = { t: 60 };
  g.companion.x = P.x + 10;
  g.companion.y = P.y;
  S.refresh(P);
  return gear;
}

test('Berserk\'s +40% speed is 40% of the normal pace (+30.4 px/s) at 0, 50 and 999 Grace, alone and with everything else', () => {
  const want = 0.4 * PLAYER_BASE.speed;
  assert.equal(PRICES.berserk.gain.pct.speed, 0.4);
  for (const n of [0, 50, FREE_MAX]) {
    for (const stacked of [false, true]) {
      const g = arena();
      const P = g.player;
      const pr = g.progression;
      pr.startFree();
      pr.points.grace = n;
      pr.changed();
      if (stacked) stackTheRest(g);
      const before = P.speed;
      g.stats.addModifier(P, BERSERK);
      g.stats.refresh(P);
      const added = P.speed - before;
      assert.ok(Math.abs(added - want) < 1e-9, `${n} Grace${stacked ? ', everything stacked' : ''}: Berserk adds ${added.toFixed(3)} px/s (${before.toFixed(1)} → ${P.speed.toFixed(1)})`);
    }
  }
});

test('everything stacked is the plain sum of its shares, under the safety clamp, and the breakdown multiplies out', () => {
  const g = arena();
  const P = g.player;
  const pr = g.progression;
  pr.startFree();
  pr.spend('grace', FREE_MAX);
  const gear = stackTheRest(g);
  g.stats.addModifier(P, BERSERK);
  g.stats.refresh(P);
  assert.ok(gear.boots && gear.cloak, 'boots and a cloak that haste you exist');
  const sources = g.stats.breakdown(P, 'speed');
  const labels = sources.map((b) => b.source);
  for (const s of ['base', 'points', 'gear', 'swiftfoot', 'surge', 'price:berserk', 'price:laststand', 'price:oath']) assert.ok(labels.includes(s), `${s} is in the breakdown (${labels.join(', ')})`);
  assert.ok(!labels.includes('ceiling'), 'no ceiling holds anything back');
  // The plain sum, share by share of the normal pace.
  let pct = 0;
  for (const b of sources) pct += b.pct;
  const plain = PLAYER_BASE.speed * (1 + pct);
  assert.ok(Math.abs(P.speed - plain) < 1e-9, `${P.speed} = 76 × (1 + ${pct.toFixed(3)})`);
  assert.ok(P.speed > 215 && P.speed < 235, `everything at once walks at ${P.speed.toFixed(1)} px/s`);
  assert.ok(P.speed < STATS.speed.max, `under the safety clamp ${STATS.speed.max}`);
  const mul = sources.reduce((m, b) => m * b.mul, 1);
  const add = sources.reduce((m, b) => m + b.add, 0);
  assert.ok(Math.abs(add * (1 + pct) * mul - P.speed) < 1e-9, 'the breakdown multiplies out to the number shown');
  // A slow still slows in full.
  g.stats.addModifier(P, { id: 'weak', mul: { speed: 0.9 }, kind: 'weak' });
  assert.ok(Math.abs(P.speed - plain * 0.9) < 1e-9);
  // Heavy armour takes its whole 6% of the pace too.
  const g2 = arena();
  g2.player.inventory.add('ironhand_plate', 1);
  g2.gear.equip('ironhand_plate');
  assert.ok(Math.abs(g2.player.speed - PLAYER_BASE.speed * 0.94) < 1e-9);
});

test('Grace points alone stay under Lyra\'s run and the roll; 180→200 adds less than 50→70', () => {
  const g = arena();
  const P = g.player;
  const pr = g.progression;
  pr.startFree();
  const speeds = {};
  for (const n of [0, 20, 50, 70, 180, 200, FREE_MAX]) {
    pr.points.grace = n;
    pr.changed();
    speeds[n] = P.speed;
  }
  assert.equal(speeds[0], PLAYER_BASE.speed);
  assert.ok(speeds[FREE_MAX] <= 130, `999 Grace: ${speeds[FREE_MAX]} px/s`);
  assert.ok(speeds[FREE_MAX] < ROLL.speed, 'slower than the roll');
  assert.ok(speeds[FREE_MAX] <= 80 * 1.6 + 2, 'about Lyra\'s top run (80 px/s × 1.6), so she keeps up');
  assert.ok(speeds[70] - speeds[50] > 3 * (speeds[200] - speeds[180]), `50→70 adds ${(speeds[70] - speeds[50]).toFixed(1)} px/s, 180→200 adds ${(speeds[200] - speeds[180]).toFixed(2)}`);
  assert.ok(speeds[200] > speeds[180], 'and 180→200 still adds something');
});

test('ordinary hastes add their full shares', () => {
  const g = arena();
  const P = g.player;
  P.level = 12;
  g.progression.points.grace = 15;
  g.progression.changed();
  P.inventory.add('roadrunner_boots', 1);
  g.gear.equip('roadrunner_boots');
  g.stats.addModifier(P, { id: 'swiftfoot', ...BUFF_ITEMS.swiftfoot_draught.buff, t: 120 });
  const pts = pointsEffect('grace', 15).pct.speed;
  const want = PLAYER_BASE.speed * (1 + pts + 0.08 + 0.12);
  assert.ok(Math.abs(P.speed - want) < 1e-9, `${P.speed} = ${want}`);
});

test('the bare pipeline adds percentages plainly for anyone', () => {
  const game = { bus: { emit() {}, on() {} }, clock: { t: 0 }, player: null };
  const S = new Stats(game);
  const a = { id: 'x', maxHp: 50, atk: 5, def: 0, speed: 100 };
  S.manage(a, { maxHp: 50, atk: 5, def: 0, speed: 100 });
  S.addModifier(a, { id: 'fast', pct: { speed: 1, atk: 1 } });
  assert.equal(S.get(a, 'atk'), 10);
  assert.equal(a.speed, 200);
  S.addModifier(a, { id: 'faster', pct: { speed: 0.4 } });
  assert.equal(a.speed, 240);
  S.addModifier(a, { id: 'absurd', pct: { speed: 5 } });
  assert.equal(a.speed, STATS.speed.max, 'only the safety clamp stops an absurd stack');
});

// ---------------------------------------------------------------- five and ten points, felt

// The stranger at `level` with `points` (and the gear a stranger has found by then), on
// the pipeline as the game runs it.
function stranger(level, points = {}, gear = []) {
  const g = arena();
  const P = g.player;
  P.level = level;
  for (const [id, n] of Object.entries(points)) g.progression.points[id] = n;
  g.progression.changed();
  for (const id of gear) {
    P.inventory.add(id, 1);
    g.gear.equip(id);
  }
  g.stats.refresh(P);
  g.magic._recomputeMax(9999, true);
  return g;
}
const GEAR_AT = { 1: [], 5: ['iron_sword', 'leather_jerkin'], 12: ['steel_sword', 'leather_jerkin'] };

// Plain hits (no crit, no variance) to bring down one of each common foe: the sword's
// combo in turn, or a Spark each time.
const FOES = ['slime', 'wolf', 'bandit', 'skeleton'];
function hitsToKill(g, hits, opts = {}) {
  g.combat.random = () => 0.5;
  return FOES.map((species) => {
    const s = SPECIES[species];
    const foe = g.entities.add(new Actor(g, { id: `t_${species}`, name: species, faction: s.faction, kind: 'monster', maxHp: s.hp, def: s.def, x: g.player.x + 12, y: g.player.y }));
    let n = 0;
    while (foe.hp > 0 && n < 99) {
      foe.invuln = 0;
      g.combat.damage(g.player, foe, hits[n % hits.length], { exact: true, crit: false, noStagger: true, quiet: true, silent: true, knockback: 0, ...opts });
      n++;
    }
    foe.removed = true;
    g.entities.remove?.(foe);
    return n;
  });
}
const sum = (l) => l.reduce((a, b) => a + b, 0);

test('five points in Might are a small, felt benefit and ten a real one (sword, hits to kill a slime, a wolf, a bandit, a skeleton)', () => {
  for (const level of [1, 5, 12]) {
    const read = (n) => {
      const g = stranger(level, { might: n }, GEAR_AT[level]);
      const atk = g.stats.get(g.player, 'atk');
      return { atk, hits: hitsToKill(g, COMBO.map((c) => atk * c.mul)) };
    };
    const [z, five, ten] = [read(0), read(5), read(10)];
    // From play (scripts/stats_sim.mjs): 5 points at least a quarter more sword and one foe a
    // hit sooner; 10 at least half as much again and two hits fewer across the four.
    assert.ok(five.atk >= 1.25 * z.atk, `L${level} 5 Might: sword ${z.atk} → ${five.atk}`);
    assert.ok(ten.atk >= 1.5 * z.atk, `L${level} 10 Might: sword ${z.atk} → ${ten.atk}`);
    assert.ok(sum(five.hits) <= sum(z.hits) - 1, `L${level} 5 Might: ${z.hits.join('/')} → ${five.hits.join('/')}`);
    assert.ok(sum(ten.hits) <= sum(z.hits) - 2, `L${level} 10 Might: ${z.hits.join('/')} → ${ten.hits.join('/')}`);
  }
});

test('five points in Weave are a small, felt benefit and ten a real one (Spark, hits to kill the same four)', () => {
  for (const level of [1, 5, 12]) {
    const read = (n) => {
      const g = stranger(level, { weave: n }, GEAR_AT[level]);
      const spark = g.magic.compile({ shape: 'bolt', essences: ['raw'] });
      const dmg = (spark.plan || spark).dmg * g.magic.powerOf(g.player);
      return { dmg, hits: hitsToKill(g, [dmg], { kind: 'magic', damageType: 'raw' }) };
    };
    const [z, five, ten] = [read(0), read(5), read(10)];
    assert.ok(five.dmg >= 1.25 * z.dmg, `L${level} 5 Weave: Spark ${z.dmg.toFixed(1)} → ${five.dmg.toFixed(1)}`);
    assert.ok(ten.dmg >= 1.5 * z.dmg, `L${level} 10 Weave: Spark ${z.dmg.toFixed(1)} → ${ten.dmg.toFixed(1)}`);
    assert.ok(sum(five.hits) <= sum(z.hits) - 1, `L${level} 5 Weave: ${z.hits.join('/')} → ${five.hits.join('/')}`);
    assert.ok(sum(ten.hits) <= sum(z.hits) - 2, `L${level} 10 Weave: ${z.hits.join('/')} → ${ten.hits.join('/')}`);
  }
});

// Plain blows of `atk` from a boss (or a common foe, grown bolder with your level) until you drop.
function blowsToDrop(g, atk, { boss = true, faction = 'bandit' } = {}) {
  const P = g.player;
  g.combat.random = () => 0.5;
  const src = g.entities.add(new Actor(g, { id: `hitter_${faction}`, name: 'hitter', faction, kind: 'monster', maxHp: 999, atk, x: P.x + 10, y: P.y }));
  if (boss) src.boss = true;
  P.hp = P.maxHp;
  let k = 0;
  while (P.hp > 0 && k < 999 && !P.downed && !P.dead) {
    P.invuln = 0;
    g.combat.damage(src, P, atk, { exact: true, crit: false, noStagger: true, quiet: true, silent: true, knockback: 0 });
    k++;
  }
  src.removed = true;
  P.hp = P.maxHp;
  P.downed = false;
  P.dead = false;
  return k;
}

test('five points in Vitality are a small, felt benefit and ten a real one (health, and Varek\'s blows it takes to drop you)', () => {
  for (const level of [1, 5, 12]) {
    const read = (n) => {
      const g = stranger(level, { vitality: n }, GEAR_AT[level]);
      return { hp: g.player.maxHp, blows: blowsToDrop(g, BOSSES.varek.atk) };
    };
    const [z, five, ten] = [read(0), read(5), read(10)];
    assert.ok(five.hp >= 1.3 * z.hp && five.blows >= z.blows + 3, `L${level} 5 Vitality: ${z.hp} → ${five.hp} health, Varek ${z.blows} → ${five.blows} blows`);
    assert.ok(ten.hp >= 1.6 * z.hp && ten.blows >= z.blows + 6, `L${level} 10 Vitality: ${z.hp} → ${ten.hp} health, Varek ${z.blows} → ${ten.blows} blows`);
  }
});

test('five points in Focus are felt and ten more so (Sparks from a full pool)', () => {
  for (const level of [1, 5, 12]) {
    const read = (n) => {
      const g = stranger(level, { focus: n }, GEAR_AT[level]);
      const cost = g.magic.costOf(g.player, g.magic.compile({ shape: 'bolt', essences: ['raw'] }));
      return Math.floor(g.magic.mana.max / cost + 1e-9);
    };
    const [z, five, ten] = [read(0), read(5), read(10)];
    assert.ok(five >= z + 6 && ten >= z + 13, `L${level} Focus 0/5/10: ${z}/${five}/${ten} Sparks`);
  }
});

test('death stays dangerous at ordinary levels: a third of the points in Vitality still drops to a boss\'s plain blows in under 35 (the old line: 26 at level 15) and to bolder wolves in under 45', () => {
  for (const level of [5, 10, 15]) {
    const vit = Math.floor((3 * (level - 1)) / 3);
    const g = stranger(level, { vitality: vit }, level >= 15 ? ['steel_sword', 'iron_mail', 'traveler_cloak'] : GEAR_AT[level >= 12 ? 12 : 5]);
    const boss = blowsToDrop(g, BOSSES.varek.atk);
    const wolf = blowsToDrop(g, SPECIES.wolf.atk, { boss: false, faction: 'monster' });
    assert.ok(boss < 35, `L${level} ${vit} Vitality (${g.player.maxHp} health): Varek drops you in ${boss}`);
    assert.ok(wolf < 45, `L${level}: a wolf (bolder with your level) in ${wolf}`);
  }
});

// ---------------------------------------------------------------- the bosses

test('a level-15 stranger with 30 points in Might or Weave beats each boss in a short fight, and faster than with none', () => {
  // scripts/stats_sim.mjs: a bot that walks in, swings or casts Spark, and steps or rolls out
  // of every telegraphed marker, against the bosses' own brains in the real world (median
  // of three combat streams). The rest of the points go to Vitality (sword) or Focus (weave).
  for (const build of ['sword', 'weave']) {
    let none = 0;
    let thirty = 0;
    for (const id of ['varek', 'greyjaw', 'lakes_hum', 'bone_warden']) {
      const f30 = fights(id, { build, level: 15, main: 30, limit: 120 }, 3);
      assert.equal(f30.won, 3, `${build} 30 vs ${id}: won every time`);
      assert.ok(f30.median <= 45, `${build} 30 vs ${id}: ${f30.median} s`);
      const f0 = fights(id, { build, level: 15, main: 0, limit: 120 }, 3);
      thirty += f30.median;
      none += Number.isFinite(f0.median) ? f0.median : 120;
    }
    assert.ok(thirty <= 0.75 * none, `${build}: the four bosses take ${thirty.toFixed(0)} s with 30 points, ${none.toFixed(0)} s with none`);
  }
});

test('far out, a stranger can stand with a boss: 50 Vitality outlasts Varek\'s own health; 100 Might or Weave beat him in a handful of blows', () => {
  const V = BOSSES.varek;
  assert.ok(stranger(15, { vitality: 50 }).player.maxHp > V.hp);
  const gm = stranger(15, { might: 100 }, ['steel_sword']);
  const cut = gm.stats.get(gm.player, 'atk') * (COMBO.reduce((t, c) => t + c.mul, 0) / COMBO.length) - V.def;
  assert.ok(V.hp / cut <= 5, `100 Might: ${Math.ceil(V.hp / cut)} cuts`);
  const gw = stranger(15, { weave: 100 });
  const sp = gw.magic.compile({ shape: 'bolt', essences: ['raw'] });
  assert.ok(V.hp / ((sp.plan || sp).dmg * gw.magic.powerOf(gw.player) - V.def) <= 8);
  // Mana and weave power have no wall a build meets.
  assert.equal(MANA_CAP, STATS.maxMana.max);
  const gf = stranger(15, { focus: 200 });
  assert.ok(gf.magic.mana.max > 1000, `200 Focus: ${gf.magic.mana.max} mana`);
  assert.ok(stranger(15, { weave: 300 }).stats.get(stranger(15, { weave: 300 }).player, 'spellPower') > 15);
});

// ---------------------------------------------------------------- saves and respecs

test('an old save keeps its points by id and they follow the curves; Free on and off gives back the real points exactly', () => {
  const g = arena();
  const P = g.player;
  P.level = 21; // 60 points earned
  // A save from before: only the counts were ever stored.
  loadProgression(g, { progression: { points: { vitality: 20, grace: 30, might: 10 }, bonus: 0, respecs: 1 } });
  const pr = g.progression;
  assert.deepEqual({ ...pr.points }, { vitality: 20, might: 10, weave: 0, focus: 0, grace: 30, resolve: 0 });
  const c = pr.pointsContribution(P);
  assert.equal(c.add.maxHp, pointsEffect('vitality', 20).add.maxHp);
  assert.equal(c.pct.speed, pointsEffect('grace', 30).pct.speed);
  assert.equal(c.add.atk, pointsEffect('might', 10).add.atk);
  assert.ok(c.add.maxHp > 20 * OLD.maxHp, 'more than the old straight line');
  assert.equal(pr.unspent(), 0);
  const real = { ...pr.points };
  const before = g.stats.all(P);
  assert.ok(pr.startFree());
  pr.spend('grace', 500);
  pr.spend('weave', 10);
  const saved = JSON.parse(JSON.stringify(saveProgression(g)));
  const g2 = arena();
  g2.player.level = 21;
  loadProgression(g2, saved);
  assert.ok(g2.progression.free);
  assert.equal(g2.progression.points.grace, 530);
  assert.ok(g2.progression.endFree());
  assert.deepEqual({ ...g2.progression.points }, real, 'the real points come back exactly');
  assert.deepEqual(g2.stats.all(g2.player), before, 'and the same numbers with them');
  assert.ok(g2.progression.resetPoints().ok);
  assert.equal(g2.progression.unspent(), 60);
  assert.equal(g2.progression.pointsContribution(g2.player), null);
  loadProgression(g2, { progression: { points: real } });
  g2.player.inventory.add('coin', 999);
  const r = g2.progression.respec();
  assert.ok(r.ok && r.cost > 0);
  assert.equal(g2.progression.spent(), 0);
});

// ---------------------------------------------------------------- the sheet's "Next:" line

test('what the next point adds: the main effect first; a speed\'s step shrinks fast, a gentle one keeps a good share', () => {
  for (const id of ATTR_IDS) {
    const a = ATTRS[id];
    const n0 = nextPoint(id, 0);
    assert.equal(n0[0].stat, a.main, `${id}: main effect first`);
    assert.equal(n0.length, Object.keys(a.per.add || {}).length + Object.keys(a.per.pct || {}).length);
    let last = Infinity;
    for (const n of [0, 10, 20, 50, 70, 180, 200, 998]) {
      const d = Math.abs(nextPoint(id, n)[0].d);
      assert.ok(d > 0 && d < last, `${id}: the next point at ${n} adds less than at the step before`);
      last = d;
      const want = Math.abs(at(id, n0[0].part, a.main, n + 1) - at(id, n0[0].part, a.main, n));
      assert.ok(Math.abs(d - want) < 1e-12);
    }
    assert.ok(Math.abs(n0[0].d - n0[0].first) <= 0.05 * Math.abs(n0[0].first));
    const share = Math.abs(nextPoint(id, 998)[0].d / n0[0].first);
    if (kindOf(a.main) === 'gentle') assert.ok(share > 0.3, `${id}: the 999th point still carries ${Math.round(share * 100)}%`);
  }
});

// What one more point really does to the numbers the sheet shows (the gear compare's way:
// the pipeline itself, one point more).
function realStep(g, id) {
  const P = g.player;
  const pr = g.progression;
  const before = g.stats.all(P);
  pr.points[id] = (pr.points[id] || 0) + 1;
  g.stats.touch();
  const after = g.stats.all(P);
  pr.points[id] -= 1;
  g.stats.touch();
  return { before, after };
}

const pctIn = (text) => Number((String(text).match(/([0-9.]+)%/) || [])[1]);

// The pace a speed's percentages are shares of: the plain walk (base and flat adds) times
// any slow, before a single percentage (the pipeline's (base + Σadd) × Πmul).
function normalPace(g) {
  const parts = g.stats.breakdown(g.player, 'speed');
  return parts.reduce((t, b) => t + b.add, 0) * parts.reduce((m, b) => m * b.mul, 1);
}

test('the sheet\'s "Next:" line counts speed as every speed percentage is counted: a share of the normal pace, hasted, slowed or not', async () => {
  // "40% should always give 40%, no matter what": Berserk's +40% is 40% of the normal pace
  // whatever else runs, so a Grace point's share must read the same with Berserk on as off.
  const { gainWords } = await import('../src/ui/character_view.js');
  const g = arena();
  const P = g.player;
  const pr = g.progression;
  pr.startFree();
  const said = {};
  const check = (label) => {
    const { before, after } = realStep(g, 'grace');
    const m = pr.nextGain('grace')[0];
    assert.equal(m.stat, 'speed');
    const truth = ((after.speed - before.speed) / normalPace(g)) * 100;
    assert.ok(Math.abs(truth - m.d * 100) < 1e-9, `${label}: one more point adds ${truth.toFixed(4)}% of the normal pace, the curve's whole step`);
    assert.ok(Math.abs(pctIn(gainWords(m)) - truth) <= 0.051, `${label}: "${gainWords(m)}" vs ${truth.toFixed(3)}% of the normal pace`);
    said[label] = gainWords(m);
  };
  for (const n of [0, 49]) {
    pr.points.grace = n;
    pr.changed();
    check(`${n} Grace`);
    // Berserk, the Last Stand and Oath running: the next point still adds its whole share.
    g.stats.addModifier(P, BERSERK);
    g.stats.addModifier(P, { id: 'price:laststand:gain', source: 'price:laststand', ...LAST_STAND_GAIN, t: 60 });
    g.prices.state.oath = { t: 60 };
    g.companion.x = P.x + 10;
    g.companion.y = P.y;
    g.stats.refresh(P);
    check(`${n} Grace, hasted`);
    // A slow on top (hunger's ×0.9): the normal pace is slower, the share the same.
    g.stats.addModifier(P, { id: 'weak', mul: { speed: 0.9 }, kind: 'weak' });
    check(`${n} Grace, hasted and slowed`);
    g.stats.removeModifier(P, 'weak');
    g.stats.removeModifier(P, 'price:berserk:gain');
    g.stats.removeModifier(P, 'price:laststand:gain');
    g.prices.state.oath = null;
    g.stats.refresh(P);
  }
  assert.equal(said['0 Grace'], '+1.5% speed');
  assert.equal(said['0 Grace, hasted'], said['0 Grace'], 'Berserk running takes nothing off a point');
  assert.equal(said['49 Grace, hasted and slowed'], said['49 Grace']);
});

test('the speed tooltip says what its percentages are shares of; Oath\'s words are true of speed; a number held at its clamp says so', async () => {
  const { statTip } = await import('../src/ui/character_view.js');
  const g = arena();
  const P = g.player;
  const S = g.stats;
  g.progression.startFree();
  g.progression.points.grace = 30;
  g.progression.changed();
  S.addModifier(P, BERSERK);
  g.prices.state.oath = { t: 60 };
  g.companion.x = P.x + 10;
  g.companion.y = P.y;
  S.refresh(P);
  const tip = statTip(S, P, 'speed');
  assert.match(tip, /Berserk[^\n]*: \+40%/);
  assert.match(tip, /normal pace/i, `the tooltip names the pace the shares are of:\n${tip}`);
  assert.match(tip, /\b76\b/, 'and says it (76 px/s)');
  // Oath adds 10% of the pace, 30% of strength, weaves, armor and crit: its words say so.
  const oath = S.breakdown(P, 'speed').find((b) => b.source === 'price:oath');
  assert.ok(oath && Math.abs(oath.pct - 0.1) < 1e-12);
  assert.doesNotMatch(oath.label, /everything/, `"${oath.label}" promises +30% to a speed it adds 10% to`);
  assert.match(oath.label, /10% speed/);
  assert.match(PRICES.oath.gainText, /10% speed/);
  // Dodge from 60 Grace, boots, a cloak, Swiftfoot and wind is past its 40% clamp: say so.
  g.progression.points.grace = 60;
  g.progression.changed();
  stackTheRest(g);
  assert.equal(S.get(P, 'dodge'), STATS.dodge.max);
  assert.match(statTip(S, P, 'dodge'), /limit/i);
  assert.doesNotMatch(statTip(S, P, 'speed'), /limit/i, 'speed is nowhere near its safety clamp');
});

test('a saved wound loads as it was: a maximum worked out halfway through loading (gear before the points) does not cut it', () => {
  const g = stranger(15, { vitality: 12, might: 20, focus: 10 }, ['steel_sword', 'iron_mail']);
  const P = g.player;
  P.hp = P.maxHp - 60;
  const hp = P.hp;
  const saved = JSON.parse(JSON.stringify(saveProgression(g)));
  const g2 = arena();
  const P2 = g2.player;
  // player.deserialize has run: level, health and its maximum as saved.
  P2.level = 15;
  P2.maxHp = P.maxHp;
  P2.hp = hp;
  loadProgression(g2, saved);
  assert.equal(P2.maxHp, P.maxHp);
  assert.equal(P2.hp, hp, `the wound as saved (${hp} of ${P.maxHp}), not cut to the level's bare health`);
  // A wound deeper than a smaller new maximum still fits under it.
  const g3 = arena();
  g3.player.level = 15;
  g3.player.hp = 9999;
  loadProgression(g3, saved);
  assert.equal(g3.player.hp, g3.player.maxHp);
});

test('every effect\'s words agree with the pipeline at 0, 7, 30 and 200 points, and a stat at its clamp says so', async () => {
  const { gainWords } = await import('../src/ui/character_view.js');
  const g = arena();
  const P = g.player;
  const pr = g.progression;
  P.level = 12;
  pr.startFree();
  for (const n of [0, 7, 30, 200]) {
    for (const id of ATTR_IDS) {
      for (const k of ATTR_IDS) pr.points[k] = 0;
      pr.points[id] = n;
      pr.changed();
      const { before, after } = realStep(g, id);
      for (const m of pr.nextGain(id)) {
        const s = STATS[m.stat];
        const words = gainWords(m);
        if (m.limit) {
          assert.match(words, /limit/);
          continue;
        }
        const num = Number((words.match(/([0-9.]+)/) || [])[1]);
        let want;
        if (m.stat === 'speed') want = ((after.speed - before.speed) / normalPace(g)) * 100;
        else if (s.fmt === 'pct' || s.fmt === 'mul') want = (after[m.stat] - before[m.stat]) * 100;
        // health, mana and the sword show whole (or tenth) numbers: one point is the curve's step
        else if (['maxHp', 'maxMana', 'atk'].includes(m.stat)) want = m.d;
        else want = after[m.stat] - before[m.stat];
        const tol = Math.max(0.051, Math.abs(want) * 0.051);
        if (words.includes('<0.01')) assert.ok(Math.abs(want) < 0.0095, `${id} ${n}: ${words} vs ${want}`);
        else assert.ok(Math.abs(num - Math.abs(want)) <= tol, `${id} at ${n}: "${words}" vs ${want}`);
      }
    }
  }
  // Resolve late in a life: the bleed-out window sits at its 300 s clamp (death stays
  // dangerous: five minutes to be found, never more), so one more point adds none and says so.
  for (const k of ATTR_IDS) pr.points[k] = 0;
  pr.points.resolve = 80;
  pr.changed();
  assert.equal(g.stats.all(P).bleedout, STATS.bleedout.max);
  const bleed = pr.nextGain('resolve').find((x) => x.stat === 'bleedout');
  assert.ok(bleed.limit, 'bleed-out is at its limit');
  assert.match(gainWords(bleed), /limit/);
  // Free stat points at 999: nothing more to add.
  pr.points.grace = 999;
  pr.changed();
  assert.equal(pr.canSpend('grace'), false);
});

test('the old straight line, for the record: scaled() still multiplies (levels grow by it)', () => {
  assert.deepEqual(scaled({ add: { maxHp: 5 } }, 3), { add: { maxHp: 15 } });
  assert.equal(scaled({ add: { maxHp: 5 } }, 0), null);
});
