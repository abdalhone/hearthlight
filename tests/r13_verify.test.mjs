// Round 13, the independent verifier's findings: each test is a place where the author's
// playtest list, replayed by touch and with the mouse on the merged build, still went wrong.
//   - Lyra in another house took a beating she never saw onto her ledger: a 'crime' event
//     (someone else saw it) reached her as if she had ("Lyra saw it from another house").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, step, px, put, holdLyra, downBy, villagers } from './murder_world.mjs';

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
