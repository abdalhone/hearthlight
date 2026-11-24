import { DAY_SECONDS, PLAYER_ID } from '../../core/constants.js';
import { tokenize, clamp01, shorten, firstSentence } from './text.js';
import { buildLinker } from './linker.js';
import { bondOf } from './relationships.js';

// mind.index (DESIGN §17.2): one inverted index over her four stores, so a question, a
// place or a face can find what matters across her whole mind.
//
//   life       her autobiography (from the story)          key 'life:<id>'
//   episode    what happened since the game began          key 'episode:<memory id>'
//   knowledge  facts, lore, rumors and her own theories     key 'knowledge:<k id>'
//   person     what she knows of each person (a dossier)    key 'person:<id>'
//
// Score = BM25 text relevance + entity match (names, roles, places, items linked to ids)
// + importance + recency + emotional weight + activation (working memory, recent recall)
// + association spread (records sharing people or places with the best hits).
// Stores are re-indexed lazily when they change; nothing here is saved.

export const STORES = ['life', 'episode', 'knowledge', 'person'];
const BM25 = { k1: 1.2, b: 0.75 };
const W = { relevance: 2.5, assoc: 0.35, importance: 0.6, recency: 0.4, emotion: 0.3, activation: 0.5 };
const STRONG_FEELINGS = new Set(['fear', 'sadness', 'anger', 'joy', 'affection', 'trust', 'pride', 'love', 'grief']);
// Entities too common to carry an association (nearly every memory involves them).
const GENERIC = new Set([`person:${PLAYER_ID}`, 'person:lyra', 'place:hearthvale']);
const RECALL_HALF_LIFE = 300; // real seconds for "I was just thinking about that" to fade

export function emotionWeight(name) {
  if (!name) return 0;
  return STRONG_FEELINGS.has(String(name)) ? 1 : 0.5;
}

export class MemoryIndex {
  constructor(mind) {
    this.mind = mind;
    this.docs = new Map(); // key -> doc
    this.post = new Map(); // term -> Map(doc key -> term frequency)
    this.byEnt = new Map(); // entity key -> Set(doc key)
    this.totalLen = 0;
    this.sigs = {};
    this.linker = null;
    this._linkerSig = null;
    this.recent = new Map(); // doc key -> { a, t }
  }

  get size() {
    this.refresh();
    return this.docs.size;
  }

  now() {
    return this.mind?.now?.() ?? 0;
  }

  rt() {
    return this.mind?.perception?.rt?.() ?? 0;
  }

  // ---------------------------------------------------------------- building

  refresh() {
    const m = this.mind;
    const lsig = this._linkerSignature();
    if (!this.linker || lsig !== this._linkerSig) {
      this.linker = buildLinker(m);
      this._linkerSig = lsig;
      this.sigs = {}; // every record must be re-linked with the new vocabulary
    }
    const life = m.life || [];
    this._sync('life', `${life.length}:${life[0]?.id || ''}`, () => life.map((e) => this._lifeDoc(e)));
    const mem = m.memory;
    this._sync('episode', `${mem?.size || 0}:${mem?.rev || 0}`, () => (mem ? mem.all().map((x) => this._episodeDoc(x)) : []));
    const kn = m.knowledgeStore;
    this._sync('knowledge', `${kn?.size || 0}:${kn?.rev || 0}`, () => (kn ? kn.all().map((x) => this._knowledgeDoc(x)) : []));
    this._sync('person', this._peopleSignature(), () => this._personDocs());
  }

  _linkerSignature() {
    const m = this.mind;
    const g = m?.game;
    let profiles = 0;
    for (const e of g?.entities?.all?.() || []) if (e?.profile) profiles++;
    return `${m?.relationships?.size || 0}:${profiles}:${g?.locations?.all?.()?.length || 0}:${g?.settings?.playerName || ''}:${m?.lorebook?.size || 0}`;
  }

  _peopleSignature() {
    let n = 0;
    let s = 0;
    for (const r of this.mind?.relationships?.map?.values?.() || []) {
      n++;
      s += (r.notes?.length || 0) * 7 + (Math.round(r.opinionT) || 0) + (r.tags?.length || 0) * 3 + (r.firstMet != null ? 1 : 0);
    }
    return `${n}:${s}`;
  }

  _sync(store, sig, build) {
    if (this.sigs[store] === sig) return;
    this.sigs[store] = sig;
    for (const key of [...this.docs.keys()]) if (this.docs.get(key).store === store) this._remove(key);
    for (const d of build()) if (d) this._add(d);
  }

  _add(doc) {
    const toks = tokenize(doc.body);
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    doc.tf = tf;
    doc.len = toks.length || 1;
    this.docs.set(doc.key, doc);
    this.totalLen += doc.len;
    for (const [t, n] of tf) {
      let p = this.post.get(t);
      if (!p) this.post.set(t, (p = new Map()));
      p.set(doc.key, n);
    }
    for (const e of doc.ents) {
      let s = this.byEnt.get(e);
      if (!s) this.byEnt.set(e, (s = new Set()));
      s.add(doc.key);
    }
  }

  _remove(key) {
    const doc = this.docs.get(key);
    if (!doc) return;
    this.docs.delete(key);
    this.totalLen -= doc.len;
    for (const t of doc.tf.keys()) {
      const p = this.post.get(t);
      if (p) {
        p.delete(key);
        if (!p.size) this.post.delete(t);
      }
    }
    for (const e of doc.ents) {
      const s = this.byEnt.get(e);
      if (s) {
        s.delete(key);
        if (!s.size) this.byEnt.delete(e);
      }
    }
  }

  _lifeDoc(e) {
    const body = `${e.title} ${e.text}`;
    return {
      key: `life:${e.id}`,
      store: 'life',
      id: e.id,
      ref: e,
      label: e.title,
      text: e.text,
      body,
      ents: this.linker.linkRecord(body, { about: e.people, places: e.places }),
      importance: e.importance || 6,
      t: null,
      emotion: emotionWeight(e.feeling),
    };
  }

  _episodeDoc(m) {
    const body = `${m.text} ${m.gist || ''} ${(m.tags || []).join(' ')}`;
    return {
      key: `episode:${m.id}`,
      store: 'episode',
      id: m.id,
      ref: m,
      label: m.gist || shorten(firstSentence(m.text, 90), 70),
      text: m.text,
      body,
      ents: this.linker.linkRecord(body, { about: m.about, places: m.location ? [m.location] : [], tags: m.tags }),
      importance: m.importance || 3,
      t: m.t,
      emotion: emotionWeight(m.emotion),
    };
  }

  _knowledgeDoc(k) {
    const body = `${k.subject} ${k.text}`;
    const ents = this.linker.linkRecord(body, { about: k.about });
    if (k.loreId) {
      const base = String(k.loreId).split('#')[0];
      const lore = this.mind?.lorebook?.get?.(base);
      if (lore?.kind === 'world') ents.add(`lore:${lore.id}`);
      else if (lore?.kind === 'person') ents.add(`person:${lore.npcId || lore.id}`);
      else if (lore?.kind === 'place' && lore.locationId) ents.add(`place:${lore.locationId}`);
    }
    const base = { lore: 5, fact: 4, rumor: 3, theory: 4 }[k.kind] ?? 4;
    return {
      key: `knowledge:${k.id}`,
      store: 'knowledge',
      id: k.id,
      ref: k,
      label: k.subject,
      text: k.text,
      body,
      ents,
      importance: base + Math.round((k.confidence ?? 0.7) * 2),
      t: k.t,
      emotion: 0,
    };
  }

  _personDocs() {
    const out = [];
    for (const r of this.mind?.relationships?.map?.values?.() || []) {
      if (r.kind === 'group' || (r.firstMet == null && !r.absent && r.id !== PLAYER_ID)) continue;
      const notes = (r.notes || []).map((n) => n.text).join(' ');
      const body = `${r.name} ${r.role || ''} ${r.opinion || ''} ${notes} ${(r.tags || []).join(' ')}`;
      const ents = this.linker.link(body);
      ents.add(`person:${r.id}`);
      out.push({
        key: `person:${r.id}`,
        store: 'person',
        id: r.id,
        ref: r,
        label: r.name,
        text: r.opinion || r.name,
        body,
        ents,
        importance: 3 + bondOf(r).level,
        t: r.lastSeen ?? null,
        emotion: Math.abs(r.affinity) >= 50 || r.fear >= 30 ? 1 : 0,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- querying

  link(text, opts) {
    this.refresh();
    return this.linker.link(text, opts);
  }

  label(entKey) {
    this.refresh();
    return this.linker.label(entKey);
  }

  get(key) {
    this.refresh();
    return this.docs.get(key) || null;
  }

  // How "warm" a record is: recently recalled, or on her mind right now.
  activation(doc) {
    let a = 0;
    const r = this.recent.get(doc.key);
    if (r) a = r.a * Math.pow(0.5, Math.max(0, this.rt() - r.t) / RECALL_HALF_LIFE);
    const wm = this.mind?.workingMemory;
    if (wm) {
      a = Math.max(a, wm.activationOf(doc.key));
      for (const e of doc.ents) {
        const ea = wm.activationOf(e);
        if (ea) a = Math.max(a, ea * 0.5);
      }
    }
    return clamp01(a);
  }

  touch(key, amount = 0.5) {
    const now = this.rt();
    const r = this.recent.get(key);
    const prev = r ? r.a * Math.pow(0.5, Math.max(0, now - r.t) / RECALL_HALF_LIFE) : 0;
    this.recent.set(key, { a: clamp01(prev + amount), t: now });
    if (this.recent.size > 200) {
      for (const [k, v] of this.recent) if (now - v.t > RECALL_HALF_LIFE * 4) this.recent.delete(k);
    }
  }

  _salience(doc, now) {
    const age = doc.t == null ? Infinity : Math.max(0, (now - doc.t) / DAY_SECONDS);
    const recency = Number.isFinite(age) ? Math.exp(-age / 4) : 0;
    return W.importance * (doc.importance / 10) + W.recency * recency + W.emotion * doc.emotion + W.activation * this.activation(doc);
  }

  // Ranked records for a query. opts: { limit, stores, about (hard filter: a person id),
  // entities (extra entity keys), filter(doc), spread, touch, minScore }.
  // Returns [{ key, store, id, label, text, score, relevance, ref }].
  search(query = '', opts = {}) {
    this.refresh();
    const { limit = 8, stores = null, about = null, filter = null, spread = true, touch = false, minScore = 0 } = opts;
    const q = [...new Set(tokenize(query))];
    const qEnts = this.linker.link(query, { query: true });
    for (const e of opts.entities || []) qEnts.add(e);
    const aboutKey = about ? this.linker.keyForId(about) : null;
    const now = this.now();
    const allow = (d) => (!stores || stores.includes(d.store)) && (!aboutKey || d.ents.has(aboutKey)) && (!filter || filter(d));

    // No words and no names: what is most salient right now.
    if (!q.length && !qEnts.size) {
      const out = [];
      for (const d of this.docs.values()) if (allow(d)) out.push({ d, rel: 0, score: this._salience(d, now) });
      return this._finish(out, limit, touch, minScore);
    }

    const N = this.docs.size || 1;
    const avg = this.totalLen / N || 1;
    const cands = new Map(); // key -> { d, bm }
    for (const t of q) {
      const p = this.post.get(t);
      if (!p) continue;
      const idf = Math.log(1 + (N - p.size + 0.5) / (p.size + 0.5));
      for (const [key, tf] of p) {
        const d = this.docs.get(key);
        if (!allow(d)) continue;
        const c = cands.get(key) || { d, bm: 0 };
        c.bm += (idf * tf * (BM25.k1 + 1)) / (tf + BM25.k1 * (1 - BM25.b + (BM25.b * d.len) / avg));
        cands.set(key, c);
      }
    }
    for (const e of qEnts) {
      for (const key of this.byEnt.get(e) || []) {
        if (cands.has(key)) continue;
        const d = this.docs.get(key);
        if (allow(d)) cands.set(key, { d, bm: 0 });
      }
    }
    const nEnts = qEnts.size;
    const scored = [];
    for (const c of cands.values()) {
      const text = c.bm / (c.bm + 2.5);
      let hit = 0;
      if (nEnts) for (const e of qEnts) if (c.d.ents.has(e)) hit++;
      const ent = nEnts ? hit / nEnts : 0;
      const rel = clamp01(0.6 * text + 0.6 * ent + (text > 0 && ent > 0 ? 0.1 : 0));
      if (rel <= 0) continue;
      scored.push({ d: c.d, rel, score: W.relevance * rel + this._salience(c.d, now) });
    }

    // Association spread: what shares people and places with the best hits.
    if (spread && scored.length) {
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, 3);
      const assoc = new Map();
      for (const h of top) {
        const ents = [...h.d.ents].filter((e) => !GENERIC.has(e) && !qEnts.has(e));
        if (!ents.length) continue;
        for (const e of ents) {
          for (const key of this.byEnt.get(e) || []) {
            if (key === h.d.key) continue;
            const d = this.docs.get(key);
            if (!allow(d)) continue;
            let shared = 0;
            for (const x of ents) if (d.ents.has(x)) shared++;
            const a = (shared / ents.length) * h.rel;
            if (a > (assoc.get(key) || 0)) assoc.set(key, a);
          }
        }
      }
      const byKey = new Map(scored.map((s) => [s.d.key, s]));
      for (const [key, a] of assoc) {
        const s = byKey.get(key);
        if (s) s.score += W.relevance * W.assoc * a;
        else if (a >= 0.34) {
          const d = this.docs.get(key);
          scored.push({ d, rel: 0, assoc: a, score: W.relevance * W.assoc * a + this._salience(d, now) });
        }
      }
    }
    return this._finish(scored, limit, touch, minScore);
  }

  _finish(list, limit, touch, minScore) {
    list.sort((a, b) => b.score - a.score || (b.d.t ?? -1) - (a.d.t ?? -1));
    const out = [];
    for (const s of list) {
      if (out.length >= limit) break;
      if (s.score < minScore) continue;
      out.push({ key: s.d.key, store: s.d.store, id: s.d.id, label: s.d.label, text: s.d.text, score: Math.round(s.score * 1000) / 1000, relevance: Math.round(s.rel * 1000) / 1000, ref: s.d.ref, ents: s.d.ents });
    }
    if (touch) for (const h of out) this.touch(h.key, 0.35);
    return out;
  }

  // Records that involve one entity, most salient first (for perception triggers).
  byEntity(entKey, { limit = 4, stores = null, filter = null } = {}) {
    this.refresh();
    const now = this.now();
    const out = [];
    for (const key of this.byEnt.get(entKey) || []) {
      const d = this.docs.get(key);
      if (!d || (stores && !stores.includes(d.store)) || (filter && !filter(d))) continue;
      out.push({ d, rel: 1, score: this._salience(d, now) });
    }
    return this._finish(out, limit, false, 0);
  }
}
