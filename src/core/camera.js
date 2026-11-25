import { TILE } from './constants.js';
import { clamp } from './math.js';

// The camera: x, y = top-left of the view in world pixels (floats, so motion is
// smooth); vw, vh = view size in world pixels (set by the renderer on resize).
// Follows its target with exponential smoothing plus a small look-ahead in the
// direction the target is moving, clamps to the map, and shakes on demand.
// offX/offY are the current shake offsets; the renderer adds them when drawing.
export class Camera {
  constructor(game) {
    this.game = game;
    this.x = 0;
    this.y = 0;
    this.vw = 426;
    this.vh = 240;
    this.target = null;
    this.offX = 0;
    this.offY = 0;

    // Tuning. followRate/lookRate are 1/s; lookAhead is the furthest the view leads (px).
    this.followRate = 5.2;
    this.lookRate = 2.4;
    this.lookAhead = 26;
    this.lookTime = 0.38; // lead = velocity * lookTime, clamped
    this.focusY = -10; // center on the body, not the feet
    this.teleportDist = 72; // a jump larger than this in one step snaps instead of panning

    this.lookX = 0;
    this.lookY = 0;
    this.velX = 0;
    this.velY = 0;
    this._lastTX = null;
    this._lastTY = null;

    this.shakeT = 0;
    this.shakeDur = 0;
    this.shakeAmp = 0;
    this._shakeClock = 0;
    this._phase = [0, 1.7, 3.1, 4.4];
  }

  follow(e) {
    this.target = e || null;
    this._lastTX = e ? e.x : null;
    this._lastTY = e ? e.y : null;
    this.velX = this.velY = 0;
  }

  // Jump straight to the target (new game, load, after sleeping).
  snap() {
    const t = this.target;
    if (!t) return;
    this.lookX = this.lookY = 0;
    this.velX = this.velY = 0;
    this._lastTX = t.x;
    this._lastTY = t.y;
    this.x = t.x - this.vw / 2;
    this.y = t.y + this.focusY - this.vh / 2;
    this.clampToMap();
  }

  // Shake by up to `strength` world pixels for `seconds`. A stronger shake replaces a
  // fading one; reduced-motion players get a gentle nudge instead.
  shake(strength = 2, seconds = 0.2) {
    const s = Number(strength) || 0;
    const d = Number(seconds) || 0;
    if (s <= 0 || d <= 0) return;
    const k = this.game?.settings?.reduceMotion ? 0.3 : 1;
    const amp = Math.min(8, s * k);
    const current = this.shakeT > 0 ? this.shakeAmp * (this.shakeT / (this.shakeDur || 1)) : 0;
    if (amp >= current) {
      this.shakeAmp = amp;
      this.shakeDur = d;
      this.shakeT = d;
      for (let i = 0; i < 4; i++) this._phase[i] = Math.random() * 100;
    } else {
      this.shakeT = Math.max(this.shakeT, d);
      this.shakeDur = Math.max(this.shakeDur, this.shakeT);
    }
  }

  clampToMap() {
    const m = this.game?.map;
    if (!m) return;
    // The map may start west and north of the origin (the wider world: m.x0, m.y0 < 0).
    const mx = (m.x0 || 0) * TILE;
    const my = (m.y0 || 0) * TILE;
    const mw = m.w * TILE;
    const mh = m.h * TILE;
    this.x = mw > this.vw ? clamp(this.x, mx, mx + mw - this.vw) : mx + (mw - this.vw) / 2;
    this.y = mh > this.vh ? clamp(this.y, my, my + mh - this.vh) : my + (mh - this.vh) / 2;
  }

  update(dt) {
    const t = this.target;
    if (t && !t.removed && dt > 0) {
      if (this._lastTX == null) {
        this._lastTX = t.x;
        this._lastTY = t.y;
      }
      const dx = t.x - this._lastTX;
      const dy = t.y - this._lastTY;
      this._lastTX = t.x;
      this._lastTY = t.y;
      if (dx * dx + dy * dy > this.teleportDist * this.teleportDist) {
        this.snap();
      } else {
        // Smoothed velocity so a single jittery step does not swing the view.
        const kv = 1 - Math.exp(-dt * 8);
        this.velX += (dx / dt - this.velX) * kv;
        this.velY += (dy / dt - this.velY) * kv;
        const maxX = this.lookAhead;
        const maxY = this.lookAhead * 0.7;
        const wantX = clamp(this.velX * this.lookTime, -maxX, maxX);
        const wantY = clamp(this.velY * this.lookTime * 0.7, -maxY, maxY);
        const kl = 1 - Math.exp(-dt * this.lookRate);
        this.lookX += (wantX - this.lookX) * kl;
        this.lookY += (wantY - this.lookY) * kl;
        const goalX = t.x + this.lookX - this.vw / 2;
        const goalY = t.y + this.focusY + this.lookY - this.vh / 2;
        const kf = 1 - Math.exp(-dt * this.followRate);
        this.x += (goalX - this.x) * kf;
        this.y += (goalY - this.y) * kf;
      }
    }
    this.clampToMap();
    this._updateShake(dt);
  }

  _updateShake(dt) {
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      this._shakeClock += dt;
      const f = this.shakeDur > 0 ? this.shakeT / this.shakeDur : 0;
      const a = this.shakeAmp * f * f;
      const c = this._shakeClock;
      const p = this._phase;
      // Two incommensurate sines per axis: a rattle, not a regular wobble.
      this.offX = a * (Math.sin(c * 53 + p[0]) * 0.65 + Math.sin(c * 31 + p[1]) * 0.35);
      this.offY = a * (Math.sin(c * 47 + p[2]) * 0.65 + Math.sin(c * 37 + p[3]) * 0.35);
    } else {
      this.offX = this.offY = 0;
      this.shakeAmp = 0;
    }
  }

  // True when a world point is inside the view (plus `margin` px).
  inView(wx, wy, margin = 0) {
    return wx >= this.x - margin && wx <= this.x + this.vw + margin && wy >= this.y - margin && wy <= this.y + this.vh + margin;
  }

  // World px <-> screen (low-res buffer) px, including the current shake.
  worldToScreen(wx, wy) {
    return { x: wx - (this.x + this.offX), y: wy - (this.y + this.offY) };
  }

  screenToWorld(sx, sy) {
    return { x: sx + this.x + this.offX, y: sy + this.y + this.offY };
  }

  get centerX() {
    return this.x + this.vw / 2;
  }

  get centerY() {
    return this.y + this.vh / 2;
  }
}
