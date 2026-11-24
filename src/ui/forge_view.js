// Bram's forge (DESIGN §26): upgrade the blades and armor you own, or have him forge a
// new piece, for ore, glow crystals and coin. Opened from Bram's dialogue ("The forge").
// Every row says what the next level gives, what it costs (short items in red) and,
// when he won't do it yet, why, in his own few words.

import { h, button, clear, setText } from './dom.js';
import { makePanel } from './modal.js';
import { itemIconUrl } from './art.js';
import { fmtInt } from './format.js';
import { gearDef, gearStats, RARITY } from '../gear/gear_data.js';
import { describeContribution } from '../core/stats.js';
import { itemWord, costEntries } from '../gear/gear.js';
import { ensureStatsStyle } from './stats_style.js';

const BRAM_LINES = {
  upgrade: 'Leave it on the anvil. Ore and crystal. Hmph.',
  forge: 'Steel, if you bring the iron. Pick.',
  done: ['Better. Mind the edge.', 'Done. Hmph. Good weight now.', 'There. It will hold.'],
  short: 'Not enough. Bring more.',
};

function costChips(game, cost, have) {
  const wrap = h('div', { class: 'fg-costs' });
  for (const [k, v] of costEntries(cost)) {
    const owned = have(k);
    const chip = h('span', { class: `fg-cost ${owned < v ? 'short' : ''}`.trim(), title: `${itemWord(k, v)}: you have ${owned}` }, h('img', { alt: '', src: itemIconUrl(game, k) }), h('span', { class: 'num', text: k === 'coin' ? fmtInt(v) : `${v}` }));
    wrap.append(chip);
  }
  return wrap;
}

export class ForgeView {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.panel = null;
    this.tab = 'upgrade';
    this.line = BRAM_LINES.upgrade;
  }

  isOpen() {
    return !!this.panel && this.ui.stack.includes(this.panel);
  }

  open(tab = 'upgrade') {
    const g = this.game;
    if (!g.gear || !g.player) return;
    ensureStatsStyle();
    this.tab = tab === 'forge' ? 'forge' : 'upgrade';
    this.line = BRAM_LINES[this.tab];
    if (this.isOpen()) {
      this.render();
      return;
    }
    const panel = makePanel({ id: 'forge', title: "Bram's Forge", subtitle: 'Upgrade what you carry, or have something new made', iconName: 'axe', cls: 'panel-wide panel-forge' });
    panel.pauses = true;
    panel.onClose = () => {
      this.panel = null;
    };
    this.panel = panel;
    this.tabs = h('div', { class: 'segmented fg-tabs', role: 'radiogroup' });
    for (const [id, label] of [
      ['upgrade', 'Upgrade'],
      ['forge', 'Forge new'],
    ]) {
      const b = h('button', { type: 'button', class: 'seg', role: 'radio', text: label });
      b.dataset.tab = id;
      b.addEventListener('click', () => {
        this.tab = id;
        this.line = BRAM_LINES[id];
        this.game.audio?.play?.('ui_click');
        this.render();
      });
      this.tabs.append(b);
    }
    this.bramEl = h('p', { class: 'fg-bram' });
    this.listEl = h('div', { class: 'fg-list' });
    this.purse = h('span', { class: 'num' });
    panel.body.append(this.tabs, this.bramEl, this.listEl);
    panel.foot.append(h('span', { class: 'purse' }, h('img', { class: 'item-img tiny', alt: '', src: itemIconUrl(g, 'coin') }), this.purse), this.matsEl(), h('span', { class: 'sb-spacer' }), button('Done', { cls: 'btn-ember', onClick: () => this.close() }));
    this.ui.openModal(panel);
    this.render();
  }

  matsEl() {
    this.oreEl = h('span', { class: 'num' });
    this.crysEl = h('span', { class: 'num' });
    const g = this.game;
    return h('span', { class: 'purse' }, h('img', { class: 'item-img tiny', alt: '', src: itemIconUrl(g, 'iron_ore') }), this.oreEl, h('img', { class: 'item-img tiny', alt: '', src: itemIconUrl(g, 'crystal') }), this.crysEl);
  }

  close() {
    if (this.isOpen()) this.ui.closeModal(this.panel);
  }

  have(k) {
    return this.game.player?.inventory?.count?.(k) ?? 0;
  }

  render() {
    if (!this.panel) return;
    for (const b of this.tabs.children) b.setAttribute('aria-checked', b.dataset.tab === this.tab ? 'true' : 'false');
    setText(this.bramEl, `Bram: “${this.line}”`);
    setText(this.purse, fmtInt(this.have('coin')));
    setText(this.oreEl, String(this.have('iron_ore')));
    setText(this.crysEl, String(this.have('crystal')));
    clear(this.listEl);
    if (this.tab === 'upgrade') this.renderUpgrades();
    else this.renderRecipes();
  }

  // Weapons and armor the player owns: worn first, then the bag.
  owned() {
    const G = this.game.gear;
    const out = [];
    const seen = new Set();
    for (const s of ['weapon', 'armor']) {
      const id = G.equipped[s];
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push({ id, worn: true });
      }
    }
    for (const it of this.game.player.inventory.list()) {
      const d = gearDef(it.id);
      if (!d || (d.slot !== 'weapon' && d.slot !== 'armor') || seen.has(it.id)) continue;
      seen.add(it.id);
      out.push({ id: it.id, worn: false });
    }
    return out;
  }

  renderUpgrades() {
    const g = this.game;
    const G = g.gear;
    const list = this.owned();
    if (!list.length) {
      this.listEl.append(h('p', { class: 'chs-empty', text: 'Bram works blades and armor. Your old sword is too plain to work: buy or forge a piece first (Forge new), then bring it here with ore and crystals.' }));
      return;
    }
    for (const { id, worn } of list) {
      const d = gearDef(id);
      const lv = G.level(id);
      const max = G.maxLevel(id);
      const cost = G.upgradeCost(id);
      const pips = h('span', { class: 'fg-pips', 'aria-label': `${lv} of ${max}` });
      for (let i = 0; i < max; i++) pips.append(h('i', { class: i < lv ? 'on' : '' }));
      const now = gearStats(id, lv);
      const next = cost ? gearStats(id, cost.level) : null;
      const gain = next ? diff(next, now) : null;
      const sub = cost ? `Next: ${describeContribution(gain).join(', ') || 'a finer edge'}` : 'As good as Bram can make it.';
      const can = cost ? G.afford(cost).ok : false;
      const act = h('div', { class: 'fg-act' }, button(cost ? `Upgrade to +${cost.level}` : 'Finished', { cls: can ? 'btn-ember' : 'btn-ghost', disabled: !cost || !can, onClick: () => this.upgrade(id) }));
      const row = h(
        'div',
        { class: `fg-row rar-bd-${d.rarity}` },
        h('img', { alt: '', src: itemIconUrl(g, id) }),
        h('div', null, h('div', { class: `fg-name rar-${d.rarity}` }, h('span', { text: `${d.name}${lv ? ` +${lv}` : ''}` }), pips), h('div', { class: 'fg-sub', text: `${RARITY[d.rarity].label}${worn ? ' · worn' : ''} · ${describeContribution(now).join(', ')}` }), h('div', { class: 'fg-sub', text: sub }), cost ? costChips(g, cost, (k) => this.have(k)) : null),
        act,
      );
      this.listEl.append(row);
    }
  }

  renderRecipes() {
    const g = this.game;
    for (const r of g.gear.recipes()) {
      const d = r.def;
      if (!d) continue;
      const st = gearStats(r.id, 0);
      const act = h('div', { class: 'fg-act' }, button('Forge', { cls: r.can ? 'btn-ember' : 'btn-ghost', disabled: !r.can, onClick: () => this.forge(r.id) }));
      const row = h(
        'div',
        { class: `fg-row rar-bd-${d.rarity}` },
        h('img', { alt: '', src: itemIconUrl(g, r.id) }),
        h('div', null, h('div', { class: `fg-name rar-${d.rarity}`, text: d.name }), h('div', { class: 'fg-sub', text: `${RARITY[d.rarity].label} · ${describeContribution(st).join(', ')}` }), r.open ? costChips(g, r, (k) => this.have(k)) : h('div', { class: 'fg-why', text: r.why })),
        act,
      );
      this.listEl.append(row);
    }
  }

  upgrade(id) {
    const r = this.game.gear.upgrade(id);
    if (!r.ok) {
      this.line = BRAM_LINES.short;
      this.ui.toast(r.reason, 'info');
      this.game.audio?.play?.('error', { volume: 0.5 });
    } else {
      const lines = BRAM_LINES.done;
      this.line = lines[(r.level + id.length) % lines.length];
      this.game.audio?.play?.('mine', { pitch: 1.4 });
      this.game.audio?.play?.('levelup', { volume: 0.5, pitch: 1.3 });
      this.ui.toast(`${gearDef(id).name} is +${r.level} now.`, 'good');
    }
    this.render();
  }

  forge(id) {
    const r = this.game.gear.forge(id);
    if (!r.ok) {
      this.line = BRAM_LINES.short;
      this.ui.toast(r.reason, 'info');
    } else {
      this.line = 'There. Yours. Hmph.';
      this.game.audio?.play?.('mine', { pitch: 1.2 });
      this.ui.toast(`Bram forged you ${gearDef(id).name}. Wear it from your character sheet (C).`, 'good');
    }
    this.render();
  }
}

function diff(a, b) {
  const out = { add: {}, pct: {} };
  for (const part of ['add', 'pct']) for (const [k, v] of Object.entries(a[part] || {})) {
    const d = Math.round((v - (b[part]?.[k] || 0)) * 1000) / 1000;
    if (d) out[part][k] = d;
  }
  return out;
}

export function installForgeView(ui) {
  if (!ui || ui.forge) return ui?.forge || null;
  const view = new ForgeView(ui);
  ui.forge = view;
  ui.openForge = (tab) => view.open(tab);
  return view;
}
