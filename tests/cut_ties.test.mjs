import { test } from 'node:test';
import assert from 'node:assert/strict';

// Round 14b T-4 (the author: "if Lyra cut ties with me, I can't talk to her anymore", and
// later "even if somebody really hates me, make me able to talk to them"). Cutting ties ends
// the companionship, never the talk: they hear every word, keep it, and answer as they feel.

import { makeGame, clearScene, put } from './murder_world.mjs';
import { notesOf } from '../src/ai/social/player_talk.js';
import { TalkSession } from '../src/ui/village_view.js';

const quiet = () => {
  const w = console.warn;
  console.warn = () => {};
  return () => {
    console.warn = w;
  };
};

test('a villager who cut ties still hears you and answers, coldly or with a shown silence; the brief says so', async () => {
  const g = makeGame({ hour: 11 });
  clearScene(g, ['hess']);
  const hess = g.entities.get('hess');
  put(g.player, hess.x + 16, hess.y);
  hess.opinionOfPlayer = 50;
  g.village.noteCutTies('hess', 'you dragged me into a fight that was not mine');
  assert.equal(g.village.standing('hess').cold, true);
  const talk = new TalkSession({ village: g.village, npc: hess });
  const a = await talk.send('Hess, I need you');
  const b = await talk.send('please, Hess');
  for (const [t, r] of [['Hess, I need you', a], ['please, Hess', b]]) {
    assert.equal(r.ok, true, `an answer or a shown act: ${r.lines[0]}`);
    assert.ok(g.village.talks.hess.some((x) => x.you === t), `kept: ${t}`);
  }
  assert.ok(b.silent || b.lines.length, 'pressed, she may say nothing: shown as an act');
  assert.ok(notesOf(g.village, 'hess').some((n) => /broke with you/.test(n.text)));
  const brief = g.village.sayBrief(hess, 'hello', { lines: ['Hm.'] });
  assert.match(brief.standing, /You broke with them \(you dragged me into a fight/);
  // Saved and loaded.
  const d = JSON.parse(JSON.stringify(g.village.serialize()));
  g.village.cutTies = {};
  g.village.deserialize(d);
  assert.ok(g.village.cutTies.hess);
  // Something real mends it: an apology, then a deed.
  g.village.amend('hess', 'apology');
  assert.ok(g.village.cutTies.hess, 'words alone do not');
  g.village.amend('hess', 'help');
  assert.equal(g.village.cutTies.hess, undefined, 'an apology and help: mended');
});

test('Lyra cut off: she never follows while gone; a promise (words) lands; a request gets her no, spoken', async () => {
  const back = quiet();
  const g = makeGame({ hour: 10 });
  const L = g.companion;
  put(L, g.player.x + 30, g.player.y);
  L.mind.autonomy.setCompanionship('gone', 'You hurt me.', { cause: 'downed', goneReason: 'downed', silent: true });
  const r = g.actions.run('follow', { target: 'player' }, 'player');
  assert.equal(r.ok, false, 'she follows nowhere');
  assert.ok(r.message, `her no is spoken: ${r.message}`);
  const { answerGone } = await import('../src/ai/brain/her_state.js');
  assert.ok(answerGone(g));
  const rejoin = L.mind.autonomy.rejoin({ asked: true });
  assert.equal(rejoin.ok, false);
  assert.equal(L.mind.autonomy.companionship, 'gone');
  back();
});
