import { buf, finish, groundShadow, tone, dtone, box, cylinder, disc, foliage, PAL, rgb, mixc, shade, ih, lut } from './props_kit.js';

// Outdoor props: signs, fences, the well, the forge and anvil, market stalls, the
// farm's scarecrow and coop, the bandits' tents and braziers, and the ruins'
// pillars, tombs and statue.

function post(b, x, y0, y1, L = PAL.wood) {
  for (let y = y0; y <= y1; y++) {
    b.set(x, y, tone(L, 0.6));
    b.set(x + 1, y, tone(L, 0.3));
  }
}

function board(b, x0, y0, w, h, L = PAL.woodLight) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      let t = 0.6 - (y - y0) * 0.02 + (ih(x >> 2, y, 801) - 0.5) * 0.06;
      if ((y - y0) % 3 === 2) t -= 0.12;
      if (x === x0 || y === y0) t += 0.12;
      if (x === x0 + w - 1 || y === y0 + h - 1) t -= 0.22;
      b.set(x, y, dtone(L, t, x, y, 0.03));
    }
  }
}

function sign() {
  const b = buf(16, 18);
  post(b, 7, 8, 17);
  board(b, 2, 3, 12, 7);
  // Painted lines of text.
  for (const y of [5, 7]) for (let x = 4; x < 12; x++) if (ih(x, y, 802) > 0.3) b.set(x, y, tone(PAL.wood, 0.2));
  finish(b);
  groundShadow(b, 8.5, 17, 4, 1, 60);
  return b;
}

function noticeBoard() {
  const b = buf(24, 28);
  post(b, 3, 6, 27);
  post(b, 19, 6, 27);
  // Little roof over the board.
  for (let x = 1; x < 23; x++) {
    b.set(x, 3, tone(PAL.wood, 0.65));
    b.set(x, 4, tone(PAL.wood, 0.4));
    b.set(x, 5, tone(PAL.wood, 0.2));
  }
  for (let x = 3; x < 21; x++) b.set(x, 2, tone(PAL.wood, 0.5));
  board(b, 3, 6, 18, 14, PAL.wood);
  // Pinned notices.
  const notes = [
    [5, 8, 5, 5, 0.85],
    [11, 7, 6, 6, 0.75],
    [6, 14, 6, 5, 0.8],
    [13, 14, 5, 4, 0.9],
  ];
  for (const [x0, y0, w, h, t] of notes) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) b.set(x, y, tone(PAL.paper, t - (y - y0) * 0.03 - (x === x0 + w - 1 ? 0.12 : 0)));
    for (let y = y0 + 2; y < y0 + h - 1; y += 2) for (let x = x0 + 1; x < x0 + w - 1; x++) if (ih(x, y, 803) > 0.35) b.set(x, y, tone(PAL.paper, 0.2));
    b.set(x0 + (w >> 1), y0, rgb('#cc3a45'));
  }
  // WANTED poster with a red stamp.
  b.set(14, 9, rgb('#9e2133'));
  b.set(15, 9, rgb('#9e2133'));
  finish(b);
  groundShadow(b, 12, 27, 10, 1.4, 60);
  return b;
}

function hangingSign() {
  // Hangs from an iron bracket high on the facade (frame covers the 2-row facade).
  const b = buf(16, 32);
  for (let x = 1; x < 15; x++) b.set(x, 6, tone(PAL.iron, x < 3 ? 0.6 : 0.45));
  b.set(1, 5, tone(PAL.iron, 0.6));
  b.set(1, 7, tone(PAL.iron, 0.4));
  b.set(5, 7, tone(PAL.iron, 0.5));
  b.set(12, 7, tone(PAL.iron, 0.5));
  board(b, 3, 8, 12, 8, PAL.wood);
  b.ellipse(9, 12, 2.5, 2, (x, y, nx, ny) => tone(PAL.gold, 0.7 - nx * 0.2 - ny * 0.2));
  finish(b);
  return b;
}

function signpost() {
  const b = buf(20, 28);
  post(b, 9, 4, 27);
  // Arrows pointing different ways.
  const arrow = (y, dir, w) => {
    for (let k = 0; k < w; k++) {
      const x = dir > 0 ? 10 + k : 10 - k;
      for (let j = 0; j < 4; j++) b.set(x, y + j, tone(PAL.woodLight, 0.65 - j * 0.1));
    }
    const tip = dir > 0 ? 10 + w : 10 - w;
    b.set(tip, y + 1, tone(PAL.woodLight, 0.55));
    b.set(tip, y + 2, tone(PAL.woodLight, 0.4));
  };
  arrow(5, 1, 8);
  arrow(10, -1, 8);
  arrow(15, 1, 6);
  b.set(10, 3, tone(PAL.wood, 0.7));
  finish(b);
  groundShadow(b, 10.5, 27, 4, 1, 60);
  return b;
}

// Fences: mask bits N=1 E=2 S=4 W=8. A post in the middle, rails toward neighbours.
function fence(mask) {
  const b = buf(16, 24);
  const base = 21;
  const railL = PAL.woodLight;
  const rails = (x0, x1) => {
    for (let x = x0; x <= x1; x++) {
      b.set(x, base - 9, tone(railL, 0.7));
      b.set(x, base - 8, tone(railL, 0.4));
      b.set(x, base - 4, tone(railL, 0.62));
      b.set(x, base - 3, tone(railL, 0.35));
    }
  };
  if (mask & 2) rails(9, 15);
  if (mask & 8) rails(0, 6);
  if (mask & 1) {
    for (let y = 0; y < base - 9; y++) {
      b.set(7, y, tone(railL, 0.6));
      b.set(8, y, tone(railL, 0.35));
    }
  }
  // Post with a pointed cap.
  for (let y = base - 12; y <= base; y++) {
    b.set(6, y, tone(railL, 0.75));
    b.set(7, y, tone(railL, 0.55));
    b.set(8, y, tone(railL, 0.4));
    b.set(9, y, tone(railL, 0.22));
  }
  b.set(7, base - 13, tone(railL, 0.7));
  b.set(8, base - 13, tone(railL, 0.45));
  finish(b);
  groundShadow(b, 8.5, base + 1, 4, 1, 50);
  return b;
}

function well() {
  const b = buf(32, 44);
  // Stone ring (round, in 3/4 view).
  for (let y = 24; y < 42; y++) {
    for (let x = 3; x < 29; x++) {
      const u = (x + 0.5 - 16) / 13;
      if (Math.abs(u) > 1) continue;
      const topY = 27 - Math.sqrt(1 - u * u) * 3;
      const botY = 40 + Math.sqrt(1 - u * u) * 1.5;
      if (y < topY || y > botY) continue;
      const course = Math.floor((y - 24) / 4);
      const off = course % 2 ? 2 : 0;
      let t = 0.55 - u * 0.25 + (ih(Math.floor((x + off) / 5), course, 811) - 0.5) * 0.15;
      if ((y - 24) % 4 === 3 || (x + off) % 5 === 4) t -= 0.18;
      b.set(x, y, dtone(PAL.stone, t, x, y, 0.04));
    }
  }
  // The dark water opening.
  b.ellipse(16, 27, 11, 3, (x, y, nx, ny) => (ny < -0.4 ? tone(PAL.stone, 0.75) : tone(lut(['#05080e', '#0c1624', '#18304a']), 0.3 - ny * 0.2)));
  b.ellipse(16, 27.5, 9, 2, (x, y, nx, ny) => tone(lut(['#05080e', '#0c1624', '#18304a', '#2f5a7a']), 0.3 + (nx < -0.3 && ny < 0 ? 0.5 : 0)));
  // Posts and a little shingled roof.
  for (const x of [4, 26]) for (let y = 6; y < 28; y++) {
    b.set(x, y, tone(PAL.wood, 0.6));
    b.set(x + 1, y, tone(PAL.wood, 0.3));
  }
  for (let y = 0; y < 8; y++) {
    const hw = 6 + y * 1.6;
    for (let x = Math.floor(16 - hw); x <= Math.ceil(16 + hw - 1); x++) {
      const row = y % 3;
      let t = 0.55 + (ih(x >> 2, y, 812) - 0.5) * 0.12 - (row === 0 ? 0.18 : 0) - (x > 16 ? 0.12 : 0);
      b.set(x, y, tone(lut(['#2c1018', '#471a22', '#66262a', '#88352f', '#a8493a', '#c4614a']), t));
    }
  }
  // Crank, rope and bucket.
  for (let x = 6; x < 26; x++) b.set(x, 10, tone(PAL.wood, 0.5));
  for (let y = 11; y < 19; y++) b.set(16, y, tone(PAL.straw, 0.6));
  box(b, 14, 18, 5, 4, 1, PAL.wood, {});
  b.set(14, 18, tone(PAL.iron, 0.6));
  b.set(18, 18, tone(PAL.iron, 0.4));
  finish(b);
  return b;
}

function anvil() {
  const b = buf(16, 16);
  // Stump block.
  cylinder(b, 8, 9, 15, 4.5, PAL.bark);
  disc(b, 8, 9, 4.5, 1.6, PAL.woodLight);
  // The anvil itself.
  for (let y = 3; y < 9; y++) {
    const w = y < 6 ? (y === 3 ? 12 : 11) : 5;
    const x0 = y < 6 ? 2 : 6;
    for (let x = x0; x < x0 + w; x++) b.set(x, y, tone(PAL.iron, y === 3 ? 0.85 : 0.5 - (x - x0) * 0.02 - (y - 3) * 0.05));
  }
  b.set(1, 4, tone(PAL.iron, 0.6)); // horn
  b.set(0, 4, tone(PAL.iron, 0.4));
  finish(b);
  return b;
}

function forgeFrames() {
  const frames = [];
  for (let f = 0; f < 3; f++) {
    const b = buf(32, 34);
    // Hood narrowing up into the chimney.
    for (let y = 0; y < 14; y++) {
      const hw = 5 + y * 0.8;
      for (let x = Math.floor(16 - hw); x <= Math.ceil(16 + hw - 1); x++) {
        let t = 0.48 + (ih(x >> 2, y >> 2, 821) - 0.5) * 0.15 - (x > 16 ? 0.15 : 0);
        if (y % 4 === 3) t -= 0.15;
        b.set(x, y, dtone(PAL.stoneWarm, t, x, y));
      }
    }
    // Brick body with the glowing hearth.
    for (let y = 14; y < 34; y++) {
      for (let x = 2; x < 30; x++) {
        const course = Math.floor(y / 3);
        const off = course % 2 ? 2 : 0;
        let t = 0.5 + (ih((x + off) >> 2, course, 822) - 0.5) * 0.18;
        if (y % 3 === 2 || (x + off) % 4 === 3) t -= 0.18;
        if (x === 2) t += 0.12;
        if (x === 29) t -= 0.25;
        b.set(x, y, dtone(PAL.stoneWarm, t, x, y));
      }
    }
    for (let y = 18; y < 27; y++) {
      for (let x = 8; x < 24; x++) {
        const d = Math.hypot((x - 15.5) / 8, (y - 25) / 7);
        if (d > 1) continue;
        const flick = ih(x, y + f * 7, 823) * 0.25;
        b.set(x, y, tone(PAL.ember, 0.95 - d * 0.6 + flick - (y < 20 ? 0.2 : 0)));
      }
    }
    for (let x = 6; x < 26; x++) b.set(x, 27, tone(PAL.stone, 0.65));
    // Bellows on the side.
    for (let y = 22; y < 30; y++) for (let x = 26; x < 32; x++) if (Math.abs(y - 26) < 4 - (x - 26) * 0.4) b.set(x, y, tone(PAL.wood, 0.5 - (y - 22) * 0.03));
    finish(b);
    frames.push(b);
  }
  return frames;
}

function bench() {
  const b = buf(32, 14);
  for (const x of [3, 27]) for (let y = 7; y < 14; y++) {
    b.set(x, y, tone(PAL.wood, 0.5));
    b.set(x + 1, y, tone(PAL.wood, 0.25));
  }
  box(b, 0, 4, 32, 4, 2, PAL.woodLight, { grain: true, seed: 71 });
  for (let x = 1; x < 31; x++) b.set(x, 1, tone(PAL.woodLight, 0.6));
  for (let x = 1; x < 31; x++) b.set(x, 2, tone(PAL.woodLight, 0.35));
  for (const x of [2, 29]) for (let y = 1; y < 5; y++) b.set(x, y, tone(PAL.wood, 0.4));
  finish(b);
  groundShadow(b, 16, 13, 14, 1.3, 60);
  return b;
}

function stall(color) {
  const b = buf(32, 36);
  const C = color === 'blue' ? lut(['#1a2547', '#2a3d70', '#41609e', '#6a86c0', '#9fb4dc']) : lut(['#4a1520', '#7a2232', '#ab3a45', '#d0606a', '#f09aa0']);
  for (const x of [2, 28]) for (let y = 8; y < 36; y++) {
    b.set(x, y, tone(PAL.wood, 0.55));
    b.set(x + 1, y, tone(PAL.wood, 0.28));
  }
  // Striped awning with a scalloped edge.
  for (let y = 0; y < 11; y++) {
    for (let x = 0; x < 32; x++) {
      const stripe = Math.floor(x / 4) % 2;
      let t = (stripe ? 0.75 : 0.35) - y * 0.02;
      if (y === 10 && x % 4 === 3) continue;
      if (x === 31) t -= 0.2;
      b.set(x, y, stripe ? tone(PAL.bone, t + 0.1) : tone(C, t + 0.3));
    }
  }
  // Counter with goods.
  box(b, 1, 22, 30, 12, 4, PAL.wood, { topL: PAL.woodLight, grain: true, seed: 72 });
  const goods = ['#e0c0e0', '#cc3a45', '#ffd75e', '#58cf8f', '#d6ad7c'];
  for (let k = 0; k < 6; k++) {
    const x = 4 + k * 4;
    const c = rgb(goods[k % goods.length]);
    b.set(x, 21, c);
    b.set(x + 1, 21, shade(c, 0.75));
    b.set(x, 22, shade(c, 0.85));
    b.set(x + 1, 22, shade(c, 0.6));
    b.set(x + 1, 20, mixc(c, rgb('#ffffff'), 0.4));
  }
  finish(b);
  return b;
}

function scarecrow() {
  const b = buf(16, 32);
  post(b, 7, 8, 31);
  for (let x = 1; x < 15; x++) {
    b.set(x, 12, tone(PAL.wood, 0.55));
    b.set(x, 13, tone(PAL.wood, 0.3));
  }
  // Patched shirt.
  const SHIRT = lut(['#33211a', '#553728', '#7a523a', '#9a7050']);
  for (let y = 11; y < 22; y++) for (let x = 4; x < 12; x++) b.set(x, y, tone(SHIRT, 0.6 - (x - 4) * 0.05 + (x === 6 && y > 15 && y < 19 ? 0.3 : 0)));
  for (const [x, y] of [
    [2, 14],
    [13, 14],
    [3, 15],
    [12, 15],
  ])
    b.set(x, y, tone(PAL.straw, 0.7));
  // Sack head and a floppy hat.
  b.ellipse(8, 8, 3, 3, (x, y, nx, ny) => tone(PAL.straw, 0.65 - nx * 0.15 - ny * 0.1));
  b.set(7, 8, rgb('#2a1a14'));
  b.set(9, 8, rgb('#2a1a14'));
  for (let x = 8 - 3; x <= 8 + 3; x++) b.set(x, 10, tone(PAL.straw, 0.4));
  for (let x = 3; x < 14; x++) b.set(x, 5, tone(SHIRT, 0.35));
  for (let y = 1; y < 5; y++) for (let x = 5; x < 11; x++) b.set(x, y, tone(SHIRT, 0.5 - (x - 5) * 0.04));
  finish(b);
  return b;
}

function hay() {
  const b = buf(16, 14);
  box(b, 1, 3, 14, 10, 4, PAL.straw, { grain: true, seed: 81 });
  for (let y = 3; y < 13; y++) for (const x of [4, 11]) b.set(x, y, tone(PAL.wood, 0.35));
  for (let k = 0; k < 6; k++) b.set(2 + Math.floor(ih(k, 0, 82) * 12), 2, tone(PAL.straw, 0.8));
  finish(b);
  groundShadow(b, 8.5, 13, 7, 1.2, 60);
  return b;
}

function coop() {
  const b = buf(32, 26);
  box(b, 2, 10, 28, 15, 0, PAL.woodLight, { grain: true, seed: 91, lit: -0.05 });
  for (let x = 2; x < 30; x++) if (x % 4 === 0) for (let y = 10; y < 25; y++) b.set(x, y, tone(PAL.woodLight, 0.3));
  // Pitched roof.
  for (let y = 0; y < 11; y++) {
    for (let x = 0; x < 32; x++) {
      const row = y % 3;
      let t = 0.5 + (ih(x >> 2, y, 92) - 0.5) * 0.12 - (row === 0 ? 0.2 : 0) - (y > 7 ? 0.08 : 0);
      if (x === 31) t -= 0.2;
      b.set(x, y, tone(lut(['#3a1d18', '#5e2c22', '#86402e', '#a8583c', '#c47a58']), t));
    }
  }
  // Little door and ramp.
  for (let y = 15; y < 23; y++) for (let x = 13; x < 19; x++) b.set(x, y, tone(PAL.woodDark, 0.15));
  for (let k = 0; k < 4; k++) b.set(14 + k, 24 + (k >> 1), tone(PAL.wood, 0.5));
  finish(b);
  return b;
}

function tent(variant) {
  const chief = variant === 'chief';
  const w = chief ? 80 : 48;
  const h = chief ? 58 : 40;
  const b = buf(w, h);
  const C =
    variant === 'red'
      ? lut(['#3a1418', '#5e2026', '#843036', '#a8484a', '#c86a66', '#e09a90'])
      : chief
        ? lut(['#2a2418', '#463a24', '#665632', '#8a7646', '#ab985e', '#c9b682'])
        : lut(['#2e2216', '#4a3622', '#6a5032', '#8a6c44', '#a8885a', '#c4a678']);
  const cx = w / 2;
  const top = chief ? 4 : 4;
  const base = h - 2;
  // A ridge tent seen from the front: the triangular front with an open flap.
  for (let y = top; y <= base; y++) {
    const t = (y - top) / (base - top);
    const hw = 3 + t * (w / 2 - 3);
    for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw - 1); x++) {
      const u = (x + 0.5 - cx) / hw;
      // Canvas lit on the left panel, shaded on the right, with seams and sag.
      let tt = u < 0 ? 0.68 + u * 0.12 : 0.42 - u * 0.12;
      if (Math.abs(u) < 0.04) tt = 0.8;
      if (Math.round((x - cx) / (w / 10)) * (w / 10) === Math.round(x - cx) && Math.abs(u) > 0.1) tt -= 0.07;
      tt += (ih(x >> 1, y >> 1, 101) - 0.5) * 0.05 - t * 0.06;
      b.set(x, y, dtone(C, tt, x, y, 0.04));
    }
  }
  // The open flap: a dark triangle and the folded-back cloth.
  const fh = chief ? 26 : 18;
  for (let y = base - fh; y <= base; y++) {
    const t = (y - (base - fh)) / fh;
    const hw = t * (chief ? 10 : 7);
    for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw - 1); x++) b.set(x, y, tone(lut(['#0e0a10', '#1a1218', '#2a1c20']), 0.2 + t * 0.4));
    b.set(Math.floor(cx - hw) - 1, y, tone(C, 0.9));
    b.set(Math.ceil(cx + hw), y, tone(C, 0.25));
  }
  // Poles and guy ropes.
  for (let y = 0; y < top + 2; y++) b.set(cx, y, tone(PAL.wood, 0.5));
  for (const s of [-1, 1]) for (let k = 0; k < (chief ? 12 : 8); k++) b.set(Math.round(cx + s * (w / 2 - 2 + 0)), base - k, 0);
  if (chief) {
    // A banner of a crude red fist over the chief's tent.
    for (let y = 0; y < 8; y++) for (let x = cx + 1; x < cx + 8; x++) b.set(x, y, tone(lut(['#4a1520', '#7a2232', '#ab3a45']), 0.6 - (y > 5 && x > cx + 5 ? 1 : 0)));
    b.set(cx + 4, 3, rgb('#e2d2b0'));
    b.set(cx + 4, 4, rgb('#e2d2b0'));
  }
  finish(b);
  return b;
}

function logSeat() {
  const b = buf(32, 12);
  for (let y = 2; y < 11; y++) {
    for (let x = 3; x < 29; x++) {
      const v = (y - 2) / 8;
      let t = 0.7 - v * 0.5 + (ih(x >> 2, y, 111) - 0.5) * 0.1;
      if (ih(x, y >> 1, 112) > 0.85) t -= 0.15;
      b.set(x, y, dtone(PAL.bark, t, x, y));
    }
  }
  disc(b, 29, 6.5, 2.5, 4.4, PAL.woodLight, (nx, ny, d) => 0.7 - Math.sqrt(d) * 0.3 - (Math.floor(Math.sqrt(d) * 3) % 2) * 0.1);
  finish(b);
  groundShadow(b, 16, 11, 14, 1.2, 60);
  return b;
}

function brazierFrames() {
  const frames = [];
  for (let f = 0; f < 3; f++) {
    const b = buf(16, 26);
    // Tripod legs.
    for (let k = 0; k < 12; k++) {
      b.set(4 + Math.floor(k / 3), 25 - k, tone(PAL.iron, 0.55));
      b.set(11 - Math.floor(k / 3), 25 - k, tone(PAL.iron, 0.3));
    }
    b.ellipse(8, 13, 6, 3, (x, y, nx, ny) => tone(PAL.iron, ny < -0.2 ? 0.2 : 0.5 - nx * 0.25));
    for (let y = 2; y < 12; y++) {
      const t = (12 - y) / 10;
      const hw = 4 * (1 - t * t) + Math.sin(f * 2 + y) * 0.6;
      for (let x = Math.floor(8 - hw); x <= Math.ceil(8 + hw - 1); x++) b.set(x, y, tone(PAL.ember, 0.45 + (1 - t) * 0.5 - Math.abs(x + 0.5 - 8) * 0.06));
    }
    finish(b);
    frames.push(b);
  }
  return frames;
}

function tomb() {
  const b = buf(32, 20);
  box(b, 1, 3, 30, 16, 7, PAL.stone, { grain: true, seed: 121 });
  // A carved figure on the lid, worn smooth.
  b.ellipse(8, 6, 2.2, 2, (x, y, nx, ny) => tone(PAL.stone, 0.85 - nx * 0.2));
  for (let x = 10; x < 25; x++) b.set(x, 6, tone(PAL.stone, 0.82));
  for (let x = 10; x < 25; x++) b.set(x, 7, tone(PAL.stone, 0.55));
  for (let x = 3; x < 29; x++) if (ih(x, 1, 122) > 0.75) b.set(x, 12 + Math.floor(ih(x, 2, 123) * 4), rgb('#3d5a31'));
  finish(b);
  return b;
}

function bedroll() {
  const b = buf(16, 10);
  const C = lut(['#1a2547', '#2a3d70', '#41609e', '#6a86c0']);
  for (let y = 2; y < 9; y++) for (let x = 1; x < 15; x++) b.set(x, y, tone(C, 0.6 - (y - 2) * 0.05 - (x > 10 ? 0.1 : 0)));
  b.ellipse(12, 5, 3, 3.2, (x, y, nx, ny) => tone(C, 0.5 - nx * 0.2 - ny * 0.15));
  for (let y = 2; y < 9; y++) b.set(6, y, tone(PAL.wood, 0.4));
  // A cold lantern beside it.
  b.set(2, 1, tone(PAL.iron, 0.6));
  b.set(2, 2, tone(PAL.glass, 0.4));
  finish(b);
  return b;
}

function pillar(broken) {
  const h = broken ? 26 : 44;
  const b = buf(16, h);
  const top = broken ? 6 : 6;
  cylinder(b, 8, top, h - 4, 4.5, PAL.stone, {});
  // Flutes.
  for (let y = top; y < h - 4; y++) for (const x of [6, 9]) b.set(x, y, shade(b.get(x, y), 0.82));
  // Base and capital.
  box(b, 2, h - 5, 12, 5, 2, PAL.stone, {});
  if (!broken) box(b, 2, 1, 12, 6, 2, PAL.stone, {});
  else {
    // Jagged broken top.
    for (let x = 4; x < 13; x++) {
      const cut = Math.floor(ih(x, 0, 131) * 4);
      for (let y = top; y < top + cut; y++) b.set(x, y, 0);
      b.set(x, top + cut, tone(PAL.stone, 0.8));
    }
  }
  // Moss and ivy.
  for (let k = 0; k < 10; k++) {
    const x = 4 + Math.floor(ih(k, h, 132) * 8);
    const y = top + Math.floor(ih(k, h, 133) * (h - top - 6));
    b.set(x, y, rgb(k % 2 ? '#3d5a31' : '#557539'));
    b.set(x, y + 1, rgb('#2b4127'));
  }
  finish(b);
  return b;
}

function statue() {
  const b = buf(16, 46);
  box(b, 2, 38, 12, 8, 3, PAL.stone, {});
  // A robed figure raising a lantern.
  for (let y = 12; y < 38; y++) {
    const t = (y - 12) / 26;
    const hw = 2.5 + t * 3;
    for (let x = Math.floor(8 - hw); x <= Math.ceil(8 + hw - 1); x++) {
      const u = (x + 0.5 - 8) / hw;
      let tt = 0.6 - u * 0.3 + ((x + y) % 5 === 0 ? -0.08 : 0);
      if (y > 30 && (x - 8) % 3 === 0) tt -= 0.12; // robe folds
      b.set(x, y, tone(PAL.stone, tt));
    }
  }
  b.ellipse(8, 9, 2.6, 3, (x, y, nx, ny) => tone(PAL.stone, 0.62 - nx * 0.25 - ny * 0.1));
  for (let y = 3; y < 15; y++) b.set(12, y, tone(PAL.stone, 0.5)); // raised arm
  b.set(11, 14, tone(PAL.stone, 0.45));
  b.ellipse(12.5, 2, 1.6, 1.8, (x, y, nx) => tone(PAL.stone, 0.75 - nx * 0.3));
  for (let k = 0; k < 8; k++) b.set(4 + Math.floor(ih(k, 3, 141) * 8), 20 + Math.floor(ih(k, 4, 142) * 18), rgb('#3d5a31'));
  finish(b);
  return b;
}

function cart(variant) {
  const b = buf(32, 24);
  box(b, 3, 6, 26, 10, 3, PAL.wood, { topL: PAL.woodLight, grain: true, seed: 151 });
  if (variant === 'ore') {
    for (let k = 0; k < 10; k++) {
      const x = 6 + k * 2;
      const y = 5 - (k % 3 === 1 ? 1 : 0);
      b.set(x, y, tone(PAL.stone, 0.6));
      b.set(x + 1, y, tone(PAL.stone, 0.35));
      if (k % 3 === 0) b.set(x, y - 1, tone(lut(['#4a2210', '#a85a28', '#f0b070']), 0.6));
    }
  }
  // Wheels.
  for (const cx of [8, 24]) {
    disc(b, cx, 18, 4.5, 4.5, PAL.wood, (nx, ny, d) => (d > 0.6 ? 0.55 - nx * 0.2 - ny * 0.2 : d < 0.1 ? 0.7 : 0.25));
    b.set(cx, 18, tone(PAL.iron, 0.7));
  }
  // Handles.
  for (let x = 28; x < 32; x++) b.set(x, 10, tone(PAL.wood, 0.5));
  finish(b);
  return b;
}

function altarFrames(dark) {
  const frames = [];
  for (let f = 0; f < 3; f++) {
    const b = buf(48, 28);
    box(b, 2, 10, 44, 17, 5, dark ? lut(['#0e0c14', '#16131e', '#201c2a', '#2c2738', '#3a3448']) : PAL.stone, { grain: true, seed: 161 });
    if (!dark) {
      // White altar cloth with a gold band.
      for (let y = 10; y < 22; y++) for (let x = 8; x < 40; x++) if (y < 15 || (x > 12 && x < 36)) b.set(x, y, tone(PAL.bone, y < 15 ? 0.9 - (y - 10) * 0.02 : 0.72 - (x > 30 ? 0.1 : 0)));
      for (let x = 13; x < 36; x++) b.set(x, 19, tone(PAL.gold, 0.7));
      // Candles and a flame-shaped icon.
      for (const cx of [11, 37]) {
        for (let y = 4; y < 10; y++) b.set(cx, y, tone(PAL.bone, 0.9));
        b.set(cx, 3, tone(PAL.ember, 0.8 + ((f + cx) % 3) * 0.06));
        b.set(cx, 2, tone(PAL.ember, 0.95));
      }
      for (let y = 2; y < 10; y++) {
        const hw = y < 5 ? (y - 2) * 0.7 : 2.5 - (y - 5) * 0.3;
        for (let x = Math.floor(24 - hw); x <= Math.ceil(24 + hw - 1); x++) b.set(x, y, tone(PAL.gold, 0.85 - (x - 24) * 0.1));
      }
    } else {
      // Violet light pooling in carved runes.
      for (const [x, y] of [
        [12, 16],
        [18, 18],
        [24, 15],
        [30, 18],
        [36, 16],
      ]) {
        b.set(x, y, rgb(f === (x >> 3) % 3 ? '#ddd2ff' : '#7a64e0'));
        b.set(x + 1, y, rgb('#4f3db3'));
      }
      b.set(24, 11, rgb('#a995ff'));
    }
    finish(b);
    frames.push(b);
  }
  return frames;
}

function pew() {
  const b = buf(48, 18);
  for (let x = 1; x < 47; x++) for (let y = 0; y < 8; y++) b.set(x, y, tone(PAL.wood, 0.55 - y * 0.03 - (x === 46 ? 0.2 : 0) + (y === 0 ? 0.15 : 0)));
  box(b, 0, 8, 48, 6, 3, PAL.wood, { topL: PAL.woodLight, grain: true, seed: 171 });
  for (const x of [2, 44]) for (let y = 14; y < 18; y++) {
    b.set(x, y, tone(PAL.wood, 0.45));
    b.set(x + 1, y, tone(PAL.wood, 0.2));
  }
  finish(b);
  return b;
}

function bannerFrames() {
  const frames = [];
  for (let f = 0; f < 3; f++) {
    const b = buf(16, 36);
    for (let y = 0; y < 36; y++) {
      b.set(3, y, tone(PAL.wood, 0.6));
      b.set(4, y, tone(PAL.wood, 0.3));
    }
    b.set(3, 0, tone(PAL.gold, 0.9));
    const C = lut(['#1a2547', '#2a3d70', '#41609e', '#6a86c0']);
    for (let y = 3; y < 20; y++) {
      const wave = Math.round(Math.sin(y * 0.5 + f * 2) * 0.8);
      for (let x = 5; x < 14; x++) {
        if (y > 16 && Math.abs(x - 9.5) < y - 16) continue; // swallow tail
        let t = 0.6 - (x - 5) * 0.03 + wave * 0.1;
        if (x === 13) t -= 0.2;
        b.set(x + (x > 9 ? wave : 0), y, tone(C, t));
      }
    }
    // A gold lantern sigil: the village's mark.
    b.set(9, 8, tone(PAL.gold, 0.9));
    b.set(9, 9, tone(PAL.gold, 0.7));
    b.set(8, 9, tone(PAL.gold, 0.6));
    b.set(10, 9, tone(PAL.gold, 0.5));
    b.set(9, 10, tone(PAL.gold, 0.6));
    finish(b);
    frames.push(b);
  }
  return frames;
}

function dummy() {
  const b = buf(16, 28);
  post(b, 7, 10, 27);
  for (let x = 2; x < 14; x++) {
    b.set(x, 13, tone(PAL.wood, 0.55));
    b.set(x, 14, tone(PAL.wood, 0.3));
  }
  b.ellipse(8, 18, 4.5, 5, (x, y, nx, ny) => tone(PAL.straw, 0.62 - nx * 0.25 - ny * 0.15));
  b.ellipse(8, 7, 3.5, 3.5, (x, y, nx, ny) => tone(PAL.straw, 0.68 - nx * 0.25 - ny * 0.15));
  // A scowl someone drew on it.
  b.set(6, 6, rgb('#2a1a14'));
  b.set(10, 6, rgb('#2a1a14'));
  for (let x = 6; x < 11; x++) b.set(x, 9, rgb('#2a1a14'));
  b.set(5, 5, rgb('#2a1a14'));
  b.set(11, 5, rgb('#2a1a14'));
  finish(b);
  return b;
}

function woodpile() {
  const b = buf(16, 16);
  // Stacked split logs seen end-on.
  const rows = [
    [3, 13, 4],
    [8, 13, 4],
    [13, 13, 4],
    [5.5, 9, 4],
    [10.5, 9, 4],
    [8, 5, 4],
  ];
  for (const [cx, cy, r] of rows) {
    disc(b, cx, cy, r * 0.62, r * 0.6, PAL.woodLight, (nx, ny, d) => 0.75 - Math.sqrt(d) * 0.3 - nx * 0.1 - (Math.floor(Math.sqrt(d) * 3) % 2) * 0.1);
    for (let k = -2; k <= 2; k++) if (Math.abs(k) === 2) b.set(Math.round(cx + k * 0.6), Math.round(cy), tone(PAL.bark, 0.3));
  }
  finish(b);
  groundShadow(b, 8.5, 15, 7, 1.2, 60);
  return b;
}

export function registerVillage(add, rng) {
  add('prop:sign', [sign()], { ox: 8, oy: 17 });
  add('prop:sign:board', [noticeBoard()], { ox: 12, oy: 27 });
  add('prop:sign:hanging', [hangingSign()], { ox: 8, oy: 31 });
  add('prop:sign:post', [signpost()], { ox: 10, oy: 27 });
  for (let m = 0; m < 16; m++) add(`prop:fence:${m}`, [fence(m)], { ox: 8, oy: 21 });
  add('prop:fence', [fence(10)], { ox: 8, oy: 21 });
  add('prop:well', [well()], { ox: 16, oy: 43 });
  add('prop:anvil', [anvil()], { ox: 8, oy: 15 });
  add('prop:forge', forgeFrames(), { ox: 16, oy: 33, fps: 6 });
  add('prop:bench', [bench()], { ox: 16, oy: 13 });
  add('prop:stall', [stall('red')], { ox: 16, oy: 35 });
  add('prop:stall:red', [stall('red')], { ox: 16, oy: 35 });
  add('prop:stall:blue', [stall('blue')], { ox: 16, oy: 35 });
  add('prop:scarecrow', [scarecrow()], { ox: 8, oy: 31 });
  add('prop:hay', [hay()], { ox: 8, oy: 13 });
  add('prop:coop', [coop()], { ox: 16, oy: 25 });
  add('prop:tent', [tent('brown')], { ox: 24, oy: 39 });
  add('prop:tent:brown', [tent('brown')], { ox: 24, oy: 39 });
  add('prop:tent:red', [tent('red')], { ox: 24, oy: 39 });
  add('prop:tent:chief', [tent('chief')], { ox: 40, oy: 57 });
  add('prop:log', [logSeat()], { ox: 16, oy: 11 });
  add('prop:brazier', brazierFrames(), { ox: 8, oy: 25, fps: 7 });
  add('prop:tomb', [tomb()], { ox: 16, oy: 19 });
  add('prop:bedroll', [bedroll()], { ox: 8, oy: 9 });
  add('prop:ruin_pillar', [pillar(false)], { ox: 8, oy: 43 });
  add('prop:ruin_pillar:whole', [pillar(false)], { ox: 8, oy: 43 });
  add('prop:ruin_pillar:broken', [pillar(true)], { ox: 8, oy: 25 });
  add('prop:statue', [statue()], { ox: 8, oy: 45 });
  add('prop:cart', [cart(null)], { ox: 16, oy: 23 });
  add('prop:cart:ore', [cart('ore')], { ox: 16, oy: 23 });
  add('prop:altar', altarFrames(false), { ox: 24, oy: 27, fps: 5 });
  add('prop:altar:dark', altarFrames(true), { ox: 24, oy: 27, fps: 3 });
  add('prop:pew', [pew()], { ox: 24, oy: 17 });
  add('prop:banner', bannerFrames(), { ox: 4, oy: 35, fps: 4 });
  add('prop:dummy', [dummy()], { ox: 8, oy: 27 });
  add('prop:woodpile', [woodpile()], { ox: 8, oy: 15 });
  void rng;
  void foliage;
}
