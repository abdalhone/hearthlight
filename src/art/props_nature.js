import { buf, finish, groundShadow, tone, dtone, foliage, disc, cylinder, PAL, OUT, rgb, mixc, shade, ih, lut, clamp01 } from './props_kit.js';

// Trees, stumps, rocks, ore, crystals, herbs, moonpetals, berry bushes, crops and the
// Heart Oak. Canopies and trunks of trees are separate sprites with the same anchor
// so the canopy alone can fade when someone walks behind it.

const ORE = lut(['#4a2210', '#7a3c1a', '#a85a28', '#d4803c', '#f0b070']);
const LEAF_ALT = lut(['#13281a', '#1a3824', '#244b2c', '#326236', '#467d3e', '#619848', '#84b358', '#aacd74', '#cfe39a']);

function trunk(b, cx, base, top, w, rng, { roots = true, L = PAL.bark } = {}) {
  for (let y = top; y <= base; y++) {
    const v = (y - top) / (base - top);
    const flare = roots ? Math.max(0, (v - 0.8) / 0.2) ** 2 * 3 : 0;
    const half = w / 2 + flare;
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half - 1); x++) {
      const u = (x + 0.5 - cx) / half;
      if (u < -1 || u > 1) continue;
      let t = 0.55 - u * 0.35 - Math.abs(u) ** 3 * 0.15;
      // Bark furrows run up the trunk.
      const furrow = ih(x * 3, Math.floor(y / 3), 501);
      if (furrow > 0.78) t -= 0.18;
      else if (furrow < 0.12) t += 0.08;
      b.set(x, y, dtone(L, t, x, y, 0.06));
    }
  }
  if (roots) {
    for (const s of [-1, 1]) {
      for (let k = 0; k < 4; k++) b.set(Math.round(cx + s * (w / 2 + 2 + k)), base - 1 + (k > 1 ? 1 : 0), tone(L, s < 0 ? 0.55 : 0.3));
    }
  }
}

function oak(v, rng) {
  const W = 48;
  const Hh = 64;
  const tb = buf(W, Hh);
  const cb = buf(W, Hh);
  const cx = 24;
  const base = 61;
  const rx = [19, 16, 21][v];
  const ry = [16, 17, 15][v];
  const cy = [24, 23, 26][v];
  trunk(tb, cx, base, cy + 4, v === 1 ? 6 : 7, rng);
  // Two limbs reaching into the crown.
  for (let k = 0; k < 7; k++) {
    tb.set(cx - 3 - k * 0.6, cy + 10 - k, tone(PAL.bark, 0.5));
    tb.set(cx - 3 - k * 0.6, cy + 11 - k, tone(PAL.bark, 0.3));
    tb.set(cx + 3 + k * 0.7, cy + 9 - k, tone(PAL.bark, 0.35));
  }
  finish(tb);
  const L = v === 2 ? LEAF_ALT : PAL.leaf;
  foliage(cb, cx, cy, rx, ry, L, rng, { clusters: 26, clusterR: [4, 7], lo: 0.12, hi: 0.92 });
  // A darker underside where the crown shades itself.
  for (let y = cy + 4; y < cy + ry + 2; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!(cb.data[i] >>> 24)) continue;
      const k = (y - cy - 4) / (ry - 2);
      if (k > 0.45) cb.data[i] = shade(cb.data[i], 1 - (k - 0.45) * 0.35);
    }
  }
  // A few sunlit leaf sprigs on the top edge.
  for (let k = 0; k < 10; k++) {
    const x = Math.round(cx - rx * 0.7 + rng.next() * rx * 1.2);
    for (let y = 0; y < Hh; y++) {
      if (cb.get(x, y) >>> 24) {
        cb.set(x, y, tone(L, 0.98));
        cb.set(x, y - 1, tone(L, 0.82));
        break;
      }
    }
  }
  finish(cb);
  return { trunk: tb, canopy: cb };
}

function pine(v, rng) {
  const W = 32;
  const Hh = 60;
  const tb = buf(W, Hh);
  const cb = buf(W, Hh);
  const cx = 16;
  const base = 57;
  trunk(tb, cx, base, 40, 5, rng, { roots: true });
  finish(tb);
  const tiers = v === 0 ? 5 : 4;
  const topY = v === 0 ? 3 : 7;
  const botY = 50;
  for (let k = 0; k < tiers; k++) {
    const ty = topY + ((botY - topY) * k) / tiers;
    const by = topY + ((botY - topY) * (k + 1.3)) / tiers;
    const half = 4 + k * (v === 0 ? 2.6 : 3);
    for (let y = Math.floor(ty); y <= by; y++) {
      const t = (y - ty) / (by - ty);
      const hw = 1 + half * t;
      // Drooping, ragged lower edge.
      const sag = (x) => Math.round(Math.abs(x - cx) / hw * 2.5 + (ih(x, k, 511) - 0.5) * 2);
      for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
        if (y > by - sag(x) && y > ty + 2) continue;
        const u = (x + 0.5 - cx) / hw;
        let tt = 0.62 - u * 0.32 - t * 0.2 + (ih(x, y, 512) - 0.5) * 0.12;
        if (ih(x >> 1, y, 513 + k) > 0.86) tt -= 0.15;
        cb.set(x, y, dtone(PAL.pine, tt, x, y, 0.08));
      }
    }
  }
  // Tip highlight.
  cb.set(cx, topY - 1, tone(PAL.pine, 0.9));
  finish(cb);
  return { trunk: tb, canopy: cb };
}

function stump(kind) {
  const b = buf(16, 14);
  const L = kind === 'pine' ? PAL.bark : PAL.bark;
  cylinder(b, 8, 6, 12, 4.5, L);
  disc(b, 8, 6, 4.5, 2.2, PAL.woodLight, (nx, ny, d) => {
    const r = Math.sqrt(d);
    return 0.72 - r * 0.25 - (Math.floor(r * 3) % 2) * 0.12;
  });
  b.set(4, 12, tone(L, 0.4));
  b.set(3, 13, tone(L, 0.35));
  b.set(12, 13, tone(L, 0.25));
  finish(b);
  return b;
}

function rock(v, rng, { ore = false } = {}) {
  const b = buf(16, 15);
  const L = PAL.stone;
  const blobs = [
    [8, 9, 6, 4.8],
    [5.5, 10, 4, 3.4],
    [10.5, 10.5, 4.2, 3.2],
  ].slice(0, v === 2 ? 3 : 2);
  if (v === 1) blobs[0] = [8, 8.5, 6.5, 5.4];
  for (const [cx, cy, rx, ry] of blobs) {
    b.ellipse(cx, cy, rx, ry, (x, y, nx, ny, d) => {
      // Facets: quantized normals give a chiselled look.
      const fx = Math.round(nx * 2) / 2;
      const fy = Math.round(ny * 2) / 2;
      let t = 0.55 - fx * 0.22 - fy * 0.3 + (d > 0.8 ? -0.1 : 0);
      if (ore && ih(x >> 1, y, 521 + v) > 0.72) return tone(ORE, 0.55 - fx * 0.2 - fy * 0.3);
      return dtone(L, t, x, y, 0.05);
    });
  }
  // A crack and a little moss on top.
  if (!ore) {
    b.set(7, 7, tone(L, 0.15));
    b.set(8, 8, tone(L, 0.15));
    b.set(8, 9, tone(L, 0.2));
    if (v !== 1) {
      b.set(6, 5, rgb('#5c8a3e'));
      b.set(7, 5, rgb('#4a7a3a'));
      b.set(5, 6, rgb('#3e6a32'));
    }
  } else {
    // Bright metal flecks.
    for (const [x, y] of [
      [5, 8],
      [9, 7],
      [11, 10],
    ]) {
      b.set(x, y, rgb('#e6e9ee'));
      b.set(x + 1, y, rgb('#9aa0ad'));
    }
  }
  finish(b);
  groundShadow(b, 8.5, 13.5, 7, 1.6, 70);
  return b;
}

function rubble(v) {
  const b = buf(16, 8);
  for (let k = 0; k < 6; k++) {
    const cx = 3 + ih(k, v, 531) * 10;
    const cy = 4 + ih(k, v, 532) * 2.5;
    const r = 1.2 + ih(k, v, 533) * 1.4;
    b.ellipse(cx, cy, r, r * 0.8, (x, y, nx, ny) => tone(PAL.stone, 0.55 - nx * 0.2 - ny * 0.25));
  }
  finish(b);
  return b;
}

function crystalFrames() {
  const frames = [];
  const C = lut(['#0c2a3a', '#124a5e', '#1b7088', '#2fa0b8', '#5fd0e0', '#a8f0f6', '#eaffff']);
  const shards = [
    [8, 19, 3, 15, 0],
    [4, 19, 2, 9, -2],
    [12, 19, 2.5, 11, 2],
    [10, 19, 1.5, 6, 1],
  ];
  for (let f = 0; f < 4; f++) {
    const b = buf(16, 22);
    for (const [bx, by, hw, h, lean] of shards) {
      for (let y = 0; y < h; y++) {
        const t = y / h;
        const w = t < 0.25 ? hw * (t / 0.25) : hw;
        const cx = bx + lean * t;
        for (let x = Math.floor(cx - w); x <= Math.ceil(cx + w - 1); x++) {
          const u = (x + 0.5 - cx) / Math.max(0.5, w);
          let tt = 0.55 - u * 0.3 + (1 - t) * 0.12;
          if (Math.abs(u) < 0.25) tt += 0.15;
          // A pulse of light runs up the shards.
          const pulse = Math.max(0, 1 - Math.abs(((f / 4 + t) % 1) - 0.5) * 6);
          tt += pulse * 0.25;
          b.set(x, by - y, tone(C, tt));
        }
      }
    }
    b.set(8, 5, rgb('#ffffff'));
    finish(b);
    groundShadow(b, 8, 20, 6, 1.4, 60);
    frames.push(b);
  }
  return frames;
}

function herb(picked) {
  const b = buf(16, 12);
  const L = lut(['#1f3d2b', '#3b6a4a', '#6a9a7a', '#a5c8b0', '#dbeee0']);
  if (picked) {
    for (const x of [6, 8, 10]) {
      b.set(x, 10, tone(L, 0.3));
      b.set(x, 9, tone(L, 0.45));
    }
    finish(b);
    return b;
  }
  // A rosette of silver-green leaves.
  for (let k = 0; k < 7; k++) {
    const a = Math.PI + (k / 6) * Math.PI;
    for (let s = 0; s < 6; s++) {
      const x = Math.round(8 + Math.cos(a) * s);
      const y = Math.round(10 + Math.sin(a) * s * 0.9);
      b.set(x, y, tone(L, s > 3 ? 0.85 : 0.5 - Math.cos(a) * 0.15));
      if (s > 1 && s < 5) b.set(x + (Math.cos(a) > 0 ? -1 : 1), y, tone(L, 0.35));
    }
  }
  b.set(8, 3, rgb('#f4f0e6'));
  b.set(5, 4, rgb('#f4f0e6'));
  b.set(11, 4, rgb('#f4f0e6'));
  finish(b);
  return b;
}

function moonpetal(state, f = 0) {
  const b = buf(16, 16);
  const stem = rgb('#3a6a4a');
  for (let y = 7; y < 15; y++) b.set(8, y, stem);
  b.set(6, 13, rgb('#4f8a5a'));
  b.set(5, 12, rgb('#4f8a5a'));
  b.set(10, 12, rgb('#3a6a4a'));
  b.set(11, 11, rgb('#4f8a5a'));
  if (state === 'closed') {
    const L = lut(['#4a3a6a', '#7a68a0', '#b0a0d0', '#ddd2ff']);
    for (let y = 3; y < 8; y++) {
      const hw = y < 5 ? 1 : 1.5;
      for (let x = Math.floor(8 - hw); x <= Math.ceil(8 + hw - 1); x++) b.set(x, y, tone(L, 0.7 - (x - 8) * 0.2 - (y - 3) * 0.06));
    }
  } else if (state === 'open') {
    const L = lut(['#5a4a9a', '#8f7ae0', '#c4b4ff', '#ece6ff', '#ffffff']);
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k / 5) * Math.PI * 2;
      for (let s = 1; s < 5; s++) {
        const x = Math.round(8 + Math.cos(a) * s);
        const y = Math.round(6 + Math.sin(a) * s * 0.8);
        const shimmer = ((k + f) % 5 === 0 ? 0.2 : 0) + (s === 4 ? 0.1 : 0);
        b.set(x, y, tone(L, 0.45 + s * 0.12 + shimmer - Math.cos(a) * 0.08));
      }
    }
    b.set(8, 6, rgb('#ffe27a'));
    b.set(8, 5, rgb('#fff3c2'));
  }
  finish(b);
  return b;
}

function berryBush(empty, rng) {
  const b = buf(20, 18);
  foliage(b, 10, 10, 8.5, 6.5, PAL.leaf, rng, { clusters: 12, clusterR: [3, 4.5], lo: 0.1, hi: 0.78 });
  if (!empty) {
    const berries = [
      [6, 8],
      [9, 6],
      [13, 9],
      [7, 12],
      [11, 12],
      [14, 6],
      [4, 11],
    ];
    for (const [x, y] of berries) {
      b.set(x, y, rgb('#b8304a'));
      b.set(x + 1, y, rgb('#7a1a30'));
      b.set(x, y + 1, rgb('#7a1a30'));
      b.set(x + 1, y + 1, rgb('#5a1024'));
      b.set(x, y - 0, rgb('#e86a80'));
    }
  }
  finish(b);
  return b;
}

function shrub(variant, rng) {
  const b = buf(20, 18);
  foliage(b, 10, 10, 8, 6.5, variant === 'b' ? LEAF_ALT : PAL.leaf, rng, { clusters: 12, clusterR: [3, 4.5], lo: 0.12, hi: 0.85 });
  if (variant === 'b') {
    for (const [x, y] of [
      [6, 7],
      [12, 6],
      [9, 10],
      [14, 10],
    ]) {
      b.set(x, y, rgb('#f4f0e6'));
      b.set(x + 1, y, rgb('#ffd75e'));
    }
  }
  finish(b);
  return b;
}

function crop(kind, stage) {
  const b = buf(16, 20);
  // Mounded soil under the plant.
  const soil = lut(['#24160e', '#3a2618', '#523622', '#6a4830']);
  b.ellipse(8, 17, 6, 2, (x, y, nx, ny) => tone(soil, 0.6 - ny * 0.3 - nx * 0.1));
  const G = PAL.leaf;
  if (kind === 'turnip') {
    if (stage === 0) {
      b.set(7, 15, tone(G, 0.7));
      b.set(9, 15, tone(G, 0.6));
    } else {
      const leaves = stage === 1 ? 2 : stage === 2 ? 4 : 6;
      const len = stage === 1 ? 3 : stage === 2 ? 6 : 8;
      for (let k = 0; k < leaves; k++) {
        const a = -Math.PI / 2 + (k - (leaves - 1) / 2) * 0.5;
        for (let s = 0; s < len; s++) {
          const x = Math.round(8 + Math.cos(a) * s * 0.8);
          const y = Math.round(15 + Math.sin(a) * s);
          b.set(x, y, tone(G, 0.45 + (s / len) * 0.45 - (k % 2) * 0.12));
          if (s > 1 && s < len - 1) b.set(x + (Math.cos(a) < 0 ? -1 : 1), y, tone(G, 0.35));
        }
      }
      if (stage === 3) {
        // The turnip's shoulder pokes out of the soil.
        b.ellipse(8, 16, 3, 2, (x, y, nx, ny) => (ny < -0.1 ? tone(lut(['#5a2a5a', '#8a4a8a', '#b57ab5', '#e0c0e0']), 0.6 - nx * 0.3) : tone(PAL.bone, 0.8 - nx * 0.2)));
      }
    }
  } else {
    const W = lut(['#4d3412', '#7d5a1c', '#b58726', '#d9b04a', '#f0d68a']);
    const stalks = stage === 0 ? 2 : 5;
    const h = [2, 6, 11, 13][stage];
    for (let k = 0; k < stalks; k++) {
      const x = 4 + k * 2 + (k % 2);
      for (let s = 0; s < h; s++) {
        const y = 16 - s;
        const ripe = stage === 3;
        b.set(x + (s > h * 0.7 && k % 2 ? 1 : 0), y, ripe ? tone(W, 0.45 + (s / h) * 0.4) : tone(G, 0.4 + (s / h) * 0.45));
      }
      if (stage === 3) {
        // Drooping heads of grain.
        const hx = x + (k % 2 ? 1 : 0);
        for (let s = 0; s < 4; s++) {
          b.set(hx + (s > 2 ? 1 : 0), 16 - h - s + 3, tone(W, 0.85 - s * 0.05));
          b.set(hx + 1, 16 - h - s + 4, tone(W, 0.6));
        }
      }
    }
  }
  finish(b);
  return b;
}

function heartOak(rng) {
  const W = 96;
  const Hh = 96;
  const b = buf(W, Hh);
  const cx = 48;
  const base = 91;
  // Massive trunk with buttress roots.
  for (let y = 44; y <= base; y++) {
    const v = (y - 44) / (base - 44);
    const half = 7 + v * v * 9;
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
      const u = (x + 0.5 - cx) / half;
      if (u < -1 || u > 1) continue;
      let t = 0.55 - u * 0.33;
      const fur = ih(x * 2, y >> 2, 541);
      if (fur > 0.75) t -= 0.2;
      if (v > 0.7 && Math.abs(Math.sin(u * 5)) < 0.25) t -= 0.12; // root ridges
      b.set(x, y, dtone(PAL.bark, t, x, y, 0.06));
    }
  }
  // A hollow at the base and a carved heart.
  b.ellipse(cx + 2, base - 9, 3, 4, (x, y, nx, ny) => tone(PAL.bark, 0.05 + ny * 0.05));
  for (const [x, y] of [
    [43, 66],
    [45, 66],
    [42, 67],
    [44, 67],
    [46, 67],
    [43, 68],
    [45, 68],
    [44, 69],
  ])
    b.set(x, y, tone(PAL.woodLight, 0.6));
  finish(b);
  const cb = buf(W, Hh);
  foliage(cb, cx, 34, 44, 31, PAL.leaf, rng, { clusters: 60, clusterR: [6, 10], lo: 0.1, hi: 0.95 });
  finish(cb);
  b.blit(cb, 0, 0, { composite: true });
  // Ribbons and charms on the lowest boughs.
  const ribbons = ['#cc3a45', '#4f6a9e', '#e4b83d', '#f4f0e6', '#a995ff', '#58cf8f'];
  for (let k = 0; k < 9; k++) {
    const x = 18 + Math.floor(ih(k, 1, 542) * 60);
    let y = 0;
    for (let yy = Hh - 1; yy > 0; yy--) if (cb.get(x, yy) >>> 24) {
      y = yy;
      break;
    }
    if (!y) continue;
    const c = rgb(ribbons[k % ribbons.length]);
    const len = 4 + Math.floor(ih(k, 2, 543) * 5);
    for (let s = 1; s <= len; s++) b.set(x + (s > len / 2 ? 1 : 0), y + s, s === len ? shade(c, 0.7) : c);
    if (k % 3 === 0) b.set(x + 1, y + len + 1, rgb('#ffe27a'));
  }
  return b;
}

function rippleFrames() {
  const out = [];
  for (let f = 0; f < 4; f++) {
    const b = buf(16, 8);
    const r = 2 + f * 1.6;
    const a = 220 - f * 50;
    b.ellipse(8, 4, r, r * 0.42, (x, y, nx, ny, d) => (d > 0.62 ? (rgb('#eef8ff') & 0x00ffffff) | (a << 24) : 0));
    out.push(b);
  }
  return out;
}

// Registers every nature sprite. `add(name, bufs, opts)` takes PixelBufs.
export function registerNature(add, rng) {
  const oaks = [0, 1, 2].map((v) => oak(v, rng.fork(600 + v)));
  const pines = [0, 1].map((v) => pine(v, rng.fork(610 + v)));
  add('prop:tree_oak:trunk', oaks.map((t) => t.trunk), { ox: 24, oy: 61 });
  add('prop:tree_oak:canopy', oaks.map((t) => t.canopy), { ox: 24, oy: 61 });
  add('prop:tree_pine:trunk', pines.map((t) => t.trunk), { ox: 16, oy: 57 });
  add('prop:tree_pine:canopy', pines.map((t) => t.canopy), { ox: 16, oy: 57 });
  add('prop:tree_oak', oaks.map((t) => t.trunk.clone().blit(t.canopy, 0, 0)), { ox: 24, oy: 61 });
  add('prop:tree_pine', pines.map((t) => t.trunk.clone().blit(t.canopy, 0, 0)), { ox: 16, oy: 57 });
  add('prop:stump:oak', [stump('oak')], { ox: 8, oy: 13 });
  add('prop:stump:pine', [stump('pine')], { ox: 8, oy: 13 });
  add('prop:stump', [stump('oak')], { ox: 8, oy: 13 });
  add('prop:rock', [0, 1, 2].map((v) => rock(v, rng)), { ox: 8, oy: 14 });
  add('prop:ore_iron', [rock(0, rng, { ore: true }), rock(2, rng, { ore: true })], { ox: 8, oy: 14 });
  add('prop:ore', [rock(0, rng, { ore: true })], { ox: 8, oy: 14 });
  add('prop:rock:rubble', [0, 1, 2].map((v) => rubble(v)), { ox: 8, oy: 6 });
  add('prop:crystal', crystalFrames(), { ox: 8, oy: 20, fps: 5 });
  add('prop:herb', [herb(false)], { ox: 8, oy: 11 });
  add('prop:herb:picked', [herb(true)], { ox: 8, oy: 11 });
  add('prop:moonpetal:closed', [moonpetal('closed')], { ox: 8, oy: 15 });
  add('prop:moonpetal:open', [0, 1, 2, 3, 4].map((f) => moonpetal('open', f)), { ox: 8, oy: 15, fps: 4 });
  add('prop:moonpetal', [moonpetal('open', 0)], { ox: 8, oy: 15 });
  add('prop:moonpetal:picked', [moonpetal('picked')], { ox: 8, oy: 15 });
  add('prop:berry_bush', [berryBush(false, rng.fork(620))], { ox: 10, oy: 16 });
  add('prop:berry_bush:empty', [berryBush(true, rng.fork(620))], { ox: 10, oy: 16 });
  add('prop:bush:a', [shrub('a', rng.fork(621))], { ox: 10, oy: 16 });
  add('prop:bush:b', [shrub('b', rng.fork(622))], { ox: 10, oy: 16 });
  add('prop:bush', [shrub('a', rng.fork(621))], { ox: 10, oy: 16 });
  for (const kind of ['turnip', 'wheat']) for (let s = 0; s < 4; s++) add(`prop:crop:${kind}:${s}`, [crop(kind, s)], { ox: 8, oy: 18 });
  for (let s = 0; s < 4; s++) add(`prop:crop:${s}`, [crop('turnip', s)], { ox: 8, oy: 18 });
  add('prop:heart_oak', [heartOak(rng.fork(630))], { ox: 48, oy: 91 });
  add('prop:ripple', rippleFrames(), { ox: 8, oy: 4, fps: 5 });
}

void clamp01;
void OUT;
void mixc;
