// Turning whatever Claude sends back into something safe to act on.
//
// Structured outputs make well-formed replies the norm, but a reply can still arrive
// as prose around JSON, with missing fields, wrong types, synonyms, unknown actions or
// numbers out of range (the claude.ai path has no schema enforcement at all). Every
// function here accepts anything and returns a fully-formed, clamped value.

import { EMOTION_NAMES, REL_TAGS } from './effects.js';

export const MAX_ACTIONS = 6;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v, max = 400) {
  if (v == null) return null;
  if (typeof v === 'object') return null;
  const s = String(v).trim();
  if (!s || /^(?:null|none|undefined|n\/a)$/i.test(s)) return null;
  return s.length > max ? s.slice(0, max) : s;
}

// Parse JSON tolerantly: whole text, a fenced block, or the outermost {...} / [...].
export function extractJson(text) {
  if (text == null) return null;
  if (typeof text === 'object') return text;
  const s = String(text).trim();
  if (!s) return null;
  const attempts = [s];
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) attempts.push(fence[1].trim());
  const o1 = s.indexOf('{');
  const o2 = s.lastIndexOf('}');
  if (o1 >= 0 && o2 > o1) attempts.push(s.slice(o1, o2 + 1));
  const a1 = s.indexOf('[');
  const a2 = s.lastIndexOf(']');
  if (a1 >= 0 && a2 > a1) attempts.push(s.slice(a1, a2 + 1));
  for (const t of attempts) {
    try {
      return JSON.parse(t);
    } catch {
      try {
        return JSON.parse(t.replace(/,\s*([}\]])/g, '$1'));
      } catch {
        /* next */
      }
    }
  }
  return null;
}

// Pull the "say" value out of broken JSON text.
export function extractSayField(text) {
  const m = String(text || '').match(/"say"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return m[1];
  }
}

// Does this text read like something a person would say (not code, not JSON)?
export function looksLikeSpeech(text) {
  const s = String(text || '').trim();
  if (s.length < 2 || s.length > 900) return false;
  if (/^[[{]/.test(s) || /"\w+"\s*:/.test(s) || /```/.test(s)) return false;
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  if (letters / s.length < 0.55) return false;
  if ((s.match(/\n/g) || []).length > 6) return false;
  return true;
}

// Make a spoken line presentable: no speaker label, quotes, stage directions or markdown.
export function cleanSpeech(text, max = 600) {
  let s = String(text ?? '')
    .replace(/\r/g, '')
    .replace(/^\s*(?:lyra|you|me)\s*:\s*/i, '')
    .replace(/\*[^*\n]{1,60}\*/g, ' ')
    .replace(/[_`#>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^".*"$/.test(s) || /^“.*”$/.test(s)) s = s.slice(1, -1).trim();
  if (s.length > max) {
    const cut = s.slice(0, max);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    s = end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
  }
  return s;
}

const EMOTION_SYNONYMS = {
  happy: 'joy', happiness: 'joy', glad: 'joy', delight: 'joy', amused: 'joy', amusement: 'joy', excited: 'joy', excitement: 'joy', cheerful: 'joy',
  sad: 'sadness', sorrow: 'sadness', grief: 'sadness', melancholy: 'sadness', hurt: 'sadness', lonely: 'sadness',
  scared: 'fear', afraid: 'fear', worry: 'fear', worried: 'fear', anxious: 'fear', anxiety: 'fear', nervous: 'fear',
  angry: 'anger', mad: 'anger', annoyed: 'anger', annoyance: 'anger', irritation: 'anger', frustration: 'anger', frustrated: 'anger',
  trusting: 'trust', gratitude: 'trust', grateful: 'trust', relief: 'trust', relieved: 'trust',
  surprised: 'surprise', shock: 'surprise', amazed: 'surprise',
  love: 'affection', fond: 'affection', fondness: 'affection', tender: 'affection', tenderness: 'affection', warmth: 'affection',
  curious: 'curiosity', interest: 'curiosity', intrigued: 'curiosity', wonder: 'curiosity',
  proud: 'pride', confident: 'pride', confidence: 'pride', determination: 'pride', determined: 'pride',
  embarrassed: 'embarrassment', shy: 'embarrassment', flustered: 'embarrassment', bashful: 'embarrassment',
  calm: 'calm', neutral: 'calm', content: 'calm', peaceful: 'calm', relaxed: 'calm', focused: 'calm',
};

export function coerceEmotion(e) {
  if (e == null) return null;
  let name = null;
  let intensity = 0.4;
  if (typeof e === 'string') name = e;
  else if (typeof e === 'object') {
    name = e.name ?? e.emotion ?? e.type ?? null;
    if (!name) {
      // { joy: 0.6 } form
      const k = Object.keys(e).find((x) => EMOTION_NAMES.includes(x.toLowerCase()) || EMOTION_SYNONYMS[x.toLowerCase()]);
      if (k) {
        name = k;
        intensity = num(e[k]) ?? 0.4;
      }
    } else intensity = num(e.intensity ?? e.strength ?? e.amount) ?? 0.4;
  }
  if (!name) return null;
  const n = String(name).toLowerCase().trim();
  const canon = EMOTION_NAMES.includes(n) ? n : EMOTION_SYNONYMS[n] || null;
  if (!canon) return null;
  if (intensity > 1 && intensity <= 10) intensity /= 10;
  else if (intensity > 10) intensity /= 100;
  return { name: canon, intensity: clamp(intensity, 0, 1) };
}

export function normalizeActionName(n) {
  return String(n || '')
    .trim()
    .toLowerCase()
    .replace(/\(.*\)$/, '')
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function coerceAction(a) {
  if (!a) return null;
  if (typeof a === 'string') return { name: normalizeActionName(a), args: { target: null, value: null, amount: null } };
  if (typeof a !== 'object') return null;
  const name = normalizeActionName(a.name ?? a.action ?? a.type ?? '');
  if (!name) return null;
  const src = a.args && typeof a.args === 'object' ? { ...a, ...a.args } : a;
  const scalar = (v) => (v == null ? null : typeof v === 'object' ? null : str(v, 200));
  let amount = num(src.amount);
  if (amount != null) amount = clamp(amount, -10000, 10000);
  return { name, args: { target: scalar(src.target), value: scalar(src.value), amount } };
}

export function coerceActions(raw, actionNames = null, max = MAX_ACTIONS) {
  let list = raw;
  if (list && !Array.isArray(list) && typeof list === 'object') list = list.name || list.action ? [list] : Object.entries(list).map(([k, v]) => ({ name: k, ...(v && typeof v === 'object' ? v : { value: v }) }));
  if (!Array.isArray(list)) list = list ? [list] : [];
  const known = actionNames ? new Set(actionNames) : null;
  const actions = [];
  const rejected = [];
  for (const a of list) {
    const c = coerceAction(a);
    if (!c) continue;
    if (known && !known.has(c.name)) {
      rejected.push(c.name);
      continue;
    }
    if (actions.length >= max) {
      rejected.push(c.name);
      continue;
    }
    actions.push(c);
  }
  return { actions, rejected };
}

export function coerceMemories(raw, max = 3) {
  let list = raw;
  if (!Array.isArray(list)) list = list ? [list] : [];
  const out = [];
  for (const m of list) {
    if (out.length >= max) break;
    if (typeof m === 'string') {
      const text = str(m, 300);
      if (text) out.push({ text, importance: 4, about: [] });
      continue;
    }
    if (!m || typeof m !== 'object') continue;
    const text = str(m.text ?? m.memory ?? m.content, 300);
    if (!text) continue;
    let imp = num(m.importance);
    imp = imp == null ? 4 : Math.round(clamp(imp > 10 && imp <= 100 ? imp / 10 : imp, 1, 10));
    let about = m.about ?? m.people ?? [];
    if (!Array.isArray(about)) about = [about];
    about = about.map((x) => str(x, 60)).filter(Boolean).slice(0, 4);
    out.push({ text, importance: imp, about });
  }
  return out;
}

function delta(v) {
  const n = num(v);
  return n == null ? 0 : clamp(n, -5, 5);
}

export function coerceRelationships(raw, max = 4) {
  let list = raw;
  if (list && !Array.isArray(list) && typeof list === 'object') {
    list = list.person || list.id || list.name ? [list] : Object.entries(list).map(([k, v]) => ({ person: k, ...(v && typeof v === 'object' ? v : {}) }));
  }
  if (!Array.isArray(list)) list = [];
  const out = [];
  for (const r of list) {
    if (out.length >= max) break;
    if (!r || typeof r !== 'object') continue;
    const person = str(r.person ?? r.id ?? r.who ?? r.name, 60);
    if (!person) continue;
    let tag = str(r.tag, 20);
    if (tag) {
      tag = tag.toLowerCase();
      const bareTag = tag.replace(/^-/, '');
      if (!REL_TAGS.includes(bareTag)) tag = null;
    }
    out.push({
      person,
      affinity: delta(r.affinity),
      trust: delta(r.trust),
      respect: delta(r.respect),
      note: str(r.note, 200),
      tag,
      opinion: str(r.opinion, 200),
    });
  }
  return out;
}

// Coerce a chat reply. actionNames: the registry's names (unknown ones are dropped).
export function coerceResponse(raw, { actionNames = null, maxActions = MAX_ACTIONS } = {}) {
  let data = raw;
  if (typeof raw === 'string') {
    data = extractJson(raw);
    if (data == null || typeof data !== 'object') {
      const said = extractSayField(raw);
      const say = said != null ? cleanSpeech(said) : looksLikeSpeech(raw) ? cleanSpeech(raw) : '';
      return { say, thought: null, emotion: null, actions: [], memories: [], relationships: [], goal: null, rejected: [], salvaged: true };
    }
  }
  if (Array.isArray(data)) data = data.find((x) => x && typeof x === 'object' && !Array.isArray(x)) || {};
  if (!data || typeof data !== 'object') data = {};
  const sayRaw = data.say ?? data.speech ?? data.reply ?? data.response ?? data.dialogue ?? data.message ?? data.text ?? '';
  const say = typeof sayRaw === 'string' ? cleanSpeech(sayRaw) : Array.isArray(sayRaw) ? cleanSpeech(sayRaw.filter((x) => typeof x === 'string').join(' ')) : '';
  const thoughtRaw = data.thought ?? data.thinking ?? data.inner ?? null;
  const thought = typeof thoughtRaw === 'string' ? cleanSpeech(thoughtRaw, 300) || null : null;
  const { actions, rejected } = coerceActions(data.actions ?? data.action ?? [], actionNames, maxActions);
  const goalRaw = data.goal && typeof data.goal === 'object' ? data.goal.text : data.goal;
  return {
    say,
    thought,
    emotion: coerceEmotion(data.emotion ?? data.mood ?? null),
    actions,
    memories: coerceMemories(data.memories ?? data.memory ?? []),
    relationships: coerceRelationships(data.relationships ?? data.relationship ?? []),
    goal: str(goalRaw, 140),
    rejected,
  };
}

// Remove actions that duplicate ones the offline pre-pass already ran.
export function dedupeActions(actions, executed = []) {
  const key = (a) => `${a.name}|${a.args?.target ?? ''}|${a.args?.value ?? ''}|${a.args?.amount ?? ''}`;
  const ran = new Set(executed.map((e) => key({ name: e.name, args: e.args })));
  const ranNames = new Set(executed.filter((e) => e.ok).map((e) => e.name));
  // Standing-order actions with the same name are redundant even with slightly different args.
  const ORDERS = new Set(['follow', 'stay', 'set_combat_mode', 'come_here', 'retreat', 'free_will', 'start_job', 'stop_job']);
  return actions.filter((a) => !ran.has(key(a)) && !(ORDERS.has(a.name) && ranNames.has(a.name)));
}

export function coerceReflection(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    data = extractJson(raw);
    if (!data || typeof data !== 'object') return looksLikeSpeech(raw) ? { diary: cleanSpeech(raw, 1600), opinions: [], goal: null, summary: null } : null;
  }
  if (!data || typeof data !== 'object') return null;
  const diaryRaw = data.diary ?? data.entry ?? data.text ?? null;
  const diary = typeof diaryRaw === 'string' ? String(diaryRaw).replace(/\r/g, '').trim().slice(0, 1600) : null;
  if (!diary) return null;
  let ops = data.opinions ?? [];
  if (ops && !Array.isArray(ops) && typeof ops === 'object') ops = Object.entries(ops).map(([person, opinion]) => ({ person, opinion }));
  const opinions = (Array.isArray(ops) ? ops : [])
    .map((o) => ({ person: str(o?.person ?? o?.id ?? o?.name, 60), opinion: str(o?.opinion ?? o?.text, 200) }))
    .filter((o) => o.person && o.opinion)
    .slice(0, 3);
  const goalRaw = data.goal && typeof data.goal === 'object' ? data.goal.text : data.goal;
  return { diary, opinions, goal: str(goalRaw, 140), summary: str(data.summary, 300) };
}

export function coerceConversation(raw, { npcName = '', companionName = 'lyra' } = {}) {
  let data = raw;
  if (typeof raw === 'string') data = extractJson(raw);
  if (Array.isArray(data)) data = { lines: data };
  if (!data || typeof data !== 'object') return null;
  const npcFirst = String(npcName || '').toLowerCase().split(/\s+/)[0];
  const me = String(companionName || 'lyra').toLowerCase();
  const lines = [];
  for (const l of Array.isArray(data.lines) ? data.lines : []) {
    if (lines.length >= 8) break;
    if (!l) continue;
    const text = cleanSpeech(typeof l === 'string' ? l : l.text ?? l.line ?? '', 240);
    if (!text) continue;
    const sp = String((typeof l === 'object' && (l.speaker ?? l.who ?? l.name)) || '').toLowerCase();
    const speaker = sp === 'lyra' || sp === me || sp === 'you' ? 'lyra' : sp === 'npc' || (npcFirst && sp.startsWith(npcFirst)) ? 'npc' : lines.length % 2 === 0 ? 'lyra' : 'npc';
    lines.push({ speaker, text });
  }
  if (!lines.length) return null;
  const learnedRaw = Array.isArray(data.learned) ? data.learned : data.learned ? [data.learned] : [];
  const learned = learnedRaw.map((x) => str(typeof x === 'object' ? x?.text : x, 200)).filter(Boolean).slice(0, 3);
  const aff = num(data.affinity);
  return { lines, learned, affinity: aff == null ? 0 : clamp(aff, -5, 5) };
}
