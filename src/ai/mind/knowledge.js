import { clamp01, normName, tokenize } from './text.js';
import { cleanHistory, pushHistory, jaccard } from './memory.js';

// What Lyra knows about the world (DESIGN §17.2), as opposed to what happened to her.
// mind.knowledge is this store's `list` (a plain array, so §9 readers keep working):
//   { id: 'k12', subject, text, kind: 'fact'|'lore'|'theory'|'rumor',
//     source: 'lore'|'told'|'observed'|'player'|'inferred', confidence 0..1,
//     about: [ids], loreId, from (who told her), t,
//     edited?, history?: [{ t, text, confidence, kind, why }], retracted?, why? }
// Theories stay theories: hearing the same thing again never turns a belief into a fact.
// She corrects what she knows (DESIGN §17.4): update() keeps the earlier text in history;
// retract() marks a belief she now thinks is wrong (kept, with her reason, so a retracted
// lore entry is not learned again; it is never recalled).

export const KNOWLEDGE_KINDS = ['fact', 'lore', 'theory', 'rumor'];
export const KNOWLEDGE_SOURCES = ['lore', 'told', 'observed', 'player', 'inferred'];
const LIMITS = { max: 260, subject: 60, text: 240, about: 6 };

const DEFAULT_CONFIDENCE = { lore: 1, observed: 0.9, told: 0.75, player: 0.7, inferred: 0.5 };
const KIND_CONFIDENCE = { theory: 0.5, rumor: 0.4 };

// Older callers pass a bare source string ('soul', 'brain', 'claude'...).
const SOURCE_ALIASES = { soul: 'lore', story: 'lore', npc: 'told', heard: 'told', overheard: 'told', brain: 'inferred', claude: 'inferred', self: 'inferred', seen: 'observed', place: 'observed' };

export function normalizeSource(src) {
  const s = String(src || '').toLowerCase();
  if (KNOWLEDGE_SOURCES.includes(s)) return s;
  return SOURCE_ALIASES[s] || 'observed';
}

export function normalizeKind(kind, source) {
  const k = String(kind || '').toLowerCase();
  if (KNOWLEDGE_KINDS.includes(k)) return k;
  if (k === 'belief' || k === 'guess' || k === 'hypothesis') return 'theory';
  if (k === 'gossip' || k === 'hearsay') return 'rumor';
  return source === 'lore' ? 'lore' : 'fact';
}

export class KnowledgeStore {
  constructor({ now = () => 0, max = LIMITS.max } = {}) {
    this.list = [];
    this.nextId = 1;
    this.now = now;
    this.max = max;
    this.rev = 0; // bumped on every change, so the recall index knows to refresh
  }

  get size() {
    return this.list.length;
  }

  all() {
    return this.list;
  }

  get(id) {
    return this.list.find((k) => k.id === id) || null;
  }

  byLore(loreId) {
    return this.list.find((k) => k.loreId === loreId) || null;
  }

  knowsLore(loreId) {
    return !!this.byLore(loreId);
  }

  // What she still believes (everything she has not retracted).
  active() {
    return this.list.filter((k) => !k.retracted);
  }

  // Entries whose subject matches (loosely), or that are about an id.
  about(subjectOrId, { includeRetracted = false } = {}) {
    const n = normName(subjectOrId);
    if (!n) return [];
    return this.list.filter((k) => {
      if (k.retracted && !includeRetracted) return false;
      if (k.about.includes(String(subjectOrId))) return true;
      const s = normName(k.subject);
      return s && (s === n || s.includes(n) || n.includes(s));
    });
  }

  // Add or refresh. opts: { kind, source, confidence, about, loreId, from, t, id }.
  add(subject, text, opts = {}) {
    if (typeof opts === 'string') opts = { source: opts };
    const subj = String(subject ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.subject);
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.text).trim();
    if (!subj || !clean) return null;
    const source = normalizeSource(opts.source);
    const kind = normalizeKind(opts.kind, source);
    const base = KIND_CONFIDENCE[kind] ?? DEFAULT_CONFIDENCE[source] ?? 0.7;
    const confidence = clamp01(Number.isFinite(Number(opts.confidence)) && opts.confidence !== null ? Number(opts.confidence) : base);
    const about = uniq(opts.about).slice(0, LIMITS.about);
    const t = Number.isFinite(opts.t) ? opts.t : this.now();

    const existing = (opts.loreId && this.byLore(String(opts.loreId))) || this._same(subj, clean, kind);
    if (existing) {
      // Something she retracted, heard again: she does not simply believe it again.
      if (existing.retracted) return existing;
      existing.t = Math.max(existing.t, t);
      // Hearing a fact again from a better source makes her surer; a theory stays a theory.
      if (kind !== 'theory' && existing.kind !== 'theory') existing.confidence = Math.max(existing.confidence, confidence);
      for (const a of about) if (!existing.about.includes(a) && existing.about.length < LIMITS.about) existing.about.push(a);
      this.rev++;
      return existing;
    }
    const k = {
      id: opts.id && !this.get(String(opts.id)) ? String(opts.id) : `k${this.nextId++}`,
      subject: subj,
      text: clean,
      kind,
      source,
      confidence: Math.round(confidence * 100) / 100,
      about,
      loreId: opts.loreId ? String(opts.loreId) : null,
      from: opts.from ? String(opts.from) : null,
      t,
    };
    const hist = cleanHistory(opts.history, LIMITS.text);
    if (hist.length) k.history = hist;
    if (opts.edited || hist.length) k.edited = true;
    if (opts.retracted) {
      k.retracted = true;
      if (opts.why) k.why = String(opts.why).slice(0, 140);
    }
    this.list.push(k);
    if (this.list.length > this.max) this.prune();
    this.rev++;
    return k;
  }

  _same(subject, text, kind) {
    const s = normName(subject);
    const t = normName(text);
    return this.list.find((k) => normName(k.text) === t && (normName(k.subject) === s || k.kind === kind)) || null;
  }

  // Correct or update an entry, keeping what she believed before. changes:
  // { text, confidence, kind, why }. Returns the entry, or null when nothing changed.
  update(id, { text = null, confidence = null, kind = null, why = '' } = {}) {
    const k = this.get(id);
    if (!k) return null;
    const next = text == null ? k.text : String(text).replace(/\s+/g, ' ').trim().slice(0, LIMITS.text);
    const conf = Number.isFinite(Number(confidence)) && confidence !== null ? Math.round(clamp01(Number(confidence)) * 100) / 100 : k.confidence;
    const nk = kind ? normalizeKind(kind, k.source) : k.kind;
    if (!next || (next === k.text && conf === k.confidence && nk === k.kind && !k.retracted)) return null;
    pushHistory(k, { t: this.now(), text: k.text, confidence: k.confidence, kind: k.kind, why });
    k.text = next;
    k.confidence = conf;
    k.kind = nk;
    if (k.retracted) {
      delete k.retracted;
      delete k.why;
    }
    this.rev++;
    return k;
  }

  // She no longer believes it. The entry stays (with her reason) but is never recalled.
  retract(id, why = '') {
    const k = this.get(id);
    if (!k || k.retracted) return null;
    pushHistory(k, { t: this.now(), text: k.text, confidence: k.confidence, kind: k.kind, why: why || 'I stopped believing it.' });
    k.retracted = true;
    k.why = String(why || 'I stopped believing it.').slice(0, 140);
    k.retractedT = Math.round(this.now());
    this.rev++;
    return k;
  }

  // Older beliefs that newer knowledge has overtaken: same subject, the same claim told
  // differently, and the newer one at least as sure. -> [{ old, newer }]
  superseded(since = -Infinity) {
    const out = [];
    const live = this.list.filter((k) => !k.retracted && k.source !== 'lore');
    const fresh = live.filter((k) => k.t >= since);
    for (const newer of fresh) {
      const s = normName(newer.subject);
      const nt = new Set(tokenize(newer.text));
      for (const old of live) {
        if (old === newer || old.t >= newer.t || out.some((x) => x.old === old)) continue;
        if (normName(old.subject) !== s || normName(old.text) === normName(newer.text)) continue;
        if (RELIABILITY[newer.kind] < RELIABILITY[old.kind] && newer.confidence < old.confidence) continue;
        if (jaccard(new Set(tokenize(old.text)), nt) < 0.3) continue;
        out.push({ old, newer });
      }
    }
    return out;
  }

  remove(id) {
    const i = this.list.findIndex((k) => k.id === id);
    if (i < 0) return null;
    this.rev++;
    return this.list.splice(i, 1)[0];
  }

  // Forget the least valuable things she was told or guessed; lore she knows stays.
  prune(max = this.max) {
    if (this.list.length <= max) return 0;
    const now = this.now();
    const worth = (k) => (k.source === 'lore' ? 100 : 0) + k.confidence * 2 + (k.loreId ? 3 : 0) + (k.source === 'player' ? 1 : 0) - Math.min(5, (now - k.t) / 9000) - (k.retracted && !k.loreId ? 4 : 0);
    const ranked = this.list.map((k) => ({ k, w: worth(k) })).sort((a, b) => a.w - b.w);
    const drop = new Set(ranked.slice(0, this.list.length - max).map((x) => x.k.id));
    const before = this.list.length;
    // In place, so mind.knowledge stays the same array.
    const keep = this.list.filter((k) => !drop.has(k.id));
    this.list.length = 0;
    this.list.push(...keep);
    this.rev++;
    return before - keep.length;
  }

  // Lore-backed entries are saved as a reference and rebuilt from the lorebook on load.
  serialize(lorebook = null) {
    return {
      n: this.nextId,
      l: this.list.map((k) => {
        const lore = k.loreId && lorebook ? loreText(lorebook, k.loreId) : null;
        const o = { id: k.id, s: k.subject, k: k.kind, src: k.source, c: k.confidence, t: Math.round(k.t) };
        if (!lore || lore.text !== k.text || lore.subject !== k.subject) {
          o.s = k.subject;
          o.x = k.text;
        } else delete o.s;
        if (k.about.length) o.a = k.about;
        if (k.loreId) o.lore = k.loreId;
        if (k.from) o.f = k.from;
        if (k.edited) o.e = 1;
        if (k.history?.length) o.h = k.history.map((h) => ({ ...h }));
        if (k.retracted) {
          o.r = 1;
          if (k.why) o.w = k.why;
          // A retracted lore entry keeps its words: the story's version is what she let go of.
          if (o.x == null) {
            o.s = k.subject;
            o.x = k.text;
          }
        }
        return o;
      }),
    };
  }

  deserialize(d, lorebook = null) {
    this.list.length = 0;
    if (!d) return;
    const list = Array.isArray(d) ? d : Array.isArray(d.l) ? d.l : [];
    let maxId = 0;
    for (const e of list) {
      if (!e) continue;
      // Old saves (§9 shape): { subject, text, t, source }.
      let subject = e.s ?? e.subject;
      let text = e.x ?? e.text;
      const loreId = e.lore ?? e.loreId ?? null;
      if ((!text || !subject) && loreId && lorebook) {
        const lt = loreText(lorebook, loreId);
        if (!lt) continue; // the story changed and that lore is gone
        subject = subject || lt.subject;
        text = text || lt.text;
      }
      if (!subject || !text) continue;
      const k = this.add(subject, text, {
        id: e.id,
        kind: e.k ?? e.kind,
        source: e.src ?? e.source,
        confidence: e.c ?? e.confidence,
        about: e.a ?? e.about,
        loreId,
        from: e.f ?? e.from,
        t: Number(e.t) || 0,
        history: e.h ?? e.history,
        edited: !!(e.e ?? e.edited),
        retracted: !!(e.r ?? e.retracted),
        why: e.w ?? e.why,
      });
      const num = parseInt(String(k?.id || '').replace(/\D/g, ''), 10);
      if (Number.isFinite(num)) maxId = Math.max(maxId, num);
    }
    this.nextId = Math.max(Number(d.n) || 1, maxId + 1);
    this.rev++;
  }
}

// How much a kind of knowledge is worth against another when they disagree.
const RELIABILITY = { lore: 3, fact: 2, theory: 1, rumor: 0 };

// The subject and text a lore-backed entry has (a mystery clue is 'mysteryId#index').
export function loreText(lorebook, loreId) {
  const id = String(loreId);
  const hash = id.indexOf('#');
  if (hash > 0) {
    const m = lorebook.get(id.slice(0, hash));
    const clue = m?.clues?.[Number(id.slice(hash + 1))];
    return clue ? { subject: m.question, text: clue.text } : null;
  }
  const e = lorebook.get(id);
  if (!e) return null;
  return { subject: e.title, text: e.text };
}

function uniq(a) {
  if (!a) return [];
  if (!Array.isArray(a)) a = [a];
  const out = [];
  for (const x of a) {
    if (x == null || x === '') continue;
    const s = String(x).slice(0, 40);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}
