// Pure view-model helpers for showing Lyra as a person with her own will (DESIGN.md
// §16) and her memory and lore (§17.3): companionship labels, the ledger of what she
// has seen the player do, promises, knowledge grouping, her life timeline, memory
// chips and her farewell. No DOM here, so all of it is unit-tested under node.
// Mind data is written by other modules in parallel: every reader tolerates missing
// or oddly shaped fields.

import { DAY_SECONDS, TILE } from '../core/constants.js';
import { listFrom, truncate, capitalize } from './format.js';

// ---------- companionship (§16.3) ----------

export const COMPANIONSHIP = Object.freeze({
  together: { label: 'With you', tone: 'good', blurb: 'She travels with you because she chooses to, and for as long as it stays good for her.' },
  wary: { label: 'Wary of you', tone: 'warn', blurb: 'She is still beside you, but guarded: she keeps her distance, turns down risky requests and watches what you do.' },
  apart: { label: 'Living her own life', tone: 'calm', blurb: 'She is going her own way for now. She is friendly, and she may travel with you again if she wants to.' },
  left: { label: 'Left you', tone: 'bad', blurb: 'She broke off after being hurt or betrayed. She will only come back after amends she believes, and time.' },
  gone: { label: 'Gone', tone: 'grave', blurb: 'She has cut you out of her life. She lives with her parents in Hearthvale, keeps out of your way, and gives you a word at most.' },
});

export const COMPANIONSHIP_STATES = Object.keys(COMPANIONSHIP);

function stateName(v) {
  if (v && typeof v === 'object') v = v.state;
  return typeof v === 'string' && COMPANIONSHIP[v] ? v : null;
}

// Her state as the mind reports it ('together' when nothing says otherwise).
export function readCompanionship(mind) {
  if (!mind) return 'together';
  return stateName(safeGet(() => mind.companionship)) || stateName(safeGet(() => mind.autonomy?.companionship)) || 'together';
}

// The game-wide view: a recorded departure wins even after her body left the world.
export function companionshipOf(game) {
  if (game?.flags?.lyra_gone) return 'gone';
  return readCompanionship(game?.companion?.mind);
}

export function companionshipLabel(state) {
  return (COMPANIONSHIP[state] || COMPANIONSHIP.together).label;
}

export function companionshipTone(state) {
  return (COMPANIONSHIP[state] || COMPANIONSHIP.together).tone;
}

export function companionshipBlurb(state) {
  return (COMPANIONSHIP[state] || COMPANIONSHIP.together).blurb;
}

// How much of the "Ask Lyra" bar makes sense: everything while she travels with you,
// only talking and asking her back while she is apart, nothing once she is gone.
export function barMode(state) {
  if (state === 'gone') return 'hidden';
  if (state === 'apart' || state === 'left') return 'collapsed';
  return 'full';
}

// Whether the player can hand her something right now: she has to be there, awake
// and within arm's reach of a short walk (`maxTiles`). Her own requests (asking her to
// hand something over) need no reach: she walks over herself if she agrees.
export const HAND_REACH_TILES = 6;

export function handReach(game, maxTiles = HAND_REACH_TILES) {
  const c = game?.companion;
  const p = game?.player;
  if (companionshipOf(game) === 'gone' || !c || c.removed) return { ok: false, why: 'gone', tiles: null };
  if (!p) return { ok: false, why: 'none', tiles: null };
  if (c.downed) return { ok: false, why: 'downed', tiles: null };
  const dx = Number(c.x) - Number(p.x);
  const dy = Number(c.y) - Number(p.y);
  const tiles = Math.hypot(dx, dy) / TILE;
  if (!Number.isFinite(tiles)) return { ok: false, why: 'none', tiles: null };
  if (tiles > maxTiles) return { ok: false, why: 'far', tiles: Math.round(tiles) };
  return { ok: true, why: '', tiles: Math.round(tiles) };
}

// The line under her pack when nothing can be handed over.
export function reachNote(r, name = 'Lyra') {
  if (!r || r.ok) return '';
  if (r.why === 'gone') return `${name} is gone. Nothing of yours can reach her now.`;
  if (r.why === 'downed') return `${name} is knocked out. Help her up first.`;
  if (r.why === 'far') return `${name} is ${r.tiles} paces away. Walk over to her to hand anything across.`;
  return '';
}

// The reason she gave for her current state, wherever the mind keeps it.
export function companionshipReason(mind) {
  const a = safeGet(() => mind?.autonomy) || {};
  const candidates = [mind?.companionshipReason, a.companionshipReason, a.reason, a.lastReason, a.why];
  for (const c of candidates) if (typeof c === 'string' && c.trim()) return c.trim();
  return '';
}

// ---------- her answer to a request (§16.4) ----------

const ACCEPTED = new Set(['accept', 'accept_conditional']);

// Read an ActionRegistry.run() result for the player: was it refused, what does she
// say and did she offer something else instead. Her words come from, in order: the
// gate's or the action's message; a line she already spoke aloud while the request
// ran (`heard`: the brain answers HUD requests with a bark); `fallback`; `pick(kind)`.
// `bubble` is false when the line is already over her head.
export function requestAnswer(r, { kind = '', fallback = '', pick = () => '', heard = [] } = {}) {
  const verdict = r && typeof r.verdict === 'object' && r.verdict ? r.verdict : null;
  const refused = !!r?.refused || (!!verdict?.decision && !ACCEPTED.has(verdict.decision));
  const ok = !!r?.ok && !refused;
  const spoken = Array.isArray(heard) ? heard.filter((x) => typeof x === 'string' && x.trim()) : [];
  const msg = String(r?.message || (refused || verdict?.decision === 'accept_conditional' ? verdict?.message : '') || '').trim();
  let line = msg;
  let bubble = true;
  if (line) bubble = !spoken.includes(line);
  else if (spoken.length) {
    line = spoken[spoken.length - 1].trim();
    bubble = false;
  } else line = String((ok ? fallback || pick(kind) : pick(refused ? 'refused' : 'failed')) || '');
  const c = refused ? verdict?.counter : null;
  const counter = c && c.name ? { label: counterLabel(c), name: String(c.name), args: c.args && typeof c.args === 'object' ? c.args : {} } : null;
  return { ok, refused, line, bubble, kind: refused ? 'refusal' : ok ? 'answer' : 'problem', counter, decision: verdict?.decision || (ok ? 'accept' : null) };
}

// The button under a refusal that takes her counter-offer, in the player's words.
const COUNTER_WORDS = {
  sit: 'Rest, then',
  sleep: 'Get some sleep, then',
  use_item: 'Eat something first',
  follow: 'Walk with me, then',
  come_here: 'Come here, then',
  stay: 'Wait here, then',
  wait: 'Wait a moment, then',
  wait_outside: 'Wait outside, then',
  retreat: 'Fall back, then',
  free_will: 'Do as you like, then',
  guard: 'Keep watch, then',
  stop_job: 'Leave the work, then',
};
const COUNTER_STANCE = { attack: 'Fight, then', defend: 'Just defend us, then', passive: 'Stay out of it, then' };

export function counterLabel(c) {
  const name = String(c?.name || '');
  const value = c?.args?.value != null ? String(c.args.value) : '';
  if (name === 'set_combat_mode' && COUNTER_STANCE[value]) return COUNTER_STANCE[value];
  if (name === 'start_job' && value) {
    const amount = Number(c.args.amount);
    const what = value.replace(/_/g, ' ');
    return `${capitalize(what)}${Number.isFinite(amount) && amount > 0 ? ` (${amount})` : ''} instead`;
  }
  return COUNTER_WORDS[name] || 'All right, your way';
}

// Her standing plan in words, for the Now tab ("Plan: her own day").
const DIRECTIVE_WORDS = {
  follow: 'walking with you',
  stay: 'holding a spot',
  wait: 'waiting a moment',
  goto: 'on her way somewhere',
  job: 'working',
  guard: 'keeping watch',
  patrol: 'on patrol',
  explore: 'exploring',
  free: 'free time',
  independent: 'her own day',
  flee: 'running to safety',
  leave: 'leaving',
  keep_away: 'keeping her distance',
  wait_outside: 'waiting outside',
};

export function directiveWords(type) {
  if (!type) return 'taking things as they come';
  return DIRECTIVE_WORDS[type] || String(type).replace(/_/g, ' ');
}

// ---------- right now (Now tab) ----------

const EMOTION_ADJ = { joy: 'glad', sadness: 'sad', fear: 'afraid', anger: 'angry', trust: 'trusting', surprise: 'surprised', affection: 'affectionate', curiosity: 'curious', pride: 'proud', embarrassment: 'embarrassed' };

// "a", "a and b", "a, b and c".
export function joinWords(list) {
  const l = (list || []).map((x) => String(x).trim()).filter(Boolean);
  if (l.length <= 1) return l[0] || '';
  return `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`;
}

// How she is right now, in a few plain sentences, from mind.summary().
export function nowParagraph(sum, { name = 'Lyra' } = {}) {
  if (!sum || typeof sum !== 'object') return '';
  const out = [];
  const label = sum.mood && typeof sum.mood === 'object' && sum.mood.label ? String(sum.mood.label) : '';
  const adj = (Array.isArray(sum.emotions) ? sum.emotions : [])
    .filter((e) => e && Number(e.value) >= 0.35 && EMOTION_ADJ[e.name])
    .map((e) => EMOTION_ADJ[e.name])
    .filter((a) => a !== label)
    .slice(0, 2);
  const feels = [label, ...adj].filter(Boolean);
  if (feels.length) out.push(`${name} feels ${joinWords(feels)}.`);
  const status = String(sum.status || '').trim();
  if (status) out.push(`Right now she is ${status}.`);
  if (typeof sum.pressingText === 'string' && sum.pressingText.trim()) out.push(`She is ${sum.pressingText.trim()}.`);
  const onMind = (Array.isArray(sum.onMind) ? sum.onMind : []).filter((x) => typeof x === 'string' && x.trim()).slice(0, 3);
  if (onMind.length) out.push(`On her mind: ${joinWords(onMind)}.`);
  else if (typeof sum.goal === 'string' && sum.goal.trim()) out.push(`On her mind: ${sum.goal.trim().replace(/[.!]$/, '')}.`);
  return out.join(' ');
}

// ---------- the player in her eyes (§16.2) ----------

const num = (v, d = null) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);

export function playerRelation(mind) {
  const rel = safeGet(() => mind?.relationships?.get?.('player'));
  if (!rel || typeof rel !== 'object') return null;
  return {
    trust: clampTo(num(rel.trust, 50), 0, 100),
    fear: clampTo(num(rel.fear, 0), 0, 100),
    affinity: clampTo(num(rel.affinity, 0), -100, 100),
    respect: clampTo(num(rel.respect, 50), 0, 100),
    familiarity: clampTo(num(rel.familiarity, 0), 0, 100),
  };
}

export function trustWords(trust) {
  const t = num(trust, 50);
  if (t >= 80) return 'trusts you deeply';
  if (t >= 60) return 'trusts you';
  if (t >= 40) return 'is not sure about you yet';
  if (t >= 20) return 'doubts you';
  return 'does not trust you';
}

export function fearWords(fear) {
  const f = num(fear, 0);
  if (f >= 60) return 'is afraid of you';
  if (f >= 35) return 'is uneasy around you';
  if (f >= 15) return 'is a little on guard';
  return 'is not afraid of you';
}

// Where she sleeps follows from trust and fear (§16.1).
export function sleepsAt(rel) {
  if (!rel) return 'the cottage';
  return rel.trust >= 50 && rel.fear <= 20 ? 'the cottage' : 'a rented room at the Ember Kettle';
}

// ---------- the ledger (§16.2) ----------

export const DEED_LABELS = Object.freeze({
  protected_lyra: 'Protected her',
  revived_lyra: 'Came back for her',
  gift_liked: 'A gift she liked',
  gift_loved: 'A gift she loved',
  gift_disliked: 'A gift she did not like',
  kept_promise: 'Kept your word',
  broke_promise: 'Broke your word',
  respected_refusal: 'Took her no for an answer',
  pushed_after_refusal: 'Pushed after she said no',
  kindness: 'A kindness',
  reckless_order: 'Led her into danger',
  hit_lyra_accident: 'Hit her by accident',
  hit_lyra: 'Struck her',
  downed_lyra: 'Knocked her out',
  abandoned_downed: 'Left her lying hurt',
  killed_harmless: 'Killed a harmless creature',
  attacked_villager: 'Attacked a villager',
  downed_villager: 'Knocked out a villager',
  attacked_guard: 'Attacked a guard',
  stole: 'Stole',
  lied: 'Lied to her',
});

export function deedLabel(deed) {
  if (!deed) return 'Something she saw';
  return DEED_LABELS[deed] || capitalize(String(deed).replace(/_/g, ' '));
}

// "+2", "−3", "−0.5" (a true minus sign), "±0".
export function formatSeverity(sev) {
  const v = num(sev, 0);
  if (v === 0) return '±0';
  const a = Math.abs(v);
  const s = Number.isInteger(a) ? String(a) : a.toFixed(1).replace(/\.0$/, '');
  return v > 0 ? `+${s}` : `−${s}`;
}

export function severityTone(sev) {
  const v = num(sev, 0);
  if (v > 0) return 'good';
  if (v === 0) return 'neutral';
  if (v >= -1) return 'minor';
  if (v > -5) return 'bad';
  return 'grave';
}

// Game seconds -> "3:40 PM".
export function clockLabel(t) {
  const secs = num(t, null);
  if (secs === null) return '';
  const hour = (((secs % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS) / DAY_SECONDS * 24;
  return hourLabel(hour, true);
}

// 7 -> "7 AM", 13.5 -> "1:30 PM" (minutes only when they matter, or always with `exact`).
export function hourLabel(hour, exact = false) {
  const hv = num(hour, 0);
  let h = Math.floor(hv);
  let m = Math.round((hv - h) * 60);
  if (m === 60) {
    h += 1;
    m = 0;
  }
  h = ((h % 24) + 24) % 24;
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return exact || m ? `${h12}:${String(m).padStart(2, '0')} ${ampm}` : `${h12} ${ampm}`;
}

// The in-game day of an entry; 0 for anything from before the game began (her seeded
// memories carry day 0 and a time before the first morning).
export function dayOf(entry) {
  const d = num(entry?.day, null);
  if (d !== null) return d > 0 ? Math.floor(d) : 0;
  const t = num(entry?.t, null);
  if (t === null) return 0;
  const day = Math.floor(t / DAY_SECONDS) + 1;
  return day > 0 ? day : 0;
}

// "Today · 3:40 PM", "Yesterday · 9:05 AM", "Day 2 · 9:05 AM".
export function whenLabel(entry, today) {
  const d = dayOf(entry);
  const time = num(entry?.t, null) === null ? '' : clockLabel(entry.t);
  let day = d ? `Day ${d}` : '';
  if (d && today && d === today) day = 'Today';
  else if (d && today && d === today - 1) day = 'Yesterday';
  return [day, time].filter(Boolean).join(' · ');
}

export function ledgerEntries(mind) {
  const list = listFrom(safeGet(() => mind?.ledger) ?? safeGet(() => mind?.autonomy?.ledger), ['all', 'list', 'entries']);
  return list.filter((e) => e && typeof e === 'object');
}

// One ledger row ready to draw.
export function ledgerView(entry, today) {
  const sev = num(entry?.severity, 0);
  const label = deedLabel(entry?.deed);
  const text = String(entry?.text || '').trim();
  return {
    deed: entry?.deed || '',
    label,
    text: text && text !== label ? text : '',
    when: whenLabel(entry, today),
    sev: formatSeverity(sev),
    tone: severityTone(sev),
    t: num(entry?.t, 0),
  };
}

// Newest first.
export function ledgerViews(list, today) {
  return [...(list || [])]
    .filter((e) => e && typeof e === 'object')
    .sort((a, b) => num(b.t, 0) - num(a.t, 0))
    .map((e) => ledgerView(e, today));
}

export function ledgerTally(list) {
  let good = 0;
  let bad = 0;
  let net = 0;
  for (const e of list || []) {
    const s = num(e?.severity, 0);
    if (s > 0) good++;
    else if (s < 0) bad++;
    net += s;
  }
  return { good, bad, net: Math.round(net * 10) / 10 };
}

// ---------- promises (§16.8) ----------

const PROMISE_STATES = { open: 'Open', kept: 'Kept', broken: 'Broken' };

export function promiseEntries(mind) {
  return listFrom(safeGet(() => mind?.promises) ?? safeGet(() => mind?.autonomy?.promises), ['all', 'list', 'entries']).filter((p) => p && typeof p === 'object' && p.text);
}

export function promiseView(p, { lyraName = 'Lyra', today = 0 } = {}) {
  const state = PROMISE_STATES[p?.state] ? p.state : 'open';
  const byPlayer = p?.by === 'player';
  const due = num(p?.due, null);
  return {
    id: p?.id || '',
    text: String(p?.text || '').trim(),
    by: byPlayer ? 'You promised' : `${lyraName} promised`,
    byPlayer,
    state,
    stateLabel: PROMISE_STATES[state],
    due: state === 'open' && due !== null && due > 0 ? `by ${whenLabel({ t: due }, today)}` : '',
  };
}

// Open promises first, then the rest, newest first within each.
export function promiseViews(list, opts) {
  const rank = (p) => (p?.state === 'open' || !PROMISE_STATES[p?.state] ? 0 : 1);
  return [...(list || [])]
    .filter((p) => p && p.text)
    .sort((a, b) => rank(a) - rank(b) || num(b.t, 0) - num(a.t, 0))
    .map((p) => promiseView(p, opts));
}

// ---------- her day (§16.1) ----------

export function agendaOf(mind) {
  const a = safeGet(() => mind?.agenda) ?? safeGet(() => mind?.autonomy?.agenda);
  return a && typeof a === 'object' ? a : null;
}

export function planViews(today, hour, nameOfPlace = (id) => id) {
  const h = num(hour, -1);
  return (Array.isArray(today) ? today : [])
    .filter((p) => p && (p.activity || p.why))
    .map((p) => {
      const from = num(p.from, null);
      const to = num(p.to, null);
      const time = from !== null && to !== null ? `${hourLabel(from)} – ${hourLabel(to)}` : from !== null ? `from ${hourLabel(from)}` : '';
      const now = from !== null && to !== null && h >= from && h < to;
      const done = to !== null && h >= to;
      return {
        time,
        activity: capitalize(String(p.activity || '').replace(/_/g, ' ')),
        place: p.at ? nameOfPlace(p.at) || '' : '',
        why: String(p.why || '').trim(),
        now,
        done,
      };
    });
}

// ---------- knowledge (§17.2) ----------

export const KNOWLEDGE_KINDS = Object.freeze([
  ['fact', 'Fact'],
  ['lore', 'Lore'],
  ['theory', 'Theory'],
  ['rumor', 'Rumor'],
]);

const KIND_SET = new Set(KNOWLEDGE_KINDS.map(([k]) => k));

export const SOURCE_LABELS = Object.freeze({
  lore: 'old lore',
  told: 'someone told her',
  observed: 'saw it herself',
  player: 'you told her',
  inferred: 'her own guess',
  read: 'read it',
  self: 'her own thought',
});

export function knowledgeKind(k) {
  const kind = String(k?.kind || '').toLowerCase();
  if (KIND_SET.has(kind)) return kind;
  if (k?.source === 'lore' || k?.loreId) return 'lore';
  if (k?.source === 'inferred') return 'theory';
  return 'fact';
}

export function sourceLabel(k, nameOf = null) {
  const src = String(k?.source || '');
  const teller = k?.from || k?.by || k?.toldBy || k?.teller;
  if (src === 'told' && teller) {
    const n = nameOf ? nameOf(teller) : String(teller);
    if (n) return `told by ${n}`;
  }
  return SOURCE_LABELS[src] || (src ? src.replace(/_/g, ' ') : '');
}

export function confidenceWord(c) {
  const v = num(c, null);
  if (v === null) return '';
  if (v >= 0.85) return 'certain';
  if (v >= 0.6) return 'fairly sure';
  if (v >= 0.35) return 'unsure';
  return 'doubtful';
}

export function knowledgeEntries(mind) {
  return listFrom(safeGet(() => mind?.knowledge), ['all', 'list', 'entries', 'items']).filter((k) => k && typeof k === 'object' && k.text);
}

// [{ subject, label, items }] alphabetical by label; items newest first.
// kind: 'all' or one of KNOWLEDGE_KINDS; query: every word must appear.
export function groupKnowledge(list, { query = '', kind = 'all', nameOf = null } = {}) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const groups = new Map();
  for (const k of list || []) {
    if (!k || !k.text) continue;
    if (kind !== 'all' && knowledgeKind(k) !== kind) continue;
    const subject = String(k.subject || 'other');
    const label = (nameOf && nameOf(subject)) || capitalize(subject.replace(/_/g, ' '));
    if (words.length) {
      const hay = `${subject} ${label} ${k.text} ${k.kind || ''} ${(k.about || []).join(' ')}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
    }
    const key = subject.toLowerCase();
    if (!groups.has(key)) groups.set(key, { subject, label, items: [] });
    groups.get(key).items.push(k);
  }
  const out = [...groups.values()];
  for (const g of out) g.items.sort((a, b) => num(b.t, 0) - num(a.t, 0));
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

export function knowledgeCounts(list) {
  const c = { all: 0, fact: 0, lore: 0, theory: 0, rumor: 0 };
  for (const k of list || []) {
    if (!k || !k.text) continue;
    c.all++;
    c[knowledgeKind(k)]++;
  }
  return c;
}

// ---------- her life (§17.1, §17.2) ----------

export function ageLabel(age) {
  if (age === 0 || age === '0') return 'Birth';
  const v = num(age, null);
  if (v !== null) return `Age ${v}`;
  return age ? capitalize(String(age)) : '';
}

function lifeFromMemories(mind) {
  const direct = listFrom(safeGet(() => mind?.life), ['all', 'list', 'entries', 'items']);
  if (direct.length) return direct;
  const mem = listFrom(safeGet(() => mind?.memory), ['all', 'list', 'entries', 'items', 'memories']);
  return mem.filter((m) => m && (m.type === 'life' || m.store === 'life' || (Array.isArray(m.tags) && m.tags.includes('life'))));
}

// Her life from birth to today: her life memories, else the story's lyraLife, else
// what her soul says about her past. Sorted by age; entries without one go last.
export function lifeTimeline({ mind = null, story = null, soul = null } = {}) {
  let src = lifeFromMemories(mind);
  if (!src.length && story && Array.isArray(story.lyraLife)) src = story.lyraLife;
  const out = [];
  const seen = new Set();
  for (const e of src) {
    if (!e || !(e.text || e.title)) continue;
    const key = e.id || `${e.age}|${e.title || ''}|${e.text || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: e.id || key,
      age: e.age ?? null,
      ageLabel: ageLabel(e.age),
      title: String(e.title || '').trim() || truncate(String(e.text || ''), 48),
      text: String(e.text || '').trim(),
      feeling: e.feeling ? String(e.feeling) : typeof e.emotion === 'string' ? e.emotion : '',
      people: Array.isArray(e.people) ? e.people : Array.isArray(e.about) ? e.about : [],
      places: Array.isArray(e.places) ? e.places : e.location ? [e.location] : [],
      importance: num(e.importance, 5),
    });
  }
  if (!out.length && soul && typeof soul === 'object') {
    if (soul.origin) out.push({ id: 'soul-origin', age: 0, ageLabel: 'Birth', title: 'Where she comes from', text: String(soul.origin), feeling: '', people: [], places: [], importance: 6 });
    if (soul.backstory) out.push({ id: 'soul-backstory', age: null, ageLabel: 'Before Hearthvale', title: 'Before Hearthvale', text: String(soul.backstory), feeling: '', people: [], places: [], importance: 8 });
  }
  const ageKey = (x) => {
    const v = num(x.age, null);
    return v === null ? Infinity : v;
  };
  return out.sort((a, b) => ageKey(a) - ageKey(b));
}

// ---------- memory chips (§17.3) ----------

// Normalize what the brain attached to a reply: ids, or {id, label, store, text}.
export function memoryRefs(list, max = 6) {
  const out = [];
  const seen = new Set();
  for (const m of Array.isArray(list) ? list : []) {
    let ref = null;
    if (typeof m === 'string' || typeof m === 'number') ref = { id: String(m), label: '', store: '', text: '' };
    else if (m && typeof m === 'object') ref = { id: String(m.id ?? m.memoryId ?? ''), label: String(m.label || m.title || m.subject || ''), store: String(m.store || m.type || ''), text: String(m.text || '') };
    if (!ref || (!ref.id && !ref.text && !ref.label)) continue;
    const key = ref.id || ref.text || ref.label;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
    if (out.length >= max) break;
  }
  return out;
}

const STORY_SECTIONS = ['world', 'timeline', 'places', 'people', 'lyraLife'];

// Find what a memory id points at, in any of her stores or the story.
// Returns { id, text, title, store, day } or null.
export function findMemory(mind, id, story = null) {
  if (!id) return null;
  const sid = String(id);
  const hit = (m, store) =>
    m && typeof m === 'object'
      ? { id: sid, text: String(m.text || m.question || ''), title: String(m.title || m.subject || m.name || ''), store, day: dayOf(m) }
      : null;
  // The mind's own resolver understands every cited form ('m12', 'k4', 'life:born').
  const direct = safeGet(() => mind?.lookup?.(sid));
  if (direct && typeof direct === 'object' && (direct.text || direct.title || direct.label)) {
    return { id: sid, text: String(direct.text || ''), title: String(direct.title || direct.label || ''), store: String(direct.store || 'memory'), day: dayOf(direct.ref || direct) };
  }
  const byId = (list) => list.find((m) => m && String(m.id) === sid) || null;
  const mem = safeGet(() => mind?.memory?.get?.(sid)) || byId(listFrom(safeGet(() => mind?.memory), ['all', 'list', 'entries', 'items', 'memories']));
  if (mem) return hit(mem, 'memory');
  const k = byId(knowledgeEntries(mind));
  if (k) return hit(k, 'knowledge');
  const life = byId(listFrom(safeGet(() => mind?.life), ['all', 'list', 'entries', 'items']));
  if (life) return hit(life, 'life');
  if (story) {
    for (const sec of STORY_SECTIONS) {
      const e = Array.isArray(story[sec]) ? byId(story[sec]) : null;
      if (e) return hit(e, sec === 'lyraLife' ? 'life' : 'lore');
    }
  }
  return null;
}

// The words on a chip: what she remembered, briefly.
export function memoryChipLabel(ref, found = null, max = 34) {
  const base = ref?.label || found?.title || ref?.text || found?.text || '';
  const clean = String(base).replace(/\s+/g, ' ').trim();
  if (!clean) return 'something';
  const lower = /^[A-Z][a-z]/.test(clean) && !/^(I|I'm|Maren|Lyra|Cal|Hearthvale)\b/.test(clean) ? clean[0].toLowerCase() + clean.slice(1) : clean;
  return truncate(lower, max);
}

export const STORE_LABELS = Object.freeze({ memory: 'a memory', episode: 'a memory', knowledge: 'something she knows', life: 'her past', lore: 'old lore', person: 'someone she knows', working: 'on her mind' });

// ---------- farewell (§16.3 gone) ----------

// The last sentences of a text, up to `max` characters.
export function lastSentences(text, max = 180) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const parts = t.match(/[^.!?…]+[.!?…]+["'”’)]*\s*|[^.!?…]+$/g) || [t];
  let out = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    const next = parts[i].trim() + (out ? ` ${out}` : '');
    if (next.length > max) break;
    out = next;
  }
  return out || truncate(t.slice(-max), max);
}

// What the HUD shows once she is gone: her own last words, from her diary.
export function farewellText(mind, flags = null, max = 180) {
  const gone = flags?.lyra_gone;
  if (gone && typeof gone === 'object' && typeof gone.farewell === 'string' && gone.farewell.trim()) return lastSentences(gone.farewell, max);
  const diary = listFrom(safeGet(() => mind?.diary), ['all', 'list', 'entries']);
  const last = diary[diary.length - 1];
  const text = typeof last === 'string' ? last : last?.text;
  if (text && String(text).trim()) {
    const paras = String(text).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    return lastSentences(paras[paras.length - 1] || text, max);
  }
  return '';
}

// ---------- small shared bits ----------

function clampTo(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function safeGet(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
