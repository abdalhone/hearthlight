import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, px, put, villagers, events } from './society_world.mjs';
import { BUTCHER_AT, ROAD_DELAY_DAYS, knownAsKilling } from '../src/society/reputation.js';
import { DAY_SECONDS } from '../src/core/constants.js';

// Reputation (round 14b, S-19; DESIGN §36.1): titles from what each person knows, spread by
// meeting, rebuilt from the truth on load, carried down the road after a delay; never a
// death nobody did, never a killing nobody knows of.

// Everyone held far off at the other end of the vale (nobody sees what a test does).
function still(g) {
  for (const v of villagers(g)) {
    v.think = () => {};
    put(v, px(140), px(100));
  }
  g.companion.x = px(150);
  g.companion.y = px(112);
  g.companion.controller = null;
}

function killSeen(g, id, by = 'elda') {
  const e = g.entities.get(id);
  put(e, px(62), px(14));
  const rec = g.murder.kill(e);
  rec.seen = [{ id: by, clarity: 'clear' }];
  rec.known = 'witnessed';
  rec.alarm = { raised: false };
  return rec;
}

test('the Butcher of Hearthvale at three killings KNOWN to that person; nothing for what nobody saw', () => {
  const g = makeGame({ hour: 12 });
  still(g);
  assert.equal(BUTCHER_AT, 3);
  // Unseen and unfound: secret.
  const e = g.entities.get('wys');
  put(e, px(62), px(14));
  g.murder.kill(e);
  assert.equal(g.reputation.counts().killedSecret, 1);
  assert.equal(g.reputation.counts().killedKnown, 0);
  assert.deepEqual(g.reputation.titles({ knownTo: 'elda' }), []);
  // Three seen by Elda (the bell not yet rung): Elda knows; Garrick does not.
  killSeen(g, 'corran');
  killSeen(g, 'sabeth');
  killSeen(g, 'alder');
  const t = g.reputation.titles({ knownTo: 'elda' }).map((x) => x.id);
  assert.ok(t.includes('butcher'), JSON.stringify(t));
  assert.ok(!g.reputation.titles({ knownTo: 'garrick' }).some((x) => x.id === 'butcher'), 'Garrick has heard nothing');
  // Two known: a killer, not yet the Butcher.
  const g2 = makeGame({ hour: 12 });
  still(g2);
  killSeen(g2, 'corran');
  killSeen(g2, 'sabeth');
  assert.deepEqual(g2.reputation.titles({ knownTo: 'elda' }).map((x) => x.id), ['killer']);
  // The bell rings: everyone knows.
  for (const r of Object.values(g2.murder.dead)) r.alarm = { raised: true, by: 'rowan' };
  assert.ok(g2.reputation.titles({ knownTo: 'garrick' }).some((x) => x.id === 'killer'));
});

test('a title spreads as news: heard by meeting, then used by those who heard it', () => {
  const g = makeGame({ hour: 12 });
  still(g);
  killSeen(g, 'corran');
  killSeen(g, 'sabeth');
  killSeen(g, 'alder');
  g.reputation.look();
  const r = g.village.rumors.list.find((x) => x.kind === 'title_butcher');
  assert.ok(r, 'the name goes out as a rumour');
  assert.ok(r.heardBy.includes('elda') && !r.heardBy.includes('tobias'));
  assert.ok(events(g, 'title_known').some((p) => p.id === 'butcher' && p.knownBy.includes('elda')));
  // Elda tells Tobias face to face.
  g.village.rumors.hear(r, 'tobias', 'elda', g.rng);
  assert.ok(g.reputation.titles({ knownTo: 'tobias' }).some((x) => x.id === 'butcher'), 'Tobias heard them called it');
});

test('rebuilt from the truth on load; a death of age never counts; an Unkindling counts once known', () => {
  const g = makeGame({ hour: 12 });
  still(g);
  killSeen(g, 'corran');
  g.murder.die(g.entities.get('petra'), { cause: 'age' });
  const before = g.reputation.counts();
  assert.equal(before.killedKnown, 1, 'the death of age is nobody\'s deed');
  const save = { murder: JSON.parse(JSON.stringify(g.murder.serialize())), plugins: JSON.parse(JSON.stringify(g.plugins.serialize())) };
  const g2 = makeGame({ hour: 12 });
  still(g2);
  g2.plugins.deserialize(save.plugins);
  g2.murder.deserialize(save.murder);
  assert.deepEqual(g2.reputation.counts(), before, 'the same counts after a reload');
  // The quiet hand, unseen: a mystery; linked (soul), a killing.
  const e = g2.entities.get('hess');
  put(e, px(62), px(14));
  const rec = g2.murder.kill(e, { cause: 'unkindled', silent: true, unmarked: true });
  g2.murder.found('hess', 'rowan', 'whisperwood');
  assert.equal(knownAsKilling(g2.murder, rec), false);
  assert.equal(g2.reputation.counts().killedKnown, 1);
  rec.linked = true;
  rec.knownBy = ['rowan'];
  assert.equal(knownAsKilling(g2.murder, rec), true);
  assert.ok(g2.reputation.titles({ knownTo: 'rowan' }).some((x) => x.id === 'unkindler'));
  assert.ok(!g2.reputation.titles({ knownTo: 'mira' }).some((x) => x.id === 'unkindler'), 'only those who were told');
});

test('the road hears it after the delay: a carter at the fork says the name', () => {
  const g = makeGame({ hour: 12 });
  still(g);
  killSeen(g, 'corran');
  killSeen(g, 'sabeth');
  killSeen(g, 'alder');
  g.reputation.look();
  const enter = () => g.bus.emit('enter_location', { actor: g.player, location: { id: 'cinderwick_fork' } });
  enter();
  assert.ok(!g.toasts.some((t) => /Butcher/.test(t.text)), 'not yet: the road has not heard');
  g.clock.t += ROAD_DELAY_DAYS * DAY_SECONDS;
  enter();
  const t = g.toasts.find((x) => /carter/i.test(x.text));
  assert.ok(t && /Butcher of Hearthvale/.test(t.text), JSON.stringify(g.toasts.slice(-2)));
  assert.ok(events(g, 'road_word').length === 1);
});

test('oaths: betraying the tempter is Oathbreaker to those who know; a hero is named', () => {
  const g = makeGame({ hour: 12 });
  g.reputation.oath('tempter', { kept: false, knownBy: ['rowan'] });
  assert.ok(g.reputation.titles({ knownTo: 'rowan' }).some((x) => x.id === 'oathbreaker'));
  assert.ok(!g.reputation.titles({ knownTo: 'elda' }).some((x) => x.id === 'oathbreaker'));
  g.reputation.heroTitle('wardkeeper');
  assert.ok(g.reputation.titles({ knownTo: 'elda' }).some((x) => x.id === 'wardkeeper'));
  assert.match(g.reputation.briefLine('rowan'), /Oathbreaker/);
  assert.ok(g.reputation.briefLine('rowan').length <= 220);
});
