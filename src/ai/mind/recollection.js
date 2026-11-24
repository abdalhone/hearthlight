import { PLAYER_ID } from '../../core/constants.js';
import { shorten, firstSentence, firstName, cap, lowerFirst, pick, normName, timeAgo, playerRef, tokenSet } from './text.js';
import { jaccard } from './memory.js';
import { bondOf } from './relationships.js';

// How Lyra brings things back to mind (DESIGN §17.2): the context Claude gets for a
// message, dossiers on people, what she knows of a topic, learning lore from places,
// people and things she reads, and reminiscences when something stirs an old memory.
// Functions take the mind; the Mind exposes them as methods.

const SECTION_TITLES = {
  mind: 'On her mind now',
  episode: 'Memories',
  knowledge: 'What she knows',
  person: 'The people involved',
  life: 'Her past',
};
const SECTION_ORDER = ['mind', 'episode', 'knowledge', 'person', 'life'];
const LINE_MAX = { mind: 120, episode: 240, knowledge: 210, person: 330, life: 240 };
const SECTION_MAX = { mind: 6, episode: 7, knowledge: 7, person: 3, life: 3 };
const PER_STORE = [
  ['episode', 24],
  ['knowledge', 12],
  ['life', 5],
  ['person', 4],
];

// ---------------------------------------------------------------- ids

// The id a record is cited by in prompts and chips: 'm12', 'k4', 'life:cal_dies', 'person:bram'.
export function citeId(store, id) {
  if (store === 'episode' || store === 'knowledge') return String(id);
  return `${store}:${id}`;
}

// Find any record by a cited id ('m12', 'episode:m12', 'k4', 'life:cal', 'person:bram').
export function lookup(mind, ref) {
  if (!ref) return null;
  let s = String(ref).trim().replace(/^\[|\]$/g, '');
  let store = null;
  const m = s.match(/^(episode|knowledge|life|person):(.+)$/);
  if (m) {
    store = m[1];
    s = m[2];
  } else if (/^m\d+$/.test(s)) store = 'episode';
  else if (/^k\d+$/.test(s)) store = 'knowledge';
  if (!store) return null;
  const doc = mind.index.get(`${store}:${s}`);
  if (!doc) return null;
  return { id: citeId(store, s), store, label: doc.label, text: doc.text, ref: doc.ref };
}

// ---------------------------------------------------------------- recall context

function describeKnowledge(k, mind) {
  const bits = [];
  if (k.kind === 'theory') bits.push(`her own theory, confidence ${k.confidence}`);
  else if (k.kind === 'rumor') bits.push('a rumor');
  else if (k.source === 'told') bits.push(k.from ? `told by ${firstName(mind.relationships.get(k.from)?.name || k.from)}` : 'told');
  else if (k.source === 'player') bits.push('the player told her');
  else if (k.source === 'lore') bits.push('known lore');
  else if (k.source === 'observed') bits.push('seen herself');
  return bits.join(', ');
}

function episodeLine(h, mind) {
  const m = h.ref;
  const when = m.day > 0 ? `day ${m.day}` : m.when || 'before';
  const extra = [m.emotion ? `felt ${m.emotion}` : null, `importance ${m.importance}`].filter(Boolean).join(', ');
  return `- [${m.id}] ${when} (${extra}): ${m.text}`;
}

function knowledgeLine(h, mind) {
  const k = h.ref;
  const how = describeKnowledge(k, mind);
  return `- [${k.id}] ${k.subject}: ${k.text}${how ? ` (${how})` : ''}`;
}

function lifeLine(h) {
  const e = h.ref;
  return `- [life:${e.id}] ${e.age != null ? `age ${e.age}, ` : ''}${e.title}: ${e.text}`;
}

// The context for one message: grouped, deduplicated, and never over budget.
export function recallContext(mind, text, { budget = 3500 } = {}) {
  const idx = mind.index;
  // Each store is searched on its own, so a hundred small memories of one thing never
  // crowd out what she knows or who she was.
  const hits = [];
  for (const [store, limit] of PER_STORE) hits.push(...idx.search(text, { limit, stores: [store], touch: true }));
  hits.sort((a, b) => b.score - a.score);
  const qEnts = idx.link(text, { query: true });
  const groups = { mind: [], episode: [], knowledge: [], person: [], life: [] };
  const seen = new Set();
  const shapes = { episode: [], knowledge: [], life: [] };

  let loose = 0;
  for (const h of hits) {
    if (h.store === 'person') continue; // people are rendered as dossiers below
    if (groups[h.store].length >= SECTION_MAX[h.store]) continue;
    // Weak matches only get in when they matter: a couple of strong associations at most.
    if (h.relevance < 0.15) {
      if (loose >= 2 || h.store !== 'episode' || (h.ref.importance || 0) < 7) continue;
      loose++;
    }
    // Near-repeats of something already chosen add nothing.
    const shape = tokenSet(h.text);
    if (shapes[h.store].some((o) => jaccard(o, shape) >= 0.6)) continue;
    shapes[h.store].push(shape);
    const line = h.store === 'episode' ? episodeLine(h, mind) : h.store === 'knowledge' ? knowledgeLine(h, mind) : lifeLine(h);
    groups[h.store].push({ line: shorten(line, LINE_MAX[h.store]), item: { id: citeId(h.store, h.id), store: h.store, label: h.label } });
    seen.add(h.key);
  }

  // People: named in the message first, then those the best memories involve.
  const people = [];
  const addPerson = (key) => {
    if (!key?.startsWith('person:') || key === `person:${PLAYER_ID}` || key === 'person:lyra') return;
    const id = key.slice(7);
    if (people.includes(id) || people.length >= SECTION_MAX.person) return;
    people.push(id);
  };
  for (const e of qEnts) addPerson(e);
  for (const h of hits) {
    if (h.store === 'person') addPerson(`person:${h.id}`);
    else if (people.length < 2 && h.relevance >= 0.3 && seen.has(h.key)) for (const e of h.ents) addPerson(e);
  }
  for (const id of people) {
    const d = dossier(mind, id);
    // Someone she has only heard named adds nothing unless the player asked about them.
    if (!d || (!d.met && !d.lore && !qEnts.has(`person:${id}`))) continue;
    groups.person.push({ line: shorten(`- [person:${d.id}] ${d.text}`, LINE_MAX.person), item: { id: `person:${d.id}`, store: 'person', label: d.name } });
    seen.add(`person:${d.id}`);
  }

  // What was already on her mind, unless it is shown elsewhere.
  for (const it of mind.workingMemory.list(8)) {
    if (groups.mind.length >= SECTION_MAX.mind || seen.has(it.key)) continue;
    if (it.store === 'entity') groups.mind.push({ line: `- ${it.label}`, item: null });
    else {
      const doc = idx.get(it.key);
      if (!doc) continue;
      groups.mind.push({ line: shorten(`- [${citeId(doc.store, doc.id)}] ${doc.label}: ${firstSentence(doc.text, 90)}`, LINE_MAX.mind), item: { id: citeId(doc.store, doc.id), store: doc.store, label: doc.label } });
    }
    seen.add(it.key);
  }

  // Fill round-robin so every group gets its best line before any gets its second.
  const chosen = { mind: [], episode: [], knowledge: [], person: [], life: [] };
  let size = 0;
  const headerCost = (g) => (chosen[g].length ? 0 : SECTION_TITLES[g].length + 3);
  for (let round = 0; round < 8; round++) {
    let added = false;
    for (const g of ['episode', 'knowledge', 'person', 'mind', 'life']) {
      const cand = groups[g][round];
      if (!cand) continue;
      const cost = cand.line.length + 1 + headerCost(g);
      if (size + cost > budget) continue;
      chosen[g].push(cand);
      size += cost;
      added = true;
    }
    if (!added) break;
  }
  const parts = [];
  const items = [];
  for (const g of SECTION_ORDER) {
    if (!chosen[g].length) continue;
    parts.push(`${SECTION_TITLES[g]}:\n${chosen[g].map((c) => c.line).join('\n')}`);
    for (const c of chosen[g]) if (c.item) items.push(c.item);
  }
  let out = parts.join('\n');
  if (out.length > budget) out = `${out.slice(0, Math.max(0, budget - 1))}…`;
  return { text: out, items };
}

// ---------------------------------------------------------------- people

function resolvePersonId(mind, ref) {
  if (!ref) return null;
  if (typeof ref === 'object' && ref.id) return String(ref.id);
  if (/^(me|player|the player|you know who)$/i.test(String(ref).trim())) return PLAYER_ID;
  const rel = mind.relationships.get(String(ref));
  if (rel && rel.kind !== 'group') return rel.id;
  // Names, roles and aliases only: "we" and "us" are not anyone's dossier.
  for (const k of mind.index.link(String(ref))) if (k.startsWith('person:')) return k.slice(7);
  const lore = mind.lorebook?.all('person').find((e) => normName(e.name) === normName(ref) || e.id === String(ref) || e.npcId === String(ref));
  return lore ? lore.npcId || lore.id : null;
}

// Everything she knows about one person, assembled on demand.
export function dossier(mind, personRef) {
  const id = resolvePersonId(mind, personRef);
  if (!id) return null;
  const rel = mind.relationships.map.get(id) || null;
  const loreEntry = (mind.lorebook?.all('person') || []).find((e) => (e.npcId || e.id) === id && mind.knowsLore(e)) || null;
  const known = !!rel && (rel.firstMet != null || rel.absent || id === PLAYER_ID);
  // Someone who lives here but she has not met: a name and a trade, nothing more.
  const ent = !known && !loreEntry ? mind.game?.entities?.get?.(id) : null;
  if (!known && !loreEntry && !ent?.profile) return null;
  const name = rel?.name || loreEntry?.name || ent?.name || id;
  const role = rel?.role || loreEntry?.role || ent?.profile?.role || ent?.role || null;
  const key = `person:${id}`;
  const facts = mind.knowledgeStore.all().filter((k) => k.about.includes(id) || (k.loreId && (k.loreId === loreEntry?.id))).slice(-6);
  // The memories that matter most about them, then the most recent.
  const memories = mind.index
    .search('', { stores: ['episode'], entities: [key], limit: 12, spread: false, filter: (d) => d.ents.has(key) })
    .sort((a, b) => (b.ref.importance || 0) - (a.ref.importance || 0) || (b.ref.t || 0) - (a.ref.t || 0))
    .slice(0, 4);
  const life = mind.index.byEntity(key, { stores: ['life'], limit: 2 });
  const bond = rel ? bondOf(rel) : null;
  const d = {
    id,
    name,
    role,
    met: known,
    bond,
    affinity: rel?.affinity ?? null,
    trust: rel?.trust ?? null,
    respect: rel?.respect ?? null,
    familiarity: rel?.familiarity ?? null,
    fear: rel?.fear ?? null,
    tags: rel ? [...rel.tags] : [],
    opinion: rel?.opinion || '',
    notes: rel ? rel.notes.slice(-5).map((n) => ({ text: n.text, source: n.source })) : [],
    facts: facts.map((k) => ({ id: k.id, text: k.text, kind: k.kind, source: k.source })),
    memories: memories.map((h) => ({ id: h.id, text: h.text })),
    life: life.map((h) => ({ id: `life:${h.id}`, title: h.label, text: h.text })),
    lore: loreEntry ? loreEntry.text : null,
    history: rel ? rel.history.slice(-4) : [],
    firstMet: rel?.firstMet ?? null,
    lastSeen: rel?.lastSeen ?? null,
  };
  if (!known && !loreEntry) {
    d.text = `${name}${role ? `, ${role}` : ''}. She has not met them yet.`;
    return d;
  }
  const head = `${name}${role ? `, ${role}` : ''}`;
  const stats = rel ? ` ${bond.label}; affinity ${Math.round(rel.affinity)}, trust ${Math.round(rel.trust)}, respect ${Math.round(rel.respect)}${rel.fear >= 10 ? `, fear ${Math.round(rel.fear)}` : ''}${rel.tags.length ? `, ${rel.tags.join('/')}` : ''}.` : '';
  const bits = [`${head}.${stats}`];
  if (d.opinion) bits.push(`She thinks: "${shorten(d.opinion, 160)}"`);
  if (!rel && d.lore) bits.push(shorten(d.lore, 160));
  const told = [...d.notes.filter((n) => n.source !== 'self').map((n) => n.text), ...d.facts.filter((f) => f.source !== 'lore').map((f) => f.text)];
  if (told.length) bits.push(`Knows: ${shorten([...new Set(told)].slice(-3).join(' '), 200)}`);
  if (d.memories.length) bits.push(`Remembers: ${shorten(d.memories[0].text, 140)}`);
  d.text = shorten(bits.join(' '), 900);
  return d;
}

// ---------------------------------------------------------------- lore she knows

// What she knows about a topic: lore, facts, rumors and theories, plus open questions she
// has found clues for. Never anything she has not learned, never a mystery's truth.
export function loreLookup(mind, topic) {
  const t = String(topic || '').trim();
  const out = { topic: t, entries: [], questions: [], text: '' };
  if (!t) return out;
  const seen = new Set();
  for (const h of mind.index.search(t, { stores: ['knowledge'], limit: 6, spread: false })) {
    const k = h.ref;
    if (h.relevance < 0.15 || seen.has(k.id)) continue;
    seen.add(k.id);
    out.entries.push({ id: k.id, subject: k.subject, text: k.text, kind: k.kind, source: k.source, confidence: k.confidence, loreId: k.loreId });
  }
  // Her own life counts as something she knows.
  for (const h of mind.index.search(t, { stores: ['life'], limit: 2, spread: false })) {
    if (h.relevance < 0.2) continue;
    out.entries.push({ id: `life:${h.id}`, subject: h.label, text: h.text, kind: 'life', source: 'lore', confidence: 1, loreId: h.id });
  }
  for (const m of mind.lorebook?.search(t, { mysteries: true, kinds: ['mystery'], limit: 3 }) || []) {
    const clues = m.clues.map((c, i) => (mind.knowledgeStore.byLore(`${m.id}#${i}`) ? c.text : null)).filter(Boolean);
    if (clues.length) out.questions.push({ id: m.id, question: m.question, clues });
  }
  const lines = out.entries.slice(0, 6).map((e) => `${e.subject}: ${e.text}${e.kind === 'theory' ? ' (her theory)' : e.kind === 'rumor' ? ' (rumor)' : ''}`);
  for (const q of out.questions) lines.push(`Open question: ${q.question} Clues: ${q.clues.join(' ')}`);
  out.text = shorten(lines.join('\n'), 1200);
  return out;
}

// ---------------------------------------------------------------- learning lore

// Lore about a place, learned by being there; mystery clues found there too.
export function learnPlace(mind, locationId) {
  const lb = mind.lorebook;
  if (!lb || !locationId) return [];
  const learned = [];
  for (const e of lb.all('place')) {
    if (e.locationId !== locationId || mind.knowledgeStore.byLore(e.id)) continue;
    const k = mind.learn(e.title, e.text, { kind: 'lore', source: 'observed', loreId: e.id, about: [locationId] });
    if (k) learned.push(k);
  }
  learned.push(...learnClues(mind, locationId, 'observed'));
  return learned;
}

// Lore an item reveals when she reads or studies it (entries tagged with the item id).
export function learnItem(mind, itemId) {
  const lb = mind.lorebook;
  if (!lb || !itemId) return [];
  const learned = [];
  for (const e of lb.withTag(itemId)) {
    if (e.kind === 'life' || e.kind === 'mystery' || mind.knowledgeStore.byLore(e.id)) continue;
    const k = mind.learn(e.title, e.text, { kind: 'lore', source: 'observed', loreId: e.id });
    if (k) learned.push(k);
  }
  learned.push(...learnClues(mind, itemId, 'observed'));
  return learned;
}

export function learnClues(mind, foundAt, source = 'observed', from = null) {
  const out = [];
  for (const c of mind.lorebook?.cluesAt(foundAt) || []) {
    if (mind.knowledgeStore.byLore(c.id)) continue;
    const k = mind.learn(c.mystery.question, c.clue.text, { kind: source === 'told' ? 'rumor' : 'fact', source, loreId: c.id, from });
    if (k) out.push(k);
  }
  return out;
}

// Lore a person could tell her, best first: entries that person knows and she does not,
// matching the topic when there is one. Secrets need familiarity.
export function loreFrom(mind, npcId, { topic = null, familiarity = 0, limit = 2 } = {}) {
  const lb = mind.lorebook;
  if (!lb || !npcId) return [];
  const pool = lb.all().filter((e) => e.kind !== 'life' && e.kind !== 'mystery' && e.knownBy.includes(npcId) && !mind.knowsLore(e) && (!e.secret || familiarity >= 45));
  if (!pool.length) return [];
  const scored = new Map(pool.map((e) => [e.key, 0]));
  if (topic) for (const h of lb.search(topic, { limit: 12 })) if (scored.has(h.key)) scored.set(h.key, scored.get(h.key) + 2 + h.score);
  // A person tends to talk about themselves, their place and their work first.
  for (const e of pool) {
    let s = scored.get(e.key);
    if (e.npcId === npcId || e.tags.includes(npcId)) s += 1.5;
    if (e.kind === 'place') s += 0.5;
    if (e.secret) s -= 0.5;
    scored.set(e.key, s);
  }
  return pool
    .sort((a, b) => scored.get(b.key) - scored.get(a.key))
    .filter((e) => !topic || scored.get(e.key) > 0.9)
    .slice(0, limit);
}

export function learnLoreEntry(mind, entry, { source = 'told', from = null } = {}) {
  if (!entry) return null;
  const about = [];
  if (entry.npcId) about.push(entry.npcId);
  else if (entry.kind === 'person') about.push(entry.id);
  if (entry.locationId) about.push(entry.locationId);
  return mind.learn(entry.title, entry.text, { kind: 'lore', source, loreId: entry.id, from, about });
}

// ---------------------------------------------------------------- noticing and reminiscing

// Something caught her attention: bring it to mind with what she associates with it,
// and maybe let an old memory surface.
export function noticeEntity(mind, entKey, { source = 'perception', amount = 0.6, reminisce = true, label = null } = {}) {
  if (!entKey) return null;
  const wm = mind.workingMemory;
  const lbl = label || mind.index.label(entKey);
  wm.activate(entKey, { label: lbl, store: 'entity', amount, source });
  const now = mind.now();
  const assoc = mind.index.byEntity(entKey, { limit: 2, filter: (d) => d.store !== 'person' && (d.t == null || now - d.t > 60) });
  for (const h of assoc) wm.activate(h.key, { label: h.label, store: h.store, id: h.id, amount: amount * 0.55, source: 'association' });
  if (reminisce) maybeReminisce(mind, entKey, lbl);
  return lbl;
}

const TAILS = {
  fear: ['My hands still remember it.', 'I can still feel my heart going.'],
  sadness: ['It still sits heavy.', 'Some things do not get lighter.'],
  joy: ['That was a good day.', 'I was happy then. I am now, a bit.'],
  affection: ['I miss that more than I say.', 'Funny, the things that stay with you.'],
  pride: ['I still stand a little taller for it.', 'Not bad, Lyra. Not bad.'],
  trust: ['I keep that one close.'],
  anger: ['It still makes my jaw tight.'],
  default: ['Funny what a place brings back.', 'Strange, what stays with you.'],
};

function tail(feeling, rng) {
  return pick(TAILS[feeling] || TAILS.default, rng);
}

// One short line in her voice for a memory that surfaced, or null.
export function composeReminiscence(mind, hit, cue) {
  const rng = mind.game?.rng;
  const c = cap(String(cue || '').replace(/^the /i, ''));
  if (hit.store === 'knowledge') {
    const k = hit.ref;
    if (k.kind === 'theory') return shorten(`${c}… I still think ${lowerFirst(k.text.replace(/[.!]+$/, ''))}.`, 130);
    const teller = k.source === 'told' && k.from ? firstName(mind.relationships.get(k.from)?.name || '') : '';
    const body = lowerFirst(firstSentence(k.text, 120).replace(/[.!]+$/, ''));
    return shorten(`${c}… ${teller ? `${teller} said ${body}` : cap(body)}.`, 130);
  }
  if (hit.store === 'life') {
    const e = hit.ref;
    const first = firstSentence(e.text, 110);
    const line = /^(I|My|Me)\b/.test(first) ? first : `${e.title}.`;
    return shorten(`${c}… ${line} ${tail(e.feeling, rng)}`, 150);
  }
  if (hit.store === 'episode') {
    const m = hit.ref;
    const gist = m.gist || shorten(firstSentence(m.text, 80), 70).replace(/[.!]+$/, '');
    const ago = m.day > 0 ? timeAgo(mind.game, m.t) : m.when;
    return shorten(`${c}. ${cap(ago || 'once')}, ${lowerFirst(gist)}. ${tail(m.emotion, rng)}`, 150);
  }
  return null;
}

// At most one reminiscence every couple of minutes, never the same one twice in twenty,
// never in a fight, and only for memories with weight.
export function maybeReminisce(mind, entKey, cue) {
  const per = mind.perception;
  const g = mind.game;
  const o = mind.owner;
  if (!per || g?.state !== 'playing' || !o || o.downed || o.state === 'sleep') return null;
  const t = per.rt();
  const R = mind._reminisce;
  if (per.clock < 20) return null; // let the player find their feet first
  if (t - R.last < 120 || per.encounter || per.threats > 0) return null;
  if (per.firstVisit && t - per.placeSince < 60) return null; // a first visit has its own thoughts
  const now = mind.now();
  const hits = mind.index.byEntity(entKey, {
    limit: 6,
    filter: (d) => d.store !== 'person' && !(R.used.get(d.key) > t - 1200) && (d.t == null || now - d.t > (g?.clock?.secondsPerHour || 37.5)),
  });
  let best = null;
  let bestS = 0;
  for (const h of hits) {
    const d = mind.index.get(h.key);
    if (!d) continue;
    const s = (d.importance / 10) * 0.6 + d.emotion * 0.3 + (d.store === 'life' ? 0.15 : d.store === 'knowledge' ? 0.1 : 0);
    if (s > bestS) {
      bestS = s;
      best = h;
    }
  }
  if (!best || bestS < 0.55) return null;
  const line = composeReminiscence(mind, best, cue);
  if (!line) return null;
  R.last = t;
  R.used.set(best.key, t);
  if (R.used.size > 60) for (const [k, v] of R.used) if (t - v > 1200) R.used.delete(k);
  mind.index.touch(best.key, 0.5);
  mind.workingMemory.activate(best.key, { label: best.label, store: best.store, id: best.id, amount: 0.8, source: 'reminiscence' });
  const p = g?.player;
  const near = p && Math.hypot(p.x - o.x, p.y - o.y) < 120;
  const quiet = t - per.lastSpoke > 6 && !mind.isSpeaking() && !bubbleBusy(g, o);
  if (near && quiet && g?.bubbles?.say) {
    try {
      g.bubbles.say(o, line, { kind: 'say', duration: Math.min(7, 2.4 + line.length * 0.05) });
      per.lastSpoke = t;
    } catch (err) {
      console.error('[mind] reminiscence bubble failed', err);
    }
    mind.addThought(line, 'reminiscence');
  } else {
    mind.addThought(line, 'reminiscence', { show: true, minGap: 20 });
  }
  return { line, key: best.key };
}

function bubbleBusy(g, o) {
  const b = g?.bubbles;
  try {
    if (typeof b?.hasBubble === 'function') return !!b.hasBubble(o);
    if (typeof b?.isSpeaking === 'function') return !!b.isSpeaking(o);
    if (typeof b?.isBusy === 'function') return !!b.isBusy(o);
    if (typeof b?.has === 'function') return !!b.has(o);
  } catch {
    return false;
  }
  return false;
}

// "the traveler" or their name, for lines that mention the player.
export function playerWord(mind) {
  return playerRef(mind.game);
}
