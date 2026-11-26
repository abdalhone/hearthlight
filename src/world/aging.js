// Death of old age (round 14b, S-18d; decision D7; DESIGN §36.3). The very old fail and die
// in their sleep, in time: a seeded daily chance for the old (from 77, rising with every
// year), never in the first year, never a child, never with Settings → Game → "People die
// of old age" off, and never Hobb, Wenna or Petra while the story's threads they hold are
// open (the Maren thread). First a failing day or two at home, abed, with Mira and Aveline
// sitting with them; then a quiet death in the night through `murder.die(v, { cause:
// 'age' })` (decision D13), never `kill()`: no witnesses, no alarm, no case, no Moot,
// nothing for the tempter or the stranger's reputation, even with a spouse asleep in the
// same room. In the morning their own people find them. Grief, the funeral, the heirs and
// the 'found_dead' news follow as for any death; the epitaph says "died of old age"; Lyra
// grieves without suspicion.
//
// game.aging = new Aging(game) (agingPlugin + installAging, through src/core/plugins/society.js)
//   chanceOf(age)        the daily chance at that age
//   failing              { id: { since, dieDay } }
//   begin(id)            start someone failing (the play checks force it)
//   dieNow(id)           the death itself (murder.die), in their bed
//   entryFor(npc, e, h)  their day while failing, and the visits

import { VILLAGERS } from '../ai/social/bonds_data.js';
import { isMinor } from '../core/people.js';
import { RUMOR_KINDS } from '../ai/social/rumors.js';
import { profileById } from '../entities/npc_data.js';
import * as Lyra from '../murder/lyra.js';
import { HOUR } from '../murder/data.js';

export const OLD_FROM = 77; // the first age with any daily chance
export const CHANCE_PER_YEAR = 0.006; // added to the daily chance for every year past OLD_FROM - 1
export const CHANCE_MAX = 0.08;
export const FAIL_DAYS = 1; // days abed before the night it ends
const SPARED = ['hobb', 'wenna', 'petra']; // while the Maren thread is open (decision D7)
const VISITORS = { mira: [10, 11.5], aveline: [15, 16.5] };

if (!RUMOR_KINDS.unwell) RUMOR_KINDS.unwell = { text: '{v} is poorly, and keeping to bed', you: '{v} is poorly', valence: -0.1, severity: 0.3, about: 'village' };

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[aging]', err);
    return fallback;
  }
}

function hash(...parts) {
  let h = 2166136261;
  for (const s of parts.map(String).join('|')) {
    h ^= s.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function kinOf(id) {
  const f = profileById(id)?.family || {};
  const out = [];
  for (const k of ['spouse', 'child', 'parent', 'ward', 'sibling']) for (const x of f[k] || []) out.push(x);
  for (const p of VILLAGERS) {
    const q = profileById(p)?.family || {};
    if (['spouse', 'child', 'parent', 'ward', 'sibling'].some((k) => (q[k] || []).includes(id)) && !out.includes(p)) out.push(p);
  }
  return out;
}

export function chanceOf(age) {
  if (!Number.isFinite(age) || age < OLD_FROM) return 0;
  return Math.min(CHANCE_MAX, (age - OLD_FROM + 1) * CHANCE_PER_YEAR);
}

export class Aging {
  constructor(game) {
    this.game = game;
    this.failing = {}; // id -> { since, dieDay }
    this.toFind = {}; // id -> the day they died (found by their own people in the morning)
    this.tickT = 0;
  }

  get murder() {
    return this.game?.murder || null;
  }

  day() {
    return Math.max(1, Math.floor(this.game?.clock?.day ?? 1));
  }

  hour() {
    return this.game?.clock?.hour ?? 12;
  }

  enabled() {
    return this.game?.settings?.oldAge !== false;
  }

  // The Maren thread is open until the stranger stands at the old waygate (the quest's last stage).
  threadOpen() {
    const g = this.game;
    const q = safe(() => g.plugins?.get?.('quest'), null);
    const st = safe(() => q?.stageOf?.(g)?.index, null);
    return !Number.isFinite(st) || st < 6;
  }

  spared(id) {
    return SPARED.includes(id) && this.threadOpen();
  }

  alive(id) {
    const e = this.game?.entities?.get?.(id);
    return !!e && !e.dead && !e.removed && !this.murder?.dead?.[id];
  }

  onNewDay(day = this.day()) {
    if (!this.enabled() || !this.murder) return;
    const cal = this.game?.calendar;
    const Y = safe(() => cal.yearDays(), 12) || 12;
    if (day <= Y) return; // nobody dies of age in the first year
    for (const id of VILLAGERS) {
      if (this.failing[id] || !this.alive(id) || this.spared(id) || isMinor(this.game, id)) continue;
      const age = safe(() => cal?.ageOf?.(id), null) ?? profileById(id)?.age;
      const p = chanceOf(age);
      if (p > 0 && hash(this.game?.seed ?? 1, day, id) < p) this.begin(id, day);
    }
  }

  begin(id, day = this.day()) {
    if (this.failing[id] || !this.alive(id) || isMinor(this.game, id)) return false;
    this.failing[id] = { since: day, dieDay: day + FAIL_DAYS };
    safe(() => this.game.village?.addRumor?.('unwell', { victim: id, witnesses: kinOf(id).filter((x) => this.alive(x)), source: kinOf(id)[0] || 'village' }));
    safe(() => this.game.bus?.emit?.('failing', { id, day }));
    return true;
  }

  // The death itself: quiet, in the night, nobody's doing.
  dieNow(id) {
    const m = this.murder;
    const v = this.game?.entities?.get?.(id);
    if (!m || !v || !this.alive(id) || isMinor(this.game, v)) return null;
    const rec = m.die(v, { cause: 'age' });
    delete this.failing[id];
    if (rec) this.toFind[id] = this.day();
    return rec;
  }

  // Their own people find them in the morning, at home.
  findInMorning(id) {
    const m = this.murder;
    const rec = m?.dead?.[id];
    delete this.toFind[id];
    if (!rec || rec.foundAt != null) return;
    const finder = kinOf(id).find((x) => this.alive(x)) || ['mira', 'aveline', 'elda'].find((x) => this.alive(x)) || null;
    const home = profileById(id)?.home || rec.place;
    m.found(id, finder, home);
  }

  update(dt) {
    const g = this.game;
    if (!g || (g.state && g.state !== 'playing')) return;
    this.tickT -= dt;
    if (this.tickT > 0) return;
    this.tickT = 2;
    const day = this.day();
    const h = this.hour();
    for (const [id, f] of Object.entries(this.failing)) {
      if (!this.alive(id)) {
        delete this.failing[id];
        continue;
      }
      // The night after the failing days, in the small hours.
      if (day >= f.dieDay && h >= 1 && h < 5) this.dieNow(id);
      else if (day > f.dieDay) this.dieNow(id);
    }
    for (const [id, d] of Object.entries(this.toFind)) if (day > d || (day === d && h >= 7)) this.findInMorning(id);
    // Lyra hears of it with everyone, and grieves; she does not wonder who did it.
    for (const rec of Object.values(this.murder?.dead || {})) {
      if (rec.lyraGriefAt != null && (g.clock?.t ?? 0) >= rec.lyraGriefAt) {
        rec.lyraGriefAt = null;
        safe(() => Lyra.grief(this.murder, rec));
      }
    }
  }

  // Their day while failing: abed at home. Mira and Aveline come and sit with them.
  entryFor(npc, e, hour) {
    const id = npc?.id;
    if (!id) return null;
    if (this.failing[id]) {
      const home = npc.profile?.home;
      if (!home) return null;
      return { activity: hour >= 20 || hour < 8 ? 'sleep' : 'rest', at: home, vl: `failing-${id}`, doing: 'poorly, and keeping to bed' };
    }
    const slot = VISITORS[id];
    if (slot && hour >= slot[0] && hour < slot[1]) {
      const who = Object.keys(this.failing).find((x) => this.alive(x) && x !== id);
      const home = who ? profileById(who)?.home : null;
      if (home) return { activity: 'errand', at: home, vl: `visit-${who}`, doing: `sitting with ${profileById(who)?.name?.split(' ')[0] || who}` };
    }
    return null;
  }

  // Who owns the discovery of a death of age (murder.onFound, DESIGN §37.3): the finder's own
  // words, no case, no blade, no Moot; grief and the funeral as for anyone.
  onFound(rec, ctx) {
    if (!rec?.natural || rec.cause !== 'age') return false;
    const m = ctx.murder;
    const V = m.name(rec.id);
    const he = m.pronoun(rec.id, 'he');
    const fe = ctx.finderEntity;
    if (fe && fe !== this.game?.companion) {
      const line = kinOf(rec.id).includes(ctx.finder) ? `${V}? ...${V}. Oh, no. Oh, love. In ${m.pronoun(rec.id, 'his')} sleep.` : `${V}? ...Ah. Gone in ${m.pronoun(rec.id, 'his')} sleep. Somebody fetch Aveline.`;
      safe(() => m.say(fe, line, 'say'));
    }
    m.event('found', `${ctx.finder ? m.name(ctx.finder) : 'Someone'} found ${V} dead in ${m.pronoun(rec.id, 'his')} bed. There is no mark on ${m.pronoun(rec.id, 'him')}: ${he} died of old age, in ${m.pronoun(rec.id, 'his')} sleep.`, { who: ctx.finder, about: rec.id });
    m.toast(`${m.entity(rec.id)?.name || V} died in the night, of old age. No mark on ${m.pronoun(rec.id, 'him')}: ${he} went in ${m.pronoun(rec.id, 'his')} sleep. There will be a funeral.`, 'info', `found:${rec.id}`);
    // Lyra: grief, never suspicion (she hears the finder, or the news reaches her within the hour).
    if (safe(() => m.lyraHearsFinding(fe || ctx.body), false)) safe(() => Lyra.grief(m, rec));
    else rec.lyraGriefAt = (this.game?.clock?.t ?? 0) + HOUR;
    return true;
  }

  serialize() {
    return { v: 1, failing: { ...this.failing }, toFind: { ...this.toFind } };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
    this.failing = {};
    for (const [id, f] of Object.entries(obj(d.failing))) if (VILLAGERS.includes(id) && Number.isFinite(f?.dieDay)) this.failing[id] = { since: f.since ?? f.dieDay - FAIL_DAYS, dieDay: f.dieDay };
    this.toFind = {};
    for (const [id, day] of Object.entries(obj(d.toFind))) if (VILLAGERS.includes(id) && Number.isFinite(day)) this.toFind[id] = day;
  }
}

export const agingPlugin = {
  id: 'aging',
  name: 'Old age',
  description: 'The very old fail and die in their sleep, in time (DESIGN §36.3).',
  install(ctx) {
    const g = ctx.game;
    if (!g) return;
    if (!(g.aging instanceof Aging)) g.aging = new Aging(g);
    if (this._pending !== undefined) {
      g.aging.deserialize(this._pending);
      this._pending = undefined;
    }
  },
  update(dt, ctx) {
    ctx.game?.aging?.update?.(dt);
  },
  onEvent(type, p, ctx) {
    if (type === 'new_day') safe(() => ctx.game?.aging?.onNewDay?.(p?.day));
  },
  serialize(ctx) {
    return ctx.game?.aging?.serialize?.() ?? null;
  },
  deserialize(d, ctx) {
    if (ctx.game?.aging) ctx.game.aging.deserialize(d);
    else this._pending = d;
  },
};

// After murder exists: the failing day in their routine, and the discovery of a death of age.
export function installAging(game) {
  const m = game?.murder;
  const a = game?.aging;
  if (!m || !a || m._agingHooked) return;
  m._agingHooked = true;
  if (typeof m.onFound === 'function') m.onFound((rec, ctx) => a.onFound(rec, ctx));
  const entry = typeof m.entryFor === 'function' ? m.entryFor.bind(m) : () => null;
  m.entryFor = (npc, e, hour) => safe(() => a.entryFor(npc, e, hour), null) || entry(npc, e, hour);
}
