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
//   buffer origin (ox, oy). Its light is kept as a second small picture, which drawGlow()
//   lays over the lit picture with 'lighter' (overlapping lights sum), after the night's
//   lighting, so effects glow at night and stay crisp by day.
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
const CAP_DESKTOP = 24;
const CAP_PHONE = 12;
const STEP_MAX = 0.25; // the longest step an effect takes at once (the loop's own cap: a stalled tab)
// Painting is the host's real cost (pixelfx draws in JS, pixel by pixel). Past this much
// painting in one rendered frame, effects keep showing their last picture for a frame or
// two (loops up to 3, one-shots 1) instead of repainting, so a brawl full of effects costs
// about the same as a quiet fight; each effect's first frame is always painted.
const PAINT_BUDGET_MS = 1.6;
const FLASH_KEEP = 0.1; // s: an effect with a budget (spec.max) is never cut before this
const now = typeof performance !== 'undefined' && performance.now ? () => performance.now() : () => Date.now();
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
    this._glows = []; // this frame's lit parts: { canvas, sx, sy, sw, sh, bx, by, k } (pooled)
    this._glowN = 0;
    this._proxies = [];
    this._stamp = -1; // the renderer frame the glow list belongs to
    this._paintAt = -1; // the renderer frame the paint time belongs to
    this._paintMs = 0;
    this.paintBudget = opts.paintBudget ?? PAINT_BUDGET_MS;
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

  // (read once per rendered frame: the canvas size is a layout read, and play() runs often)
  get phone() {
    const g = this.game;
    const stamp = g?.renderer?.frame;
    if (this._phoneAt === stamp && stamp != null) return this._phone;
    let phone = !!g?.ui?.isTouch;
    if (!phone) {
      const c = g?.renderer?.canvas;
      const w = c?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1280);
      const h = c?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 720);
      phone = Math.min(w, h) < 500;
    }
    this._phoneAt = stamp;
    this._phone = phone;
    return phone;
  }

  // How many of one effect may play at once (spec.max, halved on phones), or Infinity.
  budget(spec) {
    if (!Number.isFinite(spec?.max)) return Infinity;
    return this.phone ? Math.max(1, Math.ceil(spec.max / 2)) : spec.max;
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
    // An effect that wraps a body is made round OUR body from the start: pixelfx would
    // otherwise build it round its 24x38 side-on stand-in (resolveOptions), and effects
    // that read the body once when made (heal's size and rows, soul-rise's copy of the
    // body) would draw that stand-in over ours. No readable body: not started (the
    // caller keeps its old look), and nothing is pushed out for it.
    let body = null;
    if (spec.actor) {
      body = o.actor || (o.follow && this.actorOf ? this.actorOf(o.follow) : null);
      if (!body) {
        this.stats.refused++;
        return null;
      }
    }
    const prio = o.priority ?? spec.priority;
    // An effect with a budget of its own (spec.max: the everyday hit spark) replaces its own
    // oldest when at it, so a brawl's flurry of sparks never pushes statuses off the bodies.
    // One still in its first flash is not cut: the newcomer is refused instead (a blast's
    // dozen hits in one frame: the first ones keep their sparks, the rest their old look).
    const budget = this.budget(spec);
    if (budget < Infinity) {
      let n = 0;
      let oldest = -1;
      for (let i = 0; i < this.live.length; i++)
        if (this.live[i].id === id) {
          if (oldest < 0) oldest = i;
          n++;
        }
      if (n >= budget && oldest >= 0) {
        if (this.live[oldest].t < FLASH_KEEP) {
          this.stats.refused++;
          return null;
        }
        this._release(this.live[oldest]);
        this.live.splice(oldest, 1);
        this.stats.evicted++;
      }
    }
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
    if (body) opts.actor = body;
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
    const c = inst.parts[k] || (inst.parts[k] = { fi: -1, wait: 0, pic: null, any: false, bx: 0, by: 0, bw: 0, bh: 0, lpic: null, lit: false, lx: 0, ly: 0, lw: 0, lh: 0 });
    const x0 = inst.x + inst.box[0];
    const y0 = inst.y + inst.box[1];
    const fi = Math.floor(inst.fx.t * inst.fps + 1e-6);
    if (c.fi !== fi) {
      const stamp = this.game?.renderer?.frame;
      if (stamp !== this._paintAt) {
        this._paintAt = stamp;
        this._paintMs = 0;
      }
      if (c.fi >= 0 && c.wait < (inst.loop ? 3 : 1) && this._paintMs > this.paintBudget) {
        // over this frame's budget: the last picture again, moved with its body
        c.wait++;
        this.stats.waited = (this.stats.waited || 0) + 1;
      } else {
        const t0 = now();
        const ok = this._paint(inst, part, c, x0, y0);
        this._paintMs += now() - t0;
        if (!ok) return;
        c.fi = fi;
        c.wait = 0;
      }
    }
    if (c.lit && c.lpic) this._glow(c, x0 - ox, y0 - oy, inst.lightK);
    if (c.any && c.pic) ctx.drawImage(c.pic.canvas, c.bx, c.by, c.bw, c.bh, x0 - ox + c.bx, y0 - oy + c.by, c.bw, c.bh);
  }

  // Paint a part afresh: clear the frame, let the effect draw, keep its color as a picture
  // and its light as another (each cut to the box it fills). False when it could not be drawn.
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
    // one pass: the boxes round its color and round its light (an empty frame, between
    // flickers or before a delay, needs no picture; most frames fill a small part of their
    // bounds, and only that part is uploaded and drawn)
    const W = inst.w;
    const H = inst.h;
    let minX = W;
    let maxX = -1;
    let minY = H;
    let maxY = -1;
    let lx0 = W;
    let lx1 = -1;
    let ly0 = H;
    let ly1 = -1;
    let i = 0;
    for (let y = 0; y < H; y++) {
      let row = false;
      let lrow = false;
      for (let x = 0; x < W; x++, i++) {
        if (C[i]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          row = true;
        }
        if (L[i]) {
          if (x < lx0) lx0 = x;
          if (x > lx1) lx1 = x;
          lrow = true;
        }
      }
      if (row) {
        if (y < minY) minY = y;
        maxY = y;
      }
      if (lrow) {
        if (y < ly0) ly0 = y;
        ly1 = y;
      }
    }
    c.any = false;
    if (maxX >= 0) {
      if (!c.pic) c.pic = this._scratch(W, H);
      if (c.pic) {
        c.pic.u32.set(C.subarray(0, n));
        c.bx = minX;
        c.by = minY;
        c.bw = maxX - minX + 1;
        c.bh = maxY - minY + 1;
        c.pic.ctx.putImageData(c.pic.img, 0, 0, c.bx, c.by, c.bw, c.bh);
        c.any = true;
      }
    }
    // its light as an opaque picture of the light's color (added with 'lighter' after the
    // night's lighting, drawGlow): unlit pixels stay clear
    c.lit = false;
    if (lx1 >= 0) {
      if (!c.lpic) c.lpic = this._scratch(W, H);
      const P = c.lpic;
      if (P) {
        const u = P.u32;
        for (let y = ly0; y <= ly1; y++) {
          const row = y * W;
          for (let x = lx0; x <= lx1; x++) {
            const l = L[row + x];
            u[row + x] = l ? 0xff000000 | (l & 0xffffff) : 0;
          }
        }
        c.lx = lx0;
        c.ly = ly0;
        c.lw = lx1 - lx0 + 1;
        c.lh = ly1 - ly0 + 1;
        P.ctx.putImageData(P.img, 0, 0, c.lx, c.ly, c.lw, c.lh);
        c.lit = true;
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

  // A lit part drawn this frame, at (bx, by) in the buffer: noted for drawGlow (the list is
  // this renderer frame's; its records are reused).
  _glow(c, bx, by, k) {
    const r = this.game?.renderer;
    const stamp = r ? r.frame : 0;
    if (stamp !== this._stamp) {
      this._stamp = stamp;
      this._glowN = 0;
    }
    let g = this._glows[this._glowN];
    if (!g) g = this._glows[this._glowN] = { canvas: null, sx: 0, sy: 0, sw: 0, sh: 0, bx: 0, by: 0, k: 1 };
    this._glowN++;
    g.canvas = c.lpic.canvas;
    g.sx = c.lx;
    g.sy = c.ly;
    g.sw = c.lw;
    g.sh = c.lh;
    g.bx = bx + c.lx;
    g.by = by + c.ly;
    g.k = k;
    return true;
  }

  // After the lighting (renderer hook): each lit part's light, pixel-sharp, added on top with
  // 'lighter' (lights that overlap sum). By day it is held back a little so glows never wash
  // the colors out. Only the boxes that hold light are drawn, never the whole view.
  drawGlow(ctx, r) {
    if (!r || r.frame !== this._stamp || !this._glowN) return;
    const dark = this.game?.lighting?.ambient?.darkness ?? 0;
    const day = Math.min(1, 0.62 + 0.5 * dark) * this.lightK;
    const s = r.scale || 1;
    const sx = r.subX || 0;
    const sy = r.subY || 0;
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < this._glowN; i++) {
      const g = this._glows[i];
      ctx.globalAlpha = Math.min(1, day * g.k);
      ctx.drawImage(g.canvas, g.sx, g.sy, g.sw, g.sh, g.bx * s - sx, g.by * s - sy, g.sw * s, g.sh * s);
      g.canvas = null;
    }
    this._glowN = 0;
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
      if (!c) continue;
      for (const pic of [c.pic, c.lpic]) {
        if (!pic) continue;
        const key = pic.key || `${pic.canvas?.width}x${pic.canvas?.height}`;
        let free = this._img.get(key);
        if (!free) this._img.set(key, (free = []));
        if (free.length < 24) free.push(pic);
      }
      c.pic = null;
      c.lpic = null;
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
