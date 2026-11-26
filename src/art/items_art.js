import { OUTLINE, RAMPS } from './palette.js';
import { ITEMS } from '../entities/items.js';

// 16x16 item icons, painted in code at boot: one 'icon:<itemId>' sprite per item in
// entities/items.js plus 'icon:unknown'. Each icon is built on a tiny pixel grid with
// shaded shapes (light from the upper left), then given the shared dark outline.
// Sprites are anchored at the bottom of the art so pickups rest on their shadow.

const N = 16;
const LIGHT_X = -0.6;
const LIGHT_Y = -0.8;

// Bayer thresholds for the few places that dither.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x, y) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

class Painter {
  constructor() {
    this.px = new Array(N * N).fill(null);
    this.after = []; // [x, y, color] drawn after the outline (glints, steam)
  }

  set(x, y, c) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (!c || x < 0 || y < 0 || x >= N || y >= N) return;
    this.px[y * N + x] = c;
  }

  get(x, y) {
    if (x < 0 || y < 0 || x >= N || y >= N) return null;
    return this.px[y * N + x];
  }

  clear(x, y) {
    if (x >= 0 && y >= 0 && x < N && y < N) this.px[y * N + x] = null;
  }

  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  line(x0, y0, x1, y1, c) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.set(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), c);
    }
  }

  // Lit sphere/ellipse: ramp runs dark -> light. clip(x, y) may exclude pixels.
  blob(cx, cy, rx, ry, ramp, clip = null, spec = true, dither = false) {
    let best = -9;
    let bx = -1;
    let by = -1;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        const d2 = nx * nx + ny * ny;
        if (d2 > 1 || (clip && !clip(x, y))) continue;
        const nz = Math.sqrt(1 - d2);
        const lum = nx * LIGHT_X * 0.62 + ny * LIGHT_Y * 0.62 + nz * 0.48;
        const t = Math.max(0, Math.min(1, (lum + 0.25) / 1.05));
        const f = t * (ramp.length - 1);
        let i = Math.floor(f);
        if (dither ? f - i > bayer(x, y) : f - i >= 0.5) i = Math.min(ramp.length - 1, i + 1);
        this.set(x, y, ramp[i]);
        if (lum > best) {
          best = lum;
          bx = x;
          by = y;
        }
      }
    }
    return spec ? { x: bx, y: by } : null;
  }

  // Any shape: mask(px, py) at pixel centers. Shading from the gradient of a blurred
  // mask, so edges facing the light brighten and edges facing away darken.
  shape(mask, ramp, { k = 1.4, bias = 0 } = {}) {
    const inside = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (mask(x + 0.5, y + 0.5)) inside[y * N + x] = 1;
    const at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N ? 0 : inside[y * N + x]);
    const h = (x, y) => {
      let s = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += at(x + i, y + j);
      return s / 9;
    };
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (!inside[y * N + x]) continue;
        const gx = h(x + 1, y) - h(x - 1, y);
        const gy = h(x, y + 1) - h(x, y - 1);
        const lum = -(gx * LIGHT_X + gy * LIGHT_Y);
        const t = Math.max(0, Math.min(1, 0.5 + bias + lum * k));
        this.set(x, y, ramp[Math.round(t * (ramp.length - 1))]);
      }
    }
    return inside;
  }

  // A pointed leaf/petal: lens shape along `angle`, light side, dark side and a rib.
  leaf(cx, cy, len, wid, angle, c) {
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const u = dx * ca + dy * sa;
        const v = -dx * sa + dy * ca;
        const lim = wid * (1 - (u * u) / (len * len));
        if (lim <= 0 || Math.abs(v) > lim) continue;
        // Which side faces the light depends on the leaf's orientation.
        const side = v * (-sa * LIGHT_X + ca * LIGHT_Y) < 0 ? 1 : -1;
        let col = Math.abs(v) < 0.45 && c.rib ? c.rib : side > 0 ? c.light : c.dark;
        if (Math.abs(v) >= 0.45 && Math.abs(v) < lim * 0.5 && side > 0 && c.mid) col = c.mid;
        this.set(x, y, col);
      }
    }
  }

  // Shift the art so it keeps a 1 px margin (room for the outline), outline it on
  // the grid, and paint it. Returns { canvas, base } (base = row below the outline).
  toCanvas() {
    let x0 = N;
    let y0 = N;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (!this.px[y * N + x]) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    let dx = 0;
    let dy = 0;
    if (x1 >= 0) {
      if (x0 < 1) dx = 1 - x0;
      else if (x1 > N - 2) dx = N - 2 - x1;
      if (y0 < 1) dy = 1 - y0;
      else if (y1 > N - 2) dy = N - 2 - y1;
    }
    const grid = new Array(N * N).fill(null);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const c = this.px[y * N + x];
        const nx = x + dx;
        const ny = y + dy;
        if (c && nx >= 0 && ny >= 0 && nx < N && ny < N) grid[ny * N + nx] = c;
      }
    }
    const filled = (x, y) => x >= 0 && y >= 0 && x < N && y < N && !!grid[y * N + x];
    const canvas = document.createElement('canvas');
    canvas.width = N;
    canvas.height = N;
    const ctx = canvas.getContext('2d');
    let base = 0;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let c = grid[y * N + x];
        if (!c && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1))) c = OUTLINE;
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(x, y, 1, 1);
        base = Math.max(base, y + 1);
      }
    }
    for (const [x, y, c] of this.after) {
      ctx.fillStyle = c;
      ctx.fillRect(x + dx, y + dy, 1, 1);
    }
    return { canvas, base };
  }
}

// ---- shape helpers (pixel-center coordinates) ----

const ellipseMask = (cx, cy, rx, ry) => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

function segDist(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2));
  return { d: Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t)), t };
}

const capsule = (x0, y0, x1, y1, r) => (x, y) => segDist(x, y, x0, y0, x1, y1).d <= r;
// Capsule whose radius tapers from r0 at the start to r1 at the end.
const taper = (x0, y0, x1, y1, r0, r1) => (x, y) => {
  const s = segDist(x, y, x0, y0, x1, y1);
  return s.d <= r0 + (r1 - r0) * s.t;
};
const union =
  (...ms) =>
  (x, y) =>
    ms.some((m) => m(x, y));

// Points along a quadratic curve, for horns, antlers and tusks.
function bezier(p0, p1, p2, n = 40) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    pts.push({ x: a * p0[0] + b * p1[0] + c * p2[0], y: a * p0[1] + b * p1[1] + c * p2[1], t });
  }
  return pts;
}

// Hand-placed pixels: one string per row, one character per pixel ('.' = empty).
function rows(p, lines, colors) {
  for (let y = 0; y < lines.length; y++) {
    for (let x = 0; x < lines[y].length; x++) {
      const c = colors[lines[y][x]];
      if (c) p.set(x, y, c);
    }
  }
}

function inPolygon(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Nearest curve point to (x, y): { d, t, side } (side: which side of the curve).
function nearestOnCurve(pts, x, y) {
  let best = null;
  let bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  const p = pts[best];
  const q = pts[Math.min(pts.length - 1, best + 1)];
  const r = pts[Math.max(0, best - 1)];
  const tx = q.x - r.x;
  const ty = q.y - r.y;
  const side = Math.sign(tx * (y - p.y) - ty * (x - p.x));
  return { d: bd, t: p.t, side };
}

const hash = (x, y, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---- palettes ----

const GOLD = RAMPS.gold;
const WOOD = RAMPS.wood;
const STONE = RAMPS.stone;
const IRON = RAMPS.iron;
const ARC = RAMPS.arcane;
const LEAF = RAMPS.leaf;
const BONE = RAMPS.bone;
const SLIME = RAMPS.slime;
const SAND = RAMPS.sand;
const WHITE = '#ffffff';
const CREAM_HI = '#fff6c8';

// ---- icons ----

const ICONS = {
  coin(p) {
    // The coin's edge shows a little below and right of its face.
    p.blob(8.5, 8.6, 5.1, 5.4, [GOLD[0], GOLD[1], GOLD[1]], null, false);
    p.blob(7.8, 8, 4.7, 5.1, [GOLD[2], GOLD[3], GOLD[3], GOLD[4]], null, false);
    // Bevelled rim: bright where it faces the light, dark where it turns away.
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const ux = (x + 0.5 - 7.8) / 4.7;
        const uy = (y + 0.5 - 8) / 5.1;
        const d = Math.hypot(ux, uy);
        if (d > 0.62 && d < 0.8) p.set(x, y, ux + uy < 0 ? GOLD[2] : GOLD[4]);
      }
    }
    // A raised bar across the middle, like the stamp on Hearthvale silver.
    for (let y = 6; y <= 10; y++) {
      p.set(8, y, GOLD[2]);
      p.set(7, y, y === 6 ? GOLD[4] : GOLD[3]);
    }
    p.set(5, 5, CREAM_HI);
    p.set(5, 6, CREAM_HI);
    p.set(6, 4, GOLD[4]);
  },

  wood(p) {
    const bark = [WOOD[1], WOOD[2], WOOD[3], WOOD[3], WOOD[4]];
    const log = (x0, x1, y0, capX) => {
      for (let y = y0; y < y0 + 5; y++) {
        for (let x = x0; x <= x1; x++) {
          if ((y === y0 || y === y0 + 4) && x === x0) continue;
          let c = bark[4 - (y - y0)];
          if (hash(x, y, 3) < 0.22 && y > y0) c = WOOD[1];
          p.set(x, y, c);
        }
      }
      // End grain: bark ring, pale wood, growth ring, dark pith.
      for (let y = y0; y < y0 + 5; y++) {
        for (let x = capX - 2; x <= capX + 2; x++) {
          const d = Math.hypot((x + 0.5 - (capX + 0.5)) / 2.1, (y + 0.5 - (y0 + 2.5)) / 2.6);
          if (d > 1) continue;
          p.set(x, y, d > 0.8 ? WOOD[2] : d > 0.55 ? '#d6ad7c' : d > 0.3 ? '#b98d5e' : '#9a7049');
        }
      }
    };
    log(1, 9, 9, 10);
    log(4, 11, 3, 12);
    p.set(3, 11, WOOD[0]);
    p.set(7, 5, WOOD[0]);
    p.set(12, 4, '#f2d2a0');
    p.set(10, 10, '#f2d2a0');
  },

  stone(p) {
    p.blob(7.4, 9.6, 5.4, 4.2, [STONE[1], STONE[2], STONE[3], STONE[4], STONE[5]], (x, y) => y < 13);
    p.blob(10.2, 8.4, 3.4, 3.2, [STONE[2], STONE[3], STONE[4], STONE[4]], (x, y) => y < 13);
    p.set(9, 8, STONE[1]);
    p.set(9, 9, STONE[2]);
    p.set(10, 10, STONE[1]);
    p.set(10, 11, STONE[2]);
    p.set(5, 11, STONE[2]);
    p.set(4, 8, STONE[5]);
    p.set(5, 7, '#dcdbe6');
  },

  iron_ore(p) {
    const ramp = ['#262433', '#3a3849', '#4a4758', '#5e5a6c', '#77738a'];
    p.blob(7.6, 9.4, 5.6, 4.4, ramp, (x, y) => y < 13);
    p.blob(10.4, 8.2, 3.2, 3.2, ramp.slice(1), (x, y) => y < 13);
    // Rust-red ore veins with bright metal glints.
    const veins = [
      [5, 8, '#c4501f'],
      [6, 8, '#86301b'],
      [6, 9, '#c4501f'],
      [7, 10, '#86301b'],
      [10, 7, '#c4501f'],
      [11, 8, '#86301b'],
      [10, 11, '#c4501f'],
      [11, 11, '#86301b'],
      [4, 11, '#86301b'],
    ];
    for (const [x, y, c] of veins) p.set(x, y, c);
    p.set(5, 7, '#ee7f2d');
    p.set(10, 6, '#ffb047');
    p.set(9, 10, IRON[4]);
    p.set(6, 11, IRON[3]);
    p.set(4, 7, '#9593a6');
  },

  crystal(p) {
    // A cluster of three shards on a scrap of rock.
    p.blob(8, 12.6, 5.4, 2, [STONE[1], STONE[2], STONE[3]], (x, y) => y < 14, false);
    const shard = (cx, top, bottom, w, lean) => {
      for (let y = top; y <= bottom; y++) {
        const k = Math.min(1, (y - top + 0.5) / 2.2); // pointed tip
        const c = cx + lean * (bottom - y);
        for (let x = 0; x < N; x++) {
          const dx = x + 0.5 - c;
          if (Math.abs(dx) > w * k) continue;
          const col = dx < -w * 0.3 ? ARC[5] : dx > w * 0.35 ? ARC[2] : ARC[3];
          p.set(x, y, col);
        }
      }
    };
    shard(4.5, 6, 12, 1.6, -0.25);
    shard(11.5, 5, 12, 1.6, 0.25);
    shard(8, 1, 12, 2.1, 0);
    p.set(7, 3, WHITE);
    p.set(7, 4, ARC[5]);
    p.set(3, 8, WHITE);
    p.set(11, 7, ARC[5]);
    p.after.push([13, 3, '#ddd2ff']);
  },

  herb(p) {
    const c = { light: '#b8d8a0', mid: '#8fbf6a', dark: '#3e7a3c', rib: '#e2f0d0' };
    p.line(8, 13, 8, 8, LEAF[3]);
    p.line(8, 12, 5, 9, LEAF[3]);
    p.line(8, 12, 11, 9, LEAF[3]);
    p.leaf(4.8, 7.2, 4.0, 1.7, (-135 * Math.PI) / 180, c);
    p.leaf(11.2, 7.2, 4.0, 1.7, (-45 * Math.PI) / 180, c);
    p.leaf(8, 5, 4.4, 1.9, -Math.PI / 2, c);
    // Twine around the stems.
    p.set(7, 11, '#cf9f66');
    p.set(8, 11, '#e2c08a');
    p.set(9, 11, '#ad7a48');
    p.set(8, 13, LEAF[2]);
  },

  moonpetal(p) {
    p.line(8, 10, 8, 14, LEAF[3]);
    p.leaf(10.4, 12.2, 2.4, 1.1, (-25 * Math.PI) / 180, { light: LEAF[4], dark: LEAF[2], rib: LEAF[5] });
    const c = { light: WHITE, mid: '#f0eef5', dark: '#a995ff', rib: '#ddd2ff' };
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      p.leaf(8 + Math.cos(a) * 2.8, 7 + Math.sin(a) * 2.8, 2.9, 1.8, a, c);
    }
    p.rect(7, 6, 2, 2, '#ffe27a');
    p.set(7, 6, CREAM_HI);
    p.set(8, 7, '#e4b83d');
    p.after.push([3, 2, '#ddd2ff'], [13, 4, '#ffffff']);
  },

  berries(p) {
    const ramp = ['#3a0d16', '#6b1424', '#9e2133', '#cc3a45'];
    p.leaf(6, 4.6, 3, 1.4, (-160 * Math.PI) / 180, { light: LEAF[4], dark: LEAF[2], rib: LEAF[3] });
    p.leaf(10.2, 4.4, 3, 1.4, (-20 * Math.PI) / 180, { light: LEAF[4], dark: LEAF[2], rib: LEAF[3] });
    p.line(8, 5, 8, 7, LEAF[1]);
    const berry = (cx, cy) => {
      const s = p.blob(cx, cy, 2.5, 2.5, ramp, null, true);
      if (s) p.set(s.x, s.y, '#f6b3b8');
    };
    berry(8.2, 8.4);
    berry(5.4, 10.4);
    berry(10.8, 10.2);
    berry(8, 12.4);
  },

  turnip(p) {
    const leafC = { light: LEAF[4], dark: LEAF[2], rib: LEAF[5] };
    p.leaf(5.9, 3.7, 3, 1.3, (-125 * Math.PI) / 180, leafC);
    p.leaf(10.1, 3.7, 3, 1.3, (-55 * Math.PI) / 180, leafC);
    p.leaf(8, 3, 2.6, 1.2, -Math.PI / 2, leafC);
    const cream = [BONE[1], BONE[2], BONE[3], BONE[4]];
    const purple = ['#2c1a40', '#47296a', '#6a4196', '#9a6bc4'];
    p.blob(8, 9.6, 4.6, 3.9, cream, null, false);
    // Purple shoulders: recolor the top of the bulb with the same lighting.
    for (let y = 5; y < 9; y++) {
      for (let x = 0; x < N; x++) {
        const c = p.get(x, y);
        if (!c) continue;
        const i = cream.indexOf(c);
        if (i < 0) continue;
        if (y === 8 && bayer(x, y) < 0.5) continue;
        p.set(x, y, purple[i]);
      }
    }
    p.set(8, 14, BONE[2]);
    p.set(5, 7, '#c9a0ea');
    p.set(9, 11, BONE[2]);
  },

  wheat(p) {
    // An upright ear of wheat: kernels staggered on both sides of the spine, with
    // one-pixel gaps that the outline turns into crisp separations.
    rows(p, [
      '................',
      '................',
      '.......HK.......',
      '.......Kk.......',
      '......HKs.......',
      '......Kks.Kk....',
      '........skd.....',
      '......HKs.......',
      '......Kks.Kk....',
      '........skd.....',
      '......HKs.......',
      '......Kks.Kk....',
      '.....LL.skd.....',
      '....lLLLs.......',
      '........d.......',
      '................',
    ], { H: GOLD[4], K: GOLD[3], k: GOLD[2], d: GOLD[1], s: '#b58726', L: '#d8c470', l: '#8a7420' });
    p.after.push([6, 1, '#f2d890'], [9, 1, '#e4c46a'], [5, 3, '#f2d890'], [10, 4, '#c9a24a'], [5, 6, '#f2d890'], [12, 7, '#c9a24a']);
  },

  raw_fish(p) {
    fishBody(p, ['#1e3a52', '#2f5f7a', '#5b8fa8', '#9cc7d6', '#d8eef2'], '#2f5f7a');
    for (let x = 4; x <= 9; x++) if (p.get(x, 8)) p.set(x, 8, x % 2 ? '#e0959a' : '#d98088');
    for (const [x, y] of [
      [6, 6],
      [8, 6],
      [10, 7],
    ])
      p.set(x, y, '#1e3a52');
    p.set(3, 7, '#141219');
    p.set(5, 9, '#d8eef2');
  },

  cooked_fish(p) {
    p.line(1, 12, 3, 10, WOOD[4]);
    p.set(1, 13, WOOD[3]);
    fishBody(p, ['#3d2619', '#6b412a', '#ad7a48', '#d99a4a', '#f2c27a'], '#6b412a');
    for (let k = 0; k < 4; k++) {
      if (p.get(5 + k, 10 - k)) p.set(5 + k, 10 - k, '#3d2619');
      if (p.get(8 + k, 10 - k)) p.set(8 + k, 10 - k, '#3d2619');
    }
    p.set(3, 7, '#e2d2b0');
    p.set(6, 6, '#f2c27a');
  },

  bread(p) {
    const crust = ['#4a2c20', '#7a4a24', '#b0702e', '#d99a4a', '#f2c27a'];
    p.blob(8, 9.6, 6.4, 4.2, crust, (x, y) => y < 13);
    for (let x = 2; x <= 13; x++) if (p.get(x, 12)) p.set(x, 12, crust[1]);
    for (const sx of [4, 7, 10]) {
      p.set(sx, 9, '#f2dcae');
      p.set(sx + 1, 8, '#f2dcae');
      p.set(sx + 2, 7, '#e8c890');
      p.set(sx + 1, 9, crust[1]);
      p.set(sx + 2, 8, crust[1]);
    }
    p.set(4, 7, '#fbe6b8');
  },

  honey_cake(p) {
    // Sponge sides with a cream layer.
    for (let y = 8; y <= 12; y++) {
      for (let x = 3; x <= 12; x++) {
        let c = x <= 4 ? '#e8b060' : x >= 11 ? '#b0702e' : '#d99a4a';
        if (y === 10) c = x >= 11 ? '#e2d2b0' : '#f6eedd';
        if (y === 12) c = x >= 11 ? '#7a4a24' : '#8c5a35';
        p.set(x, y, c);
      }
    }
    // Honey glaze on top, dripping down the sides.
    p.blob(7.9, 7.6, 5.2, 2.1, [GOLD[2], GOLD[3], GOLD[3], GOLD[4]], null, false);
    for (const [x, y] of [
      [4, 9],
      [4, 10],
      [7, 9],
      [10, 9],
      [10, 10],
      [10, 11],
    ])
      p.set(x, y, y > 9 ? GOLD[2] : GOLD[3]);
    p.set(5, 7, CREAM_HI);
    // A berry on top.
    p.set(8, 5, '#cc3a45');
    p.set(9, 5, '#9e2133');
    p.set(8, 4, '#f6b3b8');
    p.set(9, 4, LEAF[4]);
  },

  stew(p) {
    const bowl = [WOOD[1], WOOD[2], WOOD[3], WOOD[4]];
    p.shape((x, y) => y >= 8 && y <= 13 && ((x - 8) / 6.2) ** 2 + ((y - 8) / 5.2) ** 2 <= 1, bowl, { k: 1.6 });
    for (let x = 2; x <= 13; x++) p.set(x, 8, x < 6 ? WOOD[5] : WOOD[4]);
    p.rect(6, 13, 4, 1, WOOD[1]);
    // The stew itself, with carrot, potato and a sprig of herb.
    for (let x = 3; x <= 12; x++) p.set(x, 7, x < 6 ? '#a85a2e' : '#8a4422');
    p.set(4, 8, '#7a3b1e');
    p.set(5, 7, '#ee7f2d');
    p.set(9, 7, '#ee7f2d');
    p.set(7, 7, '#f2e3b9');
    p.set(11, 7, LEAF[4]);
    p.set(10, 6, LEAF[3]);
    p.set(6, 6, '#c4501f');
    p.set(8, 6, '#8a4422');
    const steam = 'rgba(244, 234, 215, 0.7)';
    p.after.push([5, 4, steam], [6, 3, steam], [5, 2, steam], [9, 4, steam], [10, 3, steam], [9, 2, steam], [10, 1, steam]);
  },

  potion(p) {
    const red = ['#6b1424', '#9e2133', '#cc3a45', '#ff6b6b', '#ffb3b3'];
    const glass = ['#3a5a6a', '#6f9aa8', '#b8dde6', '#e8f6fa'];
    p.blob(8, 10, 4.7, 4.3, glass, (x, y) => y < 9, false);
    p.blob(8, 10, 4.7, 4.3, red, (x, y) => y >= 9, false);
    for (let x = 0; x < N; x++) if (p.get(x, 9)) p.set(x, 9, x < 8 ? '#ff8a8a' : '#e85a5a');
    p.rect(7, 4, 2, 2, '#b8dde6');
    p.set(8, 5, '#6f9aa8');
    p.set(8, 4, '#6f9aa8');
    p.rect(6, 2, 4, 2, '#8c5a35');
    p.set(6, 2, '#ad7a48');
    p.set(7, 2, '#cf9f66');
    p.set(9, 3, '#6b412a');
    p.set(5, 9, WHITE);
    p.set(5, 10, '#ffd0d0');
    p.set(6, 7, WHITE);
    p.set(10, 12, '#ff8a8a');
  },

  wolf_pelt(p) {
    const fur = ['#2b2b35', '#474756', '#6a6a7c', '#8e8ea0', '#b4b4c4'];
    const mask = union(
      ellipseMask(8, 8.2, 4.4, 5),
      taper(5, 5.5, 2, 3, 1.4, 0.8),
      taper(11, 5.5, 14, 3, 1.4, 0.8),
      taper(5, 11, 2, 13.4, 1.4, 0.8),
      taper(11, 11, 14, 13.4, 1.4, 0.8),
      capsule(8, 3.5, 8, 2, 1.7),
      taper(8, 12.5, 9.5, 14.4, 1, 0.6),
    );
    p.shape(mask, fur, { k: 1.5 });
    // Darker saddle down the back and a few tufts.
    for (let y = 3; y <= 12; y++) if (p.get(8, y)) p.set(8, y, y % 3 ? '#3a3a48' : '#474756');
    for (let y = 4; y <= 11; y++) if (p.get(7, y) && hash(7, y) < 0.5) p.set(7, y, '#555566');
    p.set(6, 2, fur[3]);
    p.set(10, 2, fur[3]);
    p.set(5, 7, '#c8c8d6');
    p.set(10, 9, fur[1]);
  },

  slime_gel(p) {
    const s = p.blob(8, 10, 5.2, 4.4, SLIME, (x, y) => y < 14);
    for (let x = 3; x <= 13; x++) if (p.get(x, 13)) p.set(x, 13, SLIME[1]);
    p.set(12, 13, SLIME[2]);
    p.set(12, 14, SLIME[1]);
    p.set(9, 10, SLIME[4]);
    p.set(10, 11, SLIME[4]);
    p.set(10, 10, '#d8ffc8');
    if (s) p.set(s.x, s.y, '#efffe6');
    p.set(5, 8, '#efffe6');
  },

  bone(p) {
    const mask = union(
      capsule(4.6, 11.4, 11.4, 4.6, 1.25),
      ellipseMask(11.2, 2.9, 1.8, 1.8),
      ellipseMask(13.1, 4.8, 1.8, 1.8),
      ellipseMask(2.9, 11.2, 1.8, 1.8),
      ellipseMask(4.8, 13.1, 1.8, 1.8),
    );
    p.shape(mask, [BONE[1], BONE[2], BONE[3], BONE[4]], { k: 1.6, bias: 0.05 });
  },

  iron_sword(p) {
    const blade = union(capsule(6.2, 9.8, 12.4, 3.6, 1.05), capsule(12.4, 3.6, 13.4, 2.6, 0.55));
    p.shape(blade, [IRON[1], IRON[2], IRON[3], IRON[4]], { k: 1.8 });
    // A bright fuller down the blade.
    for (let k = 0; k < 6; k++) p.set(7 + k, 8 - k, k < 4 ? IRON[4] : '#e8ecf2');
    p.shape(capsule(4.6, 11.4, 3.2, 12.8, 0.8), ['#2a1a16', '#4a2c20', '#6b412a', '#8c5a35'], { k: 1.6 });
    p.shape(capsule(3.4, 8.4, 7.6, 12.6, 0.85), [GOLD[1], GOLD[2], GOLD[3], GOLD[4]], { k: 1.8 });
    p.shape(ellipseMask(2.5, 13.5, 1.3, 1.3), [GOLD[1], GOLD[2], GOLD[3], GOLD[4]], { k: 1.6 });
    p.after.push([14, 1, '#ffffff']);
  },

  ruins_key(p) {
    const dark = ['#2b2e37', '#474b57', '#6b707e', '#9aa0ad'];
    const ring = (x, y) => {
      const d = Math.hypot(x - 4.6, y - 4.6);
      return d <= 3.3 && d >= 1.5;
    };
    const mask = union(ring, capsule(6.6, 6.6, 12.4, 12.4, 0.95), capsule(10.4, 10.4, 8.6, 12.2, 0.75), capsule(12.2, 12.2, 10.4, 14, 0.75));
    p.shape(mask, dark, { k: 1.7 });
    // Rust bloom over the old iron.
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (!p.get(x, y)) continue;
        const h = hash(x, y, 7);
        if (h < 0.18) p.set(x, y, '#a8452a');
        else if (h < 0.3) p.set(x, y, '#7a2c1c');
      }
    }
    p.set(3, 2, '#cfd4dc');
    p.set(2, 3, '#9aa0ad');
    p.set(8, 8, '#9aa0ad');
  },

  // Keys and the flame-book of round 14 (src/world/containers.js, the Count).
  guard_key(p) {
    const iron = ['#2b2e37', '#474b57', '#6b707e', '#aab0bc'];
    const ring = (x, y) => {
      const d = Math.hypot(x - 4.6, y - 4.6);
      return d <= 3.3 && d >= 1.6;
    };
    p.shape(union(ring, capsule(6.6, 6.6, 12.4, 12.4, 0.95), capsule(10.4, 10.4, 8.6, 12.2, 0.75), capsule(12.2, 12.2, 10.4, 14, 0.75)), iron, { k: 1.7 });
    p.set(3, 2, '#e6e9ee');
    p.set(8, 8, '#cfd4dc');
  },

  lyra_trunk_key(p) {
    const ring = (x, y) => {
      const d = Math.hypot(x - 5, y - 5);
      return d <= 2.8 && d >= 1.3;
    };
    p.shape(union(ring, capsule(6.8, 6.8, 11.8, 11.8, 0.85), capsule(10.2, 10.2, 8.8, 11.6, 0.7)), [GOLD[1], GOLD[2], GOLD[3], GOLD[4]], { k: 1.7 });
    // A violet thread through the bow.
    for (const [x, y] of [
      [2, 6],
      [1, 7],
      [1, 8],
      [2, 9],
    ])
      p.set(x, y, ARC[3]);
    p.set(4, 3, '#fff3c2');
  },

  // Lyra's letter (round 14b T-5): a folded sheet, a violet wax drop of her light.
  lyra_letter(p) {
    p.rect(3, 5, 11, 8, '#e8dcbc');
    for (let x = 3; x <= 13; x++) {
      p.set(x, 5, '#f4ead0');
      p.set(x, 12, '#b9a780');
    }
    for (let y = 5; y <= 12; y++) {
      p.set(3, y, '#cbbb94');
      p.set(13, y, '#b9a780');
    }
    // The fold, corner to middle.
    for (let i = 0; i <= 4; i++) {
      p.set(3 + i, 6 + Math.floor(i / 1.4), '#c9b893');
      p.set(13 - i, 6 + Math.floor(i / 1.4), '#c9b893');
    }
    // A line of her hand, and the seal.
    for (let x = 5; x <= 10; x += 2) p.set(x, 10, '#6d5a8a');
    p.set(8, 9, '#7a64e0');
    p.set(8, 10, '#9b84f0');
    p.set(7, 9, '#5a48b0');
    p.set(9, 9, '#5a48b0');
  },

  flame_book(p) {
    p.rect(4, 3, 10, 11, '#d8c9a8');
    for (let y = 4; y <= 13; y += 2) p.set(13, y, '#a89676');
    for (let y = 2; y <= 12; y++) {
      for (let x = 3; x <= 12; x++) {
        let c = '#5a3b27';
        if (y === 2 || x === 5) c = '#704b32';
        if (y === 12 || x === 12) c = '#3a2418';
        if (x <= 4) c = x === 3 ? '#2a1a12' : '#3a2418';
        p.set(x, y, c);
      }
    }
    // A candle-flame tooled into the cover, the gilt worn grey.
    for (const [x, y, c] of [
      [8, 4, '#c9b27a'],
      [8, 5, '#d9c48a'],
      [7, 6, '#c9b27a'],
      [8, 6, '#efe0a8'],
      [9, 6, '#c9b27a'],
      [7, 7, '#b39c66'],
      [8, 7, '#d9c48a'],
      [9, 7, '#b39c66'],
      [8, 8, '#8f7c52'],
      [8, 9, '#8f7c52'],
      [8, 10, '#8f7c52'],
    ])
      p.set(x, y, c);
  },

  maren_journal(p) {
    // Page block peeking out on the right and bottom.
    p.rect(4, 3, 10, 11, '#e2d2b0');
    for (let y = 4; y <= 13; y += 2) p.set(13, y, '#b5a184');
    for (let x = 5; x <= 12; x += 2) p.set(x, 13, '#b5a184');
    // Teal leather cover.
    for (let y = 2; y <= 12; y++) {
      for (let x = 3; x <= 12; x++) {
        let c = '#1e5459';
        if (y === 2 || x === 5) c = '#2f7a7c';
        if (y === 12 || x === 12) c = '#12343a';
        if (x <= 4) c = x === 3 ? '#0e2a2f' : '#12343a';
        p.set(x, y, c);
      }
    }
    // Spine bands and Maren's star.
    for (const y of [4, 10]) {
      p.set(3, y, GOLD[2]);
      p.set(4, y, GOLD[3]);
    }
    for (const [x, y] of [
      [8, 4],
      [8, 5],
      [8, 9],
      [8, 10],
      [6, 7],
      [7, 7],
      [9, 7],
      [10, 7],
    ])
      p.set(x, y, ARC[4]);
    p.set(8, 6, ARC[5]);
    p.set(8, 8, ARC[5]);
    p.set(8, 7, WHITE);
    // A water stain blooming from the lower corner.
    for (let y = 9; y <= 11; y++) for (let x = 6; x <= 9; x++) if (bayer(x, y) < 0.45 && !(x === 8)) p.set(x, y, '#3f8a8a');
    // Brass clasp.
    p.rect(12, 6, 2, 3, GOLD[2]);
    p.set(12, 6, GOLD[4]);
    p.set(13, 7, GOLD[1]);
  },

  lantern(p) {
    for (let y = 0; y < 3; y++) {
      for (let x = 5; x <= 10; x++) {
        const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 3);
        if (d <= 2.3 && d >= 1.3) p.set(x, y, IRON[1]);
      }
    }
    p.rect(6, 3, 4, 1, IRON[3]);
    p.rect(5, 4, 6, 1, IRON[2]);
    p.set(6, 3, IRON[4]);
    // Glowing glass.
    for (let y = 5; y <= 10; y++) {
      for (let x = 5; x <= 10; x++) {
        const d = Math.hypot(x + 0.5 - 7.6, y + 0.5 - 7.8);
        p.set(x, y, d < 1.3 ? CREAM_HI : d < 2.3 ? '#ffe08a' : d < 3.2 ? '#ffb047' : '#ee7f2d');
      }
    }
    for (let y = 5; y <= 10; y++) {
      p.set(5, y, IRON[2]);
      p.set(10, y, IRON[1]);
    }
    p.rect(5, 11, 6, 1, IRON[2]);
    p.rect(6, 12, 4, 1, IRON[1]);
    p.set(5, 11, IRON[3]);
  },

  venison(p) {
    const meat = ['#4a1520', '#7a2232', '#ab3a45', '#d9636b', '#f2a0a0'];
    p.shape(union(capsule(10.5, 10.5, 12.6, 12.6, 1), ellipseMask(13.4, 12, 1.2, 1.2), ellipseMask(12, 13.4, 1.2, 1.2)), [BONE[1], BONE[2], BONE[3], BONE[4]], {
      k: 1.6,
    });
    p.blob(7, 7.4, 5.2, 4.4, meat, null, false);
    // Marbling.
    for (const [x, y] of [
      [5, 6],
      [6, 7],
      [7, 7],
      [8, 8],
      [9, 7],
      [6, 10],
    ])
      p.set(x, y, '#f6d0d0');
    p.set(4, 5, '#ffe0e0');
  },

  egg(p) {
    const ramp = [SAND[0], SAND[1], SAND[2], SAND[3], SAND[4]];
    // Narrower at the top than the bottom.
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const ny = (y + 0.5 - 8.6) / 5;
        const rx = 3.9 * (1 + 0.14 * ny);
        const nx = (x + 0.5 - 8) / rx;
        const d2 = nx * nx + ny * ny;
        if (d2 > 1) continue;
        const nz = Math.sqrt(1 - d2);
        const lum = nx * LIGHT_X * 0.62 + ny * LIGHT_Y * 0.62 + nz * 0.48;
        const t = Math.max(0, Math.min(1, (lum + 0.25) / 1.05));
        p.set(x, y, ramp[Math.round(t * (ramp.length - 1))]);
      }
    }
    for (const [x, y] of [
      [6, 9],
      [9, 11],
      [10, 7],
      [7, 12],
      [9, 5],
    ])
      p.set(x, y, '#8a6f4a');
    p.set(6, 6, '#fffaf0');
    p.set(6, 7, '#fbf3dc');
  },

  bat_wing(p) {
    // Wrist at the upper left; finger bones fan out to the tips; the membrane between
    // them sags into scallops.
    const wrist = [3, 4.5];
    const tips = [
      [13.6, 2.4],
      [13.6, 8.6],
      [9.6, 12.8],
      [4.6, 13.6],
    ];
    const poly = [wrist, ...tips, [2.2, 9.5]];
    const scallops = [
      [(tips[1][0] + tips[2][0]) / 2 + 1.6, (tips[1][1] + tips[2][1]) / 2 + 1.6, 2.6],
      [(tips[2][0] + tips[3][0]) / 2 + 0.4, (tips[2][1] + tips[3][1]) / 2 + 2.1, 2.5],
      [(tips[0][0] + tips[1][0]) / 2 + 2.4, (tips[0][1] + tips[1][1]) / 2, 2.6],
    ];
    const mem = ['#2c1a40', '#3a2256', '#47296a', '#5a3584', '#6a4196'];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        if (!inPolygon(poly, px, py)) continue;
        if (scallops.some(([cx, cy, r]) => Math.hypot(px - cx, py - cy) < r)) continue;
        const d = Math.hypot(px - wrist[0], py - wrist[1]) / 12;
        p.set(x, y, mem[Math.max(0, Math.min(4, Math.round((1 - d) * 4)))]);
      }
    }
    const bone = '#a98cc8';
    p.line(3, 4, 13, 2, '#c8b6e0');
    for (const [tx, ty] of tips.slice(1)) p.line(3, 5, Math.round(tx - 0.5), Math.round(ty - 0.5), bone);
    p.set(2, 3, '#ded5bd');
    p.set(3, 4, '#ded5bd');
  },

  boar_tusk(p) {
    const pts = bezier([4.4, 13.4], [2.6, 4.2], [12.6, 2.6]);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const n = nearestOnCurve(pts, x + 0.5, y + 0.5);
        const w = 1.9 * (1 - n.t) + 0.35;
        if (n.d > w) continue;
        let c = n.side < 0 ? BONE[4] : n.d > w * 0.45 ? BONE[2] : BONE[3];
        if (n.t < 0.16) c = n.side < 0 ? '#b8ad95' : '#8a7f6c';
        else if (n.t < 0.2) c = '#5b5246';
        p.set(x, y, c);
      }
    }
    p.after.push([13, 2, '#ffffff']);
  },

  antler(p) {
    // A curved main beam with tines rising from it, ivory at the tips, dark at the burr.
    const mask = union(
      taper(3, 13, 8, 12.6, 1.35, 1.1),
      taper(8, 12.6, 11.6, 10, 1.1, 0.9),
      taper(11.6, 10, 12.8, 2.6, 0.9, 0.5),
      taper(5.6, 12.4, 4.2, 6, 0.95, 0.45),
      taper(8.8, 12, 8.6, 4.2, 0.9, 0.45),
    );
    p.shape(mask, ['#5b5246', '#8a7f6c', '#b8ad95', '#ded5bd'], { k: 1.6, bias: 0.05 });
    for (const [x, y] of [
      [4, 6],
      [8, 4],
      [12, 2],
      [12, 3],
    ])
      if (p.get(x, y)) p.set(x, y, '#f6f0de');
    p.blob(3, 13, 1.7, 1.5, ['#3d352c', '#5b5246', '#6e6455'], null, false);
  },

  candle(p) {
    // A pale beeswax taper in a little brass dish, lit.
    const wax = ['#a8874a', '#d8b870', '#eed69a', '#fbeec4', '#fffbe6'];
    for (let y = 5; y <= 12; y++) for (let x = 6; x <= 9; x++) p.set(x, y, wax[x === 6 ? 3 : x === 9 ? 1 : 2 + (y < 7 ? 1 : 0)]);
    p.set(9, 6, wax[2]);
    p.set(6, 9, wax[4]);
    // A drip down the side.
    p.set(6, 6, wax[4]);
    p.set(5, 7, wax[3]);
    p.set(5, 8, wax[2]);
    // Wick and flame.
    p.set(7, 4, '#3a2a20');
    p.set(7, 3, '#ffb047');
    p.set(8, 3, '#ee7f2d');
    p.set(7, 2, '#ffe08a');
    p.set(7, 1, CREAM_HI);
    p.set(8, 2, '#ffb047');
    // Dish.
    for (let x = 3; x <= 12; x++) p.set(x, 13, x < 6 ? GOLD[4] : x > 10 ? GOLD[1] : GOLD[2]);
    for (let x = 4; x <= 11; x++) p.set(x, 14, GOLD[1]);
    p.set(12, 12, GOLD[3]);
    p.set(13, 11, GOLD[2]);
  },

  honey(p) {
    // A squat clay crock, a cloth tied over the top, honey running down one side.
    const clay = ['#5a3020', '#8a4a2c', '#b86a3c', '#d9935a', '#f2bf88'];
    p.blob(8, 10, 5.6, 4.6, clay, (x, y) => y >= 6, false);
    for (let x = 4; x <= 11; x++) p.set(x, 6, x < 6 ? '#f6eedd' : x > 9 ? '#c8b89a' : '#e8dcc4');
    for (let x = 5; x <= 10; x++) p.set(x, 5, x < 7 ? '#fff6e8' : '#e8dcc4');
    p.rect(5, 7, 6, 1, '#7a2232');
    p.set(4, 7, '#ab3a45');
    // The drip.
    p.set(10, 8, GOLD[4]);
    p.set(10, 9, GOLD[3]);
    p.set(11, 10, GOLD[3]);
    p.set(11, 11, GOLD[2]);
    // A bee on the lid.
    p.set(9, 4, '#2a2018');
    p.set(10, 4, GOLD[4]);
    p.set(9, 3, '#d8eef2');
    p.set(5, 10, clay[4]);
  },

  smoked_eel(p) {
    // A coiled, glossy smoked eel on a twist of string.
    const eel = ['#2a1810', '#4a2c1a', '#7a4a24', '#ad7a48', '#e2b070'];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = x + 0.5 - 8;
        const dy = y + 0.5 - 8.5;
        const r = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx);
        const ring = 2.3 + ((a + Math.PI) / (Math.PI * 2)) * 3.2;
        if (Math.abs(r - ring) < 1.25 && r < 6.2) {
          const lit = -(dx * LIGHT_X + dy * LIGHT_Y) / (r || 1);
          p.set(x, y, eel[Math.max(0, Math.min(4, Math.round(2 + lit * 1.4 - (Math.abs(r - ring) > 0.8 ? 1 : 0))))]);
        }
      }
    }
    p.set(8, 8, eel[1]);
    p.set(3, 6, eel[0]);
    p.set(2, 5, '#141219');
    // Hanging string.
    p.line(12, 2, 13, 0, '#c8b89a');
    p.set(12, 3, '#a89878');
  },

  wool_cloak(p) {
    // A folded cloak: violet outside, teal lining showing at the fold, a pewter clasp.
    const vio = ['#2a1547', '#44267a', '#6340a8', '#8a66cc', '#b89ae6'];
    const teal = ['#164a4a', '#227070', '#36a0a0', '#6ccaca'];
    p.shape((x, y) => y >= 4 && y <= 13 && x >= 2 + Math.max(0, 6 - y) * 0.6 && x <= 13 - Math.max(0, 6 - y) * 0.6, vio, { k: 1.3 });
    for (let x = 3; x <= 12; x++) p.set(x, 9, x < 6 ? teal[3] : x > 10 ? teal[1] : teal[2]);
    for (let x = 3; x <= 12; x++) p.set(x, 10, teal[0]);
    for (let y = 11; y <= 13; y++) p.set(7 + ((y * 3) % 2), y, vio[1]);
    p.set(8, 5, IRON[4]);
    p.set(7, 5, IRON[2]);
    p.set(8, 6, IRON[1]);
    p.set(4, 5, vio[4]);
  },

  unknown(p) {
    const cloth = ['#5a4a3a', '#7a6a58', '#b5a184', '#e2d2b0'];
    p.blob(8, 10, 5.3, 4.3, cloth, (x, y) => y < 14, false);
    p.rect(6, 4, 4, 3, cloth[2]);
    p.set(9, 5, cloth[1]);
    p.set(5, 3, cloth[2]);
    p.set(6, 3, cloth[3]);
    p.set(9, 3, cloth[2]);
    p.set(10, 3, cloth[1]);
    for (let x = 5; x <= 10; x++) p.set(x, 6, x < 8 ? '#b58726' : '#7d5a1c');
    // A stitched question mark.
    const q = '#4a2c20';
    for (const [x, y] of [
      [7, 8],
      [8, 8],
      [9, 9],
      [8, 10],
      [8, 12],
    ])
      p.set(x, y, q);
    p.set(5, 9, cloth[3]);
  },
};

// ---- gear and buff food (DESIGN §26) ----
// Weapons, armor, cloaks, boots and charms share a few painted forms, each in the
// piece's own tint (src/gear/gear_data.js), so a new piece is one line here.

function tintRamp(hex, n = 5) {
  const c = String(hex || '#a0a0a0').replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = 0.32 + (i / (n - 1)) * 1.0; // dark .. light
    const lift = i === n - 1 ? 38 : 0;
    const f = (v) => Math.max(0, Math.min(255, Math.round(v * k + lift)));
    out.push(`#${[f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
  }
  return out;
}

function paintBlade(p, { blade, guard = GOLD, grip = ['#2a1a16', '#4a2c20', '#6b412a', '#8c5a35'], len = 1, broad = 1, gem = null, curve = 0 }) {
  const tipX = 6.2 + 7.2 * len;
  const tipY = 9.8 - 7.2 * len;
  const mask = union(capsule(6.2, 9.8, tipX - curve, tipY + curve * 0.3, 1.05 * broad), capsule(tipX - curve, tipY + curve * 0.3, tipX + 0.8, tipY - 0.8, 0.55 * broad));
  p.shape(mask, [blade[1], blade[2], blade[3], blade[4]], { k: 1.8 });
  for (let k = 0; k < Math.round(5 * len); k++) p.set(7 + k, 8 - k, k < 3 ? blade[4] : '#f2f4f8');
  p.shape(capsule(4.6, 11.4, 3.2, 12.8, 0.8), grip, { k: 1.6 });
  p.shape(capsule(3.4, 8.4, 7.6, 12.6, 0.85), [guard[1], guard[2], guard[3], guard[4]], { k: 1.8 });
  p.shape(ellipseMask(2.5, 13.5, 1.3, 1.3), [guard[1], guard[2], guard[3], guard[4]], { k: 1.6 });
  if (gem) {
    p.set(5, 11, gem);
    p.set(6, 10, gem);
  }
  p.after.push([Math.min(14, Math.round(tipX + 0.6)), Math.max(1, Math.round(tipY - 0.6)), '#ffffff']);
}

function paintCleaver(p, tint) {
  const steel = tintRamp(tint);
  p.shape(union(capsule(5, 10, 11.5, 3.5, 2.2), capsule(10, 6, 13, 2.2, 1.6)), [steel[1], steel[2], steel[3], steel[4]], { k: 1.6 });
  for (let k = 0; k < 4; k++) p.set(6 + k, 10 - k, steel[0]); // notches along the back
  p.shape(capsule(4.2, 11.6, 2.4, 13.6, 0.9), ['#2a1a16', '#4a2c20', '#6b412a', '#8c5a35'], { k: 1.6 });
  p.set(12, 4, '#ffffff');
}

function paintKnife(p, tint) {
  const bone = tintRamp(tint);
  p.shape(taper(5.4, 10.6, 13.2, 2.4, 1.3, 0.3), [bone[1], bone[2], bone[3], bone[4]], { k: 1.8 });
  p.shape(capsule(5, 11, 2.6, 13.6, 1), ['#3a2418', '#5a3a26', '#7a5236', '#9a6c46'], { k: 1.6 });
  p.rect(4, 10, 2, 1, IRON[3]);
  p.set(12, 3, '#ffffff');
}

function paintArmor(p, tint, { mail = false, plate = false, collar = null } = {}) {
  const r = tintRamp(tint);
  const torso = (x, y) => {
    if (y < 3.2 || y > 14) return false;
    const half = y < 6 ? 2.6 + (y - 3.2) * 1.5 : y < 11 ? 6.2 - (y - 6) * 0.18 : 5.4;
    return Math.abs(x - 8) <= half && !(y < 5.6 && Math.abs(x - 8) < 1.6);
  };
  p.shape(torso, [r[0], r[1], r[2], r[3], r[4]], { k: 1.5 });
  if (mail) for (let y = 6; y <= 13; y++) for (let x = 3; x <= 13; x++) if (p.get(x, y) && (x + y * 2) % 3 === 0) p.set(x, y, r[1]);
  if (plate) {
    for (let x = 4; x <= 12; x++) p.set(x, 9, r[1]);
    for (let y = 6; y <= 13; y++) p.set(8, y, y < 9 ? r[4] : r[3]);
    p.set(5, 6, r[4]);
    p.set(11, 6, r[2]);
  } else {
    for (let y = 7; y <= 13; y += 3) p.set(8, y, GOLD[3]); // rivets or toggles
  }
  if (collar) for (let x = 6; x <= 10; x++) if (p.get(x, 5)) p.set(x, 5, collar);
  for (let x = 3; x <= 13; x++) if (p.get(x, 13)) p.set(x, 13, r[0]);
}

function paintCloak(p, tint, lining) {
  const r = tintRamp(tint);
  const l = tintRamp(lining || tint);
  p.shape((x, y) => y >= 3 && y <= 14 && Math.abs(x - 8) <= 1.8 + (y - 3) * 0.48, [r[0], r[1], r[2], r[3], r[4]], { k: 1.3 });
  for (let y = 6; y <= 13; y++) p.set(8 + (y % 3 === 0 ? 1 : 0), y, r[1]); // the fold down the back
  for (let x = 2; x <= 14; x++) if (p.get(x, 14)) p.set(x, 14, l[2]); // lining at the hem
  p.shape(ellipseMask(8, 4.2, 2.6, 1.3), [l[1], l[2], l[3], l[4]], { k: 1.4 }); // hood edge
  p.set(8, 5, GOLD[4]);
  p.set(7, 5, GOLD[2]);
}

function paintBoots(p, tint) {
  const r = tintRamp(tint);
  const boot = (ox) => union(capsule(ox + 2, 3.5, ox + 2, 10.5, 1.8), capsule(ox + 2, 11.5, ox + 4.6, 12.2, 1.6));
  p.shape(boot(2), [r[0], r[1], r[2], r[3]], { k: 1.4 });
  p.shape(boot(8), [r[1], r[2], r[3], r[4]], { k: 1.4 });
  for (const ox of [2, 8]) {
    p.rect(ox, 13, 6, 1, '#2a1a16');
    p.set(ox + 1, 5, r[4]);
    p.set(ox + 2, 3, r[0]);
  }
}

function paintCharm(p, tint, form) {
  const r = tintRamp(tint);
  // The cord the charm hangs from.
  p.line(4, 1, 8, 5, '#c8b89a');
  p.line(12, 1, 8, 5, '#a89878');
  if (form === 'bead') {
    p.blob(8, 9.5, 3.6, 3.6, r, null, true);
    p.set(7, 8, '#ffffff');
  } else if (form === 'tooth') {
    p.shape(taper(8, 6, 8.6, 14, 2, 0.4), [BONE[1], BONE[2], BONE[3], BONE[4]], { k: 1.6 });
    for (let y = 6; y <= 8; y++) p.set(8, y, IRON[3]);
  } else if (form === 'bone') {
    p.shape(union(capsule(5.5, 9.5, 10.5, 9.5, 1.1), ellipseMask(5, 8.6, 1.4, 1.4), ellipseMask(5, 10.4, 1.4, 1.4), ellipseMask(11, 8.6, 1.4, 1.4), ellipseMask(11, 10.4, 1.4, 1.4)), [BONE[1], BONE[2], BONE[3], BONE[4]], { k: 1.6 });
  } else if (form === 'knot') {
    p.blob(8, 9.5, 3, 3, ['#2a2026', '#4a3a3a', '#6a5a50', '#8a7a68'], null, false);
    p.set(8, 9, '#ffb047');
    p.set(7, 10, '#e0603a');
    for (const [x, y] of [[5, 7], [11, 7], [5, 12], [11, 12], [8, 6]]) p.set(x, y, r[3]);
  } else if (form === 'thread') {
    for (let x = 3; x <= 13; x++) p.set(x, 9 + Math.round(Math.sin(x * 0.9)), x % 2 ? r[3] : r[4]);
    for (let x = 3; x <= 13; x++) p.set(x, 11 + Math.round(Math.sin(x * 0.9 + 1.5)), x % 2 ? r[2] : r[3]);
    p.set(8, 7, GOLD[4]);
  } else if (form === 'stone') {
    p.blob(8, 10, 4, 3.4, r, null, true);
    for (let x = 5; x <= 11; x += 3) p.set(x, 10, r[4]);
  } else {
    // glyph: a cut stone with a glowing mark
    p.shape((x, y) => Math.abs(x - 8) + Math.abs(y - 10) * 0.9 <= 4.6, [STONE[1], STONE[2], STONE[3], STONE[4]], { k: 1.5 });
    for (const [x, y] of [[8, 8], [8, 9], [8, 10], [7, 10], [9, 10], [8, 11], [8, 12]]) p.set(x, y, r[4]);
    p.after.push([8, 7, '#ffffff']);
  }
}

function paintFlask(p, liquid) {
  const l = tintRamp(liquid);
  const glass = ['#3a5a6a', '#6f9aa8', '#b8dde6', '#e8f6fa'];
  p.shape((x, y) => (y >= 5 && y <= 14 && Math.abs(x - 8) <= 3.4) || (y >= 3 && y < 5 && Math.abs(x - 8) <= 1.2), glass, { k: 1.4 });
  for (let y = 8; y <= 13; y++) for (let x = 5; x <= 11; x++) if (p.get(x, y)) p.set(x, y, x < 7 ? l[3] : x > 9 ? l[1] : l[2]);
  for (let x = 5; x <= 11; x++) if (p.get(x, 8)) p.set(x, 8, l[4]);
  p.rect(7, 1, 2, 2, '#8c5a35');
  p.set(5, 6, WHITE);
  p.set(5, 7, '#e8f6fa');
}

function paintBowl(p, soup) {
  const bowl = [WOOD[1], WOOD[2], WOOD[3], WOOD[4]];
  p.shape((x, y) => y >= 8 && y <= 13 && ((x - 8) / 6.2) ** 2 + ((y - 8) / 5.2) ** 2 <= 1, bowl, { k: 1.6 });
  for (let x = 3; x <= 12; x++) p.set(x, 7, x < 6 ? soup[2] : soup[1]);
  p.set(5, 7, soup[3]);
  p.set(9, 7, soup[3]);
  const steam = 'rgba(244, 234, 215, 0.7)';
  p.after.push([5, 4, steam], [6, 3, steam], [9, 4, steam], [10, 3, steam]);
}

const GEAR_ICONS = {
  steel_sword: (p) => paintBlade(p, { blade: ['#5a6472', '#8a96a6', '#b8c4d2', '#dfe8f2', '#ffffff'], guard: IRON, len: 1.05 }),
  forgesung_blade: (p) => paintBlade(p, { blade: ['#6a4a1a', '#b8862a', '#e8c25a', '#ffe08a', '#fff6c8'], len: 1.1, broad: 1.1, gem: '#7fd6ff' }),
  varek_cleaver: (p) => paintCleaver(p, '#b88a6a'),
  greyjaw_fang: (p) => paintKnife(p, '#e8e2d0'),
  warden_bonebrand: (p) => paintBlade(p, { blade: ['#5a6a7a', '#8aa4bc', '#bcd6ee', '#e4f2ff', '#ffffff'], guard: BONE, len: 1.15, gem: '#9a7dff', curve: 0.8 }),
  leather_jerkin: (p) => paintArmor(p, '#8a5a3a'),
  iron_mail: (p) => paintArmor(p, '#9aa6b4', { mail: true }),
  lakeglass_mail: (p) => paintArmor(p, '#5fc6c0', { mail: true, collar: '#bfe6ff' }),
  ironhand_plate: (p) => paintArmor(p, '#c2cad6', { plate: true, collar: GOLD[3] }),
  traveler_cloak: (p) => paintCloak(p, '#6f7a7a', '#2f9a9a'),
  murrel_cloak: (p) => paintCloak(p, '#7d4fb0', '#2f9a9a'),
  lakewort_cloak: (p) => paintCloak(p, '#2f9a9a', '#7d4fb0'),
  madder_mantle: (p) => paintCloak(p, '#b33a3a', '#e0a060'),
  field_boots: (p) => paintBoots(p, '#7a5638'),
  roadrunner_boots: (p) => paintBoots(p, '#3e5a7a'),
  gelstep_boots: (p) => paintBoots(p, '#6cc05a'),
  hearth_charm: (p) => paintCharm(p, '#e0603a', 'knot'),
  lucky_knucklebone: (p) => paintCharm(p, '#efe6cf', 'bone'),
  moonglass_bead: (p) => paintCharm(p, '#bfd8ff', 'bead'),
  wolftooth_charm: (p) => paintCharm(p, '#dcd4c2', 'tooth'),
  saints_thread: (p) => paintCharm(p, '#ffe08a', 'thread'),
  humstone: (p) => paintCharm(p, '#6ab8e6', 'stone'),
  lanternwright_glyph: (p) => paintCharm(p, '#ffd27a', 'glyph'),
  ironbark_tonic: (p) => paintFlask(p, '#a0784a'),
  swiftfoot_draught: (p) => paintFlask(p, '#5fd0a0'),
  clearmind_tincture: (p) => paintFlask(p, '#7fa8ff'),
  heartwort_salve: (p) => paintFlask(p, '#ff6b7a'),
  emberroot_soup: (p) => paintBowl(p, ['#6a2a12', '#a8441e', '#d8642a', '#ff9a4a']),
  travelers_pie: (p) => {
    const crust = ['#6a4a22', '#9a6c34', '#c99a52', '#e8c27a', '#fff0c0'];
    p.blob(8, 10, 6, 3.8, crust, null, false);
    for (let x = 4; x <= 12; x += 2) p.set(x, 8, crust[4]);
    p.set(7, 10, '#6a2a12');
    p.set(9, 11, '#6a2a12');
    p.rect(3, 12, 10, 1, crust[1]);
  },
  spiced_cider: (p) => {
    const mug = [WOOD[1], WOOD[2], WOOD[3], WOOD[4]];
    p.shape((x, y) => x >= 4 && x <= 11 && y >= 5 && y <= 14, mug, { k: 1.5 });
    p.shape(union(capsule(12, 7, 13.5, 9, 0.9), capsule(13.5, 9, 12, 11, 0.9)), mug, { k: 1.5 });
    for (let x = 5; x <= 10; x++) p.set(x, 5, x < 7 ? '#ffc070' : '#e0a060');
    for (let y = 7; y <= 13; y += 3) for (let x = 4; x <= 11; x++) p.set(x, y, WOOD[1]);
    const steam = 'rgba(244, 234, 215, 0.7)';
    p.after.push([6, 3, steam], [7, 2, steam], [9, 3, steam]);
  },
};
for (const [id, fn] of Object.entries(GEAR_ICONS)) if (!ICONS[id]) ICONS[id] = fn;

// Shared fish silhouette facing left (raw and grilled fish).
function fishBody(p, ramp, finColor) {
  p.blob(7.2, 8, 5.2, 3, ramp, null, false);
  for (let y = 0; y < N; y++) {
    for (let x = 11; x <= 14; x++) {
      const k = x + 0.5 - 11;
      const dy = Math.abs(y + 0.5 - 8);
      if (dy <= k * 1.15 + 0.4 && !(dy < k * 0.9 - 1.6)) p.set(x, y, dy > k * 0.8 ? finColor : ramp[2]);
    }
  }
  p.set(7, 4, finColor);
  p.set(8, 4, finColor);
  p.set(6, 5, finColor);
  p.set(9, 5, ramp[1]);
  p.set(6, 11, finColor);
  p.set(4, 7, ramp[1]);
  p.set(4, 8, ramp[1]);
}

function buildIcon(id) {
  const paint = ICONS[id] || ICONS.unknown;
  const p = new Painter();
  paint(p);
  return p.toCanvas();
}

// Registers 'icon:<id>' for every item plus 'icon:unknown'. Deterministic: the art
// uses fixed hashes, never randomness, so `rng` is accepted for the shared signature.
export function registerItemArt(atlas, rng) {
  const ids = [...Object.keys(ITEMS), 'unknown'];
  for (const id of ids) {
    let icon;
    try {
      icon = buildIcon(id);
    } catch (err) {
      console.error(`[items_art] icon ${id} failed`, err);
      continue;
    }
    atlas.add(`icon:${id}`, [icon.canvas], { ox: 8, oy: icon.base });
  }
}

// A 16x16 icon canvas for the DOM UI (unknown items get the question-mark sack).
// Each call returns a new canvas: a DOM node can only sit in one place, and the
// inventory, chest and shop panels may all show the same item at once.
export function itemIcon(atlas, itemId) {
  const src = atlas?.frame?.(`icon:${itemId}`) || atlas?.frame?.('icon:unknown') || null;
  if (!src || typeof document === 'undefined') return src;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0);
  return c;
}

// The icon as a PNG data URL (cached), for <img src> or CSS backgrounds.
const urlCache = new Map();
export function itemIconURL(atlas, itemId) {
  const key = atlas?.has?.(`icon:${itemId}`) ? itemId : 'unknown';
  let url = urlCache.get(key);
  if (url) return url;
  const src = atlas?.frame?.(`icon:${key}`);
  if (!src || typeof src.toDataURL !== 'function') return '';
  url = src.toDataURL('image/png');
  urlCache.set(key, url);
  return url;
}

// Names of every icon this module paints (for tests and tools).
export function itemIconIds() {
  return [...Object.keys(ITEMS), 'unknown'];
}

export const PAINTED_ICONS = Object.keys(ICONS);
