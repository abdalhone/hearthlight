// Hits stun (DESIGN §31.2): every weave and sword hit makes its target flinch; heavy and
// charged blows make it reel; a beam pins (a heavy slow while the ray is on it); bosses
// shrug off the flinch, reel briefly and are pinned less; nobody is held forever.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE } from '../src/core/constants.js';
import { makeGame, run, step, resetArena } from './magic_helpers.mjs';

// A foe that always tries to walk east (away from the player), like a deer fleeing.
function runner(g, foe) {
  foe.controller = {
    update(a) {
      a.moveIntent.x = 1;
      a.moveIntent.y = 0;
    },
  };
  foe.speed = 60;
  return foe;
}

function setup(opts = {}) {
  const g = makeGame({ foes: 1, party: false, ...opts });
  g.magic.unlockAll();
  resetArena(g);
  const foe = g.foes[0];
  foe.x = g.player.x + 40;
  foe.y = g.player.y;
  return { g, m: g.magic, p: g.player, foe };
}

test('a bolt makes its target flinch: it stops for a heartbeat, then runs on', () => {
  const { g, m, p, foe } = setup();
  runner(g, foe);
  run(g, 0.2);
  const x0 = foe.x;
  assert.ok(x0 > p.x + 40, 'it was walking off');
  m.cast(p, { shape: 'bolt', essences: ['raw'] }, { x: foe.x + 4, y: foe.y }, { free: true });
  let hitAt = -1;
  let t = 0;
  for (let i = 0; i < 60 && hitAt < 0; i++) {
    step(g);
    t += 1 / 60;
    if (foe.hp < foe.maxHp) hitAt = t;
  }
  assert.ok(hitAt > 0, 'the bolt landed');
  assert.ok(m.status.has(foe, 'flinch'), 'flinching');
  assert.equal(foe.statusFlags.disabled, true);
  // Its own legs stop (a blow with no push, to measure only the walking).
  resetArena(g);
  runner(g, foe);
  run(g, 0.2);
  g.combat.damage(p, foe, 1, { kind: 'melee', knockback: 0 });
  const xs = foe.x;
  run(g, 0.2);
  assert.ok(Math.abs(foe.x - xs) < 1, `held in place while it flinches (moved ${foe.x - xs})`);
  run(g, 0.4);
  assert.ok(foe.x > xs + 10, `then off again (moved ${foe.x - xs})`);
});

test('a flurry never holds a foe forever: the flinch leaves windows to act', () => {
  const { g, m, p, foe } = setup();
  runner(g, foe);
  let disabled = 0;
  const steps = 180;
  for (let i = 0; i < steps; i++) {
    // A hit every 0.1 s straight from the combat rules (a sword flurry, a bolt storm).
    if (i % 6 === 0) g.combat.damage(p, foe, 1, { kind: 'melee', knockback: 0 });
    step(g);
    if (foe.statusFlags?.disabled) disabled++;
  }
  const share = disabled / steps;
  assert.ok(share > 0.35, `stunned for a good part of it (${share.toFixed(2)})`);
  assert.ok(share < 0.75, `but never the whole time (${share.toFixed(2)})`);
  void m;
});

test('the sword finisher and a charged weave make a foe reel; a plain hit only flinches', () => {
  const { g, m, p, foe } = setup();
  g.combat.damage(p, foe, 2, { kind: 'melee', heavy: true });
  assert.ok(m.status.has(foe, 'reeling'), 'a heavy blow: reeling');
  assert.ok(!m.status.has(foe, 'flinch'));
  const r = m.status.get(foe, 'reeling');
  assert.ok(r.t >= 0.55, `reels for a while (${r.t})`);
  resetArena(g);
  g.combat.damage(p, foe, 2, { kind: 'magic', magic: true, charge: 0.8 });
  assert.ok(m.status.has(foe, 'reeling'), 'charged past half: reeling');
  resetArena(g);
  g.combat.damage(p, foe, 2, { kind: 'magic', magic: true, charge: 0.2 });
  assert.ok(m.status.has(foe, 'flinch') && !m.status.has(foe, 'reeling'), 'a light charge only flinches');
  // A reel sets off no earth reactions (it is not Stone's stagger).
  resetArena(g);
  m.status.apply(foe, 'soaked', { src: p });
  g.combat.damage(p, foe, 2, { kind: 'melee', heavy: true });
  assert.ok(m.status.has(foe, 'soaked'), 'no mud from a sword');
});

test('a beam pins whoever it holds: a fleeing foe crawls while the ray is on it', () => {
  const { g, m, p, foe } = setup();
  runner(g, foe);
  // Unbeamed: how far it gets in a second.
  run(g, 0.1);
  let x0 = foe.x;
  run(g, 1);
  const free = foe.x - x0;
  resetArena(g);
  runner(g, foe);
  foe.x = p.x + 30;
  foe.y = p.y;
  const r = m.castStart(p, { shape: 'beam', essences: ['raw'] }, { x: foe.x + 200, y: foe.y }, { free: true });
  assert.ok(r.ok, r.reason);
  run(g, 0.3);
  assert.ok(m.status.has(foe, 'pinned'), 'pinned by the ray');
  x0 = foe.x;
  for (let i = 0; i < 60; i++) {
    m.castHold(p, { x: foe.x + 200, y: foe.y });
    step(g);
  }
  const held = foe.x - x0;
  assert.ok(held < free * 0.5, `crawls under the beam (${held.toFixed(1)} px vs ${free.toFixed(1)} px free)`);
  m.castRelease(p, { x: foe.x + 200, y: foe.y });
  run(g, 0.6);
  assert.ok(!m.status.has(foe, 'pinned'), 'free a moment after the ray leaves');
});

test('bosses shrug off the flinch, reel briefly and are pinned less', () => {
  const { g, m, p, foe } = setup();
  foe.superArmor = true;
  foe.boss = true;
  g.combat.damage(p, foe, 2, { kind: 'melee' });
  assert.ok(!m.status.has(foe, 'flinch'), 'no flinch on a boss');
  foe.invuln = 0;
  g.combat.damage(p, foe, 2, { kind: 'melee', heavy: true });
  const r = m.status.get(foe, 'reeling');
  assert.ok(r, 'a heavy blow still tells');
  assert.ok(r.t < 0.3, `but only briefly (${r.t.toFixed(2)} s)`);
  run(g, 0.4);
  g.combat.damage(p, foe, 2, { kind: 'melee', heavy: true });
  assert.ok(!m.status.has(foe, 'reeling'), 'and not again at once (immunity)');
  foe.invuln = 0;
  g.combat.damage(p, foe, 1, { kind: 'magic', magic: true, noStagger: true, pin: true });
  const pin = m.status.get(foe, 'pinned');
  assert.ok(pin && foe.statusFlags.moveMul > 0.45, `pinned less (move x${foe.statusFlags.moveMul.toFixed(2)})`);
});

test('without the Weave, combat keeps its brief hurt pose', async () => {
  const { EventBus } = await import('../src/core/events.js');
  const { EntityManager } = await import('../src/entities/manager.js');
  const { Actor } = await import('../src/entities/entity.js');
  const { Combat } = await import('../src/entities/combat.js');
  const g = { bus: new EventBus(), clock: { t: 0 }, map: { blocksProjectile: () => false }, isBlockedTile: () => false, particles: { emit() {} }, bubbles: { number() {} }, audio: { play() {} }, camera: { shake() {} }, lighting: { flash() {} } };
  g.entities = new EntityManager(g);
  g.combat = new Combat(g);
  g.combat.random = () => 0.5;
  const a = g.entities.add(new Actor(g, { x: 10 * TILE, y: 10 * TILE, faction: 'player' }));
  const b = g.entities.add(new Actor(g, { x: 10 * TILE + 10, y: 10 * TILE, faction: 'monster' }));
  g.combat.damage(a, b, 3, { kind: 'melee' });
  assert.equal(b.state, 'hurt');
  assert.ok(b.lockTime > 0.15);
});
