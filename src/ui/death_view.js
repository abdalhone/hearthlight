// The screens of a fall (DESIGN §27): while the player lies bleeding, a fading heartbeat
// line, who is coming, whether a flame burns for them at the chapel, a Call for help
// button (H on a keyboard, the interact button too) and a hint to crawl; while carried,
// who carries them where. When the window closes: the kept flame's moment on a black
// screen, or the end and the memorial. Mounted on first use; styles in memorial.js (.sv-).

import { h, button, setText } from './dom.js';
import { openMemorial, ensureSurvivalStyles } from './memorial.js';
import { hasKeptFlame } from '../survival/kept_flame.js';

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function firstName(a) {
  return (a?.name || 'Someone').split(' ')[0];
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
    this.trace = new Float32Array(120);
    this.traceI = 0;
    this.lastBeats = 0;
    this.spike = 0;
    this.ecgT = 0;
    this.lastFrame = 0;
    this.callUntil = 0;
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
    });
    this._onKey = (e) => {
      if (!this.visible || e.repeat) return;
      if (e.key !== 'h' && e.key !== 'H') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      this.call();
    };
  }

  mount() {
    if (this.mounted || typeof document === 'undefined') return;
    const root = this.game.uiRoot || document.body;
    ensureSurvivalStyles();
    this.ecg = h('canvas', { class: 'sv-ecg', width: '440', height: '80', 'aria-hidden': 'true' });
    this.statusEl = h('p', { class: 'sv-status', role: 'status', text: 'You are bleeding out' });
    this.subEl = h('p', { class: 'sv-sub' });
    this.flameEl = h('p', { class: 'sv-flame' });
    this.callBtn = button('Call for help', { cls: 'sv-call', onClick: () => this.call() });
    this.callBtn.append(h('kbd', { text: 'H' }));
    this.hintEl = h('p', { class: 'sv-hint' });
    this.fallenEl = h('div', { class: 'sv-fallen', hidden: true }, this.ecg, this.statusEl, this.subEl, this.flameEl, this.callBtn, this.hintEl);
    this.layer = h('div', { class: 'layer sv-layer' }, this.fallenEl);
    this.words = h('div', { class: 'sv-words' });
    this.curtain = h('div', { class: 'sv-curtain', hidden: true, 'aria-live': 'polite' }, this.words);
    const fade = root.querySelector?.('.layer-fade');
    if (fade) root.insertBefore(this.layer, fade);
    else root.append(this.layer);
    root.append(this.curtain);
    window.addEventListener('keydown', this._onKey);
    this.mounted = true;
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
    this.trace.fill(0);
    this.refresh();
    if (!this.raf) this.loop();
  }

  hide() {
    this.visible = false;
    if (this.fallenEl) this.fallenEl.hidden = true;
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
      }
      this.drawEcg(dt);
      this.loop();
    });
  }

  // The heartbeat line: a spike for every beat, flattening and fading as the window closes.
  drawEcg(dt) {
    const g = this.game;
    const sv = g.survival;
    const rec = sv?.fallOf?.(g.player);
    const c = this.ecg;
    const ctx = c?.getContext?.('2d');
    if (!ctx || !rec) return;
    const frac = Math.max(0, rec.left / rec.window);
    const beats = sv.heart?.beats || 0;
    if (beats !== this.lastBeats) {
      this.lastBeats = beats;
      this.spike = 1;
    }
    this.ecgT += dt;
    const step = 1 / 40;
    while (this.ecgT >= step) {
      this.ecgT -= step;
      let v = 0;
      if (this.spike > 0) {
        const s = 1 - this.spike;
        v = s < 0.15 ? -0.25 : s < 0.3 ? 1 : s < 0.45 ? -0.55 : s < 0.6 ? 0.15 : 0;
        this.spike = Math.max(0, this.spike - 0.09);
      }
      this.trace[this.traceI] = v * (0.35 + 0.65 * frac);
      this.traceI = (this.traceI + 1) % this.trace.length;
    }
    const W = c.width;
    const H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    const n = this.trace.length;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const v = this.trace[(this.traceI + i) % n];
      const x = (i / (n - 1)) * W;
      const y = H / 2 - v * (H * 0.42);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const alpha = 0.25 + 0.75 * frac;
    ctx.strokeStyle = `rgba(255, 107, 94, ${alpha.toFixed(3)})`;
    ctx.shadowColor = 'rgba(255, 80, 70, 0.8)';
    ctx.shadowBlur = 10 * frac;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  refresh() {
    const g = this.game;
    const sv = g.survival;
    const P = g.player;
    const rec = sv?.fallOf?.(P);
    if (!rec || !this.mounted) return;
    const carrier = P.carriedBy;
    const frac = rec.left / rec.window;
    const touch = !!g.ui?.isTouch;
    if (carrier) {
      const where = safe(() => sv.jobFor(carrier)?.dest?.bed?.id, '') || '';
      const to = where === 'cell_cot' ? 'the guardhouse' : where === 'infirmary_cot' ? 'the chapel' : "Mira's sickroom";
      setText(this.statusEl, frac < 0.25 ? 'Hold on…' : 'Carried');
      setText(this.subEl, `${firstName(carrier)} is carrying you to ${to}.`);
    } else {
      setText(this.statusEl, frac < 0.25 ? 'Your heart is slowing' : 'You are bleeding out');
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
      if (kneeling.length) sub = `${joinNames(kneeling)} ${kneeling.length === 1 ? 'is' : 'are'} with you.`;
      if (coming.length) sub += `${sub ? ' ' : ''}${joinNames(coming.slice(0, 3))} ${coming.length === 1 ? 'is' : 'are'} coming.`;
      if (running.length && !sub) sub = `${joinNames(running)} ran for help.`;
      if (!sub) sub = rec.calls ? 'Nobody answers. Call again.' : 'Nobody has seen you fall.';
      setText(this.subEl, sub);
    }
    const mode = g.settings?.deathMode === 'home' ? 'home' : hasKeptFlame(g) ? 'flame' : 'final';
    this.flameEl.classList.toggle('is-lit', mode === 'flame');
    this.flameEl.classList.toggle('is-out', mode === 'final');
    setText(this.flameEl, mode === 'flame' ? 'A kept flame burns for you at the chapel.' : mode === 'home' ? 'If you die, you will wake at home.' : 'No flame burns for you. If you die here, it ends.');
    this.callBtn.hidden = !!carrier;
    this.callBtn.disabled = performance.now() < this.callUntil;
    const crawlLeft = rec.crawled < 72;
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
      this.curtainWords(
        [
          ['Your heart stops.', ''],
          ['On the chapel altar, a flame kept in your name flares —', 'sv-gold'],
          ['— and holds.', 'sv-gold'],
        ],
        { dark: true, hold: 5.6 },
      );
    } else if (p?.mode === 'final') {
      const name = g.player?.name && g.player.name !== 'Traveler' ? g.player.name : 'The stranger';
      this.curtainWords(
        [
          [`${name} did not wake.`, 'sv-big'],
          ['No flame was kept for them.', ''],
        ],
        { dark: true, hold: Infinity },
      );
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
