// Filling the village's voice banks (voices.js) into lines one person says to another.
// Pure helpers: no game state beyond what the caller passes in.

import { VOICES, ALIASES } from './voices.js';
import { SHORT_NAMES, PEOPLE } from './bonds_data.js';
import { speakable } from './hidden.js';

export function voiceOf(id) {
  return VOICES[id] || null;
}

export function rnd(rng) {
  return rng && typeof rng.next === 'function' ? rng.next() : Math.random();
}

export function pickOne(list, rng, avoid = null) {
  if (!Array.isArray(list) || !list.length) return null;
  if (list.length === 1) return list[0];
  for (let k = 0; k < 5; k++) {
    const l = list[Math.floor(rnd(rng) * list.length)];
    if (!avoid || !avoid.has(l)) return l;
  }
  return list[Math.floor(rnd(rng) * list.length)];
}

export function shortName(id) {
  return SHORT_NAMES[id] || (id ? String(id).charAt(0).toUpperCase() + String(id).slice(1) : '');
}

// How one person names another in the third person, when it is not simply their name.
const THIRD = {
  hobb: { lyra: 'Star', wenna: 'Wenna' },
  wenna: { hobb: 'that man' },
  pip: { bram: 'Mister Bram', corran: 'Mister Corran', garrick: 'Mister Garrick', rowan: 'the Captain' },
  wys: { rowan: 'the Captain' },
  petra: { alder: 'my son' },
  tilly: { petra: 'Gran', alder: 'Da' },
  tansy: { tobias: 'Da' },
  alder: { petra: 'Mother', tilly: 'Ottilie' },
  sabeth: { hobb: 'Hobb', wenna: 'Wenna' },
};

export function thirdName(speakerId, aboutId) {
  return THIRD[speakerId]?.[aboutId] || shortName(aboutId);
}

// What the speaker calls the person they are talking to, to their face ('' = no name).
export function callName(speakerId, listenerId, { playerName = '', knowsPlayer = false } = {}) {
  const v = voiceOf(speakerId);
  if (listenerId === 'player') return knowsPlayer && playerName ? playerName : '';
  const c = v?.calls?.[listenerId];
  if (c) return c;
  const name = shortName(listenerId);
  if (v?.callDefault) return v.callDefault.replace(/\{name\}/g, name);
  return name;
}

const ALIAS_RES = new Map();
function aliasRe(id) {
  let re = ALIAS_RES.get(id);
  if (re === undefined) {
    const names = [...new Set([shortName(id), ...(ALIASES[id] || [])])].filter(Boolean);
    re = names.length ? new RegExp(`(^|[^\\w'])(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w'])`, 'i') : null;
    ALIAS_RES.set(id, re);
  }
  return re;
}

// Does a line (before filling) talk about this person in the third person?
export function names(text, id) {
  const re = aliasRe(id);
  return !!re && re.test(String(text || ''));
}

// Does a line name someone other than the listener (and the speaker)? Lines written for
// one particular person ("I did not water it, Petra.") are only said to them.
export function namesOther(text, speakerId, listenerId) {
  for (const id of PEOPLE) {
    if (id === listenerId || id === speakerId) continue;
    if (names(text, id)) return true;
  }
  return false;
}

// Remove a {n} the speaker has no name for, with the comma or full stop around it.
function dropName(text) {
  return text
    .replace(/,\s*\{n\}(?=[.!?,;:]|$)/g, '')
    .replace(/^(?:\{n\}[,.!?]?\s*)+/, '')
    .replace(/([.!?]\s+)\{n\}[,.!]\s*/g, '$1')
    .replace(/\s+[—–]\s*\{n\}(?=[.!?])/g, '')
    .replace(/\s*\{n\}\s*/g, ' ');
}

const CLAUSES = new Set(['rumor', 'you', 'who']);

function capFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Fill a template. vars: { n, lyra, stranger, P, rumor, who, you }. Returns null when a
// placeholder is left over or the line would speak a hidden truth.
export function fill(text, vars = {}) {
  if (typeof text !== 'string' || !text) return null;
  let s = text;
  if (/\{n\}/.test(s) && !vars.n) s = dropName(s);
  // A clause dropped in after a full stop or question ("have you heard? {rumor}!") starts
  // a new sentence, so it takes a capital.
  s = s.replace(/\{(\w+)\}/g, (m, k, at, whole) => {
    if (vars[k] == null || vars[k] === '') return m;
    const v = String(vars[k]);
    return CLAUSES.has(k) && /(^|[^.][.!?])["”’']?\s+$/.test(whole.slice(0, at)) ? capFirst(v) : v;
  });
  if (/\{\w+\}/.test(s)) return null;
  s = s
    .replace(/\s+([,!?]|\.(?!\.))/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.]+/, '')
    .trim();
  // A rumor clause starts lowercase; the sentence still starts with a capital.
  s = capFirst(s);
  if (!s || !speakable(s)) return null;
  return s;
}

// The variables a speaker uses when talking to a listener.
export function varsFor(speakerId, listenerId, extra = {}) {
  const v = voiceOf(speakerId);
  return {
    n: extra.n !== undefined ? extra.n : callName(speakerId, listenerId, extra),
    lyra: thirdName(speakerId, 'lyra'),
    stranger: v?.stranger || 'the stranger',
    P: extra.playerName || v?.stranger || 'the stranger',
    ...extra,
  };
}

// Pick and fill a line from a pool, skipping lines that talk about the listener in the
// third person (unless `direct`: lines written to that listener), and recently said ones.
export function say(pool, speakerId, listenerId, { rng, vars = null, direct = false, onlyFor = false, avoid = null, extra = {} } = {}) {
  if (!Array.isArray(pool) || !pool.length) return null;
  const v = vars || varsFor(speakerId, listenerId, extra);
  const order = pool.length === 1 ? [0] : shuffledIdx(pool.length, rng);
  let fallback = null;
  const noName = !(v.n != null && v.n !== '');
  for (const i of order) {
    const raw = pool[i];
    // Without a name for them, a line that opens on their name reads wrong: keep it for last.
    if (noName && /^\{n\}/.test(raw) && pool.some((r) => !/^\{n\}/.test(r))) {
      fallback = fallback || fill(raw, v);
      continue;
    }
    if (!direct && listenerId && listenerId !== 'player' && names(raw, listenerId)) continue;
    if (listenerId === 'lyra' && /\{lyra\}/.test(raw)) continue;
    if (onlyFor && namesOther(raw, speakerId, listenerId)) continue;
    // Never tell someone about themselves as "the stranger".
    if (listenerId === 'player' && /\{stranger\}|\{P\}/.test(raw) && !extra.aboutPlayer) continue;
    const out = fill(raw, v);
    if (!out) continue;
    if (avoid && avoid.has(out)) {
      fallback = fallback || out;
      continue;
    }
    return out;
  }
  return fallback;
}

function shuffledIdx(n, rng) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd(rng) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// A topic's pool for a speaker: plain arrays, or keyed by condition.
// cond: { weather: 'rain'|'fog'|'clear'|'night', stance: 'good'|'mid'|'bad' }
export function topicPool(speakerId, topic, cond = {}) {
  const t = voiceOf(speakerId)?.about?.[topic];
  if (!t) return null;
  if (Array.isArray(t)) return t;
  if (topic === 'weather') return t[cond.weather] || t.clear || t.night || null;
  if (topic === 'stranger') return t[cond.stance] || t.mid || null;
  for (const k of Object.keys(t)) if (Array.isArray(t[k]) && t[k].length) return t[k];
  return null;
}

export function hasTopic(speakerId, topic) {
  return !!voiceOf(speakerId)?.about?.[topic];
}
