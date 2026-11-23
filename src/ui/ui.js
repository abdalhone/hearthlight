// STUB (owned by the UI agent). The DOM user interface. Contract in DESIGN.md ("UI").
export class UI {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.chat = {
      messages: [],
      open: () => {},
      close: () => {},
      isOpen: () => false,
      addMessage: (m) => this.chat.messages.push(m),
      setThinking: (on) => {},
    };
  }
  init() {
    const btn = document.createElement('button');
    btn.textContent = 'Start';
    btn.id = 'start-btn';
    btn.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:20px;padding:12px 24px';
    btn.onclick = () => {
      btn.remove();
      this.game.audio.unlock();
      this.game.newGame();
    };
    this.root.appendChild(btn);
  }
  showTitle() {}
  update(dt) {}
  toast(text, kind = 'info') {
    console.log('[toast]', text);
  }
  openDialog(npc) {}
  closeDialog() {}
  openMind(tab) {}
  openInventory() {}
  openSettings() {}
  isModalOpen() {
    return false;
  }
  setInteractPrompt(label) {}
  fadeOut(seconds) {
    return Promise.resolve();
  }
  fadeIn(seconds) {
    return Promise.resolve();
  }
}
