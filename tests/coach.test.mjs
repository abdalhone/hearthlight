// The magic lessons' card placement (src/ui/coach.js placeCard): beside the control it
// points at, never over it, always inside the screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { placeCard, Coach } from '../src/ui/coach.js';

const inside = (at, card, view, pad = 10) => at.x >= pad - 0.5 && at.y >= pad - 0.5 && at.x + at.w <= view.w - pad + 0.5 && at.y + card.h <= view.h - pad + 0.5;
const overlaps = (at, card, t) => at.x < t.x + t.w && at.x + at.w > t.x && at.y < t.y + t.h && at.y + card.h > t.y;

test('coach: the card sits above a low control (a weave button), inside the screen', () => {
  for (const view of [{ w: 390, h: 640 }, { w: 844, h: 340 }, { w: 667, h: 375 }, { w: 390, h: 844 }]) {
    const t = { x: view.w - 150, y: view.h - 130, w: 64, h: 64 };
    const card = { w: 330, h: 110 };
    const at = placeCard(t, card, view);
    assert.ok(inside(at, card, view), `${view.w}x${view.h}: inside (${JSON.stringify(at)})`);
    assert.ok(!overlaps(at, card, t), `${view.w}x${view.h}: not over the button (${JSON.stringify(at)})`);
  }
});

test('coach: the card sits below a high control (the Menu button, the mana bar)', () => {
  const view = { w: 390, h: 640 };
  const t = { x: 330, y: 6, w: 52, h: 48 };
  const card = { w: 330, h: 110 };
  const at = placeCard(t, card, view);
  assert.equal(at.side, 'below');
  assert.ok(inside(at, card, view));
  assert.ok(!overlaps(at, card, t));
});

test('coach: with room neither above nor below, the card goes beside the control, narrower', () => {
  const view = { w: 844, h: 340 };
  const t = { x: 40, y: 60, w: 300, h: 230 }; // a tall block (the Spellbook's slots and preview)
  const card = { w: 330, h: 120 };
  const at = placeCard(t, card, view);
  assert.equal(at.side, 'right');
  assert.ok(at.w <= 330 && at.w >= 180);
  assert.ok(!overlaps(at, card, t));
  assert.ok(inside(at, card, view));
});

test('coach: with no target the card is centred', () => {
  const view = { w: 390, h: 640 };
  const at = placeCard(null, { w: 330, h: 100 }, view);
  assert.equal(at.side, 'center');
  assert.equal(at.x, 30);
  assert.equal(at.y, 270);
});

// A lesson never starts (and a running one steps out of sight) while a person is
// hurting the player: in a fight with Lyra or a guard its card covered the fight.
test('coach: no lesson while a person strikes the player; a creature is the lesson\'s moment', () => {
  const clock = { t: 100 };
  const player = { lastAttacker: null, lastAttackedAt: -Infinity };
  const game = { state: 'playing', player, clock, time: 5 };
  const coach = new Coach({ game, stack: [], chat: { isOpen: () => false }, hud: { el: {} } });
  assert.equal(coach.calm(), true, 'calm with nobody fighting');
  player.lastAttacker = { id: 'lyra' };
  player.lastAttackedAt = 97;
  assert.equal(coach.hurtByPerson(), true, 'Lyra struck 3 s ago');
  assert.equal(coach.calm(), false, 'not calm while she fights');
  clock.t = 110;
  assert.equal(coach.calm(), true, 'calm again 13 s later');
  player.lastAttacker = { id: 'slime_1', species: 'slime' };
  player.lastAttackedAt = 109;
  assert.equal(coach.calm(), true, 'a slime biting is the casting lesson\'s moment');
});
