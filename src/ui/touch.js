// Touch controls (DESIGN.md §14, §22.4). The phone held sideways is the battle layout:
// a floating move stick under the left thumb (it appears where the thumb lands, slides
// after it, fades when let go) and, under the right thumb, the sword, the dodge and the
// weave buttons in an arc around them, plus a contextual button for talking, doors and
// chests. Drag from a weave button to aim (the world shows the preview), let go to
// cast, drag back onto the button to cancel; a quick tap casts at the nearest foe.
// Upright phones get the same pieces, smaller. Every finger is its own pointer with its
// own capture, so moving and aiming at once just works; scroll, zoom, long-press
// callouts and ghost clicks are blocked on every control.

import { h, icon, setStyle, toggleClass, setText, setAttr } from './dom.js';
import { joystickVector, followBase } from '../core/input.js';
import { shapeIconUrl } from './weave_icons.js';
import { TOUCH_AIM_START } from './weaving.js';

const RADIUS = 52; // px the knob can travel
const FADE_MS = 380;

// Button sizes and ring radii (CSS px) for the battle layout and for an upright phone.
// Angles: screen degrees around the sword's centre (0 = right, 90 = down, 180 = left).
const GEOMETRY = {
  landscape: { sword: 78, btn: 56, dodge: 54, use: 52, r1: 96, r2: 162, edge: 14, dragMax: 96 },
  portrait: { sword: 70, btn: 52, dodge: 50, use: 48, r1: 86, r2: 146, edge: 12, dragMax: 84 },
};
const INNER = { dodge: 168, slots: [206, 244, 282] };
const OUTER_SPANS = { 1: [222], 2: [207, 237], 3: [196, 222, 248] };
const USE_ANGLE = 276;
const DODGE_OUT = 1.04; // the dodge sits a touch further out, clear of the first weave

// Pure: where every piece of the cluster sits, as offsets (CSS px) from the sword's
// centre. `count` weave slots (0–6); `mirror` flips it for a left-handed layout.
export function clusterLayout(count, geo, mirror = false) {
  const at = (deg, r) => {
    const a = (deg * Math.PI) / 180;
    const x = Math.cos(a) * r;
    return { x: mirror ? -x : x, y: Math.sin(a) * r };
  };
  const slots = [];
  const inner = Math.min(3, count);
  for (let i = 0; i < inner; i++) slots.push(at(INNER.slots[i], geo.r1));
  const outer = Math.max(0, Math.min(3, count - 3));
  if (outer) for (const deg of OUTER_SPANS[outer]) slots.push(at(deg, geo.r2));
  return { dodge: at(INNER.dodge, geo.r1 * DODGE_OUT), use: at(USE_ANGLE, geo.r2), slots };
}

function captureOn(el, e) {
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    /* old browsers */
  }
}

// No click may follow a touch on a control (it would land on whatever opens under the
// finger), and no long-press menu or double-tap zoom either.
function noGhosts(el) {
  el.addEventListener('touchstart', (e) => e.cancelable && e.preventDefault(), { passive: false });
  el.addEventListener('touchend', (e) => e.cancelable && e.preventDefault(), { passive: false });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

export class TouchControls {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.el = null;
    this.stickId = null;
    this.base = { x: 0, y: 0 };
    this.buttons = {};
    this.slots = [];
    this.slotCount = -1;
    this.mode = '';
    this.version = -1;
    this.tick = 0;
    this.fadeTimer = 0;
  }

  get weaving() {
    return this.ui.hud?.weaving || null;
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
    noGhosts(this.zone);

    // The right-thumb cluster, laid out around the sword's centre (an anchor point).
    this.anchor = h('div', { class: 'tcluster' });
    this.buttons.attack = this.actionButton('attack', 'sword', 'Sword', 'tbtn-attack');
    this.buttons.dodge = this.actionButton('dodge', 'dodge', 'Dodge', 'tbtn-dodge');
    this.useLabel = h('span', { class: 'tbtn-tag' });
    this.buttons.interact = this.actionButton('interact', 'hand', 'Use', 'tbtn-interact');
    this.buttons.interact.append(this.useLabel);
    this.buttons.interact.hidden = true;
    this.slotWrap = h('div', { class: 'wslots' });
    this.anchor.append(this.slotWrap, this.buttons.dodge, this.buttons.interact, this.buttons.attack);
    this.swordDrag(this.buttons.attack);

    this.el = h('div', { class: 'touch' }, this.zone, this.anchor);
    this.watchLayout();
    return this.el;
  }

  // Sword, dodge and the contextual button: held while the finger is down.
  actionButton(action, ic, label, cls) {
    const b = h('button', { type: 'button', class: `tbtn ${cls}`, 'aria-label': label }, icon(ic), h('span', { class: 'tbtn-label', text: label }));
    b.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      captureOn(b, e);
      b._pid = e.pointerId;
      this.game.input?.setVirtual(action, true);
      toggleClass(b, 'down', true);
      this.buzz();
    });
    const up = (e) => {
      if (b._pid !== undefined && e && e.pointerId !== b._pid) return;
      b._pid = undefined;
      this.game.input?.setVirtual(action, false);
      toggleClass(b, 'down', false);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    noGhosts(b);
    return b;
  }

  // Dragging the sword aims the swing (the world shows the arc); a tap still finds a foe.
  swordDrag(b) {
    b.addEventListener('pointermove', (e) => {
      if (e.pointerId !== b._pid) return;
      const r = b.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const w = this.weaving;
      if (Math.hypot(dx, dy) >= TOUCH_AIM_START) {
        if (w) w.sword = { dx, dy };
        this.game.input?.setSwingAim(dx, dy);
        toggleClass(b, 'aiming', true);
      }
    });
    const end = () => {
      const w = this.weaving;
      if (w) w.sword = null;
      toggleClass(b, 'aiming', false);
    };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('lostpointercapture', end);
  }

  // ---------- weave buttons ----------

  makeSlot(i) {
    const img = h('img', { class: 'wbtn-icon', alt: '', draggable: 'false', 'aria-hidden': 'true' });
    const cd = h('span', { class: 'wbtn-cd', 'aria-hidden': 'true' });
    const knob = h('span', { class: 'wbtn-knob', 'aria-hidden': 'true' });
    const ring = h('span', { class: 'wbtn-ring', 'aria-hidden': 'true' });
    const plus = h('span', { class: 'wbtn-plus', 'aria-hidden': 'true', text: '+' });
    const b = h('button', { type: 'button', class: 'wbtn tbtn', 'aria-label': `Weave ${i + 1}` }, ring, img, cd, plus, knob);
    const slot = { i, b, img, cd, knob, ring, plus, pid: null, x: 0, y: 0, key: '' };
    b.addEventListener('pointerdown', (e) => this.slotDown(slot, e));
    b.addEventListener('pointermove', (e) => this.slotMove(slot, e));
    b.addEventListener('pointerup', (e) => this.slotUp(slot, e, false));
    b.addEventListener('pointercancel', (e) => this.slotUp(slot, e, true));
    b.addEventListener('lostpointercapture', (e) => this.slotUp(slot, e, false));
    noGhosts(b);
    return slot;
  }

  slotDown(slot, e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const w = this.weaving;
    if (!w) return;
    // An empty slot opens the Spellbook on that slot.
    if (!w.weaveAt(slot.i)) {
      this.ui.hud?.openSpellbook?.(slot.i);
      return;
    }
    if (slot.pid !== null) return;
    captureOn(slot.b, e);
    slot.pid = e.pointerId;
    const r = slot.b.getBoundingClientRect();
    slot.cx = r.left + r.width / 2;
    slot.cy = r.top + r.height / 2;
    w.touchStart(slot.i, e.pointerId);
    toggleClass(slot.b, 'down', true);
    this.buzz();
  }

  slotMove(slot, e) {
    if (e.pointerId !== slot.pid) return;
    e.preventDefault();
    const dx = e.clientX - slot.cx;
    const dy = e.clientY - slot.cy;
    this.weaving?.touchMove(e.pointerId, dx, dy);
    const t = this.weaving?.touchState(e.pointerId);
    const d = Math.hypot(dx, dy);
    const max = this.geo?.dragMax || 90;
    const k = d > max ? max / d : 1;
    setStyle(slot.knob, 'transform', `translate(${(dx * k).toFixed(1)}px, ${(dy * k).toFixed(1)}px)`);
    toggleClass(slot.b, 'aiming', !!t?.aimed && !t?.cancel);
    toggleClass(slot.b, 'cancel', !!t?.cancel);
  }

  slotUp(slot, e, cancelled) {
    if (slot.pid === null || e.pointerId !== slot.pid) return;
    slot.pid = null;
    this.weaving?.touchEnd(e.pointerId, cancelled);
    toggleClass(slot.b, 'down', false);
    toggleClass(slot.b, 'aiming', false);
    toggleClass(slot.b, 'cancel', false);
    setStyle(slot.knob, 'transform', 'translate(0px, 0px)');
  }

  // ---------- layout ----------

  watchLayout() {
    if (typeof window === 'undefined') return;
    const relayout = () => this.layout(true);
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', relayout);
    this.game.bus?.on?.('settings_changed', ({ key } = {}) => {
      if (key === 'leftHanded' || key === 'touchScale') this.layout(true);
    });
  }

  layout(force = false) {
    const w = this.weaving;
    const count = w?.available?.() ? w.slotCount() : 0;
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    const mode = vw > vh ? 'landscape' : 'portrait';
    const s = this.game.settings || {};
    const scale = Math.max(0.8, Math.min(1.25, Number(s.touchScale) || 1));
    const mirror = !!s.leftHanded;
    const key = `${mode}|${count}|${scale}|${mirror}`;
    if (!force && key === this.layoutKey) return;
    this.layoutKey = key;
    const base = GEOMETRY[mode];
    // A short landscape phone (iPhone SE: 375 px tall) shrinks the outer ring a little.
    const squeeze = mode === 'landscape' && vh < 380 ? 0.94 : 1;
    const geo = {};
    for (const k of Object.keys(base)) geo[k] = Math.round(base[k] * (k === 'edge' ? 1 : scale * squeeze));
    this.geo = geo;
    if (w) w.dragMax = geo.dragMax;
    this.mode = mode;
    toggleClass(this.el, 'lefty', mirror);
    this.el.dataset.mode = mode;
    // Grow or shrink the row of weave buttons.
    while (this.slots.length < count) {
      const slot = this.makeSlot(this.slots.length);
      this.slots.push(slot);
      this.slotWrap.append(slot.b);
    }
    for (let i = 0; i < this.slots.length; i++) this.slots[i].b.hidden = i >= count;
    this.slotCount = count;
    const L = clusterLayout(count, geo, mirror);
    const half = geo.sword / 2;
    setStyle(this.anchor, '--ax', `${half + geo.edge}px`);
    setStyle(this.anchor, '--ay', `${half + geo.edge}px`);
    this.place(this.buttons.attack, 0, 0, geo.sword);
    this.place(this.buttons.dodge, L.dodge.x, L.dodge.y, geo.dodge);
    this.place(this.buttons.interact, L.use.x, L.use.y, geo.use);
    for (let i = 0; i < count; i++) this.place(this.slots[i].b, L.slots[i].x, L.slots[i].y, geo.btn);
    setStyle(this.el, '--drag', `${geo.dragMax}px`);
    this.version = -1;
  }

  place(el, x, y, size) {
    setStyle(el, 'width', `${size}px`);
    setStyle(el, 'height', `${size}px`);
    setStyle(el, 'left', `${Math.round(x - size / 2)}px`);
    setStyle(el, 'top', `${Math.round(y - size / 2)}px`);
  }

  // ---------- per step (from the HUD) ----------

  update(dt) {
    if (!this.el || !this.ui.isTouch) return;
    this.tick += dt;
    if (this.tick < 1 / 20) return;
    this.tick = 0;
    const w = this.weaving;
    const count = w?.available?.() ? w.slotCount() : 0;
    if (count !== this.slotCount || !this.layoutKey) this.layout();
    if (!w || !count) return;
    const ver = w.version;
    const t = this.game.time || 0;
    for (let i = 0; i < count; i++) {
      const slot = this.slots[i];
      const rec = w.slotInfo(i);
      if (ver !== this.version || slot.key !== rec.key) {
        slot.key = rec.key;
        paintSlot(slot, rec, i);
      }
      const cd = rec.plan ? w.cooldownFrac(i) : 0;
      setStyle(slot.cd, '--cd', cd.toFixed(3));
      toggleClass(slot.b, 'cooling', cd > 0.001);
      toggleClass(slot.b, 'starved', w.starved(i));
      const f = w.lastFail(i);
      toggleClass(slot.b, 'shake', !!f && t - f.t < 0.35);
    }
    this.version = ver;
  }

  buzz() {
    try {
      if (this.game.settings?.reduceMotion) return;
      navigator.vibrate?.(8);
    } catch {
      /* vibration is optional */
    }
  }

  // ---------- the move stick ----------

  onDown(e) {
    if (this.stickId !== null || e.pointerType === 'mouse') return;
    e.preventDefault();
    this.stickId = e.pointerId;
    captureOn(this.zone, e);
    const r = this.zone.getBoundingClientRect();
    // Keep the whole stick on screen even when touched near an edge.
    const x = Math.max(r.left + RADIUS + 8, Math.min(r.right - RADIUS - 8, e.clientX));
    const y = Math.max(r.top + RADIUS + 8, Math.min(r.bottom - RADIUS - 8, e.clientY));
    this.base.x = x;
    this.base.y = y;
    this.zoneRect = r;
    clearTimeout(this.fadeTimer);
    this.placeStick(x, y);
    toggleClass(this.stick, 'fading', false);
    toggleClass(this.stick, 'active', true);
    this.onMove(e);
  }

  placeStick(x, y) {
    const r = this.zoneRect || this.zone.getBoundingClientRect();
    setStyle(this.stick, 'left', `${(x - r.left).toFixed(1)}px`);
    setStyle(this.stick, 'top', `${(y - r.top).toFixed(1)}px`);
  }

  onMove(e) {
    if (e.pointerId !== this.stickId) return;
    e.preventDefault();
    // Past the rim, the base slides after the thumb (a floating stick).
    const nb = followBase(this.base.x, this.base.y, e.clientX, e.clientY, RADIUS);
    if (nb.x !== this.base.x || nb.y !== this.base.y) {
      this.base.x = nb.x;
      this.base.y = nb.y;
      this.placeStick(nb.x, nb.y);
    }
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
    toggleClass(this.stick, 'fading', true);
    // Fade where it was let go, then drift home as the resting hint.
    clearTimeout(this.fadeTimer);
    this.fadeTimer = setTimeout(() => {
      if (this.stickId !== null) return;
      toggleClass(this.stick, 'fading', false);
      setStyle(this.stick, 'left', '');
      setStyle(this.stick, 'top', '');
    }, FADE_MS);
  }

  // Release everything (a panel opened mid-drag, the tab lost focus...).
  reset() {
    if (this.stickId !== null) this.onUp({ pointerId: this.stickId });
    for (const [action, b] of Object.entries(this.buttons)) {
      this.game.input?.setVirtual(action, false);
      toggleClass(b, 'down', false);
      b._pid = undefined;
    }
    for (const slot of this.slots) if (slot.pid !== null) this.slotUp(slot, { pointerId: slot.pid }, true);
    const w = this.weaving;
    if (w) w.sword = null;
  }

  // The contextual button: shown only when there is something to talk to or use.
  setInteractLabel(label) {
    const b = this.buttons.interact;
    if (!b) return;
    const t = String(label || '').trim();
    toggleClass(b, 'ready', !!t);
    b.hidden = !t;
    const verb = t ? t.split(' ')[0] : 'Use';
    setText(b.querySelector('.tbtn-label'), verb.length > 7 ? 'Use' : verb);
    setText(this.useLabel, t);
    setAttr(b, 'aria-label', t || 'Interact');
    const ic = /^(talk|ask|greet|chat)/i.test(t) ? 'talk' : 'hand';
    const img = b.querySelector('.px-icon');
    if (img && img._icon !== ic) {
      img.replaceWith(icon(ic));
    }
  }
}

// Paint one weave button (or hotbar slot) from the controller's slot record.
export function paintSlot(slot, rec, i) {
  const b = slot.b;
  const empty = !rec.weave;
  toggleClass(b, 'empty', empty);
  toggleClass(b, 'broken', !empty && !rec.plan);
  if (slot.plus) slot.plus.hidden = !empty;
  slot.img.hidden = empty;
  if (!empty) {
    slot.img.src = shapeIconUrl(rec.weave.shape, rec.palette);
    const p = rec.palette;
    setStyle(b, '--wc', p.glow);
    setStyle(b, '--wd', p.deep);
    setStyle(b, '--wk', p.core);
  } else {
    setStyle(b, '--wc', '');
    setStyle(b, '--wd', '');
    setStyle(b, '--wk', '');
  }
  const label = empty ? `Weave ${i + 1}: empty — open the Spellbook` : `${rec.name}${rec.cost ? ` · ${Math.round(rec.cost)} mana` : ''}`;
  setAttr(b, 'aria-label', label);
  setAttr(b, 'title', label);
  if (slot.name) setText(slot.name, empty ? '' : rec.name);
  if (slot.cost) setText(slot.cost, empty || !rec.cost ? '' : String(Math.round(rec.cost)));
}
