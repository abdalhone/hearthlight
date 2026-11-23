import { Entity } from './entity.js';

// STUB (owned by the combat/player agent).
// Contract: class Pickup extends Entity (type 'pickup'); dropItem(game, itemId, qty, x, y) -> Pickup.
// The player collects pickups by walking over them; Lyra collects them through the
// 'pick_up' action or her own autonomy (see DESIGN.md).
export class Pickup extends Entity {
  constructor(game, o = {}) {
    super(game, { ...o, solid: false });
    this.type = 'pickup';
    this.itemId = o.itemId;
    this.qty = o.qty ?? 1;
  }
}

export function dropItem(game, itemId, qty, x, y) {
  return game.entities.add(new Pickup(game, { itemId, qty, x, y }));
}
