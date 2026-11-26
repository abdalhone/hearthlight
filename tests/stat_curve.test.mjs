import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Stats, STATS, soften } from '../src/core/stats.js';
import { ATTRS, ATTR_IDS, CURVE_POWER, curve, pointsEffect, nextPoint, scaled, POINTS_PER_LEVEL } from '../src/progression/attributes.js';
import { installProgression, saveProgression, loadProgression } from '../src/progression/index.js';
import { FREE_MAX } from '../src/progression/progression.js';
import { GEAR, BUFF_ITEMS } from '../src/gear/gear_data.js';
import { PRICES, LAST_STAND_GAIN, SURGE_BUFFS, surgeModifier } from '../src/magic/prices.js';
import { ROLL, PLAYER_BASE } from '../src/entities/player.js';
import { makeGame } from './magic_helpers.mjs';

// Round 14b (the author: "when I put a lot of points of speed, I can like literally be so
// fast that it's unplayable … the difference between 180 and 200 is not as big of a
// difference as 50 and 70"). DESIGN §26: diminishing returns on every attribute effect,
// and a speed ceiling for everything that hastes you stacked together.

// Every effect of every attribute: [attr, part, stat, per, cap].
function effects() {
  const out = [];
  for (const id of ATTR_IDS) {
    const a = ATTRS[id];
    for (const part of ['add', 'pct']) for (const [stat, per] of Object.entries(a.per[part] || {})) out.push([id, part, stat, per, a.cap?.[part]?.[stat]]);
  }
  return out;
}

const at = (id, part, stat, n) => pointsEffect(id, n)?.[part]?.[stat] ?? 0;

test('every effect has a soft cap of its own sign, and every attribute names its main effect', () => {
  assert.equal(CURVE_POWER, 2);
  for (const [id, part, stat, per, cap] of effects()) {
    assert.ok(Number.isFinite(cap) && cap !== 0, `${id}.${part}.${stat} has a cap`);
    assert.equal(Math.sign(cap), Math.sign(per), `${id}.${stat}: the cap points the same way as the point`);
    assert.ok(Math.abs(cap / per) >= 15 && Math.abs(cap / per) <= 160, `${id}.${stat}: the knee (${Math.round(cap / per)} points) sits where ordinary play stays whole and the far end still bends`);
  }
  for (const id of ATTR_IDS) {
    const a = ATTRS[id];
    assert.ok(a.per.add?.[a.main] != null || a.per.pct?.[a.main] != null, `${id}: main effect ${a.main} is one of its own`);
    for (const part of ['add', 'pct']) for (const k of Object.keys(a.cap?.[part] || {})) assert.ok(a.per[part]?.[k] != null, `${id}: a cap for ${k} that the attribute does not give`);
  }
});

test('the curve is monotone and concave; the first point is what it was; 50→70 beats 180→200 by more than three times; 999 stays under the cap', () => {
  for (const [id, part, stat, per, cap] of effects()) {
    const name = `${id}.${stat}`;
    let prev = 0;
    let prevGain = Infinity;
    for (let n = 1; n <= FREE_MAX; n++) {
      const v = at(id, part, stat, n);
      const gain = Math.abs(v - prev);
      assert.ok(gain > 0, `${name}: point ${n} still adds something`);
      assert.ok(Math.sign(v) === Math.sign(per), `${name}: never turns round`);
      assert.ok(gain <= prevGain + 1e-12, `${name}: point ${n} adds no more than point ${n - 1}`);
      prev = v;
      prevGain = gain;
    }
    const first = at(id, part, stat, 1);
    assert.ok(Math.abs(first - per) <= 0.05 * Math.abs(per), `${name}: the first point (${first}) is within 5% of the old ${per}`);
    const g1 = Math.abs(at(id, part, stat, 70) - at(id, part, stat, 50));
    const g2 = Math.abs(at(id, part, stat, 200) - at(id, part, stat, 180));
    assert.ok(g1 > 3 * g2, `${name}: 50→70 adds ${g1.toFixed(4)}, 180→200 adds ${g2.toFixed(5)}`);
    assert.ok(g2 > 0, `${name}: 180→200 still adds something`);
    const top = Math.abs(at(id, part, stat, FREE_MAX));
    assert.ok(top < Math.abs(cap), `${name}: ${top} at ${FREE_MAX} points is under the cap ${cap}`);
    assert.ok(top > 0.95 * Math.abs(cap), `${name}: and close to it`);
    // The plain function agrees with the attribute's numbers.
    assert.equal(curve(per, cap, 37), at(id, part, stat, 37));
  }
  assert.equal(pointsEffect('grace', 0), null);
  assert.equal(pointsEffect('nope', 5), null);
  assert.equal(curve(0.5, 1, -3), 0);
});

test('what the next point adds: the main effect first, shrinking as the points grow', () => {
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
  }
});

// ---------------------------------------------------------------- the speed ceiling

test('the speed knee: below it nothing changes, past it each bit counts less, and it never reaches the max', () => {
  const S = STATS.speed;
  assert.ok(S.knee < S.max);
  assert.equal(soften(100, S.knee, S.max), 100);
  assert.equal(soften(S.knee, S.knee, S.max), S.knee);
  let prev = S.knee;
  let prevGain = Infinity;
  for (let v = S.knee + 1; v <= 2000; v += 1) {
    const s = soften(v, S.knee, S.max);
    assert.ok(s > prev && s < S.max, `${v} → ${s}`);
    assert.ok(s - prev <= prevGain + 1e-12);
    prevGain = s - prev;
    prev = s;
  }
  // The slope at the knee is one: no kink where it starts.
  assert.ok(Math.abs(soften(S.knee + 0.01, S.knee, S.max) - S.knee - 0.01) < 1e-5);
});

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

// Everything that hastes the stranger at once: gear, Swiftfoot, the best surge, Berserk,
// the Last Stand and Oath with the companion beside you.
function stackEverything(g) {
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
  S.addModifier(P, { id: 'price:berserk:gain', source: 'price:berserk', ...PRICES.berserk.gain, t: 120 });
  S.addModifier(P, { id: 'price:laststand:gain', source: 'price:laststand', ...LAST_STAND_GAIN, t: 60 });
  g.prices.state.oath = { t: 60 };
  g.companion.x = P.x + 10;
  g.companion.y = P.y;
  S.refresh(P);
  return { gear, sources: S.breakdown(P, 'speed') };
}

test('Grace points alone stay under the knee, under Lyra\'s run and under the roll', () => {
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
  assert.ok(speeds[FREE_MAX] <= STATS.speed.knee, `999 Grace: ${speeds[FREE_MAX]} px/s is under the knee (points alone are never squeezed)`);
  assert.ok(speeds[FREE_MAX] < ROLL.speed, 'slower than the roll');
  assert.ok(speeds[FREE_MAX] <= 80 * 1.6 + 2, 'about Lyra\'s top run (80 px/s × 1.6), so she keeps up');
  assert.ok(speeds[70] - speeds[50] > 3 * (speeds[200] - speeds[180]), `50→70 adds ${(speeds[70] - speeds[50]).toFixed(1)} px/s, 180→200 adds ${(speeds[200] - speeds[180]).toFixed(2)}`);
  assert.ok(speeds[200] > speeds[180], 'and 180→200 still adds something');
});

test('everything stacked (999 Grace, fastest gear, Swiftfoot, wind, Berserk, Last Stand, Oath) stays at the playable ceiling', () => {
  const g = arena();
  const P = g.player;
  const pr = g.progression;
  pr.startFree();
  pr.spend('grace', FREE_MAX);
  const { gear, sources } = stackEverything(g);
  assert.ok(gear.boots && gear.cloak, 'boots and a cloak that haste you exist');
  const labels = sources.map((b) => b.source);
  for (const s of ['base', 'points', 'gear', 'swiftfoot', 'surge', 'price:berserk', 'price:laststand', 'price:oath', 'ceiling']) assert.ok(labels.includes(s), `${s} is in the breakdown (${labels.join(', ')})`);
  // By plain sums it would be far past the old 260 clamp's reach of sense.
  let add = 0;
  let pct = 0;
  for (const b of sources) if (b.source !== 'ceiling') {
    add += b.add;
    pct += b.pct;
  }
  const raw = add * (1 + pct);
  assert.ok(raw > 200, `plain sums: ${raw.toFixed(1)} px/s`);
  const top = P.speed;
  assert.ok(top <= STATS.speed.max, `${top.toFixed(1)} px/s ≤ the ceiling ${STATS.speed.max}`);
  assert.ok(top <= 160, `${top.toFixed(1)} px/s: about twice the walk, a pace that still steers through a door`);
  assert.ok(top > 150, 'and every haste still counts for something');
  // The breakdown multiplies out to the number shown.
  const mul = sources.reduce((m, b) => m * b.mul, 1);
  assert.ok(Math.abs(raw * mul - top) < 1e-6, `${raw} × ${mul} = ${top}`);
  // A slow still slows in full past the knee (survival's weakness acts after it).
  g.stats.addModifier(P, { id: 'weak', mul: { speed: 0.9 }, kind: 'weak' });
  assert.ok(Math.abs(P.speed - top * 0.9) < 1e-6);
});

test('ordinary hastes stay as they were (under the knee nothing is squeezed)', () => {
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
  assert.ok(want < STATS.speed.knee);
  assert.ok(Math.abs(P.speed - want) < 1e-9, `${P.speed} = ${want}`);
  assert.ok(!g.stats.breakdown(P, 'speed').some((b) => b.source === 'ceiling'));
});

// ---------------------------------------------------------------- saves and respecs

test('an old save keeps its points by id and they follow the curve; Free on and off gives back the real points exactly', () => {
  const g = arena();
  const P = g.player;
  P.level = 21; // 60 points earned
  // A save from before the curve: only the counts were ever stored.
  loadProgression(g, { progression: { points: { vitality: 20, grace: 30, might: 10 }, bonus: 0, respecs: 1 } });
  const pr = g.progression;
  assert.deepEqual({ ...pr.points }, { vitality: 20, might: 10, weave: 0, focus: 0, grace: 30, resolve: 0 });
  const c = pr.pointsContribution(P);
  assert.equal(c.add.maxHp, pointsEffect('vitality', 20).add.maxHp);
  assert.equal(c.pct.speed, pointsEffect('grace', 30).pct.speed);
  assert.equal(c.add.atk, pointsEffect('might', 10).add.atk);
  assert.ok(c.add.maxHp < 20 * ATTRS.vitality.per.add.maxHp, 'less than the old straight line');
  assert.equal(pr.unspent(), 0);
  const real = { ...pr.points };
  const before = g.stats.all(P);
  // Free stat points: raise anything, save, load, turn it off.
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
  // Reset stat points and the chapel still give everything back.
  assert.ok(g2.progression.resetPoints().ok);
  assert.equal(g2.progression.unspent(), 60);
  assert.equal(g2.progression.pointsContribution(g2.player), null);
  loadProgression(g2, { progression: { points: real } });
  g2.player.inventory.add('coin', 999);
  const r = g2.progression.respec();
  assert.ok(r.ok && r.cost > 0);
  assert.equal(g2.progression.spent(), 0);
});

// ---------------------------------------------------------------- ordinary play

// Today's numbers beside the curve's: the same game with the old straight 'points' source.
function oldAndNew(level, points) {
  const g = arena();
  const P = g.player;
  P.level = level;
  for (const [id, n] of Object.entries(points)) g.progression.points[id] = n;
  g.progression.changed();
  const now = g.stats.all(P);
  g.stats.addSource('points', 'Points', (a) => {
    if (a !== P) return null;
    const out = { add: {}, pct: {} };
    for (const id of ATTR_IDS) {
      const c = scaled(ATTRS[id].per, g.progression.points[id] || 0);
      for (const part of ['add', 'pct']) for (const [k, v] of Object.entries(c?.[part] || {})) out[part][k] = (out[part][k] || 0) + v;
    }
    return out;
  }, 20);
  const was = g.stats.all(P);
  return { now, was };
}

test('ordinary play: about 30 points spread evenly moves every derived stat by under 10%', () => {
  for (const [level, each] of [[11, 5], [15, 7]]) {
    const pts = Object.fromEntries(ATTR_IDS.map((id) => [id, each]));
    assert.ok(each * ATTR_IDS.length <= POINTS_PER_LEVEL * (level - 1));
    const { now, was } = oldAndNew(level, pts);
    for (const k of Object.keys(now)) {
      if (!was[k]) continue;
      const d = Math.abs(now[k] - was[k]) / Math.abs(was[k]);
      assert.ok(d <= 0.1, `level ${level}, ${each} in each: ${k} ${was[k]} → ${now[k]} (${(d * 100).toFixed(1)}%)`);
    }
  }
});

test('a build that leans on one attribute (30 points) keeps most of what it had', () => {
  for (const id of ATTR_IDS) {
    const { now, was } = oldAndNew(11, { [id]: 30 });
    const main = ATTRS[id].main;
    const d = Math.abs(now[main] - was[main]) / Math.abs(was[main]);
    // Resolve's resistance used to hit its 75% clamp at 25 points; on the curve it heads
    // for 50%, so a 30-point lean keeps a little under two thirds of the old (clamped) number.
    const most = id === 'resolve' ? 0.45 : 0.12;
    assert.ok(d <= most, `${id} 30: ${main} ${was[main]} → ${now[main]} (${(d * 100).toFixed(1)}%)`);
  }
});

test('the pipeline\'s clamps are never what stops the points alone (dodge, crit, resist, cooldowns)', () => {
  const g = arena();
  const P = g.player;
  g.progression.startFree();
  for (const id of ATTR_IDS) g.progression.spend(id, FREE_MAX);
  const v = g.stats.all(P);
  assert.ok(v.dodge < STATS.dodge.max, `dodge ${v.dodge}`);
  assert.ok(v.crit < STATS.crit.max, `crit ${v.crit}`);
  assert.ok(v.resist < STATS.resist.max, `resist ${v.resist}`);
  assert.ok(v.cooldown > STATS.cooldown.min, `cooldown ${v.cooldown}`);
  assert.ok(v.speed <= STATS.speed.knee, `speed ${v.speed}`);
  assert.ok(v.carrySpeed * 0.6 < 1, 'carrying stays slower than walking unladen');
  assert.ok(v.bleedout < STATS.bleedout.max, `bleed-out ${v.bleedout}`);
  assert.ok(v.maxHp < 1000 && v.atk < 100, `health ${v.maxHp}, sword ${v.atk}: death stays dangerous`);
});

test('the bare pipeline knees speed for anyone, and leaves every other stat as it was', () => {
  const game = { bus: { emit() {}, on() {} }, clock: { t: 0 }, player: null };
  const S = new Stats(game);
  const a = { id: 'x', maxHp: 50, atk: 5, def: 0, speed: 100 };
  S.manage(a, { maxHp: 50, atk: 5, def: 0, speed: 100 });
  S.addModifier(a, { id: 'fast', pct: { speed: 1, atk: 1 } });
  assert.equal(S.get(a, 'atk'), 10);
  assert.equal(a.speed, soften(200, STATS.speed.knee, STATS.speed.max));
  assert.ok(a.speed < 170 && a.speed > 150);
});

// ---------------------------------------------------------------- the sheet's "Next:" line

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

test('the sheet\'s "Next:" line says what one more point really does: speed as a share of the walk you have now, past the knee too', async () => {
  const { gainWords } = await import('../src/ui/character_view.js');
  const g = arena();
  const P = g.player;
  const pr = g.progression;
  pr.startFree();
  // 49 Grace: the walk is 114.5 px/s and one more point adds 0.37 px/s, a third of a percent
  // of it (the curve's own step, 0.48% of the bare 76, read as "+0.5% speed" before).
  pr.points.grace = 49;
  pr.changed();
  let { before, after } = realStep(g, 'grace');
  let m = pr.nextGain('grace')[0];
  let truth = ((after.speed - before.speed) / before.speed) * 100;
  assert.equal(m.stat, 'speed');
  assert.ok(Math.abs(pctIn(gainWords(m)) - truth) <= 0.051, `49 Grace: "${gainWords(m)}", one more point really adds ${truth.toFixed(3)}% to ${before.speed.toFixed(1)} px/s`);
  // Berserk, the Last Stand and Oath running (past the knee): the next point counts for less.
  pr.points.grace = 0;
  pr.changed();
  g.stats.addModifier(P, { id: 'price:berserk:gain', source: 'price:berserk', ...PRICES.berserk.gain, t: 120 });
  g.stats.addModifier(P, { id: 'price:laststand:gain', source: 'price:laststand', ...LAST_STAND_GAIN, t: 60 });
  g.prices.state.oath = { t: 60 };
  g.companion.x = P.x + 10;
  g.companion.y = P.y;
  g.stats.refresh(P);
  assert.ok(P.speed > STATS.speed.knee, `hasted past the knee (${P.speed.toFixed(1)})`);
  ({ before, after } = realStep(g, 'grace'));
  m = pr.nextGain('grace')[0];
  truth = ((after.speed - before.speed) / before.speed) * 100;
  assert.ok(truth < 1, `past the knee one point adds ${truth.toFixed(2)}%`);
  assert.ok(Math.abs(pctIn(gainWords(m)) - truth) <= 0.051, `hasted: "${gainWords(m)}" vs ${truth.toFixed(3)}%`);
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
        const num = Number((words.match(/([0-9.]+)/) || [])[1]);
        let want;
        if (m.stat === 'speed') want = ((after.speed - before.speed) / before.speed) * 100;
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
  // Focus late in a life: mana sits at its 400 clamp, so one more point adds no mana and says so.
  for (const k of ATTR_IDS) pr.points[k] = 0;
  P.level = 80;
  pr.points.focus = 300;
  pr.changed();
  assert.equal(g.stats.all(P).maxMana, STATS.maxMana.max);
  const mana = pr.nextGain('focus').find((x) => x.stat === 'maxMana');
  assert.ok(mana.limit, 'mana is at its limit');
  assert.match(gainWords(mana), /limit/);
  // Free stat points at 999: nothing more to add, the line says the attribute is as high as it goes.
  pr.points.grace = 999;
  pr.changed();
  assert.equal(pr.canSpend('grace'), false);
});
