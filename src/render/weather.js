import { hash2 } from '../core/rng.js';

// Weather, driven by game.clock.weather ({ type, intensity }):
//   rain    angled streaks at full resolution in three depth layers (parallax with the
//           camera), splashes on the ground, darker and cooler ambient (lighting reads
//           `rain`), and in heavy rain the occasional lightning flash and thunder
//   fog     drifting fog banks in two layers
//   cloudy  soft cloud shadows sliding over the ground
//   nature  fireflies at night in forests, meadows and near water (they glow and emit
//           tiny lights); falling leaves in Whisperwood
// `rain`, `fog`, `cloud` (0..1) ease in and out so a change of weather fades, and
// `flash` (0..1) is the current lightning brightness.

const FOREST_IDS = new Set(['whisperwood']);
const FIREFLY_KINDS = new Set(['forest', 'field', 'lake']);
const FIREFLY_IDS = new Set(['whisperwood', 'south_meadow', 'mirror_lake']);
const MAX_FIREFLIES = 26;
const FOG_TEX = 128;
const MAX_DROPS = 460;

function smooth01(t) {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

const wrap = (n, period) => ((n % period) + period) % period;

// Tileable value noise: lattice coordinates wrap at `period`, so the texture repeats seamlessly.
export function periodicNoise(x, y, period, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = wrap(xi, period);
  const x1 = wrap(xi + 1, period);
  const y0 = wrap(yi, period);
  const y1 = wrap(yi + 1, period);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Fractal tileable noise over a size×size grid, values 0..1.
export function fogMask(size, seed) {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      let amp = 0.55;
      let norm = 0;
      for (let o = 0; o < 4; o++) {
        const period = 4 << o;
        const f = period / size;
        sum += amp * periodicNoise(x * f, y * f, period, seed + o * 31);
        norm += amp;
        amp *= 0.5;
      }
      out[y * size + x] = sum / norm;
    }
  }
  return out;
}

// A soft cloud texture in one color; alpha carries the shape from the mask.
function makeFogTexture(mask, rgb, lo, hi, maxAlpha) {
  const c = document.createElement('canvas');
  c.width = c.height = FOG_TEX;
  const g = c.getContext('2d');
  const img = g.createImageData(FOG_TEX, FOG_TEX);
  const d = img.data;
  for (let i = 0; i < FOG_TEX * FOG_TEX; i++) {
    const v = smooth01((mask[i] - lo) / (hi - lo));
    d[i * 4] = rgb[0];
    d[i * 4 + 1] = rgb[1];
    d[i * 4 + 2] = rgb[2];
    d[i * 4 + 3] = Math.round(255 * v * maxAlpha);
  }
  g.putImageData(img, 0, 0);
  return c;
}

function approach(cur, target, step) {
  return cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);
}

export class Weather {
  constructor(game) {
    this.game = game;
    this.rain = 0;
    this.fog = 0;
    this.cloud = 0;
    this.flash = 0;
    this.wind = 0.24; // horizontal drift of rain per unit of fall
    this.indoors = false;
    this.time = 0;

    this._lightningIn = 12;
    this._boltT = -1;
    this._thunderIn = -1;
    this._thunderVol = 0;
    this._splashAcc = 0;
    this._leafAcc = 0;
    this._flyAcc = 0;

    this._drops = null;
    this._dropW = 0;
    this._dropH = 0;
    this._lastViewX = null;
    this._lastViewY = null;
    this._fog = null;
  }

  // ---------------------------------------------------------------- simulation

  update(dt) {
    const g = this.game;
    this.time += dt;
    const w = g.clock?.weather;
    const type = w?.type || 'clear';
    const inten = Math.max(0, Math.min(1, w?.intensity ?? 0));
    this.rain = approach(this.rain, type === 'rain' ? inten : 0, 0.14 * dt);
    this.fog = approach(this.fog, type === 'fog' ? inten : 0, 0.1 * dt);
    // A place may keep its own weather (src/world/travel.js): the grey over Brindlecombe,
    // falling snow on the Hollowcrown. The grey is a flat wash (one fill, cheap on a phone).
    this.grey = approach(this.grey || 0, this.localFog || 0, 0.25 * dt);
    this.cloud = approach(this.cloud, type === 'cloudy' ? inten : type === 'rain' ? inten * 0.6 : 0, 0.1 * dt);

    const p = g.player;
    let indoors = false;
    if (p && g.map?.isIndoors) {
      try {
        indoors = !!g.map.isIndoors(p.x, p.y);
      } catch {
        indoors = false;
      }
    }
    this.indoors = indoors;
    if (!p || !g.map) return;

    if (!indoors) {
      this._spawnSnow(dt);
      this._spawnSplashes(dt);
      this._spawnLeaves(dt);
      this._spawnFireflies(dt);
    }
    this._updateLightning(dt);
  }

  _spawnSplashes(dt) {
    const g = this.game;
    const parts = g.particles;
    if (this.rain < 0.05 || !parts) return;
    const cam = g.camera;
    const area = (cam.vw * cam.vh) / (426 * 240);
    this._splashAcc += this.rain * 55 * area * dt;
    const map = g.map;
    let n = 0;
    while (this._splashAcc >= 1 && n < 12) {
      this._splashAcc -= 1;
      n++;
      const x = cam.x + Math.random() * cam.vw;
      const y = cam.y + Math.random() * cam.vh;
      let water = false;
      try {
        water = !!map.isWater?.(Math.floor(x / 16), Math.floor(y / 16));
      } catch {
        water = false;
      }
      parts.emit('rain_splash', x, y, water ? { color: '#8ccbe6', count: 2 } : undefined);
    }
    if (this._splashAcc > 4) this._splashAcc = 0;
  }

  // Snow drifting down on the Hollowcrown's shoulder (travel.js sets localSnow, 0..1).
  _spawnSnow(dt) {
    const k = this.localSnow || 0;
    if (k <= 0.01) return;
    const g = this.game;
    const cam = g.camera;
    this._snowAcc = (this._snowAcc || 0) + k * 9 * dt;
    while (this._snowAcc >= 1) {
      this._snowAcc -= 1;
      g.particles?.emit('snowflake', cam.x + Math.random() * (cam.vw + 40) - 20, cam.y + Math.random() * (cam.vh + 30));
    }
  }

  _placeAt(x, y) {
    const loc = this.game.locations?.at?.(x, y);
    return loc || null;
  }

  _spawnLeaves(dt) {
    const g = this.game;
    const cam = g.camera;
    const loc = this._placeAt(cam.x + cam.vw / 2, cam.y + cam.vh / 2);
    const forest = loc && (FOREST_IDS.has(loc.id) || loc.kind === 'forest' || FOREST_IDS.has(loc.parent));
    if (!forest) return;
    this._leafAcc += (2.2 + this.rain * 2) * dt;
    while (this._leafAcc >= 1) {
      this._leafAcc -= 1;
      const x = cam.x + Math.random() * cam.vw;
      const y = cam.y + Math.random() * (cam.vh + 30);
      g.particles?.emit('leaf', x, y, { speed: [4 + this.rain * 10, 10 + this.rain * 18], dir: { x: 1, y: 0.2 }, spread: 1.2 });
    }
  }

  _isFireflyHabitat(x, y) {
    const loc = this._placeAt(x, y);
    if (loc && (FIREFLY_IDS.has(loc.id) || FIREFLY_KINDS.has(loc.kind))) return true;
    const map = this.game.map;
    if (!map?.isWater) return false;
    const tx = Math.floor(x / 16);
    const ty = Math.floor(y / 16);
    try {
      return map.isWater(tx + 2, ty) || map.isWater(tx - 2, ty) || map.isWater(tx, ty + 2) || map.isWater(tx, ty - 2);
    } catch {
      return false;
    }
  }

  _spawnFireflies(dt) {
    const g = this.game;
    const parts = g.particles;
    const daylight = g.clock?.daylight ?? 1;
    if (!parts || daylight > 0.35 || this.rain > 0.35) return;
    this._flyAcc += dt * 3;
    if (this._flyAcc < 1) return;
    this._flyAcc = 0;
    if (parts.countOf('firefly') >= MAX_FIREFLIES * (1 - daylight * 2)) return;
    const cam = g.camera;
    const x = cam.x - 20 + Math.random() * (cam.vw + 40);
    const y = cam.y - 10 + Math.random() * (cam.vh + 20);
    if (this._isFireflyHabitat(x, y)) parts.emit('firefly', x, y);
  }

  _updateLightning(dt) {
    const g = this.game;
    if (this._thunderIn > 0) {
      this._thunderIn -= dt;
      if (this._thunderIn <= 0) {
        try {
          g.audio?.play?.('thunder', { volume: this._thunderVol });
        } catch {
          /* sound is optional */
        }
        if (!this.indoors && this._thunderVol > 0.7) g.camera?.shake?.(1, 0.45);
      }
    }
    if (this.rain < 0.72) {
      this._lightningIn = Math.max(this._lightningIn, 6);
      return;
    }
    this._lightningIn -= dt;
    if (this._lightningIn > 0) return;
    this._lightningIn = 9 + Math.random() * 22;
    this.strike();
  }

  // A lightning flash now, with thunder a moment later (nearer strikes are louder and sooner).
  strike() {
    this._boltT = 0;
    const near = Math.random();
    this._thunderIn = 0.35 + (1 - near) * 1.6;
    this._thunderVol = 0.45 + near * 0.55;
  }

  // ---------------------------------------------------------------- per frame

  // Visual-only animation advanced every rendered frame (smooth at any refresh rate,
  // and alive during hit-stop).
  render(frameDt, r) {
    const dt = Math.min(0.1, Math.max(0, frameDt || 0));
    if (this._boltT >= 0) {
      this._boltT += dt;
      const t = this._boltT;
      let f;
      if (t < 0.07) f = 1;
      else if (t < 0.14) f = 0.25;
      else if (t < 0.22) f = 0.85;
      else f = Math.max(0, 0.85 * (1 - (t - 0.22) / 0.55));
      if (t > 0.8) this._boltT = -1;
      this.flash = f * (this.game?.settings?.reduceMotion ? 0.3 : 1) * (this.indoors ? 0.35 : 1);
    } else this.flash = 0;
    if (r) this._advanceDrops(dt, r);
  }

  _ensureDrops(r) {
    const W = r.canvas.width;
    const H = r.canvas.height;
    if (!this._drops) {
      this._drops = {
        x: new Float32Array(MAX_DROPS),
        y: new Float32Array(MAX_DROPS),
        z: new Float32Array(MAX_DROPS),
      };
    }
    if (this._dropW !== W || this._dropH !== H) {
      this._dropW = W;
      this._dropH = H;
      const d = this._drops;
      for (let i = 0; i < MAX_DROPS; i++) {
        d.x[i] = Math.random() * W;
        d.y[i] = Math.random() * H;
        d.z[i] = Math.random();
      }
    }
    return this._drops;
  }

  _dropCount(r) {
    const area = (r.canvas.width * r.canvas.height) / (1280 * 720);
    return Math.min(MAX_DROPS, Math.round(this.rain * Math.max(140, Math.min(MAX_DROPS, 300 * Math.sqrt(area)))));
  }

  _advanceDrops(dt, r) {
    const vx = r.viewX ?? 0;
    const vy = r.viewY ?? 0;
    const camDX = this._lastViewX == null ? 0 : vx - this._lastViewX;
    const camDY = this._lastViewY == null ? 0 : vy - this._lastViewY;
    this._lastViewX = vx;
    this._lastViewY = vy;
    if (this.rain < 0.02 || this.indoors) return;
    const d = this._ensureDrops(r);
    const n = this._dropCount(r);
    const W = r.canvas.width;
    const H = r.canvas.height;
    const unit = r.scale / 3;
    const pad = 40 * unit;
    const jump = Math.abs(camDX) > 60 || Math.abs(camDY) > 60;
    for (let i = 0; i < n; i++) {
      const z = d.z[i];
      const speed = (620 + 520 * z) * unit;
      d.y[i] += speed * dt;
      d.x[i] += speed * this.wind * dt;
      if (!jump) {
        // Nearer drops slide more when the camera moves: cheap depth.
        const par = (0.7 + 0.8 * z) * r.scale;
        d.x[i] -= camDX * par;
        d.y[i] -= camDY * par;
      }
      if (d.y[i] > H + pad) {
        d.y[i] -= H + pad * 2;
        d.x[i] = Math.random() * (W + pad * 2) - pad;
      } else if (d.y[i] < -pad * 2) d.y[i] += H + pad * 2;
      if (d.x[i] > W + pad) d.x[i] -= W + pad * 2;
      else if (d.x[i] < -pad) d.x[i] += W + pad * 2;
    }
  }

  // Full-resolution overlay, drawn after lighting: fog, cloud shadows, rain, lightning.
  drawOverlay(ctx, r) {
    const amb = this.game.lighting?.ambient;
    const dark = amb ? amb.darkness : 0;
    if (this.grey > 0.01) {
      // The grey: colour drained toward a cold ash, thicker away from you (indoors too:
      // Brindlecombe's houses stand open to it).
      const W = ctx.canvas.width;
      const H = ctx.canvas.height;
      ctx.globalAlpha = Math.min(1, this.grey);
      ctx.fillStyle = dark > 0.5 ? 'rgba(40,44,46,0.34)' : 'rgba(146,152,144,0.3)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (!this.indoors) {
      if (this.cloud > 0.02) this._drawClouds(ctx, r, dark);
      if (this.fog > 0.02 || this.rain > 0.2) this._drawFog(ctx, r, dark);
      if (this.rain > 0.02) this._drawRain(ctx, r, dark);
    }
    if (this.flash > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.flash * 0.22;
      ctx.fillStyle = '#c8d4ff';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  _fogTextures() {
    if (!this._fog) {
      const banks = fogMask(FOG_TEX, 911);
      const wisps = fogMask(FOG_TEX, 4027);
      this._fog = {
        day: makeFogTexture(banks, [226, 230, 238], 0.42, 0.78, 0.9),
        night: makeFogTexture(banks, [70, 80, 112], 0.42, 0.78, 0.9),
        wisps: makeFogTexture(wisps, [236, 238, 245], 0.5, 0.82, 0.8),
        wispsNight: makeFogTexture(wisps, [82, 92, 124], 0.5, 0.82, 0.8),
        shadow: makeFogTexture(banks, [12, 10, 30], 0.48, 0.74, 1),
      };
    }
    return this._fog;
  }

  // Tile a fog texture over the screen. `texel` = world px per texture pixel;
  // `parallax` 1 = fixed to the ground; drift is in world px.
  _tile(ctx, tex, r, texel, parallax, driftX, driftY) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const tile = FOG_TEX * texel * r.scale;
    const offX = -((r.viewX * parallax + driftX) * r.scale);
    const offY = -((r.viewY * parallax + driftY) * r.scale);
    const sx = (((offX % tile) + tile) % tile) - tile;
    const sy = (((offY % tile) + tile) % tile) - tile;
    for (let y = sy; y < H; y += tile) {
      for (let x = sx; x < W; x += tile) ctx.drawImage(tex, x, y, tile, tile);
    }
  }

  _drawFog(ctx, r, dark) {
    const tex = this._fogTextures();
    const level = Math.min(1, this.fog + this.rain * 0.18);
    const t = this.time;
    ctx.imageSmoothingEnabled = true;
    const night = Math.min(1, dark * 1.15);
    // Slow banks fixed to the ground, then faster wisps drifting above them.
    this._fogLayer(ctx, r, tex.day, tex.night, night, level * 0.5, 3, 1, t * 5, t * 1.2);
    this._fogLayer(ctx, r, tex.wisps, tex.wispsNight, night, level * 0.32, 1.9, 1.25, t * 11 + 300, 120 - t * 2);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
  }

  _fogLayer(ctx, r, dayTex, nightTex, night, a, texel, par, dx, dy) {
    if (night < 0.98) {
      ctx.globalAlpha = a * (1 - night);
      this._tile(ctx, dayTex, r, texel, par, dx, dy);
    }
    if (night > 0.02) {
      ctx.globalAlpha = a * night;
      this._tile(ctx, nightTex, r, texel, par, dx, dy);
    }
  }

  _drawClouds(ctx, r, dark) {
    const a = this.cloud * 0.2 * (1 - dark);
    if (a < 0.01) return;
    const tex = this._fogTextures();
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = a;
    this._tile(ctx, tex.shadow, r, 6, 1, this.time * 7, this.time * 2);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
  }

  _drawRain(ctx, r, dark) {
    const d = this._drops;
    if (!d) return;
    const n = this._dropCount(r);
    const unit = r.scale / 3;
    const bright = 1 - dark * 0.55;
    const cr = Math.round(176 * bright + 40);
    const cg = Math.round(192 * bright + 40);
    const cb = Math.round(226 * bright + 29);
    ctx.lineCap = 'butt';
    // Three depth layers, one path each: far drops are short, thin and faint.
    for (let layer = 0; layer < 3; layer++) {
      const zLo = layer / 3;
      const zHi = (layer + 1) / 3;
      const len = (9 + 8 * layer) * unit;
      ctx.lineWidth = Math.max(1, Math.round((layer === 2 ? 1.6 : 1) * unit));
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(0.16 + layer * 0.12) * (0.5 + 0.5 * this.rain)})`;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const z = d.z[i];
        if (z < zLo || z >= zHi) continue;
        const x = d.x[i];
        const y = d.y[i];
        ctx.moveTo(x, y);
        ctx.lineTo(x - len * this.wind, y - len);
      }
      ctx.stroke();
    }
  }
}
