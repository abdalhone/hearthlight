// The Spellbook (DESIGN.md §22.4): where weaves are made. Pick one of your weaves (or
// an empty slot: "New"); then the steps — 1 a shape, 2 essences (what it is made of),
// 3 twists (how it behaves), 4 a price (optional) — from what has been found. What is
// still to find folds into one "N more to find" tile that opens to dark silhouettes,
// each saying where it is found. See the compiled plan — its name, what it does, its
// cost, cooldown, damage and reach — and a live preview of the stranger casting it at a
// training dummy. Every valid change is saved to the slot at once (the footer says
// so); rename, clear, or copy it to another slot. Opens from the menu, an empty weave
// button or B; finger-sized and readable on a phone either way up, one scroll.

import { h, button, setText, toggleClass, clear } from './dom.js';
import { makePanel } from './modal.js';
import { Weaving } from './weaving.js';
import { makePreview } from './weave_sandbox.js';
import { shapeIconUrl, essenceIconUrl, twistIconUrl, silhouetteUrl, glyphSize, spellbookIconUrl } from './weave_icons.js';
import { BOSS_HINTS, GENERIC_HINT, cleanWeave, weavePalette, singular, fallbackName, previewOf, castModeOf } from './weave_meta.js';
import { ensureStatsStyle, PRICE_GLYPH, PRICE_HINTS } from './stats_style.js';

const SEEN_KEY = 'hearthlight.spellbook.seen';

// How it is cast (DESIGN §22.4): every weave but a beam charges while held.
const INPUT_LABEL = { quick: 'Tap or hold', hold: 'Hold', charge: 'Fast charge' };

// The steps, in order: what each part of a weave is, in a few words.
export const SB_STEPS = {
  shapes: { n: 1, title: 'Shape', help: 'How it flies or lands. Pick one.' },
  essences: { n: 2, title: 'Essences', help: 'What it is made of: fire, frost…' },
  twists: { n: 3, title: 'Twists', help: 'How it behaves: faster, bouncing…' },
  prices: { n: 4, title: 'Price', help: 'Optional: more power, at a cost.' },
};
const SINGULAR = { shapes: 'shape', essences: 'essence', twists: 'twist', prices: 'price' };
const INPUT_NOTE = {
  quick: 'Tap to cast. Hold to charge it, then let go: up to 2.5× as strong and a little bigger, for up to 2.5× the mana.',
  hold: 'Hold to keep it flowing: it drains mana while it pours (a beam does not charge).',
  charge: 'Hold to charge, let go to cast: the charge twist fills twice as fast and hits up to 3× as hard, for up to 3× the mana.',
};
// Casting stops you (plan §14): the book says it once, under the weave's numbers.
export const STAND_NOTE = 'You stand still to weave. Roll to break off.';

function readSeen() {
  try {
    const v = JSON.parse(window.localStorage?.getItem(SEEN_KEY) || '[]');
    return new Set(Array.isArray(v) ? v : []);
  } catch {
    return new Set();
  }
}

function saveSeen(set) {
  try {
    window.localStorage?.setItem(SEEN_KEY, JSON.stringify([...set].slice(-200)));
  } catch {
    /* private mode */
  }
}

function glyph(src, kind, id, cls = 'sb-glyph') {
  const img = h('img', { class: cls, alt: '', draggable: 'false', 'aria-hidden': 'true', src });
  const { w, h: gh } = glyphSize(kind, id);
  img.style.setProperty('--gw', String(w));
  img.style.setProperty('--gh', String(gh));
  return img;
}

// World pixels as tiles (16 px), the unit a player can see on the ground.
function tiles(px) {
  const v = Number(px);
  if (!Number.isFinite(v) || v <= 0) return '—';
  const t = v / 16;
  return t < 3 ? String(Math.round(t * 2) / 2) : String(Math.round(t));
}

function fmt(n, digits = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const p = 10 ** digits;
  return String(Math.round(v * p) / p);
}

export class Spellbook {
  constructor(ui, weaving) {
    this.ui = ui;
    this.game = ui.game;
    this.weaving = weaving;
    this.panel = null;
    this.slot = 0;
    this.draft = null;
    this.note = '';
    this.noteKind = '';
    this.hint = null; // { kind, id, text } for a tapped locked tile
    this.preview = null;
    this.seen = typeof window !== 'undefined' ? readSeen() : new Set();
    this.fresh = new Set(); // unlocked since last time: a "new" mark this visit
    this.savedT = 0;
    this.showLocked = {}; // kind -> the "more to find" tiles are open
  }

  isOpen() {
    return !!this.panel && this.ui.stack.includes(this.panel);
  }

  open(slot = 0) {
    const w = this.weaving;
    if (!w.available()) return;
    const n = w.slotCount();
    this.slot = Math.max(0, Math.min(n - 1, slot | 0));
    this.loadDraft();
    this.note = '';
    this.hint = null;
    // What has been found since the book was last opened gets a "new" mark (nothing is
    // "new" the very first time: it is all new then).
    this.fresh.clear();
    const first = this.seen.size === 0;
    // (Only what is really earned: "Try all magic" lends everything and marks nothing seen.)
    for (const kind of ['shapes', 'essences', 'twists', 'prices']) {
      for (const id of kind === 'prices' ? this.priceIds() : w.ids(kind)) {
        const key = `${kind}:${id}`;
        if (this.earned(kind, id) && !this.seen.has(key)) {
          if (!first) this.fresh.add(key);
          this.seen.add(key);
        }
      }
    }
    saveSeen(this.seen);
    if (this.isOpen()) {
      this.render();
      return;
    }
    ensureStatsStyle();
    const panel = makePanel({ id: 'spellbook', title: 'Spellbook', subtitle: 'Make a weave: a shape, essences and twists', cls: 'panel-wide panel-spellbook' });
    const ic = h('img', { class: 'px-icon panel-icon', alt: '', 'aria-hidden': 'true', src: spellbookIconUrl() });
    ic.style.setProperty('--iw', '9');
    ic.style.setProperty('--ih', '9');
    panel.head.prepend(ic);
    // While "Try all magic" (Settings) runs, the book says so.
    this.trialTag = h('span', { class: 'sb-trial-tag', text: 'Trying all magic', title: 'Settings → Game → Try all magic. Turn it off to go back to what you have earned.', hidden: true });
    panel.head.querySelector('.panel-heading')?.append(this.trialTag);
    panel.pauses = true;
    panel.onClose = () => {
      this.preview?.stop();
      this.preview = null;
      this.panel = null;
    };
    this.panel = panel;
    this.build();
    this.ui.openModal(panel);
    this.render();
    this.preview?.start();
  }

  close() {
    if (this.isOpen()) this.ui.closeModal(this.panel);
  }

  loadDraft() {
    const w = this.weaving.weaveAt(this.slot);
    const d = cleanWeave(w || { shape: null, essences: [], twists: [] }, 9, 9);
    // Raw is what a weave is when it has no essence: not something to pick.
    d.essences = d.essences.filter((e) => e !== 'raw');
    // A price (DESIGN §25) rides along with the weave.
    d.prices = (Array.isArray(w?.prices) ? w.prices : []).filter((x) => typeof x === 'string').slice(0, this.priceLimit());
    this.draft = d;
  }

  // ---------- prices (DESIGN §25): read straight from the runtime ----------

  priceIds() {
    const R = this.game.magic?.registry?.prices;
    return R && typeof R.ids === 'function' ? R.ids() : [];
  }

  priceDef(id) {
    return this.game.magic?.registry?.prices?.get?.(id) || null;
  }

  priceUnlocked(id) {
    return !!this.game.magic?.unlocked?.prices?.has?.(id);
  }

  // Really earned (not lent by "Try all magic").
  earned(kind, id) {
    const m = this.game.magic;
    if (typeof m?.isEarned === 'function') return m.isEarned(kind, id);
    return kind === 'prices' ? this.priceUnlocked(id) : this.weaving.isUnlocked(kind, id);
  }

  trialOn() {
    return !!this.game.magic?.trial;
  }

  priceLimit() {
    const n = this.game.magic?.priceSlots;
    return Number.isFinite(n) ? n : 1;
  }

  // ---------- markup ----------

  build() {
    const p = this.panel;
    this.tabs = h('div', { class: 'sb-tabs', role: 'tablist', 'aria-label': 'Your weaves' });
    this.tabsHead = h('div', { class: 'sb-tabs-head' }, h('span', { class: 'sb-tabs-title', text: 'Your weaves' }), h('span', { class: 'sb-tabs-help', text: 'Tap one to change it' }));
    this.canvas = h('canvas', { class: 'sb-canvas', 'aria-label': 'A live preview: the weave cast at a training dummy' });
    this.preview = makePreview(this.canvas, this.game);
    this.nameEl = h('h3', { class: 'sb-name' });
    this.renameBtn = button('', { cls: 'btn-icon btn-small sb-rename', title: 'Rename this weave', onClick: () => this.startRename() });
    this.renameBtn.append(h('span', { class: 'sb-pen', 'aria-hidden': 'true', text: '✎' }));
    this.nameRow = h('div', { class: 'sb-name-row' }, this.nameEl, this.renameBtn);
    this.descEl = h('p', { class: 'sb-desc' });
    this.statsEl = h('div', { class: 'sb-stats' });
    this.standEl = h('p', { class: 'sb-desc sb-stand', hidden: true, text: STAND_NOTE });
    this.noteEl = h('p', { class: 'sb-note', role: 'status', 'aria-live': 'polite' });
    // What to do next, for an empty slot or a half-made weave.
    this.nextEl = h('p', { class: 'sb-next-line', hidden: true });
    this.clearBtn = button('Clear slot', { cls: 'btn-ghost btn-small sb-clear', onClick: () => this.clearSlot() });
    this.copyWrap = h('div', { class: 'sb-copy' });
    const actions = h('div', { class: 'sb-actions' }, this.clearBtn, this.copyWrap);
    const card = h('div', { class: 'sb-card' }, this.nameRow, this.descEl, this.nextEl, this.statsEl, this.standEl, this.noteEl, actions);
    this.previewCol = h('section', { class: 'sb-col sb-preview-col' }, h('div', { class: 'sb-stage' }, this.canvas), card);

    this.sections = {};
    const sec = (kind) => {
      const step = SB_STEPS[kind];
      const count = h('span', { class: 'sb-count num' });
      const grid = h('div', { class: 'sb-grid', role: 'group', 'aria-label': step.title });
      const hint = h('p', { class: 'sb-hint', hidden: true });
      const head = h(
        'h4',
        { class: 'sb-sec-title' },
        h('span', { class: 'sb-step num', 'aria-hidden': 'true', text: String(step.n) }),
        h('span', { class: 'sb-sec-name', text: step.title }),
        h('span', { class: 'sb-sec-help', text: step.help }),
        count,
      );
      const el = h('section', { class: `sb-sec sb-sec-${kind}`, 'data-step': String(step.n) }, head, grid, hint);
      this.sections[kind] = { el, grid, count, hint };
      return el;
    };
    this.buildCol = h('section', { class: 'sb-col sb-build-col' }, sec('shapes'), sec('essences'), sec('twists'), sec('prices'));
    this.priceLineEl = h('p', { class: 'sb-price-line', hidden: true });
    this.descEl.after(this.priceLineEl);
    // Weaves made while trying all magic that left their slot when it ended.
    this.draftsEl = h('div', { class: 'sb-drafts', hidden: true });
    p.body.append(h('div', { class: 'sb-slots' }, this.tabsHead, this.tabs, this.draftsEl), h('div', { class: 'sb-main' }, this.previewCol, this.buildCol));

    const done = button('Done', { cls: 'btn-ember sb-done', onClick: () => this.close() });
    this.footNote = h('span', { class: 'sb-foot-note', role: 'status' });
    p.foot.append(this.footNote, h('span', { class: 'sb-spacer' }), done);
  }

  render() {
    if (!this.panel) return;
    const w = this.weaving;
    const d = this.draft;
    const n = w.slotCount();
    // Slot tabs
    clear(this.tabs);
    for (let i = 0; i < n; i++) {
      const rec = w.slotInfo(i);
      const t = h('button', { type: 'button', class: 'sb-tab', role: 'tab', 'aria-selected': i === this.slot ? 'true' : 'false', title: rec.weave ? rec.name : `Weave ${i + 1}: empty — tap to make a weave here`, 'data-slot': String(i) });
      if (rec.weave) t.append(glyph(shapeIconUrl(rec.weave.shape, rec.palette), 'shapes', rec.weave.shape, 'sb-tab-glyph'));
      else t.append(h('span', { class: 'sb-tab-plus', text: '+' }));
      t.append(h('span', { class: 'sb-tab-num num', text: String(i + 1) }), h('span', { class: 'sb-tab-name', text: rec.weave ? rec.name : 'New' }));
      t.addEventListener('click', () => this.pickSlot(i));
      toggleClass(t, 'empty', !rec.weave);
      this.tabs.append(t);
    }
    if (this.trialTag) this.trialTag.hidden = !this.trialOn();
    this.renderDrafts();
    const saved = !!w.slotInfo(this.slot).weave;
    this.panel.setTitle('Spellbook', `Weave ${this.slot + 1}${n ? ` of ${n}` : ''} · ${saved ? 'saved, on your weave buttons' : 'empty'}`);
    setText(this.footNote, saved ? `✓ Weave ${this.slot + 1} is saved: it is on your weave buttons.` : 'Every change is saved at once.');
    toggleClass(this.footNote, 'is-saved', saved);

    // The plan
    const plan = d.shape ? w.compile(d) : null;
    const ok = Weaving.planOk(plan);
    const pal = d.shape ? weavePalette(d, ok ? plan : null, (k, id) => w.entry(k, id)) : null;
    const name = d.shape ? d.name || (ok && plan.name) || fallbackName(d) : 'An empty slot';
    setText(this.nameEl, name);
    this.renameBtn.hidden = !d.shape;
    let desc = '';
    if (!d.shape) desc = 'This slot is empty. Make a weave in a few taps:';
    else if (ok) desc = plan.description || plan.desc || `${w.info('shapes', d.shape).desc}`;
    else desc = plan?.reason || "That can't be woven.";
    setText(this.descEl, desc);
    toggleClass(this.descEl, 'bad', !!d.shape && !ok);
    // The next step, spelled out; the step it points at glows.
    const next = !d.shape ? 'shapes' : ok && !d.essences.length && this.anyUnlocked('essences') ? 'essences' : null;
    let nextText = '';
    if (!d.shape) nextText = '① Pick a shape below. ② Add an essence. ③ Add a twist if you like. Each change is saved at once.';
    else if (next === 'essences') nextText = 'Next: ② add an essence (below) to give it an element, or keep it raw.';
    setText(this.nextEl, nextText);
    this.nextEl.hidden = !nextText;
    for (const k of Object.keys(this.sections)) toggleClass(this.sections[k].el, 'sb-next', k === next);
    toggleClass(this.panel.el, 'sb-empty-slot', !d.shape);
    this.renderStats(ok ? plan : null, d);
    setText(this.noteEl, this.note);
    this.noteEl.dataset.kind = this.noteKind || '';
    this.preview?.set(d.shape && ok ? d : null, ok ? plan : null, pal);

    // The building blocks
    this.renderSection('shapes', d, pal);
    this.renderSection('essences', d, pal);
    this.renderSection('twists', d, pal);
    this.renderPrices(d);
    this.renderPriceLine(ok ? plan : null);

    // Footer: clear, copy to another slot
    this.clearBtn.disabled = !w.weaveAt(this.slot);
    this.clearBtn.hidden = !w.weaveAt(this.slot);
    clear(this.copyWrap);
    if (d.shape && ok && n > 1) {
      this.copyWrap.append(h('span', { class: 'sb-copy-label', text: 'Copy to weave' }));
      for (let i = 0; i < n; i++) {
        if (i === this.slot) continue;
        const b = h('button', { type: 'button', class: 'btn btn-small sb-copy-btn num', text: String(i + 1), title: `Copy this weave into slot ${i + 1}` });
        b.addEventListener('click', () => this.copyTo(i));
        this.copyWrap.append(b);
      }
    }
  }

  renderStats(plan, d) {
    clear(this.statsEl);
    if (this.standEl) this.standEl.hidden = !d.shape;
    if (!d.shape) return;
    const mode = castModeOf(plan, d);
    const pv = previewOf(plan, d);
    // The true cost (round 15): what this stranger pays (gear and prices that change a weave's
    // cost included), and what a full charge pays.
    const mg = this.weaving?.magic;
    const P = this.weaving?.game?.player;
    const cost = plan ? (typeof mg?.costOf === 'function' && P ? mg.costOf(P, plan) : plan.cost) : 0;
    const full = plan && !plan.drain ? (typeof mg?.chargedCost === 'function' && P ? mg.chargedCost(P, plan, 1) : cost * 2) : 0;
    const stats = [
      ['Mana', plan ? fmt(cost) + (plan.drain ? '/s' : '') : '—', 'mana', plan ? (plan.drain ? 'Mana a second while it pours.' : `Mana for a tap; a full charge takes ${fmt(full)}.`) : ''],
      ['Cooldown', plan ? `${fmt(plan.cooldown, 1)}s` : '—', 'cd', 'Seconds before it can be cast again: the sweep and the seconds on its button.'],
      ['Damage', plan ? fmt(plan.dmg) + (Number(plan.count) > 1 ? ` ×${fmt(plan.count)}` : '') : '—', 'dmg'],
      ['Reach', plan ? tiles(pv.type === 'ring' ? pv.radius : pv.range) : '—', 'reach', plan ? (pv.type === 'ring' ? 'Tiles around you' : 'Tiles it reaches') : ''],
    ];
    const pd = plan?.priceDefs?.[0];
    if (pd) stats.push(['Price', pd.name, 'price', `${pd.gainText}; ${pd.costText}`]);
    for (const [label, value, cls, title] of stats) this.statsEl.append(h('div', { class: `sb-stat sb-stat-${cls}`, title: title || null }, h('span', { class: 'sb-stat-label', text: label }), h('span', { class: 'sb-stat-value num', text: value })));
    this.statsEl.append(h('div', { class: `sb-stat sb-input sb-input-${mode}`, title: INPUT_NOTE[mode] }, h('span', { class: 'sb-stat-label', text: 'Cast' }), h('span', { class: 'sb-stat-value', text: INPUT_LABEL[mode] })));
  }

  renderSection(kind, d, pal) {
    const w = this.weaving;
    const s = this.sections[kind];
    clear(s.grid);
    const limit = kind === 'shapes' ? 1 : w.limit(kind);
    const chosen = kind === 'shapes' ? (d.shape ? [d.shape] : []) : d[kind];
    if (kind === 'shapes') setText(s.count, '');
    else setText(s.count, `${chosen.length} / ${limit}`);
    let lockedN = 0;
    const open = !!this.showLocked[kind];
    for (const id of w.ids(kind)) {
      if (kind === 'essences' && id === 'raw') continue;
      const unlocked = w.isUnlocked(kind, id);
      if (!unlocked) {
        lockedN++;
        if (!open) continue;
      }
      const info = w.info(kind, id);
      const on = chosen.includes(id);
      let src;
      if (!unlocked) src = silhouetteUrl(kind, id);
      else if (kind === 'shapes') src = shapeIconUrl(id, pal || weavePalette({ essences: d.essences }, null, (k, x) => w.entry(k, x)));
      else if (kind === 'essences') src = essenceIconUrl(id, info.palette);
      else src = twistIconUrl(id);
      const order = on && kind !== 'shapes' && chosen.length > 1 ? chosen.indexOf(id) + 1 : 0;
      const t = h(
        'button',
        { type: 'button', class: 'sb-tile', 'aria-pressed': on ? 'true' : 'false', title: unlocked ? `${info.name}: ${info.desc}` : `${info.name} (not found yet)` },
        glyph(src, kind, id),
        h('span', { class: 'sb-tile-name', text: unlocked ? info.name : '???' }),
        order ? h('span', { class: 'sb-order num', text: String(order) }) : null,
        this.fresh.has(`${kind}:${id}`) ? h('span', { class: 'sb-new', text: 'new' }) : null,
      );
      toggleClass(t, 'locked', !unlocked);
      toggleClass(t, 'on', on);
      toggleClass(t, 'full', !on && unlocked && kind !== 'shapes' && chosen.length >= limit);
      if (kind === 'essences' && info.palette) t.style.setProperty('--tc', info.palette.glow);
      t.addEventListener('click', () => this.tap(kind, id, unlocked));
      s.grid.append(t);
    }
    if (lockedN) s.grid.append(this.moreTile(kind, lockedN, open));
    const hint = this.hint && this.hint.kind === kind ? this.hint : null;
    const none = !hint && !this.anyUnlocked(kind) && !open;
    s.hint.hidden = !hint && !none;
    clear(s.hint);
    if (hint) s.hint.append(h('b', { text: `${w.info(kind, hint.id).name}: ` }), document.createTextNode(hint.text));
    else if (none) s.hint.append(document.createTextNode(`None found yet. People in Hearthvale teach ${kind} to those who help them; tap the tile to see what is out there.`));
  }

  // "11 more to find": one tile for everything not found yet; a tap shows them (as dark
  // silhouettes, each saying where it is found) or folds them away again.
  moreTile(kind, n, open) {
    const t = h(
      'button',
      { type: 'button', class: 'sb-tile sb-more', 'aria-expanded': open ? 'true' : 'false', title: open ? 'Hide what is still to find' : `Show the ${n} ${n === 1 ? SINGULAR[kind] : kind} still to find` },
      h('span', { class: 'sb-more-n num', text: open ? '–' : String(n) }),
      h('span', { class: 'sb-tile-name', text: open ? 'Hide' : 'more to find' }),
    );
    t.addEventListener('click', () => {
      this.showLocked[kind] = !open;
      if (open && this.hint?.kind === kind) this.hint = null;
      this.render();
    });
    return t;
  }

  anyUnlocked(kind) {
    const w = this.weaving;
    return w.ids(kind).some((id) => id !== 'raw' && w.isUnlocked(kind, id));
  }

  // The prices row: a red glyph per price; the chosen one's cost in words below.
  renderPrices(d) {
    const s = this.sections.prices;
    if (!s) return;
    clear(s.grid);
    const ids = this.priceIds();
    const any = ids.some((id) => this.priceUnlocked(id));
    s.el.hidden = !ids.length;
    const chosen = d.prices || [];
    setText(s.count, `${chosen.length} / ${this.priceLimit()}`);
    let lockedN = 0;
    const open = !!this.showLocked.prices;
    for (const id of ids) {
      const def = this.priceDef(id);
      const unlocked = this.priceUnlocked(id);
      if (!unlocked) {
        lockedN++;
        if (!open) continue;
      }
      const on = chosen.includes(id);
      const glyphEl = h('span', { class: 'sb-price-glyph', 'aria-hidden': 'true', text: PRICE_GLYPH[id] || '◆' });
      glyphEl.style.setProperty('--pc', def?.color || '#ff5a5a');
      const t = h(
        'button',
        { type: 'button', class: 'sb-tile', 'aria-pressed': on ? 'true' : 'false', title: unlocked ? `${def.name}: ${def.gainText}. Price: ${def.costText}.` : `${def.name} (not found yet)` },
        glyphEl,
        h('span', { class: 'sb-tile-name', text: unlocked ? def.name : '???' }),
        this.fresh.has(`prices:${id}`) ? h('span', { class: 'sb-new', text: 'new' }) : null,
      );
      toggleClass(t, 'locked', !unlocked);
      toggleClass(t, 'on', on);
      t.addEventListener('click', () => this.tapPrice(id, unlocked));
      s.grid.append(t);
    }
    if (lockedN) s.grid.append(this.moreTile('prices', lockedN, open));
    const hint = this.hint && this.hint.kind === 'prices' ? this.hint : null;
    s.hint.hidden = !hint && any;
    clear(s.hint);
    if (hint) s.hint.append(h('b', { text: `${this.priceDef(hint.id)?.name || ''}: ` }), document.createTextNode(hint.text));
    else if (!any) s.hint.append(document.createTextNode('Power with a cost. Prices are earned from bosses and from people who trust you with them.'));
  }

  renderPriceLine(plan) {
    const el = this.priceLineEl;
    if (!el) return;
    clear(el);
    const pd = plan?.priceDefs?.[0];
    el.hidden = !pd;
    if (!pd) return;
    el.append(h('span', { class: 'gain', text: `Every cast: ${pd.gainText}. ` }), h('span', { class: 'cost', text: `Price: ${pd.costText}.` }));
  }

  tapPrice(id, unlocked) {
    if (!unlocked) {
      this.hint = this.hint && this.hint.kind === 'prices' && this.hint.id === id ? null : { kind: 'prices', id, text: PRICE_HINTS[id] || GENERIC_HINT };
      this.render();
      return;
    }
    this.hint = null;
    const d = { ...this.draft, essences: [...this.draft.essences], twists: [...this.draft.twists], prices: [...(this.draft.prices || [])] };
    if (d.id === 'spark' && d.name === 'Spark') delete d.name;
    const i = d.prices.indexOf(id);
    if (i >= 0) d.prices.splice(i, 1);
    else if (d.prices.length >= this.priceLimit()) d.prices = [id];
    else d.prices.push(id);
    if (!d.shape) {
      this.say('Pick a shape first: a price rides on a weave.', 'warn');
      this.draft = d;
      this.render();
      return;
    }
    this.apply(d);
  }

  // Trial weaves: a tap loads one into this slot (it is saved there if it can be woven
  // with what you have — or while trying all magic again).
  renderDrafts() {
    const el = this.draftsEl;
    if (!el) return;
    const list = Array.isArray(this.game.magic?.trialDrafts) ? this.game.magic.trialDrafts : [];
    clear(el);
    el.hidden = !list.length;
    if (!list.length) return;
    el.append(h('span', { class: 'sb-drafts-label', text: 'From trying all magic:' }));
    list.forEach((d, i) => {
      const plan = this.weaving.compile(d);
      const ok = Weaving.planOk(plan);
      const name = d.name || (ok && plan.name) || fallbackName(d);
      const b = h('button', { type: 'button', class: `btn btn-small sb-draft${ok ? '' : ' locked'}`, title: ok ? `Weave ${name} into slot ${this.slot + 1}` : `${name}: ${plan?.reason || 'not woven yet'}` }, h('span', { text: name }));
      b.addEventListener('click', () => this.takeDraft(i));
      el.append(b);
    });
  }

  takeDraft(i) {
    const m = this.game.magic;
    const d = m?.trialDrafts?.[i];
    if (!d) return;
    const w = this.weaving;
    const draft = cleanWeave(d, 9, 9);
    draft.essences = draft.essences.filter((e) => e !== 'raw');
    draft.prices = (Array.isArray(d.prices) ? d.prices : []).slice(0, this.priceLimit());
    if (d.name) draft.name = d.name;
    this.draft = draft;
    const plan = w.compile(draft);
    if (!Weaving.planOk(plan)) {
      this.say(`Not saved: ${plan?.reason || "that can't be woven"} (it stays here for when you have it).`, 'warn');
      this.render();
      return;
    }
    const r = w.setSlot(this.slot, draft);
    if (r.ok) {
      m.dropDraft?.(i);
      this.say(`Saved to slot ${this.slot + 1}.`, 'good');
    } else this.say(`Not saved: ${r.reason}`, 'warn');
    this.render();
  }

  // ---------- actions ----------

  pickSlot(i) {
    if (i === this.slot) return;
    this.slot = i;
    this.weaving.select(i);
    this.loadDraft();
    this.note = '';
    this.hint = null;
    this.game.audio?.play?.('ui_click');
    this.render();
  }

  hintFor(kind, id) {
    const m = this.game.missions;
    let text = '';
    try {
      text = m?.hintFor?.(singular(kind), id) || m?.hintFor?.(kind, id) || '';
    } catch {
      text = '';
    }
    return text || BOSS_HINTS[`${kind}:${id}`] || GENERIC_HINT;
  }

  tap(kind, id, unlocked) {
    if (!unlocked) {
      this.hint = this.hint && this.hint.kind === kind && this.hint.id === id ? null : { kind, id, text: this.hintFor(kind, id) };
      this.render();
      return;
    }
    this.hint = null;
    const w = this.weaving;
    const d = { ...this.draft, essences: [...this.draft.essences], twists: [...this.draft.twists], prices: [...(this.draft.prices || [])] };
    // The first weave came with a name ("Spark"); once it changes, it names itself.
    if (d.id === 'spark' && d.name === 'Spark') delete d.name;
    if (kind === 'shapes') d.shape = id;
    else {
      const list = d[kind];
      const i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1);
      else {
        const limit = w.limit(kind);
        if (list.length >= limit) {
          this.say(kind === 'essences' ? `A weave holds ${limit} essence${limit === 1 ? '' : 's'} for now. Tap one to take it out first.` : `A weave holds ${limit} twist${limit === 1 ? '' : 's'} for now. Tap one to take it out first.`, 'warn');
          this.game.audio?.play?.('error', { volume: 0.5 });
          this.render();
          return;
        }
        list.push(id);
      }
    }
    this.apply(d);
  }

  // Compile; when it can be woven, save it into the slot straight away.
  apply(d) {
    const w = this.weaving;
    this.draft = d;
    if (!d.shape) {
      this.say('', '');
      this.render();
      return;
    }
    const plan = w.compile(d);
    if (!Weaving.planOk(plan)) {
      this.say(`Not saved: ${plan?.reason || "that can't be woven"}`, 'warn');
      this.render();
      return;
    }
    const r = w.setSlot(this.slot, d);
    if (!r.ok) this.say(`Not saved: ${r.reason}`, 'warn');
    else {
      this.say(`Saved to slot ${this.slot + 1}.`, 'good');
      this.game.audio?.play?.('ui_click', { volume: 0.7 });
      this.ui.coach?.event?.('saved');
    }
    this.render();
  }

  say(text, kind) {
    this.note = text;
    this.noteKind = kind;
  }

  clearSlot() {
    const r = this.weaving.setSlot(this.slot, null);
    this.loadDraft();
    this.say(r.ok ? `Slot ${this.slot + 1} is empty now.` : `Could not clear it: ${r.reason}`, r.ok ? '' : 'warn');
    this.render();
  }

  copyTo(i) {
    const r = this.weaving.setSlot(i, this.draft);
    this.say(r.ok ? `Copied into slot ${i + 1}.` : `Could not copy it: ${r.reason}`, r.ok ? 'good' : 'warn');
    this.render();
  }

  startRename() {
    if (!this.draft?.shape || this.renaming) return;
    this.renaming = true;
    const current = this.draft.name || '';
    const input = h('input', { type: 'text', class: 'field sb-name-input', maxlength: '32', value: current, placeholder: this.nameEl.textContent, 'aria-label': 'Name this weave' });
    const commit = (save) => {
      if (!this.renaming) return;
      this.renaming = false;
      const v = input.value.trim().slice(0, 32);
      input.replaceWith(this.nameEl);
      this.renameBtn.hidden = false;
      if (save) {
        const d = { ...this.draft };
        if (v) d.name = v;
        else delete d.name;
        this.apply(d);
      } else this.render();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commit(true);
      else if (e.key === 'Escape') commit(false);
    });
    input.addEventListener('blur', () => commit(true));
    this.nameEl.replaceWith(input);
    this.renameBtn.hidden = true;
    input.focus();
    input.select?.();
  }
}
