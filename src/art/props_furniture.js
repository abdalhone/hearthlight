import { buf, finish, groundShadow, tone, dtone, box, cylinder, disc, planks, PAL, OUT, rgb, mixc, shade, ih, lut } from './props_kit.js';

// Doors, windows, chests, beds, fires, lamps and the furniture inside the houses.

const set = (b, x, y, c) => b.set(x, y, c);

// ---------------------------------------------------------------------------
// Doors

function doorFrames() {
  const frames = [];
  for (let f = 0; f < 5; f++) {
    const b = buf(16, 26);
    const open = f / 4;
    const w = Math.max(2, Math.round(12 * Math.cos(open * Math.PI * 0.5)));
    // The leaf swings inward on its left hinge; it darkens as it turns from the light.
    for (let y = 1; y < 26; y++) {
      for (let x = 0; x < w; x++) {
        const px = 2 + x;
        const plank = Math.floor((x / w) * 4);
        let t = 0.5 + (ih(plank, 3, 701) - 0.5) * 0.12 - open * 0.25;
        if (w > 4 && Math.floor(((x + 1) / w) * 4) !== plank) t -= 0.18;
        if (x === 0) t += 0.08;
        if (y === 1) t += 0.1;
        let c = dtone(PAL.wood, t + (ih(px, y >> 2, 702) - 0.5) * 0.06, px, y, 0.04);
        // Iron straps and a ring handle.
        if ((y === 6 || y === 19) && x < w - 1) c = tone(PAL.iron, 0.45 - open * 0.2 + (x === 0 ? 0.1 : 0));
        b.set(px, y, c);
      }
    }
    if (w > 6) {
      set(b, 2 + w - 3, 13, tone(PAL.iron, 0.75));
      set(b, 2 + w - 4, 14, tone(PAL.iron, 0.5));
      set(b, 2 + w - 2, 14, tone(PAL.iron, 0.3));
      set(b, 2 + w - 3, 15, tone(PAL.iron, 0.35));
    }
    finish(b);
    frames.push(b);
  }
  return frames;
}

// The ruins gate: a rusted portcullis in a stone arch; opening raises the bars.
function gateFrames() {
  const frames = [];
  const RUST = lut(['#2a1a14', '#4a2a1a', '#6e3e22', '#8e5430', '#a86c42']);
  for (let f = 0; f < 5; f++) {
    const b = buf(16, 30);
    const lift = Math.round((f / 4) * 20);
    // Bars (behind the arch).
    for (let y = 8; y < 30; y++) {
      const by = y + lift;
      if (by >= 30) continue;
      for (let x = 3; x <= 12; x++) {
        const bar = (x - 3) % 3 === 0;
        const cross = (by - 8) % 6 === 0;
        if (!bar && !cross) continue;
        const t = bar ? 0.55 - ((x - 3) % 3) * 0.1 + (ih(x, by, 711) - 0.5) * 0.2 : 0.35;
        b.set(x, y, ih(x, by, 712) > 0.7 ? tone(RUST, t) : tone(PAL.iron, t));
      }
      if (y > 26 - lift && y >= 26) for (let x = 3; x <= 12; x += 3) b.set(x, y, tone(PAL.iron, 0.7)); // spikes
    }
    // Stone arch and posts.
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 16; x++) {
        const ax = x - 7.5;
        const inArch = y > 2 && y < 30 && Math.abs(ax) < 6 && !(y < 8 && ax * ax + (y - 8) ** 2 * 2.2 > 40);
        const solid = x < 2 || x > 13 || y < 3 || (!inArch && y < 9);
        if (!solid) continue;
        const course = Math.floor(y / 4);
        let t = 0.5 + (ih(x >> 2, course, 713) - 0.5) * 0.22;
        if (y % 4 === 3) t -= 0.2;
        if (x === 0 || y === 0) t += 0.15;
        if (x === 15) t -= 0.2;
        b.set(x, y, dtone(PAL.stone, t, x, y, 0.05));
      }
    }
    // Keystone with the ruins' crest.
    set(b, 7, 1, tone(PAL.stone, 0.85));
    set(b, 8, 1, tone(PAL.stone, 0.7));
    set(b, 7, 2, rgb('#3d5a31'));
    set(b, 8, 2, tone(PAL.stone, 0.3));
    finish(b);
    frames.push(b);
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Windows (16×32 frames covering the 2-row facade; the window sits in its middle)

function windowSprite(variant, lit) {
  const b = buf(16, 32);
  const x0 = 3;
  const y0 = 9;
  const w = 10;
  const h = 11;
  const stained = variant === 'stained';
  const STAIN = ['#c8423a', '#3f5ba0', '#e4b83d', '#3f8a5a', '#8a4ab0'].map((h2) => rgb(h2));
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const lx = x - x0;
      const ly = y - y0;
      // Arched top for the chapel.
      if (stained && ly < 4) {
        const ax = lx - 4.5;
        if (ax * ax + (ly - 4) ** 2 * 1.6 > 26) continue;
      }
      const frame = lx === 0 || lx === w - 1 || ly === h - 1 || (!stained && ly === 0);
      const mull = lx === 4 || lx === 5 || ly === 5;
      if (lit) {
        if (frame || (mull && !stained)) continue;
        let c;
        if (stained) {
          const pane = (Math.floor(lx / 3) + Math.floor(ly / 3)) % STAIN.length;
          c = mixc(STAIN[pane], rgb('#ffe3a3'), 0.45);
          if ((lx + ly) % 3 === 0) c = rgb('#2a1a14');
        } else c = tone(PAL.glow, 0.6 + (1 - ly / h) * 0.3 - (lx > 5 ? 0.08 : 0));
        b.set(x, y, c);
        continue;
      }
      let c;
      if (frame) c = tone(stained ? PAL.stone : PAL.wood, lx === 0 || ly === 0 ? 0.62 : 0.3);
      else if (mull && !stained) c = tone(PAL.wood, 0.5);
      else if (stained) {
        const pane = (Math.floor(lx / 3) + Math.floor(ly / 3)) % STAIN.length;
        c = shade(STAIN[pane], 0.55 + (ly < 5 ? 0.1 : 0));
        if ((lx + ly) % 3 === 0) c = rgb('#1a1423');
      } else {
        // Dark glass with the sky caught on a diagonal.
        const diag = (lx - ly + 20) % 7;
        c = tone(PAL.glass, 0.25 + (diag < 2 ? 0.35 : 0) - ly * 0.012);
      }
      b.set(x, y, c);
    }
  }
  if (!lit) {
    // Sill.
    for (let x = x0 - 1; x <= x0 + w; x++) {
      b.set(x, y0 + h, tone(stained ? PAL.stone : PAL.wood, 0.72));
      b.set(x, y0 + h + 1, tone(stained ? PAL.stone : PAL.wood, 0.32));
    }
    if (!stained) {
      // Shutters.
      const SH = variant === 'flowers' ? lut(['#1e3a2a', '#2f5a3e', '#457a54', '#5e9a6a']) : lut(['#3a1d18', '#5e2c22', '#86402e', '#a8583c']);
      for (let y = y0; y < y0 + h; y++) {
        b.set(x0 - 2, y, tone(SH, y % 3 === 0 ? 0.35 : 0.7));
        b.set(x0 - 1, y, tone(SH, 0.5));
        b.set(x0 + w, y, tone(SH, 0.35));
        b.set(x0 + w + 1, y, tone(SH, y % 3 === 0 ? 0.15 : 0.3));
      }
    }
    if (variant === 'flowers') {
      for (let x = x0 - 1; x <= x0 + w; x++) {
        b.set(x, y0 + h + 2, tone(PAL.wood, 0.55));
        b.set(x, y0 + h + 3, tone(PAL.wood, 0.3));
      }
      const fl = ['#ff7a8a', '#ffd75e', '#f4f0e6', '#c79bff'];
      for (let k = 0; k < 6; k++) {
        const x = x0 + k * 2 - 1 + (k % 2);
        b.set(x, y0 + h + 1, rgb('#3f7a3a'));
        b.set(x, y0 + h, rgb(fl[k % fl.length]));
        b.set(x + 1, y0 + h + 1, rgb('#2c5a34'));
      }
    }
    finish(b);
  }
  return b;
}

// ---------------------------------------------------------------------------
// Chests, beds

function chest(open, iron) {
  const b = buf(16, 16);
  const W = iron ? PAL.woodDark : PAL.wood;
  if (open) {
    // Lid thrown back.
    for (let y = 0; y < 4; y++) for (let x = 2; x < 14; x++) b.set(x, y, tone(W, y === 0 ? 0.6 : 0.3 + (x === 2 ? 0.1 : 0)));
    box(b, 2, 5, 12, 10, 3, W, { grain: true, seed: 3 });
    for (let x = 3; x < 13; x++) {
      b.set(x, 5, tone(PAL.woodDark, 0.15));
      b.set(x, 6, tone(PAL.woodDark, 0.1));
    }
    b.set(5, 6, tone(PAL.gold, 0.9));
    b.set(9, 6, tone(PAL.gold, 0.7));
    b.set(7, 5, tone(PAL.gold, 0.8));
  } else {
    // Rounded lid.
    for (let y = 3; y < 8; y++) {
      for (let x = 2; x < 14; x++) {
        const t = 0.72 - (y - 3) * 0.07 - (x === 13 ? 0.15 : 0) + (x === 2 ? 0.05 : 0);
        b.set(x, y, dtone(W, t, x, y));
      }
    }
    box(b, 2, 8, 12, 7, 0, W, { grain: true, seed: 4 });
    for (let x = 2; x < 14; x++) b.set(x, 8, tone(W, 0.2));
    // Lock plate.
    b.set(7, 8, tone(PAL.gold, 0.8));
    b.set(8, 8, tone(PAL.gold, 0.6));
    b.set(7, 9, tone(PAL.gold, 0.55));
    b.set(8, 9, tone(PAL.gold, 0.35));
  }
  // Iron bands.
  for (const x of [4, 11]) for (let y = open ? 5 : 3; y < 15; y++) b.set(x, y, tone(PAL.iron, y < 8 && !open ? 0.65 : 0.45));
  if (iron) for (let x = 2; x < 14; x++) b.set(x, 12, tone(PAL.iron, 0.4));
  finish(b);
  groundShadow(b, 8.5, 15, 7, 1.2, 60);
  return b;
}

function bed(quilt, { patternC = null, stars = false, simple = false } = {}) {
  const b = buf(16, 36);
  const Q = lut(quilt);
  // Headboard.
  for (let y = 0; y < 8; y++) {
    for (let x = 1; x < 15; x++) {
      const post = x < 3 || x > 12;
      let t = post ? (x === 1 ? 0.62 : x === 14 ? 0.22 : 0.45) : 0.5 - (y > 5 ? 0.1 : 0);
      if (y === 0) t += 0.12;
      if (simple && !post && y < 3) continue;
      b.set(x, y, dtone(PAL.wood, t + (ih(x >> 1, y, 721) - 0.5) * 0.06, x, y));
    }
  }
  // Pillow.
  for (let y = 5; y < 11; y++) for (let x = 3; x < 13; x++) b.set(x, y, tone(PAL.bone, 0.85 - (y - 5) * 0.06 - (x === 12 ? 0.15 : 0) + (x === 3 ? 0.05 : 0)));
  // Quilt with a folded top edge.
  for (let y = 10; y < 33; y++) {
    for (let x = 2; x < 14; x++) {
      let t = 0.58 - (x - 2) * 0.012 - (y - 10) * 0.006;
      if (y === 10 || y === 11) t = y === 10 ? 0.85 : 0.75;
      if (y === 12) t = 0.3;
      if (x === 2) t += 0.08;
      if (x === 13) t -= 0.2;
      let c = dtone(Q, t, x, y, 0.04);
      if (patternC && y > 13 && !simple) {
        if ((x + y) % 6 === 0 || (x - y + 60) % 6 === 0) c = mixc(c, patternC, 0.45);
      }
      if (stars && y > 14 && ih(x, y, 722) > 0.93) c = rgb('#ffe27a');
      b.set(x, y, c);
    }
  }
  // Footboard.
  for (let y = 32; y < 36; y++) for (let x = 1; x < 15; x++) b.set(x, y, tone(PAL.wood, y === 32 ? 0.62 : x === 14 ? 0.2 : 0.4));
  finish(b);
  return b;
}

// ---------------------------------------------------------------------------
// Fires and lamps

function flame(b, cx, by, h, w, f, seed, { L = PAL.ember } = {}) {
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const sway = Math.sin(f * 1.7 + t * 3 + seed) * t * 1.6;
    const hw = w * (1 - t * t) * (0.85 + 0.15 * Math.sin(f * 2.3 + seed + y));
    for (let x = Math.floor(cx + sway - hw); x <= Math.ceil(cx + sway + hw); x++) {
      const u = Math.abs(x + 0.5 - cx - sway) / Math.max(0.6, hw);
      if (u > 1) continue;
      const k = 1 - u * 0.6 - t * 0.55;
      b.set(x, by - y, tone(L, 0.35 + k * 0.65));
    }
  }
}

function hearthFrames() {
  const frames = [];
  for (let f = 0; f < 4; f++) {
    const b = buf(32, 32);
    // Stone surround with a chimney breast above.
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const hood = y < 10 && (x < 6 || x > 25);
        if (hood) continue;
        const ax = x - 15.5;
        const opening = y > 15 && Math.abs(ax) < 8 && !(y < 19 && ax * ax + (y - 19) ** 2 * 4 > 64);
        if (opening) continue;
        const course = Math.floor(y / 4);
        const off = course % 2 ? 3 : 0;
        let t = 0.5 + (ih((x + off) >> 2, course, 731) - 0.5) * 0.2;
        if (y % 4 === 3 || (x + off) % 6 === 5) t -= 0.18;
        if (x === 0 || x === 6) t += 0.12;
        if (x === 31 || x === 25) t -= 0.2;
        if (y > 26) t -= 0.06;
        b.set(x, y, dtone(PAL.stoneWarm, t, x, y, 0.05));
      }
    }
    // Mantel.
    for (let x = 2; x < 30; x++) {
      b.set(x, 11, tone(PAL.wood, 0.72));
      b.set(x, 12, tone(PAL.wood, 0.5));
      b.set(x, 13, tone(PAL.wood, 0.25));
    }
    // A candle and a jar on the mantel.
    b.set(6, 9, tone(PAL.bone, 0.9));
    b.set(6, 10, tone(PAL.bone, 0.7));
    b.set(6, 8, tone(PAL.ember, 0.9 - (f % 2) * 0.1));
    b.set(24, 9, tone(PAL.glass, 0.6));
    b.set(25, 9, tone(PAL.glass, 0.4));
    b.set(24, 10, tone(PAL.glass, 0.45));
    b.set(25, 10, tone(PAL.glass, 0.3));
    // Firebox: soot, logs and flames.
    for (let y = 16; y < 31; y++) for (let x = 8; x < 24; x++) if (!(b.get(x, y) >>> 24)) b.set(x, y, tone(PAL.stone, 0.06 + (y - 16) * 0.006));
    flame(b, 13, 28, 9 + (f % 2), 2.6, f, 1);
    flame(b, 18, 28, 8 + ((f + 1) % 3), 2.3, f, 3);
    flame(b, 15.5, 28, 11 - (f % 2), 2, f, 5);
    for (let x = 10; x < 22; x++) {
      b.set(x, 29, tone(PAL.bark, 0.5 - (x > 15 ? 0.2 : 0)));
      b.set(x, 30, tone(PAL.ember, 0.4 + ((x + f) % 3) * 0.12));
    }
    finish(b);
    frames.push(b);
  }
  return frames;
}

function campfireFrames() {
  const frames = [];
  for (let f = 0; f < 6; f++) {
    const b = buf(20, 22);
    // Logs crossed under the fire.
    for (let k = 0; k < 9; k++) {
      b.set(5 + k, 18 - (k >> 2), tone(PAL.bark, 0.55 - k * 0.02));
      b.set(5 + k, 19 - (k >> 2), tone(PAL.bark, 0.3));
      b.set(14 - k, 18 - (k >> 2), tone(PAL.bark, 0.45));
      b.set(14 - k, 19 - (k >> 2), tone(PAL.bark, 0.22));
    }
    flame(b, 10, 17, 10 + (f % 3), 3.2, f, 0);
    flame(b, 7.5, 17, 6 + ((f + 2) % 3), 1.8, f, 2);
    flame(b, 12.5, 17, 7 + ((f + 1) % 2), 2, f, 4);
    // Stone ring.
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const x = Math.round(10 + Math.cos(a) * 7.5);
      const y = Math.round(18 + Math.sin(a) * 2.6);
      if (y < 17 && Math.abs(x - 10) < 4) continue;
      b.set(x, y, tone(PAL.stone, 0.62 - Math.sin(a) * 0.15));
      b.set(x + 1, y, tone(PAL.stone, 0.4));
      b.set(x, y + 1, tone(PAL.stone, 0.25));
    }
    finish(b);
    // Floating sparks above the outline.
    b.set(9 + (f % 3), 4 - (f % 2), tone(PAL.ember, 0.95));
    b.set(12 - (f % 2), 2 + (f % 3), tone(PAL.ember, 0.8));
    frames.push(b);
  }
  return frames;
}

function lampPost(lit, f = 0) {
  const b = buf(12, 34);
  // Post and base.
  for (let y = 10; y < 31; y++) {
    b.set(5, y, tone(PAL.iron, 0.6));
    b.set(6, y, tone(PAL.iron, 0.3));
  }
  for (let y = 30; y < 34; y++) for (let x = 3; x < 9; x++) b.set(x, y, tone(PAL.stone, 0.55 - (x - 3) * 0.06 + (y === 30 ? 0.15 : 0)));
  // Lantern head: cap, glass, frame.
  for (let x = 2; x < 10; x++) b.set(x, 2, tone(PAL.iron, 0.55));
  for (let x = 3; x < 9; x++) b.set(x, 1, tone(PAL.iron, 0.7));
  b.set(5, 0, tone(PAL.iron, 0.6));
  b.set(6, 0, tone(PAL.iron, 0.4));
  for (let y = 3; y < 10; y++) {
    for (let x = 3; x < 9; x++) {
      const frame = x === 3 || x === 8 || y === 9;
      if (frame) b.set(x, y, tone(PAL.iron, x === 3 ? 0.5 : 0.25));
      else if (lit) {
        const k = 0.75 + (f === 1 ? 0.08 : f === 2 ? -0.05 : 0) - Math.abs(x - 5.5) * 0.06 - Math.abs(y - 6) * 0.04;
        b.set(x, y, tone(PAL.glow, k));
      } else b.set(x, y, tone(PAL.glass, (x - y + 10) % 4 === 0 ? 0.5 : 0.25));
    }
  }
  if (lit) {
    b.set(5, 6, rgb('#fff6dc'));
    b.set(6, 6, rgb('#ffe3a3'));
    b.set(5, 5, rgb('#ffe3a3'));
  }
  for (let x = 2; x < 10; x++) b.set(x, 10, tone(PAL.iron, 0.4));
  finish(b);
  groundShadow(b, 6.5, 33, 4, 1, 60);
  return b;
}

function candleStand(lit, f = 0) {
  const b = buf(14, 22);
  for (let y = 10; y < 20; y++) {
    b.set(6, y, tone(PAL.iron, 0.6));
    b.set(7, y, tone(PAL.iron, 0.3));
  }
  for (let x = 3; x < 11; x++) b.set(x, 20, tone(PAL.iron, 0.5));
  for (let x = 4; x < 10; x++) b.set(x, 21, tone(PAL.iron, 0.3));
  for (let x = 2; x < 12; x++) b.set(x, 9, tone(PAL.iron, 0.55));
  for (const cx of [3, 7, 10]) {
    const h = cx === 7 ? 5 : 4;
    for (let y = 9 - h; y < 9; y++) {
      b.set(cx, y, tone(PAL.bone, 0.9));
      b.set(cx + (cx === 7 ? -1 : 0), y, tone(PAL.bone, 0.75));
    }
    if (lit) {
      const fy = 8 - h;
      b.set(cx, fy, tone(PAL.ember, 0.85 + ((f + cx) % 3) * 0.05));
      b.set(cx, fy - 1, tone(PAL.ember, 0.95));
      if ((f + cx) % 2) b.set(cx, fy - 2, tone(PAL.ember, 0.7));
    }
  }
  finish(b);
  return b;
}

// ---------------------------------------------------------------------------
// Furniture

function counter(variant) {
  const b = buf(16, 20);
  box(b, 0, 4, 16, 16, 4, PAL.wood, { topL: PAL.woodLight, grain: true, seed: 11 });
  // Panelled front.
  for (let y = 10; y < 18; y++) {
    for (const x of [3, 12]) b.set(x, y, tone(PAL.wood, 0.28));
    for (const x of [4, 13]) b.set(x, y, tone(PAL.wood, 0.6));
  }
  if (variant === 'left') for (let y = 4; y < 20; y++) b.set(0, y, tone(PAL.wood, 0.7));
  if (variant === 'right') for (let y = 4; y < 20; y++) b.set(15, y, tone(PAL.wood, 0.2));
  if (variant === 'left' || variant === 'mid') {
    // A mug on the bar.
    const mx = variant === 'left' ? 9 : 5;
    for (let y = 1; y < 5; y++) {
      b.set(mx, y, tone(PAL.woodLight, 0.7));
      b.set(mx + 1, y, tone(PAL.woodLight, 0.5));
      b.set(mx + 2, y, tone(PAL.woodLight, 0.35));
    }
    b.set(mx + 3, 2, tone(PAL.woodLight, 0.4));
    b.set(mx, 1, rgb('#f6ecdb'));
    b.set(mx + 1, 1, rgb('#f6ecdb'));
  }
  finish(b);
  return b;
}

function shelf(variant) {
  const b = buf(16, 30);
  // Frame.
  for (let y = 0; y < 30; y++) {
    for (let x = 1; x < 15; x++) {
      const side = x < 3 || x > 12;
      const board = y < 2 || y % 9 === 8 || y % 9 === 0 || y > 27;
      let t;
      if (side) t = x === 1 ? 0.6 : x === 14 ? 0.2 : 0.42;
      else if (board) t = y % 9 === 0 || y < 1 ? 0.62 : 0.32;
      else t = 0.12; // the dark back
      b.set(x, y, dtone(PAL.wood, t, x, y, 0.03));
    }
  }
  const BOOKS = ['#8e2c3a', '#2e4686', '#3f744a', '#b58726', '#5a3d6a', '#7a553a', '#2f7a7c'].map((h) => rgb(h));
  for (let s = 0; s < 3; s++) {
    const top = 2 + s * 9;
    const bot = top + 6;
    let x = 3;
    let k = 0;
    while (x < 13) {
      const seed = ih(x, s, 741 + variant.length);
      if (variant === 'books') {
        const w = 1 + Math.floor(seed * 2);
        const h = 4 + Math.floor(ih(x, s, 742) * 3);
        const c = BOOKS[(k + s * 3) % BOOKS.length];
        for (let xx = x; xx < x + w && xx < 13; xx++) for (let y = bot - h + 1; y <= bot; y++) b.set(xx, y, xx === x ? mixc(c, rgb('#ffffff'), 0.15) : shade(c, 0.75));
        if (w > 1) b.set(x, bot - h + 2, tone(PAL.gold, 0.8));
        x += w + (seed > 0.8 ? 1 : 0);
      } else if (variant === 'bottles' || variant === 'potions') {
        const c = variant === 'potions' ? [rgb('#cc3a45'), rgb('#58cf8f'), rgb('#7a64e0'), rgb('#4b9ac9')][k % 4] : [rgb('#3f6a3a'), rgb('#7a3a22'), rgb('#c8b890')][k % 3];
        const h = variant === 'potions' ? 3 : 5;
        for (let y = bot - h + 1; y <= bot; y++) {
          b.set(x, y, y === bot - h + 1 ? tone(PAL.bone, 0.6) : mixc(c, rgb('#ffffff'), y === bot - h + 2 ? 0.3 : 0.05));
          b.set(x + 1, y, y === bot - h + 1 ? 0 : shade(c, 0.7));
        }
        if (variant === 'potions') b.set(x + 1, bot - h + 1, 0);
        x += 3;
      } else if (variant === 'barrels') {
        cylinder(b, x + 1.5, bot - 4, bot, 1.6, PAL.wood, { bands: [1, 3], bandL: PAL.iron });
        x += 4;
      } else if (variant === 'herbs') {
        for (let y = bot - 4; y <= bot; y++) b.set(x, y, rgb(k % 2 ? '#6a9a5a' : '#8aa860'));
        b.set(x + 1, bot - 2, rgb('#4a7a3a'));
        b.set(x, bot - 5, rgb('#b8a070'));
        x += 3;
      } else {
        // goods: boxes, rope coils, jars
        const kind = k % 3;
        if (kind === 0) box(b, x, bot - 3, 4, 4, 1, PAL.woodLight, {});
        else if (kind === 1) {
          for (let y = bot - 2; y <= bot; y++) for (let xx = x; xx < x + 3; xx++) b.set(xx, y, tone(PAL.straw, 0.55 + ((xx + y) % 2) * 0.15));
        } else {
          b.set(x, bot - 2, tone(PAL.glass, 0.6));
          b.set(x + 1, bot - 2, tone(PAL.glass, 0.4));
          b.set(x, bot - 1, tone(PAL.glass, 0.5));
          b.set(x + 1, bot - 1, tone(PAL.glass, 0.3));
          b.set(x, bot, tone(PAL.glass, 0.4));
          b.set(x + 1, bot, tone(PAL.glass, 0.25));
        }
        x += kind === 0 ? 5 : 4;
      }
      k++;
    }
  }
  finish(b);
  return b;
}

function table(variant, w = 32) {
  const b = buf(w, 18);
  // Legs.
  for (const x of [2, w - 4]) for (let y = 9; y < 18; y++) {
    b.set(x, y, tone(PAL.wood, 0.5));
    b.set(x + 1, y, tone(PAL.wood, 0.25));
  }
  box(b, 0, 2, w, 8, 6, PAL.wood, { topL: PAL.woodLight, grain: true, seed: 21 });
  for (let x = 1; x < w - 1; x++) if (x % 8 === 0) for (let y = 2; y < 8; y++) b.set(x, y, tone(PAL.woodLight, 0.45));
  if (variant === 'map') {
    for (let y = 3; y < 7; y++) for (let x = 5; x < w - 6; x++) b.set(x, y, tone(PAL.paper, 0.75 - (x > w - 9 ? 0.1 : 0) + ((x * 3 + y * 5) % 11 === 0 ? -0.25 : 0)));
    b.set(10, 4, rgb('#cc3a45'));
    b.set(19, 5, rgb('#cc3a45'));
    b.set(22, 4, rgb('#cc3a45'));
    b.set(23, 4, rgb('#cc3a45'));
  } else if (variant === 'herbs') {
    for (let k = 0; k < 3; k++) {
      const x = 4 + k * 4;
      for (let s = 0; s < 4; s++) b.set(x + s, 4 + (s % 2), rgb(s === 3 ? '#b8a070' : '#5e9a4c'));
    }
    // Mortar and pestle.
    b.set(22, 3, tone(PAL.stone, 0.6));
    b.set(23, 3, tone(PAL.stone, 0.4));
    b.set(22, 4, tone(PAL.stone, 0.5));
    b.set(23, 4, tone(PAL.stone, 0.3));
    b.set(24, 2, tone(PAL.wood, 0.6));
  } else if (variant === 'tools') {
    for (let s = 0; s < 6; s++) b.set(6 + s, 5, tone(PAL.wood, 0.6));
    b.set(12, 4, tone(PAL.iron, 0.7));
    b.set(12, 5, tone(PAL.iron, 0.5));
    b.set(13, 4, tone(PAL.iron, 0.4));
    for (let s = 0; s < 5; s++) b.set(18 + s, 3 + (s >> 1), tone(PAL.iron, 0.6 - s * 0.05));
  } else {
    // A plate with bread and a mug.
    b.ellipse(10, 5, 3, 1.4, (x, y, nx, ny) => tone(PAL.bone, 0.85 - ny * 0.1));
    b.set(10, 4, tone(PAL.woodLight, 0.8));
    b.set(11, 4, tone(PAL.woodLight, 0.6));
    for (let y = 2; y < 6; y++) {
      b.set(20, y, tone(PAL.iron, 0.6));
      b.set(21, y, tone(PAL.iron, 0.4));
    }
    b.set(22, 3, tone(PAL.iron, 0.35));
  }
  finish(b);
  return b;
}

function chair(variant) {
  const b = buf(16, 18);
  const backLeft = variant !== 'left';
  const bx = backLeft ? 4 : 11;
  for (let y = 2; y < 17; y++) {
    b.set(bx, y, tone(PAL.wood, 0.55));
    b.set(bx + 1, y, tone(PAL.wood, 0.3));
  }
  for (let y = 3; y < 9; y += 2) for (let x = bx - 1; x <= bx + 2; x++) b.set(x, y, tone(PAL.wood, 0.45));
  box(b, 4, 9, 9, 3, 2, PAL.wood, { topL: PAL.woodLight });
  for (const x of [4, 11]) for (let y = 12; y < 17; y++) b.set(x, y, tone(PAL.wood, x === 4 ? 0.45 : 0.25));
  finish(b);
  return b;
}

function barrel(variant) {
  const b = buf(16, 20);
  cylinder(b, 8, 3, 18, 5.5, PAL.wood, { bulge: 0.8, bands: [1, 7, 13], bandL: PAL.iron });
  // Staves.
  for (let y = 4; y < 18; y++) for (const x of [5, 8, 11]) b.set(x, y, shade(b.get(x, y), 0.85));
  disc(b, 8, 3, 5.5, 2, variant === 'water' ? PAL.glass : PAL.woodLight, variant === 'water' ? (nx, ny) => 0.5 - ny * 0.2 + (Math.abs(nx + ny) < 0.2 ? 0.3 : 0) : null);
  if (variant !== 'water') {
    b.set(6, 3, tone(PAL.woodLight, 0.4));
    b.set(10, 3, tone(PAL.woodLight, 0.4));
  }
  finish(b);
  groundShadow(b, 8.5, 19, 6, 1.2, 60);
  return b;
}

function crate(variant) {
  const b = buf(16, 16);
  box(b, 1, 2, 14, 13, 4, PAL.woodLight, { grain: true, seed: 31, lit: -0.05 });
  // Cross brace on the front.
  for (let k = 0; k < 9; k++) {
    b.set(3 + k * 1.1, 7 + k, tone(PAL.wood, 0.55));
    b.set(4 + k * 1.1, 7 + k, tone(PAL.wood, 0.3));
  }
  for (let x = 1; x < 15; x++) {
    b.set(x, 6, tone(PAL.wood, 0.4));
    b.set(x, 14, tone(PAL.wood, 0.3));
  }
  if (variant === 'turnips') {
    for (const [x, y] of [
      [4, 3],
      [7, 2],
      [10, 3],
      [6, 4],
      [9, 4],
    ]) {
      b.set(x, y, rgb('#e0c0e0'));
      b.set(x + 1, y, rgb('#8a4a8a'));
      b.set(x, y - 1, rgb('#5e9a4c'));
    }
  }
  if (variant === 'stamped') {
    b.ellipse(10, 10, 2.2, 2.2, (x, y, nx, ny, d) => (d > 0.5 ? rgb('#9e2133') : 0));
  }
  finish(b);
  groundShadow(b, 8.5, 15, 7, 1.2, 60);
  return b;
}

function sack() {
  const b = buf(16, 14);
  b.ellipse(8, 9, 5.5, 4.5, (x, y, nx, ny, d) => tone(PAL.straw, 0.6 - nx * 0.25 - ny * 0.2 - (d > 0.8 ? 0.1 : 0)));
  for (let y = 2; y < 6; y++) {
    b.set(7, y, tone(PAL.straw, 0.65));
    b.set(8, y, tone(PAL.straw, 0.45));
  }
  b.set(6, 5, tone(PAL.wood, 0.5));
  b.set(9, 5, tone(PAL.wood, 0.3));
  finish(b);
  return b;
}

function pot(variant) {
  const b = buf(16, 18);
  const CLAY = lut(['#4a2014', '#7a3a22', '#a85a34', '#cc7a4a', '#e09a68']);
  for (let y = 11; y < 18; y++) {
    const hw = 4 - (y - 11) * 0.25;
    for (let x = Math.floor(8 - hw); x <= Math.ceil(8 + hw - 1); x++) b.set(x, y, tone(CLAY, 0.6 - (x - 8) * 0.08 - (y === 11 ? -0.15 : 0)));
  }
  const rng = { k: 0, next() { return ih(this.k++, variant.length, 751); } };
  for (let k = 0; k < 8; k++) {
    const a = -Math.PI / 2 + (rng.next() - 0.5) * 2.4;
    const len = 4 + rng.next() * 5;
    for (let s = 0; s < len; s++) b.set(Math.round(8 + Math.cos(a) * s), Math.round(11 + Math.sin(a) * s), tone(PAL.leaf, 0.45 + (s / len) * 0.4 - (Math.cos(a) > 0 ? 0.12 : 0)));
  }
  if (variant === 'flower') {
    for (const [x, y] of [
      [6, 3],
      [10, 4],
      [8, 2],
    ]) {
      b.set(x, y, rgb('#ff9fc2'));
      b.set(x + 1, y, rgb('#c85a8a'));
      b.set(x, y - 1, rgb('#ffd6ea'));
    }
  }
  finish(b);
  return b;
}

function cauldronFrames() {
  const frames = [];
  for (let f = 0; f < 3; f++) {
    const b = buf(16, 18);
    for (const x of [4, 11]) for (let y = 14; y < 18; y++) b.set(x, y, tone(PAL.iron, 0.3));
    b.ellipse(8, 11, 6.5, 5, (x, y, nx, ny) => tone(PAL.iron, 0.42 - nx * 0.22 - ny * 0.15));
    disc(b, 8, 7, 6, 2, lut(['#1d5a2a', '#2f8a3e', '#58cf6f', '#9ff0a0']), (nx, ny) => 0.55 - ny * 0.2);
    for (let x = 2; x < 15; x++) b.set(x, 6, tone(PAL.iron, x < 8 ? 0.7 : 0.45));
    const bx = [5, 9, 11][f];
    b.set(bx, 7, rgb('#d0ffd0'));
    b.set(bx + 1, 6, rgb('#9ff0a0'));
    finish(b);
    b.set(7 + f, 3 - (f % 2), rgb('#9ff0a0', 160));
    frames.push(b);
  }
  return frames;
}

function rack(variant) {
  const b = buf(16, 26);
  for (const x of [2, 13]) for (let y = 4; y < 26; y++) {
    b.set(x, y, tone(PAL.wood, 0.55));
    b.set(x + 1, y, tone(PAL.wood, 0.28));
  }
  for (const y of [6, 20]) for (let x = 2; x < 15; x++) b.set(x, y, tone(PAL.wood, 0.5));
  if (variant === 'tools') {
    // Hammer, tongs, file.
    for (let y = 7; y < 16; y++) b.set(5, y, tone(PAL.wood, 0.6));
    for (let x = 4; x < 8; x++) b.set(x, 7, tone(PAL.iron, 0.6));
    for (let y = 7; y < 17; y++) {
      b.set(9, y, tone(PAL.iron, 0.6));
      b.set(10 + (y > 12 ? 1 : 0), y, tone(PAL.iron, 0.4));
    }
  } else {
    // Swords and a spear standing in the rack.
    for (const [x, h] of [
      [5, 16],
      [8, 18],
      [11, 15],
    ]) {
      for (let y = 22 - h; y < 22; y++) b.set(x, y, tone(PAL.iron, y < 22 - h + 2 ? 0.9 : 0.7));
      for (let y = 22 - h + 1; y < 19; y++) b.set(x + 1, y, tone(PAL.iron, 0.4));
      b.set(x - 1, 18, tone(PAL.gold, 0.6));
      b.set(x + 1, 18, tone(PAL.gold, 0.4));
      for (let y = 19; y < 23; y++) b.set(x, y, tone(PAL.wood, 0.45));
    }
  }
  finish(b);
  return b;
}

function nightstand() {
  const b = buf(16, 18);
  box(b, 3, 7, 10, 11, 3, PAL.wood, { topL: PAL.woodLight, grain: true, seed: 41 });
  for (let x = 5; x < 11; x++) b.set(x, 12, tone(PAL.wood, 0.3));
  b.set(8, 13, tone(PAL.gold, 0.7));
  // Candle in a dish, and a book.
  b.set(9, 4, tone(PAL.bone, 0.9));
  b.set(9, 5, tone(PAL.bone, 0.85));
  b.set(9, 6, tone(PAL.bone, 0.7));
  b.set(9, 3, tone(PAL.ember, 0.9));
  b.set(8, 7, tone(PAL.iron, 0.6));
  b.set(10, 7, tone(PAL.iron, 0.4));
  b.set(5, 7, rgb('#2e4686'));
  b.set(6, 7, rgb('#22346a'));
  finish(b);
  return b;
}

// Lyra's writing desk at the inn: a star chart, a candle, a letter she has not finished.
function desk() {
  const b = buf(16, 22);
  for (const x of [2, 12]) for (let y = 12; y < 22; y++) {
    b.set(x, y, tone(PAL.wood, 0.5));
    b.set(x + 1, y, tone(PAL.wood, 0.25));
  }
  box(b, 1, 7, 14, 6, 4, PAL.wood, { topL: PAL.woodLight, grain: true, seed: 51 });
  // Star chart.
  for (let y = 7; y < 10; y++) for (let x = 3; x < 8; x++) b.set(x, y, rgb(y === 7 ? '#33497a' : '#26345a'));
  b.set(4, 8, rgb('#ffe27a'));
  b.set(6, 7, rgb('#ddd2ff'));
  b.set(5, 9, rgb('#ddd2ff'));
  // Letter.
  for (let x = 9; x < 13; x++) {
    b.set(x, 9, tone(PAL.paper, 0.85));
    b.set(x, 10, tone(PAL.paper, 0.7));
  }
  b.set(10, 9, tone(PAL.wood, 0.3));
  // Candle.
  for (let y = 3; y < 7; y++) b.set(12, y, tone(PAL.bone, 0.9 - (y - 3) * 0.05));
  b.set(12, 2, tone(PAL.ember, 0.95));
  b.set(12, 1, tone(PAL.ember, 0.8));
  // A pressed moonpetal.
  b.set(8, 8, rgb('#c9b8ff'));
  finish(b);
  return b;
}

function trunk() {
  const b = buf(16, 16);
  const SEA = lut(['#122a30', '#1c4048', '#28585e', '#377276', '#4f8e8e']);
  for (let y = 3; y < 8; y++) for (let x = 2; x < 14; x++) b.set(x, y, tone(SEA, 0.72 - (y - 3) * 0.08 - (x === 13 ? 0.2 : 0)));
  box(b, 2, 8, 12, 7, 0, SEA, {});
  for (const x of [2, 13]) {
    b.set(x, 3, tone(PAL.gold, 0.8));
    b.set(x, 14, tone(PAL.gold, 0.6));
  }
  for (let x = 2; x < 14; x++) b.set(x, 8, tone(PAL.gold, 0.45));
  b.set(7, 9, tone(PAL.gold, 0.85));
  b.set(8, 9, tone(PAL.gold, 0.6));
  // Salt scuffs.
  b.set(3, 12, rgb('#c8d8d0'));
  b.set(12, 5, rgb('#c8d8d0'));
  finish(b);
  groundShadow(b, 8.5, 15, 7, 1.2, 60);
  return b;
}

function journalFrames() {
  const frames = [];
  for (let f = 0; f < 4; f++) {
    const b = buf(14, 12);
    const LEATHER = lut(['#2a140e', '#4a2418', '#6e3a24', '#8e5232', '#a86a42']);
    for (let y = 4; y < 10; y++) for (let x = 2; x < 12; x++) b.set(x, y, tone(LEATHER, 0.62 - (y - 4) * 0.05 - (x === 11 ? 0.2 : 0)));
    for (let x = 3; x < 12; x++) b.set(x, 10, tone(PAL.paper, 0.75));
    b.set(11, 9, tone(PAL.paper, 0.6));
    for (let y = 4; y < 10; y++) b.set(4, y, tone(LEATHER, 0.3));
    b.set(11, 6, tone(PAL.gold, 0.9));
    b.set(11, 7, tone(PAL.gold, 0.6));
    b.set(7, 6, tone(PAL.gold, 0.7 + (f % 2) * 0.2));
    finish(b);
    // Golden motes drifting over it.
    const motes = [
      [3, 2],
      [10, 1],
      [7, 0],
      [12, 3],
    ];
    const [mx, my] = motes[f];
    b.set(mx, my, rgb('#ffe27a'));
    b.set((mx + 5) % 13, (my + 2) % 4, rgb('#fff3c2', 180));
    frames.push(b);
  }
  return frames;
}

const BED_QUILTS = [
  ['rose', ['#4a1a2a', '#6e2a3e', '#944058', '#b05a70', '#d08a9a', '#f0c0c8'], '#f6ecdb'],
  ['patch', ['#3a2a1a', '#5a4026', '#7a5a34', '#9a7a46', '#c0a060', '#e0cc8a'], '#7fae78'],
  ['guard', ['#1c2230', '#2a3446', '#3c4a62', '#52627e', '#70809a', '#98a6bc'], null],
  ['herb', ['#1c3020', '#2a4a30', '#3e6a44', '#56885a', '#7aa87a', '#aacca4'], '#e8dcf0'],
  ['farm', ['#3a2414', '#5a3a1e', '#7a522a', '#9a6c38', '#bc8c4c', '#dcb070'], '#e2d2b0'],
  ['plain', ['#2e2c34', '#43404a', '#5a5662', '#74707c', '#94909a', '#bcb8c0'], null],
  ['merchant', ['#30163e', '#4a2260', '#663284', '#8446a4', '#a86cc4', '#d0a4e4'], '#ffe27a'],
  ['plum', ['#2a1430', '#42204a', '#5e2e66', '#7a4084', '#9c62a4', '#c494c8'], '#f0d68a'],
  ['honey', ['#4a3010', '#704a18', '#986424', '#c08432', '#e0a848', '#f4d080'], '#fff3c2'],
  ['hunter', ['#2a2420', '#3e3630', '#564a40', '#706050', '#8e7c68', '#b0a088'], null],
  ['dyed', ['#1e2a4a', '#2c3e6c', '#4a3a86', '#2f7a86', '#8a4aa0', '#4ab0a8'], '#c8547a'],
  ['ledger', ['#1a2a2a', '#243c3c', '#305252', '#426a6a', '#5e8a88', '#8ab0ac'], '#e2d2b0'],
  ['ochre', ['#3a2410', '#5a381a', '#7c5024', '#a06a30', '#c48a44', '#e0b066'], null],
  ['sea', ['#14283a', '#1e3a54', '#2a5070', '#3a6a8e', '#5a8cac', '#8cb8d0'], '#e8f0f0'],
];

export function registerFurniture(add) {
  const doors = doorFrames();
  add('prop:door:anim', doors, { ox: 8, oy: 25 });
  add('prop:door:closed', [doors[0]], { ox: 8, oy: 25 });
  add('prop:door:open', [doors[4]], { ox: 8, oy: 25 });
  add('prop:door', [doors[0]], { ox: 8, oy: 25 });
  const gates = gateFrames();
  add('prop:door:gate:anim', gates, { ox: 8, oy: 29 });
  add('prop:door:gate:closed', [gates[0]], { ox: 8, oy: 29 });
  add('prop:door:gate:open', [gates[4]], { ox: 8, oy: 29 });
  for (const v of [null, 'stained', 'flowers']) {
    const n = v ? `prop:window:${v}` : 'prop:window';
    add(n, [windowSprite(v, false)], { ox: 8, oy: 31 });
    add(`${n}:lit`, [windowSprite(v, true)], { ox: 8, oy: 31 });
  }
  add('prop:chest:closed', [chest(false, false)], { ox: 8, oy: 15 });
  add('prop:chest:open', [chest(true, false)], { ox: 8, oy: 15 });
  add('prop:chest:closed:iron', [chest(false, true)], { ox: 8, oy: 15 });
  add('prop:chest:open:iron', [chest(true, true)], { ox: 8, oy: 15 });
  add('prop:chest', [chest(false, false)], { ox: 8, oy: 15 });
  add('prop:bed', [bed(['#16223e', '#22346a', '#2e4686', '#41609e', '#6a86c0', '#9fb4dc'], { patternC: rgb('#c8d4f0') })], { ox: 8, oy: 35 });
  add('prop:bed:lyra', [bed(['#1c1547', '#33267a', '#4f3db3', '#6a54cc', '#8f7ae0', '#c4b4ff'], { stars: true })], { ox: 8, oy: 35 });
  add('prop:bed:inn', [bed(['#1c3524', '#2c5236', '#43744a', '#5a8e5c', '#7fae78', '#b0d0a0'], { patternC: rgb('#e2d2b0') })], { ox: 8, oy: 35 });
  add('prop:bunk', [bed(['#2b2b35', '#3e3e4c', '#555566', '#6a6a7c', '#8a8a9c', '#b0b0c0'], { simple: true })], { ox: 8, oy: 35 });
  add('prop:bunk:guest', [bed(['#4a1a2e', '#6e2a44', '#94405e', '#b05a76', '#d08aa0', '#f0c0d0'], { patternC: rgb('#f6ecdb') })], { ox: 8, oy: 35 });
  // Every villager's own quilt (DESIGN §19.8), as a bed and as a cot.
  for (const [v, ramp, pattern] of BED_QUILTS) {
    const opts = pattern ? { patternC: rgb(pattern) } : {};
    add(`prop:bed:${v}`, [bed(ramp, opts)], { ox: 8, oy: 35 });
    add(`prop:bunk:${v}`, [bed(ramp, { ...opts, simple: true })], { ox: 8, oy: 35 });
  }
  add('prop:hearth', hearthFrames(), { ox: 16, oy: 31, fps: 6 });
  add('prop:campfire', campfireFrames(), { ox: 10, oy: 19, fps: 8 });
  add('prop:lamp', [lampPost(false)], { ox: 6, oy: 33 });
  add('prop:lamp:lit', [0, 1, 2].map((f) => lampPost(true, f)), { ox: 6, oy: 33, fps: 5 });
  add('prop:lamp:candles', [candleStand(false)], { ox: 7, oy: 21 });
  add('prop:lamp:candles:lit', [0, 1, 2].map((f) => candleStand(true, f)), { ox: 7, oy: 21, fps: 6 });
  for (const v of ['left', 'mid', 'right']) add(`prop:counter:${v}`, [counter(v)], { ox: 8, oy: 19 });
  add('prop:counter', [counter('mid')], { ox: 8, oy: 19 });
  for (const v of ['books', 'bottles', 'barrels', 'goods', 'potions', 'herbs']) add(`prop:shelf:${v}`, [shelf(v)], { ox: 8, oy: 29 });
  add('prop:shelf', [shelf('books')], { ox: 8, oy: 29 });
  add('prop:table', [table(null)], { ox: 16, oy: 17 });
  for (const v of ['herbs', 'map', 'tools']) add(`prop:table:${v}`, [table(v)], { ox: 16, oy: 17 });
  add('prop:chair', [chair('right')], { ox: 8, oy: 17 });
  add('prop:chair:right', [chair('right')], { ox: 8, oy: 17 });
  add('prop:chair:left', [chair('left')], { ox: 8, oy: 17 });
  add('prop:barrel', [barrel(null)], { ox: 8, oy: 19 });
  add('prop:barrel:water', [barrel('water')], { ox: 8, oy: 19 });
  add('prop:crate', [crate(null)], { ox: 8, oy: 15 });
  add('prop:crate:turnips', [crate('turnips')], { ox: 8, oy: 15 });
  add('prop:crate:stamped', [crate('stamped')], { ox: 8, oy: 15 });
  add('prop:sack', [sack()], { ox: 8, oy: 13 });
  add('prop:pot', [pot('plant')], { ox: 8, oy: 17 });
  add('prop:pot:plant', [pot('plant')], { ox: 8, oy: 17 });
  add('prop:pot:flower', [pot('flower')], { ox: 8, oy: 17 });
  add('prop:cauldron', cauldronFrames(), { ox: 8, oy: 17, fps: 4 });
  add('prop:rack', [rack(null)], { ox: 8, oy: 25 });
  add('prop:rack:tools', [rack('tools')], { ox: 8, oy: 25 });
  add('prop:nightstand', [nightstand()], { ox: 8, oy: 17 });
  add('prop:desk', [desk()], { ox: 8, oy: 21 });
  add('prop:desk:lyra', [desk()], { ox: 8, oy: 21 });
  add('prop:trunk', [trunk()], { ox: 8, oy: 15 });
  add('prop:journal', journalFrames(), { ox: 7, oy: 11, fps: 4 });
}

void OUT;
void planks;
