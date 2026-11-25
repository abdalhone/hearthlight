import { buf, finish, groundShadow, tone, dtone, box, PAL, rgb, mixc, shade, ih, lut } from './props_kit.js';

// Props of the wider world (src/world/wilds.js): the King's Road waystones (dead, lit,
// and the Cinderwick fork's burning one), the Crown Ring's standing stones and the
// Lanternwright marker in the deep wood, Brindlecombe's dead wardstone, its graves,
// cold altar and candle rack, and the melted circle at the heart of the ring.

const MOSS = [rgb('#2e4a2a'), rgb('#3d5a31'), rgb('#557539')];
const SNOWCAP = lut(['#8ea1bb', '#b6c5d8', '#dbe5f0', '#f6f9fc']);
const COLD = lut(['#15131c', '#1f1c29', '#2c2838', '#3b3648', '#4d475b']);
const GREYSTONE = lut(['#1c1d1c', '#2a2b29', '#3b3d39', '#4f524b', '#666a60', '#80857a', '#9aa093']);

// A tapering stone shaft from y0 (top) to y1 (base), lit from the upper left.
function shaft(b, cx, y0, y1, wTop, wBot, L, seed, { chip = 0.1 } = {}) {
  for (let y = y0; y <= y1; y++) {
    const v = (y - y0) / Math.max(1, y1 - y0);
    const hw = (wTop + (wBot - wTop) * v) / 2;
    const xl = Math.round(cx - hw + (ih(seed, y >> 2, 11) - 0.5) * 1.2);
    const xr = Math.round(cx + hw + (ih(seed, y >> 2, 12) - 0.5) * 1.2);
    for (let x = xl; x < xr; x++) {
      const u = (x + 0.5 - xl) / Math.max(1, xr - xl);
      let t = 0.62 - u * 0.34 - v * 0.06;
      if (x === xl) t += 0.08;
      if (x === xr - 1) t -= 0.12;
      t += (ih(x >> 1, y >> 1, seed) - 0.5) * chip;
      b.set(x, y, dtone(L, t, x, y, 0.05));
    }
  }
}

// A waystone: a squared pillar with a lamp niche near the top. state 'dead' | 'lit' |
// 'burning'; f = flame frame.
function waystone(state, f) {
  const b = buf(16, 50);
  const L = state === 'dead' ? PAL.stone : PAL.stoneWarm;
  // Plinth.
  box(b, 2, 42, 12, 7, 2, L, { grain: true, seed: 701 });
  // Shaft.
  shaft(b, 8, 9, 42, 8, 10, L, 702);
  // Cap stone.
  box(b, 3, 4, 10, 6, 2, L, { grain: true, seed: 703 });
  // The lamp niche: an arched hollow under the cap.
  for (let y = 11; y <= 18; y++) {
    for (let x = 6; x <= 9; x++) {
      if (y === 11 && (x === 6 || x === 9)) continue;
      let c;
      if (state === 'dead') c = tone(COLD, 0.25 + (y - 11) * 0.03);
      else {
        const L2 = state === 'burning' ? PAL.ember : PAL.glow;
        const fl = (ih(x, y, 704 + f) - 0.5) * 0.3;
        c = tone(L2, 0.55 + (18 - y) * 0.06 + fl);
      }
      b.set(x, y, c);
    }
  }
  if (state === 'dead') {
    // Old soot over the niche, a crack down the shaft.
    for (let x = 5; x <= 10; x++) b.set(x, 10, shade(b.get(x, 10), 0.6));
    for (let y = 22; y < 38; y++) b.set(8 + ((y >> 2) & 1), y, tone(L, 0.22));
  } else {
    // The flame itself and light spilling over the niche's lip.
    const L2 = state === 'burning' ? PAL.ember : PAL.glow;
    const tip = 13 + (f % 2);
    for (let y = tip; y <= 17; y++) b.set(7 + ((f + y) & 1), y, tone(L2, 0.95));
    b.set(7, 16, tone(L2, 1));
    b.set(8, 16, tone(L2, 1));
    for (let x = 5; x <= 10; x++) b.set(x, 19, mixc(b.get(x, 19), tone(L2, 0.8), 0.45));
  }
  // Worn script bands round the shaft.
  for (const y of [24, 31]) for (let x = 5; x <= 11; x++) if (ih(x, y, 705) > 0.45) b.set(x, y, shade(b.get(x, y), 0.72));
  // Moss low on the plinth.
  for (let k = 0; k < 6; k++) b.set(3 + Math.floor(ih(k, 1, 706) * 10), 42 + Math.floor(ih(k, 2, 707) * 4), MOSS[k % 3]);
  finish(b);
  groundShadow(b, 8.5, 48.5, 7, 1.4, 70);
  return b;
}

// A standing stone. 'crown': tall and frost-rimmed; 'broken': snapped off; 'mossy': the
// deep wood's marker.
function standingStone(variant, seed) {
  const tall = variant === 'crown' ? 36 : variant === 'broken' ? 20 : 28;
  const b = buf(16, tall + 4);
  const L = variant === 'mossy' ? GREYSTONE : PAL.stone;
  shaft(b, 8, 2, tall, variant === 'broken' ? 10 : 7, 11, L, seed, { chip: 0.14 });
  if (variant === 'broken') {
    for (let x = 2; x < 14; x++) {
      const cut = Math.floor(ih(x, seed, 711) * 5);
      for (let y = 0; y < 2 + cut; y++) b.set(x, y, 0);
    }
  }
  // Carved script: short lines in a column.
  for (let y = 8; y < tall - 4; y += 3) {
    const w = 2 + Math.floor(ih(seed, y, 712) * 3);
    const x0 = 6 + Math.floor(ih(seed, y, 713) * 2);
    for (let x = x0; x < x0 + w; x++) if (b.get(x, y) >>> 24) b.set(x, y, shade(b.get(x, y), 0.66));
  }
  if (variant === 'crown' || variant === 'broken') {
    // Snow on the top and drifted at the north foot.
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < tall; y++) {
        if (!(b.get(x, y) >>> 24)) continue;
        if (!(b.get(x, y - 1) >>> 24) || ih(x, y, 714) > 0.93) {
          b.set(x, y, tone(SNOWCAP, 0.75 + (x < 8 ? 0.2 : 0)));
          if (b.get(x, y + 1) >>> 24 && ih(x, y, 715) > 0.4) b.set(x, y + 1, tone(SNOWCAP, 0.5));
          break;
        }
      }
    }
    for (let x = 2; x < 14; x++) b.set(x, tall - 1, tone(SNOWCAP, 0.6 + (ih(x, 7, 716) - 0.5) * 0.2));
  } else {
    for (let k = 0; k < 16; k++) {
      const x = 3 + Math.floor(ih(k, seed, 717) * 10);
      const y = 4 + Math.floor(ih(k, seed, 718) * (tall - 6));
      if (b.get(x, y) >>> 24) b.set(x, y, MOSS[k % 3]);
    }
  }
  finish(b);
  groundShadow(b, 8.5, tall + 1.5, 7, 1.3, 70);
  return b;
}

// Brindlecombe's wardstone: a broad lintel-stone, cracked and cold, a ring of candle stubs.
function wardstone() {
  const b = buf(24, 40);
  shaft(b, 12, 4, 33, 13, 17, GREYSTONE, 721, { chip: 0.12 });
  // The great crack.
  let x = 13;
  for (let y = 6; y < 30; y++) {
    if (ih(y, 1, 722) > 0.6) x += ih(y, 2, 723) > 0.5 ? 1 : -1;
    b.set(x, y, tone(GREYSTONE, 0.05));
    b.set(x + 1, y, tone(GREYSTONE, 0.25));
  }
  // Rings of worn script.
  for (const y of [10, 16, 22]) for (let xx = 6; xx < 19; xx++) if (ih(xx, y, 724) > 0.5 && b.get(xx, y) >>> 24) b.set(xx, y, shade(b.get(xx, y), 0.7));
  // Candle stubs at its foot, burned down, and a grey wool knot.
  for (const cx of [3, 6, 18, 21]) {
    b.set(cx, 35, tone(PAL.bone, 0.7));
    b.set(cx, 36, tone(PAL.bone, 0.5));
  }
  b.set(10, 34, rgb('#8d8f88'));
  b.set(11, 34, rgb('#a4a69e'));
  b.set(11, 35, rgb('#7b7d76'));
  finish(b);
  groundShadow(b, 12.5, 36, 11, 1.8, 70);
  return b;
}

// A small headstone over a grassed mound.
function grave(v) {
  const b = buf(16, 16);
  b.ellipse(8, 13, 6, 2.2, (x, y, nx, ny) => tone(lut(['#26301f', '#33412a', '#435536', '#566b43']), 0.6 - ny * 0.3 - nx * 0.1));
  const tall = v ? 9 : 11;
  for (let y = 13 - tall; y < 13; y++) {
    for (let x = 5; x < 11; x++) {
      if (y === 13 - tall && (x === 5 || x === 10)) continue;
      let t = 0.6 - (x - 5) * 0.06;
      if (x === 5) t += 0.1;
      b.set(x, y, dtone(GREYSTONE, t + (ih(x, y, 731 + v) - 0.5) * 0.1, x, y));
    }
  }
  for (let y = 15 - tall; y < 11; y += 2) for (let x = 6; x < 10; x++) if (ih(x, y, 732) > 0.5) b.set(x, y, tone(GREYSTONE, 0.3));
  finish(b);
  return b;
}

// The melted circle at the heart of the Crown Ring: a ring of carved flagstones half
// under the turf, drawn flat on the ground.
function crownMark() {
  const b = buf(32, 14);
  const S = lut(['#3c4a40', '#4d5e4f', '#627360', '#7d8c78']);
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    const x = 16 + Math.cos(a) * 13;
    const y = 7 + Math.sin(a) * 5.5;
    b.rect(Math.round(x) - 1, Math.round(y), 2, 1, tone(S, 0.55 + Math.sin(a) * 0.2));
    if (k % 3 === 0) b.set(Math.round(x), Math.round(y) - 1, tone(S, 0.3));
  }
  b.set(16, 7, tone(PAL.glass, 0.7));
  return b;
}

// A cold altar: stone, a grey cloth, empty flame-holders bearded with wax.
function coldAltar() {
  const b = buf(48, 28);
  box(b, 2, 10, 44, 17, 5, PAL.stone, { grain: true, seed: 741 });
  for (let y = 10; y < 22; y++) for (let x = 8; x < 40; x++) if (y < 15 || (x > 12 && x < 36)) b.set(x, y, tone(GREYSTONE, y < 15 ? 0.66 - (y - 10) * 0.03 : 0.5));
  for (let k = 0; k < 7; k++) {
    const cx = 11 + k * 4;
    b.set(cx, 8, tone(PAL.iron, 0.45));
    b.set(cx, 9, tone(PAL.iron, 0.35));
    for (let y = 10; y < 12 + (k % 3); y++) b.set(cx, y, tone(PAL.bone, 0.55));
  }
  finish(b);
  groundShadow(b, 24, 27, 22, 1.5, 60);
  return b;
}

function coldCandleRack() {
  const b = buf(16, 28);
  for (const x of [1, 14]) for (let y = 2; y < 28; y++) b.set(x, y, tone(PAL.woodDark, x === 1 ? 0.6 : 0.32));
  for (const y of [3, 13]) {
    for (let x = 1; x < 15; x++) b.set(x, y, tone(PAL.woodDark, 0.55 - (x > 12 ? 0.15 : 0)));
    for (let k = 0; k < 6; k++) {
      if (ih(k, y, 751) < 0.35) continue;
      const cx = 3 + k * 2;
      const len = 1 + Math.floor(ih(k, y, 752) * 3);
      for (let j = 0; j < len; j++) b.set(cx, y + 1 + j, tone(PAL.bone, 0.5 - j * 0.05));
    }
  }
  for (let x = 0; x < 16; x++) b.set(x, 27, tone(PAL.woodDark, 0.3));
  finish(b);
  groundShadow(b, 8, 27, 7, 1, 50);
  return b;
}

// Signs of the bosses (boss_trails.js), drawn flat or low so they read as marks, not props.
function slimeTrail(v) {
  const b = buf(20, 10);
  const G = lut(['#1f3d1f', '#2f6a2a', '#4c9a3a', '#7fd05a', '#c4f59a']);
  for (let k = 0; k < 5; k++) {
    const cx = 3 + k * 3.4 + (ih(k, v, 801) - 0.5) * 2;
    const cy = 5 + (ih(k, v, 802) - 0.5) * 3;
    b.ellipse(cx, cy, 2.6 + ih(k, v, 803) * 1.6, 1.4 + ih(k, v, 804), (x, y, nx, ny) => tone(G, 0.5 - ny * 0.3 - nx * 0.1));
  }
  for (let k = 0; k < 6; k++) b.set(2 + Math.floor(ih(k, v, 805) * 16), 3 + Math.floor(ih(k, v, 806) * 4), tone(G, 1));
  return b;
}

function clawTrunk() {
  const b = buf(16, 30);
  shaft(b, 8, 4, 27, 7, 9, PAL.bark, 811, { chip: 0.1 });
  // A broken top, and four pale gouges slanting down the bark.
  for (let x = 4; x < 13; x++) for (let y = 0; y < 4 + Math.floor(ih(x, 1, 812) * 4); y++) b.set(x, y, 0);
  for (let k = 0; k < 4; k++) for (let j = 0; j < 7; j++) b.set(5 + k + (j >> 2), 10 + j + k, tone(PAL.woodLight, 0.85 - j * 0.04));
  b.set(10, 14, rgb('#a9a6a0'));
  b.set(11, 15, rgb('#8d8a84'));
  finish(b);
  groundShadow(b, 8.5, 28, 6, 1.2, 60);
  return b;
}

function bonePile() {
  const b = buf(18, 10);
  for (let k = 0; k < 6; k++) {
    const x0 = 2 + Math.floor(ih(k, 1, 821) * 12);
    const y0 = 3 + Math.floor(ih(k, 2, 822) * 5);
    const len = 3 + Math.floor(ih(k, 3, 823) * 3);
    const dx = ih(k, 4, 824) > 0.5 ? 1 : 0;
    for (let j = 0; j < len; j++) b.set(x0 + j, y0 - j * dx * 0.5, tone(PAL.bone, 0.8 - j * 0.04));
    b.set(x0 - 1, y0, tone(PAL.bone, 0.95));
    b.set(x0 + len, y0 - len * dx * 0.5, tone(PAL.bone, 0.95));
  }
  b.ellipse(13, 4, 2.4, 2, (x, y, nx, ny) => tone(PAL.bone, 0.8 - ny * 0.3));
  b.set(12, 4, tone(PAL.bone, 0.2));
  b.set(14, 4, tone(PAL.bone, 0.2));
  finish(b);
  return b;
}

function humRipples(f) {
  const b = buf(32, 14);
  for (let r = 0; r < 3; r++) {
    const rr = ((f / 4 + r / 3) % 1) * 13 + 2;
    const a = 1 - rr / 15;
    for (let k = 0; k < 40; k++) {
      const ang = (k / 40) * Math.PI * 2;
      b.blend(Math.round(16 + Math.cos(ang) * rr), Math.round(7 + Math.sin(ang) * rr * 0.45), rgb('#d9f0ff'), 0.55 * a);
    }
  }
  return b;
}

export function registerWilds(add) {
  add('prop:trail_slime', [slimeTrail(0), slimeTrail(1)], { ox: 10, oy: 8 });
  add('prop:trail_claws', [clawTrunk()], { ox: 8, oy: 28 });
  add('prop:trail_bones', [bonePile()], { ox: 9, oy: 8 });
  add('prop:trail_hum', [0, 1, 2, 3].map((f) => humRipples(f)), { ox: 16, oy: 10, fps: 3 });
  add('prop:waystone:dead', [waystone('dead', 0)], { ox: 8, oy: 47 });
  add('prop:waystone', [waystone('dead', 0)], { ox: 8, oy: 47 });
  add('prop:waystone:lit', [0, 1, 2].map((f) => waystone('lit', f)), { ox: 8, oy: 47, fps: 6 });
  add('prop:waystone:burning', [0, 1, 2].map((f) => waystone('burning', f)), { ox: 8, oy: 47, fps: 7 });
  add('prop:standing_stone', [standingStone('crown', 761)], { ox: 8, oy: 37 });
  add('prop:standing_stone:crown', [standingStone('crown', 762)], { ox: 8, oy: 37 });
  add('prop:standing_stone:broken', [standingStone('broken', 763)], { ox: 8, oy: 21 });
  add('prop:standing_stone:mossy', [standingStone('mossy', 764)], { ox: 8, oy: 29 });
  add('prop:wardstone', [wardstone()], { ox: 12, oy: 36 });
  add('prop:wardstone:dead', [wardstone()], { ox: 12, oy: 36 });
  add('prop:grave', [grave(0), grave(1)], { ox: 8, oy: 14 });
  add('prop:crown_mark', [crownMark()], { ox: 16, oy: 10 });
  add('prop:altar:cold', [coldAltar()], { ox: 24, oy: 27 });
  add('prop:candle_rack:cold', [coldCandleRack()], { ox: 8, oy: 27 });
}
