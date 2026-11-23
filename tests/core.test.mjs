import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RNG, noise2 } from '../src/core/rng.js';
import { EventBus } from '../src/core/events.js';
import { dirFromVec, clamp } from '../src/core/math.js';
import { Inventory, resolveItemId } from '../src/entities/items.js';
import { ActionRegistry, normalizeArgs } from '../src/ai/brain/actions.js';
import { PluginRegistry } from '../src/ai/plugins/registry.js';
import { LocationIndex } from '../src/world/locations.js';
import { factionRelation } from '../src/entities/entity.js';

test('rng is deterministic per seed', () => {
  const a = new RNG(42);
  const b = new RNG(42);
  for (let i = 0; i < 20; i++) assert.equal(a.next(), b.next());
  const n = noise2(3.3, 7.7, 1);
  assert.ok(n >= 0 && n < 1);
});

test('event bus delivers typed and wildcard events and isolates listener errors', () => {
  const bus = new EventBus();
  const seen = [];
  bus.on('damage', (p) => seen.push(['damage', p.amount]));
  bus.on('*', (t) => seen.push(['*', t]));
  bus.on('damage', () => {
    throw new Error('bad listener');
  });
  const origError = console.error;
  console.error = () => {};
  bus.emit('damage', { amount: 3 });
  console.error = origError;
  assert.deepEqual(seen, [
    ['damage', 3],
    ['*', 'damage'],
  ]);
});

test('math helpers', () => {
  assert.equal(dirFromVec(1, 0.2), 'right');
  assert.equal(dirFromVec(0, -1), 'up');
  assert.equal(clamp(5, 0, 3), 3);
});

test('inventory add/remove/transfer and item resolution', () => {
  const a = new Inventory({ wood: 3 });
  const b = new Inventory();
  assert.equal(a.transfer(b, 'wood', 2), 2);
  assert.equal(a.count('wood'), 1);
  assert.equal(b.count('wood'), 2);
  assert.equal(a.remove('wood', 5), 1);
  assert.ok(a.isEmpty());
  assert.equal(resolveItemId('healing potions'), 'potion');
  assert.equal(resolveItemId('Honey Cake'), 'honey_cake');
  assert.equal(resolveItemId('fish'), 'raw_fish');
});

test('action registry normalizes args and records history', () => {
  const emitted = [];
  const game = { bus: { emit: (t, p) => emitted.push(t) }, clock: { t: 5 }, plugins: { ctx: {} } };
  const reg = new ActionRegistry(game);
  reg.register('ping', { description: 'test', params: { value: 'x' }, run: (args) => ({ ok: true, message: args.value }) });
  const r = reg.run('ping', { value: 7, amount: '3' });
  assert.equal(r.ok, true);
  assert.equal(r.message, '7');
  assert.equal(reg.history.at(-1).args.amount, 3);
  assert.equal(reg.run('nope').ok, false);
  assert.deepEqual(normalizeArgs({ target: '' }), { target: null, value: null, amount: null });
  assert.ok(reg.catalogText().includes('ping'));
  assert.ok(emitted.includes('companion_action'));
});

test('plugin registry registers actions and isolates failing hooks', () => {
  const game = { bus: { on: () => () => {}, emit() {} }, clock: { t: 0 } };
  game.actions = new ActionRegistry(game);
  game.plugins = new PluginRegistry(game);
  game.plugins.register({
    id: 'p1',
    actions: { hello: { description: 'hi', run: () => ({ ok: true }) } },
    intents: [{ id: 'hi', patterns: [/hi/], action: 'hello' }],
    promptContext: () => 'context!',
    update() {
      throw new Error('boom');
    },
  });
  game.plugins.installAll();
  const origError = console.error;
  console.error = () => {};
  game.plugins.update(0.016);
  console.error = origError;
  assert.ok(game.actions.has('hello'));
  assert.equal(game.plugins.intents().length, 1);
  assert.equal(game.plugins.promptSections()[0].text, 'context!');
});

test('location index finds by name, alias and point', () => {
  const idx = new LocationIndex([
    { id: 'hearthvale', name: 'Hearthvale', kind: 'village', bounds: { x: 0, y: 0, w: 100, h: 100 } },
    { id: 'ember_kettle', name: 'The Ember Kettle', kind: 'building', aliases: ['inn', 'tavern'], bounds: { x: 10, y: 10, w: 5, h: 5 } },
  ]);
  assert.equal(idx.find('the inn').id, 'ember_kettle');
  assert.equal(idx.find('Ember Kettle').id, 'ember_kettle');
  assert.equal(idx.at(12 * 16, 12 * 16).id, 'ember_kettle');
  assert.equal(idx.at(50 * 16, 50 * 16).id, 'hearthvale');
});

test('faction relations', () => {
  assert.equal(factionRelation('player', 'bandit'), 'hostile');
  assert.equal(factionRelation('player', 'villager'), 'ally');
  assert.equal(factionRelation('player', 'wildlife'), 'neutral');
});
