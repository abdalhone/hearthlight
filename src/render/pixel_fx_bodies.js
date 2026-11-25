import { spriteOf } from '../magic/fx_status.js';

// Our own characters as pixelfx sees a body (DESIGN §30). pixelfx's status effects wrap a
// body given as { mask, pixels, x, y, w, h, head, chest } in local space with the feet at
// (0, 0); its stock stand-in is a 24x38 side-on dummy. Here the body is the sprite frame the
// game is drawing this instant (12x20-ish, seen from above in 3/4), cropped to its opaque
// pixels, so frost, flames, poison and the like wrap OUR sprite's own shape and colors and
// follow it frame by frame. Masks are cached per frame image (frames are few and fixed).

const CACHE = new WeakMap(); // frame image -> actor (or null if unreadable)
const DEFAULT = { h: 20, w: 10 };

function readActor(img, ax, ay) {
  const w = img.width | 0;
  const h = img.height | 0;
  if (!w || !h || typeof img.getContext !== 'function') return null;
  const g = img.getContext('2d');
  const data = g?.getImageData?.(0, 0, w, h)?.data;
  if (!data || data.length < w * h * 4) return null;
  let top = h;
  let bottom = -1;
  let left = w;
  let right = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < 40) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  if (bottom < top) return null;
  const mw = right - left + 1;
  const mh = bottom - top + 1;
  const mask = new Uint8Array(mw * mh);
  const pixels = new Uint32Array(mw * mh);
  for (let y = 0; y < mh; y++)
    for (let x = 0; x < mw; x++) {
      const i = ((top + y) * w + left + x) * 4;
      if (data[i + 3] < 40) continue;
      mask[y * mw + x] = 1;
      pixels[y * mw + x] = (255 << 24) | (data[i + 2] << 16) | (data[i + 1] << 8) | data[i];
    }
  const x0 = left - ax;
  const y0 = top - ay;
  return {
    mask: { w: mw, h: mh, data: mask },
    pixels,
    x: x0,
    y: y0,
    w: mw,
    h: mh,
    k: 1,
    head: [x0 + Math.floor(mw / 2), y0],
    chest: [x0 + Math.floor(mw / 2), y0 + Math.round(mh * 0.45)],
  };
}

// The pixelfx body of an entity as drawn right now, or null (no sprite, no canvas).
export function actorOf(game, e) {
  if (!game || !e) return null;
  let S;
  try {
    S = spriteOf(game.atlas, e);
  } catch {
    return null;
  }
  const img = S?.img;
  if (!img || typeof img !== 'object') return null;
  let a = CACHE.get(img);
  if (a === undefined) {
    try {
      a = readActor(img, S.ax, S.ay);
    } catch {
      a = null;
    }
    CACHE.set(img, a);
  }
  return a;
}

// How tall and wide an entity stands (its sprite's opaque box), for placing hits at its
// chest and sizing what wraps it.
export function bodySize(game, e) {
  const a = actorOf(game, e);
  if (a) return { h: a.h, w: a.w };
  const r = e?.radius || 5;
  return { h: Math.max(DEFAULT.h, r * 3), w: Math.max(DEFAULT.w, r * 2) };
}
