import { TILE } from '../core/constants.js';
import { tileDef, SOLID, WATERY, WALLISH } from './tiles.js';
import { paintChunk, bakeReflections, CHUNK } from '../art/tiles_art.js';
import { paintRoof, roofGeometry } from '../art/world_buildings.js';

// The tile map: ground, decorations, buildings, collision queries and the cached
// ground renderer.
//
// Rendering strategy (phones must hold 60 fps):
//  - Static ground is painted once per 16×16-tile chunk into an offscreen canvas,
//    lazily on first need (one chunk per frame at most once the view is covered),
//    and kept in a small LRU cache.
//  - Water is the only animated ground. Chunk canvases keep water translucent (depth,
//    sky and bank reflections, mirrored trees); under them each frame one pattern
//    fill per chunk lays down the looping water sheet, crossfading between frames.
//    Two shore-foam layers pulse in counter-phase on top.
//  - Rain soaks the ground: a wet version of each visible chunk is painted once (one
//    per frame, never per frame again) and crossfaded in as the wetness rises; the
//    ground dries slowly after the rain stops and the wet canvases are then freed.
//  - Roofs are cached per building and drawn after everything else with a fade.

const MAX_CHUNKS = 36;
const WATER_FPS = 4;
const LOCATION_DEBOUNCE = 0.25;
const SOAK_RATE = 1 / 7; // wetness per second while it rains (scaled by intensity)
const DRY_RATE = 1 / 70; // puddles linger after the rain
const FREE_WET_AFTER = 20; // seconds of dry weather before wet canvases are freed

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
    this.exits = null; // where the King's Road leaves the map (set by worldgen)
    this.wetness = 0; // 0 dry .. 1 soaked (rain)
    this._dryFor = 0;
    this._chunks = new Map();
    this._depth = null;
    this._renderTime = 0;
    this._builtThisFrame = 0;
    this._patterns = null;
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
    if (!this.inBounds(tx, ty)) return;
    const i = ty * this.w + tx;
    if (this.deco[i] === id) return;
    this.deco[i] = id;
    if (this._chunks.size) this.invalidateTile(tx, ty);
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

  // The same distance as a smooth float field (8-way chamfer), for rendering: shallows
  // shade into deeps in soft rounded bands instead of diamonds.
  waterDepthSmooth() {
    if (this._depthS && this._depthSV === this.version) return this._depthS;
    const { w, h } = this;
    const d = new Float32Array(w * h);
    const D2 = Math.SQRT2;
    for (let i = 0; i < w * h; i++) d[i] = WATERY[this.ground[i]] ? 12 : 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!d[i]) continue;
        let v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + 1);
        if (y > 0) {
          v = Math.min(v, d[i - w] + 1);
          if (x > 0) v = Math.min(v, d[i - w - 1] + D2);
          if (x < w - 1) v = Math.min(v, d[i - w + 1] + D2);
        }
        d[i] = v;
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (!d[i]) continue;
        let v = d[i];
        if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
        if (y < h - 1) {
          v = Math.min(v, d[i + w] + 1);
          if (x < w - 1) v = Math.min(v, d[i + w + 1] + D2);
          if (x > 0) v = Math.min(v, d[i + w - 1] + D2);
        }
        d[i] = v;
      }
    }
    this._depthS = d;
    this._depthSV = this.version;
    return d;
  }

  // ---- render cache management ----

  // Blends and baked shadows reach a couple of tiles over chunk borders; mirrored
  // trees reach a few tiles down into the water below them. Touched chunks are only
  // marked stale: they keep drawing until a repaint slot comes up (one per frame), so
  // felling a tree never stalls a frame repainting four chunks at once.
  invalidateTile(tx, ty) {
    const cs = CHUNK;
    for (let dy = -2; dy <= 4; dy += 2) {
      for (let dx = -2; dx <= 2; dx += 2) {
        const c = this._chunks.get(Math.floor((ty + dy) / cs) * 1000 + Math.floor((tx + dx) / cs));
        if (c) c.stale = true;
      }
    }
  }

  invalidateAll() {
    this._chunks.clear();
  }

  _art() {
    return this.game?.atlas?.getMeta?.('tileart') || null;
  }

  _chunk(cx, cy, art) {
    const key = cy * 1000 + cx;
    const old = this._chunks.get(key);
    if (old && (!old.stale || this._builtThisFrame > 0)) {
      old.used = this._renderTime;
      return old;
    }
    const c = paintChunk(art, this, cx, cy, this._shadowCasters(cx, cy));
    c.cx = cx;
    c.cy = cy;
    c.used = this._renderTime;
    c.stale = false;
    // A repainted chunk keeps its old wet twin until a fresh one is soaked, so the
    // street never flashes dry in the rain.
    c.wetCanvas = old?.wetCanvas || null;
    c.wetStale = !!c.wetCanvas;
    if (c.mask) {
      try {
        bakeReflections(c, this, this.game?.objects);
      } catch (err) {
        console.error('[map] water reflections failed', err);
      }
      c.mask = null;
    }
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

  // The rain-soaked twin of a chunk: land only (water stays from the dry canvas).
  _soak(c, art) {
    c.wetCanvas = paintChunk(art, this, c.cx, c.cy, this._shadowCasters(c.cx, c.cy), true).canvas;
    c.wetStale = false;
    this._builtThisFrame++;
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

  // One repeating pattern per water frame, made for the context that draws them.
  _waterPatterns(ctx, art) {
    const p = this._patterns;
    if (p && p.ctx === ctx) return p.list;
    if (!art.water || typeof ctx.createPattern !== 'function') return null;
    const list = art.water.map((c) => ctx.createPattern(c, 'repeat'));
    if (list.some((x) => !x)) return null;
    this._patterns = { ctx, list };
    return list;
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
    const water = this._waterPatterns(ctx, art);
    const n = art.waterFrames;
    const wf = (time * WATER_FPS) % n;
    const f0 = Math.floor(wf);
    const f1 = (f0 + 1) % n;
    const fk = wf - f0;
    const pulse = Math.sin(time * 1.6);
    const wet = this.wetness;
    const alpha0 = ctx.globalAlpha;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = this._chunk(cx, cy, art);
        const X = cx * span - ox;
        const Y = cy * span - oy;
        const wb = c.waterBox;
        if (wb && water) {
          // Clip the fill to the part of the water box on screen.
          const x0 = Math.max(X + wb.x, 0);
          const y0 = Math.max(Y + wb.y, 0);
          const x1 = Math.min(X + wb.x + wb.w, vw);
          const y1 = Math.min(Y + wb.y + wb.h, vh);
          if (x1 > x0 && y1 > y0) {
            // Patterns repeat from the canvas origin; shift them so the water sticks to the world.
            ctx.translate(-ox, -oy);
            ctx.fillStyle = water[f0];
            ctx.fillRect(x0 + ox, y0 + oy, x1 - x0, y1 - y0);
            if (fk > 0.04) {
              ctx.globalAlpha = alpha0 * fk;
              ctx.fillStyle = water[f1];
              ctx.fillRect(x0 + ox, y0 + oy, x1 - x0, y1 - y0);
              ctx.globalAlpha = alpha0;
            }
            ctx.translate(ox, oy);
          }
        }
        ctx.drawImage(c.canvas, X, Y);
        if (wet > 0.01) {
          if ((!c.wetCanvas || c.wetStale) && this._builtThisFrame === 0) this._soak(c, art);
          if (c.wetCanvas) {
            ctx.globalAlpha = alpha0 * Math.min(1, wet);
            ctx.drawImage(c.wetCanvas, X, Y);
            ctx.globalAlpha = alpha0;
          }
        }
        if (c.foamA) {
          ctx.globalAlpha = alpha0 * (0.62 + 0.38 * pulse);
          ctx.drawImage(c.foamA, X + c.foamX, Y + c.foamY);
          ctx.globalAlpha = alpha0 * (0.5 - 0.42 * pulse);
          ctx.drawImage(c.foamB, X + c.foamX, Y + c.foamY);
          ctx.globalAlpha = alpha0;
        }
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

  // Paint ahead between frames: soak a visible chunk while it rains, otherwise build
  // one missing chunk around the camera, so walking rarely waits.
  _warmup() {
    const art = this._art();
    const cam = this.game?.camera;
    if (!art || !cam || this._builtThisFrame > 0 || typeof document === 'undefined') return;
    const span = CHUNK * TILE;
    for (const c of this._chunks.values()) {
      if (c.stale && this._renderTime - c.used < 0.5) {
        this._chunk(c.cx, c.cy, art);
        return;
      }
    }
    if (this.wetness > 0.01) {
      for (const c of this._chunks.values()) {
        if ((!c.wetCanvas || c.wetStale) && this._renderTime - c.used < 0.5) {
          this._soak(c, art);
          return;
        }
      }
    }
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

  // Rain soaks the ground quickly; it dries slowly once the sky clears.
  _updateWetness(dt) {
    const w = this.game?.clock?.weather;
    const raining = w?.type === 'rain';
    if (raining) {
      const k = Math.max(0.3, Math.min(1, w.intensity ?? 1));
      this.wetness = Math.min(1, this.wetness + dt * SOAK_RATE * k);
      this._dryFor = 0;
      return;
    }
    if (this.wetness > 0) this.wetness = Math.max(0, this.wetness - dt * DRY_RATE);
    if (this.wetness > 0) return;
    this._dryFor += dt;
    if (this._dryFor > FREE_WET_AFTER) {
      this._dryFor = -Infinity; // freed; nothing to do until the next rain
      for (const c of this._chunks.values()) {
        c.wetCanvas = null;
        c.wetStale = false;
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
    this._updateWetness(dt);
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
