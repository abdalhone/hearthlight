import { DAY_SECONDS } from '../../core/constants.js';
import { tokenize, clamp, clamp01, normName } from './text.js';

// Episodic memory. Each entry:
//   { id, t (game seconds), day, text, type: 'event'|'fact'|'conversation'|'reflection',
//     importance 1..10, about [ids], location, tags [], emotion, uses, gist?, when?, count?, pinned?,
//     edited?, history?: [{ t, text, importance, why }] }
// Recall scores keyword overlap + entity/place match + importance + recency.
// Consolidation (at sleep) forgets small things and keeps important ones forever.
// Her memory is hers to tend (DESIGN §17.4): edit() rewrites or reframes a memory and keeps
// the earlier version in its history; forget() lets one go and notes why in `forgotten`.

export const MEMORY_LIMITS = Object.freeze({ max: 240, text: 400, gist: 80, tags: 8, about: 6, history: 4, why: 140, forgotten: 16 });

const TYPES = new Set(['event', 'fact', 'conversation', 'reflection']);

export class Memory {
  constructor({ now = () => 0, max = MEMORY_LIMITS.max } = {}) {
    this.list = []; // oldest first
    this.nextId = 1;
    this.now = now;
    this.max = max;
    this.lastAddMerged = false;
    this._tok = new Map(); // id -> Set of stems (not saved)
    this.rev = 0; // bumped on every change, so the recall index knows to refresh
    this.forgotten = []; // [{ id, text, why, t, day }] what she chose to let go, newest last
    this.lifeEdits = new Map(); // life entry id -> { text, history }: how she reframed her past
    this.lastConsolidation = null; // { t, day, removed, merged, faded }
    this.onConsolidate = null; // (memory, report) => void: the mind's own tending at sleep
  }

  // Call after editing memory text in place (e.g. the player renamed themselves).
  touchAll() {
    this._tok.clear();
    this.rev++;
  }

  get size() {
    return this.list.length;
  }

  all() {
    return this.list;
  }

  get(id) {
    return this.list.find((m) => m.id === id) || null;
  }

  recent(n = 10) {
    return this.list.slice(-n);
  }

  // Memories from one game day, most important first.
  ofDay(day) {
    return this.list.filter((m) => m.day === day).sort((a, b) => b.importance - a.importance || b.t - a.t);
  }

  // Store a memory. A near-identical memory from the last couple of minutes is
  // merged instead (a burst of identical events makes one memory, not ten).
  add(entry, { dedupe = true } = {}) {
    this.lastAddMerged = false;
    const now = this.now();
    const text = String(entry.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MEMORY_LIMITS.text);
    if (!text) return null;
    const t = Number.isFinite(entry.t) ? entry.t : now;
    const m = {
      id: entry.id && !this.get(entry.id) ? String(entry.id) : `m${this.nextId++}`,
      t,
      day: Number.isFinite(entry.day) ? entry.day : Math.floor(t / DAY_SECONDS) + 1,
      text,
      type: TYPES.has(entry.type) ? entry.type : 'event',
      importance: clamp(Math.round(Number(entry.importance) || 3), 1, 10),
      about: uniq(entry.about).slice(0, MEMORY_LIMITS.about),
      location: entry.location ? String(entry.location) : null,
      tags: uniq(entry.tags).slice(0, MEMORY_LIMITS.tags),
      emotion: entry.emotion ? String(entry.emotion) : null,
      uses: Number(entry.uses) || 0,
    };
    if (entry.gist) m.gist = String(entry.gist).slice(0, MEMORY_LIMITS.gist);
    if (entry.when) m.when = String(entry.when).slice(0, 40);
    if (entry.count > 1) m.count = entry.count | 0;
    if (entry.pinned || m.importance >= 9) m.pinned = true;
    const hist = cleanHistory(entry.history);
    if (hist.length) m.history = hist;
    if (entry.edited || hist.length) m.edited = true;

    const dup = dedupe ? this._findRecentDuplicate(m) : null;
    if (dup) {
      dup.count = (dup.count || 1) + 1;
      dup.importance = Math.max(dup.importance, m.importance);
      dup.t = Math.max(dup.t, m.t);
      for (const a of m.about) if (!dup.about.includes(a) && dup.about.length < MEMORY_LIMITS.about) dup.about.push(a);
      this.lastAddMerged = true;
      this.rev++;
      return dup;
    }
    if (this.list.length && m.t < this.list[this.list.length - 1].t) {
      // Backdated memories (seeds, imports) keep the list in time order.
      const i = this.list.findIndex((x) => x.t > m.t);
      this.list.splice(i, 0, m);
    } else {
      this.list.push(m);
    }
    this.rev++;
    if (this.list.length > this.max) this.prune();
    return m;
  }

  _findRecentDuplicate(m) {
    const key = normName(m.text);
    const toks = tokenSetOf(m);
    for (let i = this.list.length - 1, n = 0; i >= 0 && n < 12; i--, n++) {
      const o = this.list[i];
      if (m.t - o.t > 150) break;
      if (o.type !== m.type) continue;
      if (normName(o.text) === key) return o;
      if (m.gist && o.gist === m.gist && jaccard(toks, this._tokens(o)) >= 0.75) return o;
    }
    return null;
  }

  remove(id) {
    const i = this.list.findIndex((m) => m.id === id);
    if (i < 0) return null;
    const [m] = this.list.splice(i, 1);
    this._tok.delete(id);
    this.rev++;
    return m;
  }

  // Rewrite or reweigh a memory, keeping the earlier version (DESIGN §17.4). changes:
  // { text, importance, why }. Returns the memory, or null when nothing changed.
  edit(id, { text = null, importance = null, why = '' } = {}) {
    const m = this.get(id);
    if (!m) return null;
    const next = text == null ? m.text : String(text).replace(/\s+/g, ' ').trim().slice(0, MEMORY_LIMITS.text);
    const imp = Number.isFinite(Number(importance)) && importance !== null ? clamp(Math.round(Number(importance)), 1, 10) : m.importance;
    if (!next || (next === m.text && imp === m.importance)) return null;
    const textChanged = next !== m.text;
    pushHistory(m, { t: this.now(), text: m.text, importance: m.importance, why });
    m.text = next;
    m.importance = imp;
    if (textChanged) delete m.gist;
    if (imp >= 9) m.pinned = true;
    this._tok.delete(m.id);
    this.rev++;
    return m;
  }

  // Let a memory go, noting what and why (the memory itself is gone).
  forget(id, why = '') {
    const m = this.remove(id);
    if (!m) return null;
    this.noteForgotten(m, why);
    return m;
  }

  noteForgotten(m, why = '') {
    this.forgotten.push({ id: m.id, text: String(m.gist || m.text).slice(0, 120), why: String(why || '').slice(0, MEMORY_LIMITS.why), t: Math.round(this.now()), day: m.day });
    if (this.forgotten.length > MEMORY_LIMITS.forgotten) this.forgotten.splice(0, this.forgotten.length - MEMORY_LIMITS.forgotten);
  }

  _tokens(m) {
    let s = this._tok.get(m.id);
    if (!s) {
      s = tokenSetOf(m);
      this._tok.set(m.id, s);
    }
    return s;
  }

  // Score every memory for a query. people/places: Sets of ids the query refers to.
  score(query, { about = null, type = null, minImportance = 0, people = null, places = null } = {}) {
    const q = [...new Set(tokenize(query))];
    const pe = people && people.size ? people : null;
    const pl = places && places.size ? places : null;
    const hasQuery = q.length > 0 || !!pe || !!pl;
    const now = this.now();
    const out = [];
    for (const m of this.list) {
      if (about && !m.about.includes(about)) continue;
      if (type && m.type !== type) continue;
      if (m.importance < minImportance) continue;
      let kw = 0;
      if (q.length) {
        const toks = this._tokens(m);
        let hits = 0;
        for (const w of q) if (toks.has(w)) hits++;
        kw = hits / q.length;
      }
      let ent = 0;
      if (pe) for (const a of m.about) if (pe.has(a)) ent = 1;
      let place = 0;
      if (pl && (pl.has(m.location) || m.tags.some((t) => pl.has(t)))) place = 1;
      const match = Math.max(ent, place);
      const relevance = clamp01(kw * 0.6 + match * 0.5 + (kw > 0 && match > 0 ? 0.1 : 0));
      if (hasQuery && relevance <= 0) continue;
      const age = Math.max(0, (now - m.t) / DAY_SECONDS);
      const recency = Math.exp(-age / 3);
      const s = relevance * 3 + (m.importance / 10) * 1.1 + recency * 0.6 + Math.min(m.uses || 0, 5) * 0.04;
      out.push({ memory: m, score: s, relevance });
    }
    out.sort((a, b) => b.score - a.score || b.memory.t - a.memory.t);
    return out;
  }

  recall(query = '', opts = {}) {
    const limit = opts.limit ?? 6;
    const scored = this.score(query, opts).slice(0, limit);
    if (opts.touch !== false) for (const s of scored) s.memory.uses = (s.memory.uses || 0) + 1;
    return scored.map((s) => s.memory);
  }

  // The single best match for loose text (used by "forget ..."), or null.
  bestMatch(text, opts = {}) {
    const s = this.score(text, opts)[0];
    if (!s || s.relevance < (opts.minRelevance ?? 0.3)) return null;
    return s.memory;
  }

  // How much a memory deserves to stay. Pinned memories are never pruned.
  retention(m, now = this.now()) {
    const age = Math.min(30, Math.max(0, (now - m.t) / DAY_SECONDS));
    let r = m.importance + Math.min(m.uses || 0, 6) * 0.5 + ((m.count || 1) > 1 ? 0.4 : 0);
    r -= age * (m.importance >= 7 ? 0.03 : 0.35);
    if (m.type === 'reflection') r += 0.5;
    if (m.pinned) r += 100;
    return r;
  }

  // Drop the least worth keeping until the store fits `max`.
  prune(max = this.max) {
    if (this.list.length <= max) return 0;
    const now = this.now();
    const ranked = this.list.map((m) => ({ m, r: this.retention(m, now) })).sort((a, b) => a.r - b.r);
    const drop = new Set(ranked.slice(0, this.list.length - max).map((x) => x.m.id));
    this.list = this.list.filter((m) => !drop.has(m.id));
    for (const id of drop) this._tok.delete(id);
    this.rev++;
    return drop.size;
  }

  // Sleep consolidation: forget small, stale, unused things; let the day's trivia fade;
  // merge same-day repeats into one memory. Every change keeps a why (DESIGN §17.4).
  // Called by whoever puts her to bed (the brain and the mind both may, the same night):
  // a second call in the same night does nothing.
  consolidate({ force = false } = {}) {
    const now = this.now();
    const day = Math.floor(now / DAY_SECONDS) + 1;
    const last = this.lastConsolidation;
    if (!force && last && last.day === day && Math.abs(now - last.t) < DAY_SECONDS / 4) return { removed: 0, merged: 0, faded: 0, skipped: true };
    let removed = 0;
    let merged = 0;
    let faded = 0;
    const keep = [];
    for (const m of this.list) {
      const age = (now - m.t) / DAY_SECONDS;
      const uses = m.uses || 0;
      let forget = false;
      if (!m.pinned && m.importance < 8) {
        if (m.importance <= 2 && age >= 1 && uses === 0) forget = true;
        else if (m.importance === 3 && age >= 3 && uses < 2) forget = true;
        else if (m.importance === 4 && age >= 6 && uses < 2) forget = true;
        else if (m.importance === 5 && age >= 12 && uses < 3) forget = true;
      }
      if (forget) {
        removed++;
        this._tok.delete(m.id);
        if (m.importance >= 3 || m.edited) this.noteForgotten(m, age >= 3 ? 'Old and small. I let it go.' : 'A small thing. I let it go.');
      } else keep.push(m);
    }
    // Merge near-duplicates from the same day (keep the more important one).
    const out = [];
    for (const m of keep) {
      let target = null;
      if (m.importance < 7) {
        for (let i = out.length - 1; i >= 0 && i >= out.length - 30; i--) {
          const o = out[i];
          if (o.day !== m.day || o.type !== m.type || o.importance >= 7) continue;
          if (jaccard(this._tokens(o), this._tokens(m)) >= 0.7) {
            target = o;
            break;
          }
        }
      }
      if (target) {
        target.count = (target.count || 1) + (m.count || 1);
        target.uses = (target.uses || 0) + (m.uses || 0);
        const why = 'The same moment, remembered twice. I keep it as one.';
        if (m.importance > target.importance) {
          pushHistory(target, { t: now, text: target.text, importance: target.importance, why });
          target.importance = m.importance;
          target.text = m.text;
          this._tok.delete(target.id);
        } else if (m.text !== target.text) pushHistory(target, { t: now, text: m.text, importance: m.importance, why });
        for (const a of m.about) if (!target.about.includes(a) && target.about.length < MEMORY_LIMITS.about) target.about.push(a);
        this._tok.delete(m.id);
        merged++;
      } else out.push(m);
    }
    // The day's small, unremarked things fade a little each night they go unused.
    for (const m of out) {
      if (m.pinned || m.importance !== 2 || (m.uses || 0) > 0) continue;
      const age = (now - m.t) / DAY_SECONDS;
      if (age < 0.25 || m.type === 'reflection') continue;
      pushHistory(m, { t: now, text: m.text, importance: m.importance, why: 'It mattered less than it seemed at the time.' });
      m.importance -= 1;
      faded++;
    }
    this.list = out;
    this.rev++;
    this.prune();
    const report = { removed, merged, faded };
    this.lastConsolidation = { t: Math.round(now), day, ...report };
    if (typeof this.onConsolidate === 'function') {
      try {
        Object.assign(report, this.onConsolidate(this, report) || {});
      } catch (err) {
        console.error('[memory] tending her memories failed', err);
      }
    }
    return report;
  }

  serialize() {
    return {
      n: this.nextId,
      l: this.list.map((m) => {
        const o = { id: m.id, t: Math.round(m.t), day: m.day, text: m.text, type: m.type, importance: m.importance };
        if (m.about.length) o.about = m.about;
        if (m.location) o.location = m.location;
        if (m.tags.length) o.tags = m.tags;
        if (m.emotion) o.emotion = m.emotion;
        if (m.uses) o.uses = m.uses;
        if (m.gist) o.gist = m.gist;
        if (m.when) o.when = m.when;
        if (m.count > 1) o.count = m.count;
        if (m.pinned) o.pinned = true;
        if (m.edited) o.edited = true;
        if (m.history?.length) o.history = m.history.map((h) => ({ ...h }));
        return o;
      }),
      ...(this.forgotten.length ? { f: this.forgotten.map((x) => ({ ...x })) } : {}),
      ...(this.lifeEdits.size ? { life: [...this.lifeEdits].map(([id, e]) => ({ id, text: e.text, importance: e.importance, history: (e.history || []).map((h) => ({ ...h })) })) } : {}),
      ...(this.lastConsolidation ? { c: { ...this.lastConsolidation } } : {}),
    };
  }

  deserialize(d) {
    this.list = [];
    this._tok.clear();
    this.forgotten = [];
    this.lifeEdits.clear();
    if (!d) return;
    if (Array.isArray(d.f)) this.forgotten = d.f.filter((x) => x && x.text).slice(-MEMORY_LIMITS.forgotten).map((x) => ({ id: String(x.id || ''), text: String(x.text).slice(0, 120), why: String(x.why || '').slice(0, MEMORY_LIMITS.why), t: Number(x.t) || 0, day: Number(x.day) || 0 }));
    if (Array.isArray(d.life)) for (const e of d.life) if (e?.id && e.text) this.lifeEdits.set(String(e.id), { text: String(e.text).slice(0, 600), importance: Number.isFinite(e.importance) ? e.importance : undefined, history: cleanHistory(e.history, 600) });
    if (d.c && Number.isFinite(d.c.t)) this.lastConsolidation = { ...d.c };
    const list = Array.isArray(d) ? d : Array.isArray(d.l) ? d.l : [];
    let maxId = 0;
    for (const e of list) {
      if (!e || !e.text) continue;
      const m = this.add({ ...e, t: Number(e.t) || 0 }, { dedupe: false });
      if (m) {
        const num = parseInt(String(m.id).replace(/\D/g, ''), 10);
        if (Number.isFinite(num)) maxId = Math.max(maxId, num);
      }
    }
    this.list.sort((a, b) => a.t - b.t);
    this._tok.clear();
    this.rev++;
    this.nextId = Math.max(Number(d.n) || 1, maxId + 1);
  }
}

// Earlier versions of an entry, oldest first, at most MEMORY_LIMITS.history.
export function cleanHistory(list, maxText = MEMORY_LIMITS.text) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const h of list) {
    if (!h || typeof h !== 'object' || !h.text) continue;
    const e = { t: Math.round(Number(h.t) || 0), text: String(h.text).slice(0, maxText), why: String(h.why || '').slice(0, MEMORY_LIMITS.why) };
    if (Number.isFinite(Number(h.importance)) && h.importance !== null) e.importance = clamp(Math.round(Number(h.importance)), 1, 10);
    if (Number.isFinite(Number(h.confidence)) && h.confidence !== null) e.confidence = Math.round(clamp01(Number(h.confidence)) * 100) / 100;
    if (h.kind) e.kind = String(h.kind).slice(0, 12);
    out.push(e);
  }
  return out.slice(-MEMORY_LIMITS.history);
}

// Keep the earlier version of an entry and mark it edited.
export function pushHistory(entry, version) {
  if (!entry || !version?.text) return;
  const h = cleanHistory([version])[0];
  if (!h) return;
  entry.history = Array.isArray(entry.history) ? entry.history : [];
  entry.history.push(h);
  if (entry.history.length > MEMORY_LIMITS.history) entry.history.splice(0, entry.history.length - MEMORY_LIMITS.history);
  entry.edited = true;
}

function uniq(a) {
  if (!Array.isArray(a)) return a ? [String(a)] : [];
  const out = [];
  for (const x of a) {
    if (x == null || x === '') continue;
    const s = String(x).slice(0, 40);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

function tokenSetOf(m) {
  const s = new Set(tokenize(`${m.text} ${m.gist || ''} ${m.tags.join(' ')} ${m.about.join(' ')} ${m.location || ''}`));
  return s;
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
