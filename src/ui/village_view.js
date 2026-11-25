// Pure view-model helpers for Hearthvale's social life in the UI (DESIGN.md §19.3–§19.6):
// talking to anyone, listening in, the morning's "while you slept", the eighteen
// villagers in Lyra's People tab, how the village feels about the player, her
// worth-it judgment and the history of memories she edited. No DOM here, so all of it
// is unit-tested under node. The village, her autonomy and her memory are written by
// other modules in parallel: every reader tolerates missing or oddly shaped data.

import { DAY_SECONDS } from '../core/constants.js';
import { listFrom, truncate, capitalize } from './format.js';

const num = (v, d = null) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function safeGet(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export function firstName(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  // "Captain Rowan Vale" -> Rowan, "Sister Aveline" -> Aveline, 'Garrick "Gale" Hale' -> Garrick.
  const parts = s.replace(/["“”][^"“”]*["“”]/g, ' ').split(/\s+/).filter(Boolean);
  const titles = /^(captain|sister|brother|mother|father|old|reeve|master|mistress|lady|lord|sir|dame)$/i;
  while (parts.length > 1 && titles.test(parts[0])) parts.shift();
  return parts[0] || s;
}

// ---------- the village (feature detection) ----------

export function villageOf(game) {
  const v = safeGet(() => game?.village);
  return v && typeof v === 'object' ? v : null;
}

export function canTalkTo(game) {
  return typeof villageOf(game)?.playerSays === 'function';
}

// ---------- talking to anyone (§19.3 playerSays) ----------

export const SAY_MAX = 300;

const MOOD_TO_EXPR = {
  happy: 'happy', glad: 'happy', pleased: 'happy', warm: 'happy', amused: 'happy', cheerful: 'happy', friendly: 'happy', delighted: 'happy', joy: 'happy', proud: 'happy',
  love: 'love', fond: 'love', affection: 'love', tender: 'love', smitten: 'love',
  sad: 'sad', hurt: 'sad', sorrow: 'sad', grief: 'sad', gloomy: 'sad', sadness: 'sad', lonely: 'sad',
  angry: 'angry', annoyed: 'angry', cross: 'angry', irritated: 'angry', cold: 'angry', offended: 'angry', anger: 'angry', furious: 'angry', hostile: 'angry',
  surprised: 'surprised', startled: 'surprised', shocked: 'surprised', surprise: 'surprised', curious: 'surprised',
  worried: 'worried', nervous: 'worried', afraid: 'worried', scared: 'worried', anxious: 'worried', uneasy: 'worried', fear: 'worried', wary: 'worried',
  sleepy: 'sleepy', tired: 'sleepy', drowsy: 'sleepy',
  neutral: 'neutral', calm: 'neutral', thoughtful: 'neutral',
};

// A villager's mood word (from the village or Claude) -> a portrait expression.
export function moodExpression(mood) {
  const m = String((mood && typeof mood === 'object' ? mood.name || mood.label : mood) || '')
    .toLowerCase()
    .trim();
  if (!m) return null;
  if (MOOD_TO_EXPR[m]) return MOOD_TO_EXPR[m];
  for (const w of m.split(/[^a-z]+/)) if (MOOD_TO_EXPR[w]) return MOOD_TO_EXPR[w];
  return null;
}

// What playerSays resolved to, in one shape: { lines: [string], mood, expr, options }.
export function normalizeReply(r) {
  let lines = [];
  let mood = null;
  let options = null;
  if (typeof r === 'string') lines = [r];
  else if (Array.isArray(r)) lines = r;
  else if (r && typeof r === 'object') {
    lines = Array.isArray(r.lines) ? r.lines : r.lines != null ? [r.lines] : r.say != null ? [r.say] : r.text != null ? [r.text] : [];
    mood = r.mood ?? null;
    if (Array.isArray(r.options) && r.options.length) {
      options = r.options
        .filter((o) => o && (o.id || o.label))
        .map((o) => ({ id: String(o.id || o.label), label: String(o.label || o.id) }))
        .slice(0, 9);
      if (!options.length) options = null;
    }
  }
  const out = [];
  for (const l of lines) {
    const t = String((l && typeof l === 'object' ? l.text : l) ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (t) out.push(truncate(t, 420));
    if (out.length >= 8) break;
  }
  return { lines: out, mood: mood == null ? null : String(typeof mood === 'object' ? mood.name || mood.label || '' : mood) || null, expr: moodExpression(mood), options };
}

// When the village cannot answer (an error, or no answer in time), the villager still
// reacts: narration, never words put in their mouth.
export function quietReply(npc, why = 'error') {
  const who = firstName(npc?.name) || 'They';
  if (why === 'timeout') return [`${who} seems lost in thought, and does not answer.`];
  if (why === 'asleep') return [`${who} is fast asleep.`];
  // They heard it, and chose to say nothing (DESIGN §23.3): the act, never a failure.
  if (why === 'silent') return [`${who} hears you, and says nothing.`];
  return [`${who} doesn't seem to catch that.`];
}

// One conversation with one villager through the dialog's "Say something…" field.
// Keeps calls one at a time, drops a stale answer once a newer line was sent, and
// never waits forever: after `timeoutMs` the villager simply does not answer, and an
// answer that arrives later is still shown if nothing newer was said.
export class TalkSession {
  constructor({ village, npc, timeoutMs = 30000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.village = village || null;
    this.npc = npc || null;
    this.timeoutMs = timeoutMs;
    // Called unbound: browsers refuse setTimeout with a foreign `this`.
    this.setTimer = (fn, ms) => setTimer(fn, ms);
    this.clearTimer = (id) => clearTimer(id);
    this.seq = 0;
    this.pending = false;
    this.history = []; // [{ from: 'player'|'npc', text }]
    this.onLate = null; // (reply) when an answer arrives after its timeout
  }

  available() {
    return typeof this.village?.playerSays === 'function' && !!this.npc;
  }

  // Resolves to { ok, lines, mood, expr, options, why? } or null when the text is empty
  // or a line is already on its way. Never rejects.
  send(text) {
    const t = String(text ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, SAY_MAX);
    if (!t || this.pending || !this.available()) return Promise.resolve(null);
    const id = ++this.seq;
    this.pending = true;
    this.history.push({ from: 'player', text: t });
    if (this.history.length > 24) this.history.shift();
    let call;
    try {
      call = Promise.resolve(this.village.playerSays(this.npc, t));
    } catch (err) {
      call = Promise.reject(err);
    }
    return new Promise((resolve) => {
      let settled = false;
      const timer = this.setTimer(() => {
        if (settled) return;
        settled = true;
        this.pending = false;
        resolve({ ok: false, why: 'timeout', lines: quietReply(this.npc, 'timeout'), mood: null, expr: null, options: null });
      }, this.timeoutMs);
      call.then(
        (r) => {
          const reply = normalizeReply(r);
          // Heard, and they chose silence: what the player sees them do (DESIGN §23.3).
          const silent = !!(r && typeof r === 'object' && r.silent);
          const ok = !silent && reply.lines.length > 0;
          const act = silent ? normalizeReply(r.act ? [r.act] : []).lines[0] || quietReply(this.npc, 'silent')[0] : null;
          const out = silent ? { ok: false, why: 'silent', silent: true, ...reply, lines: [act] } : ok ? { ok, ...reply } : { ok: false, why: 'empty', ...reply, lines: quietReply(this.npc) };
          if (ok) for (const l of reply.lines) this.history.push({ from: 'npc', text: l });
          if (settled) {
            // Too late for its turn: still worth showing if nothing newer was said.
            if ((ok || silent) && id === this.seq && typeof this.onLate === 'function') this.onLate(out);
            return;
          }
          settled = true;
          this.clearTimer(timer);
          this.pending = false;
          resolve(id === this.seq ? out : null);
        },
        (err) => {
          if (settled) return;
          settled = true;
          this.clearTimer(timer);
          this.pending = false;
          const why = err?.code === 'asleep' ? 'asleep' : 'error';
          resolve({ ok: false, why, lines: quietReply(this.npc, why), mood: null, expr: null, options: null });
        },
      );
    });
  }
}

// ---------- listening in (§19.3 canListen / listenIn) ----------

// The two (or more) people in a conversation, as entities when they can be found.
export function conversationSpeakers(conv, game) {
  if (!conv || typeof conv !== 'object') return [];
  const raw = Array.isArray(conv.speakers) ? conv.speakers : Array.isArray(conv.people) ? conv.people : [conv.a, conv.b];
  const out = [];
  for (const s of raw) {
    if (!s) continue;
    const e = typeof s === 'object' ? s : safeGet(() => game?.entities?.get?.(String(s))) || null;
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

export function nameOfSpeaker(sp, game, lyraName = 'Lyra') {
  if (sp && typeof sp === 'object') return sp.id === 'lyra' ? lyraName : firstName(sp.name) || sp.id || '…';
  if (sp === 'lyra') return lyraName;
  if (sp === 'player') return safeGet(() => game?.settings?.playerName) || 'You';
  const e = safeGet(() => game?.entities?.get?.(String(sp)));
  return (e && firstName(e.name)) || capitalize(String(sp || '…').replace(/_/g, ' '));
}

// "Elda and Garrick", "Elda, Garrick and Pip".
export function namesTogether(names) {
  const l = (names || []).filter(Boolean);
  if (l.length <= 1) return l[0] || '';
  return `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`;
}

// The prompt over the HUD while a conversation plays nearby.
export function listenLabel(conv, game, lyraName = 'Lyra') {
  const names = conversationSpeakers(conv, game).map((e) => nameOfSpeaker(e, game, lyraName));
  return names.length ? `Listen in · ${namesTogether(names)}` : 'Listen in';
}

// The lines of an exchange, as [{ speaker (entity|null), name, text }].
export function exchangeLines(lines, conv, game, lyraName = 'Lyra') {
  const people = conversationSpeakers(conv, game);
  const out = [];
  const list = Array.isArray(lines) ? lines : Array.isArray(lines?.lines) ? lines.lines : [];
  for (let i = 0; i < list.length && out.length < 10; i++) {
    const l = list[i];
    let sp = null;
    let text = '';
    if (typeof l === 'string') {
      text = l;
      sp = people.length ? people[i % people.length] : null;
    } else if (l && typeof l === 'object') {
      text = l.text ?? l.say ?? '';
      const who = l.speaker ?? l.who ?? l.from ?? l.id;
      if (who && typeof who === 'object') sp = who;
      else if (who === 'a') sp = people[0] || null;
      else if (who === 'b') sp = people[1] || null;
      else if (who != null) sp = people.find((p) => p.id === String(who)) || safeGet(() => game?.entities?.get?.(String(who))) || null;
    }
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    out.push({ speaker: sp, name: sp ? nameOfSpeaker(sp, game, lyraName) : '…', text: truncate(t, 300) });
  }
  return out;
}

// Seconds a spoken line stays the speaker's turn before the next one starts.
export function lineBeat(text, textSpeed = 1) {
  const n = String(text || '').length;
  const s = Math.max(0.25, Number(textSpeed) || 1);
  return clamp(1.3 + n / (16 * s) + 0.5, 2, 7.5);
}

// ---------- while you slept (§19.3 nightSummary) ----------

export function nightLines(r) {
  const list = Array.isArray(r) ? r : Array.isArray(r?.lines) ? r.lines : typeof r === 'string' ? r.split(/\n+/) : [];
  const out = [];
  for (const l of list) {
    const t = String((l && typeof l === 'object' ? l.text : l) ?? '')
      .replace(/^[\s\-•*·]+/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (t) out.push(truncate(t, 260));
    if (out.length >= 8) break;
  }
  return out;
}

// ---------- the eighteen (People tab) ----------

export const OPINION_LEVELS = [
  [75, 'Fond', 'fond'],
  [50, 'Friendly', 'friendly'],
  [30, 'Neutral', 'neutral'],
  [15, 'Wary', 'wary'],
  [-Infinity, 'Hostile', 'hostile'],
];

export function opinionLevel(o) {
  const v = num(o, null);
  if (v === null) return null;
  for (const [min, label, key] of OPINION_LEVELS) if (v >= min) return { label, key };
  return { label: 'Hostile', key: 'hostile' };
}

function isVillager(e) {
  if (!e || typeof e !== 'object' || e.removed) return false;
  if (e.id === 'player' || e.id === 'lyra') return false;
  return !!e.profile && (typeof e.getDialogue === 'function' || e.kind === 'human');
}

const bondOrder = (r) => (r?.bond ? num(r.bond.score, 0) : -1);

// Every villager in the world (from the entities) plus the villagers she has a
// relationship with who are not about right now. Best bond with her first.
export function villagerRoster(game, mind = null) {
  const rels = mind?.relationships;
  const byId = new Map();
  const ents = listFrom(safeGet(() => game?.entities), ['all']);
  for (const e of ents) {
    if (!isVillager(e) || byId.has(e.id)) continue;
    byId.set(e.id, { id: e.id, npc: e, name: e.name || e.profile?.name || e.id, role: e.role || e.profile?.role || '' });
  }
  for (const r of listFrom(rels, ['all', 'list'])) {
    if (!r || !r.id || byId.has(r.id) || !r.npc) continue;
    if (r.id === 'player' || r.id === 'lyra' || r.kind === 'group') continue;
    byId.set(r.id, { id: r.id, npc: null, name: r.name || r.id, role: r.role || '' });
  }
  const out = [];
  for (const v of byId.values()) {
    const rel = safeGet(() => rels?.get?.(v.id)) || null;
    const bond = rel ? safeGet(() => rels.bond?.(v.id)) || null : null;
    const opinion = v.npc ? num(v.npc.opinionOfPlayer, null) : null;
    out.push({
      id: v.id,
      name: v.name,
      first: firstName(v.name),
      role: v.role ? String(v.role) : '',
      npc: v.npc,
      rel,
      bond: bond && typeof bond === 'object' ? { level: clamp(Math.round(num(bond.level, 0)), 0, 5), label: String(bond.label || ''), score: num(bond.score, 0) } : null,
      opinion,
      opinionLevel: opinionLevel(opinion),
    });
  }
  out.sort((a, b) => bondOrder(b) - bondOrder(a) || a.first.localeCompare(b.first));
  return out;
}

// The people she is closest to (a bond of Friend or better, or the top few).
export function closestToHer(roster, n = 5) {
  const known = (roster || []).filter((r) => r.rel && r.bond && num(r.rel.affinity, 0) > 0);
  const close = known.filter((r) => r.bond.level >= 3);
  return (close.length >= 2 ? close : known).slice(0, n);
}

// How Hearthvale feels about the player, from each villager's opinionOfPlayer.
export function villageFeeling(roster) {
  const rated = (roster || []).filter((r) => r.opinion !== null && r.opinion !== undefined);
  const counts = { fond: 0, friendly: 0, neutral: 0, wary: 0, hostile: 0 };
  let sum = 0;
  for (const r of rated) {
    sum += r.opinion;
    counts[r.opinionLevel?.key || 'neutral']++;
  }
  const n = rated.length;
  if (!n) return { count: 0, avg: null, label: '', sentence: '', counts, warmest: [], coldest: [] };
  const avg = Math.round(sum / n);
  const level = opinionLevel(avg);
  const sorted = [...rated].sort((a, b) => b.opinion - a.opinion);
  const warmest = sorted.filter((r) => r.opinion >= 60).slice(0, 3);
  const coldest = sorted
    .filter((r) => r.opinion < 30)
    .reverse()
    .slice(0, 3);
  const word = { fond: 'fond of you', friendly: 'friendly toward you', neutral: 'still making up its mind about you', wary: 'wary of you', hostile: 'set against you' }[level.key];
  const most = counts.fond + counts.friendly >= n * 0.6 ? 'Most of Hearthvale' : counts.wary + counts.hostile >= n * 0.5 ? 'Much of Hearthvale' : 'Hearthvale';
  const bits = [`${most} is ${word}.`];
  if (warmest.length) bits.push(`${namesTogether(warmest.map((r) => r.first))} ${warmest.length > 1 ? 'think' : 'thinks'} well of you.`);
  if (coldest.length) bits.push(`${namesTogether(coldest.map((r) => r.first))} ${coldest.length > 1 ? 'keep' : 'keeps'} their distance.`);
  return { count: n, avg, label: level.label, sentence: bits.join(' '), counts, warmest, coldest };
}

// A villager's own closest and hardest bonds in the village, when the village knows them.
export function villagerBonds(village, id, others, nameOf = (x) => x) {
  if (typeof village?.bond !== 'function' || !id) return { close: [], odds: [] };
  const scored = [];
  for (const o of others || []) {
    if (!o || o === id) continue;
    const b = safeGet(() => village.bond(id, o));
    if (!b || typeof b !== 'object') continue;
    const aff = num(b.affinity, 0);
    const tags = Array.isArray(b.tags) ? b.tags.map(String) : [];
    scored.push({ id: o, aff, tags });
  }
  const family = new Set(['parent', 'child', 'spouse', 'sibling', 'ward']);
  const close = scored
    .filter((s) => s.aff >= 45 || s.tags.some((t) => family.has(t) || t === 'friend' || t === 'crush'))
    .sort((a, b) => b.aff - a.aff)
    .slice(0, 3)
    .map((s) => ({ id: s.id, name: nameOf(s.id), tag: s.tags.find((t) => family.has(t) || t === 'crush' || t === 'friend') || '' }));
  const odds = scored
    .filter((s) => s.aff <= -20 || s.tags.some((t) => t === 'rival' || t === 'grudge'))
    .sort((a, b) => a.aff - b.aff)
    .slice(0, 2)
    .map((s) => ({ id: s.id, name: nameOf(s.id), tag: s.tags.find((t) => t === 'rival' || t === 'grudge') || '' }));
  return { close, odds };
}

// ---------- village talk (village.log) ----------

const TOPIC_WORDS = {
  small_talk: '',
  smalltalk: '',
  small: '',
  chat: '',
  gossip: 'the latest gossip',
  work: 'work',
  family: 'family',
  player: 'you',
  the_player: 'you',
  stranger: 'you',
  you: 'you',
  maren: 'Maren',
  bandits: 'the bandits',
  the_bandits: 'the bandits',
  ward: 'the ward',
  the_ward: 'the ward',
  weather: 'the weather',
  harvest: 'the harvest',
  sheaf_moot: 'the Sheaf Moot',
  moot: 'the Moot',
  dance: 'the dance',
  oil: 'the price of oil',
  stones: 'their game of stones',
  stone: 'the stone',
  secrets: 'a secret',
  secret: 'a secret',
  rumor: 'a rumor',
  news: 'the news',
  food: 'supper',
};

export function topicWords(topic, nameOf = null) {
  if (topic == null) return '';
  const raw = typeof topic === 'object' ? topic.id || topic.name || topic.label || '' : topic;
  const key = String(raw).toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (!key) return '';
  if (Object.prototype.hasOwnProperty.call(TOPIC_WORDS, key)) return TOPIC_WORDS[key];
  if (key === 'lyra') return nameOf ? nameOf('lyra') || 'Lyra' : 'Lyra';
  if (nameOf) {
    const n = nameOf(key);
    if (n) return n;
  }
  return String(raw).replace(/_/g, ' ');
}

// One line per logged conversation, newest first: "Lyra and Mira talked about Rowan".
export function villageTalkViews(log, { nameOf = (x) => x, today = 0, limit = 6 } = {}) {
  const list = listFrom(log, ['all', 'list', 'entries']).filter((e) => e && typeof e === 'object' && (e.a || e.summary));
  const sorted = [...list].sort((x, y) => num(y.t, 0) - num(x.t, 0)).slice(0, limit);
  return sorted.map((e) => {
    const a = e.a ? nameOf(typeof e.a === 'object' ? e.a.id : e.a) : '';
    const b = e.b ? nameOf(typeof e.b === 'object' ? e.b.id : e.b) : '';
    const who = namesTogether([a, b].filter(Boolean));
    const about = topicWords(e.topic, nameOf);
    const text = who ? (about ? `${who} talked about ${about}` : `${who} passed the time of day`) : truncate(String(e.summary || ''), 120);
    const summary = e.summary && String(e.summary).trim() && String(e.summary).trim() !== text ? truncate(String(e.summary).trim(), 220) : '';
    return { text, summary, when: talkWhen(e, today) };
  });
}

function talkWhen(e, today) {
  const day = num(e.day, null) ?? (num(e.t, null) !== null ? Math.floor(num(e.t, 0) / DAY_SECONDS) + 1 : null);
  if (!day) return '';
  if (today && day === today) return 'today';
  if (today && day === today - 1) return 'yesterday';
  return `day ${day}`;
}

// What people are saying about the player (rumors about 'player'), newest first.
export function rumorsAboutPlayer(village, limit = 3) {
  const list = listFrom(safeGet(() => village?.rumors), ['all', 'list', 'entries']);
  return list
    .filter((r) => r && typeof r === 'object' && r.text && (r.about === 'player' || (Array.isArray(r.about) && r.about.includes('player'))))
    .sort((a, b) => num(b.t, 0) - num(a.t, 0))
    .slice(0, limit)
    .map((r) => ({ text: truncate(String(r.text), 200), tone: num(r.valence, 0) > 0.15 ? 'good' : num(r.valence, 0) < -0.15 ? 'bad' : 'neutral', heardBy: Array.isArray(r.heardBy) ? r.heardBy.length : 0 }));
}

// ---------- worth it (§19.4 autonomy.worth) ----------

export function readWorth(mind) {
  const fn = safeGet(() => mind?.autonomy?.worth) || safeGet(() => mind?.worth);
  const owner = typeof safeGet(() => mind?.autonomy?.worth) === 'function' ? mind.autonomy : mind;
  if (typeof fn !== 'function') return null;
  const w = safeGet(() => fn.call(owner));
  return w && typeof w === 'object' ? w : null;
}

// Spoken words (to or about herself) are quoted; bare labels are not.
const FIRST_PERSON = /\b(I|I'm|I've|I'd|me|my|mine|myself|you|your|you're|you've)\b/i;

// A clear breakdown: what staying gives her, what it costs her, and the balance.
export function worthView(w) {
  if (!w || typeof w !== 'object') return null;
  const reasons = (Array.isArray(w.reasons) ? w.reasons : []).filter((r) => r && (r.text || r.why)).map((r) => ({ text: String(r.text || r.why).trim(), weight: num(r.weight, 0) }));
  const gives = reasons.filter((r) => r.weight > 0).sort((a, b) => b.weight - a.weight);
  const costs = reasons.filter((r) => r.weight < 0).sort((a, b) => a.weight - b.weight);
  let stay = num(w.stay, null);
  let cost = num(w.cost, null);
  if (stay === null) stay = gives.reduce((s, r) => s + r.weight, 0);
  if (cost === null) cost = -costs.reduce((s, r) => s + r.weight, 0);
  stay = Math.max(0, stay);
  cost = Math.abs(cost);
  const net = num(w.net, stay - cost);
  const total = stay + cost;
  const balance = total > 0 ? stay / total : 0.5;
  const max = Math.max(1e-6, ...reasons.map((r) => Math.abs(r.weight)));
  const shape = (r) => ({ text: r.text, weight: r.weight, share: Math.abs(r.weight) / max, quote: FIRST_PERSON.test(r.text) });
  let verdict;
  let tone;
  if (total <= 0 && !reasons.length) {
    verdict = 'She has not weighed it up yet.';
    tone = 'calm';
  } else if (balance >= 0.8) {
    verdict = 'Staying with you is clearly worth it to her.';
    tone = 'good';
  } else if (balance >= 0.6) {
    verdict = 'On balance, staying is worth it to her.';
    tone = 'good';
  } else if (balance >= 0.45) {
    verdict = 'It is finely balanced. She is still weighing it.';
    tone = 'calm';
  } else if (balance >= 0.3) {
    verdict = 'Right now it costs her nearly as much as it gives.';
    tone = 'warn';
  } else {
    verdict = 'Right now, staying costs her more than it gives.';
    tone = 'bad';
  }
  return { stay: round1(stay), cost: round1(cost), net: round1(net), balance, verdict, tone, gives: gives.map(shape), costs: costs.map(shape) };
}

function round1(v) {
  return Math.round((Number(v) || 0) * 10) / 10;
}

// ---------- edited memories (§17.4) ----------

// An entry she reworded, corrected or let go of: its earlier versions, newest first.
// Returns null for an entry that was never edited.
export function editHistory(entry, today = 0) {
  if (!entry || typeof entry !== 'object') return null;
  const hist = (Array.isArray(entry.history) ? entry.history : []).filter((h) => h && typeof h === 'object' && (h.text || h.why));
  if (!entry.edited && !hist.length) return null;
  const versions = [...hist]
    .sort((a, b) => num(b.t, 0) - num(a.t, 0))
    .map((h) => ({
      text: h.text ? String(h.text).trim() : '',
      why: h.why ? String(h.why).trim() : '',
      importance: num(h.importance, null),
      when: h.t != null ? editWhen(h.t, today) : '',
    }));
  const latestWhy = String(entry.editWhy || entry.why || versions[0]?.why || '').trim();
  return { edited: true, versions, why: latestWhy, count: versions.length };
}

function editWhen(t, today) {
  const v = num(t, null);
  if (v === null) return '';
  const day = Math.floor(v / DAY_SECONDS) + 1;
  if (day <= 0) return '';
  if (today && day === today) return 'today';
  if (today && day === today - 1) return 'yesterday';
  return `day ${day}`;
}

// ---------- toasts that never cover bubbles (§19.6 phone polish) ----------

export function overlaps(a, b, pad = 0) {
  if (!a || !b) return false;
  return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
}

// Where the toast stack goes: the first slot in the upper band (scanning down from
// `top`), else the lower band (scanning up from `bottom`), whose rect touches no
// obstacle. `prefer` (a y from last time) is kept while it stays free, so toasts do not
// hop around. Returns { x, y } or null when no free slot exists (the caller hides them).
export function placeStack({ w, h, viewW, top, bottom, obstacles = [], prefer = null, step = 8, pad = 6, bandSplit = 0.5, x = null } = {}) {
  if (!(w > 0) || !(h > 0)) return { x: x ?? Math.round((viewW - w) / 2), y: top };
  const sx = x ?? Math.round((viewW - w) / 2);
  const free = (y) => {
    const r = { x: sx, y, w, h };
    for (const o of obstacles) if (overlaps(r, o, pad)) return false;
    return true;
  };
  const maxY = bottom - h;
  if (maxY < top) return null;
  if (prefer !== null && prefer >= top && prefer <= maxY && free(prefer)) return { x: sx, y: prefer };
  const split = top + (bottom - top) * bandSplit;
  for (let y = top; y <= Math.min(maxY, split - h * 0.5); y += step) if (free(y)) return { x: sx, y };
  for (let y = maxY; y >= Math.max(top, split - h * 0.5); y -= step) if (free(y)) return { x: sx, y };
  return null;
}
