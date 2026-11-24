// Touch controls (DESIGN.md §14): a floating joystick anywhere on the left half,
// action buttons on the right (at least 56 px), multi-touch through pointer ids.
// Shown only on touch devices; page scroll, zoom and long-press menus are blocked.

import { h, icon, setStyle, toggleClass, setText } from './dom.js';
import { joystickVector } from '../core/input.js';

const RADIUS = 52; // px the knob can travel

export class TouchControls {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.el = null;
    this.stickId = null;
    this.base = { x: 0, y: 0 };
    this.buttons = {};
  }

  build() {
    this.knob = h('div', { class: 'stick-knob' });
    this.stick = h('div', { class: 'stick' }, this.knob);
    this.zone = h('div', { class: 'stick-zone', 'aria-hidden': 'true' }, this.stick);
    this.zone.addEventListener('pointerdown', (e) => this.onDown(e));
    this.zone.addEventListener('pointermove', (e) => this.onMove(e));
    this.zone.addEventListener('pointerup', (e) => this.onUp(e));
    this.zone.addEventListener('pointercancel', (e) => this.onUp(e));
    this.zone.addEventListener('lostpointercapture', (e) => this.onUp(e));

    const pad = h('div', { class: 'tpad' });
    const defs = [
      ['attack', 'sword', 'Attack', true],
      ['dodge', 'dodge', 'Dodge', true],
      ['interact', 'hand', 'Interact', true],
      ['talk', 'talk', 'Talk', false],
    ];
    for (const [action, ic, label, hold] of defs) {
      // "Interact" does not fit under a phone's thumb button: idle, it reads "Use".
      const b = h('button', { type: 'button', class: `tbtn tbtn-${action}`, 'aria-label': label }, icon(ic), h('span', { class: 'tbtn-label', text: action === 'interact' ? 'Use' : label }));
      if (hold) {
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          try {
            b.setPointerCapture(e.pointerId);
          } catch {
            /* old browsers */
          }
          this.game.input?.setVirtual(action, true);
          toggleClass(b, 'down', true);
          this.buzz();
        });
        const up = () => {
          this.game.input?.setVirtual(action, false);
          toggleClass(b, 'down', false);
        };
        b.addEventListener('pointerup', up);
        b.addEventListener('pointercancel', up);
        b.addEventListener('lostpointercapture', up);
      } else {
        // Talk opens the chat inside the tap itself, so the keyboard may open.
        b.addEventListener('click', () => {
          this.buzz();
          this.ui.chat.open(true, true);
        });
      }
      this.buttons[action] = b;
      pad.append(b);
    }
    this.el = h('div', { class: 'touch' }, this.zone, pad);
    return this.el;
  }

  buzz() {
    try {
      if (this.game.settings?.reduceMotion) return;
      navigator.vibrate?.(8);
    } catch {
      /* vibration is optional */
    }
  }

  onDown(e) {
    if (this.stickId !== null || e.pointerType === 'mouse') return;
    e.preventDefault();
    this.stickId = e.pointerId;
    try {
      this.zone.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const r = this.zone.getBoundingClientRect();
    // Keep the whole stick on screen even when touched near an edge.
    const x = Math.max(r.left + RADIUS + 8, Math.min(r.right - RADIUS - 8, e.clientX));
    const y = Math.max(r.top + RADIUS + 8, Math.min(r.bottom - RADIUS - 8, e.clientY));
    this.base.x = x;
    this.base.y = y;
    setStyle(this.stick, 'left', `${x - r.left}px`);
    setStyle(this.stick, 'top', `${y - r.top}px`);
    toggleClass(this.stick, 'active', true);
    this.onMove(e);
  }

  onMove(e) {
    if (e.pointerId !== this.stickId) return;
    e.preventDefault();
    let dx = e.clientX - this.base.x;
    let dy = e.clientY - this.base.y;
    const d = Math.hypot(dx, dy);
    if (d > RADIUS) {
      dx = (dx / d) * RADIUS;
      dy = (dy / d) * RADIUS;
    }
    setStyle(this.knob, 'transform', `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`);
    const v = joystickVector(e.clientX - this.base.x, e.clientY - this.base.y, RADIUS);
    this.game.input?.setTouchVector(v.x, v.y);
  }

  onUp(e) {
    if (e.pointerId !== this.stickId) return;
    this.stickId = null;
    this.game.input?.setTouchVector(0, 0);
    setStyle(this.knob, 'transform', 'translate(0px, 0px)');
    toggleClass(this.stick, 'active', false);
    setStyle(this.stick, 'left', '');
    setStyle(this.stick, 'top', '');
  }

  // Release everything (a panel opened mid-drag, the tab lost focus...).
  reset() {
    if (this.stickId !== null) this.onUp({ pointerId: this.stickId });
    for (const [action, b] of Object.entries(this.buttons)) {
      this.game.input?.setVirtual(action, false);
      toggleClass(b, 'down', false);
    }
  }

  setInteractLabel(label) {
    const b = this.buttons.interact;
    if (!b) return;
    toggleClass(b, 'ready', !!label);
    setText(b.lastChild, label ? label.split(' ')[0] : 'Use');
    b.setAttribute('aria-label', label || 'Interact');
  }
}
