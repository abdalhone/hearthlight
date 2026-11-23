import { Actor } from './entity.js';
import { FACTION } from '../core/constants.js';

// STUB (owned by the characters agent).
// Contract: SPECIES table and spawnCreature(game, species, x, y, opts) -> Creature (added to game.entities).
// Creature has .species, a simple AI controller, drops loot via game.combat on death.
export const SPECIES = {
  slime: { name: 'Slime', kind: 'monster', faction: FACTION.MONSTER, maxHp: 14, atk: 3, speed: 30, xp: 4, spriteKey: 'slime', drops: [['slime_gel', 0.7]] },
};

class WanderController {
  constructor() {
    this.t = 0;
    this.v = { x: 0, y: 0 };
  }
  update(a, dt) {
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 1 + Math.random() * 2;
      const ang = Math.random() * Math.PI * 2;
      this.v = Math.random() < 0.4 ? { x: 0, y: 0 } : { x: Math.cos(ang) * 0.5, y: Math.sin(ang) * 0.5 };
    }
    a.moveIntent = this.v;
  }
}

export class Creature extends Actor {
  constructor(game, species, o = {}) {
    const s = SPECIES[species] || SPECIES.slime;
    super(game, { name: s.name, kind: s.kind, faction: s.faction, maxHp: s.maxHp, atk: s.atk, speed: s.speed, spriteKey: s.spriteKey, ...o });
    this.species = species;
    this.def_ = s;
    this.controller = new WanderController();
  }
}

export function spawnCreature(game, species, x, y, opts = {}) {
  return game.entities.add(new Creature(game, species, { x, y, ...opts }));
}
