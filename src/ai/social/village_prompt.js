// What Claude is told when it speaks for Hearthvale's villagers (DESIGN §19.3). Claude
// is only ever asked here on a player's action: a line sent to a villager, "Listen in",
// or going to sleep; and, with the player's own API key and villageAi 'always', for an
// ambient exchange at most once every 45 s. Everything Claude writes is checked against
// the hidden truths (hidden.js) and falls back to the local village on any doubt.

import { VOICES } from './voices.js';
import { FULL_NAMES, ROLES } from './bonds_data.js';
import { speakable } from './hidden.js';

const clip = (s, n) => {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export const VILLAGER_RULES = [
  'You voice the people of Hearthvale, a small warded village in Halcyre, a cosy pixel-art RPG. The player is "the stranger": someone found asleep in a melted circle of snow on the Hollowcrown, carried down, who slept eighty-one days and now lives in the Wayhouse. Lyra Ambrel, the lumencrafter, is a villager in her own right: Hobb and Wenna’s daughter.',
  'Stay exactly in the character you are given: their age, their voice, their verbal habits and the sample lines. Short, spoken, natural: one to three sentences, no narration, no stage directions, no quotation marks around the whole line, no emoji.',
  'Speak only from what the brief says this person knows. Never invent secrets, family history, deaths, romances or plot. If asked about something they do not know, they say so in their own way. Never claim to know what happened to Maren, where the stranger came from, who the bandit chief is, or anything about the ward’s numbers.',
  'They react to the player as their opinion says: warm when they like them, short and guarded when they do not, cold or angry when the player has hurt someone they love. Kindness, thanks and apologies soften them slowly; insults and threats harden them.',
  'They always hear what the player says, and remember it. Refusing is still an answer: one cold line, an insult, begging, or silence. Someone cold, wronged, angry or afraid may answer with a word, a cold line, or not at all: to say nothing, set "silent" to true, "say" to "" and an "action" (the game shows that they heard, and what they did). Never silent with someone they like.',
  'What they do may go with the words or stand in for them: "action" is one of turn_away, walk_off, flee, glare, cry, shove_past, or null. "act" is only for walking with the player: join (they agreed to come along, and only when the brief says they decided to), leave, follow, wait, fight, hold_back, or null.',
  'Be a living person, not an answer machine: react to what was said with feeling, keep your own mood, now and then ask the player something back, and bring up what you remember of them when it fits. Use the player’s name only if they told it to you. Asleep, you mumble or say nothing.',
  'Reply with JSON only, in the format the task gives.',
].join('\n');

// What the player said that a villager keeps (the schema's own words, for the API path).
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });

// Structured outputs (the API key path): every property listed, optional ones nullable.
export const SAY_SCHEMA = {
  type: 'object',
  properties: {
    say: { type: 'string', description: 'what they say aloud, 1-3 sentences; "" only when silent' },
    silent: nullable({ type: 'boolean', description: 'true when, having heard them, they choose to say nothing at all' }),
    action: nullable({ type: 'string', enum: ['turn_away', 'walk_off', 'flee', 'glare', 'cry', 'shove_past'], description: 'what they do, with the words or instead of them' }),
    act: nullable({ type: 'string', enum: ['join', 'leave', 'follow', 'wait', 'fight', 'hold_back'], description: 'only about walking with the player; join only when the brief says they decided to come' }),
    mood: nullable({ type: 'string', description: 'one word: warm, happy, neutral, wary, angry, sad, worried, amused, sleepy' }),
    opinion_delta: { type: 'number', description: 'how this exchange changes their opinion of the player, -10..5' },
    learned: { type: 'array', items: { type: 'string' }, description: 'ids of facts from the brief they actually told the player' },
    rumor_told: nullable({ type: 'string', description: 'id of a piece of news from the brief they mentioned, if any' }),
    rumor: nullable({ type: 'string', description: 'only if notable: a short clause they will repeat about what the player said, e.g. "the stranger asked after Maren"' }),
    name: nullable({ type: 'string', description: 'the name the player just told them, if they did' }),
    memory: nullable({ type: 'string', description: 'if worth keeping: a short clause to the player starting with "you", e.g. "you told me you have never seen the sea"' }),
    asked: nullable({ type: 'string', enum: ['name', 'other'], description: 'if their reply asks the player something: "name" for the player’s name, else "other"' }),
    commit: nullable({
      type: 'object',
      description: 'only when the brief says they are asking you to do something: whether you agree (the game then does it)',
      properties: { kind: { type: 'string', enum: ['tell', 'give', 'teach'] }, agree: { type: 'boolean' } },
      required: ['kind', 'agree'],
      additionalProperties: false,
    }),
  },
  required: ['say', 'silent', 'action', 'act', 'mood', 'opinion_delta', 'learned', 'rumor_told', 'rumor', 'name', 'memory', 'asked', 'commit'],
  additionalProperties: false,
};

// The same, said in the prompt (claude.ai's sample takes no schema).
const SAY_FORMAT = 'Reply with one JSON object and nothing else: {"say": string ("" only when silent), "silent": true only if you choose to say nothing at all, else null, "action": "turn_away"|"walk_off"|"flee"|"glare"|"cry"|"shove_past" or null, "act": "join"|"leave"|"follow"|"wait"|"fight"|"hold_back" or null, "mood": one word, "opinion_delta": number from -10 to 5, "learned": [fact ids you told], "rumor_told": news id or null, "rumor": a short clause you will repeat about what they said, or null, "name": their name if they just told it, else null, "memory": a short clause starting "you" worth remembering about them, else null, "asked": "name" or "other" if you asked them something, else null, "commit": null, or when they ask you to do something {"kind": "tell"|"give"|"teach", "agree": true|false}}';

export const LINES_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: { speaker: { type: 'string' }, text: { type: 'string' } },
        required: ['speaker', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
};

export const NIGHT_SCHEMA = {
  type: 'object',
  properties: { lines: { type: 'array', items: { type: 'string' } } },
  required: ['lines'],
  additionalProperties: false,
};

// A few of their own lines, so Claude hears the voice.
export function voiceSamples(id, max = 7) {
  const v = VOICES[id];
  if (!v) return [];
  const out = [];
  const add = (l) => {
    if (typeof l === 'string' && l && !/\{(rumor|who|you)\}/.test(l) && out.length < max) out.push(l.replace(/\{n\}/g, '…').replace(/\{stranger\}|\{P\}/g, v.stranger || 'the stranger').replace(/\{lyra\}/g, 'Lyra'));
  };
  add(v.hello?.[0]);
  add(v.howAreYou?.[0]);
  add(v.about?.work?.[0]);
  add(v.reply?.insult?.[0]);
  add(v.tease?.[0]);
  add(v.about?.own?.[0]);
  add(v.warm?.[0]);
  add(v.bye?.[0]);
  return out;
}

// A profile line may name what someone keeps to themselves ("in secret, into poems"):
// Claude is never told it, so it can never let it slip.
const PRIVATE = /\b(in secret|secretly|poems?|poetry|strongbox|ferry-?house|flute|brightborn)\b/i;
export function publicText(text) {
  let t = String(text || '').replace(/,?\s*(?:and,?\s*)?(?:in secret|secretly),?\s+[^.;!?]*/gi, '');
  t = t
    .split(/(?<=[.!?])\s+/)
    .filter((x) => x && !PRIVATE.test(x) && speakable(x))
    .join(' ');
  return t.replace(/\s+/g, ' ').trim();
}

function personLine(id, profile) {
  const name = FULL_NAMES[id] || profile?.name || id;
  const role = ROLES[id] || profile?.role || '';
  const bits = [`${name}${profile?.age ? `, ${profile.age}` : ''}${role ? `, ${role}` : ''}.`];
  const persona = publicText(profile?.personality);
  if (persona) bits.push(clip(persona, 260));
  const voice = publicText(profile?.voice);
  if (voice) bits.push(`Voice: ${clip(voice, 200)}`);
  return bits.join(' ');
}

// The brief for one villager answering the player. `b` is gathered by the village.
// b: { id, profile, opinion, opinionLabel, familiarity, playerName, knownName, stranger,
//      facts: [{id, text}], rumors: [{id, text}], memories: [{text, day}],
//      history: [{you, they, day}], asked, place, time, weather, today, week: [str],
//      lyra: str, standing: str, text }
// Compact on purpose (a few KB): every list is short and every line clipped, and nothing
// in it may state a hidden truth (tests/chat_target.test.mjs checks every villager).
export function buildSayTask(b) {
  const L = [];
  L.push(`You are ${personLine(b.id, b.profile)}`);
  const samples = voiceSamples(b.id, 6);
  if (samples.length) L.push(`How you talk (your own lines): ${samples.map((s) => `"${s}"`).join(' ')}`);
  L.push(`Where and when: ${b.place || 'Hearthvale'}, ${b.time || ''}${b.weather ? `, ${b.weather}` : ''}${b.today ? `, day ${b.today}` : ''}.`);
  const fam = b.familiarity < 15 ? 'barely' : b.familiarity < 45 ? 'a little' : 'well';
  L.push(`The player is the stranger found on the Hollowcrown; you call them "${b.stranger || 'the stranger'}" behind their back. Your opinion of them: ${b.opinionLabel} (${Math.round(b.opinion)}/100). You know them ${fam}.`);
  L.push(b.knownName ? `Their name is ${clip(b.knownName, 20)}: they told you, so you may use it.` : 'You do not know their name: they have not told you. Do not guess it; you may ask.');
  if (b.standing) L.push(`Right now: ${clip(b.standing, 300)}`);
  if (b.lyra) L.push(`Lyra: ${b.lyra}`);
  const mem = (b.memories || []).map((m) => clip(m.text, 110)).filter((t) => t && speakable(t));
  if (mem.length) L.push(`What you remember of them: ${mem.slice(-5).join('; ')}.`);
  if (b.facts?.length) L.push(`Things you would share at this familiarity (only if it fits; list the ids you told in "learned"):\n${b.facts.slice(0, 5).map((f) => `- [${f.id}] ${clip(f.text, 180)}`).join('\n')}`);
  if (b.rumors?.length) L.push(`News you have heard (id: what you heard):\n${b.rumors.slice(0, 4).map((r) => `- [${r.id}] ${clip(r.text, 150)}`).join('\n')}`);
  if (b.week?.length) L.push(`What the village is talking about this week: ${b.week.slice(0, 2).join(' ')}`);
  if (b.history?.length) {
    const rows = b.history.slice(-5).map((h) => `- ${h.day && b.today && h.day < b.today ? `(day ${h.day}) ` : ''}They: "${clip(h.you, 110)}" You: ${h.they ? `"${clip(h.they, 150)}"` : '(you heard it, and said nothing)'}`);
    L.push(`The conversation so far, oldest first:\n${rows.join('\n')}`);
  }
  // Everything they said today, to anyone (DESIGN §23.1): what popped over their head and
  // what they say in the chat agree, and nothing is said twice.
  if (b.saidToday?.length) L.push(`What you have already said today, to anyone, aloud or over your head (oldest first). Keep to it, build on it, and never say the same thing or ask the same question again:\n${b.saidToday.join('\n')}`);
  if (b.promises?.length) L.push(`Your promises to them (you keep your word, or say plainly why not):\n${b.promises.map((x) => `- ${clip(x, 160)}`).join('\n')}`);
  if (b.owed) L.push(`You broke a promise to them (${clip(b.owed, 120)}): own it first, plainly.`);
  if (b.request) L.push(b.request);
  if (b.acts) L.push(clip(b.acts, 260));
  if (b.asked) L.push(`You had just asked them ${b.asked === 'their name' ? 'their name' : 'a question'}; this may be their answer.`);
  L.push(`They say to you now: "${clip(b.text, 300)}"`);
  L.push('Answer as yourself, in one to three short spoken sentences.');
  L.push(SAY_FORMAT);
  return L.join('\n');
}

// The brief for the next exchange between two people the player is listening to.
// b: { a: {id, profile}, b: {id, profile}, bond: str, place, time, weather, news: [str],
//      topic, playerName, lines: [{speaker, text}] (just said), min, max }
export function buildListenTask(b) {
  const L = [];
  L.push(`Write the next ${b.min || 4}-${b.max || 8} lines of a conversation between two people of Hearthvale, overheard by the player. Speakers: "${b.a.id}" and "${b.b.id}". Alternate naturally; each line one or two sentences.`);
  for (const p of [b.a, b.b]) {
    L.push(`"${p.id}": ${personLine(p.id, p.profile)}`);
    const s = voiceSamples(p.id, 6);
    if (s.length) L.push(`  Their own lines: ${s.map((x) => `"${x}"`).join(' ')}`);
  }
  if (b.bond) L.push(`Between them: ${b.bond}`);
  L.push(`Where and when: ${b.place || 'Hearthvale'}, ${b.time || ''}${b.weather ? `, ${b.weather}` : ''}.`);
  if (b.topic) L.push(`They have been talking about: ${b.topic}.`);
  if (b.news?.length) L.push(`News they might bring up: ${b.news.join(' ')}`);
  if (b.lines?.length) L.push(`Just said:\n${b.lines.map((l) => `${l.speaker}: ${clip(l.text, 160)}`).join('\n')}`);
  L.push(`The player (${b.playerName || 'the stranger'}) is nearby; they do not address the player. Return {"lines":[{"speaker":"${b.a.id}","text":"..."}, ...]}.`);
  return L.join('\n');
}

export function buildNightTask(b) {
  return [
    `Rewrite these notes of a day in Hearthvale (day ${b.day}) as ${Math.min(6, Math.max(3, b.lines.length))} short, warm sentences for the player's morning, in a storyteller's voice, second person where it is about the player ("you").`,
    'Keep every fact; add none. No secrets, no new events.',
    `Notes:\n${b.lines.map((l) => `- ${l}`).join('\n')}`,
    'Return {"lines": ["...", "..."]}.',
  ].join('\n\n');
}

// --- checking what comes back ---

export function cleanLine(text, max = 280) {
  let t = String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^["“”']+|["“”']+$/g, '')
    .trim();
  if (!t || /\{\w+\}/.test(t) || /[<>]/.test(t)) return null;
  if (t.length > max) {
    const cut = t.slice(0, max);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    t = end > 40 ? cut.slice(0, end + 1) : `${cut.slice(0, max - 1)}…`;
  }
  return speakable(t) ? t : null;
}

const ACTIONS_OK = new Set(['turn_away', 'walk_off', 'flee', 'glare', 'cry', 'shove_past']);
const ACTS_OK = new Set(['join', 'leave', 'follow', 'wait', 'fight', 'hold_back']);

export function coerceSay(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const action = ACTIONS_OK.has(raw.action) ? raw.action : null;
  const act = ACTS_OK.has(raw.act) ? raw.act : null;
  // Silence is an answer too (DESIGN §23.3): heard, and nothing said. An empty say with an
  // action is a silence shown as that action; an empty say with neither is no answer.
  let silent = raw.silent === true;
  let say = silent ? '' : cleanLine(raw.say, 320);
  if (!say && !silent && action && !String(raw.say ?? '').trim()) {
    silent = true;
    say = '';
  }
  if (!say && !silent) return null;
  const d = Number(raw.opinion_delta);
  const name = typeof raw.name === 'string' ? raw.name.trim().replace(/[.!,]+$/, '') : '';
  let memory = typeof raw.memory === 'string' ? cleanLine(raw.memory, 110) : null;
  // A memory is kept as something said to the player: "you …".
  if (memory && !/^you\b/i.test(memory)) memory = null;
  return {
    say,
    silent,
    action,
    act,
    mood: typeof raw.mood === 'string' ? raw.mood.toLowerCase().replace(/[^a-z]/g, '').slice(0, 16) || null : null,
    opinionDelta: Number.isFinite(d) ? Math.max(-10, Math.min(5, d)) : 0,
    learned: Array.isArray(raw.learned) ? raw.learned.filter((x) => typeof x === 'string').slice(0, 3) : [],
    rumorTold: typeof raw.rumor_told === 'string' ? raw.rumor_told : null,
    rumor: typeof raw.rumor === 'string' ? cleanLine(raw.rumor, 140) : null,
    name: /^[A-Za-zÀ-ÿ'-]{2,20}$/.test(name) ? name.charAt(0).toUpperCase() + name.slice(1) : null,
    memory: memory ? memory.replace(/^You\b/, 'you').replace(/[.!?]+$/, '') : null,
    asked: raw.asked === 'name' || raw.asked === 'other' ? raw.asked : null,
    commit: raw.commit && typeof raw.commit === 'object' && ['tell', 'give', 'teach'].includes(raw.commit.kind) ? { kind: raw.commit.kind, agree: raw.commit.agree === true } : null,
  };
}

export function coerceLines(raw, ids, { min = 2, max = 8 } = {}) {
  const list = Array.isArray(raw?.lines) ? raw.lines : Array.isArray(raw) ? raw : [];
  const out = [];
  for (const l of list) {
    if (!l || typeof l !== 'object') continue;
    const sp = String(l.speaker || '').toLowerCase().trim();
    const id = ids.find((x) => x === sp || sp.startsWith(x));
    const text = cleanLine(l.text, 220);
    if (!id || !text) continue;
    out.push({ speaker: id, text });
    if (out.length >= max) break;
  }
  return out.length >= min ? out : null;
}

export function coerceNight(raw) {
  const list = Array.isArray(raw?.lines) ? raw.lines : Array.isArray(raw) ? raw : [];
  const out = [];
  for (const l of list) {
    const t = cleanLine(l, 240);
    if (t) out.push(t);
    if (out.length >= 6) break;
  }
  return out.length >= 2 ? out : null;
}
