import { Actor } from './entity.js';
import { FACTION, PLAYER_ID } from '../core/constants.js';

// STUB (owned by the combat/player agent).
// Contract: new Player(game, { x, y }) ; id = PLAYER_ID, faction = FACTION.PLAYER.
// Reads game.input each step (moveVector, pressed('attack'|'dodge'|'interact')).
class PlayerController {
  update(p, dt) {
    const g = p.game;
    const mv = g.input.moveVector();
    p.moveIntent = mv;
    if (g.input.pressed('interact')) g.interactions.tryInteract(p);
    if (g.input.pressed('attack')) g.combat.melee(p);
  }
}

export class Player extends Actor {
  constructor(game, o = {}) {
    super(game, {
      id: PLAYER_ID,
      name: game.settings?.playerName || 'Traveler',
      faction: FACTION.PLAYER,
      maxHp: 60,
      atk: 6,
      speed: 78,
      spriteKey: 'player',
      ...o,
    });
    this.controller = new PlayerController();
    this.gold = 20;
  }
}
