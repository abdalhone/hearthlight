import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, px, put, events } from './society_world.mjs';
import { priceFor, shopOf, buysIt, stance, MERCHANTS, WARES, DAILY, isMerchant, FRESH_DAYS } from '../src/world/trade.js';
import { refusesTrade, mainOptions, chooseOption } from '../src/entities/npc_dialogue.js';
import { itemDef } from '../src/entities/items.js';
import { DAY_SECONDS } from '../src/core/constants.js';

// The shop (round 14b, S-17 and S-19; DESIGN §36.2): tastes and prices, the relationship and a
// haggle a day, one stock, never a loop, stolen goods, and one graded refusal.

const E = (g, id) => g.entities.get(id);

function nextDay(g) {
  g.clock.t += DAY_SECONDS;
  g.bus.emit('new_day', { day: g.clock.day });
}

test('each merchant buys what suits them, at their own share; Garrick anything of worth; boots fetch more at the smithy', () => {
  const g = makeGame({ hour: 12 });
  for (const id of MERCHANTS) assert.ok(isMerchant(E(g, id)), `${id} trades`);
  assert.ok(buysIt(g, E(g, 'garrick'), 'wolf_pelt'));
  assert.ok(buysIt(g, E(g, 'garrick'), 'iron_sword'), 'Garrick buys anything');
  assert.ok(buysIt(g, E(g, 'bram'), 'iron_sword') && buysIt(g, E(g, 'bram'), 'iron_ore'));
  assert.equal(buysIt(g, E(g, 'bram'), 'bread'), false, 'Bram does not buy bread');
  assert.ok(buysIt(g, E(g, 'mira'), 'potion') && buysIt(g, E(g, 'mira'), 'moonpetal') && buysIt(g, E(g, 'mira'), 'slime_gel'));
  assert.equal(buysIt(g, E(g, 'mira'), 'iron_sword'), false);
  assert.ok(buysIt(g, E(g, 'elda'), 'bread') && buysIt(g, E(g, 'elda'), 'raw_fish'));
  assert.equal(buysIt(g, E(g, 'elda'), 'wolf_pelt'), false);
  assert.equal(priceFor(g, E(g, 'garrick'), 'maren_journal', 'sell'), null, 'never a quest thing');
  const atBram = priceFor(g, E(g, 'bram'), 'field_boots', 'sell');
  const atGarrick = priceFor(g, E(g, 'garrick'), 'field_boots', 'sell');
  assert.ok(atBram > atGarrick, `boots: Bram ${atBram} > Garrick ${atGarrick}`);
  assert.ok(priceFor(g, E(g, 'bram'), 'iron_sword', 'sell') > priceFor(g, E(g, 'garrick'), 'iron_sword', 'sell'), 'a sword is worth more to a smith');
  // Mira sells potions, Bram sells gear, Elda food (their wares beyond the profile's list).
  assert.ok(shopOf(g, E(g, 'mira')).sells.some((s) => s.id === 'potion'));
  assert.ok(shopOf(g, E(g, 'bram')).sells.some((s) => s.id === 'leather_jerkin'));
  assert.ok(shopOf(g, E(g, 'elda')).sells.some((s) => s.id === 'stew'));
  // Mira's Trade shows in her dialogue (she had no shop before).
  assert.ok(mainOptions(E(g, 'mira'), g.player).some((o) => o.id === 'shop'));
});

test('the relationship moves the price; a haggle once a day, by their nature; never a buy-low, sell-high loop', () => {
  const g = makeGame({ hour: 12 });
  const garrick = E(g, 'garrick');
  garrick.opinionOfPlayer = 10;
  const coldBuy = priceFor(g, garrick, 'potion', 'buy');
  const coldSell = priceFor(g, garrick, 'wolf_pelt', 'sell');
  garrick.opinionOfPlayer = 80;
  garrick.familiarity = 40;
  const warmBuy = priceFor(g, garrick, 'potion', 'buy');
  const warmSell = priceFor(g, garrick, 'wolf_pelt', 'sell');
  assert.ok(warmBuy < coldBuy, `cheaper for a friend: ${warmBuy} < ${coldBuy}`);
  assert.ok(warmSell > coldSell, `pays a friend more: ${warmSell} > ${coldSell}`);
  // Haggle: decided once a day; asking again says so; tomorrow is another day.
  const r1 = g.trade.haggle(garrick);
  assert.ok(typeof r1.won === 'boolean' && r1.line);
  const r2 = g.trade.haggle(garrick);
  assert.equal(r2.again, true);
  assert.equal(r2.won, r1.won);
  nextDay(g);
  assert.ok(!g.trade.haggle(garrick).again, 'a new day, a new haggle');
  // Wenna never haggles.
  assert.equal(g.trade.haggle(E(g, 'wenna')).won, false);
  // No loop: the best anyone pays you for a thing is below the least anyone asks for it.
  for (const m of MERCHANTS) {
    E(g, m).opinionOfPlayer = 100;
    E(g, m).familiarity = 100;
  }
  const items = new Set(MERCHANTS.flatMap((m) => shopOf(g, E(g, m)).sells.map((s) => s.id)));
  for (const it of items) {
    let minBuy = Infinity;
    let maxSell = 0;
    for (const m of MERCHANTS) {
      const b = priceFor(g, E(g, m), it, 'buy', { haggled: true });
      if (b != null) minBuy = Math.min(minBuy, b);
      const s = priceFor(g, E(g, m), it, 'sell', { haggled: true });
      if (s != null) maxSell = Math.max(maxSell, s);
    }
    assert.ok(maxSell < minBuy, `${it}: sells for at most ${maxSell}, costs at least ${minBuy}`);
  }
});

test('one stock: it runs down, sold out is said, the morning restocks it, and it is saved', () => {
  const g = makeGame({ hour: 12 });
  const bram = E(g, 'bram');
  g.player.inventory.add('coin', 2000);
  assert.equal(g.trade.stockLeft(bram, 'leather_jerkin'), 1);
  const r = g.trade.buy(bram, 'leather_jerkin', 1);
  assert.ok(r.ok && g.player.inventory.count('leather_jerkin') === 1);
  assert.equal(g.trade.stockLeft(bram, 'leather_jerkin'), 0);
  const again = g.trade.buy(bram, 'leather_jerkin', 1);
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'sold_out');
  assert.match(again.line, /Sold out/);
  // The village's errand stock is the same stock where it names the item (Elda's bread).
  const elda = E(g, 'elda');
  const before = g.trade.stockLeft(elda, 'bread');
  g.trade.buy(elda, 'bread', 2);
  assert.equal(g.trade.stockLeft(elda, 'bread'), before - 2);
  assert.equal(g.villageLife.stock.elda.bread, before - 2, 'one stock with the village');
  // Saved mid-day.
  const data = g.trade.serialize();
  assert.equal(data.stock.bram.leather_jerkin, 0);
  nextDay(g);
  g.villageLife.ensureDay?.();
  assert.equal(g.trade.stockLeft(bram, 'leather_jerkin'), DAILY.bram.leather_jerkin, 'back in the morning');
  // Selling adds to their stock and pays from their purse.
  g.player.inventory.add('iron_sword', 1);
  const purse = bram.inventory.count('coin');
  const s = g.trade.sell(bram, 'iron_sword', 1);
  assert.ok(s.ok);
  assert.equal(bram.inventory.count('coin'), purse - s.total);
  assert.equal(g.trade.stockLeft(bram, 'iron_sword'), DAILY.bram.iron_sword + 1);
  // An empty purse says so.
  bram.inventory.remove('coin', bram.inventory.count('coin'));
  g.player.inventory.add('iron_sword', 1);
  const broke = g.trade.sell(bram, 'iron_sword', 1);
  assert.equal(broke.reason, 'purse');
  assert.ok(broke.line);
});

test("stolen goods: Garrick knows his own lantern (refused, colder, a 'stole' rumour); the ledger shows it; a fond Garrick fences others' goods at half", () => {
  const g = makeGame({ hour: 12 });
  const garrick = E(g, 'garrick');
  g.player.inventory.add('lantern', 1);
  g.provenance.add('lantern', 1, { owner: 'garrick', how: 'chest', day: 1, seenBy: [] });
  assert.equal(g.trade.stolenOf('lantern', 1).length, 1);
  const op = garrick.opinionOfPlayer;
  // Seeded by the day: find a day he knows it (his own: most days).
  let r = null;
  for (let i = 0; i < 6 && !(r && r.reason === 'stolen'); i++) {
    r = g.trade.sell(garrick, 'lantern', 1);
    if (r.ok) {
      g.player.inventory.add('lantern', 1);
      g.provenance.add('lantern', 1, { owner: 'garrick', how: 'chest', day: 1, seenBy: [] });
    }
    if (r.reason !== 'stolen') nextDay(g);
  }
  assert.equal(r.reason, 'stolen', 'he knows his own lantern');
  assert.equal(r.seen, 'own');
  assert.ok(r.line && /MINE/.test(r.line));
  assert.ok(garrick.opinionOfPlayer < op);
  assert.ok(g.village.rumors.list.some((x) => x.kind === 'stole' && x.heardBy.includes('garrick')));
  assert.equal(g.player.inventory.count('lantern'), 1, 'you keep it');
  // A fond Garrick fences what is not his, at half, and does not ask.
  const g2 = makeGame({ hour: 12 });
  const ga = E(g2, 'garrick');
  ga.opinionOfPlayer = 80;
  g2.player.inventory.add('wolf_pelt', 1);
  g2.provenance.add('wolf_pelt', 1, { owner: 'hess', how: 'body', day: 1, seenBy: [] });
  const full = priceFor(g2, ga, 'wolf_pelt', 'sell');
  const f = g2.trade.sell(ga, 'wolf_pelt', 1);
  assert.ok(f.ok && f.fenced, JSON.stringify(f));
  assert.equal(f.total, Math.max(1, Math.round(full * 0.5)));
  assert.match(f.line, /I don't ask/);
  assert.equal(g2.provenance.qtyOf('wolf_pelt'), 0, 'the ledger let it go with the sale');
});

test('one graded refusal: kin refuse; others refuse while the blood is fresh, then charge a blood price; after the Butcher all refuse but a fence; children never killed', () => {
  const g = makeGame({ hour: 12 });
  for (const v of g.entities.all()) if (v.profile) v.think = () => {};
  const kill = (id) => {
    const e = E(g, id);
    put(e, px(62), px(14));
    const rec = g.murder.kill(e);
    rec.known = 'witnessed';
    rec.alarm = { raised: true, by: 'rowan' };
    return rec;
  };
  assert.equal(g.murder.kill(E(g, 'pip')), null, 'never a child');
  kill('wys');
  assert.equal(stance(g, E(g, 'garrick')).refuse, true, 'fresh: Garrick will not');
  assert.equal(stance(g, E(g, 'garrick')).why, 'fresh');
  for (let i = 0; i < FRESH_DAYS; i++) nextDay(g);
  const st = stance(g, E(g, 'garrick'));
  assert.equal(st.refuse, false, 'later: a blood price');
  assert.ok(st.markup > 1);
  assert.ok(priceFor(g, E(g, 'garrick'), 'potion', 'buy', { markup: st.markup }) > priceFor(g, E(g, 'garrick'), 'potion', 'buy'));
  // The refusal is their line, and Trade stays on the list.
  const elda = E(g, 'elda');
  const opts = mainOptions(elda, g.player);
  assert.ok(opts.some((o) => o.id === 'shop'));
  kill('corran');
  kill('alder'); // Tilly's father
  for (let i = 0; i < FRESH_DAYS; i++) nextDay(g);
  assert.equal(stance(g, E(g, 'tilly')).why, 'kin', 'his daughter never forgives');
  g.reputation.look();
  assert.ok(g.reputation.titles({ knownTo: 'mira' }).some((t) => t.id === 'butcher'));
  assert.equal(refusesTrade(E(g, 'mira'), g.player), true, 'the Butcher: Mira will not');
  const r = chooseOption(E(g, 'mira'), 'shop', g.player);
  assert.ok(r.lines[0] && !r.open, 'refused, in her words');
  assert.ok(r.options.some((o) => o.id === 'shop'), 'never a missing option');
  const gs = stance(g, E(g, 'garrick'));
  assert.equal(gs.fence, true, 'Garrick fences');
  assert.match(gs.line, /I don't ask/);
});
