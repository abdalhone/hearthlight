// STUB (owned by the mind agent). The full interface is in DESIGN.md ("Mind").
export class Mind {
  constructor(game, owner) {
    this.game = game;
    this.owner = owner;
    this.thoughts = [];
    this.conversation = [];
    this.relationships = {
      isFriend: (e) => e === game.player || e.faction === 'villager' || e.faction === 'guard' || e.faction === 'player',
      isEnemy: (e) => false,
      get: () => null,
      all: () => [],
    };
  }
  update(dt) {}
  addThought(text, source = 'self') {
    this.thoughts.push({ text, source, t: this.game.clock.t });
  }
  remember(text, opts = {}) {}
  recall(query, opts = {}) {
    return [];
  }
  mood() {
    return { label: 'content', valence: 0.2, arousal: 0.3 };
  }
  describeState() {
    return 'Feeling content.';
  }
  serialize() {
    return {};
  }
  deserialize(d) {}
}
