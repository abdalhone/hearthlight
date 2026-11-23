import { Actor } from './entity.js';
import { FACTION, COMPANION_ID } from '../core/constants.js';
import { Mind } from '../ai/mind/mind.js';
import { Behavior } from '../ai/behavior/behavior.js';

// STUB (owned by the behavior agent).
// Contract: new Companion(game, { x, y }) ; id = COMPANION_ID ; faction = FACTION.PLAYER
//  .mind     = new Mind(game, this)        (ai/mind/mind.js)
//  .behavior = new Behavior(game, this)    (ai/behavior/behavior.js)
//  The behavior acts as the controller. Talking to her (interact) opens the chat.
export class Companion extends Actor {
  constructor(game, o = {}) {
    super(game, {
      id: COMPANION_ID,
      name: game.settings?.companionName || 'Lyra',
      faction: FACTION.PLAYER,
      maxHp: 50,
      atk: 7,
      speed: 80,
      spriteKey: 'lyra',
      ...o,
    });
    this.mind = new Mind(game, this);
    this.behavior = new Behavior(game, this);
    this.controller = this.behavior;
  }

  update(dt) {
    super.update(dt);
    this.mind.update(dt);
  }

  canInteract(actor) {
    return actor === this.game.player;
  }

  interactLabel() {
    return this.downed ? `Help ${this.name} up` : `Talk to ${this.name}`;
  }

  interact(actor) {
    this.game.ui.chat.open();
  }

  serialize() {
    return { ...super.serialize(), mind: this.mind.serialize(), behavior: this.behavior.serialize() };
  }

  deserialize(d) {
    super.deserialize(d);
    if (d?.mind) this.mind.deserialize(d.mind);
    if (d?.behavior) this.behavior.deserialize(d.behavior);
  }
}
