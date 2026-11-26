// The in-game HUD: the player's card and the companion slot (round 14b, DESIGN §34.3:
// whoever walks with you now, any adult, with where they stand with you; nothing at all
// when you walk alone), place / clock / weather, the quest line, the interact prompt, the
// "Ask <companion>" bar (with Lyra's Jobs menu while she is the one) and its radial form on
// small screens. DOM writes happen only on change. On phones the HUD folds small so the
// world stays visible: the companion's card is their portrait and mood (a tap opens People
// at them), and the quest line tucks in beside it. Lyra is the heart of the story, not of
// the HUD: nothing of hers is pinned here while she is not beside you.

// The Weave's pieces (DESIGN §22.4): the controller, the aim layer, the Spellbook.
import { Weaving } from './weaving.js';
import { AimPreview } from './aim_preview.js';
import { paintSlot, paintSlotState } from './touch.js';
import { spellbookIconUrl, SPELLBOOK_ICON_SIZE } from './weave_icons.js';
import { Spellbook } from './spellbook.js';
import { h, icon, setIcon, setText, setStyle, toggleClass, meter, button, setAttr } from './dom.js';
import { COMMANDS, JOBS, DELIVER_OPTIONS } from './content.js';
import { hpText, frac, fmtInt, weatherIconKey, weatherLabel, moodEmoji, stanceLabel } from './format.js';
import { portraitUrl } from './art.js';
import { trustWords, fearWords } from './lyra_view.js';
import { companionView, companionBarMode } from './companion_view.js';
import { BossBar } from './boss_bar.js';
// Stats, gear and prices (DESIGN §25–26): the sheet, Bram's forge, the gain/cost timers.
import { installCharacterView, syncBadge } from './character_view.js';
import { installForgeView } from './forge_view.js';
import { ensureStatsStyle, fmtSeconds, PRICE_GLYPH } from './stats_style.js';

const STANCE_ICON = { attack: 'sword', defend: 'shield', passive: 'feather', self_defense: 'shield' };

// Phones and short screens get the compact HUD (the same breakpoints as styles.css).
const SMALL_QUERY = '(max-width: 640px), (max-height: 520px)';
const PORTRAIT_PHONE_QUERY = '(max-width: 640px) and (min-height: 521px)';
// A phone held sideways (or any short window): the HUD becomes one thin top strip.
const STRIP_QUERY = '(max-height: 520px)';
// HUD pieces speech bubbles must not hide behind (see Bubbles.setKeepOut).
// Also the fallen screen's words and Call for help (a bubble over them read as one).
// (Round 14b leftover: the phone's use-button tag, "Give Tobias a potion", floats beside its
// button; a speech bubble kept clear of the button alone could still sit on the tag.)
const KEEP_OUT_SELECTOR = '.hud .card, .hud-btn, .quest-line, .listen-prompt, .interact-prompt, .cmdbar, .orders-btn, .tbtn, .tbtn-tag, .wbtn, .hotbar, .sv-fallen';
const KEEP_OUT_EVERY = 0.25;

function readFlag(key) {
  try {
    return window.localStorage?.getItem(key) === '1';
  } catch {
    return false;
  }
}

function saveFlag(key) {
  try {
    window.localStorage?.setItem(key, '1');
  } catch {
    /* private mode: shown again next visit */
  }
}

function bookIcon(cls = '') {
  const img = h('img', { class: `px-icon ${cls}`.trim(), alt: '', draggable: 'false', 'aria-hidden': 'true', src: spellbookIconUrl() });
  img.style.setProperty('--iw', String(SPELLBOOK_ICON_SIZE.w));
  img.style.setProperty('--ih', String(SPELLBOOK_ICON_SIZE.h));
  return img;
}

function media(q) {
  try {
    return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null;
  } catch {
    return null;
  }
}

export class Hud {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.tick = 0;
    this.slowTick = 0;
    this.deliverTo = 'player';
    this.jobsOpen = false;
    this.radialOpen = false;
    this.lastExpr = '';
    this.cs = ''; // the companion slot last drawn: '<id>:<state>' ('' = nobody)
    this.mode = ''; // bar mode last applied: full | hidden
    this.view = null; // companionView(game): who walks with you now, or null
    this.refusedT = 0;
    this.layoutT = 0;
    this.keepT = 0;
    this._keep = [];
    // The Weave (§22.4): one controller for every way of casting, and its aim layer.
    this.weaving = new Weaving(this.game, ui);
    this.weaving.bind();
    this.game.aimPreview = new AimPreview(this.game, this.weaving);
    this.spellbook = null;
    this.hbTick = 0;
    this.hbVersion = -1;
    this.newMagic = false;
    ui.openSpellbook = (slot) => this.openSpellbook(slot);
    this.el = this.build();
    this.mountWeave();
    this.watchLayout();
    this.bindMagic();
    installCharacterView(ui);
    installForgeView(ui);
    ensureStatsStyle();
  }

  // The hotbar joins the bottom (under the prompts), the tip the HUD; the Ask bar moves
  // beside Lyra for mouse players. Per step, the weave controller runs from the input's
  // step hook, so it sees every press even while the HUD is hidden or a panel is open.
  mountWeave() {
    this.bottomEl = this.el.querySelector('.hud-bottom');
    this.bottomEl.append(this.hotbar);
    this.placeAskBar();
    this.game.input?.onStep?.((dt) => this.stepWeave(dt));
  }

  stepWeave(dt) {
    const g = this.game;
    this.weaving.update(dt);
    if (this.weaving.sword && g.input) g.input.setSwingAim(this.weaving.sword.dx, this.weaving.sword.dy);
    this.ui.touch?.update?.(dt);
    const inp = g.input;
    if (inp?.uiPressed('spellbook')) {
      inp.consume('spellbook');
      const top = this.ui.top?.();
      if (g.state === 'playing' && (!top || top === this.spellbook?.panel)) this.toggleSpellbook();
    }
    if (inp?.uiPressed?.('character')) {
      inp.consume('character');
      const top = this.ui.top?.();
      if (g.state === 'playing' && (!top || top === this.ui.character?.panel)) this.ui.character?.toggle?.();
    }
    this.syncCursor();
    if (this.el.hidden || !g.player) return;
    this.updateHotbar(dt);
    this.placeAskBar();
  }

  build() {
    const g = this.game;
    // Player card
    this.pName = h('span', { class: 'card-name' });
    this.pLevel = h('span', { class: 'card-level num' });
    this.pHp = meter('meter-hp', 'Health');
    this.pMana = meter('meter-mana', 'Mana');
    this.pMana.el.hidden = true;
    this.pXp = meter('meter-xp', 'Experience');
    this.pCoins = h('span', { class: 'coins-num num' });
    const playerCard = h(
      'div',
      { class: 'card player-card' },
      h('div', { class: 'card-row' }, icon('heart', 'card-glyph'), this.pName, this.pLevel, h('span', { class: 'coins' }, icon('coin'), this.pCoins)),
      this.pHp.el,
      this.pMana.el,
      this.pXp.el,
    );
    // Gains, costs and weaknesses running now (DESIGN §25): small timers; costs in red.
    this.buffRow = h('div', { class: 'buff-row', 'aria-label': 'Running now' });
    this.buffKey = '';
    playerCard.append(this.buffRow);

    // The companion slot (tap -> People at them): whoever walks with you now, and where they
    // stand with you; not a unit frame. Hidden when you walk alone.
    this.lPortrait = h('img', { class: 'portrait portrait-hud', alt: '', draggable: 'false' });
    this.lName = h('span', { class: 'card-name' });
    this.lMood = h('span', { class: 'mood-emoji', role: 'img' });
    this.lStanceIcon = icon('shield');
    this.lStance = h('span', { class: 'stance-badge' }, this.lStanceIcon, h('span', { class: 'stance-text' }));
    this.lHp = meter('meter-companion', 'Health');
    this.lStatus = h('div', { class: 'companion-status' });
    this.csChip = h('span', { class: 'cs-chip', 'data-tone': 'good' });
    this.trustFill = h('i', { class: 'mini-fill' });
    this.fearFill = h('i', { class: 'mini-fill' });
    this.trustMini = h('span', { class: 'mini mini-trust' }, h('span', { class: 'mini-label', text: 'Trust' }), h('span', { class: 'mini-track' }, this.trustFill));
    this.fearMini = h('span', { class: 'mini mini-fear' }, h('span', { class: 'mini-label', text: 'Fear' }), h('span', { class: 'mini-track' }, this.fearFill));
    this.relRow = h('span', { class: 'rel-row' }, this.csChip, this.trustMini, this.fearMini);
    this.compLive = h('span', { class: 'companion-live' }, this.lHp.el, this.lStatus);
    // Folded (phones): the portrait with the mood on its corner and a hairline of health.
    this.lMiniHp = h('i', { class: 'mini-hp-fill' });
    this.lMiniMood = h('span', { class: 'mini-mood', 'aria-hidden': 'true' });
    this.compCard = h(
      'button',
      { type: 'button', class: 'card companion-card', title: 'Open People (Tab)' },
      h('span', { class: 'portrait-frame' }, this.lPortrait, this.lMiniMood, h('span', { class: 'mini-hp' }, this.lMiniHp)),
      h('span', { class: 'companion-info' }, h('span', { class: 'card-row' }, this.lName, this.lMood, this.lStance), this.compLive, this.relRow),
      h('span', { class: 'unfold-chev', 'aria-hidden': 'true', text: '›' }),
    );
    // A tap opens People at them (on a phone the card is only the portrait and mood): who
    // they are to you, and the "Ask" row for orders.
    this.compCard.addEventListener('click', () => this.openPeopleAtCompanion());
    this.compWrap = h('div', { class: 'companion-wrap', hidden: true }, this.compCard);

    // Place, clock and weather
    this.place = h('div', { class: 'place-name' });
    this.wIcon = icon('sun', 'weather-icon');
    this.clock = h('span', { class: 'clock num' });
    this.dayEl = h('span', { class: 'day num' });
    this.wLabel = h('span', { class: 'weather-label' });
    const placeCard = h('div', { class: 'card place-card' }, this.place, h('div', { class: 'clock-row' }, this.wIcon, this.clock, h('span', { class: 'dot' }), this.dayEl, this.wLabel));

    // Corner buttons: talking, and the one menu (DESIGN §24). Every place in the game —
    // the Spellbook, the bag, her Mind, missions — has its home in the menu; the HUD
    // keeps only what play needs every second. (On a touch screen the right-thumb
    // cluster's Talk button stands in for the chat button.)
    this.chatBadge = h('span', { class: 'badge', hidden: true });
    // Talk (T) in every state, alone or not: to whoever is nearest in front of you (talk's
    // ui.talkToNearest when it exists), else the chat as it was.
    const chatBtn = button('', { icon: 'talk', cls: 'btn-icon hud-btn hud-chat hud-talk', title: 'Talk (T)', onClick: () => this.talk() });
    chatBtn.append(this.chatBadge);
    // Something new for the Spellbook shows as a dot on the menu button (and on the
    // menu's Spellbook entry) until the book is opened.
    this.bookDot = h('span', { class: 'badge badge-dot', hidden: true });
    this.menuBtn = h('button', { type: 'button', class: 'btn btn-icon hud-btn hud-menu', title: 'Menu (Esc)', 'aria-label': 'Menu' }, icon('menu'), h('span', { class: 'hud-btn-label', text: 'Menu' }), this.bookDot);
    this.menuBtn.addEventListener('click', () => this.ui.openPause());
    const corner = h('div', { class: 'hud-buttons' }, chatBtn, this.menuBtn);

    // Quest line
    this.questText = h('span', { class: 'quest-text' });
    this.questLine = h('button', { type: 'button', class: 'quest-line', hidden: true, title: 'Missions' }, icon('scroll'), this.questText);
    // On a phone the line is one short row; a tap shows all of it for a while.
    this.questOpenT = 0;
    // A tap opens the Missions journal (DESIGN §22.3) when this build has one.
    this.questLine.addEventListener('click', () => (this.game.missions && typeof this.ui.openMissions === 'function' ? this.ui.openMissions('active') : this.toggleQuestFull()));

    // Interact prompt
    this.promptKey = h('kbd', { class: 'keycap', text: 'E' });
    this.promptText = h('span', { class: 'prompt-text' });
    this.prompt = h('button', { type: 'button', class: 'interact-prompt', hidden: true }, this.promptKey, this.promptText);
    this.prompt.addEventListener('click', () => g.input?.press('interact'));

    // "Listen in" while two villagers talk nearby (§19.3): small, a key or a tap.
    this.listenKey = h('kbd', { class: 'keycap', text: 'L' });
    this.listenText = h('span', { class: 'listen-text' });
    this.listenBtn = h('button', { type: 'button', class: 'listen-prompt', hidden: true, title: 'Listen in on their conversation (L)' }, this.listenKey, icon('convo'), this.listenText);
    this.listenBtn.addEventListener('click', () => this.ui.village?.listenIn());

    // The "Ask <companion>" bar: every button is a request they weigh and answer (§16.4,
    // §34.4). Hidden when you walk alone.
    this.cmdButtons = {};
    this.barTitle = h('span', { class: 'cmdbar-title', text: 'Ask' });
    this.cmdbar = h('nav', { class: 'cmdbar', 'aria-label': 'Ask your companion', hidden: true }, this.barTitle);
    for (const c of COMMANDS) {
      const b = button(c.label, { icon: c.icon, cls: `cmd cmd-${c.id}`, key: c.key, title: c.hint, onClick: () => this.ui.runCommand(c.id) });
      this.cmdButtons[c.id] = b;
      this.cmdbar.append(b);
    }
    this.jobsBtn = button('Jobs', { icon: 'axe', cls: 'cmd cmd-jobs', title: 'Ask her to take on a job', onClick: (e) => this.toggleJobs(e) });
    this.jobsBtn.append(h('span', { class: 'caret', text: '▾' }));
    const talkBtn = button('Talk', { icon: 'talk', cls: 'cmd cmd-talk', key: 'T', title: 'Talk (T)', onClick: () => this.talk() });
    this.cmdbar.append(this.jobsBtn, talkBtn);

    this.jobsMenu = this.buildJobsMenu();

    // Radial requests (small screens). Which items show depends on the bar mode.
    this.ordersBtn = button('', { icon: 'spark', cls: 'orders-btn', title: 'Ask your companion', onClick: () => this.toggleRadial() });
    this.radial = h('div', { class: 'radial', 'aria-hidden': 'true' });
    this.radialItems = [...COMMANDS.map((c) => ({ id: c.id, label: c.label, icon: c.icon })), { id: 'jobs', label: 'Jobs', icon: 'axe' }, { id: 'talk', label: 'Talk', icon: 'talk' }];
    for (const it of this.radialItems) {
      const b = button(it.label, { icon: it.icon, cls: `radial-item radial-${it.id}` });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeRadial();
        if (it.id === 'jobs') this.openJobs(true);
        else if (it.id === 'talk') this.talk();
        else this.ui.runCommand(it.id);
      });
      it.el = b;
      this.cmdButtons[`r_${it.id}`] = b;
      this.radial.append(b);
    }
    this.ordersWrap = h('div', { class: 'orders', hidden: true }, this.radial, this.ordersBtn);
    this.layoutRadial('full');

    this.fps = h('div', { class: 'fps num', hidden: true });

    this.hotbar = this.buildHotbar();

    this.cardsEl = h('div', { class: 'hud-cards' }, playerCard, this.compWrap);
    this.rightEl = h('div', { class: 'hud-right' }, placeCard, corner);
    const top = h('div', { class: 'hud-top' }, this.cardsEl, this.rightEl);
    const center = h('div', { class: 'hud-center' }, this.questLine);
    this.center = center;
    const bottom = h('div', { class: 'hud-bottom' }, this.listenBtn, this.prompt, this.cmdbar);
    const hud = h('div', { class: 'hud', hidden: true }, top, center, bottom, this.ordersWrap, this.jobsMenu, this.fps);
    // The boss health bar (src/ui/boss_bar.js) lives in the HUD while a fight is on.
    try {
      this.bossBar = new BossBar(g, hud);
      hud.append(this.bossBar.el);
    } catch (err) {
      console.error('[hud] boss bar failed', err);
    }
    return hud;
  }

  // ---------- the Weave: hotbar, mana, Spellbook (DESIGN §22.4) ----------

  // Desktop: the weave slots and the mana bar, bottom centre (touch uses the weave arc).
  buildHotbar() {
    this.hbManaFill = h('i', { class: 'hb-mana-fill' });
    this.hbManaCost = h('i', { class: 'hb-mana-cost' });
    this.hbManaText = h('span', { class: 'hb-mana-text num' });
    const mana = h('div', { class: 'hb-mana', role: 'meter', 'aria-label': 'Mana' }, h('span', { class: 'hb-mana-track' }, this.hbManaFill, this.hbManaCost), this.hbManaText);
    this.hbSlots = [];
    const row = h('div', { class: 'hb-row' });
    for (let i = 0; i < 6; i++) {
      const img = h('img', { class: 'wbtn-icon', alt: '', draggable: 'false', 'aria-hidden': 'true' });
      const cd = h('span', { class: 'wbtn-cd', 'aria-hidden': 'true' });
      const secs = h('span', { class: 'wbtn-secs num', 'aria-hidden': 'true' });
      const chg = h('span', { class: 'wbtn-chg', 'aria-hidden': 'true' });
      const plus = h('span', { class: 'wbtn-plus', 'aria-hidden': 'true', text: '+' });
      const key = h('kbd', { class: 'keycap hb-key', text: String(i + 1) });
      const cost = h('span', { class: 'hb-cost num' });
      // Which weave the right mouse button casts (the wheel and Q / R change it): a small
      // mouse in the corner, never a slot that looks pressed or picked.
      const rmb = h('span', { class: 'hb-rmb', 'aria-hidden': 'true', hidden: true });
      const b = h('button', { type: 'button', class: 'wbtn hslot tbtn', hidden: true }, chg, img, cd, secs, plus, key, cost, rmb);
      const slot = { i, b, img, cd, secs, chg, plus, cost, rmb, key: '' };
      // A press casts the slot at once, like its number key: a quick click casts, a hold
      // charges (drag out over the world to aim it), the release anywhere lets it go.
      // Nothing is selected and no focus is left behind (a later Space swings the sword,
      // it never presses this button again). An empty slot opens the Spellbook on it.
      b.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        if (!this.weaving.weaveAt(i)) {
          this.openSpellbook(i);
          return;
        }
        this.weaving.clickStart(i, e.pointerId);
      });
      // A keyboard or assistive click (no pointer behind it) is a quick tap.
      b.addEventListener('click', (e) => {
        if (e.detail !== 0) return;
        if (!this.weaving.weaveAt(i)) this.openSpellbook(i);
        else {
          this.weaving.clickStart(i, -1);
          this.weaving.clickEnd(-1);
        }
      });
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.openSpellbook(i);
      });
      b.addEventListener('pointerenter', () => (this.hbHover = i));
      b.addEventListener('pointerleave', () => {
        if (this.hbHover === i) this.hbHover = -1;
      });
      this.hbSlots.push(slot);
      row.append(b);
    }
    this.hbHover = -1;
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerup', (e) => this.weaving.clickEnd(e.pointerId));
      window.addEventListener('pointercancel', (e) => this.weaving.clickEnd(e.pointerId, true));
    }
    this.hbName = h('div', { class: 'hb-name' });
    return h('div', { class: 'hotbar', hidden: true }, this.hbName, mana, row);
  }

  // Touch tablets keep the Ask bar at the bottom (the hotbar is the weave arc there);
  // with a mouse it joins Lyra's column, under her card.
  placeAskBar() {
    const touch = !!this.ui.isTouch;
    if (this._askTouch === touch && this.cmdbar.parentElement) return;
    this._askTouch = touch;
    if (touch) this.bottomEl.append(this.cmdbar);
    else this.cardsEl.append(this.cmdbar);
    toggleClass(this.cmdbar, 'cmdbar-side', !touch);
  }

  bindMagic() {
    const bus = this.game.bus;
    if (!bus?.on) return;
    bus.on('magic_unlocked', (p) => {
      if (p?.source === 'trial') return;
      this.newMagic = true;
      if (this.bookDot) this.bookDot.hidden = false;
    });
  }

  openSpellbook(slot) {
    if (!this.weaving.available() || this.game.state !== 'playing') return;
    if (!this.spellbook) this.spellbook = new Spellbook(this.ui, this.weaving);
    this.newMagic = false;
    if (this.bookDot) this.bookDot.hidden = true;
    this.spellbook.open(Number.isInteger(slot) ? slot : this.weaving.selected);
  }

  toggleSpellbook() {
    if (this.spellbook?.isOpen?.()) this.spellbook.close();
    else this.openSpellbook();
  }

  updateHotbar(dt) {
    const w = this.weaving;
    const live = w.available() && w.slotCount() > 0;
    toggleClass(this.ui.root, 'has-magic', live);
    if (!live) {
      if (!this.hotbar.hidden) this.hotbar.hidden = true;
      if (!this.pMana.el.hidden) this.pMana.el.hidden = true;
      return;
    }
    this.hbTick += dt;
    if (this.hbTick < 1 / 30) return;
    this.hbTick = 0;
    const mana = w.mana();
    if (mana && mana.max > 0) {
      if (this.pMana.el.hidden) this.pMana.el.hidden = false;
      this.pMana.set(mana.cur / mana.max, `${Math.floor(mana.cur)}/${Math.round(mana.max)}`);
      toggleClass(this.pMana.el, 'low', mana.cur / mana.max < 0.2);
    }
    if (this.ui.isTouch) {
      if (!this.hotbar.hidden) this.hotbar.hidden = true;
      return;
    }
    if (this.hotbar.hidden) this.hotbar.hidden = false;
    const n = w.slotCount();
    const ver = w.version;
    const t = this.game.time || 0;
    const sel = w.slotInfo(w.selected);
    // The slot the bar speaks of: the one under the mouse, else the one being cast, else
    // the right button's weave (nothing a click leaves selected).
    const casting = w.castingSlot?.() ?? -1;
    const shown = this.hbHover >= 0 && this.hbHover < n ? this.hbHover : casting;
    const focus = shown >= 0 ? shown : w.selected;
    if (mana && mana.max > 0) {
      setStyle(this.hbManaFill, 'width', `${((100 * Math.max(0, mana.cur)) / mana.max).toFixed(1)}%`);
      // That weave's cost, as a brighter cap at the end of the bar (a charge being held
      // costs x(1 + k): the cap grows with it).
      const ch = w.chargeOf?.(focus);
      const c = Math.min(mana.cur, (w.slotInfo(focus).cost || 0) * (1 + (ch?.k || 0)));
      setStyle(this.hbManaCost, 'width', `${((100 * c) / mana.max).toFixed(1)}%`);
      setStyle(this.hbManaCost, 'left', `${((100 * Math.max(0, mana.cur - c)) / mana.max).toFixed(1)}%`);
      setText(this.hbManaText, `${Math.floor(mana.cur)} / ${Math.round(mana.max)}`);
    }
    let filled = 0;
    for (let i = 0; i < n; i++) if (w.weaveAt(i)) filled++;
    for (let i = 0; i < 6; i++) {
      const slot = this.hbSlots[i];
      const on = i < n;
      if (slot.b.hidden === on) slot.b.hidden = !on;
      if (!on) continue;
      const rec = w.slotInfo(i);
      if (ver !== this.hbVersion || slot.key !== rec.key) {
        slot.key = rec.key;
        paintSlot(slot, rec, i);
      }
      const rmb = i === w.selected && filled > 1;
      if (slot.rmb.hidden === rmb) slot.rmb.hidden = !rmb;
      paintSlotState(slot, rec, w, i, t);
    }
    // The name over the bar: the slot under the mouse, else the one being cast, else the
    // right button's weave for a moment after the wheel / Q / R changed it.
    if (w.selected !== this.hbSel) {
      if (this.hbSel !== undefined) this.hbSelT = t;
      this.hbSel = w.selected;
    }
    const nameOf = shown >= 0 ? w.slotInfo(shown) : t - (this.hbSelT ?? -9) < 2.5 ? sel : null;
    setText(this.hbName, nameOf?.weave ? nameOf.name : '');
    this.hbVersion = ver;
  }

  // Over the world a mouse player sees the reticle (aim_preview.js), not the arrow.
  syncCursor() {
    const c = this.game.canvas;
    if (!c?.style) return;
    const want = this.game.state === 'playing' && !this.ui.isTouch && !this.ui.stack?.length ? 'none' : '';
    if (this._cursor !== want) {
      this._cursor = want;
      c.style.cursor = want;
    }
  }

  // ---------- the compact phone HUD ----------
  // On a phone the HUD is one thin band: health and mana, Lyra's portrait (a tap opens
  // her Mind), the tracked mission as one short line, and the menu button. Upright,
  // the mission line sits under the band; sideways it fills the band's middle.

  watchLayout() {
    this.smallMq = media(SMALL_QUERY);
    this.portraitMq = media(PORTRAIT_PHONE_QUERY);
    this.stripMq = media(STRIP_QUERY);
    const relayout = () => {
      this.applyMini();
      this.queueLayout();
    };
    for (const mq of [this.smallMq, this.portraitMq, this.stripMq]) {
      try {
        mq?.addEventListener?.('change', relayout);
      } catch {
        /* old Safari: the periodic layout below still runs */
      }
    }
    if (typeof ResizeObserver === 'function') {
      try {
        this.ro = new ResizeObserver(() => this.queueLayout());
        this.ro.observe(this.cardsEl);
        this.ro.observe(this.rightEl);
      } catch {
        this.ro = null;
      }
    }
    this.applyMini();
  }

  isSmall() {
    return !!this.smallMq?.matches;
  }

  // The companion's card is only their portrait and mood on a phone (a tap opens People).
  isFolded() {
    return this.isSmall();
  }

  applyMini() {
    const folded = this.isFolded();
    toggleClass(this.compWrap, 'mini', folded);
    const name = this.view?.name || '';
    setAttr(this.compCard, 'aria-label', folded && name ? `${name}: open People` : null);
    toggleClass(this.ui.root, 'hud-small', folded);
  }

  // Talk (T): whoever is nearest in front of you (talk's ui.talkToNearest), else the chat.
  talk() {
    const ui = this.ui;
    if (typeof ui.talkToNearest === 'function') {
      ui.talkToNearest();
      return;
    }
    ui.chat?.open?.(true);
  }

  // The card's tap and Tab: People at whoever walks with you, else at You.
  openPeopleAtCompanion() {
    const ui = this.ui;
    const id = this.view?.id || 'you';
    if (typeof ui.openPeople === 'function') ui.openPeople(id);
    else ui.openMind?.(id === 'lyra' ? 'now' : 'you');
  }

  queueLayout() {
    if (this._layoutQueued) return;
    this._layoutQueued = true;
    const run = () => {
      this._layoutQueued = false;
      this.layoutTop();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else run();
  }

  // Phone held upright: the mission line spans the screen under the band. Sideways: it
  // takes the band's middle, between her portrait and the menu button. Elsewhere the
  // stylesheet places it (top centre).
  layoutTop() {
    const st = this.center.style;
    if (!this.el.hidden && this.stripMq?.matches) {
      this.layoutStrip();
      return;
    }
    this.unplaceStrip();
    if (this.el.hidden || !this.portraitMq?.matches) {
      if (this.questPlaced) {
        st.top = st.left = st.width = st.transform = '';
        this.questPlaced = false;
        this.center.classList.remove('tucked', 'beside');
      }
      return;
    }
    const root = this.el.getBoundingClientRect();
    const cards = this.cardsEl.getBoundingClientRect();
    const right = this.rightEl.getBoundingClientRect();
    if (!root.width || !right.width) return;
    const gap = 6;
    // Measured boxes are on-screen px; inside a zoomed HUD (ui_scale.js) a px is z of them.
    const z = this.ui._uiz || 1;
    const edgeL = (cards.left - root.left) / z;
    const edgeR = (right.right - root.left) / z;
    const top = (Math.max(cards.bottom, right.bottom) - root.top) / z + gap;
    st.top = `${Math.round(top)}px`;
    st.left = `${Math.round(edgeL)}px`;
    st.width = `${Math.round(edgeR - edgeL)}px`;
    st.transform = 'none';
    this.questPlaced = true;
    this.center.classList.add('tucked');
    this.center.classList.remove('beside');
  }

  layoutStrip() {
    const root = this.el.getBoundingClientRect();
    const cards = this.cardsEl.getBoundingClientRect();
    const right = this.rightEl.getBoundingClientRect();
    if (!root.width || !right.width || !cards.width) return;
    const gap = 10;
    const z = this.ui._uiz || 1; // (see layoutTop)
    const left = (cards.right - root.left) / z + gap;
    const st = this.center.style;
    const width = (right.left - root.left) / z - gap - left;
    st.left = `${Math.round(left)}px`;
    st.top = `${Math.round((cards.top - root.top) / z + Math.max(0, (Math.min(cards.height / z, 46) - 34) / 2))}px`;
    st.width = `${Math.max(0, Math.round(width))}px`;
    st.transform = 'none';
    this.center.hidden = width < 70;
    this.questPlaced = true;
    this.stripPlaced = true;
    this.center.classList.add('in-strip');
    this.center.classList.remove('tucked', 'beside');
  }

  unplaceStrip() {
    if (!this.stripPlaced) return;
    this.stripPlaced = false;
    const st = this.center.style;
    st.top = st.left = st.width = st.transform = '';
    this.center.hidden = false;
    this.questPlaced = false;
    this.center.classList.remove('in-strip');
  }

  // Tell the bubbles where the HUD is, so nobody speaks from under a card.
  updateKeepOut(dt) {
    this.keepT -= dt;
    if (this.keepT > 0) return;
    this.keepT = KEEP_OUT_EVERY;
    const b = this.game.bubbles;
    if (!b?.setKeepOut) return;
    const out = this._keep;
    out.length = 0;
    const canvas = this.game.renderer?.canvas;
    if (!this.el.hidden && this.game.state === 'playing' && !this.ui.stack?.length && canvas?.getBoundingClientRect) {
      const c = canvas.getBoundingClientRect();
      const root = this.ui.root || this.el;
      for (const el of root.querySelectorAll(KEEP_OUT_SELECTOR)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) out.push({ x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height });
      }
    }
    try {
      b.setKeepOut(out);
    } catch {
      /* bubbles are optional */
    }
  }

  toggleQuestFull(force) {
    const open = force ?? !this.questLine.classList.contains('full');
    toggleClass(this.questLine, 'full', open);
    this.questOpenT = open ? 7 : 0;
  }

  buildJobsMenu() {
    const seg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Deliver to' });
    this.deliverBtns = {};
    for (const d of DELIVER_OPTIONS) {
      const b = h('button', { type: 'button', class: 'seg', role: 'radio', 'aria-checked': d.id === this.deliverTo ? 'true' : 'false', text: d.label });
      b.addEventListener('click', () => {
        this.deliverTo = d.id;
        for (const [id, el] of Object.entries(this.deliverBtns)) el.setAttribute('aria-checked', id === d.id ? 'true' : 'false');
      });
      this.deliverBtns[d.id] = b;
      seg.append(b);
    }
    const list = h('div', { class: 'jobs-list' });
    for (const j of JOBS) {
      const b = h(
        'button',
        { type: 'button', class: 'job' },
        icon(j.icon),
        h('span', { class: 'job-text' }, h('span', { class: 'job-name', text: j.label }), h('span', { class: 'job-note', text: j.note })),
      );
      b.addEventListener('click', () => {
        this.ui.runJob(j, this.deliverTo);
        this.closeJobs();
      });
      list.append(b);
    }
    const stop = button('Ask her to stop', { cls: 'btn-ghost btn-small', onClick: () => {
      this.ui.runStopJob();
      this.closeJobs();
    } });
    this.jobsMenuTitle = h('span', { class: 'jobs-title', text: 'Ask her to take on a job' });
    const menu = h('div', { class: 'jobs-menu', hidden: true, role: 'menu' }, h('div', { class: 'jobs-head' }, this.jobsMenuTitle, h('span', { class: 'jobs-deliver', text: 'Deliver:' }), seg), list, stop);
    menu.addEventListener('pointerdown', (e) => e.stopPropagation());
    return menu;
  }

  toggleJobs(e) {
    e?.stopPropagation?.();
    if (this.jobsOpen) this.closeJobs();
    else this.openJobs(false);
  }

  openJobs(sheet) {
    this.jobsOpen = true;
    this.jobsMenu.hidden = false;
    toggleClass(this.jobsMenu, 'as-sheet', !!sheet);
    toggleClass(this.jobsBtn, 'active', true);
    this.game.audio?.play('ui_open');
  }

  closeJobs() {
    if (!this.jobsOpen) return;
    this.jobsOpen = false;
    this.jobsMenu.hidden = true;
    toggleClass(this.jobsBtn, 'active', false);
  }

  toggleRadial() {
    this.radialOpen = !this.radialOpen;
    toggleClass(this.radial.parentElement, 'open', this.radialOpen);
    this.ui.root.classList.toggle('radial-open', this.radialOpen);
    setAttr(this.radial, 'aria-hidden', this.radialOpen ? 'false' : 'true');
    this.game.audio?.play(this.radialOpen ? 'ui_open' : 'ui_close');
  }

  closeRadial() {
    if (!this.radialOpen) return;
    this.toggleRadial();
  }

  // Show the radial items that fit the bar (Jobs only while Lyra, who has them, is the one)
  // and spread them evenly on the arc.
  layoutRadial(mode) {
    const jobs = !!this.view?.jobs;
    const show = mode === 'hidden' ? new Set(['talk']) : new Set(this.radialItems.map((it) => it.id).filter((id) => id !== 'jobs' || jobs));
    let i = 0;
    const n = this.radialItems.filter((it) => show.has(it.id)).length;
    for (const it of this.radialItems) {
      const on = show.has(it.id);
      it.el.hidden = !on;
      if (on) {
        it.el.style.setProperty('--i', String(i));
        it.el.style.setProperty('--n', String(n));
        i++;
      }
    }
  }

  // full: someone walks with you (every request) · hidden: you walk alone (no card, no Ask
  // bar, no orders; Talk stays in the corner).
  applyMode(mode) {
    const jobs = !!this.view?.jobs;
    const key = `${mode}:${jobs}`;
    if (key === this.modeKey) return;
    this.modeKey = key;
    this.mode = mode;
    const full = mode === 'full';
    for (const c of COMMANDS) this.cmdButtons[c.id].hidden = !full;
    this.jobsBtn.hidden = !full || !jobs;
    this.cmdbar.hidden = !full;
    this.ordersWrap.hidden = !full;
    this.compWrap.hidden = !full;
    this.cmdbar.dataset.mode = mode;
    if (!full || !jobs) this.closeJobs();
    this.closeRadial();
    this.layoutRadial(mode);
    this.ui.root.classList.toggle('has-companion', full);
    this.ui.root.classList.toggle('no-companion', !full);
    this.queueLayout();
  }

  // Who holds the slot, where they stand with you, and what the bar offers. Cheap enough to
  // run twice a second; `force` redraws at once after an event.
  refreshCompanion(force = false) {
    const v = companionView(this.game);
    this.view = v;
    const key = v ? `${v.id}:${v.cs}:${v.standing.key}` : '';
    if (key !== this.cs || force) {
      const who = (v?.id || '') !== String(this.cs).split(':')[0];
      this.cs = key;
      if (who) this.lastExpr = '';
      if (v) {
        setText(this.csChip, v.standing.label);
        this.csChip.dataset.tone = v.standing.tone;
        this.compCard.dataset.cs = v.isLyra ? v.cs : 'together';
        this.compCard.dataset.who = v.isLyra ? 'lyra' : 'villager';
        this.cmdbar.dataset.cs = v.cs;
        setText(this.barTitle, v.barTitle);
        setAttr(this.cmdbar, 'aria-label', v.askLabel);
        setAttr(this.ordersBtn, 'title', v.askLabel);
        setAttr(this.compCard, 'title', v.cardTitle);
        setAttr(this.lHp.el, 'aria-label', `${v.name}'s health`);
        setText(this.jobsMenuTitle, `Ask ${v.name} to take on a job`);
      }
      this.applyMode(companionBarMode(v));
      this.applyMini();
    }
    if (!v) return;
    const rel = v.rel && 'trust' in v.rel ? v.rel : null;
    this.trustMini.hidden = !rel;
    this.fearMini.hidden = !rel;
    this.relRow.classList.toggle('no-rel', !v.rel);
    if (rel) {
      setStyle(this.trustFill, 'width', `${Math.round(rel.trust)}%`);
      setStyle(this.fearFill, 'width', `${Math.round(rel.fear)}%`);
      setAttr(this.trustMini, 'title', `Trust ${Math.round(rel.trust)}: she ${trustWords(rel.trust)}`);
      setAttr(this.fearMini, 'title', `Fear ${Math.round(rel.fear)}: she ${fearWords(rel.fear)}`);
      toggleClass(this.trustMini, 'low', rel.trust < 25);
      toggleClass(this.fearMini, 'high', rel.fear > 35);
    } else if (v.rel && 'opinion' in v.rel) setAttr(this.csChip, 'title', `${v.name} thinks of you as ${v.standing.label.toLowerCase()} (${Math.round(v.rel.opinion)})`);
  }

  // A brief shake of the companion's card when they turn a request down.
  flashRefusal() {
    if (this.compWrap.hidden) return;
    this.compCard.classList.remove('refused');
    void this.compCard.offsetWidth; // restart the animation
    this.compCard.classList.add('refused');
    this.refusedT = 0.9;
  }

  // Dismiss popovers on any outside tap.
  outsidePointer(target) {
    if (this.jobsOpen && !this.jobsMenu.contains(target) && !this.jobsBtn.contains(target)) this.closeJobs();
    if (this.radialOpen && !this.radial.parentElement.contains(target)) this.closeRadial();
  }

  show(on) {
    this.el.hidden = !on;
    if (on) {
      this.applyMini();
      this.queueLayout();
    }
  }

  setQuest(text) {
    this.storyQuest = String(text || '').trim();
    this.refreshMission(true);
  }

  // The quest line shows the tracked mission and its objective (DESIGN §22.3), or the
  // story's objective when no mission is tracked.
  refreshMission(force = false) {
    let line = null;
    try {
      line = this.game.missions?.hudLine?.() || null;
    } catch {
      line = null;
    }
    const t = line ? `${line.title}: ${line.text}` : this.storyQuest || '';
    if (!force && t === this.questShown) return;
    this.questShown = t;
    setText(this.questText, t);
    setAttr(this.questLine, 'title', t || null);
    toggleClass(this.questLine, 'is-mission', !!line);
    this.questLine.hidden = !t;
  }

  setPrompt(label, touch) {
    const t = String(label || '').trim();
    if (!t) {
      if (!this.prompt.hidden) this.prompt.hidden = true;
      return;
    }
    setText(this.promptKey, touch ? 'Tap' : 'E');
    setText(this.promptText, t);
    if (this.prompt.hidden) this.prompt.hidden = false;
  }

  // label: what to show ('' hides it); busy: a listen is already under way.
  setListen(label, busy = false) {
    const t = String(label || '').trim();
    if (!t) {
      if (!this.listenBtn.hidden) this.listenBtn.hidden = true;
      return;
    }
    setText(this.listenText, t);
    toggleClass(this.listenBtn, 'is-busy', !!busy);
    setAttr(this.listenBtn, 'aria-disabled', busy ? 'true' : null);
    if (this.listenBtn.hidden) this.listenBtn.hidden = false;
  }

  setUnread(n) {
    this.ui.touch?.setUnread?.(n);
    if (n > 0) {
      setText(this.chatBadge, n > 9 ? '9+' : String(n));
      if (this.chatBadge.hidden) this.chatBadge.hidden = false;
    } else if (!this.chatBadge.hidden) this.chatBadge.hidden = true;
  }

  update(dt) {
    const g = this.game;
    this.bossBar?.reveal?.update(dt);
    this.ui.character?.update?.(dt);
    this.updateKeepOut(dt);
    if (this.el.hidden || !g.player) return;
    this.tick += dt;
    if (this.tick < 0.1) return;
    this.tick = 0;
    this.slowTick += 0.1;
    const p = g.player;
    const s = g.settings || {};
    // Fallen (§27): the fight is over for now — the combat buttons step aside for the
    // fall's own screen (Call for help, crawl).
    toggleClass(this.ui.root, 'player-down', !!p.downed);
    toggleClass(this.ui.root, 'quest-off', s.showQuestLine === false);

    setText(this.pName, s.playerName || p.name || 'Traveler');
    setText(this.pLevel, `Lv ${p.level ?? 1}`);
    this.pHp.set(frac(p.hp, p.maxHp), hpText(p.hp, p.maxHp));
    toggleClass(this.pHp.el, 'low', frac(p.hp, p.maxHp) < 0.3);
    const xpNext = this.xpNeeded(p);
    if (xpNext) this.pXp.set(frac(p.xp, xpNext), `${fmtInt(p.xp)} / ${fmtInt(xpNext)} xp`);
    else this.pXp.set(0, `${fmtInt(p.xp || 0)} xp`);
    const coins = p.inventory?.count?.('coin') ?? p.gold ?? 0;
    setText(this.pCoins, fmtInt(coins));
    this.renderBuffs();

    if (this.questOpenT > 0) {
      this.questOpenT -= 0.1;
      if (this.questOpenT <= 0) this.toggleQuestFull(false);
    }
    if (!this.ro) {
      this.layoutT -= 0.1;
      if (this.layoutT <= 0) {
        this.layoutT = 0.5;
        this.layoutTop();
      }
    }

    // The companion slot: whoever walks with you now (companion_view.js), or nobody.
    const v = this.view;
    const c = v ? this.safe(() => g.party?.holder) || (v.isLyra ? g.lyra || g.companion : null) : null;
    if (v && c) {
      setText(this.lName, v.name);
      const hp = Number(c.hp) || 0;
      const max = Math.max(1, Number(c.maxHp) || 1);
      this.lHp.set(frac(hp, max), hpText(hp, max));
      setStyle(this.lMiniHp, 'width', `${Math.round(frac(hp, max) * 100)}%`);
      toggleClass(this.compCard, 'downed', !!c.downed);
      const stance = v.isLyra ? c.behavior?.stance || 'defend' : c.duty?.stance || 'defend';
      setIcon(this.lStanceIcon, STANCE_ICON[stance] || 'shield');
      setText(this.lStance.lastChild, stanceLabel(stance));
      this.lStance.dataset.stance = stance;
      if (v.isLyra) {
        const live = companionView(g);
        setText(this.lStatus, live?.status || '');
        this.refreshCommands(c.behavior);
      } else {
        setText(this.lStatus, c.downed ? 'down · needs help' : c.mode === 'fight' ? 'fighting beside you' : c.duty?.directive === 'stay' ? 'waiting where you asked' : 'following you');
        this.refreshDutyCommands(c.duty);
      }
    }
    // Mood, portrait and how they stand with you change slowly; twice a second is plenty.
    if (this.slowTick >= 0.5) {
      this.slowTick = 0;
      this.refreshMission();
      this.safe(() => syncBadge(this.ui));
      this.refreshCompanion();
      if (this.view && c) this.refreshMood(c, this.view);
    }
    if (this.refusedT > 0) {
      this.refusedT -= 0.1;
      if (this.refusedT <= 0) this.compCard.classList.remove('refused');
    }

    const loc = this.safe(() => g.locations?.at(p.x, p.y));
    setText(this.place, loc?.name || 'The Wilds');
    const clock = g.clock;
    if (clock) {
      setText(this.clock, clock.timeString());
      setText(this.dayEl, `Day ${clock.day}`);
      const wt = clock.weather?.type || 'clear';
      setIcon(this.wIcon, weatherIconKey(wt, clock.isNight));
      setText(this.wLabel, weatherLabel(wt, clock.isNight));
    }
    if (s.showFps) {
      if (this.fps.hidden) this.fps.hidden = false;
      setText(this.fps, `${g.loop?.fps ?? 0} fps`);
    } else if (!this.fps.hidden) this.fps.hidden = true;
  }

  // One chip per running gain, cost or weakness: its price's color, seconds left; a tap
  // says what it is (and douses emberblood).
  renderBuffs() {
    const g = this.game;
    const list = this.safe(() => g.prices?.timers?.(g.player)) || [];
    const key = list.map((m) => `${m.id}:${Number.isFinite(m.left) ? Math.ceil(m.left) : '-'}`).join('|');
    if (key === this.buffKey) return;
    this.buffKey = key;
    const row = this.buffRow;
    while (row.firstChild) row.firstChild.remove();
    for (const m of list.slice(0, 8)) {
      const dot = h('span', { class: 'buff-dot', 'aria-hidden': 'true' });
      const glyph = m.price ? PRICE_GLYPH[m.price] || '' : '';
      if (glyph) dot.textContent = glyph;
      const left = Number.isFinite(m.left) ? fmtSeconds(m.left) : m.tap ? '✕' : '∞';
      const chip = h('button', { type: 'button', class: `buff ${m.kind || 'buff'}`, title: `${m.label}${m.tap ? ' (tap to douse)' : ''}` }, dot, h('span', { class: 'num', text: left }));
      chip.style.setProperty('--pc', m.color || (m.kind === 'cost' || m.kind === 'weak' ? '#ff6b5e' : '#58cf8f'));
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        if (m.tap === 'douse') g.prices?.douse?.(m.price);
        else this.ui.toast(`${m.label}${Number.isFinite(m.left) ? ` — ${fmtSeconds(m.left)} left` : ''}`, m.kind === 'cost' || m.kind === 'weak' ? 'warn' : 'info');
      });
      row.append(chip);
    }
  }

  refreshMood(c, v = this.view) {
    if (!v) return;
    const mind = v.isLyra ? c.mind : null;
    let mood = null;
    try {
      mood = mind?.mood?.() || null;
    } catch {
      mood = null;
    }
    setText(this.lMood, moodEmoji(mood));
    setText(this.lMiniMood, moodEmoji(mood));
    setAttr(this.lMood, 'title', mood?.label ? `Mood: ${mood.label}` : null);
    setAttr(this.lMood, 'aria-label', mood?.label ? `Mood: ${mood.label}` : 'Mood');
    if (!v.isLyra) {
      // A villager's face says how they feel about you (their opinion), no more.
      const face = { fond: '😊', friendly: '🙂', neutral: '😐', wary: '😟', hostile: '😠' }[v.standing.key] || '';
      setText(this.lMood, face);
      setText(this.lMiniMood, face);
      setAttr(this.lMood, 'title', `${v.standing.label}`);
    }
    const expr = c.downed ? 'sad' : v.expr || 'neutral';
    const pkey = `${v.portraitKey}|${expr}`;
    if (pkey !== this.lastExpr) {
      const url = portraitUrl(this.game, v.portraitKey, expr);
      if (url) this.lPortrait.src = url;
      this.lastExpr = pkey;
    }
  }

  refreshCommands(beh) {
    const dir = beh?.directive?.type;
    const stance = beh?.stance;
    const on = {
      follow: dir === 'follow',
      stay: dir === 'stay' || dir === 'guard',
      attack: stance === 'attack',
      defend: stance === 'defend',
      passive: stance === 'passive',
    };
    for (const id in on) {
      if (this.cmdButtons[id]) toggleClass(this.cmdButtons[id], 'active', on[id]);
      if (this.cmdButtons[`r_${id}`]) toggleClass(this.cmdButtons[`r_${id}`], 'active', on[id]);
    }
    toggleClass(this.jobsBtn, 'working', dir === 'job');
  }

  // The same buttons lit for a villager's duty (follow / wait, and the stance).
  refreshDutyCommands(duty) {
    const on = {
      follow: duty?.directive === 'follow',
      stay: duty?.directive === 'stay',
      attack: duty?.stance === 'attack',
      defend: duty?.stance === 'defend',
      passive: duty?.stance === 'passive',
    };
    for (const id in on) {
      if (this.cmdButtons[id]) toggleClass(this.cmdButtons[id], 'active', on[id]);
      if (this.cmdButtons[`r_${id}`]) toggleClass(this.cmdButtons[`r_${id}`], 'active', on[id]);
    }
    toggleClass(this.jobsBtn, 'working', false);
  }

  xpNeeded(p) {
    const g = this.game;
    const v = p.xpNext ?? p.xpToNext ?? p.nextLevelXp ?? this.safe(() => g.combat?.xpForLevel?.((p.level || 1) + 1));
    return Number(v) > 0 ? Number(v) : 0;
  }

  safe(fn) {
    try {
      return fn();
    } catch {
      return null;
    }
  }
}
