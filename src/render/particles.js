// STUB (owned by the render agent).
// Contract: emit(type, x, y, opts) ; update(dt) ; draw(ctx, ox, oy) into the low-res buffer.
// Types: dust, hit, spark, leaf, wood_chip, stone_chip, magic, heal, smoke, splash, ember,
//        firefly, heart, levelup, poof, rain_splash, blood, note, sparkle.
// opts: { count, color, dir: {x,y}, spread, speed, life }
export class Particles {
  constructor(game) {
    this.game = game;
  }
  emit(type, x, y, opts = {}) {}
  update(dt) {}
  draw(ctx, ox, oy) {}
}
