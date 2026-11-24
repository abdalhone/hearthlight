// Lyra's Mind (DESIGN.md §14): the place where she keeps who she is and what she
// knows. Tabs: Now, People, Memories, Diary, Goals, Soul, Data. Everything read from
// the mind is read defensively: its stores are written by another module.

import { h, icon, button, clear, setText, setStyle, toggleClass, meter, copyText, appendAll } from './dom.js';
import { makePanel } from './modal.js';
import { portraitUrl } from './art.js';
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
import { RESET_WARNING } from './content.js';

export const MIND_TABS = [
  { id: 'now', label: 'Now' },
  { id: 'people', label: 'People' },
  { id: 'memories', label: 'Memories' },
  { id: 'diary', label: 'Diary' },
  { id: 'goals', label: 'Goals' },
  { id: 'soul', label: 'Soul' },
  { id: 'data', label: 'Data' },
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
    this.memMode = 'moments';
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
    panel.body.classList.add('mind-body');
    panel.body.append(this.hero, this.tabsEl, this.content);
    panel.onClose = () => {
      this.panel = null;
      this.nowRefs = null;
    };
    this.ui.openModal(panel);
    this.renderHero();
    this.showTab(this.tab);
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
      this.content.append(h('p', { class: 'empty', text: 'Lyra is not here yet. Start a game to meet her.' }));
      return;
    }
    const render = {
      now: () => this.renderNow(),
      people: () => this.renderPeople(),
      memories: () => this.renderMemories(),
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
    if (this.tab === 'now') this.updateNow();
    else if (this.dirty && (this.tab === 'people' || this.tab === 'goals' || this.tab === 'diary')) {
      const top = this.content.scrollTop;
      this.showTab(this.tab);
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
    const expr = moodToExpression(mood, mind?.emotions, mind?.needs);
    const soul = mind?.soul || {};
    const name = g.settings?.companionName || c?.name || soul.name || 'Lyra';
    const rel = safe(() => mind?.relationships?.get?.('player'));
    const bond = safe(() => mind?.relationships?.bond?.('player'));
    const level = bond?.level ?? 0;
    const key = `${expr}|${name}|${mood?.label}|${level}|${bond?.label}`;
    if (this._heroKey === key) return;
    this._heroKey = key;
    clear(this.hero);
    const img = h('img', { class: 'portrait portrait-lg', alt: `${name}`, draggable: 'false' });
    const url = portraitUrl(g, 'lyra', expr);
    if (url) img.src = url;
    const pips = h('span', { class: 'pips', 'aria-label': `Bond level ${level} of 5` });
    for (let i = 1; i <= 5; i++) pips.append(h('i', { class: i <= level ? 'on' : '' }));
    this.hero.append(
      h('span', { class: 'portrait-frame large' }, img),
      h(
        'div',
        { class: 'hero-text' },
        h('div', { class: 'hero-name' }, h('span', { text: name }), soul.fullName && soul.fullName !== name ? h('span', { class: 'hero-full', text: soul.fullName }) : null),
        h('div', { class: 'hero-mood' }, h('span', { class: 'mood-emoji', text: moodEmoji(mood) }), h('span', { text: mood?.label ? `Feeling ${mood.label}` : 'Feeling like herself' })),
        h('div', { class: 'hero-bond' }, h('span', { text: `With you: ${bond?.label || bondLabel(level)}` }), pips, rel && Number.isFinite(rel.trust) ? h('span', { class: 'hero-trust num', text: `trust ${Math.round(rel.trust)}` }) : null),
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
    this.content.append(
      h('div', { class: 'now-grid' },
        h('section', { class: 'box box-state' }, h('h3', { text: 'Right now' }), stateText, doing),
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
    setText(r.stateText, safe(() => mind.describeState?.(), '') || 'She is quiet, taking in the world around her.');
    const beh = c?.behavior;
    const status = safe(() => beh?.status?.(), '') || 'nearby';
    const dir = beh?.directive?.type || 'follow';
    const stance = beh?.stance || 'defend';
    const target = beh?.currentTarget;
    clear(r.doing);
    appendAll(r.doing, [
      h('span', { class: 'chip chip-static' }, icon('boots'), h('span', { text: capitalize(status) })),
      h('span', { class: `chip chip-static stance-${stance}` }, icon(stance === 'attack' ? 'sword' : stance === 'passive' ? 'feather' : 'shield'), h('span', { text: capitalize(stanceLabel(stance)) })),
      h('span', { class: 'chip chip-static' }, icon('flag'), h('span', { text: `Order: ${dir}` })),
      target && target.name ? h('span', { class: 'chip chip-static chip-danger' }, icon('sword'), h('span', { text: `Fighting ${target.name}` })) : null,
    ]);
    const emo = mind.emotions || {};
    for (const [k] of EMOTIONS) r.emo[k].set(clamp01(Number(emo[k]) || 0), `${Math.round((Number(emo[k]) || 0) * 100)}`);
    const needs = mind.needs || {};
    for (const [k] of NEEDS) {
      const v = clamp01(Number(needs[k] ?? 1));
      r.need[k].set(v, `${Math.round(v * 100)}`);
      toggleClass(r.need[k].el, 'low', v < 0.3);
    }
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

  // ---------- People ----------

  renderPeople() {
    const mind = this.mind;
    const rels = listFrom(mind.relationships, ['all', 'list']).filter((r) => r && r.id);
    if (!rels.length) {
      this.content.append(h('p', { class: 'empty', text: "She hasn't really met anyone here yet. Walk her through the village." }));
      return;
    }
    const list = h('div', { class: 'people' });
    for (const rel of rels) list.append(this.personCard(rel));
    this.content.append(h('p', { class: 'tab-intro', text: 'Everyone she knows, and what she honestly thinks of them. Mark someone a friend and attack mode will never touch them; mark an enemy and she treats them as a threat.' }), list);
  }

  personCard(rel) {
    const g = this.game;
    const mind = this.mind;
    const bond = safe(() => mind.relationships.bond?.(rel.id)) || {};
    const level = Math.max(0, Math.min(5, Math.round(bond.level ?? 0)));
    const tags = Array.isArray(rel.tags) ? rel.tags : [];
    const isPlayer = rel.id === 'player';
    const name = isPlayer ? g.settings?.playerName || rel.name || 'You' : rel.name || rel.id;
    const img = h('img', { class: 'portrait portrait-md', alt: '', draggable: 'false', loading: 'lazy' });
    const url = portraitUrl(g, rel.id, rel.affinity > 40 ? 'happy' : rel.affinity < -30 ? 'angry' : 'neutral');
    if (url) img.src = url;
    else img.classList.add('no-art');

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
      const v = Number(rel[k]) || 0;
      if (k === 'fear' && v < 5) continue;
      const m = meter(cls, label);
      m.set(v / 100, `${Math.round(v)}`);
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
      const fBtn = button(isFriend ? 'Unmark friend' : 'Mark friend', { icon: 'heart', cls: `btn-small ${isFriend ? 'btn-ghost' : 'btn-good'}` });
      const eBtn = button(isEnemy ? 'Unmark enemy' : 'Mark enemy', { icon: 'sword', cls: `btn-small ${isEnemy ? 'btn-ghost' : 'btn-danger'}` });
      fBtn.addEventListener('click', () => this.setTag(rel, isFriend ? '-friend' : 'friend'));
      eBtn.addEventListener('click', () => this.setTag(rel, isEnemy ? '-enemy' : 'enemy'));
      actions = h('div', { class: 'person-actions' }, fBtn, eBtn);
    }

    const meta = [rel.role, rel.kind && rel.kind !== 'human' ? rel.kind : null].filter(Boolean).join(' · ');
    return h(
      'article',
      { class: `person ${tags.includes('enemy') ? 'is-enemy' : ''} ${tags.includes('friend') ? 'is-friend' : ''}`.trim() },
      h('span', { class: 'portrait-frame' }, img),
      h(
        'div',
        { class: 'person-main' },
        h('div', { class: 'person-head' }, h('span', { class: 'person-name', text: name }), meta ? h('span', { class: 'person-role', text: capitalize(meta) }) : null, h('span', { class: 'bond' }, h('span', { class: 'bond-label', text: bond.label || bondLabel(level) }), pips)),
        tagRow.childElementCount ? tagRow : null,
        opinion,
        bars,
        notesEl,
        actions,
      ),
    );
  }

  setTag(rel, value) {
    const g = this.game;
    const r = safe(() => g.actions.run('set_relationship', { target: rel.id, value }, 'player'), { ok: false, message: '' });
    const who = rel.name?.split(' ')[0] || rel.id;
    if (r.ok) {
      const msg = r.message || (value === 'friend' ? `${who} is a friend now. I won't raise a hand to them.` : value === 'enemy' ? `${who}… fine. I'll treat them as a threat.` : `All right, I'll make up my own mind about ${who}.`);
      this.ui.toast(msg, 'lyra');
      g.audio?.play('ui_click');
    } else {
      this.ui.toast(r.message || "She won't change how she sees them just like that.", 'lyra');
      g.audio?.play('error');
    }
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
    const seg = h('div', { class: 'segmented' });
    const modes = [
      ['moments', 'Moments'],
      ['knowledge', 'Things she knows'],
    ];
    const results = h('div', { class: 'memories' });
    const count = h('div', { class: 'count' });
    const draw = () => {
      clear(results);
      if (this.memMode === 'knowledge') this.drawKnowledge(results, count);
      else this.drawMoments(results, count);
    };
    for (const [id, label] of modes) {
      const b = h('button', { type: 'button', class: 'seg', role: 'radio', 'aria-checked': this.memMode === id ? 'true' : 'false', text: label });
      b.addEventListener('click', () => {
        this.memMode = id;
        for (const el of seg.children) el.setAttribute('aria-checked', el === b ? 'true' : 'false');
        draw();
      });
      seg.append(b);
    }
    let timer = 0;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        this.memQuery = search.value;
        draw();
      }, 120);
    });
    this.content.append(h('div', { class: 'toolbar' }, search, seg), count, results);
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
        group.append(h('article', { class: `memory imp-${Math.min(10, Math.max(1, Math.round(m.importance || 1)))}` }, h('span', { class: 'stars', title: `Importance ${m.importance ?? 1}/10`, text: starString(m.importance) }), h('div', { class: 'memory-main' }, h('p', { class: 'memory-text', text: m.text }), meta ? h('div', { class: 'memory-meta', text: meta }) : null)));
      }
      results.append(group);
    }
  }

  drawKnowledge(results, count) {
    const list = listFrom(this.mind.knowledge, ['all', 'list', 'entries']);
    const q = this.memQuery.trim().toLowerCase();
    const found = list.filter((k) => k && k.text && (!q || `${k.subject} ${k.text}`.toLowerCase().includes(q)));
    setText(count, list.length ? `${found.length} of ${list.length} things she knows` : '');
    if (!found.length) {
      results.append(h('p', { class: 'empty', text: list.length ? 'Nothing she knows matches that.' : 'She will learn about places, people and things as you explore.' }));
      return;
    }
    const bySubject = new Map();
    for (const k of found) {
      const s = k.subject || 'Other';
      if (!bySubject.has(s)) bySubject.set(s, []);
      bySubject.get(s).push(k);
    }
    for (const [subject, items] of bySubject) {
      const ul = h('ul', { class: 'facts' });
      for (const k of items.slice(-20)) ul.append(h('li', { text: k.text }));
      results.append(h('section', { class: 'fact-group' }, h('h3', { class: 'day-head', text: capitalize(this.nameLookup()(subject, true) || subject) }), ul));
    }
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
      if (e?.name) return e.name.split(' ')[0];
      const rel = safe(() => this.mind?.relationships?.get?.(id));
      if (rel?.name) return rel.name.split(' ')[0];
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
        h('article', { class: `goal ${goal.done ? 'done' : ''}` }, icon(goal.done ? 'star' : 'flag'), h('div', { class: 'goal-main' }, h('p', { class: 'goal-text', text: goal.text }), h('div', { class: 'goal-meta' }, h('span', { class: `tag tag-src-${goal.source || 'self'}`, text: goal.source === 'player' ? 'from you' : goal.source || 'her own' }), goal.done ? h('span', { class: 'tag', text: 'done' }) : m.el))),
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
      const r = safe(() => this.game.actions.run('set_goal', { value: text, amount: 0.6 }, 'player'), { ok: false, message: '' });
      this.ui.toast(r.ok ? r.message || "I'll keep that in mind. It's a good one." : r.message || "That isn't something I want to chase.", 'lyra');
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
      ['Size', bytesLabel(utf8Bytes(json))],
    ];
    const statGrid = h('dl', { class: 'stats' });
    for (const [k, v] of stats) statGrid.append(h('div', { class: 'stat' }, h('dt', { text: k }), h('dd', { class: 'num', text: String(v) })));

    const status = h('p', { class: 'data-status', role: 'status' });
    const exportRow = h('div', { class: 'data-actions' });
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
                if (code === 'declined') setText(status, 'Not saved.');
                else if (code === 'rate_limited') setText(status, 'A save prompt is already open.');
                else {
                  setText(status, 'Saving files is not available here; copied to the clipboard instead.');
                  copyText(data);
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
    const manual = h('textarea', { class: 'field mono', rows: '5', readonly: true, hidden: true, 'aria-label': 'Mind export' });
    exportRow.append(
      button('Copy to clipboard', {
        icon: 'scroll',
        cls: rt?.downloads || !rt?.hostPresent ? 'btn-ghost' : 'btn-ember',
        onClick: () => {
          const data = g.save?.exportMind?.();
          if (!data) return;
          copyText(data).then((ok) => {
            if (ok) setText(status, `Copied ${bytesLabel(utf8Bytes(data))} to the clipboard.`);
            else {
              manual.hidden = false;
              manual.value = data;
              manual.focus();
              manual.select();
              setText(status, 'Copying was blocked. Select the text below and copy it yourself.');
            }
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
      h('p', { class: 'tab-intro', text: 'Everything above lives here as data: her soul, feelings, memories, people, diary and goals. Export it to keep a copy, move her to another device, or bring her back after a fresh start.' }),
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
