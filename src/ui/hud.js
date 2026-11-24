// The in-game HUD: player and Lyra cards (with where she stands with you), place /
// clock / weather, the quest line, the interact prompt, the "Ask Lyra" bar (with its
// Jobs menu) and its radial form on small screens. DOM writes happen only on change.
// On phones the HUD folds small so the world stays visible: Lyra's card shrinks to her
// portrait and mood (tap to unfold), and the quest line tucks in beside it.

import { h, icon, setIcon, setText, setStyle, toggleClass, meter, button, setAttr } from './dom.js';
import { COMMANDS, JOBS, DELIVER_OPTIONS, REJOIN } from './content.js';
import { hpText, frac, fmtInt, lyraStatusLine, weatherIconKey, weatherLabel, moodEmoji, moodToExpression, stanceLabel } from './format.js';
import { portraitUrl } from './art.js';
import { companionshipOf, companionshipLabel, companionshipTone, barMode, playerRelation, trustWords, fearWords, farewellText } from './lyra_view.js';

const STANCE_ICON = { attack: 'sword', defend: 'shield', passive: 'feather', self_defense: 'shield' };

// Phones and short screens get the compact HUD (the same breakpoints as styles.css).
const SMALL_QUERY = '(max-width: 640px), (max-height: 520px)';
const PORTRAIT_PHONE_QUERY = '(max-width: 640px) and (min-height: 521px)';
const MINI_KEY = 'hearthlight.hud.lyraMini';

function readMiniPref() {
  try {
    const v = window.localStorage?.getItem(MINI_KEY);
    return v === null || v === undefined ? true : v === '1';
  } catch {
    return true;
  }
}

function saveMiniPref(on) {
  try {
    window.localStorage?.setItem(MINI_KEY, on ? '1' : '0');
  } catch {
    /* private mode: the choice lasts for this visit only */
  }
}

function media(q) {
  try {
    return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null;
  } catch {
    return null;
  }
}

// The tab on the bar says what asking means right now.
const BAR_TITLES = {
  together: (n) => `Ask ${n}`,
  wary: (n) => `Ask ${n} · she is wary`,
  apart: (n) => `${n} is living her own life`,
  left: (n) => `${n} left you`,
};

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
    this.cs = ''; // companionship state last drawn
    this.mode = ''; // bar mode last applied: full | collapsed | hidden
    this.farewell = '';
    this.refusedT = 0;
    this.mini = readMiniPref(); // Lyra's card folded to portrait + mood (small screens only)
    this.layoutT = 0;
    this.el = this.build();
    this.watchLayout();
  }

  build() {
    const g = this.game;
    // Player card
    this.pName = h('span', { class: 'card-name' });
    this.pLevel = h('span', { class: 'card-level num' });
    this.pHp = meter('meter-hp', 'Health');
    this.pXp = meter('meter-xp', 'Experience');
    this.pCoins = h('span', { class: 'coins-num num' });
    const playerCard = h(
      'div',
      { class: 'card player-card' },
      h('div', { class: 'card-row' }, icon('heart', 'card-glyph'), this.pName, this.pLevel, h('span', { class: 'coins' }, icon('coin'), this.pCoins)),
      this.pHp.el,
      this.pXp.el,
    );

    // Lyra card (tap -> her mind): who she is to you right now, not a unit frame.
    this.lPortrait = h('img', { class: 'portrait portrait-hud', alt: '', draggable: 'false' });
    this.lName = h('span', { class: 'card-name' });
    this.lMood = h('span', { class: 'mood-emoji', role: 'img' });
    this.lStanceIcon = icon('shield');
    this.lStance = h('span', { class: 'stance-badge' }, this.lStanceIcon, h('span', { class: 'stance-text' }));
    this.lHp = meter('meter-lyra', `Lyra's health`);
    this.lStatus = h('div', { class: 'lyra-status' });
    this.csChip = h('span', { class: 'cs-chip', 'data-tone': 'good' });
    this.trustFill = h('i', { class: 'mini-fill' });
    this.fearFill = h('i', { class: 'mini-fill' });
    this.trustMini = h('span', { class: 'mini mini-trust' }, h('span', { class: 'mini-label', text: 'Trust' }), h('span', { class: 'mini-track' }, this.trustFill));
    this.fearMini = h('span', { class: 'mini mini-fear' }, h('span', { class: 'mini-label', text: 'Fear' }), h('span', { class: 'mini-track' }, this.fearFill));
    this.relRow = h('span', { class: 'rel-row' }, this.csChip, this.trustMini, this.fearMini);
    this.farewellEl = h('span', { class: 'farewell', hidden: true });
    this.lyraLive = h('span', { class: 'lyra-live' }, this.lHp.el, this.lStatus);
    // Folded (phones): her portrait with the mood on its corner and a hairline of health.
    this.lMiniHp = h('i', { class: 'mini-hp-fill' });
    this.lMiniMood = h('span', { class: 'mini-mood', 'aria-hidden': 'true' });
    this.lyraCard = h(
      'button',
      { type: 'button', class: 'card lyra-card', title: "Open Lyra's mind (Tab)" },
      h('span', { class: 'portrait-frame' }, this.lPortrait, this.lMiniMood, h('span', { class: 'mini-hp' }, this.lMiniHp)),
      h('span', { class: 'lyra-info' }, h('span', { class: 'card-row' }, this.lName, this.lMood, this.lStance), this.lyraLive, this.relRow, this.farewellEl),
      h('span', { class: 'unfold-chev', 'aria-hidden': 'true', text: '›' }),
    );
    this.lyraCard.addEventListener('click', () => {
      if (this.isFolded()) this.setMini(false);
      else this.ui.openMind(this.cs && this.cs !== 'together' ? 'you' : 'now');
    });
    this.foldBtn = h('button', { type: 'button', class: 'lyra-fold', title: "Fold Lyra's card", 'aria-label': "Fold Lyra's card" }, h('span', { class: 'fold-chev', 'aria-hidden': 'true', text: '‹' }));
    this.foldBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setMini(true);
    });
    this.lyraWrap = h('div', { class: 'lyra-wrap' }, this.lyraCard, this.foldBtn);

    // Place, clock and weather
    this.place = h('div', { class: 'place-name' });
    this.wIcon = icon('sun', 'weather-icon');
    this.clock = h('span', { class: 'clock num' });
    this.dayEl = h('span', { class: 'day num' });
    this.wLabel = h('span', { class: 'weather-label' });
    const placeCard = h('div', { class: 'card place-card' }, this.place, h('div', { class: 'clock-row' }, this.wIcon, this.clock, h('span', { class: 'dot' }), this.dayEl, this.wLabel));

    // Corner buttons
    this.chatBadge = h('span', { class: 'badge', hidden: true });
    const chatBtn = button('', { icon: 'talk', cls: 'btn-icon hud-btn', title: 'Talk to Lyra (T)', onClick: () => this.ui.chat.toggle() });
    chatBtn.append(this.chatBadge);
    const mindBtn = button('', { icon: 'mind', cls: 'btn-icon hud-btn', title: "Lyra's mind (Tab)", onClick: () => this.ui.toggleMind() });
    const bagBtn = button('', { icon: 'bag', cls: 'btn-icon hud-btn', title: 'Inventory (I)', onClick: () => this.ui.toggleInventory() });
    const pauseBtn = button('', { icon: 'pause', cls: 'btn-icon hud-btn', title: 'Pause (Esc)', onClick: () => this.ui.openPause() });
    const corner = h('div', { class: 'hud-buttons' }, chatBtn, mindBtn, bagBtn, pauseBtn);

    // Quest line
    this.questText = h('span', { class: 'quest-text' });
    this.questLine = h('div', { class: 'quest-line', hidden: true }, icon('scroll'), this.questText);
    // On a phone the line is one short row; a tap shows all of it for a while.
    this.questOpenT = 0;
    this.questLine.addEventListener('click', () => this.toggleQuestFull());

    // Interact prompt
    this.promptKey = h('kbd', { class: 'keycap', text: 'E' });
    this.promptText = h('span', { class: 'prompt-text' });
    this.prompt = h('button', { type: 'button', class: 'interact-prompt', hidden: true }, this.promptKey, this.promptText);
    this.prompt.addEventListener('click', () => g.input?.press('interact'));

    // "Listen in" while two villagers talk nearby (§19.3): small, a key or a tap.
    this.listenKey = h('kbd', { class: 'keycap', text: 'L' });
    this.listenText = h('span', { class: 'listen-text' });
    this.listenBtn = h('button', { type: 'button', class: 'listen-prompt', hidden: true, title: 'Listen in on their conversation (L)' }, this.listenKey, icon('ear'), this.listenText);
    this.listenBtn.addEventListener('click', () => this.ui.village?.listenIn());

    // The "Ask Lyra" bar: every button is a request she weighs and answers (§16.4).
    this.cmdButtons = {};
    this.barTitle = h('span', { class: 'cmdbar-title', text: 'Ask Lyra' });
    this.cmdbar = h('nav', { class: 'cmdbar', 'aria-label': 'Ask Lyra' }, this.barTitle);
    for (const c of COMMANDS) {
      const b = button(c.label, { icon: c.icon, cls: `cmd cmd-${c.id}`, key: c.key, title: c.hint, onClick: () => this.ui.runCommand(c.id) });
      this.cmdButtons[c.id] = b;
      this.cmdbar.append(b);
    }
    this.jobsBtn = button('Jobs', { icon: 'axe', cls: 'cmd cmd-jobs', title: 'Ask her to take on a job', onClick: (e) => this.toggleJobs(e) });
    this.jobsBtn.append(h('span', { class: 'caret', text: '▾' }));
    this.rejoinBtn = button(REJOIN.label, { icon: REJOIN.icon, cls: 'cmd cmd-rejoin', title: REJOIN.hint, onClick: () => this.ui.askBack() });
    this.rejoinBtn.hidden = true;
    const talkBtn = button('Talk', { icon: 'talk', cls: 'cmd cmd-talk', key: 'T', title: 'Talk with Lyra', onClick: () => this.ui.chat.open(true) });
    this.cmdbar.append(this.jobsBtn, this.rejoinBtn, talkBtn);

    this.jobsMenu = this.buildJobsMenu();

    // Radial requests (small screens). Which items show depends on the bar mode.
    this.ordersBtn = button('', { icon: 'spark', cls: 'orders-btn', title: 'Ask Lyra', onClick: () => this.toggleRadial() });
    this.radial = h('div', { class: 'radial', 'aria-hidden': 'true' });
    this.radialItems = [...COMMANDS.map((c) => ({ id: c.id, label: c.label, icon: c.icon })), { id: 'jobs', label: 'Jobs', icon: 'axe' }, { id: REJOIN.id, label: REJOIN.short, icon: REJOIN.icon }, { id: 'talk', label: 'Talk', icon: 'talk' }];
    for (const it of this.radialItems) {
      const b = button(it.label, { icon: it.icon, cls: `radial-item radial-${it.id}` });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeRadial();
        if (it.id === 'jobs') this.openJobs(true);
        else if (it.id === 'talk') this.ui.chat.open(true);
        else if (it.id === REJOIN.id) this.ui.askBack();
        else this.ui.runCommand(it.id);
      });
      it.el = b;
      this.cmdButtons[`r_${it.id}`] = b;
      this.radial.append(b);
    }
    this.ordersWrap = h('div', { class: 'orders' }, this.radial, this.ordersBtn);
    this.layoutRadial('full');

    this.fps = h('div', { class: 'fps num', hidden: true });

    this.cardsEl = h('div', { class: 'hud-cards' }, playerCard, this.lyraWrap);
    this.rightEl = h('div', { class: 'hud-right' }, placeCard, corner);
    const top = h('div', { class: 'hud-top' }, this.cardsEl, this.rightEl);
    const center = h('div', { class: 'hud-center' }, this.questLine);
    this.center = center;
    const bottom = h('div', { class: 'hud-bottom' }, this.listenBtn, this.prompt, this.cmdbar);
    return h('div', { class: 'hud', hidden: true }, top, center, bottom, this.ordersWrap, this.jobsMenu, this.fps);
  }

  // ---------- the compact phone HUD ----------

  watchLayout() {
    this.smallMq = media(SMALL_QUERY);
    this.portraitMq = media(PORTRAIT_PHONE_QUERY);
    const relayout = () => {
      this.applyMini();
      this.queueLayout();
    };
    for (const mq of [this.smallMq, this.portraitMq]) {
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

  isFolded() {
    return this.mini && this.isSmall();
  }

  setMini(on) {
    on = !!on;
    if (on === this.mini) return;
    this.mini = on;
    saveMiniPref(on);
    this.applyMini();
    this.game.audio?.play(on ? 'ui_close' : 'ui_open');
    this.queueLayout();
  }

  applyMini() {
    const folded = this.isFolded();
    toggleClass(this.lyraWrap, 'mini', folded);
    setAttr(this.lyraCard, 'aria-expanded', this.isSmall() ? String(!folded) : null);
    const name = this.game.settings?.companionName || this.game.companion?.name || 'Lyra';
    setAttr(this.lyraCard, 'aria-label', folded ? `${name}: show her card` : null);
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

  // Phone held upright: the quest line tucks in under the corner buttons, beside Lyra's
  // folded card, or under both cards when hers is open. Elsewhere the stylesheet
  // places it (top centre).
  layoutTop() {
    const st = this.center.style;
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
    const lyra = this.lyraWrap.getBoundingClientRect();
    const right = this.rightEl.getBoundingClientRect();
    if (!root.width || !right.width) return;
    const gap = 6;
    const edgeL = cards.left - root.left;
    const edgeR = right.right - root.left;
    let top = right.bottom - root.top + gap;
    let left = edgeL;
    let beside = false;
    if (lyra.bottom - root.top + gap > top) {
      // Her card reaches below the buttons: sit beside it if the line still has room.
      left = lyra.right - root.left + 8;
      beside = true;
    }
    if (edgeR - left < 200) {
      top = Math.max(cards.bottom, right.bottom) - root.top + gap;
      left = edgeL;
      beside = false;
    }
    st.top = `${Math.round(top)}px`;
    st.left = `${Math.round(left)}px`;
    st.width = `${Math.round(edgeR - left)}px`;
    st.transform = 'none';
    this.questPlaced = true;
    this.center.classList.add('tucked');
    toggleClass(this.center, 'beside', beside);
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
    const menu = h('div', { class: 'jobs-menu', hidden: true, role: 'menu' }, h('div', { class: 'jobs-head' }, h('span', { class: 'jobs-title', text: 'Ask Lyra to take on a job' }), h('span', { class: 'jobs-deliver', text: 'Deliver:' }), seg), list, stop);
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

  // Show the radial items that fit the bar mode and spread them evenly on the arc.
  layoutRadial(mode) {
    const show = mode === 'collapsed' ? new Set([REJOIN.id, 'talk']) : new Set(this.radialItems.map((it) => it.id).filter((id) => id !== REJOIN.id));
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

  // full: every request · collapsed: only Talk and "Ask her back" · hidden: she is gone.
  applyMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    const full = mode === 'full';
    for (const c of COMMANDS) this.cmdButtons[c.id].hidden = !full;
    this.jobsBtn.hidden = !full;
    this.rejoinBtn.hidden = mode !== 'collapsed';
    this.cmdbar.hidden = mode === 'hidden';
    this.ordersWrap.hidden = mode === 'hidden';
    this.cmdbar.dataset.mode = mode;
    if (!full) this.closeJobs();
    this.closeRadial();
    this.layoutRadial(mode);
    this.ui.root.classList.toggle('lyra-gone', mode === 'hidden');
  }

  // Companionship chip, trust and fear, and what the bar offers. Cheap enough to run
  // twice a second; `force` redraws at once after an event.
  refreshCompanion(force = false) {
    const g = this.game;
    const c = g.companion;
    const mind = c?.mind;
    const state = companionshipOf(g);
    const name = g.settings?.companionName || c?.name || 'Lyra';
    if (state !== this.cs || force) {
      const changed = state !== this.cs;
      this.cs = state;
      setText(this.csChip, companionshipLabel(state));
      this.csChip.dataset.tone = companionshipTone(state);
      this.lyraCard.dataset.cs = state;
      this.cmdbar.dataset.cs = state;
      setText(this.barTitle, BAR_TITLES[state] ? BAR_TITLES[state](name) : `Ask ${name}`);
      this.applyMode(barMode(state));
      if (changed && state !== 'gone') this.farewell = '';
    }
    const gone = state === 'gone';
    this.lyraLive.hidden = gone;
    this.trustMini.hidden = gone;
    this.fearMini.hidden = gone;
    this.lStance.hidden = gone;
    this.lMood.hidden = gone;
    toggleClass(this.lyraCard, 'gone', gone);
    if (gone) {
      // Her last words, as many whole sentences as the card holds on this screen.
      const narrow = (this.ui.root.clientWidth || 1280) < 640;
      const words = farewellText(mind, g.flags, narrow ? 100 : 180) || this.farewell;
      if (words) this.farewell = words;
      setText(this.farewellEl, this.farewell ? `“${this.farewell}”` : `${name} walked away down the King's Road.`);
      setAttr(this.lyraCard, 'title', this.farewell ? `${name}'s last words: “${this.farewell}”` : `${name} is gone`);
      if (this.farewellEl.hidden) this.farewellEl.hidden = false;
      return;
    }
    if (!this.farewellEl.hidden) this.farewellEl.hidden = true;
    setAttr(this.lyraCard, 'title', `Open ${name}'s mind (Tab)`);
    const rel = playerRelation(mind);
    this.relRow.classList.toggle('no-rel', !rel);
    if (rel) {
      setStyle(this.trustFill, 'width', `${Math.round(rel.trust)}%`);
      setStyle(this.fearFill, 'width', `${Math.round(rel.fear)}%`);
      setAttr(this.trustMini, 'title', `Trust ${Math.round(rel.trust)}: she ${trustWords(rel.trust)}`);
      setAttr(this.fearMini, 'title', `Fear ${Math.round(rel.fear)}: she ${fearWords(rel.fear)}`);
      toggleClass(this.trustMini, 'low', rel.trust < 25);
      toggleClass(this.fearMini, 'high', rel.fear > 35);
    }
  }

  // A brief shake of her card when she turns a request down.
  flashRefusal() {
    this.lyraCard.classList.remove('refused');
    void this.lyraCard.offsetWidth; // restart the animation
    this.lyraCard.classList.add('refused');
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
    const t = String(text || '').trim();
    setText(this.questText, t);
    setAttr(this.questLine, 'title', t || null);
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
    if (n > 0) {
      setText(this.chatBadge, n > 9 ? '9+' : String(n));
      if (this.chatBadge.hidden) this.chatBadge.hidden = false;
    } else if (!this.chatBadge.hidden) this.chatBadge.hidden = true;
  }

  update(dt) {
    const g = this.game;
    if (this.el.hidden || !g.player) return;
    this.tick += dt;
    if (this.tick < 0.1) return;
    this.tick = 0;
    this.slowTick += 0.1;
    const p = g.player;
    const c = g.companion;
    const s = g.settings || {};

    setText(this.pName, s.playerName || p.name || 'Traveler');
    setText(this.pLevel, `Lv ${p.level ?? 1}`);
    this.pHp.set(frac(p.hp, p.maxHp), hpText(p.hp, p.maxHp));
    toggleClass(this.pHp.el, 'low', frac(p.hp, p.maxHp) < 0.3);
    const xpNext = this.xpNeeded(p);
    if (xpNext) this.pXp.set(frac(p.xp, xpNext), `${fmtInt(p.xp)} / ${fmtInt(xpNext)} xp`);
    else this.pXp.set(0, `${fmtInt(p.xp || 0)} xp`);
    const coins = p.inventory?.count?.('coin') ?? p.gold ?? 0;
    setText(this.pCoins, fmtInt(coins));

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

    if (c) {
      setText(this.lName, s.companionName || c.name || 'Lyra');
      this.lHp.set(frac(c.hp, c.maxHp), hpText(c.hp, c.maxHp));
      setStyle(this.lMiniHp, 'width', `${Math.round(frac(c.hp, c.maxHp) * 100)}%`);
      toggleClass(this.lyraCard, 'downed', !!c.downed);
      const beh = c.behavior;
      const stance = beh?.stance || 'defend';
      setIcon(this.lStanceIcon, STANCE_ICON[stance] || 'shield');
      setText(this.lStance.lastChild, stanceLabel(stance));
      this.lStance.dataset.stance = stance;
      let status = '';
      try {
        status = beh?.status?.() || '';
      } catch {
        status = '';
      }
      setText(this.lStatus, lyraStatusLine(status, stance, c.downed, true));
      this.refreshCommands(beh);
    }
    // Mood, portrait and how she stands with you change slowly; twice a second is plenty.
    if (this.slowTick >= 0.5) {
      this.slowTick = 0;
      if (c) this.refreshMood(c);
      this.refreshCompanion();
    }
    if (this.refusedT > 0) {
      this.refusedT -= 0.1;
      if (this.refusedT <= 0) this.lyraCard.classList.remove('refused');
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

  refreshMood(c) {
    const mind = c.mind;
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
    const expr = c.downed || this.cs === 'gone' || this.cs === 'left' ? 'sad' : moodToExpression(mood, mind?.emotions, mind?.needs);
    if (expr !== this.lastExpr) {
      const url = portraitUrl(this.game, 'lyra', expr);
      if (url) this.lPortrait.src = url;
      this.lastExpr = expr;
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
