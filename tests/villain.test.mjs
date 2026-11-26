import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, px, put, events, villagers } from './society_world.mjs';
import { VILLAGERS } from '../src/ai/social/bonds_data.js';
import { isMinor } from '../src/core/people.js';
import { TEMPTER_ID } from '../src/story/tempter_data.js';
import { PACT_GIFTS } from '../src/story/villain.js';

// The villain path (round 14b, S-15; DESIGN §36.4): the tempter at the ruins gate, the pact
// (before or after), kills counted only once known as killings, children never counted or
// required, the two endings, and the save.

function quietAll(g) {
  for (const v of villagers(g)) v.think = () => {};
}

test('the pact: before gives everything now, after lends only the Unkindling; pact_sealed carries unkindle', () => {
  const g = makeGame({ hour: 12 });
  const V = g.villain;
  assert.ok(V, 'game.villain is there through the society slot');
  assert.equal(V.hasPact(), false);
  assert.equal(V.seal('after'), true);
  assert.equal(V.hasPact(), true);
  const sealed = events(g, 'pact_sealed');
  assert.equal(sealed.length, 1);
  assert.deepEqual(sealed[0].gifts, PACT_GIFTS.after);
  assert.ok(sealed[0].gifts.includes('unkindle'), 'the Unkindling is part of the pact');
  assert.equal(V.seal('before'), false, 'one pact');
  const g2 = makeGame({ hour: 12 });
  g2.magic = { unlocked: [], unlock(k, id) { this.unlocked.push(`${k}:${id}`); return true; } };
  g2.villain.seal('before');
  const s2 = events(g2, 'pact_sealed')[0];
  assert.deepEqual(s2.gifts, PACT_GIFTS.before);
  assert.ok(s2.gifts.includes('unkindle'));
  assert.ok(g2.magic.unlocked.includes('essences:dark') && g2.magic.unlocked.includes('prices:bloodprice'), 'shadow and a price in blood, now');
});

test('he waits at the ruins gate only at night, and only once the stranger has shown him something', () => {
  const g = makeGame({ hour: 12 });
  const V = g.villain;
  step(g, 2);
  assert.equal(V.tempter, null, 'nobody at the gate by day');
  g.clock.skipTo(22);
  step(g, 2);
  assert.equal(V.tempter, null, 'nor at night before a boss falls or a killing is known');
  g.flags.bosses = { varek: { defeated: true, shards: {} } };
  step(g, 2);
  assert.ok(V.tempter && g.entities.get(TEMPTER_ID), 'there he is');
  assert.ok(g.toasts.some((t) => /ruins gate/.test(t.text)), 'a hint, once');
  assert.equal(V.tempter.profile.visitor, true, 'a visitor, not one of the eighteen');
  assert.ok(!VILLAGERS.includes(TEMPTER_ID));
  // He is talkable like anyone: the dialogue makes the offer; never the children.
  const d = V.tempter.getDialogue(g.player);
  assert.ok(d.lines.some((l) => /village/i.test(l)) && d.lines.some((l) => /little ones/i.test(l)), 'the offer, and never the little ones');
  assert.ok(d.options.some((o) => o.id === 'before') && d.options.some((o) => o.id === 'after') && d.options.some((o) => o.id === 'refuse'));
  g.clock.skipTo(9);
  step(g, 2);
  assert.equal(V.tempter, null, 'gone at dawn');
});

test('the chat reaches him: words heard and kept first; "teach me after" seals the pact by the game, not by the words', async () => {
  const g = makeGame({ hour: 22 });
  g.flags.bosses = { varek: { defeated: true, shards: {} } };
  step(g, 2);
  const t = g.villain.tempter;
  assert.ok(t);
  const r1 = await g.village.playerSays(t, 'Why should I trust you?');
  assert.ok(r1.lines.length && /trust|lie|told/i.test(r1.lines[0]), 'his own answer offline');
  assert.equal(g.villain.state.said.at(-1).text, 'Why should I trust you?', 'the words are kept');
  assert.equal(g.villain.hasPact(), false);
  const r2 = await g.village.playerSays(t, 'Fine. Teach me after.');
  assert.equal(g.villain.state.pact, 'after');
  assert.ok(events(g, 'pact_sealed').length === 1);
  assert.ok(r2.lines.length);
  // Others still go through the village as before.
  const bram = g.entities.get('bram');
  const r3 = await g.village.playerSays(bram, 'hello');
  assert.ok(Array.isArray(r3.lines));
});

test('kills: counted from villager_killed by the player only once known as killings; never villager_died; children never', () => {
  const g = makeGame({ hour: 12 });
  quietAll(g);
  const V = g.villain;
  V.seal('after');
  const garrick = g.entities.get('garrick');
  put(garrick, px(62), px(14));
  put(g.player, px(63), px(14));
  // A killing nobody saw, of an ordinary kind: no body found yet, not known.
  g.murder.kill(garrick);
  assert.deepEqual(V.state.kills, [], 'unseen and unfound: not yet known as a killing');
  g.murder.found('garrick', 'hess', 'whisperwood');
  V.settleKills();
  assert.deepEqual(V.state.kills, ['garrick'], 'found with a wound: a killing');
  // An Unkindling nobody saw (soul's cause): a mystery, even once found.
  const sabeth = g.entities.get('sabeth');
  put(sabeth, px(62), px(16));
  g.murder.kill(sabeth, { cause: 'unkindled', silent: true, unmarked: true });
  g.murder.found('sabeth', 'hess', 'whisperwood');
  V.settleKills();
  assert.ok(!V.state.kills.includes('sabeth'), 'no mark on her: not a killing to anyone yet');
  // Soul links it (a witness's account reached the village): now it counts.
  g.murder.dead.sabeth.linked = true;
  g.bus.emit('killing_known', { id: 'sabeth' });
  assert.ok(V.state.kills.includes('sabeth'));
  // A death nobody did never counts.
  const corran = g.entities.get('corran');
  g.murder.die(corran, { cause: 'age' });
  assert.ok(!V.state.kills.includes('corran') && !V.state.pending.includes('corran'));
  // Children are never required: Pip and Tansy are not among the adults the village is counted by.
  const adults = V.livingAdults();
  for (const id of adults) assert.equal(isMinor(g, id), false);
  assert.ok(!adults.includes('pip') && !adults.includes('tansy'));
});

test('the villain ending: the pact kept and the adults gone; the children live; the life closes', async () => {
  const g = makeGame({ hour: 12 });
  quietAll(g);
  let closed = null;
  g.save = { closeLife: async (m) => ((closed = m), true) };
  const V = g.villain;
  V.seal('before');
  for (const id of V.livingAdults()) {
    const e = g.entities.get(id);
    put(e, px(62), px(14));
    g.murder.kill(e);
    g.murder.dead[id].known = 'witnessed';
  }
  assert.equal(V.emptied(), true);
  assert.ok(g.entities.get('pip') && !g.murder.dead.pip, 'Pip lives');
  assert.ok(!g.murder.dead.tansy, 'Tansy lives');
  step(g, 1.5);
  assert.equal(V.state.ending, 'villain');
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(closed && /ruins are awake/.test(closed.cause), 'the end page, the life closed');
  assert.ok(events(g, 'villain_ending').some((p) => p.ending === 'villain'));
});

test('the hero ending: refuse, warn the watch, fight him: he comes apart; the save continues; a broken pact is Oathbreaker', async () => {
  const g = makeGame({ hour: 22 });
  g.flags.bosses = { varek: { defeated: true, shards: {} } };
  step(g, 2);
  const V = g.villain;
  V.seal('before');
  // Warn Rowan through his dialogue (the option the murder hook carries).
  const rowan = g.entities.get('rowan');
  const d = rowan.getDialogue(g.player);
  assert.ok(d.options.some((o) => o.id === 'murder:villain:warn'), 'Rowan can be told');
  const r = rowan.chooseOption('murder:villain:warn', g.player);
  assert.ok(r.lines.length);
  assert.deepEqual(V.state.warned, ['rowan']);
  assert.equal(V.state.betrayed, true);
  assert.equal(V.hasPact(), false, 'a betrayed pact is no pact');
  assert.ok(g.reputation.titles({ knownTo: 'rowan' }).some((t) => t.id === 'oathbreaker'), 'Rowan knows it: Oathbreaker');
  assert.ok(!g.reputation.titles({ knownTo: 'pip' }).some((t) => t.id === 'oathbreaker'), 'Pip was not told');
  // The fight: struck, he fights; downed, he comes apart.
  const t = V.tempter;
  g.combat.damage(g.player, t, 5, { exact: true });
  assert.equal(V.state.fighting, true);
  step(g, 1);
  t.hp = 1;
  g.combat.damage(g.player, t, 999, { exact: true });
  step(g, 1.5);
  assert.equal(V.state.ending, 'hero');
  assert.equal(g.entities.get(TEMPTER_ID), null, 'gone into the ground');
  assert.ok(g.reputation.titles({ knownTo: 'elda' }).some((x) => x.id === 'wardkeeper'));
});

test('saves round-trip; he is not saved as a villager', () => {
  const g = makeGame({ hour: 22 });
  g.flags.bosses = { varek: { defeated: true, shards: {} } };
  step(g, 2);
  g.villain.seal('after');
  g.villain.state.kills.push('garrick');
  const data = g.plugins.serialize();
  assert.equal(data.villain.pact, 'after');
  assert.equal(g.villain.tempter.serialize(), null);
  const g2 = makeGame({ hour: 12 });
  g2.plugins.deserialize(data);
  assert.equal(g2.villain.state.pact, 'after');
  assert.deepEqual(g2.villain.state.kills, ['garrick']);
  assert.equal(g2.villain.hasPact(), true);
});
