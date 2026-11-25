// Inventory (yours beside Lyra's) and chest storage (DESIGN.md §14).

import { h, button, clear, setText, appendAll } from './dom.js';
import { makePanel } from './modal.js';
import { itemIconUrl } from './art.js';
import { itemDef, itemName } from '../entities/items.js';
import { sortItems, isUsable, fmtInt, capitalize } from './format.js';
import { dropItem } from '../entities/pickups.js';
import { handReach, reachNote, companionshipOf } from './lyra_view.js';
import { gearDef, gearStats, RARITY } from '../gear/gear_data.js';
import { describeContribution, STATS } from '../core/stats.js';
import { ensureStatsStyle } from './stats_style.js';

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    console.warn('[inventory]', err);
    return fallback;
  }
}

function slot(game, it, selected, onClick) {
  const def = it.def || itemDef(it.id) || { name: it.id };
  const gear = gearDef(it.id);
  const b = h(
    'button',
    { type: 'button', class: `slot ${selected ? 'selected' : ''} type-${def.type || 'misc'} ${gear ? `rar-bd-${gear.rarity}` : ''}`.trim(), title: def.name, 'aria-pressed': selected ? 'true' : 'false' },
    h('img', { class: 'item-img', alt: '', src: itemIconUrl(game, it.id) }),
    it.qty > 1 ? h('span', { class: 'slot-qty num', text: fmtInt(it.qty) }) : null,
  );
  b.addEventListener('click', onClick);
  return b;
}

function fmtDelta(c) {
  const f = STATS[c.stat]?.fmt;
  const a = Math.abs(c.delta);
  if (f === 'pct' || f === 'mul') return `${Math.round(a * 100)}%`;
  if (f === 'sec') return `${Math.round(a)} s`;
  return String(Math.round(a * 10) / 10);
}

export class InventoryPanel {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.panel = null;
    this.selected = null; // { owner: 'player'|'lyra', id }
  }

  isOpen() {
    return !!this.panel && this.ui.stack.includes(this.panel);
  }

  open() {
    if (this.isOpen()) return;
    const panel = makePanel({ id: 'inventory', title: 'Bag', subtitle: 'What you carry, and what Lyra carries', iconName: 'bag', cls: 'panel-wide' });
    this.panel = panel;
    panel.onClose = () => (this.panel = null);
    this.mine = h('div', { class: 'item-grid' });
    this.hers = h('div', { class: 'item-grid' });
    this.detail = h('div', { class: 'item-detail' });
    this.coinEl = h('span', { class: 'num' });
    this.lyraTitle = h('h3', { class: 'col-title' });
    panel.body.append(
      h(
        'div',
        { class: 'inv' },
        h('section', { class: 'inv-col' }, h('h3', { class: 'col-title' }, h('span', { text: 'Your pack' }), h('span', { class: 'purse' }, h('img', { class: 'item-img tiny', alt: '', src: itemIconUrl(this.game, 'coin') }), this.coinEl)), this.mine),
        h('section', { class: 'inv-col inv-detail-col' }, this.detail),
        h('section', { class: 'inv-col' }, this.lyraTitle, this.hers, this.buildPay()),
      ),
    );
    this.ui.openModal(panel);
    this.render();
  }

  close() {
    if (this.isOpen()) this.ui.closeModal(this.panel);
  }

  // She earns her own keep (§16.1): paying her is a hand-over she sees and remembers.
  buildPay() {
    this.payBtns = [5, 10].map((n) => {
      const b = button(`Give her ${n}`, { cls: 'btn-small btn-ghost', onClick: () => this.pay(n) });
      b.prepend(h('img', { class: 'item-img tiny', alt: '', src: itemIconUrl(this.game, 'coin') }));
      return b;
    });
    this.herPurse = h('span', { class: 'her-purse muted small' });
    this.reachEl = h('p', { class: 'reach-note small', hidden: true });
    return h('div', { class: 'pay-row' }, this.reachEl, h('div', { class: 'pay-btns' }, ...this.payBtns), this.herPurse);
  }

  pay(n) {
    const g = this.game;
    const p = g.player;
    const c = g.companion;
    if (!p || !c?.inventory || p.inventory.count('coin') < n || !handReach(g).ok) {
      g.audio?.play('error');
      return;
    }
    p.inventory.transfer(c.inventory, 'coin', n);
    g.bus.emit('item_given', { from: p, to: c, itemId: 'coin', qty: n });
    g.audio?.play('coin');
    this.ui.toast(`You gave ${g.settings?.companionName || c.name || 'Lyra'} ${n} coins.`, 'item', { iconUrl: itemIconUrl(g, 'coin') });
    this.render();
  }

  render() {
    if (!this.isOpen()) return;
    const g = this.game;
    const p = g.player;
    const c = g.companion;
    const lyraName = g.settings?.companionName || c?.name || 'Lyra';
    const coins = p?.inventory?.count('coin') || 0;
    const reach = handReach(g);
    this.reach = reach;
    for (const [i, b] of (this.payBtns || []).entries()) b.disabled = !c || !reach.ok || coins < (i === 0 ? 5 : 10);
    setText(this.reachEl, reachNote(reach, lyraName));
    this.reachEl.hidden = reach.ok;
    const purse = Number(c?.mind?.agenda?.purse);
    setText(this.herPurse, Number.isFinite(purse) ? `Her own purse: ${Math.max(0, Math.round(purse))} coins` : '');
    setText(this.coinEl, fmtInt(p?.inventory?.count('coin') || 0));
    setText(this.lyraTitle, `${lyraName}'s pack`);
    clear(this.mine);
    clear(this.hers);
    const mineList = sortItems(p?.inventory?.list() || []).filter((it) => it.id !== 'coin');
    const gone = companionshipOf(g) === 'gone';
    const herList = gone ? [] : sortItems(c?.inventory?.list() || []);
    if (this.selected) {
      const inv = this.selected.owner === 'player' ? p?.inventory : c?.inventory;
      if (!inv?.has(this.selected.id)) this.selected = null;
    }
    if (!this.selected && mineList.length) this.selected = { owner: 'player', id: mineList[0].id };
    if (!mineList.length) this.mine.append(h('p', { class: 'empty', text: 'Your pack is empty. Gather, loot and trade to fill it.' }));
    for (const it of mineList) this.mine.append(slot(g, it, this.selected?.owner === 'player' && this.selected.id === it.id, () => this.select('player', it.id)));
    if (!herList.length) this.hers.append(h('p', { class: 'empty', text: gone ? `${lyraName} keeps her pack to herself now.` : `${lyraName} carries nothing but her focus and a dagger.` }));
    for (const it of herList) this.hers.append(slot(g, it, this.selected?.owner === 'lyra' && this.selected.id === it.id, () => this.select('lyra', it.id)));
    this.renderDetail();
  }

  select(owner, id) {
    this.selected = { owner, id };
    this.game.audio?.play('ui_click');
    this.render();
    // On a phone the item's card (and what you can do with it) may sit below the fold:
    // bring its buttons into view.
    requestAnimationFrame(() => {
      try {
        const acts = this.detail?.querySelector('.detail-actions, .item-actions, .btn-row') || this.detail;
        acts?.scrollIntoView?.({ block: 'nearest', behavior: this.ui.reduceMotion ? 'auto' : 'smooth' });
      } catch {
        /* old browsers */
      }
    });
  }

  renderDetail() {
    const g = this.game;
    clear(this.detail);
    const sel = this.selected;
    if (!sel) {
      this.detail.append(h('p', { class: 'empty', text: 'Select an item to see what it is.' }));
      return;
    }
    const p = g.player;
    const c = g.companion;
    const lyraName = g.settings?.companionName || c?.name || 'Lyra';
    const inv = sel.owner === 'player' ? p?.inventory : c?.inventory;
    const qty = inv?.count(sel.id) || 0;
    const def = itemDef(sel.id) || { name: sel.id, type: 'misc', desc: '' };
    const facts = [];
    if (def.heal) facts.push(`Restores ${def.heal} health`);
    // Gear and buff food (DESIGN §26): what it does, worn or eaten.
    const gear = gearDef(sel.id);
    if (gear) {
      ensureStatsStyle();
      const lv = g.gear?.level?.(sel.id) || 0;
      facts.push(`${RARITY[gear.rarity].label} ${gear.slot}${lv ? `, upgraded +${lv}` : ''}`);
      facts.push(describeContribution(gearStats(sel.id, lv)).join(', '));
    } else if (def.atk) facts.push(`+${def.atk} attack`);
    if (def.buff) facts.push(`${def.buff.label}: ${describeContribution(def.buff).join(', ')} for ${Math.round(def.buff.seconds / 60) || 1} min`);
    if (def.value) facts.push(`Worth about ${def.value} coins`);
    const actions = h('div', { class: 'detail-actions' });
    if (sel.owner === 'player') {
      if (isUsable(def) || def.buff) actions.append(button(def.type === 'potion' ? 'Drink' : 'Eat', { cls: 'btn-ember', onClick: () => this.use(sel.id) }));
      if (gear && g.gear) {
        const cmp = (() => {
          try {
            return g.gear.compare(sel.id);
          } catch {
            return [];
          }
        })();
        if (cmp.length) facts.push(`If worn: ${cmp.slice(0, 5).map((c) => `${c.delta > 0 ? '+' : '−'}${fmtDelta(c)} ${STATS[c.stat].short || STATS[c.stat].label}`).join(', ')}`);
        actions.append(button('Wear', { cls: 'btn-ember', onClick: () => this.wear(sel.id) }));
      }
      const reach = this.reach || handReach(g);
      if (c && reach.why !== 'gone') {
        actions.append(button(`Give to ${lyraName}`, { icon: 'heart_arcane', disabled: !reach.ok, title: reachNote(reach, lyraName) || null, onClick: () => this.give(sel.id, 1) }));
        if (qty > 1) actions.append(button(`Give all ${qty}`, { cls: 'btn-ghost', disabled: !reach.ok, onClick: () => this.give(sel.id, qty) }));
      }
      if (def.type !== 'quest' && def.type !== 'key') actions.append(button('Drop', { cls: 'btn-ghost', onClick: () => this.drop(sel.id) }));
    } else {
      // Her pack is hers (§16): you ask, and she decides whether to hand it over.
      actions.append(button('Ask for one', { icon: 'hand', onClick: () => this.take(sel.id, 1) }));
      if (qty > 1) actions.append(button(`Ask for all ${qty}`, { cls: 'btn-ghost', onClick: () => this.take(sel.id, qty) }));
      if (isUsable(def)) actions.append(button(`Ask ${lyraName} to ${def.type === 'potion' ? 'drink' : 'eat'} it`, { cls: 'btn-ghost', onClick: () => this.askUse(sel.id) }));
    }
    appendAll(this.detail, [
      h('div', { class: 'detail-head' }, h('span', { class: 'detail-icon' }, h('img', { class: 'item-img big', alt: '', src: itemIconUrl(g, sel.id) })), h('div', null, h('h3', { class: 'detail-name', text: def.name }), h('div', { class: 'detail-type', text: `${capitalize(def.type || 'item')} · ${qty} ${sel.owner === 'player' ? 'carried' : `with ${lyraName}`}` }))),
      def.desc ? h('p', { class: 'detail-desc', text: def.desc }) : null,
      facts.length ? h('ul', { class: 'detail-facts' }, ...facts.map((f) => h('li', { text: f }))) : null,
      actions,
    ]);
  }

  wear(id) {
    const g = this.game;
    const r = g.gear?.equip?.(id);
    if (!r?.ok) this.ui.toast(r?.reason || "You can't wear that.", 'info');
    else {
      g.audio?.play('pickup');
      this.ui.toast(`You put on ${itemName(id)}${r.swapped ? ` (${itemName(r.swapped)} back in your pack)` : ''}.`, 'item', { iconUrl: itemIconUrl(g, id) });
    }
    this.render();
  }

  use(id) {
    const g = this.game;
    const ok = safe(() => g.combat?.useItem?.(g.player, id), false);
    if (!ok) {
      g.audio?.play('error');
      this.ui.toast(g.player?.hp >= g.player?.maxHp ? "You're not hurt. Save it for later." : "You can't use that right now.", 'info');
    }
    this.render();
  }

  give(id, qty) {
    const g = this.game;
    const p = g.player;
    const c = g.companion;
    if (!p || !c || !handReach(g).ok) return;
    const n = p.inventory.transfer(c.inventory, id, qty);
    if (!n) return;
    g.bus.emit('item_given', { from: p, to: c, itemId: id, qty: n });
    g.audio?.play('pickup');
    this.ui.toast(`You gave ${g.settings?.companionName || c.name || 'Lyra'} ${itemName(id, n)}.`, 'item', { iconUrl: itemIconUrl(g, id) });
    this.render();
  }

  // Asking for something from her pack is a request she weighs; she hands it over
  // herself. Without a give_item action (an older build), the hand-over is direct.
  take(id, qty) {
    const g = this.game;
    const p = g.player;
    const c = g.companion;
    if (!p || !c) return;
    if (safe(() => g.actions?.has?.('give_item'), false)) {
      this.ui.ask('give_item', { target: 'player', value: id, amount: qty }, 'give');
      this.render();
      return;
    }
    const n = c.inventory.transfer(p.inventory, id, qty);
    if (!n) return;
    g.bus.emit('item_given', { from: c, to: p, itemId: id, qty: n });
    g.audio?.play('pickup');
    this.render();
  }

  askUse(id) {
    this.ui.ask('use_item', { value: id }, 'use');
    this.render();
  }

  drop(id) {
    const g = this.game;
    const p = g.player;
    if (!p?.inventory.has(id)) return;
    const n = p.inventory.remove(id, 1);
    if (!n) return;
    const fx = p.facing?.x ?? 0;
    const fy = p.facing?.y ?? 1;
    safe(() => dropItem(g, id, n, p.x + fx * 14, p.y + fy * 14));
    g.audio?.play('ui_close');
    this.render();
  }
}

export class ChestPanel {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.panel = null;
    this.chest = null;
  }

  isOpen() {
    return !!this.panel && this.ui.stack.includes(this.panel);
  }

  open(chest) {
    if (!chest?.inventory) return;
    if (this.isOpen()) this.close();
    this.chest = chest;
    const title = chest.name && chest.name !== 'chest' ? capitalize(chest.name.replace(/_/g, ' ')) : 'Chest';
    const panel = makePanel({ id: 'chest', title, subtitle: 'Choose an item to move one; All moves the whole stack.', iconName: 'chest', cls: 'panel-wide' });
    this.panel = panel;
    panel.onClose = () => {
      this.panel = null;
      this.chest = null;
    };
    this.mine = h('div', { class: 'store-list' });
    this.theirs = h('div', { class: 'store-list' });
    const storeAll = button('Store all materials', { cls: 'btn-ghost btn-small', onClick: () => this.storeMaterials() });
    const takeAll = button('Take everything', { cls: 'btn-ghost btn-small', onClick: () => this.takeAll() });
    panel.body.append(h('div', { class: 'store' }, h('section', { class: 'store-col' }, h('h3', { class: 'col-title', text: 'Your pack' }), this.mine, storeAll), h('section', { class: 'store-col' }, h('h3', { class: 'col-title', text: title }), this.theirs, takeAll)));
    this.ui.openModal(panel);
    this.game.audio?.play('door_open', { volume: 0.5, pitch: 1.6 });
    this.render();
  }

  close() {
    if (this.isOpen()) this.ui.closeModal(this.panel);
  }

  row(it, dir) {
    const g = this.game;
    const def = it.def || itemDef(it.id) || { name: it.id };
    const move = h('button', { type: 'button', class: 'store-row', title: dir === 'in' ? 'Put one in the chest' : 'Take one' }, h('img', { class: 'item-img', alt: '', src: itemIconUrl(g, it.id) }), h('span', { class: 'store-name', text: def.name }), h('span', { class: 'store-qty num', text: `×${fmtInt(it.qty)}` }), h('span', { class: 'store-arrow', text: dir === 'in' ? '→' : '←' }));
    move.addEventListener('click', () => this.move(it.id, 1, dir));
    const wrap = h('div', { class: 'store-item' }, move);
    if (it.qty > 1) {
      const all = button('All', { cls: 'btn-small btn-ghost' });
      all.addEventListener('click', () => this.move(it.id, it.qty, dir));
      wrap.append(all);
    }
    return wrap;
  }

  render() {
    if (!this.isOpen()) return;
    const p = this.game.player;
    clear(this.mine);
    clear(this.theirs);
    const mine = sortItems(p?.inventory?.list() || []).filter((it) => it.def?.type !== 'quest');
    const theirs = sortItems(this.chest.inventory.list());
    if (!mine.length) this.mine.append(h('p', { class: 'empty', text: 'Nothing to store.' }));
    for (const it of mine) this.mine.append(this.row(it, 'in'));
    if (!theirs.length) this.theirs.append(h('p', { class: 'empty', text: 'Empty.' }));
    for (const it of theirs) this.theirs.append(this.row(it, 'out'));
  }

  move(id, qty, dir) {
    const g = this.game;
    const p = g.player;
    const chest = this.chest;
    if (!p || !chest) return;
    if (dir === 'in') {
      p.inventory.transfer(chest.inventory, id, qty);
      g.audio?.play('ui_click');
    } else {
      const n = chest.inventory.transfer(p.inventory, id, qty);
      if (n) {
        g.bus.emit('item_gained', { actor: p, itemId: id, qty: n, from: 'chest', chest });
        g.audio?.play(id === 'coin' ? 'coin' : 'pickup');
      }
    }
    this.render();
  }

  storeMaterials() {
    const p = this.game.player;
    if (!p || !this.chest) return;
    for (const it of p.inventory.list()) if (it.def?.type === 'material') p.inventory.transfer(this.chest.inventory, it.id, it.qty);
    this.game.audio?.play('ui_click');
    this.render();
  }

  takeAll() {
    const p = this.game.player;
    if (!p || !this.chest) return;
    for (const it of this.chest.inventory.list()) this.move(it.id, it.qty, 'out');
    this.render();
  }
}
