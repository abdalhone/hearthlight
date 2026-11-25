// Strike and heavy spells break things (DESIGN §31.3) and the training dummy works (§31.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE, DAY_SECONDS } from '../src/core/constants.js';
import { ObjectManager, makeObject } from '../src/world/objects.js';
import { BREAKABLE, MEND, TRAIN_DAY, breakSpec, strikeProp } from '../src/world/breakables.js';
import { FALL_SECONDS } from '../src/world/broken.js';
import { makeGame, step, resetArena, W, H } from './magic_helpers.mjs';

// The arena's step plus the world's objects (falling trees, regrowth, mending).
function run(g, seconds, dt = 1 / 60) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    step(g, dt);
    g.objects?.update?.(dt);
  }
}

function world(opts = {}) {
  const g = makeGame({ foes: 0, ...opts });
  g.objects = new ObjectManager(g, W, H);
  g.numbers = [];
  g.bubbles = { number: (x, y, text) => g.numbers.push(String(text)) };
  g.magic.unlockAll();
  resetArena(g);
  return g;
}

function put(g, d) {
  return g.objects.add(makeObject(g, d));
}

const pickups = (g, id) => g.entities.all().filter((e) => e.type === 'pickup' && !e.removed && (!id || e.itemId === id));
const cast = (g, weave, at, opts = {}) => {
  g.magic.resetCooldowns();
  const r = g.magic.cast(g.player, weave, at, { free: true, ...opts });
  assert.ok(r.ok, `${weave.shape}: ${r.reason || ''}`);
  return r;
};

test('a Strike fells a tree: it goes over, leaves its stump and logs, and grows back', () => {
  const g = world({ party: false });
  const p = g.player;
  const tree = put(g, { objType: 'tree', tx: 11, ty: 15, kind: 'oak' });
  assert.ok(g.objects.isBlockingTile(11, 15), 'a standing tree blocks');
  cast(g, { shape: 'strike', essences: ['raw'] }, { x: tree.x, y: tree.y - 8 });
  run(g, 0.4);
  assert.equal(tree.state.depleted, true, 'felled at a blow');
  assert.equal(tree.isStump, true, 'a stump stands where it grew');
  assert.equal(pickups(g, 'wood').length, 0, 'still falling');
  p.x -= 80; // step back, out of the pickups' pull
  run(g, FALL_SECONDS);
  const logs = pickups(g, 'wood');
  assert.ok(logs.length >= 2, `logs to pick up (${logs.length})`);
  for (const l of logs) assert.ok(Math.abs(l.y - tree.y) < 12 && Math.abs(l.x - tree.x) > 6, `lying along the fallen trunk (${l.x - tree.x}, ${l.y - tree.y})`);
  // A day later it stands again.
  g.clock.t += DAY_SECONDS + 1;
  run(g, 0.1);
  assert.equal(tree.state.depleted, false, 'grown back');
  void p;
});

test('small weaves chip: damage builds up until a tree falls; a bomb breaks at once', () => {
  const g = world({ party: false });
  const p = g.player;
  const tree = put(g, { objType: 'tree', tx: 16, ty: 15, kind: 'pine' });
  let bolts = 0;
  while (!tree.state.depleted && bolts < 20) {
    cast(g, { shape: 'bolt', essences: ['raw'] }, { x: tree.x, y: tree.y - 8 });
    run(g, 0.5);
    bolts++;
    if (bolts === 1) assert.equal(tree.state.depleted, false, 'one bolt only chips it');
  }
  assert.ok(tree.state.depleted, 'enough bolts fell it');
  assert.ok(bolts >= 4 && bolts <= 9, `${bolts} bolts`);
  // A bomb on a barrel: one blow.
  const barrel = put(g, { objType: 'barrel', tx: 14, ty: 18, solid: true, low: true });
  cast(g, { shape: 'throw', essences: ['raw'] }, { x: barrel.x, y: barrel.y - 8 });
  run(g, 1.5);
  assert.equal(barrel.state.broken, true, 'a heavy blow breaks it');
  void p;
});

test('a broken fence is walkable debris, saved, its neighbours lose the rail, and it is mended', () => {
  const g = world({ party: false });
  const fences = [11, 12, 13].map((x) => put(g, { objType: 'fence', tx: x, ty: 12, solid: true, low: true, name: 'Fence', variant: '10', sprite: 'prop:fence:10' }));
  const mid = fences[1];
  cast(g, { shape: 'strike', essences: ['raw'] }, { x: mid.x, y: mid.y - 8 });
  g.player.x = mid.x;
  g.player.y = mid.y + 14;
  g.player.faceDir('up');
  cast(g, { shape: 'strike', essences: ['raw'] }, { x: mid.x, y: mid.y - 8 });
  run(g, 0.5);
  assert.equal(mid.state.broken, true);
  assert.equal(g.objects.isBlockingTile(12, 12), false, 'debris is walked over');
  assert.equal(fences[0].sprite, 'prop:fence:0', 'the left post no longer reaches for it');
  assert.equal(fences[2].sprite, 'prop:fence:0', 'nor the right');
  assert.equal(mid.canInteract?.(g.player) ?? false, false);
  // Saved: the manager writes it out and a fresh world reads it back.
  const saved = JSON.parse(JSON.stringify(g.objects.serialize()));
  const g2 = world({ party: false });
  const again = [11, 12, 13].map((x) => put(g2, { objType: 'fence', tx: x, ty: 12, solid: true, low: true, name: 'Fence', variant: '10', sprite: 'prop:fence:10' }));
  g2.objects.deserialize(saved);
  assert.equal(again[1].state.broken, true, 'still broken after a load');
  assert.equal(again[0].sprite, 'prop:fence:0', 'rails redrawn after a load');
  // Mended two days on.
  g.player.x = 5 * TILE;
  g.clock.t += MEND + 1;
  run(g, 0.1);
  assert.equal(mid.state.broken, false, 'mended');
  assert.ok(g.objects.isBlockingTile(12, 12));
  assert.equal(fences[0].sprite, 'prop:fence:2');
});

test('what never breaks: story things, the notice board, beds, lamps, and anything behind a wall', () => {
  const g = world({ party: false });
  const looks = put(g, { objType: 'barrel', tx: 12, ty: 14, solid: true, low: true, text: "The Holloways' barrels.", name: "Holloways' barrels" });
  const board = put(g, { objType: 'sign', id: 'notice_board', tx: 12, ty: 16, variant: 'board', title: 'Notices', text: 'x', solid: true });
  const bed = put(g, { objType: 'bed', id: 'bed_t', footprint: { x: 11, y: 17, w: 1, h: 2 }, owner: 'player' });
  const lamp = put(g, { objType: 'lamp', tx: 9, ty: 13 });
  for (const o of [looks, board, bed, lamp]) assert.equal(breakSpec(o), null, `${o.objType} is not breakable`);
  cast(g, { shape: 'nova', essences: ['raw'] }, { x: g.player.x, y: g.player.y });
  run(g, 0.6);
  assert.ok(!looks.state.broken && !board.state.broken, 'untouched');
  // A barrel just past a wall, inside a nova's reach: the wall shelters it.
  const base = g.map.blocksProjectile;
  const wall = (tx, ty) => base(tx, ty) || (tx === 12 && ty >= 18 && ty <= 22);
  g.map.blocksProjectile = wall;
  const sheltered = put(g, { objType: 'barrel', tx: 13, ty: 20, solid: true, low: true });
  g.player.x = 11 * TILE + 4;
  g.player.y = 20 * TILE + 8;
  for (let i = 0; i < 4; i++) {
    cast(g, { shape: 'nova', essences: ['raw'] }, { x: g.player.x, y: g.player.y });
    run(g, 0.6);
  }
  assert.equal(sheltered.state.broken, undefined, 'never through a wall');
  assert.equal(sheltered._dmg ?? 0, 0);
});

test("only the player's blows break things; Lyra's strike passes over a fence", () => {
  const g = world();
  const lyra = g.companion;
  const fence = put(g, { objType: 'fence', tx: 8, ty: 11, solid: true, low: true });
  g.magic.resetCooldowns();
  g.magic.cast(lyra, { shape: 'strike', essences: ['raw'] }, { x: fence.x, y: fence.y - 8 }, { free: true });
  run(g, 0.5);
  assert.ok(!fence.state.broken && !(fence._dmg > 0));
  assert.equal(strikeProp(g, fence, { source: lyra, amount: 999 }), false);
});

test('a beam stops at the tree it meets and burns it down', () => {
  const g = world({ party: false });
  const p = g.player;
  const tree = put(g, { objType: 'tree', tx: 14, ty: 15, kind: 'oak' });
  const behind = put(g, { objType: 'barrel', tx: 17, ty: 15, solid: true, low: true });
  const m = g.magic;
  m.resetCooldowns();
  const r = m.castStart(p, { shape: 'beam', essences: ['raw'] }, { x: behind.x, y: behind.y - 8 }, { free: true });
  assert.ok(r.ok, r.reason);
  let t = 0;
  while (!tree.state.depleted && t < 8) {
    m.castHold(p, { x: behind.x, y: behind.y - 8 });
    run(g, 0.1);
    t += 0.1;
  }
  assert.ok(tree.state.depleted, `burnt through in ${t.toFixed(1)} s`);
  assert.ok(t > 1, 'it takes a while');
  assert.ok(!(behind._dmg > 0), 'the barrel behind it was sheltered meanwhile');
  m.castRelease(p, { x: behind.x, y: behind.y - 8 });
});

test('the sword chips and breaks a crate, but leaves trees and rocks to the axe and the pick', () => {
  const g = world({ party: false });
  const p = g.player;
  p.atk = 6;
  const crate = put(g, { objType: 'crate', tx: 10, ty: 14, solid: true, low: true });
  p.faceDir('up');
  let swings = 0;
  while (!crate.state.broken && swings < 20) {
    p._meleeReadyAt = 0;
    g.combat.melee(p, { range: 22, arc: 2.1, cooldown: 0 });
    swings++;
  }
  assert.ok(crate.state.broken, 'broken by the blade');
  assert.ok(swings >= 2, `${swings} swings`);
  const tree = put(g, { objType: 'tree', tx: 10, ty: 16, kind: 'oak' });
  p.faceDir('down');
  for (let i = 0; i < 20; i++) {
    p._meleeReadyAt = 0;
    g.combat.melee(p, { range: 22, arc: 2.1, cooldown: 0, heavy: true });
  }
  assert.equal(tree.state.depleted, false);
  assert.ok(!(tree._dmg > 0));
});

test('the training dummy takes the sword and every weave, shows each hit, teaches XP, never breaks', () => {
  const g = world({ party: false });
  const p = g.player;
  p.atk = 5;
  p.level = 1;
  p.xp = 0;
  const dummy = put(g, { objType: 'dummy', tx: 10, ty: 14, solid: true, low: true, name: 'Training dummy', text: 'A battered training dummy.' });
  assert.ok(breakSpec(dummy)?.training, 'a training target, though it has a story line');
  p.faceDir('up');
  const xp0 = p.xp;
  for (let i = 0; i < 3; i++) {
    p._meleeReadyAt = 0;
    g.combat.melee(p, { range: 20, arc: 1.8, cooldown: 0 });
  }
  const nums = g.numbers.filter((n) => /^\d+!?$/.test(n));
  assert.equal(nums.length, 3, `a number for every sword hit (${g.numbers.join(', ')})`);
  assert.equal(p.xp - xp0 + (p.level - 1) * 0, 3, 'one training XP a blow');
  assert.ok(g.numbers.some((n) => /^\+\d+ xp$/.test(n)), 'the xp shows');
  // A bolt lands on it too, with its number.
  g.numbers.length = 0;
  cast(g, { shape: 'bolt', essences: ['fire'] }, { x: dummy.x, y: dummy.y - 8 });
  run(g, 0.4);
  assert.ok(g.numbers.some((n) => /^\d+!?$/.test(n)), `the bolt's number shows (${g.numbers.join(', ')})`);
  // A Strike neither breaks it nor knocks it over.
  cast(g, { shape: 'strike', essences: ['earth'] }, { x: dummy.x, y: dummy.y - 8 });
  run(g, 0.5);
  assert.ok(!dummy.state.broken && !dummy.removed);
  assert.ok(g.objects.isBlockingTile(10, 14));
  // The day's lesson has an end.
  for (let i = 0; i < TRAIN_DAY + 20; i++) strikeProp(g, dummy, { source: p, amount: 5 });
  const given = dummy.state.xpGiven;
  assert.equal(given, TRAIN_DAY, 'capped for the day');
  g.clock.t += DAY_SECONDS;
  strikeProp(g, dummy, { source: p, amount: 5 });
  assert.equal(dummy.state.xpGiven, 1, 'a new day, a new lesson');
});

test('every breakable kind has a toughness; the dummy alone is a training target', () => {
  for (const [k, s] of Object.entries(BREAKABLE)) {
    if (k === 'dummy') assert.ok(s.training);
    else assert.ok(s.hp > 0, k);
  }
});
