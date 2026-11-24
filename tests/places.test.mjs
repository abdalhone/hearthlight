import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/events.js';
import { RNG } from '../src/core/rng.js';
import { TILE } from '../src/core/constants.js';
import { generateWorld } from '../src/world/worldgen.js';
import { Pathfinder } from '../src/world/pathfind.js';
import { T, tileDef, TILE_COUNT } from '../src/world/tiles.js';
import { LAMP_HOURS, lampRound, makeObject } from '../src/world/objects.js';
import { LOCATION_INFO, LOOKS, BED_TEXT } from '../src/world/world_content.js';

// Round 3 places (DESIGN §19.2, LORE §10), beds in every home and ground that reads
// true (DESIGN §19.8).

const SEED = 20261123;

function makeGame() {
  return {
    bus: new EventBus(),
    rng: new RNG(7),
    flags: {},
    time: 0,
    clock: { t: 300, hour: 8, daylight: 1, weather: { type: 'clear' } },
    entities: { list: [], all() { return this.list; }, get: (id) => null, nearest: () => null },
    atlas: null,
    ui: null,
  };
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

const { game: G, world: W } = buildWorld();
const tileOf = (p) => ({ tx: Math.floor(p.x / TILE), ty: Math.floor(p.y / TILE) });
const inBounds = (b, tx, ty) => tx >= b.x && ty >= b.y && tx < b.x + b.w && ty < b.y + b.h;
const SQUARE = () => W.locations.get('town_square').center;

const NEW_PLACES = ['lamplight_lane', 'chandlery', 'ashby_house', 'dye_cottage', 'weavers_row', 'net_shed', 'wenna_hives'];

// Who sleeps where (LORE §10 Homes; DESIGN §19.8: all eighteen, in their own homes).
const HOMES = {
  bram: 'smithy',
  elda: 'ember_kettle',
  pip: 'ember_kettle',
  rowan: 'guardhouse',
  wys: 'guardhouse',
  mira: 'herbalist',
  tobias: 'farmhouse',
  tansy: 'farmhouse',
  aveline: 'chapel',
  garrick: 'general_store',
  hobb: 'chandlery',
  wenna: 'chandlery',
  hess: 'dye_cottage',
  sabeth: 'dye_cottage',
  alder: 'ashby_house',
  petra: 'ashby_house',
  tilly: 'ashby_house',
  corran: 'net_shed',
};

test('the world builds without problems, with every new place and the old ones', () => {
  assert.deepEqual(W.problems, []);
  for (const id of NEW_PLACES) {
    const loc = W.locations.get(id);
    assert.ok(loc, `${id} exists`);
    assert.ok(LOCATION_INFO[id]?.description, `${id} has a description`);
    const c = tileOf(loc.center);
    assert.ok(inBounds(loc.bounds, c.tx, c.ty), `${id} center inside its bounds`);
    assert.ok(!G.isBlockedTile(c.tx, c.ty, null), `${id} center is walkable`);
  }
  // The places LORE puts where it puts them.
  const at = (id) => W.locations.get(id).center;
  assert.ok(at('chandlery').x > W.locations.get('chapel').center.x, 'the chandlery is east of the chapel');
  assert.ok(at('chandlery').y < W.locations.get('smithy').center.y, 'behind (north of) the smithy');
  const sq = W.locations.get('town_square').bounds;
  const ashby = W.map.buildings.find((b) => b.id === 'ashby_house');
  assert.ok(ashby.y + ashby.h > sq.y + sq.h && ashby.x < sq.x + sq.w, 'Ashby House on the south side of the square');
  assert.ok(at('dye_cottage').x > W.locations.get('player_home').center.x, 'the dye-vats cottage is east of the Wayhouse');
  assert.ok(at('weavers_row').y > sq.y + sq.h, "Weavers' Row is south of the square");
  assert.ok(Math.abs(at('net_shed').y - W.locations.get('mirror_lake').center.y) < TILE * 6, 'the net-shed sits by the dock');
  assert.equal(W.locations.at(at('wenna_hives').x, at('wenna_hives').y).id, 'wenna_hives');
});

test('every villager and Lyra has a bed of their own in their own home', () => {
  for (const [owner, home] of Object.entries(HOMES)) {
    const beds = W.objects.all().filter((o) => o.objType === 'bed' && o.owner === owner);
    assert.equal(beds.length, 1, `one bed for ${owner}`);
    const bed = beds[0];
    const loc = W.locations.get(home);
    assert.ok(inBounds(loc.bounds, bed.tx, bed.ty), `${owner}'s bed is in ${home}`);
    assert.equal(W.map.buildingAt(bed.tx, bed.ty)?.id, home, `${owner}'s bed is under ${home}'s roof`);
    assert.ok(BED_TEXT[owner]?.text && bed.name, `${owner}'s bed has a name and a look`);
  }
  assert.equal(W.objects.get('lyra_inn_bed').owner, 'lyra');
  assert.equal(W.map.buildingAt(W.objects.get('lyra_inn_bed').tx, W.objects.get('lyra_inn_bed').ty).id, 'ember_kettle');
  assert.equal(W.objects.get('lyra_bed').owner, 'lyra');
});

test('beds are in rooms of their own, not in the middle of a shop or chapel floor', () => {
  // Flood the building's floor from its door without crossing a doorway in an interior
  // partition: the first room you walk into. No villager's bed may stand in it, except
  // in the one-room homes (the net-shed) and the Wayhouse (the player's own).
  const oneRoom = new Set(['net_shed', 'player_home']);
  for (const b of W.map.buildings) {
    if (oneRoom.has(b.id)) continue;
    const it = b.interior;
    const seen = new Set();
    const door = b.doorTiles[0];
    const q = [[door.tx, door.ty - 2]];
    const isDoorway = (x, y) => {
      // A floor tile with interior wall on two opposite sides is a doorway.
      const wall = (xx, yy) => G.map.tileAt(xx, yy) === T.WALL && inBounds(b, xx, yy);
      return (wall(x - 1, y) && wall(x + 1, y)) || (wall(x, y - 1) && wall(x, y + 1));
    };
    while (q.length) {
      const [x, y] = q.pop();
      const k = `${x},${y}`;
      if (seen.has(k) || !inBounds(it, x, y) || G.map.tileAt(x, y) === T.WALL || isDoorway(x, y)) continue;
      seen.add(k);
      q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    // Places of healing (DESIGN §27: the infirmary cot, the cell) stand where the hurt are carried in.
    const healing = new Set(['sickroom', 'infirmary', 'cell']);
    for (const bed of W.objects.all().filter((o) => o.objType === 'bed' && o.owner && o.owner !== 'player' && !healing.has(o.owner))) {
      if (W.map.buildingAt(bed.tx, bed.ty) !== b) continue;
      for (const [x, y] of bed.occupiedTiles()) assert.ok(!seen.has(`${x},${y}`), `${bed.id} is behind a partition in ${b.id}, not in its front room`);
    }
  }
});

test('every owner can walk from the square to their bed and lie down in it', () => {
  const sq = SQUARE();
  for (const owner of [...Object.keys(HOMES), 'lyra']) {
    for (const bed of W.objects.all().filter((o) => o.objType === 'bed' && o.owner === owner)) {
      const path = G.pathfinder.find(sq.x, sq.y, bed.lie.x, bed.lie.y, { actor: { id: owner }, maxNodes: 20000 });
      assert.ok(path && path.length, `${owner} reaches ${bed.id}`);
      // Their own bed does not block them; it blocks everyone else.
      assert.equal(bed.blocksTile(bed.tx, bed.ty, { id: owner }), owner === 'player');
      assert.equal(bed.blocksTile(bed.tx, bed.ty, { id: 'someone_else' }), true);
    }
  }
});

test('every door is reachable by A* from the town square', () => {
  const sq = SQUARE();
  const doors = W.objects.all().filter((o) => o.objType === 'door' && o.id !== 'ruins_gate');
  assert.ok(doors.length >= 15, `doors (${doors.length})`);
  for (const d of doors) {
    // The tile just outside the door, on the street side.
    const out = { x: d.tx * TILE + TILE / 2, y: (d.ty + 1) * TILE + TILE / 2 };
    assert.ok(!G.isBlockedTile(d.tx, d.ty + 1, null), `${d.id} has open ground in front`);
    const path = G.pathfinder.find(sq.x, sq.y, out.x, out.y, { maxNodes: 20000 });
    assert.ok(path && path.length, `${d.id} reachable from the square`);
    if (!d.locked) {
      const inside = G.pathfinder.find(sq.x, sq.y, d.tx * TILE + 8, (d.ty - 1) * TILE + 8, { maxNodes: 20000 });
      assert.ok(inside, `inside ${d.id} reachable through the door`);
    }
  }
  // The closed homes on Weavers' Row stay shut, politely.
  const shut = W.objects.get('door_holloway_house');
  assert.ok(shut.locked && shut.lockedText);
});

test('new villagers spawn at home on open ground', () => {
  for (const id of ['hobb', 'wenna', 'hess', 'sabeth', 'alder', 'petra', 'tilly', 'tansy', 'corran', 'wys']) {
    const s = W.spawns.npcs.find((n) => n.id === id);
    assert.ok(s, `${id} has a spawn`);
    const t = tileOf(s);
    assert.ok(!G.isBlockedTile(t.tx, t.ty, null), `${id} spawns on open ground`);
    const home = W.locations.get(HOMES[id]);
    assert.ok(inBounds(home.bounds, t.tx, t.ty), `${id} spawns at home (${HOMES[id]})`);
  }
});

test('new props exist with words, look text, and the villagers can find them', () => {
  const has = (type) => W.objects.all().filter((o) => o.objType === type);
  for (const t of ['dipping_vat', 'candle_rack', 'hive', 'dye_vat', 'loom', 'net_rack', 'washing_line']) {
    const list = has(t);
    assert.ok(list.length >= 1, `${t} placed`);
    for (const o of list) assert.ok(o.text && o.text.length > 20, `${o.id} has a look`);
  }
  assert.ok(W.objects.all().some((o) => o.objType === 'tree' && o.kind === 'linden'), 'lindens by the hives');
  const inLoc = (o, id) => inBounds(W.locations.get(id).bounds, o.tx, o.ty);
  assert.ok(has('dipping_vat').some((o) => inLoc(o, 'chandlery')));
  assert.ok(has('dye_vat').some((o) => Math.abs(o.tx - W.locations.get('dye_cottage').bounds.x) < 12));
  assert.ok(has('hive').filter((o) => inLoc(o, 'wenna_hives')).length >= 3);
  assert.ok(has('bench').some((o) => inLoc(o, 'lamplight_lane')), "the Ambrels' bench on the lane");
  assert.ok(has('desk').some((o) => inLoc(o, 'ashby_house')), 'the ledger-room desk');
  assert.ok(has('loom').some((o) => inLoc(o, 'weavers_row')), "Nan Pike's loom");
  for (const k of ['dippingVat', 'candleRack', 'loom', 'netRack', 'hive', 'dyeVatTeal', 'washingLine', 'ledgerDesk']) assert.ok(LOOKS[k]?.text, `LOOKS.${k}`);
  // The stream below the vats runs violet and teal.
  const dyed = [];
  for (let y = 70; y < 100; y++) for (let x = 120; x < 140; x++) if (W.map.decoAt(x, y) === 19) dyed.push([x, y]);
  assert.ok(dyed.length > 10, 'dyed water');
  for (const [x, y] of dyed) assert.ok(W.map.isWater(x, y));
});

test('village lamps: a round in order, lit by hand or by themselves at full dark, out at dawn', () => {
  const { game } = buildWorld();
  const round = lampRound(game);
  assert.ok(round.length >= 20, `street lamps on the round (${round.length})`);
  round.forEach((l, i) => assert.equal(l.round, i));
  assert.equal(round[0].area, 'town_square', 'the square is lit first');
  assert.equal(round.at(-1).area, 'lamplight_lane', 'Lamplight Lane last');
  assert.ok(round.filter((l) => l.area === 'lamplight_lane').length >= 3);
  assert.ok(round.some((l) => l.far), 'the far lamps');
  for (const l of round) assert.equal(l.state.lit, false, 'dark by day');

  const lit = [];
  game.bus.on('lamp_lit', (e) => lit.push(e.id));
  // By hand: Hobb lights one.
  const first = round[0];
  game.clock.daylight = 0.1;
  game.clock.hour = 18.5;
  assert.equal(first.needsLighting(), true);
  assert.equal(first.getLight(0), null, 'unlit gives no light');
  assert.equal(first.light({ id: 'hobb' }), true);
  assert.equal(first.light({ id: 'hobb' }), false, 'already lit');
  assert.deepEqual(lit, [first.id]);
  assert.ok(first.getLight(0).intensity > 0.3, 'lit gives warm light');
  assert.equal(first.needsLighting(), false);
  assert.equal(first.serialize().state.lit, true);

  // With a lamplighter about, the rest wait for him until full dark, then light themselves.
  game.entities.get = (id) => (id === 'hobb' ? { id: 'hobb' } : null);
  const step = (hour, secs = 2) => {
    game.clock.hour = hour;
    for (let i = 0; i < secs * 10; i++) game.objects.update(0.1);
  };
  step(19.5);
  assert.equal(round.filter((l) => l.state.lit).length, 1, 'waiting for Hobb');
  step(LAMP_HOURS.selfLight + 0.1);
  assert.ok(round.every((l) => l.state.lit), 'nobody lit them: they lit themselves at full dark');
  // Dawn: all out.
  step(8);
  assert.ok(round.every((l) => !l.state.lit), 'out at dawn');
  // With no lamplighter in the world at all, the round still runs at dusk.
  game.entities.get = () => null;
  step(LAMP_HOURS.roundStart + 0.02);
  assert.ok(round[0].state.lit && !round.at(-1).state.lit, 'the round starts at the square');
  step(LAMP_HOURS.roundStart + LAMP_HOURS.roundStep * round.length + 0.1);
  assert.ok(round.every((l) => l.state.lit), 'and reaches the far lamps');
  // Chapel candles never go out.
  const candles = game.objects.all().find((o) => o.objType === 'lamp' && o.kind === 'candles');
  step(12);
  assert.ok(candles.lit);
});

test('a saved lamp comes back lit', () => {
  const { game } = buildWorld();
  const l = lampRound(game)[3];
  l.light();
  const d = l.serialize();
  const { game: g2 } = buildWorld();
  const l2 = g2.objects.get(l.id);
  l2.deserialize(d);
  assert.equal(l2.lit, true);
});

test('ground reads true: whatever is drawn raised is solid, and streets are flat floor', () => {
  for (let id = 0; id < TILE_COUNT; id++) {
    const d = tileDef(id);
    if (d.raised) assert.ok(d.solid, `${d.name} is drawn raised, so it must not be walkable`);
  }
  for (const id of [T.COBBLE, T.DIRT, T.GRASS, T.FLOOR, T.STONE_FLOOR, T.BRIDGE, T.DOCK, T.GRAVEL, T.SAND]) assert.equal(tileDef(id).raised, false, `${tileDef(id).name} is flat`);
  assert.equal(tileDef(T.FLOWERBED).solid, true, 'planters are walked around');
  // And nothing walkable in the world is a raised tile.
  for (let y = 0; y < W.map.h; y++) for (let x = 0; x < W.map.w; x++) if (tileDef(W.map.tileAt(x, y)).raised) assert.ok(W.map.isSolidTile(x, y, null));
});

test('a bed draws whoever sleeps in it and hides the sideways figure', () => {
  const { game } = buildWorld();
  const atlas = { has: (n) => n.startsWith('char:'), getMeta: () => ({ kind: 'humanoid' }), get: () => null };
  game.atlas = atlas;
  const bed = game.objects.get('bed_bram');
  const bram = { id: 'bram', spriteKey: 'bram', state: 'sleep', x: bed.lie.x, y: bed.lie.y };
  game.entities.list.push(bram);
  for (let i = 0; i < 5; i++) bed.update(0.1);
  assert.equal(bed.sleeper, bram);
  assert.equal(bram.hidden, true, 'the renderer skips the actor while the bed draws him');
  bram.state = 'idle';
  assert.equal(bram.hidden, false, 'up and about: drawn as himself again');
  for (let i = 0; i < 5; i++) bed.update(0.1);
  assert.equal(bed.sleeper, null);
  // A villager asleep somewhere else is not claimed.
  bram.state = 'sleep';
  bram.x += 40;
  for (let i = 0; i < 5; i++) bed.update(0.1);
  assert.equal(bed.sleeper, null);
  assert.equal(bram.hidden, false);
  assert.equal(bed.orient, 'v');
  assert.ok(bed.pillow.y < bed.lie.y, 'the pillow is at the head');
  void makeObject;
});
