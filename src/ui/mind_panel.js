// Lyra's Mind (DESIGN.md §14): the place where she keeps who she is and what she
// knows. Tabs: Now, People, Memories, Diary, Goals, Soul, Data. Everything read from
// the mind is read defensively: its stores are written by another module.

import { h, icon, button, clear, setText, setStyle, toggleClass, meter, copyText, appendAll } from './dom.js';
import { makePanel } from './modal.js';
import { portraitUrl, personArtKey } from './art.js';
import {
  moodEmoji,
  moodToExpression,
  bondLabel,
  affinityWords,
  listFrom,
  filterMemories,
  groupByDay,
  dayLabel,
  starString,
  capitalize,
  bytesLabel,
  utf8Bytes,
  parseList,
  listToText,
  truncate,
  stanceLabel,
  clamp01,
} from './format.js';
import { RESET_WARNING, COMMANDS, JOBS, DELIVER_OPTIONS, REJOIN } from './content.js';
import {
  companionshipOf,
  companionshipLabel,
  companionshipTone,
  companionshipBlurb,
  companionshipReason,
  barMode,
  playerRelation,
  trustWords,
  fearWords,
  sleepsAt,
  ledgerEntries,
  ledgerViews,
  ledgerTally,
  promiseEntries,
  promiseViews,
  agendaOf,
  planViews,
  knowledgeEntries,
  knowledgeKind,
  groupKnowledge,
  knowledgeCounts,
  sourceLabel,
  confidenceWord,
  lifeTimeline,
  directiveWords,
  nowParagraph,
} from './lyra_view.js';
import { STORY } from '../lore/story.js';
import { villageOf, villagerRoster, villageFeeling, villagerBonds, villageTalkViews, rumorsAboutPlayer, closestToHer, readWorth, worthView, editHistory, firstName } from './village_view.js';

// Her newest line in the chat (her answer to a request asked from the Mind panel).
function lastLyraLine(ui) {
  try {
    const list = ui.chat?.messages || [];
    for (let i = list.length - 1; i >= 0; i--) if (list[i]?.from === 'lyra' && list[i].text) return truncate(String(list[i].text), 160);
  } catch {
    /* the chat is optional */
  }
  return '';
}

export const MIND_TABS = [
  { id: 'now', label: 'Now' },
  { id: 'you', label: 'You & her' },
  { id: 'people', label: 'People' },
  { id: 'memories', label: 'Memories' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'life', label: 'Her life' },
  { id: 'diary', label: 'Diary' },
  { id: 'goals', label: 'Goals' },
  { id: 'soul', label: 'Soul' },
  { id: 'data', label: 'Data' },
];

// Tabs rebuilt when their data changes while they are showing.
const LIVE_TABS = new Set(['you', 'people', 'goals', 'diary', 'knowledge', 'life']);
const LEDGER_SHOWN = 60;
const KNOWLEDGE_FILTERS = [
  ['all', 'All'],
  ['fact', 'Facts'],
  ['lore', 'Lore'],
  ['theory', 'Theories'],
  ['rumor', 'Rumors'],
];

const EMOTIONS = [
  ['joy', 'Joy'],
  ['affection', 'Affection'],
  ['trust', 'Trust'],
  ['curiosity', 'Curiosity'],
  ['pride', 'Pride'],
  ['surprise', 'Surprise'],
  ['sadness', 'Sadness'],
  ['fear', 'Fear'],
  ['anger', 'Anger'],
  ['embarrassment', 'Embarrassment'],
];

const NEEDS = [
  ['energy', 'Energy'],
  ['hunger', 'Fullness'],
  ['social', 'Company'],
  ['fun', 'Fun'],
  ['safety', 'Safety'],
];

const BIG_FIVE = [
  ['openness', 'Openness', 'set in her ways', 'endlessly curious'],
  ['conscientiousness', 'Conscientiousness', 'spontaneous', 'disciplined'],
  ['extraversion', 'Extraversion', 'reserved', 'outgoing'],
  ['agreeableness', 'Agreeableness', 'blunt', 'gentle'],
  ['neuroticism', 'Neuroticism', 'steady', 'easily shaken'],
];

// Where a goal came from, as she would put it.
const GOAL_SOURCES = { soul: 'who she is', self: 'her own', player: 'you suggested it', quest: 'the search for Maren' };

const SOUL_TEXT = [
  ['fullName', 'Full name', 'input'],
  ['age', 'Age', 'number'],
  ['pronouns', 'Pronouns', 'input'],
  ['origin', 'Origin', 'input'],
  ['appearance', 'Appearance', 'area'],
  ['backstory', 'Backstory', 'area'],
  ['speechStyle', 'How she speaks', 'area'],
];

const SOUL_LISTS = [
  ['values', 'Values'],
  ['likes', 'Likes'],
  ['dislikes', 'Dislikes'],
  ['fears', 'Fears'],
  ['dreams', 'Dreams'],
  ['quirks', 'Quirks'],
];

// The five ways a villager can feel about the player, for the village bar.
const OPINION_KEYS = [
  ['fond', 'Fond', 'var(--heal)'],
  ['friendly', 'Friendly', 'var(--heal-deep)'],
  ['neutral', 'Neutral', 'var(--line)'],
  ['wary', 'Wary', 'var(--ember-deep)'],
  ['hostile', 'Hostile', 'var(--danger)'],
];

function detailsKey(d) {
  return `${d.closest('[data-person]')?.dataset.person || ''}|${d.className}|${d.querySelector('summary')?.textContent || ''}`;
}

function safeLog(village) {
  try {
    const l = village?.log;
    return typeof l === 'function' ? l.call(village) : l || [];
  } catch {
    return [];
  }
}

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function clone(o) {
  try {
    return JSON.parse(JSON.stringify(o));
  } catch {
    return null;
  }
}

export class MindPanel {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.panel = null;
    this.tab = 'now';
    this.refreshT = 0;
    this.memQuery = '';
    this.knowQuery = '';
    this.knowKind = 'all';
    this.dirty = false;
    this.nowRefs = null;
  }

  get mind() {
    return this.game.companion?.mind || null;
  }

  isOpen() {
    return !!this.panel && this.ui.stack.includes(this.panel);
  }

  open(tab = 'now') {
    this.tab = MIND_TABS.some((t) => t.id === tab) ? tab : 'now';
    if (this.isOpen()) {
      this.showTab(this.tab);
      return;
    }
    const name = this.game.settings?.companionName || this.game.companion?.name || 'Lyra';
    const panel = makePanel({ id: 'mind', title: `${name}'s Mind`, subtitle: 'Where she keeps who she is and what she knows', iconName: 'mind', cls: 'panel-wide' });
    this.panel = panel;
    this.hero = h('div', { class: 'mind-hero' });
    this.tabsEl = h('div', { class: 'tabs', role: 'tablist' });
    this.tabButtons = {};
    for (const t of MIND_TABS) {
      const b = h('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': 'false', text: t.label });
      b.addEventListener('click', () => this.showTab(t.id));
      this.tabButtons[t.id] = b;
      this.tabsEl.append(b);
    }
    this.content = h('div', { class: 'tab-content', role: 'tabpanel' });
    // Asking her things (§16.4) lives here, under her portrait: the HUD keeps only her
    // face, and a tap on it opens this.
    this.askEl = h('div', { class: 'mind-ask' });
    this.jobsOpen = false;
    panel.body.classList.add('mind-body');
    panel.body.append(this.hero, this.askEl, this.tabsEl, this.content);
    panel.onClose = () => {
      this.panel = null;
      this.nowRefs = null;
    };
    this.ui.openModal(panel);
    this.renderHero();
    this.renderAsk(true);
    this.showTab(this.tab);
  }

  // ---------- asking her ----------

  // A row of requests (each one she weighs and answers, §16.4): follow, wait, how she
  // fights, a job; "Ask her to come back" while she is apart. Her answer shows in a
  // line under the row and in the chat.
  renderAsk(force = false) {
    const el = this.askEl;
    if (!el) return;
    const g = this.game;
    const ui = this.ui;
    const cs = companionshipOf(g);
    const mode = barMode(cs);
    const beh = g.companion?.behavior;
    const dir = beh?.directive?.type;
    const stance = beh?.stance;
    const key = `${mode}|${dir}|${stance}|${this.jobsOpen}|${this.askNote || ''}`;
    if (!force && key === this._askKey) return;
    this._askKey = key;
    clear(el);
    el.hidden = mode === 'hidden';
    if (mode === 'hidden') return;
    const name = g.settings?.companionName || g.companion?.name || 'Lyra';
    const row = h('div', { class: 'ask-row', role: 'group', 'aria-label': `Ask ${name}` });
    const on = { follow: dir === 'follow', stay: dir === 'stay' || dir === 'guard', attack: stance === 'attack', defend: stance === 'defend', passive: stance === 'passive' };
    const ask = (id) => {
      ui.runCommand(id);
      this.askNote = '';
      this.lastAskAt = g.time || 0;
      this.renderAsk(true);
    };
    if (mode === 'full') {
      for (const c of COMMANDS) {
        const b = button(c.label, { icon: c.icon, cls: `btn-small ask-btn ask-${c.id}`, title: c.hint, onClick: () => ask(c.id) });
        toggleClass(b, 'active', !!on[c.id]);
        b.setAttribute('aria-pressed', on[c.id] ? 'true' : 'false');
        row.append(b);
      }
      const jobs = button('Jobs', { icon: 'axe', cls: 'btn-small ask-btn ask-job-toggle', title: 'Ask her to take on a job', onClick: () => {
        this.jobsOpen = !this.jobsOpen;
        this.renderAsk(true);
      } });
      toggleClass(jobs, 'active', this.jobsOpen || dir === 'job');
      jobs.setAttribute('aria-expanded', this.jobsOpen ? 'true' : 'false');
      row.append(jobs);
    } else {
      row.append(button(REJOIN.label, { icon: REJOIN.icon, cls: 'btn-small ask-btn ask-rejoin', title: REJOIN.hint, onClick: () => {
        ui.askBack();
        this.renderAsk(true);
      } }));
    }
    row.append(button('Talk', { icon: 'talk', cls: 'btn-small ask-btn ask-talk', title: `Talk with ${name}`, onClick: () => {
      ui.closeAll?.();
      ui.chat.open(true);
    } }));
    el.append(h('div', { class: 'ask-head' }, h('span', { class: 'ask-title', text: `Ask ${name}` }), h('span', { class: 'ask-sub', text: 'She decides for herself' })), row);
    if (mode === 'full' && this.jobsOpen) {
      const deliver = this.deliverTo || 'player';
      const seg = h('div', { class: 'segmented ask-deliver', role: 'radiogroup', 'aria-label': 'Deliver to' });
      for (const d of DELIVER_OPTIONS) {
        const b = h('button', { type: 'button', class: 'seg', role: 'radio', 'aria-checked': d.id === deliver ? 'true' : 'false', text: d.label });
        b.addEventListener('click', () => {
          this.deliverTo = d.id;
          this.renderAsk(true);
        });
        seg.append(b);
      }
      const list = h('div', { class: 'ask-jobs-list' });
      for (const j of JOBS) {
        const b = h('button', { type: 'button', class: 'btn job ask-job' }, icon(j.icon), h('span', { class: 'job-text' }, h('span', { class: 'job-name', text: j.label }), h('span', { class: 'job-note', text: j.note })));
        b.addEventListener('click', () => {
          ui.runJob(j, this.deliverTo || 'player');
          this.jobsOpen = false;
          this.renderAsk(true);
        });
        list.append(b);
      }
      const stop = button('Ask her to stop', { cls: 'btn-ghost btn-small', onClick: () => {
        ui.runStopJob();
        this.jobsOpen = false;
        this.renderAsk(true);
      } });
      el.append(h('div', { class: 'ask-jobs' }, h('div', { class: 'ask-jobs-head' }, h('span', { text: 'Deliver:' }), seg), list, stop));
    }
    // Her answer to the last thing asked here, from the chat's newest line of hers.
    const said = this.lastAskAt !== undefined && (g.time || 0) - this.lastAskAt < 30 ? lastLyraLine(ui) : '';
    if (said) el.append(h('p', { class: 'ask-answer' }, h('b', { text: `${name}: ` }), document.createTextNode(`“${said}”`)));
  }

  close() {
    if (this.isOpen()) this.ui.closeModal(this.panel);
  }

  showTab(id) {
    this.tab = id;
    for (const [tid, b] of Object.entries(this.tabButtons)) {
      b.setAttribute('aria-selected', tid === id ? 'true' : 'false');
      toggleClass(b, 'active', tid === id);
    }
    // On narrow screens the tab strip scrolls: keep the chosen tab in view.
    const active = this.tabButtons[id];
    if (active && this.tabsEl.scrollWidth > this.tabsEl.clientWidth) {
      const left = active.offsetLeft - (this.tabsEl.clientWidth - active.offsetWidth) / 2;
      this.tabsEl.scrollLeft = Math.max(0, left);
    }
    this.nowRefs = null;
    clear(this.content);
    this.content.scrollTop = 0;
    const mind = this.mind;
    if (!mind) {
      const gone = companionshipOf(this.game) === 'gone';
      this.content.append(h('p', { class: 'empty', text: gone ? 'She has shut you out of her thoughts.' : 'Lyra is not here yet. Start a game to meet her.' }));
      return;
    }
    const render = {
      now: () => this.renderNow(),
      you: () => this.renderYou(),
      people: () => this.renderPeople(),
      memories: () => this.renderMemories(),
      knowledge: () => this.renderKnowledge(),
      life: () => this.renderLife(),
      diary: () => this.renderDiary(),
      goals: () => this.renderGoals(),
      soul: () => this.renderSoul(),
      data: () => this.renderData(),
    }[id];
    try {
      render?.();
    } catch (err) {
      console.warn('[mind panel] tab failed', id, err);
      this.content.append(h('p', { class: 'empty', text: 'This part of her mind could not be shown right now.' }));
    }
  }

  // Mark a tab for rebuilding on the next refresh (e.g. after a relationship change).
  markDirty(tab) {
    if (this.isOpen() && (!tab || tab === this.tab)) this.dirty = true;
  }

  update(dt) {
    if (!this.isOpen()) return;
    this.refreshT += dt;
    if (this.refreshT < 1) return;
    this.refreshT = 0;
    this.renderHero();
    this.renderAsk();
    if (this.tab === 'now') this.updateNow();
    else if (this.dirty && LIVE_TABS.has(this.tab)) {
      const top = this.content.scrollTop;
      // Folds the player opened stay open when the tab rebuilds.
      const open = new Set([...this.content.querySelectorAll('details[open]')].map(detailsKey));
      this.showTab(this.tab);
      if (open.size) for (const d of this.content.querySelectorAll('details')) if (open.has(detailsKey(d))) d.open = true;
      this.content.scrollTop = top;
    }
    this.dirty = false;
  }

  // ---------- hero ----------

  renderHero() {
    const g = this.game;
    const c = g.companion;
    const mind = this.mind;
    const mood = safe(() => mind?.mood?.());
    const cs = companionshipOf(g);
    const expr = cs === 'gone' || cs === 'left' ? 'sad' : moodToExpression(mood, mind?.emotions, mind?.needs);
    const soul = mind?.soul || {};
    const name = g.settings?.companionName || c?.name || soul.name || 'Lyra';
    const rel = playerRelation(mind);
    const bond = safe(() => mind?.relationships?.bond?.('player'));
    const level = bond?.level ?? 0;
    const key = `${expr}|${name}|${mood?.label}|${level}|${bond?.label}|${cs}|${Math.round(rel?.trust ?? -1)}|${Math.round(rel?.fear ?? -1)}`;
    if (this._heroKey === key) return;
    this._heroKey = key;
    clear(this.hero);
    const img = h('img', { class: 'portrait portrait-lg', alt: `${name}`, draggable: 'false' });
    const url = portraitUrl(g, 'lyra', expr);
    if (url) img.src = url;
    const pips = h('span', { class: 'pips', 'aria-label': `Bond level ${level} of 5` });
    for (let i = 1; i <= 5; i++) pips.append(h('i', { class: i <= level ? 'on' : '' }));
    const csChip = h('button', { type: 'button', class: 'cs-chip cs-chip-btn', 'data-tone': companionshipTone(cs), title: 'How she stands with you', text: companionshipLabel(cs) });
    csChip.addEventListener('click', () => this.showTab('you'));
    this.hero.append(
      h('span', { class: `portrait-frame large${cs === 'gone' ? ' is-gone' : ''}` }, img),
      h(
        'div',
        { class: 'hero-text' },
        h('div', { class: 'hero-name' }, h('span', { text: name }), soul.fullName && soul.fullName !== name ? h('span', { class: 'hero-full', text: soul.fullName }) : null),
        h('div', { class: 'hero-mood' }, h('span', { class: 'mood-emoji', text: moodEmoji(mood) }), h('span', { text: cs === 'gone' ? 'Keeping away from you' : mood?.label ? `Feeling ${mood.label}` : 'Feeling like herself' })),
        h(
          'div',
          { class: 'hero-bond' },
          csChip,
          h('span', { class: 'hero-bond-label', text: `Bond: ${bond?.label || bondLabel(level)}` }),
          pips,
          rel ? h('span', { class: 'hero-trust num', text: `trust ${Math.round(rel.trust)}${rel.fear >= 5 ? ` · fear ${Math.round(rel.fear)}` : ''}` }) : null,
        ),
      ),
    );
  }

  // ---------- Now ----------

  renderNow() {
    const mind = this.mind;
    const refs = { emo: {}, need: {} };
    const stateText = h('p', { class: 'state-text' });
    const doing = h('div', { class: 'doing' });
    const emoGrid = h('div', { class: 'bars-grid' });
    for (const [k, label] of EMOTIONS) {
      const m = meter(`meter-emo emo-${k}`, label);
      refs.emo[k] = m;
      emoGrid.append(h('div', { class: 'bar-row' }, h('span', { class: 'bar-label', text: label }), m.el));
    }
    const needGrid = h('div', { class: 'bars-grid' });
    for (const [k, label] of NEEDS) {
      const m = meter(`meter-need need-${k}`, label);
      refs.need[k] = m;
      needGrid.append(h('div', { class: 'bar-row' }, h('span', { class: 'bar-label', text: label }), m.el));
    }
    const thoughts = h('ol', { class: 'thoughts', reversed: true });
    refs.stateText = stateText;
    refs.doing = doing;
    refs.thoughts = thoughts;
    refs.thoughtKey = '';
    const plan = h('div', { class: 'plan' });
    const planNote = h('p', { class: 'plan-note muted small' });
    refs.plan = plan;
    refs.planNote = planNote;
    refs.planKey = '';
    this.content.append(
      h('div', { class: 'now-grid' },
        h('section', { class: 'box box-state' }, h('h3', { text: 'Right now' }), stateText, doing),
        h('section', { class: 'box box-plan' }, h('h3', { text: 'Her day' }), plan, planNote),
        h('section', { class: 'box' }, h('h3', { text: 'Feelings' }), emoGrid),
        h('section', { class: 'box' }, h('h3', { text: 'Needs' }), needGrid),
        h('section', { class: 'box box-thoughts' }, h('h3', { text: 'On her mind' }), thoughts),
      ),
    );
    this.nowRefs = refs;
    this.updateNow();
    if (!mind) return;
  }

  updateNow() {
    const r = this.nowRefs;
    const mind = this.mind;
    if (!r || !mind) return;
    const c = this.game.companion;
    const name = this.game.settings?.companionName || c?.name || 'Lyra';
    setText(r.stateText, nowParagraph(safe(() => mind.summary?.(), null), { name }) || safe(() => mind.describeState?.(), '') || 'She is quiet, taking in the world around her.');
    const beh = c?.behavior;
    const status = safe(() => beh?.status?.(), '') || 'nearby';
    const dir = beh?.directive?.type || '';
    const stance = beh?.stance || 'defend';
    const target = beh?.currentTarget;
    const doingKey = `${status}|${stance}|${dir}|${target?.name || ''}`;
    if (doingKey !== r.doingKey) {
      r.doingKey = doingKey;
      this.drawDoing(r, status, stance, dir, target);
    }
    const emo = mind.emotions || {};
    for (const [k] of EMOTIONS) r.emo[k].set(clamp01(Number(emo[k]) || 0), `${Math.round((Number(emo[k]) || 0) * 100)}`);
    const needs = mind.needs || {};
    for (const [k] of NEEDS) {
      const v = clamp01(Number(needs[k] ?? 1));
      r.need[k].set(v, `${Math.round(v * 100)}`);
      toggleClass(r.need[k].el, 'low', v < 0.3);
    }
    this.updatePlan(r, mind);
    const list = Array.isArray(mind.thoughts) ? mind.thoughts : [];
    const last = list[list.length - 1];
    const key = `${list.length}|${last?.t}|${last?.text}`;
    if (key !== r.thoughtKey) {
      r.thoughtKey = key;
      clear(r.thoughts);
      const recent = list.slice(-14).reverse();
      if (!recent.length) r.thoughts.append(h('li', { class: 'empty', text: 'Nothing on her mind she would put into words yet.' }));
      for (const t of recent) {
        if (!t?.text) continue;
        r.thoughts.append(h('li', { class: `thought src-${t.source || 'self'}` }, h('span', { class: 'thought-text', text: t.text })));
      }
    }
  }

  drawDoing(r, status, stance, dir, target) {
    clear(r.doing);
    appendAll(r.doing, [
      h('span', { class: 'chip chip-static' }, icon('boots'), h('span', { text: capitalize(status) })),
      h('span', { class: `chip chip-static stance-${stance}` }, icon(stance === 'attack' ? 'sword' : stance === 'passive' ? 'feather' : 'shield'), h('span', { text: capitalize(stanceLabel(stance)) })),
      h('span', { class: 'chip chip-static' }, icon('flag'), h('span', { text: `Plan: ${directiveWords(dir)}` })),
      target && target.name ? h('span', { class: 'chip chip-static chip-danger' }, icon('sword'), h('span', { text: `Fighting ${target.name}` })) : null,
    ]);
  }

  // Her own plan for today (§16.1): what she means to do, where and why.
  updatePlan(r, mind) {
    const g = this.game;
    const agenda = agendaOf(mind);
    const hour = g.clock?.hour ?? 0;
    const today = Array.isArray(agenda?.today) ? agenda.today : [];
    const purse = Number(agenda?.purse);
    const rel = playerRelation(mind);
    const key = `${today.length}|${today.map((p) => `${p?.from}-${p?.to}-${p?.activity}-${p?.at}`).join(',')}|${Math.floor(hour)}|${purse}|${rel ? sleepsAt(rel) : ''}`;
    if (key === r.planKey) return;
    r.planKey = key;
    clear(r.plan);
    const names = this.nameLookup();
    const rows = planViews(today, hour, (id) => names(id, true));
    if (!rows.length) r.plan.append(h('p', { class: 'empty', text: 'She has not settled on a plan for today. She takes the day as it comes.' }));
    for (const row of rows) {
      r.plan.append(
        h(
          'div',
          { class: `plan-row${row.now ? ' is-now' : ''}${row.done ? ' is-done' : ''}` },
          h('span', { class: 'plan-time num', text: row.time }),
          h('span', { class: 'plan-main' }, h('span', { class: 'plan-what', text: [row.activity, row.place].filter(Boolean).join(' · ') }), row.why ? h('span', { class: 'plan-why', text: row.why }) : null),
        ),
      );
    }
    const bits = [];
    if (Number.isFinite(purse)) bits.push(`Her purse: ${Math.max(0, Math.round(purse))} coins of her own`);
    if (rel) bits.push(`She sleeps in ${sleepsAt(rel)}`);
    setText(r.planNote, bits.join(' · '));
  }

  // ---------- You and her ----------

  renderYou() {
    const g = this.game;
    const mind = this.mind;
    const name = g.settings?.companionName || g.companion?.name || 'Lyra';
    const cs = companionshipOf(g);
    const rel = playerRelation(mind);
    const reason = companionshipReason(mind) || this.ui.lastCompanionReason || '';
    const today = g.clock?.day || 0;

    const stateBox = h('section', { class: `box you-state tone-${companionshipTone(cs)}` });
    appendAll(stateBox, [
      h('div', { class: 'you-head' }, h('span', { class: 'cs-chip cs-chip-lg', 'data-tone': companionshipTone(cs), text: companionshipLabel(cs) }), rel ? h('span', { class: 'you-sum', text: `She ${trustWords(rel.trust)}, and ${fearWords(rel.fear)}.` }) : null),
      reason ? h('blockquote', { class: 'opinion', text: `“${reason}”` }) : null,
      h('p', { class: 'muted', text: companionshipBlurb(cs) }),
    ]);
    if (rel) {
      const aff = rel.affinity;
      const affFill = h('div', { class: `bipolar-fill ${aff < 0 ? 'neg' : 'pos'}` });
      setStyle(affFill, 'left', `${aff < 0 ? 50 + aff / 2 : 50}%`);
      setStyle(affFill, 'width', `${Math.abs(aff) / 2}%`);
      const bars = h('div', { class: 'rel-bars you-bars' });
      for (const [k, label, cls] of [
        ['trust', 'Trust', 'meter-trust'],
        ['fear', 'Fear', 'meter-fear'],
      ]) {
        const m = meter(cls, label);
        m.set(rel[k] / 100, `${Math.round(rel[k])}`);
        bars.append(h('div', { class: 'bar-row' }, h('span', { class: 'bar-label', text: label }), m.el));
      }
      bars.append(h('div', { class: 'bar-row' }, h('span', { class: 'bar-label', text: 'Affinity' }), h('div', { class: 'meter bipolar' }, h('div', { class: 'meter-track' }, h('i', { class: 'mid' }), affFill), h('span', { class: 'meter-text num', text: `${aff > 0 ? '+' : ''}${Math.round(aff)}` }))));
      const m = meter('meter-respect', 'Respect');
      m.set(rel.respect / 100, `${Math.round(rel.respect)}`);
      bars.append(h('div', { class: 'bar-row' }, h('span', { class: 'bar-label', text: 'Respect' }), m.el));
      stateBox.append(bars);
    } else stateBox.append(h('p', { class: 'empty', text: 'She has not made up her mind about you yet.' }));

    // What she has seen you do.
    const ledger = ledgerEntries(mind);
    const tally = ledgerTally(ledger);
    const deeds = h('section', { class: 'box you-ledger' }, h('h3', { text: 'What she has seen you do' }));
    if (!ledger.length) deeds.append(h('p', { class: 'empty', text: `Nothing ${name} holds for or against you yet. She is watching, the way anyone would.` }));
    else {
      deeds.append(h('p', { class: 'muted small', text: `${tally.good} kept in your favor · ${tally.bad} held against you` }));
      const list = h('ol', { class: 'ledger' });
      const views = ledgerViews(ledger, today);
      for (const v of views.slice(0, LEDGER_SHOWN)) {
        list.append(
          h(
            'li',
            { class: `deed tone-${v.tone}` },
            h('span', { class: 'deed-sev num', title: 'How much it weighed with her', text: v.sev }),
            h('span', { class: 'deed-main' }, h('span', { class: 'deed-label', text: v.label }), v.text ? h('span', { class: 'deed-text', text: `“${v.text}”` }) : null),
            h('span', { class: 'deed-when', text: v.when }),
          ),
        );
      }
      deeds.append(list);
      if (views.length > LEDGER_SHOWN) deeds.append(h('p', { class: 'muted small', text: `…and ${views.length - LEDGER_SHOWN} older things she has not forgotten.` }));
    }

    // Promises, both ways.
    const promises = promiseViews(promiseEntries(mind), { lyraName: name, today });
    const promBox = h('section', { class: 'box you-promises' }, h('h3', { text: 'Promises' }));
    if (!promises.length) promBox.append(h('p', { class: 'empty', text: 'No promises between you yet. When she asks something of you and you agree, it is written here.' }));
    for (const pv of promises) {
      promBox.append(
        h(
          'div',
          { class: `promise state-${pv.state}` },
          h('span', { class: 'promise-state', text: pv.stateLabel }),
          h('span', { class: 'promise-main' }, h('span', { class: 'promise-text', text: pv.text }), h('span', { class: 'promise-meta', text: [pv.by, pv.due].filter(Boolean).join(' · ') })),
        ),
      );
    }

    const intro = {
      together: `${name} travels with you by choice. This is how she sees you, and why.`,
      wary: `${name} is still beside you, but guarded. This is how she sees you, and why.`,
      apart: `${name} is living her own life for now. This is how she sees you, and why.`,
      left: `${name} has broken off with you. This is how she sees you, and why.`,
      gone: `${name} has cut you out of her life. This is how she sees you, and why.`,
    }[cs] || `${name} travels with you by choice. This is how she sees you, and why.`;
    this.content.append(h('p', { class: 'tab-intro', text: intro }), stateBox);
    const worth = this.worthBox(name);
    if (worth) this.content.append(worth);
    this.content.append(deeds, promBox);
  }

  // Her own weighing (§19.4): what being with you gives her against what it costs her.
  worthBox(name) {
    const w = worthView(readWorth(this.mind));
    if (!w) return null;
    const box = h('section', { class: `box worth-box tone-${w.tone}` }, h('h3', { text: `Is it worth it to ${name}?` }), h('p', { class: 'worth-verdict', text: w.verdict }));
    const gives = h('i', { class: 'w-gives' });
    const costs = h('i', { class: 'w-costs' });
    setStyle(gives, 'width', `${Math.round(w.balance * 1000) / 10}%`);
    setStyle(costs, 'width', `${Math.round((1 - w.balance) * 1000) / 10}%`);
    box.append(
      h('div', { class: 'worth-scale', role: 'img', 'aria-label': `Staying gives her ${w.stay}, and costs her ${w.cost}` }, gives, costs),
      h('div', { class: 'worth-nums' }, h('span', { text: `Gives ${w.stay}` }), h('span', { text: `Costs ${w.cost}` })),
    );
    const col = (cls, title, items, empty) => {
      const ul = h('ul');
      for (const r of items.slice(0, 8)) {
        const bar = h('i');
        setStyle(bar, 'width', `${Math.max(8, Math.round(r.share * 100))}%`);
        ul.append(h('li', { class: r.quote ? 'quote' : '' }, h('span', { class: 'w-weight', title: `Weighs ${Math.abs(r.weight)}` }, bar), h('span', { class: 'w-text', text: r.quote ? `“${r.text}”` : r.text })));
      }
      if (!items.length) ul.append(h('li', { class: 'empty', text: empty }));
      return h('div', { class: `worth-col ${cls}` }, h('h4', { text: title }), ul);
    };
    box.append(
      h(
        'div',
        { class: 'worth-cols' },
        col('gives', 'What staying gives her', w.gives, 'Nothing she would name yet.'),
        col('costs', 'What it costs her', w.costs, 'Nothing she is holding against it.'),
      ),
      h('p', { class: 'muted small', text: 'Small wrongs she can afford, she weighs and lets go, and they fade. She never says any of this out loud.' }),
    );
    return box;
  }

  // An "edited" mark that unfolds what she used to remember (or believe, for a piece of
  // knowledge), and why she changed it.
  editMark(entry, host, kind = 'memory') {
    const ed = editHistory(entry, this.game.clock?.day || 0);
    if (!ed) return null;
    const fact = kind === 'fact';
    const mark = h('button', { type: 'button', class: 'edit-mark', 'aria-expanded': 'false', title: fact ? 'She changed what she believes here' : 'She changed how she remembers this' }, 'edited');
    let panel = null;
    mark.addEventListener('click', (e) => {
      e.stopPropagation();
      if (panel) {
        panel.remove();
        panel = null;
        mark.setAttribute('aria-expanded', 'false');
        return;
      }
      panel = h('div', { class: 'edit-history' });
      for (const v of ed.versions.slice(0, 4)) {
        if (v.text) panel.append(h('p', { class: 'edit-was' }, fact ? 'She used to believe: ' : 'She used to remember it as: ', h('s', { text: `“${v.text}”` })));
        if (v.why) panel.append(h('p', { class: 'edit-why', text: `Why she changed it: ${v.why}` }));
        if (v.when) panel.append(h('p', { class: 'edit-when', text: `Changed ${v.when}` }));
      }
      if (!ed.versions.length && ed.why) panel.append(h('p', { class: 'edit-why', text: `Why she changed it: ${ed.why}` }));
      if (!panel.childElementCount) panel.append(h('p', { class: 'edit-was', text: 'She reworded this one, and kept the old words to herself.' }));
      host.append(panel);
      mark.setAttribute('aria-expanded', 'true');
    });
    return mark;
  }

  // ---------- People ----------

  // Hearthvale's people (§19.6): how the village sees the player, who she holds close,
  // every villager in the world (with what each thinks of the player and of whom they
  // are fond), then everyone else she knows.
  renderPeople() {
    const g = this.game;
    const mind = this.mind;
    const name = g.settings?.companionName || g.companion?.name || 'Lyra';
    const names = this.nameLookup();
    const nameOf = (id) => (id === 'lyra' ? name : id === 'player' ? g.settings?.playerName || 'you' : names(id) || '');
    const roster = villagerRoster(g, mind);
    const village = villageOf(g);
    const today = g.clock?.day || 0;

    this.content.append(h('p', { class: 'tab-intro', text: `Hearthvale's people: who ${name} holds close, what she honestly thinks of them, and how each of them sees you. You can ask her to count someone as a friend or an enemy, but she makes up her own mind.` }));

    // How the village sees the player.
    const feel = villageFeeling(roster);
    const vbox = h('section', { class: 'box village-box' }, h('h3', { text: 'How Hearthvale sees you' }));
    if (feel.count) {
      vbox.append(h('p', { class: 'feel', text: feel.sentence }));
      const bar = h('div', { class: 'feel-bar', role: 'img', 'aria-label': `${feel.count} villagers: ${OPINION_KEYS.map(([k, l]) => `${feel.counts[k]} ${l.toLowerCase()}`).join(', ')}` });
      const legend = h('div', { class: 'feel-legend' });
      for (const [k, label, color] of OPINION_KEYS) {
        const n = feel.counts[k];
        if (!n) continue;
        const seg = h('i', { class: `o-${k}` });
        setStyle(seg, 'width', `${(n / feel.count) * 100}%`);
        bar.append(seg);
        const item = h('span', { text: `${n} ${label.toLowerCase()}` });
        item.style.setProperty('--sw', color);
        legend.append(item);
      }
      vbox.append(bar, legend);
    } else vbox.append(h('p', { class: 'empty', text: 'Nobody in the village has made up their mind about you yet.' }));
    const rumors = rumorsAboutPlayer(village);
    if (rumors.length) {
      const ul = h('ul', { class: 'rumor-list' });
      for (const r of rumors) ul.append(h('li', { class: `tone-${r.tone}`, text: r.text }));
      vbox.append(h('h4', { class: 'people-sub', text: 'What people are saying about you' }), ul);
    }
    const talk = villageTalkViews(safeLog(village), { nameOf, today, limit: 6 });
    if (talk.length) {
      const ul = h('ul', { class: 'talk-log' });
      for (const t of talk) ul.append(h('li', null, h('span', { class: 'talk-what', text: t.text }), t.when ? h('span', { class: 'talk-when', text: t.when }) : null, t.summary ? h('span', { class: 'talk-sum', text: t.summary }) : null));
      vbox.append(h('h4', { class: 'people-sub', text: 'Village talk' }), ul);
    }
    this.content.append(vbox);

    // Who she is close to.
    const close = closestToHer(roster, 6);
    if (close.length) {
      const row = h('div', { class: 'close-row' });
      for (const v of close) {
        const url = portraitUrl(g, personArtKey(g, v.rel) || v.id, 'happy');
        row.append(
          h(
            'span',
            { class: 'close-chip' },
            url ? h('img', { alt: '', src: url, draggable: 'false' }) : h('span', { class: 'portrait monogram', 'aria-hidden': 'true', text: v.first.charAt(0) || '?' }),
            h('span', { text: v.first }),
            h('span', { class: 'close-bond', text: v.bond?.label || '' }),
          ),
        );
      }
      this.content.append(h('section', { class: 'box close-box' }, h('h3', { text: `Who ${name} holds close` }), row));
    }

    // The villagers, then everyone else she knows.
    const ids = roster.map((v) => v.id);
    if (roster.length) {
      const list = h('div', { class: 'people people-village' });
      for (const v of roster) list.append(v.rel ? this.personCard(v.rel, v, { village, ids, nameOf }) : this.villagerStub(v, { village, ids, nameOf }));
      // One note for everyone she has not talked about yet, not the same line on each card.
      const unsaid = roster.filter((v) => !v.rel).length;
      const note = unsaid ? h('p', { class: 'not-met', text: unsaid === roster.length ? `${name} has not said what she makes of any of them yet.` : `${name} has not said what she makes of ${unsaid === 1 ? 'one of them' : `${unsaid} of them`} yet.` }) : null;
      this.content.append(h('h3', { class: 'people-head', text: `The people of Hearthvale (${roster.length})` }), note, list);
    }
    const inRoster = new Set(ids);
    const others = listFrom(mind.relationships, ['all', 'list']).filter((r) => r && r.id && !inRoster.has(r.id) && r.id !== 'lyra');
    if (others.length) {
      const list = h('div', { class: 'people' });
      for (const rel of others) list.append(this.personCard(rel));
      this.content.append(h('h3', { class: 'people-head', text: roster.length ? 'Everyone else she knows' : 'Everyone she knows' }), list);
    }
    if (!roster.length && !others.length) this.content.append(h('p', { class: 'empty', text: "She hasn't really met anyone here yet. Walk her through the village." }));
  }

  // What a villager thinks of the player, and the people they are closest to.
  villageLine(v, ctx) {
    if (!v) return null;
    const bits = [];
    if (v.opinionLevel) bits.push(h('span', { class: `opinion-chip o-${v.opinionLevel.key}`, title: `What ${v.first} thinks of you (${Math.round(v.opinion)}/100)`, text: `Thinks of you: ${v.opinionLevel.label.toLowerCase()}` }));
    if (ctx?.village) {
      const b = villagerBonds(ctx.village, v.id, ctx.ids, ctx.nameOf);
      if (b.close.length) bits.push(h('span', { class: 'v-close', text: `Close to ${b.close.map((c) => (c.tag && c.tag !== 'friend' ? `${c.name} (${c.tag})` : c.name)).join(', ')}` }));
      if (b.odds.length) bits.push(h('span', { class: 'v-odds', text: `At odds with ${b.odds.map((c) => c.name).join(', ')}` }));
    }
    return bits.length ? h('div', { class: 'person-village' }, ...bits) : null;
  }

  // A villager she has no recorded relationship with yet.
  villagerStub(v, ctx) {
    const g = this.game;
    const url = portraitUrl(g, v.npc?.spriteKey || v.id, 'neutral');
    const img = url ? h('img', { class: 'portrait portrait-md', alt: '', draggable: 'false', src: url }) : h('span', { class: 'portrait portrait-md monogram', 'aria-hidden': 'true', text: v.first.charAt(0).toUpperCase() || '?' });
    return h(
      'article',
      { class: 'person is-stub', 'data-person': v.id },
      h('span', { class: 'portrait-frame' }, img),
      h(
        'div',
        { class: 'person-main' },
        h('div', { class: 'person-head' }, h('span', { class: 'person-name', text: v.name }), v.role ? h('span', { class: 'person-role', text: capitalize(v.role) }) : null),
        this.villageLine(v, ctx),
      ),
    );
  }

  personCard(rel, v = null, ctx = null) {
    const g = this.game;
    const mind = this.mind;
    const bond = safe(() => mind.relationships.bond?.(rel.id)) || {};
    const level = Math.max(0, Math.min(5, Math.round(bond.level ?? 0)));
    const tags = Array.isArray(rel.tags) ? rel.tags : [];
    const isPlayer = rel.id === 'player';
    const name = isPlayer ? g.settings?.playerName || rel.name || 'You' : rel.name || rel.id;
    const artKey = personArtKey(g, rel);
    const url = artKey ? portraitUrl(g, artKey, rel.affinity > 40 ? 'happy' : rel.affinity < -30 ? 'angry' : 'neutral') : '';
    // Someone without a face of their own (a group, a stranger she only heard of): their initial.
    const img = url ? h('img', { class: 'portrait portrait-md', alt: '', draggable: 'false', src: url }) : h('span', { class: 'portrait portrait-md monogram', 'aria-hidden': 'true', text: String(name || '?').trim().charAt(0).toUpperCase() || '?' });

    const pips = h('span', { class: 'pips', title: `Bond ${level}/5` });
    for (let i = 1; i <= 5; i++) pips.append(h('i', { class: i <= level ? 'on' : '' }));

    const aff = Math.max(-100, Math.min(100, Number(rel.affinity) || 0));
    const affFill = h('div', { class: `bipolar-fill ${aff < 0 ? 'neg' : 'pos'}` });
    setStyle(affFill, 'left', `${aff < 0 ? 50 + aff / 2 : 50}%`);
    setStyle(affFill, 'width', `${Math.abs(aff) / 2}%`);
    const bars = h(
      'div',
      { class: 'rel-bars' },
      h('div', { class: 'bar-row' }, h('span', { class: 'bar-label', text: 'Affinity' }), h('div', { class: 'meter bipolar' }, h('div', { class: 'meter-track' }, h('i', { class: 'mid' }), affFill), h('span', { class: 'meter-text num', text: `${aff > 0 ? '+' : ''}${Math.round(aff)}` }))),
    );
    for (const [k, label, cls] of [
      ['trust', 'Trust', 'meter-trust'],
      ['respect', 'Respect', 'meter-respect'],
      ['familiarity', 'Knows them', 'meter-fam'],
      ['fear', 'Fear', 'meter-fear'],
    ]) {
      const val = Number(rel[k]) || 0;
      if (k === 'fear' && val < 5) continue;
      const m = meter(cls, label);
      m.set(val / 100, `${Math.round(val)}`);
      bars.append(h('div', { class: 'bar-row' }, h('span', { class: 'bar-label', text: label }), m.el));
    }

    const tagRow = h('div', { class: 'tags' });
    for (const t of tags) tagRow.append(h('span', { class: `tag tag-${String(t).replace(/[^a-z_-]/gi, '')}`, text: t }));

    const opinion = rel.opinion ? h('blockquote', { class: 'opinion', text: `“${rel.opinion}”` }) : h('p', { class: 'opinion muted', text: `She ${affinityWords(aff)} ${isPlayer ? 'you' : name.split(' ')[0]}${rel.role ? `, the ${rel.role}` : ''}.` });

    const notes = Array.isArray(rel.notes) ? rel.notes : [];
    let notesEl = null;
    if (notes.length) {
      const ul = h('ul', { class: 'notes' });
      for (const n of notes.slice(-12).reverse()) ul.append(h('li', { class: `note src-${n.source || 'observed'}` }, h('span', { class: 'note-src', text: n.source || 'observed' }), h('span', { text: n.text || String(n) })));
      notesEl = h('details', { class: 'notes-wrap' }, h('summary', { text: `What she knows (${notes.length})` }), ul);
    }

    let actions = null;
    if (!isPlayer && rel.id !== 'lyra') {
      const isFriend = tags.includes('friend');
      const isEnemy = tags.includes('enemy');
      const fBtn = button(isFriend ? 'Ask her: not a friend' : 'Ask her: a friend', { icon: 'heart', cls: `btn-small ${isFriend ? 'btn-ghost' : 'btn-good'}`, title: 'She decides how she sees people; this asks her.' });
      const eBtn = button(isEnemy ? 'Ask her: not an enemy' : 'Ask her: an enemy', { icon: 'sword', cls: `btn-small ${isEnemy ? 'btn-ghost' : 'btn-danger'}`, title: 'She decides how she sees people; this asks her.' });
      fBtn.addEventListener('click', () => this.setTag(rel, isFriend ? '-friend' : 'friend'));
      eBtn.addEventListener('click', () => this.setTag(rel, isEnemy ? '-enemy' : 'enemy'));
      actions = h('div', { class: 'person-actions' }, fBtn, eBtn);
    }

    // Villagers fold their numbers away: eighteen cards of bars is a lot on a phone.
    const more = v ? h('details', { class: 'person-more' }, h('summary', { text: 'Her bond in numbers' }), bars) : bars;
    const meta = [rel.role, rel.kind && rel.kind !== 'human' ? rel.kind : null].filter(Boolean).join(' · ');
    return h(
      'article',
      { class: `person ${tags.includes('enemy') ? 'is-enemy' : ''} ${tags.includes('friend') ? 'is-friend' : ''}`.trim(), 'data-person': rel.id },
      h('span', { class: 'portrait-frame' }, img),
      h(
        'div',
        { class: 'person-main' },
        h('div', { class: 'person-head' }, h('span', { class: 'person-name', text: name }), meta ? h('span', { class: 'person-role', text: capitalize(meta) }) : null, h('span', { class: 'bond' }, h('span', { class: 'bond-label', text: bond.label || bondLabel(level) }), pips)),
        this.villageLine(v, ctx),
        tagRow.childElementCount ? tagRow : null,
        opinion,
        more,
        notesEl,
        actions,
      ),
    );
  }

  // Asking her to see someone as a friend or an enemy is a request like any other.
  setTag(rel, value) {
    const who = rel.name?.split(' ')[0] || rel.id;
    const fallback = value === 'friend' ? `${who} is a friend, then. I won't raise a hand to them.` : value === 'enemy' ? `${who}… fine. I'll treat them as a threat.` : `All right. I'll make up my own mind about ${who}.`;
    this.ui.ask('set_relationship', { target: rel.id, value }, 'tag', fallback);
    const top = this.content.scrollTop;
    this.showTab('people');
    this.content.scrollTop = top;
  }

  // ---------- Memories ----------

  allMemories() {
    const mind = this.mind;
    const fromStore = listFrom(mind.memory, ['all', 'list', 'entries', 'items', 'memories']);
    if (fromStore.length) return fromStore;
    return Array.isArray(mind.memories) ? mind.memories : [];
  }

  renderMemories() {
    const search = h('input', { type: 'search', class: 'field search', placeholder: 'Search her memories…', value: this.memQuery, 'aria-label': 'Search memories' });
    const results = h('div', { class: 'memories' });
    const count = h('div', { class: 'count' });
    const draw = () => {
      clear(results);
      this.drawMoments(results, count);
    };
    let timer = 0;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        this.memQuery = search.value;
        draw();
      }, 120);
    });
    search.addEventListener('keydown', (e) => e.stopPropagation());
    this.content.append(h('div', { class: 'toolbar' }, search), count, results);
    draw();
  }

  drawMoments(results, count) {
    const all = this.allMemories();
    const found = filterMemories(all, this.memQuery);
    const shown = found.slice(0, 220);
    setText(count, all.length ? `${found.length} of ${all.length} memories${found.length > shown.length ? ` · showing the newest ${shown.length}` : ''}` : '');
    if (!shown.length) {
      results.append(h('p', { class: 'empty', text: all.length ? 'Nothing she remembers matches that.' : 'Her memories of Hearthvale will gather here as you spend time together.' }));
      return;
    }
    const today = this.game.clock?.day || 0;
    const names = this.nameLookup();
    for (const { day, items } of groupByDay(shown)) {
      const group = h('section', { class: 'mem-day' }, h('h3', { class: 'day-head', text: dayLabel(day, today) }));
      for (const m of items) {
        const about = (m.about || []).map((id) => names(id)).filter(Boolean);
        const place = m.location ? names(m.location, true) : '';
        const meta = [m.type && m.type !== 'event' ? m.type : null, place, about.length ? `with ${about.join(', ')}` : null, m.emotion ? (typeof m.emotion === 'string' ? m.emotion : m.emotion.name) : null].filter(Boolean).join(' · ');
        const main = h('div', { class: 'memory-main' });
        const textEl = h('p', { class: 'memory-text', text: m.text });
        const mark = this.editMark(m, main);
        if (mark) textEl.append(mark);
        main.append(textEl);
        if (meta) main.append(h('div', { class: 'memory-meta', text: meta }));
        group.append(h('article', { class: `memory imp-${Math.min(10, Math.max(1, Math.round(m.importance || 1)))}${mark ? ' is-edited' : ''}` }, h('span', { class: 'stars', title: `Importance ${m.importance ?? 1}/10`, text: starString(m.importance) }), main));
      }
      results.append(group);
    }
  }

  // ---------- Knowledge (§17.2) ----------

  renderKnowledge() {
    const list = knowledgeEntries(this.mind);
    const counts = knowledgeCounts(list);
    const search = h('input', { type: 'search', class: 'field search', placeholder: 'Search what she knows…', value: this.knowQuery, 'aria-label': 'Search knowledge' });
    const seg = h('div', { class: 'segmented kind-filter', role: 'radiogroup', 'aria-label': 'Kind of knowledge' });
    const results = h('div', { class: 'knowledge' });
    const count = h('div', { class: 'count' });
    const names = this.nameLookup();
    const draw = () => {
      clear(results);
      const groups = groupKnowledge(list, { query: this.knowQuery, kind: this.knowKind, nameOf: (id) => names(id, true) });
      const n = groups.reduce((a, gr) => a + gr.items.length, 0);
      setText(count, list.length ? `${n} of ${list.length} things she knows` : '');
      if (!groups.length) {
        results.append(h('p', { class: 'empty', text: list.length ? 'Nothing she knows matches that.' : 'She learns about places, people and old stories as she lives here: from what she sees, what villagers tell her, and what you say.' }));
        return;
      }
      for (const gr of groups) {
        const ul = h('ul', { class: 'facts' });
        for (const k of gr.items.slice(0, 40)) {
          const kind = knowledgeKind(k);
          const src = sourceLabel(k, (id) => names(id));
          const conf = kind === 'theory' || kind === 'rumor' ? confidenceWord(k.confidence) : '';
          const factMain = h('span', { class: 'fact-main' });
          const textEl = h('span', { class: 'fact-text', text: k.text });
          const mark = this.editMark(k, factMain, 'fact');
          if (mark) textEl.append(mark);
          factMain.append(textEl);
          if (src || conf) factMain.append(h('span', { class: 'fact-src', text: [src, conf].filter(Boolean).join(' · ') }));
          ul.append(h('li', { class: `fact kind-${kind}${mark ? ' is-edited' : ''}` }, h('span', { class: `kind-badge kind-${kind}`, text: kind }), factMain));
        }
        results.append(h('section', { class: 'fact-group' }, h('h3', { class: 'day-head', text: gr.label }), ul));
      }
    };
    for (const [id, label] of KNOWLEDGE_FILTERS) {
      const b = h('button', { type: 'button', class: 'seg', role: 'radio', 'aria-checked': this.knowKind === id ? 'true' : 'false' }, label, h('span', { class: 'seg-n num', text: String(counts[id] || 0) }));
      b.addEventListener('click', () => {
        this.knowKind = id;
        for (const el of seg.children) el.setAttribute('aria-checked', el === b ? 'true' : 'false');
        draw();
      });
      seg.append(b);
    }
    let timer = 0;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        this.knowQuery = search.value;
        draw();
      }, 120);
    });
    search.addEventListener('keydown', (e) => e.stopPropagation());
    this.content.append(
      h('p', { class: 'tab-intro', text: 'What she knows of the world, and how she came to know it. Theories are her own beliefs and rumors are hearsay: she holds them more loosely than facts.' }),
      h('div', { class: 'toolbar' }, search, seg),
      count,
      results,
    );
    draw();
  }

  // ---------- Her life (§17.1) ----------

  renderLife() {
    const g = this.game;
    const mind = this.mind;
    const name = g.settings?.companionName || g.companion?.name || 'Lyra';
    const items = lifeTimeline({ mind, story: STORY, soul: mind.soul });
    const names = this.nameLookup();
    const line = h('ol', { class: 'life' });
    if (!items.length) line.append(h('li', { class: 'empty', text: 'She keeps her past to herself for now.' }));
    for (const it of items) {
      const who = it.people.map((id) => names(id)).filter(Boolean);
      const where = it.places.map((id) => names(id, true)).filter(Boolean);
      const meta = [where.join(', '), who.length ? `with ${who.join(', ')}` : '', it.feeling].filter(Boolean).join(' · ');
      line.append(
        h(
          'li',
          { class: `life-node imp-${Math.min(10, Math.max(1, Math.round(it.importance)))}` },
          h('span', { class: 'life-age', text: it.ageLabel }),
          h('div', { class: 'life-card' }, h('h3', { class: 'life-title', text: it.title }), it.text && it.text !== it.title ? h('p', { class: 'life-text', text: it.text }) : null, meta ? h('div', { class: 'memory-meta', text: meta }) : null),
        ),
      );
    }
    const cs = companionshipOf(g);
    const day = g.clock?.day || 1;
    line.append(
      h(
        'li',
        { class: 'life-node life-now' },
        h('span', { class: 'life-age', text: 'Now' }),
        h('div', { class: 'life-card' }, h('h3', { class: 'life-title', text: `Day ${day} in Hearthvale` }), h('p', { class: 'life-text', text: `${companionshipLabel(cs)}. ${companionshipBlurb(cs)}` })),
      ),
    );
    this.content.append(h('p', { class: 'tab-intro', text: `${name}'s life from the beginning, as she remembers it.` }), line);
  }

  // id -> display name for people and places mentioned in memories.
  nameLookup() {
    const g = this.game;
    return (id, place = false) => {
      if (!id) return '';
      if (id === 'player') return g.settings?.playerName || 'you';
      if (id === 'lyra') return null;
      if (place) {
        const loc = safe(() => g.locations?.get?.(id));
        if (loc) return loc.name;
      }
      const e = safe(() => g.entities?.get?.(id));
      if (e?.name) return firstName(e.name);
      const rel = safe(() => this.mind?.relationships?.get?.(id));
      if (rel?.name) return firstName(rel.name);
      // People and places from her past live in the lorebook.
      const lore = safe(() => this.mind?.lorebook?.get?.(id));
      if (lore && (lore.name || lore.title)) return String(lore.name || lore.title);
      return String(id)
        .replace(/_/g, ' ')
        .replace(/\b[a-z]/g, (c) => c.toUpperCase());
    };
  }

  // ---------- Diary ----------

  renderDiary() {
    const entries = Array.isArray(this.mind.diary) ? [...this.mind.diary].reverse() : [];
    if (!entries.length) {
      this.content.append(h('p', { class: 'empty', text: 'She has not written anything yet. She writes a page each night when you both sleep.' }));
      return;
    }
    const today = this.game.clock?.day || 0;
    for (const e of entries) {
      if (!e?.text) continue;
      this.content.append(h('article', { class: 'diary-page' }, h('h3', { class: 'diary-day', text: dayLabel(e.day, today) }), ...String(e.text).split(/\n{2,}/).map((p) => h('p', { text: p.trim() }))));
    }
  }

  // ---------- Goals ----------

  renderGoals() {
    const goals = Array.isArray(this.mind.goals) ? this.mind.goals : listFrom(this.mind.goals);
    const open = goals.filter((x) => x && !x.done).sort((a, b) => (b.priority || 0) - (a.priority || 0));
    const done = goals.filter((x) => x && x.done);
    const list = h('div', { class: 'goals' });
    if (!open.length && !done.length) list.append(h('p', { class: 'empty', text: 'She has no goals written down right now.' }));
    for (const goal of [...open, ...done]) {
      const m = meter('meter-priority', 'Priority');
      m.set(clamp01(Number(goal.priority) || 0), '');
      list.append(
        h('article', { class: `goal ${goal.done ? 'done' : ''}` }, icon(goal.done ? 'star' : 'flag'), h('div', { class: 'goal-main' }, h('p', { class: 'goal-text', text: goal.text }), h('div', { class: 'goal-meta' }, h('span', { class: `tag tag-src-${goal.source || 'self'}`, text: GOAL_SOURCES[goal.source] || 'her own' }), goal.done ? h('span', { class: 'tag', text: 'done' }) : m.el))),
      );
    }
    const field = h('input', { type: 'text', class: 'field', maxlength: '160', placeholder: 'Suggest something she could work toward…', 'aria-label': 'Suggest a goal' });
    field.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') suggest();
    });
    const suggest = () => {
      const text = field.value.trim();
      if (!text) return;
      // A suggestion, not an order: she answers in her own words, and the goal is hers to keep.
      this.ui.ask('set_goal', { value: text, amount: 0.6 }, 'goal', "I'll keep that in mind. It's a good one.");
      field.value = '';
      this.showTab('goals');
    };
    this.content.append(list, h('div', { class: 'suggest' }, field, button('Suggest', { cls: 'btn-ember', onClick: suggest })));
  }

  // ---------- Soul ----------

  renderSoul() {
    const mind = this.mind;
    const soul = mind.soul || {};
    const form = h('form', { class: 'soul-form', autocomplete: 'off' });
    form.addEventListener('submit', (e) => e.preventDefault());
    const fields = {};
    const g = this.game;

    const nameInput = h('input', { class: 'field', type: 'text', maxlength: '24', value: g.settings?.companionName || soul.name || 'Lyra' });
    fields.name = nameInput;
    form.append(h('label', { class: 'form-row' }, h('span', { class: 'form-label', text: 'Name' }), nameInput));
    for (const [k, label, kind] of SOUL_TEXT) {
      let input;
      if (kind === 'area') input = h('textarea', { class: 'field', rows: k === 'backstory' ? '5' : '3', maxlength: '1600' });
      else input = h('input', { class: 'field', type: kind === 'number' ? 'number' : 'text', maxlength: '120', min: kind === 'number' ? '1' : null, max: kind === 'number' ? '999' : null });
      input.value = soul[k] == null ? '' : String(soul[k]);
      fields[k] = input;
      form.append(h('label', { class: 'form-row' }, h('span', { class: 'form-label', text: label }), input));
    }

    const traits = h('fieldset', { class: 'traits' }, h('legend', { text: 'Personality' }));
    const pers = soul.personality || {};
    for (const [k, label, lo, hi] of BIG_FIVE) {
      const v = Math.round(clamp01(Number(pers[k] ?? 0.5)) * 100);
      const out = h('output', { class: 'num', text: String(v) });
      const range = h('input', { type: 'range', min: '0', max: '100', step: '1', value: String(v), 'aria-label': label });
      range.addEventListener('input', () => (out.textContent = range.value));
      fields[`p_${k}`] = range;
      traits.append(h('div', { class: 'trait' }, h('span', { class: 'trait-name', text: label }), h('span', { class: 'trait-lo', text: lo }), range, h('span', { class: 'trait-hi', text: hi }), out));
    }
    form.append(traits);

    const lists = h('div', { class: 'soul-lists' });
    for (const [k, label] of SOUL_LISTS) {
      const ta = h('textarea', { class: 'field', rows: '4', maxlength: '1200', placeholder: 'One per line' });
      ta.value = listToText(soul[k]);
      fields[k] = ta;
      lists.append(h('label', { class: 'form-row' }, h('span', { class: 'form-label', text: label }), ta));
    }
    form.append(lists);

    const secrets = Array.isArray(soul.secrets) ? soul.secrets : [];
    const secretTa = h('textarea', { class: 'field', rows: '3', maxlength: '1200', placeholder: 'One per line. She shares these only with people she deeply trusts.' });
    secretTa.value = listToText(secrets);
    fields.secrets = secretTa;
    form.append(h('details', { class: 'secrets' }, h('summary', { text: `Secrets (${secrets.length}) · spoilers` }), secretTa));

    const save = button('Save her soul', { icon: 'star', cls: 'btn-ember', onClick: () => this.saveSoul(fields, secrets) });
    const restore = button('Restore default', { cls: 'btn-ghost', onClick: () => this.restoreSoul() });
    this.content.append(
      h('p', { class: 'tab-intro', text: 'Who she is at heart. Changes shape how she speaks, what she cares about and what she refuses. Be kind: she will believe whatever you write here.' }),
      form,
      h('div', { class: 'form-actions' }, restore, save),
    );
  }

  saveSoul(fields, oldSecrets) {
    const g = this.game;
    const mind = this.mind;
    if (!mind) return;
    const soul = clone(mind.soul || {}) || {};
    const name = fields.name.value.trim().slice(0, 24) || soul.name || 'Lyra';
    soul.name = name;
    for (const [k, , kind] of SOUL_TEXT) {
      const v = fields[k].value.trim();
      soul[k] = kind === 'number' ? Math.max(1, Math.min(999, Math.round(Number(v) || soul[k] || 24))) : v;
    }
    soul.personality = { ...(soul.personality || {}) };
    for (const [k] of BIG_FIVE) soul.personality[k] = Number(fields[`p_${k}`].value) / 100;
    for (const [k] of SOUL_LISTS) soul[k] = parseList(fields[k].value);
    const secretLines = parseList(fields.secrets.value);
    soul.secrets = secretLines.map((text, i) => ({ ...(oldSecrets[i] && typeof oldSecrets[i] === 'object' ? oldSecrets[i] : { revealAtBond: 4 }), text }));
    this.applySoul(soul);
    if (name !== (g.settings?.companionName || 'Lyra')) {
      g.setSetting?.('companionName', name);
      if (g.companion) g.companion.name = name;
    }
    this.ui.toast(`${name}'s soul has been rewritten. She will grow into it.`, 'good');
    g.audio?.play('magic');
    this._heroKey = '';
    this.renderHero();
  }

  applySoul(soul) {
    const g = this.game;
    const mind = this.mind;
    if (typeof mind.setSoul === 'function') mind.setSoul(soul);
    else if (mind.soul && typeof mind.soul === 'object') {
      for (const k of Object.keys(mind.soul)) if (!(k in soul)) delete mind.soul[k];
      Object.assign(mind.soul, soul);
    } else mind.soul = soul;
    g.bus.emit('soul_changed', { owner: g.companion });
  }

  restoreSoul() {
    this.ui.confirm({ title: 'Restore her soul?', text: 'Every change made in the Soul tab goes back to who she was when you met her. Her memories and relationships stay.', yes: 'Restore', danger: false }).then((yes) => {
      if (!yes) return;
      const mind = this.mind;
      let ok = false;
      if (typeof mind.resetSoul === 'function') {
        safe(() => mind.resetSoul());
        this.game.bus.emit('soul_changed', { owner: this.game.companion });
        ok = true;
      } else {
        const def = typeof mind.defaultSoul === 'function' ? safe(() => mind.defaultSoul()) : mind.defaultSoul || this.ui.soulSnapshot;
        if (def) {
          this.applySoul(clone(def));
          ok = true;
        }
      }
      const name = mind.soul?.name;
      if (ok && name && this.game.companion) {
        this.game.setSetting?.('companionName', name);
        this.game.companion.name = name;
      }
      this.ui.toast(ok ? 'Her soul is as it was when you met.' : 'There is no saved original to restore in this session.', ok ? 'good' : 'warn');
      if (this.isOpen()) this.showTab('soul');
    });
  }

  // ---------- Data ----------

  renderData() {
    const g = this.game;
    const mind = this.mind;
    const rt = g.runtime;
    const json = g.save?.exportMind?.() || '';
    const people = listFrom(mind.relationships, ['all', 'list']).length;
    const stats = [
      ['Memories', this.allMemories().length],
      ['People', people],
      ['Diary pages', Array.isArray(mind.diary) ? mind.diary.length : 0],
      ['Goals', Array.isArray(mind.goals) ? mind.goals.length : 0],
      ['Things she knows', listFrom(mind.knowledge, ['all', 'list']).length],
      ['Deeds she remembers', ledgerEntries(mind).length],
      ['Size', bytesLabel(utf8Bytes(json))],
    ];
    const statGrid = h('dl', { class: 'stats' });
    for (const [k, v] of stats) statGrid.append(h('div', { class: 'stat' }, h('dt', { text: k }), h('dd', { class: 'num', text: String(v) })));

    const status = h('p', { class: 'data-status', role: 'status' });
    const exportRow = h('div', { class: 'data-actions' });
    const manual = h('textarea', { class: 'field mono', rows: '5', readonly: true, hidden: true, 'aria-label': 'Mind export' });
    // Last resort when neither a file nor the clipboard is allowed: the text itself.
    const showManual = (data, why) => {
      manual.hidden = false;
      manual.value = data;
      manual.focus();
      manual.select();
      setText(status, why);
    };
    const fileName = () => `${(g.settings?.companionName || 'lyra').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-mind-day${g.clock?.day || 1}.json`;
    if (rt?.downloads) {
      exportRow.append(
        button('Save her mind as a file', {
          icon: 'book',
          cls: 'btn-ember',
          onClick: () => {
            const data = g.save?.exportMind?.();
            if (!data) return;
            rt.downloads.save({ filename: fileName(), data }).then(
              (res) => setText(status, res?.status === 'delivered' ? 'Sent where you chose.' : 'Saved. Keep it somewhere safe.'),
              (err) => {
                const code = err?.code;
                if (code === 'declined') setText(status, 'Not saved. Her mind stays only in this game.');
                else if (code === 'rate_limited') setText(status, 'A save prompt is already open. Answer it first.');
                else {
                  copyText(data).then((ok) => {
                    if (ok) setText(status, `Saving files is not available here, so ${bytesLabel(utf8Bytes(data))} went to the clipboard instead.`);
                    else showManual(data, 'Saving files is not available here. Select the text below and copy it yourself.');
                  });
                }
              },
            );
          },
        }),
      );
    } else if (!rt?.hostPresent) {
      exportRow.append(
        button('Download her mind', {
          icon: 'book',
          cls: 'btn-ember',
          onClick: () => {
            const data = g.save?.exportMind?.();
            if (!data) return;
            try {
              const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
              const a = h('a', { href: url, download: fileName() });
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 4000);
              setText(status, 'Downloaded. Keep it somewhere safe.');
            } catch {
              setText(status, 'Downloading failed. Use copy instead.');
            }
          },
        }),
      );
    }
    exportRow.append(
      button('Copy to clipboard', {
        icon: 'scroll',
        cls: rt?.downloads || !rt?.hostPresent ? 'btn-ghost' : 'btn-ember',
        onClick: () => {
          const data = g.save?.exportMind?.();
          if (!data) return;
          copyText(data).then((ok) => {
            if (ok) setText(status, `Copied ${bytesLabel(utf8Bytes(data))} to the clipboard.`);
            else showManual(data, 'Copying was blocked. Select the text below and copy it yourself.');
          });
        },
      }),
    );

    const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', 'aria-label': 'Mind file to import' });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      fileInput.value = '';
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) {
        setText(status, 'That file is far too large to be a mind export.');
        return;
      }
      f.text().then(
        (text) => {
          this.ui.confirm({ title: 'Bring back this mind?', text: `Replace her current mind with the one in “${truncate(f.name, 40)}”? Everything she knows now will be replaced.`, yes: 'Replace', danger: true }).then((yes) => {
            if (!yes) return;
            const r = g.save?.importMind?.(text) || { ok: false, message: 'Importing is unavailable.' };
            this.ui.toast(r.message, r.ok ? 'good' : 'warn');
            setText(status, r.message);
            if (r.ok) {
              this._heroKey = '';
              this.renderHero();
              this.showTab('data');
            }
          });
        },
        () => setText(status, 'That file could not be read.'),
      );
    });
    const importBtn = button('Import from a file', { icon: 'chest', cls: 'btn-ghost', onClick: () => fileInput.click() });

    const resetBtn = button('Reset her mind', { icon: 'heart', cls: 'btn-danger', onClick: () => this.confirmReset() });

    this.content.append(
      h('p', { class: 'tab-intro', text: 'Everything above lives here as data: her soul, feelings, memories, what she knows, the people in her life, how she sees you, her diary and her goals. Export it to keep a copy, move her to another device, or bring her back after a fresh start.' }),
      statGrid,
      h('section', { class: 'box' }, h('h3', { text: 'Export' }), exportRow, manual),
      h('section', { class: 'box' }, h('h3', { text: 'Import' }), h('p', { class: 'muted', text: 'Restore a mind saved from Hearthlight. It replaces what she knows now.' }), h('div', { class: 'data-actions' }, importBtn, fileInput)),
      h('section', { class: 'box box-danger' }, h('h3', { text: 'Start her over' }), h('p', { class: 'muted', text: RESET_WARNING }), h('div', { class: 'data-actions' }, resetBtn)),
      status,
    );
  }

  confirmReset() {
    this.ui.confirm({ title: 'Reset her mind?', text: RESET_WARNING, yes: 'Yes, she forgets', no: 'Keep her', danger: true }).then((yes) => {
      if (!yes) return;
      const ok = this.ui.resetMind();
      this.ui.toast(ok ? 'She blinks, as if waking somewhere new.' : 'Her mind could not be reset here.', ok ? 'lyra' : 'warn');
      this._heroKey = '';
      if (this.isOpen()) {
        this.renderHero();
        this.showTab('data');
      }
    });
  }
}
