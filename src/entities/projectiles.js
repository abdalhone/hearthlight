import { Entity } from './entity.js';

// STUB (owned by the combat/player agent).
// Contract: class Projectile extends Entity (type 'projectile', solid false), added to
// game.entities by Combat.shoot(). kinds: 'bolt' (Lyra's arcane bolt, glows), 'arrow'.
export class Projectile extends Entity {
  constructor(game, o = {}) {
    super(game, { ...o, solid: false });
    this.type = 'projectile';
  }
}
