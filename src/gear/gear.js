import { SLOTS, SLOT_LABEL, KIND_SLOTS, RARITY, GEAR, BUFF_ITEMS, FORGE_RECIPES, SHOP_STOCK, SHOP_BUYS, BOSS_GEAR, gearDef, gearStats, upgradeCost, maxUpOf, rarityOf } from './gear_data.js';
import { STATS, describeContribution } from '../core/stats.js';
import { dropItem } from '../entities/pickups.js';

// Equipment (DESIGN §26): game.gear.
//
//   equipped { weapon, armor, cloak, boots, charm1, charm2 } (item ids or null)
//   levels { itemId: upgrade level } (Bram's forge)
//   equip(id, slot?) -> { ok, reason?, slot, swapped }   unequip(slot) -> { ok }
//   compare(id, slot?) -> [{ stat, label, before, after, delta }]   (what equipping would do)
//   slotFor(id) -> the slot it would go in        isEquipped(id)
//   upgrade(id) -> { ok, reason?, level }         upgradeCost(id) -> { coin, iron_ore, crystal } | null
//   forge(recipeId) -> { ok, reason? }            recipes() -> [{ id, ..., can, why }]
//   useBuff(itemId) (an item's timed buff onto the pipeline)
//   looks() -> { weapon, cloak, armor, boots } tint colors for the sprite
//   serialize() / deserialize(d)
//
// An equipped piece leaves the bag (it is worn, not carried), so it cannot be sold or
// given away while worn. The pipeline's 'gear' source sums every worn piece at its
// upgrade level. Bus: gear_changed {slot, id, prev}, gear_upgraded {id, level},
// gear_forged {id}.

const own = Object.prototype.hasOwnProperty;

// The items a cost asks for: numeric entries only ({ coin, iron_ore, crystal, wolf_pelt }).
const NOT_COST = new Set(['level', 'id']);
export function costEntries(cost) {
  return Object.entries(cost || {}).filter(([k, v]) => typeof v === 'number' && v > 0 && !NOT_COST.has(k));
}

function emptySlots() {
  const o = {};
  for (const s of SLOTS) o[s] = null;
  return o;
}

export class Gear {
  constructor(game) {
    this.game = game;
    this.equipped = emptySlots();
    this.levels = {};
    this._stamp = 0;
    this._cache = null;
    this._cacheStamp = -1;
    const S = game.stats;
    if (S) S.addSource('gear', 'Gear', (a) => this.contribution(a), 30);
    this._bind();
  }

  _bind() {
    const g = this.game;
    const bus = g.bus;
    if (!bus?.on) return;
    try {
      bus.on('item_used', (p) => {
        if (p?.actor && p.actor === g.player) this.useBuff(p.itemId);
      });
      bus.on('boss_defeated', (p) => this.bossDrop(p));
    } catch {
      /* the bus is optional in tests */
    }
  }

  player() {
    return this.game.player || null;
  }

  isPlayer(a) {
    return !!a && (a === this.game.player || a.id === 'player');
  }

  // ---------------------------------------------------------------- the pipeline

  contribution(a) {
    if (!this.isPlayer(a)) return null;
    if (this._cacheStamp === this._stamp && this._cache !== undefined) return this._cache;
    const out = { add: {}, pct: {} };
    let any = false;
    for (const s of SLOTS) {
      const id = this.equipped[s];
      if (!id) continue;
      const st = gearStats(id, this.levels[id] || 0);
      if (!st) continue;
      for (const part of ['add', 'pct']) for (const [k, v] of Object.entries(st[part] || {})) out[part][k] = Math.round(((out[part][k] || 0) + v) * 10000) / 10000;
      any = true;
    }
    this._cache = any ? out : null;
    this._cacheStamp = this._stamp;
    return this._cache;
  }

  changed() {
    this._stamp++;
    this.game.stats?.refresh(this.player());
  }

  // ---------------------------------------------------------------- equipping

  slotFor(id, prefer = null) {
    const g = gearDef(id);
    if (!g) return null;
    const slots = KIND_SLOTS[g.slot] || [];
    if (prefer && slots.includes(prefer)) return prefer;
    if (slots.length <= 1) return slots[0] || null;
    // Charms: an empty charm slot first, else the first.
    return slots.find((s) => !this.equipped[s]) || slots[0];
  }

  isEquipped(id) {
    return SLOTS.some((s) => this.equipped[s] === id);
  }

  equip(id, slot = null) {
    const P = this.player();
    const def = gearDef(id);
    if (!P || !def) return { ok: false, reason: "That isn't something you can wear." };
    const inv = P.inventory;
    if (!inv?.has?.(id)) return { ok: false, reason: `You don't have ${def.name} in your bag.` };
    const s = this.slotFor(id, slot);
    if (!s) return { ok: false, reason: "That isn't something you can wear." };
    const prev = this.equipped[s];
    inv.remove(id, 1);
    if (prev) inv.add(prev, 1);
    this.equipped[s] = id;
    this.changed();
    this.game.bus?.emit?.('gear_changed', { slot: s, id, prev });
    this.game.bus?.emit?.('inventory_changed', { actor: P });
    return { ok: true, slot: s, swapped: prev || null };
  }

  unequip(slot) {
    const P = this.player();
    if (!own.call(this.equipped, slot)) return { ok: false, reason: 'There is no such slot.' };
    const id = this.equipped[slot];
    if (!id) return { ok: false, reason: 'Nothing is worn there.' };
    this.equipped[slot] = null;
    P?.inventory?.add?.(id, 1);
    this.changed();
    this.game.bus?.emit?.('gear_changed', { slot, id: null, prev: id });
    this.game.bus?.emit?.('inventory_changed', { actor: P });
    return { ok: true, id };
  }

  // What wearing `id` would change: every stat that moves, before → after.
  compare(id, slot = null) {
    const P = this.player();
    const S = this.game.stats;
    const s = this.slotFor(id, slot);
    if (!P || !S || !s) return [];
    const before = S.all(P);
    const was = this.equipped[s];
    this.equipped[s] = id;
    this._stamp++;
    S.touch();
    const after = S.all(P);
    this.equipped[s] = was;
    this._stamp++;
    S.touch();
    const out = [];
    for (const k of Object.keys(STATS)) {
      const a = before[k];
      const b = after[k];
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b - a) < 1e-6) continue;
      out.push({ stat: k, label: STATS[k].label, before: a, after: b, delta: b - a, better: STATS[k].lowerIsBetter ? b < a : b > a });
    }
    return out;
  }

  // ---------------------------------------------------------------- Bram's forge

  level(id) {
    return Math.max(0, Math.floor(this.levels[id] || 0));
  }

  maxLevel(id) {
    return maxUpOf(id);
  }

  upgradeCost(id) {
    return upgradeCost(id, this.level(id));
  }

  // Does the player hold what a cost asks? -> { ok, missing: [[item, need, have]] }
  afford(cost) {
    const inv = this.player()?.inventory;
    const missing = [];
    for (const [item, v] of costEntries(cost)) {
      const have = inv?.count?.(item) ?? 0;
      if (have < v) missing.push([item, v, have]);
    }
    return { ok: !missing.length, missing };
  }

  pay(cost) {
    const inv = this.player()?.inventory;
    if (!inv) return false;
    for (const [k, v] of costEntries(cost)) inv.remove(k, v);
    this.game.bus?.emit?.('inventory_changed', { actor: this.player() });
    return true;
  }

  // Upgrade a piece you own (worn or in the bag).
  upgrade(id) {
    const def = gearDef(id);
    const P = this.player();
    if (!def || !P) return { ok: false, reason: 'Bram turns it over and hands it back. "Not mine to fix."' };
    if (!this.isEquipped(id) && !P.inventory?.has?.(id)) return { ok: false, reason: `You don't have ${def.name}.` };
    const cost = this.upgradeCost(id);
    if (!cost) return { ok: false, reason: maxUpOf(id) ? `${def.name} is as good as Bram can make it.` : 'Bram only works weapons and armor.' };
    const can = this.afford(cost);
    if (!can.ok) return { ok: false, reason: `Not enough: ${can.missing.map(([item, need, have]) => `${need - have} more ${itemWord(item, need - have)}`).join(', ')}.`, missing: can.missing };
    this.pay(cost);
    this.levels[id] = cost.level;
    this.changed();
    this.game.bus?.emit?.('gear_upgraded', { id, level: cost.level });
    return { ok: true, level: cost.level };
  }

  // Bram's opinion of the player (0..100), for the recipes he keeps for those he trusts.
  bramOpinion() {
    const bram = this.game.entities?.get?.('bram');
    const v = bram?.opinionOf?.('player') ?? bram?.relations?.player?.opinion ?? bram?.mind?.opinion?.player ?? bram?.opinion?.player;
    return Number.isFinite(v) ? v : 50;
  }

  recipes() {
    const lv = Math.max(1, this.player()?.level || 1);
    const op = this.bramOpinion();
    return FORGE_RECIPES.map((r) => {
      const def = gearDef(r.id);
      let why = '';
      if (r.needs?.level && lv < r.needs.level) why = `Bram wants to see you hold a blade longer first (level ${r.needs.level}).`;
      else if (r.needs?.opinion && op < r.needs.opinion) why = 'Bram keeps this one for people he trusts.';
      const can = this.afford(r);
      return { ...r, def, name: def?.name || r.id, rarity: def?.rarity || 'common', open: !why, why, can: !why && can.ok, missing: can.missing };
    });
  }

  forge(recipeId) {
    const r = this.recipes().find((x) => x.id === recipeId);
    const P = this.player();
    if (!r || !P) return { ok: false, reason: 'Bram does not know that one.' };
    if (!r.open) return { ok: false, reason: r.why };
    if (!r.can) return { ok: false, reason: `Not enough: ${r.missing.map(([item, need, have]) => `${need - have} more ${itemWord(item, need - have)}`).join(', ')}.` };
    this.pay(r);
    P.inventory.add(r.id, 1);
    this.game.bus?.emit?.('item_gained', { actor: P, itemId: r.id, qty: 1, from: 'forge' });
    this.game.bus?.emit?.('gear_forged', { id: r.id });
    return { ok: true, id: r.id };
  }

  // ---------------------------------------------------------------- buffs, drops, looks

  useBuff(itemId) {
    const b = BUFF_ITEMS[itemId]?.buff;
    const P = this.player();
    if (!b || !P || !this.game.stats) return null;
    const mod = this.game.stats.addModifier(P, {
      id: `buff:${itemId}`,
      source: `buff:${itemId}`,
      label: b.label,
      kind: 'buff',
      add: b.add,
      pct: b.pct,
      mul: b.mul,
      t: b.seconds,
      total: b.seconds,
      color: b.color,
      icon: 'buff',
      note: describeContribution(b).join(', '),
    });
    try {
      this.game.ui?.toast?.(`${b.label}: ${describeContribution(b).join(', ')} for ${fmtTime(b.seconds)}.`, 'good');
    } catch {
      /* the UI is optional */
    }
    return mod;
  }

  // A beaten boss leaves its special pieces where it fell.
  bossDrop(p) {
    const id = p?.id;
    const list = BOSS_GEAR[id];
    if (!list?.length) return;
    const g = this.game;
    const key = `gear_drop_${id}`;
    if (g.flags?.[key]) return;
    if (g.flags) g.flags[key] = true;
    const b = p.boss;
    const x = Number.isFinite(b?.x) ? b.x : g.player?.x ?? 0;
    const y = Number.isFinite(b?.y) ? b.y : g.player?.y ?? 0;
    list.forEach((itemId, i) => {
      const ox = (i - (list.length - 1) / 2) * 16;
      if (g.entities?.add) {
        try {
          dropItem(g, itemId, 1, x + ox, y + 10, { lifetime: 3600 });
          return;
        } catch {
          /* straight into the bag instead */
        }
      }
      g.player?.inventory?.add?.(itemId, 1);
      g.bus?.emit?.('item_gained', { actor: g.player, itemId, qty: 1, from: 'boss' });
    });
  }

  // Colors the sprite wears (DESIGN §26: weapon, cloak color, armor tint).
  looks() {
    const e = this.equipped;
    const tint = (id) => (id ? gearDef(id)?.tint || null : null);
    return { weapon: tint(e.weapon), armor: tint(e.armor), cloak: tint(e.cloak), boots: tint(e.boots), weaponId: e.weapon, armorId: e.armor, cloakId: e.cloak };
  }

  // ---------------------------------------------------------------- saving

  serialize() {
    const levels = {};
    for (const [k, v] of Object.entries(this.levels)) if (v > 0 && gearDef(k)) levels[k] = v;
    return { equipped: { ...this.equipped }, levels };
  }

  deserialize(d) {
    this.equipped = emptySlots();
    this.levels = {};
    if (d && typeof d === 'object') {
      for (const s of SLOTS) {
        const id = d.equipped?.[s];
        if (typeof id === 'string' && gearDef(id) && (KIND_SLOTS[gearDef(id).slot] || []).includes(s)) this.equipped[s] = id;
      }
      for (const [k, v] of Object.entries(d.levels || {})) if (gearDef(k) && Number.isFinite(v) && v > 0) this.levels[k] = Math.min(maxUpOf(k), Math.floor(v));
    } else this.adoptLegacy();
    this.changed();
  }

  // A save from before gear: the best sword in the bag goes into the hand.
  adoptLegacy() {
    const inv = this.player()?.inventory;
    if (!inv || this.equipped.weapon) return;
    if (inv.has('iron_sword')) {
      inv.remove('iron_sword', 1);
      this.equipped.weapon = 'iron_sword';
    }
  }
}

// Stock the village's shops (DESIGN §26): Bram's arms, Sabeth's cloaks, Garrick's boots
// and charms, Mira's tonics and Elda's kitchen. Idempotent: an item already for sale
// keeps its price. Mira gets a shop of her own if she had none.
export function stockShops(profiles) {
  const list = Array.isArray(profiles) ? profiles : [];
  for (const [who, stock] of Object.entries(SHOP_STOCK)) {
    const p = list.find((x) => x?.id === who);
    if (!p) continue;
    if (!p.shop) p.shop = { sells: [], buys: {} };
    if (!Array.isArray(p.shop.sells)) p.shop.sells = [];
    if (!p.shop.buys || typeof p.shop.buys !== 'object') p.shop.buys = {};
    for (const s of stock) if (!p.shop.sells.some((x) => x.id === s.id)) p.shop.sells.push({ ...s });
    for (const [item, price] of Object.entries(SHOP_BUYS[who] || {})) if (p.shop.buys[item] == null) p.shop.buys[item] = price;
  }
  return list;
}

// Short words for an item in a "not enough" line.
const ITEM_WORDS = { coin: ['coin', 'coins'], iron_ore: ['iron ore', 'iron ore'], crystal: ['glow crystal', 'glow crystals'], wolf_pelt: ['wolf pelt', 'wolf pelts'] };
export function itemWord(id, n = 2) {
  const w = ITEM_WORDS[id];
  if (w) return n === 1 ? w[0] : w[1];
  return String(id).replace(/_/g, ' ');
}

export function fmtTime(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m} min ${r} s` : `${m} min`;
  }
  return `${s} s`;
}

export { SLOTS, SLOT_LABEL, RARITY, GEAR, BUFF_ITEMS, gearDef, gearStats, rarityOf, maxUpOf };

// What a ware does, in the words the bag and the Character sheet use (DESIGN §39): a piece
// of gear's rarity, slot and stats; a draught's or a dish's timed buff; each percentage
// saying what it is a share of (stats.pctWords). Null for a plain thing. The shop's ware
// lines read it.
export function wareWords(id, level = 0) {
  const gear = gearDef(id);
  if (gear) {
    const does = describeContribution(gearStats(id, level)).join(', ');
    return `${RARITY[gear.rarity]?.label || 'Common'} ${gear.slot}${level ? ` +${level}` : ''}${does ? `: ${does}` : ''}`;
  }
  const b = own.call(BUFF_ITEMS, id) ? BUFF_ITEMS[id].buff : null;
  if (b) return `${b.label}: ${describeContribution(b).join(', ')} for ${Math.round((b.seconds || 60) / 60) || 1} min`;
  return null;
}
