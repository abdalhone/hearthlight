// What Hearthvale calls the stranger (round 14b, S-19; DESIGN §36.1; the author's evil path:
// "reputation names (the Butcher of Hearthvale, Oathbreaker), merchants refusing, guards
// hunting, other villages hearing on the road").
//
// game.reputation = new Reputation(game) (reputationPlugin, through src/core/plugins/society.js).
// Derived from the truth, never stored as a score: rebuilt from game.murder's records, the
// village's rumours (who heard what, by meeting), the provenance ledger and a short list of
// oaths. Only deeds someone KNOWS count, as they know them: seen (the sight rule), told face
// to face (a rumour's heardBy), the bell (the alarm raised), the Moot's verdict, the road's
// word carried by travellers. Never what nobody saw. A death nobody did (murder.die, rec.natural)
// is never a deed; a killing that looked like nothing (the Unkindling, rec.cause 'unkindled')
// counts only once it is KNOWN as a killing (seen, linked, or proven).
//
//   counts({ knownTo })     { killedKnown, killedSecret, proven, unkindledKnown, thefts, lies,
//                             oathsBroken, oathsKept, rescues } as that person knows them
//                             (no knownTo: as anyone at all knows them; killedSecret is the truth)
//   titles({ knownTo })     [{ id, title, why }] the names they would use, by their own
//                             knowledge plus the titles they have HEARD (rumour kinds, heardBy)
//   of(id)                  { counts, titles, line } for one person (prompts, People, merchants)
//   briefLine(id)           one sentence for that person's Claude prompt (<= 220 chars)
//   oath(kind, { kept, knownBy })   an oath kept or broken (the tempter, 'outside')
//   roadWord()              the titles the road has heard of (after ROAD_DELAY_DAYS)
//   heroTitle(id)           a hero's name, given by the game (the ward held)
//
// Bus in: villager_killed (never villager_died), moot_verdict, murder_witnessed, body_found,
// killing_known { id } (soul: an unkindled death linked), rumor, new_day.
// Bus out: title_known { id, title, knownBy } the first time a title is known by someone.

import { VILLAGERS } from '../ai/social/bonds_data.js';
import { RUMOR_KINDS } from '../ai/social/rumors.js';
import { MOOT_HEADS } from '../murder/data.js';

export const BUTCHER_AT = 3; // known killings
export const THIEF_AT = 2;
export const LIAR_AT = 2;
export const RESCUER_AT = 3;
export const ROAD_DELAY_DAYS = 2; // the road hears a title this many days after the village does
export const BRIEF_MAX = 220;

const RESCUE_KINDS = ['rescued', 'helped_up', 'carried_villager', 'carried_lyra', 'revived_lyra', 'protected_lyra'];

// The names, plainly.
export const TITLES = {
  butcher: { title: 'the Butcher of Hearthvale', bad: true },
  unkindler: { title: 'the Unkindler', bad: true },
  killer: { title: 'a killer', bad: true },
  oathbreaker: { title: 'Oathbreaker', bad: true },
  thief: { title: 'a thief', bad: true },
  liar: { title: 'a liar', bad: true },
  wardkeeper: { title: 'the one who kept the ward', bad: false },
  rescuer: { title: 'the one who carries the fallen', bad: false },
};

// Titles travel as rumours (heard by meeting, like any news). Added to the village's rumour
// kinds here, once, without editing the village's own table.
export const TITLE_RUMORS = {
  title_butcher: { text: 'they call {stranger} the Butcher of Hearthvale', you: 'they call you the Butcher of Hearthvale', valence: -1, severity: 0.9, title: 'butcher' },
  title_unkindler: { text: 'they say {stranger} puts out people\'s flames from the inside, the Unkindler', you: 'they call you the Unkindler', valence: -1, severity: 0.95, title: 'unkindler' },
  title_oathbreaker: { text: '{stranger} breaks their word: an oathbreaker', you: 'they call you Oathbreaker', valence: -0.6, severity: 0.6, title: 'oathbreaker' },
  title_thief: { text: '{stranger} is a thief', you: 'they call you a thief', valence: -0.5, severity: 0.45, title: 'thief' },
  title_liar: { text: '{stranger} lies to your face', you: 'they call you a liar', valence: -0.5, severity: 0.45, title: 'liar' },
  title_wardkeeper: { text: '{stranger} kept the ward when something came for it', you: 'they say you kept the ward', valence: 0.9, severity: 0.8, title: 'wardkeeper' },
  title_rescuer: { text: '{stranger} carries the fallen home', you: 'they say you carry the fallen home', valence: 0.6, severity: 0.5, title: 'rescuer' },
};
for (const [k, v] of Object.entries(TITLE_RUMORS)) if (!RUMOR_KINDS[k]) RUMOR_KINDS[k] = { text: v.text, you: v.you, valence: v.valence, severity: v.severity };

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

const UNKINDLED = 'unkindled';

// A death the stranger caused, as a record says (never a death nobody did).
export function byPlayer(rec) {
  return !!rec && !rec.natural && rec.by === 'player';
}

// Is this death known AS a killing at all (by anyone)? A blade leaves a mark and a body is a
// murder once found or seen; the Unkindling leaves nothing, so it is a killing only once
// someone SAW it (rec.known 'witnessed'), soul linked it (rec.linked / rec.knownKilling), or
// the Moot proved it.
export function knownAsKilling(m, rec) {
  if (!rec || rec.natural) return false;
  const proven = m?.cases?.[rec.id]?.verdict === 'guilty';
  if (rec.cause === UNKINDLED) return rec.known === 'witnessed' || !!rec.linked || !!rec.knownKilling || proven;
  return rec.known === 'witnessed' || rec.foundAt != null || proven;
}

// Does this person know the stranger did it? Saw it, or the news reached them face to face,
// or the bell rang (murder.knowsKiller); the Moot's verdict (those who sat, and whoever heard
// its 'convicted' news since); Lyra by her own belief; a linked Unkindling by soul's knownBy.
export function knowsDeed(m, rec, id) {
  if (!byPlayer(rec) || !id) return false;
  if (rec.cause === UNKINDLED && !knownAsKilling(m, rec)) return false;
  if (safe(() => m.knowsKiller?.(rec, id), false)) return true;
  if (Array.isArray(rec.knownBy) && rec.knownBy.includes(id)) return true;
  if (id === 'lyra') {
    const b = m?.lyra?.[rec.id]?.belief;
    if (b === 'knows' || b === 'believes') return true;
  }
  const c = m?.cases?.[rec.id];
  if (c?.verdict === 'guilty') {
    if (MOOT_HEADS.includes(id)) return true;
    const r = rumorOf(m, 'convicted', rec.id);
    if (r?.heardBy?.includes(id)) return true;
  }
  return false;
}

function rumorOf(m, kind, victim) {
  const list = safe(() => m?.village?.rumors?.list, []) || [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i].kind === kind && (victim == null || list[i].victim === victim)) return list[i];
  return null;
}

function rumorsOf(game, kinds) {
  const list = safe(() => game?.village?.rumors?.list, []) || [];
  return list.filter((r) => kinds.includes(r.kind));
}

function hasHeard(r, id) {
  return !!r && Array.isArray(r.heardBy) && (id == null ? r.heardBy.length > 0 : r.heardBy.includes(id));
}

export class Reputation {
  constructor(game) {
    this.game = game;
    this.oaths = []; // { kind, kept, t, day, knownBy: [ids] | 'all', note }
    this.heroes = []; // { id, day } titles the game gave (the ward kept)
    this.titled = {}; // titleId -> { day, t } the first day anyone knew it (the road hears later)
    this.lastSeen = {}; // titleId -> [ids] who knew it at the last look (for title_known)
  }

  get murder() {
    return this.game?.murder || null;
  }

  day() {
    return Math.max(1, Math.floor(this.game?.clock?.day ?? 1));
  }

  // ------------------------------------------------------------------ the counts

  counts({ knownTo = null } = {}) {
    const g = this.game;
    const m = this.murder;
    const out = { killedKnown: 0, killedSecret: 0, proven: 0, unkindledKnown: 0, thefts: 0, lies: 0, oathsBroken: 0, oathsKept: 0, rescues: 0 };
    for (const rec of Object.values(m?.dead || {})) {
      if (!byPlayer(rec)) continue;
      const known = knownTo ? knowsDeed(m, rec, knownTo) : this.anyoneKnows(rec);
      if (known) {
        out.killedKnown++;
        if (rec.cause === UNKINDLED) out.unkindledKnown++;
      } else out.killedSecret++;
      if (m?.cases?.[rec.id]?.verdict === 'guilty' && (!knownTo || known)) out.proven++;
    }
    // Theft: seen taking (the provenance ledger's seenBy, by the sight rule), or heard of.
    for (const e of safe(() => g?.provenance?.all?.(), []) || []) {
      const seen = Array.isArray(e.seenBy) ? e.seenBy : [];
      if (knownTo ? seen.includes(knownTo) : seen.length) out.thefts++;
    }
    for (const r of rumorsOf(g, ['stole'])) if (hasHeard(r, knownTo) && !(r.saw || []).length) out.thefts++;
    // Lies caught (by the watch, or before the Moot), and heard of since.
    for (const r of rumorsOf(g, ['lied_about'])) if (hasHeard(r, knownTo)) out.lies++;
    for (const c of Object.values(m?.cases || {})) {
      for (const cl of c?.trial?.claims || []) if (cl.caught && (!knownTo || (cl.caughtBy || []).includes(knownTo))) out.lies++;
    }
    for (const o of this.oaths) {
      const knows = o.knownBy === 'all' || (Array.isArray(o.knownBy) && (knownTo ? o.knownBy.includes(knownTo) : o.knownBy.length > 0));
      if (!knows) continue;
      if (o.kept) out.oathsKept++;
      else out.oathsBroken++;
    }
    for (const r of rumorsOf(g, RESCUE_KINDS)) if (hasHeard(r, knownTo)) out.rescues++;
    return out;
  }

  anyoneKnows(rec) {
    const m = this.murder;
    if (!knownAsKilling(m, rec)) return false;
    if (rec.known === 'witnessed' || m?.cases?.[rec.id]?.verdict === 'guilty') return true;
    if (Array.isArray(rec.knownBy) && rec.knownBy.length) return true;
    return [...VILLAGERS, 'lyra'].some((id) => knowsDeed(m, rec, id));
  }

  // ------------------------------------------------------------------ the names

  // The names this person would use: what they know of the stranger, and what they have heard
  // them called (title rumours).
  titles({ knownTo = null } = {}) {
    const c = this.counts({ knownTo });
    const ids = new Set();
    if (c.killedKnown >= BUTCHER_AT) ids.add('butcher');
    else if (c.killedKnown > 0) ids.add('killer');
    if (c.unkindledKnown > 0) ids.add('unkindler');
    if (c.oathsBroken > 0) ids.add('oathbreaker');
    if (c.thefts >= THIEF_AT) ids.add('thief');
    if (c.lies >= LIAR_AT) ids.add('liar');
    if (c.rescues >= RESCUER_AT && c.killedKnown === 0) ids.add('rescuer');
    for (const h of this.heroes) ids.add(h.id);
    // Heard by meeting: "they call him the Butcher".
    for (const [kind, def] of Object.entries(TITLE_RUMORS)) {
      const r = rumorsOf(this.game, [kind]).find((x) => hasHeard(x, knownTo));
      if (r) ids.add(def.title);
    }
    if (ids.has('butcher')) ids.delete('killer');
    const order = Object.keys(TITLES);
    return [...ids]
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map((id) => ({ id, title: TITLES[id].title, bad: TITLES[id].bad, why: whyOf(id, c) }));
  }

  // Does this person know the stranger did this death? (The per-knower rule, for merchants.)
  knows(rec, id) {
    return knowsDeed(this.murder, rec, id);
  }

  of(id) {
    const counts = this.counts({ knownTo: id });
    const titles = this.titles({ knownTo: id });
    return { counts, titles, line: this.briefLine(id) };
  }

  briefLine(id) {
    const t = this.titles({ knownTo: id });
    if (!t.length) return '';
    const c = this.counts({ knownTo: id });
    const bits = [`You know the stranger as ${t.map((x) => x.title).join(', ')}.`];
    if (c.killedKnown) bits.push(`You know of ${c.killedKnown} ${c.killedKnown === 1 ? 'killing' : 'killings'} by their hand.`);
    let s = bits.join(' ');
    if (s.length > BRIEF_MAX) s = `${s.slice(0, BRIEF_MAX - 1)}…`;
    return s;
  }

  // ------------------------------------------------------------------ oaths and heroes

  oath(kind, { kept = false, knownBy = [], note = '' } = {}) {
    const o = { kind: String(kind), kept: !!kept, t: Math.round(safe(() => this.game.clock.t, 0)), day: this.day(), knownBy: knownBy === 'all' ? 'all' : [...new Set(knownBy || [])], note: String(note || '').slice(0, 120) };
    this.oaths.push(o);
    if (this.oaths.length > 40) this.oaths.splice(0, this.oaths.length - 40);
    this.look();
    return o;
  }

  heroTitle(id) {
    if (!TITLES[id] || this.heroes.some((h) => h.id === id)) return false;
    this.heroes.push({ id, day: this.day() });
    this.look();
    return true;
  }

  // ------------------------------------------------------------------ spreading

  // Each title someone now knows goes out as a rumour (heardBy: those who know), once a day,
  // and the first time anyone knows it is the day the road starts hearing of it.
  look() {
    const g = this.game;
    const village = g?.village;
    const people = [...VILLAGERS, 'lyra'].filter((id) => !this.murder?.dead?.[id]);
    const held = new Map(people.map((id) => [id, new Set(safe(() => this.titles({ knownTo: id }).map((t) => t.id), []) || [])]));
    for (const tid of Object.keys(TITLES)) {
      const knowers = people.filter((id) => held.get(id).has(tid));
      const before = this.lastSeen[tid] || [];
      const fresh = knowers.filter((id) => !before.includes(id));
      this.lastSeen[tid] = knowers;
      if (!knowers.length) continue;
      if (!this.titled[tid]) this.titled[tid] = { day: this.day(), t: Math.round(safe(() => g.clock.t, 0)) };
      if (fresh.length) {
        safe(() => g.bus?.emit?.('title_known', { id: tid, title: TITLES[tid].title, knownBy: fresh }));
        const kind = `title_${tid}`;
        if (village?.addRumor && TITLE_RUMORS[kind]) safe(() => village.addRumor(kind, { witnesses: knowers.filter((x) => x !== 'lyra'), source: knowers[0] }));
      }
    }
  }

  // What the road has heard (carters, other villages): a title known in the vale for
  // ROAD_DELAY_DAYS days.
  roadWord() {
    const day = this.day();
    return Object.entries(this.titled)
      .filter(([, v]) => day - v.day >= ROAD_DELAY_DAYS)
      .map(([id]) => ({ id, title: TITLES[id]?.title }))
      .filter((x) => x.title);
  }

  roadLine() {
    const order = Object.keys(TITLES);
    const w = this.roadWord().sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    if (!w.length) return null;
    const bad = w.find((x) => TITLES[x.id]?.bad) || w[0];
    const name = bad.title.replace(/^(a|the)\s+/i, (s) => s.toLowerCase());
    return TITLES[bad.id]?.bad ? `A carter by the fire looks you over twice. "You'd be the one Hearthvale calls ${name}. Word gets down the road."` : `A carter by the fire nods to you. "You'd be ${name}. Word gets down the road."`;
  }

  onEvent(type, p) {
    switch (type) {
      case 'villager_killed':
      case 'moot_verdict':
      case 'murder_witnessed':
      case 'body_found':
      case 'killing_known':
      case 'new_day':
        return this.look();
      case 'rumor':
        if (p?.rumor && ['stole', 'lied_about', 'convicted', 'murder', ...RESCUE_KINDS].includes(p.rumor.kind)) this.look();
        return undefined;
      case 'enter_location': {
        const id = p?.location?.id || p?.location;
        if (p?.actor !== this.game?.player || !ROAD_PLACES.includes(id)) return undefined;
        const day = this.day();
        if (this._roadDay === day) return undefined;
        const line = this.roadLine();
        if (!line) return undefined;
        this._roadDay = day;
        safe(() => this.game.ui?.toast?.(line, 'info', { key: 'road_word', title: 'On the road' }));
        safe(() => this.game.bus?.emit?.('road_word', { place: id, titles: this.roadWord().map((x) => x.id) }));
        return undefined;
      }
      default:
        return undefined;
    }
  }

  serialize() {
    return { v: 1, oaths: this.oaths, heroes: this.heroes, titled: this.titled, roadDay: this._roadDay ?? null };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    this.oaths = Array.isArray(d.oaths) ? d.oaths.filter((o) => o && typeof o.kind === 'string') : [];
    this.heroes = Array.isArray(d.heroes) ? d.heroes.filter((h) => h && TITLES[h.id]) : [];
    this.titled = d.titled && typeof d.titled === 'object' ? { ...d.titled } : {};
    this._roadDay = Number.isFinite(d.roadDay) ? d.roadDay : null;
    this.lastSeen = {}; // rebuilt from the truth at the next look
  }
}

// Places on the road where travellers carry word of the vale (the carters' fire, the waystones).
export const ROAD_PLACES = ['cinderwick_fork', 'long_mile', 'west_fork', 'kings_road_west', 'kings_road_east', 'brindlecombe'];

function whyOf(id, c) {
  switch (id) {
    case 'butcher':
    case 'killer':
      return `${c.killedKnown} known ${c.killedKnown === 1 ? 'killing' : 'killings'}`;
    case 'unkindler':
      return 'the flames put out from inside';
    case 'oathbreaker':
      return `${c.oathsBroken} broken ${c.oathsBroken === 1 ? 'oath' : 'oaths'}`;
    case 'thief':
      return `${c.thefts} thefts`;
    case 'liar':
      return `${c.lies} lies caught`;
    case 'rescuer':
      return `${c.rescues} rescues`;
    default:
      return '';
  }
}

export const reputationPlugin = {
  id: 'reputation',
  name: 'Reputation',
  description: 'What Hearthvale calls the stranger, from what it knows (DESIGN §36.1).',
  install(ctx) {
    const g = ctx.game;
    if (!g) return;
    if (!(g.reputation instanceof Reputation)) g.reputation = new Reputation(g);
    if (this._pending !== undefined) {
      g.reputation.deserialize(this._pending);
      this._pending = undefined;
    }
  },
  onEvent(type, p, ctx) {
    safe(() => ctx.game?.reputation?.onEvent?.(type, p));
  },
  serialize(ctx) {
    return ctx.game?.reputation?.serialize?.() ?? null;
  },
  deserialize(d, ctx) {
    if (ctx.game?.reputation) ctx.game.reputation.deserialize(d);
    else this._pending = d;
  },
  promptContext(ctx) {
    // For Lyra's prompt: what she herself knows them as.
    return safe(() => ctx.game?.reputation?.briefLine?.('lyra'), '') || '';
  },
};
