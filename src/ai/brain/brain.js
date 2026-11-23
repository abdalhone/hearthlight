// STUB (owned by the brain agent). The full interface is in DESIGN.md ("Brain").
export class Brain {
  constructor(game) {
    this.game = game;
    this.busy = false;
  }
  init() {}
  update(dt) {}
  llmAvailable() {
    return false;
  }
  status() {
    return { provider: 'local', label: 'Local mind', busy: this.busy, lastError: null };
  }
  async handlePlayerMessage(text) {
    const g = this.game;
    const t = text.toLowerCase();
    let reply = 'I hear you.';
    if (/follow/.test(t)) {
      g.actions.run('follow', { target: 'player' }, 'local');
      reply = 'Right behind you.';
    } else if (/stay|wait/.test(t)) {
      g.actions.run('stay', {}, 'local');
      reply = "I'll wait here.";
    } else if (/attack/.test(t)) {
      g.actions.run('set_combat_mode', { value: 'attack' }, 'local');
      reply = 'Attack mode. Anything that is not a friend is fair game.';
    }
    g.ui.chat.addMessage({ from: 'lyra', text: reply });
    g.bubbles.say(g.companion, reply);
    return { say: reply };
  }
  async reflect(reason) {
    return null;
  }
  async generateConversation(npc, topic) {
    return null;
  }
}
