// Title screen (DESIGN.md §14): name, an animated scene behind (the renderer's title
// view, plus drifting embers here), Continue when a save exists, New game, Settings,
// How to play, and a line naming the mind Lyra uses.

import { h, button, setText, icon } from './dom.js';
import { makePanel } from './modal.js';
import { HOW_TO_PLAY, TITLE_TAGLINES } from './content.js';
import { SAVE_KEY, DAY_SECONDS } from '../core/constants.js';
import { storyEntries, runEntry } from './story_menu.js';
import { openCodex } from './codex.js';

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
    this.continueBtn = button('Continue', { cls: 'btn-ember btn-big', onClick: () => this.onContinue() });
    this.continueBtn.hidden = true;
    this.continueInfo = h('span', { class: 'continue-info' });
    this.continueBtn.append(this.continueInfo);
    this.newBtn = button('New game', { cls: 'btn-big', onClick: () => this.onNew() });
    const settingsBtn = button('Settings', { icon: 'gear', cls: 'btn-ghost', onClick: () => this.ui.openSettings() });
    const howBtn = button('How to play', { icon: 'book', cls: 'btn-ghost', onClick: () => this.openHowTo() });
    // The story: watch the prologue again, or read what is known of the world.
    const prologueBtn = button('Prologue', { icon: 'flame', cls: 'btn-ghost', onClick: () => this.onPrologue() });
    const bookBtn = button('The Book of Halcyre', { icon: 'scroll', cls: 'btn-ghost', onClick: () => openCodex(this.ui) });
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
        h('nav', { class: 'title-menu', 'aria-label': 'Main menu' }, this.continueBtn, this.newBtn, h('div', { class: 'title-row' }, settingsBtn, howBtn), h('div', { class: 'title-row' }, prologueBtn, bookBtn)),
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
    this.refreshStory();
    this.checkSave();
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

  // "Prologue" and "The Book of Halcyre", when this build has the story (§20).
  refreshStory() {
    const row = this.storyRow;
    if (!row) return;
    row.textContent = '';
    const entries = safe(() => storyEntries(this.game, this.ui), []);
    for (const entry of entries) {
      row.append(button(entry.label, { icon: entry.icon, cls: `btn-ghost title-${entry.id}`, title: entry.hint, onClick: () => runEntry(entry, this.ui) }));
    }
    row.hidden = !entries.length;
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
    if (this.hasSave) {
      this.ui.confirm({ title: 'Start a new journey?', text: 'Your saved game will be replaced the next time this new one saves. Lyra will not remember the old one.', yes: 'Start fresh', no: 'Go back', danger: true }).then((yes) => yes && start());
    } else start();
  }

  onPrologue() {
    if (this.busy || this.game.story?.isPlaying?.()) return;
    this.game.audio?.unlock();
    this.game.story?.playPrologue({ world: false });
  }

  openHowTo() {
    const panel = makePanel({ id: 'howto', title: 'How to play', subtitle: 'Hearthvale, Lyra, and you', iconName: 'book', cls: 'panel-wide' });
    for (const sec of HOW_TO_PLAY) {
      const box = h('section', { class: 'box how' }, h('h3', { text: sec.title }));
      if (sec.text) box.append(h('p', { text: sec.text }));
      if (sec.rows) {
        const dl = h('dl', { class: 'how-rows' });
        for (const [k, v] of sec.rows) dl.append(h('div', { class: 'how-row' }, h('dt', { text: k }), h('dd', { text: v })));
        box.append(dl);
      }
      panel.body.append(box);
    }
    panel.foot.append(button('Got it', { cls: 'btn-ember', onClick: () => this.ui.closeModal(panel) }));
    this.ui.openModal(panel);
  }
}
