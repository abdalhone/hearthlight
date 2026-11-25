import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, placeAt } from './survival_world.mjs';
import { openAgenda, chooseNext } from '../src/ai/mind/autonomy_open.js';
import { LINES } from '../src/ai/mind/autonomy_lines.js';

// Round 13, workstream A: minds that keep their word (DESIGN §16.11, §16.12, §16.13,
// §23.1, §29.2). Each story here is the author's playtest, replayed in the real headless
// world (the real player, Lyra with her mind and body, the eighteen, the plugins, combat).

const quiet = () => {
  const w = console.warn;
  console.warn = () => {};
  return () => {
    console.warn = w;
  };
};

// The author's afternoon: day 2, Lyra asks of her own accord, they agree with "lets go".
async function chapelProposal({ hour = 10, reply = 'lets go', from = 'town_square' } = {}) {
  const g = makeGame({ hour });
  const L = g.companion;
  const P = g.player;
  const a = L.mind.autonomy;
  g.plugins.get('quest').advance(g.plugins.ctx, 1, 'test');
  g.plugins.get('quest').settlePending(g); // her stage lines, said earlier in the day
  step(g, 1);
  const sq = g.locations.get(from);
  placeAt(g, P, sq.center.x, sq.center.y);
  placeAt(g, L, sq.center.x + 20, sq.center.y);
  a.lastInitiativeT = -1e9;
  a.lastSpokeT = -1e9;
  a._initiative();
  assert.equal(a.pendingRequest?.spec?.params?.npc, 'aveline', 'she asked to go and see Aveline');
  const r = reply ? await g.brain.handlePlayerMessage(reply) : null;
  return { g, L, P, a, r };
}

// The player walks after her, the way the author did.
function walkBehind(g, L, P, near = 40) {
  const dx = L.x - P.x;
  const dy = L.y - P.y;
  const d = Math.hypot(dx, dy);
  g.input.move = d > near ? { x: dx / d, y: dy / d } : { x: 0, y: 0 };
}

test('A1: "Come with me to the chapel?" — "lets go": she leads, talks to Aveline about Maren, then lives her own day', async () => {
  const said = [];
  const { g, L, P, a, r } = await chapelProposal();
  assert.ok(!r.actions.some((x) => x.name === 'follow'), '"lets go" is a yes to her, not "follow me"');
  // Her yes is said once, by the outing ("Chapel's this way"); the reply adds no stray
  // "Mm. I'll think about that." after it (the author's "not clicking in her head").
  assert.equal(r.say, '', `the chat reply adds nothing to her yes (got "${r.say}")`);
  for (const l of g.saidToday.today('lyra')) said.push(l.text);
  assert.ok(!said.some((t) => /think about that|tell me more|I hear you/i.test(t)), `no generic line after agreeing: ${JSON.stringify(said)}`);
  const o = a.outings.current;
  assert.ok(o && o.npc === 'aveline' && o.at === 'chapel', 'agreeing made it her outing');
  assert.equal(L.behavior.directive.type, 'goto', 'she leads the way');
  const promise = a.promises.find((p) => p.by === 'player' && p.kind === 'visit');
  assert.ok(promise, 'their yes is their promise');
  let talked = false;
  let followedAfterArriving = false;
  let arrived = false;
  g.bus.on('conversation', (p) => {
    if (p.b?.id === 'aveline') talked = true;
  });
  for (let i = 0; i < 400 && o.phase !== 'done'; i++) {
    walkBehind(g, L, P);
    step(g, 0.5);
    if (o.phase !== 'go') arrived = true;
    const d = L.behavior.directive;
    if (arrived && o.phase !== 'done' && d.type === 'follow' && d.target === 'player') followedAfterArriving = true;
  }
  assert.equal(o.phase, 'done', 'the outing ran to its end');
  assert.equal(o.result, 'talked');
  assert.ok(talked, 'she and Aveline talked');
  assert.ok(a.questStage >= 2, 'the talk was the Maren beat: the arc moved on');
  assert.ok(!followedAfterArriving, 'she never snapped back to following the moment she arrived');
  assert.equal(promise.state, 'kept', 'they came, and their word is kept');
  // Then her own life: whatever her open agenda chose, it is a choice, said in her voice.
  step(g, 2);
  const st = a.companionship;
  const d = L.behavior.directive;
  if (st === 'apart') {
    assert.equal(d.type, 'independent', 'her own day');
    assert.ok(a.currentBlock()?.chosen, 'the block she is in now is one she chose from her open agenda');
  } else {
    assert.equal(d.type, 'follow', 'or the player’s company, by choice');
  }
});

test('A1: she does not snap back after arriving, even when the reply (Claude) told her body "goto chapel, then follow"', async () => {
  const { g, L, P, a } = await chapelProposal();
  const o = a.outings.current;
  // What a Claude reply did in the author's game: walk there, then follow.
  g.actions.run('goto', { target: 'chapel', value: 'follow' }, 'claude');
  for (let i = 0; i < 400 && o.phase !== 'done'; i++) {
    walkBehind(g, L, P);
    step(g, 0.5);
    if (o.phase === 'find' || o.phase === 'talk' || o.phase === 'after') {
      const d = L.behavior.directive;
      assert.ok(!(d.type === 'follow' && d.target === 'player'), `phase ${o.phase}: not following the player`);
    }
  }
  assert.equal(o.result, 'talked');
});

test('A1: a guide waits for the one she is guiding, and goes on alone if they never come', async () => {
  const { g, L, P, a } = await chapelProposal({ from: 'player_home' });
  const o = a.outings.current;
  // The player stands still while she walks on.
  const far = { x: P.x, y: P.y };
  let waited = false;
  for (let i = 0; i < 40 && !waited; i++) {
    step(g, 0.5);
    if (a.outings.lagSince != null && L.behavior.directive.type === 'stay') waited = true;
  }
  assert.ok(waited, 'she stopped and waited for them');
  assert.ok(g.said.some((s) => s.who === 'lyra' && LINES.outing_wait_player.warm.concat(LINES.outing_wait_player.cool, LINES.outing_wait_player.afraid, LINES.outing_wait_player.tired).some((l) => s.text === l.replace('{P}', 'Ash'))), 'and called to them');
  // They come: she leads on.
  placeAt(g, P, L.x + 20, L.y);
  step(g, 1);
  assert.equal(L.behavior.directive.type, 'goto', 'caught up: she leads on');
  // They wander off for good: she goes on alone.
  placeAt(g, P, far.x, far.y);
  for (let i = 0; i < 400 && o.withPlayer; i++) step(g, 0.5);
  assert.equal(o.withPlayer, false, 'she went on alone');
  for (let i = 0; i < 600 && o.phase !== 'done'; i++) step(g, 0.5);
  assert.equal(o.result, 'talked', 'and still had the talk she went for');
});

test('A1: asked to come back mid-outing, she weighs it; if she agrees, the talk waits as unfinished business', async () => {
  const { g, a } = await chapelProposal();
  const v = a.evaluateRequest({ action: 'come_here', args: {}, source: 'player', preview: true });
  assert.ok(v.reasons.some((x) => /talk|chapel|aveline|leading/i.test(x)), `the outing weighs in her answer: ${v.reasons.join('; ')}`);
  // Agreed (forced here): the outing is set aside, and remembered as unfinished.
  g.bus.emit('companion_action', { name: 'come_here', args: {}, source: 'player', ok: true });
  assert.equal(a.outings.active(), false);
  assert.ok(a.unfinished.some((u) => u.npc === 'aveline'), 'talking to Aveline is unfinished business');
  const items = a.openAgenda();
  assert.ok(items.some((it) => it.kind === 'unfinished' && /aveline/i.test(it.text)), 'and it is on her open agenda');
});

test('A1: the outing survives a save (a talk cut by the save starts again from finding her)', async () => {
  const { g, a } = await chapelProposal();
  a.outings.current.phase = 'talk';
  const saved = JSON.parse(JSON.stringify(a.serialize()));
  a.outings.current = null;
  a.deserialize(saved);
  assert.equal(a.outings.current.phase, 'find');
  assert.equal(a.outings.current.npc, 'aveline');
});

test('A2: her open agenda weighs wants, unfinished business, people, what she said and the player', () => {
  const v = {
    day: 3,
    hour: 14,
    state: 'together',
    trust: 60,
    fear: 0,
    affinity: 40,
    energy: 0.8,
    hunger: 0.7,
    fun: 0.6,
    purse: 20,
    valence: 0.1,
    neuroticism: 0.4,
    extraversion: 0.65,
    agreeableness: 0.7,
    wantsCompany: true,
    unfinished: [{ text: 'talk to Aveline about Maren', npc: 'aveline', at: 'chapel', topic: 'Maren', since: 2 }],
    said: [{ text: 'bring Pip a sweet roll' }],
    people: [{ id: 'hobb', name: 'Da', affinity: 90, at: 'chandlery', seenToday: false, family: true }],
    plan: null,
  };
  const items = openAgenda(v);
  const kinds = new Set(items.map((i) => i.kind));
  for (const k of ['company', 'unfinished', 'said', 'person']) assert.ok(kinds.has(k), `${k} is weighed`);
  assert.ok(items.every((it, i) => it.id === `a${i + 1}`), 'ids for Claude: a1, a2…');
  // Starving beats everything else.
  const hungry = chooseNext({ ...v, hunger: 0.05 });
  assert.equal(hungry.kind, 'want');
  assert.match(hungry.text, /eat/);
  // Not wanting the player's company, it never offers it.
  assert.ok(!openAgenda({ ...v, wantsCompany: false }).some((it) => it.kind === 'company'));
  // After hard news, a while alone with it, or her people.
  const after = chooseNext({ ...v, wantsCompany: false, after: { result: 'talked', npc: 'aveline', topic: 'Maren', at: 'chapel' } });
  assert.ok(['want', 'person', 'unfinished'].includes(after.kind), after.text);
});

test('A2 with Claude: her open agenda is in the prompt with ids, and set_plan "a<n>" does that item (unfinished business becomes an outing)', async () => {
  const g = makeGame({ hour: 14 });
  const L = g.companion;
  const a = L.mind.autonomy;
  step(g, 1);
  a.noteUnfinished({ text: 'talk to Aveline about Maren', npc: 'aveline', at: 'chapel', topic: 'Maren', why: 'I still have to ask her.', since: a.day() });
  const { buildContext } = await import('../src/ai/brain/prompt.js');
  const ctx = buildContext(g, { message: 'what do you want to do now?' });
  const text = JSON.stringify(ctx);
  assert.match(text, /open agenda/i, 'Claude is told her open agenda');
  const items = a.openAgenda();
  const u = items.find((it) => it.kind === 'unfinished');
  assert.ok(u && new RegExp(`${u.id}`).test(text), `with ids Claude can name (${u?.id})`);
  // Claude picks it: the game turns it into her outing (checked: the place and person exist).
  const r = g.actions.run('set_plan', { value: u.id }, 'claude');
  assert.ok(r.ok !== false, JSON.stringify(r));
  assert.equal(a.outings.current?.npc, 'aveline', 'the unfinished talk is her outing now');
  // A person on her agenda: an ordinary block of her day, marked as chosen.
  a.outings.drop('changed');
  const p = a.openAgenda().find((it) => it.kind === 'person');
  if (p) {
    g.actions.run('set_plan', { value: p.id }, 'claude');
    assert.equal(a.currentBlock()?.chosen, 'person');
  }
  // An id that is not on her agenda is just words, never an action the game cannot do.
  const before = JSON.stringify(a.currentBlock());
  const r2 = g.actions.run('set_plan', { value: 'a99' }, 'claude');
  assert.equal(r2.ok, false);
  assert.equal(JSON.stringify(a.currentBlock()), before, 'her day stands');
});

function fakeRuntime(json) {
  const rt = { hostPresent: true, disabled: [], listeners: [], tts: null };
  const sample = Object.assign(async (p, o) => ({ text: JSON.stringify(await json(p, o)) }), { json: (p, o) => json(p, o) });
  rt.caps = { sample };
  Object.defineProperty(rt, 'sample', { get: () => rt.caps.sample });
  rt.disable = (n) => {
    rt.disabled.push(n);
    rt.caps[n] = null;
  };
  rt.onChange = (f) => rt.listeners.push(f);
  return rt;
}

test('A1 with Claude: the reply carries the outing, the body is the game’s, and the talk with Aveline is Claude’s too', async () => {
  const prompts = [];
  const back = quiet();
  const g = makeGame({ hour: 10 });
  g.runtime = fakeRuntime(async (p) => {
    prompts.push(String(p));
    return {
      thought: 'Finally.',
      say: "Right. Thank you for coming. Chapel's this way. Stay close. I'll lead.",
      emotion: { name: 'trust', intensity: 0.4 },
      actions: [{ name: 'goto', target: 'chapel', value: 'follow', amount: null }],
      memories: [],
      relationships: [],
      goal: null,
      lines: [
        { speaker: 'lyra', text: 'Sister. I need to ask you about Maren. Properly, this time.' },
        { speaker: 'npc', text: 'Then sit, child. At midsummer, at dusk, I saw her walk toward the ruins with a lantern and a coil of rope.' },
        { speaker: 'lyra', text: 'Thank you. I needed to hear it said.' },
      ],
      learned: [],
      affinity: 2,
    };
  });
  g.brain.providers = new (g.brain.providers.constructor)(g);
  const L = g.companion;
  const P = g.player;
  const a = L.mind.autonomy;
  g.plugins.get('quest').advance(g.plugins.ctx, 1, 'test');
  g.plugins.get('quest').settlePending(g);
  step(g, 1);
  const sq = g.locations.get('town_square');
  placeAt(g, P, sq.center.x, sq.center.y);
  placeAt(g, L, sq.center.x + 20, sq.center.y);
  a.lastInitiativeT = -1e9;
  a.lastSpokeT = -1e9;
  a._initiative();
  const r = await g.brain.handlePlayerMessage('lets go');
  assert.equal(r.provider, 'claude.ai');
  assert.ok(prompts[0].includes('leading'), 'Claude is told she is leading them there, as her own plan');
  const o = a.outings.current;
  assert.equal(o?.source, 'claude');
  for (let i = 0; i < 400 && o.phase !== 'done'; i++) {
    walkBehind(g, L, P);
    step(g, 0.5);
    await Promise.resolve();
    if (o.phase === 'find' || o.phase === 'after') assert.ok(!(L.behavior.directive.type === 'follow' && L.behavior.directive.target === 'player'));
  }
  back();
  assert.equal(o.result, 'talked');
  assert.ok(g.said.some((s) => s.who === 'aveline' && /lantern and a coil of rope/.test(s.text)), 'Aveline said what Claude wrote for her');
  assert.ok(a.questStage >= 2);
});

// ------------------------------------------------------------------ A3: hate means distance

// She hates and fears the player. They stand where her day takes her, or walk at her.
function hateScene({ mode = 'left', walker = 'stand', seconds = 90 } = {}) {
  const g = makeGame({ hour: 14 });
  const L = g.companion;
  const P = g.player;
  const a = L.mind.autonomy;
  step(g, 1);
  a.adjustPlayer({ trust: -40, fear: mode === 'wary' ? 40 : 70, affinity: -60 }, 'test');
  if (mode === 'left') a.setCompanionship('left', 'You frighten me.', { cause: 'fear_left' });
  else a.setCompanionship('wary', 'You frighten me.', { cause: 'fear' });
  const blk = a.currentBlock();
  const loc = g.locations.get(blk?.at || 'town_square') || g.locations.get('town_square');
  placeAt(g, P, loc.center.x, loc.center.y + 8);
  placeAt(g, L, loc.center.x + 180, loc.center.y);
  step(g, 0.5);
  const dt = 0.05;
  let prev = { x: L.x, y: L.y };
  let lastV = null;
  let reversals = 0;
  let path = 0;
  let minD = Infinity;
  for (let i = 0; i < seconds / dt; i++) {
    if (walker === 'approach') {
      const dx = L.x - P.x;
      const dy = L.y - P.y;
      const d = Math.hypot(dx, dy);
      g.input.move = d > 40 ? { x: (dx / d) * 0.7, y: (dy / d) * 0.7 } : { x: 0, y: 0 };
    }
    step(g, dt, dt);
    const vx = L.x - prev.x;
    const vy = L.y - prev.y;
    const sp = Math.hypot(vx, vy);
    prev = { x: L.x, y: L.y };
    if (sp > 0.15) {
      path += sp;
      // A turn of more than ~120°: "moving in place" is made of these.
      if (lastV && vx * lastV.x + vy * lastV.y < -0.5 * sp * Math.hypot(lastV.x, lastV.y)) reversals++;
      lastV = { x: vx, y: vy };
    }
    minD = Math.min(minD, Math.hypot(L.x - P.x, L.y - P.y));
  }
  return { g, L, P, a, reversals, path, minD };
}

test('A3: she has left them and they stand where her day takes her: she does her day elsewhere, no back-and-forth', () => {
  const r = hateScene({ mode: 'left', walker: 'stand' });
  assert.ok(r.reversals <= 3, `she turned back on herself ${r.reversals} times in 90 s (the author saw her "moving in place")`);
  assert.ok(r.minD > 8 * 16, `she kept her distance (closest ${Math.round(r.minD)} px)`);
});

test('A3: they walk at her: she keeps stepping away, never turning back toward them', () => {
  for (const mode of ['left', 'wary']) {
    const r = hateScene({ mode, walker: 'approach' });
    assert.ok(r.reversals <= 6, `${mode}: ${r.reversals} reversals while being walked at`);
  }
});

test('A3: wary and afraid, she trails at a steady distance (hysteresis), not "follow" fighting "step away"', () => {
  const g = makeGame({ hour: 11 });
  const L = g.companion;
  const a = L.mind.autonomy;
  step(g, 1);
  a.adjustPlayer({ trust: -20, fear: 30, affinity: -10 }, 'test');
  a.setCompanionship('wary', 'x', { cause: 'fear' });
  step(g, 1);
  assert.equal(L.behavior.directive.type, 'keep_away', 'afraid: a steady distance');
  assert.equal(L.behavior.directive.follow, true, 'still traveling with them');
  // Fear eases a little, but not past the band: no flip.
  a.adjustPlayer({ fear: -8 }, 'test');
  step(g, 1);
  assert.equal(L.behavior.directive.type, 'keep_away', 'inside the band: she keeps it');
  a.adjustPlayer({ fear: -20, affinity: 20 }, 'test');
  step(g, 1);
  assert.equal(L.behavior.directive.type, 'follow', 'eased: she trails close again');
  assert.equal(L.behavior.directive.distance, 'far');
});

test('A3: having stepped clear past them, she waits where she stands; she never walks back past them to where she was holding off', () => {
  // Played on a phone: chased up the lake shore, she stepped clear to the north, and the
  // spot she had been holding off at was now behind the player, so she walked back toward
  // it, stepped clear again, and again (14 turns in 9 s, standing 10 to 13 tiles off).
  const g = makeGame({ hour: 12 });
  const L = g.companion;
  const P = g.player;
  const a = L.mind.autonomy;
  step(g, 1);
  a.adjustPlayer({ trust: -40, fear: 70, affinity: -60 }, 'test');
  a.setCompanionship('left', 'You frighten me.', { cause: 'fear_left' });
  step(g, 1);
  const sq = g.locations.get('town_square').center;
  placeAt(g, P, sq.x, sq.y);
  placeAt(g, L, sq.x, sq.y - 210);
  step(g, 0.2);
  const own = L.behavior.own;
  assert.ok(own.day, 'her day is running');
  // She is holding off; the spot she was holding off at is now on the far side of them.
  own.day.heldOff = true;
  own.day.spot = { x: sq.x, y: sq.y + 260 };
  own.st.clearT = 15;
  let prev = { x: L.x, y: L.y };
  let lastV = null;
  let reversals = 0;
  let minD = Infinity;
  for (let i = 0; i < 12 / 0.05; i++) {
    g.input.move = { x: 0, y: 0 };
    step(g, 0.05, 0.05);
    const vx = L.x - prev.x;
    const vy = L.y - prev.y;
    const sp = Math.hypot(vx, vy);
    prev = { x: L.x, y: L.y };
    if (sp > 0.15) {
      if (lastV && vx * lastV.x + vy * lastV.y < -0.5 * sp * Math.hypot(lastV.x, lastV.y)) reversals++;
      lastV = { x: vx, y: vy };
    }
    minD = Math.min(minD, Math.hypot(L.x - P.x, L.y - P.y));
  }
  assert.ok(minD > 150, `she never walked back toward them (closest ${Math.round(minD)} px)`);
  assert.ok(reversals <= 1, `${reversals} turns back on herself`);
});

test('A3: when the way to her day bends back toward them, she stops and waits where she stands', () => {
  // Played: her day lay past the player, round a house; the straight line looked clear,
  // the path bent toward them, and she walked in, stepped clear, walked in again.
  const g = makeGame({ hour: 12 });
  const L = g.companion;
  const P = g.player;
  const a = L.mind.autonomy;
  step(g, 1);
  a.adjustPlayer({ trust: -40, fear: 70, affinity: -60 }, 'test');
  a.setCompanionship('left', 'You frighten me.', { cause: 'fear_left' });
  step(g, 1);
  const sq = g.locations.get('town_square').center;
  placeAt(g, P, sq.x, sq.y);
  placeAt(g, L, sq.x, sq.y + 200);
  step(g, 0.2);
  const own = L.behavior.own;
  const day = own.day;
  assert.ok(day, 'her day is running');
  // Off to her day, which lies away from them, but this step of the way heads toward them.
  day.heldOff = false;
  day.person = null; // her day is a place, not someone to find
  own.st.clearT = 0;
  own.st.avoiding = null;
  day.spot = { x: sq.x + 300, y: sq.y + 260 };
  L.moveIntent = { x: 0, y: -1 };
  const held = own.keepDayClear(0.05, day, P, 10 * 16);
  assert.equal(held, true, 'she holds off');
  assert.ok(Math.hypot(day.spot.x - L.x, day.spot.y - L.y) < 2, 'and waits where she stands');
  // Heading away from them, she goes on with her day as before.
  day.heldOff = false;
  own.st.clearT = 0;
  day.spot = { x: sq.x + 300, y: sq.y + 260 };
  L.moveIntent = { x: 0.6, y: 0.8 };
  assert.equal(own.keepDayClear(0.05, day, P, 10 * 16), false, 'away from them: on she goes');
});

// ------------------------------------------------------------------ A4: one memory of what they said

import { makeGame as makeVillage, step as stepVillage, clearScene } from './murder_world.mjs';

test('A4: everything a character says today is in one log: bubbles, barks, chat, her own-will lines, talks out of earshot', async () => {
  const g = makeVillage({ hour: 11 });
  const said = g.saidToday;
  assert.ok(said, 'game.saidToday exists');
  const elda = g.entities.get('elda');
  const L = g.companion;
  elda.say('Have you eaten? You look peaky.', { kind: 'say' }); // over her head
  g.bubbles.say(elda, 'Pip! Pip, where’s that boy got to?', { kind: 'shout' }); // a bubble with no event
  L.mind.autonomy.say('I’m going to the Kettle. Come, if you want.', { force: true }); // her own will
  g.village.converse('elda', 'bram', { lines: [{ speaker: 'elda', text: 'Bram, you look half-starved again.' }, { speaker: 'bram', text: 'Hmph.' }], onScreen: false });
  const eldas = said.today('elda').map((l) => l.text);
  assert.ok(eldas.includes('Have you eaten? You look peaky.'));
  assert.ok(eldas.some((t) => /where’s that boy/.test(t)));
  assert.ok(eldas.includes('Bram, you look half-starved again.'), 'what she said to Bram, out of the player’s earshot');
  assert.ok(said.today('lyra').some((l) => /Kettle/.test(l.text)));
  const { buildContext } = await import('../src/ai/brain/prompt.js');
  const ctx = buildContext(g, { message: 'where are you going?' });
  assert.match(ctx, /already said today[\s\S]*Kettle/, 'her Claude prompt carries what she said over her head');
  // The same line by two routes is one line.
  elda.say('Have you eaten? You look peaky.', { kind: 'say' });
  assert.equal(said.today('elda').filter((l) => /Have you eaten/.test(l.text)).length, 1);
  // A repeat is recognised even worded differently.
  assert.ok(said.repeats('elda', 'Have you eaten today? I can tell by your face you haven’t.'));
  assert.ok(!said.repeats('elda', 'The kettle’s on, love.'));
  // A new day, a clean slate.
  g.clock.t += 900;
  assert.equal(said.today('elda').length, 0);
});

test('A4: Elda does not ask "have you eaten?" twice in a day — offline, and the prompt tells Claude what she already said', async () => {
  const g = makeVillage({ hour: 11 });
  clearScene(g, ['elda']);
  const elda = g.entities.get('elda');
  const P = g.player;
  P.x = elda.x + 20;
  P.y = elda.y;
  elda.say('Have you eaten? You look peaky.', { kind: 'say' });
  // Ten things the player says; none of her answers asks it again.
  const asks = [];
  for (const t of ['hello!', 'how are you?', 'ok', 'thanks', 'hi again', 'how are you doing', 'sure', 'what do you do?', 'nice', 'bye']) {
    const r = await g.village.playerSays(elda, t);
    for (const l of r.lines) {
      elda.say(l, { kind: 'say', target: P });
      if (/have you eaten/i.test(l)) asks.push(l);
    }
  }
  assert.deepEqual(asks, [], 'she never asked again');
  const brief = g.village.sayBrief(elda, 'hello', { lines: ['Hm.'] });
  assert.ok(brief.saidToday.some((l) => /Have you eaten/.test(l)), 'Claude is told what she already said today');
  const { buildSayTask } = await import('../src/ai/social/village_prompt.js');
  assert.match(buildSayTask(brief), /already said today/);
  // And a Claude reply that repeats it anyway loses that sentence.
  assert.equal(g.saidToday.dropRepeats('elda', 'Have you eaten today? Mind the frost on the step going out.'), 'Mind the frost on the step going out.');
});

// ------------------------------------------------------------------ A5: promises become real actions

import { stepUntil as stepUntilSurvival } from './survival_world.mjs';

function nearElda(g) {
  clearScene(g, ['elda', 'lyra']);
  const elda = g.entities.get('elda');
  const P = g.player;
  P.x = elda.x + 18;
  P.y = elda.y;
  elda.adjustOpinion?.(30, 'test: she likes them');
  return elda;
}

test('A5: "please can you go to her" — Elda says yes, walks to Lyra, they talk, and Lyra really hears it', async () => {
  const g = makeVillage({ hour: 11 });
  const elda = nearElda(g);
  const L = g.companion;
  // Lyra across the village, living her own day.
  L.x = g.locations.get('town_square').center.x;
  L.y = g.locations.get('town_square').center.y;
  await g.village.playerSays(elda, 'how is Lyra doing?');
  const r = await g.village.playerSays(elda, 'please can you go to her and tell her I am sorry');
  assert.match(r.lines.join(' '), /Lyra/, `she answers about it: ${r.lines.join(' ')}`);
  const c = g.village.commitments.open('elda')[0];
  assert.ok(c && c.kind === 'tell', 'a commitment, not just words');
  assert.equal(c.message, 'I am sorry');
  // The player walks off; she goes when she is free.
  g.player.x += 300;
  let talked = null;
  g.bus.on('conversation', (p) => {
    if ((p.a?.id === 'lyra' || p.b?.id === 'lyra') && (p.a?.id === 'elda' || p.b?.id === 'elda')) talked = p;
  });
  const toasts = [];
  g.ui = { ...(g.ui || {}), toast: (text, kind, o) => toasts.push({ text, kind, title: o?.title }) };
  for (let i = 0; i < 400 && c.state !== 'kept'; i++) stepVillage(g, 0.5);
  assert.equal(c.state, 'kept', `she went (state ${c.state})`);
  // The player is told it is done, in the past tense (not "Elda will go…").
  const told = toasts.find((t) => /kept their word/.test(t.title || ''));
  assert.ok(told && /found Lyra and talked to her for you/.test(told.text) && !/will go/.test(told.text), JSON.stringify(toasts));
  assert.ok(talked, 'the two of them talked');
  assert.ok(talked.lines.some((l) => /sorry/i.test(l.text)), 'Elda passed the message on');
  const mem = L.mind.memory.all?.() || L.mind.memory.list || [];
  const heard = (Array.isArray(mem) ? mem : []).some((m) => /Elda came to find me with a message/.test(m.text));
  assert.ok(heard || (L.mind.recall?.('Elda message', { limit: 6 }) || []).some((m) => /message/.test(m.text)), 'Lyra remembers who brought it and what it said');
});

test('A5: "give me a honey cake" — the item changes hands; "take a honey cake for the road" gives one too; too much asked, she says why', async () => {
  const g = makeVillage({ hour: 11 });
  const elda = nearElda(g);
  const inv = g.player.inventory;
  const before = inv.count('honey_cake');
  const r = await g.village.playerSays(elda, 'can I have a honey cake please');
  assert.equal(inv.count('honey_cake'), before + 1, `the cake is in their pack: ${r.lines.join(' ')}`);
  const r2 = await g.village.playerSays(elda, 'can I have another honey cake');
  assert.equal(inv.count('honey_cake'), before + 1, 'not twice in a day');
  assert.match(r2.lines.join(' '), /already|tomorrow/i, 'and she says why');
  const r3 = await g.village.playerSays(elda, 'give me an iron sword');
  assert.match(r3.lines.join(' '), /no Iron Sword|no iron sword/i, `she has none to give, and says so: ${r3.lines.join(' ')}`);
  // An offer in her own words is handed over (once).
  const bread = inv.count('bread');
  g.village.commitments.offersIn(elda, ['Take some bread for the road, love.']);
  assert.equal(inv.count('bread'), bread + 1);
});

test('A5: "teach me magic" — a teacher starts the lesson that unlocks what they know; someone who knows none says who does', async () => {
  const g = makeVillage({ hour: 11 });
  const { MissionSystem } = await import('../src/missions/system.js');
  g.missions = new MissionSystem(g);
  clearScene(g, ['bram', 'elda']);
  const bram = g.entities.get('bram');
  g.player.x = bram.x + 18;
  g.player.y = bram.y;
  bram.adjustOpinion?.(30, 'test');
  // Before the first lesson of all (First Spark): not yet, and he says when.
  const r0 = await g.village.playerSays(bram, 'can you teach me magic?');
  assert.equal(g.missions.status('hinge_ore'), 'locked');
  assert.match(r0.lines.join(' '), /not yet.*First Spark/i, r0.lines.join(' '));
  assert.equal(g.village.commitments.open('bram').length, 0, 'no promise he cannot keep');
  g.missions.accept('first_spark', { silent: true });
  g.missions.complete('first_spark');
  const r = await g.village.playerSays(bram, 'please, teach me magic');
  const st = g.missions.status('hinge_ore');
  assert.equal(st, 'active', `the lesson began: ${r.lines.join(' ')} (${st})`);
  {
    assert.match(r.lines.join(' '), /iron/i, 'he teaches what he knows: iron');
    // His yes, then what the lesson asks; no greeting tacked on after it ("…Hmph. You again.").
    assert.doesNotMatch(r.lines.join(' '), /You again/, r.lines.join(' '));
    assert.match(r.lines.join(' '), /ore|quarry|lumps/i, `he says what the lesson asks: ${r.lines.join(' ')}`);
    const c = g.village.commitments.open('bram')[0];
    assert.equal(c?.kind, 'teach');
    // The lesson done, the part unlocks and his word is kept.
    g.missions.complete('hinge_ore');
    stepVillage(g, 2);
    assert.equal(c.state, 'kept');
  }
  const elda = g.entities.get('elda');
  g.player.x = elda.x + 18;
  g.player.y = elda.y;
  const e2 = await g.village.playerSays(elda, 'teach me a spell');
  assert.ok(/teach|lesson|begun|ask/i.test(e2.lines.join(' ')), e2.lines.join(' '));
});

test('A5: a Claude yes to something impossible is answered with the plain reason; a Claude yes the game can do is done', async () => {
  const g = makeVillage({ hour: 11 });
  const elda = nearElda(g);
  const v = g.village;
  let answer = { say: "Of course, love, here's an iron sword.", mood: 'warm', opinion_delta: 1, learned: [], rumor_told: null, rumor: null, name: null, memory: null, asked: null, commit: { kind: 'give', agree: true } };
  v.provider = () => ({ id: 'fake' });
  const briefs = [];
  v.askClaude = async (p, rules, task) => {
    briefs.push(task);
    return answer;
  };
  const r = await v.playerSays(elda, 'give me an iron sword');
  assert.ok(briefs[0].includes('You will not or cannot'), 'Claude was told it cannot be done');
  assert.ok(!g.player.inventory.count('iron_sword'), 'no sword appeared');
  assert.match(r.lines.join(' '), /no iron sword/i, `she says plainly why not: ${r.lines.join(' ')}`);
  answer = { ...answer, say: 'Here, love, a honey cake.', commit: { kind: 'give', agree: true } };
  const n = g.player.inventory.count('honey_cake');
  await v.playerSays(elda, 'can I have a honey cake?');
  assert.equal(g.player.inventory.count('honey_cake'), n + 1, 'the checked yes is done');
});

test('A5: a promise not kept by its day is broken, and both sides remember', async () => {
  const g = makeVillage({ hour: 11 });
  const elda = nearElda(g);
  await g.village.playerSays(elda, 'go and talk to Lyra for me');
  const c = g.village.commitments.open('elda')[0];
  assert.ok(c);
  c.due = g.clock.t - 1; // the day came and went
  g.village.commitments._acc = 5;
  g.village.commitments.update(1);
  assert.equal(c.state, 'broken');
  assert.ok(g.toasts.some((t) => /didn't keep their word/.test(t.opts?.title || '')), 'the player is told');
  const r = await g.village.playerSays(elda, 'hello');
  assert.match(r.lines[0], /never did get to Lyra/i, 'and she owns it the next time they talk');
});

test('A5: asking Lyra to teach you: a lesson she can give is offered as one (a yes chip); not yet, she says when, and who else teaches', async () => {
  const g = makeVillage({ hour: 11 });
  const { missionsPlugin } = await import('../src/missions/plugin.js');
  g.plugins.register(missionsPlugin);
  g.plugins.installAll?.();
  const L = g.companion;
  g.player.x = L.x + 20;
  g.player.y = L.y;
  const r1 = await g.brain.handlePlayerMessage('can you teach me magic?');
  assert.match(r1.say, /Not yet/);
  assert.match(r1.say, /Aveline|Bram|Tilly/, 'and who else teaches what');
  g.missions.flags.weave_seen = true;
  const r2 = await g.brain.handlePlayerMessage('teach me a spell');
  assert.match(r2.say, /teach you/);
  assert.ok(g.ui.chat.messages.some((m) => m.offer?.name === 'accept_mission'), 'the lesson is offered, with a yes');
  g.actions.run('accept_mission', { value: 'first_spark' }, 'player');
  assert.equal(g.missions.status('first_spark'), 'active', 'and saying yes starts it');
});

// ------------------------------------------------------------------ A6: eyes and words

import { Actor } from '../src/entities/entity.js';
import { look } from '../src/murder/witness.js';
import { px as tpx, put, holdLyra, downBy, villagers as villagersOf } from './murder_world.mjs';

function quietAll(g, keep = []) {
  for (const v of villagersOf(g)) {
    if (keep.includes(v.id)) continue;
    put(v, tpx(141) + Math.random() * 20, tpx(101));
    v.think = () => {};
  }
  if (!keep.includes('lyra')) holdLyra(g, tpx(150), tpx(112));
}

// Two outdoor points either side of a building, both outside its walls.
function aroundBuilding(g, id = 'ember_kettle') {
  const b = g.locations.get(id).bounds;
  const cy = (b.y + b.h / 2) * 16;
  const west = { x: (b.x - 1.5) * 16, y: cy };
  const east = { x: (b.x + b.w + 1.5) * 16, y: cy };
  return { west, east, b };
}

test('A6: one rule for eyes — Lyra does not see a cat killed on the far side of a house; in the open she does', () => {
  const g = makeVillage({ hour: 12 });
  quietAll(g, ['lyra']);
  const L = g.companion;
  const a = L.mind.autonomy;
  const { west, east } = aroundBuilding(g);
  const kill = (at) => {
    const cat = g.entities.add(new Actor(g, { id: `cat_${Math.round(at.x)}`, name: 'Cat', faction: 'animal', maxHp: 4, x: at.x, y: at.y }));
    cat.species = 'cat';
    put(g.player, at.x - 10, at.y);
    g.combat.damage(g.player, cat, 999, { exact: true, crit: false });
    return cat;
  };
  holdLyra(g, west.x, west.y);
  assert.equal(look(g, L, east.x, east.y), null, 'the house is between them');
  const before = a.ledger.length;
  kill(east);
  assert.equal(a.ledger.length, before, 'what she could not see is not on her ledger');
  const sq = g.locations.get('town_square').center;
  holdLyra(g, sq.x + 50, sq.y);
  assert.ok(look(g, L, sq.x - 10, sq.y), 'in the open, she sees');
  kill({ x: sq.x - 10, y: sq.y });
  assert.ok(a.ledger.some((e) => e.deed === 'killed_harmless'), 'and what she sees, she keeps');
});

test('A6: villagers’ sightings and the "who saw it" of gossip use the same eyes: no seeing through a house', () => {
  const g = makeVillage({ hour: 12 });
  quietAll(g, ['elda', 'bram']);
  const { west, east } = aroundBuilding(g);
  const elda = g.entities.get('elda');
  const bram = g.entities.get('bram');
  put(elda, west.x, west.y);
  put(bram, east.x, east.y);
  assert.equal(g.villageLife.sight.canSee(elda, bram), false, 'a house between them');
  assert.ok(!g.village.witnessesNear(east.x, east.y, 150, { sight: true }).includes('elda'));
  put(elda, east.x, east.y + 50);
  assert.equal(g.villageLife.sight.canSee(elda, bram), true);
});

test('A6: a killing seen travels only by meeting: the watch learns when the witness reaches them, not before', async () => {
  const g = makeVillage({ hour: 12 });
  quietAll(g, ['bram', 'elda', 'wys', 'mira']);
  const sq = g.locations.get('town_square').center;
  const bram = g.entities.get('bram');
  const elda = g.entities.get('elda');
  const wys = g.entities.get('wys');
  const mira = g.entities.get('mira');
  for (const e of [bram, mira]) e.think = () => {};
  put(bram, sq.x, sq.y);
  put(g.player, sq.x - 14, sq.y);
  put(elda, sq.x + 50, sq.y - 10);
  // Mira far off across the village; Wys at the guardhouse.
  put(mira, tpx(20), tpx(20));
  const gh = g.locations.get('guardhouse').center;
  put(wys, gh.x, gh.y);
  wys.think = () => {};
  downBy(g, bram);
  const rec = g.murder.kill(bram, g.player);
  const r = g.village.rumors.get(rec.rumor);
  assert.deepEqual(r.heardBy.filter((x) => x !== 'bram').sort(), ['elda'], 'only the one who saw it knows');
  assert.notEqual(g.player.crime?.kind, 'murder');
  assert.ok(elda.fleeTo, 'Elda runs for the watch');
  // Someone else's cry for help on the way does not turn her aside.
  const sq2 = { x: elda.x + 30, y: elda.y + 10 };
  elda.onCallForHelp({ victimEntity: mira, attackerEntity: g.player, x: sq2.x, y: sq2.y, severity: 2 });
  assert.equal(elda.mode, 'flee', 'still running for the watch');
  assert.ok(elda.fleeTo, 'still running to them');
  // Spoken to on the way: she answers in terror, and keeps running for them.
  const spoken = await g.village.playerSays(elda, 'Elda, wait!');
  assert.match(spoken.lines[0], /Stay away|Don't|Go away|telling|Murderer|Help/i, spoken.lines[0]);
  assert.ok(elda.fleeTo && elda.fleeHome === 'to', 'still running to the watch');
  for (let i = 0; i < 6; i++) stepVillage(g, 0.5);
  assert.ok(!r.heardBy.includes('mira'), 'Mira, far off, has heard nothing');
  assert.notEqual(g.player.crime?.kind, 'murder', 'on her way: the watch does not know yet');
  // Her own feet take her to Wys at the guardhouse, and she tells him.
  let ran = 0;
  for (let i = 0; i < 400 && !rec.alarm?.raised; i++) {
    stepVillage(g, 0.5);
    ran++;
  }
  assert.equal(rec.alarm.raised, true, 'she told the watch');
  assert.equal(rec.alarm.by, 'wys');
  assert.equal(g.player.crime?.kind, 'murder', 'now the stranger is wanted');
});

test('A6: until the witness reaches the watch, nobody knows who did it: a body found is a mystery, and the shops still trade', () => {
  const g = makeVillage({ hour: 12 });
  quietAll(g, ['bram', 'elda', 'wys', 'garrick', 'tilly']);
  const sq = g.locations.get('town_square').center;
  const bram = g.entities.get('bram');
  const elda = g.entities.get('elda');
  const wys = g.entities.get('wys');
  const tilly = g.entities.get('tilly');
  const garrick = g.entities.get('garrick');
  for (const e of [bram, wys, tilly, garrick]) e.think = () => {};
  put(bram, sq.x, sq.y);
  put(g.player, sq.x - 14, sq.y);
  put(elda, sq.x + 50, sq.y - 10);
  put(tilly, tpx(20), tpx(20));
  const gh = g.locations.get('guardhouse').center;
  put(wys, gh.x, gh.y);
  downBy(g, bram);
  const rec = g.murder.kill(bram, g.player);
  assert.ok(rec.seen.some((s) => s.id === 'elda'));
  // The witness does not stop to "find" the body: she is carrying the news.
  g.murder.bodySeen('elda', 'bram', rec.place);
  assert.equal(rec.foundAt, null, 'a witness is not a finder');
  // Tilly comes upon the body: it is found, and the watch asks questions, but nobody has
  // told them who did it yet.
  put(tilly, bram.x + 30, bram.y + 10);
  g.murder.bodySeen('tilly', 'bram', rec.place);
  assert.ok(rec.foundAt != null, 'the body is found');
  const c = g.murder.cases.bram;
  assert.ok(c, 'a case is open');
  assert.ok(!c.evidence.some((e) => e.kind === 'witness_clear'), `no witness's word yet: ${JSON.stringify(c.evidence.map((e) => e.kind))}`);
  assert.notEqual(c.level, 'certain');
  assert.equal(g.murder.refusesTrade(garrick), false, 'Garrick has heard nothing: he still trades');
  assert.notEqual(g.player.crime?.kind, 'murder');
  // Elda reaches Wys and tells him: now the watch is certain, and the village turns.
  put(elda, wys.x + 20, wys.y);
  for (let i = 0; i < 60 && !rec.alarm?.raised; i++) stepVillage(g, 0.5);
  assert.equal(rec.alarm.by, 'wys');
  assert.ok(g.murder.cases.bram.evidence.some((e) => e.kind === 'witness_clear' && e.by === 'elda'), 'her word is evidence now');
  assert.equal(g.murder.cases.bram.level, 'certain');
  assert.equal(g.murder.refusesTrade(garrick), true, 'the bell has rung: no shop sells to a known killer');
});

test('A6: a witness who has run to the watch tells them at the door, even with Wys inside and her on the step', () => {
  const g = makeVillage({ hour: 12 });
  quietAll(g, ['bram', 'elda', 'wys']);
  const sq = g.locations.get('town_square').center;
  const bram = g.entities.get('bram');
  const elda = g.entities.get('elda');
  const wys = g.entities.get('wys');
  for (const e of [bram, wys]) e.think = () => {};
  const gh = g.map.buildings.find((b) => b.id === 'guardhouse');
  const door = gh.doorTiles[0];
  const dx = door.tx ?? door.x ?? door[0];
  const dy = door.ty ?? door.y ?? door[1];
  const southDoor = dy >= gh.y + gh.h - 1;
  put(wys, tpx(dx), tpx(southDoor ? dy - 1 : dy + 1));
  put(bram, sq.x, sq.y);
  put(g.player, sq.x - 14, sq.y);
  put(elda, sq.x + 50, sq.y - 10);
  downBy(g, bram);
  const rec = g.murder.kill(bram, g.player);
  assert.ok(rec.seen.some((s) => s.id === 'elda'));
  // She arrives on the step, outside, Wys just inside: not the same roof.
  elda.think = () => {};
  put(elda, tpx(dx), tpx(southDoor ? dy + 1 : dy - 1));
  assert.equal(g.village.meeting(elda, wys), false, 'not under one roof');
  stepVillage(g, 0.5);
  assert.equal(rec.alarm?.raised, true, 'she shouted it in at the door');
  assert.equal(rec.alarm.by, 'wys');
  assert.ok(g.village.rumors.get(rec.rumor).heardBy.includes('wys'), 'and Wys heard it from her');
});

// ------------------------------------------------------------------ A7: witnesses are people

test('never a locked chat: nothing the player reads says someone "won\'t talk to you" (the author: "even if somebody really hates me, make me able to talk to them")', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('../src/', import.meta.url).pathname;
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.js')) files.push(p);
    }
  };
  walk(root);
  const hits = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/(?:won['’]t (?:talk|speak) to you|will not talk to you|beyond a word)/gi)) hits.push(`${f.slice(root.length)}: ${m[0]}`);
  }
  assert.deepEqual(hits, [], 'no lock wording left');
  const { COMPANIONSHIP } = await import('../src/ui/lyra_view.js');
  assert.match(COMPANIONSHIP.gone.blurb, /hears you/);
});


test('A7: Elda watches the stranger kill: terrified, she runs and screams, answers only in terror (never a locked chat); after several killings, never calm again', async () => {
  const g = makeVillage({ hour: 12 });
  quietAll(g, ['bram', 'elda', 'tobias', 'garrick']);
  const sq = g.locations.get('town_square').center;
  const elda = g.entities.get('elda');
  for (const id of ['bram', 'tobias', 'garrick']) g.entities.get(id).think = () => {};
  const killNear = (id, dx) => {
    const v = g.entities.get(id);
    put(v, sq.x + dx, sq.y);
    put(g.player, sq.x + dx - 14, sq.y);
    put(elda, sq.x + dx + 50, sq.y - 10);
    downBy(g, v);
    return g.murder.kill(v, g.player);
  };
  const rec = killNear('bram', 0);
  assert.ok(rec.seen.some((s) => s.id === 'elda'));
  assert.equal(g.murder.fearOf(elda), 'terror');
  assert.equal(elda.mode, 'flee', 'she runs');
  assert.ok(g.said.some((s) => s.who === 'elda'), 'screaming');
  // The author: "even if somebody really hates me, make me able to talk to them". What the
  // player sees as they turn to her, and no lock: their words reach her and are kept.
  assert.equal(typeof g.village.refusesTalk, 'undefined', 'no refusal lock left');
  assert.match(g.village.fearNote(elda), /backs away from you/);
  assert.doesNotMatch(g.village.fearNote(elda), /won't talk/);
  const r1 = await g.village.playerSays(elda, 'WILL YOU TALK TO LYRA FOR ME');
  assert.ok(g.village.talks.elda.some((t) => /WILL YOU TALK TO LYRA/.test(t.you)), 'what the player said reached her, and is remembered');
  assert.ok(!g.village.commitments.open('elda').length, 'no errands run for a killer');
  assert.match(r1.lines[0], /Stay away|Don't|Go away|telling/i, `only fear: ${r1.lines[0]}`);
  // A second killing before her eyes: dread, for good.
  killNear('tobias', 80);
  assert.equal(elda.dread, true);
  g.clock.t += 2 * 900; // days later, the terror past
  assert.equal(g.murder.fearOf(elda), 'dread');
  assert.match(g.village.fearNote(elda) || '', /keeps (her|his) distance/, 'she can be spoken to, as ever…');
  const v = g.village;
  v.provider = () => ({ id: 'fake' });
  let asked = 0;
  v.askClaude = async () => {
    asked++;
    return { say: 'Oh, hello love, sit down.', mood: 'warm', opinion_delta: 1, learned: [], rumor_told: null, rumor: null, name: null, memory: null, asked: null, commit: null };
  };
  const r2 = await v.playerSays(elda, 'hello Elda, how are you?');
  assert.equal(asked, 0, '…but never calmly: no warm Claude reply');
  assert.match(r2.lines[0], /Stay away|Don't|Go away|telling/i, r2.lines[0]);
  // And it survives a save.
  const saved = JSON.parse(JSON.stringify(g.murder.serialize()));
  elda.dread = false;
  g.murder.deserialize(saved);
  assert.equal(elda.dread, true);
});

// ------------------------------------------------------------------ silence is a choice made after hearing

import { TalkSession } from '../src/ui/village_view.js';

// The author (brief, AUTHOR UPDATE): "make them able to choose to not respond to me but they
// have to get my msg so they get it and decide to not answer". Every line reaches them and is
// kept; then they choose; silence is shown as what they do, never as a lock or a failure.
test('silence, terrified: pressed on and on, Elda answers in terror, begs, screams for help, then says nothing — every word kept, the silence a visible act', async () => {
  const g = makeVillage({ hour: 12 });
  quietAll(g, ['bram', 'elda']);
  const sq = g.locations.get('town_square').center;
  const elda = g.entities.get('elda');
  const bram = g.entities.get('bram');
  bram.think = () => {};
  put(bram, sq.x, sq.y);
  put(g.player, sq.x - 14, sq.y);
  put(elda, sq.x + 50, sq.y - 10);
  downBy(g, bram);
  g.murder.kill(bram, g.player);
  assert.equal(g.murder.fearOf(elda), 'terror');
  const talk = new TalkSession({ village: g.village, npc: elda });
  const said = ['Elda, wait', 'I just want to talk', 'please listen to me', 'ELDA'];
  const got = [];
  for (const t of said) got.push(await talk.send(t));
  assert.match(got[0].lines[0], /Stay away|Don't come near/, `terror: ${got[0].lines[0]}`);
  assert.match(got[1].lines[0], /Please/, `she begs: ${got[1].lines[0]}`);
  assert.match(got[2].lines[0], /help/i, `she screams for help: ${got[2].lines[0]}`);
  assert.equal(got[3].silent, true, 'then silence, her choice');
  assert.equal(got[3].ok, false);
  assert.match(got[3].lines[0], /^Elda (hears you|stares at you).*(says nothing|without a word)/, `a visible act: ${got[3].lines[0]}`);
  assert.doesNotMatch(got[3].lines[0], /catch that|can't hear|won't talk/);
  // Every word reached her: in the talk she keeps, and in what she remembers of the player.
  for (const t of said) assert.ok(g.village.talks.elda.some((x) => x.you === t), `kept: ${t}`);
  assert.equal(g.village.talks.elda.at(-1).silent, true);
  const { notesOf } = await import('../src/ai/social/player_talk.js');
  assert.ok(notesOf(g.village, 'elda').some((n) => /after I saw what you did/.test(n.text)));
});

test('silence, cold: someone done with the player answers coldly, lets the next line go unanswered (shown as an act), then answers again', async () => {
  const g = makeVillage({ hour: 11 });
  clearScene(g, ['bram']);
  const bram = g.entities.get('bram');
  const P = g.player;
  P.x = bram.x + 18;
  P.y = bram.y;
  bram.opinionOfPlayer = 5; // hostile: cold to them
  const talk = new TalkSession({ village: g.village, npc: bram });
  const a = await talk.send('hello Bram');
  assert.equal(a.ok, true, `a cold word first: ${a.lines[0]}`);
  const b = await talk.send('come on, talk to me');
  assert.equal(b.silent, true, 'pressed at once: silence');
  assert.match(b.lines[0], /^Bram hears (you|every word)/);
  assert.ok(g.village.talks.bram.some((x) => x.you === 'come on, talk to me' && x.silent), 'the line reached him and is kept');
  const c = await talk.send('fine, be like that');
  assert.equal(c.ok, true, 'then a word again');
  // A friend never goes quiet on them for no reason.
  const elda = g.entities.get('elda');
  elda.opinionOfPlayer = 80;
  P.x = elda.x + 18;
  P.y = elda.y;
  for (const t of ['hello', 'how are you?']) assert.equal((await g.village.playerSays(elda, t)).silent, undefined);
});

test('silence with Claude: the reply may be silence (the schema carries it); kept when the game sees a reason, a friend’s falls back to words', async () => {
  const g = makeVillage({ hour: 11 });
  clearScene(g, ['bram', 'elda']);
  const v = g.village;
  const bram = g.entities.get('bram');
  const elda = g.entities.get('elda');
  const P = g.player;
  const { SAY_SCHEMA, buildSayTask, VILLAGER_RULES } = await import('../src/ai/social/village_prompt.js');
  assert.ok(SAY_SCHEMA.properties.silent && SAY_SCHEMA.required.includes('silent'));
  assert.match(VILLAGER_RULES, /always hear what the player says[^]*"silent"/);
  v.provider = () => ({ id: 'fake' });
  const tasks = [];
  v.askClaude = async (p, rules, task) => {
    tasks.push(task);
    return { say: '', silent: true, mood: 'cold', opinion_delta: -1, learned: [], rumor_told: null, rumor: null, name: null, memory: 'you kept on at me after what you did', asked: null, commit: null };
  };
  bram.opinionOfPlayer = 5;
  P.x = bram.x + 18;
  P.y = bram.y;
  const r = await v.playerSays(bram, 'Bram, I need a sword');
  assert.equal(r.silent, true, 'Claude chose silence, and the game sees a reason (he is cold)');
  assert.match(r.act, /^Bram /);
  assert.ok(v.talks.bram.some((x) => x.you === 'Bram, I need a sword' && x.silent));
  // His next prompt carries that he heard it and said nothing.
  await v.playerSays(bram, 'hello?');
  assert.match(tasks.at(-1), /Bram, I need a sword" You: \(you heard it, and said nothing\)/);
  // A friend's silence for no reason is not kept: their own words instead.
  elda.opinionOfPlayer = 85;
  P.x = elda.x + 18;
  P.y = elda.y;
  const f = await v.playerSays(elda, 'good morning Elda!');
  assert.notEqual(f.silent, true);
  assert.ok(f.lines.length && f.lines[0].length > 1, `words: ${f.lines[0]}`);
  assert.match(buildSayTask(v.sayBrief(elda, 'hi', { lines: ['Hm.'] })), /"silent"/);
});

test('silence, Lyra with Claude: cut off, she hears every word and may answer with nothing — shown as an act; together, an empty say is still answered', async () => {
  const back = quiet();
  const prompts = [];
  const g = makeGame({ hour: 10 });
  g.runtime = fakeRuntime(async (p) => {
    prompts.push(String(p));
    return { thought: 'I will not.', say: '', emotion: { name: 'anger', intensity: 0.4 }, actions: [], memories: [], relationships: [], goal: null };
  });
  g.brain.providers = new (g.brain.providers.constructor)(g);
  const L = g.companion;
  const P = g.player;
  placeAt(g, L, P.x + 24, P.y);
  L.mind.autonomy.setCompanionship('gone', 'You hurt me.', { cause: 'downed', goneReason: 'downed', silent: true });
  const r = await g.brain.handlePlayerMessage('Lyra, please, just say something');
  back();
  assert.equal(r.provider, 'claude.ai');
  assert.match(prompts[0], /hear every word[^]*nothing at all/);
  assert.equal(r.silent, true);
  const row = g.ui.chat.messages.at(-1);
  assert.equal(row.from, 'system');
  assert.match(row.text, /^Lyra hears (you|every word)/);
  assert.ok(L.mind.conversation.some((c) => c.role === 'player' && /just say something/.test(c.text)), 'her record has the words');
  // Together, Claude's empty say is not a silence: she answers in her own words.
  const g2 = makeGame({ hour: 10 });
  g2.runtime = fakeRuntime(async () => ({ thought: '', say: '', emotion: { name: 'calm', intensity: 0.2 }, actions: [], memories: [], relationships: [], goal: null }));
  g2.brain.providers = new (g2.brain.providers.constructor)(g2);
  placeAt(g2, g2.companion, g2.player.x + 24, g2.player.y);
  const r2 = await g2.brain.handlePlayerMessage('how are you?');
  assert.notEqual(r2.silent, true);
  assert.ok(r2.say, 'words');
});
