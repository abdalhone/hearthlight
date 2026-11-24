// Panels of the finding: the climb up the Hollowcrown, the carry down, the long sleep in
// the chapel, the family flames, and the morning in the Wayhouse (LORE §8).

import { Buf, rampAt, rampSmooth, fbm, noise, clamp, lerp, mix, hex, smooth, bayer } from './paint.js';
import { sky, stars, mountains, ridgeLine, fillBelow, snowField, pine, treeline, fogBand, tinyFigure, OUTLINE } from './scene_kit.js';
import { stamp, greyWeave } from './cast.js';

const R2 = (v) => Math.round(v);

// ======================================================================= the_climb

function climbGeom(L) {
  const u = L.u;
  // The flank rises from lower left to the broken summit at upper right.
  const sx = L.portrait ? L.W * 0.66 : L.W * 0.72;
  const sy = L.cy - (L.portrait ? 70 : 62) * u;
  return { u, sx, sy };
}

function flankY(L, x) {
  const { sx, sy, u } = climbGeom(L);
  const left = L.H * (L.portrait ? 0.62 : 0.8);
  const k = clamp(x / sx);
  const rise = sy + (left - sy) * (1 - k) ** 1.3;
  const fall = sy + (x - sx) * 0.95;
  return (x <= sx ? rise : fall) + (fbm(x * 0.04, 1, 91, 3) - 0.5) * 7 * u;
}

const the_climb = {
  id: 'the_climb',
  title: 'The climb',
  seed: 88,
  short: 170,
  pan: 'up',
  layers: [
    {
      depth: 0.08,
      paint(b, L, R) {
        const u = L.u;
        sky(b, L, ['#1a1c44', '#2c2c5c', '#4c3c70', '#86567a', '#c87a78', '#eea886', '#f8d4a0'], { y1: L.H * 0.75, power: 1.1 });
        stars(b, L, R, { count: 20, y1: L.H * 0.2 });
      },
    },
    {
      depth: 0.2,
      paint(b, L) {
        const u = L.u;
        mountains(b, L, 92, { base: L.cy + 10 * u, amp: 18 * u, freq: 0.016, rock: ['#4a4070', '#5a4e80', '#76638e', '#9a7c9a'], snow: ['#a08ab0', '#c8a8c0', '#ecc8c8', '#fbe4d4'], snowLine: 0.7, light: 1, haze: '#c08a98', hazeK: 0.35 });
      },
    },
    {
      depth: 0.55,
      paint(b, L, R) {
        const u = L.u;
        const { sx, sy } = climbGeom(L);
        // The Hollowcrown: snow above, rock below; gullies run down the fall line; the left
        // flank is in the mountain's own shadow, the right takes the dawn.
        const top = new Float32Array(L.W);
        for (let x = 0; x < L.W; x++) top[x] = flankY(L, x);
        // The broken crown: a few snapped teeth of rock at the summit.
        for (let i = -3; i <= 3; i++) {
          const tx = sx + i * 5 * u;
          const th = (6 + noise(i, 2, 97) * 9) * u * (1 - Math.abs(i) * 0.18);
          for (let x = R2(tx - 2.5 * u); x < tx + 2.5 * u; x++) {
            if (x < 0 || x >= L.W) continue;
            const peak = flankY(L, tx) - th + Math.abs(x - tx) * 1.6;
            top[x] = Math.min(top[x], peak);
          }
        }
        for (let x = 0; x < L.W; x++) {
          for (let y = R2(top[x]); y < L.H; y++) {
            const d = y - top[x];
            const hgt = clamp(1 - (y - sy) / (L.H * 0.75 - sy));
            const gully = fbm((x - y * 0.6) * 0.07, y * 0.015, 94, 3);
            const rocky = gully > 0.62 - hgt * 0.12 || hgt < 0.25 + fbm(x * 0.03, 5, 98, 2) * 0.2;
            const n = fbm(x * 0.05, y * 0.05, 93, 3);
            const side = smooth(sx - 8 * u, sx + 8 * u, x + (y - sy) * 0.3);
            let t = 0.34 + side * 0.28 + (n - 0.5) * 0.18 - Math.min(0.12, d * 0.002);
            if (d < 2) t += 0.25; // the ridge line catches the light
            const c = rocky
              ? rampSmooth(['#1c1a30', '#2a2844', '#3e3a5a', '#5a5272', '#86708a'], clamp(t - 0.05), x, y, 3)
              : rampSmooth(['#4a4a7a', '#6a6a9a', '#9a94c0', '#d6c8dc', '#fde6dc'], clamp(t + 0.1), x, y, 3);
            b.px(x, y, c);
          }
        }
        // The path: switchbacks up the flank, a pale trodden line in the snow.
        const pts = [];
        const x0 = L.W * 0.12;
        const x1 = sx - 20 * u;
        for (let k = 0; k < 7; k++) {
          const t = k / 6;
          const x = k % 2 ? lerp(x0, x1, t) + 30 * u : lerp(x0, x1, t);
          pts.push([x, flankY(L, x) + (6 + (1 - t) * 40) * u]);
        }
        for (let k = 0; k + 1 < pts.length; k++) {
          const n = Math.ceil(Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]));
          for (let j = 0; j < n; j += 2) {
            const x = lerp(pts[k][0], pts[k + 1][0], j / n);
            const y = lerp(pts[k][1], pts[k + 1][1], j / n);
            b.px(x, y, '#3a3658', 0.8);
          }
        }
        // Two small figures halfway up: Lyra's staff a violet spark, Hess ahead with her bow.
        const a = pts[3];
        const c2 = pts[4];
        const fx = lerp(a[0], c2[0], 0.45);
        const fy = lerp(a[1], c2[1], 0.45);
        tinyFigure(b, fx, fy, { body: '#1a1426', cloak: '#5a3a8a', head: '#1a1a5a', h: 6, staff: '#d8c8ff' });
        tinyFigure(b, fx + 7 * u, fy - 3 * u, { body: '#1a1418', cloak: '#6a3a22', head: '#2a2420', h: 6 });
        // Treeline pines on the lower slope.
        for (let i = 0; i < 26; i++) {
          const x = R() * sx * 0.9;
          const y = flankY(L, x) + (40 + R() * 70) * u;
          if (y > L.H) continue;
          pine(b, x, y, (8 + R() * 10) * u, { dark: '#120f22', mid: '#1c1830', lit: '#3a2c44', snow: '#e8d8e8', lightSide: 1 });
        }
        b.outline(OUTLINE);
      },
    },
    {
      depth: 1,
      paint(b, L, R) {
        const u = L.u;
        // Foreground: a shoulder of rock and snow-laden pines framing the left.
        const line = new Float32Array(L.W);
        for (let x = 0; x < L.W; x++) line[x] = L.H - (L.portrait ? 40 : 26) * u + Math.max(0, (L.W * 0.35 - x)) * -0.25 + (fbm(x * 0.03, 2, 95, 3) - 0.5) * 8 * u;
        fillBelow(b, line, (x, y, d) => rampSmooth(['#0e0c1a', '#1a1628', '#2c2640', '#e0d4e4'], clamp(d < 2 ? 0.95 : 0.25 + (fbm(x * 0.05, y * 0.1, 96, 3) - 0.5) * 0.3), x, y, 3));
        for (let i = 0; i < 4; i++) {
          const x = (i * L.W * 0.09) % (L.W * 0.36);
          pine(b, x, line[R2(Math.min(L.W - 1, x))] + 2, (34 + i * 9) * u, { dark: '#0a0816', mid: '#151226', lit: '#2c2238', snow: '#f0e4ee', lightSide: 1 });
        }
        b.outline(OUTLINE);
      },
    },
  ],
  particles: [{ type: 'snow', count: 70, speed: 5, wind: 22, colors: ['#ffffff', '#ffe8e0', '#e8e4ff'] }],
  lights(L, t) {
    const { sx, sy, u } = climbGeom(L);
    return [
      { x: sx + 30 * u, y: sy - 10 * u, r: 120 * u, color: '#ffc090', k: 0.4, depth: 0.55 },
      { x: L.W * 0.9, y: L.H * 0.7, r: 160 * u, color: '#ffd0a0', k: 0.2, depth: 0.08 },
    ];
  },
};

// ======================================================================= carry_down

function carryGeom(L) {
  const u = L.u;
  const x = L.cx;
  const y = L.cy + (L.portrait ? 26 : 30) * u;
  return { u, x, y };
}

function slopeY(L, x) {
  const { u, x: cx, y: cy } = carryGeom(L);
  return cy + (x - cx) * 0.18 + 2 * u + (fbm(x * 0.03, 4, 101, 3) - 0.5) * 5 * u;
}

const carry_down = {
  id: 'carry_down',
  short: 150,
  title: 'The carry down',
  seed: 99,
  pan: 'left',
  layers: [
    {
      depth: 0.08,
      paint(b, L) {
        sky(b, L, ['#06070f', '#0b0e1c', '#11162a', '#181f38', '#222b48'], { y1: L.cy + 20 * L.u });
      },
    },
    {
      depth: 0.3,
      paint(b, L, R) {
        const u = L.u;
        // Far slopes of pines in falling snow and mist.
        for (let k = 0; k < 3; k++) {
          const line = ridgeLine(L, 102 + k, { base: L.cy - 20 * u + k * 16 * u, amp: 10 * u, freq: 0.012, oct: 3 });
          const tone = ['#141a2e', '#10162a', '#0c1224'][k];
          fillBelow(b, line, () => hex(tone));
          treeline(b, L, R, line, { density: 0.35, hMin: 7 * u, hMax: 16 * u, colors: { dark: tone, mid: tone, lit: tone } });
          fogBand(b, L, 105 + k, { y: line[R2(L.W / 2)] + 6 * u, h: 12 * u, color: '#4a5478', alpha: 0.5, freq: 0.02 });
        }
      },
    },
    {
      depth: 1,
      paint(b, L, R) {
        const u = L.u;
        const { x: cx } = carryGeom(L);
        // The slope they are coming down, deep in snow.
        const line = new Float32Array(L.W);
        for (let x = 0; x < L.W; x++) line[x] = slopeY(L, x);
        fillBelow(b, line, (x, y, d) => {
          const n = fbm(x * 0.02, y * 0.06, 106, 3);
          return rampSmooth(['#141a30', '#1e2742', '#2a3656', '#3c4c72', '#56689a', '#7e92c0'], clamp(0.45 + (n - 0.5) * 0.3 + (d < 2 ? 0.3 : 0) - d * 0.003), x, y, 3);
        });
        // Lantern light on the snow around them.
        b.glow(cx + 10 * u, slopeY(L, cx + 10 * u) + 2 * u, 46 * u, '#ffb050', 0.4, 1.3);
        // Hess in front with the forward poles and the lantern; Lyra behind.
        const hx = cx - 24 * u;
        const lx = cx + 24 * u;
        const hy = slopeY(L, hx) + 3 * u;
        const ly = slopeY(L, lx) + 3 * u;
        const mul = [0.62, 0.64, 0.86];
        stamp(b, 'lyra', 'walk', 'left', R2(lx), R2(ly), { frame: 2, mul, rim: { color: '#ffb060', side: -1, k: 0.5 } });
        // The litter: two poles at hand height and Lyra's cloak slung between, the stranger in it.
        const pole = (dy) => b.line(hx + 2 * u, hy - 11 * u + dy, lx - 2 * u, ly - 11 * u + dy, '#4a3424');
        const midx = (hx + lx) / 2;
        const midy = (hy + ly) / 2 - 11 * u;
        for (let x = R2(hx + 5 * u); x < lx - 5 * u; x++) {
          const k = (x - (hx + 5 * u)) / (lx - hx - 10 * u);
          const sag = Math.sin(k * Math.PI) * 3 * u;
          const y0 = lerp(hy, ly, k) - 11 * u;
          for (let y = R2(y0); y < y0 + 4 * u + sag; y++) b.px(x, y, rampAt(['#2a1a46', '#45286e', '#5e3a92', '#7a52b0'], 0.3 + (1 - (y - y0) / (4 * u + sag)) * 0.6, x, y));
          if (x % R2(5 * u) === 0) b.px(x, y0 + 2 * u + sag, '#2a8a88');
        }
        // the body under the cloak: a long low mound, a fall of chestnut hair at one end
        b.ellipse(midx, midy - 1 * u, (lx - hx) * 0.3, 2.5 * u, '#5e3a92');
        b.ellipse(midx, midy - 2 * u, (lx - hx) * 0.27, 1.6 * u, '#7a52b0');
        b.ellipse(midx + (lx - hx) * 0.28, midy - 1.5 * u, 2.2 * u, 2 * u, '#6b3a24');
        pole(0);
        pole(-1);
        stamp(b, 'hess', 'walk', 'left', R2(hx), R2(hy), { frame: 4, mul, rim: { color: '#ffb060', side: 1, k: 0.55 } });
        // The lantern swinging from Hess's pole.
        const lnx = hx + 7 * u;
        const lny = hy - 10 * u;
        b.line(lnx, lny - 1, lnx, lny + 2 * u, '#2a2220');
        b.rect(lnx - 1.5 * u, lny + 2 * u, 3 * u, 3.5 * u, '#3a2a1a');
        b.rect(lnx - 1 * u, lny + 2.5 * u, 2 * u, 2.5 * u, '#ffc060');
        b.glow(lnx, lny + 3.5 * u, 18 * u, '#ffb050', 0.5);
        // Tracks behind them in the snow.
        for (let x = R2(lx + 8 * u); x < L.W; x += R2(5 * u)) {
          const y = slopeY(L, x) + 6 * u + (x % 2) * 2;
          b.rect(x, y, 2, 1, '#1e2742', 0.8);
        }
        b.outline(OUTLINE);
      },
    },
    {
      depth: 1.3,
      paint(b, L, R) {
        const u = L.u;
        // Big dark pines at the edges, close to the eye.
        pine(b, L.W * 0.04, L.H + 4 * u, 110 * u, { dark: '#05060c', mid: '#090b14', lit: '#141a28', snow: '#5a668a', lightSide: 1 });
        pine(b, L.W * 0.97, L.H + 8 * u, 96 * u, { dark: '#05060c', mid: '#090b14', lit: '#141a28', snow: '#5a668a', lightSide: -1 });
      },
    },
  ],
  particles: [{ type: 'snow', count: 170, speed: 11, wind: -6, colors: ['#ffffff', '#dfe6ff', '#c8d2f0'], bigChance: 0.25 }],
  lights(L, t) {
    const { x, u } = carryGeom(L);
    const hx = x - 24 * u;
    return [{ x: hx + 7 * u, y: slopeY(L, hx) + 3 * u - 6 * u, r: 50 * u, color: '#ffb050', k: 0.6 + 0.08 * Math.sin(t * 2.3), flicker: true, depth: 1 }];
  },
};

// ======================================================================= chapel interiors

const CH_STONE = ['#0c0a10', '#16121c', '#221c28', '#302634', '#423442', '#5a4652'];

function chapelBack(b, L, R, { altarY, altarW, windowX }) {
  const u = L.u;
  // Old stone, warm where the candles reach.
  for (let y = 0; y < L.H; y++) {
    for (let x = 0; x < L.W; x++) {
      const row = Math.floor(y / (8 * u));
      const inX = (x / (14 * u) + (row % 2) * 0.5) % 1;
      const inY = (y / (8 * u)) % 1;
      const n = fbm(x * 0.05, y * 0.08, 111, 3);
      let t = 0.22 + (noise(Math.floor(x / (14 * u) + (row % 2) * 0.5), row, 112) - 0.5) * 0.12 + (n - 0.5) * 0.2;
      if (inX < 0.05 || inY < 0.08) t -= 0.1;
      const toward = 1 - Math.hypot((x - L.cx) / L.W, (y - altarY) / L.H) * 1.6;
      t += Math.max(0, toward) * 0.35;
      b.px(x, y, rampSmooth(CH_STONE, clamp(t), x, y, 3));
    }
  }
  // A tall arched window.
  if (windowX != null) {
    const wx = windowX;
    const wy = L.cy - 50 * u;
    const ww = 18 * u;
    const wh = 46 * u;
    b.rect(wx - ww / 2 - 2 * u, wy - 2 * u, ww + 4 * u, wh + 4 * u, '#2a2026');
    for (let y = R2(wy); y < wy + wh; y++) {
      for (let x = R2(wx - ww / 2); x < wx + ww / 2; x++) {
        const dy = y - (wy + ww / 2);
        if (dy < 0 && Math.hypot(x - wx, dy) > ww / 2) continue;
        b.px(x, y, '#0c0a14', 1);
      }
    }
  }
  // The altar: a stepped stone table, three tiers for the family flames.
  const ax = L.cx;
  for (let k = 0; k < 3; k++) {
    const w = altarW * (1 - k * 0.22);
    const y = altarY - k * 7 * u;
    b.rect(ax - w / 2, y, w, 7 * u, rampAt(['#2a2028', '#3e2e36', '#584048'], 0.4 + k * 0.1, 0, 0));
    b.rect(ax - w / 2, y, w, 1, '#8a6a5a');
  }
  b.rect(ax - altarW / 2 - 2 * u, altarY + 7 * u, altarW + 4 * u, 22 * u, '#1c161e');
  b.rect(ax - altarW / 2 - 2 * u, altarY + 7 * u, altarW + 4 * u, 1, '#4a3a40');
}

// Thirty-eight candles on three tiers. lean > 0 bends the flames to the right.
function candleSpots(L, altarY, altarW) {
  const u = L.u;
  const out = [];
  const counts = [13, 13, 12];
  for (let k = 0; k < 3; k++) {
    const w = altarW * (1 - k * 0.22) - 6 * u;
    const y = altarY - k * 7 * u;
    for (let i = 0; i < counts[k]; i++) {
      const x = L.cx - w / 2 + (i + 0.5) * (w / counts[k]);
      out.push({ x, y, h: (3 + noise(i, k, 113) * 3) * u });
    }
  }
  return out;
}

function paintCandles(b, spots, u) {
  for (const c of spots) {
    b.rect(c.x - 0.75 * u, c.y - c.h, 1.5 * u, c.h, '#e8dcc0');
    b.rect(c.x + 0.25 * u, c.y - c.h, 0.5 * u, c.h, '#b8a888');
  }
}

function drawFlames(ctx, spots, o, t, lean, u) {
  for (let i = 0; i < spots.length; i++) {
    const c = spots[i];
    const x = Math.round(c.x - o.x);
    const y = Math.round(c.y - c.h - o.y);
    const fl = Math.sin(t * 9 + i * 1.7) > 0.3 ? 1 : 0;
    const s = Math.max(1, Math.round(u));
    const lx = lean * (1 + fl) * s;
    ctx.fillStyle = '#ff9a30';
    ctx.fillRect(x, y - 2 * s, s, 2 * s);
    ctx.fillRect(x + Math.round(lx * 0.5), y - 3 * s - fl * s, s, s + fl * s);
    ctx.fillStyle = '#fff0b0';
    ctx.fillRect(x + Math.round(lx * 0.3), y - 2 * s, s, s);
    if (lean) {
      ctx.fillStyle = '#ffb040';
      ctx.fillRect(x + Math.round(lx), y - 4 * s, s, s);
    }
  }
}

function lsGeom(L) {
  const u = L.u;
  return { u, altarY: L.cy - 6 * u, altarW: L.portrait ? L.vw * 0.55 : 92 * u, windowX: L.portrait ? L.W * 0.2 : L.W * 0.16, floor: L.cy + 26 * u };
}

const long_sleep = {
  id: 'long_sleep',
  short: 118,
  title: 'The long sleep',
  seed: 117,
  pan: 'none',
  layers: [
    {
      depth: 0.5,
      paint(b, L, R) {
        const u = L.u;
        const { altarY, altarW, windowX, floor } = lsGeom(L);
        chapelBack(b, L, R, { altarY, altarW, windowX });
        paintCandles(b, candleSpots(L, altarY, altarW), u);
        // The floor: worn flagstones running toward you.
        for (let y = R2(floor); y < L.H; y++) {
          for (let x = 0; x < L.W; x++) {
            const n = noise(Math.floor(x / (16 * u)), Math.floor(y / (6 * u)), 114);
            const seam = (x / (16 * u)) % 1 < 0.05 || ((y - floor) / (6 * u)) % 1 < 0.1;
            b.px(x, y, rampSmooth(['#0c0a10', '#18141c', '#261e28', '#382a34'], clamp(0.35 + (n - 0.5) * 0.15 - (seam ? 0.12 : 0) + (1 - Math.abs(x - L.cx) / L.W) * 0.15), x, y, 3));
          }
        }
        b.glow(L.cx, altarY - 8 * u, 70 * u, '#ff9a40', 0.4, 1.5);
      },
    },
    {
      depth: 1,
      paint(b, L, R) {
        const u = L.u;
        const { floor } = lsGeom(L);
        // The bench where you slept, a blanket over you, Aveline on her stool beside it.
        const bx = L.portrait ? L.cx - 6 * u : L.cx + 26 * u;
        const by = floor + 30 * u;
        b.rect(bx - 30 * u, by - 9 * u, 60 * u, 5 * u, '#3a2618');
        b.rect(bx - 30 * u, by - 9 * u, 60 * u, 1, '#6a4a30');
        b.rect(bx - 28 * u, by - 4 * u, 3 * u, 6 * u, '#24160e');
        b.rect(bx + 25 * u, by - 4 * u, 3 * u, 6 * u, '#24160e');
        stamp(b, 'player', 'down', 'down', R2(bx - 4 * u), R2(by - 7 * u), { recolor: greyWeave, mul: [0.85, 0.72, 0.62], rim: { color: '#ffb060', side: -1, k: 0.35 } });
        for (let x = R2(bx - 8 * u); x < bx + 22 * u; x++) {
          for (let y = R2(by - 15 * u); y < by - 8 * u; y++) {
            const top = by - 15 * u + Math.sin((x - bx) * 0.25) * 1.2 * u + 2 * u;
            if (y < top) continue;
            b.px(x, y, rampAt(['#2a1a26', '#4a2a3a', '#6a3a4a', '#8a5060'], clamp(0.6 - (y - top) / (8 * u) + ((x + y) % 7 === 0 ? 0.2 : 0)), x, y));
          }
        }
        b.rect(bx - 40 * u - 5, by - 6, 11, 2, '#4a3020');
        b.rect(bx - 40 * u - 4, by - 4, 2, 5, '#2a1a10');
        b.rect(bx - 40 * u + 3, by - 4, 2, 5, '#2a1a10');
        stamp(b, 'aveline', 'sit', 'right', R2(bx - 40 * u), R2(by - 2), { mul: [0.82, 0.7, 0.6], rim: { color: '#ffb060', side: 1, k: 0.45 } });
        // A candle on a stand at the foot of the bench.
        const cx = bx + 34 * u;
        b.rect(cx - 0.5, by - 26 * u, 1.5, 24 * u, '#2a1e16');
        b.rect(cx - 2 * u, by - 3 * u, 4 * u, 2, '#2a1e16');
        b.rect(cx - 1, by - 30 * u, 2.5, 4 * u, '#e8dcc0');
        b.glow(cx, by - 31 * u, 26 * u, '#ffa040', 0.45, 1.6);
        b.outline(OUTLINE);
      },
    },
  ],
  particles: [{ type: 'motes', count: 30, colors: ['#ffd8a0', '#fff0d0'], y0: (L) => L.cy - 50 * L.u, y1: (L) => L.H * 0.8, depth: 0.7 }],
  anim(ctx, L, t, inst) {
    const u = L.u;
    const { altarY, altarW, windowX } = lsGeom(L);
    const o = inst.offset(0.5, t);
    drawFlames(ctx, candleSpots(L, altarY, altarW), o, t, 0, u);
    // Days passing in the window: blue noon, gold evening, deep night, grey dawn.
    const phase = (t / 2.2) % 4;
    const cols = ['#9ac0e8', '#f0a860', '#141c3a', '#6a7aa0'];
    const i = Math.floor(phase);
    const f = phase - i;
    const c = mix(cols[i], cols[(i + 1) % 4], smooth(0.6, 1, f));
    const wx = Math.round(windowX - o.x);
    const wy = Math.round(L.cy - 50 * u - o.y);
    const ww = Math.round(18 * u);
    const wh = Math.round(46 * u);
    ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
    for (let y = 0; y < wh; y++) {
      const dy = y - ww / 2;
      let half = ww / 2;
      if (dy < 0) half = Math.sqrt(Math.max(0, (ww / 2) ** 2 - dy * dy));
      ctx.fillRect(Math.round(wx - half), wy + y, Math.round(half * 2), 1);
    }
    // the lead cross of the window
    ctx.fillStyle = '#1a1418';
    ctx.fillRect(wx, wy, 1, wh);
    ctx.fillRect(wx - ww / 2, wy + Math.round(wh * 0.55), ww, 1);
    // a shaft of light across the floor in the daytime
    const day = i === 0 ? 1 - smooth(0.6, 1, f) : i === 3 ? smooth(0.6, 1, f) : i === 1 ? 0.6 * (1 - smooth(0.6, 1, f)) : 0;
    if (day > 0.02) {
      ctx.globalAlpha = 0.12 * day;
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      for (let y = 0; y < L.H; y++) {
        const k = y / L.H;
        ctx.fillRect(Math.round(wx - ww / 2 + k * 60 * u), wy + wh + y, Math.round(ww + k * 30 * u), 1);
      }
      ctx.globalAlpha = 1;
    }
    inst.state.day = day;
  },
  lights(L, t, inst) {
    const u = L.u;
    const { altarY, windowX, floor } = lsGeom(L);
    const bx = L.portrait ? L.cx - 6 * u : L.cx + 26 * u;
    return [
      { x: L.cx, y: altarY - 10 * u, r: 80 * u, color: '#ffa040', k: 0.5, flicker: true, depth: 0.5 },
      { x: bx + 34 * u, y: floor + 30 * u - 31 * u, r: 40 * u, color: '#ffb050', k: 0.55, flicker: true, depth: 1 },
      { x: windowX, y: L.cy - 30 * u, r: 60 * u, color: '#bcd4ff', k: 0.3 * (inst?.state?.day ?? 0), depth: 0.5 },
    ];
  },
};

const chapel_candles = {
  id: 'chapel_candles',
  short: 130,
  title: 'The family flames',
  seed: 121,
  pan: 'none',
  layers: [
    {
      depth: 0.6,
      paint(b, L, R) {
        const u = L.u;
        const altarY = L.cy + 16 * u;
        const altarW = L.portrait ? L.vw * 0.8 : 170 * u;
        chapelBack(b, L, R, { altarY, altarW, windowX: null });
        paintCandles(b, candleSpots(L, altarY, altarW), u);
        // The hearth sign carved over the altar: a flame in a circle.
        const sx = L.cx;
        const sy = altarY - 48 * u;
        for (let a = 0; a < Math.PI * 2; a += 0.04) b.px(sx + Math.cos(a) * 12 * u, sy + Math.sin(a) * 12 * u, '#7a5a50');
        b.poly([[sx, sy - 8 * u], [sx + 5 * u, sy + 4 * u], [sx, sy + 7 * u], [sx - 5 * u, sy + 4 * u]], '#6a4a44');
        b.glow(L.cx, altarY - 10 * u, 90 * u, '#ff9a40', 0.5, 1.4);
      },
    },
    {
      depth: 1,
      paint(b, L, R) {
        const u = L.u;
        // You, at the edge of the frame: a dark shoulder and a hand held out.
        const x0 = L.W - (L.portrait ? 30 : 46) * u;
        for (let y = R2(L.cy - 10 * u); y < L.H; y++) {
          const w = (y - (L.cy - 10 * u)) * 0.35 + 10 * u;
          for (let x = R2(L.W - w); x < L.W; x++) b.px(x, y, rampSmooth(['#08060c', '#120e16', '#2a1a1c'], x === R2(L.W - w) ? 0.9 : 0.2, x, y, 2));
        }
        void x0;
        b.outline(OUTLINE);
      },
    },
  ],
  particles: [{ type: 'motes', count: 26, colors: ['#ffd8a0'], y0: (L) => L.cy - 40 * L.u, y1: (L) => L.cy + 20 * L.u }],
  anim(ctx, L, t, inst) {
    const u = L.u;
    const altarY = L.cy + 16 * u;
    const altarW = L.portrait ? L.vw * 0.8 : 170 * u;
    // Every flame leans toward you, a little more as the moment holds.
    const lean = Math.min(1.5, 0.4 + t * 0.12);
    drawFlames(ctx, candleSpots(L, altarY, altarW), inst.offset(0.6, t), t, lean, u);
  },
  lights(L, t) {
    const u = L.u;
    return [{ x: L.cx + 8 * u, y: L.cy, r: 120 * u, color: '#ffa040', k: 0.5, flicker: true, depth: 0.6 }];
  },
};

// ======================================================================= wayhouse_morning

const wayhouse_morning = {
  id: 'wayhouse_morning',
  short: 118,
  title: 'The Wayhouse, morning',
  seed: 131,
  pan: 'none',
  layers: [
    {
      depth: 0.6,
      paint(b, L, R) {
        const u = L.u;
        const floor = L.cy + 18 * u;
        // Plank walls, warm in the morning; a window full of sun.
        for (let y = 0; y < floor; y++) {
          for (let x = 0; x < L.W; x++) {
            const plank = Math.floor(x / (7 * u));
            const seam = (x / (7 * u)) % 1 < 0.1;
            const n = fbm(x * 0.02, y * 0.15, 132 + plank, 2);
            const t = 0.42 + (noise(plank, 1, 133) - 0.5) * 0.15 + (n - 0.5) * 0.2 - (seam ? 0.2 : 0) - (1 - y / floor) * 0.1;
            b.px(x, y, rampSmooth(['#1e140e', '#2e1e14', '#44301e', '#5e4228', '#7a5834'], clamp(t), x, y, 3));
          }
        }
        b.rect(0, R2(L.cy - 58 * u), L.W, 3 * u, '#24180e');
        const wx = L.portrait ? L.W * 0.7 : L.W * 0.62;
        const wy = L.cy - 40 * u;
        b.rect(wx - 15 * u, wy - 2 * u, 30 * u, 26 * u, '#2a1c10');
        b.rect(wx - 13 * u, wy, 26 * u, 22 * u, '#ffe2a0');
        b.rect(wx - 13 * u, wy + 14 * u, 26 * u, 8 * u, '#9ac078');
        b.rect(wx - 13 * u, wy + 12 * u, 26 * u, 2 * u, '#c8d8a0');
        b.rect(wx, wy, 1.5 * u, 22 * u, '#2a1c10');
        b.rect(wx - 13 * u, wy + 10 * u, 26 * u, 1.5 * u, '#2a1c10');
        // flowers in the sill box
        for (let i = 0; i < 8; i++) b.px(wx - 12 * u + i * 3.3 * u, wy + 23 * u, ['#ff7a8a', '#ffd060', '#c890ff'][i % 3]);
        b.rect(wx - 14 * u, wy + 24 * u, 28 * u, 3 * u, '#4a2e18');
        // The hearth on the left wall, a low morning fire.
        const hx = L.portrait ? L.W * 0.2 : L.W * 0.24;
        b.rect(hx - 16 * u, floor - 26 * u, 32 * u, 26 * u, '#3a3438');
        b.rect(hx - 10 * u, floor - 16 * u, 20 * u, 16 * u, '#0c0808');
        b.rect(hx - 18 * u, floor - 28 * u, 36 * u, 3 * u, '#5a4e52');
        b.glow(hx, floor - 6 * u, 30 * u, '#ff8a30', 0.45);
        // Jory Fallow's books on a shelf.
        for (let i = 0; i < 9; i++) b.rect(hx + 22 * u + i * 2.4 * u, L.cy - 52 * u + (i % 3), 2 * u, 8 * u - (i % 3), ['#6a2a2a', '#2a4a6a', '#4a5a2a', '#7a6a3a'][i % 4]);
        b.rect(hx + 20 * u, L.cy - 44 * u, 26 * u, 1.5 * u, '#3a2414');
        // Floorboards.
        for (let y = R2(floor); y < L.H; y++) {
          for (let x = 0; x < L.W; x++) {
            const board = Math.floor((y - floor) / (5 * u));
            const seam = ((y - floor) / (5 * u)) % 1 < 0.14;
            const t = 0.4 + (noise(board, Math.floor(x / (40 * u)), 134) - 0.5) * 0.15 - (seam ? 0.18 : 0);
            b.px(x, y, rampSmooth(['#20140c', '#342214', '#4a321e', '#62442a'], clamp(t), x, y, 3));
          }
        }
        // The sun on the floor.
        for (let y = R2(floor + 4 * u); y < L.H; y++) {
          const k = (y - floor) / (L.H - floor);
          for (let x = R2(wx - 18 * u - k * 30 * u); x < wx + 10 * u - k * 20 * u; x++) b.add(x, y, '#ffd890', 0.18);
        }
        b.glow(wx, wy + 10 * u, 50 * u, '#ffe0a0', 0.35);
      },
    },
    {
      depth: 1,
      paint(b, L, R) {
        const u = L.u;
        const floor = L.cy + 18 * u;
        // Your bed, and you sitting up on the edge of it.
        const bx = L.portrait ? L.W * 0.3 : L.W * 0.36;
        const by = floor + 34 * u;
        b.rect(bx - 22 * u, by - 14 * u, 44 * u, 12 * u, '#4a2e1a');
        b.rect(bx - 22 * u, by - 16 * u, 44 * u, 6 * u, '#d8d0c0');
        b.rect(bx - 6 * u, by - 16 * u, 28 * u, 7 * u, '#3a5a8a');
        b.rect(bx - 6 * u, by - 16 * u, 28 * u, 1, '#5a7aaa');
        b.rect(bx - 22 * u, by - 22 * u, 4 * u, 20 * u, '#3a2414');
        stamp(b, 'player', 'sit', 'right', R2(bx + 4 * u), R2(by - 10 * u), { mul: [1, 0.95, 0.88], rim: { color: '#ffe0a0', side: 1, k: 0.3 } });
        // Lyra, staff in hand, the morning on her.
        const lx = L.portrait ? L.W * 0.66 : L.W * 0.6;
        stamp(b, 'lyra', 'idle', 'left', R2(lx), R2(by - 2 * u), { mul: [1.02, 0.96, 0.9], rim: { color: '#ffe0a0', side: 1, k: 0.35 } });
        b.outline(OUTLINE);
      },
    },
  ],
  particles: [{ type: 'motes', count: 40, colors: ['#ffe8b0', '#fff6dc'], y0: (L) => L.cy - 40 * L.u, y1: (L) => L.H }],
  lights(L, t) {
    const u = L.u;
    const wx = L.portrait ? L.W * 0.7 : L.W * 0.62;
    return [
      { x: wx, y: L.cy - 30 * u, r: 90 * u, color: '#ffe0a0', k: 0.4, depth: 0.6 },
      { x: L.portrait ? L.W * 0.2 : L.W * 0.24, y: L.cy + 10 * u, r: 40 * u, color: '#ff8a30', k: 0.4, flicker: true, depth: 0.6 },
    ];
  },
};

export const JOURNEY_PANELS = { the_climb, carry_down, long_sleep, chapel_candles, wayhouse_morning };
