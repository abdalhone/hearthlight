import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, step as magicStep, resetArena, assertSane, AIM } from './magic_helpers.mjs';
import { installProgression, saveProgression, loadProgression } from '../src/progression/index.js';
import { PRICES, Prices, SURGE_BUFFS, surgeModifier, priceLines } from '../src/magic/prices.js';
import { Shapes } from '../src/magic/shapes.js';
import { Essences } from '../src/magic/essences.js';
import { Twists } from '../src/magic/twists.js';
import { compileWeave, weaveKey } from '../src/magic/compile.js';
import { STATS } from '../src/core/stats.js';
import { RNG } from '../src/core/rng.js';
import { BODY_CAP } from '../src/magic/balance.js';

// DESIGN §25: prices are the Weave's fourth family. Each is a gain and a cost on the
// stat pipeline (§26); any weave may carry one, and every cast pays it. This file checks
// the seven prices one by one, then every price with every shape (and with essences and
// twists), the way the magic tests check the other three families.

const SEVEN = ['bloodprice', 'berserk', 'glass', 'overdraw', 'emberblood', 'lastlight', 'oath'];

function arena(opts = {}) {
  const g = makeGame({ foes: 3, ...opts });
  installProgression(g);
  g.bus.emit('game_start', { loaded: false });
  g.magic.unlockAll();
  const P = g.player;
  P.falls = [];
  P.fall = (o) => {
    P.falls.push(o);
    P.hp = 0;
    P.downed = true;
    return true;
  };
  g.toasts = [];
  g.ui = { toast: (t) => g.toasts.push(t) };
  return g;
}

function step(g, seconds = 1 / 60) {
  const n = Math.max(1, Math.round(seconds * 60));
  for (let i = 0; i < n; i++) {
    magicStep(g);
    g.stats.update(1 / 60);
    g.prices.update(1 / 60);
  }
}

function fresh(g) {
  resetArena(g);
  g.prices.deserialize(null);
  g.stats.deserializeMods(g.player, []);
  g.player.downed = false;
  g.player.falls.length = 0;
  g.player.hp = g.player.maxHp;
}

const weave = (price, shape = 'bolt', essences = ['raw'], twists = []) => ({ shape, essences, twists, prices: [price] });
const cast = (g, w) => g.magic.cast(g.player, w, AIM, { free: true });

test('seven prices, each a gain and a cost in words; the surge shape is a registry entry', () => {
  assert.deepEqual(Object.keys(PRICES), SEVEN);
  for (const id of SEVEN) {
    const d = Prices.get(id);
    assert.ok(d.name && d.adj && d.gainText && d.costText && d.sentence && d.lyra, `${id} words`);
    assert.match(d.color, /^#[0-9a-f]{6}$/i);
    for (const part of [d.gain, d.cost]) {
      if (!part) continue;
      for (const k of ['add', 'pct', 'mul']) for (const s of Object.keys(part[k] || {})) assert.ok(STATS[s], `${id}: ${s} is a stat`);
    }
  }
  assert.ok(Shapes.has('surge'));
  for (const e of Essences.ids()) assert.ok(SURGE_BUFFS[e], `surge knows ${e}`);
  const plan = compileWeave({ shape: 'surge', essences: ['fire', 'frost'] });
  const mod = surgeModifier(plan);
  assert.ok(mod.pct.dmgDealt > 0 && mod.add.def > 0, 'a blend empowers both ways');
  assert.ok(mod.pct.dmgDealt < SURGE_BUFFS.fire.pct.dmgDealt, 'at reduced potency');
});

test('a price rides on a weave like a twist: name, words, key, locks and one slot', () => {
  const plan = compileWeave(weave('bloodprice', 'bolt', ['fire']));
  assert.ok(plan.ok);
  assert.equal(plan.name, 'Blood-bought Ember Bolt');
  assert.match(plan.priceText, /Price \(Bloodprice\): \+20% damage for 15 s; max health −40% for 2 min/);
  assert.deepEqual(plan.prices, ['bloodprice']);
  assert.deepEqual(priceLines(plan).map((l) => l.id), ['bloodprice']);
  assert.notEqual(weaveKey(weave('glass')), weaveKey({ shape: 'bolt', essences: ['raw'], twists: [] }));
  // Children never pay again.
  const split = compileWeave(weave('glass', 'bolt', ['raw'], ['split']));
  assert.deepEqual(split.child('split').prices, []);
  // Locked until found; one price per weave.
  const g = makeGame({ foes: 0 });
  installProgression(g);
  assert.equal(g.magic.compile(weave('glass')).code, 'locked');
  g.magic.unlock('price', 'glass', 'test');
  g.magic.unlock('price', 'oath', 'test');
  assert.ok(g.magic.compile(weave('glass')).ok);
  assert.equal(g.magic.compile({ shape: 'bolt', essences: ['raw'], prices: ['glass', 'oath'] }).code, 'too_many');
  assert.equal(compileWeave({ shape: 'bolt', prices: ['nope'] }).code, 'unknown');
  assert.ok(g.magic.catalog().prices.length === 7);
});

test('bloodprice: +20% damage for 15 s, max health −40% for 2 min', () => {
  const g = arena();
  const P = g.player;
  const S = g.stats;
  const max = P.maxHp;
  assert.ok(cast(g, weave('bloodprice')).ok);
  assert.equal(S.get(P, 'dmgDealt'), 1.2);
  assert.equal(P.maxHp, Math.round(max * 0.6));
  step(g, 15.2);
  assert.equal(S.get(P, 'dmgDealt'), 1, 'the gain is gone');
  assert.equal(P.maxHp, Math.round(max * 0.6), 'the price is still paid');
  step(g, 105);
  assert.equal(P.maxHp, max);
});

test('berserk: double strength, faster, unshakable for 2 min; then the heart gives out (fall, 30 s)', () => {
  const g = arena();
  const P = g.player;
  const S = g.stats;
  const atk = S.get(P, 'atk');
  const speed = S.get(P, 'speed');
  const lyra = [];
  g.bus.on('price_paid', (p) => lyra.push(p.price));
  assert.ok(cast(g, weave('berserk', 'strike')).ok);
  assert.equal(S.get(P, 'atk'), atk * 2);
  assert.ok(Math.abs(S.get(P, 'speed') - speed * 1.4) < 1e-6);
  assert.ok(S.get(P, 'swing') > 1 && S.get(P, 'castSpeed') > 1 && S.get(P, 'poise') >= 1);
  assert.deepEqual(lyra, ['berserk']);
  // Casting again changes nothing: it runs its course.
  step(g, 60);
  cast(g, weave('berserk', 'strike'));
  step(g, 59.5);
  assert.equal(P.falls.length, 0);
  step(g, 1);
  assert.equal(P.falls.length, 1, 'the end of berserk calls fall');
  assert.deepEqual(P.falls[0], { window: 30, cause: 'berserk' });
  assert.equal(S.get(P, 'atk'), atk, 'its gain is gone with it');
});

test('glass: +50% weave power and +50% damage taken, both for 30 s', () => {
  const g = arena();
  const P = g.player;
  cast(g, weave('glass'));
  assert.equal(g.magic.powerOf(P), 1.5);
  assert.equal(g.stats.get(P, 'dmgTaken'), 1.5);
  step(g, 30.5);
  assert.equal(g.magic.powerOf(P), 1);
  assert.equal(g.stats.get(P, 'dmgTaken'), 1);
});

test('overdraw: weaves cost no mana for 10 s, then no mana comes back for 30 s', () => {
  const g = arena();
  const P = g.player;
  const m = g.magic;
  const plan = m.compile({ shape: 'bolt', essences: ['raw'] });
  assert.ok(m.cast(P, weave('overdraw'), AIM).ok);
  assert.equal(m.costOf(P, plan), 0);
  const cur = m.mana.cur;
  m.resetCooldowns();
  m.cast(P, { shape: 'bolt', essences: ['raw'] }, AIM);
  assert.equal(m.mana.cur, cur, 'a free weave');
  step(g, 10.2);
  assert.ok(m.costOf(P, plan) > 0);
  assert.equal(g.stats.get(P, 'manaRegen'), 0);
  m.mana.cur = 5;
  step(g, 5);
  assert.equal(m.mana.cur, 5, 'the well is dry');
  step(g, 26);
  assert.ok(m.mana.cur > 5, 'and fills again');
});

test('emberblood: cast 30% faster while it burns 2% health a second; douse it, or it gutters out', () => {
  const g = arena();
  const P = g.player;
  cast(g, weave('emberblood'));
  assert.ok(Math.abs(g.stats.get(P, 'castSpeed') - 1.3) < 1e-9);
  const hp = P.hp;
  step(g, 5);
  assert.ok(Math.abs(hp - P.hp - P.maxHp * 0.02 * 5) <= 1.5, `burned ${hp - P.hp}`);
  const timer = g.prices.timers().find((t) => t.price === 'emberblood');
  assert.equal(timer.tap, 'douse', 'its HUD icon douses it');
  assert.ok(g.prices.douse());
  assert.equal(g.stats.get(P, 'castSpeed'), 1);
  const hp2 = P.hp;
  step(g, 3);
  assert.equal(P.hp, hp2);
  // Left alone it burns down to one and goes out; it never kills.
  cast(g, weave('emberblood'));
  step(g, 60);
  assert.equal(P.hp, 1);
  assert.equal(g.prices.state.ember, false);
  assert.equal(P.falls.length, 0);
});

test('lastlight: rise whole once instead of falling; max health −50% until the next sleep', () => {
  const g = arena();
  const P = g.player;
  const max = P.maxHp;
  cast(g, weave('lastlight'));
  assert.equal(g.prices.state.lastlight, 'armed');
  P.invuln = 0;
  g.combat.damage(g.foes[0], P, 999, { exact: true });
  assert.ok(!P.downed, 'the light holds the wound shut');
  assert.equal(P.maxHp, Math.round(max * 0.5));
  assert.equal(P.hp, P.maxHp);
  assert.equal(g.prices.state.lastlight, 'used');
  // Spent until sleep: casting it again does not re-arm it.
  cast(g, weave('lastlight'));
  assert.equal(g.prices.state.lastlight, 'used');
  P.invuln = 0;
  g.combat.damage(g.foes[0], P, 999, { exact: true });
  assert.ok(P.downed, 'the second time, you fall');
  // It cannot restart a heart: berserk's end is not saved by it.
  P.downed = false;
  P.hp = P.maxHp;
  g.bus.emit('player_wake', {});
  assert.equal(P.maxHp, max, 'sleep gives the health back');
  cast(g, weave('lastlight'));
  assert.equal(g.prices.state.lastlight, 'armed', 'and the light can be held again');
  P._fallOpts = { cause: 'berserk' };
  assert.equal(g.prices.preventFall(P), false);
});

test('oath: +30% to everything while Lyra is near; her wounds are yours', () => {
  const g = arena();
  const P = g.player;
  const L = g.companion;
  const S = g.stats;
  const atk = S.get(P, 'atk');
  cast(g, weave('oath'));
  assert.ok(Math.abs(S.get(P, 'atk') - atk * 1.3) < 1e-6, 'near her');
  L.x = P.x + 400;
  S.touch();
  assert.equal(S.get(P, 'atk'), atk, 'far from her, nothing');
  L.x = P.x + 20;
  const hp = P.hp;
  L.invuln = 0;
  g.combat.damage(g.foes[0], L, 10, { exact: true });
  assert.ok(P.hp < hp, 'hurt with her');
  step(g, 46);
  const hp2 = P.hp;
  L.invuln = 0;
  g.combat.damage(g.foes[0], L, 10, { exact: true });
  assert.equal(P.hp, hp2, 'the oath has run out');
});

test('every price works with every shape (and essences and twists): casts, pays, runs clean', () => {
  const g = arena();
  const P = g.player;
  const t0 = performance.now();
  let n = 0;
  for (const price of SEVEN) {
    for (const shape of Shapes.ids()) {
      fresh(g);
      const w = weave(price, shape, ['raw']);
      const plan = g.magic.compile(w);
      assert.ok(plan.ok, `${price} ${shape}: ${plan.reason}`);
      assert.ok(plan.name.startsWith(Prices.get(price).adj), `${price} ${shape}: named`);
      const r = plan.input === 'tap' ? g.magic.cast(P, w, AIM, { free: true }) : g.magic.castStart(P, w, AIM, { free: true });
      assert.ok(r.ok, `${price} ${shape}: ${r.message}`);
      const paid = g.stats.modifiers(P).some((m) => m.price === price) || g.prices.state.lastlight === 'armed' || !!g.prices.state.oath;
      assert.ok(paid, `${price} ${shape}: the price is paid`);
      for (let i = 0; i < 60; i++) {
        if (plan.input !== 'tap' && i === 30) g.magic.castRelease(P, AIM);
        step(g);
      }
      assertSane(g, assert, `${price} ${shape}`);
      for (const k of Object.keys(STATS)) assert.ok(Number.isFinite(g.stats.get(P, k)), `${price} ${shape}: ${k}`);
      n++;
    }
  }
  // Essence pairs and twist triples, sampled deterministically.
  const rng = new RNG(25);
  const ess = Essences.ids().filter((e) => e !== 'raw');
  const tw = Twists.ids();
  for (let i = 0; i < 60; i++) {
    fresh(g);
    const price = SEVEN[i % SEVEN.length];
    const shape = Shapes.ids()[rng.int(0, Shapes.ids().length - 1)];
    const e = [ess[rng.int(0, ess.length - 1)], ess[rng.int(0, ess.length - 1)]].filter((x, j, a) => a.indexOf(x) === j);
    const t = [tw[rng.int(0, tw.length - 1)], tw[rng.int(0, tw.length - 1)], tw[rng.int(0, tw.length - 1)]].filter((x, j, a) => a.indexOf(x) === j);
    const w = weave(price, shape, e, t);
    const plan = g.magic.compile(w);
    assert.ok(plan.ok, `${JSON.stringify(w)}: ${plan.reason}`);
    const r = plan.input === 'tap' ? g.magic.cast(P, w, AIM, { free: true }) : g.magic.castStart(P, w, AIM, { free: true });
    assert.ok(r.ok, `${JSON.stringify(w)}: ${r.message}`);
    let peak = 0;
    for (let k = 0; k < 90; k++) {
      if (plan.input !== 'tap' && k === 40) g.magic.castRelease(P, AIM);
      step(g);
      peak = Math.max(peak, g.magic.bodies.length);
    }
    assert.ok(peak <= BODY_CAP);
    assertSane(g, assert, JSON.stringify(w));
    n++;
  }
  const ms = performance.now() - t0;
  assert.ok(n >= SEVEN.length * 13 + 60);
  assert.ok(ms < 60000, `${ms} ms`);
});

test('a surge woven at yourself empowers you by its essences; it harms no one', () => {
  const g = arena();
  const P = g.player;
  const foe = g.foes[0];
  foe.x = P.x + 10;
  foe.y = P.y;
  const hp = foe.hp;
  assert.ok(cast(g, { shape: 'surge', essences: ['frost'], twists: ['burst'] }).ok);
  const mod = g.stats.getModifier(P, 'surge');
  assert.ok(mod && mod.add.def > 0 && mod.t > 5);
  step(g, 1);
  assert.equal(foe.hp, hp, 'harmless');
  assert.ok(g.prices.timers().some((t) => t.id === 'surge'), 'a timer on the HUD');
});

test('active prices survive a save and load', () => {
  const g = arena();
  const P = g.player;
  cast(g, weave('berserk', 'strike'));
  cast(g, weave('overdraw'));
  cast(g, weave('lastlight'));
  step(g, 20);
  const data = JSON.parse(JSON.stringify({ magic: g.magic.serialize(), prog: saveProgression(g) }));
  const h = arena();
  loadProgression(h, data.prog);
  h.magic.deserialize(data.magic);
  const Q = h.player;
  assert.ok(Math.abs(h.prices.state.berserk.t - (120 - 20)) < 0.2);
  assert.equal(h.prices.state.lastlight, 'armed');
  assert.ok(h.prices.state.overdraw.cost > 0 || h.prices.state.overdraw.gain > 0);
  assert.equal(h.stats.get(Q, 'atk'), g.stats.get(P, 'atk'));
  step(h, 100.5);
  assert.equal(Q.falls.length, 1, 'the loaded berserk still ends in a fall');
});
