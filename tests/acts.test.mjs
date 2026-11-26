import { test } from 'node:test';
import assert from 'node:assert/strict';

// Round 14b T-3 (the author: "If I put text between those two things, it should understand it
// as moves. So if I say kiss, it would understand it like I'm kissing it."). The game decides
// consent and outcome (D6); the minds only word the reaction. Intimate acts need 18 and over
// (canBeIntimate), refused by the game with no mind asked; a text act never kills and never
// downs anyone, a child least of all.

import { parseActs, readAct, actLine } from '../src/ai/social/acts.js';
import { decideActs } from '../src/ai/social/acts_effects.js';
import { makeGame, clearScene, put } from './murder_world.mjs';

const quiet = () => {
  const w = console.warn;
  console.warn = () => {};
  return () => {
    console.warn = w;
  };
};

function beside(g, e, dx = 16) {
  put(g.player, e.x + dx, e.y);
}

function fakeClaude(v, answer = () => ({ say: 'Hm.', silent: null, action: null, act: null, mood: 'neutral', opinion_delta: 0, learned: [], rumor_told: null, rumor: null, name: null, memory: null, asked: null, commit: null })) {
  const tasks = [];
  v.provider = () => ({ id: 'fake' });
  v.askClaude = async (p, rules, task) => {
    tasks.push(task);
    return answer(task);
  };
  return tasks;
}

test('parsing: *acts* come out of the words, with a verb, a kind and whom they name', () => {
  const r = parseActs('*bows* Good morning', { names: { elda: ['elda'] } });
  assert.equal(r.words, 'Good morning');
  assert.equal(r.acts.length, 1);
  assert.equal(r.acts[0].verb, 'bow');
  assert.equal(r.acts[0].kind, 'respect');
  assert.equal(readAct('kisses her cheek').kind, 'intimate');
  assert.equal(readAct('kisses her cheek').target, 'addressee');
  assert.equal(readAct('holds her hand').verb, 'hold_hand');
  assert.equal(readAct('slaps Bram', { names: { bram: ['bram'] } }).target, 'bram');
  assert.equal(readAct('slapped him').kind, 'assault');
  assert.equal(readAct('hugs Lyra', { names: { lyra: ['lyra'] } }).kind, 'affection');
  assert.equal(readAct('stabs him').kind, 'threat', 'a lethal word is only a threat');
  assert.equal(readAct('draws my sword').kind, 'threat');
  assert.equal(readAct('draws a map').kind, 'neutral');
  assert.equal(readAct('blows her a kiss').kind, 'affection');
  assert.equal(readAct('looks at the sky').kind, 'neutral');
  assert.equal(parseActs('no acts here').acts.length, 0);
  assert.equal(actLine(readAct('hugs Elda', { names: { elda: ['elda'] } }), 'Elda'), 'You hug Elda.');
});

test('an unwelcome kiss lowers her opinion, she remembers it, and others who saw it talk', async () => {
  const g = makeGame({ hour: 12 });
  clearScene(g, ['elda', 'bram']);
  const elda = g.entities.get('elda');
  elda.opinionOfPlayer = 40;
  beside(g, elda);
  put(g.entities.get('bram'), elda.x - 30, elda.y);
  const before = elda.opinionOfPlayer;
  const r = await g.village.playerSays(elda, '*kisses her cheek*');
  assert.ok(elda.opinionOfPlayer < before, 'she thinks less of you');
  assert.match(r.acted, /pulls away/);
  assert.ok(g.village.rumors.list.some((x) => x.kind === 'unwelcome'), 'the village saw it');
});

test('a slap is an assault (the crime pipeline): known only if seen; it never downs', async () => {
  const back = quiet();
  const g = makeGame({ hour: 12 });
  clearScene(g, ['bram', 'elda']);
  const bram = g.entities.get('bram');
  beside(g, bram);
  put(g.entities.get('elda'), bram.x - 30, bram.y); // a witness who sees it
  const crimes = [];
  g.bus.on('crime', (p) => crimes.push(p));
  bram.hp = 2;
  await g.village.playerSays(bram, '*slaps Bram*');
  assert.ok(bram.hp >= 1 && !bram.downed, 'never downed');
  assert.ok(g.player.crime?.kind === 'assault', 'an assault, on record (seen)');
  assert.ok(crimes.some((c) => c.victim === bram && c.kind === 'assault'));
  // Full health: the blow lands through combat.damage, still never more than 1–3 hp.
  bram.hp = bram.maxHp;
  const hp0 = bram.hp;
  bram.invuln = 0;
  await g.village.playerSays(bram, '*punches him*');
  assert.ok(hp0 - bram.hp >= 1 && hp0 - bram.hp <= 6, `a small blow: ${hp0 - bram.hp}`);
  back();
});

test('an assault nobody sees is the victim\'s to tell (no crime on record yet)', async () => {
  const back = quiet();
  const g = makeGame({ hour: 12 });
  clearScene(g, ['bram']);
  const bram = g.entities.get('bram');
  beside(g, bram);
  bram.hp = 1;
  const r = decideActs(g, bram, [readAct('slaps him')], { village: g.village });
  assert.equal(r.outcomes[0].outcome, 'assault');
  assert.equal(bram.hp, 1);
  assert.equal(g.player.crime ?? null, null, 'unseen: not on record');
  back();
});

test('a bow is a small rise; the brief tells their mind what the hands did', async () => {
  const g = makeGame({ hour: 12 });
  clearScene(g, ['elda']);
  const elda = g.entities.get('elda');
  beside(g, elda);
  const tasks = fakeClaude(g.village);
  const before = elda.opinionOfPlayer;
  await g.village.playerSays(elda, '*bows* Good morning');
  assert.ok(elda.opinionOfPlayer > before);
  assert.match(tasks[0], /They do \(an act, not words\): \*bows\*/);
  assert.match(tasks[0], /They say to you now: "\*bows\* Good morning"/);
});

test('intimate acts toward Pip, Tansy (15, 16, 17) and Tilly (17): refused by the game, no mind asked; at 18 her own consent', async () => {
  const g = makeGame({ hour: 12 });
  clearScene(g, ['pip', 'tansy', 'tilly']);
  const tasks = fakeClaude(g.village);
  for (const id of ['pip', 'tansy', 'tilly']) {
    const e = g.entities.get(id);
    beside(g, e);
    const r = await g.village.playerSays(e, `*kisses ${id}*`);
    assert.equal(r.refused, true, `${id}: refused`);
    assert.equal(r.narration, "You don't.");
  }
  // Tansy at 16 and 17: an adult to every system but this one.
  const tansy = g.entities.get('tansy');
  for (const age of [16, 17]) {
    tansy.profile = { ...tansy.profile, age };
    g.calendar = { ...(g.calendar || {}), ageOf: (id) => (id === 'tansy' ? age : null) };
    beside(g, tansy);
    const r = await g.village.playerSays(tansy, '*holds her hand*');
    assert.equal(r.refused, true, `Tansy at ${age}: refused`);
  }
  assert.equal(tasks.length, 0, 'no provider call for any of it');
  // At 18: weighed by her own consent (she does not know you: unwelcome, but asked).
  g.calendar.ageOf = (id) => (id === 'tansy' ? 18 : null);
  const r18 = await g.village.playerSays(tansy, '*kisses her*');
  assert.notEqual(r18.refused, true);
  assert.equal(tasks.length, 1);
  assert.match(tasks[0], /unwelcome/);
});

test('a lethal verb never kills: a threat, and they are frightened', async () => {
  const g = makeGame({ hour: 12 });
  clearScene(g, ['bram']);
  const bram = g.entities.get('bram');
  beside(g, bram);
  const hp = bram.hp;
  const r = await g.village.playerSays(bram, '*stabs Bram*');
  assert.equal(bram.hp, hp, 'not a scratch');
  assert.ok(!bram.dead && !bram.downed);
  assert.match(r.acted || '', /flinches/);
  assert.ok(g.village.rumors.list.some((x) => x.kind === 'threat'));
});

test('Lyra: a hug at low trust is unwelcome (a deed in her ledger, she pulls away); her prompt carries what you did', async () => {
  const back = quiet();
  const g = makeGame({ hour: 10 });
  const L = g.companion;
  put(L, g.player.x + 18, g.player.y);
  L.mind.relationships.adjust?.('player', { trust: -40, affinity: -30 }, 'test');
  const r = await g.brain.handlePlayerMessage('*hugs Lyra*');
  assert.ok(L.mind.autonomy.ledger.some((d) => d.deed === 'touched_unwelcome'), 'in her ledger');
  assert.ok(g.ui.chat.messages.some((m) => m.from === 'system' && /pulls away/.test(m.text)), 'shown as an act row');
  assert.ok(r.say, `she answers: ${r.say}`);
  const { buildChatPrompt } = await import('../src/ai/brain/prompt.js');
  const p = buildChatPrompt(g, '*hugs Lyra*', [], { does: 'They do (an act, not words): *hugs Lyra*. It was unwelcome to you.' });
  assert.match(p.context, /# Ash does\nThey do \(an act, not words\): \*hugs Lyra\*/);
  back();
});

test('a child struck by hand: the assault rules apply (a crime if seen), and they are never downed, let alone killed', async () => {
  const back = quiet();
  const g = makeGame({ hour: 12 });
  clearScene(g, ['pip', 'elda']);
  const pip = g.entities.get('pip');
  beside(g, pip);
  put(g.entities.get('elda'), pip.x - 30, pip.y);
  for (let i = 0; i < 12; i++) {
    pip.invuln = 0;
    await g.village.playerSays(pip, '*punches Pip*');
    assert.ok(pip.hp >= 1 && !pip.downed && !pip.dead, `never downed (${pip.hp})`);
  }
  assert.equal(g.player.crime?.kind, 'assault', 'seen by Elda: an assault on record');
  assert.equal(g.murder?.isDead?.('pip') || false, false);
  back();
});
