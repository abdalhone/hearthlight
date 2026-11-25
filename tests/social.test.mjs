import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EventBus } from '../src/core/events.js';
import { RNG } from '../src/core/rng.js';
import { GameClock } from '../src/core/time.js';
import { DAY_SECONDS } from '../src/core/constants.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { EntityManager } from '../src/entities/manager.js';
import { Actor } from '../src/entities/entity.js';
import { NPC_PROFILES } from '../src/entities/npc_data.js';
import { PluginRegistry } from '../src/ai/plugins/registry.js';
import { ActionRegistry } from '../src/ai/brain/actions.js';
import { BUILTIN_PLUGINS } from '../src/ai/plugins/index.js';
import { villagePlugin } from '../src/ai/plugins/village_plugin.js';

import { Village } from '../src/ai/social/village.js';
import { VOICES, SCENES, ALIASES } from '../src/ai/social/voices.js';
import { TO_YOU } from '../src/ai/social/voices_player.js';
import { SEED_BONDS, VILLAGERS, PEOPLE } from '../src/ai/social/bonds_data.js';
import { hiddenIn, speakable } from '../src/ai/social/hidden.js';
import { buildExchange } from '../src/ai/social/talk.js';
import { Rumors, RUMOR_KINDS } from '../src/ai/social/rumors.js';
import { understand } from '../src/ai/social/player_talk.js';
import { names, callName } from '../src/ai/social/lines.js';

// ------------------------------------------------------------------ a small village

const HOW_RE = /\bhow are you\b/i;

// A villager as far as the village cares: a profile, an opinion of the player, a voice.
function villager(game, id, x, y) {
  const base = NPC_PROFILES.find((p) => p.id === id);
  const profile = base || { id, name: VOICES[id]?.name || id, facts: [], shop: id === 'garrick' ? { sells: [] } : undefined };
  const a = new Actor(game, { id, name: profile.name, faction: profile.faction || 'villager', x, y, maxHp: 40 });
  a.profile = profile;
  a.role = profile.role;
  a.mode = 'routine';
  a.activity = 'socialize';
  a.opinionOfPlayer = 40;
  a.familiarity = 0;
  a.told = new Set();
  a.said = [];
  a.say = (text, o) => a.said.push({ text, o });
  a.adjustOpinion = function adjustOpinion(d) {
    const before = this.opinionOfPlayer;
    this.opinionOfPlayer = Math.max(0, Math.min(100, before + d));
    return this.opinionOfPlayer - before;
  };
  a.r = { phase: 'stay', walking: false };
  return game.entities.add(a);
}

function makeGame({ hour = 19, provider = null, settings = {}, spread = 4, crowd = true } = {}) {
  const bus = new EventBus();
  const events = [];
  const game = {
    bus,
    rng: new RNG(9),
    time: 1,
    state: 'playing',
    flags: {},
    settings: { ...DEFAULT_SETTINGS, playerName: 'Abdullah', ...settings },
    bubbles: { say() {}, icon() {}, thought() {} },
    ui: { toast() {}, chat: { isOpen: () => false } },
    brain: { providers: { current: () => provider } },
  };
  game.clock = new GameClock(game);
  game.clock.weather.timer = 1e9;
  game.clock.t = (hour / 24) * DAY_SECONDS;
  game.entities = new EntityManager(game);
  game.actions = new ActionRegistry(game);
  game.plugins = new PluginRegistry(game);
  game.player = game.entities.add(new Actor(game, { id: 'player', name: 'Abdullah', faction: 'player', x: 1000, y: 1000, maxHp: 50 }));
  const people = {};
  VILLAGERS.forEach((id, i) => {
    // Everyone in one room (crowd) or spread out in a row, far from the player.
    const x = crowd ? 100 + (i % 6) * spread * 4 : 100 + i * 300;
    const y = crowd ? 100 + Math.floor(i / 6) * spread * 4 : 100;
    people[id] = villager(game, id, x, y);
  });
  bus.on('*', (type, p) => events.push({ type, p }));
  game.village = new Village(game);
  return { game, people, events, v: game.village };
}

function run(game, seconds, step = 0.25) {
  for (let t = 0; t < seconds; t += step) {
    game.time += step;
    game.clock.t += step;
    game.village.update(step);
  }
}

function mockProvider(id = 'claude.ai', reply = null) {
  const p = {
    id,
    calls: [],
    available: () => true,
    async complete(req) {
      p.calls.push(req);
      if (typeof reply === 'function') return reply(req);
      if (reply) return reply;
      if (req.schema?.properties?.say) return { say: 'Well now. Fine, thank you for asking.', opinion_delta: 1, mood: 'warm' };
      if (req.schema?.properties?.lines?.items?.type === 'string') return { lines: ['You slept. The village did not.', 'Hobb lit the lamps.', 'Corran won at stones, or says so.'] };
      const ids = [...req.task.matchAll(/"(\w+)":/g)].map((m) => m[1]).filter((x) => VOICES[x]);
      const [a, b] = [ids[0] || 'hobb', ids[1] || 'corran'];
      return { lines: [{ speaker: a, text: 'Your move.' }, { speaker: b, text: 'I moved.' }, { speaker: a, text: 'You moved my stone.' }, { speaker: b, text: 'It was in my way.' }] };
    },
  };
  return p;
}

// ------------------------------------------------------------------ bonds

test('bonds are seeded from the lore for all eighteen villagers and Lyra', () => {
  const { v } = makeGame();
  for (const id of PEOPLE) {
    const out = SEED_BONDS.filter((s) => s[0] === id);
    assert.ok(out.length >= 3, `${id} has seeded bonds (${out.length})`);
    for (const other of PEOPLE) {
      if (other === id) continue;
      const b = v.bond(id, other);
      assert.ok(b, `${id} -> ${other}`);
      assert.ok(b.affinity >= -100 && b.affinity <= 100 && b.trust >= 0 && b.trust <= 100 && b.familiarity >= 0 && b.familiarity <= 100);
    }
  }
  assert.ok(v.bond('hobb', 'wenna').tags.includes('spouse'));
  assert.ok(v.bond('hobb', 'lyra').tags.includes('child'));
  assert.ok(v.bond('lyra', 'wenna').tags.includes('parent'));
  assert.ok(v.isFamily('sabeth', 'lyra'));
  for (const s of SEED_BONDS) assert.ok(speakable(s[6] || ''), `seed note ${s[0]}->${s[1]} keeps the secrets`);
});

test('bonds drift and emit bond_changed', () => {
  const { v, events } = makeGame();
  const before = v.bond('tilly', 'wys').affinity;
  v.adjustBond('tilly', 'wys', { affinity: 5 }, 'test');
  assert.equal(v.bond('tilly', 'wys').affinity, before + 5);
  assert.ok(events.some((e) => e.type === 'bond_changed' && e.p.a === 'tilly' && e.p.b === 'wys'));
});

// ------------------------------------------------------------------ voices

test('every voice line, scene and line to the player keeps the hidden truths', () => {
  const lines = [];
  const walk = (x) => {
    if (typeof x === 'string') lines.push(x);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') Object.values(x).forEach(walk);
  };
  walk(VOICES);
  walk(TO_YOU);
  for (const s of SCENES) for (const [, t] of s.lines) lines.push(t);
  for (const k of Object.values(RUMOR_KINDS)) lines.push(k.text, k.you);
  assert.ok(lines.length > 1500);
  for (const l of lines) assert.equal(hiddenIn(l.replace(/\{you\}/g, 'you helped Pip')), null, l);
  for (const id of VILLAGERS) {
    assert.ok(VOICES[id], `${id} has a voice`);
    assert.ok(VOICES[id].howAreYou?.length && VOICES[id].hello?.length && VOICES[id].bye?.length, `${id} voice is full`);
    assert.ok(TO_YOU[id]?.good?.length && TO_YOU[id]?.bad?.length && TO_YOU[id]?.cold?.length && TO_YOU[id]?.mend?.length, `${id} speaks to the player`);
  }
});

test('the hidden-truth check catches secrets stated outright', () => {
  assert.ok(hiddenIn('Varek is her brother, you know.'));
  assert.ok(hiddenIn('The captain plays the flute at night.'));
  assert.ok(hiddenIn('Elda puts moonpetal in the honey cakes.'));
  assert.equal(hiddenIn('Most people blame Wys for the flute.'), null);
});

// ------------------------------------------------------------------ conversations

test('converse makes 2–6 in-character lines with no placeholders and no hidden truths', () => {
  const { v } = makeGame();
  const pairs = [
    ['hobb', 'wenna'],
    ['tilly', 'bram'],
    ['hobb', 'corran'],
    ['pip', 'elda'],
    ['rowan', 'wys'],
    ['hess', 'sabeth'],
    ['petra', 'wenna'],
    ['tansy', 'tobias'],
    ['alder', 'mira'],
    ['garrick', 'aveline'],
  ];
  for (let round = 0; round < 12; round++) {
    for (const [a, b] of pairs) {
      v.pairAt.clear();
      const c = v.converse(a, b, { onScreen: false });
      assert.ok(c, `${a}+${b}`);
      assert.ok(c.lines.length >= 2 && c.lines.length <= 6, `${a}+${b}: ${c.lines.length} lines`);
      for (const l of c.lines) {
        assert.ok([a, b].includes(l.speaker), `${l.speaker} in ${a}+${b}`);
        assert.ok(!/\{\w+\}/.test(l.text), `placeholder left: ${l.text}`);
        assert.ok(speakable(l.text), `hidden truth: ${l.text}`);
        assert.ok(l.text.length > 1);
      }
      assert.ok(c.summary && !/\{/.test(c.summary));
    }
  }
  assert.ok(v.log.length >= 100 - 1 || v.log.length === 80);
});

test('a chat between Hobb and Wenna sounds nothing like one between Tilly and Bram', () => {
  const { v } = makeGame();
  const ofPair = (a, b) => {
    const out = new Set();
    for (let i = 0; i < 40; i++) {
      v.pairAt.clear();
      for (const l of v.converse(a, b, { onScreen: false }).lines) out.add(l.text);
    }
    return out;
  };
  const hw = ofPair('hobb', 'wenna');
  const tb = ofPair('tilly', 'bram');
  const shared = [...hw].filter((l) => tb.has(l) && l.length > 6);
  assert.deepEqual(shared, []);
  assert.ok([...tb].some((l) => /hmph/i.test(l)), 'Bram grunts');
  assert.ok([...hw].some((l) => /\blove\b|well now/i.test(l)), 'Hobb calls Wenna love');
});

test('nobody is talked about in the third person to their own face', () => {
  const { v } = makeGame();
  for (const a of VILLAGERS) {
    for (const b of ['hobb', 'pip', 'wenna', 'rowan', 'tilly']) {
      if (a === b) continue;
      for (let i = 0; i < 4; i++) {
        v.pairAt.clear();
        const c = v.converse(a, b, { onScreen: false });
        // Scenes are written whole; built lines from the banks must not name the listener.
        if (c.topic && c.lines.length && !SCENES.some((s) => s.lines.some(([, t]) => t === c.lines[0].text))) {
          for (const l of c.lines) {
            const listener = l.speaker === a ? b : a;
            const bank = VOICES[l.speaker];
            const direct = Object.values(bank.helloTo?.[listener] || []).concat(Object.values(bank.as || {}).flat());
            if (direct.includes(l.text)) continue;
            if (/^(Lyra|Star|Captain)[!.,]/.test(l.text)) continue; // a name used to call them
            assert.ok(!names(l.text, listener) || l.text.toLowerCase().includes(callName(l.speaker, listener).toLowerCase()), `${l.speaker} to ${listener}: ${l.text}`);
          }
        }
      }
    }
  }
});

test('on screen, the conversation plays as bubbles in turn, respecting the say gap', () => {
  const { game, people, v } = makeGame();
  game.player.x = people.hobb.x + 20;
  game.player.y = people.hobb.y;
  const c = v.converse('hobb', 'corran', { onScreen: true });
  assert.ok(v.playing);
  assert.equal(people.hobb.said.length + people.corran.said.length, 1, 'the first line at once');
  assert.ok(!v.quietNearPlayer(), 'nobody else talks over it');
  for (const e of Object.values(people)) if (e !== people.hobb && e !== people.corran) e.state = 'sleep';
  run(game, 30);
  assert.equal(people.hobb.said.length + people.corran.said.length, c.lines.length);
  assert.equal(v.playing, null);
  for (let i = 1; i < c.lines.length; i++) assert.notEqual(c.lines[i].speaker, c.lines[i - 1].speaker, 'they take turns');
});

test('the rhythm: villagers awake and together talk on their own, more in the evening', () => {
  const { game, v } = makeGame({ hour: 19 });
  run(game, 120);
  const evening = v.log.length;
  assert.ok(evening >= 8, `evening talks: ${evening}`);
  const day = makeGame({ hour: 10 });
  run(day.game, 120);
  assert.ok(day.v.log.length < evening, `day ${day.v.log.length} < evening ${evening}`);
  // Asleep, nobody talks.
  const night = makeGame({ hour: 2 });
  for (const e of Object.values(night.people)) e.state = 'sleep';
  run(night.game, 120);
  assert.equal(night.v.log.length, 0);
});

// ------------------------------------------------------------------ gossip and consequences

test('rumors spread one listener at a time, grow in the telling and move opinions', () => {
  const { game, people, v, events } = makeGame({ hour: 12 });
  people.tansy.x = game.player.x + 20;
  people.tansy.y = game.player.y;
  const wolf = game.entities.add(new Actor(game, { id: 'wolf1', name: 'Wolf', faction: 'monster', x: people.tansy.x + 10, y: people.tansy.y, maxHp: 10 }));
  wolf.species = 'wolf';
  people.tansy.lastAttacker = wolf;
  people.tansy.lastAttackedAt = game.clock.t;
  const before = people.tobias.opinionOfPlayer;
  game.bus.emit('death', { entity: wolf, killer: game.player });
  v.onEvent('death', { entity: wolf, killer: game.player });
  const r = v.rumors.list.find((x) => x.kind === 'rescued');
  assert.ok(r, 'the rescue became news');
  assert.ok(events.some((e) => e.type === 'rumor'));
  assert.ok(r.heardBy.includes('tansy'));
  const heard0 = r.heardBy.length;
  // News travels by meeting (DESIGN §29.2): out by the player, Tansy tells nobody…
  run(game, 60);
  assert.equal(r.heardBy.length, heard0, 'nobody she has not met has heard');
  // …back among her neighbours, she tells them, and they tell each other.
  people.tansy.x = 100 + 16;
  people.tansy.y = 100 + 16;
  run(game, 400);
  assert.ok(r.heardBy.length > heard0 + 3, `spread to ${r.heardBy.length}`);
  assert.ok(people.tobias.opinionOfPlayer > before, 'her father thinks better of the player');
  for (const id of r.heardBy) if (VILLAGERS.includes(id)) assert.ok(v.rumors.render(r, id, { stranger: 'the stranger' }), `${id} can tell it`);
  assert.equal(r.text, 'the stranger pulled a wolf off Tansy', 'the rumor reads as the village tells it');
  // Tansy herself is never told what happened to her.
  const told = v.log.filter((c) => c.topic === 'rumor' && c.effects?.rumor === r.id);
  assert.ok(told.every((c) => !(c.b === 'tansy' && c.a !== 'tansy' && c.lines.some((l) => l.speaker !== 'tansy' && /tansy/i.test(l.text)))));
});

test('retellings may grow but keep their placeholders whole', () => {
  const rs = new Rumors();
  const r = rs.add({ kind: 'hit_lyra', heardBy: ['hess'], t: 0, day: 1 });
  const rng = new RNG(3);
  const ids = VILLAGERS.filter((x) => x !== 'hess');
  let prev = 'hess';
  for (const id of ids) {
    rs.hear(r, id, prev, rng);
    prev = id;
  }
  const versions = new Set(VILLAGERS.map((id) => rs.render(r, id)));
  assert.ok(versions.size >= 2, 'the story grew somewhere along the way');
  for (const s of versions) assert.ok(s && !/\{/.test(s), s);
});

test('attacking Lyra: fast word, cold village, shut shop, barred Kettle, slow amends', () => {
  const { game, people, v } = makeGame({ hour: 15 });
  for (const e of Object.values(people)) e.opinionOfPlayer = 45;
  people.elda.profile = { ...people.elda.profile, shop: people.elda.profile.shop || { sells: [] } };
  // Hess saw it.
  people.hess.x = game.player.x + 30;
  people.hess.y = game.player.y;
  game.bus.emit('deed', { deed: 'downed_lyra', severity: -10, text: 'Knocked me out cold.', victim: null });
  v.onEvent('deed', { deed: 'downed_lyra', severity: -10, text: 'Knocked me out cold.', victim: null });
  const r = v.rumors.list.find((x) => x.kind === 'downed_lyra');
  assert.ok(r && r.heardBy.includes('hess') && r.heardBy.includes('lyra'));
  // Hess walks back to the market, where everyone is, and the word goes round face to face.
  people.hess.x = 100 + 32;
  people.hess.y = 100;
  run(game, 300);
  const heard = VILLAGERS.filter((id) => r.heardBy.includes(id));
  assert.ok(heard.length >= 14, `fast: ${heard.length} heard within a few hours`);
  // Opinions fall across the village, most among those who love her.
  const fall = (id) => 45 - people[id].opinionOfPlayer;
  assert.ok(fall('wenna') >= 20 && fall('hobb') >= 20, `parents ${fall('hobb')} ${fall('wenna')}`);
  assert.ok(fall('wenna') > fall('tansy'), 'her mother more than Tansy');
  const avg = VILLAGERS.reduce((s, id) => s + fall(id), 0) / VILLAGERS.length;
  assert.ok(avg >= 10, `village average fall ${avg}`);
  // The next morning they are still raw.
  people.wenna.wrongedDay = -1;
  v.onEvent('new_day', { day: game.clock.day });
  assert.equal(people.wenna.wrongedDay, game.clock.day);
  // Shops refuse while it is fresh; the Kettle is barred.
  assert.equal(v.standing('elda').refusesTrade, true);
  assert.ok(v.standing('wenna').grievance?.grave);
  assert.ok(v.barred('ember_kettle'), 'barred from the Kettle');
  assert.equal(v.barred('smithy'), null);
  // Saying hello to her mother gets nothing warm.
  return v.playerSays(people.wenna, 'oh hello, how are you?').then(async (rep) => {
    assert.ok(rep.lines.length >= 1);
    assert.ok(!VOICES.wenna.howAreYou.includes(rep.lines[0]), `cold: ${rep.lines[0]}`);
    // Amends: an apology, slowly.
    const o0 = people.wenna.opinionOfPlayer;
    const ap = await v.playerSays(people.wenna, "I'm sorry. I'm truly sorry.");
    assert.ok(ap.lines[0].length > 3);
    assert.ok(people.wenna.opinionOfPlayer > o0, 'a little better');
    assert.ok(people.wenna.opinionOfPlayer - o0 < 6, 'only a little');
    // A gift next.
    v.onEvent('item_given', { from: game.player, to: people.wenna, itemId: 'honey' });
    assert.ok(people.wenna.opinionOfPlayer > o0 + 2);
    // A third amend the same day counts for nothing.
    const o1 = people.wenna.opinionOfPlayer;
    v.amend('wenna', 'apology');
    assert.equal(people.wenna.opinionOfPlayer, o1);
  });
});

test('a crime against a villager becomes news; love for the victim weighs it', () => {
  const { game, people, v } = makeGame({ hour: 11 });
  for (const e of Object.values(people)) e.opinionOfPlayer = 50;
  v.onEvent('crime', { actor: game.player, victim: people.tansy, kind: 'knockout' });
  const r = v.rumors.list.find((x) => x.kind === 'downed_villager' && x.victim === 'tansy');
  assert.ok(r);
  run(game, 300);
  assert.ok(r.heardBy.includes('tobias'));
  assert.ok(50 - people.tobias.opinionOfPlayer > 50 - people.wys.opinionOfPlayer, 'her father takes it hardest');
  assert.ok(v.barred('ember_kettle'), 'the watch bars the Kettle after a knock-out');
});

test('Lyra leaving the player is village news', () => {
  const { game, v } = makeGame();
  v.onEvent('companionship_changed', { state: 'left', previous: 'together', reason: 'test' });
  assert.ok(v.rumors.list.some((r) => r.kind === 'lyra_left' && r.about === 'lyra'));
  v.onEvent('room_rented', { npc: null, actor: game.companion || null });
});

// ------------------------------------------------------------------ talking to anyone

test('"oh hello, how are you?" gets each villager\'s own warm answer', async () => {
  const { people, v } = makeGame({ hour: 10 });
  for (const id of VILLAGERS) {
    const e = people[id];
    e.opinionOfPlayer = 55;
    const r = await v.playerSays(e, 'oh hello, how are you?');
    assert.ok(Array.isArray(r.lines) && r.lines.length >= 1 && r.lines.length <= 3, `${id}: ${r.lines}`);
    for (const l of r.lines) {
      assert.ok(!/\{\w+\}/.test(l), `${id}: ${l}`);
      assert.ok(speakable(l));
    }
    const how = e.profile.howAreYou || VOICES[id].howAreYou;
    assert.ok(r.lines.some((l) => how.includes(l)), `${id} answers how they are: ${r.lines.join(' | ')}`);
    assert.ok(['warm', 'neutral', 'happy'].includes(r.mood), `${id} mood ${r.mood}`);
    assert.ok(!r.lines.some((l) => HOW_RE.test(l) && how.includes(l) === false && /hello/i.test(l)), 'no greeting that asks back the same thing');
  }
  const hobb = await v.playerSays(people.hobb, 'Hello Hobb! How are you today?');
  assert.ok(hobb.lines.some((l) => /creaking|upright|lit/i.test(l)), hobb.lines.join(' | '));
});

test('understanding: greetings, questions, thanks, insults, threats', () => {
  const u = (t) => understand(t);
  assert.ok(u('oh hello, how are you?').intents.has('howare'));
  assert.ok(u('oh hello, how are you?').intents.has('greet'));
  assert.ok(u('thank you so much').intents.has('thanks'));
  assert.ok(u('you are an idiot').intents.has('insult'));
  assert.ok(u("i'll kill you").intents.has('threat'));
  assert.ok(!u("i'll kill you").intents.has('insult'));
  assert.equal(u('what do you think of Bram?').person, 'bram');
  assert.equal(u('tell me about the bandits').topic, 'bandits');
  assert.equal(u('have you seen Maren?').person, 'maren');
  assert.ok(u("what's the news?").intents.has('news'));
});

test('talking moves opinions, remembers the exchange and raises news', async () => {
  const { game, people, v } = makeGame({ hour: 10 });
  const pip = people.pip;
  const o = pip.opinionOfPlayer;
  await v.playerSays(pip, 'thank you, Pip');
  assert.ok(pip.opinionOfPlayer > o);
  const o2 = pip.opinionOfPlayer;
  const ins = await v.playerSays(pip, 'you are stupid');
  assert.ok(pip.opinionOfPlayer < o2);
  assert.ok(ins.lines[0].length > 2);
  const o3 = people.bram.opinionOfPlayer;
  await v.playerSays(people.bram, "I'll kill you, old man");
  assert.ok(people.bram.opinionOfPlayer <= o3 - 10);
  assert.ok(v.rumors.list.some((r) => r.kind === 'threat' && r.victim === 'bram'));
  assert.equal(v.talks.pip.length, 2);
  // News comes up when they next talk to you.
  v.addRumor('rescued', { victim: 'tansy', beast: 'wolf', witnesses: ['tansy', 'corran'] });
  const rep = await v.playerSays(people.corran, 'hello');
  assert.ok(rep.lines.some((l) => /wolf off Tansy/i.test(l)), rep.lines.join(' | '));
  const again = await v.playerSays(people.corran, 'hello');
  assert.ok(!again.lines.some((l) => /wolf off Tansy/i.test(l)), 'said once, not every time');
  // Asking about people, topics and news.
  const ab = await v.playerSays(people.wenna, 'what do you think of Petra?');
  assert.ok(ab.lines[0].length > 3);
  const news = await v.playerSays(people.elda, "what's the news?");
  assert.ok(news.lines[0].length > 3);
  const asleep = people.hobb;
  asleep.state = 'sleep';
  const zz = await v.playerSays(asleep, 'hello?');
  assert.ok(zz.lines.length === 1);
});

test('asking about a topic tells the player for npc_topic (Aveline about Maren)', async () => {
  const { people, v, events } = makeGame();
  await v.playerSays(people.aveline, 'Sister, what do you know about Maren?');
  assert.ok(events.some((e) => e.type === 'npc_topic' && e.p.npc === people.aveline && e.p.topic === 'maren'));
});

// ------------------------------------------------------------------ Claude: only on player actions

test('Claude is asked only from playerSays, listenIn and nightSummary, never from update()', async () => {
  const provider = mockProvider('claude.ai');
  const { game, people, v } = makeGame({ provider, hour: 19 });
  game.player.x = people.hobb.x + 10;
  game.player.y = people.hobb.y + 10;
  run(game, 200);
  assert.equal(provider.calls.length, 0, 'the village lived without asking Claude');
  const r = await v.playerSays(people.hobb, 'oh hello, how are you?');
  assert.equal(provider.calls.length, 1);
  assert.deepEqual(r.lines, ['Well now. Fine, thank you for asking.']);
  assert.ok(provider.calls[0].task.includes('Hobb Ambrel'));
  assert.ok(provider.calls[0].task.includes('oh hello, how are you?'));
  assert.ok(provider.calls[0].schema);
  const c = v.converse('hobb', 'corran', { onScreen: true });
  const conv = v.canListen();
  assert.ok(conv, 'a conversation to listen to');
  const lines = await v.listenIn(conv);
  assert.equal(provider.calls.length, 2);
  assert.ok(lines.length >= 4 && lines.length <= 8);
  assert.ok(lines.every((l) => ['hobb', 'corran'].includes(l.speaker)));
  const night = await v.nightSummary(game.clock.day);
  assert.equal(provider.calls.length, 3);
  assert.ok(night.length >= 2 && night.length <= 6);
  run(game, 200);
  assert.equal(provider.calls.length, 3);
  assert.ok(c);
});

test("always-on mode: ambient talk from Claude only with the player's API key, at most every 45 s", async () => {
  const runA = async (game, seconds) => {
    for (let t = 0; t < seconds; t += 5) {
      run(game, 5);
      await new Promise((r) => setImmediate(r));
    }
  };
  const sampling = mockProvider('claude.ai');
  const a = makeGame({ provider: sampling, settings: { villageAi: 'always' } });
  a.game.player.x = a.people.hobb.x + 10;
  a.game.player.y = a.people.hobb.y;
  await runA(a.game, 200);
  assert.equal(sampling.calls.length, 0, 'never with claude.ai sampling');
  const api = mockProvider('api');
  const b = makeGame({ provider: api, settings: { villageAi: 'always' } });
  b.game.player.x = b.people.hobb.x + 10;
  b.game.player.y = b.people.hobb.y;
  await runA(b.game, 100);
  assert.ok(api.calls.length >= 1, 'ambient talk asked for');
  assert.ok(api.calls.length <= Math.ceil(100 / 45) + 1, `${api.calls.length} calls in 100 s`);
  const off = mockProvider('api');
  const c = makeGame({ provider: off });
  c.game.player.x = c.people.hobb.x + 10;
  c.game.player.y = c.people.hobb.y;
  await runA(c.game, 100);
  assert.equal(off.calls.length, 0, "default 'player' mode never asks from update");
});

test('a Claude line that speaks a hidden truth falls back to the local answer', async () => {
  const provider = mockProvider('claude.ai', { say: 'Between us, Varek is my brother.', opinion_delta: 2 });
  const { people, v } = makeGame({ provider });
  const r = await v.playerSays(people.sabeth, 'hello, how are you?');
  assert.ok(!/varek/i.test(r.lines.join(' ')));
  assert.ok(r.lines.length >= 1);
  const broken = mockProvider('claude.ai', () => {
    throw Object.assign(new Error('nope'), { code: 'rate_limited' });
  });
  const g2 = makeGame({ provider: broken });
  const r2 = await g2.v.playerSays(g2.people.petra, 'how are you?');
  assert.ok(r2.lines.length >= 1 && speakable(r2.lines[0]));
});

// ------------------------------------------------------------------ the night, and saving

test('while you slept: 3–6 lines of the day, local first', async () => {
  const { game, people, v } = makeGame({ hour: 18 });
  v.addRumor('rescued', { victim: 'tansy', beast: 'wolf', witnesses: ['tansy'] });
  run(game, 200);
  const lines = await v.nightSummary(game.clock.day);
  assert.ok(lines.length >= 3 && lines.length <= 6, lines.join('\n'));
  assert.ok(lines.some((l) => /wolf off Tansy/i.test(l)), lines.join('\n'));
  for (const l of lines) assert.ok(typeof l === 'string' && !/\{/.test(l) && speakable(l), l);
  assert.ok(people.hobb);
});

test('save and load round-trip bonds, rumors, the log, exchanges and bars', async () => {
  const { game, people, v } = makeGame({ hour: 19 });
  v.adjustBond('tilly', 'wys', { affinity: 12, trust: -5 }, 'test');
  v.addRumor('downed_lyra', { witnesses: ['hess', 'lyra'] });
  run(game, 120);
  await v.playerSays(people.mira, 'hello Mira');
  v.bar('ember_kettle', { days: 1, by: 'rowan', reason: 'test' });
  const data = JSON.parse(JSON.stringify(v.serialize()));
  const fresh = makeGame({ hour: 19 });
  fresh.v.deserialize(data);
  assert.deepEqual(fresh.v.bond('tilly', 'wys'), v.bond('tilly', 'wys'));
  assert.equal(fresh.v.rumors.list.length, v.rumors.list.length);
  assert.deepEqual(fresh.v.rumors.list.map((r) => [r.kind, r.heardBy.length]), v.rumors.list.map((r) => [r.kind, r.heardBy.length]));
  assert.equal(fresh.v.log.length, v.log.length);
  assert.deepEqual(fresh.v.log.map((c) => c.summary), v.log.map((c) => c.summary));
  assert.equal(fresh.v.talks.mira.length, 1);
  assert.ok(fresh.v.barred('ember_kettle'));
  assert.ok(JSON.stringify(data).length < 60000, `save size ${JSON.stringify(data).length}`);
});

test('the village plugin is registered and creates game.village with save hooks', () => {
  assert.ok(BUILTIN_PLUGINS.includes(villagePlugin));
  const { game } = makeGame();
  delete game.village;
  game.plugins.register(villagePlugin);
  game.plugins.installAll();
  assert.ok(game.village instanceof Village);
  const s = game.plugins.serialize();
  assert.ok(s.village && s.village.v === 1);
  game.plugins.deserialize(s);
  assert.equal(DEFAULT_SETTINGS.villageAi, 'player');
});

test('exchanges are pure data: buildExchange with a bare context', () => {
  const ctx = { rng: new RNG(1), bond: () => ({ affinity: 30, trust: 50, familiarity: 50, tags: [] }), weather: 'rain', isNight: false };
  for (let i = 0; i < 30; i++) {
    const ex = buildExchange(ctx, 'garrick', 'elda', {});
    assert.ok(ex.lines.length >= 2);
  }
  assert.ok(ALIASES.hobb.length);
});

// ------------------------------------------------------------------ Lyra, with her own mind

import { Mind } from '../src/ai/mind/mind.js';
import { Inventory } from '../src/entities/items.js';
import { generateWorld } from '../src/world/worldgen.js';
import { socialPlugin } from '../src/ai/plugins/social_plugin.js';
import { relationshipsPlugin } from '../src/ai/plugins/relationships_plugin.js';
import { memoryPlugin } from '../src/ai/plugins/memory_plugin.js';

const WORLD = (() => {
  const g = { bus: new EventBus(), rng: new RNG(7), flags: {}, time: 0, clock: { t: 300, hour: 8, daylight: 1, weather: { type: 'clear' } }, entities: { list: [], nearest: () => null }, atlas: null, ui: null };
  return generateWorld(g, 1337);
})();

function withLyra({ hour = 18.5 } = {}) {
  const made = makeGame({ hour });
  const { game } = made;
  Object.assign(game, { map: WORLD.map, objects: WORLD.objects, locations: WORLD.locations, spawns: WORLD.spawns });
  game.bubbles = { said: [], say(e, text) { this.said.push({ id: e?.id, text }); }, thought() {}, icon() {}, isBusy: () => false, clear() {} };
  const lyra = new Actor(game, { id: 'lyra', name: 'Lyra', faction: 'player', x: made.people.hobb.x + 10, y: made.people.hobb.y, maxHp: 45, inventory: new Inventory({ coin: 8 }) });
  lyra.behavior = { directive: { type: 'independent' }, stance: 'defend', setDirective(d) { this.directive = { ...d }; return { ok: true }; }, status: () => 'living her own life', emote() {} };
  game.companion = game.entities.add(lyra);
  lyra.mind = new Mind(game, lyra);
  for (const p of [relationshipsPlugin, memoryPlugin, socialPlugin]) game.plugins.register(p);
  game.plugins.installAll();
  // Everyone else elsewhere: just Lyra and her parents.
  for (const [id, e] of Object.entries(made.people)) if (id !== 'hobb' && id !== 'wenna') e.x += 2000;
  made.people.wenna.x = made.people.hobb.x + 20;
  made.people.wenna.y = made.people.hobb.y;
  return { ...made, lyra, mind: lyra.mind };
}

test('Lyra, on her own time, talks with her parents as herself and her mind keeps it', () => {
  const { game, v, mind, events, people } = withLyra();
  mind.relationships.ensure(people.hobb);
  mind.relationships.ensure(people.wenna);
  const mem0 = mind.memory.all ? mind.memory.all().length : mind.memory.list.length;
  run(game, 120);
  const talks = v.log.filter((c) => c.a === 'lyra' || c.b === 'lyra');
  assert.ok(talks.length >= 1, 'she talked with someone');
  assert.ok(talks.every((c) => ['hobb', 'wenna'].includes(c.a === 'lyra' ? c.b : c.a)));
  assert.ok(events.some((e) => e.type === 'conversation' && e.p.a === game.companion));
  const mem1 = mind.memory.all ? mind.memory.all().length : mind.memory.list.length;
  assert.ok(mem1 > mem0, 'remembered');
  const rel = mind.relationships.get('hobb') || mind.relationships.get('wenna');
  assert.ok(rel.interactions >= 1);
  for (const c of talks) for (const l of c.lines) assert.ok(!/\{\w+\}/.test(l.text) && speakable(l.text), l.text);
});

test('news reaches Lyra as hearsay, weaker than what she saw', () => {
  const { game, v, mind } = withLyra();
  const r = v.addRumor('rescued', { victim: 'tansy', beast: 'wolf', witnesses: ['hobb'] });
  v.converse('hobb', 'lyra', { topic: 'rumor' });
  assert.ok(r.heardBy.includes('lyra'));
  const k = mind.knowledgeStore.list.find((x) => /wolf off Tansy/i.test(x.text));
  assert.ok(k, 'she knows what she heard');
  assert.equal(k.kind, 'rumor');
  assert.ok(k.confidence <= 0.5);
  assert.ok(/says/.test(k.text));
  assert.ok(game);
});

test("Lyra's prompt gets a compact line of village news", () => {
  const { v, people } = withLyra();
  v.addRumor('rescued', { victim: 'tansy', beast: 'wolf', witnesses: ['hobb', 'lyra'] });
  v.rumors.list[0].source = 'hobb';
  const s = v.promptContext();
  assert.ok(s.length > 0 && s.length <= 480, s);
  assert.ok(/wolf off Tansy|thinks of/i.test(s), s);
  assert.ok(people.hobb);
});

test("what's on her mind comes up with the people she is close to", () => {
  const { v, mind, people } = withLyra();
  mind.relationships.ensure(people.wenna);
  mind.relationships.adjust('wenna', { affinity: 90 }, 'test');
  mind.addThought('The well hitches at dusk. I can hear it.');
  let found = false;
  for (let i = 0; i < 40 && !found; i++) {
    v.pairAt.clear();
    const c = v.lyraConverse('wenna', { onScreen: false });
    if (c && c.lines.some((l) => l.speaker === 'lyra' && /well hitches/.test(l.text))) found = true;
    if (c) for (let k = 1; k < c.lines.length; k++) assert.notEqual(c.lines[k].speaker, c.lines[k - 1].speaker);
  }
  assert.ok(found, 'she told her mother what is on her mind');
});

import { NPC } from '../src/entities/npc.js';

test('a call for help after the player strikes Lyra becomes fast news', () => {
  const { game, people, v } = makeGame({ hour: 14 });
  const lyra = game.entities.add(new Actor(game, { id: 'lyra', name: 'Lyra', faction: 'player', x: people.hobb.x + 20, y: people.hobb.y, maxHp: 45 }));
  game.companion = lyra;
  v.onEvent('call_for_help', { victim: lyra, attacker: game.player, x: lyra.x, y: lyra.y, severity: 0.6 });
  const r = v.rumors.list.find((x) => x.kind === 'hit_lyra');
  assert.ok(r && r.heardBy.includes('hobb'), 'those in earshot heard it');
  lyra.downed = true;
  v.onEvent('call_for_help', { victim: lyra, attacker: game.player, x: lyra.x, y: lyra.y, severity: 2 });
  assert.ok(v.rumors.list.some((x) => x.kind === 'downed_lyra'));
  // Someone else's fight is not the player's news.
  const n = v.rumors.list.length;
  v.onEvent('call_for_help', { victim: lyra, attacker: { id: 'wolf_1' }, x: lyra.x, y: lyra.y, severity: 0.5 });
  assert.equal(v.rumors.list.length, n);
});

test('npc.js: villagers leave each other to the village and still answer the player', () => {
  const { game, v } = makeGame({ hour: 12 });
  game.combat = { hasCrime: () => false, isHostile: () => false };
  const bram = new NPC(game, NPC_PROFILES.find((p) => p.id === 'bram'), { x: 300, y: 300 });
  const elda = new NPC(game, NPC_PROFILES.find((p) => p.id === 'elda'), { x: 320, y: 300 });
  game.entities.add(bram);
  game.entities.add(elda);
  assert.equal(bram.hears(elda, 'Hello, Bram!'), null, 'neighbour chatter goes through the village');
  game.player.x = 310;
  game.player.y = 300;
  const reply = bram.hears(game.player, 'hello bram');
  assert.ok(typeof reply === 'string' && reply.length > 1, 'the player still gets a greeting');
  const started = bram.chatWith(elda);
  assert.equal(typeof started, 'boolean');
  if (started) assert.ok(v.log.some((c) => (c.a === 'bram' && c.b === 'elda') || (c.a === 'elda' && c.b === 'bram')));
});

// ------------------------------------------------------------------ verifier's additions

test('"what do you think of me?" gets each villager\'s own view of the player, by how they stand', async () => {
  const { v, people } = makeGame({ hour: 11 });
  const seen = new Set();
  for (const id of VILLAGERS) {
    const e = people[id];
    for (const [o, stance] of [[80, 'good'], [45, 'mid'], [20, 'bad']]) {
      e.opinionOfPlayer = o;
      const r = await v.playerSays(e, 'What do you think of me?');
      const line = r.lines[0];
      assert.ok(TO_YOU[id].think[stance].includes(line), `${id} (${stance}): ${line}`);
      seen.add(line);
    }
  }
  assert.ok(seen.size >= 50, `varied (${seen.size})`);
});

test('a compliment on their shop, stew or forge is heard as a compliment', () => {
  for (const t of ['You have a lovely shop, you know.', 'Your stew is the best.', 'What a fine forge.', 'I love your honey cakes!', "You're a good cook, Elda."]) {
    assert.ok(understand(t).intents.has('compliment'), t);
  }
});

test('a rumor told after "have you heard?" starts its sentence with a capital', () => {
  const { v } = makeGame({ hour: 11 });
  v.addRumor('attacked_villager', { victim: 'bram', witnesses: ['elda'] });
  let checked = 0;
  for (let i = 0; i < 30; i++) {
    v.pairAt.clear();
    v.personAt.clear();
    const r = v.rumors.list[0];
    r.heardBy = ['bram', 'elda'];
    const c = v.converse('elda', 'pip', { topic: 'rumor' });
    for (const l of c.lines) {
      assert.ok(!/[!?.]\s+[a-z]/.test(l.text.replace(/\.\.\.\s*[a-z]/g, '')), l.text);
      checked++;
    }
  }
  assert.ok(checked > 0);
});

test('listening in never has one speaker twice running, nor a goodbye mid-talk', async () => {
  const { v } = makeGame({ hour: 19 });
  for (let i = 0; i < 25; i++) {
    v.pairAt.clear();
    v.personAt.clear();
    const conv = v.converse('elda', 'pip', { onScreen: true });
    const lines = await v.listenIn({ id: conv.id, a: 'elda', b: 'pip', topic: conv.topic });
    assert.ok(lines.length >= 2);
    for (let k = 1; k < lines.length; k++) assert.notEqual(lines[k].speaker, lines[k - 1].speaker, lines.map((l) => `${l.speaker}: ${l.text}`).join(' / '));
  }
});

test('scenes keep their hour: the bread war by day, the far lamps at dusk; none repeats within three days', () => {
  const { v } = makeGame({ hour: 2 });
  const dayScenes = SCENES.filter((s) => s.day);
  const duskScenes = SCENES.filter((s) => s.dusk);
  assert.ok(dayScenes.length && duskScenes.length);
  for (let i = 0; i < 40; i++) {
    v.pairAt.clear();
    v.personAt.clear();
    const c = v.converse('elda', 'garrick', {});
    assert.ok(!c.lines.some((l) => /^Fresh bread! Six coppers!$/.test(l.text)), 'no market cry at 2 in the morning');
  }
  const { v: v2 } = makeGame({ hour: 11 });
  const played = new Map();
  for (let i = 0; i < 60; i++) {
    v2.pairAt.clear();
    v2.personAt.clear();
    v2.converse('rowan', 'wys', {});
  }
  const rw = SCENES.findIndex((s) => s.with.includes('rowan') && s.with.includes('wys'));
  const n = v2.log.filter((c) => c.lines?.some((l) => l.text === SCENES[rw].lines[0][1])).length;
  assert.ok(n <= 1, `the Duchess scene played ${n} times in one day`);
  assert.ok(played);
});

test('Lyra says she saw what she saw, and heard what she heard', () => {
  const { game, v } = withLyra({ hour: 18.5 });
  // She was there.
  game.companion.x = game.player.x + 10;
  game.companion.y = game.player.y;
  v.onEvent('deed', { deed: 'attacked_villager', victim: 'bram', severity: -6 });
  const r = v.rumors.list.find((x) => x.kind === 'attacked_villager');
  assert.ok(r.saw.includes('lyra'));
  let saw = false;
  for (let i = 0; i < 30 && !saw; i++) {
    v.pairAt.clear();
    v.personAt.clear();
    r.heardBy = r.heardBy.filter((x) => x !== 'hobb');
    const c = v.lyraConverse('hobb', { topic: 'rumor', lyraFirst: true });
    if (c?.lines.some((l) => l.speaker === 'lyra' && /I was there|saw it myself/.test(l.text))) saw = true;
    if (c) assert.ok(!c.lines.some((l) => l.speaker === 'lyra' && /^I heard the stranger/.test(l.text)), c.lines.map((l) => l.text).join(' / '));
  }
  assert.ok(saw, 'she told it as an eyewitness');
  // Far away, her ledger knows it but she did not see it.
  game.companion.x = game.player.x + 2000;
  v.onEvent('deed', { deed: 'stole', victim: 'garrick', severity: -3 });
  const s = v.rumors.list.find((x) => x.kind === 'stole');
  assert.ok(s.heardBy.includes('lyra') && !s.saw.includes('lyra'));
});
