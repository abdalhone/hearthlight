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

import { Sprite, glow, rampFrom, tri, mixHex, lighten, darken } from './characters_paint.js';
import { RAMPS, OUTLINE } from './palette.js';

const A = (frames, fps, loop = true) => [frames, fps, loop];

export const BOSS_ART = {
  varek: {
    w: 48,
    h: 48,
    ox: 24,
    oy: 45,
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
    w: 64,
    h: 48,
    ox: 32,
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
    h: 56,
    ox: 24,
    oy: 52,
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

const SKIN_TAN = ['#8f5a3c', '#c48460', '#e2ad84'];
const LEATHER = ['#2e1c14', '#553522', '#7d5236'];
const RUST = ['#4a1a12', '#7a2c1c', '#a8452a'];
const FUR = ['#3a3430', '#635a50', '#958a7c'];
const BEARD = ['#24160f', '#43291c', '#6b4430'];
const IRON = tri(RAMPS.iron, 0);
const WOOD = tri(RAMPS.wood, 0);
const EMBER = ['#c4501f', '#ffb047', '#ffe08a'];
const BONE = tri(RAMPS.bone, 0);
const BONE_DARK = ['#3d3630', '#6e6455', '#9c917a'];
const RUST_IRON = ['#2a2328', '#4a3f45', '#76686c'];
const CLOAK = ['#141220', '#24203a', '#3a3456'];
const GRAVE = ['#2c4a8a', '#7fb2ff', '#e0f0ff'];
const EYE_GOLD = '#ffd75e';
const WHITE = '#fff8ee';

function lerp(a, b, t) {
  return a + (b - a) * t;
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
  const pts = [
    [hx2 - ux * 7 + px * 1, hy2 - uy * 7 + py * 1],
    [hx2 - ux * 9 + px * 7, hy2 - uy * 9 + py * 7],
    [hx2 + ux * 2 + px * 8, hy2 + uy * 2 + py * 8],
    [hx2 + ux * 1 + px * 1, hy2 + uy * 1 + py * 1],
  ];
  poly(sp, pts, head);
  // The edge catches the light (or the fire).
  sp.begin({ flat: true, noOutline: false, shadow: 'none' });
  for (let t = -8; t <= 1; t++) {
    const k = (t + 8) / 9;
    const ex = hx2 + ux * t + px * (7 + k);
    const ey = hy2 + uy * t + py * (7 + k);
    sp.dot(Math.round(ex), Math.round(ey), fire ? '#fff4c0' : '#e8ecf4', 0.95);
  }
  if (fire) {
    glow(sp, hx2 + px * 4, hy2 + py * 4, 9, '#ff9a4a', 0.55);
  }
}

function varekPose(anim, f) {
  const P = { bob: 0, lean: 0, legs: [0, 0, 0, 0], hand: [31, 26], ang: -2.05, len: 21, behind: false, free: [18, 30], headDy: 0, mouth: false, kneel: 0, dropAxe: false, side: 1, smear: false };
  switch (anim) {
    case 'idle':
      P.bob = [0, 0, 1, 1][f];
      P.free = [18, 30 + P.bob];
      break;
    case 'move': {
      const t = (f / 6) * Math.PI * 2;
      P.bob = [0, 1, 0, 0, 1, 0][f];
      P.legs = [Math.round(3 * Math.sin(t)), Math.cos(t) > 0.3 ? 2 : 0, Math.round(-3 * Math.sin(t)), Math.cos(t) < -0.3 ? 2 : 0];
      P.hand = [33, 29];
      P.ang = 0.45;
      P.len = 19;
      P.free = [19 + Math.round(2 * Math.cos(t)), 30];
      break;
    }
    case 'telegraph':
      P.lean = -2;
      P.bob = f;
      P.hand = [19, 10];
      P.ang = -2.65;
      P.len = 20;
      P.behind = true;
      P.free = [31, 24];
      P.side = -1;
      break;
    case 'attack':
      P.lean = [2, 3, 2][f];
      P.hand = [
        [32, 14],
        [36, 25],
        [33, 32],
      ][f];
      P.ang = [-0.95, 0.15, 1.15][f];
      P.len = 20;
      P.free = [27, 28];
      P.smear = f === 1;
      P.legs = [-2, 0, 3, 0];
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
      break;
    case 'raise':
      P.bob = -f;
      P.hand = [26, 7];
      P.ang = -1.72;
      P.len = 20;
      P.free = [23, 8];
      P.legs = [-2, 0, 2, 0];
      P.side = 1;
      break;
    case 'slam':
      P.bob = 3;
      P.lean = 3;
      P.hand = [34, 32];
      P.ang = 0.95;
      P.len = 17;
      P.free = [31, 31];
      P.legs = [-3, 0, 4, 0];
      break;
    case 'call':
      P.free = [22 + f, 4 + f];
      P.mouth = true;
      P.headDy = -1;
      P.hand = [32, 30];
      P.ang = 0.6;
      P.len = 19;
      break;
    case 'hurt':
      P.lean = -3;
      P.headDy = -1;
      P.hand = [29, 31];
      P.ang = 1.35;
      P.len = 19;
      P.free = [17, 27];
      break;
    case 'defeat':
      if (f === 0) {
        P.lean = -3;
        P.headDy = -1;
        P.hand = [29, 32];
        P.ang = 1.4;
        P.len = 19;
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

function paintVarek(anim, f, variant) {
  const sp = new Sprite(48, 48);
  sp.rimRamps = new Set([FUR, BEARD]);
  const fire = variant === 'fire';
  const P = varekPose(anim, f);
  const b = P.bob;
  const L = P.lean;
  const G = 45;
  const hip = [23 + L * 0.3, 32 + b];
  const shN = [28 + L, 20 + b];
  const shF = [19 + L, 20 + b];
  // A dropped axe lies in the dirt in front of him.
  if (P.dropAxe) axe(sp, 22, 44, 0.05, 20, false, -1);
  // Far arm (behind the body).
  sp.begin({ band: 0 });
  limb(sp, shF[0], shF[1], lerp(shF[0], P.free[0], 0.5) - 1, lerp(shF[1], P.free[1], 0.5) + 1, 4, darkerRamp(RUST));
  limb(sp, lerp(shF[0], P.free[0], 0.5) - 1, lerp(shF[1], P.free[1], 0.5) + 1, P.free[0], P.free[1], 4, darkerRamp(SKIN_TAN));
  if (P.behind && !P.dropAxe) axe(sp, P.hand[0] + L, P.hand[1] + b, P.ang, P.len, fire, P.side);
  // Legs.
  if (P.kneel === 2) {
    sp.begin({ band: 0 });
    limb(sp, hip[0] - 1, hip[1], 16, G - 1, 5, darkerRamp(LEATHER));
    limb(sp, 16, G - 1, 11, G, 4, darkerRamp(LEATHER));
    sp.begin({ band: 1 });
    limb(sp, hip[0] + 2, hip[1], 29, hip[1] + 1, 5, LEATHER);
    limb(sp, 29, hip[1] + 1, 30, G - 1, 5, LEATHER);
    limb(sp, 29, G - 1, 33, G - 1, 3, BEARD);
  } else {
    const [fd, fl, nd, nl] = P.legs;
    const kneeDip = P.kneel ? 3 : 0;
    sp.begin({ band: 0 });
    limb(sp, hip[0] - 2, hip[1], 20 + fd * 0.5, 39 + kneeDip, 5, darkerRamp(LEATHER));
    limb(sp, 20 + fd * 0.5, 39 + kneeDip, 20 + fd, G - 1 - fl, 5, darkerRamp(LEATHER));
    sp.begin({ band: 1 });
    sp.rect(Math.round(18 + fd), G - 2 - fl, 6, 3, darkerRamp(BEARD));
    sp.begin({ band: 1 });
    limb(sp, hip[0] + 2, hip[1], 26 + nd * 0.5, 39 + kneeDip, 5, LEATHER);
    limb(sp, 26 + nd * 0.5, 39 + kneeDip, 26 + nd, G - 1 - nl, 5, LEATHER);
    sp.begin({ band: 1 });
    sp.rect(Math.round(24 + nd), G - 2 - nl, 7, 3, BEARD);
  }
  // Torso: a leather jerkin over a rust shirt, a broad belt.
  sp.begin({ band: 2 });
  const tx = 23.5 + L * 0.7;
  const ty = 25.5 + b;
  disc(sp, tx, ty, 8, 8.5, LEATHER);
  sp.rect(Math.round(tx - 7), Math.round(ty), 14, 7, LEATHER);
  sp.begin({ flat: false, band: 1 });
  for (let k = 0; k < 9; k++) {
    sp.set(Math.round(tx + 4 - k * 0.9), Math.round(ty - 6 + k * 1.2), RUST);
    sp.set(Math.round(tx + 5 - k * 0.9), Math.round(ty - 6 + k * 1.2), RUST);
  }
  sp.begin({ flat: true, shadow: 'none' });
  sp.rect(Math.round(tx - 7), Math.round(ty + 4), 15, 2, [OUTLINE, '#2a1a14', '#3b2418'], 1);
  sp.dot(Math.round(tx + 3), Math.round(ty + 4), '#e4b83d');
  sp.dot(Math.round(tx + 3), Math.round(ty + 5), '#b58726');
  // Fur mantle on the shoulders.
  sp.begin({ band: 1 });
  disc(sp, 23.5 + L, 19 + b, 9, 3.6, FUR);
  sp.begin({ flat: true, shadow: 'none' });
  for (let k = 0; k < 6; k++) sp.dot(Math.round(16 + L + k * 3), Math.round(21 + b + (k % 2)), FUR[0]);
  // Head: shaved sides, a dark topknot, a beard, the patch over the eye.
  const hx = 26 + L;
  const hy = 11 + b + P.headDy;
  sp.begin({ band: 1 });
  disc(sp, hx, hy, 4.6, 5, SKIN_TAN);
  sp.begin({ band: 1 });
  disc(sp, hx - 1.5, hy - 3.2, 3.6, 2.2, BEARD);
  limb(sp, hx - 4, hy - 3, hx - 7, hy + 1, 2, BEARD);
  sp.begin({ band: 1 });
  poly(
    sp,
    [
      [hx - 1, hy + 1],
      [hx + 5, hy + 1],
      [hx + 4, hy + 7],
      [hx + 1, hy + 8],
      [hx - 2, hy + 5],
    ],
    BEARD,
  );
  sp.begin({ flat: true, shadow: 'none' });
  // nose and the one good eye (facing us he would have one; from the side, the patch)
  sp.dot(hx + 5, hy, SKIN_TAN[1]);
  sp.dot(hx + 2, hy - 2, OUTLINE);
  sp.dot(hx + 3, hy - 1, OUTLINE);
  sp.dot(hx + 4, hy - 1, '#1a1423');
  sp.dot(hx + 3, hy - 2, '#2a2228');
  sp.dot(hx, hy - 3, '#2a2228');
  sp.dot(hx - 1, hy - 4, '#2a2228');
  sp.dot(hx + 1, hy - 3, '#2a2228');
  if (P.mouth) {
    sp.dot(hx + 3, hy + 3, '#3a0d16');
    sp.dot(hx + 4, hy + 3, '#3a0d16');
    sp.dot(hx + 3, hy + 4, '#6b1424');
  }
  // Near arm and the axe in front.
  const el = [lerp(shN[0], P.hand[0] + L, 0.5) + 1, lerp(shN[1], P.hand[1] + b, 0.5) + 1];
  sp.begin({ band: 1 });
  limb(sp, shN[0], shN[1], el[0], el[1], 4.6, RUST);
  limb(sp, el[0], el[1], P.hand[0] + L, P.hand[1] + b, 4.2, SKIN_TAN);
  sp.begin({ band: 1 });
  limb(sp, lerp(el[0], P.hand[0] + L, 0.4), lerp(el[1], P.hand[1] + b, 0.4), lerp(el[0], P.hand[0] + L, 0.75), lerp(el[1], P.hand[1] + b, 0.75), 4.6, LEATHER);
  if (!P.behind && !P.dropAxe) axe(sp, P.hand[0] + L, P.hand[1] + b, P.ang, P.len, fire, P.side);
  if (P.smear) {
    sp.begin({ flat: true, noOutline: true, shadow: 'none' });
    for (let a = -0.9; a < 0.2; a += 0.06) {
      for (let r = 17; r < 26; r++) {
        const x = P.hand[0] + L + Math.cos(a) * r;
        const y = P.hand[1] + b + Math.sin(a) * r;
        sp.dot(Math.round(x), Math.round(y), fire ? '#ffd08a' : '#e8ecf4', 0.35 * (1 - Math.abs(a + 0.35) / 0.6));
      }
    }
  }
  return sp;
}

function darkerRamp(r) {
  return [darken(r[0], 0.25), darken(r[1], 0.25), darken(r[2], 0.3)];
}

// ---------------------------------------------------------------- Greyjaw

const GJ_BODY = ['#2e2c3a', '#555366', '#878599'];
const GJ_SADDLE = ['#18171f', '#2b2936', '#424052'];
const GJ_BELLY = ['#6b6a7c', '#9c9aae', '#cfcedd'];
const GJ_FAR = darkerRamp(GJ_BODY);

function greyjawPose(anim, f) {
  const P = { bob: 0, lunge: 0, lower: 0, rear: 0, head: [0, 0], jaw: 0, legs: [0, 0, 0, 0, 0, 0, 0, 0], tail: 0, sit: false, lie: 0, howl: false, stretch: 0 };
  switch (anim) {
    case 'idle':
      P.bob = [0, 0, 1, 1][f];
      P.tail = [0, 1, 1, 0][f];
      break;
    case 'move': {
      const t = (f / 6) * Math.PI * 2;
      P.bob = [0, 1, 2, 0, 1, 2][f];
      const a = Math.round(4 * Math.sin(t));
      const la = Math.cos(t) > 0.2 ? 2 : 0;
      const lb = Math.cos(t) < -0.2 ? 2 : 0;
      P.legs = [a, la, -a, lb, -a, lb, a, la];
      P.tail = -1;
      P.stretch = Math.round(2 * Math.sin(t));
      break;
    }
    case 'crouch':
      P.lower = 4;
      P.rear = -1;
      P.head = [1, 3];
      P.tail = -2;
      P.jaw = f ? 1 : 0;
      P.legs = [-2, 0, -2, 0, 2, 0, 2, 0];
      break;
    case 'attack':
      P.lunge = f ? 3 : 5;
      P.bob = f ? 1 : -3;
      P.stretch = f ? 2 : 4;
      P.legs = [6, 2, 5, 3, -6, 3, -5, 2];
      P.jaw = 3;
      P.tail = -1;
      P.head = [2, f ? 0 : -1];
      break;
    case 'howl':
      P.sit = true;
      P.howl = true;
      P.jaw = f ? 3 : 2;
      break;
    case 'hurt':
      P.lunge = -2;
      P.head = [-1, -2];
      P.jaw = 1;
      break;
    case 'defeat':
      P.lie = f + 1;
      break;
    default:
      break;
  }
  return P;
}

function paintGreyjaw(anim, f) {
  const sp = new Sprite(64, 48);
  sp.rimRamps = new Set([GJ_BODY, GJ_SADDLE]);
  const P = greyjawPose(anim, f);
  const G = 44;
  const cx = 30 + P.lunge;
  if (P.lie) {
    // On his side, legs out, then still.
    const k = P.lie;
    const by = G - 6 + Math.min(2, k - 1);
    sp.begin({ band: 1 });
    limb(sp, cx - 14, by, cx - 22, by - 3 + k, 4, GJ_BODY);
    sp.begin({ band: 0 });
    limb(sp, cx - 6, by + 2, cx - 1, G, 3, GJ_FAR);
    limb(sp, cx + 8, by + 2, cx + 13, G, 3, GJ_FAR);
    sp.begin({ band: 2 });
    disc(sp, cx - 1, by - 1, 15, 6.5 - (k - 1) * 0.8, GJ_BODY);
    sp.begin({ band: 1 });
    disc(sp, cx - 3, by - 4, 10, 2.5, GJ_SADDLE);
    sp.begin({ band: 1 });
    disc(sp, cx + 15, by + 1, 5.5, 4.5, GJ_BODY);
    limb(sp, cx + 18, by + 3, cx + 24, by + 4, 4, GJ_BODY);
    sp.begin({ band: 0 });
    limb(sp, cx - 4, by + 4, cx + 2, G, 3, GJ_BODY);
    limb(sp, cx + 6, by + 4, cx + 12, G, 3, GJ_BODY);
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(cx + 17, by - 1, k >= 3 ? OUTLINE : EYE_GOLD);
    sp.dot(cx + 18, by - 1, OUTLINE);
    return sp;
  }
  const top = 22 + P.bob + P.lower;
  // Tail.
  sp.begin({ band: 1 });
  const tl = P.tail;
  limb(sp, cx - 16, top + 3, cx - 23, top + 1 - tl * 2, 4.5, GJ_BODY);
  limb(sp, cx - 23, top + 1 - tl * 2, cx - 28, top + 4 - tl * 3, 3.5, GJ_BODY);
  sp.begin({ flat: true, shadow: 'none' });
  sp.dot(cx - 28, top + 4 - tl * 3, GJ_BELLY[2]);
  // Far legs.
  const L = P.legs;
  if (P.sit) {
    sp.begin({ band: 0 });
    limb(sp, cx + 6, top + 6, cx + 8, G, 3.5, GJ_FAR);
  } else {
    sp.begin({ band: 0 });
    limb(sp, cx + 8 + P.stretch, top + 6, cx + 9 + L[2] + P.stretch, G - L[3], 3.5, GJ_FAR);
    limb(sp, cx - 10, top + 6 + P.rear, cx - 11 + L[6], G - L[7], 4, GJ_FAR);
  }
  // Body: a long barrel, the dark saddle down the back, the pale belly.
  sp.begin({ band: 2 });
  if (P.sit) {
    disc(sp, cx - 4, top + 10, 9, 8, GJ_BODY);
    disc(sp, cx + 3, top + 3, 6, 9, GJ_BODY);
  } else {
    disc(sp, cx - 3 + P.stretch * 0.3, top + 4, 15 + P.stretch * 0.5, 6.4, GJ_BODY);
    disc(sp, cx + 8 + P.stretch, top + 3, 6.5, 7, GJ_BODY);
  }
  sp.begin({ band: 1 });
  if (!P.sit) disc(sp, cx - 4 + P.stretch * 0.3, top - 1, 12, 2.6, GJ_SADDLE);
  else disc(sp, cx, top + 1, 5, 4, GJ_SADDLE);
  sp.begin({ flat: false, band: 0, noShadow: true });
  if (!P.sit) for (let d = -12; d <= 8; d++) sp.set(cx + d + Math.round(P.stretch * 0.3), top + 9, GJ_BELLY, d % 3 === 0 ? 1 : 2);
  // Ruff of fur at the neck.
  sp.begin({ band: 1 });
  if (!P.sit) {
    for (let k = 0; k < 5; k++) limb(sp, cx + 6 + P.stretch + k, top - 2 + k, cx + 3 + P.stretch + k, top + 1 + k, 2, GJ_BODY);
  }
  // Near legs.
  if (P.sit) {
    sp.begin({ band: 1 });
    limb(sp, cx + 4, top + 7, cx + 4, G, 4, GJ_BODY);
    disc(sp, cx - 6, G - 3, 6, 3, GJ_BODY);
    limb(sp, cx - 2, G - 1, cx + 2, G, 3, GJ_BODY);
  } else {
    sp.begin({ band: 1 });
    limb(sp, cx + 10 + P.stretch, top + 6, cx + 10 + L[0] + P.stretch, G - L[1], 4, GJ_BODY);
    limb(sp, cx - 8, top + 7 + P.rear, cx - 7 + L[4], G - 4 - L[5], 5, GJ_BODY);
    limb(sp, cx - 7 + L[4], G - 4 - L[5], cx - 9 + L[4], G - L[5], 3.5, GJ_BODY);
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(cx + 11 + L[0] + P.stretch, G - L[1], GJ_SADDLE[0]);
    sp.dot(cx - 8 + L[4], G - L[5], GJ_SADDLE[0]);
  }
  // Head: long muzzle, tall ears, a scar across the eye, gold eyes.
  let hx;
  let hy;
  if (P.howl) {
    hx = cx + 6;
    hy = top - 9;
  } else if (P.sit) {
    hx = cx + 8;
    hy = top - 5;
  } else {
    hx = cx + 14 + P.stretch + P.head[0];
    hy = top - 4 + P.head[1];
  }
  sp.begin({ band: 1 });
  disc(sp, hx, hy + 2, 5, 4.5, GJ_BODY);
  if (P.howl) {
    // Muzzle to the sky.
    limb(sp, hx + 2, hy - 1, hx + 6, hy - 7, 4, GJ_BODY);
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(hx + 7, hy - 8, OUTLINE);
    for (let k = 0; k < P.jaw; k++) sp.dot(hx + 6 - k, hy - 4 + k, '#3a0d16');
  } else {
    sp.begin({ band: 1 });
    sp.rect(hx + 3, hy + 1, 7, 3, GJ_BODY);
    if (P.jaw) sp.rect(hx + 3, hy + 4 + P.jaw, 6, 2, GJ_BODY);
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(hx + 10, hy + 1, OUTLINE);
    if (P.jaw) {
      for (let k = 0; k < 5; k++) sp.dot(hx + 4 + k, hy + 4, k % 2 ? WHITE : '#6b1424');
      for (let j = 0; j < P.jaw; j++) for (let k = 0; k < 5; k++) sp.dot(hx + 4 + k, hy + 4 + j, j === 0 && k % 2 ? WHITE : '#3a0d16');
    }
  }
  // Ears.
  sp.begin({ band: 0 });
  poly(
    sp,
    [
      [hx - 3, hy - 1],
      [hx - 2, hy - 7],
      [hx + 1, hy - 1],
    ],
    GJ_BODY,
  );
  poly(
    sp,
    [
      [hx, hy - 1],
      [hx + 2, hy - 6],
      [hx + 3, hy - 1],
    ],
    GJ_BODY,
  );
  sp.begin({ flat: true, shadow: 'none' });
  sp.dot(hx + 2, hy + 1, EYE_GOLD);
  sp.dot(hx + 3, hy + 1, OUTLINE);
  sp.dot(hx + 1, hy - 1, '#c9c6cf');
  sp.dot(hx + 2, hy, '#c9c6cf');
  sp.dot(hx + 4, hy + 2, '#c9c6cf');
  sp.dot(hx - 2, hy + 4, GJ_BELLY[2]);
  sp.dot(hx - 1, hy + 5, GJ_BELLY[2]);
  return sp;
}

// ---------------------------------------------------------------- the Mother of Slimes

const MOTHER = ['#6a2242', '#c0577e', '#f6a8c6'];
const MOTHER_CORE = ['#4a1430', '#8a3058', '#c0577e'];
const MOTHER_SIZE = { L: [22, 17], M: [18, 14], S: [14, 11] };

function paintMother(anim, f, variant) {
  const sp = new Sprite(64, 52);
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
      ][f].map((v, i) => (i ? v : v));
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
  // The great dome: translucent, flat where it sits.
  sp.begin({ alpha: 0.82, band: 2 });
  for (let y = Math.floor(cy - ry - 1); y < base; y++) {
    for (let x = Math.floor(CX - rx - 2); x <= Math.ceil(CX + rx + 2); x++) {
      const dx = (x + 0.5 - CX) / rx;
      const inside = y + 0.5 < cy ? dx * dx + ((y + 0.5 - cy) / ry) ** 2 <= 1 : dx * dx + ((y + 0.5 - cy) / (ry * 0.62 + 0.5)) ** 4 <= 1;
      if (inside) sp.set(x, y, MOTHER);
    }
  }
  // A darker heart, and the shapes of little slimes floating inside her.
  sp.begin({ flat: true, alpha: 0.8 });
  disc(sp, CX + 1, cy + ry * 0.22, rx * 0.55, ry * 0.42, MOTHER_CORE, 1);
  if (!melt || melt < 3) {
    sp.begin({ flat: true, alpha: 0.75 });
    const kids = variant === 'S' ? 2 : variant === 'M' ? 3 : 4;
    for (let k = 0; k < kids; k++) {
      const a = (k / kids) * Math.PI * 2 + f * 0.4;
      const kx = CX + Math.cos(a) * rx * 0.4;
      const ky = cy + ry * 0.15 + Math.sin(a) * ry * 0.25;
      disc(sp, kx, ky, 2.2, 1.7, ['#f09ab8', '#f6b8d0', '#ffe0ec'], 1);
      sp.dot(Math.round(kx), Math.round(ky), '#4a1430', 0.8);
    }
  }
  // Glossy light on the dome.
  sp.begin({ flat: true, shadow: 'none' });
  const hx = Math.round(CX - rx * 0.55);
  const hy = Math.round(cy - ry * 0.55);
  sp.dot(hx, hy, WHITE, 0.95);
  sp.dot(hx + 1, hy - 1, WHITE, 0.9);
  sp.dot(hx + 2, hy - 1, WHITE, 0.7);
  sp.dot(hx - 1, hy + 1, WHITE, 0.7);
  sp.dot(hx, hy + 2, WHITE, 0.5);
  sp.dot(hx + 3, hy - 2, '#ffe0ec', 0.7);
  sp.dot(Math.round(CX + rx * 0.55), Math.round(cy + ry * 0.1), '#ffe0ec', 0.6);
  // A crown of bubbles on top.
  if (!melt) {
    sp.begin({ alpha: 0.85, band: 0 });
    for (const [dx, dy, r] of [
      [-6, -1, 2.4],
      [0, -2, 3],
      [6, -1, 2.2],
    ])
      disc(sp, CX + dx * (rx / 22), cy - ry + dy + 1, r, r, MOTHER);
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(CX - 1, Math.round(cy - ry - 2), WHITE, 0.9);
  }
  // Face.
  if (eyes !== 'none') {
    sp.begin({ flat: true, shadow: 'none' });
    const ey = Math.round(cy - ry * 0.12);
    const ex = [Math.round(CX + rx * 0.05), Math.round(CX + rx * 0.45)];
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
      } else {
        sp.dot(x, ey - 1, eyes === 'angry' ? OUTLINE : WHITE);
        sp.dot(x, ey, OUTLINE);
        sp.dot(x, ey + 1, OUTLINE);
        sp.dot(x + 1, ey, OUTLINE);
        sp.dot(x + 1, ey + 1, OUTLINE);
        sp.dot(x, ey - 1 + (eyes === 'angry' ? 0 : 0), eyes === 'angry' ? OUTLINE : WHITE);
        if (eyes === 'angry') {
          sp.dot(x - 1, ey - 3, OUTLINE);
          sp.dot(x, ey - 2, OUTLINE);
          sp.dot(x + 1, ey - 2, OUTLINE);
        }
      }
    }
    const my = ey + 4;
    const mx = Math.round(CX + rx * 0.25);
    sp.dot(mx, my, OUTLINE);
    sp.dot(mx + 1, my, OUTLINE);
    if (anim === 'attack' || anim === 'telegraph') {
      sp.dot(mx, my + 1, '#3a0d16');
      sp.dot(mx + 1, my + 1, '#3a0d16');
    }
  }
  // Melting: drips and a spreading puddle.
  if (melt) {
    sp.begin({ alpha: 0.7, flat: true });
    disc(sp, CX, base - 1, rx + 4 + melt * 2, 2.5, MOTHER, 1);
    sp.begin({ flat: true, shadow: 'none' });
    for (let k = 0; k < 5; k++) sp.dot(CX - rx + k * (rx / 2.5), base - 2, '#ffe0ec', 0.6);
  }
  return sp;
}

// ---------------------------------------------------------------- the Lake's Hum

const HUM = ['#1d3a63', '#3a86bd', '#9ad6f0'];
const HUM_DEEP = ['#10213f', '#1d3a63', '#2f74ad'];
const HUM_MASK = ['#7aa6c8', '#cfe6f4', '#f4fbff'];

function humPose(anim, f) {
  // h: how far it has risen (0..1); arms: [farAngle, nearAngle] (radians from the shoulder, down = π/2)
  const P = { h: 1, sway: 0, arms: [2.2, 1.0], reach: 11, mouth: 1, glow: 0, dissolve: 0, lean: 0 };
  switch (anim) {
    case 'rise':
      P.h = [0.25, 0.5, 0.78, 1][f];
      P.arms = [2.6, 1.6];
      break;
    case 'sink':
      P.h = [1, 0.75, 0.48, 0.2][f];
      P.arms = [2.6, 1.6];
      break;
    case 'idle':
    case 'move':
      P.sway = [0, 1, 0, -1][f];
      P.arms = [2.25 + 0.1 * Math.sin(f), 1.0 - 0.1 * Math.sin(f)];
      P.mouth = f % 2 ? 2 : 1;
      break;
    case 'telegraph':
      P.arms = [-2.4, -0.7];
      P.reach = 12;
      P.glow = 1;
      P.mouth = 2 + f;
      P.sway = f ? 1 : 0;
      break;
    case 'attack':
      P.arms = [0.2, f ? 0.35 : 0.1];
      P.reach = 13;
      P.lean = 3;
      P.mouth = 3;
      break;
    case 'hurt':
      P.lean = -3;
      P.arms = [2.7, 2.4];
      P.mouth = 0;
      break;
    case 'defeat':
      P.h = [0.95, 0.75, 0.5, 0.25][f];
      P.dissolve = f + 1;
      P.arms = [2.8, 2.8];
      P.mouth = 2;
      break;
    default:
      break;
  }
  return P;
}

function paintHum(anim, f) {
  const sp = new Sprite(48, 64);
  sp.rimRamps = new Set([HUM]);
  const P = humPose(anim, f);
  const G = 60;
  const fullH = 40;
  const top = G - fullH * P.h;
  const cx = 24 + P.sway + P.lean * 0.5;
  // Water rings where it meets the lake.
  sp.begin({ flat: true, alpha: 0.55 });
  disc(sp, 24, G - 1, 13 + P.dissolve * 2, 2.6, HUM, 2);
  sp.begin({ flat: true, alpha: 0.75, noOutline: true });
  for (let x = -14; x <= 14; x++) if (Math.abs(x) > 9) sp.dot(24 + x, G - 1 + (Math.abs(x) % 3 === 0 ? 0 : -1) * 0, '#cfeeff', 0.5);
  // The column: wide at the water, narrowing to a waist, swelling to shoulders.
  sp.begin({ alpha: 0.82, band: 2 });
  for (let y = Math.floor(top + 12); y < G; y++) {
    const k = (y - (top + 12)) / Math.max(1, G - (top + 12));
    const w = lerp(5.5, 11, k * k) + Math.sin(y * 0.7 + f) * 0.8;
    const sx = cx + (G - y) * 0.03 * P.sway;
    for (let x = Math.floor(sx - w); x <= Math.ceil(sx + w); x++) sp.set(x, y, HUM);
  }
  if (P.h > 0.35) {
    // Shoulders and chest.
    sp.begin({ alpha: 0.85, band: 2 });
    disc(sp, cx, top + 15, 9.5, 6, HUM);
    // Far arm behind.
    sp.begin({ alpha: 0.75, band: 1 });
    const fa = P.arms[0];
    limb(sp, cx - 6, top + 13, cx - 6 + Math.cos(fa) * P.reach, top + 13 + Math.sin(fa) * P.reach, 3.6, HUM_DEEP);
    // Head: a pale mask with hollow eyes and a humming mouth; hair of water falling back.
    sp.begin({ alpha: 0.8, band: 1 });
    for (let k = 0; k < 7; k++) limb(sp, cx - 2 - k, top + 2 + k * 0.5, cx - 6 - k * 1.2, top + 10 + k * 1.5, 2.6, HUM);
    sp.begin({ band: 1 });
    disc(sp, cx + 1, top + 5, 5, 5.6, HUM_MASK);
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(cx + 2, top + 4, '#14233f');
    sp.dot(cx + 2, top + 5, '#14233f');
    sp.dot(cx + 4, top + 4, '#14233f');
    sp.dot(cx + 4, top + 5, '#14233f');
    if (P.glow) {
      sp.dot(cx + 2, top + 4, '#e8faff');
      sp.dot(cx + 4, top + 4, '#e8faff');
    }
    for (let m = 0; m < P.mouth; m++) {
      sp.dot(cx + 3, top + 8 + m, '#14233f');
      if (m > 0) sp.dot(cx + 4, top + 8 + m, '#14233f');
    }
    // A crown of reeds and a lily.
    sp.begin({ band: 0 });
    for (const [dx, h] of [
      [-3, 6],
      [-1, 8],
      [1, 7],
    ])
      limb(sp, cx + dx, top + 1, cx + dx - 1, top + 1 - h * P.h, 1.4, ['#2c5236', '#43744a', '#6fa34c']);
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(cx + 3, top, '#f6a8c6');
    sp.dot(cx + 4, top, '#ffe0ec');
    sp.dot(cx + 3, top - 1, '#f6a8c6');
    // Near arm.
    sp.begin({ alpha: 0.85, band: 1 });
    const na = P.arms[1];
    const ex = cx + 7 + Math.cos(na) * P.reach;
    const ey = top + 13 + Math.sin(na) * P.reach;
    limb(sp, cx + 6, top + 13, ex, ey, 4, HUM);
    sp.begin({ flat: true, alpha: 0.9 });
    disc(sp, ex, ey, 2.6, 2.6, HUM, 2);
  } else {
    // Just rising: a swell with a pale face breaking the surface.
    sp.begin({ band: 1 });
    disc(sp, cx + 1, top + 7, 4.5, 4, HUM_MASK);
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(cx + 2, top + 6, '#14233f');
    sp.dot(cx + 4, top + 6, '#14233f');
  }
  // Light running down the water.
  sp.begin({ flat: true, shadow: 'none', noOutline: true });
  for (let y = Math.floor(top + 14); y < G - 2; y += 3) sp.dot(Math.round(cx - 3 + Math.sin(y * 0.5 + f * 1.3) * 2), y, '#e8faff', 0.7);
  if (P.glow) glow(sp, cx + 3, top + 6, 10, '#9ad6f0', 0.5);
  if (P.dissolve) {
    sp.begin({ flat: true, noOutline: true, shadow: 'none' });
    for (let k = 0; k < 10 * P.dissolve; k++) {
      const x = Math.round(cx + Math.sin(k * 2.3) * 12);
      const y = Math.round(top + 6 + ((k * 7) % 40));
      sp.dot(x, y, '#cfeeff', 0.8);
    }
  }
  return sp;
}

// ---------------------------------------------------------------- the Bone Warden

function wardenPose(anim, f) {
  const P = { bob: 0, lean: 0, legs: [0, 0, 0, 0], sword: [31, 34], swAng: 1.35, swLen: 17, lantern: [16, 35], lampUp: false, kneel: false, slump: 0, headDy: 0, glow: 0.6, pile: 0, smear: false, swordBehind: false };
  switch (anim) {
    case 'idle':
      P.bob = [0, 0, 1, 1][f];
      P.lantern = [16, 35 + [0, 1, 1, 0][f]];
      break;
    case 'move': {
      const t = (f / 6) * Math.PI * 2;
      P.bob = [0, 1, 0, 0, 1, 0][f];
      P.legs = [Math.round(3 * Math.sin(t)), Math.cos(t) > 0.3 ? 2 : 0, Math.round(-3 * Math.sin(t)), Math.cos(t) < -0.3 ? 2 : 0];
      P.lantern = [16 + Math.round(Math.cos(t)), 35];
      break;
    }
    case 'telegraph':
      P.lean = -2;
      P.sword = [22, 12];
      P.swAng = -2.3;
      P.swLen = 18;
      P.bob = f;
      P.swordBehind = true;
      P.glow = 0.8;
      break;
    case 'attack':
      P.lean = [2, 3, 2][f];
      P.sword = [
        [31, 16],
        [35, 28],
        [32, 34],
      ][f];
      P.swAng = [-0.9, 0.2, 1.2][f];
      P.smear = f === 1;
      P.legs = [-2, 0, 3, 0];
      break;
    case 'lantern':
      P.lampUp = true;
      P.lantern = [33, 22 - f];
      P.glow = 1;
      P.sword = [18, 36];
      P.swAng = 1.9;
      break;
    case 'shield':
      P.kneel = true;
      P.bob = 7;
      P.sword = [31, 38];
      P.swAng = 1.57;
      P.swLen = 15;
      P.lantern = [25, 18 + f];
      P.lampUp = true;
      P.glow = 1;
      break;
    case 'stagger':
      P.slump = 1;
      P.lean = -2;
      P.headDy = 3;
      P.bob = 2 + f;
      P.sword = [29, 44];
      P.swAng = 1.1;
      P.lantern = [18, 41];
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
  limb(sp, hx - ux * 3 - uy * 3, hy - uy * 3 + ux * 3, hx - ux * 3 + uy * 3, hy - uy * 3 - ux * 3, 1.6, RUST_IRON);
  sp.begin({ band: 1 });
  limb(sp, hx - ux * 2, hy - uy * 2, hx + ux * len, hy + uy * len, 2.6, IRON);
  sp.begin({ flat: true, shadow: 'none' });
  for (let t = 0; t < len; t += 1) sp.dot(Math.round(hx + ux * t - uy * 0.6), Math.round(hy + uy * t + ux * 0.6), '#dfe6f0', 0.8);
}

function lantern(sp, x, y, glowK) {
  sp.begin({ band: 0 });
  sp.rect(Math.round(x) - 2, Math.round(y) - 6, 5, 1, RUST_IRON);
  limb(sp, x, y - 9, x, y - 6, 1, RUST_IRON);
  sp.begin({ band: 1 });
  sp.rect(Math.round(x) - 2, Math.round(y) - 5, 5, 6, RUST_IRON);
  sp.begin({ flat: true, shadow: 'none' });
  for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) sp.dot(Math.round(x) - 1 + i, Math.round(y) - 4 + j, j === 1 && i === 1 ? '#ffffff' : GRAVE[glowK > 0.5 ? 2 : 1]);
  if (glowK > 0.05) glow(sp, x, y - 2, 6 + glowK * 6, '#7fb2ff', 0.35 + 0.35 * glowK);
}

function paintWarden(anim, f) {
  const sp = new Sprite(48, 56);
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
    disc(sp, 20 + k * 2, G - 6 + k, 5, 3.5, RUST_IRON);
    sp.begin({ band: 1 });
    disc(sp, 30 - k, G - 9 + k * 2, 4, 3.6, BONE);
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(31 - k, G - 9 + k * 2, OUTLINE);
    sword(sp, 10, G - 2, -0.05, 18);
    lantern(sp, 38 + k * 2, G - 1, P.glow);
    return sp;
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
      [26 + L * 0.5, G - 6 + (P.kneel ? 0 : 0)],
      [23, G - 3],
      [21, G - 6],
      [18, G - 3],
      [14 + L * 0.3, G - 7],
    ],
    CLOAK,
  );
  // Far arm (the lantern hand), behind the body unless raised.
  const shF = [19 + L, 23 + b];
  if (!P.lampUp) {
    sp.begin({ band: 0 });
    limb(sp, shF[0], shF[1], P.lantern[0] + 1, P.lantern[1] - 9 + b, 2, BONE_DARK);
    lantern(sp, P.lantern[0], P.lantern[1] + b, P.glow);
  }
  if (P.swordBehind) sword(sp, P.sword[0] + L, P.sword[1] + b, P.swAng, P.swLen);
  // Legs: bone shins under plate greaves.
  if (P.kneel) {
    sp.begin({ band: 0 });
    limb(sp, hip[0] - 1, hip[1], 15, G - 1, 3, BONE_DARK);
    sp.begin({ band: 1 });
    limb(sp, hip[0] + 2, hip[1], 30, hip[1] + 1, 3.5, BONE);
    limb(sp, 30, hip[1] + 1, 30, G - 1, 3.5, RUST_IRON);
  } else {
    const [fd, fl, nd, nl] = P.legs;
    sp.begin({ band: 0 });
    limb(sp, hip[0] - 2, hip[1], 20 + fd, G - 1 - fl, 3, BONE_DARK);
    sp.begin({ band: 0 });
    limb(sp, 20 + fd * 0.6, G - 9, 20 + fd, G - 1 - fl, 4, darkerRamp(RUST_IRON));
    sp.begin({ band: 1 });
    limb(sp, hip[0] + 2, hip[1], 26 + nd, G - 1 - nl, 3, BONE);
    sp.begin({ band: 1 });
    limb(sp, 26 + nd * 0.6, G - 9, 26 + nd, G - 1 - nl, 4, RUST_IRON);
  }
  // Ribs under a cracked breastplate; a pelvis of bone.
  const tx = 23 + L * 0.7;
  const ty = 28 + b + P.slump;
  sp.begin({ band: 1 });
  disc(sp, tx, ty + 7, 4.5, 2.5, BONE);
  sp.begin({ band: 2 });
  disc(sp, tx, ty, 7, 7.5, RUST_IRON);
  sp.begin({ flat: true, shadow: 'none' });
  for (let k = 0; k < 3; k++) {
    sp.dot(Math.round(tx - 4 + k), Math.round(ty - 3 + k * 2), OUTLINE);
    sp.dot(Math.round(tx - 3 + k), Math.round(ty - 3 + k * 2), BONE[1]);
  }
  sp.dot(Math.round(tx + 2), Math.round(ty - 1), '#9aa0ad');
  // Pauldrons.
  sp.begin({ band: 1 });
  disc(sp, tx - 5, ty - 6, 4, 3, RUST_IRON);
  disc(sp, tx + 5, ty - 6, 4.4, 3.2, RUST_IRON);
  // Skull in a dented helm with a glowing slit.
  const hx = 25 + L;
  const hy = 15 + b + P.headDy;
  sp.begin({ band: 1 });
  disc(sp, hx, hy, 5, 5.6, RUST_IRON);
  sp.rect(hx - 5, hy - 1, 10, 3, RUST_IRON);
  sp.begin({ band: 0 });
  poly(
    sp,
    [
      [hx - 4, hy - 4],
      [hx - 9, hy - 9],
      [hx - 3, hy - 6],
    ],
    BONE,
  );
  sp.begin({ flat: true, shadow: 'none' });
  for (let i = 0; i < 5; i++) sp.dot(hx + i, hy, i >= 2 ? GRAVE[P.glow > 0.7 ? 2 : 1] : OUTLINE);
  sp.dot(hx + 3, hy + 3, BONE[2]);
  sp.dot(hx + 4, hy + 3, BONE[1]);
  sp.dot(hx + 2, hy + 4, BONE[1]);
  if (P.glow > 0.7) glow(sp, hx + 4, hy, 4, '#7fb2ff', 0.5);
  // Near arm with the sword (or the raised lantern).
  const shN = [28 + L, 23 + b];
  if (P.lampUp) {
    sp.begin({ band: 1 });
    limb(sp, shN[0], shN[1], P.lantern[0], P.lantern[1] - 8 + b, 2.2, BONE);
    lantern(sp, P.lantern[0], P.lantern[1] + b, P.glow);
    sp.begin({ band: 0 });
    limb(sp, shF[0], shF[1], P.sword[0] - 2, P.sword[1] - 3 + b, 2, BONE_DARK);
    if (!P.swordBehind) sword(sp, P.sword[0], P.sword[1] + b, P.swAng, P.swLen);
  } else {
    sp.begin({ band: 1 });
    const el = [lerp(shN[0], P.sword[0] + L, 0.5) + 1, lerp(shN[1], P.sword[1] + b, 0.5)];
    limb(sp, shN[0], shN[1], el[0], el[1], 2.2, BONE);
    limb(sp, el[0], el[1], P.sword[0] + L, P.sword[1] + b, 2.2, BONE);
    sp.begin({ band: 1 });
    disc(sp, el[0], el[1], 2, 2, RUST_IRON);
    if (!P.swordBehind) sword(sp, P.sword[0] + L, P.sword[1] + b, P.swAng, P.swLen);
  }
  if (P.smear) {
    sp.begin({ flat: true, noOutline: true, shadow: 'none' });
    for (let a = -0.9; a < 0.3; a += 0.06) {
      for (let r = 14; r < 20; r++) sp.dot(Math.round(P.sword[0] + L + Math.cos(a) * r), Math.round(P.sword[1] + b + Math.sin(a) * r), '#cfe0ff', 0.35);
    }
  }
  return sp;
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
    return atlas.draw(ctx, name, i, x, y, { flip: !!opts.flip, flash: opts.flash || 0, alpha: opts.alpha ?? 1 });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- glyphs

// Each glyph is a few strokes on a 16x16 grid: Lanternwright script as the Weave reads it.
const GLYPHS = {
  fire: [
    [
      [8, 14],
      [8, 4],
    ],
    [
      [8, 9],
      [4, 6],
      [5, 2],
    ],
    [
      [8, 8],
      [12, 5],
      [11, 2],
    ],
    [
      [4, 14],
      [12, 14],
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
  void mixHex;
  void lighten;
  void rampFrom;
}
