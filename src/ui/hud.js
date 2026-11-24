// The in-game HUD: player and Lyra cards, place / clock / weather, the quest line,
// the interact prompt, the command bar (with Jobs menu) and its radial form on small
// screens. DOM writes happen only when a shown value changes.

import { h, icon, setIcon, setText, toggleClass, meter, button, setAttr } from './dom.js';
import { COMMANDS, JOBS, DELIVER_OPTIONS } from './content.js';
import { hpText, frac, fmtInt, lyraStatusLine, weatherIconKey, weatherLabel, moodEmoji, moodToExpression, stanceLabel } from './format.js';
import { portraitUrl } from './art.js';

const STANCE_ICON = { attack: 'sword', defend: 'shield', passive: 'feather' };

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
    this.el = this.build();
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

    // Lyra card (tap -> her mind)
    this.lPortrait = h('img', { class: 'portrait portrait-hud', alt: '', draggable: 'false' });
    this.lName = h('span', { class: 'card-name' });
    this.lMood = h('span', { class: 'mood-emoji', role: 'img' });
    this.lStanceIcon = icon('shield');
    this.lStance = h('span', { class: 'stance-badge' }, this.lStanceIcon, h('span', { class: 'stance-text' }));
    this.lHp = meter('meter-lyra', `Lyra's health`);
    this.lStatus = h('div', { class: 'lyra-status' });
    this.lyraCard = h(
      'button',
      { type: 'button', class: 'card lyra-card', title: "Open Lyra's mind (Tab)" },
      h('span', { class: 'portrait-frame' }, this.lPortrait),
      h('span', { class: 'lyra-info' }, h('span', { class: 'card-row' }, this.lName, this.lMood, this.lStance), this.lHp.el, this.lStatus),
    );
    this.lyraCard.addEventListener('click', () => this.ui.openMind('now'));

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

    // Interact prompt
    this.promptKey = h('kbd', { class: 'keycap', text: 'E' });
    this.promptText = h('span', { class: 'prompt-text' });
    this.prompt = h('button', { type: 'button', class: 'interact-prompt', hidden: true }, this.promptKey, this.promptText);
    this.prompt.addEventListener('click', () => g.input?.press('interact'));

    // Command bar
    this.cmdButtons = {};
    const cmdbar = h('nav', { class: 'cmdbar', 'aria-label': 'Orders for Lyra' });
    for (const c of COMMANDS) {
      const b = button(c.label, { icon: c.icon, cls: `cmd cmd-${c.id}`, key: c.key, title: c.hint, onClick: () => this.ui.runCommand(c.id) });
      this.cmdButtons[c.id] = b;
      cmdbar.append(b);
    }
    this.jobsBtn = button('Jobs', { icon: 'axe', cls: 'cmd cmd-jobs', title: 'Give Lyra a job', onClick: (e) => this.toggleJobs(e) });
    this.jobsBtn.append(h('span', { class: 'caret', text: '▾' }));
    const talkBtn = button('Talk', { icon: 'talk', cls: 'cmd cmd-talk', key: 'T', title: 'Talk to Lyra', onClick: () => this.ui.chat.open(true) });
    cmdbar.append(this.jobsBtn, talkBtn);

    this.jobsMenu = this.buildJobsMenu();

    // Radial orders (small screens)
    this.ordersBtn = button('', { icon: 'spark', cls: 'orders-btn', title: 'Orders for Lyra', onClick: () => this.toggleRadial() });
    this.radial = h('div', { class: 'radial', 'aria-hidden': 'true' });
    const radialItems = [...COMMANDS.map((c) => ({ id: c.id, label: c.label, icon: c.icon })), { id: 'jobs', label: 'Jobs', icon: 'axe' }, { id: 'talk', label: 'Talk', icon: 'talk' }];
    // Angles come from CSS (--i): the arc is tuned per screen size there.
    radialItems.forEach((it, i) => {
      const b = button(it.label, { icon: it.icon, cls: `radial-item radial-${it.id}` });
      b.style.setProperty('--i', String(i));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (it.id === 'jobs') {
          this.closeRadial();
          this.openJobs(true);
        } else if (it.id === 'talk') {
          this.closeRadial();
          this.ui.chat.open(true);
        } else {
          this.ui.runCommand(it.id);
          this.closeRadial();
        }
      });
      this.cmdButtons[`r_${it.id}`] = b;
      this.radial.append(b);
    });
    const ordersWrap = h('div', { class: 'orders' }, this.radial, this.ordersBtn);

    this.fps = h('div', { class: 'fps num', hidden: true });

    const top = h('div', { class: 'hud-top' }, h('div', { class: 'hud-cards' }, playerCard, this.lyraCard), h('div', { class: 'hud-right' }, placeCard, corner));
    const center = h('div', { class: 'hud-center' }, this.questLine);
    const bottom = h('div', { class: 'hud-bottom' }, this.prompt, cmdbar);
    return h('div', { class: 'hud', hidden: true }, top, center, bottom, ordersWrap, this.jobsMenu, this.fps);
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
    const stop = button('Stop current job', { cls: 'btn-ghost btn-small', onClick: () => {
      this.ui.runStopJob();
      this.closeJobs();
    } });
    const menu = h('div', { class: 'jobs-menu', hidden: true, role: 'menu' }, h('div', { class: 'jobs-head' }, h('span', { class: 'jobs-title', text: 'Jobs for Lyra' }), h('span', { class: 'jobs-deliver', text: 'Deliver:' }), seg), list, stop);
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

  // Dismiss popovers on any outside tap.
  outsidePointer(target) {
    if (this.jobsOpen && !this.jobsMenu.contains(target) && !this.jobsBtn.contains(target)) this.closeJobs();
    if (this.radialOpen && !this.radial.parentElement.contains(target)) this.closeRadial();
  }

  show(on) {
    this.el.hidden = !on;
  }

  setQuest(text) {
    const t = String(text || '').trim();
    setText(this.questText, t);
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

    if (c) {
      setText(this.lName, s.companionName || c.name || 'Lyra');
      this.lHp.set(frac(c.hp, c.maxHp), hpText(c.hp, c.maxHp));
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
      setText(this.lStatus, lyraStatusLine(status, stance, c.downed));
      // Mood and portrait change slowly; refresh twice a second.
      if (this.slowTick >= 0.5) {
        this.slowTick = 0;
        this.refreshMood(c);
      }
      this.refreshCommands(beh);
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
    setAttr(this.lMood, 'title', mood?.label ? `Mood: ${mood.label}` : null);
    setAttr(this.lMood, 'aria-label', mood?.label ? `Mood: ${mood.label}` : 'Mood');
    const expr = c.downed ? 'sad' : moodToExpression(mood, mind?.emotions, mind?.needs);
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
