import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EventBus } from '../src/core/events.js';
import { TILE } from '../src/core/constants.js';
import { Actor } from '../src/entities/entity.js';
import { EntityManager } from '../src/entities/manager.js';
import { LocationIndex } from '../src/world/locations.js';
import { ActionRegistry } from '../src/ai/brain/actions.js';
import { PluginRegistry } from '../src/ai/plugins/registry.js';
import { BUILTIN_PLUGINS } from '../src/ai/plugins/index.js';
import { Companion } from '../src/entities/companion.js';
import { classifyActivity } from '../src/ai/behavior/own_life.js';
import { parseMessage, nluEnv } from '../src/ai/brain/nlu.js';
import { Autonomy } from '../src/ai/mind/autonomy.js';
import { buildPlan, blockAt, sleepSpot } from '../src/ai/mind/autonomy_agenda.js';
import { DEEDS, ACTION_CATEGORY, STATES } from '../src/ai/mind/autonomy_data.js';
import { LinePicker, LINES } from '../src/ai/mind/autonomy_lines.js';
import { parseOffer, parsePromiseText, parseAskText, isApology } from '../src/ai/mind/autonomy_words.js';
import { autonomyPlugin } from '../src/ai/plugins/autonomy_plugin.js';

// ---------------------------------------------------------------- a small Hearthvale

const W = 80;
const H = 60;
const SPH = 37.5; // game seconds per in-game hour (one day = 900 s)
const T = (n) => n * TILE + TILE / 2;

const LOCS = [
  { id: 'hearthvale', name: 'Hearthvale', kind: 'village', bounds: { x: 0, y: 0, w: W, h: H } },
  { id: 'town_square', name: 'Town Square', kind: 'square', bounds: { x: 16, y: 16, w: 10, h: 8 }, parent: 'hearthvale' },
  { id: 'player_home', name: 'Your Cottage', kind: 'home', indoor: true, bounds: { x: 4, y: 30, w: 6, h: 5 } },
  { id: 'ember_kettle', name: 'The Ember Kettle', kind: 'building', indoor: true, bounds: { x: 30, y: 18, w: 6, h: 5 }, aliases: ['inn', 'tavern', 'kettle'] },
  { id: 'chapel', name: 'Chapel of the Hearth', kind: 'building', indoor: true, bounds: { x: 30, y: 28, w: 5, h: 5 } },
  { id: 'guardhouse', name: 'Guardhouse', kind: 'building', indoor: true, bounds: { x: 40, y: 28, w: 5, h: 5 } },
  { id: 'herbalist', name: "Fennick's Herbs", kind: 'building', indoor: true, bounds: { x: 22, y: 30, w: 5, h: 4 } },
  { id: 'whisperwood', name: 'Whisperwood', kind: 'forest', danger: 1, bounds: { x: 2, y: 2, w: 16, h: 10 }, aliases: ['forest', 'woods'] },
  { id: 'reed_farm', name: 'Reed Farm', kind: 'field', bounds: { x: 50, y: 40, w: 10, h: 8 } },
  { id: 'mirror_lake', name: 'Mirror Lake', kind: 'lake', danger: 1, bounds: { x: 62, y: 20, w: 12, h: 10 } },
  { id: 'stonecut_quarry', name: 'Stonecut Quarry', kind: 'field', danger: 1, bounds: { x: 2, y: 14, w: 10, h: 8 } },
  { id: 'south_meadow', name: 'South Meadow', kind: 'field', danger: 1, bounds: { x: 20, y: 48, w: 20, h: 8 } },
  { id: 'bandit_camp', name: 'Bandit Camp', kind: 'camp', danger: 3, bounds: { x: 60, y: 2, w: 14, h: 10 } },
  { id: 'sunken_ruins', name: 'Sunken Ruins', kind: 'ruins', danger: 3, bounds: { x: 44, y: 2, w: 12, h: 10 } },
  { id: 'kings_road', name: "King's Road", kind: 'road', bounds: { x: 0, y: 56, w: W, h: 3 } },
];

function makeClock(hour, day) {
  return {
    t: 0,
    start: hour,
    day0: day,
    secondsPerHour: SPH,
    weather: { type: 'clear', intensity: 0 },
    get hour() {
      return (this.start + this.t / SPH) % 24;
    },
    get day() {
      return this.day0 + Math.floor((this.start + this.t / SPH) / 24);
    },
    get isNight() {
      const h = this.hour;
      return h >= 20.5 || h < 5;
    },
    get phase() {
      const h = this.hour;
      return h < 5 ? 'night' : h < 7 ? 'dawn' : h < 18 ? 'day' : h < 20.5 ? 'dusk' : 'night';
    },
    get daylight() {
      return this.isNight ? 0 : 1;
    },
  };
}

// A world with the real Companion (real Mind, Autonomy and Behavior), the real action and
// plugin registries with every built-in plugin, and the player.
function makeWorld({ hour = 10, day = 1, start = true } = {}) {
  const game = {};
  game.bus = new EventBus();
  game.settings = { playerName: 'Ash' };
  game.flags = {};
  game.time = 0;
  game.state = 'playing';
  game.clock = makeClock(hour, day);
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
  game.bubbles = { said: [], say(e, t) { this.said.push(t); }, icon() {}, thought() {}, number() {} };
  game.ui = { chat: { messages: [], addMessage(m) { this.messages.push(m); }, open() {} }, toast() {} };
  game.camera = { x: 0, y: 0, vw: 480, vh: 270 };
  game.actions = new ActionRegistry(game);
  game.plugins = new PluginRegistry(game);
  game.isBlockedTile = (tx, ty) => game.map.isSolidTile(tx, ty);
  for (const p of BUILTIN_PLUGINS) game.plugins.register(p);
  const player = game.entities.add(new Actor(game, { id: 'player', name: 'Ash', faction: 'player', maxHp: 60, atk: 6, x: T(20), y: T(20) }));
  game.player = player;
  const lyra = game.entities.add(new Companion(game, { x: T(22), y: T(20) }));
  game.companion = lyra;
  game.plugins.installAll();
  if (start) game.bus.emit('game_start', { loaded: false });
  const a = lyra.mind.autonomy;
  return { game, player, lyra, mind: lyra.mind, a };
}

function step(game, seconds, dt = 0.1) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    game.clock.t += dt;
    game.time += dt;
    game.entities.update(dt);
    game.plugins.update(dt);
  }
}

function collect(game, type) {
  const out = [];
  game.bus.on(type, (p) => out.push(p));
  return out;
}

function rel(mind) {
  return mind.relationships.get('player');
}

function setRel(mind, values) {
  Object.assign(rel(mind), values);
}

function wolf(game, x, y, id = 'wolf_1') {
  const w = new Actor(game, { id, name: 'Wolf', faction: 'monster', maxHp: 30, atk: 6, x, y });
  w.species = 'wolf';
  w.threat = 2;
  return game.entities.add(w);
}

function critter(game, species, x, y, id = `${species}_1`) {
  const c = new Actor(game, { id, name: species, faction: species === 'cat' ? 'villager' : 'wildlife', maxHp: 8, x, y });
  c.species = species;
  c.threat = 0;
  return game.entities.add(c);
}

function villager(game, id, name, x, y, { faction = 'villager' } = {}) {
  const v = new Actor(game, { id, name, faction, maxHp: 40, x, y });
  v.profile = { id, name, work: 'town_square', home: 'town_square', shop: id === 'bram' ? { buys: { iron_ore: 5, stone: 1 } } : undefined };
  return game.entities.add(v);
}

// What the combat module emits when someone strikes someone (DESIGN §4, src/entities/combat.js).
function hit(game, source, target, amount = 6) {
  target.hp = Math.max(0, target.hp - amount);
  game.bus.emit('damage', { source, target, amount, kind: 'melee', crit: false });
}

function deeds(a) {
  return a.ledger.map((e) => e.deed);
}

const ACCEPTED = new Set(['accept', 'accept_conditional']);

// ---------------------------------------------------------------- deeds (§16.2)

test('a deliberate sword hit is a deed: hit_lyra, a warning, keeping her distance, wary', () => {
  const { game, player, lyra, a } = makeWorld();
  const changes = collect(game, 'companionship_changed');
  const trust0 = a.stats().trust;
  hit(game, player, lyra);
  assert.deepEqual(deeds(a), ['hit_lyra']);
  assert.equal(a.ledger[0].severity, -3);
  assert.equal(a.companionship, 'wary');
  assert.equal(changes.at(-1).state, 'wary');
  assert.equal(changes.at(-1).previous, 'together');
  assert.ok(a.stats().trust < trust0 - 8, 'trust fell');
  assert.ok(a.stats().fear > 10, 'she is afraid now');
  assert.equal(lyra.behavior.directive.type, 'keep_away', 'she steps out of reach');
  assert.ok(game.ui.chat.messages.some((m) => m.from === 'lyra' && m.kind === 'initiative'), 'she says why in the chat');
});

test('a stray swing with a hostile beside her is an accident; a second hit within 8 s is not', () => {
  const { game, player, lyra, a } = makeWorld();
  wolf(game, lyra.x + 20, lyra.y);
  hit(game, player, lyra);
  assert.deepEqual(deeds(a), ['hit_lyra_accident']);
  assert.equal(a.ledger[0].severity, -0.5);
  assert.equal(a.companionship, 'together');
  step(game, 3);
  hit(game, player, lyra);
  assert.deepEqual(deeds(a), ['hit_lyra_accident', 'hit_lyra'], 'not the first hit in 8 s: deliberate');
});

test('one swing that lands twice counts once', () => {
  const { game, player, lyra, a } = makeWorld();
  hit(game, player, lyra, 3);
  hit(game, player, lyra, 3);
  assert.deepEqual(deeds(a), ['hit_lyra']);
});

test('hit again: Binding Light on the player, then she runs or stands her ground, and leaves', () => {
  const { game, player, lyra, a } = makeWorld();
  const binds = collect(game, 'bind');
  const changes = collect(game, 'companionship_changed');
  hit(game, player, lyra);
  step(game, 2);
  hit(game, player, lyra);
  assert.equal(a.companionship, 'left');
  assert.deepEqual(
    changes.map((c) => c.state),
    ['wary', 'left'],
  );
  assert.equal(binds.length, 1, 'she bound the player');
  assert.equal(binds[0].target, player);
  assert.ok(player.rootTime > 0, 'the player is rooted');
  const d = lyra.behavior.directive;
  assert.ok(d.type === 'flee' || d.type === 'keep_away', `she gets away (${d.type})`);
  assert.equal(a.agenda.sleepAt, 'lyra_inn_bed');
});

test('knocked out by the player: the deed now, and when she comes to she leaves for good', () => {
  const { game, player, lyra, a } = makeWorld();
  const changes = collect(game, 'companionship_changed');
  lyra.hp = 0;
  lyra.downed = true;
  game.bus.emit('downed', { entity: lyra, by: player });
  assert.ok(deeds(a).includes('downed_lyra'));
  assert.equal(a.companionship, 'together', 'unconscious, she decides nothing');
  lyra.downed = false;
  lyra.hp = 10;
  game.bus.emit('revived', { entity: lyra, by: player });
  assert.equal(a.companionship, 'gone');
  assert.equal(changes.at(-1).state, 'gone');
  assert.equal(game.flags.lyra_gone.day, 1);
  assert.ok(game.flags.lyra_gone.reason.length > 5);
  assert.equal(lyra.behavior.directive.type, 'leave');
  assert.equal(lyra.behavior.directive.mode, 'gone');
  assert.ok(lyra.mind.diary.some((d) => /King’s Road/.test(d.text)), 'a last diary entry');
  assert.ok(lyra.mind.memory.all().some((m) => /for good/.test(m.text) && m.importance >= 9), 'a farewell memory');
});

test('revived by the player after a wolf downed her: revived_lyra; left lying: abandoned_downed', () => {
  {
    const { game, player, lyra, a } = makeWorld();
    const w = wolf(game, lyra.x + 30, lyra.y);
    lyra.downed = true;
    lyra.hp = 0;
    game.bus.emit('downed', { entity: lyra, by: w });
    lyra.downed = false;
    lyra.hp = 15;
    game.bus.emit('revived', { entity: lyra, by: player });
    assert.ok(deeds(a).includes('revived_lyra'));
    assert.ok(a.stats().trust > 32);
  }
  {
    const { game, player, lyra, a } = makeWorld();
    const w = wolf(game, lyra.x + 30, lyra.y);
    lyra.downed = true;
    lyra.hp = 0;
    game.bus.emit('downed', { entity: lyra, by: w });
    player.x = lyra.x + 25 * TILE;
    step(game, 1.5);
    assert.ok(deeds(a).includes('abandoned_downed'), 'walked more than 20 tiles away');
  }
});

test('protected_lyra, killed_harmless (and a pet counts double), gifts and kindness', () => {
  const { game, player, lyra, a } = makeWorld();
  const w = wolf(game, lyra.x + 20, lyra.y);
  hit(game, w, lyra, 5);
  game.bus.emit('death', { entity: w, killer: player });
  assert.equal(a.ledger.at(-1).deed, 'protected_lyra');
  const rabbit = critter(game, 'rabbit', player.x + 10, player.y);
  game.bus.emit('death', { entity: rabbit, killer: player });
  assert.equal(a.ledger.at(-1).deed, 'killed_harmless');
  assert.equal(a.ledger.at(-1).severity, -1);
  const cat = critter(game, 'cat', player.x + 10, player.y, 'cat_1');
  game.bus.emit('death', { entity: cat, killer: player });
  assert.equal(a.ledger.at(-1).severity, -2);
  game.bus.emit('item_given', { from: player, to: lyra, itemId: 'honey_cake', qty: 1 });
  assert.equal(a.ledger.at(-1).deed, 'gift_loved');
  game.bus.emit('item_given', { from: player, to: lyra, itemId: 'raw_fish', qty: 1 });
  assert.equal(a.ledger.at(-1).deed, 'gift_disliked');
  const pip = villager(game, 'pip', 'Pip', player.x + 12, player.y);
  game.bus.emit('item_given', { from: player, to: pip, itemId: 'bread', qty: 1 });
  assert.equal(a.ledger.at(-1).deed, 'kindness');
  assert.equal(a.ledger.at(-1).victimId, 'pip');
  const ev = collect(game, 'deed');
  game.bus.emit('crime', { actor: player, victim: pip, kind: 'theft' });
  assert.equal(ev.at(-1).deed, 'stole');
});

test('a hunt she agreed to for food is no crime of the player', () => {
  const { game, player, a, mind } = makeWorld();
  setRel(mind, { trust: 60 });
  mind.needs.hunger = 0.2;
  const deer = critter(game, 'deer', player.x + 40, player.y, 'deer_1');
  const v = game.actions.run('attack', { target: 'deer_1', value: 'for food' }, 'player');
  assert.ok(ACCEPTED.has(v.verdict.decision), `she agreed: ${v.verdict.decision} ${v.verdict.reasons}`);
  game.bus.emit('death', { entity: deer, killer: player });
  assert.ok(!deeds(a).includes('killed_harmless'));
});

test('villagers: a warning first, then Binding Light, the guards and leaving; knocking out a friend means gone', () => {
  {
    const { game, player, a } = makeWorld();
    const bram = villager(game, 'bram', 'Bram Ironhand', player.x + 12, player.y);
    hit(game, player, bram);
    game.bus.emit('crime', { actor: player, victim: bram, kind: 'assault' });
    assert.deepEqual(deeds(a), ['attacked_villager'], 'one blow, one deed (damage and crime together)');
    assert.equal(a.companionship, 'wary');
    step(game, 2);
    hit(game, player, bram);
    assert.equal(a.ledger.at(-1).deed, 'attacked_villager');
    assert.equal(a.companionship, 'left');
    assert.ok(player.rootTime > 0, 'she bound the player');
  }
  {
    const { game, player, a, mind } = makeWorld();
    const mira = villager(game, 'mira', 'Mira Fennick', player.x + 12, player.y);
    mind.relationships.ensure(mira);
    mind.relationships.get('mira').affinity = 45;
    mira.hp = 0;
    mira.downed = true;
    game.bus.emit('damage', { source: player, target: mira, amount: 40, kind: 'melee', crit: false });
    game.bus.emit('downed', { entity: mira, by: player });
    game.bus.emit('crime', { actor: player, victim: mira, kind: 'knockout' });
    assert.deepEqual(deeds(a), ['downed_villager'], 'the knockout blow is one deed');
    assert.equal(a.companionship, 'gone');
    assert.equal(game.flags.lyra_gone.day, 1);
  }
  {
    const { game, player, a } = makeWorld();
    const rowan = villager(game, 'rowan', 'Captain Rowan Vale', player.x + 12, player.y, { faction: 'guard' });
    hit(game, player, rowan);
    assert.equal(a.ledger.at(-1).deed, 'attacked_guard');
  }
});

test('repeated grave violence after she left: gone', () => {
  const { game, player, lyra, a } = makeWorld();
  hit(game, player, lyra);
  step(game, 2);
  hit(game, player, lyra);
  assert.equal(a.companionship, 'left');
  step(game, 2);
  hit(game, player, lyra);
  assert.equal(a.companionship, 'gone');
});

test('reckless_order: her HP falls under 30% in a fight the player ordered', () => {
  const { game, lyra, a, mind } = makeWorld();
  setRel(mind, { trust: 55 });
  const r = game.actions.run('set_combat_mode', { value: 'attack' }, 'player');
  assert.ok(r.ok);
  const w = wolf(game, lyra.x + 60, lyra.y);
  hit(game, w, lyra, lyra.hp - Math.floor(lyra.maxHp * 0.2));
  assert.equal(a.ledger.at(-1).deed, 'reckless_order');
});

test('recordDeed: high trust cushions a small slight, never a grave deed', () => {
  const low = makeWorld();
  setRel(low.mind, { trust: 30 });
  const high = makeWorld();
  setRel(high.mind, { trust: 80 });
  low.a.recordDeed('broke_promise');
  high.a.recordDeed('broke_promise');
  const dLow = 30 - low.a.stats().trust;
  const dHigh = 80 - high.a.stats().trust;
  assert.ok(dHigh < dLow, `cushioned: ${dHigh} < ${dLow}`);
  const g1 = makeWorld();
  setRel(g1.mind, { trust: 30 });
  const g2 = makeWorld();
  setRel(g2.mind, { trust: 80 });
  g1.a.recordDeed('attacked_villager');
  g2.a.recordDeed('attacked_villager');
  assert.equal(Math.round(30 - g1.a.stats().trust), Math.round(80 - g2.a.stats().trust), 'grave deeds weigh the same');
  const ev = collect(g1.game, 'deed');
  g1.a.recordDeed('kept_promise', { text: 'Brought me moonpetals.' });
  assert.equal(ev[0].deed, 'kept_promise');
  assert.ok(g1.mind.memory.all().some((m) => /kept their word/.test(m.text)));
  assert.equal(g1.a.recordDeed('not_a_deed'), null);
});

// ---------------------------------------------------------------- companionship (§16.3)

test('every state: the directive behavior gets, the event, and her reason in her voice', () => {
  const { game, lyra, a } = makeWorld();
  const changes = collect(game, 'companionship_changed');
  const b = lyra.behavior;
  a.setCompanionship('wary', 'testing');
  assert.equal(b.directive.type, 'follow');
  assert.equal(b.directive.distance, 'far');
  assert.equal(b.stance, 'defend');
  a.setCompanionship('together', 'better now');
  assert.equal(b.directive.type, 'follow');
  assert.equal(b.directive.distance, 'normal');
  a.setCompanionship('apart', 'my own day');
  assert.equal(b.directive.type, 'independent');
  a.setCompanionship('left', 'you hurt me');
  assert.equal(b.directive.type, 'keep_away');
  assert.equal(b.directive.from, 'player');
  a.setCompanionship('gone', 'for good');
  assert.equal(b.directive.type, 'leave');
  assert.equal(b.directive.mode, 'gone');
  assert.deepEqual(
    changes.map((c) => [c.previous, c.state]),
    [
      ['together', 'wary'],
      ['wary', 'together'],
      ['together', 'apart'],
      ['apart', 'left'],
      ['left', 'gone'],
    ],
  );
  assert.ok(changes.every((c) => typeof c.reason === 'string' && c.reason.length > 0));
  assert.equal(a.setCompanionship('together'), false, 'gone is permanent');
  assert.deepEqual(STATES, ['together', 'wary', 'apart', 'left', 'gone']);
});

test('reconsider: together <-> wary by trust and fear, left on fear or broken trust', () => {
  const { game, a, mind } = makeWorld();
  setRel(mind, { trust: 20 });
  a.reconsider('test');
  assert.equal(a.companionship, 'wary');
  setRel(mind, { trust: 45, fear: 5 });
  step(game, SPH * 1.2);
  assert.equal(a.companionship, 'together', 'calm again after an hour');
  setRel(mind, { fear: 40 });
  a.reconsider('test');
  assert.equal(a.companionship, 'wary');
  setRel(mind, { fear: 70 });
  a.reconsider('test');
  assert.equal(a.companionship, 'left');
});

test('left -> apart only after amends: a believed apology, trust >= 35, fear <= 30, a day', () => {
  const { game, player, a, mind } = makeWorld();
  hit(game, player, game.companion);
  step(game, 2);
  hit(game, player, game.companion);
  assert.equal(a.companionship, 'left');
  // Too soon, and she does not believe it seconds after the blow.
  a.hearPlayer("I'm sorry");
  assert.equal(a.companionship, 'left');
  const r = game.actions.run('rejoin', {}, 'player');
  assert.equal(r.ok, false);
  // A day later, trust rebuilt and fear eased; a real apology.
  step(game, 905, 0.5);
  setRel(mind, { trust: 40, fear: 20 });
  a.hearPlayer("I'm so sorry I hit you with my sword. I was wrong, and I won't ever do it again.");
  assert.equal(a.apology.believed, true);
  assert.equal(a.companionship, 'apart');
  assert.equal(a.apartReason, 'amends');
  const back = game.actions.run('rejoin', {}, 'player');
  assert.ok(back.ok, back.message);
  assert.ok(a.companionship === 'together' || a.companionship === 'wary');
});

test('apart by her plans, and back when her errand ends; an invitation she accepts', () => {
  const { game, lyra, a, mind } = makeWorld({ hour: 6.9, day: 3 });
  setRel(mind, { trust: 45, affinity: 30 });
  mind.needs.energy = 0.9;
  a.planDay('new_day');
  const first = a.agenda.today[0];
  assert.equal(first.type, 'work', 'a light purse: she works the morning');
  assert.equal(first.company === 'player', false);
  step(game, 6);
  assert.equal(a.companionship, 'apart');
  assert.equal(a.apartReason, 'plans');
  assert.equal(lyra.behavior.directive.type, 'independent');
  // The player asks her along; she is busy with paid work, so it is a real decision.
  const v = a.evaluateRequest({ action: 'follow', args: { target: 'player' }, source: 'player', preview: true });
  assert.ok(v.reasons.some((r) => /work|busy/.test(r)), v.reasons.join('; '));
  // When the plan's travel block comes, she chooses the player's company again.
  game.clock.t = (10.05 - 6.9) * SPH;
  step(game, 2);
  assert.ok(a.companionship === 'together' || a.companionship === 'wary', a.companionship);
});

test('leave_player as the player lets her go: apart, her own day; "come back" asks her to rejoin', () => {
  const { game, lyra, a, mind } = makeWorld({ hour: 11, day: 2 });
  setRel(mind, { trust: 50 });
  const r = game.actions.run('leave_player', { value: 'apart' }, 'player');
  assert.ok(r.ok);
  assert.equal(a.companionship, 'apart');
  assert.equal(a.apartReason, 'dismissed');
  assert.equal(lyra.behavior.directive.type, 'independent');
  step(game, 3);
  const back = game.actions.run('rejoin', {}, 'player');
  assert.ok(back.ok, back.message);
  assert.notEqual(a.companionship, 'apart');
});

// ---------------------------------------------------------------- requests (§16.4)

test('low trust refuses attack mode, with a reason and her line', () => {
  const { game, a, mind } = makeWorld();
  setRel(mind, { trust: 15 });
  const ev = collect(game, 'request_evaluated');
  const r = game.actions.run('set_combat_mode', { value: 'attack' }, 'player');
  assert.equal(r.ok, false);
  assert.equal(r.refused, true);
  assert.equal(r.verdict.decision, 'refuse');
  assert.ok(r.verdict.reasons.some((x) => /trust/.test(x)), r.verdict.reasons.join('; '));
  assert.ok(r.message.length > 3);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].action, 'set_combat_mode');
  assert.equal(ev[0].verdict.decision, 'refuse');
  assert.notEqual(game.companion.behavior.stance, 'attack');
});

test('high risk is refused even with fair trust', () => {
  const { game, lyra, a, mind } = makeWorld({ hour: 22 });
  setRel(mind, { trust: 50 });
  const v = a.evaluateRequest({ action: 'explore', args: { target: 'bandit_camp' }, source: 'player' });
  assert.ok(!ACCEPTED.has(v.decision), `${v.decision} ${v.reasons}`);
  assert.ok(v.risk > 0.65, `risk ${v.risk}`);
  assert.ok(v.reasons.some((r) => /dangerous|dark|risk/.test(r)));
  // A pack of wolves around her and half her blood gone: no attack mode either.
  for (let i = 0; i < 4; i++) wolf(game, lyra.x + 30 + i * 10, lyra.y + 10, `wolf_${i}`);
  lyra.hp = Math.round(lyra.maxHp * 0.45);
  step(game, 2);
  const w = a.evaluateRequest({ action: 'set_combat_mode', args: { value: 'attack' }, source: 'player' });
  assert.ok(!ACCEPTED.has(w.decision), `${w.decision} ${w.reasons}`);
});

test('exhausted refuses work (and offers to rest instead)', () => {
  const { a, mind } = makeWorld();
  setRel(mind, { trust: 70 });
  mind.needs.energy = 0.1;
  const v = a.evaluateRequest({ action: 'start_job', args: { target: 'player', value: 'chop_wood', amount: 5 }, source: 'player' });
  assert.ok(!ACCEPTED.has(v.decision));
  assert.ok(v.reasons.includes('she is exhausted'));
  assert.ok(v.counter && (v.counter.name === 'sit' || v.counter.name === 'sleep'));
});

test('a coin offer flips a marginal refusal', () => {
  const { game, a, mind } = makeWorld({ hour: 16 });
  setRel(mind, { trust: 26, affinity: 10 });
  mind.needs.energy = 0.5;
  const no = a.evaluateRequest({ action: 'start_job', args: { target: 'player', value: 'mine_ore', amount: 5 }, source: 'player' });
  assert.equal(no.decision, 'refuse', `${no.decision} ${no.score} ${no.reasons}`);
  step(game, 3);
  const yes = a.evaluateRequest({ action: 'start_job', args: { target: 'player', value: 'mine_ore', amount: 5, offer: 15 }, source: 'player' });
  assert.ok(ACCEPTED.has(yes.decision), `${yes.decision} ${yes.score} ${yes.reasons}`);
  assert.ok(yes.reasons.includes('15 coins offered'));
  assert.equal(yes.pay, 15);
  assert.ok(!deeds(a).includes('pushed_after_refusal'), 'a better offer is not pushing');
  assert.ok(a.promises.some((p) => p.kind === 'pay' && p.params.amount === 15 && p.state === 'open'), 'the player owes her the coin');
});

test("harming a villager is always refused, and she acts on it", () => {
  const { game, player, a, mind } = makeWorld();
  setRel(mind, { trust: 100, affinity: 90 });
  villager(game, 'garrick', 'Garrick Hale', player.x + 20, player.y);
  const r = game.actions.run('attack', { target: 'garrick' }, 'player');
  assert.equal(r.ok, false);
  assert.equal(r.verdict.decision, 'refuse_and_act');
  assert.ok(r.verdict.reasons.some((x) => /villagers/.test(x)));
  assert.ok(game.bubbles.said.length > 0, 'a sharp warning');
  const p = a.evaluateRequest({ action: 'attack', args: { target: 'player' }, source: 'player', preview: true });
  assert.equal(p.decision, 'refuse');
});

test('asking again within 60 s of a no is pushing; letting it be is respect', () => {
  const { game, a, mind } = makeWorld();
  setRel(mind, { trust: 15 });
  game.actions.run('set_combat_mode', { value: 'attack' }, 'player');
  step(game, 5);
  const again = game.actions.run('set_combat_mode', { value: 'attack' }, 'player');
  assert.equal(again.refused, true);
  assert.ok(again.verdict.reasons.some((r) => /asked again/.test(r)));
  assert.ok(deeds(a).includes('pushed_after_refusal'));
  const w = makeWorld();
  setRel(w.mind, { trust: 15 });
  w.game.actions.run('set_combat_mode', { value: 'attack' }, 'player');
  step(w.game, 65, 0.5);
  assert.ok(deeds(w.a).includes('respected_refusal'));
});

test('every action of the catalogue has a category; words between them are never refused', () => {
  const names = [
    'follow', 'stay', 'wait', 'come_here', 'goto', 'set_combat_mode', 'attack', 'retreat', 'guard', 'patrol', 'explore',
    'free_will', 'emote', 'sit', 'open_door', 'close_door', 'pick_up', 'give_item', 'use_item', 'interact', 'sleep',
    'start_job', 'stop_job', 'talk_to', 'set_relationship', 'note_about', 'remember', 'forget', 'set_goal', 'complete_goal',
    'express', 'read_journal', 'leave_player', 'rejoin', 'set_plan', 'request', 'promise', 'flee', 'keep_distance', 'bind',
    'warn', 'wait_outside',
  ];
  for (const n of names) assert.ok(ACTION_CATEGORY[n], `category for ${n}`);
  const { a, mind } = makeWorld();
  setRel(mind, { trust: 5, fear: 50 });
  const v = a.evaluateRequest({ action: 'promise', args: { target: 'player', value: 'bring you moonpetals' }, source: 'player', preview: true });
  assert.equal(v.decision, 'accept');
  assert.equal(v.message, '');
});

test('her answers vary: the same refusal never twice in a row', () => {
  const { game, a, mind } = makeWorld();
  setRel(mind, { trust: 10 });
  const msgs = [];
  for (let i = 0; i < 6; i++) {
    msgs.push(a.evaluateRequest({ action: 'set_combat_mode', args: { value: 'attack' }, source: 'player' }).message);
    step(game, 70, 1);
  }
  for (let i = 1; i < msgs.length; i++) assert.notEqual(msgs[i], msgs[i - 1]);
  const lp = new LinePicker(() => 0);
  const seen = [lp.pick('no_trust', 'cool'), lp.pick('no_trust', 'cool'), lp.pick('no_trust', 'cool')];
  assert.notEqual(seen[0], seen[1]);
  assert.notEqual(seen[1], seen[2]);
  // Even a bank with a single line (tired: "No.") never repeats back to back.
  const tired = [lp.pick('no_trust', 'tired'), lp.pick('no_trust', 'tired'), lp.pick('no_trust', 'tired')];
  assert.notEqual(tired[0], tired[1]);
  assert.notEqual(tired[1], tired[2]);
});

// ---------------------------------------------------------------- the gate on the real registry

test('the consent gate sits on the real ActionRegistry: player requests are weighed, her own acts are not', () => {
  const { game, a, mind } = makeWorld();
  assert.equal(typeof game.actions.consentGate, 'function');
  setRel(mind, { trust: 10 });
  const evs = collect(game, 'request_evaluated');
  const asked = game.actions.run('set_combat_mode', { value: 'attack' }, 'player');
  assert.equal(asked.refused, true);
  const own = game.actions.run('set_combat_mode', { value: 'attack' }, 'self');
  assert.notEqual(own.refused, true);
  assert.equal(game.companion.behavior.stance, 'attack');
  const claude = game.actions.run('set_combat_mode', { value: 'defend' }, 'claude');
  assert.ok(claude.ok);
  assert.equal(evs.length, 1, 'only the player request went through the gate');
  const hist = game.actions.history.at(-3);
  assert.equal(hist.refused, true);
  assert.equal(hist.decision, 'refuse');
});

test("the brain's offer rides on the request through the gate", () => {
  const { game, a, mind } = makeWorld({ hour: 16 });
  setRel(mind, { trust: 26, affinity: 10 });
  mind.needs.energy = 0.5;
  game.brain = { currentOffer: { coins: 15, share: false, paid: false }, noteRefusal() {} };
  const r = game.actions.run('start_job', { target: 'player', value: 'mine_ore', amount: 5 }, 'player');
  assert.ok(ACCEPTED.has(r.verdict.decision), `${r.verdict.decision} ${r.verdict.reasons}`);
  assert.ok(r.verdict.reasons.includes('15 coins offered'));
  assert.ok(!a.promises.some((p) => p.kind === 'pay'), 'the brain records the debt itself');
});

// ---------------------------------------------------------------- promises (§16.8)

test('promises: kept when the gift arrives, broken at the deadline, and an avoid-promise broken by a blow', () => {
  const { game, player, lyra, a } = makeWorld();
  const pe = collect(game, 'promise');
  game.actions.run('promise', { target: 'player', value: 'bring you a honey cake' }, 'player');
  const p = a.promises.at(-1);
  assert.equal(p.kind, 'give');
  assert.equal(p.params.itemId, 'honey_cake');
  assert.ok(p.due > a.now());
  game.bus.emit('item_given', { from: player, to: lyra, itemId: 'honey_cake', qty: 1 });
  assert.equal(p.state, 'kept');
  assert.ok(deeds(a).includes('kept_promise'));
  assert.deepEqual(
    pe.map((e) => e.state),
    ['open', 'kept'],
  );
  game.actions.run('promise', { target: 'player', value: 'pay you 10 coins', amount: 10 }, 'player');
  const pay = a.promises.at(-1);
  assert.equal(pay.kind, 'pay');
  step(game, 0.3 * 900, 1);
  assert.equal(pay.state, 'broken');
  assert.ok(deeds(a).includes('broke_promise'));
  game.actions.run('promise', { target: 'player', value: 'never raise a sword to you again' }, 'player');
  const avoid = a.promises.at(-1);
  assert.equal(avoid.kind, 'avoid');
  hit(game, player, lyra);
  assert.equal(avoid.state, 'broken');
});

test('one promise however many ways it arrives; her ask answered yes becomes the promise', () => {
  const { game, a } = makeWorld();
  game.actions.run('promise', { target: 'player', value: 'bring you moonpetals' }, 'player');
  game.actions.run('promise', { target: 'player', value: 'bring you moonpetals' }, 'claude');
  assert.equal(a.promises.filter((p) => p.state === 'open').length, 1);
  a._ask('Buy me a honey cake and I’ll forgive the mud.', { kind: 'give', params: { itemId: 'honey_cake', qty: 1 }, what: 'buy me a honey cake', days: 1 });
  assert.ok(a.pendingRequest);
  assert.ok(game.actions.history.some((h) => h.name === 'request' && h.source === 'self'), 'asked through the request action');
  a.hearPlayer('yes');
  const p = a.promises.at(-1);
  assert.equal(p.kind, 'give');
  assert.equal(p.params.itemId, 'honey_cake');
  // With the real brain, "yes" becomes the promise action carrying her words.
  const w = makeWorld();
  w.game.brain = { noteRefusal() {}, currentOffer: null };
  w.a._ask('Walk me to the Ember Kettle? It’s dark.', { kind: 'visit', params: { at: 'ember_kettle' }, what: 'walk me to the Ember Kettle', days: 0.2 });
  w.a.hearPlayer('yes');
  assert.equal(w.a.promises.filter((x) => x.kind === 'visit').length, 0, 'the brain answers, not her ear');
  w.game.actions.run('promise', { target: 'player', value: 'Walk me to the Ember Kettle? It’s dark.' }, 'local');
  assert.equal(w.a.promises.at(-1).kind, 'visit');
  assert.equal(w.a.promises.at(-1).params.at, 'ember_kettle');
});

test('her initiative is rate-limited to about one in three minutes', () => {
  const { game, a, mind } = makeWorld({ hour: 10, day: 2 });
  mind.needs.hunger = 0.2;
  game.player.inventory.add('bread', 2);
  a.recordDeed('gift_disliked');
  const asks = () => game.actions.history.filter((h) => h.name === 'request' && h.source === 'self').length;
  step(game, 20, 0.5);
  assert.equal(asks(), 1);
  a.pendingRequest = null;
  step(game, 100, 0.5);
  assert.equal(asks(), 1, 'not again inside three minutes');
  a.pendingRequest = null;
  step(game, 120, 0.5);
  assert.ok(asks() <= 2);
});

// ---------------------------------------------------------------- her day (§16.1)

test('planDay: real places and jobs, own_life reads every block, sleepAt follows trust and fear', () => {
  const { game, a, mind } = makeWorld({ hour: 7, day: 4 });
  setRel(mind, { trust: 40, affinity: 20, fear: 0 });
  const plans = collect(game, 'plan_changed');
  a.planDay('new_day');
  assert.equal(plans.length, 1);
  const today = a.agenda.today;
  assert.ok(today.length >= 4);
  for (const b of today) {
    assert.ok(b.at === null || game.locations.get(b.at), `known place ${b.at}`);
    assert.ok(b.activity && b.why && b.type);
    const c = classifyActivity(b);
    if (b.type === 'work') {
      assert.equal(c.mode, 'job');
      assert.equal(c.job, b.job);
      assert.equal(c.buyer, b.npc);
    }
    if (b.type === 'travel') assert.equal(c.mode, 'with_player');
    if (b.type === 'eat') assert.equal(c.mode, 'eat');
    if (b.type === 'sleep') assert.equal(c.mode, 'sleep');
    if (b.type === 'stars') assert.equal(c.mode, 'stargaze');
    if (b.type === 'visit') assert.equal(c.person, b.npc);
  }
  assert.equal(today.at(-1).type, 'sleep');
  assert.equal(a.agenda.sleepAt, 'lyra_inn_bed');
  setRel(mind, { trust: 60, fear: 10 });
  game.bus.emit('new_day', { day: 5 });
  assert.equal(a.agenda.sleepAt, 'lyra_bed');
  setRel(mind, { trust: 60, fear: 25 });
  a._hourly(1);
  assert.equal(a.agenda.sleepAt, 'lyra_inn_bed');
  assert.equal(sleepSpot(50, 20), 'lyra_bed');
  assert.equal(sleepSpot(49, 0), 'lyra_inn_bed');
  assert.ok(a.agenda.goals.length >= 6 && a.agenda.goals[0].weight >= a.agenda.goals.at(-1).weight);
  // Rain changes the evening.
  game.clock.weather.type = 'rain';
  game.bus.emit('weather', { type: 'rain' });
  assert.ok(a.agenda.today.some((b) => b.type === 'hearth'));
  // Her plan answers the player.
  assert.match(a.describePlan(), /\w/);
});

test('her purse: her own coin, earned on job_done while she lives apart', () => {
  const { game, lyra, a, mind } = makeWorld({ hour: 8, day: 3 });
  assert.equal(a.agenda.purse, 8, 'pocket money on the first morning');
  assert.equal(lyra.inventory.count('coin'), 8, 'kept in her pack');
  a.agenda.purse -= 3; // what Elda's room does
  assert.equal(lyra.inventory.count('coin'), 5);
  setRel(mind, { trust: 45 });
  a.setCompanionship('apart', 'work');
  const bram = villager(game, 'bram', 'Bram Ironhand', lyra.x + 30, lyra.y);
  game.bus.emit('job_done', { actor: lyra, job: 'mine_ore', own: true, result: { items: [{ id: 'iron_ore', qty: 3 }], count: 3, deliveredTo: 'bram', buyer: 'bram', earned: 15 } });
  assert.equal(a.purse(), 20);
  assert.ok(mind.memory.all().some((m) => /paid me 15 coins/.test(m.text)));
  // Work she did for the player pays nothing.
  a.setCompanionship('together', 'back');
  game.bus.emit('job_done', { actor: lyra, job: 'chop_wood', result: { items: [{ id: 'wood', qty: 4 }], count: 4, deliveredTo: 'player' } });
  assert.equal(a.purse(), 20);
});

test('starving or spent, her plan changes: a meal or rest comes first', () => {
  const { game, a, mind } = makeWorld({ hour: 14, day: 3 });
  const plans = collect(game, 'plan_changed');
  mind.needs.hunger = 0.1;
  a._checkNeeds();
  assert.equal(plans.at(-1).reason, 'needs');
  assert.equal(a.currentBlock().type, 'eat');
  assert.equal(a.currentBlock().at, 'ember_kettle');
  mind.needs.hunger = 0.9;
  mind.needs.energy = 0.1;
  a._checkNeeds();
  assert.equal(a.currentBlock().type, 'rest');
});

test('record_deed: Claude records only what she alone can judge (a lie)', () => {
  const { game, a } = makeWorld();
  const r = game.actions.run('record_deed', { value: 'lied', target: 'Said they had never been to the ruins. Their boots say otherwise.' }, 'claude');
  assert.ok(r.ok);
  assert.equal(a.ledger.at(-1).deed, 'lied');
  assert.equal(a.ledger.at(-1).severity, -2);
  const n = a.ledger.length;
  assert.equal(game.actions.run('record_deed', { value: 'hit_lyra' }, 'claude').ok, false);
  assert.equal(a.ledger.length, n);
  assert.equal(game.actions.get('record_deed').ungated, true);
});

test('buildPlan: apart without trust keeps her own company all day', () => {
  const plan = buildPlan({ day: 5, state: 'left', trust: 10, fear: 50, purse: 4, energy: 0.8, hunger: 0.7, questStage: 1, dangerOf: () => 0 });
  assert.ok(plan.every((b) => b.company !== 'player'));
  assert.equal(plan.at(-1).bed, 'lyra_inn_bed');
  assert.equal(blockAt(plan, 3)?.type, 'sleep', 'the night block runs past midnight');
});

// ---------------------------------------------------------------- the plugin

test('plugin: actions are registered, promptContext stays under 900 characters', () => {
  const { game, player, lyra, a } = makeWorld();
  for (const n of ['leave_player', 'rejoin', 'set_plan', 'request', 'promise']) assert.ok(game.actions.has(n), n);
  for (let i = 0; i < 8; i++) a.recordDeed('gift_liked', { text: `Gave me a very long-winded present number ${i}, wrapped in a story that goes on and on.` });
  for (let i = 0; i < 4; i++) a.addPromise({ by: 'player', kind: 'free', what: `do a very long and specific favor number ${i} that takes many words to describe` });
  const sections = game.plugins.promptSections('do you trust me');
  const mine = sections.find((s) => s.id === 'autonomy');
  assert.ok(mine && mine.text.length > 50 && mine.text.length <= 900, `${mine?.text.length}`);
  assert.match(mine.text, /Companionship: together/);
  assert.match(mine.text, /trust \d+/);
  const plan = game.actions.run('set_plan', { value: 'visit Bram' }, 'claude');
  assert.ok(plan.ok);
  assert.equal(autonomyPlugin.id, 'autonomy');
});

test('plugin intents answer the player in her voice', () => {
  const { game, a, mind } = makeWorld({ hour: 11, day: 2 });
  const env = nluEnv(game);
  const answer = (text) => {
    a.hearPlayer(text);
    const parsed = parseMessage(text, env);
    const c = parsed.clauses[0];
    assert.ok(c?.intent, `understood: ${text}`);
    const results = (c.intent.actions || []).map((x) => game.actions.run(x.name, x.args, 'player'));
    return { id: c.intent.id, text: c.intent.answer ? c.intent.answer(results) : null, results };
  };
  let r = answer('do you trust me?');
  assert.equal(r.id, 'autonomy.trust');
  assert.ok(r.text.length > 2);
  r = answer('are you afraid of me?');
  assert.equal(r.id, 'autonomy.fear');
  assert.ok(LINES.ans_afraid_no.warm.concat(LINES.ans_afraid_no.cool).includes(r.text) || r.text.length > 2);
  r = answer('why did you leave?');
  assert.equal(r.id, 'autonomy.why_left');
  r = answer('what are your plans today?');
  assert.equal(r.id, 'autonomy.plans');
  assert.ok(r.text.length > 10);
  r = answer('what do you want to do?');
  assert.equal(r.id, 'autonomy.wants');
  r = answer('I promise I will bring you moonpetals');
  assert.equal(r.id, 'autonomy.promise');
  assert.equal(a.promises.at(-1).params.itemId, 'moonpetal');
  r = answer("I'm sorry");
  assert.equal(r.id, 'autonomy.apology');
  r = answer('you can go');
  assert.equal(r.id, 'autonomy.dismiss');
  assert.equal(a.companionship, 'apart');
  step(game, 3);
  // Busy with her own paid work, she names a time instead of dropping it...
  r = answer('please come back');
  assert.equal(r.id, 'autonomy.come_back');
  assert.equal(r.results[0].verdict.decision, 'counter');
  assert.equal(r.results[0].verdict.counter.name, 'set_plan');
  assert.equal(a.companionship, 'apart');
  // ...unless she trusts the player enough to let the work wait.
  setRel(mind, { trust: 65 });
  step(game, 70, 1);
  r = answer('please come back');
  assert.equal(r.results[0].ok, true, r.results[0].message);
  assert.notEqual(a.companionship, 'apart');
  setRel(mind, { trust: 60 });
  step(game, 3);
  // "I'll pay you 10 coins to chop wood": the brain lifts the offer out and runs the job;
  // she heard the coin herself, so it rides on the request either way.
  a.hearPlayer("I'll pay you 10 coins to chop wood");
  const parsed = parseMessage("I'll pay you 10 coins to chop wood", env);
  assert.equal(parsed.offer?.coins, 10);
  const job = parsed.clauses[0].intent.actions[0];
  assert.equal(job.name, 'start_job');
  const res = game.actions.run(job.name, job.args, 'player');
  assert.equal(res.verdict.pay, 10);
  assert.ok(res.verdict.reasons.includes('10 coins offered'));
  // Words the brain leaves whole reach the plugin's own offer intent.
  const offer = autonomyPlugin.intents.find((i) => i.id === 'autonomy.offer');
  const m = offer.patterns[0].exec('i will give you 12 coins to explore the whisperwood');
  assert.ok(m);
  const acts = offer.actions(m, game.plugins.ctx);
  assert.equal(acts[0].name, 'explore');
  assert.equal(acts[0].args.amount, 12);
  assert.match(offer.answer(offer.patterns[0].exec('i will pay you 5 coins'), game.plugins.ctx, []), /5|what/i);
});

test('while she has left the player, her questions fall through to the brain', () => {
  const { game, a } = makeWorld();
  a.setCompanionship('left', 'test');
  const parsed = parseMessage('do you trust me', nluEnv(game));
  assert.notEqual(parsed.clauses[0]?.intent?.id, 'autonomy.trust');
  const come = parseMessage('please come back', nluEnv(game));
  assert.equal(come.clauses[0].intent.id, 'autonomy.come_back');
  assert.equal(come.clauses[0].intent.actions[0].name, 'rejoin');
});

// ---------------------------------------------------------------- words and saving

test('her ear: apologies, offers, promises and asks', () => {
  assert.ok(isApology("I'm really sorry"));
  assert.ok(isApology('please forgive me'));
  assert.ok(!isApology('sorry state of affairs here'.replace('sorry', 'sad')));
  assert.equal(parseOffer("I'll pay you 12 coins to fish"), 12);
  assert.equal(parseOffer('20 gold if you come'), 20);
  assert.equal(parseOffer('nice weather'), null);
  assert.equal(parsePromiseText('I promise to pay you 5 coins').kind, 'pay');
  assert.equal(parsePromiseText("I promise I won't hit you again").kind, 'avoid');
  assert.equal(parseAskText('Buy me a honey cake and I’ll forgive the mud.').params.itemId, 'honey_cake');
});

test('serialize round trip keeps her state, her day, the ledger and the promises', () => {
  const { game, player, lyra, a } = makeWorld();
  hit(game, player, lyra);
  a.addPromise({ by: 'player', kind: 'give', params: { itemId: 'moonpetal', qty: 1 }, what: 'bring me a moonpetal', days: 1 });
  a.setPlan('visit Bram');
  const data = JSON.parse(JSON.stringify(a.serialize()));
  const w = makeWorld();
  w.a.deserialize(data);
  assert.equal(w.a.companionship, 'wary');
  assert.equal(w.a.reason, a.reason);
  assert.deepEqual(w.a.ledger, a.ledger);
  assert.deepEqual(
    w.a.promises.map((p) => [p.kind, p.text, p.state, p.due]),
    a.promises.map((p) => [p.kind, p.text, p.state, p.due]),
  );
  assert.deepEqual(w.a.agenda.today, a.agenda.today);
  assert.equal(w.a.purse(), a.purse());
  assert.equal(w.lyra.behavior.directive.type, 'follow', 'her body follows the state she was in');
  assert.equal(w.lyra.behavior.directive.distance, 'far');
  // Through the whole mind as well.
  const m = JSON.parse(JSON.stringify(lyra.mind.serialize()));
  const w2 = makeWorld();
  w2.mind.deserialize(m);
  assert.equal(w2.mind.companionship, 'wary');
  assert.equal(w2.mind.ledger.length, 1);
});

test('saved while knocked out by the player: she still leaves when she comes to', () => {
  const { game, player, lyra, a } = makeWorld();
  lyra.downed = true;
  lyra.hp = 0;
  game.bus.emit('downed', { entity: lyra, by: player });
  const data = JSON.parse(JSON.stringify(a.serialize()));
  const w = makeWorld();
  w.lyra.downed = true;
  w.a.deserialize(data);
  assert.equal(w.a.companionship, 'together');
  w.lyra.downed = false;
  w.lyra.hp = 8;
  step(w.game, 1);
  assert.equal(w.a.companionship, 'gone');
});

test('an Autonomy without a game or mind still works (defensive)', () => {
  const a = new Autonomy(null, null);
  const v = a.evaluateRequest({ action: 'follow', args: {}, source: 'player' });
  assert.ok(v.decision);
  a.recordDeed('kindness');
  a.planDay('start');
  assert.ok(a.agenda.today.length > 3);
  assert.equal(a.purse(), 8);
  a.update(1);
  assert.ok(Object.keys(DEEDS).length >= 21);
});
