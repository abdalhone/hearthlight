import { makeCanvas, outline, fromRows, px } from './pixel.js';
import { OUTLINE } from './palette.js';

// Effect sprites, generated at boot (DESIGN.md "Art and the atlas", FX names):
//   fx:slash              5-frame sword arc facing right, anchor at the swing center
//   fx:slash:<dir>        the same arc for down | up | left | right
//   fx:bolt               4-frame arcane bolt (violet halo, white core), anchor center
//   fx:arrow              16 frames, frame i points i × 22.5° clockwise from right
//                         (use arrowFrameForAngle(radians)), anchor center
//   fx:spark              4-frame star burst, anchor center
//   fx:heal               4-frame rising green cross, anchor bottom-center
//   fx:icon:<name>        emote balloons for bubbles.icon(): ! ? heart zzz anger note sweat ...
//                         anchor = the balloon's tail tip (put it just above a head)

const TAU = Math.PI * 2;

export const ICON_NAMES = ['!', '?', 'heart', 'zzz', 'anger', 'note', 'sweat', '...'];

export function registerFxArt(atlas, rng) {
  registerSlash(atlas);
  registerBolt(atlas, rng);
  registerArrow(atlas);
  registerSpark(atlas);
  registerHeal(atlas);
  registerIcons(atlas);
}

// Index of the fx:arrow frame closest to a flight angle (radians, screen space).
export function arrowFrameForAngle(angle) {
  const step = TAU / 16;
  const a = ((angle % TAU) + TAU) % TAU;
  return Math.round(a / step) % 16;
}

// ------------------------------------------------------------------ slash

// Each frame shows part of a crescent sweeping clockwise from above to below
// (facing right). The leading edge is white-hot, the trailing part thin and pale.
const SLASH_FRAMES = [
  { from: -110, to: -40, thick: 2.2, bright: 1 },
  { from: -110, to: 35, thick: 4.2, bright: 1 },
  { from: -95, to: 100, thick: 5, bright: 0.95 },
  { from: -40, to: 105, thick: 3.2, bright: 0.7 },
  { from: 35, to: 108, thick: 1.6, bright: 0.45 },
];

function slashFrame(spec, size = 32, radius = 12.5) {
  const { canvas, ctx } = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const c = (size - 1) / 2;
  const a0 = (spec.from * Math.PI) / 180;
  const a1 = (spec.to * Math.PI) / 180;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = y - c;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      if (a < a0 || a > a1) continue;
      const u = (a - a0) / (a1 - a0); // 0 = trailing end, 1 = leading tip
      const th = spec.thick * Math.sin(Math.PI * Math.min(1, u * 1.05)) + 0.6;
      const inner = radius - th;
      if (r > radius + 0.5 || r < inner) continue;
      const depth = (radius - r) / Math.max(0.5, th); // 0 at the outer edge
      let col;
      let alpha;
      if (depth < 0.34) {
        col = [255, 255, 255];
        alpha = 1;
      } else if (depth < 0.7) {
        col = [221, 226, 245];
        alpha = 0.85;
      } else {
        col = [154, 160, 190];
        alpha = 0.55;
      }
      alpha *= spec.bright * (0.45 + 0.55 * u);
      const i = (y * size + x) * 4;
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
      d[i + 3] = Math.round(255 * Math.min(1, alpha));
    }
  }
  ctx.putImageData(img, 0, 0);
  if (spec.bright < 0.6) {
    // Fading frames leave a couple of glints along the arc.
    const tip = (spec.to * Math.PI) / 180;
    px(ctx, Math.round(c + Math.cos(tip) * (radius - 1)), Math.round(c + Math.sin(tip) * (radius - 1)), '#ffffff');
    const mid = ((spec.from + spec.to) / 2) * (Math.PI / 180);
    px(ctx, Math.round(c + Math.cos(mid) * (radius + 1)), Math.round(c + Math.sin(mid) * (radius + 1)), '#ddd2ff');
  }
  return canvas;
}

// Rotate a square canvas by quarter turns (exact on the pixel grid).
function rotateQuarter(src, turns) {
  const n = ((turns % 4) + 4) % 4;
  if (!n) return src;
  const { canvas, ctx } = makeCanvas(src.width, src.height);
  ctx.translate(src.width / 2, src.height / 2);
  ctx.rotate((n * Math.PI) / 2);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return canvas;
}

function registerSlash(atlas) {
  const right = SLASH_FRAMES.map((s) => slashFrame(s));
  const opts = { ox: 16, oy: 16, fps: 22 };
  atlas.add('fx:slash', right, opts);
  atlas.add('fx:slash:right', right, opts);
  atlas.add('fx:slash:down', right.map((f) => rotateQuarter(f, 1)), opts);
  atlas.add('fx:slash:left', right.map((f) => rotateQuarter(f, 2)), opts);
  atlas.add('fx:slash:up', right.map((f) => rotateQuarter(f, 3)), opts);
}

// ------------------------------------------------------------------ bolt

function registerBolt(atlas, rng) {
  const frames = [];
  const twinkle = [];
  for (let f = 0; f < 4; f++) twinkle.push(rng ? rng.next() * TAU : f * 1.3);
  for (let f = 0; f < 4; f++) {
    const { canvas, ctx } = makeCanvas(16, 16);
    const c = 7.5;
    const halo = f % 2 ? 6.6 : 7.2;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const r = Math.hypot(x - c, y - c);
        if (r > halo) continue;
        if (r <= 1.2) px(ctx, x, y, '#ffffff');
        else if (r <= 2.3) px(ctx, x, y, '#ddd2ff');
        else if (r <= 3.5) px(ctx, x, y, '#a995ff');
        else if (r <= 4.7) px(ctx, x, y, '#7a64e0');
        else if ((x + y + f) % 2 === 0) px(ctx, x, y, r <= 5.8 ? '#4f3db3' : '#33267a');
      }
    }
    // Orbiting motes so the bolt looks alive in flight.
    for (let k = 0; k < 3; k++) {
      const a = twinkle[f] + (k * TAU) / 3 + f * 0.6;
      px(ctx, Math.round(c + Math.cos(a) * 6), Math.round(c + Math.sin(a) * 6), '#ddd2ff');
    }
    frames.push(canvas);
  }
  atlas.add('fx:bolt', frames, { ox: 8, oy: 8, fps: 12 });
}

// ------------------------------------------------------------------ arrow

function registerArrow(atlas) {
  const frames = [];
  for (let i = 0; i < 16; i++) {
    const a = (i * TAU) / 16;
    const { canvas, ctx } = makeCanvas(16, 16);
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const cx = 7.5;
    const cy = 7.5;
    const at = (t) => [Math.round(cx + ux * t), Math.round(cy + uy * t)];
    // Shaft from the fletching to just behind the head.
    for (let t = -5.5; t <= 3.5; t += 0.5) {
      const [x, y] = at(t);
      px(ctx, x, y, t < -1 ? '#8c5a35' : '#ad7a48');
    }
    // Head: a bright tip with darker barbs.
    const perpX = -uy;
    const perpY = ux;
    const [hx, hy] = at(5.6);
    const [bx, by] = at(4.2);
    px(ctx, Math.round(bx + perpX), Math.round(by + perpY), '#6b707e');
    px(ctx, Math.round(bx - perpX), Math.round(by - perpY), '#6b707e');
    px(ctx, bx, by, '#9aa0ad');
    px(ctx, hx, hy, '#cfd4dc');
    // Fletching: two feathers angled back.
    const [fx, fy] = at(-5.8);
    const [gx, gy] = at(-4.6);
    px(ctx, Math.round(fx + perpX), Math.round(fy + perpY), '#f0eef5');
    px(ctx, Math.round(fx - perpX), Math.round(fy - perpY), '#ab3a45');
    px(ctx, Math.round(gx + perpX), Math.round(gy + perpY), '#c8c5d0');
    px(ctx, Math.round(gx - perpX), Math.round(gy - perpY), '#7a2232');
    frames.push(canvas);
  }
  atlas.add('fx:arrow', frames, { ox: 8, oy: 8, fps: 0 });
}

// ------------------------------------------------------------------ spark

const SPARK_ROWS = [
  ['.........', '.........', '.........', '....y....', '...ywy...', '....y....', '.........', '.........', '.........'],
  ['....o....', '....y....', '..c.y.c..', '....y....', 'oyyywyyyo', '....y....', '..c.y.c..', '....y....', '....o....'],
  ['....o....', '.........', '.c.....c.', '....o....', 'o..oyo..o', '....o....', '.c.....c.', '.........', '....o....'],
  ['.........', '....r....', '.........', '.........', '.r..o..r.', '.........', '.........', '....r....', '.........'],
];
const SPARK_MAP = { w: '#ffffff', y: '#ffe08a', o: '#ffb047', c: '#fff4c0', r: '#ee7f2d' };

function registerSpark(atlas) {
  const frames = SPARK_ROWS.map((rows) => {
    const { canvas, ctx } = makeCanvas(9, 9);
    fromRows(ctx, rows, SPARK_MAP);
    return canvas;
  });
  atlas.add('fx:spark', frames, { ox: 4, oy: 4, fps: 16 });
}

// ------------------------------------------------------------------ heal

const HEAL_CROSS = ['..aaa..', '..aba..', 'aaabaaa', 'abbbbbc', 'aaabcaa', '..aca..', '..aaa..'];
const HEAL_SMALL = ['.aaa.', 'aabaa', 'abbbc', 'aacaa', '.aaa.'];

function registerHeal(atlas) {
  const frames = [];
  for (let f = 0; f < 4; f++) {
    const { canvas, ctx } = makeCanvas(11, 13);
    const map = { a: '#2fa070', b: '#e8fff0', c: '#9ff0b8' };
    if (f === 0) fromRows(ctx, HEAL_SMALL, map, 3, 7);
    else fromRows(ctx, HEAL_CROSS, map, 2, 6 - f);
    outline(canvas, '#123d32');
    if (f === 2) {
      px(ctx, 9, 3, '#e8fff0');
      px(ctx, 1, 6, '#9ff0b8');
    }
    if (f === 3) px(ctx, 9, 1, '#9ff0b8');
    frames.push(canvas);
  }
  atlas.add('fx:heal', frames, { ox: 5, oy: 12, fps: 10 });
}

// ------------------------------------------------------------------ icons

// Glyphs drawn inside a cream emote balloon. 9 × 8 each; letters map to colors.
const GLYPHS = {
  '!': {
    map: { a: '#cc3a45', b: '#ff6b5e' },
    frames: [['...bba...', '...baa...', '...baa...', '....a....', '....a....', '.........', '...baa...', '...aaa...']],
  },
  '?': {
    map: { a: '#33497a', b: '#5e7fb6' },
    frames: [['..bbaaa..', '.ba...aa.', '......aa.', '....aaa..', '...aa....', '.........', '...ba....', '...aa....']],
  },
  heart: {
    map: { a: '#e0577a', b: '#ffc2d4', c: '#ad3a5c' },
    frames: [
      ['.aa...aa.', 'abaa.aaaa', 'abaaaaaaa', 'aaaaaaaac', '.aaaaaac.', '..aaaac..', '...aac...', '....c....'],
      ['.........', '..aa.aa..', '.abaaaaa.', '.aaaaaac.', '..aaaac..', '...aac...', '....c....', '.........'],
    ],
  },
  zzz: {
    map: { a: '#33497a', b: '#5e7fb6' },
    frames: [
      ['......bbb', '.......b.', '......bbb', 'aaaaa....', '...a.....', '..a......', '.a.......', 'aaaaa....'],
      ['.....bbb.', '......b..', '.....bbb.', '.aaaaa...', '....a....', '...a.....', '..a......', '.aaaaa...'],
    ],
  },
  anger: {
    map: { a: '#cc3a45', b: '#ff6b5e' },
    frames: [
      ['..b...b..', '..a...a..', 'ab.....ba', '.........', 'ab.....ba', '..a...a..', '..b...b..', '.........'],
      ['.........', '..b...b..', '.ab...ba.', '.........', '.ab...ba.', '..b...b..', '.........', '.........'],
    ],
  },
  note: {
    map: { a: '#47296a', b: '#6a4196' },
    frames: [
      ['....abbb.', '....a..ab', '....a...a', '....a....', '....a....', '.aaaa....', 'abbaa....', '.aaa.....'],
      ['.....abbb', '.....a..a', '.....a...', '.....a...', '.....a...', '..aaaa...', '.abbaa...', '..aaa....'],
    ],
  },
  sweat: {
    map: { a: '#4b9ac9', b: '#cfeeff', c: '#2f74ad' },
    frames: [['....a....', '...aa....', '..aaaa...', '.abaaaa..', '.abaaaa..', '.aaaaac..', '..aaac...', '...cc....']],
  },
  '...': {
    map: { a: '#38343f' },
    frames: [
      ['.........', '.........', '.........', 'aa.......', 'aa.......', '.........', '.........', '.........'],
      ['.........', '.........', '.........', 'aa.aa....', 'aa.aa....', '.........', '.........', '.........'],
      ['.........', '.........', '.........', 'aa.aa.aa.', 'aa.aa.aa.', '.........', '.........', '.........'],
    ],
  },
};

const BALLOON = '#f4ead7';
const BALLOON_SHADE = '#d9cdb5';

// A 15 × 14 emote balloon: rounded box with a tail pointing down at the speaker.
function balloon() {
  const { canvas, ctx } = makeCanvas(15, 14);
  ctx.fillStyle = BALLOON;
  ctx.fillRect(2, 1, 11, 10);
  ctx.fillRect(1, 2, 13, 8);
  ctx.fillRect(6, 11, 3, 1);
  ctx.fillRect(7, 12, 1, 1);
  ctx.fillStyle = BALLOON_SHADE;
  ctx.fillRect(2, 10, 11, 1);
  ctx.fillRect(13, 3, 1, 7);
  px(ctx, 2, 2, '#ffffff');
  px(ctx, 3, 2, '#ffffff');
  px(ctx, 2, 3, '#ffffff');
  outline(canvas, OUTLINE);
  return canvas;
}

function registerIcons(atlas) {
  for (const name of ICON_NAMES) {
    const g = GLYPHS[name];
    const frames = g.frames.map((rows) => {
      const c = balloon();
      fromRows(c.getContext('2d'), rows, g.map, 3, 2);
      return c;
    });
    const fps = name === '...' ? 3 : name === 'zzz' ? 2 : name === 'heart' ? 3 : 2.5;
    atlas.add(`fx:icon:${name}`, frames, { ox: 7, oy: 13, fps });
  }
}
