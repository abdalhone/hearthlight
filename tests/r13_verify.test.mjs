// Round 13, the independent verifier's findings: each test is a place where the author's
// playtest list, replayed by touch and with the mouse on the merged build, still went wrong.
//   - Lyra in another house took a beating she never saw onto her ledger: a 'crime' event
//     (someone else saw it) reached her as if she had ("Lyra saw it from another house").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, step, px, put, holdLyra, downBy, villagers } from './murder_world.mjs';
import { ObjectManager, makeObject } from '../src/world/objects.js';
import { MEND, breakSpec } from '../src/world/breakables.js';
import { makeGame as makeArena, step as stepArena, resetArena, W, H } from './magic_helpers.mjs';

const quietConsole = () => {
  const keep = { log: console.log, info: console.info, warn: console.warn };
  console.log = console.info = console.warn = () => {};
  return () => Object.assign(console, keep);
};

// Everyone but `keep` far off and held; Lyra too unless kept.
function quiet(g, keep = []) {
  for (const v of villagers(g)) {
    if (keep.includes(v.id)) continue;
    put(v, px(141) + Math.random() * 20, px(101));
    v.think = () => {};
  }
  if (!keep.includes('lyra')) holdLyra(g, px(150), px(112));
}
const hold = (e) => {
  e.think = () => {};
  e.walker?.stop?.();
};
const deeds = (g) => g.companion.mind.autonomy.ledger.filter((e) => e.deed === 'attacked_villager' || e.deed === 'downed_villager').map((e) => e.deed);

// A floor tile inside a building, away from its walls.
function inside(g, id) {
  const b = g.locations.get(id).bounds;
  for (let ty = b.y + 2; ty < b.y + b.h - 2; ty++)
    for (let tx = b.x + 2; tx < b.x + b.w - 2; tx++) if (!g.isBlockedTile(tx, ty, null) && !g.isBlockedTile(tx + 1, ty, null) && !g.isBlockedTile(tx + 2, ty, null)) return { tx, ty };
  throw new Error(`no floor in ${id}`);
}

test('Lyra in another house never takes a beating someone else saw onto her ledger', () => {
  const back = quietConsole();
  const g = makeGame({ hour: 12 });
  quiet(g, ['tobias', 'tilly']);
  const tobias = g.entities.get('tobias');
  const tilly = g.entities.get('tilly');
  hold(tobias);
  hold(tilly);
  // In the general store: the stranger, Tobias, and Tilly watching. Lyra sits in the Kettle.
  const s = inside(g, 'general_store');
  put(g.player, px(s.tx), px(s.ty));
  put(tobias, px(s.tx + 1), px(s.ty));
  put(tilly, px(s.tx + 2), px(s.ty));
  const k = g.locations.get('ember_kettle').center;
  holdLyra(g, k.x, k.y);
  g.combat.damage(g.player, tobias, 3, { exact: true, crit: false });
  step(g, 1.5, 1 / 10);
  assert.ok(g.player.crime, 'Tilly saw it: the crime is on record');
  downBy(g, tobias);
  step(g, 1.5, 1 / 10);
  assert.equal(g.player.crime?.kind, 'knockout');
  assert.deepEqual(deeds(g), [], 'she was in the Kettle: she saw none of it');
  // The same blows with her standing by in the room: she saw, and it counts.
  const g2 = makeGame({ hour: 12 });
  quiet(g2, ['tobias', 'lyra']);
  const t2 = g2.entities.get('tobias');
  hold(t2);
  const s2 = inside(g2, 'general_store');
  put(g2.player, px(s2.tx), px(s2.ty));
  put(t2, px(s2.tx + 1), px(s2.ty));
  holdLyra(g2, px(s2.tx + 2), px(s2.ty));
  g2.combat.damage(g2.player, t2, 3, { exact: true, crit: false });
  step(g2, 1.5, 1 / 10);
  downBy(g2, t2);
  step(g2, 1.5, 1 / 10);
  assert.ok(deeds(g2).includes('attacked_villager') && deeds(g2).includes('downed_villager'), `she saw it: ${deeds(g2)}`);
  back();
});

test('a blow nobody saw, told later by the one who took it, is news to Lyra far away, not a sight', () => {
  const back = quietConsole();
  const g = makeGame({ hour: 12 });
  quiet(g, ['tobias', 'mira']);
  const tobias = g.entities.get('tobias');
  const mira = g.entities.get('mira');
  hold(tobias);
  hold(mira);
  const WOODS = { tx: 62, ty: 14 };
  put(tobias, px(WOODS.tx + 1), px(WOODS.ty));
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  downBy(g, tobias);
  assert.ok(g.murder.isSecret('tobias'));
  // Mira reaches him; he tells her. The crime is known from now on, to the village.
  put(mira, tobias.x + 20, tobias.y);
  step(g, 1, 1 / 10);
  assert.ok(!g.murder.isSecret('tobias'), 'he told Mira');
  assert.equal(g.player.crime?.kind, 'knockout');
  assert.deepEqual(deeds(g), [], 'Lyra, far off, did not see it happen');
  back();
});

// "where is she?" in the chapel walk was answered "Corran's Net-Shed is east of here": the
// pronoun went to the place finder, which found "she" inside "Net-Shed".
test('"where is she?" means the person this talk is about, never a place with "she" in its name', async () => {
  const back = quietConsole();
  const { makeGame: makeSurvival, placeAt } = await import('./survival_world.mjs');
  const g = makeSurvival({ hour: 10 });
  const L = g.companion;
  placeAt(g, L, g.player.x + 24, g.player.y);
  // On her outing to Aveline (DESIGN §16.11): "she" is Aveline.
  L.mind.autonomy.outings.current = { npc: 'aveline', at: 'chapel', phase: 'go', topic: 'Maren' };
  const r1 = await g.brain.handlePlayerMessage('where is she?');
  assert.doesNotMatch(r1.say, /Net-Shed|Shed/i, r1.say);
  assert.match(r1.say, /Aveline/, r1.say);
  // No outing: the last one named between them.
  L.mind.autonomy.outings.current = null;
  L.mind.conversation.push({ role: 'lyra', text: 'Bram gave me tea once.', t: g.time });
  const r2 = await g.brain.handlePlayerMessage('where is he?');
  assert.match(r2.say, /Bram/, r2.say);
  // Nobody named at all: she asks who.
  L.mind.conversation.length = 0;
  const r3 = await g.brain.handlePlayerMessage('where is she?');
  assert.match(r3.say, /Who do you mean/, r3.say);
  back();
});

// "Go and talk to Lyra for me": Elda went, Lyra remembered the message, but asked "did Elda
// tell you anything?" she gave her stock sketch of Elda instead.
test('asked "did Elda tell you anything?", Lyra answers from the message she really got', async () => {
  const back = quietConsole();
  const { makeGame: makeSurvival, placeAt } = await import('./survival_world.mjs');
  const g = makeSurvival({ hour: 11 });
  const L = g.companion;
  placeAt(g, L, g.player.x + 24, g.player.y);
  const before = await g.brain.handlePlayerMessage('did Elda tell you anything?');
  assert.match(before.say, /Elda hasn't said a word/, before.say);
  L.mind.autonomy.hearMessage({ from: 'elda', fromName: 'Elda', text: "I'm sorry about earlier" });
  for (const q of ['did Elda tell you anything?', 'has Elda been to see you?', 'did you get my message?']) {
    const r = await g.brain.handlePlayerMessage(q);
    assert.match(r.say, /Elda did[^]*sorry about earlier/, `${q} -> ${r.say}`);
  }
  back();
});

// A bomb on the Holloways' barrels (the barrels nearest the square) did nothing: a prop with
// words to read was spared as if a story needed it. Only a `story` prop is spared now.
test('a heavy weave breaks a barrel you can look at; it reads again once mended; a story prop stays', () => {
  const g = makeArena({ foes: 0, party: false });
  g.objects = new ObjectManager(g, W, H);
  g.bubbles = { number: () => {} };
  g.magic.unlockAll();
  resetArena(g);
  const run = (seconds, dt = 1 / 60) => {
    for (let i = 0, n = Math.round(seconds / dt); i < n; i++) {
      stepArena(g, dt);
      g.objects.update(dt);
    }
  };
  const looks = g.objects.add(makeObject(g, { objType: 'barrel', tx: 12, ty: 14, solid: true, low: true, text: "Barrels from the Holloways' yard.", name: "Holloways' barrels" }));
  const kept = g.objects.add(makeObject(g, { objType: 'crate', tx: 16, ty: 14, solid: true, low: true, story: true, text: 'Evidence.', name: 'Stolen crate' }));
  assert.ok(breakSpec(looks), 'something to look at still breaks');
  assert.equal(breakSpec(kept), null, 'a story prop never does');
  g.magic.resetCooldowns();
  const r = g.magic.cast(g.player, { shape: 'throw', essences: ['raw'] }, { x: looks.x, y: looks.y - 6 }, { free: true });
  assert.ok(r.ok, r.reason);
  run(1.5);
  assert.equal(looks.state.broken, true, 'the bomb broke it');
  assert.equal(looks.canInteract?.(g.player) ?? false, false, 'rubble has nothing to read');
  g.player.x = 4 * 16;
  g.clock.t += MEND + 1;
  run(0.1);
  assert.equal(looks.state.broken, false, 'mended');
  assert.ok(looks.canInteract?.(g.player), 'and its words are back');
});

// Replayed: three killings in front of Elda. After she saw one, the next victim's cry for
// help turned her (a tender by trade) back to kneel by the body at the killer's feet. A
// terrified witness keeps clear of the stranger: never tends, shields or fetches beside them.
test('a witness in terror of the stranger never turns back to tend a new victim at their feet', () => {
  const back = quietConsole();
  const g = makeGame({ hour: 12 });
  quiet(g, ['tobias', 'corran', 'elda']);
  const [tobias, corran, elda] = ['tobias', 'corran', 'elda'].map((id) => g.entities.get(id));
  hold(tobias);
  hold(corran);
  const WOODS = { tx: 62, ty: 14 };
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  put(tobias, px(WOODS.tx + 1), px(WOODS.ty));
  put(corran, px(WOODS.tx), px(WOODS.ty + 1));
  put(elda, px(WOODS.tx + 4), px(WOODS.ty));
  // Tobias is struck down: Elda, a tender by trade, comes to tend him.
  downBy(g, tobias);
  elda.startHelp(tobias, g.player, 3, tobias.x, tobias.y, 50);
  assert.equal(elda.help?.role, 'tend');
  // Then she watches the stranger kill him, and runs for the watch.
  put(elda, px(WOODS.tx + 3), px(WOODS.ty));
  g.murder.kill(tobias, g.player);
  assert.equal(g.murder.fearOf(elda), 'terror', 'she saw it');
  assert.equal(elda.mode, 'flee');
  // Her flight ends (she has told the watch, or run her course): not back to the body.
  elda.endFlee();
  assert.notEqual(elda.mode, 'help', 'not back to kneel at the killer\'s feet');
  // The stranger strikes Corran, who cries out: she keeps clear.
  downBy(g, corran);
  g.bus.emit('call_for_help', { victim: 'corran', victimEntity: corran, attacker: 'player', attackerEntity: g.player, x: corran.x, y: corran.y, severity: 3 });
  step(g, 0.5, 1 / 10);
  assert.notEqual(elda.mode, 'help', `she keeps clear (${elda.mode} ${elda.help?.role || ''})`);
  back();
});

// Replayed by the chat: Elda shrugged "I couldn't say. Ask Petra." twice running while her
// other shrug was unsaid, and asked "what were you just saying?" she could not say, though the
// words had just popped over her head. The bubble and the chat are one memory (DESIGN §23.1).
test('a villager quotes what she said today, bubble or chat, and does not shrug the same way twice', async () => {
  const back = quietConsole();
  const { makeGame: makeSurvival, placeAt } = await import('./survival_world.mjs');
  const g = makeSurvival({ hour: 10 });
  const elda = g.entities.get('elda');
  placeAt(g, g.player, elda.x + 18, elda.y);
  // Over her head, to Pip, before the player spoke to her.
  g.saidToday.note('elda', 'Pip! Boots off the table!', { kind: 'say', to: 'pip', via: 'bubble' });
  const r1 = await g.village.playerSays(elda, 'what were you just saying?');
  assert.equal(r1.intent, 'recall');
  assert.match(r1.lines[0], /Boots off the table/);
  const r2 = await g.village.playerSays(elda, 'what did you say to Pip?');
  assert.match(r2.lines[0], /Boots off the table/);
  // Two questions she has no answer to: two different shrugs.
  const a = await g.village.playerSays(elda, 'how is the baking going?');
  const b = await g.village.playerSays(elda, 'what are you baking?');
  assert.equal(a.intent, 'unknown');
  assert.notEqual(a.lines.join(' '), b.lines.join(' '), `${a.lines} / ${b.lines}`);
  back();
});

// Replayed: carried off downed by the watch, the player heard Lyra start on her chapel walk
// ("Maren went over the ruins wall at midsummer…"). No outing is proposed to someone lying downed.
test('Lyra proposes no outing while the player lies downed or is carried', async () => {
  const back = quietConsole();
  const { makeGame: makeSurvival, placeAt } = await import('./survival_world.mjs');
  const g = makeSurvival({ hour: 10 });
  const L = g.companion;
  const a = L.mind.autonomy;
  placeAt(g, L, g.player.x + 24, g.player.y);
  g.plugins.get('quest')?.advance?.(g.plugins.ctx, 1, 'test');
  const ready = () => {
    a.lastInitiativeT = -1e9;
    a.lastSpokeT = -1e9;
    a.pendingRequest = null;
    a.asked = {};
  };
  ready();
  g.player.downed = true;
  a._initiative();
  assert.equal(a.pendingRequest ?? null, null, 'not while downed');
  g.player.downed = false;
  ready();
  a._initiative();
  assert.match(JSON.stringify(a.pendingRequest?.spec || {}), /chapel/, 'on their feet, she asks');
  back();
});
