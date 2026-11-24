import { TILE, WORLD_W, WORLD_H } from '../core/constants.js';
import { RNG, hash2, fbm } from '../core/rng.js';
import { TileMap } from './map.js';
import { T, DECO, SOLID, WATERY } from './tiles.js';
import { ObjectManager, makeObject } from './objects.js';
import { LocationIndex } from './locations.js';
import { LOCATION_INFO, NOTICE_BOARD, SIGNS, LOOKS } from './world_content.js';

// The world of Hearthvale, laid out by hand. The seed only shapes organic detail:
// shorelines, forest edges, tree scatter, flowers and grass variety.
//
// Contract: generateWorld(game, seed) -> { map, objects, locations, spawns }
//   spawns = { player, companion, npcs: [{id, x, y}], creatures: [{species, x, y, opts}],
//              spawnZones: [{ id, locationId, species, max, night, rect (tiles) }] }
//
// Map overview (tiles, 160 × 120; north is up):
//   Whisperwood fills the north (heart near 74,14), Stonecut Quarry sits northwest,
//   the bandit camp northeast, Mirror Lake east with its stream running south.
//   Hearthvale is in the middle, Reed Farm west of it, the King's Road runs east-west
//   at y 83–85 (bridge over the stream), South Meadow lies south, the Sunken Ruins
//   southwest.

const W = WORLD_W;
const H = WORLD_H;
const px = (t) => t * TILE + TILE / 2; // tile -> pixel center
const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const HEART = { x: 74, y: 14 };
export const KINGS_ROAD_Y = 83; // first of three rows

class WorldBuilder {
  constructor(game, seed) {
    this.game = game;
    this.seed = seed >>> 0;
    this.rng = new RNG((this.seed ^ 0x9e3779b9) >>> 0 || 1);
    this.map = new TileMap(W, H, game);
    this.objects = new ObjectManager(game, W, H);
    this.clear = new Uint8Array(W * H); // keep free of scattered trees and rocks
    this.occ = new Uint8Array(W * H); // an object stands here
    this.trunk = new Uint8Array(W * H); // tree or bush trunk (spacing rule)
    this.forestD = new Float32Array(W * H); // depth inside Whisperwood (tiles), <= 0 outside
    this.fences = [];
    this.problems = [];
    this.locs = [];
    this.lake = { cx: 134, cy: 51, rx: 16.5, ry: 12.5 };
    this.spawns = { player: null, companion: null, npcs: [], creatures: [], spawnZones: [] };
  }

  // ---------- helpers ----------

  noise(x, y, scale, salt, oct = 3) {
    return fbm(x * scale, y * scale, (this.seed + salt * 101) | 0, oct);
  }

  hash(x, y, salt = 0) {
    return hash2(x, y, (this.seed + salt * 7919) | 0);
  }

  inb(x, y) {
    return x >= 0 && y >= 0 && x < W && y < H;
  }

  get(x, y) {
    return this.map.tileAt(x, y);
  }

  set(x, y, t) {
    this.map.set(x, y, t);
  }

  fill(x, y, w, h, t) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, t);
  }

  keep(x, y, w, h) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.inb(i, j)) this.clear[j * W + i] = 1;
  }

  ellipse(cx, cy, rx, ry, fn) {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        if (!this.inb(x, y)) continue;
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const r = Math.hypot(dx, dy);
        fn(x, y, r);
      }
    }
  }

  // A thick, slightly wobbly stroke along a polyline (roads, trails, the stream).
  stroke(points, width, fn) {
    const r = width / 2;
    for (let s = 0; s < points.length - 1; s++) {
      const [ax, ay] = points[s];
      const [bx, by] = points[s + 1];
      const len = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.ceil(len * 4));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const cx = ax + (bx - ax) * t;
        const cy = ay + (by - ay) * t;
        const rr = r + (this.noise(cx, cy, 0.35, 77) - 0.5) * 0.6;
        for (let y = Math.floor(cy - rr - 1); y <= Math.ceil(cy + rr); y++) {
          for (let x = Math.floor(cx - rr - 1); x <= Math.ceil(cx + rr); x++) {
            if (!this.inb(x, y)) continue;
            if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= rr) fn(x, y);
          }
        }
      }
    }
  }

  path(points, width, tile = T.DIRT, margin = 1) {
    this.stroke(points, width, (x, y) => {
      const g = this.get(x, y);
      if (WATERY[g] || g === T.WALL || g === T.FLOOR || g === T.RUIN_WALL || g === T.PALISADE || g === T.BRIDGE || g === T.DOCK || g === T.COBBLE) return;
      this.set(x, y, tile);
    });
    this.stroke(points, width + margin * 2, (x, y) => (this.clear[y * W + x] = 1));
  }

  // Place an object. Fails (returns null) if any tile it needs is taken or not walkable ground.
  put(desc, { strict = false, allowSolidGround = false } = {}) {
    const o = makeObject(this.game, desc);
    for (const [x, y] of o.occupiedTiles()) {
      if (!this.inb(x, y) || this.occ[y * W + x] || (!allowSolidGround && SOLID[this.get(x, y)])) {
        if (strict) this.problems.push(`could not place ${o.id} at ${x},${y}`);
        return null;
      }
    }
    for (const [x, y] of o.occupiedTiles()) this.occ[y * W + x] = 1;
    this.objects.add(o);
    return o;
  }

  must(desc, opts) {
    return this.put(desc, { strict: true, ...(opts || {}) });
  }

  // Place a prop at the nearest free walkable spot around (tx, ty) (or around its footprint).
  near(desc, tx, ty, radius = 3) {
    for (let r = 0; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const f = desc.footprint;
          const o = f ? this.put({ ...desc, footprint: { ...f, x: f.x + dx, y: f.y + dy } }) : this.put({ ...desc, tx: tx + dx, ty: ty + dy });
          if (o) return o;
        }
      }
    }
    this.problems.push(`no room for ${desc.objType} near ${tx},${ty}`);
    return null;
  }

  // Furniture and props. With a footprint, (tx, ty) are ignored.
  decor(objType, tx, ty, extra = {}) {
    const pos = extra.footprint ? {} : { tx, ty };
    return this.must({ objType, ...pos, solid: true, low: true, ...extra });
  }

  look(objType, tx, ty, key, extra = {}) {
    const L = LOOKS[key] || {};
    return this.decor(objType, tx, ty, { text: L.text, label: L.label, heal: L.heal || 0, ...extra });
  }

  fenceLine(x0, y0, x1, y1, gaps = []) {
    const skip = new Set(gaps.map(([x, y]) => `${x},${y}`));
    const pts = [];
    for (let x = x0; x <= x1; x++) pts.push([x, y0], [x, y1]);
    for (let y = y0 + 1; y < y1; y++) pts.push([x0, y], [x1, y]);
    for (const [x, y] of pts) {
      if (skip.has(`${x},${y}`)) continue;
      const f = this.must({ objType: 'fence', tx: x, ty: y, solid: true, low: true, name: 'Fence' });
      if (f) this.fences.push(f);
    }
    this.keep(x0 - 1, y0 - 1, x1 - x0 + 3, y1 - y0 + 3);
  }

  // ---------- build ----------

  build() {
    this.terrain();
    this.water();
    this.quarryTerrain();
    this.roads();
    this.village();
    this.farm();
    this.quarry();
    this.camp();
    this.ruins();
    this.lakeShore();
    this.forestLandmarks();
    this.scatter();
    this.decorate();
    this.finishFences();
    this.makeLocations();
    this.makeSpawns();
  }

  forestDepth(x, y) {
    let south = 35 + (this.noise(x, 0, 0.07, 1, 2) - 0.5) * 9;
    if (x > 56 && x < 106) south = Math.min(south, 34.5); // never creep into the village
    const west = 31 + (this.noise(0, y, 0.09, 2, 2) - 0.5) * 8;
    const east = 118 + (this.noise(0, y, 0.09, 3, 2) - 0.5) * 8;
    return Math.min(south - y, x - west, east - x);
  }

  terrain() {
    const m = this.map;
    m.ground.fill(T.GRASS);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const d = this.forestDepth(x, y);
        this.forestD[i] = d;
        if (d > 2.4 + (this.noise(x, y, 0.3, 11) - 0.5) * 2.5) m.ground[i] = T.FOREST;
        else if (d > -2 && d < 2.6 && this.noise(x, y, 0.22, 12) > 0.5) m.ground[i] = T.TALL_GRASS;
        else if (x > 48 && x < 126 && y > 87 && this.noise(x, y, 0.12, 21) > 0.55) m.ground[i] = T.TALL_GRASS;
        else if (d <= 0 && this.noise(x, y, 0.1, 23) > 0.7) m.ground[i] = T.TALL_GRASS;
      }
    }
    // The north edge of the world is old forest too.
    for (let y = 0; y < 3; y++) for (let x = 0; x < W; x++) if (this.forestD[y * W + x] > 0) this.set(x, y, T.FOREST);
  }

  water() {
    const L = this.lake;
    this.ellipse(L.cx, L.cy, L.rx + 2, L.ry + 2, (x, y) => {
      const dx = (x + 0.5 - L.cx) / L.rx;
      const dy = (y + 0.5 - L.cy) / L.ry;
      const edge = 1 + (this.noise(x, y, 0.18, 31) - 0.5) * 0.32;
      if (Math.hypot(dx, dy) < edge) this.set(x, y, T.WATER);
    });
    // The stream: out of the lake's south shore, south to the edge of the world.
    this.streamPts = [
      [133.5, 60],
      [131.5, 69],
      [133.5, 76],
      [131, 84],
      [128.5, 92],
      [131.5, 101],
      [129.5, 110],
      [131, 120],
    ];
    this.stroke(this.streamPts, 2.9, (x, y) => this.set(x, y, T.WATER));
    // A little village pond.
    this.ellipse(62.5, 77.5, 3.4, 2.3, (x, y, r) => {
      if (r < 1 + (this.noise(x, y, 0.5, 33) - 0.5) * 0.3) this.set(x, y, T.WATER);
    });
    // Beaches: sand on the lake's western shore and sandbars along the stream.
    for (let y = 34; y < 70; y++) {
      for (let x = 110; x < 158; x++) {
        if (!this.inb(x, y) || WATERY[this.get(x, y)]) continue;
        let near = 9;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (this.map.isWater(x + dx, y + dy)) near = Math.min(near, Math.max(Math.abs(dx), Math.abs(dy)));
        if (near <= 2 && (x < 132 || this.noise(x, y, 0.3, 34) > 0.55)) this.set(x, y, T.SAND);
      }
    }
    for (let y = 66; y < H; y++) {
      for (let x = 122; x < 140; x++) {
        if (WATERY[this.get(x, y)]) continue;
        let adj = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (this.map.isWater(x + dx, y + dy)) adj = true;
        if (adj && this.noise(x, y, 0.4, 35) > 0.6) this.set(x, y, T.SAND);
      }
    }
    // Deep water away from the shore.
    const depth = this.map.waterDepth();
    for (let i = 0; i < W * H; i++) if (this.map.ground[i] === T.WATER && depth[i] >= 3) this.map.ground[i] = T.DEEP_WATER;
    this.map.version++;
    this.map._depth = null;
    // Keep scattered trees off the shores.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (this.map.isWater(x, y)) this.keep(x - 1, y - 1, 3, 3);
  }

  quarryTerrain() {
    const cx = 16;
    const cy = 15;
    this.ellipse(cx, cy, 15, 14, (x, y) => {
      const dx = (x + 0.5 - cx) / 11;
      const dy = (y + 0.5 - cy) / 10;
      const r = Math.hypot(dx, dy);
      const edge = 1 + (this.noise(x, y, 0.25, 41) - 0.5) * 0.28;
      if (r < edge) this.set(x, y, T.GRAVEL);
      else if (r < edge + 0.3) this.set(x, y, T.ROCK);
      else if (r < edge + 0.45 && this.noise(x, y, 0.4, 42) > 0.5) this.set(x, y, T.ROCK);
    });
    // The mouth of the pit, opening south-east toward the trail.
    this.stroke(
      [
        [20, 21],
        [24.5, 27],
        [26, 32],
      ],
      3.2,
      (x, y) => {
        const g = this.get(x, y);
        if (g === T.ROCK || g === T.GRAVEL) this.set(x, y, T.GRAVEL);
      },
    );
    // Outcrops inside the pit.
    for (const [ox, oy, r] of [
      [9.5, 10, 1.4],
      [21.5, 8.5, 1.2],
      [11, 20.5, 1.1],
    ]) {
      this.ellipse(ox, oy, r, r * 0.9, (x, y, rr) => {
        if (rr < 1) this.set(x, y, T.ROCK);
      });
    }
    this.keep(4, 4, 25, 24);
  }

  roads() {
    // The King's Road: the old highway, straight across the vale.
    for (let x = 0; x < W; x++) {
      for (let y = KINGS_ROAD_Y; y < KINGS_ROAD_Y + 3; y++) if (!WATERY[this.get(x, y)]) this.set(x, y, T.DIRT);
    }
    this.keep(0, KINGS_ROAD_Y - 1, W, 5);
    // The bridge over the stream, with a plank on each bank.
    for (let y = KINGS_ROAD_Y; y < KINGS_ROAD_Y + 3; y++) {
      let x0 = Infinity;
      let x1 = -Infinity;
      for (let x = 118; x < 145; x++) {
        if (WATERY[this.get(x, y)]) {
          this.set(x, y, T.BRIDGE);
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
        }
      }
      if (x0 < Infinity) {
        this.set(x0 - 1, y, T.BRIDGE);
        this.set(x1 + 1, y, T.BRIDGE);
      }
    }
    // Forest road from the village's north gate to the heart of Whisperwood.
    this.path(
      [
        [80, 38],
        [79, 31],
        [76.5, 23],
        [74.5, 17],
      ],
      2.6,
    );
    // West trail to Moonpetal Glade.
    this.path(
      [
        [77.5, 27],
        [67, 25],
        [58, 20.5],
        [53, 16.5],
      ],
      2,
    );
    // East trail to Berry Hollow and on to the lake's north shore.
    this.path(
      [
        [79.5, 31],
        [90, 29],
        [99, 23.5],
        [101, 20.5],
      ],
      2,
    );
    this.path(
      [
        [101, 21],
        [108, 27],
        [113, 33],
        [116, 37],
      ],
      2,
    );
    // Lake road from the village's east street to the dock.
    this.path(
      [
        [109, 60],
        [113, 57.5],
        [116, 53],
      ],
      2.6,
    );
    // Shore trail north to the bandit camp gate.
    this.path(
      [
        [115.5, 48],
        [114.5, 41],
        [117, 36],
        [124, 32.5],
        [131, 30.5],
        [133.5, 28.5],
      ],
      2,
    );
    // Quarry trail from the farmyard.
    this.path(
      [
        [30.5, 57],
        [30.5, 47],
        [27.5, 38],
        [25.5, 31],
        [23.5, 27],
      ],
      2,
    );
    // Farm lane south to the King's Road.
    this.path(
      [
        [18.5, 57],
        [18.5, 70],
        [18, 83],
      ],
      2,
    );
    // Path down to the ruins gate.
    this.path(
      [
        [24.5, 86],
        [24.5, 91],
      ],
      3,
    );
    // Meadow path.
    this.path(
      [
        [80.5, 86],
        [82, 95],
        [90, 103],
        [101, 106],
      ],
      2,
    );
  }

  // A building: walls with a two-row front face, a door in the bottom row, windows,
  // a roof, and a floor. Interior furniture is placed by the caller.
  building(spec) {
    const { id, x, y, w, h, door } = spec;
    const floor = spec.floor ?? T.FLOOR;
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) {
        const edge = j === y || i === x || i === x + w - 1 || j >= y + h - 2;
        this.set(i, j, edge ? T.WALL : floor);
      }
    }
    this.set(door, y + h - 1, floor);
    this.set(door, y + h - 2, floor);
    const lift = spec.roof?.lift ?? 1;
    this.keep(x - 2, y - lift - 1, w + 4, h + lift + 3);
    const b = this.map.addBuilding({
      id,
      name: LOCATION_INFO[id]?.name ?? spec.name ?? id,
      x,
      y,
      w,
      h,
      doorTiles: [{ tx: door, ty: y + h - 1 }],
      material: spec.material ?? 'timber',
      roof: { style: 'red', lift, chimneys: [], ...(spec.roof || {}) },
      rug: spec.rug ?? 'red',
      smoky: !!spec.smoky,
      interior: { x: x + 1, y: y + 1, w: w - 2, h: h - 3 },
    });
    this.must({ objType: 'door', id: `door_${id}`, tx: door, ty: y + h - 1, building: id, name: `${b.name} door` }, { allowSolidGround: true });
    // Windows on the front face, either side of the door.
    for (const off of [-2, 2, -5, 5, -8, 8]) {
      const c = door + off;
      if (c <= x || c >= x + w - 1) continue;
      if (spec.noWindow?.includes(c)) continue;
      this.must({ objType: 'window', tx: c, ty: y + h - 1, variant: spec.windowStyle ?? null, name: 'Window' }, { allowSolidGround: true });
    }
    if (spec.sign) {
      const s = SIGNS[spec.sign];
      const c = door + (spec.signSide ?? 1);
      this.must({ objType: 'sign', id: `sign_${id}`, tx: c, ty: y + h - 1, variant: 'hanging', title: s.title, text: s.text, name: s.title, solid: false }, { allowSolidGround: true });
    }
    return b;
  }

  rug(x, y, w, h) {
    this.fill(x, y, w, h, T.RUG);
  }

  village() {
    // Clear the village grounds.
    for (let y = 36; y <= 82; y++) for (let x = 44; x <= 110; x++) if (!WATERY[this.get(x, y)]) this.set(x, y, T.GRASS);
    this.keep(44, 36, 67, 47);
    // Streets.
    this.fill(70, 54, 20, 13, T.COBBLE); // town square
    this.fill(78, 36, 4, 47, T.COBBLE); // north-south street, gate to the King's Road
    this.fill(44, 59, 67, 3, T.COBBLE); // main east-west street
    this.fill(50, 71, 57, 2, T.COBBLE); // lower lane
    this.fill(84, 73, 2, 10, T.COBBLE); // lane down to the King's Road
    // The pond survives the clearing above (water was skipped).

    // --- The Ember Kettle (inn) ---
    this.building({ id: 'ember_kettle', x: 64, y: 43, w: 13, h: 11, door: 70, material: 'timber', roof: { style: 'red', chimneys: [66, 74] }, sign: 'inn', smoky: true });
    this.must({ objType: 'hearth', id: 'inn_hearth', footprint: { x: 66, y: 44, w: 2, h: 1 }, name: 'Inn hearth' });
    this.rug(65, 45, 4, 2);
    for (let c = 71; c <= 74; c++) this.decor('counter', c, 47, { variant: c === 71 ? 'left' : c === 74 ? 'right' : 'mid', name: 'Bar counter' });
    for (const c of [71, 72, 73, 74, 75]) this.look('shelf', c, 44, 'innShelf', { variant: c % 2 ? 'bottles' : 'barrels' });
    this.decor('table', 0, 0, { footprint: { x: 66, y: 49, w: 2, h: 1 }, solid: true });
    this.decor('chair', 65, 49, { variant: 'right' });
    this.decor('chair', 68, 49, { variant: 'left' });
    this.decor('table', 0, 0, { footprint: { x: 72, y: 50, w: 2, h: 1 } });
    this.decor('chair', 71, 50, { variant: 'right' });
    this.decor('chair', 74, 50, { variant: 'left' });
    this.decor('table', 0, 0, { footprint: { x: 66, y: 51, w: 2, h: 1 } });
    this.decor('barrel', 75, 51);
    this.decor('barrel', 75, 50);
    this.decor('crate', 65, 51);

    // --- Chapel of the Hearth ---
    this.building({
      id: 'chapel',
      x: 83,
      y: 42,
      w: 11,
      h: 12,
      door: 88,
      material: 'stone',
      floor: T.STONE_FLOOR,
      roof: { style: 'blue', chimneys: [], belfry: true },
      windowStyle: 'stained',
      sign: 'chapel',
      signSide: -1,
      rug: 'blue',
    });
    this.rug(88, 44, 1, 8);
    this.look('altar', 0, 0, 'altar', { footprint: { x: 87, y: 43, w: 3, h: 1 }, name: 'Altar' });
    this.must({ objType: 'lamp', tx: 85, ty: 43, kind: 'candles', name: 'Candle stand', solid: true });
    this.must({ objType: 'lamp', tx: 91, ty: 43, kind: 'candles', name: 'Candle stand', solid: true });
    this.look('shelf', 84, 43, 'chapelShelf', { variant: 'books' });
    this.look('shelf', 92, 43, 'chapelShelf', { variant: 'books' });
    for (const row of [46, 48, 50]) {
      this.decor('pew', 0, 0, { footprint: { x: 84, y: row, w: 3, h: 1 }, name: 'Pew' });
      this.decor('pew', 0, 0, { footprint: { x: 90, y: row, w: 3, h: 1 }, name: 'Pew' });
    }

    // --- Gale's Goods (general store) ---
    this.building({ id: 'general_store', x: 54, y: 51, w: 9, h: 8, door: 58, roof: { style: 'blue', chimneys: [60] }, sign: 'store' });
    for (const c of [55, 56, 60, 61]) this.look('shelf', c, 52, 'storeShelf', { variant: c < 58 ? 'goods' : 'bottles' });
    for (let c = 55; c <= 57; c++) this.decor('counter', c, 54, { variant: c === 55 ? 'left' : c === 57 ? 'right' : 'mid', name: 'Shop counter' });
    this.decor('crate', 61, 55);
    this.decor('crate', 61, 56);
    this.decor('barrel', 60, 56);
    this.decor('sack', 55, 56);

    // --- Fennick's Herbs ---
    this.building({ id: 'herbalist', x: 45, y: 51, w: 8, h: 8, door: 48, roof: { style: 'moss', chimneys: [50] }, sign: 'herbalist', windowStyle: 'flowers' });
    this.look('cauldron', 50, 53, 'cauldron');
    this.look('shelf', 46, 52, 'potionShelf', { variant: 'potions' });
    this.look('shelf', 47, 52, 'potionShelf', { variant: 'herbs' });
    this.look('shelf', 51, 52, 'potionShelf', { variant: 'potions' });
    this.decor('table', 0, 0, { footprint: { x: 46, y: 55, w: 2, h: 1 }, variant: 'herbs' });
    this.decor('pot', 51, 56, { variant: 'plant' });
    this.decor('pot', 46, 56, { variant: 'plant' });
    // Mira's herb garden behind the shop.
    this.fenceLine(45, 44, 52, 48, [[45, 46]]);
    for (let yy = 45; yy <= 47; yy++) for (let xx = 46; xx <= 51; xx++) this.set(xx, yy, T.FARMLAND);
    for (const [hx, hy] of [
      [46, 45],
      [48, 45],
      [50, 45],
      [47, 47],
      [49, 47],
      [51, 47],
    ])
      this.must({ objType: 'herb', tx: hx, ty: hy, name: 'Silverleaf' });

    // --- Guardhouse ---
    this.building({
      id: 'guardhouse',
      x: 56,
      y: 63,
      w: 10,
      h: 8,
      door: 60,
      material: 'stone',
      floor: T.STONE_FLOOR,
      roof: { style: 'slate', chimneys: [63] },
      sign: 'guardhouse',
    });
    this.decor('rack', 57, 64, { name: 'Weapon rack' });
    this.decor('rack', 58, 64, { name: 'Weapon rack' });
    this.decor('bunk', 0, 0, { footprint: { x: 63, y: 64, w: 1, h: 2 }, name: 'Cot' });
    this.decor('bunk', 0, 0, { footprint: { x: 64, y: 64, w: 1, h: 2 }, name: 'Cot' });
    this.look('table', 0, 0, 'mapTable', { footprint: { x: 60, y: 66, w: 2, h: 1 }, variant: 'map' });
    this.decor('barrel', 57, 68);
    this.decor('crate', 64, 68);
    this.look('dummy', 67, 67, 'dummy', { name: 'Training dummy' });
    this.decor('banner', 66, 63, { name: 'Guard banner' });

    // --- Ironhand Smithy ---
    this.building({
      id: 'smithy',
      x: 95,
      y: 51,
      w: 10,
      h: 8,
      door: 99,
      material: 'stone',
      floor: T.STONE_FLOOR,
      roof: { style: 'red', chimneys: [102] },
      sign: 'smithy',
      smoky: true,
    });
    this.look('forge', 0, 0, 'forge', { footprint: { x: 101, y: 52, w: 2, h: 1 }, name: 'Forge' });
    this.look('anvil', 100, 54, 'anvil', { name: 'Anvil' });
    this.decor('barrel', 103, 54, { variant: 'water', name: 'Quench barrel' });
    this.decor('rack', 96, 52, { name: 'Weapon rack', variant: 'tools' });
    this.decor('rack', 97, 52, { name: 'Weapon rack' });
    this.decor('crate', 96, 56);
    this.decor('table', 0, 0, { footprint: { x: 102, y: 56, w: 2, h: 1 }, variant: 'tools', name: 'Workbench' });
    this.decor('woodpile', 105, 57, { name: 'Woodpile' });
    this.decor('barrel', 94, 57);

    // --- Your cottage ---
    this.building({ id: 'player_home', x: 92, y: 74, w: 9, h: 9, door: 96, roof: { style: 'thatch', chimneys: [98] }, windowStyle: 'flowers' });
    this.must({ objType: 'bed', id: 'home_bed', footprint: { x: 93, y: 75, w: 1, h: 2 }, owner: 'player', name: 'Your bed', sleepSide: 'right' });
    this.must({ objType: 'bed', id: 'lyra_bed', footprint: { x: 99, y: 75, w: 1, h: 2 }, owner: 'lyra', name: "Lyra's bed", sleepSide: 'left' });
    this.must({ objType: 'chest', id: 'home_chest', tx: 94, ty: 75, owner: 'player', name: 'Home chest', items: { bread: 2, potion: 1, coin: 10 }, words: ['home chest', 'our chest', 'my chest', 'storage'] });
    this.must({ objType: 'hearth', id: 'home_hearth', footprint: { x: 96, y: 75, w: 2, h: 1 }, name: 'Cottage hearth' });
    this.look('shelf', 98, 75, 'homeShelf', { variant: 'books' });
    this.rug(94, 77, 5, 3);
    this.decor('table', 0, 0, { footprint: { x: 95, y: 78, w: 2, h: 1 }, name: 'Table', words: ['table', 'kitchen table'] });
    this.decor('chair', 94, 78, { variant: 'right' });
    this.decor('chair', 97, 78, { variant: 'left' });
    this.decor('pot', 93, 80, { variant: 'plant' });
    this.decor('barrel', 99, 80);
    this.decor('woodpile', 101, 81, { name: 'Woodpile' });
    this.decor('barrel', 91, 81);

    // --- Square ---
    this.look('well', 0, 0, 'well', { footprint: { x: 79, y: 59, w: 2, h: 2 }, name: 'Old well', low: false, interactReach: 8, shadow: { dx: 1, dy: -2, rx: 14, ry: 5 } });
    this.must({ objType: 'sign', id: 'notice_board', tx: 83, ty: 57, variant: 'board', title: NOTICE_BOARD.title, text: NOTICE_BOARD.text, name: 'Notice board', solid: true, shadow: { dx: 1, dy: -1, rx: 9, ry: 3 } });
    this.look('bench', 0, 0, 'bench', { footprint: { x: 74, y: 63, w: 2, h: 1 } });
    this.look('bench', 0, 0, 'bench', { footprint: { x: 85, y: 63, w: 2, h: 1 } });
    this.decor('stall', 0, 0, { footprint: { x: 72, y: 57, w: 2, h: 1 }, variant: 'red', name: 'Market stall' });
    this.decor('stall', 0, 0, { footprint: { x: 85, y: 60, w: 2, h: 1 }, variant: 'blue', name: 'Market stall' });
    for (const [fx, fy, fw] of [
      [71, 55, 3],
      [84, 55, 3],
      [71, 65, 3],
      [86, 65, 3],
    ])
      this.fill(fx, fy, fw, 1, T.FLOWERBED);
    for (const [lx, ly] of [
      [74, 54],
      [89, 54],
      [70, 66],
      [89, 66],
      [77, 37],
      [82, 37],
      [66, 58],
      [52, 62],
      [93, 62],
      [107, 58],
      [75, 70],
      [90, 70],
      [55, 73],
      [83, 81],
      [102, 82],
    ])
      this.must({ objType: 'lamp', tx: lx, ty: ly, name: 'Street lamp' });
    this.must({ objType: 'sign', id: 'sign_welcome', tx: 77, ty: 81, title: SIGNS.welcome.title, text: SIGNS.welcome.text, name: 'Village sign' });
    this.must({ objType: 'sign', id: 'sign_crossroads', tx: 82, ty: 86, title: SIGNS.crossroads.title, text: SIGNS.crossroads.text, name: 'Signpost', variant: 'post' });
    this.must({ objType: 'sign', id: 'sign_forest', tx: 83, ty: 36, title: SIGNS.forest.title, text: SIGNS.forest.text, name: 'Forest sign' });

    // Chicken run, west of the guardhouse.
    this.fenceLine(46, 63, 54, 69, [[50, 63]]);
    this.decor('hay', 47, 64, { name: 'Hay bale' });
    this.decor('coop', 0, 0, { footprint: { x: 52, y: 64, w: 2, h: 1 }, name: 'Chicken coop' });
    for (let yy = 64; yy <= 68; yy++) for (let xx = 47; xx <= 53; xx++) if (this.get(xx, yy) === T.GRASS && this.hash(xx, yy, 5) < 0.5) this.set(xx, yy, T.DIRT);

    // Community garden east of the square.
    this.fenceLine(92, 63, 104, 69, [[98, 63]]);
    for (let yy = 64; yy <= 68; yy++) for (let xx = 93; xx <= 103; xx++) this.set(xx, yy, yy === 66 ? T.DIRT : xx % 4 === 0 ? T.FLOWERBED : T.FARMLAND);
    this.decor('scarecrow', 103, 66, { name: 'Little scarecrow', text: 'A little scarecrow made of sticks and a moth-eaten scarf. Pip has given it a name, and it is "Sir Turnip".', label: 'Look' });

    // Your own vegetable patch beside the cottage.
    this.fenceLine(86, 75, 90, 80, [[88, 75]]);
    for (let yy = 76; yy <= 79; yy++) for (let xx = 87; xx <= 89; xx++) this.set(xx, yy, T.FARMLAND);

    // Village green: the old oak, the pond, flower beds.
    this.must({ objType: 'tree', tx: 71, ty: 78, kind: 'oak', v: 0 });
    this.look('bench', 0, 0, 'bench', { footprint: { x: 68, y: 80, w: 2, h: 1 } });
    this.fill(57, 75, 2, 1, T.FLOWERBED);
    this.fill(67, 76, 1, 2, T.FLOWERBED);
    this.fill(74, 74, 3, 1, T.FLOWERBED);
    // Chapel garden: a few old trees and a bench.
    for (const [tx, ty, v] of [
      [97, 41, 1],
      [102, 43, 2],
      [106, 40, 0],
      [108, 47, 1],
    ])
      this.must({ objType: 'tree', tx, ty, kind: 'oak', v });
    this.look('bench', 0, 0, 'bench', { footprint: { x: 99, y: 46, w: 2, h: 1 } });
    for (const [tx, ty] of [
      [47, 39],
      [58, 40],
      [62, 38],
      [46, 76],
      [52, 80],
      [107, 75],
      [109, 69],
    ])
      this.put({ objType: 'tree', tx, ty, kind: 'oak', v: (tx + ty) % 3 });
  }

  farm() {
    for (let y = 44; y <= 80; y++) for (let x = 14; x <= 43; x++) {
      const g = this.get(x, y);
      if (g === T.TALL_GRASS || g === T.FOREST) this.set(x, y, T.GRASS);
    }
    this.keep(14, 44, 31, 37);
    this.building({ id: 'farmhouse', x: 20, y: 48, w: 9, h: 8, door: 24, material: 'log', roof: { style: 'moss', chimneys: [22] } });
    this.must({ objType: 'hearth', id: 'farm_hearth', footprint: { x: 21, y: 49, w: 2, h: 1 }, name: 'Farmhouse hearth' });
    this.decor('bunk', 0, 0, { footprint: { x: 27, y: 49, w: 1, h: 2 }, name: "Tobias's bed" });
    this.decor('shelf', 25, 49, { variant: 'goods' });
    this.decor('table', 0, 0, { footprint: { x: 24, y: 51, w: 2, h: 1 } });
    this.decor('chair', 23, 51, { variant: 'right' });
    this.decor('barrel', 21, 53);
    this.decor('crate', 27, 53, { variant: 'turnips', name: 'Crate of turnips' });
    this.decor('sack', 26, 53);
    // Farmyard.
    for (let y = 56; y <= 58; y++) for (let x = 21; x <= 31; x++) if (this.hash(x, y, 9) < 0.8) this.set(x, y, T.DIRT);
    this.fill(30, 59, 14, 3, T.DIRT); // farm road east to the village street
    this.decor('hay', 19, 57, { name: 'Hay bale' });
    this.decor('hay', 20, 58, { name: 'Hay bale' });
    this.decor('cart', 0, 0, { footprint: { x: 25, y: 59, w: 2, h: 1 }, name: 'Farm cart' });
    this.decor('woodpile', 29, 54, { name: 'Woodpile' });
    this.decor('barrel', 19, 55);
    this.must({ objType: 'sign', id: 'sign_farm', tx: 33, ty: 58, title: SIGNS.farm.title, text: SIGNS.farm.text, name: 'Farm sign' });
    // The field.
    this.fenceLine(29, 62, 44, 77, [
      [36, 62],
      [37, 62],
    ]);
    for (let y = 63; y <= 76; y++) for (let x = 30; x <= 43; x++) this.set(x, y, T.FARMLAND);
    for (let y = 63; y <= 75; y += 2) {
      for (let x = 31; x <= 42; x++) {
        const kind = y <= 69 ? 'turnip' : 'wheat';
        const r = this.rng.next();
        const stage = r < 0.7 ? 3 : r < 0.85 ? 2 : 1;
        this.put({ objType: 'crop', tx: x, ty: y, kind, stage, offset: Math.floor(this.rng.next() * 120) });
      }
    }
    this.look('scarecrow', 37, 70, 'scarecrow', { name: 'Scarecrow' });
  }

  quarry() {
    this.must({ objType: 'sign', id: 'sign_quarry', tx: 28, ty: 30, title: SIGNS.quarry.title, text: SIGNS.quarry.text, name: 'Quarry sign' });
    this.near({ objType: 'lamp', name: 'Quarry lantern' }, 27, 28);
    this.near({ objType: 'crate', solid: true, low: true }, 21, 22);
    this.near({ objType: 'crate', solid: true, low: true }, 22, 21);
    this.near({ objType: 'cart', solid: true, low: true, footprint: { x: 18, y: 24, w: 2, h: 1 }, variant: 'ore', name: 'Ore cart' }, 0, 0);
    this.near({ objType: 'woodpile', name: 'Pit props', solid: true, low: true }, 24, 20);
    const rocks = [
      [7, 13],
      [13, 7],
      [19, 12],
      [8, 18],
      [15, 21],
      [23, 15],
      [17, 5],
      [6, 9],
      [14, 14],
      [21, 19],
      [10, 23],
    ];
    rocks.forEach(([x, y], k) => this.put({ objType: 'rock', tx: x, ty: y, v: k % 3 }));
    for (const [x, y] of [
      [5, 12],
      [12, 5],
      [24, 11],
      [9, 21],
      [20, 7],
      [6, 16],
    ])
      this.put({ objType: 'ore', tx: x, ty: y, v: 0 });
  }

  camp() {
    // Clear the camp grounds.
    for (let y = 3; y <= 29; y++) for (let x = 124; x <= 156; x++) if (!WATERY[this.get(x, y)]) this.set(x, y, this.noise(x, y, 0.3, 51) > 0.62 ? T.GRASS : T.DIRT);
    const x0 = 127;
    const y0 = 5;
    const x1 = 153;
    const y1 = 27;
    const cut = 3;
    // Palisade ring with chamfered corners (4-connected so nothing slips through).
    const wall = (x, y) => this.set(x, y, T.PALISADE);
    for (let x = x0 + cut; x <= x1 - cut; x++) {
      wall(x, y0);
      if (x < 132 || x > 134) wall(x, y1); // the gate gap
    }
    for (let y = y0 + cut; y <= y1 - cut; y++) {
      wall(x0, y);
      wall(x1, y);
    }
    for (let k = 0; k < cut; k++) {
      wall(x0 + k, y0 + cut - k);
      wall(x0 + k + 1, y0 + cut - k);
      wall(x1 - k, y0 + cut - k);
      wall(x1 - k - 1, y0 + cut - k);
      wall(x0 + k, y1 - cut + k);
      wall(x0 + k + 1, y1 - cut + k);
      wall(x1 - k, y1 - cut + k);
      wall(x1 - k - 1, y1 - cut + k);
    }
    // Outside the ring stays grass.
    for (let y = 3; y <= 29; y++)
      for (let x = 124; x <= 156; x++) {
        const inside = this.campInside(x, y);
        if (!inside && this.get(x, y) === T.DIRT) this.set(x, y, T.GRASS);
      }
    for (let y = 28; y <= 29; y++) for (let x = 131; x <= 135; x++) this.set(x, y, T.DIRT);
    this.keep(124, 3, 33, 28);
    this.decor('tent', 0, 0, { footprint: { x: 138, y: 6, w: 5, h: 3 }, variant: 'chief', name: "Chief's tent", shadow: { dx: 2, dy: -3, rx: 22, ry: 6 } });
    this.decor('tent', 0, 0, { footprint: { x: 130, y: 9, w: 3, h: 2 }, variant: 'brown', name: 'Tent', shadow: { dx: 2, dy: -2, rx: 14, ry: 5 } });
    this.decor('tent', 0, 0, { footprint: { x: 146, y: 9, w: 3, h: 2 }, variant: 'red', name: 'Tent', shadow: { dx: 2, dy: -2, rx: 14, ry: 5 } });
    this.decor('tent', 0, 0, { footprint: { x: 130, y: 19, w: 3, h: 2 }, variant: 'red', name: 'Tent', shadow: { dx: 2, dy: -2, rx: 14, ry: 5 } });
    this.decor('tent', 0, 0, { footprint: { x: 147, y: 18, w: 3, h: 2 }, variant: 'brown', name: 'Tent', shadow: { dx: 2, dy: -2, rx: 14, ry: 5 } });
    this.must({ objType: 'campfire', id: 'camp_campfire', tx: 140, ty: 16, name: 'Bandit campfire' });
    this.decor('log', 0, 0, { footprint: { x: 139, y: 18, w: 2, h: 1 }, name: 'Log seat' });
    this.decor('log', 0, 0, { footprint: { x: 139, y: 14, w: 2, h: 1 }, name: 'Log seat' });
    this.must({
      objType: 'chest',
      id: 'bandit_chest',
      tx: 144,
      ty: 8,
      name: 'Bandit chest',
      loot: true,
      variant: 'iron',
      items: { ruins_key: 1, coin: 25, potion: 1 },
      words: ['bandit chest', 'loot', 'stolen goods'],
    });
    this.decor('rack', 135, 7, { name: 'Weapon rack' });
    this.decor('rack', 136, 7, { name: 'Weapon rack' });
    for (const [x, y] of [
      [149, 23],
      [150, 23],
      [151, 22],
      [150, 24],
    ])
      this.look('crate', x, y, 'stolen', { name: 'Stolen crate', variant: 'stamped' });
    this.decor('barrel', 151, 24);
    this.decor('barrel', 129, 14);
    this.decor('barrel', 129, 15);
    this.decor('brazier', 131, 25, { name: 'Brazier' });
    this.decor('brazier', 135, 25, { name: 'Brazier' });
    this.decor('woodpile', 150, 14, { name: 'Firewood' });
    this.must({ objType: 'sign', id: 'sign_camp', tx: 137, ty: 29, title: SIGNS.camp.title, text: SIGNS.camp.text, name: 'Crude sign' });
  }

  campInside(x, y) {
    const x0 = 127;
    const y0 = 5;
    const x1 = 153;
    const y1 = 27;
    if (x <= x0 || x >= x1 || y <= y0 || y >= y1) return false;
    const cx = Math.min(x - x0, x1 - x);
    const cy = Math.min(y - y0, y1 - y);
    return cx + cy > 3;
  }

  ruins() {
    const ox = 4;
    const oy = 91;
    const PW = 40;
    const PH = 24;
    this.ruinsRect = { x: ox, y: oy, w: PW, h: PH };
    for (let y = oy - 1; y <= oy + PH; y++) for (let x = ox - 1; x <= ox + PW; x++) if (this.inb(x, y)) this.set(x, y, T.GRASS);
    this.fill(ox, oy, PW, PH, T.RUIN_WALL);
    this.keep(ox - 1, oy - 1, PW + 2, PH + 2);
    const carve = (x, y, w, h, t = T.RUIN_FLOOR) => this.fill(ox + x, oy + y, w, h, t);
    const rooms = {
      courtyard: [14, 1, 13, 6],
      westA: [1, 1, 12, 6],
      westB: [1, 8, 12, 6],
      crypt: [1, 15, 12, 8],
      hall: [14, 8, 13, 10],
      grotto: [28, 1, 11, 8],
      eastB: [28, 10, 11, 6],
      corridor: [14, 19, 13, 4],
      sanctum: [28, 17, 11, 6],
    };
    for (const r of Object.values(rooms)) carve(...r);
    for (const [x, y, w = 1, h = 1] of [
      [13, 4],
      [6, 7],
      [4, 14],
      [13, 21],
      [27, 20],
      [19, 7, 3, 1],
      [27, 3],
      [33, 9],
    ])
      carve(x, y, w, h);
    // Flooded pools.
    carve(17, 11, 7, 4, T.WATER);
    carve(32, 3, 4, 3, T.WATER);
    // Overgrowth and collapse: grass creeps over the floors, some walls are heaps of rubble.
    for (let y = oy; y < oy + PH; y++) {
      for (let x = ox; x < ox + PW; x++) {
        const g = this.get(x, y);
        const n = this.noise(x, y, 0.25, 61);
        if (g === T.RUIN_FLOOR && n > 0.6) this.set(x, y, T.GRASS);
        else if (g === T.RUIN_WALL && this.hash(x, y, 62) < 0.16 && !(y === oy && Math.abs(x - (ox + 20)) <= 1)) this.set(x, y, T.RUBBLE);
      }
    }
    // The gate.
    const gx = ox + 20;
    const gy = oy;
    this.set(gx, gy, T.RUIN_FLOOR);
    this.set(gx - 1, gy, T.RUIN_WALL);
    this.set(gx + 1, gy, T.RUIN_WALL);
    this.must({ objType: 'door', id: 'ruins_gate', tx: gx, ty: gy, gate: true, locked: true, keyId: 'ruins_key', name: 'Ruins gate', autoClose: false, words: ['ruins gate', 'gate'] });
    this.decor('ruin_pillar', gx - 2, gy - 1, { name: 'Gate pillar', variant: 'whole', low: false });
    this.decor('ruin_pillar', gx + 2, gy - 1, { name: 'Gate pillar', variant: 'whole', low: false });
    this.must({ objType: 'sign', id: 'sign_ruins', tx: gx + 4, ty: gy - 3, title: SIGNS.ruins.title, text: SIGNS.ruins.text, name: 'Warning sign' });
    const P = (x, y, broken) => this.decor('ruin_pillar', ox + x, oy + y, { name: broken ? 'Broken pillar' : 'Pillar', variant: broken ? 'broken' : 'whole', low: false });
    P(16, 2, false);
    P(24, 2, true);
    P(16, 5, true);
    P(24, 5, false);
    for (const y of [9, 12, 15]) {
      P(15, y, y === 12);
      P(25, y, y === 9);
    }
    this.look('statue', ox + 20, oy + 3, 'ruinStatue', { name: 'Weathered statue', low: false });
    for (const [x, y] of [
      [29, 2],
      [37, 2],
      [30, 7],
      [36, 7],
      [34, 7],
      [29, 18],
      [38, 18],
    ])
      this.must({ objType: 'crystal', tx: ox + x, ty: oy + y });
    for (const [x, y] of [
      [2, 17],
      [7, 17],
      [2, 20],
      [7, 20],
    ])
      this.decor('tomb', 0, 0, { footprint: { x: ox + x, y: oy + y, w: 2, h: 1 }, name: 'Stone tomb' });
    this.look('altar', 0, 0, 'sanctumAltar', { footprint: { x: ox + 32, y: oy + 17, w: 3, h: 1 }, variant: 'dark', name: 'Black altar', heal: 0, light: { r: 40, color: '#9a7cff', intensity: 0.55, flicker: 0.15, dy: -12 } });
    this.decor('bedroll', 0, 0, { footprint: { x: ox + 37, y: oy + 21, w: 1, h: 1 }, name: 'Old bedroll', solid: false, text: "A traveler's bedroll, neatly rolled, with a cold lantern beside it. Someone camped here for more than one night.", label: 'Look' });
    this.must({ objType: 'journal', id: 'maren_journal', tx: ox + 36, ty: oy + 21 });
    this.ruinSpawns = [
      [ox + 6, oy + 10],
      [ox + 20, oy + 9],
      [ox + 33, oy + 12],
      [ox + 20, oy + 20],
    ];
    this.ruinsCenter = { x: px(ox + 20), y: px(oy + 5) };
  }

  lakeShore() {
    // The dock juts out from the western shore.
    let shore = -1;
    for (let x = 112; x < 140; x++) {
      if (WATERY[this.get(x, 50)] && WATERY[this.get(x, 51)]) {
        shore = x;
        break;
      }
    }
    if (shore < 0) shore = 119;
    this.dock = { x0: shore - 1, x1: shore + 4, y: 50 };
    for (let x = shore - 1; x <= shore + 4; x++) for (let y = 50; y <= 51; y++) this.set(x, y, T.DOCK);
    this.keep(shore - 3, 48, 9, 6);
    this.must({ objType: 'fishing_spot', id: 'fishing_spot', tx: shore + 4, ty: 51, name: 'Fishing spot' });
    this.must({ objType: 'campfire', id: 'lake_campfire', tx: shore - 4, ty: 46, name: 'Lakeside campfire' });
    this.look('log', 0, 0, 'lakeLog', { footprint: { x: shore - 5, y: 48, w: 2, h: 1 }, name: 'Driftwood log' });
    this.must({ objType: 'sign', id: 'sign_dock', tx: shore - 2, ty: 53, title: SIGNS.dock.title, text: SIGNS.dock.text, name: 'Dock sign' });
    this.decor('barrel', shore - 2, 49);
    this.lakeCenterTile = { x: shore - 2, y: 51 };
  }

  forestLandmarks() {
    // Clearings.
    this.glades = [
      { x: HEART.x, y: HEART.y, r: 4.5 },
      { x: 52.5, y: 15.5, r: 5 },
      { x: 101, y: 19.5, r: 4 },
    ];
    for (const c of this.glades) {
      this.ellipse(c.x, c.y, c.r, c.r * 0.85, (x, y, r) => {
        if (r < 1) {
          this.clear[y * W + x] = 1;
          if (this.get(x, y) === T.FOREST || this.get(x, y) === T.TALL_GRASS) this.set(x, y, r < 0.75 ? T.GRASS : this.get(x, y));
        }
      });
    }
    // The Heart Oak, the oldest tree in Whisperwood.
    this.look('heart_oak', HEART.x, HEART.y - 1, 'heartOak', { name: 'The Heart Oak', low: false, shadow: { dx: 3, dy: -2, rx: 20, ry: 7 }, interactReach: 6 });
    // Moonpetal Glade.
    const g = this.glades[1];
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + 0.3;
      const tx = Math.round(g.x + Math.cos(a) * 3);
      const ty = Math.round(g.y + Math.sin(a) * 2.4);
      this.put({ objType: 'moonpetal', tx, ty });
    }
    this.must({ objType: 'sign', id: 'sign_glade', tx: 56, ty: 19, title: SIGNS.glade.title, text: SIGNS.glade.text, name: 'Carved post', variant: 'post' });
    // Berry Hollow.
    const bh = this.glades[2];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      this.put({ objType: 'berry_bush', tx: Math.round(bh.x + Math.cos(a) * 2.6), ty: Math.round(bh.y + Math.sin(a) * 2.2) });
    }
  }

  canTreeAt(x, y) {
    const i = y * W + x;
    if (this.clear[i] || this.occ[i]) return false;
    const g = this.get(x, y);
    if (g !== T.GRASS && g !== T.FOREST && g !== T.TALL_GRASS) return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (!this.inb(xx, yy)) continue;
      if (this.trunk[yy * W + xx]) return false;
      if (SOLID[this.get(xx, yy)] && !WATERY[this.get(xx, yy)] && (dx === 0 || dy === 0)) return false;
    }
    return true;
  }

  treeDensity(x, y) {
    const d = this.forestD[y * W + x];
    let p = 0.02;
    if (d > 0) {
      p = 0.1 + 0.3 * smooth(0, 7, d);
      const hd = Math.hypot(x - HEART.x, y - HEART.y);
      if (hd < 17) p += 0.22 * (1 - hd / 17);
    } else if (d > -3) p = 0.07;
    const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
    if (edge < 3) p = Math.max(p, 0.55);
    if (x < 35 && y < 36) p = Math.max(p, 0.14); // pines around the quarry
    if (x > 133 && y > 70) p = Math.max(p, 0.05); // the far fields
    if (x > 48 && x < 126 && y > 87) p = Math.min(p, 0.015); // open meadow
    return p;
  }

  scatter() {
    const order = new Int32Array(W * H);
    for (let i = 0; i < order.length; i++) order[i] = i;
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    // Trees.
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      const x = i % W;
      const y = (i / W) | 0;
      const p = this.treeDensity(x, y);
      if (this.rng.next() >= p || !this.canTreeAt(x, y)) continue;
      const d = this.forestD[i];
      const pineBias = (y < 16 ? 0.35 : 0) + (x < 35 && y < 36 ? 0.5 : 0) + (this.noise(x, y, 0.08, 71) - 0.5) * 0.9 + (Math.min(x, y, W - 1 - x) < 3 ? 0.2 : 0);
      const kind = pineBias > 0.25 ? 'pine' : 'oak';
      const o = this.put({ objType: 'tree', tx: x, ty: y, kind, v: Math.floor(this.hash(x, y, 72) * (kind === 'pine' ? 2 : 3)) });
      if (o) this.trunk[i] = 1;
      void d;
    }
    // Undergrowth along the forest edge.
    for (let k = 0; k < order.length; k += 3) {
      const i = order[k];
      const x = i % W;
      const y = (i / W) | 0;
      const d = this.forestD[i];
      if (d < -1.5 || d > 3) continue;
      if (this.rng.next() > 0.22 || !this.canTreeAt(x, y)) continue;
      const o = this.put({ objType: 'bush', tx: x, ty: y, name: 'Bush', solid: true, low: true, variant: this.hash(x, y, 73) < 0.5 ? 'a' : 'b', shadow: { dx: 1, dy: -1, rx: 7, ry: 3 } });
      if (o) this.trunk[i] = 1;
    }
    // Herbs, berries, moonpetals and stones.
    const plant = (type, x, y) => {
      const i = y * W + x;
      if (this.occ[i] || (this.clear[i] && type !== 'herb')) return null;
      const g = this.get(x, y);
      if (g !== T.GRASS && g !== T.FOREST && g !== T.TALL_GRASS) return null;
      return this.put({ objType: type, tx: x, ty: y });
    };
    let herbs = 0;
    let berries = 0;
    let petals = 0;
    let stones = 0;
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      const x = i % W;
      const y = (i / W) | 0;
      const d = this.forestD[i];
      const r = this.rng.next();
      const meadow = x > 48 && x < 126 && y > 87;
      if (d > 0.5 && d < 9 && r < 0.014 && herbs < 40) herbs += plant('herb', x, y) ? 1 : 0;
      else if (meadow && r < 0.004 && herbs < 40) herbs += plant('herb', x, y) ? 1 : 0;
      else if (d > -1 && d < 4 && r > 0.995 && berries < 14) berries += plant('berry_bush', x, y) ? 1 : 0;
      else if (d > 8 && r > 0.9975 && petals < 8) petals += plant('moonpetal', x, y) ? 1 : 0;
      else if (!this.clear[i] && r > 0.9965 && stones < 30 && !meadow) {
        if (this.canTreeAt(x, y) && this.put({ objType: 'rock', tx: x, ty: y, v: Math.floor(this.hash(x, y, 74) * 3) })) {
          stones++;
          this.trunk[i] = 1;
        }
      }
    }
    // A sprinkle of meadow berries and herbs so the south feels alive.
    for (const [x, y] of [
      [70, 96],
      [92, 112],
      [112, 98],
      [60, 110],
    ])
      this.put({ objType: 'berry_bush', tx: x, ty: y });
  }

  decorate() {
    const m = this.map;
    const depth = m.waterDepth();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (this.occ[i]) continue;
        const g = m.ground[i];
        const h = this.hash(x, y, 81);
        const n = this.noise(x, y, 0.09, 82);
        const meadow = x > 48 && x < 126 && y > 87;
        let d = DECO.NONE;
        switch (g) {
          case T.GRASS:
            if (meadow && h < 0.16 + n * 0.12) d = DECO.WILDFLOWERS;
            else if (h < 0.035 + (n > 0.6 ? 0.05 : 0)) d = DECO.FLOWERS;
            else if (h < 0.07) d = DECO.CLOVER;
            else if (h < 0.15) d = DECO.TUFT;
            else if (h > 0.995) d = DECO.PEBBLES;
            break;
          case T.TALL_GRASS:
            if (h < 0.05) d = DECO.FLOWERS;
            break;
          case T.FOREST:
            if (h < 0.05) d = DECO.MUSHROOM;
            else if (h < 0.12) d = DECO.LEAVES;
            else if (h < 0.18) d = DECO.FERN;
            else if (h < 0.22) d = DECO.MOSS;
            else if (h < 0.25 && this.nearTrunk(x, y)) d = DECO.ROOTS;
            break;
          case T.DIRT:
            if (h < 0.06) d = DECO.PEBBLES;
            else if (h > 0.992) d = DECO.PUDDLE;
            break;
          case T.GRAVEL:
            if (h < 0.12) d = DECO.PEBBLES;
            break;
          case T.SAND:
            if (h < 0.04) d = DECO.PEBBLES;
            break;
          case T.RUIN_FLOOR:
            if (h < 0.12) d = DECO.CRACK;
            else if (h < 0.16) d = DECO.BONES;
            else if (h < 0.24) d = DECO.MOSS;
            break;
          case T.FARMLAND:
            if (x > 85 && x < 105 && y > 62 && y < 81 && h < 0.75) d = DECO.CABBAGE;
            break;
          case T.WATER:
          case T.DEEP_WATER: {
            const dp = depth[i];
            const lake = x > 112 && y > 34 && y < 70;
            if (dp === 1 && y < 46 && lake && h < 0.35) d = DECO.REEDS;
            else if (dp === 1 && !lake && h < 0.2) d = DECO.REEDS;
            else if (dp >= 1 && dp <= 3 && lake && (x > 138 || y > 58) && h < 0.09) d = DECO.LILY;
            else if (dp <= 2 && x < 70 && h < 0.25) d = DECO.LILY; // the village pond
            break;
          }
          default:
            break;
        }
        // Around camp fires the ground is scorched.
        if (g === T.DIRT && this.nearFire(x, y)) d = h < 0.5 ? DECO.ASH : d;
        if ((g === T.DIRT || g === T.GRASS) && this.inCamp(x, y) && h > 0.9) d = DECO.STRAW;
        if (d) m.deco[i] = d;
      }
    }
  }

  nearTrunk(x, y) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (this.inb(x + dx, y + dy) && this.trunk[(y + dy) * W + x + dx]) return true;
    return false;
  }

  nearFire(x, y) {
    return Math.abs(x - 140) <= 1 && Math.abs(y - 16) <= 1;
  }

  inCamp(x, y) {
    return x >= 124 && x <= 156 && y >= 3 && y <= 29;
  }

  finishFences() {
    const has = new Set(this.fences.map((f) => `${f.tx},${f.ty}`));
    for (const f of this.fences) {
      const m = (has.has(`${f.tx},${f.ty - 1}`) ? 1 : 0) | (has.has(`${f.tx + 1},${f.ty}`) ? 2 : 0) | (has.has(`${f.tx},${f.ty + 1}`) ? 4 : 0) | (has.has(`${f.tx - 1},${f.ty}`) ? 8 : 0);
      f.variant = String(m);
      f.sprite = `prop:fence:${m}`;
    }
  }

  // ---------- locations and spawns ----------

  loc(id, bounds, center, extra = {}) {
    const info = LOCATION_INFO[id];
    this.locs.push({
      id,
      name: info.name,
      kind: info.kind,
      danger: info.danger ?? 0,
      indoor: !!info.indoor,
      aliases: info.aliases || [],
      description: info.description,
      bounds,
      center: { x: px(center[0]), y: px(center[1]) },
      parent: extra.parent ?? null,
    });
  }

  makeLocations() {
    const bInfo = (id) => this.map.buildings.find((b) => b.id === id);
    const room = (id, cx, cy) => {
      const b = bInfo(id);
      this.loc(id, { x: b.x, y: b.y, w: b.w, h: b.h }, [cx, cy], { parent: id === 'farmhouse' ? 'reed_farm' : 'hearthvale' });
    };
    this.loc('hearthvale', { x: 44, y: 36, w: 67, h: 47 }, [79, 63]);
    this.loc('town_square', { x: 70, y: 54, w: 20, h: 13 }, [78, 62], { parent: 'hearthvale' });
    room('player_home', 96, 80);
    room('ember_kettle', 70, 49);
    room('smithy', 98, 55);
    room('general_store', 58, 55);
    room('chapel', 88, 49);
    room('herbalist', 48, 55);
    room('guardhouse', 60, 67);
    room('farmhouse', 24, 52);
    this.loc('reed_farm', { x: 14, y: 44, w: 31, h: 36 }, [36, 60]);
    this.loc('whisperwood', { x: 27, y: 0, w: 96, h: 36 }, [76, 25]);
    this.loc('moonpetal_glade', { x: 47, y: 11, w: 11, h: 9 }, [52, 15], { parent: 'whisperwood' });
    this.loc('stonecut_quarry', { x: 3, y: 3, w: 26, h: 25 }, [16, 15]);
    this.loc('bandit_camp', { x: 126, y: 4, w: 29, h: 25 }, [137, 21]);
    const lc = this.lakeCenterTile;
    this.loc('mirror_lake', { x: 112, y: 36, w: 43, h: 32 }, [lc.x, lc.y]);
    const r = this.ruinsRect;
    this.loc('sunken_ruins', { x: r.x, y: r.y, w: r.w, h: r.h }, [r.x + 20, r.y + 5]);
    this.loc('south_meadow', { x: 48, y: 88, w: 78, h: 31 }, [86, 100]);
    this.loc('kings_road', { x: 0, y: KINGS_ROAD_Y, w: W, h: 3 }, [70, KINGS_ROAD_Y + 1]);
    this.loc('wilds', { x: 0, y: 0, w: W, h: H }, [140, 100]);
  }

  // The nearest open tile to (x, y): organic scatter may have put a tree on the exact spot.
  freeNear(x, y, radius = 4) {
    for (let r = 0; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = x + dx;
          const ty = y + dy;
          if (!this.inb(tx, ty) || SOLID[this.get(tx, ty)] || this.objects.isBlockingTile(tx, ty, null)) continue;
          return { x: tx, y: ty };
        }
      }
    }
    this.problems.push(`no free tile near ${x},${y}`);
    return null;
  }

  makeSpawns() {
    const at = (x, y) => ({ x: px(x), y: px(y) });
    const S = this.spawns;
    S.player = at(96, KINGS_ROAD_Y);
    S.companion = at(97, KINGS_ROAD_Y);
    // Villagers where they are at 8 in the morning.
    S.npcs = [
      { id: 'bram', ...at(99, 54) },
      { id: 'elda', ...at(73, 45) },
      { id: 'pip', ...at(78, 62) },
      { id: 'rowan', ...at(75, 65) },
      { id: 'mira', ...at(49, 54) },
      { id: 'tobias', ...at(34, 64) },
      { id: 'aveline', ...at(88, 45) },
      { id: 'garrick', ...at(56, 53) },
    ];
    const C = (species, x, y, opts = {}) => {
      const t = this.freeNear(x, y);
      if (t) S.creatures.push({ species, ...at(t.x, t.y), opts });
    };
    // Forest and meadow wildlife.
    C('rabbit', 61, 33);
    C('rabbit', 96, 32);
    C('rabbit', 70, 101);
    C('rabbit', 95, 95);
    C('rabbit', 110, 108);
    C('deer', 90, 22);
    C('deer', 58, 27);
    C('deer', 100, 112);
    // Village animals.
    C('chicken', 49, 66);
    C('chicken', 51, 67);
    C('chicken', 48, 68);
    C('chicken', 27, 58);
    C('chicken', 29, 57);
    C('cat', 82, 64, { name: 'Stray cat' });
    // Slimes on the lake shore and in the meadow.
    C('slime', 153, 50);
    C('slime', 140, 66);
    C('slime', 126, 64);
    C('slime', 75, 108);
    C('slime', 106, 99);
    // Wolves deep in Whisperwood.
    C('wolf', 70, 13);
    C('wolf', 77, 11);
    // The bandit crew.
    C('bandit', 137, 15);
    C('bandit', 143, 15);
    C('bandit', 140, 20);
    C('bandit', 135, 18);
    C('bandit_archer', 146, 22);
    C('bandit_chief', 140, 11);
    // The ruins' restless dead.
    for (const [x, y] of this.ruinSpawns) C('skeleton', x, y);

    const Z = (id, locationId, species, max, rect, night) => S.spawnZones.push({ id, locationId, species, max, night, rect });
    const r = this.ruinsRect;
    Z('whisperwood_wolves', 'whisperwood', ['wolf'], 2, { x: 58, y: 4, w: 32, h: 20 }, undefined);
    Z('whisperwood_wolves_night', 'whisperwood', ['wolf'], 5, { x: 36, y: 4, w: 78, h: 28 }, true);
    Z('farm_boars', 'reed_farm', ['boar'], 3, { x: 2, y: 40, w: 14, h: 40 }, undefined);
    Z('forest_boars', 'whisperwood', ['boar'], 2, { x: 40, y: 22, w: 70, h: 12 }, undefined);
    Z('forest_deer', 'whisperwood', ['deer'], 4, { x: 36, y: 6, w: 78, h: 26 }, undefined);
    Z('meadow_deer', 'south_meadow', ['deer'], 2, { x: 50, y: 90, w: 72, h: 26 }, undefined);
    Z('meadow_rabbits', 'south_meadow', ['rabbit'], 5, { x: 50, y: 90, w: 72, h: 26 }, undefined);
    Z('forest_rabbits', 'whisperwood', ['rabbit'], 3, { x: 36, y: 26, w: 78, h: 8 }, undefined);
    Z('lake_slimes', 'mirror_lake', ['slime'], 4, { x: 120, y: 62, w: 34, h: 8 }, undefined);
    Z('meadow_slimes', 'south_meadow', ['slime'], 3, { x: 52, y: 96, w: 66, h: 20 }, undefined);
    Z('quarry_slimes', 'stonecut_quarry', ['slime'], 3, { x: 6, y: 6, w: 20, h: 18 }, undefined);
    Z('ruins_bats', 'sunken_ruins', ['bat'], 4, { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 }, true);
    Z('ruins_skeletons', 'sunken_ruins', ['skeleton'], 5, { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 }, undefined);
    Z('camp_bandits', 'bandit_camp', ['bandit', 'bandit_archer'], 4, { x: 131, y: 11, w: 18, h: 13 }, undefined);
  }
}

export function generateWorld(game, seed = 1) {
  const b = new WorldBuilder(game, seed);
  b.build();
  b.map.waterDepth();
  const locations = new LocationIndex(b.locs);
  return { map: b.map, objects: b.objects, locations, spawns: b.spawns, problems: b.problems };
}
