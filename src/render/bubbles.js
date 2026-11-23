// STUB (owned by the render agent).
// Contract:
//   say(entity, text, { kind: 'say'|'shout'|'whisper', duration })  speech bubble that types out
//   thought(entity, text, { duration })                               cloud-style thought bubble
//   icon(entity, name, { duration })   name: '!', '?', 'heart', 'zzz', 'anger', 'note', 'sweat', '...'
//   number(x, y, text, color)          floating damage/heal number at a world position
//   clear(entity)
//   update(dt) ; draw(ctx, renderer)   drawn on the full-resolution canvas (crisp text)
export class Bubbles {
  constructor(game) {
    this.game = game;
    this.items = [];
  }
  say(entity, text, opts = {}) {
    this.items = this.items.filter((b) => b.entity !== entity);
    this.items.push({ entity, text: String(text), t: 0, life: opts.duration ?? 3 + text.length * 0.05 });
  }
  thought(entity, text, opts = {}) {}
  icon(entity, name, opts = {}) {}
  number(x, y, text, color) {}
  clear(entity) {
    this.items = this.items.filter((b) => b.entity !== entity);
  }
  update(dt) {
    for (const b of this.items) b.t += dt;
    this.items = this.items.filter((b) => b.t < b.life && !b.entity.removed);
  }
  draw(ctx, renderer) {
    const cam = this.game.camera;
    ctx.font = `${Math.round(7 * renderer.scale)}px sans-serif`;
    ctx.textAlign = 'center';
    for (const b of this.items) {
      const x = (b.entity.x - cam.x) * renderer.scale;
      const y = (b.entity.y - 30 - cam.y) * renderer.scale;
      ctx.fillStyle = 'rgba(20,16,40,0.85)';
      const w = ctx.measureText(b.text).width + 16;
      ctx.fillRect(x - w / 2, y - 12 * renderer.scale * 0.8, w, 12 * renderer.scale);
      ctx.fillStyle = '#f4ead7';
      ctx.fillText(b.text, x, y);
    }
  }
}
