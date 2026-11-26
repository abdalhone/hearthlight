// Loot the dead; theft is a crime only if seen (round 14b, item 9; decision D10; DESIGN
// §35.3). The author: "I wish I'm able to loot the villagers when I kill them". A hand in a
// body's pockets or an owned chest is a theft only to those who SEE it (the shared sight
// rule); unseen, nobody knows, but the goods are on the provenance ledger.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, px, put, holdLyra, villagers, downBy, events } from './murder_world.mjs';
import { onContainerEvent, theftIfSeen, blowAtChest, ownersNotice, ownerOf, CONTAINERS } from '../src/world/containers.js';
import { gatherEvidence } from '../src/murder/investigation.js';
import { CARRY } from '../src/murder/carry_data.js';

const WOODS = { tx: 62, ty: 14 }; // deep in Whisperwood: nobody's day takes them there

function quiet(g, keep = []) {
  for (const v of villagers(g)) {
    if (keep.includes(v.id)) continue;
    put(v, px(141) + Math.random() * 20, px(101));
    v.think = () => {};
  }
  if (!keep.includes('lyra')) holdLyra(g, px(150), px(112));
}

// The chest panel's "take one": what ChestPanel.move does.
function take(g, chest, id, qty = 1) {
  const n = chest.inventory.transfer(g.player.inventory, id, qty);
  if (n) g.bus.emit('item_gained', { actor: g.player, itemId: id, qty: n, from: 'chest', chest });
  onContainerEvent(g, 'item_gained', { actor: g.player, itemId: id, qty: n, from: 'chest', chest });
  return n;
}

function killUnseen(g, id) {
  const v = g.entities.get(id);
  put(v, px(WOODS.tx + 1), px(WOODS.ty));
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  downBy(g, v);
  const rec = g.murder.kill(v, g.player);
  assert.ok(rec, `${id} killed`);
  return { v, rec };
}

test('search a body unseen: their pockets open, coins taken, no crime; the ledger knows where they came from', () => {
  const g = makeGame({ hour: 23 });
  quiet(g);
  const { v, rec } = killUnseen(g, 'garrick');
  assert.ok(rec.loot?.rolled, 'what he carried is rolled once, at the death');
  const coins = v.inventory.count('coin');
  assert.ok(coins >= CARRY.garrick.coin[0], `a purse (${coins})`);
  let opened = null;
  g.ui.openChest = (c) => {
    opened = c;
  };
  const pockets = g.murder.search(v, g.player);
  assert.equal(opened, pockets, 'the chest panel opens on his pockets');
  assert.match(pockets.name, /Garrick's pockets/);
  const before = g.player.inventory.count('coin');
  assert.equal(take(g, pockets, 'coin', coins), coins);
  assert.equal(g.player.inventory.count('coin'), before + coins);
  assert.equal(v.inventory.count('coin'), 0, 'never doubled: gone from him');
  assert.equal(events(g, 'crime').filter((e) => e.kind === 'theft').length, 0, 'unseen: no crime');
  assert.ok(!(rec.clues || []).some((c) => c.kind === 'searched'));
  const prov = g.provenance?.of?.('coin') || [];
  assert.ok(prov.some((e) => e.owner === 'garrick' && e.how === 'body'), 'on the ledger as his, from a body');
  // Saved with him: his pockets stay as you left them.
  const d = v.serialize();
  assert.equal(d.inventory?.coin ?? 0, 0);
});

test('search a body in front of Elda: a theft with her as witness, robbed_the_dead news, a clue for the watch; never an assault', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['tobias', 'elda']);
  const elda = g.entities.get('elda');
  elda.think = () => {};
  const { v, rec } = killUnseen(g, 'tobias');
  const sq = { x: px(WOODS.tx), y: px(WOODS.ty) };
  // Elda comes upon him searching the body (after the killing, which she did not see).
  put(elda, sq.x + 40, sq.y);
  const op = elda.opinionOfPlayer;
  const pockets = g.murder.search(v, g.player);
  take(g, pockets, 'coin', 1);
  const theft = events(g, 'crime').find((e) => e.kind === 'theft');
  assert.ok(theft, 'a theft');
  assert.ok(theft.witnesses.includes('elda') && theft.dead, 'seen by Elda, from the dead');
  assert.ok(g.village.rumors.list.some((r) => r.kind === 'robbed_the_dead' && r.heardBy.includes('elda')), 'robbed_the_dead');
  assert.ok(!g.village.rumors.list.some((r) => r.kind === 'attacked_villager' && r.victim === 'tobias' && r.t >= rec.t), 'never an assault');
  assert.ok(rec.clues.some((c) => c.kind === 'searched' && c.by === 'elda'), "a 'searched' clue");
  assert.ok(gatherEvidence(g.murder, rec).some((e) => e.kind === 'searched'), 'the watch weighs it');
  assert.notEqual(elda.mode, 'fight', 'nobody fights over a theft');
  assert.ok(elda.opinionOfPlayer < op, 'she thinks less of the stranger');
});

test("Lyra's pack can be searched: her own things, and the key to her trunk; her trunk is her mother's now", () => {
  const g = makeGame({ hour: 23 });
  quiet(g, ['lyra']);
  const L = g.companion;
  if (L._heldController) L.controller = L._heldController;
  put(L, px(WOODS.tx + 1), px(WOODS.ty));
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  L.hp = 1;
  g.combat.damage(g.player, L, 99, { exact: true, crit: false });
  assert.ok(g.murder.kill(L, g.player));
  const pockets = g.murder.search(L, g.player);
  assert.match(pockets.name, /Lyra's pack/);
  assert.equal(pockets.inventory.count('lyra_trunk_key'), 1, 'she kept the key');
  const trunk = g.objects.get?.('lyra_trunk') || g.objects.all().find((o) => o.id === 'lyra_trunk');
  if (trunk) assert.equal(ownerOf(g, trunk), 'wenna');
  else assert.equal(ownerOf(g, { owner: CONTAINERS.lyra_trunk.owner }), 'wenna');
});

test("a chest robbed unseen is no crime; its owner finds it short later and is uneasy", () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['tobias']);
  const tobias = g.entities.get('tobias');
  tobias.think = () => {};
  const chest = g.objects.all().find((o) => o.id === 'reed_linen_chest');
  assert.ok(chest, "the Reeds' linen chest");
  put(tobias, px(141), px(101));
  put(g.player, chest.x, chest.y + 14);
  const has = chest.inventory.list()[0];
  take(g, chest, has.id, 1);
  assert.equal(events(g, 'crime').filter((e) => e.kind === 'theft').length, 0, 'nobody saw: no crime');
  assert.ok((g.provenance?.of?.(has.id) || []).some((e) => e.owner === 'tobias'));
  // He comes home and sees his chest.
  put(tobias, chest.x + 10, chest.y + 12);
  ownersNotice(g);
  assert.ok(tobias.uneasy, 'uneasy');
  assert.ok(events(g, 'goods_missing').some((e) => e.owner === 'tobias'));
  assert.equal(events(g, 'crime').filter((e) => e.kind === 'theft').length, 0, 'still no crime');
});

test('a chest robbed in front of its owner is a theft, and the theft is no fight', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['tobias']);
  const tobias = g.entities.get('tobias');
  tobias.think = () => {};
  const chest = g.objects.all().find((o) => o.id === 'reed_linen_chest');
  put(g.player, chest.x, chest.y + 14);
  put(tobias, chest.x + 30, chest.y + 14);
  const seen = theftIfSeen(g, { actor: g.player, owner: 'tobias', object: chest.id, how: 'chest', itemId: 'wheat', qty: 1 });
  // The owner is never his own witness (he is the one robbed); someone else must see.
  assert.deepEqual(seen, []);
  const tilly = g.entities.get('tilly');
  put(tilly, chest.x - 30, chest.y + 14);
  tilly.think = () => {};
  const seen2 = theftIfSeen(g, { actor: g.player, owner: 'tobias', object: chest.id, how: 'chest', itemId: 'wheat', qty: 1 });
  assert.ok(seen2.includes('tilly'));
  step(g, 0.3);
  assert.notEqual(tilly.mode, 'fight');
  assert.ok(g.village.rumors.list.some((r) => r.kind === 'stole'), "'stole' news");
});

test('a Strike on a locked chest forces the hasp (D10); a sword gets a word; nothing inside is lost or doubled', () => {
  const g = makeGame({ hour: 12 });
  quiet(g);
  const chest = g.objects.all().find((o) => o.id === 'guard_footlocker');
  assert.ok(chest?.state.locked);
  const before = JSON.stringify(chest.inventory.serialize());
  const toasts = [];
  g.ui.toast = (t) => toasts.push(t);
  put(g.player, chest.x, chest.y + 20);
  assert.equal(blowAtChest(g, chest, { source: g.player }), 'iron');
  assert.ok(toasts.some((t) => /Iron-bound/.test(t)), 'a clear word');
  assert.ok(chest.state.locked);
  assert.equal(blowAtChest(g, chest, { source: g.player, heavy: true }), 'forced');
  assert.equal(chest.state.locked, false, 'the hasp gives');
  assert.equal(JSON.stringify(chest.inventory.serialize()), before, 'the contents are exactly as they were');
  assert.equal(blowAtChest(g, chest, { source: g.player, heavy: true }), null, 'open now: nothing more');
});
