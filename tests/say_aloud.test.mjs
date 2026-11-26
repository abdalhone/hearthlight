import { test } from 'node:test';
import assert from 'node:assert/strict';

// Round 14b T-2 (the author: "I want to be able to say things out loud, like everyone around
// me can hear it"). Who hears is the hearing rule (src/ai/hearing.js), never a bare distance;
// those who hear it clearly keep the words; at most four answer, in one batched call.

import { makeGame, clearScene, put } from './murder_world.mjs';
import { notesOf } from '../src/ai/social/player_talk.js';
import { coerceAloud, buildAloudTask } from '../src/ai/social/village_prompt.js';

const quiet = () => {
  const w = console.warn;
  console.warn = () => {};
  return () => {
    console.warn = w;
  };
};

// The square at noon: Bram, Elda and Tobias around the player; Lyra far off.
function square() {
  const g = makeGame({ hour: 12 });
  clearScene(g, ['bram', 'elda', 'tobias', 'pip']);
  const sq = g.locations.get('town_square').center;
  put(g.player, sq.x, sq.y);
  put(g.entities.get('bram'), sq.x + 30, sq.y);
  put(g.entities.get('elda'), sq.x - 30, sq.y + 10);
  put(g.entities.get('tobias'), sq.x, sq.y + 40);
  put(g.entities.get('pip'), sq.x + 600, sq.y);
  put(g.companion, sq.x + 900, sq.y + 300);
  return { g, sq };
}

test('said aloud: exactly one provider call for three listeners; everyone who heard keeps the words; the far one hears nothing', async () => {
  const { g } = square();
  const v = g.village;
  const tasks = [];
  v.provider = () => ({ id: 'fake' });
  v.askClaude = async (p, rules, task, schema, kind) => {
    tasks.push({ task, kind });
    return { replies: [{ who: 'elda', say: 'Morning, love!', action: null, mood: 'warm', opinion_delta: 1, memory: null }, { who: 'bram', say: 'Hmph. Morning.', action: null, mood: 'neutral', opinion_delta: 0, memory: null }] };
  };
  const r = await v.sayAloud('Good morning, Hearthvale');
  assert.equal(tasks.length, 1, 'one call for them all');
  assert.equal(tasks[0].kind, 'aloud');
  assert.match(tasks[0].task, /Good morning, Hearthvale/);
  assert.ok(['bram', 'elda', 'tobias'].every((id) => r.hearers.some((h) => h.id === id && h.how === 'clear')), JSON.stringify(r.hearers));
  assert.ok(!r.hearers.some((h) => h.id === 'pip'), 'Pip is too far away');
  assert.deepEqual(r.replies.map((x) => x.id).sort(), ['bram', 'elda']);
  // Tobias did not answer, but he heard it and keeps it.
  for (const id of ['bram', 'elda', 'tobias']) {
    assert.ok(v.talks[id].some((t) => t.you === 'Good morning, Hearthvale' && !t.pending), `${id} keeps the words`);
    assert.ok(notesOf(v, id).some((n) => /said aloud/.test(n.text)), `${id} remembers it was said aloud`);
  }
  assert.ok(!v.talks.pip?.length, 'Pip never heard it');
});

test('said aloud, offline or when Claude fails: their own words, locally', async () => {
  const back = quiet();
  const { g } = square();
  const v = g.village;
  v.provider = () => ({ id: 'fake' });
  v.askClaude = async () => null; // a timeout or a failure
  const r = await v.sayAloud('Hello, everyone!');
  assert.ok(r.replies.length >= 1, 'local answers');
  for (const x of r.replies) assert.ok(x.lines.length || x.narration);
  v.provider = () => null;
  v.aloudCalls = null;
  const r2 = await v.sayAloud('Does anyone know where the ruins key is?');
  assert.ok(r2.replies.length >= 1);
  back();
});

test('a threat said aloud: a rumour with every hearer as a witness, and they think less of you', async () => {
  const { g } = square();
  const v = g.village;
  v.provider = () => null;
  const before = g.entities.get('tobias').opinionOfPlayer;
  await v.sayAloud("I'll kill every one of you");
  const r = v.rumors.list.find((x) => x.kind === 'threat');
  assert.ok(r, 'a threat rumour');
  for (const id of ['bram', 'elda', 'tobias']) assert.ok(r.heardBy.includes(id) || (r.witnesses || []).includes(id), `${id} witnessed it`);
  assert.ok(g.entities.get('tobias').opinionOfPlayer < before);
});

test('a shout reaches farther; HELP! is a cry for help by the one rule for ears', async () => {
  const { g, sq } = square();
  const v = g.village;
  v.provider = () => null;
  put(g.entities.get('pip'), sq.x + 200, sq.y);
  const calm = await v.sayAloud('is anyone there');
  assert.ok(!calm.hearers.some((h) => h.id === 'pip'), 'said, Pip is out of reach');
  const cries = [];
  g.bus.on('call_for_help', (p) => cries.push(p));
  const loud = await v.sayAloud('HELP!');
  assert.equal(loud.shout, true);
  assert.equal(loud.help, true);
  assert.ok(loud.hearers.some((h) => h.id === 'pip'), 'shouted, it carries to Pip');
  assert.equal(cries.length, 1);
  assert.equal(cries[0].victimEntity, g.player);
  assert.equal(cries[0].attacker, null, 'a cry tells what and where, never who');
});

test('through a wall, only a voice: those inside hear something, never the words', async () => {
  const g = makeGame({ hour: 12 });
  clearScene(g, ['elda']);
  const b = g.locations.get('ember_kettle').bounds;
  put(g.entities.get('elda'), (b.x + 1.5) * 16, (b.y + b.h / 2) * 16);
  put(g.player, (b.x - 1.2) * 16, (b.y + b.h / 2) * 16);
  g.village.provider = () => null;
  const r = await g.village.sayAloud('HELLO IN THERE');
  const h = r.hearers.find((x) => x.id === 'elda');
  assert.ok(!h || h.how === 'muffled', JSON.stringify(r.hearers));
  assert.ok(!(g.village.talks.elda || []).some((t) => /HELLO IN THERE/.test(t.you)), 'no words through the wall');
});

test('Lyra hears it through her own mind; named (or your companion), she answers once', async () => {
  const back = quiet();
  const { g } = square();
  const v = g.village;
  v.provider = () => null;
  put(g.companion, g.player.x + 20, g.player.y - 20);
  let noticed = 0;
  const real = g.companion.mind.noticeText?.bind(g.companion.mind);
  g.companion.mind.noticeText = (...a) => {
    noticed++;
    return real?.(...a);
  };
  const r = await v.sayAloud('Lyra, are you hungry?');
  assert.equal(noticed, 1);
  assert.equal(r.lyra, 'answer', 'named: she answers (once, through her brain, in the chat)');
  g.party.holderId = null;
  const r2 = await v.sayAloud('What a fine day');
  assert.equal(r2.lyra, 'heard', 'not named and not walking with you: she only hears it');
  back();
});

test('the batched answers are checked: ids, length, warmth in terror; the brief names everyone', () => {
  const ids = ['bram', 'elda'];
  const out = coerceAloud({ replies: [{ who: 'bram', say: 'Hm.', action: null, mood: 'gruff', opinion_delta: 0, memory: null }, { who: 'nobody', say: 'Hi' }, { who: 'elda', say: '', action: 'walk_off' }, { who: 'bram', say: 'again' }] }, ids);
  assert.deepEqual(out.map((x) => x.id), ['bram', 'elda']);
  assert.equal(out[1].action, 'walk_off');
  const task = buildAloudTask({ text: 'Hello all', shout: true, people: [{ id: 'bram', profile: { name: 'Bram' }, opinion: 40, opinionLabel: 'neutral' }] });
  assert.match(task, /SHOUTING/);
  assert.match(task, /\[bram\]/);
});

test('named in what is said aloud: that one answers as if spoken to (their ask goes through commitments)', async () => {
  const { g } = square();
  const v = g.village;
  v.provider = () => null;
  g.entities.get('elda').adjustOpinion?.(40, 'test');
  const r = await v.sayAloud('Elda, can I have a honey cake?');
  const elda = r.replies.find((x) => x.id === 'elda');
  assert.ok(elda && elda.lines.length, 'Elda answers');
  assert.ok(v.talks.elda.some((t) => /honey cake/.test(t.you)));
});
