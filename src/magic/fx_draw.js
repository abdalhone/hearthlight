import { TAU, makeCanvas, ctx2d, rgbOf, hash } from './fx_util.js';

// Drawing primitives for the Weave's look. Everything is drawn in world pixels into a
// low-res buffer (the world buffer, or fx's glow buffer that is added after lighting),
// so a disc of radius 3 is a crisp pixel disc once the renderer upscales it.

// ------------------------------------------------------------------ dirty bounds

// The part of the glow buffer drawn this frame (only that part is composited).
export class Bounds {
  constructor() {
    this.reset();
  }

  reset() {
    this.x0 = Infinity;
    this.y0 = Infinity;
    this.x1 = -Infinity;
    this.y1 = -Infinity;
  }

  add(x, y, r) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const rr = r > 0 ? r : 0;
    if (x - rr < this.x0) this.x0 = x - rr;
    if (y - rr < this.y0) this.y0 = y - rr;
    if (x + rr > this.x1) this.x1 = x + rr;
    if (y + rr > this.y1) this.y1 = y + rr;
  }

  get empty() {
    return !(this.x1 >= this.x0);
  }
}

// ------------------------------------------------------------------ cached sprites

const discs = new Map();
// A filled pixel disc of radius r (integer, ≤ 14) in one color.
function discSprite(r, color) {
  const key = `${r}|${color}`;
  let c = discs.get(key);
  if (c) return c;
  if (discs.size > 900) discs.clear();
  const d = r * 2 + 1;
  c = makeCanvas(d, d);
  const g = ctx2d(c);
  g.fillStyle = color;
  const r2 = (r + 0.4) * (r + 0.4);
  for (let y = -r; y <= r; y++) {
    let w = 0;
    while (w + 1 <= r && (w + 1) * (w + 1) + y * y <= r2) w++;
    if (w * w + y * y <= r2) g.fillRect(r - w, y + r, w * 2 + 1, 1);
  }
  discs.set(key, c);
  return c;
}

const halos = new Map();
// A soft radial falloff in one color (the bloom halo around anything bright).
export function haloSprite(color) {
  let c = halos.get(color);
  if (c) return c;
  if (halos.size > 200) halos.clear();
  c = makeCanvas(32, 32);
  const g = c.getContext('2d');
  if (g && g.createRadialGradient) {
    const [r, gg, b] = rgbOf(color);
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, `rgba(${r},${gg},${b},1)`);
    grad.addColorStop(0.25, `rgba(${r},${gg},${b},0.6)`);
    grad.addColorStop(0.55, `rgba(${r},${gg},${b},0.22)`);
    grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
  }
  halos.set(color, c);
  return c;
}

// ------------------------------------------------------------------ primitives

export function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

export function px(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
}

// Filled disc: crisp pixel sprites up to radius 14, a path beyond.
export function disc(ctx, x, y, r, color) {
  if (!(r > 0.3) || !Number.isFinite(x) || !Number.isFinite(y)) return;
  if (r < 0.9) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    return;
  }
  const ri = Math.round(r);
  if (ri <= 14) {
    ctx.drawImage(discSprite(ri, color), Math.round(x) - ri, Math.round(y) - ri);
    return;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(Math.round(x), Math.round(y), r, 0, TAU);
  ctx.fill();
}

// Crisp pixel ellipses, cached by size, squash and color: a full ring or a filled
// ground ellipse is one small blit instead of an anti-aliased path (cheaper on a phone,
// and true to the pixel look). Bigger ones fall back to paths.
const SPRITE_MAX_R = 56;
const ellSprites = new Map();
const ringSprites = new Map();

function ellSprite(rx, ry, color) {
  const key = `${rx}|${ry}|${color}`;
  let c = ellSprites.get(key);
  if (c) return c;
  if (ellSprites.size > 260) ellSprites.clear();
  c = makeCanvas(rx * 2 + 1, ry * 2 + 1);
  const g = ctx2d(c);
  g.fillStyle = color;
  for (let y = -ry; y <= ry; y++) {
    const k = 1 - (y * y) / ((ry + 0.45) * (ry + 0.45));
    const w = Math.round(rx * Math.sqrt(k > 0 ? k : 0));
    g.fillRect(rx - w, y + ry, w * 2 + 1, 1);
  }
  ellSprites.set(key, c);
  return c;
}

function ringSprite(r, ry, color, width) {
  const key = `${r}|${ry}|${color}|${width}`;
  let c = ringSprites.get(key);
  if (c) return c;
  if (ringSprites.size > 320) ringSprites.clear();
  c = makeCanvas(r * 2 + 1, ry * 2 + 1);
  const g = ctx2d(c);
  g.fillStyle = color;
  // Every pixel whose center lies within the band of the ellipse (r, ry) .. inward
  // by `width`: scanned per row with the inner and outer half-widths.
  const ri = Math.max(0, r - width);
  const ryi = Math.max(0, ry - width * (ry / r));
  for (let y = -ry; y <= ry; y++) {
    const ko = 1 - (y * y) / ((ry + 0.45) * (ry + 0.45));
    const wo = Math.round(r * Math.sqrt(ko > 0 ? ko : 0));
    const ki = ryi > 0.5 ? 1 - (y * y) / ((ryi + 0.45) * (ryi + 0.45)) : -1;
    const wi = ki > 0 ? Math.round(ri * Math.sqrt(ki)) : -1;
    if (wi < 0) {
      g.fillRect(r - wo, y + ry, wo * 2 + 1, 1);
      continue;
    }
    const seg = Math.max(1, wo - wi);
    g.fillRect(r - wo, y + ry, seg, 1);
    g.fillRect(r + wo - seg + 1, y + ry, seg, 1);
  }
  ringSprites.set(key, c);
  return c;
}

// Filled ground ellipse (squashed disc).
export function ell(ctx, x, y, rx, ry, color) {
  if (!(rx > 0.5) || !(ry > 0.3) || !Number.isFinite(x) || !Number.isFinite(y)) return;
  if (rx <= SPRITE_MAX_R) {
    const ix = Math.round(rx);
    const iy = Math.max(1, Math.round(ry));
    ctx.drawImage(ellSprite(ix, iy, color), Math.round(x) - ix, Math.round(y) - iy);
    return;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(Math.round(x), Math.round(y), rx, ry, 0, 0, TAU);
  ctx.fill();
}

// Stroked ellipse (rings on the ground: squash 0.6), or part of one (a0..a1).
export function ring(ctx, x, y, r, color, width = 1, squash = 0.6, a0 = 0, a1 = TAU) {
  if (!(r > 0.5) || !Number.isFinite(x) || !Number.isFinite(y)) return;
  if (a0 === 0 && a1 === TAU && r <= SPRITE_MAX_R && r >= 1.5) {
    const ir = Math.round(r);
    const iy = Math.max(1, Math.round(r * squash));
    const w = Math.max(1, Math.round(width));
    ctx.drawImage(ringSprite(ir, iy, color, w), Math.round(x) - ir, Math.round(y) - iy);
    return;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.ellipse(Math.round(x) + 0.5, Math.round(y) + 0.5, r, Math.max(0.5, r * squash), 0, a0, a1);
  ctx.stroke();
}

export function line(ctx, x1, y1, x2, y2, color, width = 1) {
  if (!Number.isFinite(x1 + y1 + x2 + y2)) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// A soft halo (glow buffer): r is the visible radius.
export function halo(g, x, y, r, color, alpha, bounds) {
  if (!(r > 1) || !(alpha > 0.01) || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const prev = g.globalAlpha;
  g.globalAlpha = prev * (alpha > 1 ? 1 : alpha);
  g.imageSmoothingEnabled = true;
  g.drawImage(haloSprite(color), x - r, y - r, r * 2, r * 2);
  g.imageSmoothingEnabled = false;
  g.globalAlpha = prev;
  if (bounds) bounds.add(x, y, r);
}

// A jagged lightning line from (x1, y1) to (x2, y2): `segs` kinks of up to `amp` px,
// re-rolled whenever `seed` changes (pass a time-quantized seed for crackle).
const ZIG = new Float32Array(64);
export function zigPoints(x1, y1, x2, y2, segs, amp, seed) {
  const n = Math.max(1, Math.min(30, segs | 0));
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l;
  const ny = dx / l;
  ZIG[0] = x1;
  ZIG[1] = y1;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const o = (hash(seed, i, 7) * 2 - 1) * amp * Math.sin(t * Math.PI) * 1.2;
    ZIG[i * 2] = x1 + dx * t + nx * o;
    ZIG[i * 2 + 1] = y1 + dy * t + ny * o;
  }
  ZIG[n * 2] = x2;
  ZIG[n * 2 + 1] = y2;
  return n + 1;
}

export function zig(ctx, x1, y1, x2, y2, segs, amp, seed, color, width = 1) {
  if (!Number.isFinite(x1 + y1 + x2 + y2)) return;
  const n = zigPoints(x1, y1, x2, y2, segs, amp, seed);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(ZIG[0], ZIG[1]);
  for (let i = 1; i < n; i++) ctx.lineTo(ZIG[i * 2], ZIG[i * 2 + 1]);
  ctx.stroke();
}

// A filled polygon from a flat list of points (x0, y0, x1, y1, …).
export function poly(ctx, pts, n, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 1; i < n; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
  ctx.closePath();
  ctx.fill();
}

// A filled pie wedge of a ground ellipse (cones).
export function wedge(ctx, x, y, r, ang, arc, color, squash = 0.75) {
  if (!(r > 1) || !Number.isFinite(x + y + ang)) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.ellipse(x, y, r, Math.max(0.5, r * squash), 0, ang - arc, ang + arc);
  ctx.closePath();
  ctx.fill();
}

// ------------------------------------------------------------------ glyphs (runes, sigils)

// 7×7 pixel signs for a rune's center, one per essence look ('#' = lit).
const GLYPHS = {
  flame: ['...#...', '..##...', '..###..', '.#####.', '.##.##.', '.#...#.', '..###..'],
  drop: ['...#...', '..###..', '..###..', '.#####.', '.###.#.', '.##..#.', '..###..'],
  flake: ['#..#..#', '.#.#.#.', '..###..', '#######', '..###..', '.#.#.#.', '#..#..#'],
  bolt: ['....##.', '...##..', '..##...', '.######', '...##..', '..##...', '.##....'],
  peak: ['...#...', '..###..', '..#.#..', '.#...#.', '.#.#.#.', '#.....#', '#######'],
  swirl: ['..###..', '.#...#.', '#..#..#', '#.#.#.#', '#..##.#', '.#....#', '..####.'],
  leaf: ['....###', '...####', '..##.##', '.##.##.', '.#.##..', '.###...', '#......'],
  skull: ['.#####.', '#######', '#..#..#', '#######', '.##.##.', '.#####.', '.#.#.#.'],
  sun: ['#..#..#', '.#...#.', '..###..', '#.###.#', '..###..', '.#...#.', '#..#..#'],
  moon: ['..###..', '.##....', '##.....', '##.....', '##.....', '.##....', '..###..'],
  anvil: ['.......', '#######', '.######', '...###.', '...##..', '..####.', '.######'],
  note: ['...###.', '...#.##', '...#...', '...#...', '.###...', '####...', '.##....'],
  diamond: ['...#...', '..#.#..', '.#.#.#.', '#.###.#', '.#.#.#.', '..#.#..', '...#...'],
};

const glyphCache = new Map();
export function glyphSprite(name, color) {
  const key = `${name}|${color}`;
  let c = glyphCache.get(key);
  if (c) return c;
  if (glyphCache.size > 300) glyphCache.clear();
  const rows = GLYPHS[name] || GLYPHS.diamond;
  c = makeCanvas(7, 7);
  const g = ctx2d(c);
  g.fillStyle = color;
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (rows[y][x] === '#') g.fillRect(x, y, 1, 1);
  glyphCache.set(key, c);
  return c;
}

// The fist of a strike: 9×8, knuckles to the right, shaded in a palette.
const FIST = ['..####...', '.######..', '#########', '#########', '########.', '#######..', '.#####...', '..###....'];
const fistCache = new Map();
export function fistSprite(pal) {
  const key = `${pal.core}${pal.glow}${pal.deep}`;
  let c = fistCache.get(key);
  if (c) return c;
  if (fistCache.size > 120) fistCache.clear();
  c = makeCanvas(11, 10);
  const g = ctx2d(c);
  // Outline first, then the fist, then knuckle highlights and finger creases.
  g.fillStyle = pal.deep;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) if (FIST[y][x] === '#') g.fillRect(x, y, 3, 3);
  g.fillStyle = pal.glow;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) if (FIST[y][x] === '#') g.fillRect(x + 1, y + 1, 1, 1);
  g.fillStyle = pal.core;
  g.fillRect(8, 3, 1, 4);
  g.fillRect(7, 2, 1, 1);
  g.fillRect(3, 1, 3, 1);
  g.fillStyle = pal.deep;
  g.fillRect(6, 4, 2, 1);
  g.fillRect(6, 6, 2, 1);
  fistCache.set(key, c);
  return c;
}

// Silhouettes of a sprite frame in one color (status tints, afterimages), cached per
// frame image (WeakMap: freed with the atlas frame) and color.
const silCache = new WeakMap();
export function silhouetteOf(img, color) {
  if (!img || typeof img !== 'object') return null;
  let per = silCache.get(img);
  if (!per) {
    per = new Map();
    silCache.set(img, per);
  }
  let c = per.get(color);
  if (c) return c;
  if (per.size > 24) per.clear();
  c = makeCanvas(img.width || 32, img.height || 32);
  const g = c.getContext('2d');
  if (g && !c.stub) {
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
  }
  per.set(color, c);
  return c;
}

// Opaque bounds of a sprite frame (for heads, feet, ice crusts), cached per image.
const boundsCache = new WeakMap();
const DEFAULT_BOUNDS = Object.freeze({ top: 8, bottom: 31, left: 9, right: 23, w: 32, h: 32 });
export function frameBounds(img) {
  if (!img || typeof img !== 'object') return DEFAULT_BOUNDS;
  let b = boundsCache.get(img);
  if (b) return b;
  b = DEFAULT_BOUNDS;
  try {
    const w = img.width | 0;
    const h = img.height | 0;
    const g = typeof img.getContext === 'function' ? img.getContext('2d') : null;
    const data = g && g.getImageData ? g.getImageData(0, 0, w, h)?.data : null;
    if (data && data.length >= w * h * 4) {
      let top = h;
      let bottom = -1;
      let left = w;
      let right = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (data[(y * w + x) * 4 + 3] < 24) continue;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
      if (bottom >= top) b = { top, bottom, left, right, w, h };
    }
  } catch {
    b = DEFAULT_BOUNDS;
  }
  boundsCache.set(img, b);
  return b;
}
