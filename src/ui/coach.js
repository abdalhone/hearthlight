// The magic lessons (the author: "it's not clear how to switch and like craft and
// stuff"). Short guided steps that point at the real controls, one at a time: a ring
// around the control and a card with a line or two. The control under the ring still
// works — the lesson waits for the player to really do the thing (cast, open the
// Spellbook) or to tap "Got it". Each lesson runs once, the first time it is
// relevant; How to play replays them; "Skip" ends one.
//
//   cast  — in play, with a weave on a button, when a foe is in sight (or after a
//           while in the world): cast (tap / drag to aim), mana, what the buttons are,
//           where weaves are made.
//   book  — the first time the Spellbook opens: your weaves, then steps 1–3, saving.
//   found — the first new piece found (a shape, an essence, a twist, a price): where
//           to put it to use.
//
// Lessons are kept per device (localStorage), like the other first-time hints.

import { h, setText } from './dom.js';

const KEY = 'hearthlight.coach.';
const LESSONS = ['cast', 'book', 'found'];
const CAST_AFTER = 25; // seconds in the world before the casting lesson starts anyway
const FOE_RANGE = 150; // world px: a foe this close is "in sight" for the lesson
const HURT_QUIET = 8; // s after a person strikes the player before a lesson shows

function readDone(id) {
  try {
    return window.localStorage?.getItem(KEY + id) === '1';
  } catch {
    return false;
  }
}

function saveDone(id, on = true) {
  try {
    if (on) window.localStorage?.setItem(KEY + id, '1');
    else window.localStorage?.removeItem(KEY + id);
  } catch {
    /* private mode: shown again next visit */
  }
}

function visible(el) {
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return null;
  for (let p = el; p && p !== document.body; p = p.parentElement) {
    if (p.hidden) return null;
    const cs = getComputedStyle(p);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
  }
  return r;
}

// Pure: where the card goes beside a target box, inside the view. Prefers above the
// target when there is room for the card, else below, else the roomier side; always
// clamped inside the view with `pad`.
export function placeCard(target, card, view, pad = 10, gap = 14) {
  const w = Math.min(card.w, view.w - pad * 2);
  let x = target ? target.x + target.w / 2 - w / 2 : (view.w - w) / 2;
  x = Math.max(pad, Math.min(view.w - pad - w, x));
  if (!target) return { x, y: Math.round((view.h - card.h) / 2), w, side: 'center' };
  const above = target.y - gap - card.h;
  const below = target.y + target.h + gap;
  let y;
  let side;
  if (above >= pad && (target.y > view.h / 2 || below + card.h > view.h - pad)) {
    y = above;
    side = 'above';
  } else if (below + card.h <= view.h - pad) {
    y = below;
    side = 'below';
  } else {
    // Neither fits whole: beside it, on the roomier side, as narrow as that side is
    // (never over the thing it points at); with no room either side, at the screen's
    // edge farther from it.
    const roomL = target.x - gap - pad;
    const roomR = view.w - pad - (target.x + target.w + gap);
    side = roomL >= roomR ? 'left' : 'right';
    const room = Math.max(roomL, roomR);
    if (room >= 180) {
      const bw = Math.min(w, room);
      y = Math.max(pad, Math.min(view.h - pad - card.h, target.y + target.h / 2 - card.h / 2));
      x = side === 'left' ? target.x - gap - bw : target.x + target.w + gap;
      return { x: Math.round(x), y: Math.round(Math.max(pad, y)), w: Math.round(bw), side };
    }
    side = target.y + target.h / 2 > view.h / 2 ? 'top' : 'bottom';
    y = side === 'top' ? pad : view.h - pad - card.h;
  }
  return { x: Math.round(x), y: Math.round(Math.max(pad, y)), w, side };
}

export class Coach {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.lesson = null; // { id, steps, i }
    this.playT = 0;
    this.foundKind = null;
    this.el = null;
    this.forced = new Set(); // lessons replayed from How to play
    this.done = {};
    for (const id of LESSONS) this.done[id] = typeof window !== 'undefined' ? readDone(id) : false;
  }

  build() {
    this.ring = h('div', { class: 'coach-ring', 'aria-hidden': 'true' });
    this.stepEl = h('span', { class: 'coach-step num' });
    this.textEl = h('p', { class: 'coach-text' });
    this.nextBtn = h('button', { type: 'button', class: 'btn btn-ember btn-small coach-next', text: 'Got it' });
    this.skipBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-small coach-skip', text: 'Skip lesson' });
    this.nextBtn.addEventListener('click', () => this.next());
    this.skipBtn.addEventListener('click', () => this.skip());
    this.card = h('div', { class: 'coach-card', role: 'dialog', 'aria-live': 'polite', 'aria-label': 'A lesson' }, h('div', { class: 'coach-head' }, h('span', { class: 'coach-title', text: 'Magic' }), this.stepEl), this.textEl, h('div', { class: 'coach-btns' }, this.skipBtn, this.nextBtn));
    this.el = h('div', { class: 'coach', hidden: true }, this.ring, this.card);
    return this.el;
  }

  bind() {
    const bus = this.game.bus;
    if (!bus?.on) return;
    bus.on('spell_cast', (p) => {
      if (p?.caster && p.caster === this.game.player) this.event('cast');
    });
    bus.on('ui_open', (p) => {
      if (p?.panel === 'spellbook') {
        this.event('spellbook');
        // The book's own lesson, the first time it opens (after the casting one).
        if (!this.done.book || this.forced.has('book')) setTimeout(() => this.start('book'), 350);
      }
    });
    bus.on('magic_unlocked', (p) => {
      const k = String(p?.kind || '');
      if (!['shape', 'essence', 'twist', 'price'].includes(k) || this.done.found) return;
      if (p?.id === 'raw' || p?.source === 'trial') return;
      this.foundKind = { kind: k, id: p?.id };
    });
    bus.on('game_start', () => {
      this.playT = 0;
    });
  }

  get weaving() {
    return this.ui.hud?.weaving || null;
  }

  isActive() {
    return !!this.lesson;
  }

  // Replay every lesson (How to play): they start again as they become relevant; the
  // casting one starts right away once back in the world.
  replay() {
    for (const id of LESSONS) {
      this.done[id] = false;
      saveDone(id, false);
      this.forced.add(id);
    }
    this.stop();
    this.playT = CAST_AFTER;
  }

  // ---------- the lessons ----------

  steps(id) {
    const touch = !!this.ui.isTouch;
    const w = this.weaving;
    const g = this.game;
    const first = () => {
      if (!w) return null;
      const n = w.slotCount();
      for (let i = 0; i < n; i++) if (w.weaveAt(i)) return { i, name: w.slotInfo(i).name || 'your weave' };
      return null;
    };
    const fw = first();
    const name = fw?.name || 'your weave';
    const weaveBtn = () => (touch ? document.querySelector(`.tcluster .wbtn[data-slot="${fw?.i ?? 0}"]:not([hidden])`) : document.querySelector('.hotbar:not([hidden]) .hslot:not([hidden])'));
    if (id === 'cast') {
      return [
        {
          target: weaveBtn,
          text: touch ? `This round button is a weave: ${name}. Tap it to cast it at the nearest foe.` : `This is a weave: ${name}. Press 1 to cast it toward the mouse (or right-click).`,
          wait: 'cast',
          button: 'Next',
        },
        {
          target: weaveBtn,
          text: touch ? 'To aim, drag from the button and let go. Drag back onto it to cancel.' : 'Aim with the mouse: weaves fly where it points.',
          wait: touch ? 'cast' : null,
          button: touch ? 'Next' : 'Got it',
        },
        {
          target: () => document.querySelector('.player-card .meter-mana'),
          text: touch ? 'Each cast costs mana: the blue bar (the number on a button is its cost). It fills up again by itself.' : 'Each cast costs mana: the blue bar. It fills up again by itself.',
        },
        {
          target: () => (touch ? document.querySelector('.tcluster .wslots') : document.querySelector('.hotbar .hb-row')),
          box: touch ? () => this.clusterBox() : null,
          text: touch ? 'Each round button is one weave, with its name on it. No switching: tap the one you want.' : 'Keys 1–4 cast your weaves; the lit one is what the right mouse button casts.',
        },
        {
          target: () => (touch ? document.querySelector('.tcluster .wbtn.empty:not([hidden])') || document.querySelector('.hud-menu') : document.querySelector('.hotbar .hslot.empty:not([hidden])') || document.querySelector('.hud-menu')),
          text: touch ? 'Make your own weaves in the Spellbook: tap + New (or Menu → Spellbook).' : 'Make your own weaves in the Spellbook: press B, click an empty slot, or Menu → Spellbook.',
          wait: 'spellbook',
          button: 'Later',
        },
      ];
    }
    if (id === 'book') {
      return [
        {
          target: () => document.querySelector('.panel-spellbook .sb-tabs'),
          text: 'These are your weaves (they are your weave buttons). Tap one to change it, or a New one to make another.',
        },
        {
          target: () => document.querySelector('.panel-spellbook .sb-sec-shapes'),
          scroll: true,
          text: '① Pick a shape: how it flies or lands — a bolt, a blast, a ring… Tap one.',
          wait: 'saved',
        },
        {
          target: () => document.querySelector('.panel-spellbook .sb-sec-essences'),
          scroll: true,
          text: '② Add an essence: what it is made of — fire burns, frost slows. You find more by helping people in Hearthvale.',
        },
        {
          target: () => document.querySelector('.panel-spellbook .sb-sec-twists'),
          scroll: true,
          text: '③ Twists change how it behaves: faster, bouncing, splitting…',
        },
        {
          target: () => document.querySelector('.panel-spellbook .sb-foot-note') || document.querySelector('.panel-spellbook .sb-done'),
          text: 'Every change is saved at once, straight onto your weave buttons. Tap Done to play.',
          button: 'Got it',
        },
      ];
    }
    if (id === 'found') {
      const f = this.foundKind || {};
      const label = { shape: 'a new shape', essence: 'a new essence', twist: 'a new twist', price: 'a new price' }[f.kind] || 'something new';
      let nm = '';
      try {
        const k = { shape: 'shapes', essence: 'essences', twist: 'twists', price: 'prices' }[f.kind];
        nm = (k === 'prices' ? g.magic?.registry?.prices?.get?.(f.id)?.name : w?.info?.(k, f.id)?.name) || '';
      } catch {
        nm = '';
      }
      return [
        {
          target: () => document.querySelector('.hud-menu'),
          text: `You found ${label}${nm ? `: ${nm}` : ''}! Put it in a weave: Menu → Spellbook${touch ? ', or tap + New' : ' (B)'}.`,
          button: 'Got it',
          action: { label: 'Spellbook', run: () => this.ui.openSpellbook?.() },
        },
      ];
    }
    return [];
  }

  // Is now a good moment for a world lesson? Playing, nothing open, no cutscene, not
  // fallen, the HUD showing.
  calm() {
    const g = this.game;
    const ui = this.ui;
    if (g.state !== 'playing' || ui.stack?.length || ui.chat?.isOpen?.() || ui.hud?.el?.hidden) return false;
    if (g.player?.downed) return false;
    try {
      if (g.story?.isPlaying?.()) return false;
    } catch {
      /* no story */
    }
    if (ui.root?.classList.contains('cs-active')) return false;
    if (this.hurtByPerson()) return false;
    return true;
  }

  // A person (Lyra, a guard, a villager; not a creature) struck the player just now: a
  // fight like that is no time for a lesson. Its card would cover the fight, and "cast at
  // the nearest foe" would teach the wrong thing. A creature's attack is the lesson's
  // moment (a foe in sight), so that one does not count.
  hurtByPerson() {
    const g = this.game;
    const p = g.player;
    const who = p?.lastAttacker;
    const at = p?.lastAttackedAt;
    if (!who || who === p || who.species || !Number.isFinite(at)) return false;
    // Stamped with the game clock (or, in older paths, the real-time clock): accept either.
    const near = (now) => Number.isFinite(now) && now - at >= 0 && now - at < HURT_QUIET;
    return near(g.clock?.t) || near(g.time);
  }

  foeInSight() {
    const g = this.game;
    const p = g.player;
    const w = this.weaving;
    if (!p || !w?.nearestFoe) return false;
    try {
      return !!w.nearestFoe(p.x, p.y, 1, 0, FOE_RANGE);
    } catch {
      return false;
    }
  }

  start(id) {
    if (this.lesson || (this.done[id] && !this.forced.has(id))) return false;
    const steps = this.steps(id);
    if (!steps.length) return false;
    this.lesson = { id, steps, i: 0 };
    this.el.hidden = false;
    this.el.dataset.lesson = id;
    this.show();
    this.game.audio?.play?.('ui_open', { volume: 0.6 });
    return true;
  }

  finish(skipped = false) {
    const l = this.lesson;
    if (!l) return;
    this.done[l.id] = true;
    this.forced.delete(l.id);
    saveDone(l.id);
    if (l.id === 'found') this.foundKind = null;
    this.stop();
    if (!skipped) this.game.audio?.play?.('quest', { volume: 0.4 });
  }

  stop() {
    this.lesson = null;
    if (this.el) {
      this.el.hidden = true;
      delete this.el.dataset.lesson;
    }
  }

  skip() {
    this.finish(true);
  }

  next() {
    const l = this.lesson;
    if (!l) return;
    const step = l.steps[l.i];
    if (step?.action && this.actionNext) {
      this.actionNext = false;
      step.action.run();
    }
    l.i++;
    if (l.i >= l.steps.length) this.finish();
    else this.show();
  }

  // Something the lesson may be waiting for happened ('cast', 'spellbook').
  event(kind) {
    const l = this.lesson;
    if (!l) return;
    const step = l.steps[l.i];
    if (step?.wait === kind) {
      // A beat, so the cast (or the book opening) is seen before the next line.
      clearTimeout(this.waitT);
      const at = l.i;
      this.waitT = setTimeout(() => {
        if (this.lesson === l && l.i === at) this.next();
      }, kind === 'cast' ? 700 : kind === 'saved' ? 500 : 0);
    }
  }

  show() {
    const l = this.lesson;
    if (!l) return;
    const step = l.steps[l.i];
    setText(this.textEl, step.text);
    setText(this.stepEl, l.steps.length > 1 ? `${l.i + 1} / ${l.steps.length}` : '');
    setText(this.nextBtn, step.button || (l.i === l.steps.length - 1 ? 'Got it' : 'Next'));
    this.actionNext = false;
    if (step.action) {
      // "Spellbook" opens it; "Got it" only closes the card.
      if (!this.actionBtn) {
        this.actionBtn = h('button', { type: 'button', class: 'btn btn-small coach-action' });
        this.actionBtn.addEventListener('click', () => {
          const s = this.lesson?.steps[this.lesson.i];
          this.finish();
          s?.action?.run();
        });
      }
      setText(this.actionBtn, step.action.label);
      this.nextBtn.before(this.actionBtn);
    } else this.actionBtn?.remove();
    this.skipBtn.hidden = l.steps.length < 2;
    toggleWaiting(this.card, !!step.wait);
    if (step.scroll) {
      const t = step.target?.();
      try {
        t?.scrollIntoView?.({ block: 'center', behavior: this.ui.reduceMotion ? 'auto' : 'smooth' });
      } catch {
        /* old browsers */
      }
    }
    this.place();
  }

  // The thumb cluster's weave buttons, as one box.
  clusterBox() {
    const list = [...document.querySelectorAll('.tcluster .wbtn:not([hidden])')].map((b) => b.getBoundingClientRect()).filter((r) => r.width);
    if (!list.length) return null;
    const x0 = Math.min(...list.map((r) => r.left));
    const y0 = Math.min(...list.map((r) => r.top));
    const x1 = Math.max(...list.map((r) => r.right));
    const y1 = Math.max(...list.map((r) => r.bottom));
    return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 + 14 };
  }

  place() {
    const l = this.lesson;
    if (!l || !this.el) return;
    const step = l.steps[l.i];
    const root = this.ui.root;
    const rb = root.getBoundingClientRect();
    let r = null;
    try {
      r = (step.box && step.box()) || visible(step.target?.());
    } catch {
      r = null;
    }
    const pad = 6;
    if (r) {
      const st = this.ring.style;
      st.display = '';
      st.left = `${Math.round(r.left - rb.left - pad)}px`;
      st.top = `${Math.round(r.top - rb.top - pad)}px`;
      st.width = `${Math.round(r.width + pad * 2)}px`;
      st.height = `${Math.round(r.height + pad * 2)}px`;
    } else this.ring.style.display = 'none';
    const cw = Math.min(330, rb.width - 20);
    this.card.style.width = `${cw}px`;
    let ch = this.card.offsetHeight || 120;
    const tbox = r ? { x: r.left - rb.left - pad, y: r.top - rb.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 } : null;
    let at = placeCard(tbox, { w: cw, h: ch }, { w: rb.width, h: rb.height });
    if (at.w !== cw) {
      // A narrower card beside the target: measure its new height and place it again.
      this.card.style.width = `${at.w}px`;
      ch = this.card.offsetHeight || ch;
      at = placeCard(tbox, { w: at.w, h: ch }, { w: rb.width, h: rb.height });
    }
    this.card.style.width = `${at.w}px`;
    this.card.style.left = `${at.x}px`;
    this.card.style.top = `${at.y}px`;
    this.card.dataset.side = at.side;
  }

  update(dt) {
    if (!this.el) return;
    const g = this.game;
    if (g.state === 'playing' && !this.ui.stack?.length) this.playT += dt;
    const l = this.lesson;
    if (l) {
      // A world lesson waits (out of sight) while a panel, the chat or a scene is up;
      // the book's lesson ends if the book closes.
      if (l.id === 'book') {
        if (!this.ui.hud?.spellbook?.isOpen?.()) {
          this.finish(true);
          return;
        }
        this.el.hidden = this.ui.top?.() !== this.ui.hud.spellbook.panel;
      } else {
        const step = l.steps[l.i];
        const waitingBook = step?.wait === 'spellbook' && this.ui.hud?.spellbook?.isOpen?.();
        this.el.hidden = !this.calm() && !waitingBook;
      }
      if (!this.el.hidden) this.place();
      return;
    }
    // Start a lesson when it becomes relevant.
    const w = this.weaving;
    if (!this.calm() || !w?.available?.() || !w.slotCount()) return;
    let has = false;
    for (let i = 0; i < w.slotCount(); i++) if (w.weaveAt(i)) has = true;
    if (!has) return;
    if (!this.done.cast || this.forced.has('cast')) {
      if (this.playT > 4 && (this.foeInSight() || this.playT > CAST_AFTER || this.forced.has('cast'))) this.start('cast');
      return;
    }
    if (this.foundKind && (!this.done.found || this.forced.has('found'))) this.start('found');
  }
}

function toggleWaiting(el, on) {
  el.classList.toggle('is-waiting', !!on);
}
