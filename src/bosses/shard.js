// Glyph-shards (DESIGN §22.3): a glowing, slowly turning Lanternwright glyph in the
// palette of what it teaches. Walking into one unlocks that part of the Weave through
// game.magic.unlock(kind, id, source) (or, when the magic runtime is not in this build,
// keeps it in game.flags.pendingUnlocks for the runtime to pick up), and shows the reveal.
//
//   dropGlyphShard(game, kind, id, x, y, { source, boss, rise }) -> GlyphShard
//   grantGlyph(game, kind, id, source) -> 'magic' | 'pending' | 'known'

import { Entity } from '../entities/entity.js';
import { drawGlyph } from '../art/bosses_art.js';
import { GLYPH_PALETTE } from './defs.js';

const COLLECT_RADIUS = 10;
const MAGNET_RADIUS = 30;

let seq = 1;

export function glyphPalette(game, kind, id) {
  // The magic runtime's own palette wins (so the shard matches the weave it teaches).
  try {
    const m = game?.magic;
    const reg = m?.essences || m?.registry?.essences || m?.ESSENCES;
    const p = kind === 'essence' ? reg?.[id]?.palette : null;
    if (p && p.core && p.glow) return { core: p.core, glow: p.glow, spark: p.spark || p.core, deep: p.deep || p.glow };
  } catch {
    /* fall back to our own colors */
  }
  return GLYPH_PALETTE[kind === 'essence' ? id : 'twist'] || GLYPH_PALETTE.twist;
}

// Unlock through the magic runtime when there is one; otherwise remember it for later.
export function grantGlyph(game, kind, id, source) {
  const m = game?.magic;
  if (m && typeof m.unlock === 'function') {
    try {
      const had = hasUnlocked(m, kind, id);
      m.unlock(kind, id, source);
      return had ? 'known' : 'magic';
    } catch (err) {
      console.error('[shard] unlock failed', kind, id, err);
    }
  }
  if (!game.flags) game.flags = {};
  const list = (game.flags.pendingUnlocks = Array.isArray(game.flags.pendingUnlocks) ? game.flags.pendingUnlocks : []);
  if (list.some((u) => u && u.kind === kind && u.id === id)) return 'known';
  list.push({ kind, id, source });
  try {
    game.bus?.emit?.('magic_unlocked', { kind, id, source, pending: true });
  } catch {
    /* listeners must not break a pickup */
  }
  return 'pending';
}

function hasUnlocked(m, kind, id) {
  const u = m.realUnlocked || m.unlocked; // the real sets while "Try all magic" runs
  if (!u) return false;
  const set = u[kind] || u[`${kind}s`] || u[kind === 'essence' ? 'essences' : kind === 'twist' ? 'twists' : 'shapes'];
  return !!(set && typeof set.has === 'function' && set.has(id));
}

export class GlyphShard extends Entity {
  constructor(game, o = {}) {
    super(game, { id: `shard${seq++}`, x: o.x, y: o.y, solid: false, radius: 5 });
    this.type = 'glyph'; // not a 'pickup': Lyra's loot runs leave the player's glyphs alone
    this.glyph = true;
    this.kind = o.kind;
    this.glyphId = o.id;
    this.source = o.source || 'shard';
    this.bossId = o.boss || null;
    this.z = o.rise ? 2 : 10;
    this.vz = o.rise ? 120 + Math.random() * 30 : 0;
    this.vx = o.vx ?? 0;
    this.vy = o.vy ?? 0;
    this.collectDelay = o.collectDelay ?? 1.1;
    this.collected = false;
    this.pal = glyphPalette(game, this.kind, this.glyphId);
    this.spin = Math.random() * Math.PI * 2;
    this._light = { x: 0, y: 0, r: 46, color: this.pal.glow, intensity: 0.85, flicker: 0.08 };
  }

  get label() {
    return `${this.kind} glyph: ${this.glyphId}`;
  }

  isAlive() {
    return false;
  }

  canInteract() {
    return false;
  }

  update(dt) {
    super.update(dt);
    if (this.collected) return;
    this.spin += dt * 2.2;
    // Pops up out of whatever freed it, then hovers.
    if (this.vz !== 0 || this.z > 10) {
      this.vz -= 260 * dt;
      this.z += this.vz * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (this.z <= 10 && this.vz < 0) {
        this.z = 10;
        this.vz = 0;
        this.vx = this.vy = 0;
      }
    }
    if (Math.random() < dt * 5) {
      try {
        this.game.particles?.emit?.('sparkle', this.x + (Math.random() - 0.5) * 8, this.y - this.z - 4, { count: 1, color: this.pal.spark, speed: 8, life: 0.7 });
      } catch {
        /* cosmetic */
      }
    }
    if (this.age < this.collectDelay) return;
    const p = this.game.player;
    if (!p || p.removed || !(p.isAlive?.() ?? true)) return;
    const dx = p.x - this.x;
    const dy = p.y - 4 - this.y;
    const d = Math.hypot(dx, dy);
    if (d <= COLLECT_RADIUS) {
      this.collect(p);
      return;
    }
    if (d <= MAGNET_RADIUS) {
      const step = Math.min(d, (50 + (MAGNET_RADIUS - d) * 4) * dt);
      this.x += (dx / d) * step;
      this.y += (dy / d) * step;
    }
  }

  collect(actor) {
    if (this.collected) return false;
    this.collected = true;
    const g = this.game;
    const result = grantGlyph(g, this.kind, this.glyphId, this.source);
    g.entities?.remove?.(this);
    try {
      g.particles?.emit?.('levelup', this.x, this.y - this.z, { count: 20, color: this.pal.glow });
      g.lighting?.flash?.({ x: this.x, y: this.y - 10, r: 90, color: this.pal.glow, intensity: 0.9, duration: 0.5 });
      g.bosses?.sfx?.play?.('glyph', { volume: 1 });
    } catch {
      /* cosmetic */
    }
    g.bus?.emit?.('glyph_shard', { kind: this.kind, id: this.glyphId, source: this.source, boss: this.bossId, actor, result, palette: this.pal });
    return true;
  }

  getLight(time) {
    if (this.collected) return null;
    const L = this._light;
    L.x = this.x;
    L.y = this.y - this.z - 4;
    L.intensity = 0.75 + 0.15 * Math.sin((time || 0) * 3);
    return L;
  }

  drawShadow(ctx, ox, oy) {
    if (this.collected) return;
    const x = Math.round(this.x - ox);
    const y = Math.round(this.y - oy);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#100a1c';
    ctx.beginPath();
    ctx.ellipse(x, y, 5, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = this.pal.glow;
    ctx.beginPath();
    ctx.ellipse(x, y, 9, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  draw(ctx, ox, oy, time) {
    if (this.collected) return;
    const bob = Math.sin((time || 0) * 2.4 + this.spin * 0.1) * 1.5;
    const x = Math.round(this.x - ox);
    const y = Math.round(this.y - oy - this.z + bob);
    drawGlyph(ctx, this.game.atlas, this.kind, this.glyphId, x, y, { spin: this.spin, pal: this.pal, time });
  }

  serialize() {
    return { id: this.id, kind: this.kind, glyphId: this.glyphId, x: this.x, y: this.y };
  }
}

export function dropGlyphShard(game, kind, id, x, y, opts = {}) {
  if (!game?.entities?.add || !kind || !id) return null;
  return game.entities.add(new GlyphShard(game, { kind, id, x, y, ...opts }));
}
