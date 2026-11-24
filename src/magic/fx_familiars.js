import { makeCanvas, ctx2d, TAU } from './fx_util.js';
import { halo, ell } from './fx_draw.js';

// Familiars (the summon shape): small animated creatures whose look comes from the
// weave's essences — an ember hound for fire, a water sprite, a frost owl, a storm wisp,
// a stone imp, a wind kite, a thorn sprite, a toxic toad, a light moth, a shade, an iron
// beetle, a singing wisp, an arcane wisp for raw weave. The lead essence picks the form;
// the blended palette colors it and the second essence tints its accents (fire + dark:
// an ember hound with violet flames). Sprites are painted once per form, palette and
// frame into 16×16 canvases (anchor: bottom middle, x 8, y 14) and cached.

// Each painter draws one frame (0..3) facing right with the palette P:
// { body, dark, light, core, accent, outline }.
const PAINT = {
  hound(r, P, f) {
    r(4, 8, 8, 3, P.body);
    r(5, 10, 6, 1, P.dark);
    r(11, 6, 3, 3, P.body);
    r(14, 7, 1, 2, P.dark);
    r(11, 5, 1, 1, P.dark);
    r(12, 7, 1, 1, P.core);
    if (f & 1) {
      r(5, 11, 1, 3, P.dark);
      r(7, 11, 1, 2, P.dark);
      r(10, 11, 1, 3, P.dark);
      r(12, 11, 1, 2, P.dark);
    } else {
      r(4, 11, 1, 2, P.dark);
      r(6, 11, 1, 3, P.dark);
      r(9, 11, 1, 2, P.dark);
      r(11, 11, 1, 3, P.dark);
    }
    r(2, 7, 2, 1, P.dark);
    r(1, 6 - (f & 1), 1, 1, P.light);
    // A mane of flame along the back.
    for (let x = 5; x <= 10; x += 1) {
      const h = 1 + ((x + f) % 3);
      r(x, 8 - h, 1, h, x & 1 ? P.accent : P.light);
      if (h === 3) r(x, 5, 1, 1, P.core);
    }
  },

  sprite(r, P, f) {
    r(7, 3, 2, 1, P.body);
    r(6, 4, 4, 1, P.body);
    r(5, 5, 6, 6, P.body);
    r(6, 11, 4, 1, P.body);
    r(7, 12, 2, 1, P.dark);
    r(6, 5, 1, 2, P.core);
    r(7, 7, 1, 1, P.dark);
    r(9, 7, 1, 1, P.dark);
    r(8, 9, 1, 1, P.dark);
    r(4, 8 - (f & 1), 1, 1, P.light);
    r(11, 8 - ((f + 1) & 1), 1, 1, P.light);
    r(7 + (f & 1), 13, 1, 1, P.accent);
  },

  owl(r, P, f) {
    r(6, 5, 4, 1, P.body);
    r(5, 6, 6, 7, P.body);
    r(5, 4, 1, 2, P.light);
    r(10, 4, 1, 2, P.light);
    r(5, 7, 2, 2, P.core);
    r(9, 7, 2, 2, P.core);
    r(6, 8, 1, 1, P.dark);
    r(9, 8, 1, 1, P.dark);
    r(7, 9, 2, 1, P.accent);
    r(6, 10, 4, 2, P.light);
    if (f & 1) {
      r(3, 5, 2, 3, P.dark);
      r(11, 5, 2, 3, P.dark);
    } else {
      r(4, 8, 1, 4, P.dark);
      r(11, 8, 1, 4, P.dark);
    }
    r(6, 13, 1, 1, P.dark);
    r(9, 13, 1, 1, P.dark);
  },

  wisp(r, P, f) {
    r(7, 5, 3, 1, P.body);
    r(6, 6, 5, 4, P.body);
    r(7, 10, 3, 1, P.body);
    r(7, 7, 3, 2, P.core);
    const z = f & 1;
    r(5, 10 + z, 1, 1, P.light);
    r(4, 9 - z + 2, 1, 1, P.light);
    r(3, 11 - z, 1, 1, P.accent);
    r(2, 12, 1, 1, P.light);
    r(11 + z, 4 + f, 1, 1, P.core);
    r(4 - z, 4 + ((f + 2) & 3), 1, 1, P.light);
    r(7, 7, 1, 1, P.dark);
    r(9, 7, 1, 1, P.dark);
  },

  imp(r, P, f) {
    const up = f & 1;
    r(5, 7, 6, 6, P.body);
    r(5, 6, 1, 1, P.dark);
    r(7, 5, 2, 2, P.body);
    r(9, 6, 2, 1, P.dark);
    r(6, 8, 1, 1, P.light);
    r(7, 9, 1, 1, P.accent);
    r(9, 9, 1, 1, P.accent);
    r(6, 11, 2, 1, P.dark);
    r(3, 9 - up, 2, 2, P.dark);
    r(11, 9 - (1 - up), 2, 2, P.dark);
    r(6, 13, 1, 1, P.dark);
    r(9, 13, 1, 1, P.dark);
    if (f === 2) r(10, 8, 1, 1, P.light);
  },

  kite(r, P, f) {
    r(8, 3, 1, 1, P.body);
    r(7, 4, 3, 1, P.body);
    r(6, 5, 5, 1, P.body);
    r(5, 6, 7, 1, P.body);
    r(6, 7, 5, 1, P.body);
    r(7, 8, 3, 1, P.body);
    r(8, 9, 1, 1, P.body);
    r(8, 3, 1, 7, P.dark);
    r(5, 6, 7, 1, P.dark);
    r(7, 5, 1, 1, P.core);
    for (let y = 10; y <= 14; y++) {
      const x = 8 + Math.round(Math.sin((y + f) * 1.1) * 1.4);
      r(x, y, 1, 1, y & 1 ? P.accent : P.light);
    }
  },

  thornling(r, P, f) {
    r(7, 8, 2, 5, P.dark);
    r(6, 5, 1, 1, P.body);
    r(7, 4, 1, 1, P.body);
    r(9, 4, 1, 1, P.body);
    r(10, 5, 1, 1, P.body);
    r(6, 7, 1, 1, P.body);
    r(10, 7, 1, 1, P.body);
    r(7, 5, 3, 2, P.light);
    r(7, 6, 1, 1, P.outline);
    r(9, 6, 1, 1, P.outline);
    r(8, 3, 1, 1, P.accent);
    r(6, 9, 1, 1, P.body);
    r(5, 8 + (f & 1), 1, 1, P.body);
    r(9, 9, 1, 1, P.body);
    r(10, 8 + ((f + 1) & 1), 1, 1, P.body);
    r(7, 13, 1, 1 - (f & 1) + 0, P.dark);
    r(8, 13, 1, 1, P.dark);
  },

  toad(r, P, f) {
    const hop = f === 1 || f === 2 ? 1 : 0;
    const y0 = -hop;
    r(4, 9 + y0, 9, 4, P.body);
    r(5, 8 + y0, 7, 1, P.body);
    r(5, 6 + y0, 2, 2, P.body);
    r(10, 6 + y0, 2, 2, P.body);
    r(6, 6 + y0, 1, 1, P.core);
    r(11, 6 + y0, 1, 1, P.core);
    r(7, 9 + y0, 1, 1, P.accent);
    r(9, 10 + y0, 1, 1, P.accent);
    r(11, 9 + y0, 1, 1, P.accent);
    r(5, 12 + y0, 7, 1, P.light);
    r(3, 12 + y0 + hop, 2, 1, P.dark);
    r(12, 12 + y0 + hop, 2, 1, P.dark);
    if (f === 3) r(12, 10 + y0, 2, 2, P.light);
  },

  moth(r, P, f) {
    r(7, 6, 2, 6, P.dark);
    r(7, 5, 2, 1, P.light);
    r(6, 4, 1, 1, P.light);
    r(9, 4, 1, 1, P.light);
    if (f & 1) {
      r(4, 3, 3, 4, P.body);
      r(9, 3, 3, 4, P.body);
      r(5, 4, 1, 1, P.core);
      r(10, 4, 1, 1, P.core);
    } else {
      r(3, 5, 4, 4, P.body);
      r(9, 5, 4, 4, P.body);
      r(4, 6, 1, 1, P.core);
      r(11, 6, 1, 1, P.core);
      r(3, 5, 1, 1, P.accent);
      r(12, 5, 1, 1, P.accent);
    }
    r(5, 9, 2, 2, P.light);
    r(9, 9, 2, 2, P.light);
  },

  shade(r, P, f) {
    r(7, 3, 2, 1, P.body);
    r(6, 4, 4, 1, P.body);
    r(5, 5, 6, 6, P.body);
    for (let x = 5; x <= 10; x++) r(x, 11, 1, 1 + ((x + f) % 3), P.body);
    r(6, 5, 4, 3, P.outline);
    r(7, 6, 1, 1, P.accent);
    r(9, 6, 1, 1, P.accent);
    r(5, 6, 1, 4, P.light);
    r(10, 9, 1, 1, P.dark);
  },

  beetle(r, P, f) {
    const s = f & 1 ? 1 : 0;
    r(5, 6, 6, 1, P.body);
    r(4, 7, 8, 5, P.body);
    r(8, 6, 1, 6, P.dark);
    r(5, 7, 2, 1, P.core);
    r(9, 7, 1, 1, P.light);
    r(12, 8, 2, 3, P.dark);
    r(14, 7, 1, 1, P.light);
    r(13, 7, 1, 1, P.dark);
    r(5 + s, 12, 1, 1, P.dark);
    r(8 - s, 12, 1, 1, P.dark);
    r(11 + s, 12, 1, 1, P.dark);
    r(5, 10, 1, 1, P.accent);
  },

  singer(r, P, f) {
    r(6, 5, 5, 7, P.body);
    r(5, 6, 7, 5, P.body);
    r(7, 7, 1, 1, P.outline);
    r(9, 7, 1, 1, P.outline);
    if (f & 1) r(7, 9, 3, 2, P.outline);
    else r(8, 9, 1, 1, P.outline);
    r(6, 9, 1, 1, P.accent);
    r(10, 9, 1, 1, P.accent);
    r(6, 5, 1, 1, P.core);
    r(4, 10, 1, 1, P.light);
    r(3, 11 + (f & 1), 1, 1, P.light);
    if (f >= 2) r(12, 4 + (f & 1), 1, 2, P.core);
  },

  arcane(r, P, f) {
    r(8, 3, 1, 1, P.body);
    r(7, 4, 3, 1, P.body);
    r(6, 5, 5, 4, P.body);
    r(7, 9, 3, 1, P.body);
    r(8, 10, 1, 1, P.body);
    r(7, 5, 3, 3, P.light);
    r(8, 6, 1, 1, P.core);
    const a = (f / 4) * TAU;
    r(Math.round(8 + Math.cos(a) * 5), Math.round(7 + Math.sin(a) * 3), 1, 1, P.accent);
    r(Math.round(8 - Math.cos(a) * 5), Math.round(7 - Math.sin(a) * 3), 1, 1, P.light);
    r(8, 12 + (f & 1), 1, 1, P.light);
  },
};

export const FAMILIAR_FORMS = Object.keys(PAINT);

// Where a creature's eyes are (for the glow buffer): per form, facing right.
const EYES = { hound: [12, 7], sprite: [8, 7], owl: [7, 8], wisp: [8, 7], imp: [8, 9], kite: [7, 5], thornling: [8, 6], toad: [8, 6], moth: [8, 5], shade: [8, 6], beetle: [14, 7], singer: [8, 7], arcane: [8, 6] };

function addOutline(c, color) {
  try {
    const g = c.getContext('2d');
    if (!g || !g.getImageData) return;
    const w = c.width;
    const h = c.height;
    const d = g.getImageData(0, 0, w, h)?.data;
    if (!d) return;
    const op = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 20;
    g.fillStyle = color;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (op(x, y)) continue;
        if (op(x - 1, y) || op(x + 1, y) || op(x, y - 1) || op(x, y + 1)) g.fillRect(x, y, 1, 1);
      }
    }
  } catch {
    /* no pixel access (tests): no outline */
  }
}

const cache = new Map();
function sprite(form, P, frame, flip) {
  const key = `${form}|${P.body}${P.dark}${P.light}${P.core}${P.accent}|${frame}|${flip ? 1 : 0}`;
  let c = cache.get(key);
  if (c) return c;
  if (cache.size > 600) cache.clear();
  c = makeCanvas(16, 16);
  const g = ctx2d(c);
  const paint = PAINT[form] || PAINT.arcane;
  const r = flip
    ? (x, y, w, h, col) => {
        g.fillStyle = col;
        g.fillRect(16 - x - w, y, w, h);
      }
    : (x, y, w, h, col) => {
        g.fillStyle = col;
        g.fillRect(x, y, w, h);
      };
  paint(r, P, frame & 3);
  addOutline(c, P.outline);
  cache.set(key, c);
  return c;
}

const palCache = new Map();
function familiarPalette(L) {
  let P = palCache.get(L.key);
  if (P) return P;
  P = { body: L.pal.glow, dark: L.pal.deep, light: L.pal.spark, core: L.pal.core, accent: L.multi ? L.accent : L.pal.spark, outline: L.outline };
  if (palCache.size > 300) palCache.clear();
  palCache.set(L.key, P);
  return P;
}

// Creatures that walk on the ground (the rest hover at the body's height).
const WALKERS = new Set(['hound', 'imp', 'toad', 'beetle', 'thornling']);

export function familiarForm(L) {
  return L.look.familiar || 'arcane';
}

export function drawFamiliar(R, b, L) {
  const fs = b.fxState || (b.fxState = {});
  if (fs.lx === undefined) {
    fs.lx = b.x;
    fs.face = 1;
  }
  const t = b.target;
  if (t && !t.removed && !t.dead) fs.face = t.x >= b.x ? 1 : -1;
  else if (Math.abs(b.x - fs.lx) > 0.05) fs.face = b.x > fs.lx ? 1 : -1;
  fs.lx = b.x;
  const formId = familiarForm(L);
  const P = familiarPalette(L);
  const frame = Math.floor(b.age * 8 + b.seed * 4) & 3;
  const img = sprite(formId, P, frame, fs.face < 0);
  const grow = Math.min(1, 0.35 + b.age / 0.25);
  const size = (b.plan?.size > 1.25 ? 1.4 : 1) * grow;
  const lunge = fs.lunge > 0 ? fs.lunge : 0;
  const x = b.x - R.ox + fs.face * lunge * 10;
  const y = b.y - R.oy - (WALKERS.has(formId) ? 1 : b.z);
  const fade = Math.max(0, Math.min(1, (b.life - b.age) / 0.4));
  const c = R.ctx;
  c.globalAlpha = fade * (b.life - b.age < 1.2 ? 0.6 + 0.4 * Math.abs(Math.sin(b.age * 14)) : 1);
  const w = Math.round(16 * size);
  c.drawImage(img, Math.round(x - 8 * size), Math.round(y - 14 * size), w, w);
  c.globalAlpha = 1;
  if (R.g) {
    const eye = EYES[formId] || EYES.arcane;
    const ex = fs.face > 0 ? eye[0] : 16 - eye[0] - 1;
    halo(R.g, x, y - 7 * size, 11 * size, L.halo, 0.4 * fade, R.bounds);
    R.g.globalAlpha = 0.8 * fade;
    R.g.fillStyle = P.core;
    R.g.fillRect(Math.round(x - 8 * size + ex * size), Math.round(y - 14 * size + eye[1] * size), 1, 1);
    R.g.globalAlpha = 1;
  }
}

export function drawFamiliarShadow(R, b, x, y) {
  const s = b.plan?.size > 1.25 ? 1.4 : 1;
  R.ctx.globalAlpha = 0.3 * Math.max(0, Math.min(1, (b.life - b.age) / 0.4));
  ell(R.ctx, x, y + 1, 4 * s, 1.6 * s, '#100a1c');
  R.ctx.globalAlpha = 1;
}
