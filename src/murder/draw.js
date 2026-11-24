// How death looks (DESIGN §29): still and quiet, never gory. The dead lie in the pose they
// fell in, unmoving; once found, someone covers them with a linen cloth shaped to the body;
// laid out in the chapel they rest on a bier; buried, a mound and a headstone in the
// chapel yard. The finishing blow shows a ring closing over the fallen while it is held.

import { Entity } from '../entities/entity.js';
import { drawCharacter } from '../art/characters_art.js';
import { SHADOW } from '../art/palette.js';

const LINEN = ['#efe8d8', '#ddd3bf', '#c4b89f', '#a89b82'];
const OUTLINE = '#3b3346';
const shrouds = new Map(); // spriteKey -> { canvas, ox, oy } | null

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

// A cloth laid over the lying body, shaped to it: the lying frame's silhouette grown by a
// pixel, shaded top to bottom, with a dark outline and a fold or two. Cached per sprite.
export function shroudFor(atlas, key) {
  if (shrouds.has(key)) return shrouds.get(key);
  let out = null;
  try {
    const W = 48;
    const H = 40;
    const ox = 24;
    const oy = 32;
    const src = makeCanvas(W, H);
    const ctx = src?.getContext?.('2d');
    if (ctx) {
      drawCharacter(ctx, atlas, key, 'down', 'down', 0, ox, oy, {});
      const img = ctx.getImageData(0, 0, W, H);
      const a = img.data;
      const solid = new Uint8Array(W * H);
      let x0 = W;
      let x1 = 0;
      let y0 = H;
      let y1 = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (a[(y * W + x) * 4 + 3] > 40) {
            solid[y * W + x] = 1;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 >= x0) {
        // Grow the silhouette by a pixel all round (the cloth drapes past the body).
        const grown = new Uint8Array(W * H);
        for (let y = 1; y < H - 1; y++) {
          for (let x = 1; x < W - 1; x++) {
            if (solid[y * W + x] || solid[y * W + x - 1] || solid[y * W + x + 1] || solid[(y - 1) * W + x] || solid[(y + 1) * W + x]) grown[y * W + x] = 1;
          }
        }
        const dst = makeCanvas(W, H);
        const d = dst.getContext('2d');
        const span = Math.max(1, y1 - y0 + 2);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (!grown[y * W + x]) continue;
            const edge = !grown[y * W + x - 1] || !grown[y * W + x + 1] || !grown[(y - 1) * W + x] || !grown[(y + 1) * W + x];
            if (edge) {
              d.fillStyle = OUTLINE;
            } else {
              const k = (y - y0 + 1) / span;
              let i = k < 0.3 ? 0 : k < 0.62 ? 1 : k < 0.85 ? 2 : 3;
              // Folds: a few soft vertical creases across the cloth.
              if (i < 3 && (x - x0) % 7 === 3 && k > 0.25) i++;
              d.fillStyle = LINEN[i];
            }
            d.fillRect(x, y, 1, 1);
          }
        }
        out = { canvas: dst, ox, oy };
      }
    }
  } catch {
    out = null;
  }
  shrouds.set(key, out);
  return out;
}

// The body as it lies (rec: the murder record; rec.covered, rec.state).
export function drawBody(e, rec, ctx, ox, oy, time) {
  const sx = Math.round(e.x - ox);
  const sy = Math.round(e.y - oy);
  const atlas = e.game?.atlas;
  if (rec?.state === 'laid_out') drawBier(ctx, sx, sy);
  ctx.fillStyle = SHADOW;
  ctx.beginPath();
  ctx.ellipse(sx, sy - 1, 11, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  const lift = rec?.state === 'laid_out' ? 5 : 0;
  if (rec?.covered) {
    const s = shroudFor(atlas, e.spriteKey);
    if (s) {
      ctx.drawImage(s.canvas, sx - s.ox, sy - s.oy - lift);
      if (rec.state === 'laid_out') drawFlowers(ctx, sx, sy - lift, time);
      return;
    }
  }
  drawCharacter(ctx, atlas, e.spriteKey, 'down', e.dir || 'down', 0, sx, sy - lift, { state: 'dead' });
}

function drawBier(ctx, sx, sy) {
  ctx.fillStyle = '#4a3326';
  ctx.fillRect(sx - 12, sy - 6, 24, 3);
  ctx.fillStyle = '#6b4a35';
  ctx.fillRect(sx - 12, sy - 7, 24, 1);
  ctx.fillStyle = '#2f2119';
  ctx.fillRect(sx - 10, sy - 3, 2, 4);
  ctx.fillRect(sx + 8, sy - 3, 2, 4);
}

function drawFlowers(ctx, sx, sy, time) {
  const cols = ['#f2d36b', '#e8a0c0', '#ffffff'];
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = cols[i];
    ctx.fillRect(sx - 3 + i * 3, sy - 9 + (i % 2), 1, 1);
  }
  void time;
}

// A grave in the chapel yard: a mound of turned earth and a small stone, flowers after.
export class Grave extends Entity {
  constructor(game, { id, about, name, x, y, day }) {
    super(game, { id: `grave_${id || about}`, x, y, solid: false, radius: 4 });
    this.type = 'grave';
    this.about = about;
    this.name = name || '';
    this.day = day || 1;
  }

  update() {}

  isAlive() {
    return false;
  }

  canInteract(actor) {
    return !!actor && actor === this.game.player;
  }

  interactLabel() {
    return 'Read the stone';
  }

  interact() {
    const m = this.game.murder;
    try {
      this.game.ui?.showSign?.(`${this.name}`, m?.epitaph?.(this.about) || `${this.name}. Hearthvale keeps your flame.`);
    } catch {
      /* the UI is optional */
    }
  }

  draw(ctx, ox, oy) {
    const sx = Math.round(this.x - ox);
    const sy = Math.round(this.y - oy);
    // the mound
    ctx.fillStyle = '#3a2a22';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 3, 7, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5a4130';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 2, 6, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
    // the stone
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(sx - 4, sy - 9, 8, 10);
    ctx.fillRect(sx - 3, sy - 10, 6, 1);
    ctx.fillStyle = '#9a98a8';
    ctx.fillRect(sx - 3, sy - 9, 6, 9);
    ctx.fillRect(sx - 2, sy - 10, 4, 1);
    ctx.fillStyle = '#b9b7c6';
    ctx.fillRect(sx - 3, sy - 9, 2, 8);
    ctx.fillStyle = '#6e6c7c';
    ctx.fillRect(sx - 1, sy - 7, 3, 1);
    ctx.fillRect(sx - 1, sy - 5, 3, 1);
    // a candle-stub and a few flowers
    ctx.fillStyle = '#f2d36b';
    ctx.fillRect(sx + 4, sy + 1, 1, 1);
    ctx.fillStyle = '#e8a0c0';
    ctx.fillRect(sx - 5, sy + 2, 1, 1);
  }

  serialize() {
    return { id: this.id, about: this.about, x: this.x, y: this.y };
  }
}

// One entity over the world for what murder draws on top: the finishing ring.
export class MurderLayer extends Entity {
  constructor(murder) {
    super(murder.game, { id: 'murder_layer', solid: false, radius: 0 });
    this.type = 'fx';
    this.murder = murder;
  }

  get sortY() {
    return this.y + 1e6;
  }

  follow(game) {
    const c = game.camera;
    if (c && Number.isFinite(c.x) && Number.isFinite(c.vw)) {
      this.x = c.x + c.vw / 2;
      this.y = c.y + c.vh / 2;
    } else if (game.player) {
      this.x = game.player.x;
      this.y = game.player.y;
    }
  }

  update() {}

  isAlive() {
    return false;
  }

  canInteract() {
    return false;
  }

  draw(ctx, ox, oy, time) {
    const h = this.murder.hold;
    if (!h || !h.target || h.paused) return;
    const v = h.target;
    const k = Math.max(0, Math.min(1, h.t / h.need));
    const sx = Math.round(v.x - ox);
    const sy = Math.round(v.y - oy - 4);
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.4 * k;
    ctx.strokeStyle = '#1a0f14';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sx, sy, 15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = k > 0.85 ? '#ff6b5e' : '#d9c7b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, 15, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
    ctx.stroke();
    // A slow pulse: the moment hangs.
    const pulse = 0.5 + 0.5 * Math.sin((time || 0) * 10);
    ctx.globalAlpha = 0.15 + 0.2 * pulse * k;
    ctx.fillStyle = '#ff6b5e';
    ctx.beginPath();
    ctx.arc(sx, sy, 4 + 9 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
