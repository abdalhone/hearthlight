import { TILE } from '../core/constants.js';
import { tileDef, SOLID, WATERY, WALLISH, T } from './tiles.js';
import { paintChunk, CHUNK } from '../art/tiles_art.js';
import { paintRoof, roofGeometry } from '../art/world_buildings.js';

// The tile map: ground, decorations, buildings, collision queries and the cached
// ground renderer.
//
// Rendering strategy (phones must hold 60 fps):
//  - Static ground is painted once per 16×16-tile chunk into an offscreen canvas,
//    lazily on first need, and kept in a small LRU cache.
//  - Water is the only animated ground: chunk canvases leave water transparent, and
//    each frame only the visible water tiles are drawn underneath from a looping sheet.
//  - Roofs are cached per building and drawn after everything else with a fade.

const MAX_CHUNKS = 40;
const WATER_FPS = 6;
const LOCATION_DEBOUNCE = 0.25;

export class TileMap {
  constructor(w, h, game = null) {
    this.game = game;
    this.w = w;
    this.h = h;
    this.ground = new Uint16Array(w * h);
    this.deco = new Uint16Array(w * h); // 0 = none (see DECO in tiles.js)
    this.buildings = []; // { id, name, x, y, w, h (tiles, outer footprint incl. walls), doorTiles: [{tx,ty}], material, roof, rug }
    this.bIndex = new Int16Array(w * h).fill(-1);
    this.version = 0; // bumps on any tile change (pathfinder rebuilds its grid)
    this._chunks = new Map();
    this._depth = null;
    this._renderTime = 0;
    this._builtThisFrame = 0;
    this._loc = new Map();
    this._smokeT = 0;
  }

  idx(tx, ty) {
    return ty * this.w + tx;
  }

  inBounds(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h;
  }

  tileAt(tx, ty) {
    return this.inBounds(tx, ty) ? this.ground[ty * this.w + tx] : 0;
  }

  set(tx, ty, id) {
    if (!this.inBounds(tx, ty)) return;
    const i = ty * this.w + tx;
    if (this.ground[i] === id) return;
    this.ground[i] = id;
    this.version++;
    this._depth = null;
    if (this._chunks.size) this.invalidateTile(tx, ty);
  }

  decoAt(tx, ty) {
    return this.inBounds(tx, ty) ? this.deco[ty * this.w + tx] : 0;
  }

  setDeco(tx, ty, id) {
    if (this.inBounds(tx, ty)) this.deco[ty * this.w + tx] = id;
  }

  addBuilding(b) {
    const k = this.buildings.length;
    const bld = { roof: { style: 'red', lift: 1, chimneys: [] }, material: 'timber', rug: 'red', doorTiles: [], ...b };
    bld._alpha = 1;
    this.buildings.push(bld);
    for (let y = bld.y; y < bld.y + bld.h; y++) for (let x = bld.x; x < bld.x + bld.w; x++) if (this.inBounds(x, y)) this.bIndex[y * this.w + x] = k;
    return bld;
  }

  // Blocks walking (walls, water, void). Flying actors ignore water.
  isSolidTile(tx, ty, actor = null) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return true;
    const id = this.ground[ty * this.w + tx];
    if (WATERY[id] && actor?.flying) return false;
    return SOLID[id] === 1;
  }

  isWater(tx, ty) {
    return this.inBounds(tx, ty) && WATERY[this.ground[ty * this.w + tx]] === 1;
  }

  // Blocks arrows, bolts and line of sight.
  blocksProjectile(tx, ty) {
    return !this.inBounds(tx, ty) || WALLISH[this.ground[ty * this.w + tx]] === 1;
  }

  buildingAt(tx, ty) {
    if (!this.inBounds(tx, ty)) return null;
    const k = this.bIndex[ty * this.w + tx];
    return k >= 0 ? this.buildings[k] : null;
  }

  isIndoors(px, py) {
    return !!this.buildingAt(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  // Distance (tiles, capped) from each water tile to the nearest land; drives the
  // shallow-to-deep shading of lakes and the stream.
  waterDepth() {
    if (this._depth) return this._depth;
    const { w, h } = this;
    const d = new Uint8Array(w * h);
    const q = new Int32Array(w * h);
    let qh = 0;
    let qt = 0;
    for (let i = 0; i < w * h; i++) {
      if (WATERY[this.ground[i]]) d[i] = 255;
      else {
        d[i] = 0;
        q[qt++] = i;
      }
    }
    while (qh < qt) {
      const i = q[qh++];
      const x = i % w;
      const y = (i / w) | 0;
      const nd = d[i] + 1;
      if (nd > 12) continue;
      if (x > 0 && d[i - 1] > nd) (d[i - 1] = nd), (q[qt++] = i - 1);
      if (x < w - 1 && d[i + 1] > nd) (d[i + 1] = nd), (q[qt++] = i + 1);
      if (y > 0 && d[i - w] > nd) (d[i - w] = nd), (q[qt++] = i - w);
      if (y < h - 1 && d[i + w] > nd) (d[i + w] = nd), (q[qt++] = i + w);
    }
    for (let i = 0; i < w * h; i++) if (d[i] === 255) d[i] = 12;
    this._depth = d;
    return d;
  }

  // ---- render cache management ----

  invalidateTile(tx, ty) {
    // Blends and baked shadows reach a couple of tiles over chunk borders.
    const cs = CHUNK;
    const keys = new Set();
    for (let dy = -2; dy <= 2; dy += 2) for (let dx = -2; dx <= 2; dx += 2) {
      const cx = Math.floor((tx + dx) / cs);
      const cy = Math.floor((ty + dy) / cs);
      keys.add(cy * 1000 + cx);
    }
    for (const k of keys) this._chunks.delete(k);
  }

  invalidateAll() {
    this._chunks.clear();
  }

  _art() {
    return this.game?.atlas?.getMeta?.('tileart') || null;
  }

  _chunk(cx, cy, art) {
    const key = cy * 1000 + cx;
    let c = this._chunks.get(key);
    if (c) {
      c.used = this._renderTime;
      return c;
    }
    c = paintChunk(art, this, cx, cy, this._shadowCasters(cx, cy));
    c.used = this._renderTime;
    this._chunks.set(key, c);
    this._builtThisFrame++;
    if (this._chunks.size > MAX_CHUNKS) {
      let oldK = null;
      let oldT = Infinity;
      for (const [k, v] of this._chunks) if (v.used < oldT) (oldT = v.used), (oldK = k);
      if (oldK != null && oldK !== key) this._chunks.delete(oldK);
    }
    return c;
  }

  // Objects whose soft shadows are baked into a chunk.
  _shadowCasters(cx, cy) {
    const objs = this.game?.objects;
    if (!objs?._eachInRect) return [];
    const span = CHUNK * TILE;
    const out = [];
    objs._eachInRect(cx * span - 32, cy * span - 16, (cx + 1) * span + 32, (cy + 1) * span + 32, (o) => {
      if (o.removed || !o.shadow) return;
      let s = o.shadow;
      if (o.state?.depleted) {
        if (o.objType === 'tree') s = { dx: 1, dy: -1, rx: 6, ry: 2 };
        else if (o.objType !== 'berry_bush') return;
      }
      out.push({ x: o.x + s.dx, y: o.y + s.dy, rx: s.rx, ry: s.ry });
    });
    return out;
  }

  // Draw ground + deco for the view. (ox, oy) = camera top-left in world px.
  drawGround(ctx, ox, oy, vw, vh, time) {
    this._renderTime = time;
    this._builtThisFrame = 0;
    const art = this._art();
    if (!art) {
      this._drawFlat(ctx, ox, oy, vw, vh);
      return;
    }
    const span = CHUNK * TILE;
    const cx0 = Math.max(0, Math.floor(ox / span));
    const cy0 = Math.max(0, Math.floor(oy / span));
    const cx1 = Math.min(Math.ceil(this.w / CHUNK) - 1, Math.floor((ox + vw - 1) / span));
    const cy1 = Math.min(Math.ceil(this.h / CHUNK) - 1, Math.floor((oy + vh - 1) / span));
    const frame = Math.floor(time * WATER_FPS) % art.waterFrames;
    const sheet = art.water[frame];
    const foamFrame = Math.floor(time * 4) % art.foamFrames;
    const vx0 = Math.floor(ox / TILE) - 1;
    const vy0 = Math.floor(oy / TILE) - 1;
    const vx1 = Math.floor((ox + vw) / TILE) + 1;
    const vy1 = Math.floor((oy + vh) / TILE) + 1;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = this._chunk(cx, cy, art);
        const wl = c.water;
        if (wl.length) {
          const fm = c.foam;
          for (let k = 0; k < wl.length; k++) {
            const i = wl[k];
            const tx = i % this.w;
            const ty = (i / this.w) | 0;
            if (tx < vx0 || tx > vx1 || ty < vy0 || ty > vy1) continue;
            const sx = tx * TILE - ox;
            const sy = ty * TILE - oy;
            ctx.drawImage(sheet, (tx * TILE) & 63, (ty * TILE) & 63, TILE, TILE, sx, sy, TILE, TILE);
            const m = fm[k];
            if (m) {
              const fs = art.foam[foamFrame];
              for (let b = 0; b < 8; b++) if (m & (1 << b)) ctx.drawImage(fs, b * TILE, 0, TILE, TILE, sx, sy, TILE, TILE);
            }
          }
        }
        ctx.drawImage(c.canvas, cx * span - ox, cy * span - oy);
      }
    }
  }

  _drawFlat(ctx, ox, oy, vw, vh) {
    const x0 = Math.max(0, Math.floor(ox / TILE));
    const y0 = Math.max(0, Math.floor(oy / TILE));
    const x1 = Math.min(this.w - 1, Math.floor((ox + vw) / TILE));
    const y1 = Math.min(this.h - 1, Math.floor((oy + vh) / TILE));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        ctx.fillStyle = tileDef(this.ground[ty * this.w + tx]).color;
        ctx.fillRect(tx * TILE - ox, ty * TILE - oy, TILE, TILE);
      }
    }
  }

  // Build one missing chunk near the camera per idle step, so walking rarely waits.
  _warmup() {
    const art = this._art();
    const cam = this.game?.camera;
    if (!art || !cam || this._builtThisFrame > 0 || typeof document === 'undefined') return;
    const span = CHUNK * TILE;
    const cx0 = Math.max(0, Math.floor((cam.x - span) / span));
    const cy0 = Math.max(0, Math.floor((cam.y - span) / span));
    const cx1 = Math.min(Math.ceil(this.w / CHUNK) - 1, Math.floor((cam.x + cam.vw + span) / span));
    const cy1 = Math.min(Math.ceil(this.h / CHUNK) - 1, Math.floor((cam.y + cam.vh + span) / span));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (this._chunks.has(cy * 1000 + cx)) continue;
        if (this._chunks.size >= MAX_CHUNKS - 4) return;
        this._chunk(cx, cy, art);
        return;
      }
    }
  }

  // ---- roofs ----

  _roofOf(b) {
    if (b._roof !== undefined) return b._roof;
    try {
      b._roof = paintRoof(b);
    } catch (err) {
      console.error('[map] roof art failed', b.id, err);
      b._roof = null;
    }
    return b._roof;
  }

  // Draw roofs; the building containing `viewer` fades out so you can see inside.
  drawRoofs(ctx, ox, oy, vw, vh, time, viewer) {
    const fdt = Math.min(0.1, Math.max(0, time - (this._roofT ?? time)));
    this._roofT = time;
    const vtx = viewer ? Math.floor(viewer.x / TILE) : -1;
    const vty = viewer ? Math.floor(viewer.y / TILE) : -1;
    const inside = viewer ? this.buildingAt(vtx, vty) : null;
    for (const b of this.buildings) {
      const g = b._geo || (b._geo = roofGeometry(b));
      if (g.x > ox + vw || g.x + g.w < ox || g.y > oy + vh || g.y + g.h < oy) continue;
      let target = 1;
      if (inside === b) target = 0.1;
      else if (viewer && viewer.x > g.x + 2 && viewer.x < g.x + g.w - 2 && viewer.y > g.roofTop && viewer.y < g.eaveY + 8) target = 0.5;
      b._alpha += (target - b._alpha) * Math.min(1, fdt * 7);
      const roof = this._roofOf(b);
      if (!roof) continue;
      if (b._alpha < 0.02) continue;
      const prev = ctx.globalAlpha;
      ctx.globalAlpha = prev * b._alpha;
      ctx.drawImage(roof.canvas, Math.round(g.x - ox), Math.round(g.y - oy));
      ctx.globalAlpha = prev;
    }
  }

  // ---- simulation ----

  update(dt) {
    const g = this.game;
    if (!g) return;
    if (g.locations) {
      this._track(g.player, dt);
      this._track(g.companion, dt);
    }
    this._chimneys(dt);
    this._warmup();
  }

  // Current tracked location of the player or Lyra (null before the first update).
  locationOf(actor) {
    return (actor && this._loc.get(actor.id)?.current) || null;
  }

  _track(actor, dt) {
    if (!actor || actor.removed) return;
    let r = this._loc.get(actor.id);
    if (!r) {
      r = { current: null, started: false, pending: null, pendingT: 0, tx: -1, ty: -1, loc: null };
      this._loc.set(actor.id, r);
    }
    const tx = Math.floor(actor.x / TILE);
    const ty = Math.floor(actor.y / TILE);
    if (tx !== r.tx || ty !== r.ty) {
      r.tx = tx;
      r.ty = ty;
      r.loc = this.game.locations.at(actor.x, actor.y) || null;
    }
    const loc = r.loc;
    if (r.started && loc === r.current) {
      r.pending = null;
      r.pendingT = 0;
      return;
    }
    if (r.started) {
      if (r.pending !== loc) {
        r.pending = loc;
        r.pendingT = 0;
      }
      r.pendingT += dt;
      if (r.pendingT < LOCATION_DEBOUNCE) return;
    }
    const prev = r.current;
    r.current = loc;
    r.started = true;
    r.pending = null;
    r.pendingT = 0;
    const bus = this.game.bus;
    if (prev) bus?.emit('leave_location', { actor, location: prev });
    if (loc) bus?.emit('enter_location', { actor, location: loc });
  }

  _chimneys(dt) {
    const g = this.game;
    const cam = g.camera;
    if (!cam || !g.particles?.emit) return;
    this._smokeT -= dt;
    if (this._smokeT > 0) return;
    this._smokeT = 0.35;
    const hour = g.clock?.hour ?? 12;
    // Fires are busiest at breakfast and supper.
    const busy = (hour > 6 && hour < 9) || (hour > 17 && hour < 22);
    for (const b of this.buildings) {
      const geo = b._geo || (b._geo = roofGeometry(b));
      for (const c of geo.chimneys) {
        if (c.x < cam.x - 16 || c.x > cam.x + cam.vw + 16 || c.y < cam.y - 32 || c.y > cam.y + cam.vh + 16) continue;
        c.t = (c.t ?? c.phase) - 0.35;
        if (c.t > 0) continue;
        c.t = (busy || b.smoky ? 0.7 : 1.6) + c.phase;
        try {
          g.particles.emit('smoke', c.x, c.y, { count: 1 });
        } catch {
          /* cosmetic */
        }
      }
    }
  }
}

export { CHUNK };
