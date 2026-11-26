// The taken flame on the screen (round 14b §13b, S20-7; workstream soul; DESIGN §37.9).
//
//   the HUD:   a small cold-blue bar right under your health in the player card, only once the
//              first soul is taken (the HUD is not built around anything you have not got),
//              its text the boost it gives now ("+19%"); it follows the card on every screen and
//              the Interface size setting (it is a meter like the others, in their card);
//   the sheet: a "Coldfire" box in the Character panel with its numbers: the bar and how fast
//              it ebbs, what it adds to Sword and Weave power, how much faster the Unkindling
//              pulls, the souls taken, and what shows on you now (the signs you can see).
// Both are added from here on instances (the HUD's player card, the character view's render),
// feature-detected; nothing in hud.js or character_view.js is changed.

import { h, meter, setText, toggleClass, clear } from './dom.js';
import { MAX, EBB, BOOST, CHANNEL } from '../magic/coldfire.js';

const SIGN_TEXT = {
  0: '',
  1: 'Your hands are cold to the touch; your breath fogs at night.',
  2: 'Your hands are ice. Flames lean from you, beasts shy, and frost forms in your steps at night.',
  3: 'Flames lean from you and beasts shy; there is a cold light in your eyes after dark, your shadow lags, and the flowers by your bed have died.',
};

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[coldfire view]', err);
    return fallback;
  }
}

const pct = (x) => `${Math.round(x * 100)}%`;

export class ColdfireView {
  constructor(game, unk) {
    this.game = game;
    this.unk = unk;
    this.m = null;
    this.t = 0;
    this.shownKey = '';
    this.wrappedChar = false;
  }

  get cf() {
    return this.unk?.coldfire || null;
  }

  // The bar in the player card, right under health.
  mountHud() {
    if (this.m || typeof document === 'undefined') return;
    const hud = this.game?.ui?.hud;
    const hp = hud?.pHp?.el;
    if (!hp?.parentNode) return;
    this.m = meter('meter-coldfire', 'Coldfire: the taken flame');
    this.m.el.hidden = true;
    this.m.el.title = 'Coldfire: the taken flame. It makes your Sword and Weave hit harder; it ebbs over days.';
    hp.after(this.m.el);
  }

  // A box in the Character panel (after its own render, on the instance).
  wrapCharacter() {
    if (this.wrappedChar) return;
    const cv = this.game?.ui?.character;
    if (!cv || typeof cv.render !== 'function') return;
    const orig = cv.render.bind(cv);
    const self = this;
    cv.render = function coldfireRender(...args) {
      const r = orig(...args);
      safe(() => self.renderSheet(cv));
      return r;
    };
    this.wrappedChar = true;
  }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    this.mountHud();
    this.wrapCharacter();
    const cf = this.cf;
    if (!this.m || !cf) return;
    const show = cf.shown || (this.unk?.learned && cf.bar > 0);
    if (this.m.el.hidden === show) this.m.el.hidden = !show;
    if (!show) return;
    const key = `${Math.round(cf.bar)}|${Math.round(cf.boost() * 100)}`;
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.m.set(cf.frac, cf.bar > 0.5 ? `+${Math.round(cf.boost() * 100)}%` : '0');
    toggleClass(this.m.el, 'empty', cf.bar <= 0.5);
    // A live Character panel follows.
    const cv = this.game?.ui?.character;
    if (cv?.isOpen?.()) safe(() => this.renderSheet(cv));
  }

  renderSheet(cv) {
    const cf = this.cf;
    const body = cv?.panel?.body;
    if (!body || !cf) return;
    const grid = body.querySelector('.chs') || body;
    let box = grid.querySelector('.chs-coldfire');
    const show = cf.shown || !!this.unk?.learned;
    if (!show) {
      if (box) box.hidden = true;
      return;
    }
    if (!box) {
      this.sheet = {
        fill: h('i'),
        bar: h('b', { class: 'num' }),
        boost: h('b', { class: 'num' }),
        pull: h('b', { class: 'num' }),
        ebb: h('span', { class: 'chs-cf-note' }),
        souls: h('p', { class: 'chs-cf-souls' }),
        signs: h('p', { class: 'chs-cf-signs' }),
      };
      const s = this.sheet;
      box = h(
        'section',
        { class: 'chs-box chs-wide chs-coldfire' },
        h('h3', null, h('span', { text: 'Coldfire' }), h('span', { class: 'chs-h-note', text: 'The taken flame' })),
        h('div', { class: 'chs-cf-track', role: 'meter', 'aria-label': 'Coldfire' }, s.fill),
        h('div', { class: 'chs-cf-grid' }, h('div', { class: 'chs-stat' }, h('span', { text: 'Held now' }), s.bar), h('div', { class: 'chs-stat' }, h('span', { text: 'Sword and Weave' }), s.boost), h('div', { class: 'chs-stat' }, h('span', { text: 'The pull' }), s.pull)),
        s.ebb,
        s.souls,
        s.signs,
      );
      // Right after "Running now" (what runs on you), before the sums.
      const after = cv.effectsBox && cv.effectsBox.parentNode === grid ? cv.effectsBox : null;
      if (after) after.after(box);
      else grid.append(box);
    }
    box.hidden = false;
    const s = this.sheet;
    if (!s) return;
    s.fill.style.width = `${Math.round(cf.frac * 1000) / 10}%`;
    setText(s.bar, `${Math.round(cf.bar)} / ${MAX}`);
    setText(s.boost, `+${pct(cf.boost())}`);
    setText(s.pull, cf.bar > 0.5 ? `${pct(1 - cf.channelMul())} faster` : 'as it is');
    setText(s.ebb, cf.bar > 0.5 ? `It ebbs about ${EBB} a day, like a hunger; a full flame gives +${pct(BOOST)} and pulls ${pct(1 - 1 / (1 + CHANNEL))} faster.` : `Every soul the Unkindling takes feeds it; a full flame gives +${pct(BOOST)} to Sword and Weave power.`);
    const tk = cf.taken || {};
    const parts = [];
    const n = (k, one, many) => (tk[k] ? `${tk[k]} ${tk[k] === 1 ? one : many}` : null);
    for (const p of [n('person', 'person', 'people'), n('bandit', 'bandit', 'bandits'), n('beast', 'beast', 'beasts'), n('boss', 'old thing', 'old things')]) if (p) parts.push(p);
    setText(s.souls, parts.length ? `Taken: ${parts.join(', ')}.` : 'Nothing taken yet.');
    const tier = cf.tier();
    setText(s.signs, tier ? `What shows on you: ${SIGN_TEXT[tier]}` : cf.mark > 0 ? 'Nothing shows on you yet.' : '');
    s.signs.hidden = !s.signs.textContent;
    void clear;
  }
}
