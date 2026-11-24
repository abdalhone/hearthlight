import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EventBus } from '../src/core/events.js';
import { ActionRegistry } from '../src/ai/brain/actions.js';
import { PluginRegistry } from '../src/ai/plugins/registry.js';
import { EntityManager } from '../src/entities/manager.js';
import { Inventory } from '../src/entities/items.js';
import { LocationIndex } from '../src/world/locations.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';

import { parseMessage, splitClauses, normalize, extractQuantityItem, detectOffer, cleanRef, COMMAND_THRESHOLD } from '../src/ai/brain/nlu.js';
import { SpeechGen } from '../src/ai/brain/speech_gen.js';
import { LINES, BARK_SITUATIONS } from '../src/ai/brain/lines.js';
import { coerceResponse, coerceReflection, coerceConversation, coerceKnowledge, coerceIds, dedupeActions, extractJson, looksLikeSpeech } from '../src/ai/brain/claude_brain.js';
import { buildRules, buildChatPrompt, buildContext, PROMPT_BUDGET, RESPONSE_SCHEMA } from '../src/ai/brain/prompt.js';
import { refusalSituation, firstPersonReason, reasonsAgainst, toFirstPerson } from '../src/ai/brain/local_brain.js';
import { chooseProvider, ProviderSet, ApiKeyProvider, BrainError, classifyApiError, scrub } from '../src/ai/brain/providers.js';
import { Brain } from '../src/ai/brain/brain.js';
import { composeDiary } from '../src/ai/brain/diary.js';

// ------------------------------------------------------------------ fakes

const ACTION_NAMES = [
  'follow', 'stay', 'wait', 'come_here', 'goto', 'set_combat_mode', 'attack', 'retreat', 'guard', 'patrol', 'explore',
  'free_will', 'emote', 'sit', 'open_door', 'close_door', 'pick_up', 'give_item', 'use_item', 'interact', 'sleep',
  'start_job', 'stop_job', 'talk_to', 'set_relationship', 'note_about', 'remember', 'forget', 'set_goal', 'complete_goal',
  'express', 'read_journal',
  // round 2 (DESIGN §16.9)
  'leave_player', 'rejoin', 'set_plan', 'request', 'promise', 'flee', 'keep_distance', 'bind', 'warn', 'wait_outside',
];

function fakeMind() {
  const calls = { feel: [], remember: [], adjust: [], notes: [], tags: [], opinions: [], goals: [], thoughts: [], consolidate: 0 };
  const rels = new Map([
    ['player', { id: 'player', name: 'Traveler', kind: 'human', affinity: 12, trust: 35, respect: 20, familiarity: 30, tags: [], notes: [], opinion: null }],
    ['bram', { id: 'bram', name: 'Bram Ironhand', kind: 'human', affinity: 25, trust: 40, respect: 30, familiarity: 20, tags: [], notes: [{ text: 'Writes poetry in secret', source: 'observed' }], opinion: null }],
  ]);
  const memories = [
    { id: 'm1', text: 'The traveler stood beside me when the wolves attacked on the King\'s Road.', importance: 9, day: 1, t: 10, emotion: 'trust', about: ['player'] },
    { id: 'm2', text: 'Bram gave me a fair price for the wolf pelts.', importance: 5, day: 1, t: 20, emotion: 'joy', about: ['bram'] },
    { id: 'm3', text: 'We found slime gel by the quarry.', importance: 3, day: 1, t: 30, about: [] },
  ];
  return {
    calls,
    memories,
    emotions: { joy: 0.3, anger: 0, fear: 0 },
    needs: { hunger: 0.8, energy: 0.2, social: 0.6, fun: 0.6, safety: 0.9 },
    goals: [{ id: 'g1', text: 'Find Maren', priority: 1, source: 'soul', done: false }],
    thoughts: [{ text: 'The wind smells like rain.', t: 5, source: 'self' }],
    diary: [],
    conversation: [],
    knowledge: [],
    memory: { consolidate: () => calls.consolidate++ },
    feel: (n, a, c) => calls.feel.push([n, a, c]),
    remember: (t, o) => {
      calls.remember.push([t, o]);
      return { text: t };
    },
    recall: (q, o = {}) => memories.slice(0, o.limit || 6),
    addGoal: (t, p, s) => calls.goals.push([t, p, s]),
    addThought: (t, s) => calls.thoughts.push([t, s]),
    mood: () => ({ label: 'content', valence: 0.2, arousal: 0.3, emoji: '🙂' }),
    describeState: () => 'Content, a little tired. Following the player through the village.',
    relationships: {
      get: (id) => rels.get(String(id).toLowerCase()) || null,
      ensure: (e, o = {}) => {
        const id = typeof e === 'string' ? e : e.id;
        if (!rels.has(id)) rels.set(id, { id, name: o.name || id, affinity: 0, trust: 0, tags: [], notes: [] });
        return rels.get(id);
      },
      all: () => [...rels.values()],
      adjust: (id, d, r) => {
        calls.adjust.push([id, d, r]);
        const rel = rels.get(id);
        if (rel) for (const [k, v] of Object.entries(d)) rel[k] = (rel[k] || 0) + v;
      },
      addNote: (id, t, s) => calls.notes.push([id, t, s]),
      setTag: (id, t, on) => calls.tags.push([id, t, on]),
      setOpinion: (id, t) => calls.opinions.push([id, t]),
      isFriend: (e) => e?.faction !== 'monster' && e?.faction !== 'bandit',
      isEnemy: () => false,
      bond: () => ({ level: 1, label: 'Acquaintance', score: 20 }),
    },
  };
}

function actor(o) {
  return { type: 'actor', faction: 'villager', hp: 30, maxHp: 30, level: 1, removed: false, dead: false, kind: 'human', isAlive() { return !this.dead; }, ...o };
}

const LOCATIONS = [
  { id: 'hearthvale', name: 'Hearthvale', kind: 'village', bounds: { x: 60, y: 40, w: 40, h: 40 }, description: 'A small valley village of lamplit cottages.', aliases: ['village', 'town'] },
  { id: 'ember_kettle', name: 'The Ember Kettle', kind: 'building', bounds: { x: 70, y: 50, w: 6, h: 5 }, indoor: true, aliases: ['inn', 'tavern', 'kettle'], parent: 'hearthvale', description: 'Warm, loud, smells of stew.' },
  { id: 'smithy', name: 'Ironhand Smithy', kind: 'building', bounds: { x: 80, y: 50, w: 6, h: 5 }, indoor: true, parent: 'hearthvale', description: 'Hot iron and a grumpy smith.' },
  { id: 'mirror_lake', name: 'Mirror Lake', kind: 'lake', bounds: { x: 120, y: 50, w: 20, h: 20 }, aliases: ['lake'], description: 'Still water that mirrors the sky. Deep in the middle.', danger: 1 },
  { id: 'whisperwood', name: 'Whisperwood', kind: 'forest', bounds: { x: 50, y: 0, w: 60, h: 30 }, aliases: ['forest', 'woods'], description: 'Old trees crowd the north road. Wolves hunt here after dark.', danger: 2 },
  { id: 'player_home', name: 'Your Cottage', kind: 'home', bounds: { x: 64, y: 60, w: 5, h: 4 }, indoor: true, aliases: ['home', 'cottage'], parent: 'hearthvale' },
];

function makeActions(game, log) {
  for (const name of ACTION_NAMES) {
    game.actions.register(name, {
      description: `does ${name}`,
      params: { target: 'who/where', value: 'what', amount: 'how much' },
      run(args) {
        log.push({ name, args });
        if (name === 'attack' && args.target === 'bram') return { ok: false, message: "Bram is a friend. I won't hurt him." };
        return { ok: true, message: '' };
      },
    });
  }
}

function makeGame({ settings = {}, runtime = null, apiKey = '', plugins = [], withActions = true } = {}) {
  const bus = new EventBus();
  const chat = { messages: [], thinking: [], addMessage(m) { this.messages.push(m); }, setThinking(on) { this.thinking.push(on); }, isOpen: () => true };
  const game = {
    bus,
    time: 1000,
    state: 'playing',
    paused: false,
    flags: {},
    apiKey,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    runtime: runtime || { hostPresent: false, sample: null, tts: null, onChange() {}, disable() {} },
    clock: { t: 500, day: 2, hour: 14, phase: 'day', isNight: false, weather: { type: 'clear' }, timeString: () => '2:00 PM', fullString: () => 'Day 2, 2:00 PM' },
    ui: { chat, diary: null, showDiary(e) { this.diary = e; }, toast() {} },
    bubbles: { said: [], icons: [], say(e, t, o) { this.said.push(t); }, icon(e, n) { this.icons.push(n); }, clear() {}, thought() {} },
    setSetting(k, v) {
      this.settings[k] = v;
      bus.emit('settings_changed', { key: k, value: v });
    },
  };
  game.entities = new EntityManager(game);
  game.actions = new ActionRegistry(game);
  game.plugins = new PluginRegistry(game);
  game.locations = new LocationIndex(LOCATIONS);
  const log = [];
  game.log = log;
  if (withActions) makeActions(game, log);
  for (const p of plugins) game.plugins.register(p);
  const mind = fakeMind();
  game.player = game.entities.add(actor({ id: 'player', name: 'Traveler', faction: 'player', x: 72 * 16, y: 48 * 16, hp: 40, maxHp: 40, inventory: new Inventory({ coin: 15 }) }));
  game.companion = game.entities.add(
    actor({
      id: 'lyra', name: 'Lyra', faction: 'player', x: 73 * 16, y: 48 * 16, hp: 50, maxHp: 50, inventory: new Inventory({ potion: 1, wood: 2, coin: 7 }), mind,
      behavior: { directive: { type: 'follow' }, stance: 'defend', status: () => 'following you', currentTarget: null },
      faceToward() {},
    }),
  );
  game.entities.add(actor({ id: 'bram', name: 'Bram Ironhand', x: 74 * 16, y: 49 * 16, profile: { id: 'bram', role: 'blacksmith', personality: 'Gruff and kind.', voice: 'Short sentences.', facts: [{ id: 'f1', text: 'Bram writes poetry at night.', minFamiliarity: 10, topic: 'secret' }, { id: 'f2', text: 'Bram lost his wife to fever.', minFamiliarity: 60 }] } }));
  game.entities.add(actor({ id: 'w1', name: 'Grey Wolf', species: 'wolf', faction: 'monster', kind: 'animal', x: 76 * 16, y: 48 * 16 }));
  game.plugins.installAll();
  return game;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// ------------------------------------------------------------------ NLU

function envFor(game, extra = {}) {
  return { intents: game.plugins.intents(), ctx: game.plugins.ctx, has: (n) => game.actions.has(n), inventory: game.companion.inventory, directiveType: 'follow', knownNames: ['bram', 'elda', 'pip', 'mira', 'rowan', 'tobias', 'aveline'], names: ['lyra'], ...extra };
}

// [phrase, expected intent id(s) in order, optional check on actions]
const PHRASES = [
  ['follow me', ['cmd.follow'], (a) => a[0].name === 'follow' && a[0].args.target === 'player'],
  ['Follow me closely', ['cmd.follow_close'], (a) => a[0].args.value === 'close'],
  ['stay close', ['cmd.follow_close'], (a) => a[0].args.value === 'close'],
  ['stay here', ['cmd.stay'], (a) => a[0].name === 'stay'],
  ['wait here', ['cmd.stay'], (a) => a[0].name === 'stay'],
  ['wait', ['cmd.wait'], (a) => a[0].name === 'wait' && a[0].args.amount === 30],
  ['wait 10 seconds', ['cmd.wait'], (a) => a[0].args.amount === 10],
  ['hold position', ['cmd.stay']],
  ['come here', ['cmd.come'], (a) => a[0].name === 'come_here'],
  ['come with me', ['cmd.follow']],
  ['attack mode', ['cmd.mode_attack'], (a) => a[0].args.value === 'attack'],
  ["kill anything that isn't a friend", ['cmd.mode_attack']],
  ['be aggressive', ['cmd.mode_attack']],
  ['watch my back', ['cmd.mode_defend'], (a) => a[0].args.value === 'defend'],
  ['go passive', ['cmd.mode_passive'], (a) => a[0].args.value === 'passive'],
  ['hold your fire!', ['cmd.mode_passive']],
  ['stop fighting', ['cmd.mode_passive']],
  ['attack that wolf', ['cmd.attack'], (a) => a[0].args.target === 'wolf'],
  ['shoot the bandit', ['cmd.attack'], (a) => a[0].args.target === 'bandit'],
  ['retreat!', ['cmd.retreat']],
  ['fall back', ['cmd.retreat']],
  ['guard Pip', ['cmd.guard'], (a) => a[0].args.target === 'pip'],
  ['patrol the village', ['cmd.patrol'], (a) => a[0].args.target === 'village'],
  ['explore whisperwood', ['cmd.explore'], (a) => a[0].args.target === 'whisperwood'],
  ['do whatever you want', ['cmd.free']],
  ['dance for me', ['cmd.emote'], (a) => a[0].args.value === 'dance'],
  ['give me a hug', ['cmd.emote'], (a) => a[0].args.value === 'hug'],
  ['sit down', ['cmd.sit']],
  ['open the door', ['cmd.door'], (a) => a[0].name === 'open_door'],
  ['chop some wood', ['cmd.job'], (a) => a[0].name === 'start_job' && a[0].args.value === 'chop_wood'],
  ['chop 5 wood and bring it to me', ['cmd.job'], (a) => a[0].args.amount === 5 && a[0].args.target === 'player'],
  ['gather herbs and put them in the chest', ['cmd.job'], (a) => a[0].args.value === 'gather_herbs' && a[0].args.target === 'chest'],
  ['go fishing', ['cmd.job'], (a) => a[0].args.value === 'fish'],
  ['mine some iron ore', ['cmd.job'], (a) => a[0].args.value === 'mine_ore'],
  ['forage for berries', ['cmd.job'], (a) => a[0].args.value === 'forage'],
  ['cook dinner', ['cmd.job'], (a) => a[0].args.value === 'cook'],
  ['help Tobias with the crops', ['cmd.job'], (a) => a[0].args.value === 'farm'],
  ['collect the loot', ['cmd.job'], (a) => a[0].args.value === 'collect_loot'],
  ['stop chopping', ['cmd.stop'], (a) => a[0].name === 'stop_job'],
  ['go to the inn', ['cmd.goto'], (a) => a[0].name === 'goto' && a[0].args.target === 'inn'],
  ['head to the smithy and wait for me', ['cmd.goto'], (a) => a[0].args.target === 'smithy' && a[0].args.value === 'stay'],
  ['go home', ['cmd.home'], (a) => a[0].args.target === 'player_home'],
  ['go to bed', ['cmd.sleep']],
  ['give me a potion', ['cmd.give'], (a) => a[0].name === 'give_item' && a[0].args.value === 'potion' && a[0].args.target === 'player'],
  ['give Bram 3 iron ore', ['cmd.give'], (a) => a[0].args.target === 'bram' && a[0].args.value === 'iron_ore' && a[0].args.amount === 3],
  ['bring me some wood', ['cmd.job'], (a) => a[0].name === 'give_item' && a[0].args.value === 'wood'],
  ['drink a potion', ['cmd.use'], (a) => a[0].name === 'use_item' && a[0].args.value === 'potion'],
  ['talk to Elda about Pip', ['cmd.talk'], (a) => a[0].args.target === 'elda' && a[0].args.value === 'pip'],
  ['Bram is a friend', ['cmd.relationship'], (a) => a[0].args.target === 'bram' && a[0].args.value === 'friend'],
  ["don't attack Bram", ['cmd.spare'], (a) => a[0].name === 'set_relationship' && a[0].args.target === 'bram'],
  ['remember that Mira likes Rowan', ['cmd.remember'], (a) => a[0].args.target === 'mira' && /mira likes rowan/i.test(a[0].args.value)],
  ['forget about the bandits', ['cmd.forget']],
  ['set a goal to learn the lute', ['cmd.goal'], (a) => a[0].args.value === 'learn the lute'],
  ['read the journal', ['cmd.read_journal']],
  ["follow me and kill anything that isn't a friend", ['cmd.follow', 'cmd.mode_attack']],
  ['Lyra, could you please stay here?', ['cmd.stay']],
  ['go to the lake and fish', ['cmd.goto', 'cmd.job']],
  ['follow me, attack mode, then chop wood', ['cmd.follow', 'cmd.mode_attack', 'cmd.job']],
  ['can you cook something?', ['cmd.job']],
  // questions
  ['how are you feeling?', ['ask.feelings']],
  ['are you hungry?', ['ask.feelings'], null, (c) => c.intent.slots.state === 'hungry'],
  ["what's up?", ['ask.feelings']],
  ['what do you think of Bram?', ['ask.opinion'], null, (c) => c.intent.slots.who === 'bram'],
  ['do you like me?', ['ask.opinion'], null, (c) => c.intent.slots.who === 'player'],
  ['do you remember the wolves?', ['ask.memory'], null, (c) => c.intent.slots.topic === 'wolves'],
  ['what happened today?', ['ask.today']],
  ['who is Aveline?', ['ask.who']],
  ['where is the smithy?', ['ask.where_is'], null, (c) => c.intent.slots.topic === 'smithy'],
  ['what are you doing?', ['ask.status']],
  ['what do you have?', ['ask.inventory']],
  ['do you have any potions?', ['ask.inventory'], null, (c) => c.intent.slots.item === 'potion'],
  ['how much gold do you have?', ['ask.inventory'], null, (c) => c.intent.slots.item === 'coin'],
  ['what time is it?', ['ask.time']],
  ['where are we?', ['ask.where']],
  ['where are you from?', ['ask.past'], null, (c) => c.intent.slots.topic === 'origin'],
  ['tell me about your brother', ['ask.past'], null, (c) => c.intent.slots.topic === 'family'],
  ['who is Maren?', ['ask.past'], null, (c) => c.intent.slots.topic === 'maren'],
  ['what is your favorite food?', ['ask.past'], null, (c) => c.intent.slots.fav === 'food'],
  ['what are you afraid of?', ['ask.past'], null, (c) => c.intent.slots.topic === 'fears'],
  ['what should we do next?', ['ask.quest']],
  ['what can you do?', ['ask.can_do']],
  ['are you an AI?', ['ask.ai']],
  ['what is a moonpetal?', ['ask.what_is']],
  // social
  ['hi', ['social.greet']],
  ['hey Lyra', ['social.greet']],
  ['good morning', ['social.greet'], null, (c) => c.intent.slots.part === 'morning'],
  ['thanks!', ['social.thanks']],
  ['good job', ['social.praise']],
  ['you are amazing', ['social.compliment']],
  ['I love you', ['social.flirt']],
  ["you're beautiful", ['social.flirt']],
  ["you're pretty good at this", ['social.compliment']],
  ['you are useless', ['social.insult']],
  ['shut up', ['social.insult']],
  ['sorry', ['social.apology']],
  ['tell me a joke', ['social.joke']],
  ['tell me a story', ['social.story']],
  ['haha', ['social.laugh']],
  ["I'm sad", ['social.player_feeling'], null, (c) => c.intent.slots.feeling === 'sad'],
  ['call me Ash', ['social.set_name'], null, (c) => c.intent.slots.name === 'Ash'],
  ['goodbye', ['social.farewell']],
  ['good night', ['social.goodnight']],
  ['ok', ['social.yes']],
  ['hi, how are you?', ['social.greet', 'ask.feelings']],
  ['lyra', ['social.name_call']],
  // her own will (DESIGN §16)
  ["let's split up for a while", ['cmd.part_ways'], (a) => a[0].name === 'leave_player' && a[0].args.value === 'apart'],
  ['travel with me again', ['cmd.rejoin']],
  ['I promise to buy you a honey cake', ['cmd.promise'], (a) => a[0].name === 'promise' && /buy you a honey cake/.test(a[0].args.value)],
  ["what's your plan for today?", ['ask.plan']],
  ['do you trust me?', ['ask.trust_me']],
  ['are you afraid of me?', ['ask.fear_me']],
  ['why did you leave me?', ['ask.why_left']],
  ["I'm so sorry for hitting you", ['social.apology']],
  ['it was an accident', ['social.apology'], null, (c) => c.intent.slots.accident === true],
  ["I'll pay you 10 coins to chop wood", ['cmd.job'], (a) => a[0].name === 'start_job' && a[0].args.value === 'chop_wood'],
  ['follow me for 5 coins', ['cmd.follow'], (a) => a[0].args.amount === 5],
  ["I'll pay you 20 gold to explore the ruins", ['cmd.explore'], (a) => a[0].args.target === 'ruins' && a[0].args.amount === 20],
];

test(`NLU understands ${PHRASES.length} phrasings (commands, multi-commands, questions, small talk)`, () => {
  const game = makeGame();
  assert.ok(PHRASES.length >= 60);
  for (const [text, ids, checkActions, checkClause] of PHRASES) {
    const r = parseMessage(text, envFor(game));
    const got = r.clauses.map((c) => c.intent?.id || null);
    assert.deepEqual(got, ids, `"${text}" -> ${JSON.stringify(got)}`);
    const actions = r.clauses.flatMap((c) => c.intent.actions);
    if (checkActions) assert.ok(checkActions(actions), `"${text}" actions ${JSON.stringify(actions)}`);
    if (checkClause) assert.ok(checkClause(r.clauses[0]), `"${text}" slots ${JSON.stringify(r.clauses[0].intent.slots)}`);
    // Every built-in command is confident enough to run before any network call.
    for (const c of r.clauses) if (c.intent.command) assert.ok(c.intent.confidence >= COMMAND_THRESHOLD, text);
  }
});

test('NLU leaves unrelated chat unmatched and does not invent commands', () => {
  const game = makeGame();
  for (const text of ['the moon looks strange tonight', 'my grandmother had a goat named Barnaby', 'purple elephants debate taxes']) {
    const r = parseMessage(text, envFor(game));
    assert.equal(r.commands.length, 0, text);
    assert.ok(r.clauses.every((c) => !c.intent || !c.intent.command), text);
  }
});

test('NLU splits clauses on conjunctions only before a new verb', () => {
  assert.deepEqual(splitClauses("follow me and kill anything that isn't a friend").map((c) => c.text), ['follow me', "kill anything that isn't a friend"]);
  assert.deepEqual(splitClauses('what do you think of Bram and Elda?').map((c) => c.text), ['what do you think of Bram and Elda']);
  assert.equal(normalize("What's up? Don't worry!"), 'what is up? do not worry');
  assert.deepEqual(extractQuantityItem('3 iron ore'), { qty: 3, all: false, item: 'iron_ore', raw: 'iron ore' });
  assert.equal(extractQuantityItem('a few honey cakes').qty, 3);
});

test('NLU tries plugin intents first (DESIGN §11 shape) and skips ones with missing actions', () => {
  const answers = [];
  const plugin = {
    id: 'relationships',
    intents: [
      {
        id: 'rel.opinion',
        patterns: [/\bwhat do you think (?:of|about) (?<who>[\w' -]+)/i],
        command: false,
        confidence: 0.85,
        answer(m, ctx, results) {
          answers.push(m.groups.who);
          return 'Bram? Gruff as a bear, kind as one too.';
        },
      },
      { id: 'rel.broken', patterns: [/^follow me$/i], command: true, actions: () => [{ name: 'no_such_action', args: {} }] },
      { id: 'core.follow', patterns: [/^(?:please )?stick with me$/i], command: true, confidence: 0.95, actions: () => [{ name: 'follow', args: { target: 'player', value: 'close', amount: null } }] },
    ],
  };
  const game = makeGame({ plugins: [plugin] });
  const r1 = parseMessage('What do you think of Bram?', envFor(game));
  assert.equal(r1.clauses[0].intent.id, 'rel.opinion');
  assert.equal(r1.clauses[0].intent.source, 'plugin');
  assert.equal(r1.clauses[0].intent.answer([]), 'Bram? Gruff as a bear, kind as one too.');
  const r2 = parseMessage('follow me', envFor(game));
  assert.equal(r2.clauses[0].intent.id, 'cmd.follow', 'falls back to the built-in when a plugin action is missing');
  const r3 = parseMessage('stick with me and attack mode', envFor(game));
  assert.equal(r3.clauses[0].intent.id, 'core.follow');
  assert.equal(r3.commands.length, 2);
});

// ------------------------------------------------------------- coercion

test('response coercion fixes malformed replies', () => {
  const names = ACTION_NAMES;
  const ok = coerceResponse({ say: 'Right behind you.', thought: 'Good.', emotion: { name: 'trust', intensity: 0.4 }, actions: [{ name: 'follow', target: 'player', value: null, amount: null }], memories: [], relationships: [], goal: null }, { actionNames: names });
  assert.equal(ok.say, 'Right behind you.');
  assert.equal(ok.actions.length, 1);

  const prose = coerceResponse('Sure! Here you go:\n```json\n{"say": "Hi there", "actions": []}\n```\nHope that helps.', { actionNames: names });
  assert.equal(prose.say, 'Hi there');

  const missing = coerceResponse({}, { actionNames: names });
  assert.equal(missing.say, '');
  assert.deepEqual(missing.actions, []);
  assert.equal(missing.emotion, null);

  const messy = coerceResponse(
    {
      speech: 'Lyra: *smiles* "On it."',
      emotion: 'happy',
      actions: [
        { name: 'Start Job', args: { target: 'player', value: 'chop_wood', amount: '5' } },
        { name: 'summon_dragon', target: 'sky' },
        { action: 'follow', target: 12 },
        'retreat',
        { name: 'sit' }, { name: 'stay' }, { name: 'emote', value: 'wave' }, { name: 'wait', amount: 3 },
      ],
      memories: ['Plain string memory', { text: 'Big one', importance: 50, about: 'player' }, { nope: true }],
      relationships: { bram: { affinity: 40, trust: '-9', tag: 'bestie', opinion: 'Solid.' } },
      goal: { text: 'Learn the lute' },
    },
    { actionNames: names },
  );
  assert.equal(messy.say, 'On it.');
  assert.deepEqual(messy.emotion, { name: 'joy', intensity: 0.4 });
  assert.equal(messy.actions[0].name, 'start_job');
  assert.equal(messy.actions[0].args.amount, 5);
  assert.equal(messy.actions[1].args.target, '12');
  assert.ok(messy.rejected.includes('summon_dragon'));
  assert.equal(messy.actions.length, 6, 'at most 6 actions');
  assert.equal(messy.memories.length, 2);
  assert.equal(messy.memories[1].importance, 5);
  assert.deepEqual(messy.memories[1].about, ['player']);
  assert.equal(messy.relationships[0].person, 'bram');
  assert.equal(messy.relationships[0].affinity, 5);
  assert.equal(messy.relationships[0].trust, -5);
  assert.equal(messy.relationships[0].tag, null);
  assert.equal(messy.goal, 'Learn the lute');

  const intense = coerceResponse({ say: 'x', emotion: { name: 'Scared', intensity: 7 } });
  assert.deepEqual(intense.emotion, { name: 'fear', intensity: 0.7 });

  const broken = coerceResponse('{"say": "Right behind you", "actions": [{"name": "fol', { actionNames: names });
  assert.equal(broken.say, 'Right behind you');
  const plain = coerceResponse("I'd love to, but my feet are killing me.");
  assert.equal(plain.say, "I'd love to, but my feet are killing me.");
  const code = coerceResponse('{{{ not json at all ]]] "x": 1');
  assert.equal(code.say, '');
  assert.ok(looksLikeSpeech('Hello there, friend.'));
  assert.ok(!looksLikeSpeech('{"a": 1}'));
  assert.deepEqual(extractJson('noise {"a": [1,2,],} tail'), { a: [1, 2] });

  const executed = [{ name: 'follow', args: { target: 'player', value: null, amount: null }, ok: true }];
  const deduped = dedupeActions([{ name: 'follow', args: { target: 'player', value: 'close', amount: null } }, { name: 'sit', args: {} }], executed);
  assert.deepEqual(deduped.map((a) => a.name), ['sit']);
});

test('reflection and conversation coercion', () => {
  const r = coerceReflection('Here: {"diary": "Dear diary...", "opinions": {"bram": "Kind."}, "goal": null, "summary": "Good day."}');
  assert.equal(r.diary, 'Dear diary...');
  assert.deepEqual(r.opinions, [{ person: 'bram', opinion: 'Kind.' }]);
  assert.equal(coerceReflection({ opinions: [] }), null);
  const c = coerceConversation({ lines: [{ speaker: 'Lyra', text: 'Morning, Bram.' }, { speaker: 'Bram', text: 'Hmph. Morning.' }, { text: '' }], learned: 'He likes iron', affinity: 12 }, { npcName: 'Bram Ironhand' });
  assert.deepEqual(c.lines.map((l) => l.speaker), ['lyra', 'npc']);
  assert.deepEqual(c.learned, ['He likes iron']);
  assert.equal(c.affinity, 5);
  assert.equal(coerceConversation({ lines: [] }), null);
});

// --------------------------------------------------------------- prompt

test('prompt: rules are byte-stable across calls and the whole prompt stays under budget', () => {
  const game = makeGame();
  const a = buildChatPrompt(game, 'follow me', []);
  game.clock.t += 300;
  game.clock.hour = 22;
  game.clock.fullString = () => 'Day 2, 10:00 PM';
  game.companion.x += 50;
  game.companion.mind.conversation.push({ role: 'player', text: 'hello' }, { role: 'lyra', text: 'Hi!' });
  const b = buildChatPrompt(game, 'what do you think of Bram?', [{ name: 'follow', args: { target: 'player' }, ok: true, message: '' }]);
  assert.equal(a.rules, b.rules, 'rules identical');
  assert.equal(buildRules(game), a.rules);
  assert.notEqual(a.context, b.context);
  assert.ok(b.context.includes('what do you think of Bram?'));
  assert.ok(b.context.includes('follow(target=player): DONE already'), 'already done, so not repeated');
  assert.ok(b.context.includes('w1: Grey Wolf'), 'nearby creature with id');
  assert.ok(/\n- follow: /.test(a.rules) && /\n- leave_player: /.test(a.rules), 'action catalogue');
  assert.ok(!/\bDay 2\b|2:00 PM/.test(a.rules), 'no time in rules');
  assert.ok(/not an assistant, a servant/.test(a.rules) && /request, never an order/.test(a.rules) && /Never apologize for having your own will/.test(a.rules), 'she lives for herself');
  assert.ok(/leave_player/.test(a.rules) && /bind/.test(a.rules) && /flee/.test(a.rules), 'she can stop, run or leave');
  assert.ok(!/\b(?:assistant to|helpful assistant)\b/i.test(a.rules));
  assert.ok(a.rules.includes('"used_memories"') && a.rules.includes('"knowledge"'), 'round-2 reply fields');
  assert.ok(a.rules.length + a.context.length < PROMPT_BUDGET);

  // A long conversation and big plugin sections still fit.
  game.companion.mind.conversation = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'lyra' : 'player', text: `line ${i} `.repeat(30) }));
  game.plugins.register({ id: 'memory', name: 'Memory', promptContext: () => 'recalled memory. '.repeat(200) });
  game.plugins.register({ id: 'quest', name: 'Quest', promptContext: () => 'quest objective. '.repeat(200) });
  const big = buildChatPrompt(game, 'x'.repeat(2000), []);
  assert.ok(big.rules.length + big.context.length <= PROMPT_BUDGET, `size ${big.rules.length + big.context.length}`);
  assert.equal(big.rules, a.rules);
  assert.ok(big.context.includes('Recent conversation'));
});

test('response schema closes every object and lists all properties as required', () => {
  const walk = (s) => {
    if (s.anyOf) return s.anyOf.forEach(walk);
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
      Object.values(s.properties).forEach(walk);
    }
    if (s.type === 'array') walk(s.items);
  };
  walk(RESPONSE_SCHEMA);
});

// ------------------------------------------------------------- providers

test('provider selection follows settings.brain and availability', () => {
  assert.equal(chooseProvider('auto', { claudeAi: true, api: true }), 'claude.ai');
  assert.equal(chooseProvider('auto', { claudeAi: false, api: true }), 'api');
  assert.equal(chooseProvider('auto', {}), 'local');
  assert.equal(chooseProvider('claude', { claudeAi: false, api: true }), 'local');
  assert.equal(chooseProvider('apikey', { claudeAi: true, api: true }), 'api');
  assert.equal(chooseProvider('local', { claudeAi: true, api: true }), 'local');

  const sample = Object.assign(async () => ({ text: '{}' }), { json: async () => ({}) });
  const game = makeGame({ runtime: { hostPresent: true, sample, onChange() {}, disable() {} }, apiKey: 'sk-test-123456789' });
  const ps = new ProviderSet(game);
  assert.equal(ps.currentId(), 'claude.ai');
  assert.equal(ps.api.available(), false, 'no API key path inside claude.ai');
  game.settings.brain = 'local';
  assert.equal(ps.currentId(), 'local');
  const game2 = makeGame({ apiKey: 'sk-test-123456789' });
  assert.equal(new ProviderSet(game2).currentId(), 'api');
  const brain = new Brain(makeGame());
  assert.deepEqual(brain.status(), { provider: 'local', label: "Lyra's own instincts (offline)", busy: false, lastError: null });
});

function fakeRuntime(json) {
  const rt = { hostPresent: true, disabled: [], listeners: [], tts: null };
  const sample = Object.assign(async (p, o) => ({ text: JSON.stringify(await json(p, o)) }), { json: (p, o) => json(p, o) });
  rt.caps = { sample };
  Object.defineProperty(rt, 'sample', { get: () => rt.caps.sample });
  rt.disable = (n) => {
    rt.disabled.push(n);
    rt.caps[n] = null;
    rt.listeners.forEach((f) => f(n));
  };
  rt.onChange = (f) => rt.listeners.push(f);
  return rt;
}

const GOOD_REPLY = {
  thought: 'They want me close.',
  say: "Right behind you — and I'll keep the wolves off.",
  emotion: { name: 'trust', intensity: 0.5 },
  actions: [{ name: 'set_combat_mode', target: null, value: 'attack', amount: null }, { name: 'summon_dragon', target: null, value: null, amount: null }],
  memories: [{ text: 'The traveler asked me to stay close.', importance: 4, about: ['player'] }],
  relationships: [{ person: 'Bram', affinity: 2, trust: 1, respect: 0, note: 'Likes iron.', tag: 'friend', opinion: 'Solid.' }, { person: 'nobody_here', affinity: 3, trust: 0, respect: 0, note: null, tag: null, opinion: null }],
  goal: 'Buy Pip a sweet roll',
};

test('claude.ai path: commands run first, then Claude replies; effects and actions applied', async () => {
  const prompts = [];
  let order = [];
  const game = makeGame({
    runtime: fakeRuntime(async (p, o) => {
      prompts.push({ p, o });
      order.push('sample');
      return GOOD_REPLY;
    }),
  });
  const brain = new Brain(game);
  brain.init();
  const origRun = game.actions.run.bind(game.actions);
  game.actions.run = (n, a, s) => {
    order.push(`${n}:${s}`);
    return origRun(n, a, s);
  };
  const origWarn = console.warn;
  console.warn = () => {};
  const r = await brain.handlePlayerMessage('follow me');
  console.warn = origWarn;
  assert.equal(r.provider, 'claude.ai');
  assert.equal(r.say, GOOD_REPLY.say);
  assert.deepEqual(order, ['follow:player', 'sample', 'set_combat_mode:claude']);
  assert.equal(prompts[0].o.modelTier, 'quick');
  assert.equal(prompts[0].o.cache, false);
  assert.ok(prompts[0].p.startsWith('You are Lyra'), 'rules first in the single prompt');
  const chat = game.ui.chat.messages;
  assert.deepEqual(chat.map((m) => m.from), ['player', 'lyra']);
  assert.ok(game.ui.chat.thinking.includes(true) && game.ui.chat.thinking.at(-1) === false);
  assert.ok(game.bubbles.icons.includes('...'));
  const mind = game.companion.mind;
  assert.deepEqual(mind.conversation.map((c) => c.role), ['player', 'lyra']);
  assert.deepEqual(mind.calls.feel[0].slice(0, 2), ['trust', 0.5]);
  assert.equal(mind.calls.remember.length, 1);
  assert.ok(mind.calls.adjust.some(([id]) => id === 'bram'), 'person ref resolved');
  assert.ok(!mind.calls.adjust.some(([id]) => id === 'nobody_here'), 'unknown person ignored');
  assert.deepEqual(mind.calls.tags[0], ['bram', 'friend', true]);
  assert.deepEqual(mind.calls.goals[0][0], 'Buy Pip a sweet roll');
  assert.equal(mind.calls.thoughts[0][0], 'They want me close.');
  assert.ok(game.bus.recent.some((e) => e.type === 'speech' && e.payload.kind === 'say'));
  assert.ok(game.bus.recent.some((e) => e.type === 'player_message'));
});

test('claude.ai errors: not_granted disables, rate_limited falls back, invalid_json uses the text, refused deflects', async () => {
  let mode = 'not_granted';
  let calls = 0;
  const rt = fakeRuntime(async () => {
    calls++;
    if (mode === 'ok') return GOOD_REPLY;
    if (mode === 'invalid_json') throw { code: 'invalid_json', message: 'no json', text: "Of course. I'll be right here." };
    throw { code: mode, message: mode };
  });
  const game = makeGame({ runtime: rt });
  const brain = new Brain(game);
  brain.init();

  const r1 = await brain.handlePlayerMessage('how are you?');
  assert.equal(r1.provider, 'local');
  assert.deepEqual(rt.disabled, ['sample']);
  assert.equal(brain.llmAvailable(), false);
  assert.equal(game.ui.chat.messages.filter((m) => m.from === 'system').length, 1);
  await brain.handlePlayerMessage('how are you?');
  assert.equal(calls, 1, 'never asks again after not_granted');
  assert.equal(game.ui.chat.messages.filter((m) => m.from === 'system').length, 1, 'said so once');

  const rt2 = fakeRuntime(async () => {
    if (mode === 'ok') return GOOD_REPLY;
    if (mode === 'invalid_json') throw { code: 'invalid_json', message: 'no json', text: "Of course. I'll be right here." };
    throw { code: mode, message: mode };
  });
  const game2 = makeGame({ runtime: rt2 });
  const brain2 = new Brain(game2);
  brain2.init();
  mode = 'rate_limited';
  const r2 = await brain2.handlePlayerMessage('tell me a joke');
  assert.equal(r2.provider, 'local');
  assert.ok(r2.say.length > 5);
  assert.equal(brain2.llmAvailable(), true, 'still available after rate limiting');
  assert.equal(brain2.status().lastError, 'rate_limited');
  assert.ok(game2.ui.chat.messages.some((m) => m.from === 'system' && /too many requests/.test(m.text)));

  mode = 'invalid_json';
  const r3 = await brain2.handlePlayerMessage('wait for me');
  assert.equal(r3.say, "Of course. I'll be right here.");
  assert.equal(r3.provider, 'claude.ai');

  mode = 'refused';
  const r4 = await brain2.handlePlayerMessage('something odd');
  assert.ok(LINES.deflect.some((l) => (typeof l === 'string' ? l : l.t).replace('{you}', '') && r4.say.length > 3));

  mode = 'upstream_error';
  const r5 = await brain2.handlePlayerMessage('what time is it?');
  assert.equal(r5.provider, 'local');
  assert.ok(/2:00 PM/.test(r5.say));
});

test('a message during a pending Claude reply queues; the newest wins', async () => {
  const resolvers = [];
  const seen = [];
  const game = makeGame({
    runtime: fakeRuntime(
      (p) =>
        new Promise((res) => {
          seen.push(p.slice(-200));
          resolvers.push(() => res({ ...GOOD_REPLY, actions: [], say: `reply ${resolvers.length}` }));
        }),
    ),
  });
  const brain = new Brain(game);
  brain.init();
  const p1 = brain.handlePlayerMessage('first');
  await tick();
  assert.equal(brain.busy, true);
  const p2 = brain.handlePlayerMessage('second');
  const p3 = brain.handlePlayerMessage('third');
  assert.deepEqual(await p2, { say: '', thought: null, actions: [], provider: 'claude.ai', superseded: true });
  resolvers[0]();
  const r1 = await p1;
  assert.equal(r1.say, 'reply 1');
  await tick();
  assert.equal(resolvers.length, 2, 'only the newest queued message is sent');
  assert.ok(seen[1].includes('"third"'));
  resolvers[1]();
  assert.equal((await p3).say, 'reply 2');
});

test('API-key provider: request shape, refusal, typed errors, key never leaked', async () => {
  class APIError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }
  class AuthenticationError extends APIError {}
  class RateLimitError extends APIError {}
  class APIConnectionError extends APIError {}
  let next = null;
  const requests = [];
  class FakeAnthropic {
    constructor(opts) {
      this.opts = opts;
      this.beta = {
        messages: {
          create: async (body) => {
            requests.push({ body, opts: this.opts });
            if (next instanceof Error) throw next;
            return next;
          },
        },
      };
    }
  }
  Object.assign(FakeAnthropic, { APIError, AuthenticationError, RateLimitError, APIConnectionError });
  const key = 'sk-ant-secret-0123456789';
  const game = makeGame({ apiKey: key, settings: { apiModel: 'model-under-test' } });
  let loadedUrl = null;
  const provider = new ApiKeyProvider(game, {
    loadSdk: async (url) => {
      loadedUrl = url;
      return { default: FakeAnthropic };
    },
  });
  next = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(GOOD_REPLY) }] };
  const out = await provider.complete({ rules: 'RULES', task: 'TASK', schema: RESPONSE_SCHEMA });
  assert.equal(out.say, GOOD_REPLY.say);
  assert.ok(loadedUrl.includes('@anthropic-ai/sdk@1.6.0/+esm'));
  const { body, opts } = requests[0];
  assert.equal(opts.apiKey, key);
  assert.equal(opts.dangerouslyAllowBrowser, true);
  assert.equal(body.model, 'model-under-test');
  assert.equal(body.max_tokens, 2048);
  assert.deepEqual(body.system, [{ type: 'text', text: 'RULES', cache_control: { type: 'ephemeral' } }]);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'TASK' }]);
  assert.equal(body.output_config.effort, 'low');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.deepEqual(body.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(body.fallbacks, 'default');
  for (const k of ['temperature', 'top_p', 'top_k', 'thinking']) assert.ok(!(k in body), `no ${k}`);

  next = { stop_reason: 'refusal', content: [] };
  await assert.rejects(provider.complete({ rules: 'R', task: 'T', schema: {} }), (e) => e.code === 'refused');
  next = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sure thing!' }] };
  await assert.rejects(provider.complete({ rules: 'R', task: 'T', schema: {} }), (e) => e.code === 'invalid_json' && e.text === 'Sure thing!');
  next = new RateLimitError(429, 'slow down');
  await assert.rejects(provider.complete({ rules: 'R', task: 'T', schema: {} }), (e) => e.code === 'rate_limited');
  next = new APIConnectionError(undefined, `failed to fetch with key ${key}`);
  await assert.rejects(provider.complete({ rules: 'R', task: 'T', schema: {} }), (e) => e.code === 'connection' && !e.message.includes(key));
  next = new AuthenticationError(401, 'invalid x-api-key');
  await assert.rejects(provider.complete({ rules: 'R', task: 'T', schema: {} }), (e) => e.code === 'auth');
  assert.equal(provider.available(), false, 'a rejected key is not retried');
  game.apiKey = 'sk-ant-another-key-000';
  assert.equal(provider.available(), true, 'a new key is tried');
  assert.equal(scrub(`oops ${key}`, key), 'oops [key]');
  assert.equal(classifyApiError({ status: 500, message: 'boom' }, {}, key).code, 'upstream_error');
  assert.ok(new BrainError('not_granted').permanent);
});

// ------------------------------------------------------ offline mind

test('offline mind answers from game data and updates the mind', async () => {
  const game = makeGame();
  const brain = new Brain(game);
  brain.init();
  const r = await brain.handlePlayerMessage("follow me and kill anything that isn't a friend");
  assert.equal(r.provider, 'local');
  assert.deepEqual(game.log.map((a) => a.name), ['follow', 'set_combat_mode']);
  assert.ok(r.say.length > 10);

  const t = await brain.handlePlayerMessage('what time is it?');
  assert.ok(t.say.includes('2:00 PM'));
  const inv = await brain.handlePlayerMessage('do you have any potions?');
  assert.ok(/1 healing potion/i.test(inv.say), inv.say);
  const feel = await brain.handlePlayerMessage('how are you feeling?');
  assert.ok(/tired|sleep|eyelids/i.test(feel.say), `low energy mentioned: ${feel.say}`);
  const op = await brain.handlePlayerMessage('what do you think of Bram?');
  assert.ok(/Bram/.test(op.say), op.say);
  const refused = await brain.handlePlayerMessage('attack Bram');
  assert.ok(refused.say.includes("Bram is a friend. I won't hurt him."), refused.say);

  const mind = game.companion.mind;
  const before = mind.calls.adjust.length;
  await brain.handlePlayerMessage('you are useless');
  const hit = mind.calls.adjust.slice(before).find(([id]) => id === 'player');
  assert.ok(hit && hit[1].affinity < 0, 'insults cost affinity');
  await brain.handlePlayerMessage('call me Ash');
  assert.equal(game.settings.playerName, 'Ash');
  const named = await brain.handlePlayerMessage('what is my name?');
  assert.ok(named.say.includes('Ash'));
  const where = await brain.handlePlayerMessage('where is the smithy?');
  assert.ok(/Ironhand Smithy/.test(where.say), where.say);
  const past = await brain.handlePlayerMessage('where are you from?');
  assert.ok(/Hearthvale/.test(past.say) && /Lamplight Lane/.test(past.say) && !/Glasswater|Isles/.test(past.say), past.say);
  const quest = await brain.handlePlayerMessage('what should we do next?');
  assert.ok(quest.say.length > 10);
  const unknown = await brain.handlePlayerMessage('purple elephants debate taxes');
  assert.ok(unknown.say.length > 1);
  assert.ok(mind.conversation.length > 10 && mind.conversation.length <= 40);
  assert.ok(game.ui.chat.messages.every((m) => typeof m.text === 'string' && m.text.length > 0));
});

test('generateConversation: null without Claude or a player order; coerced lines with it', async () => {
  const offline = new Brain(makeGame());
  assert.equal(await offline.generateConversation(offline.game.entities.get('bram'), 'poetry'), null);
  let task = '';
  const game = makeGame({
    runtime: fakeRuntime(async (p) => {
      task = p;
      return { lines: [{ speaker: 'lyra', text: 'Morning, Bram.' }, { speaker: 'npc', text: 'Hmph.' }], learned: ['Bram writes poetry.'], affinity: 2 };
    }),
  });
  const brain = new Brain(game);
  brain.init();
  game.companion.mind.relationships.get('bram').familiarity = 20;
  assert.equal(await brain.generateConversation(game.entities.get('bram'), 'poetry'), null, 'not without a player action');
  game.actions.run('talk_to', { target: 'bram' }, 'player');
  const conv = await brain.generateConversation(game.entities.get('bram'), 'poetry');
  assert.deepEqual(conv.lines.map((l) => l.speaker), ['lyra', 'npc']);
  assert.equal(conv.affinity, 2);
  assert.ok(task.includes('Bram writes poetry at night.'), 'facts within familiarity');
  assert.ok(!task.includes('lost his wife'), 'facts beyond familiarity withheld');
});

test('reflect: offline diary, consolidation, showDiary; Claude diary applies opinions', async () => {
  const game = makeGame();
  const brain = new Brain(game);
  brain.init();
  game.bus.emit('player_sleep', { bed: null });
  const r = await brain.reflect('sleep');
  const words = r.diary.split(/\s+/).length;
  assert.ok(words >= 40 && words <= 220, `diary words ${words}: ${r.diary}`);
  assert.ok(r.diary.includes('wolves'), 'uses real memories');
  assert.equal(game.companion.mind.diary.length, 1);
  assert.equal(game.companion.mind.calls.consolidate, 1);
  assert.equal(game.ui.diary.text, r.diary);

  const game2 = makeGame({ runtime: fakeRuntime(async (p, o) => ({ diary: 'Today Bram laughed at my joke.', opinions: [{ person: 'Bram', opinion: 'A big soft bear.' }], goal: 'Learn a poem', summary: 'A warm day.' })) });
  const brain2 = new Brain(game2);
  brain2.init();
  const r2 = await brain2.reflect('sleep');
  assert.equal(r2.diary, 'Today Bram laughed at my joke.');
  assert.equal(r2.summary, 'A warm day.');
  assert.deepEqual(game2.companion.mind.calls.opinions[0], ['bram', 'A big soft bear.']);
  assert.equal(game2.companion.mind.calls.goals[0][0], 'Learn a poem');
  assert.ok(composeDiary(game2, [], { day: 3 }).text.length > 40);
});

// ------------------------------------------------------------ speech

test('speech_gen: 60+ bark situations with variants, slots, and no repeats', () => {
  assert.ok(BARK_SITUATIONS.length >= 60, `bark situations: ${BARK_SITUATIONS.length}`);
  for (const s of BARK_SITUATIONS) assert.ok(LINES[s] && LINES[s].length >= 3, `${s} needs several variants`);
  const sg = new SpeechGen();
  for (const s of ['ack_follow', 'kill', 'combat_end', 'joke']) {
    const n = LINES[s].length;
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      const line = sg.line(s, { enemy: 'Wolves' }, { mood: 'calm', bond: 3, traits: ['playful', 'warm', 'bookish', 'steady', 'diligent'] });
      seen.add(line);
    }
    assert.ok(seen.size >= Math.min(n, 3) && seen.size >= n - 1, `${s}: ${seen.size} distinct of ${n}`);
  }
  let prev = null;
  for (let i = 0; i < 60; i++) {
    const line = sg.line('combat_start', { enemy: 'Bandits' });
    assert.notEqual(line, prev);
    assert.ok(!line.includes('{') && !line.includes('['), line);
    prev = line;
  }
  for (let i = 0; i < 10; i++) assert.ok(!sg.line('combat_slime', { enemy: 'A slime' }).includes('{place}'));
  assert.equal(sg.expand('{you} said [hi|hi]', { you: 'Ash' }), 'Ash said hi');
  const ctx = { mood: 'calm', bond: 0, traits: ['playful'], playerName: 'Ash' };
  for (let i = 0; i < 20; i++) assert.ok(!/partner|my friend/.test(sg.line('ack_follow', {}, ctx)), 'low bond keeps it formal');
});

test('barks: rate limited, never over a pending reply, urgent ones cut through', () => {
  const game = makeGame();
  const brain = new Brain(game);
  brain.init();
  const bubbles = game.bubbles.said;
  const wolf = game.entities.get('w1');
  game.bus.emit('attack', { attacker: wolf, kind: 'bite', target: game.player });
  brain.update(1 / 60);
  assert.equal(bubbles.length, 1, 'combat start bark');
  game.bus.emit('weather', { type: 'rain' });
  game.time += 5;
  brain.update(1 / 60);
  assert.equal(bubbles.length, 1, 'rate limited');
  game.bus.emit('item_given', { from: game.player, to: game.companion, itemId: 'honey_cake', qty: 1 });
  game.time += 3;
  brain.update(1 / 60);
  assert.equal(bubbles.length, 2, 'gifts get an answer at once');
  assert.ok(/honey cake/i.test(bubbles[1]), bubbles[1]);
  brain.busy = true;
  game.time += 25;
  game.bus.emit('time_of_day', { phase: 'night', day: 2, hour: 20.5 });
  brain.update(1 / 60);
  assert.equal(bubbles.length, 2, 'silent while a reply is pending');
  brain.busy = false;
  brain.update(1 / 60);
  assert.equal(bubbles.length, 3);
  const speech = game.bus.recent.filter((e) => e.type === 'speech' && e.payload.kind === 'bark');
  assert.equal(speech.length, 3);
  assert.equal(game.ui.chat.messages.length, 0, 'barks never go to the chat');
  game.actions.run('follow', { target: 'player' }, 'player');
  assert.equal(bubbles.length, 4, 'HUD orders are acknowledged');
});

test('serialize keeps a tiny state and restores it', () => {
  const game = makeGame();
  const brain = new Brain(game);
  brain.init();
  brain.notices.add('chat_tip');
  brain.barks.visited.add('whisperwood');
  brain.lastReflectT = 1234;
  const s = brain.serialize();
  assert.ok(JSON.stringify(s).length < 1000);
  const b2 = new Brain(makeGame());
  b2.deserialize(JSON.parse(JSON.stringify(s)));
  assert.ok(b2.notices.has('chat_tip'));
  assert.ok(b2.barks.visited.has('whisperwood'));
  assert.equal(b2.lastReflectT, 1234);
  b2.deserialize(null);
  b2.deserialize({ notices: 'junk', barks: 5 });
});

// ================================================================ round 2: her own will

function brainFor(game) {
  const b = new Brain(game);
  game.brain = b;
  b.init();
  return b;
}

const verdict = (decision, reasons = [], message = '', extra = {}) => ({ decision, reasons, message, score: 0, ...extra });
const bankTexts = (key) => LINES[key].map((l) => (typeof l === 'string' ? l : l.t));
const quiet = async (fn) => {
  const w = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = w;
  }
};

test('coin offers: detected, stripped from the request, and carried on amount-free actions', () => {
  const cases = [
    ["I'll pay you 10 coins to chop wood", 10, 'chop wood'],
    ['chop 5 wood and I will pay you 20 coins', 20, 'chop 5 wood'],
    ['I will give you 5 gold if you follow me', 5, 'follow me'],
    ['20 coins to guard Pip', 20, 'guard Pip'],
    ["here's ten coins, now chop some wood", 10, 'chop some wood'],
    ['follow me for 3 coins', 3, 'follow me'],
    ["I'll pay you", null, ''],
    ['how about 20 gold?', 20, ''],
  ];
  for (const [text, coins, rest] of cases) {
    const r = detectOffer(text);
    assert.ok(r.offer, text);
    assert.equal(r.offer.coins, coins, text);
    assert.equal(r.rest, rest, text);
  }
  assert.equal(detectOffer('fish for me, you can keep half').offer.share, true);
  for (const text of ['give me 10 coins', "I'll give you a hug if you follow me", 'how many coins do you have?', 'I found 10 coins']) assert.equal(detectOffer(text).offer, null, text);
  const game = makeGame();
  const r = parseMessage("Lyra, I'll pay you 15 coins to follow me", envFor(game));
  assert.equal(r.offer.coins, 15);
  assert.equal(r.commands[0].intent.actions[0].args.amount, 15, 'follow ignores amount: the offer rides on it');
  const job = parseMessage("I'll pay you 15 coins to chop 5 wood", envFor(game));
  assert.equal(job.commands[0].intent.actions[0].args.amount, 5, 'a job keeps its own amount');
});

test('consent: a refused request gets her refusal, never an acknowledgement (offline, HUD, "why not?")', async () => {
  const game = makeGame();
  const brain = brainFor(game);
  const asked = [];
  game.actions.setConsentGate((name, args, source) => {
    asked.push([name, source]);
    if (name === 'start_job') return verdict('refuse', ["it's nearly dark", 'wolves hunt Whisperwood at night']);
    if (name === 'explore') return verdict('refuse', [], 'Walk into the ruins at night? No. Find someone else.');
    if (name === 'attack') return verdict('refuse', ['Bram is my friend and I will not harm him']);
    return null;
  });
  const r = await brain.handlePlayerMessage('chop some wood');
  assert.deepEqual(asked[0], ['start_job', 'player'], 'commands from the chat are requests');
  assert.equal(game.log.filter((a) => a.name === 'start_job').length, 0, 'a refused request never runs');
  assert.ok(/nearly dark/i.test(r.say) && /wolves hunt Whisperwood/i.test(r.say), r.say);
  const acks = [...bankTexts('ack_job'), ...bankTexts('job_start')].map((t) => t.replace(/\{job\}.*$/, '').trim()).filter((t) => t.length > 4);
  assert.ok(!acks.some((t) => r.say.includes(t)), `no acknowledgement: ${r.say}`);
  assert.ok(r.actions[0].refused);

  const r2 = await brain.handlePlayerMessage('explore the ruins');
  assert.equal(r2.say, 'Walk into the ruins at night? No. Find someone else.', 'the verdict message is her line');

  const r3 = await brain.handlePlayerMessage('attack Bram');
  assert.ok(/won't|will not|no\b|not/i.test(r3.say) && /Bram is my friend/.test(r3.say), r3.say);

  const before = game.bubbles.said.length;
  game.time += 30;
  game.actions.run('explore', { target: 'whisperwood' }, 'player');
  assert.equal(game.bubbles.said.length, before + 1, 'HUD request answered with a bubble');
  assert.equal(game.bubbles.said.at(-1), 'Walk into the ruins at night? No. Find someone else.');

  game.actions.setConsentGate((name) => (name === 'start_job' ? verdict('refuse', ["I'm exhausted", 'the forest is crawling with wolves']) : null));
  await brain.handlePlayerMessage('gather some herbs');
  const why = await brain.handlePlayerMessage('why not?');
  assert.ok(/exhausted/.test(why.say) && /wolves/.test(why.say), why.say);
  // Reasons written about her are said as herself.
  assert.equal(firstPersonReason('Lyra is exhausted and her hands are shaking'), "I'm exhausted and my hands are shaking");
  assert.equal(refusalSituation(verdict('refuse', ['too dangerous at night'])), 'refuse_danger');
  assert.equal(refusalSituation(verdict('refuse', ['she is starving'])), 'refuse_hungry');
  assert.equal(refusalSituation(verdict('refuse', ['x']), 'left'), 'refuse_left');
  assert.equal(refusalSituation(verdict('refuse_and_act', ['x'])), 'refuse_and_act');
});

test('consent: conditions, counter-offers ("deal" runs her proposal), paid requests and sweetened refusals', async () => {
  const game = makeGame();
  const brain = brainFor(game);
  let offerSeen = null;
  game.actions.setConsentGate((name, args) => {
    if (name === 'start_job') return verdict('accept_conditional', ['it pays'], '', { condition: 'Half the wood is mine' });
    if (name === 'follow') return verdict('counter', ['my feet are done for today'], '', { counter: { name: 'stay', args: { target: null, value: null, amount: null } } });
    if (name === 'guard') {
      offerSeen = brain.currentOffer;
      return verdict('accept', ['fair pay']);
    }
    if (name === 'explore') return (args.amount ?? 0) >= 10 ? verdict('accept', ['the coin is good']) : verdict('refuse', ['it is not worth my neck for free']);
    return null;
  });
  const c = await brain.handlePlayerMessage('chop some wood');
  assert.ok(/half the wood is mine/i.test(c.say), c.say);
  assert.equal(game.log.filter((a) => a.name === 'start_job').length, 1, 'a conditional yes runs');

  const k = await brain.handlePlayerMessage('follow me');
  assert.ok(/wait here/.test(k.say), `counter-offer: ${k.say}`);
  assert.equal(game.log.filter((a) => a.name === 'follow').length, 0);
  const d = await brain.handlePlayerMessage('deal');
  const stay = game.actions.history.filter((h) => h.name === 'stay').at(-1);
  assert.ok(stay && stay.source === 'self', 'her own proposal runs as her decision');
  assert.ok(d.say.length > 2);

  const p = await brain.handlePlayerMessage("I'll pay you 15 coins to guard Pip");
  assert.equal(offerSeen?.coins, 15, 'the gate sees the offer');
  assert.ok(/15 coins/.test(p.say), p.say);
  const promise = game.log.find((a) => a.name === 'promise');
  assert.ok(promise && /15 coins/.test(promise.args.value) && promise.args.target === 'player', 'the player now owes her');

  const no = await brain.handlePlayerMessage('explore whisperwood');
  assert.ok(/not worth my neck/i.test(no.say), no.say);
  await brain.handlePlayerMessage("Fine. I'll pay you 10 coins");
  const ex = game.log.filter((a) => a.name === 'explore');
  assert.equal(ex.length, 1, 'the bare offer sweetens the refused request');
  assert.equal(ex[0].args.amount, 10);
});

test('Claude is told what her gut says, may overrule it, and her refusal shows at once', async () => {
  const prompts = [];
  const order = [];
  const scout = {
    id: 'test_scout',
    intents: [{ id: 'test.scout', patterns: [/^could you scout (?<place>.+)$/i], command: false, confidence: 0.7, actions: (m) => [{ name: 'explore', args: { target: m.groups.place, value: null, amount: null } }] }],
  };
  const game = makeGame({
    plugins: [scout],
    runtime: fakeRuntime(async (p) => {
      prompts.push(p);
      order.push('sample');
      return { ...GOOD_REPLY, say: "Fine. I'll come — but I'm watching you.", actions: [{ name: 'follow', target: 'player', value: 'far', amount: null }] };
    }),
  });
  const brain = brainFor(game);
  const evals = [];
  game.companion.mind.evaluateRequest = (req) => {
    evals.push(req);
    return verdict('refuse', ['the ruins are deadly at night']);
  };
  game.actions.setConsentGate((name) => (name === 'follow' ? verdict('refuse', ['you hit me an hour ago'], "Not after that. I'll walk alone.") : null));
  const orig = game.actions.run.bind(game.actions);
  game.actions.run = (n, a, s) => {
    order.push(`${n}:${s}`);
    return orig(n, a, s);
  };
  const r = await quiet(() => brain.handlePlayerMessage('follow me'));
  assert.equal(game.bubbles.said[0], "Not after that. I'll walk alone.", 'her refusal shows before Claude answers');
  assert.ok(prompts[0].includes('NOT done, you refused'), 'Claude knows it did not happen');
  assert.ok(prompts[0].includes('your gut says: refuse, because you hit me an hour ago'), 'gut verdict line');
  assert.deepEqual(order, ['follow:player', 'sample', 'follow:claude'], 'Claude made the final call');
  assert.equal(r.say, "Fine. I'll come — but I'm watching you.");

  await quiet(() => brain.handlePlayerMessage('could you scout the ruins'));
  assert.equal(evals.length, 1);
  assert.equal(evals[0].action, 'explore');
  assert.equal(evals[0].source, 'player');
  assert.equal(evals[0].preview, true, 'a preview, not a decision');
  assert.ok(prompts[1].includes('not done yet; your gut says: refuse, because the ruins are deadly at night'), 'previewed request');
  assert.ok(!game.log.some((a) => a.name === 'explore' && a.args.target === 'ruins'), 'previews never run anything');
});

test('memory-aware prompt: recall context + working memory, "remembered" chips, knowledge as beliefs', async () => {
  const replies = [];
  const game = makeGame({
    runtime: fakeRuntime(async (p) => {
      replies.push(p);
      return {
        ...GOOD_REPLY,
        actions: [],
        used_memories: ['m1', 'not-in-context'],
        knowledge: [
          { subject: 'Bram', text: 'Bram may know who forged the ruins key.', kind: 'theory' },
          { subject: 'Maren', text: 'Maren drew maps of the ruins.', kind: 'gossip' },
          { subject: 'Elda', text: 'Elda used to sail.', kind: 'fact' },
        ],
      };
    }),
  });
  const brain = brainFor(game);
  const mind = game.companion.mind;
  const budgets = [];
  mind.recallContext = (text, opts) => {
    budgets.push(opts.budget);
    return {
      text: "On your mind now:\n- [m1] The wolves on the King's Road, and the traveler beside me.\nMemories:\n- [m2] Bram paid fairly for the pelts.",
      items: [
        { id: 'm1', store: 'episode', label: 'wolves on the King\'s Road' },
        { id: 'm2', store: 'episode', label: 'Bram paid fairly' },
        { id: 'k7', store: 'knowledge', label: 'the ruins gate is locked' },
      ],
    };
  };
  mind.workingMemory = [{ id: 'w9', label: 'Pip chasing the stray cat', activation: 0.8 }, { id: 'm1', label: 'DUPLICATE OF M1' }];
  const learned = [];
  mind.learn = (subject, text, opts) => learned.push([subject, text, opts]);
  game.plugins.register({ id: 'memory', name: 'Memory', promptContext: () => 'RAW MEMORY DUMP' });
  await quiet(() => brain.handlePlayerMessage('do you remember the wolves?'));
  const p = replies[0];
  assert.ok(p.includes("[m1] The wolves on the King's Road"), 'recall context in the prompt');
  assert.ok(p.includes('[k7] the ruins gate is locked'), 'ids not in the text are indexed');
  assert.ok(p.includes('Pip chasing the stray cat') && !p.includes('DUPLICATE OF M1'), 'working memory, deduped');
  assert.ok(!p.includes('RAW MEMORY DUMP'), 'no raw memory dump next to the recall context');
  assert.ok(budgets[0] > 1000 && budgets[0] <= 3500, `recall budget ${budgets[0]}`);
  const msg = game.ui.chat.messages.filter((m) => m.from === 'lyra').at(-1);
  assert.deepEqual(msg.memories, [{ id: 'm1', label: "wolves on the King's Road" }], 'chips only for ids in the context');
  assert.equal(learned.length, 3);
  assert.deepEqual([learned[0][2].kind, learned[0][2].source], ['theory', 'inferred'], 'a theory stays a belief');
  assert.equal(learned[1][2].kind, 'rumor');
  assert.equal(learned[2][2].kind, 'fact');
  assert.deepEqual(coerceKnowledge([{ subject: 'x', text: 'y', kind: 'nonsense' }, { subject: '', text: 'z' }]), [{ subject: 'x', text: 'y', kind: 'theory' }]);
  assert.deepEqual(coerceIds(['m1', 2, { id: 'm3' }, '[m4]', 'm1', null]), ['m1', '2', 'm3', 'm4']);
  // Rules stay byte-stable across messages; the whole prompt keeps its budget.
  await quiet(() => brain.handlePlayerMessage('x '.repeat(400)));
  const rules = buildRules(game);
  assert.ok(replies[0].startsWith(rules) && replies[1].startsWith(rules));
  assert.ok(replies[1].length <= PROMPT_BUDGET + 2, `prompt ${replies[1].length}`);
});

function toolRuntime({ tools = null, failWithTools = false } = {}) {
  const calls = [];
  const rt = fakeRuntime(async (p, o) => {
    calls.push(o);
    if (failWithTools && o.tools) throw { code: 'tools_unavailable', message: 'no tools here' };
    let used = [];
    if (o.tools) {
      const found = await o.tools[0].execute({ query: 'wolves' }, { signal: null });
      used = found.map((x) => x.id);
    }
    return { ...GOOD_REPLY, actions: [], used_memories: used };
  });
  rt.caps.sample.limits = async () => ({ maxPromptBytes: 262144, ...(tools ? { tools } : {}) });
  rt.calls = calls;
  return rt;
}

test('Claude recall tools are offered only when the view supports them', async () => {
  const plain = makeGame({ runtime: toolRuntime() });
  const b1 = brainFor(plain);
  plain.companion.mind.dossier = () => ({ name: 'Bram' });
  await quiet(() => b1.handlePlayerMessage('tell me about Bram'));
  assert.equal(plain.runtime.calls[0].tools, undefined, 'no tools without limits().tools');
  assert.equal(plain.runtime.calls[0].cache, false);

  const rt = toolRuntime({ tools: { maxCount: 2 } });
  const game = makeGame({ runtime: rt });
  const brain = brainFor(game);
  const mind = game.companion.mind;
  mind.dossier = (who) => ({ name: who, opinion: 'gruff, kind', memories: [{ id: 'm2', text: 'Bram paid fairly' }] });
  mind.loreLookup = (topic) => [{ id: 'l1', title: topic, text: 'Old stones.' }];
  await quiet(() => brain.handlePlayerMessage('tell me about the wolves'));
  const o = rt.calls[0];
  assert.deepEqual(o.tools.map((t) => t.name), ['recall', 'about_person'], 'capped at maxCount');
  assert.notEqual(o.cache, true, 'never cache with tools');
  for (const t of o.tools) assert.equal(t.inputSchema.type, 'object');
  const chips = game.ui.chat.messages.filter((m) => m.from === 'lyra').at(-1).memories;
  assert.deepEqual(chips.map((c) => c.id), ['m1', 'm2', 'm3'], 'memories found by a tool become chips');
  const res = await o.tools[1].execute({ name: 'Bram' }, {});
  assert.ok(JSON.stringify(res).length <= 1700, 'small results');

  const rt2 = toolRuntime({ tools: { maxCount: 3 }, failWithTools: true });
  const g2 = makeGame({ runtime: rt2 });
  const b2 = brainFor(g2);
  const r = await quiet(() => b2.handlePlayerMessage('hello'));
  assert.equal(r.provider, 'claude.ai', 'answered without tools');
  assert.equal(rt2.calls.length, 2, 'one plain retry, no loop');
  await quiet(() => b2.handlePlayerMessage('hello again'));
  assert.equal(rt2.calls.length, 3);
  assert.equal(rt2.calls[2].tools, undefined, 'tools stay off for the view');
});

test('when she has left or is gone she does not answer like a companion; apologies are weighed', async () => {
  let calls = 0;
  const game = makeGame({ runtime: fakeRuntime(async () => (calls++, GOOD_REPLY)) });
  const brain = brainFor(game);
  game.flags.lyra_gone = { day: 3, reason: 'knocked out' };
  const r = await brain.handlePlayerMessage('please come back');
  assert.equal(calls, 0, 'nobody to ask');
  assert.equal(r.say, '');
  // Gone (DESIGN §19.7): she still lives in Hearthvale, and will not speak to the player.
  assert.ok(/won't speak to you/.test(game.ui.chat.messages.at(-1).text) && game.ui.chat.messages.at(-1).from === 'system');

  const g2 = makeGame();
  const b2 = brainFor(g2);
  const mind = g2.companion.mind;
  mind.companionship = 'left';
  const rel = mind.relationships.get('player');
  rel.trust = 8;
  rel.fear = 50;
  g2.companion.x = g2.player.x + 30 * 16;
  const far = await b2.handlePlayerMessage('hey');
  assert.equal(far.unreachable, 'far');
  assert.ok(/too far away/.test(g2.ui.chat.messages.at(-1).text));
  g2.companion.x = g2.player.x + 3 * 16;
  const cold = await b2.handlePlayerMessage('how are you feeling?');
  assert.ok(bankTexts('left_reply').some((t) => t.replace('{player}', 'Traveler') === cold.say), `cold: ${cold.say}`);
  const order = await b2.handlePlayerMessage('follow me');
  assert.equal(g2.log.filter((a) => a.name === 'follow').length, 0, 'even without a gate, a Lyra who left refuses');
  assert.ok(bankTexts('refuse_left').includes(order.say), order.say);
  const events = [];
  g2.bus.on('apology', (p) => events.push(p));
  const rej = await b2.handlePlayerMessage("I'm sorry. I didn't mean to hurt you");
  assert.equal(events.at(-1).believed, false);
  assert.ok(bankTexts('apology_reject').some((t) => t.replace('{player}', 'Traveler') === rej.say), rej.say);
  rel.trust = 40;
  rel.fear = 20;
  b2.local.apologies = [];
  const ok = await b2.handlePlayerMessage('please forgive me');
  assert.equal(events.at(-1).believed, true);
  assert.ok(bankTexts('apology_believed_left').includes(ok.say), ok.say);
  const mem = mind.calls.remember.at(-1);
  assert.ok(mem[1].tags.includes('apology') && mem[1].tags.includes('believed'));

  const g3 = makeGame();
  const b3 = brainFor(g3);
  g3.companion.mind.companionship = 'wary';
  const greet = await b3.handlePlayerMessage('hi');
  assert.ok(bankTexts('wary_greet').some((t) => t.replace('{player}', 'Traveler') === greet.say), greet.say);
  const flirt = await b3.handlePlayerMessage('you are beautiful');
  assert.ok(bankTexts('flirt_wary').includes(flirt.say), flirt.say);
});

test('speech_gen: lines keyed by companionship state, trust and fear; guarded address', () => {
  const sg = new SpeechGen();
  const bank = [{ t: 'Cold.', state: 'left' }, { t: 'Warm.', state: ['together', 'apart'] }, { t: 'Scared.', minFear: 50 }];
  for (let i = 0; i < 6; i++) assert.equal(sg.lineFrom('t1', bank, {}, { state: 'left', fear: 0 }), 'Cold.');
  for (let i = 0; i < 6; i++) assert.equal(sg.lineFrom('t2', bank, {}, { state: 'together', fear: 0 }), 'Warm.');
  const seen = new Set();
  for (let i = 0; i < 8; i++) seen.add(sg.lineFrom('t3', bank, {}, { state: 'wary', fear: 60 }));
  assert.deepEqual([...seen], ['Scared.']);
  for (let i = 0; i < 10; i++) assert.equal(sg.expand('{you}', {}, { state: 'wary', bond: 5, playerName: 'Ash' }), 'Ash', 'no endearments when guarded');
  for (const k of ['refuse_generic', 'refuse_danger', 'counter_offer', 'accept_condition', 'apology_reject', 'leaving', 'returning', 'wary_reply', 'left_reply', 'deed_hit', 'fear_bark']) {
    assert.ok(LINES[k]?.length >= 3, `${k} has several variants`);
  }
  const made = new Set();
  for (let i = 0; i < 5; i++) made.add(sg.line('refuse_danger', { reason: 'Wolves hunt there at night' }, { state: 'together' }));
  assert.equal(made.size, 5, 'no repeats in a row');
  for (const t of made) assert.ok(t.includes('Wolves hunt there at night') && !t.includes('{'), t);
});

test('barks: she reacts to deeds and companionship, and yields when another module spoke for her', () => {
  const game = makeGame();
  const brain = brainFor(game);
  const said = game.bubbles.said;
  game.bus.emit('deed', { deed: 'hit_lyra', severity: -3, text: 'hit me with a sword', victim: game.companion });
  game.time += 0.5;
  brain.update(1 / 60);
  assert.ok(bankTexts('deed_hit').includes(said.at(-1)), said.at(-1));
  game.time += 3;
  game.companion.mind.companionship = 'left';
  game.bus.emit('companionship_changed', { state: 'left', previous: 'wary', reason: 'they kept hurting me' });
  game.time += 0.5;
  brain.update(1 / 60);
  assert.ok(bankTexts('leaving').includes(said.at(-1)), said.at(-1));
  assert.equal(brain.lastCompanionshipReason, 'they kept hurting me');
  const n = said.length;
  game.time += 5;
  game.bus.emit('attack', { attacker: game.entities.get('w1'), kind: 'bite', target: game.player });
  game.bus.emit('damage', { source: game.entities.get('w1'), target: game.player, amount: 30, kind: 'bite' });
  brain.update(1 / 60);
  assert.ok(!said.slice(n).some((t) => bankTexts('player_hurt').includes(t)), 'no companion lines after she left');

  const g2 = makeGame();
  const b2 = brainFor(g2);
  g2.bus.emit('companionship_changed', { state: 'wary', previous: 'together', reason: 'x' });
  g2.bus.emit('speech', { speaker: g2.companion, text: 'What are you doing?!', kind: 'say' });
  g2.time += 1.5;
  b2.update(1 / 60);
  assert.equal(g2.bubbles.said.length, 0, 'her own line already said it');
});

test('"yes" to something she asked of the player becomes their promise; "no" is heard', async () => {
  const game = makeGame();
  const brain = brainFor(game);
  game.actions.run('request', { value: 'Buy me a honey cake and I will forgive the mud' }, 'self');
  const r = await brain.handlePlayerMessage('sure');
  const p = game.log.find((a) => a.name === 'promise');
  assert.ok(p && p.args.target === 'player' && /honey cake/.test(p.args.value), 'the player promised');
  assert.equal(game.actions.history.find((h) => h.name === 'promise').source, 'local');
  assert.ok(bankTexts('ack_promise').includes(r.say), r.say);
  game.actions.run('request', { value: 'Walk me to the chapel' }, 'self');
  const n = await brain.handlePlayerMessage('no');
  assert.ok(bankTexts('ask_declined').map((t) => t.replace('{you}', 'Traveler')).includes(n.say) || n.say.length > 3, n.say);
  assert.equal(game.log.filter((a) => a.name === 'promise').length, 1);
});

test('prompt: her will in the dynamic context (§16.10), recall instead of dumps (§17.3), stable rules', () => {
  const game = makeGame();
  const mind = game.companion.mind;
  const rules0 = buildRules(game);
  mind.companionship = 'wary';
  Object.assign(mind.relationships.get('player'), { trust: 22, fear: 31, affinity: -4 });
  mind.ledger = [
    { t: 400, day: 2, deed: 'hit_lyra', severity: -3, text: 'Struck me with their sword, on purpose.' },
    { t: 450, day: 2, deed: 'gift_loved', severity: 2, text: 'Gave me a honey cake.' },
  ];
  mind.agenda = { purse: 14, today: [{ from: 13, to: 17, activity: 'work', at: 'herbalist', why: 'Mira pays for silverleaf' }, { from: 18, to: 19, activity: 'eat', at: 'ember_kettle', why: 'Stew' }] };
  mind.promises = [{ text: 'Buy me a honey cake', by: 'player', state: 'open', due: 3 }, { text: 'Old one', by: 'lyra', state: 'kept' }];
  const asked = [];
  mind.recallContext = (text, opts) => {
    asked.push(opts.budget);
    return { text: 'On her mind now:\n- [m2] Bram paid fairly for the pelts.', items: [{ id: 'm2', store: 'episode', label: 'Bram paid fairly' }] };
  };
  const { rules, context } = buildChatPrompt(game, 'will you help me?', [], { requests: [{ text: 'explore the ruins', name: 'explore', args: { target: 'sunken_ruins' }, verdict: verdict('refuse', ['the ruins are deadly at night', 'she is wary of you']) }] });
  assert.equal(rules, rules0, 'how things stand never enters the stable rules');
  assert.equal(asked[0], 3500, 'recallContext asked with the §17.3 budget');
  for (const bit of ['Companionship: wary', 'trust 22/100', 'fear 31/100', 'affinity -4', 'hit_lyra (-3)', 'Struck me with their sword', 'gift_loved (+2)', 'Your purse: 14 coins', '1 PM-5 PM: work at herbalist (Mira pays for silverleaf)', 'Open promises:', 'Buy me a honey cake', '[m2] Bram paid fairly']) {
    assert.ok(context.includes(bit), `context has "${bit}"`);
  }
  assert.ok(!context.includes('Old one'), 'kept promises are not open');
  assert.ok(context.includes('your gut says: refuse, because the ruins are deadly at night, and she is wary of you'), 'gut verdict');
  assert.ok(!/\b(?:AI|language model)\b/.test(rules.replace('Never mention being an AI, a model', '')), 'no AI talk beyond the rule against it');
  assert.ok(/PG-13/.test(rules) && /JSON/.test(rules));
  // A long soul stays inside its caps; the rules never swallow the context budget.
  mind.soul = { name: 'Lyra', backstory: 'She walked. '.repeat(400), values: Array.from({ length: 40 }, (_, i) => `value number ${i}`), likes: Array.from({ length: 50 }, (_, i) => `like ${i}`), secrets: Array.from({ length: 9 }, (_, i) => ({ text: `secret ${i} `.repeat(40), revealAtBond: 3 })) };
  const long = buildChatPrompt(game, 'hello', []);
  assert.ok(long.rules.length < 9600, `rules ${long.rules.length}`);
  assert.ok(long.rules.length + long.context.length <= PROMPT_BUDGET + 200, `whole ${long.rules.length + long.context.length}`);
});

test('a stand-in consent gate asks her mind when her will installed none (§16.4)', async () => {
  const game = makeGame();
  const brain = brainFor(game);
  const mind = game.companion.mind;
  const reqs = [];
  mind.evaluateRequest = (req) => {
    reqs.push(req);
    if (req.action === 'set_combat_mode') return verdict('refuse', ['trust in you is low (4)'], 'No. That gets one of us killed.');
    return verdict('accept', [], '');
  };
  assert.equal(game.actions.consentGate, undefined);
  game.bus.emit('game_start', { loaded: false });
  assert.equal(typeof game.actions.consentGate, 'function', 'installed once the world runs');
  const r = await brain.handlePlayerMessage('attack mode');
  assert.equal(game.log.filter((a) => a.name === 'set_combat_mode').length, 0, 'refused, never run');
  assert.equal(r.say, 'No. That gets one of us killed.');
  assert.ok(!bankTexts('stance_attack').includes(r.say), 'never an acknowledgement');
  const why = await brain.handlePlayerMessage('why not?');
  assert.ok(/I don't trust you enough right now/.test(why.say) && !/\(4\)/.test(why.say), why.say);
  await brain.handlePlayerMessage("I'll pay you 10 coins to follow me");
  const pay = reqs.find((q) => q.action === 'follow');
  assert.equal(pay.pay, 10, 'the offer reaches her mind');
  assert.equal(pay.source, 'player');
  // Her will's own gate, installed later, replaces the stand-in and is never overwritten.
  const own = () => null;
  game.actions.setConsentGate(own);
  game.bus.emit('game_start', { loaded: true });
  await brain.handlePlayerMessage('stay here');
  assert.equal(game.actions.consentGate, own);
});

test("her own questions are answered from her will even when a plugin matched the words first", async () => {
  const chatty = { id: 'chatty', intents: [{ id: 'chatty.trust', patterns: [/\bdo you trust me\b/i], confidence: 0.9, answer: () => 'PLUGIN ANSWER' }, { id: 'chatty.weather', patterns: [/\bnice weather\b/i], answer: () => 'PLUGIN WEATHER' }] };
  const game = makeGame({ plugins: [chatty] });
  const brain = brainFor(game);
  const mind = game.companion.mind;
  mind.companionship = 'wary';
  const r = await brain.handlePlayerMessage('do you trust me?');
  assert.ok(bankTexts('trust_player_wary').includes(r.say), r.say);
  const w = await brain.handlePlayerMessage('nice weather, huh');
  assert.equal(w.say, 'PLUGIN WEATHER', 'other plugin questions keep their answers');
  mind.companionship = 'together';
  mind.ledger = [];
  Object.assign(mind.relationships.get('player'), { trust: 32, fear: 0 });
  const early = await brain.handlePlayerMessage('do you trust me?');
  assert.ok(bankTexts('trust_player_new').includes(early.say), `early days, nothing went wrong: ${early.say}`);
  mind.agenda = { today: [{ from: 0, to: 24, activity: 'travel', why: 'Out with you, listening for Maren' }] };
  const plan = await brain.handlePlayerMessage('what are your plans today?');
  assert.ok(/on the road with you/.test(plan.say) && /listening for Maren/.test(plan.say), plan.say);
});

test('her words: first person, reasons against, places without company, distinct diary memories', () => {
  assert.equal(toFirstPerson('Lyra came north alone to find her.'), 'I came north alone to find her.');
  assert.equal(toFirstPerson('Maren took her as an apprentice when she was twelve.'), 'Maren took me as an apprentice when I was twelve.');
  assert.equal(toFirstPerson('She could not save her little brother.'), 'I could not save my little brother.');
  assert.equal(firstPersonReason('she is afraid of you (41)'), "I'm afraid of you");
  assert.deepEqual(reasonsAgainst(['she trusts you (70)', 'it’s late', '20 coins offered']), ['it’s late']);
  assert.equal(refusalSituation(verdict('refuse', ['she trusts you (70)', 'too dangerous at night'])), 'refuse_danger');
  assert.equal(cleanRef('the sunken ruins with me tonight'), 'sunken ruins');
  const game = makeGame();
  const parsed = parseMessage('come with me to the forest?', envFor(game));
  assert.equal(parsed.commands[0].intent.actions[0].name, 'follow');
  const lets = parseMessage("let's go to the inn", envFor(game));
  assert.deepEqual(lets.commands[0].intent.actions[0].args, { target: 'inn', value: 'follow', amount: null });
  const mem = (text, importance) => ({ text, importance, emotion: 'joy', about: ['player'] });
  const d = composeDiary(game, [mem('The traveler gave me a honey cake. I could have cried.', 7), mem('Then the traveler gave me honey cake. I could have cried.', 6), mem('Bram showed me his forge.', 5)], { day: 2, rnd: () => 0 });
  assert.equal((d.text.match(/honey cake/g) || []).length, 1, d.text);
  assert.ok(/Bram showed me his forge/i.test(d.text));
});
