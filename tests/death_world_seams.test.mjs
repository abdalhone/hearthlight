import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, placeAt, wolf, villagers } from './survival_world.mjs';
import { TILE } from '../src/core/constants.js';
import { T } from '../src/world/tiles.js';

// Where the heavier death (§27) meets the wider world (§32), found by playing the merge
// (r14a verify): falling in Bracken Ford left the blood on the water and would have laid
// the ember-ring in the ford, because only deep water counted as water; and a body Rowan
// carried most of the way home before it died had its ring "on Bracken Ford" in the
// waking words while the embers lay on the road by the vale.

function alone(g) {
  g.survival.alert = () => {};
  g.survival.patrol = () => {};
  g.survival.lyraForVillager = () => {};
  for (const v of villagers(g)) {
    placeAt(g, v, 141 * TILE, 101 * TILE);
    v.think = () => {};
  }
  const L = g.companion;
  placeAt(g, L, 141 * TILE, 99 * TILE);
  L.behavior.setDirective({ type: 'stay', x: L.x, y: L.y });
}

function fordTile(g) {
  const c = g.locations.get('bracken_ford').center;
  const cx = Math.floor(c.x / TILE);
  const cy = Math.floor(c.y / TILE);
  for (let r = 0; r < 20; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) if (g.map.tileAt(cx + dx, cy + dy) === T.SHALLOWS) return { tx: cx + dx, ty: cy + dy };
  return null;
}

function setCoins(P, n) {
  P.inventory.remove('coin', P.inventory.count('coin'));
  P.inventory.add('coin', n);
}

function goDown(g) {
  const P = g.player;
  P.invuln = 0;
  const w = wolf(g, P.x + 12, P.y);
  g.combat.damage(w, P, 999);
  w.removed = true;
  return g.survival.fallOf(P);
}

test('a ford is water to the fallen: pulled to the bank soaked, no blood left on the water, the ember-ring on dry ground', async () => {
  const g = makeGame({ hour: 14, settings: { deathMode: 'home' } });
  alone(g);
  const f = fordTile(g);
  assert.ok(f, 'Bracken Ford has its shallows');
  assert.equal(g.map.isWet(f.tx, f.ty), true, 'the ford is wet ground');
  assert.equal(g.map.isWater(f.tx, f.ty), false, 'but not deep water (you can walk it)');
  const P = g.player;
  placeAt(g, P, f.tx * TILE + 8, f.ty * TILE + 8);
  setCoins(P, 30);
  const rec = goDown(g);
  assert.ok(rec, 'down');
  assert.equal(rec.wet, true, 'cold and soaked');
  assert.equal(g.map.isWet(Math.floor(P.x / TILE), Math.floor(P.y / TILE)), false, 'the body lies on the bank');
  for (const m of g.survival.trail.marks) assert.equal(g.map.isWet(Math.floor(m.x / TILE), Math.floor(m.y / TILE)), false, 'no blood on the water');
  assert.equal(g.survival.trail.smear(f.tx * TILE + 8, f.ty * TILE + 8, 1, 0), null, 'the ford takes a smear');
  step(g, rec.window + 2, 0.1);
  await g.survival.pending;
  const ring = g.survival.ring;
  assert.ok(ring && ring.coins === 30, 'the coins stayed');
  assert.equal(g.map.isWet(Math.floor(ring.x / TILE), Math.floor(ring.y / TILE)), false, 'the embers lie on dry ground');
});

test('carried most of the way home and died on the road: the waking words name where the embers really lie', async () => {
  const g = makeGame({ hour: 14, settings: { deathMode: 'home' } });
  alone(g);
  const P = g.player;
  const m = g.locations.get('south_meadow').center;
  placeAt(g, P, m.x, m.y);
  setCoins(P, 44);
  const rec = goDown(g);
  assert.ok(rec, 'down in the meadow');
  assert.match(rec.where, /meadow/i);
  // Someone carried the body off toward the sickroom and it died on the way, in the square.
  const sq = g.locations.get('town_square').center;
  placeAt(g, P, sq.x, sq.y + 8);
  step(g, rec.window + 2, 0.1);
  await g.survival.pending;
  const ring = g.survival.ring;
  assert.ok(ring && Math.hypot(ring.x - sq.x, ring.y - sq.y) < 40, 'the embers are where the body was when it died');
  assert.doesNotMatch(ring.where, /meadow/i, 'not named for where they fell');
  const words = g.toasts.map((t) => t.text).join(' | ');
  assert.match(words, /44 coins, lies where you died/, 'the words say where you died');
  assert.doesNotMatch(words, /lies where you fell[^|]*meadow/i);
  // Dying where you fell still says so.
  const g2 = makeGame({ hour: 14, settings: { deathMode: 'home' } });
  alone(g2);
  placeAt(g2, g2.player, m.x, m.y);
  setCoins(g2.player, 12);
  const r2 = goDown(g2);
  step(g2, r2.window + 2, 0.1);
  await g2.survival.pending;
  assert.match(g2.toasts.map((t) => t.text).join(' | '), /12 coins, lies where you fell, in .*Meadow/i);
});
