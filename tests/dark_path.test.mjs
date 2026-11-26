// The dark path you can leave (round 14b follow-up, plan §13c; DESIGN §38.7). The author:
// "when I want, I can stop and say no, or I have the choice. If I want to stop, I can. So we
// don't lock the story into that thing. Except maybe a storyline where the dark path asks me
// to kill someone. So if I kill it, of course I can't continue with the other story path."
//
// Say no at any time (in your own words, or by an option): the pact ends without warning
// anyone, you keep what you learned, he turns cold and stands against you on a later night
// (the hero ending stays open), and the broken word is Oathbreaker to whoever knows. Go back
// later, at a higher price. His single asks, one at a time, each refusable without ending
// the pact, never a child. What is done stays done: the dead stay dead, and their missions,
// roles, bonds and stories close or pass on, and the journal says so. Saves round-trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, px, put, events, villagers } from './society_world.mjs';
import { installUnkindle } from '../src/core/plugins/soul.js';
import { TEMPTER_ID, ASK_PEOPLE } from '../src/story/tempter_data.js';
import { STAND_RANGE, STAND_AFTER } from '../src/story/villain.js';
import { isMinor } from '../src/core/people.js';
import { FACTION } from '../src/core/constants.js';
import { MissionSystem } from '../src/missions/system.js';
import { staysDone, staysDoneAll, missionNote } from '../src/story/stays_done.js';
import { jurorsOf } from '../src/murder/jury.js';

// Night at the gate, a boss down (so he waits there), the Unkindling installed.
function gate({ hour = 22 } = {}) {
  const g = makeGame({ hour });
  g.flags.bosses = { varek: { defeated: true, shards: {} } };
  for (const v of villagers(g)) v.think = () => {};
  const unk = installUnkindle(g, { fx: false, view: false });
  step(g, 2);
  const V = g.villain;
  const t = V.tempter;
  assert.ok(t, 'he waits at the gate');
  return { g, V, t, unk };
}

// The next night at the gate (the clock runs on; he comes back at dark).
function nextNight(g) {
  g.clock.skipTo(12);
  step(g, 1.2);
  g.clock.skipTo(22);
  step(g, 1.2);
  return g.villain.tempter;
}

const says = (g, t, text) => g.village.playerSays(t, text);
const nobodyKnowsOathbreaker = (g) => [...villagers(g).map((v) => v.id), 'lyra'].every((id) => !g.reputation.titles({ knownTo: id }).some((x) => x.id === 'oathbreaker'));

test('say no in your own words: the pact ends without warning anyone; you keep the Unkindling; he turns cold; the broken word is known to him alone', async () => {
  const { g, V, t, unk } = gate();
  await says(g, t, 'Fine. Teach me after.');
  assert.equal(V.hasPact(), true);
  assert.equal(unk.learned, true, 'the pact taught the quiet hand');
  const r = await says(g, t, "I'm done. I won't kill for you anymore.");
  assert.equal(V.state.ended, true);
  assert.equal(V.hasPact(), false, 'the pact is over');
  assert.equal(V.state.hostile, true, 'he is your enemy now');
  assert.ok(t.opinionOfPlayer < 15, 'cold to you (the chat says so)');
  assert.ok(r.lines.length && /broken|word|friend/i.test(r.lines.join(' ')), `his own words: ${r.lines.join(' ')}`);
  assert.equal(V.state.said.at(-1).text, "I'm done. I won't kill for you anymore.", 'heard and kept first');
  assert.equal(unk.learned, true, 'what you learned stays learned');
  assert.deepEqual(V.state.warned, [], 'nobody was warned');
  assert.ok(!g.village.rumors.list.some((x) => x.kind === 'tempter_warning'), 'no word of it in the village');
  assert.ok(nobodyKnowsOathbreaker(g), 'Oathbreaker to those who know: nobody here knows');
  assert.equal(V.state.oathBroken, true, 'but the word is broken');
  assert.ok(events(g, 'pact_ended').some((p) => p.how === 'said' && p.kept === true));
  // The ending stays open: no villain ending even if the village later empties.
  assert.equal(V.state.ending, null);
});

test('or by an option, at any point; with Claude the game decides first and the brief says so', async () => {
  const { g, V, t } = gate();
  const tasks = [];
  g.village.provider = () => ({ id: 'stub' });
  g.village.askClaude = async (p, rules, task, schema, kind) => {
    tasks.push({ rules, task, kind });
    return { say: 'As you like, my friend.', silent: null };
  };
  const d = t.getDialogue(g.player);
  t.chooseOption('after', g.player);
  assert.equal(V.hasPact(), true);
  const d2 = t.getDialogue(g.player);
  assert.ok(d2.options.some((o) => o.id === 'end'), "\"I'm done. The pact is over.\" is always there");
  const r = t.chooseOption('end', g.player);
  assert.ok(r.lines.length);
  assert.equal(V.state.ended, true);
  void d;
  // The chat after: online, his brief carries the game's verdict (he is cold, the pact broken).
  const r2 = await says(g, t, 'So we are enemies now?');
  assert.equal(r2.lines[0], 'As you like, my friend.');
  assert.ok(/broke it/.test(tasks.at(-1).task) && /enemy/.test(tasks.at(-1).task), tasks.at(-1).task);
  assert.ok(/end the pact at any moment/.test(tasks.at(-1).rules), 'his persona knows the path can be left');
});

test('he stands against you on a later night (not the night you said it); a word holds him off; the hero ending stays open', async () => {
  const { g, V, t } = gate();
  await says(g, t, 'Teach me after.');
  await says(g, t, 'The pact is over.');
  assert.equal(V.state.ended, true);
  // The same night: he lets you go.
  put(g.player, t.x + 30, t.y);
  step(g, STAND_AFTER + 2);
  assert.equal(V.state.fighting, false, 'not the night you said it');
  const t2 = nextNight(g);
  assert.ok(t2, 'he is at the gate again');
  // A word to him holds it off (you may have come to go back).
  put(g.player, t2.x + 30, t2.y);
  await says(g, t2, 'Wait.');
  step(g, 3);
  assert.equal(V.state.fighting, false, 'talking: he waits');
  step(g, 8 + STAND_AFTER + 1);
  assert.equal(V.state.fighting, true, 'close, and silent: he stands against you');
  assert.equal(t2.faction, FACTION.UNDEAD);
  assert.ok(Math.hypot(g.player.x - t2.x, g.player.y - t2.y) < STAND_RANGE + 20);
  // The hero ending: downed, he comes apart; the save continues.
  t2.hp = 1;
  g.combat.damage(g.player, t2, 999, { exact: true });
  step(g, 1.5);
  assert.equal(V.state.ending, 'hero');
  assert.equal(g.entities.get(TEMPTER_ID), null);
});

test('go back later at a higher price: a named adult first (never a child); each return costs more; refusing the toll ends it again', async () => {
  const { g, V, t } = gate();
  await says(g, t, 'Teach me after.');
  await says(g, t, "I'm out.");
  const t2 = nextNight(g);
  const r = await says(g, t2, 'I changed my mind. I want the pact back.');
  const offer = V.state.returnOffer;
  assert.ok(offer && offer.toll.length === 1, 'the price: one named adult first');
  const name = g.entities.get(offer.toll[0].id).profile.name.split(' ')[0];
  assert.ok(r.lines.join(' ').includes(name), `he names the price: ${r.lines.join(' ')}`);
  assert.equal(isMinor(g, offer.toll[0].id), false);
  assert.equal(V.hasPact(), false, 'not until you agree');
  await says(g, t2, 'Yes. Whatever it costs.');
  assert.equal(V.hasPact(), true, 'the pact holds again');
  assert.equal(V.state.returns, 1);
  const toll = V.currentAsk();
  assert.ok(toll?.toll && toll.state === 'accepted' && toll.target === offer.toll[0].id);
  assert.equal(V.state.hostile, false);
  // Paying the toll: that person dies by your hand; the pact holds as it did.
  const e = g.entities.get(toll.target);
  put(e, px(62), px(14));
  put(g.player, px(63), px(14));
  g.murder.kill(e);
  assert.equal(toll.state, 'done');
  assert.equal(V.hasPact(), true);
  // Leave again, and come back again: the price is higher (two names).
  await says(g, V.tempter || t2, "I'm done.");
  assert.equal(V.state.ended, true);
  const t3 = nextNight(g);
  await says(g, t3, 'Take me back.');
  assert.equal(V.state.returnOffer.toll.length, 2, 'higher each time');
  for (const p of V.state.returnOffer.toll) assert.equal(isMinor(g, p.id), false);
  await says(g, t3, 'Yes.');
  assert.equal(V.state.returns, 2);
  // Refuse the toll: that is refusing the pact: it ends again.
  await says(g, t3, "No. I won't do that.");
  assert.equal(V.state.ended, true);
  assert.equal(V.hasPact(), false);
});

test('his single asks, one at a time: refusing one keeps the pact; never a child, never Lyra; a person, a soul, a flame', async () => {
  const { g, V, t, unk } = gate();
  t.chooseOption('after', g.player);
  // Not the night of the pact; the next night he asks.
  assert.equal(V.offerAsk(), null, 'not the night the pact was made');
  const t2 = nextNight(g);
  const d = t2.getDialogue(g.player);
  const a1 = V.currentAsk();
  assert.equal(a1.kind, 'person');
  const nm = g.entities.get(a1.target).profile.name.split(' ')[0];
  assert.ok(d.lines.join(' ').includes(nm), `he names them: ${d.lines.join(' ')}`);
  assert.ok(d.options.some((o) => o.id === 'ask_yes') && d.options.some((o) => o.id === 'ask_no'));
  // Only one at a time.
  assert.equal(V.offerAsk({ force: true }), null);
  t2.chooseOption('ask_no', g.player);
  assert.equal(a1.state, 'refused');
  assert.equal(V.hasPact(), true, 'refusing one ask never ends the pact');
  // The next night: a soul. Say yes in your own words.
  const t3 = nextNight(g);
  const r = await says(g, t3, 'Anything new?');
  const a2 = V.currentAsk();
  assert.equal(a2.kind, 'soul');
  assert.ok(/soul/i.test(r.lines.join(' ')));
  await says(g, t3, "Fine, I'll do it.");
  assert.equal(a2.state, 'accepted');
  // A wolf taken: carried for him, handed over at the gate (the bar gives back what it gave).
  const fill = unk.coldfire.take('beast', 10);
  g.bus.emit('unkindled', { id: 'wolf1', kind: 'beast', seen: [] });
  assert.ok(V.state.soulHeld);
  const bar = unk.coldfire.bar;
  t3.getDialogue(g.player);
  assert.equal(a2.state, 'done');
  assert.ok(Math.abs(unk.coldfire.bar - (bar - fill)) < 0.02, 'he took it');
  assert.ok(events(g, 'tempter_ask').some((p) => p.state === 'done' && p.gift?.id === 'dark'), 'paid: the wages early (an "after" pact)');
  // The next night: a flame. Yes; the chapel altar puts it out.
  const t4 = nextNight(g);
  t4.getDialogue(g.player);
  const a3 = V.currentAsk();
  assert.equal(a3.kind, 'flame');
  t4.chooseOption('ask_yes', g.player);
  const alt = V.altar();
  assert.ok(alt, 'the chapel altar');
  assert.equal(alt.interactLabel(), 'Put out a flame');
  for (const v of villagers(g)) put(v, px(141), px(101));
  put(g.player, alt.x, alt.y + 14);
  alt.interact(g.player);
  assert.equal(a3.state, 'done');
  assert.equal(V.state.flamesOut.length, 1);
  assert.notEqual(alt.interactLabel(), 'Put out a flame', 'the altar is an altar again');
  // Unseen: at dawn the keeper finds it dark, and nobody knows who.
  g.clock.skipTo(8);
  step(g, 1.5);
  assert.equal(V.state.flamesOut[0].found, true);
  assert.ok(g.village.rumors.list.some((x) => x.kind === 'flame_found_out'), 'a dark flame, nobody knows whose hand');
  assert.ok(!g.village.rumors.list.some((x) => x.kind === 'flame_snuffed'), 'unseen: not yours to anyone');
  // Never a child, never Lyra: even if the list named them, the game would skip them.
  ASK_PEOPLE.unshift({ id: 'tansy', why: 'x' }, { id: 'pip', why: 'x' }, { id: 'lyra', why: 'x' });
  try {
    for (let i = 0; i < 6; i++) {
      const p = V.pickPerson();
      if (!p) break;
      assert.ok(!['tansy', 'pip', 'lyra'].includes(p.id), `never ${p.id}`);
      assert.equal(isMinor(g, p.id), false);
      V.state.asks.push({ id: `x${i}`, kind: 'person', target: p.id, state: 'refused' });
    }
  } finally {
    ASK_PEOPLE.splice(0, 3);
  }
});

test('a person asked for: done when they die by your hand (pact or no pact later, it stays done); void if they die otherwise', async () => {
  const { g, V, t } = gate();
  t.chooseOption('after', g.player);
  const t2 = nextNight(g);
  t2.getDialogue(g.player);
  const a = V.currentAsk();
  assert.equal(a.kind, 'person');
  t2.chooseOption('ask_yes', g.player);
  const e = g.entities.get(a.target);
  put(e, px(62), px(14));
  put(g.player, px(63), px(14));
  g.murder.kill(e);
  assert.equal(a.state, 'done');
  // Leaving the pact now changes nothing that was done.
  await says(g, t2, "I'm done.");
  assert.ok(g.murder.dead[a.target], 'the dead stay dead');
  assert.equal(a.state, 'done');
  // Another ask, and its person dies of age before you do anything: void.
  const g2 = gate().g;
  const V2 = g2.villain;
  V2.tempter.chooseOption('after', g2.player);
  nextNight(g2).getDialogue(g2.player);
  const b = V2.currentAsk();
  V2.acceptAsk();
  g2.murder.die(g2.entities.get(b.target), { cause: 'age' });
  assert.equal(b.state, 'void');
  assert.equal(V2.hasPact(), true);
});

test('what is done stays done: a dead giver\'s missions pass on and the journal says so; their work, the Moot chair, the jury; who mourns', () => {
  const g = makeGame({ hour: 10 });
  for (const v of villagers(g)) v.think = () => {};
  g.missions = new MissionSystem(g);
  const ms = g.missions;
  assert.ok(ms.accept('spear_drill', { silent: true }), "Rowan's drill");
  const rowan = g.entities.get('rowan');
  put(rowan, px(62), px(14));
  put(g.player, px(63), px(14));
  g.murder.kill(rowan);
  // Not known yet: the journal waits for the village to know.
  assert.equal(staysDone(g, 'rowan'), null, 'nobody has found him yet');
  g.murder.found('rowan', 'hess', 'whisperwood');
  g.murder.dead.rowan.newsWaits = false;
  ms.update(1);
  const m = ms.get('spear_drill');
  assert.equal(ms.giverOf(m), 'wys', 'it passes to Wys');
  assert.ok(g.toasts.some((x) => /Rowan is dead\. Wys sees it done now/.test(x.text)), 'told once');
  const card = ms.journal().active.find((c) => c.id === 'spear_drill');
  assert.equal(card.note, 'Captain Rowan is dead. Wys sees it done now.');
  assert.equal(missionNote(g, m), card.note);
  const sd = staysDone(g, 'rowan');
  const text = sd.lines.map((l) => l.text).join('\n');
  assert.ok(/Hold the Line”: Wys sees it done now/.test(text), text);
  assert.ok(/Wys keeps the watch now/.test(text), text);
  assert.ok(/seat at the Moot is empty/.test(text), text);
  assert.equal(sd.cause, 'Killed');
  // The jury: the dead never sit.
  assert.ok(!jurorsOf(g.murder, 'nobody').includes('rowan'));
  // The chair passes when its keeper dies.
  const alder = g.entities.get('alder');
  put(alder, px(62), px(16));
  g.murder.kill(alder);
  g.murder.found('alder', 'hess', 'whisperwood');
  g.murder.dead.alder.newsWaits = false;
  assert.ok(staysDone(g, 'alder').lines.some((l) => /Elda takes the chair at the Moot/.test(l.text)));
  // A death nobody did (old age) closes and passes the same way, as a death, not a killing.
  const corran = g.entities.get('corran');
  g.murder.die(corran, { cause: 'age' });
  g.murder.dead.corran.foundAt = 1;
  g.murder.dead.corran.newsWaits = false;
  const c = staysDone(g, 'corran');
  assert.equal(c.cause, 'Died of old age');
  assert.ok(c.lines.some((l) => /Mirror Lake|fishes/.test(l.text)), 'his work stays undone, and the village feels it');
  // Everyone known dead, newest first, in the journal's own list.
  const all = ms.journal().gone.map((x) => x.id);
  assert.ok(all.includes('rowan') && all.includes('alder') && all.includes('corran'));
  assert.deepEqual(staysDoneAll(g).map((x) => x.id), all);
});

test('saves round-trip: an ended pact, his enmity, an offered return, his asks, a flame out, a soul carried', async () => {
  const { g, V, t } = gate();
  await says(g, t, 'Teach me after.');
  const t2 = nextNight(g);
  t2.getDialogue(g.player);
  V.acceptAsk();
  V.state.soulHeld = null;
  V.state.flamesOut.push({ house: 'bram', day: 2, night: 2, seen: ['hess'], found: false });
  await says(g, t2, "I'm done.");
  await says(g, t2, 'I want it back.');
  assert.ok(V.state.returnOffer);
  const data = JSON.parse(JSON.stringify(g.plugins.serialize()));
  const g2 = makeGame({ hour: 12 });
  g2.plugins.deserialize(data);
  const s2 = g2.villain.state;
  assert.equal(s2.ended, true);
  assert.equal(s2.hostile, true);
  assert.equal(s2.oathBroken, true);
  assert.deepEqual(s2.returnOffer.toll, V.state.returnOffer.toll);
  assert.deepEqual(s2.asks, V.state.asks);
  assert.deepEqual(s2.flamesOut, V.state.flamesOut);
  assert.equal(g2.villain.hasPact(), false);
  // An old save (before §13c) reads with no ended pact and no asks.
  const old = { ...data.villain };
  for (const k of ['ended', 'endedDay', 'endedNight', 'endedHow', 'oathBroken', 'oathKnownBy', 'hostile', 'returns', 'returnOffer', 'asks', 'askNight', 'soulHeld', 'flamesOut']) delete old[k];
  old.betrayed = false;
  const g3 = makeGame({ hour: 12 });
  g3.villain.deserialize(old);
  assert.equal(g3.villain.state.ended, false);
  assert.deepEqual(g3.villain.state.asks, []);
  assert.equal(g3.villain.hasPact(), true);
});

test('a price named and never answered is off the table the next night: he stands against you then', async () => {
  const { g, V, t } = gate();
  await says(g, t, 'Teach me after.');
  await says(g, t, "I'm done.");
  const t2 = nextNight(g);
  await says(g, t2, 'Take me back.');
  assert.ok(V.state.returnOffer, 'the price is named');
  // Walk away without an answer; the next night, silent beside him.
  const t3 = nextNight(g);
  put(g.player, t3.x + 30, t3.y);
  step(g, 8 + STAND_AFTER + 2);
  assert.equal(V.state.returnOffer, null, 'no longer on the table');
  assert.equal(V.state.fighting, true);
});

test('he does not go at dawn while a line of yours waits its turn in the chat: every message is delivered first', () => {
  const { g, V } = gate();
  g.ui.chat.waiting = new Set();
  g.ui.chat.queued = new Map([[TEMPTER_ID, "I'm done."]]);
  g.clock.skipTo(9);
  step(g, 2);
  assert.ok(V.tempter, 'he stays to hear it');
  g.ui.chat.queued.clear();
  step(g, 2);
  assert.equal(V.tempter, null, 'then he is gone at dawn');
});
