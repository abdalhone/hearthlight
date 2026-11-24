#!/usr/bin/env node
// Collects every FIXED spoken line in the game, with who says it, for the voice render
// (DESIGN.md §21). Lines with template slots ({you}, {name}, ...) are skipped: they are
// different every time, so Lyra's live voice (or silence) covers them.
//
//   node scripts/voice/collect.mjs                      -> scripts/voice/lines.json
//   node scripts/voice/collect.mjs --sample             -> scripts/voice/lines.sample.json
//   node scripts/voice/collect.mjs --out FILE [--quiet]
//
// Sources (each optional, so the script works on any branch):
//   src/story/scripts.js          cutscene scripts: export voiceLines() or plain step objects
//   src/entities/npc_data.js      villager profiles (+ npc_data_more.js), FACT_SAY
//   src/entities/monsters.js      bandit barks
//   src/ai/brain/lines.js         Lyra's line banks (barks, chat, will), RULES expanded
//   src/ai/mind/autonomy_lines.js Lyra's will: answers, plans, asks
//   src/ai/behavior/lines.js, phrases.js   her body-level lines (string literals)
//
// Each line gets key = lineKey(speaker, text) from src/audio/voice_key.js, the same
// function the game uses to find a clip.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lineKey, isFixedLine, normalizeSpeaker, normalizeLine } from '../../src/audio/voice_key.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const SAMPLE = flag('--sample');
const OUT = path.resolve(ROOT, opt('--out', SAMPLE ? 'scripts/voice/lines.sample.json' : 'scripts/voice/lines.json'));
const QUIET = flag('--quiet');

const cast = JSON.parse(readFileSync(path.join(HERE, 'cast.json'), 'utf8'));

async function optional(rel) {
  const file = path.join(ROOT, rel);
  if (!existsSync(file)) return null;
  try {
    return await import(pathToFileURL(file).href);
  } catch (err) {
    console.warn(`[collect] could not import ${rel}: ${err.message}`);
    return null;
  }
}

// ----------------------------------------------------------------------------- the list

const lines = new Map(); // key -> { key, speaker, text, src }
const skipped = { templated: 0, unknownSpeaker: new Map() };

function add(speaker, text, src) {
  const sp = normalizeSpeaker(speaker);
  if (!sp || typeof text !== 'string') return;
  const t = text.replace(/\s+/g, ' ').trim();
  if (!isFixedLine(t)) {
    if (t) skipped.templated++;
    return;
  }
  if (!cast.voices[sp]) {
    skipped.unknownSpeaker.set(sp, (skipped.unknownSpeaker.get(sp) || 0) + 1);
    return;
  }
  const key = lineKey(sp, t);
  if (!key || lines.has(key)) return;
  lines.set(key, { key, speaker: sp, text: t, src });
}

// ----------------------------------------------------------------------------- templates

// Expand a speech_gen template that has only {#rule} references and [a|b] choices into
// every fixed line it can produce (none if it has real slots or too many outcomes).
const MAX_VARIANTS = 8;
function expandTemplate(t, rules, depth = 0) {
  let s = String(t);
  if (/\{(?!#)\w+\}/.test(s)) return [];
  const rule = s.match(/\{#(\w+)\}/);
  if (rule) {
    if (depth > 3) return [];
    const opts = (rules?.[rule[1]] || []).map((r) => (typeof r === 'string' ? r : r?.t)).filter((x) => typeof x === 'string');
    const out = [];
    for (const o of opts) {
      for (const v of expandTemplate(s.replace(rule[0], o), rules, depth + 1)) {
        out.push(v);
        if (out.length > MAX_VARIANTS) return [];
      }
    }
    return out;
  }
  // innermost [a|b] first
  const close = s.indexOf(']');
  const open = close >= 0 ? s.lastIndexOf('[', close) : -1;
  if (open >= 0) {
    const parts = s.slice(open + 1, close).split('|');
    const out = [];
    for (const p of parts) {
      for (const v of expandTemplate(s.slice(0, open) + p + s.slice(close + 1), rules, depth)) {
        out.push(v);
        if (out.length > MAX_VARIANTS) return [];
      }
    }
    return out;
  }
  return [s];
}

const entryText = (e) => (typeof e === 'string' ? e : e && typeof e.t === 'string' ? e.t : null);

// String literals of a source file that read like spoken lines (for line banks that live
// inside functions). Template literals with ${...} vary at run time and are skipped.
export function stringLiterals(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  let prev = ''; // last significant character, to tell a regex literal from division
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      i = e < 0 ? n : e;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) {
      // a regex literal: skip it, minding escapes and character classes
      let j = i + 1;
      let cls = false;
      while (j < n && src[j] !== '\n') {
        const d = src[j];
        if (d === '\\') j += 2;
        else {
          if (d === '[') cls = true;
          else if (d === ']') cls = false;
          else if (d === '/' && !cls) break;
          j++;
        }
      }
      i = j + 1;
      prev = '/';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      let s = '';
      let dyn = false;
      while (j < n) {
        const d = src[j];
        if (d === '\\') {
          s += src[j + 1] === 'n' ? ' ' : src[j + 1];
          j += 2;
          continue;
        }
        if (c === '`' && d === '$' && src[j + 1] === '{') {
          dyn = true;
          let depth = 1;
          j += 2;
          while (j < n && depth) {
            if (src[j] === '{') depth++;
            else if (src[j] === '}') depth--;
            j++;
          }
          continue;
        }
        if (d === c || (d === '\n' && c !== '`')) break;
        s += d;
        j++;
      }
      if (!dyn) out.push(s);
      i = j + 1;
      prev = c;
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

function spokenLiterals(rel) {
  const file = path.join(ROOT, rel);
  if (!existsSync(file)) return [];
  return stringLiterals(readFileSync(file, 'utf8')).filter(looksSpoken);
}

// A spoken line starts like a sentence and ends like one. Notes ("the old road"), ids
// ("ember_kettle") and labels do not.
function looksSpoken(s) {
  const t = String(s).trim();
  if (t.length < 2 || /[_\\|<>{}\[\]]|\(\?|^https?:/.test(t)) return false;
  if (!/^[\p{Lu}"'‘“….(\-—]/u.test(t)) return false;
  if (!/[.!?…"'’”\-—)]$/u.test(t)) return false;
  return /\p{L}{2,}/u.test(t);
}

// ----------------------------------------------------------------------------- villagers

// Profile fields that are notes, data or looks, never speech.
const NOT_SPOKEN = new Set([
  'id', 'name', 'fullName', 'role', 'faction', 'age', 'appearance', 'personality', 'traits', 'voice', 'home', 'work',
  'startOpinion', 'speed', 'schedule', 'likes', 'dislikes', 'shop', 'rooms', 'combat', 'lamplighter', 'hunter',
  'family', 'kin', 'facts', 'knows', 'spriteKey', 'look', 'bed', 'title', 'nickname', 'topics', 'gag', 'grievance',
  'week', 'notes', 'secret', 'wound', 'want', 'chatter',
]);

function walkSpoken(node, fn, keyPath = []) {
  if (typeof node === 'string') {
    if (looksSpoken(node)) fn(node, keyPath);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) walkSpoken(typeof v === 'object' && v && typeof v.t === 'string' ? v.t : v, fn, keyPath);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (NOT_SPOKEN.has(k)) continue;
      walkSpoken(v, fn, [...keyPath, k]);
    }
  }
}

function firstNameOf(profile, id) {
  const parts = String(profile?.name || '').replace(/"[^"]*"\s*/g, '').trim().split(/\s+/);
  if (!parts[0]) return id.charAt(0).toUpperCase() + id.slice(1);
  if ((parts[0] === 'Captain' || parts[0] === 'Sister') && parts[1]) return `${parts[0]} ${parts[1]}`;
  return parts[0];
}

async function collectVillagers() {
  const data = await optional('src/entities/npc_data.js');
  const more = await optional('src/entities/npc_data_more.js');
  const npcLines = await optional('src/entities/npc_lines.js');
  const byId = new Map();
  for (const p of [...(data?.NPC_PROFILES || []), ...(more?.MORE_PROFILES || [])]) if (p?.id && !byId.has(p.id)) byId.set(p.id, p);
  for (const [id, p] of byId) {
    walkSpoken(p, (text, kp) => add(id, text, `npc:${kp.join('.')}`));
    for (const f of p.facts || []) if (typeof f.say === 'string') add(id, f.say, 'npc:facts.say');
    const knows = p.knows || {};
    for (const [who, text] of Object.entries(knows)) {
      if (typeof text !== 'string') continue;
      // As the dialogue says them (npc_dialogue.answerTopic).
      if (who === 'lyra' || who === 'maren') add(id, text, 'npc:knows');
      else add(id, `${firstNameOf(byId.get(who), who)}? ${text}`, 'npc:knows');
    }
  }
  // Facts said in the villager's own words, keyed by fact id.
  const factOwner = new Map();
  for (const [id, p] of byId) for (const f of p.facts || []) factOwner.set(f.id, id);
  for (const [fid, text] of Object.entries(npcLines?.FACT_SAY || {})) {
    const owner = factOwner.get(fid) || byId.get(fid.split('_')[0])?.id;
    if (owner) add(owner, text, 'npc:FACT_SAY');
  }
  return byId;
}

async function collectCreatures() {
  const m = await optional('src/entities/monsters.js');
  const voiceOf = { bandit: 'bandit', bandit_archer: 'bandit', bandit_chief: 'varek' };
  for (const [sp, spec] of Object.entries(m?.SPECIES || {})) {
    if (!voiceOf[sp]) continue;
    for (const b of spec.barks || []) add(voiceOf[sp], b, `creature:${sp}`);
  }
  const ai = path.join(ROOT, 'src/entities/creature_ai.js');
  if (existsSync(ai)) {
    const src = readFileSync(ai, 'utf8');
    for (const mm of src.matchAll(/speak\([^,]+,[^,]+,\s*'([^']+)'/g)) add('varek', mm[1], 'creature:chief');
  }
}

// ----------------------------------------------------------------------------- Lyra

async function collectLyra() {
  const L = await optional('src/ai/brain/lines.js');
  const gen = await optional('src/ai/brain/speech_gen.js');
  const tidy = gen?.tidy || ((s) => s);
  for (const [situation, bank] of Object.entries(L?.LINES || {})) {
    for (const e of bank || []) {
      const t = entryText(e);
      if (!t) continue;
      for (const v of expandTemplate(t, L.RULES)) add('lyra', tidy(v), `lyra:${situation}`);
    }
  }
  const A = await optional('src/ai/mind/autonomy_lines.js');
  for (const [k, tones] of Object.entries(A?.LINES || {})) {
    for (const [tone, list] of Object.entries(tones || {})) {
      for (const e of list || []) {
        const t = entryText(e);
        if (t) add('lyra', t.replace(/\s+([.,!?;])/g, '$1').replace(/\s{2,}/g, ' ').trim(), `lyra:will.${k}.${tone}`);
      }
    }
  }
  for (const rel of ['src/ai/behavior/lines.js', 'src/ai/behavior/phrases.js']) {
    for (const s of spokenLiterals(rel)) add('lyra', s, `lyra:${path.basename(rel, '.js')}`);
  }
}

// ----------------------------------------------------------------------------- story

// Speaker names as scripts may write them: ids, names, first names, nicknames.
function speakerAliases(profiles) {
  const a = new Map([
    ['narrator', 'narrator'], ['narration', 'narrator'], ['lyra', 'lyra'], ['lyra_young', 'lyra_young'], ['younglyra', 'lyra_young'],
    ['maren', 'maren'], ['varek', 'varek'], ['bandit', 'bandit'],
  ]);
  for (const [id, p] of profiles) {
    a.set(id, id);
    const name = String(p.name || '');
    a.set(normalizeSpeaker(name), id);
    const clean = name.replace(/"[^"]*"\s*/g, '').replace(/^(Captain|Sister)\s+/, '');
    a.set(normalizeSpeaker(clean.split(/\s+/)[0]), id);
    for (const q of name.match(/"([^"]+)"/g) || []) a.set(normalizeSpeaker(q), id);
  }
  return a;
}

async function collectStory(profiles) {
  const S = await optional('src/story/scripts.js');
  if (!S) return 0;
  const aliases = speakerAliases(profiles);
  const resolve = (who) => aliases.get(normalizeSpeaker(who)) || normalizeSpeaker(who);
  let n = 0;
  const fromList = (list, src) => {
    for (const l of list || []) {
      if (l && typeof l.text === 'string') {
        add(resolve(l.speaker || 'narrator'), l.text, src);
        n++;
      }
    }
  };
  if (typeof S.voiceLines === 'function') fromList(S.voiceLines(), 'story:voiceLines');
  else if (Array.isArray(S.voiceLines)) fromList(S.voiceLines, 'story:voiceLines');
  else {
    // Generic walk: {speaker|who|by|actor, text|line|say} is dialogue; narration steps
    // ({type: 'narrate'|'narration'|'caption', text} or {narrate: text}) are the narrator's.
    const seen = new Set();
    const visit = (o, src) => {
      if (!o || typeof o !== 'object' || seen.has(o)) return;
      seen.add(o);
      if (Array.isArray(o)) {
        for (const v of o) visit(v, src);
        return;
      }
      const text = [o.text, o.line, o.say].find((v) => typeof v === 'string');
      const who = [o.speaker, o.who, o.by, o.actor].find((v) => typeof v === 'string');
      const type = String(o.type || o.kind || o.step || '').toLowerCase();
      if (text && who) {
        add(resolve(who), text, src);
        n++;
      } else if (text && /narrat|caption|voiceover/.test(type)) {
        add('narrator', text, src);
        n++;
      }
      for (const k of ['narrate', 'narration', 'caption']) {
        if (typeof o[k] === 'string') {
          add('narrator', o[k], src);
          n++;
        } else if (Array.isArray(o[k])) {
          for (const s of o[k]) if (typeof s === 'string') add('narrator', s, src), n++;
        }
      }
      for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') visit(v, `${src}.${k}`);
    };
    for (const [name, v] of Object.entries(S)) if (v && typeof v === 'object') visit(v, `story:${name}`);
  }
  return n;
}

// ----------------------------------------------------------------------------- sample

// A validation sample: the narrator (canon sentences from docs/LORE.md, standing in
// until the prologue script lands), Lyra, and five villagers.
const SAMPLE_NARRATION = [
  'Hobb named his daughter for the small bright star that stands over the Hollowcrown on Longwatch morning.',
  'Eleven nights at midwinter, light fell on the valley like snow.',
  'Every village in Halcyre keeps its lamps lit, and its people inside the light.',
  'Lyra and Hess climbed the Hollowcrown, and found a melted circle in the snow.',
  'There was a stranger in it, breathing.',
  'They carried you down the mountain. You slept for eighty-one days.',
  'And you woke in the Wayhouse, with Lyra there.',
  'Hearthvale lives by its Wellstone, and by the hands that keep it.',
];
// Five villagers, the first five of these this branch has.
const SAMPLE_VILLAGERS = ['hobb', 'wenna', 'bram', 'pip', 'aveline', 'elda', 'garrick', 'rowan', 'mira', 'tobias'];
const SAMPLE_PER_VILLAGER = 6;
const SAMPLE_LYRA = 24;

function pickSample(all) {
  const out = SAMPLE_NARRATION.map((t) => ({ key: lineKey('narrator', t), speaker: 'narrator', text: t, src: 'sample:LORE' }));
  const by = (sp) => all.filter((l) => l.speaker === sp);
  // Lyra: a spread across banks, short and long.
  const lyra = by('lyra');
  const step = Math.max(1, Math.floor(lyra.length / SAMPLE_LYRA));
  for (let i = 0; i < lyra.length && out.length < SAMPLE_NARRATION.length + SAMPLE_LYRA; i += step) out.push(lyra[i]);
  const present = SAMPLE_VILLAGERS.filter((sp) => by(sp).length).slice(0, 5);
  for (const sp of present) {
    const n = SAMPLE_PER_VILLAGER;
    const list = by(sp);
    const pref = list.filter((l) => /greetings|howAreYou|farewells|lines\.|gift/.test(l.src));
    const pool = pref.length >= n ? pref : list;
    const st = Math.max(1, Math.floor(pool.length / n));
    for (let i = 0, k = 0; i < pool.length && k < n; i += st, k++) out.push(pool[i]);
  }
  return out;
}

// ----------------------------------------------------------------------------- main

const profiles = await collectVillagers();
await collectCreatures();
await collectLyra();
const storyCount = await collectStory(profiles);

let list = [...lines.values()].sort((a, b) => (a.speaker === b.speaker ? 0 : a.speaker < b.speaker ? -1 : 1));
if (SAMPLE) list = pickSample(list);

const speakers = {};
for (const l of list) speakers[l.speaker] = (speakers[l.speaker] || 0) + 1;
const words = list.reduce((n, l) => n + normalizeLine(l.text).split(' ').length, 0);
const doc = {
  note: 'Generated by scripts/voice/collect.mjs. Fixed spoken lines and who says them; keys come from src/audio/voice_key.js.',
  count: list.length,
  words,
  speakers,
  lines: list,
};
writeFileSync(OUT, `${JSON.stringify(doc, null, 1)}\n`);

if (!QUIET) {
  console.log(`[collect] ${list.length} lines (${words} words, about ${Math.round(words / 2.6 / 60)} min of speech) -> ${path.relative(ROOT, OUT)}`);
  console.log(`[collect] by speaker: ${Object.entries(speakers).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`[collect] story lines seen: ${storyCount}; templated lines skipped: ${skipped.templated}`);
  if (skipped.unknownSpeaker.size) {
    console.log(`[collect] no cast voice for: ${[...skipped.unknownSpeaker].map(([k, v]) => `${k} (${v})`).join(', ')} — add them to scripts/voice/cast.json`);
  }
}
