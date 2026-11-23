import { SAVE_KEY } from './constants.js';

// STUB (owned by the UI agent). Contract in DESIGN.md ("Saving").
export class SaveManager {
  constructor(game) {
    this.game = game;
  }
  async init() {}
  hasLocalSave() {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch {
      return false;
    }
  }
  async hasSave() {
    return this.hasLocalSave();
  }
  async save(reason = 'manual') {
    const data = this.game.serialize();
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
    return true;
  }
  async load() {
    try {
      return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    } catch {
      return null;
    }
  }
  update(dt) {}
}
