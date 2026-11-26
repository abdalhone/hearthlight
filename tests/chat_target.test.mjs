// Talk to anyone, the way you talk to Lyra (DESIGN.md §23). Node tests for who can hear
// the player, what each villager keeps of them (their name, what was said, their own
// saved conversation), the local answers that ask back and remember, the Claude path
// (mocked) and its prompt's safety; then a browser pass (Playwright, from the source)
// that switches targets in the chat, talks to a villager, saves and loads, walks out of
// earshot, clicks someone in the world, and takes screenshots on a phone held both ways
// and on a desktop. Screenshots go to $SHOTS (default screenshots/chat_target/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EventBus } from '../src/core/events.js';
import { RNG } from '../src/core/rng.js';
import { GameClock } from '../src/core/time.js';
import { DAY_SECONDS } from '../src/core/constants.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { EntityManager } from '../src/entities/manager.js';
import { Actor } from '../src/entities/entity.js';
import { NPC_PROFILES } from '../src/entities/npc_data.js';
import { Village } from '../src/ai/social/village.js';
import { VILLAGERS } from '../src/ai/social/bonds_data.js';
import { hiddenIn, speakable } from '../src/ai/social/hidden.js';
import { fill } from '../src/ai/social/lines.js';
import { VILLAGER_RULES, buildSayTask, coerceSay, SAY_SCHEMA, publicText } from '../src/ai/social/village_prompt.js';
import { ASK_YOU, detectName, knownName, chatOf, recordChat, notesOf, addNote, cleanYou, CHAT_CAP, understand } from '../src/ai/social/player_talk.js';
import { EARSHOT, EARSHOT_LOSE, earshotPeople, whyNotHeard, pickActorAt, toneOf, standingOf, partingLine, villagerChips, inFight } from '../src/ui/chat_target.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------------ a small village

function villager(game, id, x, y) {
  const profile = NPC_PROFILES.find((p) => p.id === id);
  const a = new Actor(game, { id, name: profile.name, faction: profile.faction || 'villager', x, y, maxHp: 40 });
  a.profile = profile;
  a.role = profile.role;
  a.kind = 'human';
  a.mode = 'routine';
  a.activity = 'socialize';
  a.opinionOfPlayer = 45;
  a.familiarity = 0;
  a.told = new Set();
  a.said = [];
  a.say = (text, o) => a.said.push({ text, o });
  a.adjustOpinion = function adjustOpinion(d) {
    const before = this.opinionOfPlayer;
    this.opinionOfPlayer = Math.max(0, Math.min(100, before + d));
    return this.opinionOfPlayer - before;
  };
  return game.entities.add(a);
}

function makeGame({ provider = null, hour = 10, seed = 5, settings = {} } = {}) {
  const game = {
    bus: new EventBus(),
    rng: new RNG(seed),
    time: 1,
    state: 'playing',
    flags: {},
    settings: { ...DEFAULT_SETTINGS, ...settings },
    bubbles: { say() {}, icon() {} },
    ui: { toast() {}, chat: { isOpen: () => false } },
    brain: { providers: { current: () => provider } },
  };
  game.clock = new GameClock(game);
  game.clock.weather.timer = 1e9;
  game.clock.t = (hour / 24) * DAY_SECONDS;
  game.entities = new EntityManager(game);
  game.player = game.entities.add(new Actor(game, { id: 'player', name: 'Wren', faction: 'player', x: 1000, y: 1000, maxHp: 50 }));
  const people = {};
  VILLAGERS.forEach((id, i) => (people[id] = villager(game, id, 100 + (i % 6) * 20, 100 + Math.floor(i / 6) * 20)));
  game.village = new Village(game);
  return { game, people, v: game.village };
}

function mockProvider(reply) {
  const p = {
    id: 'claude.ai',
    calls: [],
    available: () => true,
    async complete(req) {
      p.calls.push(req);
      return typeof reply === 'function' ? reply(req, p.calls.length) : reply;
    },
  };
  return p;
}

// One turn the way the chat does it: the player's line and the answer join the history.
async function talk(v, e, text) {
  recordChat(v, e.id, { from: 'player', text });
  const r = await v.playerSays(e, text);
  for (const l of r.lines) recordChat(v, e.id, { from: 'npc', text: l });
  v.game.time += 5;
  return r;
}

// ------------------------------------------------------------------ who can hear you

function earWorld() {
  const ents = [];
  const game = {
    player: { id: 'player', x: 200, y: 200 },
    companion: { id: 'lyra', name: 'Lyra', x: 210, y: 205 },
    entities: { all: () => ents, get: (id) => ents.find((e) => e.id === id) || null },
    // One building: tiles 20..29 on both axes.
    map: { buildingAt: (tx, ty) => (tx >= 20 && tx < 30 && ty >= 20 && ty < 30 ? { id: 'kettle' } : null) },
  };
  const b = (tx, ty) => (tx >= 20 && tx < 30 && ty >= 20 && ty < 30 ? 'kettle' : null);
  game.map.buildingAt = ((cache) => (tx, ty) => {
    const k = b(tx, ty);
    if (!k) return null;
    return (cache[k] ||= { id: k });
  })({});
  const add = (id, x, y, extra = {}) => {
    const e = { id, name: `${id[0].toUpperCase()}${id.slice(1)} Someone`, profile: { id }, x, y, state: 'idle', opinionOfPlayer: 50, ...extra };
    ents.push(e);
    return e;
  };
  ents.push(game.player, game.companion);
  return { game, add };
}

test('earshot: near and under the same roof, nearest first; a chip holds a little longer', () => {
  const { game, add } = earWorld();
  const near = add('hobb', 240, 210);
  const nearer = add('elda', 215, 200);
  const far = add('bram', 200 + EARSHOT + 20, 200);
  const inside = add('mira', 22 * 16, 22 * 16);
  const down = add('pip', 205, 215, { downed: true });
  assert.deepEqual(earshotPeople(game).map((e) => e.id), ['elda', 'hobb']);
  assert.equal(whyNotHeard(game, far), 'far');
  assert.equal(whyNotHeard(game, down), 'downed');
  // Through a wall: the player outside, Mira inside the Kettle (close enough to touch).
  game.player.x = 19 * 16 + 8;
  game.player.y = 22 * 16;
  assert.equal(whyNotHeard(game, inside), 'walls');
  game.player.x = 200;
  game.player.y = 200;
  // Hysteresis: someone already in the row stays until EARSHOT_LOSE.
  near.x = 200 + (EARSHOT + EARSHOT_LOSE) / 2;
  assert.ok(!earshotPeople(game).some((e) => e.id === 'hobb'));
  assert.ok(earshotPeople(game, { keep: ['hobb'] }).some((e) => e.id === 'hobb'));
  assert.ok(nearer);
});

test('a tap lands on the person drawn there, Lyra included', () => {
  const { game, add } = earWorld();
  add('hobb', 300, 300);
  add('elda', 330, 300);
  assert.equal(pickActorAt(game, 301, 290)?.id, 'hobb'); // his chest
  assert.equal(pickActorAt(game, 331, 280)?.id, 'elda'); // her head
  assert.equal(pickActorAt(game, 315, 340), null); // empty ground
  assert.equal(pickActorAt(game, 211, 196)?.id, 'lyra');
  // In a fight a click is a sword stroke.
  assert.equal(inFight(game), false);
  game.entities.all().push({ id: 'wolf1', faction: 'monster', species: 'wolf', x: 230, y: 210 });
  assert.equal(inFight(game), true);
});

test('a finger finds someone walking away: where they were a moment ago counts too (she keeps away; the player can still talk to her)', () => {
  const { game, add } = earWorld();
  const elda = add('elda', 300, 300);
  // She walks east at 60 px/s; the finger comes down where she was 0.3 s ago.
  elda.moveIntent = { x: 1, y: 0 };
  elda.speed = 60;
  elda.speedMul = 1;
  assert.equal(pickActorAt(game, 300 - 18, 290, { pad: 6 }), null, 'without the lag, a miss');
  assert.equal(pickActorAt(game, 300 - 18, 290, { pad: 6, lag: 0.4 })?.id, 'elda', 'a tap just behind her is hers');
  assert.equal(pickActorAt(game, 300 + 18, 290, { pad: 6, lag: 0.4 }), null, 'never ahead of her');
  // Standing still, nothing changes.
  elda.moveIntent = { x: 0, y: 0 };
  assert.equal(pickActorAt(game, 300 - 18, 290, { pad: 6, lag: 0.4 }), null);
  // Someone standing where the tap lands still wins over someone passing behind it.
  const hobb = add('hobb', 282, 300);
  elda.moveIntent = { x: 1, y: 0 };
  assert.equal(pickActorAt(game, 283, 290, { pad: 6, lag: 0.4 })?.id, 'hobb');
  assert.ok(hobb);
});

test('chips, tones and parting lines read right', () => {
  assert.equal(toneOf(5), 'hostile');
  assert.equal(toneOf(25), 'wary');
  assert.equal(toneOf(40), 'neutral');
  assert.equal(toneOf(60), 'friendly');
  assert.equal(toneOf(90), 'fond');
  const { game, people } = makeGame();
  people.hobb.state = 'sleep';
  assert.equal(standingOf(game, people.hobb).asleep, true);
  assert.equal(partingLine(people.hobb, 'far', 'they'), 'Hobb has gone on his way.');
  assert.equal(partingLine(people.elda, 'far', 'they'), 'Elda has gone on her way.');
  assert.match(partingLine(people.mira, 'far', 'you'), /leave Mira to her day/);
  // "I'm <name>." is offered while they do not know it (and the player has a name).
  assert.ok(villagerChips({ settings: { playerName: 'Wren' } }, 'hobb', false).includes("I'm Wren."));
  assert.ok(!villagerChips({ settings: { playerName: 'Wren' } }, 'hobb', true).includes("I'm Wren."));
  assert.ok(!villagerChips({ settings: { playerName: 'Traveler' } }, 'hobb', false).some((c) => /^I'm/.test(c)));
});

// ------------------------------------------------------------------ what they keep of you

test('the player tells their name: understood, kept, and used', async () => {
  assert.equal(detectName("Hi, I'm Wren!"), 'Wren');
  assert.equal(detectName('my name is wren'), 'Wren');
  assert.equal(detectName('call me Ash'), 'Ash');
  assert.equal(detectName("I'm fine, thanks"), null);
  assert.equal(detectName("I'm sorry"), null);
  assert.equal(detectName('i am hungry'), null);
  assert.equal(detectName('Wren', { asked: true }), 'Wren');
  assert.equal(detectName('bye', { asked: true }), null);
  assert.equal(detectName('thanks', { asked: true }), null);
  assert.equal(understand("I'm Pip").name, 'Pip');
  const { people, v } = makeGame();
  const r = await talk(v, people.hobb, "Hello, I'm Wren.");
  assert.equal(knownName(v, 'hobb'), 'Wren');
  assert.equal(knownName(v, 'elda'), '', 'only the one told knows it');
  assert.ok(r.lines.some((l) => /Wren/.test(l)), r.lines.join(' | '));
  const again = await talk(v, people.hobb, "what's my name?");
  assert.ok(again.lines[0].includes('Wren'), again.lines.join(' | '));
  const elda = await talk(v, people.elda, 'do you know my name?');
  assert.ok(/never/i.test(elda.lines.join(' ')), elda.lines.join(' | '));
});

test('they ask things back, and hear the answer', async () => {
  // Over a few seeds, someone asks a question of their own; the next line answers it.
  let seen = 0;
  for (let seed = 1; seed <= 30 && seen < 3; seed++) {
    const { people, v } = makeGame({ seed });
    const e = people.elda;
    await talk(v, e, "Hi, I'm Wren");
    const r = await talk(v, e, 'Hello! How are you?');
    const q = v.pendingAsk.elda;
    if (!q || q.kind !== 'q') continue;
    seen++;
    const bank = ASK_YOU.elda.ask[q.i];
    // (A leading word they had just said may be dropped: "Oi! … What's your name?")
    const asked = fill(bank[0], { n: 'Wren' }).toLowerCase();
    assert.ok(r.lines.some((l) => asked.endsWith(l.toLowerCase())), `asked: ${r.lines.join(' | ')}`);
    const a = await talk(v, e, 'no, not yet');
    assert.equal(a.intent, 'answer');
    assert.ok(a.lines[0] === fill(bank[2], { n: 'Wren' }), `answered: ${a.lines.join(' | ')}`);
    assert.ok(!v.pendingAsk.elda || v.pendingAsk.elda.kind !== 'q' || v.pendingAsk.elda.i !== q.i, 'that question is closed');
  }
  assert.ok(seen >= 1, 'somebody asked something back');
  // Not knowing the name, they ask for it, and a bare name answers.
  let named = false;
  for (let seed = 1; seed <= 40 && !named; seed++) {
    const { people, v } = makeGame({ seed });
    const e = people.hobb;
    await talk(v, e, 'hello');
    await talk(v, e, 'how are you?');
    if (v.pendingAsk.hobb?.kind !== 'name') continue;
    const r = await talk(v, e, 'Wren');
    assert.equal(knownName(v, 'hobb'), 'Wren');
    assert.ok(r.lines.some((l) => /Wren/.test(l)));
    named = true;
  }
  assert.ok(named, 'Hobb asked the name and learned it');
});

test('another day, they bring up last time; what was said is remembered', async () => {
  const { game, people, v } = makeGame({ seed: 3 });
  const e = people.bram;
  await talk(v, e, "I'm Wren");
  await talk(v, e, 'tell me about the bandits');
  assert.ok(notesOf(v, 'bram').some((n) => /bandits/.test(n.text)));
  game.clock.t += DAY_SECONDS;
  game.time += 600;
  const r = await talk(v, e, 'hello Bram');
  assert.ok(r.lines.some((l) => /Last time you asked me about the bandits/.test(l)), r.lines.join(' | '));
  const r2 = await talk(v, e, 'hello again');
  assert.ok(!r2.lines.some((l) => /Last time/.test(l)), 'once a day');
});

test('asleep they mumble or say nothing; wronged they refuse in their own words; barred, they say so', async () => {
  const { people, v } = makeGame();
  people.hobb.state = 'sleep';
  for (let i = 0; i < 4; i++) {
    const z = await talk(v, people.hobb, 'hello?');
    assert.equal(z.lines.length, 1);
    assert.equal(z.mood, 'sleepy');
  }
  // Wronged: Wenna has heard the player knocked Lyra down.
  v.addRumor('downed_lyra', { witnesses: ['wenna'] });
  v.grievances.wenna = { kind: 'downed_lyra', victim: 'lyra', t: v.now(), day: v.day(), weight: 10, grave: true };
  const w = await talk(v, people.wenna, 'Hello! How are you?');
  assert.equal(w.intent, 'cold');
  assert.ok(/daughter|feet|go away|no\./i.test(w.lines.join(' ')), w.lines.join(' | '));
  // Barred from the Kettle: Elda says so, once a day.
  v.bar('ember_kettle', { days: 1, by: 'rowan', reason: 'test' });
  const b = await talk(v, people.elda, 'hello love');
  assert.ok(/welcome|door|hearth/i.test(b.lines.join(' ')), b.lines.join(' | '));
  const b2 = await talk(v, people.elda, 'hello again');
  assert.ok(!/door's that way|welcome at my hearth/i.test(b2.lines.join(' ')));
});

test('every new line in every villager’s bank fills and keeps the hidden truths', () => {
  for (const id of VILLAGERS) {
    const bank = ASK_YOU[id];
    assert.ok(bank, id);
    const lines = [...bank.askName, ...bank.heard, ...bank.again.map((l) => l.replace('{memory}', 'you asked me about the bandits')), ...bank.ask.flat()];
    assert.ok(bank.ask.length >= 2 && bank.heard.length >= 1 && bank.again.length >= 1);
    for (const l of lines) {
      for (const n of ['Wren', '']) {
        const out = fill(l, { n, memory: 'you asked me about the bandits' });
        assert.ok(out && !/\{\w+\}/.test(out), `${id}: ${l}`);
        assert.ok(speakable(out), `${id}: ${out}`);
      }
    }
  }
});

test('each villager keeps their own conversation: capped, saved and loaded', async () => {
  const { people, v } = makeGame();
  for (let i = 0; i < CHAT_CAP + 15; i++) recordChat(v, 'hobb', { from: i % 2 ? 'npc' : 'player', text: `line ${i}` });
  await talk(v, people.elda, "I'm Wren");
  addNote(v, 'elda', 'you told me you have never seen the sea', 2);
  assert.equal(chatOf(v, 'hobb').length, CHAT_CAP);
  assert.equal(chatOf(v, 'hobb').at(-1).text, `line ${CHAT_CAP + 14}`);
  assert.equal(chatOf(v, 'bram').length, 0);
  const data = JSON.parse(JSON.stringify(v.serialize()));
  const fresh = makeGame();
  fresh.v.deserialize(data);
  assert.deepEqual(chatOf(fresh.v, 'hobb'), chatOf(v, 'hobb'));
  assert.deepEqual(chatOf(fresh.v, 'elda'), chatOf(v, 'elda'));
  assert.equal(knownName(fresh.v, 'elda'), 'Wren');
  assert.ok(notesOf(fresh.v, 'elda').some((n) => /sea/.test(n.text)));
  // Junk in a save is dropped, not trusted.
  const dirty = cleanYou({ names: { hobb: 'Wren<script>', nobody: 'X' }, chats: { hobb: [{ from: 'hacker', text: 'x' }, { from: 'npc', text: 'ok' }] }, notes: { hobb: [{ text: 'Varek is my brother', day: 1 }] } });
  assert.equal(dirty.names.hobb, undefined);
  assert.equal(dirty.chats.hobb.length, 1);
  assert.equal(dirty.notes.hobb, undefined);
  // Old saves without it load as before.
  const old = makeGame();
  delete data.you;
  old.v.deserialize(data);
  assert.deepEqual(chatOf(old.v, 'hobb'), []);
});

// ------------------------------------------------------------------ Claude, on the player's action

test('Claude speaks with that villager’s mind: profile, voice, opinion, facts, news, memories and the talk so far', async () => {
  const provider = mockProvider((req, n) =>
    n === 1
      ? { say: "Wren, is it? Well now. Sit a while. Have you eaten?", mood: 'warm', opinion_delta: 2, learned: [], rumor_told: null, rumor: null, name: 'Wren', memory: 'you told me you came down the mountain hungry', asked: 'other' }
      : { say: 'Mm. Good. Lamps want lighting soon.', mood: 'warm', opinion_delta: 0, learned: [], rumor_told: null, rumor: null, name: null, memory: null, asked: null },
  );
  const { people, v } = makeGame({ provider });
  v.addRumor('rescued', { victim: 'tansy', beast: 'wolf', witnesses: ['hobb'] });
  people.hobb.familiarity = 40;
  const r = await talk(v, people.hobb, "Evening, Hobb. I'm Wren.");
  assert.equal(provider.calls.length, 1, 'one call, on the player’s line');
  assert.deepEqual(r.lines, ['Wren, is it? Well now. Sit a while. Have you eaten?']);
  const task = provider.calls[0].task;
  assert.ok(task.includes('Hobb Ambrel'));
  assert.ok(task.includes("Evening, Hobb. I'm Wren."));
  assert.ok(/do not know their name/i.test(task), 'they have not been told the name yet');
  assert.ok(/News you have heard/.test(task) && /wolf off Tansy/i.test(task), 'the news they carry');
  assert.ok(/"say": string/.test(task), 'claude.ai has no schema: the format is in the prompt');
  assert.equal(knownName(v, 'hobb'), 'Wren');
  assert.ok(notesOf(v, 'hobb').some((n) => /mountain hungry/.test(n.text)));
  assert.equal(v.pendingAsk.hobb?.kind, 'claude');
  await talk(v, people.hobb, 'Not since morning.');
  const t2 = provider.calls[1].task;
  assert.ok(/Their name is Wren/.test(t2));
  assert.ok(/What you remember of them: .*mountain hungry/.test(t2));
  assert.ok(/The conversation so far/.test(t2) && t2.includes('Have you eaten?'), 'the talk so far');
  assert.ok(/You had just asked them a question/.test(t2));
  assert.ok(!t2.includes('They: "Not since morning."'), 'the new line is not doubled into the history');
  // The structured-output schema lists every field (optional ones nullable).
  assert.deepEqual([...SAY_SCHEMA.required].sort(), Object.keys(SAY_SCHEMA.properties).sort());
});

test('a Claude answer that states a hidden truth, or none at all, falls back to their own words', async () => {
  const bad = mockProvider({ say: 'Between us, Varek is my brother.', opinion_delta: 1 });
  const a = makeGame({ provider: bad });
  const r = await talk(a.v, a.people.sabeth, 'hello, how are you?');
  assert.ok(!/varek/i.test(r.lines.join(' ')));
  assert.equal(r.source, 'local');
  const broken = mockProvider(() => {
    throw Object.assign(new Error('nope'), { code: 'rate_limited' });
  });
  const b = makeGame({ provider: broken });
  const r2 = await talk(b.v, b.people.petra, 'how are you?');
  assert.ok(r2.lines.length >= 1 && speakable(r2.lines[0]));
  assert.equal(coerceSay({ say: 'Hm.', opinion_delta: 1, name: 'Wren<b>', memory: 'he lies', asked: 'maybe' }).name, null);
  assert.equal(coerceSay({ say: 'Hm.', opinion_delta: 1, memory: 'he lies' }).memory, null, 'a memory is said to the player: "you …"');
});

test('the villager prompt stays compact and never carries a hidden truth', async () => {
  assert.ok(!/poem/i.test(publicText(NPC_PROFILES.find((p) => p.id === 'bram').personality)), "Bram's poems stay his");
  const { game, people, v } = makeGame();
  // Everything a brief can hold, at its fullest.
  for (const kind of ['rescued', 'gift', 'maren_asking', 'threat', 'helped_up']) v.addRumor(kind, { victim: 'tansy', beast: 'wolf', witnesses: VILLAGERS });
  for (const id of VILLAGERS) {
    const e = people[id];
    e.familiarity = 100;
    e.opinionOfPlayer = 80;
    for (let i = 0; i < 4; i++) await talk(v, e, ['Hello, how are you?', "I'm Wren", 'what about Maren?', 'tell me about the ward'][i]);
    addNote(v, id, 'you asked me about the bandits', 2);
    const said = 'What do you know about the ward, and Maren, and the bandits?';
    const brief = v.sayBrief(e, said, { lines: [] });
    const task = buildSayTask(brief);
    const prompt = `${VILLAGER_RULES}\n\n${task}`;
    assert.equal(hiddenIn(prompt), null, `${id}: ${hiddenIn(prompt)}`);
    assert.ok(!/\b(poems?|poetry|strongbox|ferry-?house|brightborn|in secret)\b/i.test(task), `${id} brief names a private matter`);
    for (const f of e.profile.facts || []) if (f.topic === 'secret' || f.hiddenFrom?.includes?.('player')) assert.ok(!task.includes(`[${f.id}]`), `${id}: ${f.id}`);
    assert.ok(task.length < 5200, `${id}: ${task.length} chars`);
  }
  assert.ok(game);
});

test('what the player says gets around: the rude word and the kind one', async () => {
  const { people, v } = makeGame();
  people.bram.x = people.tilly.x + 30;
  people.bram.y = people.tilly.y;
  await talk(v, people.tilly, 'you are an idiot');
  const r = v.rumors.list.find((x) => x.kind === 'said_insult' && x.victim === 'tilly');
  assert.ok(r, 'a rumor that the player was rude to Tilly');
  assert.ok(r.heardBy.includes('bram'), 'Bram was standing there');
  await talk(v, people.tilly, 'you are stupid');
  assert.equal(v.rumors.list.filter((x) => x.kind === 'said_insult' && x.victim === 'tilly').length, 1, 'once a day');
  const b = await talk(v, people.bram, 'hello Bram');
  assert.ok(/rude to Tilly/.test(b.lines.join(' ')), `Bram brings it up: ${b.lines.join(' | ')}`);
  await talk(v, people.mira, 'you are wonderful, Mira');
  assert.ok(v.rumors.list.some((x) => x.kind === 'said_compliment' && x.victim === 'mira'));
  await talk(v, people.aveline, 'Sister, do you know anything about Maren?');
  assert.ok(v.rumors.list.some((x) => x.kind === 'maren_asking'));
});

test('Lyra overhears when she is near', async () => {
  const { game, people, v } = makeGame();
  const remembered = [];
  const rel = { affinity: 40, trust: 50 };
  game.companion = {
    id: 'lyra',
    x: game.player.x + 30,
    y: game.player.y,
    hp: 10,
    isAlive: () => true,
    mind: {
      noticeText() {},
      remember: (text) => remembered.push(text),
      feel() {},
      relationships: { get: () => rel, adjust: (id, ch) => Object.assign(rel, { affinity: rel.affinity + (ch.affinity || 0) }) },
    },
  };
  people.wenna.x = game.player.x + 20;
  people.wenna.y = game.player.y;
  await talk(v, people.wenna, "I'll kill you, old woman");
  assert.ok(remembered.some((t) => /threatened Wenna/.test(t)), remembered.join(' | '));
  assert.ok(rel.affinity < 40);
  game.companion.x += 2000;
  const before = remembered.length;
  await talk(v, people.wenna, "I'm sorry, truly.");
  assert.equal(remembered.length, before, 'too far to hear');
});

// ------------------------------------------------------------------ in the browser

test('browser: the chat talks to anyone within earshot (and screenshots)', { timeout: 240000 }, async (t) => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    t.skip('playwright is not installed');
    return;
  }
  const { startServer } = await import('../scripts/serve.mjs');
  const shots = process.env.SHOTS || path.join(ROOT, 'screenshots', 'chat_target');
  await mkdir(shots, { recursive: true });
  const server = await startServer(0);
  const url = `http://localhost:${server.address().port}/index.html`;
  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    server.close();
    t.skip(`no browser: ${err.message}`);
    return;
  }
  const views = [
    { label: 'phone', viewport: { width: 390, height: 844 }, touch: true },
    { label: 'phone-land', viewport: { width: 844, height: 390 }, touch: true },
    { label: 'desktop', viewport: { width: 1280, height: 720 }, touch: false },
  ];
  try {
    for (const view of views) {
      const ctx = await browser.newContext({ viewport: view.viewport, deviceScaleFactor: 1, hasTouch: view.touch, isMobile: view.touch });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(url);
      await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 60000 });
      await page.evaluate(() => window.__game.newGame());
      await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 });
      // Stand beside Elda and Pip, with Lyra a step behind; keep them where they are.
      await page.evaluate(() => {
        const g = window.__game;
        g.clock.skipTo?.(11);
        const elda = g.entities.get('elda');
        const pip = g.entities.get('pip');
        for (const e of [elda, pip]) e.update = () => {};
        g.player.x = elda.x + 22;
        g.player.y = elda.y + 4;
        pip.x = elda.x - 18;
        pip.y = elda.y + 2;
        g.companion.x = g.player.x - 14;
        g.companion.y = g.player.y + 16;
        window.__says = [];
        const v = g.village;
        const real = v.playerSays.bind(v);
        v.playerSays = (npc, text) => {
          window.__says.push({ npc: npc?.id, text });
          return real(npc, text);
        };
        g.ui.chat.open(false);
      });
      await page.waitForTimeout(400);
      const chips = await page.$$eval('.chat-to-chip', (els) => els.map((e) => e.dataset.id));
      // Round 14b: "Everyone nearby" first (say it aloud), then the companion (Lyra here).
      assert.equal(chips[0], '@near', `${view.label}: Everyone nearby first`);
      assert.equal(chips[1], 'lyra', `${view.label}: then whoever walks with you`);
      assert.ok(chips.includes('elda') && chips.includes('pip'), `${view.label}: people in earshot ${chips}`);
      // Pick Elda: the field, the history and the header follow.
      await page.click('.chat-to-chip[data-id="elda"]');
      assert.equal(await page.getAttribute('.chat-field', 'placeholder'), 'Say something to Elda…');
      assert.equal(await page.textContent('.chat-name'), 'Elda Thornbury');
      assert.equal(await page.getAttribute('.chat-mic', 'title'), 'Speak to Elda');
      await page.fill('.chat-field', "Hello! I'm Wren. How are you?");
      await page.press('.chat-field', 'Enter');
      await page.waitForFunction(() => document.querySelectorAll('.chat-log .chat-npc-line').length >= 1, null, { timeout: 15000 });
      await page.waitForTimeout(view.label === 'desktop' ? 2600 : 300);
      const said = await page.evaluate(() => window.__says);
      assert.deepEqual(said[0], { npc: 'elda', text: "Hello! I'm Wren. How are you?" }, 'playerSays got Elda and the line');
      const bubble = await page.evaluate(() => window.__game.bubbles.screenRects?.().length ?? 1);
      assert.ok(bubble >= 1, 'a bubble over her');
      await page.screenshot({ path: path.join(shots, `chat-villager-${view.label}.png`) });
      // Back to Lyra: her conversation, not Elda's.
      await page.click('.chat-to-chip[data-id="lyra"]');
      assert.equal(await page.getAttribute('.chat-field', 'placeholder'), 'Say something to Lyra…');
      assert.equal(await page.$$eval('.chat-log .chat-npc-line', (els) => els.length), 0);
      await page.click('.chat-to-chip[data-id="elda"]');
      const lines = await page.$$eval('.chat-log .msg', (els) => els.map((e) => e.textContent));
      assert.ok(lines.some((l) => l.includes("I'm Wren")), 'her history is back');
      // Saved with the game, loaded into a fresh village.
      const kept = await page.evaluate(() => {
        const g = window.__game;
        const data = JSON.parse(JSON.stringify(g.serialize()));
        const before = g.village.you.chats.elda.length;
        g.village.deserialize(data.plugins.village);
        return { before, after: g.village.you.chats.elda.length, name: g.village.you.names.elda };
      });
      assert.ok(kept.before >= 2 && kept.after === kept.before, JSON.stringify(kept));
      assert.equal(kept.name, 'Wren');
      // The villager dialog's "Say something…" is a shortcut into the same conversation.
      const n0 = await page.evaluate(() => window.__game.village.you.chats.elda.length);
      await page.evaluate(() => window.__game.ui.openDialog(window.__game.entities.get('elda')));
      await page.waitForSelector('.dlg-say-field');
      await page.fill('.dlg-say-field', 'What do you think of me?');
      await page.press('.dlg-say-field', 'Enter');
      await page.waitForFunction((n) => window.__game.village.you.chats.elda.length >= n + 2, n0, { timeout: 15000 });
      await page.evaluate(() => {
        window.__game.ui.closeAll();
        window.__game.ui.chat.open(false); // the dialog shut the chat; open it again
      });
      const inChat = await page.$$eval('.chat-log .msg', (els) => els.map((e) => e.textContent));
      assert.ok(inChat.some((l) => l.includes('What do you think of me?')), 'the dialog line is in her chat history');
      // Out of earshot: the talk ends gracefully and the field closes.
      await page.evaluate(() => {
        const e = window.__game.entities.get('elda');
        e.x += 400;
      });
      await page.waitForFunction(() => /gone on her way/.test(document.querySelector('.chat-log')?.textContent || ''), null, { timeout: 5000 });
      assert.equal(await page.isDisabled('.chat-field'), true);
      // Her answer to what was said before she went, arriving late: she cannot answer now
      // (the author saw Elda reply after "Elda has gone on her way", twice).
      const late = await page.evaluate(() => {
        const c = window.__game.ui.chat;
        c.villagerReplied(window.__game.entities.get('elda'), { ok: true, lines: ['Not like this, love, shouting at me.'] });
        return /Not like this, love/.test(document.querySelector('.chat-log')?.textContent || '');
      });
      assert.equal(late, false, `${view.label}: gone on her way, she cannot answer after`);
      // Catch up with her: a new conversation. And hate, fear and "cut ties" never lock the
      // chat (the author: "even if somebody really hates me, make me able to talk to them").
      const unlocked = await page.evaluate(() => {
        const g = window.__game;
        const c = g.ui.chat;
        const e = g.entities.get('elda');
        const roofAt = (x, y) => g.map.buildingAt(Math.floor(x / 16), Math.floor(y / 16))?.id || null;
        const mine = roofAt(g.player.x, g.player.y);
        const spot = [[-20, 0], [20, 0], [0, -20], [0, 20], [-10, 6]].find(([dx, dy]) => roofAt(g.player.x + dx, g.player.y + dy) === mine) || [0, 0];
        e.x = g.player.x + spot[0];
        e.y = g.player.y + spot[1];
        c.checkTarget();
        const t = g.murder?.now?.() ?? g.clock.t;
        e.terror = { about: 'wys', since: t, until: t + 600 };
        c.selectTarget('lyra');
        c.selectTarget('elda');
        const terrified = { disabled: c.field.disabled, ph: c.field.placeholder, note: /backs away from you/.test(document.querySelector('.chat-log')?.textContent || '') };
        c.setGone(true);
        c.selectTarget('lyra');
        const gone = { disabled: c.field.disabled, ph: c.field.placeholder, chip: document.querySelector('.chat-to-chip[data-id="lyra"]')?.textContent || '' };
        c.setGone(false);
        c.selectTarget('elda');
        return { terrified, gone };
      });
      assert.deepEqual(unlocked.terrified, { disabled: false, ph: 'Say something to Elda…', note: true }, `${view.label}: terrified, she can still be spoken to`);
      assert.equal(unlocked.gone.disabled, false, `${view.label}: Lyra gone: the field stays open`);
      assert.equal(unlocked.gone.ph, 'Say something to Lyra…');
      assert.doesNotMatch(unlocked.gone.chip, /won't talk/);
      await page.fill('.chat-field', 'Elda, please, wait');
      await page.press('.chat-field', 'Enter');
      await page.waitForFunction(() => window.__game.village.you.chats.elda.at(-1)?.from === 'npc' || (window.__game.village.talks.elda || []).some((t) => /please, wait/.test(t.you)), null, { timeout: 15000 });
      const answer = await page.evaluate(() => (window.__game.village.talks.elda || []).filter((t) => /please, wait/.test(t.you)).map((t) => t.they.join(' '))[0] || '');
      assert.match(answer, /Stay away|Don't|Go away|telling|Help|Get away|No/i, `${view.label}: her words reached her, and she answered in terror: ${answer}`);
      // Pressed on, she begs, screams for help, then chooses silence: the words reach her and
      // the chat shows what she does (the author: "they have to get my msg so they get it and
      // decide to not answer").
      for (const t of ['I will not hurt you', 'Just listen to me', 'Elda!']) {
        // She keeps backing off; the player keeps beside her.
        await page.evaluate(() => {
          const g = window.__game;
          const e = g.entities.get('elda');
          const roofAt = (x, y) => g.map.buildingAt(Math.floor(x / 16), Math.floor(y / 16))?.id || null;
          const mine = roofAt(g.player.x, g.player.y);
          const spot = [[-20, 0], [20, 0], [0, -20], [0, 20], [-10, 6]].find(([dx, dy]) => roofAt(g.player.x + dx, g.player.y + dy) === mine) || [0, 0];
          e.x = g.player.x + spot[0];
          e.y = g.player.y + spot[1];
          g.ui.chat.checkTarget();
        });
        const ready = await page
          .waitForFunction(() => !window.__game.ui.chat.waiting.has('elda') && !window.__game.ui.chat.field.disabled, null, { timeout: 15000 })
          .then(() => null)
          .catch(() => page.evaluate(() => ({ waiting: [...window.__game.ui.chat.waiting], away: window.__game.ui.chat.away, disabled: window.__game.ui.chat.field.disabled, target: window.__game.ui.chat.target })));
        assert.equal(ready, null, `${view.label}: the field is open to her: ${JSON.stringify(ready)}`);
        await page.fill('.chat-field', t);
        await page.press('.chat-field', 'Enter');
        const got = await page
          .waitForFunction((t) => (window.__game.village.talks.elda || []).some((x) => x.you === t), t, { timeout: 15000 })
          .then(() => null)
          .catch(() => page.evaluate(() => ({ away: window.__game.ui.chat.away, target: window.__game.ui.chat.target, log: (document.querySelector('.chat-log')?.textContent || '').slice(-300) })));
        assert.equal(got, null, `${view.label}: "${t}" reached her: ${JSON.stringify(got)}`);
      }
      await page.waitForTimeout(200);
      const hush = await page.evaluate(() => ({ last: (window.__game.village.talks.elda || []).at(-1), rows: [...document.querySelectorAll('.chat-log .msg-system')].map((r) => r.textContent.trim()) }));
      assert.equal(hush.last.you, 'Elda!');
      assert.equal(hush.last.silent, true, `${view.label}: her silence, after hearing it`);
      assert.ok(hush.rows.some((r) => /^Elda (hears you|stares at you)/.test(r)), `${view.label}: a silence row is shown: ${hush.rows.slice(-2).join(' | ')}`);
      // Her fright over (for the rest of this test), and her well away again.
      await page.evaluate(() => {
        const g = window.__game;
        const e = g.entities.get('elda');
        e.terror = null;
        e.endFlee?.();
        e.x += 400;
        g.ui.chat.checkTarget();
      });
      // Round 14b (decision D3): a tap or click on someone never opens talk. T (desktop) or
      // the "Talk to Pip" button (phones) talks to whoever is in front of you.
      await page.evaluate(() => window.__game.ui.chat.close());
      await page.waitForFunction(
        () => {
          const c = window.__game.camera;
          const prev = window.__camY;
          window.__camY = c.y;
          return prev != null && Math.abs(c.y - prev) < 0.25;
        },
        null,
        { polling: 120, timeout: 10000 },
      );
      const at = await page.evaluate(() => {
        const g = window.__game;
        const pip = g.entities.get('pip');
        // Out of sword reach, so the click is only a click.
        pip.x = g.player.x - 60;
        pip.y = g.player.y;
        const p = g.renderer.worldToCss(pip.x, pip.y - 10);
        const r = g.canvas.getBoundingClientRect();
        return { x: r.left + p.x, y: r.top + p.y };
      });
      if (!view.touch) await page.mouse.click(at.x, at.y);
      else await page.touchscreen.tap(at.x, at.y);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => window.__game.ui.chat.isOpen()), false, `${view.label}: a click or tap on Pip opens nothing`);
      // Beside Pip, facing him.
      await page.evaluate(() => {
        const g = window.__game;
        const pip = g.entities.get('pip');
        g.player.x = pip.x + 16;
        g.player.y = pip.y;
        g.player.facing = { x: -1, y: 0 };
        g.companion.x = g.player.x + 40;
        g.companion.y = g.player.y + 30;
      });
      await page.waitForTimeout(350);
      if (!view.touch) {
        await page.keyboard.press('t');
        await page.waitForTimeout(250);
      } else {
        await page.waitForFunction(() => /Talk to Pip/.test(document.querySelector('.tbtn-interact')?.getAttribute('aria-label') || ''), null, { timeout: 5000 });
        const b = await page.evaluate(() => {
          const r = document.querySelector('.tbtn-interact').getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        await page.touchscreen.tap(b.x, b.y);
        await page.waitForTimeout(300);
      }
      assert.deepEqual(await page.evaluate(() => [window.__game.ui.chat.isOpen(), window.__game.ui.chat.target]), [true, 'pip'], `${view.label}: Talk beside Pip talks to Pip`);
      assert.equal(await page.getAttribute('.chat-field', 'placeholder'), 'Say something to Pip…');
      assert.deepEqual(errors, [], `${view.label}: page errors`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});

// ------------------------------------------------------------------ round 14b: who T talks to

test('nearestTalkTarget: facing beats distance; the companion counts; another roof does not; asleep counts, downed does not', async () => {
  const { nearestTalkTarget, NEAR } = await import('../src/ui/chat_target.js');
  assert.equal(NEAR, '@near');
  const { game, add } = earWorld();
  game.companion.x = 400; // Lyra well away
  game.player.facing = { x: 1, y: 0 };
  const behind = add('bram', 200 - 16, 200); // closer, but behind
  const front = add('elda', 200 + 24, 200); // a little farther, in front
  assert.equal(nearestTalkTarget(game)?.id, 'elda', 'the one in front, facing first');
  game.player.facing = { x: -1, y: 0 };
  assert.equal(nearestTalkTarget(game)?.id, 'bram', 'turn round: the one now in front');
  // Asleep still counts (they hear it, as far as words reach a sleeper); downed does not.
  behind.state = 'sleep';
  assert.equal(nearestTalkTarget(game)?.id, 'bram');
  behind.downed = true;
  assert.equal(nearestTalkTarget(game)?.id, 'elda', 'downed: not someone to talk to');
  // Another roof: not in reach of words.
  front.x = 22 * 16;
  front.y = 22 * 16;
  assert.equal(nearestTalkTarget(game), null, 'nobody in reach: the caller says it aloud to everyone');
  // The companion (party.holder), whoever it is, counts like anyone.
  const hess = add('hess', 200 + 20, 204);
  game.party = { holder: hess };
  game.player.facing = { x: 1, y: 0 };
  assert.equal(nearestTalkTarget(game)?.id, 'hess');
  // Nobody within 3 tiles: the nearest within earshot, in front.
  hess.x = 200 + 90;
  assert.equal(nearestTalkTarget(game)?.id, 'hess');
  game.player.facing = { x: -1, y: 0 };
  assert.equal(nearestTalkTarget(game), null, 'behind you, farther than arm\'s reach: say it aloud instead');
  game.player.facing = { x: 1, y: 0 };
  hess.x = 200 + 400;
  assert.equal(nearestTalkTarget(game), null);
});
