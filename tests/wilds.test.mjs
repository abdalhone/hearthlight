// The wider world (DESIGN §32): the land beyond the vale on foot, its places, the map's
// fog, bosses you can find, and the spawner's limits out there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/events.js';
import { RNG } from '../src/core/rng.js';
import { TILE, WORLD_X0, WORLD_Y0, WORLD_W, WORLD_H } from '../src/core/constants.js';
import { generateWorld } from '../src/world/worldgen.js';
import { Pathfinder } from '../src/world/pathfind.js';
import { T } from '../src/world/tiles.js';
import { P, ROADS, SEAMS, inVale } from '../src/world/wilds_layout.js';
import { Travel, packBits, unpackBits } from '../src/world/travel.js';
import { TRAILS, rumorFor, onTrailEvent, bossMarks, FIRST_BOSS } from '../src/world/boss_trails.js';
import { Spawner } from '../src/entities/spawner.js';

function makeGame() {
  const events = [];
  const bus = new EventBus();
  bus.on('*', (type, p) => events.push({ type, p }));
  return {
    bus,
    events,
    rng: new RNG(3),
    flags: {},
    time: 0,
    clock: { t: 300, hour: 11, day: 1, daylight: 1, isNight: false, weather: { type: 'clear' } },
    entities: { list: [], all() { return this.list; }, nearest: () => null, get: () => null },
    ui: { toasts: [], toast(t) { this.toasts.push(t); } },
  };
}

const t0 = performance.now();
const game = makeGame();
const world = generateWorld(game, 20261123);
const GEN_MS = performance.now() - t0;
game.map = world.map;
game.objects = world.objects;
game.locations = world.locations;
game.spawns = world.spawns;
game.pathfinder = new Pathfinder(game);
game.isBlockedTile = (tx, ty, a) => game.map.isSolidTile(tx, ty, a) || game.objects.isBlockingTile(tx, ty, a);
game.player = { id: 'player', x: world.spawns.player.x, y: world.spawns.player.y };
const tile = (p) => ({ tx: Math.floor(p.x / TILE), ty: Math.floor(p.y / TILE) });

test('the world is one map around the vale, generated in good time', () => {
  const m = world.map;
  assert.equal(m.x0, WORLD_X0);
  assert.equal(m.y0, WORLD_Y0);
  assert.equal(m.w, WORLD_W);
  assert.equal(m.h, WORLD_H);
  assert.deepEqual(world.problems, []);
  assert.ok(GEN_MS < 3000, `generated in ${Math.round(GEN_MS)} ms`);
  // The vale keeps its coordinates: the cottage door and the square are where they were.
  assert.ok(world.objects.get('door_player_home'));
  assert.equal(world.locations.get('town_square').bounds.x, 70);
});

test('every place of the wider world is reachable on foot from the cottage, by the roads', () => {
  const pf = game.pathfinder;
  const start = world.spawns.player;
  for (const id of ['dead_waystone', 'long_mile', 'bracken_ford', 'west_fork', 'brindlecombe', 'greyford', 'crown_shrine', 'treeline_camp', 'crown_ring', 'cinderwick_fork', 'bandit_lookout', 'owlsend_track']) {
    const loc = world.locations.get(id);
    assert.ok(loc, id);
    const c = pf.nearestWalkable(loc.center.x, loc.center.y, null, 6);
    assert.ok(c, `${id} has a walkable center`);
    const t = performance.now();
    const p = pf.find(start.x, start.y, c.x, c.y, { maxNodes: 12000 });
    assert.ok(p && p.length, `a path to ${id}`);
    assert.ok(performance.now() - t < 400, `${id} path found quickly`);
  }
});

test('journeys take a minute and more on foot (DESIGN §32.2)', () => {
  const pf = game.pathfinder;
  const sq = world.locations.get('town_square').center;
  const len = (id) => {
    const c = world.locations.get(id).center;
    const g = pf.nearestWalkable(c.x, c.y, null, 6);
    const p = pf.find(sq.x, sq.y, g.x, g.y, { maxNodes: 12000 });
    let d = 0;
    let x = sq.x;
    let y = sq.y;
    for (const q of p) (d += Math.hypot(q.x - x, q.y - y)), (x = q.x), (y = q.y);
    return d / 76; // seconds at the stranger's walking pace
  };
  assert.ok(len('brindlecombe') > 75, `Brindlecombe ${len('brindlecombe').toFixed(0)} s`);
  assert.ok(len('crown_ring') > 65, `Crown Ring ${len('crown_ring').toFixed(0)} s`);
  assert.ok(len('cinderwick_fork') > 30, `the fork ${len('cinderwick_fork').toFixed(0)} s`);
});

test('the roads run on across the seams; the vale walls itself elsewhere', () => {
  for (const s of SEAMS) {
    let open = 0;
    for (let y = s.y0; y <= s.y1; y++) for (let x = s.x0; x <= s.x1; x++) if (!game.isBlockedTile(x, y, null)) open++;
    assert.ok(open > 10, `${s.side} seam is open`);
  }
  // Just outside the vale away from the seams, the wilds are a wall.
  assert.equal(world.map.tileAt(-1, 20), T.THICKET);
  assert.equal(world.map.tileAt(160, 110) === T.THICKET || !game.isBlockedTile(160, 110, null), true);
  // Every road of the wilds is walkable along its middle (bar the broken bridge's water).
  for (const R of ROADS) {
    const [ax, ay] = R.points[1];
    assert.equal(game.isBlockedTile(Math.floor(ax), Math.floor(ay), null), false, `${R.id} open`);
  }
});

test('waystones: lit ones are safe places to rest; the dead one is Lyra\'s', () => {
  const lit = world.objects.get('waystone_long_mile');
  const dead = world.objects.get('waystone_dead_mile');
  assert.equal(lit.variant, 'lit');
  assert.ok(lit.getLight(0), 'a lit waystone gives light');
  assert.ok(lit.heal > 0, 'you can rest by it');
  assert.equal(dead.getLight(0), null);
  assert.match(dead.text, /Lyra/);
  assert.ok(world.map.safeSpots.some((s) => s.id === 'waystone_long_mile'));
  assert.ok(world.map.safeSpots.some((s) => s.id === 'waystone_cinderwick_fork'));
  // Nothing turned spawns in the light.
  const sp = new Spawner(game, []);
  const s = world.map.safeSpots[0];
  assert.equal(sp.blocked(s.x + 8, s.y + 8, 'wolf'), true);
});

test('Brindlecombe: doors open, a cold wardstone, houses to loot, graves', () => {
  const doors = world.objects.list.filter((o) => o.objType === 'door' && String(o.building).startsWith('brindle_'));
  assert.ok(doors.length >= 6);
  for (const d of doors) assert.equal(d.state.open, true, `${d.id} stands open`);
  assert.ok(world.objects.get('brindle_wardstone'));
  const chests = world.objects.list.filter((o) => o.objType === 'chest' && /brindle/.test(o.id));
  assert.ok(chests.length >= 5);
  for (const c of chests) assert.ok(!c.inventory.isEmpty(), `${c.id} holds something`);
  assert.ok(world.objects.list.filter((o) => o.objType === 'grave').length >= 6);
  assert.equal(world.locations.at(P.brindlecombe.x * TILE, (P.brindlecombe.y + 2) * TILE).id, 'brindlecombe');
});

test('the Crown Ring: nine stones in the snow round a melted circle', () => {
  const stones = world.objects.list.filter((o) => /^crown_stone_/.test(o.id));
  assert.equal(stones.length, 9);
  assert.equal(world.map.tileAt(P.crownRing.x, P.crownRing.y), T.GRASS);
  assert.equal(world.map.tileAt(P.crownRing.x + 12, P.crownRing.y), T.SNOW);
  assert.match(world.objects.get('crown_ring_heart').text, /found you/);
});

test('snow, scree, heather and fords slow your feet; the vale does not', () => {
  const m = world.map;
  const at = (tx, ty) => m.speedAt(tx * TILE + 8, ty * TILE + 8);
  assert.ok(at(P.crownRing.x + 12, P.crownRing.y) < 0.85);
  assert.equal(at(80, 62), 1);
  let ford = null;
  for (let y = 80; y < 90 && !ford; y++) for (let x = -90; x < -76; x++) if (m.tileAt(x, y) === T.SHALLOWS) ford = [x, y];
  assert.ok(ford, 'the Bracken Water has a ford on the road');
  assert.ok(at(...ford) < 0.8);
  assert.equal(game.isBlockedTile(ford[0], ford[1], null), false, 'a ford is walkable');
});

test('the map remembers what you walked, in a small save', () => {
  const tr = new Travel(game);
  const sq = world.locations.get('town_square').center;
  game.player.x = sq.x;
  game.player.y = sq.y;
  assert.ok(tr.seenTile(80, 60), 'the vale is known');
  assert.ok(!tr.seenTile(P.brindlecombe.x, P.brindlecombe.y));
  game.player.x = P.brindlecombe.x * TILE;
  game.player.y = P.brindlecombe.y * TILE;
  tr.pollT = 0;
  tr.update(0.5);
  assert.ok(tr.seenTile(P.brindlecombe.x, P.brindlecombe.y));
  assert.ok(game.events.some((e) => e.type === 'place_reached' && e.p.id === 'brindlecombe' && e.p.first));
  const save = tr.serialize();
  assert.ok(JSON.stringify(save).length < 2000, `travel save ${JSON.stringify(save).length} bytes`);
  const tr2 = new Travel(game);
  tr2.deserialize(JSON.parse(JSON.stringify(save)));
  assert.ok(tr2.seenTile(P.brindlecombe.x, P.brindlecombe.y));
  assert.ok(tr2.reached.brindlecombe);
  const bits = Uint8Array.from([1, 0, 1, 1, 0, 0, 0, 0, 1]);
  assert.deepEqual([...unpackBits(packBits(bits), bits.length)], [...bits]);
});

test('bosses you can find: the board, the villagers, the signs, the sight of an arena', () => {
  game.travel = new Travel(game);
  game.ui.toasts.length = 0;
  // The notice board warns of three from the first morning.
  onTrailEvent(game, 'sign_read', { sign: world.objects.get('notice_board') });
  for (const id of ['mother_of_slimes', 'varek', 'bone_warden']) assert.ok(game.travel.known(id), id);
  assert.ok(game.ui.toasts.some((t) => /map/i.test(t)));
  // A villager who knows tells, and it goes on the map.
  assert.ok(!game.travel.known('greyjaw'));
  const r = rumorFor(game, 'hess');
  assert.match(r.lines[0], /Berry Hollow/);
  assert.ok(game.travel.known('greyjaw'));
  // Asked again, the roads beyond.
  assert.match(rumorFor(game, 'hess').lines[0], /Crown path/);
  // A sign in the world: the humming dock end.
  const hum = world.objects.list.find((o) => o.trailBoss === 'lakes_hum');
  assert.ok(hum, 'the lake has its sign');
  onTrailEvent(game, 'object_looked', { obj: hum });
  assert.ok(game.travel.known('lakes_hum'));
  // Every boss has signs in the world, standing on the way to it.
  for (const id of Object.keys(TRAILS)) assert.ok(world.objects.list.some((o) => o.trailBoss === id), `${id} has a sign`);
  // Marks for the map, at the arenas.
  const marks = bossMarks(game);
  assert.equal(marks.length, 5);
  for (const m of marks) assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y));
});

test('the first boss is pointed to early: after the first lesson the village talks', () => {
  game.travel = new Travel(game);
  game.ui.toasts.length = 0;
  onTrailEvent(game, 'mission_completed', { id: 'first_spark' });
  assert.ok(game.travel.known(FIRST_BOSS));
  assert.ok(game.ui.toasts.some((t) => /Mother of Slimes/.test(t) && /quarry/i.test(t)));
});

test('wilds spawn zones fill only near you, and let go when you are far', () => {
  const zones = world.spawns.spawnZones.filter((z) => z.near);
  assert.ok(zones.length >= 10);
  const g2 = { ...game, entities: { list: [], all() { return this.list; } }, camera: { x: 0, y: 0, vw: 400, vh: 240 }, clock: { isNight: false } };
  const sp = new Spawner(g2, zones);
  g2.player = { x: 80 * TILE, y: 62 * TILE }; // in the square, far from them all
  sp.t = 1e6;
  sp.check();
  assert.equal(g2.entities.list.length, 0, 'nothing spawns in the wilds while you are home');
  const z = sp.zones.find((q) => q.id === 'heath_boars');
  assert.ok(sp.playerDist(z) > z.near);
  g2.player = { x: -100 * TILE, y: 84 * TILE };
  assert.equal(sp.playerDist(z), 0);
});

test('tiles beyond the vale are never the vale (inVale)', () => {
  assert.ok(inVale(0, 0) && inVale(159, 119));
  assert.ok(!inVale(-1, 0) && !inVale(160, 5) && !inVale(10, -1));
  assert.ok(tile(world.spawns.player).tx >= 0);
});

// ---------------------------------------------------------------------------
// Chests you could not open (DESIGN §32.6)

import { CONTAINERS, onContainerEvent } from '../src/world/containers.js';
import { Inventory } from '../src/entities/items.js';

test('every chest has a way in: a key someone has, its keeper, or a forced lock', async () => {
  const trunk = world.objects.get('lyra_trunk');
  const locker = world.objects.get('guard_footlocker');
  const linen = world.objects.get('reed_linen_chest');
  for (const c of [trunk, locker, linen]) assert.equal(c.objType, 'chest', `${c.id} is a real chest`);
  assert.ok(trunk.state.locked && locker.state.locked && !linen.state.locked);
  // No chest-shaped prop is left that does nothing.
  assert.ok(!world.objects.list.some((o) => o.objType === 'trunk' && !o.text), 'no silent trunks');
  // Rowan's key opens his footlocker.
  const opened = [];
  const g = { ...game, ui: { toast() {}, openChest: (c) => opened.push(c.id) }, player: { id: 'player', inventory: new Inventory({ guard_key: 1 }) } };
  locker.game = g;
  locker.interact(g.player);
  assert.equal(locker.state.locked, false);
  assert.deepEqual(opened, ['guard_footlocker']);
  // Without a key: the lock can be forced, and Lyra's trunk forced is theft from Lyra.
  const crimes = [];
  const lyra = { id: 'lyra', x: 0, y: 0 };
  const g2 = { ...game, companion: lyra, bus: { emit: (t, p) => t === 'crime' && crimes.push(p) }, ui: { toast() {}, confirm: async () => true, openChest() {} }, player: { id: 'player', inventory: new Inventory() } };
  trunk.game = g2;
  trunk.interact(g2.player);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(trunk.state.locked, false);
  assert.equal(trunk.state.forced, true);
  assert.equal(crimes.length, 1);
  assert.equal(crimes[0].kind, 'theft');
  assert.equal(crimes[0].victim, lyra);
  // Taking from the Reeds' open linen chest is theft too, once a day.
  const c2 = [];
  const g3 = { ...game, entities: { get: (id) => ({ id }) }, bus: { emit: (t, p) => t === 'crime' && c2.push(p) }, clock: { day: 3 } };
  linen.game = g3;
  onContainerEvent(g3, 'item_gained', { actor: g3.player, itemId: 'wheat', qty: 1, from: 'chest', chest: linen });
  onContainerEvent(g3, 'item_gained', { actor: g3.player, itemId: 'wheat', qty: 1, from: 'chest', chest: linen });
  assert.equal(c2.length, 1);
  assert.equal(c2[0].owner, 'tobias');
  // Loot is free: Brindlecombe's chests are nobody's now.
  const vestry = world.objects.get('chest_brindle_chapel');
  onContainerEvent(g3, 'item_gained', { from: 'chest', chest: vestry });
  assert.equal(c2.length, 1);
  assert.ok(Object.keys(CONTAINERS).length >= 3);
});

// ---------------------------------------------------------------------------
// Footsteps by ground (DESIGN §32.7)

import { surfaceAt, playerStep, otherStep, SURFACES } from '../src/world/footsteps.js';
import { SFX, SFX_GAP } from '../src/ui/sfx.js';

test('footsteps sound of the ground: grass, dirt, stone, wood, water, sand, snow', () => {
  const m = world.map;
  const at = (tx, ty) => surfaceAt(m, tx * TILE + 8, ty * TILE + 8);
  assert.equal(at(78, 62), 'stone', 'the square is cobbled');
  assert.equal(at(5, 84), 'dirt', "the King's Road");
  assert.equal(at(P.crownRing.x + 12, P.crownRing.y), 'snow');
  let ford = null;
  for (let y = 80; y < 90 && !ford; y++) for (let x = -90; x < -76; x++) if (m.tileAt(x, y) === T.SHALLOWS) ford = [x, y];
  assert.equal(at(...ford), 'water');
  const door = world.objects.get('door_player_home');
  assert.equal(surfaceAt(m, door.x, door.y - 20), 'wood', 'the cottage floor');
  for (const s of SURFACES) {
    assert.equal(typeof SFX[`step_${s}`], 'function', `a sound for ${s}`);
    assert.ok(SFX_GAP[`step_${s}`] > 0);
  }
  // Your own steps are louder than anyone else's, and others are heard only near you.
  const plays = [];
  const g = { map: m, player: { x: 78 * TILE, y: 62 * TILE }, audio: { play: (n, o) => plays.push([n, o.volume]) }, particles: null };
  playerStep(g, g.player, 0);
  const villager = { x: g.player.x + 40, y: g.player.y, moved: 4, radius: 6, z: 0 };
  for (let i = 0; i < 4; i++) otherStep(g, villager);
  const farOne = { x: g.player.x + 400, y: g.player.y, moved: 4, radius: 6, z: 0 };
  for (let i = 0; i < 4; i++) otherStep(g, farOne);
  assert.equal(plays.length, 2);
  assert.equal(plays[0][0], 'step_stone');
  assert.ok(plays[1][1] < plays[0][1], 'a neighbour treads softer than you');
});

// ---------------------------------------------------------------------------
// People grow older; a shop that buys what you carry (the author's request)

import { Calendar, YEAR_DAYS, birthdayOf, birthdaysBy, baseAge, firstBirthday } from '../src/world/calendar.js';
import { profileById } from '../src/entities/npc_data.js';

test('people age: a birthday a year, and everyone reads the new age', () => {
  const bus = [];
  const clock = { day: 1 };
  const g = { clock, bus: { emit: (t, p) => bus.push([t, p]) }, entities: { all: () => [], get: () => null }, ui: { toast() {} }, companion: { mind: { soul: { age: 24 } } } };
  const cal = new Calendar(g);
  cal.update();
  assert.equal(cal.ageOf('pip'), 9, 'Pip is nine on the first morning');
  assert.equal(profileById('pip').age, 9);
  const b = birthdayOf('pip');
  assert.ok(b >= 1 && b <= YEAR_DAYS);
  clock.day = firstBirthday('pip');
  cal.update();
  assert.equal(cal.ageOf('pip'), 10);
  assert.equal(profileById('pip').age, 10, "Pip's profile (and every prompt that reads it) says ten");
  assert.ok(bus.some(([t, p]) => t === 'birthday' && p.id === 'pip' && p.age === 10));
  clock.day = firstBirthday('pip') + YEAR_DAYS * 2;
  cal.update();
  assert.equal(cal.ageOf('pip'), 12, 'two more years go round');
  assert.equal(g.companion.mind.soul.age, baseAge('lyra') + birthdaysBy('lyra', clock.day), 'Lyra too');
  // Back to the first morning (other tests read the canon ages).
  clock.day = 1;
  cal.lastDay = null;
  cal.update();
  assert.equal(profileById('pip').age, 9);
});

test("Garrick's shop buys anything worth anything, at half its worth", () => {
  const shop = profileById('garrick').shop;
  assert.equal(shop.buysAll, 0.5);
  assert.equal(shop.buys.wolf_pelt, 8, 'his own prices stand');
});
