import { NPC_PROFILES } from '../entities/npc_data.js';
import { MORE_PROFILES } from '../entities/npc_data_more.js';
import { RUMOR_KINDS } from '../ai/social/rumors.js';
import { CHILDREN } from '../ai/village_life/errands_data.js';
import { applyAgeLooks } from '../art/age_look.js';

// People grow older (DESIGN §32.10, §36.3; the author: "make people age as well").
// Hearthvale's year is short for play: `yearDays` days (Settings → Game → "A year lasts":
// 12 / 24 / 48 / 96; 12 by default). Day 1 is early autumn (LORE §1: the stranger woke
// three months after midsummer); the year runs autumn, winter, spring, summer, each in an
// early, a middle and a late part. Everyone has a birthday somewhere in the year (their own
// day, fixed by their name; Lyra's at midsummer, as LORE §7 has it), and on it they turn a
// year older: their age is what everything that speaks of them reads (profiles, Claude's
// prompts, the Book, people.js's isMinor), Lyra's too, and the village hears of it. Children
// grow up with the rest (Pip is nine on the first morning; Tansy is sixteen within the year,
// and from that day an adult to every system). The dead stop growing older. The stranger
// does not know their own age: Petra reckons it (about five-and-twenty), with the morning
// they woke as their birthday.
//
// game.calendar = new Calendar(game); calendarPlugin saves it with the plugins.
//   year()              0 in the first year, then 1, 2... (yearLabel() is 1-based)
//   yearDays()          the pace: days in a year (the setting)
//   season(day?)        { index 0..3, name: autumn|winter|spring|summer, part: early|mid|late }
//   seasonName(day?)    'early autumn', 'midwinter', 'late spring'...
//   dateLabel()         'Day 9, late autumn, year 1' (party's HUD clock and People read it)
//   briefLine(id)       one line for that person's Claude prompt: the date, their age, a
//                       birthday (talk's prompts read it, feature-detected)
//   ageOf(id)           a person's age today ('player': Petra's reckoning)
//   birthdayOf(id)      the day of the year (1..yearDays) they were born on
//   isBirthday(id)      is it today?
//
// Ages stay steady when the pace changes: each person's age is kept from an anchor
// ({ age, day }: the first morning, else the day the pace last changed), and only
// birthdays after the anchor are counted at the pace of now. Saved: { celebrated,
// yearDays, anchors, player }. An old save (only `celebrated`) reads at the old pace.
// Bus events out: birthday { id, name, age, day, adult? }.

export const YEAR_DAYS = 12;
export const YEAR_CHOICES = [12, 24, 48, 96];
export const SEASONS = ['autumn', 'winter', 'spring', 'summer'];
const PART = ['early', 'mid', 'late'];
const MINOR_UNDER = 16; // people.js's cut-off (kept here as a number so the calendar stays pure)

// Base ages at the first morning (read once, before anything has grown older).
const BASE = new Map();
for (const p of [...NPC_PROFILES, ...MORE_PROFILES]) if (Number.isFinite(p.age)) BASE.set(p.id, p.age);
const LYRA_BASE = 24;
export const PLAYER_GUESS = 25;
// The village's errands ask "a child?" by the profiles' ages, which apply() keeps current.
CHILDREN.ageOf = (id) => {
  const p = [...NPC_PROFILES, ...MORE_PROFILES].find((q) => q.id === id);
  return Number.isFinite(p?.age) ? p.age : null;
}; // Petra's reckoning of the stranger ("five-and-twenty, near enough")

// A birthday is news: those close to them hear it (and it travels by meeting, as all news does).
if (!RUMOR_KINDS.birthday) RUMOR_KINDS.birthday = { text: "it was {v}'s birthday", you: "it was {v}'s birthday", valence: 0.1, severity: 0.15, about: 'village' };

function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function paceOf(y) {
  const n = Math.floor(Number(y));
  return YEAR_CHOICES.includes(n) ? n : YEAR_DAYS;
}

// Midsummer: the middle of the year's last season.
export function midsummer(yearDays = YEAR_DAYS) {
  const Y = paceOf(yearDays);
  return Math.floor((Y * 7) / 8) + 1;
}

export function birthdayOf(id, yearDays = YEAR_DAYS) {
  const Y = paceOf(yearDays);
  if (id === 'lyra') return midsummer(Y);
  return (hashId(String(id)) % Y) + 1;
}

export function dayOfYear(day, yearDays = YEAR_DAYS) {
  const Y = paceOf(yearDays);
  return ((Math.max(1, Math.floor(day)) - 1) % Y) + 1;
}

// Birthdays strictly after day `from`, up to and including day `to`.
export function birthdaysBetween(id, from, to, yearDays = YEAR_DAYS, bday = null) {
  const Y = paceOf(yearDays);
  const b = bday ?? birthdayOf(id, Y);
  if (!(to > from)) return 0;
  const doy = dayOfYear(from + 1, Y);
  const first = from + 1 + ((b - doy + Y) % Y);
  if (to < first) return 0;
  return Math.floor((to - first) / Y) + 1;
}

// How many birthdays a person has had by `day` (day 1 is the first morning).
export function birthdaysBy(id, day, yearDays = YEAR_DAYS) {
  return birthdaysBetween(id, 1, day, yearDays);
}

// The first day (after the first morning) that is their birthday.
export function firstBirthday(id, yearDays = YEAR_DAYS) {
  const Y = paceOf(yearDays);
  const b = birthdayOf(id, Y);
  return b === 1 ? 1 + Y : b;
}

export function baseAge(id) {
  return id === 'lyra' ? LYRA_BASE : BASE.get(id) ?? null;
}

export function seasonOf(day, yearDays = YEAR_DAYS) {
  const Y = paceOf(yearDays);
  const d = dayOfYear(day, Y) - 1; // 0..Y-1
  const per = Y / 4;
  const index = Math.min(3, Math.floor(d / per));
  const within = (d - index * per) / per;
  const part = PART[Math.min(2, Math.floor(within * 3))];
  return { index, name: SEASONS[index], part };
}

export function seasonLabel(s) {
  if (!s) return '';
  if (s.part === 'mid') return s.name === 'winter' || s.name === 'summer' ? `mid${s.name}` : `mid-${s.name}`;
  return `${s.part} ${s.name}`;
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
export function ageWords(n) {
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (n < 20) return WORDS[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${WORDS[n % 10]}` : '');
  return String(n);
}

export class Calendar {
  constructor(game) {
    this.game = game;
    this.lastDay = null;
    this.celebrated = {}; // id -> last day their birthday was marked
    this.pace = null; // the pace the ages were last counted at (null: the setting, unchanged)
    this.anchors = {}; // id -> { age, day }: their age on that day (set when the pace changes)
    this.player = null; // { age, day, by }: Petra's reckoning, the morning they woke
  }

  day() {
    return Math.max(1, Math.floor(this.game.clock?.day ?? 1));
  }

  yearDays() {
    return paceOf(this.pace ?? this.game?.settings?.yearDays ?? YEAR_DAYS);
  }

  year() {
    return Math.floor((this.day() - 1) / this.yearDays());
  }

  yearLabel() {
    return this.year() + 1;
  }

  season(day = this.day()) {
    return seasonOf(day, this.yearDays());
  }

  seasonName(day = this.day()) {
    return seasonLabel(this.season(day));
  }

  dateLabel() {
    return `Day ${this.day()}, ${this.seasonName()}, year ${this.yearLabel()}`;
  }

  birthdayOf(id) {
    if (id === 'player') return this.player ? dayOfYear(this.player.day, this.yearDays()) : null;
    return birthdayOf(id, this.yearDays());
  }

  // The day a death froze their age (the dead stop growing older), else null.
  deathDay(id) {
    const rec = this.game?.murder?.dead?.[id];
    if (rec && Number.isFinite(rec.day)) return rec.day;
    return null;
  }

  ageOf(id, day = this.day()) {
    const Y = this.yearDays();
    const dd = this.deathDay(id);
    const upTo = dd != null ? Math.min(day, dd) : day;
    if (id === 'player') {
      const p = this.player;
      if (!p) return null;
      return p.age + birthdaysBetween('player', p.day, upTo, Y, dayOfYear(p.day, Y));
    }
    const a = this.anchors[id];
    if (a && Number.isFinite(a.age)) return a.age + birthdaysBetween(id, a.day, upTo, Y);
    const b = baseAge(id);
    return b == null ? null : b + birthdaysBetween(id, 1, upTo, Y);
  }

  isBirthday(id) {
    const b = this.birthdayOf(id);
    if (b == null) return false;
    if (id === 'player') return this.day() > (this.player?.day ?? Infinity) && dayOfYear(this.day(), this.yearDays()) === b;
    return dayOfYear(this.day(), this.yearDays()) === b && this.day() > 1;
  }

  isDead(id) {
    return this.deathDay(id) != null || !!this.game?.entities?.get?.(id)?.dead;
  }

  // The pace changed (Settings): everyone's age is kept as it is today, and birthdays from
  // tomorrow on are counted at the new pace.
  repace(newPace) {
    const to = paceOf(newPace);
    const from = this.yearDays();
    if (to === from) {
      this.pace = to;
      return false;
    }
    const day = this.day();
    for (const id of [...BASE.keys(), 'lyra']) {
      const age = this.ageOf(id, day);
      if (age != null) this.anchors[id] = { age, day };
    }
    if (this.player) this.player = { ...this.player, age: this.ageOf('player', day), day };
    this.pace = to;
    return true;
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
    if (this.player && g.player) g.player.ageYears = this.ageOf('player');
    // Their looks follow (grey hair, a stoop, a child's build grown): painted once per stage.
    try {
      applyAgeLooks(g, { baseAgeOf: baseAge, ageOf: (id) => this.ageOf(id), stageOf: (id) => stageOf(this.ageOf(id)) });
    } catch (err) {
      console.warn('[calendar] looks', err);
    }
  }

  update() {
    // The setting moved: re-anchor first, so nobody's age jumps.
    const want = paceOf(this.game?.settings?.yearDays ?? YEAR_DAYS);
    if (this.pace == null) this.pace = want;
    else if (want !== this.pace) {
      this.repace(want);
      this.lastDay = null;
    }
    const day = this.day();
    if (day === this.lastDay) return;
    const first = this.lastDay == null;
    this.lastDay = day;
    this.apply();
    if (first) return;
    for (const id of [...BASE.keys(), 'lyra', 'player']) {
      if (!this.isBirthday(id) || this.celebrated[id] === day || this.isDead(id)) continue;
      this.celebrated[id] = day;
      this.celebrate(id, day);
    }
  }

  celebrate(id, day) {
    const g = this.game;
    const name = id === 'lyra' ? 'Lyra' : id === 'player' ? 'You' : nameOf(g, id);
    const age = this.ageOf(id);
    const adult = age === MINOR_UNDER;
    g.bus?.emit?.('birthday', { id, name, age, day, adult: adult || undefined });
    const text = id === 'player' ? `Your birthday, by Petra's reckoning: ${ageWords(age)}.` : adult ? `${name} is ${ageWords(age)} today: grown, to the village.` : `${name}'s birthday today: ${age}.`;
    try {
      g.ui?.toast?.(text, 'info', { key: `birthday:${id}`, title: 'A birthday' });
    } catch {
      /* ui optional */
    }
    if (id === 'player') return;
    // News for those close to them (heard by meeting after that), a word of their own when
    // the stranger is near, and Lyra's notice (through her own perception: she thinks of them).
    try {
      const close = closeTo(g, id);
      g.village?.addRumor?.('birthday', { victim: id === 'lyra' ? null : id, witnesses: close, source: close[0] || 'village' });
    } catch {
      /* the village is optional */
    }
    try {
      const e = g.entities?.get?.(id);
      const P = g.player;
      if (e && P && !e.dead && e.state !== 'sleep' && Math.hypot(e.x - P.x, e.y - P.y) < 160) g.bubbles?.say?.(e, birthdayBark(age), { duration: 3.5 });
    } catch {
      /* cosmetic */
    }
    try {
      const L = g.lyra || g.companion;
      if (L?.mind && id !== 'lyra') L.mind.noticeText?.(`${name}'s birthday`, { source: 'topic', amount: 0.4 });
    } catch {
      /* her mind is optional */
    }
  }

  // The stranger wakes with no age: Petra reckons it, and the waking morning is the birthday.
  reckonPlayer(day = this.day(), by = 'petra') {
    if (this.player) return this.player;
    this.player = { age: PLAYER_GUESS, day, by };
    return this.player;
  }

  briefLine(id) {
    const bits = [`Today is ${this.dateLabel()}.`];
    const age = id ? this.ageOf(id) : null;
    if (age != null && id !== 'player') bits.push(`You are ${age}.`);
    if (id && id !== 'player' && this.isBirthday(id)) bits.push('It is your birthday today.');
    const today = [...BASE.keys(), 'lyra'].filter((x) => x !== id && this.isBirthday(x) && !this.isDead(x));
    if (today.length) bits.push(`It is ${today.slice(0, 2).map((x) => `${x === 'lyra' ? 'Lyra' : nameOf(this.game, x)}'s`).join(' and ')} birthday.`);
    let s = bits.join(' ');
    if (s.length > 200) s = `${s.slice(0, 199)}…`;
    return s;
  }

  serialize() {
    return { celebrated: { ...this.celebrated }, yearDays: this.yearDays(), anchors: { ...this.anchors }, player: this.player ? { ...this.player } : null };
  }

  deserialize(d) {
    if (d?.celebrated && typeof d.celebrated === 'object') this.celebrated = { ...d.celebrated };
    // An old save (round 14a) counted at twelve days a year, from the first morning.
    this.pace = d && 'yearDays' in d ? paceOf(d.yearDays) : YEAR_DAYS;
    this.anchors = {};
    if (d?.anchors && typeof d.anchors === 'object') {
      for (const [id, a] of Object.entries(d.anchors)) if (a && Number.isFinite(a.age) && Number.isFinite(a.day)) this.anchors[id] = { age: a.age, day: a.day };
    }
    this.player = d?.player && Number.isFinite(d.player.age) && Number.isFinite(d.player.day) ? { age: d.player.age, day: d.player.day, by: d.player.by || 'petra' } : null;
    this.lastDay = null; // apply ages for the loaded day on the next update
  }

  promptContext() {
    const y = this.year();
    const out = [`${this.dateLabel()}. Hearthvale's year turns every ${this.yearDays()} days; people age a year on their birthdays.`];
    if (y > 0) out.push(`${y} year${y > 1 ? 's have' : ' has'} passed since the stranger woke.`);
    const today = [...BASE.keys(), 'lyra'].filter((id) => this.isBirthday(id) && !this.isDead(id));
    if (today.length) out.push(`Birthdays today: ${today.map((id) => `${id === 'lyra' ? 'Lyra' : nameOf(this.game, id)} (${this.ageOf(id)})`).join(', ')}.`);
    return out.join(' ');
  }
}

function stageOf(age) {
  if (!Number.isFinite(age)) return null;
  return age < 13 ? 'child' : age < MINOR_UNDER ? 'teen' : age < 65 ? 'adult' : age < 80 ? 'elder' : 'frail';
}

function nameOf(game, id) {
  const e = game.entities?.get?.(id);
  const p = e?.profile || [...NPC_PROFILES, ...MORE_PROFILES].find((q) => q.id === id);
  return (p?.name || id).split(' ')[0];
}

// Family and the closest friends (the bonds' care), who hear of a birthday first.
function closeTo(game, id) {
  const p = [...NPC_PROFILES, ...MORE_PROFILES].find((q) => q.id === id);
  const out = new Set();
  const f = p?.family || {};
  for (const k of ['parent', 'child', 'spouse', 'sibling', 'ward']) for (const x of f[k] || []) out.add(x);
  if (id === 'lyra') ['hobb', 'wenna', 'sabeth'].forEach((x) => out.add(x));
  for (const q of [...NPC_PROFILES, ...MORE_PROFILES]) {
    const qf = q.family || {};
    if (['parent', 'child', 'spouse', 'sibling', 'ward'].some((k) => (qf[k] || []).includes(id))) out.add(q.id);
    try {
      if ((game.villageLife?.care?.(q.id, id) ?? 0) >= 0.6) out.add(q.id);
    } catch {
      /* no village life */
    }
  }
  out.delete(id);
  out.delete('lyra');
  return [...out].filter((x) => !game.murder?.dead?.[x]).slice(0, 8);
}

function birthdayBark(age) {
  if (age < 13) return `I'm ${ageWords(age).toUpperCase()} today!`;
  if (age < 16) return `${ageWords(age).charAt(0).toUpperCase()}${ageWords(age).slice(1)} today. Nearly grown.`;
  if (age === 16) return 'Sixteen. Grown, they say. Feels the same.';
  if (age >= 75) return 'Another year. The knees noticed before I did.';
  return 'Another year older. Don\'t make a fuss.';
}

export const calendarPlugin = {
  id: 'calendar',
  name: 'Calendar',
  description: 'The year goes round: seasons, birthdays, and everyone a year older.',
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
  onEvent(type, p, ctx) {
    // A new life: Petra reckons the stranger's age, and the waking morning is their birthday.
    if (type === 'game_start' && !p?.loaded) ctx.game?.calendar?.reckonPlayer?.();
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
