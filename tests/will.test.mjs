import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EventBus } from '../src/core/events.js';
import { TILE, DAY_SECONDS } from '../src/core/constants.js';
import { Actor } from '../src/entities/entity.js';
import { EntityManager } from '../src/entities/manager.js';
import { LocationIndex } from '../src/world/locations.js';
import { ActionRegistry } from '../src/ai/brain/actions.js';
import { PluginRegistry } from '../src/ai/plugins/registry.js';
import { BUILTIN_PLUGINS } from '../src/ai/plugins/index.js';
import { Companion } from '../src/entities/companion.js';
import { Brain } from '../src/ai/brain/brain.js';
import { composeDiary, privateVoice } from '../src/ai/brain/diary.js';
import { RESPONSE_SCHEMA, buildRules } from '../src/ai/brain/prompt.js';
import { LINES } from '../src/ai/mind/autonomy_lines.js';
import { WILL_LINES } from '../src/ai/brain/lines_will.js';
import { WORTH } from '../src/ai/mind/autonomy_worth.js';
import { Memory } from '../src/ai/mind/memory.js';
import { KnowledgeStore } from '../src/ai/mind/knowledge.js';
import { coerceMemoryEdits, protects } from '../src/ai/mind/memory_edits.js';

// Round 3, "Lyra's will" (DESIGN §19.4, §19.5, LORE §7 "Boundaries"): is it worth it to
// her, her memory as hers to tend, and the polish from the last playtest.

const W = 80;
const H = 60;
const SPH = 37.5; // game seconds per in-game hour
const T = (n) => n * TILE + TILE / 2;

const LOCS = [
  { id: 'hearthvale', name: 'Hearthvale', kind: 'village', bounds: { x: 0, y: 0, w: W, h: H } },
  { id: 'town_square', name: 'Town Square', kind: 'square', bounds: { x: 16, y: 16, w: 10, h: 8 }, parent: 'hearthvale' },
  { id: 'player_home', name: 'Your Cottage', kind: 'home', indoor: true, bounds: { x: 4, y: 30, w: 6, h: 5 } },
  { id: 'ember_kettle', name: 'The Ember Kettle', kind: 'building', indoor: true, bounds: { x: 30, y: 18, w: 6, h: 5 }, aliases: ['inn', 'tavern', 'kettle'] },
  { id: 'chapel', name: 'Chapel of the Hearth', kind: 'building', indoor: true, bounds: { x: 30, y: 28, w: 5, h: 5 } },
  { id: 'guardhouse', name: 'Guardhouse', kind: 'building', indoor: true, bounds: { x: 40, y: 28, w: 5, h: 5 } },
  { id: 'whisperwood', name: 'Whisperwood', kind: 'forest', danger: 1, bounds: { x: 2, y: 2, w: 16, h: 10 }, aliases: ['forest', 'woods'] },
  { id: 'kings_road', name: "King's Road", kind: 'road', bounds: { x: 0, y: 56, w: W, h: 3 } },
];

function makeClock(hour, day) {
  return {
    t: (day - 1) * DAY_SECONDS + hour * SPH,
    secondsPerHour: SPH,
    weather: { type: 'clear', intensity: 0 },
    get hour() {
      return ((this.t % DAY_SECONDS) / DAY_SECONDS) * 24;
    },
    get day() {
      return Math.floor(this.t / DAY_SECONDS) + 1;
    },
    get isNight() {
      const h = this.hour;
      return h >= 20.5 || h < 5;
    },
  };
}

function fakeRuntime(json) {
  const sample = Object.assign(async (p, o) => ({ text: JSON.stringify(await json(p, o)) }), { json: (p, o) => json(p, o) });
  return { hostPresent: true, sample, tts: null, onChange() {}, disable() {} };
}

// The real Companion (Mind, Autonomy, Behavior), the real registries with every plugin,
// and a real Brain (offline unless a runtime is given).
function makeWorld({ hour = 10, day = 1, runtime = null } = {}) {
  const game = {};
  game.bus = new EventBus();
  game.settings = { playerName: 'Ash' };
  game.flags = {};
  game.time = 0;
  game.state = 'playing';
  game.clock = makeClock(hour, day);
  game.runtime = runtime || { hostPresent: false, sample: null, tts: null, onChange() {}, disable() {} };
  game.map = {
    w: W,
    h: H,
    buildings: [],
    inBounds: (tx, ty) => tx >= 0 && ty >= 0 && tx < W && ty < H,
    isSolidTile(tx, ty) {
      return !this.inBounds(tx, ty);
    },
    isWater: () => false,
    blocksProjectile(tx, ty) {
      return !this.inBounds(tx, ty);
    },
    buildingAt: () => null,
    isIndoors: () => false,
  };
  game.objects = { all: () => [], get: () => null, inRadius: () => [], nearest: () => null, isBlockingTile: () => false, doorAt: () => null, findByWord: () => null };
  game.entities = new EntityManager(game);
  game.locations = new LocationIndex(LOCS);
  game.pathfinder = { find: (sx, sy, gx, gy) => [{ x: gx, y: gy }] };
  game.bubbles = { said: [], say(e, t) { this.said.push(t); }, icon() {}, thought() {}, number() {}, clear() {} };
  game.ui = { chat: { messages: [], addMessage(m) { this.messages.push(m); }, open() {}, setThinking() {} }, toast() {}, showDiary() {} };
  game.camera = { x: 0, y: 0, vw: 480, vh: 270 };
  game.actions = new ActionRegistry(game);
  game.plugins = new PluginRegistry(game);
  game.isBlockedTile = (tx, ty) => game.map.isSolidTile(tx, ty);
  for (const p of BUILTIN_PLUGINS) game.plugins.register(p);
  const player = game.entities.add(new Actor(game, { id: 'player', name: 'Ash', faction: 'player', maxHp: 60, atk: 6, x: T(20), y: T(20) }));
  game.player = player;
  const lyra = game.entities.add(new Companion(game, { x: T(22), y: T(20) }));
  game.companion = lyra;
  game.brain = new Brain(game);
  game.brain.localDelay = false;
  game.plugins.installAll();
  game.brain.init();
  game.bus.emit('game_start', { loaded: false });
  return { game, player, lyra, mind: lyra.mind, a: lyra.mind.autonomy, brain: game.brain };
}

function step(game, seconds, dt = 0.25) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    game.clock.t += dt;
    game.time += dt;
    game.entities.update(dt);
    game.plugins.update(dt);
    game.brain.update(dt);
  }
}

function wolf(game, x, y, id = 'wolf_1') {
  const w = new Actor(game, { id, name: 'Wolf', faction: 'monster', maxHp: 30, atk: 6, x, y });
  w.species = 'wolf';
  w.threat = 2;
  return game.entities.add(w);
}

function villager(game, id, name, x, y) {
  const v = new Actor(game, { id, name, faction: 'villager', maxHp: 40, x, y });
  v.profile = { id, name, work: 'town_square', home: 'town_square' };
  return game.entities.add(v);
}

function hit(game, source, target, amount = 6) {
  target.hp = Math.max(1, target.hp - amount);
  game.bus.emit('damage', { source, target, amount, kind: 'melee', crit: false });
}

function rel(mind) {
  return mind.relationships.get('player');
}

// Everything she said aloud or in the chat, with the state she was in when she said it.
function listen(game, a) {
  const heard = [];
  game.bus.on('speech', (p) => {
    if (p?.speaker === game.companion && p.text) heard.push({ text: String(p.text), state: a.companionship });
  });
  const add = game.ui.chat.addMessage.bind(game.ui.chat);
  game.ui.chat.addMessage = (m) => {
    if (m?.from === 'lyra' && m.text) heard.push({ text: String(m.text), state: a.companionship });
    add(m);
  };
  return heard;
}

// A line that threatens or hints that she might leave (LORE §7, tone).
const LEAVE_THREAT =
  /regret it|one more chance|last chance|\bfor now\b|\byet\.|\bi'?m (?:leaving|gone|going (?:away|for good))|\bwalk away from you|\bwe'?re (?:done|finished)\b|\bi don'?t travel with\b|never see me|\bi keep count\b|keeping a tally|do that again and|or i'?ll (?:go|leave)|i could leave|i might leave|i'?ll leave you/i;

// ---------------------------------------------------------------- A. worth it

test('worth(): a breakdown of what staying gives her and what it costs, in her own words', () => {
  const { a } = makeWorld();
  const w = a.worth();
  for (const k of ['stay', 'cost', 'net']) assert.ok(Number.isFinite(w[k]), k);
  assert.ok(Array.isArray(w.reasons) && w.reasons.length >= 3);
  for (const r of w.reasons) assert.ok(typeof r.text === 'string' && r.text.length > 5 && Number.isFinite(r.weight), JSON.stringify(r));
  assert.ok(w.reasons.some((r) => /Maren/.test(r.text) && r.weight > 0), 'the Maren thread keeps her');
  assert.ok(w.reasons.some((r) => /stipend|hearthwatch/i.test(r.text) && r.weight > 0), 'the hearthwatch wage');
  assert.ok(w.reasons.some((r) => /Mam and Da|waystones/.test(r.text) && r.weight < 0), 'time taken from her own life');
  assert.ok(w.net > WORTH.calm, `a new game is clearly worth it to her (${w.net})`);
  assert.deepEqual(a.summary().worth.reasons, a.worth().reasons, 'the Mind panel gets the same weighing');
  assert.ok(a.serialize().worth, 'the smoothed weighing is saved');
});

test('worth() responds to good deeds and to bad ones', () => {
  const good = makeWorld();
  const g0 = good.a.worth().net;
  good.a.recordDeed('protected_lyra');
  good.a.recordDeed('kept_promise', { text: 'Brought me moonpetals.' });
  const pip = villager(good.game, 'pip', 'Pip', T(25), T(20));
  good.mind.relationships.ensure(pip);
  good.mind.relationships.get('pip').affinity = 60;
  good.a.recordDeed('kindness', { victim: pip, text: 'Gave Pip a honey cake.' });
  const g1 = good.a.worth();
  assert.ok(g1.net > g0 + 1, `good deeds make staying worth more (${g0} -> ${g1.net})`);
  assert.ok(g1.reasons.some((r) => /keep your word/.test(r.text)));
  assert.ok(g1.reasons.some((r) => /people I love/.test(r.text)), 'kindness to someone she loves counts double');

  const bad = makeWorld();
  const b0 = bad.a.worth().net;
  bad.a.recordDeed('lied', { text: 'Said they had paid Elda.' });
  bad.a.recordDeed('broke_promise', { text: 'Never brought the honey cake.' });
  bad.a.recordDeed('pushed_after_refusal');
  const b1 = bad.a.worth();
  assert.ok(b1.net < b0 - 2, `wrongs make staying worth less (${b0} -> ${b1.net})`);
  assert.ok(b1.reasons.some((r) => /lied to me/.test(r.text) && r.weight < 0));
  assert.ok(b1.reasons.some((r) => /broke your word/.test(r.text) && r.weight < 0));
  assert.equal(bad.a.companionship, 'together', 'weighed, not acted on in the same breath (hysteresis)');

  // Small wrongs she can afford fade; lies take days.
  const pushed = () => bad.a.worth({ fresh: true }).reasons.find((r) => /said no/.test(r.text));
  const before = pushed()?.weight ?? 0;
  bad.game.clock.t += DAY_SECONDS;
  const after = pushed()?.weight ?? 0;
  assert.ok(Math.abs(after) < Math.abs(before) * 0.25, `a push after a no fades within a day (${before} -> ${after})`);
  assert.ok(bad.a.worth({ fresh: true }).reasons.some((r) => /lied/.test(r.text)), 'a lie is still weighed a day later');
});

test('a single clipped sword-swing in a wolf fight does not change companionship', () => {
  const { game, player, lyra, a } = makeWorld();
  const changes = [];
  game.bus.on('companionship_changed', (p) => changes.push(p.state));
  wolf(game, lyra.x + 20, lyra.y);
  hit(game, player, lyra);
  assert.equal(a.ledger.at(-1).deed, 'hit_lyra_accident');
  assert.ok(a.worth().reasons.some((r) => /scramble/.test(r.text)), 'she weighs it as the small thing it is');
  game.entities.get('wolf_1').removed = true;
  step(game, SPH * 4, 0.5);
  assert.equal(a.companionship, 'together');
  assert.deepEqual(changes, [], 'no change at all, hours later');
  assert.ok(!a.worth({ fresh: true }).reasons.some((r) => /scramble/.test(r.text)), 'and it has faded from the weighing');
});

test('repeated deliberate harm changes companionship: a warning and a step back, then she goes', () => {
  const { game, player, lyra, a, mind } = makeWorld();
  const heard = listen(game, a);
  hit(game, player, lyra);
  assert.equal(a.companionship, 'wary', 'the first blow: one warning and a step back');
  step(game, 2);
  hit(game, player, lyra);
  assert.equal(a.companionship, 'left', 'a second blow ends it');
  const said = heard.filter((h) => h.state === 'left').map((h) => h.text);
  assert.ok(said.some((t) => /twice|again|struck/i.test(t)), `she says why, plainly: ${said.join(' | ')}`);
  // Her mood follows why she left: hurt, not upbeat (playtest polish 1).
  step(game, 20, 0.5);
  const mood = mind.mood();
  assert.ok(mood.valence < 0.1, `not upbeat after leaving (${mood.label}, ${mood.valence})`);
  assert.ok(['hurt', 'sad', 'heartsick', 'gloomy', 'miserable', 'angry', 'furious', 'afraid', 'terrified', 'uneasy', 'distressed', 'heavy-hearted', 'shaken', 'startled'].includes(mood.label), mood.label);
  step(game, 200, 0.5);
  assert.notEqual(mind.mood().label, 'cheerful');
  assert.ok(mind.mood().valence < 0.2, `still hurt minutes later (${mind.mood().label})`);
});

test('worth drives wary and back with hysteresis; small wrongs she can afford are let go', () => {
  const { game, a, mind } = makeWorld();
  // One lie early on: weighed, but staying is still worth it.
  a.recordDeed('lied', { text: 'Said the cottage roof was fixed.' });
  step(game, SPH * 3, 0.5);
  assert.equal(a.companionship, 'together', 'one lie she can afford');
  // Lies and broken promises one after another: she keeps her distance.
  a.recordDeed('lied', { text: 'Said they paid Elda.' });
  a.recordDeed('broke_promise', { text: 'Never came to the chapel.' });
  assert.equal(a.companionship, 'together', 'not in the same breath');
  step(game, SPH * 3, 0.5);
  assert.equal(a.companionship, 'wary', 'the weighing stayed low');
  assert.ok(a.reason.length > 5);
  // Time and reasons to trust bring her back.
  Object.assign(rel(mind), { trust: 60, affinity: 45, fear: 0 });
  for (let i = 0; i < 3; i++) a.recordDeed('protected_lyra');
  step(game, SPH * 4, 0.5);
  assert.equal(a.companionship, 'together');
});

test('stepping in for a villager only when protecting them is worth more than the risk to her', () => {
  {
    const { game, player, lyra, a } = makeWorld();
    const bram = villager(game, 'bram', 'Bram Ironhand', player.x + 12, player.y);
    hit(game, player, bram);
    step(game, 2);
    hit(game, player, bram);
    assert.ok(player.rootTime > 0, 'healthy, she binds the player and steps between');
    assert.equal(lyra.behavior.directive.type, 'guard');
  }
  {
    const { game, player, lyra, a } = makeWorld();
    const bram = villager(game, 'bram', 'Bram Ironhand', player.x + 12, player.y);
    hit(game, player, bram);
    step(game, 2);
    lyra.hp = Math.round(lyra.maxHp * 0.15);
    player.atk = 14;
    const w = a.protectWorth(bram);
    assert.equal(w.step, false, JSON.stringify(w));
    hit(game, player, bram);
    assert.ok(!(player.rootTime > 0), 'badly hurt against a stronger arm: she does not step in');
    assert.ok(game.bubbles.said.some((t) => /Guards|Rowan/.test(t)), 'she still calls the watch');
    const pip = villager(game, 'pip', 'Pip', player.x + 14, player.y);
    a.mind.relationships.ensure(pip);
    a.mind.relationships.get('pip').affinity = 60;
    assert.ok(a.protectWorth(pip).value > w.value + 1.5, 'a child she loves is worth far more to her');
  }
});

test('she never says a leave-threat line while together', () => {
  // Every line she can say while traveling with the player (banks for leaving are said once,
  // when she goes).
  const LEAVING = /^(to_left|to_gone|no_left|no_gone|no_rejoin|left_|refuse_left|leaving|gone_farewell|deed_hit_again)/;
  const bad = [];
  for (const [key, bank] of Object.entries(LINES)) {
    if (LEAVING.test(key)) continue;
    for (const list of Object.values(bank)) for (const t of list) if (LEAVE_THREAT.test(t)) bad.push(`${key}: ${t}`);
  }
  for (const [key, list] of Object.entries(WILL_LINES)) {
    if (LEAVING.test(key)) continue;
    for (const e of list) {
      const t = typeof e === 'string' ? e : e.t;
      if (LEAVE_THREAT.test(t)) bad.push(`${key}: ${t}`);
    }
  }
  assert.deepEqual(bad, []);

  // And in play: everything she says while together, through slights, refusals, apologies
  // and questions about the two of them.
  const { game, player, lyra, a, mind, brain } = makeWorld();
  const heard = listen(game, a);
  const run = async () => {
    wolf(game, lyra.x + 20, lyra.y, 'wolf_x');
    hit(game, player, lyra);
    game.entities.get('wolf_x').removed = true;
    a.recordDeed('gift_disliked', { text: 'Gave me raw fish.' });
    a.recordDeed('pushed_after_refusal');
    a.recordDeed('broke_promise', { text: 'Never brought the honey cake.' });
    for (const msg of ['are we okay?', 'do you trust me?', 'are you leaving me?', 'why are you keeping your distance?', "I'm sorry", 'I promise to bring you a honey cake', 'attack mode', 'come back', 'what do you think of me?', 'do you still trust me?']) {
      await brain.handlePlayerMessage(msg);
      step(game, 3);
    }
    step(game, SPH, 0.5);
  };
  return run().then(() => {
    assert.equal(a.companionship, 'together');
    const together = heard.filter((h) => h.state === 'together').map((h) => h.text);
    assert.ok(together.length >= 8, `she spoke (${together.length})`);
    const threats = together.filter((t) => LEAVE_THREAT.test(t));
    assert.deepEqual(threats, []);
  });
});

test('the conditional yes is one coherent reply, not two', async () => {
  const { game, lyra, mind, brain } = makeWorld();
  rel(mind).trust = 45;
  wolf(game, lyra.x + 90, lyra.y, 'wolf_a');
  wolf(game, lyra.x + 100, lyra.y + 10, 'wolf_b');
  const r = await brain.handlePlayerMessage('attack mode');
  const v = r.actions[0]?.verdict;
  assert.equal(v?.decision, 'accept_conditional', JSON.stringify(v?.reasons));
  assert.equal(r.say.trim(), v.message.trim(), `one reply: ${r.say}`);
  assert.ok(!/Understood|Gloves off|Already in attack mode/.test(r.say), r.say);
});

test('worth reaches Claude as a compact line in the context', () => {
  const { game, a } = makeWorld();
  a.recordDeed('lied', { text: 'Said they paid Elda.' });
  const ctx = game.plugins.get('autonomy').promptContext(game.plugins.ctx);
  assert.ok(ctx.length <= 900);
  assert.match(ctx, /Is staying with the player worth it to her: .*net/);
  assert.match(ctx, /Against: .*lied to me/);
  assert.match(ctx, /For: .*Maren/);
});

test('if staying becomes worth it again she may come back on her own terms', () => {
  const { game, player, lyra, a, mind } = makeWorld();
  hit(game, player, lyra);
  step(game, 2);
  hit(game, player, lyra);
  assert.equal(a.companionship, 'left');
  step(game, DAY_SECONDS + 10, 1);
  Object.assign(rel(mind), { trust: 55, fear: 10, affinity: 40 });
  a.hearPlayer("I'm so sorry I hit you with my sword. I was wrong, and I will never do it again.");
  assert.equal(a.companionship, 'apart', 'amends: she stops avoiding them');
  Object.assign(rel(mind), { trust: 65, fear: 0, affinity: 50 });
  for (let i = 0; i < 3; i++) a.recordDeed('kept_promise');
  lyra.x = player.x + 30;
  lyra.y = player.y;
  const heard = listen(game, a);
  step(game, SPH * 4, 0.5);
  assert.ok(a.companionship === 'together' || a.companionship === 'wary', `back by her own choice (${a.companionship})`);
  assert.ok(heard.some((h) => /terms/i.test(h.text)), heard.map((h) => h.text).join(' | '));
});

// ---------------------------------------------------------------- B. memory editing

test('edit_memory keeps history, marks it edited, and the history survives a save', () => {
  const { game, mind } = makeWorld();
  const m = mind.remember('Bram grunted at me over the anvil. Rude.', { importance: 4, about: ['bram'], emotion: 'anger' });
  const r = game.actions.run('edit_memory', { target: m.id, value: 'Bram grunted at me over the anvil. I think that is just how he says hello.', amount: 3 }, 'claude');
  assert.ok(r.ok, r.message);
  const e = mind.memory.get(m.id);
  assert.equal(e.edited, true);
  assert.match(e.text, /how he says hello/);
  assert.equal(e.importance, 3);
  assert.equal(e.history.length, 1);
  assert.equal(e.history[0].text, 'Bram grunted at me over the anvil. Rude.');
  assert.equal(e.history[0].importance, 4);
  assert.ok(e.history[0].why.length > 3 && Number.isFinite(e.history[0].t));
  const copy = new Memory();
  copy.deserialize(mind.memory.serialize());
  assert.deepEqual(copy.get(m.id).history, e.history);
  assert.equal(copy.get(m.id).edited, true);
  // Knowledge too: corrected, with the old text kept; retracted, never recalled.
  const k = mind.learn('Bram', 'Bram hates honey cakes.', { kind: 'rumor', source: 'told' });
  assert.ok(game.actions.run('update_knowledge', { target: k.id, value: 'Bram loves honey cakes and pretends not to.', amount: 0.8 }, 'claude').ok);
  assert.equal(k.history[0].text, 'Bram hates honey cakes.');
  assert.equal(k.edited, true);
  const k2 = mind.learn('the bell', 'The chapel bell rings at noon for the dead.', { kind: 'theory', source: 'inferred' });
  assert.ok(game.actions.run('retract_knowledge', { target: k2.id, value: 'Aveline says it rings for the living.' }, 'claude').ok);
  assert.equal(k2.retracted, true);
  assert.ok(!mind.recall('chapel bell dead', { stores: ['knowledge'] }).some((h) => h.id === k2.id), 'never recalled once retracted');
  const ks = new KnowledgeStore();
  ks.deserialize(mind.knowledgeStore.serialize(mind.lorebook), mind.lorebook);
  assert.equal(ks.get(k2.id).retracted, true);
  assert.equal(ks.get(k.id).history[0].text, 'Bram hates honey cakes.');
});

test('forget refuses what protects her: "No. I remember that for a reason."', async () => {
  const { game, player, lyra, mind, a, brain } = makeWorld();
  hit(game, player, lyra);
  const blow = mind.memory.all().find((m) => m.tags.includes('hit_lyra'));
  assert.ok(blow && protects(mind, blow), 'the memory of the blow protects her');
  // The player asks: a request she weighs (DESIGN §17.4).
  const r = game.actions.run('forget', { value: 'Ash struck me with their sword' }, 'player');
  assert.equal(r.ok, false);
  assert.equal(r.refused, true);
  assert.equal(r.message, 'No. I remember that for a reason.');
  assert.ok(mind.memory.get(blow.id), 'still remembered');
  // In words, offline.
  const reply = await brain.handlePlayerMessage('please forget that I hit you');
  assert.match(reply.say, /I remember that for a reason/);
  // Her own decision through Claude cannot drop it either.
  const own = game.actions.run('forget', { target: blow.id }, 'claude');
  assert.equal(own.ok, false);
  assert.ok(mind.memory.get(blow.id));
  // A small thing she can spare, she lets go when asked, and notes why.
  const small = mind.remember('I stubbed my toe on the cottage step.', { importance: 2 });
  const ok = game.actions.run('forget', { value: 'stubbed my toe on the cottage step' }, 'player');
  assert.ok(ok.ok, ok.message);
  assert.equal(mind.memory.get(small.id), null);
  assert.ok(mind.memory.forgotten.some((f) => /stubbed my toe/.test(f.text) && f.why.length > 3));
  assert.equal(a.companionship, 'wary');
});

test('life memories can be reframed, never forgotten', () => {
  const { game, mind } = makeWorld();
  const life = mind.life[0];
  assert.ok(life, 'she has a past');
  const r = game.actions.run('forget', { target: `life:${life.id}` }, 'claude');
  assert.equal(r.ok, false);
  assert.match(r.message, /my life/i);
  assert.ok(mind.life.find((e) => e.id === life.id));
  const asked = game.actions.run('forget', { target: `life:${life.id}` }, 'player');
  assert.equal(asked.ok, false);
  const old = life.text;
  const e = game.actions.run('edit_memory', { target: `life:${life.id}`, value: `${old} I see it more kindly now.` }, 'claude');
  assert.ok(e.ok, e.message);
  assert.equal(life.edited, true);
  assert.equal(life.history[0].text, old);
  // The reframing lives in the save and comes back on load.
  const saved = mind.serialize();
  const w2 = makeWorld();
  w2.mind.deserialize(saved);
  w2.game.plugins.deserialize({ memory: { v: 1 } });
  const again = w2.mind.life.find((x) => x.id === life.id);
  assert.match(again.text, /more kindly now/);
  assert.equal(again.history[0].text, old);
});

test("Claude's memory_edits apply only to ids it was shown; an unknown id is ignored", async () => {
  let reply = null;
  const runtime = fakeRuntime(async () => reply);
  const { game, mind } = makeWorld({ runtime });
  const m = mind.remember('Ash and I watched the rain from the cottage door.', { importance: 4, about: ['player'] });
  const other = mind.remember('Pip showed me a beetle shaped like a crown.', { importance: 4, about: ['pip'] });
  mind.recallContext = () => ({ text: `Memories:\n- [${m.id}] Ash and I watched the rain.`, items: [{ id: m.id, store: 'episode', label: 'watching the rain' }] });
  reply = {
    thought: 'That evening matters more than I said.',
    say: 'I remember the rain. I liked that evening more than I let on.',
    emotion: { name: 'affection', intensity: 0.3 },
    actions: [],
    memories: [],
    relationships: [],
    goal: null,
    used_memories: [m.id],
    knowledge: [],
    memory_edits: [
      { id: m.id, op: 'update', text: 'Ash and I watched the rain from the cottage door. It felt like home.', importance: 6, why: 'I understand now why it stayed with me.' },
      { id: other.id, op: 'forget', text: null, importance: null, why: 'not shown, must be ignored' },
      { id: 'm99999', op: 'update', text: 'invented', importance: 9, why: 'an id that does not exist' },
    ],
  };
  const r = await game.brain.handlePlayerMessage('do you remember the rain?');
  assert.equal(r.provider, 'claude.ai');
  const e = mind.memory.get(m.id);
  assert.match(e.text, /felt like home/);
  assert.equal(e.importance, 6);
  assert.equal(e.history[0].why, 'I understand now why it stayed with me.');
  assert.ok(mind.memory.get(other.id), 'an id outside what she was shown is ignored');
  assert.ok(!mind.memory.all().some((x) => /invented/.test(x.text)));
  // The schema and the rules ask for it.
  assert.ok(RESPONSE_SCHEMA.required.includes('memory_edits'));
  assert.ok(buildRules(game).includes('"memory_edits"'));
  assert.deepEqual(coerceMemoryEdits([{ id: 'm1', op: 'delete' }, { id: '', op: 'forget' }, { id: 'k2', op: 'retract', why: 'wrong' }]).map((x) => x.id), ['k2']);
});

test('sleep consolidation merges, fades, supersedes and reframes, each with a why', () => {
  const { game, mind, a } = makeWorld({ hour: 9 });
  const m1 = mind.remember('Mira sold me a bundle of silverleaf for two coins at her shop today.', { importance: 4, about: ['mira'] });
  game.clock.t += 400; // past the store's own burst merge
  const m2 = mind.remember('At her shop, Mira sold me a bundle of silverleaf today for two coins.', { importance: 5, about: ['mira'] });
  const trivial = mind.remember('A crow landed on the well.', { importance: 2 });
  const old = mind.learn('the ruins gate', 'They say the ruins gate opens at midnight.', { kind: 'rumor', source: 'told' });
  game.clock.t += 60;
  mind.learn('the ruins gate', 'The ruins gate is locked; it opens with the key the bandits hold.', { kind: 'fact', source: 'observed' });
  // A kindness from the player earlier today, then they hurt her and she left.
  a.recordDeed('gift_loved', { text: 'Gave me a honey cake.' });
  const gift = mind.memory.all().filter((m) => m.about.includes('player') && /honey cake/i.test(m.text)).at(-1);
  a.setCompanionship('left', 'You hurt me.', { cause: 'hit_again' });
  game.clock.t += 0.5 * DAY_SECONDS;
  const report = mind.memory.consolidate();
  assert.ok(report.merged >= 1, JSON.stringify(report));
  const kept = mind.memory.get(m1.id) || mind.memory.get(m2.id);
  assert.ok(kept.history.some((h) => /same moment/i.test(h.why)), 'the merge says why');
  const t = mind.memory.get(trivial.id);
  assert.equal(t.importance, 1, 'a trivial thing fades');
  assert.ok(t.history.at(-1).why.length > 5);
  assert.equal(old.retracted, true, 'the rumor is superseded by what she saw');
  assert.match(old.why, /learned better/);
  if (gift) {
    const g = mind.memory.get(gift.id);
    assert.ok(g.edited && g.history.some((h) => /differently/.test(h.why)), 'kind memories of them are reframed through how she sees them now');
  }
  assert.ok(report.superseded >= 1 && report.reframed >= 1, JSON.stringify(report));
  assert.deepEqual(mind.memory.consolidate(), { removed: 0, merged: 0, faded: 0, skipped: true }, 'once a night, however many callers');
});

// ---------------------------------------------------------------- C. polish

test('the diary is her private voice: no "Today, I warned you"', () => {
  const { game, mind } = makeWorld({ hour: 9, day: 2 });
  const day = game.clock.day;
  game.clock.t += 6 * SPH;
  mind.remember('I warned you: "Leave Bram alone!"', { importance: 6, about: ['player', 'bram'], tags: ['warning'], emotion: 'anger' });
  game.clock.t += SPH;
  mind.remember('I had to bind you with Binding Light to stop you.', { importance: 6, about: ['player'], tags: ['binding_light'] });
  const memories = game.brain._dayMemories(day);
  const d = composeDiary(game, memories, { day, rnd: () => 0 });
  assert.ok(!/Today, I warned you/.test(d.text), d.text);
  assert.ok(!/\byou\b/i.test(d.text.replace(/"[^"]*"/g, '')), `nobody is addressed as "you": ${d.text}`);
  assert.match(d.text, /I warned Ash: "Leave Bram alone!"/);
  assert.match(d.text, /bind Ash with Binding Light to stop them/);
  assert.match(d.text, /This (morning|afternoon|evening)/);
  assert.equal(privateVoice('You hit me, and you walked away.', 'Ash'), 'Ash hit me, and they walked away.');
  assert.equal(privateVoice('Ash told me: "I love you."', 'Ash'), 'Ash told me: "I love you."', 'quoted words stay as said');
});

test('offline replies report the memories they used, like Claude replies do', async () => {
  const { game, brain } = makeWorld();
  const r = await brain.handlePlayerMessage('do you remember the wolves?');
  assert.equal(r.provider, 'local');
  assert.ok(r.memories.length >= 1, JSON.stringify(r));
  const msg = game.ui.chat.messages.filter((m) => m.from === 'lyra').at(-1);
  assert.deepEqual(msg.memories, r.memories, 'the chat shows "remembered" chips');
  for (const c of r.memories) assert.ok(c.id && c.label);
  const small = await brain.handlePlayerMessage('hello!');
  assert.deepEqual(small.memories, [], 'no chips where she drew on no memory');
});

test('a reframe asked for by the player keeps her own memory, with their side beside it', () => {
  const { game, mind, a } = makeWorld();
  rel(mind).trust = 55;
  const m = mind.remember('Ash laughed when I slipped in the mud by the well.', { importance: 4, about: ['player'] });
  const r = game.actions.run('edit_memory', { target: m.id, value: 'I was laughing with you, not at you' }, 'player');
  assert.ok(r.ok, r.message);
  const e = mind.memory.get(m.id);
  assert.match(e.text, /^Ash laughed when I slipped/);
  assert.match(e.text, /Ash sees it differently: "I was laughing with you, not at you\."/);
  assert.equal(e.history[0].text, 'Ash laughed when I slipped in the mud by the well.');
  // Low trust: her memories are hers.
  rel(mind).trust = 10;
  const no = game.actions.run('edit_memory', { target: m.id, value: 'it never happened' }, 'player');
  assert.equal(no.ok, false);
  assert.equal(no.refused, true);
  assert.equal(a.companionship, 'together');
});
