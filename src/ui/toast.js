// Toasts: short notices that stack under the quest line and fade on their own.
// Repeated pickups merge into one growing toast ("+5 Wood") instead of a flood.
// In play the stack keeps clear of speech bubbles, the player, Lyra and the HUD: it
// takes the first free slot under the quest line (or low on the screen), stays put
// while that slot stays free, and waits out of sight (not aging) when nothing is free.

import { h, icon, setText } from './dom.js';
import { placeStack } from './village_view.js';

const ICON_FOR = { info: 'scroll', good: 'star', warn: 'heart', quest: 'scroll', lyra: 'mind', item: 'bag' };
const LIFE = { info: 3.6, good: 3.6, warn: 5, quest: 6, lyra: 4.5, item: 2.6 };
const MAX_VISIBLE = 4;
const MAX_VISIBLE_SMALL = 3; // phones: fewer at once, so they fit between the HUD and the bubbles
const PLACE_EVERY = 0.1;

// HUD pieces the stack must never cover (the chat is handled on its own).
const HUD_SELECTOR = '.hud .card, .hud-btn, .lyra-fold, .quest-line, .listen-prompt, .interact-prompt, .cmdbar, .orders-btn, .tbtn, .jobs-menu, .fps';

export class Toasts {
  constructor(ui) {
    this.ui = ui;
    this.el = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    this.items = [];
    this.placeT = 0;
    this.placed = false; // inline position in use (else the stylesheet places the stack)
    this.lastY = null;
    this.lastX = null;
    this.waiting = false; // no free slot: hidden, and not aging
    this.panelMode = null; // phones with a panel open: 'one-up' | 'on-head' (see setPanelMode)
    this._bubbles = [];
  }

  maxVisible() {
    const root = this.ui.root;
    const w = root?.clientWidth || 1280;
    const hgt = root?.clientHeight || 720;
    return w < 640 || hgt < 520 ? MAX_VISIBLE_SMALL : MAX_VISIBLE;
  }

  // kind: info | good | warn | quest | lyra | item. key merges updates into one toast.
  show(text, kind = 'info', { key = null, iconUrl = null, title = null } = {}) {
    const msg = String(text ?? '').trim();
    if (!msg) return null;
    if (key) {
      const same = this.items.find((t) => t.key === key && !t.leaving);
      if (same) {
        // A keyed toast is one running notice: its words, title and tone all follow the latest.
        setText(same.textEl, msg);
        if (same.titleEl) setText(same.titleEl, title || '');
        if (kind !== same.kind) {
          same.el.classList.remove(`toast-${same.kind}`);
          same.el.classList.add(`toast-${kind}`);
          same.kind = kind;
          same.life = LIFE[kind] ?? 3.6;
        }
        same.text = msg;
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
    // Keyed toasts always carry a title slot, so a later update can add or change it.
    const titleEl = title || key ? h('strong', { class: 'toast-title', text: title || '' }) : null;
    const body = titleEl ? h('div', { class: 'toast-body' }, titleEl, textEl) : textEl;
    const el = h('div', { class: `toast toast-${kind}` }, ic, body);
    const t = { el, textEl, titleEl, text: msg, kind, key, age: 0, life: LIFE[kind] ?? 3.6, leaving: false };
    this.items.push(t);
    this.el.appendChild(el);
    this.placeT = 0; // place the grown stack on the next step
    const max = this.maxVisible();
    while (this.items.filter((x) => !x.leaving).length > max) {
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
    this.placeT -= dt;
    if (this.placeT <= 0) {
      this.placeT = PLACE_EVERY;
      this.place();
    }
    if (this.waiting) return;
    for (let i = 0; i < this.items.length; i++) {
      const t = this.items[i];
      // A notice waiting its turn (no room for it yet) does not age.
      if (t.leaving || t.deferred) continue;
      t.age += dt;
      if (t.age >= t.life) this._leave(t);
    }
  }

  // ---------- keeping clear ----------

  setDeferred(t, on) {
    if (t.deferred === on) return;
    t.deferred = on;
    t.el.classList.toggle('deferred', on);
  }

  unplace() {
    for (const t of this.items) this.setDeferred(t, false);
    this.setPanelMode(null);
    if (!this.placed && !this.waiting) return;
    this.placed = false;
    this.waiting = false;
    this.lastY = null;
    this.lastX = null;
    const st = this.el.style;
    st.top = st.left = st.bottom = st.transform = st.visibility = '';
    this.el.classList.remove('placed');
  }

  // Phones with a panel open. 'one-up': only the newest notice shows, in the
  // stylesheet's place above a short panel. 'on-head': no room above the panel (her
  // mind, the inventory, any panel held sideways), so the newest notice becomes an
  // opaque banner laid over the panel's title row, from its left edge to the close
  // button. `box` is { x, y, w, h } relative to the UI root. null: the stylesheet's way.
  setPanelMode(mode, box = null) {
    const st = this.el.style;
    if (!mode) {
      if (!this.panelMode) return;
      this.panelMode = null;
      this.el.classList.remove('on-head', 'one-up');
      st.removeProperty('top');
      st.left = st.width = st.transform = '';
      st.removeProperty('--head-h');
      return;
    }
    this.panelMode = mode;
    this.el.classList.toggle('on-head', mode === 'on-head');
    this.el.classList.toggle('one-up', mode === 'one-up');
    // The newest notice still showing is the one on screen; the others age unseen.
    const live = this.items.filter((t) => !t.leaving);
    for (const t of this.items) t.el.classList.toggle('head-pick', t === live[live.length - 1]);
    if (!box) return;
    st.setProperty('top', `${Math.round(box.y)}px`, 'important'); // over .modal-open's !important
    st.left = `${Math.round(box.x)}px`;
    st.width = `${Math.round(box.w)}px`;
    st.transform = 'none';
    st.setProperty('--head-h', `${Math.round(box.h)}px`);
  }

  // Notices while a panel is open. Desktop and roomy screens keep the stylesheet's
  // place along the top edge; on a phone the stack shows whole above the panel when it
  // fits, else only the newest notice does, else it becomes the title-row banner.
  placeOverPanel() {
    const ui = this.ui;
    const root = ui.root;
    const top = ui.top?.();
    const small = this.maxVisible() === MAX_VISIBLE_SMALL;
    if (!small || !top?.el || !top.head || !root) {
      this.unplace();
      return;
    }
    const rb = root.getBoundingClientRect();
    const room = top.el.getBoundingClientRect().top - rb.top - 14;
    // Measured in the stylesheet's layout, all in one step (nothing paints between).
    this.unplace();
    if (room >= this.el.offsetHeight) return;
    const live = this.items.filter((t) => !t.leaving);
    const newest = live[live.length - 1];
    if (newest && room >= newest.el.offsetHeight + 8) {
      this.setPanelMode('one-up');
      return;
    }
    const hr = top.head.getBoundingClientRect();
    const cr = top.closeBtn?.getBoundingClientRect?.();
    const x = hr.left - rb.left + 4;
    const right = cr && cr.width ? cr.left - rb.left - 6 : hr.right - rb.left - 4;
    this.setPanelMode('on-head', { x, y: hr.top - rb.top + 4, w: Math.max(120, right - x), h: Math.max(32, hr.height - 8) });
  }

  // Everything the stack must keep clear of, in CSS px relative to the UI root.
  obstacles(root, rootBox) {
    const g = this.ui.game;
    const rel = (r) => ({ x: r.left - rootBox.left, y: r.top - rootBox.top, w: r.width, h: r.height });
    const out = [];
    for (const el of root.querySelectorAll(HUD_SELECTOR)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push(rel(r));
    }
    // The speakers' bubbles, and the player and Lyra themselves.
    try {
      for (const b of g.bubbles?.screenRects?.(this._bubbles) || []) out.push(b);
    } catch {
      /* bubbles are optional */
    }
    for (const a of [g.player, g.companion]) {
      if (!a || a.removed || !g.renderer?.worldToCss) continue;
      try {
        const p0 = g.renderer.worldToCss(a.x - 9, a.y - 28);
        const p1 = g.renderer.worldToCss(a.x + 9, a.y + 3);
        out.push({ x: p0.x, y: p0.y, w: p1.x - p0.x, h: p1.y - p0.y });
      } catch {
        /* no renderer yet */
      }
    }
    return out;
  }

  // Put the stack where it covers nothing that matters. Only in play with no panel open:
  // panels sit over the world (and its bubbles), and the stylesheet places notices there.
  // When the whole stack fits nowhere, the oldest notices show first and the rest wait
  // their turn; when not even one fits, they all wait out of sight.
  place() {
    const ui = this.ui;
    const g = ui.game;
    const root = ui.root;
    const live = this.items.filter((t) => !t.leaving);
    if (live.length && ui.stack?.length) {
      this.placeOverPanel();
      return;
    }
    if (!root || !live.length || g?.state !== 'playing' || ui.stack?.length) {
      this.unplace();
      return;
    }
    const W = root.clientWidth;
    const H = root.clientHeight;
    if (!W || !H) return;
    const rootBox = root.getBoundingClientRect();
    const obstacles = this.obstacles(root, rootBox);
    // The open chat takes its side of the screen: the stack centers in what is left.
    let left = 0;
    let right = W;
    let bottom = H - 8;
    const chat = ui.chat?.isOpen?.() ? ui.chat.el : null;
    if (chat) {
      const r = chat.getBoundingClientRect();
      const c = { x: r.left - rootBox.left, y: r.top - rootBox.top, w: r.width, h: r.height };
      if (c.x > W * 0.3) right = c.x;
      else if (c.y > H * 0.25) bottom = Math.min(bottom, c.y - 6);
      else left = c.x + c.w;
    }
    this.placed = true;
    this.el.classList.add('placed');
    const st = this.el.style;
    let spot = null;
    for (let k = live.length; k >= 1 && !spot; k--) {
      for (let i = 0; i < live.length; i++) this.setDeferred(live[i], i >= k);
      const w = this.el.offsetWidth;
      const hgt = this.el.offsetHeight;
      if (!w || !hgt) return;
      // Centered first, then along the left or right edge.
      const xs = [Math.round(left + Math.max(6, (right - left - w) / 2)), Math.round(left + 8), Math.round(right - w - 8)].filter((x, i, a) => a.indexOf(x) === i && x >= left && x + w <= right + 1);
      if (this.lastX !== null && xs.includes(this.lastX)) xs.sort((a, b) => (a === this.lastX ? -1 : b === this.lastX ? 1 : 0));
      for (const x of xs) {
        spot = placeStack({ w, h: hgt, viewW: W, top: 8, bottom, obstacles, prefer: x === this.lastX ? this.lastY : null, x, step: 6, pad: 6 });
        if (spot) break;
      }
    }
    if (!spot) {
      // Nowhere free right now (a crowd of bubbles): wait out of sight, not aging.
      for (const t of live) this.setDeferred(t, false);
      this.waiting = true;
      st.visibility = 'hidden';
      return;
    }
    this.waiting = false;
    this.lastY = spot.y;
    this.lastX = spot.x;
    st.visibility = '';
    st.top = `${Math.round(spot.y)}px`;
    st.left = `${Math.round(spot.x)}px`;
    st.bottom = 'auto';
    st.transform = 'none';
  }
}
