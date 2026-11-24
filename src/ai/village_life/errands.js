// Each villager's errands for the day (DESIGN §28): planned every morning from
// errands_data.js, with variety (a different handful each day, seeded by the day so a
// day replays the same), and completed for real: goods and coin change hands, the
// village's stock goes down, and the two of them know each other a little better.

import { ERRANDS_BY_WHO, STOCK, MORNING_GOODS, isSunday, errandTemplate } from './errands_data.js';
import { entryAt } from '../../entities/npc_schedule.js';

// A small seeded generator (mulberry32): the same day plans the same errands.
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const NO_ERRANDS_DURING = new Set(['sleep', 'lamps']);

// Is `who` doing something they can step away from at `hour`?
export function freeAt(profile, hour) {
  const e = entryAt(profile?.schedule, hour);
  return !e || !NO_ERRANDS_DURING.has(e.activity);
}

// Where someone's day puts them at an hour (their habit: what everyone in a village knows).
export function habitAt(profile, hour) {
  const e = entryAt(profile?.schedule, hour);
  return e ? { at: e.at, activity: e.activity, doing: e.doing || null } : null;
}

export class ErrandBook {
  constructor(life) {
    this.life = life;
    this.day = null;
    this.list = []; // today's errand instances, by start time
    this.seq = 0;
  }

  // Plan the day for everyone present. fromHour: errands whose window has passed are not planned.
  plan(day, { fromHour = 0, profiles = null, isAbsent = () => false, seed = 20261123 } = {}) {
    this.day = day;
    this.list = [];
    const sunday = isSunday(day);
    for (const p of profiles || []) {
      if (!p?.id || isAbsent(p.id)) continue;
      const rand = seeded(hashStr(`${seed}:${day}:${p.id}`));
      let pool = (ERRANDS_BY_WHO[p.id] || []).filter((e) => (e.days === 'sunday' ? sunday : true) && e.window[1] > fromHour + 0.3);
      if (!pool.length) continue;
      // Sunday's own errands come first that day.
      const must = pool.filter((e) => e.days === 'sunday');
      pool = pool.filter((e) => e.days !== 'sunday');
      const r = rand();
      let want = pool.length + must.length >= 3 && r < 0.25 ? 3 : pool.length + must.length >= 2 && r < 0.88 ? 2 : 1;
      const chosen = [...must];
      while (chosen.length < want && pool.length) {
        let sum = 0;
        for (const e of pool) sum += e.weight || 1;
        let x = rand() * sum;
        let k = pool.length - 1;
        for (let i = 0; i < pool.length; i++) {
          x -= pool[i].weight || 1;
          if (x <= 0) {
            k = i;
            break;
          }
        }
        const e = pool.splice(k, 1)[0];
        // Two errands of one person do not overlap.
        if (chosen.some((c) => c.window[0] < e.window[1] + 0.3 && e.window[0] < c.window[1] + 0.3)) {
          if (!pool.length) want = chosen.length;
          continue;
        }
        chosen.push(e);
      }
      for (const tpl of chosen) {
        const lo = Math.max(tpl.window[0], fromHour + 0.05);
        const span = Math.max(0, tpl.window[1] - lo - 0.35);
        let start = lo + rand() * span;
        // A start the villager cannot leave for (asleep, on the lamp-round): the window's next free moment.
        for (let k = 0; k < 8 && !freeAt(p, start) && start < tpl.window[1]; k++) start += 0.15;
        this.list.push(this.instance(tpl, p.id, start, tpl.window[1]));
      }
    }
    this.list.sort((a, b) => a.start - b.start);
    return this.list;
  }

  instance(tpl, who, start, end) {
    return {
      id: `e${++this.seq}`,
      tpl: tpl.id,
      who,
      to: tpl.to || null,
      at: tpl.at,
      kind: tpl.kind,
      goods: tpl.goods || '',
      item: tpl.item || null,
      qty: tpl.qty || 1,
      price: tpl.price || 0,
      purpose: tpl.purpose || '',
      label: tpl.label || '',
      care: tpl.care ?? 0.5,
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
      state: 'planned', // planned | active | done | failed | given_up | skipped
      tries: 0,
      problem: null,
      result: '',
      t0: null,
      t1: null,
    };
  }

  // Add a follow-up errand (Tilly brings the ore back to Bram) or a retry.
  add(tplId, who, startHour, endHour = 24) {
    const tpl = errandTemplate(tplId);
    if (!tpl) return null;
    const inst = this.instance(tpl, who, startHour, Math.min(24, endHour));
    this.list.push(inst);
    this.list.sort((a, b) => a.start - b.start);
    return inst;
  }

  forWho(id) {
    return this.list.filter((e) => e.who === id);
  }

  // The errand that should start now for this villager, if any.
  due(id, hour) {
    for (const e of this.list) {
      if (e.who !== id || e.state !== 'planned') continue;
      if (hour >= e.end) {
        e.state = 'skipped';
        e.result = 'ran out of time';
        continue;
      }
      if (hour >= e.start) return e;
    }
    return null;
  }

  active(id) {
    return this.list.find((e) => e.who === id && e.state === 'active') || null;
  }

  get(id) {
    return this.list.find((e) => e.id === id) || null;
  }

  // Errands that need this person today and have not been done.
  needing(personId) {
    return this.list.filter((e) => e.to === personId && (e.state === 'planned' || e.state === 'active'));
  }

  serialize() {
    return { day: this.day, seq: this.seq, list: this.list.map((e) => ({ ...e })) };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    this.day = Number.isFinite(d.day) ? d.day : null;
    this.seq = Number.isFinite(d.seq) ? d.seq : 0;
    this.list = Array.isArray(d.list)
      ? d.list
          .filter((e) => e && typeof e.who === 'string' && typeof e.tpl === 'string')
          .map((e) => ({ ...e, state: e.state === 'active' ? 'planned' : e.state }))
      : [];
  }
}

// ------------------------------------------------------------------ stock and goods

export function freshStock() {
  const out = {};
  for (const [who, goods] of Object.entries(STOCK)) out[who] = { ...goods };
  return out;
}

// Morning: producers have their goods in hand and everyone a little coin for the day.
export function seedMorningGoods(game, ids) {
  for (const id of ids) {
    const e = game?.entities?.get?.(id);
    const inv = e?.inventory;
    if (!inv?.add) continue;
    const goods = MORNING_GOODS[id] || {};
    for (const [item, n] of Object.entries(goods)) if (inv.count(item) < n) inv.add(item, n - inv.count(item));
    if (inv.count('coin') < 20) inv.add('coin', 20 - inv.count('coin'));
  }
}

function stockKey(inst) {
  return inst.item || inst.goods;
}

// Is what the errand needs still to be had? (A seller with none left: "the item is gone".)
export function inStock(stock, inst) {
  if (inst.kind !== 'buy') return true;
  const s = stock[inst.to];
  if (!s) return true;
  const k = stockKey(inst);
  if (!(k in s)) return true;
  return s[k] >= (inst.qty || 1);
}

// What happened, in the past tense ("Hobb bought wick from Garrick.").
export function describeErrand(life, inst) {
  const name = (id) => life.name(id);
  const goods = inst.goods || 'something';
  switch (inst.kind) {
    case 'buy':
      return `${name(inst.who)} bought ${goods} from ${name(inst.to)}.`;
    case 'sell':
      return `${name(inst.who)} sold ${name(inst.to)} ${goods}.`;
    case 'collect':
      return `${name(inst.who)} collected ${goods} from ${name(inst.to)}.`;
    case 'deliver':
      return `${name(inst.who)} brought ${name(inst.to)} ${goods}.`;
    case 'fetch':
      return `${name(inst.who)} fetched ${goods} from ${life.placeName(inst.at)}.`;
    case 'task':
      return `${name(inst.who)} saw to ${goods}.`;
    default:
      return `${name(inst.who)} called on ${name(inst.to)} about ${goods}.`;
  }
}

// The errand done: goods, coin, stock and the bond between the two. Returns a short
// account ("Hobb bought wick from Garrick.") for the village log.
export function applyEffects(life, inst) {
  const g = life.game;
  const who = g?.entities?.get?.(inst.who) || null;
  const to = inst.to ? g?.entities?.get?.(inst.to) || null : null;
  const name = (id) => life.name(id);
  const moveItem = (from, dest, item, qty) => {
    if (!item || !from?.inventory || !dest?.inventory) return 0;
    return from.inventory.transfer(dest.inventory, item, qty);
  };
  const pay = (from, dest, amount) => {
    if (!amount || !from?.inventory || !dest?.inventory) return 0;
    return from.inventory.transfer(dest.inventory, 'coin', amount);
  };
  let text = '';
  const goods = inst.goods || 'something';
  switch (inst.kind) {
    case 'buy': {
      const s = life.stock[inst.to];
      const k = stockKey(inst);
      if (s && k in s) s[k] = Math.max(0, s[k] - (inst.qty || 1));
      if (inst.item && moveItem(to, who, inst.item, inst.qty) === 0 && who?.inventory) who.inventory.add(inst.item, inst.qty);
      pay(who, to, inst.price);
      text = `${name(inst.who)} bought ${goods} from ${name(inst.to)}.`;
      break;
    }
    case 'sell': {
      const s = life.stock[inst.to];
      if (inst.item && s && inst.item in s) s[inst.item] += inst.qty || 1;
      if (inst.item) moveItem(who, to, inst.item, inst.qty);
      pay(to, who, inst.price);
      text = `${name(inst.who)} sold ${name(inst.to)} ${goods}.`;
      break;
    }
    case 'collect':
      pay(to, who, inst.price);
      text = `${name(inst.who)} collected ${goods} from ${name(inst.to)}.`;
      break;
    case 'deliver':
      if (inst.item) moveItem(who, to, inst.item, inst.qty);
      text = `${name(inst.who)} brought ${name(inst.to)} ${goods}.`;
      break;
    case 'fetch':
      if (inst.item && who?.inventory) who.inventory.add(inst.item, inst.qty || 1);
      text = `${name(inst.who)} fetched ${goods} from ${life.placeName(inst.at)}.`;
      break;
    case 'task':
      text = `${name(inst.who)} saw to ${goods}.`;
      break;
    default:
      text = `${name(inst.who)} called on ${name(inst.to)} about ${goods}.`;
  }
  if (inst.to && life.village?.adjustBond) {
    try {
      life.village.adjustBond(inst.who, inst.to, { affinity: 0.6, familiarity: 1, trust: 0.3 }, `errand: ${inst.tpl}`);
      life.village.adjustBond(inst.to, inst.who, { affinity: 0.4, familiarity: 1, trust: 0.2 }, `errand: ${inst.tpl}`);
    } catch {
      /* bonds are another module's: never let them stop an errand */
    }
  }
  return text;
}
