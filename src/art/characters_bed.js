// Sleeping in a bed, drawn right (DESIGN §19.8: "anyone in a bed lies in it the way the bed
// is oriented, head on the pillow, blanket over the body, never sideways across it").
//
// The renderer draws a sleeper together with the bed they lie in, right after the bed, so
// depth is the bed's:
//   bedUnder(game, actor)                         -> the bed an asleep actor lies in, or null
//   drawSleeperInBed(ctx, atlas, actor, bed, ox, oy, time)
// The sleeper is the character's 'bed' pose (head and shoulders seen from above, the head
// top on BED_HEAD_ROW) placed on the pillow; then the bed's own quilt is drawn again over
// them as a blanket, with a soft ridge where the body lies under it.

import { drawCharacter } from './characters_art.js';
import { BED_HEAD_ROW, ANCHOR_Y } from './characters_humanoid.js';

const TILE = 16;
// Bed sprites (props_furniture.js) are 16 x 36, anchored at (8, 35): headboard rows 0-7,
// pillow 5-10, quilt from 10, footboard from 32.
const BED_OX = 8;
const BED_OY = 35;
const HEAD_AT = 4; // the sleeper's head top lands on this bed row (on the pillow)
const COVER_FROM = 12; // the blanket covers the bed from this row down

const covers = new Map(); // bed sprite name -> [canvas, canvas] (two breaths)

function footprintOf(bed) {
  const f = bed.footprint;
  if (f) return f;
  const tx = bed.tx ?? Math.floor(bed.x / TILE);
  const ty = bed.ty ?? Math.floor(bed.y / TILE);
  return { x: tx, y: ty - 1, w: 1, h: 2 };
}

// The bed under an asleep actor: their own (NPC.inBed), else whichever bed's footprint
// holds their feet. Cached on the actor until they move.
export function bedUnder(game, actor) {
  if (!actor || actor.state !== 'sleep') return null;
  if (actor.inBed && !actor.inBed.removed) return actor.inBed;
  const c = actor._bedUnder;
  if (c && c.x === actor.x && c.y === actor.y) return c.bed && !c.bed.removed ? c.bed : null;
  let bed = null;
  const tx = Math.floor(actor.x / TILE);
  const ty = Math.floor(actor.y / TILE);
  let near = null;
  try {
    near = game?.objects?.inRadius?.(actor.x, actor.y, 40, (o) => o.objType === 'bed');
  } catch {
    near = null;
  }
  const list = Array.isArray(near) ? near : (game?.objects?.all?.() || []).filter((o) => o.objType === 'bed');
  for (const o of list) {
    if (!o || o.removed || o.objType !== 'bed') continue;
    const f = footprintOf(o);
    if (tx >= f.x && tx < f.x + f.w && ty >= f.y && ty < f.y + f.h) {
      bed = o;
      break;
    }
  }
  actor._bedUnder = { x: actor.x, y: actor.y, bed };
  return bed;
}

// The blanket: the bed's own quilt rows (so every bed variant matches itself), with a
// ridge of light down the middle and shade at the sides where a body lies under it.
function coverFor(atlas, name) {
  let list = covers.get(name);
  if (list) return list;
  const src = atlas?.get?.(name)?.frames?.[0];
  if (!src || typeof document === 'undefined') return null;
  const w = src.width;
  const h = src.height - COVER_FROM;
  list = [];
  for (let breath = 0; breath < 2; breath++) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, COVER_FROM, w, h, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const mid = (w - 1) / 2;
    for (let y = 0; y < h; y++) {
      const by = y + COVER_FROM;
      if (by >= 32) break; // the footboard stays as it is
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (d[i + 3] < 10) continue;
        const dx = Math.abs(x - mid);
        let k = 1;
        if (y <= 1) k = y === 0 ? 1.22 : 1.12; // the turned-down fold at the shoulders
        else if (by < 29 + breath) k = dx < 1.5 ? 1.12 : dx < 3 ? 1.04 : dx > 4.5 ? 0.86 : 1;
        // two small bumps at the feet
        if (by >= 27 && by <= 29 && (Math.abs(x - mid + 2) < 1 || Math.abs(x - mid - 2) < 1)) k *= 1.1;
        d[i] = Math.min(255, d[i] * k);
        d[i + 1] = Math.min(255, d[i + 1] * k);
        d[i + 2] = Math.min(255, d[i + 2] * k);
      }
    }
    // a dark line under the fold, where it meets the body
    for (let x = 2; x < w - 2; x++) {
      const i = (2 * w + x) * 4;
      if (d[i + 3] < 10) continue;
      d[i] *= 0.78;
      d[i + 1] *= 0.78;
      d[i + 2] *= 0.8;
    }
    ctx.putImageData(img, 0, 0);
    list.push(c);
  }
  covers.set(name, list);
  return list;
}

export function drawSleeperInBed(ctx, atlas, actor, bed, ox, oy, time = 0) {
  if (!ctx || !atlas || !actor || !bed) return false;
  const name = typeof bed.spriteName === 'function' ? bed.spriteName(time) : bed.sprite;
  const meta = atlas.get?.(name) || atlas.get?.('prop:bed');
  const bx = Math.round(bed.x - ox);
  const top = Math.round(bed.y - oy) - (meta?.oy ?? BED_OY); // the bed sprite's top row on screen
  // Head on the pillow: the 'bed' frame's head row goes to bed row HEAD_AT.
  const feetY = top + HEAD_AT - BED_HEAD_ROW + ANCHOR_Y;
  try {
    drawCharacter(ctx, atlas, actor.spriteKey || actor.id, 'bed', 'down', time, bx, feetY, { state: 'sleep', alpha: 1 });
  } catch {
    return false;
  }
  const cover = coverFor(atlas, name) || coverFor(atlas, 'prop:bed');
  if (cover) {
    const breath = Math.floor(((time || 0) + (actor.jitter || 0) * 3) * 0.7) % 2;
    ctx.drawImage(cover[breath], bx - (meta?.ox ?? BED_OX), top + COVER_FROM);
  }
  return true;
}
