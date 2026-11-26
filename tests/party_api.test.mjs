import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, px, put } from './murder_world.mjs';
import { Party, installParty, lyraCompanionship } from '../src/core/party.js';

// Round 14b, the base's minimal party (F4, DESIGN §34.1): one companion role, held by one
// adult at a time or by nobody. game.companion / game.lyra stay Lyra the person; the role is
// game.party.holder. Workstream party builds invite/take/release/ask on this.

function changes(g) {
  return g.events.filter((e) => e.type === 'companion_changed').map((e) => e.p);
}

test('Lyra holds the role at a new game; game.lyra is Lyra herself, never the holder', () => {
  const g = makeGame({ hour: 12 });
  assert.ok(g.party instanceof Party);
  assert.ok(g.party.holder === g.companion, 'Lyra holds the role');
  assert.equal(g.party.holderId, 'lyra');
  assert.ok(g.lyra === g.companion, 'game.lyra is Lyra');
  assert.equal(g.party.isCompanion(g.companion), true);
  assert.equal(g.party.isCompanion('lyra'), true);
  assert.equal(g.party.isCompanion(g.entities.get('bram')), false);
  assert.ok(installParty(g) === g.party, 'installed once');
});

test('canHold: a person, alive, present, an adult, never the player or a child', () => {
  const g = makeGame({ hour: 12 });
  const P = g.party;
  assert.equal(P.canHold(g.companion), true);
  assert.equal(P.canHold(g.entities.get('bram')), true);
  assert.equal(P.canHold('tilly'), true, 'Tilly (17) is an adult');
  assert.equal(P.canHold('wys'), true);
  assert.equal(P.canHold(g.player), false, 'never the player');
  assert.equal(P.canHold('pip'), false, 'never a child');
  assert.equal(P.canHold('tansy'), false, 'Tansy at 15 is a child');
  // Tansy at 16 can (the calendar's age decides, src/core/people.js).
  g.calendar = { ageOf: (id) => (id === 'tansy' ? 16 : null) };
  assert.equal(P.canHold('tansy'), true, 'Tansy at 16 is an adult');
  delete g.calendar;
  // Not a beast, not the dead, not someone gone from the village.
  const wolf = { id: 'wolf_1', species: 'wolf', x: 0, y: 0, isAlive: () => true };
  assert.equal(P.canHold(wolf), false);
  const bram = g.entities.get('bram');
  bram.absent = { cause: 'away', since: 0 };
  assert.equal(P.canHold(bram), false);
  bram.absent = null;
});

test("Lyra's companionship keeps the role in step: apart releases it, together takes it back when free", () => {
  const g = makeGame({ hour: 12 });
  const a = g.companion.mind.autonomy;
  a.setCompanionship('apart', 'test');
  assert.ok(g.party.holder === null, 'she walks her own way: the slot is empty');
  let last = changes(g).at(-1);
  assert.deepEqual([last.from, last.to, last.why], ['lyra', null, 'apart']);
  a.setCompanionship('together', 'test');
  assert.ok(g.party.holder === g.companion, 'Lyra holds the role');
  last = changes(g).at(-1);
  assert.deepEqual([last.from, last.to], [null, 'lyra']);
  // While someone else holds the role, Lyra coming back does not take it from them.
  g.party.set('bram', 'test', 'player');
  a.setCompanionship('apart', 'test');
  assert.equal(g.party.holderId, 'bram', "Lyra leaving does not release Bram's place");
  a.setCompanionship('together', 'test');
  assert.equal(g.party.holderId, 'bram', 'one at a time: the role is not hers to take back');
});

test("the holder's death releases the role (a killing or a death nobody did)", () => {
  const g = makeGame({ hour: 12 });
  g.party.set('bram', 'test', 'player');
  const bram = g.entities.get('bram');
  put(bram, px(62), px(14));
  put(g.player, px(61), px(14));
  bram.hp = 1;
  g.combat.damage(g.player, bram, 999, { exact: true, crit: false });
  g.murder.kill(bram, g.player);
  assert.ok(g.party.holder === null);
  assert.equal(changes(g).at(-1).why, 'died');
  g.party.set('garrick', 'test', 'player');
  g.murder.die('garrick', { cause: 'age' });
  assert.ok(g.party.holder === null);
});

test('saved and restored last; an old save with no party block derives the holder from Lyra', () => {
  const g = makeGame({ hour: 12 });
  g.party.set('bram', 'test', 'player');
  const saved = JSON.parse(JSON.stringify(g.party.serialize()));
  assert.deepEqual(saved, { v: 1, holderId: 'bram' });
  const h = makeGame({ hour: 12 });
  h.party.deserialize(saved);
  assert.equal(h.party.holderId, 'bram');
  assert.ok(h.party.holder === h.entities.get('bram'));
  // An old save: Lyra together -> she holds it.
  const o = makeGame({ hour: 12 });
  o.party.set(null, 'test');
  o.party.deserialize(undefined);
  assert.equal(o.party.holderId, 'lyra');
  // An old save with Lyra apart -> nobody.
  o.companion.mind.autonomy.setCompanionship('apart', 'test');
  o.party.deserialize(undefined);
  assert.equal(lyraCompanionship(o), 'apart');
  assert.ok(o.party.holder === null);
  // A saved holder who can no longer hold it (a child id, a stranger) is dropped.
  o.party.deserialize({ v: 1, holderId: 'pip' });
  assert.ok(o.party.holder === null);
  step(o, 0.5);
});
