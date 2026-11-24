// Filling the village-life line banks (life_lines.js) for one speaker: names as that
// person says them ("Mister Bram" from Pip, "Da" from Tilly), pronouns, places and times.

import { ANY, LIFE, LYRA_LIFE, THOUGHTS } from './life_lines.js';
import { pronoun } from './errands_data.js';
import { thirdName, callName, shortName } from '../social/lines.js';
import { speakable } from '../social/hidden.js';

const PRON_KEYS = ['he', 'him', 'his', 'He', 'His', "he's", "He's"];

function bank(speaker) {
  if (speaker === 'lyra') return LYRA_LIFE;
  return LIFE[speaker] || null;
}

// The lines a speaker has for a key, most particular first: "absent@bram" (said only
// about Bram), then their own, then everyone's.
export function linesFor(speaker, key, about = null) {
  const b = bank(speaker);
  if (about && b?.[`${key}@${about}`]?.length) return b[`${key}@${about}`];
  if (b?.[key]?.length) return b[key];
  return ANY[key] || null;
}

function pick(list, rng, avoid) {
  if (!Array.isArray(list) || !list.length) return null;
  const r = typeof rng === 'function' ? rng : Math.random;
  for (let k = 0; k < 4; k++) {
    const l = list[Math.floor(r() * list.length)];
    if (!avoid || !avoid.has(l)) return l;
  }
  return list[Math.floor(r() * list.length)];
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// vars: { about, listener, place, at, when, with, from, goods, shop, P, problem, a, days, purpose }
export function fillLine(template, speaker, vars = {}) {
  if (!template) return null;
  const about = vars.about || null;
  const who = about ? (about === 'player' ? vars.P || 'the stranger' : thirdName(speaker, about)) : vars.who || 'them';
  const map = {
    n: vars.listener ? callName(speaker, vars.listener, { playerName: vars.P || '', knowsPlayer: !!vars.knowsPlayer }) : '',
    who,
    WHO: String(who).toUpperCase(),
    place: vars.place || 'somewhere',
    at: vars.at || (vars.place ? `at ${vars.place}` : 'somewhere'),
    At: cap(vars.at || (vars.place ? `at ${vars.place}` : 'somewhere')),
    when: vars.when || 'today',
    When: cap(vars.when || 'today'),
    with: vars.with || 'someone',
    from: vars.from || 'someone',
    goods: vars.goods || 'what I came for',
    shop: vars.shop || 'the shop',
    P: vars.P || 'friend',
    problem: vars.problem || '',
    a: vars.a || '',
    days: vars.days ?? 'two',
    purpose: vars.purpose || 'get on with my day',
    doing: vars.doing || 'about my business',
  };
  for (const k of PRON_KEYS) map[k] = about ? pronoun(about, k) : k;
  let s = String(template).replace(/\{([A-Za-z']+)\}/g, (m, k) => (k in map ? map[k] : m));
  // "{n}, have you…" with nobody named: drop the dangling comma.
  s = s
    .replace(/^,\s*/, '')
    .replace(/\s+,/g, ',')
    .replace(/,\s*([?.!])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  s = cap(s);
  // A filled-in phrase that starts a sentence starts with a capital ("Oh, this morning. At the Kettle.").
  s = s.replace(/([.!?]["”’]?\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase());
  if (!speakable(s)) return null;
  return s;
}

export function lifeLine(speaker, key, vars = {}, { rng, avoid } = {}) {
  const list = linesFor(speaker, key, vars.about);
  return fillLine(pick(list, rng, avoid), speaker, vars);
}

export function thoughtLine(key, speaker, vars = {}, { rng } = {}) {
  const list = THOUGHTS[key];
  return fillLine(pick(list, rng), speaker, vars);
}

export { shortName };
