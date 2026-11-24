import { buf, finish, groundShadow, tone, dtone, foliage, box, cylinder, disc, planks, PAL, OUT, rgb, mixc, shade, ih, lut } from './props_kit.js';

// Props for the places of round 3 (LORE §10): lindens and Wenna's hives, the chandlery's
// dipping-vat and candle racks, Sabeth's dye-vats, Nan Pike's loom, Corran's net racks,
// washing lines, and the lanterns that hang by the Ambrels' and the Wayhouse doors.
// Same style as the rest of the props (DESIGN §18): lit from the upper left, smooth
// ramps, a dark outline, a soft ground shadow.

const COPPER = lut(['#3a1a10', '#5e2c18', '#874022', '#ad5a2e', '#cf7a40', '#eba264', '#ffd09a']);
const WAX = lut(['#7a5a1c', '#a8802a', '#d0a63e', '#e8c45a', '#f6dc84', '#fff0bc']);
const BRICK = lut(['#2a1614', '#45231e', '#64332a', '#83463a', '#a05c4c', '#bc7a66']);
const LINDEN = lut(['#14301a', '#1d4224', '#2a5a2e', '#3c7438', '#548e40', '#70a84a', '#92c058', '#b8d870', '#dcec98']);
const STRAW = PAL.straw;
const ROPE = lut(['#4a3a28', '#6e5a40', '#93805e', '#b8a47e', '#d8c8a0']);
const FLOAT = lut(['#7a4a1a', '#c47a2a', '#f0b050']);
const NET = lut(['#3a3a2e', '#55554a', '#727264', '#94947e', '#b8b8a0']);
const DYES = {
  violet: lut(['#1e0e2e', '#34184e', '#4e2474', '#6a3498', '#8a4cba', '#ae74d8', '#d0a6f0']),
  teal: lut(['#082224', '#0e3a3c', '#145456', '#1c7272', '#2a9290', '#4cb4ae', '#86d6ce']),
  madder: lut(['#2e0c10', '#4e141a', '#721e26', '#962c32', '#b84040', '#d6625a', '#f09486']),
};
const CLOTH = [
  lut(['#5a5a6a', '#8a8a9c', '#b4b4c4', '#dcdce6', '#f4f4f8']),
  lut(['#4a2a1a', '#7a4a2a', '#a8703e', '#d09a5a', '#eec486']),
  lut(['#1a2a4a', '#2a4472', '#3e64a0', '#6a8cc4', '#a0bce0']),
  lut(['#4a1a22', '#7a2a36', '#a8404e', '#d06a72', '#eea4a6']),
];

// ---------------------------------------------------------------------------
// Lindens: a softer, rounder crown than the oaks, a paler green, and in summer a
// dusting of pale yellow flowers that the bees are after.

function trunk(b, cx, base, top, w) {
  for (let y = top; y <= base; y++) {
    const v = (y - top) / (base - top);
    const flare = Math.max(0, (v - 0.82) / 0.18) ** 2 * 2.5;
    const half = w / 2 + flare;
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half - 1); x++) {
      const u = (x + 0.5 - cx) / half;
      if (u < -1 || u > 1) continue;
      let t = 0.58 - u * 0.34 - Math.abs(u) ** 3 * 0.15;
      if (ih(x * 5, y >> 2, 901) > 0.8) t -= 0.14;
      b.set(x, y, dtone(PAL.bark, t, x, y, 0.06));
    }
  }
}

function linden(v, rng) {
  const W = 44;
  const Hh = 62;
  const tb = buf(W, Hh);
  const cb = buf(W, Hh);
  const cx = 22;
  const base = 59;
  const rx = [17, 15, 18][v];
  const ry = [19, 18, 17][v];
  const cy = [25, 24, 27][v];
  trunk(tb, cx, base, cy + 6, 6);
  finish(tb);
  foliage(cb, cx, cy, rx, ry, LINDEN, rng, { clusters: 30, clusterR: [3, 6], lo: 0.16, hi: 0.95 });
  // Shade the lower crown; scatter the flowers on the lit side.
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!(cb.data[i] >>> 24)) continue;
      const k = (y - cy) / ry;
      if (k > 0.35) cb.data[i] = shade(cb.data[i], 1 - (k - 0.35) * 0.3);
      const lit = (cx - x) / rx + (cy - y) / ry;
      if (ih(x, y, 902 + v) > 0.93 - Math.max(0, lit) * 0.04) cb.data[i] = tone(WAX, 0.7 + ih(x, y, 903) * 0.3);
    }
  }
  finish(cb);
  return { trunk: tb, canopy: cb };
}

// ---------------------------------------------------------------------------
// The chandlery

function dippingVat(f) {
  const b = buf(32, 22);
  // Brick firebox.
  for (let y = 9; y < 22; y++) {
    for (let x = 1; x < 31; x++) {
      const course = Math.floor((y - 9) / 3);
      const off = course % 2 ? 3 : 0;
      let t = 0.5 + (ih((x + off) >> 2, course, 911) - 0.5) * 0.2;
      if ((y - 9) % 3 === 2 || (x + off) % 6 === 5) t = 0.18;
      if (x === 1) t += 0.08;
      if (x === 30) t -= 0.15;
      b.set(x, y, dtone(BRICK, t, x, y));
    }
  }
  // Fire mouth.
  for (let y = 15; y < 21; y++) {
    for (let x = 11; x < 21; x++) {
      const u = Math.abs(x + 0.5 - 16) / 5;
      if (y === 15 && u > 0.7) continue;
      const k = 0.55 + (1 - u) * 0.35 + (y - 15) * 0.03 + ((f + x) % 3 === 0 ? 0.06 : 0);
      b.set(x, y, tone(PAL.ember, Math.min(1, k)));
    }
  }
  // Copper vat on top, wax inside.
  for (let y = 2; y < 11; y++) {
    for (let x = 3; x < 29; x++) {
      const u = (x + 0.5 - 16) / 13;
      let t = 0.58 - u * 0.36 - Math.abs(u) ** 3 * 0.2 - (y - 2) * 0.02;
      if (y === 2) t += 0.18;
      b.set(x, y, dtone(COPPER, t, x, y));
    }
  }
  b.ellipse(16, 3, 11.5, 2.4, (x, y, nx, ny, d) => tone(WAX, 0.62 - nx * 0.12 + (d < 0.25 ? 0.12 : 0) + ((x + f) % 7 === 0 ? 0.1 : 0)));
  // Two wick-rods across the top with pairs of half-dipped candles.
  for (let x = 6; x < 26; x++) b.set(x, 0, tone(PAL.wood, 0.55));
  for (const cx of [10, 14, 18, 22]) {
    b.set(cx, 1, tone(WAX, 0.85));
    b.set(cx, 2, tone(WAX, 0.7));
  }
  finish(b);
  groundShadow(b, 16, 21, 15, 1.4, 60);
  return b;
}

function candleRack() {
  const b = buf(16, 28);
  for (const x of [1, 14]) {
    for (let y = 2; y < 28; y++) {
      b.set(x, y, tone(PAL.wood, x === 1 ? 0.6 : 0.32));
    }
  }
  for (const y of [3, 13]) {
    for (let x = 1; x < 15; x++) b.set(x, y, tone(PAL.wood, 0.55 - (x > 12 ? 0.15 : 0)));
    // Pairs of candles hanging by their wicks.
    for (let k = 0; k < 6; k++) {
      const cx = 3 + k * 2;
      const len = 6 + ((k * 7 + y) % 3);
      b.set(cx, y + 1, tone(PAL.bone, 0.55));
      for (let j = 0; j < len; j++) b.set(cx, y + 2 + j, tone(WAX, 0.82 - j * 0.03 - (k % 2 ? 0.08 : 0)));
    }
  }
  for (let x = 0; x < 16; x++) b.set(x, 27, tone(PAL.wood, 0.3));
  finish(b);
  groundShadow(b, 8, 27, 7, 1, 50);
  return b;
}

// ---------------------------------------------------------------------------
// Wenna's hives

function hive(kind, f) {
  const b = buf(16, 22);
  // A short stand.
  for (const x of [3, 12]) for (let y = 17; y < 22; y++) b.set(x, y, tone(PAL.wood, x === 3 ? 0.55 : 0.3));
  for (let x = 1; x < 15; x++) {
    b.set(x, 16, tone(PAL.wood, 0.6));
    b.set(x, 17, tone(PAL.wood, 0.35));
  }
  if (kind === 'skep') {
    // A coiled straw dome with an entrance at the bottom.
    for (let y = 3; y < 16; y++) {
      const v = (y - 3) / 13;
      const half = 2 + Math.sqrt(v) * 5.6;
      for (let x = Math.floor(8 - half); x <= Math.ceil(8 + half - 1); x++) {
        const u = (x + 0.5 - 8) / half;
        if (u < -1 || u > 1) continue;
        let t = 0.66 - u * 0.3 - Math.abs(u) ** 3 * 0.2 - v * 0.1;
        if ((y - 3) % 2 === 1) t -= 0.14; // the coils
        b.set(x, y, dtone(STRAW, t, x, y));
      }
    }
    b.set(7, 15, tone(PAL.woodDark, 0.1));
    b.set(8, 15, tone(PAL.woodDark, 0.1));
  } else {
    // A painted box hive with a pitched lid and a stone on top.
    box(b, 2, 7, 12, 9, 2, lut(['#4a5a3a', '#62764a', '#7c925c', '#98ac70', '#b4c48a', '#d0dcaa']), { grain: true, seed: 921 });
    for (let x = 1; x < 15; x++) {
      b.set(x, 5, tone(PAL.wood, 0.62));
      b.set(x, 6, tone(PAL.wood, 0.4));
    }
    for (let x = 5; x < 10; x++) for (let y = 2; y < 5; y++) b.set(x, y, tone(PAL.stone, 0.65 - (x - 5) * 0.06 - (y - 2) * 0.05));
    for (let x = 5; x < 11; x++) b.set(x, 14, tone(PAL.woodDark, 0.12));
  }
  finish(b);
  // Bees: a few bright specks circling the entrance.
  for (let k = 0; k < 4; k++) {
    const a = f * 1.4 + k * 1.6;
    const x = Math.round(8 + Math.cos(a) * (3 + k));
    const y = Math.round(9 + Math.sin(a * 1.3) * 3 - k);
    if (x >= 0 && x < 16 && y >= 0 && y < 16) b.set(x, y, rgb(k % 2 ? '#ffd24a' : '#3a2a10'));
  }
  groundShadow(b, 8, 21, 7, 1.2, 60);
  return b;
}

// ---------------------------------------------------------------------------
// Sabeth's dye-vats

function dyeVat(color, f) {
  const b = buf(16, 20);
  const D = DYES[color] || DYES.violet;
  // A big coopered tub.
  for (let y = 7; y < 19; y++) {
    for (let x = 1; x < 15; x++) {
      const u = (x + 0.5 - 8) / 7;
      let t = 0.56 - u * 0.32 - Math.abs(u) ** 3 * 0.2;
      if (x % 3 === 0) t -= 0.08;
      if (y === 9 || y === 16) t = 0.25;
      b.set(x, y, dtone(y === 9 || y === 16 ? PAL.iron : PAL.wood, t, x, y));
    }
  }
  b.ellipse(8, 7, 7, 2.6, (x, y, nx, ny, d) => (d > 0.72 ? tone(PAL.wood, 0.7 - nx * 0.2) : tone(D, 0.5 - nx * 0.12 - ny * 0.1 + (ih(x + f, y, 931) > 0.86 ? 0.25 : 0))));
  // A paddle leaning in.
  for (let k = 0; k < 9; k++) b.set(11 + Math.floor(k / 3), 6 - k, tone(PAL.woodLight, 0.6));
  finish(b);
  // Steam.
  for (let k = 0; k < 3; k++) {
    const y = 4 - ((f + k * 2) % 6);
    const x = 5 + k * 2 + (f % 2);
    if (y >= 0) b.blend(x, y, rgb('#e8e4f0'), 0.35);
  }
  groundShadow(b, 8, 19, 7, 1.2, 60);
  return b;
}

// ---------------------------------------------------------------------------
// Nan Pike's loom

function loom() {
  const b = buf(32, 30);
  const L = PAL.wood;
  // Frame posts and beams.
  for (const x of [2, 28]) for (let y = 2; y < 29; y++) {
    b.set(x, y, tone(L, 0.6));
    b.set(x + 1, y, tone(L, 0.3));
  }
  for (const y of [2, 12, 22]) for (let x = 2; x < 30; x++) {
    b.set(x, y, tone(L, 0.62));
    b.set(x, y + 1, tone(L, 0.34));
  }
  // The warp: blue and cream threads; woven cloth below the beater.
  const blue = lut(['#1a2a4a', '#2a4472', '#3e64a0', '#6a8cc4', '#a0bce0']);
  for (let x = 5; x < 27; x++) {
    for (let y = 4; y < 12; y++) if (x % 2 === 0) b.set(x, y, x % 4 === 0 ? tone(blue, 0.6) : tone(PAL.bone, 0.78));
    for (let y = 14; y < 22; y++) {
      const check = (Math.floor(x / 3) + Math.floor(y / 3)) % 2;
      b.set(x, y, check ? tone(blue, 0.55 - (y - 14) * 0.02) : tone(PAL.bone, 0.75 - (y - 14) * 0.02));
    }
  }
  // Treadles and the stool.
  for (let x = 8; x < 24; x += 4) for (let y = 24; y < 28; y++) b.set(x, y, tone(L, 0.4));
  finish(b);
  groundShadow(b, 16, 29, 15, 1.4, 60);
  return b;
}

// ---------------------------------------------------------------------------
// Corran's nets

function netRack() {
  const b = buf(16, 26);
  for (const x of [1, 14]) for (let y = 4; y < 26; y++) {
    b.set(x, y, tone(PAL.wood, x === 1 ? 0.55 : 0.3));
  }
  for (let x = 0; x < 16; x++) {
    b.set(x, 3, tone(PAL.wood, 0.62));
    b.set(x, 4, tone(PAL.wood, 0.35));
  }
  // A net draped over the pole in a loose mesh, sagging in the middle.
  for (let x = 2; x < 14; x++) {
    const sag = Math.round(Math.sin(((x - 2) / 11) * Math.PI) * 3);
    for (let y = 5; y < 18 + sag; y++) {
      const mesh = (x + y) % 3 === 0 || (x - y + 30) % 3 === 0;
      if (mesh) b.set(x, y, tone(NET, 0.62 - (y - 5) * 0.015 - (x > 11 ? 0.12 : 0)));
    }
    if (x % 4 === 1) b.set(x, 17 + sag, tone(FLOAT, 0.8)); // cork floats
  }
  finish(b);
  groundShadow(b, 8, 25, 7, 1, 50);
  return b;
}

// ---------------------------------------------------------------------------
// Washing lines

function washingLine(kind, f) {
  const b = buf(48, 30);
  for (const x of [2, 45]) for (let y = 4; y < 30; y++) b.set(x, y, tone(PAL.wood, x === 2 ? 0.55 : 0.3));
  for (const x of [1, 44]) b.set(x, 4, tone(PAL.wood, 0.6));
  const sagAt = (x) => 5 + Math.round(Math.sin(((x - 2) / 43) * Math.PI) * 3);
  for (let x = 3; x < 45; x++) b.set(x, sagAt(x), tone(ROPE, 0.6));
  // Clothes: each a rectangle hanging from the line, swinging a pixel in the wind.
  const items = kind === 'dyed'
    ? [[5, 7, 12, 'violet'], [14, 7, 13, 'teal'], [23, 7, 12, 'madder'], [32, 8, 11, 'violet']]
    : kind === 'b'
      ? [[5, 6, 7, 0], [13, 8, 9, 2], [24, 5, 6, 3], [31, 9, 10, 1]]
      : [[5, 8, 9, 2], [15, 6, 6, 0], [23, 9, 11, 3], [34, 6, 7, 1]];
  for (const [x0, w, h, c] of items) {
    const L = typeof c === 'string' ? DYES[c] : CLOTH[c];
    const sway = (f + x0) % 4 < 2 ? 0 : 1;
    for (let i = 0; i < w; i++) {
      const top = sagAt(x0 + i) + 1;
      for (let j = 0; j < h; j++) {
        const x = x0 + i + (j > h / 2 ? sway : 0);
        let t = 0.62 - i * 0.02 - j * 0.015;
        if (i === 0) t += 0.08;
        if (i === w - 1) t -= 0.12;
        if (typeof c === 'string' && (i + j) % 5 === 0) t += 0.12;
        b.set(x, top + j, dtone(L, t, x, top + j));
      }
      b.set(x0 + i, sagAt(x0 + i), tone(PAL.woodLight, 0.7)); // pegs
    }
  }
  finish(b);
  groundShadow(b, 24, 29, 22, 1.2, 40);
  return b;
}

// ---------------------------------------------------------------------------
// A lantern on a wall bracket by a door.

function wallLantern(lit, f = 0) {
  const b = buf(12, 22);
  // Bracket.
  for (let x = 2; x < 9; x++) b.set(x, 2, tone(PAL.iron, 0.55));
  b.set(2, 3, tone(PAL.iron, 0.4));
  b.set(8, 3, tone(PAL.iron, 0.4));
  // Lantern body.
  for (let x = 4; x < 9; x++) b.set(x, 4, tone(PAL.iron, 0.65));
  for (let y = 5; y < 12; y++) {
    for (let x = 4; x < 9; x++) {
      const frame = x === 4 || x === 8 || y === 11;
      if (frame) b.set(x, y, tone(PAL.iron, x === 4 ? 0.5 : 0.25));
      else if (lit) b.set(x, y, tone(PAL.glow, 0.78 + (f === 1 ? 0.06 : 0) - Math.abs(x - 6) * 0.06 - Math.abs(y - 8) * 0.04));
      else b.set(x, y, tone(PAL.glass, (x - y + 10) % 3 === 0 ? 0.5 : 0.24));
    }
  }
  if (lit) b.set(6, 8, rgb('#fff6dc'));
  finish(b);
  return b;
}

export function registerPlaces(add, rng) {
  const lindens = [0, 1, 2].map((v) => linden(v, rng.fork(940 + v)));
  add('prop:tree_linden:trunk', lindens.map((t) => t.trunk), { ox: 22, oy: 59 });
  add('prop:tree_linden:canopy', lindens.map((t) => t.canopy), { ox: 22, oy: 59 });
  add('prop:tree_linden', lindens.map((t) => t.trunk.clone().blit(t.canopy, 0, 0)), { ox: 22, oy: 59 });
  add('prop:dipping_vat', [0, 1, 2].map((f) => dippingVat(f)), { ox: 16, oy: 21, fps: 5 });
  add('prop:candle_rack', [candleRack()], { ox: 8, oy: 27 });
  for (const k of ['skep', 'box']) add(`prop:hive:${k}`, [0, 1, 2, 3, 4, 5].map((f) => hive(k, f)), { ox: 8, oy: 21, fps: 7 });
  add('prop:hive', [0, 1, 2, 3, 4, 5].map((f) => hive('skep', f)), { ox: 8, oy: 21, fps: 7 });
  for (const c of ['violet', 'teal', 'madder']) add(`prop:dye_vat:${c}`, [dyeVat(c, 0)], { ox: 8, oy: 19 });
  add('prop:dye_vat', [dyeVat('violet', 0)], { ox: 8, oy: 19 });
  add('prop:loom', [loom()], { ox: 16, oy: 29 });
  add('prop:net_rack', [netRack()], { ox: 8, oy: 25 });
  for (const k of [null, 'b', 'dyed']) add(k ? `prop:washing_line:${k}` : 'prop:washing_line', [0, 1, 2, 3].map((f) => washingLine(k, f)), { ox: 24, oy: 29, fps: 3 });
  add('prop:lamp:wall', [wallLantern(false)], { ox: 6, oy: 20 });
  add('prop:lamp:wall:lit', [0, 1, 2].map((f) => wallLantern(true, f)), { ox: 6, oy: 20, fps: 5 });
}

void OUT;
void mixc;
void cylinder;
void disc;
void planks;
