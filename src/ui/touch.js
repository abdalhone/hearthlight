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

// Lock-on on a phone (round 14b): hold the sword still this long to lock; swipe this far
// across it to cycle.
const LOCK_PRESS_MS = 450;
const LOCK_SWIPE = 34;
const RADIUS = 52; // px the knob can travel
const FADE_MS = 380;

// Button sizes and ring radii (CSS px) for the battle layout and for an upright phone.
// Angles: screen degrees around the sword's centre (0 = right, 90 = down, 180 = left).
const GEOMETRY = {
  landscape: { sword: 78, btn: 56, dodge: 54, use: 52, r1: 96, r2: 162, edge: 14, dragMax: 96 },
  portrait: { sword: 70, btn: 52, dodge: 50, use: 48, r1: 86, r2: 146, edge: 12, dragMax: 84 },
};
// The inner ring holds up to three weaves, spread evenly between these angles (wide
// enough apart that no two buttons' tap areas touch); more go on the outer ring.
const INNER = { dodge: 168, slots: { 1: [240], 2: [216, 266], 3: [204, 242, 280] } };
const OUTER_SPANS = { 1: [222], 2: [207, 237], 3: [196, 222, 248] };
const USE_ANGLE = 276;
const DODGE_OUT = 1.05; // the dodge sits a touch further out, clear of the first weave

// Pure: where every piece of the cluster sits, as offsets (CSS px) from the sword's
// centre. `count` weave buttons shown (0–6); `mirror` flips it for a left-handed layout.
export function clusterLayout(count, geo, mirror = false) {
  const at = (deg, r) => {
    const a = (deg * Math.PI) / 180;
    const x = Math.cos(a) * r;
    return { x: mirror ? -x : x, y: Math.sin(a) * r };
  };
  const slots = [];
  const inner = Math.min(3, count);
  if (inner) for (const deg of INNER.slots[inner]) slots.push(at(deg, geo.r1));
  const outer = Math.max(0, Math.min(3, count - 3));
  if (outer) for (const deg of OUTER_SPANS[outer]) slots.push(at(deg, geo.r2));
  return { dodge: at(INNER.dodge, geo.r1 * DODGE_OUT), use: at(USE_ANGLE, geo.r2), slots };
}

// Pure: which weave slots get a button. Every slot that holds a weave, in order, then
// one "new weave" button for the first empty slot (none when all are full). A slot
// with nothing in it is not a button of its own: one + is enough of an invitation.
export function shownSlots(count, has) {
  const out = [];
  let empty = -1;
  for (let i = 0; i < count; i++) {
    if (has(i)) out.push(i);
    else if (empty < 0) empty = i;
  }
  if (empty >= 0) out.push(empty);
  return out;
}

// A weave's name, short enough to sit on its button.
export function shortName(name, max = 9) {
  const t = String(name || '').trim();
  if (t.length <= max) return t;
  const first = t.split(/\s+/)[0];
  if (first.length <= max) return first;
  return `${t.slice(0, max - 1)}…`;
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
// (The move pad lets touchstart through, so a tap on the world still closes the phone's
// keyboard when a text field has it.)
function noGhosts(el, start = true) {
  if (start) el.addEventListener('touchstart', (e) => e.cancelable && e.preventDefault(), { passive: false });
  el.addEventListener('touchend', (e) => e.cancelable && e.preventDefault(), { passive: false });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

// The person the round button names ("Talk to Elda"), if they are still there to talk to:
// alive, up, and within a few steps. A tap goes to whoever the button promised, not to
// whoever a crowd has put nearest since the label was drawn (round 14b, verifier A).
export function namedInReach(game, who, reach = 3 * 16) {
  const p = game?.player;
  if (!who || !p || who.removed || who.dead || who.downed || who.state === 'downed') return null;
  if (!Number.isFinite(who.x) || Math.hypot(who.x - p.x, who.y - p.y) > reach) return null;
  return who;
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
    noGhosts(this.zone, false);

    // The right-thumb cluster, laid out around the sword's centre (an anchor point).
    this.anchor = h('div', { class: 'tcluster' });
    this.buttons.attack = this.actionButton('attack', 'sword', 'Sword', 'tbtn-attack');
    this.buttons.dodge = this.actionButton('dodge', 'dodge', 'Dodge', 'tbtn-dodge');
    this.useLabel = h('span', { class: 'tbtn-tag' });
    this.buttons.interact = this.actionButton('interact', 'hand', 'Use', 'tbtn-interact');
    this.talkBadge = h('span', { class: 'badge tbtn-badge', hidden: true });
    this.buttons.interact.append(this.useLabel, this.talkBadge);
    this.slotWrap = h('div', { class: 'wslots' });
    this.anchor.append(this.slotWrap, this.buttons.dodge, this.buttons.interact, this.buttons.attack);
    this.swordDrag(this.buttons.attack);

    this.el = h('div', { class: 'touch' }, this.zone, this.anchor);
    this.watchLayout();
    return this.el;
  }

  // Sword, dodge and the contextual button: held while the finger is down. With nothing
  // near to use, the contextual button is Talk (it opens the chat).
  actionButton(action, ic, label, cls) {
    const b = h('button', { type: 'button', class: `tbtn ${cls}`, 'aria-label': label }, icon(ic), h('span', { class: 'tbtn-label', text: label }));
    b.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      if (action === 'interact' && b.classList.contains('idle')) {
        this.buzz();
        if (typeof this.ui.talkToNearest === 'function') this.ui.talkToNearest();
        else this.ui.chat?.open?.(true);
        return;
      }
      // "Talk to Bram" (round 14b, decision D4): the chat to Bram, not the old dialog. Help
      // and Search stay what they are for the downed and the dead.
      if (action === 'interact' && b.classList.contains('person') && typeof this.ui.talkTo === 'function') {
        const who = namedInReach(this.game, this.labelWho) || this.personInReach();
        if (who && this.ui.talkTo(who === this.game.companion ? 'lyra' : who.id)) {
          this.buzz();
          return;
        }
      }
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
  // Round 14b (lock-on, DESIGN §35.5): a long press on it, held still, locks the nearest
  // in front (or lets go); while locked, a swipe across it cycles the lock. Never a tap on
  // the world.
  swordDrag(b) {
    const lock = { t: null, moved: false, swiped: false };
    b.addEventListener('pointerdown', () => {
      lock.moved = false;
      lock.swiped = false;
      clearTimeout(lock.t);
      lock.t = setTimeout(() => {
        const g = this.game;
        if (lock.moved || !g.lock || g.murder?.hold) return;
        g.lock.press();
        this.buzz?.();
        toggleClass(b, 'locked', !!g.lock.target);
      }, LOCK_PRESS_MS);
    });
    b.addEventListener('pointermove', (e) => {
      if (e.pointerId !== b._pid) return;
      const r = b.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const w = this.weaving;
      if (Math.hypot(dx, dy) >= TOUCH_AIM_START) {
        lock.moved = true;
        clearTimeout(lock.t);
      }
      const L = this.game.lock;
      if (L?.target && Math.abs(dx) >= LOCK_SWIPE && Math.abs(dx) > Math.abs(dy) * 1.4) {
        if (!lock.swiped) {
          lock.swiped = true;
          L.cycle(dx > 0 ? 1 : -1);
          this.buzz?.();
        }
        return;
      }
      if (Math.hypot(dx, dy) >= TOUCH_AIM_START) {
        if (w) w.sword = { dx, dy };
        this.game.input?.setSwingAim(dx, dy);
        toggleClass(b, 'aiming', true);
      }
    });
    const end = () => {
      const w = this.weaving;
      if (w) w.sword = null;
      clearTimeout(lock.t);
      toggleClass(b, 'aiming', false);
      toggleClass(b, 'locked', !!this.game.lock?.target);
    };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('lostpointercapture', end);
  }

  // ---------- weave buttons ----------

  makeSlot(i) {
    const img = h('img', { class: 'wbtn-icon', alt: '', draggable: 'false', 'aria-hidden': 'true' });
    const cd = h('span', { class: 'wbtn-cd', 'aria-hidden': 'true' });
    const secs = h('span', { class: 'wbtn-secs num', 'aria-hidden': 'true' });
    const chg = h('span', { class: 'wbtn-chg', 'aria-hidden': 'true' });
    const knob = h('span', { class: 'wbtn-knob', 'aria-hidden': 'true' });
    const ring = h('span', { class: 'wbtn-ring', 'aria-hidden': 'true' });
    const plus = h('span', { class: 'wbtn-plus', 'aria-hidden': 'true', text: '+' });
    // What the button is: its name under the glyph and its mana on the corner.
    const name = h('span', { class: 'wbtn-name', 'aria-hidden': 'true' });
    const cost = h('span', { class: 'wbtn-mana num', 'aria-hidden': 'true' });
    const b = h('button', { type: 'button', class: 'wbtn tbtn', 'aria-label': `Weave ${i + 1}`, 'data-slot': String(i) }, ring, chg, img, cd, secs, plus, knob, name, cost);
    const slot = { i, b, img, cd, secs, chg, knob, ring, plus, name, cost, pid: null, x: 0, y: 0, key: '' };
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

  // Which slots get a button right now (see shownSlots).
  shown() {
    const w = this.weaving;
    const count = w?.available?.() ? w.slotCount() : 0;
    return shownSlots(count, (i) => !!w.weaveAt(i));
  }

  layout(force = false) {
    const w = this.weaving;
    const total = w?.available?.() ? w.slotCount() : 0;
    const shown = this.shown();
    const count = shown.length;
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    const mode = vw > vh ? 'landscape' : 'portrait';
    const s = this.game.settings || {};
    const scale = Math.max(0.8, Math.min(1.25, Number(s.touchScale) || 1));
    const mirror = !!s.leftHanded;
    const key = `${mode}|${shown.join(',')}|${scale}|${mirror}`;
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
    // One button per slot; only the shown ones are visible.
    while (this.slots.length < total) {
      const slot = this.makeSlot(this.slots.length);
      this.slots.push(slot);
      this.slotWrap.append(slot.b);
    }
    for (let i = 0; i < this.slots.length; i++) this.slots[i].b.hidden = !shown.includes(i);
    this.slotCount = total;
    this.shownKey = shown.join(',');
    const L = clusterLayout(count, geo, mirror);
    const half = geo.sword / 2;
    setStyle(this.anchor, '--ax', `${half + geo.edge}px`);
    setStyle(this.anchor, '--ay', `${half + geo.edge}px`);
    this.place(this.buttons.attack, 0, 0, geo.sword);
    this.place(this.buttons.dodge, L.dodge.x, L.dodge.y, geo.dodge);
    this.place(this.buttons.interact, L.use.x, L.use.y, geo.use);
    for (let k = 0; k < count; k++) this.place(this.slots[shown[k]].b, L.slots[k].x, L.slots[k].y, geo.btn);
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
    if (this.tick < 1 / 30) return;
    this.tick = 0;
    const w = this.weaving;
    const count = w?.available?.() ? w.slotCount() : 0;
    if (count !== this.slotCount || !this.layoutKey || (w && w.version !== this.version && this.shown().join(',') !== this.shownKey)) this.layout();
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
      paintSlotState(slot, rec, w, i, t);
    }
    this.version = ver;
  }

  buzz() {
    try {
      if (this.game.settings?.reduceMotion || this.game.settings?.touchBuzz === false) return;
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

  // The person the contextual button would talk to: what Interactions puts first, when it
  // is someone alive and standing (Lyra or a villager), else null.
  personInReach() {
    const g = this.game;
    let best = null;
    try {
      best = g.interactions?.best?.(g.player)?.target || null;
    } catch {
      best = null;
    }
    if (!best || best.dead || best.downed || best.removed) return null;
    if (best !== g.companion && !best.profile) return null;
    return best;
  }

  // The contextual button: what there is to talk to or use nearby ("Talk to Bram",
  // "Open door"); with nothing near it is Talk, and opens the chat.
  setInteractLabel(label) {
    const b = this.buttons.interact;
    if (!b) return;
    const t = String(label || '').trim();
    // Who the label names, so the tap goes to them (namedInReach).
    this.labelWho = /^talk to\b/i.test(t) ? this.personInReach() : null;
    toggleClass(b, 'person', !!this.labelWho);
    toggleClass(b, 'ready', !!t);
    toggleClass(b, 'idle', !t);
    b.hidden = false;
    const verb = t ? t.split(' ')[0] : 'Talk';
    setText(b.querySelector('.tbtn-label'), verb.length > 7 ? 'Use' : verb);
    setText(this.useLabel, t);
    setAttr(b, 'aria-label', t || 'Talk (open the chat)');
    const ic = !t || /^(talk|ask|greet|chat)/i.test(t) ? 'talk' : 'hand';
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
  // A weave that carries a price (DESIGN §25) wears a red mark, and says what it costs.
  const price = !empty && rec.plan?.priceDefs?.length ? rec.plan.priceDefs[0] : null;
  let mark = b.querySelector('.wbtn-price');
  if (price && !mark) {
    mark = document.createElement('span');
    mark.className = 'wbtn-price';
    mark.setAttribute('aria-hidden', 'true');
    b.append(mark);
  }
  if (mark) {
    mark.hidden = !price;
    if (price) mark.style.setProperty('--pc', price.color);
  }
  const label = empty ? `Weave ${i + 1}: empty — open the Spellbook` : `${rec.name}${rec.cost ? ` · ${Math.round(rec.cost)} mana` : ''}${price ? ` · price: ${price.costText}` : ''}`;
  setAttr(b, 'aria-label', label);
  setAttr(b, 'title', label);
  if (slot.name) setText(slot.name, empty ? 'New' : shortName(rec.name));
  if (slot.cost) setText(slot.cost, empty || !rec.cost ? '' : String(Math.round(rec.cost)));
}

// What a weave button shows from moment to moment (touch and the desktop hotbar alike):
//   the cooldown — a dark sweep with a bright leading edge, and its whole seconds while
//     one or more is left; a short flash when it comes back (.ready);
//   the charge — a ring filling round the button while it is held (.charging, --charge),
//     pulsing when full (.charged), dimmed with a hollow mana drop when the mana in hand
//     stops it growing (.capped);
//   starved (not enough mana) and a shake when a press was refused (.shake; .not-ready
//     when it was still cooling).
export function paintSlotState(slot, rec, w, i, t) {
  const b = slot.b;
  const cd = rec.plan ? w.cooldownFrac(i) : 0;
  const cooling = cd > 0.001;
  setStyle(slot.cd, '--cd', cd.toFixed(3));
  toggleClass(b, 'cooling', cooling);
  if (slot.secs) {
    const left = cooling && typeof w.cooldownLeft === 'function' ? w.cooldownLeft(i) : 0;
    setText(slot.secs, left >= 1 ? String(Math.ceil(left - 0.05)) : '');
  }
  // Back from a cooldown: a flash for a moment.
  if (slot.wasCooling && !cooling && rec.plan) slot.readyAt = t;
  slot.wasCooling = cooling;
  toggleClass(b, 'ready', Number.isFinite(slot.readyAt) && t - slot.readyAt < 0.45);
  const ch = typeof w.chargeOf === 'function' ? w.chargeOf(i) : null;
  toggleClass(b, 'charging', !!ch);
  if (slot.chg) setStyle(slot.chg, '--charge', ch ? ch.k.toFixed(3) : '0');
  toggleClass(b, 'charged', !!ch?.full);
  toggleClass(b, 'capped', !!ch?.capped);
  toggleClass(b, 'starved', !ch && w.starved(i));
  const f = w.lastFail(i);
  const shaking = !!f && t - f.t < 0.35;
  toggleClass(b, 'shake', shaking);
  toggleClass(b, 'not-ready', shaking && f.reason === 'cooldown');
}

// The chat's unread count, on the touch Talk button too.
TouchControls.prototype.setUnread = function setUnread(n) {
  const b = this.talkBadge;
  if (!b) return;
  if (n > 0) {
    setText(b, n > 9 ? '9+' : String(n));
    b.hidden = false;
  } else b.hidden = true;
};
