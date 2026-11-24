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
  'Reply with JSON only, matching the schema.',
].join('\n');

export const SAY_SCHEMA = {
  type: 'object',
  properties: {
    say: { type: 'string', description: 'what they say aloud, 1-3 sentences' },
    mood: { type: 'string', description: 'one word: warm, happy, neutral, wary, angry, sad, worried, amused, sleepy' },
    opinion_delta: { type: 'number', description: 'how this exchange changes their opinion of the player, -10..5' },
    learned: { type: 'array', items: { type: 'string' }, description: 'ids of facts from the brief they actually told the player' },
    rumor_told: { type: 'string', description: 'id of a piece of news from the brief they mentioned, if any' },
    rumor: { type: 'string', description: 'only if notable: a short clause they will repeat about what the player said, e.g. "the stranger asked after Maren"' },
  },
  required: ['say', 'opinion_delta'],
  additionalProperties: false,
};

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

function personLine(id, profile) {
  const name = FULL_NAMES[id] || profile?.name || id;
  const role = ROLES[id] || profile?.role || '';
  const bits = [`${name}${profile?.age ? `, ${profile.age}` : ''}${role ? `, ${role}` : ''}.`];
  if (profile?.personality) bits.push(clip(profile.personality, 260));
  if (profile?.voice) bits.push(`Voice: ${clip(profile.voice, 200)}`);
  return bits.join(' ');
}

// The brief for one villager answering the player. `b` is gathered by the village.
// b: { id, profile, opinion, opinionLabel, familiarity, playerName, facts: [{id, text}],
//      rumors: [{id, text}], history: [{you, they}], place, time, weather, week: [str],
//      lyra: str, standing: str, text }
export function buildSayTask(b) {
  const L = [];
  L.push(`You are ${personLine(b.id, b.profile)}`);
  const samples = voiceSamples(b.id);
  if (samples.length) L.push(`How you talk (your own lines): ${samples.map((s) => `"${s}"`).join(' ')}`);
  L.push(`Where and when: ${b.place || 'Hearthvale'}, ${b.time || ''}${b.weather ? `, ${b.weather}` : ''}.`);
  L.push(`The player is ${b.playerName ? `${b.playerName}, ` : ''}the stranger. You call them "${b.stranger || 'the stranger'}" behind their back. Your opinion of them: ${b.opinionLabel} (${Math.round(b.opinion)}/100). You know them ${b.familiarity < 15 ? 'barely' : b.familiarity < 45 ? 'a little' : 'well'}.`);
  if (b.standing) L.push(`Right now: ${b.standing}`);
  if (b.lyra) L.push(`Lyra: ${b.lyra}`);
  if (b.facts?.length) L.push(`Things you would share at this familiarity (use only if it fits; list ids you told in "learned"):\n${b.facts.map((f) => `- [${f.id}] ${clip(f.text, 200)}`).join('\n')}`);
  if (b.rumors?.length) L.push(`News you have heard (id: what you heard):\n${b.rumors.map((r) => `- [${r.id}] ${clip(r.text, 160)}`).join('\n')}`);
  if (b.week?.length) L.push(`What the village is talking about this week: ${b.week.join(' ')}`);
  if (b.history?.length) L.push(`Your last exchanges with them:\n${b.history.map((h) => `- They said: "${clip(h.you, 120)}" You said: "${clip(h.they, 160)}"`).join('\n')}`);
  L.push(`The player says to you: "${clip(b.text, 300)}"`);
  L.push('Answer as yourself, in one to three sentences.');
  return L.join('\n\n');
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

export function coerceSay(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const say = cleanLine(raw.say, 320);
  if (!say) return null;
  const d = Number(raw.opinion_delta);
  return {
    say,
    mood: typeof raw.mood === 'string' ? raw.mood.toLowerCase().replace(/[^a-z]/g, '').slice(0, 16) || null : null,
    opinionDelta: Number.isFinite(d) ? Math.max(-10, Math.min(5, d)) : 0,
    learned: Array.isArray(raw.learned) ? raw.learned.filter((x) => typeof x === 'string').slice(0, 3) : [],
    rumorTold: typeof raw.rumor_told === 'string' ? raw.rumor_told : null,
    rumor: typeof raw.rumor === 'string' ? cleanLine(raw.rumor, 140) : null,
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
