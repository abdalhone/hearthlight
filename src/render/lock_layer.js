// The lock-on reticle (round 14b, item 14; DESIGN §35.5): four bright corners round whoever
// game.lock holds, gently breathing, with their name and a thin health bar over their head.
// An fx entity in the world (drawn over everyone, like the murder layer), so the renderer
// needs no change. Nothing is drawn while nothing is locked.

import { Entity } from '../entities/entity.js';

const GOLD = '#ffd66b';
const DARK = 'rgba(12, 8, 20, 0.85)';

export class LockLayer extends Entity {
  constructor(game) {
    super(game, { id: 'lock_layer', solid: false, radius: 0 });
    this.type = 'fx';
  }

  get sortY() {
    return this.y + 2e6;
  }

  update() {
    const t = this.game?.lock?.target;
    const P = this.game?.player;
    const at = t || P;
    if (at) {
      this.x = at.x;
      this.y = at.y;
    }
  }

  isAlive() {
    return false;
  }

  canInteract() {
    return false;
  }

  draw(ctx, ox, oy, time = 0) {
    const t = this.game?.lock?.target;
    if (!t || t.removed || t.hidden) return;
    const sx = Math.round(t.x - ox);
    const sy = Math.round(t.y - oy);
    const big = t.boss ? 1.8 : 1;
    const w = Math.round(9 * big + Math.sin(time * 5) * 1.2);
    const top = sy - Math.round(22 * big);
    const bot = sy + 3;
    const c = 4;
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = DARK;
    const corner = (x, y, dx, dy) => {
      ctx.fillRect(x - 1, y - 1, (c + 2) * Math.sign(dx || 1), 3);
      ctx.fillRect(x - 1, y - 1, 3, (c + 2) * Math.sign(dy || 1));
    };
    corner(sx - w, top, 1, 1);
    corner(sx + w, top, -1, 1);
    corner(sx - w, bot, 1, -1);
    corner(sx + w, bot, -1, -1);
    ctx.fillStyle = t.downed ? '#ff6b6b' : GOLD;
    const line = (x, y, dx, dy) => {
      ctx.fillRect(x, y, c * dx || 1, 1);
      ctx.fillRect(x, y, 1, c * dy || 1);
    };
    line(sx - w, top, 1, 1);
    line(sx + w, top, -1, 1);
    line(sx - w, bot, 1, -1);
    line(sx + w, bot, -1, -1);
    // Name and health, small, over their head.
    const name = (t.name || t.species || '').split(' ')[0];
    const hp = Math.max(0, Math.min(1, (t.hp || 0) / (t.maxHp || 1)));
    const bw = Math.max(16, Math.round(w * 2));
    const by = top - 5;
    ctx.fillStyle = DARK;
    ctx.fillRect(sx - bw / 2 - 1, by - 1, bw + 2, 4);
    ctx.fillStyle = '#5c0f17';
    ctx.fillRect(sx - bw / 2, by, bw, 2);
    ctx.fillStyle = t.downed ? '#ff6b6b' : '#e8473b';
    ctx.fillRect(sx - bw / 2, by, Math.round(bw * hp), 2);
    if (name) {
      ctx.font = '6px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = DARK;
      ctx.fillText(name, sx + 1, by - 1);
      ctx.fillStyle = GOLD;
      ctx.fillText(name, sx, by - 2);
    }
    ctx.restore();
  }
}
