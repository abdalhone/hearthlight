// The screens of a fall (DESIGN §27): while the player lies bleeding, the countdown — a
// ring that drains with the seconds left, the number big in its middle, thumping with a
// heart that races as the window closes — who is coming, how far along whoever is helping
// is (kneeling with a salve, lifting, carrying you to a cot: an inner gold ring and a bar
// with how far there is to go), why it drains faster or slower right now, whether a flame
// burns for them at the chapel, a Call for help button (H on a keyboard, the interact
// button too) and a hint to crawl. When the window closes: the kept flame's moment on a
// black screen, or the end and the memorial. Mounted on first use; styles in memorial.js.

import { h, button, setText } from './dom.js';
import { openMemorial, ensureSurvivalStyles } from './memorial.js';
import { hasKeptFlame } from '../survival/kept_flame.js';
import { CRAWL_BUDGET } from '../survival/constants.js';
import { installEmberRingView } from './ember_ring_view.js';

// What the helper is doing, for the bar under the countdown.
const HELP_WORDS = {
  salve: (n) => `${n} is dressing the wound`,
  warmth: (n) => `${n} is lending you her warmth`,
  lift: (n) => `${n} is lifting you`,
  stanch: (n) => `${n} presses on the wound`,
  carry: (n, to) => `${n} is carrying you to ${to}`,
  lay: (n, to) => `${n} is laying you down in ${to}`,
};
const PLACE_WORDS = { sickroom: "Mira's sickroom", chapel: 'the chapel', cell: 'the guardhouse' };

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

// "Rowan", not "Captain"; "Aveline", not "Sister".
function firstName(a) {
  return String(a?.name || 'Someone').replace(/^(Captain|Sister|Brother|Master|Mistress|Old)\s+/i, '').split(' ')[0];
}

function joinNames(list) {
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

export class DeathView {
  constructor(game) {
    this.game = game;
    this.mounted = false;
    this.visible = false;
    this.raf = 0;
    this.lastBeats = 0;
    this.thump = 0; // 0..1, the ring's kick on each heartbeat
    this.shownLeft = null; // the number on the ring (eased so it never jumps)
    this.helpShown = 0; // eased rescue progress for the inner ring
    this.lastFrame = 0;
    this.callUntil = 0;
    installEmberRingView(game); // where your coins lie after a death, and the way back to them
    const bus = game.bus;
    bus.on('fallen', (p) => p?.entity === game.player && this.show());
    bus.on('fall_resolved', (p) => p?.entity === game.player && this.hide());
    bus.on('player_died', (p) => this.onDied(p));
    bus.on('life_closed', (p) => this.onLifeClosed(p));
    bus.on('fall_call', () => {
      this.callUntil = performance.now() + 3000;
    });
    bus.on('game_start', () => {
      if (safe(() => game.survival?.isFallen?.(game.player), false)) this.show();
      else this.hide(); // (a new game or a load never starts with the last one's countdown)
    });
    this._onKey = (e) => {
      if (!this.visible || e.repeat) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if ((e.key === 'r' || e.key === 'R') && this.riseBtn && !this.riseBtn.hidden) {
        this._riseKeys?.start(null);
        return;
      }
      if (e.key !== 'h' && e.key !== 'H') return;
      this.call();
    };
    this._onKeyUp = (e) => {
      if (e.key === 'r' || e.key === 'R') this._riseKeys?.stop();
    };
  }

  mount() {
    if (this.mounted || typeof document === 'undefined') return;
    const root = this.game.uiRoot || document.body;
    ensureSurvivalStyles();
    // The countdown: a ring that drains (canvas, drawn every frame) with the seconds left
    // in words for screen readers beside it.
    this.ring = h('canvas', { class: 'sv-ring', width: '240', height: '240', 'aria-hidden': 'true' });
    this.secsEl = h('span', { class: 'sv-secs', role: 'timer', 'aria-live': 'off' });
    this.statusEl = h('p', { class: 'sv-status', role: 'status', text: 'You are bleeding out' });
    this.subEl = h('p', { class: 'sv-sub' });
    this.rateEl = h('p', { class: 'sv-rate' });
    this.helpLabel = h('span', { class: 'sv-help-label' });
    this.helpEta = h('span', { class: 'sv-help-eta num' });
    this.helpFill = h('span', { class: 'sv-help-fill' });
    this.helpEl = h('div', { class: 'sv-help', hidden: true }, h('div', { class: 'sv-help-text' }, this.helpLabel, this.helpEta), h('div', { class: 'sv-help-bar' }, this.helpFill));
    this.flameEl = h('p', { class: 'sv-flame' });
    this.callBtn = button('Call for help', { cls: 'sv-call', onClick: () => this.call() });
    this.callBtn.append(h('kbd', { text: 'H' }));
    this.hintEl = h('p', { class: 'sv-hint' });
    // The last stand (§25), when it is held: rise now, burning, for one minute, and then
    // die for good. Held down for a second to choose it: never a stray tap.
    this.riseFill = h('span', { class: 'sv-rise-fill', 'aria-hidden': 'true' });
    this.riseBtn = h('button', { type: 'button', class: 'sv-rise', hidden: true, 'aria-label': 'Hold to rise in your Last Stand: one minute, then you die for good' }, this.riseFill, h('span', { class: 'sv-rise-text', text: 'Hold: rise for a minute, then die' }));
    this.bindRise();
    // One row under the body: the ring, and beside it everything else (so it stays clear
    // of the hotbar on a computer and of the thumbs on a phone held sideways).
    const col = h('div', { class: 'sv-words-col' }, this.statusEl, this.subEl, this.rateEl, this.helpEl, this.flameEl, this.callBtn, this.riseBtn, this.hintEl);
    const clock = h('div', { class: 'sv-clock' }, h('div', { class: 'sv-ring-wrap' }, this.ring, this.secsEl), col);
    this.fallenEl = h('div', { class: 'sv-fallen', hidden: true }, clock);
    this.layer = h('div', { class: 'layer sv-layer' }, this.fallenEl);
    this.words = h('div', { class: 'sv-words' });
    this.curtain = h('div', { class: 'sv-curtain', hidden: true, 'aria-live': 'polite' }, this.words);
    const fade = root.querySelector?.('.layer-fade');
    if (fade) root.insertBefore(this.layer, fade);
    else root.append(this.layer);
    root.append(this.curtain);
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKeyUp);
    this.mounted = true;
  }

  // Press and hold (pointer, or R on a keyboard) for RISE_HOLD seconds to rise.
  bindRise() {
    const HOLD = 1.1;
    const b = this.riseBtn;
    let t0 = 0;
    let raf = 0;
    const stop = () => {
      t0 = 0;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      this.riseFill.style.width = '0%';
    };
    const tick = () => {
      raf = 0;
      if (!t0) return;
      const k = Math.min(1, (performance.now() - t0) / (HOLD * 1000));
      this.riseFill.style.width = `${Math.round(k * 100)}%`;
      if (k >= 1) {
        stop();
        const g = this.game;
        safe(() => g.survival?.riseInstead?.(g.player, 'chosen'));
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    const start = (e) => {
      if (!this.visible || b.hidden || t0) return;
      e?.preventDefault?.();
      t0 = performance.now();
      raf = requestAnimationFrame(tick);
    };
    b.addEventListener('pointerdown', start);
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    this._riseKeys = { start, stop };
  }

  call() {
    const g = this.game;
    if (!this.visible || performance.now() < this.callUntil) return;
    const n = safe(() => g.survival?.callForHelp?.(g.player), 0);
    this.callUntil = performance.now() + 3000;
    if (n === 0) this.refresh();
  }

  show() {
    this.mount();
    if (!this.mounted) return;
    this.visible = true;
    this.fallenEl.hidden = false;
    this.rootClass(true);
    this._ringKey = '';
    this.shownLeft = null;
    this.helpShown = 0;
    this.lastBeats = this.game.survival?.heart?.beats || 0;
    this.refresh();
    this.place();
    if (!this.raf) this.loop();
  }

  hide() {
    this.visible = false;
    this._riseKeys?.stop();
    if (this.fallenEl) this.fallenEl.hidden = true;
    this.rootClass(false);
  }

  // While you lie bleeding the UI root carries `sv-down` (src/styles/polish.css: the weave
  // bar steps aside on a computer; on an upright phone the mission line and the toasts make
  // way for the countdown) and `sv-lefty` when the move stick is on the right.
  rootClass(on) {
    const root = this.game.uiRoot || this.game.ui?.root;
    if (!root?.classList) return;
    root.classList.toggle('sv-down', !!on);
    const lefty = !!this.game.ui?.touch?.el?.classList?.contains?.('lefty');
    root.classList.toggle('sv-lefty', !!on && lefty);
    if (!on) {
      root.style?.removeProperty?.('--sv-below');
      root.style?.removeProperty?.('--sv-top');
    }
  }

  // Interface size (round 13, ui_scale.js) on a computer: the countdown is drawn at the
  // HUD's zoom too, as large as fits between the body and the bottom of the screen (with
  // the help bar and the Rise button it can be tall). Phones keep 1 (their own sizes). The
  // ring's canvas follows the pixels it is shown at; on an upright phone the toasts go
  // below the countdown (--sv-below). Called on show and four times a second.
  place() {
    const g = this.game;
    const el = this.fallenEl;
    if (!el || typeof window === 'undefined') return;
    const ui = g.ui;
    const want = ui?.isTouch ? 1 : Math.max(1, Number(ui?._uiz) || 1);
    const cur = this._zoom || 1;
    let z = want;
    if (want > 1) {
      const r = el.getBoundingClientRect();
      const H = window.innerHeight || 720;
      const W = window.innerWidth || 1280;
      if (r.height > 0) {
        const natH = r.height / cur;
        const natW = r.width / cur;
        const off = (r.top - H / 2) / cur; // the block's top below the middle, unzoomed
        const room = H - 12 - H / 2;
        if (off + natH > 0) z = Math.min(z, room / (off + natH));
        if (natW > 0) z = Math.min(z, (W - 24) / natW);
      }
      z = Math.max(1, Math.round(z * 100) / 100);
    }
    if (Math.abs(z - cur) > 0.009) {
      this._zoom = z;
      this.layer.style.zoom = z === 1 ? '' : String(z);
    }
    // The ring's canvas at the pixels it is shown at (88-136 CSS px, the zoom, the density).
    const rr = this.ring.getBoundingClientRect?.();
    const css = rr && rr.width > 0 ? rr.width : this.ring.clientWidth || 112;
    const px = Math.max(96, Math.min(400, Math.round(css * (window.devicePixelRatio || 1))));
    if (this.ring.width !== px) {
      this.ring.width = px;
      this.ring.height = px;
      this._ringKey = '';
    }
    const root = g.uiRoot || ui?.root;
    if (root?.style && ui?.isTouch) {
      // (upright: the countdown sits just under the top strip, however tall the cards have
      // grown with price chips; the toasts just under the countdown)
      let top = 0;
      for (const sel of ['.hud-cards', '.hud-right']) {
        const e = root.querySelector?.(sel);
        const r = e && !e.hidden ? e.getBoundingClientRect() : null;
        if (r && r.height > 0 && r.top < 200) top = Math.max(top, r.bottom);
      }
      if (top > 0) root.style.setProperty('--sv-top', `${Math.round(top + 8)}px`);
      const b = el.getBoundingClientRect();
      if (b.height > 0) root.style.setProperty('--sv-below', `${Math.round(b.bottom + 8)}px`);
    }
  }

  loop() {
    this.raf = requestAnimationFrame((ts) => {
      this.raf = 0;
      if (!this.visible) return;
      const dt = this.lastFrame ? Math.min(0.1, (ts - this.lastFrame) / 1000) : 1 / 60;
      this.lastFrame = ts;
      this.refreshT = (this.refreshT || 0) - dt;
      if (this.refreshT <= 0) {
        this.refreshT = 0.25;
        this.refresh();
        this.place();
      }
      this.drawRing(dt);
      this.loop();
    });
  }

  // The countdown ring (DESIGN §27, round 14): the outer arc is the time left to live,
  // draining clockwise from the top, red deepening as it closes; the number in the middle
  // is the seconds; the whole ring kicks on every heartbeat (and the heart races as the
  // window closes, so it thumps faster and faster). An inner gold arc fills as whoever is
  // saving you gets there: a salve, a lift, the carry to a cot.
  drawRing(dt) {
    const g = this.game;
    const sv = g.survival;
    const c = this.ring;
    const ctx = c?.getContext?.('2d');
    const cd = sv?.countdown?.(g.player);
    if (!ctx || !cd) return;
    const reduce = !!g.settings?.reduceMotion;
    const beats = sv.heart?.beats || 0;
    if (beats !== this.lastBeats) {
      this.lastBeats = beats;
      this.thump = 1;
    }
    this.thump = Math.max(0, this.thump - dt * 5);
    const helpP = cd.help ? cd.help.progress : 0;
    this.helpShown += (helpP - this.helpShown) * Math.min(1, dt * 6);
    const W = c.width;
    const H = c.height;
    const cx = W / 2;
    const cy = H / 2;
    const frac = cd.frac;
    const low = frac < 0.25;
    const kick = reduce ? 0 : this.thump * this.thump;
    // Only redraw when something you could see has changed (a phone thanks us).
    const want0 = cd.left;
    const shown = this.shownLeft == null ? want0 : this.shownLeft + (want0 - this.shownLeft) * Math.min(1, dt * 12);
    const key = `${W}|${Math.ceil(shown - 0.001)}|${Math.round(frac * 360)}|${Math.round(kick * 16)}|${Math.round(this.helpShown * 180)}|${cd.help ? cd.help.kind : ''}`;
    if (key === this._ringKey) {
      this.shownLeft = shown;
      return;
    }
    this._ringKey = key;
    const R = W * 0.4 * (1 + 0.05 * kick);
    ctx.clearRect(0, 0, W, H);
    // The disc behind (so the number reads on snow and grass alike).
    ctx.fillStyle = 'rgba(8, 4, 12, 0.62)';
    ctx.beginPath();
    ctx.arc(cx, cy, R + W * 0.06, 0, Math.PI * 2);
    ctx.fill();
    // The track.
    const lw = W * 0.075;
    ctx.lineWidth = lw;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    // Minute marks every five seconds of the window (quiet ticks round the rim).
    const ticks = Math.max(1, Math.min(36, Math.round(cd.window / 5)));
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = Math.max(2, W * 0.012);
    for (let i = 0; i < ticks; i++) {
      const ang = -Math.PI / 2 + (i / ticks) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * (R - lw / 2), cy + Math.sin(ang) * (R - lw / 2));
      ctx.lineTo(cx + Math.cos(ang) * (R + lw / 2), cy + Math.sin(ang) * (R + lw / 2));
      ctx.stroke();
    }
    // What is left.
    if (frac > 0) {
      const hot = low ? (reduce ? 1 : 0.75 + 0.25 * kick) : 1;
      const col = frac > 0.5 ? `rgba(255, 107, 94, ${hot})` : frac > 0.25 ? `rgba(255, 74, 58, ${hot})` : `rgba(255, 40, 32, ${hot})`;
      // A soft glow under the arc (a wide faint stroke: no blur, cheap on a phone).
      ctx.strokeStyle = `rgba(255, 50, 40, ${(0.22 + 0.3 * kick).toFixed(3)})`;
      ctx.lineWidth = lw * (1.7 + 0.6 * kick);
      ctx.beginPath();
      ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
      // The leading edge: a bright bead where the arc ends.
      const ea = -Math.PI / 2 + frac * Math.PI * 2;
      ctx.fillStyle = '#ffd7cf';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ea) * R, cy + Math.sin(ea) * R, lw * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
    // Whoever is saving you: an inner gold ring filling up.
    if (cd.help && (cd.help.kind !== 'stanch' || this.helpShown > 0.01)) {
      const r2 = R - lw * 1.35;
      ctx.lineWidth = lw * 0.55;
      ctx.strokeStyle = 'rgba(255, 224, 138, 0.18)';
      ctx.beginPath();
      ctx.arc(cx, cy, r2, 0, Math.PI * 2);
      ctx.stroke();
      if (this.helpShown > 0.005) {
        ctx.strokeStyle = '#ffe08a';
        ctx.beginPath();
        ctx.arc(cx, cy, r2, -Math.PI / 2, -Math.PI / 2 + Math.min(1, this.helpShown) * Math.PI * 2);
        ctx.stroke();
      }
    }
    // The seconds, big; eased so a frame never jumps two numbers.
    this.shownLeft = shown;
    const n = Math.max(0, Math.ceil(this.shownLeft - 0.001));
    const big = n >= 100 ? W * 0.3 : W * 0.36;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(big * (1 + 0.04 * kick))}px 'Pixelify Sans', ui-rounded, system-ui, sans-serif`;
    const off = Math.max(1, Math.round(W * 0.012));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillText(String(n), cx + off, cy - W * 0.025 + off);
    ctx.fillStyle = low ? '#ff6a5c' : '#f4ead7';
    ctx.fillText(String(n), cx, cy - W * 0.025);
    ctx.font = `${Math.round(W * 0.1)}px 'Pixelify Sans', ui-rounded, system-ui, sans-serif`;
    ctx.fillStyle = low ? 'rgba(255, 140, 128, 0.95)' : 'rgba(224, 212, 189, 0.85)';
    ctx.fillText(n === 1 ? 'SECOND' : 'SECONDS', cx, cy + W * 0.175);
    // A small heart under the number that beats.
    const hs = W * 0.042 * (1 + 0.45 * kick);
    const hy = cy + W * 0.27;
    ctx.fillStyle = low ? '#ff3b2f' : '#ff6b5e';
    ctx.beginPath();
    ctx.arc(cx - hs * 0.5, hy - hs * 0.2, hs * 0.55, Math.PI, 0);
    ctx.arc(cx + hs * 0.5, hy - hs * 0.2, hs * 0.55, Math.PI, 0);
    ctx.lineTo(cx, hy + hs * 0.9);
    ctx.closePath();
    ctx.fill();
  }

  refresh() {
    const g = this.game;
    const sv = g.survival;
    const P = g.player;
    const rec = sv?.fallOf?.(P);
    if (!rec || !this.mounted) return;
    const cd = safe(() => sv.countdown(P), null) || { left: rec.left, window: rec.window, frac: rec.left / rec.window, rate: 1, help: null };
    const carrier = P.carriedBy;
    const frac = cd.frac;
    const touch = !!g.ui?.isTouch;
    const secs = Math.max(0, Math.ceil(cd.left));
    setText(this.secsEl, `${secs} ${secs === 1 ? 'second' : 'seconds'} to live`);
    this.fallenEl.classList.toggle('is-low', frac < 0.25);
    if (carrier) {
      setText(this.statusEl, frac < 0.25 ? 'Hold on…' : 'Carried');
      setText(this.subEl, '');
    } else {
      setText(this.statusEl, frac < 0.12 ? 'Your heart is failing' : frac < 0.25 ? 'Your heart is slowing' : 'You are bleeding out');
      const coming = [];
      const kneeling = [];
      const running = [];
      for (const [a, j] of sv.jobs || []) {
        if (j.fall !== rec) continue;
        if (j.phase === 'kneel' || j.phase === 'lift') kneeling.push(firstName(a));
        else if (j.phase === 'fetch') running.push(firstName(a));
        else if (j.phase === 'go') coming.push(firstName(a));
      }
      let sub = '';
      // (whoever kneels is on the bar below; here only the ones still on their way)
      if (coming.length) sub = `${joinNames(coming.slice(0, 3))} ${coming.length === 1 ? 'is' : 'are'} coming.`;
      if (running.length) sub += `${sub ? ' ' : ''}${joinNames(running)} ran for help.`;
      if (!sub && !kneeling.length) sub = rec.calls ? 'Nobody answers. Call again.' : 'Nobody has seen you fall.';
      setText(this.subEl, sub);
    }
    // Why the seconds go faster or slower right now.
    let rate = '';
    if (cd.rate > 1.01) rate = rec.wet && !carrier ? 'Soaked and cold: you bleed faster' : 'Crawling opens the wound: faster';
    else if (cd.rate < 0.99) rate = carrier ? 'Held tight: slower' : 'Pressed on the wound: slower';
    setText(this.rateEl, rate);
    this.rateEl.hidden = !rate;
    this.rateEl.classList.toggle('is-worse', cd.rate > 1.01);
    // Whoever is saving you, and how far along they are.
    const help = cd.help;
    const showHelp = !!help && help.kind !== 'stanch';
    this.helpEl.hidden = !showHelp;
    if (showHelp) {
      const words = HELP_WORDS[help.kind] || HELP_WORDS.salve;
      setText(this.helpLabel, words(firstName(help.who), PLACE_WORDS[help.to] || PLACE_WORDS.sickroom));
      const eta = Number.isFinite(help.eta) ? Math.ceil(help.eta) : null;
      setText(this.helpEta, eta != null ? `~${eta} s` : `${Math.round(help.progress * 100)}%`);
      this.helpEta.classList.toggle('is-late', eta != null && eta > cd.left / Math.max(0.1, cd.rate));
      this.helpFill.style.width = `${Math.round(Math.max(0, Math.min(1, help.progress)) * 100)}%`;
    } else if (help?.kind === 'stanch') {
      // pressing on the wound shows as the slower drain
    }
    const mode = g.settings?.deathMode === 'home' ? 'home' : hasKeptFlame(g) ? 'flame' : 'final';
    this.flameEl.classList.toggle('is-lit', mode === 'flame');
    this.flameEl.classList.toggle('is-out', mode === 'final');
    setText(this.flameEl, mode === 'flame' ? 'A kept flame burns for you at the chapel.' : mode === 'home' ? 'If you die, you will wake at home.' : 'No flame burns for you. If you die here, it ends.');
    this.callBtn.hidden = !!carrier;
    this.callBtn.disabled = performance.now() < this.callUntil;
    const canRise = !!safe(() => g.prices?.lastStandArmed?.(), false);
    if (this.riseBtn.hidden === canRise) this.riseBtn.hidden = !canRise;
    this.fallenEl.classList.toggle('has-rise', canRise);
    if (canRise) setText(this.riseBtn.lastChild, touch ? 'Hold: rise for a minute, then die' : 'Hold R: rise for a minute, then die');
    const crawlLeft = rec.crawled < CRAWL_BUDGET - 1;
    this.hintEl.hidden = !!carrier;
    setText(this.hintEl, crawlLeft ? (touch ? 'Drag to crawl a little.' : 'Move to crawl a little · E or H calls out') : 'You cannot drag yourself any further.');
  }

  // ---------------------------------------------------------------- dying

  onDied(p) {
    this.hide();
    this.mount();
    if (!this.mounted) return;
    const g = this.game;
    if (p?.mode === 'flame') {
      const lines = [
        ['Your heart stops.', ''],
        ['On the chapel altar, a flame kept in your name flares —', 'sv-gold'],
        ['— and holds.', 'sv-gold'],
      ];
      // What you carried stays behind (§27, round 14).
      if (p.ring?.coins > 0) lines.push([`What you carried stays where you fell, in the embers.`, 'sv-ember']);
      this.curtainWords(lines, { dark: true, hold: lines.length > 3 ? 7 : 5.6 });
    } else if (p?.mode === 'final') {
      const name = g.player?.name && g.player.name !== 'Traveler' ? g.player.name : 'The stranger';
      const lines =
        p.cause === 'laststand'
          ? [
              ['The fire goes out.', 'sv-ember'],
              [`${name} gave the last of themselves to it.`, 'sv-big'],
              ['There is nothing left to bring back.', ''],
            ]
          : [
              [`${name} did not wake.`, 'sv-big'],
              ['No flame was kept for them.', ''],
            ];
      this.curtainWords(lines, { dark: true, hold: Infinity });
      this.finalShown = false;
      this.finalTimer = setTimeout(() => this.showMemorial(), 4200);
    }
  }

  onLifeClosed(p) {
    this.memorial = p?.memorial || this.memorial;
    if (this.finalReady) this.showMemorial();
    this.finalReady = true;
  }

  showMemorial() {
    if (this.finalShown) return;
    const m = this.memorial || this.game.survival?.memorial;
    if (!m) {
      this.finalReady = true;
      return;
    }
    this.finalShown = true;
    const ui = this.game.ui;
    // The black stays behind the memorial; the words make way for it.
    this.curtain.classList.add('is-under');
    for (const p of this.words.children) p.classList.remove('is-on');
    try {
      openMemorial(ui, m, { final: true });
    } catch (err) {
      console.error('[death] memorial failed', err);
    }
  }

  curtainWords(lines, { dark = true, hold = 4 } = {}) {
    const el = this.curtain;
    el.hidden = false;
    el.classList.toggle('is-dark', dark);
    this.words.replaceChildren();
    const ps = lines.map(([text, cls]) => h('p', { class: cls || '', text }));
    this.words.append(...ps);
    requestAnimationFrame(() => el.classList.add('is-on'));
    ps.forEach((p, i) => setTimeout(() => p.classList.add('is-on'), 500 + i * 1400));
    if (Number.isFinite(hold)) {
      setTimeout(() => {
        el.classList.remove('is-on');
        setTimeout(() => {
          el.hidden = true;
        }, 1500);
      }, hold * 1000);
    }
  }
}

export function installDeathView(game) {
  if (!game || game.deathView || typeof document === 'undefined') return game?.deathView || null;
  game.deathView = new DeathView(game);
  return game.deathView;
}
