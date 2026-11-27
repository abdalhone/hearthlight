// Mood faces drawn by the game (round 15, item 2; the author: "Lyra put her emotions in
// emojis, and those emojis are the same as in phones … change it for emojis in game. Make
// the same but in a game style"). Every mood a mind names, and every standing a villager
// has with you, is one of these little pixel faces: a round head with the HUD's dark outline,
// in the icons' own palette (src/ui/icons.js), at the same pixel scale. No system emoji is
// drawn anywhere a player looks.
//
// Pure: no DOM. Each face is composed from a head and stamps (eyes, brows, mouth, extras),
// turned into a character grid and then into a crisp SVG data URL, one rect per run, the way
// the UI icons are; unit-tested under node (tests/faces.test.mjs).
//
//   FACE_KINDS                 every face id
//   FACE_SIZE                  { w, h } in art pixels (15 x 14)
//   faceGrid(kind)             the character grid (strings), or null
//   faceSvg(kind) / faceUrl(kind)
//   faceLabel(kind)            a plain word for screen readers and tooltips when no mood
//                              label is given ("happy", "afraid", …)

const PAL = {
  k: '#1a1423', // outline, features
  w: '#f4ead7', // eye whites, a z
  y: '#ffe08a', // the face
  o: '#e4b83d', // its shade
  O: '#a57718',
  r: '#ff6b5e', // blush, a heart, an angry face
  R: '#b53a45', // a mouth, a deep red
  u: '#8ccbe6', // a tear, sweat
  U: '#3f84bd',
  c: '#e6e2f0', // a pale face, a puff of breath
  C: '#9a97b0',
  e: '#ffb047', // a star in the eye
  E: '#ee7f2d',
  n: '#3a3f7a',
};

export const FACE_SIZE = Object.freeze({ w: 15, h: 14 });
const CX = 6;
const CY = 7;
const R = 6.35;

// Skins: the face's fill and shade (an angry face reddens, a frightened one pales).
const SKIN = {
  warm: ['y', 'o'],
  red: ['r', 'R'],
  pale: ['c', 'C'],
};

function head(skin = 'warm', paleTop = false) {
  const { w, h } = FACE_SIZE;
  const g = Array.from({ length: h }, () => Array(w).fill('.'));
  const inside = (x, y) => (x - CX) ** 2 + (y - CY) ** 2 <= R * R;
  const [fill, shade] = SKIN[skin] || SKIN.warm;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < 13; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      if (edge) g[y][x] = 'k';
      else if (x - CX + (y - CY) >= 6) g[y][x] = shade;
      else if (paleTop && y <= CY - 1) g[y][x] = 'c';
      else g[y][x] = fill;
    }
  }
  // A glint of light on the brow.
  g[3][3] = paleTop ? 'w' : skin === 'red' ? 'r' : 'w';
  return g;
}

// Stamps: [x, y, ch] for the left side; `mirror` copies them to the right (x -> 12 - x).
const EYES = {
  dot: [[4, 6, 'k'], [4, 7, 'k']],
  arc: [[3, 7, 'k'], [4, 6, 'k'], [5, 7, 'k']], // ^ smiling eyes
  calm: [[3, 6, 'k'], [4, 7, 'k'], [5, 6, 'k']], // lowered, at peace
  shut: [[3, 7, 'k'], [4, 7, 'k'], [5, 7, 'k']], // closed: tired, proud
  sad: [[3, 7, 'k'], [4, 7, 'k'], [4, 6, 'k']],
  wide: [[3, 5, 'w'], [4, 5, 'w'], [3, 6, 'w'], [4, 6, 'k'], [3, 7, 'w'], [4, 7, 'k']],
  big: [[3, 5, 'k'], [4, 5, 'k'], [5, 5, 'k'], [3, 6, 'k'], [4, 6, 'w'], [5, 6, 'k'], [3, 7, 'k'], [4, 7, 'k'], [5, 7, 'k']],
  star: [[4, 5, 'E'], [3, 6, 'E'], [4, 6, 'w'], [5, 6, 'E'], [4, 7, 'E']],
  side: [[5, 6, 'k'], [5, 7, 'k']], // looking aside
  blank: [[4, 6, 'k'], [4, 7, 'k']],
};
// The squeezed ">  <" is not a mirror image: drawn per side.
const SQUEEZE_L = [[3, 5, 'k'], [4, 6, 'k'], [3, 7, 'k']];
const SQUEEZE_R = [[9, 5, 'k'], [8, 6, 'k'], [9, 7, 'k']];
const BROWS = {
  angry: [[2, 4, 'k'], [3, 4, 'k'], [4, 5, 'k']],
  worried: [[3, 5, 'k'], [4, 4, 'k'], [5, 4, 'k']],
  sad: [[3, 5, 'k'], [4, 4, 'k']],
  raised: [[3, 3, 'k'], [4, 3, 'k'], [5, 3, 'k']],
};
const MOUTH = {
  smile: [[4, 9, 'k'], [5, 10, 'k'], [6, 10, 'k'], [7, 10, 'k'], [8, 9, 'k']],
  small: [[5, 9, 'k'], [6, 10, 'k'], [7, 9, 'k']],
  grin: [[4, 9, 'k'], [5, 9, 'k'], [6, 9, 'k'], [7, 9, 'k'], [8, 9, 'k'], [4, 10, 'k'], [5, 10, 'R'], [6, 10, 'R'], [7, 10, 'R'], [8, 10, 'k'], [5, 11, 'k'], [6, 11, 'k'], [7, 11, 'k']],
  flat: [[5, 10, 'k'], [6, 10, 'k'], [7, 10, 'k']],
  frown: [[4, 11, 'k'], [5, 10, 'k'], [6, 10, 'k'], [7, 10, 'k'], [8, 11, 'k']],
  deep: [[4, 11, 'k'], [5, 10, 'k'], [6, 10, 'k'], [7, 10, 'k'], [8, 11, 'k'], [6, 9, 'k']],
  o: [[6, 9, 'k'], [5, 10, 'k'], [6, 10, 'R'], [7, 10, 'k'], [6, 11, 'k']],
  scream: [[5, 9, 'k'], [6, 9, 'k'], [7, 9, 'k'], [4, 10, 'k'], [5, 10, 'R'], [6, 10, 'R'], [7, 10, 'R'], [8, 10, 'k'], [4, 11, 'k'], [5, 11, 'R'], [6, 11, 'R'], [7, 11, 'R'], [8, 11, 'k'], [5, 12, 'k'], [6, 12, 'k'], [7, 12, 'k']],
  wavy: [[4, 10, 'k'], [5, 9, 'k'], [6, 10, 'k'], [7, 9, 'k'], [8, 10, 'k']],
  teeth: [[4, 9, 'k'], [5, 9, 'k'], [6, 9, 'k'], [7, 9, 'k'], [8, 9, 'k'], [4, 10, 'k'], [5, 10, 'w'], [6, 10, 'k'], [7, 10, 'w'], [8, 10, 'k'], [4, 11, 'k'], [5, 11, 'k'], [6, 11, 'k'], [7, 11, 'k'], [8, 11, 'k']],
  smirk: [[5, 10, 'k'], [6, 10, 'k'], [7, 10, 'k'], [8, 9, 'k']],
  crooked: [[4, 10, 'k'], [5, 10, 'k'], [6, 9, 'k'], [7, 9, 'k']],
  open_sad: [[5, 9, 'k'], [6, 9, 'k'], [7, 9, 'k'], [4, 10, 'k'], [5, 10, 'R'], [6, 10, 'R'], [7, 10, 'R'], [8, 10, 'k'], [4, 11, 'k'], [8, 11, 'k']],
  yawn: [[5, 9, 'k'], [6, 9, 'k'], [7, 9, 'k'], [5, 10, 'k'], [6, 10, 'R'], [7, 10, 'k'], [5, 11, 'k'], [6, 11, 'k'], [7, 11, 'k']],
  none: [],
};
const EXTRA = {
  tear: [[3, 8, 'u'], [3, 9, 'U']],
  tears: [[3, 8, 'u'], [3, 9, 'U'], [9, 8, 'u'], [9, 9, 'U']],
  sweat: [[12, 1, 'u'], [11, 2, 'u'], [12, 2, 'U']],
  blush: [[2, 8, 'r'], [3, 8, 'r'], [9, 8, 'r'], [10, 8, 'r']],
  heart: [[12, 0, 'r'], [14, 0, 'r'], [12, 1, 'r'], [13, 1, 'r'], [14, 1, 'r'], [13, 2, 'r']],
  broken: [[12, 0, 'R'], [14, 0, 'R'], [12, 1, 'R'], [13, 1, 'k'], [14, 1, 'R'], [13, 2, 'R']],
  zzz: [[12, 0, 'w'], [13, 0, 'w'], [14, 0, 'w'], [13, 1, 'w'], [12, 2, 'w'], [13, 2, 'w'], [14, 2, 'w']],
  puff: [[13, 9, 'c'], [14, 8, 'c'], [14, 10, 'C']],
  vein: [[11, 2, 'R'], [12, 1, 'R'], [12, 3, 'R'], [13, 2, 'R']],
  dots: [[11, 1, 'w'], [13, 1, 'w']],
  bubble: [[13, 11, 'u'], [13, 12, 'U']],
};

// Each face: { eyes, brows, mouth, extra: [...], skin, pale, label }.
const SPECS = {
  delighted: { eyes: 'arc', mouth: 'grin', label: 'delighted' },
  happy: { eyes: 'arc', mouth: 'smile', label: 'happy' },
  lively: { eyes: 'dot', mouth: 'grin', label: 'lively' },
  content: { eyes: 'dot', mouth: 'small', label: 'content' },
  calm: { eyes: 'calm', mouth: 'small', label: 'calm' },
  neutral: { eyes: 'dot', mouth: 'flat', label: 'neutral' },
  guarded: { eyes: 'side', mouth: 'flat', label: 'guarded' },
  blank: { eyes: 'blank', mouth: 'none', label: 'quiet' },
  affectionate: { eyes: 'arc', mouth: 'smile', extra: ['blush', 'heart'], label: 'affectionate' },
  fascinated: { eyes: 'star', mouth: 'small', label: 'fascinated' },
  curious: { eyes: 'side', mouth: 'flat', brows: 'raised', extra: ['dots'], label: 'curious' },
  proud: { eyes: 'shut', mouth: 'smirk', brows: 'raised', label: 'proud' },
  flustered: { eyes: 'wide', mouth: 'small', extra: ['blush', 'sweat'], label: 'flustered' },
  startled: { eyes: 'big', mouth: 'o', brows: 'raised', label: 'startled' },
  shocked: { eyes: 'big', mouth: 'scream', brows: 'worried', extra: ['sweat'], pale: true, label: 'shocked' },
  afraid: { eyes: 'wide', mouth: 'wavy', brows: 'worried', extra: ['sweat'], label: 'afraid' },
  terrified: { eyes: 'big', mouth: 'scream', brows: 'worried', extra: ['sweat', 'tears'], pale: true, label: 'terrified' },
  uneasy: { eyes: 'dot', mouth: 'wavy', brows: 'worried', label: 'uneasy' },
  on_edge: { eyes: 'wide', mouth: 'teeth', brows: 'worried', extra: ['sweat'], label: 'on edge' },
  restless: { eyes: 'side', mouth: 'crooked', label: 'restless' },
  sad: { eyes: 'sad', mouth: 'frown', brows: 'sad', label: 'sad' },
  heartsick: { eyes: 'sad', mouth: 'open_sad', brows: 'sad', extra: ['tears'], label: 'heartsick' },
  grieving: { eyes: 'shut', mouth: 'deep', brows: 'sad', extra: ['tears'], label: 'grieving' },
  hurt: { eyes: 'sad', mouth: 'frown', brows: 'worried', extra: ['tear', 'broken'], label: 'hurt' },
  miserable: { eyes: 'shut', mouth: 'deep', brows: 'sad', label: 'miserable' },
  distressed: { eyes: 'squeeze', mouth: 'frown', brows: 'worried', extra: ['sweat'], label: 'distressed' },
  angry: { eyes: 'dot', mouth: 'frown', brows: 'angry', label: 'angry' },
  furious: { eyes: 'dot', mouth: 'teeth', brows: 'angry', extra: ['vein'], skin: 'red', label: 'furious' },
  cold: { eyes: 'shut', mouth: 'flat', brows: 'angry', label: 'cold' },
  exhausted: { eyes: 'shut', mouth: 'yawn', extra: ['zzz'], label: 'exhausted' },
  starving: { eyes: 'squeeze', mouth: 'open_sad', extra: ['bubble'], label: 'starving' },
  relieved: { eyes: 'shut', mouth: 'o', extra: ['puff'], label: 'relieved' },
};

export const FACE_KINDS = Object.freeze(Object.keys(SPECS));

function stamp(g, list, mirror = false) {
  for (const [x, y, ch] of list) {
    if (g[y] && x >= 0 && x < g[y].length) g[y][x] = ch;
    if (mirror) {
      const mx = 12 - x;
      if (g[y] && mx >= 0 && mx < g[y].length && mx !== x) g[y][mx] = ch;
    }
  }
}

const grids = new Map();

export function faceGrid(kind) {
  if (grids.has(kind)) return grids.get(kind);
  const s = SPECS[kind];
  if (!s) return null;
  const g = head(s.skin || 'warm', !!s.pale);
  if (s.brows) stamp(g, BROWS[s.brows] || [], true);
  if (s.eyes === 'squeeze') {
    stamp(g, SQUEEZE_L);
    stamp(g, SQUEEZE_R);
  } else stamp(g, EYES[s.eyes] || EYES.dot, true);
  stamp(g, MOUTH[s.mouth] || []);
  for (const x of s.extra || []) stamp(g, EXTRA[x] || []);
  const rows = g.map((r) => r.join(''));
  grids.set(kind, rows);
  return rows;
}

export function faceLabel(kind) {
  return SPECS[kind]?.label || 'neutral';
}

export function faceSvg(kind) {
  const grid = faceGrid(kind);
  if (!grid) return '';
  const { w, h } = FACE_SIZE;
  let rects = '';
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.' || !PAL[ch]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < row.length && row[x + run] === ch) run++;
      rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${PAL[ch]}"/>`;
      x += run;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges">${rects}</svg>`;
}

const urls = new Map();
export function faceUrl(kind) {
  let u = urls.get(kind);
  if (u === undefined) {
    const svg = faceSvg(kind);
    u = svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : '';
    urls.set(kind, u);
  }
  return u;
}

export const FACE_PALETTE = PAL;

// Small marks drawn by the game where a phone would draw its own colour emoji (round 15,
// item 2: the price chips' heart, hot-spring and skull characters, a gift's heart). 7 x 7, the same palette and scale as
// the UI icons; one rect per run.
export const GLYPHS = {
  heart: ['.kk.kk.', 'krrkrRk', 'krrrrRk', '.krrRk.', '..kRk..', '...k...', '.......'],
  burst: ['k..k..k', '.kekek.', '..eye..', 'keyyyek', '..eye..', '.kekek.', 'k..k..k'],
  diamond: ['...k...', '..kuk..', '.kuwuk.', 'kuwuuUk', '.kuuUk.', '..kUk..', '...k...'],
  infinity: ['.......', '.kk.kk.', 'kaakaak', 'ka.k.ak', 'kaakaak', '.kk.kk.', '.......'],
  steam: ['.c.c.c.', 'c.c.c..', '.c.c.c.', '.......', 'kkkkkkk', 'kreeerk', '.kkkkk.'],
  star: ['...k...', '..kyk..', 'kkyyykk', 'kyywyyk', '.kyyyk.', 'kyk.kyk', 'kk...kk'],
  rings: ['.......', '.kk.kk.', 'koOkoOk', 'ko.k.Ok', 'koOkoOk', '.kk.kk.', '.......'],
  skull: ['.kkkkk.', 'kwwwwwk', 'kwkwkwk', 'kwwwwwk', '.kwkwk.', '.kwwwk.', '..kkk..'],
};

export function glyphSvg(name) {
  const grid = GLYPHS[name];
  if (!grid) return '';
  const h = grid.length;
  const w = Math.max(...grid.map((r) => r.length));
  let rects = '';
  for (let y = 0; y < h; y++) {
    const row = grid[y];
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.' || !PAL[ch]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < row.length && row[x + run] === ch) run++;
      rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${PAL[ch]}"/>`;
      x += run;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges">${rects}</svg>`;
}

export function glyphUrl(name) {
  const key = `glyph:${name}`;
  let u = urls.get(key);
  if (u === undefined) {
    const svg = glyphSvg(name);
    u = svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : '';
    urls.set(key, u);
  }
  return u;
}

// A mind's words never carry a phone's emoji into the game (Claude is asked for none; this
// makes sure): pictographs, their variation selector and joiners go, the words stay.
const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{FE0F}\u{200D}\u{20E3}]/gu;
export function stripEmoji(text) {
  const s = String(text ?? '');
  if (!EMOJI_RE.test(s)) return s;
  EMOJI_RE.lastIndex = 0;
  return s.replace(EMOJI_RE, '').replace(/[ \t]{2,}/g, ' ').trim();
}
