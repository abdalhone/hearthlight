import { TILE } from '../core/constants.js';
import { tileDef } from './tiles.js';

// STUB (owned by the world agent). The public interface below is the contract;
// keep every method and its meaning.
export class TileMap {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.ground = new Uint16Array(w * h);
    this.deco = new Uint16Array(w * h); // 0 = none
    this.buildings = []; // { id, name, x, y, w, h (tiles, outer footprint incl. walls), roof: {...}, doorTiles: [{tx,ty}] }
  }

  idx(tx, ty) {
    return ty * this.w + tx;
  }

  inBounds(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h;
  }

  tileAt(tx, ty) {
    return this.inBounds(tx, ty) ? this.ground[this.idx(tx, ty)] : 0;
  }

  set(tx, ty, id) {
    if (this.inBounds(tx, ty)) this.ground[this.idx(tx, ty)] = id;
  }

  // Blocks walking (walls, water, void). Flying actors ignore water.
  isSolidTile(tx, ty, actor = null) {
    if (!this.inBounds(tx, ty)) return true;
    const d = tileDef(this.ground[this.idx(tx, ty)]);
    if (d.water && actor?.flying) return false;
    return d.solid;
  }

  isWater(tx, ty) {
    return this.inBounds(tx, ty) && tileDef(this.ground[this.idx(tx, ty)]).water;
  }

  // Blocks arrows, bolts and line of sight.
  blocksProjectile(tx, ty) {
    return !this.inBounds(tx, ty) || tileDef(this.ground[this.idx(tx, ty)]).wall;
  }

  buildingAt(tx, ty) {
    return this.buildings.find((b) => tx >= b.x && ty >= b.y && tx < b.x + b.w && ty < b.y + b.h) || null;
  }

  isIndoors(px, py) {
    return !!this.buildingAt(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  // Draw ground + deco for the view. (ox, oy) = camera top-left in world px.
  drawGround(ctx, ox, oy, vw, vh, time) {
    const x0 = Math.max(0, Math.floor(ox / TILE));
    const y0 = Math.max(0, Math.floor(oy / TILE));
    const x1 = Math.min(this.w - 1, Math.floor((ox + vw) / TILE));
    const y1 = Math.min(this.h - 1, Math.floor((oy + vh) / TILE));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        ctx.fillStyle = tileDef(this.ground[this.idx(tx, ty)]).color;
        ctx.fillRect(tx * TILE - ox, ty * TILE - oy, TILE, TILE);
      }
    }
  }

  // Draw roofs; buildings containing `viewer` fade out so you can see inside.
  drawRoofs(ctx, ox, oy, vw, vh, time, viewer) {}

  update(dt) {}
}
