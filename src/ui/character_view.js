// The character sheet (DESIGN §26): level and experience, the three points each level
// gives (Vitality, Might, Weave, Focus, Grace, Resolve), what is worn (six slots, rarity
// colors, compare before you equip, take off), the numbers that come out of it all, and
// every gain, cost and weakness running now. Opens with C, a tap on the player's card,
// or the pause menu. One column on a phone held upright, two when there is room.

import { h, button, clear, setText, toggleClass } from './dom.js';
import { makePanel } from './modal.js';
import { itemIconUrl } from './art.js';
import { fmtInt, frac } from './format.js';
import { STATS, formatStat } from '../core/stats.js';
import { ATTRS, ATTR_IDS } from '../progression/attributes.js';
import { SLOTS, SLOT_LABEL, KIND_SLOTS, gearDef, rarityOf, RARITY } from '../gear/gear_data.js';
import { ensureStatsStyle, fmtSeconds } from './stats_style.js';

// The numbers the sheet shows, in reading order.
const SHOWN = ['maxHp', 'hpRegen', 'maxMana', 'manaRegen', 'atk', 'spellPower', 'def', 'speed', 'crit', 'critMul', 'dodge', 'resist', 'castSpeed', 'cooldown', 'bleedout', 'carrySpeed'];

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    console.warn('[character]', err);
    return fallback;
  }
}

function deltaText(c) {
  const s = STATS[c.stat];
  const d = c.delta;
  const sign = d > 0 ? '+' : '−';
  const a = Math.abs(d);
  let v;
  if (s.fmt === 'pct' || s.fmt === 'mul') v = `${Math.round(a * 100)}%`;
  else if (s.fmt === 'rate') v = `${Math.round(a * 10) / 10}/s`;
  else if (s.fmt === 'sec') v = `${Math.round(a)} s`;
  else v = String(Math.round(a * 10) / 10);
  return `${sign}${v} ${s.short || s.label}`;
}

export class CharacterView {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.panel = null;
    this.slot = null; // the gear slot being looked at
    this.t = 0;
  }

  isOpen() {
    return !!this.panel && this.ui.stack.includes(this.panel);
  }

  open(slot = null) {
    const g = this.game;
    if (!g.player || !g.progression) return;
    ensureStatsStyle();
    if (slot) this.slot = slot;
    if (this.isOpen()) {
      this.render();
      return;
    }
    const top = this.ui.top?.();
    if (top && top.id !== 'pause') this.ui.closeModal(top, true);
    const panel = makePanel({ id: 'character', title: 'Character', subtitle: '', iconName: 'heart', cls: 'panel-wide panel-character' });
    panel.pauses = true;
    panel.onClose = () => {
      this.panel = null;
    };
    this.panel = panel;
    this.build();
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

  build() {
    const p = this.panel;
    this.lvEl = h('b');
    this.nameEl = h('div', { class: 'chs-name' });
    this.xpFill = h('i');
    this.xpText = h('div', { class: 'chs-xp-text num' });
    this.pointsEl = h('div', { class: 'chs-points', hidden: true });
    const hero = h('div', { class: 'chs-hero' }, h('div', { class: 'chs-lv', 'aria-hidden': 'true' }, h('small', { text: 'LEVEL' }), this.lvEl), h('div', { class: 'chs-hero-main' }, this.nameEl, h('div', { class: 'chs-xp' }, this.xpFill), this.xpText, this.pointsEl));
    this.attrsEl = h('div', { class: 'chs-attrs' });
    this.attrRows = {};
    for (const id of ATTR_IDS) {
      const a = ATTRS[id];
      const n = h('span', { class: 'chs-attr-n num' });
      const plus = button('+', { cls: 'btn-ember chs-plus', title: `Spend a point on ${a.name}`, onClick: () => this.spend(id) });
      // Free stat points (Settings → Game → Practice): take one back, or raise ten at once.
      const minus = button('−', { cls: 'btn-ghost chs-plus chs-minus', title: `Take a point off ${a.name}`, onClick: () => this.lower(id) });
      const ten = button('+10', { cls: 'btn-ember chs-plus chs-ten', title: `Ten points on ${a.name}`, onClick: () => this.spend(id, 10) });
      minus.hidden = true;
      ten.hidden = true;
      const ctl = h('span', { class: 'chs-ctl' }, minus, plus, ten);
      // What one more point adds (round 14b), with a small meter of how much of the first
      // point's worth it still carries (a speed's far points little, the rest a good share).
      const meter = h('i');
      const nextText = h('span', { class: 'chs-next-text' });
      const next = h('div', { class: 'chs-attr-next' }, h('span', { class: 'chs-next-meter', 'aria-hidden': 'true' }, meter), nextText);
      const row = h('div', { class: 'chs-attr' }, h('span', { class: 'chs-attr-bar' }), h('div', { class: 'chs-attr-main' }, h('div', { class: 'chs-attr-name', text: a.name }), h('div', { class: 'chs-attr-line', text: a.line }), next), n, ctl);
      row.style.setProperty('--ac', a.color);
      this.attrRows[id] = { row, n, plus, minus, ten, next, nextText, meter };
      this.attrsEl.append(row);
    }
    // How the points add up (round 14b, attributes.js EFFECT_KIND), said plainly.
    this.curveEl = h('p', { class: 'chs-curve-note', text: 'Speed and cooldowns slow down as they climb; strength, magic, health and mana keep growing.' });
    this.respecEl = h('p', { class: 'chs-respec' });
    const left = h('section', { class: 'chs-box' }, hero, this.attrsEl, this.curveEl, this.respecEl);

    this.slotsEl = h('div', { class: 'chs-slots' });
    this.slotBtns = {};
    for (const s of SLOTS) {
      const img = h('img', { class: 'chs-slot-img', alt: '' });
      const name = h('span', { class: 'chs-slot-name' });
      const up = h('span', { class: 'chs-up num' });
      const b = h('button', { type: 'button', class: 'chs-slot' }, up, img, h('span', { class: 'chs-slot-label', text: SLOT_LABEL[s] }), name);
      b.addEventListener('click', () => {
        this.slot = this.slot === s ? null : s;
        this.game.audio?.play?.('ui_click');
        this.render();
        // What the slot offers shows under the slots: bring it into view on a phone.
        if (this.slot) requestAnimationFrame(() => {
          try {
            this.pickEl?.scrollIntoView?.({ block: 'nearest', behavior: this.ui?.reduceMotion ? 'auto' : 'smooth' });
          } catch {
            /* old browsers */
          }
        });
      });
      this.slotBtns[s] = { b, img, name, up };
      this.slotsEl.append(b);
    }
    this.pickEl = h('div', { class: 'chs-pick' });
    const right = h('section', { class: 'chs-box' }, h('h3', null, h('span', { text: 'Worn' }), h('span', { class: 'chs-h-note', text: 'Tap a slot to change it' })), this.slotsEl, this.pickEl);

    this.statsEl = h('div', { class: 'chs-stats' });
    this.effectsEl = h('div', { class: 'chs-effects' });
    this.effectsBox = h('section', { class: 'chs-box chs-wide' }, h('h3', { text: 'Running now' }), this.effectsEl);
    const stats = h('section', { class: 'chs-box chs-wide' }, h('h3', null, h('span', { text: 'What it adds up to' }), h('span', { class: 'chs-h-note', text: 'Level, points, gear and what runs now' })), this.statsEl);
    p.body.append(h('div', { class: 'chs' }, left, right, this.effectsBox, stats));
    p.foot.append(h('span', { class: 'sb-foot-note', text: 'Points and gear change you at once.' }), h('span', { class: 'sb-spacer' }), button('Done', { cls: 'btn-ember', onClick: () => this.close() }));
  }

  render() {
    if (!this.panel) return;
    const g = this.game;
    const P = g.player;
    const pr = g.progression;
    const S = g.stats;
    const lv = Math.max(1, P.level || 1);
    const need = safe(() => g.combat?.xpToNext?.(lv), 0) || 0;
    setText(this.lvEl, String(lv));
    setText(this.nameEl, g.settings?.playerName || P.name || 'Traveler');
    this.xpFill.style.width = `${Math.round(frac(P.xp || 0, need || 1) * 100)}%`;
    setText(this.xpText, need ? `${fmtInt(P.xp || 0)} / ${fmtInt(need)} xp to level ${lv + 1}` : `${fmtInt(P.xp || 0)} xp`);
    const un = pr.unspent();
    const free = !!pr.free;
    this.pointsEl.hidden = !free && un <= 0;
    toggleClass(this.pointsEl, 'free', free);
    setText(this.pointsEl, free ? 'Free points: raise anything' : `${un} point${un === 1 ? '' : 's'} to spend`);
    this.panel.setTitle('Character', free ? `Level ${lv} · free stat points` : un > 0 ? `Level ${lv} · ${un} point${un === 1 ? '' : 's'} to spend` : `Level ${lv} · each level gives three points`);
    toggleClass(this.attrsEl, 'free', free);
    for (const id of ATTR_IDS) {
      const r = this.attrRows[id];
      const v = pr.points[id] || 0;
      setText(r.n, String(v));
      r.plus.disabled = free ? !pr.canSpend(id) : un <= 0;
      if (r.minus.hidden === free) r.minus.hidden = !free;
      if (r.ten.hidden === free) r.ten.hidden = !free;
      r.minus.disabled = !free || v <= 0;
      r.ten.disabled = !free || !pr.canSpend(id);
      this.renderNext(id, r);
    }
    if (free) setText(this.respecEl, 'Free stat points is on: raise anything as far as you like (up to 999 a stat). Turning it off in Settings → Game → Practice puts back the points you really spent.');
    else setText(this.respecEl, pr.spent() ? `Want them back? Settings → Game → Reset stat points gives them all back, free. Or Sister Aveline can give you a quiet hour in the chapel to start over (${pr.respecCost()} coins).` : 'Spend points as you level. Settings (Reset stat points) can give them back for free; Sister Aveline at the chapel, for a price.');
    this.renderSlots();
    this.renderPick();
    this.renderStats();
    this.renderEffects();
  }

  // "Next: +1.1% speed": what one more point really does to the attribute's main number
  // (progression.nextGain: the pipeline with one point more); every effect in the
  // tooltip. Small gains look small (dimmed, a short meter of the curve's share).
  renderNext(id, r) {
    const pr = this.game.progression;
    const list = safe(() => pr.nextGain?.(id), []) || [];
    const m = list[0];
    r.next.hidden = !m;
    if (!m) return;
    const share = m.first ? Math.max(0, Math.min(1, Math.abs(m.d / m.first))) : 0;
    // Free stat points at the top (999): no next point to show.
    const top = pr.free && !safe(() => pr.canSpend(id), true);
    setText(r.nextText, top ? 'As high as it goes' : `Next: ${gainWords(m)}`);
    r.meter.style.width = `${Math.max(2, Math.round(share * 100))}%`;
    toggleClass(r.next, 'small', share < 0.34);
    r.next.title = `One more point: ${list.map(gainWords).join(', ')} (${Math.round(share * 100)}% of what the first point gave)`;
  }

  renderSlots() {
    const G = this.game.gear;
    for (const s of SLOTS) {
      const r = this.slotBtns[s];
      const id = G.equipped[s];
      const def = id ? gearDef(id) : null;
      const rar = def ? def.rarity : 'common';
      r.b.className = `chs-slot ${id ? `rar-bd-${rar}` : 'empty'} ${this.slot === s ? 'on' : ''}`.trim();
      r.img.src = itemIconUrl(this.game, id || EMPTY_ICON[s]);
      // Everyone starts with the old blade they woke with: plain, no bonus, not gear.
      setText(r.name, def ? def.name : s === 'weapon' ? 'Old sword' : '—');
      r.name.className = `chs-slot-name ${def ? `rar-${rar}` : ''}`.trim();
      const lv = id ? G.level(id) : 0;
      setText(r.up, lv ? `+${lv}` : '');
      r.b.title = def ? `${def.name} (${RARITY[rar].label})${lv ? `, upgraded +${lv}` : ''}` : `${SLOT_LABEL[s]}: nothing worn`;
    }
  }

  // What can go in the chosen slot: from the bag, with what it would change.
  renderPick() {
    clear(this.pickEl);
    const s = this.slot;
    if (!s) {
      this.pickEl.append(h('p', { class: 'chs-empty', text: 'Bram forges and upgrades blades and armor; Sabeth sews cloaks; Garrick sells boots and charms. Bosses leave special pieces.' }));
      return;
    }
    const g = this.game;
    const G = g.gear;
    const P = g.player;
    const worn = G.equipped[s];
    const head = h('div', { class: 'chs-pick-head' }, h('span', { text: worn ? `${SLOT_LABEL[s]}: ${gearDef(worn).name}` : `${SLOT_LABEL[s]}: nothing worn` }));
    if (worn) head.append(button('Take off', { cls: 'btn-small btn-ghost', onClick: () => this.unequip(s) }));
    this.pickEl.append(head);
    if (worn) {
      const d = gearDef(worn);
      this.pickEl.append(h('p', { class: 'chs-empty', text: d.desc }));
    }
    const kind = s.startsWith('charm') ? 'charm' : s;
    const cands = [];
    for (const it of P.inventory.list()) {
      const d = gearDef(it.id);
      if (!d || !(KIND_SLOTS[d.slot] || []).includes(s) || d.slot !== kind) continue;
      cands.push({ id: it.id, def: d, qty: it.qty });
    }
    cands.sort((a, b) => rarityOf(b.id).rank - rarityOf(a.id).rank || a.def.name.localeCompare(b.def.name));
    if (!cands.length) {
      this.pickEl.append(h('p', { class: 'chs-empty', text: `Nothing in your bag goes here. ${WHERE[kind] || ''}` }));
      return;
    }
    for (const c of cands) {
      const cmp = safe(() => G.compare(c.id, s), []) || [];
      const deltas = h('div', { class: 'chs-deltas' });
      for (const d of cmp.slice(0, 6)) deltas.append(h('span', { class: `chs-delta ${d.better ? '' : 'worse'}`.trim(), text: deltaText(d) }));
      if (!cmp.length) deltas.append(h('span', { class: 'chs-delta', text: 'no change' }));
      const lv = G.level(c.id);
      const row = h(
        'div',
        { class: `chs-cand rar-bd-${c.def.rarity}` },
        h('img', { alt: '', src: itemIconUrl(g, c.id) }),
        h('div', null, h('div', { class: `chs-cand-name rar-${c.def.rarity}`, text: `${c.def.name}${lv ? ` +${lv}` : ''}` }), h('div', { class: 'chs-attr-line', text: `${RARITY[c.def.rarity].label}${c.qty > 1 ? ` · ×${c.qty}` : ''}` }), deltas),
        button('Wear', { cls: 'btn-ember btn-small', onClick: () => this.equip(c.id, s) }),
      );
      this.pickEl.append(row);
    }
  }

  renderStats() {
    clear(this.statsEl);
    const g = this.game;
    const S = g.stats;
    const P = g.player;
    const v = S.all(P);
    for (const id of SHOWN) {
      const s = STATS[id];
      const cell = h('div', { class: 'chs-stat', title: why(S, P, id) }, h('span', { text: s.label }), h('b', { class: 'num', text: formatStat(id, v[id]) }));
      this.statsEl.append(cell);
    }
  }

  renderEffects() {
    clear(this.effectsEl);
    const g = this.game;
    const list = safe(() => g.prices?.timers?.(g.player), []) || [];
    this.effectsBox.hidden = !list.length;
    for (const m of list) {
      const left = Number.isFinite(m.left) ? fmtSeconds(m.left) : m.tap ? 'tap the HUD flame to douse' : 'held';
      const chip = h('span', { class: `chs-eff ${m.kind}` }, h('span', { text: m.label }), h('span', { class: 'num', text: left }));
      this.effectsEl.append(chip);
    }
  }

  // ---------------------------------------------------------------- actions

  spend(attr, n = 1) {
    const r = this.game.progression.spend(attr, n);
    if (!r.ok) {
      this.game.audio?.play?.('error', { volume: 0.5 });
      this.ui.toast(r.reason, 'info');
    } else this.game.audio?.play?.('ui_click', { pitch: 1.2 });
    this.render();
  }

  lower(attr) {
    const r = this.game.progression.lower?.(attr) || { ok: false, reason: 'Not in this build.' };
    if (!r.ok) {
      this.game.audio?.play?.('error', { volume: 0.5 });
      this.ui.toast(r.reason, 'info');
    } else this.game.audio?.play?.('ui_click', { pitch: 0.9 });
    this.render();
  }

  equip(id, slot) {
    const r = this.game.gear.equip(id, slot);
    if (!r.ok) this.ui.toast(r.reason, 'info');
    else this.game.audio?.play?.('equip') || this.game.audio?.play?.('pickup');
    this.render();
  }

  unequip(slot) {
    const r = this.game.gear.unequip(slot);
    if (!r.ok) this.ui.toast(r.reason, 'info');
    else this.game.audio?.play?.('ui_close');
    this.render();
  }

  // Live numbers while it is open (timers run down; buffs come and go).
  update(dt) {
    if (!this.isOpen()) return;
    this.t += dt;
    if (this.t < 0.5) return;
    this.t = 0;
    this.renderEffects();
  }
}

// Short words for what a point gives ("+2.7 health", "+0.4% speed", "−0.2% cooldowns").
const GAIN_WORD = { maxHp: 'health', hpRegen: 'regen', atk: 'sword', strike: 'strike weaves', spellPower: 'weave power', maxMana: 'mana', manaRegen: 'mana regen', cooldown: 'cooldowns', speed: 'speed', dodge: 'dodge', crit: 'crit', resist: 'status resist', bleedout: 'bleed-out', carrySpeed: 'carrying pace' };

// A small number as it reads: 2.7, 0.4, 0.04, or <0.01 when it is almost nothing.
function smallNum(a) {
  if (a >= 9.95) return String(Math.round(a));
  if (a >= 0.095) return String(Math.round(a * 10) / 10);
  if (a >= 0.0095) return String(Math.round(a * 100) / 100);
  return '<0.01';
}

// Health, mana and the sword are shown whole (or to a tenth): one point's share of them is
// the curve's own step, not the rounded difference.
const SHOWN_ROUNDED = new Set(['maxHp', 'maxMana', 'atk', 'def']);

// m: one entry of progression.nextGain. Where the pipeline's own answer is there (`real`),
// the words say that: what the sheet's number will do (the clamps, gear and
// hastes counted); speed, a share of a pace, as a share of the pace you walk at now.
export function gainWords(m) {
  const s = STATS[m.stat] || {};
  const word = GAIN_WORD[m.stat] || (s.label || m.stat).toLowerCase();
  if (m.limit) return `${word} at its limit`;
  const known = Number.isFinite(m.real);
  if (known && m.part === 'pct' && s.fmt !== 'pct' && s.fmt !== 'mul' && m.before > 0) {
    const share = m.real / m.before;
    return `${share < 0 ? '−' : '+'}${smallNum(Math.abs(share) * 100)}% ${word}`;
  }
  const d = known && !SHOWN_ROUNDED.has(m.stat) ? m.real : m.d;
  const sign = d < 0 || (d === 0 && m.d < 0) ? '−' : '+';
  const a = Math.abs(d);
  if (m.part === 'pct' || s.fmt === 'pct' || s.fmt === 'mul') return `${sign}${smallNum(a * 100)}% ${word}`;
  if (s.fmt === 'rate') return `${sign}${smallNum(a)}/s ${word}`;
  if (s.fmt === 'sec') return `${sign}${smallNum(a)} s ${word}`;
  return `${sign}${smallNum(a)} ${word}`;
}

// Where each kind of piece comes from (for an empty list).
const WHERE = {
  weapon: 'Bram sells and forges blades at the smithy.',
  armor: 'Bram sells and forges armor at the smithy.',
  cloak: 'Sabeth sews cloaks at the dye-vats.',
  boots: "Garrick sells boots at Gale's Goods.",
  charm: "Garrick sells charms at Gale's Goods.",
};

// A faint silhouette for an empty slot.
const EMPTY_ICON = { weapon: 'iron_sword', armor: 'leather_jerkin', cloak: 'traveler_cloak', boots: 'field_boots', charm1: 'hearth_charm', charm2: 'moonglass_bead' };

// A stat's sources in words, for its tooltip.
function why(S, P, id) {
  const parts = safe(() => S.breakdown(P, id), []) || [];
  const fmt = STATS[id];
  return parts
    .map((b) => {
      const bits = [];
      if (b.add) bits.push(`${b.add > 0 ? '+' : ''}${fmt.fmt === 'pct' ? `${Math.round(b.add * 100)}%` : Math.round(b.add * 100) / 100}`);
      if (b.pct) bits.push(`${b.pct > 0 ? '+' : ''}${Math.round(b.pct * 100)}%`);
      if (b.mul !== 1) bits.push(`×${Math.round(b.mul * 100) / 100}`);
      return `${b.label}: ${bits.join(' ')}`;
    })
    .join('\n');
}

// Wires the sheet into the UI: ui.openCharacter, the C key, the player's card, a
// points badge on it, and a "Character" entry in the pause menu.
export function installCharacterView(ui) {
  if (!ui || ui.character) return ui?.character || null;
  const view = new CharacterView(ui);
  ui.character = view;
  ui.openCharacter = (slot) => view.open(slot);
  const g = ui.game;
  try {
    g.bus?.on?.('ui_open', (p) => {
      if (p?.panel === 'pause') addPauseEntry(ui, view);
    });
    const refresh = () => {
      if (view.isOpen()) view.render();
      syncBadge(ui);
    };
    for (const ev of ['points_changed', 'level_up', 'gear_changed', 'gear_upgraded', 'respec', 'game_start']) g.bus?.on?.(ev, refresh);
  } catch {
    /* the bus is optional */
  }
  return view;
}

function addPauseEntry(ui, view) {
  const top = ui.top?.();
  const menu = top?.el?.querySelector?.('.pause-menu');
  if (!menu || menu.querySelector('.pause-character')) return;
  const b = button('Character', { icon: 'heart', cls: 'pause-character', key: 'C', onClick: () => {
    ui.closeModal(top, true);
    view.open();
  } });
  const after = menu.children[1] || null;
  menu.insertBefore(b, after);
}

// The player's card shows a glowing count of unspent points; tapping the card opens the sheet.
export function syncBadge(ui) {
  const g = ui.game;
  const card = ui.root?.querySelector?.('.player-card');
  if (!card) return;
  if (!card.dataset.sheet) {
    card.dataset.sheet = '1';
    card.classList.add('tappable');
    card.title = 'Character sheet (C)';
    card.addEventListener('click', (e) => {
      if (e.target?.closest?.('button')) return;
      ui.openCharacter?.();
    });
  }
  let badge = card.querySelector('.card-points');
  if (!badge) {
    badge = h('span', { class: 'card-points num', hidden: true, title: 'Points to spend: open your character sheet (C)' });
    const lvl = card.querySelector('.card-level');
    if (lvl) lvl.after(badge);
    else card.append(badge);
  }
  // (While Free stat points is on there is nothing to save up: no count.)
  const n = g.progression?.free ? 0 : safe(() => g.progression?.unspent?.(), 0) || 0;
  badge.hidden = n <= 0;
  setText(badge, n > 0 ? `+${n}` : '');
  toggleClass(card, 'has-points', n > 0);
}
