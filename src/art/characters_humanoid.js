// Parametric humanoid sprites: 32x32 frames, body about 16x24, feet at row 28.
// Every direction is painted (not mirrored) so asymmetric details stay correct:
// the weapon is always in the right hand and Lyra's braid falls over her left
// shoulder. Shading is computed by the Sprite painter from part depth, with light
// from the upper left, so mirrored geometry still gets correct lighting.

import { Sprite, glow, lighten, darken, mixHex, tri } from './characters_paint.js';
import { normalizeAppearance, clothRamp } from './characters_appearance.js';
import { RAMPS } from './palette.js';

export const FRAME = 32;
export const ANCHOR_X = 16;
export const ANCHOR_Y = 29;
const CX = 16;

// Frame counts and speeds per animation (frames are painted for all four dirs).
export const HUMANOID_ANIMS = {
  idle: { frames: 4, fps: 3, loop: true },
  walk: { frames: 6, fps: 10, loop: true },
  attack: { frames: 4, fps: 14, loop: false },
  cast: { frames: 3, fps: 8, loop: false },
  hurt: { frames: 2, fps: 8, loop: false },
  down: { frames: 1, fps: 1, loop: false },
  work: { frames: 4, fps: 7, loop: true },
  sit: { frames: 1, fps: 1, loop: true },
  sleep: { frames: 2, fps: 1.2, loop: true },
};

export const DIRECTIONS = ['down', 'left', 'right', 'up'];

const WOOD = tri(RAMPS.wood, 1);
const DARK_WOOD = tri(RAMPS.wood, 0);
const GOLD = tri(RAMPS.gold, 1);
const IRON = tri(RAMPS.iron, 1);
const RUST_IRON = ['#4a3328', '#7d6458', '#a8958a'];
const LEATHER = ['#2e1d14', '#51331f', '#76502f'];
const EYE_DARK = '#1f1828';
const WHITE = '#f6f0ea';

// ---------------------------------------------------------------------------
// Body geometry per build (rows are absolute in the 32x32 frame).
function geometry(build) {
  switch (build) {
    case 'child':
      return { headTop: 11, shoulderY: 20, waistY: 23, hipY: 24, footY: 28, torso: [3, 3, 3, 3, 3], legs: [13, 16], legW: 3, armW: 2, sideTorso: [-2, 2], headHalf: 5 };
    case 'big':
      return { headTop: 3, shoulderY: 13, waistY: 19, hipY: 20, footY: 28, torso: [6, 6, 6, 6, 6, 5, 5, 5], legs: [11, 16], legW: 5, armW: 3, sideTorso: [-4, 3], headHalf: 5 };
    case 'stout':
      return { headTop: 5, shoulderY: 15, waistY: 20, hipY: 21, footY: 28, torso: [5, 5, 5, 5, 5, 5, 5], legs: [12, 16], legW: 4, armW: 2, sideTorso: [-4, 3], headHalf: 5, belly: true };
    case 'slim':
      return { headTop: 5, shoulderY: 15, waistY: 20, hipY: 21, footY: 28, torso: [4, 4, 4, 3, 3, 3, 4], legs: [13, 16], legW: 3, armW: 2, sideTorso: [-3, 2], headHalf: 5 };
    default:
      return { headTop: 5, shoulderY: 15, waistY: 20, hipY: 21, footY: 28, torso: [4, 4, 4, 4, 4, 4, 4], legs: [12, 16], legW: 4, armW: 2, sideTorso: [-3, 2], headHalf: 5 };
  }
}

// Head silhouette half-widths for its 10 rows (front/back view).
const HEAD_ROWS = [3, 4, 5, 5, 5, 5, 5, 5, 4, 3];
// Side view head: [dxFrom, dxTo] per row (dx is forward-positive).
const SIDE_HEAD = [
  [-3, 1],
  [-4, 2],
  [-5, 3],
  [-5, 3],
  [-5, 3],
  [-5, 3],
  [-5, 3],
  [-5, 3],
  [-4, 2],
  [-2, 1],
];

// Fringe depth (rows from head top) per head column, front view, screen left to right.
const FRINGES = {
  short: [6, 5, 3, 3, 4, 3, 3, 4, 5, 6],
  long: [10, 5, 4, 3, 3, 3, 3, 4, 5, 10],
  ponytail: [6, 4, 3, 3, 3, 3, 3, 3, 4, 6],
  braid: [7, 5, 3, 3, 4, 3, 3, 3, 5, 7],
  bun: [5, 4, 3, 3, 3, 3, 3, 3, 4, 5],
  curly: [7, 6, 4, 4, 3, 4, 4, 4, 6, 7],
  bald: null,
  hood: null,
};

// ---------------------------------------------------------------------------
// Poses. Each frame is a small object; see paintFront/paintSide for meaning.
//  arm offsets: fx = outward (front/back) or forward (side), fy = down.
//  item dir [u, v]: u = outward/forward, v = down.
function basePose() {
  return {
    bob: 0,
    breath: 0,
    headDy: 0,
    lean: 0,
    sway: 0,
    legA: { lift: 0, dx: 0 },
    legB: { lift: 0, dx: 0 },
    armR: { fx: 0, fy: 0 },
    armL: { fx: 0, fy: 0 },
    item: null, // null = rest pose for the held item
    tool: null, // override the item drawn (work anim)
    twoHand: false,
    smear: null,
    face: 'open',
    mouth: null,
    glowL: 0,
    glowR: 0,
    crystal: 0,
    sit: false,
    bowDraw: 0,
    hideItem: false,
  };
}

function itemClass(held) {
  if (held === 'bow') return 'bow';
  if (held === 'staff' || held === 'hoe') return 'pole';
  if (held === 'book') return 'book';
  if (held === 'none') return 'none';
  return 'blade';
}

export function humanoidPose(anim, frame, view, a) {
  const p = basePose();
  const cls = itemClass(a.held);
  const side = view === 'side';
  const back = view === 'up';
  switch (anim) {
    case 'idle': {
      p.breath = [0, 1, 1, 0][frame % 4];
      p.sway = [0, 0, 1, 1][frame % 4];
      break;
    }
    case 'walk': {
      const f = frame % 6;
      p.bob = [0, 1, 0, 0, 1, 0][f];
      p.sway = [0, -1, -1, 0, 1, 1][f];
      if (side) {
        const near = [3, 1, -1, -3, -1, 1][f];
        p.legA = { dx: near, lift: f === 4 || f === 5 ? 1 : 0 };
        p.legB = { dx: -near, lift: f === 1 || f === 2 ? 1 : 0 };
        const swing = [-2, -1, 1, 2, 1, -1][f];
        p.armR = { fx: swing, fy: Math.abs(swing) > 1 ? -1 : 0 };
        p.armL = { fx: -swing, fy: Math.abs(swing) > 1 ? -1 : 0 };
      } else {
        p.legA = { dx: 0, lift: [0, 1, 1, 0, 0, 0][f] };
        p.legB = { dx: 0, lift: [0, 0, 0, 0, 1, 1][f] };
        const swingA = [0, -1, -1, 0, 1, 1][f];
        // arm on the same screen side as legA swings opposite to that leg
        const left = { fx: swingA > 0 ? -1 : 0, fy: swingA };
        const right = { fx: swingA < 0 ? -1 : 0, fy: -swingA };
        // front view: the right arm is on screen left; back view: on screen right
        if (back) {
          p.armL = left;
          p.armR = right;
        } else {
          p.armR = left;
          p.armL = right;
        }
      }
      break;
    }
    case 'attack': {
      const f = Math.min(frame, 3);
      p.face = 'focus';
      if (cls === 'bow') {
        p.item = side ? [1, 0] : back ? [0, -1] : [0, 1];
        if (side) {
          p.armR = [{ fx: 3, fy: -5 }, { fx: 4, fy: -5 }, { fx: 4, fy: -5 }, { fx: 2, fy: -3 }][f];
          p.armL = [{ fx: 1, fy: -5 }, { fx: -1, fy: -6 }, { fx: -2, fy: -5 }, { fx: 0, fy: -2 }][f];
        } else {
          p.armR = [{ fx: -1, fy: -4 }, { fx: -2, fy: -5 }, { fx: -2, fy: -5 }, { fx: -1, fy: -3 }][f];
          p.armL = [{ fx: -1, fy: -4 }, { fx: -1, fy: -6 }, { fx: 0, fy: -5 }, { fx: 0, fy: -2 }][f];
        }
        p.bowDraw = [0, 2, 0, 0][f];
        p.mouth = f === 2 ? 'open' : null;
        break;
      }
      if (side) {
        p.armR = [{ fx: -3, fy: -8 }, { fx: 1, fy: -8 }, { fx: 4, fy: -4 }, { fx: 3, fy: -2 }][f];
        p.armL = [{ fx: 1, fy: -2 }, { fx: 0, fy: -1 }, { fx: -2, fy: 0 }, { fx: -1, fy: 0 }][f];
        p.item = [
          [-1, -1],
          [1, -1],
          [1, 0],
          [1, 1],
        ][f];
        p.lean = [-1, 0, 1, 1][f];
        p.smear = f === 1 ? [-1, -1, 1, -1] : f === 2 ? [1, -1, 1, 1] : null;
      } else if (back) {
        p.armR = [{ fx: 1, fy: -8 }, { fx: 0, fy: -10 }, { fx: -2, fy: -9 }, { fx: -1, fy: -5 }][f];
        p.item = [
          [0, -1],
          [-1, -1],
          [0, -1],
          [0, -1],
        ][f];
        p.smear = f === 1 ? [1, -1, -1, -1] : null;
      } else {
        p.armR = [{ fx: 1, fy: -8 }, { fx: 2, fy: -5 }, { fx: -2, fy: -2 }, { fx: -1, fy: 0 }][f];
        p.armL = [{ fx: 0, fy: 0 }, { fx: 0, fy: -1 }, { fx: 1, fy: -1 }, { fx: 0, fy: 0 }][f];
        p.item = [
          [0, -1],
          [1, 0],
          [-1, 1],
          [0, 1],
        ][f];
        p.smear = f === 1 ? [0, -1, 1, 0] : f === 2 ? [1, 0, -1, 1] : null;
      }
      p.mouth = f === 2 ? 'open' : null;
      if (cls === 'none') p.hideItem = true;
      break;
    }
    case 'cast': {
      const f = Math.min(frame, 2);
      p.face = f === 0 ? 'open' : 'focus';
      if (side) {
        p.armR = [{ fx: 1, fy: -4 }, { fx: 2, fy: -7 }, { fx: 2, fy: -8 }][f];
        p.armL = [{ fx: 2, fy: -3 }, { fx: 4, fy: -5 }, { fx: 5, fy: -5 }][f];
        p.lean = [0, 1, 1][f];
      } else {
        p.armR = [{ fx: 0, fy: -5 }, { fx: 1, fy: -8 }, { fx: 1, fy: -9 }][f];
        p.armL = [{ fx: -1, fy: -4 }, { fx: -2, fy: -5 }, { fx: -2, fy: -6 }][f];
      }
      p.item = cls === 'pole' ? [0, -1] : null;
      p.glowL = [0, 1, 2][f];
      p.glowR = cls === 'none' || cls === 'book' ? [0, 1, 2][f] : 0;
      p.crystal = [0, 1, 2][f];
      p.breath = f > 0 ? 1 : 0;
      break;
    }
    case 'hurt': {
      const f = Math.min(frame, 1);
      p.face = f === 0 ? 'hurt' : 'squint';
      p.mouth = f === 0 ? 'open' : null;
      p.lean = -1;
      p.headDy = f === 0 ? -1 : 0;
      p.armR = f === 0 ? { fx: 1, fy: -2 } : { fx: 1, fy: -1 };
      p.armL = f === 0 ? { fx: 1, fy: -2 } : { fx: 1, fy: -1 };
      break;
    }
    case 'work': {
      const f = frame % 4;
      p.twoHand = true;
      p.tool = a.workTool || (cls === 'blade' && a.held !== 'sword' && a.held !== 'dagger' ? a.held : cls === 'pole' && a.held === 'hoe' ? 'hoe' : 'axe');
      if (side) {
        p.armR = [{ fx: 0, fy: -9 }, { fx: -1, fy: -10 }, { fx: 3, fy: -4 }, { fx: 3, fy: -3 }][f];
        p.item = [
          [0, -1],
          [-1, -1],
          [1, 1],
          [1, 1],
        ][f];
        p.lean = [0, -1, 1, 1][f];
      } else if (back) {
        p.armR = [{ fx: -2, fy: -9 }, { fx: -2, fy: -10 }, { fx: -2, fy: -6 }, { fx: -2, fy: -5 }][f];
        p.item = [0, -1];
      } else {
        p.armR = [{ fx: -2, fy: -9 }, { fx: -2, fy: -10 }, { fx: -3, fy: -3 }, { fx: -3, fy: -2 }][f];
        p.item = [
          [0, -1],
          [0, -1],
          [0, 1],
          [0, 1],
        ][f];
      }
      p.bob = f === 3 ? 1 : 0;
      p.face = f >= 2 ? 'focus' : 'open';
      p.smear = side && f === 2 ? [-1, -1, 1, 1] : null;
      break;
    }
    case 'sit': {
      p.sit = true;
      p.bob = a.build === 'child' ? 3 : 4;
      p.armR = side ? { fx: 2, fy: 0 } : { fx: -1, fy: 1 };
      p.armL = side ? { fx: 2, fy: 0 } : { fx: -1, fy: 1 };
      p.hideItem = a.held !== 'book';
      break;
    }
    case 'sleep': {
      p.face = 'closed';
      p.breath = frame % 2;
      p.hideItem = true;
      break;
    }
    case 'down': {
      p.face = 'ko';
      p.hideItem = true;
      break;
    }
    default:
      break;
  }
  // A staff or hoe is carried upright in front in side views, clear of the face.
  if (side && cls === 'pole' && (anim === 'idle' || anim === 'walk' || anim === 'hurt')) {
    p.armR = { fx: 4, fy: 1 + (anim === 'walk' ? 0 : 0) };
  }
  return p;
}

// ---------------------------------------------------------------------------
// Items, described along an axis k (from the grip toward the tip) and a cross
// offset j (positive = shadow side). Entries: [k, j, ramp, tone].
function itemPixels(kind, a, opts = {}) {
  const blade = a.rust ? RUST_IRON : IRON;
  const out = [];
  const add = (k, j, ramp, tone) => out.push([k, j, ramp, tone]);
  switch (kind) {
    case 'sword':
      add(-2, 0, GOLD, 2);
      add(-1, 0, LEATHER, 1);
      add(0, 0, LEATHER, 0);
      add(1, -1, GOLD, 2);
      add(1, 0, GOLD, 1);
      add(1, 1, GOLD, 0);
      // A sword hanging at rest in a front/back view tilts toward the viewer: shorter.
      for (let k = 2; k <= 8 - (opts.short || 0); k++) {
        add(k, 0, blade, 2);
        add(k, 1, blade, 0);
      }
      add(9 - (opts.short || 0), 0, blade, 1);
      if (a.rust) {
        add(4, 1, ['#6b3a22', '#6b3a22', '#6b3a22'], 1);
        add(6, 0, ['#8c5a35', '#8c5a35', '#8c5a35'], 1);
      }
      break;
    case 'dagger':
      add(-1, 0, LEATHER, 1);
      add(0, 0, LEATHER, 0);
      add(1, -1, IRON, 1);
      add(1, 0, IRON, 1);
      add(1, 1, IRON, 0);
      for (let k = 2; k <= 4; k++) add(k, 0, blade, 2);
      add(2, 1, blade, 0);
      add(3, 1, blade, 0);
      break;
    case 'staff':
      if (a.staffCrystal) {
        // a short ranger's staff: dark wood, silver bands, a glass-clear crystal
        for (let k = -4; k <= 6; k++) add(k, 0, DARK_WOOD, k === -4 ? 0 : 1);
        for (let k = -3; k <= 5; k += 4) add(k, 1, DARK_WOOD, 0);
        add(6, -1, ['#5f6273', '#a3a8b8', '#e6e9f2'], 2);
        add(6, 1, ['#5f6273', '#a3a8b8', '#e6e9f2'], 0);
        add(7, -1, ['#5f6273', '#a3a8b8', '#e6e9f2'], 1);
        add(7, 1, ['#5f6273', '#a3a8b8', '#e6e9f2'], 0);
        const c = a.staffCrystal;
        add(7, 0, c, 1);
        add(8, -1, c, 2);
        add(8, 0, c, 2);
        add(8, 1, c, 1);
        add(9, 0, c, 2);
        add(10, 0, c, 1);
      } else {
        for (let k = -6; k <= 8; k++) add(k, 0, WOOD, 1);
        add(9, 0, WOOD, 2);
        add(9, -1, WOOD, 2);
        add(10, -1, WOOD, 1);
        add(8, -1, WOOD, 0);
      }
      break;
    case 'hoe':
      for (let k = -5; k <= 7; k++) add(k, 0, WOOD, 1);
      add(8, 0, IRON, 2);
      add(8, 1, IRON, 1);
      add(8, 2, IRON, 0);
      add(7, 2, IRON, 0);
      break;
    case 'hammer':
      for (let k = -1; k <= 4; k++) add(k, 0, WOOD, 1);
      for (let j = -1; j <= 1; j++) {
        add(5, j, IRON, j < 0 ? 2 : 1);
        add(6, j, IRON, j < 1 ? 1 : 0);
      }
      add(5, -2, IRON, 2);
      add(6, -2, IRON, 1);
      break;
    case 'axe':
      for (let k = -1; k <= 6; k++) add(k, 0, WOOD, k < 6 ? 1 : 2);
      add(4, -1, blade, 1);
      add(5, -1, blade, 1);
      add(6, -1, blade, 1);
      add(4, -2, blade, 2);
      add(5, -2, blade, 2);
      add(6, -2, blade, 2);
      add(7, -2, blade, 2);
      add(3, -2, blade, 0);
      add(5, -3, ['#e6e9f2', '#e6e9f2', '#e6e9f2'], 1);
      add(4, -3, blade, 2);
      add(6, -3, blade, 2);
      break;
    case 'ladle':
      for (let k = -1; k <= 4; k++) add(k, 0, IRON, 1);
      add(5, 0, IRON, 1);
      add(5, -1, IRON, 2);
      add(6, -1, IRON, 1);
      add(6, 0, IRON, 0);
      break;
    case 'bow': {
      const draw = opts.bowDraw || 0;
      const limb = [
        [0, 0],
        [0, -1],
        [0, -2],
        [-1, -3],
        [-1, -4],
        [-2, -5],
        [0, 1],
        [0, 2],
        [-1, 3],
        [-1, 4],
        [-2, 5],
      ];
      for (const [k, j] of limb) add(k, j, WOOD, Math.abs(j) >= 4 ? 2 : 1);
      add(0, 0, LEATHER, 1);
      // string: straight, or pulled back to the drawing hand
      const pull = draw ? 2 + draw : 0;
      for (let j = -4; j <= 4; j++) {
        const t = 1 - Math.abs(j) / 5;
        const k = -2 - Math.round(pull * t);
        out.push([k, j, ['#d8d0c0', '#d8d0c0', '#d8d0c0'], 1, true]);
      }
      if (draw) {
        // a nocked arrow along the axis
        for (let k = -2 - pull; k <= 2; k++) add(k, 0, WOOD, 2);
        add(3, 0, IRON, 2);
        add(-3 - pull, -1, ['#c9c6cf', '#c9c6cf', '#c9c6cf'], 1);
      }
      break;
    }
    default:
      break;
  }
  return out;
}

// Map an 8-direction axis to unit steps plus the cross (shadow-side) step.
function axisSteps(u, v) {
  const ax = Math.sign(u);
  const ay = Math.sign(v);
  const cross = Math.abs(ax) >= Math.abs(ay) && ay === 0 ? [0, 1] : ax === 0 ? [1, 0] : [0, 1];
  return { ax, ay, cx: cross[0], cy: cross[1] };
}

// ---------------------------------------------------------------------------

class Painter {
  constructor(app, anim, frame, dir) {
    this.a = app;
    this.anim = anim;
    this.dir = dir;
    this.view = dir === 'left' || dir === 'right' ? 'side' : dir;
    this.s = dir === 'left' ? -1 : 1; // facing sign for side views
    this.g = geometry(app.build);
    this.p = humanoidPose(anim, frame, this.view === 'side' ? 'side' : dir, app);
    this.sp = new Sprite(FRAME, FRAME);
    // Hair and cloaks catch a cool rim light on their shadow side (DESIGN §18).
    this.sp.rimRamps = new Set([app.hair, app.cloak, app.hood, app.cloakLining].filter(Boolean));
    this.lateItem = null;
    this.lateHands = [];
  }

  // Side-view local x (forward positive) to screen x, mirrored exactly.
  X(dx) {
    return this.s > 0 ? CX + dx : CX - 1 - dx;
  }

  lset(dx, y, ramp, tone = -1) {
    this.sp.set(this.X(dx), y, ramp, tone);
  }

  lspan(dx0, dx1, y, ramp, tone = -1) {
    if (dx1 < dx0) [dx0, dx1] = [dx1, dx0];
    for (let d = dx0; d <= dx1; d++) this.lset(d, y, ramp, tone);
  }

  ldot(dx, y, color) {
    this.sp.dot(this.X(dx), y, color);
  }

  llimb(dx0, y0, dx1, y1, w, ramp, tone = -1) {
    const vertical = Math.abs(y1 - y0) >= Math.abs(dx1 - dx0);
    this.sp._bresenham(dx0, y0, dx1, y1, (x, y) => {
      for (let k = 0; k < w; k++) {
        if (vertical) this.lset(x - k, y, ramp, tone);
        else this.lset(x, y + k, ramp, tone);
      }
    });
  }

  paint() {
    if (this.anim === 'sleep' || this.anim === 'down') return this.paintLying();
    if (this.view === 'side') this.paintSide();
    else this.paintFrontBack(this.view === 'up');
    return this.sp;
  }

  // ---------------------------------------------------------------- front/back
  paintFrontBack(back) {
    const { a, g, p, sp } = this;
    const by = p.bob;
    const uy = by - p.breath;
    const T = g.headTop + uy + p.headDy + (p.lean < 0 && this.anim === 'hurt' ? -1 : 0);
    const th = g.torso;
    // Right arm sits on screen left when facing us, screen right from behind.
    const rightOnLeft = !back;

    // 1. things behind the body
    if (a.cloak && !back) this.cloakBackFront(uy, by);
    if (!back) this.hairBackFront(T, uy);
    if (back && !p.hideItem) this.armAndItem('R', rightOnLeft, uy, by, back, 'itemOnly');
    if (back && p.twoHand) this.armAndItem('L', !rightOnLeft, uy, by, back, 'itemOnly');

    // 2. legs and feet
    this.legsFront(by, back);

    // 3. torso and outfit
    this.torsoFront(uy, by, back);

    // 4. arms (with items in hand)
    this.armAndItem('L', !rightOnLeft, uy, by, back);
    this.armAndItem('R', rightOnLeft, uy, by, back);

    // 5. head
    this.headFront(T, back);

    // 6. cloak over the shoulders / on the back
    if (a.cloak) {
      if (back) this.cloakBackView(uy, by);
      else this.cloakMantleFront(uy);
    }
    if (back) this.hairBackView(T, uy);
    this.headwear(T, back);
    if (this.lateItem) {
      const { hx, hy, out } = this.lateItem;
      this.drawItem(hx, hy, out, back, false);
      sp.begin({ shadow: 'all' });
      for (const [x, y] of this.lateHands) {
        if (p.twoHand || (x === hx && y === hy)) sp.rect(x, y, g.armW, 2, a.skin);
      }
    }
    this.glows(back);
    return sp;
  }

  legsFront(by, back) {
    const { a, g, p, sp } = this;
    const legTop = g.hipY + 1 + by;
    const dress = a.outfit === 'dress' || a.outfit === 'robe';
    const legRamp = a.skeleton ? a.skin : a.outfit === 'robe' ? a.shoes : a.bottom;
    for (let i = 0; i < 2; i++) {
      const lg = i === 0 ? p.legA : p.legB;
      const x0 = g.legs[i];
      const w = g.legW;
      sp.begin({ band: 1 });
      if (p.sit) {
        // thighs point at the viewer: short legs, knees catching the light
        const kneeY = g.footY - 2;
        for (let y = legTop; y <= kneeY; y++) sp.span(x0, x0 + w - 1, y, legRamp);
        sp.begin({});
        sp.span(x0, x0 + w - 1, g.footY - 1, a.shoes);
        sp.span(x0, x0 + w - 1, g.footY, a.shoes);
        continue;
      }
      const footBottom = g.footY - lg.lift;
      if (a.skeleton) {
        const bx = x0 + (i === 0 ? 1 : w - 2);
        for (let y = legTop; y <= footBottom - 1; y++) sp.set(bx, y, legRamp, y === legTop + 2 ? 2 : -1);
        sp.begin({});
        sp.span(bx - (i === 0 ? 1 : 0), bx + (i === 0 ? 0 : 1), footBottom, a.skin);
        continue;
      }
      for (let y = legTop; y <= footBottom - 2; y++) sp.span(x0, x0 + w - 1, y, dress ? a.shoes : legRamp);
      sp.begin({});
      const shoeW = w;
      sp.span(x0, x0 + shoeW - 1, footBottom - 1, a.shoes);
      sp.span(x0, x0 + shoeW - 1, footBottom, a.shoes);
      if (!back) sp.shadeAt(i === 0 ? x0 : x0, footBottom - 1, 2);
    }
  }

  torsoFront(uy, by, back) {
    const { a, g, p, sp } = this;
    const top = g.shoulderY + uy;
    const bottom = g.hipY + by;
    const rows = bottom - top + 1;
    const halfAt = (y) => {
      const i = Math.max(0, Math.min(g.torso.length - 1, y - top - (rows - g.torso.length)));
      return g.torso[i];
    };
    if (a.skeleton) return this.ribcageFront(top, bottom, back);
    sp.begin({ band: g.torso[0] >= 5 ? 2 : 1 });
    for (let y = top; y <= bottom; y++) {
      const h = halfAt(y);
      sp.span(CX - h, CX + h - 1, y, a.top);
    }
    // belly bulge on stout builds
    if (g.belly) {
      sp.span(CX - 5, CX + 4, g.waistY + by - 1, a.top);
      sp.set(CX - 6, g.waistY + by - 1, a.top);
    }
    const waist = g.waistY + by;
    const h0 = g.torso[0];
    // neckline / collar detail
    if (!back && a.outfit !== 'armor') {
      if (a.outfit === 'robe') {
        sp.dot(CX - 1, top, a.accent[2]);
        sp.dot(CX, top, a.accent[1]);
        sp.dot(CX - 1, top + 1, a.accent[1]);
      } else {
        sp.dot(CX - 1, top, a.skin[1]);
        sp.dot(CX, top, a.skin[0]);
        if (a.outfit === 'tunic' || a.outfit === 'trousers') sp.dot(CX - 1, top + 1, a.top[0]);
      }
    }
    switch (a.outfit) {
      case 'tunic': {
        // hem flares over the hips, belt at the waist
        sp.begin({ band: 1 });
        sp.span(CX - halfAt(bottom) - 1, CX + halfAt(bottom), bottom + 1, a.top);
        if (a.accent && !back) {
          sp.begin({ flat: true, shadow: 'none' });
          sp.set(CX - 1, top + 2, a.accent, 1);
          sp.set(CX - 1, top + 3, a.accent, 0);
        }
        this.belt(waist, halfAt(waist), back);
        break;
      }
      case 'trousers': {
        this.belt(waist + 1, halfAt(waist + 1), back);
        if (a.accent && !back && a.key === 'tobias') {
          // suspenders
          sp.begin({ flat: true });
          for (let y = top + 1; y < waist + 1; y++) {
            sp.set(CX - 3, y, a.accent, 1);
            sp.set(CX + 2, y, a.accent, 0);
          }
        }
        break;
      }
      case 'dress':
      case 'robe': {
        const end = a.outfit === 'robe' ? g.footY - 1 : g.footY - 2;
        sp.begin({ band: 1 });
        for (let y = waist + 1; y <= end; y++) {
          const t = (y - waist) / (end - waist);
          const h = halfAt(waist) + Math.round(t * (a.outfit === 'robe' ? 2 : 2.5));
          sp.span(CX - h, CX + h - 1, y, a.outfit === 'robe' ? a.top : a.bottom);
        }
        // folds
        if (!back) {
          sp.shadeAt(CX - 2, end - 1, 0);
          sp.shadeAt(CX + 1, end - 2, 0);
          sp.shadeAt(CX + 1, end - 1, 0);
        }
        if (a.outfit === 'robe') {
          const sash = a.sash || a.accent;
          sp.begin({ band: 1 });
          sp.span(CX - halfAt(waist), CX + halfAt(waist) - 1, waist, sash);
          if (!back) {
            sp.set(CX - 2, waist + 1, sash);
            sp.set(CX - 2, waist + 2, sash);
            sp.set(CX - 1, waist + 1, sash, 0);
          }
        } else {
          this.belt(waist, halfAt(waist), back, true);
        }
        break;
      }
      case 'apron': {
        // a dress under a long apron, or a smith's apron over trousers
        sp.begin({ band: 1 });
        const end = a.skirt ? g.footY - 2 : g.hipY + by + 4;
        if (a.skirt) {
          for (let y = waist + 1; y <= end; y++) {
            const t = (y - waist) / (end - waist);
            const h = halfAt(waist) + Math.round(t * 2);
            sp.span(CX - h, CX + h - 1, y, a.bottom);
          }
        }
        if (!back) {
          sp.begin({ band: 1 });
          for (let y = top + 2; y <= end - 1; y++) {
            const h = y <= waist ? 2 : 3;
            sp.span(CX - h, CX + h - 1, y, a.apron);
          }
          sp.begin({ flat: true, shadow: 'none' });
          sp.set(CX - 3, top + 1, a.apron, 2);
          sp.set(CX + 2, top + 1, a.apron, 1);
          sp.set(CX - 3, top, a.apron, 2);
          sp.set(CX + 2, top, a.apron, 1);
          sp.begin({ flat: true });
          sp.span(CX - 2, CX + 1, waist, a.accent, 1);
          sp.set(CX - 1, waist + 3, a.apron, 0);
          sp.set(CX, waist + 3, a.apron, 0);
        } else {
          sp.begin({ flat: true });
          sp.span(CX - halfAt(waist), CX + halfAt(waist) - 1, waist, a.apron, 1);
          sp.set(CX - 1, waist + 1, a.apron, 2);
          sp.set(CX, waist + 1, a.apron, 2);
          sp.set(CX - 2, waist + 2, a.apron, 1);
          sp.set(CX + 1, waist + 2, a.apron, 1);
        }
        break;
      }
      case 'armor': {
        const ar = a.armorRamp;
        sp.begin({ band: 2 });
        for (let y = top + 1; y <= waist - 1; y++) {
          const h = halfAt(y) - (y === top + 1 ? 1 : 0);
          sp.span(CX - h, CX + h - 1, y, ar);
        }
        if (!back) {
          sp.begin({ flat: true, shadow: 'none' });
          for (let y = top + 2; y <= waist - 2; y++) sp.set(CX - 1, y, ar, 2);
          sp.set(CX, top + 2, ar, 0);
          if (a.rust) {
            sp.dot(CX + 2, top + 4, '#7d4a32');
            sp.dot(CX - 3, top + 3, '#6b412a');
          }
        }
        this.belt(waist, halfAt(waist), back);
        // tabard flap
        if (a.tabard) {
          sp.begin({ band: 1 });
          for (let y = waist + 1; y <= waist + 4; y++) sp.span(CX - 2, CX + 1, y, a.tabard);
          sp.set(CX - 1, waist + 5, a.tabard, 0);
          sp.set(CX, waist + 5, a.tabard, 0);
        }
        break;
      }
      default:
        break;
    }
    if (a.quiver && back) {
      // quiver across the back with fletchings over the shoulder
      sp.begin({ band: 1 });
      sp.limb(CX + 1, top - 2, CX - 2, waist, 2, LEATHER);
      sp.begin({ flat: true });
      sp.dot(CX + 1, top - 3, '#e0dccf');
      sp.dot(CX + 2, top - 3, '#ab3a45');
      sp.dot(CX + 2, top - 2, '#e0dccf');
    }
    void h0;
  }

  ribcageFront(top, bottom, back) {
    const { a, sp, g } = this;
    const bone = a.skin;
    sp.begin({ flat: false });
    // spine
    for (let y = top; y <= bottom; y++) sp.set(CX - 1, y, bone, back ? 2 : 1);
    if (!back) for (let y = top; y <= bottom; y++) sp.set(CX, y, bone, 0);
    // ribs: alternating rows, the gaps stay open
    for (let y = top + 1; y <= g.waistY - 1; y += 2) {
      const h = y < top + 4 ? 4 : 3;
      sp.span(CX - h, CX + h - 1, y, bone);
    }
    // collarbones
    sp.span(CX - 4, CX + 3, top, bone);
    // pelvis + a scrap of old cloth
    sp.begin({ band: 1 });
    sp.span(CX - 3, CX + 2, g.waistY + 1, bone);
    sp.begin({ band: 1 });
    sp.span(CX - 4, CX + 3, g.hipY, a.bottom);
    sp.span(CX - 4, CX + 2, g.hipY + 1, a.bottom);
    sp.set(CX - 3, g.hipY + 2, a.bottom, 0);
    sp.set(CX + 1, g.hipY + 2, a.bottom, 0);
  }

  belt(y, h, back, thin = false) {
    const { a, sp } = this;
    sp.begin({ flat: true, shadow: 'top' });
    for (let x = CX - h; x <= CX + h - 1; x++) sp.set(x, y, a.belt, x === CX - h ? 2 : x === CX + h - 1 ? 0 : 1);
    if (!back && !thin) {
      sp.dot(CX - 1, y, a.key === 'lyra' ? '#e6e9f2' : GOLD[2]);
      sp.dot(CX, y, a.key === 'lyra' ? '#a3a8b8' : GOLD[1]);
    }
    if (a.key === 'lyra' && !back) {
      // a little pouch on the hip
      sp.begin({ band: 1 });
      sp.set(CX + h - 2, y + 1, LEATHER);
      sp.set(CX + h - 1, y + 1, LEATHER);
      sp.set(CX + h - 2, y + 2, LEATHER);
      sp.set(CX + h - 1, y + 2, LEATHER);
    }
  }

  // Shoulder anchor and rest hand for one arm.
  armGeom(onLeft, uy) {
    const { g } = this;
    const h = g.torso[0];
    const x = onLeft ? CX - h - g.armW : CX + h;
    return { sx: x, sy: g.shoulderY + uy, restY: g.hipY - 1 + uy, out: onLeft ? -1 : 1 };
  }

  armAndItem(which, onLeft, uy, by, back, mode = 'all') {
    const { a, g, p, sp } = this;
    const off = which === 'R' ? p.armR : p.armL;
    const geo = this.armGeom(onLeft, uy);
    let hx = geo.sx + off.fx * geo.out;
    let hy = geo.restY + off.fy;
    if (p.twoHand && which === 'L') {
      // both hands on one handle: the left hand sits just below the right one
      const r = this.armGeom(!onLeft, uy);
      hx = r.sx + p.armR.fx * r.out + (onLeft ? -0 : 0);
      hy = r.restY + p.armR.fy + 2;
      hx = Math.max(Math.min(hx, CX + 4), CX - 6);
    }
    const showItem = which === 'R' && !p.hideItem && (p.tool || a.held !== 'none');
    if (mode === 'itemOnly') {
      if (which === 'R' && showItem) this.drawItem(hx, hy, geo.out, back, true);
      return;
    }
    const sleeve = a.skeleton ? a.skin : a.outfit === 'armor' ? a.top : a.top;
    sp.begin({ band: 0 });
    if (a.skeleton) {
      sp.line(geo.sx + (onLeft ? 1 : 0), geo.sy + 1, hx + (onLeft ? 1 : 0), hy - 1, a.skin);
    } else {
      sp.limb(geo.sx, geo.sy, hx, hy - 1, g.armW, sleeve);
      if (a.outfit === 'robe' && hy >= geo.sy + 4) {
        // wide sleeve cuffs
        sp.set(onLeft ? hx - 1 : hx + g.armW, hy - 1, sleeve);
      }
    }
    // Items held in front are painted last (over hair and mantle); remember the hand.
    if (!back && which === 'R' && showItem) this.lateItem = { hx, hy, out: geo.out };
    if (!back) this.lateHands.push([hx, hy]);
    sp.begin({ shadow: 'all' });
    sp.rect(hx, hy, g.armW, 2, a.skin);
    if (a.skeleton) {
      sp.begin({});
      sp.set(hx, hy, a.skin);
    }
    if (back && which === 'R' && showItem && p.item && p.item[1] > 0) this.drawItem(hx, hy, geo.out, back, false);
  }

  drawItem(hx, hy, out, back, behind) {
    const { a, p, sp, g } = this;
    const kind = p.tool || a.held;
    if (kind === 'none') return;
    const gx = out < 0 ? hx : hx + g.armW - 1;
    const gy = hy + 1;
    if (kind === 'book') {
      sp.begin({ band: 1 });
      const bx = out < 0 ? hx - 1 : hx;
      const color = clothRamp(a.bookColor || 'wine');
      sp.rect(bx, hy - 1, 3, 4, color);
      sp.begin({ flat: true });
      if (!back) {
        sp.set(out < 0 ? bx + 2 : bx, hy, ['#e8e0cc', '#e8e0cc', '#e8e0cc'], 1);
        sp.set(out < 0 ? bx + 2 : bx, hy + 1, ['#c8bea8', '#c8bea8', '#c8bea8'], 1);
      }
      return;
    }
    let [u, v] = p.item || this.restItemDir(kind);
    const sx = u * out; // outward to screen
    const { ax, ay, cx, cy } = axisSteps(sx, v);
    const short = !p.item && kind === 'sword' && this.view !== 'side' ? 3 : 0;
    const pix = itemPixels(kind, a, { bowDraw: p.bowDraw, short });
    sp.begin({ shadow: 'none', thinLight: true });
    for (const [k, j, ramp, tone, isString] of pix) {
      const x = gx + ax * k + cx * j;
      const y = gy + ay * k + cy * j;
      if (behind && sp.isSet(x, y)) continue;
      if (isString) sp.dot(x, y, ramp[1]);
      else sp.set(x, y, ramp, tone);
    }
    if (p.smear && !behind) this.smearArc(gx, gy, p.smear, out, kind);
    if (kind === 'staff' && a.staffCrystal && p.crystal > 0) this.crystalGlow(gx + ax * 8 + cx * 0, gy + ay * 8, p.crystal);
  }

  restItemDir(kind) {
    const side = this.view === 'side';
    switch (kind) {
      case 'staff':
      case 'hoe':
        return [0, -1];
      case 'bow':
        return [1, 0];
      case 'sword':
        return side ? [1, 1] : [0, 1];
      default:
        return [0, 1];
    }
  }

  smearArc(gx, gy, sm, out, kind) {
    const { sp } = this;
    const r = kind === 'dagger' ? 5 : kind === 'hammer' ? 6 : 8;
    const a0 = Math.atan2(sm[1], sm[0] * out);
    let a1 = Math.atan2(sm[3], sm[2] * out);
    let d = a1 - a0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    sp.begin({ flat: true, noOutline: true, shadow: 'none' });
    const steps = 9;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ang = a0 + d * t;
      for (const rr of [r - 1, r]) {
        const x = Math.round(gx + Math.cos(ang) * rr);
        const y = Math.round(gy + Math.sin(ang) * rr);
        if (sp.isSet(x, y)) continue;
        sp.dot(x, y, rr === r ? '#ffffff' : '#dfe8ff', 0.25 + 0.45 * t);
      }
    }
    void a1;
  }

  crystalGlow(x, y, level) {
    const color = this.a.glowColor;
    glow(this.sp, x, y, 2.5 + level * 1.5, color, 0.45 + level * 0.15);
    this.sp.begin({ flat: true, noOutline: true, shadow: 'none' });
    this.sp.dot(x, y - 1, '#ffffff', 1);
    if (level > 1) {
      this.sp.dot(x - 3, y - 3, '#e8e2ff', 0.8);
      this.sp.dot(x + 3, y - 2, '#e8e2ff', 0.7);
    }
  }

  glows(back) {
    const { p } = this;
    if (!p.glowL && !p.glowR) return;
    // glowing palms (cast); hand positions recomputed from the pose
    for (const which of ['L', 'R']) {
      const level = which === 'L' ? p.glowL : p.glowR;
      if (!level) continue;
      const onLeft = which === 'R' ? !back : back;
      const geo = this.armGeom(onLeft, p.bob - p.breath);
      const off = which === 'R' ? p.armR : p.armL;
      const hx = geo.sx + off.fx * geo.out + 0.5 + (this.g.armW - 1) / 2;
      const hy = geo.restY + off.fy;
      this.handGlow(hx, hy, level);
    }
  }

  handGlow(x, y, level) {
    const color = this.a.glowColor;
    glow(this.sp, x, y, 2 + level * 1.6, color, 0.5 + level * 0.15);
    this.sp.begin({ flat: true, noOutline: true, shadow: 'none' });
    this.sp.dot(Math.floor(x), Math.floor(y) - 1, '#ffffff', 0.95);
    if (level > 1) {
      this.sp.dot(Math.floor(x) - 2, Math.floor(y) - 3, '#efeaff', 0.85);
      this.sp.dot(Math.floor(x) + 2, Math.floor(y) - 4, '#efeaff', 0.7);
      this.sp.dot(Math.floor(x), Math.floor(y) - 5, '#ffffff', 0.6);
    }
  }

  sitHandsOverKnees() {}

  // ---------------------------------------------------------------- head (front/back)
  headFront(T, back) {
    const { a, sp } = this;
    // ears first so the head overlaps them
    const showEars = a.hairStyle === 'short' || a.hairStyle === 'bald' || a.hairStyle === 'ponytail' || a.hairStyle === 'bun';
    if (showEars && !a.skeleton) {
      sp.begin({});
      sp.set(CX - 6, T + 5, a.skin, 1);
      sp.set(CX - 6, T + 6, a.skin, 0);
      sp.set(CX + 5, T + 5, a.skin, 1);
      sp.set(CX + 5, T + 6, a.skin, 0);
      if (a.earrings && !back) {
        sp.dot(CX - 6, T + 7, a.earrings);
        sp.dot(CX + 5, T + 7, a.earrings);
      }
    }
    if (a.skeleton) return this.skullFront(T, back);
    sp.begin({ shadow: 'all' });
    for (let r = 0; r < 10; r++) {
      const h = HEAD_ROWS[r];
      sp.span(CX - h, CX + h - 1, T + r, a.skin);
    }
    if (!back) {
      // soft shading on the right cheek and under the chin
      for (let r = 4; r < 9; r++) sp.shadeAt(CX + HEAD_ROWS[r] - 1, T + r, 0);
      sp.shadeAt(CX - 4, T + 8, 1);
      this.face(T);
    }
    this.hairFront(T, back);
  }

  face(T) {
    const { a, p, sp } = this;
    sp.begin({ flat: true, shadow: 'none' });
    const ey = T + 5;
    const big = a.eyeStyle === 'big';
    const iris = big ? mixHex(a.eyes, EYE_DARK, 0.3) : a.eyes;
    const irisLight = big ? lighten(a.eyes, 0.3) : lighten(iris, 0.35);
    const lx = big ? CX - 4 : CX - 3;
    const rx = big ? CX + 2 : CX + 2;
    const face = p.face;
    if (face === 'closed' || face === 'ko') {
      sp.dot(lx, ey + 1, EYE_DARK);
      sp.dot(rx + (big ? 1 : 0), ey + 1, EYE_DARK);
      if (big) {
        sp.dot(lx + 1, ey + 1, EYE_DARK);
        sp.dot(rx, ey + 1, EYE_DARK);
      }
    } else if (face === 'hurt') {
      // squeezed shut: > <
      sp.dot(lx, ey, EYE_DARK);
      sp.dot(lx + 1, ey + 1, EYE_DARK);
      sp.dot(rx + 1, ey, EYE_DARK);
      sp.dot(rx, ey + 1, EYE_DARK);
    } else if (face === 'squint') {
      sp.dot(lx, ey + 1, EYE_DARK);
      sp.dot(lx + (big ? 1 : 0), ey + 1, EYE_DARK);
      sp.dot(rx, ey + 1, EYE_DARK);
      sp.dot(rx + (big ? 1 : 0), ey + 1, EYE_DARK);
    } else if (big) {
      for (const x of [lx, rx]) {
        sp.dot(x, ey, EYE_DARK);
        sp.dot(x + 1, ey, EYE_DARK);
        sp.dot(x, ey + 1, iris);
        sp.dot(x + 1, ey + 1, irisLight);
      }
      // lashes flicking outward
      if (a.lashes) {
        sp.dot(lx - 1, ey, EYE_DARK);
        sp.dot(rx + 2, ey, EYE_DARK);
      }
      if (face === 'focus') {
        sp.dot(lx, ey - 1, a.hair[0]);
        sp.dot(lx + 1, ey - 1, a.hair[0]);
        sp.dot(rx, ey - 1, a.hair[0]);
        sp.dot(rx + 1, ey - 1, a.hair[0]);
      }
    } else {
      sp.dot(lx, ey, EYE_DARK);
      sp.dot(lx, ey + 1, iris === '#2a2130' ? EYE_DARK : iris);
      sp.dot(rx, ey, EYE_DARK);
      sp.dot(rx, ey + 1, iris === '#2a2130' ? EYE_DARK : iris);
      if (face === 'focus') {
        sp.dot(lx - 1, ey - 1, a.hair[0]);
        sp.dot(lx, ey - 1, a.hair[0]);
        sp.dot(rx, ey - 1, a.hair[0]);
        sp.dot(rx + 1, ey - 1, a.hair[0]);
      }
    }
    // nose shadow, mouth, blush
    sp.dot(CX, T + 7, a.skin[0]);
    const lip = mixHex(a.skin[0], '#9e2133', 0.35);
    if (p.mouth === 'open' || face === 'hurt') {
      sp.dot(CX - 1, T + 8, '#4a1a24');
      sp.dot(CX, T + 8, '#6b2430');
    } else if (face === 'ko') {
      sp.dot(CX - 1, T + 8, lip);
      sp.dot(CX, T + 8, lip);
    } else {
      sp.dot(CX - 1, T + 8, lip);
      if (a.build !== 'child' && a.eyeStyle !== 'big') sp.dot(CX, T + 8, lip);
    }
    if (a.blush) {
      sp.dot(CX - 4, T + 7, mixHex(a.skin[1], '#e06a7a', 0.45));
      sp.dot(CX + 3, T + 7, mixHex(a.skin[1], '#e06a7a', 0.45));
    }
    if (a.freckles) {
      sp.dot(CX - 3, T + 7, a.skin[0]);
      sp.dot(CX + 2, T + 7, a.skin[0]);
    }
    if (a.wrinkles) {
      sp.dot(CX - 5, T + 6, a.skin[0]);
      sp.dot(CX + 4, T + 6, a.skin[0]);
    }
    if (a.scar) {
      sp.dot(CX + 2, T + 4, '#c4706a');
      sp.dot(CX + 3, T + 6, '#c4706a');
      sp.dot(CX + 3, T + 7, '#c4706a');
    }
    if (a.mask) {
      sp.begin({ band: 1 });
      for (let r = 7; r <= 9; r++) {
        const h = HEAD_ROWS[r];
        sp.span(CX - h, CX + h - 1, T + r, a.mask);
      }
      sp.set(CX - 5, T + 7, a.mask);
      sp.set(CX + 4, T + 7, a.mask);
      sp.set(CX - 1, T + 10, a.mask, 0);
    }
    if (a.mustache) {
      sp.begin({ shadow: 'none' });
      sp.span(CX - 2, CX + 1, T + 7, a.mustache);
      sp.set(CX - 3, T + 8, a.mustache);
      sp.set(CX + 2, T + 8, a.mustache);
    }
    if (a.beard) {
      sp.begin({ band: 1 });
      sp.span(CX - 4, CX + 3, T + 8, a.beard);
      sp.span(CX - 4, CX + 3, T + 9, a.beard);
      sp.span(CX - 3, CX + 2, T + 10, a.beard);
      sp.span(CX - 2, CX + 1, T + 11, a.beard);
      sp.set(CX - 5, T + 7, a.beard);
      sp.set(CX + 4, T + 7, a.beard);
      sp.begin({ flat: true, shadow: 'none' });
      sp.dot(CX - 1, T + 8, mixHex(a.skin[0], '#4a1a24', 0.5));
      sp.dot(CX, T + 8, mixHex(a.skin[0], '#4a1a24', 0.5));
    }
    if (a.glasses) {
      sp.begin({ flat: true, shadow: 'none' });
      const frame = '#6b5a4a';
      const glass = '#cfe6f0';
      for (const x of [lx - 1, rx - 1]) {
        sp.dot(x, ey - 1, frame);
        sp.dot(x + 1, ey - 1, frame);
        sp.dot(x + 2, ey - 1, frame);
        sp.dot(x, ey, frame);
        sp.dot(x + 2, ey, frame);
        sp.dot(x + 1, ey + 2, frame);
      }
      sp.dot(lx + 2, ey, frame);
      sp.dot(CX - 1, ey, frame);
      sp.dot(lx, ey - 1, glass);
    }
    if (a.eyepatch) {
      sp.begin({ flat: true, shadow: 'none' });
      sp.dot(CX - 4, ey, '#1a1423');
      sp.dot(CX - 3, ey, '#1a1423');
      sp.dot(CX - 4, ey + 1, '#24212c');
      sp.dot(CX - 3, ey + 1, '#24212c');
      sp.dot(CX - 5, ey - 1, '#24212c');
      sp.dot(CX - 2, ey - 1, '#24212c');
      sp.dot(CX - 1, ey - 2, '#24212c');
    }
  }

  skullFront(T, back) {
    const { a, sp } = this;
    sp.begin({ shadow: 'all' });
    const rows = [3, 4, 5, 5, 5, 5, 4, 4, 3, 3];
    for (let r = 0; r < 10; r++) {
      const h = rows[r];
      if (r === 7 && !back) continue;
      sp.span(CX - h, CX + h - 1, T + r, a.skin);
    }
    if (back) return;
    sp.begin({ flat: true, shadow: 'none' });
    // sockets with a faint ember glow
    for (const x of [CX - 4, CX + 1]) {
      sp.dot(x, T + 4, '#241c26');
      sp.dot(x + 1, T + 4, '#241c26');
      sp.dot(x, T + 5, '#241c26');
      sp.dot(x + 1, T + 5, a.eyes);
    }
    sp.dot(CX - 1, T + 6, '#3a2c30');
    sp.dot(CX, T + 6, '#3a2c30');
    // teeth
    sp.begin({});
    for (let x = CX - 3; x <= CX + 2; x++) sp.dot(x, T + 7, x % 2 ? a.skin[2] : '#3a2c30');
    sp.begin({});
    sp.span(CX - 3, CX + 2, T + 8, a.skin);
    sp.dot(CX - 4, T + 2, a.skin[2]);
    sp.dot(CX + 2, T + 7, a.skin[0]);
    // a crack
    sp.dot(CX + 2, T + 1, a.skin[0]);
    sp.dot(CX + 3, T + 2, a.skin[0]);
  }

  hairBackFront(T, uy) {
    const { a, sp, g } = this;
    if (a.hairStyle !== 'long' && a.hairStyle !== 'curly') return;
    sp.begin({ band: 1 });
    const bottom = a.hairStyle === 'curly' ? T + 11 : g.shoulderY + uy + 4;
    for (let y = T + 4; y <= bottom; y++) {
      const t = (y - T - 4) / Math.max(1, bottom - T - 4);
      const h = 6 - Math.round(t * 1);
      sp.span(CX - h, CX + h - 1, y, a.hair);
    }
    sp.shadeAt(CX - 6, bottom, 0);
    sp.shadeAt(CX + 5, bottom, 0);
  }

  hairFront(T, back) {
    const { a, p, sp } = this;
    const style = a.hairStyle;
    if (style === 'hood' || style === 'bald') {
      if (style === 'bald' && !back) {
        sp.begin({ flat: true, shadow: 'none' });
        sp.dot(CX - 3, T + 1, lighten(a.skin[2], 0.3));
        sp.dot(CX - 2, T + 1, lighten(a.skin[2], 0.2));
        if (a.wrinkles) {
          // a fringe of hair around the ears
          sp.begin({});
          sp.set(CX - 5, T + 4, a.hair);
          sp.set(CX - 5, T + 5, a.hair);
          sp.set(CX + 4, T + 4, a.hair);
          sp.set(CX + 4, T + 5, a.hair);
        }
      }
      return;
    }
    if (back) return; // hair seen from behind is painted after the cloak
    const fr = FRINGES[style] || FRINGES.short;
    sp.begin({ shadow: 'top', band: 1 });
    for (let c = 0; c < 10; c++) {
      const x = CX - 5 + c;
      const depth = fr[c];
      const startRow = c === 0 || c === 9 ? 2 : c === 1 || c === 8 ? 1 : 0;
      for (let r = startRow; r < depth; r++) sp.set(x, T + r, a.hair);
    }
    if (style === 'curly') {
      // puffy outline and curl texture
      sp.span(CX - 4, CX + 3, T - 1, a.hair);
      for (let r = 2; r < 7; r++) {
        sp.set(CX - 6, T + r, a.hair);
        sp.set(CX + 5, T + r, a.hair);
      }
      sp.begin({ flat: true, shadow: 'none' });
      for (const [x, y] of [
        [-3, 0],
        [0, 1],
        [2, 0],
        [-5, 3],
        [4, 4],
        [-1, 2],
      ])
        sp.dot(CX + x, T + y, a.hair[2]);
    }
    if (style === 'long') {
      // long side locks framing the face
      sp.begin({ shadow: 'top', band: 0 });
      const sway = p.sway;
      for (let r = 3; r <= 12; r++) {
        const dx = r > 9 ? sway : 0;
        sp.set(CX - 6 + dx, T + r, a.hair);
        sp.set(CX - 5 + dx, T + r, a.hair);
        if (r <= 9 || a.braid !== 'left') {
          sp.set(CX + 4 + dx, T + r, a.hair);
          sp.set(CX + 5 + dx, T + r, a.hair);
        }
      }
      sp.set(CX - 5 + sway, T + 13, a.hair, 0);
    }
    if (style === 'ponytail') {
      sp.begin({});
      sp.set(CX + 5, T + 4, a.hair);
      sp.set(CX + 5, T + 5, a.hair);
      sp.set(CX + 6, T + 6, a.hair);
      sp.set(CX + 6, T + 7, a.hair, 0);
    }
    if (style === 'bun') {
      sp.begin({ shadow: 'none' });
      sp.ellipse(CX, T - 1, 2.6, 2.1, a.hair);
    }
    if (style === 'braid' && a.braid !== 'left') {
      sp.begin({});
      this.braidStrand(CX + 4, T + 7, CX + 5, T + 13, a.hair);
    }
    // shine on the crown
    sp.begin({ flat: true, shadow: 'none' });
    const shine = lighten(a.hair[2], 0.28);
    sp.dot(CX - 3, T + 1, shine);
    sp.dot(CX - 2, T + 1, shine);
    sp.dot(CX - 4, T + 2, a.hair[2]);
    sp.dot(CX + 1, T + 1, a.hair[2]);
    // Lyra's braid over her left shoulder and the silver crescent pin
    if (a.braid === 'left') {
      sp.begin({ shadow: 'none' });
      this.braidStrand(CX + 4, T + 4, CX + 4 + p.sway, T + 14, a.hair);
      if (a.hairpin) this.crescent(CX + 3, T + 2, false);
    }
  }

  // A braid: alternating light/dark diagonal plaits, tied with a silver band.
  braidStrand(x0, y0, x1, y1, ramp) {
    const { sp } = this;
    const n = y1 - y0;
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / Math.max(1, n));
      const y = y0 + i;
      const w = i < n - 1 ? 2 : 1;
      for (let k = 0; k < w; k++) sp.set(x + k, y, ramp, (i + k) % 2 === 0 ? 2 : 0);
    }
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(Math.round(x1), y1 - 1, '#d6d8e6');
    sp.dot(Math.round(x1) + 1, y1 - 1, '#9a9cb0');
    sp.begin({});
    sp.set(Math.round(x1), y1 + 1, ramp, 1);
  }

  crescent(x, y, mirror) {
    const { sp } = this;
    sp.begin({ flat: true, shadow: 'none' });
    const m = mirror ? -1 : 1;
    sp.dot(x, y, '#e6e9f2');
    sp.dot(x + m, y, '#ffffff');
    sp.dot(x + m * 2, y + 1, '#c9cede');
    sp.dot(x - m * 0, y + 1, '#a3a8b8');
  }

  hairBackView(T, uy) {
    const { a, p, sp, g } = this;
    const style = a.hairStyle;
    if (style === 'hood') return;
    if (style === 'bald') {
      if (a.wrinkles) {
        sp.begin({});
        sp.span(CX - 5, CX + 4, T + 5, a.hair);
      }
      return;
    }
    sp.begin({ shadow: 'all', band: 1 });
    for (let r = 0; r < 10; r++) {
      const h = HEAD_ROWS[r] + (style === 'curly' && r > 0 && r < 8 ? 1 : 0);
      if (r >= 8 && (style === 'short' || style === 'bun' || style === 'ponytail')) {
        sp.span(CX - h + 1, CX + h - 2, T + r, a.hair);
        continue;
      }
      sp.span(CX - h, CX + h - 1, T + r, a.hair);
    }
    if (style === 'long' || style === 'curly') {
      const bottom = style === 'long' ? g.shoulderY + uy + 6 : T + 12;
      for (let y = T + 10; y <= bottom; y++) {
        const t = (y - T - 10) / Math.max(1, bottom - T - 10);
        const h = 5 - Math.round(t * 1.6);
        const dx = y > bottom - 3 ? p.sway : 0;
        sp.span(CX - h + dx, CX + h - 1 + dx, y, a.hair);
      }
      // a soft V at the tips
      sp.erase(CX - 1 + p.sway, bottom);
      sp.erase(CX + p.sway, bottom);
      // strands catching the light, and the shadowed parting between locks
      sp.begin({ flat: true, shadow: 'none' });
      const hl = lighten(a.hair[2], 0.12);
      for (let y = T + 2; y < bottom - 1; y++) {
        const k = y - T;
        if (k % 4 === 0 || k % 4 === 1) sp.detail(CX - 3, y, hl);
        if (k % 5 === 2) sp.detail(CX + 2, y, a.hair[2]);
        if (k > 4) sp.detail(CX - 1, y, a.hair[0]);
      }
    }
    if (style === 'ponytail' || style === 'braid') {
      sp.begin({ band: 0 });
      if (style === 'ponytail') {
        for (let y = T + 7; y <= T + 14; y++) sp.span(CX - 1 + (y > T + 11 ? p.sway : 0), CX + (y > T + 11 ? p.sway : 0), y, a.hair);
        sp.begin({ flat: true });
        sp.dot(CX - 1, T + 7, '#ab3a45');
        sp.dot(CX, T + 7, '#7a2232');
      } else {
        this.braidStrand(CX - 1, T + 8, CX - 1 + p.sway, T + 16, a.hair);
      }
    }
    if (style === 'bun') {
      sp.begin({ shadow: 'none' });
      sp.ellipse(CX, T + 1, 2.6, 2.1, a.hair);
    }
    sp.begin({ flat: true, shadow: 'none' });
    sp.dot(CX - 3, T + 1, lighten(a.hair[2], 0.25));
    sp.dot(CX - 2, T + 2, a.hair[2]);
    if (a.braid === 'left') {
      // from behind, her left side is screen left
      sp.begin({ shadow: 'none' });
      this.braidStrand(CX - 5, T + 5, CX - 5 + p.sway, T + 15, a.hair);
      if (a.hairpin) this.crescent(CX - 4, T + 3, true);
    }
  }

  headwear(T, back) {
    const { a, sp } = this;
    if (a.hoodUp && a.hood) {
      const hood = a.hood;
      sp.begin({ band: 1, shadow: 'top' });
      for (let r = -1; r < 10; r++) {
        const h = r < 0 ? 3 : r === 0 ? 4 : r < 9 ? 6 : 6;
        for (let x = CX - h; x <= CX + h - 1; x++) {
          // keep the face open from the front
          if (!back && r >= 3 && x >= CX - 4 && x <= CX + 3) continue;
          if (!back && r === 2 && x >= CX - 3 && x <= CX + 2) continue;
          sp.set(x, T + r, hood);
        }
      }
      // drape over the shoulders
      for (let x = CX - 6; x <= CX + 5; x++) sp.set(x, T + 10, hood);
      sp.span(CX - 5, CX + 4, T + 11, hood);
      if (!back) {
        sp.begin({ flat: true, shadow: 'none' });
        // shadow cast by the hood brim onto the face
        for (let x = CX - 4; x <= CX + 3; x++) sp.detail(x, T + 3, this.a.skin[0]);
      } else {
        sp.shadeAt(CX - 1, T + 9, 0);
        sp.shadeAt(CX, T + 8, 0);
      }
      return;
    }
    if (a.hat) {
      const hat = a.hat;
      if (a.hatStyle === 'brim') {
        sp.begin({ band: 1, shadow: 'top' });
        sp.span(CX - 7, CX + 6, T + 2, hat);
        sp.span(CX - 6, CX + 5, T + 3, hat, 0);
        sp.begin({ band: 1 });
        for (let r = -2; r <= 1; r++) sp.span(CX - 4, CX + 3, T + r, hat);
        sp.begin({ flat: true });
        sp.span(CX - 4, CX + 3, T + 1, ['#7a2232', '#7a2232', '#7a2232'], 1);
      } else {
        // a soft cap with a feather
        sp.begin({ band: 1, shadow: 'top' });
        for (let r = -1; r <= 2; r++) sp.span(CX - 5 + (r < 0 ? 1 : 0), CX + 4 - (r < 0 ? 1 : 0), T + r, hat);
        sp.span(CX - 6, CX + 1, T + 3, hat);
        sp.begin({ flat: true, shadow: 'none' });
        const fx = back ? CX - 4 : CX + 3;
        sp.dot(fx, T - 2, '#e8e0cc');
        sp.dot(fx + 1, T - 3, '#e8e0cc');
        sp.dot(fx + 1, T - 4, '#c9b98a');
        sp.dot(fx + 2, T - 5, '#e8e0cc');
      }
    }
    if (a.headband) {
      sp.begin({ flat: true, shadow: 'none' });
      for (let x = CX - 5; x <= CX + 4; x++) sp.set(x, T + 3, a.headband, x < CX - 2 ? 2 : 1);
      if (!back) {
        sp.dot(CX + 3, T + 2, '#f0d8e8');
        sp.dot(CX + 4, T + 2, '#e8a0c0');
      } else {
        sp.dot(CX - 1, T + 4, a.headband[0]);
        sp.dot(CX, T + 5, a.headband[0]);
      }
    }
  }

  // Cloak seen from the front: the back panel peeks out around the body.
  cloakBackFront(uy, by) {
    const { a, g, p, sp } = this;
    const top = g.shoulderY + uy + 1;
    const bottom = g.footY - 3;
    const lining = a.cloakLining || a.cloak;
    sp.begin({ band: 1 });
    for (let y = top; y <= bottom; y++) {
      const t = (y - top) / (bottom - top);
      const h = g.torso[0] + g.armW + Math.round(t * 1.5);
      const dx = y > bottom - 3 ? p.sway : 0;
      sp.span(CX - h + dx, CX + h - 1 + dx, y, a.cloak);
      // the lining shows where the cloak turns in beside the legs
      if (y > g.hipY + uy) {
        sp.set(CX - h + dx + 1, y, lining, 1);
        sp.set(CX + h - 2 + dx, y, lining, 0);
      }
    }
    void by;
  }

  cloakMantleFront(uy) {
    const { a, g, sp } = this;
    const top = g.shoulderY + uy - 1;
    const h = g.torso[0] + g.armW;
    sp.begin({ band: 1, shadow: 'all' });
    for (let r = 0; r <= 3; r++) {
      const w = r === 0 ? h - 2 : h + (r >= 2 ? 1 : 0);
      for (let x = CX - w; x <= CX + w - 1; x++) {
        // open in the middle below the clasp
        if (r >= 2 && x >= CX - 2 && x <= CX + 1) continue;
        sp.set(x, top + r, a.cloak);
      }
    }
    // the cloak's front edges fall down the sides of the chest
    for (let y = top + 4; y <= g.waistY + uy; y++) {
      sp.set(CX - h, y, a.cloak);
      sp.set(CX + h - 1, y, a.cloak, 0);
    }
    if (a.cloakTrim) {
      sp.begin({ flat: true, shadow: 'none' });
      for (let x = CX - h - 1; x <= CX + h; x++) {
        if (x >= CX - 2 && x <= CX + 1) continue;
        sp.set(x, top + 3, a.cloakTrim, x < CX ? 2 : 1);
      }
      sp.set(CX - 3, top + 2, a.cloakTrim, 2);
      sp.set(CX + 2, top + 2, a.cloakTrim, 1);
    }
    // clasp
    sp.begin({ flat: true, shadow: 'none' });
    const metal = a.cloakTrim ? '#e6e9f2' : GOLD[2];
    sp.dot(CX - 1, top + 1, metal);
    sp.dot(CX, top + 1, a.cloakTrim ? '#a3a8b8' : GOLD[1]);
  }

  cloakBackView(uy, by) {
    const { a, g, p, sp } = this;
    const top = g.shoulderY + uy - 1;
    const bottom = g.footY - 3 + (by > 0 ? 0 : 0);
    sp.begin({ band: 2 });
    for (let y = top; y <= bottom; y++) {
      const t = (y - top) / (bottom - top);
      const h = g.torso[0] + g.armW + (y === top ? -1 : 0) + Math.round(t * 1.5);
      const dx = y > bottom - 3 ? p.sway : 0;
      sp.span(CX - h + dx, CX + h - 1 + dx, y, a.cloak);
    }
    // folds
    sp.begin({ flat: true, shadow: 'none' });
    for (let y = top + 6; y <= bottom - 1; y++) {
      sp.dot(CX - 3, y, a.cloak[0]);
      if (y > top + 8) sp.dot(CX + 2, y, a.cloak[0]);
    }
    if (a.cloakTrim) {
      const h = g.torso[0] + g.armW + 1;
      for (let x = CX - h + p.sway; x <= CX + h - 1 + p.sway; x++) sp.dot(x, bottom, x < CX ? a.cloakTrim[2] : a.cloakTrim[1]);
    }
    // folded hood at the nape
    sp.begin({ band: 1 });
    sp.span(CX - 3, CX + 2, top, a.cloak);
    sp.span(CX - 2, CX + 1, top + 1, a.cloakLining || a.cloak);
  }

  // ---------------------------------------------------------------- side view
  paintSide() {
    const { a, g, p, sp } = this;
    const by = p.bob;
    const uy = by - p.breath;
    const lean = p.lean;
    const T = g.headTop + uy + p.headDy;
    const nearIsRight = this.s > 0;
    const farArm = nearIsRight ? 'L' : 'R';
    const nearArm = nearIsRight ? 'R' : 'L';

    // far side, back to front
    if (a.cloak) this.cloakSideBack(uy, by, lean);
    if (a.hairStyle === 'long' || a.hairStyle === 'curly') this.hairSideBack(T, uy, lean);
    this.sideArm(farArm, uy, lean, true);
    this.sideLeg(p.legB, by, true);
    this.sideLeg(p.legA, by, false);
    this.sideTorso(uy, by, lean);
    this.sideHead(T, lean);
    if (a.braid === 'left' && !nearIsRight) {
      sp.begin({ shadow: 'none' });
      const bx = this.X(lean - 1);
      const bx2 = this.X(lean - 1 + (p.sway > 0 ? 1 : 0));
      this.braidStrand(Math.min(bx, bx), T + 5, Math.min(bx2, bx2), T + 14, a.hair);
      if (a.hairpin) this.crescent(this.X(lean + 0), T + 3, this.s < 0);
    }
    if (a.cloak) this.cloakSideMantle(uy, lean);
    this.sideArm(nearArm, uy, lean, false);
    this.sideHeadwear(T, lean);
    this.sideGlows(uy, lean, nearArm, farArm);
  }

  sideLeg(leg, by, far) {
    const { a, g, p, sp } = this;
    const legTop = g.hipY + 1 + by;
    const ramp0 = a.skeleton ? a.skin : a.outfit === 'robe' ? a.shoes : a.bottom;
    const ramp = far ? [darken(ramp0[0], 0.25), ramp0[0], ramp0[1]] : ramp0;
    const shoes = far ? [darken(a.shoes[0], 0.25), a.shoes[0], a.shoes[1]] : a.shoes;
    const w = Math.max(2, g.legW - 1);
    const hipDx = far ? -1 : 0;
    sp.begin({ band: 1 });
    if (p.sit) {
      // thigh forward, shin down
      const kneeDx = 4;
      for (let dx = hipDx - 1; dx <= kneeDx; dx++) {
        this.lset(dx, legTop - 1, ramp);
        this.lset(dx, legTop, ramp);
      }
      for (let y = legTop + 1; y <= g.footY - 1; y++) this.lspan(kneeDx - 1, kneeDx, y, ramp);
      sp.begin({});
      this.lspan(kneeDx - 1, kneeDx + 2, g.footY, shoes);
      this.lspan(kneeDx - 1, kneeDx + 1, g.footY - 1, shoes);
      return;
    }
    const footBottom = g.footY - leg.lift;
    const fdx = leg.dx + hipDx;
    if (a.skeleton) {
      this.llimb(hipDx, legTop, fdx, footBottom - 1, 1, ramp);
      sp.begin({});
      this.lspan(fdx - 1, fdx + 1, footBottom, a.skin);
      return;
    }
    const dress = a.outfit === 'dress' || a.outfit === 'robe' || (a.outfit === 'apron' && a.skirt);
    this.llimb(hipDx, legTop, fdx, footBottom - 2, w, dress ? shoes : ramp);
    sp.begin({});
    this.lspan(fdx - w + 1, fdx + 1, footBottom, shoes);
    this.lspan(fdx - w + 1, fdx, footBottom - 1, shoes);
  }

  sideTorso(uy, by, lean) {
    const { a, g, p, sp } = this;
    const top = g.shoulderY + uy;
    const bottom = g.hipY + by;
    const [t0, t1] = g.sideTorso;
    const waist = g.waistY + by;
    if (a.skeleton) {
      sp.begin({});
      for (let y = top; y <= bottom; y++) this.lset(t0 + 1 + lean, y, a.skin, 1);
      for (let y = top + 1; y < waist; y += 2) this.lspan(t0 + 1 + lean, t1 + lean, y, a.skin);
      this.lspan(t0 + 1, t1, top, a.skin);
      sp.begin({ band: 1 });
      this.lspan(t0, t1, g.hipY, a.bottom);
      this.lspan(t0, t1 - 1, g.hipY + 1, a.bottom);
      return;
    }
    sp.begin({ band: 1 });
    for (let y = top; y <= bottom; y++) {
      const l = y < waist - 1 ? lean : 0;
      const chest = y > top && y < top + 3 && g.build !== 'child' ? 1 : 0;
      this.lspan(t0 + l, t1 + l + (y === top ? -1 : chest > 0 && a.build === 'slim' ? 0 : 0), y, a.top);
    }
    if (g.belly) for (let y = waist - 2; y <= waist; y++) this.lset(t1 + 1, y, a.top);
    const hem = a.outfit;
    if (hem === 'tunic') {
      sp.begin({ band: 1 });
      this.lspan(t0 - 1, t1 + 1, bottom + 1, a.top);
      this.beltSide(waist, t0, t1);
    } else if (hem === 'trousers') {
      this.beltSide(waist + 1, t0, t1);
      if (a.key === 'tobias') {
        sp.begin({ flat: true });
        for (let y = top + 1; y <= waist; y++) this.lset(t0 + 2, y, a.accent, 1);
      }
    } else if (hem === 'dress' || hem === 'robe' || hem === 'apron') {
      const end = hem === 'robe' ? g.footY - 1 : hem === 'apron' && !a.skirt ? g.hipY + by + 4 : g.footY - 2;
      sp.begin({ band: 1 });
      for (let y = waist + 1; y <= end && (hem !== 'apron' || a.skirt); y++) {
        const t = (y - waist) / (end - waist);
        const grow = Math.round(t * 2);
        this.lspan(t0 - grow, t1 + grow, y, hem === 'robe' ? a.top : a.bottom);
      }
      if (hem === 'robe') {
        sp.begin({ flat: true });
        this.lspan(t0, t1, waist, a.sash || a.accent, 1);
        this.lset(t0 - 1, waist + 1, a.sash || a.accent, 0);
        this.lset(t0 - 1, waist + 2, a.sash || a.accent, 0);
      } else this.beltSide(waist, t0, t1, true);
      if (hem === 'apron') {
        sp.begin({ band: 0 });
        for (let y = top + 2; y <= end - 1; y++) this.lset(t1 + (y > waist ? 1 + Math.round(((y - waist) / (end - waist)) * 2) : 0), y, a.apron);
        sp.begin({ flat: true });
        this.lset(t0, waist, a.apron, 2);
        this.lset(t0 - 1, waist + 1, a.apron, 1);
      }
    } else if (hem === 'armor') {
      sp.begin({ band: 1 });
      for (let y = top + 1; y < waist; y++) this.lspan(t0 + lean, t1 + 1 + lean, y, a.armorRamp);
      sp.begin({ flat: true });
      this.lset(t1 + lean, top + 2, a.armorRamp, 2);
      this.beltSide(waist, t0, t1);
      if (a.tabard) {
        sp.begin({ band: 1 });
        for (let y = waist + 1; y <= waist + 4; y++) this.lspan(t1 - 1, t1, y, a.tabard);
      }
    }
    if (a.quiver) {
      sp.begin({ band: 1 });
      this.llimb(t0 - 1, top - 2, t0 - 1, waist, 2, LEATHER);
      sp.begin({ flat: true });
      this.ldot(t0 - 1, top - 3, '#e0dccf');
      this.ldot(t0 - 2, top - 3, '#ab3a45');
    }
    if (a.key === 'lyra') {
      sp.begin({ band: 1 });
      this.lset(t1, waist + 1, LEATHER);
      this.lset(t1, waist + 2, LEATHER);
    }
  }

  beltSide(y, t0, t1, thin = false) {
    const { a, sp } = this;
    sp.begin({ flat: true, shadow: 'top' });
    this.lspan(t0, t1, y, a.belt, 1);
    if (!thin) this.ldot(t1, y, a.key === 'lyra' ? '#e6e9f2' : GOLD[2]);
  }

  sideHead(T, lean) {
    const { a, p, sp } = this;
    const L = lean;
    if (a.skeleton) return this.skullSide(T, L);
    sp.begin({ shadow: 'all' });
    for (let r = 0; r < 10; r++) {
      const [d0, d1] = SIDE_HEAD[r];
      this.lspan(d0 + L, d1 + L, T + r, a.skin);
    }
    // nose
    this.lset(4 + L, T + 6, a.skin, 1);
    this.lset(3 + L, T + 7, a.skin, 0);
    sp.begin({ flat: true, shadow: 'none' });
    const ey = T + 5;
    const big = a.eyeStyle === 'big';
    if (p.face === 'closed' || p.face === 'ko' || p.face === 'squint') {
      this.ldot(1 + L, ey + 1, EYE_DARK);
      if (big) this.ldot(2 + L, ey + 1, EYE_DARK);
    } else if (p.face === 'hurt') {
      this.ldot(1 + L, ey, EYE_DARK);
      this.ldot(2 + L, ey + 1, EYE_DARK);
    } else {
      this.ldot(1 + L, ey, EYE_DARK);
      this.ldot(1 + L, ey + 1, a.eyes === '#2a2130' ? EYE_DARK : a.eyes);
      if (big) {
        this.ldot(2 + L, ey, EYE_DARK);
        this.ldot(2 + L, ey + 1, lighten(a.eyes, 0.35));
        if (a.lashes) this.ldot(3 + L, ey - 1, EYE_DARK);
      }
      if (p.face === 'focus') this.ldot(2 + L, ey - 1, a.hair[0]);
    }
    const lip = mixHex(a.skin[0], '#9e2133', 0.35);
    this.ldot(2 + L, T + 8, p.mouth === 'open' ? '#4a1a24' : lip);
    if (a.blush) this.ldot(L, T + 7, mixHex(a.skin[1], '#e06a7a', 0.45));
    if (a.scar) {
      this.ldot(0 + L, T + 4, '#c4706a');
      this.ldot(1 + L, T + 7, '#c4706a');
    }
    if (a.mask) {
      sp.begin({ band: 1 });
      for (let r = 7; r <= 9; r++) this.lspan(-1 + L, SIDE_HEAD[r][1] + L + (r === 7 ? 1 : 0), T + r, a.mask);
      this.lset(4 + L, T + 7, a.mask);
    }
    if (a.beard) {
      sp.begin({ band: 1 });
      for (let r = 7; r <= 10; r++) this.lspan(-2 + L + (r > 9 ? 1 : 0), 3 + L - (r > 8 ? 1 : 0), T + r, a.beard);
    } else if (a.mustache) {
      sp.begin({});
      this.lspan(2 + L, 3 + L, T + 7, a.mustache);
    }
    if (a.glasses) {
      sp.begin({ flat: true, shadow: 'none' });
      this.ldot(0 + L, ey - 1, '#6b5a4a');
      this.ldot(1 + L, ey - 1, '#6b5a4a');
      this.ldot(2 + L, ey - 1, '#6b5a4a');
      this.ldot(2 + L, ey, '#cfe6f0');
      this.ldot(-1 + L, ey, '#6b5a4a');
      this.ldot(-2 + L, ey, '#6b5a4a');
    }
    if (a.eyepatch && this.s > 0) {
      // the patch covers the right eye, which faces us when looking right
      sp.begin({ flat: true, shadow: 'none' });
      this.ldot(1 + L, ey, '#1a1423');
      this.ldot(1 + L, ey + 1, '#24212c');
      this.ldot(2 + L, ey, '#1a1423');
    }
    if (a.eyepatch && this.s < 0) {
      sp.begin({ flat: true, shadow: 'none' });
      this.ldot(1 + L, ey - 2, '#24212c');
      this.ldot(0 + L, ey - 2, '#24212c');
    }
    this.sideHair(T, L);
  }

  skullSide(T, L) {
    const { a, sp } = this;
    sp.begin({ shadow: 'all' });
    for (let r = 0; r < 9; r++) {
      const [d0, d1] = SIDE_HEAD[r];
      if (r === 7) continue;
      this.lspan(d0 + L, d1 + L - (r > 6 ? 1 : 0), T + r, a.skin);
    }
    this.lspan(-2 + L, 2 + L, T + 8, a.skin);
    sp.begin({ flat: true, shadow: 'none' });
    this.ldot(1 + L, T + 4, '#241c26');
    this.ldot(2 + L, T + 4, '#241c26');
    this.ldot(1 + L, T + 5, a.eyes);
    this.ldot(2 + L, T + 5, '#241c26');
    this.ldot(3 + L, T + 6, '#3a2c30');
    for (let d = -1; d <= 3; d++) this.ldot(d + L, T + 7, d % 2 ? a.skin[2] : '#3a2c30');
  }

  hairSideBack(T, uy, lean) {
    const { a, p, sp, g } = this;
    sp.begin({ band: 1 });
    const bottom = a.hairStyle === 'curly' ? T + 11 : g.shoulderY + uy + 5;
    for (let y = T + 5; y <= bottom; y++) {
      const t = (y - T - 5) / Math.max(1, bottom - T - 5);
      const sw = y > bottom - 3 ? -Math.abs(p.sway) : 0;
      this.lspan(-6 + lean + sw - Math.round(t), -2 + lean, y, a.hair);
    }
  }

  sideHair(T, L) {
    const { a, p, sp } = this;
    const style = a.hairStyle;
    if (style === 'bald') {
      sp.begin({ flat: true, shadow: 'none' });
      this.ldot(-1 + L, T + 1, lighten(a.skin[2], 0.25));
      this.ldot(0 + L, T + 1, lighten(a.skin[2], 0.15));
      if (a.wrinkles) {
        sp.begin({});
        this.lspan(-4 + L, -2 + L, T + 4, a.hair);
        this.lspan(-4 + L, -3 + L, T + 5, a.hair);
      }
      sp.begin({});
      this.lset(-1 + L, T + 5, a.skin, 1);
      this.lset(-1 + L, T + 6, a.skin, 0);
      return;
    }
    if (style === 'hood') return;
    sp.begin({ shadow: 'top', band: 1 });
    // crown and back of the head
    for (let r = 0; r < 3; r++) {
      const [d0, d1] = SIDE_HEAD[r];
      this.lspan(d0 + L, d1 + L, T + r, a.hair);
    }
    const backTo = style === 'long' || style === 'curly' ? -1 : -2;
    for (let r = 3; r < 9; r++) {
      const [d0] = SIDE_HEAD[r];
      this.lspan(d0 + L, backTo + L, T + r, a.hair);
    }
    // fringe over the brow
    this.lspan(0 + L, 3 + L, T + 3, a.hair);
    this.lset(2 + L, T + 4, a.hair);
    this.lset(3 + L, T + 4, a.hair);
    if (style !== 'long' && style !== 'curly') {
      // ear
      sp.begin({});
      this.lset(-1 + L, T + 5, a.skin, 2);
      this.lset(-1 + L, T + 6, a.skin, 1);
      if (a.earrings) this.ldot(-1 + L, T + 7, a.earrings);
    }
    if (style === 'curly') {
      sp.begin({});
      this.lspan(-4 + L, 1 + L, T - 1, a.hair);
      for (let r = 2; r < 8; r++) this.lset(-6 + L, T + r, a.hair);
    }
    if (style === 'ponytail') {
      sp.begin({ band: 0 });
      const sw = p.sway;
      this.lspan(-7 + L, -5 + L, T + 4, a.hair);
      this.lspan(-8 + L, -6 + L, T + 5, a.hair);
      for (let y = T + 6; y <= T + 10; y++) this.lspan(-8 + L + (y > T + 8 ? -Math.abs(sw) : 0), -7 + L, y, a.hair);
      sp.begin({ flat: true });
      this.ldot(-6 + L, T + 4, '#ab3a45');
    }
    if (style === 'braid') {
      sp.begin({});
      this.braidStrand(this.X(-6 + L), T + 6, this.X(-6 + L - Math.abs(p.sway)), T + 13, a.hair);
    }
    if (style === 'bun') {
      sp.begin({ shadow: 'none' });
      sp.ellipse(this.X(-5 + L) + 0.5, T + 1, 2.4, 2, a.hair);
    }
    sp.begin({ flat: true, shadow: 'none' });
    this.ldot(-1 + L, T + 1, lighten(a.hair[2], 0.28));
    this.ldot(0 + L, T + 1, lighten(a.hair[2], 0.2));
    this.ldot(-2 + L, T + 2, a.hair[2]);
  }

  sideHeadwear(T, L) {
    const { a, sp } = this;
    if (a.hoodUp && a.hood) {
      sp.begin({ band: 1, shadow: 'top' });
      for (let r = -1; r < 11; r++) {
        const d0 = r < 0 ? -3 : r < 1 ? -5 : -6;
        const d1 = r < 0 ? 1 : r < 3 ? 3 : 0;
        this.lspan(d0 + L, d1 + L, T + r, a.hood);
      }
      this.lspan(-5 + L, 1 + L, T + 11, a.hood);
      // brim edge
      sp.begin({ flat: true, shadow: 'none' });
      this.ldot(3 + L, T + 2, a.hood[2]);
      this.ldot(1 + L, T + 3, a.skin[0]);
      this.ldot(2 + L, T + 3, a.skin[0]);
      return;
    }
    if (a.hat) {
      if (a.hatStyle === 'brim') {
        sp.begin({ band: 1, shadow: 'top' });
        this.lspan(-7 + L, 6 + L, T + 2, a.hat);
        sp.begin({ band: 1 });
        for (let r = -2; r <= 1; r++) this.lspan(-4 + L, 2 + L, T + r, a.hat);
        sp.begin({ flat: true });
        this.lspan(-4 + L, 2 + L, T + 1, ['#7a2232', '#7a2232', '#7a2232'], 1);
      } else {
        sp.begin({ band: 1, shadow: 'top' });
        for (let r = -1; r <= 2; r++) this.lspan(-5 + L, 3 + L, T + r, a.hat);
        this.lspan(-2 + L, 5 + L, T + 3, a.hat);
        sp.begin({ flat: true, shadow: 'none' });
        this.ldot(-5 + L, T - 2, '#e8e0cc');
        this.ldot(-6 + L, T - 3, '#e8e0cc');
        this.ldot(-7 + L, T - 4, '#c9b98a');
      }
    }
    if (a.headband) {
      sp.begin({ flat: true, shadow: 'none' });
      for (let d = -5; d <= 3; d++) this.lset(d + L, T + 3, a.headband, 1);
      this.ldot(-6 + L, T + 4, a.headband[0]);
    }
  }

  cloakSideBack(uy, by, lean) {
    const { a, g, p, sp } = this;
    const top = g.shoulderY + uy;
    const bottom = g.footY - 3;
    const [t0] = g.sideTorso;
    const moving = this.anim === 'walk';
    sp.begin({ band: 1 });
    for (let y = top; y <= bottom; y++) {
      const t = (y - top) / (bottom - top);
      const flare = Math.round(t * (moving ? 3 : 1.5)) + (y > bottom - 3 ? Math.abs(p.sway) : 0);
      this.lspan(t0 - 1 - flare + lean, t0 + 2, y, a.cloak);
    }
    if (a.cloakTrim) {
      sp.begin({ flat: true, shadow: 'none' });
      const flare = Math.round(moving ? 3 : 1.5) + Math.abs(p.sway);
      this.lspan(t0 - 1 - flare + lean, t0 + 2, bottom, a.cloakTrim, 1);
    }
    void by;
  }

  cloakSideMantle(uy, lean) {
    const { a, g, sp } = this;
    const top = g.shoulderY + uy - 1;
    const [t0, t1] = g.sideTorso;
    sp.begin({ band: 1 });
    this.lspan(t0 + lean, t1 - 1 + lean, top, a.cloak);
    this.lspan(t0 - 1 + lean, t1 + lean, top + 1, a.cloak);
    this.lspan(t0 - 1 + lean, t1 + lean, top + 2, a.cloak);
    this.lspan(t0 - 1 + lean, t1 - 1 + lean, top + 3, a.cloak);
    if (a.cloakTrim) {
      sp.begin({ flat: true, shadow: 'none' });
      this.lspan(t0 - 1 + lean, t1 - 1 + lean, top + 3, a.cloakTrim, 1);
      this.ldot(t1 + lean, top + 1, '#e6e9f2');
    } else {
      sp.begin({ flat: true, shadow: 'none' });
      this.ldot(t1 + lean, top + 1, GOLD[2]);
    }
  }

  sideArm(which, uy, lean, far) {
    const { a, g, p, sp } = this;
    const off = which === 'R' ? p.armR : p.armL;
    let fx = off.fx;
    let fy = off.fy;
    if (p.twoHand && which === 'L') {
      fx = p.armR.fx;
      fy = p.armR.fy + 2;
    }
    const sx = -1 + lean + (far ? -0 : 0);
    const sy = g.shoulderY + uy;
    const hx = sx + fx;
    const hy = g.hipY - 1 + uy + fy;
    const sleeve0 = a.skeleton ? a.skin : a.top;
    const sleeve = far ? [darken(sleeve0[0], 0.25), sleeve0[0], sleeve0[1]] : sleeve0;
    const skin = far ? [darken(a.skin[0], 0.2), a.skin[0], a.skin[1]] : a.skin;
    const holds = which === 'R' && !p.hideItem && (p.tool || a.held !== 'none');
    const itemBehind = holds && far;
    if (itemBehind) this.sideItem(hx, hy, true);
    sp.begin({ band: 0 });
    if (a.skeleton) this.llimb(sx, sy + 1, hx, hy - 1, 1, sleeve);
    else this.llimb(sx + 1, sy, hx + 1, hy - 1, g.armW, sleeve);
    if (holds && !far) this.sideItem(hx, hy, false);
    sp.begin({});
    this.lspan(hx, hx + 1, hy, skin);
    this.lspan(hx, hx + 1, hy + 1, skin);
    if (holds && !far && (p.tool === 'book' || a.held === 'book')) this.sideItem(hx, hy, false);
  }

  sideItem(hx, hy, far) {
    const { a, p, sp } = this;
    const kind = p.tool || a.held;
    if (kind === 'none') return;
    if (kind === 'book') {
      sp.begin({ band: 1 });
      const color = clothRamp(a.bookColor || 'wine');
      for (let y = hy - 1; y <= hy + 2; y++) this.lspan(hx + 1, hx + 2, y, color);
      sp.begin({ flat: true });
      this.ldot(hx + 2, hy, '#e8e0cc');
      return;
    }
    const [u, v] = p.item || this.restItemDir(kind);
    const gdx = hx + 1;
    const gy = hy + 1;
    const ax = Math.sign(u);
    const ay = Math.sign(v);
    const crossDx = ax === 0 ? 1 : 0;
    const crossDy = ax === 0 ? 0 : 1;
    const short = !p.item && kind === 'sword' && this.view !== 'side' ? 3 : 0;
    const pix = itemPixels(kind, a, { bowDraw: p.bowDraw, short });
    sp.begin({ shadow: 'none', thinLight: true });
    const darkenFar = (ramp) => (far ? [darken(ramp[0], 0.2), ramp[0], ramp[1]] : ramp);
    for (const [k, j, ramp, tone, isString] of pix) {
      // forward is local; the cross axis keeps the shadow side on screen right/down
      const ldx = gdx + ax * k + (crossDx ? j * this.s : 0);
      const y = gy + ay * k + crossDy * j;
      const x = this.X(ldx);
      if (isString) sp.dot(x, y, ramp[1]);
      else sp.set(x, y, darkenFar(ramp), tone);
    }
    if (p.smear && !far) {
      const gx = this.X(gdx);
      this.smearArc(gx, gy, p.smear, this.s, kind);
    }
    if (kind === 'staff' && a.staffCrystal && p.crystal > 0) this.crystalGlow(this.X(gdx + ax * 8), gy + ay * 8, p.crystal);
  }

  sideGlows(uy, lean, nearArm, farArm) {
    const { p, g } = this;
    for (const which of ['L', 'R']) {
      const level = which === 'L' ? p.glowL : p.glowR;
      if (!level) continue;
      const off = which === 'R' ? p.armR : p.armL;
      const hx = this.X(-1 + lean + off.fx + 1);
      const hy = g.hipY - 1 + uy + off.fy;
      this.handGlow(hx + (this.s > 0 ? 1 : 0), hy, level);
    }
    void nearArm;
    void farArm;
  }

  // ---------------------------------------------------------------- lying down
  // Paint the figure standing, then rotate the unshaded buffers a quarter turn so
  // shading is recomputed for the new orientation (light stays upper-left).
  paintLying() {
    const { a, p } = this;
    const stand = new Painter(a, 'idle', 0, 'down');
    stand.p = { ...basePose(), face: p.face, breath: p.breath, hideItem: true, armR: { fx: -1, fy: 0 }, armL: { fx: -1, fy: 0 } };
    stand.paintFrontBack(false);
    const src = stand.sp;
    const dst = this.sp;
    const shift = 7;
    dst.parts = src.parts.slice();
    dst.cur = src.cur;
    for (let y = 0; y < FRAME; y++) {
      for (let x = 0; x < FRAME; x++) {
        const i = y * FRAME + x;
        if (src.part[i] < 0) continue;
        // counter-clockwise: head to the left, feet to the right
        const nx = y;
        const ny = FRAME - 1 - x + shift;
        if (nx < 0 || ny < 0 || nx >= FRAME || ny >= FRAME) continue;
        const j = ny * FRAME + nx;
        dst.part[j] = src.part[i];
        dst.ramp[j] = src.ramp[i];
        dst.tone[j] = src.tone[i];
        dst.color[j] = src.color[i];
        dst.alpha[j] = src.alpha[i];
      }
    }
    if (this.anim === 'down' && a.held !== 'none' && a.held !== 'book') {
      // the weapon lies where it fell
      const kind = a.held;
      const pix = itemPixels(kind, a, {});
      dst.begin({ shadow: 'none', thinLight: true });
      for (const [k, j, ramp, tone, isString] of pix) {
        const x = 22 + k;
        const y = 17 + j;
        if (dst.isSet(x, y)) continue;
        if (isString) dst.dot(x, y, ramp[1]);
        else dst.set(x, y, ramp, tone);
      }
    }
    return dst;
  }
}

export function paintHumanoid(appearance, anim, dir, frame) {
  const a = appearance && appearance.skin && Array.isArray(appearance.skin) && appearance.top ? appearance : normalizeAppearance(appearance);
  const pt = new Painter(a, HUMANOID_ANIMS[anim] ? anim : 'idle', frame, DIRECTIONS.includes(dir) ? dir : 'down');
  return pt.paint();
}
