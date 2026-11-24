import { clamp, clamp01 } from './text.js';

// Lyra's feelings. Ten emotions (0..1) drift back toward a baseline that depends on
// her personality, on a slow "mood" that tracks how her days have been going, and on a
// "tint": how her situation sits with her (hurt after leaving someone who struck her,
// shaken, heavy-hearted, relieved). The tint lifts slowly, over a day or two of play.
// Appraisals turn what happens into emotion changes, scaled by her personality:
// openness feeds curiosity, agreeableness feeds distress at cruelty, neuroticism sets
// how hard fear lands.

export const EMOTIONS = ['joy', 'sadness', 'fear', 'anger', 'trust', 'surprise', 'affection', 'curiosity', 'pride', 'embarrassment'];

// Seconds of play for an emotion to fall halfway back to baseline.
const HALF_LIFE = {
  joy: 70,
  sadness: 160,
  fear: 28,
  anger: 50,
  trust: 320,
  surprise: 8,
  affection: 260,
  curiosity: 80,
  pride: 100,
  embarrassment: 30,
};

const ALIASES = {
  happy: 'joy',
  happiness: 'joy',
  glad: 'joy',
  delight: 'joy',
  delighted: 'joy',
  excited: 'joy',
  sad: 'sadness',
  sorrow: 'sadness',
  grief: 'sadness',
  upset: 'sadness',
  scared: 'fear',
  afraid: 'fear',
  frightened: 'fear',
  nervous: 'fear',
  worried: 'fear',
  worry: 'fear',
  angry: 'anger',
  mad: 'anger',
  furious: 'anger',
  annoyed: 'anger',
  trusting: 'trust',
  grateful: 'trust',
  gratitude: 'trust',
  surprised: 'surprise',
  shocked: 'surprise',
  love: 'affection',
  loving: 'affection',
  fond: 'affection',
  tender: 'affection',
  curious: 'curiosity',
  interested: 'curiosity',
  wonder: 'curiosity',
  proud: 'pride',
  embarrassed: 'embarrassment',
  flustered: 'embarrassment',
  shy: 'embarrassment',
};

export function emotionName(name) {
  const n = String(name || '')
    .toLowerCase()
    .trim();
  if (EMOTIONS.includes(n) || n === 'calm') return n;
  return ALIASES[n] || null;
}

// Appraisal kinds -> emotion deltas. Each delta is a function of personality factors:
// O openness, C conscientiousness, E extraversion, A agreeableness, N neuroticism
// (already turned into multipliers around 1).
const APPRAISALS = {
  threat: (p) => ({ fear: 0.22 * p.N, surprise: 0.15, curiosity: -0.05 }),
  hurt: (p) => ({ fear: 0.12 * p.N, anger: 0.14, surprise: 0.08 }),
  ally_hurt: (p) => ({ anger: 0.2, fear: 0.08 * p.N, affection: 0.04 }),
  cruelty: (p) => ({ anger: 0.22 * p.A, sadness: 0.18 * p.A, trust: -0.1, joy: -0.15 }),
  kindness: (p) => ({ joy: 0.1, trust: 0.08, affection: 0.08 * p.A }),
  novelty: (p) => ({ curiosity: 0.32 * p.O, joy: 0.07 * p.O, surprise: 0.08 }),
  familiar: () => ({ curiosity: 0.03, trust: 0.01 }),
  danger_place: (p) => ({ fear: 0.12 * p.N, curiosity: 0.06 * p.O }),
  loss: (p) => ({ sadness: 0.4, fear: 0.22 * p.N, joy: -0.25 }),
  rescue: () => ({ trust: 0.4, affection: 0.3, joy: 0.3, embarrassment: 0.1, fear: -0.3 }),
  relief: () => ({ joy: 0.18, fear: -0.3, anger: -0.15 }),
  victory: (p) => ({ pride: 0.2 * p.C, joy: 0.15, fear: -0.25, anger: -0.15 }),
  achievement: (p) => ({ pride: 0.14 * p.C, joy: 0.06 }),
  failure: (p) => ({ embarrassment: 0.1, anger: 0.06, sadness: 0.05 * p.N }),
  gift_loved: () => ({ joy: 0.45, affection: 0.3, surprise: 0.2 }),
  gift_liked: () => ({ joy: 0.25, affection: 0.15, surprise: 0.1 }),
  gift_neutral: () => ({ joy: 0.08, affection: 0.05 }),
  gift_disliked: () => ({ embarrassment: 0.15, joy: 0.02 }),
  praise: (p) => ({ joy: 0.18 * p.E, pride: 0.14, embarrassment: 0.08 }),
  insult: (p) => ({ sadness: 0.12 * p.N, anger: 0.14 }),
  gloom: (p) => ({ sadness: 0.06, fear: 0.04 * p.N, joy: -0.04 }),
  cozy: () => ({ joy: 0.14, trust: 0.03, fear: -0.06 }),
  night_out: (p) => ({ fear: 0.07 * p.N, curiosity: 0.05 * p.O }),
  starlight: (p) => ({ joy: 0.12, curiosity: 0.08 * p.O, affection: 0.03 }),
  hope: (p) => ({ curiosity: 0.28 * p.O, joy: 0.18, fear: 0.12 * p.N, sadness: 0.06 }),
  grief: (p) => ({ sadness: 0.5, fear: 0.18 * p.N, joy: -0.3 }),
  social: (p) => ({ joy: 0.05 * p.E, trust: 0.02 }),
  meeting: (p) => ({ curiosity: 0.12 * p.O, joy: 0.06 * p.E, embarrassment: 0.02 * p.N }),
  level_up: () => ({ pride: 0.3, joy: 0.25, surprise: 0.1 }),
  rest: () => ({ fear: -0.2, anger: -0.2, surprise: -0.3, joy: 0.05 }),
  // Someone she travels with turned on her or on the innocent.
  betrayal: (p) => ({ surprise: 0.3, fear: 0.22 * p.N, anger: 0.24, sadness: 0.14 * p.A, trust: -0.25, joy: -0.2, affection: -0.1 }),
  // Someone proved themselves: a rescue, a kept promise, a good deed she saw.
  goodness: (p) => ({ trust: 0.2, affection: 0.14 * p.A, joy: 0.18, fear: -0.08 }),
};

export function personalityFactors(personality = {}) {
  const v = (k) => clamp01(Number.isFinite(personality[k]) ? personality[k] : 0.5);
  return {
    O: 0.5 + v('openness'),
    C: 0.6 + 0.8 * v('conscientiousness'),
    E: 0.5 + v('extraversion'),
    A: 0.5 + v('agreeableness'),
    N: 0.4 + 1.2 * v('neuroticism'),
  };
}

// Which way a tint leans: positive for warm feelings, negative for hard ones.
function tintValence(tint) {
  let v = 0;
  for (const e in tint) {
    const t = tint[e];
    if (e === 'joy' || e === 'trust' || e === 'affection' || e === 'pride') v += t;
    else if (e === 'sadness' || e === 'fear' || e === 'anger') v -= t;
  }
  return v;
}

export class Emotions {
  constructor(personality = {}) {
    // `values` is the plain object exposed as mind.emotions.
    this.values = {};
    for (const e of EMOTIONS) this.values[e] = 0;
    this.baseline = {};
    this.moodBase = 0.15; // slow valence (-1..1) that tracks recent experience
    this.tint = {}; // emotion -> offset to its baseline, fading with tintHalfLife
    this.tintHalfLife = 900;
    this.tintMood = null; // { label, emoji } her mood reads as while the tint holds
    this.setPersonality(personality);
    for (const e of EMOTIONS) this.values[e] = this.baseline[e];
  }

  setPersonality(personality) {
    this.personality = { ...personality };
    this.factors = personalityFactors(personality);
    this.computeBaseline();
  }

  computeBaseline() {
    const p = this.personality;
    const g = (k) => clamp01(Number.isFinite(p[k]) ? p[k] : 0.5);
    const up = Math.max(0, this.moodBase);
    const down = Math.max(0, -this.moodBase);
    const b = this.baseline;
    b.joy = clamp01(0.12 + 0.18 * g('extraversion') + 0.3 * up - 0.1 * down);
    b.sadness = clamp01(0.03 + 0.05 * g('neuroticism') + 0.3 * down);
    b.fear = clamp01(0.02 + 0.06 * g('neuroticism') + 0.08 * down);
    b.anger = clamp01(0.02 + 0.04 * down);
    b.trust = clamp01(0.25 + 0.2 * g('agreeableness') + 0.1 * up);
    b.surprise = 0;
    b.affection = clamp01(0.12 + 0.1 * g('agreeableness') + 0.06 * up);
    b.curiosity = clamp01(0.15 + 0.3 * g('openness'));
    b.pride = clamp01(0.08 + 0.05 * g('conscientiousness') + 0.05 * up);
    b.embarrassment = 0;
    for (const e in this.tint) if (e in b) b[e] = clamp01(b[e] + this.tint[e]);
  }

  // How her situation sits with her (DESIGN §19, polish): offsets to the baselines that
  // fade with `halfLife` seconds of play. `blend` keeps that share of the old tint.
  setTint(offsets = {}, { halfLife = 900, label = null, emoji = null, blend = 0 } = {}) {
    const next = {};
    for (const e of EMOTIONS) {
      const v = (this.tint[e] || 0) * clamp01(blend) + (Number(offsets[e]) || 0);
      if (Math.abs(v) >= 0.005) next[e] = clamp(v, -0.5, 0.5);
    }
    this.tint = next;
    this.tintHalfLife = Math.max(30, Number(halfLife) || 900);
    this.tintMood = label ? { label: String(label), emoji: emoji ? String(emoji) : '😶' } : blend > 0 ? this.tintMood : null;
    this.computeBaseline();
    // The feelings themselves move toward where she now stands.
    for (const e in next) if (next[e] > 0) this.values[e] = Math.max(this.values[e], this.baseline[e]);
    else this.values[e] = Math.min(this.values[e], this.baseline[e]);
  }

  // How strongly the tint still holds (its largest offset).
  tintStrength() {
    let s = 0;
    for (const e in this.tint) s = Math.max(s, Math.abs(this.tint[e]));
    return s;
  }

  // Time passing outside play (a night's sleep) softens it too.
  fadeTint(seconds) {
    if (!(seconds > 0)) return;
    const k = Math.pow(0.5, seconds / this.tintHalfLife);
    let any = false;
    for (const e in this.tint) {
      this.tint[e] *= k;
      if (Math.abs(this.tint[e]) < 0.005) delete this.tint[e];
      else any = true;
    }
    if (!any) this.tintMood = null;
    this.computeBaseline();
  }

  // Exponential return toward baseline; dt in seconds of play.
  decay(dt) {
    for (const e in this.tint) {
      this.fadeTint(dt);
      break;
    }
    const v = this.values;
    const b = this.baseline;
    for (let i = 0; i < EMOTIONS.length; i++) {
      const e = EMOTIONS[i];
      const k = 1 - Math.pow(0.5, dt / HALF_LIFE[e]);
      v[e] += (b[e] - v[e]) * k;
    }
  }

  // The slow mood follows the current valence with a time constant of about 10 minutes
  // of play (two thirds of a day), then shifts the baselines.
  trackMood(dt, valence) {
    const k = 1 - Math.exp(-dt / 600);
    this.moodBase = clamp(this.moodBase + (valence - this.moodBase) * k, -0.6, 0.7);
    this.computeBaseline();
  }

  // Add to one emotion with saturation; returns the applied change.
  feel(name, amount) {
    const n = emotionName(name);
    if (!n || !Number.isFinite(amount) || amount === 0) return 0;
    if (n === 'calm') {
      const a = Math.abs(amount);
      this.feel('fear', -a);
      this.feel('anger', -a);
      this.feel('surprise', -a);
      return this.feel('joy', a * 0.2);
    }
    const before = this.values[n];
    let next;
    if (amount > 0) next = before + amount * (1 - before * 0.6);
    else next = before + amount;
    this.values[n] = clamp01(next);
    return this.values[n] - before;
  }

  // Apply an appraisal; returns [{name, delta}] for the emotions that moved.
  appraise(kind, intensity = 1) {
    const fn = APPRAISALS[kind];
    if (!fn) return [];
    const deltas = fn(this.factors);
    const out = [];
    for (const [name, d] of Object.entries(deltas)) {
      const delta = this.feel(name, d * intensity);
      if (delta) out.push({ name, delta, amount: d * intensity });
    }
    return out;
  }

  // The emotion furthest above its baseline.
  dominant() {
    let best = null;
    let bestD = -Infinity;
    for (const e of EMOTIONS) {
      const d = this.values[e] - this.baseline[e];
      if (d > bestD) {
        bestD = d;
        best = e;
      }
    }
    return { name: best, value: this.values[best], excess: bestD };
  }

  top(n = 3) {
    return EMOTIONS.map((e) => ({ name: e, value: this.values[e] }))
      .sort((a, b) => b.value - a.value)
      .slice(0, n);
  }

  valence(needs = null) {
    const v = this.values;
    const pos = v.joy + 0.6 * v.affection + 0.5 * v.pride + 0.3 * v.trust + 0.25 * v.curiosity;
    const neg = v.sadness + 0.85 * v.fear + 0.8 * v.anger + 0.5 * v.embarrassment;
    let val = (pos - neg) / 1.6;
    if (needs) {
      const low = Math.min(needs.energy, needs.hunger, needs.social, needs.fun, needs.safety);
      if (low < 0.4) val -= (0.4 - low) * 0.6;
    }
    return clamp(val, -1, 1);
  }

  arousal(needs = null) {
    const v = this.values;
    let a = 0.15 + v.fear * 0.8 + v.anger * 0.7 + v.surprise * 0.9 + v.joy * 0.35 + v.curiosity * 0.25;
    if (needs) a -= (1 - needs.energy) * 0.3;
    return clamp01(a);
  }

  mood(needs = null) {
    const valence = this.valence(needs);
    const arousal = this.arousal(needs);
    const d = this.dominant();
    let label = null;
    let emoji = null;
    // While a hard thing still weighs on her (a hurt, heavy tint), a passing bright feeling
    // (a new place catching her eye) does not name her mood; a dark one can.
    const heavy = this.tintMood && this.tintStrength() >= 0.12 && tintValence(this.tint) < 0;
    const bright = d.name === 'joy' || d.name === 'curiosity' || d.name === 'trust' || d.name === 'affection' || d.name === 'pride' || d.name === 'surprise';
    if (d.excess >= 0.22 && d.value >= 0.4 && !(heavy && bright)) {
      const hi = d.value > 0.62;
      switch (d.name) {
        case 'joy':
          [label, emoji] = arousal > 0.55 || hi ? ['delighted', '😄'] : ['happy', '😊'];
          break;
        case 'sadness':
          [label, emoji] = hi ? ['heartsick', '😢'] : ['sad', '😔'];
          break;
        case 'fear':
          [label, emoji] = hi ? ['terrified', '😱'] : ['afraid', '😨'];
          break;
        case 'anger':
          [label, emoji] = hi ? ['furious', '😡'] : ['angry', '😠'];
          break;
        case 'trust':
          [label, emoji] = ['at ease', '😌'];
          break;
        case 'surprise':
          [label, emoji] = ['startled', '😮'];
          break;
        case 'affection':
          [label, emoji] = ['affectionate', '🥰'];
          break;
        case 'curiosity':
          [label, emoji] = hi ? ['fascinated', '🤩'] : ['curious', '🤔'];
          break;
        case 'pride':
          [label, emoji] = ['proud', '😤'];
          break;
        case 'embarrassment':
          [label, emoji] = ['flustered', '😳'];
          break;
        default:
          break;
      }
    }
    // How her situation sits with her colors the day more than a passing feeling does.
    if (!label && this.tintMood && this.tintStrength() >= 0.07) [label, emoji] = [this.tintMood.label, this.tintMood.emoji];
    if (!label && needs) {
      if (needs.energy < 0.18) [label, emoji] = ['exhausted', '😴'];
      else if (needs.hunger < 0.18) [label, emoji] = ['starving', '😩'];
      else if (needs.safety < 0.25) [label, emoji] = ['on edge', '😬'];
    }
    if (!label) {
      if (valence > 0.45) [label, emoji] = arousal > 0.5 ? ['cheerful', '😄'] : ['happy', '😊'];
      else if (valence > 0.15) [label, emoji] = arousal > 0.5 ? ['lively', '😀'] : ['content', '🙂'];
      else if (valence > -0.15) [label, emoji] = arousal > 0.5 ? ['restless', '😕'] : ['calm', '😌'];
      else if (valence > -0.45) [label, emoji] = arousal > 0.5 ? ['uneasy', '😟'] : ['gloomy', '😔'];
      else [label, emoji] = arousal > 0.5 ? ['distressed', '😣'] : ['miserable', '😞'];
    }
    return { label, valence: Math.round(valence * 100) / 100, arousal: Math.round(arousal * 100) / 100, emoji, dominant: d.name };
  }

  serialize() {
    const v = {};
    for (const e of EMOTIONS) v[e] = Math.round(this.values[e] * 1000) / 1000;
    const out = { v, m: Math.round(this.moodBase * 1000) / 1000 };
    if (Object.keys(this.tint).length) {
      const t = {};
      for (const e in this.tint) t[e] = Math.round(this.tint[e] * 1000) / 1000;
      out.t = { o: t, h: Math.round(this.tintHalfLife), l: this.tintMood };
    }
    return out;
  }

  deserialize(d) {
    if (!d) return;
    if (Number.isFinite(d.m)) this.moodBase = clamp(d.m, -0.6, 0.7);
    this.tint = {};
    this.tintMood = null;
    if (d.t && typeof d.t === 'object') {
      for (const e of EMOTIONS) if (Number.isFinite(d.t.o?.[e])) this.tint[e] = clamp(d.t.o[e], -0.5, 0.5);
      if (Number.isFinite(d.t.h)) this.tintHalfLife = Math.max(30, d.t.h);
      if (d.t.l?.label) this.tintMood = { label: String(d.t.l.label), emoji: String(d.t.l.emoji || '😶') };
    }
    this.computeBaseline();
    for (const e of EMOTIONS) if (Number.isFinite(d.v?.[e])) this.values[e] = clamp01(d.v[e]);
  }
}
