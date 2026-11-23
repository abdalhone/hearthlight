// STUB (owned by the UI agent). Contract in DESIGN.md ("Input").
const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  KeyJ: 'attack', Space: 'attack', KeyK: 'dodge', ShiftLeft: 'dodge', KeyE: 'interact', KeyT: 'talk', Enter: 'talk',
  Tab: 'mind', KeyM: 'mind', KeyI: 'inventory', Escape: 'menu',
  Digit1: 'cmd1', Digit2: 'cmd2', Digit3: 'cmd3', Digit4: 'cmd4', Digit5: 'cmd5',
};

export class Input {
  constructor(game) {
    this.game = game;
    this.held = new Set();
    this.edge = new Set();
    this.enabled = true; // false while typing in a text field
    this.touchVec = { x: 0, y: 0 };
    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a || this.isTyping(e)) return;
      if (!this.held.has(a)) this.edge.add(a);
      this.held.add(a);
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.held.delete(a);
    });
    window.addEventListener('blur', () => this.held.clear());
  }
  isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }
  // Press an action from on-screen buttons.
  press(action) {
    this.edge.add(action);
  }
  setTouchVector(x, y) {
    this.touchVec = { x, y };
  }
  update() {}
  endFrame() {
    this.edge.clear();
  }
  down(a) {
    return this.enabled && this.held.has(a);
  }
  pressed(a) {
    return this.enabled && this.edge.has(a);
  }
  moveVector() {
    if (!this.enabled) return { x: 0, y: 0 };
    let x = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0) + this.touchVec.x;
    let y = (this.held.has('down') ? 1 : 0) - (this.held.has('up') ? 1 : 0) + this.touchVec.y;
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y };
  }
}
