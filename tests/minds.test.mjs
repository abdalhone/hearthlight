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
  const { g, L, P, a, r } = await chapelProposal();
  assert.ok(!r.actions.some((x) => x.name === 'follow'), '"lets go" is a yes to her, not "follow me"');
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
