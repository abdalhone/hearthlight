// The shop (round 14b, S-17 and S-19's merchants; DESIGN §36.2; the author: "a shop to sell
// my stuff", "don't forget to add a shop"). Buy and sell at the four merchants, Garrick
// (general goods), Bram (metal and gear), Mira Fennick (herbs and potions) and Elda (food),
// each paying what suits them, from one daily stock, with haggling by how they feel about
// you, and a risk in selling goods to someone who knows whose they were.
//
// Pure where it can be: priceFor(game, npc, itemId, 'buy' | 'sell') and the tables. The
// little state (today's haggles, today's stock and purse) lives in game.trade (tradePlugin,
// saved). Nobody's profile is edited: the tastes, extra wares and daily stock are here, and
// a profile's own `shop` (sells, buys, buysAll) still stands as the base and overrides.
//
//   shopOf(game, npc)          { sells: [{ id, price }], buys, buysAll } merged with the table
//   isMerchant(npc)            has wares or buys anything
//   priceFor(game, npc, id, 'buy'|'sell')   -> coins, or null (not to their taste)
//   stance(game, npc)          { refuse, markup, fence, line }: S-19's graded refusal, one rule
//   game.trade.stockLeft(npc, id)    n left today (Infinity when unlimited)
//   game.trade.buy(npc, id, qty) / sell(npc, id, qty) -> { ok, total, line, reason }
//   game.trade.haggle(npc)     once a day each: { won, line }
//   game.trade.stolenOf(id, qty)    the provenance entries a sale would take (not removed)
//
// Never a loop: what a merchant pays for an item is at most SELL_CAP of the lowest price
// anyone asks for it, after every discount; their own discounts stop above that.

import { itemDef } from '../entities/items.js';
import { profileById } from '../entities/npc_data.js';
import { VILLAGERS } from '../ai/social/bonds_data.js';

export const SELL_CAP = 0.6;
export const FRESH_DAYS = 3; // days after a known killing when nobody who knows will trade // of the lowest asking price, after the best discounts
const MOOD_BUY = { low: 1.25, cold: 1.1, normal: 1, warm: 0.92, dear: 0.85 }; // what you pay
const MOOD_SELL = { low: 0.8, cold: 0.9, normal: 1, warm: 1.06, dear: 1.12 }; // what they pay
const HAGGLE_BUY = 0.9;
const HAGGLE_SELL = 1.1;

// Their tastes: what they buy (by item type, gear slot or id) and at what share of its worth.
export const TASTES = {
  garrick: { all: true, rate: 0.45, haggle: 0.75 },
  bram: { slots: ['weapon', 'armor', 'boots'], types: ['weapon'], ids: ['iron_ore', 'crystal', 'boar_tusk', 'antler', 'bone', 'pickaxe'], rate: 0.55, haggle: 0.35 },
  mira: { types: ['potion'], ids: ['herb', 'moonpetal', 'slime_gel', 'bat_wing', 'berries'], rate: 0.6, haggle: 0.5 },
  elda: { types: ['food'], rate: 0.5, haggle: 0.45 },
  wenna: { ids: ['honey', 'candle'], rate: 0.5, haggle: 0 },
};

// Wares beyond a profile's own list (the profile's price wins when both name an item).
export const WARES = {
  garrick: [{ id: 'field_boots', price: 34 }, { id: 'traveler_cloak', price: 40 }, { id: 'hearth_charm', price: 30 }, { id: 'candle', price: 5 }],
  bram: [{ id: 'pickaxe', price: 24 }, { id: 'steel_sword', price: 125 }, { id: 'leather_jerkin', price: 50 }, { id: 'iron_mail', price: 145 }],
  mira: [{ id: 'potion', price: 22 }, { id: 'herb', price: 4 }, { id: 'ironbark_tonic', price: 34 }, { id: 'swiftfoot_draught', price: 32 }, { id: 'clearmind_tincture', price: 36 }, { id: 'heartwort_salve', price: 30 }],
  elda: [{ id: 'emberroot_soup', price: 20 }, { id: 'travelers_pie', price: 18 }, { id: 'spiced_cider', price: 14 }],
};

// How many of each they have each morning (the village's own errand stock, game.villageLife
// .stock, is the same stock where it names the item: one stock).
export const DAILY = {
  garrick: { potion: 4, bread: 8, lantern: 2, berries: 6, herb: 6, raw_fish: 4, field_boots: 1, traveler_cloak: 1, hearth_charm: 1, candle: 6 },
  bram: { pickaxe: 3, iron_sword: 2, steel_sword: 1, leather_jerkin: 1, iron_mail: 1 }, // the pickaxe: round 15 (iron needs its tool)
  mira: { potion: 5, herb: 8, ironbark_tonic: 2, swiftfoot_draught: 2, clearmind_tincture: 2, heartwort_salve: 2 },
  elda: { bread: 10, honey_cake: 8, stew: 8, cooked_fish: 6, emberroot_soup: 3, travelers_pie: 3, spiced_cider: 4 },
};

// Their purse each morning, and how much they will pay out for your goods in a day.
export const PURSE = { garrick: 160, bram: 140, mira: 70, elda: 70 };
export const MERCHANTS = ['garrick', 'bram', 'mira', 'elda'];

const LINES = {
  haggleWon: {
    garrick: ['Ha! You drive a bargain like a Saltmere fishwife. Fine, fine. A tenth off, today only.', 'For you, my friend? Robbery. Mine. A tenth, today.'],
    bram: ['Hmph. ...Fine. A tenth. Today.'],
    mira: ['Oh — um. All right. A little off. Sorry. I mean — yes.'],
    elda: ['Oh, go on then, love. A little off, and don\'t tell Garrick.'],
  },
  haggleLost: {
    garrick: ['My friend, my friend. That is the price. It was the price when I was born.'],
    bram: ['No.'],
    mira: ['I — no, sorry, the herbs cost what they cost. Sorry.'],
    elda: ['Price is the price, love. The flour doesn\'t haggle with me.'],
    wenna: ['I don\'t haggle, dear. The bees don\'t.'],
  },
  haggleAgain: ['Once a day, my friend. Come back tomorrow.'],
  stolenRefuse: {
    own: ['That\'s MINE. That came off my shelf. Where did you— get out. Get out of my shop.'],
    kin: ['I know whose that was. I know exactly whose that was. No.'],
    unique: ['There\'s only one of those in the vale, and it isn\'t yours. No.'],
  },
  fence: ['I don\'t ask. Half what it\'s worth, and you were never here.'],
  purse: ['I haven\'t the coin for that today. Come back tomorrow.'],
  soldOut: ['Sold out. Back tomorrow.'],
  notTaste: ['That\'s not something I buy.'],
};

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

const idOf = (npc) => (typeof npc === 'string' ? npc : npc?.profile?.id || npc?.id || null);

function pick(list, n = 0) {
  return Array.isArray(list) && list.length ? list[Math.abs(n) % list.length] : null;
}

// ------------------------------------------------------------------ the tables

export function shopOf(game, npc) {
  const id = idOf(npc);
  const base = (typeof npc === 'object' && npc?.profile?.shop) || profileById(id)?.shop || null;
  const sells = [...(base?.sells || [])].map((s) => ({ id: s.id, price: Number(s.price) || itemDef(s.id)?.value || 1 }));
  for (const w of WARES[id] || []) if (!sells.some((s) => s.id === w.id) && itemDef(w.id)) sells.push({ ...w });
  const buys = { ...(base?.buys || {}) };
  return { sells, buys, buysAll: base?.buysAll || (TASTES[id]?.all ? TASTES[id].rate : 0) };
}

export function isMerchant(npc) {
  const id = idOf(npc);
  if (MERCHANTS.includes(id)) return true;
  const s = (typeof npc === 'object' && npc?.profile?.shop) || null;
  return !!s && (s.sells?.length > 0 || Object.keys(s.buys || {}).length > 0);
}

function sellable(def) {
  return !!def && def.value > 0 && !['quest', 'key', 'currency'].includes(def.type);
}

// Does this merchant buy it at all? (Their own `buys` list, or their taste.)
export function buysIt(game, npc, itemId) {
  const id = idOf(npc);
  const def = itemDef(itemId);
  if (!sellable(def)) return false;
  const shop = shopOf(game, npc);
  if (shop.buys[itemId] != null) return true;
  const t = TASTES[id];
  if (!t) return !!shop.buysAll;
  if (t.all) return true;
  return (t.types || []).includes(def.type) || (t.slots || []).includes(def.slot) || (t.ids || []).includes(itemId);
}

// The lowest base price anyone in the vale asks for an item (for the no-loop cap).
function lowestAsk(game, itemId) {
  let low = Infinity;
  for (const m of MERCHANTS) for (const s of shopOf(game, m).sells) if (s.id === itemId) low = Math.min(low, s.price);
  return low;
}

// How they feel about you, as a band.
export function moodOf(npc) {
  const op = Number(npc?.opinionOfPlayer);
  const fam = Number(npc?.familiarity) || 0;
  if (!Number.isFinite(op)) return 'normal';
  if (op < 15) return 'low';
  if (op < 25) return 'cold';
  if (op >= 75 && fam >= 30) return 'dear';
  if (op >= 60) return 'warm';
  return 'normal';
}

// The price of one item: what you pay them ('buy') or what they pay you ('sell'), or null.
export function priceFor(game, npc, itemId, side = 'buy', { haggled = null, markup = 1 } = {}) {
  const def = itemDef(itemId);
  if (!def) return null;
  const id = idOf(npc);
  const shop = shopOf(game, npc);
  const mood = moodOf(typeof npc === 'object' ? npc : game?.entities?.get?.(id));
  const won = haggled ?? safe(() => game?.trade?.haggled?.(id), false);
  if (side === 'buy') {
    const w = shop.sells.find((s) => s.id === itemId);
    if (!w) return null;
    let p = w.price * MOOD_BUY[mood] * (won ? HAGGLE_BUY : 1) * Math.max(1, markup);
    // Never below the floor that keeps a buy-low, sell-high loop shut.
    p = Math.max(p, w.price * MOOD_BUY.dear * HAGGLE_BUY);
    return Math.max(1, Math.round(p));
  }
  if (!buysIt(game, npc, itemId)) return null;
  const t = TASTES[id];
  const base = shop.buys[itemId] != null ? Number(shop.buys[itemId]) : def.value * (t?.rate ?? shop.buysAll ?? 0.5);
  let p = base * MOOD_SELL[mood] * (won ? HAGGLE_SELL : 1) / Math.max(1, markup);
  const ask = lowestAsk(game, itemId);
  if (Number.isFinite(ask)) p = Math.min(p, ask * MOOD_BUY.dear * HAGGLE_BUY * SELL_CAP);
  if (!(p > 0)) return null;
  return Math.max(1, Math.round(p));
}

// ------------------------------------------------------------------ who will trade (S-19)

function kin(a, b) {
  const pa = profileById(a)?.family;
  const pb = profileById(b)?.family;
  const has = (f, id) => !!f && ['parent', 'child', 'spouse', 'sibling', 'ward'].some((k) => f[k]?.includes(id));
  return has(pa, b) || has(pb, a);
}

function cares(game, a, b) {
  return safe(() => game.villageLife?.care?.(a, b), 0) ?? 0;
}

// One graded rule for every shop (replacing three ad-hoc refusals): kin of someone they know
// you killed refuse; others who know charge a blood price; after the Butcher, all refuse
// but a fence. Only what THIS merchant knows counts (reputation, per knower). A refusal is
// always said, as their line.
export function stance(game, npc) {
  const id = idOf(npc);
  const out = { refuse: false, markup: 1, fence: false, line: null, why: null };
  // A burned store sells nothing (blood's world/occupation.js shopClosed): said as theirs.
  if (id && safe(() => game?.occupation?.shopClosed?.(id), false)) {
    out.refuse = true;
    out.why = 'burned';
    return out;
  }
  const m = game?.murder;
  const rep = game?.reputation;
  const known = [];
  for (const rec of Object.values(m?.dead || {})) {
    if (rec.natural || rec.by !== 'player') continue;
    const knows = typeof rep?.knows === 'function' ? safe(() => rep.knows(rec, id), false) : safe(() => m.knowsKiller(rec, id), false) || m.cases?.[rec.id]?.verdict === 'guilty';
    if (knows) known.push(rec);
  }
  if (known.some((rec) => kin(id, rec.id) || cares(game, id, rec.id) >= 0.6)) {
    out.refuse = true;
    out.why = 'kin';
    return out;
  }
  const butcher = rep ? safe(() => rep.titles({ knownTo: id }).some((t) => t.id === 'butcher'), false) : known.length >= 3;
  if (butcher) {
    if (id === 'garrick') {
      out.fence = true;
      out.markup = 1.5;
      out.line = pick(LINES.fence);
      out.why = 'fence';
      return out;
    }
    out.refuse = true;
    out.why = 'butcher';
    return out;
  }
  // Fresh blood: for the first days after they learn of it, nobody who knows will trade;
  // after that, a blood price (kin never forgive; the Butcher never again).
  const today = Math.max(1, Math.floor(game?.clock?.day ?? 1));
  if (known.some((rec) => today - (rec.day ?? today) < FRESH_DAYS)) {
    out.refuse = true;
    out.why = 'fresh';
    return out;
  }
  if (known.length) {
    out.markup = Math.min(2, 1 + 0.25 * known.length);
    out.why = 'blood_price';
  }
  // A case they believe of, about one of theirs (the old rule).
  for (const c of Object.values(m?.cases || {})) {
    if (c && c.suspicion >= 0.6 && (kin(id, c.about) || cares(game, id, c.about) >= 0.6)) {
      out.refuse = true;
      out.why = 'suspect';
    }
  }
  return out;
}

// ------------------------------------------------------------------ the day's state

export class Trade {
  constructor(game) {
    this.game = game;
    this.day = null;
    this.haggles = {}; // npcId -> { day, won }
    this.stock = {}; // npcId -> { itemId: n } today (beyond the village's errand stock)
    this.paid = {}; // npcId -> coins paid out today
  }

  today() {
    return Math.max(1, Math.floor(this.game?.clock?.day ?? 1));
  }

  // A new morning: fresh stock, purses topped up, haggles forgotten.
  ensureDay() {
    const d = this.today();
    if (this.day === d) return;
    this.day = d;
    this.stock = {};
    for (const [id, goods] of Object.entries(DAILY)) this.stock[id] = { ...goods };
    this.paid = {};
    for (const [id, purse] of Object.entries(PURSE)) {
      const e = this.game?.entities?.get?.(id);
      const inv = e?.inventory;
      if (inv?.count && inv.count('coin') < purse) safe(() => inv.add('coin', purse - inv.count('coin')));
    }
  }

  haggled(id) {
    const h = this.haggles[id];
    return !!h && h.day === this.today() && !!h.won;
  }

  // The village's errand stock names some of the same goods (bread, potions, candles): one stock.
  lifeStock(id) {
    return this.game?.villageLife?.stock?.[id] || null;
  }

  stockLeft(npc, itemId) {
    this.ensureDay();
    const id = idOf(npc);
    const life = this.lifeStock(id);
    if (life && itemId in life) return Math.max(0, life[itemId]);
    const mine = this.stock[id];
    if (mine && itemId in mine) return Math.max(0, mine[itemId]);
    return MERCHANTS.includes(id) ? 0 : Infinity;
  }

  take(id, itemId, n) {
    const life = this.lifeStock(id);
    if (life && itemId in life) life[itemId] = Math.max(0, life[itemId] - n);
    else if (this.stock[id] && itemId in this.stock[id]) this.stock[id][itemId] = Math.max(0, this.stock[id][itemId] - n);
  }

  restock(id, itemId, n) {
    const life = this.lifeStock(id);
    if (life && itemId in life) life[itemId] += n;
    else {
      this.stock[id] = this.stock[id] || {};
      this.stock[id][itemId] = (this.stock[id][itemId] || 0) + n;
    }
  }

  purseOf(npc) {
    const e = typeof npc === 'object' ? npc : this.game?.entities?.get?.(npc);
    return e?.inventory?.count?.('coin') ?? Infinity;
  }

  // The provenance entries a sale of `qty` would take (first in, first out), without taking.
  stolenOf(itemId, qty = 1) {
    const list = safe(() => this.game?.provenance?.of?.(itemId), []) || [];
    const out = [];
    let left = qty;
    for (const e of list) {
      if (left <= 0) break;
      const n = Math.min(left, e.qty ?? 1);
      if (e.owner && e.owner !== 'player') out.push({ ...e, qty: n });
      left -= n;
    }
    return out;
  }

  // Does the merchant know these goods? Their own, kin's or someone they care for, or the
  // only one of its kind: a roll (seeded by the day, the item and who), else they do not.
  recognizes(npc, itemId, entries) {
    const id = idOf(npc);
    const def = itemDef(itemId);
    const unique = !!def?.unique || ['rare', 'epic', 'legendary'].includes(def?.rarity);
    let best = 0;
    let why = null;
    for (const e of entries) {
      let p = 0;
      let w = null;
      if (e.owner === id) [p, w] = [0.85, 'own'];
      else if (kin(id, e.owner) || cares(this.game, id, e.owner) >= 0.6) [p, w] = [0.55, 'kin'];
      else if (unique) [p, w] = [0.35, 'unique'];
      if (p > best) [best, why] = [p, w];
    }
    if (!best) return null;
    const r = hash01(this.game?.seed ?? 1, this.today(), id, itemId, entries.length);
    return r < best ? why : null;
  }

  // ------------------------------------------------------------------ acts

  buy(npc, itemId, qty = 1) {
    this.ensureDay();
    const g = this.game;
    const P = g?.player;
    const id = idOf(npc);
    const st = stance(g, npc);
    if (st.refuse) return { ok: false, reason: 'refuse', why: st.why };
    const left = this.stockLeft(npc, itemId);
    const n = Math.max(1, Math.min(qty, left));
    if (left <= 0) return { ok: false, reason: 'sold_out', line: pick(LINES.soldOut) };
    const price = priceFor(g, npc, itemId, 'buy', { markup: st.markup });
    if (price == null) return { ok: false, reason: 'not_sold' };
    const total = price * n;
    if ((P?.inventory?.count?.('coin') ?? 0) < total) return { ok: false, reason: 'coin', price, total };
    P.inventory.remove('coin', total);
    P.inventory.add(itemId, n);
    safe(() => (typeof npc === 'object' ? npc : g.entities.get(id))?.inventory?.add?.('coin', total));
    // The village's errand stock is drawn down by its own trade listener (onTrade); ours here.
    if (!(this.lifeStock(id) && itemId in this.lifeStock(id))) this.take(id, itemId, n);
    safe(() => g.bus?.emit?.('item_gained', { actor: P, itemId, qty: n, from: 'trade' }));
    safe(() => g.bus?.emit?.('trade', { npc: typeof npc === 'object' ? npc : g.entities.get(id), itemId, qty: n, price: total, bought: true }));
    return { ok: true, qty: n, total, price };
  }

  sell(npc, itemId, qty = 1) {
    this.ensureDay();
    const g = this.game;
    const P = g?.player;
    const id = idOf(npc);
    const e = typeof npc === 'object' ? npc : g?.entities?.get?.(id);
    const st = stance(g, npc);
    if (st.refuse) return { ok: false, reason: 'refuse', why: st.why };
    const have = P?.inventory?.count?.(itemId) ?? 0;
    const n = Math.max(0, Math.min(qty, have));
    if (!n) return { ok: false, reason: 'none' };
    let price = priceFor(g, npc, itemId, 'sell', { markup: st.markup });
    if (price == null) return { ok: false, reason: 'taste', line: pick(LINES.notTaste) };
    // Stolen goods (the provenance ledger): someone who knows whose they were may know them.
    const stolen = this.stolenOf(itemId, n);
    let fenced = false;
    if (stolen.length) {
      const seen = this.recognizes(npc, itemId, stolen);
      const fence = id === 'garrick' && (st.fence || (Number(e?.opinionOfPlayer) || 0) >= 60) && seen !== 'own';
      if (seen && !fence) return this.caught(e, itemId, stolen, seen);
      if (fence) {
        fenced = true;
        price = Math.max(1, Math.round(price * 0.5));
      }
    }
    const total = price * n;
    if (this.purseOf(e) < total) return { ok: false, reason: 'purse', line: pick(LINES.purse) };
    // The ledger first (the shop takes what leaves), then the pack.
    safe(() => g.provenance?.take?.(itemId, n));
    const got = P.inventory.remove(itemId, n);
    if (!got) return { ok: false, reason: 'none' };
    safe(() => e?.inventory?.remove?.('coin', total));
    P.inventory.add('coin', total);
    this.paid[id] = (this.paid[id] || 0) + total;
    this.restock(id, itemId, got);
    safe(() => g.bus?.emit?.('item_gained', { actor: P, itemId: 'coin', qty: total, from: 'trade' }));
    safe(() => g.bus?.emit?.('trade', { npc: e, itemId, qty: got, price: total, bought: false, stolen: stolen.length > 0, fenced }));
    return { ok: true, qty: got, total, price, fenced, line: fenced ? pick(LINES.fence) : null };
  }

  // Caught selling what they know was taken: refused, colder, and the village hears it.
  caught(e, itemId, stolen, seen) {
    const g = this.game;
    const id = idOf(e);
    safe(() => e?.adjustOpinion?.(-8, 'tried to sell them stolen goods'));
    const owner = stolen[0]?.owner;
    safe(() => g.village?.addRumor?.('stole', { victim: owner && VILLAGERS.includes(owner) ? owner : null, witnesses: [id], saw: [id], source: id }));
    safe(() => g.bus?.emit?.('theft_recognized', { npc: e, by: id, itemId, owner, how: seen }));
    return { ok: false, reason: 'stolen', seen, line: pick(LINES.stolenRefuse[seen]) || pick(LINES.stolenRefuse.unique) };
  }

  // Once a day each: their mood and their nature decide.
  haggle(npc) {
    this.ensureDay();
    const id = idOf(npc);
    const e = typeof npc === 'object' ? npc : this.game?.entities?.get?.(id);
    const day = this.today();
    const h = this.haggles[id];
    if (h && h.day === day) return { won: !!h.won, again: true, line: pick(LINES.haggleAgain) };
    const base = TASTES[id]?.haggle ?? 0.3;
    const op = Number(e?.opinionOfPlayer);
    const p = base <= 0 ? 0 : Math.max(0.05, Math.min(0.95, base + ((Number.isFinite(op) ? op : 50) - 50) / 200));
    const won = hash01(this.game?.seed ?? 1, day, id, 'haggle') < p;
    this.haggles[id] = { day, won };
    return { won, line: pick(won ? LINES.haggleWon[id] : LINES.haggleLost[id]) || (won ? 'Fine. A little off, today.' : 'No.') };
  }

  serialize() {
    return { v: 1, day: this.day, haggles: { ...this.haggles }, stock: JSON.parse(JSON.stringify(this.stock)), paid: { ...this.paid } };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
    this.day = Number.isFinite(d.day) ? d.day : null;
    this.haggles = obj(d.haggles);
    this.stock = obj(d.stock);
    this.paid = obj(d.paid);
  }
}

function hash01(...parts) {
  let h = 2166136261;
  const s = parts.map(String).join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export const tradePlugin = {
  id: 'trade',
  name: 'The shops',
  description: 'Buy and sell at the merchants: tastes, stock, haggling, stolen goods (DESIGN §36.2).',
  install(ctx) {
    const g = ctx.game;
    if (!g) return;
    if (!(g.trade instanceof Trade)) g.trade = new Trade(g);
    if (this._pending !== undefined) {
      g.trade.deserialize(this._pending);
      this._pending = undefined;
    }
  },
  onEvent(type, p, ctx) {
    if (type === 'new_day') safe(() => ctx.game?.trade?.ensureDay?.());
  },
  serialize(ctx) {
    return ctx.game?.trade?.serialize?.() ?? null;
  },
  deserialize(d, ctx) {
    if (ctx.game?.trade) ctx.game.trade.deserialize(d);
    else this._pending = d;
  },
};
