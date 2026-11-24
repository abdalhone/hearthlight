import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/events.js';
import { RNG } from '../src/core/rng.js';
import { GameClock } from '../src/core/time.js';
import { TILE, DAY_SECONDS } from '../src/core/constants.js';
import { EntityManager } from '../src/entities/manager.js';
import { Actor, factionRelation } from '../src/entities/entity.js';
import { ITEMS } from '../src/entities/items.js';
import { LocationIndex } from '../src/world/locations.js';
import { NPC_PROFILES, ASK_TOPICS, profileById } from '../src/entities/npc_data.js';
import { entryAt, scheduleProblems, adjustForWeather } from '../src/entities/npc_schedule.js';
import { NPC, KNOCKOUT_SECONDS, crimeActive } from '../src/entities/npc.js';
import { SPECIES, spawnCreature, Creature } from '../src/entities/monsters.js';
import { Spawner, zoneActive, MAX_CREATURES } from '../src/entities/spawner.js';
import { Walker, resetPathBudget } from '../src/entities/npc_walker.js';
import { dialogueTone } from '../src/entities/npc_dialogue.js';
import { paintHumanoid, HUMANOID_ANIMS, DIRECTIONS } from '../src/art/characters_humanoid.js';
import { normalizeAppearance, PRESET_APPEARANCES } from '../src/art/characters_appearance.js';
import { paintCreature, CREATURE_SPRITES, CREATURE_ANIMS } from '../src/art/creatures_art.js';
import { paintPortrait, EXPRESSIONS } from '../src/art/characters_portrait.js';
import { drawCharacter } from '../src/art/characters_art.js';

const DESIGN_LOCATIONS = [
  'hearthvale', 'town_square', 'player_home', 'ember_kettle', 'smithy', 'general_store', 'chapel', 'herbalist',
  'guardhouse', 'farmhouse', 'reed_farm', 'whisperwood', 'stonecut_quarry', 'bandit_camp', 'mirror_lake',
  'sunken_ruins', 'south_meadow', 'kings_road',
  // Round 3 places (DESIGN §19.2, LORE §10 homes), built by the world agent.
  'chandlery', 'lamplight_lane', 'ashby_house', 'dye_cottage', 'weavers_row', 'net_shed', 'wenna_hives',
];

// ---------------------------------------------------------------- a small fake world

// Combat that follows the contract closely enough for AI tests: faction hostility,
// guards vs a wanted player, provoked creatures; records every swing and shot.
class FakeCombat {
  constructor(game) {
    this.game = game;
    this.swings = [];
    this.shots = [];
    this.hostileOverride = null;
  }
  now() {
    return this.game.clock.t;
  }
  hasCrime(actor) {
    return !!actor?.crime && actor.crime.until > this.now();
  }
  isHostile(a, b) {
    if (this.hostileOverride) return this.hostileOverride(a, b);
    if (!a || !b || a === b) return false;
    if ((a.faction === 'guard' && this.hasCrime(b)) || (b.faction === 'guard' && this.hasCrime(a))) return true;
    if (factionRelation(a.faction, b.faction) === 'hostile') return true;
    const prov = (c, o) => c.provokedBy === o && c.provokedMode === 'fight' && this.now() - c.provokedAt < 45;
    return prov(a, b) || prov(b, a);
  }
  melee(attacker, opts = {}) {
    this.swings.push({ attacker, opts });
    return true;
  }
  shoot(attacker, tx, ty, kind = 'bolt', opts = {}) {
    this.shots.push({ attacker, tx, ty, kind, opts });
    return {};
  }
  down(target, by) {
    if (target.downed) return false;
    target.hp = 0;
    target.downed = true;
    target.setState('downed');
    this.game.bus.emit('downed', { entity: target, by });
    target.onDowned?.(by);
    return true;
  }
  revive(target, by, f = 0.35) {
    if (!target.downed) return false;
    target.downed = false;
    target.hp = Math.max(1, Math.round(target.maxHp * f));
    target.setState('idle');
    this.game.bus.emit('revived', { entity: target, by });
    target.onRevived?.(by);
    return true;
  }
}

function makeGame({ w = 80, h = 60, village = null, night = false, solid = null } = {}) {
  resetPathBudget();
  const locs = [
    { id: 'hearthvale', name: 'Hearthvale', kind: 'village', bounds: village || { x: 0, y: 0, w: 1, h: 1 } },
    { id: 'town_square', name: 'Town Square', kind: 'square', bounds: { x: 30, y: 20, w: 10, h: 8 }, parent: 'hearthvale' },
    { id: 'smithy', name: 'Ironhand Smithy', kind: 'building', indoor: true, bounds: { x: 10, y: 10, w: 6, h: 5 }, parent: 'hearthvale' },
    { id: 'ember_kettle', name: 'The Ember Kettle', kind: 'building', indoor: true, bounds: { x: 20, y: 10, w: 8, h: 6 }, parent: 'hearthvale' },
    { id: 'whisperwood', name: 'Whisperwood', kind: 'forest', bounds: { x: 50, y: 30, w: 30, h: 30 } },
  ];
  const said = [];
  const events = [];
  const game = {
    time: 0,
    bus: new EventBus(),
    rng: new RNG(11),
    settings: {},
    flags: {},
    locations: new LocationIndex(locs),
    map: {
      w,
      h,
      inBounds: (tx, ty) => tx >= 0 && ty >= 0 && tx < w && ty < h,
      isWater: () => false,
      blocksProjectile: () => false,
      buildingAt: () => null,
      isIndoors: () => false,
    },
    objects: { all: () => [], doorAt: () => null, isBlockingTile: () => false },
    isBlockedTile(tx, ty) {
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) return true;
      return solid ? solid(tx, ty) : false;
    },
    bubbles: { say: (e, text, o) => said.push({ e, text, o }), icon() {}, number() {} },
    camera: { x: 0, y: 0, vw: 320, vh: 200 },
    pathfinder: null,
    player: null,
    companion: null,
    said,
    events,
  };
  game.clock = new GameClock(game);
  game.clock.weather.timer = 1e9; // keep the sky still during tests
  if (night) game.clock.skipTo(23);
  game.entities = new EntityManager(game);
  game.combat = new FakeCombat(game);
  game.bus.on('*', (type, p) => events.push({ type, p }));
  return game;
}

function addPlayer(game, x, y) {
  const p = new Actor(game, { id: 'player', name: 'Traveler', faction: 'player', maxHp: 60, atk: 6, speed: 78, spriteKey: 'player', x, y });
  game.player = game.entities.add(p);
  return p;
}

// Advance the world: clock + entities, in fixed steps.
function run(game, seconds, dt = 1 / 30) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    game.time += dt;
    game.clock.t += dt;
    game.entities.update(dt);
    game.spawner?.update(dt);
  }
}

const px = (t) => t * TILE + TILE / 2;

// ---------------------------------------------------------------- villager profiles

test('the eighteen villagers exist with unique ids and complete profiles', () => {
  const ids = NPC_PROFILES.map((p) => p.id);
  assert.deepEqual(
    [...ids].sort(),
    ['alder', 'aveline', 'bram', 'corran', 'elda', 'garrick', 'hess', 'hobb', 'mira', 'petra', 'pip', 'rowan', 'sabeth', 'tansy', 'tilly', 'tobias', 'wenna', 'wys'],
  );
  assert.equal(new Set(ids).size, ids.length);
  for (const p of NPC_PROFILES) {
    assert.ok(p.name && p.role && p.personality && p.voice, `${p.id} has identity`);
    assert.ok(Array.isArray(p.traits) && p.traits.length >= 3, `${p.id} traits`);
    assert.ok(p.age > 0 && p.home && p.work, `${p.id} age/home/work`);
    assert.ok(DESIGN_LOCATIONS.includes(p.home), `${p.id} home is a DESIGN location`);
    assert.ok(p.appearance && p.appearance.hairStyle, `${p.id} appearance`);
    assert.ok(p.greetings.length >= 3 && p.lines.day.length && p.lines.night.length && p.lines.rain.length, `${p.id} lines`);
    for (const k of ['cold', 'crime', 'shaken', 'lyraAlone']) assert.ok(p[k]?.length, `${p.id} ${k} lines`);
    for (const k of ['apart', 'left', 'gone']) assert.ok(p.aboutLyra?.[k]?.length, `${p.id} aboutLyra.${k}`);
    assert.ok(p.knows && Object.keys(p.knows).length >= 7, `${p.id} knows others`);
  }
  assert.equal(profileById('rowan').faction, 'guard');
  assert.equal(profileById('wys').faction, 'guard');
  assert.equal(profileById('nobody'), null);
});

test('schedules cover 24 hours at DESIGN locations with known activities', () => {
  for (const p of NPC_PROFILES) {
    assert.deepEqual(scheduleProblems(p.schedule, DESIGN_LOCATIONS), [], `${p.id} schedule`);
    for (let h = 0; h < 24; h += 0.25) assert.ok(entryAt(p.schedule, h), `${p.id} covers ${h}`);
  }
  assert.deepEqual(scheduleProblems([{ from: 0, to: 10, activity: 'sleep', at: 'smithy' }], DESIGN_LOCATIONS), ['gap 10-24']);
  assert.ok(scheduleProblems([{ from: 0, to: 24, activity: 'dance', at: 'moon' }], DESIGN_LOCATIONS).length === 2);
});

test('every item id in profiles exists; shops for bram, elda and garrick; Elda rents Lyra a room', () => {
  for (const p of NPC_PROFILES) {
    for (const id of [...p.likes, ...p.dislikes]) assert.ok(ITEMS[id], `${p.id} likes/dislikes ${id}`);
    if (p.shop) {
      for (const s of p.shop.sells) assert.ok(ITEMS[s.id] && s.price > 0, `${p.id} sells ${s.id}`);
      for (const [id, price] of Object.entries(p.shop.buys)) assert.ok(ITEMS[id] && price > 0, `${p.id} buys ${id}`);
    }
  }
  for (const id of ['bram', 'elda', 'garrick']) assert.ok(profileById(id).shop, `${id} has a shop`);
  const room = profileById('elda').rooms.lyra;
  assert.equal(room.bed, 'lyra_inn_bed');
  assert.ok(room.price > 0 && room.paid.length && room.credit.length);
});

test('facts: 10+ each, unique ids, spoken lines, and the Maren clues', () => {
  const all = new Set();
  for (const p of NPC_PROFILES) {
    assert.ok(p.facts.length >= 10, `${p.id} has ${p.facts.length} facts`);
    for (const f of p.facts) {
      assert.ok(!all.has(f.id), `duplicate fact ${f.id}`);
      all.add(f.id);
      assert.ok(f.text && f.say && f.topic, `${f.id} complete`);
      assert.ok(f.minFamiliarity >= 0 && f.minFamiliarity <= 100);
    }
    assert.ok(p.facts.some((f) => f.topic === 'secret'), `${p.id} has a secret`);
    assert.ok(p.facts.some((f) => f.topic === 'maren'), `${p.id} has a Maren clue`);
  }
  const has = (id, re) => profileById(id).facts.some((f) => f.topic === 'maren' && re.test(f.text));
  assert.ok(has('aveline', /Sunken Ruins/));
  assert.ok(has('rowan', /bandits.*rusted key|rusted key/i));
  assert.ok(has('garrick', /lamp oil.*rope/));
  assert.ok(has('elda', /room/));
  const topics = new Set(ASK_TOPICS.flatMap((t) => t.factTopics));
  for (const p of NPC_PROFILES) for (const f of p.facts) assert.ok(topics.has(f.topic), `${f.id} topic ${f.topic} is askable`);
});

test('weather bends schedules: rain sends socializers to the inn and everyone home at night', () => {
  const e = { from: 15, to: 16, activity: 'socialize', at: 'town_square' };
  const indoor = (id) => ['ember_kettle', 'smithy'].includes(id);
  assert.equal(adjustForWeather(e, { raining: true, night: false, isIndoor: indoor, home: 'smithy' }).at, 'ember_kettle');
  assert.equal(adjustForWeather(e, { raining: true, night: true, isIndoor: indoor, home: 'smithy' }).at, 'smithy');
  assert.equal(adjustForWeather(e, { raining: false, night: true, isIndoor: indoor, home: 'smithy' }), e);
});

// ---------------------------------------------------------------- species

test('species table: every creature in DESIGN with tuned, valid stats', () => {
  const need = ['slime', 'wolf', 'boar', 'deer', 'rabbit', 'chicken', 'cat', 'bat', 'skeleton', 'bandit', 'bandit_archer', 'bandit_chief'];
  for (const id of need) {
    const s = SPECIES[id];
    assert.ok(s, id);
    for (const k of ['hp', 'atk', 'def', 'speed', 'xp', 'aggroRadius', 'leashRadius', 'threat']) assert.ok(Number.isFinite(s[k]), `${id}.${k}`);
    assert.ok(s.threat >= 0 && s.threat <= 3);
    for (const d of s.drops) {
      assert.ok(ITEMS[d[0]], `${id} drops ${d[0]}`);
      assert.ok(d[1] > 0 && d[1] <= 1);
    }
    assert.ok(CREATURE_SPRITES[s.spriteKey] || PRESET_APPEARANCES[s.spriteKey], `${id} has art (${s.spriteKey})`);
  }
  assert.equal(SPECIES.cat.aggroRadius, 0);
  assert.equal(SPECIES.cat.faction, 'wildlife');
  assert.equal(SPECIES.bat.flying, true);
  assert.ok(SPECIES.bandit_chief.hp >= SPECIES.bandit.hp * 2.5 && SPECIES.bandit_chief.slam);
  // A slime falls to about three of the player's swings; the chief takes both of you.
  assert.ok(Math.ceil(SPECIES.slime.hp / (6 - SPECIES.slime.def)) <= 3);
  assert.ok(SPECIES.bandit_chief.threat === 3 && SPECIES.rabbit.threat === 0);
});

test('spawned creatures expose drops, xpValue, species, home, aggroRadius and threat', () => {
  const g = makeGame();
  const w = spawnCreature(g, 'wolf', 100, 120);
  assert.ok(w instanceof Creature);
  assert.equal(w.species, 'wolf');
  assert.deepEqual(w.drops, SPECIES.wolf.drops);
  assert.notEqual(w.drops, SPECIES.wolf.drops, 'a copy, not the shared table');
  assert.equal(w.xpValue, SPECIES.wolf.xp);
  assert.deepEqual(w.home, { x: 100, y: 120 });
  assert.equal(w.aggroRadius, SPECIES.wolf.aggroRadius);
  assert.equal(w.threat, 2);
  assert.equal(w.maxHp, SPECIES.wolf.hp);
  assert.equal(g.entities.get(w.id), w);
  const warn = console.warn;
  console.warn = () => {};
  const x = spawnCreature(g, 'dragon', 10, 10);
  console.warn = warn;
  assert.equal(x.species, 'slime');
});

// ---------------------------------------------------------------- creature AI

test('a wolf notices the player, chases, telegraphs, bites, and recovers', () => {
  const g = makeGame();
  const p = addPlayer(g, px(20), px(20));
  const w = spawnCreature(g, 'wolf', px(20) + 80, px(20));
  const seen = new Set();
  for (let i = 0; i < 300 && g.combat.swings.length === 0; i++) {
    run(g, 1 / 30);
    seen.add(w.ai.state);
    p.x = px(20);
    p.y = px(20);
  }
  assert.ok(seen.has('notice') && seen.has('chase') && seen.has('windup'), [...seen].join(','));
  assert.equal(w.target, p);
  assert.ok(g.combat.swings.length >= 1);
  assert.equal(g.combat.swings[0].attacker, w);
  assert.equal(g.combat.swings[0].opts.target, p);
  assert.equal(g.combat.swings[0].opts.kind, 'bite');
  run(g, 1 / 30);
  assert.equal(w.ai.state, 'recover');
});

test('creature targets go through combat.isHostile', () => {
  const g = makeGame();
  addPlayer(g, px(20), px(20));
  const w = spawnCreature(g, 'wolf', px(20) + 60, px(20));
  g.combat.hostileOverride = () => false;
  run(g, 2);
  assert.equal(w.target, null);
  assert.ok(['idle', 'wander'].includes(w.ai.state));
  g.combat.hostileOverride = null;
  run(g, 1);
  assert.ok(w.target === g.player);
});

test('wolves call the pack; a leashed wolf gives up and goes home', () => {
  const g = makeGame();
  const p = addPlayer(g, px(10), px(10));
  const a = spawnCreature(g, 'wolf', px(10) + 90, px(10));
  const b = spawnCreature(g, 'wolf', px(10) + 200, px(10) + 40);
  run(g, 0.5);
  assert.equal(a.target, p);
  assert.equal(b.target, p, 'the second wolf joined the hunt');
  // Drag the player far away: the wolves stop at their leash and return.
  p.x = px(70);
  p.y = px(50);
  run(g, 4);
  assert.ok(a.target === null && ['return', 'idle', 'wander'].includes(a.ai.state), a.ai.state);
});

test('wild creatures will not follow prey into the village', () => {
  const g = makeGame({ village: { x: 0, y: 0, w: 20, h: 60 } });
  const p = addPlayer(g, px(18), px(20));
  const w = spawnCreature(g, 'wolf', px(26), px(20));
  run(g, 0.4);
  assert.equal(w.target, null, 'prey inside the village is not hunted');
  p.x = px(24);
  run(g, 0.6);
  assert.equal(w.target, p);
  p.x = px(10);
  run(g, 3);
  assert.equal(w.target, null);
  assert.ok(w.x >= 20 * TILE - 2, 'the wolf stayed out of the village');
});

test('boars are peaceful until provoked, then wind up and charge', () => {
  const g = makeGame();
  const p = addPlayer(g, px(20), px(20));
  const b = spawnCreature(g, 'boar', px(20) + 60, px(20));
  run(g, 2);
  assert.equal(b.target, null);
  b.provokedBy = p;
  b.provokedAt = g.clock.t;
  b.provokedMode = 'fight';
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    run(g, 1 / 30);
    seen.add(b.ai.state);
    p.x = px(20);
    p.y = px(20);
    if (seen.has('charge') && g.combat.swings.length) break;
  }
  assert.ok(seen.has('paw') && seen.has('charge'), [...seen].join(','));
  assert.ok(g.combat.swings.some((s) => s.attacker === b && s.opts.target === p));
});

test('rabbits and deer flee from people; the cat never picks a fight', () => {
  const g = makeGame();
  const p = addPlayer(g, px(30), px(30));
  const r = spawnCreature(g, 'rabbit', px(30) + 30, px(30));
  const cat = spawnCreature(g, 'cat', px(30) - 30, px(30));
  const d0 = Math.hypot(r.x - p.x, r.y - p.y);
  p.moved = 1;
  for (let i = 0; i < 45; i++) {
    p.moved = 1;
    run(g, 1 / 30);
  }
  assert.equal(r.ai.state, 'flee');
  assert.ok(Math.hypot(r.x - p.x, r.y - p.y) > d0 + 10, 'the rabbit ran');
  run(g, 5);
  assert.equal(cat.target, null);
  assert.ok(!g.combat.swings.some((s) => s.attacker === cat));
});

test('archers keep their distance and shoot arrows through combat.shoot', () => {
  const g = makeGame();
  const p = addPlayer(g, px(20), px(20));
  const a = spawnCreature(g, 'bandit_archer', px(20) + 40, px(20));
  for (let i = 0; i < 240 && !g.combat.shots.length; i++) {
    run(g, 1 / 30);
    p.x = px(20);
    p.y = px(20);
  }
  assert.ok(g.combat.shots.length >= 1, 'shot');
  const s = g.combat.shots[0];
  assert.equal(s.kind, 'arrow');
  assert.equal(s.attacker, a);
  assert.ok(Math.hypot(a.x - p.x, a.y - p.y) > 50, 'backed off before shooting');
});

test('the bandit chief marks the ground before a heavy slam', () => {
  const g = makeGame();
  const p = addPlayer(g, px(20), px(20));
  const c = spawnCreature(g, 'bandit_chief', px(20) + 30, px(20));
  let marked = false;
  let slam = null;
  for (let i = 0; i < 400 && !slam; i++) {
    run(g, 1 / 30);
    p.x = px(20);
    p.y = px(20);
    if (c.slamAt) marked = true;
    slam = g.combat.swings.find((s) => s.attacker === c && s.opts.arc > 6);
  }
  assert.ok(marked, 'the slam was telegraphed');
  assert.ok(slam && slam.opts.heavy, 'the slam landed');
});

test('flying bats bob above the ground', () => {
  const g = makeGame({ night: true });
  addPlayer(g, px(5), px(5));
  const b = spawnCreature(g, 'bat', px(10), px(10));
  run(g, 1);
  assert.ok(b.flying && b.z > 4);
});

// ---------------------------------------------------------------- spawner

test('spawner keeps zones at their caps, out of view, and honors night zones', () => {
  const g = makeGame();
  addPlayer(g, px(5), px(5));
  g.camera = { x: 0, y: 0, vw: 200, vh: 150 };
  g.spawner = new Spawner(g, [
    { id: 'woods', locationId: 'whisperwood', species: ['rabbit', 'deer'], max: 4, rect: { x: 50, y: 30, w: 25, h: 25 } },
    { id: 'night_bats', locationId: 'whisperwood', species: ['bat'], max: 3, night: true, rect: { x: 50, y: 30, w: 25, h: 25 } },
    { id: 'bad', species: ['unicorn'], max: 3, rect: { x: 0, y: 0, w: 3, h: 3 } },
  ]);
  assert.equal(g.spawner.zones.length, 2, 'zones with unknown species are dropped');
  run(g, 400, 0.25);
  const members = (id) => g.entities.all().filter((e) => e.spawnZone === id && !e.removed);
  assert.equal(members('woods').length, 4);
  assert.equal(members('night_bats').length, 0, 'no bats by day');
  for (const e of members('woods')) assert.ok(e.x > 200 || e.y > 150, 'spawned out of view');
  g.clock.skipTo(22);
  run(g, 120, 0.25);
  assert.equal(members('night_bats').length, 3, 'bats come out at night');
  g.clock.skipTo(10);
  run(g, 3, 0.25);
  assert.equal(members('night_bats').length, 0, 'and leave at dawn');
  assert.equal(zoneActive({ night: true }, false), false);
  assert.equal(zoneActive({ night: false }, false), true);
  assert.equal(zoneActive({}, true), true);
});

test('spawner respects the global cap and never spawns in the village', () => {
  const g = makeGame({ village: { x: 0, y: 0, w: 40, h: 60 } });
  addPlayer(g, px(2), px(2));
  g.camera = { x: 0, y: 0, vw: 10, vh: 10 };
  g.spawner = new Spawner(g, [{ id: 'all', species: ['slime'], max: 500, rect: { x: 0, y: 0, w: 80, h: 60 } }]);
  run(g, 2000, 0.5);
  const slimes = g.entities.all().filter((e) => e.species === 'slime');
  assert.ok(slimes.length <= MAX_CREATURES && slimes.length > 20, `${slimes.length}`);
  for (const s of slimes) assert.ok(s.x >= 40 * TILE, 'outside the village');
  const saved = g.spawner.serialize();
  assert.ok(saved && typeof saved.next === 'object');
});

// ---------------------------------------------------------------- villagers

function makeVillage() {
  const g = makeGame();
  const p = addPlayer(g, px(32), px(22));
  const bram = g.entities.add(new NPC(g, profileById('bram'), { x: px(33), y: px(22) }));
  const rowan = g.entities.add(new NPC(g, profileById('rowan'), { x: px(36), y: px(24) }));
  const elda = g.entities.add(new NPC(g, profileById('elda'), { x: px(30), y: px(24) }));
  return { g, p, bram, rowan, elda };
}

test('a knocked-out villager left alone gets up after 30 s at half health and goes home shaken', () => {
  const { g, bram, rowan, elda } = makeVillage();
  // Nobody about to help him up (the village answering is tested in villagers.test.mjs).
  g.entities.remove(rowan);
  g.entities.remove(elda);
  g.combat.down(bram, g.player);
  assert.equal(bram.state, 'downed');
  assert.equal(bram.mode, 'downed');
  run(g, KNOCKOUT_SECONDS - 1, 0.1);
  assert.ok(bram.downed, 'still down before 30 s');
  run(g, 1.5, 0.1);
  assert.ok(!bram.downed && bram.isAlive());
  assert.equal(bram.hp, Math.round(bram.maxHp * 0.5));
  assert.equal(bram.shakenDay, g.clock.day);
  const e = bram.currentEntry();
  assert.equal(e.at, 'smithy');
  assert.ok(['rest', 'sleep'].includes(e.activity));
  assert.ok(g.events.some((ev) => ev.type === 'revived' && ev.p.entity === bram));
});

test('a villager hit to zero by anything is knocked out, never killed', () => {
  const { g, elda } = makeVillage();
  elda.hp = 0;
  run(g, 0.1);
  assert.ok(elda.downed && !elda.dead);
});

test('crimes: witnesses flee and shout, guards fight the player only while the crime lasts', () => {
  const { g, p, bram, rowan, elda } = makeVillage();
  const o0 = { bram: bram.opinionOfPlayer, elda: elda.opinionOfPlayer };
  p.crime = { level: 2, kind: 'knockout', until: g.clock.t + 20 };
  g.combat.down(bram, p);
  g.bus.emit('crime', { actor: p, victim: bram, kind: 'knockout' });
  assert.equal(elda.mode, 'flee');
  assert.equal(elda.fleeFrom, p);
  assert.ok(g.said.some((s) => s.e === elda && profileById('elda').crime.includes(s.text)), 'Elda shouted');
  assert.equal(rowan.mode, 'fight');
  assert.equal(rowan.fightTarget, p);
  assert.ok(bram.opinionOfPlayer <= Math.max(0, o0.bram - 30), 'the victim thinks much less of the player');
  assert.ok(elda.opinionOfPlayer < o0.elda - 10 && elda.opinionOfPlayer > bram.opinionOfPlayer - 50);
  assert.ok(crimeActive(g, p));
  // The guard swings at the wanted player.
  let hit = false;
  for (let i = 0; i < 120 && !hit; i++) {
    run(g, 1 / 30);
    hit = g.combat.swings.some((s) => s.attacker === rowan && s.opts.target === p);
  }
  assert.ok(hit, 'Rowan attacked the player');
  // Cold greetings and a closed shop for the rest of the day.
  assert.equal(dialogueTone(elda, p), elda.distTo(p) < 150 ? 'afraid' : 'cold');
  assert.ok(elda.refusesTrade(p));
  // The crime runs out: the guard stands down and nobody keeps running.
  p.crime.until = g.clock.t - 1;
  run(g, 1);
  assert.equal(rowan.mode, 'routine');
  assert.equal(rowan.fightTarget, null);
  assert.equal(g.combat.isHostile(rowan, p), false);
  p.x = px(70);
  p.y = px(50);
  run(g, 12);
  // Elda stops running; she is back to her day, or back at Bram's side (DESIGN §19.7).
  assert.ok(elda.mode === 'routine' || (elda.mode === 'help' && elda.help?.victim === bram), elda.mode);
  assert.equal(dialogueTone(elda, p), 'cold');
  const d = elda.getDialogue(p);
  assert.ok(profileById('elda').cold.includes(d.lines[0]));
});

test('villagers run from monsters and guards fight them', () => {
  const { g, rowan, elda } = makeVillage();
  const wolf = spawnCreature(g, 'wolf', elda.x + 40, elda.y);
  wolf.target = elda; // hunting already
  run(g, 0.5);
  assert.equal(elda.mode, 'flee');
  assert.equal(elda.fleeFrom, wolf);
  assert.equal(rowan.mode, 'fight');
  assert.equal(rowan.fightTarget, wolf);
});

test('dialogue: options, topics emit npc_topic, facts unlock with familiarity', () => {
  const { g, p } = makeVillage();
  const av = g.entities.add(new NPC(g, profileById('aveline'), { x: px(31), y: px(22) }));
  const garrick = g.entities.add(new NPC(g, profileById('garrick'), { x: px(31), y: px(23) }));
  const d = garrick.getDialogue(p);
  assert.ok(d.lines.length >= 1);
  assert.deepEqual(d.options.map((o) => o.id), ['talk', 'ask', 'gift', 'shop', 'bye']);
  const ask = av.chooseOption('ask', p);
  assert.ok(ask.options.some((o) => o.id === 'ask:maren'));
  const r = av.chooseOption('ask:maren', p);
  assert.ok(r.lines.some((l) => /ruins/i.test(l)), r.lines.join(' | '));
  const ev = g.events.find((e) => e.type === 'npc_topic');
  assert.ok(ev && ev.p.npc === av && ev.p.topic === 'maren' && ev.p.player === p);
  // Deep secrets wait for friendship.
  const secret = profileById('aveline').facts.find((f) => f.topic === 'maren' && f.minFamiliarity >= 30);
  for (let i = 0; i < 3; i++) av.chooseOption('ask:maren', p);
  assert.ok(!av.told.has(secret.id));
  av.familiarity = 100;
  for (let i = 0; i < 4; i++) av.chooseOption('ask:maren', p);
  assert.ok(av.told.has(secret.id));
  assert.equal(garrick.chooseOption('shop', p).open, 'shop');
  assert.equal(garrick.chooseOption('gift', p).open, 'gift');
  assert.ok(garrick.chooseOption('bye', p).close);
});

test('gifts: liked, neutral and disliked move opinion, and the first gift of a day counts most', () => {
  const { g, p, bram } = makeVillage();
  const o = bram.opinionOfPlayer;
  const liked = bram.receiveGift('iron_ore', p);
  assert.equal(liked.liked, 1);
  assert.ok(liked.lines[0]);
  assert.equal(bram.opinionOfPlayer, o + 8);
  assert.equal(bram.receiveGift('slime_gel', p).liked, -1);
  assert.equal(bram.receiveGift('bread', p).liked, 0);
  assert.ok(bram.opinionOfPlayer < o + 8);
  // Lyra giving: said aloud, the player's standing untouched.
  const before = bram.opinionOfPlayer;
  const lyra = g.entities.add(new Actor(g, { id: 'lyra', name: 'Lyra', faction: 'player', x: bram.x + 10, y: bram.y }));
  g.companion = lyra;
  bram.receiveGift('crystal', lyra);
  assert.equal(bram.opinionOfPlayer, before);
  assert.ok(g.events.some((e) => e.type === 'speech' && e.p.speaker === bram && e.p.target === lyra));
});

test('villagers talk to Lyra when she lives apart, and Elda rents her the room', () => {
  const { g, p, elda } = makeVillage();
  const lyra = g.entities.add(new Actor(g, { id: 'lyra', name: 'Lyra', faction: 'player', x: elda.x + 12, y: elda.y }));
  lyra.mind = { companionship: 'apart', agenda: { purse: 20 } };
  g.companion = lyra;
  p.x = px(70);
  p.y = px(50);
  g.clock.skipTo(19);
  lyra.x = px(22);
  lyra.y = px(12);
  elda.x = px(23);
  elda.y = px(12);
  const info = elda.rentRoom(lyra);
  assert.ok(info.paid);
  assert.equal(lyra.mind.agenda.purse, 20 - profileById('elda').rooms.lyra.price);
  assert.equal(g.flags.lyra_inn_room.bed, 'lyra_inn_bed');
  assert.ok(g.events.some((e) => e.type === 'room_rented' && e.p.actor === lyra));
  // Talking to the player about her.
  p.x = elda.x + 20;
  p.y = elda.y;
  const d = elda.getDialogue(p);
  assert.ok(d.lines.some((l) => profileById('elda').aboutLyra.apart.includes(l)), d.lines.join(' | '));
});

test('Pip asks Lyra for a magic trick', () => {
  const g = makeGame();
  addPlayer(g, px(30), px(22));
  const pip = g.entities.add(new NPC(g, profileById('pip'), { x: px(31), y: px(22) }));
  const lyra = g.entities.add(new Actor(g, { id: 'lyra', name: 'Lyra', faction: 'player', x: pip.x + 20, y: pip.y }));
  g.companion = lyra;
  let asked = false;
  for (let i = 0; i < 40 && !asked; i++) {
    lyra.x = pip.x + 20;
    lyra.y = pip.y;
    run(g, 0.5);
    asked = g.events.some((e) => e.type === 'speech' && e.p.speaker === pip && e.p.target === lyra);
  }
  assert.ok(asked);
});

test('npc serialize/deserialize keeps opinion, familiarity and what was told', () => {
  const { g, bram } = makeVillage();
  bram.opinionOfPlayer = 77;
  bram.familiarity = 42;
  bram.told.add('bram_forge');
  bram.shakenDay = 3;
  const d = JSON.parse(JSON.stringify(bram.serialize()));
  const b2 = new NPC(g, profileById('bram'), { x: 0, y: 0 });
  b2.deserialize(d);
  assert.equal(b2.opinionOfPlayer, 77);
  assert.equal(b2.familiarity, 42);
  assert.ok(b2.told.has('bram_forge'));
  assert.equal(b2.shakenDay, 3);
  assert.equal(b2.x, bram.x);
});

test('villagers follow their schedule to the right place', () => {
  const { g, bram } = makeVillage();
  g.clock.skipTo(9); // Bram works at the smithy from 5:30
  g.player.x = bram.x + 4; // keep him in view so he walks
  run(g, 20, 1 / 20);
  const smithy = g.locations.get('smithy').bounds;
  const tx = bram.x / TILE;
  const ty = bram.y / TILE;
  assert.equal(bram.activity, 'work');
  assert.ok(tx >= smithy.x && tx < smithy.x + smithy.w && ty >= smithy.y && ty < smithy.y + smithy.h, `${tx},${ty}`);
});

test('the walker opens doors on its path and closes them behind', () => {
  const g = makeGame({ solid: (tx, ty) => tx === 10 && ty !== 5 });
  const door = {
    objType: 'door',
    tx: 10,
    ty: 5,
    state: { open: false },
    get isOpen() {
      return this.state.open;
    },
    open() {
      this.state.open = true;
      return true;
    },
    close() {
      this.state.open = false;
      return true;
    },
  };
  g.objects.doorAt = (tx, ty) => (tx === 10 && ty === 5 ? door : null);
  const blocked = g.isBlockedTile;
  g.isBlockedTile = (tx, ty, a) => blocked(tx, ty, a) || (tx === 10 && ty === 5 && !door.state.open);
  g.pathfinder = { find: (sx, sy, gx, gy) => [{ x: px(9), y: px(5) }, { x: px(10), y: px(5) }, { x: px(11), y: px(5) }, { x: gx, y: gy }] };
  const a = g.entities.add(new Actor(g, { id: 'walker', x: px(6), y: px(5), speed: 60 }));
  const w = new Walker(g, a, { doors: true });
  w.goTo(px(15), px(5));
  let opened = false;
  for (let i = 0; i < 400; i++) {
    g.time += 1 / 30;
    const r = w.step(1 / 30);
    a.update(1 / 30);
    if (door.state.open) opened = true;
    if (r === 'arrived') break;
  }
  w.step(1 / 30);
  assert.ok(opened, 'opened the door');
  assert.ok(Math.abs(a.x - px(15)) < 4, `arrived at ${a.x}`);
  assert.equal(door.state.open, false, 'closed it behind');
});

// ---------------------------------------------------------------- art

test('every humanoid paints every anim and direction; creatures paint their anims', () => {
  const keys = { ...PRESET_APPEARANCES };
  for (const p of NPC_PROFILES) keys[p.id] = p.appearance;
  for (const [key, app] of Object.entries(keys)) {
    const a = normalizeAppearance({ ...app, key });
    for (const [anim, spec] of Object.entries(HUMANOID_ANIMS)) {
      for (const dir of DIRECTIONS) {
        const sp = paintHumanoid(a, anim, dir, spec.frames - 1);
        const px = sp.render();
        let n = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i]) n++;
        assert.ok(n > 60, `${key} ${anim} ${dir} has pixels (${n})`);
      }
    }
  }
  for (const key of Object.keys(CREATURE_SPRITES)) {
    for (const [anim, spec] of Object.entries(CREATURE_ANIMS[CREATURE_SPRITES[key]])) {
      for (const dir of DIRECTIONS) assert.ok(paintCreature(key, anim, dir, spec.frames - 1), `${key} ${anim} ${dir}`);
    }
  }
});

test('Lyra has every portrait expression, including afraid and cold', () => {
  for (const e of ['neutral', 'happy', 'sad', 'angry', 'surprised', 'worried', 'love', 'sleepy', 'afraid', 'cold']) assert.ok(EXPRESSIONS.includes(e), e);
  const a = normalizeAppearance({ ...PRESET_APPEARANCES.lyra, key: 'lyra' });
  const seen = new Set();
  for (const e of EXPRESSIONS) {
    const sp = paintPortrait(a, e);
    assert.equal(sp.w, 48);
    const bytes = sp.render();
    let h = 0;
    for (let i = 0; i < bytes.length; i++) h = (h * 31 + bytes[i]) >>> 0;
    seen.add(h);
  }
  assert.equal(seen.size, EXPRESSIONS.length, 'each expression looks different');
});

test('drawCharacter never throws: unknown keys get a visible fallback', () => {
  const calls = [];
  const ctx = { fillRect: (...a) => calls.push(a), drawImage() {}, set fillStyle(v) {}, globalAlpha: 1 };
  const atlas = { getMeta: () => undefined, has: () => false, draw: () => false };
  assert.equal(drawCharacter(ctx, atlas, 'nobody', 'idle', 'down', 0, 10, 10), false);
  assert.ok(calls.length > 0, 'something was drawn');
  assert.equal(drawCharacter(null, null, 'x', 'idle', 'down', 0, 0, 0), false);
});
