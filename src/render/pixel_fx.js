import { createFrame, createFx } from '../vendor/pixelfx/core/fx.js';

// The pixelfx host (DESIGN §30): plays pixelfx effects (src/vendor/pixelfx, MIT, see
// THIRD_PARTY.md) inside the world buffer, at 1 buffer px = 1 world px, so they are
// pixel art at the game's own resolution and scale up with everything else.
//
//   game.pixelFx.play(id, { x, y, follow, flip, angle, palette, layer, seed, ...opts }) -> handle
//   game.pixelFx.stop(handle | tag)
//
// How it works:
// - Every effect id is a spec (src/render/pixel_fx_catalog.js): the effect module, its
//   bounds round its anchor, its layer and priority, its default options, and what it
//   does under reduced motion.
// - A live effect owns a pooled frame (pixelfx's two buffers, color and light) sized to
//   its bounds. Each frame it is cleared, drawn by the effect, its color composited into
//   a reused ImageData and blitted into the world buffer at its world spot minus the
//   buffer origin (ox, oy). Its light is added into one shared light buffer the size of
//   the world buffer, which drawGlow() lays over the lit picture with 'lighter', after
//   the night's lighting, so effects glow at night and stay crisp by day.
// - Layers: 'ground' lies on the floor under everyone (rings, scorch, frost, pools),
//   'body' is y-sorted with the actors (its back half just behind the anchor's feet, its
//   front half just in front: statuses, auras, things on a body), 'top' is over every
//   actor and spell (flashes, bursts, sparks). Effects that follow a body track it.
// - Culled when off screen; a cap on concurrent effects (lower on phones, halved with
//   reduced motion) evicts the oldest lowest-priority effect first.
// - Time: update(dt) is called with the world's step, so effects freeze while the game
//   is paused or in a hit-stop and slow with timeScale.
// - Reduced motion: specs may be skipped, scaled down or given calmer options (no white
//   flashes, fewer particles) through spec.reduce; every effect gets its own `calm` mode,
//   is drawn 15% smaller, glows half as much, and has its white pixels drawn in its ramp's
//   brightest color, so nothing flashes white. The cap is halved.

const MARGIN = 24; // px past the view an effect may reach and still be drawn
const SPAWN_MARGIN = 80; // a one-shot further than this off screen is not started at all
const CAP_DESKTOP = 28;
const CAP_PHONE = 14;
const STEP_MAX = 0.25; // the longest step an effect takes at once (the loop's own cap: a stalled tab)
const EMPTY_LIT = new Int32Array(0);
const REDUCE_SIZE = 0.85; // reduced motion: effects a little smaller...
const REDUCE_LIGHT = 0.5; // ...with half the glow...
const WHITE_MIN = 236; // ...and no white flashes: a pixel this bright in every channel is "white"

// The brightest color of a ramp that is not white, as a frame pixel (ABGR), for reduced motion.
export function softWhite(palette) {
  const list = Array.isArray(palette) ? palette : [];
  let best = 0;
  let bestL = -1;
  for (const c of list) {
    // '#rrggbb', or a number already in pixelfx's frame order (ABGR)
    const str = typeof c === 'string';
    const v = str ? parseInt(c.replace('#', '').slice(0, 6), 16) : Number(c);
    if (!Number.isFinite(v)) continue;
    const r = str ? (v >> 16) & 255 : v & 255;
    const g = (v >> 8) & 255;
    const b = str ? v & 255 : (v >>> 16) & 255;
    if (r >= WHITE_MIN && g >= WHITE_MIN && b >= WHITE_MIN) continue;
    const L = r * 0.3 + g * 0.59 + b * 0.11;
    if (L > bestL) {
      bestL = L;
      best = (b << 16) | (g << 8) | r;
    }
  }
  return bestL < 0 ? 0xc8d0d8 : best; // (as 0xBBGGRR; a pale grey when the ramp is all white)
}

// Reduced motion: every white pixel of a frame takes the soft color (alpha kept).
export function softenWhites(color, n, soft) {
  for (let i = 0; i < n; i++) {
    const c = color[i];
    if (!c) continue;
    if ((c & 255) >= WHITE_MIN && ((c >>> 8) & 255) >= WHITE_MIN && ((c >>> 16) & 255) >= WHITE_MIN) color[i] = (c & 0xff000000) | soft;
  }
}

let nextId = 1;

function roundUp(v, k) {
  return Math.ceil(v / k) * k;
}

// The box an effect may draw in round its anchor: [x0, y0, x1, y1], from the spec's own
// bounds or the module's meta.size and meta.origin, grown to hold any rotation.
export function effectBox(spec, angle = 0, scale = 1) {
  let b = spec.bounds;
  if (!b) {
    const m = spec.mod?.meta || {};
    const [w, h] = m.size || [64, 64];
    const [ox, oy] = m.origin || [w / 2, h / 2];
    b = [-ox, -oy, w - ox, h - oy];
  }
  let [x0, y0, x1, y1] = b;
  if (scale !== 1) {
    x0 *= scale;
    y0 *= scale;
    x1 *= scale;
    y1 *= scale;
  }
  if (angle && spec.rotates) {
    const r = Math.ceil(Math.max(Math.hypot(x0, y0), Math.hypot(x1, y0), Math.hypot(x0, y1), Math.hypot(x1, y1)));
    return [-r, -r, r, r];
  }
  return [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)];
}

export class PixelFx {
  constructor(game, catalog = {}, opts = {}) {
    this.game = game;
    this.specs = new Map();
    for (const [id, spec] of Object.entries(catalog)) this.define(id, spec);
    this.live = [];
    this._pool = new Map(); // "w x h" -> frames ready for reuse
    this._img = new Map(); // "w x h" -> free pictures ({ canvas, ctx, img, u32 }) for painted parts
    this._light = null; // { w, h, buf: Uint32Array, canvas, ctx, img, x0, y0, x1, y1 }
    this._proxies = [];
    this._stamp = 0; // the renderer frame the light buffer belongs to
    this.capDesktop = opts.cap ?? CAP_DESKTOP;
    this.capPhone = opts.capPhone ?? CAP_PHONE;
    this.stats = { played: 0, refused: 0, evicted: 0, drawn: 0, culled: 0 };
    this._warned = new Set();
    this.lightK = 1;
    this.actorOf = null; // (entity) -> pixelfx body, for effects that wrap one (spec.actor)
    this.director = null; // keeps long-lived effects in step with the world (pixel_fx_play.js)
  }

  define(id, spec) {
    if (!spec || !spec.mod) return;
    this.specs.set(id, { layer: 'top', priority: 1, ...spec });
  }

  has(id) {
    return this.specs.has(id);
  }

  get count() {
    return this.live.length;
  }

  get reduceMotion() {
    return !!this.game?.settings?.reduceMotion;
  }

  get phone() {
    const g = this.game;
    if (g?.ui?.isTouch) return true;
    const c = g?.renderer?.canvas;
    const w = c?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1280);
    const h = c?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 720);
    return Math.min(w, h) < 500;
  }

  // How many effects may play at once right now.
  get cap() {
    const base = this.phone ? this.capPhone : this.capDesktop;
    return this.reduceMotion ? Math.max(4, Math.floor(base / 2)) : base;
  }

  warn(what, err) {
    if (this._warned.has(what)) return;
    this._warned.add(what);
    console.warn(`[pixel fx] ${what} failed`, err);
  }

  // ------------------------------------------------------------------ playing

  // Start an effect. o: { x, y (world px; the anchor), follow (an entity to track: its
  // feet, plus o.dx/o.dy), flip, angle (radians), palette, layer, seed, tag, scale, light,
  // life (stop a loop after this long), ...the effect's own options }. Returns a handle
  // (pass it to stop) or null when it was not started (unknown id, off screen, over the
  // cap with nothing less important to drop, or skipped under reduced motion).
  play(id, o = {}) {
    const spec = this.specs.get(id);
    if (!spec) return null;
    const reduce = this.reduceMotion;
    if (reduce && spec.reduce === false) return null;
    let x = o.follow ? o.follow.x + (o.dx || 0) : o.x;
    let y = o.follow ? o.follow.y + (o.dy || 0) : o.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const loop = !!spec.mod.meta?.loop;
    if (!loop && !o.follow && !this._nearView(x, y, SPAWN_MARGIN)) {
      this.stats.culled++;
      return null;
    }
    const prio = o.priority ?? spec.priority;
    if (this.live.length >= this.cap && !this._evictFor(prio)) {
      this.stats.refused++;
      return null;
    }
    // Options: the effect's defaults, the spec's, reduced-motion overrides, the caller's.
    const red = reduce && spec.reduce && typeof spec.reduce === 'object' ? spec.reduce : null;
    const scale = (o.scale ?? spec.scale ?? 1) * (red?.scale ?? 1);
    // An aim turns the painter only for effects drawn flat in the view (spec.rotates); the
    // top-down variants take it as their own `aim`, so whatever hops or rises still rises.
    const angle = Number.isFinite(o.angle) ? o.angle : 0;
    // (an option the caller left undefined keeps the default, so `palette: pal && ramp` is safe)
    const opts = { ...(spec.opts || {}), ...(red?.opts || {}) };
    for (const k in o) if (o[k] !== undefined) opts[k] = o[k];
    opts.angle = spec.rotates ? angle : 0;
    if (!spec.rotates && Number.isFinite(o.angle)) opts.aim = angle;
    if (reduce) {
      // calmer: the effect's own calm mode where it has one, and a little smaller
      opts.calm = true;
      if (typeof opts.size === 'number') opts.size *= REDUCE_SIZE;
    }
    delete opts.follow;
    delete opts.layer;
    delete opts.priority;
    delete opts.tag;
    delete opts.life;
    delete opts.dx;
    delete opts.dy;
    // An effect that wraps a body is made round OUR body from the start: pixelfx would
    // otherwise build it round its 24x38 side-on stand-in (resolveOptions), and effects
    // that read the body once when made (heal's size and rows, soul-rise's copy of the
    // body) would draw that stand-in over ours. No readable body: not started (the
    // caller keeps its old look).
    if (spec.actor) {
      const a = o.actor || (o.follow && this.actorOf ? this.actorOf(o.follow) : null);
      if (!a) {
        this.stats.refused++;
        return null;
      }
      opts.actor = a;
    }
    if (typeof spec.prepare === 'function') {
      try {
        spec.prepare(opts, o, this);
      } catch (err) {
        this.warn(`prepare ${id}`, err);
        return null;
      }
    }
    const box = o.bounds ? o.bounds.map(Math.round) : effectBox(spec, opts.angle || 0, scale);
    delete opts.bounds;
    x = Math.round(x);
    y = Math.round(y);
    let fx;
    try {
      fx = createFx(spec.mod, { ...opts, x, y });
    } catch (err) {
      this.warn(`create ${id}`, err);
      return null;
    }
    const w = roundUp(box[2] - box[0], 8);
    const h = roundUp(box[3] - box[1], 8);
    const inst = {
      uid: nextId++,
      id,
      spec,
      fx,
      x,
      y,
      box,
      w,
      h,
      frame: this._takeFrame(w, h),
      follow: o.follow || null,
      dx: o.dx || 0,
      dy: o.dy || 0,
      layer: o.layer || spec.layer,
      priority: prio,
      tag: o.tag ?? null,
      life: Number.isFinite(o.life) ? o.life : Number.isFinite(spec.life) ? spec.life : Infinity,
      t: 0,
      loop,
      lightK: (opts.lightScale ?? 1) * (spec.lightK ?? 1) * (reduce ? REDUCE_LIGHT : 1),
      // under reduced motion, white pixels are drawn in the ramp's brightest color instead
      soft: reduce ? softWhite(opts.palette || spec.mod.meta?.options?.palette) : 0,
      stopped: false,
      proxyBack: null,
      proxyFront: null,
      // painted at the effect's own frame rate (pixelfx effects are made at 30 fps)
      fps: Math.min(60, spec.fps ?? spec.mod.meta?.fps ?? 30),
      parts: [], // [back, front|whole]: { fi (the frame painted), pic, any, lit }
    };
    inst.handle = { uid: inst.uid, id };
    this.live.push(inst);
    this.stats.played++;
    return inst.handle;
  }

  // Let an effect end: a loop fades out, a one-shot is cut short. By handle or by tag.
  stop(which) {
    if (!which) return 0;
    let n = 0;
    for (const inst of this.live) {
      if (inst.stopped) continue;
      if (which === inst.handle || which.uid === inst.uid || (typeof which === 'string' && inst.tag === which)) {
        inst.stopped = true;
        try {
          inst.fx.stop();
        } catch {
          /* ignore */
        }
        n++;
      }
    }
    return n;
  }

  // Is this handle (or tag) still playing?
  playing(which) {
    for (const inst of this.live) if (inst.handle === which || (typeof which === 'string' && inst.tag === which)) return !inst.stopped || !inst.fx.done();
    return false;
  }

  clear() {
    for (const inst of this.live) this._release(inst);
    this.live.length = 0;
  }

  _evictFor(prio) {
    // The oldest of the least important effects goes, if it matters less than (or as much
    // as) the newcomer.
    let worst = -1;
    for (let i = 0; i < this.live.length; i++) {
      const a = this.live[i];
      if (worst < 0 || a.priority < this.live[worst].priority) worst = i;
    }
    if (worst < 0 || this.live[worst].priority > prio) return false;
    this._release(this.live[worst]);
    this.live.splice(worst, 1);
    this.stats.evicted++;
    return true;
  }

  _nearView(x, y, m) {
    const cam = this.game?.camera;
    if (!cam || !Number.isFinite(cam.x)) return true;
    return x > cam.x - m && x < cam.x + (cam.vw || 0) + m && y > cam.y - m && y < cam.y + (cam.vh || 0) + m + 40;
  }

  // ------------------------------------------------------------------ time

  // One world step (paused, cutscene and hit-stop steps never call this).
  update(dt) {
    if (!(dt > 0)) return;
    const step = Math.min(STEP_MAX, dt);
    const list = this.live;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const inst = list[i];
      const f = inst.follow;
      if (f) {
        if (f.removed || f.dead) {
          if (!inst.stopped) this.stop(inst.handle);
        } else {
          inst.x = Math.round(f.x + inst.dx);
          inst.y = Math.round(f.y + inst.dy);
          if (inst.spec.sync) inst.spec.sync(inst.fx.options, f);
        }
      }
      inst.t += step;
      if (!inst.stopped && inst.t >= inst.life) this.stop(inst.handle);
      let done = false;
      try {
        inst.fx.update(step);
        done = inst.fx.done();
      } catch (err) {
        this.warn(`update ${inst.id}`, err);
        done = true;
      }
      if (done) this._release(inst);
      else list[w++] = inst;
    }
    list.length = w;
  }

  // ------------------------------------------------------------------ drawing

  // The renderer asks for drawables near the view (y-sorted with everything else):
  // ground effects first of all, body effects bracketing their anchor, top effects last.
  collect(list, x0, y0, x1, y1) {
    const live = this.live;
    for (let i = 0; i < live.length; i++) {
      const inst = live[i];
      const bx0 = inst.x + inst.box[0];
      const by0 = inst.y + inst.box[1];
      const bx1 = inst.x + inst.box[2];
      const by1 = inst.y + inst.box[3];
      if (bx1 < x0 - MARGIN || bx0 > x1 + MARGIN || by1 < y0 - MARGIN || by0 > y1 + MARGIN) continue;
      if (!inst.proxyFront) this._makeProxies(inst);
      const L = inst.layer;
      if (L === 'ground') {
        inst.proxyFront.sortY = -1e9 + inst.y;
        list.push(inst.proxyFront);
      } else if (L === 'body') {
        inst.proxyBack.sortY = inst.y - 0.01;
        inst.proxyFront.sortY = inst.y + 0.01;
        list.push(inst.proxyBack, inst.proxyFront);
      } else {
        inst.proxyFront.sortY = 2e6 + inst.y;
        list.push(inst.proxyFront);
      }
    }
  }

  _makeProxies(inst) {
    const host = this;
    const both = inst.layer !== 'body';
    inst.proxyFront = {
      sortY: 0,
      pixelFx: inst.id,
      draw(ctx, ox, oy) {
        host._drawInst(inst, both ? null : 'front', ctx, ox, oy);
      },
    };
    inst.proxyBack = {
      sortY: 0,
      pixelFx: inst.id,
      draw(ctx, ox, oy) {
        host._drawInst(inst, 'back', ctx, ox, oy);
      },
    };
  }

  // Draw one part ('back', 'front', or the whole effect) into the buffer. pixelfx effects are
  // authored at their own frame rate (30 fps): a part is repainted only when the effect moves
  // on to its next frame, and in between its picture (and its light) is reused, moved with
  // its body. A game running at 60 fps paints each effect half as often.
  _drawInst(inst, part, ctx, ox, oy) {
    if (!ctx || !inst.frame) return;
    const k = part === 'back' ? 0 : 1;
    const c = inst.parts[k] || (inst.parts[k] = { fi: -1, pic: null, any: false, lit: EMPTY_LIT, litN: 0 });
    const x0 = inst.x + inst.box[0];
    const y0 = inst.y + inst.box[1];
    const fi = Math.floor(inst.fx.t * inst.fps + 1e-6);
    if (c.fi !== fi) {
      if (!this._paint(inst, part, c, x0, y0)) return;
      c.fi = fi;
    }
    if (c.litN) this._addLit(c.lit, c.litN, inst.w, x0 - ox, y0 - oy, inst.lightK);
    if (c.any && c.pic) ctx.drawImage(c.pic.canvas, 0, 0, inst.w, inst.h, x0 - ox, y0 - oy, inst.w, inst.h);
  }

  // Paint a part afresh: clear the frame, let the effect draw, keep its color as a picture
  // and its light as a short list of lit pixels. False when it could not be drawn.
  _paint(inst, part, c, x0, y0) {
    const fr = inst.frame;
    fr.ox = x0;
    fr.oy = y0;
    const n = inst.w * inst.h;
    fr.color.fill(0, 0, n);
    fr.light.fill(0, 0, n);
    inst.fx.options.x = inst.x;
    inst.fx.options.y = inst.y;
    // Effects on a body wrap the sprite frame the game draws this instant.
    if (inst.spec.actor && inst.follow) {
      const a = this.actorOf ? this.actorOf(inst.follow) : null;
      if (!a) return false;
      inst.fx.options.actor = a;
    }
    try {
      inst.fx.draw(fr, part);
    } catch (err) {
      this.warn(`draw ${inst.id}`, err);
      inst.stopped = true;
      inst.life = 0;
      return false;
    }
    this.stats.drawn++;
    const C = fr.color;
    const L = fr.light;
    if (inst.soft) softenWhites(C, n, inst.soft);
    // one pass: is there any color (an empty frame, between flickers or before a delay, needs
    // no picture), and its light as (index, value) pairs
    let any = false;
    let lit = c.lit;
    let m = 0;
    for (let i = 0; i < n; i++) {
      if (C[i]) any = true;
      const l = L[i];
      if (l) {
        if (m + 2 > lit.length) {
          const bigger = new Int32Array(Math.max(64, lit.length * 2));
          bigger.set(lit.subarray(0, m));
          lit = c.lit = bigger;
        }
        lit[m++] = i;
        lit[m++] = l;
      }
    }
    c.litN = m;
    c.any = false;
    if (any) {
      if (!c.pic) c.pic = this._scratch(inst.w, inst.h);
      if (c.pic) {
        c.pic.u32.set(C.subarray(0, n));
        c.pic.ctx.putImageData(c.pic.img, 0, 0);
        c.any = true;
      }
    }
    return true;
  }

  // A picture to keep a painted part in (pooled by size).
  _scratch(w, h) {
    const key = `${w}x${h}`;
    const free = this._img.get(key);
    if (free && free.length) return free.pop();
    if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return null;
    try {
      const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
      const c = canvas.getContext('2d');
      const img = c.createImageData(w, h);
      return { canvas, ctx: c, img, u32: new Uint32Array(img.data.buffer), key };
    } catch (err) {
      this.warn('scratch canvas', err);
      return null;
    }
  }

  // Light into the shared light buffer (the world buffer's size), summed.
  _addLit(lit, n, fw, bx, by, k) {
    const Lb = this._lightBuf();
    if (!Lb) return false;
    const r = this.game?.renderer;
    if (r && r.frame !== this._stamp) this._beginLight(r.frame);
    const W = Lb.w;
    const H = Lb.h;
    const buf = Lb.buf;
    const kk = k * this.lightK;
    let x0 = Lb.x0;
    let x1 = Lb.x1;
    let y0 = Lb.y0;
    let y1 = Lb.y1;
    let any = false;
    for (let j = 0; j < n; j += 2) {
      const i0 = lit[j];
      const l = lit[j + 1] >>> 0;
      const fy = (i0 / fw) | 0;
      const ty = by + fy;
      if (ty < 0 || ty >= H) continue;
      const tx = bx + (i0 - fy * fw);
      if (tx < 0 || tx >= W) continue;
      const i = ty * W + tx;
      const d = buf[i];
      let rr = (l & 255) * kk;
      let gg = ((l >>> 8) & 255) * kk;
      let b = ((l >>> 16) & 255) * kk;
      if (d) {
        rr += d & 255;
        gg += (d >>> 8) & 255;
        b += (d >>> 16) & 255;
      }
      buf[i] = (255 << 24) | ((b > 255 ? 255 : b) << 16) | ((gg > 255 ? 255 : gg) << 8) | (rr > 255 ? 255 : rr);
      if (tx < x0) x0 = tx;
      if (tx > x1) x1 = tx;
      if (ty < y0) y0 = ty;
      if (ty > y1) y1 = ty;
      any = true;
    }
    Lb.x0 = x0;
    Lb.x1 = x1;
    Lb.y0 = y0;
    Lb.y1 = y1;
    return any;
  }

  _lightBuf() {
    const r = this.game?.renderer;
    const buf = r?.buffer;
    if (!buf) return null;
    const w = buf.width;
    const h = buf.height;
    let Lb = this._light;
    if (!Lb || Lb.w !== w || Lb.h !== h) {
      try {
        const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(w, h);
        Lb = this._light = { w, h, canvas, ctx, img, buf: new Uint32Array(img.data.buffer), x0: w, y0: h, x1: -1, y1: -1, shownX0: 0, shownY0: 0, shownX1: -1, shownY1: -1 };
      } catch (err) {
        this.warn('light buffer', err);
        return null;
      }
    }
    return Lb;
  }

  _beginLight(stamp) {
    const Lb = this._light;
    this._stamp = stamp;
    if (!Lb) return;
    if (Lb.x1 >= Lb.x0) {
      for (let y = Lb.y0; y <= Lb.y1; y++) Lb.buf.fill(0, y * Lb.w + Lb.x0, y * Lb.w + Lb.x1 + 1);
    }
    Lb.x0 = Lb.w;
    Lb.y0 = Lb.h;
    Lb.x1 = -1;
    Lb.y1 = -1;
  }

  // After the lighting (renderer hook): the summed light, pixel-sharp, added on top. By
  // day it is held back a little so glows never wash the colors out.
  drawGlow(ctx, r) {
    const Lb = this._light;
    if (!Lb || !r || r.frame !== this._stamp || Lb.x1 < Lb.x0) return;
    const dark = this.game?.lighting?.ambient?.darkness ?? 0;
    const k = Math.min(1, 0.62 + 0.5 * dark);
    const x0 = Lb.x0;
    const y0 = Lb.y0;
    const w = Lb.x1 - x0 + 1;
    const h = Lb.y1 - y0 + 1;
    Lb.ctx.putImageData(Lb.img, 0, 0, x0, y0, w, h);
    const s = r.scale || 1;
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = k;
    ctx.drawImage(Lb.canvas, x0, y0, w, h, x0 * s - (r.subX || 0), y0 * s - (r.subY || 0), w * s, h * s);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prevOp || 'source-over';
  }

  // ------------------------------------------------------------------ frames

  _takeFrame(w, h) {
    const key = `${w}x${h}`;
    const list = this._pool.get(key);
    if (list && list.length) return list.pop();
    return createFrame(w, h, 0, 0);
  }

  _release(inst) {
    for (const c of inst.parts) {
      const pic = c?.pic;
      if (!pic) continue;
      c.pic = null;
      const key = pic.key || `${pic.canvas?.width}x${pic.canvas?.height}`;
      let free = this._img.get(key);
      if (!free) this._img.set(key, (free = []));
      if (free.length < 12) free.push(pic);
    }
    inst.parts.length = 0;
    const fr = inst.frame;
    if (!fr) return;
    inst.frame = null;
    const key = `${fr.w}x${fr.h}`;
    let list = this._pool.get(key);
    if (!list) this._pool.set(key, (list = []));
    if (list.length < 6) list.push(fr);
  }
}
