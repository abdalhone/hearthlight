// Casting stops you (round 14b follow-up, plan §14; DESIGN §38.6). The author: "I can move
// while I'm doing spells; it should stop me." A tap cast plants you for the cast pose (by the
// weave's weight); charging and a beam hold you still for as long as they last (castMoveMul
// 0), the stick only turning you; a roll breaks a charge (free) or the plant; after the
// plant you walk on at full speed; the same rule for every weaver who casts through
// game.magic, and no NPC weaver glides.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step as magicStep, run, AIM } from './magic_helpers.mjs';
import { fakeInput } from './survival_world.mjs';
import { Player } from '../src/entities/player.js';
import { Actor } from '../src/entities/entity.js';
import { compileWeave } from '../src/magic/compile.js';
import * as BAL from '../src/magic/balance.js';
import { STAND_LINE } from '../src/ui/coach.js';
import { STAND_NOTE } from '../src/ui/spellbook.js';
import { CONTROLS } from '../src/ui/content.js';

// The Weave's arena with the real Player (its own walk, roll and plant) and a fake input.
function arena() {
  const g = makeGame({ foes: 1, log: true });
  const old = g.player;
  const P = new Player(g, { x: old.x, y: old.y });
  g.entities.list[g.entities.list.indexOf(old)] = P;
  g.entities.byId.set('player', P);
  g.player = P;
  g.input = fakeInput();
  g.magic.unlockAll();
  g.magic.addMaxMana(300);
  g.magic.mana.cur = g.magic.mana.max;
  g.magic.setSlot(0, { shape: 'bolt', essences: ['raw'] });
  g.magic.setSlot(1, { shape: 'beam', essences: ['raw'] });
  // Foes out of the way (the tests watch the feet, not the fight).
  for (const f of g.foes) {
    f.x = 36 * 16;
    f.y = 4 * 16;
  }
  return { g, P, m: g.magic };
}

function step(g, dt = 1 / 60) {
  magicStep(g, dt);
  g.input.endFrame();
}

function walk(g, seconds) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) step(g);
}

const speedOf = (P) => Math.hypot(P.vel.x, P.vel.y);

test('the plant times: by the shape\'s weight, its prices and its cost, in 0.24-0.4 s, shorter with cast speed; a dash is its own motion', () => {
  const bolt = BAL.plantFor(compileWeave({ shape: 'bolt', essences: ['raw'] }));
  const rain = BAL.plantFor(compileWeave({ shape: 'rain', essences: ['raw'] }));
  const bind = BAL.plantFor(compileWeave({ shape: 'bind', essences: ['raw'] }));
  assert.ok(Math.abs(bolt - 0.24) < 0.011, `a Spark is a flick: ${bolt}`);
  assert.ok(rain > bind && bind > bolt, `heavier plants longer: ${bolt} < ${bind} < ${rain}`);
  for (const shape of ['bolt', 'blast', 'strike', 'throw', 'nova', 'orb', 'summon', 'rune', 'rain', 'wall', 'bind', 'ward', 'beam']) {
    const t = BAL.plantFor(compileWeave({ shape, essences: ['raw'] }));
    assert.ok(t >= BAL.PLANT_MIN - 1e-9 && t <= BAL.PLANT_MAX + 1e-9, `${shape}: ${t}`);
  }
  const priced = BAL.plantFor(compileWeave({ shape: 'bolt', essences: ['raw'], prices: ['bloodprice'] }));
  assert.ok(priced > bolt, `a costlier price plants longer: ${priced} > ${bolt}`);
  assert.ok(BAL.plantFor(compileWeave({ shape: 'blast', essences: ['raw'] }), 1.5) < BAL.plantFor(compileWeave({ shape: 'blast', essences: ['raw'] })), 'quick hands plant shorter');
  assert.ok(BAL.plantFor(compileWeave({ shape: 'rain', essences: ['raw'] }), 9) >= BAL.PLANT_FLOOR, 'never under the floor');
  assert.equal(BAL.plantFor(compileWeave({ shape: 'dash', essences: ['raw'] })), 0);
});

test('a tap cast while running plants you for the pose, then you run on at full speed', () => {
  const { g, P, m } = arena();
  g.input.move = { x: 1, y: 0 };
  walk(g, 0.6);
  const full = speedOf(P);
  assert.ok(full > P.speed * 0.95, `running at full speed (${full.toFixed(1)} of ${P.speed})`);
  // A tap: the press, a frame or so, the release (as the weave button does it).
  const x0 = P.x;
  assert.ok(m.castStart(P, 0, { x: P.x + 200, y: P.y }, { charge: true }).ok);
  step(g);
  step(g);
  const r = m.castRelease(P, { x: P.x + 200, y: P.y });
  assert.ok(r.ok, r.message);
  assert.ok(P.castPlantT > 0.2, `planted for the pose (${P.castPlantT})`);
  assert.equal(m.castingState(P), 'plant');
  let moved = 0;
  while (P.castPlantT > 0) {
    step(g);
    moved = Math.max(moved, Math.abs(P.x - x0));
  }
  assert.ok(moved < 0.5, `no step, no drift while planted (moved ${moved.toFixed(2)} px with the stick held)`);
  // Then on: back to full speed within the usual acceleration.
  walk(g, 0.4);
  assert.ok(P.x - x0 > 20, 'running again');
  assert.ok(speedOf(P) > P.speed * 0.95, `full speed again (${speedOf(P).toFixed(1)})`);
  assert.ok(Math.abs(P.castMoveMul - 1) < 1e-9);
  // The Unkindling's hold is a channel too (soul plants you by its own lock).
  g.unkindle = { channel: { phase: 'pull' } };
  assert.equal(m.castingState(P), 'channel');
  g.unkindle.channel.phase = 'slip';
  assert.equal(m.castingState(P), null, 'slipping free: you may move again');
});

test('a charge holds you still the whole time; the stick only turns you (and the aim that follows your facing)', () => {
  const { g, P, m } = arena();
  P.facing = { x: 1, y: 0 };
  const x0 = P.x;
  const y0 = P.y;
  assert.ok(m.castStart(P, 0, { x: P.x + 150, y: P.y, auto: true }, { charge: true }).ok);
  g.input.move = { x: 0, y: -1 }; // push up the whole charge
  let moved = 0;
  for (let i = 0; i < 70; i++) {
    step(g);
    moved = Math.max(moved, Math.hypot(P.x - x0, P.y - y0));
  }
  assert.equal(m.castingState(P), 'charge');
  assert.ok(m.holdOf(P).k > 0.3, 'it gathered');
  assert.ok(moved < 0.5, `charging: no walk (moved ${moved.toFixed(2)} px)`);
  assert.equal(P.castMoveMul, 0);
  assert.ok(P.facing.y < -0.9, 'the stick turned you to face up');
  assert.equal(P.dir, 'up');
  // Let it go: a plant, then the walk comes back.
  m.castRelease(P);
  assert.ok(P.castPlantT > 0);
  while (P.castPlantT > 0) step(g);
  assert.ok(Math.hypot(P.x - x0, P.y - y0) < 0.5, 'still planted until the pose ends');
  walk(g, 0.4);
  assert.ok(y0 - P.y > 20, 'walking up after it');
});

test('a beam pours with you standing; letting go plants you briefly; then you walk', () => {
  const { g, P, m } = arena();
  const x0 = P.x;
  const s = m.castStart(P, 1, { x: P.x + 120, y: P.y }, { charge: true });
  assert.ok(s.ok, s.message);
  assert.equal(s.mode, 'hold');
  g.input.move = { x: -1, y: 0 };
  let moved = 0;
  for (let i = 0; i < 48; i++) {
    step(g);
    moved = Math.max(moved, Math.abs(P.x - x0));
  }
  assert.equal(m.castingState(P), 'beam');
  assert.ok(moved < 0.5, `pouring: no walk (moved ${moved.toFixed(2)} px)`);
  m.castRelease(P);
  walk(g, 0.7);
  assert.ok(x0 - P.x > 20, 'walking after the beam');
});

test('a roll breaks a charge (free, no cooldown) and you roll; a roll breaks the plant too', () => {
  const { g, P, m } = arena();
  assert.ok(m.castStart(P, 0, AIM, { charge: true }).ok);
  walk(g, 0.6);
  assert.equal(m.holdOf(P).live, true);
  const mana = m.mana.cur;
  const x0 = P.x;
  g.input.move = { x: 1, y: 0 };
  g.input.press('dodge');
  step(g);
  assert.equal(P.rolling, true, 'the roll went');
  assert.equal(m.holdOf(P), null, 'the charge broke');
  assert.equal(m.mana.cur >= mana, true, 'a broken charge costs nothing');
  assert.equal(m.cooldownLeft(0), 0, 'and starts no cooldown');
  assert.ok(g.events.some((e) => e.type === 'cast_broken' && e.payload.why === 'roll' && e.payload.held), 'cast_broken');
  walk(g, 0.4);
  assert.ok(P.x - x0 > 15, `rolled away (${(P.x - x0).toFixed(1)} px)`);
  // The plant: a tap, then a roll at once.
  g.input.move = { x: 0, y: 0 };
  walk(g, 0.6);
  m.cast(P, 0, AIM);
  assert.ok(P.castPlantT > 0);
  const x1 = P.x;
  g.input.move = { x: -1, y: 0 };
  g.input.press('dodge');
  step(g);
  assert.equal(P.rolling, true);
  assert.equal(P.castPlantT, 0);
  walk(g, 0.3);
  assert.ok(x1 - P.x > 15, 'rolled out of the plant');
});

test('the stick pushing against the stance asks the coach once: "You stand still to weave. Roll to break off."', () => {
  const { g, P, m } = arena();
  const hints = [];
  g.bus.on('cast_stand', (p) => hints.push(p));
  m.castStart(P, 0, AIM, { charge: true });
  g.input.move = { x: 1, y: 0 };
  walk(g, 0.8);
  m.castCancel(P);
  m.castStart(P, 0, AIM, { charge: true });
  walk(g, 0.8);
  assert.equal(hints.length, 1, 'once');
  assert.equal(hints[0].state, 'charge');
  assert.equal(STAND_LINE, 'You stand still to weave. Roll to break off.');
  assert.equal(STAND_NOTE, STAND_LINE, 'the Spellbook says the same');
  const row = CONTROLS.find((c) => c.id === 'weave');
  assert.ok(/stand still to weave/i.test(row.keys) && /stand still to weave/i.test(row.touch) && /roll to break off/i.test(row.touch));
});

test('every weaver through game.magic: an NPC caster is planted by the pose and held still by a charge; none glides', () => {
  const g = makeGame({ foes: 1 });
  const m = g.magic;
  const L = g.companion; // an Actor on the player's side, walking
  L.speed = 60;
  L.moveIntent = { x: 1, y: 0 };
  run(g, 0.3);
  const x0 = L.x;
  assert.ok(x0 > 8 * 16 + 5, 'she walks');
  // A tap through game.magic: the pose plants her (lockTime).
  const r = m.cast(L, { shape: 'bolt', essences: ['raw'] }, { x: L.x + 100, y: L.y }, { free: true });
  assert.ok(r.ok, r.message);
  assert.ok(L.lockTime >= BAL.PLANT_MIN - 0.02, `planted ${L.lockTime}`);
  const xa = L.x;
  L.moveIntent = { x: 1, y: 0 };
  run(g, 0.2);
  assert.ok(Math.abs(L.x - xa) < 0.5, `no glide while planted (${(L.x - xa).toFixed(2)} px)`);
  run(g, 0.3);
  assert.ok(L.x - xa > 5, 'walks on after');
  // A held weave (a beam) holds her still as long as it pours.
  const xb = L.x;
  const s = m.castStart(L, { shape: 'beam', essences: ['raw'] }, { x: L.x + 100, y: L.y }, { free: true });
  assert.ok(s.ok, s.message);
  for (let i = 0; i < 60; i++) {
    L.moveIntent = { x: 1, y: 0 }; // her mind keeps asking to walk
    magicStep(g);
  }
  assert.ok(Math.abs(L.x - xb) < 0.5, `held still while it pours (${(L.x - xb).toFixed(2)} px)`);
  m.castRelease(L);
  L.moveIntent = { x: 1, y: 0 };
  run(g, 0.6);
  assert.ok(L.x - xb > 5, 'walks once it is let go');
});

test('a companion or an enemy shooting a bolt stands for it (combat.shoot): no glide', () => {
  const g = makeGame({ foes: 1 });
  const L = g.companion;
  L.speed = 60;
  const foe = g.foes[0];
  L.moveIntent = { x: 0, y: 1 };
  run(g, 0.2);
  const y0 = L.y;
  g.combat.shoot(L, foe.x, foe.y, 'bolt', { target: foe });
  assert.ok(L.lockTime > 0.2);
  L.moveIntent = { x: 0, y: 1 };
  run(g, 0.2);
  assert.ok(Math.abs(L.y - y0) < 0.5, `stood to shoot (${(L.y - y0).toFixed(2)} px)`);
  const bandit = g.entities.add(new Actor(g, { id: 'archer', faction: 'bandit', x: 20 * 16, y: 20 * 16, maxHp: 20 }));
  bandit.speed = 50;
  bandit.moveIntent = { x: -1, y: 0 };
  run(g, 0.2);
  const bx = bandit.x;
  g.combat.shoot(bandit, g.player.x, g.player.y, 'arrow', { lock: 0.3 });
  run(g, 0.25);
  assert.ok(Math.abs(bandit.x - bx) < 0.5, 'the archer draws standing');
});
