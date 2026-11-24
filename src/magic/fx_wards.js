import { TAU, hash, flicker } from './fx_util.js';
import { disc, ell, ring, line, halo, zig, poly, px, rect, glyphSprite } from './fx_draw.js';

// How a bind and a ward look (DESIGN §22.5). Both read their essence's look the way walls
// do (L.look.wall: flame water ice storm stone wind thorns poison light shadow iron song
// arcane), so a new essence borrows one and shows right at once.
//
//   bind   a ring that closes on the target's feet and holds there: its back half on the
//          ground pass (under the actor), its front half and its essence's grip (flames,
//          ice teeth, vines, chains, notes…) over the actor, bands of light on the shins.
//   ward   a dome over its bearer: the back rim on the ground pass, the shell over the
//          actor — tinted, rimmed, with its essence's surface (flame tongues, ripples,
//          facets, crackle, stone plates, gusts, thorns, a wobbling membrane, rays, smoke,
//          riveted plates, rings of song, runes). It flares where it is struck and thins
//          as its strength runs out. The orbit twist draws three small shields instead.
//   ring   a bind's missile: a spinning ring of light.
//
// R = { ctx, g, ox, oy, time, lod, bounds } as in fx_bodies.js.

const PTS = new Float32Array(48);
const DARK = '#120a1e';
const k01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// How much of a bind's hold is left (0..1 over its last 0.35 s), from the target's status.
function holdFade(b) {
  const l = b.target?.magicStatus;
  if (!l) return k01((b.life - b.age) / 0.35);
  for (let i = 0; i < l.length; i++) if (l[i].id === 'bound') return k01(l[i].t / 0.35);
  return k01((b.life - b.age) / 0.35);
}

// ================================================================== bind

export function drawBindGround(R, b, L) {
  const P = L.pal;
  const c = R.ctx;
  const x = b.x - R.ox;
  const y = b.y - R.oy;
  const t = R.time;
  const a = k01(b.age / 0.08) * holdFade(b);
  if (a <= 0.02) return;
  const rx = Math.max(3, b.cur || b.r);
  const sq = 0.42;
  c.globalAlpha = 0.28 * a;
  ell(c, x, y, rx + 1.5, (rx + 1.5) * sq, L.look.dark ? DARK : P.deep);
  // The back half of the ring, behind the legs.
  c.globalAlpha = 0.85 * a;
  ring(c, x, y, rx, P.deep, 2, sq, Math.PI, TAU);
  ring(c, x, y, rx, P.glow, 1, sq, Math.PI, TAU);
  // Runes turning inside it.
  const spin = t * 1.6 + b.seed * 6;
  const n = R.lod ? 3 : 6;
  for (let i = 0; i < n; i++) {
    const an = spin + (i / n) * TAU;
    const rr = rx * 0.68;
    px(c, x + Math.cos(an) * rr, y + Math.sin(an) * rr * sq, i & 1 ? P.spark : P.core);
  }
  const g = R.g;
  if (g) {
    g.globalAlpha = 0.5 * a;
    ring(g, x, y, rx, P.glow, 1, sq, Math.PI, TAU);
    g.globalAlpha = 1;
    halo(g, x, y - 2, rx * 1.6, L.halo, 0.3 * a, R.bounds);
  }
  c.globalAlpha = 1;
}

export function drawBind(R, b, L) {
  const P = L.pal;
  const c = R.ctx;
  const g = R.g;
  const x = b.x - R.ox;
  const y = b.y - R.oy;
  const t = R.time;
  const fade = holdFade(b);
  const a = k01(b.age / 0.08) * fade;
  if (a <= 0.02) return;
  const rx = Math.max(3, b.cur || b.r);
  const sq = 0.42;
  const closing = b.age < 0.22;
  const ry = rx * sq;
  // The front half of the ring, over the feet.
  c.globalAlpha = a;
  ring(c, x, y, rx, P.deep, 2, sq, 0, Math.PI);
  ring(c, x, y, rx, closing ? '#ffffff' : P.glow, 1, sq, 0, Math.PI);
  if (!closing) ring(c, x, y + 0.5, rx - 1, P.core, 1, sq, 0.6, Math.PI - 0.6);
  // Bands of light wrapping the shins: what "held" looks like, whatever the essence.
  const legs = Math.max(3, Math.min(6, (b.target?.radius ?? 5) * 0.8));
  const pulse = 0.65 + 0.35 * Math.sin(t * 6 + b.seed * 9);
  for (let k = 0; k < 2; k++) {
    const by = y - 3 - k * 3;
    c.globalAlpha = a * (k ? 0.55 : 0.8) * pulse;
    ring(c, x, by, legs, k ? P.spark : P.core, 1, 0.45, 0.2, Math.PI - 0.2);
  }
  c.globalAlpha = a;
  const style = L.look.wall;
  switch (style) {
    case 'flame': {
      // Flames licking up off the ring.
      const n = R.lod ? 5 : 8;
      for (let i = 0; i < n; i++) {
        const an = (i / n) * TAU + t * 0.8;
        const fx = Math.round(x + Math.cos(an) * rx);
        const fy = Math.round(y + Math.sin(an) * ry);
        const h = Math.round((2 + 4 * flicker(t, i * 7.3 + b.seed * 13)) * a);
        if (h < 1) continue;
        rect(c, fx, fy - h, 1, h, P.deep);
        rect(c, fx, fy - h, 1, Math.max(1, h - 1), P.glow);
        px(c, fx, fy - h, P.spark);
        if (g && i % 2 === 0) px(g, fx, fy - h, P.core);
      }
      break;
    }
    case 'water': {
      // A ripple running round, and drops riding the ring.
      const k = (t * 1.4 + b.seed) % 1;
      c.globalAlpha = a * (1 - k) * 0.8;
      ring(c, x, y, rx + k * 4, P.spark, 1, sq);
      c.globalAlpha = a;
      for (let i = 0; i < 3; i++) {
        const an = t * 2.2 + (i / 3) * TAU;
        disc(c, x + Math.cos(an) * rx, y + Math.sin(an) * ry - 1, 1, i ? P.glow : P.core);
      }
      break;
    }
    case 'ice': {
      // Teeth of ice standing on the ring: the hold is frozen in place.
      const n = R.lod ? 4 : 7;
      for (let i = 0; i < n; i++) {
        const an = (i / n) * TAU + b.seed * 3;
        const s = Math.sin(an);
        const fx = x + Math.cos(an) * rx;
        const fy = y + s * ry;
        const h = (3 + hash(b.uid, i) * 4) * k01(b.age / 0.2);
        PTS[0] = fx - 1.5;
        PTS[1] = fy;
        PTS[2] = fx;
        PTS[3] = fy - h;
        PTS[4] = fx + 1.5;
        PTS[5] = fy;
        c.globalAlpha = a * (s < 0 ? 0.6 : 0.95);
        poly(c, PTS, 3, P.glow);
        line(c, fx, fy - 0.5, fx, fy - h + 1, P.core, 1);
        if (g && (i + Math.floor(t * 3)) % 4 === 0) px(g, fx, fy - h, '#ffffff');
      }
      break;
    }
    case 'storm': {
      // Shackle-sparks jumping from the ring to the legs.
      const seed = b.uid * 7 + Math.floor(t * 20);
      for (let i = 0; i < (R.lod ? 1 : 3); i++) {
        const an = hash(seed, i) * TAU;
        const fx = x + Math.cos(an) * rx;
        const fy = y + Math.sin(an) * ry;
        zig(c, fx, fy, x + (hash(seed, i, 2) - 0.5) * 4, y - 4 - hash(seed, i, 3) * 6, 3, 1.5, seed + i, i ? P.glow : P.core, 1);
        if (g) zig(g, fx, fy, x, y - 6, 3, 1.5, seed + i, P.spark, 1);
      }
      break;
    }
    case 'stone': {
      // Stone cuffs set round the ring.
      const n = 6;
      for (let i = 0; i < n; i++) {
        const an = (i / n) * TAU + b.seed * 5;
        const s = Math.sin(an);
        if (s < -0.2) continue;
        const fx = Math.round(x + Math.cos(an) * rx) - 1;
        const fy = Math.round(y + s * ry) - 2;
        rect(c, fx - 1, fy - 1, 4, 4, L.outline);
        rect(c, fx, fy, 2, 2, P.glow);
        px(c, fx, fy, P.core);
      }
      break;
    }
    case 'wind': {
      // A small whirl holding them where they stand.
      for (let k = 0; k < 3; k++) {
        const hy = y - 2 - k * 4;
        const rr = rx * (0.9 - k * 0.18);
        const a0 = t * (5 + k * 1.5) + k * 2;
        c.globalAlpha = a * (0.75 - k * 0.15);
        ring(c, x, hy, rr, k ? P.spark : P.core, 1, 0.38, a0, a0 + 2.2);
      }
      break;
    }
    case 'thorns': {
      // Vines climbing the legs, thorns on them, a leaf or two.
      const grow = k01(b.age / 0.5);
      for (let i = 0; i < 3; i++) {
        const an = (i / 3) * TAU + 0.6;
        const sx = x + Math.cos(an) * rx * 0.9;
        const sy = y + Math.sin(an) * ry;
        const top = 4 + 6 * grow;
        let px0 = sx;
        let py0 = sy;
        for (let s = 1; s <= 4; s++) {
          const q = s / 4;
          const nx = sx + (x - sx) * q * 0.8 + Math.sin(q * 6 + i * 2 + t * 1.5) * 1.4;
          const ny = sy - top * q;
          line(c, px0, py0, nx, ny, s & 1 ? P.deep : '#2f5a2a', 1);
          if (s === 2) px(c, nx + 1, ny, P.core);
          px0 = nx;
          py0 = ny;
        }
        px(c, px0, py0 - 1, i === 1 ? L.accent : P.glow);
      }
      break;
    }
    case 'poison': {
      // An ooze ring, bubbling.
      c.globalAlpha = a * 0.8;
      ring(c, x, y + 0.5, rx, P.deep, 2, sq, 0, Math.PI);
      c.globalAlpha = a;
      for (let i = 0; i < 3; i++) {
        const k = (t * 1.3 + i / 3 + b.seed) % 1;
        const an = hash(b.uid, i, Math.floor(t * 1.3 + i / 3 + b.seed)) * Math.PI;
        c.globalAlpha = a * (1 - k);
        ring(c, x + Math.cos(an) * rx, y + Math.sin(an) * ry - k * 5, 1 + k, P.spark, 1, 1);
      }
      break;
    }
    case 'light': {
      // Four pillars of light rising from the ring.
      for (let i = 0; i < 4; i++) {
        const an = (i / 4) * TAU + t * 0.6 + b.seed * 4;
        const fx = x + Math.cos(an) * rx;
        const fy = y + Math.sin(an) * ry;
        const h = 8 + 4 * Math.sin(t * 5 + i * 1.7);
        c.globalAlpha = a * 0.55;
        rect(c, fx, fy - h, 1, h, P.spark);
        if (g) {
          g.globalAlpha = a * 0.6;
          rect(g, fx, fy - h, 1, h, P.core);
          g.globalAlpha = 1;
        }
      }
      break;
    }
    case 'shadow': {
      // Shadow fingers closing round the ankles.
      for (let i = 0; i < 4; i++) {
        const an = (i / 4) * TAU + b.seed * 6 + Math.sin(t * 2 + i) * 0.3;
        const fx = x + Math.cos(an) * rx;
        const fy = y + Math.sin(an) * ry;
        const tx = x + Math.cos(an) * rx * 0.35;
        const ty = y - 4 - 2 * Math.sin(t * 3 + i);
        c.globalAlpha = a * 0.9;
        line(c, fx, fy, (fx + tx) / 2, (fy + ty) / 2 - 2, DARK, 2);
        line(c, (fx + tx) / 2, (fy + ty) / 2 - 2, tx, ty, P.deep, 1);
        px(c, tx, ty, P.glow);
      }
      break;
    }
    case 'iron': {
      // Chain links all the way round the front, a glint running along them.
      const n = 9;
      const glint = Math.floor((t * 6) % n);
      for (let i = 0; i <= n; i++) {
        const an = (i / n) * Math.PI;
        const fx = Math.round(x + Math.cos(an) * rx);
        const fy = Math.round(y + Math.sin(an) * ry);
        rect(c, fx - (i & 1 ? 1 : 0), fy - 1, i & 1 ? 2 : 1, i & 1 ? 1 : 2, i === glint ? '#ffffff' : i & 1 ? P.glow : P.deep);
      }
      break;
    }
    case 'song': {
      // A hush: two thin staff lines round the ring, and notes turning.
      c.globalAlpha = a * 0.6;
      ring(c, x, y - 1, rx + 2, P.glow, 1, sq, 0, Math.PI);
      ring(c, x, y + 1, rx + 2, P.glow, 1, sq, 0, Math.PI);
      c.globalAlpha = a;
      for (let i = 0; i < 3; i++) {
        const an = t * 1.8 + (i / 3) * TAU;
        const nx = Math.round(x + Math.cos(an) * (rx + 3));
        const ny = Math.round(y - 5 + Math.sin(an) * (ry + 2) - Math.sin(t * 4 + i) * 1.5);
        rect(c, nx, ny - 2, 1, 3, P.core);
        rect(c, nx - 1, ny + 1, 2, 1, P.core);
        px(c, nx + 1, ny - 2, P.spark);
      }
      break;
    }
    default: {
      // The Stillring itself, the way Lyra draws it: violet ticks turning round the feet.
      const spin = t * 2.4 + b.seed * 6;
      for (let i = 0; i < 6; i++) {
        const an = spin + (i / 6) * TAU;
        if (Math.sin(an) < 0) continue;
        px(c, x + Math.cos(an) * rx, y + Math.sin(an) * ry - 1, i & 1 ? '#ffffff' : P.spark);
      }
    }
  }
  if (closing) {
    // The ring closing: four lock-ticks drawn in to it, a bright edge.
    const k = b.age / 0.22;
    for (let i = 0; i < 4; i++) {
      const an = (i / 4) * TAU + Math.PI / 4;
      const r0 = rx + 6 * (1 - k);
      c.globalAlpha = a * (1 - k * 0.5);
      line(c, x + Math.cos(an) * r0, y + Math.sin(an) * r0 * sq, x + Math.cos(an) * (r0 + 3), y + Math.sin(an) * (r0 + 3) * sq, '#ffffff', 1);
    }
  }
  c.globalAlpha = 1;
  if (g) {
    g.globalAlpha = a * (closing ? 0.95 : 0.55);
    ring(g, x, y, rx, closing ? '#ffffff' : P.glow, 1, sq, 0, Math.PI);
    g.globalAlpha = 1;
    halo(g, x, y - 4, rx * (closing ? 2.4 : 1.7), L.halo, (closing ? 0.6 : 0.32) * a, R.bounds);
  }
}

// ================================================================== the bind's missile

export function drawRingMissile(R, b, L) {
  const P = L.pal;
  const c = R.ctx;
  const g = R.g;
  const x = b.x - R.ox;
  const y = b.y - R.oy - (b.z || 0);
  const r = Math.max(3, b.r || 4) + 0.5;
  const spin = b.age * 16 + b.seed * 9;
  const sq = 0.3 + 0.7 * Math.abs(Math.sin(spin * 0.5));
  // A few fading copies along its path.
  const tr = b.trail;
  for (let i = 1; i <= Math.min(3, b.trailN); i++) {
    const j = (b.trailI - i + 8) % 8;
    c.globalAlpha = 0.4 - i * 0.1;
    ring(c, tr[j * 2] - R.ox, tr[j * 2 + 1] - R.oy - (b.z || 0), r - i * 0.6, i === 1 ? P.glow : P.deep, 1, sq);
  }
  c.globalAlpha = 1;
  ring(c, x, y, r, P.deep, 2, sq);
  ring(c, x, y, r, P.glow, 1, sq);
  for (let i = 0; i < 4; i++) {
    const an = spin + (i / 4) * TAU;
    px(c, x + Math.cos(an) * r, y + Math.sin(an) * r * sq, i & 1 ? L.accent : P.core);
  }
  px(c, x, y, P.core);
  if (g) {
    ring(g, x, y, r, P.spark, 1, sq);
    halo(g, x, y, r * 3.4, L.halo, 0.6, R.bounds);
  }
}

// ================================================================== ward

const WARD_H = 9; // the dome's center sits at the chest

function wardFade(b) {
  return k01(b.age / 0.18) * k01((b.life - b.age) / 0.4);
}

// 0..1: how fresh the last blow on it is.
function struck(b) {
  const fs = b.fxState;
  if (!fs || !(fs.hitAge >= 0)) return 0;
  return k01(1 - (b.age - fs.hitAge) / 0.28);
}

// The ward's strength left (0..1), and a flicker when it is nearly spent.
function strength(b, t) {
  const s = b.shieldMax > 0 ? k01(b.shield / b.shieldMax) : 1;
  const low = s < 0.3 ? 0.55 + 0.45 * (Math.sin(t * 22 + b.seed * 9) > 0 ? 1 : 0.4) : 1;
  return { s, a: (0.55 + 0.45 * s) * low };
}

export function drawWardGround(R, b, L, share = 0) {
  const P = L.pal;
  const c = R.ctx;
  const x = b.x - R.ox;
  const y = b.y - R.oy;
  const f = wardFade(b);
  if (f <= 0.02) return;
  const { a } = strength(b, R.time);
  const rx = Math.max(4, b.cur || b.r);
  const ry = rx * 1.08;
  const cy = y - WARD_H;
  c.globalAlpha = 0.2 * f;
  ell(c, x, y, rx, rx * 0.42, L.look.dark ? DARK : P.deep);
  c.globalAlpha = 0.55 * f * a;
  ring(c, x, y, rx, P.glow, 1, 0.42);
  // The far side of the dome, behind the bearer.
  if (!b.plan.wardOrbit) {
    c.globalAlpha = 0.4 * f * a;
    ring(c, x, cy, rx, P.glow, 1, ry / rx, Math.PI * 1.05, Math.PI * 1.95);
  }
  if (share > 0) {
    // A song ward's reach: friends inside this ring share it.
    c.globalAlpha = (0.18 + 0.08 * Math.sin(R.time * 3)) * f;
    ring(c, x, y, share, P.spark, 1, 0.42, R.time * 0.5, R.time * 0.5 + TAU * 0.92);
  }
  c.globalAlpha = 1;
}

export function drawWard(R, b, L) {
  const P = L.pal;
  const c = R.ctx;
  const g = R.g;
  const t = R.time;
  const x = b.x - R.ox;
  const y = b.y - R.oy;
  const f = wardFade(b);
  if (f <= 0.02) return;
  const { s, a: sa } = strength(b, t);
  const hk = struck(b);
  const a = f * sa;
  const rx = Math.max(4, b.cur || b.r);
  const ry = rx * 1.08;
  const sq = ry / rx;
  const cy = y - WARD_H;
  const style = L.look.wall;
  if (b.plan.wardOrbit) {
    drawPlates(R, b, L, x, y, a, hk);
    return;
  }
  // The shell: a faint tint over the bearer, brighter where and when it is struck.
  c.globalAlpha = (0.1 + 0.12 * hk) * a;
  ell(c, x, cy, rx, ry, L.look.dark ? P.deep : P.glow);
  c.globalAlpha = (0.08 + 0.06 * s) * a;
  ell(c, x - rx * 0.12, cy - ry * 0.15, rx * 0.72, ry * 0.68, P.spark);
  // The near rim (with a dark lip under it, so it reads on grass and snow), then a
  // thinner whole outline.
  c.globalAlpha = 0.35 * a;
  ring(c, x, cy + 1, rx, L.outline, 1, sq, 0.3, Math.PI - 0.3);
  c.globalAlpha = (0.7 + 0.3 * hk) * a;
  ring(c, x, cy, rx, hk > 0.5 ? '#ffffff' : P.core, 1, sq, 0.05, Math.PI - 0.05);
  c.globalAlpha = 0.45 * a;
  ring(c, x, cy, rx, P.glow, 1, sq);
  // A glint on the upper left, like light on glass.
  c.globalAlpha = 0.9 * a;
  ring(c, x, cy, rx - 2, P.core, 1, sq, 3.7, 4.35);
  px(c, x - rx * 0.5, cy - ry * 0.55, '#ffffff');
  c.globalAlpha = a;
  surface(R, b, L, style, x, cy, rx, ry, a, t);
  // Where it was struck: a ripple.
  const fs = b.fxState;
  if (hk > 0 && fs) {
    const hx = fs.hx - R.ox;
    const hy = fs.hy - R.oy;
    const rr = 1.5 + (1 - hk) * 7;
    c.globalAlpha = hk * a;
    ring(c, hx, hy, rr, '#ffffff', 1, 0.8);
    ring(c, hx, hy, rr + 2, P.spark, 1, 0.8);
    if (g) {
      g.globalAlpha = hk;
      ring(g, hx, hy, rr, P.core, 1, 0.8);
      g.globalAlpha = 1;
      halo(g, hx, hy, 10 + rr, L.halo, 0.6 * hk, R.bounds);
    }
  }
  c.globalAlpha = 1;
  if (g) {
    g.globalAlpha = (0.35 + 0.4 * hk) * a;
    ring(g, x, cy, rx, P.glow, 1, sq, 0.05, Math.PI - 0.05);
    g.globalAlpha = 1;
    halo(g, x, cy, rx * 1.9, L.halo, (0.12 + 0.3 * hk) * a, R.bounds);
  }
}

// Each essence's skin on the dome.
function surface(R, b, L, style, x, cy, rx, ry, a, t) {
  const P = L.pal;
  const c = R.ctx;
  const g = R.g;
  const sq = ry / rx;
  switch (style) {
    case 'flame': {
      // Flame tongues rising off the upper rim.
      const n = R.lod ? 6 : 10;
      for (let i = 0; i < n; i++) {
        const an = Math.PI + (i + 0.5) * (Math.PI / n);
        const fx = Math.round(x + Math.cos(an) * rx);
        const fy = Math.round(cy + Math.sin(an) * ry);
        const h = Math.round(1 + 3 * flicker(t, i * 5.1 + b.seed * 11));
        rect(c, fx, fy - h, 1, h + 1, P.glow);
        px(c, fx, fy - h, P.spark);
        if (g && i % 3 === 0) px(g, fx, fy - h, P.core);
      }
      break;
    }
    case 'water': {
      // A shimmering skin: the rim wobbles, light runs round it.
      const w = Math.sin(t * 5 + b.seed * 7) * 1;
      c.globalAlpha = 0.5 * a;
      ring(c, x, cy, rx + w, P.spark, 1, sq * (1 - w * 0.03));
      c.globalAlpha = a;
      for (let i = 0; i < 4; i++) {
        const an = t * 1.7 + (i / 4) * TAU;
        px(c, x + Math.cos(an) * (rx - 1), cy + Math.sin(an) * (ry - 1), i & 1 ? P.core : P.spark);
      }
      break;
    }
    case 'ice': {
      // Facets: an eight-sided shell, a sparkle on its corners.
      const n = 8;
      const rot = b.seed * 2;
      for (let i = 0; i < n; i++) {
        const an = rot + (i / n) * TAU;
        PTS[i * 2] = x + Math.cos(an) * rx;
        PTS[i * 2 + 1] = cy + Math.sin(an) * ry;
      }
      c.globalAlpha = 0.75 * a;
      c.strokeStyle = P.core;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(PTS[0], PTS[1]);
      for (let i = 1; i <= n; i++) c.lineTo(PTS[(i % n) * 2], PTS[(i % n) * 2 + 1]);
      c.stroke();
      c.globalAlpha = a;
      for (let i = 0; i < n; i++) if ((i + Math.floor(t * 4)) % 3 === 0) px(c, PTS[i * 2], PTS[i * 2 + 1], '#ffffff');
      if (g) for (let i = 0; i < n; i += 2) px(g, PTS[i * 2], PTS[i * 2 + 1], P.spark);
      break;
    }
    case 'storm': {
      // Crackle crawling over the shell.
      const seed = b.uid * 13 + Math.floor(t * 22);
      for (let i = 0; i < (R.lod ? 1 : 3); i++) {
        const a0 = hash(seed, i) * TAU;
        const a1 = a0 + 0.6 + hash(seed, i, 4) * 0.9;
        const x0 = x + Math.cos(a0) * rx;
        const y0 = cy + Math.sin(a0) * ry;
        const x1 = x + Math.cos(a1) * rx;
        const y1 = cy + Math.sin(a1) * ry;
        zig(c, x0, y0, x1, y1, 4, 1.6, seed + i, i ? P.glow : P.core, 1);
        if (g) zig(g, x0, y0, x1, y1, 4, 1.6, seed + i, P.spark, 1);
      }
      break;
    }
    case 'stone': {
      // A carapace of stone plates, turning slowly round the bearer.
      const n = 5;
      for (let i = 0; i < n; i++) {
        const an = t * 0.7 + (i / n) * TAU + b.seed * 4;
        const s = Math.sin(an);
        const fx = Math.round(x + Math.cos(an) * rx * 0.95) - 1;
        const fy = Math.round(cy + 2 + s * ry * 0.45) - 2;
        c.globalAlpha = a * (s < 0 ? 0.55 : 1);
        rect(c, fx - 1, fy - 1, 4, 5, L.outline);
        rect(c, fx, fy, 2, 3, P.glow);
        px(c, fx, fy, P.core);
      }
      c.globalAlpha = a;
      break;
    }
    case 'wind': {
      // Gusts wrapping the dome.
      for (let k = 0; k < 3; k++) {
        const a0 = t * (4 + k * 1.3) + k * 2.1;
        c.globalAlpha = a * (0.8 - k * 0.15);
        ring(c, x, cy + (k - 1) * 3, rx * (1.05 - k * 0.12), k ? P.spark : P.core, 1, sq * (0.55 + k * 0.1), a0, a0 + 1.6);
      }
      c.globalAlpha = a;
      break;
    }
    case 'thorns': {
      // Thorns along the shell, pointing out; a leaf here and there.
      const n = R.lod ? 8 : 14;
      for (let i = 0; i < n; i++) {
        const an = (i / n) * TAU + b.seed;
        const ux = Math.cos(an);
        const uy = Math.sin(an);
        const fx = x + ux * rx;
        const fy = cy + uy * ry;
        line(c, fx, fy, fx + ux * 2.5, fy + uy * 2.5 * sq, i % 4 === 0 ? P.glow : P.deep, 1);
        if (i % 5 === 2) px(c, fx - uy, fy + ux, L.accent);
      }
      break;
    }
    case 'poison': {
      // A membrane that wobbles, bubbles rising inside it.
      const n = 16;
      for (let i = 0; i < n; i++) {
        const an = (i / n) * TAU;
        const w = 1 + 0.08 * Math.sin(an * 3 + t * 4 + b.seed * 5);
        PTS[i * 2] = x + Math.cos(an) * rx * w;
        PTS[i * 2 + 1] = cy + Math.sin(an) * ry * w;
      }
      c.globalAlpha = 0.7 * a;
      c.strokeStyle = P.glow;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(PTS[0], PTS[1]);
      for (let i = 1; i <= n; i++) c.lineTo(PTS[(i % n) * 2], PTS[(i % n) * 2 + 1]);
      c.stroke();
      c.globalAlpha = a;
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.9 + i / 3 + b.seed) % 1;
        ring(c, x + (hash(b.uid, i, Math.floor(t * 0.9 + i / 3 + b.seed)) - 0.5) * rx, cy + ry * 0.6 - k * ry * 1.3, 1, P.spark, 1, 1);
      }
      break;
    }
    case 'light': {
      // A radiant rim, rays turning round it.
      c.globalAlpha = a;
      ring(c, x, cy, rx, P.core, 1, sq);
      const n = R.lod ? 6 : 10;
      for (let i = 0; i < n; i++) {
        const an = t * 0.8 + (i / n) * TAU;
        const ux = Math.cos(an);
        const uy = Math.sin(an);
        const l = 2 + 2 * Math.sin(t * 6 + i);
        line(c, x + ux * (rx + 1), cy + uy * (ry + 1), x + ux * (rx + 1 + l), cy + uy * (ry + 1 + l), i & 1 ? P.spark : P.core, 1);
      }
      if (g) halo(g, x, cy - ry * 0.4, rx * 1.6, L.halo, 0.1 * a, R.bounds);
      break;
    }
    case 'shadow': {
      // Smoke for a rim, a cold glow on its inner edge.
      const n = R.lod ? 8 : 14;
      for (let i = 0; i < n; i++) {
        const an = (i / n) * TAU + Math.sin(t * 1.5 + i) * 0.15;
        const rr = 1.5 + hash(b.uid, i) * 1.5 + Math.sin(t * 3 + i * 2) * 0.5;
        c.globalAlpha = a * 0.8;
        disc(c, x + Math.cos(an) * rx, cy + Math.sin(an) * ry, rr, DARK);
      }
      c.globalAlpha = a * 0.8;
      ring(c, x, cy, rx - 2, P.glow, 1, sq);
      break;
    }
    case 'iron': {
      // Riveted plates: an eight-sided shell, a glint running round it.
      const n = 8;
      for (let i = 0; i < n; i++) {
        const an = (i / n) * TAU + Math.PI / 8;
        PTS[i * 2] = x + Math.cos(an) * rx;
        PTS[i * 2 + 1] = cy + Math.sin(an) * ry;
      }
      c.globalAlpha = 0.85 * a;
      c.strokeStyle = P.deep;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(PTS[0], PTS[1]);
      for (let i = 1; i <= n; i++) c.lineTo(PTS[(i % n) * 2], PTS[(i % n) * 2 + 1]);
      c.stroke();
      c.strokeStyle = P.glow;
      c.lineWidth = 1;
      c.stroke();
      c.globalAlpha = a;
      const gl = Math.floor(t * 5) % n;
      for (let i = 0; i < n; i++) px(c, PTS[i * 2], PTS[i * 2 + 1], i === gl ? '#ffffff' : P.spark);
      break;
    }
    case 'song': {
      // Rings of song rising from the bearer, and notes turning round them.
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.7 + i / 3) % 1;
        c.globalAlpha = a * (1 - k) * 0.8;
        ring(c, x, cy, rx * (0.35 + 0.65 * k), P.spark, 1, sq);
      }
      c.globalAlpha = a;
      for (let i = 0; i < 2; i++) {
        const an = t * 1.3 + i * Math.PI;
        const nx = Math.round(x + Math.cos(an) * (rx + 2));
        const ny = Math.round(cy + Math.sin(an) * (ry * 0.5));
        rect(c, nx, ny - 2, 1, 3, P.core);
        rect(c, nx - 1, ny + 1, 2, 1, P.core);
      }
      break;
    }
    default: {
      // Lanternwright marks turning round the shell.
      const n = 8;
      const spin = t * 1.2 + b.seed * 6;
      for (let i = 0; i < n; i++) {
        const an = spin + (i / n) * TAU;
        const fx = x + Math.cos(an) * rx;
        const fy = cy + Math.sin(an) * ry * 0.35;
        px(c, fx, fy, i & 1 ? P.spark : P.core);
        if (i % 4 === 0) px(c, fx, fy - 1, P.core);
      }
      if (!R.lod) c.drawImage(glyphSprite(L.look.glyph, P.spark), Math.round(x) - 3, Math.round(cy - ry) - 8);
    }
  }
  c.globalAlpha = a;
}

// The orbit twist: three small shields circling the bearer, under a faint dome (the
// ward still takes blows whole; the shields catch missiles and bump foes).
function drawPlates(R, b, L, x, y, a, hk) {
  const P = L.pal;
  const c = R.ctx;
  const g = R.g;
  const r = Math.max(4, b.cur || b.r) * 1.35;
  const rx = Math.max(4, b.cur || b.r);
  c.globalAlpha = 0.25 * a;
  ring(c, x, y - WARD_H, rx, P.glow, 1, 1.08);
  c.globalAlpha = 0.35 * a;
  ring(c, x, y - 6, r, P.glow, 1, 0.8);
  for (let i = 0; i < 3; i++) {
    const an = b.plateA + (i / 3) * TAU;
    const sx = Math.round(x + Math.cos(an) * r);
    const sy = Math.round(y - 6 + Math.sin(an) * r * 0.8);
    c.globalAlpha = a;
    // A small heater shield: outline, face, a bright left edge, a boss in the middle.
    PTS[0] = sx - 4;
    PTS[1] = sy - 5;
    PTS[2] = sx + 4;
    PTS[3] = sy - 5;
    PTS[4] = sx + 4;
    PTS[5] = sy;
    PTS[6] = sx;
    PTS[7] = sy + 6;
    PTS[8] = sx - 4;
    PTS[9] = sy;
    poly(c, PTS, 5, L.outline);
    PTS[0] = sx - 3;
    PTS[1] = sy - 4;
    PTS[2] = sx + 3;
    PTS[3] = sy - 4;
    PTS[4] = sx + 3;
    PTS[5] = sy;
    PTS[6] = sx;
    PTS[7] = sy + 4;
    PTS[8] = sx - 3;
    PTS[9] = sy;
    poly(c, PTS, 5, hk > 0.5 ? '#ffffff' : P.glow);
    rect(c, sx - 3, sy - 4, 1, 4, P.core);
    rect(c, sx - 3, sy - 4, 6, 1, P.spark);
    px(c, sx, sy - 1, P.deep);
    if (g) {
      px(g, sx - 3, sy - 3, P.core);
      halo(g, sx, sy, 6, L.halo, 0.25 * a, R.bounds);
    }
  }
  c.globalAlpha = 1;
}
