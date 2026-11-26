// The weave controller (DESIGN.md §22.4): every way of casting — a touch drag from a
// weave button, a tap, the number keys toward the mouse, the right mouse button, a
// gamepad trigger — ends here, and here alone talks to the runtime (game.magic, §22.2).
// A click on a desktop hotbar slot is that slot's number key: it casts at once (a hold
// charges), aimed by the key's rules, and selects nothing (the author: "I click the
// button and the skill gets unselected after I hit it").
// Every weave, on every device, starts on the press and is cast on the release: a quick
// tap casts as it always did, a longer hold charges it (castStart {charge: true}; a beam
// pours instead), and one charge builds at a time — a second weave pressed meanwhile
// lets the first one go.
// It runs once per fixed step (from the HUD), so pauses, menus and hit-stops are
// respected, and it publishes what the aim preview should draw.
//
// The runtime is feature-detected: every read of game.magic goes through the small
// accessors below, so the UI degrades to nothing when magic is absent and adapts when
// a field has a different name.

import { previewOf, aimsAtSpot, castModeOf, weavePalette, componentInfo, cleanWeave, fallbackName, IDS, normKind, singular } from './weave_meta.js';
import { cycleSlot, WEAVE_SLOTS } from '../core/input.js';

// A weave tapped on a phone (no drag) auto-aims only this far (round 14b leftover: a quick
// tap must not snipe a slime across the meadow).
export const TAP_REACH = 110;
const SELECTED_KEY = 'hearthlight.weave.selected';
const BODY_UP = 7; // aim from the chest, not the feet
const MIN_SPOT = 14; // a spot is never closer than this (world px)

// Drag on a weave button: px before the finger counts as aiming, and the drag that
// reaches the full range of a spot-aimed weave.
export const TOUCH_AIM_START = 22;
export const TOUCH_DRAG_MAX = 92;

// Pure: where a touch drag aims. (dx, dy) CSS px from the button centre; range in world
// px; returns { x, y } relative to the caster's chest, or null while still on the button.
export function dragAim(dx, dy, preview, range, dragMax = TOUCH_DRAG_MAX, start = TOUCH_AIM_START) {
  const d = Math.hypot(dx, dy);
  if (!(d >= start)) return null;
  const ux = dx / d;
  const uy = dy / d;
  const r = Math.max(MIN_SPOT, Number(range) || 0);
  if (aimsAtSpot(preview)) {
    const f = Math.min(1, Math.max(0, (d - start * 0.5) / Math.max(1, dragMax - start * 0.5)));
    const dist = Math.max(MIN_SPOT, f * r);
    return { x: ux * dist, y: uy * dist };
  }
  return { x: ux * r, y: uy * r };
}

// Pure: the best foe to auto-aim at — nearest hostile in range, a little in favour of
// what is in front. `list` items: { x, y, hostile, alive }.
export function pickTarget(list, ox, oy, fx, fy, range) {
  let best = null;
  let bestScore = Infinity;
  const r2 = range * range;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || !e.hostile || e.alive === false) continue;
    const dx = e.x - ox;
    const dy = e.y - oy;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;
    const d = Math.sqrt(d2) || 1;
    const front = (dx * fx + dy * fy) / d;
    const score = d - front * 18;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() / 1000 : Date.now() / 1000;
}

function readSelected() {
  try {
    const v = Number(window.localStorage?.getItem(SELECTED_KEY));
    return Number.isFinite(v) && v >= 0 && v < WEAVE_SLOTS ? v : 0;
  } catch {
    return 0;
  }
}

function saveSelected(i) {
  try {
    window.localStorage?.setItem(SELECTED_KEY, String(i));
  } catch {
    /* private mode: the choice lasts for this visit */
  }
}

function asSet(v) {
  if (!v) return null;
  if (v instanceof Set) return v;
  if (Array.isArray(v)) return new Set(v);
  if (typeof v === 'object') return new Set(Object.keys(v).filter((k) => v[k]));
  return null;
}

function num(v) {
  const n = typeof v === 'function' ? v() : v;
  return Number.isFinite(n) ? n : null;
}

export class Weaving {
  constructor(game, ui = null) {
    this.game = game;
    this.ui = ui;
    this.selected = typeof window !== 'undefined' ? readSelected() : 0;
    this.casts = new Map(); // source -> cast in progress
    this.touches = new Map(); // pointerId -> { slot, dx, dy, aimed, cancel, ended }
    this.clicks = new Map(); // pointerId -> { slot, started, ended, cancel } (hotbar presses)
    this.plans = []; // per slot: { key, plan, weave, palette, mode, preview, name }
    this.castAt = []; // per slot: game time of the last cast (cooldown fallback)
    this.aims = []; // what the aim layer draws this frame
    this.hover = null; // the faint desktop preview of the selected slot
    this.sword = null; // a touch drag on the sword button { dx, dy }
    this.version = 0; // bumps when slots or unlocks change (the UI re-renders on it)
    this.fails = []; // { slot, reason, t } for the buttons to shake
    this.dragMax = TOUCH_DRAG_MAX;
    this._aimPool = [];
    this._bound = false;
  }

  bind() {
    if (this._bound) return;
    this._bound = true;
    const bus = this.game.bus;
    if (!bus?.on) return;
    const bump = () => this.invalidate();
    for (const ev of ['magic_unlocked', 'weave_slots', 'magic_slots', 'game_start', 'magic_loaded']) bus.on(ev, bump);
    bus.on('spell_cast', (p) => {
      if (p?.caster && p.caster === this.game.player && Number.isInteger(p.slot)) this.castAt[p.slot] = this.game.time || 0;
    });
  }

  invalidate() {
    this.plans.length = 0;
    this.version++;
  }

  // ---------- the runtime, feature-detected ----------

  get magic() {
    return this.game.magic || null;
  }

  available() {
    const m = this.magic;
    return !!(m && (typeof m.cast === 'function' || typeof m.castStart === 'function'));
  }

  slotCount() {
    const m = this.magic;
    if (!m) return 0;
    for (const k of ['slotCount', 'slotsUnlocked', 'unlockedSlots', 'activeSlots', 'numSlots']) {
      const v = num(typeof m[k] === 'function' ? () => m[k]() : m[k]);
      if (v !== null && v > 0) return Math.min(WEAVE_SLOTS, Math.max(1, v | 0));
    }
    const s = Array.isArray(m.slots) ? m.slots : [];
    let n = 4;
    for (let i = 4; i < Math.min(WEAVE_SLOTS, s.length); i++) if (s[i]) n = i + 1;
    return n;
  }

  // Up to how many essences / twists a weave holds now (§22.1: 2 and 2 to start).
  limit(kind) {
    const m = this.magic;
    const k = normKind(kind);
    const keys = k === 'essences' ? ['essenceSlots', 'maxEssences', 'essenceLimit'] : k === 'twists' ? ['twistSlots', 'maxTwists', 'twistLimit'] : [];
    for (const key of keys) {
      const v = num(typeof m?.[key] === 'function' ? () => m[key]() : m?.[key]);
      if (v !== null && v >= 0) return v | 0;
    }
    if (m?.limits && Number.isFinite(m.limits[k])) return m.limits[k] | 0;
    return k === 'shapes' ? 1 : 2;
  }

  unlockedSet(kind) {
    const k = normKind(kind);
    const u = this.magic?.unlocked;
    return asSet(u?.[k]) || asSet(u?.[singular(k)]) || null;
  }

  isUnlocked(kind, id) {
    const s = this.unlockedSet(kind);
    if (s) return s.has(id);
    return normKind(kind) === 'shapes' ? id === 'bolt' : normKind(kind) === 'essences' ? id === 'raw' : false;
  }

  // The registry entry for a component, wherever the runtime keeps it.
  entry(kind, id) {
    const m = this.magic;
    if (!m) return null;
    const k = normKind(kind);
    try {
      const viaFn = m.info?.(singular(k), id) || m.describe?.(singular(k), id);
      if (viaFn) return viaFn;
    } catch {
      /* fall through to the tables */
    }
    const tables = [m.registry?.[k], m.registry?.[singular(k)], m[k.toUpperCase()], m.registries?.[k], m.defs?.[k]];
    for (const t of tables) {
      if (!t) continue;
      try {
        // A runtime registry (get/ids), a Map, or a plain table.
        const e = typeof t.get === 'function' ? t.get(id) : t[id];
        if (e) return e;
      } catch {
        /* try the next table */
      }
    }
    return null;
  }

  // Every id of a kind: the known ones, plus any the runtime added.
  ids(kind) {
    const k = normKind(kind);
    const out = [...(IDS[k] || [])];
    const m = this.magic;
    const add = (id) => {
      if (typeof id === 'string' && !out.includes(id)) out.push(id);
    };
    const tables = [m?.registry?.[k], m?.[k.toUpperCase()], m?.registries?.[k]];
    for (const t of tables) {
      if (!t) continue;
      try {
        if (typeof t.ids === 'function') for (const id of t.ids()) add(id);
        else if (t instanceof Map) for (const id of t.keys()) add(id);
        else if (typeof t === 'object') for (const id of Object.keys(t)) add(id);
      } catch {
        /* a registry that cannot list itself adds nothing */
      }
    }
    const u = this.unlockedSet(k);
    if (u) for (const id of u) add(id);
    return out;
  }

  info(kind, id) {
    return componentInfo(kind, id, this.entry(kind, id));
  }

  weaveAt(i) {
    const s = this.magic?.slots;
    const w = Array.isArray(s) ? s[i] : null;
    return w && typeof w === 'object' && w.shape ? w : null;
  }

  compile(weave) {
    const m = this.magic;
    if (!m || !weave) return null;
    try {
      const plan = m.compile ? m.compile(weave) : m.compileWeave?.(weave);
      return plan || null;
    } catch (err) {
      return { error: String(err?.message || err), invalid: true };
    }
  }

  static planOk(plan) {
    return !!plan && !plan.invalid && !plan.error && plan.ok !== false && plan.valid !== false;
  }

  // Everything the UI needs about a slot, compiled once per change of its weave.
  slotInfo(i) {
    const w = this.weaveAt(i);
    const key = w ? `${w.shape}|${(w.essences || []).join(',')}|${(w.twists || []).join(',')}|${w.name || ''}` : '';
    let rec = this.plans[i];
    if (rec && rec.key === key && rec.weaveRef === w && rec.stamp === this.magic?._unlockStamp) return rec;
    let plan = null;
    if (w) {
      try {
        plan = typeof this.magic?.slotPlan === 'function' ? this.magic.slotPlan(i) : null;
      } catch {
        plan = null;
      }
      if (!plan) plan = this.compile(w);
    }
    const ok = Weaving.planOk(plan);
    rec = {
      key,
      stamp: this.magic?._unlockStamp,
      weaveRef: w,
      weave: w,
      plan: ok ? plan : null,
      error: w && !ok ? plan?.reason || plan?.error || 'This weave cannot be cast.' : '',
      palette: w ? weavePalette(w, ok ? plan : null, (k, id) => this.entry(k, id)) : null,
      mode: castModeOf(ok ? plan : null, w),
      preview: w ? previewOf(ok ? plan : null, w) : null,
      name: w ? w.name || (ok && plan.name) || fallbackName(w) : '',
      cost: ok ? Number(plan.cost ?? plan.mana ?? 0) || 0 : 0,
      cooldown: ok ? Number(plan.cooldown ?? plan.cd ?? 0) || 0 : 0,
    };
    this.plans[i] = rec;
    return rec;
  }

  mana() {
    const m = this.magic?.mana;
    if (!m) return null;
    const cur = Number(m.cur ?? m.current ?? m.value ?? 0);
    const max = Number(m.max ?? m.cap ?? 0);
    return { cur: Number.isFinite(cur) ? cur : 0, max: Number.isFinite(max) && max > 0 ? max : 0 };
  }

  // 0 = ready, 1 = just cast. The runtime's own numbers win; else our record of casts.
  cooldownFrac(i) {
    const m = this.magic;
    const rec = this.slotInfo(i);
    const total = rec.cooldown;
    try {
      const f = num(m?.cooldownFraction ? () => m.cooldownFraction(i) : m?.cooldownFrac ? () => m.cooldownFrac(i) : null);
      if (f !== null) return Math.max(0, Math.min(1, f));
      const left = num(m?.cooldownLeft ? () => m.cooldownLeft(i) : m?.slotCooldown ? () => m.slotCooldown(i) : null) ?? num(m?.cooldowns?.[i]) ?? num(m?.slotCooldowns?.[i]);
      if (left !== null) return total > 0 ? Math.max(0, Math.min(1, left / total)) : left > 0 ? 1 : 0;
    } catch {
      /* fall back to our own clock */
    }
    const at = this.castAt[i];
    if (!(total > 0) || !Number.isFinite(at)) return 0;
    return Math.max(0, Math.min(1, 1 - ((this.game.time || 0) - at) / total));
  }

  // Seconds before this slot can cast again (the button shows them while >= 1 s).
  cooldownLeft(i) {
    const m = this.magic;
    const rec = this.slotInfo(i);
    if (!rec.plan) return 0;
    try {
      const left = num(m?.cooldownLeft ? () => m.cooldownLeft(i) : null) ?? num(m?.cooldowns?.[i]);
      if (left !== null) return Math.max(0, left);
    } catch {
      /* fall back to our own clock */
    }
    return this.cooldownFrac(i) * (rec.cooldown || 0);
  }

  // The charge building on this slot right now: { k (0..1), live (past the tap), capped
  // (held back by the mana in hand), full } or null.
  chargeOf(i) {
    for (const c of this.casts.values()) {
      if (c.slot !== i || !c.started || c.mode === 'hold' || !c.live) continue;
      const k = Math.max(0, Math.min(1, Number(c.k) || 0));
      return { k, live: true, capped: !!c.capped, full: k >= 0.999 };
    }
    return null;
  }

  // Can this slot cast now? { ok, reason } — the runtime decides when it can say.
  canCast(i) {
    const m = this.magic;
    const rec = this.slotInfo(i);
    if (!rec.weave) return { ok: false, reason: 'empty' };
    if (!rec.plan) return { ok: false, reason: 'invalid' };
    try {
      const r = m?.canCast?.(i, this.game.player);
      if (r === true) return { ok: true };
      if (r === false) return { ok: false, reason: 'unknown' };
      if (r && typeof r === 'object') return { ok: !!r.ok, reason: r.reason || '' };
    } catch {
      /* fall through */
    }
    const mana = this.mana();
    if (mana && rec.cost > mana.cur + 1e-6) return { ok: false, reason: 'mana' };
    if (this.cooldownFrac(i) > 0.001) return { ok: false, reason: 'cooldown' };
    return { ok: true };
  }

  starved(i) {
    const rec = this.slotInfo(i);
    const mana = this.mana();
    return !!(rec.plan && mana && rec.cost > mana.cur + 1e-6);
  }

  setSlot(i, weave) {
    const m = this.magic;
    if (!m) return { ok: false, reason: 'no magic' };
    const w = weave ? cleanWeave(weave, this.limit('essences'), this.limit('twists')) : null;
    try {
      let r;
      if (typeof m.setSlot === 'function') r = m.setSlot(i, w);
      else if (Array.isArray(m.slots)) {
        m.slots[i] = w;
        r = true;
      }
      this.invalidate();
      this.game.bus?.emit?.('magic_slots', { slot: i, weave: w });
      if (r && typeof r === 'object' && r.ok === false) return { ok: false, reason: r.reason || 'refused' };
      return { ok: r !== false };
    } catch (err) {
      return { ok: false, reason: String(err?.message || err) };
    }
  }

  select(i) {
    const n = this.slotCount();
    if (!n) return;
    this.lastActT = this.game.time || 0;
    const v = Math.max(0, Math.min(n - 1, i | 0));
    if (v === this.selected) return;
    this.selected = v;
    saveSelected(v);
    this.version++;
  }

  cycle(steps) {
    const n = this.slotCount();
    if (!n || !steps) return;
    // Skip empty slots when there are filled ones to land on.
    let v = this.selected;
    const dir = Math.sign(steps);
    for (let s = 0; s < Math.abs(steps); s++) {
      for (let k = 0; k < n; k++) {
        v = cycleSlot(v, dir, n);
        if (this.weaveAt(v)) break;
      }
    }
    this.select(v);
    this.game.audio?.play?.('ui_click', { volume: 0.5 });
  }

  // ---------- touch (called by the weave buttons) ----------

  touchStart(slot, id) {
    this.touches.set(id, { slot, dx: 0, dy: 0, aimed: false, cancel: false, ended: false, started: false, t0: now() });
  }

  touchMove(id, dx, dy) {
    const t = this.touches.get(id);
    if (!t) return;
    t.dx = dx;
    t.dy = dy;
    const d = Math.hypot(dx, dy);
    if (!t.aimed && d >= TOUCH_AIM_START) t.aimed = true;
    // Back on the button after aiming: let go here to cancel.
    t.cancel = t.aimed && d < TOUCH_AIM_START * 0.9;
  }

  touchEnd(id, cancelled = false) {
    const t = this.touches.get(id);
    if (!t) return;
    t.ended = true;
    if (cancelled) t.cancel = true;
  }

  touchState(id) {
    return this.touches.get(id) || null;
  }

  // ---------- the desktop hotbar (called by its slots) ----------

  // A press on a slot: cast it like its number key, from the next step on.
  clickStart(slot, id = 0) {
    if (this.clicks.has(id)) return;
    this.clicks.set(id, { slot, started: false, ended: false, cancel: false });
  }

  // The button let go (anywhere: a hold may be dragged out over the world to aim).
  clickEnd(id = 0, cancelled = false) {
    const k = this.clicks.get(id);
    if (!k) return;
    k.ended = true;
    if (cancelled) k.cancel = true;
  }

  // The slot a press is casting or charging right now (the hotbar names it), or -1.
  castingSlot() {
    for (const c of this.casts.values()) if (c.started) return c.slot;
    return -1;
  }

  // ---------- per step ----------

  canAct() {
    const g = this.game;
    const p = g.player;
    if (g.state !== 'playing' || g.paused || !p || p.downed || p.removed) return false;
    if (typeof p.isAlive === 'function' && !p.isAlive()) return false;
    if (g.input && !g.input.enabled) return false;
    try {
      if (g.ui?.isModalOpen?.()) return false;
    } catch {
      /* no UI */
    }
    if (g.story?.active || g.story?.playing) return false;
    return true;
  }

  update(dt) {
    const g = this.game;
    const input = g.input;
    this.aims.length = 0;
    this.hover = null;
    const pool = this._aimPool;
    let poolI = 0;
    const live = this.available() && this.slotCount() > 0;
    if (!live || !this.canAct()) {
      this.stopAll();
      this.touches.clear();
      this.clicks.clear();
      return;
    }
    // (A hit-stop freezes the world, not the hands: presses made in it still count.)
    const n = this.slotCount();
    if (input) {
      const steps = input.takeWheel?.() || 0;
      if (steps) this.cycle(steps);
      if (input.pressed('slot_prev')) this.cycle(-1);
      if (input.pressed('slot_next')) this.cycle(1);
      // Number keys: cast that slot toward the mouse (and select it).
      for (let i = 0; i < Math.min(n, WEAVE_SLOTS); i++) {
        const a = `weave${i + 1}`;
        if (input.pressed(a)) {
          this.select(i);
          this.begin(`key${i}`, i, 'key');
        }
      }
      if (input.pressed('cast')) this.begin('cast', this.selected, input.lastDevice === 'gamepad' ? 'pad' : 'mouse');
    }
    // Touch: a press starts the weave (it charges while held), lifting casts it.
    for (const [id, t] of this.touches) {
      const src = `t${id}`;
      if (!t.started) {
        t.started = true;
        this.begin(src, t.slot, 'touch');
      }
      if (t.ended) {
        this.finish(src, t.cancel);
        this.touches.delete(id);
      }
    }
    // The hotbar: a click is the slot's key — started on the press, cast on the release
    // (a quick click casts uncharged; a hold charges). It never changes the selection.
    for (const [id, k] of this.clicks) {
      const src = `c${id}`;
      if (!k.started) {
        k.started = true;
        this.begin(src, k.slot, 'click');
      }
      if (k.ended) {
        this.finish(src, k.cancel);
        this.clicks.delete(id);
      }
    }
    // Held casts: keep aiming, release when the key / button lets go.
    for (const [src, c] of this.casts) {
      if (c.source === 'key' && !(input?._isHeld?.(`weave${c.slot + 1}`) ?? false)) this.finish(src, false);
      else if ((c.source === 'mouse' || c.source === 'pad') && !(input?._isHeld?.('cast') ?? false)) this.finish(src, false);
    }
    for (const [src, c] of this.casts) {
      const aim = this.aimFor(c);
      c.aim = aim;
      if (c.started) {
        const h = this.call('castHold', c.slot, aim, dt);
        if (h === null) c.started = false;
        else {
          c.held += dt;
          if (Number.isFinite(h?.k)) c.k = h.k;
          c.live = h?.live !== undefined ? !!h.live : c.held >= 0.18;
          c.capped = !!h?.capped;
        }
      }
      // A key or a click still inside the tap's dead zone draws no preview yet (a quick
      // tap would only flicker one); a finger on a button always shows its aim.
      if (c.source !== 'touch' && c.mode !== 'hold' && !c.live) continue;
      const v = pool[poolI] || (pool[poolI] = {});
      poolI++;
      this.describeAim(v, c, aim);
      this.aims.push(v);
    }
    // The selected weave, faintly, under a mouse that is aiming — in a fight (a foe near)
    // or right after a cast or a slot change; walking about shows only the reticle.
    this.foeT -= dt;
    if (!(this.foeT > 0)) {
      this.foeT = 0.25;
      const p = g.player;
      this.foeNear = !!this.nearestFoe(p.x, p.y - BODY_UP, p.facing?.x || 0, p.facing?.y || 0, 220);
    }
    const t = g.time || 0;
    const recent = t - (this.lastActT ?? -9) < 2.5;
    const padAiming = !!(input?.padAim && (input.padAim.x || input.padAim.y));
    if (!this.aims.length && (padAiming || ((this.foeNear || recent) && input?.mouseAiming?.(2.5)))) {
      const rec = this.slotInfo(this.selected);
      if (rec.plan) {
        const c = this._hoverCast || (this._hoverCast = { slot: 0, source: 'mouse', mode: 'quick', touch: null, held: 0 });
        c.source = padAiming ? 'pad' : 'mouse';
        c.slot = this.selected;
        const aim = this.aimFor(c);
        const v = this._hoverAim || (this._hoverAim = {});
        this.describeAim(v, c, aim);
        v.faint = true;
        this.hover = v;
      }
    }
    // Shakes on failed casts fade out.
    while (this.fails.length && t - this.fails[0].t > 0.6) this.fails.shift();
  }

  begin(src, slot, source) {
    if (this.casts.has(src)) return;
    const rec = this.slotInfo(slot);
    if (!rec.weave) {
      if (source !== 'touch') this.fail(slot, 'empty');
      return;
    }
    this.lastActT = this.game.time || 0;
    // One charge at a time: whatever is being held is let go (cast) first — unless its
    // finger was dragged back onto its button (then it was being cancelled).
    for (const [osrc, o] of this.casts) if (o.started) this.finish(osrc, !!o.touch?.cancel);
    const c = { slot, source, mode: rec.mode, started: false, held: 0, k: 0, live: false, capped: false, aim: null, touch: source === 'touch' ? this.touches.get(Number(src.slice(1))) : null };
    this.casts.set(src, c);
    const aim = this.aimFor(c);
    const r = this.call('castStart', slot, aim);
    if (r && r.ok === false) {
      this.fail(slot, r.reason);
      this.casts.delete(src);
      return;
    }
    // A runtime with no castStart cast it outright: nothing is held.
    if (r?.instant) {
      this.casts.delete(src);
      this.dropHolds();
      return;
    }
    // The runtime holds one weave per caster: starting this one ended any other.
    this.dropHolds(c);
    c.started = true;
  }

  // Held casts the runtime has let go of (another cast took over, mana ran out, a
  // status froze the hands) stop holding here too, so a late release frees nothing.
  dropHolds(except = null) {
    for (const o of this.casts.values()) if (o !== except && o.started) o.started = false;
  }

  // The press ends: cast what was held (charged as far as it got), or let it go.
  finish(src, cancel) {
    const c = this.casts.get(src);
    if (!c) return;
    this.casts.delete(src);
    if (!c.started) return;
    const aim = this.aimFor(c);
    if (cancel) {
      if (typeof this.magic?.castCancel === 'function') this.call('castCancel', c.slot, aim);
      else this.call('castRelease', c.slot, aim, 0, true);
      return;
    }
    this.lastActT = this.game.time || 0;
    const r = this.call('castRelease', c.slot, aim);
    if (r && r.ok === false && r.reason !== 'empty') this.fail(c.slot, r.reason);
  }

  stopAll() {
    for (const [src] of this.casts) this.finish(src, true);
    this.casts.clear();
  }

  // An instant cast (no hold): what a runtime without castStart gets.
  fire(c, aim = this.aimFor(c)) {
    this.lastActT = this.game.time || 0;
    const r = this.call('cast', c.slot, aim);
    if (r && r.ok === false) this.fail(c.slot, r.reason);
    else this.dropHolds(); // a cast ends whatever was being held
    return r;
  }

  fail(slot, reason) {
    this.fails.push({ slot, reason: reason || '', t: this.game.time || 0 });
    // The runtime's own fizzle (and the fx layer's sound) usually says it; else a soft no.
    if (reason === 'mana' && !this.game.magicFx) this.game.audio?.play?.('error', { volume: 0.35 });
  }

  lastFail(slot) {
    for (let i = this.fails.length - 1; i >= 0; i--) if (this.fails[i].slot === slot) return this.fails[i];
    return null;
  }

  // One door to the runtime. Faces the aim first, so the body turns with the weave.
  call(fn, slot, aim, dt = 0, cancelled = false) {
    const g = this.game;
    const m = this.magic;
    const p = g.player;
    if (!m || !p) return null;
    // The runtime turns the caster itself (player.castPose); older ones may not.
    if (aim && fn !== 'castHold' && !p.rolling && typeof p.castPose !== 'function') {
      try {
        p.faceToward?.(aim.x, aim.y);
      } catch {
        /* facing is cosmetic */
      }
    }
    let r = null;
    try {
      if (fn === 'cast') {
        r = typeof p.castWeave === 'function' ? p.castWeave(slot, aim) : m.cast(p, slot, aim);
        if (r?.ok !== false) this.castAt[slot] = g.time || 0;
      } else if (fn === 'castStart') {
        // Every weave charges while held (a beam pours): the press only starts it.
        if (typeof m.castStart === 'function') r = m.castStart(p, slot, aim, { charge: true });
        else {
          r = typeof p.castWeave === 'function' ? p.castWeave(slot, aim) : m.cast?.(p, slot, aim);
          if (r?.ok !== false) this.castAt[slot] = g.time || 0;
          if (r && typeof r === 'object') r = { ...r, instant: true };
          else if (r !== false) r = { ok: true, instant: true };
        }
      } else if (fn === 'castHold') {
        // castHold(caster, aim) -> the hold's state, or null once it has ended.
        if (typeof m.castHold !== 'function') return {};
        return m.castHold(p, aim) ?? null;
      } else if (fn === 'castRelease') r = cancelled && typeof m.castCancel === 'function' ? m.castCancel(p) : m.castRelease?.(p, aim);
      else if (fn === 'castCancel') r = m.castCancel?.(p);
    } catch (err) {
      if (!this._warned) {
        this._warned = true;
        console.warn('[weaving] cast failed', err);
      }
      return { ok: false, reason: 'error' };
    }
    if (r === false) return { ok: false, reason: 'refused' };
    return r && typeof r === 'object' ? r : { ok: true };
  }

  // ---------- aiming ----------

  origin(out) {
    const p = this.game.player;
    out.x = p?.x || 0;
    out.y = (p?.y || 0) - BODY_UP;
    return out;
  }

  // Where cast `c` points now: a world point { x, y, target? }.
  aimFor(c) {
    const g = this.game;
    const p = g.player;
    const rec = this.slotInfo(c.slot);
    const pv = rec.preview || previewOf(null, rec.weave);
    const range = Math.max(MIN_SPOT, Number(pv?.range) || Number(rec.plan?.range) || 120);
    const o = this.origin(this._o || (this._o = { x: 0, y: 0 }));
    const out = c.aimOut || (c.aimOut = { x: 0, y: 0, target: null, auto: false });
    out.target = null;
    out.auto = false;
    const spot = aimsAtSpot(pv);
    // Locked on (round 14b, game.lock): every source aims at the lock while it is in reach.
    const lk = g.lock?.aimTarget?.(range * 1.4 + 12) || null;
    if (lk && pv?.type !== 'ring' && pv?.type !== 'shield') {
      out.x = lk.x;
      out.y = lk.y - BODY_UP;
      out.target = lk;
      if (spot) {
        const dx = out.x - o.x;
        const dy = out.y - o.y;
        const d = Math.hypot(dx, dy);
        if (d > range) {
          out.x = o.x + (dx / d) * range;
          out.y = o.y + (dy / d) * range;
        }
      }
      return out;
    }
    // A touch drag (the finger's own aim).
    if (c.source === 'touch') {
      const t = c.touch;
      const v = t && t.aimed ? dragAim(t.dx, t.dy, pv, range, this.dragMax) : null;
      if (v) {
        out.x = o.x + v.x;
        out.y = o.y + v.y;
        return out;
      }
      // A quick tap (round 14b leftover): only a foe close in front, never a far slime.
      return this.autoAim(out, o, range, spot, pv, { tap: true });
    }
    const input = g.input;
    if (c.source === 'pad' || (c.source === 'key' && input?.lastDevice === 'gamepad')) {
      const a = input?.padAim;
      if (a && (a.x || a.y)) {
        const l = Math.hypot(a.x, a.y);
        const dist = spot ? Math.max(MIN_SPOT, Math.min(1, l) * range) : range;
        out.x = o.x + (a.x / l) * dist;
        out.y = o.y + (a.y / l) * dist;
        return out;
      }
      return this.autoAim(out, o, range, spot, pv);
    }
    // Mouse (number keys, hotbar clicks and the right button aim at it while it is over
    // the game; a click still on its slot aims like a key with the mouse away: the
    // nearest foe in range, else straight ahead).
    const w = input?.mouseAiming?.(30) ? input.mouseWorld() : null;
    if (w) {
      let dx = w.x - o.x;
      let dy = w.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d < 4) {
        dx = p?.facing?.x || 1;
        dy = p?.facing?.y || 0;
        out.x = o.x + dx * range;
        out.y = o.y + dy * range;
        return out;
      }
      if (spot && d > range) {
        dx = (dx / d) * range;
        dy = (dy / d) * range;
      }
      out.x = o.x + dx;
      out.y = o.y + dy;
      out.target = this.actorAt(w.x, w.y);
      return out;
    }
    return this.autoAim(out, o, range, spot, pv);
  }

  // A tap or a keyboard cast: the nearest foe in range, else straight ahead.
  autoAim(out, o, range, spot, pv, { tap = false } = {}) {
    const p = this.game.player;
    const fx = p?.facing?.x ?? 1;
    const fy = p?.facing?.y ?? 0;
    out.auto = true;
    // A ring around you, or a ward (a tap shields yourself).
    if (pv?.type === 'ring' || pv?.type === 'shield') {
      out.x = o.x + fx;
      out.y = o.y + fy;
      return out;
    }
    let reach = pv?.type === 'cone' || pv?.type === 'arc' ? range * 1.4 + 12 : range * 1.15 + 8;
    // A tap on a phone aims at what is close, the way the thumb meant it (TAP_REACH).
    if (tap) reach = Math.min(reach, TAP_REACH);
    const foe = this.nearestFoe(o.x, o.y, fx, fy, reach);
    if (foe) {
      out.x = foe.x;
      out.y = foe.y - BODY_UP;
      out.target = foe;
      if (spot) {
        const dx = out.x - o.x;
        const dy = out.y - o.y;
        const d = Math.hypot(dx, dy);
        if (d > range) {
          out.x = o.x + (dx / d) * range;
          out.y = o.y + (dy / d) * range;
        }
      }
      return out;
    }
    const dist = spot ? Math.max(MIN_SPOT, range * 0.6) : range;
    out.x = o.x + fx * dist;
    out.y = o.y + fy * dist;
    return out;
  }

  nearestFoe(ox, oy, fx, fy, range) {
    const g = this.game;
    const p = g.player;
    const combat = g.combat;
    const list = g.entities?.all?.() || [];
    const cand = this._cand || (this._cand = []);
    cand.length = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === p || e === g.companion || e.type !== 'actor' || e.removed) continue;
      if (typeof e.isAlive === 'function' && !e.isAlive()) continue;
      const dx = e.x - ox;
      const dy = e.y - oy;
      if (dx > range || dx < -range || dy > range || dy < -range) continue;
      let hostile = false;
      try {
        hostile = !!(combat?.isHostile?.(p, e) || e.provokedBy === p || (e.target === p && e.faction !== 'village'));
      } catch {
        hostile = false;
      }
      if (hostile) cand.push(e);
    }
    const proxy = this._proxy || (this._proxy = []);
    proxy.length = cand.length;
    for (let i = 0; i < cand.length; i++) {
      const e = cand[i];
      const q = proxy[i] || (proxy[i] = { x: 0, y: 0, hostile: true, alive: true, e: null });
      q.x = e.x;
      q.y = e.y;
      q.e = e;
    }
    const best = pickTarget(proxy, ox, oy, fx, fy, range);
    return best ? best.e : null;
  }

  // An actor under a point (the mouse on someone is an explicit aim at them).
  actorAt(x, y) {
    const g = this.game;
    const list = g.entities?.all?.() || [];
    let best = null;
    let bd = 11 * 11;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === g.player || e.type !== 'actor' || e.removed) continue;
      const dx = e.x - x;
      const dy = e.y - 8 - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) {
        bd = d2;
        best = e;
      }
    }
    return best;
  }

  // Fill a reusable record for the aim layer.
  describeAim(v, c, aim) {
    const rec = this.slotInfo(c.slot);
    const o = this.origin(this._o2 || (this._o2 = { x: 0, y: 0 }));
    v.slot = c.slot;
    v.ox = o.x;
    v.oy = o.y;
    v.x = aim.x;
    v.y = aim.y;
    v.preview = rec.preview;
    v.palette = rec.palette;
    v.mode = rec.mode;
    v.held = c.held || 0;
    v.cancel = !!(c.touch && c.touch.cancel);
    v.auto = !!aim.auto;
    v.target = aim.target || null;
    v.starved = this.starved(c.slot);
    v.faint = false;
    v.charge = rec.mode !== 'hold' && c.live ? Math.max(0, Math.min(1, Number(c.k) || 0)) : 0;
    v.capped = !!c.capped;
    return v;
  }
}
