// The screens of DESIGN §29: the watch questioning the stranger (a question, four
// answers: the truth, a lie, a dodge, a confession), "Go quietly, or run", and the plea
// before the Moot. Built like the villager dialogue (portrait, words, options), and they
// pause the world while they are open. game.murder.view is this object.

import { h, button, clear } from './dom.js';
import { makePanel } from './modal.js';
import { portraitUrl } from './art.js';

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    console.warn('[murder view]', err);
    return fallback;
  }
}

export class MurderView {
  constructor(game) {
    this.game = game;
    this.panel = null;
  }

  get ui() {
    return this.game.ui;
  }

  // A dialogue-shaped panel for one speaker. -> { panel, setText, setOptions, setPortrait }
  frame(id, speaker, title, subtitle = '') {
    const panel = makePanel({ id, title, subtitle, cls: 'panel-dialog panel-murder' });
    panel.pauses = true;
    const img = h('img', { class: 'portrait portrait-xl', alt: '', draggable: 'false' });
    const text = h('p', { class: 'dlg-text', 'aria-live': 'polite' });
    const you = h('p', { class: 'dlg-you', hidden: true });
    const opts = h('div', { class: 'dlg-options' });
    panel.body.append(h('div', { class: 'dlg' }, h('span', { class: 'portrait-frame dlg-portrait' }, img), h('div', { class: 'dlg-main' }, you, h('div', { class: 'dlg-box' }, text), opts)));
    const setPortrait = (key, expr = 'neutral') => {
      const url = safe(() => portraitUrl(this.game, key, expr));
      if (url) img.src = url;
    };
    setPortrait(speaker, 'angry');
    return {
      panel,
      setText: (t) => {
        text.textContent = t || '';
      },
      setYou: (t) => {
        clear(you);
        if (!t) {
          you.hidden = true;
          return;
        }
        you.hidden = false;
        you.append(h('span', { class: 'dlg-you-name', text: this.game.settings?.playerName || 'You' }), h('span', { class: 'dlg-you-text', text: `“${t}”` }));
      },
      setOptions: (list, onPick) => {
        clear(opts);
        list.forEach((o, i) => {
          const b = button(o.label, { cls: `dlg-opt opt-${o.id}`, key: i < 9 ? String(i + 1) : null });
          b.addEventListener('click', () => onPick(o));
          opts.append(b);
        });
        const first = opts.querySelector('button');
        if (first && !this.ui?.isTouch) requestAnimationFrame(() => first.focus({ preventScroll: true }));
      },
      setPortrait,
    };
  }

  // The watch asks; the player answers until the questions run out.
  question(m) {
    const s = m.session;
    if (!s || !this.ui?.openModal) return;
    const by = s.by;
    const who = m.entity(by);
    const f = this.frame('questioning', by, who?.name || m.name(by), `About ${m.entity(s.about)?.name || m.name(s.about)}`);
    let closed = false;
    f.panel.onClose = () => {
      closed = true;
      // Walking away from the watch mid-question is a dodge.
      if (m.session) {
        while (m.session && !m.session.done) {
          const q = m.question();
          if (!q) break;
          const dodge = q.options.find((o) => /deflect|dunno/.test(o.id)) || q.options[0];
          m.answer(dodge.id);
        }
      }
    };
    const next = (lead) => {
      const q = m.question();
      if (!q) return;
      f.setText(lead ? `${lead} ${q.text}` : q.text);
      f.setOptions(q.options, (o) => {
        const r = m.answer(o.id);
        f.setYou(o.label);
        if (!r) return;
        if (r.done) {
          f.setText(r.reply);
          f.setPortrait(by, r.outcome === 'arrest' ? 'angry' : 'neutral');
          f.setOptions([{ id: 'ok', label: r.outcome === 'arrest' ? '…' : 'Leave' }], () => {
            if (!closed) this.ui.closeModal(f.panel);
          });
          return;
        }
        next(r.reply);
      });
    };
    this.ui.openModal(f.panel);
    next(s.opening);
  }

  // "You're coming with me." -> Promise<true (go quietly) | false (run)>
  arrest({ by, text }) {
    if (!this.ui?.openModal) return Promise.resolve(true);
    return new Promise((resolve) => {
      const who = this.game.murder?.entity?.(by);
      const f = this.frame('arrest', by, who?.name || 'The watch', 'The watch');
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        this.ui.closeModal(f.panel, true);
        resolve(v);
      };
      f.panel.onClose = () => finish(false);
      f.setText(text.replace(/^[^:]+:\s*/, '').replace(/^"|"$/g, ''));
      f.setOptions(
        [
          { id: 'quiet', label: 'Go quietly' },
          { id: 'run', label: 'Run' },
        ],
        (o) => finish(o.id === 'quiet'),
      );
      this.ui.openModal(f.panel);
    });
  }

  // Before the Moot: what do you say? -> Promise<'confess'|'deny'|'silent'>
  plea({ about, chair }) {
    if (!this.ui?.openModal) return Promise.resolve('deny');
    const m = this.game.murder;
    return new Promise((resolve) => {
      const who = chair ? m?.entity?.(chair) : null;
      const f = this.frame('plea', chair || 'alder', 'The Moot', who ? `${who.name} in the chair` : '');
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        this.ui.closeModal(f.panel, true);
        resolve(v);
      };
      f.panel.onClose = () => finish('silent');
      f.setText(`The whole room is looking at you. ${m?.entity?.(about)?.name || 'They'} is dead. What do you say?`);
      f.setOptions(
        [
          { id: 'confess', label: 'I did it.' },
          { id: 'deny', label: 'It was not me.' },
          { id: 'silent', label: 'Say nothing.' },
        ],
        (o) => finish(o.id),
      );
      this.ui.openModal(f.panel);
    });
  }
}
