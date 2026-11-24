import { DAY_SECONDS, PLAYER_ID } from '../../core/constants.js';
import { clamp, cap, pick, playerRef, firstName, normName, tokenize } from './text.js';
import { pushHistory, cleanHistory, jaccard, MEMORY_LIMITS } from './memory.js';

// Lyra tends her own memory (DESIGN §17.4, §19.5). She rewrites how she remembers things
// when she learns more, corrects facts that turned out wrong, lets small things fade,
// sharpens what matters and forgets what she chooses to, for her own reasons. Nothing is
// overwritten silently: every change keeps the earlier version and a why.
//
//   editMemory(mind, ref, {text, importance, why, by})     reframe or reweigh a memory or her past
//   forgetMemory(mind, ref, {why, by})                      let a memory go (never her past, never what protects her)
//   updateKnowledge(mind, ref, {text, confidence, why})     correct a fact, rumor or theory
//   retractKnowledge(mind, ref, {why})                      she no longer believes it
//   applyMemoryEdits(mind, edits, {allowed, by})            Claude's "memory_edits", ids checked against what it was shown
//   consolidateDay(mind)                                    at sleep: supersede old knowledge, reframe the day through her opinions
//
// Every function returns { ok, message, refused?, entry?, store?, id? }; message is in
// her voice (the offline mind says it when the player asked).

const MSG = {
  protects: 'No. I remember that for a reason.',
  life: "That's my life you're asking me to forget. No.",
  keep: 'No. Some things I keep, even when they hurt.',
  maren: 'Forget Maren? Never. Not one word of her.',
  unknown: "I don't remember anything like that.",
  unknownFact: "I don't know anything like that to change.",
  forgot: ["Gone. ...Mostly. I'm not that kind of wizard.", "Forgotten. Or I'll pretend it is, which is nearly the same.", 'Consider it let go.'],
  edited: ['All right. I remember it a little differently now.', "I'll hold it differently.", 'Mm. That is how I remember it now.'],
  reframedAsked: ["I'll keep it. But I'll remember you asked me to see it another way.", "My memory stays mine. I'll keep your side of it next to it."],
  updated: ['Noted. I had that wrong.', "Good to know. I'll correct it.", 'Then I stand corrected.'],
  retracted: ["Then I don't believe that any more.", 'Struck out. I had that wrong.', "I'll let that one go. It wasn't true."],
  unchanged: "That's already how I remember it.",
};

// Tags on memories that keep her safe: what someone did to her, warnings, danger.
const PROTECTIVE_TAGS = new Set(['warning', 'companionship', 'farewell', 'downed', 'fear', 'cruelty', 'binding_light', 'betrayal', 'danger', 'threat', 'crime']);
// Deeds whose memory protects her from it happening again (DESIGN §16.2).
const HARM_DEEDS = new Set(['hit_lyra', 'downed_lyra', 'abandoned_downed', 'attacked_villager', 'downed_villager', 'attacked_guard', 'stole', 'lied', 'broke_promise', 'reckless_order', 'killed_harmless', 'pushed_after_refusal']);
// Kindnesses whose memory may sour when she comes to see the giver differently.
const GOOD_DEEDS = new Set(['protected_lyra', 'revived_lyra', 'gift_liked', 'gift_loved', 'kept_promise', 'kindness', 'respected_refusal']);
// Small wrongs she can afford: once she has let them go, they fade.
const SMALL_WRONGS = new Set(['hit_lyra_accident', 'gift_disliked', 'pushed_after_refusal']);
const HARM_WORDS = /\b(struck me|hit me|knocked me|beat\b|attacked|lied to me|stole|left me lying|warned|sword at me|nearly (?:got me )?killed|frighten|bound them)\b/i;

const OPS = new Set(['update', 'reweight', 'forget', 'retract']);
const WHY_MAX = 140;

// ---------------------------------------------------------------- finding

function citeOf(store, id) {
  return store === 'episode' || store === 'knowledge' ? String(id) : `${store}:${id}`;
}

// Parse a cited id: 'm12', 'episode:m12', 'k4', 'knowledge:k4', 'life:the_cut'.
export function parseCite(ref) {
  const s = String(ref ?? '').trim().replace(/^\[|\]$/g, '');
  const m = s.match(/^(episode|knowledge|life):(.+)$/);
  if (m) return { store: m[1], id: m[2] };
  if (/^m\d+$/.test(s)) return { store: 'episode', id: s };
  if (/^k\d+$/.test(s)) return { store: 'knowledge', id: s };
  return null;
}

function lifeEntry(mind, id) {
  return (mind?.life || []).find((e) => e && e.id === id) || null;
}

// The record a reference means: a cited id, or words that find it.
// -> { store: 'episode'|'life'|'knowledge', id, cite, entry } | null
export function findRecord(mind, ref, { stores = ['episode', 'life', 'knowledge'], minRelevance = 0.3 } = {}) {
  if (!mind || ref == null || ref === '') return null;
  const c = parseCite(ref);
  if (c) {
    if (!stores.includes(c.store)) return null;
    const entry = c.store === 'episode' ? mind.memory?.get?.(c.id) : c.store === 'knowledge' ? mind.knowledgeStore?.get?.(c.id) : lifeEntry(mind, c.id);
    return entry ? { store: c.store, id: c.id, cite: citeOf(c.store, c.id), entry } : null;
  }
  const text = String(ref).trim();
  // A subject she knows by name ("the waygates") before a loose search.
  if (stores.includes('knowledge') && stores.length === 1) {
    const n = normName(text);
    const exact = (mind.knowledgeStore?.active?.() || []).filter((k) => normName(k.subject) === n);
    if (exact.length) {
      const k = exact.sort((a, b) => b.t - a.t)[0];
      return { store: 'knowledge', id: k.id, cite: k.id, entry: k };
    }
  }
  let hits = [];
  try {
    hits = mind.recall?.(text, { limit: 3, stores, touch: false, spread: false }) || [];
  } catch {
    hits = [];
  }
  const best = hits.find((h) => h && h.relevance >= minRelevance && stores.includes(h.store));
  if (best) {
    const entry = best.store === 'life' ? lifeEntry(mind, best.id) : best.ref;
    if (entry) return { store: best.store, id: best.id, cite: citeOf(best.store, best.id), entry };
  }
  if (stores.includes('episode') && mind.memory?.bestMatch) {
    const { people, places } = mind.resolveQuery ? mind.resolveQuery(text) : { people: null, places: null };
    const m = mind.memory.bestMatch(text, { people, places, minRelevance });
    if (m) return { store: 'episode', id: m.id, cite: m.id, entry: m };
  }
  return null;
}

// Why she will not let this memory go, or null.
export function protects(mind, m) {
  if (!m) return null;
  const tags = Array.isArray(m.tags) ? m.tags : [];
  if (tags.some((t) => HARM_DEEDS.has(t))) return 'it is what someone did to me';
  if (tags.some((t) => PROTECTIVE_TAGS.has(t))) return 'it keeps me safe';
  if (m.emotion === 'fear' && (m.importance || 0) >= 5) return 'it frightened me, and I learned from it';
  const about = Array.isArray(m.about) ? m.about : [];
  if (about.includes(PLAYER_ID) && HARM_WORDS.test(String(m.text || ''))) return 'it is what someone did to me';
  return null;
}

// The player asking her to forget what they did to her, in their own words ("forget that
// I hit you"): the memory of it that protects her, or null.
const HARM_ASK = /\b(?:i|we)\s+(?:(?:just|once|accidentally|really|nearly)\s+)?(?:hit|struck|strike|hurt|attacked|attack|stabbed|cut|knocked|lied|lie|stole|beat|punched|slapped|kicked|left you|abandoned|scared|frightened|threatened)\b|\bmy (?:sword|blade|fist)\b/i;
export function harmAsked(mind, text) {
  if (!mind?.memory?.all || !HARM_ASK.test(String(text || ''))) return null;
  const list = mind.memory.all();
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m?.about?.includes(PLAYER_ID) && protects(mind, m)) return m;
  }
  return null;
}

function reasonText(why, fallback) {
  const s = String(why ?? '').replace(/\s+/g, ' ').trim();
  return (s || fallback).slice(0, WHY_MAX);
}

function mentionsMaren(text) {
  return /\bmaren\b/i.test(String(text || ''));
}

// ---------------------------------------------------------------- episodes and her past

// Rewrite or reweigh a memory (or reframe a chapter of her past). opts: { text, importance,
// why, by: 'self'|'claude'|'player'|'sleep', asked: the player's words when they asked }.
export function editMemory(mind, ref, { text = null, importance = null, why = '', by = 'self', asked = false } = {}) {
  const rec = findRecord(mind, ref, { stores: ['episode', 'life'] });
  if (!rec) return { ok: false, message: MSG.unknown };
  const P = playerRef(mind.game);
  const imp = Number.isFinite(Number(importance)) && importance !== null && importance !== '' ? clamp(Math.round(Number(importance)), 1, 10) : null;
  let next = text == null || text === '' ? null : String(text).replace(/\s+/g, ' ').trim();
  if (rec.store === 'life') {
    if (asked) {
      // Her past is hers: the player's words sit beside it, they do not replace it.
      if (!next) return { ok: false, message: MSG.unchanged };
      next = `${rec.entry.text.replace(/\s*\([^)]*sees it differently[^)]*\)\s*$/, '')} (${cap(P)} sees it differently: "${next.replace(/[.!?]+$/, '')}.")`;
    }
    const e = editLife(mind, rec.id, { text: next, importance: imp, why: reasonText(why, asked ? `${cap(P)} asked me to see it differently.` : 'I see it differently now.') });
    return e ? { ok: true, message: pick(asked ? MSG.reframedAsked : MSG.edited, mind.game?.rng), entry: e, store: 'life', id: rec.cite } : { ok: false, message: MSG.unchanged };
  }
  const m = rec.entry;
  const guard = protects(mind, m);
  let newImp = imp;
  // What protects her may be reframed, never made small.
  if (guard && newImp != null) newImp = Math.max(newImp, Math.min(m.importance, 5));
  if (asked && next) {
    // Asked to remember it differently: she keeps her own memory and adds their side.
    next = `${m.text.replace(/\s*\([^)]*sees it differently[^)]*\)\s*$/, '')} (${cap(P)} sees it differently: "${next.replace(/[.!?]+$/, '')}.")`;
    if (guard) newImp = m.importance;
  }
  const done = mind.memory.edit(m.id, { text: next, importance: newImp, why: reasonText(why, asked ? `${cap(P)} asked me to remember it differently.` : by === 'sleep' ? 'I see it differently after sleeping on it.' : 'I see it differently now.') });
  if (!done) return { ok: false, message: MSG.unchanged };
  return { ok: true, message: pick(asked ? MSG.reframedAsked : MSG.edited, mind.game?.rng), entry: done, store: 'episode', id: done.id };
}

// Reframe one chapter of her past; kept in memory.lifeEdits so it survives a save.
export function editLife(mind, id, { text = null, importance = null, why = '' } = {}) {
  const e = lifeEntry(mind, id);
  if (!e) return null;
  const next = text == null ? e.text : String(text).replace(/\s+/g, ' ').trim().slice(0, 600);
  const imp = importance == null ? e.importance : clamp(Math.round(importance), 4, 10);
  if (!next || (next === e.text && imp === e.importance)) return null;
  pushHistory(e, { t: mind.now?.() ?? 0, text: e.text, importance: e.importance, why });
  e.text = next;
  e.importance = imp;
  const store = mind.memory?.lifeEdits;
  if (store) store.set(id, { text: e.text, importance: e.importance, history: cleanHistory(e.history, 600) });
  if (mind.memory) mind.memory.rev++;
  return e;
}

// After a load (or a reset of the story): her reframed past comes back.
export function applyLifeEdits(mind) {
  const store = mind?.memory?.lifeEdits;
  if (!store || !store.size) return 0;
  let n = 0;
  for (const [id, ed] of store) {
    const e = lifeEntry(mind, id);
    if (!e || !ed?.text) continue;
    e.text = ed.text;
    if (Number.isFinite(ed.importance)) e.importance = ed.importance;
    e.history = cleanHistory(ed.history, 600);
    e.edited = true;
    n++;
  }
  return n;
}

// Let a memory go. Never her past, never Maren, never what protects her.
export function forgetMemory(mind, ref, { why = '', by = 'self' } = {}) {
  if (!mind) return { ok: false, message: MSG.unknown };
  if (mentionsMaren(ref) && !parseCite(ref)) return { ok: false, refused: true, message: MSG.maren };
  const rec = findRecord(mind, ref, { stores: ['episode', 'life'] });
  if (!rec) return { ok: false, message: MSG.unknown };
  if (rec.store === 'life') return { ok: false, refused: true, message: MSG.life };
  const m = rec.entry;
  if (protects(mind, m)) return { ok: false, refused: true, message: MSG.protects };
  if (mentionsMaren(m.text)) return { ok: false, refused: true, message: MSG.maren };
  if (m.pinned || m.importance >= 8) return { ok: false, refused: true, message: MSG.keep };
  const P = playerRef(mind.game);
  mind.memory.forget(m.id, reasonText(why, by === 'player' ? `${cap(P)} asked me to let it go, and I could spare it.` : 'I chose to let it go.'));
  return { ok: true, message: pick(MSG.forgot, mind.game?.rng), entry: m, store: 'episode', id: m.id };
}

// ---------------------------------------------------------------- knowledge

export function updateKnowledge(mind, ref, { text = null, confidence = null, kind = null, why = '', by = 'self' } = {}) {
  const rec = findRecord(mind, ref, { stores: ['knowledge'] });
  if (!rec) return { ok: false, message: MSG.unknownFact };
  const conf = Number.isFinite(Number(confidence)) && confidence !== null && confidence !== '' ? Number(confidence) : null;
  const k = mind.knowledgeStore.update(rec.id, { text: text == null || text === '' ? null : String(text), confidence: conf == null ? null : conf > 1 ? conf / 10 : conf, kind, why: reasonText(why, by === 'player' ? 'I was told otherwise.' : 'I learned better.') });
  if (!k) return { ok: false, message: MSG.unchanged };
  return { ok: true, message: pick(MSG.updated, mind.game?.rng), entry: k, store: 'knowledge', id: k.id };
}

export function retractKnowledge(mind, ref, { why = '' } = {}) {
  const rec = findRecord(mind, ref, { stores: ['knowledge'] });
  if (!rec) return { ok: false, message: MSG.unknownFact };
  const k = mind.knowledgeStore.retract(rec.id, reasonText(why, 'I stopped believing it.'));
  if (!k) return { ok: false, message: MSG.unchanged };
  return { ok: true, message: pick(MSG.retracted, mind.game?.rng), entry: k, store: 'knowledge', id: k.id };
}

// ---------------------------------------------------------------- Claude's memory_edits

// [{ id, op, text, importance, why }] from a reply, cleaned. Unknown ops are dropped.
export function coerceMemoryEdits(raw, max = 3) {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const out = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const id = String(e.id ?? e.memory ?? '').trim().replace(/^\[|\]$/g, '').slice(0, 80);
    const op = String(e.op ?? e.operation ?? '').trim().toLowerCase();
    if (!id || !OPS.has(op)) continue;
    const text = typeof e.text === 'string' && e.text.trim() ? e.text.replace(/\s+/g, ' ').trim().slice(0, MEMORY_LIMITS.text) : null;
    const n = Number(e.importance);
    const importance = Number.isFinite(n) && e.importance !== null && e.importance !== '' ? clamp(Math.round(n), 1, 10) : null;
    const why = typeof e.why === 'string' ? e.why.replace(/\s+/g, ' ').trim().slice(0, WHY_MAX) : '';
    out.push({ id, op, text, importance, why });
    if (out.length >= max) break;
  }
  return out;
}

// Apply edits she decided on through Claude. `allowed`: the ids it was shown (a Set or
// Map); an id outside it is ignored. -> [{ id, op, ok, message }]
export function applyMemoryEdits(mind, edits, { allowed = null, by = 'claude' } = {}) {
  const out = [];
  if (!mind) return out;
  for (const e of coerceMemoryEdits(edits)) {
    if (allowed && !allowed.has(e.id)) {
      out.push({ id: e.id, op: e.op, ok: false, ignored: true, message: 'not in what she was shown' });
      continue;
    }
    const c = parseCite(e.id);
    if (!c) {
      out.push({ id: e.id, op: e.op, ok: false, ignored: true, message: 'not a memory id' });
      continue;
    }
    let r;
    try {
      if (c.store === 'knowledge') {
        if (e.op === 'retract' || e.op === 'forget') r = retractKnowledge(mind, e.id, { why: e.why });
        else if (e.op === 'reweight') r = updateKnowledge(mind, e.id, { confidence: e.importance == null ? null : e.importance / 10, why: e.why, by });
        else r = updateKnowledge(mind, e.id, { text: e.text, confidence: e.importance == null ? null : e.importance / 10, why: e.why, by });
      } else if (e.op === 'forget') r = forgetMemory(mind, e.id, { why: e.why, by });
      else if (e.op === 'retract') r = { ok: false, message: 'a memory is not a belief' };
      else if (e.op === 'reweight') r = editMemory(mind, e.id, { importance: e.importance, why: e.why, by });
      else r = editMemory(mind, e.id, { text: e.text, importance: e.importance, why: e.why, by });
    } catch (err) {
      console.error('[mind] memory edit failed', err);
      r = { ok: false, message: 'failed' };
    }
    out.push({ id: e.id, op: e.op, ok: !!r?.ok, refused: !!r?.refused, message: r?.message || '' });
  }
  return out;
}

// ---------------------------------------------------------------- sleep

function tagged(m, tag) {
  return Array.isArray(m.tags) && m.tags.includes(tag);
}

function markReframed(m) {
  if (!Array.isArray(m.tags)) m.tags = [];
  if (m.tags.includes('reframed')) return;
  if (m.tags.length >= 8) m.tags.pop();
  m.tags.push('reframed');
}

// The deed a memory is of: the ledger's own memories carry it as a tag; the mind's
// perception remembers gifts and kindnesses itself (tags 'gift' / 'kindness').
function deedOf(m) {
  if (tagged(m, 'deed')) return m.tags.find((t) => t !== 'deed' && (HARM_DEEDS.has(t) || GOOD_DEEDS.has(t) || SMALL_WRONGS.has(t))) || null;
  if (tagged(m, 'kindness')) return 'kindness';
  if (tagged(m, 'gift')) return m.emotion === 'joy' || m.emotion === 'affection' ? 'gift_liked' : 'gift_disliked';
  return null;
}

// The night's tending, after the memory store merged and faded (DESIGN §17.4): knowledge
// that newer knowledge overtook is retracted; the day's memories of people are reframed
// through how she sees them now. Each change keeps a why. -> { superseded, reframed }
export function consolidateDay(mind, { now = null } = {}) {
  const out = { superseded: 0, reframed: 0 };
  if (!mind?.memory) return out;
  const t = now ?? mind.now?.() ?? 0;
  const ks = mind.knowledgeStore;
  if (ks?.superseded) {
    for (const { old, newer } of ks.superseded(t - 1.5 * DAY_SECONDS)) {
      if (ks.retract(old.id, `I learned better: ${newer.text}`.slice(0, WHY_MAX))) out.superseded++;
    }
  }
  out.reframed += reframeThePlayer(mind, t);
  out.reframed += reframeVillagers(mind, t);
  return out;
}

// How she sees the player tonight colors how she keeps the last two days of them.
function reframeThePlayer(mind, t) {
  const rel = mind.relationships?.get?.(PLAYER_ID);
  if (!rel) return 0;
  const P = playerRef(mind.game);
  const a = mind.autonomy;
  const state = a?.companionship || 'together';
  const worth = typeof a?.worth === 'function' ? a.worth() : null;
  const soured = state === 'left' || state === 'gone' || (rel.affinity ?? 0) <= -20;
  const warm = (state === 'together' || state === 'apart') && (rel.trust ?? 0) >= 40 && (!worth || worth.net > 1.5);
  const forgiven = warm && a?.apology?.believed && t - (a.apology.t ?? -Infinity) < 2 * DAY_SECONDS;
  let n = 0;
  for (const m of mind.memory.all()) {
    if (n >= 4) break;
    if (!m.about?.includes(PLAYER_ID) || tagged(m, 'reframed') || m.type === 'reflection') continue;
    const age = (t - m.t) / DAY_SECONDS;
    if (age > 2 || age < 0) continue;
    const deed = deedOf(m);
    if (soured && deed && GOOD_DEEDS.has(deed)) {
      const tail = pick([`It meant more to me before.`, `I don't know what it was worth, now.`, `I keep it. I'm just not sure what it means any more.`], mind.game?.rng);
      if (mind.memory.edit(m.id, { text: `${m.text} ${tail}`, importance: Math.max(2, m.importance - 1), why: `I see ${P} differently now.` })) {
        markReframed(m);
        n++;
      }
    } else if (forgiven && deed && HARM_DEEDS.has(deed) && m.t < a.apology.t) {
      // Reconciliation changes how she holds it, not whether she remembers it.
      if (mind.memory.edit(m.id, { text: `${m.text} ${cap(P)} said sorry, and I believe them.`, why: 'They apologized, and I believed them.' })) {
        markReframed(m);
        n++;
      }
    } else if (warm && deed && SMALL_WRONGS.has(deed) && age >= 0.5) {
      // A small wrong she could afford: weighed, let go, fading.
      if (mind.memory.edit(m.id, { text: `${m.text} It doesn't matter now.`, importance: Math.max(1, m.importance - 2), why: 'A small thing. I let it go.' })) {
        markReframed(m);
        n++;
      }
    }
  }
  return n;
}

// Someone she misjudged: a hard first impression, softened by knowing them better.
function reframeVillagers(mind, t) {
  let n = 0;
  for (const m of mind.memory.all()) {
    if (n >= 2) break;
    if (tagged(m, 'reframed') || !(m.emotion === 'anger' || m.emotion === 'fear' || m.emotion === 'embarrassment')) continue;
    const age = (t - m.t) / DAY_SECONDS;
    if (age > 3 || age < 0.3) continue;
    const who = (m.about || []).find((id) => id !== PLAYER_ID && id !== 'lyra');
    if (!who) continue;
    const rel = mind.relationships?.get?.(who);
    if (!rel || (rel.affinity ?? 0) < 45) continue;
    const name = firstName(rel.name || who);
    if (mind.memory.edit(m.id, { text: `${m.text} I had ${name} wrong, I think.`, why: `I know ${name} better now.` })) {
      markReframed(m);
      n++;
    }
  }
  return n;
}

// How alike two texts are (0..1), for callers that want to merge their own records.
export function similarity(a, b) {
  return jaccard(new Set(tokenize(a)), new Set(tokenize(b)));
}
