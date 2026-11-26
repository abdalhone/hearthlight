// People (round 14b, DESIGN §34.5): you and each person, Lyra one of them. Replaces Lyra's
// Mind panel in play (Tab, M, a tap on the companion's card, Menu → People). A list on the
// left on a computer, a strip across the top on a phone; a page per person:
//   You       how Hearthvale sees you: the talk about you, each villager's view, titles
//   Lyra      you and her, how she sees you, her life; what she shares (memories, knowledge,
//             secrets) and a count of what she keeps; diary pages read (the rest closed);
//             who she is (read only); a memorial once she is dead
//   villager  you and them (what they told you, talk, a grievance, a gift), how they see
//             you, their life
// Actions on a page: Talk (talk's ui.talkTo when it exists), Invite to travel / Ask her to
// travel with you again (game.party.invite), Go home, thank you (party.release), and the Ask
// row of orders for whoever walks with you. Nothing here edits a soul. View-models in
// people_view.js. Closable by ✕ (44 px), Esc or a tap beside it.

import { h, icon, button, clear, toggleClass } from './dom.js';
import { makePanel } from './modal.js';
import { portraitUrl } from './art.js';
import { COMMANDS, JOBS, DELIVER_OPTIONS } from './content.js';
import { peopleList, youPage, lyraPage, lyraContext, villagerPage } from './people_view.js';
import { holderOf } from '../core/party.js';

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    console.warn('[people]', err);
    return fallback;
  }
}

function box(title, ...kids) {
  return h('section', { class: 'box people-box' }, h('h3', { text: title }), ...kids.filter(Boolean));
}

function para(text, cls = '') {
  return text ? h('p', { class: cls || null, text }) : null;
}

function list(items, cls = 'people-items') {
  const ul = h('ul', { class: cls });
  for (const it of items) if (it) ul.append(typeof it === 'string' ? h('li', { text: it }) : it);
  return ul;
}

export class PeoplePanel {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.panel = null;
    this.who = 'you';
    this.dirty = false;
    this.refreshT = 0;
    this.jobsOpen = false;
  }

  isOpen() {
    return !!this.panel && this.ui.stack.includes(this.panel);
  }

  open(who = null) {
    const id = who || holderOf(this.game)?.id || 'you';
    this.who = id;
    if (this.isOpen()) {
      this.render();
      return;
    }
    const panel = makePanel({ id: 'people', title: 'People', subtitle: 'You, and everyone you know', iconName: 'mind', cls: 'panel-wide panel-people' });
    panel.pauses = true;
    this.panel = panel;
    this.listEl = h('nav', { class: 'people-list', 'aria-label': 'People' });
    this.pageEl = h('div', { class: 'people-page' });
    panel.body.classList.add('people-body');
    panel.body.append(h('div', { class: 'people-layout' }, this.listEl, this.pageEl));
    panel.onClose = () => {
      this.panel = null;
    };
    this.ui.openModal(panel);
    this.render();
  }

  close() {
    if (this.isOpen()) this.ui.closeModal(this.panel);
  }

  toggle() {
    if (this.isOpen()) this.close();
    else this.open();
  }

  markDirty() {
    if (this.isOpen()) this.dirty = true;
  }

  update(dt) {
    if (!this.isOpen()) return;
    this.refreshT += dt;
    if (this.refreshT < 1) return;
    this.refreshT = 0;
    if (this.dirty) {
      this.dirty = false;
      const top = this.pageEl.scrollTop;
      this.render();
      this.pageEl.scrollTop = top;
    }
  }

  select(id) {
    this.who = id;
    this.jobsOpen = false;
    this.game.audio?.play?.('ui_click');
    this.render();
    this.pageEl.scrollTop = 0;
  }

  render() {
    if (!this.panel) return;
    const people = safe(() => peopleList(this.game), []) || [];
    if (!people.some((p) => p.id === this.who)) {
      // Someone not met yet (a card tap on a new companion): add them, else You.
      const e = safe(() => this.game.entities?.get?.(this.who), null);
      if (!e?.profile) this.who = 'you';
    }
    this.renderList(people);
    clear(this.pageEl);
    try {
      if (this.who === 'you') this.renderYou();
      else if (this.who === 'lyra') this.renderLyra();
      else this.renderVillager(this.game.entities.get(this.who));
    } catch (err) {
      console.warn('[people] page failed', this.who, err);
      this.pageEl.append(h('p', { class: 'empty', text: 'This page could not be shown right now.' }));
    }
  }

  renderList(people) {
    clear(this.listEl);
    for (const p of people) {
      const img = h('img', { class: 'portrait people-face', alt: '', draggable: 'false' });
      const url = p.kind === 'you' ? '' : portraitUrl(this.game, p.portraitKey, p.dead ? 'sad' : 'neutral');
      if (url) img.src = url;
      const face = p.kind === 'you' ? h('span', { class: 'people-face people-you-face', 'aria-hidden': 'true' }, icon('heart')) : img;
      const b = h(
        'button',
        { type: 'button', class: `people-item${p.id === this.who ? ' active' : ''}${p.dead ? ' is-dead' : ''}${p.holder ? ' is-holder' : ''}`, 'aria-pressed': p.id === this.who ? 'true' : 'false', 'data-id': p.id },
        face,
        h('span', { class: 'people-item-text' }, h('span', { class: 'people-item-name', text: p.age != null && !p.dead ? `${p.name}, ${p.age}` : p.name }), h('span', { class: 'people-item-sub', text: p.sub || '' })),
      );
      b.addEventListener('click', () => this.select(p.id));
      this.listEl.append(b);
    }
    // Keep the chosen one in view on a phone's strip.
    requestAnimationFrame(() => {
      const a = this.listEl.querySelector('.people-item.active');
      try {
        a?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      } catch {
        /* old browsers */
      }
    });
  }

  // The page's head: face, name, where they stand, and what you can do.
  head({ id, name, sub, tone, portraitKey, dead, expr = 'neutral' }, actions = []) {
    const img = h('img', { class: 'portrait portrait-lg', alt: name, draggable: 'false' });
    const url = portraitKey ? portraitUrl(this.game, portraitKey, dead ? 'sad' : expr) : '';
    if (url) img.src = url;
    const face = portraitKey ? h('span', { class: `portrait-frame large${dead ? ' is-gone' : ''}` }, img) : h('span', { class: 'portrait-frame large people-you-big' }, icon('heart'));
    const row = h('div', { class: 'people-actions' }, ...actions.filter(Boolean));
    return h('div', { class: 'people-head', 'data-id': id }, face, h('div', { class: 'people-head-text' }, h('div', { class: 'hero-name', text: name }), sub ? h('span', { class: 'cs-chip', 'data-tone': tone || 'calm', text: sub }) : null, row));
  }

  talkButton(id, name) {
    return button('Talk', { icon: 'talk', cls: 'btn-small people-talk', title: `Talk to ${name}`, onClick: () => {
      const ui = this.ui;
      this.close();
      if (typeof ui.talkTo === 'function') ui.talkTo(id);
      else {
        ui.chat?.open?.(false);
        ui.chat?.selectTarget?.(id, { focus: true });
      }
    } });
  }

  inviteButton(e, label) {
    return button(label, { icon: 'heart', cls: 'btn-small btn-ember people-invite', onClick: () => {
      const r = safe(() => this.game.party?.invite?.(e, { by: 'player' }), null);
      const g = this.game;
      if (r?.narration && r.line) this.ui.toast(r.line, 'info');
      else if (r?.line) safe(() => this.ui.personSays?.(e, r.line));
      if (!r?.ok && r?.decision === 'refuse' && !r?.line) g.audio?.play?.('error');
      this.render();
    } });
  }

  homeButton(e) {
    return button('Go home, thank you', { cls: 'btn-small btn-ghost people-dismiss', onClick: () => {
      safe(() => this.game.party?.release?.('dismissed', { by: 'player' }));
      this.render();
    } });
  }

  // The Ask row: orders for whoever walks with you (they decide), Jobs while it is Lyra.
  askRow(isLyra, name) {
    const ui = this.ui;
    const row = h('div', { class: 'ask-row people-ask', role: 'group', 'aria-label': `Ask ${name}` });
    for (const c of COMMANDS) {
      row.append(button(c.label, { icon: c.icon, cls: `btn-small ask-btn ask-${c.id}`, title: c.hint, onClick: () => {
        ui.runCommand(c.id);
        this.markDirty();
      } }));
    }
    const out = [h('div', { class: 'ask-head' }, h('span', { class: 'ask-title', text: `Ask ${name}` }), h('span', { class: 'ask-sub', text: isLyra ? 'She decides for herself' : 'They decide for themselves' })), row];
    if (isLyra) {
      const jobs = button('Jobs', { icon: 'axe', cls: 'btn-small ask-btn ask-job-toggle', onClick: () => {
        this.jobsOpen = !this.jobsOpen;
        this.render();
      } });
      toggleClass(jobs, 'active', this.jobsOpen);
      row.append(jobs);
      if (this.jobsOpen) {
        const deliver = this.deliverTo || 'player';
        const seg = h('div', { class: 'segmented ask-deliver', role: 'radiogroup', 'aria-label': 'Deliver to' });
        for (const d of DELIVER_OPTIONS) {
          const b = h('button', { type: 'button', class: 'seg', role: 'radio', 'aria-checked': d.id === deliver ? 'true' : 'false', text: d.label });
          b.addEventListener('click', () => {
            this.deliverTo = d.id;
            this.render();
          });
          seg.append(b);
        }
        const jl = h('div', { class: 'ask-jobs-list' });
        for (const j of JOBS) {
          const b = h('button', { type: 'button', class: 'btn job ask-job' }, icon(j.icon), h('span', { class: 'job-text' }, h('span', { class: 'job-name', text: j.label }), h('span', { class: 'job-note', text: j.note })));
          b.addEventListener('click', () => {
            ui.runJob(j, this.deliverTo || 'player');
            this.jobsOpen = false;
            this.render();
          });
          jl.append(b);
        }
        out.push(h('div', { class: 'ask-jobs' }, h('div', { class: 'ask-jobs-head' }, h('span', { text: 'Deliver:' }), seg), jl));
      }
    }
    return h('div', { class: 'mind-ask people-ask-wrap' }, ...out);
  }

  // ---------- You ----------

  renderYou() {
    const v = youPage(this.game);
    const el = this.pageEl;
    el.append(this.head({ id: 'you', name: v.name, sub: v.feeling?.label ? `Hearthvale: ${v.feeling.label}` : '', tone: 'calm', portraitKey: null }));
    if (v.wanted) el.append(para('The watch is looking for you.', 'people-warn'));
    el.append(box('How Hearthvale sees you', para(v.feeling?.sentence || 'Hearthvale is still making up its mind about you.'), v.titles.length ? para(`What they call you: ${v.titles.join(', ')}.`) : null));
    el.append(box('What people are saying', v.rumors.length ? list(v.rumors.map((r) => h('li', { class: `tone-${r.tone}`, text: r.text }))) : para('Nothing much, yet.', 'empty')));
    el.append(
      box(
        'Each of them',
        list(
          v.views.map((x) => {
            const li = h('li', { class: `people-view tone-${x.key}` }, h('span', { class: 'people-view-name', text: x.name }), h('span', { class: 'people-view-label', text: x.label }));
            return li;
          }),
          'people-views',
        ),
      ),
    );
  }

  // ---------- Lyra ----------

  renderLyra() {
    const g = this.game;
    const L = g.lyra || g.companion;
    const v = lyraPage(g, lyraContext(g, this.ui));
    const el = this.pageEl;
    const actions = [];
    if (!v.dead) {
      actions.push(this.talkButton('lyra', v.name));
      if (!v.holder && v.cs !== 'gone') actions.push(this.inviteButton(L, 'Ask her to travel with you again'));
      if (v.holder) actions.push(this.homeButton(L));
    }
    el.append(this.head({ id: 'lyra', name: v.name, sub: v.standing.label, tone: v.standing.tone, portraitKey: 'lyra', dead: v.dead, expr: v.cs === 'gone' || v.cs === 'left' ? 'sad' : 'neutral' }, actions));
    if (v.dead && v.memorial) {
      const m = v.memorial;
      el.append(
        box(
          'In memory',
          para(m.line),
          m.lastWords ? h('blockquote', { class: 'opinion', text: `“${m.lastWords}”` }) : null,
          m.lastPage ? h('article', { class: 'diary-page' }, h('h3', { class: 'diary-day', text: `Her last page, day ${m.lastPage.day}` }), ...m.lastPage.text.split(/\n{2,}/).map((p) => h('p', { text: p.trim() }))) : null,
          m.village.length ? list(m.village) : para('The village speaks of her quietly, when it speaks of her at all.', 'muted'),
        ),
      );
    }
    if (v.holder) el.append(this.askRow(true, v.name));
    // 1. You and her.
    const deeds = v.between.deeds.map((d) => h('li', { class: `deed tone-${d.tone}` }, h('span', { class: 'deed-label', text: d.label }), d.text ? h('span', { class: 'deed-text', text: ` “${d.text}”` }) : null, h('span', { class: 'deed-when', text: ` ${d.when}` })));
    el.append(
      box(
        'You and her',
        para(`${v.between.tally.good} things kept in your favour · ${v.between.tally.bad} held against you`, 'muted small'),
        deeds.length ? list(deeds, 'ledger') : para(`Nothing ${v.name} holds for or against you yet.`, 'empty'),
        v.between.promises.length ? list(v.between.promises.map((p) => h('li', { class: `promise state-${p.state}`, text: `${p.stateLabel}: ${p.text}` }))) : null,
      ),
    );
    // 2. How she sees you.
    if (!v.dead) el.append(box('How she sees you', v.rel ? para(v.rel.words) : para('She has not made up her mind about you yet.'), para(v.standing.blurb, 'muted'), v.rel ? para(`Trust ${Math.round(v.rel.trust)} · Fear ${Math.round(v.rel.fear)} · Affinity ${Math.round(v.rel.affinity)}`, 'num small') : null));
    // 3. Her life.
    el.append(
      box(
        'Her life',
        list(v.life.timeline.map((t) => h('li', { class: 'life-node' }, h('span', { class: 'life-age', text: t.ageLabel }), h('span', { class: 'life-title', text: ` ${t.title}` })))),
        v.life.goals.length ? para(`What she has told you she wants: ${v.life.goals.join('; ')}.`) : null,
        v.life.now ? para(v.life.now, 'muted') : null,
      ),
    );
    // What she shares, and what she keeps.
    const sh = v.shared;
    el.append(
      box(
        'What she has shared with you',
        sh.memories.length ? list(sh.memories.map((m) => m.text)) : para(v.confides ? 'Nothing yet. What she tells you or shows you in talk stays here.' : 'She does not confide in you now.', 'empty'),
        sh.secrets.length ? box('What she trusted you with', list(sh.secrets)) : null,
        para(`${sh.kept} ${sh.kept === 1 ? 'thing' : 'things'} she keeps to herself.`, 'people-kept muted small'),
      ),
    );
    if (sh.knowledge.length || sh.knowKept) el.append(box('What she knows (as she has told it)', list(sh.knowledge.slice(0, 12).map((k) => `${k.text}${k.source ? ` (${k.source})` : ''}`)), sh.knowKept ? para(`…and ${sh.knowKept} guesses and rumours she keeps to herself.`, 'muted small') : null));
    // Her diary: read pages whole; the others a closed date.
    const read = v.diary.read.map((p) => h('article', { class: 'diary-page' }, h('h3', { class: 'diary-day', text: `Day ${p.day}` }), ...p.text.split(/\n{2,}/).map((x) => h('p', { text: x.trim() }))));
    const closed = v.diary.closed.length ? para(`Closed pages: ${v.diary.closed.map((d) => `day ${d}`).join(', ')}.`, 'people-closed muted small') : null;
    el.append(box('Her diary', ...(read.length ? read : [para('You have not read a page of hers. She leaves one out in the morning only when she slept under your roof.', 'empty')]), closed));
    // Who she is, as she has shown it (read only: nobody's soul is yours to edit).
    if (v.who.length) el.append(box('Who she is', para(v.who.join(' · '))));
  }

  // ---------- a villager ----------

  renderVillager(npc) {
    const g = this.game;
    const v = villagerPage(g, npc);
    const el = this.pageEl;
    if (!v) {
      el.append(para('You do not know this person yet.', 'empty'));
      return;
    }
    const actions = [];
    if (!v.dead) {
      actions.push(this.talkButton(v.id, v.name));
      if (v.holder) actions.push(this.homeButton(npc));
      else actions.push(this.inviteButton(npc, 'Invite to travel'));
    }
    el.append(this.head({ id: v.id, name: v.age != null ? `${v.fullName}, ${v.age}` : v.fullName, sub: v.standing.label, tone: { fond: 'good', friendly: 'good', neutral: 'calm', wary: 'warn', hostile: 'bad' }[v.standing.key], portraitKey: npc.spriteKey || npc.id, dead: v.dead }, actions));
    if (v.dead) el.append(box('In memory', para(`${v.name} is dead.`)));
    if (v.holder) el.append(this.askRow(false, v.name));
    const b = v.between;
    el.append(
      box(
        `You and ${v.name}`,
        b.facts.length ? list(b.facts) : para(`${v.name} has not told you much yet.`, 'empty'),
        b.talks ? para(`You have spoken ${b.talks} ${b.talks === 1 ? 'time' : 'times'}.`, 'muted small') : null,
        b.grievance ? para(`${b.fresh ? 'Still sore: ' : 'Not forgotten: '}${b.grievance}.`, 'people-warn') : null,
        b.gift ? para(b.gift, 'muted small') : null,
      ),
    );
    el.append(box(`How ${v.name} sees you`, para(`${v.standing.label} (${Math.round(v.standing.opinion)} of 100).`), v.standing.cold ? para('Cold with you today.', 'people-warn') : null));
    el.append(box(`${v.name}'s life`, para([v.life.role ? cap(v.life.role) : '', v.life.age != null ? `${v.life.age} years old` : ''].filter(Boolean).join(', ')), v.life.doing ? para(`Now: ${v.life.doing}.`, 'muted') : null));
  }
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
