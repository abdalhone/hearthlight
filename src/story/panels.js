// The illustrated panels of the story (DESIGN §20): procedurally painted pixel-art scenes
// in the game's mood (§18) — deep blue nights, warm practical lights with soft bloom, fog,
// a faint dither and a vignette. Each panel is a few parallax layers painted once at low
// resolution, plus particles, lights and small animations drawn every frame by
// panel_view.js. Layouts adapt to the screen's shape (see makeLayout): subjects sit at
// (L.cx, L.cy), sizes scale with L.u.

import { Buf, rampAt, fbm, noise, clamp, lerp, mix, hex, smooth, bayer, rng } from './paint.js';
import { sky, stars, mountains, ridgeLine, fillBelow, snowField, pine, treeline, house, lampPost, standingStone, fogBand, tinyFigure, OUTLINE } from './scene_kit.js';
import { stamp, greyWeave } from './cast.js';

const R2 = (v) => Math.round(v);

// ------------------------------------------------------------------ colour ramps

const SNOW_DAWN = ['#3b4470', '#56628f', '#7d88b4', '#a9b3d6', '#d3d9ee', '#f4f1f0'];
const SNOW_NIGHT = ['#141a33', '#1d2645', '#2a3558', '#3c4a72', '#56679a', '#8395c4'];
const ROCK_BLUE = ['#151827', '#262b40', '#3b4259', '#566079', '#7c88a3'];
const ROCK_WARM = ['#1b1820', '#2e2a36', '#48434f', '#6a6270', '#958a90'];
const PEAK_SNOW = ['#4a5784', '#6c79a8', '#98a3cb', '#c9cde6', '#f1e6e2'];
const STONE_GREY = ['#1c1f2c', '#30364a', '#4a5269', '#6c7690', '#a1a9c0'];

function sword(b, x, y, len, ang, { blade = ['#2a2f3d', '#5b6478', '#a9b4cc'], hilt = '#3a2418', guard = '#8a7a5a', glint = '#e8f0ff' } = {}) {
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  for (let i = 0; i < len; i++) {
    const px = x + dx * i;
    const py = y + dy * i;
    b.px(px, py, i < len * 0.2 ? hilt : blade[1]);
    if (i >= len * 0.2) {
      b.px(px - dy, py + dx, blade[0]);
      b.px(px + dy * 0.6, py - dx * 0.6, blade[2], 0.8);
    }
  }
  const gx = x + dx * len * 0.2;
  const gy = y + dy * len * 0.2;
  b.line(gx - dy * 2.5, gy + dx * 2.5, gx + dy * 2.5, gy - dx * 2.5, guard);
  b.px(x + dx * len * 0.7, y + dy * len * 0.7, glint);
}

// ======================================================================= crown_ring

const crown_ring = {
  id: 'crown_ring',
  short: 160,
  title: 'The Crown Ring',
  seed: 9,
  pan: 'right',
  layers: [
    {
      depth: 0.12,
      paint(b, L, R) {
        const hz = L.cy - 26 * L.u;
        sky(b, L, ['#121838', '#1e2550', '#36356a', '#644a7c', '#a86a80', '#de9c88', '#f6cf9c'], { y1: hz + 6, power: 1.3 });
        stars(b, L, R, { count: 40, y1: hz * 0.45, colors: ['#e9e4ff', '#ffe9d6'] });
        // The far Crownfells, pale with distance, lit by the dawn on the right.
        mountains(b, L, 21, { base: hz + 4, amp: 18 * L.u, freq: 0.016, rock: ['#45436c', '#57537e', '#706792', '#9583a6'], snow: ['#8a86ad', '#b3a8c6', '#dcc8d4', '#f6e2dc'], snowLine: 0.75, light: 1, haze: '#b98d98', hazeK: 0.3,
          peaks: [{ x: L.W * 0.2, w: 46 * L.u, h: 18 * L.u, sharp: true }, { x: L.W * 0.8, w: 64 * L.u, h: 26 * L.u, sharp: true }] });
      },
    },
    {
      depth: 0.3,
      paint(b, L, R) {
        const hz = L.cy - 18 * L.u;
        mountains(b, L, 33, { base: hz + 10 * L.u, amp: 10 * L.u, freq: 0.022, rock: ['#25264a', '#34355c', '#4c4a76', '#6e6290'], snow: PEAK_SNOW, snowLine: 0.9, light: 1, lightColor: '#f0b090', haze: '#7d6a93', hazeK: 0.1,
          peaks: [{ x: L.W * 0.04, w: 56 * L.u, h: 24 * L.u, sharp: true }, { x: L.W * 0.98, w: 48 * L.u, h: 18 * L.u }] });
        fogBand(b, L, 41, { y: hz + 10 * L.u, h: 7 * L.u, color: '#c7a3b4', alpha: 0.45, freq: 0.03 });
      },
    },
    {
      depth: 1,
      paint(b, L, R) {
        const u = L.u;
        const ringY = L.cy + 14 * u;
        const groundY = L.cy - 12 * u;
        // The shoulder of the Hollowcrown: a wide snow field rising gently to the back.
        snowField(b, L, 5, { base: groundY, amp: 4 * u, freq: 0.012, ramp: SNOW_DAWN, lightX: L.W * 0.9, lightK: 0.32 });
        const rx = L.portrait ? L.vw * 0.47 : Math.min(L.vw * 0.4, 104 * u);
        const ry = rx * (L.portrait ? 0.42 : 0.3);
        // The melted circle: dark wet earth and flattened grass, a rim of grey slush.
        const mrx = 32 * u;
        const mry = 10 * u;
        for (let y = R2(ringY - mry - 3); y <= ringY + mry + 3; y++) {
          for (let x = R2(L.cx - mrx - 5); x <= L.cx + mrx + 5; x++) {
            const d = Math.hypot((x - L.cx) / mrx, (y - ringY) / mry);
            if (d < 1) {
              const n = fbm(x * 0.12, y * 0.25, 4, 3);
              const grass = n > 0.5;
              const lightK = (x - L.cx) / mrx * 0.18 - (y - ringY) / mry * 0.1;
              const c = grass ? rampAt(['#141f18', '#1f3020', '#2f4529', '#4a6034'], 0.35 + (n - 0.5) * 2.2 + lightK - d * 0.25, x, y) : rampAt(['#100d12', '#1b161e', '#2a222d', '#3d3240'], 0.5 + lightK - d * 0.35, x, y);
              b.px(x, y, c);
              if (!grass && n < 0.38 && bayer(x, y) > 0.75) b.add(x, y, '#f0b08a', 0.2);
            } else if (d < 1.2) {
              b.px(x, y, rampAt(['#4a5278', '#6f79a3', '#a9b1d2', '#d6dbee'], (d - 1) / 0.2, x, y));
            }
          }
        }
        // The nine stones, set so none hides the circle; back half first.
        const stones = [];
        for (let i = 0; i < 9; i++) {
          const a = Math.PI / 2 + Math.PI / 9 + (i / 9) * Math.PI * 2;
          const front = Math.sin(a);
          const scale = (1 + front * 0.22) * (L.portrait ? 0.8 : 1);
          const broken = i === 4 || i === 7;
          const hh = (broken ? 9 + noise(i, 1, 4) * 5 : 22 + noise(i, 2, 9) * 18) * u * scale;
          stones.push({ x: L.cx + Math.cos(a) * rx, y: ringY + front * ry, w: (9 + noise(i, 5, 9) * 6) * u * scale, h: hh, i, broken, lean: (noise(i, 7, 3) - 0.5) * 0.5 });
        }
        stones.sort((p, q) => p.y - q.y);
        const drawStone = (s) => {
          // A long blue shadow cast away from the dawn, to the left.
          const len = s.h * 1.4;
          for (let k = 0; k < len; k++) {
            const w = s.w * (0.55 - (k / len) * 0.3);
            b.rect(s.x - k - w / 2, s.y - 1 + k * 0.12, w, 2, '#262c55', 0.3 * (1 - k / len) + 0.08);
          }
          standingStone(b, s.x, s.y, s.w, s.h, { rock: STONE_GREY, lightSide: 1, lightColor: '#f3a679', snowCap: '#f3efff', broken: s.broken ? 1.4 : 0.55, seed: s.i + 3, script: s.i % 3 === 1 ? '#c9d6ff' : null, lean: s.lean });
        };
        stones.filter((s) => s.y <= ringY).forEach(drawStone);
        // The stranger lying in the circle, in the grey weave they were found in, the sword beside.
        stamp(b, 'player', 'down', 'down', R2(L.cx - 1 * u), R2(ringY + 5 * u), { mul: [0.82, 0.84, 0.98], recolor: greyWeave, rim: { color: '#ffb68a', side: 1, k: 0.3 } });
        sword(b, L.cx + 12 * u, ringY - 3 * u, 16 * u, 0.28);
        stones.filter((s) => s.y > ringY).forEach(drawStone);
        // A fallen slab half under the snow at the front.
        b.ellipse(L.cx - rx * 0.55, ringY + ry + 14 * u, 14 * u, 3 * u, '#3a4260');
        b.ellipse(L.cx - rx * 0.55, ringY + ry + 13 * u, 13 * u, 2 * u, '#e8ecf8');
      },
    },
  ],
  particles: [
    { type: 'snow', count: 60, speed: 6, wind: 16, colors: ['#ffffff', '#e8ecff', '#ffe8dc'] },
    { type: 'twinkle', count: 45, colors: ['#ffffff', '#ffe0c0'], y0: (L) => L.cy - 8 * L.u, y1: (L) => L.H, depth: 1, bigChance: 0.08 },
  ],
  lights(L, t) {
    const u = L.u;
    return [
      { x: L.W * 0.8, y: L.cy - 34 * u, r: 110 * u, color: '#ffc890', k: 0.45, depth: 0.12 },
      { x: L.cx, y: L.cy + 14 * u, r: 40 * u, color: '#ffb070', k: 0.2 + 0.06 * Math.sin(t * 0.8), depth: 1 },
    ];
  },
};

import { WORLD_PANELS } from './panels_world.js';
import { LIFE_PANELS } from './panels_life.js';
import { JOURNEY_PANELS } from './panels_journey.js';

export const PANELS = { ...WORLD_PANELS, ...LIFE_PANELS, ...JOURNEY_PANELS, crown_ring };

export { sword, SNOW_DAWN, SNOW_NIGHT, ROCK_BLUE, ROCK_WARM, PEAK_SNOW, STONE_GREY };
