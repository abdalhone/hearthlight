// The Missions journal, the world markers (! over givers, ? for turn-ins, a diamond on
// the tracked objective with an arrow at the screen's edge), the notice board's missions,
// and the reveal when the stranger learns a new piece of the Weave (DESIGN §22.3).
// Browser-only: nothing here runs at import time.

import { h, icon, button, clear } from './dom.js';
import { makePanel } from './modal.js';
import { portraitUrl } from './art.js';
import { componentLabel, componentWords } from '../missions/components.js';

const STYLE_ID = 'missions-style';
const LIST_EVERY = 0.4; // seconds between marker list rebuilds (positions update every frame)

// Fallback colours for the reveal glyph when the runtime has no palette to offer.
const ESSENCE_HUE = {
  raw: '#a995ff',
  fire: '#ff8a3d',
  water: '#4fb3ff',
  frost: '#bfefff',
  storm: '#8fd3ff',
  earth: '#c49a6c',
  wind: '#c8f0e0',
  nature: '#7ed36f',
  poison: '#a6e04f',
  light: '#ffe9a3',
  dark: '#7a6cc9',
  iron: '#cfd4dc',
  song: '#f0a8ff',
};

function safe(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// ------------------------------------------------------------------ mounting

export function mountMissionsUi(game) {
  if (typeof document === 'undefined' || !game?.uiRoot) return;
  injectStyles();
  const ui = game.ui;
  if (ui && typeof ui.openMissions !== 'function') ui.openMissions = (tab) => openJournal(game, tab);
  if (!game._missionMarkers) game._missionMarkers = new Markers(game);
}

export function onMissionEvent(game, type, p) {
  if (typeof document === 'undefined') return;
  if (type === 'mission_reward' && p?.reward) {
    if (p.reward.magic && !p.already) queueReveal(game, { kind: p.reward.magic.kind, id: p.reward.magic.id });
    else if (p.reward.slot) queueReveal(game, { slot: p.reward.slot });
  } else if (type === 'ui_open' && p?.panel === 'sign') {
    decorateBoard(game);
  }
  if (/^mission_/.test(type)) {
    if (game._missionsJournal?.isOpen?.()) game._missionsJournal.render();
    game._missionMarkers?.dirty();
  }
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = CSS;
  document.head.append(st);
}

// ------------------------------------------------------------------ markers

class Markers {
  constructor(game) {
    this.game = game;
    this.layer = h('div', { class: 'layer mq-layer', 'aria-hidden': 'true' });
    const root = game.ui?.root || game.uiRoot;
    const fx = root.querySelector?.('.layer-fx');
    if (fx?.after) fx.after(this.layer);
    else root.prepend(this.layer);
    this.pool = [];
    this.list = [];
    this.listT = 0;
    this.last = 0;
    this.arrow = h('div', { class: 'mq-edge', hidden: true }, h('div', { class: 'mq-edge-tip' }));
    this.layer.append(this.arrow);
    const loop = (ts) => {
      try {
        this.frame(ts);
      } catch (err) {
        if (!this.warned) console.warn('[missions] markers', err);
        this.warned = true;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  dirty() {
    this.listT = 0;
  }

  visible() {
    const g = this.game;
    if (g.state !== 'playing' || !g.player || !g.renderer?.worldToCss) return false;
    if (safe(() => g.ui?.isModalOpen?.(), false)) return false;
    if (safe(() => g.story?.isPlaying?.(), false)) return false;
    return true;
  }

  frame(ts) {
    const dt = this.last ? Math.min(0.1, (ts - this.last) / 1000) : 0;
    this.last = ts;
    const on = this.visible();
    if (this.layer.hidden === on) this.layer.hidden = !on;
    if (!on) return;
    const ms = this.game.missions;
    if (!ms) return;
    this.listT -= dt;
    if (this.listT <= 0) {
      this.listT = LIST_EVERY;
      this.list = safe(() => ms.markers(), []) || [];
    }
    const g = this.game;
    const canvas = g.renderer.canvas || g.canvas;
    const W = canvas?.clientWidth || window.innerWidth;
    const H = canvas?.clientHeight || window.innerHeight;
    let used = 0;
    let edge = null;
    for (const mk of this.list) {
      const e = mk.entity;
      if (e && (e.removed || e.dead)) continue;
      // Over the head; beside it while they are talking, so the mark never sits in a bubble.
      const talking = !!e && safe(() => g.bubbles?.hasBubble?.(e), false);
      const wx = e ? e.x + (talking ? 15 : 0) : mk.x;
      const wy = e ? e.y - (talking ? 22 : e.profile || e.id === 'lyra' ? 40 : 18) : mk.object ? mk.y - 30 : mk.y;
      const p = g.renderer.worldToCss(wx, wy);
      const inside = p.x > 8 && p.y > 8 && p.x < W - 8 && p.y < H - 8;
      if (!inside) {
        if (mk.kind === 'objective') edge = p;
        continue;
      }
      const el = this.el(used++);
      const cls = `mq-mark mq-${mk.kind}`;
      if (el.className !== cls) {
        el.className = cls;
        el.firstChild.textContent = mk.kind === 'offer' ? '!' : mk.kind === 'turnin' ? '?' : '';
      }
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
      if (el.hidden) el.hidden = false;
    }
    for (let i = used; i < this.pool.length; i++) if (!this.pool[i].hidden) this.pool[i].hidden = true;
    this.placeArrow(edge, W, H);
  }

  // An arrow at the screen's edge pointing toward an objective out of view.
  placeArrow(p, W, H) {
    if (!p) {
      if (!this.arrow.hidden) this.arrow.hidden = true;
      return;
    }
    const cx = W / 2;
    const cy = H / 2;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const pad = 34;
    const sx = dx ? (dx > 0 ? W - pad - cx : pad - cx) / dx : Infinity;
    const sy = dy ? (dy > 0 ? H - pad - cy : pad - cy) / dy : Infinity;
    const s = Math.min(Math.abs(sx), Math.abs(sy));
    const x = cx + dx * s;
    const y = cy + dy * s;
    const ang = Math.atan2(dy, dx);
    this.arrow.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) rotate(${ang.toFixed(3)}rad)`;
    if (this.arrow.hidden) this.arrow.hidden = false;
  }

  el(i) {
    while (this.pool.length <= i) {
      const el = h('div', { class: 'mq-mark', hidden: true }, h('span', { class: 'mq-glyph' }));
      this.layer.append(el);
      this.pool.push(el);
    }
    return this.pool[i];
  }
}

// ------------------------------------------------------------------ the journal

class Journal {
  constructor(game) {
    this.game = game;
    this.tab = 'active';
    this.panel = null;
  }

  isOpen() {
    return !!this.panel && !!this.game.ui?.stack?.includes(this.panel);
  }

  open(tab) {
    const ui = this.game.ui;
    if (!ui?.openModal) return;
    if (tab) this.tab = tab;
    if (this.isOpen()) {
      this.render();
      return;
    }
    const top = safe(() => ui.top?.(), null);
    if (top && top.id !== 'pause') safe(() => ui.closeModal(top, true));
    const panel = makePanel({ id: 'missions', title: 'Missions', subtitle: '', iconName: 'scroll', cls: 'panel-missions' });
    panel.pauses = true;
    this.panel = panel;
    this.tabsEl = h('div', { class: 'tabs mj-tabs', role: 'tablist' });
    this.tabBtns = {};
    for (const t of [
      ['active', 'Active'],
      ['available', 'New'],
      ['done', 'Done'],
    ]) {
      const b = h('button', { type: 'button', class: 'tab', role: 'tab', text: t[1], onclick: () => this.show(t[0]) });
      this.tabBtns[t[0]] = b;
      this.tabsEl.append(b);
    }
    panel.head.after(this.tabsEl);
    panel.foot.append(button('Close', { cls: 'btn-ember', onClick: () => ui.closeModal(panel) }));
    panel.onClose = () => {
      this.panel = null;
    };
    this.render();
    ui.openModal(panel);
  }

  show(tab) {
    this.tab = tab;
    this.render();
    safe(() => this.game.audio?.play?.('ui_click'));
  }

  render() {
    const ms = this.game.missions;
    const panel = this.panel;
    if (!ms || !panel) return;
    const j = ms.journal();
    panel.setTitle('Missions', `${j.counts.done} of ${j.counts.total} done`);
    const n = { active: j.active.length, available: j.available.length + j.board.length, done: j.completed.length };
    for (const [k, b] of Object.entries(this.tabBtns)) {
      b.classList.toggle('active', k === this.tab);
      b.setAttribute('aria-selected', String(k === this.tab));
      const label = { active: 'Active', available: 'New', done: 'Done' }[k];
      b.textContent = n[k] ? `${label} · ${n[k]}` : label;
    }
    const body = panel.body;
    const keep = body.scrollTop;
    clear(body);
    if (this.tab === 'active') this.renderActive(body, j);
    else if (this.tab === 'available') this.renderAvailable(body, j);
    else this.renderDone(body, j);
    body.scrollTop = keep;
  }

  renderActive(body, j) {
    const ms = this.game.missions;
    if (j.story) {
      const s = j.story;
      const tracked = ms.tracked === 'story' || !ms.tracked;
      body.append(
        h(
          'article',
          { class: `mj-card mj-story${tracked ? ' tracked' : ''}` },
          h(
            'div',
            { class: 'mj-row' },
            icon('flame', 'mj-ico'),
            h('div', { class: 'mj-head' }, h('div', { class: 'mj-kicker', text: "Maren's thread" }), h('h3', { class: 'mj-title', text: s.title })),
            h('div', { class: 'mj-side' }, tracked ? h('span', { class: 'mj-pill', text: 'On your HUD' }) : button('Track', { cls: 'btn-small', onClick: () => this.track('story') })),
          ),
          h('p', { class: 'mj-now', text: s.text }),
        ),
      );
    }
    if (!j.active.length) body.append(h('p', { class: 'empty', text: 'No errands yet. Villagers with a gold ! over their heads have work for you; the notice board in the square has more.' }));
    for (const c of j.active) body.append(this.card(c, { active: true }));
  }

  renderAvailable(body, j) {
    if (!j.available.length && !j.board.length && !j.upcoming.length) body.append(h('p', { class: 'empty', text: 'Nobody needs a hand right now. Come back after a night\'s sleep, or after the errands you have.' }));
    if (j.available.length) {
      body.append(h('h3', { class: 'mj-section', text: 'Someone needs a hand' }));
      for (const c of j.available) body.append(this.card(c, { offer: true }));
    }
    if (j.board.length) {
      body.append(h('h3', { class: 'mj-section', text: 'On the notice board' }));
      for (const c of j.board) body.append(this.card(c, { offer: true }));
    }
    if (j.upcoming.length) {
      body.append(h('h3', { class: 'mj-section', text: 'Later' }));
      for (const c of j.upcoming) body.append(h('div', { class: 'mj-later' }, h('strong', { text: c.giverName }), ` may have work ${c.why || 'later'}.`));
    }
  }

  renderDone(body, j) {
    if (!j.completed.length) {
      body.append(h('p', { class: 'empty', text: 'Nothing finished yet.' }));
      return;
    }
    for (const c of j.completed.slice().reverse()) {
      body.append(
        h('div', { class: 'mj-done' }, this.portrait(c.giver), h('div', { class: 'mj-done-text' }, h('strong', { text: c.title }), h('span', { class: 'mj-dim', text: ` · ${c.giverName}` }), h('div', { class: 'mj-rewards' }, ...c.rewards.map((r) => this.chip(r))))),
      );
    }
  }

  portrait(giver) {
    const g = this.game;
    if (giver === 'board') return h('div', { class: 'mj-portrait mj-board' }, icon('scroll'));
    const url = safe(() => portraitUrl(g, giver === 'lyra' ? 'lyra' : giver, 'neutral'), '');
    return url ? h('img', { class: 'mj-portrait', src: url, alt: '' }) : h('div', { class: 'mj-portrait' }, icon('people'));
  }

  chip(r) {
    if (r.kind === 'magic') {
      const hue = essenceHue(this.game, r.magic);
      return h('span', { class: 'mj-chip mj-chip-magic', style: { '--hue': hue }, title: r.line || '' }, h('i', { class: 'mj-dot' }), r.text);
    }
    return h('span', { class: `mj-chip mj-chip-${r.kind}` }, r.text);
  }

  card(c, { active = false, offer = false } = {}) {
    const ms = this.game.missions;
    const el = h('article', { class: `mj-card${c.tracked ? ' tracked' : ''}${c.status === 'ready' ? ' ready' : ''}` });
    el.append(
      h(
        'div',
        { class: 'mj-row' },
        this.portrait(c.giver),
        h('div', { class: 'mj-head' }, h('div', { class: 'mj-kicker', text: c.giver === 'board' ? 'Notice board' : c.giverName }), h('h3', { class: 'mj-title', text: c.title })),
      ),
    );
    if (offer && c.board) el.append(h('blockquote', { class: 'mj-notice', text: c.board }));
    else el.append(h('p', { class: 'mj-summary', text: c.summary }));
    if (active) {
      const list = h('ol', { class: 'mj-objs' });
      for (const o of c.objectives) {
        list.append(h('li', { class: o.done ? 'done' : o.current ? 'current' : '' }, h('span', { class: 'mj-check', text: o.done ? '✓' : o.current ? '◆' : '·' }), h('span', { text: o.label }), o.progress ? h('span', { class: 'mj-prog', text: o.progress }) : null, o.when && o.current ? h('span', { class: 'mj-when', text: o.when }) : null));
      }
      if (c.status === 'ready') list.append(h('li', { class: 'current' }, h('span', { class: 'mj-check', text: '◆' }), h('span', { text: c.turnTo ? `Return to ${c.turnTo}` : 'Done' })));
      el.append(list);
      if (c.lyra && c.lyra !== 'unasked') {
        const nm = ms.giverName('lyra');
        const t = c.lyra === 'coming' ? `${nm} is coming with you.` : c.lyra === 'conditions' ? `${nm} will come, on her terms${c.lyraWhy ? `: ${c.lyraWhy}` : '.'}` : c.lyra === 'declined' ? `${nm} won't come on this one${c.lyraWhy ? `: "${c.lyraWhy}"` : '.'}` : `${nm} isn't with you.`;
        el.append(h('p', { class: `mj-lyra mj-lyra-${c.lyra}`, text: t }));
      }
    } else if (offer && !c.canAccept) {
      el.append(h('p', { class: 'mj-where', text: c.hint || `Find ${c.giverName}.` }));
    }
    el.append(h('div', { class: 'mj-rewards' }, ...c.rewards.map((r) => this.chip(r))));
    const actions = h('div', { class: 'mj-actions' });
    if (active) {
      if (c.tracked) actions.append(h('span', { class: 'mj-pill', text: 'On your HUD' }));
      else actions.append(button('Track', { cls: 'btn-small', onClick: () => this.track(c.id) }));
      actions.append(button('Set aside', { cls: 'btn-small btn-ghost', onClick: () => this.abandon(c) }));
    } else if (offer && c.canAccept) {
      actions.append(button(c.giver === 'board' ? 'Take the notice' : 'Yes', { cls: 'btn-small btn-ember', onClick: () => this.accept(c.id) }));
    }
    if (actions.childNodes.length) el.append(actions);
    return el;
  }

  track(id) {
    this.game.missions?.track(id);
    this.render();
    safe(() => this.game.ui?.hud?.refreshMission?.(true));
  }

  accept(id) {
    if (this.game.missions?.accept(id)) {
      this.tab = 'active';
      this.render();
    }
  }

  abandon(c) {
    const ui = this.game.ui;
    const run = () => {
      this.game.missions?.abandon(c.id);
      this.render();
    };
    if (typeof ui?.confirm !== 'function') return run();
    ui.confirm({ title: `Set aside "${c.title}"?`, text: `Your progress on it is lost. ${c.giverName} will still have it for you.`, yes: 'Set it aside', no: 'Keep it' }).then((yes) => yes && run());
  }
}

export function openJournal(game, tab) {
  if (!game) return;
  if (!game._missionsJournal) game._missionsJournal = new Journal(game);
  game._missionsJournal.open(tab);
}

// ------------------------------------------------------------------ the notice board

function decorateBoard(game) {
  const ms = game.missions;
  const ui = game.ui;
  const b = game.objects?.get?.('notice_board');
  const p = game.player;
  if (!ms || !ui || !b || !p || Math.hypot(b.x - p.x, b.y - p.y) > 72) return;
  const panel = ui.stack?.find?.((x) => x.id === 'sign');
  if (!panel || panel._missions) return;
  panel._missions = true;
  const fill = () => {
    clear(box);
    const j = ms.journal();
    box.append(h('h3', { class: 'mj-section', text: 'Pinned this week' }));
    if (!j.board.length) box.append(h('p', { class: 'empty', text: 'Nothing new pinned up. Pip\'s notices come and go.' }));
    for (const c of j.board) {
      box.append(
        h('div', { class: 'mj-card mj-board-card' }, h('blockquote', { class: 'mj-notice', text: c.board }), h('div', { class: 'mj-rewards' }, ...c.rewards.map((r) => h('span', { class: 'mj-chip', text: r.text }))), h('div', { class: 'mj-actions' }, button('Take the notice', { cls: 'btn-small btn-ember', onClick: () => {
          ms.accept(c.id);
          fill();
        } }))),
      );
    }
  };
  const box = h('section', { class: 'mj-board-box' });
  fill();
  // The village's pinned errands come first; the old notices follow.
  panel.body.prepend(box);
}

// ------------------------------------------------------------------ reveals

const queue = [];
let showing = false;

function essenceHue(game, magic) {
  if (!magic) return '#a995ff';
  const reg = game?.magic?.registry || game?.magic?.registries;
  if (magic.kind === 'essence') {
    const e = reg?.essences?.[magic.id] || reg?.essences?.get?.(magic.id);
    return e?.palette?.core || ESSENCE_HUE[magic.id] || '#a995ff';
  }
  return magic.kind === 'twist' ? '#ffe08a' : '#ddd2ff';
}

function queueReveal(game, r) {
  queue.push(r);
  if (!showing) nextReveal(game);
}

// A reveal waits while a panel covers the game (the journal, the inventory, a scene);
// over a villager's dialog it shows at once, since that is where the reward came from.
function covered(game) {
  const stack = game.ui?.stack || [];
  const top = stack[stack.length - 1];
  if (safe(() => game.story?.isPlaying?.(), false)) return true;
  return !!top && !/dialog|sign/.test(String(top.id || ''));
}

function nextReveal(game) {
  if (!queue.length) {
    showing = false;
    return;
  }
  showing = true;
  if (covered(game)) {
    setTimeout(() => nextReveal(game), 500);
    return;
  }
  const r = queue.shift();
  const root = game.ui?.root || game.uiRoot;
  let title;
  let name;
  let line;
  let hue;
  if (r.slot) {
    title = 'Room in your weaving';
    name = r.slot === 'weave' ? 'A new weave slot' : r.slot === 'essence' ? 'A third essence' : 'Another twist';
    line = r.slot === 'weave' ? 'One more weave ready at your hands.' : r.slot === 'essence' ? 'A weave can hold three essences now.' : 'A weave can carry one more twist.';
    hue = '#ffe08a';
  } else {
    const w = componentWords(r.kind, r.id);
    title = r.kind === 'shape' ? 'You can weave a new shape' : r.kind === 'essence' ? 'You can weave a new essence' : 'Your weaving learns a twist';
    name = componentLabel(r.kind, r.id, game);
    line = w.name && w.name.toLowerCase() !== name.toLowerCase() ? `${w.name}: ${w.line}.` : `${w.line.charAt(0).toUpperCase()}${w.line.slice(1)}.`;
    hue = essenceHue(game, r);
  }
  const openBook = spellbookOpener(game);
  const card = h(
    'div',
    { class: 'mq-reveal', role: 'status', style: { '--hue': hue } },
    h('div', { class: 'mq-glyph-ring' }, h('div', { class: 'mq-glyph-core' })),
    h('div', { class: 'mq-reveal-text' }, h('div', { class: 'mq-reveal-kicker', text: title }), h('div', { class: 'mq-reveal-name', text: name }), h('div', { class: 'mq-reveal-line', text: line })),
    openBook ? button('Spellbook', { cls: 'btn-small btn-ember mq-reveal-btn', onClick: (ev) => {
      ev.stopPropagation();
      done();
      openBook();
    } }) : null,
  );
  let gone = false;
  const done = () => {
    if (gone) return;
    gone = true;
    card.classList.add('out');
    setTimeout(() => {
      card.remove();
      nextReveal(game);
    }, 260);
  };
  card.addEventListener('click', done);
  const layer = root.querySelector?.('.layer-toasts') || root;
  layer.append(card);
  safe(() => game.audio?.play?.('levelup', { volume: 0.7 }));
  const pl = game.player;
  if (pl) safe(() => game.particles?.emit?.('levelup', pl.x, pl.y - 8, { count: 30 }));
  setTimeout(done, queue.length ? 3600 : 4800);
}

function spellbookOpener(game) {
  const ui = game.ui;
  const fn = ui?.openSpellbook || ui?.spellbook?.open || game.spellbook?.open;
  if (typeof fn !== 'function') return null;
  const self = fn === ui?.openSpellbook ? ui : fn === ui?.spellbook?.open ? ui.spellbook : game.spellbook;
  return () => safe(() => fn.call(self));
}

// ------------------------------------------------------------------ styles

const CSS = `
.mq-layer { z-index: 1; overflow: hidden; }
.mq-mark { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; will-change: transform; }
.mq-mark .mq-glyph { position: absolute; left: -9px; top: -24px; width: 18px; height: 22px; display: grid; place-items: center;
  font-family: var(--font-display); font-weight: 700; font-size: 17px; line-height: 1; color: #2a1a05;
  background: linear-gradient(180deg, #ffe9a3, #e4b83d 70%, #b8862a); border: 2px solid #1a1423; border-radius: 3px;
  box-shadow: 0 0 0 1px rgba(255,233,163,.35), 0 0 12px rgba(255,200,90,.55), 0 3px 0 rgba(10,8,25,.45);
  animation: mq-bob 1.4s ease-in-out infinite; }
.mq-turnin .mq-glyph { background: linear-gradient(180deg, #fff6cf, #ffd86b 70%, #d9a43a); }
.mq-objective .mq-glyph { left: -8px; top: -20px; width: 14px; height: 14px; transform: rotate(45deg); border-radius: 2px;
  background: radial-gradient(circle at 40% 35%, #fff6d6, #ffcf5c 55%, #e08a2a); animation: mq-pulse 1.2s ease-in-out infinite; }
.mq-objective::after { content: ''; position: absolute; left: -16px; top: -4px; width: 32px; height: 10px; border-radius: 50%;
  border: 2px solid rgba(255, 207, 92, .7); animation: mq-ring 1.6s ease-out infinite; }
@keyframes mq-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes mq-pulse { 0%,100% { transform: rotate(45deg) scale(1); } 50% { transform: rotate(45deg) scale(1.18); } }
@keyframes mq-ring { from { transform: scale(.4); opacity: .9; } to { transform: scale(1.6); opacity: 0; } }
.mq-edge { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; will-change: transform; }
.mq-edge-tip { position: absolute; left: -14px; top: -11px; width: 0; height: 0; border-top: 11px solid transparent; border-bottom: 11px solid transparent;
  border-left: 22px solid #ffcf5c; filter: drop-shadow(0 0 0 #1a1423) drop-shadow(1px 0 0 #1a1423) drop-shadow(-1px 0 0 #1a1423) drop-shadow(0 1px 0 #1a1423) drop-shadow(0 0 6px rgba(255,200,90,.7));
  animation: mq-nudge 1s ease-in-out infinite; }
@keyframes mq-nudge { 0%,100% { margin-left: 0; } 50% { margin-left: 4px; } }
@media (prefers-reduced-motion: reduce) { .mq-mark .mq-glyph, .mq-objective::after, .mq-edge-tip { animation: none; } }

.panel-missions { width: min(620px, 100%); height: min(720px, 100%); }
.panel-missions .panel-body { padding-top: 12px; }
.mj-section { margin: 14px 0 8px; font-family: var(--font-display); font-size: var(--fs-s); color: var(--parch-dim); letter-spacing: .06em; text-transform: uppercase; }
.mj-section:first-child { margin-top: 0; }
.mj-card { position: relative; margin: 0 0 10px; padding: 10px 12px; background: var(--card-bg); border: 2px solid var(--line-dim); box-shadow: 0 2px 0 var(--outline); }
.mj-card.tracked { border-color: var(--gold); box-shadow: 0 0 0 1px rgba(228,184,61,.3), 0 2px 0 var(--outline); }
.mj-card.ready { border-color: var(--heal); }
.mj-row { display: flex; align-items: center; gap: 10px; }
.mj-portrait { width: 40px; height: 40px; flex: none; image-rendering: pixelated; background: var(--ink-2); border: 2px solid var(--outline); display: grid; place-items: center; }
.mj-board { background: #5b4127; }
.mj-ico { --isc: 3; flex: none; }
.mj-head { min-width: 0; flex: 1; }
.mj-side { flex: none; margin-left: auto; }
.mj-side .btn { min-height: 44px; }
.mj-kicker { font-size: var(--fs-xs); color: var(--parch-faint); }
.mj-title { margin: 0; font-family: var(--font-display); font-size: var(--fs-m, 17px); color: var(--ember-hot); line-height: 1.15; }
.mj-summary, .mj-now, .mj-where { margin: 8px 0 6px; color: var(--parch-2); line-height: 1.35; }
.mj-where { color: var(--parch-dim); font-style: italic; }
.mj-notice { margin: 8px 0; padding: 8px 10px; background: #e9dcc0; color: #3a2a1a; font-family: var(--font-body); border-left: 4px solid #8c5a35; transform: rotate(-.4deg); box-shadow: 0 2px 0 rgba(0,0,0,.3); }
.mj-objs { list-style: none; margin: 8px 0; padding: 0; display: grid; gap: 4px; }
.mj-objs li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; color: var(--parch-dim); }
.mj-objs li.current { color: var(--parch); }
.mj-objs li.done { color: var(--parch-faint); text-decoration: line-through; text-decoration-color: rgba(185,173,153,.5); }
.mj-check { width: 14px; flex: none; text-align: center; color: var(--gold); }
.mj-objs li.done .mj-check { color: var(--heal); }
.mj-prog { font-family: var(--font-display); color: var(--ember-hot); }
.mj-when { font-size: var(--fs-xs); color: var(--sky); }
.mj-lyra { margin: 4px 0 6px; font-size: var(--fs-s); color: var(--arcane-pale); }
.mj-lyra-declined { color: var(--parch-dim); }
.mj-rewards { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.mj-chip { padding: 2px 8px; font-size: var(--fs-xs); background: var(--ink-3); border: 1px solid var(--line-soft); color: var(--parch-2); white-space: nowrap; }
.mj-chip-magic { --hue: #a995ff; border-color: var(--hue); color: var(--parch); background: color-mix(in srgb, var(--hue) 18%, var(--ink-2)); }
.mj-dot { display: inline-block; width: 7px; height: 7px; margin-right: 5px; border-radius: 50%; background: var(--hue); box-shadow: 0 0 6px var(--hue); vertical-align: 1px; }
.mj-chip-mana { border-color: var(--arcane-deep); color: var(--arcane-pale); }
.mj-chip-slot { border-color: var(--gold); color: var(--ember-hot); }
.mj-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 8px; }
.mj-actions .btn { min-height: 44px; }
.mj-pill { font-size: var(--fs-xs); color: var(--gold); padding: 2px 8px; border: 1px solid rgba(228,184,61,.5); }
.mj-later { margin: 4px 0; color: var(--parch-faint); font-size: var(--fs-s); }
.mj-done { display: flex; gap: 10px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--line-dim); }
.mj-done .mj-portrait { width: 32px; height: 32px; }
.mj-dim { color: var(--parch-faint); font-size: var(--fs-s); }
.mj-board-box { margin-bottom: 14px; border-bottom: 2px solid var(--line-dim); padding-bottom: 4px; }

.mq-reveal { --hue: #a995ff; position: absolute; left: 50%; top: max(18%, calc(env(safe-area-inset-top, 0px) + 64px)); transform: translateX(-50%);
  display: flex; align-items: center; gap: 14px; width: min(420px, calc(100% - 32px)); padding: 12px 14px; pointer-events: auto; cursor: pointer;
  background: linear-gradient(180deg, rgba(36,40,89,.97), rgba(19,18,50,.97)); border: 2px solid var(--hue);
  box-shadow: 0 0 0 2px var(--outline), 0 0 28px color-mix(in srgb, var(--hue) 55%, transparent), 0 6px 0 rgba(5,3,14,.5);
  animation: mq-reveal-in .42s cubic-bezier(.2,1.4,.4,1); }
.mq-reveal.out { animation: mq-reveal-out .26s ease-in forwards; }
@keyframes mq-reveal-in { from { opacity: 0; transform: translateX(-50%) translateY(-14px) scale(.9); } }
@keyframes mq-reveal-out { to { opacity: 0; transform: translateX(-50%) translateY(-8px) scale(.96); } }
.mq-glyph-ring { position: relative; flex: none; width: 54px; height: 54px; border-radius: 50%; border: 2px solid var(--hue);
  background: radial-gradient(circle, color-mix(in srgb, var(--hue) 45%, transparent), transparent 70%); animation: mq-spin 6s linear infinite; }
.mq-glyph-ring::before, .mq-glyph-ring::after { content: ''; position: absolute; inset: 7px; border: 2px dashed color-mix(in srgb, var(--hue) 70%, white); border-radius: 50%; }
.mq-glyph-ring::after { inset: 15px; border-style: solid; transform: rotate(45deg); border-radius: 3px; }
.mq-glyph-core { position: absolute; inset: 21px; border-radius: 50%; background: #fff; box-shadow: 0 0 12px 4px var(--hue); }
@keyframes mq-spin { to { transform: rotate(360deg); } }
.mq-reveal-text { min-width: 0; flex: 1; }
.mq-reveal-kicker { font-size: var(--fs-xs); color: var(--parch-dim); letter-spacing: .08em; text-transform: uppercase; }
.mq-reveal-name { font-family: var(--font-display); font-size: 24px; line-height: 1.1; color: #fff; text-shadow: 0 0 10px var(--hue), 0 2px 0 var(--outline); }
.mq-reveal-line { font-size: var(--fs-s); color: var(--parch-2); line-height: 1.3; }
.mq-reveal-btn { flex: none; min-height: 44px; }
@media (max-width: 520px) { .mq-reveal { gap: 10px; padding: 10px; } .mq-glyph-ring { width: 44px; height: 44px; } .mq-glyph-core { inset: 16px; } .mq-reveal-name { font-size: 20px; } }
@media (max-height: 520px) {
  .mq-reveal { top: calc(env(safe-area-inset-top, 0px) + 54px); }
  .panel-missions { height: 100%; }
  .panel-missions .panel-foot { display: none; }
  .panel-missions .panel-body { padding-top: 8px; }
  .mj-card { padding: 8px 10px; margin-bottom: 8px; }
  .mj-summary, .mj-now, .mj-where { margin: 4px 0; }
  .mj-portrait { width: 32px; height: 32px; }
}
@media (prefers-reduced-motion: reduce) { .mq-reveal, .mq-glyph-ring { animation: none; } }
`;
