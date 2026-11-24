// Panels of the world of Halcyre: the lit hall going dark, the Drift, the warded villages
// and Hearthvale at dusk (LORE §1, §5).

import { Buf, rampAt, rampSmooth, fbm, noise, clamp, lerp, mix, hex, smooth, bayer } from './paint.js';
import { sky, stars, mountains, ridgeLine, fillBelow, pine, treeline, house, lampPost, fogBand, tinyFigure, OUTLINE } from './scene_kit.js';
import { stamp } from './cast.js';

const R2 = (v) => Math.round(v);

// ======================================================================= halcyre
// A Lanternwright hall in perspective: pillars marching to a great round window, a lamp on
// every pillar. The lamps go out one by one while the narrator speaks.

const HALL_Z = [1, 1.45, 2.05, 2.9, 4.1, 5.8];

function hallGeom(L) {
  const u = L.u;
  const vx = L.cx;
  const vy = L.cy - 4 * u;
  const X = (L.portrait ? 62 : 118) * u;
  const F = 64 * u;
  const C = (L.portrait ? 150 : 104) * u;
  return { u, vx, vy, X, F, C };
}

function hallLamps(L) {
  const { u, vx, vy, X } = hallGeom(L);
  const out = [];
  HALL_Z.forEach((z, i) => {
    for (const side of [-1, 1]) {
      const px = vx + side * (X / z) - side * (9 * u) / z;
      out.push({ x: px, y: vy - (14 * u) / z, z, side, outAt: 1.2 + (HALL_Z.length - i) * 0.85 + (side > 0 ? 0.35 : 0) });
    }
  });
  return out;
}

function paintHall(b, L, lit) {
  const { u, vx, vy, X, F, C } = hallGeom(L);
  // Cold blue-violet stone; the lamps add gold on top of it.
  const stone = ['#06060f', '#0c0d1d', '#14172c', '#1e2340', '#2b3256', '#3c4670', '#56628e'];
  const S = (t, x, y) => rampSmooth(stone, t, x, y, 4);
  const warm = '#ffa04a';
  const lamps = hallLamps(L);
  b.fill((x, y) => S(0.1 + 0.08 * (1 - Math.abs(x - vx) / L.W) - (y / L.H) * 0.05, x, y));
  // The far window: a great rose of pale light at the end of the hall.
  const zw = 7.5;
  const wr = (X / zw) * 1.05;
  const wy = vy - (C / zw) * 0.3;
  for (let y = R2(wy - wr); y <= wy + wr; y++) {
    for (let x = R2(vx - wr); x <= vx + wr; x++) {
      const d = Math.hypot(x - vx, y - wy) / wr;
      if (d > 1) continue;
      const ang = Math.atan2(y - wy, x - vx);
      const spoke = Math.abs(Math.sin(ang * 6)) < 0.16 && d > 0.22;
      const ring = Math.abs(d - 0.22) < 0.07 || Math.abs(d - 0.62) < 0.05 || d > 0.88;
      const glass = lit ? mix('#ffe2a8', '#c89a7a', d * 0.8) : mix('#6a80c0', '#24305a', d);
      const petal = 0.85 + 0.15 * Math.cos(ang * 12);
      b.px(x, y, spoke || ring ? (lit ? '#2a1c24' : '#0a0c18') : glass.map((v) => v * petal));
    }
  }
  // Floor: polished stone in perspective with tile seams and long reflections.
  for (let y = R2(vy + F / 9); y < L.H; y++) {
    const z = F / Math.max(0.5, y - vy);
    for (let x = 0; x < L.W; x++) {
      const wx = ((x - vx) * z) / u;
      const seam = Math.abs(wx / 24 - Math.round(wx / 24)) < 0.025 * z || Math.abs(z * 2.5 - Math.round(z * 2.5)) < 0.035;
      let t = 0.16 + 0.22 / z - (seam ? 0.07 : 0);
      t += Math.max(0, 1 - Math.abs(x - vx) / (wr * 1.2)) * 0.18 * (1 - clamp((y - vy) / (L.H - vy)) * 0.7);
      b.px(x, y, S(clamp(t), x, y));
    }
  }
  // Pillars far to near, a lamp bowl on each inner face; pointed arches across the aisle.
  for (let i = HALL_Z.length - 1; i >= 0; i--) {
    const z = HALL_Z[i];
    const pw = (20 * u) / z;
    const top = vy - C / z;
    const base = vy + F / z;
    const ax0 = vx - X / z;
    const ax1 = vx + X / z;
    const ay = top + (10 * u) / z;
    const apex = top - (26 * u) / z;
    const thick = Math.max(2, (9 * u) / z);
    for (let x = R2(ax0); x <= ax1; x++) {
      const k = (x - ax0) / (ax1 - ax0);
      const yc = ay - Math.sin(k * Math.PI) ** 0.65 * (ay - apex);
      for (let y = R2(yc - thick); y < yc; y++) {
        const under = (y - (yc - thick)) / thick;
        b.px(x, y, S(0.18 + under * 0.22 + 0.15 / z, x, y));
      }
      if (lit) b.add(x, R2(yc - 1), warm, 0.25 / z);
    }
    for (const side of [-1, 1]) {
      const cx = vx + side * (X / z);
      const x0 = R2(cx - pw / 2);
      const x1 = R2(cx + pw / 2);
      for (let y = R2(Math.max(0, top)); y < base; y++) {
        for (let x = x0; x < x1; x++) {
          const fx = (x - x0) / Math.max(1, x1 - x0);
          const toward = side < 0 ? fx : 1 - fx;
          const flute = Math.sin(fx * Math.PI * 4) > 0.6 ? 0.05 : 0;
          const t = clamp(0.12 + toward * 0.32 + flute + 0.2 / z - ((y - top) / (base - top)) * 0.08);
          b.px(x, y, S(t, x, y));
        }
      }
      b.rect(x0 - pw * 0.15, top + (6 * u) / z, (x1 - x0) * 1.3, Math.max(1, (3 * u) / z), stone[4]);
      b.rect(x0 - pw * 0.12, base - Math.max(1, (4 * u) / z), (x1 - x0) * 1.24, Math.max(1, (4 * u) / z), stone[2]);
      const lx = cx - side * (pw / 2 + (2 * u) / z);
      const ly = vy - (14 * u) / z;
      const bw = Math.max(2, (6 * u) / z);
      b.rect(lx - bw / 2, ly, bw, Math.max(1, (2 * u) / z), lit ? '#7a5434' : '#1a1c2a');
      b.rect(lx - 0.5, ly, 1, Math.max(1, (5 * u) / z), '#121420');
    }
  }
  if (lit) {
    // Lamplight: warm pools on the pillars, the arches and long streaks on the polished floor.
    for (const lp of lamps) {
      b.glow(lp.x, lp.y, (32 * u) / lp.z, warm, 0.45, 1.8);
      // a long soft reflection on the polished floor below the lamp
      const fy = vy + F / lp.z;
      const len = (70 * u) / lp.z;
      const half = Math.max(1, (3 * u) / lp.z);
      for (let y = R2(fy); y < Math.min(L.H, fy + len); y++) {
        const k = (1 - (y - fy) / len) ** 1.5;
        for (let dx = -half; dx <= half; dx++) b.add(R2(lp.x + dx), y, warm, 0.22 * k * (1 - Math.abs(dx) / (half + 1)));
      }
    }
    b.glow(vx, wy, wr * 2.4, '#ffd8a0', 0.25, 1.4);
  }
}

const halcyre = {
  id: 'halcyre',
  title: 'Halcyre, the lit hall',
  seed: 3,
  pan: 'none',
  layers: [
    { depth: 0.5, paint: (b, L) => paintHall(b, L, false) },
    { depth: 0.5, paint: (b, L) => paintHall(b, L, true) },
  ],
  particles: [{ type: 'motes', count: 40, colors: ['#ffd9a0', '#c9b6ff'] }],
  anim(ctx, L, t, inst) {
    const lamps = hallLamps(L);
    let lit = 0;
    const o = inst.offset(0.5, t);
    for (const lp of lamps) {
      const on = t < lp.outAt;
      const x = Math.round(lp.x - o.x);
      const y = Math.round(lp.y - o.y);
      const sz = Math.max(1, Math.round((3 * L.u) / lp.z));
      if (on) {
        lit++;
        const fl = Math.sin(t * 12 + lp.x) > 0 ? 1 : 0;
        ctx.fillStyle = '#ffb047';
        ctx.fillRect(x - sz / 2, y - sz * 2 - fl, sz, sz * 2 + fl);
        ctx.fillStyle = '#fff0b0';
        ctx.fillRect(x - sz / 4, y - sz - fl, Math.max(1, sz / 2), sz);
      } else {
        // a thread of smoke for a few seconds after it goes out
        const k = (t - lp.outAt) / 3;
        if (k < 1) {
          ctx.globalAlpha = 0.5 * (1 - k);
          ctx.fillStyle = '#8a8aa0';
          for (let j = 0; j < 6; j++) ctx.fillRect(x + Math.round(Math.sin(t * 2 + j) * 1.5), y - 2 - j * 2 - Math.round(k * 8), 1, 1);
          ctx.globalAlpha = 1;
        }
      }
    }
    // The warm version of the hall fades with the lamps.
    const f = lit / lamps.length;
    if (inst.layers[1]) inst.layers[1].alpha = f;
  },
  lights(L, t) {
    const out = [];
    const lamps = hallLamps(L);
    let lit = 0;
    for (const lp of lamps) {
      if (t < lp.outAt) {
        lit++;
        out.push({ x: lp.x, y: lp.y - 2, r: (40 * L.u) / lp.z, color: '#ffb057', k: 0.55, flicker: true, depth: 0.5 });
      } else if (t < lp.outAt + 0.5) {
        out.push({ x: lp.x, y: lp.y - 2, r: (30 * L.u) / lp.z, color: '#ffe0a0', k: 0.6 * (1 - (t - lp.outAt) * 2), depth: 0.5 });
      }
    }
    const { vx, vy, C, X } = hallGeom(L);
    out.push({ x: vx, y: vy - (C / 7.5) * 0.35, r: (X / 7.5) * 2.4, color: '#ffe8c0', k: 0.15 + 0.35 * (lit / lamps.length), depth: 0.5 });
    return out;
  },
};

// ======================================================================= the_drift

function curtain(b, L, { yc, amp, height, colors, k = 0.6, seed = 5, x0 = 0, x1 = L.W }) {
  for (let x = Math.max(0, R2(x0)); x < Math.min(L.W, x1); x++) {
    const base = yc + Math.sin(x * 0.021 + 1.3) * amp + (fbm(x * 0.012, 2, seed, 3) - 0.5) * amp * 1.6;
    const ray = 0.45 + 0.55 * fbm(x * 0.3, 7, seed + 2, 2);
    const fadeX = smooth(x0, x0 + 40, x) * (1 - smooth(x1 - 40, x1, x));
    for (let y = Math.max(0, R2(base - height)); y < base + 3; y++) {
      const up = (base - y) / height; // 0 at the lower hem, 1 at the top
      let a = y > base ? (1 - (y - base) / 3) * 0.9 : (1 - up) ** 1.4 * ray;
      a *= k * fadeX;
      if (a <= 0.01) continue;
      const c = mix(colors[0], colors[1], clamp(up * 1.2 + (fbm(x * 0.02, y * 0.02, seed + 4, 2) - 0.5)));
      const q = Math.floor(a * 10 + bayer(x, y)) / 10;
      if (q > 0) b.add(x, y, c, q);
    }
  }
}

const the_drift = {
  id: 'the_drift',
  title: 'The Drift',
  seed: 14,
  pan: 'right',
  layers: [
    {
      depth: 0.08,
      paint(b, L, R) {
        const u = L.u;
        sky(b, L, ['#03030b', '#070919', '#0c112b', '#12193c', '#19244c', '#22305a'], { y1: L.cy + 30 * u });
        stars(b, L, R, { count: 120, y1: L.cy });
        // Glimmer: curtains of loose light, teal into violet, hanging over the land.
        curtain(b, L, { yc: L.cy - 34 * u, amp: 10 * u, height: 50 * u, colors: ['#4ff0c8', '#7a5cff'], k: 0.55, seed: 3 });
        curtain(b, L, { yc: L.cy - 60 * u, amp: 8 * u, height: 40 * u, colors: ['#3fd0e0', '#b070ff'], k: 0.3, seed: 8, x0: L.W * 0.35 });
      },
    },
    {
      depth: 0.22,
      paint(b, L, R) {
        const u = L.u;
        const line = mountains(b, L, 51, { base: L.cy + 10 * u, amp: 20 * u, freq: 0.021, rock: ['#0d1122', '#151d34', '#202c48', '#2e3e5c'], snow: ['#2a3a5a', '#3a5272', '#56789a'], snowLine: 0.35, light: 1, lightColor: '#3fd0c0',
          peaks: [{ x: L.W * 0.55, w: 40 * u, h: 14 * u, sharp: true }] });
        // A dead village on a far rise: roofs and no light at all.
        const vx = L.portrait ? L.W * 0.25 : L.W * 0.3;
        for (let i = 0; i < 6; i++) {
          const hx = vx + (i - 3) * 6 * u + (R() - 0.5) * 3;
          const hy = line[Math.max(0, Math.min(L.W - 1, R2(hx)))] + 2 * u;
          b.rect(hx - 2 * u, hy - 3 * u, 4 * u, 3 * u, '#0c0f1e');
          b.poly([[hx - 3 * u, hy - 3 * u], [hx, hy - 6 * u], [hx + 3 * u, hy - 3 * u]], '#121628');
        }
      },
    },
    {
      depth: 0.45,
      scroll: 4,
      paint(b, L) {
        // The grey: a bank of fog that makes things forget themselves.
        fogBand(b, L, 63, { y: L.cy + 16 * L.u, h: 20 * L.u, color: '#b0b8d8', alpha: 0.9, freq: 0.016 });
        fogBand(b, L, 62, { y: L.cy + 4 * L.u, h: 8 * L.u, color: '#8f98c0', alpha: 0.5, freq: 0.03 });
      },
    },
    {
      depth: 0.7,
      paint(b, L, R) {
        const u = L.u;
        const g = ridgeLine(L, 66, { base: L.cy + 24 * u, amp: 5 * u, freq: 0.012, oct: 3 });
        fillBelow(b, g, (x, y, d) => rampSmooth(['#070810', '#0d0f1c', '#141828', '#1c2234'], clamp(0.35 + (d < 2 ? 0.4 : 0) - d * 0.01 + (fbm(x * 0.05, y * 0.1, 67, 3) - 0.5) * 0.3), x, y, 3));
        treeline(b, L, R, g, { density: 0.18, hMin: 5 * u, hMax: 11 * u, colors: { dark: '#05070e', mid: '#0a0f1a', lit: '#1a3a44' } });
      },
    },
    {
      depth: 1,
      paint(b, L, R) {
        const u = L.u;
        const g = ridgeLine(L, 71, { base: L.cy + (L.portrait ? 44 : 50) * u, amp: 7 * u, freq: 0.009, oct: 3 });
        fillBelow(b, g, (x, y, d) => {
          const n = fbm(x * 0.05, y * 0.1, 73, 3);
          const heather = fbm(x * 0.15, y * 0.3, 74, 2) > 0.58;
          let t = 0.28 + (n - 0.5) * 0.4 + (d < 2 ? 0.4 : 0) - Math.min(0.2, d * 0.004);
          const c = rampSmooth(heather ? ['#0b0a14', '#191428', '#2a1e3a', '#3c2a4c'] : ['#06070d', '#0c0e18', '#131726', '#1c2234', '#26314a'], clamp(t), x, y, 3);
          return c;
        });
        // Dry grass along the crest, rimmed by the glimmer.
        for (let x = 0; x < L.W; x++) {
          if (R() < 0.6) {
            const hgt = 1 + R() * 4 * u;
            b.line(x, g[x], x + (R() - 0.5) * 3, g[x] - hgt, R() < 0.35 ? '#3a7a80' : '#141a28');
          }
        }
        // Rocks half sunk in the heather, their tops rimmed by the glimmer.
        for (let i = 0; i < 6; i++) {
          const rx = R() * L.W;
          const gy = g[R2(Math.min(L.W - 1, Math.max(0, rx)))];
          const ry = gy + 8 * u + R() * (L.H - gy) * 0.5;
          const rw = (5 + R() * 8) * u;
          const rock = new Buf(R2(rw * 2 + 4), R2(rw + 4));
          rock.ellipse(rw + 2, rw * 0.7 + 2, rw, rw * 0.55, '#0c0e1a');
          rock.ellipse(rw + 1, rw * 0.6 + 2, rw * 0.8, rw * 0.38, '#161b2c');
          for (let x = 0; x < rock.w; x++) {
            for (let y = 0; y < rock.h; y++) {
              if (rock.alphaAt(x, y)) {
                rock.px(x, y, '#3a8a8e', 0.8);
                if (rock.alphaAt(x, y + 1)) rock.px(x, y + 1, '#1f4a52', 0.8);
                break;
              }
            }
          }
          rock.outline(OUTLINE);
          b.draw(rock, R2(rx - rw - 2), R2(ry - rw * 0.7 - 2));
        }
        // A dead waystone: a tall pillar whose lamp niche has been dark for years.
        const wx = L.portrait ? L.W * 0.72 : L.W * 0.76;
        const wb = g[R2(wx)] + 4;
        const wh = 62 * u;
        const ww = 12 * u;
        for (let y = R2(wb - wh); y < wb; y++) {
          for (let x = R2(wx - ww / 2); x < wx + ww / 2; x++) {
            const fx = (x - (wx - ww / 2)) / ww;
            const n = fbm(x * 0.2, y * 0.15, 77, 3);
            b.px(x, y, rampSmooth(['#07080f', '#10131f', '#1a1e30', '#262e46', '#34445c'], clamp(0.18 + (1 - fx) * 0.32 + (n - 0.5) * 0.3), x, y, 4));
          }
          b.add(R2(wx - ww / 2), y, '#4ff0c8', 0.25);
        }
        b.rect(wx - 3 * u, wb - wh + 9 * u, 6 * u, 8 * u, '#030308');
        b.rect(wx - 4 * u, wb - wh + 17 * u, 8 * u, 1.5 * u, '#2a3048');
        b.line(wx + 1, wb - wh + 24 * u, wx - 2, wb - wh + 40 * u, '#05060c');
        b.rect(wx - ww / 2 - 2, wb - wh - 2 * u, ww + 4, 3 * u, '#1c2032');
        b.rect(wx - ww / 2 - 2, wb - wh - 2 * u, ww + 4, 1, '#3e7a80');
        b.outline(OUTLINE);
      },
    },
  ],
  particles: [
    { type: 'twinkle', count: 80, colors: ['#7ff0e0', '#c3b0ff', '#ffffff'], y0: 0, y1: (L) => L.cy - 10 * L.u, depth: 0.1, bigChance: 0.15, glowR: 5 },
    { type: 'brightfall', count: 40, speed: 3.5, colors: ['#fff2c8', '#d8f4ff', '#ffe0a0'], bigChance: 0.45, glowR: 7, glowK: 0.5 },
  ],
  lights(L, t) {
    return [
      { x: L.W * 0.35, y: L.cy - 40 * L.u, r: 130 * L.u, color: '#3fe0c0', k: 0.16 + 0.05 * Math.sin(t * 0.4), depth: 0.08 },
      { x: L.W * 0.75, y: L.cy - 55 * L.u, r: 110 * L.u, color: '#8a6aff', k: 0.13, depth: 0.08 },
    ];
  },
};

// ======================================================================= warded_villages

function villageSpots(L) {
  const u = L.u;
  const spots = L.portrait
    ? [
        { x: 0.3, y: -0.1, s: 0.8 },
        { x: 0.72, y: -0.25, s: 0.6 },
        { x: 0.5, y: 0.3, s: 1.4 },
      ]
    : [
        { x: 0.17, y: 0.05, s: 1.0 },
        { x: 0.47, y: 0.32, s: 1.45 },
        { x: 0.8, y: 0.02, s: 0.95 },
        { x: 0.34, y: -0.22, s: 0.6 },
        { x: 0.64, y: -0.28, s: 0.5 },
      ];
  return spots.map((p) => ({ x: L.W * p.x, y: L.cy + p.y * 60 * u + 6 * u, s: p.s * u }));
}

const warded_villages = {
  id: 'warded_villages',
  title: 'The warded villages',
  seed: 22,
  pan: 'right',
  layers: [
    {
      depth: 0.1,
      paint(b, L, R) {
        const u = L.u;
        sky(b, L, ['#04040c', '#090b1c', '#10142e', '#181f42', '#253260', '#34407a'], { y1: L.cy - 18 * u });
        stars(b, L, R, { count: 90, y1: L.cy - 40 * u });
        mountains(b, L, 81, { base: L.cy - 26 * u, amp: 18 * u, freq: 0.013, rock: ['#0c0e1e', '#141932', '#1e2644', '#2a3658'], snow: ['#3a4672', '#56649a', '#8a98cc'], snowLine: 0.5, light: -1,
          peaks: [{ x: L.W * 0.62, w: 60 * u, h: 24 * u, sharp: true }], haze: '#2a3460', hazeK: 0.1 });
      },
    },
    {
      depth: 0.4,
      paint(b, L, R) {
        const u = L.u;
        // The fog sea: the valley floor lost in drift-weather, faintly luminous.
        for (let y = R2(L.cy - 24 * u); y < L.H; y++) {
          for (let x = 0; x < L.W; x++) {
            const n = fbm(x * 0.012, y * 0.04, 85, 4);
            const t = clamp(0.35 + (n - 0.5) * 0.7 - ((y - (L.cy - 24 * u)) / (L.H - L.cy)) * 0.25);
            b.px(x, y, rampSmooth(['#10152e', '#1a2240', '#263254', '#36466c', '#4c5e86'], t, x, y, 4));
          }
        }
        // Dark hills shouldering out of the fog on both sides.
        for (const side of [-1, 1]) {
          for (let x = 0; x < L.W; x++) {
            const fx = side < 0 ? x / L.W : 1 - x / L.W;
            const top = L.cy - 30 * u + fx * fx * 140 * u + (fbm(x * 0.03, 1, 87 + side, 3) - 0.5) * 12 * u;
            for (let y = R2(top); y < L.H; y++) {
              const d = y - top;
              b.px(x, y, rampSmooth(['#05060e', '#0a0c18', '#111526'], clamp(0.3 + (d < 2 ? 0.5 : 0) - d * 0.01), x, y, 3));
            }
          }
        }
      },
    },
    {
      depth: 0.7,
      paint(b, L, R) {
        const u = L.u;
        const spots = villageSpots(L);
        for (const v of spots) {
          // A rise of dark ground standing out of the fog, a cluster of roofs with lit windows.
          b.ellipse(v.x, v.y + 4 * v.s, 26 * v.s, 7 * v.s, '#0a0c18');
          b.ellipse(v.x, v.y + 3 * v.s, 24 * v.s, 5 * v.s, '#12162a');
          const n = 7 + Math.round(v.s * 5);
          for (let i = 0; i < n; i++) {
            const a = R() * Math.PI * 2;
            const r = Math.sqrt(R()) * 15 * v.s;
            const hx = v.x + Math.cos(a) * r;
            const hy = v.y + Math.sin(a) * r * 0.32;
            const w = (4 + R() * 2.5) * v.s;
            b.rect(hx - w / 2, hy - 2.5 * v.s, w, 2.5 * v.s, '#1e1828');
            b.poly([[hx - w / 2 - 1, hy - 2.5 * v.s], [hx, hy - 5.5 * v.s], [hx + w / 2 + 1, hy - 2.5 * v.s]], '#2c2236');
            if (R() < 0.85) b.rect(hx - 0.5 * v.s, hy - 1.8 * v.s, Math.max(1, v.s), Math.max(1, v.s), '#ffc062');
          }
          // The chapel spire in the middle of each village.
          b.rect(v.x - 1, v.y - 9 * v.s, 2.5 * v.s, 7 * v.s, '#251d30');
          b.poly([[v.x - 1.5 * v.s, v.y - 9 * v.s], [v.x + 0.25 * v.s, v.y - 13 * v.s], [v.x + 2 * v.s, v.y - 9 * v.s]], '#33283e');
          // The ward: a dome of pale gold light, brightest at its rim.
          b.glow(v.x, v.y + 3 * v.s, 46 * v.s, '#ff9a48', 0.22, 1.5);
          const rx = 30 * v.s;
          const ry = 20 * v.s;
          for (let y = R2(v.y - ry); y < v.y + 6 * v.s; y++) {
            for (let x = R2(v.x - rx); x < v.x + rx; x++) {
              const d = Math.hypot((x - v.x) / rx, (y - v.y) / (y < v.y ? ry : 6 * v.s));
              if (d > 1) continue;
              const k = 0.08 + smooth(0.72, 1, d) * 0.42 * (y < v.y ? 1 : 0.4);
              const q = Math.floor(k * 12 + bayer(x, y)) / 12;
              if (q > 0) b.add(x, y, '#ffd38a', q);
            }
          }
        }
        // Waystones between them; one in three still burns.
        const pts = [...spots].sort((p, q) => p.x - q.x);
        for (let i = 0; i + 1 < pts.length; i++) {
          for (let k = 1; k <= 2; k++) {
            const x = lerp(pts[i].x, pts[i + 1].x, k / 3);
            const y = lerp(pts[i].y, pts[i + 1].y, k / 3) + Math.sin(k * 2.1) * 6 * u;
            b.rect(x, y - 4 * u, 1.5 * u, 4 * u, '#2a3048');
            if ((i + k) % 3 === 0) {
              b.rect(x, y - 5 * u, 1.5 * u, 1.5 * u, '#ffd890');
              b.glow(x, y - 4 * u, 6 * u, '#ffb050', 0.5);
            }
          }
        }
      },
    },
    {
      depth: 0.9,
      scroll: 2.5,
      paint(b, L) {
        fogBand(b, L, 101, { y: L.cy + 34 * L.u, h: 16 * L.u, color: '#4a5680', alpha: 0.55, freq: 0.018 });
      },
    },
  ],
  particles: [{ type: 'twinkle', count: 40, colors: ['#ffd890', '#ffffff'], y0: (L) => L.cy - 30 * L.u, y1: (L) => L.cy + 50 * L.u, depth: 0.7, bigChance: 0.05 }],
  lights(L, t) {
    return villageSpots(L).map((v, i) => ({ x: v.x, y: v.y - 4 * v.s, r: 36 * v.s, color: '#ffb457', k: 0.45 + 0.08 * Math.sin(t * 0.7 + i), depth: 0.7 }));
  },
};

// ======================================================================= hearthvale_dusk

function hvGeom(L) {
  const u = L.u;
  const ground = L.cy + (L.portrait ? 30 : 36) * u;
  const well = { x: L.cx + (L.portrait ? 0 : 6 * u), y: ground + 26 * u };
  const posts = L.portrait ? [0.1, 0.9] : [0.07, 0.29, 0.71, 0.92];
  return { u, ground, well, posts };
}

const hearthvale_dusk = {
  id: 'hearthvale_dusk',
  title: 'Hearthvale at dusk',
  seed: 31,
  pan: 'right',
  layers: [
    {
      depth: 0.08,
      paint(b, L, R) {
        const u = L.u;
        sky(b, L, ['#0f1534', '#1c2150', '#36306a', '#6a4878', '#b66a6c', '#e8955a', '#f6c27a'], { y1: L.cy + 26 * u, power: 1.15 });
        stars(b, L, R, { count: 30, y1: L.cy * 0.35 });
        // The Hollowcrown: the high peak to the north, its broken summit catching the last light.
        const peakX = L.portrait ? L.W * 0.62 : L.W * 0.68;
        mountains(b, L, 111, { base: L.cy + 18 * u, amp: 10 * u, freq: 0.012, rock: ['#2a2346', '#3a2f58', '#54406c', '#7a5878'], snow: ['#8a7090', '#b890a0', '#e8b8a8', '#fbe0c8'], snowLine: 0.55, light: 1, lightColor: '#ff9a70', haze: '#7a5a80', hazeK: 0.15,
          peaks: [{ x: peakX, w: 40 * u, h: 44 * u, sharp: true }, { x: peakX - 6 * u, w: 7 * u, h: -7 * u }, { x: L.W * 0.18, w: 50 * u, h: 12 * u }] });
      },
    },
    {
      depth: 0.3,
      paint(b, L, R) {
        const u = L.u;
        const line = ridgeLine(L, 121, { base: L.cy + 20 * u, amp: 5 * u, freq: 0.015, oct: 3 });
        fillBelow(b, line, (x, y, d) => hex(rampAt(['#0e1228', '#151a36', '#1e2442'], clamp(0.3 + (d < 2 ? 0.5 : 0)), x, y)));
        // Whisperwood behind the village roofs.
        treeline(b, L, R, line, { density: 0.75, hMin: 8 * u, hMax: 18 * u, colors: { dark: '#0a0d1e', mid: '#121731', lit: '#2e2848' }, lightSide: 1 });
      },
    },
    {
      depth: 0.6,
      paint(b, L, R) {
        const u = L.u;
        const { ground } = hvGeom(L);
        const baseY = ground;
        const W = ['#241c2e', '#3c2e3e', '#5a4450', '#7a5c5e'];
        const RF = ['#160f22', '#2a1f36', '#4a3552'];
        // Houses across the north side of the square, the chapel and the Kettle among them.
        const row = L.portrait
          ? [
              { k: 'house', x: -0.04, w: 30, h: 22 },
              { k: 'chapel', x: 0.26, w: 36, h: 30 },
              { k: 'kettle', x: 0.64, w: 40, h: 28 },
            ]
          : [
              { k: 'house', x: 0.0, w: 32, h: 22 },
              { k: 'house', x: 0.13, w: 28, h: 25 },
              { k: 'chapel', x: 0.27, w: 40, h: 34 },
              { k: 'house', x: 0.45, w: 30, h: 21 },
              { k: 'kettle', x: 0.58, w: 48, h: 30 },
              { k: 'house', x: 0.8, w: 30, h: 24 },
            ];
        for (const hs of row) {
          const x = L.W * hs.x;
          const w = hs.w * u;
          const h = hs.h * u;
          if (hs.k === 'chapel') {
            house(b, x, baseY, w, h * 0.72, 16 * u, { wall: ['#2a2434', '#463c4c', '#6a5a64', '#8a7678'], roof: RF, windows: 1, door: true, doorLit: true, R });
            // The bell tower beside the nave.
            const tx = x + w * 0.64;
            const tw = 11 * u;
            const th = h * 1.3;
            for (let yy = 0; yy < th; yy++) for (let xx = 0; xx < tw; xx++) b.px(tx + xx, baseY - th + yy, rampSmooth(['#241e2e', '#3e3446', '#5e4e5c', '#80686c'], 0.25 + (xx / tw) * 0.55 - (yy / th) * 0.1, tx + xx, yy, 4));
            b.poly([[tx - 2, baseY - th], [tx + tw / 2, baseY - th - 16 * u], [tx + tw + 2, baseY - th]], RF[1]);
            b.line(tx + tw / 2, baseY - th - 16 * u, tx + tw + 2, baseY - th, RF[2]);
            b.rect(tx + tw / 2 - 2 * u, baseY - th + 4 * u, 4 * u, 5 * u, '#0c0a12');
            b.rect(tx + tw / 2 - 1 * u, baseY - th + 5.5 * u, 2 * u, 2.5 * u, '#c9a050');
            b.rect(tx, baseY - th, tw, 1, '#100c16');
            // a lit rose window in the gable
            b.ellipse(x + w * 0.32, baseY - h * 0.47, 4 * u, 4 * u, '#ffc870');
            b.ellipse(x + w * 0.32, baseY - h * 0.47, 1.6 * u, 1.6 * u, '#fff0b8');
            b.glow(x + w * 0.32, baseY - h * 0.47, 12 * u, '#ffb050', 0.4);
          } else if (hs.k === 'kettle') {
            const r = house(b, x, baseY, w, h, 15 * u, { wall: W, roof: RF, windows: 3, door: true, doorLit: true, chimney: true, R });
            // The lantern Elda lights in the top window every night.
            b.rect(x + w * 0.5 - 1.5 * u, r.top + 7 * u, 3 * u, 3 * u, '#ffe08a');
            b.glow(x + w * 0.5, r.top + 8.5 * u, 10 * u, '#ffc060', 0.5);
            // the sign over the door
            b.rect(x + w * 0.5 + 6 * u, baseY - h * 0.62, 6 * u, 4 * u, '#3a2618');
            b.rect(x + w * 0.5 + 7 * u, baseY - h * 0.62 + 1 * u, 4 * u, 2 * u, '#a06a30');
            for (const wpos of r.windows) b.glow(wpos[0], wpos[1], 9 * u, '#ff9a40', 0.4);
          } else {
            const r = house(b, x, baseY, w, h, 12 * u, { wall: W, roof: RF, windows: 2, lit: 0.6, R });
            for (const wpos of r.windows) b.glow(wpos[0], wpos[1], 8 * u, '#ff9a40', 0.35);
          }
        }
      },
    },
    {
      depth: 1,
      paint(b, L, R) {
        const u = L.u;
        const { ground, well, posts } = hvGeom(L);
        // The square: worn cobbles, cool in the dusk, warm in pools under the lamps.
        const cw = 6 * u;
        const ch = 3.5 * u;
        for (let y = R2(ground); y < L.H; y++) {
          for (let x = 0; x < L.W; x++) {
            const row = Math.floor((y - ground) / ch);
            const cx = Math.floor(x / cw + (row % 2) * 0.5);
            const inX = (x / cw + (row % 2) * 0.5) % 1;
            const inY = ((y - ground) / ch) % 1;
            const n = noise(cx, row, 5);
            let t = 0.36 + (n - 0.5) * 0.2 - ((y - ground) / (L.H - ground)) * 0.14;
            if (inY < 0.18) t += 0.07; // the lit top edge of each cobble
            if (inX < 0.12 || inY > 0.85) t -= 0.12;
            b.px(x, y, rampSmooth(['#0c0e1c', '#151829', '#1f2338', '#2a3048', '#3a425e'], clamp(t), x, y, 3));
          }
        }
        b.rect(0, ground, L.W, 1, '#0a0b14');
        // Lamp posts around the square, all lit at dusk, each with a warm pool on the stones.
        for (const px of posts) {
          const x = L.W * px;
          const y = ground + 12 * u;
          b.glow(x, y + 2, 26 * u, '#ff9a40', 0.32, 1.4);
          const head = lampPost(b, x, y, 22 * u, { lit: true });
          b.glow(head.x, head.y, 8 * u, '#ffc060', 0.55);
        }
        // Hobb on his ladder at one of the lamps.
        const lp = L.W * posts[posts.length - 2 < 0 ? 0 : posts.length - 2];
        const lx = lp + 5 * u;
        const ly = ground + 12 * u;
        for (const off of [0, 3 * u]) b.line(lx + off, ly, lx + off - 5 * u, ly - 20 * u, '#4a3426');
        for (let k = 1; k < 6; k++) b.line(lx - k * 0.85 * u, ly - k * 3.4 * u, lx + 3 * u - k * 0.85 * u, ly - k * 3.4 * u, '#5a4030');
        stamp(b, 'hobb', 'idle', 'left', R2(lx - 1 * u), R2(ly - 10 * u), { mul: [0.6, 0.58, 0.78], rim: { color: '#ffb060', side: -1, k: 0.55 } });
        // The well: a stone ring, two posts and a crossbeam, an iron-banded cap; the
        // Wellstone hums at the bottom of it.
        const wx = well.x;
        const wy = well.y;
        const wr = 15 * u;
        b.ellipse(wx + 2 * u, wy + 2 * u, wr + 4 * u, 5 * u, '#07080f', 0.55);
        for (let y = R2(wy - 10 * u); y < wy + 3 * u; y++) {
          for (let x = R2(wx - wr); x < wx + wr; x++) {
            const fx = (x - wx) / wr;
            const course = Math.floor((y - wy) / (3 * u));
            const brick = Math.floor((x - wx) / (5 * u) + (course % 2) * 0.5);
            const joint = ((y - wy) / (3 * u)) % 1 > 0.82 || ((x - wx) / (5 * u) + (course % 2) * 0.5) % 1 < 0.1;
            const t = clamp(0.28 + (1 - Math.abs(fx + 0.25)) * 0.45 + (noise(brick, course, 3) - 0.5) * 0.15 - (joint ? 0.15 : 0));
            b.px(x, y, rampSmooth(['#14172a', '#252a42', '#3a405c', '#565e7c', '#7a809a'], t, x, y, 3));
          }
        }
        b.ellipse(wx, wy - 10 * u, wr, 4.5 * u, '#3a3e58');
        b.ellipse(wx, wy - 10 * u, wr - 2 * u, 3.2 * u, '#2a2a36');
        // the iron bands across the cap
        for (const k of [-0.5, 0, 0.5]) b.rect(wx + k * wr - 0.5 * u, wy - 13 * u, 1.2 * u, 6 * u, '#14141c');
        b.rect(wx - wr + 2 * u, wy - 10.5 * u, (wr - 2 * u) * 2, 1, '#6a6070');
        b.rect(wx - wr + 1 * u, wy - 28 * u, 2 * u, 18 * u, '#2a2030');
        b.rect(wx + wr - 3 * u, wy - 28 * u, 2 * u, 18 * u, '#2a2030');
        b.rect(wx - wr, wy - 30 * u, wr * 2, 2.5 * u, '#3a2c38');
        b.rect(wx - wr, wy - 30 * u, wr * 2, 1, '#5a4652');
        b.rect(wx - 1, wy - 27.5 * u, 1, 8 * u, '#6a6070');
        b.outline(OUTLINE);
      },
    },
  ],
  particles: [
    { type: 'embers', count: 14, x0: (L) => L.W * (L.portrait ? 0.64 : 0.58) + 34 * L.u, y0: (L) => L.cy - 6 * L.u, rise: 50, spread: 6, colors: ['#9a90a8', '#7a7088'], depth: 0.6 },
    { type: 'motes', count: 20, colors: ['#ffd8a0'], y0: (L) => L.cy, y1: (L) => L.H },
  ],
  anim(ctx, L, t, inst) {
    // The Wellstone hums: faint rings rising out of the well, slow as breath.
    const { well, u } = hvGeom(L);
    const o = inst.offset(1, t);
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.16 + i / 3) % 1;
      const rx = (10 + k * 36) * u;
      const ry = rx * 0.3;
      const cx = well.x - o.x;
      const cy = well.y - 10 * u - o.y;
      ctx.globalAlpha = 0.4 * (1 - k) * Math.min(1, k * 4);
      ctx.fillStyle = '#c8d8ff';
      for (let a = 0; a < Math.PI * 2; a += 0.05) ctx.fillRect(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), 1, 1);
    }
    ctx.globalAlpha = 1;
  },
  lights(L, t) {
    const u = L.u;
    const { ground, well, posts } = hvGeom(L);
    const out = posts.map((p) => ({ x: L.W * p, y: ground + 12 * u - 24 * u, r: 36 * u, color: '#ffb050', k: 0.55, flicker: true, depth: 1 }));
    out.push({ x: well.x, y: well.y - 11 * u, r: 28 * u, color: '#a8c0ff', k: 0.14 + 0.06 * Math.sin(t * 1.3), depth: 1 });
    out.push({ x: L.W * 0.6, y: L.cy + 10 * u, r: 120 * u, color: '#ff9050', k: 0.12, depth: 0.08 });
    return out;
  },
};

export const WORLD_PANELS = { halcyre, the_drift, warded_villages, hearthvale_dusk };
