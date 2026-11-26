import { test } from 'node:test';
import assert from 'node:assert/strict';

// Round 14b, TOP PRIORITY A (DESIGN §33.4; the author: "even if somebody really hates me, make
// me able to talk to them", and "make them able to choose to not respond to me but they have
// to get my msg so they get it and decide to not answer"). No living, awake-or-asleep, near
// person ever gets a locked field; every message is in the listener's memory before any
// silence row appears; only the body (dead, downed, far, walls, a cutscene) keeps words from
// someone.

import { makeGame, clearScene, put, downBy, holdLyra, px } from './murder_world.mjs';
import { whyNotHeard, isDeadPerson, notHeardText } from '../src/ui/chat_target.js';
import { TalkSession, quietReply } from '../src/ui/village_view.js';
import { notesOf } from '../src/ai/social/player_talk.js';
import { coerceSay, SAY_SCHEMA, VILLAGER_RULES, buildSayTask } from '../src/ai/social/village_prompt.js';
import { afraidOptions, mainOptions } from '../src/entities/npc_dialogue.js';
import { detectInvite } from '../src/ai/social/invite.js';

const quiet = () => {
  const w = console.warn;
  console.warn = () => {};
  return () => {
    console.warn = w;
  };
};

function beside(g, e, dx = 18) {
  put(g.player, e.x + dx, e.y);
}

// A fake Claude for the village: records each task, answers with `answer(task)`.
function fakeVillageClaude(v, answer) {
  const tasks = [];
  v.provider = () => ({ id: 'fake' });
  v.askClaude = async (p, rules, task) => {
    tasks.push(task);
    return answer(task);
  };
  return tasks;
}

const SAY = (over = {}) => ({ say: 'Hm. What is it?', silent: null, action: null, act: null, mood: 'neutral', opinion_delta: 0, learned: [], rumor_told: null, rumor: null, name: null, memory: null, asked: null, commit: null, ...over });

// Each feeling a villager can have toward the player, set up in the real headless world.
const STATES = {
  terror(g) {
    const elda = g.entities.get('elda');
    const bram = g.entities.get('bram');
    const sq = g.locations.get('town_square').center;
    put(bram, sq.x, sq.y);
    put(g.player, sq.x - 14, sq.y);
    put(elda, sq.x + 50, sq.y - 10);
    downBy(g, bram);
    g.murder.kill(bram, g.player);
    assert.equal(g.murder.fearOf(elda), 'terror');
    beside(g, elda, 30);
    return { e: elda, feel: /terrified/ };
  },
  dread(g) {
    const elda = g.entities.get('elda');
    elda.dread = true;
    beside(g, elda);
    return { e: elda, feel: /never at ease/ };
  },
  wanted_near(g) {
    const elda = g.entities.get('elda');
    g.player.crime = { kind: 'murder', victim: 'tobias', t: g.clock.t, until: g.clock.t + 9000, known: true, wanted: true };
    elda.knowsWanted = () => true;
    beside(g, elda);
    return { e: elda, feel: null };
  },
  mourning(g) {
    const elda = g.entities.get('elda');
    g.villageLife.mourning.elda = { about: 'tobias', until: g.villageLife.dayN() + 3, kind: 'grief' };
    beside(g, elda);
    return { e: elda, feel: null };
  },
  wronged(g) {
    const bram = g.entities.get('bram');
    bram.wrongedDay = g.clock.day;
    beside(g, bram);
    return { e: bram, feel: null };
  },
  cold(g) {
    const bram = g.entities.get('bram');
    bram.coldDay = g.clock.day;
    bram.opinionOfPlayer = 10;
    beside(g, bram);
    return { e: bram, feel: null };
  },
  opinion_zero(g) {
    const bram = g.entities.get('bram');
    bram.opinionOfPlayer = 0;
    beside(g, bram);
    return { e: bram, feel: /hostile/ };
  },
  asleep(g) {
    const bram = g.entities.get('bram');
    bram.state = 'sleep';
    beside(g, bram);
    return { e: bram, feel: null, asleep: true };
  },
  butcher(g) {
    const bram = g.entities.get('bram');
    g.reputation = { titles: ({ knownTo } = {}) => (knownTo === 'bram' ? ['the Butcher of Hearthvale'] : []) };
    beside(g, bram);
    return { e: bram, feel: /Butcher of Hearthvale/ };
  },
};

for (const [name, setup] of Object.entries(STATES)) {
  test(`talk gate matrix, ${name}: their words are kept, they answer (words or a shown act), never a lock; Claude carries the feeling`, async () => {
    const back = quiet();
    const g = makeGame({ hour: 12 });
    clearScene(g, ['bram', 'elda', 'tobias']);
    const { e, feel, asleep } = setup(g);
    const said = `listen to me, ${name}`;
    // The body does not keep the words from them: no reason not to be heard.
    assert.equal(whyNotHeard(g, e), null, `${name}: they can hear (${whyNotHeard(g, e)})`);
    const r = await g.village.playerSays(e, said);
    assert.ok(r.lines.length || r.narration, `${name}: an answer or a shown act`);
    if (!r.lines.length) assert.doesNotMatch(r.narration, /catch that|can't hear|won't talk/);
    assert.ok(g.village.talks[e.id].some((t) => t.you === said && !t.pending), `${name}: the words are kept in their talk`);
    // Online: Claude is asked (asleep aside: they mumble), and the brief carries how they feel.
    const tasks = fakeVillageClaude(g.village, () => SAY({ say: 'Go on, then.', mood: 'wary' }));
    const r2 = await g.village.playerSays(e, `${said}, again`);
    assert.ok(r2.lines.length || r2.narration, `${name}: online, an answer`);
    if (asleep) assert.equal(tasks.length, 0, 'a sleeper is not asked; the words still reach them');
    else {
      assert.equal(tasks.length, 1, `${name}: Claude is asked`);
      assert.match(tasks[0], new RegExp(`${said}, again`), 'their own words are in the brief');
      if (feel) assert.match(tasks[0], feel, `${name}: the feeling is in the brief`);
    }
    back();
  });
}

test('a sleeper gets the words too: kept, and noted "while I slept"', async () => {
  const g = makeGame({ hour: 12 });
  clearScene(g, ['bram']);
  const bram = g.entities.get('bram');
  bram.state = 'sleep';
  beside(g, bram);
  const r = await g.village.playerSays(bram, 'Bram, wake up, it is me');
  assert.ok(r.lines.length);
  assert.ok(g.village.talks.bram.some((t) => t.asleep && /wake up/.test(t.you)));
  assert.ok(notesOf(g.village, 'bram').some((n) => /while I slept/.test(n.text)));
});

test('only the body keeps words from someone: dead, downed, far, walls and a cutscene; never a feeling', () => {
  const g = makeGame({ hour: 12 });
  clearScene(g, ['bram']);
  const bram = g.entities.get('bram');
  beside(g, bram);
  const feelings = [
    () => (bram.opinionOfPlayer = 0),
    () => (bram.wrongedDay = g.clock.day),
    () => (bram.terror = { about: 'x', since: 0, until: 1e12 }),
    () => (bram.dread = true),
    () => (bram.state = 'sleep'),
    () => (bram.mode = 'flee'),
  ];
  for (const f of feelings) {
    f();
    assert.equal(whyNotHeard(g, bram), null);
  }
  bram.state = 'idle';
  bram.mode = 'routine';
  g.state = 'cutscene';
  assert.equal(whyNotHeard(g, bram), 'cutscene');
  g.state = 'playing';
  bram.downed = true;
  assert.equal(whyNotHeard(g, bram), 'downed');
  assert.match(notHeardText(g, bram, 'downed'), /is down/);
  bram.downed = false;
  put(g.player, bram.x + 400, bram.y);
  assert.equal(whyNotHeard(g, bram), 'far');
  beside(g, bram);
  g.murder.isDead = (id) => id === 'bram';
  assert.equal(whyNotHeard(g, bram), 'dead');
  assert.equal(isDeadPerson(g, bram), true);
  assert.equal(notHeardText(g, bram, 'dead'), 'Bram is dead.');
  for (const why of ['dead', 'downed', 'far', 'walls', 'cutscene']) assert.doesNotMatch(notHeardText(g, bram, why), /won't|can't talk|refuses/);
});

test('a wall between them: the hearing rule leaves only a voice ("walls"), not the words', () => {
  const g = makeGame({ hour: 12 });
  clearScene(g, ['elda']);
  const elda = g.entities.get('elda');
  const b = g.locations.get('ember_kettle').bounds;
  // Elda inside the Kettle, the player outside its west wall, close enough to touch.
  put(elda, (b.x + 1.5) * 16, (b.y + b.h / 2) * 16);
  put(g.player, (b.x - 1) * 16, (b.y + b.h / 2) * 16);
  assert.equal(whyNotHeard(g, elda), 'walls');
});

test('silence after hearing (Claude): {say: "", action: "turn_away"} is a shown act; the words reached Bram first', async () => {
  const g = makeGame({ hour: 11 });
  clearScene(g, ['bram']);
  const bram = g.entities.get('bram');
  bram.opinionOfPlayer = 10;
  beside(g, bram);
  const v = g.village;
  let heardBefore = null;
  v.provider = () => ({ id: 'fake' });
  v.askClaude = async () => {
    // Asked only once the words are already theirs.
    heardBefore = v.talks.bram?.some((t) => t.you === 'Bram, a word' && t.pending);
    return SAY({ say: '', action: 'turn_away', mood: 'cold', opinion_delta: -1 });
  };
  const r = await v.playerSays(bram, 'Bram, a word');
  assert.equal(heardBefore, true, 'the message was in his talk before he decided');
  assert.deepEqual(r.lines, []);
  assert.equal(r.silent, true);
  assert.equal(r.action, 'turn_away');
  assert.match(r.narration, /^Bram /);
  assert.ok(v.talks.bram.some((t) => t.you === 'Bram, a word' && t.silent && !t.pending));
  assert.ok(notesOf(v, 'bram').some((n) => /Bram, a word/.test(n.text)), 'and he remembers being spoken to');
  // Through the TalkSession the chat and the dialog use: an answer, shown as an act.
  const talk = new TalkSession({ village: v, npc: bram });
  const t = await talk.send('Bram?');
  assert.equal(t.ok, true);
  assert.equal(t.silent, true);
  assert.match(t.lines[0], /^Bram /);
  assert.doesNotMatch(t.lines[0], /catch that/);
  // An empty say with NO action is no answer: his own words instead.
  v.askClaude = async () => SAY({ say: '', mood: 'cold' });
  bram.opinionOfPlayer = 60;
  const f = await v.playerSays(bram, 'good morning');
  assert.notEqual(f.silent, true);
  assert.ok(f.lines.length && f.lines[0].length > 1, `his own words: ${f.lines[0]}`);
});

test('the reply carries action and act (SAY_SCHEMA); an action with words is shown after them', async () => {
  assert.ok(SAY_SCHEMA.properties.action && SAY_SCHEMA.properties.act);
  assert.ok(SAY_SCHEMA.required.includes('action') && SAY_SCHEMA.required.includes('act'));
  assert.match(VILLAGER_RULES, /Refusing is still an answer/);
  assert.equal(coerceSay({ say: '', action: 'walk_off' }).silent, true);
  assert.equal(coerceSay({ say: '' }), null);
  assert.equal(coerceSay({ say: 'Fine.', action: 'nonsense' }).action, null);
  const g = makeGame({ hour: 11 });
  clearScene(g, ['bram']);
  const bram = g.entities.get('bram');
  beside(g, bram);
  fakeVillageClaude(g.village, () => SAY({ say: 'Get out of my forge.', action: 'glare', mood: 'angry' }));
  const r = await g.village.playerSays(bram, 'Nice forge');
  assert.deepEqual(r.lines, ['Get out of my forge.']);
  assert.equal(r.action, 'glare');
  assert.match(r.narration, /^Bram (glares|gives you)/);
});

test('terror goes through her own mind: Claude asked, never warm; offline the fear banks; no errand for a killer; she keeps running', async () => {
  const back = quiet();
  const g = makeGame({ hour: 12 });
  clearScene(g, ['bram', 'elda']);
  const { e: elda } = STATES.terror(g);
  // Running for the watch already: talking to her does not turn her round.
  elda.mode = 'flee';
  elda.fleeHome = 'to';
  const tasks = fakeVillageClaude(g.village, () => SAY({ say: 'Of course, love, sit down and I will tell Lyra.', mood: 'warm', opinion_delta: 3, commit: { kind: 'tell', agree: true } }));
  const r = await g.village.playerSays(elda, "I'm sorry, please listen. Will you tell Lyra for me?");
  assert.equal(tasks.length, 1);
  assert.match(tasks[0], /terrified/);
  assert.doesNotMatch(r.lines.join(' '), /love|sit down/, `never warm: ${r.lines.join(' ')}`);
  assert.ok(!g.village.commitments.open('elda').length, 'no errand run for a killer');
  assert.equal(elda.fleeHome, 'to', 'still running to the watch');
  back();
});

test('the afraid dialog is never a lock: Say something, (Give yourself up), Back away; "Say something" opens the field', () => {
  const g = makeGame({ hour: 12 });
  clearScene(g, ['elda', 'rowan']);
  const elda = g.entities.get('elda');
  const opts = afraidOptions(elda, g.player).map((o) => o.id);
  assert.deepEqual(opts, ['talk', 'bye']);
  assert.notDeepEqual(mainOptions(elda, g.player, 'afraid').map((o) => o.id), ['bye']);
  g.murder.isWanted = () => true;
  assert.ok(afraidOptions(g.entities.get('rowan'), g.player).some((o) => o.id === 'murder:surrender'), 'to the watch, the player may give themselves up');
  assert.ok(!afraidOptions(elda, g.player).some((o) => o.id === 'murder:surrender'));
  g.murder.isHunted = () => true;
  assert.ok(afraidOptions(elda, g.player).some((o) => o.id === 'murder:surrender'), 'hunted: anywhere');
});

test('an invite is decided before it is worded: Claude cannot take anyone into the party the game turned down', async () => {
  assert.ok(detectInvite('Elda, come with me to the ruins'));
  assert.ok(detectInvite('will you travel with me?'));
  assert.equal(detectInvite("don't follow me"), null);
  assert.equal(detectInvite('the weather is fine'), null);
  const g = makeGame({ hour: 11 });
  clearScene(g, ['bram', 'pip']);
  const bram = g.entities.get('bram');
  beside(g, bram);
  const taken = [];
  g.party.weighJoin = () => ({ decision: 'refuse', line: 'No. The forge needs me.', why: 'the forge needs you' });
  g.party.take = (e) => taken.push(e.id);
  const tasks = fakeVillageClaude(g.village, () => SAY({ say: 'Aye, I will come!', act: 'join' }));
  await g.village.playerSays(bram, 'Bram, come with me');
  assert.match(tasks[0], /You have decided: you will not, because the forge needs you/);
  assert.deepEqual(taken, [], 'Claude said yes; the game said no; nobody joined');
  // A "join" from Claude with no invite at all is weighed again.
  await g.village.playerSays(bram, 'lovely day');
  assert.deepEqual(taken, []);
  // The game says yes: taken.
  g.party.weighJoin = () => ({ decision: 'accept', line: 'Aye. Let me get my hammer.', why: 'you like them' });
  const r = await g.village.playerSays(bram, 'come with me, Bram');
  assert.deepEqual(taken, ['bram']);
  assert.ok(r.lines.length);
  // A child never: the game refuses before anyone is asked, whatever party says.
  const pip = g.entities.get('pip');
  beside(g, pip);
  const before = taken.length;
  const rp = await g.village.playerSays(pip, 'Pip, come with me on an adventure');
  assert.equal(taken.length, before, 'a child is never taken along');
  assert.ok(rp.lines.length);
});

test('Lyra cut off: within 16 tiles she hears every word (her record keeps it), answers or shows her silence; beyond, too far', async () => {
  const back = quiet();
  const g = makeGame({ hour: 10 });
  const L = g.companion;
  const P = g.player;
  put(L, P.x + 10 * 16, P.y);
  L.mind.autonomy.setCompanionship('gone', 'You hurt me.', { cause: 'downed', goneReason: 'downed', silent: true });
  assert.equal(g.flags.lyra_farewell?.text?.length > 0, true, 'her farewell has its own flag');
  for (const t of ['Lyra, please', 'I am sorry', 'say something']) {
    const before = g.ui.chat.messages.length;
    const r = await g.brain.handlePlayerMessage(t);
    assert.ok(!r.unreachable, 'within 16 tiles she hears');
    assert.ok(L.mind.conversation.some((c) => c.role === 'player' && c.text === t), `her record has "${t}"`);
    const rows = g.ui.chat.messages.slice(before).filter((m) => m.from !== 'player');
    assert.ok(rows.length >= 1, 'a reply or a shown silence');
    for (const m of rows) assert.doesNotMatch(m.text, /catch that|won't talk/);
  }
  put(L, P.x + 20 * 16, P.y);
  const far = await g.brain.handlePlayerMessage('can you hear me?');
  assert.equal(far.unreachable, 'far');
  assert.ok(!L.mind.conversation.some((c) => c.text === 'can you hear me?'), 'out of earshot, nothing reaches her');
  back();
});

test('Lyra cut off: words land (consent lets talk through); requests get her no; the way back is an apology she believes, time and a good deed', async () => {
  const back = quiet();
  const g = makeGame({ hour: 10 });
  const L = g.companion;
  const a = L.mind.autonomy;
  put(L, g.player.x + 24, g.player.y);
  a.lastViolentT = g.clock.t;
  a.setCompanionship('gone', 'You hurt me.', { cause: 'downed', goneReason: 'downed', silent: true });
  // Words between them are never a request: they land.
  const v = L.mind.evaluateRequest({ action: 'promise', args: { target: 'player', value: 'I will be better' }, source: 'player' });
  assert.notEqual(v?.decision, 'refuse', 'a promise is words, and words land');
  const follow = L.mind.evaluateRequest({ action: 'follow', args: { target: 'player' }, source: 'player' });
  assert.equal(follow.decision, 'refuse', 'she follows nowhere');
  // Too soon: an apology is heard, not believed.
  a.receiveApology("I'm so sorry I knocked you out at the lake, I was wrong and I will never hurt you again");
  assert.equal(a.companionship, 'gone');
  // Two days on, a believed apology, and a good deed she sees: gone becomes left.
  g.clock.t += 2.2 * 900;
  g.time += 2.2 * 900;
  a.adjustPlayer?.({ trust: 30, fear: -30 }, 'test');
  a.receiveApology("I'm so sorry I knocked you out at the lake, I was wrong and I will never hurt you again");
  assert.equal(a.apology.believed, true, 'believed, at last');
  assert.equal(a.companionship, 'gone', 'words alone are not enough');
  a.recordDeed('gift_loved');
  assert.equal(a.companionship, 'left', 'an apology, time and a deed: she will hear them out');
  assert.equal(g.flags.lyra_gone, undefined, 'no longer gone');
  assert.ok(g.flags.lyra_farewell, 'her farewell is kept');
  // She never walks back on her own from there: left still takes no requests.
  assert.equal(L.mind.evaluateRequest({ action: 'follow', args: { target: 'player' }, source: 'player' }).decision, 'refuse');
  back();
});

test('an old save with flags.lyra_gone: her farewell gets its own flag, and her mind is gone', () => {
  const g = makeGame({ hour: 10 });
  const a = g.companion.mind.autonomy;
  const d = JSON.parse(JSON.stringify(a.serialize()));
  g.flags.lyra_gone = { day: 3, reason: 'You hurt me.', farewell: 'I am going home.' };
  delete g.flags.lyra_farewell;
  a.deserialize(d);
  assert.equal(a.companionship, 'gone');
  assert.equal(g.flags.lyra_farewell.text, 'I am going home.');
});

test('a dead Lyra: "Lyra is dead.", no diary', async () => {
  const back = quiet();
  const g = makeGame({ hour: 10 });
  g.murder.isDead = (id) => id === 'lyra';
  const r = await g.brain.handlePlayerMessage('Lyra?');
  assert.equal(r.unreachable, 'dead');
  assert.equal(g.ui.chat.messages.at(-1).text, 'Lyra is dead.');
  assert.equal(await g.brain.reflect('sleep'), null);
  back();
});

test('nothing the player reads says someone will not talk, is beyond a word, or did not catch it (static guard)', async () => {
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
  // Spoken refusals in a person's own voice are allowed (they are an answer, not a lock).
  const ALLOW = [
    /npc_lines\.js: "I can't\.\.\. I can't talk to you\."/, // Mira, wronged: her own words
    /lore\/story\.js: .*will not talk about the war/, // Aveline's history
    /entities\/npc_lines\.js: .*I can't talk to you/, // Mira, wronged, in her own voice
    /entities\/npc_data_more\.js: .*didn't catch him/, // "Born somewhere else, so I didn't catch him": a midwife's line
  ];
  const hits = [];
  for (const f of files) {
    const rel = f.slice(root.length);
    for (const raw of readFileSync(f, 'utf8').split('\n')) {
      const line = raw.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/ .*$/, '');
      for (const m of line.matchAll(/(won['’]t (?:talk|speak) to you|will not talk|beyond a word|refusesTalk|'refuses'|can['’]t talk|catch that|didn['’]t catch)/gi)) {
        const hit = `${rel}: ${line.trim().slice(0, 160)}`;
        if (!ALLOW.some((re) => re.test(hit))) hits.push(`${rel}: ${m[0]}`);
      }
    }
  }
  assert.deepEqual(hits, [], 'no lock wording left');
  assert.doesNotMatch(quietReply({ name: 'Bram' }, 'error')[0], /catch/);
});

test('buildSayTask carries the feature-detected lines of the other workstreams (date, the Hollow, titles) and "uneasy"', () => {
  const g = makeGame({ hour: 12 });
  clearScene(g, ['bram']);
  const bram = g.entities.get('bram');
  g.calendar = { ...(g.calendar || {}), briefLine: (id) => (id === 'bram' ? 'You are 44; it is early autumn, year 1.' : '') };
  g.unkindle = { briefLine: () => 'People are dying in their beds with no mark on them.' };
  bram.uneasy = { day: g.clock.day, place: 'ember_kettle' };
  const task = buildSayTask(g.village.sayBrief(bram, 'hello', { lines: ['Hm.'] }));
  assert.match(task, /You are 44/);
  assert.match(task, /no mark on them/);
  assert.match(task, /heard a scream from the Ember Kettle/i);
  assert.doesNotMatch(task, /You do not know who\.[^]*\bplayer\b did it/);
});

test('the gone state reaches Lyra\'s prompt: she hears, may give an empty say, and the way back is hers', async () => {
  const { buildRules, buildContext } = await import('../src/ai/brain/prompt.js');
  const g = makeGame({ hour: 10 });
  g.companion.mind.autonomy.setCompanionship('gone', 'You hurt me.', { cause: 'downed', goneReason: 'downed', silent: true });
  assert.match(buildRules(g), /say: spoken aloud, may be ""/);
  assert.match(buildContext(g, { message: 'hello' }), /two days and more since the last blow/);
  assert.match(buildContext(g, { message: 'hello' }), /an empty say, with keep_distance/);
});

test('mourning keeps the talk open: "we buried … What is it?"', async () => {
  const { ANY } = await import('../src/murder/lines.js');
  for (const l of ANY.mournGreet) assert.doesNotMatch(l, /can't talk|not today/i);
  assert.ok(ANY.mournGreet.some((l) => /What is it\?/.test(l)));
  void holdLyra;
  void px;
});
