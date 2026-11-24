// Lyra's offline voice: a small template grammar over the line banks in lines.js.
//
// Template syntax
//   {slot}        filled from vars (or the speaker context: you, player, me, ...).
//                 A line whose slot is missing is skipped, so lines that mention
//                 an enemy only appear when we know the enemy.
//   {#rule}       expands a shared sub-rule from RULES (exclamations, endearments...).
//   [a|b|c]       inline choice; may nest.
//
// A bank entry is a string or { t, mood, minBond, maxBond, trait, notTrait, state,
// minTrust, maxTrust, minFear, maxFear, w }. mood/trait/state accept a string or a list.
// Entries are filtered by the speaker's mood, bond with the player, personality and how
// things stand between her and the player (companionship state, trust, fear), then picked
// by weight while avoiding lines used recently, so she rarely says the same thing twice.

import { LINES, RULES } from './lines.js';
import { companionshipOf, playerRel } from './her_state.js';

const SLOT_RE = /\{([#a-zA-Z_][\w]*)\}/g;
const MAX_RECENT = 80;

export const MOODS = ['happy', 'calm', 'low', 'tense', 'angry'];

// Map the mind's mood() and emotions to one of MOODS.
export function moodKey(mind) {
  let m = null;
  try {
    m = mind?.mood?.();
  } catch {
    m = null;
  }
  const e = mind?.emotions || {};
  if ((e.anger ?? 0) > 0.55) return 'angry';
  if ((e.fear ?? 0) > 0.55) return 'tense';
  const v = Number.isFinite(m?.valence) ? m.valence : 0.15;
  const a = Number.isFinite(m?.arousal) ? m.arousal : 0.3;
  if (v >= 0.35) return 'happy';
  if (v <= -0.3) return a > 0.55 ? 'tense' : 'low';
  return 'calm';
}

// Personality traits from the soul's Big Five (0..1).
export function traitsOf(personality) {
  const p = personality || {};
  const get = (k, d) => (Number.isFinite(p[k]) ? p[k] : d);
  const ex = get('extraversion', 0.62);
  const ag = get('agreeableness', 0.68);
  const op = get('openness', 0.74);
  const ne = get('neuroticism', 0.34);
  const co = get('conscientiousness', 0.58);
  const out = new Set();
  out.add(ex >= 0.55 ? 'playful' : 'reserved');
  out.add(ag >= 0.55 ? 'warm' : 'prickly');
  if (op >= 0.65) out.add('bookish');
  out.add(ne >= 0.55 ? 'anxious' : 'steady');
  if (co >= 0.6) out.add('diligent');
  return out;
}

export function bondLevel(mind, id = 'player') {
  try {
    const b = mind?.relationships?.bond?.(id);
    if (b && Number.isFinite(b.level)) return Math.max(0, Math.min(5, b.level));
  } catch {
    /* relationships not ready */
  }
  return 1;
}

// How Lyra addresses the player at a given bond (and how guarded she is).
export function addressFor(playerName, bond, pick, state = 'together') {
  const name = String(playerName || '').trim() || 'traveler';
  if (state === 'left' || state === 'gone' || state === 'wary') return name;
  if (bond >= 4) return pick([name, name, 'partner', 'my friend']);
  if (bond >= 2) return pick([name, name, name, 'partner']);
  return pick([name, name, 'traveler']);
}

// Everything speech_gen needs to know about the speaker right now.
export function speechContext(game) {
  const lyra = game?.companion || null;
  const mind = lyra?.mind || null;
  const settings = game?.settings || {};
  const state = companionshipOf(game);
  const rel = playerRel(game);
  let bond = bondLevel(mind);
  // Guarded, she does not talk like a close friend whatever the old bond says.
  if (state === 'wary' || state === 'left' || state === 'gone' || rel.trust < 20 || rel.fear > 40) bond = Math.min(bond, 1);
  return {
    mood: moodKey(mind),
    bond,
    traits: traitsOf(mind?.soul?.personality),
    playerName: settings.playerName || 'Traveler',
    me: mind?.soul?.name || settings.companionName || 'Lyra',
    state,
    trust: rel.trust,
    fear: rel.fear,
  };
}

const asList = (v) => (v == null ? null : Array.isArray(v) ? v : [v]);

export class SpeechGen {
  constructor({ random = Math.random, recent = MAX_RECENT } = {}) {
    this.random = random;
    this.maxRecent = recent;
    this.recentKeys = []; // "situation#index", newest last
    this.recentSet = new Set();
    this.recentTexts = new Set(); // final strings, to dodge identical output from different templates
    this.recentTextList = [];
  }

  has(situation) {
    return !!LINES[situation]?.length;
  }

  situations() {
    return Object.keys(LINES);
  }

  pick(list) {
    if (!list || !list.length) return undefined;
    return list[Math.floor(this.random() * list.length) % list.length];
  }

  // One line for a situation, or null when nothing fits.
  line(situation, vars = {}, ctx = {}) {
    return this.lineFrom(situation, LINES[situation], vars, ctx);
  }

  // Same selection rules over a bank supplied by the caller (key = memory slot).
  lineFrom(situation, bank, vars = {}, ctx = {}) {
    if (!bank || !bank.length) return null;
    const c = this._ctx(ctx);
    const v = this._vars(vars, c);
    const eligible = [];
    for (let i = 0; i < bank.length; i++) {
      const entry = typeof bank[i] === 'string' ? { t: bank[i] } : bank[i];
      if (!this._fits(entry, c)) continue;
      if (!this._slotsAvailable(entry.t, v)) continue;
      eligible.push({ i, entry });
    }
    if (!eligible.length) return null;
    const fresh = eligible.filter((e) => !this.recentSet.has(`${situation}#${e.i}`));
    const pool = fresh.length ? fresh : this._leastRecent(situation, eligible);
    const chosen = this._weighted(pool);
    let text = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      text = this.expand(chosen.entry.t, v, c);
      if (!this.recentTexts.has(text)) break;
    }
    this._remember(`${situation}#${chosen.i}`, text);
    return text;
  }

  // Like line(), but tries several situations in order.
  first(situations, vars = {}, ctx = {}) {
    for (const s of situations) {
      const t = this.line(s, vars, ctx);
      if (t) return t;
    }
    return null;
  }

  expand(template, vars = {}, ctx = {}) {
    const c = this._ctx(ctx);
    const v = vars.you ? vars : this._vars(vars, c);
    let s = String(template);
    for (let depth = 0; depth < 4 && s.includes('{'); depth++) {
      s = s.replace(SLOT_RE, (whole, key) => {
        if (key[0] === '#') {
          const rule = RULES[key.slice(1)];
          if (!rule) return '';
          const opts = rule.filter((r) => this._fits(typeof r === 'string' ? { t: r } : r, c));
          const r = this.pick(opts.length ? opts : rule);
          return typeof r === 'string' ? r : r.t;
        }
        const val = v[key];
        return val == null ? '' : String(val);
      });
    }
    s = this._choices(s);
    return tidy(s);
  }

  // Inline [a|b] choices, innermost first so they can nest.
  _choices(s) {
    for (let guard = 0; guard < 30; guard++) {
      const close = s.indexOf(']');
      if (close < 0) break;
      const open = s.lastIndexOf('[', close);
      if (open < 0) break;
      const parts = s.slice(open + 1, close).split('|');
      s = s.slice(0, open) + this.pick(parts) + s.slice(close + 1);
    }
    return s;
  }

  _ctx(ctx) {
    return {
      mood: ctx.mood || 'calm',
      bond: Number.isFinite(ctx.bond) ? ctx.bond : 1,
      traits: ctx.traits instanceof Set ? ctx.traits : new Set(ctx.traits || ['playful', 'warm', 'steady', 'bookish']),
      playerName: ctx.playerName || 'Traveler',
      me: ctx.me || 'Lyra',
      state: ctx.state || 'together',
      trust: Number.isFinite(ctx.trust) ? ctx.trust : 50,
      fear: Number.isFinite(ctx.fear) ? ctx.fear : 0,
    };
  }

  _vars(vars, c) {
    return {
      player: c.playerName,
      me: c.me,
      you: addressFor(c.playerName, c.bond, (l) => this.pick(l), c.state),
      ...vars,
    };
  }

  _fits(entry, c) {
    const moods = asList(entry.mood);
    if (moods && !moods.includes(c.mood)) return false;
    if (entry.minBond != null && c.bond < entry.minBond) return false;
    if (entry.maxBond != null && c.bond > entry.maxBond) return false;
    const traits = asList(entry.trait);
    if (traits && !traits.some((t) => c.traits.has(t))) return false;
    const not = asList(entry.notTrait);
    if (not && not.some((t) => c.traits.has(t))) return false;
    const states = asList(entry.state);
    if (states && !states.includes(c.state)) return false;
    if (entry.minTrust != null && c.trust < entry.minTrust) return false;
    if (entry.maxTrust != null && c.trust > entry.maxTrust) return false;
    if (entry.minFear != null && c.fear < entry.minFear) return false;
    if (entry.maxFear != null && c.fear > entry.maxFear) return false;
    return true;
  }

  _slotsAvailable(t, v) {
    SLOT_RE.lastIndex = 0;
    let m;
    while ((m = SLOT_RE.exec(t))) {
      const k = m[1];
      if (k[0] === '#') continue;
      const val = v[k];
      if (val == null || val === '') return false;
    }
    return true;
  }

  _leastRecent(situation, eligible) {
    let best = eligible[0];
    let bestAge = -1;
    for (const e of eligible) {
      const idx = this.recentKeys.lastIndexOf(`${situation}#${e.i}`);
      const age = idx < 0 ? Infinity : this.recentKeys.length - idx;
      if (age > bestAge) {
        bestAge = age;
        best = e;
      }
    }
    return [best];
  }

  _weighted(pool) {
    let total = 0;
    for (const e of pool) total += e.entry.w ?? 1;
    let r = this.random() * total;
    for (const e of pool) {
      r -= e.entry.w ?? 1;
      if (r <= 0) return e;
    }
    return pool[pool.length - 1];
  }

  _remember(key, text) {
    this.recentKeys.push(key);
    this.recentSet.add(key);
    if (this.recentKeys.length > this.maxRecent) {
      const old = this.recentKeys.shift();
      if (!this.recentKeys.includes(old)) this.recentSet.delete(old);
    }
    this.recentTextList.push(text);
    this.recentTexts.add(text);
    if (this.recentTextList.length > this.maxRecent) this.recentTexts.delete(this.recentTextList.shift());
  }

  serialize() {
    return this.recentKeys.slice(-30);
  }

  deserialize(list) {
    if (!Array.isArray(list)) return;
    for (const k of list) if (typeof k === 'string') this._remember(k, `~${k}`);
  }
}

// Clean up spacing and capitalization after slot filling.
export function tidy(s) {
  let out = String(s)
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:…])/g, '$1')
    .replace(/([,;:])(?=[^\s\d])/g, '$1 ')
    .replace(/\.{4,}/g, '...')
    .replace(/,\s*([.!?])/g, '$1')
    .replace(/([!?…])\.(?!\.)/g, '$1')
    .trim();
  if (out) out = out[0].toUpperCase() + out.slice(1);
  return out;
}

// Lowercase the first letter unless it starts a name or "I".
export function lowerFirst(s) {
  const t = String(s || '').trim();
  if (!t) return t;
  if (/^(I\b|I'|[A-Z][a-z]+ [A-Z])/.test(t)) return t;
  const firstWord = t.split(/\s+/)[0];
  if (/^[A-Z][a-z]+$/.test(firstWord) && PROPER.has(firstWord.toLowerCase())) return t;
  return t[0].toLowerCase() + t.slice(1);
}

// Strip a trailing period so a sentence can be embedded mid-line.
export function bare(s) {
  return String(s || '')
    .trim()
    .replace(/[.!\s]+$/, '');
}

const PROPER = new Set([
  'lyra', 'maren', 'bram', 'elda', 'pip', 'rowan', 'mira', 'tobias', 'aveline', 'garrick', 'gale', 'cal',
  'hearthvale', 'whisperwood', 'glasswater', 'mirror', 'sunken', 'stonecut', 'king', "king's",
]);
