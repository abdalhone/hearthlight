import { DECO } from '../world/tiles.js';
import { PixelBuf, rgb, shade, mixc } from './world_pixbuf.js';

// Small ground details (flowers, tufts, pebbles, lily pads...) painted into the cached
// ground chunks. Each deco id has a few variants; the chunk painter picks one per tile
// from a coordinate hash and nudges its position, so nothing lines up in a grid.
// Sprites are 16×16 with transparent backgrounds and a soft contact shadow baked in.

const OUT = rgb('#1a1423');
const SH = rgb('#000000', 70);

function sprite(fn) {
  const b = new PixelBuf(16, 16);
  fn(b);
  return b;
}

// A tiny flower: four petals around a center, lit from the upper left.
function flower(b, x, y, petal, center, big = false) {
  const lit = mixc(petal, rgb('#ffffff'), 0.35);
  const dark = shade(petal, 0.7);
  b.set(x, y + 2, rgb('#2c5a34'));
  b.set(x, y + 3, rgb('#2c5a34'));
  b.set(x - 1, y, lit);
  b.set(x + 1, y, dark);
  b.set(x, y - 1, lit);
  b.set(x, y + 1, dark);
  if (big) {
    b.set(x - 1, y - 1, petal);
    b.set(x + 1, y - 1, petal);
    b.set(x - 1, y + 1, dark);
    b.set(x + 1, y + 1, shade(petal, 0.6));
  }
  b.set(x, y, center);
  b.blend(x + 1, y + 2, SH);
}

const FLOWER_COLORS = ['#f4f0e6', '#ffd75e', '#ff9fc2', '#8fb6ff', '#c79bff', '#ff7a5c', '#fff3a8'].map((h) => rgb(h));

function flowers(rng, n, big) {
  return sprite((b) => {
    const base = Math.floor(rng.next() * FLOWER_COLORS.length);
    for (let k = 0; k < n; k++) {
      const c = FLOWER_COLORS[(base + (rng.next() < 0.75 ? 0 : 1 + Math.floor(rng.next() * 3))) % FLOWER_COLORS.length];
      flower(b, 3 + Math.floor(rng.next() * 10), 3 + Math.floor(rng.next() * 9), c, rgb(rng.next() < 0.5 ? '#ffcf4a' : '#e98a2a'), big && rng.next() < 0.5);
    }
  });
}

function tuft(rng, dark = '#24452a', mid = '#3e7a3c', lit = '#86bc5a') {
  return sprite((b) => {
    const cx = 5 + Math.floor(rng.next() * 6);
    const blades = 5 + Math.floor(rng.next() * 3);
    for (let k = 0; k < blades; k++) {
      const x = cx + k - (blades >> 1);
      const h = 2 + Math.floor(rng.next() * 3) + (Math.abs(k - (blades >> 1)) < 2 ? 1 : 0);
      for (let s = 0; s < h; s++) b.set(x + (s === h - 1 && k !== blades >> 1 ? Math.sign(k - (blades >> 1)) : 0), 12 - s, rgb(s === h - 1 ? lit : s === 0 ? dark : mid));
    }
    for (let k = -2; k < blades - 2; k++) b.blend(cx + k, 13, SH);
  });
}

function clover(rng) {
  return sprite((b) => {
    for (let k = 0; k < 3; k++) {
      const x = 3 + Math.floor(rng.next() * 9);
      const y = 4 + Math.floor(rng.next() * 8);
      const c = rgb('#4a8a3e');
      const l = rgb('#7fb85a');
      b.set(x, y, l);
      b.set(x + 1, y, c);
      b.set(x - 1, y + 1, c);
      b.set(x, y + 1, rgb('#2f6338'));
      b.set(x + 1, y + 1, c);
      b.set(x + 2, y + 1, rgb('#2f6338'));
      if (rng.next() < 0.3) b.set(x, y - 1, rgb('#f4f0e6'));
    }
  });
}

function pebbles(rng, tones = ['#4c4a5c', '#727085', '#a3a1b4']) {
  return sprite((b) => {
    const n = 2 + Math.floor(rng.next() * 3);
    for (let k = 0; k < n; k++) {
      const x = 2 + Math.floor(rng.next() * 11);
      const y = 3 + Math.floor(rng.next() * 10);
      const big = rng.next() < 0.4;
      b.set(x, y, rgb(tones[1]));
      b.set(x, y - 1, rgb(tones[2]));
      if (big) {
        b.set(x + 1, y, rgb(tones[0]));
        b.set(x + 1, y - 1, rgb(tones[1]));
        b.blend(x + 2, y, SH);
      }
      b.blend(x, y + 1, SH);
      b.blend(x + 1, y + 1, SH);
    }
  });
}

function mushrooms(rng) {
  return sprite((b) => {
    const red = rng.next() < 0.5;
    const n = 1 + Math.floor(rng.next() * 3);
    for (let k = 0; k < n; k++) {
      const x = 3 + Math.floor(rng.next() * 9);
      const y = 6 + Math.floor(rng.next() * 6);
      const cap = rgb(red ? '#c8423a' : '#a5774a');
      const capL = rgb(red ? '#ef7a5e' : '#c99a64');
      b.blend(x - 1, y + 2, SH);
      b.blend(x + 1, y + 2, SH);
      b.set(x, y + 1, rgb('#e8dcc0'));
      b.set(x, y + 2, rgb('#cfc1a2'));
      b.set(x - 1, y, cap);
      b.set(x, y, capL);
      b.set(x + 1, y, shade(cap, 0.7));
      b.set(x, y - 1, capL);
      if (red) b.set(x, y, rgb('#fff4e0'));
    }
  });
}

function roots(rng) {
  return sprite((b) => {
    for (let k = 0; k < 2; k++) {
      let x = rng.next() * 16;
      let y = 4 + rng.next() * 8;
      const dx = rng.next() < 0.5 ? 1 : -1;
      for (let s = 0; s < 9; s++) {
        b.set(Math.round(x), Math.round(y), rgb('#5a3d2e'));
        b.set(Math.round(x), Math.round(y) - 1, rgb('#7a553a'));
        b.blend(Math.round(x), Math.round(y) + 1, SH);
        x += dx;
        y += (rng.next() - 0.5) * 1.2;
      }
    }
  });
}

function leaves(rng) {
  const cols = ['#b5662a', '#d08a35', '#8a4a22', '#c4a040', '#6f7a2e'].map((h) => rgb(h));
  return sprite((b) => {
    const n = 3 + Math.floor(rng.next() * 3);
    for (let k = 0; k < n; k++) {
      const x = 2 + Math.floor(rng.next() * 12);
      const y = 2 + Math.floor(rng.next() * 12);
      const c = cols[Math.floor(rng.next() * cols.length)];
      b.set(x, y, mixc(c, rgb('#ffffff'), 0.2));
      b.set(x + 1, y, c);
      b.set(x + 1, y + 1, shade(c, 0.7));
      b.blend(x + 1, y + 2, SH);
    }
  });
}

function moss(rng) {
  return sprite((b) => {
    const cx = 5 + rng.next() * 6;
    const cy = 6 + rng.next() * 4;
    b.ellipse(cx, cy, 4 + rng.next() * 2, 2.5 + rng.next(), (x, y, nx, ny, d) => {
      if (d > 0.8 && ((x + y) & 1)) return 0;
      return rgb(ny < -0.3 ? '#6f9a45' : d > 0.6 ? '#2f5228' : '#4a7a3a');
    });
  });
}

function lily(rng) {
  return sprite((b) => {
    const cx = 6 + rng.next() * 4;
    const cy = 7 + rng.next() * 3;
    const r = 3 + rng.next() * 1.2;
    const notch = rng.next() * Math.PI * 2;
    b.ellipse(cx + 0.5, cy + 1.2, r, r * 0.6, () => rgb('#0d2a3a', 90));
    b.ellipse(cx, cy, r, r * 0.62, (x, y, nx, ny) => {
      const a = Math.atan2(ny, nx);
      if (Math.abs(((a - notch + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.35 && nx * nx + ny * ny > 0.05) return 0;
      return rgb(ny < -0.35 ? '#7fc06a' : nx + ny > 0.6 ? '#2e6e3c' : '#4f9a4c');
    });
    if (rng.next() < 0.35) {
      b.set(Math.round(cx), Math.round(cy) - 1, rgb('#ffd6ea'));
      b.set(Math.round(cx) - 1, Math.round(cy) - 1, rgb('#ff9fc2'));
      b.set(Math.round(cx) + 1, Math.round(cy) - 1, rgb('#ff9fc2'));
      b.set(Math.round(cx), Math.round(cy) - 2, rgb('#fff4fa'));
      b.set(Math.round(cx), Math.round(cy), rgb('#ffd75e'));
    }
  });
}

function reeds(rng) {
  return sprite((b) => {
    const n = 3 + Math.floor(rng.next() * 3);
    for (let k = 0; k < n; k++) {
      const x = 2 + Math.floor(rng.next() * 12);
      const h = 7 + Math.floor(rng.next() * 6);
      const lean = rng.next() < 0.5 ? 0 : rng.next() < 0.5 ? -1 : 1;
      for (let s = 0; s < h; s++) {
        const xx = x + (s > h * 0.6 ? lean : 0);
        b.set(xx, 14 - s, rgb(s < 2 ? '#2a4a2c' : s > h - 3 ? '#8fb85a' : '#5c8a3e'));
      }
      if (rng.next() < 0.6) {
        const xx = x + lean;
        b.set(xx, 14 - h, rgb('#6b412a'));
        b.set(xx, 15 - h, rgb('#8c5a35'));
        b.set(xx, 16 - h, rgb('#6b412a'));
      }
      b.blend(x + 1, 15, rgb('#0d1f33', 110));
    }
  });
}

function crack(rng) {
  return sprite((b) => {
    let x = 2 + rng.next() * 4;
    let y = 3 + rng.next() * 10;
    let a = rng.next() * 0.8 - 0.4;
    for (let s = 0; s < 12; s++) {
      b.set(Math.round(x), Math.round(y), rgb('#1a1823'));
      b.set(Math.round(x), Math.round(y) + 1, rgb('#ffffff', 40));
      a += (rng.next() - 0.5) * 0.9;
      x += Math.cos(a);
      y += Math.sin(a);
      if (s === 5 && rng.next() < 0.6) {
        let bx = x;
        let by = y;
        for (let t = 0; t < 4; t++) {
          bx += 0.7;
          by -= 0.8;
          b.set(Math.round(bx), Math.round(by), rgb('#1a1823'));
        }
      }
    }
  });
}

function bones(rng) {
  return sprite((b) => {
    const bone = rgb('#ded5bd');
    const boneD = rgb('#a89e86');
    if (rng.next() < 0.5) {
      // a skull
      b.ellipse(7, 8, 3, 2.6, (x, y, nx, ny) => (ny < -0.2 ? rgb('#f6f0de') : bone));
      b.set(6, 8, OUT);
      b.set(8, 8, OUT);
      b.set(7, 10, boneD);
      b.blend(8, 11, SH);
      b.blend(9, 10, SH);
    }
    for (let k = 0; k < 2; k++) {
      const x = 3 + Math.floor(rng.next() * 8);
      const y = 4 + Math.floor(rng.next() * 9);
      for (let s = 0; s < 4; s++) b.set(x + s, y + (s >> 1), s === 0 || s === 3 ? bone : boneD);
      b.blend(x + 1, y + 2, SH);
    }
  });
}

function straw(rng) {
  return sprite((b) => {
    for (let k = 0; k < 6; k++) {
      const x = 1 + Math.floor(rng.next() * 12);
      const y = 2 + Math.floor(rng.next() * 12);
      const c = rgb(rng.next() < 0.5 ? '#d9b65a' : '#b38f3e');
      const dx = rng.next() < 0.5 ? 1 : -1;
      for (let s = 0; s < 3; s++) b.set(x + s, y + (s * dx) / 2, c);
    }
  });
}

function fern(rng) {
  return sprite((b) => {
    const cx = 8;
    const cy = 12;
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k - 2) * 0.55;
      for (let s = 0; s < 7; s++) {
        const x = Math.round(cx + Math.cos(a) * s);
        const y = Math.round(cy + Math.sin(a) * s * 0.8);
        b.set(x, y, rgb(s > 4 ? '#7fb85a' : '#3f7a3a'));
        if (s > 1 && s < 6) {
          b.set(x + (k < 2 ? -1 : 1), y, rgb('#2f6338'));
        }
      }
    }
    b.blend(cx, cy + 1, SH);
    b.blend(cx + 1, cy + 1, SH);
  });
}

function cabbage(rng) {
  return sprite((b) => {
    const cx = 6 + rng.next() * 4;
    const cy = 8 + rng.next() * 3;
    b.ellipse(cx + 1, cy + 2, 4.5, 2, () => rgb('#000000', 60));
    b.ellipse(cx, cy, 4.5, 3.4, (x, y, nx, ny, d) => {
      if (d > 0.75) return rgb(nx < 0 ? '#3f8a3e' : '#2b5f2f');
      return rgb(ny + nx < -0.6 ? '#b4e08a' : ny < 0 ? '#8cc46a' : '#5e9e4c');
    });
    b.set(Math.round(cx), Math.round(cy), rgb('#d4f0a6'));
  });
}

function puddle(rng) {
  return sprite((b) => {
    const cx = 7 + rng.next() * 2;
    const cy = 8 + rng.next() * 2;
    b.ellipse(cx, cy, 5 + rng.next(), 2.5 + rng.next() * 0.8, (x, y, nx, ny, d) => {
      if (d > 0.7) return rgb('#4a3424');
      return rgb(ny < -0.2 && nx < 0.3 ? '#a8c4dc' : '#5a7898');
    });
  });
}

function ash(rng) {
  return sprite((b) => {
    b.ellipse(8, 8, 7, 5, (x, y, nx, ny, d) => {
      if (d > 0.9 && (x + y) & 1) return 0;
      const ember = ((x * 7 + y * 13) % 23 === 0) ? rgb('#ee7f2d') : 0;
      return ember || rgb(d < 0.4 ? '#1e1a1c' : d < 0.7 ? '#2e2828' : '#3d3330', d < 0.7 ? 200 : 120);
    });
  });
}

// deco id -> array of PixelBuf variants.
export function buildDecos(rng) {
  const many = (n, fn) => Array.from({ length: n }, (_, k) => fn(rng.fork(1000 + k * 7 + n)));
  const D = [];
  D[DECO.FLOWERS] = many(6, (r) => flowers(r, 3 + Math.floor(r.next() * 3), false));
  D[DECO.WILDFLOWERS] = many(6, (r) => flowers(r, 5 + Math.floor(r.next() * 4), true));
  D[DECO.CLOVER] = many(3, clover);
  D[DECO.TUFT] = many(4, (r) => tuft(r));
  D[DECO.PEBBLES] = many(4, (r) => pebbles(r));
  D[DECO.MUSHROOM] = many(4, mushrooms);
  D[DECO.ROOTS] = many(3, roots);
  D[DECO.LEAVES] = many(4, leaves);
  D[DECO.MOSS] = many(3, moss);
  D[DECO.LILY] = many(4, lily);
  D[DECO.REEDS] = many(4, reeds);
  D[DECO.CRACK] = many(4, crack);
  D[DECO.BONES] = many(3, bones);
  D[DECO.STRAW] = many(3, straw);
  D[DECO.FERN] = many(3, fern);
  D[DECO.CABBAGE] = many(3, cabbage);
  D[DECO.PUDDLE] = many(3, puddle);
  D[DECO.ASH] = many(2, ash);
  return D;
}
