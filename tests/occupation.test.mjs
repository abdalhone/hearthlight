// The village under the stranger's hand (round 14b, item 19, the world side; DESIGN §35.7).
// Children hide from a known killer and are taken away when their household is emptied,
// never hurt; a store burns and closes; a house is claimed; the emptied village is yours.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, px, put, holdLyra, villagers, downBy, events } from './murder_world.mjs';
import { Occupation, BURNABLE } from '../src/world/occupation.js';
import { VILLAGERS } from '../src/ai/social/bonds_data.js';
import { isMinor } from '../src/core/people.js';

const WOODS = { tx: 62, ty: 14 };

function setup(hour = 12) {
  const g = makeGame({ hour });
  g.occupation = new Occupation(g);
  for (const v of villagers(g)) {
    put(v, px(141) + Math.random() * 20, px(101));
    v.think = () => {};
  }
  holdLyra(g, px(150), px(112));
  return g;
}

function killUnseen(g, id) {
  const v = g.entities.get(id);
  put(v, px(WOODS.tx + 1), px(WOODS.ty));
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  downBy(g, v);
  const rec = g.murder.kill(v, g.player);
  assert.ok(rec, `${id} killed`);
  return rec;
}

test('Pip is taken away, unharmed, the morning after Elda (his household) is dead; Tansy when Tobias is', () => {
  const g = setup(12);
  const occ = g.occupation;
  killUnseen(g, 'elda');
  occ.childrenTick();
  assert.ok(occ.pendingTake.pip, 'a carter is coming');
  const pip = g.entities.get('pip');
  assert.ok(!pip.absent, 'not yet');
  g.clock.t += 37.5 * 24;
  g.clock.update?.(0);
  occ.childrenTick();
  assert.ok(occ.taken.pip, 'taken away');
  assert.equal(pip.absent?.cause, 'taken_away');
  assert.ok(!pip.dead && !g.murder.isDead('pip'), 'never hurt');
  assert.ok(events(g, 'child_taken_away').some((e) => e.id === 'pip'));
  // His missions pass on (a stand-in or the board).
  const s = g.murder.standIn('pip');
  assert.notEqual(s, 'pip');
  // Tansy stays while her father lives.
  assert.ok(!occ.pendingTake.tansy);
  // And a child is never killable, whatever the village's state.
  assert.equal(g.murder.canKill(g.entities.get('tansy')), false);
});

test('a child who sees a known killer runs home and hides; one who does not know, does not', () => {
  const g = setup(12);
  const occ = g.occupation;
  const pip = g.entities.get('pip');
  const sq = g.locations.get('town_square').center;
  put(pip, sq.x, sq.y);
  put(g.player, sq.x + 60, sq.y);
  assert.equal(occ.childSees(pip), false, 'nothing known: no hiding');
  // The stranger killed Bram before Pip's eyes' news reached him: the murder rumor heard.
  const rec = killUnseen(g, 'bram');
  rec.known = 'witnessed';
  rec.alarm = { raised: true, by: 'rowan', t: g.clock.t };
  put(pip, sq.x, sq.y);
  put(g.player, sq.x + 60, sq.y);
  assert.equal(occ.childSees(pip), true, 'he knows: he hides');
  assert.ok(pip.hideUntil > g.clock.t);
  const e = occ.entryFor(pip, null, 12);
  assert.equal(e.at, pip.profile.home, 'home, door shut');
  assert.ok(events(g, 'child_hides').some((x) => x.id === 'pip'));
});

test('a store set alight by a fire weave burns, closes its shop, smokes, and is saved; arson is a crime only if seen', () => {
  const g = setup(23);
  const occ = g.occupation;
  const store = g.locations.get('general_store');
  put(g.player, store.center.x, store.center.y + 60);
  assert.ok(BURNABLE.includes('general_store'));
  assert.equal(occ.fireAt(store.center.x, store.center.y, 20, { source: g.player, fire: false }), null, 'no fire, no burning');
  const rec = occ.fireAt(store.center.x, store.center.y, 20, { source: g.player, fire: true });
  assert.ok(rec, 'it burns');
  assert.ok(occ.shopClosed('garrick'), "Garrick's shop is closed");
  assert.equal(g.murder.refusesTrade(g.entities.get('garrick')), true, 'nothing sold from ash');
  assert.equal(events(g, 'crime').filter((e) => e.kind === 'arson').length, 0, 'nobody saw it at night: no crime');
  const data = JSON.parse(JSON.stringify(occ.serialize()));
  const o2 = new Occupation(g);
  o2.deserialize(data);
  assert.ok(o2.burned('general_store'));
  // Seen: a crime (no fight), and the village talks of it.
  const g2 = setup(12);
  const herb = g2.locations.get('herbalist');
  const elda = g2.entities.get('elda');
  const sq = g2.locations.get('town_square').center;
  void herb;
  put(g2.player, sq.x, sq.y);
  put(elda, sq.x + 30, sq.y);
  g2.occupation.burn('herbalist', g2.player);
  const arson = events(g2, 'crime').find((e) => e.kind === 'arson');
  assert.ok(arson && arson.witnesses.includes('elda'), 'Elda saw it');
  assert.ok(g2.village.rumors.list.some((r) => r.kind === 'burned_store'));
  assert.notEqual(elda.mode, 'fight');
});

test('a house is claimed once its household is gone; its chest opens as yours; the emptied village is yours', () => {
  const g = setup(12);
  const occ = g.occupation;
  assert.equal(occ.canClaim('farmhouse'), false, 'Tobias lives');
  killUnseen(g, 'tobias');
  assert.equal(occ.canClaim('farmhouse'), true);
  assert.ok(occ.claim('farmhouse'));
  const chest = g.objects.all().find((o) => o.id === 'reed_linen_chest');
  assert.equal(chest.owner, 'player', "the Reeds' chest is yours: no theft");
  // Everyone grown gone: the village is emptied; children are never touched by it.
  for (const id of VILLAGERS) {
    if (isMinor(g, id) || g.murder.isDead(id)) continue;
    g.villageLife.markGone(id, { cause: 'fled' });
  }
  assert.equal(occ.emptied(), true);
  occ.checkFallen();
  assert.ok(occ.fallen != null);
  assert.equal(occ.placeName('hearthvale', 'Hearthvale'), 'Hearthvale (yours)');
  for (const id of ['pip', 'tansy']) assert.ok(!g.entities.get(id).dead && !g.murder.isDead(id), `${id} unharmed`);
  assert.ok(events(g, 'village_emptied').length === 1);
});
