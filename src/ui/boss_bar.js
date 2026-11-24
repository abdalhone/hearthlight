// The boss health bar and the glyph reveal (DESIGN §22.3).
//
// BossBar: at the top of the screen while a boss fight is on: the boss's name and title,
// a health bar with a trailing "chip" of recent damage, ticks where its phases change,
// the pips of a shield while one is up, and a flourish when it falls. It mounts itself
// as game.bosses.ui; the manager calls show/update/phase/shield/defeat/hide.
//
// GlyphReveal: when a glyph-shard is taken, a short panel: the glyph, "You can weave fire"
// and a line about it. Tap or wait to close; several in a row queue up.
//
// Styles are injected once (scoped to .boss-bar / .glyph-reveal) so the main stylesheet
// stays the UI agent's.

import { revealLine, GLYPH_TEXT, glyphName } from '../bosses/defs.js';
import { glyphCanvas } from '../art/bosses_art.js';

const STYLE_ID = 'boss-ui-style';

const CSS = `
.boss-bar {
  --bb-accent: #ff8a3d;
  position: absolute;
  left: 50%;
  top: calc(var(--sa-t, 0px) + 10px);
  width: min(520px, 46vw);
  transform: translate(-50%, -140%);
  opacity: 0;
  transition: transform 420ms cubic-bezier(.2,1.3,.4,1), opacity 300ms;
  pointer-events: none;
  z-index: 6;
  font-family: var(--font-display, ui-rounded, system-ui, sans-serif);
  color: var(--parch, #f4ead7);
  filter: drop-shadow(0 3px 0 rgba(5, 3, 14, 0.55));
}
.boss-bar.on { transform: translate(-50%, 0); opacity: 1; }
.boss-bar .bb-head {
  display: flex; align-items: baseline; justify-content: center; gap: 10px;
  margin-bottom: 4px; text-shadow: 0 2px 0 #0b0915, 0 0 10px rgba(0,0,0,.6);
  white-space: nowrap; overflow: hidden;
}
.boss-bar .bb-name { font-size: 19px; letter-spacing: .5px; }
.boss-bar .bb-title { font-family: var(--font-body, ui-rounded, system-ui, sans-serif); font-style: italic; font-size: 13px; color: var(--parch-dim, #b9ad99); overflow: hidden; text-overflow: ellipsis; }
.boss-bar .bb-track {
  position: relative; height: 14px;
  background: #140f24;
  border: 2px solid #0b0915;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.08), 0 0 0 2px color-mix(in srgb, var(--bb-accent) 55%, transparent);
  overflow: hidden;
}
.boss-bar .bb-lag, .boss-bar .bb-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; transform-origin: left center; }
.boss-bar .bb-lag { background: #fff4c0; opacity: .85; }
.boss-bar .bb-fill {
  background: linear-gradient(180deg, color-mix(in srgb, var(--bb-accent) 55%, #ffffff) 0 30%, var(--bb-accent) 30% 72%, color-mix(in srgb, var(--bb-accent) 60%, #000000) 72%);
}
.boss-bar .bb-tick { position: absolute; top: -2px; bottom: -2px; width: 2px; margin-left: -1px; background: #0b0915; box-shadow: 1px 0 0 rgba(255,255,255,.35); }
.boss-bar .bb-shield { display: flex; justify-content: center; gap: 5px; height: 12px; margin-top: 5px; }
.boss-bar .bb-pip { width: 10px; height: 10px; transform: rotate(45deg); background: #cfe0ff; border: 2px solid #1c2a5a; box-shadow: 0 0 8px #7fb2ff; }
.boss-bar .bb-pip.gone { background: #1c2a5a; box-shadow: none; opacity: .5; }
.boss-bar.flash .bb-track { animation: bb-flash 600ms ease-out; }
@keyframes bb-flash { 0% { box-shadow: 0 0 0 4px #fff, 0 0 24px var(--bb-accent); } 100% { box-shadow: 0 0 0 2px color-mix(in srgb, var(--bb-accent) 55%, transparent); } }
.boss-bar .bb-done {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 11px; letter-spacing: 3px; color: #0b0915; opacity: 0; transition: opacity 300ms;
}
.boss-bar.won .bb-fill { background: linear-gradient(180deg, #fff4c0, #ffe27a 60%, #e4b83d); transform: scaleX(1) !important; transition: transform 500ms; }
.boss-bar.won .bb-done { opacity: 1; }
.hud.boss-on .hud-center { visibility: hidden; }

.glyph-reveal {
  position: absolute; left: 50%; top: 42%;
  transform: translate(-50%, -50%) scale(.85);
  min-width: min(340px, 86vw); max-width: 92vw;
  padding: 16px 22px 14px;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  background: rgba(14, 12, 34, 0.94);
  border: 2px solid var(--gr-glow, #e4b83d);
  box-shadow: 0 0 0 2px #0b0915, 0 0 40px color-mix(in srgb, var(--gr-glow, #e4b83d) 45%, transparent), 0 6px 0 rgba(5,3,14,.5);
  color: var(--parch, #f4ead7); text-align: center;
  opacity: 0; pointer-events: none;
  transition: opacity 260ms, transform 360ms cubic-bezier(.2,1.4,.4,1);
  z-index: 40;
}
.glyph-reveal.on { opacity: 1; transform: translate(-50%, -50%) scale(1); pointer-events: auto; cursor: pointer; }
.glyph-reveal .gr-glyph { width: 80px; height: 80px; image-rendering: pixelated; filter: drop-shadow(0 0 10px var(--gr-glow, #e4b83d)); animation: gr-spin 2.4s ease-in-out infinite; }
@keyframes gr-spin { 0%,100% { transform: scaleX(1); } 50% { transform: scaleX(.25); } }
.glyph-reveal .gr-kind { font-family: var(--font-display, system-ui); font-size: 12px; letter-spacing: 3px; text-transform: uppercase; color: var(--gr-glow, #e4b83d); }
.glyph-reveal .gr-line { font-family: var(--font-display, system-ui); font-size: 24px; line-height: 1.1; text-shadow: 0 2px 0 #0b0915; }
.glyph-reveal .gr-sub { font-family: var(--font-body, system-ui); font-style: italic; font-size: 15px; color: var(--parch-2, #e0d4bd); }
.glyph-reveal .gr-hint { font-family: var(--font-body, system-ui); font-size: 12px; color: var(--parch-faint, #877d6e); margin-top: 2px; }

@media (max-width: 640px), (max-height: 520px) {
  /* Phone held sideways: in the gap between the player's card and the place card. */
  .boss-bar { width: clamp(220px, calc(100vw - 470px), 400px); top: calc(var(--sa-t, 0px) + 6px); }
  .boss-bar .bb-name { font-size: 15px; }
  .boss-bar .bb-title { display: none; }
  .boss-bar .bb-track { height: 10px; }
  .glyph-reveal .gr-glyph { width: 60px; height: 60px; }
  .glyph-reveal .gr-line { font-size: 20px; }
}
@media (max-width: 640px) and (min-height: 521px) {
  /* Phone held upright: below the top cards, full width. */
  .boss-bar { top: calc(var(--sa-t, 0px) + 112px); width: calc(100% - 32px); }
}
@media (prefers-reduced-motion: reduce) {
  .boss-bar, .glyph-reveal { transition: opacity 200ms; }
  .glyph-reveal .gr-glyph { animation: none; }
}
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = CSS;
  document.head.appendChild(st);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class BossBar {
  constructor(game, hudEl = null) {
    this.game = game;
    this.hudEl = hudEl;
    this.boss = null;
    this.shown = 0; // displayed fraction
    this.lag = 0; // the chip that trails behind
    this.lagHold = 0;
    injectStyle();
    this.el = this.build();
    this.reveal = new GlyphReveal(game);
    if (game.bosses) game.bosses.ui = this;
  }

  build() {
    const root = el('div', 'boss-bar');
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    this.nameEl = el('span', 'bb-name');
    this.titleEl = el('span', 'bb-title');
    const head = el('div', 'bb-head');
    head.append(this.nameEl, this.titleEl);
    this.track = el('div', 'bb-track');
    this.lagEl = el('div', 'bb-lag');
    this.fillEl = el('div', 'bb-fill');
    this.doneEl = el('div', 'bb-done');
    this.track.append(this.lagEl, this.fillEl, this.doneEl);
    this.shieldEl = el('div', 'bb-shield');
    this.shieldEl.hidden = true;
    root.append(head, this.track, this.shieldEl);
    return root;
  }

  show(b) {
    this.boss = b;
    const info = b.info || {};
    this.el.style.setProperty('--bb-accent', info.accent || '#ff8a3d');
    this.nameEl.textContent = info.name || b.name || '';
    this.titleEl.textContent = info.title || '';
    for (const t of this.track.querySelectorAll('.bb-tick')) t.remove();
    for (const f of info.phases || []) {
      const t = el('i', 'bb-tick');
      t.style.left = `${Math.round(f * 1000) / 10}%`;
      this.track.append(t);
    }
    this.shown = this.lag = b.maxHp ? b.hp / b.maxHp : 1;
    this.lagHold = 0;
    this.paint();
    this.shieldEl.hidden = true;
    this.el.classList.remove('won');
    this.doneEl.textContent = '';
    this.el.hidden = false;
    // Next frame, so the slide-in animates.
    requestAnimationFrame(() => this.el.classList.add('on'));
    this.hudEl?.classList.add('boss-on');
  }

  update(b, dt) {
    if (!b || b !== this.boss) return;
    const f = Math.max(0, Math.min(1, b.hp / (b.maxHp || 1)));
    if (f < this.shown - 0.0005) this.lagHold = 0.55;
    this.shown = f;
    if (this.lagHold > 0) this.lagHold -= dt;
    else if (this.lag > f) this.lag = Math.max(f, this.lag - dt * 0.6);
    if (this.lag < f) this.lag = f;
    const s = b.mem?.shield;
    if (s) this.paintShield(s.pips, s.max || 6);
    else if (!this.shieldEl.hidden) this.shieldEl.hidden = true;
    this.paint();
  }

  paint() {
    this.fillEl.style.transform = `scaleX(${this.shown.toFixed(4)})`;
    this.lagEl.style.transform = `scaleX(${this.lag.toFixed(4)})`;
  }

  paintShield(pips, max) {
    if (this.shieldEl.hidden) this.shieldEl.hidden = false;
    if (this.shieldEl.childElementCount !== max) {
      this.shieldEl.textContent = '';
      for (let i = 0; i < max; i++) this.shieldEl.append(el('i', 'bb-pip'));
    }
    const kids = this.shieldEl.children;
    for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('gone', i >= pips);
  }

  phase() {
    this.flash();
  }

  shield(b, on) {
    if (!on) this.shieldEl.hidden = true;
    this.flash();
  }

  flash() {
    this.el.classList.remove('flash');
    void this.el.offsetWidth;
    this.el.classList.add('flash');
  }

  defeat(b) {
    if (b !== this.boss) return;
    this.shown = 0;
    this.lag = 0;
    this.doneEl.textContent = b.info?.yields ? 'BEATEN' : 'DEFEATED';
    this.el.classList.add('won');
    this.shieldEl.hidden = true;
    this.flash();
  }

  hide() {
    this.el.classList.remove('on');
    this.hudEl?.classList.remove('boss-on');
    this.boss = null;
  }
}

// ---------------------------------------------------------------- the reveal

export class GlyphReveal {
  constructor(game) {
    this.game = game;
    this.queue = [];
    this.current = null;
    this.timer = 0;
    this.el = this.build();
    const mount = () => (game.uiRoot || document.body).appendChild(this.el);
    if (typeof document !== 'undefined') mount();
    game.bus?.on?.('glyph_shard', (p) => this.push(p));
  }

  build() {
    const r = el('div', 'glyph-reveal');
    r.setAttribute('role', 'dialog');
    r.setAttribute('aria-live', 'assertive');
    this.canvas = el('canvas', 'gr-glyph');
    this.canvas.width = 80;
    this.canvas.height = 80;
    this.kindEl = el('div', 'gr-kind');
    this.lineEl = el('div', 'gr-line');
    this.subEl = el('div', 'gr-sub');
    this.hintEl = el('div', 'gr-hint');
    r.append(this.canvas, this.kindEl, this.lineEl, this.subEl, this.hintEl);
    r.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.next();
    });
    return r;
  }

  push(p) {
    if (!p || !p.kind || !p.id) return;
    this.queue.push(p);
    if (!this.current) this.next();
  }

  next() {
    const p = this.queue.shift() || null;
    this.current = p;
    if (!p) {
      this.el.classList.remove('on');
      return;
    }
    const pal = p.palette || { core: '#fff4c0', glow: '#e4b83d', deep: '#7d5a1c' };
    this.el.style.setProperty('--gr-glow', pal.glow);
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, 80, 80);
    ctx.imageSmoothingEnabled = false;
    const c = glyphCanvas(p.kind, p.id, pal, 4);
    if (c) ctx.drawImage(c, 0, 0, 80, 80);
    this.kindEl.textContent = p.kind === 'essence' ? 'Essence' : p.kind === 'twist' ? 'Twist' : p.kind === 'price' ? 'Price' : 'Shape';
    this.lineEl.textContent = revealLine(p.kind, p.id);
    this.subEl.textContent = GLYPH_TEXT[p.kind]?.[p.id] || glyphName(p.kind, p.id);
    // A price (DESIGN §25) reads as its gain, then its cost.
    const pd = p.kind === 'price' ? this.game.magic?.registry?.prices?.get?.(p.id) : null;
    if (pd) {
      this.lineEl.textContent = `You can pay ${pd.name.toLowerCase()}`;
      this.subEl.textContent = `${pd.gainText}. Price: ${pd.costText}.`;
    }
    const g = this.game;
    const book = g.magic ? (g.ui?.isTouch?.() ? 'Open the Spellbook to weave with it.' : 'Open the Spellbook (B) to weave with it.') : 'The Weave will remember it.';
    this.hintEl.textContent = book;
    this.timer = 4.6;
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
    try {
      g.audio?.play?.('levelup', { volume: 0.5 });
    } catch {
      /* sound is optional */
    }
  }

  update(dt) {
    if (!this.current) return;
    this.timer -= dt;
    if (this.timer <= 0) this.next();
  }
}
