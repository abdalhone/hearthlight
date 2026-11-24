// The cinematic around a fall (DESIGN §27), drawn over the lit world at full resolution:
// the color drains as the bleed-out window closes, a vignette closes in and breathes with
// the heartbeat, and black bars letterbox the screen while the player is carried.
// Reads game.survival.fxState(); eases everything so nothing pops.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class DeathFx {
  constructor(game) {
    this.game = game;
    this.drain = 0; // 0..1 how much color is gone
    this.close = 0; // 0..1 how far the vignette has closed
    this.bars = 0; // 0..1 letterbox
    this.flash = 0; // the white-out of the moment you fall
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

  draw(ctx, renderer, dt) {
    const g = this.game;
    const s = g.survival?.fxState?.() || null;
    const reduce = !!g.settings?.reduceMotion;
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
