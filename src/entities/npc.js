import { Actor } from './entity.js';
import { FACTION } from '../core/constants.js';

// STUB (owned by the characters agent).
// Contract: new NPC(game, profile, { x, y }); npc.profile; npc.role;
//  getDialogue(player) -> { lines: [string], options: [{ id, label }] }
//  chooseOption(id, player) -> { lines: [string], options?: [...], close?: bool }
//  interact(player) opens game.ui.openDialog(this)
export class NPC extends Actor {
  constructor(game, profile, o = {}) {
    super(game, { id: profile.id, name: profile.name, faction: profile.faction || FACTION.VILLAGER, spriteKey: profile.id, ...o });
    this.profile = profile;
    this.role = profile.role;
  }
  canInteract(actor) {
    return actor === this.game.player;
  }
  interactLabel() {
    return `Talk to ${this.name.split(' ')[0]}`;
  }
  interact(actor) {
    this.game.ui.openDialog(this);
  }
  getDialogue(player) {
    return { lines: [`Hello there.`], options: [{ id: 'bye', label: 'Goodbye' }] };
  }
  chooseOption(id, player) {
    return { lines: [], close: true };
  }
}
