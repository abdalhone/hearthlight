import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, put } from './murder_world.mjs';
import { spawnCreature } from '../src/entities/monsters.js';

// Round 14b final merge: where the two verifiers' fixes meet.

// Item 9 x verifier B's item 11. B ended her parting scene when she is struck or "fighting
// back now", read as any fight at all (behavior.currentTarget). In the meadow a slime or a
// wolf is often near: she turned on it, the scene ended before it began, and the letter was
// left on the table with no word said (r14b_story item 9 failed on all three screens). Only a
// fight with you ends it; a beast she fends off while she walks up to you does not.
test('her parting scene is not ended by a beast she fights; it is ended by fighting you', () => {
  const g = makeGame({ hour: 11, settings: { partingScene: true } });
  const L = g.companion;
  const P = g.player;
  const sq = g.locations.get('town_square').center;
  put(P, sq.x, sq.y);
  put(L, sq.x + 3 * 16, sq.y);
  let opened = 0;
  g.ui.chat = { field: { blur() {} }, addMessage() {}, open() {} };
  g.ui.talkTo = (id) => {
    if (id === 'lyra') opened++;
    return true;
  };
  const a = L.mind.autonomy;
  a.setCompanionship('left', 'You keep doing things I cannot stand beside.', { cause: 'trust' });
  assert.equal(a.parting.active, true, 'she walks up to say it');
  // A wolf by her, and she is fighting it.
  const w = spawnCreature(g, 'wolf', L.x + 20, L.y);
  const b = L.behavior;
  // (Held on it for the test: the autonomy looks every half second.)
  const fight = (who, seconds) => {
    for (let t = 0; t < seconds; t += 0.05) {
      b.target = who;
      step(g, 0.05, 0.05);
    }
  };
  b.target = w;
  assert.equal(b.currentTarget, w, 'she has turned on the wolf');
  fight(w, 1.5);
  assert.equal(a.parting.active, true, 'a beast she fends off does not end the scene');
  assert.ok(!g.flags.lyra_letter, 'no letter yet: she has not said it');
  // Fighting you: over.
  fight(P, 1.5);
  assert.equal(a.parting.active, false, 'fighting you, the scene ends');
  assert.ok(g.flags.lyra_letter, 'the letter is left on the table');
});
