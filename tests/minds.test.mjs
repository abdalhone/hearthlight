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

test('A6: a killing seen travels only by meeting: the watch learns when the witness reaches them, not before', () => {
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

// ------------------------------------------------------------------ A7: witnesses are people

test('A7: Elda watches the stranger kill: terrified, she runs and screams, will not talk; after several killings, never calm again', async () => {
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
  assert.match(g.village.refusesTalk(elda), /won't talk to you/, 'the chat closes on her');
  const r1 = await g.village.playerSays(elda, 'WILL YOU TALK TO LYRA FOR ME');
  assert.ok(!g.village.commitments.open('elda').length, 'no errands run for a killer');
  assert.match(r1.lines[0], /Stay away|Don't|Go away|telling/i, `only fear: ${r1.lines[0]}`);
  // A second killing before her eyes: dread, for good.
  killNear('tobias', 80);
  assert.equal(elda.dread, true);
  g.clock.t += 2 * 900; // days later, the terror past
  assert.equal(g.murder.fearOf(elda), 'dread');
  assert.equal(g.village.refusesTalk(elda), null, 'she can be spoken to again…');
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
