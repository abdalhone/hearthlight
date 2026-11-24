import { RAMPS } from './palette.js';
import { PixelBuf, rgb, mixc, shade, tileNoise, tileCells, bayer, ih } from './world_pixbuf.js';

// Tileable 64×64 ground textures, generated once at boot from the seeded RNG.
// Surfaces are built as height fields and lit from the upper left, then mapped
// through smooth color ramps, so the ground reads as soft relief instead of flat
// single-color blocks (DESIGN §18). Everything wraps at 64 px.

export const TEX = 64;
const M = TEX - 1;

// A smooth n-step lookup through a dark->light ramp.
export function lut(hexes, n = 64) {
  const cols = hexes.map((h) => rgb(h));
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (cols.length - 1);
    const k = Math.min(cols.length - 2, Math.floor(t));
    out[i] = mixc(cols[k], cols[k + 1], t - k);
  }
  return out;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const wrap = (v) => ((v % TEX) + TEX) % TEX;

// Map a 0..1 tone through a LUT with a whisper of ordered dither (keeps a pixel feel).
function toneAt(L, t, x, y, dither = 0.03) {
  const v = clamp01(t + (bayer(x, y) - 0.5) * dither);
  return L[Math.min(L.length - 1, Math.round(v * (L.length - 1)))];
}

// Height field helpers --------------------------------------------------------

function addBump(H, cx, cy, r, amp) {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 > r2) continue;
      const k = 1 - d2 / r2;
      H[wrap(y) * TEX + wrap(x)] += amp * k * k;
    }
  }
}

// Directional light from the upper left: positive where the slope faces the light.
function lightOf(H, x, y) {
  const l = H[wrap(y) * TEX + wrap(x - 1)];
  const r = H[wrap(y) * TEX + wrap(x + 1)];
  const u = H[wrap(y - 1) * TEX + wrap(x)];
  const d = H[wrap(y + 1) * TEX + wrap(x)];
  return (l - r) * 0.5 + (u - d) * 0.7;
}

// Textures --------------------------------------------------------------------

const GRASS_LUT = lut(['#1d3a29', '#285331', '#36703a', '#4f8f43', '#74ad50', '#a3cc6a', '#c9e48e']);
const GRASS_DRY_LUT = lut(['#2a3a25', '#3d5530', '#577338', '#7a9446', '#a2b45c', '#c9cf82']);
const TALL_LUT = lut(['#16301f', '#204528', '#2d6131', '#43803c', '#64a04a', '#94c463']);
const FOREST_LUT = lut(['#141f17', '#1c2c1d', '#263a23', '#34492a', '#465a32', '#62703f']);

function grassTexture(rng, { L = GRASS_LUT, base = 0.47, clumps = 46, blades = 150, bladeLen = [2, 4], clover = false } = {}) {
  const buf = new PixelBuf(TEX, TEX);
  const n1 = tileNoise(TEX, 4, rng, 3);
  const n2 = tileNoise(TEX, 16, rng, 2);
  const H = new Float32Array(TEX * TEX);
  for (let k = 0; k < clumps; k++) addBump(H, rng.next() * TEX, rng.next() * TEX, 2.2 + rng.next() * 2.6, 0.8 + rng.next() * 0.6);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      const t = base + (n1[i] - 0.5) * 0.2 + (n2[i] - 0.5) * 0.1 + lightOf(H, x, y) * 0.22 + H[i] * 0.05;
      buf.data[i] = toneAt(L, t, x, y);
    }
  }
  if (clover) {
    for (let k = 0; k < 9; k++) {
      const cx = rng.next() * TEX;
      const cy = rng.next() * TEX;
      for (let j = 0; j < 3; j++) {
        const lx = Math.round(cx + Math.cos(j * 2.1) * 1.6);
        const ly = Math.round(cy + Math.sin(j * 2.1) * 1.4);
        buf.data[wrap(ly) * TEX + wrap(lx)] = L[34];
        buf.data[wrap(ly - 1) * TEX + wrap(lx)] = L[44];
      }
    }
  }
  // Blades: a dark root, a lit tip, leaning a little.
  for (let k = 0; k < blades; k++) {
    const x0 = Math.floor(rng.next() * TEX);
    const y0 = Math.floor(rng.next() * TEX);
    const len = bladeLen[0] + Math.floor(rng.next() * (bladeLen[1] - bladeLen[0] + 1));
    const lean = rng.next() < 0.5 ? -1 : 1;
    const bright = 0.55 + rng.next() * 0.25;
    for (let s = 0; s < len; s++) {
      const x = wrap(x0 + (s === len - 1 && rng.next() < 0.6 ? lean : 0));
      const y = wrap(y0 - s);
      const t = s === len - 1 ? bright + 0.12 : s === 0 ? 0.3 : bright - 0.06;
      buf.data[y * TEX + x] = L[Math.round(clamp01(t) * 63)];
    }
  }
  return buf;
}

function forestTexture(rng) {
  const buf = new PixelBuf(TEX, TEX);
  const n1 = tileNoise(TEX, 4, rng, 3);
  const moss = tileNoise(TEX, 8, rng, 2);
  const H = new Float32Array(TEX * TEX);
  for (let k = 0; k < 30; k++) addBump(H, rng.next() * TEX, rng.next() * TEX, 2 + rng.next() * 3, 0.9);
  const earth = lut(['#1c1612', '#2b211a', '#3b2d22', '#4d3b2b', '#614b36']);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      const li = lightOf(H, x, y) * 0.25;
      const m = moss[i];
      const t = 0.45 + (n1[i] - 0.5) * 0.25 + li;
      buf.data[i] = m > 0.36 ? toneAt(FOREST_LUT, t + (m - 0.5) * 0.3, x, y) : mixc(toneAt(earth, t + 0.1, x, y), FOREST_LUT[20], 0.35);
    }
  }
  // Leaf litter and needles.
  const litter = ['#6b4a26', '#8a5d2c', '#a4703a', '#5a3d22', '#7a6a2e', '#4e5a2a'].map((h) => rgb(h));
  for (let k = 0; k < 70; k++) {
    const x = Math.floor(rng.next() * TEX);
    const y = Math.floor(rng.next() * TEX);
    const c = litter[Math.floor(rng.next() * litter.length)];
    buf.data[wrap(y) * TEX + wrap(x)] = c;
    if (rng.next() < 0.6) buf.data[wrap(y) * TEX + wrap(x + 1)] = shade(c, 0.8);
    if (rng.next() < 0.3) buf.data[wrap(y + 1) * TEX + wrap(x)] = shade(c, 0.65);
  }
  for (let k = 0; k < 40; k++) {
    const x = Math.floor(rng.next() * TEX);
    const y = Math.floor(rng.next() * TEX);
    buf.data[wrap(y) * TEX + wrap(x)] = rgb('#2f5a30');
    buf.data[wrap(y - 1) * TEX + wrap(x)] = rgb('#4a7a3a');
  }
  return buf;
}

const DIRT_LUT = lut(['#3a2a22', '#523a2b', '#6e4f36', '#8b6644', '#a98153', '#c49f6e', '#dcbc8e']);

function dirtTexture(rng, { base = 0.52, pebbles = 22 } = {}) {
  const buf = new PixelBuf(TEX, TEX);
  const n1 = tileNoise(TEX, 4, rng, 3);
  const n2 = tileNoise(TEX, 16, rng, 2);
  const H = new Float32Array(TEX * TEX);
  for (let k = 0; k < 24; k++) addBump(H, rng.next() * TEX, rng.next() * TEX, 3 + rng.next() * 5, 0.5);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      const t = base + (n1[i] - 0.5) * 0.22 + (n2[i] - 0.5) * 0.1 + lightOf(H, x, y) * 0.3;
      buf.data[i] = toneAt(DIRT_LUT, t, x, y, 0.05);
    }
  }
  pebbleScatter(buf, rng, pebbles, PEBBLE_LUT, 0.55);
  return buf;
}

const PEBBLE_LUT = lut(['#2e2620', '#463b33', '#635649', '#83745f', '#a29079', '#c2b096']);

const STONE_LUT = lut(['#24222f', '#353344', '#4c4a5c', '#666478', '#838196', '#a3a1b4', '#c6c5d3']);
const COBBLE_LUT = lut(['#28252f', '#3b3743', '#524d5b', '#6b6574', '#857e8c', '#a19aa6', '#bdb7c0']);

// Little shaded stones: lit upper-left, shadowed lower-right, with a contact shadow.
function pebbleScatter(buf, rng, count, L, tone) {
  for (let k = 0; k < count; k++) {
    const cx = rng.next() * TEX;
    const cy = rng.next() * TEX;
    const r = 0.8 + rng.next() * 1.1;
    const t0 = tone + (rng.next() - 0.5) * 0.3;
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const nx = (x + 0.5 - cx) / r;
        const ny = (y + 0.5 - cy) / r;
        const d = nx * nx + ny * ny;
        const i = wrap(y) * TEX + wrap(x);
        if (d <= 1) buf.data[i] = L[Math.round(clamp01(t0 - (nx + ny) * 0.18) * 63)];
        else if (d < 2.2 && nx + ny > 0.6) buf.data[i] = shade(buf.data[i], 0.78);
      }
    }
  }
}

function sandTexture(rng) {
  const buf = new PixelBuf(TEX, TEX);
  const L = lut(['#8a6f4a', '#a98b5d', '#c4a571', '#dbc188', '#ead59f', '#f6e8c2']);
  const n1 = tileNoise(TEX, 4, rng, 3);
  const n2 = tileNoise(TEX, 8, rng, 2);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      // Wind ripples: wavy bands that tile (integer frequencies).
      const ph = (2 * Math.PI * (y * 4 + Math.sin((2 * Math.PI * x * 2) / TEX) * 3)) / TEX + n2[i] * 2;
      const ripple = Math.sin(ph) * 0.05 + Math.sin(ph * 2) * 0.02;
      const t = 0.6 + (n1[i] - 0.5) * 0.2 + ripple;
      buf.data[i] = toneAt(L, t, x, y, 0.06);
    }
  }
  for (let k = 0; k < 40; k++) {
    const x = Math.floor(rng.next() * TEX);
    const y = Math.floor(rng.next() * TEX);
    buf.data[y * TEX + x] = rng.next() < 0.5 ? L[20] : L[58];
  }
  pebbleScatter(buf, rng, 4, STONE_LUT, 0.62);
  return buf;
}

function gravelTexture(rng) {
  const buf = new PixelBuf(TEX, TEX);
  const cells = tileCells(TEX, 4, rng);
  const n1 = tileNoise(TEX, 4, rng, 2);
  const tones = new Float32Array(cells.count).map(() => 0.38 + rng.next() * 0.3);
  for (let i = 0; i < TEX * TEX; i++) {
    const x = i & M;
    const y = i >> 6;
    const e = cells.edge[i];
    if (e < 0.55) {
      buf.data[i] = STONE_LUT[Math.round(clamp01(0.16 + n1[i] * 0.1) * 63)];
      continue;
    }
    const sh = (-cells.dx[i] - cells.dy[i]) * 0.07;
    const t = tones[cells.id[i]] + sh + (n1[i] - 0.5) * 0.12 + Math.min(0.08, (e - 0.55) * 0.05);
    buf.data[i] = toneAt(STONE_LUT, t, x, y, 0.04);
  }
  return buf;
}

// Rounded cobbles: each stone domed and lit from the upper left, dark mortar between.
function cobbleTexture(rng, { spacing = 7, L = COBBLE_LUT, mortar = 0.12, moss = 0 } = {}) {
  const buf = new PixelBuf(TEX, TEX);
  const cells = tileCells(TEX, spacing, rng);
  const n1 = tileNoise(TEX, 8, rng, 2);
  const mossN = tileNoise(TEX, 8, rng, 2);
  const tones = new Float32Array(cells.count).map(() => 0.42 + (rng.next() - 0.5) * 0.26);
  const mossC = rgb('#4a6a35');
  for (let i = 0; i < TEX * TEX; i++) {
    const x = i & M;
    const y = i >> 6;
    const e = cells.edge[i];
    if (e < 0.75) {
      const c = L[Math.round(clamp01(mortar + n1[i] * 0.08) * 63)];
      buf.data[i] = moss && mossN[i] > 1 - moss ? mixc(c, mossC, 0.6) : c;
      continue;
    }
    const rim = Math.min(1, (e - 0.75) / 2.2); // 0 at the stone's edge, 1 inside
    const dx = cells.dx[i];
    const dy = cells.dy[i];
    const light = (-dx - dy * 1.2) / spacing; // upper-left faces the light
    const t = tones[cells.id[i]] + light * 0.32 * (1 - rim * 0.5) + (rim - 1) * 0.12 + (n1[i] - 0.5) * 0.06;
    buf.data[i] = toneAt(L, t, x, y, 0.035);
  }
  return buf;
}

// Big cracked flagstones half lost under moss: the ruins.
function ruinFloorTexture(rng) {
  const buf = cobbleTexture(rng, { spacing: 13, L: lut(['#22212b', '#33313e', '#474453', '#5d5a69', '#77737f', '#94909b']), mortar: 0.08, moss: 0.45 });
  const mossN = tileNoise(TEX, 4, rng, 3);
  const mossL = lut(['#1d2e1d', '#2b4127', '#3d5a31', '#557539']);
  for (let i = 0; i < TEX * TEX; i++) if (mossN[i] > 0.66) buf.data[i] = mixc(buf.data[i], mossL[Math.round(mossN[i] * 63)], Math.min(0.85, (mossN[i] - 0.66) * 4));
  // Hairline cracks.
  for (let k = 0; k < 7; k++) {
    let x = rng.next() * TEX;
    let y = rng.next() * TEX;
    let a = rng.next() * Math.PI * 2;
    for (let s = 0; s < 9; s++) {
      buf.data[wrap(Math.round(y)) * TEX + wrap(Math.round(x))] = rgb('#1c1a24');
      buf.data[wrap(Math.round(y) + 1) * TEX + wrap(Math.round(x))] = shade(buf.data[wrap(Math.round(y) + 1) * TEX + wrap(Math.round(x))], 1.15);
      a += (rng.next() - 0.5) * 1.2;
      x += Math.cos(a);
      y += Math.sin(a);
    }
  }
  return buf;
}

// Tilled rows running east-west: ridge, slope, furrow.
function farmlandTexture(rng) {
  const buf = new PixelBuf(TEX, TEX);
  const L = lut(['#24170f', '#36231a', '#4a3122', '#61412c', '#7a5537', '#946b46']);
  const n1 = tileNoise(TEX, 8, rng, 2);
  const PROFILE = [0.78, 0.7, 0.6, 0.52, 0.44, 0.34, 0.2, 0.12];
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      const wob = n1[i] > 0.7 ? 1 : 0;
      const t = PROFILE[(y + wob) & 7] + (n1[i] - 0.5) * 0.18;
      buf.data[i] = toneAt(L, t, x, y, 0.08);
    }
  }
  for (let k = 0; k < 50; k++) {
    const x = Math.floor(rng.next() * TEX);
    const y = Math.floor(rng.next() * TEX);
    if ((y & 7) < 4) buf.data[y * TEX + x] = L[56];
  }
  return buf;
}

// Wide planks with grain, staggered seams and a soft bevel.
function plankTexture(rng, { L = lut(['#2e1d14', '#462b1c', '#5f3c26', '#7a4f32', '#946541', '#ad7d52', '#c49668']), h = 4 } = {}) {
  const buf = new PixelBuf(TEX, TEX);
  const grain = tileNoise(TEX, 16, rng, 2);
  const rows = TEX / h;
  for (let r = 0; r < rows; r++) {
    // Seams at random places, tiling around the row.
    const seams = [];
    let x = Math.floor(rng.next() * 20);
    while (x < TEX) {
      seams.push(x);
      x += 22 + Math.floor(rng.next() * 26);
    }
    for (let y = r * h; y < r * h + h; y++) {
      const ry = y - r * h;
      for (let xx = 0; xx < TEX; xx++) {
        let seg = 0;
        for (let s = 0; s < seams.length; s++) if (xx >= seams[s]) seg = s + 1;
        const tone = 0.5 + (ih(r, seg, 991) - 0.5) * 0.22;
        const g = grain[y * TEX + ((xx >> 2) & M)];
        let t = tone + (g - 0.5) * 0.18 + (ih(xx >> 1, y, 17) - 0.5) * 0.03;
        if (ry === 0) t += 0.1;
        if (ry === h - 1) t -= 0.2;
        if (seams.includes(xx)) t -= 0.25;
        else if (seams.includes(xx - 1)) t += 0.06;
        buf.data[y * TEX + xx] = toneAt(L, t, xx, y, 0.025);
      }
      // Nail heads near the seams.
      for (const sx of seams) if (ry === 1) buf.data[y * TEX + ((sx + 2) & M)] = L[10];
    }
  }
  return buf;
}

// Square flagstones with bevelled edges (indoors: chapel, smithy, guardhouse).
function flagTexture(rng, { L = lut(['#2a2832', '#3c3a46', '#54525f', '#6c6a78', '#86848f', '#a3a1aa']), size = 8 } = {}) {
  const buf = new PixelBuf(TEX, TEX);
  const n1 = tileNoise(TEX, 8, rng, 2);
  for (let y = 0; y < TEX; y++) {
    const row = Math.floor(y / size);
    const off = row & 1 ? size / 2 : 0;
    for (let x = 0; x < TEX; x++) {
      const col = Math.floor((x + off) / size);
      const fx = (x + off) % size;
      const fy = y % size;
      const tone = 0.48 + (ih(col & 7, row, 551) - 0.5) * 0.25;
      let t = tone + (n1[y * TEX + x] - 0.5) * 0.1;
      if (fx === size - 1 || fy === size - 1) t = 0.1;
      else if (fx === 0 || fy === 0) t += 0.14;
      else if (fx === size - 2 || fy === size - 2) t -= 0.1;
      buf.data[y * TEX + x] = toneAt(L, t, x, y, 0.03);
    }
  }
  return buf;
}

// Chiselled bedrock for cliffs and outcrops: big facets, each tilted its own way and
// lit from the upper left, split by dark cracks, with lichen in the hollows.
const ROCK_LUT = lut(['#1f1d28', '#2e2c39', '#42404f', '#595667', '#716e81', '#8c899c', '#a9a7b7', '#c8c7d3']);

function rockTexture(rng) {
  const buf = new PixelBuf(TEX, TEX);
  const cells = tileCells(TEX, 11, rng);
  const fine = tileCells(TEX, 5, rng);
  const n1 = tileNoise(TEX, 8, rng, 3);
  const lichen = tileNoise(TEX, 4, rng, 2);
  const tilt = Array.from({ length: cells.count }, () => {
    const a = rng.next() * Math.PI * 2;
    const k = 0.35 + rng.next() * 0.65;
    return [Math.cos(a) * k, Math.sin(a) * k, (rng.next() - 0.5) * 0.12];
  });
  const lichenC = rgb('#6f8a4a');
  for (let i = 0; i < TEX * TEX; i++) {
    const x = i & M;
    const y = i >> 6;
    const [tx, ty, base] = tilt[cells.id[i]];
    // A facet facing up-left catches the light; one facing down-right falls into shade.
    let t = 0.47 + base - (tx + ty) * 0.21 + (n1[i] - 0.5) * 0.16;
    const e = cells.edge[i];
    // Cracks open and close along each seam instead of tracing every facet evenly.
    const open = n1[(i + 2080) & (TEX * TEX - 1)] > 0.42;
    if (e < 0.55 && open) t = 0.1 + e * 0.12;
    else if (e < 1.4) t -= (1.4 - e) * (open ? 0.09 : 0.05);
    // Finer chips inside each facet.
    if (fine.edge[i] < 0.45) t -= 0.07;
    else t += (-fine.dx[i] - fine.dy[i]) * 0.012;
    let c = toneAt(ROCK_LUT, t, x, y, 0.04);
    if (e >= 0.55 && lichen[i] > 0.7 && t < 0.5) c = mixc(c, lichenC, Math.min(0.55, (lichen[i] - 0.7) * 3));
    buf.data[i] = c;
  }
  return buf;
}

// The full set, plus a mid-tone per texture for quick fallbacks.
export function buildTextures(rng) {
  const t = {
    grass: [
      grassTexture(rng.fork(11)),
      grassTexture(rng.fork(12), { clover: true, base: 0.5 }),
      grassTexture(rng.fork(13), { L: GRASS_DRY_LUT, base: 0.5, blades: 120 }),
    ],
    tallgrass: [grassTexture(rng.fork(21), { L: TALL_LUT, base: 0.45, clumps: 70, blades: 360, bladeLen: [3, 7] }), grassTexture(rng.fork(22), { L: TALL_LUT, base: 0.5, clumps: 60, blades: 320, bladeLen: [3, 6] })],
    forest: [forestTexture(rng.fork(31)), forestTexture(rng.fork(32))],
    dirt: [dirtTexture(rng.fork(41), { pebbles: 12 }), dirtTexture(rng.fork(42), { base: 0.48, pebbles: 20 })],
    sand: [sandTexture(rng.fork(51))],
    gravel: [gravelTexture(rng.fork(61))],
    cobble: [cobbleTexture(rng.fork(71)), cobbleTexture(rng.fork(72), { spacing: 6 })],
    ruinfloor: [ruinFloorTexture(rng.fork(81))],
    farmland: [farmlandTexture(rng.fork(91))],
    plank: [plankTexture(rng.fork(101))],
    plankDark: [plankTexture(rng.fork(102), { L: lut(['#221510', '#352117', '#4a2e1f', '#5f3d29', '#744d33', '#8a6040']) })],
    flag: [flagTexture(rng.fork(111))],
    flagWarm: [flagTexture(rng.fork(112), { L: lut(['#30282a', '#463a3a', '#5f504c', '#78665e', '#917d72', '#ab9788']) })],
    rock: [rockTexture(rng.fork(131))],
    bridge: [plankTexture(rng.fork(121), { L: lut(['#2a1a12', '#41291b', '#5a3a25', '#734c30', '#8c603e', '#a6774f']), h: 4 })],
  };
  return t;
}
