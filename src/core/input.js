// Keyboard, mouse, gamepad and touch input, merged into named actions (DESIGN.md §14,
// §22.4). The mapping helpers are pure exports so they are unit-tested without a
// browser; the Input class touches `window` only inside its constructor and methods.
//
// Weaving (§22.4): 1–6 cast the weave in that slot toward the mouse (hold for beams and
// charged weaves), the right button casts the selected slot, the wheel / Q / R pick the
// selected slot, B opens the Spellbook. The left button swings the sword toward the
// mouse. Asking Lyra moved off the number row to Alt (Option) + 1–5 and the numpad.

export const WEAVE_SLOTS = 6;

export const ACTIONS = [
  'up', 'down', 'left', 'right', 'attack', 'dodge', 'interact', 'talk', 'mind', 'inventory', 'menu',
  'cmd1', 'cmd2', 'cmd3', 'cmd4', 'cmd5',
  'weave1', 'weave2', 'weave3', 'weave4', 'weave5', 'weave6',
  'cast', 'slot_prev', 'slot_next', 'spellbook', 'character',
  'lock', 'lock_next', 'lock_prev',
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
  Digit1: 'weave1', Digit2: 'weave2', Digit3: 'weave3', Digit4: 'weave4', Digit5: 'weave5', Digit6: 'weave6',
  Numpad1: 'cmd1', Numpad2: 'cmd2', Numpad3: 'cmd3', Numpad4: 'cmd4', Numpad5: 'cmd5',
  KeyQ: 'slot_prev', KeyR: 'slot_next',
  KeyB: 'spellbook',
  KeyC: 'character', // the character sheet (DESIGN §26)
  KeyG: 'lock', // lock on to the nearest in front, or let go (round 14b, DESIGN §35.5)
});

// Alt (Option on a Mac) + 1–5 asks Lyra, as the plain number row did before weaving.
export const ALT_KEYMAP = Object.freeze({
  Digit1: 'cmd1', Digit2: 'cmd2', Digit3: 'cmd3', Digit4: 'cmd4', Digit5: 'cmd5',
});

// Standard gamepad layout: A attack, B dodge, X interact, Y talk, Start menu, Back mind,
// LB inventory, RB next weave, LT previous weave, RT cast the selected weave, d-pad moves.
// The right stick aims.
export const GAMEPAD_BUTTONS = Object.freeze({
  0: 'attack',
  1: 'dodge',
  2: 'interact',
  3: 'talk',
  4: 'inventory',
  5: 'slot_next',
  6: 'slot_prev',
  7: 'cast',
  8: 'mind',
  9: 'menu',
  11: 'lock', // R3: lock on (round 14b)
  12: 'up',
  13: 'down',
  14: 'left',
  15: 'right',
});

// [buttonIndex, action, heldKey] precomputed so polling allocates nothing.
const PAD_ENTRIES = Object.entries(GAMEPAD_BUTTONS).map(([i, a]) => [Number(i), a, `${a}#${i}`]);

// Keys whose browser default (scrolling, focus change, Option-characters) must not happen in-game.
const PREVENT = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

// How long a sword aim (a click toward the mouse, a drag on the sword button) stays fresh.
export const SWING_AIM_SECONDS = 0.4;
// Wheel travel (in pixels of deltaY) per slot step; a notched wheel gives ~100 per notch.
export const WHEEL_STEP = 100;

export function actionForKey(code, key, alt = false) {
  if (alt) return (code && ALT_KEYMAP[code]) || null;
  if (code && KEYMAP[code]) return KEYMAP[code];
  // Some keyboards / IMEs report an empty code: fall back to the key name.
  if (!code && typeof key === 'string') {
    if (key === ' ') return 'attack';
    if (key.length === 1) return KEYMAP[`Key${key.toUpperCase()}`] || KEYMAP[`Digit${key}`] || null;
    return KEYMAP[key] || null;
  }
  return null;
}

export function shouldPreventDefault(code, alt = false) {
  if (alt) return !!ALT_KEYMAP[code];
  return PREVENT.has(code);
}

// 'weave3' -> 2 (slot index); anything else -> -1.
export function slotOfAction(a) {
  if (typeof a !== 'string' || a.length !== 6 || !a.startsWith('weave')) return -1;
  const n = a.charCodeAt(5) - 49; // '1' -> 0
  return n >= 0 && n < WEAVE_SLOTS ? n : -1;
}

// Wheel deltas -> whole slot steps, keeping the remainder (trackpads send many small ones).
// Returns { steps, rest }. deltaMode 1 (lines) and 2 (pages) are scaled to pixels.
export function wheelSteps(rest, deltaY, deltaMode = 0) {
  const px = deltaMode === 1 ? deltaY * 40 : deltaMode === 2 ? deltaY * 400 : deltaY;
  let acc = (Number.isFinite(rest) ? rest : 0) + (Number.isFinite(px) ? px : 0);
  let steps = 0;
  while (acc >= WHEEL_STEP) {
    acc -= WHEEL_STEP;
    steps++;
  }
  while (acc <= -WHEEL_STEP) {
    acc += WHEEL_STEP;
    steps--;
  }
  // One wheel event is at most one step (a notch), never a spin through the whole bar.
  if (steps > 1) {
    steps = 1;
    acc = 0;
  }
  if (steps < -1) {
    steps = -1;
    acc = 0;
  }
  return { steps, rest: acc };
}

// Selected slot after `steps` (wrapping) among `count` slots.
export function cycleSlot(current, steps, count) {
  const n = Math.max(1, count | 0);
  const c = Number.isFinite(current) ? Math.trunc(current) : 0;
  return (((c + steps) % n) + n) % n;
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

// A floating stick follows the thumb: when the finger runs past the rim, the base slides
// after it so a turn-around never needs the thumb to travel back across the pad.
// Returns the new base { x, y } (unchanged while inside the rim).
export function followBase(bx, by, fx, fy, radius) {
  const dx = fx - bx;
  const dy = fy - by;
  const d = Math.hypot(dx, dy);
  if (!(d > radius) || !(radius > 0)) return { x: bx, y: by };
  const k = (d - radius) / d;
  return { x: bx + dx * k, y: by + dy * k };
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

function nowSeconds() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() / 1000 : Date.now() / 1000;
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
    this.padAim = { x: 0, y: 0 }; // right stick, deadzoned
    this.lastDevice = 'keyboard'; // keyboard | mouse | gamepad | touch
    this.gamepadIndex = -1;
    // The mouse over the game canvas: CSS px relative to the canvas, and when it last moved.
    this.mouse = { x: 0, y: 0, over: false, movedAt: -1e9, left: false, right: false };
    this.wheelRest = 0;
    this.wheelSteps = 0; // whole steps waiting for the weave controller
    // A one-off aim for the next sword swing (unit vector + when it goes stale).
    this.swingAimVec = { x: 0, y: 0, until: -1 };
    this.stepHooks = []; // run at the start of every fixed step (the weave controller)
    this._bound = false;
    if (typeof window !== 'undefined') this._attach();
    if (typeof window !== 'undefined') this._attachPick();
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
      this.padAim.x = this.padAim.y = 0;
    });
    // Mouse: on the window so a release outside the canvas still lets go of a held cast.
    window.addEventListener('pointermove', (e) => this._onPointerMove(e), { passive: true });
    window.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    // No autoscroll or paste from the middle button over the game (round 14b: it locks on).
    const noMiddle = (e) => {
      if (e.button === 1 && this._isCanvas(e.target)) e.preventDefault();
    };
    window.addEventListener('mousedown', noMiddle, { passive: false });
    window.addEventListener('auxclick', noMiddle, { passive: false });
    window.addEventListener('pointerup', (e) => this._onPointerUp(e));
    window.addEventListener('pointercancel', (e) => this._onPointerUp(e));
    window.addEventListener('mouseout', (e) => {
      if (!e.relatedTarget) this.mouse.over = false; // left the page
    });
    window.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    window.addEventListener('contextmenu', (e) => {
      if (this._isCanvas(e.target)) e.preventDefault();
    });
  }

  isTyping(e) {
    return isTextTarget(e?.target);
  }

  _playing() {
    const st = this.game?.state;
    return st === undefined || st === 'playing';
  }

  _onKeyDown(e) {
    if (this.isTyping(e)) return;
    // Modifier chords belong to the browser (copy, reload, devtools), except Alt + 1–5.
    if (e.ctrlKey || e.metaKey) return;
    const alt = !!e.altKey;
    const a = actionForKey(e.code, e.key, alt);
    if (!a) return;
    this.lastDevice = 'keyboard';
    if (!e.repeat && !this.held.has(a)) this.edge.add(a);
    this.held.add(a);
    // Only while playing: menus and panels keep Space, Tab and arrows for their buttons.
    if (shouldPreventDefault(e.code, alt) && this.enabled && this._playing()) e.preventDefault();
  }

  _onKeyUp(e) {
    // Release whatever the key was bound to, with or without Alt still held.
    const a = actionForKey(e.code, e.key, false);
    if (a) this.held.delete(a);
    const b = actionForKey(e.code, e.key, true);
    if (b) this.held.delete(b);
  }

  // ---------- mouse ----------

  _canvas() {
    return this.game?.canvas || this.game?.renderer?.canvas || null;
  }

  _isCanvas(t) {
    const c = this._canvas();
    return !!c && t === c;
  }

  _onPointerMove(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const c = this._canvas();
    if (!c) return;
    const r = c.getBoundingClientRect();
    const m = this.mouse;
    m.x = e.clientX - r.left;
    m.y = e.clientY - r.top;
    m.over = e.target === c;
    m.movedAt = nowSeconds();
    if (m.over) this.lastDevice = 'mouse';
  }

  _onPointerDown(e) {
    if (e.pointerType !== 'mouse') return;
    this._onPointerMove(e);
    if (!this._isCanvas(e.target) || !this._playing()) return;
    if (e.button === 0) {
      e.preventDefault();
      this.mouse.left = true;
      this.aimSwingAtMouse();
      this.setVirtual('attack', true);
    } else if (e.button === 2) {
      e.preventDefault();
      this.mouse.right = true;
      this.setVirtual('cast', true);
    } else if (e.button === 1) {
      // The middle button locks on to whoever is under the cursor (round 14b): never the
      // browser's autoscroll.
      e.preventDefault();
      this.lockClick = this.mouseWorld();
      this.setVirtual('lock', true);
    }
  }

  // The world point of the last middle click (game.lock reads it once).
  takeLockClick() {
    const at = this.lockClick || null;
    this.lockClick = null;
    return at;
  }

  // Wheel steps taken while locked: they cycle the lock, not the weave slots.
  takeLockWheel() {
    const s = this.lockWheel || 0;
    this.lockWheel = 0;
    return s;
  }

  _onPointerUp(e) {
    if (e.pointerType !== 'mouse') return;
    if (e.button === 0 && this.mouse.left) {
      this.mouse.left = false;
      this.setVirtual('attack', false);
    } else if (e.button === 2 && this.mouse.right) {
      this.mouse.right = false;
      this.setVirtual('cast', false);
    } else if (e.button === 1) {
      this.setVirtual('lock', false);
    }
  }

  _onWheel(e) {
    if (!this._isCanvas(e.target) || !this._playing() || !this.enabled) return;
    e.preventDefault();
    const r = wheelSteps(this.wheelRest, e.deltaY, e.deltaMode);
    this.wheelRest = r.rest;
    // Locked on (round 14b): the wheel cycles the lock; Q and R still pick weave slots.
    if (this.game?.lock?.target) this.lockWheel = (this.lockWheel || 0) + r.steps;
    else this.wheelSteps += r.steps;
  }

  // Whole wheel steps since the last call (the weave controller turns them into slots).
  takeWheel() {
    const s = this.wheelSteps;
    this.wheelSteps = 0;
    return s;
  }

  // Is the mouse aiming right now: over the game and moved in the last `within` seconds
  // (or a button held)? A keyboard-only player falls back to auto-aim.
  mouseAiming(within = 8) {
    const m = this.mouse;
    if (!m.over) return false;
    return m.left || m.right || nowSeconds() - m.movedAt < within;
  }

  // The mouse in world pixels (null when it is not over the game).
  mouseWorld() {
    if (!this.mouse.over) return null;
    const r = this.game?.renderer;
    if (!r?.cssToWorld) return null;
    return r.cssToWorld(this.mouse.x, this.mouse.y);
  }

  // Aim the next sword swing from the player toward the mouse.
  aimSwingAtMouse() {
    const p = this.game?.player;
    const w = this.mouseWorld();
    if (!p || !w) return;
    this.setSwingAim(w.x - p.x, w.y - (p.y - 6), SWING_AIM_SECONDS);
  }

  // Aim the next swing along (dx, dy); `seconds` it stays fresh (a held drag refreshes it).
  setSwingAim(dx, dy, seconds = SWING_AIM_SECONDS) {
    const l = Math.hypot(dx, dy);
    if (!(l > 0.0001)) return;
    const v = this.swingAimVec;
    v.x = dx / l;
    v.y = dy / l;
    v.until = (this.game?.time ?? nowSeconds()) + seconds;
  }

  clearSwingAim() {
    this.swingAimVec.until = -1;
  }

  // The fresh sword aim as a unit vector, or null. Read by the player when a swing starts.
  swingAim() {
    const v = this.swingAimVec;
    const t = this.game?.time ?? nowSeconds();
    if (t > v.until) return null;
    return v;
  }

  releaseAll() {
    this.held.clear();
    this.virtual.clear();
    this.touchVec.x = this.touchVec.y = 0;
    this.mouse.left = this.mouse.right = false;
    this.clearSwingAim();
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

  // Run `fn(dt)` at the start of every fixed step, before the world moves.
  onStep(fn) {
    if (typeof fn === 'function') this.stepHooks.push(fn);
  }

  update(dt = 1 / 60) {
    this._pollGamepad();
    // Holding the left button keeps the blade turned toward the cursor.
    if (this.mouse.left && this.mouse.over) this.aimSwingAtMouse();
    for (let i = 0; i < this.stepHooks.length; i++) {
      try {
        this.stepHooks[i](dt);
      } catch (err) {
        if (!this._hookWarned) {
          this._hookWarned = true;
          console.warn('[input] step hook failed', err);
        }
      }
    }
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
    const aim = applyDeadzone(pad.axes?.[2] ?? 0, pad.axes?.[3] ?? 0, 0.3);
    this.padAim.x = aim.x;
    this.padAim.y = aim.y;
    if (aim.x || aim.y) this.lastDevice = 'gamepad';
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

  // ---------- tapping someone to talk to them (DESIGN §23) ----------

  // A click or tap on Lyra or a villager in the world turns the chat to them. Capture
  // phase, so a click that lands on someone is theirs and never also swings the sword.
  _attachPick() {
    if (this._pickBound) return;
    this._pickBound = true;
    window.addEventListener('pointerdown', (e) => this._pickDown(e), true);
    window.addEventListener('pointerup', (e) => this._pickUp(e), true);
  }

  // The game canvas, when the pointer is on it (or on the touch stick's zone over it).
  _pickSurface(e) {
    const c = this.game?.canvas || this.game?.renderer?.canvas || null;
    const t = e?.target;
    if (!c || !t) return null;
    return t === c || t.classList?.contains?.('stick-zone') ? c : null;
  }

  _pickAt(e) {
    const c = this._pickSurface(e);
    const r = this.game?.renderer;
    const chat = this.game?.ui?.chat;
    if (!c || !r?.cssToWorld || typeof chat?.pickInWorld !== 'function') return false;
    const b = c.getBoundingClientRect();
    const w = r.cssToWorld(e.clientX - b.left, e.clientY - b.top);
    try {
      return !!chat.pickInWorld(w.x, w.y, { pointerType: e.pointerType || 'mouse' });
    } catch {
      return false;
    }
  }

  _pickDown(e) {
    if (this.game?.state !== 'playing') return;
    if (!e.pointerType || e.pointerType === 'mouse') {
      if (e.button === 0 && this._pickAt(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    // A finger: decided on release, so a drag still moves the stick.
    this._tap = this._pickSurface(e) ? { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now() } : null;
  }

  _pickUp(e) {
    const t = this._tap;
    if (!t || t.id !== e.pointerId) return;
    this._tap = null;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 12 || performance.now() - t.at > 450) return;
    this._pickAt(e);
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
