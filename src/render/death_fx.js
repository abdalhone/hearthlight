// The cinematic around a fall (DESIGN §27), drawn over the lit world at full resolution:
// the color drains as the bleed-out window closes, a vignette closes in and breathes with
// the heartbeat, and black bars letterbox the screen while the player is carried.
// Reads game.survival.fxState(); eases everything so nothing pops.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// The last stand's fire (§25), painted once each.
const FLAME_W = 64; // pixels across one tile of the flame strip
const FLAME_H = 14; // its height: the tallest tongue

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Four frames of pixel flames rising from the strip's top row (the rim) inward: white-hot
// at the root, then gold, orange, ember red at the tips. Tileable across FLAME_W.
const FLAME_COLORS = [
  [255, 246, 214],
  [255, 214, 110],
  [255, 150, 40],
  [240, 84, 18],
  [178, 34, 10],
];
function flameFrames() {
  const out = [];
  for (let f = 0; f < 4; f++) {
    const c = canvas(FLAME_W, FLAME_H);
    const x = c.getContext('2d');
    const img = x.createImageData(FLAME_W, FLAME_H);
    const d = img.data;
    const TAU = Math.PI * 2;
    for (let col = 0; col < FLAME_W; col++) {
      const u = col / FLAME_W;
      // Whole waves across the strip, so it tiles without a seam.
      const h0 =
        0.42 +
        0.22 * Math.sin(TAU * (u * 5 + f * 0.23)) +
        0.16 * Math.sin(TAU * (u * 11 - f * 0.31) + 1.3) +
        0.1 * Math.sin(TAU * (u * 2 + f * 0.11) + 0.4);
      const h = Math.max(2, Math.min(FLAME_H, Math.round(h0 * FLAME_H)));
      for (let row = 0; row < h; row++) {
        const k = row / h;
        const ci = k < 0.18 ? 0 : k < 0.4 ? 1 : k < 0.66 ? 2 : k < 0.86 ? 3 : 4;
        const [r, g, b] = FLAME_COLORS[ci];
        const i = (row * FLAME_W + col) * 4;
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = k > 0.86 ? 200 : 255;
      }
    }
    x.putImageData(img, 0, 0);
    out.push(c);
  }
  return out;
}

// Draw something along each of the four edges, inward from the rim: fn(length, i) draws in
// a frame whose x runs along the edge and whose y runs from the rim into the screen.
function eachEdge(ctx, W, H, fn) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); // top: rim at y = 0
  fn(W, 0);
  ctx.setTransform(-1, 0, 0, -1, W, H); // bottom: rim at y = H
  fn(W, 1);
  ctx.setTransform(0, 1, 1, 0, 0, 0); // left: rim at x = 0
  fn(H, 2);
  ctx.setTransform(0, -1, -1, 0, W, H); // right: rim at x = W
  fn(H, 3);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export class DeathFx {
  constructor(game) {
    this.game = game;
    this.drain = 0; // 0..1 how much color is gone
    this.close = 0; // 0..1 how far the vignette has closed
    this.bars = 0; // 0..1 letterbox
    this.flash = 0; // the white-out of the moment you fall
    this.burn = 0; // 0..1 the last stand's fire round the edges (§25)
    this._flames = null; // the last stand's pixel flames, and its edge strips per window size
    this._edge = null;
    this._grad = null;
    this._gradCtx = null;
    this.was = false;
    this.supported = null;
  }

  // Saturation compositing exists in every browser this game runs in; feature-detect once.
  _canDesaturate(ctx) {
    if (this.supported != null) return this.supported;
    try {
      const prev = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'saturation';
      this.supported = ctx.globalCompositeOperation === 'saturation';
      ctx.globalCompositeOperation = prev;
    } catch {
      this.supported = false;
    }
    return this.supported;
  }

  _vignette(ctx) {
    if (this._grad && this._gradCtx === ctx) return this._grad;
    const g = ctx.createRadialGradient(0, 0, 0.15, 0, 0, 1);
    g.addColorStop(0, 'rgba(4,2,10,0)');
    g.addColorStop(0.5, 'rgba(4,2,10,0.25)');
    g.addColorStop(0.78, 'rgba(6,2,10,0.78)');
    g.addColorStop(1, 'rgba(2,0,6,0.97)');
    this._grad = g;
    this._gradCtx = ctx;
    return g;
  }

  // The last stand's minute (§25): fire at the edges of the screen, breathing faster as
  // the minute runs out, white-hot in the last ten seconds. Each edge is one strip, painted
  // once per window size (four frames of flicker): a scorched rim that darkens and reddens
  // the screen's edge (so the fire reads on bright grass and snow, not only at night), a
  // soft glow a little way in, and a row of pixel flames licking in from the rim. A frame
  // costs four plain copies (a gradient evaluated per pixel every frame, or a full-screen
  // blend, costs a phone a third of its frames).
  drawBurn(ctx, renderer, dt, reduce) {
    const g = this.game;
    let left = null;
    try {
      left = g.prices?.lastStandLeft?.() ?? null;
    } catch {
      left = null;
    }
    this.burn += ((left != null ? 1 : 0) - this.burn) * Math.min(1, dt * 3);
    if (this.burn < 0.005) return;
    const W = renderer.canvas.width;
    const H = renderer.canvas.height;
    const edge = this._edgeStrips(W, H);
    if (!edge) return;
    const t = g.time || 0;
    const L = left ?? 0;
    const speed = 2.2 + (1 - Math.min(1, L / 60)) * 6;
    const pulse = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(t * speed);
    const last = left != null && L < 10 ? 1 - L / 10 : 0; // 0..1 over the last ten seconds
    const f = reduce ? 0 : Math.floor(t * 9) % edge.h.length;
    const drift = reduce ? 0 : Math.floor((t * 14 * edge.px) % edge.tw);
    const depth = Math.round(edge.depth * (1 + 0.4 * last));
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = clamp01(this.burn * (0.8 + 0.2 * pulse));
    ctx.imageSmoothingEnabled = false;
    eachEdge(ctx, W, H, (len, i) => {
      const img = i < 2 ? edge.h[(f + i) % edge.h.length] : edge.v[(f + i) % edge.v.length];
      // (each edge drifts its own way, so the corners do not meet in step)
      const x = -(i % 2 ? edge.tw - 1 - drift : drift);
      if (depth === edge.depth) ctx.drawImage(img, x, 0);
      else ctx.drawImage(img, x, 0, img.width, depth);
    });
    ctx.restore();
    if (last > 0 && !reduce) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = clamp01(last * 0.18 * pulse);
      ctx.fillStyle = '#fff0d8';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  // The four edges' strips for this window size (rebuilt only when it changes).
  _edgeStrips(W, H) {
    if (typeof document === 'undefined') return null;
    const px = Math.max(2, Math.round(Math.min(W, H) / 170)); // one flame pixel, in screen px
    const key = `${W}x${H}:${px}`;
    if (this._edge?.key === key) return this._edge;
    const tw = FLAME_W * px;
    const fh = FLAME_H * px;
    const depth = Math.round(fh * 2.2);
    const flames = this._flames || (this._flames = flameFrames());
    const strip = (len, frame) => {
      const c = canvas(len + tw, depth);
      const x = c.getContext('2d');
      // The scorched rim and the glow, row 0 at the rim.
      const gr = x.createLinearGradient(0, 0, 0, depth);
      gr.addColorStop(0, 'rgba(110,14,2,0.95)');
      gr.addColorStop(0.3, 'rgba(150,34,6,0.62)');
      gr.addColorStop(0.6, 'rgba(200,70,16,0.24)');
      gr.addColorStop(1, 'rgba(255,110,30,0)');
      x.fillStyle = gr;
      x.fillRect(0, 0, len + tw, depth);
      x.imageSmoothingEnabled = false;
      for (let at = 0; at < len + tw; at += tw) x.drawImage(flames[frame], at, 0, tw, fh);
      return c;
    };
    this._edge = { key, px, tw, depth, h: flames.map((_, i) => strip(W, i)), v: flames.map((_, i) => strip(H, i)) };
    return this._edge;
  }

  draw(ctx, renderer, dt) {
    const g = this.game;
    const s = g.survival?.fxState?.() || null;
    const reduce = !!g.settings?.reduceMotion;
    this.drawBurn(ctx, renderer, dt, reduce);
    const k = Math.min(1, dt * 2.2);
    const wantDrain = s ? 0.62 + 0.36 * (1 - s.frac) : 0;
    const wantClose = s ? 0.32 + 0.6 * (1 - s.frac) : 0;
    const wantBars = s?.carried ? 1 : 0;
    if (s && !this.was) this.flash = reduce ? 0 : 0.55;
    this.was = !!s;
    this.drain += (wantDrain - this.drain) * k;
    this.close += (wantClose - this.close) * k;
    this.bars += (wantBars - this.bars) * Math.min(1, dt * 3);
    this.flash = Math.max(0, this.flash - dt * 1.6);
    if (this.drain < 0.005 && this.close < 0.005 && this.bars < 0.005 && this.flash < 0.005) return;
    const W = renderer.canvas.width;
    const H = renderer.canvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // 1. Color drains away.
    if (this.drain > 0.005) {
      if (this._canDesaturate(ctx)) {
        ctx.globalCompositeOperation = 'saturation';
        ctx.globalAlpha = clamp01(this.drain);
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, W, H);
      }
      // A cold cast over what is left.
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = clamp01(this.drain * 0.35);
      ctx.fillStyle = '#9aa0c8';
      ctx.fillRect(0, 0, W, H);
    }
    // 2. The vignette closes in, and breathes with each heartbeat.
    if (this.close > 0.005) {
      const pulse = reduce ? 0 : s?.pulse || 0;
      const r = 1.25 - this.close * 0.55 - pulse * 0.06;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = clamp01(0.55 + this.close * 0.45);
      ctx.fillStyle = this._vignette(ctx);
      ctx.setTransform((W / 2) * r, 0, 0, (H / 2) * r * 1.15, W / 2, H / 2);
      ctx.fillRect(-2, -2, 4, 4);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // A dark-red throb at the edges on each beat.
      if (pulse > 0.05) {
        ctx.globalAlpha = pulse * 0.22 * (0.5 + this.close);
        ctx.fillStyle = '#5a0612';
        const e = Math.round(Math.min(W, H) * 0.06);
        ctx.fillRect(0, 0, W, e);
        ctx.fillRect(0, H - e, W, e);
        ctx.fillRect(0, 0, e, H);
        ctx.fillRect(W - e, 0, e, H);
      }
    }
    // 3. The moment of falling: a pale flash that fades.
    if (this.flash > 0.005) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = this.flash;
      ctx.fillStyle = '#f4ead7';
      ctx.fillRect(0, 0, W, H);
    }
    // 4. Letterbox while carried.
    if (this.bars > 0.005) {
      const bh = Math.round(H * 0.11 * this.bars);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#050309';
      ctx.fillRect(0, 0, W, bh);
      ctx.fillRect(0, H - bh, W, bh);
    }
    ctx.restore();
  }
}
