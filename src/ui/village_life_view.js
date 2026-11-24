// "Hearthvale today" (DESIGN §28): the player can follow the village's day the way they
// follow Lyra's mind. Who is missing and what the village has pieced together; who has a
// problem, what they are thinking and what they said; what everyone is doing and how their
// errands went. Reads game.villageLife.view() (a plain snapshot) and refreshes while open.

import { h, clear } from './dom.js';
import { makePanel } from './modal.js';
import { portraitUrl } from './art.js';

const REFRESH = 1; // seconds

const STATUS = {
  noticed: ['Not where they should be', 'is-look'],
  asking: ['People are asking', 'is-look'],
  search: ['The watch is searching', 'is-search'],
  missing: ['Missing', 'is-missing'],
  found: ['Found safe', 'is-found'],
  dead: ['Found dead', 'is-dead'],
};

const ERRAND_MARK = {
  planned: ['·', 'later today'],
  active: ['…', 'on it now'],
  done: ['✓', 'done'],
  failed: ['✗', "couldn't"],
  given_up: ['✗', 'gave up'],
  skipped: ['–', 'did not happen'],
};

// The view-model, without the DOM (tested under node).
export function lifeSections(view) {
  if (!view) return { cases: [], troubled: [], everyone: [], events: [] };
  const troubled = (view.people || []).filter((p) => p.problem);
  const everyone = (view.people || []).filter((p) => !p.unseen);
  return { cases: view.cases || [], troubled, everyone, events: (view.events || []).slice(-24).reverse() };
}

// Still looking, or the day's scares are over.
export function casesHeading(cases) {
  const list = cases || [];
  if (list.some((c) => c.status !== 'found' && c.status !== 'dead')) return 'The village is looking for';
  if (list.some((c) => c.status === 'dead')) return 'Mourned in Hearthvale';
  return 'Turned up safe';
}

export function caseLine(c) {
  const [label] = STATUS[c.status] || [c.status];
  return `${c.name}: ${label.toLowerCase()}`;
}

export class VillageLifePanel {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.panel = null;
    this.t = 0;
    this.open = new Set(); // case timelines left open
  }

  isOpen() {
    return !!this.panel && this.ui.stack.includes(this.panel);
  }

  available() {
    return typeof this.game.villageLife?.view === 'function';
  }

  show() {
    if (!this.available()) return false;
    if (this.isOpen()) return true;
    const panel = makePanel({ id: 'village-life', title: 'Hearthvale today', subtitle: '', iconName: 'people', cls: 'panel-wide panel-life' });
    panel.pauses = false;
    this.panel = panel;
    this.render();
    this.ui.openModal(panel);
    return true;
  }

  toggle() {
    if (this.isOpen()) this.ui.closeModal(this.panel);
    else this.show();
  }

  update(dt) {
    if (!this.isOpen()) return;
    this.t += dt;
    if (this.t < REFRESH) return;
    this.t = 0;
    this.render();
  }

  portrait(id, cls = 'portrait-sm') {
    const url = portraitUrl(this.game, this.game.entities?.get?.(id)?.spriteKey || id, 'neutral');
    const img = url ? h('img', { class: `portrait ${cls}`, alt: '', draggable: 'false', src: url }) : h('span', { class: `portrait ${cls} monogram`, 'aria-hidden': 'true', text: String(id || '?').charAt(0).toUpperCase() });
    return h('span', { class: 'portrait-frame' }, img);
  }

  render() {
    const g = this.game;
    const life = g.villageLife;
    const p = this.panel;
    if (!life || !p) return;
    let view;
    try {
      view = life.view();
    } catch (err) {
      console.warn('[village life view]', err);
      return;
    }
    const scroll = p.body.scrollTop;
    p.setTitle('Hearthvale today', `Day ${view.day} · ${view.time} · what everyone is about`);
    const S = lifeSections(view);
    const body = h('div', { class: 'life-body' });

    // Missing, searched for, found.
    if (S.cases.length) {
      const sec = h('section', { class: 'life-sec' }, h('h3', { class: 'life-h', text: casesHeading(S.cases) }));
      for (const c of S.cases) sec.append(this.caseCard(c));
      body.append(sec);
    }

    // People with a problem: their thought, what they said, what they are doing about it.
    const ts = h('section', { class: 'life-sec' }, h('h3', { class: 'life-h', text: S.troubled.length ? 'Having a bad day' : 'Nobody is in trouble right now' }));
    for (const x of S.troubled) ts.append(this.troubleCard(x));
    body.append(ts);

    // Everyone, and their errands.
    const ev = h('section', { class: 'life-sec' }, h('h3', { class: 'life-h', text: 'Everyone' }));
    const grid = h('div', { class: 'life-grid' });
    for (const x of S.everyone) grid.append(this.personRow(x));
    ev.append(grid);
    body.append(ev);

    // The day so far.
    if (S.events.length) {
      const log = h('section', { class: 'life-sec' }, h('h3', { class: 'life-h', text: 'Today in Hearthvale' }));
      const ol = h('ol', { class: 'life-log' });
      for (const e of S.events) ol.append(h('li', { class: `life-ev ev-${e.kind}` }, h('span', { class: 'life-time', text: e.time }), h('span', { class: 'life-text', text: e.text })));
      log.append(ol);
      body.append(log);
    }

    const c = view.claude;
    const how = c?.enabled ? `Villagers think with Claude when something goes wrong (${c.calls} of ${c.cap} calls this visit${c.busy ? ', thinking now' : ''}).` : 'Villagers work their problems out by their own reasoning. With Claude available, Settings → "Villagers think with Claude: Always" lets Claude think for them.';
    body.append(h('p', { class: 'muted small life-foot', text: how }));

    clear(p.body);
    p.body.append(body);
    p.body.scrollTop = scroll;
  }

  caseCard(c) {
    const [label, cls] = STATUS[c.status] || [c.status, ''];
    const card = h('article', { class: `life-case ${cls}` });
    const head = h('div', { class: 'life-case-head' }, this.portrait(c.about, 'portrait-md'), h('div', { class: 'life-case-title' }, h('span', { class: 'person-name', text: c.name }), h('span', { class: `life-status ${cls}`, text: label })));
    card.append(head);
    const facts = h('dl', { class: 'life-facts' });
    const fact = (k, v) => v && facts.append(h('dt', { text: k }), h('dd', { text: v }));
    if (c.found) fact('Found', c.found);
    fact('Last seen', c.found ? null : c.lastSeen || 'nobody can say');
    fact('Missed since', c.since);
    if (c.searching.length) fact('Searching now', c.searching.map((s) => `${s.name} (${s.place})`).join(', '));
    if (c.searched.length) fact('Searched', c.searched.join(', '));
    card.append(facts);
    if (c.timeline.length) {
      const d = h('details', { class: 'life-timeline' });
      if (this.open.has(c.about)) d.open = true;
      d.addEventListener('toggle', () => (d.open ? this.open.add(c.about) : this.open.delete(c.about)));
      d.append(h('summary', { text: `How it unfolded (${c.timeline.length})` }));
      const ol = h('ol', { class: 'life-log' });
      for (const x of c.timeline) ol.append(h('li', { class: `life-ev ev-${x.kind}` }, h('span', { class: 'life-time', text: x.time }), h('span', { class: 'life-text', text: x.text })));
      d.append(ol);
      card.append(d);
    }
    return card;
  }

  troubleCard(x) {
    const p = x.problem;
    const card = h('article', { class: 'life-trouble' });
    const main = h('div', { class: 'person-main' });
    main.append(h('div', { class: 'person-head' }, h('span', { class: 'person-name', text: x.name }), h('span', { class: 'life-q', 'aria-hidden': 'true', text: p.awaiting ? '…' : '?' }), h('span', { class: 'life-src', text: p.source === 'claude' ? 'thinking with Claude' : 'their own reasoning' })));
    if (p.thought) main.append(h('p', { class: 'life-thought', text: `“${p.thought}”` }));
    if (p.said) main.append(h('p', { class: 'life-said', text: `Says: “${p.said}”` }));
    if (x.doing) main.append(h('p', { class: 'life-doing', text: `Now: ${x.doing}.` }));
    const bits = [];
    if (p.aboutName) bits.push(`Looking for ${p.aboutName} since ${p.since}`);
    if (p.asked.length) bits.push(`asked ${p.asked.join(', ')}`);
    if (p.checked.length) bits.push(`looked in ${p.checked.join(', ')}`);
    if (bits.length) main.append(h('p', { class: 'muted small', text: `${bits.join('; ')}.` }));
    card.append(this.portrait(x.id, 'portrait-md'), main);
    return card;
  }

  personRow(x) {
    const row = h('div', { class: `life-person${x.problem ? ' has-problem' : ''}${x.mourning ? ' is-worried' : ''}` });
    const text = h('div', { class: 'life-person-text' });
    text.append(h('span', { class: 'life-name', text: x.name }), h('span', { class: 'life-doing', text: x.doing ? capitalize(x.doing) : '' }));
    if (x.mourning) text.append(h('span', { class: 'life-worry', text: x.mourning.kind === 'grief' ? `Grieving for ${x.mourning.aboutName}` : `Worried about ${x.mourning.aboutName}` }));
    if (x.errands.length) {
      const chips = h('div', { class: 'life-errands' });
      for (const e of x.errands) {
        const [mark, word] = ERRAND_MARK[e.state] || ['·', e.state];
        chips.append(h('span', { class: `life-errand st-${e.state}`, title: `${capitalize(e.label)}: ${word}${e.result ? ` (${e.result})` : ''}`, text: `${mark} ${e.label}` }));
      }
      text.append(chips);
    }
    row.append(this.portrait(x.id), text);
    return row;
  }
}

function capitalize(s) {
  const t = String(s || '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

