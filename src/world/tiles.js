// Tile and decoration definitions for the world map.
// Contract: export T (name -> id) and tileDef(id) -> { name, solid, water, wall, color, ... }.
//   solid: blocks walkers; water: blocks walkers but not flyers, fishable;
//   wall: blocks projectiles and sight.
// Extra fields used by the world and its art:
//   cost   path cost multiplier (roads are cheap so villagers keep to them)
//   blend  terrain class for soft edge blending (null = crisp, hand-built surface)
//   prio   which soft terrain spills over which (higher wins)
//   tall   casts a contact shadow onto the ground south and east of it
//   low    flyers pass over it (rubble)
//   raised drawn standing up from the ground (a face, a lip, a planter's rim): it must be
//          solid, so nobody walks up a wall (DESIGN §19.8: ground reads true)

export const T = {
  VOID: 0,
  GRASS: 1,
  DIRT: 2,
  WATER: 3, // shallow water
  WALL: 4, // building wall: timber, stone or log, styled by its building
  FLOOR: 5, // wooden plank floor
  DEEP_WATER: 6,
  TALL_GRASS: 7,
  FOREST: 8, // dark forest floor
  COBBLE: 9,
  SAND: 10,
  FARMLAND: 11,
  STONE_FLOOR: 12,
  RUG: 13,
  RUIN_WALL: 14,
  RUIN_FLOOR: 15,
  ROCK: 16, // rock outcrop / cliff
  BRIDGE: 17,
  DOCK: 18,
  PALISADE: 19,
  RUBBLE: 20, // collapsed wall: an impassable heap of stones
  GRAVEL: 21,
  FLOWERBED: 22,
  // The wider world (src/world/wilds.js).
  SNOW: 23, // the Hollowcrown's snowfields: snow at midsummer
  HEATH: 24, // the moor along the King's Road west: heather and gorse
  DEAD_GRASS: 25, // grey, forgotten grass where the grey lingers (Brindlecombe)
  SCREE: 26, // broken stone on the foothills
  THICKET: 27, // wood too thick to walk: the wild's walls (deep Whisperwood, the road's margins)
};

const D = (name, o) => ({
  name,
  solid: false,
  water: false,
  wall: false,
  cost: 1.15,
  blend: null,
  prio: 0,
  tall: false,
  low: false,
  raised: false,
  ...o,
});

const DEFS = [];
DEFS[T.VOID] = D('void', { solid: true, wall: true, color: '#141332', cost: 0 });
DEFS[T.GRASS] = D('grass', { color: '#4a8240', blend: 'grass', prio: 5 });
DEFS[T.DIRT] = D('dirt path', { color: '#9a7049', cost: 1, blend: 'dirt', prio: 3 });
DEFS[T.WATER] = D('shallow water', { solid: true, water: true, color: '#3a86bd', blend: 'water', prio: 0 });
DEFS[T.WALL] = D('wall', { solid: true, wall: true, color: '#c2ab98', tall: true, raised: true });
DEFS[T.FLOOR] = D('plank floor', { color: '#9c6b43', cost: 1 });
DEFS[T.DEEP_WATER] = D('deep water', { solid: true, water: true, color: '#25558a', blend: 'water', prio: 0 });
DEFS[T.TALL_GRASS] = D('tall grass', { color: '#3e7a3c', cost: 1.3, blend: 'tallgrass', prio: 7 });
DEFS[T.FOREST] = D('forest floor', { color: '#2c4530', cost: 1.25, blend: 'forest', prio: 6 });
DEFS[T.COBBLE] = D('cobblestone', { color: '#7d7787', cost: 0.95, blend: 'cobble', prio: 4 });
DEFS[T.SAND] = D('sand', { color: '#e3cc96', cost: 1.2, blend: 'sand', prio: 1 });
DEFS[T.FARMLAND] = D('farmland', { color: '#5a3d2e', cost: 1.3, blend: 'farmland', prio: 3 });
DEFS[T.STONE_FLOOR] = D('stone floor', { color: '#727085', cost: 1 });
DEFS[T.RUG] = D('rug', { color: '#88312f', cost: 1 });
DEFS[T.RUIN_WALL] = D('ruined wall', { solid: true, wall: true, color: '#545266', tall: true, raised: true });
DEFS[T.RUIN_FLOOR] = D('ruined flagstones', { color: '#5f5a69', cost: 1.05, blend: 'ruinfloor', prio: 2 });
DEFS[T.ROCK] = D('rock', { solid: true, wall: true, color: '#727085', tall: true, raised: true });
DEFS[T.BRIDGE] = D('bridge', { color: '#8c5a35', cost: 0.95 });
DEFS[T.DOCK] = D('dock', { color: '#8c5a35', cost: 1 });
DEFS[T.PALISADE] = D('palisade', { solid: true, wall: true, color: '#6b412a', tall: true, raised: true });
DEFS[T.RUBBLE] = D('rubble', { solid: true, color: '#545266', low: true, raised: true });
DEFS[T.GRAVEL] = D('gravel', { color: '#727085', cost: 1.1, blend: 'gravel', prio: 2 });
// A raised planter with a stone rim: you walk round it, not through it.
DEFS[T.FLOWERBED] = D('flower bed', { solid: true, low: true, color: '#b04a6e', cost: 1.6, raised: true });
DEFS[T.SNOW] = D('snow', { color: '#dfe8f2', cost: 1.3, blend: 'snow', prio: 6 });
DEFS[T.HEATH] = D('heath', { color: '#6e5a5e', cost: 1.25, blend: 'heath', prio: 5 });
DEFS[T.DEAD_GRASS] = D('grey grass', { color: '#7d8270', cost: 1.15, blend: 'deadgrass', prio: 5 });
DEFS[T.SCREE] = D('scree', { color: '#8a8794', cost: 1.2, blend: 'scree', prio: 2 });
// A wall of trunks and crowns: blocks feet, arrows and sight like a cliff does.
DEFS[T.THICKET] = D('thicket', { solid: true, wall: true, color: '#1c2f22', tall: true, raised: true, cost: 0 });

for (let i = 0; i < DEFS.length; i++) if (DEFS[i]) DEFS[i].id = i;

export function tileDef(id) {
  return DEFS[id] || DEFS[T.VOID];
}

export const TILE_COUNT = DEFS.length;

// Lookup tables indexed by tile id, so hot loops avoid object property chains.
export const SOLID = new Uint8Array(64);
export const WATERY = new Uint8Array(64);
export const WALLISH = new Uint8Array(64);
export const TALL = new Uint8Array(64);
export const LOW = new Uint8Array(64);
export const COST = new Float32Array(64);
for (let i = 0; i < 64; i++) {
  const d = tileDef(i);
  SOLID[i] = d.solid ? 1 : 0;
  WATERY[i] = d.water ? 1 : 0;
  WALLISH[i] = d.wall ? 1 : 0;
  TALL[i] = d.tall ? 1 : 0;
  LOW[i] = d.low ? 1 : 0;
  COST[i] = d.cost;
}

export const isWaterId = (id) => WATERY[id] === 1;

// Small ground decorations drawn into the cached ground (they never block anything).
// The look is picked from a coordinate hash, so one id covers many variants.
export const DECO = {
  NONE: 0,
  FLOWERS: 1, // a cluster of small flowers; color varies
  CLOVER: 2,
  TUFT: 3, // grass tuft
  PEBBLES: 4,
  MUSHROOM: 5,
  ROOTS: 6,
  LEAVES: 7, // fallen leaves
  MOSS: 8,
  LILY: 9, // lily pad (water)
  REEDS: 10, // reeds (shore and shallows)
  CRACK: 11,
  BONES: 12,
  STRAW: 13,
  FERN: 14,
  CABBAGE: 15, // garden vegetables
  WILDFLOWERS: 16, // dense meadow flowers
  PUDDLE: 17,
  ASH: 18, // scorched ground around camp fires
  DYE: 19, // violet and teal swirls in the stream below the dye-vats
};
