import { test } from 'node:test';
import assert from 'node:assert/strict';

// Round 14b T-5 (the author: "you can leave me. But like not like this."). Lyra's leaving is
// a scene in the world: she walks up, faces you, says why, the chat is open for an answer,
// then a letter, then she goes home. It never traps the player.

import { makeGame, step, put } from './murder_world.mjs';
import { partingLines, lastLine, letterText } from '../src/ai/mind/autonomy_parting.js';

const quiet = () => {
  const w = console.warn;
  const e = console.error;
  console.warn = () => {};
  console.error = () => {};
  return () => {
    console.warn = w;
    console.error = e;
  };
};

function scene({ fear = 0 } = {}) {
  const g = makeGame({ hour: 11, settings: { partingScene: true } });
  const L = g.companion;
  const P = g.player;
  const sq = g.locations.get('town_square').center;
  put(P, sq.x, sq.y);
  put(L, sq.x + 6 * 16, sq.y);
  const a = L.mind.autonomy;
  if (fear) a.adjustPlayer?.({ fear }, 'test');
  a.recordDeed('attacked_villager', { victim: 'pip' });
  return { g, L, P, a };
}

function lyraLines(g) {
  return g.said.filter((s) => s.who === 'lyra').map((s) => s.text);
}

test('her reasons, from her ledger, and her decision; her last line answers yours, never the decision', () => {
  const a = { ledger: [{ deed: 'attacked_villager', severity: -3, t: 100, text: 'Attacked one of the villagers.' }], now: () => 200, daySeconds: () => 900 };
  const l = partingLines(a, 'left', { P: 'Ash', reason: 'You hurt Pip.' });
  assert.ok(l.length >= 2 && l.length <= 4);
  assert.match(l.join(' '), /You attacked one of the villagers/);
  assert.match(l.at(-1), /not walking with you/);
  assert.match(lastLine('left', "I'm sorry, I was wrong"), /doesn't change this/);
  assert.match(lastLine('gone', ''), /Look after yourself/);
  for (const t of [...l, lastLine('gone', 'whatever'), letterText(a, 'gone', { P: 'Ash' })]) assert.doesNotMatch(t, /\b(kill|hurt you|you'll pay|or else)\b/i, 'Lyra never threatens');
});

test('she walks up, faces you and says 2–4 lines; the chat is open to her; your answer is heard and kept; then the letter in your bag', async () => {
  const back = quiet();
  const { g, L, P, a } = scene();
  let opened = 0;
  g.ui.talkTo = (id) => {
    opened += id === 'lyra' ? 1 : 0;
    return true;
  };
  a.setCompanionship('left', 'You hurt Pip.', { cause: 'villager', lineKey: 'to_left_villager' });
  assert.equal(a.parting.active, true, 'the scene runs');
  for (let i = 0; i < 40 && Math.hypot(L.x - P.x, L.y - P.y) > 2 * 16; i++) step(g, 0.5);
  assert.ok(Math.hypot(L.x - P.x, L.y - P.y) <= 2.5 * 16, 'she came to you');
  step(g, 12);
  const said = lyraLines(g);
  assert.ok(said.length >= 2, `she spoke: ${said.join(' | ')}`);
  assert.equal(opened, 1, 'the chat opened to her');
  // The player answers: the words reach her mind (the brain logs them), her last line answers.
  const r = await g.brain.handlePlayerMessage("Lyra, I'm sorry. Please don't go.");
  assert.ok(!r.unreachable);
  assert.ok(L.mind.conversation.some((c) => c.role === 'player' && /please don't go/i.test(c.text)), 'heard and kept');
  step(g, 3);
  assert.equal(a.parting.active, false, 'the scene ended');
  assert.ok(lyraLines(g).some((t) => /heard you|going anyway|doesn't change/i.test(t)), 'her last line answers yours');
  assert.equal(P.inventory.count('lyra_letter'), 1, 'her letter, in your bag');
  assert.match(g.flags.lyra_letter.text, /— Lyra/);
  assert.ok(g.village.rumors.list.some((x) => x.kind === 'lyra_left'), 'the village hears');
  back();
});

test('afraid of you: no walk-up; the letter is left on the Wayhouse table', () => {
  const back = quiet();
  const { g, a } = scene({ fear: 80 });
  a.setCompanionship('left', 'You frighten me.', { cause: 'fear_left' });
  assert.equal(a.parting.active, false, 'no scene');
  assert.equal(g.player.inventory.count('lyra_letter'), 0);
  assert.equal(g.flags.lyra_letter?.onTable, true, 'left on the table');
  const pickup = g.entities.all().find((e) => e.itemId === 'lyra_letter');
  const wh = g.locations.get('player_home');
  assert.ok(pickup && wh && Math.hypot(pickup.x - wh.center.x, pickup.y - wh.center.y) < 4, 'at the Wayhouse');
  back();
});

test('walking away ends it: never trapped; the letter waits at the Wayhouse', () => {
  const back = quiet();
  const { g, L, P, a } = scene();
  g.ui.talkTo = () => true;
  a.setCompanionship('gone', 'You hurt me.', { cause: 'violence', goneReason: 'other' });
  for (let i = 0; i < 40 && Math.hypot(L.x - P.x, L.y - P.y) > 2 * 16; i++) step(g, 0.5);
  step(g, 2);
  P.x += 12 * 16;
  step(g, 1.5);
  assert.equal(a.parting.active, false, 'it ended when you walked off');
  assert.equal(g.flags.lyra_letter?.onTable, true);
  back();
});

test('a save in the middle of the scene: on load it is over, and the letter is on the table', () => {
  const back = quiet();
  const { g, a } = scene();
  g.ui.talkTo = () => true;
  a.setCompanionship('left', 'You hurt Pip.', { cause: 'villager' });
  assert.equal(a.parting.active, true);
  const d = JSON.parse(JSON.stringify(a.serialize()));
  assert.ok(d.parting);
  a.deserialize(d);
  assert.equal(a.parting.active, false);
  assert.ok(g.flags.lyra_letter?.text);
  back();
});

test('a dead Lyra has no scene and no letter', () => {
  const back = quiet();
  const { g, a } = scene();
  g.murder.isDead = (id) => id === 'lyra';
  a.setCompanionship('gone', 'x', { cause: 'violence' });
  assert.equal(a.parting.active, false);
  assert.equal(g.flags.lyra_letter, undefined);
  back();
});

test('the letter reads in a paper panel (closable), and the bag offers "Read"', async () => {
  const { letterOf } = await import('../src/ui/letter_view.js');
  const L = letterOf({ flags: { lyra_letter: { text: 'Ash,\n\nI am going home.\n\n— Lyra', day: 4 } } });
  assert.equal(L.title, "Lyra's letter");
  assert.deepEqual(L.paragraphs, ['Ash,', 'I am going home.', '— Lyra']);
  const { ITEMS } = await import('../src/entities/items.js');
  assert.equal(ITEMS.lyra_letter.type, 'letter');
  assert.equal(ITEMS.lyra_letter.unsellable, true);
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('../src/ui/inventory.js', import.meta.url), 'utf8'), /def\.type === 'letter'\) actions\.append\(button\('Read'/);
});
