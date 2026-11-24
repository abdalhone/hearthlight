import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/events.js';
import { RNG } from '../src/core/rng.js';
import { TILE, WORLD_W, WORLD_H } from '../src/core/constants.js';
import { Inventory } from '../src/entities/items.js';
import { generateWorld } from '../src/world/worldgen.js';
import { Pathfinder } from '../src/world/pathfind.js';
import { T, tileDef } from '../src/world/tiles.js';
import { TileMap } from '../src/world/map.js';
import { ObjectManager, makeObject, CROP_STAGE_SECONDS } from '../src/world/objects.js';

const SEED = 20261123;

const REQUIRED_LOCATIONS = [
  'hearthvale',
  'town_square',
  'player_home',
  'ember_kettle',
  'smithy',
  'general_store',
  'chapel',
  'herbalist',
  'guardhouse',
  'farmhouse',
  'reed_farm',
  'whisperwood',
  'stonecut_quarry',
  'bandit_camp',
  'mirror_lake',
  'sunken_ruins',
  'south_meadow',
  'kings_road',
];

const REQUIRED_OBJECTS = ['home_bed', 'lyra_bed', 'home_chest', 'bandit_chest', 'inn_hearth', 'camp_campfire', 'lake_campfire', 'ruins_gate', 'maren_journal', 'fishing_spot', 'notice_board'];

const NPC_IDS = ['bram', 'elda', 'pip', 'rowan', 'mira', 'tobias', 'aveline', 'garrick'];

// A minimal stand-in for the game object: enough for the world module.
function makeGame() {
  const game = {
    bus: new EventBus(),
    rng: new RNG(7),
    flags: {},
    time: 0,
    clock: { t: 300, hour: 8, daylight: 1, weather: { type: 'clear' } },
    entities: { list: [], nearest: () => null },
    atlas: null,
    ui: null,
  };
  return game;
}

function buildWorld(seed = SEED) {
  const game = makeGame();
  const world = generateWorld(game, seed);
  game.map = world.map;
  game.objects = world.objects;
  game.locations = world.locations;
  game.pathfinder = new Pathfinder(game);
  game.isBlockedTile = (tx, ty, a) => game.map.isSolidTile(tx, ty, a) || game.objects.isBlockingTile(tx, ty, a);
  return { game, world };
}

const tileOf = (p) => ({ tx: Math.floor(p.x / TILE), ty: Math.floor(p.y / TILE) });

// Flood fill over walkable tiles: closed unlocked doors pass, locked doors only with a key.
function reachable(game, from, { hasKey = false } = {}) {
  const { map, objects } = game;
  const seen = new Uint8Array(map.w * map.h);
  const q = [];
  const s = tileOf(from);
  seen[s.ty * map.w + s.tx] = 1;
  q.push(s.ty * map.w + s.tx);
  const actor = { inventory: new Inventory(hasKey ? { ruins_key: 1 } : null) };
  while (q.length) {
    const i = q.pop();
    const x = i % map.w;
    const y = (i / map.w) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!map.inBounds(nx, ny)) continue;
      const ni = ny * map.w + nx;
      if (seen[ni]) continue;
      if (map.isSolidTile(nx, ny)) continue;
      const door = objects.doorAt(nx, ny);
      if (door) {
        if (door.locked && !hasKey) continue;
      } else if (objects.isBlockingTile(nx, ny, actor)) continue;
      seen[ni] = 1;
      q.push(ni);
    }
  }
  return (p) => {
    const t = tileOf(p);
    return !!seen[t.ty * map.w + t.tx];
  };
}

function walkable(game, p) {
  const t = tileOf(p);
  return !game.isBlockedTile(t.tx, t.ty, null);
}

const { game: G, world: WORLD } = buildWorld();

test('the world generates in Node without a document and without problems', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(WORLD.map.w, WORLD_W);
  assert.equal(WORLD.map.h, WORLD_H);
  assert.deepEqual(WORLD.problems, []);
  assert.ok(WORLD.objects.all().length > 800, 'a rich world has many objects');
});

test('every required location exists with a walkable center inside its bounds', () => {
  for (const id of REQUIRED_LOCATIONS) {
    const loc = WORLD.locations.get(id);
    assert.ok(loc, `location ${id}`);
    assert.ok(loc.name && loc.description && loc.description.length > 20, `${id} has a name and description`);
    const b = loc.bounds;
    const t = tileOf(loc.center);
    assert.ok(t.tx >= b.x && t.ty >= b.y && t.tx < b.x + b.w && t.ty < b.y + b.h, `${id} center inside bounds`);
    assert.ok(walkable(G, loc.center), `${id} center walkable`);
  }
  for (const id of ['player_home', 'ember_kettle', 'smithy', 'general_store', 'chapel', 'herbalist', 'guardhouse', 'farmhouse']) {
    assert.equal(WORLD.locations.get(id).indoor, true, `${id} is indoor`);
    assert.ok(WORLD.map.buildings.some((b) => b.id === id), `${id} is a building`);
  }
  assert.equal(WORLD.locations.find('the inn').id, 'ember_kettle');
  assert.equal(WORLD.locations.find('tavern').id, 'ember_kettle');
  assert.equal(WORLD.locations.find('shop').id, 'general_store');
  assert.equal(WORLD.locations.find('ruins').id, 'sunken_ruins');
  assert.equal(WORLD.locations.find('home').id, 'player_home');
});

test('innermost location lookups make sense', () => {
  const at = (tx, ty) => WORLD.locations.at(tx * TILE + 8, ty * TILE + 8)?.id;
  const sq = WORLD.locations.get('town_square').center;
  assert.equal(WORLD.locations.at(sq.x, sq.y).id, 'town_square');
  const home = WORLD.locations.get('player_home').center;
  assert.equal(WORLD.locations.at(home.x, home.y).id, 'player_home');
  assert.equal(WORLD.locations.at(WORLD.spawns.player.x, WORLD.spawns.player.y).id, 'kings_road');
  // Just outside the ruins gate is not yet the ruins.
  const gate = WORLD.objects.get('ruins_gate');
  assert.notEqual(at(gate.tx, gate.ty - 1), 'sunken_ruins');
  assert.equal(at(gate.tx, gate.ty + 2), 'sunken_ruins');
});

test('every required object exists, with the right contents and lock', () => {
  for (const id of REQUIRED_OBJECTS) assert.ok(WORLD.objects.get(id), `object ${id}`);
  const chest = WORLD.objects.get('bandit_chest');
  assert.equal(chest.inventory.count('ruins_key'), 1);
  assert.equal(chest.inventory.count('coin'), 25);
  assert.equal(chest.inventory.count('potion'), 1);
  const gate = WORLD.objects.get('ruins_gate');
  assert.equal(gate.objType, 'door');
  assert.equal(gate.locked, true);
  assert.equal(gate.state.keyId, 'ruins_key');
  assert.equal(WORLD.objects.get('home_bed').objType, 'bed');
  assert.equal(WORLD.objects.get('lyra_bed').owner, 'lyra');
  assert.equal(WORLD.objects.get('inn_hearth').objType, 'hearth');
  assert.equal(WORLD.objects.get('camp_campfire').objType, 'campfire');
  assert.equal(WORLD.objects.get('maren_journal').objType, 'journal');
  assert.equal(WORLD.objects.get('fishing_spot').objType, 'fishing_spot');
  // The furniture of the cottage sits inside the cottage.
  const home = WORLD.map.buildings.find((b) => b.id === 'player_home');
  for (const id of ['home_bed', 'lyra_bed', 'home_chest']) assert.equal(WORLD.map.buildingAt(WORLD.objects.get(id).tx, WORLD.objects.get(id).ty), home);
  assert.ok(WORLD.objects.inRadius(WORLD.locations.get('player_home').center.x, WORLD.locations.get('player_home').center.y, 64, (o) => o.objType === 'table').length >= 1);
  // Every DESIGN object type appears somewhere.
  const types = new Set(WORLD.objects.all().map((o) => o.objType));
  for (const t of ['door', 'tree', 'rock', 'ore', 'crystal', 'herb', 'moonpetal', 'berry_bush', 'crop', 'chest', 'bed', 'campfire', 'hearth', 'lamp', 'sign', 'well', 'anvil', 'forge', 'table', 'chair', 'barrel', 'crate', 'fence', 'altar', 'shelf', 'tent', 'ruin_pillar', 'statue', 'journal', 'fishing_spot', 'window'])
    assert.ok(types.has(t), `object type ${t}`);
});

test('every building has a door on its front face and a furnished interior', () => {
  for (const b of WORLD.map.buildings) {
    assert.equal(b.doorTiles.length, 1);
    const d = WORLD.objects.doorAt(b.doorTiles[0].tx, b.doorTiles[0].ty);
    assert.ok(d, `${b.id} door object`);
    assert.equal(d.ty, b.y + b.h - 1);
    const inside = WORLD.objects.all().filter((o) => o.objType !== 'door' && o.objType !== 'window' && o.objType !== 'sign' && WORLD.map.buildingAt(o.tx, o.ty) === b);
    assert.ok(inside.length >= 4, `${b.id} has furniture (${inside.length})`);
    assert.ok(WORLD.map.isIndoors((b.x + 2) * TILE, (b.y + 2) * TILE));
  }
});

test('spawns stand on walkable tiles', () => {
  const S = WORLD.spawns;
  assert.ok(walkable(G, S.player), 'player');
  assert.ok(walkable(G, S.companion), 'companion');
  assert.ok(Math.abs(S.companion.x - S.player.x) <= TILE + 1 && Math.abs(S.companion.y - S.player.y) <= TILE + 1, 'Lyra one tile beside');
  // Outside the cottage door, on the road.
  const door = WORLD.objects.get('door_player_home');
  assert.ok(Math.hypot(S.player.x - door.x, S.player.y - door.y) < TILE * 2, 'player starts at the cottage door');
  assert.equal(WORLD.map.tileAt(tileOf(S.player).tx, tileOf(S.player).ty), T.DIRT);
  assert.deepEqual(S.npcs.map((n) => n.id).sort(), [...NPC_IDS].sort());
  for (const n of S.npcs) assert.ok(walkable(G, n), `npc ${n.id}`);
  for (const c of S.creatures) assert.ok(walkable(G, c), `creature ${c.species} at ${tileOf(c).tx},${tileOf(c).ty}`);
  const count = (s) => S.creatures.filter((c) => c.species === s).length;
  assert.equal(count('wolf'), 2);
  assert.equal(count('bandit'), 4);
  assert.equal(count('bandit_archer'), 1);
  assert.equal(count('bandit_chief'), 1);
  assert.equal(count('skeleton'), 4);
  assert.equal(count('cat'), 1);
  assert.ok(count('chicken') >= 2 && count('rabbit') >= 2 && count('deer') >= 2 && count('slime') >= 2);
  const zones = new Map(S.spawnZones.map((z) => [z.id, z]));
  for (const z of S.spawnZones) {
    assert.ok(WORLD.locations.get(z.locationId), `zone ${z.id} location`);
    assert.ok(z.max > 0 && z.species.length > 0);
    let open = 0;
    for (let y = z.rect.y; y < z.rect.y + z.rect.h; y++) for (let x = z.rect.x; x < z.rect.x + z.rect.w; x++) if (!G.isBlockedTile(x, y, null)) open++;
    assert.ok(open > 10, `zone ${z.id} has room`);
  }
  assert.equal(zones.get('whisperwood_wolves_night').night, true);
  assert.equal(zones.get('ruins_bats').night, true);
  for (const sp of ['wolf', 'boar', 'deer', 'rabbit', 'slime', 'bat', 'skeleton']) assert.ok(S.spawnZones.some((z) => z.species.includes(sp)), `zone for ${sp}`);
});

test('every place and villager is reachable from the start; the ruins only with the key', () => {
  const start = WORLD.spawns.player;
  const noKey = reachable(G, start);
  const key = reachable(G, start, { hasKey: true });
  for (const id of REQUIRED_LOCATIONS) {
    const c = WORLD.locations.get(id).center;
    if (id === 'sunken_ruins') {
      assert.equal(noKey(c), false, 'ruins interior sealed without the key');
      assert.equal(key(c), true, 'ruins interior open with the key');
    } else assert.ok(noKey(c), `${id} reachable`);
  }
  for (const n of WORLD.spawns.npcs) assert.ok(noKey(n), `${n.id} reachable`);
  const j = WORLD.objects.get('maren_journal');
  assert.ok(key({ x: j.x, y: j.y - 4 }), 'journal reachable with the key');
  assert.equal(noKey({ x: j.x, y: j.y - 4 }), false);
  // Skeletons live inside the sealed ruins.
  for (const c of WORLD.spawns.creatures.filter((c) => c.species === 'skeleton')) assert.equal(noKey(c), false);
  for (const c of WORLD.spawns.creatures.filter((c) => c.species.startsWith('bandit'))) assert.ok(noKey(c), 'bandits reachable');
});

test('the pathfinder finds door-aware paths and refuses the locked ruins', () => {
  const pf = G.pathfinder;
  const s = WORLD.spawns.player;
  const noKey = { id: 'tester', inventory: new Inventory() };
  const withKey = { id: 'keyholder', inventory: new Inventory({ ruins_key: 1 }) };
  for (const id of REQUIRED_LOCATIONS) {
    const c = WORLD.locations.get(id).center;
    const p = pf.find(s.x, s.y, c.x, c.y, { maxNodes: 40000, actor: noKey });
    if (id === 'sunken_ruins') assert.equal(p, null);
    else {
      assert.ok(p && p.length, `path to ${id}`);
      assert.deepEqual(p[p.length - 1], { x: c.x, y: c.y }, `ends at ${id}`);
    }
  }
  const ruins = WORLD.locations.get('sunken_ruins').center;
  const p = pf.find(s.x, s.y, ruins.x, ruins.y, { maxNodes: 40000, actor: withKey });
  assert.ok(p, 'path into the ruins with the key');
  const gate = WORLD.objects.get('ruins_gate');
  assert.ok(p.some((w) => Math.floor(w.x / TILE) === gate.tx && Math.floor(w.y / TILE) === gate.ty), 'path passes the gate as a waypoint');
  // Into the cottage: the door tile is a waypoint.
  const home = WORLD.locations.get('player_home').center;
  const hp = pf.find(s.x, s.y, home.x, home.y, { actor: noKey });
  const door = WORLD.objects.get('door_player_home');
  assert.ok(hp.some((w) => Math.floor(w.x / TILE) === door.tx && Math.floor(w.y / TILE) === door.ty));
  // allowDoors:false keeps you out of closed houses.
  assert.equal(pf.find(s.x, s.y, home.x, home.y, { allowDoors: false, actor: noKey }), null);
  // A goal inside a solid object (a tree) ends next to it.
  const tree = WORLD.objects.nearest('tree', s.x, s.y);
  const tp = pf.find(s.x, s.y, tree.x, tree.y - 4, { maxNodes: 20000, actor: noKey });
  assert.ok(tp);
  const last = tp[tp.length - 1];
  assert.ok(Math.hypot(last.x - tree.x, last.y - (tree.y - 8)) <= TILE * 2.3);
  assert.equal(G.isBlockedTile(Math.floor(last.x / TILE), Math.floor(last.y / TILE), null), false);
});

test('smoothed paths never cut corners through solid tiles', () => {
  const pf = G.pathfinder;
  const pts = ['town_square', 'smithy', 'whisperwood', 'stonecut_quarry', 'mirror_lake', 'bandit_camp', 'reed_farm', 'south_meadow'].map((id) => WORLD.locations.get(id).center);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 3) % pts.length];
    const path = pf.find(a.x, a.y, b.x, b.y, { maxNodes: 40000 });
    assert.ok(path, 'path exists');
    let prev = a;
    for (const w of path) {
      const steps = Math.ceil(Math.hypot(w.x - prev.x, w.y - prev.y) / 2);
      for (let k = 0; k <= steps; k++) {
        const x = prev.x + ((w.x - prev.x) * k) / Math.max(1, steps);
        const y = prev.y + ((w.y - prev.y) * k) / Math.max(1, steps);
        const tx = Math.floor(x / TILE);
        const ty = Math.floor(y / TILE);
        const door = G.objects.doorAt(tx, ty);
        assert.ok(door || !G.isBlockedTile(tx, ty, null), `segment crosses a solid tile at ${tx},${ty}`);
      }
      prev = w;
    }
  }
});

test('cross-map pathfinding is fast', () => {
  const pf = G.pathfinder;
  const pairs = [
    ['stonecut_quarry', 'bandit_camp'],
    ['reed_farm', 'mirror_lake'],
    ['whisperwood', 'south_meadow'],
    ['bandit_camp', 'reed_farm'],
  ].map(([a, b]) => [WORLD.locations.get(a).center, WORLD.locations.get(b).center]);
  for (const [a, b] of pairs) pf.find(a.x, a.y, b.x, b.y, { maxNodes: 40000 }); // warm up
  const times = [];
  for (let r = 0; r < 5; r++) {
    for (const [a, b] of pairs) {
      pf.cache.clear();
      const t0 = performance.now();
      const p = pf.find(a.x, a.y, b.x, b.y, { maxNodes: 40000 });
      times.push(performance.now() - t0);
      assert.ok(p);
    }
  }
  times.sort((x, y) => x - y);
  const median = times[Math.floor(times.length / 2)];
  assert.ok(median < 4, `median cross-map path ${median.toFixed(2)} ms`);
  // Cached repeats are near free.
  const [a, b] = pairs[0];
  pf.find(a.x, a.y, b.x, b.y, { maxNodes: 40000 });
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) pf.find(a.x, a.y, b.x, b.y, { maxNodes: 40000 });
  assert.ok((performance.now() - t0) / 100 < 0.5);
  // The default node budget is respected.
  pf.cache.clear();
  const far = pf.find(pairs[0][0].x, pairs[0][0].y, pairs[0][1].x, pairs[0][1].y, { maxNodes: 50 });
  assert.equal(far, null);
});

test('generation is deterministic for a seed; the seed only changes organic detail', () => {
  const { world: a } = buildWorld(SEED);
  const { world: b } = buildWorld(SEED);
  assert.deepEqual(Buffer.from(a.map.ground.buffer), Buffer.from(b.map.ground.buffer));
  assert.deepEqual(Buffer.from(a.map.deco.buffer), Buffer.from(b.map.deco.buffer));
  const sig = (w) => w.objects.all().map((o) => `${o.id}:${o.x},${o.y}:${o.variant ?? ''}`);
  assert.deepEqual(sig(a), sig(b));
  assert.deepEqual(a.spawns, b.spawns);
  const { world: c } = buildWorld(SEED + 99);
  for (const id of REQUIRED_OBJECTS) assert.ok(c.objects.get(id));
  for (const id of REQUIRED_LOCATIONS) assert.ok(c.locations.get(id));
  assert.deepEqual(c.problems, []);
  const trees = (w) => w.objects.all().filter((o) => o.objType === 'tree').map((o) => o.id).join('|');
  assert.notEqual(trees(a), trees(c), 'tree scatter differs between seeds');
  assert.deepEqual(a.map.buildings.map((x) => [x.id, x.x, x.y]), c.map.buildings.map((x) => [x.id, x.x, x.y]), 'buildings are hand placed');
});

test('doors open, close, refuse when locked, and unlock with the key', () => {
  const { game } = buildWorld();
  const events = [];
  game.bus.on('door', (p) => events.push(p.open));
  const door = game.objects.get('door_player_home');
  const actor = { id: 'p', inventory: new Inventory() };
  assert.equal(door.isOpen, false);
  assert.equal(game.objects.isBlockingTile(door.tx, door.ty, actor), true);
  assert.equal(door.open(actor), true);
  assert.equal(game.objects.isBlockingTile(door.tx, door.ty, actor), false);
  assert.equal(door.interactLabel(actor), 'Close door');
  // Someone standing in the doorway keeps it open.
  game.entities.list.push({ type: 'actor', x: door.tx * TILE + 8, y: door.ty * TILE + 8, dead: false, removed: false });
  assert.equal(door.close(actor), false);
  game.entities.list.length = 0;
  assert.equal(door.close(actor), true);
  assert.deepEqual(events, [true, false]);
  const gate = game.objects.get('ruins_gate');
  assert.equal(gate.interactLabel(actor), 'Locked');
  assert.equal(gate.open(actor), false);
  assert.equal(gate.isOpen, false);
  actor.inventory.add('ruins_key', 1);
  assert.match(gate.interactLabel(actor), /Unlock/);
  assert.equal(gate.open(actor), true);
  assert.equal(gate.locked, false);
  assert.equal(gate.isOpen, true);
  // The gate stays open; saving and loading keeps it so.
  const saved = game.objects.serialize();
  const { game: g2 } = buildWorld();
  g2.objects.deserialize(saved);
  assert.equal(g2.objects.get('ruins_gate').isOpen, true);
  assert.equal(g2.objects.get('ruins_gate').locked, false);
});

test('trees: the work API yields wood, leaves a stump, and regrows in game time', () => {
  const { game } = buildWorld();
  const harvests = [];
  game.bus.on('harvest', (p) => harvests.push(p));
  const tree = game.objects.nearest('tree', WORLD.spawns.player.x, WORLD.spawns.player.y);
  const actor = { id: 'lyra', inventory: new Inventory() };
  assert.equal(tree.canWork(actor), true);
  assert.equal(tree.workSeconds, 3);
  let r;
  let steps = 0;
  do {
    r = tree.work(actor, 1 / 60);
    steps++;
  } while (!r.done && steps < 1000);
  assert.equal(r.done, true);
  assert.ok(steps >= 179 && steps <= 182, `about 3 seconds of work (${steps})`);
  const wood = r.items.find((i) => i.id === 'wood');
  assert.ok(wood && wood.qty >= 2 && wood.qty <= 3);
  assert.equal(harvests.length, 1);
  assert.equal(harvests[0].object, tree);
  assert.equal(actor.inventory.count('wood'), 0, 'work() leaves delivery to the caller');
  assert.equal(tree.isStump, true);
  assert.equal(tree.canWork(actor), false);
  assert.equal(tree.work(actor, 1).done, true);
  assert.equal(game.objects.isBlockingTile(tree.tx, tree.ty, actor), true, 'the stump keeps its trunk collision');
  game.clock.t += 900;
  tree.update(1 / 60);
  assert.equal(tree.isStump, false, 'regrown after a day');
  // Rocks become walkable rubble.
  const rock = game.objects.nearest('rock', 300, 300);
  for (let i = 0; i < 400 && !rock.work(actor, 0.05).done; i++);
  assert.equal(rock.depleted, true);
  assert.equal(game.objects.isBlockingTile(rock.tx, rock.ty, actor), false);
  const ore = game.objects.nearest('ore', 300, 300);
  let items = null;
  for (let i = 0; i < 400 && !items; i++) {
    const res = ore.work(actor, 0.05);
    if (res.done) items = res.items;
  }
  assert.ok(items.some((i) => i.id === 'iron_ore'));
});

test('the player harvests through interact and keeps what they gather', () => {
  const { game } = buildWorld();
  const player = { id: 'player', x: 0, y: 0, state: 'idle', lockTime: 0, inventory: new Inventory(), isAlive: () => true, setState(s) { this.state = s; }, faceToward() {} };
  game.player = player;
  game.input = { moveVector: () => ({ x: 0, y: 0 }) };
  const gained = [];
  game.bus.on('item_gained', (p) => gained.push(p));
  const herb = game.objects.nearest('herb', 800, 700);
  player.x = herb.x;
  player.y = herb.y + 6;
  assert.equal(herb.canInteract(player), true);
  herb.interact(player);
  for (let i = 0; i < 200; i++) game.objects.update(1 / 60);
  assert.ok(player.inventory.count('herb') >= 1);
  assert.equal(gained[0].from, 'pickup');
  assert.equal(herb.depleted, true);
  // Walking away cancels a session.
  const tree = game.objects.nearest('tree', player.x, player.y);
  player.x = tree.x;
  player.y = tree.y + 8;
  tree.interact(player);
  game.objects.update(1 / 60);
  game.input = { moveVector: () => ({ x: 1, y: 0 }) };
  game.objects.update(1 / 60);
  assert.equal(tree._worker, null);
  assert.equal(tree.isStump, false);
});

test('moonpetals open only at night; crops grow through their stages', () => {
  const { game } = buildWorld();
  const petal = game.objects.nearest('moonpetal', 52 * TILE, 15 * TILE);
  const actor = { id: 'lyra', inventory: new Inventory() };
  game.clock.hour = 13;
  assert.equal(petal.canWork(actor), false);
  assert.match(petal.interactLabel(actor), /night/);
  assert.equal(petal.getLight(0), null);
  game.clock.hour = 22;
  assert.equal(petal.canWork(actor), true);
  assert.ok(petal.getLight(0).r > 0);
  const crop = game.objects.all().find((o) => o.objType === 'crop' && o.ripe);
  assert.ok(crop, 'some crops start ripe');
  let res;
  for (let i = 0; i < 200 && !(res = crop.work(actor, 0.02)).done; i++);
  assert.ok(res.items.length && ['turnip', 'wheat'].includes(res.items[0].id));
  assert.equal(crop.stage, 0, 'replanted');
  assert.equal(crop.canWork(actor), false);
  game.clock.t += CROP_STAGE_SECONDS * 3 + 1;
  assert.equal(crop.stage, 3);
  assert.equal(crop.canWork(actor), true);
});

test('the journal goes to whoever picks it up, once', () => {
  const { game } = buildWorld();
  const events = [];
  game.bus.on('item_gained', (p) => events.push(p));
  const player = { id: 'player', inventory: new Inventory() };
  game.player = player;
  const j = game.objects.get('maren_journal');
  assert.ok(j.canInteract(player));
  assert.ok(j.getLight(0));
  j.interact(player);
  assert.equal(player.inventory.count('maren_journal'), 1);
  assert.equal(game.flags.journal_found, true);
  assert.deepEqual(
    events.map((e) => [e.actor, e.itemId, e.qty, e.from]),
    [[player, 'maren_journal', 1, 'quest']],
  );
  assert.equal(game.objects.get('maren_journal'), null);
  const saved = game.objects.serialize();
  assert.ok(saved.some((d) => d.id === 'maren_journal' && d.removed));
  const { game: g2 } = buildWorld();
  g2.objects.deserialize(JSON.parse(JSON.stringify(saved)));
  assert.equal(g2.objects.get('maren_journal'), null);
});

test('chests open the storage UI for the player and can be looted without one', () => {
  const { game } = buildWorld();
  const opened = [];
  game.ui = { openChest: (c) => opened.push(c.id), toast() {}, isModalOpen: () => true };
  const player = { id: 'player', x: 0, y: 0, inventory: new Inventory() };
  game.player = player;
  const chest = game.objects.get('bandit_chest');
  chest.interact(player);
  assert.deepEqual(opened, ['bandit_chest']);
  assert.equal(player.inventory.count('ruins_key'), 0);
  // Lyra loots loot chests directly; the home chest is not hers to empty.
  const lyra = { id: 'lyra', inventory: new Inventory() };
  const gained = [];
  game.bus.on('item_gained', (p) => gained.push(p));
  chest.interact(lyra);
  assert.equal(lyra.inventory.count('ruins_key'), 1);
  assert.ok(gained.some((g) => g.itemId === 'ruins_key' && g.from === 'chest' && g.actor === lyra));
  const home = game.objects.get('home_chest');
  const before = home.inventory.list().length;
  home.interact(lyra);
  assert.equal(home.inventory.list().length, before);
  // Without a storage UI the player simply takes everything.
  game.ui = { toast() {} };
  home.interact(player);
  assert.ok(home.inventory.isEmpty());
  assert.ok(player.inventory.count('bread') >= 1);
  const saved = game.objects.serialize();
  const { game: g2 } = buildWorld();
  g2.objects.deserialize(saved);
  assert.ok(g2.objects.get('home_chest').inventory.isEmpty());
  assert.equal(g2.objects.get('bandit_chest').inventory.count('ruins_key'), 0);
});

test('beds put the player to sleep; signs show their text', () => {
  const { game } = buildWorld();
  const slept = [];
  game.sleep = (bed) => slept.push(bed.id);
  const shown = [];
  game.ui = { showSign: (t, x) => shown.push([t, x]), toast() {} };
  const player = { id: 'player', inventory: new Inventory() };
  game.player = player;
  game.objects.get('home_bed').interact(player);
  assert.deepEqual(slept, ['home_bed']);
  const board = game.objects.get('notice_board');
  assert.equal(board.interactLabel(player), 'Read notices');
  board.interact(player);
  assert.equal(shown[0][0], 'Notice Board');
  for (const hint of [/rusted iron key/i, /after dark/i, /boars/i, /Elda/]) assert.match(shown[0][1], hint);
  // Without a sign dialog the text falls back to a toast.
  const toasts = [];
  game.ui = { toast: (t) => toasts.push(t) };
  game.objects.get('sign_welcome').interact(player);
  assert.match(toasts[0], /Welcome/);
});

test('lights: fires always, lamps and windows only after dark', () => {
  const { game } = buildWorld();
  const fire = game.objects.get('lake_campfire');
  const l = fire.getLight(1.5);
  assert.ok(l.r > 40 && l.intensity > 0.5 && l.color.startsWith('#'));
  const lamp = game.objects.all().find((o) => o.objType === 'lamp' && o.kind === 'post');
  const win = game.objects.all().find((o) => o.objType === 'window');
  game.clock.daylight = 1;
  assert.equal(lamp.getLight(0), null);
  assert.equal(win.getLight(0), null);
  game.clock.daylight = 0.05;
  assert.ok(lamp.getLight(0).intensity > 0.5);
  assert.ok(win.getLight(0).intensity > 0.3);
  const forge = game.objects.all().find((o) => o.objType === 'forge');
  assert.ok(forge.getLight(0));
  const altar = game.objects.all().find((o) => o.objType === 'altar');
  assert.ok(altar.getLight(0));
});

test('map tracks where the player and Lyra are and announces changes', () => {
  const { game } = buildWorld();
  const seen = [];
  game.bus.on('enter_location', (p) => seen.push(['enter', p.actor.id, p.location.id]));
  game.bus.on('leave_location', (p) => seen.push(['leave', p.actor.id, p.location.id]));
  const player = { id: 'player', x: WORLD.spawns.player.x, y: WORLD.spawns.player.y };
  const lyra = { id: 'lyra', x: WORLD.spawns.companion.x, y: WORLD.spawns.companion.y };
  game.player = player;
  game.companion = lyra;
  game.map.update(1 / 60);
  assert.deepEqual(seen, [
    ['enter', 'player', 'kings_road'],
    ['enter', 'lyra', 'kings_road'],
  ]);
  seen.length = 0;
  const home = game.locations.get('player_home').center;
  player.x = home.x;
  player.y = home.y;
  game.map.update(0.1);
  assert.equal(seen.length, 0, 'debounced');
  for (let i = 0; i < 20; i++) game.map.update(1 / 60);
  assert.deepEqual(seen, [
    ['leave', 'player', 'kings_road'],
    ['enter', 'player', 'player_home'],
  ]);
  assert.equal(game.map.locationOf(player).id, 'player_home');
});

test('tiles, collision and the object index agree', () => {
  const { map, objects } = WORLD;
  assert.equal(tileDef(T.WATER).water, true);
  assert.equal(tileDef(T.DEEP_WATER).solid, true);
  assert.equal(tileDef(T.BRIDGE).solid, false);
  // Flyers cross water but not walls.
  let water = null;
  for (let i = 0; i < map.w * map.h && !water; i++) if (map.isWater(i % map.w, (i / map.w) | 0)) water = [i % map.w, (i / map.w) | 0];
  assert.equal(map.isSolidTile(water[0], water[1], null), true);
  assert.equal(map.isSolidTile(water[0], water[1], { flying: true }), false);
  assert.equal(map.isSolidTile(-1, 5), true);
  const wall = map.buildings[0];
  assert.equal(map.blocksProjectile(wall.x, wall.y), true);
  // The King's Road crosses the stream on a bridge.
  let bridges = 0;
  for (let x = 0; x < map.w; x++) if (map.tileAt(x, 84) === T.BRIDGE) bridges++;
  assert.ok(bridges >= 3);
  // Fences know their neighbours.
  const fences = objects.all().filter((o) => o.objType === 'fence');
  assert.ok(fences.length > 50);
  assert.ok(fences.every((f) => /^prop:fence:\d+$/.test(f.sprite)));
  // inView, inRadius and findByWord use the spatial index.
  const sq = WORLD.locations.get('town_square').center;
  assert.ok(objects.inView(sq.x - 200, sq.y - 120, 400, 240).some((o) => o.id === 'notice_board'));
  assert.ok(objects.inRadius(sq.x, sq.y, 120).length > 3);
  assert.equal(objects.findByWord('notice board', sq.x, sq.y).id, 'notice_board');
  assert.equal(objects.findByWord('home chest', 0, 0).id, 'home_chest');
  assert.equal(objects.findByWord('bed', WORLD.spawns.player.x, WORLD.spawns.player.y).objType, 'bed');
  assert.equal(objects.findByWord('campfire', 115 * TILE, 47 * TILE).id, 'lake_campfire');
  assert.equal(objects.findByWord('the well', sq.x, sq.y).objType, 'well');
  assert.equal(objects.findByWord('gate', 24 * TILE, 88 * TILE).id, 'ruins_gate');
});

test('standalone map and object manager basics', () => {
  const game = makeGame();
  const map = new TileMap(8, 8, game);
  map.ground.fill(T.GRASS);
  map.set(3, 3, T.WALL);
  assert.equal(map.isSolidTile(3, 3), true);
  assert.equal(map.isSolidTile(2, 2), false);
  const om = new ObjectManager(game, 8, 8);
  const a = om.add(makeObject(game, { objType: 'barrel', tx: 1, ty: 1, solid: true }));
  const b = om.add(makeObject(game, { objType: 'barrel', tx: 1, ty: 1, solid: true }));
  assert.notEqual(a.id, b.id, 'ids stay unique');
  assert.equal(om.isBlockingTile(1, 1), true);
  om.remove(a);
  om.remove(b);
  assert.equal(om.isBlockingTile(1, 1), false);
  assert.equal(om.get(a.id), null);
});
