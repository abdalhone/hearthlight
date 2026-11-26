import { NPC_PROFILES } from '../entities/npc_data.js';
import { MORE_PROFILES } from '../entities/npc_data_more.js';

// People grow older (DESIGN §32.10; the author: "make people age as well"). Hearthvale's
// year is short for play: YEAR_DAYS days. Everyone has a birthday somewhere in it (their
// own day, fixed by their name), and on it they turn a year older: their age is what
// everything that speaks of them reads (profiles, Claude's prompts, the Book), Lyra's too,
// and the village hears of it. Children grow up with the rest (Pip is nine on the first
// morning); the stranger does not know their own age, so has no birthday.
//
// game.calendar = new Calendar(game); calendarPlugin saves it with the plugins.
//   year()            0 on the first morning, then 1, 2... as the years go round
//   ageOf(id)         a person's age today
//   birthdayOf(id)    the day of the year (1..YEAR_DAYS) they were born on
//   isBirthday(id)    is it today?
// Bus events out: birthday { id, name, age, day }.

export const YEAR_DAYS = 12;

// Base ages at the first morning (read once, before anything has grown older).
const BASE = new Map();
for (const p of [...NPC_PROFILES, ...MORE_PROFILES]) if (Number.isFinite(p.age)) BASE.set(p.id, p.age);
const LYRA_BASE = 24;

function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function birthdayOf(id) {
  return (hashId(String(id)) % YEAR_DAYS) + 1;
}

// How many birthdays a person has had by `day` (day 1 is the first morning).
export function birthdaysBy(id, day) {
  const first = firstBirthday(id);
  if (day < first) return 0;
  return Math.floor((day - first) / YEAR_DAYS) + 1;
}

// The first day (after the first morning) that is their birthday.
export function firstBirthday(id) {
  const b = birthdayOf(id);
  return b === 1 ? 1 + YEAR_DAYS : b;
}

export function baseAge(id) {
  return id === 'lyra' ? LYRA_BASE : BASE.get(id) ?? null;
}

export class Calendar {
  constructor(game) {
    this.game = game;
    this.lastDay = null;
    this.celebrated = {}; // id -> last day their birthday was marked
  }

  day() {
    return Math.max(1, Math.floor(this.game.clock?.day ?? 1));
  }

  year() {
    return Math.floor((this.day() - 1) / YEAR_DAYS);
  }

  ageOf(id) {
    const b = baseAge(id);
    return b == null ? null : b + birthdaysBy(id, this.day());
  }

  isBirthday(id) {
    return (((this.day() - 1) % YEAR_DAYS) + 1) === birthdayOf(id) && this.day() > 1;
  }

  // Everyone's age as of today, written where people read it.
  apply() {
    const g = this.game;
    for (const e of g.entities?.all?.() || g.entities?.list || []) {
      const p = e.profile;
      if (!p || !BASE.has(p.id)) continue;
      p.age = this.ageOf(p.id);
    }
    // The profiles of people not standing in the world (yet) grow older too.
    for (const p of [...NPC_PROFILES, ...MORE_PROFILES]) if (BASE.has(p.id)) p.age = this.ageOf(p.id);
    // Lyra herself (game.lyra), not whoever is your companion now (round 14b).
    const lyra = g.lyra || g.entities?.get?.('lyra') || g.companion;
    const soul = lyra?.mind?.soul;
    if (soul && typeof soul === 'object' && 'age' in soul) soul.age = this.ageOf('lyra');
  }

  update() {
    const day = this.day();
    if (day === this.lastDay) return;
    const first = this.lastDay == null;
    this.lastDay = day;
    this.apply();
    if (first) return;
    for (const id of [...BASE.keys(), 'lyra']) {
      if (!this.isBirthday(id) || this.celebrated[id] === day) continue;
      this.celebrated[id] = day;
      const name = id === 'lyra' ? 'Lyra' : nameOf(this.game, id);
      const age = this.ageOf(id);
      this.game.bus?.emit?.('birthday', { id, name, age, day });
      try {
        this.game.ui?.toast?.(`${name}'s birthday today: ${age}.`, 'info');
      } catch {
        /* ui optional */
      }
    }
  }

  serialize() {
    return { celebrated: { ...this.celebrated } };
  }

  deserialize(d) {
    if (d?.celebrated && typeof d.celebrated === 'object') this.celebrated = { ...d.celebrated };
    this.lastDay = null; // apply ages for the loaded day on the next update
  }

  promptContext() {
    const y = this.year();
    const out = [`Hearthvale's year turns every ${YEAR_DAYS} days; people age a year on their birthdays.`];
    if (y > 0) out.push(`${y} year${y > 1 ? 's have' : ' has'} passed since the stranger woke.`);
    const today = [...BASE.keys(), 'lyra'].filter((id) => this.isBirthday(id));
    if (today.length) out.push(`Birthdays today: ${today.map((id) => `${id === 'lyra' ? 'Lyra' : nameOf(this.game, id)} (${this.ageOf(id)})`).join(', ')}.`);
    return out.join(' ');
  }
}

function nameOf(game, id) {
  const e = game.entities?.get?.(id);
  const p = e?.profile || [...NPC_PROFILES, ...MORE_PROFILES].find((q) => q.id === id);
  return (p?.name || id).split(' ')[0];
}

export const calendarPlugin = {
  id: 'calendar',
  name: 'Calendar',
  description: 'The year goes round: birthdays, and everyone a year older.',
  install(ctx) {
    const g = ctx.game;
    if (!g) return;
    if (!(g.calendar instanceof Calendar)) g.calendar = new Calendar(g);
    if (this._pending !== undefined) {
      g.calendar.deserialize(this._pending);
      this._pending = undefined;
    }
  },
  update(dt, ctx) {
    ctx.game?.calendar?.update();
  },
  serialize(ctx) {
    return ctx.game?.calendar?.serialize() ?? null;
  },
  deserialize(d, ctx) {
    if (ctx.game?.calendar) ctx.game.calendar.deserialize(d);
    else this._pending = d;
  },
  promptContext(ctx) {
    return ctx.game?.calendar?.promptContext?.() || '';
  },
};
