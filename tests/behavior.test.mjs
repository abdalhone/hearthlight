import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/events.js';
import { TILE } from '../src/core/constants.js';
import { Actor, factionRelation } from '../src/entities/entity.js';
import { EntityManager } from '../src/entities/manager.js';
import { LocationIndex } from '../src/world/locations.js';
import { ActionRegistry } from '../src/ai/brain/actions.js';
import { PluginRegistry } from '../src/ai/plugins/registry.js';
import { Behavior } from '../src/ai/behavior/behavior.js';
import { selectTarget } from '../src/ai/behavior/combat_ai.js';
import { classifyActivity, activeEntry } from '../src/ai/behavior/own_life.js';
import { firstMessage } from '../src/ai/behavior/phrases.js';
import { Companion } from '../src/entities/companion.js';
import { coreCommandsPlugin } from '../src/ai/plugins/core_commands.js';
import { worldPlugin } from '../src/ai/plugins/world_plugin.js';
import { jobsPlugin } from '../src/ai/plugins/jobs_plugin.js';

// ---------------------------------------------------------------- a fake world

const W = 60;
const H = 40;
const T = (n) => n * TILE + TILE / 2;

const LOCS = [
  { id: 'hearthvale', name: 'Hearthvale', kind: 'village', bounds: { x: 0, y: 0, w: W, h: H } },
  { id: 'town_square', name: 'Town Square', kind: 'square', bounds: { x: 16, y: 16, w: 10, h: 8 }, parent: 'hearthvale' },
  { id: 'ember_kettle', name: 'The Ember Kettle', kind: 'building', indoor: true, bounds: { x: 30, y: 18, w: 6, h: 5 }, aliases: ['inn', 'tavern', 'kettle'] },
  { id: 'chapel', name: 'Chapel of the Hearth', kind: 'building', indoor: true, bounds: { x: 30, y: 28, w: 5, h: 5 } },
  { id: 'whisperwood', name: 'Whisperwood', kind: 'forest', danger: 1, bounds: { x: 2, y: 2, w: 16, h: 10 }, aliases: ['forest', 'woods'] },
  { id: 'bandit_camp', name: 'Bandit Camp', kind: 'camp', danger: 3, bounds: { x: 44, y: 2, w: 12, h: 10 } },
  { id: 'kings_road', name: "King's Road", kind: 'road', bounds: { x: 0, y: 36, w: W, h: 3 } },
];

function makeClock(hour) {
  return {
    t: 0,
    hour,
    day: 1,
    weather: { type: 'clear', intensity: 0 },
    get isNight() {
      return this.hour >= 20.5 || this.hour < 5;
    },
    get phase() {
      const h = this.hour;
      if (h < 5) return 'night';
      if (h < 7) return 'dawn';
      if (h < 18) return 'day';
      if (h < 20.5) return 'dusk';
      return 'night';
    },
    get daylight() {
      return this.isNight ? 0 : 1;
    },
  };
}

function makeMap() {
  const solid = new Set();
  return {
    w: W,
    h: H,
    buildings: [],
    solid,
    inBounds: (tx, ty) => tx >= 0 && ty >= 0 && tx < W && ty < H,
    isSolidTile(tx, ty) {
      return !this.inBounds(tx, ty) || solid.has(`${tx},${ty}`);
    },
    isWater: () => false,
    blocksProjectile(tx, ty) {
      return !this.inBounds(tx, ty);
    },
    buildingAt: () => null,
    isIndoors: () => false,
  };
}

class FakeObjects {
  constructor() {
    this.list = [];
  }
  add(o) {
    this.list.push(o);
    return o;
  }
  get(id) {
    return this.list.find((o) => o.id === id) || null;
  }
  all() {
    return this.list;
  }
  inRadius(x, y, r, f) {
    return this.list.filter((o) => Math.hypot(o.x - x, o.y - y) <= r && (!f || f(o)));
  }
  nearest(tf, x, y, r = Infinity) {
    const f = typeof tf === 'function' ? tf : (o) => o.objType === tf;
    let best = null;
    let bd = r;
    for (const o of this.list) {
      if (!f(o)) continue;
      const d = Math.hypot(o.x - x, o.y - y);
      if (d <= bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }
  doorAt(tx, ty) {
    return this.list.find((o) => o.objType === 'door' && o.tx === tx && o.ty === ty) || null;
  }
  isBlockingTile(tx, ty, a) {
    return this.list.some((o) => o.blocksTile?.(tx, ty, a));
  }
  findByWord(w, x, y) {
    return this.nearest((o) => o.objType === w, x, y, 600);
  }
}

// A harvestable object with the work API (DESIGN §6).
function workObject(objType, tx, ty, itemId, { qty = 1, seconds = 0.5, solid = true } = {}) {
  return {
    id: `${objType}_${tx}_${ty}`,
    objType,
    name: objType,
    tx,
    ty,
    x: T(tx),
    y: ty * TILE + TILE - 1,
    solid,
    workSeconds: seconds,
    done: false,
    progress: 0,
    canWork() {
      return !this.done;
    },
    work(actor, dt) {
      this.progress += dt;
      if (this.progress >= this.workSeconds) {
        this.done = true;
        return { done: true, progress: 1, items: [{ id: itemId, qty }] };
      }
      return { done: false, progress: this.progress / this.workSeconds };
    },
    blocksTile(x, y) {
      return this.solid && !this.done && x === this.tx && y === this.ty;
    },
  };
}

function fakeCombat(game) {
  return {
    calls: [],
    isHostile: (a, b) => factionRelation(a.faction, b.faction) === 'hostile',
    shoot(a, x, y, kind, o) {
      this.calls.push(['shoot', o?.target]);
      return {};
    },
    melee(a, o) {
      this.calls.push(['melee', o?.target]);
      return true;
    },
    castHeal(c, t) {
      this.calls.push(['castHeal', t]);
      return 10;
    },
    heal() {
      return 0;
    },
    useItem(a, id) {
      if (!a.inventory.has(id)) return false;
      a.inventory.remove(id, 1);
      this.calls.push(['useItem', id]);
      return true;
    },
    revive(t, by, f) {
      this.calls.push(['revive', t, by, f]);
      t.downed = false;
      t.hp = Math.round(t.maxHp * f);
      game.bus.emit('revived', { entity: t, by });
    },
  };
}

function fakeMind(game) {
  const rels = new Map();
  const relationships = {
    get: (id) => rels.get(id) || null,
    set: (id, r) => rels.set(id, { id, affinity: 0, trust: 50, fear: 0, tags: [], ...r }),
    isFriend(e) {
      if (!e) return false;
      if (e === game.player || e.id === 'lyra') return true;
      const r = rels.get(e.id);
      if (r?.tags.includes('enemy')) return false;
      if (r && (r.tags.includes('friend') || r.tags.includes('pet') || r.affinity >= 30)) return true;
      return e.faction === 'villager' || e.faction === 'guard';
    },
    isEnemy(e) {
      const r = rels.get(e?.id);
      return !!r && (r.tags.includes('enemy') || r.affinity <= -40);
    },
  };
  relationships.set('player', { name: 'Traveler', trust: 60, affinity: 40 });
  return {
    companionship: 'together',
    agenda: { today: [], sleepAt: 'lyra_bed', purse: 0 },
    emotions: { fear: 0 },
    needs: { energy: 0.9, hunger: 0.9, social: 0.8, fun: 0.8, safety: 0.9 },
    remembered: [],
    remember(text) {
      this.remembered.push(text);
      return { text };
    },
    feel() {},
    update() {},
    relationships,
  };
}

function makeGame({ hour = 10 } = {}) {
  const game = {};
  game.bus = new EventBus();
  game.settings = {};
  game.flags = {};
  game.time = 0;
  game.clock = makeClock(hour);
  game.map = makeMap();
  game.objects = new FakeObjects();
  game.entities = new EntityManager(game);
  game.locations = new LocationIndex(LOCS);
  game.pathfinder = {
    calls: 0,
    find(sx, sy, gx, gy) {
      this.calls++;
      return [{ x: gx, y: gy }];
    },
  };
  game.combat = fakeCombat(game);
  game.particles = { emitted: [], emit(type) { this.emitted.push(type); } };
  game.audio = { played: [], play(n) { this.played.push(n); } };
  game.bubbles = { said: [], icons: [], say(e, t) { this.said.push(t); }, icon(e, n) { this.icons.push(n); }, thought() {}, number() {} };
  game.lighting = { flashes: [], flash(o) { this.flashes.push(o); } };
  game.camera = { x: 0, y: 0, vw: 480, vh: 270 };
  game.ui = { chat: { opened: 0, open() { this.opened++; } }, toast() {} };
  game.actions = new ActionRegistry(game);
  game.plugins = new PluginRegistry(game);
  game.isBlockedTile = (tx, ty, a) => game.map.isSolidTile(tx, ty, a) || game.objects.isBlockingTile(tx, ty, a);
  return game;
}

// Lyra (a plain Actor driven by Behavior, or the real Companion) and the player.
function addLyra(game, { tx = 20, ty = 20, companion = false } = {}) {
  const player = new Actor(game, { id: 'player', name: 'Traveler', faction: 'player', maxHp: 60, atk: 6, speed: 90, x: T(tx) + 30, y: T(ty) });
  game.player = game.entities.add(player);
  let lyra;
  if (companion) lyra = new Companion(game, { x: T(tx), y: T(ty) });
  else {
    lyra = new Actor(game, { id: 'lyra', name: 'Lyra', faction: 'player', maxHp: 50, atk: 7, speed: 80, x: T(tx), y: T(ty) });
    lyra.behavior = new Behavior(game, lyra);
    lyra.controller = lyra.behavior;
  }
  lyra.mind = fakeMind(game);
  game.companion = game.entities.add(lyra);
  return { player, lyra, b: lyra.behavior, mind: lyra.mind };
}

function creature(game, id, species, faction, x, y, o = {}) {
  const c = new Actor(game, { id, name: species.charAt(0).toUpperCase() + species.slice(1), faction, maxHp: o.hp ?? 20, x, y });
  c.species = species;
  c.threat = o.threat ?? (faction === 'wildlife' ? 0 : 2);
  return game.entities.add(c);
}

function villager(game, id, name, x, y) {
  const v = new Actor(game, { id, name, faction: 'villager', x, y });
  v.profile = { id, name, shop: { buys: { herb: 3 } } };
  return game.entities.add(v);
}

// Step the world at 60 Hz. `until` returning true stops early (returns true).
function run(game, seconds, until = null) {
  const dt = 1 / 60;
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    game.clock.t += dt;
    game.time += dt;
    game.entities.update(dt);
    if (until && until()) return true;
  }
  return false;
}

function collect(game, type) {
  const out = [];
  game.bus.on(type, (p) => out.push(p));
  return out;
}

// ---------------------------------------------------------------- stances

test('stance target selection: attack, defend, passive, self_defense', () => {
  const game = makeGame();
  const { lyra, player, mind } = addLyra(game);
  const wolf = creature(game, 'wolf1', 'wolf', 'monster', lyra.x + 60, lyra.y);
  const bandit = creature(game, 'bandit1', 'bandit', 'bandit', lyra.x - 70, lyra.y);
  const deer = creature(game, 'deer1', 'deer', 'wildlife', lyra.x, lyra.y + 100);
  villager(game, 'bram', 'Bram Ironhand', lyra.x + 20, lyra.y - 20);
  creature(game, 'cat1', 'cat', 'wildlife', lyra.x - 20, lyra.y + 10);
  creature(game, 'rabbit1', 'rabbit', 'wildlife', lyra.x + 30, lyra.y + 30);
  mind.relationships.set('rabbit1', { name: 'Clover', tags: ['pet'] });
  creature(game, 'bandit2', 'bandit', 'bandit', lyra.x - 40, lyra.y - 40);
  mind.relationships.set('bandit2', { name: 'Vex', tags: ['friend'] });

  const targets = (stance, memory = new Map()) => {
    const chosen = [];
    for (let i = 0; i < 12; i++) {
      const t = selectTarget({ game, self: lyra, stance, player, now: 100, memory, current: null, focus: null, center: lyra, radius: 150 });
      if (!t) break;
      chosen.push(t);
      t.dead = true;
    }
    for (const t of chosen) t.dead = false;
    return new Set(chosen.map((t) => t.id));
  };

  assert.deepEqual(targets('attack'), new Set(['wolf1', 'bandit1', 'deer1']));
  // Defend: only threats near her or the player; the deer is not a threat.
  assert.deepEqual(targets('defend'), new Set(['wolf1', 'bandit1']));
  assert.equal(targets('passive').size, 0);
  // Self-defense: only whoever attacked her, the player included.
  const memory = new Map([[player, { vsPlayer: -99, vsSelf: 99, byPlayer: -99 }]]);
  assert.deepEqual(targets('self_defense', memory), new Set(['player']));
  assert.equal(targets('self_defense').size, 0);
  // Threat ranking: the creature attacking the player comes first.
  const m2 = new Map([[bandit, { vsPlayer: 99.5, vsSelf: -99, byPlayer: -99 }]]);
  assert.equal(selectTarget({ game, self: lyra, stance: 'attack', player, now: 100, memory: m2, center: lyra, radius: 150 }), bandit);
  assert.ok(wolf && deer);
});

test('focus refuses friends, the player and pets by name, allows tagged enemies', () => {
  const game = makeGame();
  const { b, lyra, player, mind } = addLyra(game);
  villager(game, 'bram', 'Bram Ironhand', lyra.x + 20, lyra.y);
  const tobias = villager(game, 'tobias', 'Tobias Reed', lyra.x - 30, lyra.y);
  const pet = creature(game, 'rabbit1', 'rabbit', 'wildlife', lyra.x + 30, lyra.y + 30);
  mind.relationships.set('rabbit1', { name: 'Clover', tags: ['pet'] });
  const wolf = creature(game, 'wolf1', 'wolf', 'monster', lyra.x + 70, lyra.y);

  let r = b.focus('bram');
  assert.equal(r.ok, false);
  assert.match(r.message, /Bram/);
  r = b.focus(player);
  assert.equal(r.ok, false);
  r = b.focus(pet);
  assert.equal(r.ok, false);
  assert.match(r.message, /Clover/);
  mind.relationships.set('tobias', { tags: ['enemy'] });
  r = b.focus(tobias);
  assert.equal(r.ok, true);
  r = b.focus('wolf');
  assert.equal(r.ok, true);
  assert.equal(b.currentTarget, wolf);
});

test('attack mode is a standing order: she engages each non-friend without being asked again', () => {
  const game = makeGame();
  const { b, lyra } = addLyra(game);
  b.setStance('attack');
  const w1 = creature(game, 'wolf1', 'wolf', 'monster', lyra.x + 90, lyra.y, { hp: 10 });
  const w2 = creature(game, 'wolf2', 'wolf', 'monster', lyra.x - 100, lyra.y + 10, { hp: 10 });
  const fought = new Set();
  run(game, 4, () => {
    const t = b.currentTarget;
    if (t) fought.add(t.id);
    // The first wolf falls once she has hit it; she moves on to the next by herself.
    if (t === w1 && game.combat.calls.some((c) => c[1] === w1)) w1.dead = true;
  });
  assert.deepEqual(fought, new Set(['wolf1', 'wolf2']));
  assert.ok(game.combat.calls.some((c) => c[1] === w2), 'she attacked the second wolf too');
});

// ---------------------------------------------------------------- self-preservation

test('self-preservation: under 30% HP she disengages even in attack mode', () => {
  const game = makeGame();
  const { b, lyra, player } = addLyra(game);
  player.x = lyra.x - 200;
  b.setStance('attack');
  const wolf = creature(game, 'wolf1', 'wolf', 'monster', lyra.x + 30, lyra.y);
  const events = collect(game, 'self_preservation');
  run(game, 0.5);
  assert.equal(b.currentTarget, wolf);
  lyra.hp = 12;
  b.healCd = 99;
  const before = Math.hypot(lyra.x - wolf.x, lyra.y - wolf.y);
  const shotsBefore = game.combat.calls.length;
  run(game, 1.5);
  assert.ok(b.disengaging, 'she is getting out');
  assert.equal(b.currentTarget, null);
  assert.equal(b.status(), 'getting out of the fight');
  assert.equal(events.length, 1);
  assert.ok(Math.hypot(lyra.x - wolf.x, lyra.y - wolf.y) > before + 20, 'she moved away from the wolf');
  assert.ok(!game.combat.calls.slice(shotsBefore).some((c) => c[0] === 'shoot'), 'no more shooting while getting out');
  assert.equal(b.stance, 'attack', 'the order stands; her life comes first');
});

test('self-preservation: she stays to cover someone she loves who is down, when the fight is winnable', () => {
  const game = makeGame();
  const { b, lyra, player, mind } = addLyra(game);
  mind.relationships.set('player', { trust: 80, affinity: 80 });
  player.x = lyra.x + 12;
  player.downed = true;
  const wolf = creature(game, 'wolf1', 'wolf', 'monster', lyra.x + 50, lyra.y, { hp: 5, threat: 1 });
  b.setStance('defend');
  lyra.hp = 12;
  b.healCd = 99;
  run(game, 1);
  assert.equal(b.disengaging, null);
  assert.equal(b.currentTarget, wolf);
});

test('she will not walk into a place over her risk limit: wait_outside, and she says so', () => {
  const game = makeGame({ hour: 23 });
  const { b, lyra } = addLyra(game);
  lyra.hp = 25;
  const camp = game.locations.get('bandit_camp');
  const r = b.setDirective({ type: 'goto', target: 'bandit_camp' });
  assert.equal(r.ok, false);
  assert.match(r.message, /Bandit Camp/);
  assert.equal(b.directive.type, 'wait_outside');
  assert.equal(b.directive.location, 'bandit_camp');
  run(game, 8);
  const inside = (x, y) => x / TILE >= camp.bounds.x && y / TILE >= camp.bounds.y && x / TILE < camp.bounds.x + camp.bounds.w && y / TILE < camp.bounds.y + camp.bounds.h;
  assert.ok(!inside(lyra.x, lyra.y), 'she stays outside');
  assert.match(b.status(), /waiting outside/);

  // By day, unhurt, with the player beside her, she goes.
  const day = makeGame({ hour: 10 });
  const d = addLyra(day);
  assert.equal(d.b.setDirective({ type: 'goto', target: 'bandit_camp' }).ok, true);
});

test('following the player into danger: she waits at the entrance, then resumes following', () => {
  const game = makeGame({ hour: 23 });
  const { b, lyra, player } = addLyra(game);
  lyra.hp = 25;
  b.setDirective({ type: 'follow', target: 'player', distance: 'normal' });
  player.x = T(50);
  player.y = T(7);
  run(game, 1);
  assert.equal(b.directive.type, 'wait_outside');
  assert.equal(b.directive.then.type, 'follow');
  // The player comes back out to her.
  player.x = lyra.x + 40;
  player.y = lyra.y;
  run(game, 3);
  assert.equal(b.directive.type, 'follow');
});

test('critical needs: exhausted, she stops and sits; starving, she eats what she has', () => {
  const game = makeGame();
  const { b, lyra, mind } = addLyra(game);
  b.setDirective({ type: 'stay' });
  mind.needs.energy = 0.05;
  run(game, 2.5);
  assert.equal(b.task?.kind, 'sit');
  assert.equal(b.task.tend, true);
  mind.needs.energy = 0.9;
  mind.needs.hunger = 0.05;
  lyra.inventory.add('bread', 1);
  run(game, 2.5);
  assert.equal(lyra.inventory.count('bread'), 0);
});

// ---------------------------------------------------------------- directives

test('wait resumes the previous directive', () => {
  const game = makeGame();
  const { b } = addLyra(game);
  const changes = collect(game, 'directive_changed');
  b.setDirective({ type: 'follow', target: 'player', distance: 'close' });
  const r = b.setDirective({ type: 'wait', seconds: 3 });
  assert.equal(r.ok, true);
  assert.equal(b.directive.type, 'wait');
  assert.equal(b.directive.then.type, 'follow');
  run(game, 3.5);
  assert.equal(b.directive.type, 'follow');
  assert.equal(b.directive.distance, 'close');
  assert.ok(changes.length >= 3);
  assert.equal(changes.at(-1).previous.type, 'wait');
});

test('stay holds her position; goto with then follow comes back', () => {
  const game = makeGame();
  const { b, lyra, player } = addLyra(game);
  b.setDirective({ type: 'stay' });
  const x0 = lyra.x;
  player.x += 200;
  run(game, 2);
  assert.ok(Math.abs(lyra.x - x0) < 2);
  assert.equal(b.status(), 'holding position');
  const r = b.setDirective({ type: 'goto', target: 'town_square', then: 'follow' });
  assert.equal(r.ok, true);
  run(game, 8, () => b.directive.type === 'follow');
  assert.equal(b.directive.type, 'follow');
});

test('independent: she walks to her plan\'s place and sits by the hearth', () => {
  const game = makeGame({ hour: 10 });
  const { b, lyra } = addLyra(game);
  game.objects.add({ id: 'inn_hearth', objType: 'hearth', tx: 32, ty: 19, x: T(32), y: 19 * TILE + 15, solid: true, blocksTile: (x, y) => x === 32 && y === 19 });
  const plan = [{ from: 9, to: 12, activity: 'rest by the fire', at: 'ember_kettle' }];
  const r = b.setDirective({ type: 'independent', plan });
  assert.equal(r.ok, true);
  const kettle = game.locations.get('ember_kettle');
  const ok = run(game, 20, () => b.task?.kind === 'sit' && b.task.phase === 'seated');
  assert.ok(ok, 'she sat down');
  const b2 = kettle.bounds;
  assert.ok(lyra.x / TILE >= b2.x - 1 && lyra.x / TILE <= b2.x + b2.w + 1 && lyra.y / TILE >= b2.y - 1 && lyra.y / TILE <= b2.y + b2.h + 1, 'at the Ember Kettle');
  assert.ok(b.task.fire, 'by the hearth');
});

test('independent: her own work (herbs for Mira) is delivered to Mira and reported as her own', () => {
  const game = makeGame({ hour: 9 });
  const { b } = addLyra(game);
  const mira = villager(game, 'mira', 'Mira Fennick', T(24), T(22));
  for (const [tx, ty] of [
    [6, 5],
    [8, 6],
    [10, 4],
    [12, 7],
  ])
    game.objects.add(workObject('herb', tx, ty, 'herb', { solid: false }));
  const done = collect(game, 'job_done');
  const given = collect(game, 'item_given');
  const started = collect(game, 'job_started');
  b.setDirective({ type: 'independent', plan: [{ from: 8, to: 12, activity: 'gather herbs for Mira', at: 'whisperwood' }] });
  run(game, 60, () => done.length > 0);
  assert.equal(done.length, 1);
  assert.equal(started[0].own, true);
  assert.equal(done[0].own, true);
  assert.equal(done[0].result.buyer, 'mira');
  assert.equal(done[0].result.earned, 12);
  assert.equal(given[0].to, mira);
  assert.equal(given[0].itemId, 'herb');
  assert.equal(given[0].qty, 4);
  assert.equal(b.directive.type, 'independent', 'still living her own day');
});

test('plan entries: classification and wrap-around', () => {
  assert.deepEqual(
    (({ mode, job, buyer }) => ({ mode, job, buyer }))(classifyActivity({ activity: 'gather herbs for Mira', at: 'whisperwood' })),
    { mode: 'job', job: 'gather_herbs', buyer: 'mira' },
  );
  assert.equal(classifyActivity({ activity: 'supper' }).mode, 'eat');
  assert.equal(classifyActivity({ activity: 'sleep' }).mode, 'sleep');
  assert.equal(classifyActivity({ activity: 'visit Bram' }).person, 'bram');
  assert.equal(classifyActivity({ activity: 'follow a lead about Maren' }).mode, 'lead');
  assert.equal(classifyActivity({ activity: 'study at the chapel' }).mode, 'study');
  const fish = classifyActivity({ activity: 'work', at: 'mirror_lake' });
  assert.equal(fish.mode, 'job');
  assert.equal(fish.job, 'fish');
  const plan = [
    { from: 8, to: 12, activity: 'work' },
    { from: 22, to: 6, activity: 'sleep' },
  ];
  assert.equal(activeEntry(plan, 23).activity, 'sleep');
  assert.equal(activeEntry(plan, 3).activity, 'sleep');
  assert.equal(activeEntry(plan, 9).activity, 'work');
  assert.equal(activeEntry(plan, 14), null);
});

test('flee: she runs to safety, away from the threat, then reports it', () => {
  const game = makeGame();
  const { b, lyra } = addLyra(game);
  creature(game, 'wolf1', 'wolf', 'monster', lyra.x - 40, lyra.y);
  const fled = collect(game, 'lyra_fled');
  const r = b.setDirective({ type: 'flee', from: 'wolf1' });
  assert.equal(r.ok, true);
  assert.match(b.status(), /running/);
  run(game, 20, () => fled.length > 0);
  assert.equal(fled.length, 1);
  assert.equal(fled[0].safe, true);
  assert.ok(lyra.x > T(24), 'she ran east, toward the inn and away from the wolf');
  assert.equal(b.directive.type, 'follow');
});

test('keep_away: she keeps at least that distance from the player', () => {
  const game = makeGame();
  const { b, lyra, player } = addLyra(game);
  player.x = lyra.x + 20;
  const r = b.setDirective({ type: 'keep_away', from: 'player', tiles: 4 });
  assert.equal(r.ok, true);
  run(game, 3);
  assert.ok(Math.hypot(lyra.x - player.x, lyra.y - player.y) >= 4 * TILE - 4);
  assert.match(b.status(), /keeping her distance/);
});

test('leave gone: she walks off the map along the King\'s Road and leaves the world', () => {
  const game = makeGame();
  const { lyra, b, player } = addLyra(game, { tx: 30, ty: 37, companion: true });
  player.x = lyra.x;
  const left = collect(game, 'lyra_left_world');
  const r = b.setDirective({ type: 'leave', mode: 'gone' });
  assert.equal(r.ok, true);
  assert.equal(b.status(), 'leaving Hearthvale');
  run(game, 20, () => {
    game.camera.x = lyra.x - 240;
    game.camera.y = lyra.y - 135;
    return left.length > 0;
  });
  assert.equal(left.length, 1);
  assert.ok(lyra.x < 2 * TILE || lyra.x > (W - 2) * TILE, 'at the edge of the map');
  assert.equal(lyra.removed, true);
  run(game, 0.1);
  assert.equal(game.entities.get('lyra'), null);
  // A saved game remembers she is gone.
  const saved = JSON.parse(JSON.stringify(lyra.serialize()));
  assert.equal(saved.leftWorld, true);
});

test('Binding Light roots a target for 3 s with a 20 s cooldown; innocents are refused', () => {
  const game = makeGame();
  const { b, player, lyra } = addLyra(game);
  player.x = lyra.x + 60;
  const r = b.bind('player');
  assert.equal(r.ok, true);
  assert.equal(player.rootTime, 3);
  assert.equal(b.bindCd, 20);
  assert.ok(game.particles.emitted.includes('magic'));
  assert.equal(game.lighting.flashes.length, 1);
  assert.ok(game.audio.played.includes('magic'));
  const again = b.bind('player');
  assert.equal(again.ok, false);
  assert.match(again.message, /isn't ready/);
  b.bindCd = 0;
  villager(game, 'bram', 'Bram Ironhand', lyra.x + 30, lyra.y);
  const no = b.bind('bram');
  assert.equal(no.ok, false);
  assert.match(no.message, /Bram/);
});

test('warn: a shouted warning, a speech event, a memory', () => {
  const game = makeGame();
  const { b, mind } = addLyra(game);
  const speech = collect(game, 'speech');
  const r = b.warn('player');
  assert.equal(r.ok, true);
  assert.equal(speech.length, 1);
  assert.equal(speech[0].kind, 'shout');
  assert.equal(speech[0].text, r.message);
  assert.equal(mind.remembered.length, 1);
});

test('the player hitting her on purpose twice switches self-defense on: bind, then she fights back', () => {
  const game = makeGame();
  const { b, lyra, player } = addLyra(game);
  player.x = lyra.x + 50;
  const stances = collect(game, 'stance_changed');
  game.bus.emit('damage', { source: player, target: lyra, amount: 3, kind: 'melee' });
  assert.equal(b.stance, 'defend');
  run(game, 0.5);
  game.bus.emit('damage', { source: player, target: lyra, amount: 3, kind: 'melee' });
  assert.equal(b.stance, 'self_defense');
  assert.equal(stances.at(-1).stance, 'self_defense');
  run(game, 0.5);
  assert.equal(b.currentTarget, player);
  assert.equal(player.rootTime > 0, true);
  assert.ok(b.isDefendingAgainst(player));
  // The heat of the moment is not saved as her standing stance.
  assert.equal(b.serialize().stance, 'defend');
});

test('she steps out of the player\'s sword arc', () => {
  const game = makeGame();
  const { b, lyra, player } = addLyra(game);
  b.setDirective({ type: 'stay' });
  player.x = lyra.x - 20;
  player.y = lyra.y;
  player.faceDir('right');
  player.setState('attack', 2);
  player.attackCd = 2;
  run(game, 1);
  const dx = lyra.x - player.x;
  const dy = lyra.y - player.y;
  const d = Math.hypot(dx, dy);
  assert.ok(d > 36 || dx / d < 0.4, 'out of the swing');
});

// ---------------------------------------------------------------- jobs

test('job state machine: find, walk, work, deliver to the player', () => {
  const game = makeGame();
  const { b, lyra, player } = addLyra(game);
  game.objects.add(workObject('tree', 25, 20, 'wood'));
  game.objects.add(workObject('tree', 27, 23, 'wood'));
  const ev = { started: collect(game, 'job_started'), progress: collect(game, 'job_progress'), done: collect(game, 'job_done'), given: collect(game, 'item_given') };
  const r = b.setDirective({ type: 'job', job: 'chop_wood', amount: 2, deliverTo: 'player' });
  assert.equal(r.ok, true);
  assert.equal(ev.started.length, 1);
  const statuses = new Set();
  run(game, 30, () => {
    statuses.add(b.status());
    return ev.done.length > 0;
  });
  assert.ok(statuses.has('chopping wood (0/2)'));
  assert.ok(statuses.has('chopping wood (1/2)'));
  assert.equal(ev.progress.length, 2);
  assert.equal(ev.done.length, 1);
  assert.equal(ev.given[0].from, lyra);
  assert.equal(ev.given[0].to, player);
  assert.equal(player.inventory.count('wood'), 2);
  assert.ok(game.particles.emitted.includes('wood_chip'));
  assert.ok(game.audio.played.includes('chop'));
  assert.equal(b.directive.type, 'follow', 'back to the order before the job');
});

test('job fails politely when nothing is reachable', () => {
  const game = makeGame();
  const { b } = addLyra(game);
  const r = b.setDirective({ type: 'job', job: 'mine_ore', amount: 3 });
  assert.equal(r.ok, false);
  assert.match(r.message, /quarry|ore|stone/i);
});

test('jobs pause for combat and resume', () => {
  const game = makeGame();
  const { b, lyra } = addLyra(game);
  game.objects.add(workObject('tree', 25, 20, 'wood', { seconds: 3 }));
  b.setDirective({ type: 'job', job: 'chop_wood', amount: 1, deliverTo: 'keep' });
  run(game, 1.5);
  const wolf = creature(game, 'wolf1', 'wolf', 'monster', lyra.x + 50, lyra.y);
  run(game, 0.5);
  assert.equal(b.currentTarget, wolf);
  assert.equal(b.directive.type, 'job');
  wolf.dead = true;
  const done = collect(game, 'job_done');
  run(game, 15, () => done.length > 0);
  assert.equal(done.length, 1);
});

// ---------------------------------------------------------------- saving

test('serialize round trip keeps stance and directive (including her own directives)', () => {
  const game = makeGame();
  const { b, lyra } = addLyra(game);
  const round = (setup) => {
    setup(b);
    const data = JSON.parse(JSON.stringify(b.serialize()));
    const b2 = new Behavior(game, lyra);
    b2.deserialize(data);
    return { b2, data };
  };
  b.setStance('attack');
  let { b2 } = round((x) => x.setDirective({ type: 'guard', x: 320, y: 300, radius: 120 }));
  assert.equal(b2.stance, 'attack');
  assert.deepEqual(b2.directive, b.directive);
  ({ b2 } = round((x) => x.setDirective({ type: 'keep_away', from: 'player', tiles: 5 })));
  assert.deepEqual(b2.directive, b.directive);
  ({ b2 } = round((x) => {
    x.setDirective({ type: 'follow', target: 'player', distance: 'far' });
    x.setDirective({ type: 'wait', seconds: 40 });
  }));
  assert.equal(b2.directive.type, 'wait');
  assert.equal(b2.directive.then.distance, 'far');
  ({ b2 } = round((x) => x.setDirective({ type: 'independent', plan: [{ from: 8, to: 12, activity: 'study', at: 'chapel' }] })));
  assert.equal(b2.directive.type, 'independent');
  assert.equal(b2.directive.plan[0].activity, 'study');
  ({ b2 } = round((x) => x.setDirective({ type: 'leave', mode: 'left' })));
  assert.deepEqual(b2.directive, { type: 'leave', mode: 'left' });
  game.objects.add(workObject('tree', 25, 20, 'wood'));
  ({ b2 } = round((x) => x.setDirective({ type: 'job', job: 'chop_wood', amount: 4, deliverTo: 'chest' })));
  assert.equal(b2.directive.type, 'job');
  assert.equal(b2.jobs.amount, 4);
  assert.equal(b2.jobs.deliverTo, 'chest');
});

test('companion: interact revives her when downed, otherwise opens the chat', () => {
  const game = makeGame();
  const { lyra, player } = addLyra(game, { companion: true });
  lyra.interact(player);
  assert.equal(game.ui.chat.opened, 1);
  lyra.hp = 0;
  lyra.downed = true;
  run(game, 0.1);
  lyra.interact(player);
  const rv = game.combat.calls.find((c) => c[0] === 'revive');
  assert.ok(rv);
  assert.equal(rv[1], lyra);
  assert.equal(rv[2], player);
  assert.equal(rv[3], 0.4);
  assert.equal(lyra.downed, false);
  // A stray removal never takes her out of the world.
  lyra.removed = true;
  assert.equal(lyra.removed, false);
});

// ---------------------------------------------------------------- plugins and intents

const INTENTS = [...coreCommandsPlugin.intents, ...worldPlugin.intents, ...jobsPlugin.intents];

function matchIntent(text) {
  for (const it of INTENTS) {
    for (const re of it.patterns) {
      re.lastIndex = 0;
      const m = re.exec(text);
      if (m) return { it, m };
    }
  }
  return null;
}

test('command intents match their phrasings and return actions without running them', () => {
  const game = makeGame();
  addLyra(game);
  for (const p of [coreCommandsPlugin, worldPlugin, jobsPlugin]) game.plugins.register(p);
  const ctx = game.plugins.ctx;
  const ran = collect(game, 'companion_action');
  const cases = [
    ['follow me', 'core.follow', 'follow'],
    ['come here', 'core.come_here', 'come_here'],
    ['stay', 'core.stay', 'stay'],
    ['wait here for a minute', 'core.wait', 'wait', (a) => a.amount === 60],
    ['hold this spot', 'core.stay', 'stay'],
    ['go to the inn', 'core.goto', 'goto', (a) => /inn/.test(a.target)],
    ['attack mode', 'core.stance_attack', 'set_combat_mode', (a) => a.value === 'attack'],
    ['go aggressive', 'core.stance_attack', 'set_combat_mode', (a) => a.value === 'attack'],
    ["kill everything that's not a friend", 'core.stance_attack', 'set_combat_mode', (a) => a.value === 'attack'],
    ['defend me', 'core.stance_defend', 'set_combat_mode', (a) => a.value === 'defend'],
    ['stop fighting', 'core.stance_passive', 'set_combat_mode', (a) => a.value === 'passive'],
    ['be passive', 'core.stance_passive', 'set_combat_mode', (a) => a.value === 'passive'],
    ['attack that wolf', 'core.attack', 'attack', (a) => /wolf/.test(a.target)],
    ['retreat!', 'core.retreat', 'retreat'],
    ['guard the farm', 'core.guard', 'guard', (a) => /farm/.test(a.target)],
    ['patrol the village', 'core.patrol', 'patrol', (a) => /village/.test(a.target)],
    ['explore the forest', 'core.explore', 'explore', (a) => /forest/.test(a.target)],
    ['do whatever you want', 'core.free', 'free_will'],
    ['open the door', 'world.open_door', 'open_door'],
    ['pick that up', 'world.pick_up', 'pick_up'],
    ['give me 3 wood', 'world.give_me', 'give_item', (a) => a.value === 'wood' && a.amount === 3],
    ['eat something', 'world.eat', 'use_item', (a) => a.value === null],
    ['chop 5 wood', 'jobs.chop', 'start_job', (a) => a.value === 'chop_wood' && a.amount === 5],
    ['go fishing', 'jobs.fish', 'start_job', (a) => a.value === 'fish'],
    ['gather herbs and bring them to me', 'jobs.herbs', 'start_job', (a) => a.value === 'gather_herbs' && a.target === 'player'],
    ['mine some ore', 'jobs.mine', 'start_job', (a) => a.value === 'mine_ore'],
    ['cook the fish', 'jobs.cook', 'start_job', (a) => a.value === 'cook fish'],
    ['stop working', 'jobs.stop', 'stop_job'],
    ['run to the inn', 'core.flee', 'flee', (a) => a.value === 'ember_kettle'],
    ['wait outside the inn', 'core.wait_outside', 'wait_outside', (a) => a.target === 'inn'],
    ['bind that wolf', 'core.bind', 'bind', (a) => /wolf/.test(a.target)],
    ['stay away from bram', 'core.keep_distance', 'keep_distance', (a) => a.target === 'bram'],
  ];
  for (const [text, id, action, check] of cases) {
    const hit = matchIntent(text);
    assert.ok(hit, `no intent for "${text}"`);
    assert.equal(hit.it.id, id, `"${text}" matched ${hit.it.id}`);
    assert.equal(hit.it.command, true);
    const acts = hit.it.actions(hit.m, ctx);
    assert.ok(Array.isArray(acts) && acts.length >= 1, `"${text}" gives actions`);
    assert.equal(acts[0].name, action, `"${text}" -> ${acts[0].name}`);
    assert.ok(acts[0].args && 'target' in acts[0].args && 'value' in acts[0].args && 'amount' in acts[0].args);
    if (check) assert.ok(check(acts[0].args), `"${text}" args ${JSON.stringify(acts[0].args)}`);
  }
  assert.equal(ran.length, 0, 'intents never run actions themselves');
  // Small talk is left alone.
  for (const text of ['how are you today?', 'what do you think of bram?', 'i love the rain', 'tell me about maren']) assert.equal(matchIntent(text), null, text);
});

test('an intent answers with her refusal, never an acknowledgement, when she refused', () => {
  const game = makeGame();
  addLyra(game);
  for (const p of [coreCommandsPlugin, worldPlugin, jobsPlugin]) game.plugins.register(p);
  const ctx = game.plugins.ctx;
  const refusal = 'Walk into a camp of crossbows first? No. Find someone else.';
  for (const text of ['attack mode', 'follow me', 'chop 5 wood', 'give me 3 wood', 'go to the inn', 'open the door']) {
    const { it, m } = matchIntent(text);
    assert.equal(it.answer(m, ctx, [{ ok: false, refused: true, message: refusal }]), refusal, text);
    const blank = it.answer(m, ctx, [{ ok: false, refused: true, message: '', verdict: { decision: 'refuse', reasons: ["I don't trust you with that"] } }]);
    assert.match(blank, /trust/, text);
  }
  assert.ok(firstMessage([{ ok: false, refused: true, message: '' }]).length > 0);
  // Accepted: her acknowledgement.
  assert.equal(firstMessage([{ ok: true, message: 'Right behind you.' }]), 'Right behind you.');
});

test('actions through the registry: player requests pass the consent gate; her own choices do not', () => {
  const game = makeGame();
  const { b } = addLyra(game);
  for (const p of [coreCommandsPlugin, worldPlugin, jobsPlugin]) game.plugins.register(p);
  game.actions.setConsentGate((name) => (name === 'set_combat_mode' ? { decision: 'refuse', message: 'Not with you. Not today.' } : null));
  const r = game.actions.run('set_combat_mode', { value: 'attack' }, 'player');
  assert.equal(r.refused, true);
  assert.equal(b.stance, 'defend');
  assert.equal(game.actions.run('set_combat_mode', { value: 'attack' }, 'self').ok, true);
  assert.equal(b.stance, 'attack');
  for (const name of ['flee', 'keep_distance', 'bind', 'warn', 'wait_outside']) assert.ok(game.actions.has(name), name);
  const k = game.actions.run('keep_distance', { target: null, amount: 6 }, 'self');
  assert.equal(k.ok, true);
  assert.equal(b.directive.type, 'keep_away');
  assert.equal(b.directive.tiles, 6);
});
