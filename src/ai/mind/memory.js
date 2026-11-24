import { DAY_SECONDS } from '../../core/constants.js';
import { tokenize, clamp, clamp01, normName } from './text.js';

// Episodic memory. Each entry:
//   { id, t (game seconds), day, text, type: 'event'|'fact'|'conversation'|'reflection',
//     importance 1..10, about [ids], location, tags [], emotion, uses, gist?, when?, count?, pinned? }
// Recall scores keyword overlap + entity/place match + importance + recency.
// Consolidation (at sleep) forgets small things and keeps important ones forever.

export const MEMORY_LIMITS = Object.freeze({ max: 240, text: 280, gist: 80, tags: 8, about: 6 });

const TYPES = new Set(['event', 'fact', 'conversation', 'reflection']);

export class Memory {
  constructor({ now = () => 0, max = MEMORY_LIMITS.max } = {}) {
    this.list = []; // oldest first
    this.nextId = 1;
    this.now = now;
    this.max = max;
    this.lastAddMerged = false;
    this._tok = new Map(); // id -> Set of stems (not saved)
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

    const dup = dedupe ? this._findRecentDuplicate(m) : null;
    if (dup) {
      dup.count = (dup.count || 1) + 1;
      dup.importance = Math.max(dup.importance, m.importance);
      dup.t = Math.max(dup.t, m.t);
      for (const a of m.about) if (!dup.about.includes(a) && dup.about.length < MEMORY_LIMITS.about) dup.about.push(a);
      this.lastAddMerged = true;
      return dup;
    }
    if (this.list.length && m.t < this.list[this.list.length - 1].t) {
      // Backdated memories (seeds, imports) keep the list in time order.
      const i = this.list.findIndex((x) => x.t > m.t);
      this.list.splice(i, 0, m);
    } else {
      this.list.push(m);
    }
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
    return m;
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
    return drop.size;
  }

  // Sleep consolidation: forget small, stale, unused things; merge same-day repeats.
  consolidate() {
    const now = this.now();
    let removed = 0;
    let merged = 0;
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
        if (m.importance > target.importance) {
          target.importance = m.importance;
          target.text = m.text;
          this._tok.delete(target.id);
        }
        this._tok.delete(m.id);
        merged++;
      } else out.push(m);
    }
    this.list = out;
    this.prune();
    return { removed, merged };
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
        return o;
      }),
    };
  }

  deserialize(d) {
    this.list = [];
    this._tok.clear();
    if (!d) return;
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
    this.nextId = Math.max(Number(d.n) || 1, maxId + 1);
  }
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
