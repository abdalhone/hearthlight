// Panels of Lyra's life and Maren's thread: the brightfall winter, the night of the lamps,
// the Weeping Cut and the Sunken Ruins (LORE §3, §7).

import { Buf, rampAt, rampSmooth, fbm, noise, clamp, lerp, mix, hex, smooth, bayer } from './paint.js';
import { sky, stars, mountains, ridgeLine, fillBelow, snowField, pine, treeline, house, lampPost, fogBand, OUTLINE } from './scene_kit.js';
import { stamp } from './cast.js';

const R2 = (v) => Math.round(v);
const SNOW_NIGHT = ['#121831', '#1a2341', '#243052', '#334268', '#465a86', '#6a80b0', '#9db0da'];
const NIGHT_MUL = [0.55, 0.58, 0.82];

// ======================================================================= brightfall

function bfGeom(L) {
  const u = L.u;
  return { u, ground: L.cy + 22 * u, lampX: L.portrait ? L.W * 0.34 : L.W * 0.3 };
}

const brightfall = {
  id: 'brightfall',
  short: 150,
  title: 'The Brightfall winter',
  seed: 41,
  pan: 'right',
  layers: [
    {
      depth: 0.08,
      paint(b, L, R) {
        const u = L.u;
        sky(b, L, ['#04050f', '#080b1e', '#0d1430', '#141e42', '#1d2a54', '#2a3866'], { y1: L.cy + 20 * u });
        stars(b, L, R, { count: 60, y1: L.cy * 0.8 });
        // The sky itself seems lit from within: a pale veil high over the valley.
        for (let y = 0; y < L.cy; y++) {
          for (let x = 0; x < L.W; x++) {
            const n = fbm(x * 0.008, y * 0.02, 44, 4);
            const k = smooth(0.45, 0.8, n) * (1 - y / L.cy) * 0.28;
            const q = Math.floor(k * 10 + bayer(x, y)) / 10;
            if (q > 0) b.add(x, y, mix('#ffe6b0', '#b8d8ff', x / L.W), q * 0.6);
          }
        }
      },
    },
    {
      depth: 0.3,
      paint(b, L, R) {
        const u = L.u;
        const line = ridgeLine(L, 45, { base: L.cy + 10 * u, amp: 8 * u, freq: 0.012, oct: 3 });
        fillBelow(b, line, (x, y, d) => rampSmooth(['#141c36', '#1c2644', '#26324f', '#34436a'], clamp(0.3 + (d < 3 ? 0.4 : 0) + (fbm(x * 0.03, y * 0.08, 46, 3) - 0.5) * 0.3 - d * 0.01), x, y, 3));
        // Whisperwood's edge, snow on every tier.
        treeline(b, L, R, line, { density: 0.42, hMin: 9 * u, hMax: 22 * u, colors: { dark: '#0b1124', mid: '#111c34', lit: '#22344e' }, snow: '#7d8fba', lightSide: -1 });
      },
    },
    {
      depth: 1,
      paint(b, L, R) {
        const u = L.u;
        const { ground, lampX } = bfGeom(L);
        // The meadow under snow, brighter where the falling light has settled.
        const line = snowField(b, L, 47, { base: ground, amp: 4 * u, freq: 0.01, ramp: SNOW_NIGHT, lightX: L.cx + 20 * u, lightK: 0.35, rough: 0.2 });
        for (let i = 0; i < 9; i++) {
          const gx = R() * L.W;
          const gy = ground + 10 * u + R() * (L.H - ground - 10 * u) * 0.6;
          b.glow(gx, gy, (14 + R() * 18) * u, '#ffe2a8', 0.18, 1.4);
        }
        // Moonpetals blooming in the frost: small pale stars on the snow.
        for (let i = 0; i < 70; i++) {
          const x = R() * L.W;
          const y = line[Math.min(L.W - 1, R2(x))] + 4 * u + R() ** 0.7 * (L.H - ground);
          const c = R() < 0.5 ? '#dff2ff' : '#bfe0ff';
          b.px(x, y - 1, c);
          b.px(x - 1, y, c, 0.8);
          b.px(x + 1, y, c, 0.8);
          b.px(x, y + 1, '#7aa0d0', 0.8);
          b.px(x, y, '#ffffff');
          if (R() < 0.35) b.glow(x, y, 5 * u, '#b8e0ff', 0.35);
        }
        // The edge of the village: the chandlery's corner, a lit window, a lamp.
        const hx = lampX - 46 * u;
        house(b, hx, ground + 6 * u, 34 * u, 26 * u, 14 * u, { wall: ['#1e1a2e', '#302840', '#463a52', '#5e4e62'], roof: ['#141022', '#221a32', '#3a3050'], windows: 2, door: true, doorLit: false, snow: '#dfe8ff' });
        const head = lampPost(b, lampX, ground + 10 * u, 24 * u, { lit: true });
        b.glow(head.x, head.y, 34 * u, '#ffb050', 0.42, 1.6);
        // Hobb and Wenna under the lamp, looking up into the falling light.
        stamp(b, 'hobb', 'idle', 'up', R2(lampX + 10 * u), R2(ground + 14 * u), { mul: NIGHT_MUL, rim: { color: '#ffb060', side: -1, k: 0.55 } });
        stamp(b, 'wenna', 'idle', 'up', R2(lampX + 22 * u), R2(ground + 15 * u), { mul: NIGHT_MUL, rim: { color: '#ffb060', side: -1, k: 0.5 } });
        b.outline(OUTLINE);
      },
    },
  ],
  particles: [
    { type: 'brightfall', count: 150, speed: 4, wind: 0.6, colors: ['#fff6d8', '#ffe8a8', '#d8f0ff', '#ffffff', '#ffd890'], bigChance: 0.3, glowR: 7, glowK: 0.45 },
    { type: 'twinkle', count: 50, colors: ['#ffffff', '#d8f0ff'], y0: (L) => L.cy + 24 * L.u, y1: (L) => L.H, depth: 1, bigChance: 0.06 },
  ],
  lights(L, t) {
    const { ground, lampX, u } = bfGeom(L);
    return [
      { x: lampX, y: ground + 10 * u - 26 * u, r: 46 * u, color: '#ffb050', k: 0.55, flicker: true, depth: 1 },
      { x: L.cx, y: L.cy * 0.3, r: 150 * u, color: '#ffe6b0', k: 0.14 + 0.04 * Math.sin(t * 0.5), depth: 0.08 },
    ];
  },
};

// ======================================================================= night_of_lamps

function nolGeom(L) {
  const u = L.u;
  const ground = L.cy + 14 * u;
  const cx = L.cx;
  const cy = L.cy + 40 * u;
  const n = 6;
  const lamps = [];
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (i / (n - 1)) * Math.PI;
    const rx = L.portrait ? L.vw * 0.44 : Math.min(L.vw * 0.42, 130 * u);
    lamps.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * 26 * u + 6 * u, burst: i === 4 });
  }
  return { u, ground, cx, cy, lamps };
}

const night_of_lamps = {
  id: 'night_of_lamps',
  short: 140,
  title: 'The night of the lamps',
  seed: 52,
  pan: 'none',
  layers: [
    {
      depth: 0.15,
      paint(b, L, R) {
        const u = L.u;
        sky(b, L, ['#04030c', '#080818', '#0e1028', '#151a3a', '#1e2650'], { y1: L.cy });
        stars(b, L, R, { count: 70, y1: L.cy * 0.8 });
        // The star they call Lyra, low over the mountain on Longwatch morning.
        b.px(L.W * 0.78, L.cy * 0.3, '#ffffff');
        b.glow(L.W * 0.78, L.cy * 0.3, 6 * u, '#cfd8ff', 0.6);
      },
    },
    {
      depth: 0.5,
      paint(b, L, R) {
        const u = L.u;
        const { ground } = nolGeom(L);
        const W = ['#1a1626', '#2a2236', '#3c3046', '#52425a'];
        const RF = ['#100c1a', '#1c1628', '#2c2438'];
        const row = L.portrait ? [[-0.1, 46, 34], [0.3, 70, 50], [0.82, 44, 36]] : [[-0.02, 48, 34], [0.17, 44, 38], [0.38, 84, 52], [0.68, 46, 36], [0.86, 50, 40]];
        for (const [fx, w, hh] of row) {
          const isKettle = w >= 70;
          const x = L.W * fx;
          house(b, x, ground, w * u, hh * u, 18 * u, { wall: W, roof: RF, windows: isKettle ? 4 : 2, lit: isKettle ? 1 : 0.3, door: !isKettle, snow: '#cfdaf4', R });
          if (isKettle) {
            // The Kettle's door thrown open, and Maren in it, in her nightgown.
            const dx = x + (w * u) / 2;
            const dw = 16;
            const dh = 30;
            b.rect(dx - dw / 2 - 1, ground - dh - 1, dw + 2, dh + 1, '#140f18');
            for (let yy = 0; yy < dh; yy++) for (let xx = 0; xx < dw; xx++) b.px(dx - dw / 2 + xx, ground - dh + yy, rampAt(['#b86a2a', '#e8a050', '#ffd08a'], 0.3 + (1 - yy / dh) * 0.5, xx, yy));
            b.glow(dx, ground - 10, 30 * u, '#ffb050', 0.5);
            // her grey robe reads as a pale nightgown against the light; the outline stays dark
            const gown = (r0, g0, b0) => {
              const lum = (r0 + g0 + b0) / 3;
              return Math.abs(r0 - b0) < 30 && Math.abs(r0 - g0) < 30 && lum > 55 && lum < 150 ? [lum * 1.5, lum * 1.45, lum * 1.38] : [r0, g0, b0];
            };
            stamp(b, 'maren', 'idle', 'down', R2(dx), R2(ground), { mul: [0.62, 0.55, 0.58], rim: { color: '#ffc070', side: 1, k: 0.5 }, recolor: gown });
          }
        }
      },
    },
  {
      depth: 1,
      paint(b, L, R) {
        const u = L.u;
        const { ground, cx, cy, lamps } = nolGeom(L);
        // The square under snow and ice, lit violet from every side.
        for (let y = R2(ground); y < L.H; y++) {
          for (let x = 0; x < L.W; x++) {
            const n = fbm(x * 0.02, y * 0.06, 53, 3);
            const drift = fbm(x * 0.012, y * 0.05, 54, 3);
            const ice = Math.hypot((x - cx) / (80 * u), (y - cy) / (20 * u)) < 1 && n > 0.42;
            let t = 0.3 + (drift - 0.5) * 0.5 + (n - 0.5) * 0.15 - ((y - ground) / (L.H - ground)) * 0.12;
            if (ice) t = 0.35 + (n - 0.5) * 0.4;
            b.px(x, y, rampSmooth(ice ? ['#0e1030', '#181c48', '#262c66', '#3a4288', '#5662b0'] : SNOW_NIGHT, clamp(t), x, y, 3));
            // the lamps' violet caught in the ice in long streaks
            if (ice && Math.sin(y * 2.1 + x * 0.05) > 0.92) b.add(x, y, '#a184ff', 0.25);
          }
        }
        for (const lp of lamps) b.glow(lp.x, lp.y, 46 * u, '#8a6aff', 0.45, 1.4);
        // The lamps, every one burning violet; one has burst.
        for (const lp of lamps) {
          if (lp.burst) {
            b.rect(lp.x, lp.y - 26 * u, 1, 26 * u, '#1a1822');
            b.rect(lp.x - 1, lp.y - 29 * u, 3, 2, '#2a2836');
            for (let k = 0; k < 7; k++) b.px(lp.x + (R() - 0.5) * 10 * u, lp.y - (R() * 5) * u, '#c8b8ff', 0.8);
          } else {
            lampPost(b, lp.x, lp.y, 24 * u, { lit: true, glass: '#a995ff', flame: '#f0e8ff' });
          }
        }
        // Hobb sitting up on the ice by his fallen ladder.
        const hx = cx + (L.portrait ? 26 : 40) * u;
        const hy = cy + 8 * u;
        b.line(hx - 30 * u, hy + 6 * u, hx + 4 * u, hy - 4 * u, '#5a4030');
        b.line(hx - 29 * u, hy + 9 * u, hx + 5 * u, hy - 1 * u, '#5a4030');
        for (let k = 0; k < 8; k++) {
          const t = k / 8;
          b.line(lerp(hx - 30 * u, hx + 4 * u, t), lerp(hy + 6 * u, hy - 4 * u, t), lerp(hx - 29 * u, hx + 5 * u, t), lerp(hy + 9 * u, hy - 1 * u, t), '#6a4a36');
        }
        stamp(b, 'hobb', 'sit', 'left', R2(hx + 6 * u), R2(hy + 2 * u), { mul: [0.6, 0.55, 0.9], rim: { color: '#b9a8ff', side: -1, k: 0.6 } });
        // The girl in the middle of it, arms up, eleven years old and furious.
        b.glow(cx - 4 * u, cy - 10 * u, 26 * u, '#b9a8ff', 0.35);
        stamp(b, 'lyra_young', 'idle', 'down', R2(cx - 4 * u), R2(cy), { mul: [0.85, 0.8, 1.0], rim: { color: '#e0d4ff', side: 1, k: 0.55 } });
        b.outline(OUTLINE);
      },
    },
  ],
  particles: [
    { type: 'embers', count: 40, x0: (L) => nolGeom(L).lamps[4].x, y0: (L) => nolGeom(L).lamps[4].y - 26 * L.u, rise: 40, spread: 22, colors: ['#c8b8ff', '#ffffff', '#8a6aff'], depth: 1 },
    { type: 'snow', count: 50, speed: 4, wind: 2, colors: ['#e8e4ff', '#ffffff'] },
  ],
  lights(L, t) {
    const { lamps, u, cx, cy } = nolGeom(L);
    // Every lamp on the square flares at once as the panel opens, then settles.
    const flare = Math.max(0, 1 - t / 1.6);
    const out = lamps.filter((l) => !l.burst).map((lp) => ({ x: lp.x, y: lp.y - 27 * u, r: (44 + flare * 40) * u, color: '#a184ff', k: 0.75 + flare * 0.9, flicker: true, depth: 1 }));
    const b = lamps.find((l) => l.burst);
    out.push({ x: b.x, y: b.y - 26 * u, r: 30 * u, color: '#e8e0ff', k: 0.3 + 0.3 * Math.max(0, Math.sin(t * 3)), depth: 1 });
    out.push({ x: cx - 4 * u, y: cy - 12 * u, r: 36 * u, color: '#c9b8ff', k: 0.22, depth: 1 });
    return out;
  },
};

// ======================================================================= weeping_cut

function cutGeom(L) {
  const u = L.u;
  return { u, cx: L.cx + (L.portrait ? 0 : 6 * u), top: L.cy - 34 * u, foot: L.cy + 30 * u, w: 22 * u };
}

const STONE = ['#121218', '#1e1d26', '#2c2a34', '#3e3a44', '#55505a', '#716a70', '#8e8484'];

const weeping_cut = {
  id: 'weeping_cut',
  title: 'The Weeping Cut',
  seed: 63,
  pan: 'none',
  layers: [
    {
      depth: 0.1,
      paint(b, L, R) {
        sky(b, L, ['#0d0f1c', '#161a2c', '#22283c', '#30364c', '#454a5e', '#5d5e6e'], { y1: L.cy - 20 * L.u, smoothBands: true, grain: 4 });
      },
    },
    {
      depth: 0.3,
      paint(b, L, R) {
        const u = L.u;
        // The quarry rim against the sky, dark pines along it.
        const line = ridgeLine(L, 64, { base: L.cy - 44 * u, amp: 4 * u, freq: 0.02, oct: 3 });
        fillBelow(b, line, (x, y, d) => rampSmooth(['#0c0d14', '#14151e', '#1c1d28'], clamp(0.4 + (d < 2 ? 0.3 : 0)), x, y, 3));
        treeline(b, L, R, line, { density: 0.5, hMin: 6 * u, hMax: 14 * u, colors: { dark: '#07080e', mid: '#0c0f18', lit: '#1a2230' } });
      },
    },
    {
      depth: 0.7,
      paint(b, L, R) {
        const u = L.u;
        const { cx, top, foot, w } = cutGeom(L);
        // The north face: quarried stone in uneven benches and blocks, broken by vertical
        // joints, cold in the twilight, wet below the Cut.
        const faceTop = L.cy - 42 * u;
        const strata = [];
        let yy0 = faceTop;
        let si = 0;
        while (yy0 < L.H) {
          const hgt = (13 + noise(si, 1, 70) * 14) * u;
          strata.push({ y: yy0, h: hgt, i: si });
          yy0 += hgt;
          si++;
        }
        for (let y = R2(faceTop); y < L.H; y++) {
          for (let x = 0; x < L.W; x++) {
            const wav = (fbm(x * 0.03, 1, 71, 2) - 0.5) * 5 * u;
            let st = strata[0];
            for (const q of strata) if (y + wav >= q.y) st = q;
            const inY = (y + wav - st.y) / st.h;
            // vertical joints at irregular spacing, different in every bench
            const jx = (x + (y - st.y) * (noise(st.i, 4, 72) - 0.5) * 0.8) / ((26 + noise(st.i, 2, 72) * 30) * u) + noise(st.i, 3, 72) * 7;
            const inX = jx % 1;
            const block = Math.floor(jx);
            const n = fbm(x * 0.06, y * 0.1, 65, 3);
            let t = 0.36 + (noise(block, st.i, 73) - 0.5) * 0.18 + (n - 0.5) * 0.3;
            if (inY < 0.1) t += 0.2; // the bench's top edge catches the sky
            else if (inY > 0.88) t -= 0.2; // the shadow under the next ledge
            if (inX < 0.04) t -= 0.22;
            else if (inX < 0.08) t += 0.08;
            if (y > foot + 6 * u + wav) {
              // the quarry floor: gravel and grit, flat and wet
              const g = fbm(x * 0.2, y * 0.35, 75, 2);
              t = 0.3 + (g - 0.5) * 0.35 - ((y - foot) / (L.H - foot)) * 0.08 + (bayer(x, y) > 0.85 && g > 0.6 ? 0.2 : 0);
              b.px(x, y, rampSmooth(['#0e0e14', '#18171f', '#24222c', '#34303a', '#4a4450'], clamp(t), x, y, 3));
              continue;
            }
            // dark wet streaks down the face, and moss in the joints
            const streak = fbm(x * 0.15, y * 0.01, 76, 2);
            if (streak > 0.68) t -= (streak - 0.68) * 1.2;
            b.px(x, y, rampSmooth(STONE, clamp(t), x, y, 4));
            if (inX < 0.04 && fbm(x * 0.1, y * 0.1, 77, 2) > 0.55) b.px(x + 1, y, '#2a3a28', 0.8);
          }
        }
        // The lip where the face meets the floor.
        for (let x = 0; x < L.W; x++) b.px(x, R2(foot + 6 * u + (fbm(x * 0.03, 1, 71, 2) - 0.5) * 5 * u), '#08080c');
        // The Cut: a black crack in the face, weeping at its foot.
        const pts = [];
        for (let k = 0; k <= 10; k++) {
          const yy = lerp(top, foot, k / 10);
          const wid = w * (0.45 + Math.sin((k / 10) * Math.PI) * 0.55) * (0.85 + noise(k, 1, 66) * 0.3);
          pts.push([cx - wid / 2 + (noise(k, 2, 66) - 0.5) * 4 * u, yy]);
        }
        for (let k = 10; k >= 0; k--) {
          const yy = lerp(top, foot, k / 10);
          const wid = w * (0.45 + Math.sin((k / 10) * Math.PI) * 0.55) * (0.85 + noise(k, 3, 66) * 0.3);
          pts.push([cx + wid / 2 + (noise(k, 4, 66) - 0.5) * 4 * u, yy]);
        }
        b.poly(pts, '#040407');
        // A sickly light far back inside.
        b.glow(cx, (top + foot) / 2 + 8 * u, 10 * u, '#3fa898', 0.35);
        // Lips of the crack catch the light.
        for (const [x, y] of pts) b.px(x + (x < cx ? -1 : 1), y, '#6a6470');
        // Bram's iron stakes, driven across the mouth.
        for (let k = 0; k < 5; k++) {
          const yy = top + ((k + 1) / 6) * (foot - top);
          const x0 = cx - w * 0.85;
          const x1 = cx + w * 0.85;
          const tilt = (k % 2 ? 1 : -1) * 3 * u;
          b.line(x0, yy - tilt, x1, yy + tilt, '#1a1418');
          b.line(x0, yy - tilt - 1, x1, yy + tilt - 1, '#4a3a36');
          b.line(x0 + 2, yy - tilt - 1, x0 + w * 0.5, yy - tilt * 0.4 - 1, '#7a5a4a');
          b.rect(x0 - 1, yy - tilt - 1.5, 3, 3, '#2a2226');
          b.rect(x1 - 1, yy + tilt - 1.5, 3, 3, '#2a2226');
        }
        // The seep: a wet dark streak from under the stakes down to the pool.
        for (let y = R2(foot - 2 * u); y < foot + 26 * u; y++) {
          const sw = 3 * u + (y - foot) * 0.15;
          for (let x = R2(cx - sw); x < cx + sw; x++) {
            b.mul(x, y, 0.62);
            if (bayer(x, y) > 0.9) b.add(x, y, '#7ab8c0', 0.25);
          }
        }
        b.outline(OUTLINE);
      },
    },
    {
      depth: 1,
      paint(b, L, R) {
        const u = L.u;
        const { cx, foot } = cutGeom(L);
        // The rain-pool at the foot, holding the sky; a slime glinting in it.
        const py = foot + 34 * u;
        const prx = L.portrait ? L.vw * 0.42 : 64 * u;
        for (let y = R2(py - 10 * u); y < py + 10 * u; y++) {
          for (let x = R2(cx - prx); x < cx + prx; x++) {
            const d = Math.hypot((x - cx) / prx, (y - py) / (10 * u));
            if (d > 1) continue;
            const refl = clamp(0.25 + (fbm(x * 0.05, y * 0.4, 67, 2) - 0.5) * 0.3 + (1 - d) * 0.15);
            b.px(x, y, rampSmooth(['#06080e', '#0e1420', '#1a2234', '#2c3448'], refl, x, y, 3));
            if (d > 0.9) b.px(x, y, '#3a3e4c');
          }
        }
        // The slime: translucent teal-green, a highlight, a dark core.
        const sx = cx + prx * 0.35;
        const sy = py - 1 * u;
        b.ellipse(sx, sy, 7 * u, 4 * u, '#1c6a5e', 0.85);
        b.ellipse(sx, sy - 1 * u, 5.5 * u, 3 * u, '#2f9a82', 0.85);
        b.ellipse(sx - 2 * u, sy - 2 * u, 1.5 * u, 1 * u, '#b8fff0');
        b.ellipse(sx + 1 * u, sy, 1.5 * u, 1 * u, '#0c3a34');
        b.glow(sx, sy, 16 * u, '#3fd0a0', 0.25);
        // Rubble and broken stone in front.
        for (let i = 0; i < 18; i++) {
          const x = R() * L.W;
          const y = foot + 14 * u + R() * (L.H - foot);
          if (Math.hypot((x - cx) / prx, (y - py) / (12 * u)) < 1.1) continue;
          const r = (2 + R() * 5) * u;
          b.ellipse(x, y, r, r * 0.6, '#16151c');
          b.ellipse(x - r * 0.2, y - r * 0.2, r * 0.75, r * 0.38, '#3a3640');
          b.line(x - r * 0.6, y - r * 0.45, x + r * 0.2, y - r * 0.55, '#6a6270');
        }
        b.outline(OUTLINE);
      },
    },
  ],
  particles: [
    { type: 'drips', count: 14, from: (L) => [[cutGeom(L).cx - 4, cutGeom(L).foot - 3], [cutGeom(L).cx + 3, cutGeom(L).foot - 2], [cutGeom(L).cx - 12, cutGeom(L).top + 20]], fall: 24, colors: ['#9ad8e0', '#e0f8ff'], depth: 0.7 },
    { type: 'motes', count: 26, colors: ['#8aa8b8', '#b8c8d0'], y0: (L) => L.cy - 40 * L.u, y1: (L) => L.H },
  ],
  lights(L, t) {
    const { cx, foot, top, u } = cutGeom(L);
    return [
      { x: cx, y: (top + foot) / 2 + 8 * u, r: 26 * u, color: '#3fa898', k: 0.18 + 0.08 * Math.sin(t * 0.7), depth: 0.7 },
      { x: cx + (L.portrait ? L.vw * 0.42 : 64 * u) * 0.35, y: foot + 33 * u, r: 22 * u, color: '#3fd0a0', k: 0.25, depth: 1 },
    ];
  },
};

// ======================================================================= maren_ruins

function ruinGeom(L) {
  const u = L.u;
  return { u, wallTop: L.cy - 34 * u, wallFoot: L.cy + 24 * u, mx: L.portrait ? L.cx + 10 * u : L.W * 0.42 };
}

const maren_ruins = {
  id: 'maren_ruins',
  short: 140,
  title: 'The Sunken Ruins',
  seed: 74,
  pan: 'right',
  layers: [
    {
      depth: 0.08,
      paint(b, L, R) {
        const u = L.u;
        sky(b, L, ['#03040c', '#070a1a', '#0c1230', '#121c44', '#1a2a56'], { y1: L.cy });
        stars(b, L, R, { count: 70, y1: L.cy * 0.7 });
        // A thin moon behind a rag of cloud.
        const mx = L.W * 0.8;
        const my = L.cy * 0.35;
        b.ellipse(mx, my, 7 * u, 7 * u, '#e8ecff');
        b.ellipse(mx + 3 * u, my - 1 * u, 7 * u, 7 * u, '#0a1028');
        b.glow(mx, my, 24 * u, '#a0b4ff', 0.25);
        fogBand(b, L, 75, { y: L.cy * 0.42, h: 6 * u, color: '#3a4670', alpha: 0.7, freq: 0.03, tile: false });
      },
    },
    {
      depth: 0.3,
      paint(b, L, R) {
        const u = L.u;
        // Marsh beyond: dead trees and reed beds, fading into mist.
        const line = ridgeLine(L, 76, { base: L.cy + 2 * u, amp: 3 * u, freq: 0.02, oct: 3 });
        fillBelow(b, line, (x, y, d) => rampSmooth(['#070a16', '#0c1222', '#121a30'], clamp(0.4 - d * 0.01), x, y, 3));
        for (let i = 0; i < 8; i++) {
          const x = R() * L.W;
          const y = line[R2(Math.min(L.W - 1, x))];
          const hgt = (10 + R() * 16) * u;
          b.line(x, y, x + (R() - 0.5) * 3, y - hgt, '#0a0e1c');
          b.line(x, y - hgt * 0.6, x + 5 * u, y - hgt * 0.8, '#0a0e1c');
          b.line(x, y - hgt * 0.4, x - 4 * u, y - hgt * 0.55, '#0a0e1c');
        }
        fogBand(b, L, 77, { y: L.cy + 2 * u, h: 8 * u, color: '#3a4a74', alpha: 0.55, freq: 0.025 });
      },
    },
    {
      depth: 0.7,
      paint(b, L, R) {
        const u = L.u;
        const { wallTop, wallFoot } = ruinGeom(L);
        // Gravelight welling up behind the wall.
        b.glow(L.W * 0.35, wallTop, 70 * u, '#4ab8ff', 0.35, 1.3);
        b.glow(L.W * 0.75, wallTop + 4 * u, 50 * u, '#3a9aff', 0.28, 1.3);
        // The wall: great blocks, twice a man's height, its top broken.
        const topLine = new Float32Array(L.W);
        for (let x = 0; x < L.W; x++) {
          const brk = fbm(x * 0.03, 3, 78, 3);
          topLine[x] = wallTop + (brk > 0.6 ? (brk - 0.6) * 60 * u : 0) + (noise(Math.floor(x / (9 * u)), 1, 79) > 0.7 ? 3 * u : 0);
        }
        for (let x = 0; x < L.W; x++) {
          for (let y = R2(topLine[x]); y < wallFoot; y++) {
            // Courses of great dressed blocks, each a little different, some cracked.
            const row = Math.floor((y - wallTop) / (11 * u));
            const bw = (14 + noise(row, 1, 86) * 12) * u;
            const jx = x / bw + noise(row, 2, 86) * 3;
            const col = Math.floor(jx);
            const inX = jx % 1;
            const inY = ((y - wallTop) / (11 * u)) % 1;
            const n = fbm(x * 0.07, y * 0.07, 80, 3);
            let t = 0.3 + (noise(col, row, 81) - 0.5) * 0.22 + (n - 0.5) * 0.28;
            if (inY < 0.1) t += 0.16;
            if (inX < 0.05 || inY > 0.9) t -= 0.2;
            else if (inX < 0.1) t += 0.06;
            t -= ((y - wallTop) / (wallFoot - wallTop)) * 0.14;
            b.px(x, y, rampSmooth(['#080a14', '#10142a', '#1a2040', '#262e56', '#36426e', '#4a5a8a'], clamp(t), x, y, 3));
            // Blue ruin-lichen, glowing faintly in patches.
            const lich = fbm(x * 0.06, y * 0.1, 82, 3);
            if (lich > 0.64 && bayer(x, y) < (lich - 0.64) * 4) b.add(x, y, '#5ad0ff', 0.4);
          }
          b.px(x, R2(topLine[x]), '#5a7ab0');
        }
        // A worn carving on one block: three marks of the old script.
        const cx = L.W * 0.66;
        const cy = wallTop + 16 * u;
        for (let i = 0; i < 3; i++) {
          b.rect(cx + i * 4 * u, cy, 1, 4 * u, '#7ab8e8');
          b.rect(cx + i * 4 * u, cy + (i % 2) * 2 * u, 2 * u, 1, '#7ab8e8');
        }
        b.outline(OUTLINE);
      },
    },
    {
      depth: 1,
      paint(b, L, R) {
        const u = L.u;
        const { wallFoot, mx } = ruinGeom(L);
        // Black marsh water at the wall's foot, holding the blue light.
        for (let y = R2(wallFoot); y < L.H; y++) {
          for (let x = 0; x < L.W; x++) {
            const ripple = Math.sin(y * 1.1 + fbm(x * 0.015, y * 0.2, 83, 2) * 8);
            let t = 0.2 + ripple * 0.05 + (fbm(x * 0.01, y * 0.05, 84, 3) - 0.5) * 0.2;
            b.px(x, y, rampSmooth(['#030409', '#070a14', '#0c1222', '#141c34'], clamp(t), x, y, 3));
            // the wall's blue light broken into ripples on the water
            const glint = fbm(x * 0.04, y * 0.5, 85, 2);
            if (ripple > 0.8 && glint > 0.58) b.add(x, y, '#3a9aff', 0.22 * (1 - (y - wallFoot) / (L.H - wallFoot)));
          }
        }
        // A strip of mud and reeds where she stands.
        const by = wallFoot + 6 * u;
        b.ellipse(mx, by, 40 * u, 6 * u, '#0e0c12');
        b.ellipse(mx, by - 1, 36 * u, 4 * u, '#1a161e');
        // Maren from behind: grey cloak, a lantern at her side, a coil of rope on her shoulder.
        stamp(b, 'maren', 'idle', 'up', R2(mx), R2(by), { mul: [0.6, 0.62, 0.85], rim: { color: '#ffb060', side: 1, k: 0.45 } });
        const lx = mx + 7 * u;
        const ly = by - 9 * u;
        b.rect(lx - 1, ly - 3 * u, 1, 3 * u, '#2a2220');
        b.rect(lx - 2 * u, ly, 4 * u, 4 * u, '#3a2a1a');
        b.rect(lx - 1.5 * u, ly + 0.5 * u, 3 * u, 3 * u, '#ffc060');
        b.px(lx, ly + 2 * u, '#fff0c0');
        b.glow(lx, ly + 2 * u, 26 * u, '#ffb050', 0.5);
        // rope coil
        for (let a = 0; a < Math.PI * 2; a += 0.3) b.px(mx - 4 * u + Math.cos(a) * 3 * u, by - 18 * u + Math.sin(a) * 2 * u, '#a08a60');
        // Reeds in front.
        for (let i = 0; i < 40; i++) {
          const x = R() * L.W;
          if (Math.abs(x - mx) < 20 * u) continue;
          const y = L.H - R() * (L.H - by) * 0.5;
          const hgt = (6 + R() * 14) * u;
          b.line(x, y, x + (R() - 0.5) * 4 * u, y - hgt, R() < 0.3 ? '#1a2430' : '#0a0e16');
        }
        b.outline(OUTLINE);
      },
    },
  ],
  particles: [
    { type: 'motes', count: 40, colors: ['#7ad8ff', '#bff0ff', '#4ab8ff'], y0: (L) => ruinGeom(L).wallTop - 40 * L.u, y1: (L) => ruinGeom(L).wallTop + 10 * L.u, depth: 0.7 },
    { type: 'twinkle', count: 20, colors: ['#ffd890'], y0: (L) => ruinGeom(L).wallFoot, y1: (L) => L.H, depth: 1 },
  ],
  lights(L, t) {
    const { wallTop, wallFoot, mx, u } = ruinGeom(L);
    return [
      { x: mx + 7 * u, y: wallFoot + 6 * u - 7 * u, r: 40 * u, color: '#ffb050', k: 0.6, flicker: true, depth: 1 },
      { x: L.W * 0.35, y: wallTop - 6 * u, r: 90 * u, color: '#3aa0ff', k: 0.25 + 0.08 * Math.sin(t * 0.9), depth: 0.7 },
      { x: L.W * 0.75, y: wallTop, r: 70 * u, color: '#3a8aff', k: 0.2 + 0.06 * Math.sin(t * 0.7 + 1), depth: 0.7 },
    ];
  },
};

export const LIFE_PANELS = { brightfall, night_of_lamps, weeping_cut, maren_ruins };
