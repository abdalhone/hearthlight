// The Spellbook (DESIGN.md §22.4): where weaves are made. Pick a slot; choose a shape,
// up to N essences and up to M twists from what has been found (the rest show as dark
// silhouettes that say where they are found); see the compiled plan — its name, what it
// does, its cost, cooldown, damage and reach — and a live preview of the stranger
// casting it at a training dummy. Every valid change is saved to the slot at once;
// rename, clear, or copy it to another slot. Opens with B, the book button or the pause
// menu; finger-sized and readable on a phone either way up.

import { h, button, setText, toggleClass, clear } from './dom.js';
import { makePanel } from './modal.js';
import { Weaving } from './weaving.js';
import { WeavePreview } from './spellbook_preview.js';
import { shapeIconUrl, essenceIconUrl, twistIconUrl, silhouetteUrl, glyphSize, spellbookIconUrl } from './weave_icons.js';
import { BOSS_HINTS, GENERIC_HINT, cleanWeave, weavePalette, singular, fallbackName, previewOf, castModeOf } from './weave_meta.js';

const SEEN_KEY = 'hearthlight.spellbook.seen';

const INPUT_LABEL = { quick: 'Tap', hold: 'Hold', charge: 'Charge' };
const INPUT_NOTE = { quick: 'Tap to cast', hold: 'Hold to keep it flowing', charge: 'Hold to charge, let go to cast' };

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
    for (const kind of ['shapes', 'essences', 'twists']) {
      for (const id of w.ids(kind)) {
        const key = `${kind}:${id}`;
        if (w.isUnlocked(kind, id) && !this.seen.has(key)) {
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
    const panel = makePanel({ id: 'spellbook', title: 'Spellbook', subtitle: 'Shape, essences and twists: weave them into something of your own', cls: 'panel-wide panel-spellbook' });
    const ic = h('img', { class: 'px-icon panel-icon', alt: '', 'aria-hidden': 'true', src: spellbookIconUrl() });
    ic.style.setProperty('--iw', '9');
    ic.style.setProperty('--ih', '9');
    panel.head.prepend(ic);
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
    this.draft = d;
  }

  // ---------- markup ----------

  build() {
    const p = this.panel;
    this.tabs = h('div', { class: 'sb-tabs', role: 'tablist', 'aria-label': 'Weave slots' });
    this.canvas = h('canvas', { class: 'sb-canvas', 'aria-label': 'A live preview: the weave cast at a training dummy' });
    this.preview = new WeavePreview(this.canvas, this.game);
    this.nameEl = h('h3', { class: 'sb-name' });
    this.renameBtn = button('', { cls: 'btn-icon btn-small sb-rename', title: 'Rename this weave', onClick: () => this.startRename() });
    this.renameBtn.append(h('span', { class: 'sb-pen', 'aria-hidden': 'true', text: '✎' }));
    this.nameRow = h('div', { class: 'sb-name-row' }, this.nameEl, this.renameBtn);
    this.descEl = h('p', { class: 'sb-desc' });
    this.statsEl = h('div', { class: 'sb-stats' });
    this.noteEl = h('p', { class: 'sb-note', role: 'status', 'aria-live': 'polite' });
    this.clearBtn = button('Clear slot', { cls: 'btn-ghost btn-small sb-clear', onClick: () => this.clearSlot() });
    this.copyWrap = h('div', { class: 'sb-copy' });
    const actions = h('div', { class: 'sb-actions' }, this.clearBtn, this.copyWrap);
    const card = h('div', { class: 'sb-card' }, this.nameRow, this.descEl, this.statsEl, this.noteEl, actions);
    this.previewCol = h('section', { class: 'sb-col sb-preview-col' }, h('div', { class: 'sb-stage' }, this.canvas), card);

    this.sections = {};
    const sec = (kind, title) => {
      const count = h('span', { class: 'sb-count num' });
      const grid = h('div', { class: 'sb-grid', role: 'group', 'aria-label': title });
      const hint = h('p', { class: 'sb-hint', hidden: true });
      const el = h('section', { class: `sb-sec sb-sec-${kind}` }, h('h4', { class: 'sb-sec-title' }, h('span', { text: title }), count), grid, hint);
      this.sections[kind] = { el, grid, count, hint };
      return el;
    };
    this.buildCol = h('section', { class: 'sb-col sb-build-col' }, sec('shapes', 'Shape'), sec('essences', 'Essences'), sec('twists', 'Twists'));
    p.body.append(this.tabs, h('div', { class: 'sb-main' }, this.previewCol, this.buildCol));

    const done = button('Done', { cls: 'btn-ember', onClick: () => this.close() });
    p.foot.append(h('span', { class: 'sb-foot-note', text: 'Changes are saved as you make them.' }), h('span', { class: 'sb-spacer' }), done);
  }

  render() {
    if (!this.panel) return;
    const w = this.weaving;
    const d = this.draft;
    const n = w.slotCount();
    // Slot tabs
    clear(this.tabs);
    for (let i = 0; i < 6; i++) {
      const locked = i >= n;
      const rec = locked ? null : w.slotInfo(i);
      const t = h('button', { type: 'button', class: 'sb-tab', role: 'tab', 'aria-selected': i === this.slot ? 'true' : 'false', disabled: locked, title: locked ? 'Not yet: a sixth sense for weaving comes later' : rec.weave ? rec.name : `Weave ${i + 1}: empty` });
      if (locked) t.append(h('span', { class: 'sb-lock', 'aria-hidden': 'true' }));
      else if (rec.weave) t.append(glyph(shapeIconUrl(rec.weave.shape, rec.palette), 'shapes', rec.weave.shape, 'sb-tab-glyph'));
      else t.append(h('span', { class: 'sb-tab-plus', text: '+' }));
      t.append(h('span', { class: 'sb-tab-num num', text: String(i + 1) }));
      if (!locked) t.addEventListener('click', () => this.pickSlot(i));
      toggleClass(t, 'empty', !locked && !rec.weave);
      this.tabs.append(t);
    }
    this.panel.setTitle('Spellbook', `Weave ${this.slot + 1}${n ? ` of ${n}` : ''} · ${w.slotInfo(this.slot).weave ? 'saved in this slot' : 'empty'}`);

    // The plan
    const plan = d.shape ? w.compile(d) : null;
    const ok = Weaving.planOk(plan);
    const pal = d.shape ? weavePalette(d, ok ? plan : null, (k, id) => w.entry(k, id)) : null;
    const name = d.shape ? d.name || (ok && plan.name) || fallbackName(d) : 'An empty slot';
    setText(this.nameEl, name);
    this.renameBtn.hidden = !d.shape;
    let desc = '';
    if (!d.shape) desc = 'Pick a shape to start a weave. Then add essences for what it is made of and twists for how it behaves.';
    else if (ok) desc = plan.description || plan.desc || `${w.info('shapes', d.shape).desc}`;
    else desc = plan?.reason || "That can't be woven.";
    setText(this.descEl, desc);
    toggleClass(this.descEl, 'bad', !!d.shape && !ok);
    this.renderStats(ok ? plan : null, d);
    setText(this.noteEl, this.note);
    this.noteEl.dataset.kind = this.noteKind || '';
    this.preview?.set(d.shape && ok ? d : null, ok ? plan : null, pal);

    // The building blocks
    this.renderSection('shapes', d, pal);
    this.renderSection('essences', d, pal);
    this.renderSection('twists', d, pal);

    // Footer: clear, copy to another slot
    this.clearBtn.disabled = !w.weaveAt(this.slot);
    clear(this.copyWrap);
    if (d.shape && ok && n > 1) {
      this.copyWrap.append(h('span', { class: 'sb-copy-label', text: 'Copy to' }));
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
    if (!d.shape) return;
    const mode = castModeOf(plan, d);
    const pv = previewOf(plan, d);
    const stats = [
      ['Mana', plan ? fmt(plan.cost) + (plan.drain ? '/s' : '') : '—', 'mana'],
      ['Cooldown', plan ? `${fmt(plan.cooldown, 1)}s` : '—', 'cd'],
      ['Damage', plan ? fmt(plan.dmg) + (Number(plan.count) > 1 ? ` ×${fmt(plan.count)}` : '') : '—', 'dmg'],
      ['Reach', plan ? tiles(pv.type === 'ring' ? pv.radius : pv.range) : '—', 'reach', plan ? (pv.type === 'ring' ? 'Tiles around you' : 'Tiles it reaches') : ''],
    ];
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
    for (const id of w.ids(kind)) {
      if (kind === 'essences' && id === 'raw') continue;
      const unlocked = w.isUnlocked(kind, id);
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
    const hint = this.hint && this.hint.kind === kind ? this.hint : null;
    s.hint.hidden = !hint;
    if (hint) {
      clear(s.hint);
      s.hint.append(h('b', { text: `${w.info(kind, hint.id).name}: ` }), document.createTextNode(hint.text));
    }
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
    const d = { ...this.draft, essences: [...this.draft.essences], twists: [...this.draft.twists] };
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
