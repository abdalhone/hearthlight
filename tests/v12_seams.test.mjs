// Version 12: round 14b (aee713c) joined with the stat points second pass (412fcb8).
// DESIGN §39. Each test is a seam that only exists once both are in one game: round 14b's
// villagers who fight back, finishers, a killable Lyra, any adult companion, the Unkindling,
// casting that stops you, the dark path, the shop, the heavier death and saves, all played
// on the new numbers (points on three curves; a percentage is its whole share of the number
// before any percentage).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step as stepWorld, px, put, holdLyra, villagers, events } from './murder_world.mjs';
import { installProgression } from '../src/progression/index.js';
import { FREE_MAX } from '../src/progression/progression.js';
import { pointsEffect } from '../src/progression/attributes.js';
import { partyPlugin, holderOf } from '../src/core/party.js';
import { FINISH_HOLD } from '../src/murder/data.js';
import { buildOf, chooseFinisher } from '../src/murder/finishers.js';
import { installUnkindle } from '../src/core/plugins/soul.js';
import { TILE } from '../src/core/constants.js';
import { STATS } from '../src/core/stats.js';
import { DEFENDER_COMBAT } from '../src/entities/defenders.js';
import { PLAYER_BASE } from '../src/entities/player.js';
import { PRICES, LAST_STAND_GAIN, Prices } from '../src/magic/prices.js';
import { BUFF_ITEMS, GEAR } from '../src/gear/gear_data.js';

// The murder world (all eighteen villagers, Lyra with her mind, survival, game.murder) with
// the game's own stat pipeline and points on, as game.js wires them.
function statsWorld({ hour = 12 } = {}) {
  const g = makeGame({ hour });
  installProgression(g);
  g.bus.emit('game_start', { loaded: false });
  if (!g.party) g.plugins.register(partyPlugin);
  return g;
}

function step(g, seconds, dt = 1 / 20) {
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    stepWorld(g, dt, dt);
    g.stats.update(dt);
    g.prices.update(dt);
  }
}

// Points as Free stat points gives them (or really spent, at a level that earned them).
function points(g, pts, { level = 1 } = {}) {
  const P = g.player;
  const pr = g.progression;
  if (level > 1) {
    P.level = level;
    g.stats.refresh(P);
  }
  const free = Object.values(pts).some((n) => n > pr.earned());
  if (free) pr.startFree();
  for (const [id, n] of Object.entries(pts)) assert.ok(pr.spend(id, n).ok, `spend ${n} ${id}`);
  g.stats.refresh(P);
  P.hp = P.maxHp;
  return P;
}

// Everyone not named far away and still.
function quiet(g, keep = []) {
  for (const v of villagers(g)) {
    if (keep.includes(v.id)) continue;
    put(v, px(141) + Math.random() * 20, px(101));
    v.think = () => {};
  }
  if (!keep.includes('lyra')) holdLyra(g, px(150), px(112));
}

const MEADOW = { tx: 97, ty: 103 };

// ---------------------------------------------------------------- 1. fight back, the arrest

test('seam 1: a 999-Might blade downs a villager in one blow, never kills; the blow seen is the knockout the watch answers', () => {
  const g = statsWorld();
  quiet(g, ['bram', 'rowan']);
  const P = points(g, { might: FREE_MAX });
  assert.ok(P.atk > 500, `the sword is ${P.atk.toFixed(0)}`);
  put(P, px(MEADOW.tx), px(MEADOW.ty));
  const bram = g.entities.get('bram');
  const rowan = g.entities.get('rowan');
  put(bram, P.x + 18, P.y);
  put(rowan, P.x + 3 * TILE, P.y + 2 * TILE);
  rowan.faceToward?.(P.x, P.y);
  P.faceToward(bram.x, bram.y);
  const dealt = g.combat.damage(P, bram, P.atk, { exact: true, crit: false });
  assert.ok(dealt > bram.maxHp * 5, `a blow of ${dealt} against ${bram.maxHp} health`);
  assert.ok(bram.downed && !bram.dead, 'knocked down, never killed by a blow, however big');
  assert.equal(g.murder.isDead('bram'), false, 'no death on record');
  assert.equal(g.combat.damage(P, bram, P.atk, { exact: true, crit: false }), 0, 'a blow on a man lying down does nothing: only the finisher kills');
  assert.ok(g.combat.hasCrime(P), 'a knockout Rowan saw is on the record');
  assert.equal(P.crime?.kind, 'knockout');
  assert.ok(g.combat.knowsCrime(rowan, P), 'Rowan saw it: he knows');
  assert.ok(g.combat.canHarm(rowan, P, true), 'and the watch that knows may strike back');
});

test('seam 1: every earned point in Vitality at level 15: the watch that knows still drops you in tens of blows, and it is an arrest', () => {
  const g = statsWorld({ hour: 14 });
  quiet(g, ['rowan']);
  const P = points(g, { vitality: 42 }, { level: 15 });
  const old = 60 + 14 * 5 + 42 * 6; // the line before round 14b (6 a point, straight)
  assert.ok(P.maxHp > old && P.maxHp < old * 1.5, `health ${P.maxHp} (the old line ${old})`);
  put(P, px(MEADOW.tx), px(MEADOW.ty));
  const rowan = g.entities.get('rowan');
  put(rowan, P.x + 16, P.y);
  P.crime = { level: 1, kind: 'assault', until: g.clock.t + 600, victimId: 'bram', since: g.clock.t, t: g.clock.t };
  g.village.addRumor('attacked_villager', { victim: 'bram', witnesses: ['rowan'] });
  assert.ok(rowan.knowsWanted(P), 'Rowan knows');
  let blows = 0;
  while (!P.downed && blows < 400) {
    P.invuln = 0;
    g.combat.damage(rowan, P, rowan.atk, { exact: true, crit: false });
    blows++;
  }
  assert.ok(P.downed, 'you fall');
  assert.ok(blows >= 40 && blows <= 90, `${blows} of Rowan's blows (the old line: ${Math.ceil(old / (rowan.atk - (P.def || 0)))})`);
  step(g, 0.3);
  const rec = g.survival.falls.get(P);
  assert.ok(rec?.wanted, 'fallen while wanted');
  assert.equal(g.survival.jobFor(rowan)?.role, 'arrest', 'the watch that knows arrests you where you fell');
});

// ---------------------------------------------------------------- 2. finishers

test('seam 2: the finisher is a held choice, whatever the sword; its pose follows the points (blade or weave)', () => {
  const g = statsWorld();
  quiet(g, ['bram']);
  const P = points(g, { might: FREE_MAX });
  put(P, px(MEADOW.tx), px(MEADOW.ty));
  const bram = g.entities.get('bram');
  put(bram, P.x + 18, P.y);
  P.faceToward(bram.x, bram.y);
  g.combat.damage(P, bram, P.atk, { exact: true, crit: false });
  assert.ok(bram.downed);
  assert.equal(buildOf(g).kind, 'sword');
  assert.equal(chooseFinisher(g).id, 'sword');
  // Half a hold, then let go: no death.
  g.input.down = (a) => a === 'attack';
  assert.equal(g.murder.onAttackPress(P), true);
  step(g, FINISH_HOLD / 2);
  g.input.down = () => false;
  step(g, 0.2);
  assert.equal(g.murder.hold, null, 'let go: the blow is not struck');
  assert.ok(bram.downed && !bram.dead, 'he lies there, alive');
  // Held the whole way: the blow falls, and the sword's mark is left.
  g.input.down = (a) => a === 'attack';
  g.murder.onAttackPress(P);
  step(g, FINISH_HOLD + 0.3);
  assert.ok(g.murder.isDead('bram'));
  assert.equal(g.murder.dead.bram.finisher, 'sword');
  // A weaver's points choose the weave's finisher.
  const h = statsWorld();
  points(h, { weave: FREE_MAX, focus: FREE_MAX });
  assert.equal(buildOf(h).kind, 'magic');
  assert.equal(chooseFinisher(h).id, 'magic');
});

// ---------------------------------------------------------------- 3. killable Lyra, children

test('seam 3: Lyra at full health takes a 999-Might blow and goes down, never vanishes; the finisher kills her and her parents mourn', () => {
  const g = statsWorld({ hour: 9 });
  quiet(g, ['lyra']);
  const L = g.companion;
  L.controller = L._heldController || L.controller;
  const P = points(g, { might: FREE_MAX });
  put(P, px(MEADOW.tx), px(MEADOW.ty));
  put(L, P.x + 18, P.y);
  L.hp = L.maxHp;
  P.faceToward(L.x, L.y);
  g.combat.damage(P, L, P.atk, { exact: true, crit: false });
  assert.ok(L.downed && !L.dead && !L.removed, 'down, in the world');
  assert.equal(g.murder.isDead('lyra'), false);
  assert.equal(g.combat.damage(P, L, P.atk, { exact: true, crit: false }), 0, 'no second blow lands on her lying down');
  g.flags.finisherWarnedLyra = true;
  g.input.down = (a) => a === 'attack';
  assert.equal(g.murder.onAttackPress(P), true);
  step(g, FINISH_HOLD + 0.3);
  assert.ok(g.murder.isDead('lyra') && L.dead, 'the held blow killed her');
  assert.equal(holderOf(g), null, 'the companion slot is empty');
  g.murder.found('lyra', 'hess', 'south_meadow');
  for (const id of ['hobb', 'wenna']) assert.equal(g.villageLife.mourning[id]?.about, 'lyra', `${id} mourns her`);
});

test('seam 3: a child struck by a 999-Might blade is only knocked down: "No. Not a child." and no death, by sword or by the Unkindling', () => {
  const g = statsWorld();
  quiet(g, ['pip']);
  const unk = installUnkindle(g);
  unk.learn('test');
  const P = points(g, { might: FREE_MAX, weave: FREE_MAX });
  put(P, px(MEADOW.tx), px(MEADOW.ty));
  const pip = g.entities.get('pip');
  put(pip, P.x + 18, P.y);
  P.faceToward(pip.x, pip.y);
  g.combat.damage(P, pip, P.atk, { exact: true, crit: false });
  assert.ok(pip.downed && !pip.dead, 'knocked down, not dead');
  const said = [];
  g.bubbles = { say: (who, text) => said.push(text) };
  g.input.down = (a) => a === 'attack';
  assert.equal(g.murder.onAttackPress(P), true, 'the press is taken');
  assert.equal(g.murder.hold, null, 'and no blow is held over a child');
  assert.ok(said.includes('No. Not a child.'));
  step(g, FINISH_HOLD + 0.5);
  assert.equal(g.murder.kill(pip, P), null, 'kill() refuses a child too');
  assert.ok(!pip.dead && !g.murder.isDead('pip'));
  assert.equal(unk.check(pip)?.reason, 'child');
});

// ---------------------------------------------------------------- 4. companions

test('seam 4: a companion keeps their own numbers whatever your points, and keeps up with everything stacked (226 px/s)', () => {
  const g = statsWorld();
  quiet(g, ['bram']);
  const P = g.player;
  const L = g.companion;
  const bram = g.entities.get('bram');
  const before = { bram: [bram.maxHp, bram.atk, bram.speed], lyra: [L.maxHp, L.atk, L.speed] };
  points(g, { vitality: FREE_MAX, might: FREE_MAX, grace: FREE_MAX, focus: FREE_MAX });
  g.stats.update(0.05);
  assert.deepEqual([bram.maxHp, bram.atk, bram.speed], before.bram, 'Bram is Bram');
  assert.deepEqual([L.maxHp, L.atk, L.speed], before.lyra, 'and Lyra is Lyra: the points are yours');
  assert.equal(bram.maxHp, DEFENDER_COMBAT.bram.maxHp);
  // Everything that hastes you at once (gear, Swiftfoot, Berserk, the Last Stand).
  for (const id of ['roadrunner_boots', 'murrel_cloak']) {
    if (!GEAR[id]) continue;
    P.inventory.add(id, 1);
    g.gear.equip(id);
  }
  g.stats.addModifier(P, { id: 'swiftfoot', ...BUFF_ITEMS.swiftfoot_draught.buff, t: 120 });
  g.stats.addModifier(P, { id: 'price:berserk:gain', source: 'price:berserk', ...PRICES.berserk.gain, t: 120 });
  g.stats.addModifier(P, { id: 'price:laststand:gain', source: 'price:laststand', ...LAST_STAND_GAIN, t: 60 });
  g.stats.refresh(P);
  const pace = P.speed;
  assert.ok(pace > 200 && pace < STATS.speed.max, `you run at ${pace.toFixed(1)} px/s`);
  bram.opinionOfPlayer = 85;
  put(P, px(5), px(84)); // the King's Road: 160 tiles of open road
  put(bram, px(4), px(84));
  assert.ok(g.party.invite(bram).ok);
  step(g, 1);
  let worst = 0;
  const dt = 1 / 20;
  for (let t = 0; t < 10; t += dt) {
    P.x += pace * dt;
    P.facing = { x: 1, y: 0 };
    stepWorld(g, dt, dt);
    worst = Math.max(worst, Math.hypot(bram.x - P.x, bram.y - P.y) / TILE);
  }
  assert.ok(worst < 32, `never more than ${worst.toFixed(1)} tiles behind (he catches up out of sight)`);
  let s = 0;
  while (Math.hypot(bram.x - P.x, bram.y - P.y) > 3 * TILE && s < 15) {
    stepWorld(g, dt, dt);
    s += dt;
  }
  assert.ok(s < 15, `beside you ${s.toFixed(1)} s after you stop`);
  assert.equal(holderOf(g), bram, 'still walking with you');
});

// ---------------------------------------------------------------- 5. the Unkindling

function takeElda(g, unk) {
  const P = g.player;
  put(P, px(62), px(14));
  P.facing = { x: 1, y: 0 };
  P.dir = 'right';
  const elda = g.entities.get('elda');
  put(elda, P.x + TILE, P.y);
  const r = unk.begin(elda);
  assert.ok(r.ok, r.line || r.reason);
  let t = 0;
  while (unk.channel && t < 12) {
    unk.update(1 / 20);
    stepWorld(g, 1 / 20, 1 / 20);
    g.stats.update(1 / 20);
    t += 1 / 20;
  }
  return elda;
}

test('seam 5: the Unkindling costs no health and no mana, at 4908 health or at 1; the soul bar fills by the soul, and its boost is a whole share', () => {
  const bars = [];
  for (const build of ['huge', 'one']) {
    const g = statsWorld();
    quiet(g, ['elda']);
    const unk = installUnkindle(g);
    unk.learn('test');
    const P = g.player;
    if (build === 'huge') points(g, { vitality: FREE_MAX, focus: FREE_MAX, might: FREE_MAX });
    if (build === 'one') P.hp = 1;
    const hp = P.hp;
    const mana = g.magic?.mana?.cur;
    const elda = takeElda(g, unk);
    assert.ok(elda.dead && g.murder.dead.elda?.cause === 'unkindled', `${build}: taken`);
    assert.equal(P.hp, hp, `${build}: no health taken (${P.hp})`);
    if (Number.isFinite(mana)) assert.equal(g.magic.mana.cur, mana, `${build}: no mana taken`);
    assert.ok(!P.downed && !P.dead, `${build}: it cannot kill you`);
    bars.push(unk.coldfire.bar);
    // The boost: Sword +30% of the sword before any % at a full bar, alone or with points.
    unk.coldfire.bar = 0;
    g.stats.refresh(P);
    const plain = g.stats.breakdown(P, 'atk');
    unk.coldfire.bar = 100;
    g.stats.refresh(P);
    const add = plain.reduce((s, b) => s + b.add, 0);
    const pct = plain.reduce((s, b) => s + b.pct, 0);
    const mul = plain.reduce((s, b) => s * b.mul, 1);
    const got = g.stats.get(P, 'atk');
    assert.ok(Math.abs(got - Math.min(STATS.atk.max, add * (1 + pct + 0.3) * mul)) <= 0.05, `${build}: a full bar is +30% of the sword (${(add * (1 + pct) * mul).toFixed(1)} → ${got})`);
  }
  assert.ok(Math.abs(bars[0] - bars[1]) < 1e-9 && bars[0] > 0, `the same soul fills the same bar whatever your build (${bars.join(' / ')})`);
});

// ---------------------------------------------------------------- 7. Oath, the dark path

test('seam 7: Oath\'s words name every share it gives, and the shares are what it gives', () => {
  const g = statsWorld();
  const P = g.player;
  g.prices.state.oath = { t: 45 };
  put(P, px(MEADOW.tx), px(MEADOW.ty));
  put(g.companion, P.x + 10, P.y);
  const mods = g.prices.provide(P) || [];
  const oath = mods.find((m) => m.id === 'price:oath:gain');
  assert.ok(oath, 'the oath gives while she is near');
  const words = { atk: /(sword|strength)/, spellPower: /weave/, def: /armor/, crit: /crit/, speed: /speed/, castSpeed: /casting/ };
  const text = PRICES.oath.gainText;
  for (const [stat, share] of Object.entries(oath.pct)) {
    const pc = `${Math.round(share * 100)}%`;
    assert.ok(words[stat]?.test(text), `the words name ${stat}`);
    assert.ok(text.includes(pc), `and its ${pc}`);
  }
  assert.match(PRICES.oath.gain.label, /\+30% of your sword, weaves, armor, crit, \+10% speed/);
  // +10% speed is 10% of the normal pace, at 0 Grace or 999.
  for (const n of [0, FREE_MAX]) {
    const h = statsWorld();
    if (n) points(h, { grace: n });
    const Q = h.player;
    put(Q, px(MEADOW.tx), px(MEADOW.ty));
    put(h.companion, Q.x + 10, Q.y);
    const s0 = Q.speed;
    h.prices.state.oath = { t: 45 };
    h.stats.refresh(Q);
    assert.ok(Math.abs(Q.speed - s0 - 0.1 * PLAYER_BASE.speed) < 1e-9, `${n} Grace: Oath adds ${(Q.speed - s0).toFixed(2)} px/s`);
  }
});

// ---------------------------------------------------------------- 9. death heavier

test('seam 9: the bleed-out window follows Resolve to its 300 s clamp; the Last Stand adds 35% of the normal pace at any Grace; Lastlight halves even 4908 health', () => {
  const g = statsWorld();
  const P = g.player;
  const base = g.stats.get(P, 'bleedout');
  points(g, { resolve: 20 });
  const at20 = g.stats.get(P, 'bleedout');
  assert.ok(Math.abs(at20 - base - pointsEffect('resolve', 20).add.bleedout) < 1e-9, `20 Resolve: ${at20.toFixed(1)} s, on the gentle curve`);
  g.progression.spend('resolve', 32);
  assert.equal(g.stats.get(P, 'bleedout'), STATS.bleedout.max, `52 Resolve: the window is at its ${STATS.bleedout.max} s clamp`);
  g.progression.spend('resolve', FREE_MAX - 52);
  assert.equal(g.stats.get(P, 'bleedout'), STATS.bleedout.max, 'held at its clamp');
  for (const n of [0, 50, FREE_MAX]) {
    const h = statsWorld();
    if (n) points(h, { grace: n });
    const Q = h.player;
    const s0 = Q.speed;
    h.stats.addModifier(Q, { id: 'price:laststand:gain', source: 'price:laststand', ...LAST_STAND_GAIN, t: 60 });
    h.stats.refresh(Q);
    assert.ok(Math.abs(Q.speed - s0 - 0.35 * PLAYER_BASE.speed) < 1e-9, `${n} Grace: the Last Stand adds ${(Q.speed - s0).toFixed(2)} px/s`);
  }
  const k = statsWorld();
  const Q = points(k, { vitality: FREE_MAX });
  const whole = Q.maxHp;
  assert.ok(whole > 4800, `${whole} health`);
  k.stats.addModifier(Q, { id: 'price:lastlight:cost', source: 'price:lastlight', kind: 'cost', ...Prices.get('lastlight').cost, t: null });
  k.stats.refresh(Q);
  assert.ok(Math.abs(Q.maxHp - whole * 0.5) <= 1, `Lastlight spent: half (${whole} → ${Q.maxHp})`);
});

// ---------------------------------------------------------------- 6. casting stops you

import { makeGame as makeArena, step as arenaStep } from './magic_helpers.mjs';
import { fakeInput } from './survival_world.mjs';
import { Player } from '../src/entities/player.js';
import * as BAL from '../src/magic/balance.js';

// The Weave's arena with the real Player (its own walk and plant) on the stat pipeline.
function castArena() {
  const g = makeArena({ foes: 1 });
  const old = g.player;
  const P = new Player(g, { x: old.x, y: old.y });
  g.entities.list[g.entities.list.indexOf(old)] = P;
  g.entities.byId.set('player', P);
  g.player = P;
  g.input = fakeInput();
  installProgression(g);
  g.bus.emit('game_start', { loaded: false });
  g.magic.unlockAll();
  g.magic.addMaxMana(300);
  g.magic.mana.cur = g.magic.mana.max;
  g.magic.setSlot(0, { shape: 'bolt', essences: ['raw'] });
  g.magic.setSlot(1, { shape: 'rain', essences: ['raw'] });
  for (const f of g.foes) {
    f.x = 36 * 16;
    f.y = 4 * 16;
  }
  return { g, P, m: g.magic };
}
function tick(g, dt = 1 / 60) {
  arenaStep(g, dt);
  g.stats.update(dt);
  g.input.endFrame();
}
const paceOf = (P) => Math.hypot(P.vel.x, P.vel.y);

test('seam 6: casting plants you at 999 Grace with every haste running; the plant is the weave\'s weight and your cast speed, never Focus; full pace after', () => {
  const plants = {};
  for (const focus of [0, FREE_MAX]) {
    const { g, P, m } = castArena();
    g.progression.startFree();
    g.progression.spend('grace', FREE_MAX);
    if (focus) g.progression.spend('focus', focus);
    P.inventory.add('roadrunner_boots', 1);
    g.gear.equip('roadrunner_boots');
    g.stats.addModifier(P, { id: 'swiftfoot', ...BUFF_ITEMS.swiftfoot_draught.buff, t: 120 });
    g.stats.addModifier(P, { id: 'price:berserk:gain', source: 'price:berserk', ...PRICES.berserk.gain, t: 120 });
    g.stats.addModifier(P, { id: 'price:laststand:gain', source: 'price:laststand', ...LAST_STAND_GAIN, t: 60 });
    g.stats.refresh(P);
    const pace = P.speed;
    assert.ok(pace > 200, `hasted: ${pace.toFixed(1)} px/s`);
    // Cooldowns follow Focus on the speed curve; the plant does not read them.
    const cd = g.stats.get(P, 'cooldown');
    if (focus) assert.ok(cd < 0.55, `999 Focus: cooldowns ×${cd.toFixed(2)}`);
    g.input.move = { x: 1, y: 0 };
    for (let i = 0; i < 40; i++) tick(g);
    assert.ok(paceOf(P) > pace * 0.95, `running at ${paceOf(P).toFixed(1)} of ${pace.toFixed(1)}`);
    for (const slot of [0, 1]) {
      const x0 = P.x;
      const r = m.cast(P, slot, { x: P.x + 200, y: P.y });
      assert.ok(r.ok, r.message);
      const want = BAL.plantFor(m.slotPlan(slot), g.stats.get(P, 'castSpeed'));
      assert.ok(Math.abs(P.castPlantT - want) < 1e-9, `slot ${slot}: planted ${P.castPlantT.toFixed(3)} s (the weave's weight over cast speed ${g.stats.get(P, 'castSpeed').toFixed(2)})`);
      plants[`${focus}:${slot}`] = P.castPlantT;
      let moved = 0;
      while (P.castPlantT > 0) {
        tick(g);
        moved = Math.max(moved, Math.abs(P.x - x0));
      }
      assert.ok(moved < 0.5, `feet planted with the stick held at ${pace.toFixed(0)} px/s (moved ${moved.toFixed(2)} px)`);
      assert.ok(Math.abs(P.speed - pace) < 1e-9, 'the pipeline\'s pace is untouched by the plant: the sheet stays true');
      for (let i = 0; i < 30; i++) tick(g);
      assert.ok(paceOf(P) > pace * 0.95, `after: the whole pace again (${paceOf(P).toFixed(1)})`);
      m.cooldowns = m.cooldowns?.map?.(() => 0) ?? m.cooldowns;
      for (let i = 0; i < 90; i++) tick(g);
    }
    // A charge: no walk at all while it gathers, castMoveMul 0 after the pipeline.
    assert.ok(m.castStart(P, 0, { x: P.x + 200, y: P.y }, { charge: true }).ok);
    const x1 = P.x;
    for (let i = 0; i < 40; i++) tick(g);
    assert.equal(P.castMoveMul, 0);
    assert.ok(Math.abs(P.x - x1) < 0.5, 'charging: you stand');
    m.castCancel(P);
  }
  assert.equal(plants['0:0'], plants[`${FREE_MAX}:0`], 'the same plant with 0 or 999 Focus');
  assert.equal(plants['0:1'], plants[`${FREE_MAX}:1`]);
});

// ---------------------------------------------------------------- 8. the shop and gear words

import { describeContribution } from '../src/core/stats.js';
import { wareWords } from '../src/gear/gear.js';

// The sheet says what a % is a share of (round 14b stats: "Each % is a share of your normal
// pace, 76."); the gear in your bag, the forge and the shop's wares say it the same way.
test('seam 8: gear and wares say what each % is a share of, as the sheet does; loot and prices unchanged', () => {
  const boots = describeContribution(GEAR.roadrunner_boots.stats);
  assert.ok(boots.includes('+8% Speed (of your normal pace)'), boots.join(', '));
  assert.ok(boots.includes('+3% Dodge chance'), 'a chance added is points of it, as before');
  const oathLike = describeContribution({ pct: { crit: 0.3, atk: 0.3, spellPower: 0.05, castSpeed: 0.08 } });
  assert.ok(oathLike.includes('+30% of your critical chance'), oathLike.join(', '));
  assert.ok(oathLike.includes('+30% of your sword'), 'a share of the sword before any %');
  assert.ok(oathLike.includes('+5% of your weave power'));
  assert.ok(oathLike.includes('+8% Cast speed'), 'a ×1 number nothing adds to reads plainly');
  assert.ok(describeContribution({ pct: { speed: -0.06 } }).includes('−6% Speed (of your normal pace)'), 'heavy armour too');
  // The shop's ware line for a piece of gear and for a draught.
  const ware = wareWords('roadrunner_boots');
  assert.match(ware, /\+8% Speed \(of your normal pace\)/);
  assert.match(ware, /Uncommon boots/);
  assert.equal(wareWords('swiftfoot_draught'), 'Swiftfoot: +3% Dodge chance, +12% Speed (of your normal pace) for 2 min');
  assert.equal(wareWords('iron_ore'), null, 'a plain thing has no stat words');
  // Prices and what a ware is worth are the shop's own (no stat file touches them).
  assert.equal(GEAR.roadrunner_boots.value, 85);
  assert.equal(BUFF_ITEMS.swiftfoot_draught.value, 28);
});

// ---------------------------------------------------------------- 10. saves

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { loadProgression } from '../src/progression/index.js';

// Real saves made in the Version 11 (2634ca5) and round 14b (aee713c) builds by
// scratchpad's probe_saves.mjs: level 15, 20 Might, 12 Vitality, 10 Focus, a steel sword,
// health 141 of 202, Garrick murdered; the round 14b one also walks with Bram, has sealed
// the pact (after) and carries the Unkindling with a soul bar of 40.
function fixture(ver) {
  return JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/save_${ver}.json.gz`, import.meta.url))).toString('utf8'));
}

for (const ver of ['2634ca5', 'aee713c']) {
  test(`seam 10: a ${ver === 'aee713c' ? 'round 14b' : 'Version 11'} save (${ver}) loads onto the new numbers, its wound, party, murder and soul kept`, () => {
    const d = fixture(ver);
    const g = statsWorld();
    const unk = installUnkindle(g);
    g.player.deserialize(d.player);
    loadProgression(g, d.progression);
    const P = g.player;
    const pts = d.progression.progression.points;
    assert.deepEqual(g.progression.points, pts, 'the points, by id');
    assert.equal(P.level, 15);
    const want = 60 + 5 * 14 + pointsEffect('vitality', pts.vitality).add.maxHp;
    assert.ok(Math.abs(P.maxHp - want) <= 1, `health on the new curve: ${P.maxHp} (was ${d.player.maxHp})`);
    assert.ok(P.maxHp > d.player.maxHp);
    assert.equal(P.hp, d.player.hp, 'the wound as saved');
    assert.equal(g.gear.equipped.weapon, 'steel_sword');
    g.murder.deserialize(d.murder);
    assert.ok(g.murder.isDead('garrick'), 'Garrick is still dead');
    if (d.party) {
      g.party.deserialize(d.party);
      assert.equal(g.party.holderId, 'bram', 'Bram still walks with you');
    }
    if (d.plugins?.unkindle) {
      unk.deserialize(d.plugins.unkindle);
      assert.equal(unk.learned, true);
      assert.equal(Math.round(unk.coldfire.bar), 40, 'the soul bar');
    }
    // Free on and off, Reset and the chapel's respec stay exact on it.
    const pr = g.progression;
    pr.startFree();
    pr.spend('grace', 300);
    pr.endFree();
    assert.deepEqual(pr.points, pts, 'Free off gives back the real points');
    assert.ok(pr.resetPoints().ok !== false);
    assert.equal(pr.spent(), 0);
    assert.equal(pr.unspent(), 42);
    pr.spend('weave', 42);
    P.inventory.add('coin', 500);
    const before = P.inventory.count('coin');
    const r = pr.respec();
    assert.ok(r.ok, r.reason);
    assert.equal(before - P.inventory.count('coin'), r.cost);
    assert.equal(pr.unspent(), 42);
  });
}
