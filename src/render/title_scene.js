import { RNG, fbm, hash2 } from '../core/rng.js';
import { flickerWave } from './text_layout.js';

// The animated scene behind the title menu: a starry night over distant hills, the
// lights of Hearthvale far away, and a campfire where the traveler and Lyra sit
// together, her braid down her back and a small violet light in her open hand.
// The fire sits a little below center and the top-center sky stays calm so the
// title text over it reads cleanly. Drawn into the low-res buffer at (0, 0).

const SKY = ['#06051a', '#0a0922', '#0e0d2c', '#131236', '#191842', '#1f1d4b', '#272353', '#30295a', '#3b2e5c'];
const MEADOW = ['#141c38', '#111833', '#0f152d', '#0c1226', '#0a0f20'];
const BODY = '#0e0c1c';
const MOON_RIM = '#2b3062';
const FIRE_RIM = ['#86301b', '#c4501f', '#ee7f2d', '#ffb047'];

// Seated silhouettes, knees up. Traveler faces right (toward the fire), Lyra faces
// left. '#' body, 'b' Lyra's braid down her back, 'h' her open hand.
const TRAVELER = [
  '....####......',
  '...######.....',
  '..########....',
  '..########....',
  '..#########...',
  '..########....',
  '...######.....',
  '....####......',
  '..########....',
  '.##########...',
  '.###########..',
  '.############.',
  '.#############',
  '.#############',
  '.############.',
  '.#####...####.',
  '.####.....###.',
  '.####.....###.',
  '.####.....###.',
  '.####....####.',
];
const LYRA = [
  '.......####....',
  '......######...',
  '.....########..',
  '.....########b.',
  '....#########b.',
  '.....########.b',
  '......######..b',
  '.......####..b.',
  '.....#########b',
  '....##########b',
  'hh############.',
  '.#############.',
  '##############.',
  '##############.',
  '.#############.',
  '.####...######.',
  '.###.....#####.',
  '.###.....#####.',
  '.###.....#####.',
  '.####....#####.',
];

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x, y) => (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16;

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Dithered vertical ramp between rows y0..y1 straight into image data.
function ditherRamp(d, w, y0, y1, ramp, xFrom = 0, xTo = w) {
  const cols = ramp.map(hexRgb);
  const span = Math.max(1, y1 - y0);
  for (let y = y0; y < y1; y++) {
    const t = ((y - y0) / span) * (cols.length - 1);
    const i0 = Math.min(cols.length - 1, Math.floor(t));
    const i1 = Math.min(cols.length - 1, i0 + 1);
    const f = t - i0;
    for (let x = xFrom; x < xTo; x++) {
      const c = f > bayer(x, y) ? cols[i1] : cols[i0];
      const k = (y * w + x) * 4;
      d[k] = c[0];
      d[k + 1] = c[1];
      d[k + 2] = c[2];
      d[k + 3] = 255;
    }
  }
}

function buildFigure(rows, fireOnRight) {
  const h = rows.length;
  const w = rows[0].length;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const solid = (x, y) => y >= 0 && y < h && x >= 0 && x < w && rows[y][x] !== '.';
  const rim = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      // Her braid is midnight blue, banded so it reads as plaited.
      g.fillStyle = ch === 'b' ? (y % 2 ? '#232a58' : '#3a4a8a') : BODY;
      g.fillRect(x, y, 1, 1);
      if (ch === 'b') continue;
      // Moonlight touches the top edges from the upper right.
      if (!solid(x, y - 1) && (!solid(x + 1, y) || y < 4)) {
        g.fillStyle = MOON_RIM;
        g.fillRect(x, y, 1, 1);
      }
      // Edges facing the fire catch its light.
      if (!solid(x + (fireOnRight ? 1 : -1), y) && ch !== 'b') rim.push(x, y);
    }
  }
  return { canvas: c, rim, w, h };
}

export class TitleScene {
  constructor(game) {
    this.game = game;
    this.w = 0;
    this.h = 0;
    this.bg = null;
    this.twinklers = [];
    this.villageLights = [];
    this.traveler = null;
    this.lyra = null;
    this._emberAcc = 0;
    this._crackleIn = 2;
    this._flyAcc = 0;
    this.fireX = 0;
    this.fireY = 0;
    this.moonX = 0;
    this.moonY = 0;
    this.moonR = 7;
    this.moteX = 0;
    this.moteY = 0;
  }

  _build(w, h) {
    this.w = w;
    this.h = h;
    const rng = new RNG(80117);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    const d = img.data;
    const horizon = Math.round(h * 0.585);
    this.horizon = horizon;
    ditherRamp(d, w, 0, horizon + 6, SKY);
    ditherRamp(d, w, horizon + 6, h, MEADOW);
    g.putImageData(img, 0, 0);

    // A faint diagonal band of the galaxy, then the stars.
    const band = (x, y) => {
      const nx = x / w - 0.15;
      const ny = y / horizon;
      const dist = Math.abs(ny - (0.9 - nx * 0.95));
      return Math.max(0, 1 - dist / 0.18);
    };
    g.fillStyle = '#1d1c4a';
    for (let y = 0; y < horizon - 10; y++) {
      for (let x = 0; x < w; x++) {
        const b = band(x, y) * (0.55 + 0.45 * fbm(x * 0.05, y * 0.05, 3, 3));
        if (b > 0.35 && b * 0.6 > hash2(x, y, 7)) g.fillRect(x, y, 1, 1);
      }
    }
    this.twinklers = [];
    const nStars = Math.round((w * horizon) / 260);
    for (let i = 0; i < nStars; i++) {
      const x = rng.int(0, w - 1);
      const y = rng.int(0, horizon - 14);
      // Fewer stars behind the title text so it reads cleanly.
      const titleZone = Math.abs(x - w / 2) < w * 0.22 && y < h * 0.36;
      if (titleZone && rng.chance(0.6)) continue;
      const roll = rng.next() + band(x, y) * 0.15;
      let col = '#2f3a74';
      if (roll > 0.97) col = '#ffffff';
      else if (roll > 0.88) col = '#c9cff5';
      else if (roll > 0.62) col = '#6f7bb8';
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
      if (roll > 0.985) {
        g.fillStyle = '#4b5596';
        g.fillRect(x - 1, y, 1, 1);
        g.fillRect(x + 1, y, 1, 1);
        g.fillRect(x, y - 1, 1, 1);
        g.fillRect(x, y + 1, 1, 1);
      }
      if (roll > 0.8 && this.twinklers.length < 22 && rng.chance(0.5)) this.twinklers.push({ x, y, phase: rng.next() * 10, speed: rng.range(1.2, 3.2) });
    }

    // Moon, waxing gibbous, with a few craters.
    const mr = Math.max(6, Math.round(Math.min(w, h) * 0.034));
    const mx = Math.round(w * (w > h ? 0.8 : 0.74));
    const my = Math.round(h * 0.15);
    this.moonX = mx;
    this.moonY = my;
    this.moonR = mr;
    for (let y = -mr; y <= mr; y++) {
      for (let x = -mr; x <= mr; x++) {
        const r2 = x * x + y * y;
        if (r2 > mr * mr + mr * 0.6) continue;
        const shadow = (x - mr * 0.75) ** 2 + (y + mr * 0.1) ** 2 > (mr * 1.25) ** 2;
        let col = '#f2efe0';
        if (shadow) col = bayer(x + mx, y + my) < 0.55 ? '#9f9b8a' : '#c9c4ae';
        else if (r2 > (mr - 1) * (mr - 1)) col = '#e2ddc8';
        g.fillStyle = col;
        g.fillRect(mx + x, my + y, 1, 1);
      }
    }
    g.fillStyle = '#d6d1bb';
    const craters = [
      [0.2, -0.3, 1],
      [-0.25, 0.25, 1],
      [0.35, 0.35, 0],
    ];
    for (const [cx, cy, big] of craters) {
      const x = mx + Math.round(cx * mr);
      const y = my + Math.round(cy * mr);
      g.fillRect(x, y, 1 + big, 1 + big);
    }

    // Far hills, the village on them, near hills with pines.
    const edge = (x) => ((x - w / 2) / (w / 2)) ** 2;
    const farY = new Int16Array(w);
    for (let x = 0; x < w; x++) farY[x] = Math.round(horizon - 9 - fbm(x * 0.016, 3.3, 5, 3) * 26 - edge(x) * 16);
    for (let x = 0; x < w; x++) {
      g.fillStyle = '#1b1c45';
      g.fillRect(x, farY[x], 1, horizon + 6 - farY[x]);
      g.fillStyle = '#272b5c';
      g.fillRect(x, farY[x], 1, 1);
    }
    this.villageLights = [];
    const vx = Math.round(w * 0.2);
    for (let i = 0; i < 5; i++) {
      const hx = vx + i * 5 + (i % 2);
      const base = farY[Math.min(w - 1, Math.max(0, hx + 1))] + 3;
      const hh = 3 + (i % 3);
      g.fillStyle = '#121334';
      g.fillRect(hx, base - hh, 4, hh + 2);
      g.fillRect(hx + 1, base - hh - 1, 2, 1);
      if (i !== 2) {
        g.fillStyle = i % 2 ? '#ffb047' : '#ee7f2d';
        g.fillRect(hx + 1 + (i % 2), base - hh + 1 + (i === 4 ? 1 : 0), 1, 1);
        this.villageLights.push({ x: hx + 1 + (i % 2), y: base - hh + 1, phase: i * 1.7 });
      }
    }
    const nearY = new Int16Array(w);
    for (let x = 0; x < w; x++) nearY[x] = Math.round(horizon - 1 - fbm(x * 0.028, 7.7, 9, 3) * 12 - edge(x) * 20);
    for (let x = 0; x < w; x++) {
      g.fillStyle = '#121435';
      g.fillRect(x, nearY[x], 1, horizon + 6 - nearY[x]);
    }
    const nTrees = Math.round(w / 7);
    for (let i = 0; i < nTrees; i++) {
      const x = rng.int(0, w - 1);
      const nearCenter = Math.abs(x - w / 2) / (w / 2);
      if (rng.next() > 0.25 + nearCenter * 0.9) continue;
      const th = Math.round(7 + rng.next() * 8 + nearCenter * 10);
      this._pine(g, x, nearY[x] + 2, th, '#0b0c26', '#1a1d47');
    }

    // Meadow: grass blades and a darker edge along the horizon.
    for (let x = 0; x < w; x++) {
      const gy = horizon + 5;
      if (hash2(x, 1, 3) > 0.45) {
        g.fillStyle = '#0d1430';
        g.fillRect(x, gy - (hash2(x, 2, 3) > 0.7 ? 2 : 1), 1, 2);
      }
    }
    const blades = Math.round((w * (h - horizon)) / 40);
    for (let i = 0; i < blades; i++) {
      const x = rng.int(0, w - 1);
      const y = rng.int(horizon + 8, h - 1);
      const tall = 1 + Math.round(((y - horizon) / (h - horizon)) * 2);
      g.fillStyle = rng.chance(0.5) ? '#1a2446' : '#0b1124';
      g.fillRect(x, y - tall, 1, tall);
    }

    // Framing trees at the edges, darkest of all.
    // Framing trees scale with the narrower side so a tall phone screen is not all pine.
    const bigH = Math.round(Math.min(h * 0.55, w * 0.62));
    this._pine(g, Math.round(w * 0.035), h + 4, bigH, '#07060f', '#120f26');
    this._pine(g, Math.round(w * 0.965), h + 4, Math.round(bigH * 0.92), '#07060f', '#120f26');
    if (w > h * 1.3) {
      this._pine(g, Math.round(w * 0.1), h + 6, Math.round(bigH * 0.7), '#08071a', '#14122c');
      this._pine(g, Math.round(w * 0.9), h + 6, Math.round(bigH * 0.62), '#08071a', '#14122c');
    }

    // The fire, the two of them and their logs.
    this.fireX = Math.round(w / 2);
    this.fireY = Math.round(h * 0.665);
    this.traveler = buildFigure(TRAVELER, true);
    this.lyra = buildFigure(LYRA, false);
    this.bg = c;
  }

  // Free the cached backdrop once the game has started.
  dispose() {
    this.bg = null;
    this.w = this.h = 0;
  }

  // A layered pine silhouette with its base at (x, base).
  _pine(g, x, base, height, col, rim) {
    const top = base - height;
    for (let y = 0; y < height; y++) {
      const tier = y % Math.max(3, Math.round(height / 5));
      const half = Math.max(0, Math.round(y * 0.3 + tier * 0.5 - 1));
      g.fillStyle = col;
      g.fillRect(x - half, top + y, half * 2 + 1, 1);
      if (half > 0 && tier === 0) {
        g.fillStyle = rim;
        g.fillRect(x + half, top + y, 1, 1);
      }
    }
    g.fillStyle = col;
    g.fillRect(x, top - 1, 1, 1);
  }

  render(b, w, h, time, dt, particles) {
    if (w !== this.w || h !== this.h || !this.bg) this._build(w, h);
    b.globalAlpha = 1;
    b.globalCompositeOperation = 'source-over';
    b.drawImage(this.bg, 0, 0);
    this._twinkle(b, time);
    this._shootingStar(b, time);
    const flick = flickerWave(time, 1.3);
    this._logs(b, flick);
    this._fire(b, time);
    this._figures(b, time, flick);
    this._spawn(dt, particles);
  }

  _twinkle(b, time) {
    for (const s of this.twinklers) {
      const v = 0.5 + 0.5 * Math.sin(time * s.speed + s.phase);
      b.fillStyle = v > 0.8 ? '#ffffff' : v > 0.45 ? '#c9cff5' : '#4b5596';
      b.fillRect(s.x, s.y, 1, 1);
      if (v > 0.93) {
        b.fillStyle = '#6f7bb8';
        b.fillRect(s.x - 1, s.y, 1, 1);
        b.fillRect(s.x + 1, s.y, 1, 1);
        b.fillRect(s.x, s.y - 1, 1, 1);
        b.fillRect(s.x, s.y + 1, 1, 1);
      }
    }
  }

  // Now and then a shooting star crosses the upper sky.
  _shootingStar(b, time) {
    const period = 13;
    const k = Math.floor(time / period);
    const t = time - k * period;
    if (t > 0.9 || k < 1) return;
    const sx = this.w * (0.08 + 0.45 * hash2(k, 1, 41));
    const sy = this.h * (0.05 + 0.18 * hash2(k, 2, 41));
    const dirX = 0.9;
    const dirY = 0.42;
    const speed = 150;
    const hx = sx + dirX * speed * t;
    const hy = sy + dirY * speed * t;
    const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.8;
    const tail = ['#ffffff', '#ddd2ff', '#c9cff5', '#8e97d0', '#6f7bb8', '#4b5596', '#353d78', '#2a3068'];
    b.globalAlpha = Math.max(0, fade);
    for (let i = 0; i < tail.length; i++) {
      b.fillStyle = tail[i];
      b.fillRect(Math.round(hx - dirX * i * 1.6), Math.round(hy - dirY * i * 1.6), 1, 1);
    }
    b.globalAlpha = 1;
  }

  _logs(b, flick) {
    const fx = this.fireX;
    const fy = this.fireY;
    const lit = flick > 0.2 ? '#c4501f' : '#86301b';
    // Seat logs; the end nearer the fire catches its light.
    for (let k = 0; k < 2; k++) {
      const x0 = k === 0 ? fx - 29 : fx + 15;
      const len = 15;
      const litEnd = k === 0;
      b.fillStyle = '#1e1410';
      b.fillRect(x0, fy - 1, len, 4);
      b.fillStyle = '#3a2418';
      b.fillRect(x0 + 1, fy - 2, len - 2, 1);
      b.fillStyle = lit;
      b.fillRect(litEnd ? x0 + len - 1 : x0, fy - 1, 1, 3);
      b.fillStyle = '#6b412a';
      b.fillRect(litEnd ? x0 + len - 4 : x0 + 1, fy - 2, 3, 1);
    }
    // Stones around the fire, tops lit by it.
    const stones = [-7, -5, -2, 2, 5, 7];
    for (let i = 0; i < stones.length; i++) {
      const sx = fx + stones[i];
      const sy = fy + (Math.abs(stones[i]) > 5 ? -1 : 1);
      b.fillStyle = '#1c1a28';
      b.fillRect(sx - 1, sy, 3, 2);
      b.fillStyle = flick > -0.3 ? '#9a7049' : '#7a553a';
      b.fillRect(sx - 1, sy, 2, 1);
    }
    // Crossed firewood with glowing coals.
    b.fillStyle = '#2a1a16';
    b.fillRect(fx - 5, fy - 1, 10, 2);
    b.fillStyle = '#4a2c20';
    b.fillRect(fx - 4, fy - 2, 3, 1);
    b.fillRect(fx + 1, fy - 2, 3, 1);
    b.fillStyle = flick > 0 ? '#ee7f2d' : '#c4501f';
    b.fillRect(fx - 2, fy - 1, 4, 1);
  }

  // Procedural flames: columns of rising heat, white-gold at the core.
  _fire(b, time) {
    const fx = this.fireX;
    const fy = this.fireY - 2;
    for (let dx = -3; dx <= 3; dx++) {
      const wave = flickerWave(time * 1.25, dx * 0.9 + 2);
      const base = 7.5 - Math.abs(dx) * 1.7;
      const hgt = Math.max(1, Math.round(base * (0.78 + 0.3 * wave)));
      for (let k = 0; k < hgt; k++) {
        const f = k / hgt;
        let col;
        if (Math.abs(dx) <= 1 && f < 0.45) col = '#fff4c0';
        else if (f < 0.35) col = '#ffe08a';
        else if (f < 0.65) col = '#ffb047';
        else if (f < 0.85) col = '#ee7f2d';
        else col = '#c4501f';
        b.fillStyle = col;
        b.fillRect(fx + dx, fy - k, 1, 1);
      }
      // Loose tongues of flame break off the top now and then.
      if (Math.abs(dx) <= 1 && wave > 0.55) {
        b.fillStyle = '#ee7f2d';
        b.fillRect(fx + dx, fy - hgt - 1 - Math.round((wave - 0.55) * 4), 1, 1);
      }
    }
  }

  _figures(b, time, flick) {
    const fx = this.fireX;
    const fy = this.fireY;
    const rimA = FIRE_RIM[flick > 0.3 ? 3 : 2];
    const rimB = FIRE_RIM[flick > 0.3 ? 2 : 1];
    const tr = this.traveler;
    const ly = this.lyra;
    const tx = fx - 28;
    const tyy = fy - 1 - tr.h;
    this._figure(b, tr, tx, tyy, rimA, rimB);
    const lx = fx + 13;
    const lyy = fy - 1 - ly.h;
    this._figure(b, ly, lx, lyy, rimA, rimB);
    // Every so often Lyra glances back toward the traveler.
    const glance = Math.sin(time * 0.45) > 0.82;
    if (glance) {
      // Turn her head slightly back toward the traveler.
      b.fillStyle = MOON_RIM;
      b.fillRect(lx + 10, lyy + 1, 1, 1);
      b.fillRect(lx + 11, lyy + 2, 1, 1);
    }
    // A violet light floats over her palm.
    const bob = Math.round(Math.sin(time * 2.2) * 1.2);
    this.moteX = lx;
    this.moteY = lyy + 7 + bob;
    b.fillStyle = '#ddd2ff';
    b.fillRect(this.moteX, this.moteY, 1, 1);
    b.fillStyle = '#7a64e0';
    if (Math.sin(time * 5.3) > 0) b.fillRect(this.moteX, this.moteY - 1, 1, 1);
    else b.fillRect(this.moteX + 1, this.moteY, 1, 1);
  }

  // Firelight is brightest low down, nearest the flames.
  _figure(b, f, x, y, rimA, rimB) {
    b.drawImage(f.canvas, x, y);
    const split = Math.round(f.h * 0.45);
    for (let i = 0; i < f.rim.length; i += 2) {
      b.fillStyle = f.rim[i + 1] >= split ? rimA : rimB;
      b.fillRect(x + f.rim[i], y + f.rim[i + 1], 1, 1);
    }
  }

  _spawn(dt, particles) {
    if (!particles || !(dt > 0)) return;
    this._emberAcc += dt;
    while (this._emberAcc > 0.11) {
      this._emberAcc -= 0.11;
      particles.emit('ember', this.fireX + (Math.random() * 4 - 2), this.fireY - 1, { count: 1, z: 3 + Math.random() * 4 });
    }
    this._crackleIn -= dt;
    if (this._crackleIn <= 0) {
      this._crackleIn = 1.5 + Math.random() * 3.5;
      particles.emit('spark', this.fireX, this.fireY - 2, { count: 3, z: 4, speed: [15, 40] });
    }
    this._flyAcc += dt;
    if (this._flyAcc > 0.6) {
      this._flyAcc = 0;
      if (particles.countOf('firefly') < 9) {
        const x = this.w * (0.08 + Math.random() * 0.84);
        const y = this.horizon + 6 + Math.random() * (this.h - this.horizon - 14);
        if (Math.abs(x - this.fireX) > 24) particles.emit('firefly', x, y, { z: 2 + Math.random() * 10 });
      }
    }
  }

  // Additive light over the upscaled scene: firelight, moon halo, Lyra's mote,
  // the distant windows of Hearthvale.
  drawGlow(ctx, r, time, lighting) {
    if (!lighting || !this.bg) return;
    const s = r.scale;
    const flick = flickerWave(time, 1.3);
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    const fx = this.fireX * s;
    const fy = (this.fireY - 4) * s;
    // Warm pool of light on the ground, wider than tall.
    const R = (62 + flick * 3) * s;
    ctx.globalAlpha = 0.42 + flick * 0.05;
    ctx.drawImage(lighting.sprite('#ff8a3c'), fx - R * 1.35, fy - R * 0.62 + 4 * s, R * 2.7, R * 1.24);
    const R2 = (24 + flick * 2) * s;
    ctx.globalAlpha = 0.38 + flick * 0.06;
    ctx.drawImage(lighting.sprite('#ffc46a'), fx - R2, fy - R2, R2 * 2, R2 * 2);
    const R3 = 7 * s;
    ctx.globalAlpha = 0.42;
    ctx.drawImage(lighting.sprite('#fff4c0'), fx - R3, fy - R3 + 2 * s, R3 * 2, R3 * 2);
    // Moon halo.
    const mR = (this.moonR * 4.2) * s;
    ctx.globalAlpha = 0.2;
    ctx.drawImage(lighting.sprite('#8f9cff'), this.moonX * s - mR, this.moonY * s - mR, mR * 2, mR * 2);
    // Lyra's violet light.
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.2);
    const vR = (7 + pulse * 2) * s;
    ctx.globalAlpha = 0.55 + pulse * 0.2;
    ctx.drawImage(lighting.sprite('#a995ff'), (this.moteX + 0.5) * s - vR, (this.moteY + 0.5) * s - vR, vR * 2, vR * 2);
    // Village windows.
    for (const v of this.villageLights) {
      const wR = 3.5 * s;
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(time * 0.9 + v.phase);
      ctx.drawImage(lighting.sprite('#ffb047'), (v.x + 0.5) * s - wR, (v.y + 0.5) * s - wR, wR * 2, wR * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
  }
}
