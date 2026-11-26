import { TILE } from '../core/constants.js';
import { T } from './tiles.js';

// What stops a blow (DESIGN §31.1): the one rule every attack uses, the same tiles that
// stop arrows and bolts. A sword arc, a nova, a strike's wave, a beam and a bomb's blast
// reach only what they could reach in a straight line without passing a wall tile
// (map.blocksProjectile: walls, rock, palisades, ruin walls, the world's edge) or a
// closed door. Nobody is hit through a house.

function doorClosed(d) {
  return !!d && !d.isOpen && !d.state?.open;
}

// Does this tile stop an attack?
export function wallTile(game, tx, ty) {
  const map = game?.map;
  if (!map) return false;
  try {
    if (map.blocksProjectile?.(tx, ty)) return true;
    return doorClosed(game.objects?.doorAt?.(tx, ty));
  } catch {
    return false;
  }
}

// Does the point (world px) sit in a tile that stops attacks?
export function wallAt(game, x, y) {
  return wallTile(game, Math.floor(x / TILE), Math.floor(y / TILE));
}

// Tiles that stop a hand-to-hand blow but not an arrow (round 14b, DESIGN §35.6): a heap of
// rubble is low enough to shoot over and too broad to reach across with a blade or claws.
export const BLOCKS_BLOW = new Set([T.RUBBLE]);

export function blowTile(game, tx, ty) {
  if (wallTile(game, tx, ty)) return true;
  try {
    return BLOCKS_BLOW.has(game.map?.tileAt?.(tx, ty));
  } catch {
    return false;
  }
}

// Is there a wall between two points? Walks every tile the segment passes through
// (a grid traversal, so it never slips between two wall tiles meeting at a corner).
// The tiles of the two end points themselves do not count: someone hugging a wall is
// still in reach, and a blow struck from a doorway still lands. `tileTest` (round 14b):
// what stops it (wallTile by default; blowTile for a hand-to-hand blow).
export function wallBetween(game, x0, y0, x1, y1, tileTest = wallTile) {
  const map = game?.map;
  if (!map || typeof map.blocksProjectile !== 'function') return false;
  let tx = Math.floor(x0 / TILE);
  let ty = Math.floor(y0 / TILE);
  const ex = Math.floor(x1 / TILE);
  const ey = Math.floor(y1 / TILE);
  if (tx === ex && ty === ey) return false;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  const ix = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
  const iy = dy !== 0 ? Math.abs(TILE / dy) : Infinity;
  let mx = dx !== 0 ? ((sx > 0 ? (tx + 1) * TILE - x0 : x0 - tx * TILE) / Math.abs(dx)) : Infinity;
  let my = dy !== 0 ? ((sy > 0 ? (ty + 1) * TILE - y0 : y0 - ty * TILE) / Math.abs(dy)) : Infinity;
  // At most the Manhattan distance in tiles, plus a margin for float error.
  let guard = Math.abs(ex - tx) + Math.abs(ey - ty) + 2;
  while (guard-- > 0) {
    if (Math.abs(mx - my) < 1e-9) {
      // Exactly through a corner: both side tiles must be open for the line to pass.
      const a = tileTest(game, tx + sx, ty) && !(tx + sx === ex && ty === ey);
      const b = tileTest(game, tx, ty + sy) && !(tx === ex && ty + sy === ey);
      if (a && b) return true;
      tx += sx;
      ty += sy;
      mx += ix;
      my += iy;
    } else if (mx < my) {
      tx += sx;
      mx += ix;
    } else {
      ty += sy;
      my += iy;
    }
    if (tx === ex && ty === ey) return false;
    if (tileTest(game, tx, ty)) return true;
  }
  return false;
}

// Can a blow from `a` reach `b`? Measured a little above the feet, where actors
// collide and projectiles fly, so a body standing against a wall stays in reach.
export const BLOW_LIFT = 3;
export function canReach(game, a, b, fromX = a?.x, fromY = a?.y, { melee = false } = {}) {
  if (!a || !b) return false;
  // Small actors stand close to the ground: never measure above their own height.
  const la = Math.min(BLOW_LIFT, Math.max(1, (a.radius ?? 5) - 1));
  const lb = Math.min(BLOW_LIFT, Math.max(1, (b.radius ?? 5) - 1));
  return !wallBetween(game, fromX, fromY - la, b.x, b.y - lb, melee ? blowTile : wallTile);
}
