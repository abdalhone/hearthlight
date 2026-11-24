// Shows one painted panel on a canvas: its layers are painted once at low resolution
// (about 180 px on the short side, matched to the screen's shape so phones in portrait get
// a tall picture instead of a letterboxed sliver), then every frame they are upscaled by
// an integer factor with gentle parallax drift, particles are drawn crisply at low
// resolution, practical lights get a soft full-resolution bloom, and a faint ordered dither
// and vignette sit on top (DESIGN §18).

import { Buf, rng, bayer, hex, clamp } from './paint.js';

const SHORT = 180;

// short: the panel's low-res size on the short side. Panels about people use a coarser
// grid (bigger pixels) so the game's own sprites fill the frame like a close-up.
export function panelMetrics(devW, devH, short = SHORT) {
  const shortDev = Math.max(1, Math.min(devW, devH));
  const s = Math.max(1, Math.round(shortDev / (short || SHORT)));
  const vw = Math.ceil(devW / s);
  const vh = Math.ceil(devH / s);
  return { s, vw, vh };
}

// The layout every painter receives. W, H: the painted buffer (the view plus a margin for
// drift). cx, cy: the focal point. u: one "unit" (1 at 180 px short side). portrait: the
// screen is taller than wide, so the text box covers the lower part: keep subjects high.
export function makeLayout(vw, vh, short = SHORT) {
  const mx = Math.ceil(vw * 0.05) + 2;
  const my = Math.ceil(vh * 0.04) + 2;
  const W = vw + mx * 2;
  const H = vh + my * 2;
  const portrait = vh > vw * 1.1;
  // Compositions are written for a 180 px short side; a panel with a coarser grid keeps
  // its layout (everything scales by u) while the game's sprites, fixed in size, loom larger.
  void short;
  const u = Math.min(vw, vh) / SHORT;
  // In portrait the text box takes the bottom ~38%: centre the subject in the top part.
  const cy = my + (portrait ? vh * 0.36 : vh * 0.47);
  return { W, H, vw, vh, mx, my, cx: W / 2, cy, u, portrait };
}

function bufToCanvas(buf) {
  const c = document.createElement('canvas');
  c.width = buf.w;
  c.height = buf.h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(buf.w, buf.h);
  img.data.set(buf.data);
  ctx.putImageData(img, 0, 0);
  return c;
}

// ----------------------------------------------------------------------------- particles

function makeParticles(spec, L, seed) {
  const R = rng(seed);
  const out = [];
  const n = Math.round((spec.count || 60) * Math.max(0.6, (L.W * L.H) / (340 * 200)));
  for (let i = 0; i < n; i++) {
    out.push({
      x: R() * L.W,
      y: R() * L.H,
      z: spec.depth != null ? spec.depth : 0.4 + R() * 0.6,
      ph: R() * Math.PI * 2,
      sp: 0.6 + R() * 0.8,
      c: spec.colors ? spec.colors[Math.floor(R() * spec.colors.length)] : spec.color || '#ffffff',
      big: R() < (spec.bigChance ?? 0.18),
      r: R(),
    });
  }
  return out;
}

// Each particle type: where it is at time t (wrapping in the buffer), and how it draws.
const PARTICLE_TYPES = {
  // Slow snow with a sideways wobble; nearer flakes are bigger and faster.
  snow: (p, t, L, spec) => {
    const fall = (spec.speed ?? 9) * p.sp * (0.5 + p.z);
    const wind = (spec.wind ?? 3) * (0.5 + p.z);
    return { x: p.x + t * wind + Math.sin(t * 0.9 + p.ph) * 3 * p.z, y: p.y + t * fall, size: p.big && p.z > 0.7 ? 2 : 1, a: 0.45 + p.z * 0.55 };
  },
  // Light falling like snow: slower, drifting, pulsing, some with halos.
  brightfall: (p, t, L, spec) => {
    const fall = (spec.speed ?? 4) * p.sp * (0.4 + p.z);
    return { x: p.x + Math.sin(t * 0.5 + p.ph) * 6 * p.z + t * (spec.wind ?? 0.8), y: p.y + t * fall, size: p.big ? 2 : 1, a: 0.5 + 0.5 * Math.sin(t * 2.1 + p.ph * 3), glow: p.big };
  },
  // Sparks that rise and fade.
  embers: (p, t, L, spec) => {
    const life = 5 + p.r * 4;
    const k = ((t * p.sp) / life + p.r) % 1;
    const y = (spec.y0 ?? L.H) - k * (spec.rise ?? L.H * 0.6) * (0.6 + p.z * 0.6);
    const x = (spec.x0 != null ? spec.x0 + (p.x / L.W - 0.5) * (spec.spread ?? 40) : p.x) + Math.sin(t * 1.3 + p.ph) * 4;
    return { x, y, size: 1, a: (1 - k) * (0.6 + 0.4 * Math.sin(t * 8 + p.ph)), wrap: false, glow: p.big && k < 0.5 };
  },
  // Twinkling points that stay put (glimmer, stars, sparkles on snow).
  twinkle: (p, t, L, spec) => {
    const a = Math.max(0, Math.sin(t * (1.2 + p.sp * 1.5) + p.ph * 5)) ** 3;
    const y0 = spec.y0 ?? 0;
    const y1 = spec.y1 ?? L.H;
    return { x: p.x, y: y0 + (p.y / L.H) * (y1 - y0), size: p.big && a > 0.8 ? 2 : 1, a, wrap: false, glow: p.big && a > 0.6 };
  },
  // Dust drifting in still air or light shafts.
  motes: (p, t, L, spec) => {
    const y0 = spec.y0 ?? 0;
    const y1 = spec.y1 ?? L.H;
    return { x: p.x + Math.sin(t * 0.3 + p.ph) * 8 + t * 1.2, y: y0 + ((p.y / L.H) * (y1 - y0) + Math.sin(t * 0.21 + p.ph * 2) * 5), size: 1, a: 0.25 + 0.35 * Math.sin(t * 0.8 + p.ph) ** 2 };
  },
  // Drops that fall from fixed points (seeps, eaves).
  drips: (p, t, L, spec) => {
    const src = spec.from || [[L.cx, L.cy]];
    const s = src[Math.floor(p.r * src.length) % src.length];
    const period = 2.5 + p.sp * 2;
    const k = ((t + p.ph) % period) / period;
    const y = s[1] + (k < 0.35 ? 0 : (k - 0.35) * (spec.fall ?? 40) * 2.2);
    return { x: s[0] + (p.x % 3) - 1, y, size: 1, a: k < 0.35 ? k / 0.35 : 1 - (k - 0.35) / 0.65, wrap: false };
  },
};

// ----------------------------------------------------------------------------- the view

export class PanelInstance {
  constructor(def, vw, vh, opts = {}) {
    this.def = def;
    this.L = makeLayout(vw, vh, def.short || SHORT);
    this.s = opts.s || 1;
    this.L.id = def.id;
    this.seed = def.seed || 7;
    this.layers = [];
    this.t = 0;
    this.pan = opts.pan || def.pan || 'right';
    this.panSeconds = opts.panSeconds || 18;
    this.alpha = 1;
    this.state = {}; // painters may keep per-instance animation state here
    const L = this.L;
    let i = 0;
    for (const layer of def.layers || []) {
      const b = new Buf(L.W, L.H);
      try {
        layer.paint(b, L, rng(this.seed * 31 + i * 7 + 1));
      } catch (err) {
        console.error(`[story] panel ${def.id} layer ${i} failed`, err);
      }
      this.layers.push({ depth: layer.depth ?? 1, scroll: layer.scroll || 0, canvas: bufToCanvas(b), alpha: layer.alpha ?? 1, blend: layer.blend || null, bob: layer.bob || 0 });
      i++;
    }
    this.particleSets = (def.particles || []).map((raw, k) => {
      // Layout-dependent values (a y-range, an emitter point) may be given as functions of L.
      const spec = {};
      for (const [key, v] of Object.entries(raw)) spec[key] = typeof v === 'function' && key !== 'bottom' ? v(L) : v;
      return { spec, list: makeParticles(spec, L, this.seed * 97 + k * 13) };
    });
    this.fx = document.createElement('canvas');
    this.fx.width = vw + 2;
    this.fx.height = vh + 2;
    this.fxCtx = this.fx.getContext('2d');
  }

  // View offset (low-res px, float) of a layer at the given depth at time t.
  offset(depth, t) {
    const L = this.L;
    const k = clamp(t / this.panSeconds);
    const e = k * k * (3 - 2 * k); // ease the drift in and out
    const p = (e * 2 - 1) * 0.85;
    let dx = 0;
    let dy = 0;
    if (this.pan === 'right') dx = p;
    else if (this.pan === 'left') dx = -p;
    else if (this.pan === 'up') dy = -p;
    else if (this.pan === 'down') dy = p;
    else if (this.pan === 'none') dx = 0;
    // A slow breath even without a pan, so a held panel never looks frozen.
    const breathe = Math.sin(t * 0.25) * 0.08;
    return { x: L.mx + (dx + breathe) * L.mx * depth, y: L.my + dy * L.my * depth + Math.sin(t * 0.18 + 1) * 0.05 * L.my * depth };
  }

  toScreen(x, y, depth, t) {
    const o = this.offset(depth, t);
    return { x: x - o.x, y: y - o.y };
  }

  update(dt) {
    this.t += dt;
  }

  draw(ctx, s, devW, devH, globalAlpha = 1) {
    const L = this.L;
    const t = this.t;
    const ga = globalAlpha * this.alpha;
    if (ga <= 0.001) return;
    ctx.imageSmoothingEnabled = false;
    for (const layer of this.layers) {
      const o = this.offset(layer.depth, t);
      let ox = o.x;
      if (layer.scroll) ox = (((o.x + t * layer.scroll) % L.W) + L.W) % L.W;
      const oy = o.y + (layer.bob ? Math.sin(t * 0.4) * layer.bob : 0);
      const ix = Math.floor(ox);
      const iy = Math.floor(oy);
      const fx = (ox - ix) * s;
      const fy = (oy - iy) * s;
      ctx.globalAlpha = ga * layer.alpha;
      if (layer.blend) ctx.globalCompositeOperation = layer.blend;
      const sw = Math.min(L.vw + 1, L.W - ix);
      const sh = Math.min(L.vh + 1, L.H - iy);
      if (sw > 0 && sh > 0) ctx.drawImage(layer.canvas, ix, iy, sw, sh, -fx, -fy, sw * s, sh * s);
      if (layer.scroll && sw < L.vw + 1) {
        // Wrap a scrolling layer (fog banks): draw the start of the canvas after its end.
        const rest = L.vw + 1 - sw;
        ctx.drawImage(layer.canvas, 0, iy, rest, sh, sw * s - fx, -fy, rest * s, sh * s);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // Particles and animated details, crisp at low resolution.
    const fctx = this.fxCtx;
    fctx.clearRect(0, 0, this.fx.width, this.fx.height);
    const glows = [];
    try {
      this.def.anim?.(fctx, L, t, this, glows);
    } catch (err) {
      if (!this._animErr) console.error(`[story] panel ${this.def.id} anim failed`, err);
      this._animErr = true;
    }
    for (const set of this.particleSets) this._drawParticles(fctx, set, t, glows);
    const o1 = this.offset(1, t);
    const fxo = { x: o1.x - Math.floor(o1.x), y: o1.y - Math.floor(o1.y) };
    ctx.globalAlpha = ga;
    ctx.drawImage(this.fx, 0, 0, this.fx.width, this.fx.height, -fxo.x * s, -fxo.y * s, this.fx.width * s, this.fx.height * s);

    // Bloom: soft halos at full resolution around the practical lights.
    let lights = [];
    try {
      lights = this.def.lights ? this.def.lights(L, t, this) || [] : [];
    } catch {
      lights = [];
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const lt of lights.concat(glows)) {
      const k = (lt.k ?? 0.5) * (lt.flicker ? 0.85 + 0.15 * Math.sin(t * 9 + lt.x) * Math.sin(t * 5.3 + lt.y) : 1);
      if (k <= 0.01) continue;
      const p = this.toScreen(lt.x, lt.y, lt.depth ?? 1, t);
      const x = p.x * s;
      const y = p.y * s;
      const r = (lt.r || 20) * s;
      const [cr, cg, cb] = hex(lt.color || '#ffb047');
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${0.55 * k})`);
      g.addColorStop(0.25, `rgba(${cr},${cg},${cb},${0.22 * k})`);
      g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.globalAlpha = ga;
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  _drawParticles(fctx, set, t, glows) {
    const { spec, list } = set;
    const L = this.L;
    const fn = PARTICLE_TYPES[spec.type];
    if (!fn) return;
    const tt = t + (spec.t0 || 0);
    const o1 = this.offset(1, t);
    const fracX = o1.x - Math.floor(o1.x);
    const fracY = o1.y - Math.floor(o1.y);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const q = fn(p, tt, L, spec);
      if (q.a <= 0.02) continue;
      let x = q.x;
      let y = q.y;
      if (q.wrap !== false) {
        x = ((x % L.W) + L.W) % L.W;
        y = (((y - (spec.top ?? 0)) % (L.H - (spec.top ?? 0))) + (L.H - (spec.top ?? 0))) % (L.H - (spec.top ?? 0)) + (spec.top ?? 0);
      }
      if (spec.bottom != null && y > spec.bottom(x, L)) continue;
      // The fx canvas is drawn shifted by the near layer's sub-pixel offset; each particle
      // still moves with its own depth.
      const o = this.offset(p.z, t);
      const sx = Math.round(x - o.x + fracX) | 0;
      const sy = Math.round(y - o.y + fracY) | 0;
      if (sx < -2 || sy < -2 || sx > this.fx.width + 2 || sy > this.fx.height + 2) continue;
      fctx.globalAlpha = clamp(q.a);
      fctx.fillStyle = p.c;
      fctx.fillRect(sx, sy, q.size, q.size);
      if (q.glow && glows.length < 40) glows.push({ x, y, r: spec.glowR || 7, color: p.c, k: q.a * (spec.glowK ?? 0.35), depth: p.z });
    }
    fctx.globalAlpha = 1;
  }
}

// The faint ordered dither and the vignette, built once per screen size.
export function makeOverlay(devW, devH, s, strength = 0.75) {
  const c = document.createElement('canvas');
  c.width = devW;
  c.height = devH;
  const ctx = c.getContext('2d');
  // Dither: a 4x4 Bayer tile of tiny light/dark nudges, scaled to the panel's pixel size.
  const tile = document.createElement('canvas');
  tile.width = 4 * s;
  tile.height = 4 * s;
  const tctx = tile.getContext('2d');
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const v = bayer(x, y) - 0.5;
      tctx.fillStyle = v > 0 ? `rgba(255,255,255,${v * 0.035})` : `rgba(0,0,16,${-v * 0.06})`;
      tctx.fillRect(x * s, y * s, s, s);
    }
  }
  ctx.fillStyle = ctx.createPattern(tile, 'repeat');
  ctx.fillRect(0, 0, devW, devH);
  const g = ctx.createRadialGradient(devW / 2, devH * 0.45, Math.min(devW, devH) * 0.25, devW / 2, devH * 0.5, Math.hypot(devW, devH) * 0.62);
  g.addColorStop(0, 'rgba(6,4,16,0)');
  g.addColorStop(0.6, `rgba(6,4,16,${0.28 * strength})`);
  g.addColorStop(1, `rgba(4,3,12,${0.85 * strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, devW, devH);
  return c;
}
