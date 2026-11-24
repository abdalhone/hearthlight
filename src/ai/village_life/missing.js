// The missing (DESIGN §28, and what §29 builds on): who is away from their life and why
// (the game knows; the village does not), and each person the village is looking for as
// a case that grows: noticed → asking around → the watch searching → missing by nightfall
// → found safe, or found dead. Each case keeps what the village learned (reports from
// people who saw them), where it searched, and a timeline the player can read.

export const CASE_STATES = ['noticed', 'asking', 'search', 'missing', 'found', 'dead'];
const TIMELINE_CAP = 48;
// Kinds that make the story: never trimmed while there are lesser ones to drop.
const KEEP = new Set(['notice', 'alarm', 'search', 'missing', 'found', 'dead', 'claim', 'lie']);
const REPORTS_CAP = 30;

export function newCase(about, { by = null, t = 0, day = 1, place = null } = {}) {
  return {
    about,
    status: 'noticed',
    openedAt: t,
    openedBy: by,
    day,
    place, // where it was first noticed
    noticers: by ? [by] : [],
    reports: [], // { by, kind: 'seen'|'checked'|'heard'|'player', place, t, at, with, heading, public, via }
    searched: {}, // placeId -> { by, t }
    searchers: {}, // id -> placeId being searched
    leader: null,
    alarmAt: null,
    alarmBy: null,
    declaredAt: null,
    foundAt: null,
    foundBy: null,
    foundPlace: null,
    deadAt: null,
    closedAt: null,
    timeline: [],
    lyra: { knew: null, asked: null, told: null },
  };
}

export class Cases {
  constructor() {
    this.map = new Map();
  }

  get(about) {
    return this.map.get(about) || null;
  }

  // Open (or reopen) the case for someone the village is missing.
  open(about, opts = {}) {
    let c = this.map.get(about);
    if (c && (c.status === 'found' || c.status === 'dead') && opts.t - (c.closedAt ?? c.foundAt ?? 0) > 60) {
      if (c.status === 'dead') return c;
      this.map.delete(about);
      c = null;
    }
    if (!c) {
      c = newCase(about, opts);
      this.map.set(about, c);
      return c;
    }
    if (opts.by && !c.noticers.includes(opts.by)) c.noticers.push(opts.by);
    return c;
  }

  // Cases still being worked: not found, not closed.
  active() {
    const out = [];
    for (const c of this.map.values()) if (c.status !== 'found' && c.status !== 'dead') out.push(c);
    return out;
  }

  all() {
    return [...this.map.values()];
  }

  note(c, t, text, kind = 'info') {
    if (!c || !text) return;
    const last = c.timeline[c.timeline.length - 1];
    if (last && last.text === text) return;
    c.timeline.push({ t: Math.round(t * 10) / 10, text, kind });
    while (c.timeline.length > TIMELINE_CAP) {
      const i = c.timeline.findIndex((x) => !KEEP.has(x.kind) || /searched .*: nothing\.$/.test(x.text));
      c.timeline.splice(i >= 0 ? i : 0, 1);
    }
  }

  report(c, r) {
    if (!c || !r) return null;
    const same = c.reports.find((x) => x.by === r.by && x.kind === r.kind && Math.abs((x.t ?? 0) - (r.t ?? 0)) < 1);
    if (same) {
      if (r.public) same.public = true;
      return same;
    }
    c.reports.push({ public: false, ...r });
    if (c.reports.length > REPORTS_CAP) c.reports.splice(0, c.reports.length - REPORTS_CAP);
    return c.reports[c.reports.length - 1];
  }

  // The freshest real sighting the village has pieced together.
  lastKnown(c) {
    let best = null;
    for (const r of c?.reports || []) if ((r.kind === 'seen' || r.kind === 'player') && r.place && (!best || r.t > best.t)) best = r;
    return best;
  }

  serialize() {
    return { v: 1, list: this.all().map((c) => ({ ...c, lyra: { ...c.lyra } })) };
  }

  deserialize(d) {
    this.map.clear();
    if (!d || !Array.isArray(d.list)) return;
    for (const c of d.list) {
      if (!c || typeof c.about !== 'string') continue;
      const base = newCase(c.about);
      this.map.set(c.about, {
        ...base,
        ...c,
        noticers: Array.isArray(c.noticers) ? c.noticers.filter((x) => typeof x === 'string') : [],
        reports: Array.isArray(c.reports) ? c.reports.filter((x) => x && typeof x === 'object').slice(-REPORTS_CAP) : [],
        searched: c.searched && typeof c.searched === 'object' ? { ...c.searched } : {},
        searchers: {},
        timeline: Array.isArray(c.timeline) ? c.timeline.filter((x) => x && typeof x.text === 'string').slice(-TIMELINE_CAP) : [],
        lyra: { ...base.lyra, ...(c.lyra || {}) },
      });
    }
  }
}

// ------------------------------------------------------------------ absences

// Someone away from their life: { mode: 'away' (somewhere unexpected, for a while) |
// 'gone' (for good, or until markBack), cause, since, day, until, place, at, seen, keepBody }.
export class Absences {
  constructor() {
    this.map = new Map();
  }

  get(id) {
    return this.map.get(id) || null;
  }

  isGone(id) {
    return this.map.get(id)?.mode === 'gone';
  }

  isAway(id) {
    return this.map.get(id)?.mode === 'away';
  }

  set(id, rec) {
    this.map.set(id, rec);
    return rec;
  }

  delete(id) {
    return this.map.delete(id);
  }

  entries() {
    return [...this.map.entries()];
  }

  serialize() {
    return Object.fromEntries(this.map);
  }

  deserialize(d) {
    this.map.clear();
    if (!d || typeof d !== 'object') return;
    for (const [id, r] of Object.entries(d)) if (r && (r.mode === 'away' || r.mode === 'gone')) this.map.set(id, { ...r });
  }
}
