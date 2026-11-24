// Pixel glyphs for the Weave (DESIGN.md §22.4): one per shape, tinted by a weave's
// palette, so a hotbar slot reads "fire bolt" or "frost nova" at a glance; essences are
// gems in their own colours with a symbol; twists are small parchment marks. Grids turn
// into crisp SVG data URLs like src/ui/icons.js. Pure: no DOM, unit-tested.
//
// Letters: k outline, d deep, g glow, c core, s spark (palette tones); w parchment,
// p dim parchment, a arcane, A deep arcane (fixed tones). '.' is empty.

import { ESSENCE_INFO, mixHex } from './weave_meta.js';

const FIXED = { k: '#1a1423', w: '#f4ead7', p: '#b9ad99', a: '#a995ff', A: '#6a52c9', e: '#ffb047' };

export const SHAPE_GLYPHS = {
  bolt: [
    '.......kkk.',
    '......kcssk',
    '.....kccssk',
    '....kgcccsk',
    '...kggccck.',
    '..kdggck...',
    '.kddgk.....',
    'kddk.......',
    'kdk........',
    '.k.........',
    '...........',
  ],
  blast: [
    '........kk.',
    '......kkgsk',
    '....kkggcsk',
    '..kkdggccsk',
    'kkddggcccsk',
    'kdgccssssck',
    'kkddggcccsk',
    '..kkdggccsk',
    '....kkggcsk',
    '......kkgsk',
    '........kk.',
  ],
  strike: [
    '.......k...',
    '..kkkk..k..',
    '.kcssck..k.',
    'kccccsck..k',
    'kcccccck..k',
    'kgccccck..k',
    'kggcccck..k',
    'kdggggck.k.',
    '.kdddgk.k..',
    '..kkkk..k..',
    '...........',
  ],
  throw: [
    '...g.g.....',
    '.g.....g...',
    'g........g.',
    '...........',
    'g.......kkk',
    '.......kcsk',
    '......kccsk',
    '......kgcck',
    '..s..s.kkk.',
    '...sggs....',
    '.ssgccgss..',
  ],
  beam: [
    '...........',
    '...........',
    'kk.........',
    'kgkkkkkkkkk',
    'kcggggggggg',
    'kssssssssss',
    'kcggggggggg',
    'kgkkkkkkkkk',
    'kk.........',
    '...........',
    '...........',
  ],
  nova: [
    '...kgggk...',
    '.kgg...ggk.',
    '.g.......g.',
    'kg..kkk..gk',
    'g..kcsck..g',
    'g..kssck..g',
    'g..kccck..g',
    'kg..kkk..gk',
    '.g.......g.',
    '.kgg...ggk.',
    '...kgggk...',
  ],
  orb: [
    '...kkkkk...',
    '..kggcggk..',
    '.kgcsscggk.',
    'kgcssccggdk',
    'kgcscccggdk',
    'kgcccccgddk',
    'kggcccggddk',
    'kdggggggddk',
    '.kddgggddk.',
    '..kdddddk..',
    '...kkkkk...',
  ],
  summon: [
    '..k.....k..',
    '.kgk...kgk.',
    '.kgckkkcgk.',
    'kgcccccccgk',
    'kccsccsccck',
    'kcckcccckck',
    'kgcccccccgk',
    '.kgggcgggk.',
    '..kdgkgdk..',
    '...kk.kk...',
    '...........',
  ],
  rune: [
    '...........',
    '....kgk....',
    '...kgsgk...',
    '..kgk.kgk..',
    '.kgk.c.kgk.',
    'kgs.ccc.sgk',
    '.kgk.c.kgk.',
    '..kgk.kgk..',
    '...kgsgk...',
    '....kgk....',
    '...........',
  ],
  rain: [
    '..s....s...',
    '..c..s.c...',
    '.kc..c.c.s.',
    '.kg..c.kg..',
    '..g.kg..g..',
    '.s...g.s...',
    '.c..s..c...',
    'kc..c..cs..',
    'kg.kc.kgc..',
    '.g..g..g...',
    'dgggggggggd',
  ],
  wall: [
    '...........',
    '.kkk.kkk.kk',
    'kcsckcsckcs',
    'kccckccckcc',
    'kgcckgcckgc',
    'kggckggckgg',
    'kggckggckgg',
    'kdggkdggkdg',
    'kddgkddgkdd',
    'kkkkkkkkkkk',
    '...........',
  ],
  dash: [
    '...........',
    '......kkk..',
    '..d..kcssk.',
    '.....kccsk.',
    'dd.ggkcccsk',
    '..ggkccccck',
    'dd.ggkcccsk',
    '.....kccsk.',
    '..d..kcssk.',
    '......kkk..',
    '...........',
  ],
};

// A gem in the essence's own palette, with a symbol in its spark tone ('s').
const GEM = [
  '...kkkkk...',
  '..kgggggk..',
  '.kgcccccgk.',
  'kgcccccccdk',
  'kgcccccccdk',
  'kgcccccccdk',
  'kgcccccccdk',
  'kdgcccccddk',
  '.kdgccgddk.',
  '..kdddddk..',
  '...kkkkk...',
];

// 5×5 symbols laid on the gem's face (top-left at 3,3).
export const ESSENCE_SYMBOLS = {
  raw: ['..s..', '.s.s.', 's...s', '.s.s.', '..s..'],
  fire: ['..s..', '.ss..', '.sss.', 'sssss', '.sss.'],
  water: ['..s..', '..s..', '.sss.', 'sssss', '.sss.'],
  frost: ['s.s.s', '.sss.', 'sssss', '.sss.', 's.s.s'],
  storm: ['..ss.', '.ss..', 'ssss.', '..ss.', '.ss..'],
  earth: ['.....', '.ss..', 'ssss.', 'sssss', '.....'],
  wind: ['ssss.', '....s', '.sss.', 's....', '.ssss'],
  nature: ['...ss', '.ssss', 'ssss.', 's.s..', 's....'],
  poison: ['.s...', '...s.', '.sss.', 'sssss', '.sss.'],
  light: ['s.s.s', '.sss.', 'ss.ss', '.sss.', 's.s.s'],
  dark: ['.sss.', 'ss...', 's....', 'ss...', '.sss.'],
  iron: ['.sss.', 's.s.s', 'sssss', 's.s.s', '.sss.'],
  song: ['..sss', '..s.s', '..s.s', 'ss.ss', 'ss.ss'],
};

export const TWIST_GLYPHS = {
  multishot: ['w...w...w', '.w..w..w.', '..w.w.w..', '...www...', '....a....', '....a....', '...aaa...'],
  split: ['w.......w', '.w.....w.', '..w...w..', '...w.w...', '....w....', '....a....', '...aaa...'],
  pierce: ['....p....', '....p....', 'wwwwpwww.', 'wwwwpwwww', 'wwwwpwww.', '....p....', '....p....'],
  bounce: ['.......w.', '......w.w', '..a..w...', '.aaaw....', '..aw.....', '.w.......', 'pppppppp.'],
  chain: ['.ww......', 'w..w.....', 'w..ww....', '.ww..ww..', '....ww..w', '.....w..w', '......ww.'],
  homing: ['..www....', '.w...w...', 'w.....w..', 'w......w.', '......www', '.......w.', 'a........'],
  echo: ['..aa.ww..', '.a..w..w.', 'a..w....w', 'a..w....w', 'a..w....w', '.a..w..w.', '..aa.ww..'],
  big: ['ww.....ww', 'w.......w', '...aaa...', '...aaa...', '...aaa...', 'w.......w', 'ww.....ww'],
  swift: ['w...w....', '.w...w...', '..w...w..', '...w...w.', '..w...w..', '.w...w...', 'w...w....'],
  burst: ['w...w...w', '.w..w..w.', '...aaa...', 'wwaaaaaww', '...aaa...', '.w..w..w.', 'w...w...w'],
  linger: ['..w...w..', '.w...w...', '..w...w..', '.........', '.aaaaaaa.', 'aaaaaaaaa', '.aaaaaaa.'],
  orbit: ['..www....', '.w...w.a.', 'w.....aaa', 'w..p..wa.', 'w.....w..', '.w...w...', '..www....'],
  volley: ['.........', '.........', 'w..w..w..', 'ww.ww.ww.', 'w..w..w..', '.........', '.........'],
  spiral: ['.wwwww...', 'w.....w..', 'w.www.w..', 'w.w.a.w..', 'w.w...w..', 'w..www...', '.w.......'],
  leech: ['....w....', '...www...', '..wwwww..', '..wwwww..', '...www...', '.a.....a.', '..aaaaa..'],
  charge: ['....e....', '...ee....', '..eee....', '.eeeeeee.', '....eee..', '....ee...', '....e....'],
};

const cache = new Map();

function svgFromGrid(grid, color) {
  const h = grid.length;
  const w = Math.max(...grid.map((r) => r.length));
  let rects = '';
  for (let y = 0; y < h; y++) {
    const row = grid[y];
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      const fill = color(ch);
      if (!fill) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < row.length && row[x + run] === ch) run++;
      rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${fill}"/>`;
      x += run;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges">${rects}</svg>`;
}

function toUrl(svg) {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function toneOf(pal) {
  return (ch) => {
    if (ch === 'c') return pal.core;
    if (ch === 'g') return pal.glow;
    if (ch === 's') return pal.spark;
    if (ch === 'd') return pal.deep;
    return FIXED[ch] || null;
  };
}

const RAW = ESSENCE_INFO.raw.palette;

// A shape glyph tinted by a palette (a weave's blended colours).
export function shapeIconUrl(shape, palette = RAW) {
  const pal = palette || RAW;
  const key = `s:${shape}:${pal.core}${pal.glow}${pal.spark}${pal.deep}`;
  let u = cache.get(key);
  if (u === undefined) {
    const grid = SHAPE_GLYPHS[shape] || SHAPE_GLYPHS.orb;
    u = toUrl(svgFromGrid(grid, toneOf(pal)));
    cache.set(key, u);
  }
  return u;
}

// A dark silhouette of any glyph: locked components (DESIGN §22.4: "found by…").
export function silhouetteUrl(kind, id) {
  const key = `x:${kind}:${id}`;
  let u = cache.get(key);
  if (u === undefined) {
    const grid = kind === 'shapes' ? SHAPE_GLYPHS[id] || SHAPE_GLYPHS.orb : kind === 'essences' ? GEM : TWIST_GLYPHS[id] || TWIST_GLYPHS.big;
    u = toUrl(svgFromGrid(grid, (ch) => (ch === '.' ? null : ch === 'k' ? '#0d0b1c' : '#3a3870')));
    cache.set(key, u);
  }
  return u;
}

export function essenceGrid(id) {
  const sym = ESSENCE_SYMBOLS[id] || ESSENCE_SYMBOLS.raw;
  const rows = GEM.map((r) => r.split(''));
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (sym[y][x] === 's') rows[y + 3][x + 3] = 's';
  return rows.map((r) => r.join(''));
}

export function essenceIconUrl(id, palette) {
  const pal = palette || ESSENCE_INFO[id]?.palette || RAW;
  const key = `e:${id}:${pal.core}${pal.glow}`;
  let u = cache.get(key);
  if (u === undefined) {
    // The symbol needs contrast against a pale core: use the deep tone on light gems.
    const spark = isLight(pal.core) ? mixHex(pal.deep, '#1a1423', 0.2) : pal.spark;
    u = toUrl(svgFromGrid(essenceGrid(id), toneOf({ ...pal, spark })));
    cache.set(key, u);
  }
  return u;
}

export function twistIconUrl(id) {
  const key = `t:${id}`;
  let u = cache.get(key);
  if (u === undefined) {
    u = toUrl(svgFromGrid(TWIST_GLYPHS[id] || TWIST_GLYPHS.big, (ch) => FIXED[ch] || null));
    cache.set(key, u);
  }
  return u;
}

function isLight(hex) {
  const s = String(hex || '').replace('#', '');
  if (s.length < 6) return false;
  const n = parseInt(s.slice(0, 6), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 200;
}

export function glyphSize(kind, id) {
  const grid = kind === 'shapes' ? SHAPE_GLYPHS[id] || SHAPE_GLYPHS.orb : kind === 'essences' ? GEM : TWIST_GLYPHS[id] || TWIST_GLYPHS.big;
  return { w: Math.max(...grid.map((r) => r.length)), h: grid.length };
}

// The Spellbook's own mark: a violet-bound book with an ember glyph.
const BOOK = [
  '.kkkkkkk.',
  'kAaaaaaak',
  'kAaeeeaak',
  'kAaeAeaak',
  'kAaeeeaak',
  'kAaaaaaak',
  'kAwwwwwwk',
  'kAkkkkkkk',
  '.k.......',
];

export function spellbookIconUrl() {
  let u = cache.get('book');
  if (u === undefined) {
    u = toUrl(svgFromGrid(BOOK, (ch) => FIXED[ch] || null));
    cache.set('book', u);
  }
  return u;
}

export const SPELLBOOK_ICON_SIZE = { w: 9, h: 9 };
