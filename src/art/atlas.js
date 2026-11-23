import { makeCanvas, flipX, silhouette } from './pixel.js';

// The sprite registry. Art modules generate canvases at boot and register them
// here by name; game code draws by name. See DESIGN.md ("Art and the atlas") for
// the naming scheme every module relies on.
//
// A sprite entry: { frames: Canvas[], ox, oy, w, h, fps }
//   ox, oy  = anchor inside the frame (for actors and props: the feet / base point)
//   fps     = default animation speed when drawn with drawAnim()

export class Atlas {
  constructor() {
    this.sprites = new Map();
    this.flipCache = new Map();
    this.flashCache = new Map();
    this.meta = new Map(); // free-form metadata per key (e.g. character anim tables)
  }

  makeCanvas(w, h) {
    return makeCanvas(w, h);
  }

  add(name, frames, { ox = 0, oy = 0, fps = 6 } = {}) {
    const list = Array.isArray(frames) ? frames : [frames];
    const w = list[0]?.width ?? 0;
    const h = list[0]?.height ?? 0;
    this.sprites.set(name, { frames: list, ox, oy, w, h, fps });
    return this.sprites.get(name);
  }

  has(name) {
    return this.sprites.has(name);
  }

  get(name) {
    return this.sprites.get(name) || null;
  }

  setMeta(key, value) {
    this.meta.set(key, value);
  }

  getMeta(key) {
    return this.meta.get(key);
  }

  frame(name, index = 0) {
    const s = this.sprites.get(name);
    if (!s) return null;
    const n = s.frames.length;
    return s.frames[((index % n) + n) % n];
  }

  // Draw frame `index` of sprite `name` with its anchor at world-screen pixel (x, y).
  // opts: { flip, alpha, flash (0..1 white overlay), tint }
  draw(ctx, name, index, x, y, opts = {}) {
    const s = this.sprites.get(name);
    if (!s) return false;
    const n = s.frames.length;
    const fi = ((index % n) + n) % n;
    let img = s.frames[fi];
    if (opts.flip) img = this._flipped(name, fi, img);
    const dx = Math.round(x - (opts.flip ? s.w - s.ox : s.ox));
    const dy = Math.round(y - s.oy);
    const prevAlpha = ctx.globalAlpha;
    if (opts.alpha != null) ctx.globalAlpha = prevAlpha * opts.alpha;
    ctx.drawImage(img, dx, dy);
    if (opts.flash > 0) {
      ctx.globalAlpha = prevAlpha * Math.min(1, opts.flash);
      ctx.drawImage(this._flash(name, fi, img, !!opts.flip), dx, dy);
    }
    ctx.globalAlpha = prevAlpha;
    return true;
  }

  // Draw an animation using time in seconds and the sprite's fps (or opts.fps).
  drawAnim(ctx, name, time, x, y, opts = {}) {
    const s = this.sprites.get(name);
    if (!s) return false;
    const fps = opts.fps ?? s.fps;
    const idx = Math.floor(time * fps);
    return this.draw(ctx, name, opts.once ? Math.min(idx, s.frames.length - 1) : idx, x, y, opts);
  }

  _flipped(name, fi, img) {
    const key = `${name}#${fi}`;
    let f = this.flipCache.get(key);
    if (!f) this.flipCache.set(key, (f = flipX(img)));
    return f;
  }

  _flash(name, fi, img, flipped) {
    const key = `${name}#${fi}#${flipped ? 1 : 0}`;
    let f = this.flashCache.get(key);
    if (!f) this.flashCache.set(key, (f = silhouette(img, '#ffffff')));
    return f;
  }
}
