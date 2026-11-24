// 48x48 head-and-shoulders portraits for the UI, painted at a larger scale than
// the walking sprites: real eyes with irises and glints, brows, nose, lips, hair
// strands. Expressions change brows, eyes, mouth, blush and tears.

import { Sprite, glow, lighten, darken, mixHex } from './characters_paint.js';
import { normalizeAppearance } from './characters_appearance.js';

export const PORTRAIT_SIZE = 48;
// 'afraid' and 'cold' (distant, guarded) are for Lyra when the player frightens or wrongs her.
export const EXPRESSIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'worried', 'love', 'sleepy', 'afraid', 'cold'];

const C = 24; // symmetric spans are [C - k, C + k - 1]
const HEAD_TOP = 8;
const EYE_DARK = '#1f1828';
const WHITE = '#f8f2ec';

// Half-width of the face per row (rows from HEAD_TOP).
function headHalf(r, build) {
  const wide = build === 'big' || build === 'stout' ? 1 : 0;
  const R = 11 + wide;
  if (r < 9) return Math.round(R * Math.sqrt(Math.max(0, 1 - ((9 - r) / 9.6) ** 2)));
  if (r < 17) return R;
  const jaw = build === 'big' ? 0.55 : build === 'child' ? 0.9 : 0.85;
  return Math.max(3, Math.round(R - (r - 16) * jaw * (r > 21 ? 1.25 : 1)));
}
const HEAD_ROWS = 26;

function face(sp, a, expr, T) {
  const ey = T + 13; // top of the eyes
  const big = a.eyeStyle === 'big';
  const brow = a.hair[0];
  sp.begin({ flat: true, shadow: 'none' });
  const iris = a.eyes === '#2a2130' ? '#4a3a30' : a.eyes;
  const irisDark = mixHex(iris, EYE_DARK, 0.45);
  const irisLight = lighten(iris, 0.35);
  const lid = darken(a.skin[0], 0.1);
  const eyesAt = [C - 8, C + 4]; // left edge of each 4-wide eye
  const h = big ? 4 : 3;

  const drawOpen = (x, wide = false, lookDown = false, half = false, aside = 0, small = false) => {
    const top = ey - (wide ? 1 : 0);
    const rows = h + (wide ? 1 : 0);
    // lash line
    for (let i = 0; i < 4; i++) sp.dot(x + i, top, EYE_DARK);
    if (a.lashes) {
      sp.dot(x === eyesAt[0] ? x - 1 : x + 4, top - 1, EYE_DARK);
      sp.dot(x === eyesAt[0] ? x - 1 : x + 4, top, EYE_DARK);
    }
    for (let r = 1; r < rows; r++) {
      const y = top + r;
      if (half && r === 1) {
        for (let i = 0; i < 4; i++) sp.dot(x + i, y, lid);
        continue;
      }
      sp.dot(x, y, WHITE);
      sp.dot(x + 3, y, mixHex(WHITE, a.skin[0], 0.25));
      if (aside) sp.dot(x + 1, y, WHITE);
      const ir = lookDown ? r + 0 : r;
      if (small) {
        // pupils shrunk to a point: fright
        sp.dot(x + 1, y, WHITE);
        sp.dot(x + 2, y, r === 2 ? irisDark : WHITE);
        continue;
      }
      sp.dot(x + 1 + aside, y, ir === 1 ? irisDark : iris);
      sp.dot(x + 2 + aside, y, ir === 1 ? irisDark : r === rows - 1 ? irisLight : iris);
    }
    // glint, light from the upper left
    if (!half) sp.dot(x + 1, top + 1, '#ffffff');
    // lower lid
    sp.dot(x + 1, top + rows, mixHex(a.skin[0], a.skin[1], 0.3));
    sp.dot(x + 2, top + rows, mixHex(a.skin[0], a.skin[1], 0.3));
  };
  const drawClosedArc = (x, up) => {
    // happy (^) or peaceful (u) eyes
    const y = ey + 2;
    if (up) {
      sp.dot(x, y + 1, EYE_DARK);
      sp.dot(x + 1, y, EYE_DARK);
      sp.dot(x + 2, y, EYE_DARK);
      sp.dot(x + 3, y + 1, EYE_DARK);
    } else {
      sp.dot(x, y, EYE_DARK);
      sp.dot(x + 1, y + 1, EYE_DARK);
      sp.dot(x + 2, y + 1, EYE_DARK);
      sp.dot(x + 3, y, EYE_DARK);
      if (a.lashes) sp.dot(x === eyesAt[0] ? x - 1 : x + 4, y, EYE_DARK);
    }
  };

  // eyes
  for (const x of eyesAt) {
    switch (expr) {
      case 'happy':
        drawClosedArc(x, true);
        break;
      case 'sleepy':
        drawClosedArc(x, false);
        break;
      case 'love':
        drawOpen(x, false, false, true);
        break;
      case 'surprised':
        drawOpen(x, true);
        break;
      case 'sad':
        drawOpen(x, false, true, true);
        break;
      case 'angry':
        drawOpen(x, false, false, true);
        break;
      case 'afraid':
        drawOpen(x, true, false, false, 0, true);
        break;
      case 'cold':
        // half-lidded, looking away: guarded
        drawOpen(x, false, false, true, 1);
        break;
      default:
        drawOpen(x);
    }
  }
  if (expr === 'love') {
    // little hearts in the eyes
    for (const x of eyesAt) {
      sp.dot(x + 1, ey + 2, '#e0557a');
      sp.dot(x + 2, ey + 2, '#e0557a');
      sp.dot(x + 1, ey + 3, '#c03a60');
    }
  }

  return { ey, my: ey + 9 };
}

function brows(sp, a, expr, T) {
  const ey = T + 13;
  const brow = a.hair[0] === a.hair[1] ? darken(a.hair[0], 0.2) : a.hair[0];
  const eyesAt = [C - 8, C + 4];
  sp.begin({ flat: true, shadow: 'none' });
  // brows: [outer dy, inner dy] relative to the default brow row
  const browShape = {
    neutral: [0, 0],
    happy: [-1, -1],
    sad: [1, -2],
    angry: [-1, 2],
    surprised: [-2, -2],
    worried: [0, -2],
    love: [0, -1],
    sleepy: [1, 1],
    afraid: [-1, -3],
    cold: [1, 0],
  }[expr] || [0, 0];
  const by = ey - 3;
  for (const [x0, dirn] of [
    [eyesAt[0], 1],
    [eyesAt[1], -1],
  ]) {
    // dirn = +1: inner end on the right
    for (let i = 0; i < 5; i++) {
      const t = i / 4; // 0 outer .. 1 inner
      const xi = dirn > 0 ? x0 - 1 + i : x0 + 4 - i;
      const dy = Math.round(browShape[0] * (1 - t) + browShape[1] * t);
      if (a.hoodUp || a.hat) {
        /* brows still show under hats */
      }
      sp.dot(xi, by + dy, brow);
      if (a.build === 'big' || a.beard) sp.dot(xi, by + dy + 1, darken(brow, 0.1));
    }
  }
}

function features(sp, a, expr, T) {
  const ey = T + 13;
  const lip = mixHex(a.skin[0], '#9e2133', 0.4);
  const lipDark = mixHex(EYE_DARK, '#6b1424', 0.5);
  sp.begin({ flat: true, shadow: 'none' });

  // nose: shadow on the right of the bridge, a soft nostril
  sp.dot(C, ey + 4, a.skin[0]);
  sp.dot(C, ey + 5, a.skin[0]);
  sp.dot(C - 1, ey + 6, mixHex(a.skin[0], a.skin[1], 0.4));
  sp.dot(C, ey + 6, a.skin[0]);
  sp.dot(C - 2, ey + 4, lighten(a.skin[2], 0.15));

  // mouth
  const my = ey + 9;
  switch (expr) {
    case 'happy':
      for (let x = C - 3; x <= C + 2; x++) sp.dot(x, my, lipDark);
      for (let x = C - 2; x <= C + 1; x++) sp.dot(x, my + 1, '#7a2a36');
      sp.dot(C - 1, my + 1, '#c4505a');
      sp.dot(C, my + 1, '#c4505a');
      for (let x = C - 2; x <= C + 1; x++) sp.dot(x, my, x === C - 2 || x === C + 1 ? lipDark : WHITE);
      sp.dot(C - 4, my - 1, lip);
      sp.dot(C + 3, my - 1, lip);
      break;
    case 'sad':
      sp.dot(C - 2, my + 1, lipDark);
      sp.dot(C - 1, my, lipDark);
      sp.dot(C, my, lipDark);
      sp.dot(C + 1, my + 1, lipDark);
      break;
    case 'angry':
      for (let x = C - 2; x <= C + 1; x++) sp.dot(x, my, lipDark);
      sp.dot(C - 3, my + 1, lipDark);
      sp.dot(C + 2, my + 1, lipDark);
      break;
    case 'surprised':
      sp.dot(C - 1, my - 1, lipDark);
      sp.dot(C, my - 1, lipDark);
      sp.dot(C - 2, my, lipDark);
      sp.dot(C + 1, my, lipDark);
      sp.dot(C - 1, my, '#5a1a26');
      sp.dot(C, my, '#5a1a26');
      sp.dot(C - 1, my + 1, lipDark);
      sp.dot(C, my + 1, lipDark);
      break;
    case 'worried':
      sp.dot(C - 2, my, lipDark);
      sp.dot(C - 1, my + 1, lipDark);
      sp.dot(C, my, lipDark);
      sp.dot(C + 1, my + 1, lipDark);
      break;
    case 'sleepy':
      sp.dot(C - 1, my, lipDark);
      sp.dot(C, my, lipDark);
      sp.dot(C - 1, my + 1, '#7a2a36');
      sp.dot(C, my + 1, lipDark);
      break;
    case 'love':
      sp.dot(C - 2, my, lipDark);
      sp.dot(C - 1, my + 1, lipDark);
      sp.dot(C, my + 1, lipDark);
      sp.dot(C + 1, my, lipDark);
      sp.dot(C - 1, my + 2, lip);
      break;
    case 'afraid':
      // a trembling, half-open mouth
      sp.dot(C - 3, my + 1, lipDark);
      sp.dot(C - 2, my, lipDark);
      sp.dot(C - 1, my, lipDark);
      sp.dot(C, my, lipDark);
      sp.dot(C + 1, my, lipDark);
      sp.dot(C + 2, my + 1, lipDark);
      sp.dot(C - 2, my + 1, '#5a1a26');
      sp.dot(C - 1, my + 1, WHITE);
      sp.dot(C, my + 1, WHITE);
      sp.dot(C + 1, my + 1, '#5a1a26');
      sp.dot(C - 1, my + 2, lipDark);
      sp.dot(C, my + 2, lipDark);
      break;
    case 'cold':
      // a flat line, one corner pulled down
      for (let x = C - 2; x <= C + 1; x++) sp.dot(x, my, lipDark);
      sp.dot(C + 2, my + 1, lipDark);
      break;
    default:
      sp.dot(C - 2, my, lipDark);
      sp.dot(C - 1, my, lipDark);
      sp.dot(C, my, lipDark);
      sp.dot(C + 1, my - 1, lipDark);
      sp.dot(C - 1, my + 1, lip);
      sp.dot(C, my + 1, lip);
  }

  // blush
  const blushAmount = expr === 'love' ? 0.75 : expr === 'happy' ? 0.45 : expr === 'afraid' || expr === 'cold' ? 0 : a.blush ? 0.3 : 0;
  if (blushAmount) {
    const pink = '#e8607a';
    for (const x0 of [C - 9, C + 5]) {
      for (let i = 0; i < 4; i++) {
        sp.dot(x0 + i, ey + 6, mixHex(a.skin[1], pink, blushAmount * (i === 0 || i === 3 ? 0.6 : 1)));
        if (expr === 'love' && i > 0 && i < 3) sp.dot(x0 + i, ey + 7, mixHex(a.skin[1], pink, blushAmount * 0.6));
      }
    }
    if (expr === 'love') {
      sp.dot(C - 8, ey + 6, '#ffd0dc');
      sp.dot(C + 6, ey + 6, '#ffd0dc');
    }
  }
  if (expr === 'sad') {
    // a tear on her left cheek (screen right)
    sp.dot(C + 6, ey + 5, '#bfe6ff');
    sp.dot(C + 6, ey + 6, '#8fd0f5');
    sp.dot(C + 5, ey + 7, '#8fd0f5');
    sp.dot(C + 6, ey + 7, '#5aaee0');
  }
  if (expr === 'afraid') {
    // cold sweat at the temple, and the color drained from her cheeks
    sp.dot(C - 11, ey - 3, '#bfe6ff');
    sp.dot(C - 11, ey - 2, '#8fd0f5');
    sp.dot(C - 12, ey - 1, '#8fd0f5');
    sp.dot(C - 11, ey - 1, '#5aaee0');
    for (const x0 of [C - 9, C + 5]) for (let i = 0; i < 4; i++) sp.dot(x0 + i, ey + 6, mixHex(a.skin[1], '#a8b4d8', 0.35));
  }
  if (expr === 'cold') {
    // a shadow under the eyes: tired of being hurt
    for (const x0 of [C - 8, C + 4]) for (let i = 0; i < 4; i++) sp.dot(x0 + i, ey + 5, mixHex(a.skin[0], a.skin[1], 0.45));
  }
  if (expr === 'worried') {
    sp.dot(C + 10, ey - 4, '#bfe6ff');
    sp.dot(C + 10, ey - 3, '#8fd0f5');
    sp.dot(C + 9, ey - 2, '#8fd0f5');
    sp.dot(C + 10, ey - 2, '#5aaee0');
  }
  if (expr === 'angry') {
    sp.dot(C + 8, ey - 6, '#e0405a');
    sp.dot(C + 10, ey - 6, '#e0405a');
    sp.dot(C + 9, ey - 5, '#e0405a');
    sp.dot(C + 8, ey - 4, '#e0405a');
    sp.dot(C + 10, ey - 4, '#e0405a');
  }
  if (a.freckles) for (const [x, y] of [[-7, 6], [-5, 7], [-6, 8], [5, 6], [7, 7], [6, 8]]) sp.dot(C + x, ey + y, a.skin[0]);
  if (a.wrinkles) {
    sp.dot(C - 10, ey + 1, a.skin[0]);
    sp.dot(C + 9, ey + 1, a.skin[0]);
    sp.dot(C - 4, my - 1, a.skin[0]);
    sp.dot(C + 3, my - 1, a.skin[0]);
    sp.dot(C - 2, ey - 5, a.skin[0]);
    sp.dot(C + 1, ey - 5, a.skin[0]);
  }
  if (a.scar) {
    for (let i = 0; i < 6; i++) sp.dot(C + 5 + (i >> 1), ey - 2 + i, '#c4706a');
  }
  return { ey, my };
}

function hairStrands(sp, x0, x1, y0, y1, ramp, seed = 0) {
  // long light streaks and a few dark partings, running down the hair
  sp.begin({ flat: true, shadow: 'none' });
  for (let x = x0; x <= x1; x++) {
    const k = (x * 7 + seed) % 9;
    if (k !== 0 && k !== 4) continue;
    const len = 3 + ((x * 5 + seed) % 4);
    const start = y0 + ((x * 3 + seed) % 6);
    for (let y = start; y <= Math.min(y1, start + len); y++) {
      if (!sp.isSet(x, y) || sp.color[y * sp.w + x]) continue;
      const t = sp.tone[y * sp.w + x];
      if (t === 0) continue;
      sp.detail(x, y, k === 0 ? ramp[2] : ramp[0]);
    }
  }
}

// A plait of three strands: each bump is a 3x3 lobe, alternating sides.
function paintBraid(sp, ramp, y0, y1) {
  sp.begin({ band: 0, shadow: 'none' });
  for (let y = y0; y <= y1; y++) {
    const x = C + 9 + (y > 36 ? 1 : 0);
    const k = (y - y0) % 4;
    const left = Math.floor((y - y0) / 4) % 2 === 0;
    for (let i = 0; i < 4; i++) {
      let tone = 1;
      if (k === 0) tone = 0;
      else if (k === 1) tone = (left ? i < 2 : i >= 2) ? 2 : 1;
      else if (k === 3) tone = (left ? i >= 2 : i < 2) ? 0 : 1;
      if ((i === 0 || i === 3) && k === 0) continue;
      sp.set(x + i, y, ramp, tone);
    }
  }
  sp.begin({ flat: true, shadow: 'none' });
  sp.dot(C + 11, y1 - 2, '#e6e9f2');
  sp.dot(C + 12, y1 - 2, '#c9cede');
  sp.dot(C + 13, y1 - 2, '#a3a8b8');
  sp.dot(C + 10, y1 - 2, '#a3a8b8');
}

export function paintPortrait(appearance, expression = 'neutral') {
  const a = appearance && Array.isArray(appearance.skin) && appearance.top ? appearance : normalizeAppearance(appearance);
  const expr = EXPRESSIONS.includes(expression) ? expression : 'neutral';
  const sp = new Sprite(48, 48);
  // Portraits are seen large: smooth bands read better than a checker dither.
  sp.dither = false;
  sp.rimRamps = new Set([a.hair, a.cloak, a.hood].filter(Boolean));
  const T = HEAD_TOP + (a.build === 'child' ? 3 : 0);
  const hairR = a.hair;
  const style = a.hairStyle;

  // --- behind everything: long hair, cloak back
  if (style === 'long' || style === 'curly') {
    sp.begin({ band: 2 });
    const bottom = style === 'long' ? 47 : 38;
    for (let y = T + 4; y <= bottom; y++) {
      const t = (y - T - 4) / (bottom - T - 4);
      const h = Math.round(13 + Math.sin(t * Math.PI) * 2 - t * 1);
      sp.span(C - h, C + h - 1, y, hairR);
    }
    hairStrands(sp, C - 16, C + 15, T + 10, 47, hairR, 3);
  }

  // --- shoulders and outfit
  const shoulderTop = 38;
  const broad = a.build === 'big' ? 3 : a.build === 'stout' ? 2 : a.build === 'child' ? -3 : a.build === 'slim' ? -1 : 0;
  sp.begin({ band: 3 });
  for (let y = shoulderTop; y < 48; y++) {
    const t = Math.min(1, (y - shoulderTop) / 5);
    const h = Math.round(9 + broad + t * (9 + broad));
    sp.span(C - h, C + h - 1, y, a.outfit === 'armor' ? a.armorRamp : a.top);
  }
  // neck
  sp.begin({ band: 1 });
  sp.rect(C - 4, T + 22, 8, shoulderTop - T - 20, a.skin);
  for (let y = T + 22; y < shoulderTop + 1; y++) sp.shadeAt(C + 3, y, 0);
  sp.shadeAt(C - 4, T + 23, 0);
  sp.shadeAt(C - 3, T + 23, 0);
  // neckline per outfit
  sp.begin({ flat: true, shadow: 'none' });
  if (a.outfit === 'coat') {
    // a coat's lapels open over a shirt, buttons down the front
    for (let i = 0; i < 5; i++) {
      sp.set(C - 3 + (i >> 1), shoulderTop + i, a.accent, 2);
      sp.set(C + 2 - (i >> 1), shoulderTop + i, a.accent, 1);
    }
    for (let i = 0; i < 6; i++) {
      sp.set(C - 6 + i, shoulderTop + i + 1, a.top, 2);
      sp.set(C + 5 - i, shoulderTop + i + 1, a.top, 0);
    }
    for (let y = shoulderTop + 6; y < 48; y += 3) sp.dot(C - 1, y, a.accent[2]);
  } else if (a.outfit === 'tunic' || a.outfit === 'trousers') {
    for (let i = 0; i < 4; i++) {
      sp.set(C - 3 + i, shoulderTop + i, a.skin, 1);
      sp.set(C + 2 - i, shoulderTop + i, a.skin, 0);
      sp.set(C - 2 + i, shoulderTop + i, a.skin, 1);
    }
    sp.dot(C - 1, shoulderTop + 4, a.top[0]);
    if (a.accent) {
      for (let i = 0; i < 5; i++) {
        sp.set(C - 4 + i, shoulderTop + i, a.accent, 2);
        sp.set(C + 3 - i, shoulderTop + i, a.accent, 1);
      }
    }
  } else if (a.outfit === 'dress' || a.outfit === 'apron') {
    for (let x = C - 5; x <= C + 4; x++) sp.set(x, shoulderTop, a.skin, x < C ? 1 : 0);
    for (let x = C - 3; x <= C + 2; x++) sp.set(x, shoulderTop + 1, a.skin, 1);
    if (a.outfit === 'apron') {
      sp.begin({ band: 1 });
      for (let y = shoulderTop + 3; y < 48; y++) sp.span(C - 5, C + 4, y, a.apron);
      sp.begin({ flat: true });
      for (let y = shoulderTop; y < shoulderTop + 3; y++) {
        sp.set(C - 7, y, a.apron, 2);
        sp.set(C + 6, y, a.apron, 1);
      }
    }
  } else if (a.outfit === 'robe') {
    sp.begin({ band: 1 });
    for (let y = shoulderTop - 1; y < shoulderTop + 3; y++) sp.span(C - 6, C + 5, y, a.top);
    sp.begin({ flat: true });
    for (let i = 0; i < 6; i++) {
      sp.set(C - 1 - (i >> 1), shoulderTop + 3 + i, a.sash || a.accent, 2);
      sp.set(C + (i >> 1), shoulderTop + 3 + i, a.sash || a.accent, 1);
    }
  } else if (a.outfit === 'armor') {
    sp.begin({ band: 1 });
    for (let y = shoulderTop + 2; y < 48; y++) sp.span(C - 6, C + 5, y, a.armorRamp);
    sp.begin({ flat: true });
    for (let y = shoulderTop + 3; y < 48; y++) sp.set(C - 1, y, a.armorRamp, 2);
    // pauldrons
    const pr = a.pauldron || a.armorRamp;
    sp.begin({ band: 2 });
    sp.ellipse(C - 15 - broad, 42, 6, 4, pr);
    sp.ellipse(C + 15 + broad, 42, 6, 4, pr);
    if (a.pauldron) hairStrands(sp, 2, 46, 37, 47, pr, 1);
  }
  if (a.skeleton) {
    sp.begin({ flat: true });
    for (let y = shoulderTop + 1; y < 48; y += 2) for (let x = C - 9; x <= C + 8; x++) if (x !== C - 1 && x !== C) sp.dot(x, y, '#241c26');
  }

  // --- ears
  sp.begin({});
  if (!a.skeleton) {
    const ear = a.bigEars ? 1.2 : 0;
    sp.ellipse(C - 11.5 - (a.build === 'big' ? 1 : 0) - ear, T + 15 - ear, 1.8 + ear, 2.8 + ear, a.skin);
    sp.ellipse(C + 11.5 + (a.build === 'big' ? 1 : 0) + ear, T + 15 - ear, 1.8 + ear, 2.8 + ear, a.skin);
    if (a.earrings) {
      sp.begin({ flat: true, shadow: 'none' });
      sp.dot(C - 12, T + 18, a.earrings);
      sp.dot(C - 12, T + 19, lighten(a.earrings, 0.3));
      sp.dot(C + 11, T + 18, a.earrings);
      sp.dot(C + 11, T + 19, lighten(a.earrings, 0.3));
    }
  }

  // --- head
  sp.begin({ band: 2, shadow: 'all' });
  for (let r = 0; r < HEAD_ROWS; r++) {
    const h = headHalf(r, a.build);
    if (a.skeleton && r > 19 && r < 21) continue;
    sp.span(C - h, C + h - 1, T + r, a.skin);
  }
  // soft cheek light
  sp.begin({ flat: true, shadow: 'none' });
  sp.detail(C - 8, T + 18, lighten(a.skin[2], 0.12));
  sp.detail(C - 7, T + 18, lighten(a.skin[2], 0.12));
  if (a.skeleton) {
    sp.begin({ flat: true, shadow: 'none' });
    for (const x of [C - 8, C + 3]) for (let y = T + 12; y < T + 17; y++) for (let i = 0; i < 5; i++) sp.dot(x + i, y, '#241c26');
    sp.dot(C - 6, T + 14, a.eyes);
    sp.dot(C + 5, T + 14, a.eyes);
    glow(sp, C - 5.5, T + 14.5, 3, a.eyes, 0.3);
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(C - 1, T + 18, '#241c26');
    sp.dot(C, T + 18, '#241c26');
    for (let x = C - 5; x <= C + 4; x++) sp.dot(x, T + 21, x % 2 ? '#f6f0de' : '#3a2c30');
    return sp;
  }
  face(sp, a, expr, T);
  features(sp, a, expr, T);
  eyeOverlay(sp, a, expr, T);
  // gentle form shading: the right cheek and jaw turn away from the light
  sp.begin({ flat: true, shadow: 'none' });
  for (let r = 6; r < HEAD_ROWS; r++) {
    const h = headHalf(r, a.build);
    sp.detail(C + h - 1, T + r, a.skin[0]);
    if (r > 12) sp.detail(C + h - 2, T + r, mixHex(a.skin[0], a.skin[1], 0.5));
  }
  for (let x = C - 3; x <= C + 2; x++) sp.detail(x, T + HEAD_ROWS - 1, a.skin[0]);

  // --- beard, mustache, mask
  if (a.beard) {
    sp.begin({ band: 2 });
    for (let y = T + 18; y <= T + 29; y++) {
      const h = y < T + 22 ? headHalf(y - T, a.build) : Math.max(3, 10 - (y - T - 22));
      for (let x = C - h; x <= C + h - 1; x++) {
        if (y >= T + 21 && y <= T + 23 && x >= C - 3 && x <= C + 2) continue; // mouth stays visible
        if (y < T + 21 && x > C - 7 && x < C + 6) continue;
        sp.set(x, y, a.beard);
      }
    }
    hairStrands(sp, C - 12, C + 12, T + 18, T + 30, a.beard, 5);
  }
  if (a.mustache) {
    sp.begin({ band: 1 });
    for (let x = C - 4; x <= C + 3; x++) sp.set(x, T + 21, a.mustache);
    sp.set(C - 5, T + 22, a.mustache);
    sp.set(C + 4, T + 22, a.mustache);
  }
  if (a.mask) {
    sp.begin({ band: 2 });
    for (let y = T + 18; y < T + 27; y++) {
      const h = headHalf(y - T, a.build) + 1;
      sp.span(C - h, C + h - 1, y, a.mask);
    }
    sp.begin({ flat: true });
    for (let x = C - 10; x <= C + 9; x++) sp.dot(x, T + 18, a.mask[2]);
  }

  // --- hair
  if (style === 'tufts') {
    // a bald crown with white tufts standing out over the ears, and a wisp on top
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(C - 6, T + 3, lighten(a.skin[2], 0.3));
    sp.dot(C - 5, T + 3, lighten(a.skin[2], 0.3));
    sp.dot(C - 7, T + 4, lighten(a.skin[2], 0.2));
    sp.begin({ band: 1, shadow: 'top' });
    for (const side of [-1, 1]) {
      for (let y = T + 5; y < T + 16; y++) {
        const puff = y < T + 9 ? 2 + (y - T - 5) : y < T + 13 ? 5 : 3;
        const x0 = side < 0 ? C - 11 - puff + 2 : C + 10;
        const x1 = side < 0 ? C - 10 : C + 9 + puff - 2;
        sp.span(x0, x1, y, hairR);
      }
    }
    hairStrands(sp, C - 16, C + 15, T + 4, T + 16, hairR, 4);
    sp.begin({ flat: true, shadow: 'none' });
    for (const [x, y] of [[-1, -1], [0, -2], [1, -3], [2, -2], [-2, 0]]) sp.dot(C + x, T + y, hairR[2]);
  } else if (style === 'scarf') {
    // the headscarf hides the hair (painted with the headwear); a line of it at the brow
    sp.begin({ band: 1 });
    for (let x = C - 9; x <= C + 8; x++) sp.set(x, T + 8, hairR, x < C ? 1 : 0);
  } else if (style !== 'bald' && style !== 'hood') {
    sp.begin({ band: 2, shadow: 'top' });
    const top = T - (style === 'curly' ? 2 : 1);
    for (let y = top; y <= T + 9; y++) {
      const r = y - T;
      const h = (r < 0 ? 6 : headHalf(Math.max(0, r), a.build)) + 1 + (style === 'curly' ? 1 : 0);
      sp.span(C - h, C + h - 1, y, hairR);
    }
    // fringe: bangs with points, sides down past the ears for long hair
    for (let x = C - 13; x <= C + 12; x++) {
      const dx = x - C + 0.5;
      const ax = Math.abs(dx);
      let depth;
      switch (style) {
        case 'long':
          depth = ax > 9 ? 30 : ax > 7.5 ? 16 : 10 + [1, 2, 3, 2, 1, 2, 3, 2, 1, 1, 2, 3, 2, 1, 2, 3, 2, 1, 2, 1][Math.floor(dx + 10) % 20];
          break;
        case 'curly':
          depth = ax > 9 ? 22 : 12 + ((x * 3) % 3);
          break;
        case 'ponytail':
        case 'bun':
          depth = ax > 9.5 ? 14 : 11 + (dx > 0 && dx < 5 ? 1 : 0);
          break;
        case 'braid':
          depth = ax > 9.5 ? 16 : 11 + ((x * 7) % 3 === 0 ? 1 : 0);
          break;
        case 'cropped':
          depth = ax > 9.5 ? 13 : 9 + ((x * 5) % 3 === 0 ? 1 : 0);
          break;
        case 'fringe':
          // a blunt fringe cut straight across the brow
          depth = ax > 9.5 ? 15 : 13;
          break;
        default:
          depth = ax > 9.5 ? 16 : 10 + [1, 2, 1, 0, 1, 2, 2, 1, 0, 1][Math.floor(dx + 10) % 10];
      }
      for (let y = T + 9; y < T + depth; y++) {
        // keep the face open below the bangs except at the sides
        if (y >= T + (style === 'fringe' ? 13 : 12) && ax < 9.5 && style !== 'long') continue;
        if (y >= T + 14 && ax < 9.5) continue;
        sp.set(x, y, hairR);
      }
    }
    if (style === 'long') {
      // curtains framing the face down to the shoulders
      for (let y = T + 12; y < 46; y++) {
        const sway = y > 40 ? 1 : 0;
        sp.span(C - 14 - sway, C - 10, y, hairR);
        sp.span(C + 9, C + 13 + sway, y, hairR);
      }
    }
    if (style === 'curly') {
      for (let y = T + 2; y < T + 22; y++) {
        sp.span(C - 14, C - 12, y, hairR);
        sp.span(C + 11, C + 13, y, hairR);
      }
    }
    if (style === 'bun') {
      sp.begin({ band: 1, shadow: 'none' });
      sp.ellipse(C, T - 3, 5, 4, hairR);
    }
    if (style === 'fringe' && a.singed) {
      sp.begin({ flat: true, shadow: 'none' });
      for (let x = C - 9; x <= C + 8; x += 3) sp.dot(x, T + 12, '#2a1a14');
    }
    if (style === 'ponytail') {
      sp.begin({ band: 1 });
      for (let y = T + 4; y < T + 24; y++) sp.span(C + 12, C + 14 - (y > T + 18 ? 1 : 0), y, hairR);
      sp.begin({ flat: true });
      sp.dot(C + 12, T + 4, '#ab3a45');
      sp.dot(C + 13, T + 4, '#7a2232');
    }
    if (style === 'braid' && a.braid !== 'left') {
      sp.begin({ band: 0 });
      for (let y = T + 14; y < 46; y++) {
        sp.set(C + 10, y, hairR, (y % 3) === 0 ? 2 : 1);
        sp.set(C + 11, y, hairR, (y % 3) === 1 ? 0 : 1);
        sp.set(C + 12, y, hairR, (y % 3) === 2 ? 0 : 1);
      }
    }
    hairStrands(sp, C - 14, C + 14, T - 2, T + 30, hairR, 7);
    // shine arc on the crown
    sp.begin({ flat: true, shadow: 'none' });
    const shine = lighten(hairR[2], 0.35);
    for (let i = 0; i < 6; i++) sp.dot(C - 8 + i, T + 2 - (i > 1 && i < 4 ? 1 : 0), i % 2 ? hairR[2] : shine);
    sp.dot(C - 9, T + 3, hairR[2]);
  } else if (style === 'bald') {
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(C - 6, T + 3, lighten(a.skin[2], 0.3));
    sp.dot(C - 5, T + 3, lighten(a.skin[2], 0.3));
    sp.dot(C - 7, T + 4, lighten(a.skin[2], 0.2));
    if (a.wrinkles) {
      sp.begin({ band: 1 });
      for (let y = T + 10; y < T + 17; y++) {
        sp.span(C - 12, C - 10, y, hairR);
        sp.span(C + 9, C + 11, y, hairR);
      }
    }
  }

  // --- Lyra's braid over her left shoulder (screen right) and the crescent pin
  if (a.braid === 'left') paintBraid(sp, hairR, T + 9, 46);
  if (a.hairpin) {
    // a silver crescent moon above her left temple
    const px = C + 6;
    const py = T + 2;
    const pts = [
      [1, 0, '#ffffff'],
      [2, 0, '#e6e9f2'],
      [0, 1, '#e6e9f2'],
      [3, 1, '#c9cede'],
      [0, 2, '#c9cede'],
      [0, 3, '#a3a8b8'],
      [1, 4, '#a3a8b8'],
      [2, 4, '#c9cede'],
      [3, 3, '#7d8194'],
    ];
    sp.begin({ flat: true, shadow: 'none' });
    for (const [dx, dy, c] of pts) sp.dot(px + dx, py + dy, c);
    glow(sp, px + 1.5, py + 2, 2.6, '#dfe6ff', 0.25);
  }
  brows(sp, a, expr, T);

  // --- headwear
  if (a.hoodUp && a.hood) {
    sp.begin({ band: 2, shadow: 'top' });
    for (let y = T - 3; y < 48; y++) {
      const r = y - T;
      const outer = r < 0 ? 10 + r : r < 24 ? 15 : 17;
      for (let x = C - outer; x <= C + outer - 1; x++) {
        const inner = r < 3 ? -1 : r < 24 ? headHalf(r, a.build) - (r < 6 ? 2 : 0) : 6;
        if (Math.abs(x - C + 0.5) < inner && r >= 3 && r < 27) continue;
        sp.set(x, y, a.hood);
      }
    }
    sp.begin({ flat: true, shadow: 'none' });
    for (let x = C - 9; x <= C + 8; x++) sp.detail(x, T + 4, a.skin[0]);
    for (let x = C - 9; x <= C + 8; x++) sp.detail(x, T + 5, mixHex(a.skin[0], a.skin[1], 0.5));
  }
  if (a.scarf) {
    // Sabeth's headscarf: snug over the crown, down past the ears, knotted at the nape
    sp.begin({ band: 2, shadow: 'top' });
    for (let y = T - 2; y < T + 24; y++) {
      const r = y - T;
      const outer = r < 0 ? 8 : r < 6 ? headHalf(Math.max(0, r), a.build) + 2 : r < 18 ? 14 : 13 - (r - 18);
      for (let x = C - outer; x <= C + outer - 1; x++) {
        const inner = r < 8 ? -1 : headHalf(r, a.build) - (r < 10 ? 1 : 0);
        if (Math.abs(x - C + 0.5) < inner) continue;
        sp.set(x, y, a.scarf);
      }
    }
    // the knot and its tail at the side of the neck
    sp.ellipse(C + 11, T + 24, 3, 2.4, a.scarf);
    for (let y = T + 25; y < T + 31; y++) sp.span(C + 10 + ((y - T) % 2), C + 12, y, a.scarf);
    hairStrands(sp, C - 15, C + 15, T - 2, T + 24, a.scarf, 6);
    sp.begin({ flat: true, shadow: 'none' });
    for (let x = C - 8; x <= C + 7; x++) sp.dot(x, T + 7, a.scarf[2]);
  }
  if (a.hat && a.hatStyle === 'veil') {
    // a straw beekeeper's hat, the gauze veil pushed back over the crown
    sp.begin({ band: 2, shadow: 'top' });
    // the gauze bunched up above and behind the crown
    sp.begin({ flat: true, shadow: 'none' });
    for (let y = T - 8; y <= T - 4; y++) {
      const h = 6 + (y - T + 8) * 1.5;
      for (let x = Math.round(C - h); x <= Math.round(C + h - 1); x++) sp.dot(x, y, (x + 2 * y) % 5 === 0 ? '#ffffff' : '#dfe4ec', 0.5);
    }
    sp.begin({ band: 2, shadow: 'top' });
    for (let y = T - 4; y <= T + 3; y++) sp.span(C - 9, C + 8, y, a.hat);
    sp.ellipse(C, T + 5, 18, 2.6, a.hat);
    sp.begin({ flat: true });
    for (let x = C - 9; x <= C + 8; x++) sp.dot(x, T + 2, '#e2d2b0');
    hairStrands(sp, C - 18, C + 18, T - 4, T + 7, a.hat, 2);
  } else if (a.hat && a.hatStyle === 'knit') {
    // a fisherman's knit cap: rounded crown, ribbed cuff
    sp.begin({ band: 2, shadow: 'top' });
    for (let y = T - 5; y <= T + 3; y++) {
      const r = y - T + 5;
      const h = r < 2 ? 7 + r * 2 : 12;
      sp.span(C - h, C + h - 1, y, a.hat);
    }
    sp.begin({ band: 1 });
    for (let y = T + 4; y <= T + 7; y++) sp.span(C - 13, C + 12, y, a.hat);
    sp.begin({ flat: true, shadow: 'none' });
    for (let x = C - 12; x <= C + 11; x += 2) for (let y = T + 4; y <= T + 7; y++) sp.dot(x, y, a.hat[0]);
    for (let x = C - 9; x <= C + 8; x += 3) sp.dot(x, T - 1, a.hat[2]);
  } else if (a.hat && a.hatStyle === 'helmet') {
    // a watchman's kettle helmet, a size too big, sitting low over the brow
    sp.begin({ band: 2, shadow: 'top' });
    for (let y = T - 5; y <= T + 7; y++) {
      const r = y - T + 5;
      const h = r < 3 ? 8 + r * 2 : 13;
      sp.span(C - h, C + h - 1, y, a.hat);
    }
    sp.ellipse(C, T + 8, 19, 2.4, a.hat);
    sp.begin({ flat: true, shadow: 'none' });
    for (let x = C - 7; x <= C - 2; x++) sp.dot(x, T - 3 + (x - C + 7 > 3 ? 1 : 0), '#e6e9f2');
    for (let x = C - 12; x <= C + 11; x++) sp.dot(x, T + 6, a.hat[0]);
    for (let x = C - 9; x <= C + 8; x++) sp.detail(x, T + 10, a.skin[0]);
  } else if (a.hat) {
    if (a.hatStyle === 'brim') {
      sp.begin({ band: 2, shadow: 'top' });
      for (let y = T - 5; y <= T + 3; y++) sp.span(C - 9, C + 8, y, a.hat);
      sp.begin({ band: 2, shadow: 'top' });
      sp.ellipse(C, T + 5, 19, 2.6, a.hat);
      sp.begin({ flat: true });
      for (let x = C - 9; x <= C + 8; x++) sp.dot(x, T + 2, '#7a2232');
      for (let x = C - 9; x <= C + 8; x++) sp.dot(x, T + 3, '#5e1a28');
      hairStrands(sp, C - 18, C + 18, T - 5, T + 7, a.hat, 2);
    } else {
      sp.begin({ band: 2, shadow: 'top' });
      for (let y = T - 4; y <= T + 6; y++) {
        const h = y < T - 2 ? 8 : 12;
        sp.span(C - h, C + h - 1, y, a.hat);
      }
      sp.span(C - 14, C + 3, T + 7, a.hat);
      sp.begin({ flat: true, shadow: 'none' });
      for (let i = 0; i < 9; i++) {
        sp.dot(C + 8 + (i >> 2), T - 4 - i, i % 3 ? '#e8e0cc' : '#c9b98a');
        sp.dot(C + 9 + (i >> 2), T - 4 - i, '#d8ccac');
      }
    }
  }
  if (a.headband) {
    sp.begin({ flat: true, shadow: 'none' });
    for (let x = C - 12; x <= C + 11; x++) {
      sp.set(x, T + 7, a.headband, x < C - 4 ? 2 : 1);
      sp.set(x, T + 8, a.headband, 0);
    }
    // a sprig of flowers
    sp.dot(C + 7, T + 5, '#f6d8e8');
    sp.dot(C + 8, T + 6, '#e890b8');
    sp.dot(C + 6, T + 6, '#f6d8e8');
    sp.dot(C + 7, T + 6, '#ffe27a');
    sp.dot(C + 9, T + 7, '#58cf8f');
  }
  if (a.glasses) {
    sp.begin({ flat: true, shadow: 'none' });
    // pushed up on his head, where he cannot find them
    const ey = a.glassesUp ? T + 4 : T + 13;
    const frame = '#6b5a4a';
    for (const x0 of [C - 9, C + 3]) {
      for (let i = 0; i < 6; i++) {
        sp.dot(x0 + i, ey - 1, frame);
        sp.dot(x0 + i, ey + 4, frame);
      }
      for (let j = 0; j < 5; j++) {
        sp.dot(x0, ey - 1 + j, frame);
        sp.dot(x0 + 5, ey - 1 + j, frame);
      }
      sp.dot(x0 + 1, ey, '#e8f6ff');
    }
    sp.dot(C - 3, ey, frame);
    sp.dot(C - 2, ey, frame);
    sp.dot(C + 1, ey, frame);
    sp.dot(C + 2, ey, frame);
  }
  if (a.eyepatch) {
    sp.begin({ band: 1 });
    const ey = T + 12;
    sp.rect(C - 9, ey, 6, 5, ['#141219', '#24212c', '#38343f']);
    sp.begin({ flat: true });
    for (let i = 0; i < 12; i++) sp.dot(C - 3 + i, ey - 1 - Math.round(i * 0.6), '#24212c');
    for (let i = 0; i < 4; i++) sp.dot(C - 10 - i, ey + 1 + i, '#24212c');
  }

  // --- cloak / mantle over the shoulders
  if (a.cloak) {
    sp.begin({ band: 3 });
    for (let y = shoulderTop - 1; y < 48; y++) {
      const t = Math.min(1, (y - shoulderTop + 1) / 6);
      const h = Math.round(10 + broad + t * (10 + broad));
      for (let x = C - h; x <= C + h - 1; x++) {
        const open = Math.abs(x - C + 0.5) < 3 + (y - shoulderTop) * 0.6;
        if (open && y > shoulderTop) continue;
        sp.set(x, y, a.cloak);
      }
    }
    if (a.cloakTrim) {
      sp.begin({ flat: true, shadow: 'none' });
      for (let y = shoulderTop + 1; y < 48; y++) {
        const w = 3 + (y - shoulderTop) * 0.6;
        sp.set(Math.round(C - w - 1), y, a.cloakTrim, 2);
        sp.set(Math.round(C + w), y, a.cloakTrim, 1);
      }
    }
    if (a.cloakLining) {
      sp.begin({ flat: true, shadow: 'none' });
      for (let y = shoulderTop + 2; y < 48; y++) {
        const w = 3 + (y - shoulderTop) * 0.6;
        sp.set(Math.round(C - w - 2), y, a.cloakLining, 1);
        sp.set(Math.round(C + w + 1), y, a.cloakLining, 0);
      }
    }
    // clasp
    sp.begin({ flat: true, shadow: 'none' });
    const metal = a.cloakTrim ? ['#a3a8b8', '#e6e9f2', '#ffffff'] : ['#b58726', '#e4b83d', '#ffe27a'];
    sp.dot(C - 5, shoulderTop + 1, metal[1]);
    sp.dot(C - 4, shoulderTop + 1, metal[2]);
    sp.dot(C - 5, shoulderTop + 2, metal[0]);
    sp.dot(C + 4, shoulderTop + 1, metal[1]);
    sp.dot(C + 3, shoulderTop + 1, metal[0]);
    sp.dot(C + 4, shoulderTop + 2, metal[0]);
  }
  if (a.braid === 'left') paintBraid(sp, hairR, 36, 46);
  if (a.tabard) {
    sp.begin({ band: 1 });
    for (let y = shoulderTop + 3; y < 48; y++) sp.span(C - 5, C + 4, y, a.tabard);
    sp.begin({ flat: true, shadow: 'none' });
    for (let y = shoulderTop + 4; y < 48; y++) sp.dot(C - 1, y, a.tabard[2]);
  }
  if (a.shawl) {
    // a moth-eaten shawl round the shoulders, crossed at the throat
    sp.begin({ band: 2, shadow: 'top' });
    for (let y = shoulderTop - 2; y < 48; y++) {
      const t = Math.min(1, (y - shoulderTop + 2) / 5);
      const h = Math.round(9 + broad + t * (10 + broad));
      for (let x = C - h; x <= C + h - 1; x++) {
        if (y > shoulderTop + 1 && Math.abs(x - C + 0.5) < 2 + (y - shoulderTop) * 0.35 && y < shoulderTop + 7) continue;
        sp.set(x, y, a.shawl);
      }
    }
    hairStrands(sp, 2, 46, shoulderTop - 2, 47, a.shawl, 9);
    sp.begin({ flat: true, shadow: 'none' });
    for (const [x, y] of [[-14, 6], [9, 8]]) sp.dot(C + x, shoulderTop + y, a.shawl[0]);
  }
  if (a.chain) {
    // the Reeve's chain of office
    sp.begin({ flat: true, shadow: 'none' });
    for (let i = 0; i <= 8; i++) {
      const y = shoulderTop + 1 + Math.round(Math.sin((i / 8) * Math.PI) * 6);
      sp.set(C - 8 + i * 2, y, a.chain, i % 2 ? 2 : 1);
    }
    sp.ellipse(C - 0.5, shoulderTop + 8.5, 1.6, 1.6, a.chain);
  }
  if (a.needle) {
    sp.begin({ flat: true, shadow: 'none' });
    for (let i = 0; i < 4; i++) sp.dot(C + 6 + i, shoulderTop + 1 + i, i ? '#c9cede' : '#ffffff');
  }
  if (a.beltLantern || a.quiver) {
    // the quiver strap over her shoulder
    if (a.quiver) {
      sp.begin({ flat: true, shadow: 'none' });
      for (let y = shoulderTop; y < 48; y++) sp.set(C + 8 - Math.round((y - shoulderTop) * 1.3), y, ['#2e1d14', '#51331f', '#76502f'], 1);
      for (const [x, y] of [[13, -3], [14, -4], [12, -4]]) sp.dot(C + x, shoulderTop + y, '#e0dccf');
    }
  }
  return sp;
}

// Clouded eyes (Wenna) and a water-glare squint (Corran), over the painted eyes.
function eyeOverlay(sp, a, expr, T) {
  if (a.eyeStyle !== 'milky' && a.eyeStyle !== 'squint') return;
  if (expr === 'happy' || expr === 'sleepy' || expr === 'love') return;
  const ey = T + 13;
  sp.begin({ flat: true, shadow: 'none' });
  for (const x0 of [C - 8, C + 4]) {
    if (a.eyeStyle === 'milky') {
      for (let i = 1; i < 3; i++) {
        sp.dot(x0 + i, ey + 1, '#dce8f0');
        sp.dot(x0 + i, ey + 2, '#b4cad8');
      }
      sp.dot(x0 + 1, ey + 1, '#ffffff');
    } else {
      for (let i = 0; i < 4; i++) {
        sp.dot(x0 + i, ey + 1, darken(a.skin[0], 0.05));
        sp.dot(x0 + i, ey + 2, i === 0 || i === 3 ? a.skin[0] : EYE_DARK);
        sp.dot(x0 + i, ey + 3, a.skin[1]);
      }
      sp.dot(x0 - 1, ey + 2, a.skin[0]);
      sp.dot(x0 + 4, ey + 3, a.skin[0]);
    }
  }
}
