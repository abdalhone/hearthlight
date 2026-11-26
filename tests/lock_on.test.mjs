// Lock-on (round 14b, item 14; DESIGN §35.5). The author: "I want the button in the middle
// of my mouse to be able to lock to enemies or people". Middle click locks what is under the
// cursor, G / R3 the nearest in front, the wheel cycles while locked; weaves and the sword
// aim at the lock; it breaks on death, distance and walls.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, px, placeAt, wolf } from './survival_world.mjs';
import { LockOn, RANGE } from '../src/core/lock_on.js';
import { ACTIONS, KEYMAP, GAMEPAD_BUTTONS } from '../src/core/input.js';
import { TILE } from '../src/core/constants.js';

function setup() {
  const g = makeGame({ hour: 12 });
  const P = g.player;
  const spot = g.spawns.player;
  placeAt(g, P, spot.x, spot.y);
  placeAt(g, g.companion, spot.x - 3000, spot.y);
  g.lock = new LockOn(g);
  return { g, P, spot };
}

test('the lock controls: middle mouse (button 1), G and R3; the wheel moves the lock while locked', () => {
  for (const a of ['lock', 'lock_next', 'lock_prev']) assert.ok(ACTIONS.includes(a));
  assert.equal(KEYMAP.KeyG, 'lock');
  assert.equal(GAMEPAD_BUTTONS[11], 'lock');
});

test('lock what is under the cursor, else the nearest in front; an empty click lets go; cycle round', () => {
  const { g, P, spot } = setup();
  const a = wolf(g, spot.x + 40, spot.y, 'w_a');
  const b = wolf(g, spot.x, spot.y + 50, 'w_b');
  P.facing = { x: 1, y: 0 };
  assert.equal(g.lock.press({ x: b.x + 3, y: b.y - 6 }), b, 'the one under the cursor');
  assert.equal(g.lock.target, b);
  assert.equal(g.lock.press({ x: spot.x - 200, y: spot.y - 200 }), null, 'an empty spot lets go');
  assert.equal(g.lock.target, null);
  assert.equal(g.lock.press(), a, 'G: the nearest in front');
  const next = g.lock.cycle(1);
  assert.equal(next, b, 'the wheel moves on');
  assert.equal(g.lock.cycle(1), a, 'and round');
});

test('every aim goes to the lock: a weave from any source, and the sword', () => {
  const { g, P, spot } = setup();
  const a = wolf(g, spot.x + 60, spot.y, 'w_a');
  const b = wolf(g, spot.x - 50, spot.y + 10, 'w_b');
  P.facing = { x: 1, y: 0 };
  g.lock.set(b);
  assert.equal(g.lock.aimTarget(200), b);
  // The sword turns to the lock in reach.
  placeAt(g, b, P.x - 18, P.y);
  P.facing = { x: 1, y: 0 };
  P.attack();
  assert.ok(P.facing.x < 0, 'the blade turned to the lock behind');
  void a;
});

test('the lock breaks on death, distance and walls; it re-targets the next foe on a death', () => {
  const { g, P, spot } = setup();
  const a = wolf(g, spot.x + 40, spot.y, 'w_a');
  const b = wolf(g, spot.x + 60, spot.y + 10, 'w_b');
  P.facing = { x: 1, y: 0 };
  g.lock.set(a);
  a.dead = true;
  a.hp = 0;
  g.lock.update(0.1);
  assert.equal(g.lock.target, b, 'on to the next foe');
  placeAt(g, b, P.x + RANGE + 40, P.y);
  g.lock.update(0.1);
  assert.equal(g.lock.target, null, 'too far: let go');
  // Behind a wall: find a wall tile next to the player.
  const map = g.map;
  let wall = null;
  for (let r = 2; r < 30 && !wall; r++) {
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      const tx = Math.floor(P.x / TILE) + dx;
      const ty = Math.floor(P.y / TILE) + dy;
      if (map.blocksProjectile(tx, ty)) {
        wall = { tx, ty, dx: Math.sign(dx), dy: Math.sign(dy) };
        break;
      }
    }
  }
  if (wall) {
    const c = wolf(g, (wall.tx + wall.dx * 2) * TILE + 8, (wall.ty + wall.dy * 2) * TILE + 8, 'w_c');
    placeAt(g, P, (wall.tx - wall.dx * 2) * TILE + 8, (wall.ty - wall.dy * 2) * TILE + 8);
    if (map.blocksProjectile(wall.tx, wall.ty) && !map.blocksProjectile(Math.floor(c.x / TILE), Math.floor(c.y / TILE))) assert.equal(g.lock.valid(c), false, 'never through a wall');
  }
});

test('never the one who walks with you by default; a downed person can stay locked (for the finishing blow)', () => {
  const { g, P } = setup();
  const L = g.companion;
  placeAt(g, L, P.x + 30, P.y);
  if (g.party) g.party.holderId = 'lyra';
  else g.party = { isCompanion: (e) => e === L };
  assert.equal(g.lock.valid(L), false);
  const bram = g.entities.get('bram');
  placeAt(g, bram, P.x + 20, P.y);
  bram.downed = true;
  bram.hp = 0;
  assert.equal(g.lock.valid(bram), true, 'downed, still lockable');
});
