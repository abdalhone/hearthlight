// The Unkindling's controls and its sound (round 14b, workstream soul; DESIGN §37.7).
//
//   desktop: hold F with a grown soul close enough to touch (the lock-on target first);
//            a small dark hint names who ("Hold F · Bram") while someone is in reach, and a
//            refusal says why ("No. Not a child."); letting go before it tears lets it slip back;
//   phone:   a dark hand in the right-thumb cluster, only while the spell is known and someone
//            it may take is in reach; held, it holds the spell; lifted, it lets go. It sits left
//            of the dodge (mirrored for a left hand) and hides with the touch layer under panels;
//   sound:   only the player hears it, a faint cold drone with a slow beat, a catch at each jerk,
//            a breath drawn in at the tear, a snuffed wick: audio.play with no position and no
//            bus event, so no ear in the world (src/ai/hearing.js) ever hears a thing.
// Every listener is the view's own; nothing in input.js or touch.js is changed (those belong
// to talk and blood). No pad binding this round (seam note in DESIGN §37.7).

import { h, icon, setText, toggleClass, setStyle, setAttr } from './dom.js';
import { isTextTarget } from '../core/input.js';
import { SFX, SFX_GAP } from './sfx.js';

export const KEY = 'KeyF';
const SCAN = 0.12; // s between looks for someone in reach
const DRONE = 0.85; // s between the drone's swells while the hold lasts

// The sounds (recipes like src/ui/sfx.js's; added once, never replacing one).
export const UNKINDLE_SFX = {
  unkindle_drone(S, t, p) {
    S.tone(t, { type: 'sine', freq: 61 * p, to: 58 * p, dur: 1.1, a: 0.25, gain: 0.07 });
    S.tone(t, { type: 'sine', freq: 92.5 * p, dur: 1.1, a: 0.3, gain: 0.035, vibrato: { rate: 3.1, depth: 4 } });
    S.noise(t, { dur: 1.0, a: 0.35, gain: 0.025, filter: { type: 'bandpass', freq: 520 * p, q: 6 }, out: S.wet });
  },
  unkindle_jerk(S, t, p) {
    S.tone(t, { type: 'triangle', freq: 220 * p, to: 140 * p, dur: 0.12, gain: 0.035 });
    S.noise(t, { dur: 0.08, gain: 0.03, filter: { type: 'highpass', freq: 3800 } });
  },
  unkindle_tear(S, t, p) {
    S.noise(t, { dur: 0.42, a: 0.18, gain: 0.07, rate: 0.7, filter: { type: 'bandpass', freq: 900 * p, to: 2600 * p, q: 1.2 }, out: S.wet });
    S.tone(t + 0.05, { type: 'sine', freq: 740 * p, to: 1480 * p, dur: 0.35, gain: 0.03, out: S.wet });
  },
  unkindle_gutter(S, t, p) {
    S.noise(t, { dur: 0.16, gain: 0.05, filter: { type: 'lowpass', freq: 900 * p, to: 200 } });
    S.tone(t + 0.12, { type: 'sine', freq: 180 * p, to: 70 * p, dur: 0.5, gain: 0.04 });
  },
  unkindle_snap(S, t, p) {
    S.tone(t, { type: 'sine', freq: 120 * p, to: 48 * p, dur: 0.3, gain: 0.12 });
    S.noise(t, { dur: 0.1, gain: 0.06, filter: { type: 'lowpass', freq: 1400, to: 300 } });
  },
};
for (const [k, f] of Object.entries(UNKINDLE_SFX)) {
  if (!SFX[k]) SFX[k] = f;
  if (SFX_GAP && SFX_GAP[k] == null) SFX_GAP[k] = 0.05;
}

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[unkindle view]', err);
    return fallback;
  }
}

// Where the dark hand sits in the cluster, as an offset (CSS px) from the sword's centre: left
// of the dodge along the bottom row, clear of the inner and outer weave rings.
export function handSpot(geo, mode = 'landscape', mirror = false) {
  const r2 = Number(geo?.r2) || (mode === 'portrait' ? 146 : 162);
  const btn = Number(geo?.btn) || (mode === 'portrait' ? 52 : 56);
  const size = Math.max(44, Number(geo?.use) || 50);
  const x = -(r2 + (mode === 'portrait' ? 4 : 8));
  // Just below the outer weave ring's lowest button (at 196°, with six weaves), whatever the
  // cluster's size (Settings → touch size); still clear of the screen's bottom edge.
  const y = Math.ceil(Math.sin((196 * Math.PI) / 180) * r2 + (btn + size) / 2 + 2);
  return { x: mirror ? -x : x, y, size };
}

export class UnkindleView {
  constructor(game, unk) {
    this.game = game;
    this.unk = unk;
    this.btn = null;
    this.hint = null;
    this.target = null;
    this.refusal = null;
    this.scanT = 0;
    this.droneT = 0;
    this.keyDown = false;
    this.pid = null;
    this.mounted = false;
    this.layoutKey = '';
  }

  get ui() {
    return this.game?.ui || null;
  }

  get touch() {
    return this.ui?.isTouch === true;
  }

  play(name, volume = 0.6) {
    const v = Number(this.game?.settings?.sfxVol ?? 0.7);
    // No position: it is not a sound in the world, only in the player's own ears.
    safe(() => this.game?.audio?.play?.(name, { volume: volume * (v > 0 ? 1 : 0) }));
  }

  mount() {
    if (this.mounted || typeof document === 'undefined') return;
    const ui = this.ui;
    if (!ui?.root) return;
    this.mounted = true;
    // Desktop: the held key.
    this._down = (e) => this.onKey(e, true);
    this._up = (e) => this.onKey(e, false);
    this._blur = () => this.letGo('blur');
    window.addEventListener('keydown', this._down);
    window.addEventListener('keyup', this._up);
    window.addEventListener('blur', this._blur);
    // The hint (desktop) and the dark hand (phone).
    this.hintName = h('b', { class: 'unk-hint-name' });
    // The odds, before you start (round 15): the same the hold then plays out.
    this.hintOdds = h('span', { class: 'unk-hint-odds' });
    this.hint = h('div', { class: 'unk-hint', hidden: true, 'aria-live': 'polite' }, h('span', { class: 'unk-hint-key', text: 'F' }), h('span', { class: 'unk-hint-verb', text: 'Hold' }), this.hintName, this.hintOdds);
    ui.root.append(h('div', { class: 'layer layer-unk' }, this.hint));
    this.btnName = h('span', { class: 'tbtn-label unk-btn-name' });
    this.btn = h('button', { type: 'button', class: 'tbtn unk-btn', hidden: true, 'aria-label': 'Unkindle (hold)' }, icon('hand'), this.btnName);
    this.btn.addEventListener('pointerdown', (e) => this.onBtnDown(e));
    const up = (e) => this.onBtnUp(e);
    this.btn.addEventListener('pointerup', up);
    this.btn.addEventListener('pointercancel', up);
    this.btn.addEventListener('lostpointercapture', up);
    this.btn.addEventListener('contextmenu', (e) => e.preventDefault());
    this.btn.addEventListener('touchstart', (e) => e.cancelable && e.preventDefault(), { passive: false });
    this.btn.addEventListener('touchend', (e) => e.cancelable && e.preventDefault(), { passive: false });
    const anchor = ui.touch?.anchor;
    if (anchor) anchor.append(this.btn);
  }

  // ---------------------------------------------------------------- input

  onKey(e, down) {
    if (e.code !== KEY || e.ctrlKey || e.metaKey || e.altKey) return;
    if (down) {
      if (e.repeat || this.keyDown) return;
      if (isTextTarget(e.target) || isTextTarget(document.activeElement)) return;
      const g = this.game;
      if (g?.state !== 'playing' || safe(() => this.ui?.isModalOpen?.(), false)) return;
      if (!this.unk.available()) return;
      this.keyDown = true;
      e.preventDefault();
      this.press();
    } else if (this.keyDown) {
      this.keyDown = false;
      this.letGo('let_go');
    }
  }

  onBtnDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try {
      this.btn.setPointerCapture(e.pointerId);
    } catch {
      /* old browsers */
    }
    this.pid = e.pointerId;
    toggleClass(this.btn, 'down', true);
    safe(() => this.ui?.touch?.buzz?.());
    this.press(this.target);
  }

  onBtnUp(e) {
    if (this.pid == null || (e && e.pointerId !== this.pid)) return;
    this.pid = null;
    toggleClass(this.btn, 'down', false);
    this.letGo('let_go');
  }

  press(target = null) {
    const r = this.unk.begin(target);
    if (!r.ok && r.line) safe(() => this.ui?.toast?.(r.line, 'info', { key: 'unkindle_why' }));
    return r;
  }

  letGo(why) {
    if (this.unk.channel) this.unk.release(why);
  }

  // ---------------------------------------------------------------- the frame

  update(dt) {
    if (!this.mounted) this.mount();
    const ch = this.unk.channel;
    if (ch && ch.phase === 'pull') {
      this.droneT -= dt;
      if (this.droneT <= 0) {
        this.droneT = DRONE;
        this.play('unkindle_drone', 0.5 + 0.4 * ch.shown);
      }
    }
    this.scanT -= dt;
    if (this.scanT > 0) return;
    this.scanT = SCAN;
    const avail = this.unk.available();
    let t = null;
    let refusal = null;
    if (avail && !ch && !this.unk.busy()) {
      const r = this.unk.targetInReach();
      t = r.target;
      refusal = r.refusal;
    }
    this.target = t;
    this.refusal = refusal;
    this.paint(ch);
  }

  nameOf(e) {
    if (!e) return '';
    if (e.objType === 'dummy') return 'the straw';
    return safe(() => this.game?.murder?.name?.(e.id), null) || String(e.name || '').split(' ')[0] || 'them';
  }

  // The odds in words for the hint: "likely, 78%" (round 15); straw in practice has none.
  oddsText(t) {
    if (!t || t.objType === 'dummy') return '';
    const o = safe(() => this.unk.odds?.(t), null);
    if (!o) return '';
    return o.chance > 0 ? `${o.words}, ${o.percent}%` : o.words;
  }

  paint(ch) {
    if (!this.mounted) return;
    const t = this.target;
    const show = !!t && !ch;
    const odds = show ? this.oddsText(t) : '';
    // Desktop: the hint. Phone: the dark hand.
    if (this.hint) {
      const on = show && !this.touch;
      if (this.hint.hidden === on) this.hint.hidden = !on;
      if (on) {
        setText(this.hintName, this.nameOf(t));
        setText(this.hintOdds, odds ? `· ${odds}` : '');
        setAttr(this.hint, 'title', odds ? `The odds the hold takes ${this.nameOf(t)}, if nothing breaks it: ${odds}. A soul that breaks free knows what you tried.` : '');
      }
    }
    if (this.btn) {
      const on = (show || !!ch) && this.touch;
      if (this.btn.hidden === on) this.btn.hidden = !on;
      if (on) {
        this.place();
        const pct = show ? safe(() => this.unk.odds?.(t), null) : null;
        const tag = pct && t?.objType !== 'dummy' ? ` ${pct.percent}%` : '';
        setText(this.btnName, ch ? '' : `${this.nameOf(t).replace(/^the /, '')}${tag}`);
        setAttr(this.btn, 'aria-label', ch ? 'Unkindling (let go to stop)' : `Unkindle ${this.nameOf(t)} (hold)${odds ? `: ${odds}` : ''}`);
        toggleClass(this.btn, 'holding', !!ch);
      }
    }
  }

  // Beside the touch cluster's own pieces, by its geometry (touch.js lays them out the same way).
  place() {
    const T = this.ui?.touch;
    if (!T || !this.btn) return;
    const geo = T.geo || null;
    const mode = T.mode || 'landscape';
    const mirror = !!this.game?.settings?.leftHanded;
    const key = `${mode}|${geo?.r2}|${geo?.use}|${mirror}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    const s = handSpot(geo, mode, mirror);
    setStyle(this.btn, 'width', `${s.size}px`);
    setStyle(this.btn, 'height', `${s.size}px`);
    setStyle(this.btn, 'left', `${Math.round(s.x - s.size / 2)}px`);
    setStyle(this.btn, 'top', `${Math.round(s.y - s.size / 2)}px`);
  }

  // ---------------------------------------------------------------- the hold's moments

  onBegin() {
    this.droneT = 0;
    this.paint(this.unk.channel);
  }

  onJerk() {
    this.play('unkindle_jerk', 0.55);
  }

  onTear() {
    this.play('unkindle_tear', 0.7);
  }

  onPhase(ch) {
    if (ch?.phase === 'sag') this.play('unkindle_gutter', 0.7);
  }

  onSnap() {
    this.play('unkindle_snap', 0.8);
  }

  onEnd() {
    this.keyDown = false;
    if (this.pid != null) {
      this.pid = null;
      if (this.btn) toggleClass(this.btn, 'down', false);
    }
    this.scanT = 0.3;
    this.paint(null);
  }
}
