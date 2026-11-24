import { TARGET_VIRTUAL_MIN, TILE } from '../core/constants.js';
import { viewMetrics } from './text_layout.js';
import { TitleScene } from './title_scene.js';

// The renderer. The world is drawn into a low-res buffer (about 240 world px on the
// short side) and upscaled by an integer factor, so pixels stay crisp; the buffer is
// one pixel larger than the view and the upscale is offset by the camera's fractional
// position, so scrolling is smooth to the device pixel. Lighting, weather, bubbles
// and text are composited at full device resolution on top.
//
// Draw order: ground -> shadows -> y-sorted objects + entities (incl. projectiles and
// pickups) -> roofs -> particles -> upscale -> lighting (ambient + point lights + glow)
// -> glowing particles -> weather -> vignette -> name tags, numbers, bubbles, icons,
// Lyra's edge marker.

const BG = '#0b0a1a';
const LIGHT_MARGIN = 160;
const EMPTY = [];

const bySortY = (a, b) => a.sortY - b.sortY;

export class Renderer {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
    this.buffer = document.createElement('canvas');
    this.bctx = this.buffer.getContext('2d');
    this.scale = 3;
    this.dpr = 1;
    this.vw = 1; // view size in world px (float)
    this.vh = 1;
    // Where the last frame was drawn from: viewX/Y exact (world px), ox/oy the integer
    // buffer origin, subX/subY the device-pixel offset of the upscale.
    this.viewX = 0;
    this.viewY = 0;
    this.ox = 0;
    this.oy = 0;
    this.subX = 0;
    this.subY = 0;
    this.frame = 0;
    this.hurt = 0; // red edge pulse when the player is hit
    this.drawables = [];
    this.title = new TitleScene(game);
    this._reported = new Set();
    this._dirty = false;
    this._vignette = null; // cached CanvasGradient objects (see _vignetteGradient)
    this._hurtVignette = null;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (typeof ResizeObserver === 'function') {
      try {
        this._ro = new ResizeObserver(() => {
          this._dirty = true;
        });
        this._ro.observe(canvas);
      } catch {
        this._ro = null;
      }
    }
    const bus = game.bus;
    bus?.on('settings_changed', (p) => {
      if (p?.key === 'zoom') this.resize();
    });
    bus?.on('game_start', () => {
      // Title embers and fireflies live in title-screen coordinates; drop them.
      game.particles?.clear?.();
      this.title.dispose();
    });
    bus?.on('damage', (p) => {
      if (p?.target && p.target === game.player && (p.amount ?? 1) > 0) this.hurt = Math.min(1, this.hurt + 0.55 + Math.min(0.4, (p.amount || 0) / 40));
    });
    bus?.on('downed', (p) => {
      if (p?.entity && p.entity === game.player) this.hurt = 1;
    });
  }

  resize() {
    const c = this.canvas;
    const cssW = c.clientWidth || window.innerWidth || 1;
    const cssH = c.clientHeight || window.innerHeight || 1;
    const m = viewMetrics(cssW, cssH, window.devicePixelRatio || 1, this.game.settings?.zoom || 1, TARGET_VIRTUAL_MIN);
    if (c.width !== m.cw) c.width = m.cw;
    if (c.height !== m.ch) c.height = m.ch;
    this.dpr = m.dpr;
    this.scale = m.scale;
    this.vw = m.vw;
    this.vh = m.vh;
    if (this.buffer.width !== m.bw) this.buffer.width = m.bw;
    if (this.buffer.height !== m.bh) this.buffer.height = m.bh;
    this.ctx.imageSmoothingEnabled = false;
    this.bctx.imageSmoothingEnabled = false;
    const cam = this.game.camera;
    if (cam) {
      // Keep the same point centered when the view size changes.
      const cx = cam.x + cam.vw / 2;
      const cy = cam.y + cam.vh / 2;
      cam.vw = m.vw;
      cam.vh = m.vh;
      if (this.game.map) {
        cam.x = cx - m.vw / 2;
        cam.y = cy - m.vh / 2;
        cam.clampToMap?.();
      }
    }
  }

  // Low-res buffer pixel -> CSS pixel on the page (for DOM overlays).
  bufferToCss(bx, by) {
    return { x: (bx * this.scale - this.subX) / this.dpr, y: (by * this.scale - this.subY) / this.dpr };
  }

  // World pixel -> CSS pixel relative to the canvas' top-left (for DOM overlays).
  worldToCss(wx, wy) {
    const cam = this.game.camera;
    const vx = this.game.map ? this.viewX : cam?.x ?? 0;
    const vy = this.game.map ? this.viewY : cam?.y ?? 0;
    return { x: ((wx - vx) * this.scale) / this.dpr, y: ((wy - vy) * this.scale) / this.dpr };
  }

  // World pixel -> device pixel on the main canvas.
  worldToDevice(wx, wy) {
    return { x: (wx - this.ox) * this.scale - this.subX, y: (wy - this.oy) * this.scale - this.subY };
  }

  // CSS pixel (e.g. a pointer event) -> world pixel.
  cssToWorld(cx, cy) {
    return { x: this.viewX + (cx * this.dpr) / this.scale, y: this.viewY + (cy * this.dpr) / this.scale };
  }

  render(alpha, frameDt) {
    if (this._dirty) {
      this._dirty = false;
      this.resize();
    }
    const dt = Math.min(0.1, Math.max(0, Number.isFinite(frameDt) ? frameDt : 1 / 60));
    this.frame++;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const g = this.game;
    if (!g.map || g.state === 'title' || g.state === 'boot') this.renderTitle(dt);
    else this.renderWorld(dt);
  }

  // ------------------------------------------------------------------ title

  renderTitle(dt) {
    const g = this.game;
    const ctx = this.ctx;
    const b = this.bctx;
    const bw = this.buffer.width;
    const bh = this.buffer.height;
    this.ox = this.oy = 0;
    this.subX = this.subY = 0;
    this.viewX = this.viewY = 0;
    try {
      this.title.render(b, bw, bh, g.time, dt, g.particles);
    } catch (err) {
      this._report('title', err);
      b.fillStyle = BG;
      b.fillRect(0, 0, bw, bh);
    }
    g.particles?.draw(b, 0, 0, 'base');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.buffer, 0, 0, bw * this.scale, bh * this.scale);
    try {
      this.title.drawGlow(ctx, this, g.time, g.lighting);
    } catch (err) {
      this._report('title-glow', err);
    }
    g.particles?.drawGlow?.(ctx, this);
    this._drawVignette(ctx, 0.62, dt);
  }

  // ------------------------------------------------------------------ world

  renderWorld(dt) {
    const g = this.game;
    const ctx = this.ctx;
    const b = this.bctx;
    const map = g.map;
    const cam = g.camera;
    const time = g.time;
    const scale = this.scale;
    const bw = this.buffer.width;
    const bh = this.buffer.height;

    // Where to draw from: the camera plus shake, kept inside the map.
    let vx = cam.x + (cam.offX || 0);
    let vy = cam.y + (cam.offY || 0);
    const mw = map.w * TILE;
    const mh = map.h * TILE;
    vx = mw > this.vw ? Math.min(Math.max(vx, 0), mw - this.vw) : (mw - this.vw) / 2;
    vy = mh > this.vh ? Math.min(Math.max(vy, 0), mh - this.vh) : (mh - this.vh) / 2;
    const ox = Math.floor(vx);
    const oy = Math.floor(vy);
    this.viewX = vx;
    this.viewY = vy;
    this.ox = ox;
    this.oy = oy;
    this.subX = Math.round((vx - ox) * scale);
    this.subY = Math.round((vy - oy) * scale);

    // 1. The world, in the low-res buffer.
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'source-over';
    b.globalAlpha = 1;
    b.fillStyle = BG;
    b.fillRect(0, 0, bw, bh);
    try {
      map.drawGround(b, ox, oy, bw, bh, time);
    } catch (err) {
      this._report('map.drawGround', err);
    }
    const list = this._collectDrawables(ox, oy, bw, bh);
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (typeof d.drawShadow !== 'function') continue;
      try {
        d.drawShadow(b, ox, oy, time);
      } catch (err) {
        this._report(`shadow:${d.objType || d.type || 'thing'}`, err);
      }
    }
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (typeof d.draw !== 'function') continue;
      try {
        d.draw(b, ox, oy, time);
      } catch (err) {
        this._report(`draw:${d.objType || d.type || 'thing'}`, err);
      }
      b.globalAlpha = 1;
      b.globalCompositeOperation = 'source-over';
    }
    try {
      map.drawRoofs(b, ox, oy, bw, bh, time, g.player);
    } catch (err) {
      this._report('map.drawRoofs', err);
    }
    b.globalAlpha = 1;
    g.particles?.draw(b, ox, oy, 'base');

    // 2. Upscale with the sub-pixel offset.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.buffer, -this.subX, -this.subY, bw * scale, bh * scale);

    // 3. Lighting, then things that glow.
    const L = g.lighting;
    if (L) {
      try {
        L.beginFrame(dt);
        this._collectLights(L, ox, oy, bw, bh, time);
        L.composite(ctx, this, time, 0.32 + L.ambient.darkness * 0.45);
      } catch (err) {
        this._report('lighting', err);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
    }
    g.particles?.drawGlow?.(ctx, this);

    // 4. Weather overlay.
    const W = g.weather;
    if (W) {
      try {
        W.render?.(dt, this);
        W.drawOverlay?.(ctx, this);
      } catch (err) {
        this._report('weather', err);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    // 5. The vignette is part of the light map; here only the red pulse when hurt
    // (and a slow heartbeat at low health), drawn before text so bubbles stay crisp.
    const p = g.player;
    if (p && !p.removed && p.maxHp > 0 && p.hp > 0 && p.hp / p.maxHp < 0.25 && !p.downed) {
      const beat = g.settings?.reduceMotion ? 0.5 : Math.pow(Math.max(0, Math.sin(time * 4.2)), 8);
      this.hurt = Math.max(this.hurt, 0.18 + 0.3 * beat);
    }
    this._drawVignette(ctx, L ? 0 : 0.3, dt);

    // 6. Text and markers.
    try {
      g.bubbles?.draw(ctx, this);
    } catch (err) {
      this._report('bubbles', err);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // Objects and entities near the view, sorted by depth. Reuses one array.
  _collectDrawables(ox, oy, bw, bh) {
    const g = this.game;
    const list = this.drawables;
    list.length = 0;
    const x0 = ox - 64;
    const x1 = ox + bw + 64;
    const y0 = oy - 24;
    const y1 = oy + bh + 112; // tall sprites (trees) reach far above their base
    const objs = g.objects?.all?.() || EMPTY;
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      if (o.removed || o.hidden) continue;
      if (o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1) list.push(o);
    }
    const ents = g.entities?.all?.() || EMPTY;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.removed || e.hidden) continue;
      if (e.x >= x0 && e.x <= x1 && e.y >= y0 && e.y <= y1) list.push(e);
    }
    list.sort(bySortY);
    return list;
  }

  _collectLights(L, ox, oy, bw, bh, time) {
    const g = this.game;
    const x0 = ox - LIGHT_MARGIN;
    const x1 = ox + bw + LIGHT_MARGIN;
    const y0 = oy - LIGHT_MARGIN;
    const y1 = oy + bh + LIGHT_MARGIN;
    const ents = g.entities?.all?.() || EMPTY;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.removed || e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1) continue;
      if (typeof e.getLight === 'function') {
        try {
          L.collect(e.getLight(time));
        } catch (err) {
          this._report(`light:${e.type || 'entity'}`, err);
        }
      } else if (e.type === 'projectile' && e.kind === 'bolt') {
        // Lyra's arcane bolts glow violet even if their class gives no light.
        L.addLight(e.x, e.y - (e.z || 6), 34, '#a995ff', 0.9, 0.15, 1.3);
      }
    }
    const objs = g.objects?.all?.() || EMPTY;
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      if (o.removed || o.x < x0 || o.x > x1 || o.y < y0 || o.y > y1 || typeof o.getLight !== 'function') continue;
      try {
        L.collect(o.getLight(time));
      } catch (err) {
        this._report(`light:${o.objType || 'object'}`, err);
      }
    }
    g.particles?.collectLights?.(L);
    L.collectFlashes();

    // At night the player and Lyra are never lost in pitch black: a lantern if the
    // player carries one, otherwise a faint pool of moonlight; Lyra's magic glows softly.
    const dark = L.ambient.darkness;
    if (dark > 0.25) {
      const k = Math.min(1, (dark - 0.25) / 0.4);
      const p = g.player;
      if (p && !p.removed && !p.light) {
        if (p.inventory?.has?.('lantern')) L.addLight(p.x, p.y - 10, 88, '#ffc46a', 0.85 * k, 0.12, 0.8);
        else L.addLight(p.x, p.y - 8, 46, '#aab4ff', 0.22 * k, 0, 0.15);
      }
      const c = g.companion;
      if (c && !c.removed && !c.light && !c.downed) L.addLight(c.x, c.y - 10, 30, '#a995ff', 0.32 * k, 0.05, 0.5);
    }
  }

  // ------------------------------------------------------------------ vignette

  // Radial gradients in a unit circle, stretched to the screen by a transform, so the
  // falloff is smooth at full resolution. Built once per context and reused.
  _vignetteGradient(red) {
    const key = red ? '_hurtVignette' : '_vignette';
    if (this[key]) return this[key];
    const grad = this.ctx.createRadialGradient(0, 0, 0.2, 0, 0, 1);
    if (red) {
      grad.addColorStop(0, 'rgba(150,18,38,0)');
      grad.addColorStop(0.55, 'rgba(160,20,40,0.12)');
      grad.addColorStop(1, 'rgba(190,30,50,0.85)');
    } else {
      grad.addColorStop(0, 'rgba(8,6,20,0)');
      grad.addColorStop(0.45, 'rgba(8,6,20,0.1)');
      grad.addColorStop(0.8, 'rgba(7,5,18,0.55)');
      grad.addColorStop(1, 'rgba(6,4,16,0.9)');
    }
    this[key] = grad;
    return grad;
  }

  _fillVignette(red, alpha) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this._vignetteGradient(red);
    ctx.setTransform((W / 2) * 1.18, 0, 0, (H / 2) * 1.18, W / 2, H / 2);
    ctx.fillRect(-1, -1, 2, 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  _drawVignette(ctx, strength, dt) {
    ctx.globalCompositeOperation = 'source-over';
    if (strength > 0.01) this._fillVignette(false, Math.min(1, strength));
    if (this.hurt > 0.01) {
      this._fillVignette(true, Math.min(1, this.hurt * 0.55));
      this.hurt = Math.max(0, this.hurt - dt * 2.2);
    }
    ctx.globalAlpha = 1;
  }

  // Log a module's drawing error once (not every frame) and keep rendering.
  _report(where, err) {
    if (this._reported.has(where)) return;
    this._reported.add(where);
    console.error(`[render] ${where} failed`, err);
  }
}
