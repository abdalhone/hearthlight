import { TILE } from '../core/constants.js';

// Blood on the ground (DESIGN §27): a dark pool where someone falls and a smear behind
// whoever drags themselves along. Painted in the ground pass (drawShadow), under every
// body, in a few dark reds; marks dry and fade over a couple of minutes. Cosmetic only:
// not saved, capped, and culled to the view.

const MAX_MARKS = 240;
const LIFE = 150; // seconds until a mark is gone
const DRY = 40; // seconds a mark stays wet (full strength)
const SMEAR = ['#3d0910', '#5c0f17', '#7a1520'];

export class BloodTrail {
  constructor(game) {
    this.game = game;
    this.type = 'fx';
    this.marks = [];
    this.sortY = -1e9; // drawn on the ground pass; sorting never matters
  }

  now() {
    return this.game.time ?? 0;
  }

  wet(x, y) {
    try {
      const m = this.game.map;
      const tx = Math.floor(x / TILE);
      const ty = Math.floor(y / TILE);
      return !!(m?.isWet ? m.isWet(tx, ty) : m?.isWater?.(tx, ty)); // fords wash it away too
    } catch {
      return false;
    }
  }

  push(m) {
    if (this.wet(m.x, m.y)) return null; // the water takes it
    if (this.marks.length >= MAX_MARKS) this.marks.shift();
    this.marks.push(m);
    return m;
  }

  // Where someone fell: a small irregular pool under the body.
  pool(x, y, size = 1) {
    return this.push({ kind: 'pool', x: Math.round(x), y: Math.round(y), t: this.now(), s: size, seed: (x * 7 + y * 13) | 0 });
  }

  // One drag mark, oriented along the way they crawled (dx, dy unit).
  smear(x, y, dx, dy) {
    return this.push({ kind: 'smear', x: Math.round(x), y: Math.round(y), t: this.now(), dx, dy, seed: (x * 31 + y * 17) | 0 });
  }

  clear() {
    this.marks.length = 0;
  }

  // Ground pass: the renderer calls drawShadow on every drawable before any sprite.
  drawShadow(ctx, ox, oy) {
    const list = this.marks;
    if (!list.length) return;
    const now = this.now();
    const vw = ctx.canvas?.width ?? 9999;
    const vh = ctx.canvas?.height ?? 9999;
    let drop = 0;
    const prev = ctx.globalAlpha;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const age = now - m.t;
      if (age > LIFE) {
        drop = i + 1;
        continue;
      }
      const x = m.x - ox;
      const y = m.y - oy;
      if (x < -8 || y < -8 || x > vw + 8 || y > vh + 8) continue;
      const a = age < DRY ? 0.85 : 0.85 * (1 - (age - DRY) / (LIFE - DRY));
      ctx.globalAlpha = prev * Math.max(0, a);
      if (m.kind === 'pool') this.drawPool(ctx, x, y, m);
      else this.drawSmear(ctx, x, y, m, age);
    }
    ctx.globalAlpha = prev;
    if (drop) list.splice(0, drop);
  }

  drawPool(ctx, x, y, m) {
    const s = m.s || 1;
    ctx.fillStyle = SMEAR[0];
    ctx.fillRect(x - 4 * s, y - 1, 8 * s, 3);
    ctx.fillRect(x - 3 * s, y - 2, 6 * s, 5);
    ctx.fillStyle = SMEAR[1];
    ctx.fillRect(x - 3 * s, y - 1, 5 * s, 2);
    if (m.seed & 1) ctx.fillRect(x + 4 * s, y + 1, 2, 1);
    else ctx.fillRect(x - 6 * s, y, 2, 1);
  }

  drawSmear(ctx, x, y, m, age) {
    const horiz = Math.abs(m.dx) >= Math.abs(m.dy);
    const k = m.seed & 3;
    // Fresh blood is brighter; it darkens as it dries.
    ctx.fillStyle = age < 6 ? SMEAR[2] : SMEAR[1];
    if (horiz) {
      ctx.fillRect(x - 1, y - 1, 3, 2);
      ctx.fillStyle = SMEAR[0];
      ctx.fillRect(x - 2 + (k & 1), y + 1, 3, 1);
      if (k === 3) ctx.fillRect(x, y - 2, 1, 1);
    } else {
      ctx.fillRect(x - 1, y - 1, 2, 3);
      ctx.fillStyle = SMEAR[0];
      ctx.fillRect(x + 1, y - 2 + (k & 1), 1, 3);
      if (k === 3) ctx.fillRect(x - 2, y, 1, 1);
    }
  }

  draw() {
    /* everything is on the ground (drawShadow) */
  }
}
