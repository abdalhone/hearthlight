// Title screen (DESIGN.md §14, §24): name, an animated scene behind (the renderer's title
// view, plus drifting embers here), and one short menu: Continue (when a save exists),
// New game, Prologue, The Book of Halcyre, Past lives (when a story has ended), Settings,
// How to play; a line naming the mind Lyra uses.

import { h, button, setText, icon, clear } from './dom.js';
import { makePanel } from './modal.js';
import { HOW_TO_PLAY, TITLE_TAGLINES, CONTROL_DEVICES, controlsFor } from './content.js';
import { SAVE_KEY, DAY_SECONDS } from '../core/constants.js';
import { openCodex } from './codex.js';
import { openPastLives } from './memorial.js';
import { readPastLives } from '../survival/past_lives.js';
import { menuIcon } from './overlays.js';

// A menu button with its place's icon (the same icon as in the in-game menu).
function menuButton(id, label, cls, onClick) {
  const b = button(label, { cls: `${cls} title-${id}`, onClick });
  b.prepend(menuIcon(id));
  return b;
}

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

export class TitleScreen {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.el = null;
    this.busy = false;
    this.hasSave = false;
  }

  build() {
    const embers = h('div', { class: 'embers', 'aria-hidden': 'true' });
    // Deterministic spread: decoration should look the same on every visit.
    for (let i = 0; i < 22; i++) {
      const x = (i * 37 + 11) % 100;
      const d = 7 + ((i * 13) % 9);
      const delay = -((i * 1.7) % d);
      const s = 2 + (i % 3);
      const e = h('i', { class: i % 5 === 0 ? 'ember arcane' : 'ember' });
      e.style.cssText = `--x:${x}%;--d:${d}s;--delay:${delay}s;--s:${s}px;--drift:${(i % 2 ? 1 : -1) * (8 + (i % 4) * 6)}px`;
      embers.append(e);
    }
    this.continueBtn = menuButton('continue', 'Continue', 'btn-ember btn-big', () => this.onContinue());
    this.continueBtn.hidden = true;
    this.continueInfo = h('span', { class: 'continue-info' });
    this.continueBtn.append(this.continueInfo);
    this.newBtn = menuButton('newGame', 'New game', 'btn-big', () => this.onNew());
    // The story: watch the prologue again, or read what is known of the world.
    const prologueBtn = menuButton('prologue', 'Prologue', 'btn-ghost', () => this.onPrologue());
    const bookBtn = menuButton('book', 'The Book of Halcyre', 'btn-ghost', () => openCodex(this.ui));
    // Stories that ended in death with no kept flame (DESIGN §27).
    this.pastBtn = menuButton('pastLives', 'Past lives', 'btn-ghost', () => openPastLives(this.ui));
    this.pastBtn.hidden = true;
    const settingsBtn = menuButton('settings', 'Settings', 'btn-ghost', () => this.ui.openSettings());
    const howBtn = menuButton('howTo', 'How to play', 'btn-ghost', () => this.openHowTo());
    this.mindLine = h('p', { class: 'mind-line' });
    const tagline = TITLE_TAGLINES[0];
    this.el = h(
      'div',
      { class: 'title-screen', hidden: true },
      embers,
      h('div', { class: 'title-vignette', 'aria-hidden': 'true' }),
      h(
        'main',
        { class: 'title-card' },
        h('div', { class: 'logo' }, h('span', { class: 'logo-flame', 'aria-hidden': 'true' }, icon('flame')), h('h1', { class: 'logo-text', text: 'Hearthlight' })),
        h('p', { class: 'tagline', text: tagline }),
        h('nav', { class: 'title-menu', 'aria-label': 'Main menu' }, h('div', { class: 'title-main' }, this.continueBtn, this.newBtn), h('div', { class: 'title-row title-story' }, prologueBtn, bookBtn, this.pastBtn), h('div', { class: 'title-row title-sys' }, settingsBtn, howBtn)),
        this.mindLine,
      ),
      h('footer', { class: 'title-foot', text: 'All art and sound are made in your browser as you play.' }),
    );
    return this.el;
  }

  show() {
    if (!this.el) return;
    this.el.hidden = false;
    this.busy = false;
    this.newBtn.disabled = false;
    this.continueBtn.disabled = false;
    this.refreshMindLine();
    this.checkSave();
    this.pastBtn.hidden = !safe(() => readPastLives().length, 0);
    this.game.runtime?.onChange?.((name) => {
      if (name === '*' || name === 'sample' || name === 'db' || name === 'user') {
        this.refreshMindLine();
        if (name === '*' && !this.el.hidden) this.checkSave();
      }
    });
  }

  hide() {
    if (this.el) this.el.hidden = true;
  }

  isVisible() {
    return !!this.el && !this.el.hidden;
  }

  refreshMindLine() {
    if (!this.mindLine) return;
    const st = safe(() => this.game.brain?.status?.()) || {};
    const name = this.game.settings?.companionName || 'Lyra';
    let text;
    if (st.provider === 'claude.ai') text = `${name}'s mind: Claude, through claude.ai`;
    else if (st.provider === 'api') text = `${name}'s mind: Claude, with your API key`;
    else if (st.label && st.label.toLowerCase().includes(name.toLowerCase())) text = st.label;
    else text = `${name}'s mind: ${st.label || 'her offline mind'}`;
    setText(this.mindLine, text);
    this.mindLine.dataset.provider = st.provider || 'local';
  }

  async checkSave() {
    let has = false;
    try {
      has = await this.game.save?.hasSave?.();
    } catch {
      has = false;
    }
    this.hasSave = !!has;
    if (!this.el || this.el.hidden) return;
    this.continueBtn.hidden = !this.hasSave;
    if (this.hasSave) {
      const local = safe(() => JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'));
      const day = local?.clock?.t != null ? Math.floor(local.clock.t / DAY_SECONDS) + 1 : null;
      setText(this.continueInfo, day ? `Day ${day}` : '');
    }
  }

  async onContinue() {
    if (this.busy) return;
    this.busy = true;
    this.game.audio?.unlock();
    this.game.audio?.play('ui_open');
    this.continueBtn.disabled = true;
    this.newBtn.disabled = true;
    setText(this.continueInfo, 'Loading…');
    try {
      await this.game.continueGame();
    } catch (err) {
      console.warn('[title] continue failed', err);
      this.busy = false;
      this.continueBtn.disabled = false;
      this.newBtn.disabled = false;
      this.ui.toast('That save could not be loaded.', 'warn');
    }
  }

  onNew() {
    if (this.busy) return;
    this.game.audio?.unlock();
    const start = () => {
      this.busy = true;
      this.newBtn.disabled = true;
      this.continueBtn.disabled = true;
      this.game.audio?.play('ui_open');
      try {
        this.game.newGame({ prologue: true });
      } catch (err) {
        console.error('[title] new game failed', err);
        this.busy = false;
        this.newBtn.disabled = false;
      }
    };
    // Death is dangerous (§27): say so before the journey starts, every time.
    const soft = this.game.settings?.deathMode === 'home';
    const death = soft
      ? 'If you fall, someone may carry you to Mira in time. If not, you wake at home, and every coin you carried stays where you fell until you walk back for it (you chose this in Settings).'
      : 'If you fall, you lie bleeding: call for help, and Lyra or the village may carry you to Mira in time. If nobody does, you die — and unless Sister Aveline keeps a flame for you at the chapel, your story ends for good: this save closes and moves to Past lives. If the flame brings you back, every coin you carried stays where you fell. You can soften this in Settings.';
    const text = this.hasSave ? `${death} Your saved game will be replaced the next time this new one saves; Lyra will not remember the old one.` : death;
    this.ui.confirm({ title: this.hasSave ? 'Start a new journey?' : 'Death is dangerous here', text, yes: this.hasSave ? 'Start fresh' : 'Begin', no: 'Go back', danger: this.hasSave }).then((yes) => yes && start());
  }

  onPrologue() {
    if (this.busy || this.game.story?.isPlaying?.()) return;
    this.game.audio?.unlock();
    this.game.story?.playPrologue({ world: false });
  }

  // How to play: the controls for the device in hand (switchable), then what the game
  // is about. `section` scrolls to one part ('controls' from Settings → Controls).
  openHowTo(section = '') {
    const prev = this.ui.stack.find((p) => p.id === 'howto');
    if (prev) this.ui.closeModal(prev, true);
    const panel = makePanel({ id: 'howto', title: 'How to play', subtitle: 'Hearthvale, Lyra, and you', iconName: 'hand', cls: 'panel-wide' });
    let target = null;
    // The magic lessons, again: they point at the real buttons as they become relevant.
    const coach = this.ui.coach;
    let lessons = null;
    if (coach) {
      const replay = h('button', { type: 'button', class: 'btn btn-ember how-replay', text: 'Replay the magic lessons' });
      replay.addEventListener('click', () => {
        coach.replay();
        setText(replay, this.game.state === 'playing' ? 'They start when you are back in the world' : 'They start in your next game');
        replay.disabled = true;
      });
      lessons = h('section', { class: 'box how how-lessons' }, h('h3', { text: 'Magic, step by step' }), h('p', { text: 'Short lessons that point at the real buttons: casting, aiming, mana, your weave buttons, and making weaves in the Spellbook.' }), replay);
    }
    for (const sec of HOW_TO_PLAY) {
      const box = h('section', { class: `box how how-${sec.id}`, 'data-section': sec.id }, h('h3', { text: sec.title }));
      if (sec.controls) box.append(...this.controlsBlock());
      if (sec.text) box.append(h('p', { text: sec.text }));
      if (sec.rows) {
        const dl = h('dl', { class: 'how-rows' });
        for (const [k, v] of sec.rows) dl.append(h('div', { class: 'how-row' }, h('dt', { text: k }), h('dd', { text: v })));
        box.append(dl);
      }
      if (sec.id === section) target = box;
      panel.body.append(box);
      if (lessons && sec.id === 'controls') panel.body.append(lessons);
    }
    this.ui.openModal(panel);
    if (target && target !== panel.body.firstElementChild) requestAnimationFrame(() => (panel.body.scrollTop = target.offsetTop - panel.body.offsetTop));
    return panel;
  }

  // Touch, Keyboard & mouse or Gamepad: one list at a time, the one in your hands first.
  controlsBlock() {
    const inp = this.game.input;
    let device = this.ui.isTouch ? 'touch' : inp?.lastDevice === 'gamepad' ? 'pad' : 'keys';
    const dl = h('dl', { class: 'how-rows how-controls' });
    const seg = h('div', { class: 'segmented how-devices', role: 'radiogroup', 'aria-label': 'Controls for' });
    const fill = () => {
      clear(dl);
      for (const [what, how] of controlsFor(device)) dl.append(h('div', { class: 'how-row' }, h('dt', { text: what }), h('dd', { text: how })));
      for (const b of seg.children) b.setAttribute('aria-checked', b.dataset.device === device ? 'true' : 'false');
    };
    for (const d of CONTROL_DEVICES) {
      const b = h('button', { type: 'button', class: 'seg', role: 'radio', 'data-device': d.id, 'aria-checked': 'false', text: d.label });
      b.addEventListener('click', () => {
        device = d.id;
        fill();
      });
      seg.append(b);
    }
    fill();
    return [seg, dl];
  }
}
