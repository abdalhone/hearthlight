// STUB (owned by the render agent).
// Contract:
//  - Light sources are COLLECTED by the renderer every frame: any entity or world object
//    in or near the view may implement getLight(time) -> light | light[] | null.
//    light = { x, y, r, color: '#rrggbb', intensity: 0..1, flicker: 0..1 }  (world px)
//  - flash(light & { duration }) adds a short-lived light (hits, spells, lightning).
//  - update(dt) ages flashes. Everything else is internal to the render agent.
export class Lighting {
  constructor(game) {
    this.game = game;
    this.flashes = [];
  }
  flash(light) {
    if (this.flashes.length < 64) this.flashes.push({ duration: 0.25, ...light, t: 0 });
  }
  update(dt) {
    for (const f of this.flashes) f.t += dt;
    this.flashes = this.flashes.filter((f) => f.t < f.duration);
  }
}
