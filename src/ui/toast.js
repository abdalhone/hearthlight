// Toasts: short notices that stack under the quest line and fade on their own.
// Repeated pickups merge into one growing toast ("+5 Wood") instead of a flood.

import { h, icon, setText } from './dom.js';

const ICON_FOR = { info: 'scroll', good: 'star', warn: 'heart', quest: 'scroll', lyra: 'mind', item: 'bag' };
const LIFE = { info: 3.6, good: 3.6, warn: 5, quest: 6, lyra: 4.5, item: 2.6 };
const MAX_VISIBLE = 4;

export class Toasts {
  constructor(ui) {
    this.ui = ui;
    this.el = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    this.items = [];
  }

  // kind: info | good | warn | quest | lyra | item. key merges updates into one toast.
  show(text, kind = 'info', { key = null, iconUrl = null, title = null } = {}) {
    const msg = String(text ?? '').trim();
    if (!msg) return null;
    if (key) {
      const same = this.items.find((t) => t.key === key && !t.leaving);
      if (same) {
        setText(same.textEl, msg);
        same.age = 0;
        same.el.classList.remove('bump');
        void same.el.offsetWidth; // restart the bump animation
        same.el.classList.add('bump');
        return same;
      }
    }
    const last = this.items[this.items.length - 1];
    if (last && !last.leaving && last.text === msg) {
      last.age = 0;
      return last;
    }
    const ic = iconUrl ? h('img', { class: 'px-icon toast-icon item-img', alt: '', src: iconUrl }) : icon(ICON_FOR[kind] || 'scroll', 'toast-icon');
    const textEl = h('span', { class: 'toast-text', text: msg });
    const body = title ? h('div', { class: 'toast-body' }, h('strong', { class: 'toast-title', text: title }), textEl) : textEl;
    const el = h('div', { class: `toast toast-${kind}` }, ic, body);
    const t = { el, textEl, text: msg, kind, key, age: 0, life: LIFE[kind] ?? 3.6, leaving: false };
    this.items.push(t);
    this.el.appendChild(el);
    while (this.items.filter((x) => !x.leaving).length > MAX_VISIBLE) {
      const old = this.items.find((x) => !x.leaving);
      this._leave(old);
    }
    return t;
  }

  _leave(t) {
    if (!t || t.leaving) return;
    t.leaving = true;
    t.el.classList.add('leaving');
    setTimeout(() => {
      t.el.remove();
      const i = this.items.indexOf(t);
      if (i >= 0) this.items.splice(i, 1);
    }, 320);
  }

  update(dt) {
    for (let i = 0; i < this.items.length; i++) {
      const t = this.items[i];
      if (t.leaving) continue;
      t.age += dt;
      if (t.age >= t.life) this._leave(t);
    }
  }
}
