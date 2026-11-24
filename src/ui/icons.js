// Hand-drawn pixel icons for the DOM UI, stored as character grids and turned into
// crisp SVG data URLs (shape-rendering: crispEdges). Pure: no DOM access, so the
// grids are validated by unit tests.

const PAL = {
  k: '#1a1423', // outline
  w: '#f4ead7', // parchment
  d: '#b9ad99', // dim parchment
  e: '#ffb047', // ember
  E: '#ee7f2d',
  y: '#ffe08a',
  r: '#ff6b5e', // coral
  R: '#b53a45',
  a: '#a995ff', // arcane
  A: '#6a52c9',
  g: '#58cf8f', // heal
  G: '#2f8f62',
  s: '#cfd4dc', // iron
  S: '#7d8392',
  b: '#c08a52', // wood
  B: '#7a4c2c',
  u: '#8ccbe6', // water
  U: '#3f84bd',
  c: '#e6e2f0', // cloud
  C: '#9a97b0',
  o: '#e4b83d', // gold
  O: '#a57718',
  n: '#3a3f7a', // night blue
};

export const ICONS = {
  heart: [
    '.kk...kk.',
    'kwrk.krrk',
    'krrrkrrRk',
    'krrrrrrRk',
    '.krrrrRk.',
    '..krrRk..',
    '...kRk...',
    '....k....',
  ],
  heart_arcane: [
    '.kk...kk.',
    'kwak.kaak',
    'kaaakaaAk',
    'kaaaaaaAk',
    '.kaaaaAk.',
    '..kaaAk..',
    '...kAk...',
    '....k....',
  ],
  coin: [
    '..kkkk..',
    '.kyyyok.',
    'kyyoooOk',
    'kyoyyoOk',
    'kyoyyoOk',
    'kyooooOk',
    '.kOOOOk.',
    '..kkkk..',
  ],
  sword: [
    '.......kk',
    '......kwk',
    '.....kwsk',
    '....kwsk.',
    'k..kwsk..',
    'kkkwsk...',
    '.kBkk....',
    'kBkkk....',
    'kk..kk...',
  ],
  shield: [
    'kkkkkkkkk',
    'kwssesssk',
    'kssseeSSk',
    'kseeeeeSk',
    'ksssesSSk',
    '.kssesSk.',
    '.kSSeSSk.',
    '..kSSSk..',
    '...kkk...',
  ],
  feather: [
    '......kk.',
    '.....kgwk',
    '....kggGk',
    '...kgggk.',
    '..kgggGk.',
    '..kggGk..',
    '.kGgGk...',
    '.kkkk....',
    'kk.......',
  ],
  boots: [
    '.kkk.....',
    '.kbk.kkk.',
    '.kbk.kbk.',
    '.kbk.kbk.',
    '.kbbkkbk.',
    '.kbbbkbbk',
    '.kBBBkbbb',
    '..kkk.kkk',
  ],
  flag: [
    'kk.......',
    'kwkkkkk..',
    'kwkeeeeek',
    'kwkeeEEk.',
    'kwkeeeeek',
    'kwkkkkkk.',
    'kwk......',
    'kwk......',
    'kkk......',
  ],
  axe: [
    '..kkkk...',
    '.kssssk..',
    'kwsssSkk.',
    'kssSkkbk.',
    '.kkk.kbk.',
    '....kbk..',
    '...kbk...',
    '..kBk....',
    '..kk.....',
  ],
  talk: [
    '.kkkkkkk.',
    'kwwwwwwwk',
    'kwkwkwkdk',
    'kwwwwwwdk',
    '.kkwddkk.',
    '...kwk...',
    '...kk....',
  ],
  sun: [
    '....e....',
    '.e.kkk.e.',
    '..kyyyk..',
    '.kyyyyek.',
    'ekyyyyekE',
    '.kyyeeek.',
    '..keeek..',
    '.E.kkk.E.',
    '....E....',
  ],
  moon: [
    '..kkkk...',
    '.kwwwk...',
    'kwwdk....',
    'kwwdk....',
    'kwwdk....',
    'kwwwdk..k',
    '.kwwwdkkk',
    '..kkkkk..',
  ],
  cloud: [
    '...kkk...',
    '..kccck..',
    '.kkcccckk',
    'kcccccccC',
    'kcccccCCk',
    '.kkkkkkk.',
  ],
  cloud_night: [
    '.......k.',
    '...kkk.k.',
    '..kccck..',
    '.kkcccckk',
    'kcccccccC',
    'kcccCCCCk',
    '.kkkkkkk.',
  ],
  rain: [
    '...kkk...',
    '..kccck..',
    '.kkcccckk',
    'kcccCCCCk',
    '.kkkkkkk.',
    '.u..u..u.',
    'u..u..u..',
  ],
  fog: [
    '.kkkkkk..',
    'kccccccc.',
    '..kkkkkkk',
    '.cccccccC',
    'kkkkkk...',
    'cccccccC.',
  ],
  gear: [
    '...kkk...',
    '.k.kwk.k.',
    'kwkkwkkwk',
    '.kwwSwwk.',
    'kkwSkSwkk',
    '.kwwSwwk.',
    'kSkkSkkSk',
    '.k.kSk.k.',
    '...kkk...',
  ],
  bag: [
    '...kkk...',
    '..kb.bk..',
    '.kkkkkkk.',
    'kbbbbbbbk',
    'kbbeeebBk',
    'kbbbebbBk',
    'kbbbbbBBk',
    '.kkkkkkk.',
  ],
  mind: [
    '...kkk...',
    '..kaaak..',
    '.kaawaak.',
    'kaawwwaAk',
    'kaaawaaAk',
    '.kaaaaAk.',
    '..kaaAk..',
    '...kAk...',
    '....k....',
  ],
  mic: [
    '...kkk...',
    '..kwwwk..',
    '..kwdwk..',
    '..kwdwk..',
    'k.kwwwk.k',
    'k..kkk..k',
    '.kk...kk.',
    '...kkk...',
    '....k....',
    '..kkkkk..',
  ],
  // Two people talking: the "Listen in" prompt.
  convo: [
    'kkkkkkk....',
    'kwwwwwk....',
    'kwwwkkkkkkk',
    'kwwwkaaaaak',
    'kkwkkaaaaAk',
    '.kk.kaaaAAk',
    '....kkkkAkk',
    '........kk.',
  ],
  people: [
    '..kk..kk.',
    '.kwwkkddk',
    '.kwwkkddk',
    '..kk..kk.',
    '.kwwkkddk',
    'kwwwkdddk',
  ],
  send: [
    'kk.......',
    'kwkk.....',
    'kwwwkk...',
    'kwwwwwkk.',
    'kwwwwwwdk',
    'kwwwwwkk.',
    'kwwwkk...',
    'kwkk.....',
    'kk.......',
  ],
  pause: [
    'kkk.kkk',
    'kwk.kwk',
    'kwk.kwk',
    'kwk.kwk',
    'kwk.kwk',
    'kwk.kwk',
    'kkk.kkk',
  ],
  scroll: [
    '.kkkkkkk.',
    'kwwwwwwdk',
    '.kwdddwk.',
    '.kwwwwwk.',
    '.kwdddwk.',
    '.kwwwwwk.',
    'kwwwwwwdk',
    '.kkkkkkk.',
  ],
  hand: [
    '...k.k...',
    '..kwkwkk.',
    '..kwkwkwk',
    'k.kwkwkwk',
    'kwkwwwwwk',
    'kwwwwwwdk',
    '.kwwwwwk.',
    '..kwwdk..',
    '..kkkkk..',
  ],
  dodge: [
    '....kkk..',
    '..kkcck..',
    '.kcck....',
    'kck..kkk.',
    '.k..kcck.',
    '...kck...',
    '..kck....',
    '...k.....',
  ],
  close: ['kk...kk', 'kwk.kwk', '.kwkwk.', '..kwk..', '.kwkwk.', 'kwk.kwk', 'kk...kk'],
  star: [
    '....k....',
    '...kyk...',
    'kkkkyykkk',
    'kyyyyyyok',
    '.kyyyyok.',
    '.kyyoyok.',
    'kyok.koOk',
    'kk.....kk',
  ],
  flame: [
    '.....R.....',
    '....RE.....',
    '....REE..R.',
    '...REeER.R.',
    '..REeyeERE.',
    '..REeyyeEE.',
    '.REeyyyyeER',
    '.REeywwyeER',
    'REeyywwyyeR',
    'REeywwwwyeR',
    '.REeywwyeR.',
    '..REeyyeR..',
    '...RREERR..',
  ],
  spark: ['...k...', '..kak..', 'kkaaakk', 'kaawaak', 'kkaaakk', '..kak..', '...k...'],
  chest: [
    '.kkkkkkk.',
    'kbbbbbbbk',
    'kBBBBBBBk',
    'kkkkokkkk',
    'kbbbObbbk',
    'kbbbbbbBk',
    'kBBBBBBBk',
    '.kkkkkkk.',
  ],
  book: [
    'kkkk.kkkk',
    'kwwdkdwwk',
    'kwddkddwk',
    'kwwdkdwwk',
    'kwddkddwk',
    'kwwdkdwwk',
    'kkkkkkkkk',
  ],
};

const cache = new Map();

// Grid -> SVG markup with one rect per horizontal run of a color.
export function iconSvg(name) {
  const grid = ICONS[name];
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

export function iconUrl(name) {
  let u = cache.get(name);
  if (u === undefined) {
    const svg = iconSvg(name);
    u = svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : '';
    cache.set(name, u);
  }
  return u;
}

export function iconSize(name) {
  const grid = ICONS[name];
  if (!grid) return { w: 0, h: 0 };
  return { w: Math.max(...grid.map((r) => r.length)), h: grid.length };
}

export const ICON_PALETTE = PAL;
