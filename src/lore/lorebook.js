import { STORY } from './story.js';
import { tokenize, normName } from '../ai/mind/text.js';

// The lorebook: the story (story.js) as searchable entries. Every entry, whatever array it
// came from, is normalized to one shape so the rest of the game can treat lore uniformly:
//
//   { id, key: 'kind:id', kind: 'world'|'timeline'|'place'|'person'|'life'|'mystery',
//     title, text, tags, aliases, knownBy: ['lyra'|'everyone'|npcId], secret,
//     locationId?, npcId?, name?, when?, age?, people?, places?, feeling?, importance?,
//     question?, clues? }
//
// Mystery truths are kept on the entry (get(id).truth) but never indexed or searched, so
// nothing that searches the lorebook can leak them into what Lyra knows or says.

const KINDS = ['world', 'timeline', 'place', 'person', 'life', 'mystery'];
const SOURCES = { world: 'world', timeline: 'timeline', places: 'place', people: 'person', lyraLife: 'life', mysteries: 'mystery' };
const BM25 = { k1: 1.2, b: 0.75 };

function strList(v) {
  if (v == null) return [];
  if (!Array.isArray(v)) v = [v];
  return v.filter((x) => x != null && x !== '').map(String);
}

function normalize(raw, kind, i) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const id = String(r.id ?? `${kind}_${i}`);
  const e = {
    id,
    key: `${kind}:${id}`,
    kind,
    title: String(r.title ?? r.name ?? r.question ?? id),
    text: String(r.text ?? ''),
    tags: strList(r.tags),
    aliases: strList(r.aliases),
    knownBy: strList(r.knownBy),
    secret: !!r.secret,
  };
  if (kind === 'place') e.locationId = r.locationId ? String(r.locationId) : null;
  if (kind === 'person') {
    e.npcId = r.npcId ? String(r.npcId) : null;
    e.name = String(r.name ?? e.title);
    // The title ("the blacksmith") reads as a description; the name is the heading.
    e.role = r.title ? String(r.title) : null;
    e.title = e.name;
  }
  if (kind === 'timeline') e.when = r.when != null ? String(r.when) : '';
  if (kind === 'life') {
    e.age = Number.isFinite(Number(r.age)) ? Number(r.age) : null;
    e.people = strList(r.people);
    e.places = strList(r.places);
    e.feeling = r.feeling ? String(r.feeling) : null;
    e.importance = Math.max(1, Math.min(10, Math.round(Number(r.importance) || 6)));
  }
  if (kind === 'mystery') {
    e.question = String(r.question ?? e.title);
    e.title = e.question;
    e.clues = (Array.isArray(r.clues) ? r.clues : []).filter((c) => c && c.text).map((c) => ({ text: String(c.text), foundAt: c.foundAt ? String(c.foundAt) : null }));
    e.text = e.clues.map((c) => c.text).join(' ');
    Object.defineProperty(e, 'truth', { value: r.truth != null ? String(r.truth) : '', enumerable: false });
  }
  // Defaults for who knows what: her own life is hers; history is common knowledge;
  // the rest must say who knows it.
  if (!e.knownBy.length) {
    if (kind === 'life') e.knownBy = ['lyra'];
    else if (kind === 'timeline' && !e.secret) e.knownBy = ['everyone'];
  }
  return e;
}

export class Lorebook {
  constructor(story = STORY) {
    this.story = story || {};
    this.placeholder = !!this.story.placeholder;
    this.title = String(this.story.title || '');
    this.premise = String(this.story.premise || '');
    this.entries = [];
    this.byId = new Map();
    this.byKey = new Map();
    for (const [field, kind] of Object.entries(SOURCES)) {
      const list = Array.isArray(this.story[field]) ? this.story[field] : [];
      list.forEach((raw, i) => this._add(normalize(raw, kind, i)));
    }
    this._buildIndex();
  }

  _add(e) {
    this.entries.push(e);
    this.byKey.set(e.key, e);
    if (!this.byId.has(e.id)) this.byId.set(e.id, e);
  }

  get size() {
    return this.entries.length;
  }

  // By id ('waygates') or by key ('world:waygates', for ids shared between arrays).
  get(id) {
    if (!id) return null;
    const s = String(id);
    return this.byKey.get(s) || this.byId.get(s) || null;
  }

  all(kind = null) {
    if (!kind) return this.entries.slice();
    return this.entries.filter((e) => e.kind === kind);
  }

  life() {
    return this.all('life').sort((a, b) => (a.age ?? 0) - (b.age ?? 0));
  }

  isKnownBy(entry, actorId) {
    if (!entry || !actorId) return false;
    if (entry.kind === 'mystery') return false;
    const kb = entry.knownBy;
    return kb.includes('everyone') || kb.includes(String(actorId));
  }

  // Everything an actor knows (mysteries are questions, not knowledge, so never listed).
  knownBy(actorId) {
    return this.entries.filter((e) => this.isKnownBy(e, actorId));
  }

  forLocation(locationId) {
    return this.entries.filter((e) => e.locationId === locationId || (e.kind === 'life' && e.places.includes(locationId)));
  }

  forPerson(personId) {
    return this.entries.filter((e) => (e.kind === 'person' && (e.npcId === personId || e.id === personId)) || (e.kind === 'life' && e.people.includes(personId)));
  }

  withTag(tag) {
    const t = String(tag || '').toLowerCase();
    return this.entries.filter((e) => e.tags.some((x) => x.toLowerCase() === t));
  }

  // Mystery clues found at a place, from a person or in an item: [{ mystery, clue, index, id }].
  cluesAt(foundAt) {
    const out = [];
    for (const m of this.all('mystery')) {
      m.clues.forEach((clue, index) => {
        if (clue.foundAt === foundAt) out.push({ mystery: m, clue, index, id: `${m.id}#${index}` });
      });
    }
    return out;
  }

  // Lore entries about `topic`, best first. opts.knownBy limits to what that actor knows;
  // opts.kinds limits kinds; mysteries are included only when asked for (questions and
  // clues, never truths).
  search(query, { limit = 5, knownBy = null, kinds = null, mysteries = false, minScore = 0.05 } = {}) {
    const q = [...new Set(tokenize(query))];
    const phrase = ` ${normName(query)} `;
    if (!q.length && !phrase.trim()) return [];
    const out = [];
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (kinds && !kinds.includes(e.kind)) continue;
      if (e.kind === 'mystery' && !mysteries) continue;
      if (knownBy && e.kind !== 'mystery' && !this.isKnownBy(e, knownBy)) continue;
      let s = this._bm25(i, q);
      // An exact name, alias or title in the query is the strongest signal there is.
      for (const n of this._names[i]) if (n.length >= 3 && phrase.includes(` ${n} `)) s += 3;
      if (s <= minScore) continue;
      out.push({ entry: e, score: s });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit).map((x) => ({ ...x.entry, score: Math.round(x.score * 100) / 100 }));
  }

  _buildIndex() {
    this._docs = [];
    this._names = [];
    this._df = new Map();
    let total = 0;
    for (const e of this.entries) {
      // Titles and aliases count twice: they are what people call the thing.
      const head = `${e.title} ${e.aliases.join(' ')} ${e.name || ''}`;
      const body = `${e.text} ${e.tags.join(' ')} ${e.role || ''} ${e.when || ''} ${e.question || ''}`;
      const toks = [...tokenize(head), ...tokenize(head), ...tokenize(body)];
      const tf = new Map();
      for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
      for (const t of tf.keys()) this._df.set(t, (this._df.get(t) || 0) + 1);
      this._docs.push({ tf, len: toks.length });
      total += toks.length;
      const names = new Set([e.title, e.name, ...e.aliases, e.id.replace(/_/g, ' ')].filter(Boolean).map((x) => normName(x).replace(/^the /, '')));
      this._names.push([...names].filter(Boolean));
    }
    this._avg = this.entries.length ? total / this.entries.length : 1;
  }

  _bm25(i, q) {
    const d = this._docs[i];
    if (!d || !q.length) return 0;
    const N = this.entries.length;
    let s = 0;
    for (const t of q) {
      const tf = d.tf.get(t);
      if (!tf) continue;
      const df = this._df.get(t) || 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      s += (idf * tf * (BM25.k1 + 1)) / (tf + BM25.k1 * (1 - BM25.b + (BM25.b * d.len) / this._avg));
    }
    return s;
  }
}

export { KINDS as LORE_KINDS };

let shared = null;
// The lorebook for the built-in story, built once.
export function defaultLorebook() {
  if (!shared) shared = new Lorebook(STORY);
  return shared;
}
