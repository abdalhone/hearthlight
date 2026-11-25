// The lay of the wider world (DESIGN §32, docs/LORE.md §1 and §10): the roads you walk
// out of the vale, the land each one opens, and where the places on them stand.
// Data only; src/world/wilds.js builds it. Tiles, north up. The vale (worldgen.js) keeps
// tiles 0..159 by 0..119; the world runs from (WORLD_X0, WORLD_Y0) in constants.js.
//
// Distances are squeezed for play but walked, never skipped: from the square it is
// about a minute and a half on foot to Brindlecombe, a minute and a half up to the
// Crown Ring, and under a minute to the Cinderwick fork (DESIGN §32.2 has the numbers).

export const VALE_RECT = { x0: 0, y0: 0, x1: 159, y1: 119 };
export const inVale = (x, y) => x >= 0 && y >= 0 && x < 160 && y < 120;

// Where the vale opens onto the wilds: the ring of trees that walls the vale's edges is
// left out here, so the roads walk on (worldgen.js treeDensity). Tiles, inclusive.
export const SEAMS = [
  { side: 'west', x0: 0, x1: 2, y0: 70, y1: 98 }, // the King's Road west, toward Saltmere
  { side: 'north', x0: 62, x1: 86, y0: 0, y1: 2 }, // the old Crown path into the deep Whisperwood
  { side: 'east', x0: 157, x1: 159, y0: 72, y1: 96 }, // the King's Road east, round the lake
];
export const inSeam = (x, y) => SEAMS.some((s) => x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1);

// Places worth a name on the map (tile centers).
export const P = {
  deadWaystone: { x: -30, y: 80 }, // "a mile down the road": Lyra lit it for one night
  ford: { x: -66, y: 84 }, // the Bracken Water crosses the King's Road
  longMile: { x: -100, y: 80 }, // a waystone that still burns
  westFork: { x: -150, y: 86 }, // the King's Road bends south-west; the Brindle lane goes on
  greyford: { x: -258, y: 108 }, // the bridge the spring floods took
  brindlecombe: { x: -214, y: 50 }, // the dead village: its square and wardstone
  crownPathFoot: { x: 73, y: -6 },
  shrine: { x: 66, y: -46 }, // a Lanternwright marker stone in the deep wood
  tarnFord: { x: 74, y: -66 }, // a cold stream across the Crown path
  treelineCamp: { x: 82, y: -92 }, // where Lyra and Hess camped, the night before the ring
  crownRing: { x: 75, y: -176 }, // nine stones, snow at midsummer
  farShore: { x: 182, y: 66 },
  eastFork: { x: 192, y: 22 }, // the Cinderwick fork and its burning waystone
  lookout: { x: 172, y: 6 }, // the bandits' hill above the fork
  rockslide: { x: 234, y: 23 }, // the oil track, buried
  owlsendTrackEnd: { x: 194, y: -46 }, // the north track, closed by fallen pines
};

// Roads and paths, drawn as ground. width in tiles; tile 'dirt' | 'gravel' | 'track'.
export const ROADS = [
  {
    id: 'kings_road_west',
    width: 3,
    points: [
      [0, 84],
      [-24, 84],
      [-46, 85],
      [-66, 84],
      [-86, 82.5],
      [-112, 83],
      [-134, 85],
      [-150, 86],
    ],
  },
  {
    id: 'saltmere_road',
    width: 3,
    points: [
      [-150, 86],
      [-170, 92],
      [-192, 99],
      [-214, 104],
      [-236, 107],
      [-252, 108],
    ],
  },
  {
    id: 'brindle_lane',
    width: 2,
    points: [
      [-150, 86],
      [-160, 77],
      [-172, 69],
      [-188, 61],
      [-202, 55],
      [-210, 52],
    ],
  },
  {
    id: 'crown_path',
    width: 2,
    tile: 'track',
    points: [
      [73.5, 0],
      [71, -14],
      [77, -30],
      [70, -44],
      [66, -56],
      [74, -66],
      [80, -80],
      [82, -92],
    ],
  },
  {
    id: 'crown_climb',
    width: 2,
    tile: 'gravel',
    points: [
      [82, -92],
      [70, -103],
      [86, -114],
      [69, -126],
      [84, -138],
      [76, -148],
    ],
  },
  {
    id: 'kings_road_east',
    width: 3,
    points: [
      [159, 84],
      [172, 84],
      [180, 79],
      [184, 66],
      [186, 50],
      [189, 36],
      [192, 24],
    ],
  },
  {
    id: 'oil_track',
    width: 2,
    points: [
      [192, 22],
      [206, 25],
      [220, 22],
      [232, 23],
    ],
  },
  {
    id: 'owlsend_track',
    width: 2,
    tile: 'track',
    points: [
      [192, 20],
      [195, 6],
      [190, -10],
      [196, -28],
      [194, -44],
    ],
  },
  {
    id: 'lookout_path',
    width: 2,
    tile: 'track',
    points: [
      [190, 20],
      [182, 13],
      [174, 8],
    ],
  },
];

// The walkable land: corridors along the roads (hw = half-width in tiles) and open
// places (ellipses). Everything else is the wilds' wall: thicket, or cliff on the
// mountain. `region` picks the ground and the wood.
export const LAND = [
  // West: the heath along the King's Road.
  { region: 'heath', hw: 15, points: ROADS[0].points },
  { region: 'heath', hw: 12, points: ROADS[1].points },
  { region: 'heath', hw: 10, points: ROADS[2].points },
  { region: 'heath', cx: -30, cy: 78, rx: 14, ry: 11 },
  { region: 'heath', cx: -100, cy: 79, rx: 18, ry: 14 },
  { region: 'heath', cx: -150, cy: 86, rx: 16, ry: 13 },
  { region: 'heath', cx: -250, cy: 106, rx: 18, ry: 12 },
  { region: 'grey', cx: -214, cy: 50, rx: 34, ry: 26 },
  // North: the deep Whisperwood, then the Hollowcrown's foothills and its snow.
  { region: 'wood', hw: 9, points: ROADS[3].points },
  { region: 'wood', cx: 66, cy: -46, rx: 9, ry: 7 },
  { region: 'wood', cx: 82, cy: -92, rx: 12, ry: 9 },
  { region: 'foothill', hw: 8, points: ROADS[4].points },
  { region: 'snow', hw: 10, points: [[76, -146], [75, -162], [75, -170]] },
  { region: 'snow', cx: 75, cy: -174, rx: 22, ry: 17 },
  // East: round the far shore of Mirror Lake to the fork; the oil track; the north track.
  { region: 'east', hw: 13, points: ROADS[5].points },
  { region: 'east', cx: 192, cy: 22, rx: 16, ry: 13 },
  { region: 'east', hw: 6, points: ROADS[6].points },
  { region: 'pine', hw: 7, points: ROADS[7].points },
  { region: 'east', hw: 6, points: ROADS[8].points },
  { region: 'east', cx: 172, cy: 6, rx: 9, ry: 7 },
  { region: 'east', cx: 196, cy: 100, rx: 34, ry: 18 }, // the far fields, south of the road
];

// Which country a tile lies in, for its ground and its wood (and the art's thicket kind).
export function regionAt(x, y) {
  if (y < -146 + Math.sin(x * 0.11) * 3) return 'snow';
  if (y < -96 && x > -40 && x < 160) return 'foothill';
  if (x >= 160 && y < -4) return 'pine';
  if (y < 0) return 'wood';
  if (x < 0) {
    const dx = (x + 214) / 44;
    const dy = (y - 50) / 34;
    if (dx * dx + dy * dy < 1) return 'grey';
    return 'heath';
  }
  return 'east';
}

// Water in the wilds: still pools and the rivers (points, width), and fords where a road
// crosses shallow water (walkable: T.SHALLOWS).
export const WATERS = {
  pools: [
    { cx: -112, cy: 70, rx: 4.5, ry: 3 },
    { cx: -40, cy: 92, rx: 3.5, ry: 2.2 },
    { cx: -232, cy: 38, rx: 5, ry: 3.2 }, // Brindlecombe's mill pond
    { cx: 90, cy: -96, rx: 4, ry: 2.6 }, // the tarn by the treeline camp
    { cx: 205, cy: 96, rx: 4, ry: 2.5 },
  ],
  rivers: [
    // The Bracken Water runs south across the King's Road west (a ford).
    {
      width: 2.6,
      ford: true,
      points: [
        [-60, 60],
        [-64, 72],
        [-66, 84],
        [-63, 96],
        [-66, 112],
        [-64, 120],
      ],
    },
    // The Grey, at the world's west edge: the Greyford's bridge is gone.
    {
      width: 7,
      deep: true,
      points: [
        [-262, 60],
        [-261, 84],
        [-263, 108],
        [-262, 120],
      ],
    },
    // A cold stream off the mountain, across the Crown path.
    {
      width: 2.2,
      ford: true,
      points: [
        [50, -58],
        [62, -63],
        [74, -66],
        [86, -70],
        [98, -68],
      ],
    },
    // The Owlsend track crosses a beck.
    {
      width: 2.2,
      ford: true,
      points: [
        [180, -16],
        [190, -18],
        [200, -14],
      ],
    },
  ],
};
