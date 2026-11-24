// Boss sprites (DESIGN §22.3) and glyph runes, painted at boot with the same software
// painter as every character (src/art/characters_paint.js: shaded volumes, light from the
// upper left, a selectively tinted outline). Bosses are big (32–48 px figures in 48–64 px
// frames) and seen from the side; facing left is the mirror image.
//
//   registerBossArt(atlas)                         paint every boss and glyph into the atlas
//   drawBossSprite(ctx, atlas, id, anim, t, x, y, { flip, flash, alpha, variant })
//   bossAnimInfo(atlas, id, anim) -> { frames, fps, loop, duration } | null
//   paintBossFrame(id, anim, frame, variant) -> Sprite (no DOM: tests render it to RGBA)
//   BOSS_ART[id] = { w, h, ox, oy, anims: { name: [frames, fps, loop] }, variants }
//   drawGlyph(ctx, atlas, kind, id, x, y, { spin, pal, time })
//   glyphBitmap(kind, id) -> Uint8Array(16*16) (1 = stroke)    glyphCanvas(kind, id, pal, scale)
//
// Sprite names: `boss:<id>:<anim>` and `boss:<id>:<anim>:<variant>`; meta `boss:<id>`.

import { Sprite, tri, darken } from './characters_paint.js';
import { RAMPS, OUTLINE } from './palette.js';
import { ensureCharacter } from './characters_art.js';
import { PRESET_APPEARANCES } from './characters_appearance.js';

const A = (frames, fps, loop = true) => [frames, fps, loop];

export const BOSS_ART = {
  varek: {
    w: 48,
    h: 56,
    ox: 24,
    oy: 53,
    variants: [null, 'fire'],
    anims: {
      idle: A(4, 3),
      move: A(6, 9),
      telegraph: A(2, 6),
      attack: A(3, 12, false),
      charge: A(2, 10),
      raise: A(2, 5),
      slam: A(2, 8, false),
      call: A(2, 4),
      hurt: A(1, 1, false),
      defeat: A(4, 3, false),
    },
  },
  greyjaw: {
    w: 72,
    h: 48,
    ox: 36,
    oy: 44,
    variants: [null],
    anims: {
      idle: A(4, 3),
      move: A(6, 12),
      crouch: A(2, 8),
      attack: A(2, 10, false),
      howl: A(2, 3),
      hurt: A(1, 1, false),
      defeat: A(3, 3, false),
    },
  },
  mother_of_slimes: {
    w: 64,
    h: 52,
    ox: 32,
    oy: 48,
    variants: ['L', 'M', 'S'],
    anims: {
      idle: A(4, 4),
      move: A(4, 7),
      telegraph: A(2, 7),
      attack: A(2, 8, false),
      hurt: A(1, 1, false),
      defeat: A(4, 2.5, false),
    },
  },
  lakes_hum: {
    w: 48,
    h: 64,
    ox: 24,
    oy: 60,
    noFlip: true,
    variants: [null],
    anims: {
      rise: A(4, 4.5, false),
      idle: A(4, 4),
      telegraph: A(2, 6),
      attack: A(2, 8, false),
      sink: A(4, 4.5, false),
      hurt: A(1, 1, false),
      defeat: A(4, 2, false),
      move: A(4, 4),
    },
  },
  bone_warden: {
    w: 48,
    h: 60,
    ox: 24,
    oy: 56,
    variants: [null],
    anims: {
      idle: A(4, 3),
      move: A(6, 7),
      telegraph: A(2, 6),
      attack: A(3, 12, false),
      lantern: A(2, 6),
      shield: A(2, 3),
      stagger: A(2, 3),
      hurt: A(1, 1, false),
      defeat: A(4, 3, false),
    },
  },
};

// ---------------------------------------------------------------- shared tools

const SKIN_TAN = ['#8f5a3c', '#c98f66', '#eab48a'];
const LEATHER = ['#3b2418', '#6b4128', '#97633e'];
const TROUSER = ['#232233', '#363548', '#504e66'];
const BOOT = ['#1e140f', '#36241a', '#523726'];
const RUST = ['#5a1a14', '#932f20', '#c4533a'];
const FUR = ['#3e3833', '#6e655b', '#a39787'];
const BEARD = ['#24160f', '#4a2e20', '#704632'];
const IRON = tri(RAMPS.iron, 0);
const WOOD = tri(RAMPS.wood, 0);
const EMBER = ['#c4501f', '#ffb047', '#ffe08a'];
const BONE = ['#8a7f6c', '#d2c7ad', '#f6f0de'];
const BONE_DARK = ['#4a4238', '#7d7362', '#a89c84'];
const PLATE = ['#262a38', '#4a5266', '#8590a8'];
const CLOAK = ['#12101c', '#221e36', '#3a3454'];
const GRAVE = ['#2c4a8a', '#7fb2ff', '#e0f0ff'];
const EYE_GOLD = '#ffd75e';
const WHITE = '#fff8ee';

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Paint with an offset (so a tall pose fits a taller frame without moving every number).
// Works with the helpers below, which only use begin/set/dot/rect/ellipse/solid.
function shifted(raw, dx, dy) {
  return {
    raw,
    set rimRamps(v) {
      raw.rimRamps = v;
    },
    begin: (o) => raw.begin(o),
    set: (x, y, r, t) => raw.set(x + dx, y + dy, r, t),
    dot: (x, y, c, a) => raw.dot(x + dx, y + dy, c, a),
    rect: (x, y, w, h, r, t) => raw.rect(x + dx, y + dy, w, h, r, t),
    ellipse: (cx, cy, rx, ry, r, t) => raw.ellipse(cx + dx, cy + dy, rx, ry, r, t),
    solid: (x, y) => {
      const X = x + dx;
      const Y = y + dy;
      return raw.isSet(X, Y) && raw.alpha[Y * raw.w + X] >= 0.5;
    },
  };
}

// Soft light around a point, under nothing solid.
function halo(sp, cx, cy, r, color, strength = 0.6) {
  sp.begin({ flat: true, noOutline: true, shadow: 'none' });
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d > 1 || sp.solid(x, y)) continue;
      sp.dot(x, y, color, Math.max(0.1, strength * (1 - d) * (1 - d) + 0.08));
    }
  }
}

// A thick limb between two points (round joints).
function limb(sp, x0, y0, x1, y1, w, ramp, tone = -1) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(d * 2));
  const r = w / 2;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const cx = lerp(x0, x1, t);
    const cy = lerp(y0, y1, t);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r + 0.05) sp.set(x, y, ramp, tone);
      }
    }
  }
}

// A limb that tapers from w0 to w1.
function taper(sp, x0, y0, x1, y1, w0, w1, ramp, tone = -1) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(d * 2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const cx = lerp(x0, x1, t);
    const cy = lerp(y0, y1, t);
    const r = lerp(w0, w1, t) / 2;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r + 0.05) sp.set(x, y, ramp, tone);
      }
    }
  }
}

function disc(sp, cx, cy, rx, ry, ramp, tone = -1) {
  sp.ellipse(cx, cy, rx, ry, ramp, tone);
}

// A filled polygon (points in sprite pixels).
function poly(sp, pts, ramp, tone = -1) {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [, y] of pts) {
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    const xs = [];
    const yc = y + 0.5;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k] - 0.5); x <= Math.floor(xs[k + 1] - 0.5); x++) sp.set(x, y, ramp, tone);
    }
  }
}

function darkerRamp(r) {
  return [darken(r[0], 0.25), darken(r[1], 0.25), darken(r[2], 0.3)];
}

// ---------------------------------------------------------------- Varek One-Eye

// The axe: an ash haft from the hand, a bearded iron head at the end.
function axe(sp, hx, hy, ang, len, fire, side = 1) {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const px = -uy * side;
  const py = ux * side;
  sp.begin({ band: 0 });
  limb(sp, hx - ux * 4, hy - uy * 4, hx + ux * len, hy + uy * len, 2, WOOD);
  const head = fire ? EMBER : IRON;
  sp.begin({ band: 1, noShadow: !!fire });
  const hx2 = hx + ux * len;
  const hy2 = hy + uy * len;
  poly(
    sp,
    [
      [hx2 - ux * 6 - px * 1, hy2 - uy * 6 - py * 1],
      [hx2 - ux * 9 + px * 7, hy2 - uy * 9 + py * 7],
      [hx2 + ux * 2 + px * 8, hy2 + uy * 2 + py * 8],
      [hx2 + ux * 1 - px * 1, hy2 + uy * 1 - py * 1],
    ],
    head,
  );
  // The edge catches the light (or the fire).
  sp.begin({ flat: true, shadow: 'none' });
  for (let t = -8; t <= 1; t++) {
    const k = (t + 8) / 9;
    sp.dot(Math.round(hx2 + ux * t + px * (7 + k)), Math.round(hy2 + uy * t + py * (7 + k)), fire ? '#fff4c0' : '#e8ecf4', 0.95);
  }
  if (fire) halo(sp, hx2 + px * 4, hy2 + py * 4, 10, '#ff9a4a', 0.6);
}

function varekPose(anim, f) {
  const P = { bob: 0, lean: 0, legs: [0, 0, 0, 0], hand: [31, 27], ang: 1.2, len: 18, behind: false, free: [18, 31], headDy: 0, mouth: false, kneel: 0, dropAxe: false, side: -1, smear: false };
  switch (anim) {
    case 'idle':
      // Leaning on his axe, head down in the dirt in front of him.
      P.bob = [0, 0, 1, 1][f];
      P.free = [18, 31 + P.bob];
      break;
    case 'move': {
      const t = (f / 6) * Math.PI * 2;
      P.bob = [0, 1, 0, 0, 1, 0][f];
      P.legs = [Math.round(3 * Math.sin(t)), Math.cos(t) > 0.3 ? 2 : 0, Math.round(-3 * Math.sin(t)), Math.cos(t) < -0.3 ? 2 : 0];
      P.hand = [32, 29];
      P.ang = 0.55;
      P.len = 18;
      P.free = [19 + Math.round(2 * Math.cos(t)), 30];
      break;
    }
    case 'telegraph':
      P.lean = -2;
      P.bob = f;
      P.hand = [19, 9];
      P.ang = -2.6;
      P.len = 20;
      P.behind = true;
      P.free = [31, 24];
      P.side = 1;
      break;
    case 'attack':
      P.lean = [2, 3, 2][f];
      P.hand = [
        [32, 13],
        [36, 25],
        [33, 32],
      ][f];
      P.ang = [-0.95, 0.15, 1.15][f];
      P.len = 20;
      P.free = [27, 28];
      P.smear = f === 1;
      P.legs = [-2, 0, 3, 0];
      P.side = 1;
      break;
    case 'charge':
      P.lean = 4;
      P.bob = 1;
      P.headDy = 2;
      P.legs = f ? [-5, 0, 5, 2] : [4, 2, -4, 0];
      P.hand = [21, 30];
      P.ang = Math.PI - 0.35;
      P.len = 19;
      P.behind = true;
      P.free = [33, 24];
      P.side = 1;
      break;
    case 'raise':
      P.bob = -f;
      P.hand = [26, 6];
      P.ang = -1.72;
      P.len = 18;
      P.free = [23, 7];
      P.legs = [-2, 0, 2, 0];
      P.side = 1;
      break;
    case 'slam':
      P.bob = 3;
      P.lean = 3;
      P.hand = [34, 32];
      P.ang = 0.95;
      P.len = 16;
      P.free = [31, 31];
      P.legs = [-3, 0, 4, 0];
      P.side = 1;
      break;
    case 'call':
      P.free = [22 + f, 2 + f];
      P.mouth = true;
      P.headDy = -1;
      P.hand = [32, 30];
      P.ang = 0.7;
      P.len = 18;
      break;
    case 'hurt':
      P.lean = -3;
      P.headDy = -1;
      P.hand = [29, 31];
      P.ang = 1.35;
      P.len = 18;
      P.free = [17, 27];
      break;
    case 'defeat':
      if (f === 0) {
        P.lean = -3;
        P.headDy = -1;
        P.hand = [29, 32];
        P.ang = 1.4;
      } else {
        P.kneel = f === 1 ? 1 : 2;
        P.bob = f === 1 ? 4 : 7;
        P.headDy = f === 3 ? 3 : 1;
        P.dropAxe = f >= 2;
        P.hand = f === 1 ? [30, 36] : [28, 38];
        P.ang = 1.4;
        P.free = [21, 40];
      }
      break;
    default:
      break;
  }
  return P;
}

function varekHead(sp, hx, hy, mouth) {
  // Shaved head, a dark topknot and braid, a short black beard, the patch over the eye.
  sp.begin({ band: 1 });
  disc(sp, hx, hy, 4.6, 5, SKIN_TAN);
  sp.begin({ band: 1 });
  disc(sp, hx - 2.5, hy - 4, 2, 1.8, BEARD);
  limb(sp, hx - 4, hy - 3, hx - 6, hy + 2, 1.6, BEARD);
  sp.begin({ band: 1 });
  poly(
    sp,
    [
      [hx, hy + 2],
      [hx + 5.5, hy + 2],
      [hx + 4.5, hy + 6.5],
      [hx + 1.5, hy + 7.5],
      [hx - 1.5, hy + 4.5],
    ],
    BEARD,
  );
  sp.begin({ flat: true, shadow: 'none' });
  // brow, nose, the patch and its strap
  sp.dot(hx + 2, hy - 2, SKIN_TAN[0]);
  sp.dot(hx + 3, hy - 2, SKIN_TAN[0]);
  sp.dot(hx + 4, hy - 2, SKIN_TAN[0]);
  sp.dot(hx + 5, hy, SKIN_TAN[1]);
  sp.dot(hx + 5, hy + 1, SKIN_TAN[0]);
  sp.dot(hx + 2, hy - 1, '#141018');
  sp.dot(hx + 3, hy - 1, '#141018');
  sp.dot(hx + 2, hy, '#141018');
  sp.dot(hx + 3, hy, '#2a2228');
  sp.dot(hx + 1, hy - 2, '#141018');
  sp.dot(hx, hy - 3, '#141018');
  sp.dot(hx - 1, hy - 3, '#141018');
  sp.dot(hx - 2, hy - 2, '#141018');
  sp.dot(hx - 3, hy - 2, '#141018');
  // a white scar running out from under the patch
  sp.dot(hx + 3, hy + 1, '#f2d2b6');
  sp.dot(hx + 4, hy + 2, '#f2d2b6');
  if (mouth) {
    sp.dot(hx + 3, hy + 3, '#3a0d16');
    sp.dot(hx + 4, hy + 3, '#3a0d16');
    sp.dot(hx + 3, hy + 4, '#6b1424');
    sp.dot(hx + 4, hy + 4, '#6b1424');
  }
}

function paintVarek(anim, f, variant) {
  const raw = new Sprite(48, 56);
  const sp = shifted(raw, 0, 8);
  sp.rimRamps = new Set([FUR, BEARD]);
  const fire = variant === 'fire';
  const P = varekPose(anim, f);
  const b = P.bob;
  const L = P.lean;
  const G = 45;
  const hip = [23 + L * 0.3, 32 + b];
  const shN = [28 + L, 20 + b];
  const shF = [19 + L, 20 + b];
  if (P.dropAxe) axe(sp, 22, 44, 0.05, 20, false, -1);
  // Far arm (behind the body).
  const fe = [lerp(shF[0], P.free[0], 0.5) - 1, lerp(shF[1], P.free[1], 0.5) + 1];
  sp.begin({ band: 0 });
  limb(sp, shF[0], shF[1], fe[0], fe[1], 4.4, darkerRamp(RUST));
  limb(sp, fe[0], fe[1], P.free[0], P.free[1], 4, darkerRamp(SKIN_TAN));
  if (P.behind && !P.dropAxe) axe(sp, P.hand[0] + L, P.hand[1] + b, P.ang, P.len, fire, P.side);
  // Legs: dark trousers, heavy boots.
  if (P.kneel === 2) {
    sp.begin({ band: 0 });
    limb(sp, hip[0] - 1, hip[1], 16, G - 1, 5, darkerRamp(TROUSER));
    limb(sp, 16, G - 1, 11, G, 4, darkerRamp(BOOT));
    sp.begin({ band: 1 });
    limb(sp, hip[0] + 2, hip[1], 29, hip[1] + 1, 5, TROUSER);
    limb(sp, 29, hip[1] + 1, 30, G - 2, 5, TROUSER);
    sp.rect(28, G - 2, 6, 3, BOOT);
  } else {
    const [fd, fl, nd, nl] = P.legs;
    const kd = P.kneel ? 3 : 0;
    sp.begin({ band: 0 });
    limb(sp, hip[0] - 2, hip[1], 20 + fd * 0.5, 39 + kd, 5, darkerRamp(TROUSER));
    limb(sp, 20 + fd * 0.5, 39 + kd, 20 + fd, G - 2 - fl, 5, darkerRamp(TROUSER));
    sp.begin({ band: 1 });
    sp.rect(Math.round(18 + fd), G - 3 - fl, 6, 4, darkerRamp(BOOT));
    sp.begin({ band: 1 });
    limb(sp, hip[0] + 2, hip[1], 26 + nd * 0.5, 39 + kd, 5, TROUSER);
    limb(sp, 26 + nd * 0.5, 39 + kd, 26 + nd, G - 2 - nl, 5, TROUSER);
    sp.begin({ band: 1 });
    sp.rect(Math.round(24 + nd), G - 3 - nl, 7, 4, BOOT);
  }
  // Torso: a leather jerkin, a rust sash, a broad belt.
  const tx = 23.5 + L * 0.7;
  const ty = 25.5 + b;
  sp.begin({ band: 2 });
  disc(sp, tx, ty, 8, 8.5, LEATHER);
  sp.rect(Math.round(tx - 7), Math.round(ty), 14, 7, LEATHER);
  sp.begin({ band: 1 });
  for (let k = 0; k < 10; k++) {
    sp.set(Math.round(tx + 5 - k * 1.1), Math.round(ty - 6 + k * 1.15), RUST);
    sp.set(Math.round(tx + 6 - k * 1.1), Math.round(ty - 6 + k * 1.15), RUST);
    sp.set(Math.round(tx + 4 - k * 1.1), Math.round(ty - 6 + k * 1.15), RUST);
  }
  sp.begin({ flat: true, shadow: 'none' });
  sp.rect(Math.round(tx - 7), Math.round(ty + 4), 15, 2, ['#1a1008', '#2a1a10', '#3b2418'], 1);
  sp.dot(Math.round(tx + 3), Math.round(ty + 4), '#ffe27a');
  sp.dot(Math.round(tx + 3), Math.round(ty + 5), '#b58726');
  sp.dot(Math.round(tx + 4), Math.round(ty + 4), '#b58726');
  // Fur mantle on the shoulders.
  sp.begin({ band: 1 });
  disc(sp, 23.5 + L, 19 + b, 9, 3.6, FUR);
  sp.begin({ flat: true, shadow: 'none' });
  for (let k = 0; k < 6; k++) sp.dot(Math.round(16 + L + k * 3), Math.round(22 + b + (k % 2)), FUR[0]);
  varekHead(sp, 26 + L, 11 + b + P.headDy, P.mouth);
  // Near arm, then the axe in front.
  const hx = P.hand[0] + L;
  const hy = P.hand[1] + b;
  const el = [lerp(shN[0], hx, 0.5) + 1, lerp(shN[1], hy, 0.5) + 1];
  sp.begin({ band: 1 });
  limb(sp, shN[0], shN[1], el[0], el[1], 4.8, RUST);
  limb(sp, el[0], el[1], hx, hy, 4.2, SKIN_TAN);
  sp.begin({ band: 1 });
  limb(sp, lerp(el[0], hx, 0.35), lerp(el[1], hy, 0.35), lerp(el[0], hx, 0.7), lerp(el[1], hy, 0.7), 4.8, LEATHER);
  if (!P.behind && !P.dropAxe) axe(sp, hx, hy, P.ang, P.len, fire, P.side);
  if (P.smear) {
    sp.begin({ flat: true, noOutline: true, shadow: 'none' });
    for (let a = -0.9; a < 0.2; a += 0.05) {
      for (let r = 17; r < 27; r++) sp.dot(Math.round(hx + Math.cos(a) * r), Math.round(hy + Math.sin(a) * r), fire ? '#ffd08a' : '#e8ecf4', 0.4 * (1 - Math.abs(a + 0.35) / 0.6));
    }
  }
  return raw;
}

// ---------------------------------------------------------------- Greyjaw

// Silver-grey, so the alpha reads even under the night canopy.
const GJ_BODY = ['#4a4858', '#807e94', '#b8b6ca'];
const GJ_SADDLE = ['#1e1d28', '#34323f', '#4f4c5e'];
const GJ_MANE = ['#6a6878', '#a4a2b6', '#dedcea'];
const GJ_BELLY = ['#7a788c', '#aeacbe', '#dcdbe6'];
const GJ_FAR = darkerRamp(GJ_BODY);

// One leg: upper bone at a1 (from straight down, + = forward), lower at a2; the paw lands
// on the ground unless lifted.
function gjLeg(sp, x, y, l1, a1, a2, w1, w2, ground, lift, ramp) {
  const kx = x + Math.sin(a1) * l1;
  const ky = y + Math.cos(a1) * l1;
  const footY = ground - 1 - lift;
  const l2 = Math.max(2, (footY - ky) / Math.max(0.35, Math.cos(a2)));
  const px = kx + Math.sin(a2) * l2;
  const py = Math.min(footY, ky + Math.cos(a2) * l2);
  taper(sp, x, y, kx, ky, w1, w2 + 0.6, ramp);
  taper(sp, kx, ky, px, py, w2 + 0.4, w2, ramp);
  sp.rect(Math.round(px) - 1, Math.round(py) - 1, 4, 2, ramp);
  return [px, py];
}

function greyjawPose(anim, f) {
  const P = { bob: 0, lower: 0, lunge: 0, head: [0, 0], jaw: 0, tail: 0, sit: false, lie: 0, fn: [0.05, -0.05, 0], ff: [0.05, -0.05, 0], hn: [-0.35, 0.3, 0], hf: [-0.35, 0.3, 0], stretch: 0 };
  switch (anim) {
    case 'idle':
      P.bob = [0, 0, 1, 1][f];
      P.tail = [0, 1, 1, 0][f];
      P.head = [0, [0, 0, 1, 1][f]];
      break;
    case 'move': {
      const t = (f / 6) * Math.PI * 2;
      P.bob = [0, 1, 2, 1, 0, 1][f];
      const sw = (p) => 0.62 * Math.sin(t + p);
      const up = (p) => Math.max(0, Math.cos(t + p)) * 3;
      P.fn = [sw(0), sw(0) * 0.3 - 0.25, up(0)];
      P.ff = [sw(0.9), sw(0.9) * 0.3 - 0.25, up(0.9)];
      P.hn = [-0.35 - sw(0), 0.3, up(Math.PI)];
      P.hf = [-0.35 - sw(0.9), 0.3, up(Math.PI + 0.9)];
      P.tail = -1;
      P.stretch = Math.round(1.5 * Math.sin(t));
      break;
    }
    case 'crouch':
      P.lower = 5;
      P.head = [1, 4];
      P.tail = -2;
      P.jaw = f ? 2 : 1;
      P.fn = [0.55, -0.45, 0];
      P.ff = [0.5, -0.45, 0];
      P.hn = [-0.8, 0.7, 0];
      P.hf = [-0.8, 0.7, 0];
      break;
    case 'attack':
      P.lunge = f ? 3 : 5;
      P.bob = f ? 0 : -4;
      P.stretch = f ? 2 : 4;
      P.fn = [1.15, 0.9, 5];
      P.ff = [1.0, 0.8, 4];
      P.hn = [-1.15, -0.5, 3];
      P.hf = [-1.0, -0.4, 3];
      P.jaw = 3;
      P.tail = -1;
      P.head = [2, f ? 1 : -1];
      break;
    case 'howl':
      P.sit = true;
      P.jaw = f ? 3 : 2;
      break;
    case 'hurt':
      P.lunge = -2;
      P.head = [-1, -3];
      P.jaw = 2;
      P.fn = [-0.2, 0.1, 0];
      break;
    case 'defeat':
      P.lie = f + 1;
      break;
    default:
      break;
  }
  return P;
}

function gjHead(sp, hx, hy, jaw, up = false) {
  sp.begin({ band: 1 });
  disc(sp, hx, hy, 5, 4.6, GJ_BODY);
  if (up) {
    poly(
      sp,
      [
        [hx - 1, hy - 3],
        [hx + 4, hy - 11],
        [hx + 6, hy - 10],
        [hx + 4, hy - 2],
      ],
      GJ_BODY,
    );
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(hx + 5, hy - 11, OUTLINE);
    for (let k = 0; k < jaw; k++) sp.dot(hx + 5 - k, hy - 7 + k, '#3a0d16');
  } else {
    poly(
      sp,
      [
        [hx + 2, hy - 3],
        [hx + 10, hy - 1],
        [hx + 12, hy + 1],
        [hx + 11, hy + 2.5],
        [hx + 2, hy + 3],
      ],
      GJ_BODY,
    );
    if (jaw) {
      sp.begin({ band: 0 });
      poly(
        sp,
        [
          [hx + 2, hy + 2.5],
          [hx + 10, hy + 2.5 + jaw],
          [hx + 9, hy + 4 + jaw],
          [hx + 2, hy + 5],
        ],
        GJ_BODY,
      );
      sp.begin({ flat: true, shadow: 'none' });
      // A dark mouth with fangs at the front, top and bottom.
      for (let k = 0; k < 6; k++) for (let j = 0; j <= jaw; j++) sp.dot(hx + 3 + k, hy + 3 + j, j === 0 ? '#6b1424' : '#3a0d16');
      sp.dot(hx + 8, hy + 3, WHITE);
      sp.dot(hx + 6, hy + 3, WHITE);
      sp.dot(hx + 7, hy + 3 + jaw, WHITE);
      sp.dot(hx + 5, hy + 3 + jaw, WHITE);
    }
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(hx + 12, hy + 1, OUTLINE);
    sp.dot(hx + 11, hy + 1, OUTLINE);
  }
  // Ears laid back a little, a scar through the eye, gold eyes.
  sp.begin({ band: 0 });
  poly(
    sp,
    [
      [hx - 4, hy - 1],
      [hx - 4, hy - 8],
      [hx - 0.5, hy - 2],
    ],
    GJ_BODY,
  );
  poly(
    sp,
    [
      [hx - 1, hy - 2],
      [hx, hy - 8],
      [hx + 2.5, hy - 2],
    ],
    GJ_BODY,
  );
  sp.begin({ flat: true, shadow: 'none' });
  sp.dot(hx - 1, hy - 5, '#2a2834');
  sp.dot(hx + 3, hy - 1, EYE_GOLD);
  sp.dot(hx + 4, hy - 1, OUTLINE);
  sp.dot(hx + 2, hy - 3, '#d6d4e0');
  sp.dot(hx + 3, hy - 2, '#d6d4e0');
  sp.dot(hx + 4, hy, '#d6d4e0');
  sp.dot(hx + 5, hy + 1, '#d6d4e0');
}

function paintGreyjaw(anim, f) {
  const raw = new Sprite(72, 48);
  const sp = shifted(raw, 0, 0);
  sp.rimRamps = new Set([GJ_BODY, GJ_SADDLE, GJ_MANE]);
  const P = greyjawPose(anim, f);
  const G = 44;
  const cx = 33 + P.lunge;
  if (P.lie) {
    // On his side, legs out, then still.
    const k = P.lie;
    const by = G - 6 + Math.min(2, k - 1);
    sp.begin({ band: 1 });
    taper(sp, cx - 14, by, cx - 26, by - 2 + k, 6, 3, GJ_BODY);
    sp.begin({ band: 0 });
    limb(sp, cx - 6, by + 2, cx - 1, G, 3, GJ_FAR);
    limb(sp, cx + 8, by + 2, cx + 13, G, 3, GJ_FAR);
    sp.begin({ band: 2 });
    disc(sp, cx - 1, by - 1, 15, 6.5 - (k - 1) * 0.8, GJ_BODY);
    sp.begin({ band: 1 });
    disc(sp, cx - 3, by - 4, 10, 2.5, GJ_SADDLE);
    sp.begin({ band: 1 });
    disc(sp, cx + 12, by - 2, 6, 5, GJ_MANE);
    disc(sp, cx + 17, by + 1, 5, 4.2, GJ_BODY);
    poly(
      sp,
      [
        [cx + 19, by - 1],
        [cx + 27, by + 1],
        [cx + 27, by + 3],
        [cx + 19, by + 4],
      ],
      GJ_BODY,
    );
    sp.begin({ band: 0 });
    limb(sp, cx - 4, by + 4, cx + 2, G, 3, GJ_BODY);
    limb(sp, cx + 6, by + 4, cx + 12, G, 3, GJ_BODY);
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(cx + 19, by, k >= 3 ? OUTLINE : EYE_GOLD);
    sp.dot(cx + 20, by, OUTLINE);
    return raw;
  }
  if (P.sit) {
    // Sitting back on his haunches, muzzle to the sky.
    sp.begin({ band: 1 });
    taper(sp, cx - 10, G - 3, cx - 22, G - 2, 5, 3, GJ_BODY);
    sp.begin({ band: 0 });
    limb(sp, cx + 2, G - 12, cx + 2, G - 1, 3.5, GJ_FAR);
    sp.begin({ band: 2 });
    disc(sp, cx - 6, G - 7, 8, 6.5, GJ_BODY);
    disc(sp, cx + 1, G - 15, 6.5, 8, GJ_BODY);
    sp.begin({ band: 1 });
    disc(sp, cx - 6, G - 12, 5, 2.4, GJ_SADDLE);
    sp.begin({ band: 1 });
    disc(sp, cx + 3, G - 20, 6.5, 6, GJ_MANE);
    sp.begin({ band: 1 });
    limb(sp, cx + 4, G - 12, cx + 5, G - 1, 4, GJ_BODY);
    sp.rect(cx + 4, G - 2, 4, 2, GJ_BODY);
    disc(sp, cx - 7, G - 3, 5, 3, GJ_BODY);
    gjHead(sp, cx + 4, G - 26, P.jaw, true);
    return raw;
  }
  const top = 21 + P.bob + P.lower;
  const st = P.stretch;
  // Bushy tail.
  sp.begin({ band: 1 });
  const tl = P.tail;
  taper(sp, cx - 17, top + 3, cx - 24, top + 1 - tl * 2, 6, 5, GJ_BODY);
  taper(sp, cx - 24, top + 1 - tl * 2, cx - 30, top + 5 - tl * 3, 5, 3, GJ_BODY);
  sp.begin({ flat: true, shadow: 'none' });
  sp.dot(cx - 30, top + 5 - tl * 3, GJ_BELLY[2]);
  sp.dot(cx - 29, top + 5 - tl * 3, GJ_BELLY[1]);
  // Far legs.
  sp.begin({ band: 0 });
  gjLeg(sp, cx + 7 + st, top + 9, 6, P.ff[0], P.ff[1], 4, 3, G, P.ff[2], GJ_FAR);
  gjLeg(sp, cx - 15, top + 8, 6, P.hf[0], P.hf[1], 5, 3, G, P.hf[2], GJ_FAR);
  // Body: hips, barrel, deep chest; the dark saddle; a paler fringe of belly fur below.
  sp.begin({ band: 0, noShadow: true });
  disc(sp, cx - 1 + st * 0.4, top + 9.5, 10, 2.2, GJ_MANE);
  sp.begin({ band: 2 });
  disc(sp, cx - 13, top + 5, 6.5, 6, GJ_BODY);
  disc(sp, cx - 3 + st * 0.4, top + 5, 12 + st * 0.4, 6, GJ_BODY);
  disc(sp, cx + 8 + st, top + 6, 7.5, 7.5, GJ_BODY);
  sp.begin({ band: 1 });
  disc(sp, cx - 5, top + 0.5, 10, 2.6, GJ_SADDLE);
  // Mane: a heavy ruff over the shoulders.
  sp.begin({ band: 1 });
  disc(sp, cx + 10 + st, top + 1, 7, 6.5, GJ_MANE);
  for (let k = 0; k < 4; k++) {
    poly(
      sp,
      [
        [cx + 4 + st + k * 3, top - 3 + k],
        [cx + 3 + st + k * 3, top + 8 + k * 0.5],
        [cx + 6 + st + k * 3, top + 6],
      ],
      GJ_MANE,
    );
  }
  // Near legs.
  sp.begin({ band: 1 });
  gjLeg(sp, cx + 10 + st, top + 9, 6, P.fn[0], P.fn[1], 5, 3.4, G, P.fn[2], GJ_BODY);
  sp.begin({ band: 1 });
  disc(sp, cx - 13, top + 7, 4.5, 4.5, GJ_BODY);
  gjLeg(sp, cx - 12, top + 9, 6, P.hn[0], P.hn[1], 5, 3.4, G, P.hn[2], GJ_BODY);
  gjHead(sp, cx + 17 + st + P.head[0], top - 2 + P.head[1], P.jaw, false);
  return raw;
}

// ---------------------------------------------------------------- the Mother of Slimes

const MOTHER = ['#a63a6a', '#e8689c', '#ffb8d4'];
const MOTHER_EDGE = ['#5e1a3a', '#8e2c58', '#b8467a'];
const MOTHER_CORE = ['#f08ab6', '#ffc4dc', '#fff0f6'];
const KID = ['#b04a7e', '#e88ab4', '#ffd0e4'];
const MOTHER_SIZE = { L: [22, 17], M: [18, 14], S: [14, 11] };

function paintMother(anim, f, variant) {
  const raw = new Sprite(64, 52);
  const sp = shifted(raw, 0, 0);
  const [RX, RY] = MOTHER_SIZE[variant] || MOTHER_SIZE.L;
  let rx = RX;
  let ry = RY;
  let lift = 0;
  let eyes = 'open';
  let melt = 0;
  switch (anim) {
    case 'idle':
      [rx, ry] = [
        [RX, RY],
        [RX + 1, RY - 0.6],
        [RX + 1.4, RY - 1],
        [RX + 0.6, RY - 0.4],
      ][f];
      break;
    case 'move':
      [rx, ry, lift] = [
        [RX + 3, RY - 4, 0],
        [RX - 3, RY + 3, 2],
        [RX - 2, RY + 2, 4],
        [RX + 2, RY - 2, 0],
      ][f];
      break;
    case 'telegraph':
      rx = RX + 2 + f;
      ry = RY + 2 + f;
      eyes = 'angry';
      break;
    case 'attack':
      rx = RX + 5;
      ry = RY - 5 + f * 2;
      eyes = 'angry';
      break;
    case 'hurt':
      rx = RX + 3;
      ry = RY - 3;
      eyes = 'x';
      break;
    case 'defeat':
      melt = f + 1;
      rx = RX + 2 + f * 3;
      ry = Math.max(3, RY - 4 - f * 4);
      eyes = f >= 2 ? 'none' : 'x';
      break;
    default:
      break;
  }
  const CX = 32;
  const base = 49 - lift;
  const cy = base - ry * 0.62;
  const inside = (x, y) => {
    const dx = (x + 0.5 - CX) / rx;
    return y + 0.5 < cy ? dx * dx + ((y + 0.5 - cy) / ry) ** 2 <= 1 : dx * dx + ((y + 0.5 - cy) / (ry * 0.62 + 0.5)) ** 4 <= 1;
  };
  // The great dome: translucent, a darker skin at its rim, flat where it sits.
  sp.begin({ alpha: 0.88, band: 2 });
  for (let y = Math.floor(cy - ry - 1); y < base; y++) {
    for (let x = Math.floor(CX - rx - 2); x <= Math.ceil(CX + rx + 2); x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 2, y) || !inside(x + 2, y) || !inside(x, y + 2);
      sp.set(x, y, edge ? MOTHER_EDGE : MOTHER);
    }
  }
  // A glowing heart, and little slimes floating inside her.
  sp.begin({ flat: true, alpha: 0.88, noOutline: true });
  disc(sp, CX - 1, cy + ry * 0.18, rx * 0.42, ry * 0.36, ['#f08ab6', '#f49cc2', '#f8b4d0'], 0);
  sp.begin({ flat: true, alpha: 0.92, noOutline: true });
  disc(sp, CX - 1, cy + ry * 0.15, rx * 0.22, ry * 0.2, MOTHER_CORE, 1);
  if (melt < 3) {
    const kids = variant === 'S' ? 2 : variant === 'M' ? 3 : 4;
    for (let k = 0; k < kids; k++) {
      const a = (k / kids) * Math.PI * 2 + f * 0.5;
      const kx = CX + Math.cos(a) * rx * 0.48;
      const ky = cy + ry * 0.12 + Math.sin(a) * ry * 0.3;
      sp.begin({ flat: true, alpha: 0.85 });
      disc(sp, kx, ky, 2.4, 1.9, KID, 1);
      sp.dot(Math.round(kx) - 1, Math.round(ky), '#3a0d26', 0.9);
      sp.dot(Math.round(kx) + 1, Math.round(ky), '#3a0d26', 0.9);
      sp.dot(Math.round(kx) - 1, Math.round(ky) - 1, '#ffffff', 0.8);
    }
  }
  // Glossy light: a curved streak on the upper left, a glint on the right.
  sp.begin({ flat: true, shadow: 'none' });
  for (let a = 3.5; a < 4.4; a += 0.08) {
    sp.dot(Math.round(CX + Math.cos(a) * rx * 0.72), Math.round(cy + Math.sin(a) * ry * 0.72), WHITE, 0.9);
    sp.dot(Math.round(CX + Math.cos(a) * rx * 0.62), Math.round(cy + Math.sin(a) * ry * 0.62), '#ffe0ec', 0.6);
  }
  sp.dot(Math.round(CX + rx * 0.6), Math.round(cy - ry * 0.3), WHITE, 0.8);
  sp.dot(Math.round(CX + rx * 0.66), Math.round(cy - ry * 0.18), '#ffe0ec', 0.7);
  // A crown of bubbles.
  if (!melt) {
    for (const [dx, dy, r] of [
      [-7, 0, 2.6],
      [0, -2, 3.2],
      [7, 0, 2.4],
    ]) {
      sp.begin({ alpha: 0.9, band: 0 });
      disc(sp, CX + dx * (rx / 22), cy - ry + dy + 1.5, r, r, MOTHER);
      sp.begin({ flat: true, shadow: 'none' });
      sp.dot(Math.round(CX + dx * (rx / 22) - r * 0.4), Math.round(cy - ry + dy + 1.5 - r * 0.4), WHITE, 0.95);
    }
  }
  // Face: big wet eyes and a small mouth.
  if (eyes !== 'none') {
    sp.begin({ flat: true, shadow: 'none' });
    const ey = Math.round(cy - ry * 0.12);
    const sx = rx / 22;
    const ex = [Math.round(CX - 1 + 3 * sx), Math.round(CX + 9 * sx + 2)];
    for (const x of ex) {
      if (eyes === 'x') {
        for (const [a, c] of [
          [-1, -1],
          [0, 0],
          [1, 1],
          [1, -1],
          [-1, 1],
        ])
          sp.dot(x + a, ey + c, OUTLINE);
        continue;
      }
      for (let j = -2; j <= 1; j++) for (let i = -1; i <= 1; i++) sp.dot(x + i, ey + j, OUTLINE);
      sp.dot(x - 1, ey - 2, WHITE);
      sp.dot(x, ey - 1, '#ffd0e4');
      if (eyes === 'angry') {
        sp.dot(x - 2, ey - 4, OUTLINE);
        sp.dot(x - 1, ey - 4, OUTLINE);
        sp.dot(x, ey - 3, OUTLINE);
        sp.dot(x + 1, ey - 3, OUTLINE);
      }
    }
    const my = ey + 4;
    const mx = Math.round((ex[0] + ex[1]) / 2);
    sp.dot(mx - 1, my, OUTLINE);
    sp.dot(mx, my + 1, OUTLINE);
    sp.dot(mx + 1, my, OUTLINE);
    if (anim === 'attack' || anim === 'telegraph') {
      sp.dot(mx, my + 1, '#3a0d16');
      sp.dot(mx - 1, my + 1, '#3a0d16');
      sp.dot(mx + 1, my + 1, '#3a0d16');
      sp.dot(mx, my + 2, '#3a0d16');
    }
  }
  if (melt) {
    sp.begin({ alpha: 0.75, flat: true });
    disc(sp, CX, base - 1, rx + 4 + melt * 2, 2.5, MOTHER, 1);
    sp.begin({ flat: true, shadow: 'none' });
    for (let k = 0; k < 6; k++) sp.dot(Math.round(CX - rx + k * (rx / 2.6)), base - 2, '#ffe0ec', 0.7);
  }
  return raw;
}

// ---------------------------------------------------------------- the Lake's Hum

// Facing you, arms out of the water: a figure of lake water with a pale face and a mouth
// held open on one long note. Symmetric, so it is never mirrored.
const HUM = ['#245a92', '#4ea2d8', '#b4e6fa'];
const HUM_DEEP = ['#163c6a', '#2a6ea8', '#6ab6e4'];
const HUM_FACE = ['#6aa8d0', '#bfe4f6', '#f2fbff'];
const HUM_HAIR = ['#1d4a80', '#3a86c4', '#8ccbe6'];

function humPose(anim, f) {
  // arms: angle of each arm from straight down (+ = outward), reach, h: how far it has risen
  const P = { h: 1, sway: 0, arm: 0.7, elbow: 0.5, reach: 12, mouth: 2, glow: 0, dissolve: 0, hairUp: 0 };
  switch (anim) {
    case 'rise':
      P.h = [0.25, 0.5, 0.78, 1][f];
      P.arm = 0.3;
      break;
    case 'sink':
      P.h = [1, 0.75, 0.48, 0.2][f];
      P.arm = 0.3;
      break;
    case 'idle':
    case 'move':
      P.sway = [0, 1, 0, -1][f];
      P.arm = 0.75 + 0.08 * [0, 1, 0, -1][f];
      P.mouth = f % 2 ? 3 : 2;
      break;
    case 'telegraph':
      P.arm = 2.6;
      P.elbow = 0.3;
      P.reach = 13;
      P.glow = 1;
      P.mouth = 3 + f;
      P.hairUp = 1 + f;
      break;
    case 'attack':
      P.arm = 1.25 + f * 0.15;
      P.elbow = -0.6;
      P.reach = 14;
      P.mouth = 4;
      P.hairUp = 1;
      break;
    case 'hurt':
      P.arm = 0.25;
      P.mouth = 1;
      P.sway = -1;
      break;
    case 'defeat':
      P.h = [0.95, 0.75, 0.5, 0.25][f];
      P.dissolve = f + 1;
      P.arm = 0.2;
      P.mouth = 3;
      break;
    default:
      break;
  }
  return P;
}

function paintHum(anim, f) {
  const raw = new Sprite(48, 64);
  const sp = shifted(raw, 0, 0);
  sp.rimRamps = new Set([HUM, HUM_HAIR]);
  const P = humPose(anim, f);
  const G = 60;
  const top = G - 42 * P.h;
  const cx = 24 + P.sway;
  // Foam where it meets the lake.
  sp.begin({ flat: true, alpha: 0.6 });
  disc(sp, 24, G - 1, 14 + P.dissolve * 2, 2.8, HUM_DEEP, 1);
  sp.begin({ flat: true, noOutline: true, shadow: 'none' });
  for (let x = -15; x <= 15; x += 2) sp.dot(24 + x + (f % 2), G - 2 + (x % 4 === 0 ? 1 : 0), '#e8faff', 0.75);
  // Hair of water streaming from the head down behind the shoulders.
  if (P.h > 0.35) {
    sp.begin({ alpha: 0.85, band: 1 });
    for (const s of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const x0 = cx + s * (2 + k);
        const y0 = top + 3;
        const x1 = cx + s * (7 + k * 1.5);
        const y1 = top + 15 + k * 2 - P.hairUp * 8;
        taper(sp, x0, y0, x1, y1, 3, 1.4, HUM_HAIR);
      }
    }
  }
  // The column: wide at the water, a waist, then shoulders.
  sp.begin({ alpha: 0.86, band: 2 });
  const waist = top + 20;
  for (let y = Math.floor(waist); y < G; y++) {
    const k = (y - waist) / Math.max(1, G - waist);
    const w = lerp(4.5, 11.5, k * k) + Math.sin(y * 0.8 + f) * 0.7;
    for (let x = Math.floor(cx - w); x <= Math.ceil(cx + w); x++) sp.set(x, y, HUM);
  }
  if (P.h > 0.35) {
    sp.begin({ alpha: 0.88, band: 2 });
    disc(sp, cx, top + 15, 7.5, 7, HUM);
    disc(sp, cx, top + 19, 5, 4, HUM);
    // A cold light at its heart.
    sp.begin({ flat: true, noOutline: true, shadow: 'none' });
    for (const [dx, dy, c] of [[0, -1, '#e8faff'], [-1, 0, '#bfe9ff'], [0, 0, '#ffffff'], [1, 0, '#bfe9ff'], [0, 1, '#bfe9ff']]) sp.dot(cx + dx, top + 15 + dy, c, P.glow ? 1 : 0.8);
    // Arms.
    for (const s of [-1, 1]) {
      const sx = cx + s * 6.5;
      const sy = top + 11;
      const a = P.arm;
      const ex = sx + s * Math.sin(a) * P.reach * 0.55;
      const ey = sy + Math.cos(a) * P.reach * 0.55;
      const a2 = a + P.elbow * (a > 1.6 ? -1 : 1) * 0.6;
      const hx = ex + s * Math.sin(a2) * P.reach * 0.5;
      const hy = ey + Math.cos(a2) * P.reach * 0.5;
      sp.begin({ alpha: 0.88, band: 1 });
      taper(sp, sx, sy, ex, ey, 4.4, 3.6, HUM);
      taper(sp, ex, ey, hx, hy, 3.6, 3, HUM);
      sp.begin({ flat: true, alpha: 0.9 });
      disc(sp, hx, hy, 2.4, 2.4, HUM_FACE, 1);
    }
    // Head: a pale face of still water, hollow eyes, the mouth on its long note.
    sp.begin({ band: 1, alpha: 0.95 });
    disc(sp, cx, top + 4, 5, 5.8, HUM_FACE);
    sp.begin({ flat: true, shadow: 'none' });
    const eyeC = P.glow ? '#ffffff' : '#163c6a';
    for (const s of [-1, 1]) {
      sp.dot(cx + s * 2 - (s > 0 ? 1 : 0), top + 3, eyeC);
      sp.dot(cx + s * 2 - (s > 0 ? 1 : 0) + s, top + 3, eyeC);
      sp.dot(cx + s * 2 - (s > 0 ? 1 : 0), top + 4, '#163c6a');
    }
    for (let m = 0; m < Math.min(4, P.mouth); m++) {
      sp.dot(cx - 1, top + 7 + Math.floor(m / 2), '#163c6a');
      if (m % 2) sp.dot(cx, top + 7 + Math.floor(m / 2), '#163c6a');
    }
    // A single white lily caught in its hair.
    sp.dot(cx + 4, top - 1, '#ffffff');
    sp.dot(cx + 5, top - 1, '#ffe0ec');
    sp.dot(cx + 4, top, '#f6a8c6');
    sp.dot(cx + 5, top, '#ffffff');
    if (P.glow) halo(sp, cx, top + 4, 11, '#9ad6f0', 0.5);
  } else {
    sp.begin({ band: 1 });
    disc(sp, cx, top + 7, 4.5, 4, HUM_FACE);
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(cx - 2, top + 6, '#163c6a');
    sp.dot(cx + 1, top + 6, '#163c6a');
  }
  // Light running down the water.
  sp.begin({ flat: true, shadow: 'none', noOutline: true });
  for (let y = Math.floor(top + 18); y < G - 3; y += 3) {
    sp.dot(Math.round(cx - 4 + Math.sin(y * 0.5 + f * 1.3) * 1.5), y, '#e8faff', 0.75);
    sp.dot(Math.round(cx + 3 + Math.cos(y * 0.4 + f) * 1.5), y + 1, '#b4e6fa', 0.6);
  }
  if (P.dissolve) {
    for (let k = 0; k < 10 * P.dissolve; k++) sp.dot(Math.round(cx + Math.sin(k * 2.3) * 13), Math.round(top + 4 + ((k * 7) % 40)), '#cfeeff', 0.85);
  }
  return raw;
}

// ---------------------------------------------------------------- the Bone Warden

function wardenPose(anim, f) {
  const P = { bob: 0, lean: 0, legs: [0, 0, 0, 0], sword: [31, 34], swAng: 1.3, swLen: 17, lamp: [33, 33], kneel: false, slump: 0, headDy: 0, glow: 0.6, pile: 0, smear: false, swordBehind: false };
  switch (anim) {
    case 'idle':
      P.bob = [0, 0, 1, 1][f];
      P.lamp = [34, 31 + [0, 1, 1, 0][f]];
      break;
    case 'move': {
      const t = (f / 6) * Math.PI * 2;
      P.bob = [0, 1, 0, 0, 1, 0][f];
      P.legs = [Math.round(3 * Math.sin(t)), Math.cos(t) > 0.3 ? 2 : 0, Math.round(-3 * Math.sin(t)), Math.cos(t) < -0.3 ? 2 : 0];
      P.lamp = [34 + Math.round(Math.cos(t)), 31];
      break;
    }
    case 'telegraph':
      P.lean = -2;
      P.sword = [20, 10];
      P.swAng = -2.3;
      P.swLen = 18;
      P.bob = f;
      P.swordBehind = true;
      P.glow = 0.8;
      P.lamp = [33, 32];
      break;
    case 'attack':
      P.lean = [2, 3, 2][f];
      P.sword = [
        [31, 14],
        [35, 26],
        [32, 33],
      ][f];
      P.swAng = [-0.9, 0.2, 1.2][f];
      P.smear = f === 1;
      P.legs = [-2, 0, 3, 0];
      P.lamp = [27, 33];
      break;
    case 'lantern':
      P.lamp = [36, 19 - f];
      P.glow = 1;
      P.sword = [20, 35];
      P.swAng = 1.9;
      break;
    case 'shield':
      P.kneel = true;
      P.bob = 7;
      P.sword = [31, 37];
      P.swAng = 1.57;
      P.swLen = 15;
      P.lamp = [35, 17 + f];
      P.glow = 1;
      break;
    case 'stagger':
      P.slump = 1;
      P.lean = -2;
      P.headDy = 3;
      P.bob = 2 + f;
      P.sword = [29, 42];
      P.swAng = 1.1;
      P.lamp = [31, 40];
      P.glow = 0.3;
      break;
    case 'hurt':
      P.lean = -3;
      P.headDy = -1;
      P.glow = 0.8;
      break;
    case 'defeat':
      P.pile = f + 1;
      P.glow = Math.max(0, 0.6 - f * 0.2);
      break;
    default:
      break;
  }
  return P;
}

function sword(sp, hx, hy, ang, len) {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  sp.begin({ band: 0 });
  limb(sp, hx - ux * 3 - uy * 3, hy - uy * 3 + ux * 3, hx - ux * 3 + uy * 3, hy - uy * 3 - ux * 3, 1.6, PLATE);
  sp.begin({ band: 1 });
  limb(sp, hx - ux * 2, hy - uy * 2, hx + ux * len, hy + uy * len, 2.6, IRON);
  sp.begin({ flat: true, shadow: 'none' });
  for (let t = 0; t < len; t += 1) sp.dot(Math.round(hx + ux * t - uy * 0.6), Math.round(hy + uy * t + ux * 0.6), '#dfe6f0', 0.8);
}

function lantern(sp, x, y, glowK) {
  sp.begin({ band: 0 });
  limb(sp, x, y - 9, x, y - 6, 1, PLATE);
  sp.rect(Math.round(x) - 3, Math.round(y) - 6, 7, 1, PLATE);
  sp.begin({ band: 1 });
  sp.rect(Math.round(x) - 2, Math.round(y) - 5, 5, 6, PLATE);
  sp.rect(Math.round(x) - 3, Math.round(y) + 1, 7, 1, PLATE);
  sp.begin({ flat: true, shadow: 'none' });
  for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) sp.dot(Math.round(x) - 1 + i, Math.round(y) - 4 + j, j === 1 && i === 1 ? '#ffffff' : GRAVE[glowK > 0.5 ? 2 : 1]);
  if (glowK > 0.05) halo(sp, x, y - 2, 7 + glowK * 6, '#7fb2ff', 0.35 + 0.35 * glowK);
}

function paintWarden(anim, f) {
  const raw = new Sprite(48, 60);
  const sp = shifted(raw, 0, 4);
  sp.rimRamps = new Set([CLOAK]);
  const P = wardenPose(anim, f);
  const G = 52;
  if (P.pile) {
    // Folding down into a heap of bones and plate; the lantern rolls away and dims.
    const k = P.pile;
    sp.begin({ band: 1 });
    disc(sp, 24, G - 3 + Math.min(k, 3), 12 + k, 4 + (4 - k) * 2, CLOAK);
    sp.begin({ band: 1 });
    for (let i = 0; i < 5 + k; i++) limb(sp, 14 + i * 3, G - 4 - ((i * 5) % 4), 17 + i * 3, G - 2 - ((i * 3) % 3), 2, BONE);
    sp.begin({ band: 1 });
    disc(sp, 20 + k * 2, G - 6 + k, 5, 3.5, PLATE);
    sp.begin({ band: 1 });
    disc(sp, 30 - k, G - 9 + k * 2, 4, 3.6, BONE);
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(31 - k, G - 9 + k * 2, OUTLINE);
    sp.dot(29 - k, G - 9 + k * 2, OUTLINE);
    sword(sp, 10, G - 2, -0.05, 18);
    lantern(sp, 38 + k * 2, G - 1, P.glow);
    return raw;
  }
  const b = P.bob;
  const L = P.lean;
  const hip = [23 + L * 0.3, 36 + b];
  // Tattered cloak behind.
  sp.begin({ band: 1 });
  poly(
    sp,
    [
      [17 + L, 21 + b],
      [27 + L, 21 + b],
      [26 + L * 0.5, G - 7],
      [24, G - 3],
      [22, G - 7],
      [19, G - 2],
      [17, G - 6],
      [13 + L * 0.3, G - 4],
    ],
    CLOAK,
  );
  if (P.swordBehind) sword(sp, P.sword[0] + L, P.sword[1] + b, P.swAng, P.swLen);
  // Legs: bone under battered greaves.
  if (P.kneel) {
    sp.begin({ band: 0 });
    limb(sp, hip[0] - 1, hip[1], 15, G - 1, 3, BONE_DARK);
    sp.begin({ band: 1 });
    limb(sp, hip[0] + 2, hip[1], 30, hip[1] + 1, 3.5, BONE);
    limb(sp, 30, hip[1] + 1, 30, G - 1, 4, PLATE);
  } else {
    const [fd, fl, nd, nl] = P.legs;
    sp.begin({ band: 0 });
    limb(sp, hip[0] - 2, hip[1], 20 + fd * 0.6, G - 9, 2.4, BONE_DARK);
    limb(sp, 20 + fd * 0.6, G - 9, 20 + fd, G - 1 - fl, 4, darkerRamp(PLATE));
    sp.begin({ band: 1 });
    limb(sp, hip[0] + 2, hip[1], 26 + nd * 0.6, G - 9, 2.6, BONE);
    sp.begin({ band: 1 });
    limb(sp, 26 + nd * 0.6, G - 9, 26 + nd, G - 1 - nl, 4.4, PLATE);
  }
  // Ribs behind a broken breastplate; a bone pelvis; a far arm of bone.
  const tx = 23 + L * 0.7;
  const ty = 28 + b + P.slump;
  sp.begin({ band: 1 });
  disc(sp, tx, ty + 7, 4.5, 2.4, BONE);
  sp.begin({ band: 0 });
  limb(sp, 19 + L, 23 + b, lerp(19 + L, P.lamp[0], 0.5), lerp(23 + b, P.lamp[1] - 8 + b, 0.5) + 3, 2.2, BONE_DARK);
  sp.begin({ band: 2 });
  disc(sp, tx, ty, 6.6, 7.2, PLATE);
  // The plate is split down the front: ribs show through.
  sp.begin({ flat: true, shadow: 'none' });
  for (let k = 0; k < 4; k++) {
    sp.dot(Math.round(tx + 1), Math.round(ty - 4 + k * 2), '#1a1423');
    sp.dot(Math.round(tx + 2), Math.round(ty - 4 + k * 2), BONE[2]);
    sp.dot(Math.round(tx + 3), Math.round(ty - 4 + k * 2), BONE[1]);
    sp.dot(Math.round(tx + 2), Math.round(ty - 3 + k * 2), '#1a1423');
  }
  sp.dot(Math.round(tx - 3), Math.round(ty - 3), '#4f8a7e');
  sp.dot(Math.round(tx - 2), Math.round(ty + 2), '#4f8a7e');
  // Pauldrons.
  sp.begin({ band: 1 });
  disc(sp, tx - 5, ty - 6, 4, 3, PLATE);
  disc(sp, tx + 5, ty - 6, 4.4, 3.2, PLATE);
  // A skull in a dented helm, a gravelight slit, a bone jaw beneath.
  const hx = 25 + L;
  const hy = 15 + b + P.headDy;
  sp.begin({ band: 1 });
  disc(sp, hx + 1, hy + 4, 3.4, 2.4, BONE);
  sp.begin({ band: 1 });
  disc(sp, hx, hy, 5, 5.2, PLATE);
  sp.rect(hx - 5, hy - 1, 10, 3, PLATE);
  sp.begin({ band: 0 });
  poly(
    sp,
    [
      [hx - 4, hy - 4],
      [hx - 10, hy - 10],
      [hx - 3, hy - 6],
    ],
    BONE,
  );
  sp.begin({ flat: true, shadow: 'none' });
  for (let i = 0; i < 5; i++) sp.dot(hx + i, hy, i >= 1 ? GRAVE[P.glow > 0.7 ? 2 : 1] : OUTLINE);
  for (let i = 0; i < 3; i++) sp.dot(hx + 1 + i, hy + 5, i % 2 ? BONE[0] : BONE[2]);
  sp.dot(hx - 1, hy - 3, '#8590a8');
  if (P.glow > 0.7) halo(sp, hx + 4, hy, 5, '#7fb2ff', 0.5);
  // The lantern, held out in front, then the sword arm.
  lantern(sp, P.lamp[0] + (anim === 'shield' || anim === 'lantern' ? 0 : L), P.lamp[1] + b, P.glow);
  if (anim === 'lantern' || anim === 'shield') {
    // The lantern arm is raised: draw its forearm over the body.
    sp.begin({ band: 1 });
    limb(sp, 28 + L, 24 + b, P.lamp[0], P.lamp[1] - 8 + b, 2.2, BONE);
  }
  const shN = [28 + L, 23 + b];
  const sx = P.sword[0] + L;
  const sy = P.sword[1] + b;
  if (anim !== 'lantern' && anim !== 'shield') {
    const el = [lerp(shN[0], sx, 0.5) + 1, lerp(shN[1], sy, 0.5)];
    sp.begin({ band: 1 });
    limb(sp, shN[0], shN[1], el[0], el[1], 2.4, BONE);
    limb(sp, el[0], el[1], sx, sy, 2.4, BONE);
    sp.begin({ band: 1 });
    disc(sp, el[0], el[1], 2, 2, PLATE);
  }
  if (!P.swordBehind) sword(sp, anim === 'lantern' || anim === 'shield' ? P.sword[0] : sx, anim === 'lantern' || anim === 'shield' ? P.sword[1] + b : sy, P.swAng, P.swLen);
  if (P.smear) {
    sp.begin({ flat: true, noOutline: true, shadow: 'none' });
    for (let a = -0.9; a < 0.3; a += 0.05) {
      for (let r = 14; r < 21; r++) sp.dot(Math.round(sx + Math.cos(a) * r), Math.round(sy + Math.sin(a) * r), '#cfe0ff', 0.4);
    }
  }
  return raw;
}

// ---------------------------------------------------------------- registry

const PAINTERS = {
  varek: paintVarek,
  greyjaw: paintGreyjaw,
  mother_of_slimes: paintMother,
  lakes_hum: paintHum,
  bone_warden: paintWarden,
};

export function paintBossFrame(id, anim, frame, variant = null) {
  const fn = PAINTERS[id];
  if (!fn) return null;
  return fn(anim, frame, variant);
}

function toCanvas(rgba, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  return c;
}

export function registerBossArt(atlas) {
  if (!atlas || typeof document === 'undefined') return;
  for (const [id, art] of Object.entries(BOSS_ART)) {
    const anims = {};
    for (const variant of art.variants) {
      for (const [anim, [frames, fps, loop]] of Object.entries(art.anims)) {
        const list = [];
        for (let f = 0; f < frames; f++) {
          try {
            const sp = paintBossFrame(id, anim, f, variant);
            list.push(toCanvas(sp.render(), sp.w, sp.h));
          } catch (err) {
            console.error('[bosses] art failed', id, anim, f, err);
          }
        }
        if (!list.length) continue;
        const name = variant ? `boss:${id}:${anim}:${variant}` : `boss:${id}:${anim}`;
        atlas.add(name, list, { ox: art.ox, oy: art.oy, fps });
        anims[anim] = { frames, fps, loop, duration: frames / fps };
      }
    }
    // Varek's fire is a variant; the Mother's three sizes are her only looks.
    atlas.setMeta(`boss:${id}`, { anims, variants: art.variants });
  }
  // Varek speaks in his intro: give the story a face for him (the chief's own look).
  try {
    const look = PRESET_APPEARANCES.bandit_chief;
    if (look) ensureCharacter(atlas, 'varek', { ...look, key: 'varek', skin: 'tan', outfit: 'tunic', top: 'rust', accent: 'wine' });
  } catch (err) {
    console.error('[bosses] portrait failed', err);
  }
  registerGlyphArt(atlas);
}

export function bossAnimInfo(atlas, id, anim) {
  const meta = atlas?.getMeta?.(`boss:${id}`);
  if (meta) return meta.anims[anim] || null;
  const a = BOSS_ART[id]?.anims?.[anim];
  return a ? { frames: a[0], fps: a[1], loop: a[2], duration: a[0] / a[1] } : null;
}

const nameCache = new Map();

function spriteName(atlas, id, anim, variant) {
  const key = `${id}|${anim}|${variant || ''}`;
  let n = nameCache.get(key);
  if (n !== undefined && atlas.has(n)) return n;
  const meta = atlas.getMeta?.(`boss:${id}`);
  const a = meta?.anims?.[anim] ? anim : 'idle';
  const v = variant ? `boss:${id}:${a}:${variant}` : null;
  n = v && atlas.has(v) ? v : `boss:${id}:${a}`;
  if (!atlas.has(n)) {
    const first = meta?.variants?.[0];
    n = first ? `boss:${id}:${a}:${first}` : n;
  }
  nameCache.set(key, n);
  return n;
}

export function drawBossSprite(ctx, atlas, id, anim, t, x, y, opts = {}) {
  if (!atlas || !ctx) return false;
  try {
    const name = spriteName(atlas, id, anim, opts.variant);
    const s = atlas.get(name);
    if (!s) return false;
    const info = bossAnimInfo(atlas, id, anim) || bossAnimInfo(atlas, id, 'idle');
    const n = s.frames.length;
    let i = Math.floor((t || 0) * (info?.fps || 4));
    i = info && !info.loop ? Math.min(i, n - 1) : ((i % n) + n) % n;
    const flip = !!opts.flip && !BOSS_ART[id]?.noFlip;
    return atlas.draw(ctx, name, i, x, y, { flip, flash: opts.flash || 0, alpha: opts.alpha ?? 1 });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- glyphs

// Each glyph is a few strokes on a 16x16 grid: Lanternwright script as the Weave reads it.
const GLYPHS = {
  fire: [
    [
      [8, 1],
      [11, 5],
      [13, 9],
      [12, 12],
      [9, 14],
      [6, 14],
      [3, 12],
      [3, 9],
      [5, 6],
      [6, 9],
      [8, 1],
    ],
    [
      [8, 8],
      [10, 11],
      [8, 13],
      [6, 11],
      [8, 8],
    ],
  ],
  wind: [
    [
      [3, 6],
      [11, 6],
      [13, 4],
      [11, 2],
      [9, 3],
    ],
    [
      [2, 10],
      [12, 10],
      [14, 12],
      [12, 14],
      [10, 13],
    ],
    [
      [4, 8],
      [9, 8],
    ],
  ],
  poison: [
    [
      [8, 2],
      [12, 8],
      [12, 11],
      [10, 13],
      [6, 13],
      [4, 11],
      [4, 8],
      [8, 2],
    ],
    [
      [7, 9],
      [9, 9],
    ],
    [
      [8, 8],
      [8, 10],
    ],
  ],
  water: [
    [
      [2, 6],
      [4, 4],
      [6, 6],
      [8, 4],
      [10, 6],
      [12, 4],
      [14, 6],
    ],
    [
      [2, 11],
      [4, 9],
      [6, 11],
      [8, 9],
      [10, 11],
      [12, 9],
      [14, 11],
    ],
  ],
  dark: [
    [
      [10, 2],
      [6, 3],
      [4, 6],
      [4, 10],
      [6, 13],
      [10, 14],
      [8, 11],
      [7, 8],
      [8, 5],
      [10, 2],
    ],
    [
      [12, 7],
      [12, 9],
    ],
  ],
  volley: [
    [
      [3, 3],
      [8, 6],
      [13, 3],
    ],
    [
      [3, 7],
      [8, 10],
      [13, 7],
    ],
    [
      [3, 11],
      [8, 14],
      [13, 11],
    ],
  ],
  swift: [
    [
      [2, 8],
      [14, 8],
    ],
    [
      [10, 4],
      [14, 8],
      [10, 12],
    ],
    [
      [3, 4],
      [7, 4],
    ],
    [
      [3, 12],
      [7, 12],
    ],
  ],
  split: [
    [
      [8, 14],
      [8, 8],
    ],
    [
      [8, 8],
      [3, 2],
    ],
    [
      [8, 8],
      [13, 2],
    ],
    [
      [8, 8],
      [8, 2],
    ],
  ],
  bounce: [
    [
      [1, 4],
      [5, 12],
      [9, 4],
      [13, 12],
      [15, 8],
    ],
    [
      [3, 14],
      [13, 14],
    ],
  ],
  chain: [
    [
      [2, 6],
      [6, 4],
      [9, 6],
      [8, 9],
      [4, 10],
      [2, 6],
    ],
    [
      [8, 7],
      [11, 6],
      [14, 9],
      [12, 12],
      [8, 11],
      [7, 9],
    ],
  ],
  _: [
    [
      [8, 2],
      [14, 8],
      [8, 14],
      [2, 8],
      [8, 2],
    ],
    [
      [8, 6],
      [8, 10],
    ],
  ],
};

const bitmapCache = new Map();

export function glyphBitmap(kind, id) {
  const key = GLYPHS[id] ? id : '_';
  let bm = bitmapCache.get(key);
  if (bm) return bm;
  bm = new Uint8Array(16 * 16);
  for (const line of GLYPHS[key]) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [x0, y0] = line[i];
      const [x1, y1] = line[i + 1];
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
      for (let k = 0; k <= n; k++) {
        const x = Math.round(lerp(x0, x1, k / n));
        const y = Math.round(lerp(y0, y1, k / n));
        if (x >= 0 && y >= 0 && x < 16 && y < 16) bm[y * 16 + x] = 1;
      }
    }
  }
  bitmapCache.set(key, bm);
  void kind;
  return bm;
}

const glyphCanvasCache = new Map();

// The glyph as a canvas: dark outline, colored body, bright core. `scale` is an integer.
export function glyphCanvas(kind, id, pal, scale = 1) {
  if (typeof document === 'undefined') return null;
  const key = `${kind}|${id}|${pal.core}|${pal.glow}|${scale}`;
  let c = glyphCanvasCache.get(key);
  if (c) return c;
  const bm = glyphBitmap(kind, id);
  const S = 20;
  c = document.createElement('canvas');
  c.width = S * scale;
  c.height = S * scale;
  const ctx = c.getContext('2d');
  const at = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && bm[y * 16 + x] === 1;
  const px = (x, y, col) => {
    ctx.fillStyle = col;
    ctx.fillRect((x + 2) * scale, (y + 2) * scale, scale, scale);
  };
  // Outline first, then the strokes, then the bright core where strokes are thick.
  for (let y = -1; y <= 16; y++) {
    for (let x = -1; x <= 16; x++) {
      if (at(x, y)) continue;
      if (at(x + 1, y) || at(x - 1, y) || at(x, y + 1) || at(x, y - 1)) px(x, y, pal.deep || OUTLINE);
    }
  }
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (!at(x, y)) continue;
      const lit = !at(x - 1, y - 1);
      px(x, y, lit ? pal.core : pal.glow);
    }
  }
  glyphCanvasCache.set(key, c);
  return c;
}

function registerGlyphArt(atlas) {
  void atlas; // glyph canvases are made on demand per palette (see glyphCanvas)
}

// A floating glyph in the world: a soft halo and the rune turning on its axis.
export function drawGlyph(ctx, atlas, kind, id, x, y, opts = {}) {
  const pal = opts.pal || { core: '#fff4c0', glow: '#e4b83d', deep: '#7d5a1c', spark: '#ffffff' };
  const time = opts.time || 0;
  const r = 9 + Math.sin(time * 3) * 1;
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = pal.glow;
  ctx.beginPath();
  ctx.arc(x, y - 8, r + 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.arc(x, y - 8, r - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  const c = glyphCanvas(kind, id, pal, 1);
  if (!c) return;
  const k = Math.max(0.18, Math.abs(Math.cos(opts.spin || 0)));
  const w = Math.max(2, Math.round(c.width * k));
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, Math.round(x - w / 2), Math.round(y - 8 - c.height / 2), w, c.height);
  void atlas;
}
