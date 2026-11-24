// Creature sprites (32x32 frames, feet at row 28), painted per direction with the
// same Sprite painter as the humanoids. Side views are painted in local
// coordinates (forward positive) and mapped to the screen, so left and right are
// exact mirrors with lighting still from the upper left.

import { Sprite, glow, lighten, darken, mixHex, tri } from './characters_paint.js';
import { RAMPS } from './palette.js';

const CX = 16;
const GROUND = 28;

// Anim tables per creature sprite key. Missing anims fall back to idle at draw time.
const A = (frames, fps, loop = true) => ({ frames, fps, loop });
export const CREATURE_ANIMS = {
  slime: { idle: A(4, 5), walk: A(4, 7), attack: A(3, 6, false), hurt: A(2, 8, false), down: A(1, 1, false) },
  wolf: { idle: A(2, 2), walk: A(6, 11), attack: A(3, 7, false), hurt: A(1, 1, false), down: A(1, 1, false), sit: A(1, 1) },
  boar: { idle: A(2, 2), walk: A(4, 9), attack: A(3, 6, false), hurt: A(1, 1, false), down: A(1, 1, false) },
  deer: { idle: A(3, 2), walk: A(4, 8), hurt: A(1, 1, false), down: A(1, 1, false) },
  rabbit: { idle: A(2, 2), walk: A(3, 9), hurt: A(1, 1, false), down: A(1, 1, false) },
  chicken: { idle: A(4, 4), walk: A(4, 8), hurt: A(1, 1, false), down: A(1, 1, false) },
  cat: { idle: A(2, 1.5), walk: A(4, 8), sit: A(2, 1), sleep: A(2, 0.8), hurt: A(1, 1, false), down: A(1, 1, false) },
  bat: { idle: A(4, 10), walk: A(4, 12), attack: A(3, 8, false), hurt: A(1, 1, false), down: A(1, 1, false) },
};

export const SLIME_VARIANTS = {
  slime: tri(RAMPS.slime, 1),
  slime_blue: ['#25558a', '#4b9ac9', '#8ccbe6'],
  slime_rose: ['#7a2c4a', '#c0577e', '#f09ab8'],
};

const EYE = '#1a1423';
const WHITE = '#fff8ee';

// Local-coordinate helper for side views.
class Local {
  constructor(sp, s) {
    this.sp = sp;
    this.s = s;
  }
  X(dx) {
    return this.s > 0 ? CX + dx : CX - 1 - dx;
  }
  set(dx, y, ramp, tone = -1) {
    this.sp.set(this.X(dx), y, ramp, tone);
  }
  dot(dx, y, color, alpha) {
    this.sp.dot(this.X(dx), y, color, alpha);
  }
  span(d0, d1, y, ramp, tone = -1) {
    if (d1 < d0) [d0, d1] = [d1, d0];
    for (let d = d0; d <= d1; d++) this.set(d, y, ramp, tone);
  }
  ellipse(cdx, cy, rx, ry, ramp, tone = -1) {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let d = Math.floor(cdx - rx - 1); d <= Math.ceil(cdx + rx + 1); d++) {
        const ex = (d + 0.5 - cdx) / rx;
        const ey = (y + 0.5 - cy) / ry;
        if (ex * ex + ey * ey <= 1) this.set(d, y, ramp, tone);
      }
    }
  }
  vline(dx, y0, y1, w, ramp, tone = -1) {
    for (let y = y0; y <= y1; y++) for (let k = 0; k < w; k++) this.set(dx + k, y, ramp, tone);
  }
}

const farRamp = (r) => [darken(r[0], 0.3), darken(r[0], 0.05), r[0]];

// ---------------------------------------------------------------------------
// Slime: a translucent dome that squashes and stretches.
function paintSlime(key, anim, dir, f) {
  const sp = new Sprite(32, 32);
  const ramp = SLIME_VARIANTS[key] || SLIME_VARIANTS.slime;
  let rx = 7;
  let ry = 5.5;
  let lift = 0;
  let eyes = 'open';
  switch (anim) {
    case 'idle':
      [rx, ry] = [
        [6.5, 5],
        [6.9, 4.7],
        [7.1, 4.5],
        [6.7, 4.9],
      ][f % 4];
      break;
    case 'walk':
      [rx, ry, lift] = [
        [7.6, 3.9, 0],
        [5.6, 6.2, 2],
        [6.1, 5.6, 5],
        [7.8, 3.8, 0],
      ][f % 4];
      break;
    case 'attack':
      [rx, ry, lift] = [
        [8.2, 3.4, 0],
        [5.2, 6.8, 4],
        [8.6, 3.6, 0],
      ][Math.min(f, 2)];
      eyes = f === 0 ? 'angry' : 'open';
      break;
    case 'hurt':
      [rx, ry] = f ? [7, 4.6] : [7.8, 3.9];
      eyes = 'x';
      break;
    case 'down':
      [rx, ry] = [8.5, 2.2];
      eyes = 'none';
      break;
    default:
      break;
  }
  const base = GROUND + 1 - lift;
  const cy = base - ry * 0.6;
  sp.begin({ alpha: 0.9, band: 2 });
  for (let y = Math.floor(cy - ry - 1); y < base; y++) {
    for (let x = Math.floor(CX - rx - 1); x <= Math.ceil(CX + rx + 1); x++) {
      const dx = (x + 0.5 - CX) / rx;
      // round on top, flat and wide where it sits on the ground
      const inside = y + 0.5 < cy ? dx * dx + ((y + 0.5 - cy) / ry) ** 2 <= 1 : dx * dx + ((y + 0.5 - cy) / (ry * 0.6 + 0.4)) ** 4 <= 1;
      if (inside) sp.set(x, y, ramp);
    }
  }
  // a darker core near the bottom
  sp.begin({ flat: true, alpha: 0.9 });
  for (let y = Math.floor(cy); y < base - 1; y++) {
    for (let x = Math.floor(CX - rx * 0.6); x <= Math.ceil(CX + rx * 0.6); x++) {
      const dx = (x + 0.5 - CX) / (rx * 0.62);
      const dy = (y + 0.5 - cy - ry * 0.35) / (ry * 0.35);
      if (dx * dx + dy * dy <= 1) sp.set(x, y, ramp, 0);
    }
  }
  // glossy highlights
  sp.begin({ flat: true, shadow: 'none' });
  const hx = Math.round(CX - rx * 0.55);
  const hy = Math.round(cy - ry * 0.55);
  sp.dot(hx, hy, WHITE, 0.95);
  sp.dot(hx + 1, hy - 1, WHITE, 0.8);
  sp.dot(hx - 1, hy + 1, WHITE, 0.6);
  sp.dot(hx + 2, hy - 1, lighten(ramp[2], 0.5), 0.7);
  if (anim !== 'down') sp.dot(Math.round(CX + rx * 0.5), Math.round(cy + ry * 0.2), lighten(ramp[2], 0.3), 0.6);
  // face
  if (dir !== 'up' && eyes !== 'none') {
    const shift = dir === 'left' ? -2 : dir === 'right' ? 2 : 0;
    const ey = Math.round(cy - ry * 0.25);
    const lx = CX - 3 + shift;
    const rxp = CX + 2 + shift;
    sp.begin({ flat: true, shadow: 'none' });
    if (eyes === 'x') {
      for (const x of [lx, rxp]) {
        sp.dot(x - 1, ey - 1, EYE);
        sp.dot(x, ey, EYE);
        sp.dot(x + 1, ey + 1, EYE);
        sp.dot(x + 1, ey - 1, EYE);
        sp.dot(x - 1, ey + 1, EYE);
      }
    } else {
      for (const x of [lx, rxp]) {
        if (dir === 'left' && x === rxp && shift) continue;
        if (dir === 'right' && x === lx && shift) continue;
        sp.dot(x, ey, eyes === 'angry' ? EYE : WHITE);
        sp.dot(x, ey + 1, EYE);
        sp.dot(x, ey + 2, EYE);
      }
      if (eyes === 'angry') {
        sp.dot(lx - 1, ey - 2, EYE);
        sp.dot(rxp + 1, ey - 2, EYE);
      }
      if (!shift) {
        sp.dot(CX - 1, ey + 3, EYE);
        sp.dot(CX, ey + 3, EYE);
      } else sp.dot(CX + shift * 2 - (shift < 0 ? 1 : 0), ey + 3, EYE);
    }
  }
  return sp;
}

// ---------------------------------------------------------------------------
// Quadrupeds share leg timing.
function legPhase(anim, f, frames) {
  if (anim !== 'walk') return [0, 0, 0, 0, 0, 0, 0, 0];
  const t = (f / frames) * Math.PI * 2;
  const a = Math.round(2 * Math.sin(t));
  const b = -a;
  const la = Math.cos(t) > 0.3 ? 1 : 0;
  const lb = Math.cos(t) < -0.3 ? 1 : 0;
  // [nearFront dx, lift, farFront, lift, nearBack, lift, farBack, lift]
  return [a, la, b, lb, b, lb, a, la];
}

function wolfColors(variant) {
  if (variant === 'dark') return { body: ['#262433', '#3a3849', '#545266'], belly: ['#545266', '#727085', '#9593a6'] };
  return { body: ['#3a3849', '#5d5b70', '#858399'], belly: ['#727085', '#a3a1b4', '#cfcedb'] };
}

function paintWolf(key, anim, dir, f) {
  const sp = new Sprite(32, 32);
  const { body, belly } = wolfColors(key === 'wolf_dark' ? 'dark' : '');
  const eye = '#ffd75e';
  const frames = CREATURE_ANIMS.wolf[anim]?.frames || 1;
  if (anim === 'down') return wolfDown(sp, body, belly, dir);
  if (dir === 'left' || dir === 'right') {
    const L = new Local(sp, dir === 'right' ? 1 : -1);
    const legs = legPhase(anim, f, frames);
    let bob = anim === 'walk' ? [0, 1, 0, 0, 1, 0][f % 6] : anim === 'idle' ? (f % 2) : 0;
    let lunge = 0;
    let headDy = 0;
    let mouth = false;
    if (anim === 'attack') {
      const ff = Math.min(f, 2);
      bob = [2, 0, 1][ff];
      lunge = [-1, 3, 1][ff];
      headDy = [2, 0, 1][ff];
      mouth = ff === 1;
    }
    if (anim === 'hurt') {
      lunge = -1;
      headDy = -1;
    }
    const sit = anim === 'sit';
    const top = 19 + bob;
    // tail
    const tailUp = anim === 'attack' ? 0 : anim === 'idle' ? f % 2 : (f % 3) - 1;
    sp.begin({ band: 1 });
    L.span(-12 + lunge, -9 + lunge, top + 1 - tailUp, body);
    L.span(-12 + lunge, -8 + lunge, top + 2 - tailUp, body);
    L.span(-11 + lunge, -8 + lunge, top + 3, body);
    L.dot(-12 + lunge, top + 1 - tailUp, belly[2]);
    // far legs
    sp.begin({ band: 0 });
    if (!sit) {
      L.vline(1 + legs[2] + lunge, top + 5, GROUND - legs[3], 2, farRamp(body));
      L.vline(-7 + legs[6] + lunge, top + 5, GROUND - legs[7], 2, farRamp(body));
    }
    // body
    sp.begin({ band: 1 });
    if (sit) {
      L.ellipse(-3, 21.5, 5, 4.5, body);
      L.ellipse(1, 19, 3.5, 4, body);
    } else {
      L.ellipse(-2 + lunge, top + 2.5, 7.5, 3.6, body);
      L.ellipse(2 + lunge, top + 2, 3.5, 3.8, body);
    }
    // belly/chest light fur
    sp.begin({ flat: true, shadow: 'none' });
    if (!sit) {
      for (let d = -6; d <= 3; d++) L.set(d + lunge, top + 5, belly, 1);
      L.set(4 + lunge, top + 2, belly, 2);
      L.set(4 + lunge, top + 3, belly, 1);
      // back ridge
      for (let d = -7; d <= 0; d += 2) L.set(d + lunge, top - 1, body, 0);
    }
    // near legs
    sp.begin({ band: 0 });
    if (sit) {
      L.vline(2, 22, GROUND, 2, body);
      L.span(-6, -1, GROUND, body);
      L.span(-6, -2, GROUND - 1, body);
    } else {
      L.vline(2 + legs[0] + lunge + (anim === 'attack' && f === 1 ? 2 : 0), top + 5, GROUND - legs[1], 2, body);
      L.vline(-6 + legs[4] + lunge, top + 5, GROUND - legs[5], 2, body);
      sp.begin({ flat: true });
      L.dot(2 + legs[0] + lunge + (anim === 'attack' && f === 1 ? 2 : 0), GROUND - legs[1], body[0]);
      L.dot(-6 + legs[4] + lunge, GROUND - legs[5], body[0]);
    }
    // head
    const hx = sit ? 3 : 5 + lunge;
    const hy = (sit ? 13 : top - 3) + headDy;
    sp.begin({ band: 1 });
    L.ellipse(hx, hy + 2.5, 3.2, 3, body);
    // snout
    L.span(hx + 2, hx + 5, hy + 3, body);
    L.span(hx + 2, hx + 5, hy + 4, mouth ? body : body);
    if (mouth) L.span(hx + 2, hx + 4, hy + 6, body, 0);
    // ears
    sp.begin({});
    L.set(hx - 1, hy - 1, body, 2);
    L.set(hx - 1, hy, body, 1);
    L.set(hx, hy - 2, body, 2);
    L.set(hx, hy - 1, body, 1);
    L.set(hx, hy, body, 1);
    sp.begin({ flat: true, shadow: 'none' });
    L.dot(hx + 5, hy + 3, EYE);
    L.dot(hx + 1, hy + 2, eye);
    L.dot(hx + 2, hy + 2, EYE);
    L.dot(hx - 1, hy + 4, belly[2]);
    L.dot(hx, hy + 5, belly[2]);
    if (mouth) {
      L.dot(hx + 2, hy + 5, '#6b1424');
      L.dot(hx + 3, hy + 5, '#9e2133');
      L.dot(hx + 4, hy + 5, WHITE);
    }
    return sp;
  }
  // front / back
  const back = dir === 'up';
  const bob = anim === 'walk' ? [0, 1, 0, 0, 1, 0][f % 6] : anim === 'idle' ? f % 2 : anim === 'attack' ? [2, 0, 1][Math.min(f, 2)] : 0;
  const liftA = anim === 'walk' ? [0, 1, 1, 0, 0, 0][f % 6] : 0;
  const liftB = anim === 'walk' ? [0, 0, 0, 0, 1, 1][f % 6] : 0;
  const lunge = anim === 'attack' && f === 1 ? 2 : 0;
  if (back) {
    // head and ears first (farther away)
    sp.begin({ band: 1 });
    sp.ellipse(CX, 15 + bob, 3.5, 3, body);
    sp.begin({});
    sp.set(CX - 3, 12 + bob, body, 2);
    sp.set(CX - 3, 13 + bob, body, 1);
    sp.set(CX + 2, 12 + bob, body, 1);
    sp.set(CX + 2, 13 + bob, body, 0);
    sp.begin({ band: 2 });
    sp.ellipse(CX, 21 + bob, 5.5, 5, body);
    sp.begin({ band: 0 });
    sp.rect(CX - 5, 25, 2, GROUND - 25 + 1 - liftA, body);
    sp.rect(CX + 3, 25, 2, GROUND - 25 + 1 - liftB, body);
    // tail
    const sw = anim === 'walk' ? ((f % 3) - 1) : anim === 'idle' ? f % 2 : 0;
    sp.begin({ band: 0 });
    for (let y = 21 + bob; y <= 26 + bob; y++) sp.span(CX - 1 + sw, CX + sw, y, body);
    sp.set(CX - 1 + sw, 27 + bob, belly, 2);
    return sp;
  }
  // facing us: body behind, legs, chest, big head
  sp.begin({ band: 1 });
  sp.ellipse(CX, 21 + bob, 5, 3.5, farRamp(body));
  sp.begin({ band: 0 });
  sp.rect(CX - 4, 23 + bob, 2, GROUND - 23 - bob + 1 - liftA, body);
  sp.rect(CX + 2, 23 + bob, 2, GROUND - 23 - bob + 1 - liftB, body);
  sp.begin({ band: 1 });
  sp.ellipse(CX, 21 + bob + lunge, 3.5, 3.5, belly);
  const hy = 13 + bob + lunge;
  sp.begin({ band: 1 });
  sp.ellipse(CX, hy + 3, 4.6, 3.8, body);
  sp.begin({});
  // ears
  sp.set(CX - 4, hy - 1, body, 2);
  sp.set(CX - 4, hy, body, 2);
  sp.set(CX - 3, hy, body, 1);
  sp.set(CX + 3, hy - 1, body, 1);
  sp.set(CX + 3, hy, body, 0);
  sp.set(CX + 2, hy, body, 1);
  // muzzle
  sp.begin({ band: 0 });
  sp.span(CX - 2, CX + 1, hy + 5, belly);
  sp.span(CX - 1, CX, hy + 6, belly);
  sp.span(CX - 2, CX + 1, hy + 4, belly);
  sp.begin({ flat: true, shadow: 'none' });
  sp.dot(CX - 1, hy + 4, EYE);
  sp.dot(CX, hy + 4, EYE);
  sp.dot(CX - 3, hy + 2, eye);
  sp.dot(CX + 2, hy + 2, eye);
  sp.dot(CX - 3, hy + 3, EYE);
  sp.dot(CX + 2, hy + 3, EYE);
  if (anim === 'attack' && f === 1) {
    sp.dot(CX - 1, hy + 6, '#9e2133');
    sp.dot(CX, hy + 6, '#6b1424');
    sp.dot(CX - 2, hy + 6, WHITE);
    sp.dot(CX + 1, hy + 6, WHITE);
  }
  return sp;
}

function wolfDown(sp, body, belly, dir) {
  const L = new Local(sp, dir === 'left' ? -1 : 1);
  sp.begin({ band: 1 });
  L.ellipse(-1, 25, 8, 3, body);
  L.ellipse(6, 24, 3, 2.5, body);
  sp.begin({});
  L.span(-11, -8, 26, body);
  L.span(-4, 3, 28, farRamp(body));
  sp.begin({ flat: true, shadow: 'none' });
  for (let d = -6; d <= 3; d++) L.set(d, 27, belly, 1);
  L.dot(7, 24, EYE);
  L.dot(5, 23, EYE);
  return sp;
}

// ---------------------------------------------------------------------------
function paintBoar(key, anim, dir, f) {
  const sp = new Sprite(32, 32);
  const body = ['#2a1d18', '#4a3328', '#6e4c38'];
  const bristle = ['#1a1210', '#2a1d18', '#3a2a22'];
  const snout = ['#8a4a4a', '#c07a72', '#e0a49a'];
  const tusk = tri(RAMPS.bone, 1);
  const frames = CREATURE_ANIMS.boar[anim]?.frames || 1;
  if (anim === 'down') {
    const L = new Local(sp, dir === 'left' ? -1 : 1);
    sp.begin({ band: 1 });
    L.ellipse(-1, 24.5, 8, 4, body);
    L.ellipse(7, 25, 3, 2.5, body);
    sp.begin({});
    L.span(9, 10, 25, snout);
    sp.begin({ flat: true });
    L.dot(6, 24, EYE);
    return sp;
  }
  if (dir === 'left' || dir === 'right') {
    const L = new Local(sp, dir === 'right' ? 1 : -1);
    const legs = legPhase(anim, f, frames);
    let bob = anim === 'walk' ? f % 2 : anim === 'idle' ? f % 2 : 0;
    let lunge = 0;
    let headDy = 0;
    if (anim === 'attack') {
      const ff = Math.min(f, 2);
      // paw the ground, then charge
      bob = [1, 0, 0][ff];
      lunge = [-2, 2, 1][ff];
      headDy = [2, 1, 0][ff];
    }
    const top = 18 + bob;
    sp.begin({ band: 0 });
    L.vline(2 + legs[2] + lunge, top + 7, GROUND - legs[3], 2, farRamp(body));
    L.vline(-6 + legs[6] + lunge, top + 7, GROUND - legs[7], 2, farRamp(body));
    sp.begin({ band: 2 });
    L.ellipse(-1 + lunge, top + 4, 7.8, 5, body);
    // bristly ridge
    sp.begin({ flat: true });
    for (let d = -6; d <= 3; d++) L.set(d + lunge, top - 1 + (d < -4 || d > 2 ? 1 : 0), bristle, d % 2 ? 1 : 2);
    // tail curl
    L.dot(-9 + lunge, top + 2, body[1]);
    L.dot(-10 + lunge, top + 1, body[1]);
    sp.begin({ band: 0 });
    const strideNear = anim === 'attack' && f === 0 ? (f % 2 ? 1 : -1) : 0;
    L.vline(3 + legs[0] + lunge + strideNear, top + 7, GROUND - legs[1], 2, body);
    L.vline(-5 + legs[4] + lunge, top + 7, GROUND - legs[5], 2, body);
    // head, low and heavy
    const hx = 6 + lunge;
    const hy = top + 2 + headDy;
    sp.begin({ band: 1 });
    L.ellipse(hx, hy + 2.5, 3.4, 3.2, body);
    sp.begin({});
    L.span(hx + 2, hx + 4, hy + 3, body);
    L.span(hx + 2, hx + 4, hy + 4, body);
    L.set(hx + 5, hy + 3, snout, 2);
    L.set(hx + 5, hy + 4, snout, 1);
    sp.begin({});
    L.set(hx - 1, hy - 1, body, 2);
    L.set(hx - 2, hy - 1, body, 1);
    sp.begin({ flat: true, shadow: 'none' });
    L.set(hx + 3, hy + 5, tusk, 2);
    L.set(hx + 4, hy + 5, tusk, 2);
    L.set(hx + 4, hy + 4, tusk, 1);
    L.dot(hx + 1, hy + 2, EYE);
    L.dot(hx + 2, hy + 2, '#c4501f');
    return sp;
  }
  const back = dir === 'up';
  const bob = anim === 'walk' || anim === 'idle' ? f % 2 : 0;
  const liftA = anim === 'walk' && f % 4 < 2 ? 1 : 0;
  const liftB = anim === 'walk' && f % 4 >= 2 ? 1 : 0;
  if (back) {
    sp.begin({ band: 2 });
    sp.ellipse(CX, 21 + bob, 6.5, 5.5, body);
    sp.begin({ flat: true });
    for (let y = 16 + bob; y <= 23 + bob; y++) sp.set(CX - 1, y, bristle, 1);
    sp.begin({ band: 0 });
    sp.rect(CX - 5, 25, 2, GROUND - 25 + 1 - liftA, body);
    sp.rect(CX + 3, 25, 2, GROUND - 25 + 1 - liftB, body);
    sp.begin({ flat: true });
    sp.dot(CX, 25 + bob, body[1]);
    sp.dot(CX + 1, 24 + bob, body[1]);
    return sp;
  }
  sp.begin({ band: 2 });
  sp.ellipse(CX, 20 + bob, 6.5, 5, farRamp(body));
  sp.begin({ band: 0 });
  sp.rect(CX - 5, 24, 2, GROUND - 24 + 1 - liftA, body);
  sp.rect(CX + 3, 24, 2, GROUND - 24 + 1 - liftB, body);
  const hy = 17 + bob + (anim === 'attack' ? [2, 1, 0][Math.min(f, 2)] : 0);
  sp.begin({ band: 1 });
  sp.ellipse(CX, hy + 3, 4.5, 4, body);
  sp.begin({});
  sp.set(CX - 4, hy, body, 2);
  sp.set(CX + 3, hy, body, 0);
  sp.begin({ band: 1 });
  sp.span(CX - 2, CX + 1, hy + 5, snout);
  sp.span(CX - 2, CX + 1, hy + 6, snout);
  sp.begin({ flat: true, shadow: 'none' });
  sp.dot(CX - 1, hy + 6, snout[0]);
  sp.dot(CX, hy + 6, snout[0]);
  sp.dot(CX - 3, hy + 3, EYE);
  sp.dot(CX + 2, hy + 3, EYE);
  sp.set(CX - 3, hy + 6, tusk, 2);
  sp.set(CX - 3, hy + 5, tusk, 2);
  sp.set(CX + 2, hy + 6, tusk, 1);
  sp.set(CX + 2, hy + 5, tusk, 1);
  return sp;
}

// ---------------------------------------------------------------------------
function paintDeer(key, anim, dir, f) {
  const sp = new Sprite(32, 32);
  const body = ['#6e4a30', '#9a6a44', '#c08f5f'];
  const pale = ['#b8a080', '#e0cba8', '#f6ead2'];
  const antler = tri(RAMPS.bone, 0);
  const frames = CREATURE_ANIMS.deer[anim]?.frames || 1;
  if (anim === 'down') {
    const L = new Local(sp, dir === 'left' ? -1 : 1);
    sp.begin({ band: 1 });
    L.ellipse(-1, 25, 7, 3, body);
    L.ellipse(7, 25, 2.5, 2, body);
    sp.begin({ flat: true });
    L.span(-5, 3, 27, pale, 1);
    L.dot(8, 24, EYE);
    return sp;
  }
  if (dir === 'left' || dir === 'right') {
    const L = new Local(sp, dir === 'right' ? 1 : -1);
    const legs = legPhase(anim, f, frames);
    const bob = anim === 'walk' ? f % 2 : 0;
    const graze = anim === 'idle' && f === 2;
    const top = 15 + bob;
    sp.begin({ band: 0 });
    L.vline(2 + legs[2], top + 5, GROUND - legs[3], 1, farRamp(body));
    L.vline(-5 + legs[6], top + 5, GROUND - legs[7], 1, farRamp(body));
    sp.begin({ band: 1 });
    L.ellipse(-1, top + 2.5, 6.5, 3.2, body);
    sp.begin({ flat: true, shadow: 'none' });
    for (let d = -5; d <= 3; d++) L.set(d, top + 5, pale, 1);
    L.dot(-3, top + 1, pale[2]);
    L.dot(0, top + 2, pale[2]);
    L.dot(-5, top + 2, pale[2]);
    // tail flag
    L.set(-8, top + 1, pale, 2);
    L.set(-8, top, pale, 2);
    sp.begin({ band: 0 });
    L.vline(3 + legs[0], top + 5, GROUND - legs[1], 1, body);
    L.vline(-4 + legs[4], top + 5, GROUND - legs[5], 1, body);
    sp.begin({ flat: true });
    L.dot(3 + legs[0], GROUND - legs[1], body[0]);
    L.dot(-4 + legs[4], GROUND - legs[5], body[0]);
    // neck and head
    sp.begin({ band: 0 });
    const hx = graze ? 8 : 5;
    const hy = graze ? top + 6 : top - 6;
    if (graze) {
      for (let i = 0; i < 5; i++) L.span(4 + i, 5 + i, top + 1 + i, body);
    } else {
      for (let y = hy + 3; y <= top + 1; y++) L.span(3, 4, y, body);
    }
    sp.begin({ band: 1 });
    L.ellipse(hx, hy + 1.5, 2.2, 1.8, body);
    L.span(hx + 1, hx + 3, hy + 2, body);
    sp.begin({});
    const earFlick = anim === 'idle' && f === 1 ? -1 : 0;
    L.set(hx - 2, hy - 1 + earFlick, body, 2);
    L.set(hx - 1, hy - 1, body, 1);
    // small antlers
    sp.begin({ flat: true, shadow: 'none' });
    for (const [d, y] of [
      [-1, -2],
      [-1, -3],
      [-2, -4],
      [0, -4],
      [-1, -5],
      [-3, -5],
    ])
      L.set(hx + d, hy + y, antler, y < -3 ? 2 : 1);
    L.dot(hx + 1, hy + 1, EYE);
    L.dot(hx + 3, hy + 2, EYE);
    return sp;
  }
  const back = dir === 'up';
  const liftA = anim === 'walk' && f % 4 < 2 ? 1 : 0;
  const liftB = anim === 'walk' && f % 4 >= 2 ? 1 : 0;
  if (back) {
    sp.begin({ band: 1 });
    sp.ellipse(CX, 11, 2.5, 2.2, body);
    for (const [x, y] of [
      [-2, -2],
      [-3, -3],
      [1, -2],
      [2, -3],
    ])
      sp.set(CX + x, 11 + y, antler, 1);
    sp.begin({ band: 1 });
    sp.rect(CX - 1, 13, 2, 4, body);
    sp.ellipse(CX, 18, 4.5, 3.6, body);
    sp.begin({ band: 0 });
    sp.rect(CX - 3, 21, 1, GROUND - 21 + 1 - liftA, body);
    sp.rect(CX + 2, 21, 1, GROUND - 21 + 1 - liftB, body);
    sp.begin({ flat: true });
    sp.set(CX - 1, 17, pale, 2);
    sp.set(CX, 17, pale, 2);
    sp.set(CX - 1, 18, pale, 1);
    sp.set(CX, 18, pale, 1);
    return sp;
  }
  sp.begin({ band: 1 });
  sp.ellipse(CX, 18, 4.5, 3.2, farRamp(body));
  sp.begin({ band: 0 });
  sp.rect(CX - 3, 20, 1, GROUND - 20 + 1 - liftA, body);
  sp.rect(CX + 2, 20, 1, GROUND - 20 + 1 - liftB, body);
  sp.begin({ band: 0 });
  sp.rect(CX - 1, 13, 2, 6, body);
  sp.begin({ flat: true });
  sp.rect(CX - 1, 17, 2, 2, pale, 1);
  sp.begin({ band: 1 });
  sp.ellipse(CX, 11.5, 2.6, 2.6, body);
  sp.span(CX - 1, CX, 14, body);
  sp.begin({});
  sp.set(CX - 4, 10, body, 2);
  sp.set(CX - 3, 10, body, 1);
  sp.set(CX + 2, 10, body, 1);
  sp.set(CX + 3, 10, body, 0);
  sp.begin({ flat: true, shadow: 'none' });
  for (const [x, y] of [
    [-2, -3],
    [-3, -4],
    [-2, -5],
    [-4, -5],
    [1, -3],
    [2, -4],
    [1, -5],
    [3, -5],
  ])
    sp.set(CX + x, 11 + y, antler, y < -4 ? 2 : 1);
  sp.dot(CX - 2, 11, EYE);
  sp.dot(CX + 1, 11, EYE);
  sp.dot(CX - 1, 14, EYE);
  return sp;
}

// ---------------------------------------------------------------------------
function paintRabbit(key, anim, dir, f) {
  const sp = new Sprite(32, 32);
  const fur = ['#6b5a4a', '#9a8370', '#c7b09a'];
  const pale = ['#c8bea8', '#ece4d4', '#fffaf0'];
  let lift = 0;
  let stretch = 0;
  if (anim === 'walk') {
    [lift, stretch] = [
      [0, -1],
      [3, 1],
      [1, 0],
    ][f % 3];
  }
  if (anim === 'down') {
    const L = new Local(sp, dir === 'left' ? -1 : 1);
    sp.begin({ band: 1 });
    L.ellipse(0, 27, 4, 1.8, fur);
    L.span(3, 6, 26, fur);
    sp.begin({ flat: true });
    L.dot(-4, 27, pale[2]);
    L.dot(3, 26, EYE);
    return sp;
  }
  const g = GROUND - lift;
  if (dir === 'left' || dir === 'right') {
    const L = new Local(sp, dir === 'right' ? 1 : -1);
    sp.begin({ band: 1 });
    L.ellipse(-1, g - 2.2, 3.4 + Math.max(0, stretch) * 0.6, 2.6 - Math.max(0, stretch) * 0.3, fur);
    L.span(-3, 0, g, fur);
    sp.begin({ flat: true });
    L.set(-4 - Math.max(0, stretch), g - 3, pale, 2);
    L.set(-4 - Math.max(0, stretch), g - 2, pale, 1);
    sp.begin({ band: 1 });
    L.ellipse(2 + Math.max(0, stretch), g - 4.5, 2, 1.8, fur);
    sp.begin({});
    const ear = anim === 'idle' && f === 1 ? 1 : 0;
    for (let y = g - 9; y <= g - 6; y++) L.set(1 + (y < g - 8 ? -ear : 0), y, fur, 2);
    for (let y = g - 8; y <= g - 6; y++) L.set(0, y, fur, 1);
    sp.begin({ flat: true, shadow: 'none' });
    L.dot(3 + Math.max(0, stretch), g - 5, EYE);
    L.dot(4 + Math.max(0, stretch), g - 4, '#e0a49a');
    L.dot(1, g - 8, '#e0a49a');
    return sp;
  }
  const back = dir === 'up';
  sp.begin({ band: 1 });
  sp.ellipse(CX, g - 2.5, 3.2, 2.8 + Math.max(0, stretch) * 0.4, fur);
  if (back) {
    sp.begin({ flat: true });
    sp.set(CX - 1, g - 2, pale, 2);
    sp.set(CX, g - 2, pale, 1);
    sp.set(CX - 1, g - 1, pale, 1);
  }
  sp.begin({ band: 1 });
  sp.ellipse(CX, g - 6, 2.2, 2, fur);
  sp.begin({});
  for (let y = g - 11; y <= g - 8; y++) {
    sp.set(CX - 2, y, fur, 2);
    sp.set(CX + 1, y, fur, 1);
  }
  if (!back) {
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(CX - 2, g - 6, EYE);
    sp.dot(CX + 1, g - 6, EYE);
    sp.dot(CX - 1, g - 5, '#e0a49a');
    sp.dot(CX - 2, g - 10, '#e0a49a');
    sp.dot(CX + 1, g - 10, '#e0a49a');
  }
  return sp;
}

// ---------------------------------------------------------------------------
function paintChicken(key, anim, dir, f) {
  const sp = new Sprite(32, 32);
  const brown = key === 'chicken_brown';
  const feather = brown ? ['#6b3a22', '#9c5a32', '#c88452'] : ['#b8ad95', '#e6ddc9', '#fffaf0'];
  const comb = ['#7a1a22', '#c4303c', '#ee5a5a'];
  const beak = tri(RAMPS.gold, 1);
  if (anim === 'down') {
    const L = new Local(sp, dir === 'left' ? -1 : 1);
    sp.begin({ band: 1 });
    L.ellipse(0, 26.5, 4.5, 2, feather);
    sp.begin({});
    L.set(4, 26, comb, 1);
    L.set(5, 26, beak, 1);
    sp.begin({ flat: true });
    L.dot(3, 26, EYE);
    return sp;
  }
  const peck = anim === 'idle' ? [0, 1, 2, 0][f % 4] : 0;
  const step = anim === 'walk' ? f % 2 : 0;
  const bob = anim === 'walk' ? (f % 2) : 0;
  if (dir === 'left' || dir === 'right') {
    const L = new Local(sp, dir === 'right' ? 1 : -1);
    sp.begin({});
    // legs
    L.set(-1 + (anim === 'walk' ? [0, 1, 0, -1][f % 4] : 0), 27, beak, 1);
    L.set(-1 + (anim === 'walk' ? [0, 1, 0, -1][f % 4] : 0), 28, beak, 0);
    L.set(1 + (anim === 'walk' ? [0, -1, 0, 1][f % 4] : 0), 27, beak, 1);
    L.set(1 + (anim === 'walk' ? [0, -1, 0, 1][f % 4] : 0), 28 - step, beak, 0);
    sp.begin({ band: 1 });
    L.ellipse(-0.5, 23.5 + bob, 3.8, 3, feather);
    // tail feathers
    L.span(-5, -3, 20 + bob, feather);
    L.span(-5, -3, 21 + bob, feather);
    L.set(-4, 19 + bob, feather, 2);
    // wing
    sp.begin({ flat: true });
    L.span(-2, 1, 23 + bob, feather, 0);
    L.span(-1, 1, 24 + bob, feather, 0);
    // head: up, or down pecking
    const hx = peck === 2 ? 4 : peck === 1 ? 3 : 2;
    const hy = peck === 2 ? 23 : peck === 1 ? 20 : 18 + bob;
    sp.begin({ band: 0 });
    if (!peck) L.span(1, 2, hy + 3, feather);
    L.ellipse(hx, hy + 1.5, 1.8, 1.8, feather);
    sp.begin({});
    L.set(hx, hy - 1, comb, 2);
    L.set(hx - 1, hy - 1, comb, 1);
    L.set(hx + 2, hy + 1, beak, 2);
    L.set(hx + 2, hy + 2, beak, 1);
    L.set(hx + 1, hy + 3, comb, 1);
    sp.begin({ flat: true, shadow: 'none' });
    L.dot(hx + 1, hy + 1, EYE);
    return sp;
  }
  const back = dir === 'up';
  sp.begin({});
  sp.set(CX - 2, 27, beak, 1);
  sp.set(CX - 2, 28 - (anim === 'walk' && f % 2 ? 1 : 0), beak, 0);
  sp.set(CX + 1, 27, beak, 1);
  sp.set(CX + 1, 28 - (anim === 'walk' && f % 2 ? 0 : 0), beak, 0);
  sp.begin({ band: 1 });
  sp.ellipse(CX, 23.5 + bob, 3.6, 3.2, feather);
  if (back) {
    sp.span(CX - 2, CX + 1, 19 + bob, feather);
    sp.span(CX - 1, CX, 18 + bob, feather);
  }
  sp.begin({ band: 0 });
  const hy = peck ? 21 + peck : 18 + bob;
  sp.ellipse(CX, hy + 1, 2, 1.9, feather);
  sp.begin({});
  sp.set(CX - 1, hy - 2, comb, 2);
  sp.set(CX, hy - 2, comb, 1);
  sp.set(CX - 1, hy - 1, comb, 1);
  if (!back) {
    sp.set(CX - 1, hy + 2, beak, 2);
    sp.set(CX, hy + 2, beak, 1);
    sp.set(CX - 1, hy + 3, comb, 1);
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(CX - 2, hy + 1, EYE);
    sp.dot(CX + 1, hy + 1, EYE);
  }
  return sp;
}

// ---------------------------------------------------------------------------
function paintCat(key, anim, dir, f) {
  const sp = new Sprite(32, 32);
  const fur = ['#6b2a12', '#b4561f', '#e08a46'];
  const stripe = '#7a3214';
  const pale = ['#c8bea8', '#f0e8d8', '#fffaf0'];
  const eye = '#9be06a';
  if (anim === 'sleep' || anim === 'down') {
    // curled up in a ball, tail around the nose
    sp.begin({ band: 1 });
    sp.ellipse(CX, 25.5, 5, 3.2 + (anim === 'sleep' ? (f % 2) * 0.3 : 0), fur);
    sp.begin({});
    sp.set(CX + 3, 22, fur, 1);
    sp.set(CX + 4, 22, fur, 0);
    sp.begin({ flat: true, shadow: 'none' });
    for (let x = CX - 4; x <= CX + 1; x++) sp.dot(x, 28, x % 2 ? fur[1] : fur[0]);
    sp.dot(CX - 2, 24, stripe);
    sp.dot(CX, 23, stripe);
    sp.dot(CX + 2, 25, anim === 'down' ? EYE : EYE);
    sp.dot(CX + 3, 25, EYE);
    sp.dot(CX - 4, 26, pale[2]);
    return sp;
  }
  const tail = anim === 'walk' ? [0, 1, 0, -1][f % 4] : f % 2;
  if (dir === 'left' || dir === 'right') {
    const L = new Local(sp, dir === 'right' ? 1 : -1);
    if (anim === 'sit') {
      sp.begin({ band: 1 });
      L.ellipse(-1, 24.5, 3.5, 4, fur);
      sp.begin({ band: 0 });
      L.span(-5, 3, 28, fur);
      L.vline(2, 22, 28, 1, fur);
      // tail wrapped round the paws, tip flicking
      sp.begin({});
      L.span(-5, 3, 28, fur);
      L.set(4, 27 - tail, fur, 2);
      sp.begin({ band: 1 });
      L.ellipse(1.5, 19.5, 2.8, 2.5, fur);
      sp.begin({});
      L.set(0, 16, fur, 2);
      L.set(0, 17, fur, 1);
      L.set(2, 16, fur, 1);
      L.set(2, 17, fur, 1);
      sp.begin({ flat: true, shadow: 'none' });
      L.dot(3, 19, eye);
      L.dot(4, 20, '#e0a49a');
      L.dot(1, 21, pale[2]);
      L.dot(-2, 23, stripe);
      L.dot(-3, 25, stripe);
      return sp;
    }
    const legs = legPhase(anim, f, 4);
    const bob = anim === 'walk' ? f % 2 : 0;
    sp.begin({ band: 0 });
    // tail curving up
    L.set(-5, 23 + bob, fur, 1);
    L.set(-6, 22 + bob, fur, 1);
    L.set(-7 + tail, 21 + bob, fur, 1);
    L.set(-7 + tail, 20 + bob, fur, 2);
    L.set(-7 + tail, 19 + bob, fur, 2);
    L.dot(-7 + tail, 18 + bob, stripe);
    sp.begin({ band: 0 });
    L.vline(2 + legs[2], 25, GROUND - legs[3], 1, farRamp(fur));
    L.vline(-3 + legs[6], 25, GROUND - legs[7], 1, farRamp(fur));
    sp.begin({ band: 1 });
    L.ellipse(-0.5, 23.5 + bob, 4.8, 2.3, fur);
    sp.begin({ flat: true, shadow: 'none' });
    L.dot(-2, 22 + bob, stripe);
    L.dot(0, 22 + bob, stripe);
    L.dot(-4, 23 + bob, stripe);
    sp.begin({ band: 0 });
    L.vline(3 + legs[0], 25, GROUND - legs[1], 1, fur);
    L.vline(-2 + legs[4], 25, GROUND - legs[5], 1, fur);
    sp.begin({ band: 1 });
    L.ellipse(4.5, 20.5 + bob, 2.5, 2.2, fur);
    sp.begin({});
    L.set(3, 17 + bob, fur, 2);
    L.set(3, 18 + bob, fur, 1);
    L.set(5, 17 + bob, fur, 1);
    L.set(5, 18 + bob, fur, 1);
    sp.begin({ flat: true, shadow: 'none' });
    L.dot(6, 20 + bob, eye);
    L.dot(7, 21 + bob, '#e0a49a');
    L.dot(5, 22 + bob, pale[2]);
    return sp;
  }
  const back = dir === 'up';
  if (anim === 'sit' || anim === 'idle') {
    sp.begin({ band: 1 });
    sp.ellipse(CX, 25, 3.8, 3.6, fur);
    if (back) {
      sp.begin({});
      sp.set(CX - 4 - tail, 27, fur, 1);
      sp.set(CX - 5 - tail, 26, fur, 2);
      sp.set(CX - 5 - tail, 25, fur, 2);
    } else {
      sp.begin({ flat: true });
      sp.set(CX - 1, 24, pale, 2);
      sp.set(CX, 24, pale, 1);
      sp.set(CX - 1, 25, pale, 1);
      sp.begin({});
      sp.span(CX + 2, CX + 4 + tail, 28, fur);
    }
  } else {
    const liftA = f % 4 < 2 ? 1 : 0;
    sp.begin({ band: 1 });
    sp.ellipse(CX, 24, 3, 3.2, fur);
    sp.begin({ band: 0 });
    sp.rect(CX - 2, 26, 1, 3 - liftA, fur);
    sp.rect(CX + 1, 26, 1, 2 + liftA, fur);
    if (back) {
      sp.begin({});
      sp.set(CX + tail, 21, fur, 2);
      sp.set(CX + tail, 20, fur, 2);
      sp.set(CX + tail, 19, fur, 1);
    }
  }
  sp.begin({ band: 1 });
  const hy = anim === 'walk' ? 19 : 18;
  sp.ellipse(CX, hy + 2, 3, 2.5, fur);
  sp.begin({});
  sp.set(CX - 3, hy - 1, fur, 2);
  sp.set(CX - 3, hy, fur, 2);
  sp.set(CX - 2, hy, fur, 1);
  sp.set(CX + 2, hy - 1, fur, 1);
  sp.set(CX + 2, hy, fur, 0);
  sp.set(CX + 1, hy, fur, 1);
  sp.begin({ flat: true, shadow: 'none' });
  if (!back) {
    sp.dot(CX - 2, hy + 2, eye);
    sp.dot(CX + 1, hy + 2, eye);
    sp.dot(CX - 1, hy + 3, '#e0a49a');
    sp.dot(CX, hy + 3, '#e0a49a');
    sp.dot(CX - 1, hy + 4, pale[2]);
    sp.dot(CX, hy + 4, pale[2]);
  } else {
    sp.dot(CX - 1, hy + 1, stripe);
    sp.dot(CX, hy + 2, stripe);
  }
  return sp;
}

// ---------------------------------------------------------------------------
// Bat: flying; the sprite floats and the Creature adds a z bob on top.
function paintBat(key, anim, dir, f) {
  const sp = new Sprite(32, 32);
  const body = ['#21182e', '#3a2a50', '#574174'];
  const wing = ['#2a1d3d', '#4a3566', '#6b5290'];
  const eye = '#ff5a5a';
  if (anim === 'down') {
    sp.begin({ band: 1 });
    sp.ellipse(CX, 26.5, 3, 2, body);
    sp.begin({});
    sp.span(CX - 7, CX - 3, 27, wing);
    sp.span(CX + 2, CX + 6, 27, wing);
    sp.begin({ flat: true });
    sp.dot(CX - 1, 26, EYE);
    sp.dot(CX + 1, 26, EYE);
    return sp;
  }
  // wing phase: 0 up, 1 level, 2 down, 3 level
  const phase = anim === 'attack' ? [0, 2, 1][Math.min(f, 2)] : anim === 'hurt' ? 2 : f % 4;
  const cy = anim === 'attack' ? [14, 18, 17][Math.min(f, 2)] : 16 + (phase === 2 ? 1 : 0);
  const side = dir === 'left' || dir === 'right';
  const L = new Local(sp, dir === 'left' ? -1 : 1);
  const wingTips = [
    [-3, -4],
    [0, -1],
    [3, 2],
    [0, 0],
  ][phase];
  const span = side ? 6 : 8;
  // wings (both sides; in side view the far wing is darker and shorter)
  for (const sgn of [-1, 1]) {
    const far = side && sgn < 0;
    const w = side ? (far ? span - 2 : span) : span;
    sp.begin({ band: 0 });
    const ramp = far ? farRamp(wing) : wing;
    for (let i = 1; i <= w; i++) {
      const t = i / w;
      const y0 = Math.round(cy - 1 + wingTips[0] * t * (phase === 0 ? 1 : 0) + wingTips[1] * t);
      const thick = Math.max(1, Math.round(3 * (1 - t) + 1));
      for (let k = 0; k < thick; k++) {
        const x = side ? L.X(sgn * i * (far ? 0.6 : 1) - (far ? 1 : 0)) : CX - 1 + sgn * i + (sgn > 0 ? 1 : 0);
        sp.set(Math.round(x), y0 + k + (phase === 2 ? Math.round(t * 2) : 0), ramp);
      }
    }
    // membrane scallops
    sp.begin({ flat: true, shadow: 'none' });
    if (!far) {
      const x = side ? L.X(sgn * w) : CX - 1 + sgn * w + (sgn > 0 ? 1 : 0);
      sp.dot(Math.round(x), cy - 1 + (phase === 0 ? -3 : phase === 2 ? 4 : 0), wing[2]);
    }
  }
  sp.begin({ band: 1 });
  sp.ellipse(CX, cy + 1, 2.4, 2.6, body);
  sp.begin({});
  // ears
  sp.set(CX - 2, cy - 2, body, 2);
  sp.set(CX + 1, cy - 2, body, 1);
  if (dir !== 'up') {
    sp.begin({ flat: true, shadow: 'none' });
    const shift = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
    sp.dot(CX - 1 + shift, cy, eye);
    if (!side) sp.dot(CX, cy, eye);
    else sp.dot(CX + shift * 1, cy, eye);
    sp.dot(CX - 1 + shift, cy + 2, WHITE);
    if (anim === 'attack' && f === 0) glow(sp, CX, cy, 3, eye, 0.35);
  }
  return sp;
}

const PAINTERS = {
  slime: paintSlime,
  wolf: paintWolf,
  boar: paintBoar,
  deer: paintDeer,
  rabbit: paintRabbit,
  chicken: paintChicken,
  cat: paintCat,
  bat: paintBat,
};

// Sprite keys and which painter/anim table each uses.
export const CREATURE_SPRITES = {
  slime: 'slime',
  slime_blue: 'slime',
  slime_rose: 'slime',
  wolf: 'wolf',
  wolf_dark: 'wolf',
  boar: 'boar',
  deer: 'deer',
  rabbit: 'rabbit',
  chicken: 'chicken',
  chicken_brown: 'chicken',
  cat: 'cat',
  bat: 'bat',
};

export function paintCreature(key, anim, dir, frame) {
  const base = CREATURE_SPRITES[key];
  const fn = PAINTERS[base];
  if (!fn) return null;
  return fn(key, anim, dir, frame);
}

export const creatureMix = mixHex;
