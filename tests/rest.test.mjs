// Sleep and sit (r13 C2; the author: "I can't sit anywhere, and I can't sleep"): a bed
// sleeps you to morning at any hour, healing and saving, never with a fight near; chairs,
// stools, benches and pews take a seat with the use button and you stand by moving.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, step, wolf } from './survival_world.mjs';
import { sleepBlocked, seatFor, sitDown, standUp, keepSeated, SEAT_TYPES } from '../src/world/rest.js';
import { homeBed } from '../src/world/home.js';
import { Game } from '../src/core/game.js';

function seatIn(g, place, type = 'chair') {
  return g.objects.list.find((o) => o.objType === type && g.locations.at(o.x, o.y)?.id === place);
}

test('every chair, stool, bench and pew is a seat the player can use; a bed says "Sleep until morning" at any hour', () => {
  const g = makeGame({ hour: 11 });
  const seats = g.objects.list.filter((o) => SEAT_TYPES.has(o.objType));
  assert.ok(seats.length >= 20, `${seats.length} seats in Hearthvale`);
  for (const o of seats) assert.equal(o.constructor.name, 'Seat', `${o.id} sits`);
  const chair = seatIn(g, 'player_home');
  assert.ok(chair, 'a chair in the Wayhouse');
  g.player.x = chair.x;
  g.player.y = chair.y + 14;
  const best = g.interactions.best(g.player);
  assert.equal(best.target, chair);
  assert.equal(best.label, 'Sit');
  const bed = homeBed(g);
  assert.equal(bed.interactLabel(g.player), 'Sleep until morning', 'not "sleep from 6 PM" any more');
});

test('sit with the use button, stand by moving (and walk on), or by a swing or the use button', () => {
  const g = makeGame({ hour: 11 });
  const P = g.player;
  const chair = seatIn(g, 'player_home');
  P.x = chair.x;
  P.y = chair.y + 14;
  const from = { x: P.x, y: P.y };
  g.input.press('interact');
  step(g, 0.1);
  assert.equal(P.state, 'sit');
  assert.equal(P.seat?.obj, chair);
  assert.equal(P.x, seatFor(chair) ? P.x : P.x);
  assert.equal(chair._sitters[P.seat.i], P, 'the villagers see the seat taken');
  assert.equal(P.dir, chair.variant, 'a chair at the table faces it');
  // Seated a while: stays put.
  step(g, 2);
  assert.equal(P.state, 'sit');
  assert.equal(chair.interactLabel(P), 'Stand up');
  // Saved seated: saved standing where they sat down from.
  const sv = P.serialize();
  assert.deepEqual([sv.x, sv.y], [from.x, from.y]);
  // Walk: up, and away.
  g.input.move = { x: 1, y: 0 };
  step(g, 0.5);
  g.input.move = { x: 0, y: 0 };
  assert.equal(P.seat, null);
  assert.notEqual(P.state, 'sit');
  assert.ok(P.x > from.x + 4, 'walked on from where they stood up');
  assert.equal(chair._sitters[0] ?? null, null);
  // Sit again, then the use button stands (and does not sit again at once).
  P.x = from.x;
  P.y = from.y;
  g.input.press('interact');
  step(g, 0.1);
  assert.equal(P.state, 'sit');
  g.input.press('interact');
  step(g, 0.1);
  assert.equal(P.seat, null, 'the use button stood up');
  step(g, 0.3);
  assert.equal(P.seat, null, 'and stayed up');
});

test('a seat someone sits on is taken; a hit knocks you out of it', () => {
  const g = makeGame({ hour: 11 });
  const bench = g.objects.list.find((o) => o.objType === 'bench' && /Kettle bench/.test(o.name || ''));
  const P = g.player;
  const a = { x: bench.x - 8, y: bench.y + 10, seat: null, state: 'idle', setState(s) { this.state = s; }, faceDir() {} };
  const b = { x: bench.x + 8, y: bench.y + 10, seat: null, state: 'idle', setState(s) { this.state = s; }, faceDir() {} };
  assert.ok(sitDown(g, a, bench).ok);
  assert.ok(sitDown(g, b, bench).ok, 'a bench seats two');
  P.x = bench.x;
  P.y = bench.y + 14;
  assert.equal(sitDown(g, P, bench).ok, false, 'full');
  assert.equal(bench.canInteract(P), false);
  standUp(g, a);
  assert.ok(sitDown(g, P, bench).ok);
  P.setState('hurt');
  assert.equal(keepSeated(g, P, {}), false, 'a blow stands you up');
  assert.equal(P.seat, null);
});

test('sleep: any hour, never with a foe near or a blow just taken; heals, saves and wakes in the morning', async () => {
  const g = makeGame({ hour: 14 });
  const P = g.player;
  const bed = homeBed(g);
  P.x = bed.x + 16;
  P.y = bed.y - 4;
  assert.equal(sleepBlocked(g, P), null, 'two in the afternoon is fine');
  const w = wolf(g, P.x + 60, P.y + 20);
  assert.match(sleepBlocked(g, P), /wolf this close/);
  w.x += 2000;
  assert.equal(sleepBlocked(g, P), null, 'far enough');
  P.lastAttackedAt = g.clock.t - 2;
  assert.match(sleepBlocked(g, P), /blood still up/);
  P.lastAttackedAt = g.clock.t - 30;
  P.downed = true;
  assert.match(sleepBlocked(g, P), /bleeding/);
  P.downed = false;
  // game.sleep itself, on this headless world.
  const saved = [];
  Object.assign(g, { audio: { play() {} }, save: { save: async (r) => saved.push(r) } });
  g.brain.reflect = async () => null;
  P.hp = 10;
  const day = g.clock.day;
  const ok = await Game.prototype.sleep.call(g, bed);
  assert.equal(ok, true);
  assert.equal(g.clock.day, day + 1);
  assert.equal(Math.floor(g.clock.hour), 7, 'morning');
  assert.equal(P.hp, P.maxHp, 'healed');
  assert.deepEqual(saved, ['sleep'], 'saved');
  // With the wolf back at the door: no.
  w.x = P.x + 50;
  const toasts = g.toasts.length;
  assert.equal(await Game.prototype.sleep.call(g, bed), false);
  assert.match(g.toasts[toasts].text, /wolf/);
});
