// Where the stranger's things came from (round 14b, DESIGN §35.4 and §36.2): the one
// stolen-goods ledger that looting the dead (V-9), forcing chests and the shop (S-17)
// share. `game.provenance`, installed as a plugin and saved with the plugins.
//
//   add(itemId, qty, { owner, how, day, seenBy })   goods the player took that were not theirs:
//        owner  the id of the one they belonged to (a villager, 'lyra', or null if unknown)
//        how    'chest' (opened a chest that was not theirs) | 'forced' (broke its lock) |
//               'body' (searched the dead) | any other word a workstream adds
//        day    the in-game day it was taken (defaults to today)
//        seenBy ids who SAW it taken (by the sight rule, src/ai/sight.js / murder/witness.js;
//               never a bare distance): theft is a crime only if seen (decision D10)
//   take(itemId, qty)    first in, first out: removes up to qty from the ledger and returns
//                        the entries taken (each { itemId, qty, owner, how, day, seenBy })
//   of(itemId)           the ledger's entries for that item, oldest first (copies)
//   qtyOf(itemId)        how many of that item the ledger holds
//   all()                every entry (copies)
//   settle(itemId?)      the ledger never holds more than the player carries: any excess
//                        is taken (FIFO) after the player's inventory loses items
//   serialize() / deserialize(d)   old saves start empty
//
// The player's inventory reports every removal (lost, eaten, given, sold, fined) to
// settle(), so goods that left the pack leave the ledger too. A caller that must know WHICH
// entries leave (the shop selling a stolen ring to someone who knows its owner) calls
// take() before it removes the item; settle() then finds nothing left over.
// Bus events out: provenance_added { itemId, qty, owner, how, seenBy }, provenance_taken
// { itemId, entries }.

const HOWS = new Set(['chest', 'forced', 'body']);

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function clean(e) {
  if (!e || typeof e !== 'object' || typeof e.itemId !== 'string') return null;
  const qty = Math.floor(Number(e.qty));
  if (!(qty > 0)) return null;
  return {
    itemId: e.itemId,
    qty,
    owner: typeof e.owner === 'string' ? e.owner : null,
    how: typeof e.how === 'string' ? e.how : 'chest',
    day: Number.isFinite(e.day) ? e.day : 1,
    seenBy: Array.isArray(e.seenBy) ? e.seenBy.filter((s) => typeof s === 'string') : [],
  };
}

export class Provenance {
  constructor(game) {
    this.game = game;
    this.entries = []; // oldest first
    this._inv = null;
    this._remove = null;
  }

  day() {
    return Math.max(1, Math.floor(this.game?.clock?.day ?? 1));
  }

  add(itemId, qty = 1, { owner = null, how = 'chest', day = null, seenBy = [] } = {}) {
    const n = Math.floor(Number(qty));
    if (!itemId || !(n > 0)) return null;
    const e = clean({ itemId: String(itemId), qty: n, owner, how: how || 'chest', day: Number.isFinite(day) ? day : this.day(), seenBy });
    if (!e) return null;
    if (!HOWS.has(e.how)) e.how = String(how);
    this.entries.push(e);
    safe(() => this.game?.bus?.emit?.('provenance_added', { itemId: e.itemId, qty: e.qty, owner: e.owner, how: e.how, seenBy: [...e.seenBy] }));
    return { ...e, seenBy: [...e.seenBy] };
  }

  take(itemId, qty = 1) {
    let left = Math.floor(Number(qty));
    const out = [];
    if (!itemId || !(left > 0)) return out;
    for (let i = 0; i < this.entries.length && left > 0; ) {
      const e = this.entries[i];
      if (e.itemId !== itemId) {
        i++;
        continue;
      }
      const n = Math.min(e.qty, left);
      out.push({ ...e, qty: n, seenBy: [...e.seenBy] });
      e.qty -= n;
      left -= n;
      if (e.qty <= 0) this.entries.splice(i, 1);
      else i++;
    }
    if (out.length) safe(() => this.game?.bus?.emit?.('provenance_taken', { itemId, entries: out.map((e) => ({ ...e })) }));
    return out;
  }

  of(itemId) {
    return this.entries.filter((e) => e.itemId === itemId).map((e) => ({ ...e, seenBy: [...e.seenBy] }));
  }

  qtyOf(itemId) {
    let n = 0;
    for (const e of this.entries) if (e.itemId === itemId) n += e.qty;
    return n;
  }

  all() {
    return this.entries.map((e) => ({ ...e, seenBy: [...e.seenBy] }));
  }

  // The ledger never claims more than the player carries.
  settle(itemId = null) {
    const inv = this.game?.player?.inventory;
    if (!inv?.count) return [];
    const ids = itemId ? [itemId] : [...new Set(this.entries.map((e) => e.itemId))];
    const out = [];
    for (const id of ids) {
      const excess = this.qtyOf(id) - inv.count(id);
      if (excess > 0) out.push(...this.take(id, excess));
    }
    return out;
  }

  // Every removal from the player's pack settles the ledger (installed once per inventory).
  watch(inv = this.game?.player?.inventory) {
    if (!inv || typeof inv.remove !== 'function' || inv._provenanceWatch) return false;
    const orig = inv.remove;
    const self = this;
    inv.remove = function removeAndSettle(id, qty = 1) {
      const n = orig.call(this, id, qty);
      if (n > 0 && self.entries.length) safe(() => self.settle(id));
      return n;
    };
    inv._provenanceWatch = true;
    this._inv = inv;
    return true;
  }

  serialize() {
    return { v: 1, entries: this.all() };
  }

  deserialize(d) {
    this.entries = [];
    const list = Array.isArray(d?.entries) ? d.entries : [];
    for (const raw of list) {
      const e = clean(raw);
      if (e) this.entries.push(e);
    }
    safe(() => this.settle());
  }
}

export const provenancePlugin = {
  id: 'provenance',
  name: 'Provenance',
  description: "Where the stranger's goods came from: stolen from chests, forced, taken from the dead.",
  install(ctx) {
    const g = ctx.game;
    if (!g) return;
    if (!(g.provenance instanceof Provenance)) g.provenance = new Provenance(g);
    g.provenance.watch();
    if (this._pending !== undefined) {
      g.provenance.deserialize(this._pending);
      this._pending = undefined;
    }
  },
  serialize(ctx) {
    return ctx.game?.provenance?.serialize?.() ?? null;
  },
  deserialize(d, ctx) {
    if (ctx.game?.provenance) ctx.game.provenance.deserialize(d);
    else this._pending = d;
  },
};
