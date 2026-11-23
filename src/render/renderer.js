import { TARGET_VIRTUAL_MIN } from '../core/constants.js';

// STUB (owned by the render agent). Contract in DESIGN.md ("Rendering").
export class Renderer {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.buffer = document.createElement('canvas');
    this.bctx = this.buffer.getContext('2d');
    this.scale = 3;
    this.dpr = 1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cw = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.dpr = dpr;
    const zoom = this.game.settings?.zoom || 1;
    this.scale = Math.max(1, Math.round((Math.min(cw, ch) / TARGET_VIRTUAL_MIN) * zoom));
    this.buffer.width = Math.ceil(cw / this.scale);
    this.buffer.height = Math.ceil(ch / this.scale);
    this.ctx.imageSmoothingEnabled = false;
    this.bctx.imageSmoothingEnabled = false;
    const cam = this.game.camera;
    if (cam) {
      cam.vw = this.buffer.width;
      cam.vh = this.buffer.height;
    }
  }

  // Low-res buffer pixel -> CSS pixel on the page (for DOM overlays).
  bufferToCss(bx, by) {
    return { x: (bx * this.scale) / this.dpr, y: (by * this.scale) / this.dpr };
  }

  render(alpha) {
    const g = this.game;
    const b = this.bctx;
    b.fillStyle = '#141332';
    b.fillRect(0, 0, this.buffer.width, this.buffer.height);
    if (!g.map) {
      this.present();
      return;
    }
    const cam = g.camera;
    const ox = Math.round(cam.x + cam.offX);
    const oy = Math.round(cam.y + cam.offY);
    const vw = this.buffer.width;
    const vh = this.buffer.height;
    g.map.drawGround(b, ox, oy, vw, vh, g.time);
    const drawables = [...g.objects.inView(ox, oy, vw, vh), ...g.entities.inView(ox, oy, vw, vh)];
    drawables.sort((p, q) => p.sortY - q.sortY);
    for (const d of drawables) d.draw(b, ox, oy, g.time);
    g.map.drawRoofs(b, ox, oy, vw, vh, g.time, g.player);
    this.present();
    g.bubbles?.draw(this.ctx, this);
  }

  present() {
    this.ctx.drawImage(this.buffer, 0, 0, this.buffer.width * this.scale, this.buffer.height * this.scale);
  }
}
