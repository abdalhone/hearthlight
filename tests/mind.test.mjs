import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EventBus } from '../src/core/events.js';
import { RNG } from '../src/core/rng.js';
import { GameClock } from '../src/core/time.js';
import { DAY_SECONDS, TILE } from '../src/core/constants.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { EntityManager } from '../src/entities/manager.js';
import { Actor } from '../src/entities/entity.js';
import { Inventory } from '../src/entities/items.js';
import { NPC_PROFILES } from '../src/entities/npc_data.js';
import { Combat } from '../src/entities/combat.js';
import { generateWorld } from '../src/world/worldgen.js';
import { ActionRegistry } from '../src/ai/brain/actions.js';
import { PluginRegistry } from '../src/ai/plugins/registry.js';
import { parseMessage } from '../src/ai/brain/nlu.js';

import { Mind } from '../src/ai/mind/mind.js';
import { bondOf, BOND_LABELS, makeRel } from '../src/ai/mind/relationships.js';
import { WorkingMemory } from '../src/ai/mind/working_memory.js';
import { relationshipsPlugin } from '../src/ai/plugins/relationships_plugin.js';
import { memoryPlugin } from '../src/ai/plugins/memory_plugin.js';
import { feelingsPlugin } from '../src/ai/plugins/feelings_plugin.js';
import { socialPlugin, socialState } from '../src/ai/plugins/social_plugin.js';
import { questPlugin } from '../src/ai/plugins/quest_plugin.js';

const MIND_PLUGINS = [relationshipsPlugin, memoryPlugin, feelingsPlugin, socialPlugin, questPlugin];

// ------------------------------------------------------------------ a small real world

// One generated Hearthvale shared by every test (the map, objects and places are read only).
const WORLD = (() => {
  const g = { bus: new EventBus(), rng: new RNG(7), flags: {}, time: 0, clock: { t: 300, hour: 8, daylight: 1, weather: { type: 'clear' } }, entities: { list: [], nearest: () => null }, atlas: null, ui: null };
  return generateWorld(g, 1337);
})();

function fakeBubbles() {
  return {
    said: [],
    thoughts: [],
    icons: [],
    say(e, text) {
      this.said.push({ id: e?.id, text });
    },
    thought(e, text) {
      this.thoughts.push({ id: e?.id, text });
    },
    icon(e, name) {
      this.icons.push({ id: e?.id, name });
    },
    isBusy: () => false,
    clear() {},
  };
}

// Lyra's behavior as far as the mind cares: a directive, a stance, orders it accepts.
function fakeBehavior() {
  return {
    directive: { type: 'follow', target: 'player', distance: 'normal' },
    stance: 'defend',
    currentTarget: null,
    log: [],
    setDirective(d) {
      this.directive = { ...d };
      this.log.push(this.directive);
      return { ok: true, message: '' };
    },
    status() {
      return 'following you';
    },
    emote() {},
  };
}

function villager(game, id, x, y) {
  const profile = NPC_PROFILES.find((p) => p.id === id);
  const a = new Actor(game, { id, name: profile.name, faction: profile.faction || 'villager', x, y, maxHp: 40 });
  a.profile = profile;
  a.role = profile.role;
  a.said = [];
  a.say = (text) => a.said.push(text);
  return a;
}

function creature(game, species, x, y, o = {}) {
  const hostile = { wolf: 'monster', slime: 'monster', bandit: 'bandit', skeleton: 'undead' }[species];
  const a = new Actor(game, { id: o.id || `${species}_${Math.round(x)}_${Math.round(y)}`, name: o.name || species[0].toUpperCase() + species.slice(1), kind: 'animal', faction: o.faction || hostile || 'wildlife', x, y, maxHp: 20 });
  a.species = species;
  a.threat = hostile ? 1 : 0;
  return game.entities.add(a);
}

function makeGame({ plugins = true, hour = 9, playing = true } = {}) {
  const bus = new EventBus();
  const game = {
    bus,
    rng: new RNG(42),
    time: 1,
    state: playing ? 'playing' : 'title',
    flags: {},
    settings: { ...DEFAULT_SETTINGS, showThoughts: true },
    map: WORLD.map,
    objects: WORLD.objects,
    locations: WORLD.locations,
    spawns: WORLD.spawns,
    bubbles: fakeBubbles(),
    ui: { chat: { messages: [], addMessage(m) { this.messages.push(m); }, isOpen: () => false }, toast() {} },
  };
  game.clock = new GameClock(game);
  game.clock.t = (hour / 24) * DAY_SECONDS;
  game.entities = new EntityManager(game);
  game.combat = new Combat(game);
  game.actions = new ActionRegistry(game);
  game.plugins = new PluginRegistry(game);
  const home = WORLD.spawns.player;
  game.player = game.entities.add(new Actor(game, { id: 'player', name: 'Traveler', faction: 'player', x: home.x, y: home.y, maxHp: 50 }));
  const lyra = new Actor(game, { id: 'lyra', name: 'Lyra', faction: 'player', x: home.x + 12, y: home.y, maxHp: 45, inventory: new Inventory({ potion: 1, coin: 8 }) });
  lyra.behavior = fakeBehavior();
  game.companion = game.entities.add(lyra);
  lyra.mind = new Mind(game, lyra);
  if (plugins) {
    for (const p of MIND_PLUGINS) game.plugins.register(p);
    game.plugins.installAll();
  }
  return { game, lyra, mind: lyra.mind, player: game.player };
}

// Advance the world: the clock, then the mind and plugins, in small steps.
function run(game, seconds, step = 0.1) {
  for (let t = 0; t < seconds - 1e-9; t += step) {
    game.time += step;
    game.clock.t += step;
    game.companion.mind.update(step);
    game.plugins.update(step);
  }
}

// ------------------------------------------------------------------ the §9 interface and her first day

test('the Mind has the full §9 interface and starts as herself', () => {
  const { mind, game } = makeGame();
  for (const k of ['soul', 'emotions', 'needs', 'memory', 'relationships', 'goals', 'thoughts', 'diary', 'conversation', 'knowledge']) assert.ok(mind[k] != null, `mind.${k}`);
  for (const f of ['update', 'perceive', 'addThought', 'feel', 'mood', 'remember', 'recall', 'learn', 'addGoal', 'completeGoal', 'describeState', 'summary', 'serialize', 'deserialize', 'recallContext', 'dossier', 'loreLookup', 'evaluateRequest', 'setCompanionship', 'reconsider', 'recordDeed']) {
    assert.equal(typeof mind[f], 'function', `mind.${f}()`);
  }
  for (const e of ['joy', 'sadness', 'fear', 'anger', 'trust', 'surprise', 'affection', 'curiosity', 'pride', 'embarrassment']) assert.ok(mind.emotions[e] >= 0 && mind.emotions[e] <= 1);
  for (const n of ['energy', 'hunger', 'social', 'fun', 'safety']) assert.ok(mind.needs[n] > 0.5 && mind.needs[n] <= 1);

  const s = mind.soul;
  assert.equal(s.name, 'Lyra');
  assert.equal(s.age, 24);
  assert.equal(s.pronouns, 'she/her');
  assert.match(s.origin, /Glasswater Isles/);
  assert.match(s.backstory, /Maren Ashgrove/);
  assert.match(s.backstory, /Cal/);
  assert.match(s.backstory, /her own reasons|her choice/i, 'she travels with the player by her own choice');
  for (const k of ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism']) assert.ok(s.personality[k] >= 0 && s.personality[k] <= 1);
  assert.ok(s.values.some((v) => /her own|own road/i.test(v)), 'her life is her own');
  assert.ok(s.likes.some((v) => /moonpetal/.test(v)) && s.likes.some((v) => /honey cake/.test(v)));
  assert.ok(s.fears.some((v) => /water/.test(v)));
  assert.ok(s.secrets.some((x) => /Cal/.test(x.text)));

  // The player: a debt, a little trust, curiosity (DESIGN §9, §16).
  const p = mind.relationships.get('player');
  assert.deepEqual([p.affinity, p.trust, p.respect, p.familiarity, p.fear], [25, 20, 25, 15, 0]);
  assert.ok(p.opinion.length > 40);
  assert.equal(bondOf(p).label, 'Acquaintance');
  // Maren: the mother she chose, absent.
  const maren = mind.relationships.get('maren');
  assert.ok(maren.absent && maren.tags.includes('mentor') && maren.affinity >= 90);
  // First memories, pinned; goals from her soul; lore she knows.
  assert.ok(mind.memory.all().some((m) => /wolf pack/.test(m.text) && m.importance >= 9 && m.pinned));
  assert.ok(mind.memory.all().some((m) => /Little lamp/.test(m.text)), "Maren's letter, word for word");
  assert.equal(mind.goals.find((g) => g.id === 'find_maren').source, 'soul');
  assert.ok(mind.knowsLore('waygates'));
  assert.ok(mind.life.length >= 8 && mind.life[0].age === 0);
  assert.ok(mind.autonomy, 'her own will is wired in');
  assert.equal(mind.companionship, 'together');
  assert.ok(Array.isArray(mind.ledger) && Array.isArray(mind.promises) && mind.agenda && Number.isFinite(mind.agenda.purse));
  const v = mind.evaluateRequest({ action: 'follow', args: { target: 'player' }, source: 'player' });
  assert.ok(['accept', 'accept_conditional', 'counter', 'refuse', 'refuse_and_act'].includes(v.decision));
  const desc = mind.describeState();
  assert.match(desc, /Lyra feels/);
  assert.ok(desc.length < 900);
  const sum = mind.summary();
  assert.equal(sum.name, 'Lyra');
  assert.ok(sum.mood.label && sum.emoji);
  assert.equal(game.state, 'playing');
});

// ------------------------------------------------------------------ friends and enemies (attack-mode filter)

test('isFriend / isEnemy follow DESIGN §9 exactly', () => {
  const { game, mind, lyra, player } = makeGame({ plugins: false });
  const rels = mind.relationships;
  const at = (x) => WORLD.spawns.player.x + x;
  const y = WORLD.spawns.player.y + 200;
  const bram = game.entities.add(villager(game, 'bram', at(0), y));
  const rowan = game.entities.add(villager(game, 'rowan', at(20), y));
  const wolf = creature(game, 'wolf', at(40), y);
  const bandit = creature(game, 'bandit', at(60), y);
  const skeleton = creature(game, 'skeleton', at(70), y);
  const deer = creature(game, 'deer', at(80), y);
  const cat = creature(game, 'cat', at(100), y, { name: 'Stray cat' });
  const boar = creature(game, 'boar', at(120), y);
  const slime = creature(game, 'slime', at(140), y);
  const named = creature(game, 'wolf', at(160), y, { name: 'Greyjaw', id: 'greyjaw' });

  const row = (e) => [rels.isFriend(e), rels.isEnemy(e)];
  assert.deepEqual(row(player), [true, false], 'the player');
  assert.deepEqual(row(lyra), [true, false], 'herself');
  assert.deepEqual(row(bram), [true, false], 'a villager');
  assert.deepEqual(row(rowan), [true, false], 'a guard');
  assert.deepEqual(row(wolf), [false, true], 'a hostile monster');
  assert.deepEqual(row(bandit), [false, true], 'a bandit');
  assert.deepEqual(row(skeleton), [false, true], 'the undead');
  assert.deepEqual(row(deer), [false, false], 'wild animals are neither');
  assert.deepEqual(row(cat), [false, false], 'a cat she has not adopted is not yet a friend');

  // Tagged enemy: never a friend, even a villager.
  rels.ensure(bram);
  rels.setTag('bram', 'enemy');
  assert.deepEqual(row(bram), [false, true], 'a villager tagged enemy');
  rels.setTag('bram', 'friend');
  assert.deepEqual(row(bram), [true, false], 'friend replaces enemy');
  assert.ok(!rels.get('bram').tags.includes('enemy'));

  // Pets are friends; adoption replaces nothing else.
  rels.ensure(cat);
  rels.setTag(cat.id, 'pet');
  assert.deepEqual(row(cat), [true, false], 'a pet');

  // Affinity >= 30 makes a friend of anyone; <= -40 an enemy of anyone not otherwise a friend.
  rels.ensure(deer);
  rels.adjust(deer.id, { affinity: 30 });
  assert.deepEqual(row(deer), [true, false], 'affinity 30');
  rels.adjust(deer.id, { affinity: -1 });
  assert.deepEqual(row(deer), [false, false], 'affinity 29');
  rels.ensure(boar);
  rels.adjust(boar.id, { affinity: -40 });
  assert.deepEqual(row(boar), [false, true], 'affinity -40');
  // A hostile kind she has come to like is still spared.
  rels.ensure(named);
  rels.adjust('greyjaw', { affinity: 45 });
  assert.deepEqual(row(named), [true, false], 'a wolf she likes');

  // A whole kind: tags on 'species:x' / 'faction:x' apply to every member; individuals outrank them.
  rels.ensure('species:wolf', { name: 'Wolves', kind: 'group' });
  rels.setTag('species:wolf', 'friend');
  assert.deepEqual(row(wolf), [true, false], 'wolves marked friends');
  rels.setTempTag(wolf, 'enemy');
  assert.deepEqual(row(wolf), [false, true], 'but this wolf bit her');
  rels.ensure('faction:monster', { name: 'Monsters', kind: 'group' });
  rels.setTag('faction:monster', 'enemy');
  rels.setTag('species:wolf', 'friend', false);
  assert.deepEqual(row(slime), [false, true]);

  // A villager she dislikes is still never a target, and the two filters never disagree.
  rels.ensure(rowan);
  rels.adjust('rowan', { affinity: -60 });
  assert.deepEqual(row(rowan), [true, false], 'villagers unless tagged enemy');
  for (const e of game.entities.all()) assert.ok(!(rels.isFriend(e) && rels.isEnemy(e)), `${e.id} is not both`);
  // By id too.
  assert.equal(rels.isFriend('player'), true);
  assert.equal(rels.isEnemy(bandit.id), true);
});

// ------------------------------------------------------------------ relationship math and bond labels

test('relationship math: clamps, rounding, history, notes, opinions and events', () => {
  const { game, mind } = makeGame({ plugins: false });
  const rels = mind.relationships;
  const events = [];
  game.bus.on('relationship_changed', (p) => events.push(p));
  const bram = game.entities.add(villager(game, 'bram', 0, 0));
  const r = rels.ensure(bram);
  assert.equal(r.name, 'Bram Ironhand');
  assert.equal(r.role, 'blacksmith');
  assert.equal(r.npc, true);
  assert.equal(rels.get('Bram'), r, 'by first name');
  assert.equal(rels.get('bram ironhand'), r, 'by full name');

  rels.adjust('bram', { affinity: 250, trust: -80, respect: 12.345, fear: 5 }, 'Mended my dagger');
  assert.equal(r.affinity, 100);
  assert.equal(r.trust, 0);
  assert.equal(r.respect, 27.3);
  assert.equal(r.fear, 5);
  rels.adjust('bram', { affinity: -400 });
  assert.equal(r.affinity, -100);
  assert.ok(r.history.some((h) => /Mended my dagger/.test(h)), 'reasons go to history');
  assert.equal(events.at(-1).personId, 'bram');
  assert.ok(events.some((e) => e.reason === 'Mended my dagger' && e.changes.affinity > 0));

  const n1 = rels.addNote('bram', 'Writes poems at night.', 'told');
  const n2 = rels.addNote('bram', 'writes poems at night', 'player');
  assert.equal(n1, n2, 'the same note is not kept twice');
  assert.equal(n1.source, 'player');
  for (let i = 0; i < 20; i++) rels.addNote('bram', `Fact number ${i}.`, 'observed');
  assert.ok(r.notes.length <= 10);
  assert.ok(r.notes.some((n) => n.source === 'player'), "the player's notes are kept longest");

  rels.setOpinion('bram', 'Gruff as a bear, kind as one too.', 'brain');
  assert.equal(r.opinion, 'Gruff as a bear, kind as one too.');
  rels.adjust('bram', { affinity: 150 });
  assert.equal(r.opinion, 'Gruff as a bear, kind as one too.', "the brain's words stand for a day");
  game.clock.t += DAY_SECONDS * 1.5;
  rels.adjust('bram', { affinity: -60 });
  assert.notEqual(r.opinion, 'Gruff as a bear, kind as one too.', 'then she makes up her own mind again');
  assert.equal(rels.adjust('nobody-at-all', { affinity: 5 }), null);
});

test('bond labels by score', () => {
  assert.deepEqual(BOND_LABELS, ['Stranger', 'Acquaintance', 'Companion', 'Friend', 'Close friend', 'Kindred spirit']);
  const rel = (o) => ({ ...makeRel('x'), ...o });
  assert.equal(bondOf(rel({ affinity: 0, trust: 0, respect: 0, familiarity: 0 })).label, 'Stranger');
  assert.equal(bondOf(rel({ affinity: 25, trust: 20, respect: 25, familiarity: 15 })).label, 'Acquaintance');
  assert.equal(bondOf(rel({ affinity: 40, trust: 40, respect: 30, familiarity: 40 })).label, 'Companion');
  assert.equal(bondOf(rel({ affinity: 60, trust: 55, respect: 50, familiarity: 60 })).label, 'Friend');
  assert.equal(bondOf(rel({ affinity: 80, trust: 75, respect: 60, familiarity: 75 })).label, 'Close friend');
  assert.equal(bondOf(rel({ affinity: 100, trust: 95, respect: 90, familiarity: 95 })).label, 'Kindred spirit');
  // Fear and hatred pull a bond down.
  assert.ok(bondOf(rel({ affinity: 60, trust: 55, respect: 50, familiarity: 60, fear: 80 })).level < 3);
  assert.equal(bondOf(rel({ affinity: -80, trust: 10, respect: 10, familiarity: 90 })).label, 'Stranger');
  const b = bondOf(rel({ affinity: 60, trust: 55, respect: 50, familiarity: 60 }));
  assert.ok(b.level === 3 && b.score > 45 && b.score < 62);
});

// ------------------------------------------------------------------ memory and recall

test('recall: relevance beats recency, and "the blacksmith" finds Bram', () => {
  const { game, mind } = makeGame({ plugins: false });
  game.entities.add(villager(game, 'bram', 0, 0));
  mind.relationships.ensure('bram').firstMet = game.clock.t;
  const t0 = game.clock.t;
  mind.remember('Bram fixed the notch in my dagger and would not take a single coin for it.', { importance: 4, about: ['bram'], t: t0 - 3 * DAY_SECONDS, day: 1 });
  mind.remember('A pack of wolves chased us through the Whisperwood at dusk.', { importance: 5, tags: ['wolves'], location: 'whisperwood', t: t0 - 4 * DAY_SECONDS, day: 1 });
  for (let i = 0; i < 30; i++) mind.remember(`Walked past the well and counted ${i + 3} pigeons on the roof.`, { importance: 3, location: 'town_square' });
  mind.remember('Mira sold me silverleaf and blushed when the Captain walked by.', { importance: 4, about: ['mira'] });

  const smith = mind.recall('the blacksmith');
  assert.ok(smith.length >= 1);
  assert.match(smith[0].text, /Bram fixed the notch/, 'entity linking: a role finds the person');
  assert.match(mind.recall('what do you remember about the wolves?')[0].text, /wolves chased us|wolf pack/);
  assert.match(mind.recall('Mira')[0].text, /silverleaf/);
  // Relevance beats recency: dozens of fresh pigeons do not bury an old fight.
  assert.ok(!/pigeons/.test(mind.recall('wolves')[0].text));
  // An empty query lists what matters most; 'today' lists today.
  assert.ok(mind.recall('', { limit: 3 }).length === 3);
  assert.ok(mind.recall('today').every((m) => m.day === game.clock.day));
  // Other stores on request: her past, her knowledge.
  const life = mind.recall('my little brother Cal', { stores: ['life'] });
  assert.equal(life[0].store, 'life');
  assert.ok(life.some((h) => h.id === 'cal_dies'));
  const know = mind.recall('waygates', { stores: ['knowledge'] });
  assert.equal(know[0].ref.loreId, 'waygates');
  // Theories stay theories.
  const th = mind.learn('The humming stones', 'The ruins hum because the gate under them is still alive.', { kind: 'theory', source: 'inferred' });
  mind.learn('The humming stones', 'The ruins hum because the gate under them is still alive.', { kind: 'fact', source: 'told', confidence: 1 });
  assert.equal(th.kind, 'theory');
  assert.ok(th.confidence <= 0.5);
});

test('working memory: at most twelve, decaying, fed by perception', () => {
  let now = 0;
  const wm = new WorkingMemory({ now: () => now });
  for (let i = 0; i < 20; i++) wm.activate(`place:p${i}`, { amount: 0.3 + i * 0.03 });
  assert.equal(wm.size, 12);
  assert.ok(wm.has('place:p19') && !wm.has('place:p0'), 'the weakest falls out');
  const a = wm.activationOf('place:p19');
  wm.activate('place:p19', { amount: 0.4 });
  assert.ok(wm.activationOf('place:p19') >= a && wm.activationOf('place:p19') <= 1, 'saturates, never over 1');
  wm.decay(120);
  assert.ok(Math.abs(wm.activationOf('place:p19') - Math.max(a, 0.4) * 0.5) < 0.1, 'half-life of two minutes');
  now = 500;
  wm.decay(600);
  assert.equal(wm.size, 0, 'everything fades without a reminder');

  // In the game: places and faces bring things to mind.
  const { game, mind, lyra } = makeGame();
  run(game, 1);
  assert.ok(mind.workingMemory.list().some((it) => it.key.startsWith('place:')), 'where she is');
  const bram = game.entities.add(villager(game, 'bram', lyra.x + 30, lyra.y));
  run(game, 3);
  assert.ok(mind.workingMemory.has('person:bram'), 'a face she just met');
  assert.ok(mind.workingMemory.size <= 12);
  game.bus.emit('player_message', { text: 'Do you think Maren went to the Sunken Ruins?' });
  assert.ok(mind.workingMemory.has('person:maren') && mind.workingMemory.has('place:sunken_ruins'), 'topics in conversation');
  assert.ok(bram);
});

test('recallContext stays under budget, grouped, with ids that resolve', () => {
  const { game, mind } = makeGame();
  game.entities.add(villager(game, 'bram', 0, 0));
  mind.relationships.ensure('bram').firstMet = 1;
  for (let i = 0; i < 80; i++) mind.remember(`Day of work ${i}: chopped wood by the Whisperwood, and the wolves howled at dusk while Bram's forge rang.`, { importance: 3 + (i % 6), about: i % 2 ? ['bram'] : [], tags: ['wolves'] });
  const msg = 'what do you remember about the wolves?';
  for (const budget of [3500, 1500, 600, 200]) {
    const r = mind.recallContext(msg, { budget });
    assert.ok(r.text.length <= budget, `${r.text.length} <= ${budget}`);
    assert.ok(Array.isArray(r.items));
    for (const it of r.items) {
      assert.ok(it.id && it.store && it.label, 'each item has id, store and label');
      assert.ok(mind.lookup(it.id), `${it.id} resolves`);
      assert.ok(r.text.includes(`[${it.id}]`), `${it.id} is cited in the text`);
    }
  }
  const full = mind.recallContext(msg);
  assert.ok(full.text.length <= 3500 && full.text.length > 300);
  assert.match(full.text, /Memories:/);
  assert.match(full.text, /wol(f|ves)/i);
  assert.match(full.text, /wolf pack/, "her first memory of the wolves is not buried under a hundred small ones");
  assert.match(full.text, /What she knows:/);
  assert.ok(new Set(full.items.map((i) => i.id)).size === full.items.length, 'deduped');
  assert.ok(mind.recallContext('').text.length <= 3500);
  const d = mind.dossier('the blacksmith');
  assert.equal(d.id, 'bram');
  assert.ok(d.memories.length >= 1 && d.text.length <= 900);
  assert.equal(mind.dossier('nobody we know'), null);
  const lore = mind.loreLookup('Maren');
  assert.equal(lore.entries[0].subject, 'Maren Ashgrove');
});

test('life memories are never pruned and the save stays under 150 KB', () => {
  const { game, mind } = makeGame();
  const lifeBefore = mind.life.map((e) => e.id);
  const pinned = mind.memory.all().filter((m) => m.pinned).map((m) => m.id);
  for (let i = 0; i < 1200; i++) {
    game.clock.t += 40;
    mind.remember(`A long, ordinary afternoon number ${i}: I watched ${i % 7} clouds and named each one after a fish from the lagoon at home.`, { importance: 1 + (i % 5), tags: ['clouds', `n${i}`] });
  }
  for (let i = 0; i < 400; i++) mind.learn(`Rumor ${i}`, `Someone at the Kettle swears the well water tastes of iron on day ${i}.`, { kind: 'rumor', source: 'told' });
  for (let i = 0; i < 30; i++) mind.addDiary(`Day ${i}. ${'Rain and roads and honey cakes. '.repeat(40)}`, i + 1);
  for (let i = 0; i < 60; i++) mind.addConversation(i % 2 ? 'player' : 'lyra', `Line ${i}: ${'so many words '.repeat(20)}`);
  mind.consolidate();
  const data = mind.serialize();
  const size = JSON.stringify(data).length;
  assert.ok(size < 150 * 1024, `save is ${size} bytes`);
  assert.deepEqual(mind.life.map((e) => e.id), lifeBefore, 'her life is untouched');
  for (const id of pinned) assert.ok(mind.memory.get(id), `first memory ${id} kept`);
  assert.ok(!JSON.stringify(data).includes('lighthouse keeper\'s cottage'), 'her life story is not in the save (it comes from the story)');
  assert.ok(mind.memory.size <= 240);
});

test('serialize round trip', () => {
  const a = makeGame();
  const m = a.mind;
  const bram = a.game.entities.add(villager(a.game, 'bram', a.lyra.x + 20, a.lyra.y));
  m.perception.meet(bram);
  m.remember('Bram showed me how he tempers a blade, and hummed while he did it.', { importance: 6, about: ['bram'] });
  m.learn('Bram Ironhand', 'Bram writes poems by forge-light.', { kind: 'fact', source: 'told', from: 'bram', about: ['bram'] });
  m.learnPlace('mirror_lake');
  m.addGoal('Bring Mira a moonpetal', 0.5, 'player');
  m.addDiary('Day 1. A good day, mostly.', 1);
  m.addConversation('player', 'Hello there.');
  m.relationships.setTag('bram', 'friend');
  m.feel('joy', 0.4, 'test');
  m.workingMemory.activate('place:mirror_lake', { label: 'Mirror Lake', amount: 0.9 });
  const json = JSON.parse(JSON.stringify(m.serialize()));

  const b = makeGame();
  b.mind.deserialize(json);
  const n = b.mind;
  assert.deepEqual(n.memory.all().map((x) => x.text), m.memory.all().map((x) => x.text));
  assert.deepEqual(n.knowledge.map((k) => [k.subject, k.text, k.kind, k.loreId]), m.knowledge.map((k) => [k.subject, k.text, k.kind, k.loreId]));
  assert.ok(n.knowsLore('p_mirror_lake'), 'lore saved as a reference comes back whole');
  assert.equal(n.relationships.get('bram').tags.includes('friend'), true);
  assert.equal(n.relationships.get('bram').opinion, m.relationships.get('bram').opinion);
  assert.equal(n.relationships.get('player').trust, m.relationships.get('player').trust);
  assert.ok(n.goals.some((g) => g.text === 'Bring Mira a moonpetal'));
  assert.equal(n.diary[0].text, 'Day 1. A good day, mostly.');
  assert.equal(n.conversation.at(-1).text, 'Hello there.');
  assert.ok(Math.abs(n.emotions.joy - m.emotions.joy) < 0.01);
  assert.ok(n.perception.met.has('bram'));
  assert.ok(n.workingMemory.has('place:mirror_lake'));
  assert.deepEqual(n.serialize().memory, m.serialize().memory);
  // A foreign or broken save never throws.
  b.mind.deserialize(null);
  b.mind.deserialize({ memory: 'garbage', relationships: 'x', knowledge: 5, goals: {} });
  assert.ok(b.mind.relationships.get('player'));
});

// ------------------------------------------------------------------ perception

test('perception: being hit, the player hitting her, heals and gifts', () => {
  const { game, mind, lyra, player } = makeGame();
  const pr = mind.relationships.get('player');
  const wolf = creature(game, 'wolf', lyra.x + 30, lyra.y);
  const fear0 = mind.emotions.fear;
  game.bus.emit('damage', { source: wolf, target: lyra, amount: 8, kind: 'bite', crit: false });
  assert.ok(mind.emotions.fear > fear0, 'a bite frightens her');
  assert.ok(mind.relationships.isEnemy(wolf), 'the attacker is an enemy');
  assert.ok(mind.perception.encounter, 'a fight has begun');

  // A stray swing with a wolf at her side: an accident, a little fear.
  const f0 = pr.fear;
  game.bus.emit('damage', { source: player, target: lyra, amount: 4, kind: 'melee', crit: false });
  assert.ok(pr.fear > f0 && pr.fear <= f0 + 4, 'an accident');
  // Far from any enemy, again: deliberate, and it shows.
  game.entities.remove?.(wolf);
  wolf.dead = true;
  game.time += 2;
  const f1 = pr.fear;
  game.bus.emit('damage', { source: player, target: lyra, amount: 6, kind: 'melee', crit: false });
  assert.ok(pr.fear >= f1 + 8, `a deliberate blow raises fear (${f1} -> ${pr.fear})`);
  assert.ok(mind.thoughts.some((t) => /hit me/.test(t.text)));

  // The player striking a villager frightens her too.
  const pip = game.entities.add(villager(game, 'pip', lyra.x + 40, lyra.y));
  const f2 = pr.fear;
  game.time += 30;
  game.bus.emit('damage', { source: player, target: pip, amount: 5, kind: 'melee', crit: false });
  assert.ok(pr.fear > f2, 'hurting a child');

  // Healing her earns trust; a loved gift earns affection and a memory.
  const t0 = pr.trust;
  game.time += 30;
  game.bus.emit('heal', { source: player, target: lyra, amount: 10 });
  assert.ok(pr.trust > t0);
  const a0 = pr.affinity;
  lyra.inventory.add('moonpetal', 1);
  game.bus.emit('item_given', { from: player, to: lyra, itemId: 'moonpetal', qty: 1 });
  assert.ok(pr.affinity > a0, 'a moonpetal');
  assert.ok(mind.memory.all().some((m) => /moonpetal/i.test(m.text) && m.about.includes('player')));
  assert.ok(game.bubbles.said.some((s) => s.id === 'lyra'), 'she says something about it');
  const a1 = pr.affinity;
  game.time += 5;
  game.bus.emit('item_given', { from: player, to: lyra, itemId: 'slime_gel', qty: 1 });
  assert.ok(pr.affinity < a1, 'slime gel is not a gift');

  // Kindness to a villager she sees.
  const a2 = pr.affinity;
  game.bus.emit('item_given', { from: player, to: pip, itemId: 'berries', qty: 2 });
  assert.ok(pr.affinity > a2);
  // Being revived: the biggest trust she can give.
  const t1 = pr.trust;
  game.bus.emit('revived', { entity: lyra, by: player });
  assert.ok(pr.trust >= t1 + 6);
  assert.ok(mind.memory.all().some((m) => /came back for me/.test(m.text) && m.importance >= 9));
});

test('first impressions: she meets people within ~56 px and in sight', () => {
  const { game, mind, lyra } = makeGame();
  const metEvents = [];
  game.bus.on('npc_meet', (p) => metEvents.push(p.b.id));
  const far = game.entities.add(villager(game, 'elda', lyra.x + 200, lyra.y));
  const near = game.entities.add(villager(game, 'aveline', lyra.x + 40, lyra.y));
  run(game, 1);
  assert.deepEqual(metEvents, ['aveline']);
  const rel = mind.relationships.get('aveline');
  assert.ok(rel.firstMet != null && rel.opinion.length > 20);
  assert.ok(mind.memory.all().some((m) => m.about.includes('aveline') && /Aveline/.test(m.text)));
  assert.ok(mind.thoughts.some((t) => t.source === 'meeting'));
  assert.equal(mind.relationships.get('elda'), null, 'too far to meet');
  far.x = lyra.x + 30;
  run(game, 1);
  assert.deepEqual(metEvents, ['aveline', 'elda']);
  run(game, 2);
  assert.equal(metEvents.length, 2, 'only once');
  assert.ok(near);
});

test('she eats from her own satchel when hungry, through combat.useItem', () => {
  const { game, mind, lyra } = makeGame();
  lyra.inventory.add('bread', 1);
  lyra.inventory.add('raw_fish', 2);
  const used = [];
  game.bus.on('item_used', (p) => used.push(p.itemId));
  mind.needs.hunger = 0.2;
  run(game, 3);
  assert.deepEqual(used, ['bread']);
  assert.equal(lyra.inventory.count('bread'), 0);
  assert.ok(mind.needs.hunger > 0.5);
  mind.needs.hunger = 0.1;
  run(game, 3);
  assert.equal(lyra.inventory.count('raw_fish'), 2, 'never raw fish');
});

test('spontaneous thoughts and a reminiscence come from real context, rate-limited', () => {
  const { game, mind, lyra } = makeGame();
  const seen = [];
  game.bus.on('thought', (p) => seen.push(p.text));
  run(game, 60, 0.25);
  assert.ok(seen.length >= 1, 'she thinks within a minute');
  assert.ok(seen.every((t) => !/\{|undefined|null/.test(t)), 'templates are filled');
  // Something with weight stirs an old memory: once, then not again for two minutes.
  mind._reminisce.last = -Infinity;
  const r1 = mind.notice('place:kings_road', { source: 'place', amount: 0.8 });
  const n1 = mind.thoughts.filter((t) => t.source === 'reminiscence').length;
  mind.notice('kind:wolf', { amount: 0.8 });
  mind.notice('item:moonpetal', { amount: 0.8 });
  const n2 = mind.thoughts.filter((t) => t.source === 'reminiscence').length;
  assert.ok(r1);
  assert.ok(n1 >= 1 && n2 === n1, 'at most one reminiscence every couple of minutes');
  assert.ok(lyra);
});

// ------------------------------------------------------------------ the Maren arc

test('quest arc: every stage, its event, objective and journal', () => {
  const { game, mind, lyra, player } = makeGame();
  const quests = [];
  game.bus.on('quest', (q) => quests.push(q));
  const ctx = game.plugins.ctx;
  assert.equal(questPlugin.objective(ctx), 'Settle into Hearthvale — meet the villagers.');
  for (const id of ['bram', 'elda', 'pip']) mind.perception.meet(game.entities.add(villager(game, id, lyra.x + 500, lyra.y)));
  assert.equal(quests.at(-1).stage, 'ask_aveline');
  assert.equal(questPlugin.objective(ctx), 'Ask Sister Aveline about Maren.');
  const aveline = game.entities.add(villager(game, 'aveline', lyra.x + 600, lyra.y));
  game.bus.emit('npc_topic', { npc: aveline, topic: 'maren', player });
  assert.equal(quests.at(-1).stage, 'find_key');
  assert.match(questPlugin.objective(ctx), /bandits northeast may have the key/);
  assert.ok(mind.goals.some((g) => g.id === 'quest_key' && !g.done));
  game.bus.emit('item_gained', { actor: player, itemId: 'ruins_key', qty: 1, from: 'chest' });
  assert.equal(quests.at(-1).stage, 'enter_ruins');
  game.bus.emit('enter_location', { actor: lyra, location: game.locations.get('sunken_ruins') });
  assert.equal(quests.at(-1).stage, 'find_journal');
  player.inventory.add('maren_journal', 1);
  game.bus.emit('item_gained', { actor: player, itemId: 'maren_journal', qty: 1, from: 'quest' });
  assert.equal(quests.at(-1).stage, 'read_journal');
  assert.equal(questPlugin.objective(ctx), 'Let Lyra read the journal.');
  const r = game.actions.run('read_journal', {}, 'player');
  assert.ok(r.ok);
  assert.equal(quests.at(-1).stage, 'waygate');
  assert.match(questPlugin.objective(ctx), /old waygate/);
  assert.deepEqual(quests.map((q) => q.stage), ['ask_aveline', 'find_key', 'enter_ruins', 'find_journal', 'read_journal', 'waygate']);
  for (const q of quests) assert.ok(q.id === 'maren' && q.title && q.text);
  assert.ok(lyra.inventory.has('maren_journal'), 'the player handed it over');
  assert.ok(mind.goals.find((g) => g.id === 'find_maren').done);
  assert.ok(mind.goals.some((g) => g.id === 'follow_maren' && !g.done));
  assert.ok(mind.memory.all().some((m) => m.importance === 10 && /journal/.test(m.text)));
  assert.ok(mind.knowledge.some((k) => /Pale Reach/.test(k.text)), 'she learned what the journal says');
  assert.ok(questPlugin.journalText().includes('Little lamp'));
  assert.ok(game.flags.journal_read);
  // Stages never go backwards, and the save keeps them.
  game.bus.emit('npc_topic', { npc: aveline, topic: 'maren', player });
  assert.equal(questPlugin.stageOf(game).id, 'waygate');
  const saved = questPlugin.serialize(ctx);
  const b = makeGame();
  questPlugin.deserialize(saved, b.game.plugins.ctx);
  assert.equal(questPlugin.stageOf(b.game).id, 'waygate');
});

test('quest arc: "read the journal" reaching her as interact still means reading it', () => {
  const { game, mind, player } = makeGame();
  questPlugin.advance(game.plugins.ctx, 5, 'test');
  player.inventory.add('maren_journal', 1);
  game.bus.emit('companion_action', { name: 'interact', args: { target: "maren's journal" }, source: 'player', ok: false, message: '', t: 0 });
  assert.equal(questPlugin.stageOf(game).id, 'waygate');
  assert.ok(questPlugin.isRead(game));
  assert.ok(mind.goals.some((g) => g.id === 'follow_maren'));
});

test('quest arc: day two begins, or Lyra asks Aveline herself', () => {
  const { game, lyra } = makeGame();
  game.bus.emit('new_day', { day: 2 });
  assert.equal(questPlugin.stageOf(game).id, 'ask_aveline');
  const aveline = game.entities.add(villager(game, 'aveline', lyra.x + 600, lyra.y));
  game.bus.emit('conversation', { a: lyra, b: aveline, lines: [{ speaker: 'lyra', text: "I'm looking for Maren Ashgrove." }], topic: 'Maren' });
  assert.equal(questPlugin.stageOf(game).id, 'find_key');
});

// ------------------------------------------------------------------ talk_to end to end

test('talk_to: she walks over, talks from the profile and lore, learns, remembers, goes back', () => {
  const { game, mind, lyra } = makeGame();
  game.bus.emit('game_start', { loaded: false });
  const bram = game.entities.add(villager(game, 'bram', lyra.x + 140, lyra.y));
  mind.perception.meet(bram);
  const beh = lyra.behavior;
  const convs = [];
  game.bus.on('conversation', (p) => convs.push(p));
  const r = game.actions.run('talk_to', { target: 'the blacksmith', value: 'Maren' }, 'player');
  assert.ok(r.ok, r.message);
  assert.equal(beh.directive.type, 'goto');
  assert.equal(beh.directive.target, 'bram');
  // Behavior walks her there, and the goto ends in 'stay' where she arrives.
  lyra.x = bram.x - 20;
  beh.setDirective({ type: 'stay', x: lyra.x, y: lyra.y });
  run(game, 0.5);
  assert.ok(socialPlugin.busy(game.plugins.ctx), 'talking');
  assert.equal(beh.directive.type, 'follow');
  assert.equal(beh.directive.target, 'bram', 'she walks alongside if he moves on');
  run(game, 60, 0.25);
  assert.equal(convs.length, 1);
  assert.ok(convs[0].lines.length >= 3);
  assert.ok(convs[0].lines.some((l) => l.speaker === 'bram') && convs[0].lines.some((l) => l.speaker === 'lyra'));
  assert.ok(bram.said.length >= 1, "Bram's lines come out of his mouth");
  assert.ok(mind.knowledge.some((k) => k.source === 'told' && k.from === 'bram'), 'she learned something from him');
  assert.ok(mind.memory.all().some((m) => m.type === 'conversation' && m.about.includes('bram') && m.about.includes('maren')));
  assert.ok(mind.relationships.get('bram').familiarity > 8);
  assert.deepEqual(beh.directive, { type: 'follow', target: 'player', distance: 'normal' }, 'back to what she was doing');
  assert.ok(!socialPlugin.busy(game.plugins.ctx));

  // An order mid-talk wins.
  game.actions.run('talk_to', { target: 'bram' }, 'player');
  lyra.x = bram.x - 10;
  run(game, 2);
  game.bus.emit('companion_action', { name: 'follow', args: { target: 'player' }, source: 'player', ok: true, message: '', t: 0 });
  assert.ok(!socialPlugin.busy(game.plugins.ctx));
  // Nobody to talk to.
  assert.equal(game.actions.run('talk_to', { target: 'Maren' }, 'player').ok, false);
  assert.equal(game.actions.run('talk_to', { target: 'nobody at all' }, 'player').ok, false);
});

test('talk_to through Claude: the brain writes the talk when the player asked for it', async () => {
  const { game, mind, lyra } = makeGame();
  game.bus.emit('game_start', { loaded: false });
  const rowan = game.entities.add(villager(game, 'rowan', lyra.x + 20, lyra.y));
  mind.perception.meet(rowan);
  const asked = [];
  game.brain = {
    llmAvailable: () => true,
    async generateConversation(npc, topic) {
      asked.push([npc.id, topic]);
      return {
        lines: [
          { speaker: 'lyra', text: 'Captain. What do you know about the bandits?' },
          { speaker: 'npc', text: "Varek One-Eye's outlaws camp in the hills north-east and take a toll from carts on the King's Road. Some are hungry farmhands; some are worse." },
          { speaker: 'lyra', text: 'Then I know where not to take a stroll.' },
        ],
        learned: ['Rowan counts at least six bandits at the camp, archers among them.'],
        affinity: 3,
      };
    },
  };
  assert.ok(game.actions.run('talk_to', { target: 'Rowan', value: 'the bandits' }, 'player').ok);
  run(game, 0.5);
  await new Promise((r) => setTimeout(r, 0));
  run(game, 30, 0.25);
  assert.deepEqual(asked, [['rowan', 'the bandits']]);
  assert.ok(mind.knowledge.some((k) => /six bandits/.test(k.text) && k.from === 'rowan'));
  assert.ok(mind.knowsLore('varek_band'), 'lore he actually told her is learned');
  assert.ok(rowan.said.some((t) => /Varek/.test(t)));
  // Her own wandering talks never call Claude.
  asked.length = 0;
  socialState(game).talk = null;
  game.actions.run('talk_to', { target: 'Rowan' }, 'self');
  run(game, 0.5);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(asked, []);
});

// ------------------------------------------------------------------ plugins: actions, intents, prompt context

test('plugins provide the §12 actions, ungated where they ask nothing of her', () => {
  const { game } = makeGame();
  const ungated = ['remember', 'forget', 'note_about', 'express', 'set_goal', 'complete_goal', 'read_journal'];
  for (const name of [...ungated, 'set_relationship', 'talk_to']) assert.ok(game.actions.has(name), name);
  for (const name of ungated) assert.equal(game.actions.defs.get(name).ungated, true, `${name} is ungated`);
  assert.ok(!game.actions.defs.get('talk_to').ungated, 'talking to someone is a request');
  assert.ok(!game.actions.defs.get('set_relationship').ungated);

  const mind = game.companion.mind;
  assert.ok(game.actions.run('remember', { value: 'Pip is afraid of the dark' }, 'player').ok);
  assert.ok(mind.memory.all().some((m) => /afraid of the dark/.test(m.text)));
  assert.equal(game.actions.run('forget', { value: "Maren's last letter" }, 'player').ok, false, 'never Maren');
  assert.ok(game.actions.run('express', { value: 'joy', amount: 0.8 }, 'player').ok);
  assert.ok(game.bubbles.icons.length >= 1);
  assert.ok(game.actions.run('set_goal', { value: 'learn to fish properly' }, 'player').ok);
  assert.ok(game.actions.run('complete_goal', { value: 'learn to fish' }, 'player').ok);
  assert.equal(game.actions.run('set_goal', { value: 'hurt Pip' }, 'player').ok, false);
  game.entities.add(villager(game, 'mira', 0, 0));
  assert.ok(game.actions.run('note_about', { target: 'Mira', value: 'She is sweet on Rowan.' }, 'player').ok);
  assert.ok(mind.relationships.get('mira').notes.some((n) => /sweet on Rowan/.test(n.text)));
  assert.ok(game.actions.run('set_relationship', { target: 'wolves', value: 'enemy' }, 'player').ok);
  assert.ok(mind.relationships.get('species:wolf').tags.includes('enemy'));
  assert.equal(game.actions.run('set_relationship', { target: 'Pip', value: 'enemy' }, 'player').ok, false, 'never a child');
});

function intentFor(game, text) {
  const env = { intents: game.plugins.intents(), ctx: game.plugins.ctx, has: (n) => game.actions.has(n), inventory: game.companion.inventory, names: ['lyra'], knownNames: ['bram', 'elda', 'pip', 'rowan', 'mira', 'tobias', 'aveline', 'garrick', 'maren'] };
  const parsed = parseMessage(text, env);
  return parsed.clauses.map((c) => (c.intent?.source === 'plugin' ? c.intent : null)).filter(Boolean);
}

const PHRASES = [
  ['what do you think of Bram?', 'rel.opinion'],
  ['how do you feel about Garrick', 'rel.opinion'],
  ["what's your opinion of Rowan?", 'rel.opinion'],
  ['do you trust me?', 'rel.player'],
  ['are we friends?', 'rel.player'],
  ['who are your friends?', 'rel.circle'],
  ["who don't you like?", 'rel.circle'],
  ['mark the bandits as enemies', 'rel.mark', (a) => a[0].name === 'set_relationship' && a[0].args.value === 'enemy'],
  ['Bram is my friend', 'rel.mark', (a) => a[0].args.target === 'Bram' && a[0].args.value === 'friend'],
  ['Rowan is not an enemy', 'rel.mark', (a) => a[0].args.value === '-enemy'],
  ['who is Aveline?', 'rel.about'],
  ['note about Mira: she likes silverleaf', 'rel.note', (a) => a[0].name === 'note_about'],
  ['what do you remember about the lake?', 'mem.recall'],
  ['do you remember the wolves?', 'mem.recall'],
  ['what happened today?', 'mem.recall'],
  ['how did we meet?', 'mem.recall'],
  ['tell me about your childhood', 'mem.life'],
  ['where are you from?', 'mem.life'],
  ['do you have any family?', 'mem.life'],
  ['what do you know about the waygates?', 'mem.know'],
  ['have you heard anything about the bandits?', 'mem.know'],
  ['remember that Pip loves cats', 'mem.remember', (a) => a[0].name === 'remember' && /Pip loves cats/.test(a[0].args.value)],
  ["don't forget that Bram likes iron ore", 'mem.remember'],
  ['forget about the slime', 'mem.forget', (a) => a[0].name === 'forget'],
  ['are you hungry?', 'feel.hungry'],
  ['are you tired?', 'feel.tired'],
  ['what are you afraid of?', 'feel.fear'],
  ['how are you feeling?', 'feel.how'],
  ['you seem sad', 'feel.how'],
  ['what do you want?', 'feel.want'],
  ["what's on your mind?", 'feel.want'],
  ['new goal: find a moonpetal for Mira', 'feel.set_goal', (a) => a[0].name === 'set_goal'],
  ['mark the moonpetals goal as done', 'feel.complete_goal', (a) => a[0].name === 'complete_goal'],
  ['cheer up', 'feel.soothe'],
  ['talk to Bram', 'social.talk', (a) => a[0].name === 'talk_to' && a[0].args.target === 'Bram'],
  ['go ask Aveline about Maren', 'social.talk', (a) => a[0].args.target === 'Aveline' && a[0].args.value === 'Maren'],
  ['say hi to Pip', 'social.talk', (a) => a[0].args.target === 'Pip'],
  ['have a word with Rowan about the bandits', 'social.talk', (a) => a[0].args.value === 'the bandits'],
  ['who is Maren?', 'quest.maren'],
  ['what happened to Maren?', 'quest.maren'],
  ["what's our next step?", 'quest.next'],
  ['what now?', 'quest.next'],
  ["read Maren's journal", 'quest.read', (a) => a[0].name === 'read_journal'],
  ['what did the journal say?', 'quest.journal'],
];

const UNRELATED = [
  'follow me',
  'attack mode',
  'chop some wood',
  'nice weather today',
  'I will talk to Bram later',
  'I want to talk to you',
  'the lake is pretty',
  'let us go to the inn',
  'I remember my own village',
  'that wolf is huge',
  'I think it will rain',
  'you are funny',
  'thanks',
  'hello',
  'what time is it?',
  'give me a potion',
  'I am hungry',
  'my friend Bob is a baker',
];

test('intents: many phrasings match, unrelated chat does not', () => {
  const { game } = makeGame();
  for (const [text, id, check] of PHRASES) {
    const hits = intentFor(game, text);
    assert.ok(hits.length, `"${text}" matched nothing`);
    assert.equal(hits[0].id, id, `"${text}"`);
    if (check) assert.ok(check(hits[0].actions), `"${text}" actions ${JSON.stringify(hits[0].actions)}`);
    if (hits[0].answer && !hits[0].actions.length) {
      const a = hits[0].answer([]);
      assert.ok(a == null || (typeof a === 'string' && !/undefined|\{/.test(a)), `"${text}" -> ${a}`);
    }
  }
  for (const text of UNRELATED) {
    const hits = intentFor(game, text);
    assert.deepEqual(hits.map((h) => h.id), [], `"${text}" should not match a mind intent`);
  }
});

test('every promptContext stays under 900 characters, even in a full mind', () => {
  const { game, mind, lyra } = makeGame();
  for (const id of ['bram', 'elda', 'pip', 'rowan', 'mira', 'tobias', 'aveline', 'garrick']) {
    const v = game.entities.add(villager(game, id, lyra.x + 20, lyra.y + 10));
    mind.perception.meet(v);
    for (let i = 0; i < 6; i++) mind.relationships.addNote(id, `A long note number ${i} about ${id} and everything they ever said to anyone in the whole valley.`, 'told');
    mind.relationships.adjust(id, { affinity: 50, familiarity: 50 });
  }
  for (let i = 0; i < 40; i++) mind.remember(`Something long happened with the wolves near the lake, number ${i}, and I will not forget it soon.`, { importance: 6 });
  for (let i = 0; i < 10; i++) mind.addGoal(`A rather long personal goal number ${i} that keeps going and going`, 0.5, 'self');
  for (let i = 0; i < 6; i++) mind.learn('Maren Ashgrove', `Maren fact ${i}: she walked the long road north with a lantern and a joke.`, { source: 'told', about: ['maren'] });
  for (const query of ['', 'what do you remember about the wolves and Bram and Maren and the lake?', 'tell me everything']) {
    for (const s of game.plugins.promptSections(query)) assert.ok(s.text.length <= 900, `${s.id}: ${s.text.length}`);
  }
  const ids = game.plugins.promptSections('wolves').map((s) => s.id);
  for (const id of ['relationships', 'memory', 'feelings', 'quest']) assert.ok(ids.includes(id), `${id} has a prompt section`);
});

test('reset brings back the woman who walked into Hearthvale', () => {
  const { game, mind } = makeGame();
  mind.remember('Something that happened later.', { importance: 5 });
  mind.relationships.adjust('player', { affinity: 30 });
  const soulName = mind.soul.name;
  mind.reset();
  assert.ok(!mind.memory.all().some((m) => /happened later/.test(m.text)));
  assert.equal(mind.relationships.get('player').affinity, 25);
  assert.equal(mind.soul.name, soulName);
  assert.ok(mind.autonomy);
  run(game, 1);
});
