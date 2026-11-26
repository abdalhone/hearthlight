// The screens of DESIGN §29: the watch questioning the stranger (a question, four
// answers: the truth, a lie, a dodge, a confession), "Go quietly, or run", and the plea
// before the Moot. Built like the villager dialogue (portrait, words, options), and they
// pause the world while they are open. game.murder.view is this object.

import { h, button, clear, setText } from './dom.js';
import { makePanel } from './modal.js';
import { portraitUrl } from './art.js';
import { FieldDictation } from './dictation.js';
import { QUICK } from '../murder/defence.js';

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    console.warn('[murder view]', err);
    return fallback;
  }
}

// A face as it is now (the years show in spriteKey).
function chairKey(game, id) {
  const e = safe(() => game.entities?.get?.(id), null);
  return e?.spriteKey && String(e.spriteKey).startsWith(`${id}~`) ? e.spriteKey : id;
}

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

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
      // Their face as it is now (round 14b: the years show; the entity's spriteKey).
      const e = safe(() => this.game.murder?.entity?.(key) || this.game.entities?.get?.(key), null);
      const k = e?.spriteKey && String(e.spriteKey).startsWith(`${key}~`) ? e.spriteKey : key;
      const url = safe(() => portraitUrl(this.game, k, expr));
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

  // Before the Moot, in your own words (round 14b, S-11): a field (typed or spoken), and three
  // chips for the old pleas. -> Promise<{ text, quick }>. Closing it is a silent plea. A tap
  // that skipped the scene before it cannot send it: the field starts empty, Send needs
  // words, and the chips wait a moment before they listen. Its own simple layout (not the
  // dialogue's grid), so the field is wide on every screen and the send button always shows.
  defence({ about, chair }) {
    if (!this.ui?.openModal) return Promise.resolve({ text: QUICK.deny, quick: 'deny' });
    const g = this.game;
    const m = g.murder;
    return new Promise((resolve) => {
      const who = chair ? m?.entity?.(chair) : null;
      const panel = makePanel({ id: 'defence', title: 'The Moot', subtitle: who ? `${who.name} in the chair` : '', cls: 'panel-dialog panel-murder panel-plea' });
      panel.pauses = true;
      let done = false;
      let dict = null;
      const finish = (v) => {
        if (done) return;
        done = true;
        dict?.detach?.();
        this.ui.closeModal(panel, true);
        resolve(v);
      };
      panel.onClose = () => finish({ text: '', quick: 'silent' });
      const V = m?.entity?.(about)?.name || 'They';
      const face = h('img', { class: 'portrait defence-face', alt: '', draggable: 'false', src: safe(() => portraitUrl(g, chairKey(g, chair || 'alder'), 'angry'), '') || '' });
      const words = h('p', { class: 'dlg-text defence-words', text: `The whole room is looking at you. ${V} is dead. Speak for yourself: what happened, where you were, why they should believe you.` });
      const field = h('textarea', { class: 'field defence-field', rows: '3', maxlength: '600', 'aria-label': 'Your defence', placeholder: 'Say it in your own words…', spellcheck: 'true' });
      const send = () => {
        const text = field.value.trim();
        if (!text) {
          field.focus({ preventScroll: true });
          return;
        }
        finish({ text, quick: null });
      };
      field.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          send();
        }
      });
      const mic = button('', { icon: 'mic', cls: 'btn-icon dlg-mic', title: 'Speak your defence' });
      const sendBtn = button('Speak to the Moot', { cls: 'btn-ember defence-send', onClick: send });
      const chips = h('div', { class: 'dlg-options defence-chips' });
      const openedAt = now();
      for (const [id, label] of [
        ['confess', 'I did it.'],
        ['deny', 'It was not me.'],
        ['silent', 'Say nothing.'],
      ]) {
        const b = button(label, { cls: `dlg-opt opt-${id}` });
        b.addEventListener('click', () => {
          // The tap that skipped the last line of the scene lands here a moment later: it
          // never speaks for the stranger.
          if (now() - openedAt < 450) return;
          finish({ text: QUICK[id] ?? '', quick: id });
        });
        chips.append(b);
      }
      try {
        dict = new FieldDictation(this.ui, { field, mic, owner: 'defence', idleTitle: 'Speak your defence' });
        dict.attach(g.runtime?.dictation || null);
      } catch {
        dict = null;
      }
      panel.body.append(h('div', { class: 'defence-head' }, h('span', { class: 'portrait-frame' }, face), words), field, chips);
      panel.foot.classList.add('defence-foot');
      panel.foot.append(mic, sendBtn);
      this.ui.openModal(panel);
      if (!this.ui?.isTouch) requestAnimationFrame(() => field.focus({ preventScroll: true }));
    });
  }

  // "The Moot weighs it": each juror's face, filling in with their word and their vote as it
  // comes. -> { vote(v), done(verdict) }: done shows "Hear the verdict" (always in the foot).
  weighing({ about, chair, jurors }) {
    if (!this.ui?.openModal) return null;
    const g = this.game;
    const m = g.murder;
    const panel = makePanel({ id: 'weighing', title: 'The Moot weighs it', subtitle: m?.entity?.(about)?.name ? `Over ${m.entity(about).name}` : '', cls: 'panel-murder' });
    panel.pauses = true;
    panel.body.append(h('p', { class: 'weighing-words', text: 'They talk it over among themselves. Each of them weighs what you said against what they know of you.' }));
    const grid = h('div', { class: 'jury' });
    const cards = new Map();
    for (const id of jurors || []) {
      const e = m?.entity?.(id);
      const key = chairKey(g, id);
      const img = h('img', { class: 'portrait jury-face', alt: '', draggable: 'false', src: safe(() => portraitUrl(g, key, 'neutral'), '') || '' });
      const said = h('p', { class: 'jury-said', text: '…' });
      const vote = h('span', { class: 'jury-vote is-wait', text: 'weighing' });
      const card = h('div', { class: 'jury-card' }, h('span', { class: 'portrait-frame' }, img), h('div', { class: 'jury-text' }, h('b', { text: e?.name?.split(' ')[0] || id }), said, vote));
      cards.set(id, { card, said, vote, img, key });
      grid.append(card);
    }
    panel.body.append(grid);
    const hear = button('Hear the verdict', { cls: 'btn-ember dlg-opt opt-hear', disabled: true });
    panel.foot.append(hear);
    let closed = false;
    let release = null;
    hear.addEventListener('click', () => {
      this.ui.closeModal(panel, true);
      release?.();
    });
    panel.onClose = () => {
      closed = true;
      release?.();
    };
    this.ui.openModal(panel);
    return {
      vote: (v) => {
        const c = cards.get(v?.id);
        if (!c || closed) return;
        setText(c.said, v.reason || '…');
        setText(c.vote, v.vote === 'guilty' ? 'Guilty' : v.vote === 'mercy' ? 'Mercy' : 'Not proven');
        c.vote.className = `jury-vote is-${v.vote}`;
        const expr = v.vote === 'guilty' ? 'angry' : v.vote === 'mercy' ? 'sad' : 'neutral';
        const u = safe(() => portraitUrl(g, c.key, expr), '');
        if (u) c.img.src = u;
      },
      done: () =>
        new Promise((resolve) => {
          if (closed) return resolve();
          release = resolve;
          hear.disabled = false;
          if (!this.ui?.isTouch) requestAnimationFrame(() => hear.focus({ preventScroll: true }));
        }),
    };
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
