import { TILE } from './constants.js';
import { clamp } from './math.js';

// STUB (owned by the render agent).
// Contract: x, y = top-left of the view in world pixels (floats); vw, vh = view size in
// world pixels (set by the renderer on resize). follow(entity), shake(strength, seconds),
// update(dt), worldToScreen / screenToWorld (screen = low-res buffer pixels).
export class Camera {
  constructor(game) {
    this.game = game;
    this.x = 0;
    this.y = 0;
    this.vw = 480;
    this.vh = 270;
    this.target = null;
    this.shakeT = 0;
    this.shakeAmp = 0;
    this.offX = 0;
    this.offY = 0;
  }
  follow(e) {
    this.target = e;
  }
  snap() {
    if (!this.target) return;
    this.x = this.target.x - this.vw / 2;
    this.y = this.target.y - this.vh / 2;
    this.clampToMap();
  }
  shake(strength = 2, seconds = 0.2) {
    this.shakeAmp = Math.max(this.shakeAmp, strength);
    this.shakeT = Math.max(this.shakeT, seconds);
  }
  clampToMap() {
    const m = this.game.map;
    if (!m) return;
    this.x = clamp(this.x, 0, Math.max(0, m.w * TILE - this.vw));
    this.y = clamp(this.y, 0, Math.max(0, m.h * TILE - this.vh));
  }
  update(dt) {
    if (this.target) {
      const tx = this.target.x - this.vw / 2;
      const ty = this.target.y - 8 - this.vh / 2;
      const k = 1 - Math.pow(0.0005, dt);
      this.x += (tx - this.x) * k;
      this.y += (ty - this.y) * k;
    }
    this.clampToMap();
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      this.offX = (Math.random() * 2 - 1) * this.shakeAmp;
      this.offY = (Math.random() * 2 - 1) * this.shakeAmp;
    } else {
      this.offX = this.offY = 0;
      this.shakeAmp = 0;
    }
  }
  worldToScreen(wx, wy) {
    return { x: wx - this.x, y: wy - this.y };
  }
  screenToWorld(sx, sy) {
    return { x: sx + this.x, y: sy + this.y };
  }
}
