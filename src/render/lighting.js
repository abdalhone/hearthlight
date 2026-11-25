import { ambientAt, flickerWave, lighten } from './text_layout.js';
import { TILE } from '../core/constants.js';

// Lighting.
//  - Light sources are COLLECTED by the renderer every frame: any entity or world object
//    in or near the view may implement getLight(time) -> light | light[] | null.
//    light = { x, y, r, color: '#rrggbb', intensity: 0..1, flicker: 0..1, glow?: 0..2 } (world px)
//  - flash(light & { duration }) adds a short-lived light (hits, spells, lightning).
//  - update(dt) ages flashes.
//  - A light under a roof (inside a building, above its front wall) shows only as much as
//    the roof lets through (DESIGN §31.5): none from outside, all of it once you step in
//    and the roof fades. Its windows are what glow to the street at night.
//
// How it looks: the scene is multiplied by an ambient color (golden mornings, blue
// nights) held in a small light map; point lights are added into that map so they
// cut the darkness with a soft falloff, then the same lights add a colored glow on
// top (and a little bloom at night). Radial gradients are cached per color, so a
// frame never builds a gradient.

const MAX_LIGHTS = 320;
const MAX_FLASHES = 64;
const LIGHTMAP_DOWNSCALE = 2; // light map pixels per world pixel (smoothly upscaled)
const SPRITE_SIZE = 64;
const DEFAULT_COLOR = '#ffb047';

function makeLight() {
  return { x: 0, y: 0, r: 0, color: DEFAULT_COLOR, intensity: 0, flicker: 0, glow: 1 };
}

export class Lighting {
  constructor(game) {
    this.game = game;
    this.lights = new Array(MAX_LIGHTS);
    this.count = 0;
    this.flashes = [];
    for (let i = 0; i < MAX_FLASHES; i++) this.flashes.push({ ...makeLight(), active: false, t: 0, duration: 0.25 });
    this._pool = [];
    for (let i = 0; i < 96; i++) this._pool.push(makeLight());
    this._poolUsed = 0;
    this._fk = new Float32Array(MAX_LIGHTS); // per-light intensity after flicker
    this._fr = new Float32Array(MAX_LIGHTS); // per-light radius after flicker
    this._seen = new Float32Array(MAX_LIGHTS); // per-light share the roofs let through

    this.ambient = { r: 255, g: 255, b: 255, darkness: 0 };
    this.indoor = 0; // eased 0..1 so walking through a door does not pop
    this._ambientCss = 'rgb(255,255,255)';
    this._ambientKey = -1;

    this._sprites = new Map();
    this._hot = new Map();
    this._soft = new Map();
    this.lightmap = null;
    this.lctx = null;
  }

  // A short-lived light: hits, spells, explosions. Fades out over `duration` seconds.
  flash(light) {
    if (!light) return;
    let slot = null;
    let oldest = null;
    for (const f of this.flashes) {
      if (!f.active) {
        slot = f;
        break;
      }
      if (!oldest || f.t / f.duration > oldest.t / oldest.duration) oldest = f;
    }
    slot = slot || oldest;
    slot.active = true;
    slot.t = 0;
    slot.duration = Math.max(0.03, Number(light.duration) || 0.25);
    slot.x = Number(light.x) || 0;
    slot.y = Number(light.y) || 0;
    slot.r = Math.max(4, Number(light.r) || 48);
    slot.color = typeof light.color === 'string' ? light.color : '#fff4d6';
    slot.intensity = Math.min(1.5, Math.max(0, light.intensity ?? 1));
    slot.flicker = light.flicker ?? 0;
    slot.glow = light.glow ?? 1;
  }

  update(dt) {
    for (const f of this.flashes) {
      if (!f.active) continue;
      f.t += dt;
      if (f.t >= f.duration) f.active = false;
    }
  }

  activeFlashes() {
    let n = 0;
    for (const f of this.flashes) if (f.active) n++;
    return n;
  }

  // ---------------------------------------------------------------- per frame

  beginFrame(frameDt = 1 / 60) {
    this.count = 0;
    this._poolUsed = 0;
    this._computeAmbient(frameDt);
  }

  get darkness() {
    return this.ambient.darkness;
  }

  _computeAmbient(dt) {
    const g = this.game;
    const clock = g.clock;
    const w = g.weather;
    const cw = clock?.weather;
    const type = cw?.type;
    const inten = cw?.intensity ?? 0;
    const rain = w?.rain ?? (type === 'rain' ? inten : 0);
    const fog = w?.fog ?? (type === 'fog' ? inten : 0);
    const cloud = w?.cloud ?? (type === 'cloudy' ? inten : 0);
    let indoorTarget = 0;
    const p = g.player;
    if (p && g.map?.isIndoors) {
      try {
        indoorTarget = g.map.isIndoors(p.x, p.y) ? 1 : 0;
      } catch {
        indoorTarget = 0;
      }
    }
    this.indoor += (indoorTarget - this.indoor) * (1 - Math.exp(-dt * 7));
    // The moon waxes and wanes over an eight-day cycle; full moons are brighter nights.
    const day = clock?.day ?? 1;
    const phase = (((day - 1) % 8) + 8) % 8;
    const moon = 0.55 + 0.45 * (0.5 + 0.5 * Math.cos((phase / 8) * Math.PI * 2));
    ambientAt(clock?.hour ?? 12, { cloud, rain, fog, indoor: this.indoor, moon, sky: w?.flash ?? 0 }, this.ambient);
    const a = this.ambient;
    const key = (a.r << 16) | (a.g << 8) | a.b;
    if (key !== this._ambientKey) {
      this._ambientKey = key;
      this._ambientCss = `rgb(${a.r},${a.g},${a.b})`;
    }
  }

  push(light) {
    if (this.count >= MAX_LIGHTS || !light) return;
    const r = light.r;
    if (!(r > 0) || !Number.isFinite(light.x) || !Number.isFinite(light.y)) return;
    const seen = this.roofSeen(light.x, light.y);
    if (seen <= 0.01) return;
    this._seen[this.count] = seen;
    this.lights[this.count++] = light;
  }

  // How much of a light at (x, y) the roofs let through: 1 in the open (and on a front wall,
  // where windows, lamps and signs hang), 1 - the roof's opacity under a roof. The renderer
  // draws the roofs (map.drawRoofs eases each one's _alpha) before it lights the scene, so
  // this follows the roof as it fades when you walk in.
  roofSeen(x, y) {
    const map = this.game?.map;
    if (!map?.buildingAt) return 1;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    let b = null;
    try {
      b = map.buildingAt(tx, ty);
    } catch {
      return 1;
    }
    if (!b || ty > b.y + b.h - 3) return 1;
    const a = Number.isFinite(b._alpha) ? b._alpha : 1;
    return a >= 1 ? 0 : a <= 0 ? 1 : 1 - a;
  }

  // Accepts what getLight() returns: a light, an array of lights, or null.
  collect(result) {
    if (!result) return;
    if (Array.isArray(result)) {
      for (let i = 0; i < result.length; i++) this.push(result[i]);
    } else this.push(result);
  }

  // A light owned by the render module itself (fireflies, a lantern); pooled.
  addLight(x, y, r, color, intensity, flicker = 0, glow = 1) {
    if (this.count >= MAX_LIGHTS) return;
    let l = this._pool[this._poolUsed];
    if (!l) {
      if (this._pool.length >= 256) return;
      l = makeLight();
      this._pool.push(l);
    }
    this._poolUsed++;
    l.x = x;
    l.y = y;
    l.r = r;
    l.color = color;
    l.intensity = intensity;
    l.flicker = flicker;
    l.glow = glow;
    this.push(l);
  }

  collectFlashes() {
    for (const f of this.flashes) {
      if (!f.active) continue;
      const k = 1 - f.t / f.duration;
      this.addLight(f.x, f.y, f.r * (0.85 + 0.15 * k), f.color, f.intensity * k * k, f.flicker, (f.glow ?? 1) * 1.4);
    }
  }

  // ---------------------------------------------------------------- sprites

  // Soft radial falloff in one color, transparent at the rim. Cached per color.
  sprite(color) {
    const key = color || DEFAULT_COLOR;
    let s = this._sprites.get(key);
    if (s) return s;
    if (this._sprites.size > 96) this._sprites.clear();
    s = document.createElement('canvas');
    s.width = s.height = SPRITE_SIZE;
    const c = s.getContext('2d');
    const h = SPRITE_SIZE / 2;
    const grad = c.createRadialGradient(h, h, 0, h, h, h);
    const rgb = parseColor(key);
    const stops = [
      [0, 1],
      [0.18, 0.86],
      [0.42, 0.52],
      [0.66, 0.22],
      [0.84, 0.07],
      [1, 0],
    ];
    for (const [o, a] of stops) grad.addColorStop(o, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`);
    c.fillStyle = grad;
    c.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    this._sprites.set(key, s);
    return s;
  }

  // In the light map a light restores the ground's own color, tinted by the light;
  // the rest of its color comes from the additive glow. A warm light (a lamp, a fire)
  // restores less green and blue than it shows, the way flame light does, so a lamp
  // pool on grass reads amber-olive and on stone reads amber, never lime.
  mapSprite(color) {
    const key = color || DEFAULT_COLOR;
    let s = this._soft.get(key);
    if (s) return s;
    if (this._soft.size > 96) this._soft.clear();
    s = this.sprite(warmMapColor(lighten(key.startsWith('#') ? key : DEFAULT_COLOR, 0.04)));
    this._soft.set(key, s);
    return s;
  }

  // A whiter, tighter version of a light's sprite for bloom on bright lights.
  hotSprite(color) {
    const key = color || DEFAULT_COLOR;
    let s = this._hot.get(key);
    if (s) return s;
    if (this._hot.size > 96) this._hot.clear();
    s = this.sprite(lighten(key.startsWith('#') ? key : DEFAULT_COLOR, 0.6));
    this._hot.set(key, s);
    return s;
  }

  _ensureLightmap(bw, bh) {
    const lw = Math.ceil(bw / LIGHTMAP_DOWNSCALE) + 1;
    const lh = Math.ceil(bh / LIGHTMAP_DOWNSCALE) + 1;
    if (!this.lightmap) {
      this.lightmap = document.createElement('canvas');
      this.lctx = this.lightmap.getContext('2d');
    }
    if (this.lightmap.width !== lw || this.lightmap.height !== lh) {
      this.lightmap.width = lw;
      this.lightmap.height = lh;
    }
    return this.lightmap;
  }

  _ensureLiftmap(w, h) {
    if (!this.liftmap) {
      this.liftmap = document.createElement('canvas');
      this.qctx = this.liftmap.getContext('2d');
    }
    if (this.liftmap.width !== w || this.liftmap.height !== h || !this._liftGradient) {
      this.liftmap.width = w;
      this.liftmap.height = h;
      const g = this.qctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.1, w / 2, h / 2, Math.hypot(w, h) * 0.55);
      g.addColorStop(0, '#0c1334');
      g.addColorStop(0.6, '#090e29');
      g.addColorStop(1, '#03050f');
      this._liftGradient = g;
    }
    return this.liftmap;
  }

  // ---------------------------------------------------------------- composite

  // Soft dark edges, multiplied into the light map so the vignette costs no extra
  // full-screen pass.
  _vignetteSprite() {
    if (this._vig) return this._vig;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 6, 32, 32, 46);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.45, '#f0eef5');
    grad.addColorStop(0.8, '#8a86a0');
    grad.addColorStop(1, '#2a2640');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this._vig = c;
    return c;
  }

  // Darken the upscaled scene by the ambient color (and the vignette), let the
  // collected lights cut through it, then add their glow. `r` is the renderer
  // (scale, ox, oy, subX, subY, buffer).
  composite(ctx, r, time, vignette = 0) {
    const n = this.count;
    const amb = this.ambient;
    const scale = r.scale;
    const ox = r.ox;
    const oy = r.oy;
    const fk = this._fk;
    const fr = this._fr;

    for (let i = 0; i < n; i++) {
      const l = this.lights[i];
      const fl = l.flicker || 0;
      let k = 1;
      let rk = 1;
      if (fl > 0) {
        const w = flickerWave(time, l.x * 0.0173 + l.y * 0.0291);
        k = 1 - fl * (0.08 - 0.16 * w);
        rk = 1 + fl * 0.06 * w;
      }
      fk[i] = Math.max(0, Math.min(1.5, (l.intensity ?? 1) * k * this._seen[i]));
      fr[i] = l.r * rk;
    }

    const dark = amb.r < 252 || amb.g < 252 || amb.b < 252;
    if (dark || vignette > 0.01) {
      const lm = this._ensureLightmap(r.buffer.width, r.buffer.height);
      const l = this.lctx;
      const D = LIGHTMAP_DOWNSCALE;
      l.globalCompositeOperation = 'source-over';
      l.globalAlpha = 1;
      l.fillStyle = this._ambientCss;
      l.fillRect(0, 0, lm.width, lm.height);
      l.globalCompositeOperation = 'lighter';
      l.imageSmoothingEnabled = true;
      const mapK = 1 - 0.22 * Math.max(0, Math.min(1, (amb.darkness - 0.4) / 0.4)) * (1 - this.indoor);
      for (let i = 0; i < n; i++) {
        const a = fk[i];
        if (a < 0.01) continue;
        const li = this.lights[i];
        const rr = fr[i];
        // At night a light restores most, not all, of the day: the pool stays a pool
        // and its warmth (the glow below) wins over green grass.
        l.globalAlpha = (a > 1 ? 1 : a) * mapK;
        l.drawImage(this.mapSprite(li.color), (li.x - ox - rr) / D, (li.y - oy - rr) / D, (2 * rr) / D, (2 * rr) / D);
      }
      if (vignette > 0.01) {
        // Fit the vignette to the visible part of the map (the map is one pixel wider).
        const vw = (r.vw || lm.width * D) / D;
        const vh = (r.vh || lm.height * D) / D;
        const sx = r.subX / scale / D;
        const sy = r.subY / scale / D;
        l.globalCompositeOperation = 'multiply';
        l.globalAlpha = Math.min(1, vignette);
        l.drawImage(this._vignetteSprite(), sx - vw * 0.09, sy - vh * 0.09, vw * 1.18, vh * 1.18);
      }
      l.globalAlpha = 1;
      l.globalCompositeOperation = 'source-over';
      ctx.globalCompositeOperation = 'multiply';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(lm, -r.subX, -r.subY, lm.width * D * scale, lm.height * D * scale);
      // Multiplying cannot turn green grass blue, so at night the shadows are lifted
      // toward navy with 'screen'. The lift lives in its own small map with every
      // light cut out of it, so lit ground keeps its warm color, and it fades toward
      // the edges so the vignette survives.
      const night = Math.max(0, Math.min(1, (amb.darkness - 0.3) / 0.45)) * (1 - this.indoor * 0.75);
      if (night > 0.01) {
        const lift = this._ensureLiftmap(lm.width, lm.height);
        const q = this.qctx;
        q.globalCompositeOperation = 'source-over';
        q.globalAlpha = 1;
        q.clearRect(0, 0, lift.width, lift.height);
        q.fillStyle = this._liftGradient;
        q.fillRect(0, 0, lift.width, lift.height);
        q.globalCompositeOperation = 'destination-out';
        q.imageSmoothingEnabled = true;
        for (let i = 0; i < n; i++) {
          const a = fk[i] * 1.3;
          if (a < 0.02) continue;
          const li = this.lights[i];
          const rr = fr[i] * 0.85;
          q.globalAlpha = a > 1 ? 1 : a;
          q.drawImage(this.sprite('#ffffff'), (li.x - ox - rr) / D, (li.y - oy - rr) / D, (2 * rr) / D, (2 * rr) / D);
        }
        q.globalAlpha = 1;
        q.globalCompositeOperation = 'source-over';
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = night;
        ctx.drawImage(lift, -r.subX, -r.subY, lift.width * D * scale, lift.height * D * scale);
        ctx.globalAlpha = 1;
      }
    }

    // Additive glow: subtle by day, a warm halo at night, plus bloom on bright lights.
    const gk = 0.08 + 0.46 * amb.darkness;
    const bloom = Math.max(0, amb.darkness - 0.3) * 0.55;
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    for (let i = 0; i < n; i++) {
      const li = this.lights[i];
      const a = fk[i] * gk * (li.glow ?? 1);
      if (a < 0.01) continue;
      const cx = (li.x - ox) * scale - r.subX;
      const cy = (li.y - oy) * scale - r.subY;
      const R = fr[i] * 0.7 * scale;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(this.sprite(li.color), cx - R, cy - R, R * 2, R * 2);
      if (bloom > 0 && fk[i] > 0.55) {
        const Rb = Math.max(2 * scale, fr[i] * 0.2 * scale);
        ctx.globalAlpha = Math.min(1, bloom * fk[i] * (li.glow ?? 1));
        ctx.drawImage(this.hotSprite(li.color), cx - Rb, cy - Rb, Rb * 2, Rb * 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
  }
}

// Flame-warm lights (red well above blue) multiply the scene through a deeper amber.
export function warmMapColor(c) {
  const [r, g, b] = parseColor(c);
  if (r < b + 40) return c;
  const hex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g * 0.8)}${hex(b * 0.66)}`;
}

const _rgb = [255, 255, 255];
function parseColor(c) {
  const s = String(c || '').trim();
  if (s[0] === '#') {
    let h = s.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const v = parseInt(h.slice(0, 6), 16);
    if (Number.isFinite(v)) return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  const m = s.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
  return _rgb;
}
