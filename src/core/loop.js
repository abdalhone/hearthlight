import { FIXED_DT } from './constants.js';

// Fixed-step simulation with one render per animation frame.
export class Loop {
  constructor(update, render) {
    this.update = update;
    this.render = render;
    this.acc = 0;
    this.last = 0;
    this.running = false;
    this.frame = this.frame.bind(this);
    this.fps = 60;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
  }

  frame(now) {
    if (!this.running) return;
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25; // tab was hidden or the device stalled
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < 8) {
      this.update(FIXED_DT);
      this.acc -= FIXED_DT;
      steps++;
    }
    if (steps >= 8) this.acc = 0;
    this._fpsAcc += dt;
    this._fpsFrames++;
    if (this._fpsAcc >= 1) {
      this.fps = Math.round(this._fpsFrames / this._fpsAcc);
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }
    try {
      this.render(this.acc / FIXED_DT, dt);
    } catch (err) {
      console.error('[loop] render failed', err);
    }
    requestAnimationFrame(this.frame);
  }
}
