// Keyboard, gamepad and touch input, merged into named actions (DESIGN.md §14).
// The mapping helpers are pure exports so they are unit-tested without a browser;
// the Input class touches `window` only inside its constructor and methods.

export const ACTIONS = [
  'up', 'down', 'left', 'right', 'attack', 'dodge', 'interact', 'talk', 'mind', 'inventory', 'menu',
  'cmd1', 'cmd2', 'cmd3', 'cmd4', 'cmd5',
];

export const KEYMAP = Object.freeze({
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  KeyJ: 'attack', Space: 'attack',
  KeyK: 'dodge', ShiftLeft: 'dodge', ShiftRight: 'dodge',
  KeyE: 'interact',
  KeyT: 'talk', Enter: 'talk', NumpadEnter: 'talk',
  Tab: 'mind', KeyM: 'mind',
  KeyI: 'inventory',
  Escape: 'menu',
  Digit1: 'cmd1', Digit2: 'cmd2', Digit3: 'cmd3', Digit4: 'cmd4', Digit5: 'cmd5',
  Numpad1: 'cmd1', Numpad2: 'cmd2', Numpad3: 'cmd3', Numpad4: 'cmd4', Numpad5: 'cmd5',
});

// Standard gamepad layout: A attack, B dodge, X interact, Y talk, Start menu,
// Back mind, LB inventory, d-pad moves.
export const GAMEPAD_BUTTONS = Object.freeze({
  0: 'attack',
  1: 'dodge',
  2: 'interact',
  3: 'talk',
  4: 'inventory',
  8: 'mind',
  9: 'menu',
  12: 'up',
  13: 'down',
  14: 'left',
  15: 'right',
});

// [buttonIndex, action, heldKey] precomputed so polling allocates nothing.
const PAD_ENTRIES = Object.entries(GAMEPAD_BUTTONS).map(([i, a]) => [Number(i), a, `${a}#${i}`]);

// Keys whose browser default (scrolling, focus change) must not happen in-game.
const PREVENT = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function actionForKey(code, key) {
  if (code && KEYMAP[code]) return KEYMAP[code];
  // Some keyboards / IMEs report an empty code: fall back to the key name.
  if (!code && typeof key === 'string') {
    if (key === ' ') return 'attack';
    if (key.length === 1) return KEYMAP[`Key${key.toUpperCase()}`] || KEYMAP[`Digit${key}`] || null;
    return KEYMAP[key] || null;
  }
  return null;
}

export function shouldPreventDefault(code) {
  return PREVENT.has(code);
}

// Radial deadzone with rescale so small stick drift is ignored but full range remains.
export function applyDeadzone(x, y, dz = 0.22) {
  const m = Math.hypot(x, y);
  if (!(m > dz)) return { x: 0, y: 0 };
  const scaled = Math.min(1, (m - dz) / (1 - dz));
  return { x: (x / m) * scaled, y: (y / m) * scaled };
}

// Touch joystick: finger offset from the base -> vector of length <= 1.
export function joystickVector(dx, dy, radius, dz = 0.14) {
  const r = radius > 0 ? radius : 1;
  let x = dx / r;
  let y = dy / r;
  const m = Math.hypot(x, y);
  if (m > 1) {
    x /= m;
    y /= m;
  }
  return applyDeadzone(x, y, dz);
}

// Sum of digital directions + analog vectors, clamped to length 1.
export function combineMove(left, right, up, down, ax = 0, ay = 0) {
  let x = (right ? 1 : 0) - (left ? 1 : 0) + ax;
  let y = (down ? 1 : 0) - (up ? 1 : 0) + ay;
  const l = Math.hypot(x, y);
  if (l > 1) {
    x /= l;
    y /= l;
  }
  return { x, y };
}

export function isTextTarget(t) {
  if (!t) return false;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || t.isContentEditable) return true;
  if (tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (t.type || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color'].includes(type);
  }
  return false;
}

export class Input {
  constructor(game) {
    this.game = game;
    this.held = new Set(); // keyboard-held actions
    this.edge = new Set(); // actions pressed since the last endFrame
    this.virtual = new Set(); // on-screen buttons held down
    this.padHeld = new Set(); // 'action#buttonIndex'
    this.enabled = true; // false while typing or while a panel is open
    this.touchVec = { x: 0, y: 0 };
    this.padVec = { x: 0, y: 0 };
    this.lastDevice = 'keyboard'; // keyboard | gamepad | touch
    this.gamepadIndex = -1;
    this._bound = false;
    if (typeof window !== 'undefined') this._attach();
  }

  _attach() {
    if (this._bound) return;
    this._bound = true;
    window.addEventListener('keydown', (e) => this._onKeyDown(e));
    window.addEventListener('keyup', (e) => this._onKeyUp(e));
    window.addEventListener('blur', () => this.releaseAll());
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad?.index ?? 0;
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadIndex = -1;
      this.padHeld.clear();
      this.padVec.x = this.padVec.y = 0;
    });
  }

  isTyping(e) {
    return isTextTarget(e?.target);
  }

  _onKeyDown(e) {
    if (this.isTyping(e)) return;
    // Modifier chords belong to the browser (copy, reload, devtools).
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const a = actionForKey(e.code, e.key);
    if (!a) return;
    this.lastDevice = 'keyboard';
    if (!e.repeat && !this.held.has(a)) this.edge.add(a);
    this.held.add(a);
    // Only while playing: menus and panels keep Space, Tab and arrows for their buttons.
    const st = this.game?.state;
    if (shouldPreventDefault(e.code) && this.enabled && (st === undefined || st === 'playing')) e.preventDefault();
  }

  _onKeyUp(e) {
    const a = actionForKey(e.code, e.key);
    if (a) this.held.delete(a);
  }

  releaseAll() {
    this.held.clear();
    this.virtual.clear();
    this.touchVec.x = this.touchVec.y = 0;
  }

  // An on-screen button tap (one press).
  press(action) {
    this.edge.add(action);
  }

  // On-screen button held state (touch attack can be held for combos).
  setVirtual(action, down) {
    if (down) {
      if (!this.virtual.has(action)) this.edge.add(action);
      this.virtual.add(action);
    } else this.virtual.delete(action);
  }

  setTouchVector(x, y) {
    this.touchVec.x = Number.isFinite(x) ? x : 0;
    this.touchVec.y = Number.isFinite(y) ? y : 0;
    if (x || y) this.lastDevice = 'touch';
  }

  update() {
    this._pollGamepad();
  }

  _pollGamepad() {
    // Browsers announce a pad with 'gamepadconnected' once a button is pressed; until then skip polling.
    if (this.gamepadIndex < 0 || typeof navigator === 'undefined' || !navigator.getGamepads) return;
    let pad = null;
    try {
      const pads = navigator.getGamepads();
      if (this.gamepadIndex >= 0) pad = pads[this.gamepadIndex];
      if (!pad) for (const p of pads) if (p && p.connected) pad = p;
    } catch {
      return;
    }
    if (!pad) return;
    const v = applyDeadzone(pad.axes?.[0] ?? 0, pad.axes?.[1] ?? 0);
    this.padVec.x = v.x;
    this.padVec.y = v.y;
    if (v.x || v.y) this.lastDevice = 'gamepad';
    const buttons = pad.buttons || [];
    for (let i = 0; i < PAD_ENTRIES.length; i++) {
      const [idx, a, key] = PAD_ENTRIES[i];
      const b = buttons[idx];
      const down = !!(b && (b.pressed || b.value > 0.5));
      if (down) {
        if (!this.padHeld.has(key)) {
          this.edge.add(a);
          this.lastDevice = 'gamepad';
        }
        this.padHeld.add(key);
      } else this.padHeld.delete(key);
    }
  }

  endFrame() {
    this.edge.clear();
  }

  _isHeld(a) {
    if (this.held.has(a) || this.virtual.has(a)) return true;
    if (this.padHeld.size) {
      const n = a.length;
      for (const k of this.padHeld) if (k.length > n && k.charCodeAt(n) === 35 && k.startsWith(a)) return true; // 35 = '#'
    }
    return false;
  }

  down(a) {
    return this.enabled && this._isHeld(a);
  }

  pressed(a) {
    return this.enabled && this.edge.has(a);
  }

  // For the UI's own hotkeys (open/close panels): seen even while game input is off.
  uiPressed(a) {
    return this.edge.has(a);
  }

  consume(a) {
    this.edge.delete(a);
  }

  // Called every step by the player's controller: fills one reused vector instead of
  // allocating (read it right away; it changes on the next call).
  moveVector() {
    const out = this._mv || (this._mv = { x: 0, y: 0 });
    if (!this.enabled) {
      out.x = 0;
      out.y = 0;
      return out;
    }
    let x = (this._isHeld('right') ? 1 : 0) - (this._isHeld('left') ? 1 : 0) + this.touchVec.x + this.padVec.x;
    let y = (this._isHeld('down') ? 1 : 0) - (this._isHeld('up') ? 1 : 0) + this.touchVec.y + this.padVec.y;
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    out.x = x;
    out.y = y;
    return out;
  }
}
