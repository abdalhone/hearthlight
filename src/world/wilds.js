import { TILE, WORLD_X0, WORLD_Y0, WORLD_W, WORLD_H } from '../core/constants.js';
import { T, DECO, SOLID, WATERY } from './tiles.js';
import { makeObject } from './objects.js';
import { LAND, ROADS, WATERS, P, regionAt, inVale } from './wilds_layout.js';
import { WILDS_INFO, WILDS_TEXT } from './wilds_content.js';

// The wider world around the vale (DESIGN §32, docs/LORE.md §1 and §10), built into the
// same map after the vale: west along the King's Road to the dead waystone, the Long
// Mile, the fork and Brindlecombe; north through the deep Whisperwood and up the
// Hollowcrown to the Crown Ring; east round Mirror Lake to the Cinderwick fork.
//
// The builder borrows the vale builder's tools (worldgen.js WorldBuilder: stroke, path,
// building, must, near, decor, ...) with its own bounds: it writes only outside the vale
// and indexes its scratch arrays by map.idx. The land is a field of corridors (LAND in
// wilds_layout.js): open country inside them, a few tiles of thick wood at their edge,
// and beyond that the wilds' wall, thicket or cliff, so every journey follows a way you
// can see and the map never ends in a straight line.

const px = (t) => t * TILE + TILE / 2;
const MARGIN = 5; // tiles of thick, walkable wood between open land and the wall
const FAR = -99;

// The ground of open land, the edge wood and the wall, per region.
const GROUND = {
  heath: { open: T.HEATH, edge: T.HEATH, wall: T.THICKET },
  grey: { open: T.DEAD_GRASS, edge: T.DEAD_GRASS, wall: T.THICKET },
  wood: { open: T.FOREST, edge: T.FOREST, wall: T.THICKET },
  pine: { open: T.FOREST, edge: T.FOREST, wall: T.THICKET },
  foothill: { open: T.SCREE, edge: T.SCREE, wall: T.ROCK },
  snow: { open: T.SNOW, edge: T.SNOW, wall: T.ROCK },
  east: { open: T.GRASS, edge: T.GRASS, wall: T.THICKET },
};

// Trees per tile: [open land, edge wood], and the kinds that grow there.
const TREES = {
  heath: { p: [0.006, 0.16], kinds: ['pine', 'oak', 'pine'], bush: [0.012, 0.14] },
  grey: { p: [0.004, 0.08], kinds: ['pine'], stump: [0.01, 0.08], bush: [0.004, 0.06] },
  wood: { p: [0.06, 0.46], kinds: ['oak', 'pine', 'oak', 'linden'], bush: [0.01, 0.05] },
  pine: { p: [0.05, 0.42], kinds: ['pine'], bush: [0.006, 0.04] },
  foothill: { p: [0.012, 0.1], kinds: ['pine'], rock: [0.02, 0.1] },
  snow: { p: [0.002, 0.03], kinds: ['pine'], rock: [0.008, 0.06] },
  east: { p: [0.02, 0.34], kinds: ['oak', 'linden', 'oak', 'pine'], bush: [0.008, 0.06] },
};

const SNOWY = new Set(['snow']);

// Builder methods that differ from the vale's (world bounds, world-indexed scratch).
const WILDS_METHODS = {
  init(vale) {
    this.game = vale.game;
    this.seed = vale.seed;
    this.rng = vale.rng;
    this.map = vale.map;
    this.objects = vale.objects;
    this.problems = vale.problems;
    this.locs = vale.locs;
    this.spawns = vale.spawns;
    this.fences = [];
    const n = this.map.w * this.map.h;
    this.clear = new Uint8Array(n);
    this.occ = new Uint8Array(n);
    this.trunk = new Uint8Array(n);
    this.open = new Float32Array(n).fill(FAR); // > 0 open land, (-MARGIN, 0] edge wood, else wall
    this.places = {};
    // What is already in the vale stays (objects placed there by the vale builder).
    for (const o of this.objects.list) for (const [x, y] of o.occupiedTiles()) if (this.map.inBounds(x, y)) this.occ[this.map.idx(x, y)] = 1;
  },

  ix(x, y) {
    return this.map.idx(x, y);
  },

  // The wilds' own tiles: in the world, outside the vale.
  inb(x, y) {
    return this.map.inBounds(x, y) && !inVale(x, y);
  },

  keep(x, y, w, h) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.inb(i, j)) this.clear[this.ix(i, j)] = 1;
  },

  path(points, width, tile = T.DIRT, margin = 1) {
    this.stroke(points, width, (x, y) => {
      const g = this.get(x, y);
      if (WATERY[g] || SOLID[g] || g === T.SHALLOWS || g === T.FLOOR || g === T.BRIDGE || g === T.COBBLE) return;
      this.set(x, y, tile);
    });
    this.stroke(points, width + margin * 2, (x, y) => (this.clear[this.ix(x, y)] = 1));
  },

  put(desc, { strict = false, allowSolidGround = false } = {}) {
    const o = makeObject(this.game, desc);
    for (const [x, y] of o.occupiedTiles()) {
      if (!this.inb(x, y) || this.occ[this.ix(x, y)] || (!allowSolidGround && SOLID[this.get(x, y)])) {
        if (strict) this.problems.push(`could not place ${o.id} at ${x},${y}`);
        return null;
      }
    }
    for (const [x, y] of o.occupiedTiles()) this.occ[this.ix(x, y)] = 1;
    this.objects.add(o);
    return o;
  },

  canTreeAt(x, y) {
    const i = this.ix(x, y);
    if (this.clear[i] || this.occ[i]) return false;
    const g = this.get(x, y);
    if (SOLID[g] || g === T.DIRT || g === T.GRAVEL || g === T.SHALLOWS || g === T.COBBLE || g === T.BRIDGE) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (!this.map.inBounds(xx, yy)) continue;
        if (this.trunk[this.ix(xx, yy)]) return false;
        const n = this.get(xx, yy);
        if (SOLID[n] && !WATERY[n] && n !== T.THICKET && n !== T.ROCK && (dx === 0 || dy === 0)) return false;
      }
    }
    return true;
  },

  nearTrunk(x, y) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (this.map.inBounds(x + dx, y + dy) && this.trunk[this.ix(x + dx, y + dy)]) return true;
    return false;
  },

  loc(id, bounds, center, extra = {}) {
    const info = WILDS_INFO[id];
    if (!info) {
      this.problems.push(`no place info for ${id}`);
      return;
    }
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
      parent: extra.parent ?? info.parent ?? null,
      region: info.region || null,
      wilds: true,
    });
  },

  // ------------------------------------------------------------------ build

  build() {
    this.landField();
    this.ground();
    this.waters();
    this.roads();
    this.westPlaces();
    this.brindlecombe();
    this.northPlaces();
    this.eastPlaces();
    this.scatterWilds();
    this.decorateWilds();
    this.finishFences();
    this.makeWildsLocations();
    this.makeWildsSpawns();
    const map = this.map;
    map.regionAt = regionAt;
    map.thicketKind = (tx, ty) => {
      const r = regionAt(tx, ty);
      return r === 'snow' || r === 'foothill' ? 'snow' : r === 'pine' ? 'pine' : r === 'grey' ? 'grey' : 'oak';
    };
    map.places = this.places;
  },

  // How open each tile is: the largest (half-width - distance) over the corridors and
  // places, roughened with noise so no edge runs straight.
  landField() {
    const open = this.open;
    const map = this.map;
    const reach = MARGIN + 4;
    const mark = (x, y, v) => {
      if (!this.inb(x, y)) return;
      const i = this.ix(x, y);
      if (v > open[i]) open[i] = v;
    };
    for (const L of LAND) {
      if (L.points) {
        const pts = L.points;
        for (let s = 0; s < pts.length - 1; s++) {
          const [ax, ay] = pts[s];
          const [bx, by] = pts[s + 1];
          const vx = bx - ax;
          const vy = by - ay;
          const len2 = vx * vx + vy * vy || 1;
          const r = L.hw + reach;
          const x0 = Math.floor(Math.min(ax, bx) - r);
          const x1 = Math.ceil(Math.max(ax, bx) + r);
          const y0 = Math.floor(Math.min(ay, by) - r);
          const y1 = Math.ceil(Math.max(ay, by) + r);
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              const cx = x + 0.5;
              const cy = y + 0.5;
              let t = ((cx - ax) * vx + (cy - ay) * vy) / len2;
              t = t < 0 ? 0 : t > 1 ? 1 : t;
              const d = Math.hypot(cx - ax - vx * t, cy - ay - vy * t);
              if (d <= r) mark(x, y, L.hw - d);
            }
          }
        }
      } else {
        const r = Math.max(L.rx, L.ry) + reach;
        for (let y = Math.floor(L.cy - r); y <= Math.ceil(L.cy + r); y++) {
          for (let x = Math.floor(L.cx - r); x <= Math.ceil(L.cx + r); x++) {
            const dx = (x + 0.5 - L.cx) / L.rx;
            const dy = (y + 0.5 - L.cy) / L.ry;
            const k = Math.hypot(dx, dy);
            // Distance to the ellipse's rim, roughly, in tiles (negative outside).
            mark(x, y, (1 - k) * Math.min(L.rx, L.ry));
          }
        }
      }
    }
    // Roughen: wobble the edge by a few tiles. The vale's border stays a wall except at
    // the seams, where the corridors already reach it.
    const X0 = map.x0;
    const Y0 = map.y0;
    for (let i = 0; i < open.length; i++) {
      const v = open[i];
      if (v <= -reach) continue;
      const x = (i % map.w) + X0;
      const y = Math.floor(i / map.w) + Y0;
      open[i] = v + (this.noise(x, y, 0.085, 401, 2) - 0.5) * 7;
    }
  },

  // Ground for every wilds tile.
  ground() {
    const map = this.map;
    const open = this.open;
    const g = map.ground;
    for (let i = 0; i < g.length; i++) {
      const x = (i % map.w) + map.x0;
      const y = Math.floor(i / map.w) + map.y0;
      if (inVale(x, y)) continue;
      const o = open[i];
      const region = regionAt(x, y);
      const G = GROUND[region];
      if (o <= -MARGIN) {
        g[i] = G.wall;
        continue;
      }
      let t = o > 0 ? G.open : G.edge;
      const n = this.noise(x, y, 0.11, 411, 2);
      switch (region) {
        case 'heath':
          // Grass near the vale and in damp hollows; heather and gorse further out.
          if (x > -16 + n * 10) t = n > 0.62 ? T.TALL_GRASS : T.GRASS;
          else if (n > 0.66) t = T.GRASS;
          else if (n < 0.24) t = T.TALL_GRASS;
          break;
        case 'grey':
          if (n > 0.7) t = T.HEATH;
          break;
        case 'wood':
        case 'pine':
          if (o > 2 && n > 0.68) t = T.TALL_GRASS;
          break;
        case 'foothill':
          // Grass low on the mountain, scree higher up, gravel in the gullies.
          if (y > -112 && n > 0.48) t = T.GRASS;
          else if (n < 0.28) t = T.GRAVEL;
          if (o <= 0 && n > 0.6) t = T.ROCK;
          break;
        case 'snow':
          if (n < 0.22) t = T.SCREE;
          if (o <= 0 && n > 0.62) t = T.ROCK;
          break;
        case 'east':
          if (n > 0.64) t = T.TALL_GRASS;
          else if (o <= 0 && n < 0.3) t = T.FOREST;
          break;
        default:
          break;
      }
      g[i] = t;
    }
    map.version++;
  },

  waters() {
    for (const p of WATERS.pools) {
      this.ellipse(p.cx, p.cy, p.rx + 1, p.ry + 1, (x, y) => {
        const dx = (x + 0.5 - p.cx) / p.rx;
        const dy = (y + 0.5 - p.cy) / p.ry;
        if (Math.hypot(dx, dy) < 1 + (this.noise(x, y, 0.4, 421) - 0.5) * 0.3) this.set(x, y, T.WATER);
      });
      this.keep(Math.floor(p.cx - p.rx - 2), Math.floor(p.cy - p.ry - 2), Math.ceil(p.rx * 2 + 5), Math.ceil(p.ry * 2 + 5));
    }
    for (const r of WATERS.rivers) {
      this.stroke(r.points, r.width, (x, y) => this.set(x, y, r.deep ? T.DEEP_WATER : T.WATER));
      this.stroke(r.points, r.width + 2, (x, y) => (this.clear[this.ix(x, y)] = 1));
    }
    // Rivers cut through the wall wood too: they are water wherever they run (walls
    // stay walls on their banks).
    const map = this.map;
    map.version++;
    map._depth = null;
  },

  // A ford where a road crosses shallow water.
  ford(points, width) {
    this.stroke(points, width + 1, (x, y) => {
      if (this.get(x, y) === T.WATER) this.set(x, y, T.SHALLOWS);
    });
  },

  roads() {
    for (const R of ROADS) {
      const tile = R.tile === 'gravel' ? T.GRAVEL : T.DIRT;
      if (R.tile === 'track') {
        // A track: worn earth that comes and goes through the grass.
        this.stroke(R.points, R.width, (x, y) => {
          const g = this.get(x, y);
          if (WATERY[g] || SOLID[g] || g === T.SHALLOWS) return;
          if (this.hash(x, y, 431) < 0.82) this.set(x, y, T.DIRT);
        });
        this.stroke(R.points, R.width + 2, (x, y) => (this.clear[this.ix(x, y)] = 1));
      } else this.path(R.points, R.width, tile);
      // Where a road meets a river it fords it (the Greyford's bridge is another matter).
      if (R.id !== 'saltmere_road') this.ford(R.points, R.width);
    }
    // Roads are open land however the wood leans: no wall across a road.
    for (const R of ROADS) {
      this.stroke(R.points, R.width + 2, (x, y) => {
        const i = this.ix(x, y);
        if (this.open[i] <= 0) this.open[i] = 0.5;
        const g = this.get(x, y);
        if (g === T.THICKET || g === T.ROCK) {
          const G = GROUND[regionAt(x, y)];
          this.set(x, y, G.open === T.SNOW ? T.SNOW : G.open);
        }
      });
    }
  },

  // ------------------------------------------------------------------ places: west

  waystone(id, x, y, state, extra = {}) {
    const T0 = WILDS_TEXT.waystones[id] || {};
    const light =
      state === 'lit'
        ? { r: 96, color: '#ffc47a', intensity: 0.95, flicker: 0.12, dy: -34 }
        : state === 'burning'
          ? { r: 104, color: '#ff8a46', intensity: 1, flicker: 0.28, dy: -34 }
          : null;
    const o = this.must({
      objType: 'waystone',
      id,
      tx: x,
      ty: y,
      variant: state,
      solid: true,
      name: T0.name || 'Waystone',
      title: T0.name || 'Waystone',
      text: T0.text,
      label: state === 'dead' ? 'Look' : 'Rest',
      heal: state === 'dead' ? 0 : 20,
      light,
      animated: state !== 'dead',
      words: ['waystone', 'stone', 'pillar', ...(extra.words || [])],
      shadow: { dx: 2, dy: -1, rx: 8, ry: 3 },
    });
    this.keep(x - 3, y - 3, 7, 6);
    if (o && state !== 'dead') {
      if (!this.map.safeSpots) this.map.safeSpots = [];
      this.map.safeSpots.push({ id, x: px(x), y: px(y), r: 9 * TILE });
    }
    return o;
  },

  signpost(id, x, y) {
    const S = WILDS_TEXT.signs[id];
    return this.must({ objType: 'sign', id, tx: x, ty: y, title: S.title, text: S.text, name: S.title, solid: true, low: true });
  },

  westPlaces() {
    const D = P.deadWaystone;
    this.waystone('waystone_dead_mile', D.x, D.y, 'dead', { words: ['dead waystone', "lyra's waystone"] });
    this.decor('log', 0, 0, { footprint: { x: D.x + 3, y: D.y + 1, w: 2, h: 1 }, name: 'Fallen log', text: WILDS_TEXT.looks.mile_log, label: 'Look' });
    this.places.dead_waystone = { x: px(D.x), y: px(D.y) };

    const L = P.longMile;
    this.waystone('waystone_long_mile', L.x, L.y, 'lit', { words: ['long mile'] });
    this.must({ objType: 'campfire', id: 'fire_long_mile', tx: L.x + 3, ty: L.y + 2, name: 'Fire ring' });
    this.decor('log', 0, 0, { footprint: { x: L.x + 6, y: L.y + 2, w: 2, h: 1 }, name: 'Log seat' });
    this.decor('woodpile', L.x - 3, L.y + 1, { name: 'Woodpile' });
    this.places.long_mile = { x: px(L.x), y: px(L.y) };

    const F = P.westFork;
    this.signpost('sign_west_fork', F.x + 2, F.y - 3);
    this.places.west_fork = { x: px(F.x), y: px(F.y) };

    // The Greyford: the road runs to the bank and the bridge stops a third of the way over.
    const G = P.greyford;
    for (let y = G.y - 1; y <= G.y + 1; y++) {
      let x = G.x + 2;
      while (x > G.x - 12 && !WATERY[this.get(x, y)]) x--;
      // x is the first water tile west of the bank: three planks, then nothing.
      for (let k = 0; k < 3; k++) if (WATERY[this.get(x - k, y)]) this.set(x - k, y, T.BRIDGE);
    }
    this.signpost('sign_greyford', G.x + 3, G.y - 3);
    this.waystone('waystone_greyford', G.x + 5, G.y + 3, 'dead');
    this.places.greyford = { x: px(G.x), y: px(G.y) };
  },

  // Brindlecombe: the village the Greywinter emptied, its doors still open (LORE §1, §9.6).
  brindlecombe() {
    const C = P.brindlecombe;
    const sq = { x: C.x - 7, y: C.y - 4, w: 14, h: 9 };
    for (let y = sq.y; y < sq.y + sq.h; y++) {
      for (let x = sq.x; x < sq.x + sq.w; x++) {
        // The grey has crept between the cobbles.
        this.set(x, y, this.hash(x, y, 441) < 0.22 ? T.DEAD_GRASS : T.COBBLE);
      }
    }
    this.keep(sq.x - 2, sq.y - 2, sq.w + 4, sq.h + 4);
    const B = WILDS_TEXT.brindle;
    this.must({
      objType: 'wardstone',
      id: 'brindle_wardstone',
      tx: C.x,
      ty: C.y,
      variant: 'dead',
      solid: true,
      name: 'Brindlecombe wardstone',
      title: 'The dead wardstone',
      text: B.wardstone,
      label: 'Look',
      words: ['wardstone', 'dead wardstone', 'brindlecombe stone'],
      shadow: { dx: 2, dy: -1, rx: 9, ry: 3 },
    });
    this.look('well', 0, 0, 'well', { id: 'brindle_well', footprint: { x: C.x + 4, y: C.y + 1, w: 2, h: 2 }, name: 'Brindlecombe well', text: B.well, low: false, interactReach: 8, shadow: { dx: 1, dy: -2, rx: 14, ry: 5 } });
    this.places.brindlecombe = { x: px(C.x), y: px(C.y) };

    // Lanes from the square to the houses.
    this.path(
      [
        [C.x, C.y + 4],
        [C.x, C.y + 12],
      ],
      2,
      T.DIRT,
    );
    this.path(
      [
        [C.x - 7, C.y],
        [C.x - 18, C.y - 1],
      ],
      2,
      T.DIRT,
    );
    this.path(
      [
        [C.x + 7, C.y],
        [C.x + 19, C.y + 1],
      ],
      2,
      T.DIRT,
    );
    this.path(
      [
        [C.x, C.y - 4],
        [C.x, C.y - 8],
      ],
      2,
      T.DIRT,
    );

    const dead = (spec) => {
      const b = this.building({ ...spec, smoky: false, locked: false });
      const door = this.objects.get(`door_${spec.id}`);
      if (door) {
        door.state.open = true;
        door.anim = 1;
        door.autoClose = false;
        door.lockedText = null;
      }
      return b;
    };
    // The chapel, north of the square: its altar cold, its family flames long out.
    const ch = { id: 'brindle_chapel', x: C.x - 5, y: C.y - 17, w: 11, h: 9, door: C.x, material: 'stone', roof: { style: 'slate', chimneys: [] }, name: 'Brindlecombe chapel' };
    dead(ch);
    this.decor('altar', 0, 0, { id: 'brindle_altar', name: 'Cold altar', title: 'The cold altar', text: B.altar, label: 'Look', variant: 'cold', light: false, animated: false, footprint: { x: C.x - 1, y: ch.y + 1, w: 3, h: 1 } });
    for (const yy of [ch.y + 3, ch.y + 5]) {
      this.decor('pew', 0, 0, { name: 'Pew', footprint: { x: ch.x + 2, y: yy, w: 3, h: 1 } });
      this.decor('pew', 0, 0, { name: 'Pew', footprint: { x: ch.x + 6, y: yy, w: 3, h: 1 } });
    }
    this.decor('candle_rack', ch.x + 1, ch.y + 1, { id: 'brindle_candles', name: 'Cold candle rack', text: B.candles, label: 'Look', variant: 'cold' });
    this.must({ objType: 'chest', id: 'chest_brindle_chapel', tx: ch.x + 9, ty: ch.y + 1, name: 'Vestry chest', loot: true, items: { candle: 3, coin: 14, wool_cloak: 1 } });

    // The houses round the square.
    const houses = [
      { id: 'brindle_coll_house', x: C.x - 20, y: C.y - 9, w: 8, h: 8, door: C.x - 16, material: 'timber', roof: { style: 'thatch', chimneys: [C.x - 14] }, name: 'The Coll house', chest: { coin: 9, candle: 1, potion: 1 }, text: B.coll },
      { id: 'brindle_fallow_house', x: C.x + 12, y: C.y - 9, w: 7, h: 7, door: C.x + 15, material: 'log', roof: { style: 'moss', chimneys: [C.x + 17] }, name: 'The Fallow house', chest: { coin: 6, bread: 1, lantern: 1 }, text: B.fallow },
      { id: 'brindle_mill_house', x: C.x - 22, y: C.y + 4, w: 8, h: 7, door: C.x - 18, material: 'timber', roof: { style: 'red', chimneys: [C.x - 20] }, name: 'The mill house', chest: { coin: 11, wheat: 4, iron_ore: 2 }, text: B.mill },
      { id: 'brindle_haskett_house', x: C.x + 12, y: C.y + 4, w: 7, h: 7, door: C.x + 15, material: 'timber', roof: { style: 'thatch', chimneys: [C.x + 13] }, name: 'The Haskett house', chest: { coin: 8, stone: 3, potion: 1 }, text: B.haskett },
      { id: 'brindle_lane_house', x: C.x - 4, y: C.y + 12, w: 8, h: 7, door: C.x, material: 'log', roof: { style: 'slate', chimneys: [C.x + 2] }, name: 'The lane house', chest: { coin: 12, candle: 2 }, text: B.lane },
    ];
    for (const h of houses) {
      const b = dead(h);
      const it = b.interior;
      this.must({ objType: 'bed', id: `bed_${h.id}`, footprint: { x: it.x, y: it.y, w: 1, h: 2 }, name: 'Bare bed', text: B.bed, owner: null, words: ['bed'] });
      this.decor('table', it.x + 2, it.y + 1, { name: 'Table', text: h.text, label: 'Look' });
      this.must({ objType: 'chest', id: `chest_${h.id}`, tx: it.x + it.w - 1, ty: it.y, name: 'Old chest', loot: true, items: h.chest });
      if (it.h >= 4) this.decor('shelf', it.x + it.w - 1, it.y + it.h - 1, { name: 'Shelf' });
    }

    // The graveyard east of the lane house, and the long field gone grey.
    const gy = { x: C.x + 6, y: C.y + 12, w: 10, h: 8 };
    this.fenceLine(gy.x, gy.y, gy.x + gy.w, gy.y + gy.h, [[gy.x, gy.y + 4]]);
    let k = 0;
    for (let yy = gy.y + 2; yy < gy.y + gy.h - 1; yy += 2) {
      for (let xx = gy.x + 2; xx < gy.x + gy.w - 1; xx += 2) {
        this.decor('grave', xx, yy, { name: 'Grave', text: B.graves[k++ % B.graves.length], label: 'Read' });
      }
    }
    this.places.brindle_graves = { x: px(gy.x + gy.w / 2), y: px(gy.y + gy.h / 2) };
    this.signpost('sign_brindlecombe', C.x + 22, C.y + 3);
  },

  // ------------------------------------------------------------------ places: north

  northPlaces() {
    const F = P.crownPathFoot;
    this.signpost('sign_crown_path', F.x + 3, F.y);

    // A Lanternwright marker stone in a clearing, moonpetals at its foot.
    const S = P.shrine;
    this.must({
      objType: 'standing_stone',
      id: 'stone_crown_marker',
      tx: S.x,
      ty: S.y,
      variant: 'mossy',
      solid: true,
      name: 'Marker stone',
      title: 'A marker stone',
      text: WILDS_TEXT.looks.marker,
      label: 'Read',
      words: ['marker stone', 'standing stone', 'lanternwright stone'],
      shadow: { dx: 2, dy: -1, rx: 7, ry: 3 },
    });
    this.keep(S.x - 3, S.y - 3, 7, 7);
    for (const [dx, dy] of [
      [-2, 2],
      [3, 1],
      [-3, -1],
    ])
      this.put({ objType: 'moonpetal', tx: S.x + dx, ty: S.y + dy });
    this.places.crown_shrine = { x: px(S.x), y: px(S.y) };

    // The treeline camp: Hess's fire ring, two hollows in the grass where bedrolls lay.
    const C = P.treelineCamp;
    this.must({ objType: 'campfire', id: 'fire_treeline', tx: C.x, ty: C.y + 1, name: 'Old fire ring' });
    this.decor('tent', 0, 0, { name: 'Lean-to', footprint: { x: C.x - 5, y: C.y - 2, w: 3, h: 2 }, text: WILDS_TEXT.looks.leanto, label: 'Look' });
    this.decor('bedroll', C.x + 2, C.y - 1, { name: 'Bedroll', text: WILDS_TEXT.looks.bedroll, label: 'Look' });
    this.decor('log', 0, 0, { footprint: { x: C.x - 3, y: C.y + 3, w: 2, h: 1 }, name: 'Log seat' });
    this.must({ objType: 'chest', id: 'chest_treeline_cache', tx: C.x + 4, ty: C.y + 2, name: "Wardrunner's cache", loot: true, items: { potion: 1, candle: 1, bread: 1 } });
    this.keep(C.x - 6, C.y - 4, 13, 9);
    this.places.treeline_camp = { x: px(C.x), y: px(C.y) };

    // The Crown Ring: nine stones on the mountain's shoulder, and in the middle the
    // circle where the snow melted round a sleeping stranger.
    const R = P.crownRing;
    const N = 9;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2 - Math.PI / 2;
      const x = Math.round(R.x + Math.cos(a) * 7.5);
      const y = Math.round(R.y + Math.sin(a) * 6);
      this.must({
        objType: 'standing_stone',
        id: `crown_stone_${k + 1}`,
        tx: x,
        ty: y,
        variant: [2, 5, 7].includes(k) ? 'broken' : 'crown',
        solid: true,
        name: 'Standing stone',
        title: 'A stone of the Crown Ring',
        text: WILDS_TEXT.crown.stones[k % WILDS_TEXT.crown.stones.length],
        label: 'Read',
        words: ['standing stone', 'crown stone', 'ring stone'],
        shadow: { dx: 2, dy: -1, rx: 7, ry: 3 },
      });
    }
    this.ellipse(R.x, R.y, 3, 2.6, (x, y, r) => {
      if (r < 1) this.set(x, y, r < 0.55 ? T.GRASS : T.TALL_GRASS);
    });
    this.must({
      objType: 'crown_mark',
      id: 'crown_ring_heart',
      tx: R.x,
      ty: R.y,
      solid: false,
      name: 'The melted circle',
      title: 'The melted circle',
      text: WILDS_TEXT.crown.heart,
      label: 'Look',
      words: ['circle', 'melted circle', 'crown ring', 'where you were found'],
    });
    this.keep(R.x - 9, R.y - 8, 19, 17);
    this.places.crown_ring = { x: px(R.x), y: px(R.y) };
  },

  // ------------------------------------------------------------------ places: east

  eastPlaces() {
    const F = P.eastFork;
    this.waystone('waystone_cinderwick_fork', F.x + 2, F.y - 2, 'burning', { words: ['burning waystone', 'fork stone'] });
    this.signpost('sign_east_fork', F.x - 3, F.y + 3);
    // The Cinderwick carters' stopping place: a cart, oil barrels, a cold fire.
    this.decor('cart', 0, 0, { name: "Carter's cart", variant: 'ore', footprint: { x: F.x + 6, y: F.y + 3, w: 2, h: 1 }, text: WILDS_TEXT.looks.cart, label: 'Look' });
    this.decor('barrel', F.x + 9, F.y + 3, { name: 'Oil barrel', text: WILDS_TEXT.looks.oil, label: 'Look' });
    this.decor('barrel', F.x + 9, F.y + 4, { name: 'Oil barrel' });
    this.must({ objType: 'campfire', id: 'fire_east_fork', tx: F.x + 5, ty: F.y + 6, name: "Carters' fire" });
    this.places.cinderwick_fork = { x: px(F.x), y: px(F.y) };

    // The bandits' hill: a lookout over both roads, a banner to say whose it is.
    const L = P.lookout;
    this.decor('banner', L.x - 2, L.y - 2, { name: 'Bandit banner', text: WILDS_TEXT.looks.banner, label: 'Look', low: false });
    this.decor('brazier', L.x + 2, L.y - 1, { name: 'Brazier' });
    this.decor('tent', 0, 0, { name: 'Tent', footprint: { x: L.x - 5, y: L.y + 1, w: 3, h: 2 } });
    this.decor('crate', L.x + 3, L.y + 2, { name: 'Crate' });
    this.must({ objType: 'chest', id: 'chest_bandit_lookout', tx: L.x + 4, ty: L.y + 2, name: 'Bandit strongbox', loot: true, items: { coin: 22, iron_ore: 2, potion: 1 } });
    for (let x = L.x - 6; x <= L.x + 6; x++) {
      if (Math.abs(x - L.x) <= 1 || !this.inb(x, L.y - 4)) continue;
      const f = this.put({ objType: 'fence', tx: x, ty: L.y - 4, solid: true, low: true, name: 'Stake fence' });
      if (f) this.fences.push(f);
    }
    this.keep(L.x - 7, L.y - 5, 15, 11);
    this.places.bandit_lookout = { x: px(L.x), y: px(L.y) };

    // The oil track, buried under a slide of black shale.
    const R = P.rockslide;
    this.ellipse(R.x + 2, R.y, 4.2, 5.5, (x, y, r) => {
      if (r < 0.75) this.set(x, y, T.ROCK);
      else if (r < 1) this.set(x, y, T.RUBBLE);
    });
    this.signpost('sign_oil_track', R.x - 6, R.y - 2);
    for (const [dx, dy] of [
      [-3, 2],
      [-4, -1],
      [-2, 3],
    ])
      this.put({ objType: 'rock', tx: R.x + dx, ty: R.y + dy, v: 1 });
    this.places.rockslide = { x: px(R.x), y: px(R.y) };

    // The north track to Owlsend, closed by pines the snow brought down.
    const O = P.owlsendTrackEnd;
    for (let x = O.x - 4; x <= O.x + 4; x++) for (let y = O.y - 3; y <= O.y - 1; y++) this.set(x, y, T.THICKET);
    this.decor('log', 0, 0, { footprint: { x: O.x - 2, y: O.y, w: 2, h: 1 }, name: 'Fallen pine', text: WILDS_TEXT.looks.fallen, label: 'Look' });
    this.decor('log', 0, 0, { footprint: { x: O.x + 1, y: O.y + 1, w: 2, h: 1 }, name: 'Fallen pine' });
    this.signpost('sign_owlsend', O.x - 3, O.y + 2);
    this.places.owlsend_track = { x: px(O.x), y: px(O.y) };
  },

  // ------------------------------------------------------------------ scatter

  scatterWilds() {
    const map = this.map;
    const open = this.open;
    const kindOf = (list, x, y) => list[Math.floor(this.hash(x, y, 451) * list.length)];
    let herbs = 0;
    let berries = 0;
    for (let y = map.y0; y < map.y0 + map.h; y++) {
      for (let x = map.x0; x < map.x0 + map.w; x++) {
        if (inVale(x, y)) continue;
        const i = this.ix(x, y);
        const o = open[i];
        if (o <= -MARGIN || this.clear[i] || this.occ[i]) continue;
        const region = regionAt(x, y);
        const R = TREES[region];
        const band = o > 0 ? 0 : 1;
        const h = this.hash(x, y, 452);
        let p = R.p[band];
        if (band === 1) p *= 0.6 + 0.4 * Math.min(1, -o / MARGIN + 0.4); // thicker toward the wall
        if (h < p) {
          if (!this.canTreeAt(x, y)) continue;
          const kind = kindOf(R.kinds, x, y);
          const o2 = this.put({ objType: 'tree', tx: x, ty: y, kind, v: Math.floor(this.hash(x, y, 453) * (kind === 'pine' ? 2 : 3)), snowy: SNOWY.has(region) });
          if (o2) this.trunk[i] = 1;
          continue;
        }
        const h2 = this.hash(x, y, 454);
        if (R.stump && h2 < R.stump[band]) {
          if (this.canTreeAt(x, y) && this.put({ objType: 'tree', tx: x, ty: y, kind: 'pine', v: 0, state: { depleted: true } })) this.trunk[i] = 1;
          continue;
        }
        if (R.rock && h2 < R.rock[band]) {
          if (this.canTreeAt(x, y) && this.put({ objType: 'rock', tx: x, ty: y, v: Math.floor(this.hash(x, y, 455) * 3) })) this.trunk[i] = 1;
          continue;
        }
        if (R.bush && h2 > 1 - R.bush[band]) {
          if (this.canTreeAt(x, y) && this.put({ objType: 'bush', tx: x, ty: y, name: region === 'heath' ? 'Gorse' : 'Bush', solid: true, low: true, variant: this.hash(x, y, 456) < 0.5 ? 'a' : 'b', shadow: { dx: 1, dy: -1, rx: 7, ry: 3 } }))
            this.trunk[i] = 1;
          continue;
        }
        const h3 = this.hash(x, y, 457);
        if ((region === 'wood' || region === 'pine') && band === 0 && h3 < 0.004 && herbs < 60) herbs += this.put({ objType: 'herb', tx: x, ty: y }) ? 1 : 0;
        else if (region === 'heath' && band === 0 && h3 > 0.9975 && berries < 24) berries += this.put({ objType: 'berry_bush', tx: x, ty: y }) ? 1 : 0;
      }
    }
  },

  decorateWilds() {
    const map = this.map;
    for (let y = map.y0; y < map.y0 + map.h; y++) {
      for (let x = map.x0; x < map.x0 + map.w; x++) {
        if (inVale(x, y)) continue;
        const i = this.ix(x, y);
        if (this.occ[i]) continue;
        const g = map.ground[i];
        const h = this.hash(x, y, 461);
        let d = DECO.NONE;
        switch (g) {
          case T.GRASS:
            if (h < 0.03) d = DECO.FLOWERS;
            else if (h < 0.06) d = DECO.CLOVER;
            else if (h < 0.13) d = DECO.TUFT;
            break;
          case T.HEATH:
            if (h < 0.05) d = DECO.FLOWERS;
            else if (h < 0.11) d = DECO.TUFT;
            else if (h > 0.992) d = DECO.PEBBLES;
            break;
          case T.DEAD_GRASS:
            if (h < 0.05) d = DECO.TUFT;
            else if (h > 0.996) d = DECO.BONES;
            else if (h > 0.985) d = DECO.ASH;
            break;
          case T.FOREST:
            if (h < 0.05) d = DECO.MUSHROOM;
            else if (h < 0.12) d = DECO.LEAVES;
            else if (h < 0.19) d = DECO.FERN;
            else if (h < 0.24) d = DECO.MOSS;
            else if (h < 0.27 && this.nearTrunk(x, y)) d = DECO.ROOTS;
            break;
          case T.SCREE:
          case T.GRAVEL:
            if (h < 0.1) d = DECO.PEBBLES;
            break;
          case T.SNOW:
            if (h < 0.012) d = DECO.PEBBLES;
            break;
          case T.DIRT:
            if (h < 0.05) d = DECO.PEBBLES;
            else if (h > 0.994) d = DECO.PUDDLE;
            break;
          case T.WATER:
            if (h < 0.12 && this.nearLand(x, y)) d = DECO.REEDS;
            break;
          default:
            break;
        }
        if (d) map.deco[i] = d;
      }
    }
  },

  nearLand(x, y) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!WATERY[this.get(x + dx, y + dy)]) return true;
    return false;
  },

  // ------------------------------------------------------------------ locations, spawns

  makeWildsLocations() {
    const C = (p) => [p.x, p.y];
    this.loc('western_heath', { x: -160, y: 62, w: 160, h: 42 }, [-60, 84]);
    this.loc('kings_road_west', { x: -152, y: 80, w: 152, h: 9 }, [-60, 84]);
    this.loc('dead_waystone', { x: -40, y: 72, w: 20, h: 14 }, [P.deadWaystone.x + 1, P.deadWaystone.y + 3]);
    this.loc('long_mile', { x: -114, y: 70, w: 28, h: 18 }, [P.longMile.x + 1, P.longMile.y + 3]);
    this.loc('bracken_ford', { x: -72, y: 78, w: 12, h: 12 }, C(P.ford));
    this.loc('west_fork', { x: -164, y: 76, w: 28, h: 20 }, C(P.westFork));
    this.loc('saltmere_road', { x: -258, y: 88, w: 106, h: 28 }, [-200, 101]);
    this.loc('greyford', { x: -270, y: 96, w: 26, h: 24 }, [P.greyford.x + 3, P.greyford.y]);
    this.loc('brindle_lane', { x: -206, y: 50, w: 58, h: 36 }, [-176, 68]);
    this.loc('brindlecombe', { x: -250, y: 22, w: 72, h: 54 }, [P.brindlecombe.x, P.brindlecombe.y + 5]);
    for (const id of ['brindle_chapel', 'brindle_coll_house', 'brindle_fallow_house', 'brindle_mill_house', 'brindle_haskett_house', 'brindle_lane_house']) {
      const b = this.map.buildings.find((bb) => bb.id === id);
      if (b) this.loc(id, { x: b.x, y: b.y, w: b.w, h: b.h }, [b.doorTiles[0].tx, b.y + b.h - 3], { parent: 'brindlecombe' });
    }
    this.loc('deep_whisperwood', { x: 40, y: -88, w: 72, h: 88 }, [73, -30]);
    this.loc('crown_shrine', { x: 56, y: -54, w: 20, h: 16 }, [P.shrine.x + 2, P.shrine.y + 3], { parent: 'deep_whisperwood' });
    this.loc('treeline_camp', { x: 68, y: -102, w: 28, h: 20 }, [P.treelineCamp.x + 1, P.treelineCamp.y + 3]);
    this.loc('hollowcrown', { x: 40, y: -152, w: 80, h: 50 }, [78, -120]);
    this.loc('crown_ring', { x: 52, y: -194, w: 46, h: 36 }, [P.crownRing.x, P.crownRing.y + 2]);
    this.loc('far_shore', { x: 160, y: 38, w: 44, h: 52 }, C(P.farShore));
    this.loc('cinderwick_fork', { x: 176, y: 8, w: 34, h: 28 }, [P.eastFork.x, P.eastFork.y + 3]);
    this.loc('bandit_lookout', { x: 162, y: -2, w: 20, h: 15 }, [P.lookout.x, P.lookout.y + 3]);
    this.loc('oil_track', { x: 206, y: 12, w: 44, h: 22 }, [222, 22]);
    this.loc('owlsend_track', { x: 180, y: -50, w: 28, h: 58 }, [193, -14]);
    this.loc('far_fields', { x: 160, y: 86, w: 90, h: 34 }, [196, 100]);
  },

  makeWildsSpawns() {
    const S = this.spawns;
    // Spawn zones in the wilds fill only while you are near them (near, in tiles) and
    // let their creatures go when you are far away, so the world stays light.
    const Z = (id, locationId, species, max, rect, night, near = 56) => S.spawnZones.push({ id, locationId, species, max, night, rect, near });
    Z('heath_wolves_night', 'western_heath', ['wolf'], 4, { x: -146, y: 66, w: 136, h: 36 }, true);
    Z('heath_boars', 'western_heath', ['boar'], 3, { x: -146, y: 66, w: 136, h: 36 }, false);
    Z('heath_slimes', 'western_heath', ['slime'], 2, { x: -118, y: 64, w: 90, h: 34 }, undefined);
    Z('saltmere_wolves', 'saltmere_road', ['wolf'], 3, { x: -250, y: 90, w: 96, h: 24 }, undefined);
    Z('brindle_dead_night', 'brindlecombe', ['skeleton'], 3, { x: -236, y: 30, w: 44, h: 40 }, true);
    Z('brindle_bats_night', 'brindlecombe', ['bat'], 3, { x: -236, y: 30, w: 44, h: 40 }, true);
    Z('brindle_wolves', 'brindle_lane', ['wolf'], 2, { x: -200, y: 54, w: 46, h: 30 }, undefined);
    Z('deepwood_wolves', 'deep_whisperwood', ['wolf'], 3, { x: 58, y: -86, w: 32, h: 80 }, false);
    Z('deepwood_wolves_night', 'deep_whisperwood', ['wolf'], 5, { x: 56, y: -88, w: 36, h: 84 }, true);
    Z('deepwood_boars', 'deep_whisperwood', ['boar'], 2, { x: 58, y: -60, w: 30, h: 50 }, undefined);
    Z('deepwood_deer', 'deep_whisperwood', ['deer'], 2, { x: 58, y: -80, w: 30, h: 70 }, undefined);
    Z('hollowcrown_wolves', 'hollowcrown', ['wolf'], 3, { x: 62, y: -146, w: 34, h: 50 }, undefined);
    Z('crown_wolves_night', 'crown_ring', ['wolf'], 2, { x: 56, y: -190, w: 40, h: 30 }, true);
    Z('east_boars', 'far_shore', ['boar'], 2, { x: 164, y: 34, w: 36, h: 52 }, undefined);
    Z('east_deer', 'far_shore', ['deer'], 3, { x: 164, y: 34, w: 36, h: 52 }, false);
    Z('east_slimes', 'far_fields', ['slime'], 2, { x: 170, y: 88, w: 60, h: 26 }, undefined);
    Z('lookout_bandits', 'bandit_lookout', ['bandit', 'bandit_archer'], 2, { x: 166, y: 2, w: 12, h: 9 }, undefined);
    Z('owlsend_wolves', 'owlsend_track', ['wolf'], 2, { x: 184, y: -44, w: 20, h: 50 }, undefined);
    // Two of Varek's men keep the lookout from the start.
    const C = (species, x, y) => {
      const t = this.freeNear(x, y);
      if (t) S.creatures.push({ species, x: px(t.x), y: px(t.y), opts: {} });
    };
    C('bandit', P.lookout.x - 1, P.lookout.y + 1);
    C('bandit_archer', P.lookout.x + 1, P.lookout.y - 2);
    // Where the roads leave the world for good (someone leaving Hearthvale walks off here).
    const at = (p) => ({ x: px(p.x), y: px(p.y) });
    S.exits = {
      west: { ...at({ x: P.greyford.x + 4, y: P.greyford.y }), dir: 'west' },
      east: { ...at({ x: P.rockslide.x - 5, y: P.rockslide.y }), dir: 'east' },
      north: { ...at({ x: P.owlsendTrackEnd.x, y: P.owlsendTrackEnd.y + 3 }), dir: 'north' },
    };
    this.map.exits = S.exits;
  },
};

export function buildWilds(vale, Base) {
  const proto = Object.create(Base.prototype);
  Object.assign(proto, WILDS_METHODS);
  const w = Object.create(proto);
  w.init(vale);
  w.build();
  return w;
}

export { WORLD_X0, WORLD_Y0, WORLD_W, WORLD_H };
