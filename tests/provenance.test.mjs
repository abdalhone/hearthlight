import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame } from './murder_world.mjs';
import { Provenance, provenancePlugin } from '../src/world/provenance.js';
import { Inventory } from '../src/entities/items.js';

// Round 14b, F7 (DESIGN §35.4, §36.2): one ledger of where the stranger's goods came from,
// shared by looting the dead, forcing chests and the shop.

function fakeGame(inv = new Inventory()) {
  const events = [];
  return { clock: { day: 3 }, player: { inventory: inv }, bus: { emit: (type, p) => events.push({ type, p }) }, events };
}

test('add, of, qtyOf: entries carry owner, how, day and who saw it taken', () => {
  const g = fakeGame();
  const P = new Provenance(g);
  P.add('ring', 1, { owner: 'garrick', how: 'body', seenBy: ['elda'] });
  P.add('coin', 12, { owner: 'tobias', how: 'chest' });
  P.add('coin', 5, { owner: 'rowan', how: 'forced', day: 7 });
  assert.equal(P.qtyOf('coin'), 17);
  const coins = P.of('coin');
  assert.deepEqual(coins.map((e) => [e.owner, e.how, e.day, e.qty]), [['tobias', 'chest', 3, 12], ['rowan', 'forced', 7, 5]]);
  assert.deepEqual(P.of('ring')[0].seenBy, ['elda']);
  // Copies: changing what of() returns never changes the ledger.
  coins[0].qty = 999;
  assert.equal(P.qtyOf('coin'), 17);
  assert.equal(P.add('coin', 0), null, 'nothing to add');
  assert.equal(P.add('', 3), null);
  assert.ok(g.events.some((e) => e.type === 'provenance_added' && e.p.itemId === 'ring' && e.p.owner === 'garrick'));
});

test('take is first in, first out, splitting an entry, and returns what it took', () => {
  const P = new Provenance(fakeGame());
  P.add('coin', 12, { owner: 'tobias', how: 'chest' });
  P.add('coin', 5, { owner: 'rowan', how: 'forced' });
  const out = P.take('coin', 14);
  assert.deepEqual(out.map((e) => [e.owner, e.qty]), [['tobias', 12], ['rowan', 2]]);
  assert.deepEqual(P.of('coin').map((e) => [e.owner, e.qty]), [['rowan', 3]]);
  assert.deepEqual(P.take('coin', 10).map((e) => e.qty), [3]);
  assert.deepEqual(P.take('coin', 1), [], 'nothing left to take');
});

test("the ledger never holds more than the player carries: every removal from the pack settles it", () => {
  const inv = new Inventory({ apple: 3 });
  const g = fakeGame(inv);
  const P = new Provenance(g);
  P.watch(inv);
  inv.add('apple', 2);
  P.add('apple', 2, { owner: 'elda', how: 'chest' });
  assert.equal(P.qtyOf('apple'), 2);
  inv.remove('apple', 2); // eaten: three honest apples still cover the ledger's two
  assert.equal(P.qtyOf('apple'), 2);
  inv.remove('apple', 2); // one apple left: the ledger keeps at most one
  assert.equal(P.qtyOf('apple'), 1);
  inv.remove('apple', 5);
  assert.equal(P.qtyOf('apple'), 0);
  // The shop's way: take() the entries first, then remove; nothing is taken twice.
  inv.add('ring', 1);
  P.add('ring', 1, { owner: 'garrick', how: 'body' });
  const sold = P.take('ring', 1);
  assert.equal(sold[0].owner, 'garrick');
  inv.remove('ring', 1);
  assert.equal(P.qtyOf('ring'), 0);
  assert.equal(P.watch(inv), false, 'watched once');
});

test('saved with the plugins; an old save starts empty; a load settles against the pack', () => {
  const g = makeGame({ hour: 12 });
  assert.ok(g.provenance instanceof Provenance, 'game.provenance exists');
  g.player.inventory.add('ring', 1);
  g.provenance.add('ring', 1, { owner: 'garrick', how: 'body', seenBy: [] });
  const data = JSON.parse(JSON.stringify(g.plugins.serialize()));
  assert.deepEqual(data.provenance.entries.map((e) => e.itemId), ['ring']);
  const h = makeGame({ hour: 12 });
  h.player.inventory.add('ring', 1);
  h.plugins.deserialize(data);
  assert.deepEqual(h.provenance.of('ring').map((e) => [e.owner, e.how]), [['garrick', 'body']]);
  // The player's pack in the real game: losing the ring takes it off the ledger.
  h.player.inventory.remove('ring', 1);
  assert.equal(h.provenance.qtyOf('ring'), 0);
  // An old save (no provenance block): empty.
  const o = makeGame({ hour: 12 });
  o.plugins.deserialize({});
  assert.deepEqual(o.provenance.all(), []);
  // Junk in a save is dropped, not trusted.
  o.player.inventory.add('coin', 5);
  o.provenance.deserialize({ entries: [{ itemId: 'coin', qty: -3 }, { qty: 2 }, null, { itemId: 'coin', qty: 2, owner: 5 }] });
  assert.deepEqual(o.provenance.all().map((e) => [e.itemId, e.qty, e.owner]), [['coin', 2, null]], 'only the sound entry, its odd owner read as unknown');
  // More than the pack holds is cut to what it holds.
  o.provenance.deserialize({ entries: [{ itemId: 'moonpetal', qty: 4, owner: 'mira', how: 'chest' }] });
  assert.equal(o.provenance.qtyOf('moonpetal'), o.player.inventory.count('moonpetal'));
  assert.equal(provenancePlugin.id, 'provenance');
});
